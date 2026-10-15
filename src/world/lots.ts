// Filling a block with buildings: lot layout per style (a zone's, or a district's). Pure data.
import type { Rng } from '../core/Rng';
import type { Block, Building, Zone, Rect } from './CityGenerator';

/** How a block is cut into lots and built on. */
export interface LotStyle {
  lots: [number, number]; // lots per side
  height: [number, number]; // metres
  gap: [number, number]; // inset from the lot edge, metres
  empty: number; // chance a lot stays empty
  /** Taller towards the very centre of the city (downtown). */
  centreBoost?: boolean;
  /** Empty lots get a few trees (front gardens). */
  emptyTrees?: boolean;
}

// Lot layout and height ranges per zone.
export const ZONE_STYLE: Record<Zone, LotStyle> = {
  downtown: { lots: [1, 2], height: [35, 95], gap: [1, 3], empty: 0, centreBoost: true },
  midtown: { lots: [2, 3], height: [12, 34], gap: [1, 2.5], empty: 0.08 },
  residential: { lots: [3, 4], height: [5, 11], gap: [2.5, 4], empty: 0.12, emptyTrees: true },
  industrial: { lots: [1, 2], height: [7, 14], gap: [2, 4], empty: 0.1 },
};

export function fillBlock(
  block: Block, sidewalk: number, rng: Rng, out: Building[], trees: { x: number; z: number }[],
  style: LotStyle = ZONE_STYLE[block.zone],
): void {
  const inner = shrink(block.rect, sidewalk);
  const nx = rng.int(style.lots[0], style.lots[1]);
  const nz = rng.int(style.lots[0], style.lots[1]);
  const xs = splitPoints(inner.x - inner.w / 2, inner.w, nx, rng);
  const zs = splitPoints(inner.z - inner.d / 2, inner.d, nz, rng);
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const lot = { x: (xs[a] + xs[a + 1]) / 2, z: (zs[b] + zs[b + 1]) / 2, w: xs[a + 1] - xs[a], d: zs[b + 1] - zs[b] };
      if (rng.next() < style.empty) {
        if (style.emptyTrees) scatterTrees(lot, 2, rng.int(1, 3), rng, trees);
        continue;
      }
      const gap = rng.range(style.gap[0], style.gap[1]);
      const fp = shrink(lot, gap);
      if (fp.w < 4 || fp.d < 4) continue;
      // Taller towards the very centre of downtown.
      let h = rng.range(style.height[0], style.height[1]);
      if (style.centreBoost) h *= 1.25 - Math.min(Math.hypot(lot.x, lot.z) / 250, 0.5);
      out.push({ ...fp, h: Math.round(h * 10) / 10, zone: block.zone, variant: rng.next() });
    }
  }
}

export function scatterTrees(area: Rect, margin: number, count: number, rng: Rng, out: { x: number; z: number }[]): void {
  const r = shrink(area, margin);
  if (r.w <= 0 || r.d <= 0) return;
  const placed: { x: number; z: number }[] = [];
  for (let attempt = 0; attempt < count * 6 && placed.length < count; attempt++) {
    const p = { x: r.x + (rng.next() - 0.5) * r.w, z: r.z + (rng.next() - 0.5) * r.d };
    if (placed.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 5)) placed.push(p);
  }
  out.push(...placed);
}

/** Split [start, start+length] into `parts` with jittered boundaries. */
function splitPoints(start: number, length: number, parts: number, rng: Rng): number[] {
  const pts = [start];
  for (let k = 1; k < parts; k++) pts.push(start + (length * (k + (rng.next() - 0.5) * 0.4)) / parts);
  pts.push(start + length);
  return pts;
}

export function shrink(r: Rect, m: number): Rect {
  return { x: r.x, z: r.z, w: r.w - m * 2, d: r.d - m * 2 };
}

/** Is a point inside a rectangle (edges included, with an optional margin)? */
export function inRect(r: Rect, p: { x: number; z: number }, margin = 0): boolean {
  return Math.abs(p.x - r.x) <= r.w / 2 + margin && Math.abs(p.z - r.z) <= r.d / 2 + margin;
}
