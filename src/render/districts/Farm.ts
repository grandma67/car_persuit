// The Farm: ploughed soil and its furrows over each field, cattle grids, the ranch gate (log posts,
// crossbeam, hanging name board, wagon wheels) and the windmills' turning wheels. Ground goes into
// one vertex-coloured mesh with the city's paving settings, the gate into one merged mesh with the
// district structures' settings, the name board onto a sign plate with the facade walls' settings,
// the wheels with the landmarks' settings. No new shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import { GeometryBuilder } from '../../world/CityBuilder';
import type { District, GroundPatch, Structure } from '../../world/districts/District';
import { farmFields, type Crop } from '../../world/districts/Farm';
import type { RanchGateData } from '../../world/districts/FarmGate';
import { buildCrops } from './farmCrops';
import type { PivotData } from '../../world/districts/FarmNight';
import { FARM } from '../../gameplay/balance';
import { farmSignMaterial, namePlate, onWarm } from './farmSigns';
import { WINDMILL } from '../Landmarks';
import { groundBase } from '../../world/Terrain';
import type { DistrictRenderContext, DistrictView } from './index';

const SOIL = 0x6a4e36;
const FURROW = 0x523a28;
const LOG = 0x7a5a3a;
const LOG_DARK = 0x5a4028;
const IRON = 0x2e2e30;
const SNOW = 0xeef2f6;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const frameOf = (x: number, y: number, z: number, yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));

/** Each crop's ground: base and row colours. */
const GROUND: Record<Crop, [number, number]> = {
  corn: [0x4a4a2a, FURROW], // shaded earth under the leaves
  wheat: [0xb8963e, 0x9a7a30], // gold under the shells, so far-off wheat still reads gold
  pumpkin: [SOIL, 0x3f6a2a], // green vine rows
  orchard: [0x5a7a3a, 0x4e6e32], // mown grass, darker strips down the aisles
  hay: [0xc8b070, 0xb09858], // stubble
};

/** A field's ground and its rows along them, ~0.75 m apart (vines and mown strips wider). */
function soil(flat: GeometryBuilder, p: GroundPatch, city: CityData, snowy: boolean, crop: Crop, climate: string): void {
  const [b, r] = GROUND[crop];
  // Bleached in the desert, greener by the beach.
  const tint = (hex: number) => {
    const c = new THREE.Color(hex);
    if (climate === 'desert') c.lerp(new THREE.Color(0xd8c8a0), 0.35);
    if (climate === 'beach' && crop !== 'wheat' && crop !== 'hay') c.lerp(new THREE.Color(0x5aa03a), 0.25);
    return c;
  };
  const base = snowy ? new THREE.Color(0xe4e8ec) : tint(b);
  const furrow = snowy ? new THREE.Color(0xc8d0d8) : tint(r);
  const pitch = crop === 'pumpkin' ? 1.5 : crop === 'orchard' ? 3 : 0.75;
  const width = crop === 'pumpkin' ? 0.6 : crop === 'orchard' ? 1.4 : 0.28;
  flat.drape(p, 0.055, base, city.terrain);
  const alongX = (p.yaw ?? 0) === 0;
  const across = alongX ? p.d : p.w;
  const n = Math.floor(across / pitch);
  for (let k = 0; k < n; k++) {
    const c = -across / 2 + (across - (n - 1) * pitch) / 2 + k * pitch;
    const row = alongX ? { x: p.x, z: p.z + c, w: p.w - 0.4, d: width } : { x: p.x + c, z: p.z, w: width, d: p.d - 0.4 };
    flat.drape(row, 0.078, furrow, city.terrain);
  }
}

