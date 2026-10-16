// Chinatown: an open, busy district behind paifang gates in the middle of the city. Shophouses
// along a main street, restaurants on the corners, small shops, a temple and sometimes a small
// square for the pagoda. Busy traffic rather than slow. Pure data; drawn by
// render/districts/Chinatown.ts.
import type { Rng } from '../../core/Rng';
import { CHINATOWN } from '../../gameplay/balance';
import type { Building, CityData } from '../CityGenerator';
import { LANDMARK_RADIUS, makeSquare, type Landmark } from '../Landmarks';
import { inRect } from '../lots';
import { keepOf } from '../driveSide';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp } from '../StreetProps';
import { inDistrict, isJunctionControl, kerbClutter } from './apply';
import { lanternStrings, paifangs, type LanternData } from './ChinatownGates';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook, type Overhead, type Structure } from './District';
import { groundHeight } from '../Terrain';

export type ChinatownLot = 'shophouse' | 'restaurant' | 'banquetHall' | 'teaHouse' | 'bubbleTea' | 'herbalShop' | 'bakery' | 'temple';

/** The small square's block, if the district has one. */
export function squareBlock(q: District): number | undefined {
  for (const [k, role] of q.roles) if (role === 'square') return k;
  return undefined;
}

function roles(q: District, _city: CityData, rng: Rng): Map<number, BlockRole> {
  if (rng.next() >= CHINATOWN.squareChance) return new Map();
  return new Map([[rng.pick(q.blocks), 'square']]);
}

/** Street-side bits for Building.street. */
export const SIDE = { pz: 1, nz: 2, px: 4, nx: 8 } as const;

/** Which sides of its block a building faces (its face on the block's sidewalk line), as Building.street bits. */
export function streetMask(b: Building, q: District, city: CityData): number {
  const r = q.blocks.map((k) => city.blocks[k].rect).find((br) => inRect(br, b));
  if (!r) return 0;
  const s = city.config.sidewalk;
  const near = (face: number, line: number) => Math.abs(face - line) <= 1;
  return (near(b.z + b.d / 2, r.z + r.d / 2 - s) ? SIDE.pz : 0) | (near(b.z - b.d / 2, r.z - r.d / 2 + s) ? SIDE.nz : 0) |
    (near(b.x + b.w / 2, r.x + r.w / 2 - s) ? SIDE.px : 0) | (near(b.x - b.w / 2, r.x - r.w / 2 + s) ? SIDE.nx : 0);
}

/** How many sides of its block a building faces. */
export function streetSides(b: Building, q: District, city: CityData): number {
  let m = streetMask(b, q, city), n = 0;
  for (; m; m &= m - 1) n++;
  return n;
}

/** Does a building front the main street (its face on the sidewalk line, beside one of its edges)? */
export function onMainStreet(b: Building, q: District, city: CityData): boolean {
  const reach = city.config.roadWidth / 2 + city.config.sidewalk + 1;
  return q.mainStreet.some((key) => {
    const [a, c] = key.split('>').map(Number);
    const A = city.graph.nodes[a];
    const B = city.graph.nodes[c];
    if (Math.abs(A.z - B.z) < 0.5) {
      return b.x > Math.min(A.x, B.x) && b.x < Math.max(A.x, B.x) && Math.abs(b.z - A.z) - b.d / 2 <= reach;
    }
    return b.z > Math.min(A.z, B.z) && b.z < Math.max(A.z, B.z) && Math.abs(b.x - A.x) - b.w / 2 <= reach;
  });
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  for (const b of buildings) {
    b.lot = 'shophouse';
    b.street = streetMask(b, q, city);
  }
  const facing = buildings.map((b) => ({ b, sides: streetSides(b, q, city), main: onMainStreet(b, q, city) }));
  // Restaurants: corners on the main street first, then the main street, then other corners.
  const rank = (f: (typeof facing)[number]) => (f.sides >= 2 ? 1 : 0) + (f.main ? 2 : 0);
  const fronting = shuffled(facing.filter((f) => f.sides > 0), rng).sort((u, v) => rank(v) - rank(u));
  const free = () => fronting.filter((f) => f.b.lot === 'shophouse');
  for (const f of free().slice(0, rng.int(CHINATOWN.restaurants[0], CHINATOWN.restaurants[1]))) f.b.lot = 'restaurant';
  // At most one banquet hall: the biggest lot left on the main street (or anywhere on a street).
  if (rng.next() < CHINATOWN.banquetChance) {
    const left = free();
    const pool = left.some((f) => f.main) ? left.filter((f) => f.main) : left;
    if (pool.length) pool.reduce((u, v) => (v.b.w * v.b.d > u.b.w * u.b.d ? v : u)).b.lot = 'banquetHall';
  }
  // At most one temple, off the main street where it can be.
  if (rng.next() < CHINATOWN.templeChance) {
    const left = free();
    const pool = left.some((f) => !f.main) ? left.filter((f) => !f.main) : left;
    if (pool.length) {
      const t = rng.pick(pool).b;
      t.lot = 'temple';
      t.h = Math.min(t.h, CHINATOWN.templeHeight); // a low hall under its pagoda cap
    }
  }
  // A few small shops among the street-front shophouses.
  for (const [kind, most] of Object.entries(CHINATOWN.shops)) {
    for (const f of shuffled(free(), rng).slice(0, rng.int(0, most))) f.b.lot = kind;
  }
}

