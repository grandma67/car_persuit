// Roadworks sites: a junction, or a whole block of road, closed for repairs. Each of up to
// MAX_SITES slots rolls the chance on its own. A site's roads are taken out of the graph (so cops
// and traffic route around it), and every site is laid out at random: which machines are parked
// (mixer, backhoe, tipper), what's being worked on (a fenced-off dig, a dirt mound, pipes waiting
// to go in), a light tower or a portable toilet, all set down at odd angles wherever they fit, and
// each approach closed by a line of cones (a few knocked askew) or a row of barrier boards.
// Pure data — RoadworksSite builds the meshes.
import type { Rng } from '../core/Rng';
import type { RoadGraph } from './RoadGraph';
import type { StreetProp } from './StreetProps';

export type WorksItemKind = 'mixer' | 'backhoe' | 'tipper' | 'dig' | 'mound' | 'pipes' | 'tower' | 'toilet' | 'barrier' | 'patch';

export interface WorksItem {
  kind: WorksItemKind;
  x: number;
  z: number;
  /** Heading of the item's +Z (its front), as a rotation about Y. */
  yaw: number;
  /** Half extents of the footprint: across (x) and along (z) the item. */
  hw: number;
  hl: number;
}

export interface Roadworks {
  kind: 'junction' | 'road';
  x: number; // centre
  z: number;
  /** The closed junction ('junction' sites). */
  node: number | null;
  /** The closed road's two junctions ('road' sites). */
  edge: [number, number] | null;
  items: WorksItem[];
}

const CONE_LINE = 2.6; // metres past the junction edge
const END_LINE = 1.2; // a closed road's barrier line, metres in from the junction edge
const ROAD_SITE_CHANCE = 0.45; // otherwise a junction
const GAP = 0.6; // clearance kept between items
export const MAX_SITES = 20;

/** Footprint half extents (across, along) and whether it's solid; 'patch' is sized per site. */
const FOOTPRINT: Record<Exclude<WorksItemKind, 'patch'>, { hw: number; hl: number }> = {
  mixer: { hw: 1.25, hl: 4.35 },
  backhoe: { hw: 1.2, hl: 3.3 },
  tipper: { hw: 1.25, hl: 3.6 },
  dig: { hw: 2.0, hl: 2.6 },
  mound: { hw: 1.5, hl: 1.9 },
  pipes: { hw: 1.1, hl: 1.6 },
  tower: { hw: 0.7, hl: 1.1 },
  toilet: { hw: 0.65, hl: 0.65 },
  barrier: { hw: 0.2, hl: 1.0 },
};
const MACHINES: WorksItemKind[] = ['mixer', 'backhoe', 'tipper'];
const EXTRAS: WorksItemKind[] = ['dig', 'mound', 'pipes', 'pipes', 'tower', 'toilet'];

/**
 * Maybe close some junctions and roads: each of MAX_SITES slots rolls `chance`. `avoid`: node ids
 * that must stay open (around the spawn). Returns the sites (often none) and their cones, and
 * unlinks the closed roads. Sites are kept apart: nothing within two roads of another site.
 */
export function planRoadworks(
  graph: RoadGraph,
  roadWidth: number,
  size: number,
  avoid: Set<number>,
  chance: number,
  rng: Rng,
): { sites: Roadworks[]; cones: StreetProp[] } {
  const sites: Roadworks[] = [];
  const cones: StreetProp[] = [];
  const keepOpen = new Set(avoid);
  for (let slot = 0; slot < MAX_SITES; slot++) {
    if (rng.next() >= chance) continue;
    const road = rng.next() < ROAD_SITE_CHANCE;
    const closed = (road ? closeRoad : closeJunction)(graph, roadWidth, size, keepOpen, rng) ?? (road ? closeJunction : closeRoad)(graph, roadWidth, size, keepOpen, rng);
    if (!closed) break; // nowhere left to put one
    sites.push(closed.site);
    cones.push(...closed.cones);
    for (const id of closed.near) {
      keepOpen.add(id);
      for (const far of graph.nodes[id].neighbors) keepOpen.add(far);
    }
  }
  return { sites, cones };
}

type Closed = { site: Roadworks; cones: StreetProp[]; near: number[] };

