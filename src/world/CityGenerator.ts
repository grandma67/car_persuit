// Seed → city layout as plain data. CityBuilder turns it into meshes and colliders.
import { Rng } from '../core/Rng';
import { RoadGraph, type RoadNode } from './RoadGraph';
import { footprintsOverlap, generateStreetProps, propFootprint, type StreetProp } from './StreetProps';
import { generateTrafficControl, type RoadMark } from './TrafficControl';
import { canalRampShape, planLandmarks, type Landmark } from './Landmarks';
import { planRoadworks, type Roadworks } from './Roadworks';
import { clipRect, inCanal, landPieces, onGround, pickBridges, planTerrain, type Terrain, type TerrainConfig } from './Terrain';

export interface CityConfig extends TerrainConfig {
  blocks: number; // blocks per side
  blockSize: number; // metres
  roadWidth: number;
  sidewalk: number; // margin inside each block before lots start
  promenade: number; // paved strip between the ring road and the sea
  removeRoadFraction: number; // share of inner road segments turned into plazas
  parkChance: number;
  roadworksChance: number; // chance per site slot (up to 3) of a junction closed for repairs
  canalRampChance: number; // chance of a ramp built to jump a canal (cities with canals only)
}

export const DEFAULT_CITY: CityConfig = {
  blocks: 12,
  blockSize: 60,
  roadWidth: 12,
  sidewalk: 3,
  promenade: 10,
  removeRoadFraction: 0.1,
  parkChance: 0.08,
  roadworksChance: 0.5,
  canalRampChance: 0.2,
  hillChance: 0.75,
  hillHeight: [8, 22],
  maxGrade: 0.11,
  canalOdds: [0.3, 0.45, 0.25],
  canalWidth: [12, 100],
  bridgeSpacing: [3, 5],
};

export type District = 'downtown' | 'midtown' | 'residential' | 'industrial';

/** Axis-aligned rectangle: centre (x, z), size w (along X) × d (along Z). */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Building extends Rect {
  h: number;
  district: District;
  /** 0..1 per-building variation used for colour and window pattern. */
  variant: number;
}