/** Street furniture that doesn't suit the district (junction controls, hydrants and bus stops stay). */
const DROP_SIGNS = new Set(['noSmoking', 'children']);
const drop = (p: StreetProp) => p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'sign' && DROP_SIGNS.has(p.variant ?? ''));

export const CHINATOWN_DEF: DistrictDef = {
  kind: 'chinatown',
  label: 'Chinatown',
  salt: 0xc417a7,
  chance: CHINATOWN.chance,
  site: 'inland',
  shapes: [[2, 2], [3, 3], [4, 4]],
  rings: ['downtown', 'midtown', 'residential', 'industrial'], // any inner block; minCore keeps it central
  minCore: 0.5,
  gates: 'mainStreet',
  extraGates: 1,
  minMainStreet: 2,
  buildingStyle: { lots: [3, 4], height: [8, 20], gap: [0, 0.5], empty: 0 },
  looks: CHINATOWN_LOOKS(),
  roles,
  lots,
  drop,
  swap: { lamp: 'dragonLamp' },
  keepZebras: true,
  traffic: { speed: CHINATOWN.speed, speedOn: 'mainStreet', density: CHINATOWN.density, heavy: true, weights: { Van: CHINATOWN.vanWeight } },
  copSpawnSkip: 0,
  roadblockGates: true,
  mapColor: 0xc8423a,
  dress,
};

