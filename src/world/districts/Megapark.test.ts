import { describe, expect, it } from 'vitest';
import { DISTRICTS, MEGAPARK } from '../../gameplay/balance';
import { generateCity } from '../CityGenerator';
import { alone, districtCities } from '../paramsTesting';
import { inRect, shrink } from '../lots';
import { onPitch } from '../ParkPieces';
import { footprintsOverlap, LIT_PROPS, propFootprint } from '../StreetProps';
import { FootprintIndex, rectFootprint } from '../StreetProps';
import { at } from './rules';
import { gateBlocks, lodgeBlock, mainGate, roleBlocks } from './Megapark';
import { PARK_NAMES, pathsOf, toPath } from './MegaparkLawns';
import { softGroundOf, WADING } from '../softGround';
import { DISTRICT_DEFS } from './index';
import { inWater, rimPoints, shoreDistance } from '../Water';
import type { CityData } from '../CityGenerator';
import type { District } from './District';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = alone('megapark');
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
    const own = new Set(q.dressing.props);
    const inside = c.streetProps.filter((p) => inRect(q.bounds, p) && !own.has(p)); // the city's own (the park's fences are its own)
    expect(inside.filter((p) => p.kind === 'fence' || p.kind === 'umbrella' || (p.kind === 'sign' && p.variant === 'busStop')).map(at)).toEqual([]);
    expect(inside.filter((p) => p.kind === 'lamp').map(at)).toEqual([]);
  });
});

const lakeBlock = (c: CityData, q: District) => shrink(c.blocks[roleBlocks(q, 'lake')[0]].rect, c.config.sidewalk);
const lakeWater = (c: CityData, q: District) => c.water.find((w) => w.kind === 'lake' && inRect(q.bounds, w))!;
const structure = (q: District, kind: string) => q.dressing.structures.filter((s) => s.kind === kind);
/** The far end of a span structure (along its yaw), from its centre. */
const ends = (s: { x: number; z: number; yaw: number; data?: Record<string, unknown> }) => {
  const h = (s.data!.length as number) / 2;
  return [{ x: s.x - Math.sin(s.yaw) * h, z: s.z - Math.cos(s.yaw) * h }, { x: s.x + Math.sin(s.yaw) * h, z: s.z + Math.cos(s.yaw) * h }];
};

describe('Mega-park lake', () => {
  it.each(placed)('seed %i: one lake inside its block with a bank all round, clear of the boathouse; it is wading water', (_seed, c, q) => {
    const w = lakeWater(c, q);
    const inner = lakeBlock(c, q);
    const house = c.buildings.find((b) => b.district === 'megapark' && b.lot === 'boathouse')!;
    const breaks = rimPoints(w, 64).filter((p) => !inRect(shrink(inner, MEGAPARK.lakeBank - 0.3), p)).map(at);
    expect(breaks).toEqual([]);
    expect(rimPoints(w, 64).filter((p) => inRect(house, p, 1)).map(at)).toEqual([]);
    expect(c.parkPieces.filter((p) => p.district === 'megapark' && p.kind === 'pond')).toHaveLength(1);
    expect(softGroundOf(c, DISTRICT_DEFS, false)!.at(w.x + 1, w.z + 1)).toBe(WADING);
  });

  it.each(placed)('seed %i: the jetty runs from the boathouse out over the water, the boats float beside it, the island stands in the lake', (_seed, c, q) => {
    const w = lakeWater(c, q);
    const house = c.buildings.find((b) => b.district === 'megapark' && b.lot === 'boathouse')!;
    const [j] = structure(q, 'jetty');
    const [a, b] = ends(j);
    const [foot, tip] = inRect(house, a, 0.1) ? [a, b] : [b, a];
    expect(inRect(house, foot, 0.1)).toBe(true);
    expect(shoreDistance(w, tip.x, tip.z)).toBeGreaterThan(2);
    expect(structure(q, 'moored').length).toBeGreaterThanOrEqual(1);
    for (const boat of structure(q, 'moored')) expect(inWater(w, boat.x, boat.z, 1)).toBe(true);
    const [isle] = structure(q, 'island');
    expect(shoreDistance(w, isle.x, isle.z)).toBeGreaterThanOrEqual(MEGAPARK.island + 2);
  });

  it.each(placed)('seed %i: the footbridge joins the island to the dry bank', (_seed, c, q) => {
    const w = lakeWater(c, q);
    const [isle] = structure(q, 'island');
    const [bridge] = structure(q, 'footbridge');
    const [a, b] = ends(bridge);
    const [near, far] = Math.hypot(a.x - isle.x, a.z - isle.z) < Math.hypot(b.x - isle.x, b.z - isle.z) ? [a, b] : [b, a];
    expect(Math.hypot(near.x - isle.x, near.z - isle.z)).toBeLessThan(MEGAPARK.island);
    expect(shoreDistance(w, far.x, far.z)).toBeLessThan(-1);
    expect(inRect(lakeBlock(c, q), far)).toBe(true);
  });

  it('the fountain word: a jet in the lake, or none', () => {
    for (const [seed, c, q] of districtCities('megapark', ['fountain'])) {
      const jet = q.dressing.extra!.fountain as { x: number; z: number };
      expect(inWater(lakeWater(c, q), jet.x, jet.z, 2), `seed ${seed}`).toBe(true);
    }
    for (const [seed, , q] of districtCities('megapark', ['!fountain'])) expect(q.dressing.extra!.fountain, `seed ${seed}`).toBeUndefined();
  });
});

