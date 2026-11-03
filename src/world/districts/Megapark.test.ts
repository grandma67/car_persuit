import { describe, expect, it } from 'vitest';
import { DISTRICTS, MEGAPARK } from '../../gameplay/balance';
import { generateCity } from '../CityGenerator';
import { districtCities } from '../paramsTesting';
import { inRect, shrink } from '../lots';
import { FootprintIndex, rectFootprint } from '../StreetProps';
import { at } from './rules';
import { gateBlocks, lodgeBlock, mainGate, roleBlocks } from './Megapark';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = { megapark: true, oldtown: false, chinatown: false, harbor: false, farm: false, slums: false };
const placed = SEEDS.flatMap((seed) => {
  const c = generateCity(seed, undefined, { force: ALONE });
  const q = c.districts.find((d) => d.kind === 'megapark');
  return q ? [[seed, c, q] as const] : [];
});
const byFeature = [
  ...districtCities('megapark', ['sports=2', 'track']),
  ...districtCities('megapark', ['sports=1', '!track']),
];

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart, other rolls unmoved) are in DistrictRules.test.ts.

describe('Mega-park placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.6);
  });

  it.each(placed)('seed %i: an inland cluster, midtown and residential, at least half residential, every block park ground', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    const ring = DISTRICTS.outerRing;
    expect(i0 >= ring && j0 >= ring && i0 + w <= n - ring && j0 + h <= n - ring).toBe(true);
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    for (const z of zones) expect(['midtown', 'residential']).toContain(z);
    expect(zones.filter((z) => z === 'residential').length).toBeGreaterThanOrEqual(zones.length / 2);
    expect(q.blocks.every((k) => c.blocks[k].park)).toBe(true);
    expect(q.gates.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Mega-park roles and lots', () => {
  it.each(placed)('seed %i: one lake, 1–2 sports grounds, a playground and a bandstand, the rest lawns', (_seed, _c, q) => {
    expect(roleBlocks(q, 'lake')).toHaveLength(1);
    const sports = roleBlocks(q, 'sports').length + roleBlocks(q, 'track').length;
    expect(sports).toBeGreaterThanOrEqual(1);
    expect(sports).toBeLessThanOrEqual(MEGAPARK.sports[1]);
    expect(roleBlocks(q, 'track').length).toBeLessThanOrEqual(1);
    expect(roleBlocks(q, 'playground')).toHaveLength(1);
    expect(roleBlocks(q, 'bandstand')).toHaveLength(1);
    expect(q.roles.size).toBe(q.blocks.length);
  });

  it.each(placed)('seed %i: the lodge stands beside the main gate, in a block with no lake or sports ground', (_seed, c, q) => {
    const k = lodgeBlock(q)!;
    expect(gateBlocks(q, c, mainGate(q))).toContain(k);
    expect(['playground', 'bandstand', 'lawn']).toContain(q.roles.get(k));
  });

  it.each(placed)('seed %i: a lodge, a café in the bandstand block and a boathouse in the lake block, inside the sidewalk line, apart', (_seed, c, q) => {
    const built = c.buildings.filter((b) => b.district === 'megapark');
    expect(built.map((b) => b.lot).sort()).toEqual(['boathouse', 'cafe', 'lodge']);
    const blockOf = (lot: string) => q.blocks.find((k) => inRect(c.blocks[k].rect, built.find((b) => b.lot === lot)!))!;
    expect(q.roles.get(blockOf('cafe'))).toBe('bandstand');
    expect(q.roles.get(blockOf('boathouse'))).toBe('lake');
    const breaks: string[] = [];
    const index = new FootprintIndex();
    for (const b of built) {
      const inner = shrink(c.blocks[q.blocks.find((k) => inRect(c.blocks[k].rect, b))!].rect, c.config.sidewalk);
      if (Math.abs(b.x - inner.x) + b.w / 2 > inner.w / 2 + 1e-6 || Math.abs(b.z - inner.z) + b.d / 2 > inner.d / 2 + 1e-6) breaks.push(`${b.lot} past the sidewalk line at ${at(b)}`);
      if (index.hits(rectFootprint(b))) breaks.push(`${b.lot} on another at ${at(b)}`);
      index.add(rectFootprint(b));
      if (!b.street) breaks.push(`${b.lot} fronts no street`);
    }
    expect(breaks).toEqual([]);
  });

  it('pinned sports and track come true', () => {
    for (const [seed, , q] of byFeature) {
      const want = q.pins!;
      expect(roleBlocks(q, 'sports').length + roleBlocks(q, 'track').length, `seed ${seed}`).toBe(want.sports);
      expect(roleBlocks(q, 'track').length > 0, `seed ${seed}`).toBe(want.track);
    }
  });
});

describe('Mega-park traffic', () => {
  it.each(placed.slice(0, 8))('seed %i: no picket fences, beach umbrellas or bus stops inside; lamps are the old lanterns', (_seed, c, q) => {
    const inside = c.streetProps.filter((p) => inRect(q.bounds, p));
    expect(inside.filter((p) => p.kind === 'fence' || p.kind === 'umbrella' || (p.kind === 'sign' && p.variant === 'busStop')).map(at)).toEqual([]);
    expect(inside.filter((p) => p.kind === 'lamp').map(at)).toEqual([]);
  });
});
