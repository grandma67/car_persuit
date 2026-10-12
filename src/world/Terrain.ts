// The ground the city stands on: an optional hill and 0–2 sea canals that cut the island from
// shore to shore, crossed by bridges every few blocks. Pure data and maths — no Three.js.
import { Rng } from '../core/Rng';
import type { Rect } from './CityGenerator';

/** Ground height lookup handed to systems that place things in the world. */
export type GroundHeight = (x: number, z: number) => number;
export const FLAT: GroundHeight = () => 0;

/** A smooth elliptical rise: full height at the centre, easing to flat ground at its rim. */
export interface Hill {
  x: number;
  z: number;
  height: number; // metres at the top
  rx: number; // radius along its own X axis
  rz: number;
  yaw: number; // rotation of the ellipse
}

/** A straight strip of sea along a road line. axis 'x': runs along X at z = at; 'z': along Z at x = at. */
export interface Canal {
  axis: 'x' | 'z';
  line: number; // index of the road line it replaces
  at: number; // world coordinate of its centre line
  half: number; // half its width
}

export interface Terrain {
  hill: Hill | null;
  canals: Canal[];
  bridges: Rect[]; // decks across the canals, on some of the roads that meet them
  land: Rect[]; // the island cut into pieces by the canals
}

export interface TerrainConfig {
  hillChance: number;
  hillHeight: [number, number]; // metres
  maxGrade: number; // steepest slope the hill may have (rise over run)
  canalOdds: [number, number, number]; // weights for 0, 1 and 2 canals
  canalWidth: [number, number]; // metres, quay wall to quay wall: each canal picks its own
  bridgeSpacing: [number, number]; // road lines between neighbouring bridges over a canal
}

/**
 * Seed → hill and canals. Canals follow inner road lines (never the ring road or the line next to
 * it); two canals either cross or run parallel at least three blocks apart. The hill sits wholly
 * inside the island so the shore, quay and sea wall stay at sea level.
 */
export function planTerrain(
  rng: Rng,
  config: TerrainConfig,
  blocks: number,
  line: (i: number) => number,
  islandHalf: number,
): Pick<Terrain, 'hill' | 'canals'> {
  const roll = rng.next() * (config.canalOdds[0] + config.canalOdds[1] + config.canalOdds[2]);
  const count = roll < config.canalOdds[0] ? 0 : roll < config.canalOdds[0] + config.canalOdds[1] ? 1 : 2;
  const canals: Canal[] = [];
  const make = (axis: 'x' | 'z', index: number): Canal => ({ axis, line: index, at: line(index), half: 0 });
  const first = make(rng.next() < 0.5 ? 'x' : 'z', rng.int(2, blocks - 2));
  if (count >= 1) canals.push(first);
  if (count === 2) {
    if (rng.next() < 0.5) {
      canals.push(make(first.axis === 'x' ? 'z' : 'x', rng.int(2, blocks - 2)));
    } else {
      const options: number[] = [];
      for (let k = 2; k <= blocks - 2; k++) if (Math.abs(k - first.line) >= 3) options.push(k);
      if (options.length) canals.push(make(first.axis, rng.pick(options)));
    }
  }

  let hill: Hill | null = null;
  if (rng.next() < config.hillChance) {
    // The cosine profile's steepest grade is (π/2)·height/radius: size the hill to stay drivable.
    const height = rng.range(config.hillHeight[0], config.hillHeight[1]);
    const minRadius = Math.max(200, ((Math.PI / 2) * height) / config.maxGrade);
    const rMinor = rng.range(minRadius, minRadius + 80);
    const rMajor = Math.min(rMinor * rng.range(1, 1.35), islandHalf - 30);
    const room = Math.max(0, islandHalf - rMajor - 4);
    const along = rng.next() < 0.5;
    hill = {
      x: rng.range(-room, room),
      z: rng.range(-room, room),
      height,
      rx: along ? rMajor : rMinor,
      rz: along ? rMinor : rMajor,
      yaw: rng.range(-0.5, 0.5),
    };
  }
  // Widths are drawn last so a seed's hill doesn't depend on them.
  for (const c of canals) c.half = Math.round(rng.range(config.canalWidth[0], config.canalWidth[1])) / 2;
  return { hill, canals };
}

/**
 * Which of a canal's crossing roads get a bridge. `runs` are the crossing road lines in order,
 * split wherever another canal cuts across; every run gets at least one bridge so the island
 * stays connected, the rest end at the quay.
 */
