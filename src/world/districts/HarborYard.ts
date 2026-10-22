// The Harbor's container yard: rows of stacked containers on a quay-row block, with corridors
// between them running straight from one street to the street opposite, and one across the rows
// through the middle. Each half row is one solid; the corridors are drivable. Pure data; drawn by
// render/districts/Harbor.ts.
import type { Rng } from '../../core/Rng';
import { CONTAINER, HARBOR } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import { footprintsOverlap, propFootprint, type Footprint, type StreetProp } from '../StreetProps';
import type { Structure } from './District';

/** One container: its centre on the ground plan, its tier (0 on the ground) and length. */
export interface Container {
  x: number;
  z: number;
  tier: number;
  base?: number; // tier 0's bottom above the ground (on a flatcar's deck)
  alongX: boolean; // its length runs along X
  len: number;
  color: number;
}

/** A 'stack' structure's data: a half row of container columns. */
export interface StackData {
  containers: Container[];
}

/** Shipping-line colours: made-up lines, plain paint (reefers white). */
export const LINE_COLOURS = [0xb03a2e, 0x2f5f9a, 0x3f7a4a, 0xd8762a, 0x8a8f94, 0xe8e8e4, 0x7a2a2a, 0x2a7a7a, 0xc9a22a];

export interface Yard {
  stacks: Structure[]; // container stacks ('stack'), flatcars ('flatcar') with their boxes
  pieces: Structure[]; // floodlight masts, the reach stacker, straddle carriers, the rail track
  solids: Footprint[];
  corridors: Rect[]; // drivable, block edge to block edge (sidewalks included)
  rowsAlongX: boolean;
  /** Corridor mouths on the fence line: where each corridor meets it, and the corridor's width. */
  mouths: { x: number; z: number; alongX: boolean; width: number }[];
  /** The rail strip (inland side) when the yard has one: along the rows. */
  rail?: Rect;
}

/** A straddle carrier's data: its frames either side of the drivable gap, along the corridor. */
export interface StraddleData {
  alongX: boolean;
  length: number;
  gap: number; // between the frames
  frame: number; // each frame's width
  height: number;
}

const MAST = 0.5; // a floodlight mast's footprint, half side
const MAST_SLOT = 1.8; // the row end it takes
const STACKER_SLOT = 10.5; // the row end the reach stacker parks in
const RAIL_STRIP = 4.6; // across the rows: track, flatcars and clearance
export const FLATCAR = { length: 14.2, width: 2.6, deck: 1.25 };
const EMPTY_COLOURS = [0xb8b8b0, 0xd8d8d2, 0x9aa0a6];

/**
 * Lay out a yard block. `rowsAlongX`: the rows (and the corridors between them) run along X,
 * opening onto the streets on the block's ±X sides; the cross corridor runs along Z. `railAt`:
 * which side across the rows (−1, +1) gives up its edge to a rail siding, 0 for none.
 */
