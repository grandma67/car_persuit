// Seed → city layout as plain data. CityBuilder turns it into meshes and colliders.
import { Rng } from '../core/Rng';
import { RoadGraph, type RoadNode } from './RoadGraph';
import { footprintsOverlap, generateStreetProps, propFootprint, type StreetProp } from './StreetProps';
import { generateTrafficControl, type RoadMark } from './TrafficControl';
import { canalRampShape, planLandmarks, type Landmark } from './Landmarks';
import { planRoadworks, type Roadworks } from './Roadworks';
import { keepOf, type DriveSide } from './driveSide';
import { clipRect, inCanal, landPieces, onGround, pickBridges, planTerrain, type Terrain, type TerrainConfig } from './Terrain';
import { fillBlock, scatterTrees } from './lots';
import { fastStreets } from './TrafficControl';
import type { District, DistrictDef, DistrictKind } from './districts/District';
import { applyDistricts, rolesOf } from './districts/apply';
import type { DistrictForce, DistrictGrid } from './districts/place';
import { DISTRICT_DEFS } from './districts/index';
import { districtOfNode } from './districts/runtime';
import { pickDestinations } from '../gameplay/MissionSystem';
import {
  CityParamsError, edgeKeyOf, PARAMS_VERSION, rollCityBlocks as rollCityBlocksOf, rollCityParams, rollDriveSide as rollDriveSideOf,
  type CanalParams, type CanalRampParams, type CityParams, type LandmarkParams,
} from './CityParams';
import type { RampPins } from './Landmarks';
import type { WorksPin } from './Roadworks';
import type { ShallowWater } from './Water';
import { faceThePieces, layParkPieces, pinParkCounts, rollParkPieces, type ParkPiece } from './ParkPieces';

export interface CityConfig extends TerrainConfig {
  blocks: number; // blocks per side
  blocksRange: [number, number]; // a run's grid size, rolled per seed by rollCityBlocks
  blockSize: number; // metres
  roadWidth: number;
  sidewalk: number; // margin inside each block before lots start
  promenade: number; // paved strip between the ring road and the sea
  removeRoadFraction: number; // share of inner road segments turned into plazas
  parkChance: number;
  roadworksChance: number; // chance per site slot (up to 3) of a junction closed for repairs
  canalRampChance: number; // chance of each canal-jump ramp, rolled again for every further one (cities with canals only)
  maxCanalRamps: number; // cap on the rolls (spacing between ramps may stop it sooner)
  leftHandChance: number; // chance the city is English: everyone drives on the left
}

export const DEFAULT_CITY: CityConfig = {
  blocks: 12,
  blocksRange: [8, 15],
  blockSize: 60,
  roadWidth: 12,
  sidewalk: 3,
  promenade: 10,
  removeRoadFraction: 0.1,
  parkChance: 0.08,
  roadworksChance: 0.5,
  canalRampChance: 0.6,
  maxCanalRamps: 4,
  leftHandChance: 0.05,
  hillChance: 0.75,
  hillHeight: [8, 22],
  maxGrade: 0.11,
  canalOdds: [0.3, 0.45, 0.25],
  canalWidth: [12, 100],
  bridgeSpacing: [3, 5],
};

export type Zone = 'downtown' | 'midtown' | 'residential' | 'industrial';

/** Axis-aligned rectangle: centre (x, z), size w (along X) × d (along Z). */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Building extends Rect {
  h: number;
  zone: Zone;
  /** 0..1 per-building variation used for colour and window pattern. */
  variant: number;
  district?: DistrictKind; // built by a district
  lot?: string; // what kind of building it is in its district (picks its look)
  street?: number; // district buildings: the sides on a street (bits: 1 +Z, 2 -Z, 4 +X, 8 -X)
  open?: number; // sides left without a wall (an open-sided shed), same bits
}

export interface Block {
  rect: Rect;
  zone: Zone;
  park: boolean;
  square?: boolean; // town square: paved, no buildings, centrepiece landmark
  district?: DistrictKind; // part of a district (it keeps its zone)
}

export interface RoadSegment {
  a: number; // node ids
  b: number;
  rect: Rect;
}