/** Shophouses over storefronts; restaurants, the banquet hall, the tea house and the temple under pagoda caps. */
function CHINATOWN_LOOKS(): Record<ChinatownLot, LotLook> {
  const pastel = [0xeec9c0, 0xc9dec8, 0xf2e2b0, 0xc8d9ea, 0xe8d0e2, 0xf3e8d2, 0xd8e8d0];
  const redGold = [0xb0302a, 0xa22a26, 0xc0392e, 0xc89a3a];
  const green = [0x2f7a55, 0x2a6e4c, 0x3a8a5e];
  const gold = [0xc9a23a, 0xb8902e];
  const shop = { facade: 'shophouse', ground: 'storefront' } as const;
  return {
    shophouse: { ...shop, roof: 'flat', palette: pastel, trims: ['colonnade', 'balcony'] },
    restaurant: { ...shop, roof: 'pagoda', palette: redGold, roofTiles: green, trims: ['balcony'] },
    banquetHall: { ...shop, roof: 'pagoda', palette: redGold, roofTiles: gold, trims: ['balcony'] },
    teaHouse: { ...shop, roof: 'pagoda', palette: [0x8a5a3a, 0x7a4e32, 0x9a6a46], roofTiles: green },
    bubbleTea: { ...shop, roof: 'flat', palette: [0xf4c6dc, 0xc6ecf0, 0xf6e6a8] },
    herbalShop: { ...shop, roof: 'flat', palette: [0xd8c8a0, 0xcdbd92, 0xe2d4b0] },
    bakery: { ...shop, roof: 'flat', palette: [0xf2dcb0, 0xf4e4c8, 0xf0d0a8] },
    temple: { ...shop, roof: 'pagoda', palette: [0xb0302a, 0xa82c28], roofTiles: gold, trims: ['colonnade'] },
  };
}

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  const props: StreetProp[] = [];
  // The small square: paved round a pagoda, a few stalls and mahjong tables about it.
  const sq = squareBlock(q);
  if (sq !== undefined) {
    const block = city.blocks[sq];
    const c = block.rect;
    const pagoda: Landmark = { kind: 'pagoda', x: c.x, z: c.z, yaw: rng.range(0, Math.PI * 2), radius: LANDMARK_RADIUS.pagoda, tiers: rng.int(3, 5) };
    ({ buildings: city.buildings, trees: city.trees } = makeSquare(block, pagoda, city.buildings, city.trees, city.config, false));
    out.landmarks.push(pagoda);
    const start = rng.range(0, Math.PI * 2);
    for (let i = 0; i < CHINATOWN.squareStalls; i++) {
      const a = start + (i / CHINATOWN.squareStalls) * Math.PI * 2;
      const r = rng.range(12, 17);
      const kind: PropKind = i % 3 === 2 ? 'mahjongTable' : 'produceStall';
      props.push({ kind, x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r, yaw: a + Math.PI, color: rng.pick(AWNINGS) });
    }
  }
  // Paifang and lions at the gates, lanterns across the streets.
  const gates = paifangs(q, city, rng);
  out.structures.push(...gates.structures);
  out.landmarks.push(...gates.landmarks);
  out.solids.push(...gates.solids);
  out.overhead.push(...gates.overhead);
  const built = city.buildings.filter((b) => b.district === 'chinatown' && inRect(q.bounds, b));
  out.overhead.push(...lanternStrings(q, city, built, gates.structures, rng));

  // An incense burner on the sidewalk before the temple.
  const s = city.config.sidewalk;
  const temple = built.find((b) => b.lot === 'temple');
  if (temple) {
    const [nx, nz] = ([[0, 1, 1], [0, -1, 2], [1, 0, 4], [-1, 0, 8]] as const).find(([, , bit]) => (temple.street ?? 0) & bit) ?? [0, 1];
    const x = temple.x + nx * (temple.w / 2 + s / 2), z = temple.z + nz * (temple.d / 2 + s / 2);
    out.landmarks.push({ kind: 'incense', x, z, yaw: Math.atan2(nx, nz), radius: LANDMARK_RADIUS.incense });
  }

  // Street furniture under a column, a lion or the burner goes (junction controls never stand
  // there); the dragon lamps on the main street carry lucky-character banners.
  const solid: Footprint[] = [...out.solids, ...out.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: l.yaw }))];
  // A landmark that would stand on a junction control moves out of the way: drop it instead.
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.2));
  out.landmarks = out.landmarks.filter((l) => l.kind !== 'incense' || !controls.some((f) => footprintsOverlap(f, { x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 })));
  let banner = 0;
  city.streetProps = city.streetProps.flatMap((p) => {
    if (!inDistrict(q, p) || isJunctionControl(p)) return [p];
    if (solid.some((f) => footprintsOverlap(propFootprint(p, 0.2), f))) return [];
    if (p.kind === 'dragonLamp' && onMainStreetSidewalk(p, q, city)) return [{ ...p, banner: banner++ % 2 ? 'chun' as const : 'fu' as const }];
    return [p];
  });

  // Delivery vans double-parked outside main-street restaurants, in the kerb lane.
  const blocked = (p: StreetProp, others: StreetProp[]) => {
    const fp = propFootprint(p, p.kind === 'parkedVan' ? 0.1 : 0.3);
    return solid.some((f) => footprintsOverlap(fp, f)) || others.some((o) => footprintsOverlap(fp, propFootprint(o)));
  };
  const vans = parkedVans(q, city, built, rng).filter((v, i, all) => !blocked(v, [...city.streetProps.filter((p) => inDistrict(q, p)), ...all.slice(0, i)]));
  const kept: StreetProp[] = [...vans];
  for (const p of props) if (!blocked(p, [...city.streetProps.filter((o) => inRect(q.bounds, o, 2)), ...kept])) kept.push(p);

  // Kerb clutter: stalls on the main street's sidewalks, crates and menu boards on the side streets.
  const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
  const side = new Set([...q.streets].filter((k) => !main.has(k)));
  const around = { ...city, streetProps: [...city.streetProps, ...kept] };
  const stalls = kerbClutter({ ...q, streets: main }, around, MAIN_CLUTTER, rng, { step: [7, 12] }).map((p) => faceStreet(p, q, city));
  const crates = kerbClutter({ ...q, streets: side }, { ...around, streetProps: [...around.streetProps, ...stalls] }, SIDE_CLUTTER, rng);
  const clutter = [...stalls, ...crates].filter((p) => !blocked(p, []) && !built.some((b) => footprintsOverlap(propFootprint(p), rectFootprint(b))));
  out.props = [...kept, ...clutter];

  // Night-only extras, drawn last on the district's stream so nothing above moves.
  out.extra = nightExtras(q, city, built, gates.structures, out, solid, rng) as unknown as Record<string, unknown>;
  return out;
}