export function yardLayout(block: Rect, city: CityData, rowsAlongX: boolean, railAt: -1 | 0 | 1, rng: Rng): Yard {
  const s = city.config.sidewalk;
  const m = HARBOR.stackMargin;
  const L = (rowsAlongX ? block.w : block.d) - s * 2; // along the rows
  const D = (rowsAlongX ? block.d : block.w) - s * 2 - (railAt ? RAIL_STRIP : 0); // across them, less the rail strip
  const W = CONTAINER.w + 0.1;
  // Rows and their widths; fewer rows if the corridors would come out under ~7 m.
  let wides: number[] = [];
  for (let rows = rng.int(HARBOR.stackRows[0], HARBOR.stackRows[1]); rows >= 2; rows--) {
    wides = Array.from({ length: rows }, () => rng.int(HARBOR.stackWide[0], HARBOR.stackWide[1]));
    const depth = wides.reduce((a, k) => a + k * W, 0);
    if ((D - 2 * m - depth) / (rows - 1) >= 7) break;
  }
  const depths = wides.map((k) => k * W);
  const corridor = (D - 2 * m - depths.reduce((a, b) => a + b, 0)) / (wides.length - 1);
  const cross = HARBOR.crossCorridor;
  const half = (L - 2 * m - cross) / 2; // each half row's length
  // Local (u along the rows, v across) to world; the rows start past the rail strip.
  const v0 = (railAt < 0 ? RAIL_STRIP : 0) - (D + (railAt ? RAIL_STRIP : 0)) / 2;
  const at = (u: number, v: number) => (rowsAlongX ? { x: block.x + u, z: block.z + v } : { x: block.x + v, z: block.z + u });
  const rect = (uc: number, vc: number, ul: number, vl: number): Rect => ({ ...at(uc, vc), w: rowsAlongX ? ul : vl, d: rowsAlongX ? vl : ul });
  const fpOf = (r: Rect): Footprint => ({ x: r.x, z: r.z, hx: r.w / 2, hz: r.d / 2, yaw: 0 });
  const out: Yard = { stacks: [], pieces: [], solids: [], corridors: [], rowsAlongX, mouths: [] };
  // The empties' half row (a reach stacker parks at its outer end), and which half rows end in a mast.
  const empties = { r: rng.int(0, wides.length - 1), side: rng.next() < 0.5 ? -1 : 1 };
  const masted = (r: number, side: number) => side > 0 && r % 2 === 1;
  let v = v0 + m;
  const rowCentres: number[] = [];
  wides.forEach((wide, r) => {
    const depth = depths[r];
    const vc = v + depth / 2;
    rowCentres.push(vc);
    for (const side of [-1, 1]) {
      const empty = empties.r === r && empties.side === side;
      // The half row's span along u, its ends given up to a mast (inner end) or the stacker (outer).
      let inner = cross / 2, outer = cross / 2 + half;
      if (masted(r, side)) {
        const mc = at(side * (inner + MAST_SLOT / 2), vc);
        const fp: Footprint = { ...mc, hx: MAST, hz: MAST, yaw: 0 };
        out.pieces.push({ kind: 'mast', ...mc, yaw: 0, footprints: [fp] });
        out.solids.push(fp);
        inner += MAST_SLOT;
      }
      if (empty) {
        const len = 9.5, wid = Math.min(4.2, depth);
        const sc = { u: side * (outer - STACKER_SLOT / 2), v: vc };
        const r0 = rect(sc.u, sc.v, len, wid);
        out.pieces.push({ kind: 'reachStacker', ...at(sc.u, sc.v), yaw: rowsAlongX ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0, footprints: [fpOf(r0)] });
        out.solids.push(fpOf(r0));
        outer -= STACKER_SLOT;
      }
      const room = outer - inner;
      const uc = side * (inner + outer) / 2;
      // Container slots along the half row: mostly forties, a twenty where one fits, centred.
      const lens: number[] = [];
      let used = 0;
      for (;;) {
        const want = rng.next() < 0.65 ? CONTAINER.l40 : CONTAINER.l20;
        const len = used + want <= room ? want : used + CONTAINER.l20 <= room ? CONTAINER.l20 : 0;
        if (!len) break;
        lens.push(len);
        used += len + CONTAINER.gap;
      }
      used -= CONTAINER.gap;
      if (used <= 0) continue;
      const containers: Container[] = [];
      let u = uc - used / 2;
      for (const len of lens) {
        for (let k = 0; k < wide; k++) {
          const high = empty ? rng.int(3, HARBOR.stackHigh[1]) : rng.int(HARBOR.stackHigh[0], HARBOR.stackHigh[1]);
          const p = at(u + len / 2, vc - depth / 2 + W * (k + 0.5));
          for (let tier = 0; tier < high; tier++) containers.push({ ...p, tier, alongX: rowsAlongX, len, color: rng.pick(empty ? EMPTY_COLOURS : LINE_COLOURS) });
        }
        u += len + CONTAINER.gap;
      }
      const fp = fpOf(rect(uc, vc, used, depth));
      out.solids.push(fp);
      out.stacks.push({ kind: 'stack', x: fp.x, z: fp.z, yaw: 0, footprints: [fp], data: { containers } satisfies StackData as unknown as Record<string, unknown> });
    }
    v += depth;
    if (r < wides.length - 1) {
      // The corridor after this row, from block edge to block edge.
      out.corridors.push(rect(0, v + corridor / 2, L + s * 2, corridor));
      v += corridor;
    }
  });
  // Across the rows, through the middle.
  out.corridors.push(rect(0, 0, cross, D + (railAt ? RAIL_STRIP : 0) + s * 2));
  // Corridor mouths on the fence line (just inside the sidewalk): both ends of each corridor.
  const fenceU = L / 2 + s - FENCE_LINE, fenceV = (D + (railAt ? RAIL_STRIP : 0)) / 2 + s - FENCE_LINE;
  for (const c of out.corridors.slice(0, -1)) {
    const vc = rowsAlongX ? c.z - block.z : c.x - block.x;
    for (const end of [-1, 1]) out.mouths.push({ ...at(end * fenceU, vc), alongX: rowsAlongX, width: rowsAlongX ? c.d : c.w });
  }
  for (const end of [-1, 1]) out.mouths.push({ ...at(0, end * fenceV), alongX: !rowsAlongX, width: cross });

  // Straddle carriers parked in the corridors along the rows, the drivable gap between their frames.
  const carriers = rng.int(HARBOR.straddles[0], HARBOR.straddles[1]);
  for (let k = 0; k < carriers && wides.length > 1; k++) {
    const c = rng.int(0, wides.length - 2);
    const vc = (rowCentres[c] + depths[c] / 2 + rowCentres[c + 1] - depths[c + 1] / 2) / 2;
    const frame = 0.9, gap = Math.min(corridor - 2 * frame - 1.2, 4.4);
    if (gap < HARBOR.straddleGap) continue;
    const length = 8.5;
    const uc = (rng.next() < 0.5 ? -1 : 1) * rng.range(cross / 2 + length / 2 + 2, cross / 2 + half - length / 2 - 2);
    if (out.pieces.some((p) => p.kind === 'straddle' && Math.hypot(p.x - at(uc, vc).x, p.z - at(uc, vc).z) < length + 4)) continue;
    const fps = [-1, 1].map((sd) => fpOf(rect(uc, vc + sd * (gap / 2 + frame / 2), length, frame)));
    const data: StraddleData = { alongX: rowsAlongX, length, gap, frame, height: 12 };
    out.pieces.push({ kind: 'straddle', ...at(uc, vc), yaw: 0, footprints: fps, data: data as unknown as Record<string, unknown> });
    out.solids.push(...fps);
  }

  // The rail strip: a track along the rows and a rake of flatcars on it, clear of the cross corridor.
  if (railAt) {
    const vr = railAt * ((D + RAIL_STRIP) / 2 - RAIL_STRIP / 2);
    out.rail = rect(0, vr, L + s * 2, 3.2);
    for (const side of [-1, 1]) {
      const n = Math.floor((half + m - 1) / (FLATCAR.length + 0.6));
      const cars = rng.int(Math.max(0, n - 1), n);
      for (let k = 0; k < cars; k++) {
        const uc = side * (cross / 2 + 1 + (FLATCAR.length + 0.6) * (k + 0.5));
        const fp = fpOf(rect(uc, vr, FLATCAR.length, FLATCAR.width));
        const len = rng.next() < 0.7 ? CONTAINER.l40 : CONTAINER.l20;
        const box = rng.next() < 0.85;
        const p = at(uc, vr);
        const containers: Container[] = box ? [{ ...p, tier: 0, base: FLATCAR.deck, alongX: rowsAlongX, len, color: rng.pick(LINE_COLOURS) }] : [];
        out.stacks.push({ kind: 'flatcar', ...p, yaw: rowsAlongX ? Math.PI / 2 : 0, footprints: [fp], data: { containers } satisfies StackData as unknown as Record<string, unknown> });
        out.solids.push(fp);
      }
    }
  }
  return out;
}

