import { describe, expect, it } from 'vitest';
import { DISTRICTS, SLUMS } from '../../gameplay/balance';
import { ALL_SPECS } from '../../vehicles/VehicleSpecs';
import { generateCity, type Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { FootprintIndex, footprintsOverlap, propFootprint, rectFootprint, type Footprint } from '../StreetProps';
import type { District } from './District';
import { roleBlocks, ruinsOf, vacantLots } from './Slums';
import type { Decal } from './SlumsStreet';
import { at, pavedOf } from './rules';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = { slums: true, oldtown: false, chinatown: false, harbor: false, farm: false };
const city = (seed: number) => generateCity(seed, undefined, { force: ALONE });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'slums');
  return q ? [[seed, c, q] as const] : [];
});
const inside = (outer: Rect, r: Rect) =>
  Math.abs(r.x - outer.x) + r.w / 2 <= outer.w / 2 + 1e-6 && Math.abs(r.z - outer.z) + r.d / 2 <= outer.d / 2 + 1e-6;
const shrunk = (r: Rect) => rectFootprint({ ...r, w: r.w - 0.02, d: r.d - 0.02 });

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart, other rolls unmoved) are in DistrictRules.test.ts.

describe('Slums placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it.each(placed)('seed %i: a valid inland cluster, at least half residential + industrial', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    const ring = DISTRICTS.outerRing;
    expect(i0 >= ring && j0 >= ring && i0 + w <= n - ring && j0 + h <= n - ring).toBe(true);
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    for (const z of zones) expect(['midtown', 'residential', 'industrial']).toContain(z);
    expect(zones.filter((z) => z === 'residential' || z === 'industrial').length).toBeGreaterThanOrEqual(zones.length / 2);
    expect(q.frontage).toBeUndefined();
    expect(q.gates.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Slums roles and lots', () => {
  it.each(placed)('seed %i: 1–2 vacant blocks (the camp one of them), ≤ 1 camp, ≤ 1 junkyard, half the blocks built', (_seed, _c, q) => {
    const vacant = roleBlocks(q, 'vacant').length + roleBlocks(q, 'camp').length;
    expect(vacant).toBeGreaterThanOrEqual(1);
    expect(vacant).toBeLessThanOrEqual(2);
    expect(roleBlocks(q, 'camp').length).toBeLessThanOrEqual(1);
    expect(roleBlocks(q, 'junkyard').length).toBeLessThanOrEqual(1);
    expect(q.roles.size).toBeLessThanOrEqual(q.blocks.length / 2);
  });

  it.each(placed)('seed %i: ≥ 1 ruin, exactly one corner store, 1–3 gutted, every lot a Slums kind', (_seed, c, q) => {
    const built = c.buildings.filter((b) => b.district === 'slums');
    const ruins = ruinsOf(q);
    expect(ruins.length).toBeGreaterThanOrEqual(1);
    expect(ruins.length).toBeLessThanOrEqual(2);
    expect(built.filter((b) => b.lot === 'cornerStore')).toHaveLength(1);
    const gutted = built.filter((b) => b.lot === 'gutted').length;
    expect(gutted).toBeGreaterThanOrEqual(1);
    expect(gutted).toBeLessThanOrEqual(3);
    for (const b of built) expect(['tenement', 'boarded', 'gutted', 'cornerStore', 'squat']).toContain(b.lot);
    // A ruin fronts a street, stands in an ordinary block and no building stands on it.
    for (const r of ruins) {
      expect(r.street).toBeGreaterThan(0);
      expect(q.roles.has(r.block)).toBe(false);
      expect(c.buildings.filter((b) => footprintsOverlap(shrunk(r), rectFootprint(b))).map(at)).toEqual([]);
    }
  });

  it.each(placed)('seed %i: every vacant drivable rect is soft, inside its block and off the road; the camp is not drivable', (_seed, c, q) => {
    const roads = pavedOf(c);
    const s = c.config.sidewalk;
    const lots = vacantLots(q);
    expect(lots.length).toBe(roleBlocks(q, 'vacant').length + roleBlocks(q, 'camp').length);
    for (const v of lots) {
      const block = c.blocks[v.block].rect;
      const inner = { ...block, w: block.w - 2 * s, d: block.d - 2 * s };
      if (v.camp) {
        expect(inside(inner, v.camp)).toBe(true);
        expect(q.dressing.drivable.filter((d) => footprintsOverlap(shrunk(v.camp!), shrunk(d)))).toEqual([]);
      }
      if (!v.rect.w) continue;
      expect(inside(inner, v.rect)).toBe(true);
      expect(q.dressing.drivable).toContainEqual(v.rect);
      expect(q.dressing.soft).toContainEqual(v.rect);
      expect(roads.filter((r) => footprintsOverlap(shrunk(v.rect), r))).toEqual([]);
      expect(c.buildings.some((b) => inRect(v.rect, b))).toBe(false);
      // The fence is torn open on at least one street side.
      expect(v.holes.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Slums with every district forced on', () => {
  const ALL = { slums: true, oldtown: true, chinatown: true, harbor: true, farm: true };

  it('places on most seeds, with its one corner store', () => {
    const slums = SEEDS.map((seed) => generateCity(seed, undefined, { force: ALL })).flatMap((c) => (c.districts.some((d) => d.kind === 'slums') ? [c] : []));
    expect(slums.length).toBeGreaterThan(SEEDS.length * 0.5);
    for (const c of slums) expect(c.buildings.filter((b) => b.district === 'slums' && b.lot === 'cornerStore')).toHaveLength(1);
  });
});

describe('Slums set pieces', () => {
  const widest = Math.max(...ALL_SPECS.map((s) => s.halfExtents.x)) * 2;
  const touches = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.z - b.z) <= (a.d + b.d) / 2;

  it.each(placed)('seed %i: one ruin structure per ruin, one overpass', (_seed, _c, q) => {
    expect(q.dressing.structures.filter((s) => s.kind === 'ruin')).toHaveLength(ruinsOf(q).length);
    expect(q.dressing.structures.filter((s) => s.kind === 'overpass').length).toBe(1);
  });

  it.each(placed)('seed %i: junkyard corridors are wide, clear of solids, and join two streets', (_seed, c, q) => {
    const corridors = q.dressing.drivable.filter((d) => !vacantLots(q).some((v) => v.rect === d));
    if (!roleBlocks(q, 'junkyard').length) return expect(corridors).toEqual([]);
    const streets = new Set<number>();
    for (const r of corridors) {
      expect(Math.min(r.w, r.d)).toBeGreaterThanOrEqual(widest + 1);
      expect(q.dressing.solids.filter((fp) => footprintsOverlap(shrunk(r), fp)).map(at)).toEqual([]);
      const alongX = r.w > r.d;
      for (const end of [-1, 1]) {
        const tip: Rect = alongX ? { x: r.x + end * (r.w / 2 + 1), z: r.z, w: 0.5, d: 0.5 } : { x: r.x, z: r.z + end * (r.d / 2 + 1), w: 0.5, d: 0.5 };
        c.roads.forEach((road, i) => touches(road.rect, tip) && streets.add(i));
      }
    }
    expect(streets.size).toBeGreaterThanOrEqual(2);
  });

  it.each(placed)('seed %i: camp solids are never in a drivable rect', (_seed, _c, q) => {
    for (const s of q.dressing.structures.filter((st) => st.kind === 'camp')) {
      expect(s.footprints.filter((fp) => q.dressing.drivable.some((d) => footprintsOverlap(fp, shrunk(d)))).map(at)).toEqual([]);
    }
  });
});

/** A footprint's four corners. */
const corners = (f: Footprint) => {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: f.x + c * u * f.hx + s * v * f.hz, z: f.z - s * u * f.hx + c * v * f.hz }));
};

