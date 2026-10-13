// Right of way at junctions, between civilians. Each driver about to cross a junction claims the
// ground its body will sweep through it; it may go only when no one already crossing (committed)
// needs any of that ground, and no one ahead of it in the pecking order is waiting for it:
// - a priority road (no sign) or a green light before a stop sign,
// - then, on the same footing, going straight or turning onto the kerb side before turning across
//   the oncoming lane,
// - then first come, first served (at a stop sign: whoever stopped first).
// Someone ahead in that order who is held up by a driver already crossing doesn't hold us up too, if
// our way is clear: we slip through first (unless they've waited a long while).
// Turning across the oncoming lane only waits so long for a gap: after a while it takes its turn
// first come, first served, and oncoming traffic still clear of the junction lets it go.
// Once close enough that stopping would be a lurch, a driver commits and keeps its claim until
// it's out of the junction; the ground it has driven past is freed as it goes, so cross traffic
// can follow it through. Pure logic: the controllers drive it.

export interface JunctionClaim {
  owner: number; // body handle
  entry: number; // node we come in from: drivers in the same lane follow, they don't conflict
  /** Ground we'll sweep: grid cell → how far along `track` we are when we last cover it. */
  cells: Map<number, number>;
  /** Our centre's path through the junction; s = metres along it. */
  track: { x: number; z: number; s: number }[];
  /** Lower goes first: [give way (stop sign), crossing the oncoming lane, waiting since]. */
  rank: [number, number, number];
  committed: boolean;
  /** Metres along `track` we've come: the ground behind us is clear of us. */
  passed: number;
  seen: number; // last refreshed: claims left by a car that's gone lapse
}

const STALE = 1; // seconds without a refresh before a claim is dropped
// Someone ahead of us in the order who can't go anyway (someone crossing is in their way) doesn't
// hold us up if our way is clear: we slip through first, unless they've waited this long already.
const SLIP_PATIENCE = 10;
const ACROSS_PATIENCE = 6; // seconds turning across the oncoming lane waits for a gap before it's first come, first served
export const CELL = 0.5; // metres, grid the swept ground is kept on

const cellKey = (ix: number, iz: number) => (ix + 2048) * 4096 + (iz + 2048);

/**
 * Add a body's footprint (a rectangle centred on (x, z), heading (fx, fz), grown by `margin`) to
 * `cells`, as cells within `zone` (square) of the junction centre (cx, cz), relative to it.
 */
export function addFootprint(
  cells: Map<number, number>,
  s: number,
  x: number,
  z: number,
  fx: number,
  fz: number,
  halfWidth: number,
  halfLength: number,
  margin: number,
  cx: number,
  cz: number,
  zone: number,
): void {
  const hw = halfWidth + margin;
  const hl = halfLength + margin;
  const ex = Math.abs(fx) * hl + Math.abs(fz) * hw; // bounding box half extents
  const ez = Math.abs(fz) * hl + Math.abs(fx) * hw;
  const lx = Math.max(x - ex, cx - zone);
  const hx = Math.min(x + ex, cx + zone);
  const lz = Math.max(z - ez, cz - zone);
  const hz = Math.min(z + ez, cz + zone);
  for (let ix = Math.floor((lx - cx) / CELL); ix * CELL + cx <= hx; ix++) {
    for (let iz = Math.floor((lz - cz) / CELL); iz * CELL + cz <= hz; iz++) {
      const px = cx + (ix + 0.5) * CELL - x;
      const pz = cz + (iz + 0.5) * CELL - z;
      if (Math.abs(px * fx + pz * fz) > hl || Math.abs(px * -fz + pz * fx) > hw) continue;
      const key = cellKey(ix, iz);
      cells.set(key, Math.max(cells.get(key) ?? -Infinity, s));
    }
  }
}

/** Whether two drivers need the same ground (not counting what either has already driven past). */
export function conflicts(a: JunctionClaim, b: JunctionClaim): boolean {
  if (a.entry === b.entry) return false;
  const [small, big] = a.cells.size < b.cells.size ? [a, b] : [b, a];
  for (const [key, s] of small.cells) {
    if (s < small.passed) continue;
    const t = big.cells.get(key);
    if (t !== undefined && t >= big.passed) return true;
  }
  return false;
}

/** Metres along a track to the point nearest (x, z). */
export function alongTrack(track: JunctionClaim['track'], x: number, z: number): number {
  let best = Infinity;
  let s = -Infinity;
  for (const q of track) {
    const d = (q.x - x) ** 2 + (q.z - z) ** 2;
    if (d < best) {
      best = d;
      s = q.s;
    }
  }
  return s;
}

/** Order of two claims (negative: a goes first) at `time`. */
function before(a: JunctionClaim['rank'], b: JunctionClaim['rank'], time: number): number {
  const across = (r: JunctionClaim['rank']) => (r[1] && time - r[2] < ACROSS_PATIENCE ? 1 : 0);
  return a[0] - b[0] || across(a) - across(b) || a[2] - b[2];
}

export class Junctions {
  private at = new Map<number, Map<number, JunctionClaim>>();

  private claims(node: number, time: number): Map<number, JunctionClaim> {
    let m = this.at.get(node);
    if (!m) this.at.set(node, (m = new Map()));
    for (const [owner, c] of m) if (time - c.seen > STALE) m.delete(owner);
    return m;
  }

  /**
   * Put in (or refresh) a claim for going through `node`; true if we may go now. A committed
   * claim always may.
   */
  ask(node: number, claim: JunctionClaim, time: number): boolean {
    const m = this.claims(node, time);
    claim.seen = time;
    m.set(claim.owner, claim);
    if (claim.committed) return true;
    const crossing = [...m.values()].filter((c) => c.committed && c !== claim);
    for (const other of m.values()) {
      if (other === claim) continue;
      const order = before(other.rank, claim.rank, time) || other.owner - claim.owner;
      if (!(other.committed || order < 0) || !conflicts(claim, other)) continue;
      const stuck = !other.committed && time - other.rank[2] < SLIP_PATIENCE && crossing.some((c) => conflicts(other, c));
      if (!stuck) return false;
    }
    return true;
  }

  /** Done with `node` (through it, or no longer waiting for it). */
  leave(node: number, owner: number): void {
    this.at.get(node)?.delete(owner);
  }

  /** Everyone's claims at a junction (for tests). */
  list(node: number): JunctionClaim[] {
    return [...(this.at.get(node)?.values() ?? [])];
  }
}
