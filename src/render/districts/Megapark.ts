// The Mega-park: the lake's island and its folly, the footbridge, the jetty, the moored rowboats and
// the fountain jet. Solid pieces merge into one vertex-coloured mesh with the district structures'
// settings; the jet is its own mesh with the same settings, swelling in the frame loop. The water
// is ShallowWaterView, the stone rim and lily pads the park pieces' mesh, the boathouse a lot. No
// new shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MEGAPARK } from '../../gameplay/balance';
import type { CityData, Rect } from '../../world/CityGenerator';
import { GeometryBuilder } from '../../world/CityBuilder';
import { inRect, shrink } from '../../world/lots';
import { groundHeight, type Terrain } from '../../world/Terrain';
import type { District, GroundPatch, Structure } from '../../world/districts/District';
import { drapePolyline, part, upTri } from '../geometry';
import { rowboat } from '../Landmarks';
import type { ParkPath } from '../../world/districts/MegaparkLawns';
import { LIT_PROPS } from '../../world/StreetProps';
import type { DistrictRenderContext, DistrictView } from './index';
import { fireflies } from './fireflies';
import { parkNamePlate, parkSignMaterial } from './megaparkSigns';

const STONE = 0x9a948a;
const STONE_DARK = 0x7a756c;
const GRASS = 0x5f8f48;
const WHITE = 0xeeeae2;
const PLANK = 0x8a6a48;
const PLANK_DARK = 0x6a5038;
const ROOF = 0x5f8f7a; // green copper, as the café
const SNOW = 0xeef2f6;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const frameOf = (x: number, y: number, z: number, yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
const place = (parts: THREE.BufferGeometry[], m: THREE.Matrix4, out: THREE.BufferGeometry[]) => out.push(...parts.map((p) => p.applyMatrix4(m)));

/** The island: a rough stone rim round a grassy mound, and a little domed folly on six columns. */
function island(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const R = (s.data?.radius as number) ?? MEGAPARK.island;
  const g: THREE.BufferGeometry[] = [
    part(cyl(R, R + 0.3, 1.0, 10), STONE_DARK, 0, 0.5),
    part(cyl(R - 0.15, R, 0.12, 10), snowy ? SNOW : GRASS, 0, 1.06),
  ];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const size = 0.45 + 0.2 * Math.abs(Math.sin(k * 2.7));
    g.push(part(new THREE.DodecahedronGeometry(size, 0).scale(1.3, 0.7, 1), k % 2 ? STONE : STONE_DARK, Math.cos(a) * (R + 0.1), 0.45, Math.sin(a) * (R + 0.1)));
  }
  const r = 1.9;
  g.push(part(cyl(r + 0.4, r + 0.5, 0.3, 12), WHITE, 0, 1.25)); // the folly's step
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.push(part(cyl(0.13, 0.15, 2.5, 8), WHITE, Math.cos(a) * r, 2.65, Math.sin(a) * r));
  }
  g.push(part(cyl(r + 0.3, r + 0.3, 0.28, 12), WHITE, 0, 4.0));
  g.push(part(new THREE.SphereGeometry(r + 0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), snowy ? SNOW : ROOF, 0, 4.12));
  g.push(part(cyl(0.05, 0.12, 0.6, 6), WHITE, 0, 6.6));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** A white wooden footbridge arching over the water, railings either side, stone abutments. */
