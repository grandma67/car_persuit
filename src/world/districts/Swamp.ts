// The Swamp: low wet ground on the island's edge. Its streets stay streets (causeways between the
// pools); the blocks between them are shallow pools over 40–70 % of the ground with muddy banks
// round them. One block holds the witch house on its island in the biggest pool (the signature),
// one by the main gate the landing (jetty, airboat, bait shop), the rest pools. Two looks: the
// wooded swamp (cypress, moss, dark water) or the open reed marsh (wider pools). Light traffic,
// pickups, no buses or trucks, fewer cops. Pure data; drawn by render/districts/Swamp.ts.
import type { Rng } from '../../core/Rng';
import { SWAMP } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { groundHeight } from '../Terrain';
import type { ShallowWater } from '../Water';
import { emptyDressing, feature, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook } from './District';
import { isJunctionControl } from './apply';
import { edgeLot, frontMask, gateBlocks, mainGate, roleBlocks, SIDES, streetSidesOf, type Side } from './Megapark';
import { layPools, layWitchPool, poolArea } from './SwampPools';
import { layWitch } from './SwampWitch';
import { layBoardwalks, layLanding } from './SwampSet';
import { swampStreets } from './SwampStreet';
import { layWoods } from './SwampWoods';
import { clearOf } from './HarborYard';
import { propFootprint, rectFootprint, type StreetProp } from '../StreetProps';
import { shuffle } from './place';

export type SwampLook = 'swamp' | 'marsh';
export const SWAMP_LOOKS_LIST = ['swamp', 'marsh'] as const;

/** The look a placed swamp rolled (or was pinned). */
export const swampLook = (q: District): SwampLook => (q.features.look as SwampLook | undefined) ?? 'swamp';

/** The ground under it varies by no more than SWAMP.maxRise (the hill's flank is no swamp). */
export function swampFits(bounds: Rect, city: CityData): string | undefined {
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a <= 8; a++) {
    for (let b = 0; b <= 8; b++) {
      const h = groundHeight(city.terrain, bounds.x + bounds.w * (a / 8 - 0.5), bounds.z + bounds.d * (b / 8 - 0.5));
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return hi - lo > SWAMP.maxRise ? `swamp: the ground rises ${(hi - lo).toFixed(1)} m (at most ${SWAMP.maxRise})` : undefined;
}

/** The pools of a placed swamp, as the city's water holds them. */
export const swampPools = (city: CityData, q: District): ShallowWater[] => city.water.filter((w) => w.kind === 'pool' && inRect(q.bounds, w));

/** The witch house's pool: the one in its block. */
export function witchPool(city: CityData, q: District): ShallowWater | undefined {
  const k = roleBlocks(q, 'witch')[0];
  return k === undefined ? undefined : swampPools(city, q).find((w) => inRect(city.blocks[k].rect, w));
}

function roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole> {
  feature(q, 'look', rng.next() < SWAMP.swampChance ? 'swamp' : 'marsh');
  // Every block is open ground (grass now, mud and reeds dressed over it; the city's park fences go).
  for (const k of q.blocks) city.blocks[k].park = true;
  const out = new Map<number, BlockRole>();
  const pool = [...q.blocks];
  shuffle(pool, rng);
  // The landing by the main gate (the way in from town), the witch house as far from it as can be.
  const gate = mainGate(q);
  const landing = gateBlocks(q, city, gate).find((k) => pool.includes(k)) ?? pool[0];
  out.set(landing, 'landing');
  const far = (k: number) => Math.hypot(city.blocks[k].rect.x - gate.x, city.blocks[k].rect.z - gate.z);
  const witch = pool.filter((k) => k !== landing).reduce((a, b) => (far(b) > far(a) + 1e-6 ? b : a));
  out.set(witch, 'witch');
  for (const k of pool) if (!out.has(k)) out.set(k, 'pools');
  return out;
}

/** A stilt shack or the bait shop. */
export type SwampLot = 'shack' | 'baitShop';

/**
 * The buildings: the bait shop on the landing's street side towards the main gate's street, one or
 * two stilt shacks on the street sides of each pool block (clear of the corners). The witch's
 * block has none.
 */
function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  buildings.length = 0; // every block has a role: nothing was filled
  const sw = city.config.sidewalk;
  const make = (r: Rect, k: number, lot: SwampLot, h: number): Building => ({ ...r, h, zone: city.blocks[k].zone, variant: rng.next(), district: 'swamp', lot });
  // The bait shop faces the main gate's street.
  const [landing] = roleBlocks(q, 'landing');
  const gate = mainGate(q);
  const inner = shrink(city.blocks[landing].rect, sw);
  const sides = streetSidesOf(landing, city);
  const toward = (s: Side) => s.nx * (gate.x - inner.x) + s.nz * (gate.z - inner.z);
  const shopSide = sides.reduce((a, b) => (toward(b) > toward(a) ? b : a), sides[0] ?? SIDES[0]);
  buildings.push(make(edgeLot(inner, shopSide, SWAMP.baitShop.size, 0, SWAMP.lotInset), landing, 'baitShop', SWAMP.baitShop.h));
  // Shacks on the pool blocks' street sides.
  for (const k of [...roleBlocks(q, 'pools')].sort((a, b) => a - b)) {
    const room = shrink(city.blocks[k].rect, sw);
    const free = streetSidesOf(k, city);
    shuffle(free, rng);
    const n = Math.min(free.length, rng.int(SWAMP.shacks[0], SWAMP.shacks[1]));
    for (const side of free.slice(0, n)) {
      const long = rng.range(SWAMP.shack.long[0], SWAMP.shack.long[1]), short = rng.range(SWAMP.shack.short[0], SWAMP.shack.short[1]);
      const span = (side.nx ? room.d : room.w) / 2 - long / 2 - 7; // clear of the corners
      const r = edgeLot(room, side, [long, short], rng.range(-span, span), SWAMP.lotInset);
      if (buildings.some((b) => Math.abs(b.x - r.x) < (b.w + r.w) / 2 + 2 && Math.abs(b.z - r.z) < (b.d + r.d) / 2 + 2)) continue;
      buildings.push(make(r, k, 'shack', rng.range(SWAMP.shack.h[0], SWAMP.shack.h[1])));
    }
  }
  for (const b of buildings) b.street = frontMask(b, city);
}

