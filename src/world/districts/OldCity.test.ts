import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { inRect } from '../lots';
import { DISTRICTS, OLD_CITY_WALLS } from '../../gameplay/balance';
import { footprintsOverlap, propFootprint, rectFootprint } from '../StreetProps';
import { isJunctionControl } from './apply';
import { facingSquare, squareBlock } from './OldCity';
import { wallLine, wallPlan } from './OldCityWalls';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { oldtown: true } });
const oldCity = (seed: number) => city(seed).districts.find((q) => q.kind === 'oldtown');

describe('Old City placement', () => {
  it('places on most seeds when forced on', () => {
    const placed = SEEDS.filter((s) => oldCity(s)).length;
    expect(placed).toBeGreaterThan(SEEDS.length * 0.7);
  });

  it.each(SEEDS)('seed %i: a valid cluster in the middle ring', (seed) => {
    const c = city(seed);
    const q = c.districts.find((d) => d.kind === 'oldtown');
    if (!q) return;
    const { w, h } = q.grid;
    expect([[2, 2], [3, 3]]).toContainEqual([w, h]);
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    expect(zones.every((z) => z === 'midtown' || z === 'downtown')).toBe(true);
    expect(zones.filter((z) => z === 'midtown').length).toBeGreaterThanOrEqual(zones.length / 2);
    expect(q.blocks.some((k) => c.blocks[k].square)).toBe(false);
    expect(q.gates.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Old City lots', () => {
  it.each(SEEDS)('seed %i: every lot has a kind, and exactly one town hall faces the square', (seed) => {
    const c = city(seed);
    const q = c.districts.find((d) => d.kind === 'oldtown');
    if (!q) return;
    const inside = c.buildings.filter((b) => inRect(q.bounds, b));
    expect(inside.length).toBeGreaterThan(0);
    for (const b of inside) {
      expect(b.district).toBe('oldtown');
      expect(['halfTimbered', 'stoneHouse', 'townHall', 'ruin']).toContain(b.lot);
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
  const placed = SEEDS.flatMap((seed) => {
    const c = city(seed);
    const q = c.districts.find((d) => d.kind === 'oldtown');
    return q ? [[seed, c, q] as const] : [];
  });

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

  it.each(placed)('seed %i: no wall, tower or post overlaps a road, junction or plaza', (_seed, c, q) => {
    const paved = [...c.roads.map((r) => r.rect), ...c.intersections, ...c.plazas].map(rectFootprint);
    for (const s of q.dressing.solids) expect(paved.filter((r) => footprintsOverlap(s, r))).toEqual([]);
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

  it.each(placed)('seed %i: arches and portcullises clear the tallest vehicle', (_seed, _c, q) => {
    const over = q.dressing.overhead.filter((o) => o.kind === 'arch' || o.kind === 'portcullis');
    expect(over).toHaveLength(2 * q.gates.length);
    for (const o of over) expect(o.bottom).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
  });

  it.each(placed)('seed %i: buildings and props stay clear of the walls; junction controls are unchanged', (seed, c, q) => {
    const solids = q.dressing.solids;
    for (const b of c.buildings.filter((b) => inRect(q.bounds, b))) {
      expect(solids.filter((s) => footprintsOverlap(s, rectFootprint(b)))).toEqual([]);
    }
    for (const p of c.streetProps) {
      if (isJunctionControl(p)) continue;
      expect(solids.filter((s) => footprintsOverlap(s, propFootprint(p)))).toEqual([]);
    }
    const plain = generateCity(seed, undefined, { defs: [] });
    expect(c.streetProps.filter(isJunctionControl)).toEqual(plain.streetProps.filter(isJunctionControl));
  });

  it.each(placed)('seed %i: junction controls are not inside a wall', (_seed, c, q) => {
    for (const p of c.streetProps.filter(isJunctionControl)) {
      expect(q.dressing.solids.filter((s) => footprintsOverlap(s, propFootprint(p)))).toEqual([]);
    }
  });
});