function footbridge(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const L = s.data!.length as number;
  const W = s.data!.width as number;
  const g: THREE.BufferGeometry[] = [];
  const n = 12;
  const rise = 1.1 + L * 0.03;
  // Local Z along the span (yaw), from -L/2 (island end, a deck over the island's rim) to +L/2.
  const h = (t: number) => 1.08 * (1 - t) + 0.15 * t + rise * Math.sin(Math.PI * t); // the island's top to the bank, arched
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const z0 = -L / 2 + L * t0, z1 = -L / 2 + L * t1;
    const ya = h(t0), yb = h(t1);
    const len = Math.hypot(z1 - z0, yb - ya);
    const tilt = Math.atan2(yb - ya, z1 - z0);
    const mid = (z0 + z1) / 2, my = (ya + yb) / 2;
    g.push(part(box(W, 0.14, len + 0.02).rotateX(-tilt), PLANK, 0, my, mid));
    if (snowy) g.push(part(box(W - 0.2, 0.04, len).rotateX(-tilt), SNOW, 0, my + 0.09, mid));
    for (const x of [-1, 1]) {
      g.push(part(box(0.08, 0.08, len + 0.02).rotateX(-tilt), WHITE, x * (W / 2 - 0.05), my + 0.95, mid)); // handrail
      g.push(part(box(0.1, 0.95, 0.1), WHITE, x * (W / 2 - 0.05), ya + 0.47, z0)); // post
    }
  }
  for (const x of [-1, 1]) g.push(part(box(0.12, 1.0, 0.12), WHITE, x * (W / 2 - 0.05), h(1) + 0.5, L / 2));
  // The arch's beams under the deck, and the bank abutment.
  for (const x of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z = -L / 2 + (L * (i + 0.5)) / n;
      const t = (i + 0.5) / n;
      const yb = h(t) - 0.25;
      g.push(part(box(0.16, Math.max(0.1, yb), 0.12), PLANK_DARK, x * (W / 2 - 0.3), yb / 2, z));
    }
  }
  g.push(part(box(W + 0.6, 0.5, 1.2), STONE_DARK, 0, 0.25, L / 2 - 0.6));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** The boathouse's jetty: a plank deck on posts, bollards at the end. */
function jetty(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const L = s.data!.length as number;
  const W = s.data!.width as number;
  const H = s.data!.height as number;
  const g: THREE.BufferGeometry[] = [part(box(W, 0.16, L), PLANK, 0, H - 0.08, 0)];
  for (let z = -L / 2 + 0.6; z < L / 2; z += 0.6) g.push(part(box(W + 0.02, 0.02, 0.06), PLANK_DARK, 0, H + 0.005, z)); // plank seams
  if (snowy) g.push(part(box(W - 0.1, 0.05, L - 0.1), SNOW, 0, H + 0.03, 0));
  for (let z = -L / 2 + 0.3; z <= L / 2; z += 2.2) for (const x of [-1, 1]) g.push(part(cyl(0.12, 0.12, H + 0.3, 6), PLANK_DARK, x * (W / 2 - 0.12), (H + 0.3) / 2 - 0.15, z));
  for (const x of [-1, 1]) g.push(part(cyl(0.14, 0.16, 0.45, 8), PLANK_DARK, x * (W / 2 - 0.3), H + 0.22, -L / 2 + 0.35));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** The fountain jet: a tall spout bursting into streams that arc out and fall, foam where they land (swelling in the frame loop). */
function jetGeometry(): THREE.BufferGeometry {
  const water = 0xdcebf3, foam = 0xf4f9fc;
  const g: THREE.BufferGeometry[] = [
    part(cyl(0.1, 0.32, 6.2, 8), foam, 0, 3.1),
    part(new THREE.SphereGeometry(0.45, 8, 6), foam, 0, 6.2),
    part(cyl(2.3, 2.6, 0.18, 14), foam, 0, 0.1),
    part(cyl(0.7, 1.0, 0.5, 10), foam, 0, 0.25),
  ];
  // Each stream: out and up from the top, then curving down to the foam ring (a few straight pieces).
  const pts = (t: number) => ({ r: 0.3 + 2.2 * t, y: 6.2 + 1.2 * t - 7.2 * t * t });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.2;
    for (let i = 0; i < 5; i++) {
      const p0 = pts(i / 5), p1 = pts((i + 1) / 5);
      const len = Math.hypot(p1.r - p0.r, p1.y - p0.y);
      const tilt = Math.atan2(p1.r - p0.r, p1.y - p0.y);
      const seg = box(0.09, len, 0.09).rotateZ(-tilt).rotateY(-a);
      g.push(part(seg, i < 2 ? foam : water, Math.cos(a) * (p0.r + p1.r) / 2, (p0.y + p1.y) / 2, Math.sin(a) * (p0.r + p1.r) / 2));
    }
  }
  return mergeGeometries(g);
}

// --- Set blocks: the stand, the bandstand (local X along the length, front +Z) ---