/** Weathered clapboard shacks on stilts in greys and faded greens, tin roofs; the bait shop in faded blue with a porch. */
function SWAMP_LOOKS(): Record<SwampLot, LotLook> {
  const tin = [0x6a6e6a, 0x7a5a4a, 0x5a6458, 0x8a6a4a];
  return {
    shack: { facade: 'siding', roof: 'monopitch', roofAlt: 'gable', palette: [0x9a9488, 0x8a9a84, 0xa49a88, 0x7e8a86], roofTiles: tin, trims: ['stilts'] },
    baitShop: { facade: 'siding', ground: 'storefront', roof: 'gable', palette: [0x8aa4b4, 0xa4b4a8, 0xc4b89a], roofTiles: tin, trims: ['porch'] },
  };
}

/** Street furniture that doesn't belong: picket fences, beach umbrellas, bus stops (no buses). */
const drop = (p: StreetProp) => p.kind === 'fence' || p.kind === 'umbrella' || (p.kind === 'sign' && p.variant === 'busStop');

const SWAMP_STYLE = { lots: [1, 1] as [number, number], height: [3, 5] as [number, number], gap: [4, 8] as [number, number], empty: 1 };

export const SWAMP_DEF: DistrictDef = {
  kind: 'swamp',
  label: 'Swamp',
  features: { look: SWAMP_LOOKS_LIST, wisps: 'bool', boardwalks: 'int', airboat: 'bool' },
  built: (q) => ({
    boardwalks: (q.dressing.extra?.boardwalks as number | undefined) ?? 0,
    airboat: q.dressing.structures.some((s) => s.kind === 'airboat'),
  }),
  nightFeatures: ['wisps'],
  salt: 0x2b7d51,
  chance: SWAMP.chance,
  site: 'edge',
  shapes: [[2, 2], [2, 3], [3, 3]],
  rings: ['residential', 'industrial'],
  minShare: { 'residential+industrial': 0.5 },
  fits: swampFits,
  gates: 'all',
  buildingStyle: SWAMP_STYLE,
  looks: SWAMP_LOOKS(),
  roles,
  lots,
  drop,
  swap: { lamp: 'woodLamp' },
  keepZebras: false,
  traffic: { density: SWAMP.density, heavy: false, weights: { Pickup: SWAMP.pickupWeight } },
  copSpawnSkip: SWAMP.copSpawnSkip,
  maxGlow: SWAMP.maxGlow,
  softGround: { grip: SWAMP.mudGrip, drag: SWAMP.mudDrag },
  roadblockGates: true,
  mapColor: 0x4e5e3a,
  dress,
};

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  const sw = city.config.sidewalk;
  const look = swampLook(q);
  // The blocks' insides are the swamp's own: the city's loose benches and the like go (never a junction control).
  const inners = q.blocks.map((k) => shrink(city.blocks[k].rect, sw));
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !inners.some((r) => inRect(r, p)));
  // The banks are mud (the water's own drag wins inside a pool).
  out.soft = [...inners];
  // The witch house's pool first (the biggest), then the others block by block in grid order.
  const witchK = roleBlocks(q, 'witch')[0];
  const witchInner = shrink(city.blocks[witchK].rect, sw);
  const witch = layWitchPool(witchInner, rng);
  city.water.push(witch);
  for (const k of [...q.blocks].sort((a, b) => a - b)) {
    if (k === witchK) continue;
    const [lo, hi] = SWAMP.cover[look];
    const landing = q.roles.get(k) === 'landing';
    city.water.push(...layPools(shrink(city.blocks[k].rect, sw), landing ? lo : rng.range(lo, hi), poolArea(witch) * 0.95, rng, landing));
  }
  // The witch house on its island, the boardwalk out to it.
  const house = layWitch(city, witchK, witchInner, witch, rng);
  out.structures.push(...house.structures);
  out.solids.push(...house.solids);
  out.decks = [...house.decks];
  out.props.push(...house.props);
  const wisps = feature(q, 'wisps', rng.next() < SWAMP.wispChance);
  // Boardwalks across pool blocks, street to street, clear of the shacks.
  const buildings = city.buildings.filter((b) => b.district === 'swamp' && inRect(q.bounds, b));
  const walks = layBoardwalks(q, city, swampPools(city, q), buildings, feature(q, 'boardwalks', rng.int(SWAMP.boardwalks[0], SWAMP.boardwalks[1])), rng);
  out.decks.push(...walks.decks);
  const mouths = [house.mouth, ...walks.mouths];
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !mouths.some((m) => inRect(m, p, 0.5)));
  // The landing behind the bait shop: the jetty, an airboat and a rowboat.
  const [landingK] = roleBlocks(q, 'landing');
  const shop = buildings.find((b) => b.lot === 'baitShop')!;
  const landing = layLanding(shop, shrink(city.blocks[landingK].rect, sw), swampPools(city, q), feature(q, 'airboat', rng.next() < SWAMP.airboatChance), rng);
  out.structures.push(...landing.structures);
  out.solids.push(...landing.solids);
  // The causeways: muddy verges, guard rails, one lamp a junction, the bog signs.
  const street = swampStreets(q, city, mouths, out.solids, rng);
  out.ground.push(...street.ground);
  out.soft.push(...street.soft);
  // The growth: trees, snags, reeds, logs, lily pads (last: it fills round everything else).
  const deckFootprints = out.decks.map((d) => ({ x: d.x, z: d.z, hx: d.hx, hz: d.hz, yaw: d.yaw }));
  const woods = layWoods(q, city, look, swampPools(city, q), [...out.solids, ...deckFootprints.map((f) => ({ ...f, hx: f.hx + 0.6 })), ...buildings.map(rectFootprint)], rng);
  out.structures.push(...woods.structures);
  out.solids.push(...woods.solids);
  city.parkPieces.push(...woods.pieces);
  // Props clear of the solids, the decks, the buildings, the junction controls and each other (what must exist first).
  const controls = city.streetProps.filter((p) => inRect(q.bounds, p, 2) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  out.props = clearOf([...out.props, ...walks.props, ...street.props, ...woods.props], [...out.solids, ...deckFootprints, ...controls, ...buildings.map(rectFootprint)],
    city.streetProps.filter((p) => inRect(q.bounds, p, 2)).map((p) => propFootprint(p, 0.1)));
  out.extra = { look, wisps, boardwalks: walks.decks.length };
  return out;
}