/** The combine: a big green harvester on its wheels, cab to the front (+Z), the unloading auger folded. */
function combine(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const green = 0x3a7a32, dark = 0x22252a, glass = 0x3a4a54, yellow = 0xd8b02a;
  const g = [
    part(box(3.2, 2.4, 6.6), green, 0, 2.2, -0.4),
    part(box(3.0, 1.2, 3.2), green, 0, 3.9, -1.2), // the grain tank
    part(box(1.8, 1.6, 1.8), glass, 0, 4.2, 1.6), // the cab
    part(box(1.9, 0.12, 1.9), snowy ? SNOW : 0xe8e8e0, 0, 5.05, 1.6),
    part(box(0.3, 0.3, 5.0), yellow, 1.75, 4.3, -1.0), // the auger, folded along the side
    part(cyl(0.12, 0.12, 2.0, 6), dark, -0.9, 4.8, -3.0), // exhaust
    part(box(3.6, 0.8, 1.0), dark, 0, 1.2, 2.9), // the feeder housing's mount
    ...[-1, 1].map((sx) => part(cyl(1.0, 1.0, 0.7, 14).rotateZ(Math.PI / 2), dark, sx * 1.5, 1.0, 1.6)),
    ...[-1, 1].map((sx) => part(cyl(0.6, 0.6, 0.45, 12).rotateZ(Math.PI / 2), dark, sx * 1.35, 0.6, -3.0)),
  ];
  if (snowy) g.push(part(box(3.0, 0.08, 3.2), SNOW, 0, 4.54, -1.2));
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
}

/** The combine's header on its transport trailer: a long cutter bar and reel across a low frame. */
function headerTrailer(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const green = 0x3a7a32, dark = 0x22252a, yellow = 0xd8b02a;
  const g = [
    part(box(9.0, 0.2, 1.6), dark, 0, 0.75, 0),
    ...[-3.6, 3.6].map((x) => part(cyl(0.4, 0.4, 0.3, 10).rotateX(Math.PI / 2), dark, x, 0.4, 0)),
    part(box(9.2, 0.9, 1.4), green, 0, 1.4, 0),
    part(box(9.2, 0.08, 0.5), 0x9aa0a4, 0, 0.98, 0.75), // the cutter bar
    part(cyl(0.45, 0.45, 8.8, 10).rotateZ(Math.PI / 2), yellow, 0, 2.2, 0.3), // the reel
    part(box(0.12, 0.12, 2.0), dark, 0, 0.75, 1.6), // the drawbar
  ];
  if (snowy) g.push(part(box(9.0, 0.06, 1.2), SNOW, 0, 1.88, 0));
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
}

/** A cattle grid: a dark pit with galvanised bars across the road, flush. */
function cattleGrid(flat: GeometryBuilder, p: GroundPatch, city: CityData): void {
  flat.drape(p, 0.035, new THREE.Color(0x1c1c1e), city.terrain);
  const bar = new THREE.Color(0x9aa0a4);
  const alongX = p.w < p.d; // bars run across the street, along the long side
  const len = alongX ? p.w : p.d;
  const n = Math.floor(len / 0.2);
  for (let k = 0; k < n; k++) {
    const c = -len / 2 + 0.1 + k * 0.2;
    flat.drape(alongX ? { x: p.x + c, z: p.z, w: 0.07, d: p.d } : { x: p.x, z: p.z + c, w: p.w, d: 0.07 }, 0.058, bar, city.terrain);
  }
  // Concrete kerbs either end of the pit.
  const kerb = new THREE.Color(0xa8a49a);
  for (const end of [-1, 1]) {
    flat.drape(alongX ? { x: p.x + end * (p.w / 2 + 0.12), z: p.z, w: 0.24, d: p.d } : { x: p.x, z: p.z + end * (p.d / 2 + 0.12), w: p.w, d: 0.24 }, 0.04, kerb, city.terrain);
  }
}

/** A wagon wheel standing on its rim in the YZ plane at (0, r, 0): rim, spokes, hub. */
function wagonWheel(r: number): THREE.BufferGeometry[] {
  const out = [part(new THREE.TorusGeometry(r, 0.05, 5, 18).rotateY(Math.PI / 2), LOG_DARK, 0, r, 0)];
  for (let k = 0; k < 6; k++) out.push(part(box(0.04, r * 2, 0.05).rotateX((k * Math.PI) / 6), LOG, 0, r, 0));
  out.push(part(cyl(0.11, 0.11, 0.2, 8).rotateZ(Math.PI / 2), LOG_DARK, 0, r, 0));
  return out;
}

