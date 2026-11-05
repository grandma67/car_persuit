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
import { emptyDressing, feature, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook } from './District';
import { isJunctionControl } from './apply';
import { gateBlocks, mainGate, roleBlocks, streetSidesOf } from './Megapark';
import { shuffle } from './place';
import { layClearing, layFloor, layTrack, layTrees, trackClearOf, trackMouths, type Clearing, type Track } from './ForestWoods';
import { layCampsite, layGates, layLookout, layYard, rangerRect, sawmillRect, yardFrame, type SetLayout } from './ForestSet';
import { clearOf } from './HarborYard';
import { frontMask } from './Megapark';
import { propFootprint, rectFootprint, type StreetProp } from '../StreetProps';
import type { RunDressing } from './runtime';

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
  // The campsite off the main gate's street (the ranger station stands there), if it can be.
  if (feature(q, 'campsite', rng.next() < FOREST.campsiteChance) && free().length) {
    const byGate = new Set(gateBlocks(q, city, gate));
    out.set(free().find((k) => !byGate.has(k)) ?? free()[0], 'campsite');
  }
  for (const k of pool) if (!out.has(k)) out.set(k, 'woods');
  return out;
}

/** The block the ranger station stands in: beside the main gate, across the street from the yard (a woods block if it can). */
export function rangerBlock(q: District, city: CityData): number | undefined {
  const beside = gateBlocks(q, city, mainGate(q)).filter((k) => q.roles.get(k) !== 'lumberyard');
  return beside.find((k) => q.roles.get(k) === 'woods') ?? beside[0];
}

export type ForestLot = 'sawmill' | 'ranger';

/** The sawmill shed at the back of the lumber yard, the ranger station by the main gate. */
function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  buildings.length = 0; // every block has a role: nothing was filled
  const make = (r: Rect, k: number, lot: ForestLot, h: number): Building => ({ ...r, h, zone: city.blocks[k].zone, variant: rng.next(), district: 'forest', lot });
  const [yard] = roleBlocks(q, 'lumberyard');
  if (yard !== undefined) buildings.push(make(sawmillRect(yardFrame(q, city, yard)), yard, 'sawmill', FOREST.sawmill.h));
  const ranger = rangerBlock(q, city);
  if (ranger !== undefined) buildings.push(make(rangerRect(city, ranger, mainGate(q)), ranger, 'ranger', FOREST.ranger.h));
  for (const b of buildings) b.street = frontMask(b, city);
}

/** A weathered board-and-batten sawmill with roller doors and a rusty roof; a green-painted ranger station with a porch. */
function FOREST_LOOKS(): Record<ForestLot, LotLook> {
  return {
    sawmill: { facade: 'industrial', ground: 'rollerDoors', roof: 'gable', palette: [0x8a7a68, 0x7a6a5a, 0x9a8a70], roofTiles: [0x7a5a44, 0x6a6e6a, 0x8a6448] },
    ranger: { facade: 'siding', roof: 'gable', palette: [0x7e9a74, 0x8aa07e, 0x9a8a6a], roofTiles: [0x4a3a2e, 0x5a4a3a], trims: ['porch', 'chimney'] },
  };
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
  looks: FOREST_LOOKS(),
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
  const buildings = city.buildings.filter((b) => b.district === 'forest' && inRect(q.bounds, b));
  const props: StreetProp[] = [];
  const add = (l: SetLayout) => {
    out.structures.push(...l.structures);
    out.solids.push(...l.solids);
    out.overhead.push(...l.overhead);
    out.drivable.push(...l.drivable);
    props.push(...l.props);
  };
  // The log arch over the main street, timber posts at the other gates.
  add(layGates(q, city, rng));
  // The lumber yard by the main gate: stacks, corridors, loader and truck, lamps.
  const open = new Set(roleBlocks(q, 'lumberyard'));
  for (const k of open) add(layYard(q, city, k, rng));
  // Tracks: through most woods blocks, always through a special block's clearing; none in the yard.
  // A track that would run into a building or a gate post is laid again (a few tries).
  const tracks: Track[] = [];
  const clearings: Clearing[] = [];
  const keepOff = [...buildings.map(rectFootprint), ...out.solids];
  for (const k of [...q.blocks].sort((a, b) => a - b)) {
    if (open.has(k)) continue;
    const role = q.roles.get(k);
    const special = role === 'lookout' || role === 'campsite';
    if (!special && rng.next() >= FOREST.trackChance) continue;
    let t: Track | null = null;
    for (let tries = 0; tries < 6 && !t; tries++) {
      const next = layTrack(k, city, rng);
      if (!next) break;
      if (trackClearOf(next, keepOff, 1)) t = next;
    }
    if (!t) continue;
    tracks.push(t);
    if (!special) continue;
    const glade = layClearing(t, city, rng);
    clearings.push(glade);
    add(role === 'lookout' ? layLookout(t, glade, rng) : layCampsite(t, glade, rng));
  }
  // The track mouths: kerb clutter keeps off (never a junction control).
  const mouths: Rect[] = tracks.flatMap((t) => trackMouths(t, city));
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !mouths.some((m) => inRect(m, p, 0.5)));
  const trees = layTrees(q, city, tracks, clearings, open, [...keepOff, ...out.solids], rng);
  // The floor between them: ferns, fallen logs, boulders, stumps.
  const floor = layFloor(q, city, tracks, clearings, open, trees, [...keepOff, ...out.solids], rng);
  out.structures.push(...floor.structures);
  out.solids.push(...floor.solids);
  // Props clear of the solids, the buildings, the junction controls and each other (set props first).
  const controls = city.streetProps.filter((p) => inRect(q.bounds, p, 2) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  out.props = clearOf([...props, ...trees, ...floor.props], [...out.solids, ...controls, ...buildings.map(rectFootprint)],
    city.streetProps.filter((p) => inRect(q.bounds, p, 2)).map((p) => propFootprint(p, 0.1)));
  // Cops route through the woods only along the tracks and across the clearings.
  const woods = q.blocks.filter((k) => !open.has(k)).map((k) => shrink(city.blocks[k].rect, sw));
  out.thicket = { rects: woods, paths: [...tracks.map((t) => ({ points: t.points, width: t.width })), ...clearings.map((c) => ({ points: [{ x: c.x, z: c.z }], width: c.r * 2 }))] };
  // By climate: all pine in the snow (the ferns under it), palms by the beach, a dry woodland of snags and cacti in the desert (no ferns).
  const byClimate: Record<string, RunDressing> = {
    snow: { trees: { round: 'pine' }, drop: ['fern'] },
    beach: { trees: { round: 'palm' } },
    desert: { trees: { pine: 'snag', round: 'cactus' }, drop: ['fern'] },
  };
  out.extra = { tracks, clearings, byClimate };
  return out;
}

/** The woods blocks' inner rects (inside the sidewalk line). */
export const woodsRooms = (q: District, city: CityData): Rect[] => roleBlocks(q, 'woods').map((k) => shrink(city.blocks[k].rect, city.config.sidewalk));
