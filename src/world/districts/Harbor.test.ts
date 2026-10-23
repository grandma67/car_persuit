import { describe, expect, it } from 'vitest';
import { generateCity, type Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { HARBOR, HARBOR_QUAY } from '../../gameplay/balance';
import { ALL_SPECS } from '../../vehicles/VehicleSpecs';
import { FootprintIndex, footprintsOverlap, propFootprint, rectFootprint } from '../StreetProps';
import { HARBOR_DEF, backRows, quayRow, yardBlocks } from './Harbor';
import { containersOf, type StraddleData } from './HarborYard';
import { coastFrame, quayLines, uOf, uSpan, vOf, type CraneData, type ShipData } from './HarborQuay';
import { at, pavedOf } from './rules';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { harbor: true, oldtown: false, chinatown: false, farm: false, slums: false } });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'harbor');
  return q ? [[seed, c, q] as const] : [];
});
const widest = Math.max(...ALL_SPECS.map((s) => s.halfExtents.x)) * 2;
/** Widest that ever leaves the road (the ramp truck is road traffic only): the armoured truck, the bus. */
const offRoadWidest = Math.max(...ALL_SPECS.filter((s) => s.body !== 'ramptruck').map((s) => s.halfExtents.x)) * 2;
const touches = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.z - b.z) <= (a.d + b.d) / 2;

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart) are in DistrictRules.test.ts.

describe('Harbor placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it.each(placed)('seed %i: a valid coast cluster, long side on the sea', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    for (const z of zones) expect(['industrial', 'residential']).toContain(z);
    expect(zones.filter((z) => z === 'industrial').length).toBeGreaterThanOrEqual(zones.length / 2);
    // The coast side is on the grid's edge, and the frontage reaches out over the promenade.
    const { nx, nz } = q.coast!;
    if (nz) expect(nz < 0 ? j0 === 0 : j0 + h === n).toBe(true);
    else expect(nx < 0 ? i0 === 0 : i0 + w === n).toBe(true);
    expect(q.frontage).toBeDefined();
    // Quay row along the frontage, the rest behind it.
    const quay = quayRow(q, c);
    expect(quay).toHaveLength(nz ? w : h);
    expect(quay.length + backRows(q, c).length).toBe(q.blocks.length);
    for (const k of quay) expect(touches(c.blocks[k].rect, { ...q.frontage!, w: q.frontage!.w + 1, d: q.frontage!.d + 1 })).toBe(true);
  });
});

describe('Harbor yard and lots', () => {
  it.each(placed)('seed %i: one or two yards on the quay row, no buildings in them', (_seed, c, q) => {
    const yards = yardBlocks(q);
    expect(yards.length).toBeGreaterThanOrEqual(1);
    expect(yards.length).toBeLessThanOrEqual(HARBOR.yards[1]);
    const quay = quayRow(q, c);
    for (const k of yards) {
      expect(quay).toContain(k);
      expect(c.buildings.some((b) => inRect(c.blocks[k].rect, b))).toBe(false);
    }
  });

  it.each(placed)('seed %i: exactly one harbor office; at most one silo and tank farm; transit sheds on the quay', (_seed, c, q) => {
    const inside = c.buildings.filter((b) => b.district === 'harbor');
    const count = (lot: string) => inside.filter((b) => b.lot === lot).length;
    expect(count('harborOffice')).toBe(1);
    expect(count('silo')).toBeLessThanOrEqual(1);
    expect(count('tankFarm')).toBe(0); // the farm replaces its building
    expect(q.dressing.structures.filter((s) => s.kind === 'tankFarm').length).toBeLessThanOrEqual(1);
    const quay = quayRow(q, c).map((k) => c.blocks[k].rect);
    for (const b of inside) {
      expect(['warehouse', 'transitShed', 'coldStore', 'harborOffice', 'silo']).toContain(b.lot);
      if (b.lot === 'transitShed') expect(quay.some((r) => inRect(r, b))).toBe(true);
    }
  });

  it.each(placed)('seed %i: stacks stay inside their yard, off the sidewalk, 1–4 high, within the cap', (_seed, c, q) => {
    const s = c.config.sidewalk;
    const yards = yardBlocks(q).map((k) => c.blocks[k].rect);
    const stacks = q.dressing.structures.filter((st) => st.kind === 'stack');
    expect(stacks.length).toBeGreaterThan(0);
    for (const st of stacks) {
      const [fp] = st.footprints;
      const yard = yards.find((r) => inRect(r, fp))!;
      expect(yard).toBeDefined();
      expect(Math.abs(fp.x - yard.x) + fp.hx).toBeLessThanOrEqual(yard.w / 2 - s);
      expect(Math.abs(fp.z - yard.z) + fp.hz).toBeLessThanOrEqual(yard.d / 2 - s);
      expect(q.dressing.solids).toContainEqual(fp);
    }
    const all = containersOf(q.dressing.structures);
    expect(all.length).toBeLessThanOrEqual(HARBOR.maxContainers);
    for (const k of all) expect(k.tier).toBeLessThan(HARBOR.stackHigh[1]);
  });

  it.each(placed)('seed %i: the yard corridors are wide enough, clear of stacks, and join at least two streets', (_seed, c, q) => {
    const stacks = q.dressing.structures.filter((st) => st.kind === 'stack').flatMap((st) => st.footprints);
    const streets = new Set<number>();
    for (const r of q.dressing.drivable) {
      expect(Math.min(r.w, r.d)).toBeGreaterThanOrEqual(widest + 1);
      expect(stacks.filter((fp) => footprintsOverlap(rectFootprint({ ...r, w: r.w - 0.02, d: r.d - 0.02 }), fp)).map(at)).toEqual([]);
      // Both ends reach a road segment.
      const alongX = r.w > r.d;
      for (const end of [-1, 1]) {
        const tip: Rect = alongX ? { x: r.x + end * (r.w / 2 + 1), z: r.z, w: 0.5, d: 0.5 } : { x: r.x, z: r.z + end * (r.d / 2 + 1), w: 0.5, d: 0.5 };
        c.roads.forEach((road, i) => touches(road.rect, tip) && streets.add(i));
      }
    }
    expect(streets.size).toBeGreaterThanOrEqual(2);
  });
});