/** Every open junction still reachable from any other, and none left a dead end. */
function networkOk(graph: RoadGraph, from: number): boolean {
  const open = graph.nodes.filter((n) => n.neighbors.length);
  return open.every((n) => n.neighbors.length >= 2) && graph.reachable(from).size === open.length;
}

const unlink = (graph: RoadGraph, a: number, b: number) => {
  const list = graph.nodes[a].neighbors;
  list.splice(list.indexOf(b), 1);
};

/** Close one inner junction that keeps the network connected with no dead ends, or null. */
function closeJunction(graph: RoadGraph, roadWidth: number, size: number, avoid: Set<number>, rng: Rng): Closed | null {
  const inner = size / 2 - roadWidth * 2;
  const candidates = graph.nodes.filter(
    (n) =>
      !avoid.has(n.id) &&
      Math.abs(n.x) < inner &&
      Math.abs(n.z) < inner &&
      n.neighbors.length >= 3 &&
      n.neighbors.every((id) => graph.nodes[id].neighbors.length >= 3),
  );
  while (candidates.length) {
    const node = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
    const neighbors = [...node.neighbors];
    for (const id of neighbors) unlink(graph, id, node.id);
    node.neighbors = [];
    if (networkOk(graph, neighbors[0])) {
      const frame = { x: node.x, z: node.z, ax: 1, az: 0 };
      if (rng.next() < 0.5) [frame.ax, frame.az] = [0, 1];
      const half = roadWidth / 2;
      const reach = half + CONE_LINE - 1.2;
      const edge = half - 0.3;
      // The roads that met here, as site-local directions (u along the axis, v across it).
      const arms = neighbors.map((id) => {
        const n = graph.nodes[id];
        const u = (n.x - node.x) * frame.ax + (n.z - node.z) * frame.az;
        const v = -(n.x - node.x) * frame.az + (n.z - node.z) * frame.ax;
        return Math.abs(u) > Math.abs(v) ? { alongU: true, sign: Math.sign(u) } : { alongU: false, sign: Math.sign(v) };
      });
      // Inside the junction box, or a little way up one of its roads (short of the cones); never
      // over a corner pavement or the kerb where a T-junction has no road.
      const inside = (u: number, v: number) =>
        (Math.abs(u) <= edge && Math.abs(v) <= edge) ||
        arms.some((a) => (a.alongU ? Math.abs(v) <= edge && u * a.sign > 0 && Math.abs(u) <= reach : Math.abs(u) <= edge && v * a.sign > 0 && Math.abs(v) <= reach));
      const items: WorksItem[] = [patch(frame, rng, 5, 8, 4, 7)];
      const picks = [...pickSome(MACHINES, rng.int(1, 2), rng), ...pickSome(EXTRAS, rng.int(1, 3), rng)];
      items.push(...scatter(frame, picks, half + 2, half + 2, inside, rng, true));

      const cones: StreetProp[] = [];
      for (const id of neighbors) {
        const n = graph.nodes[id];
        const len = Math.hypot(n.x - node.x, n.z - node.z);
        closeApproach(node.x, node.z, (n.x - node.x) / len, (n.z - node.z) / len, half + CONE_LINE, half, rng, cones, items);
      }
      // A cone on most corners of the junction.
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          if (rng.next() < 0.85) cones.push(cone(node.x + cx * (half - 0.8) + rng.range(-0.3, 0.3), node.z + cz * (half - 0.8) + rng.range(-0.3, 0.3)));
        }
      }
      const site: Roadworks = { kind: 'junction', x: node.x, z: node.z, node: node.id, edge: null, items };
      return { site, cones, near: neighbors };
    }
    node.neighbors = neighbors;
    for (const id of neighbors) graph.nodes[id].neighbors.push(node.id);
  }
  return null;
}

