import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { inRect } from '../lots';
import { DISTRICTS, OLD_CITY, OLD_CITY_WALLS } from '../../gameplay/balance';
import { FootprintIndex, footprintsOverlap, propFootprint, rectFootprint } from '../StreetProps';
import { inDistrict, isJunctionControl } from './apply';
import { facingSquare, OLD_CITY_DEF, squareBlock } from './OldCity';
import { wallLine, wallPlan } from './OldCityWalls';
import { at } from './rules';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { oldtown: true } });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'oldtown');
  return q ? [[seed, c, q] as const] : [];
});

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart) are in DistrictRules.test.ts.

describe('Old City placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.7);
  });

  it('places every listed shape, either way round, on some seed', () => {
    const got = new Set(placed.map(([, , { grid: g }]) => `${Math.min(g.w, g.h)}x${Math.max(g.w, g.h)}`));
    for (const [a, b] of OLD_CITY_DEF.shapes) expect(got).toContain(`${Math.min(a, b)}x${Math.max(a, b)}`);
  });

  it.each(placed)('seed %i: a valid cluster in the inner city', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    // Clear of the outer ring, at least half downtown or midtown.
    const n = c.config.blocks, ring = DISTRICTS.outerRing;
    expect(i0 >= ring && j0 >= ring && i0 + w <= n - ring && j0 + h <= n - ring).toBe(true);
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    expect(zones.filter((z) => z === 'midtown' || z === 'downtown').length).toBeGreaterThanOrEqual(zones.length / 2);
    // A town square inside is taken over: the only square left is the market square.
    expect(q.blocks.filter((k) => c.blocks[k].square)).toEqual([squareBlock(q)]);
    expect(q.gates.length).toBeGreaterThanOrEqual(2);
  });

  it('comes in every size, in many places', () => {
    const qs = placed.map(([, , q]) => q);
    const sizes = new Set(qs.map((q) => q.grid.w));
    expect([...sizes].sort()).toEqual([2, 3, 4]);
    expect(new Set(qs.map((q) => `${q.grid.i0},${q.grid.j0}`)).size).toBeGreaterThan(qs.length / 3);
  });
});

describe('Old City lots', () => {
  it.each(placed)('seed %i: every lot has a kind, and exactly one town hall faces the square', (_seed, c, q) => {
    const inside = c.buildings.filter((b) => inRect(q.bounds, b));
    expect(inside.length).toBeGreaterThan(0);
    for (const b of inside) {
      expect(b.district).toBe('oldtown');
      expect(['halfTimbered', 'stoneHouse', 'townHall', 'arcade']).toContain(b.lot); // ruins become structures
      expect(b.h).toBeGreaterThanOrEqual(6);
      expect(b.h).toBeLessThanOrEqual(14);
    }
    const sq = squareBlock(q)!;
    expect(sq).toBeDefined();
    expect(q.roles.size).toBe(1);
    // The square block holds no building.
    expect(inside.some((b) => inRect(c.blocks[sq].rect, b))).toBe(false);
    const halls = inside.filter((b) => b.lot === 'townHall');
    expect(halls).toHaveLength(1);
    expect(facingSquare(q, c, inside).map((f) => f.b)).toContain(halls[0]);
  });
});