/** The ranch gate in its frame: posts, crossbeam, braces, the name board on chains, wagon wheels. */
function ranchGate(s: Structure, snowy: boolean, solid: THREE.BufferGeometry[], signs: THREE.BufferGeometry[]): void {
  const d = s.data as unknown as RanchGateData;
  const m = frameOf(s.x, d.base, s.z, s.yaw);
  const g: THREE.BufferGeometry[] = [];
  const top = d.beam + 0.35; // the crossbeam's centre
  for (const sx of [-1, 1]) {
    const x = sx * d.half;
    g.push(part(cyl(0.28, 0.33, top + 0.9, 9), LOG, x, (top + 0.9) / 2, 0));
    g.push(part(cyl(0.3, 0.3, 0.06, 9), snowy ? SNOW : 0xb89a70, x, top + 0.93, 0)); // its cut top
    // A knee brace from the post in under the beam (over the sidewalk only).
    const brace = box(0.14, 1.7, 0.14).rotateZ(sx * 0.62);
    g.push(part(brace, LOG_DARK, x - sx * 0.5, top - 0.85, 0));
    // A wagon wheel leaning on the post's outer side.
    const wheel = mergeGeometries(wagonWheel(0.62)).rotateY(Math.PI / 2).rotateX(-0.18);
    g.push(part(wheel, LOG, x + sx * 0.2, 0.05, -0.75));
  }
  // The crossbeam log and a thinner one above it, a little past the posts.
  const span = d.half * 2 + 1.4;
  g.push(part(cyl(0.3, 0.3, span, 9).rotateZ(Math.PI / 2), LOG, 0, top, 0));
  g.push(part(cyl(0.18, 0.18, span - 0.6, 8).rotateZ(Math.PI / 2), LOG_DARK, 0, top + 0.55, 0));
  if (snowy) g.push(part(box(span, 0.08, 0.4), SNOW, 0, top + 0.32, 0));
  // The name board: a timber frame on two chains, the name on both faces 2 cm proud.
  const sb = d.sign;
  const cy = sb.bottom + sb.h / 2;
  g.push(part(box(sb.w + 0.2, sb.h + 0.2, 0.12), LOG_DARK, 0, cy, 0));
  for (const sx of [-1, 1]) g.push(part(box(0.05, top - 0.3 - (sb.bottom + sb.h), 0.05), IRON, sx * (sb.w / 2 - 0.4), (top - 0.3 + sb.bottom + sb.h) / 2, 0));
  if (snowy) g.push(part(box(sb.w + 0.2, 0.06, 0.14), SNOW, 0, sb.bottom + sb.h + 0.13, 0));
  solid.push(...g.map((p) => p.applyMatrix4(m)));
  for (const side of [-1, 1]) {
    const p = namePlate(sb.w, sb.h, d.name);
    if (side < 0) p.rotateY(Math.PI);
    signs.push(p.translate(0, cy, side * 0.08).applyMatrix4(m));
  }
}

/** A windmill's head: the multi-blade wheel facing +Z round its hub, and the tail vane behind. */
function windmillWheel(): { wheel: THREE.BufferGeometry; tail: THREE.BufferGeometry } {
  const R = WINDMILL.wheel;
  const blades: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    // A sheet-steel blade from the inner ring to the rim, twisted a little into the wind.
    const blade = box(0.34, R * 0.62, 0.02).rotateY(0.35).translate(0, R * 0.62, 0).rotateZ(a);
    blades.push(part(blade, 0xd8dcdc));
  }
  const wheel = mergeGeometries([
    ...blades,
    part(new THREE.TorusGeometry(R, 0.04, 4, 32), 0x8a9094),
    part(new THREE.TorusGeometry(R * 0.4, 0.04, 4, 24), 0x8a9094),
    part(cyl(0.22, 0.22, 0.4, 10).rotateX(Math.PI / 2), 0x4a4e52),
  ]);
  const tail = mergeGeometries([
    part(box(0.2, 0.25, 1.0), 0x4a4e52, 0, 0, -0.4), // the gearbox
    part(box(0.06, 0.06, 3.0), 0x6a6e72, 0, 0, -2.2), // the boom
    part(box(0.03, 1.1, 1.6), 0xd8dcdc, 0, 0.1, -3.6), // the vane
  ]);
  return { wheel, tail };
}