/** Close one block of road between two junctions, keeping the network connected, or null. */
function closeRoad(graph: RoadGraph, roadWidth: number, size: number, avoid: Set<number>, rng: Rng): Closed | null {
  const inner = size / 2 - roadWidth * 2;
  const edges: [number, number][] = [];
  for (const a of graph.nodes) {
    for (const b of a.neighbors) {
      const ok = (n: typeof a) => !avoid.has(n.id) && n.neighbors.length >= 3 && Math.abs(n.x) < inner + roadWidth && Math.abs(n.z) < inner + roadWidth;
      if (a.id < b && ok(a) && ok(graph.nodes[b]) && Math.abs((a.x + graph.nodes[b].x) / 2) < inner && Math.abs((a.z + graph.nodes[b].z) / 2) < inner) edges.push([a.id, b]);
    }
  }
  while (edges.length) {
    const [ia, ib] = edges.splice(rng.int(0, edges.length - 1), 1)[0];
    unlink(graph, ia, ib);
    unlink(graph, ib, ia);
    if (networkOk(graph, ia)) {
      const a = graph.nodes[ia];
      const b = graph.nodes[ib];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const frame = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, ax: (b.x - a.x) / len, az: (b.z - a.z) / len };
      const half = roadWidth / 2;
      const halfLen = len / 2 - half; // the road between the two junction boxes
      const inside = (u: number, v: number) => Math.abs(u) <= halfLen - END_LINE - 2 && Math.abs(v) <= half - 0.3;
      // What's being dug up, maybe a repair patch or two, and whatever came to do it.
      const items: WorksItem[] = [];
      for (let k = rng.int(0, 2); k > 0; k--) items.push(patch({ ...frame }, rng, 4, 12, 3, 5, rng.range(-halfLen + 8, halfLen - 8), rng.range(-2, 2)));
      const picks: WorksItemKind[] = ['dig', ...pickSome(MACHINES, rng.int(0, 2), rng), ...pickSome(EXTRAS, rng.int(0, 3), rng)];
      items.push(...scatter(frame, picks, halfLen, half, inside, rng, false));

      const cones: StreetProp[] = [];
      for (const [end, s] of [[a, -1], [b, 1]] as const) {
        // Closed right at the mouth of each junction, facing traffic coming out of it.
        closeApproach(end.x, end.z, -s * frame.ax, -s * frame.az, half + END_LINE, half, rng, cones, items);
      }
      const site: Roadworks = { kind: 'road', x: frame.x, z: frame.z, node: null, edge: [ia, ib], items };
      return { site, cones, near: [ia, ib] };
    }
    graph.nodes[ia].neighbors.push(ib);
    graph.nodes[ib].neighbors.push(ia);
  }
  return null;
}

type Frame = { x: number; z: number; ax: number; az: number };
/** World point at `u` along the frame's axis and `v` to its right. */
const toWorld = (f: Frame, u: number, v: number) => ({ x: f.x + f.ax * u - f.az * v, z: f.z + f.az * u + f.ax * v });

function cone(x: number, z: number, yaw = 0): StreetProp {
  return { kind: 'cone', x, z, yaw };
}