/** A string of bare bulbs swagged along a shopfront (Chinatown's night market). */
export interface BulbString {
  a: { x: number; z: number };
  b: { x: number; z: number };
  ya: number; // tie heights, world
  yb: number;
  sag: number;
  n: number; // bulbs on it
}

/** Chinatown's dressing.extra: what only shows at night. */
export interface ChinatownExtra {
  /** Lunar New Year (CHINATOWN.festivalChance per seed). */
  festival: boolean;
  /** Night-market stalls (and on a festival seed the lion dance and dragon float): street props only at night. */
  nightProps: StreetProp[];
  bulbs: BulbString[];
  /** The festival's extra lantern strings, between the everyday ones on the main street. */
  festivalStrings: Overhead[];
  /** Where the festival's fireworks burst over (the pagoda, else the main street's middle). */
  fireworks?: { x: number; z: number };
}

export const chinatownExtra = (q: District): ChinatownExtra | undefined => q.dressing.extra as unknown as ChinatownExtra | undefined;

/** Lanterns on a set of strings. */
export const lanternCount = (strings: Overhead[]) => strings.reduce((n, o) => n + (o.data as unknown as LanternData).at.length, 0);

const NIGHT_STALLS: PropKind[] = ['produceStall', 'produceStall', 'dimSumCart', 'lanternStand', 'produceStall', 'menuBoard'];

/**
 * The festival roll, its lanterns, lion dance, dragon float and fireworks spot; then the night
 * market: more stalls on the main street's sidewalks and bulb strings along its shopfronts. Lanterns
 * and bulbs together stay within CHINATOWN.maxGlow (festival strings, then bulb strings, are left out
 * past it).
 */