describe('Harbor quay, cranes and ship', () => {
  const span = (fps: { x: number; z: number; hx: number; hz: number }[], f: ReturnType<typeof coastFrame>) => {
    const us = fps.flatMap((p) => { const u = uOf(f, p), h = Math.abs(f.ax) * p.hx + Math.abs(f.az) * p.hz; return [u - h, u + h]; });
    return [Math.min(...us), Math.max(...us)];
  };

  it.each(placed)('seed %i: cranes and bollards as many as asked; bollards on the quay edge, crane trucks on the apron', (_seed, c, q) => {
    const cranes = q.dressing.structures.filter((s) => s.kind === 'crane');
    expect(cranes.length).toBeGreaterThanOrEqual(1);
    expect(cranes.length).toBeLessThanOrEqual(HARBOR.cranes[1]);
    const bollards = q.dressing.landmarks.filter((l) => l.kind === 'bollard');
    expect(bollards.length).toBeGreaterThan(3);
    // Bollards on the quay edge, inside the sea wall; a working crane's truck on the apron.
    const f = coastFrame(q);
    const L = quayLines(c);
    for (const b of bollards) expect(vOf(f, b) + b.radius).toBeLessThan(L.edge - 0.6);
    for (const s of cranes) {
      if (!(s.data as unknown as CraneData).working) continue;
      const truck = s.footprints[4];
      const v = vOf(f, truck), h = Math.abs(f.nx) * truck.hx + Math.abs(f.nz) * truck.hz;
      expect(v - h).toBeGreaterThan(L.road[1]);
      expect(v + h).toBeLessThan(L.waterLeg - HARBOR_QUAY.leg);
    }
  });

  it.each(placed)('seed %i: two portals over the road per crane', (_seed, _c, q) => {
    const portals = q.dressing.overhead.filter((o) => o.kind === 'cranePortal');
    expect(portals.length).toBe(2 * q.dressing.structures.filter((s) => s.kind === 'crane').length);
  });

  it.each(placed)('seed %i: the ship lies wholly in the sea, inside the frontage', (_seed, c, q) => {
    const ship = q.dressing.structures.find((s) => s.kind === 'ship')!;
    const d = ship.data as unknown as ShipData;
    expect(d.length).toBeGreaterThanOrEqual(100);
    expect(d.length).toBeLessThanOrEqual(HARBOR_QUAY.shipLength[1]);
    const f = coastFrame(q);
    const front = q.frontage!;
    for (const fp of ship.footprints) {
      expect(Math.abs(fp.x - front.x) + fp.hx).toBeLessThanOrEqual(front.w / 2);
      expect(Math.abs(fp.z - front.z) + fp.hz).toBeLessThanOrEqual(front.d / 2);
      const v = vOf(f, fp), h = Math.abs(f.nx) * fp.hx + Math.abs(f.nz) * fp.hz;
      expect(v - h).toBeGreaterThan(c.islandSize / 2);
      expect(q.dressing.solids).toContainEqual(fp);
    }
    // The hull reaches well below the swell, the deck above the quay.
    expect(d.keel).toBeLessThan(-6);
    expect(d.deck).toBeGreaterThan(2);
    expect(d.boxes.length + containersOf(q.dressing.structures).length).toBeLessThanOrEqual(HARBOR.maxContainers);
  });

  it.each(placed)('seed %i: the cranes fit the berth, between the junctions, apart', (_seed, c, q) => {
    const f = coastFrame(q);
    const ship = q.dressing.structures.find((s) => s.kind === 'ship')!;
    const berth = span([ship.footprints[0]], f);
    const blocks = quayRow(q, c).map((k) => uSpan(f, c.blocks[k].rect));
    const legs = q.dressing.structures.filter((s) => s.kind === 'crane').map((s) => span(s.footprints.slice(0, 4), f)).sort((a, b) => a[0] - b[0]);
    for (const [a, b] of legs) {
      expect(a).toBeGreaterThanOrEqual(berth[0]);
      expect(b).toBeLessThanOrEqual(berth[1]);
      expect(blocks.some(([u0, u1]) => a >= u0 + HARBOR_QUAY.cornerClear - 1e-6 && b <= u1 - HARBOR_QUAY.cornerClear + 1e-6)).toBe(true);
    }
    for (let i = 1; i < legs.length; i++) expect(legs[i][0] - legs[i - 1][1]).toBeGreaterThanOrEqual(HARBOR_QUAY.craneGap - 1e-6);
  });

  it.each(placed)('seed %i: the apron keeps no promenade lamps or benches', (_seed, c, q) => {
    const f = coastFrame(q);
    const L = quayLines(c);
    const apron = c.streetProps.filter((p) => inRect(q.frontage!, p) && vOf(f, p) > L.road[1]);
    expect(apron.filter((p) => p.kind === 'lamp' || p.kind === 'bench')).toEqual([]);
  });
});

