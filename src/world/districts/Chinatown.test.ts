import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { inRect } from '../lots';
import { CHINATOWN } from '../../gameplay/balance';
import { squareBlock } from './Chinatown';
import { inDistrict, isJunctionControl } from './apply';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { chinatown: true, oldtown: false } });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'chinatown');
  return q ? [[seed, c, q] as const] : [];
});

describe('Chinatown placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.7);
  });

  it.each(placed)('seed %i: a valid cluster in the busy rings', (seed, c, q) => {
    const { w, h } = q.grid;
    expect([[2, 2], [2, 3], [3, 2]]).toContainEqual([w, h]);
    expect(q.blocks.every((k) => ['downtown', 'midtown'].includes(c.blocks[k].zone))).toBe(true);
    // No town square of the city's own inside; a square there is the district's.
    const plain = generateCity(seed, undefined, { defs: [] });
    expect(q.blocks.some((k) => plain.blocks[k].square)).toBe(false);
    const sq = squareBlock(q);
    expect(q.blocks.filter((k) => c.blocks[k].square)).toEqual(sq === undefined ? [] : [sq]);
    expect(q.roles.size).toBeLessThanOrEqual(1);
  });

  it.each(placed)('seed %i: the main street is a straight run of at least two edges, gated at its ends', (_seed, c, q) => {
    expect(q.mainStreet.length).toBeGreaterThanOrEqual(2);
    const nodes = q.mainStreet.flatMap((k) => k.split('>').map(Number)).map((id) => c.graph.nodes[id]);
    const straight = nodes.every((n) => Math.abs(n.x - nodes[0].x) < 0.5) || nodes.every((n) => Math.abs(n.z - nodes[0].z) < 0.5);
    expect(straight).toBe(true);
    // Consecutive edges join up.
    for (let i = 1; i < q.mainStreet.length; i++) expect(q.mainStreet[i - 1].split('>')[1]).toBe(q.mainStreet[i].split('>')[0]);
    for (const k of q.mainStreet) expect(q.streets.has(k)).toBe(true);
    // Paifang on the main street's ends and at most one more.
    const ends = q.gates.filter((g) => q.mainStreet.some((k) => k === g.edge || k === g.edge.split('>').reverse().join('>')));
    expect(ends.length).toBe(2);
    expect(q.gates.length).toBeLessThanOrEqual(3);
  });
});

describe('Chinatown lots', () => {
  it.each(placed)('seed %i: every lot has a kind, with 2–4 restaurants and at most one banquet hall and temple', (_seed, c, q) => {
    const inside = c.buildings.filter((b) => inRect(q.bounds, b));
    expect(inside.length).toBeGreaterThan(0);
    for (const b of inside) {
      expect(b.district).toBe('chinatown');
      expect(['shophouse', 'restaurant', 'banquetHall', 'teaHouse', 'bubbleTea', 'herbalShop', 'bakery', 'temple']).toContain(b.lot);
      expect(b.h).toBeGreaterThanOrEqual(8);
      expect(b.h).toBeLessThanOrEqual(20);
    }
    const count = (lot: string) => inside.filter((b) => b.lot === lot).length;
    expect(count('restaurant')).toBeGreaterThanOrEqual(CHINATOWN.restaurants[0]);
    expect(count('restaurant')).toBeLessThanOrEqual(CHINATOWN.restaurants[1]);
    expect(count('banquetHall')).toBeLessThanOrEqual(1);
    expect(count('temple')).toBeLessThanOrEqual(1);
    for (const [kind, most] of Object.entries(CHINATOWN.shops)) expect(count(kind)).toBeLessThanOrEqual(most);
    const sq = squareBlock(q);
    if (sq !== undefined) expect(inside.some((b) => inRect(c.blocks[sq].rect, b))).toBe(false);
  });

  it.each(placed)('seed %i: junction controls, hydrants and bus stops stay; zebras stay', (seed, c, q) => {
    const plain = generateCity(seed, undefined, { defs: [] });
    const keep = (p: (typeof c.streetProps)[number]) =>
      inDistrict(q, p) && (isJunctionControl(p) || p.kind === 'hydrant' || (p.kind === 'sign' && p.variant === 'busStop'));
    const key = (p: (typeof c.streetProps)[number]) => `${p.kind}:${p.variant ?? ''}:${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    const want = plain.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map(key).sort();
    expect(c.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map(key).sort()).toEqual(want);
    expect(c.streetProps.filter(keep).length).toBeGreaterThanOrEqual(want.length);
    const zebras = (m: typeof c.roadMarks) => m.filter((r) => r.kind === 'crosswalk' && inRect(q.bounds, r)).length;
    expect(zebras(c.roadMarks)).toBe(zebras(plain.roadMarks));
  });
});

describe('Chinatown with the Old City', () => {
  it.each(SEEDS)('seed %i: both place, or Chinatown drops cleanly', (seed) => {
    const both = generateCity(seed, undefined, { force: { oldtown: true, chinatown: true } });
    const old = generateCity(seed, undefined, { force: { oldtown: true, chinatown: false } });
    const ot = both.districts.find((d) => d.kind === 'oldtown');
    const ct = both.districts.find((d) => d.kind === 'chinatown');
    // The Old City comes first, so Chinatown never moves it.
    expect(ot?.grid).toEqual(old.districts.find((d) => d.kind === 'oldtown')?.grid);
    if (!ct) {
      // Dropped: the city is exactly the Old City one.
      expect(both.buildings).toEqual(old.buildings);
      expect(both.streetProps).toEqual(old.streetProps);
      return;
    }
    if (ot) {
      // At least a block apart, and no block shared.
      const a = ot.grid, b = ct.grid;
      const apart = b.i0 >= a.i0 + a.w + 1 || a.i0 >= b.i0 + b.w + 1 || b.j0 >= a.j0 + a.h + 1 || a.j0 >= b.j0 + b.h + 1;
      expect(apart).toBe(true);
      expect(ct.blocks.some((k) => ot.blocks.includes(k))).toBe(false);
    }
  });
});