/** The stand beside the track: four tiers of benches on a steel frame, rising to the back (-Z). */
function bleachers(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const L = s.data!.length as number, D = s.data!.depth as number;
  const steel = 0x6a7076, seat = 0x2f6aa8;
  const g: THREE.BufferGeometry[] = [];
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const z = D / 2 - (t + 0.5) * (D / tiers), h = 0.45 + t * 0.55;
    g.push(part(box(L, 0.08, D / tiers), 0x9a9c98, 0, h - 0.04, z)); // the step
    g.push(part(box(L - 0.4, 0.1, 0.35), snowy ? SNOW : seat, 0, h + 0.4, z + 0.1)); // the bench
    for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 3) g.push(part(box(0.08, 0.4, 0.08), steel, x, h + 0.2, z + 0.1));
  }
  for (let x = -L / 2 + 0.2; x <= L / 2; x += 3.1) {
    g.push(part(box(0.12, 2.4, 0.12), steel, x, 1.2, -D / 2 + 0.1)); // back posts
    g.push(part(box(0.1, 0.1, D).rotateX(-0.45), steel, x, 0.95, 0)); // raking beams
  }
  g.push(part(box(L, 0.08, 0.08), steel, 0, 2.6, -D / 2 + 0.1)); // the back rail
  for (const e of [-1, 1]) g.push(part(box(0.1, 2.0, D), 0x8a8e8a, e * (L / 2 - 0.05), 1.0, 0)); // end panels
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

/** The bandstand: an octagonal stone plinth, iron columns and railings, a roof with a finial, steps facing +Z. */
function bandstand(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const R = (s.data?.radius as number) ?? MEGAPARK.bandstand;
  const iron = 0x2f3a34, cream = 0xf2ead8, roof = snowy ? SNOW : ROOF;
  const g: THREE.BufferGeometry[] = [
    part(cyl(R, R + 0.15, 1.0, 8).rotateY(Math.PI / 8), 0xb8b0a0, 0, 0.5),
    part(cyl(R + 0.05, R + 0.05, 0.08, 8).rotateY(Math.PI / 8), 0x8a6a48, 0, 1.04),
    part(new THREE.ConeGeometry(R + 0.6, 2.2, 8).rotateY(Math.PI / 8), roof, 0, 5.4),
    part(cyl(R + 0.6, R + 0.6, 0.3, 8).rotateY(Math.PI / 8), cream, 0, 4.15),
    part(cyl(0.06, 0.18, 1.0, 6), iron, 0, 6.9),
    part(new THREE.SphereGeometry(0.16, 8, 6), 0xc8a040, 0, 7.45),
  ];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.sin(a) * (R - 0.3), z = Math.cos(a) * (R - 0.3);
    g.push(part(cyl(0.08, 0.1, 3.0, 8), iron, x, 2.6, z));
    // Railings between the columns but on the steps' side.
    if (k === 0) continue;
    const a2 = ((k + 0.5) / 8) * Math.PI * 2;
    const chord = 2 * (R - 0.3) * Math.sin(Math.PI / 8);
    g.push(part(box(chord, 0.06, 0.06).rotateY(a2 + Math.PI / 2), iron, Math.sin(a2) * (R - 0.3) * Math.cos(Math.PI / 8), 1.95, Math.cos(a2) * (R - 0.3) * Math.cos(Math.PI / 8)));
  }
  // The steps up to it, on +Z.
  for (let t = 0; t < 3; t++) g.push(part(box(2.4, 0.33, 0.45), 0xa8a090, 0, 0.165 + t * 0.33 - 0.33 * 0, R + 0.9 - t * 0.45));
  place(g, frameOf(s.x, y, s.z, s.yaw), out);
}

// --- Ground: the court, the track, sandpits, the playground's bark, the café's terrace ---

