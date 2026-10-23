// Drivable-ground grid for cops chasing the suspect off the road network: through parks, squares
// and plazas, round statues, planters, trees and benches. Built once from the city data; A* on it
// gives a route that keeps a car's width clear of everything solid. Pure data — no Three.js
// scene or physics.
import type { CityData, Rect } from '../world/CityGenerator';
import { propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp } from '../world/StreetProps';
import { onGround } from '../world/Terrain';

type P = { x: number; z: number };

const CELL = 2; // metres
const ROAD = 10; // step cost per cell on a road…
const OFF_ROAD = 15; // …and anywhere else drivable (sidewalks, parks, plazas, the promenade)
// Penalties by distance from the nearest obstacle's edge (metres): a car's centre this close
// scrapes it, nearly so, or is just near it.
const CORE = 0.5;
const TIGHT = 1.6;
const NEAR = 3;
const PENALTY = { core: 190, tight: 70, near: 10 };
/** Props a car can plough through at a cost (they break): the route may cross them if it must. */
const SOFT: Set<PropKind> = new Set(['fence', 'cone', 'umbrella', 'sign', 'bench', 'boomGate', 'crossbuck', 'pumpkin', 'scarecrow', 'mailbox', 'milkChurn', 'feedSacks', 'wheelbarrow', 'trashBags', 'shoppingCart', 'mattress', 'tyres', 'rubble']);
const DIAG = Math.SQRT2;
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
];

type Obstacle = { fp: Footprint; hard: boolean } | { circle: P & { r: number }; hard: true };

export class NavGrid {
  readonly cell = CELL;
  readonly n: number; // cells per side
  private origin: number; // world coordinate of cell 0's lower edge (both axes)
  /** Step cost per cell; 0 = impassable (buildings, water, statues, the trunk of a tree). */
  readonly cost: Uint8Array;
  /** 1 where a car fits with room to spare (nothing within TIGHT): straight runs may cross it. */
  private clear: Uint8Array;
  // A* scratch, reused between searches; `stamp` marks which entries belong to this search.
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private search = 0;
  private heapIds: Int32Array;
  private heapF: Float32Array;

