// The Forest's woods: dirt tracks winding through the blocks street to street (the one way through
// that a car, and so a cop, can take), clearings in the special blocks, and the trees packed round
// them 3.4–6 m apart (each tree claims a disc; two discs never overlap). Pure data on the district's
// stream; the trees are ordinary breakable tree props with their own kind (pine and round here,
// swapped per climate at run time by `RunDressing.trees`).
import type { Rng } from '../../core/Rng';
import { footprintDistance, pathDistance } from '../../ai/NavGrid';
import { FOREST } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { FootprintIndex, PROP_SPECS, propSpec, type Footprint, type StreetProp } from '../StreetProps';
import type { District, Structure } from './District';
import { SIDES, streetSidesOf, type Side } from './Megapark';

type P = { x: number; z: number };

/** A dirt track: a polyline on the ground from one sidewalk line to another, `width` across. */
export interface Track {
  block: number;
  points: P[];
  width: number;
}

/** An open round clearing in a block (the lookout's, the campsite's). */
export interface Clearing extends P {
  block: number;
  r: number;
}

const SAMPLES = 14; // points along a track

/** Distance from p to a track's centre line. */
export const trackDistance = (t: Track, p: P): number => pathDistance(t.points, p.x, p.z);

/** The point on a block's sidewalk line on `side`, `along` from its middle. */
function onSide(inner: Rect, side: Side, along: number): P {
  return side.nx ? { x: inner.x + (side.nx * inner.w) / 2, z: inner.z + along } : { x: inner.x + along, z: inner.z + (side.nz * inner.d) / 2 };
}

const bezier = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * a.x + w[1] * b.x + w[2] * c.x + w[3] * d.x, z: w[0] * a.z + w[1] * b.z + w[2] * c.z + w[3] * d.z };
};

const clampTo = (r: Rect, p: P): P => ({ x: Math.max(r.x - r.w / 2, Math.min(r.x + r.w / 2, p.x)), z: Math.max(r.z - r.d / 2, Math.min(r.z + r.d / 2, p.z)) });

/**
 * One track through block k: in from a street side, out by the opposite side (or, now and then, a
 * side street: a bend), the middle swung off the straight line. A cubic curve whose control points
 * stay inside the block, so the whole track does. Null when the block has fewer than two street sides.
 */
export function layTrack(k: number, city: CityData, rng: Rng): Track | null {
  const sides = streetSidesOf(k, city);
  if (sides.length < 2) return null;
  const inner = shrink(city.blocks[k].rect, city.config.sidewalk);
  const w = FOREST.track;
  const a = sides[rng.int(0, sides.length - 1)];
  const opposite = sides.find((s) => s.nx === -a.nx && s.nz === -a.nz);
  const bends = sides.filter((s) => s.nx !== -a.nx || s.nz !== -a.nz).filter((s) => s !== a);
  const b = opposite && (!bends.length || rng.next() >= FOREST.bendShare) ? opposite : bends[rng.int(0, bends.length - 1)];
  // Clear of the corners (the junction mouths): the ends keep 12 m from them.
  const span = (s: Side) => (s.nx ? inner.d : inner.w) / 2 - 12;
  const p0 = onSide(inner, a, rng.range(-span(a), span(a)));
  const p3 = onSide(inner, b, rng.range(-span(b), span(b)));
  // Each end leaves square to its sidewalk line for a few metres, then the curve swings sideways.
  const lead = FOREST.trackLead;
  const q0 = { x: p0.x - a.nx * lead, z: p0.z - a.nz * lead }, q3 = { x: p3.x - b.nx * lead, z: p3.z - b.nz * lead };
  const reach = Math.hypot(q3.x - q0.x, q3.z - q0.z) / 3;
  const room = shrink(inner, w / 2 + 1);
  const swing = () => rng.range(-FOREST.trackWobble, FOREST.trackWobble);
  const c1 = clampTo(room, { x: q0.x - a.nx * reach + (a.nx ? 0 : swing()), z: q0.z - a.nz * reach + (a.nz ? 0 : swing()) });
  const c2 = clampTo(room, { x: q3.x - b.nx * reach + (b.nx ? 0 : swing()), z: q3.z - b.nz * reach + (b.nz ? 0 : swing()) });
  const points = [p0, ...Array.from({ length: SAMPLES + 1 }, (_, i) => bezier(q0, c1, c2, q3, i / SAMPLES)), p3];
  return { block: k, points, width: w };
}

