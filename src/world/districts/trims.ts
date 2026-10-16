// Shared measurements for pitched roofs and building trims: CityBuilder draws them into the merged
// roof mesh, and district renderers that add moving parts (the clock's hands) find them here.
// Pure data.
import type { Rect } from '../CityGenerator';
import type { RoofShape } from './District';

/** Eave overhang of pitched roofs, metres. */
export const EAVE = 0.35;
/** The Old City's steep gables: ~55°. */
const STEEP = Math.tan((55 * Math.PI) / 180);

/** Ridge height above the wall tops for a pitched roof over this footprint. */
export function roofRise(shape: RoofShape, r: Rect): number {
  const half = Math.min(r.w, r.d) / 2; // eave to ridge, inside the walls
  if (shape === 'steepGable') return half * STEEP;
  if (shape === 'hip') return Math.min(6, half * 0.7);
  return Math.min(3.5, half * 0.75); // 'gable'
}

/** How far a jettied building's upper floors stand out, by its variant. */
export const jettyDepth = (variant: number) => 0.6 + ((variant * 13) % 1) * 0.4;
/** Jetties start at the first floor line at or above this height. */
export const JETTY_FROM = 4.5;
/** An arcade's ground floor is set back this far behind its columns. */
export const ARCADE_DEPTH = 2;

/** The clock tower rising through a town hall's roof: square, centred on the building. */
export interface ClockTowerFrame {
  x: number;
  z: number;
  half: number; // half the tower's side
  base: number; // above the building's footing
  top: number; // top of the tower walls (the spire sits on it)
  dialY: number; // centre of the clock faces
  dialR: number;
}

export function clockTowerFrame(b: Rect & { h: number }, roof: RoofShape): ClockTowerFrame {
  const half = Math.max(1.8, Math.min(3, Math.min(b.w, b.d) * 0.18));
  const ridge = b.h + roofRise(roof, b);
  const dialR = half * 0.72;
  const ring = dialR + 0.18; // the dark ring round the face
  // A shaft clear of the ridge, the dial, then wall above it so the cornice and spire stay off the ring.
  const dialY = ridge + 4 + ring;
  const top = dialY + ring + 1.2;
  return { x: b.x, z: b.z, half, base: b.h - 1, top, dialY, dialR };
}
