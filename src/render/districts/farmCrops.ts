// The Farm's crops: corn as instanced row strips (alpha cut, ~2.7 m, tassels and ears in the
// texture) and wheat as instanced shell layers (~0.9 m), both on one crop material that sways in
// the wind and reads a trample texture over the district: where a car has been, stalks bend over
// and break off. Cars stamp the texture as they drive through the fields. One shader program for
// both crops; no shadows (the alpha cut would be lost in the shadow pass).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FARM } from '../../gameplay/balance';
import type { CityData, Rect } from '../../world/CityGenerator';
import type { District } from '../../world/districts/District';
import type { Field } from '../../world/districts/Farm';
import { footprintsOverlap, type Footprint } from '../../world/StreetProps';
import type { GroundHeight } from '../../world/Terrain';

const CORN_HEIGHT = 2.7;
const CORN_SEGMENT = 3; // one strip along a row
const ROW = 0.75; // between rows
const WHEAT_HEIGHT = 0.9;
const WHEAT_LAYERS = 9;
const WHEAT_CELL = 3; // shell grid, metres (the trample is read per vertex)
const WHEAT_SHELLS = Array.from({ length: WHEAT_LAYERS }, (_, l) => 0.08 + (WHEAT_HEIGHT * (l + 1)) / WHEAT_LAYERS);
/** The corn's leafy canopy seen from above (row strips go edge-on), as a few shells. */
const CORN_CANOPY = [1.5, 1.95, 2.4];
const STAMP = 1.4; // a car flattens a disc this wide, metres (radius)

/** The trample map over the district's bounds: 0 standing … 255 flattened. Per run, never saved. */
export class Trample {
  readonly texture: THREE.DataTexture;
  readonly rect: THREE.Vector4; // x0, z0, w, d
  private data: Uint8Array;
  private w: number;
  private h: number;
  private dirty = false;
  private since = 0;