const kinds = (q: District, kind: string) => q.dressing.props.filter((p) => p.kind === kind);
/** Every footprint corner of a solid, for "inside" checks. */
const corners = (f: { x: number; z: number; hx: number; hz: number; yaw: number }) => [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => ({
  x: f.x + a * f.hx * Math.cos(f.yaw) + b * f.hz * Math.sin(f.yaw), z: f.z - a * f.hx * Math.sin(f.yaw) + b * f.hz * Math.cos(f.yaw),
}));
const withAll = [...placed.map(([seed, c, q]) => [seed, c, q] as const), ...byFeature.map(([seed, c, q]) => [seed, c, q] as const)];

describe('Mega-park set blocks', () => {
  it.each(withAll)('seed %i: every solid stands inside one block, inside its sidewalk line', (_seed, c, q) => {
    const inners = q.blocks.map((k) => shrink(c.blocks[k].rect, c.config.sidewalk));
    const breaks = q.dressing.solids.filter((f) => !inners.some((r) => corners(f).every((p) => inRect(r, p, 1e-6)))).map(at);
    expect(breaks).toEqual([]);
  });

  it.each(withAll)('seed %i: each sports ground has its pitch (two goals, a ball) inside the block, and a tennis court with its net', (_seed, c, q) => {
    const blocks = roleBlocks(q, 'sports');
    const pitches = c.parkPieces.filter((p) => p.district === 'megapark' && p.kind === 'pitch');
    expect(pitches).toHaveLength(blocks.length);
    for (const p of pitches) {
      const inner = shrink(c.blocks[q.blocks.find((k) => inRect(c.blocks[k].rect, p))!].rect, c.config.sidewalk);
      const out = [[-1, -1], [1, 1]].map(([a, b]) => ({ x: inner.x + (a * inner.w) / 2, z: inner.z + (b * inner.d) / 2 }));
      expect(out.some((o) => onPitch(p, o.x, o.z))).toBe(false);
    }
    expect(kinds(q, 'goal')).toHaveLength(2 * blocks.length);
    expect(kinds(q, 'ball')).toHaveLength(blocks.length);
    expect(q.dressing.ground.filter((g) => g.kind === 'court')).toHaveLength(blocks.length);
    expect(kinds(q, 'tennisNet')).toHaveLength(blocks.length);
    // The court keeps off the pitch.
    for (const g of q.dressing.ground.filter((x) => x.kind === 'court')) expect(pitches.filter((p) => onPitch(p, g.x, g.z, -Math.min(g.w, g.d) / 2 + 0.5)).length).toBe(0);
  });

  it.each(withAll)('seed %i: the track keeps inside its block and clear of its stand', (_seed, c, q) => {
    for (const s of q.dressing.structures.filter((x) => x.kind === 'track')) {
      const inner = shrink(c.blocks[q.blocks.find((k) => inRect(c.blocks[k].rect, s))!].rect, c.config.sidewalk);
      const d = s.data as { straight: number; outer: number; alongX: boolean };
      const [hu, hv] = [d.straight / 2 + d.outer, d.outer];
      const box = d.alongX ? { x: s.x, z: s.z, w: hu * 2, d: hv * 2 } : { x: s.x, z: s.z, w: hv * 2, d: hu * 2 };
      expect(inRect(inner, { x: box.x - box.w / 2, z: box.z - box.d / 2 }) && inRect(inner, { x: box.x + box.w / 2, z: box.z + box.d / 2 })).toBe(true);
      const stand = q.dressing.structures.find((x) => x.kind === 'bleachers')!.footprints[0];
      expect(footprintsOverlap(stand, { x: box.x, z: box.z, hx: box.w / 2, hz: box.d / 2, yaw: 0 })).toBe(false);
    }
  });

  it.each(withAll)('seed %i: the playground holds its five pieces and a sandpit inside its fence', (_seed, _c, q) => {
    const yard = q.dressing.ground.find((g) => g.kind === 'playground')!;
    const kit = q.dressing.structures.filter((s) => ['swings', 'slide', 'climber', 'roundabout', 'seesaw'].includes(s.kind));
    expect(kit).toHaveLength(5);
    expect(kit.flatMap((s) => s.footprints.flatMap(corners)).filter((p) => !inRect(shrink(yard, 0.4), p)).map(at)).toEqual([]);
    expect(q.dressing.ground.filter((g) => g.kind === 'sandpit' && inRect(yard, g))).toHaveLength(1);
    expect(kinds(q, 'fence').filter((p) => inRect(yard, p, 0.5)).length).toBeGreaterThan(20);
  });

  it.each(withAll)('seed %i: the bandstand, deck chairs round it, tables on the café terrace before the café', (_seed, c, q) => {
    const cafe = c.buildings.find((b) => b.district === 'megapark' && b.lot === 'cafe')!;
    const band = q.dressing.structures.find((s) => s.kind === 'bandstand')!;
    expect(band.footprints.some((f) => footprintsOverlap(f, rectFootprint(cafe)))).toBe(false);
    expect(kinds(q, 'deckChair').length).toBeGreaterThanOrEqual(4);
    const terrace = q.dressing.ground.find((g) => g.kind === 'terrace')!;
    expect(footprintsOverlap(rectFootprint(terrace), rectFootprint({ ...cafe, w: cafe.w + 0.2, d: cafe.d + 0.2 }))).toBe(true);
    expect(footprintsOverlap(rectFootprint(shrink(terrace, 0.05)), rectFootprint(cafe))).toBe(false);
    expect(kinds(q, 'cafeTable').filter((p) => inRect(terrace, p)).length).toBeGreaterThanOrEqual(2);
    expect(kinds(q, 'deckChair').filter((p) => footprintsOverlap(propFootprint(p), rectFootprint(terrace)))).toEqual([]);
  });
});

