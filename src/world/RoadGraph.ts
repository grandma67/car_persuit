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

  nearest(x: number, z: number): RoadNode {
    let best = this.nodes[0];
    let bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
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

  /** A* shortest path as a list of node ids, or null if unreachable. */
  path(from: number, to: number): number[] | null {
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
