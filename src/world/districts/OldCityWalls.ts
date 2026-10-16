// The Old City's walls: wall stretches on the block side of the sidewalk (stepped on a hill), corner
// towers, a gatehouse at each gate (flanking towers off the roadway, an arch and a raised
// portcullis over it, a timber deck patch with chains, torches, banners) and plain posts where a
// paved plaza or a street closed by roadworks crosses the wall line. Pure data; render/districts/OldCity.ts draws it.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, OLD_CITY_WALLS as W } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import type { Footprint } from '../StreetProps';
import { groundHeight } from '../Terrain';
import { perimeterWall, type WallSegment } from './apply';
import type { District, GroundPatch, Overhead, Structure } from './District';

/** One wall stretch on one footing: from (ax, az) to (bx, bz) along the wall line. */
export interface WallPiece {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number; // footing: the lower ground of its two ends
}

/** A gap in the wall where a plaza or a closed street crosses the wall line (not a gate: no gatehouse, no roadblock). */
interface Postern {
  x: number;
  z: number;
  ax: number; // unit vector along the wall
  az: number;
  nx: number; // outward normal
  nz: number;
  opening: number;
}

export interface WallPlan {
  segments: (WallSegment & { footprint: Footprint })[];
  corners: { x: number; z: number; footprint: Footprint }[];
  gates: { towers: Footprint[]; nx: number; nz: number; ax: number; az: number }[];
  posterns: (Postern & { posts: Footprint[] })[];
  /** Every solid of the walls, for colliders, NavGrid and keeping buildings and props clear. */
  solids: Footprint[];
}

/** An axis-aligned footprint from its centre and half sizes. */
const fp = (x: number, z: number, hx: number, hz: number): Footprint => ({ x, z, hx, hz, yaw: 0 });

/** The wall line: the district's blocks inset by the sidewalk. */
export function wallLine(q: District, city: CityData): Rect {
  const s = city.config.sidewalk;
  return { ...q.bounds, w: q.bounds.w - s * 2, d: q.bounds.d - s * 2 };
}

export function wallPlan(q: District, city: CityData): WallPlan {
  const s = city.config.sidewalk;
  const line = wallLine(q, city);
  const { segments: raw, corners } = perimeterWall(q, city);

  // Plazas crossing the wall line: open the wall there as wide as a gate.
  const posterns: Postern[] = [];
  const sides = [
    { nx: 0, nz: -1, at: line.z - line.d / 2 },
    { nx: 0, nz: 1, at: line.z + line.d / 2 },
    { nx: -1, nz: 0, at: line.x - line.w / 2 },
    { nx: 1, nz: 0, at: line.x + line.w / 2 },
  ];
  for (const p of city.plazas) {
    for (const side of sides) {
      const alongX = side.nz !== 0;
      const lo = alongX ? p.z - p.d / 2 : p.x - p.w / 2;
      const hi = alongX ? p.z + p.d / 2 : p.x + p.w / 2;
      const c = alongX ? p.x : p.z;
      const span = alongX ? [line.x - line.w / 2, line.x + line.w / 2] : [line.z - line.d / 2, line.z + line.d / 2];
      // The plaza runs across this side of the wall line, within its length.
      if (!(lo < side.at && hi > side.at && c > span[0] && c < span[1])) continue;
      const width = alongX ? p.w : p.d;
      posterns.push({
        x: alongX ? c : side.at, z: alongX ? side.at : c,
        ax: alongX ? 1 : 0, az: alongX ? 0 : 1, nx: side.nx, nz: side.nz, opening: width + 2 * s,
      });
    }
  }
  // A street closed by roadworks crosses the wall line through a postern too (no gate: it's shut).
  const { roadWidth: rw } = city.config;
  const perimeter = new Set(q.perimeter);
  const gated = new Set(q.gates.map((g) => g.edge));
  for (const key of q.streets) {
    const [a, b] = key.split('>').map(Number);
    if (!perimeter.has(a) || perimeter.has(b) || gated.has(key)) continue;
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = Math.round((B.x - A.x) / len), dz = Math.round((B.z - A.z) / len);
    posterns.push({
      x: A.x + dx * (rw / 2 + s), z: A.z + dz * (rw / 2 + s),
      ax: Math.abs(dz), az: Math.abs(dx), nx: -dx, nz: -dz, opening: rw + 2 * s,
    });
  }
  const segments: WallSegment[] = [];
  for (const seg of raw) {
    let parts: WallSegment[] = [seg];
    for (const o of posterns) {
      if (o.nx !== seg.nx || o.nz !== seg.nz) continue;
      parts = parts.flatMap((g) => cut(g, o));
    }
    segments.push(...parts);
  }

  // Each stretch is a solid strip from the wall line inward.
  const walls = segments.map((g) => {
    const mx = (g.ax + g.bx) / 2 - (g.nx * W.thick) / 2;
    const mz = (g.az + g.bz) / 2 - (g.nz * W.thick) / 2;
    const len = Math.hypot(g.bx - g.ax, g.bz - g.az);
    return { ...g, footprint: g.nz ? fp(mx, mz, len / 2, W.thick / 2) : fp(mx, mz, W.thick / 2, len / 2) };
  });
  // Corner towers stand out over the sidewalk by cornerOut.
  const inset = W.cornerHalf - W.cornerOut;
  const corner = corners.map((c) => {
    const x = c.x + Math.sign(line.x - c.x) * inset;
    const z = c.z + Math.sign(line.z - c.z) * inset;
    return { ...c, footprint: fp(x, z, W.cornerHalf, W.cornerHalf) };
  });
  // Gatehouse towers: either side of the opening, standing out over the sidewalk by gateOut.
  const gates = q.gates.map((g) => {
    const nx = -Math.round(Math.sin(g.yaw));
    const nz = -Math.round(Math.cos(g.yaw));
    const ax = Math.abs(nz);
    const az = Math.abs(nx);
    const d = g.opening / 2 + W.gateHalf;
    const cx = g.x - nx * (W.gateHalf - W.gateOut);
    const cz = g.z - nz * (W.gateHalf - W.gateOut);
    return { nx, nz, ax, az, towers: [-1, 1].map((k) => fp(cx + ax * d * k, cz + az * d * k, W.gateHalf, W.gateHalf)) };
  });
  const post = posterns.map((o) => {
    const d = o.opening / 2 + W.postHalf;
    const cx = o.x - o.nx * W.postHalf;
    const cz = o.z - o.nz * W.postHalf;
    return { ...o, posts: [-1, 1].map((k) => fp(cx + o.ax * d * k, cz + o.az * d * k, W.postHalf, W.postHalf)) };
  });
  return {
    segments: walls,
    corners: corner,
    gates,
    posterns: post,
    solids: [...walls.map((w) => w.footprint), ...corner.map((c) => c.footprint), ...gates.flatMap((g) => g.towers), ...post.flatMap((o) => o.posts)],
  };
}

