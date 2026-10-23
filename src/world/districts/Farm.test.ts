import { describe, expect, it } from 'vitest';
import { generateCity, type Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { FootprintIndex, footprintsOverlap, propFootprint, rectFootprint, type Footprint, type StreetProp } from '../StreetProps';
import type { District } from './District';
import { FARM, FARM_FIELDS, FARM_GATE } from '../../gameplay/balance';
import { joinRunDressing } from './runtime';
import { ALL_SPECS } from '../../vehicles/VehicleSpecs';
import { gapLane } from './FarmFields';
import { CROPS, cropCap, farmFields, farmyardBlock, fenceGaps, ranchGate } from './Farm';
import type { RanchGateData } from './FarmGate';
import { at, landmarkFootprint, pavedOf, solidsOf } from './rules';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { farm: true, oldtown: false, chinatown: false, harbor: false, slums: false } });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'farm');
  return q ? [[seed, c, q] as const] : [];
});
const inside = (outer: Rect, r: Rect) =>
  Math.abs(r.x - outer.x) + r.w / 2 <= outer.w / 2 + 1e-6 && Math.abs(r.z - outer.z) + r.d / 2 <= outer.d / 2 + 1e-6;
/** Fence-gap lanes: the way through each gap, kept clear. */
const lanesOf = (q: District) => Object.values(fenceGaps(q)).flat().map((g) => gapLane(g));

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart) are in DistrictRules.test.ts.

describe('Farm placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it.each(placed)('seed %i: a valid outer-ring cluster touching the island edge', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    expect(i0 === 0 || j0 === 0 || i0 + w === n || j0 + h === n).toBe(true);
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    for (const z of zones) expect(['residential', 'industrial']).toContain(z);
    expect(zones.filter((z) => z === 'residential').length).toBeGreaterThanOrEqual(zones.length / 2);
    expect(q.frontage).toBeUndefined();
  });

  it.each(placed)('seed %i: the farmyard is the block nearest the ranch gate, on the main street', (_seed, c, q) => {
    const g = ranchGate(q);
    const [a, b] = g.edge.split('>');
    expect(q.mainStreet.includes(g.edge) || q.mainStreet.includes(`${b}>${a}`)).toBe(true);
    const yard = farmyardBlock(q);
    const d = (k: number) => Math.hypot(c.blocks[k].rect.x - g.x, c.blocks[k].rect.z - g.z);
    for (const k of q.blocks) expect(d(yard)).toBeLessThanOrEqual(d(k));
    expect([...q.roles.values()].every((r) => r === 'field')).toBe(true);
    expect(q.roles.size).toBe(q.blocks.length - 1);
  });
});

describe('Farm farmyard and fields', () => {
  it.each(placed)('seed %i: exactly one farmhouse and one barn, all buildings in the farmyard', (_seed, c, q) => {
    const farm = c.buildings.filter((b) => b.district === 'farm');
    expect(farm.filter((b) => b.lot === 'farmhouse')).toHaveLength(1);
    expect(farm.filter((b) => b.lot === 'barn')).toHaveLength(1);
    const yard = c.blocks[farmyardBlock(q)].rect;
    const s = c.config.sidewalk;
    for (const b of farm) {
      expect(['farmhouse', 'barn', 'machineShed', 'granary', 'henhouse']).toContain(b.lot);
      expect(inside({ ...yard, w: yard.w - 2 * s, d: yard.d - 2 * s }, b)).toBe(true);
    }
    // No two buildings overlap.
    for (const a of farm) for (const b of farm) if (a !== b) expect(footprintsOverlap(rectFootprint(a), rectFootprint(b))).toBe(false);
  });

  it.each(placed)('seed %i: every field has a crop, at least one corn, none more than the cap', (_seed, _c, q) => {
    const fields = farmFields(q);
    expect(fields).toHaveLength(q.roles.size);
    const counts = Object.fromEntries(CROPS.map((k) => [k, fields.filter((f) => f.crop === k).length]));
    expect(counts.corn).toBeGreaterThanOrEqual(1);
    const cap = cropCap(fields.length);
    if (fields.length <= 2 * CROPS.length) expect(cap).toBe(2);
    for (const n of Object.values(counts)) expect(n).toBeLessThanOrEqual(cap);
  });

  it.each(placed)('seed %i: each field is soil, drivable and soft inside its block, off the road', (_seed, c, q) => {
    const roads = pavedOf(c);
    const s = c.config.sidewalk;
    for (const f of farmFields(q)) {
      const block = c.blocks[f.block].rect;
      expect(inside({ ...block, w: block.w - 2 * s, d: block.d - 2 * s }, f.rect)).toBe(true);
      expect(q.dressing.drivable).toContainEqual(f.rect);
      expect(q.dressing.soft).toContainEqual(f.rect);
      expect(q.dressing.ground.some((g) => g.kind === 'soil' && g.x === f.rect.x && g.z === f.rect.z)).toBe(true);
      const shrunk = rectFootprint({ ...f.rect, w: f.rect.w - 0.02, d: f.rect.d - 0.02 });
      expect(roads.filter((r) => footprintsOverlap(shrunk, r))).toEqual([]);
      expect(c.buildings.some((b) => inRect(f.rect, b))).toBe(false);
    }
  });
});