/** A few distinct picks from `pool` (duplicates in the pool make an entry likelier). */
function pickSome<T>(pool: T[], count: number, rng: Rng): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < count && left.length) {
    const p = left.splice(rng.int(0, left.length - 1), 1)[0];
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

function patch(f: Frame, rng: Rng, minL: number, maxL: number, minW: number, maxW: number, u = 0, v = 0): WorksItem {
  const p = toWorld(f, u, v);
  const yaw = Math.atan2(f.ax, f.az) + rng.range(-0.15, 0.15);
  return { kind: 'patch', x: p.x, z: p.z, yaw, hw: rng.range(minW, maxW) / 2, hl: rng.range(minL, maxL) / 2 };
}

/**
 * Set each pick down at a random spot and angle where it fits: every footprint corner passes
 * `inside` (site-local u along the road, v across) and nothing overlaps. Machines mostly line up
 * with a road; in a junction they can sit across it. Picks that never fit are left out.
 */
function scatter(f: Frame, picks: WorksItemKind[], uMax: number, vMax: number, inside: (u: number, v: number) => boolean, rng: Rng, anyAxis: boolean): WorksItem[] {
  const placed: { item: WorksItem; corners: P[] }[] = [];
  for (const kind of picks) {
    const { hw, hl } = FOOTPRINT[kind as Exclude<WorksItemKind, 'patch'>];
    const machine = MACHINES.includes(kind);
    for (let attempt = 0; attempt < 60; attempt++) {
      const u = rng.range(-uMax, uMax);
      const v = rng.range(-vMax, vMax);
      // Local heading (0 = along the road): machines squared up give or take, the rest anyhow.
      const turn = anyAxis ? rng.int(0, 3) * (Math.PI / 2) : rng.int(0, 1) * Math.PI;
      const local = machine ? turn + rng.range(-0.45, 0.45) : rng.range(0, Math.PI * 2);
      const corners = footprint(u, v, local, hw, hl);
      if (!corners.every((c) => inside(c.x, c.z))) continue;
      const padded = footprint(u, v, local, hw + GAP / 2, hl + GAP / 2);
      if (placed.some((p) => overlaps(p.corners, padded))) continue;
      const w = toWorld(f, u, v);
      // Local heading → world yaw: forward in site space is (cos, sin) over (axis, right).
      const fx = f.ax * Math.cos(local) - f.az * Math.sin(local);
      const fz = f.az * Math.cos(local) + f.ax * Math.sin(local);
      placed.push({ item: { kind, x: w.x, z: w.z, yaw: Math.atan2(fx, fz), hw, hl }, corners: padded });
      break;
    }
  }
  return placed.map((p) => p.item);
}

type P = { x: number; z: number };
/** Corners of a footprint centred at (u, v), its length along local heading `h`. */
function footprint(u: number, v: number, h: number, hw: number, hl: number): P[] {
  const fu = Math.cos(h);
  const fv = Math.sin(h);
  return [
    [1, 1], [1, -1], [-1, -1], [-1, 1],
  ].map(([a, b]) => ({ x: u + fu * hl * a - fv * hw * b, z: v + fv * hl * a + fu * hw * b }));
}

/** Separating-axis test for two convex quads. */
export function overlaps(a: P[], b: P[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.z - p.z;
      const nz = p.x - q.x;
      const proj = (pts: P[]) => pts.map((c) => c.x * nx + c.z * nz);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

/**
 * Close the road running out from (cx, cz) in direction (dx, dz), `dist` metres out: a line of
 * cones (spacing a little uneven, the odd one knocked out of line) or barrier boards with a cone
 * at each end.
 */
function closeApproach(cx: number, cz: number, dx: number, dz: number, dist: number, half: number, rng: Rng, cones: StreetProp[], items: WorksItem[]): void {
  const at = (along: number, across: number) => ({ x: cx + dx * along - dz * across, z: cz + dz * along + dx * across });
  const yaw = Math.atan2(-dz, dx); // boards stand across the road
  if (rng.next() < 0.4) {
    const boards = rng.int(2, 3);
    const span = half - 1.4;
    for (let k = 0; k < boards; k++) {
      const s = boards === 1 ? 0 : -span + (2 * span * k) / (boards - 1);
      const p = at(dist + rng.range(-0.2, 0.2), s + rng.range(-0.3, 0.3));
      items.push({ kind: 'barrier', x: p.x, z: p.z, yaw: yaw + rng.range(-0.08, 0.08), ...FOOTPRINT.barrier });
    }
    for (const s of [-1, 1]) {
      const p = at(dist, s * (half - 0.6));
      cones.push(cone(p.x, p.z));
    }
    return;
  }
  const count = rng.int(5, 7);
  const span = half - 1;
  for (let k = 0; k < count; k++) {
    const along = dist + rng.range(-0.25, 0.25);
    const across = -span + (2 * span * k) / (count - 1) + rng.range(-0.3, 0.3);
    if (rng.next() < 0.12) {
      // Clipped by a car: knocked out of line (but not onto another cone).
      const knocked = at(along + rng.range(-1.5, 1.5), across + rng.range(-0.8, 0.8));
      const lineAt = at(along, across);
      const neighbours = [at(dist, across - (2 * span) / (count - 1)), at(dist, across + (2 * span) / (count - 1))];
      if (neighbours.every((n) => Math.hypot(n.x - knocked.x, n.z - knocked.z) > 1.2)) {
        cones.push(cone(knocked.x, knocked.z, rng.range(0, Math.PI * 2)));
        continue;
      }
      cones.push(cone(lineAt.x, lineAt.z, rng.range(0, Math.PI * 2)));
      continue;
    }
    const p = at(along, across);
    cones.push(cone(p.x, p.z, rng.range(0, Math.PI * 2)));
  }
}
