import { describe, expect, it } from 'vitest';
import { generateCity, type CityData, type Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { HARBOR } from '../../gameplay/balance';
import { ALL_SPECS } from '../../vehicles/VehicleSpecs';
import { footprintsOverlap, rectFootprint } from '../StreetProps';
import type { District } from './District';
import { isJunctionControl } from './apply';
import { HARBOR_DEF, backRows, quayRow, yardBlocks } from './Harbor';
import { containersOf } from './HarborYard';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const city = (seed: number) => generateCity(seed, undefined, { force: { harbor: true, oldtown: false, chinatown: false } });
const placed = SEEDS.flatMap((seed) => {
  const c = city(seed);
  const q = c.districts.find((d) => d.kind === 'harbor');
  return q ? [[seed, c, q] as const] : [];
});
const widest = Math.max(...ALL_SPECS.map((s) => s.halfExtents.x)) * 2;
const touches = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.z - b.z) <= (a.d + b.d) / 2;

describe('Harbor placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it.each(placed)('seed %i: a valid coast cluster, long side on the sea', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    expect(HARBOR_DEF.shapes.flatMap(([a, b]) => [[a, b], [b, a]])).toContainEqual([w, h]);
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
      for (const fp of stacks) expect(footprintsOverlap(rectFootprint({ ...r, w: r.w - 0.02, d: r.d - 0.02 }), fp)).toBe(false);
      // Both ends reach a road segment.
      const alongX = r.w > r.d;
      for (const end of [-1, 1]) {
        const tip: Rect = alongX ? { x: r.x + end * (r.w / 2 + 1), z: r.z, w: 0.5, d: 0.5 } : { x: r.x, z: r.z + end * (r.d / 2 + 1), w: 0.5, d: 0.5 };
        c.roads.forEach((road, i) => touches(road.rect, tip) && streets.add(i));
      }
    }
    expect(streets.size).toBeGreaterThanOrEqual(2);
  });

  it.each(placed)('seed %i: junction controls are untouched and nothing solid stands on a road', (seed, c, q) => {
    const off = generateCity(seed, undefined, { defs: [] });
    const key = (x: CityData) => x.streetProps.filter(isJunctionControl).map((p) => `${p.kind}${p.variant ?? ''}${p.x},${p.z}`).sort();
    expect(key(c)).toEqual(key(off));
    const roads = [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];
    for (const fp of q.dressing.solids) expect(roads.some((r) => footprintsOverlap(fp, r))).toBe(false);
  });
});

it('the yard and lot rolls are stable per seed', () => {
  const sig = (q: District, c: CityData) => JSON.stringify([q.grid, [...q.roles], c.buildings.filter((b) => b.district === 'harbor').map((b) => b.lot), q.dressing.solids]);
  for (const [seed, c, q] of placed.slice(0, 5)) {
    const again = city(seed);
    expect(sig(again.districts.find((d) => d.kind === 'harbor')!, again)).toBe(sig(q, c));
  }
});
