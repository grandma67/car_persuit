// The Swamp's pools: shallow water (`world/Water.ts`, wading, never drowning) over 40–70 % of each
// block inside its sidewalk line, a dry bank kept round the edge and between pools. An ordinary
// block gets one big pool and smaller ones round it until the rolled share is under water; the
// witch house's block gets one big pool (its island comes with the house). Pure data.
import type { Rng } from '../../core/Rng';
import { SWAMP } from '../../gameplay/balance';
import type { Rect } from '../CityGenerator';
import { shrink } from '../lots';
import { inWater, rimPoints, shoreDistance, type ShallowWater } from '../Water';

const RIM = 48; // rim points checked against the bank and the other pools
const STEP = 1.5; // the coverage grid, metres
const SAFE = 0.25; // metres to spare between the rim points

/** A random wobbly pool (before it is fitted). */
function pool(x: number, z: number, rx: number, squash: [number, number], rng: Rng): ShallowWater {
  const rz = rx * rng.range(squash[0], squash[1]);
  return {
    kind: 'pool', x, z, rx, rz, yaw: rng.range(0, Math.PI),
    wobble: [
      [2, rng.range(0.03, 0.08), rng.range(0, Math.PI * 2)],
      [3, rng.range(0.02, 0.05), rng.range(0, Math.PI * 2)],
    ],
    depth: SWAMP.poolDepth,
  };
}

/** Inside `room` and at least `gap` metres from every pool in `others`, both ways. */
function fits(w: ShallowWater, room: Rect, others: ShallowWater[], gap: number): boolean {
  // A little to spare: the rim is checked at RIM points only.
  room = shrink(room, SAFE);
  gap += SAFE;
  for (const p of rimPoints(w, RIM)) {
    if (Math.abs(p.x - room.x) > room.w / 2 || Math.abs(p.z - room.z) > room.d / 2) return false;
    if (others.some((o) => shoreDistance(o, p.x, p.z) > -gap)) return false;
  }
  return others.every((o) => rimPoints(o, RIM).every((p) => shoreDistance(w, p.x, p.z) < -gap));
}

/** Shrink a pool about its centre until it fits (null if it never does). */
function fit(w: ShallowWater, room: Rect, others: ShallowWater[], gap: number, least: number): ShallowWater | null {
  for (let k = 0; k < 16 && Math.min(w.rx, w.rz) >= least; k++) {
    if (fits(w, room, others, gap)) return w;
    w = { ...w, rx: w.rx * 0.92, rz: w.rz * 0.92 };
  }
  return null;
}

/** A pool's area, square metres (the wobble's cosines average out). */
export const poolArea = (w: ShallowWater) => Math.PI * w.rx * w.rz * (1 + w.wobble.reduce((s, [, a]) => s + (a * a) / 2, 0));

/** The share of `inner` under water, on a grid. */
export function coverage(inner: Rect, pools: ShallowWater[]): number {
  let wet = 0, all = 0;
  for (let x = inner.x - inner.w / 2 + STEP / 2; x < inner.x + inner.w / 2; x += STEP) {
    for (let z = inner.z - inner.d / 2 + STEP / 2; z < inner.z + inner.d / 2; z += STEP) {
      all++;
      if (pools.some((w) => inWater(w, x, z))) wet++;
    }
  }
  return all ? wet / all : 0;
}

/** An ordinary block's pools, `cover` of it under water at most (about; the last pool may overshoot a little); the big one under `maxArea`. */
export function layPools(inner: Rect, cover: number, maxArea: number, rng: Rng): ShallowWater[] {
  const room = shrink(inner, SWAMP.bank);
  const out: ShallowWater[] = [];
  // The big pool takes most of the share (sized from it), off the middle where there is room; smaller ones fill in.
  const squash = rng.range(0.7, 0.95);
  const rx = Math.min(SWAMP.bigPool[1], Math.max(SWAMP.bigPool[0], Math.sqrt((Math.min(maxArea, cover * inner.w * inner.d * rng.range(0.75, 0.9))) / (Math.PI * squash))));
  const slack = Math.max(0, room.w / 2 - rx * 1.08);
  const first = pool(room.x + rng.range(-slack, slack), room.z + rng.range(-slack, slack), rx, [squash, squash], rng);
  const big = fit(first, room, out, SWAMP.poolGap, SWAMP.smallPool[0]);
  if (big) out.push(big);
  let share = coverage(inner, out);
  for (let tries = 0; tries < 60 && share < cover; tries++) {
    const x = room.x + rng.range(-room.w / 2, room.w / 2), z = room.z + rng.range(-room.d / 2, room.d / 2);
    if (out.some((o) => inWater(o, x, z, -SWAMP.poolGap - 2))) continue;
    const w = fit(pool(x, z, rng.range(SWAMP.smallPool[0], SWAMP.smallPool[1]), [0.6, 1], rng), room, out, SWAMP.poolGap, 3);
    if (!w) continue;
    out.push(w);
    share = coverage(inner, out);
  }
  return out;
}

/** The witch house's block: one big pool, a little off the middle (the house's island goes in it). */
export function layWitchPool(inner: Rect, rng: Rng): ShallowWater {
  const room = shrink(inner, SWAMP.bank);
  const w = pool(room.x + rng.range(-1.5, 1.5), room.z + rng.range(-1.5, 1.5), rng.range(SWAMP.witchPool[0], SWAMP.witchPool[1]), [0.85, 0.95], rng);
  return fit(w, room, [], 0, 1)!;
}
