import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { inRect } from '../lots';
import { facingSquare, squareBlock } from './OldCity';

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
