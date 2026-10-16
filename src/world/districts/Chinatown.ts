// Chinatown: an open, busy district behind paifang gates in the middle of the city. Shophouses
// along a main street, restaurants on the corners, small shops, a temple and sometimes a small
// square for the pagoda. Busy traffic rather than slow. Pure data; drawn by
// render/districts/Chinatown.ts.
import type { Rng } from '../../core/Rng';
import { CHINATOWN } from '../../gameplay/balance';
import type { Building, CityData } from '../CityGenerator';
import { LANDMARK_RADIUS, makeSquare, type Landmark } from '../Landmarks';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint, type Footprint, type StreetProp } from '../StreetProps';
import { inDistrict, isJunctionControl } from './apply';
import { lanternStrings, paifangs } from './ChinatownGates';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook } from './District';

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

/** How many sides of its block a building faces (its face on the block's sidewalk line). */
export function streetSides(b: Building, q: District, city: CityData): number {
  const r = q.blocks.map((k) => city.blocks[k].rect).find((br) => inRect(br, b));
  if (!r) return 0;
  const s = city.config.sidewalk;
  const near = (face: number, line: number) => Math.abs(face - line) <= 1;
  return [
    near(b.x - b.w / 2, r.x - r.w / 2 + s), near(b.x + b.w / 2, r.x + r.w / 2 - s),
    near(b.z - b.d / 2, r.z - r.d / 2 + s), near(b.z + b.d / 2, r.z + r.d / 2 - s),
  ].filter(Boolean).length;
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
  for (const b of buildings) b.lot = 'shophouse';
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
    if (pool.length) rng.pick(pool).b.lot = 'temple';
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

/** Looks on the existing facades for now; the shophouse and storefront styles and the pagoda roof come in CT3. */
function CHINATOWN_LOOKS(): Record<ChinatownLot, LotLook> {
  const pastel = [0xeec9c0, 0xc9dec8, 0xf2e2b0, 0xc8d9ea, 0xe8d0e2, 0xf3e8d2, 0xd8e8d0];
  const redGold = [0xb0302a, 0xa22a26, 0xc0392e, 0xb8862e];
  const wood = [0x7a4e32, 0x6e4430, 0x8a5a3a];
  return {
    shophouse: { facade: 'shutters', roof: 'flat', palette: pastel },
    restaurant: { facade: 'stucco', roof: 'flat', palette: redGold },
    banquetHall: { facade: 'stucco', roof: 'flat', palette: redGold },
    teaHouse: { facade: 'shutters', roof: 'flat', palette: wood },
    bubbleTea: { facade: 'stucco', roof: 'flat', palette: [0xf4c6dc, 0xc6ecf0, 0xf6e6a8] },
    herbalShop: { facade: 'shutters', roof: 'flat', palette: [0xd8c8a0, 0xc8b890] },
    bakery: { facade: 'stucco', roof: 'flat', palette: [0xf2dcb0, 0xf4e4c8] },
    temple: { facade: 'stucco', roof: 'flat', palette: [0xb0302a, 0xa82c28] },
  };
}

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  // The small square: paved round a fountain (the pagoda takes its place in CT3).
  const sq = squareBlock(q);
  if (sq !== undefined) {
    const block = city.blocks[sq];
    const centre: Landmark = { kind: 'fountain', x: block.rect.x, z: block.rect.z, yaw: 0, radius: LANDMARK_RADIUS.fountain };
    ({ buildings: city.buildings, trees: city.trees } = makeSquare(block, centre, city.buildings, city.trees, city.config, false));
    out.landmarks.push(centre);
  }
  // Paifang and lions at the gates, lanterns across the streets.
  const gates = paifangs(q, city, rng);
  out.structures.push(...gates.structures);
  out.landmarks.push(...gates.landmarks);
  out.solids.push(...gates.solids);
  out.overhead.push(...gates.overhead);
  const built = city.buildings.filter((b) => b.district === 'chinatown' && inRect(q.bounds, b));
  out.overhead.push(...lanternStrings(q, city, built, gates.structures, rng));

  // Street furniture under a column or a lion goes (junction controls never stand there); the
  // dragon lamps on the main street carry lucky-character banners.
  const solid: Footprint[] = [...out.solids, ...gates.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: l.yaw }))];
  let banner = 0;
  city.streetProps = city.streetProps.flatMap((p) => {
    if (!inDistrict(q, p) || isJunctionControl(p)) return [p];
    if (solid.some((f) => footprintsOverlap(propFootprint(p, 0.2), f))) return [];
    if (p.kind === 'dragonLamp' && onMainStreetSidewalk(p, q, city)) return [{ ...p, banner: banner++ % 2 ? 'chun' as const : 'fu' as const }];
    return [p];
  });
  return out;
}

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
