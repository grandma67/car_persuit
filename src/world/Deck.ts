// A raised deck a car drives on: a boardwalk over the Swamp's pools, ramped down to the ground at
// either end. Solid from the ground to its top (nothing gets under it), firm underfoot (the water
// below doesn't slow a car on it), drivable for the cops' NavGrid. Pure data and maths: CityBuilder
// turns `deckShapes` into colliders.
import type { Terrain } from './Terrain';
import { groundHeight } from './Terrain';

export interface Deck {
  x: number;
  z: number;
  /** As a Footprint's: local X (cos yaw, −sin yaw) across, local Z (sin yaw, cos yaw) along it. */
  yaw: number;
  hx: number; // half its width
  hz: number; // half its length, ramps included
  top: number; // its surface over the lower of its two ends' ground, metres
  /** Ramp lengths at the −Z end and the +Z end, metres (0: no ramp, it ends in a step). */
  ramps: [number, number];
}

/** Inside the deck's outline (ramps included), `margin` metres to spare. */
export function inDeck(d: Deck, x: number, z: number, margin = 0): boolean {
  const dx = x - d.x, dz = z - d.z;
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  return Math.abs(dx * c - dz * s) <= d.hx + margin && Math.abs(dx * s + dz * c) <= d.hz + margin;
}

/** The world point at local (u across, v along). */
export function deckPoint(d: Deck, u: number, v: number): { x: number; z: number } {
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  return { x: d.x + u * c + v * s, z: d.z - u * s + v * c };
}

/** The deck surface's height at local v (along), over sea level. */
export function deckHeight(d: Deck, terrain: Terrain, v: number): number {
  const a = deckPoint(d, 0, -d.hz), b = deckPoint(d, 0, d.hz);
  const ga = groundHeight(terrain, a.x, a.z), gb = groundHeight(terrain, b.x, b.z);
  const top = Math.min(ga, gb) + d.top;
  const [r0, r1] = d.ramps;
  if (r0 > 0 && v < -d.hz + r0) return ga + (top - ga) * Math.max(0, (v + d.hz) / r0);
  if (r1 > 0 && v > d.hz - r1) return gb + (top - gb) * Math.max(0, (d.hz - v) / r1);
  return top;
}

/** One collider: a box (half extents) or a convex hull (local points), at `at` turned by `yaw` about Y. */
export type DeckShape = { at: { x: number; y: number; z: number }; yaw: number } & ({ box: [number, number, number] } | { hull: number[] });

const SKIRT = 1; // the solid reaches this far below the ground

/** The colliders: the flat run as a box, each ramp as a wedge. */
export function deckShapes(d: Deck, terrain: Terrain): DeckShape[] {
  const [r0, r1] = d.ramps;
  const a = deckPoint(d, 0, -d.hz), b = deckPoint(d, 0, d.hz);
  const ga = groundHeight(terrain, a.x, a.z), gb = groundHeight(terrain, b.x, b.z);
  const base = Math.min(ga, gb);
  const top = base + d.top;
  const out: DeckShape[] = [];
  const v0 = -d.hz + r0, v1 = d.hz - r1;
  if (v1 > v0) {
    const mid = deckPoint(d, 0, (v0 + v1) / 2);
    out.push({ at: { x: mid.x, y: (top + base - SKIRT) / 2, z: mid.z }, yaw: d.yaw, box: [d.hx, (top - base + SKIRT) / 2, (v1 - v0) / 2] });
  }
  // A wedge from the ground at its end (local v = end) up to the top where the flat run starts;
  // hull points are local (u across, y over `base`, v along) about the deck's centre.
  const wedge = (end: number, start: number, g: number): number[] => {
    const hull: number[] = [];
    for (const u of [-d.hx, d.hx]) hull.push(u, g - base, end, u, g - base - SKIRT, end, u, d.top, start, u, -SKIRT, start);
    return hull;
  };
  const at = { x: d.x, y: base, z: d.z };
  if (r0 > 0) out.push({ at, yaw: d.yaw, hull: wedge(-d.hz, v0, ga) });
  if (r1 > 0) out.push({ at, yaw: d.yaw, hull: wedge(d.hz, v1, gb) });
  return out;
}
