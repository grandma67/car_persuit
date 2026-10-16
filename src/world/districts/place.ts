// Which districts a seed gets, and where each one goes. Pure data.
import { Rng } from '../../core/Rng';
import { DISTRICTS } from '../../gameplay/balance';
import type { CityData, Zone, Rect } from '../CityGenerator';
import { emptyDressing, type Gate, type District, type DistrictDef, type DistrictKind } from './District';

/** A road-grid edge as the generator left it. */
export interface GridEdge {
  a: number;
  b: number;
  horizontal: boolean; // runs along X
  i: number; // grid coords of its lower node
  j: number;
  kind: 'road' | 'plaza' | 'quay' | 'canal';
}

/** What placement needs to know about the grid beyond CityData. */
export interface DistrictGrid {
  n: number; // blocks per side
  line: (i: number) => number; // grid line i's coordinate
  nodeId: (i: number, j: number) => number;
  edges: GridEdge[];
  canalNodes: Set<number>; // junctions on a canal's line (bridges, quays)
  blockedNodes: Set<number>; // ramp run-ups and landings: never interior junctions
  /** Roadworks: closed junctions and closed roads (their two junctions). */
  works: { node: number | null; edge: [number, number] | null }[];
  fast: Set<string>; // fast stretches (speed90), "a>b"
}

/** URL overrides: true forces a district's roll on, false off. */
export type DistrictForce = Partial<Record<DistrictKind, boolean>>;

/**
 * Each definition rolls its own chance on its own stream (seed ^ salt), so adding a district never
 * changes which districts older seeds get. Returns the rolled-on definitions with their streams,
 * in registry order; the stream carries on into placement and dressing.
 */
export function rollDistricts(seed: number, defs: DistrictDef[], force: DistrictForce = {}): { def: DistrictDef; rng: Rng }[] {
  const out: { def: DistrictDef; rng: Rng }[] = [];
  for (const def of defs) {
    const rng = new Rng(seed ^ def.salt);
    const rolled = rng.next() < def.chance;
    if (force[def.kind] ?? rolled) out.push({ def, rng });
  }
  return out;
}

export const edgeKey = (a: number, b: number) => `${a}>${b}`;

/** Grid rectangles of one shape (both ways round) whose blocks suit the definition. */
function candidates(def: DistrictDef, [a, b]: [number, number], grid: DistrictGrid, city: CityData): { i0: number; j0: number; w: number; h: number }[] {
  const { n } = grid;
  const ring = DISTRICTS.outerRing;
  const out: { i0: number; j0: number; w: number; h: number }[] = [];
  const sizes = new Map<string, [number, number]>([[`${a}x${b}`, [a, b]], [`${b}x${a}`, [b, a]]]);
  for (const [w, h] of sizes.values()) {
    for (let j0 = 0; j0 + h <= n; j0++) {
      for (let i0 = 0; i0 + w <= n; i0++) {
        const touches = i0 === 0 || j0 === 0 || i0 + w === n || j0 + h === n;
        if (def.site === 'inland' && (i0 < ring || j0 < ring || i0 + w > n - ring || j0 + h > n - ring)) continue;
        if (def.site === 'edge' && !touches) continue;
        if (def.site === 'coast') {
          // The long side lies on the grid's outer row or column.
          const onRow = j0 === 0 || j0 + h === n;
          const onCol = i0 === 0 || i0 + w === n;
          if (w > h ? !onRow : h > w ? !onCol : !(onRow || onCol)) continue;
        }
        const zones: Zone[] = [];
        for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) zones.push(city.blocks[j * n + i].zone);
        if (!zones.every((d) => def.rings.includes(d))) continue;
        const share = Object.entries(def.minShare ?? {}) as [Zone, number][];
        if (share.some(([d, min]) => zones.filter((x) => x === d).length < min * zones.length)) continue;
        if (def.minCore && zones.filter((x) => x === 'downtown' || x === 'midtown').length < def.minCore * zones.length) continue;
        out.push({ i0, j0, w, h });
      }
    }
  }
  return out;
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

const overlaps = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;

/**
 * Place one district: its size is rolled first (so big ones turn up as often as small ones), then
 * the first shuffled candidate of that size that passes every check; failing that, the smaller
 * sizes, largest first (never a bigger one). Null: the district sits this seed out. `earlier`:
 * districts already placed, kept at least a block away.
 */
