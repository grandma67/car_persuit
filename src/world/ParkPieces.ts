// Park pieces: a fish pond or a soccer pitch in a park the centrepiece roll left empty. Pure data.
// Laid after the districts (parks inside one are skipped), each park from its own stream
// (`seed ^ PARKS.salt`, then one draw per block in block order, then the piece's own sub-stream), so
// nothing that rolled before moves and pinning one park's piece never shifts another's.
import { Rng } from '../core/Rng';
import { PARKS } from '../gameplay/balance';
import type { Block, CityConfig } from './CityGenerator';
import type { Landmark } from './Landmarks';
import { footprintsOverlap, propFootprint, type StreetProp } from './StreetProps';
import { onGround, type Terrain } from './Terrain';
import { rimPoints, shoreDistance, waterReach, type ShallowWater } from './Water';

export type ParkPieceKind = 'pond' | 'pitch';

export interface LilyPad {
  x: number;
  z: number;
  r: number;
  yaw: number; // where the notch points
}

export interface ParkPiece {
  kind: ParkPieceKind;
  block: [number, number]; // grid cell (i, j)
  x: number;
  z: number;
  yaw: number;
  /** Ponds: the water (also in city.water), its lily pads, and whether the rim is stone (else grass and reeds). */
  water?: ShallowWater;
  pads?: LilyPad[];
  stoneRim?: boolean;
  /** Pitches: the long side runs along world X (else Z); its length and width (touchlines in). */
  alongX?: boolean;
  length?: number;
  width?: number;
}

/** What laying the pieces adds to the city and how much ground each one clears. */
export interface ParkPieceLayout {
  pieces: ParkPiece[];
  water: ShallowWater[];
  props: StreetProp[];
  landmarks: Landmark[];
  /** Trees and loose park benches inside these go (true = clear). */
  clears: (x: number, z: number, r: number) => boolean;
}

/** Half the park's grass, inside the picket fence, where a piece may reach. */
const grassHalf = (config: CityConfig) => config.blockSize / 2 - PARKS.fenceInset - 1;

/**
 * The piece each park gets: one draw per block (in block order) whatever it is, so a park's roll
 * never depends on another block. `pins` (block index → kind or none) overrides a park's roll.
 */
export function rollParkPieces(blocks: Block[], hasCentrepiece: (b: Block) => boolean, seed: number, pins?: Map<number, ParkPieceKind | null>): Map<number, ParkPieceKind> {
  const rng = new Rng(seed ^ PARKS.salt);
  const out = new Map<number, ParkPieceKind>();
  blocks.forEach((b, k) => {
    const r = rng.next(); // every block draws: a district taking a park over must not shift the rest
    if (!b.park) return;
    let kind: ParkPieceKind | null = r < PARKS.pondChance ? 'pond' : r < PARKS.pondChance + PARKS.pitchChance ? 'pitch' : null;
    if (pins?.has(k)) kind = pins.get(k)!;
    if (kind && !b.district && !b.square && !hasCentrepiece(b)) out.set(k, kind);
  });
  return out;
}

