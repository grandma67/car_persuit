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
import type { RoundBaleData } from '../../world/districts/FarmFields';
import { buildCrops } from './farmCrops';
import { farmSignMaterial, namePlate } from './farmSigns';
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
function soil(flat: GeometryBuilder, p: GroundPatch, city: CityData, snowy: boolean, crop: Crop): void {
  const [b, r] = GROUND[crop];
  const base = new THREE.Color(snowy ? 0xe4e8ec : b);
  const furrow = new THREE.Color(snowy ? 0xc8d0d8 : r);
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

/** A round bale lying on its side, wrapped or plain straw. */
function roundBale(s: Structure, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const d = s.data as unknown as RoundBaleData;
  const wrapped = (Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233)) * 43758.5453) % 1 < 0.3;
  const g = [
    part(cyl(d.r, d.r, d.len, 14).rotateZ(Math.PI / 2), wrapped ? 0xe8ece8 : 0xd0b060, 0, d.r, 0),
    ...[-1, 1].map((e) => part(cyl(d.r * 0.92, d.r * 0.92, 0.02, 14).rotateZ(Math.PI / 2), wrapped ? 0xd8dcd8 : 0xb89848, (e * d.len) / 2 + e * 0.005, d.r, 0)),
  ];
  if (snowy) g.push(part(box(d.len * 0.9, 0.06, d.r * 0.9), SNOW, 0, d.r * 2 - 0.02, 0));
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
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

export function renderFarm(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const flat = new GeometryBuilder();
  const fields = farmFields(q);
  const cropAt = (p: GroundPatch) => fields.find((f) => Math.abs(f.rect.x - p.x) < 0.5 && Math.abs(f.rect.z - p.z) < 0.5)?.crop ?? 'corn';
  for (const p of q.dressing.ground) {
    if (p.kind === 'soil') soil(flat, p, city, snowy, cropAt(p));
    else if (p.kind === 'cattleGrid') cattleGrid(flat, p, city);
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
    else if (s.kind === 'roundBale') roundBale(s, y, snowy, solid);
    else if (s.kind === 'combine') combine(s, y, snowy, solid);
    else if (s.kind === 'headerTrailer') headerTrailer(s, y, snowy, solid);
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
  const crops = buildCrops(q, city, fields, scene, ctx.ground, snowy);
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
      if (movers) for (const v of movers()) crops.trample.stamp(v.position.x, v.position.z);
      crops.trample.update(dt);
    },
  };
}