/** A harvest night's pyramid of square bales by the ranch gate: three, two, one. */
function balePyramid(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const straw = 0xd8b860;
  const g: THREE.BufferGeometry[] = [];
  [3, 2, 1].forEach((n, row) => {
    for (let k = 0; k < n; k++) {
      g.push(part(box(1.1, 0.55, 2.4), straw, (k - (n - 1) / 2) * 1.15, 0.28 + row * 0.56, 0));
      g.push(part(box(1.12, 0.04, 2.42), 0xa8823a, (k - (n - 1) / 2) * 1.15, 0.28 + row * 0.56 + 0.1, 0));
    }
  });
  if (snowy) g.push(part(box(1.1, 0.05, 2.3), SNOW, 0, 1.7, 0));
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
}

/** The parked centre-pivot irrigator: a centre tower, the truss out along its yaw, A-frame towers on wheels, drop hoses. */
function pivot(s: Structure, city: CityData, out: THREE.BufferGeometry[]): void {
  const d = s.data as unknown as PivotData;
  const galv = 0xb8c0c4, dark = 0x2a2a2a;
  const g: THREE.BufferGeometry[] = [];
  const y = (dist: number) => groundBase(city.terrain, s.x + Math.sin(s.yaw) * dist, s.z + Math.cos(s.yaw) * dist, 1) - 0.05;
  const y0 = y(0);
  // Centre tower: four legs and a riser pipe.
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) g.push(part(box(0.12, d.height + 1, 0.12).rotateX(-z * 0.12).rotateZ(x * 0.12), galv, x * 0.6, (d.height + 1) / 2, z * 0.6));
  g.push(part(cyl(0.15, 0.15, d.height + 1.4, 8), galv, 0, (d.height + 1.4) / 2, 0));
  // The truss: a pipe along the top with a lattice under it, tower to tower.
  g.push(part(cyl(0.12, 0.12, d.r, 8).rotateX(Math.PI / 2), galv, 0, d.height, d.r / 2));
  for (let z = 1; z < d.r; z += 2.5) g.push(part(box(0.05, 0.9, 0.05).rotateX(((z / 2.5) % 2 ? 1 : -1) * 0.9), galv, 0, d.height - 0.45, z));
  g.push(part(box(0.06, 0.06, d.r), galv, 0, d.height - 0.9, d.r / 2));
  for (let z = 3; z < d.r; z += 3) g.push(part(box(0.03, 1.8, 0.03), dark, 0, d.height - 1.6, z)); // drop hoses
  for (const t of d.towers.slice(1)) {
    const dy = y(t) - y0;
    for (const side of [-1, 1]) g.push(part(box(0.1, d.height + 0.3, 0.1).rotateZ(side * 0.32), galv, side * 0.55, dy + d.height / 2, t));
    for (const side of [-1, 1]) g.push(part(cyl(0.55, 0.55, 0.35, 12).rotateZ(Math.PI / 2), dark, side * 1.15, dy + 0.55, t));
    g.push(part(box(2.4, 0.12, 0.12), galv, 0, dy + 0.55, t));
  }
  const m = frameOf(s.x, y0, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
}