describe('Mega-park lawns, paths and gates', () => {
  it.each(withAll)('seed %i: every path lies inside one block, inside its sidewalk line; every lawn block has some', (_seed, c, q) => {
    const inners = q.blocks.map((k) => shrink(c.blocks[k].rect, c.config.sidewalk));
    const paths = pathsOf(q);
    const breaks = paths.flatMap((p) => p.points).filter((pt) => !inners.some((r) => inRect(r, pt, 0.01))).map(at);
    expect(breaks).toEqual([]);
    for (const k of roleBlocks(q, 'lawn')) expect(paths.some((p) => inRect(shrink(c.blocks[k].rect, c.config.sidewalk), p.points[1])), `lawn ${k}`).toBe(true);
  });

  it.each(withAll)('seed %i: trees stand off the paths, out of the lake, clear of every solid and building', (_seed, c, q) => {
    const lake = lakeWater(c, q);
    const paths = pathsOf(q);
    const trees = c.trees.filter((t) => inRect(q.bounds, t));
    expect(trees.length).toBeGreaterThan(q.blocks.length * 3);
    const solids = new FootprintIndex([...q.dressing.solids, ...c.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint)]);
    const breaks: string[] = [];
    for (const t of trees) {
      if (paths.some((p) => toPath(p.points, t.x, t.z) < p.width / 2 + 0.5)) breaks.push(`on a path at ${at(t)}`);
      if (shoreDistance(lake, t.x, t.z) > -1) breaks.push(`in the lake at ${at(t)}`);
      if (solids.hits({ x: t.x, z: t.z, hx: 0.5, hz: 0.5, yaw: 0 })) breaks.push(`on a solid at ${at(t)}`);
    }
    expect(breaks).toEqual([]);
  });

  it.each(withAll)('seed %i: gate pillars and open leaves at every gate, the name wall by the main one; lamps within the glow budget', (_seed, c, q) => {
    const gates = q.dressing.structures.filter((s) => s.kind === 'parkGate');
    expect(gates).toHaveLength(q.gates.length);
    for (const g of q.gates) {
      const s = gates.find((x) => Math.hypot(x.x - g.x, x.z - g.z) < 1e-6)!;
      expect(s.footprints).toHaveLength(4);
      // The opening stays clear: no footprint reaches into the roadway and sidewalk it spans.
      for (const f of s.footprints) expect(Math.abs((f.x - g.x) * Math.cos(g.yaw) - (f.z - g.z) * Math.sin(g.yaw)) - f.hx).toBeGreaterThan(g.opening / 2 - 0.1);
    }
    const wall = q.dressing.structures.filter((s) => s.kind === 'nameWall');
    expect(wall).toHaveLength(1);
    const main = mainGate(q);
    expect(Math.hypot(wall[0].x - main.x, wall[0].z - main.z)).toBeLessThan(20);
    expect(PARK_NAMES[q.dressing.extra!.name as number]).toBeDefined();
    expect(kinds(q, 'parkBoard')).toHaveLength(1);
    const lamps = c.streetProps.filter((p) => LIT_PROPS.has(p.kind) && inRect(q.bounds, p, 1)).length; // floodlights too
    expect(lamps + 2 * q.gates.length + MEGAPARK.bandstandBulbs).toBeLessThanOrEqual(MEGAPARK.maxGlow);
    expect(kinds(q, 'oilLamp').length).toBeGreaterThan(0);
  });

  it.each(withAll)('seed %i: lawns get beds, picnic tables and benches; a kiosk somewhere', (_seed, _c, q) => {
    expect(q.dressing.ground.filter((g) => g.kind === 'bed').length).toBeGreaterThanOrEqual(roleBlocks(q, 'lawn').length);
    expect(kinds(q, 'bench').length).toBeGreaterThan(2);
    if (roleBlocks(q, 'lawn').length) expect(kinds(q, 'picnicTable').length).toBeGreaterThan(0);
    expect(kinds(q, 'kiosk').length).toBeLessThanOrEqual(1);
  });
});
