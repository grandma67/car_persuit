import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { inRect } from '../lots';
import { CHINATOWN, CHINATOWN_GATES, DISTRICTS } from '../../gameplay/balance';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint } from '../StreetProps';
import { groundHeight } from '../Terrain';
import { squareBlock } from './Chinatown';
import { wireY, type LanternData, type PaifangData } from './ChinatownGates';
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

  it.each(placed)('seed %i: a valid cluster in the inner city', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    expect([[2, 2], [3, 3], [4, 4]]).toContainEqual([w, h]);
    const n = c.config.blocks, ring = DISTRICTS.outerRing;
    expect(i0 >= ring && j0 >= ring && i0 + w <= n - ring && j0 + h <= n - ring).toBe(true);
    const zones = q.blocks.map((k) => c.blocks[k].zone);
    expect(zones.filter((z) => z === 'midtown' || z === 'downtown').length).toBeGreaterThanOrEqual(zones.length / 2);
    // A town square inside is taken over: the only square left is the district's own.
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

it('Chinatown comes in every size, in many places', () => {
  const sizes = new Set(placed.map(([, , q]) => q.grid.w));
  expect([...sizes].sort()).toEqual([2, 3, 4]);
  expect(new Set(placed.map(([, , q]) => `${q.grid.i0},${q.grid.j0}`)).size).toBeGreaterThan(placed.length / 3);
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

describe('Chinatown paifang, lions and lanterns', () => {
  const roadsOf = (c: (typeof placed)[number][1]): Footprint[] => [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];

  it.each(placed)('seed %i: every gate is on an interior street, with a paifang across it', (_seed, _c, q) => {
    const paifang = q.dressing.structures.filter((s) => s.kind === 'paifang');
    expect(paifang).toHaveLength(q.gates.length);
    const perimeter = new Set(q.perimeter);
    for (const [i, g] of q.gates.entries()) {
      expect(q.streets.has(g.edge)).toBe(true);
      expect(perimeter.has(g.node)).toBe(true);
      expect(perimeter.has(g.inner)).toBe(false);
      // The paifang stands on that street, just inside the gate line.
      const p = paifang[i];
      const ix = Math.sin(g.yaw), iz = Math.cos(g.yaw);
      const along = (p.x - g.x) * ix + (p.z - g.z) * iz;
      expect(Math.abs((p.x - g.x) * iz - (p.z - g.z) * ix)).toBeLessThan(0.01);
      expect(CHINATOWN_GATES.setIn).toContain(Math.round(along * 10) / 10);
    }
  });

  it.each(placed)('seed %i: columns and lions stand off the roads and junctions, and off every junction control', (_seed, c, q) => {
    const roads = roadsOf(c);
    const lions = q.dressing.landmarks.filter((l) => l.kind === 'lion');
    expect(lions.length).toBe(q.gates.length * 2);
    const solid = [...q.dressing.structures.filter((s) => s.kind === 'paifang').flatMap((s) => s.footprints), ...lions.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: l.yaw }))];
    const controls = c.streetProps.filter(isJunctionControl).map((p) => propFootprint(p));
    for (const f of solid) {
      expect(roads.filter((r) => footprintsOverlap(f, r))).toEqual([]);
      expect(controls.filter((p) => footprintsOverlap(f, p))).toEqual([]);
    }
    // Nothing else stands in them either.
    const props = c.streetProps.filter((p) => inDistrict(q, p)).map((p) => propFootprint(p));
    for (const f of solid) expect(props.filter((p) => footprintsOverlap(f, p))).toEqual([]);
  });

  it.each(placed)('seed %i: everything over the road clears overheadClearance', (_seed, c, q) => {
    const ground = (x: number, z: number) => groundHeight(c.terrain, x, z);
    for (const s of q.dressing.structures.filter((s) => s.kind === 'paifang')) {
      const d = s.data as unknown as PaifangData;
      expect(d.beam).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
      // The beam's underside over every point of the roadway, from the paifang's base.
      const y0 = Math.min(...s.footprints.map((f) => ground(f.x, f.z)));
      for (let l = -c.config.roadWidth / 2; l <= c.config.roadWidth / 2; l += 0.5) {
        const x = s.x + Math.cos(s.yaw) * l, z = s.z - Math.sin(s.yaw) * l;
        expect(y0 + d.beam - ground(x, z)).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
      }
    }
    const strings = q.dressing.overhead.filter((o) => o.kind === 'lanterns');
    for (const o of strings) {
      const d = o.data as unknown as LanternData;
      const [a, b] = o.points;
      for (const t of d.at) {
        const y = wireY(d, t) - CHINATOWN_GATES.lanternDrop - ground(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        expect(y).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
      }
      expect(o.bottom).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
    }
    for (const o of q.dressing.overhead) expect(o.bottom).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
  });

  it('strings lanterns across most main streets', () => {
    const withStrings = placed.filter(([, , q]) => q.dressing.overhead.some((o) => o.kind === 'lanterns'));
    expect(withStrings.length).toBe(placed.length);
  });

  it.each(placed)('seed %i: dragon lamps for street lamps; banners only on the main street', (seed, c, q) => {
    expect(c.streetProps.filter((p) => inRect(q.bounds, p) && p.kind === 'lamp')).toEqual([]);
    const plain = generateCity(seed, undefined, { defs: [] });
    const lamps = c.streetProps.filter((p) => inRect(q.bounds, p) && p.kind === 'dragonLamp');
    expect(lamps.length).toBeGreaterThan(0);
    // Every dragon lamp stands where a street lamp stood.
    const was = new Set(plain.streetProps.filter((p) => p.kind === 'lamp').map((p) => `${p.x},${p.z}`));
    for (const p of lamps) expect(was.has(`${p.x},${p.z}`)).toBe(true);
    const reach = c.config.roadWidth / 2 + c.config.sidewalk;
    for (const p of c.streetProps.filter((p) => p.banner)) {
      expect(p.kind).toBe('dragonLamp');
      const near = q.mainStreet.some((k) => {
        const [A, B] = k.split('>').map((id) => c.graph.nodes[Number(id)]);
        return Math.abs(A.x - B.x) < 0.5 ? Math.abs(p.x - A.x) <= reach : Math.abs(p.z - A.z) <= reach;
      });
      expect(near).toBe(true);
    }
  });
});
