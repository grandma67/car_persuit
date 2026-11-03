// The Mega-park: the lake's island and its folly, the footbridge, the jetty, the moored rowboats and
// the fountain jet. Solid pieces merge into one vertex-coloured mesh with the district structures'
// settings; the jet is its own mesh with the same settings, swelling in the frame loop. The water
// is ShallowWaterView, the stone rim and lily pads the park pieces' mesh, the boathouse a lot. No
// new shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MEGAPARK } from '../../gameplay/balance';
import type { CityData } from '../../world/CityGenerator';
import type { District, Structure } from '../../world/districts/District';
import { part } from '../geometry';
import { rowboat } from '../Landmarks';
import type { DistrictRenderContext, DistrictView } from './index';

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

export function renderMegapark(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const frozen = ctx.climate.name === 'snow';
  const solid: THREE.BufferGeometry[] = [];
  const lake = city.water.find((w) => w.kind === 'lake' && Math.abs(w.x - q.bounds.x) <= q.bounds.w / 2 && Math.abs(w.z - q.bounds.z) <= q.bounds.d / 2);
  const surface = (x: number, z: number) => ctx.ground(x, z) + (lake?.depth ?? 0);
  for (const s of q.dressing.structures) {
    const y = ctx.ground(s.x, s.z);
    if (s.kind === 'island') island(s, y - 0.05, snowy, solid);
    else if (s.kind === 'jetty') jetty(s, y, snowy, solid);
    else if (s.kind === 'footbridge') footbridge(s, y - 0.05, snowy, solid);
    else if (s.kind === 'moored') {
      // Afloat (on the ice in the snow).
      const boat = rowboat().applyMatrix4(frameOf(s.x, surface(s.x, s.z) - (frozen ? 0.1 : 0.22), s.z, s.yaw));
      solid.push(boat);
    }
  }
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
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
      if (jet) jet.scale.y = 1 + 0.08 * Math.sin(time * 2.1) + 0.04 * Math.sin(time * 5.3);
    },
  };
}
