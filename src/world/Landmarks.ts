// Landmarks: town squares (a few downtown/midtown blocks paved over around a centrepiece) and
// centrepieces in some parks. Pure data — LandmarkBuilder renders it.
import type { Rng } from '../core/Rng';
import type { Block, Building, CityConfig } from './CityGenerator';

export type LandmarkKind = 'fountain' | 'statue' | 'obelisk' | 'sculpture';

export interface Landmark {
  kind: LandmarkKind;
  x: number;
  z: number;
  yaw: number;
  /** Footprint radius in metres (solid). */
  radius: number;
}

export const LANDMARK_RADIUS: Record<LandmarkKind, number> = {
  fountain: 5,
  statue: 1.6,
  obelisk: 1.8,
  sculpture: 2.2,
};

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
  buildings = buildings.filter((bd) => !squares.some((s) => inBlock(s, bd)));
  trees = trees.filter((t) => !squares.some((s) => inBlock(s, t)));
  // A ring of trees around each square.
  for (const s of squares) {
    for (let k = 0; k < SQUARE_RING_TREES; k++) {
      const a = (k / SQUARE_RING_TREES) * Math.PI * 2 + Math.PI / SQUARE_RING_TREES;
      trees.push({ x: s.rect.x + Math.cos(a) * SQUARE_TREE_RADIUS, z: s.rect.z + Math.sin(a) * SQUARE_TREE_RADIUS });
    }
  }

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
