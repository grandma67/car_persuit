// Shallow water on land: park ponds, a lake, swamp pools. Pure data. Unlike the sea and the canals
// (SEA_LEVEL, where a car drowns) it lies on the ground: a car wades through it, slowed hard by
// the drag (soft ground: `world/softGround.ts`), and never sinks. Its surface stands `depth` above
// the ground and follows the terrain; the edge slopes down to the ground over `WATER.shoreRamp`.

/** One pond, pool or lake: an ellipse whose rim wobbles (a sum of cosines round it). */
export interface ShallowWater {
  kind: 'pond' | 'pool' | 'lake';
  x: number;
  z: number;
  rx: number; // half extent along its local X (metres)
  rz: number; // half extent along its local Z
  yaw: number;
  /** Rim wobble: [lobes, amplitude (fraction of the radius), phase]. Keep Σ amplitude < 0.4. */
  wobble: [number, number, number][];
  depth: number; // the surface's height above the ground in the middle, metres
}

/** How far the rim reaches at angle `theta`, as a fraction of the ellipse (1 = the plain ellipse). */
export function rimAt(w: ShallowWater, theta: number): number {
  let r = 1;
  for (const [k, a, ph] of w.wobble) r += a * Math.cos(k * theta + ph);
  return r;
}

/** The farthest the rim reaches from the centre, metres (for bounds). */
export function waterReach(w: ShallowWater): number {
  return Math.max(w.rx, w.rz) * (1 + w.wobble.reduce((s, [, a]) => s + Math.abs(a), 0));
}

/**
 * Metres from the rim, positive inside (approximate: radial, scaled by the smaller radius, which is
 * exact for a circle and close enough for a mild ellipse). Negative outside.
 */
export function shoreDistance(w: ShallowWater, x: number, z: number): number {
  const dx = x - w.x;
  const dz = z - w.z;
  const c = Math.cos(w.yaw);
  const s = Math.sin(w.yaw);
  const u = (dx * c - dz * s) / w.rx;
  const v = (dx * s + dz * c) / w.rz;
  const n = Math.hypot(u, v);
  return (rimAt(w, Math.atan2(v, u)) - n) * Math.min(w.rx, w.rz);
}

/** Inside the water (by `margin` metres or more, when given). */
export function inWater(w: ShallowWater, x: number, z: number, margin = 0): boolean {
  const reach = waterReach(w) + Math.max(0, -margin);
  if (Math.abs(x - w.x) > reach || Math.abs(z - w.z) > reach) return false;
  return shoreDistance(w, x, z) >= margin;
}

/** Points round the rim, `segments` of them, counter-clockwise from local +X (world x, z). */
export function rimPoints(w: ShallowWater, segments: number, inset = 0): { x: number; z: number }[] {
  const c = Math.cos(w.yaw);
  const s = Math.sin(w.yaw);
  const out: { x: number; z: number }[] = [];
  const shrink = inset / Math.min(w.rx, w.rz);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const r = Math.max(0, rimAt(w, t) - shrink);
    const u = Math.cos(t) * r * w.rx;
    const v = Math.sin(t) * r * w.rz;
    // Inverse of shoreDistance's rotation.
    out.push({ x: w.x + u * c + v * s, z: w.z - u * s + v * c });
  }
  return out;
}