/** The yard's chain-link fence line, in from the block edge (on the yard side of the sidewalk). */
export const FENCE_LINE = 3.3;

/** All the containers in a set of structures (stacks, flatcars, ships…), each structure's own list. */
export const containersOf = (structures: Structure[]) =>
  structures.flatMap((s) => ((s.data as unknown as StackData | undefined)?.containers ?? []));

/** Hold the containers to `max`, taking the top tiers off first (later structures first within a tier), so none floats. */
export function capContainers(structures: Structure[], max: number): void {
  const lists = structures.flatMap((s) => {
    const d = s.data as unknown as StackData | undefined;
    return d?.containers ? [d] : [];
  });
  const all = lists.flatMap((d) => d.containers);
  if (all.length <= max) return;
  const order = all.map((c, i) => ({ c, i })).sort((a, b) => b.c.tier - a.c.tier || b.i - a.i);
  const drop = new Set(order.slice(0, all.length - max).map((e) => e.c));
  for (const d of lists) d.containers = d.containers.filter((c) => !drop.has(c));
}

/**
 * The yard's chain-link fence on the fence line all round, open at every corridor mouth (a boom
 * barrier across each, breakable) and where the rail strip runs out.
 */
export function yardFence(block: Rect, yard: Yard): StreetProp[] {
  const out: StreetProp[] = [];
  const PANEL = 2.9;
  const x0 = block.x - block.w / 2 + FENCE_LINE, x1 = block.x + block.w / 2 - FENCE_LINE;
  const z0 = block.z - block.d / 2 + FENCE_LINE, z1 = block.z + block.d / 2 - FENCE_LINE;
  // Openings: corridor mouths, and the rail strip on the sides along the rows' ends.
  const gaps: { x: number; z: number; alongX: boolean; width: number }[] = [...yard.mouths];
  if (yard.rail) {
    const r = yard.rail;
    for (const end of [-1, 1]) {
      gaps.push(yard.rowsAlongX ? { x: block.x + end * (block.w / 2 - FENCE_LINE), z: r.z, alongX: true, width: r.d + 1 } : { x: r.x, z: block.z + end * (block.d / 2 - FENCE_LINE), alongX: false, width: r.w + 1 });
    }
  }
  // A side runs along X (fixed z) or along Z (fixed x); a gap sits on it when its corridor crosses it.
  const sides = [
    { ax: x0, az: z0, bx: x1, bz: z0 }, { ax: x0, az: z1, bx: x1, bz: z1 },
    { ax: x0, az: z0, bx: x0, bz: z1 }, { ax: x1, az: z0, bx: x1, bz: z1 },
  ];
  for (const sd of sides) {
    const alongX = sd.az === sd.bz;
    const lo = alongX ? sd.ax : sd.az, hi = alongX ? sd.bx : sd.bz, fixed = alongX ? sd.az : sd.ax;
    const here = gaps.filter((g) => g.alongX !== alongX && Math.abs((alongX ? g.z : g.x) - fixed) < 0.5);
    const blocked = here.map((g) => [(alongX ? g.x : g.z) - g.width / 2 - 0.2, (alongX ? g.x : g.z) + g.width / 2 + 0.2]);
    const n = Math.floor((hi - lo) / (PANEL + 0.05));
    for (let k = 0; k < n; k++) {
      const c = lo + (hi - lo) * ((k + 0.5) / n);
      if (blocked.some(([a, b]) => c + PANEL / 2 > a && c - PANEL / 2 < b)) continue;
      out.push({ kind: 'fence', style: 'chainlink', x: alongX ? c : fixed, z: alongX ? fixed : c, yaw: alongX ? 0 : Math.PI / 2 });
    }
  }
  // Boom barriers across the corridor mouths (the arm along local X, across the corridor).
  for (const m of yard.mouths) out.push({ kind: 'boomGate', x: m.x, z: m.z, yaw: m.alongX ? -Math.PI / 2 : 0 });
  return out;
}

/** Drop props that would stand on a footprint or another prop already taken. */
export function clearOf(props: StreetProp[], solids: Footprint[], taken: Footprint[] = []): StreetProp[] {
  const kept: StreetProp[] = [];
  const busy = [...taken];
  for (const p of props) {
    const fp = propFootprint(p, 0.05);
    if (solids.some((s) => footprintsOverlap(fp, s)) || busy.some((s) => footprintsOverlap(fp, s))) continue;
    busy.push(propFootprint(p));
    kept.push(p);
  }
  return kept;
}
