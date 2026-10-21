import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { inRect } from '../lots';
import { CHINATOWN, CHINATOWN_GATES, DISTRICTS } from '../../gameplay/balance';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint } from '../StreetProps';
import { groundHeight } from '../Terrain';
import { CHINATOWN_DEF, chinatownExtra, lanternCount, squareBlock } from './Chinatown';
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

  it('places every listed shape, either way round, on some seed', () => {
    const got = new Set(placed.map(([, , q]) => `${Math.min(q.grid.w, q.grid.h)}x${Math.max(q.grid.w, q.grid.h)}`));
    for (const [a, b] of CHINATOWN_DEF.shapes) expect(got).toContain(`${Math.min(a, b)}x${Math.max(a, b)}`);
  });

  it.each(placed)('seed %i: a valid cluster in the inner city', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    expect(CHINATOWN_DEF.shapes.flatMap(([a, b]) => [[a, b], [b, a]])).toContainEqual([w, h]);
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

describe('Chinatown with the Old City (no Harbor)', () => {
  const alone = (seed: number, kind: 'oldtown' | 'chinatown') =>
    generateCity(seed, undefined, { force: { oldtown: kind === 'oldtown', chinatown: kind === 'chinatown', harbor: false } });

  it.each(SEEDS)('seed %i: the first placed sits as alone, the second keeps clear or drops cleanly', (seed) => {
    const both = generateCity(seed, undefined, { force: { oldtown: true, chinatown: true, harbor: false } });
    expect(both.districts.length).toBeGreaterThan(0);
    const [first, second] = both.districts; // placement order
    const solo = alone(seed, first.kind as 'oldtown' | 'chinatown');
    // The later one never moves the first.
    expect(first.grid).toEqual(solo.districts[0]?.grid);
    if (!second) {
      // Dropped: the city is exactly the first one's.
      expect(both.buildings).toEqual(solo.buildings);
      expect(both.streetProps).toEqual(solo.streetProps);
      return;
    }
    // At least a block apart, and no block shared.
    const a = first.grid, b = second.grid;
    const apart = b.i0 >= a.i0 + a.w + 1 || a.i0 >= b.i0 + b.w + 1 || b.j0 >= a.j0 + a.h + 1 || a.j0 >= b.j0 + b.h + 1;
    expect(apart).toBe(true);
    expect(second.blocks.some((k) => first.blocks.includes(k))).toBe(false);
  });

  it('either one may go first', () => {
    const firsts = new Set(SEEDS.map((seed) => generateCity(seed, undefined, { force: { oldtown: true, chinatown: true, harbor: false } }).districts[0]?.kind));
    expect(firsts).toEqual(new Set(['oldtown', 'chinatown']));
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

describe('Chinatown shops, props and vans', () => {
  const roadsOf = (c: (typeof placed)[number][1]) => [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];
  const CLUTTER = new Set(['produceStall', 'lanternStand', 'dimSumCart', 'fishCrate', 'mahjongTable', 'menuBoard', 'firecrackerCrate']);

  it.each(placed)('seed %i: kerb clutter keeps clutterMinOffset from every centre line and stays off the buildings', (_seed, c, q) => {
    const sq = squareBlock(q);
    const clutter = q.dressing.props.filter((p) => CLUTTER.has(p.kind) && (sq === undefined || !inRect(c.blocks[sq].rect, p, -3)));
    expect(clutter.length).toBeGreaterThan(0);
    const buildings = c.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint);
    for (const p of clutter) {
      const fp = propFootprint(p);
      const reach = Math.hypot(fp.hx, fp.hz);
      for (const { rect } of c.roads.filter((r) => footprintsOverlap(rectFootprint({ ...r.rect, w: r.rect.w + 10, d: r.rect.d + 10 }), fp))) {
        const lateral = rect.w > rect.d ? Math.abs(p.z - rect.z) : Math.abs(p.x - rect.x);
        expect(lateral - reach).toBeGreaterThanOrEqual(DISTRICTS.clutterMinOffset - 1e-6);
      }
      expect(buildings.filter((b) => footprintsOverlap(fp, b))).toEqual([]);
    }
  });

  it.each(placed)('seed %i: 1–3 vans in the main street\'s kerb lane, 15 m from junction mouths and gates', (_seed, c, q) => {
    const vans = q.dressing.props.filter((p) => p.kind === 'parkedVan');
    expect(vans.length).toBeLessThanOrEqual(CHINATOWN.vans[1]);
    const rw = c.config.roadWidth;
    for (const v of vans) {
      // On a main-street edge, between the lane centre and the kerb, along the street.
      const on = q.mainStreet.find((k) => {
        const [A, B] = k.split('>').map((id) => c.graph.nodes[Number(id)]);
        const alongX = Math.abs(A.z - B.z) < 0.5;
        const lateral = alongX ? Math.abs(v.z - A.z) : Math.abs(v.x - A.x);
        const t = alongX ? v.x : v.z;
        const [a, b] = alongX ? [A.x, B.x] : [A.z, B.z];
        return lateral > 3 && lateral < rw / 2 && t > Math.min(a, b) && t < Math.max(a, b);
      });
      expect(on).toBeDefined();
      for (const n of [...q.interior, ...q.perimeter].map((id) => c.graph.nodes[id])) {
        expect(Math.hypot(v.x - n.x, v.z - n.z)).toBeGreaterThanOrEqual(rw / 2 + CHINATOWN.vanGap - 1e-6);
      }
      for (const g of q.gates) expect(Math.hypot(v.x - g.x, v.z - g.z)).toBeGreaterThanOrEqual(CHINATOWN.vanGap);
      expect(Math.abs(Math.sin(v.yaw * 2))).toBeLessThan(1e-6); // square to the street
    }
  });

  it('parks a van on most seeds', () => {
    expect(placed.filter(([, , q]) => q.dressing.props.some((p) => p.kind === 'parkedVan')).length).toBeGreaterThan(placed.length * 0.7);
  });

  it.each(placed)('seed %i: the pagoda and the incense burner stand off the road and off every junction control', (_seed, c, q) => {
    const roads = roadsOf(c);
    const controls = c.streetProps.filter(isJunctionControl).map((p) => propFootprint(p));
    for (const l of q.dressing.landmarks.filter((l) => l.kind === 'pagoda' || l.kind === 'incense')) {
      const fp = { x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 };
      expect(roads.filter((r) => footprintsOverlap(fp, r))).toEqual([]);
      expect(controls.filter((p) => footprintsOverlap(fp, p))).toEqual([]);
      if (l.kind === 'pagoda') expect(l.tiers).toBeGreaterThanOrEqual(3), expect(l.tiers).toBeLessThanOrEqual(5);
    }
    expect(q.dressing.landmarks.some((l) => l.kind === 'pagoda')).toBe(squareBlock(q) !== undefined);
  });

  it.each(placed)('seed %i: benches, umbrellas and decorative signs are gone; hydrants stay', (_seed, c, q) => {
    const inside = c.streetProps.filter((p) => inDistrict(q, p));
    expect(inside.filter((p) => p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'sign' && (p.variant === 'noSmoking' || p.variant === 'children')))).toEqual([]);
  });

  it('every lot kind has a look; the restaurants, banquet hall, tea house and temple wear pagoda caps', () => {
    for (const lot of ['shophouse', 'restaurant', 'banquetHall', 'teaHouse', 'bubbleTea', 'herbalShop', 'bakery', 'temple']) {
      const look = CHINATOWN_DEF.looks[lot];
      expect(look).toBeDefined();
      expect(look.facade).toBe('shophouse');
      expect(look.ground).toBe('storefront');
      expect(look.roof === 'pagoda').toBe(['restaurant', 'banquetHall', 'teaHouse', 'temple'].includes(lot));
    }
  });
});

describe('Chinatown at night', () => {
  const extra = (q: (typeof placed)[number][2]) => chinatownExtra(q)!;
  const roadsOf = (c: (typeof placed)[number][1]) => [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];

  it('the festival roll is stable per seed, on about a quarter of seeds', () => {
    for (const [seed, , q] of placed.slice(0, 12)) {
      const again = city(seed).districts.find((d) => d.kind === 'chinatown')!;
      expect(chinatownExtra(again)).toEqual(extra(q));
    }
    const festive = placed.filter(([, , q]) => extra(q).festival).length;
    expect(festive).toBeGreaterThan(placed.length * 0.1);
    expect(festive).toBeLessThan(placed.length * 0.45);
  });

  it.each(placed)('seed %i: lanterns and bulbs stay within maxGlow; festival strings only on a festival seed, clear of the road', (_seed, c, q) => {
    const e = extra(q);
    const glow = lanternCount(q.dressing.overhead.filter((o) => o.kind === 'lanterns')) + lanternCount(e.festivalStrings) + e.bulbs.reduce((n, b) => n + b.n, 0);
    expect(glow).toBeLessThanOrEqual(CHINATOWN.maxGlow);
    if (!e.festival) expect(e.festivalStrings).toEqual([]);
    const ground = (x: number, z: number) => groundHeight(c.terrain, x, z);
    for (const o of e.festivalStrings) {
      const d = o.data as unknown as LanternData;
      expect(d.festival).toBe(true);
      const [a, b] = o.points;
      for (const t of d.at) {
        expect(wireY(d, t) - CHINATOWN_GATES.lanternDrop - ground(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
      }
    }
  });

  it.each(placed)('seed %i: bulb strings hang over the main street\'s sidewalks, never the roadway', (_seed, c, q) => {
    const roads = roadsOf(c);
    for (const s of extra(q).bulbs) {
      for (let t = 0; t <= 1; t += 0.25) {
        const p = { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t, hx: 0.05, hz: 0.05, yaw: 0 };
        expect(roads.filter((r) => footprintsOverlap(p, r))).toEqual([]);
        expect(inRect(q.bounds, p)).toBe(true);
      }
      expect(s.n).toBeGreaterThanOrEqual(2);
    }
  });

  it('the night market has stalls on every seed', () => {
    for (const [, , q] of placed) expect(extra(q).nightProps.length).toBeGreaterThan(0);
  });

  it.each(placed)('seed %i: night props keep the kerb rules, off buildings, solids and every other prop; never in the day\'s props', (_seed, c, q) => {
    const night = extra(q).nightProps;
    const buildings = c.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint);
    const day = c.streetProps.filter((p) => inRect(q.bounds, p, 2));
    const solids = [...q.dressing.solids, ...q.dressing.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 }))];
    const roads = roadsOf(c);
    for (const [i, p] of night.entries()) {
      const fp = propFootprint(p);
      expect(day.includes(p)).toBe(false);
      expect(buildings.filter((b) => footprintsOverlap(fp, b))).toEqual([]);
      expect(solids.filter((f) => footprintsOverlap(fp, f))).toEqual([]);
      expect(day.filter((o) => footprintsOverlap(fp, propFootprint(o)))).toEqual([]);
      expect(night.slice(i + 1).filter((o) => footprintsOverlap(fp, propFootprint(o)))).toEqual([]);
      if (p.kind === 'dragonFloat' || p.kind === 'lionDance') {
        expect(extra(q).festival).toBe(true);
        expect(roads.filter((r) => footprintsOverlap(fp, r))).toEqual([]);
        continue;
      }
      const reach = Math.hypot(fp.hx, fp.hz);
      for (const { rect } of c.roads.filter((r) => footprintsOverlap(rectFootprint({ ...r.rect, w: r.rect.w + 10, d: r.rect.d + 10 }), fp))) {
        const lateral = rect.w > rect.d ? Math.abs(p.z - rect.z) : Math.abs(p.x - rect.x);
        expect(lateral - reach).toBeGreaterThanOrEqual(DISTRICTS.clutterMinOffset - 1e-6);
      }
    }
  });
});
