// The Forest's set pieces as vertex-coloured parts for one merged mesh (the district structures'
// settings): log stacks, the log truck and loader (merged bodies, never buildCarMesh), the fire
// lookout tower, the fire pit and timber gate posts. Each is laid in its structure's frame
// (local +Z its front) on the ground at its middle.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FOREST } from '../../gameplay/balance';
import { Rng } from '../../core/Rng';
import type { Structure } from '../../world/districts/District';
import { part } from '../geometry';

const LOG = 0x7a5a3a;
const LOG_DARK = 0x5a4028;
const BARK = 0x5e4630;
const CUT = 0xc8a878; // a log's sawn end
const TIMBER = 0x8a6a48;
const STEEL = 0x3a3e42;
const RUBBER = 0x1e1e20;
const GLASS = 0x2a3a44;
const SNOW = 0xeef2f6;
const CAB = [0xb83a2a, 0x2a5a8a, 0xd8a028]; // truck and loader paint

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
export const frameOf = (x: number, y: number, z: number, yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
const place = (parts: THREE.BufferGeometry[], m: THREE.Matrix4, out: THREE.BufferGeometry[]) => out.push(...parts.map((p) => p.applyMatrix4(m)));

/**
 * A log lying along local X, `len` long, radius r, centred at (x, y, z): one capped 7-sided
 * cylinder, bark round the side and sawn ends (28 tris; separate end discs were 84).
 */
function log(len: number, r: number, x: number, y: number, z: number, bark = BARK): THREE.BufferGeometry[] {
  const geo = part(cyl(r, r, len, 7), bark);
  const side = geo.groups[0].count; // the side's vertices come first, the caps' after
  const cut = new THREE.Color(CUT);
  const colors = geo.attributes.color.array as Float32Array;
  for (let i = side; i < geo.attributes.position.count; i++) colors.set([cut.r, cut.g, cut.b], i * 3);
  return [geo.rotateZ(Math.PI / 2).translate(x, y, z)];
}

/** A stack of logs along local X filling its footprint, layer on layer to its height, a little ragged. */
export function logStack(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const f = s.footprints[0];
  const h = (s.data?.h as number) ?? 2;
  const rng = new Rng((s.data?.seed as number) ?? 1);
  const g: THREE.BufferGeometry[] = [];
  const r = 0.3;
  const across = Math.floor((f.hz * 2) / (r * 2));
  const layers = Math.max(1, Math.floor(h / (r * 1.75)));
  for (let l = 0; l < layers; l++) {
    const n = across - (l % 2); // nested in the hollows of the layer under
    for (let i = 0; i < n; i++) {
      const z = -f.hz + r + (l % 2) * r + i * r * 2;
      const len = f.hx * 2 - rng.range(0, 0.6);
      g.push(...log(len, r * rng.range(0.85, 1), rng.range(-0.15, 0.15), r + l * r * 1.75, z));
    }
  }
  // Snow on the top layer: short of the shortest log's ends and from the first log's axis to the
  // last's, so none of its sides lands in a log's end or flank (z-fighting).
  if (snowy) {
    const top = layers - 1, n = across - (top % 2);
    const z0 = -f.hz + r + (top % 2) * r, z1 = z0 + (n - 1) * r * 2;
    g.push(part(box(f.hx * 2 - 1.0, 0.08, Math.max(0.2, z1 - z0)), SNOW, 0, r + top * r * 1.75 + r * 0.95, (z0 + z1) / 2));
  }
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** Four wheels for a body `len` long along local X, `half` wide. */
function wheels(xs: number[], half: number, r: number): THREE.BufferGeometry[] {
  return xs.flatMap((x) => [-1, 1].map((e) => part(cyl(r, r, 0.4, 8).rotateX(Math.PI / 2), RUBBER, x, r, e * half)));
}

/** A log truck along local X: the cab at +X, a flatbed with stakes and a load of long logs. */
export function logTruck(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const paint = CAB[Math.abs(Math.round(s.x + s.z)) % CAB.length];
  const g: THREE.BufferGeometry[] = [
    part(box(10, 0.35, 1.9), STEEL, 0, 0.95, 0), // chassis
    part(box(2.2, 1.6, 2.3), paint, 3.9, 1.95, 0), // cab
    part(box(1.4, 0.9, 2.3), paint, 5.35, 1.55, 0), // bonnet
    part(box(0.05, 0.7, 1.9), GLASS, 5.02, 2.35, 0), // windscreen
    part(box(0.05, 0.6, 2.32), GLASS, 3.9, 2.4, 0), // side windows
    part(box(0.12, 1.6, 0.12), STEEL, 4.6, 2.9, 0.95), // exhaust stack
    part(box(0.3, 0.5, 2.36), STEEL, 6.1, 1.0, 0), // bumper
    part(box(6.8, 0.15, 2.4), STEEL, -1.2, 1.2, 0), // bed
    ...wheels([5.0, 1.5, -0.3, -3.6, -4.6], 1.05, 0.5),
  ];
  // Stakes either side, and the load: three layers of logs.
  for (const x of [-4.2, -1.8, 0.6, 2.4]) for (const e of [-1, 1]) g.push(part(box(0.12, 1.8, 0.12), STEEL, x, 2.1, e * 1.15));
  for (let l = 0; l < 3; l++) for (let i = 0; i < 4 - l; i++) g.push(...log(7.6, 0.27, -1, 1.55 + l * 0.46, -0.81 + l * 0.27 + i * 0.54));
  if (snowy) g.push(part(box(2.1, 0.06, 2.2), SNOW, 3.9, 2.78, 0));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** A tracked log loader: an undercarriage, a turning cab and a boom with a grapple holding a log. */
export function logLoader(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const paint = CAB[(Math.abs(Math.round(s.x * 3 + s.z)) + 2) % CAB.length];
  const g: THREE.BufferGeometry[] = [
    part(box(3.6, 0.8, 0.7), RUBBER, 0, 0.4, 1.05), // tracks
    part(box(3.6, 0.8, 0.7), RUBBER, 0, 0.4, -1.05),
    part(box(2.6, 0.5, 1.6), STEEL, 0, 0.75, 0),
    part(cyl(1.0, 1.0, 0.3, 12), STEEL, 0, 1.15, 0), // the turntable
    part(box(2.6, 1.2, 2.2), paint, -0.4, 1.9, 0), // body
    part(box(1.2, 1.4, 1.1), paint, 0.6, 2.9, 0.5), // cab
    part(box(1.22, 0.7, 1.12), GLASS, 0.6, 3.15, 0.5),
    part(box(0.8, 1.0, 2.24), STEEL, -1.75, 1.9, 0), // counterweight, 2 cm proud of the body's sides
  ];
  // The boom up and out over +X, the stick down to the grapple, a log in its claws.
  g.push(part(box(4.2, 0.4, 0.4).rotateZ(0.55), paint, 1.6, 3.6, -0.4));
  g.push(part(box(0.35, 2.6, 0.35), paint, 3.4, 3.4, -0.4));
  g.push(part(box(0.8, 0.3, 0.6), STEEL, 3.4, 2.05, -0.4));
  g.push(...log(4.6, 0.3, 3.4, 1.6, -0.4, LOG));
  if (snowy) g.push(part(box(2.6, 0.06, 2.2), SNOW, -0.4, 2.53, 0));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/**
 * The fire lookout: four timber legs splayed in from the footprint's corners to a cabin at `cabin`
 * metres, cross-braced, a ladder up one side; the cabin glazed all round under a hipped roof, a
 * catwalk with a rail. Returns where its windows are (they light at night).
 */
export function lookout(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): THREE.Vector3[] {
  const L = FOREST.lookout;
  const H = (s.data?.cabin as number) ?? L.cabin;
  const top = 2.0; // the legs' half spread at the top
  const g: THREE.BufferGeometry[] = [];
  const leg = (a: number, b: number) => {
    // From (a·legs, 0, b·legs) to (a·top, H, b·top).
    const x0 = a * L.legs, z0 = b * L.legs, x1 = a * top, z1 = b * top;
    const len = Math.hypot(x1 - x0, H, z1 - z0);
    const geo = box(0.32, len, 0.32);
    const dir = new THREE.Vector3(x1 - x0, H, z1 - z0).normalize();
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    return part(geo, TIMBER, (x0 + x1) / 2, H / 2, (z0 + z1) / 2);
  };
  for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) g.push(leg(a, b));
  // Cross braces: rings of beams every few metres, X braces on two faces.
  for (let k = 1; k <= 3; k++) {
    const h = (H * k) / 4, w = L.legs + (top - L.legs) * (k / 4);
    for (const e of [-1, 1]) {
      g.push(part(box(w * 2, 0.16, 0.16), LOG_DARK, 0, h, e * w));
      g.push(part(box(0.16, 0.16, w * 2), LOG_DARK, e * w, h, 0));
    }
  }
  for (const e of [-1, 1]) {
    const w = (L.legs + top) / 2, len = Math.hypot(w * 2, H / 2);
    g.push(part(box(len, 0.12, 0.12).rotateZ(Math.atan2(H / 2, w * 2) * e), LOG_DARK, 0, H * 0.25, e * w * 1.02));
    g.push(part(box(len, 0.12, 0.12).rotateZ(-Math.atan2(H / 2, w * 2) * e), LOG_DARK, 0, H * 0.75, e * ((L.legs * 0.25 + top * 0.75)) * 1.02));
  }
  // The ladder up the front face (+Z), from the ground to the catwalk.
  for (const e of [-1, 1]) g.push(part(box(0.08, H, 0.08), STEEL, e * 0.3, H / 2, L.legs + 0.25));
  for (let r = 0.4; r < H; r += 0.6) g.push(part(box(0.6, 0.05, 0.05), STEEL, 0, r, L.legs + 0.25));
  // The catwalk, its rail, the cabin and its roof.
  g.push(part(box(5.2, 0.2, 5.2), TIMBER, 0, H, 0));
  for (const e of [-1, 1]) {
    g.push(part(box(5.2, 0.08, 0.08), TIMBER, 0, H + 1.0, e * 2.55), part(box(0.08, 0.08, 5.2), TIMBER, e * 2.55, H + 1.0, 0));
    for (const u of [-2.55, 0, 2.55]) g.push(part(box(0.08, 1.0, 0.08), TIMBER, u, H + 0.5, e * 2.55), part(box(0.08, 1.0, 0.08), TIMBER, e * 2.55, H + 0.5, u));
  }
  const C = 3.6, ch = 2.5;
  g.push(part(box(C, 1.0, C), 0x6a7a5a, 0, H + 0.6, 0)); // the walls under the windows
  g.push(part(box(C + 0.04, ch - 1.15, C + 0.04), GLASS, 0, H + 1.1 + (ch - 1.15) / 2, 0));
  for (const [u, v] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) g.push(part(box(0.14, ch - 1.0, 0.14), 0x6a7a5a, (u * C) / 2, H + 1.1 + (ch - 1.0) / 2 - 0.05, (v * C) / 2));
  const roof = cyl(0, (C / 2 + 0.6) * Math.SQRT2, 1.3, 4).rotateY(Math.PI / 4);
  g.push(part(roof, snowy ? SNOW : 0x4a3a2e, 0, H + ch + 0.75, 0));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
  // The windows' glow: one pane each side, mid-glass.
  const m = frameOf(s.x, y, s.z, s.yaw);
  return [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([u, v]) => new THREE.Vector3((u * (C / 2 + 0.03)), H + 1.1 + (ch - 1.15) / 2, (v * (C / 2 + 0.03))).applyMatrix4(m));
}

/** The fire pit: a ring of stones, a cone of logs inside (the flame is a glow), seat logs round it. Returns the flame's spot. */
export function firePit(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): THREE.Vector3 {
  const R = FOREST.camp.pit;
  const g: THREE.BufferGeometry[] = [];
  const rng = new Rng(Math.abs(Math.round(s.x * 31 + s.z * 17)) + 1);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    g.push(part(new THREE.IcosahedronGeometry(rng.range(0.16, 0.22), 0), 0x8a8580, Math.sin(a) * (R - 0.15), 0.12, Math.cos(a) * (R - 0.15)));
  }
  g.push(part(cyl(R - 0.3, R - 0.3, 0.04, 10), snowy ? 0x3a3430 : 0x2a2420, 0, 0.03, 0)); // ash
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const stick = box(0.1, 0.9, 0.1).rotateX(0.5).rotateY(a);
    g.push(part(stick, LOG_DARK, Math.sin(a) * 0.18, 0.38, Math.cos(a) * 0.18));
  }
  // Two seat logs, a little way off.
  for (const a of [0.9, -1.4]) g.push(...log(1.8, 0.22, 0, 0.22, 0).map((p) => p.rotateY(a).translate(Math.sin(a + Math.PI / 2) * 2.1, 0, Math.cos(a + Math.PI / 2) * 2.1)));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
  return new THREE.Vector3(s.x, y + 0.45, s.z);
}

/** Two plain timber posts beside a gate, a little taller than a car. */
export function gatePosts(s: Structure, ground: (x: number, z: number) => number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  for (const f of s.footprints) {
    const y = ground(f.x, f.z) - 0.05;
    const g = [part(cyl(f.hx, f.hx + 0.04, 2.6, 8), LOG, 0, 1.3, 0), part(cyl(f.hx - 0.02, f.hx - 0.02, 0.04, 8), snowy ? SNOW : CUT, 0, 2.62, 0)];
    place(g, frameOf(f.x, y, f.z, f.yaw), out);
  }
}

/**
 * The fallen log prop (`log`) at scale 1: 5 m along local X lying on the ground, moss along its
 * top (snow in the snow), a stub of a branch. The prop's instance scale sets its length.
 */
export function fallenLogModel(snowy: boolean): THREE.BufferGeometry {
  const len = 5, r = 0.32;
  return mergeGeometries([
    ...log(len, r, 0, r, 0),
    part(box(len * 0.7, 0.05, r * 0.9), snowy ? SNOW : 0x4a6a2a, 0.1, r * 1.97, 0), // moss (snow) along the top
    part(cyl(0.06, 0.09, 0.4, 5).rotateZ(-0.9), BARK, len * 0.15, r * 1.6, r * 0.45), // a branch stub, short: it sinks into the ground as the log rolls
  ]);
}

/** A mossy boulder: a squashed, roughly faceted stone. */
export function boulder(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const r = (s.data?.r as number) ?? 1;
  const rng = new Rng((s.data?.seed as number) ?? 1);
  const stone = new THREE.DodecahedronGeometry(1, 0).scale(r, r * rng.range(0.55, 0.75), r * 0.8);
  const g = [part(stone, 0x8a8680, 0, r * 0.35, 0), part(new THREE.DodecahedronGeometry(1, 0).scale(r * 0.85, 0.12, r * 0.65), snowy ? SNOW : 0x5a7a3a, 0, r * 0.35 + r * 0.6 * 0.9, 0)];
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** A sawn stump, a prop (PROP_SPECS.stump): a short trunk with a pale cut top. */
export function stumpModel(snowy: boolean): THREE.BufferGeometry {
  const r = 0.32, h = 0.5;
  return mergeGeometries([part(cyl(r, r * 1.19, h, 8), BARK, 0, h / 2, 0), part(cyl(r * 0.92, r * 0.92, 0.03, 8), snowy ? SNOW : CUT, 0, h + 0.005, 0)]);
}