describe('Old City walls', () => {
  it.each(placed)('seed %i: gate openings are at least road width + 2 sidewalks, with nothing in them', (_seed, c, q) => {
    const want = c.config.roadWidth + 2 * c.config.sidewalk;
    const plan = wallPlan(q, c);
    q.gates.forEach((g, i) => {
      expect(g.opening).toBeGreaterThanOrEqual(want);
      const [a, b] = plan.gates[i].towers;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - 2 * OLD_CITY_WALLS.gateHalf;
      expect(gap).toBeGreaterThanOrEqual(want - 1e-6);
      // No solid stands in the opening: a box the road's width, through the wall line.
      const along = plan.gates[i].ax ? { hx: want / 2 - 0.01, hz: 3 } : { hx: 3, hz: want / 2 - 0.01 };
      const hole = { x: g.x, z: g.z, yaw: 0, ...along };
      expect(plan.solids.filter((s) => footprintsOverlap(s, hole))).toEqual([]);
    });
  });

  it.each(placed)('seed %i: the walls close the loop apart from gates and plaza openings', (_seed, c, q) => {
    const line = wallLine(q, c);
    const plan = wallPlan(q, c);
    const walls = plan.segments.reduce((t, g) => t + Math.hypot(g.bx - g.ax, g.bz - g.az), 0);
    const open = q.gates.reduce((t, g) => t + g.opening, 0) + plan.posterns.reduce((t, o) => t + o.opening, 0);
    expect(walls + open).toBeCloseTo(2 * (line.w + line.d), 3);
    // Every stretch lies on the wall line.
    for (const g of plan.segments) {
      const onX = Math.abs(Math.abs(g.az - line.z) - line.d / 2) < 1e-6 && g.az === g.bz;
      const onZ = Math.abs(Math.abs(g.ax - line.x) - line.w / 2) < 1e-6 && g.ax === g.bx;
      expect(onX || onZ).toBe(true);
    }
  });

  it.each(placed)('seed %i: an arch and a portcullis over every gate', (_seed, _c, q) => {
    expect(q.dressing.overhead.filter((o) => o.kind === 'arch' || o.kind === 'portcullis')).toHaveLength(2 * q.gates.length);
  });

  it.each(placed)('seed %i: buildings and every street prop stay clear of the walls', (_seed, c, q) => {
    const walls = new FootprintIndex(q.dressing.solids);
    expect(c.buildings.filter((b) => inRect(q.bounds, b) && walls.hits(rectFootprint(b))).map(at)).toEqual([]);
    expect(c.streetProps.filter((p) => walls.hits(propFootprint(p))).map((p) => `${p.kind} at ${at(p)}`)).toEqual([]);
  });
});

describe('Old City square, landmarks and clutter', () => {
  const circle = (l: { x: number; z: number; radius: number }) => ({ x: l.x, z: l.z, hx: l.radius * 0.8, hz: l.radius * 0.8, yaw: 0 });

  it.each(placed)('seed %i: the square has a well, a market cross and stalls; ruins are solid structures', (_seed, c, q) => {
    const sq = c.blocks[squareBlock(q)!].rect;
    const kinds = q.dressing.landmarks.filter((l) => inRect(sq, l)).map((l) => l.kind);
    expect(kinds).toContain('well');
    expect(kinds).toContain('marketCross');
    expect(q.dressing.props.filter((p) => p.kind === 'stall' && inRect(sq, p)).length).toBeGreaterThanOrEqual(4);
    for (const r of q.dressing.structures.filter((s) => s.kind === 'ruin')) {
      expect(q.dressing.solids).toContainEqual(r.footprints[0]);
      expect(c.buildings.some((b) => b.x === r.x && b.z === r.z)).toBe(false);
    }
  });

  it.each(placed)('seed %i: landmarks keep clear of each other, buildings and walls', (_seed, c, q) => {
    const ls = q.dressing.landmarks;
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) expect(Math.hypot(ls[i].x - ls[j].x, ls[i].z - ls[j].z)).toBeGreaterThan(ls[i].radius + ls[j].radius);
    }
    const walls = wallPlan(q, c).solids;
    const houses = c.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint);
    for (const l of ls) {
      if (l.kind === 'column' || l.kind === 'ruinArch') continue; // they stand in their ruin
      expect([...walls, ...houses].filter((f) => footprintsOverlap(circle(l), f))).toEqual([]);
    }
  });

  it.each(placed)('seed %i: nothing dropped is left inside; lamps are oil lamps; controls take old posts', (_seed, c, q) => {
    const inside = c.streetProps.filter((p) => inDistrict(q, p));
    for (const p of inside) {
      expect(['hydrant', 'bench', 'umbrella', 'lamp']).not.toContain(p.kind);
      if (p.kind === 'sign') expect(['noParking', 'noSmoking', 'children', 'pedestrian', 'busStop']).not.toContain(p.variant);
      if (isJunctionControl(p)) expect(p.style).toBe('old');
    }
    expect(c.streetProps.filter((p) => !inDistrict(q, p) && p.style === 'old')).toEqual([]);
  });
});

describe('Old City glow budget', () => {
  it.each(placed)('seed %i: oil lamps and torches stay within maxGlow', (_seed, c, q) => {
    const lamps = c.streetProps.filter((p) => p.kind === 'oilLamp' && inDistrict(q, p)).length;
    expect(lamps).toBeGreaterThan(0);
    expect(lamps + Math.min(OLD_CITY.maxTorches, 2 * q.gates.length)).toBeLessThanOrEqual(OLD_CITY.maxGlow);
  });
});