describe('Slums streets', () => {
  it.each(placed)('seed %i: wrecks are never in a lane: off junctions, at most a kerb lane deep into a road', (_seed, c, q) => {
    const wrecks = q.dressing.props.filter((p) => p.kind === 'wreck');
    expect(wrecks.length).toBeGreaterThan(0);
    expect(wrecks.length).toBeLessThanOrEqual(40);
    const junctions = new FootprintIndex(c.intersections.map(rectFootprint), 16);
    const deep: string[] = [];
    for (const w of wrecks) {
      const fp = propFootprint(w);
      if (junctions.hits(fp)) deep.push(`in a junction at ${at(w)}`);
      for (const r of c.roads.map((road) => road.rect)) {
        const alongX = r.w > r.d;
        for (const p of corners(fp)) {
          if (!inRect(r, p)) continue;
          // How far in from the road's kerb edge this corner reaches.
          const depth = alongX ? r.d / 2 - Math.abs(p.z - r.z) : r.w / 2 - Math.abs(p.x - r.x);
          if (depth > 1.2) deep.push(`${depth.toFixed(2)} m into the road at ${at(w)}`);
        }
      }
    }
    expect(deep).toEqual([]);
  });

  it.each(placed)('seed %i: graffiti stands 2–3 cm proud of its wall, within the face, capped', (_seed, _c, q) => {
    const decals = (q.dressing.extra?.decals ?? []) as Decal[];
    expect(decals.length).toBeGreaterThan(0);
    expect(decals.length).toBeLessThanOrEqual(260);
    for (const d of decals) {
      const { wall } = d;
      const proud = (d.x - wall.x) * wall.nx + (d.z - wall.z) * wall.nz;
      expect(proud).toBeGreaterThanOrEqual(0.02 - 1e-9);
      expect(proud).toBeLessThanOrEqual(0.03 + 1e-9);
      const u = (d.x - wall.x) * wall.nz - (d.z - wall.z) * wall.nx;
      expect(Math.abs(u) + d.w / 2).toBeLessThanOrEqual(wall.half + 1e-6);
      expect(d.y - d.h / 2).toBeGreaterThanOrEqual(wall.y0 - 1e-6);
      expect(d.y + d.h / 2).toBeLessThanOrEqual(wall.y1 + 1e-6);
      expect(d.yaw).toBeCloseTo(Math.atan2(wall.nx, wall.nz), 6);
    }
  });

  it.each(placed)('seed %i: nothing heavy parks across a junkyard corridor mouth or a torn fence hole', (_seed, c, q) => {
    const heavy = q.dressing.props.filter((p) => p.kind === 'wreck' || p.kind === 'dumpster').map((p) => propFootprint(p));
    const lots = vacantLots(q);
    const mouths: Footprint[] = q.dressing.drivable.filter((d) => !lots.some((v) => v.rect === d)).map((r) => rectFootprint(r.w > r.d ? { ...r, w: r.w + 4 } : { ...r, d: r.d + 4 }));
    for (const v of lots) for (const h of v.holes) {
      const reach = c.config.sidewalk + 2;
      mouths.push({ x: h.x + (h.nx * reach) / 2, z: h.z + (h.nz * reach) / 2, hx: h.nx ? reach / 2 : 3, hz: h.nx ? 3 : reach / 2, yaw: 0 });
    }
    for (const f of heavy) expect(mouths.filter((m) => footprintsOverlap(f, m))).toEqual([]);
  });

  it.each(placed)('seed %i: lamps are mostly dead, one working by each junction; no bench or tree left', (_seed, c, q) => {
    const props = c.streetProps.filter((p) => inRect(q.bounds, p));
    const dead = props.filter((p) => p.kind === 'brokenLamp').length, working = props.filter((p) => p.kind === 'lamp').length;
    expect(dead).toBeGreaterThan(working);
    expect(working).toBeGreaterThan(0);
    expect(props.filter((p) => p.kind === 'bench')).toEqual([]);
    expect(c.trees.filter((t) => inRect(q.bounds, t))).toEqual([]);
  });
});

