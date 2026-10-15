// The Old City's walls, towers and gatehouses: one merged stone mesh and one merged iron mesh per
// district (vertex colours, the landmarks' material settings, so no new shader program).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import type { District, Structure } from '../../world/districts/District';
import type { WallPiece } from '../../world/districts/OldCityWalls';
import type { DistrictRenderContext, DistrictView } from './index';

const STONE = 0xb5aa93;
const STONE_DARK = 0x8a806d;
const SLATE = 0x4f5560;
const OAK = 0x6b4a2c;
const OAK_DARK = 0x4a321d;
const IRON = 0x2e2f33;
const BANNER = [0x8e1f24, 0x1f3f7a];
const GOLD = 0xc9a23a;
const FLAME = 0xffa53a;

const MERLON = { w: 0.9, h: 0.9, d: 0.55, pitch: 1.7 };
const LIP = { out: 0.45, h: 0.25 };

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A box from (x, y0, z) up to y1, w along X and d along Z. */
const column = (w: number, d: number, x: number, y0: number, y1: number, z: number, c: number) => part(box(w, y1 - y0, d), c, x, (y0 + y1) / 2, z);

/** A thin bar from a to b. */
function bar(a: THREE.Vector3, b: THREE.Vector3, r: number, c: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 4).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return part(g, c, a.x, a.y, a.z);
}

/** Merlons along a line on top of a wall, on its outer edge. */
function merlons(ax: number, az: number, bx: number, bz: number, y: number, nx: number, nz: number, out: THREE.BufferGeometry[], offset = 0): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.floor(len / MERLON.pitch));
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) * (len / n);
    const x = ax + ux * t + nx * offset;
    const z = az + uz * t + nz * offset;
    const w = ux ? MERLON.w : MERLON.d;
    const d = uz ? MERLON.w : MERLON.d;
    out.push(column(w, d, x, y, y + MERLON.h, z, STONE));
  }
}

function wall(s: Structure, stone: THREE.BufferGeometry[]): void {
  const { nx, nz, thick, height, pieces } = s.data as { nx: number; nz: number; thick: number; height: number; pieces: WallPiece[] };
  for (const p of pieces) {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    // Centre of the strip: the wall line moved in by half the thickness.
    const x = (p.ax + p.bx) / 2 - (nx * thick) / 2;
    const z = (p.az + p.bz) / 2 - (nz * thick) / 2;
    const w = nz ? len + 0.02 : thick;
    const d = nz ? thick : len + 0.02;
    const y0 = p.y - 0.6;
    const top = p.y + height;
    stone.push(column(w, d, x, y0, top, z, STONE));
    // A darker plinth course, and the walkway lip on the inner face.
    stone.push(column(w + (nz ? 0 : 0.3), d + (nz ? 0.3 : 0), x + nx * 0.15, y0, p.y + 0.8, z + nz * 0.15, STONE_DARK));
    stone.push(column(nz ? w : LIP.out, nz ? LIP.out : d, x - nx * (thick / 2 + LIP.out / 2), top - 0.6 - LIP.h, top - 0.6, z - nz * (thick / 2 + LIP.out / 2), STONE_DARK));
    merlons(p.ax, p.az, p.bx, p.bz, top, nx, nz, stone, -MERLON.d / 2);
  }
}

function tower(s: Structure, y: number, stone: THREE.BufferGeometry[]): void {
  const { round, half, height } = s.data as { round: boolean; half: number; height: number };
  const top = y + height;
  if (round) {
    stone.push(part(new THREE.CylinderGeometry(half, half * 1.06, height + 0.6, 14), STONE, s.x, y - 0.6 + (height + 0.6) / 2, s.z));
    stone.push(part(new THREE.CylinderGeometry(half + 0.35, half + 0.35, 0.5, 14), STONE_DARK, s.x, top - 0.25, s.z));
    stone.push(part(new THREE.ConeGeometry(half + 0.6, half * 1.6, 14), SLATE, s.x, top + (half * 1.6) / 2, s.z));
  } else {
    stone.push(column(half * 2, half * 2, s.x, y - 0.6, top, s.z, STONE));
    stone.push(column(half * 2 + 0.6, half * 2 + 0.6, s.x, top - 0.5, top, s.z, STONE_DARK));
    const e = half + 0.3 - MERLON.d / 2;
    const c = [[-e, -e], [e, -e], [e, e], [-e, e]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k];
      const [bx, bz] = c[(k + 1) % 4];
      merlons(s.x + ax, s.z + az, s.x + bx, s.z + bz, top, 0, 0, stone);
    }
  }
}