/** A wall segment with a postern's opening taken out. */
function cut(g: WallSegment, o: Postern): WallSegment[] {
  const alongX = g.az === g.bz;
  if (alongX ? Math.abs(g.az - o.z) > 0.5 : Math.abs(g.ax - o.x) > 0.5) return [g];
  const [u0, u1] = alongX ? [Math.min(g.ax, g.bx), Math.max(g.ax, g.bx)] : [Math.min(g.az, g.bz), Math.max(g.az, g.bz)];
  const c = alongX ? o.x : o.z;
  const g0 = c - o.opening / 2;
  const g1 = c + o.opening / 2;
  if (g1 <= u0 || g0 >= u1) return [g];
  const out: WallSegment[] = [];
  const mk = (a: number, b: number): WallSegment =>
    alongX ? { ...g, ax: a, bx: b } : { ...g, az: a, bz: b };
  if (g0 - u0 >= 0.5) out.push(mk(u0, g0));
  if (u1 - g1 >= 0.5) out.push(mk(g1, u1));
  return out;
}

/**
 * Keep the district's buildings clear of the walls: cut each building back from a solid it
 * overlaps on whichever side loses least, and drop it if it gets too small.
 */
export function clearOfWalls(buildings: Building[], solids: Footprint[], margin = 0.3): void {
  for (let i = buildings.length - 1; i >= 0; i--) {
    let b: Rect = buildings[i];
    for (const s of solids) {
      const sx0 = s.x - s.hx - margin, sx1 = s.x + s.hx + margin, sz0 = s.z - s.hz - margin, sz1 = s.z + s.hz + margin;
      const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2, bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2;
      if (bx1 <= sx0 || bx0 >= sx1 || bz1 <= sz0 || bz0 >= sz1) continue;
      const options: [number, number, number, number][] = [
        [Math.max(bx0, sx1), bx1, bz0, bz1], // keep the part east of the solid
        [bx0, Math.min(bx1, sx0), bz0, bz1], // west
        [bx0, bx1, Math.max(bz0, sz1), bz1], // north
        [bx0, bx1, bz0, Math.min(bz1, sz0)], // south
      ];
      const best = options.reduce((u, v) => ((v[1] - v[0]) * (v[3] - v[2]) > (u[1] - u[0]) * (u[3] - u[2]) ? v : u));
      b = { x: (best[0] + best[1]) / 2, z: (best[2] + best[3]) / 2, w: best[1] - best[0], d: best[3] - best[2] };
    }
    if (b.w < 4 || b.d < 4) buildings.splice(i, 1);
    else Object.assign(buildings[i], { x: b.x, z: b.z, w: b.w, d: b.d });
  }
}