function nightExtras(q: District, city: CityData, built: Building[], paifang: Structure[], out: DistrictDressing, solid: Footprint[], rng: Rng): ChinatownExtra {
  const { roadWidth: rw, sidewalk: s } = city.config;
  const festival = rng.next() < CHINATOWN.festivalChance;
  let glow = lanternCount(out.overhead.filter((o) => o.kind === 'lanterns'));
  const festivalStrings: Overhead[] = [];
  const nightProps: StreetProp[] = [];
  const taken = () => [...city.streetProps.filter((p) => inRect(q.bounds, p, 2)), ...out.props, ...nightProps].map((p) => propFootprint(p, 0.3));
  const free = (p: StreetProp) => {
    const fp = propFootprint(p, 0.2);
    return !solid.some((f) => footprintsOverlap(fp, f)) && !taken().some((f) => footprintsOverlap(fp, f)) && !built.some((b) => footprintsOverlap(fp, rectFootprint(b)));
  };
  let fireworks: ChinatownExtra['fireworks'];
  // The festival pieces stand wholly off the road.
  const roads = [...city.roads.map((r) => rectFootprint(r.rect)), ...city.intersections.map(rectFootprint)];
  const offRoad = (p: StreetProp) => free(p) && !roads.some((r) => footprintsOverlap(propFootprint(p, 0.2), r));
  if (festival) {
    for (const o of lanternStrings(q, city, built, paifang, rng, { festival: true })) {
      const n = lanternCount([o]);
      if (glow + n > CHINATOWN.maxGlow) break;
      festivalStrings.push(o);
      glow += n;
    }
    // The lion dance and the dragon float on the square, round the pagoda, along its circle.
    const pagoda = out.landmarks.find((l) => l.kind === 'pagoda');
    if (pagoda) {
      fireworks = { x: pagoda.x, z: pagoda.z };
      const start = rng.range(0, Math.PI * 2);
      for (const kind of ['dragonFloat', 'lionDance'] as const) {
        for (let k = 0; k < 12; k++) {
          const a = start + (k / 12) * Math.PI * 2 + (kind === 'lionDance' ? Math.PI : 0);
          const r = pagoda.radius + 4.5;
          const p: StreetProp = { kind, x: pagoda.x + Math.sin(a) * r, z: pagoda.z + Math.cos(a) * r, yaw: a + Math.PI / 2 };
          if (!offRoad(p)) continue;
          nightProps.push(p);
          break;
        }
      }
    } else {
      // No square: the lion dance performs on a main-street sidewalk, the fireworks over the street.
      const [a] = q.mainStreet[Math.floor(q.mainStreet.length / 2)].split('>').map(Number);
      fireworks = { x: city.graph.nodes[a].x, z: city.graph.nodes[a].z };
      const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
      const around = { ...city, streetProps: [...city.streetProps, ...out.props] };
      const lion = kerbClutter({ ...q, streets: main }, around, ['lionDance'], rng, { step: [15, 30] }).map((p) => faceStreet(p, q, city)).find(offRoad);
      if (lion) nightProps.push({ ...lion, color: undefined });
    }
  }

  // The night market: stalls between the day's on the main street's sidewalks.
  const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
  const around = { ...city, streetProps: [...city.streetProps, ...out.props, ...nightProps] };
  for (const p of kerbClutter({ ...q, streets: main }, around, NIGHT_STALLS, rng, { step: CHINATOWN.nightStalls })) {
    const stall = faceStreet(p, q, city);
    if (free(stall)) nightProps.push(stall);
  }

  // Bulb strings swagged along the main street's shopfronts, tied where a building fronts it.
  const bulbs: BulbString[] = [];
  const line = rw / 2 + s - 0.5; // just off the building line
  const fronts = (x: number, z: number) => built.some((b) => b.h >= CHINATOWN.bulbHeight + 1 && Math.abs(x - b.x) <= b.w / 2 + 0.8 && Math.abs(z - b.z) <= b.d / 2 + 0.8);
  for (const key of q.mainStreet) {
    const [ia, ib] = key.split('>').map(Number);
    const A = city.graph.nodes[ia], B = city.graph.nodes[ib];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const t0 = rw / 2 + s + 1, t1 = len - rw / 2 - s - 1;
    const spans = Math.max(1, Math.round((t1 - t0) / CHINATOWN.bulbSpan));
    const step = (t1 - t0) / spans;
    for (const side of [-1, 1]) {
      const at = (t: number, lateral: number) => ({ x: A.x + dx * t - dz * lateral * side, z: A.z + dz * t + dx * lateral * side });
      for (let k = 0; k < spans; k++) {
        const a = at(t0 + k * step, line), b = at(t0 + (k + 1) * step, line);
        const ta = at(t0 + k * step, line + 1), tb = at(t0 + (k + 1) * step, line + 1); // the walls they tie to
        if (!fronts(ta.x, ta.z) || !fronts(tb.x, tb.z)) continue;
        const n = Math.max(2, Math.round(step / CHINATOWN.bulbSpacing));
        if (glow + n > CHINATOWN.maxGlow) continue;
        glow += n;
        const h = (p: { x: number; z: number }) => groundHeight(city.terrain, p.x, p.z) + CHINATOWN.bulbHeight;
        bulbs.push({ a, b, ya: h(a), yb: h(b), sag: CHINATOWN.bulbSag, n });
      }
    }
  }
  return { festival, nightProps, bulbs, festivalStrings, fireworks };
}

const AWNINGS = [0xc8302a, 0x2f7a55, 0xd8a637, 0x2f5f80, 0xe8e0cc, 0xd86a2a];
/** Main-street sidewalks: market stalls. Side streets: crates, menu boards, the odd firecracker crate. */
const MAIN_CLUTTER: PropKind[] = ['produceStall', 'produceStall', 'lanternStand', 'dimSumCart', 'menuBoard'];
const SIDE_CLUTTER: PropKind[] = [
  ...Array<PropKind>(6).fill('fishCrate'), ...Array<PropKind>(3).fill('menuBoard'), ...Array<PropKind>(3).fill('mahjongTable'), 'firecrackerCrate',
];

/** Turn a stall to face the street it stands beside (its front, +Z, towards the centre line). */
function faceStreet(p: StreetProp, q: District, city: CityData): StreetProp {
  let best = { d: Infinity, yaw: p.yaw };
  for (const key of q.streets) {
    const [a, b] = key.split('>').map(Number);
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const t = Math.max(0, Math.min(len, ((p.x - A.x) * (B.x - A.x) + (p.z - A.z) * (B.z - A.z)) / len));
    const cx = A.x + ((B.x - A.x) * t) / len, cz = A.z + ((B.z - A.z) * t) / len;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d < best.d) best = { d, yaw: Math.atan2(cx - p.x, cz - p.z) };
  }
  // Snap to the street's axis, so it stands square to the kerb.
  const yaw = Math.round(best.yaw / (Math.PI / 2)) * (Math.PI / 2);
  return { ...p, yaw, color: AWNINGS[Math.floor(Math.abs(p.x * 7 + p.z * 13)) % AWNINGS.length] };
}