/** A pond in the park `block` (index k of an n-wide grid), from its own stream. Null if it can't fit dry. */
export function layPond(block: Block, k: number, n: number, config: CityConfig, terrain: Terrain, seed: number): Omit<ParkPieceLayout, 'clears'> & { piece: ParkPiece } | null {
  const rng = new Rng(seed ^ PARKS.salt ^ ((k + 1) * 0x9e3779b1));
  const half = grassHalf(config);
  const rx = rng.range(PARKS.pondRadius[0], PARKS.pondRadius[1]);
  const rz = rx * rng.range(0.6, 0.85);
  const wobble: [number, number, number][] = [
    [rng.int(2, 3), rng.range(0.06, 0.12), rng.range(0, Math.PI * 2)],
    [rng.int(4, 5), rng.range(0.03, 0.06), rng.range(0, Math.PI * 2)],
  ];
  const shape = { kind: 'pond' as const, x: 0, z: 0, rx, rz, yaw: rng.range(0, Math.PI * 2), wobble, depth: PARKS.pondDepth };
  // Room round it for the benches and the boat on the bank.
  const room = half - waterReach(shape) - PARKS.bankRoom;
  const off = Math.max(0, Math.min(PARKS.pondOffset, room));
  const water: ShallowWater = { ...shape, x: block.rect.x + rng.range(-off, off), z: block.rect.z + rng.range(-off, off) };
  if (room < 0 || !onGround(terrain, water.x, water.z, waterReach(water) + PARKS.bankRoom)) return null;

  const props: StreetProp[] = [];
  const landmarks: Landmark[] = [];
  const stoneRim = rng.next() < PARKS.stoneRimChance;
  const rim = rimPoints(water, 48);
  const at = (t: number, out: number) => {
    // A point `out` metres from the water (by shoreDistance) beyond rim step t (of 48), and the
    // heading facing the water. Radially out, stepping on until it is that far from the shore.
    const p = rim[((t % 48) + 48) % 48];
    const dx = p.x - water.x;
    const dz = p.z - water.z;
    const l = Math.hypot(dx, dz) || 1;
    let d = out;
    while (out > 0 && shoreDistance(water, p.x + (dx / l) * d, p.z + (dz / l) * d) > -out && d < out * 3) d += 0.1;
    return { x: p.x + (dx / l) * d, z: p.z + (dz / l) * d, facing: Math.atan2(-dx, -dz) };
  };
  // Reed clumps straddling the edge (all round a grass rim, a few gaps in a stone one).
  const clumps = stoneRim ? rng.int(2, 3) : rng.int(4, 6);
  const used: number[] = [];
  // Rim steps (of 48) between a and b, either way round.
  const apart = (a: number, b: number) => Math.min(((a - b) % 48 + 48) % 48, ((b - a) % 48 + 48) % 48);
  for (let c = 0; c < clumps; c++) {
    const t0 = rng.int(0, 47);
    if (used.some((u) => apart(t0, u) < 9)) continue; // clumps (4 steps long) kept apart
    used.push(t0);
    const reeds = rng.int(2, 3);
    for (let r = 0; r < reeds; r++) {
      const p = at(t0 + r * 2, rng.range(-0.6, 0.3));
      props.push({ kind: 'reeds', x: p.x, z: p.z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.2) });
    }
  }
  // A clump spans rim steps u..u+4; keep the bank pieces 4 steps clear of either end.
  const free = (t: number) => !used.some((u) => apart(t, u) < 4 || apart(t, u + 2) < 4 || apart(t, u + 4) < 4);
  // Two benches on the bank facing the water, the boat pulled up on it, a sign by the path.
  const spots = Array.from({ length: 48 }, (_, t) => t).filter(free);
  const take = () => {
    const t = spots.length ? spots.splice(rng.int(0, spots.length - 1), 1)[0] : rng.int(0, 47);
    for (let d = -4; d <= 4; d++) {
      const i = spots.indexOf(((t + d) % 48 + 48) % 48);
      if (i >= 0) spots.splice(i, 1);
    }
    return t;
  };
  for (let b = 0; b < 2; b++) {
    const p = at(take(), PARKS.benchOut);
    props.push({ kind: 'bench', x: p.x, z: p.z, yaw: p.facing });
  }
  const boat = at(take(), PARKS.boatOut);
  const rowboat: Landmark = { kind: 'rowboat', x: boat.x, z: boat.z, yaw: boat.facing + Math.PI / 2 + rng.range(-0.3, 0.3), radius: PARKS.boatRadius };
  landmarks.push(rowboat);
  // Reeds crushed under the boat go.
  const hull = { x: rowboat.x, z: rowboat.z, hx: rowboat.radius, hz: rowboat.radius, yaw: rowboat.yaw };
  for (let r = props.length - 1; r >= 0; r--) if (props[r].kind === 'reeds' && footprintsOverlap(hull, propFootprint(props[r]))) props.splice(r, 1);
  const sign = at(take(), PARKS.signOut);
  props.push({ kind: 'sign', variant: 'noFishing', x: sign.x, z: sign.z, yaw: sign.facing + Math.PI }); // faces the path

  // Lily pads in the calm water away from the edge.
  const pads: LilyPad[] = [];
  for (let tries = 0; tries < 60 && pads.length < PARKS.pads; tries++) {
    const x = water.x + rng.range(-water.rx, water.rx);
    const z = water.z + rng.range(-water.rx, water.rx);
    const r = rng.range(0.35, 0.7);
    if (shoreDistance(water, x, z) < 1.2 + r) continue;
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.15)) continue;
    pads.push({ x, z, r, yaw: rng.range(0, Math.PI * 2) });
  }
  const [i, j] = [k % n, Math.floor(k / n)];
  const piece: ParkPiece = { kind: 'pond', block: [i, j], x: water.x, z: water.z, yaw: water.yaw, water, pads, stoneRim };
  return { piece, pieces: [piece], water: [water], props, landmarks };
}

