// Rare roadworks sites: junctions closed for repairs. Each of up to MAX_SITES slots rolls the
// rare chance on its own, so most cities have none, some one, and a few two or three. Its roads are taken out of the graph
// (so cops and traffic route around it), a concrete mixer and a backhoe tractor park in the
// middle, and lines of cones close off each approach. Pure data — RoadworksSite builds it.
import type { Rng } from '../core/Rng';
import type { RoadGraph } from './RoadGraph';
import type { StreetProp } from './StreetProps';

export interface Roadworks {
  node: number; // the closed junction
  x: number;
  z: number;
  alongX: boolean; // the trucks line up along X (else along Z)
  side: 1 | -1; // which side of the junction the mixer parks on
}

const CONE_LINE = 2.6; // metres past the junction edge
const CONE_SPACING = 2.2;
export const MAX_SITES = 20;

/**
 * Maybe close some inner junctions: each of MAX_SITES slots rolls `chance`. `avoid`: node ids that
 * must stay open (around the spawn). Returns the sites (often none) and their cones, and unlinks
 * each closed junction's roads. Sites are kept apart: never on a junction next to another site
 * or one road beyond it.
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
    const closed = closeOne(graph, roadWidth, size, keepOpen, rng);
    if (!closed) break; // nowhere left to put one
    sites.push(closed.site);
    cones.push(...closed.cones);
    for (const id of closed.neighbors) {
      keepOpen.add(id);
      for (const far of graph.nodes[id].neighbors) keepOpen.add(far);
    }
  }
  return { sites, cones };
}

/** Close one junction that keeps the network connected with no dead ends, or null if none can be. */
function closeOne(
  graph: RoadGraph,
  roadWidth: number,
  size: number,
  avoid: Set<number>,
  rng: Rng,
): { site: Roadworks; cones: StreetProp[]; neighbors: number[] } | null {
  const inner = size / 2 - roadWidth * 2;
  const candidates = graph.nodes.filter(
    (n) =>
      !avoid.has(n.id) &&
      Math.abs(n.x) < inner &&
      Math.abs(n.z) < inner &&
      n.neighbors.length >= 3 &&
      // No dead ends once it's closed.
      n.neighbors.every((id) => graph.nodes[id].neighbors.length >= 3),
  );
  while (candidates.length) {
    const node = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
    const neighbors = [...node.neighbors];
    for (const id of neighbors) {
      const list = graph.nodes[id].neighbors;
      list.splice(list.indexOf(node.id), 1);
    }
    node.neighbors = [];
    // The rest of the network must stay connected.
    const open = graph.nodes.filter((n) => n.neighbors.length).length;
    if (graph.reachable(neighbors[0]).size === open) {
      const site: Roadworks = { node: node.id, x: node.x, z: node.z, alongX: rng.next() < 0.5, side: rng.next() < 0.5 ? 1 : -1 };
      return { site, cones: placeCones(graph, site, neighbors, roadWidth), neighbors };
    }
    node.neighbors = neighbors;
    for (const id of neighbors) graph.nodes[id].neighbors.push(node.id);
  }
  return null;
}

function placeCones(graph: RoadGraph, site: Roadworks, neighbors: number[], roadWidth: number): StreetProp[] {
  const cones: StreetProp[] = [];
  const half = roadWidth / 2;
  // A line across each road into the junction.
  for (const id of neighbors) {
    const n = graph.nodes[id];
    const len = Math.hypot(n.x - site.x, n.z - site.z);
    const dx = (n.x - site.x) / len;
    const dz = (n.z - site.z) / len;
    const d = half + CONE_LINE;
    for (let off = -2; off <= 2; off++) {
      const s = off * CONE_SPACING;
      cones.push({ kind: 'cone', x: site.x + dx * d - dz * s, z: site.z + dz * d + dx * s, yaw: 0 });
    }
  }
  // And one on each corner of the junction.
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) cones.push({ kind: 'cone', x: site.x + cx * (half - 0.8), z: site.z + cz * (half - 0.8), yaw: 0 });
  }
  return cones;
}
