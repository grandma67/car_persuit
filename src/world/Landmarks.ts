// Landmarks: town squares (a few downtown/midtown blocks paved over around a centrepiece),
// centrepieces in some parks, and the jump ramps. Pure data — LandmarkBuilder renders it.
import type { Rng } from '../core/Rng';
import type { Block, Building, CityConfig } from './CityGenerator';

export type LandmarkKind = 'fountain' | 'statue' | 'obelisk' | 'sculpture' | 'ramp';

export interface Landmark {
  kind: LandmarkKind;
  x: number;
  z: number;
  yaw: number;
  /** Footprint radius in metres (solid). */
  radius: number;
  /** Ramps: deck shape, when not the standard RAMP. */
  shape?: RampShape;
  /** Canal ramps: the `at` of the canal they jump. */
  crossing?: number;
}

/** A jump ramp's deck in local space: the car drives along +Z from the toe to the lip. */
export interface RampShape {
  toe: number; // metres from the landmark's position
  lip: number;
  width: number;
  height: number;
  curve: number; // deck height = height * t^curve, so it kicks up toward the lip
}

export const LANDMARK_RADIUS: Record<LandmarkKind, number> = {
  fountain: 5,
  statue: 1.6,
  obelisk: 1.8,
  sculpture: 2.2,
  ramp: 4,
};

/**
 * "The Leap": one monument per city you can drive up and jump off. It stands on a paved-over
 * street in line with the roads either side, so the run-up comes straight through a junction and
 * the landing is the next road on; with no such street it goes in a town square instead.
 */
export const RAMP = {
  toe: -24, // metres from the landmark's centre
  lip: -9,
  width: 7,
  height: 3.0,
  curve: 1.6,
  lane: 8, // half-width of the run-up and landing lane kept clear of trees and benches
};

export const rampShape = (l: Landmark): RampShape => l.shape ?? RAMP;

/** Deck height at local z along the ramp (0 before the toe, peak at the lip). */
export function deckHeight(s: RampShape, z: number): number {
  const t = Math.min(1, Math.max(0, (z - s.toe) / (s.lip - s.toe)));
  return s.height * Math.pow(t, s.curve);
}

/** The deck as convex slices (local space), from the ground up to the deck surface. */
export function rampDeckHulls(s: RampShape, segments: number): Float32Array[] {
  const w = s.width / 2;
  const hulls: Float32Array[] = [];
  for (let i = 0; i < segments; i++) {
    const z0 = s.toe + ((s.lip - s.toe) * i) / segments;
    const z1 = s.toe + ((s.lip - s.toe) * (i + 1)) / segments;
    const y0 = deckHeight(s, z0) + 0.06;
    const y1 = deckHeight(s, z1) + 0.06;
    hulls.push(new Float32Array([-w, 0, z0, w, 0, z0, -w, 0, z1, w, 0, z1, -w, y0, z0, w, y0, z0, -w, y1, z1, w, y1, z1]));
  }
  return hulls;
}

/** Speed (m/s) a canal ramp is built for, at the lip: a street-length run-up, short of flat out. */
export const CANAL_JUMP_SPEED = 35;
/** Tightest the deck may curve (radius, m): any sharper and a fast car slams into it instead of riding up. */
const MIN_DECK_RADIUS = 70;
const G = 9.81;

/** Flight distance from a lip `h` high, leaving at `speed` and `angle`, down to the lip's base level. */
export function jumpRange(speed: number, angle: number, h: number): number {
  const vx = speed * Math.cos(angle);
  const vy = speed * Math.sin(angle);
  return (vx * (vy + Math.sqrt(vy * vy + 2 * G * h))) / G;
}

/**
 * A ramp that carries a car `gap` metres at CANAL_JUMP_SPEED: as shallow a kick as gets there,
 * long enough that the deck never curves tighter than MIN_DECK_RADIUS (so steeper means longer
 * and taller; the widest canals get a ski jump). The lip sits at the landmark's position.
 */
export function canalRampShape(gap: number): RampShape {
  const curve = 1.6;
  let shape: RampShape = { toe: -15, lip: 0, width: RAMP.width, height: 3, curve };
  for (let angle = 0.31; angle <= 0.6; angle += 0.01) { // from the town ramp's kick up
    const slope = Math.tan(angle);
    // Deck y = h·t^c: slope at the lip h·c/L, curvature there h·c(c−1)/L².
    const length = Math.max(15, (curve - 1) * MIN_DECK_RADIUS * slope);
    const height = (length * slope) / curve;
    shape = { toe: -length, lip: 0, width: RAMP.width, height, curve };
    if (jumpRange(CANAL_JUMP_SPEED, angle, height) >= gap * 1.1) break;
  }
  return shape;
}