describe('Slums runs: night and climate', () => {
  type ByClimate = Record<string, { ground?: (Rect & { kind: string })[]; tint?: { kinds: string[] } }>;
  const byClimate = (q: District) => (q.dressing.extra?.byClimate ?? {}) as ByClimate;

  it.each(placed)('seed %i: night glow stays within the cap (working and flickering lamps, fires, the shop sign)', (_seed, c, q) => {
    const props = c.streetProps.filter((p) => inRect(q.bounds, p, 2));
    const lamps = props.filter((p) => p.kind === 'lamp').length;
    const barrels = props.filter((p) => p.kind === 'burnBarrel').length;
    const rings = q.dressing.structures.filter((st) => st.kind === 'camp').length;
    expect(lamps + barrels + rings + 1).toBeLessThanOrEqual(SLUMS.maxGlow);
    expect(props.filter((p) => p.flicker).length).toBeGreaterThan(0);
    for (const p of props.filter((m) => m.flicker)) expect(p.kind).toBe('lamp');
  });

  it.each(placed)('seed %i: slush and blown sand lie in the gutters, clear of the junctions; wrecks weather by the sea and in the desert', (_seed, c, q) => {
    const x = byClimate(q);
    const slush = x.snow.ground ?? [];
    expect(slush.length).toBeGreaterThan(0);
    const junctions = new FootprintIndex(c.intersections.map(rectFootprint), 16);
    const buildings = new FootprintIndex(c.buildings.map(rectFootprint), 16);
    expect(slush.filter((r) => !c.roads.some((road) => inside(road.rect, r))).map(at)).toEqual([]);
    expect(slush.filter((r) => junctions.hits(shrunk(r))).map(at)).toEqual([]);
    expect((x.desert.ground ?? []).filter((g) => g.kind === 'drift' && buildings.hits(shrunk(g))).map(at)).toEqual([]);
    expect(x.beach.tint?.kinds).toContain('wreck');
    expect(x.desert.tint?.kinds).toContain('wreck');
  });
});
