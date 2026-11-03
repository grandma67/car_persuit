// The Mega-park's lake block: a big shallow lake (wading, never drowning) filling the block but
// for a bank, the boathouse on one side with its jetty out over the water and rowboats moored
// alongside, an island with a little domed folly reached by a footbridge from the bank, sometimes
// a fountain jet. Reeds, lily pads and benches facing the water. Pure data.
import type { Rng } from '../../core/Rng';
import { MEGAPARK } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import type { LilyPad, ParkPiece } from '../ParkPieces';
import type { Footprint, StreetProp } from '../StreetProps';
import { inWater, rimAt, shoreDistance, type ShallowWater } from '../Water';
import type { Structure } from './District';

/** What the renderer needs for each lake piece. */
export interface LakeData {
  water: ShallowWater;
  fountain?: { x: number; z: number };
}

export interface LakeLayout {
  water: ShallowWater;
  piece: ParkPiece; // the stone rim and lily pads (drawn with the park pieces)
  structures: Structure[]; // island, footbridge, jetty, rowboats
  solids: Footprint[];
  props: StreetProp[]; // reeds, benches, the sign
  fountain?: { x: number; z: number };
}

/** A box footprint from a to b (a centre line), `half` wide each side. */
export function spanFootprint(ax: number, az: number, bx: number, bz: number, half: number): Footprint {
  const len = Math.hypot(bx - ax, bz - az);
  // Footprint yaw turns local X; local Z runs along (sin yaw, cos yaw).
  return { x: (ax + bx) / 2, z: (az + bz) / 2, hx: half, hz: len / 2, yaw: Math.atan2(bx - ax, bz - az) };
}

/** Where a ray from (x, z) along (dx, dz) leaves the water, metres along it. */
function shoreAlong(w: ShallowWater, x: number, z: number, dx: number, dz: number): number {
  let t = 0;
  while (t < 80 && shoreDistance(w, x + dx * t, z + dz * t) > 0) t += 0.1;
  return t;
}

/**
 * Lay the lake in `inner` (the block inside the sidewalk line), the boathouse `house` on its side
 * whose outward normal is (nx, nz). `fountain`: the jet is in.
 */