  constructor(city: CityData, extraProps: StreetProp[] = []) {
    const half = city.islandSize / 2;
    this.n = Math.ceil((half * 2) / CELL);
    this.origin = -half;
    const cells = this.n * this.n;
    this.cost = new Uint8Array(cells);
    this.clear = new Uint8Array(cells);
    const base = new Uint8Array(cells);
    const penalty = new Uint8Array(cells);
    const blocked = new Uint8Array(cells);
    const { terrain } = city;

    // Ground: the island minus the canals (bridges carry on), sea wall and quay edges tight.
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const k = j * this.n + i;
        const x = this.cx(i);
        const z = this.cx(j);
        const edge = half - Math.max(Math.abs(x), Math.abs(z));
        if (edge < CORE || !onGround(terrain, x, z)) blocked[k] = 1;
        else if (edge < TIGHT || !onGround(terrain, x, z, TIGHT)) penalty[k] = PENALTY.tight;
        base[k] = OFF_ROAD;
      }
    }
    const pave = (r: Rect) => this.eachCellIn(r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2, (k) => (base[k] = ROAD));
    city.roads.forEach((r) => pave(r.rect));
    city.intersections.forEach(pave);
    terrain.bridges.forEach(pave);
    // Districts' off-road ground (yard corridors, fields): drivable, at the off-road cost.
    for (const q of city.districts) {
      for (const r of q.dressing.drivable) this.eachCellIn(r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2, (k) => (base[k] = OFF_ROAD));
    }

    // Everything solid, and how close to it a route may come.
    const obstacles: Obstacle[] = [
      ...city.buildings.map((b) => ({ fp: rectFootprint(b), hard: true })),
      ...city.props.map((p) => ({ fp: rectFootprint(p), hard: true })), // planters
      ...city.landmarks.map((l) => ({ circle: { x: l.x, z: l.z, r: l.radius }, hard: true as const })),
      ...[...city.streetProps, ...extraProps].map((p) => ({ fp: propFootprint(p), hard: !SOFT.has(p.kind) })),
      ...city.districts.flatMap((q) => q.dressing.solids.map((fp) => ({ fp, hard: true }))), // walls, towers, stacks …
      ...city.roadworks.flatMap((site) =>
        site.items.filter((it) => it.kind !== 'patch').map((it) => ({ fp: { x: it.x, z: it.z, hx: it.hw, hz: it.hl, yaw: it.yaw }, hard: true })),
      ),
    ];
    for (const o of obstacles) {
      const reach = 'fp' in o ? Math.hypot(o.fp.hx, o.fp.hz) + NEAR : o.circle.r + NEAR;
      const c = 'fp' in o ? o.fp : o.circle;
      const dist = 'fp' in o ? footprintDistance.bind(null, o.fp) : (x: number, z: number) => Math.hypot(x - o.circle.x, z - o.circle.z) - o.circle.r;
      this.eachCellIn(c.x - reach, c.z - reach, c.x + reach, c.z + reach, (k, x, z) => {
        const d = dist(x, z);
        if (d <= CORE) {
          if (o.hard) blocked[k] = 1;
          else penalty[k] = Math.max(penalty[k], PENALTY.core);
        } else if (d <= TIGHT) penalty[k] = Math.max(penalty[k], PENALTY.tight);
        else if (d <= NEAR) penalty[k] = Math.max(penalty[k], PENALTY.near);
      });
    }
    for (let k = 0; k < cells; k++) {
      this.cost[k] = blocked[k] ? 0 : base[k] + penalty[k];
      this.clear[k] = !blocked[k] && penalty[k] < PENALTY.tight ? 1 : 0;
    }

    this.g = new Float32Array(cells);
    this.parent = new Int32Array(cells);
    this.stamp = new Uint32Array(cells);
    this.closed = new Uint32Array(cells);
    this.heapIds = new Int32Array(cells);
    this.heapF = new Float32Array(cells);
  }

  /** Centre of cell index i (either axis). */
  private cx(i: number): number {
    return this.origin + (i + 0.5) * CELL;
  }

  private index(v: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.floor((v - this.origin) / CELL)));
  }

  private eachCellIn(x0: number, z0: number, x1: number, z1: number, fn: (k: number, x: number, z: number) => void): void {
    const i0 = this.index(x0);
    const i1 = this.index(x1);
    const j0 = this.index(z0);
    const j1 = this.index(z1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) fn(j * this.n + i, this.cx(i), this.cx(j));
    }
  }

  /** Can a car drive here at all (not inside a building, statue or the water)? */
  passable(x: number, z: number): boolean {
    return this.cost[this.index(z) * this.n + this.index(x)] > 0;
  }

  /**
   * Route from `from` to `to` keeping clear of obstacles, as a polyline starting at `from` and
   * ending at `to`, with straight runs merged. Null if no way is found within `maxExpand` cells
   * searched (it's too far, or walled off) — then follow the roads instead.
   */
  findPath(from: P, to: P, maxExpand = 30000): P[] | null {
    const n = this.n;
    const start = this.index(from.z) * n + this.index(from.x);
    let goal = this.index(to.z) * n + this.index(to.x);
    if (!this.cost[goal]) {
      // The suspect is pressed against something solid: head for the nearest open cell.
      const open = this.nearestOpen(goal, 3);
      if (open < 0) return null;
      goal = open;
    }
    const gi = goal % n;
    const gj = (goal / n) | 0;
    const h = (k: number) => {
      const di = Math.abs((k % n) - gi);
      const dj = Math.abs(((k / n) | 0) - gj);
      return ROAD * (Math.max(di, dj) + (DIAG - 1) * Math.min(di, dj));
    };

    const s = ++this.search;
    let size = 0;
    const push = (k: number, f: number) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.heapF[p] <= f) break;
        this.heapIds[i] = this.heapIds[p];
        this.heapF[i] = this.heapF[p];
        i = p;
      }
      this.heapIds[i] = k;
      this.heapF[i] = f;
    };
    const pop = (): number => {
      const top = this.heapIds[0];
      const lastId = this.heapIds[--size];
      const lastF = this.heapF[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && this.heapF[c + 1] < this.heapF[c]) c++;
        if (this.heapF[c] >= lastF) break;
        this.heapIds[i] = this.heapIds[c];
        this.heapF[i] = this.heapF[c];
        i = c;
      }
      this.heapIds[i] = lastId;
      this.heapF[i] = lastF;
      return top;
    };

    this.stamp[start] = s;
    this.g[start] = 0;
    this.parent[start] = -1;
    push(start, h(start));
    let expanded = 0;
    let found = false;
    while (size > 0) {
      const k = pop();
      if (this.closed[k] === s) continue;
      this.closed[k] = s;
      if (k === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) return null;
      const ki = k % n;
      const kj = (k / n) | 0;
      // Leaving a blocked start cell (a car nosed into a wall) is allowed; entering one isn't.
      const here = this.cost[k] || OFF_ROAD + PENALTY.core;
      for (const [di, dj, len] of NEIGHBOURS) {
        const ni = ki + di;
        const nj = kj + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const m = nj * n + ni;
        const c = this.cost[m];
        if (!c || this.closed[m] === s) continue;
        // No squeezing diagonally between two solid cells.
        if (di && dj && (!this.cost[kj * n + ni] || !this.cost[nj * n + ki])) continue;
        const g = this.g[k] + ((here + c) / 2) * len;
        if (this.stamp[m] === s && g >= this.g[m]) continue;
        this.stamp[m] = s;
        this.g[m] = g;
        this.parent[m] = k;
        push(m, g + h(m));
      }
    }
    if (!found) return null;

    const cells: number[] = [];
    for (let k = goal; k >= 0; k = this.parent[k]) cells.push(k);
    cells.reverse();
    return this.smooth(from, cells, to);
  }

  /** Nearest passable cell within `radius` cells of k, or -1. */
  private nearestOpen(k: number, radius: number): number {
    const n = this.n;
    const ki = k % n;
    const kj = (k / n) | 0;
    let best = -1;
    let bestD = Infinity;
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const i = ki + di;
        const j = kj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || !this.cost[j * n + i]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = j * n + i;
        }
      }
    }
    return best;
  }

  /** Is the straight line a → b all roomy cells? */
  private straight(a: P, b: P): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(len / (CELL * 0.4));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.clear[this.index(a.z + (b.z - a.z) * t) * this.n + this.index(a.x + (b.x - a.x) * t)]) return false;
    }
    return true;
  }

  /** Cell chain → few waypoints: from each kept point, skip ahead as far as a straight run allows. */
  private smooth(from: P, cells: number[], to: P): P[] {
    const pts: P[] = [{ x: from.x, z: from.z }, ...cells.slice(1, -1).map((k) => ({ x: this.cx(k % this.n), z: this.cx((k / this.n) | 0) })), { x: to.x, z: to.z }];
    const out: P[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && this.straight(pts[i], pts[j + 1])) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

/** Distance from a point to an oriented rectangle's edge (0 inside). */
export function footprintDistance(f: Footprint, x: number, z: number): number {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const dx = x - f.x;
  const dz = z - f.z;
  const lx = dx * c - dz * s; // along local X, which lies along (cos, −sin) in world
  const lz = dx * s + dz * c; // along local Z: (sin, cos)
  return Math.hypot(Math.max(0, Math.abs(lx) - f.hx), Math.max(0, Math.abs(lz) - f.hz));
}
