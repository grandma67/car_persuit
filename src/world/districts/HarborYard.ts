// The Harbor's container yard: rows of stacked containers on a quay-row block, with corridors
// between them running straight from one street to the street opposite, and one across the rows
// through the middle. Each half row is one solid; the corridors are drivable. Pure data; drawn by
// render/districts/Harbor.ts.
import type { Rng } from '../../core/Rng';
import { CONTAINER, HARBOR } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import type { Footprint } from '../StreetProps';
import type { Structure } from './District';

/** One container: its centre on the ground plan, its tier (0 on the ground) and length. */
export interface Container {
  x: number;
  z: number;
  tier: number;
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
  stacks: Structure[];
  solids: Footprint[];
  corridors: Rect[]; // drivable, block edge to block edge (sidewalks included)
  rowsAlongX: boolean;
}

/**
 * Lay out a yard block. `rowsAlongX`: the rows (and the corridors between them) run along X,
 * opening onto the streets on the block's ±X sides; the cross corridor runs along Z.
 */
export function yardLayout(block: Rect, city: CityData, rowsAlongX: boolean, rng: Rng): Yard {
  const s = city.config.sidewalk;
  const m = HARBOR.stackMargin;
  const L = (rowsAlongX ? block.w : block.d) - s * 2; // along the rows
  const D = (rowsAlongX ? block.d : block.w) - s * 2; // across them
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
  // Local (u along the rows, v across) to world.
  const at = (u: number, v: number) => (rowsAlongX ? { x: block.x + u, z: block.z + v } : { x: block.x + v, z: block.z + u });
  const stacks: Structure[] = [];
  const solids: Footprint[] = [];
  const corridors: Rect[] = [];
  let v = -D / 2 + m;
  wides.forEach((wide, r) => {
    const depth = depths[r];
    const vc = v + depth / 2;
    for (const side of [-1, 1]) {
      const uc = side * (cross / 2 + half / 2);
      // Container slots along the half row: mostly forties, a twenty where one fits, centred.
      const lens: number[] = [];
      let used = 0;
      for (;;) {
        const want = rng.next() < 0.65 ? CONTAINER.l40 : CONTAINER.l20;
        const len = used + want <= half ? want : used + CONTAINER.l20 <= half ? CONTAINER.l20 : 0;
        if (!len) break;
        lens.push(len);
        used += len + CONTAINER.gap;
      }
      used -= CONTAINER.gap;
      const containers: Container[] = [];
      let u = uc - used / 2;
      for (const len of lens) {
        for (let k = 0; k < wide; k++) {
          const high = rng.int(HARBOR.stackHigh[0], HARBOR.stackHigh[1]);
          const p = at(u + len / 2, vc - depth / 2 + W * (k + 0.5));
          for (let tier = 0; tier < high; tier++) containers.push({ ...p, tier, alongX: rowsAlongX, len, color: rng.pick(LINE_COLOURS) });
        }
        u += len + CONTAINER.gap;
      }
      const c = at(uc, vc);
      const fp: Footprint = rowsAlongX ? { ...c, hx: used / 2, hz: depth / 2, yaw: 0 } : { ...c, hx: depth / 2, hz: used / 2, yaw: 0 };
      solids.push(fp);
      stacks.push({ kind: 'stack', x: c.x, z: c.z, yaw: 0, footprints: [fp], data: { containers } satisfies StackData as unknown as Record<string, unknown> });
    }
    v += depth;
    if (r < wides.length - 1) {
      // The corridor after this row, from block edge to block edge.
      const c = at(0, v + corridor / 2);
      corridors.push(rowsAlongX ? { ...c, w: block.w, d: corridor } : { ...c, w: corridor, d: block.d });
      v += corridor;
    }
  });
  // Across the rows, through the middle.
  corridors.push(rowsAlongX ? { x: block.x, z: block.z, w: cross, d: block.d } : { x: block.x, z: block.z, w: block.w, d: cross });
  return { stacks, solids, corridors, rowsAlongX };
}

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