export function pickBridges(rng: Rng, runs: number[][], spacing: [number, number]): number[] {
  const out: number[] = [];
  for (const run of runs) {
    if (!run.length) continue;
    // Start part-way into the run so bridges don't always line up with the shore.
    let at = rng.int(0, Math.min(spacing[0], run.length) - 1);
    for (; at < run.length; at += rng.int(spacing[0], spacing[1])) out.push(run[at]);
  }
  return out;
}

/** Ground height at a point (bridges carry the road across at this height too). */
export function groundHeight(t: Terrain, x: number, z: number): number {
  const h = t.hill;
  if (!h) return 0;
  const dx = x - h.x;
  const dz = z - h.z;
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  const d = Math.hypot((dx * c - dz * s) / h.rx, (dx * s + dz * c) / h.rz);
  return d >= 1 ? 0 : h.height * (0.5 + 0.5 * Math.cos(Math.PI * d));
}

/** No hill under any part of this rectangle: it can be meshed as one flat piece. */
export function isFlat(t: Terrain, r: Rect): boolean {
  const h = t.hill;
  if (!h) return true;
  const reach = Math.max(h.rx, h.rz);
  return Math.abs(r.x - h.x) >= r.w / 2 + reach || Math.abs(r.z - h.z) >= r.d / 2 + reach;
}

/** Lowest ground under a square footprint of half-size r: sit things here so no corner floats. */
export function groundBase(t: Terrain, x: number, z: number, r: number): number {
  // The hill falls away monotonically from its centre, so the low point is a corner or the middle.
  return Math.min(
    groundHeight(t, x, z),
    groundHeight(t, x - r, z - r),
    groundHeight(t, x + r, z - r),
    groundHeight(t, x - r, z + r),
    groundHeight(t, x + r, z + r),
  );
}

/** Highest ground under a square footprint of half-size r. */
export function groundTop(t: Terrain, x: number, z: number, r: number): number {
  // The hill's top may be inside the square: sample a small grid.
  let top = -Infinity;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) top = Math.max(top, groundHeight(t, x + (a * r) / 2, z + (b * r) / 2));
  return top;
}

/** Unit surface normal of the ground. */
export function groundNormal(t: Terrain, x: number, z: number): { x: number; y: number; z: number } {
  const e = 0.5;
  const gx = (groundHeight(t, x + e, z) - groundHeight(t, x - e, z)) / (2 * e);
  const gz = (groundHeight(t, x, z + e) - groundHeight(t, x, z - e)) / (2 * e);
  const len = Math.hypot(gx, 1, gz);
  return { x: -gx / len, y: 1 / len, z: -gz / len };
}

const inside = (r: Rect, x: number, z: number, margin: number) =>
  Math.abs(x - r.x) <= r.w / 2 - margin && Math.abs(z - r.z) <= r.d / 2 - margin;

/** Within `margin` of a canal's water (bridges not counted). */
export function inCanal(t: Terrain, x: number, z: number, margin = 0): boolean {
  return t.canals.some((c) => Math.abs((c.axis === 'x' ? z : x) - c.at) < c.half + margin);
}

/**
 * Solid ground (or a bridge deck) for something of radius `margin` at this point: clear of the
 * canals, or wholly on a bridge.
 */
export function onGround(t: Terrain, x: number, z: number, margin = 0): boolean {
  return !inCanal(t, x, z, margin) || t.bridges.some((b) => inside(b, x, z, margin));
}

/** The island (centred on the origin) minus the canal strips, as rectangles. */
export function landPieces(islandHalf: number, canals: Canal[]): Rect[] {
  const spans = (axis: 'x' | 'z') => {
    const cuts = canals.filter((c) => c.axis === axis).sort((a, b) => a.at - b.at);
    const out: [number, number][] = [];
    let from = -islandHalf;
    for (const c of cuts) {
      out.push([from, c.at - c.half]);
      from = c.at + c.half;
    }
    out.push([from, islandHalf]);
    return out;
  };
  // Canals along X cut the island's Z extent, and vice versa.
  const pieces: Rect[] = [];
  for (const [z0, z1] of spans('x')) {
    for (const [x0, x1] of spans('z')) pieces.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
  }
  return pieces;
}

/** Clip a rectangle to another; null if they don't overlap. */
export function clipRect(r: Rect, to: Rect): Rect | null {
  const x0 = Math.max(r.x - r.w / 2, to.x - to.w / 2);
  const x1 = Math.min(r.x + r.w / 2, to.x + to.w / 2);
  const z0 = Math.max(r.z - r.d / 2, to.z - to.d / 2);
  const z1 = Math.min(r.z + r.d / 2, to.z + to.d / 2);
  if (x1 - x0 <= 1e-6 || z1 - z0 <= 1e-6) return null;
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}