describe('Farm ranch gate, yard pieces and fences', () => {
  const PIECES = ['silo', 'grainBin', 'windmill', 'waterTower'];

  it.each(placed)('seed %i: a ranch gate on the ranch gate, cattle grids on the others', (_seed, _c, q) => {
    const gates = q.dressing.structures.filter((s) => s.kind === 'ranchGate');
    expect(gates).toHaveLength(1);
    const g = ranchGate(q);
    expect(Math.abs(gates[0].yaw - g.yaw)).toBeLessThan(1e-9);
    expect(q.dressing.ground.filter((p) => p.kind === 'cattleGrid')).toHaveLength(q.gates.length - 1);
    expect(q.dressing.props.filter((p) => p.kind === 'mailbox')).toHaveLength(1);
  });

  it.each(placed)('seed %i: the crossbeam stands above the sign', (_seed, _c, q) => {
    const s = q.dressing.structures.find((st) => st.kind === 'ranchGate')!;
    const d = s.data as unknown as RanchGateData;
    expect(d.beam).toBeGreaterThan(d.sign.bottom + d.sign.h);
  });

  it.each(placed)('seed %i: yard pieces as many as asked, clear of the buildings and each other', (_seed, c, q) => {
    const pieces = q.dressing.landmarks.filter((l) => PIECES.includes(l.kind));
    const n = (k: string) => pieces.filter((l) => l.kind === k).length;
    expect(n('silo')).toBeGreaterThanOrEqual(1);
    expect(n('silo')).toBeLessThanOrEqual(FARM_GATE.silos[1]);
    expect(n('grainBin')).toBeGreaterThanOrEqual(2);
    expect(n('grainBin')).toBeLessThanOrEqual(FARM_GATE.bins[1]);
    expect(n('windmill')).toBe(1);
    expect(n('waterTower')).toBeLessThanOrEqual(1);
    // Clear of the buildings and of each other.
    const buildings = c.buildings.filter((b) => b.district === 'farm').map(rectFootprint);
    for (const l of pieces) {
      expect(buildings.filter((b) => footprintsOverlap(landmarkFootprint(l), b))).toEqual([]);
      for (const o of pieces) if (o !== l) expect(Math.hypot(o.x - l.x, o.z - l.z)).toBeGreaterThanOrEqual(o.radius + l.radius);
    }
  });

  it.each(placed)('seed %i: every field has at least two fence gaps facing different streets', (_seed, c, q) => {
    const gaps = fenceGaps(q);
    const ways = pavedOf(c, { plazas: true });
    const props = new FootprintIndex(q.dressing.props.map((p) => propFootprint(p)));
    for (const f of farmFields(q)) {
      const mine = gaps[f.block];
      expect(new Set(mine.map((g) => `${g.nx},${g.nz}`)).size).toBeGreaterThanOrEqual(2);
      // Out through each gap, across the sidewalk, is a road (or a plaza's paving, where a field has only one street).
      for (const g of mine) {
        const out = { x: g.x + g.nx * (c.config.sidewalk + 2), z: g.z + g.nz * (c.config.sidewalk + 2), hx: 0.2, hz: 0.2, yaw: 0 };
        expect(ways.some((r) => footprintsOverlap(out, r))).toBe(true);
        // Nothing stands in it.
        const gap = { x: g.x, z: g.z, hx: g.nx ? 1 : FARM_GATE.fieldGate / 2 - 0.2, hz: g.nz ? 1 : FARM_GATE.fieldGate / 2 - 0.2, yaw: 0 };
        expect(props.hits(gap)).toBe(false);
      }
    }
  });

  it.each(placed)('seed %i: fences stand on the field side, never on a road', (_seed, c, q) => {
    const roads = new FootprintIndex(pavedOf(c), 16);
    const fields = farmFields(q);
    const fences = q.dressing.props.filter((p) => p.kind === 'fence' && p.style === 'rail');
    expect(fences.length).toBeGreaterThan(0);
    expect(fences.filter((p) => roads.hits(propFootprint(p))).map(at)).toEqual([]);
    expect(fences.filter((p) => !fields.some((f) => inRect(f.rect, p))).map(at)).toEqual([]);
  });
});