/**
 * 1–3 vans parked at the kerb outside main-street restaurants (other main-street lots if there are
 * none), facing the way that lane runs, at least CHINATOWN.vanGap from any junction mouth or gate.
 */
function parkedVans(q: District, city: CityData, built: Building[], rng: Rng): StreetProp[] {
  const { roadWidth: rw } = city.config;
  const kerbside = city.streetProps.filter((p) => inRect(q.bounds, p, 2));
  const keep = keepOf(city.driveSide);
  const gates = q.gates.map((g) => ({ x: g.x, z: g.z }));
  const front = shuffled(built.filter((b) => onMainStreet(b, q, city)), rng);
  // Restaurants first, then any other main-street lot.
  const pool = [...front.filter((b) => b.lot === 'restaurant'), ...front.filter((b) => b.lot !== 'restaurant')];
  const out: StreetProp[] = [];
  const want = rng.int(CHINATOWN.vans[0], CHINATOWN.vans[1]);
  for (const b of pool) {
    if (out.length >= want) break;
    for (const key of q.mainStreet) {
      const [a, c] = key.split('>').map(Number);
      const A = city.graph.nodes[a], B = city.graph.nodes[c];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
      // Outside the lot's frontage, kept the gap from the junction mouths at either end.
      const half = Math.abs(dx) * b.w / 2 + Math.abs(dz) * b.d / 2;
      const tc = (b.x - A.x) * dx + (b.z - A.z) * dz;
      const lo = rw / 2 + CHINATOWN.vanGap + 2.5, hi = len - rw / 2 - CHINATOWN.vanGap - 2.5; // the van's half length
      const off = (b.x - A.x) * -dz + (b.z - A.z) * dx; // which side of the street the lot is on
      if (lo > hi || Math.abs(off) > rw / 2 + city.config.sidewalk + b.w + b.d) continue;
      const side = Math.sign(off);
      const n = { x: -dz * side, z: dx * side }; // from the centre line towards the lot
      // Tight to the kerb, up on it a little: every vehicle in the lane clears it, the widest bus included.
      const lateral = rw / 2 - VAN_HALF_WIDTH + CHINATOWN.vanOnKerb;
      // Facing the way traffic in that lane runs: its kerb side is towards the lot.
      const d = keep > 0 ? { x: n.z, z: -n.x } : { x: -n.z, z: n.x };
      // Along the lot's frontage, nearest its middle, where no lamp or hydrant stands in the way.
      const spots = [0, -1, 1, -2, 2, -3, 3].map((k) => Math.max(lo, Math.min(hi, tc + k * 1.5))).filter((t) => Math.abs(t - tc) <= half);
      const van = spots
        .map((t): StreetProp => ({ kind: 'parkedVan', x: A.x + dx * t + n.x * lateral, z: A.z + dz * t + n.z * lateral, yaw: Math.atan2(d.x, d.z) }))
        .find((v) => !gates.some((g) => Math.hypot(g.x - v.x, g.z - v.z) < CHINATOWN.vanGap) &&
          !out.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < 12) &&
          !kerbside.some((o) => footprintsOverlap(propFootprint(v, 0.1), propFootprint(o))));
      if (!van) continue;
      out.push({ ...van, color: rng.pick(VAN_COLOURS) });
      break;
    }
  }
  return out;
}

const VAN_HALF_WIDTH = 1.0;
const VAN_COLOURS = [0xf2f2ee, 0xe8e8e2, 0xc8302a, 0x2f5f80, 0xd8c8a0];

/** On a sidewalk beside the main street (not its junctions). */
function onMainStreetSidewalk(p: { x: number; z: number }, q: District, city: CityData): boolean {
  const reach = city.config.roadWidth / 2 + city.config.sidewalk;
  return q.mainStreet.some((key) => {
    const [a, b] = key.split('>').map(Number);
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const t = ((p.x - A.x) * (B.x - A.x) + (p.z - A.z) * (B.z - A.z)) / len;
    const off = Math.abs((p.x - A.x) * (B.z - A.z) - (p.z - A.z) * (B.x - A.x)) / len;
    return t > reach && t < len - reach && off <= reach;
  });
}
