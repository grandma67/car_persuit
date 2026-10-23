import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../gameplay/balance';
import { ALL_SPECS } from '../../vehicles/VehicleSpecs';
import { generateCity, type CityData, type Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint } from '../StreetProps';
import type { District } from './District';
import { isJunctionControl } from './apply';
import { DISTRICT_DEFS } from './index';
import { rollDistricts } from './place';
import { SLUMS_DEF, roleBlocks, ruinsOf, vacantLots } from './Slums';
import type { Decal } from './SlumsStreet';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = { slums: true, oldtown: false, chinatown: false, harbor: false, farm: false };
const city = (seed: number) => generateCity(seed, undefined, { force: ALONE });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'slums');
  return q ? [[seed, c, q] as const] : [];
});
const roadsOf = (c: CityData) => [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];
const inside = (outer: Rect, r: Rect) =>
  Math.abs(r.x - outer.x) + r.w / 2 <= outer.w / 2 + 1e-6 && Math.abs(r.z - outer.z) + r.d / 2 <= outer.d / 2 + 1e-6;
const shrunk = (r: Rect) => rectFootprint({ ...r, w: r.w - 0.02, d: r.d - 0.02 });

describe('Slums placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it.each(placed)('seed %i: a valid inland cluster, at least half residential + industrial', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    const ring = DISTRICTS.outerRing;
    expect(SLUMS_DEF.shapes.flatMap(([a, b]) => [[a, b], [b, a]])).toContainEqual([w, h]);
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
      for (const b of c.buildings) expect(footprintsOverlap(shrunk(r), rectFootprint(b))).toBe(false);
    }
  });

  it.each(placed)('seed %i: every vacant drivable rect is soft, inside its block and off the road; the camp is not drivable', (_seed, c, q) => {
    const roads = roadsOf(c);
    const s = c.config.sidewalk;
    const lots = vacantLots(q);
    expect(lots.length).toBe(roleBlocks(q, 'vacant').length + roleBlocks(q, 'camp').length);
    for (const v of lots) {
      const block = c.blocks[v.block].rect;
      const inner = { ...block, w: block.w - 2 * s, d: block.d - 2 * s };
      if (v.camp) {
        expect(inside(inner, v.camp)).toBe(true);
        for (const d of q.dressing.drivable) expect(footprintsOverlap(shrunk(v.camp), shrunk(d))).toBe(false);
      }
      if (!v.rect.w) continue;
      expect(inside(inner, v.rect)).toBe(true);
      expect(q.dressing.drivable).toContainEqual(v.rect);
      expect(q.dressing.soft).toContainEqual(v.rect);
      for (const r of roads) expect(footprintsOverlap(shrunk(v.rect), r)).toBe(false);
      expect(c.buildings.some((b) => inRect(v.rect, b))).toBe(false);
      // The fence is torn open on at least one street side.
      expect(v.holes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(placed)('seed %i: junction controls are untouched', (seed, c) => {
    const off = generateCity(seed, undefined, { defs: [] });
    const key = (x: CityData) => x.streetProps.filter(isJunctionControl).map((p) => `${p.kind}${p.variant ?? ''}${p.x},${p.z}`).sort();
    expect(key(c)).toEqual(key(off));
  });
});

describe('Slums with every district forced on', () => {
  const ALL = { slums: true, oldtown: true, chinatown: true, harbor: true, farm: true };
  const all = SEEDS.map((seed) => [seed, generateCity(seed, undefined, { force: ALL })] as const);

  it('places on most seeds, or sits out cleanly', () => {
    expect(all.filter(([, c]) => c.districts.some((d) => d.kind === 'slums')).length).toBeGreaterThan(SEEDS.length * 0.5);
  });

  it.each(all)('seed %i: districts keep a block apart; the Slums are whole or absent', (_seed, c) => {
    const ds = c.districts;
    const apart = (a: District, b: District) => {
      const g = a.grid, o = b.grid;
      return !(g.i0 - 1 < o.i0 + o.w && o.i0 < g.i0 + g.w + 1 && g.j0 - 1 < o.j0 + o.h && o.j0 < g.j0 + g.h + 1);
    };
    for (const a of ds) for (const b of ds) if (a !== b) expect(apart(a, b)).toBe(true);
    const slums = ds.find((d) => d.kind === 'slums');
    const built = c.buildings.filter((b) => b.district === 'slums');
    if (!slums) {
      expect(built).toHaveLength(0);
      expect(c.blocks.some((b) => b.district === 'slums')).toBe(false);
    } else {
      expect(built.filter((b) => b.lot === 'cornerStore')).toHaveLength(1);
      for (const b of built) expect(inRect(slums.bounds, b)).toBe(true);
    }
  });

  it.each(SEEDS)('seed %i: the other four roll as without the Slums', (seed) => {
    const without = DISTRICT_DEFS.filter((d) => d.kind !== 'slums');
    const rolls = (defs: typeof DISTRICT_DEFS) => rollDistricts(seed, defs).map((r) => r.def.kind).filter((k) => k !== 'slums');
    expect(rolls(DISTRICT_DEFS)).toEqual(rolls(without));
  });
});

describe('Slums set pieces', () => {
  const widest = Math.max(...ALL_SPECS.map((s) => s.halfExtents.x)) * 2;
  const touches = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.z - b.z) <= (a.d + b.d) / 2;

  it.each(placed)('seed %i: stubs, heaps, piers, stacks, fence and camp stay off roads and junctions', (_seed, c, q) => {
    const roads = roadsOf(c);
    for (const fp of q.dressing.solids) expect(roads.filter((r) => footprintsOverlap(fp, r))).toEqual([]);
    expect(q.dressing.structures.filter((s) => s.kind === 'ruin')).toHaveLength(ruinsOf(q).length);
  });

  it.each(placed)('seed %i: the overpass stands on a gate and clears every vehicle', (_seed, _c, q) => {
    expect(q.dressing.structures.filter((s) => s.kind === 'overpass').length).toBe(1);
    for (const o of q.dressing.overhead) expect(o.bottom).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
  });

  it.each(placed)('seed %i: junkyard corridors are wide, clear of solids, and join two streets', (_seed, c, q) => {
    const corridors = q.dressing.drivable.filter((d) => !vacantLots(q).some((v) => v.rect === d));
    if (!roleBlocks(q, 'junkyard').length) return expect(corridors).toEqual([]);
    const streets = new Set<number>();
    for (const r of corridors) {
      expect(Math.min(r.w, r.d)).toBeGreaterThanOrEqual(widest + 1);
      for (const fp of q.dressing.solids) expect(footprintsOverlap(shrunk(r), fp)).toBe(false);
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
      for (const fp of s.footprints) for (const d of q.dressing.drivable) expect(footprintsOverlap(fp, shrunk(d))).toBe(false);
    }
  });
});

/** A footprint's four corners. */
const corners = (f: Footprint) => {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: f.x + c * u * f.hx + s * v * f.hz, z: f.z - s * u * f.hx + c * v * f.hz }));
};