/** The running track: an oval band (lanes, lines, the start) draped `lift` over the ground. */
function trackGround(flat: GeometryBuilder, s: Structure, terrain: Terrain, snowy: boolean): void {
  const ground = (x: number, z: number) => groundHeight(terrain, x, z);
  const S = s.data!.straight as number, Ro = s.data!.outer as number, W = s.data!.width as number;
  const alongX = s.data!.alongX as boolean;
  // A point on the stadium shape of radius r at parameter i of N.
  const N = 72;
  const pt = (i: number, r: number) => {
    const t = ((i % N) + N) % N / N; // 0..1 round
    // 0–0.4: right bend, 0.4–0.5 top straight, 0.5–0.9 left bend, 0.9–1 bottom straight.
    let u: number, v: number;
    if (t < 0.4) { const a = -Math.PI / 2 + (t / 0.4) * Math.PI; u = S / 2 + r * Math.cos(a); v = r * Math.sin(a); }
    else if (t < 0.5) { u = S / 2 - ((t - 0.4) / 0.1) * S; v = r; }
    else if (t < 0.9) { const a = Math.PI / 2 + ((t - 0.5) / 0.4) * Math.PI; u = -S / 2 + r * Math.cos(a); v = r * Math.sin(a); }
    else { u = -S / 2 + ((t - 0.9) / 0.1) * S; v = -r; }
    const x = s.x + (alongX ? u : v), z = s.z + (alongX ? v : u);
    return [x, z];
  };
  const band = (r0: number, r1: number, lift: number, color: THREE.Color) => {
    for (let i = 0; i < N; i++) {
      const [a0, b0] = [pt(i, r0), pt(i, r1)], [a1, b1] = [pt(i + 1, r0), pt(i + 1, r1)];
      const v = (p: number[]) => [p[0], ground(p[0], p[1]) + lift, p[1]];
      upTri(flat, v(a0), v(b0), v(b1), color);
      upTri(flat, v(a0), v(b1), v(a1), color);
    }
  };
  const red = new THREE.Color(snowy ? 0xe6eaee : 0xb8553a), line = new THREE.Color(snowy ? 0xc8d0d6 : 0xf2f0ea);
  band(Ro - W, Ro, 0.07, red);
  for (let k = 0; k <= 4; k++) { const r = Ro - W + (W * k) / 4; band(r - 0.05, r + 0.05, 0.09, line); }
  // The start line across the bottom straight's middle.
  const [x0, z0] = pt(N * 0.95, Ro - W), [x1, z1] = pt(N * 0.95, Ro);
  const r: Rect = alongX ? { x: x0, z: (z0 + z1) / 2, w: 0.3, d: Math.abs(z1 - z0) } : { x: (x0 + x1) / 2, z: z0, w: Math.abs(x1 - x0), d: 0.3 };
  flat.drape(r, 0.1, line, terrain);
}

/** A tennis court: the run-off, the playing area and its lines (doubles and singles, service boxes). */
function courtGround(flat: GeometryBuilder, p: GroundPatch, terrain: Terrain, snowy: boolean): void {
  const alongX = (p.yaw ?? 0) === 0;
  flat.drape(p, 0.07, new THREE.Color(snowy ? 0xe2e6ea : 0x4a7a5a), terrain);
  const L = 23.77, W = 10.97, Ws = 8.23, svc = 6.4;
  const r = (u: number, v: number, lu: number, lv: number): Rect => (alongX ? { x: p.x + u, z: p.z + v, w: lu, d: lv } : { x: p.x + v, z: p.z + u, w: lv, d: lu });
  flat.drape(r(0, 0, L, W), 0.085, new THREE.Color(snowy ? 0xd8dee4 : 0x3a6a9a), terrain);
  const white = new THREE.Color(0xf4f4f0), t = 0.06;
  for (const e of [-1, 1]) {
    flat.drape(r(0, e * W / 2, L, t * 2), 0.1, white, terrain); // doubles sidelines
    flat.drape(r(0, e * Ws / 2, L, t * 2), 0.1, white, terrain); // singles sidelines
    flat.drape(r(e * L / 2, 0, t * 2, W), 0.1, white, terrain); // baselines
    flat.drape(r(e * svc, 0, t * 2, Ws), 0.1, white, terrain); // service lines
  }
  flat.drape(r(0, 0, svc * 2, t * 2), 0.1, white, terrain); // the centre service line
}


const IRON = 0x23282a;
const GRAVEL = 0xc2b49a;
const SOIL = 0x5a4130;
const FLOWERS = [0xd8434a, 0xf0c23a, 0xe88ab8, 0xf4f0ea, 0x8a5ac8, 0xf08a3a];

