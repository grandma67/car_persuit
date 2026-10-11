// Road network: intersections are nodes, road segments are edges. Used for spawn points,
// destination placement and cop pathfinding. Pure data — no Three.js.

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  neighbors: number[];
}

export class RoadGraph {
  constructor(readonly nodes: RoadNode[]) {}

  distance(a: number, b: number): number {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    return Math.hypot(na.x - nb.x, na.z - nb.z);
  }

  /** Nearest junction, preferring open ones (a junction closed for roadworks has no roads). */
  nearest(x: number, z: number): RoadNode {
    let best = this.nodes[0];
    let bestD = Infinity;
    let bestOpen: RoadNode | null = null;
    let bestOpenD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
      if (n.neighbors.length && d < bestOpenD) {
        bestOpenD = d;
        bestOpen = n;
      }
    }
    return bestOpen ?? best;
  }

  /** Node ids reachable from `start` (breadth-first). */
  reachable(start: number): Set<number> {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const n of this.nodes[queue.shift()!].neighbors) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  }

  /** Road distance from `start` to every node (Dijkstra); Infinity if unreachable. */
  distancesFrom(start: number): number[] {
    const dist = this.nodes.map(() => Infinity);
    dist[start] = 0;
    const done = new Set<number>();
    while (done.size < this.nodes.length) {
      let current = -1;
      for (let i = 0; i < dist.length; i++) {
        if (!done.has(i) && dist[i] < Infinity && (current < 0 || dist[i] < dist[current])) current = i;
      }
      if (current < 0) break;
      done.add(current);
      for (const n of this.nodes[current].neighbors) {
        dist[n] = Math.min(dist[n], dist[current] + this.distance(current, n));
      }
    }
    return dist;
  }

  /**
   * The road segment closest to (x, z): its end nodes, how far along a→b we are (0..1) and how
   * far off its centre line.
   */
  nearestEdge(x: number, z: number): { a: RoadNode; b: RoadNode; u: number; off: number } {
    let best = { a: this.nodes[0], b: this.nodes[0], u: 0, off: Infinity };
    for (const a of this.nodes) {
      for (const id of a.neighbors) {
        if (id < a.id) continue; // each road once
        const b = this.nodes[id];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const len2 = abx * abx + abz * abz || 1;
        const u = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
        const off = Math.hypot(a.x + abx * u - x, a.z + abz * u - z);
        if (off < best.off) best = { a, b, u, off };
      }
    }
    return best;
  }

  /**
   * A* shortest path as a list of node ids, or null if unreachable. `noUTurnFrom`: the node we
   * arrived at `from` from — the path may not head straight back to it (unless that's the only way).
   */
  path(from: number, to: number, noUTurnFrom?: number): number[] | null {
    if (noUTurnFrom !== undefined && from !== to) {
      const banned = this.pathAvoiding(from, to, noUTurnFrom);
      if (banned) return banned;
    }
    return this.pathAvoiding(from, to);
  }

  private pathAvoiding(from: number, to: number, notFirst?: number): number[] | null {
    const g = new Map<number, number>([[from, 0]]);
    const f = new Map<number, number>([[from, this.distance(from, to)]]);
    const cameFrom = new Map<number, number>();
    const open = new Set([from]);
    while (open.size) {
      let current = -1;
      let bestF = Infinity;
      for (const id of open) {
        const fi = f.get(id)!;
        if (fi < bestF) {
          bestF = fi;
          current = id;
        }
      }
      if (current === to) {
        const path = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.unshift(current);
        }
        return path;
      }
      open.delete(current);
      for (const n of this.nodes[current].neighbors) {
        if (current === from && n === notFirst) continue;
        const tentative = g.get(current)! + this.distance(current, n);
        if (tentative < (g.get(n) ?? Infinity)) {
          cameFrom.set(n, current);
          g.set(n, tentative);
          f.set(n, tentative + this.distance(n, to));
          open.add(n);
        }
      }
    }
    return null;
  }

  pathLength(path: number[]): number {
    let total = 0;
    for (let i = 1; i < path.length; i++) total += this.distance(path[i - 1], path[i]);
    return total;
  }
}