describe('Slums streets', () => {
  const CLUTTER = ['trashBags', 'shoppingCart', 'tyres', 'mattress', 'couch', 'burnBarrel', 'pallet', 'crates', 'drums'];

  it.each(placed)('seed %i: kerb clutter keeps off the centre line; props off solids and each other', (_seed, c, q) => {
    const mine = q.dressing.props;
    for (const p of mine) expect(q.dressing.solids.filter((f) => footprintsOverlap(propFootprint(p), f))).toEqual([]);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) expect(footprintsOverlap(propFootprint(mine[i]), propFootprint(mine[j]))).toBe(false);
    for (const p of mine.filter((m) => CLUTTER.includes(m.kind))) {
      const road = c.roads.find((r) => footprintsOverlap(propFootprint(p, c.config.sidewalk), rectFootprint(r.rect)));
      if (!road) continue;
      const alongX = road.rect.w > road.rect.d;
      const lateral = alongX ? Math.abs(p.z - road.rect.z) : Math.abs(p.x - road.rect.x);
      const fp = propFootprint(p);
      expect(lateral - Math.hypot(fp.hx, fp.hz)).toBeGreaterThanOrEqual(DISTRICTS.clutterMinOffset - 1e-6);
    }
  });

  it.each(placed)('seed %i: wrecks are never in a lane: off junctions, at most a kerb lane deep into a road', (_seed, c, q) => {
    const wrecks = q.dressing.props.filter((p) => p.kind === 'wreck');
    expect(wrecks.length).toBeGreaterThan(0);
    expect(wrecks.length).toBeLessThanOrEqual(40);
    for (const w of wrecks) {
      const fp = propFootprint(w);
      for (const j of c.intersections) expect(footprintsOverlap(fp, rectFootprint(j))).toBe(false);
      for (const r of c.roads.map((road) => road.rect)) {
        const alongX = r.w > r.d;
        for (const p of corners(fp)) {
          if (!inRect(r, p)) continue;
          // How far in from the road's kerb edge this corner reaches.
          const depth = alongX ? r.d / 2 - Math.abs(p.z - r.z) : r.w / 2 - Math.abs(p.x - r.x);
          expect(depth).toBeLessThanOrEqual(1.2);
        }
      }
    }
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

  it.each(placed)('seed %i: lamps are mostly dead, one working by each junction; no bench or tree left', (_seed, c, q) => {
    const props = c.streetProps.filter((p) => inRect(q.bounds, p));
    const dead = props.filter((p) => p.kind === 'brokenLamp').length, working = props.filter((p) => p.kind === 'lamp').length;
    expect(dead).toBeGreaterThan(working);
    expect(working).toBeGreaterThan(0);
    expect(props.filter((p) => p.kind === 'bench')).toEqual([]);
    expect(c.trees.filter((t) => inRect(q.bounds, t))).toEqual([]);
  });
});
