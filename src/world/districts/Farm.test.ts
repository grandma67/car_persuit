import { describe, expect, it } from 'vitest';
import { generateCity, type CityData, type Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { footprintsOverlap, rectFootprint } from '../StreetProps';
import type { District } from './District';
import { isJunctionControl } from './apply';
import { CROPS, FARM_DEF, cropCap, farmFields, farmyardBlock, ranchGate } from './Farm';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { farm: true, oldtown: false, chinatown: false, harbor: false } });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'farm');
  return q ? [[seed, c, q] as const] : [];
});
const roadsOf = (c: CityData) => [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];
const inside = (outer: Rect, r: Rect) =>
  Math.abs(r.x - outer.x) + r.w / 2 <= outer.w / 2 + 1e-6 && Math.abs(r.z - outer.z) + r.d / 2 <= outer.d / 2 + 1e-6;

describe('Farm placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it.each(placed)('seed %i: a valid outer-ring cluster touching the island edge', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    expect(FARM_DEF.shapes.flatMap(([a, b]) => [[a, b], [b, a]])).toContainEqual([w, h]);
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
    const roads = roadsOf(c);
    const s = c.config.sidewalk;
    for (const f of farmFields(q)) {
      const block = c.blocks[f.block].rect;
      expect(inside({ ...block, w: block.w - 2 * s, d: block.d - 2 * s }, f.rect)).toBe(true);
      expect(q.dressing.drivable).toContainEqual(f.rect);
      expect(q.dressing.soft).toContainEqual(f.rect);
      expect(q.dressing.ground.some((g) => g.kind === 'soil' && g.x === f.rect.x && g.z === f.rect.z)).toBe(true);
      const shrunk = rectFootprint({ ...f.rect, w: f.rect.w - 0.02, d: f.rect.d - 0.02 });
      for (const r of roads) expect(footprintsOverlap(shrunk, r)).toBe(false);
      expect(c.buildings.some((b) => inRect(f.rect, b))).toBe(false);
    }
  });

  it.each(placed)('seed %i: junction controls are untouched', (seed, c) => {
    const off = generateCity(seed, undefined, { defs: [] });
    const key = (x: CityData) => x.streetProps.filter(isJunctionControl).map((p) => `${p.kind}${p.variant ?? ''}${p.x},${p.z}`).sort();
    expect(key(c)).toEqual(key(off));
  });
});

describe('Farm with every district forced on', () => {
  const all = SEEDS.map((seed) => [seed, generateCity(seed, undefined, { force: { farm: true, oldtown: true, chinatown: true, harbor: true } })] as const);

  it('places on most seeds, or sits out cleanly', () => {
    expect(all.filter(([, c]) => c.districts.some((d) => d.kind === 'farm')).length).toBeGreaterThan(SEEDS.length * 0.6);
  });

  it.each(all)('seed %i: districts keep a block apart; a farm is whole or absent', (_seed, c) => {
    const ds = c.districts;
    const apart = (a: District, b: District) => {
      const g = a.grid, o = b.grid;
      return !(g.i0 - 1 < o.i0 + o.w && o.i0 < g.i0 + g.w + 1 && g.j0 - 1 < o.j0 + o.h && o.j0 < g.j0 + g.h + 1);
    };
    for (const a of ds) for (const b of ds) if (a !== b) expect(apart(a, b)).toBe(true);
    const farm = ds.find((d) => d.kind === 'farm');
    const built = c.buildings.filter((b) => b.district === 'farm');
    if (!farm) expect(built).toHaveLength(0);
    else {
      expect(built.filter((b) => b.lot === 'barn')).toHaveLength(1);
      expect(farmFields(farm)).toHaveLength(farm.blocks.length - 1);
      for (const k of farm.blocks) expect(c.blocks[k].district).toBe('farm');
    }
  });
});