/** A soccer pitch in the park `block`, from its own stream. Null if it can't fit dry. */
export function layPitch(block: Block, k: number, n: number, config: CityConfig, terrain: Terrain, seed: number): { piece: ParkPiece; props: StreetProp[] } | null {
  const rng = new Rng(seed ^ PARKS.salt ^ ((k + 1) * 0x9e3779b1));
  const half = grassHalf(config);
  const L = PARKS.pitchLength;
  const W = PARKS.pitchWidth;
  const alongX = rng.next() < 0.5;
  // Its whole footprint (run-off, the fences behind the goals, the floodlights) inside the fence.
  const reachU = L / 2 + PARKS.pitchRunOff;
  const reachV = W / 2 + PARKS.pitchRunOff;
  const du = rng.range(-1, 1) * Math.max(0, half - reachU);
  const dv = rng.range(-1, 1) * Math.max(0, half - reachV);
  if (reachU > half || reachV > half) return null;
  const cx = block.rect.x + (alongX ? du : dv);
  const cz = block.rect.z + (alongX ? dv : du);
  const at = (u: number, v: number) => (alongX ? { x: cx + u, z: cz + v } : { x: cx + v, z: cz + u });
  const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => at(a * reachU, b * reachV));
  if (corners.some((c) => !onGround(terrain, c.x, c.z, 1))) return null;
  const facing = (p: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(to.x - p.x, to.z - p.z);
  const centre = { x: cx, z: cz };
  const props: StreetProp[] = [];
  for (const e of [-1, 1]) {
    // The goal on the goal line, mouth facing up the pitch; chain-link behind it to stop the ball.
    const g = at(e * (L / 2 + 0.5), 0);
    props.push({ kind: 'goal', ...g, yaw: facing(g, centre) });
    for (const v of [-PARKS.fencePanel, 0, PARKS.fencePanel]) {
      props.push({ kind: 'fence', style: 'chainlink', ...at(e * (L / 2 + PARKS.fenceBehind), v), yaw: alongX ? Math.PI / 2 : 0 });
    }
    for (const s of [-1, 1]) {
      const f = at(e * L / 2, s * W / 2);
      props.push({ kind: 'cornerFlag', ...f, yaw: facing(f, centre) });
      // Floodlights: tall lamps off each corner, arms over the pitch.
      const lamp = at(e * (L / 2 + PARKS.lampOut), s * (W / 2 + PARKS.lampOut));
      props.push({ kind: 'lamp', ...lamp, yaw: facing(lamp, centre) });
    }
  }
  // Two benches by the halfway line on one side, facing the play.
  const side = rng.next() < 0.5 ? -1 : 1;
  for (const u of [-PARKS.dugout, PARKS.dugout]) {
    const b = at(u, side * (W / 2 + PARKS.benchBack));
    props.push({ kind: 'bench', ...b, yaw: facing(b, at(u, 0)) });
  }
  const spot = at(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5));
  props.push({ kind: 'ball', ...spot, yaw: rng.range(0, Math.PI * 2) });
  const [i, j] = [k % n, Math.floor(k / n)];
  return { piece: { kind: 'pitch', block: [i, j], x: cx, z: cz, yaw: alongX ? 0 : Math.PI / 2, alongX, length: L, width: W }, props };
}

/** Whether (x, z) lies within `margin` of a pitch's footprint (run-off included). */
export function onPitch(p: ParkPiece, x: number, z: number, margin = 0): boolean {
  const du = Math.abs(p.alongX ? x - p.x : z - p.z);
  const dv = Math.abs(p.alongX ? z - p.z : x - p.x);
  return du <= p.length! / 2 + PARKS.pitchRunOff + margin && dv <= p.width! / 2 + PARKS.pitchRunOff + margin;
}

/** Lay every rolled piece. */
export function layParkPieces(blocks: Block[], rolled: Map<number, ParkPieceKind>, n: number, config: CityConfig, terrain: Terrain, seed: number): ParkPieceLayout {
  const out: ParkPieceLayout = { pieces: [], water: [], props: [], landmarks: [], clears: () => false };
  for (const [k, kind] of rolled) {
    if (kind === 'pitch') {
      const pitch = layPitch(blocks[k], k, n, config, terrain, seed);
      if (!pitch) continue;
      out.pieces.push(pitch.piece);
      out.props.push(...pitch.props);
      continue;
    }
    const pond = layPond(blocks[k], k, n, config, terrain, seed);
    if (!pond) continue;
    out.pieces.push(pond.piece);
    out.water.push(...pond.water);
    out.props.push(...pond.props);
    out.landmarks.push(...pond.landmarks);
  }
  const ponds = out.water;
  const pitches = out.pieces.filter((p) => p.kind === 'pitch');
  out.clears = (x, z, r) => ponds.some((w) => shoreDistance(w, x, z) > -(PARKS.treeClear + r)) || pitches.some((p) => onPitch(p, x, z, r + 0.5));
  return out;
}
