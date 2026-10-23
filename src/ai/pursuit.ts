// Shared path-following maths for AI drivers (cops and civilians). Pure functions on a polyline.
import * as THREE from 'three';

type P = { x: number; z: number };

/** Signed turn angle (radians) at b for the path a → b → c. */
export function turnAngle(a: P, b: P, c: P): number {
  const inX = b.x - a.x;
  const inZ = b.z - a.z;
  const outX = c.x - b.x;
  const outZ = c.z - b.z;
  return Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ);
}

/**
 * Pure pursuit: find our closest point on the path (searching forward from `segment` only), then
 * walk `lookahead` metres along the path to get the aim point. The aim may only wrap ~4m round a
 * sharp bend, so drivers stay in their road until the junction instead of cutting the corner.
 */
export function purePursuit(path: P[], segment: number, pos: P, lookahead: number, out: THREE.Vector3): { segment: number } {
  let best = Infinity;
  let bestSeg = segment;
  let bestT = 0;
  for (let i = segment; i < Math.min(path.length - 1, segment + 3); i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const u = THREE.MathUtils.clamp(((pos.x - a.x) * abx + (pos.z - a.z) * abz) / len2, 0, 1);
    const d = Math.hypot(a.x + abx * u - pos.x, a.z + abz * u - pos.z);
    if (d < best) {
      best = d;
      bestSeg = i;
      bestT = u;
    }
  }

  let remaining = lookahead;
  let i = bestSeg;
  let u = bestT;
  for (;;) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const left = segLen * (1 - u);
    if (remaining <= left || i + 2 >= path.length) {
      const f = Math.min(1, u + remaining / (segLen || 1));
      out.set(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f);
      break;
    }
    remaining -= left;
    i++;
    u = 0;
    if (Math.abs(turnAngle(path[i - 1], path[i], path[i + 1])) > 0.5) remaining = Math.min(remaining, 4);
  }
  return { segment: bestSeg };
}

/**
 * Highest speed that still lets us slow to `cornerSpeed` for every sharp bend ahead within
 * braking distance (decelerating at `decel`). `byAngle`: `cornerSpeed` is for a right angle;
 * gentler bends are taken faster, hairpins slower.
 */
export function cornerSpeedLimit(path: P[], segment: number, pos: P, speed: number, cornerSpeed: number, decel: number, byAngle = false): number {
  const horizon = (speed * speed) / (2 * decel) + 30;
  let allowed = Infinity;
  if (segment + 1 >= path.length) return allowed;
  let along = Math.hypot(path[segment + 1].x - pos.x, path[segment + 1].z - pos.z);
  for (let k = segment + 1; k + 1 < path.length && along < horizon; k++) {
    const turn = Math.abs(turnAngle(path[k - 1], path[k], path[k + 1]));
    if (turn > 0.5) {
      const v = byAngle ? cornerSpeed * Math.sqrt(THREE.MathUtils.clamp(Math.PI / 2 / turn, 0.55, 1.3)) : cornerSpeed;
      allowed = Math.min(allowed, Math.sqrt(v ** 2 + 2 * decel * Math.max(0, along - 8)));
    }
    along += Math.hypot(path[k + 1].x - path[k].x, path[k + 1].z - path[k].z);
  }
  return allowed;
}

/** Metres from `pos` along the path to its next sharp bend (Infinity if it runs straight to the end). */
export function distanceToBend(path: P[], segment: number, pos: P): number {
  if (segment + 1 >= path.length) return Infinity;
  let along = Math.hypot(path[segment + 1].x - pos.x, path[segment + 1].z - pos.z);
  for (let k = segment + 1; k + 1 < path.length; k++) {
    if (Math.abs(turnAngle(path[k - 1], path[k], path[k + 1])) > 0.5) return along;
    along += Math.hypot(path[k + 1].x - path[k].x, path[k + 1].z - path[k].z);
  }
  return Infinity;
}
