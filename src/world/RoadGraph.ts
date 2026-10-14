// Road network: intersections are nodes, road segments are edges. Used for spawn points,
// destination placement and cop pathfinding. Pure data — no Three.js.

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  neighbors: number[];
}

type Dir = { x: number; z: number };

/** Extra metres a route is charged for the time a turn takes (slowing for it, or turning round). */
export interface TurnCosts {
  turn: number; // a 90° turn; sharper or gentler turns scale with the angle
  uTurn: number; // doubling back
}

export interface Route {
  ids: number[];
  cost: number; // metres of road plus turn costs
}

const STRAIGHT = 0.35; // radians: gentler than this is driving straight on, free
const U_TURN = 2.6; // radians (~150°): sharper than this is turning round

/** Cost of leaving a junction along `out` (length `outLen`) having arrived along `in`. */
export function turnCost(inX: number, inZ: number, outX: number, outZ: number, outLen: number, costs: TurnCosts): number {
  const inLen = Math.hypot(inX, inZ);
  if (inLen < 1e-6 || outLen < 1e-6) return 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, (inX * outX + inZ * outZ) / (inLen * outLen))));
  if (angle < STRAIGHT) return 0;
  if (angle > U_TURN) return costs.uTurn;
  return (costs.turn * angle) / (Math.PI / 2);
}

/** Binary min-heap of (item, priority), for A*. */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  push(item: number, key: number): void {
    let i = this.items.length;
    this.items.push(item);
    this.keys.push(key);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.keys[up] <= key) break;
      this.items[i] = this.items[up];
      this.keys[i] = this.keys[up];
      i = up;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }

  /** The item with the lowest priority, or -1 when empty. */
  pop(): number {
    if (!this.items.length) return -1;
    const top = this.items[0];
    const item = this.items.pop()!;
    const key = this.keys.pop()!;
    const size = this.items.length;
    if (size) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && this.keys[child + 1] < this.keys[child]) child++;
        if (this.keys[child] >= key) break;
        this.items[i] = this.items[child];
        this.keys[i] = this.keys[child];
        i = child;
      }
      this.items[i] = item;
      this.keys[i] = key;
    }
    return top;
  }
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

  /**
   * Cheapest route for a car, counting the time turns take as extra metres: a turn costs `turn`
   * (scaled by how sharp it is, so 90° costs `turn`; near-straight is free) and doubling back
   * costs `uTurn`. Searches (node, came-from) states, as the cost of leaving a junction depends on
   * the way in. `arrive`: direction we reach `from` in (null: free to leave in any direction).
   * `noUTurnFrom`: the first step may not go to this node, unless there is no other way.
   */
  route(from: number, to: number, costs: TurnCosts, arrive: Dir | null = null, noUTurnFrom?: number): Route | null {
    if (noUTurnFrom !== undefined && from !== to) {
      const banned = this.routeAvoiding(from, to, costs, arrive, noUTurnFrom);
      if (banned) return banned;
    }
    return this.routeAvoiding(from, to, costs, arrive);
  }

  private routeAvoiding(from: number, to: number, costs: TurnCosts, arrive: Dir | null, notFirst?: number): Route | null {
    const n = this.nodes.length;
    const start = n * n + from; // state = cameFrom * n + node; the start state has no cameFrom
    const goal = this.nodes[to];
    const h = (id: number) => Math.hypot(this.nodes[id].x - goal.x, this.nodes[id].z - goal.z);
    const cost = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const open = new MinHeap();
    const closed = new Set<number>();
    open.push(start, h(from));
    for (let state = open.pop(); state >= 0; state = open.pop()) {
      if (closed.has(state)) continue; // a stale, costlier entry for a state already expanded
      closed.add(state);
      const node = state % n;
      const g = cost.get(state)!;
      if (node === to) {
        const ids = [node];
        for (let s = state; parent.has(s); ) {
          s = parent.get(s)!;
          ids.unshift(s % n);
        }
        return { ids, cost: g };
      }
      const here = this.nodes[node];
      const prev = state === start ? -1 : Math.floor(state / n);
      const inX = prev >= 0 ? here.x - this.nodes[prev].x : (arrive?.x ?? 0);
      const inZ = prev >= 0 ? here.z - this.nodes[prev].z : (arrive?.z ?? 0);
      for (const next of here.neighbors) {
        if (state === start && next === notFirst) continue;
        const there = this.nodes[next];
        const outX = there.x - here.x;
        const outZ = there.z - here.z;
        const len = Math.hypot(outX, outZ);
        const tentative = g + len + turnCost(inX, inZ, outX, outZ, len, costs);
        const key = node * n + next;
        if (tentative < (cost.get(key) ?? Infinity)) {
          cost.set(key, tentative);
          parent.set(key, state);
          open.push(key, tentative + h(next));
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