/** Does the track keep `m` metres past its edge clear of every footprint in `fps`? */
export function trackClearOf(t: Track, fps: Footprint[], m: number): boolean {
  for (let i = 1; i < t.points.length; i++) {
    const a = t.points[i - 1], b = t.points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let s = 0; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n, z = a.z + ((b.z - a.z) * s) / n;
      if (fps.some((f) => footprintDistance(f, x, z) < t.width / 2 + m)) return false;
    }
  }
  return true;
}

/** A clearing on a track's middle (moved in to fit the block). */
export function layClearing(t: Track, city: CityData, rng: Rng): Clearing {
  const r = rng.range(FOREST.clearing[0], FOREST.clearing[1]);
  const mid = t.points[Math.floor(t.points.length / 2)];
  const room = shrink(city.blocks[t.block].rect, city.config.sidewalk + r + 1);
  return { block: t.block, r, ...clampTo(room, mid) };
}

/** The sidewalk strip in front of a track's mouth (kerb clutter keeps off it, 3 m into the road as well). */
export function trackMouths(t: Track, city: CityData): Rect[] {
  const block = city.blocks[t.block].rect;
  const sw = city.config.sidewalk;
  const out: Rect[] = [];
  for (const p of [t.points[0], t.points[t.points.length - 1]]) {
    const s = SIDES.find((s) => (s.nx ? Math.abs(p.x - (block.x + (s.nx * (block.w / 2 - sw)))) < 0.01 : Math.abs(p.z - (block.z + (s.nz * (block.d / 2 - sw)))) < 0.01))!;
    const deep = sw + 3, wide = t.width + 3;
    out.push(s.nx ? { x: p.x + (s.nx * deep) / 2, z: p.z, w: deep, d: wide } : { x: p.x, z: p.z + (s.nz * deep) / 2, w: wide, d: deep });
  }
  return out;
}

/** A flat grid of claimed discs, for the spacing test. */
class Discs {
  private cells = new Map<number, (P & { r: number })[]>();
  constructor(private size: number) {}
  private key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  fits(x: number, z: number, r: number): boolean {
    const i = Math.floor(x / this.size), j = Math.floor(z / this.size);
    for (let a = i - 1; a <= i + 1; a++) {
      for (let b = j - 1; b <= j + 1; b++) {
        for (const d of this.cells.get(this.key(a, b)) ?? []) if (Math.hypot(d.x - x, d.z - z) < d.r + r) return false;
      }
    }
    return true;
  }
  add(x: number, z: number, r: number): void {
    const k = this.key(Math.floor(x / this.size), Math.floor(z / this.size));
    const list = this.cells.get(k) ?? [];
    list.push({ x, z, r });
    this.cells.set(k, list);
  }
}

/**
 * The trees of the woods blocks (and round the clearings): dart throwing, each tree claiming a disc
 * of FOREST.spacing, kept inside the sidewalk line, off the tracks and out of the clearings.
 * `open`: blocks left without trees (the lumber yard's); `avoid`: what they keep a metre off
 * (buildings, gate posts, set pieces).
 */
export function layTrees(q: District, city: CityData, tracks: Track[], clearings: Clearing[], open: Set<number>, avoid: Footprint[], rng: Rng): StreetProp[] {
  const out: StreetProp[] = [];
  const solid = new FootprintIndex(avoid.map((f) => ({ ...f, hx: f.hx + 1, hz: f.hz + 1 })));
  const discs = new Discs(FOREST.spacing[1] * 2);
  const [lo, hi] = FOREST.spacing;
  for (const k of [...q.blocks].sort((a, b) => a - b)) {
    if (open.has(k)) continue;
    const room = shrink(city.blocks[k].rect, city.config.sidewalk + FOREST.edge);
    const mine = tracks.filter((t) => t.block === k);
    const glades = clearings.filter((c) => c.block === k);
    const tries = Math.round((room.w * room.d) / (Math.PI * lo * lo)) * 5;
    for (let t = 0; t < tries; t++) {
      const x = room.x + rng.range(-room.w / 2, room.w / 2), z = room.z + rng.range(-room.d / 2, room.d / 2);
      const r = rng.range(lo, hi);
      const pine = rng.next() < FOREST.pineShare;
      const scale = rng.range(0.9, 1.35), yaw = rng.range(0, Math.PI * 2);
      const prop: StreetProp = { kind: 'tree', tree: pine ? 'pine' : 'round', x, z, yaw, scale };
      const trunk = propSpec(prop).hx;
      if (mine.some((tr) => trackDistance(tr, prop) < tr.width / 2 + FOREST.trackClear + trunk)) continue;
      if (glades.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + trunk)) continue;
      if (!inRect(room, prop) || !discs.fits(x, z, r) || solid.hits({ x, z, hx: trunk, hz: trunk, yaw: 0 })) continue;
      discs.add(x, z, r);
      out.push(prop);
    }
  }
  return out;
}

