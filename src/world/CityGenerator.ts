// Seed → city layout as plain data. CityBuilder turns it into meshes and colliders.
import { Rng } from '../core/Rng';
import { RoadGraph, type RoadNode } from './RoadGraph';
import { generateStreetProps, type StreetProp } from './StreetProps';
import { generateTrafficControl, type RoadMark } from './TrafficControl';
import { planLandmarks, type Landmark } from './Landmarks';
import { planRoadworks, type Roadworks } from './Roadworks';

export interface CityConfig {
  blocks: number; // blocks per side
  blockSize: number; // metres
  roadWidth: number;
  sidewalk: number; // margin inside each block before lots start
  promenade: number; // paved strip between the ring road and the sea
  removeRoadFraction: number; // share of inner road segments turned into plazas
  parkChance: number;
  roadworksChance: number; // chance per site slot (up to 3) of a junction closed for repairs
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
  spawn: { x: number; z: number; yaw: number };
}

interface Edge {
  a: number;
  b: number;
  horizontal: boolean; // runs along X
  i: number; // grid coords of the edge's lower node
  j: number;
  removed: boolean;
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
      if (i < n) edges.push({ a: nodeId(i, j), b: nodeId(i + 1, j), horizontal: true, i, j, removed: false });
      if (j < n) edges.push({ a: nodeId(i, j), b: nodeId(i, j + 1), horizontal: false, i, j, removed: false });
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
  const graph = new RoadGraph(nodes);

  // Turn some inner segments into plazas. The outer ring always stays; no dead ends are allowed
  // (degree ≥ 2) and the network must stay connected.
  const isBorder = (e: Edge) => (e.horizontal ? e.j === 0 || e.j === n : e.i === 0 || e.i === n);
  const candidates = edges.filter((e) => !isBorder(e));
  shuffle(candidates, rng);
  let toRemove = Math.round(candidates.length * config.removeRoadFraction);
  for (const e of candidates) {
    if (toRemove === 0) break;
    if (nodes[e.a].neighbors.length <= 2 || nodes[e.b].neighbors.length <= 2) continue;
    link(e, false);
    if (graph.reachable(e.a).size === nodes.length) {
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
  const roads = edges.filter((e) => !e.removed).map((e) => ({ a: e.a, b: e.b, rect: edgeRect(e) }));
  const plazaEdges = edges.filter((e) => e.removed);
  const intersections = nodes.map((nd) => ({ x: nd.x, z: nd.z, w: roadWidth, d: roadWidth }));

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

  // --- Town squares and park centrepieces (own RNG stream) ---
  const planned = planLandmarks(blocksOut, buildings, trees, config, new Rng(seed ^ 0x1a4d));
  ({ buildings, trees } = planned);
  const landmarks = planned.landmarks;

  // --- Plazas: paved shortcuts with planters to weave between ---
  const plazas: Rect[] = [];
  const props: Rect[] = [];
  for (const e of plazaEdges) {
    const r = edgeRect(e);
    plazas.push(r);
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

  // --- Spawn: on a road segment next to the centre, facing along it ---
  const centre = graph.nearest(0, 0);
  const next = nodes[rng.pick(centre.neighbors)];
  const dx = next.x - centre.x;
  const dz = next.z - centre.z;
  const len = Math.hypot(dx, dz);
  const spawn = { x: centre.x + (dx / len) * 15, z: centre.z + (dz / len) * 15, yaw: Math.atan2(dx, dz) };

  const islandSize = size + config.promenade * 2;
  // Roadworks close junctions away from the spawn, before signs and signals go up.
  const keepOpen = new Set([centre.id, ...centre.neighbors, ...centre.neighbors.flatMap((id) => nodes[id].neighbors)]);
  const works = planRoadworks(graph, roadWidth, size, keepOpen, config.roadworksChance, new Rng(seed ^ 0x0c0e5));
  // Own RNG stream so adding furniture never reshuffles the layout of existing seeds.
  const traffic = generateTrafficControl(graph, blocksOut, config, size, new Rng(seed ^ 0x7aff1c));
  const streetProps = [...generateStreetProps(blocksOut, plazas, landmarks, config, size, new Rng(seed ^ 0x57ee7)), ...traffic.props, ...works.cones];
  return {
    config, seed, size, islandSize, graph, roads, intersections, plazas, blocks: blocksOut, buildings, props, trees,
    landmarks, streetProps, roadMarks: traffic.marks, roadworks: works.sites, spawn,
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
