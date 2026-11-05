// The Forest: dense woods on the island's edge, the one district cops can't cut through. Its
// streets stay streets; the blocks between them are woods (trees 3.4–6 m apart) with dirt tracks
// winding through most of them street to street, the way through a car can take and cops have to
// follow. Special blocks: a lumber yard by the main gate, a fire lookout in a clearing, a campsite.
// No street lamps inside (the darkest district), light traffic, pickups, no buses or trucks, fewer
// cops. Pure data; drawn by render/districts/Forest.ts.
import type { Rng } from '../../core/Rng';
import { FOREST } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { emptyDressing, feature, type BlockRole, type District, type DistrictDef, type DistrictDressing } from './District';
import { isJunctionControl } from './apply';
import { gateBlocks, mainGate, roleBlocks, streetSidesOf } from './Megapark';
import { shuffle } from './place';
import { layClearing, layTrack, layTrees, trackMouths, type Clearing, type Track } from './ForestWoods';
import type { StreetProp } from '../StreetProps';

/** The tracks a dressed forest laid. */
export const forestTracks = (q: District): Track[] => (q.dressing.extra?.tracks as Track[] | undefined) ?? [];
/** Its clearings (the lookout's, the campsite's). */
export const forestClearings = (q: District): Clearing[] => (q.dressing.extra?.clearings as Clearing[] | undefined) ?? [];

function roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole> {
  // Every block is open ground under the trees (grass now, the forest floor dressed over it; the park fences go).
  for (const k of q.blocks) city.blocks[k].park = true;
  const out = new Map<number, BlockRole>();
  const pool = [...q.blocks];
  shuffle(pool, rng);
  const gate = mainGate(q);
  // The lumber yard by the main gate (the log trucks' way out to town).
  if (feature(q, 'lumberyard', rng.next() < FOREST.lumberyardChance)) {
    const k = gateBlocks(q, city, gate).find((b) => pool.includes(b)) ?? pool[0];
    out.set(k, 'lumberyard');
  }
  // The lookout as deep in the woods as can be, the campsite anywhere else.
  // Both on a block a track can run through (two street sides).
  const free = () => pool.filter((k) => !out.has(k) && streetSidesOf(k, city).length >= 2);
  const far = (k: number) => Math.hypot(city.blocks[k].rect.x - gate.x, city.blocks[k].rect.z - gate.z);
  if (feature(q, 'lookout', rng.next() < FOREST.lookoutChance) && free().length) out.set(free().reduce((a, b) => (far(b) > far(a) + 1e-6 ? b : a)), 'lookout');
  if (feature(q, 'campsite', rng.next() < FOREST.campsiteChance) && free().length) out.set(free()[0], 'campsite');
  for (const k of pool) if (!out.has(k)) out.set(k, 'woods');
  return out;
}

/** No buildings yet (the sawmill and the ranger station come with the set pieces). */
function lots(_q: District, buildings: Building[]): void {
  buildings.length = 0; // every block has a role: nothing was filled
}

/** Street furniture that doesn't belong: lamps (it's dark in the woods), fences, umbrellas, benches, hydrants, bus stops (no buses). */
const drop = (p: StreetProp) =>
  p.kind === 'lamp' || p.kind === 'fence' || p.kind === 'umbrella' || p.kind === 'bench' || p.kind === 'hydrant' || (p.kind === 'sign' && p.variant === 'busStop');

const FOREST_STYLE = { lots: [1, 1] as [number, number], height: [3, 5] as [number, number], gap: [4, 8] as [number, number], empty: 1 };

export const FOREST_DEF: DistrictDef = {
  kind: 'forest',
  label: 'Forest',
  features: { lumberyard: 'bool', lookout: 'bool', campsite: 'bool' },
  built: (q) => ({
    lumberyard: roleBlocks(q, 'lumberyard').length > 0,
    lookout: roleBlocks(q, 'lookout').length > 0,
    campsite: roleBlocks(q, 'campsite').length > 0,
  }),
  salt: 0x6f0e57,
  chance: FOREST.chance,
  site: 'edge',
  shapes: [[2, 2], [2, 3], [3, 3], [3, 4], [4, 4]],
  rings: ['residential', 'industrial'],
  minShare: { 'residential+industrial': 0.5 },
  gates: 'all',
  buildingStyle: FOREST_STYLE,
  looks: {},
  roles,
  lots,
  drop,
  swap: {},
  keepZebras: false,
  traffic: { density: FOREST.density, heavy: false, weights: { Pickup: FOREST.pickupWeight } },
  copSpawnSkip: FOREST.copSpawnSkip,
  maxGlow: FOREST.maxGlow,
  softGround: { grip: FOREST.floorGrip, drag: FOREST.floorDrag },
  roadblockGates: true,
  mapColor: 0xb4d46a, // fresh needles: a dark pine green vanished on the park green its blocks draw as
  dress,
};

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  const sw = city.config.sidewalk;
  // The blocks' insides are the woods: the city's loose benches and the like go (never a junction control).
  const inners = q.blocks.map((k) => shrink(city.blocks[k].rect, sw));
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !inners.some((r) => inRect(r, p)));
  // The forest floor is soft (the tracks too: dirt).
  out.soft = [...inners];
  // Tracks: through most woods blocks, always through a special block's clearing; none in the yard.
  const tracks: Track[] = [];
  const clearings: Clearing[] = [];
  const open = new Set(roleBlocks(q, 'lumberyard'));
  for (const k of [...q.blocks].sort((a, b) => a - b)) {
    if (open.has(k)) continue;
    const role = q.roles.get(k);
    const special = role === 'lookout' || role === 'campsite';
    if (!special && rng.next() >= FOREST.trackChance) continue;
    const t = layTrack(k, city, rng);
    if (!t) continue;
    tracks.push(t);
    if (special) clearings.push(layClearing(t, city, rng));
  }
  // The track mouths: kerb clutter keeps off (never a junction control).
  const mouths: Rect[] = tracks.flatMap((t) => trackMouths(t, city));
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !mouths.some((m) => inRect(m, p, 0.5)));
  out.props.push(...layTrees(q, city, tracks, clearings, open, rng));
  // Cops route through the woods only along the tracks and across the clearings.
  const woods = q.blocks.filter((k) => !open.has(k)).map((k) => shrink(city.blocks[k].rect, sw));
  out.thicket = { rects: woods, paths: [...tracks.map((t) => ({ points: t.points, width: t.width })), ...clearings.map((c) => ({ points: [{ x: c.x, z: c.z }], width: c.r * 2 }))] };
  out.extra = { tracks, clearings };
  return out;
}

/** The woods blocks' inner rects (inside the sidewalk line). */
export const woodsRooms = (q: District, city: CityData): Rect[] => roleBlocks(q, 'woods').map((k) => shrink(city.blocks[k].rect, city.config.sidewalk));