function gatehouse(s: Structure, stone: THREE.BufferGeometry[], iron: THREE.BufferGeometry[], roadWidth: number): void {
  const d = s.data as {
    ax: number; az: number; nx: number; nz: number; opening: number; towerHalf: number; height: number; wallHeight: number; thick: number;
    archBottom: number; portcullisBottom: number; banners: boolean; y: number;
    chains: { from: { x: number; z: number }; to: { x: number; z: number; y: number } }[];
    torches: { x: number; z: number; y: number }[];
  };
  const { ax, az, nx, nz, y } = d;
  const top = y + d.height;
  for (const t of s.footprints) {
    stone.push(column(t.hx * 2, t.hz * 2, t.x, y - 0.6, top, t.z, STONE));
    stone.push(column(t.hx * 2 + 0.5, t.hz * 2 + 0.5, t.x, top - 0.45, top, t.z, STONE_DARK));
    const e = t.hx + 0.25 - MERLON.d / 2;
    const c = [[-e, -e], [e, -e], [e, e], [-e, e]];
    for (let k = 0; k < 4; k++) merlons(t.x + c[k][0], t.z + c[k][1], t.x + c[(k + 1) % 4][0], t.z + c[(k + 1) % 4][1], top, 0, 0, stone);
  }
  // The block over the opening: a shallow segmental arch, never lower than archBottom.
  const [t0, t1] = s.footprints;
  const cx = (t0.x + t1.x) / 2;
  const cz = (t0.z + t1.z) / 2;
  const depth = d.towerHalf * 2 - 0.4;
  const blockTop = y + d.wallHeight + 1.6;
  const slices = 9;
  const rise = 1.4;
  for (let k = 0; k < slices; k++) {
    const u = (k + 0.5) / slices - 0.5; // -0.5 … 0.5 across the opening
    const bottom = y + d.archBottom + rise * (1 - (2 * u) ** 2);
    const along = d.opening / slices + 0.02;
    const x = cx + ax * u * d.opening;
    const z = cz + az * u * d.opening;
    stone.push(column(ax ? along : depth, az ? along : depth, x, bottom, blockTop, z, k % 2 ? STONE : STONE_DARK));
  }
  merlons(cx - ax * d.opening / 2 + nx * (depth / 2 - MERLON.d / 2), cz - az * d.opening / 2 + nz * (depth / 2 - MERLON.d / 2),
    cx + ax * d.opening / 2 + nx * (depth / 2 - MERLON.d / 2), cz + az * d.opening / 2 + nz * (depth / 2 - MERLON.d / 2), blockTop, 0, 0, stone);
  // The raised portcullis in a slot on the wall line: its spikes are all that show under the arch.
  const px = s.x - nx * 0.4;
  const pz = s.z - nz * 0.4;
  const pBottom = y + d.portcullisBottom;
  const pTop = blockTop - 0.3;
  const span = roadWidth + 1;
  const bars = 11;
  for (let k = 0; k < bars; k++) {
    const u = (k / (bars - 1) - 0.5) * span;
    const x = px + ax * u;
    const z = pz + az * u;
    iron.push(column(0.14, 0.14, x, pBottom + 0.3, pTop, z, IRON));
    iron.push(part(new THREE.ConeGeometry(0.1, 0.3, 4).rotateX(Math.PI), IRON, x, pBottom + 0.15, z));
  }
  for (let r = pBottom + 0.6; r < pTop; r += 0.8) iron.push(column(ax ? span : 0.12, az ? span : 0.12, px, r, r + 0.12, pz, IRON));
  // Drawbridge chains, from the deck's outer corners up to the gatehouse face.
  for (const c of d.chains) {
    iron.push(bar(new THREE.Vector3(c.from.x, y + 0.1, c.from.z), new THREE.Vector3(c.to.x, y + c.to.y, c.to.z), 0.06, IRON));
  }
  // Torches on iron brackets.
  for (const t of d.torches) {
    iron.push(column(0.12, 0.12, t.x, y + t.y - 0.6, y + t.y, t.z, IRON));
    stone.push(part(new THREE.ConeGeometry(0.16, 0.45, 5), FLAME, t.x, y + t.y + 0.2, t.z));
  }
  // Banners hang on the outer face of the towers beside the larger gates.
  if (d.banners) {
    s.footprints.forEach((t, k) => {
      const x = t.x + nx * (t.hx + 0.06);
      const z = t.z + nz * (t.hz + 0.06);
      const w = 1.6;
      const bTop = top - 1;
      const bBottom = bTop - 4.2;
      stone.push(column(ax ? w : 0.05, az ? w : 0.05, x, bBottom, bTop, z, BANNER[k % 2]));
      stone.push(column(ax ? w * 0.5 : 0.07, az ? w * 0.5 : 0.07, x + nx * 0.02, bBottom + 1.6, bBottom + 2.6, z + nz * 0.02, GOLD));
      iron.push(column(ax ? w + 0.4 : 0.08, az ? w + 0.4 : 0.08, x, bTop, bTop + 0.08, z, IRON));
    });
  }
}