describe('Harbor sheds, yard furniture, gate and props', () => {
  it.each(placed)('seed %i: boom barriers, fences, crossbucks and forklifts stand off every road', (_seed, c, q) => {
    const roads = new FootprintIndex(pavedOf(c), 16);
    const kinds = ['boomGate', 'fence', 'crossbuck', 'forklift', 'lifebuoy'];
    expect(q.dressing.props.filter((p) => kinds.includes(p.kind) && roads.hits(propFootprint(p))).map((p) => `${p.kind} at ${at(p)}`)).toEqual([]);
    expect(q.dressing.props.filter((p) => p.kind === 'boomGate').length).toBeGreaterThanOrEqual(4);
  });

  it.each(placed)('seed %i: straddle carriers leave a gap the widest vehicle clears', (_seed, _c, q) => {
    for (const s of q.dressing.structures.filter((st) => st.kind === 'straddle')) {
      const d = s.data as unknown as StraddleData;
      expect(d.gap).toBeGreaterThanOrEqual(offRoadWidest + 1);
      const [a, b] = s.footprints;
      const apart = d.alongX ? Math.abs(a.z - b.z) - a.hz - b.hz : Math.abs(a.x - b.x) - a.hx - b.hx;
      expect(apart).toBeCloseTo(d.gap, 5);
    }
  });

  it.each(placed)('seed %i: a terminal gate with its canopy', (_seed, _c, q) => {
    expect(q.dressing.structures.find((s) => s.kind === 'terminalGate')).toBeDefined();
    expect(q.dressing.overhead.find((o) => o.kind === 'terminalCanopy')).toBeDefined();
  });

  it.each(placed)('seed %i: sheds front a street, transit sheds open to the sea, one look per lot', (_seed, c) => {
    const inside = c.buildings.filter((b) => b.district === 'harbor');
    for (const b of inside) {
      expect(HARBOR_DEF.looks[b.lot!]).toBeDefined();
      if (b.lot === 'transitShed') expect(b.open).toBeGreaterThan(0);
      else expect(b.open ?? 0).toBe(0);
    }
    for (const b of inside) if (['warehouse', 'transitShed', 'coldStore'].includes(b.lot!)) expect(b.street).toBeGreaterThan(0);
  });
});
