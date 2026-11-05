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
import type { StreetProp } from '../StreetProps';
import { groundHeight } from '../Terrain';
import type { ShallowWater } from '../Water';
import { emptyDressing, feature, type BlockRole, type District, type DistrictDef, type DistrictDressing } from './District';
import { isJunctionControl } from './apply';
import { gateBlocks, mainGate, roleBlocks } from './Megapark';
import { layPools, layWitchPool, poolArea } from './SwampPools';
import { layWitch } from './SwampWitch';
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

function lots(_q: District, buildings: Building[]): void {
  buildings.length = 0; // every block has a role: nothing was filled (the shacks and the bait shop come with the landing)
}

/** Street furniture that doesn't belong: picket fences, beach umbrellas, bus stops (no buses). */
const drop = (p: StreetProp) => p.kind === 'fence' || p.kind === 'umbrella' || (p.kind === 'sign' && p.variant === 'busStop');

const SWAMP_STYLE = { lots: [1, 1] as [number, number], height: [3, 5] as [number, number], gap: [4, 8] as [number, number], empty: 1 };

export const SWAMP_DEF: DistrictDef = {
  kind: 'swamp',
  label: 'Swamp',
  features: { look: SWAMP_LOOKS_LIST, wisps: 'bool' },
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
  looks: {},
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
    city.water.push(...layPools(shrink(city.blocks[k].rect, sw), q.roles.get(k) === 'landing' ? lo : rng.range(lo, hi), poolArea(witch) * 0.95, rng));
  }
  // The witch house on its island, the boardwalk out to it.
  const house = layWitch(city, witchK, witchInner, witch, rng);
  out.structures.push(...house.structures);
  out.solids.push(...house.solids);
  out.decks = house.decks;
  out.props.push(...house.props);
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !inRect(house.mouth, p, 0.5));
  const wisps = feature(q, 'wisps', rng.next() < SWAMP.wispChance);
  out.extra = { look, wisps };
  return out;
}