/** The walls' structures, overhead pieces and ground patches. */
export function wallDressing(q: District, city: CityData, plan: WallPlan, rng: Rng): { structures: Structure[]; overhead: Overhead[]; ground: GroundPatch[] } {
  const ground = (x: number, z: number) => groundHeight(city.terrain, x, z);
  const { roadWidth: rw } = city.config;
  const round = rng.next() < 0.5;
  const structures: Structure[] = [];
  const overhead: Overhead[] = [];
  const patches: GroundPatch[] = [];
  const archBottom = DISTRICTS.overheadClearance + W.archAbove;
  const main = new Set(q.mainStreet.flatMap((k) => k.split('>').map(Number)));

  for (const g of plan.segments) {
    // Split into pieces of at most W.piece, each on the lower ground of its ends.
    const len = Math.hypot(g.bx - g.ax, g.bz - g.az);
    const count = Math.max(1, Math.ceil(len / W.piece));
    const pieces: WallPiece[] = [];
    for (let k = 0; k < count; k++) {
      const t0 = k / count, t1 = (k + 1) / count;
      const ax = g.ax + (g.bx - g.ax) * t0, az = g.az + (g.bz - g.az) * t0;
      const bx = g.ax + (g.bx - g.ax) * t1, bz = g.az + (g.bz - g.az) * t1;
      pieces.push({ ax, az, bx, bz, y: Math.min(ground(ax, az), ground(bx, bz)) });
    }
    structures.push({
      kind: 'wall', x: g.footprint.x, z: g.footprint.z, yaw: 0, footprints: [g.footprint],
      data: { nx: g.nx, nz: g.nz, thick: W.thick, height: W.height, pieces },
    });
  }
  for (const c of plan.corners) {
    const f = c.footprint;
    structures.push({ kind: 'tower', x: f.x, z: f.z, yaw: 0, footprints: [f], data: { round, half: W.cornerHalf, height: W.cornerHeight } });
  }
  q.gates.forEach((gate, i) => {
    const g = plan.gates[i];
    // Larger gates (on the main street) carry banners.
    const banners = main.has(gate.node) && main.has(gate.inner);
    const yaw = Math.atan2(-g.nx, -g.nz); // facing into the district
    // The timber deck: across the street, from the junction box's edge to the inner wall face.
    const node = city.graph.nodes[gate.node];
    const from = rw / 2;
    const to = Math.hypot(gate.x - node.x, gate.z - node.z) + W.thick;
    const mid = (from + to) / 2;
    const deck: GroundPatch = {
      kind: 'drawbridge', yaw,
      x: node.x - g.nx * mid, z: node.z - g.nz * mid,
      w: g.ax ? rw : to - from, d: g.az ? rw : to - from,
    };
    patches.push(deck);
    const outer = { x: node.x - g.nx * from, z: node.z - g.nz * from };
    structures.push({
      kind: 'gatehouse', x: gate.x, z: gate.z, yaw, footprints: g.towers,
      data: {
        ax: g.ax, az: g.az, nx: g.nx, nz: g.nz,
        opening: gate.opening, towerHalf: W.gateHalf, height: W.gateHeight, wallHeight: W.height, thick: W.thick,
        archBottom, portcullisBottom: archBottom + 0.3, banners,
        y: Math.min(...g.towers.map((t) => ground(t.x, t.z))),
        // Chains from the deck's outer corners up to the gatehouse face.
        chains: [-1, 1].map((k) => ({
          from: { x: outer.x + g.ax * (rw / 2 - 0.5) * k, z: outer.z + g.az * (rw / 2 - 0.5) * k },
          to: { x: gate.x + g.nx * 0.1 + g.ax * (rw / 2 - 0.5) * k, z: gate.z + g.nz * 0.1 + g.az * (rw / 2 - 0.5) * k, y: archBottom + 1.2 },
        })),
        // Torches on the outer face of each tower, beside the opening.
        torches: g.towers.map((t) => {
          const side = Math.sign((t.x - gate.x) * g.ax + (t.z - gate.z) * g.az);
          return { x: gate.x + g.nx * (W.gateOut + 0.2) + g.ax * side * (gate.opening / 2 + 0.8), z: gate.z + g.nz * (W.gateOut + 0.2) + g.az * side * (gate.opening / 2 + 0.8), y: 4 };
        }),
      },
    });
    overhead.push({ kind: 'arch', points: [{ x: gate.x, z: gate.z }], bottom: archBottom, data: { span: gate.opening } });
    overhead.push({ kind: 'portcullis', points: [{ x: gate.x, z: gate.z }], bottom: archBottom + 0.3, data: { span: gate.opening } });
  });
  for (const o of plan.posterns) {
    structures.push({
      kind: 'postern', x: o.x, z: o.z, yaw: 0, footprints: o.posts,
      data: { ax: o.ax, az: o.az, nx: o.nx, nz: o.nz, half: W.postHalf, height: W.height + 0.8 },
    });
  }
  return { structures, overhead, ground: patches };
}
