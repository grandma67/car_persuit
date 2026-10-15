// Where the nearest water is, for the shore sounds. Pure maths over the island square and its
// canals — no Three.js — so it is unit-tested.
import type { Canal } from '../world/Terrain';

export interface WaterNearby {
  /** Metres to the quay edge of the open sea (0 at or past it). */
  sea: number;
  /** The nearest point on that edge: where the surf you hear breaks. */
  wallX: number;
  wallZ: number;
  /** Metres to the nearest canal's water (0 over it); Infinity with no canals. */
  canal: number;
}

export function waterNearby(x: number, z: number, islandHalf: number, canals: readonly Canal[]): WaterNearby {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const sea = Math.max(0, islandHalf - Math.max(ax, az));
  // Out to the nearest edge; along it, stay level with the listener (clamped to the island's corners).
  const clampEdge = (v: number) => Math.max(-islandHalf, Math.min(islandHalf, v));
  const toX = ax >= az;
  const wallX = toX ? Math.sign(x || 1) * islandHalf : clampEdge(x);
  const wallZ = toX ? clampEdge(z) : Math.sign(z || 1) * islandHalf;
  let canal = Infinity;
  for (const c of canals) canal = Math.min(canal, Math.max(0, Math.abs((c.axis === 'x' ? z : x) - c.at) - c.half));
  return { sea, wallX, wallZ, canal };
}