export interface CityData {
  config: CityConfig;
  seed: number;
  size: number; // width/depth of the road grid in metres
  islandSize: number; // grid plus promenade; beyond this is sea
  graph: RoadGraph;
  roads: RoadSegment[]; // drivable segments (edges of the graph)
  intersections: Rect[];
  plazas: Rect[]; // removed segments, paved and drivable but not part of the graph
  blocks: Block[];
  buildings: Building[];
  props: Rect[]; // small solid obstacles (planters) on plazas
  trees: { x: number; z: number }[];
  landmarks: Landmark[]; // fountains, statues, obelisks, sculptures (solid)
  streetProps: StreetProp[]; // breakable lamps, hydrants, benches, fences, signs, signals
  roadMarks: RoadMark[]; // zebra crossings, stop lines, and the lines they add to
  roadworks: Roadworks[]; // the rare closed junctions (usually none)
  terrain: Terrain; // hill, canals and their bridges
  driveSide: DriveSide; // which side of the road traffic keeps to, for the whole game
  spawn: { x: number; z: number; yaw: number };
  districts: District[]; // themed districts laid over the grid (often none)
  water: ShallowWater[]; // ponds, lakes and pools on land: wading, never drowning (`world/Water.ts`)
  parkPieces: ParkPiece[]; // fish ponds and soccer pitches in parks (`world/ParkPieces.ts`)
  params: CityParams; // every choice that made it: reloads as this city
  warnings: string[]; // pinned choices that hold but may not show, or a stale dump's read-only parts
}

/** Which district definitions a city may get, and URL overrides (?oldtown=1 forces the roll on, 0 off). */
export interface DistrictOptions {
  defs?: DistrictDef[];
  force?: DistrictForce;
}

interface Edge {
  a: number;
  b: number;
  horizontal: boolean; // runs along X
  i: number; // grid coords of the edge's lower node
  j: number;
  removed: boolean;
  canal: boolean; // under a canal: no road, no plaza
}

/** Rarely the city is English and drives on the left: its own RNG stream, decided by the seed. */
export function rollDriveSide(seed: number, config: CityConfig = DEFAULT_CITY): DriveSide {
  return rollDriveSideOf(seed, config.leftHandChance);
}

/** Blocks per side for a run, from its own stream so nothing else in the seed moves. */
export function rollCityBlocks(seed: number, config: CityConfig = DEFAULT_CITY): number {
  return rollCityBlocksOf(seed, config.blocksRange);
}

const ZONE_CHAR: Record<Zone, string> = { downtown: 'D', midtown: 'M', residential: 'R', industrial: 'I' };

/**
 * Seed or params → city. A seed (with a config) builds what it always has: the config's grid size,
 * `districtOpts.force` as the URL's district flags. Params pin choices; each is resolved where it is
 * built (`pin()`: the roll still drawn), and `city.params` holds them all. A pinned choice that
 * can't be built throws a CityParamsError naming the field; it is never rolled differently.
 */