/** The trees a dressed forest planted. */
export const forestTrees = (q: District) => q.dressing.props.filter((p) => p.kind === 'tree');

export interface FloorLayout {
  props: StreetProp[]; // ferns, fallen logs
  structures: Structure[]; // boulders, stumps
  solids: Footprint[];
}

/**
 * The forest floor between the trees: fern clumps (breakable), fallen logs, boulders and stumps
 * (solid), off the tracks and out of the clearings, clear of the trees' trunks and of `avoid`.
 */
export function layFloor(q: District, city: CityData, tracks: Track[], clearings: Clearing[], open: Set<number>, trees: StreetProp[], avoid: Footprint[], rng: Rng): FloorLayout {
  const out: FloorLayout = { props: [], structures: [], solids: [] };
  const F = FOREST.floor;
  const taken = new FootprintIndex([...avoid, ...trees.map((t) => ({ x: t.x, z: t.z, hx: propSpec(t).hx + 0.3, hz: propSpec(t).hx + 0.3, yaw: 0 }))]);
  for (const k of [...q.blocks].sort((a, b) => a - b)) {
    if (open.has(k)) continue;
    const room = shrink(city.blocks[k].rect, city.config.sidewalk + FOREST.edge);
    const mine = tracks.filter((t) => t.block === k);
    const glades = clearings.filter((c) => c.block === k);
    /** A free spot for a footprint of these half sizes (at a random yaw), or null. */
    const spot = (hx: number, hz: number, margin: number): Footprint | null => {
      for (let t = 0; t < 14; t++) {
        const fp: Footprint = { x: room.x + rng.range(-room.w / 2, room.w / 2), z: room.z + rng.range(-room.d / 2, room.d / 2), hx, hz, yaw: rng.range(0, Math.PI) };
        const reach = Math.hypot(hx, hz);
        if (!inRect(shrink(room, reach), fp)) continue;
        if (mine.some((tr) => trackDistance(tr, fp) < tr.width / 2 + margin + reach)) continue;
        if (glades.some((c) => Math.hypot(c.x - fp.x, c.z - fp.z) < c.r + reach)) continue;
        if (taken.hits(fp)) continue;
        return fp;
      }
      return null;
    };
    const solid = (kind: string, fp: Footprint | null, data: Record<string, unknown>) => {
      if (!fp) return;
      out.structures.push({ kind, x: fp.x, z: fp.z, yaw: fp.yaw, footprints: [fp], data });
      out.solids.push(fp);
      taken.add({ ...fp, hx: fp.hx + 0.4, hz: fp.hz + 0.4 });
    };
    for (let i = rng.int(F.logs[0], F.logs[1]); i > 0; i--) {
      const len = rng.range(4, 7);
      const fp = spot(len / 2, 0.35, FOREST.trackClear);
      rng.range(0, 1), rng.int(1, 1e6); // the old radius and model seed: kept so the floor after them stays put
      if (!fp) continue;
      // A prop: a car hard enough into it rolls it aside (PROP_SPECS.log).
      out.props.push({ kind: 'log', x: fp.x, z: fp.z, yaw: fp.yaw, scale: len / 5 });
      taken.add({ ...fp, hx: fp.hx + 0.4, hz: fp.hz + 0.4 });
    }
    for (let i = rng.int(F.boulders[0], F.boulders[1]); i > 0; i--) {
      const r = rng.range(0.7, 1.3);
      solid('boulder', spot(r, r * 0.8, FOREST.trackClear), { r, seed: rng.int(1, 1e6) });
    }
    for (let i = rng.int(F.stumps[0], F.stumps[1]); i > 0; i--) {
      const r = rng.range(0.3, 0.45);
      const fp = spot(r, r, FOREST.trackClear);
      rng.range(0.35, 0.7); // the old height: kept so the floor after it stays put
      if (!fp) continue;
      // A prop: rotten through, the lightest hit knocks it out (PROP_SPECS.stump).
      out.props.push({ kind: 'stump', x: fp.x, z: fp.z, yaw: fp.yaw, scale: r / PROP_SPECS.stump.hx });
      taken.add({ ...fp, hx: fp.hx + 0.4, hz: fp.hz + 0.4 });
    }
    // Ferns may grow to the track's edge (they snap under a wheel).
    for (let i = rng.int(F.ferns[0], F.ferns[1]); i > 0; i--) {
      const fp = spot(0.5, 0.5, 0.3);
      if (!fp) continue;
      out.props.push({ kind: 'fern', x: fp.x, z: fp.z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.4) });
      taken.add(fp);
    }
  }
  return out;
}