/** One stone gate pillar with its cap and a lantern on top, local to its centre on the ground. */
function pillar(snowy: boolean): THREE.BufferGeometry[] {
  return [
    part(box(0.9, 2.5, 0.9), STONE, 0, 1.25, 0),
    part(box(1.1, 0.18, 1.1), STONE_DARK, 0, 2.59, 0),
    part(box(1.1, 0.06, 1.1), snowy ? SNOW : STONE_DARK, 0, 2.71, 0),
    part(box(0.12, 0.25, 0.12), IRON, 0, 2.86, 0),
    part(box(0.4, 0.05, 0.4), IRON, 0, 2.99, 0),
    part(cyl(0.04, 0.3, 0.2, 4), IRON, 0, 3.51, 0),
    // The glass (y 3.2) is a glow instance (glows()).
  ];
}

/** An iron gate leaf `len` long: rails top and bottom, bars, finials; local X along it, on the ground. */
function leaf(len: number): THREE.BufferGeometry[] {
  const out = [part(box(len, 0.08, 0.06), IRON, 0, 0.25, 0), part(box(len, 0.08, 0.06), IRON, 0, 1.95, 0), part(box(len, 0.06, 0.05), IRON, 0, 1.6, 0)];
  const n = Math.round(len / 0.16);
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len * i) / n;
    out.push(part(box(0.035, 2.0, 0.035), IRON, x, 1.15, 0));
    if (i % 2 === 0) out.push(part(cyl(0, 0.05, 0.14, 4), IRON, x, 2.22, 0));
  }
  return out;
}

/** The park gates: the parts are laid from the structure's footprints (pillars, then their leaf). */
function parkGate(s: Structure, ground: (x: number, z: number) => number, snowy: boolean, out: THREE.BufferGeometry[], lights: THREE.Vector3[]): void {
  for (const f of s.footprints) {
    const y = ground(f.x, f.z) - 0.05;
    const isPillar = f.hz > 0.2;
    place(isPillar ? pillar(snowy) : leaf(f.hx * 2), frameOf(f.x, y, f.z, f.yaw), out);
    if (isPillar) lights.push(new THREE.Vector3(f.x, y + 3.2, f.z));
  }
}

/** Where the bandstand's bulbs hang: round the rim of its eaves. */
function bandstandBulbs(s: Structure, y: number): THREE.Vector3[] {
  const R = ((s.data?.radius as number) ?? MEGAPARK.bandstand) + 0.65;
  return Array.from({ length: MEGAPARK.bandstandBulbs }, (_, k) => {
    const a = (k / MEGAPARK.bandstandBulbs) * Math.PI * 2;
    return new THREE.Vector3(s.x + Math.sin(a) * R, y + 3.95, s.z + Math.cos(a) * R);
  });
}

/**
 * The gate lanterns' glass and the bandstand's bulbs: unlit and tone-map free, so they glow (the
 * street lamps' bulbs' instanced material: no new shader); pale by day, warm at night.
 */
function glows(at: { pos: THREE.Vector3; geo: 'lantern' | 'bulb' }[], scene: THREE.Scene, lampGlow: number): void {
  for (const geo of ['lantern', 'bulb'] as const) {
    const list = at.filter((g) => g.geo === geo);
    if (!list.length) continue;
    const shape = geo === 'lantern' ? new THREE.BoxGeometry(0.32, 0.4, 0.32) : new THREE.SphereGeometry(0.09, 6, 4);
    const mesh = new THREE.InstancedMesh(shape, new THREE.MeshBasicMaterial({ toneMapped: false }), list.length);
    const color = new THREE.Color(geo === 'lantern' ? 0xd8ccb0 : 0xc8c0a8).lerp(new THREE.Color(0xffc870).multiplyScalar(1.6), lampGlow);
    const m = new THREE.Matrix4();
    list.forEach((g, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(g.pos.x, g.pos.y, g.pos.z));
      mesh.setColorAt(i, color);
    });
    scene.add(mesh);
  }
}

/** The low name wall: stone with a coping; the plate goes on its street face (local +Z). */
function nameWall(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const f = s.footprints[0];
  const w = f.hx * 2, d = f.hz * 2;
  place([
    part(box(w, 1.3, d), STONE, 0, 0.65, 0),
    part(box(w + 0.2, 0.14, d + 0.2), STONE_DARK, 0, 1.37, 0),
    ...(snowy ? [part(box(w + 0.2, 0.06, d + 0.2), SNOW, 0, 1.47, 0)] : []),
  ], frameOf(s.x, y, s.z, s.yaw), out);
}