/** Is a world point in the ramp's run-up/landing lane? */
export function inRampLane(l: Landmark, p: { x: number; z: number }): boolean {
  const dx = p.x - l.x;
  const dz = p.z - l.z;
  const across = dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw); // local X
  return Math.abs(across) < RAMP.lane;
}

/** Clear space kept around a centrepiece (benches ring just outside it). */
export const LANDMARK_CLEARANCE = 6;

const SQUARE_RING_TREES = 10;
const SQUARE_TREE_RADIUS = 21;

/**
 * Turn a few busy blocks into town squares (removing their buildings) and give some parks a
 * centrepiece. Mutates blocks (square flag), buildings and trees; returns the landmarks.
 */
export function planLandmarks(
  blocks: Block[],
  buildings: Building[],
  trees: { x: number; z: number }[],
  config: CityConfig,
  rng: Rng,
  rampSpots: { x: number; z: number; yaw: number }[] = [],
): { landmarks: Landmark[]; buildings: Building[]; trees: { x: number; z: number }[] } {
  const landmarks: Landmark[] = [];
  const half = config.blockSize / 2;
  const inBlock = (b: Block, p: { x: number; z: number }) => Math.abs(p.x - b.rect.x) < half && Math.abs(p.z - b.rect.z) < half;

  // Town squares: ~4 of the busy blocks.
  const busy = blocks.filter((b) => !b.park && (b.district === 'downtown' || b.district === 'midtown'));
  const squares: Block[] = [];
  const target = Math.min(4, busy.length);
  for (let tries = 0; squares.length < target && tries < 50; tries++) {
    const b = rng.pick(busy);
    // Spread them out: no two squares within two blocks of each other.
    if (squares.includes(b) || squares.some((s) => Math.hypot(s.rect.x - b.rect.x, s.rect.z - b.rect.z) < config.blockSize * 2.5)) continue;
    squares.push(b);
  }
  for (const b of squares) {
    b.square = true;
    const roll = rng.next();
    const kind: LandmarkKind = roll < 0.5 ? 'fountain' : roll < 0.75 ? 'statue' : roll < 0.9 ? 'obelisk' : 'sculpture';
    landmarks.push({ kind, x: b.rect.x, z: b.rect.z, yaw: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), radius: LANDMARK_RADIUS[kind] });
  }
  // The jump ramp: on a straight paved-over street if there is one, else one square's centrepiece.
  const street = rampSpots.length ? rng.pick(rampSpots) : null;
  if (!street && landmarks.length) {
    const ramp = landmarks[0];
    ramp.kind = 'ramp';
    ramp.radius = LANDMARK_RADIUS.ramp;
  }
  buildings = buildings.filter((bd) => !squares.some((s) => inBlock(s, bd)));
  trees = trees.filter((t) => !squares.some((s) => inBlock(s, t)));
  // A ring of trees around each square.
  squares.forEach((s, i) => {
    const centre = landmarks[i];
    for (let k = 0; k < SQUARE_RING_TREES; k++) {
      const a = (k / SQUARE_RING_TREES) * Math.PI * 2 + Math.PI / SQUARE_RING_TREES;
      const t = { x: s.rect.x + Math.cos(a) * SQUARE_TREE_RADIUS, z: s.rect.z + Math.sin(a) * SQUARE_TREE_RADIUS };
      if (centre.kind === 'ramp' && inRampLane(centre, t)) continue; // keep the run-up and landing clear
      trees.push(t);
    }
  });

  if (street) landmarks.push({ kind: 'ramp', ...street, radius: LANDMARK_RADIUS.ramp });

  // Parks: about half get a centrepiece (smaller fountain or a statue); clear trees around it.
  for (const p of blocks.filter((b) => b.park)) {
    if (rng.next() > 0.5) continue;
    const kind: LandmarkKind = rng.next() < 0.5 ? 'fountain' : 'statue';
    const lm = { kind, x: p.rect.x, z: p.rect.z, yaw: rng.range(0, Math.PI * 2), radius: LANDMARK_RADIUS[kind] };
    landmarks.push(lm);
    trees = trees.filter((t) => Math.hypot(t.x - lm.x, t.z - lm.z) > lm.radius + LANDMARK_CLEARANCE);
  }
  return { landmarks, buildings, trees };
}
