// Landmarks: town squares (a few downtown/midtown blocks paved over around a centrepiece),
// centrepieces in some parks, and the jump ramps. Pure data — LandmarkBuilder renders it.
import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import type { Block, Building, CityConfig } from './CityGenerator';
import { groundHeight, type Terrain } from './Terrain';

export type LandmarkKind =
  | 'fountain' | 'statue' | 'obelisk' | 'sculpture' | 'ramp'
  // Old City set pieces: placed by the district, never rolled as a town square's centrepiece.
  | 'cannon' | 'column' | 'ruinArch' | 'well' | 'marketCross'
  // Chinatown
  | 'lion' | 'pagoda' | 'incense';

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
  /** Pagodas: how many storeys. */
  tiers?: number;
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
  cannon: 1.4,
  column: 0.9,
  ruinArch: 2.6,
  well: 1.5,
  marketCross: 3.2,
  lion: 0.7,
  pagoda: 4.2,
  incense: 0.8,
};
/** What a town square may roll (fixed: adding a kind above must not move any seed's squares). */
const LANDMARK_KINDS: LandmarkKind[] = ['fountain', 'statue', 'obelisk', 'sculpture', 'ramp'];
const MONUMENT_KINDS = LANDMARK_KINDS.filter((k) => k !== 'ramp');

/**
 * "The Leap": a monument you can drive up and jump off, rolled like any other centrepiece. It
 * stands on a paved-over street in line with the roads either side, so the run-up comes straight
 * through a junction and the landing is the next road on; with no such street it stays in its
 * town square.
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

/**
 * Where a ramp stands: origin height and orientation, tilted so the deck's toe and lip both meet
 * the road (the line through the ground under each) and leaning with the road's camber. Tilting
 * to the slope at one point alone leaves the toe standing proud wherever a hill curves under a
 * long ramp, and a fast car hits that edge like a kerb.
 */
export function rampFrame(l: Landmark, terrain: Terrain): { y: number; quaternion: THREE.Quaternion } {
  const s = rampShape(l);
  const fx = Math.sin(l.yaw);
  const fz = Math.cos(l.yaw);
  const rx = Math.cos(l.yaw); // local +X
  const rz = -Math.sin(l.yaw);
  const h = (along: number, across = 0) => groundHeight(terrain, l.x + fx * along + rx * across, l.z + fz * along + rz * across);
  const slope = (h(s.lip) - h(s.toe)) / (s.lip - s.toe);
  const mid = (s.toe + s.lip) / 2;
  const w = s.width / 2;
  const camber = (h(mid, w) - h(mid, -w)) / (2 * w);
  const zAxis = new THREE.Vector3(fx, slope, fz).normalize();
  const xAxis = new THREE.Vector3(rx, camber, rz);
  xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis)).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  // Through the toe's ground point (sunk a touch so its edge is flush, never proud).
  return { y: h(s.toe) - slope * s.toe - 0.03, quaternion };
}

/** The deck as convex slices (local space), from the ground up to the deck surface. */
export function rampDeckHulls(s: RampShape, segments: number): Float32Array[] {
  const w = s.width / 2;
  const hulls: Float32Array[] = [];
  const step = (s.lip - s.toe) / segments;
  for (let i = 0; i < segments; i++) {
    const z0 = s.toe + step * i;
    const z1 = z0 + step;
    const y0 = deckHeight(s, z0) + 0.06;
    const y1 = deckHeight(s, z1) + 0.06;
    // Each slice reaches back under the one before along its own (lower, the deck curving up)
    // slope, so no slice shows a front edge at the seam for a car's body to catch on.
    const zb = i === 0 ? z0 : z0 - step * 0.5;
    const yb = Math.max(0, y0 - ((y1 - y0) / step) * (z0 - zb));
    hulls.push(new Float32Array([-w, 0, zb, w, 0, zb, -w, 0, z1, w, 0, z1, -w, yb, zb, w, yb, zb, -w, y1, z1, w, y1, z1]));
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
 * Turn a block into a town square around its centrepiece: paved (block.square), its buildings and
 * trees cleared, and (with `ring`) a ring of trees round the edge, leaving a ramp's lane clear.
 * Returns the buildings and trees left.
 */
export function makeSquare(
  block: Block, centrepiece: Landmark, buildings: Building[], trees: { x: number; z: number }[], config: CityConfig, ring = true,
): { buildings: Building[]; trees: { x: number; z: number }[] } {
  const half = config.blockSize / 2;
  const inBlock = (p: { x: number; z: number }) => Math.abs(p.x - block.rect.x) < half && Math.abs(p.z - block.rect.z) < half;
  block.square = true;
  buildings = buildings.filter((bd) => !inBlock(bd));
  trees = trees.filter((t) => !inBlock(t));
  for (let k = 0; ring && k < SQUARE_RING_TREES; k++) {
    const a = (k / SQUARE_RING_TREES) * Math.PI * 2 + Math.PI / SQUARE_RING_TREES;
    const t = { x: block.rect.x + Math.cos(a) * SQUARE_TREE_RADIUS, z: block.rect.z + Math.sin(a) * SQUARE_TREE_RADIUS };
    if (centrepiece.kind === 'ramp' && inRampLane(centrepiece, t)) continue; // keep the run-up and landing clear
    trees.push(t);
  }
  return { buildings, trees };
}

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

  // Town squares: ~4 of the busy blocks.
  const busy = blocks.filter((b) => !b.park && (b.zone === 'downtown' || b.zone === 'midtown'));
  const squares: Block[] = [];
  const target = Math.min(4, busy.length);
  for (let tries = 0; squares.length < target && tries < 50; tries++) {
    const b = rng.pick(busy);
    // Spread them out: no two squares within two blocks of each other.
    if (squares.includes(b) || squares.some((s) => Math.hypot(s.rect.x - b.rect.x, s.rect.z - b.rect.z) < config.blockSize * 2.5)) continue;
    squares.push(b);
  }
  // Each square's centrepiece is any landmark, ramp included, all equally likely. A ramp goes on
  // a free street spot (lip toward a junction) when there is one, and the square re-rolls a
  // monument; with no street spot left the ramp stays in the square as is.
  const pitch = config.blockSize + config.roadWidth;
  const streetRamps: Landmark[] = [];
  for (const b of squares) {
    let kind = rng.pick(LANDMARK_KINDS);
    if (kind === 'ramp') {
      // Never two on one street, nor one's run-up or landing on another's street.
      const free = rampSpots.filter((p) => streetRamps.every((r) => Math.hypot(r.x - p.x, r.z - p.z) > pitch * 2));
      if (free.length) {
        streetRamps.push({ kind: 'ramp', ...rng.pick(free), radius: LANDMARK_RADIUS.ramp });
        kind = rng.pick(MONUMENT_KINDS);
      }
    }
    landmarks.push({ kind, x: b.rect.x, z: b.rect.z, yaw: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), radius: LANDMARK_RADIUS[kind] });
  }
  squares.forEach((s, i) => ({ buildings, trees } = makeSquare(s, landmarks[i], buildings, trees, config)));

  landmarks.push(...streetRamps);

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