function postern(s: Structure, y: number, stone: THREE.BufferGeometry[]): void {
  const { height } = s.data as { height: number };
  for (const t of s.footprints) {
    stone.push(column(t.hx * 2, t.hz * 2, t.x, y - 0.6, y + height, t.z, STONE));
    stone.push(part(new THREE.ConeGeometry(t.hx * 1.25, 1.4, 4).rotateY(Math.PI / 4), SLATE, t.x, y + height + 0.7, t.z));
  }
}

/** Timber deck patches over the road at each gate: planks across the street. */
function decks(q: District, ground: (x: number, z: number) => number, out: THREE.BufferGeometry[]): void {
  for (const p of q.dressing.ground) {
    if (p.kind !== 'drawbridge') continue;
    const y = ground(p.x, p.z) + 0.035;
    const alongX = p.w < p.d; // planks run across the street (the long side)
    const len = alongX ? p.w : p.d;
    const n = Math.max(3, Math.round(len / 0.5));
    for (let k = 0; k < n; k++) {
      const u = ((k + 0.5) / n - 0.5) * len;
      const c = k % 3 === 2 ? OAK_DARK : OAK;
      out.push(alongX ? part(box(len / n - 0.04, 0.05, p.d), c, p.x + u, y, p.z) : part(box(p.w, 0.05, len / n - 0.04), c, p.x, y, p.z + u));
    }
  }
}

export function renderOldCity(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const stone: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  const base = (f: { x: number; z: number; hx: number; hz: number }) =>
    Math.min(ctx.ground(f.x, f.z), ctx.ground(f.x - f.hx, f.z - f.hz), ctx.ground(f.x + f.hx, f.z - f.hz), ctx.ground(f.x - f.hx, f.z + f.hz), ctx.ground(f.x + f.hx, f.z + f.hz));
  for (const s of q.dressing.structures) {
    if (s.kind === 'wall') wall(s, stone);
    else if (s.kind === 'tower') tower(s, base(s.footprints[0]), stone);
    else if (s.kind === 'gatehouse') gatehouse(s, stone, iron, city.config.roadWidth);
    else if (s.kind === 'postern') postern(s, Math.min(...s.footprints.map(base)), stone);
  }
  decks(q, ctx.ground, stone);
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, metalness: 0.6 });
  for (const [geos, mat] of [[stone, solid], [iron, metal]] as const) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return {};
}