export interface Block {
  rect: Rect;
  district: District;
  park: boolean;
  square?: boolean; // town square: paved, no buildings, centrepiece landmark
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
  roadMarks: RoadMark[]; // zebra crossings and stop lines
  roadworks: Roadworks[]; // the rare closed junctions (usually none)
  terrain: Terrain; // hill, canals and their bridges
  spawn: { x: number; z: number; yaw: number };
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

export function generateCity(seed: number, config: CityConfig = DEFAULT_CITY): CityData {
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
  const edgeIndex = new Map(edges.map((e) => [`${e.horizontal ? 'h' : 'v'}${e.i},${e.j}`, e]));
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
  const shape = planTerrain(new Rng(seed ^ 0x7e44a1), config, n, line, islandSize / 2);
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
  for (const c of shape.canals) {
    const crossing = c.axis === 'x' ? alongZ : alongX;
    const runs: number[][] = [[]];
    for (let k = 0; k <= n; k++) {
      if (crossing.has(k)) runs.push([]); // the canals' crossing: open water
      else runs[runs.length - 1].push(k);
    }
    const bridged = new Set(pickBridges(bridgeRng, runs, config.bridgeSpacing));
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
  const terrain: Terrain = { ...shape, bridges, land: landPieces(islandSize / 2, shape.canals) };
  const openNodes = nodes.filter((nd) => nd.neighbors.length).length;

  // Turn some inner segments into plazas. The outer ring always stays; no dead ends are allowed
  // (degree ≥ 2) and the network must stay connected.
  const isBorder = (e: Edge) => (e.horizontal ? e.j === 0 || e.j === n : e.i === 0 || e.i === n);
  const candidates = edges.filter((e) => !isBorder(e) && !e.canal && !e.removed);
  shuffle(candidates, rng);
  let toRemove = Math.round(candidates.length * config.removeRoadFraction);
  for (const e of candidates) {
    if (toRemove === 0) break;
    if (nodes[e.a].neighbors.length <= 2 || nodes[e.b].neighbors.length <= 2) continue;
    link(e, false);
    if (graph.reachable(e.a).size === openNodes) {
      e.removed = true;
      toRemove--;
    } else {
      link(e, true);
    }
  }

  const edgeRect = (e: Edge): Rect =>
    e.horizontal
      ? { x: (line(e.i) + line(e.i + 1)) / 2, z: line(e.j), w: blockSize, d: roadWidth }
      : { x: line(e.i), z: (line(e.j) + line(e.j + 1)) / 2, w: roadWidth, d: blockSize };
  const roads = edges.filter((e) => !e.removed && !e.canal).map((e) => ({ a: e.a, b: e.b, rect: edgeRect(e) }));
  const plazaEdges = edges.filter((e) => e.removed && !quaySquares.includes(e));
  const intersections = nodes.filter((nd) => nd.neighbors.length).map((nd) => ({ x: nd.x, z: nd.z, w: roadWidth, d: roadWidth }));

  // --- Districts: downtown core by distance, then smooth noise splits residential/industrial ---
  const noise = makeValueNoise(rng, 4);
  const blocksOut: Block[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const rect = { x: line(i) + pitch / 2, z: line(j) + pitch / 2, w: blockSize, d: blockSize };
      const dist = Math.hypot(rect.x, rect.z) / (size / 2);
      const district: District =
        dist < 0.32 ? 'downtown' : dist < 0.6 ? 'midtown' : noise(i / n, j / n) < 0.55 ? 'residential' : 'industrial';
      blocksOut.push({ rect, district, park: district !== 'downtown' && rng.next() < config.parkChance });
    }
  }

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

  // --- Town squares, park centrepieces and the jump ramp (own RNG stream). The ramp wants a
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
  const planned = planLandmarks(blocksOut, buildings, trees, config, new Rng(seed ^ 0x1a4d), rampSpots);
  ({ buildings, trees } = planned);
  const landmarks = planned.landmarks;
  const ramp = landmarks.find((l) => l.kind === 'ramp');
  const rampStreet = rampStreets.find((e) => {
    const r = edgeRect(e);
    return ramp && r.x === ramp.x && r.z === ramp.z;
  });
  // Junctions either side of the ramp street (and of a canal ramp's run-up) stay clear of roadworks.
  const rampNodes = rampStreet ? [rampStreet.a, rampStreet.b, inLine(rampStreet, -1)!.a, inLine(rampStreet, 1)!.b] : [];

  // --- Rarely, a ramp built to jump a canal: at a street that ends at the quay with a road behind
  // it for the run-up and the street's other half across the water to land on. Sized to the
  // canal. ---
  const canalRng = new Rng(seed ^ 0xca7a1);
  if (shape.canals.length && canalRng.next() < config.canalRampChance) {
    const spots = quaySquares.flatMap((e) => {
      const aWet = canalNodes.has(e.a);
      if (aWet === canalNodes.has(e.b)) return [];
      const dir = aWet ? -1 : 1; // toward the water
      const runUp = inLine(e, -dir);
      const across = inLine(e, dir); // shares the wet junction
      if (!isRoad(runUp) || !across || !quaySquares.includes(across)) return [];
      const wet = nodes[aWet ? e.a : e.b];
      const canal = shape.canals.find((c) => (e.horizontal ? c.axis === 'z' && c.at === wet.x : c.axis === 'x' && c.at === wet.z));
      if (!canal) return [];
      const lipAt = canal.at - dir * (canal.half + 2); // just back from the quay edge
      const rampShape = canalRampShape(canal.half * 2 + 8); // over the far parapet line with room for the car
      if (-rampShape.toe > blockSize - 8) return [];
      const far = dir > 0 ? runUp!.a : runUp!.b;
      return [{
        landmark: {
          kind: 'ramp', yaw: yawAlong(e, dir), radius: 1.5, shape: rampShape, crossing: canal.at,
          x: e.horizontal ? lipAt : wet.x, z: e.horizontal ? wet.z : lipAt,
        } satisfies Landmark,
        nodes: [aWet ? e.b : e.a, far],
      }];
    });
    if (spots.length) {
      const pick = canalRng.pick(spots);
      landmarks.push(pick.landmark);
      rampNodes.push(...pick.nodes);
    }
  }

  // --- Plazas: paved shortcuts with planters to weave between ---
  const plazas: Rect[] = [];
  const props: Rect[] = [];
  for (const e of plazaEdges) {
    const r = edgeRect(e);
    plazas.push(r);
    if (e === rampStreet) continue; // no planters on the ramp's run
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
  const centre = graph.nearest(0, 0);
  const next = nodes[rng.pick(centre.neighbors)];
  const dx = next.x - centre.x;
  const dz = next.z - centre.z;
  const len = Math.hypot(dx, dz);
  const spawn = { x: centre.x + (dx / len) * 15, z: centre.z + (dz / len) * 15, yaw: Math.atan2(dx, dz) };

  // Roadworks close junctions away from the spawn (and off the bridges), before signs and signals go up.
  const keepOpen = new Set([centre.id, ...centre.neighbors, ...centre.neighbors.flatMap((id) => nodes[id].neighbors), ...canalNodes, ...rampNodes]);
  const works = planRoadworks(graph, roadWidth, size, keepOpen, config.roadworksChance, new Rng(seed ^ 0x0c0e5));
  // Own RNG stream so adding furniture never reshuffles the layout of existing seeds.
  const traffic = generateTrafficControl(graph, blocksOut, config, size, new Rng(seed ^ 0x7aff1c));
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
  return {
    config, seed, size, islandSize, graph, roads, intersections, plazas, blocks: blocksOut,
    // A footpath's width of quay is left clear along the water.
    buildings: buildings.filter((b) => !inCanal(terrain, b.x, b.z, Math.max(b.w, b.d) / 2 + config.sidewalk)),
    props: props.filter((p) => dry(p.x, p.z, Math.max(p.w, p.d) / 2)),
    trees: keptTrees,
    landmarks: landmarks.filter((l) => dry(l.x, l.z, l.radius)),
    streetProps,
    roadMarks: traffic.marks.filter((m) => dry(m.x, m.z, 0)),
    roadworks: works.sites, terrain, spawn,
  };
}

// Lot layout and height ranges per district.
const DISTRICT_STYLE: Record<District, { lots: [number, number]; height: [number, number]; gap: [number, number]; empty: number }> = {
  downtown: { lots: [1, 2], height: [35, 95], gap: [1, 3], empty: 0 },
  midtown: { lots: [2, 3], height: [12, 34], gap: [1, 2.5], empty: 0.08 },
  residential: { lots: [3, 4], height: [5, 11], gap: [2.5, 4], empty: 0.12 },
  industrial: { lots: [1, 2], height: [7, 14], gap: [2, 4], empty: 0.1 },
};

function fillBlock(block: Block, sidewalk: number, rng: Rng, out: Building[], trees: { x: number; z: number }[]): void {
  const style = DISTRICT_STYLE[block.district];
  const inner = shrink(block.rect, sidewalk);
  const nx = rng.int(style.lots[0], style.lots[1]);
  const nz = rng.int(style.lots[0], style.lots[1]);
  const xs = splitPoints(inner.x - inner.w / 2, inner.w, nx, rng);
  const zs = splitPoints(inner.z - inner.d / 2, inner.d, nz, rng);
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const lot = { x: (xs[a] + xs[a + 1]) / 2, z: (zs[b] + zs[b + 1]) / 2, w: xs[a + 1] - xs[a], d: zs[b + 1] - zs[b] };
      if (rng.next() < style.empty) {
        if (block.district === 'residential') scatterTrees(lot, 2, rng.int(1, 3), rng, trees);
        continue;
      }
      const gap = rng.range(style.gap[0], style.gap[1]);
      const fp = shrink(lot, gap);
      if (fp.w < 4 || fp.d < 4) continue;
      // Taller towards the very centre of downtown.
      let h = rng.range(style.height[0], style.height[1]);
      if (block.district === 'downtown') h *= 1.25 - Math.min(Math.hypot(lot.x, lot.z) / 250, 0.5);
      out.push({ ...fp, h: Math.round(h * 10) / 10, district: block.district, variant: rng.next() });
    }
  }
}

function scatterTrees(area: Rect, margin: number, count: number, rng: Rng, out: { x: number; z: number }[]): void {
  const r = shrink(area, margin);
  if (r.w <= 0 || r.d <= 0) return;
  const placed: { x: number; z: number }[] = [];
  for (let attempt = 0; attempt < count * 6 && placed.length < count; attempt++) {
    const p = { x: r.x + (rng.next() - 0.5) * r.w, z: r.z + (rng.next() - 0.5) * r.d };
    if (placed.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 5)) placed.push(p);
  }
  out.push(...placed);
}

/** Split [start, start+length] into `parts` with jittered boundaries. */
function splitPoints(start: number, length: number, parts: number, rng: Rng): number[] {
  const pts = [start];
  for (let k = 1; k < parts; k++) pts.push(start + (length * (k + (rng.next() - 0.5) * 0.4)) / parts);
  pts.push(start + length);
  return pts;
}

function shrink(r: Rect, m: number): Rect {
  return { x: r.x, z: r.z, w: r.w - m * 2, d: r.d - m * 2 };
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