describe('Farm crops, equipment and props', () => {
  /** Widest that ever leaves the road (the ramp truck is road traffic only). */
  const offRoadWidest = Math.max(...ALL_SPECS.filter((sp) => sp.body !== 'ramptruck').map((sp) => sp.halfExtents.x)) * 2;
  const mazes = placed.filter(([, , q]) => farmFields(q).some((f) => f.maze));

  it('the maze roll comes up on some seeds, not all', () => {
    expect(mazes.length).toBeGreaterThan(0);
    expect(mazes.length).toBeLessThan(placed.length);
  });

  it.each(placed)('seed %i: each crop has its furniture', (_seed, c, q) => {
    const props = q.dressing.props;
    const within = (f: { rect: Rect }, kind: string) => props.filter((p) => p.kind === kind && inRect(f.rect, p)).length;
    for (const f of farmFields(q)) {
      if (f.crop === 'orchard') expect(within(f, 'tree')).toBeGreaterThan(30);
      if (f.crop === 'pumpkin') expect(within(f, 'pumpkin')).toBeGreaterThan(10);
      if (f.crop === 'pumpkin') expect(props.filter((p) => p.kind === 'farmStand' && inRect(c.blocks[f.block].rect, p) && !inRect(f.rect, p))).toHaveLength(1);
      if (f.crop === 'hay') expect(q.dressing.props.filter((p) => p.kind === 'roundBale' && inRect(f.rect, p)).length).toBeGreaterThan(3);
      if (['corn', 'wheat', 'pumpkin'].includes(f.crop)) {
        expect(within(f, 'scarecrow')).toBeGreaterThanOrEqual(1);
        expect(within(f, 'scarecrow')).toBeLessThanOrEqual(FARM_FIELDS.scarecrows[1]);
      } else expect(within(f, 'scarecrow')).toBe(0);
    }
    expect(q.dressing.structures.filter((st) => st.kind === 'combine').length).toBeLessThanOrEqual(1);
    const tractors = props.filter((p) => p.kind === 'parkedTractor').length;
    expect(tractors).toBeGreaterThanOrEqual(1);
    expect(tractors).toBeLessThanOrEqual(FARM_FIELDS.tractors[1]);
    // Every street lamp inside is a timber one.
    expect(c.streetProps.filter((p) => p.kind === 'lamp' && inRect(q.bounds, p))).toHaveLength(0);
  });

  it.each(placed)('seed %i: nothing solid in a fence gap', (_seed, _c, q) => {
    const lanes = new FootprintIndex(lanesOf(q));
    expect(solidsOf(q).filter((f) => lanes.hits(f)).map(at)).toEqual([]);
  });

  it.each(placed)('seed %i: orchard aisles are wide enough for any car', (_seed, _c, q) => {
    for (const f of farmFields(q).filter((x) => x.crop === 'orchard')) {
      const trees = q.dressing.props.filter((p) => p.kind === 'tree' && inRect(f.rect, p));
      for (const axis of ['x', 'z'] as const) {
        const lines = [...new Set(trees.map((t) => Math.round(t[axis] * 100) / 100))].sort((a, b) => a - b);
        const trunk = propFootprint(trees[0]).hx;
        const narrowest = Math.min(...lines.slice(1).map((l, i) => l - lines[i] - 2 * trunk));
        expect(narrowest).toBeGreaterThanOrEqual(offRoadWidest + 1);
      }
    }
  });

  it.each(mazes.length ? mazes : placed.slice(0, 1))('seed %i: a corn maze joins at least two fence gaps', (_seed, _c, q) => {
    const f = farmFields(q).find((x) => x.maze);
    if (!f) return;
    expect(f.crop).toBe('corn');
    const paths = f.maze!;
    for (const r of paths) expect(Math.min(r.w, r.d)).toBeGreaterThanOrEqual(FARM_FIELDS.mazePath - 1e-6);
    // Paths that touch are joined; a gap is in whichever path holds it.
    const touch = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.z - b.z) <= (a.d + b.d) / 2;
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const i = queue.pop()!;
      paths.forEach((r, j) => !seen.has(j) && touch(paths[i], r) && (seen.add(j), queue.push(j)));
    }
    expect(seen.size).toBe(paths.length);
    const reached = fenceGaps(q)[f.block].filter((g) => paths.some((r) => inRect(r, g, 0.01)));
    expect(reached.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Farm runs: harvest night, climate, glow', () => {
  type Run = { structures: { kind: string; footprints: Footprint[] }[]; solids: Footprint[] };
  const extraOf = (q: District) => q.dressing.extra as { harvest: boolean; nightProps: StreetProp[]; night?: Run; byClimate: { desert: Run; snow: { drop: string[] } } };

  it('harvest night comes up on some seeds, not all', () => {
    const harvests = placed.filter(([, , q]) => extraOf(q).harvest).length;
    expect(harvests).toBeGreaterThan(0);
    expect(harvests).toBeLessThan(placed.length);
  });

  it.each(placed)('seed %i: night glow stays within the cap; harvest night only adds to night runs', (_seed, c, q) => {
    const x = extraOf(q);
    const lamps = c.streetProps.filter((p) => p.kind === 'woodLamp' && inRect(q.bounds, p)).length;
    expect(lamps + x.nightProps.length + 1).toBeLessThanOrEqual(FARM.maxGlow);
    expect(x.nightProps.length).toBeLessThanOrEqual(FARM.jackOLanterns);
    if (!x.harvest) expect(x.nightProps).toHaveLength(0);
    // Night-only things aren't in the city until a night run joins them.
    expect(c.streetProps.some((p) => p.kind === 'jackOLantern')).toBe(false);
    expect(q.dressing.structures.some((st) => st.kind === 'balePyramid' || st.kind === 'pivot')).toBe(false);
    const solids = new FootprintIndex(solidsOf(q));
    expect(x.nightProps.filter((p) => solids.hits(propFootprint(p))).map(at)).toEqual([]);
  });

  it.each(placed)('seed %i: the desert irrigator stands clear of the roads, gates and everything in its field', (_seed, c, q) => {
    const run = extraOf(q).byClimate.desert;
    if (!run.structures.length) return;
    const taken = new FootprintIndex([...pavedOf(c), ...lanesOf(q), ...solidsOf(q), ...q.dressing.props.map((p) => propFootprint(p))], 16);
    expect(run.solids.filter((fp) => taken.hits(fp)).map(at)).toEqual([]);
    expect(run.structures[0].kind).toBe('pivot');
  });

  it('joining a desert night run adds the irrigator and the pyramid; snow takes the pumpkins', () => {
    const [seed] = placed.find(([, , q]) => extraOf(q).harvest && extraOf(q).byClimate.desert.structures.length) ?? placed[0];
    const desert = city(seed);
    const q = desert.districts.find((d) => d.kind === 'farm')!;
    const before = q.dressing.solids.length;
    joinRunDressing(desert, { night: true, climate: 'desert' });
    expect(q.dressing.structures.some((st) => st.kind === 'pivot')).toBe(extraOf(q).byClimate.desert.structures.length > 0);
    expect(q.dressing.solids.length).toBe(before + (extraOf(q).night?.solids.length ?? 0) + extraOf(q).byClimate.desert.solids.length);
    const snow = city(seed);
    joinRunDressing(snow, { night: false, climate: 'snow' });
    const sq = snow.districts.find((d) => d.kind === 'farm')!;
    expect(snow.streetProps.some((p) => p.kind === 'pumpkin' && inRect(sq.bounds, p))).toBe(false);
    expect(sq.dressing.props.some((p) => p.kind === 'pumpkin')).toBe(false);
  });
});

describe('Farm with every district forced on', () => {
  const all = SEEDS.map((seed) => generateCity(seed, undefined, { force: { farm: true, oldtown: true, chinatown: true, harbor: true, slums: true } }));
  const farms = all.flatMap((c) => c.districts.filter((d) => d.kind === 'farm').map((q) => [c, q] as const));

  it('places on most seeds, with its barn and every field', () => {
    expect(farms.length).toBeGreaterThan(SEEDS.length * 0.6);
    for (const [c, q] of farms) {
      expect(c.buildings.filter((b) => b.district === 'farm' && b.lot === 'barn')).toHaveLength(1);
      expect(farmFields(q)).toHaveLength(q.blocks.length - 1);
    }
  });
});