export function generateCity(input: number | CityParams, config: CityConfig = DEFAULT_CITY, districtOpts: DistrictOptions = {}): CityData {
  const asked: CityParams = typeof input === 'number'
    ? { seed: input, blocks: config.blocks, ...(districtOpts.force ? { force: districtOpts.force } : {}) }
    : input;
  const p = rollCityParams(asked.seed, asked, config);
  const seed = p.seed;
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = () => {
    if (errors.length) throw new CityParamsError(errors);
  };
  if (!Number.isInteger(p.blocks) || p.blocks! < 4 || p.blocks! > 30) errors.push(`blocks: ${p.blocks} is not a grid size from 4 to 30`);
  fail();
  if (p.blocks !== config.blocks) config = { ...config, blocks: p.blocks! };
  const rng = new Rng(seed);
  const { blocks: n, blockSize, roadWidth } = config;
  const pitch = blockSize + roadWidth;
  const size = n * blockSize + (n + 1) * roadWidth;
  const line = (i: number) => -size / 2 + roadWidth / 2 + i * pitch;
  const nodeId = (i: number, j: number) => j * (n + 1) + i;

  // --- Road grid ---
  const nodes: RoadNode[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) nodes.push({ id: nodeId(i, j), x: line(i), z: line(j), neighbors: [] });
  }
  const edges: Edge[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      if (i < n) edges.push({ a: nodeId(i, j), b: nodeId(i + 1, j), horizontal: true, i, j, removed: false, canal: false });
      if (j < n) edges.push({ a: nodeId(i, j), b: nodeId(i, j + 1), horizontal: false, i, j, removed: false, canal: false });
    }
  }
  const link = (e: Edge, on: boolean) => {
    const na = nodes[e.a].neighbors;
    const nb = nodes[e.b].neighbors;
    if (on) {
      na.push(e.b);
      nb.push(e.a);
    } else {
      na.splice(na.indexOf(e.b), 1);
      nb.splice(nb.indexOf(e.a), 1);
    }
  };
  edges.forEach((e) => link(e, true));
  const keyOf = (e: Edge) => edgeKeyOf(e.horizontal, e.i, e.j);
  const edgeIndex = new Map(edges.map((e) => [keyOf(e), e]));
  const cellOfNode = (id: number): [number, number] => [id % (n + 1), Math.floor(id / (n + 1))];
  const nodeAt = (ij: [number, number] | undefined) =>
    ij && Number.isInteger(ij[0]) && Number.isInteger(ij[1]) && ij[0] >= 0 && ij[0] <= n && ij[1] >= 0 && ij[1] <= n ? nodes[nodeId(ij[0], ij[1])] : undefined;
  /** The edge `steps` along from e in its own line (undefined off the grid). */
  const inLine = (e: Edge, steps: number) => edgeIndex.get(e.horizontal ? `h${e.i + steps},${e.j}` : `v${e.i},${e.j + steps}`);
  const isRoad = (e: Edge | undefined) => !!e && !e.removed && !e.canal;
  /** Heading (yaw) along an edge, toward its b end (+1) or its a end (-1). */
  const yawAlong = (e: Edge, dir: number) => (e.horizontal ? (dir * Math.PI) / 2 : dir > 0 ? 0 : Math.PI);
  const graph = new RoadGraph(nodes);

  // --- Canals (own RNG stream): the roads along a canal's line become water. Every few blocks a
  // road crosses it on a bridge; the others end at the quay in a small paved square. Where two
  // canals cross, that junction is lost to the water altogether. ---
  const islandSize = size + config.promenade * 2;
  const terrainPins = p.terrain ?? {};
  if (Array.isArray(terrainPins.canals)) {
    const listed = terrainPins.canals;
    if (listed.length > 2) errors.push('terrain.canals: at most two canals');
    listed.forEach((c, k) => {
      if (c.axis !== 'x' && c.axis !== 'z') errors.push(`terrain.canals[${k}].axis: "${c.axis}" is not x or z`);
      if (!Number.isInteger(c.line) || c.line < 2 || c.line > n - 2) errors.push(`terrain.canals[${k}].line: ${c.line} is not an inner road line (2 to ${n - 2}; never the ring road or the line next to it)`);
      if (c.width !== undefined && !(c.width > 0)) errors.push(`terrain.canals[${k}].width: ${c.width} is not a width`);
    });
    if (listed.length === 2 && listed[0].axis === listed[1].axis && Math.abs(listed[0].line - listed[1].line) < 3) {
      errors.push('terrain.canals: two parallel canals must be at least three blocks apart');
    }
  } else if (terrainPins.canals !== undefined && ![0, 1, 2].includes(terrainPins.canals)) {
    errors.push(`terrain.canals: ${terrainPins.canals} is not 0, 1 or 2 canals`);
  }
  fail();
  const shape = planTerrain(new Rng(seed ^ 0x7e44a1), config, n, line, islandSize / 2, terrainPins);
  const canalLines = (axis: 'x' | 'z') => new Set(shape.canals.filter((c) => c.axis === axis).map((c) => c.line));
  const alongX = canalLines('x');
  const alongZ = canalLines('z');
  for (const e of edges) {
    if (e.horizontal ? alongX.has(e.j) : alongZ.has(e.i)) {
      e.canal = true;
      link(e, false);
    }
  }
  const bridgeRng = new Rng(seed ^ 0xb41d6e);
  const bridges: Rect[] = [];
  const canalNodes = new Set<number>();
  const quaySquares: Edge[] = [];
  const canalsOut: CanalParams[] = [];
  for (const [ci, c] of shape.canals.entries()) {
    const crossing = c.axis === 'x' ? alongZ : alongX;
    const runs: number[][] = [[]];
    for (let k = 0; k <= n; k++) {
      if (crossing.has(k)) runs.push([]); // the canals' crossing: open water
      else runs[runs.length - 1].push(k);
    }
    const rolled = pickBridges(bridgeRng, runs, config.bridgeSpacing);
    const pinned = Array.isArray(terrainPins.canals) ? terrainPins.canals[ci].bridges : undefined;
    if (pinned) {
      for (const k of pinned) if (!runs.flat().includes(k)) errors.push(`terrain.canals[${ci}].bridges: ${k} is not a road line crossing the canal`);
      for (const run of runs) {
        if (run.length && !run.some((k) => pinned.includes(k))) errors.push(`terrain.canals[${ci}].bridges: no bridge on lines ${run[0]} to ${run[run.length - 1]} (the island would split)`);
      }
    }
    const bridged = new Set(pinned ?? rolled);
    canalsOut.push({ axis: c.axis, line: c.line, width: c.half * 2, bridges: [...bridged].sort((a, b) => a - b) });
    for (const k of runs.flat()) {
      const [i, j] = c.axis === 'x' ? [k, c.line] : [c.line, k];
      canalNodes.add(nodeId(i, j));
      if (!bridged.has(k)) {
        // The road segments either side of the water become dead ends: pave them over.
        for (const e of edges) {
          if (!e.canal && !e.removed && (e.a === nodeId(i, j) || e.b === nodeId(i, j))) {
            e.removed = true;
            link(e, false);
            quaySquares.push(e);
          }
        }
        continue;
      }
      // The ring road's bridges also carry the promenade out to the sea wall.
      const outer = k === 0 ? -1 : k === n ? 1 : 0;
      const across = roadWidth + (outer ? config.promenade : 0);
      const centre = line(k) + (outer * config.promenade) / 2;
      bridges.push(c.axis === 'x' ? { x: centre, z: c.at, w: across, d: c.half * 2 } : { x: c.at, z: centre, w: c.half * 2, d: across });
    }
  }
  fail();
  const terrain: Terrain = { ...shape, bridges, land: landPieces(islandSize / 2, shape.canals) };
  const openNodes = nodes.filter((nd) => nd.neighbors.length).length;

  // Turn some inner segments into plazas. The outer ring always stays; no dead ends are allowed
  // (degree ≥ 2) and the network must stay connected.
  const isBorder = (e: Edge) => (e.horizontal ? e.j === 0 || e.j === n : e.i === 0 || e.i === n);
  const candidates = edges.filter((e) => !isBorder(e) && !e.canal && !e.removed);
  shuffle(candidates, rng);
  const plazaKeys: string[] = [];
  const pave = (e: Edge) => {
    if (nodes[e.a].neighbors.length <= 2 || nodes[e.b].neighbors.length <= 2) return false;
    link(e, false);
    if (graph.reachable(e.a).size === openNodes) {
      e.removed = true;
      plazaKeys.push(keyOf(e));
      return true;
    }
    link(e, true);
    return false;
  };
  if (p.plazas) {
    for (const key of p.plazas) {
      const e = edgeIndex.get(key);
      if (!e) errors.push(`plazas: ${key} is not a street of a ${n}-block grid`);
      else if (isBorder(e)) errors.push(`plazas: ${key} is on the ring road`);
      else if (e.canal || e.removed) errors.push(`plazas: ${key} is under a canal or ends at a quay`);
      else if (!pave(e)) errors.push(`plazas: paving ${key} over leaves a dead end or cuts the network`);
    }
    fail();
  } else {
    let toRemove = Math.round(candidates.length * config.removeRoadFraction);
    for (const e of candidates) {
      if (toRemove === 0) break;
      if (pave(e)) toRemove--;
    }
  }

  const edgeRect = (e: Edge): Rect =>
    e.horizontal
      ? { x: (line(e.i) + line(e.i + 1)) / 2, z: line(e.j), w: blockSize, d: roadWidth }
      : { x: line(e.i), z: (line(e.j) + line(e.j + 1)) / 2, w: roadWidth, d: blockSize };
  const roads = edges.filter((e) => !e.removed && !e.canal).map((e) => ({ a: e.a, b: e.b, rect: edgeRect(e) }));
  const plazaEdges = edges.filter((e) => e.removed && !quaySquares.includes(e));
  const intersections = nodes.filter((nd) => nd.neighbors.length).map((nd) => ({ x: nd.x, z: nd.z, w: roadWidth, d: roadWidth }));

  // --- Zones: downtown core by distance, then smooth noise splits residential/industrial ---
  const noise = makeValueNoise(rng, 4);
  const blocksOut: Block[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const rect = { x: line(i) + pitch / 2, z: line(j) + pitch / 2, w: blockSize, d: blockSize };
      const dist = Math.hypot(rect.x, rect.z) / (size / 2);
      const zone: Zone =
        dist < 0.32 ? 'downtown' : dist < 0.6 ? 'midtown' : noise(i / n, j / n) < 0.55 ? 'residential' : 'industrial';
      blocksOut.push({ rect, zone, park: zone !== 'downtown' && rng.next() < config.parkChance });
    }
  }
  // Read-only in the params: shown by a dump, and a file whose map differs is stale.
  const zones = Array.from({ length: n }, (_, j) =>
    blocksOut.slice(j * n, (j + 1) * n).map((b) => (b.park ? ZONE_CHAR[b.zone].toLowerCase() : ZONE_CHAR[b.zone])).join(''));
  if (p.zones && p.zones.join() !== zones.join()) warnings.push('zones: the zone map built differs from the file\'s (a stale dump?)');

  // --- Buildings and trees ---
  let buildings: Building[] = [];
  let trees: { x: number; z: number }[] = [];
  for (const block of blocksOut) {
    if (block.park) {
      scatterTrees(block.rect, config.sidewalk + 2, rng.int(10, 18), rng, trees);
      continue;
    }
    fillBlock(block, config.sidewalk, rng, buildings, trees);
  }

  // --- Town squares, park centrepieces and the jump ramps (own RNG stream). A ramp wants a
  // paved-over street with a road straight on at both ends: run-up through one junction, landing
  // beyond the other, none of it over a bridge (jumping the water is the canal ramp's job). ---
  const rampStreets = plazaEdges.filter((e) => {
    const before = inLine(e, -1);
    const after = inLine(e, 1);
    return isRoad(before) && isRoad(after) && [before!.a, e.a, e.b, after!.b].every((id) => !canalNodes.has(id));
  });
  const rampSpots = rampStreets.flatMap((e) => {
    const r = edgeRect(e);
    return [1, -1].map((dir) => ({ x: r.x, z: r.z, yaw: yawAlong(e, dir) }));
  });
  // Pinned street ramps replace the rolled ones (the squares still roll, so nothing else moves).
  let rampPins: RampPins | undefined;
  if (p.landmarks || p.ramps !== undefined) {
    rampPins = { fill: new Rng(seed ^ 0x1a4d ^ 0x6a3b), count: p.ramps };
    if (p.landmarks) {
      rampPins.street = p.landmarks.flatMap((l, k) => {
        if (l.edge === undefined) return [];
        const e = edgeIndex.get(l.edge);
        if (!e || !rampStreets.includes(e)) {
          errors.push(`landmarks[${k}]: ${l.edge} is no ramp street (a paved-over street, a road straight on at both ends, off the canals)`);
          return [];
        }
        const r = edgeRect(e);
        return [{ x: r.x, z: r.z, yaw: yawAlong(e, l.dir ?? 1) }];
      });
    }
    fail();
  }
  const planned = planLandmarks(blocksOut, buildings, trees, config, new Rng(seed ^ 0x1a4d), rampSpots, rampPins);
  ({ buildings, trees } = planned);
  const landmarks = planned.landmarks;
  const blockAt = (x: number, z: number): [number, number] => [Math.round((x - line(0) - pitch / 2) / pitch), Math.round((z - line(0) - pitch / 2) / pitch)];
  const landmarksOut: LandmarkParams[] = landmarks.map((l) => {
    const e = l.kind === 'ramp' ? rampStreets.find((s) => edgeRect(s).x === l.x && edgeRect(s).z === l.z) : undefined;
    return e ? { kind: 'ramp', edge: keyOf(e), dir: yawAlong(e, 1) === l.yaw ? 1 : -1 } : { kind: l.kind, block: blockAt(l.x, l.z) };
  });
  if (p.landmarks) {
    const fixed = (list: LandmarkParams[]) => list.filter((l) => l.edge === undefined).map((l) => `${l.kind}@${l.block}`).join();
    if (fixed(p.landmarks) !== fixed(landmarksOut)) warnings.push('landmarks: the squares and park centrepieces built differ from the file\'s (a stale dump?)');
  }
  const rampStreetSet = new Set(rampStreets.filter((e) => {
    const r = edgeRect(e);
    return landmarks.some((l) => l.kind === 'ramp' && r.x === l.x && r.z === l.z);
  }));
  // Junctions either side of the ramp streets (and of a canal ramp's run-up) stay clear of roadworks.
  const rampNodes = [...rampStreetSet].flatMap((e) => [e.a, e.b, inLine(e, -1)!.a, inLine(e, 1)!.b]);

  // --- Often, a few ramps built to jump the canals (each one a fresh roll of the chance): each at
  // a street that ends at the quay with a road behind it for the run-up and the street's other
  // half across the water to land on. Sized to the canal; never two at one crossing, nor close. ---
  const canalRng = new Rng(seed ^ 0xca7a1);
  const canalRampsOut: CanalRampParams[] = [];
  const pinnedCanalRamps = p.canalRamps;
  if (shape.canals.length || Array.isArray(pinnedCanalRamps)) {
    const spots = quaySquares.flatMap((e) => {
      const aWet = canalNodes.has(e.a);
      if (aWet === canalNodes.has(e.b)) return [];
      const dir = aWet ? -1 : 1; // toward the water
      const runUp = inLine(e, -dir);
      const across = inLine(e, dir); // shares the wet junction
      // Two whole blocks of straight road behind the quay street (kept clear of roadworks): enough
      // run-up to reach the speed the ramp is built for (one block leaves a wide canal out of reach).
      const longRunUp = runUp && inLine(runUp, -dir);
      if (!isRoad(runUp) || !isRoad(longRunUp) || !across || !quaySquares.includes(across)) return [];
      const wet = nodes[aWet ? e.a : e.b];
      const canal = shape.canals.find((c) => (e.horizontal ? c.axis === 'z' && c.at === wet.x : c.axis === 'x' && c.at === wet.z));
      if (!canal) return [];
      const lipAt = canal.at - dir * (canal.half + 2); // just back from the quay edge
      const rampShape = canalRampShape(canal.half * 2 + 8); // over the far parapet line with room for the car
      if (-rampShape.toe > blockSize - 8) return [];
      const far = dir > 0 ? longRunUp!.a : longRunUp!.b;
      return [{
        landmark: {
          kind: 'ramp', yaw: yawAlong(e, dir), radius: 1.5, shape: rampShape, crossing: canal.at,
          x: e.horizontal ? lipAt : wet.x, z: e.horizontal ? wet.z : lipAt,
        } satisfies Landmark,
        nodes: [aWet ? e.b : e.a, dir > 0 ? runUp!.a : runUp!.b, far],
        wet,
        key: keyOf(e),
        dir: dir as 1 | -1,
      }];
    });
    let chosen: typeof spots = [];
    if (Array.isArray(pinnedCanalRamps)) {
      chosen = pinnedCanalRamps.flatMap((c, k) => {
        const spot = spots.find((s) => s.key === c.edge && s.dir === c.dir);
        if (!spot) errors.push(`canalRamps[${k}]: ${c.edge} (dir ${c.dir}) is no quay street with two blocks of run-up and the street across the water`);
        return spot ? [spot] : [];
      });
      fail();
    } else {
      // 'all' comes up on every roll (as ?canalramp); a count takes that many, each roll still drawn.
      const most = typeof pinnedCanalRamps === 'number' ? pinnedCanalRamps : config.maxCanalRamps;
      const chance = pinnedCanalRamps === 'all' ? 1 : config.canalRampChance;
      while (chosen.length < most) {
        const roll = canalRng.next();
        if (typeof pinnedCanalRamps !== 'number' && roll >= chance) break;
        const free = spots.filter((s) => chosen.every((c) => Math.hypot(c.wet.x - s.wet.x, c.wet.z - s.wet.z) > pitch * 1.5));
        if (!free.length) break;
        chosen.push(canalRng.pick(free));
      }
    }
    for (const pick of chosen) {
      landmarks.push(pick.landmark);
      rampNodes.push(...pick.nodes);
      canalRampsOut.push({ edge: pick.key, dir: pick.dir });
    }
  }

  // --- Plazas: paved shortcuts with planters to weave between ---
  const plazas: Rect[] = [];
  const props: Rect[] = [];
  for (const e of plazaEdges) {
    const r = edgeRect(e);
    plazas.push(r);
    if (rampStreetSet.has(e)) continue; // no planters on a ramp's run
    const count = rng.int(2, 3);
    for (let k = 0; k < count; k++) {
      const t = (k + 1) / (count + 1) - 0.5;
      const offset = (rng.next() - 0.5) * roadWidth * 0.5;
      props.push(
        e.horizontal
          ? { x: r.x + t * blockSize, z: r.z + offset, w: 2.5, d: 1.5 }
          : { x: r.x + offset, z: r.z + t * blockSize, w: 1.5, d: 2.5 },
      );
    }
  }
  // Squares where a street meets the canal without a bridge: paved up to the quay, no planters.
  for (const e of quaySquares) {
    const r = edgeRect(e);
    const part = terrain.land.map((piece) => clipRect(r, piece)).find(Boolean);
    if (part) plazas.push(part);
  }

  // --- Spawn: on a road segment next to the centre, facing along it ---
  let centre = graph.nearest(0, 0);
  let next = nodes[rng.pick(centre.neighbors)];
  if (p.spawn) {
    const at = nodeAt(p.spawn.node);
    const toward = nodeAt(p.spawn.toward);
    if (!at || !at.neighbors.length) errors.push(`spawn.node: ${p.spawn.node} is no open junction`);
    else if (!toward || !at.neighbors.includes(toward.id)) errors.push(`spawn.toward: ${p.spawn.toward} is not a junction one road on from ${p.spawn.node}`);
    fail();
    centre = at!;
    next = toward!;
  }
  const dx = next.x - centre.x;
  const dz = next.z - centre.z;
  const len = Math.hypot(dx, dz);
  const spawn = { x: centre.x + (dx / len) * 15, z: centre.z + (dz / len) * 15, yaw: Math.atan2(dx, dz) };

  // Pinned sites: just those, each laid out from its recorded stream state when it has one (a dump's
  // sites then come out exactly as the seed laid them out).
  type Plan = ReturnType<typeof planRoadworks>;
  const roadworksFor = (pinned: CityParams['roadworks'], plan: (chance: number, pins?: { count?: number; sites?: WorksPin[] }) => Plan): Plan => {
    if (!Array.isArray(pinned)) return plan(pinned === 'all' ? 1 : config.roadworksChance, { count: typeof pinned === 'number' ? pinned : undefined });
    const sites: WorksPin[] = pinned.map((w, k) => {
      const e = w.edge === undefined ? undefined : edgeIndex.get(w.edge);
      if (w.edge !== undefined && !e) errors.push(`roadworks[${k}].edge: ${w.edge} is not a street of a ${n}-block grid`);
      if (w.edge === undefined && !nodeAt(w.node)) errors.push(`roadworks[${k}].node: ${w.node} is not a junction of a ${n}-block grid`);
      return { ...(e ? { edge: [e.a, e.b] as [number, number] } : { node: nodeAt(w.node)?.id }), stream: w.stream };
    });
    fail();
    const out = plan(config.roadworksChance, { sites });
    for (const k of out.failed) errors.push(`roadworks[${k}]: can't close it (an inner junction or road, clear of the spawn, ramps, bridges and the other sites, that leaves no dead end)`);
    fail();
    return out;
  };
  // Roadworks close junctions away from the spawn (and off the bridges), before signs and signals go up.
  const keepOpen = new Set([centre.id, ...centre.neighbors, ...centre.neighbors.flatMap((id) => nodes[id].neighbors), ...canalNodes, ...rampNodes]);
  const works = roadworksFor(p.roadworks, (chance, pins) => planRoadworks(graph, roadWidth, size, keepOpen, chance, new Rng(seed ^ 0x0c0e5), pins));
  // Signals, signs and stop lines go up on the side traffic keeps to.
  const driveSide = p.driveSide!;
  // Own RNG stream so adding furniture never reshuffles the layout of existing seeds.
  const traffic = generateTrafficControl(graph, roads.map((r) => r.rect), blocksOut, config, size, new Rng(seed ^ 0x7aff1c), keepOf(driveSide));
  // Furniture is laid out for the full grid; drop whatever would stand in a canal or on a tree
  // (park benches are scattered without looking at the trees).
  const dry = (x: number, z: number, r: number) => onGround(terrain, x, z, r);
  const keptTrees = trees.filter((t) => dry(t.x, t.z, 1.5));
  const treeCells = new Map<string, { x: number; z: number }[]>();
  const cellOf = (x: number, z: number) => `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
  for (const t of keptTrees) treeCells.set(cellOf(t.x, t.z), [...(treeCells.get(cellOf(t.x, t.z)) ?? []), t]);
  const onTree = (p: StreetProp) => {
    const fp = propFootprint(p);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const near = treeCells.get(cellOf(p.x + a * 10, p.z + b * 10)) ?? [];
        if (near.some((t) => footprintsOverlap(fp, { x: t.x, z: t.z, hx: 0.5, hz: 0.5, yaw: 0 }))) return true;
      }
    }
    return false;
  };
  const streetProps = [...generateStreetProps(blocksOut, plazas, landmarks, config, size, new Rng(seed ^ 0x57ee7)), ...traffic.props, ...works.cones]
    .filter((p) => dry(p.x, p.z, 0.8) && (p.kind === 'cone' || !onTree(p)));
  const city: CityData = {
    config, seed, size, islandSize, graph, roads, intersections, plazas, blocks: blocksOut,
    // A footpath's width of quay is left clear along the water.
    buildings: buildings.filter((b) => !inCanal(terrain, b.x, b.z, Math.max(b.w, b.d) / 2 + config.sidewalk)),
    props: props.filter((p) => dry(p.x, p.z, Math.max(p.w, p.d) / 2)),
    trees: keptTrees,
    landmarks: landmarks.filter((l) => dry(l.x, l.z, l.radius)),
    streetProps,
    roadMarks: traffic.marks.filter((m) => dry(m.x, m.z, 0)),
    roadworks: works.sites, terrain, spawn, driveSide,
    districts: [],
    water: [],
    parkPieces: [],
    params: p,
    warnings,
  };
  const edgeOfNodes = new Map(edges.map((e) => [`${e.a}>${e.b}`, e]));
  city.params = {
    version: PARAMS_VERSION,
    seed,
    ...(p.note === undefined ? {} : { note: p.note }),
    climate: p.climate,
    weather: p.weather,
    time: p.time,
    startMinute: p.startMinute,
    theme: p.theme,
    blocks: n,
    driveSide,
    terrain: { hill: shape.hill ? { ...shape.hill } : null, canals: canalsOut },
    plazas: plazaKeys,
    zones,
    landmarks: landmarksOut,
    canalRamps: canalRampsOut,
    roadworks: works.sites.map((w, k) => ({
      ...(w.edge ? { edge: keyOf(edgeOfNodes.get(`${w.edge[0]}>${w.edge[1]}`)!) } : { node: cellOfNode(w.node!) }), stream: works.streams[k],
    })),
    spawn: { node: cellOfNode(centre.id), toward: cellOfNode(next.id) },
  };

  // --- Districts: laid over the finished city, each from its own RNG stream, so everything
  // outside a district's blocks and frontage is exactly as without it ---
  const defs = districtOpts.defs ?? DISTRICT_DEFS;
  if (defs.length) {
    const grid: DistrictGrid = {
      n, line, nodeId, canalNodes,
      edges: edges.map((e) => ({
        a: e.a, b: e.b, horizontal: e.horizontal, i: e.i, j: e.j,
        kind: e.canal ? 'canal' : quaySquares.includes(e) ? 'quay' : e.removed ? 'plaza' : 'road',
      })),
      blockedNodes: new Set(rampNodes), // the spawn may be inside a district
      works: works.sites.map((w) => ({ node: w.node, edge: w.edge })),
      fast: fastStreets(graph, traffic.props),
    };
    applyDistricts(city, grid, defs, p.force, p.districts, errors, warnings);
    fail();
  }
  // --- Park pieces (own stream): a fish pond or a soccer pitch in a park with no centrepiece, laid
  // after the districts (parks inside one are skipped), so nothing rolled before them moves ---
  const centred = (b: Block) => city.landmarks.some((l) => l.kind !== 'ramp' && l.x === b.rect.x && l.z === b.rect.z);
  const rolledPieces = rollParkPieces(blocksOut, centred, seed);
  if (p.ponds !== undefined || p.pitches !== undefined) {
    const eligible = blocksOut.flatMap((b, k) => (b.park && !b.district && !b.square && !centred(b) ? [k] : []));
    pinParkCounts(rolledPieces, eligible, { pond: p.ponds, pitch: p.pitches }, seed);
  }
  const laid = layParkPieces(blocksOut, rolledPieces, n, config, terrain, seed);
  if (laid.pieces.length) {
    city.trees = city.trees.filter((t) => !laid.clears(t.x, t.z, 0.5));
    city.streetProps = city.streetProps.filter((q) => !(q.kind === 'bench' && laid.clears(q.x, q.z, 1)));
    faceThePieces(city.streetProps, laid.pieces, blocksOut, n); // the loose benches left, before the piece's own
    city.streetProps.push(...laid.props);
    city.landmarks.push(...laid.landmarks);
    city.water.push(...laid.water);
    city.parkPieces = laid.pieces;
  }

  if (p.ponds !== undefined) city.params.ponds = p.ponds;
  if (p.pitches !== undefined) city.params.pitches = p.pitches;
  city.params.districts = city.districts.map((q) => ({
    kind: q.kind, rect: { i: q.grid.i0, j: q.grid.j0, w: q.grid.w, h: q.grid.h }, roles: rolesOf(q, n), features: { ...q.features },
  }));

  // --- The mission's destinations (own RNG stream), from the junction the run starts at ---
  const start = graph.nearest(spawn.x, spawn.z);
  if (p.destinations) {
    const dist = graph.distancesFrom(start.id);
    p.destinations.forEach((ij, k) => {
      const nd = nodeAt(ij);
      if (!nd || !nd.neighbors.length) errors.push(`destinations[${k}]: ${ij} is no open junction`);
      else if (nd.id === start.id) errors.push(`destinations[${k}]: ${ij} is where the run starts`);
      else if (!Number.isFinite(dist[nd.id])) errors.push(`destinations[${k}]: ${ij} can't be reached by road`);
    });
    if (!p.destinations.length) errors.push('destinations: at least one');
    fail();
  }
  const destinations = p.destinations?.map((ij) => nodeAt(ij)!) ??
    pickDestinations(graph, new Rng(seed ^ 0xde57), start.id, undefined, (id) => districtOfNode(city, id));
  city.params.destinations = destinations.map((nd) => cellOfNode(nd.id));
  return city;
}

/** The mission's destinations as junctions (from city.params). */
export function cityDestinations(city: CityData): RoadNode[] {
  const n = city.config.blocks;
  return city.params.destinations!.map(([i, j]) => city.graph.nodes[j * (n + 1) + i]);
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/** Smooth 2D value noise over [0,1]² from a coarse random grid. */
function makeValueNoise(rng: Rng, cells: number): (u: number, v: number) => number {
  const grid: number[][] = [];
  for (let y = 0; y <= cells; y++) grid.push(Array.from({ length: cells + 1 }, () => rng.next()));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = Math.min(u * cells, cells - 1e-6);
    const y = Math.min(v * cells, cells - 1e-6);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const top = grid[y0][x0] * (1 - tx) + grid[y0][x0 + 1] * tx;
    const bottom = grid[y0 + 1][x0] * (1 - tx) + grid[y0 + 1][x0 + 1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}