/** A flower bed: an oval of dark soil, low clumps of flowers in two or three colours (snow: a white mound; desert: a cactus garden on gravel). */
function bed(p: GroundPatch, terrain: Terrain, ground: (x: number, z: number) => number, snowy: boolean, desert: boolean, flat: GeometryBuilder, out: THREE.BufferGeometry[]): void {
  const N = 16;
  const v = (a: number, k: number) => {
    const x = p.x + Math.cos(a) * (p.w / 2) * k, z = p.z + Math.sin(a) * (p.d / 2) * k;
    return [x, groundHeight(terrain, x, z) + 0.07, z];
  };
  const soil = new THREE.Color(snowy ? SNOW : desert ? 0xc8b48e : SOIL), rim = new THREE.Color(snowy ? 0xdde3ea : STONE);
  const c = [p.x, groundHeight(terrain, p.x, p.z) + 0.07, p.z];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    upTri(flat, c, v(a0, 0.9), v(a1, 0.9), soil);
    upTri(flat, v(a0, 0.9), v(a0, 1), v(a1, 1), rim);
    upTri(flat, v(a0, 0.9), v(a1, 1), v(a1, 0.9), rim);
  }
  if (snowy) return;
  const pick = Math.abs(Math.round(p.x * 7 + p.z * 13));
  if (desert) {
    // A few round cacti and a tall one with an arm, on the gravel.
    const n = Math.max(3, Math.round((p.w * p.d) / 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + pick, k = i % 2 ? 0.55 : 0.25;
      const x = p.x + Math.cos(a) * (p.w / 2) * k, z = p.z + Math.sin(a) * (p.d / 2) * k, y = ground(x, z);
      if (i === 0) {
        out.push(part(cyl(0.14, 0.16, 1.3, 6), 0x4f7f42, x, y + 0.65, z), part(cyl(0.09, 0.1, 0.5, 6), 0x4f7f42, x + 0.22, y + 0.85, z), part(box(0.22, 0.08, 0.08), 0x4f7f42, x + 0.11, y + 0.62, z));
      } else out.push(part(new THREE.SphereGeometry(0.22 + (i % 3) * 0.05, 7, 5), (i + pick) % 4 ? 0x5f8f4a : 0x6a8a3a, x, y + 0.16, z));
    }
    return;
  }
  // Rings of clumps, the colour by ring (deterministic from the bed's place).
  for (let ring = 0; ring < 3; ring++) {
    const k = 0.75 - ring * 0.28;
    const n = Math.max(1, Math.round((N * k * Math.max(p.w, p.d)) / 5));
    const color = FLOWERS[(pick + ring * 2) % FLOWERS.length];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.4;
      const x = p.x + Math.cos(a) * (p.w / 2) * k, z = p.z + Math.sin(a) * (p.d / 2) * k;
      out.push(part(box(0.4, 0.22, 0.4), color, x, ground(x, z) + 0.11, z));
    }
  }
}

const SAND = 0xd8c08a;