  constructor(bounds: Rect, private fields: Rect[], blockSize: number) {
    const perMetre = FARM.trampleRes / blockSize;
    this.w = Math.max(4, Math.round(bounds.w * perMetre));
    this.h = Math.max(4, Math.round(bounds.d * perMetre));
    this.data = new Uint8Array(this.w * this.h);
    this.texture = new THREE.DataTexture(this.data, this.w, this.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.rect = new THREE.Vector4(bounds.x - bounds.w / 2, bounds.z - bounds.d / 2, bounds.w, bounds.d);
  }

  /** Flatten the crop under a car at (x, z). */
  stamp(x: number, z: number): void {
    if (!this.fields.some((f) => Math.abs(x - f.x) <= f.w / 2 + STAMP && Math.abs(z - f.z) <= f.d / 2 + STAMP)) return;
    const u = ((x - this.rect.x) / this.rect.z) * this.w, v = ((z - this.rect.y) / this.rect.w) * this.h;
    const r = (STAMP / this.rect.z) * this.w;
    for (let j = Math.floor(v - r); j <= Math.ceil(v + r); j++) {
      for (let i = Math.floor(u - r); i <= Math.ceil(u + r); i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const d = Math.hypot(i + 0.5 - u, j + 0.5 - v) / r;
        if (d > 1) continue;
        const k = j * this.w + i;
        const val = Math.round(255 * Math.min(1, 1.6 - d));
        if (val > this.data[k]) {
          this.data[k] = val;
          this.dirty = true;
        }
      }
    }
  }

  /** Upload the changes now and then (a few times a second is plenty). */
  update(dt: number): void {
    this.since += dt;
    if (this.dirty && this.since > 0.1) {
      this.texture.needsUpdate = true;
      this.dirty = false;
      this.since = 0;
    }
  }

  /** How flattened the crop is at (x, z), 0..1 (tests and debug). */
  at(x: number, z: number): number {
    const i = Math.floor(((x - this.rect.x) / this.rect.z) * this.w), j = Math.floor(((z - this.rect.y) / this.rect.w) * this.h);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? 0 : this.data[j * this.w + i] / 255;
  }
}

/** Shared uniforms: the trample map and the wind clock. */
export interface CropUniforms {
  uTrample: { value: THREE.Texture };
  uRect: { value: THREE.Vector4 };
  uTime: { value: number };
}

/**
 * The crop material: Lambert with a map, double-sided, its vertices swayed by the wind and bent
 * over by the trample map, its fragments cut by alpha (a cut that rises with height for the wheat's
 * shells, so the stalks taper) and broken off where trampled.
 */
function cropMaterial(map: THREE.Texture, color: number, shared: CropUniforms, opts: { sway: number; cut: number; cutRise: number; height: number; bend: number; thin?: number }): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, color, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, {
      uSway: { value: opts.sway }, uCut: { value: opts.cut }, uCutRise: { value: opts.cutRise }, uHeight: { value: opts.height }, uBend: { value: opts.bend }, uThin: { value: opts.thin ?? 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uTrample;
uniform vec4 uRect;
uniform float uTime, uSway, uHeight, uBend, uThin;
attribute float aH;
varying float vH;
varying float vTrample;
varying float vCropDist;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vCropDist = -mvPosition.z;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
// Far off, some strips go (the rest still read as a field): collapsed to nothing.
vec3 cropAt = (modelMatrix * instanceMatrix[3]).xyz;
float cropHash = fract(sin(dot(cropAt.xz, vec2(12.9898, 78.233))) * 43758.5453);
if (cropHash < uThin * smoothstep(90.0, 170.0, distance(cropAt, cameraPosition))) transformed = vec3(0.0);
vec4 cropWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
float cropT = texture2D(uTrample, (cropWorld.xz - uRect.xy) / uRect.zw).r;
float cropK = aH / uHeight;
transformed.x += sin(uTime * 1.6 + cropWorld.x * 0.31 + cropWorld.z * 0.17) * uSway * cropK * cropK * (1.0 - cropT);
transformed.z += cropT * aH * uBend; // bent over, away from the row
transformed.y -= cropT * aH * 0.82;
vH = cropK;
vTrample = cropT;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCut, uCutRise;
varying float vH;
varying float vTrample;
varying float vCropDist;`)
      .replace('#include <alphatest_fragment>', `// Far off, the mipmaps average the alpha down: lower the cut so the crop doesn't thin away.
float cropCut = (uCut + vH * uCutRise) * clamp(1.0 - (vCropDist - 25.0) / 140.0, 0.35, 1.0);
if (diffuseColor.a < cropCut || (vTrample > 0.55 && vH > 0.3)) discard;
diffuseColor.rgb *= 0.62 + 0.38 * vH;`);
  };
  m.customProgramCacheKey = () => 'farmCrop';
  return m;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Corn: ten stalks across one strip, leaves arching off them, tassels on top, an ear or two each. */
function cornTexture(dry: boolean): THREE.Texture {
  const [c, g] = canvas(512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stem = dry ? '#a89060' : '#4f7a2e';
  const leaf = dry ? '#b8a070' : '#5e8f34';
  for (let k = 0; k < 10; k++) {
    const x = 26 + k * 51 + (rnd() - 0.5) * 14;
    const top = 30 + rnd() * 40;
    g.strokeStyle = stem;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(x, 512);
    g.lineTo(x + (rnd() - 0.5) * 8, top);
    g.stroke();
    // Leaves: long arcs off alternate sides, drooping at the tips.
    for (let y = 470; y > top + 60; y -= 48 + rnd() * 20) {
      const side = (y / 48) % 2 < 1 ? -1 : 1;
      g.strokeStyle = leaf;
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + side * 40, y - 50, x + side * (60 + rnd() * 20), y - 10 + rnd() * 30);
      g.stroke();
    }
    // The tassel: thin spikes fanning up.
    g.strokeStyle = dry ? '#c8b080' : '#c8a850';
    g.lineWidth = 2;
    for (let s = -3; s <= 3; s++) {
      g.beginPath();
      g.moveTo(x, top + 6);
      g.lineTo(x + s * 6, top - 26 + Math.abs(s) * 5);
      g.stroke();
    }
    // An ear in its husk part way up, its silk at the tip.
    const ey = 250 + rnd() * 70;
    g.fillStyle = dry ? '#a89058' : '#8aa848';
    g.beginPath();
    g.ellipse(x + 9, ey, 7, 26, 0.25, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = dry ? '#d8c890' : '#e8d070';
    g.beginPath();
    g.ellipse(x + 11, ey - 4, 4, 15, 0.25, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Wheat shells: dense dots (stalk sections), their alpha a random cut-off height each. */
function wheatTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 2600; k++) {
    const x = Math.floor(rnd() * 256), y = Math.floor(rnd() * 256);
    const a = 90 + Math.floor(rnd() * 165); // how high this stalk reaches
    const gold = 0.85 + rnd() * 0.3;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = (((y + dy) & 255) * 256 + ((x + dx) & 255)) * 4;
      img.data[i] = Math.min(255, 228 * gold);
      img.data[i + 1] = Math.min(255, 186 * gold);
      img.data[i + 2] = Math.min(255, 96 * gold);
      img.data[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  return t;
}

/** The corn canopy from above: leaf blades in rows' worth of green, gaps between. */
function canopyTexture(dry: boolean): THREE.Texture {
  const [c, g] = canvas(256, 256);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 260; k++) {
    const x = rnd() * 256, y = rnd() * 256, a = rnd() * Math.PI;
    const tone = 0.8 + rnd() * 0.35;
    g.strokeStyle = dry ? `rgb(${Math.round(176 * tone)},${Math.round(156 * tone)},${Math.round(104 * tone)})` : `rgb(${Math.round(86 * tone)},${Math.round(138 * tone)},${Math.round(48 * tone)})`;
    g.lineWidth = 3 + rnd() * 3;
    g.beginPath();
    g.moveTo(x - Math.cos(a) * 18, y - Math.sin(a) * 18);
    g.quadraticCurveTo(x, y + 6, x + Math.cos(a) * 18, y + Math.sin(a) * 18);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A corn strip: CORN_SEGMENT long along local X, CORN_HEIGHT tall, subdivided so it bends. */
function cornStrip(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(CORN_SEGMENT, CORN_HEIGHT, 3, 4).translate(0, CORN_HEIGHT / 2, 0);
  const pos = geo.attributes.position;
  geo.setAttribute('aH', new THREE.BufferAttribute(Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i)), 1));
  return geo;
}

/** Shells over a field: draped grids at `heights`, world UVs (`tile` metres), `aH` the layer's height. */
function shells(r: Rect, ground: GroundHeight, heights: number[], tile: number): THREE.BufferGeometry {
  const nx = Math.max(1, Math.round(r.w / WHEAT_CELL)), nz = Math.max(1, Math.round(r.d / WHEAT_CELL));
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], hs: number[] = [], idx: number[] = [];
  for (const h of heights) {
    const base = pos.length / 3;
    for (let b = 0; b <= nz; b++) {
      for (let a = 0; a <= nx; a++) {
        const x = r.x - r.w / 2 + (r.w * a) / nx, z = r.z - r.d / 2 + (r.d * b) / nz;
        pos.push(x, ground(x, z) + h, z);
        uv.push(x / tile, z / tile);
        nrm.push(0, 1, 0);
        hs.push(h);
      }
    }
    for (let b = 0; b < nz; b++) {
      for (let a = 0; a < nx; a++) {
        const i0 = base + b * (nx + 1) + a, i1 = i0 + 1, i2 = i0 + nx + 1, i3 = i2 + 1;
        idx.push(i0, i2, i1, i1, i2, i3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(hs, 1));
  geo.setIndex(idx);
  return geo;
}

/** Drop the shell triangles over a maze's paths. */
function cutPaths(geo: THREE.BufferGeometry, paths: Rect[]): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const idx = geo.index!.array;
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    let x = 0, z = 0;
    for (let k = 0; k < 3; k++) (x += pos.getX(idx[t + k]) / 3), (z += pos.getZ(idx[t + k]) / 3);
    if (!paths.some((p) => Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  geo.setIndex(keep);
  return geo;
}

/**
 * Corn and wheat for every field that grows them. Corn strips skip a maze's paths and anything
 * solid standing in the field; past FARM.maxCrop strips, every other row goes.
 */
/** How the crops look in a climate: dry stalks in the snow; tints (multiplying the textures) for corn and wheat. */
export interface CropLook {
  dry: boolean;
  corn: number;
  wheat: number;
}

export function buildCrops(q: District, city: CityData, fields: Field[], scene: THREE.Scene, ground: GroundHeight, look: CropLook): { trample: Trample; uniforms: CropUniforms } {
  const dry = look.dry;
  const trample = new Trample(q.bounds, fields.filter((f) => f.crop === 'corn' || f.crop === 'wheat').map((f) => f.rect), city.config.blockSize);
  const uniforms: CropUniforms = { uTrample: { value: trample.texture }, uRect: { value: trample.rect }, uTime: { value: 0 } };
  const blockers: Footprint[] = [
    ...q.dressing.solids,
    ...q.dressing.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 })),
  ];
  // Corn strips: row by row along each corn field.
  const strips: THREE.Matrix4[][] = [];
  for (const f of fields) {
    if (f.crop !== 'corn') continue;
    const rows: THREE.Matrix4[] = [];
    const along = f.rowsAlongX ? f.rect.w : f.rect.d, across = f.rowsAlongX ? f.rect.d : f.rect.w;
    const nRows = Math.floor((across - 1) / ROW), nSeg = Math.floor((along - 1) / CORN_SEGMENT);
    const q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let r = 0; r < nRows; r++) {
      const c = -across / 2 + 0.5 + (r + 0.5) * ((across - 1) / nRows);
      for (let s = 0; s < nSeg; s++) {
        const a = -along / 2 + 0.5 + (s + 0.5) * ((along - 1) / nSeg);
        const x = f.rect.x + (f.rowsAlongX ? a : c), z = f.rect.z + (f.rowsAlongX ? c : a);
        const fp: Footprint = { x, z, hx: f.rowsAlongX ? CORN_SEGMENT / 2 : 0.3, hz: f.rowsAlongX ? 0.3 : CORN_SEGMENT / 2, yaw: 0 };
        if (f.maze?.some((p) => Math.abs(x - p.x) < p.w / 2 + 0.3 && Math.abs(z - p.z) < p.d / 2 + 0.3)) continue;
        if (blockers.some((b) => footprintsOverlap(fp, b))) continue;
        const yaw = (f.rowsAlongX ? 0 : Math.PI / 2) + (((r * 7 + s * 13) % 11) / 11 - 0.5) * 0.18;
        const scale = 0.92 + (((r * 5 + s * 3) % 7) / 7) * 0.16;
        rows.push(new THREE.Matrix4().compose(new THREE.Vector3(x, ground(x, z) - 0.05, z), q4.setFromAxisAngle(up, yaw), new THREE.Vector3(1, scale, 1)));
      }
    }
    strips.push(rows);
  }
  let all = strips.flat();
  if (all.length > FARM.maxCrop) all = all.filter((_, i) => i % Math.ceil(all.length / FARM.maxCrop) === 0);
  if (all.length) {
    const mat = cropMaterial(cornTexture(dry), look.corn, uniforms, { sway: 0.12, cut: 0.5, cutRise: 0, height: CORN_HEIGHT, bend: 0.5, thin: 1 });
    const mesh = new THREE.InstancedMesh(cornStrip(), mat, all.length);
    all.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    scene.add(mesh);
    // The canopy over each corn field (a maze's paths show through it: the canopy's cut there).
    const leaves = cropMaterial(canopyTexture(dry), look.corn, uniforms, { sway: 0.08, cut: 0.5, cutRise: 0, height: CORN_HEIGHT, bend: 0.3 });
    const canopies = fields.filter((f) => f.crop === 'corn').map((f) => {
      const geo = shells(f.rect, ground, CORN_CANOPY, 2.2);
      return f.maze ? cutPaths(geo, f.maze) : geo;
    });
    const canopy = new THREE.InstancedMesh(mergeGeometries(canopies), leaves, 1);
    canopy.setMatrixAt(0, new THREE.Matrix4());
    canopy.computeBoundingSphere();
    canopy.receiveShadow = true;
    scene.add(canopy);
  }
  // Wheat: every field's shells in one mesh, drawn as a single instance (the corn's program).
  const wheat = fields.filter((f) => f.crop === 'wheat');
  if (wheat.length) {
    const mat = cropMaterial(wheatTexture(), look.wheat, uniforms, { sway: 0.06, cut: 0.35, cutRise: 0.6, height: WHEAT_HEIGHT + 0.08, bend: 0.2 });
    const mesh = new THREE.InstancedMesh(mergeGeometries(wheat.map((f) => shells(f.rect, ground, WHEAT_SHELLS, 1.6))), mat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { trample, uniforms };
}