export function layLake(inner: Rect, house: Building, k: number, n: number, fountain: boolean, rng: Rng): LakeLayout {
  const half = inner.w / 2;
  const nx = Math.sign(house.x - inner.x) * (Math.abs(house.x - inner.x) > Math.abs(house.z - inner.z) ? 1 : 0);
  const nz = nx ? 0 : Math.sign(house.z - inner.z);
  const face = nx ? Math.abs(house.x - inner.x) - house.w / 2 : Math.abs(house.z - inner.z) - house.d / 2; // the boathouse's lakeside wall, from the middle
  const bank = MEGAPARK.lakeBank;
  // The long axis points at the boathouse; the near rim a bank's width short of it, the far one inside.
  const yaw = Math.atan2(-nz, nx); // local +X along (nx, nz)
  const wobble: [number, number, number][] = [
    [2, rng.range(0.03, 0.06), rng.range(0, Math.PI * 2)],
    [3, rng.range(0.02, 0.04), rng.range(0, Math.PI * 2)],
  ];
  let rx = rng.range(MEGAPARK.lakeRadius[0], MEGAPARK.lakeRadius[1]);
  let rz = rx * rng.range(0.8, 0.92);
  // How far the rim reaches towards the boathouse, away from it and across, per unit radius.
  const unit: ShallowWater = { kind: 'lake', x: 0, z: 0, rx: 1, rz: 1, yaw: 0, wobble, depth: 0 };
  let near = 0, far = 0, across = 0;
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2, r = rimAt(unit, t);
    near = Math.max(near, r * Math.cos(t));
    far = Math.max(far, -r * Math.cos(t));
    across = Math.max(across, r * Math.abs(Math.sin(t)));
  }
  // Shrink it until it fits: centre c (along the normal) puts the near rim at face - bank.
  rx = Math.min(rx, (face - bank + half - bank) / (near + far));
  rz = Math.min(rz, rx * 0.95, (half - bank) / across);
  const c = face - bank - rx * near;
  const water: ShallowWater = { kind: 'lake', x: inner.x + nx * c, z: inner.z + nz * c, rx, rz, yaw, wobble, depth: MEGAPARK.lakeDepth };
  // Across the normal (a unit vector), for the bridge and the boats.
  const tx = -nz, tz = nx;

  const structures: Structure[] = [];
  const solids: Footprint[] = [];
  // The jetty from the boathouse's middle straight out.
  const [jw, jl] = MEGAPARK.jetty;
  const fx = inner.x + nx * face, fz = inner.z + nz * face; // its foot, at the wall (house.x/z along the side)
  const jx0 = nx ? fx : house.x, jz0 = nz ? fz : house.z;
  const jx1 = jx0 - nx * jl, jz1 = jz0 - nz * jl;
  const jetty = spanFootprint(jx0, jz0, jx1, jz1, jw / 2);
  structures.push({ kind: 'jetty', x: jetty.x, z: jetty.z, yaw: jetty.yaw, footprints: [jetty], data: { length: jl, width: jw, height: MEGAPARK.jettyHeight } });
  solids.push(jetty);
  // Rowboats moored either side of the jetty's outer half, bows out.
  for (let b = 0; b < MEGAPARK.rowboats; b++) {
    const side = b % 2 ? 1 : -1;
    const along = jl * (0.62 + 0.2 * (b >> 1)) + rng.range(-0.3, 0.3);
    const x = jx0 - nx * along + tx * side * (jw / 2 + 1.05), z = jz0 - nz * along + tz * side * (jw / 2 + 1.05);
    if (!inWater(water, x, z, 1)) continue;
    const boat: Footprint = { x, z, hx: 0.7, hz: 1.75, yaw: Math.atan2(-nx, -nz) + rng.range(-0.12, 0.12) };
    structures.push({ kind: 'moored', x, z, yaw: boat.yaw, footprints: [boat] });
    solids.push(boat);
  }
  // The island: off the middle towards the far side, the bridge to the bank on one side.
  const R = MEGAPARK.island;
  const side = rng.next() < 0.5 ? -1 : 1;
  let ix = water.x - nx * rx * 0.28 - tx * side * rx * 0.12, iz = water.z - nz * rx * 0.28 - tz * side * rx * 0.12;
  for (let tries = 0; tries < 10 && shoreDistance(water, ix, iz) < R + 4; tries++) {
    ix += (water.x - ix) * 0.3;
    iz += (water.z - iz) * 0.3;
  }
  // Octagon: two squares, one turned 45°.
  const flat = R * Math.cos(Math.PI / 8);
  const island: Footprint[] = [{ x: ix, z: iz, hx: flat, hz: flat, yaw: 0 }, { x: ix, z: iz, hx: flat, hz: flat, yaw: Math.PI / 4 }];
  structures.push({ kind: 'island', x: ix, z: iz, yaw: rng.range(0, Math.PI * 2), footprints: island, data: { radius: R } });
  solids.push(...island);
  const toShore = shoreAlong(water, ix, iz, tx * side, tz * side);
  const b0 = R - 0.4, b1 = toShore + 1.6;
  const bridge = spanFootprint(ix + tx * side * b0, iz + tz * side * b0, ix + tx * side * b1, iz + tz * side * b1, MEGAPARK.bridgeWidth / 2);
  structures.push({ kind: 'footbridge', x: bridge.x, z: bridge.z, yaw: bridge.yaw, footprints: [bridge], data: { length: b1 - b0, width: MEGAPARK.bridgeWidth } });
  solids.push(bridge);
  // The fountain jet between the island and the jetty's end, off the bridge's side.
  const jet = fountain
    ? { x: (ix + jx1) / 2 - tx * side * 3, z: (iz + jz1) / 2 - tz * side * 3 }
    : undefined;

  // Reed clumps round the rim, clear of the boathouse's side and the bridge; benches on the bank facing the water.
  const props: StreetProp[] = [];
  const rim = (theta: number, out: number) => {
    // A point `out` metres beyond the rim at local angle theta (radially), and the heading to the water.
    const r = rimAt(water, theta);
    const c0 = Math.cos(water.yaw), s0 = Math.sin(water.yaw);
    const u = Math.cos(theta) * r * water.rx, v = Math.sin(theta) * r * water.rz;
    const x = water.x + u * c0 + v * s0, z = water.z - u * s0 + v * c0;
    const dx = x - water.x, dz = z - water.z, l = Math.hypot(dx, dz);
    return { x: x + (dx / l) * out, z: z + (dz / l) * out, facing: Math.atan2(-dx, -dz) };
  };
  // Local angle 0 points at the boathouse; the bridge leaves at ±π/2 (side).
  const bridgeAt = (side * Math.PI) / 2; // local +v runs along (tx, tz)
  const clear = (theta: number) => Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) > 0.75 && Math.abs(Math.atan2(Math.sin(theta - bridgeAt), Math.cos(theta - bridgeAt))) > 0.5;
  for (let c = rng.int(3, 5); c > 0; c--) {
    const theta = rng.range(0, Math.PI * 2);
    if (!clear(theta)) continue;
    for (let r = 0; r < 3; r++) {
      const p = rim(theta + r * 0.07, rng.range(-0.5, 0.3));
      props.push({ kind: 'reeds', x: p.x, z: p.z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.2) });
    }
  }
  // Benches where the bank is wide: across from the bridge, and the far end.
  for (const theta of [-bridgeAt - 0.45, -bridgeAt + 0.45, Math.PI - bridgeAt * 0.35]) {
    const p = rim(theta + rng.range(-0.1, 0.1), 1.6);
    if (Math.abs(p.x - inner.x) > half - 1.2 || Math.abs(p.z - inner.z) > half - 1.2) continue;
    props.push({ kind: 'bench', x: p.x, z: p.z, yaw: p.facing });
  }
  const sign = rim(Math.PI * 0.5 * -side + Math.PI * 0.25, 2.4);
  if (Math.abs(sign.x - inner.x) < half - 1 && Math.abs(sign.z - inner.z) < half - 1) props.push({ kind: 'sign', variant: 'noFishing', x: sign.x, z: sign.z, yaw: sign.facing + Math.PI });

  // Lily pads in the calm water, clear of the island, jetty, boats and the jet.
  const pads: LilyPad[] = [];
  for (let tries = 0; tries < 120 && pads.length < 18; tries++) {
    const x = water.x + rng.range(-rx, rx), z = water.z + rng.range(-rx, rx);
    const r = rng.range(0.35, 0.75);
    if (shoreDistance(water, x, z) < 1.2 + r) continue;
    if (Math.hypot(x - ix, z - iz) < R + 1.5 + r || (jet && Math.hypot(x - jet.x, z - jet.z) < 3)) continue;
    if (solids.some((f) => Math.abs((x - f.x) * Math.cos(f.yaw) - (z - f.z) * Math.sin(f.yaw)) < f.hx + 1 + r && Math.abs((x - f.x) * Math.sin(f.yaw) + (z - f.z) * Math.cos(f.yaw)) < f.hz + 1 + r)) continue;
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.15)) continue;
    pads.push({ x, z, r, yaw: rng.range(0, Math.PI * 2) });
  }
  const piece: ParkPiece = { kind: 'pond', district: 'megapark', block: [k % n, Math.floor(k / n)], x: water.x, z: water.z, yaw: water.yaw, water, pads, stoneRim: true };
  return { water, piece, structures, solids, props, fountain: jet };
}

/** The lake's block in a dressed Mega-park, as the city's water knows it. */
export const lakeOf = (city: CityData): ShallowWater[] => city.water.filter((w) => w.kind === 'lake');