export function renderMegapark(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const frozen = ctx.climate.name === 'snow';
  const solid: THREE.BufferGeometry[] = [];
  const lake = city.water.find((w) => w.kind === 'lake' && Math.abs(w.x - q.bounds.x) <= q.bounds.w / 2 && Math.abs(w.z - q.bounds.z) <= q.bounds.d / 2);
  const surface = (x: number, z: number) => ctx.ground(x, z) + (lake?.depth ?? 0);
  const flat = new GeometryBuilder();
  const plates: THREE.BufferGeometry[] = [];
  const lanterns: THREE.Vector3[] = [], bulbs: THREE.Vector3[] = [];
  for (const p of q.dressing.ground) {
    if (p.kind === 'court') courtGround(flat, p, city.terrain, snowy);
    else if (p.kind === 'sandpit') {
      flat.drape(p, 0.08, new THREE.Color(snowy ? 0xeef2f6 : SAND), city.terrain);
      // A timber border round it.
      const y = ctx.ground(p.x, p.z);
      for (const e of [-1, 1]) {
        solid.push(part(box(p.w + 0.3, 0.22, 0.15), PLANK, p.x, y + 0.1, p.z + e * (p.d / 2 + 0.07)));
        solid.push(part(box(0.15, 0.22, p.d), PLANK, p.x + e * (p.w / 2 + 0.07), y + 0.1, p.z));
      }
    } else if (p.kind === 'playground') flat.drape(shrink(p, 0.3), 0.07, new THREE.Color(snowy ? 0xe8ecf0 : 0x8a6a4a), city.terrain); // bark
    else if (p.kind === 'terrace') flat.drape(p, 0.07, new THREE.Color(snowy ? 0xe4e8ec : 0xc8bca4), city.terrain);
    else if (p.kind === 'bed') bed(p, city.terrain, ctx.ground, snowy, ctx.climate.name === 'desert', flat, solid);
  }
  // Gravel paths (trodden snow in the snow).
  const gravel = new THREE.Color(snowy ? 0xb4bcc4 : GRAVEL);
  for (const path of (q.dressing.extra?.paths ?? []) as ParkPath[]) drapePolyline(flat, path.points, path.width, 0.065, gravel, city.terrain);
  for (const s of q.dressing.structures) {
    const y = ctx.ground(s.x, s.z);
    if (s.kind === 'track') { trackGround(flat, s, city.terrain, snowy); continue; }
    if (s.kind === 'bleachers') { bleachers(s, y - 0.05, snowy, solid); continue; }
    if (s.kind === 'bandstand') {
      bandstand(s, y - 0.05, snowy, solid);
      bulbs.push(...bandstandBulbs(s, y - 0.05));
      continue;
    }
    if (s.kind === 'parkGate') { parkGate(s, ctx.ground, snowy, solid, lanterns); continue; }
    if (s.kind === 'nameWall') {
      nameWall(s, y - 0.05, snowy, solid);
      const f = s.footprints[0];
      plates.push(parkNamePlate(f.hx * 2 - 0.3, 0.62, s.data!.name as number).applyMatrix4(frameOf(s.x, y + 0.75, s.z, s.yaw).multiply(new THREE.Matrix4().makeTranslation(0, 0, f.hz + 0.02))));
      continue;
    }
    if (s.kind === 'island') island(s, y - 0.05, snowy, solid);
    else if (s.kind === 'jetty') jetty(s, y, snowy, solid);
    else if (s.kind === 'footbridge') footbridge(s, y - 0.05, snowy, solid);
    else if (s.kind === 'moored') {
      // Afloat (on the ice in the snow).
      const boat = rowboat().applyMatrix4(frameOf(s.x, surface(s.x, s.z) - (frozen ? 0.1 : 0.22), s.z, s.yaw));
      solid.push(boat);
    }
  }
  if (flat.positions.length) {
    const mesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (plates.length) scene.add(new THREE.Mesh(mergeGeometries(plates), parkSignMaterial(0.08 + ctx.lampGlow * 0.15)));
  glows([...lanterns.map((pos) => ({ pos, geo: 'lantern' as const })), ...bulbs.map((pos) => ({ pos, geo: 'bulb' as const }))], scene, ctx.lampGlow);
  // Fireflies over the lawns on warm nights, within the glow budget.
  const warm = ctx.climate.name === 'temperate' || ctx.climate.name === 'beach';
  const lit = city.streetProps.filter((p) => LIT_PROPS.has(p.kind) && inRect(q.bounds, p, 1)).length + lanterns.length + bulbs.length;
  const lawns = q.blocks.filter((k) => q.roles.get(k) === 'lawn' || q.roles.get(k) === 'bandstand').map((k) => shrink(city.blocks[k].rect, city.config.sidewalk + 4));
  const flies = ctx.night && warm ? fireflies(lawns, Math.max(0, Math.min(MEGAPARK.fireflies, MEGAPARK.maxGlow - lit)), city.seed ^ 0x3e9a, scene, ctx.ground) : null;
  // The fountain jet (not in the snow: the lake is frozen).
  const at = q.dressing.extra?.fountain as { x: number; z: number } | undefined;
  let jet: THREE.Mesh | null = null;
  if (at && !frozen) {
    jet = new THREE.Mesh(jetGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    jet.position.set(at.x, surface(at.x, at.z) - 0.1, at.z);
    scene.add(jet);
  }
  return {
    update(_dt, time) {
      if (flies) flies.value = time;
      if (jet) jet.scale.y = 1 + 0.08 * Math.sin(time * 2.1) + 0.04 * Math.sin(time * 5.3);
    },
  };
}