/** Fireflies drifting low over the fields at night, each blinking on its own phase (in the shader). */
function fireflies(q: District, city: CityData, fields: { rect: { x: number; z: number; w: number; d: number } }[], scene: THREE.Scene, ground: (x: number, z: number) => number): { value: number } {
  // Within the glow budget: what the district already lights (timber lamps, jack-o'-lanterns, the lantern).
  const lit = city.streetProps.filter((p) => (p.kind === 'woodLamp' || p.kind === 'jackOLantern') && Math.abs(p.x - q.bounds.x) <= q.bounds.w / 2 && Math.abs(p.z - q.bounds.z) <= q.bounds.d / 2).length + 1;
  const n = Math.max(0, Math.min(FARM.fireflies, FARM.maxGlow - lit));
  const time = { value: 0 };
  if (!n || !fields.length) return time;
  const pos = new Float32Array(n * 3), phase = new Float32Array(n);
  let seed = city.seed % 2147483647 || 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const f = fields[i % fields.length].rect;
    const x = f.x + (rnd() - 0.5) * f.w, z = f.z + (rnd() - 0.5) * f.d;
    pos.set([x, ground(x, z) + 0.6 + rnd() * 1.6, z], i * 3);
    phase[i] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.PointsMaterial({ color: 0xd8ff6a, size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;\nvarying float vBlink;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.x += sin(uTime * 0.5 + aPhase * 7.0) * 0.8;
transformed.z += cos(uTime * 0.43 + aPhase * 11.0) * 0.8;
transformed.y += sin(uTime * 0.7 + aPhase * 5.0) * 0.3;
vBlink = smoothstep(0.55, 1.0, sin(uTime * 1.6 + aPhase * 6.2832));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlink;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vBlink;');
  };
  mat.customProgramCacheKey = () => 'farmFireflies';
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return time;
}

export function renderFarm(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const flat = new GeometryBuilder();
  const fields = farmFields(q);
  const cropAt = (p: GroundPatch) => fields.find((f) => Math.abs(f.rect.x - p.x) < 0.5 && Math.abs(f.rect.z - p.z) < 0.5)?.crop ?? 'corn';
  for (const p of q.dressing.ground) {
    if (p.kind === 'soil') soil(flat, p, city, snowy, cropAt(p), ctx.climate.name);
    else if (p.kind === 'cattleGrid') cattleGrid(flat, p, city);
  }
  // The irrigator's circle: watered green (the desert only has one).
  for (const s of q.dressing.structures) {
    if (s.kind !== 'pivot') continue;
    const r = (s.data as unknown as PivotData).r;
    const green = new THREE.Color(0x6a9a3a);
    for (let x = -r; x < r; x += 2) for (let z = -r; z < r; z += 2) if (Math.hypot(x + 1, z + 1) < r) flat.drape({ x: s.x + x + 1, z: s.z + z + 1, w: 2, d: 2 }, 0.1, green, city.terrain);
  }
  // A maze's paths: trodden earth through the corn.
  for (const f of fields) for (const r of f.maze ?? []) flat.drape(r, 0.1, new THREE.Color(snowy ? 0xd8dce0 : 0x8a6a48), city.terrain);
  if (flat.positions.length) {
    const mesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const solid: THREE.BufferGeometry[] = [];
  const signs: THREE.BufferGeometry[] = [];
  for (const s of q.dressing.structures) {
    const y = Math.min(...s.footprints.map((f) => groundBase(city.terrain, f.x, f.z, Math.max(f.hx, f.hz)))) - 0.05;
    if (s.kind === 'ranchGate') ranchGate(s, snowy, solid, signs);
    else if (s.kind === 'combine') combine(s, y, snowy, solid);
    else if (s.kind === 'headerTrailer') headerTrailer(s, y, snowy, solid);
    else if (s.kind === 'balePyramid') balePyramid(s, y, snowy, solid);
    else if (s.kind === 'pivot') pivot(s, city, solid);
  }
  // A lantern by the barn's doors, lit at night (its glass on the sign plates' material).
  const barn = city.buildings.find((b) => b.district === 'farm' && b.lot === 'barn' && Math.abs(b.x - q.bounds.x) <= q.bounds.w / 2 && Math.abs(b.z - q.bounds.z) <= q.bounds.d / 2);
  if (barn && ctx.lampGlow > 0.3) {
    const bits: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];
    const [, nx, nz] = bits.find(([bit]) => (barn.street ?? 1) & bit) ?? bits[0];
    const x = barn.x + nx * (barn.w / 2 + 0.2), z = barn.z + nz * (barn.d / 2 + 0.2);
    const y = groundBase(city.terrain, barn.x, barn.z, Math.max(barn.w, barn.d) / 2) - 0.3 + 3.1;
    solid.push(part(box(0.32, 0.45, 0.32), IRON, x, y, z), part(box(0.08, 0.08, 0.5), IRON, x - nx * 0.25, y + 0.3, z - nz * 0.25));
    const glass = onWarm(new THREE.BoxGeometry(0.24, 0.32, 0.24)).translate(x, y, z);
    scene.add(new THREE.Mesh(glass, farmSignMaterial(2.5)));
  }
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (signs.length) scene.add(new THREE.Mesh(mergeGeometries(signs), farmSignMaterial(0.08 + ctx.lampGlow * 0.15)));

  // Windmill heads: turned into the wind (one direction per run), wheels spinning with the gusts.
  const mills = q.dressing.landmarks.filter((l) => l.kind === 'windmill');
  const heads: THREE.Object3D[] = [];
  const wheels: THREE.Mesh[] = [];
  if (mills.length) {
    const { wheel, tail } = windmillWheel();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });
    const windYaw = ((city.seed % 360) * Math.PI) / 180;
    for (const l of mills) {
      const head = new THREE.Group();
      head.position.set(l.x, groundBase(city.terrain, l.x, l.z, l.radius) - 0.05 + WINDMILL.hub, l.z);
      head.rotation.y = windYaw;
      const w = new THREE.Mesh(wheel, material);
      w.position.z = 0.35;
      w.castShadow = true;
      const t = new THREE.Mesh(tail, material);
      t.castShadow = true;
      head.add(w, t);
      scene.add(head);
      heads.push(head);
      wheels.push(w);
    }
  }
  // Crops, and fallen fruit under the orchard trees (the props' instanced, tinted settings).
  const climate = ctx.climate.name;
  const look = snowy ? { dry: true, corn: 0xffffff, wheat: 0xe8e0c8 } : climate === 'desert' ? { dry: false, corn: 0xe8e0b0, wheat: 0xf8f0d8 } : climate === 'beach' ? { dry: false, corn: 0xe0ffd8, wheat: 0xffffff } : { dry: false, corn: 0xffffff, wheat: 0xffffff };
  const crops = buildCrops(q, city, fields, scene, ctx.ground, look);
  // Fireflies over the fields on warm nights: blinking in the shader, within the glow budget.
  const flies = ctx.night && (climate === 'temperate' || climate === 'beach') ? fireflies(q, city, fields, scene, ctx.ground) : null;
  const trees = q.dressing.props.filter((p) => p.kind === 'tree' && p.tree === 'fruit');
  if (trees.length && !snowy) {
    const per = 4;
    const fruit = new THREE.InstancedMesh(part(new THREE.IcosahedronGeometry(0.09, 0), 0xffffff), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 }), trees.length * per);
    const colour = new THREE.Color(trees[0].style === 'pear' ? 0xc8c43a : 0xc8302a);
    const m4 = new THREE.Matrix4();
    trees.forEach((t, i) => {
      for (let k = 0; k < per; k++) {
        const a = t.yaw + k * 1.9, r = 0.8 + ((i * 7 + k * 3) % 10) / 8;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        fruit.setMatrixAt(i * per + k, m4.makeTranslation(x, ctx.ground(x, z) + 0.1, z));
        fruit.setColorAt(i * per + k, colour);
      }
    });
    fruit.computeBoundingSphere();
    scene.add(fruit);
  }
  const movers = ctx.movers;
  return {
    update(dt, time) {
      // Gusty wind: a steady turn with slow swells.
      const spin = 1.4 + 0.6 * Math.sin(time * 0.31) + 0.3 * Math.sin(time * 1.13);
      for (const w of wheels) w.rotation.z -= spin * dt;
      crops.uniforms.uTime.value = time;
      if (flies) flies.value = time;
      if (movers) for (const v of movers()) crops.trample.stamp(v.position.x, v.position.z);
      crops.trample.update(dt);
    },
  };
}