export function placeDistrict(def: DistrictDef, grid: DistrictGrid, city: CityData, rng: Rng, earlier: District[]): District | null {
  const rolled = def.shapes[rng.int(0, def.shapes.length - 1)];
  const area = (s: [number, number]) => s[0] * s[1];
  const rest = def.shapes.filter((s) => area(s) < area(rolled)).sort((u, v) => area(v) - area(u));
  for (const shape of [rolled, ...rest]) {
    const list = candidates(def, shape, grid, city);
    shuffle(list, rng);
    for (const c of list) {
      const q = tryPlace(def, grid, city, rng, earlier, c);
      if (q) return q;
    }
  }
  return null;
}

function tryPlace(
  def: DistrictDef, grid: DistrictGrid, city: CityData, rng: Rng, earlier: District[],
  { i0, j0, w, h }: { i0: number; j0: number; w: number; h: number },
): District | null {
  const { n, line, nodeId } = grid;
  const { roadWidth: rw, sidewalk } = city.config;
  // Within one block of an earlier district.
  for (const o of earlier) {
    const g = o.grid;
    if (i0 - 1 < g.i0 + g.w && g.i0 < i0 + w + 1 && j0 - 1 < g.j0 + g.h && g.j0 < j0 + h + 1) return null;
  }
  const nodes = new Set<number>();
  const perimeter: number[] = [];
  const interior: number[] = [];
  for (let j = j0; j <= j0 + h; j++) {
    for (let i = i0; i <= i0 + w; i++) {
      const id = nodeId(i, j);
      nodes.add(id);
      (i === i0 || i === i0 + w || j === j0 || j === j0 + h ? perimeter : interior).push(id);
    }
  }
  // Canals, quays and bridges anywhere; ramp run-ups and landings inside (a ramp on its perimeter
  // streets is ruled out below). The spawn may be inside: the run then starts in the district.
  for (const id of nodes) if (grid.canalNodes.has(id)) return null;
  for (const id of interior) if (grid.blockedNodes.has(id)) return null;
  // Roadworks may be anywhere: a street they close stays a district street (paved, walls open
  // round it) but is no way in, so it counts for neither the connection, the gates nor the main street.
  const closedNodes = new Set(grid.works.flatMap((w) => (w.node === null ? [] : [w.node])));
  const closedEdges = new Set(grid.works.flatMap((w) => (w.edge ? [edgeKey(w.edge[0], w.edge[1]), edgeKey(w.edge[1], w.edge[0])] : [])));
  const open = (e: GridEdge) => !closedNodes.has(e.a) && !closedNodes.has(e.b) && !closedEdges.has(edgeKey(e.a, e.b));
  const edges = grid.edges.filter((e) => nodes.has(e.a) && nodes.has(e.b));
  if (edges.some((e) => e.kind === 'canal' || e.kind === 'quay')) return null;
  const blocks: number[] = [];
  for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) blocks.push(j * n + i);
  // A town square inside is taken over (its centrepiece goes with the block's old contents); a
  // ramp centrepiece is ruled out below.
  const x0 = line(i0) + rw / 2;
  const x1 = line(i0 + w) - rw / 2;
  const z0 = line(j0) + rw / 2;
  const z1 = line(j0 + h) - rw / 2;
  const bounds: Rect = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
  // Ramps on the perimeter streets count too.
  const reach: Rect = { ...bounds, w: bounds.w + rw * 2, d: bounds.d + rw * 2 };
  if (city.landmarks.some((l) => l.kind === 'ramp' && overlaps(reach, { x: l.x, z: l.z, w: 0, d: 0 }))) return null;

  // Coast: the frontage is the ring road beside the long side, the promenade and a strip of sea.
  let frontage: Rect | undefined;
  let coast: { nx: number; nz: number } | undefined;
  if (def.site === 'coast') {
    const half = city.size / 2;
    const out = city.config.promenade + DISTRICTS.frontageSea;
    const alongX = w > h || (w === h && (j0 === 0 || j0 + h === n));
    if (alongX) {
      const nz = j0 === 0 ? -1 : 1;
      coast = { nx: 0, nz };
      const zIn = nz * (half - rw);
      const zOut = nz * (half + out);
      frontage = { x: (line(i0) + line(i0 + w)) / 2, z: (zIn + zOut) / 2, w: line(i0 + w) - line(i0), d: Math.abs(zOut - zIn) };
    } else {
      const nx = i0 === 0 ? -1 : 1;
      coast = { nx, nz: 0 };
      const xIn = nx * (half - rw);
      const xOut = nx * (half + out);
      frontage = { x: (xIn + xOut) / 2, z: (line(j0) + line(j0 + h)) / 2, w: Math.abs(xOut - xIn), d: line(j0 + h) - line(j0) };
    }
    const f = frontage;
    // No canal mouth and no ring-road bridge in the frontage.
    const mouth = city.terrain.canals.some((cn) =>
      cn.axis === 'x' ? Math.abs(cn.at - f.z) < f.d / 2 + cn.half : Math.abs(cn.at - f.x) < f.w / 2 + cn.half,
    );
    if (mouth || city.terrain.bridges.some((b) => overlaps(f, b))) return null;
  }

  // Interior streets: edges with district blocks on both sides. Plaza edges stay paved shortcuts.
  const isInterior = (e: GridEdge) =>
    e.horizontal ? e.i >= i0 && e.i < i0 + w && e.j > j0 && e.j < j0 + h : e.j >= j0 && e.j < j0 + h && e.i > i0 && e.i < i0 + w;
  const streetEdges = edges.filter((e) => isInterior(e) && e.kind === 'road');
  const inner = streetEdges.filter(open);
  if (!inner.length) return null;
  if (inner.some((e) => grid.fast.has(edgeKey(e.a, e.b)) || grid.fast.has(edgeKey(e.b, e.a)))) return null;
  // Connected.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const e of inner) for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id);
  for (const e of inner) parent.set(find(e.a), find(e.b));
  if (new Set([...parent.keys()].map(find)).size > 1) return null;
  // Gates: interior road edges with one end on the perimeter.
  const onPerimeter = new Set(perimeter);
  const gateEdges = inner.filter((e) => onPerimeter.has(e.a) !== onPerimeter.has(e.b));
  if (gateEdges.length < 2) return null;

  // Main street: the longest straight run of interior road edges.
  const runs: GridEdge[][] = [];
  const roadAt = new Map(inner.map((e) => [`${e.horizontal ? 'h' : 'v'}${e.i},${e.j}`, e]));
  for (let j = j0 + 1; j < j0 + h; j++) {
    let run: GridEdge[] = [];
    for (let i = i0; i <= i0 + w; i++) {
      const e = roadAt.get(`h${i},${j}`);
      if (e) run.push(e);
      else if (run.length) (runs.push(run), (run = []));
    }
  }
  for (let i = i0 + 1; i < i0 + w; i++) {
    let run: GridEdge[] = [];
    for (let j = j0; j <= j0 + h; j++) {
      const e = roadAt.get(`v${i},${j}`);
      if (e) run.push(e);
      else if (run.length) (runs.push(run), (run = []));
    }
  }
  const longest = Math.max(...runs.map((r) => r.length));
  if (longest < (def.minMainStreet ?? 1)) return null;
  // A gated main street must reach the perimeter at both ends (roadworks or a plaza may cut it short).
  const ends = (r: GridEdge[]) => [r[0], r[r.length - 1]].filter((e) => onPerimeter.has(e.a) !== onPerimeter.has(e.b)).length;
  const best = runs.filter((r) => r.length === longest);
  const through = best.filter((r) => ends(r) === 2);
  if (def.gates === 'mainStreet' && !through.length) return null;
  const main = rng.pick(through.length ? through : best);
  const mainStreet = main.map((e) => edgeKey(e.a, e.b));

  const gateOf = (e: GridEdge): Gate => {
    const [outer, inside] = onPerimeter.has(e.a) ? [e.a, e.b] : [e.b, e.a];
    const p = city.graph.nodes[outer];
    const q = city.graph.nodes[inside];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const dx = (q.x - p.x) / len;
    const dz = (q.z - p.z) / len;
    const d = rw / 2 + sidewalk; // the wall line: block edge plus sidewalk
    return { node: outer, inner: inside, edge: edgeKey(outer, inside), x: p.x + dx * d, z: p.z + dz * d, yaw: Math.atan2(dx, dz), opening: rw + 2 * sidewalk };
  };
  let chosen: GridEdge[];
  if (def.gates === 'all') chosen = gateEdges;
  else {
    // The main street's ends, then up to extraGates more; at least two in all.
    chosen = gateEdges.filter((e) => main.includes(e));
    const rest = gateEdges.filter((e) => !chosen.includes(e));
    shuffle(rest, rng);
    const extra = Math.max(rng.int(0, def.extraGates ?? 0), 2 - chosen.length);
    chosen.push(...rest.slice(0, extra));
    if (chosen.length < 2) return null;
  }

  const streets = new Set<string>();
  for (const e of streetEdges) streets.add(edgeKey(e.a, e.b)).add(edgeKey(e.b, e.a));
  return {
    kind: def.kind,
    grid: { i0, j0, w, h },
    blocks,
    roles: new Map(),
    bounds,
    frontage,
    coast,
    interior,
    perimeter,
    streets,
    mainStreet,
    gates: chosen.map(gateOf),
    dressing: emptyDressing(),
  };
}
