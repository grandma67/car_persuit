// The Old City's walls, towers and gatehouses: one merged stone mesh and one merged iron mesh per
// district (vertex colours, the landmarks' material settings, so no new shader program).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import type { District, Structure } from '../../world/districts/District';
import type { WallPiece } from '../../world/districts/OldCityWalls';
import { clockTowerFrame } from '../../world/districts/trims';
import { inRect } from '../../world/lots';
import { groundBase } from '../../world/Terrain';
import { OLD_CITY } from '../../gameplay/balance';
import type { DistrictRenderContext, DistrictView } from './index';

// The walls' stone by climate (set per district in renderOldCity): grey limestone, sandstone in
// the desert, limewashed by the sea.
const STONES: Record<string, [number, number]> = { temperate: [0xb5aa93, 0x8a806d], snow: [0xa9a397, 0x7f7a70], desert: [0xd2ae78, 0xa8885a], beach: [0xe6e0d2, 0xb8ae9c] };
let STONE = 0xb5aa93;
let STONE_DARK = 0x8a806d;
let SNOWY = false;
const SNOW = 0xeef2f6;
const SLATE = 0x4f5560;
const OAK = 0x6b4a2c;
const OAK_DARK = 0x4a321d;
const IRON = 0x2e2f33;
const BANNER = [0x8e1f24, 0x1f3f7a];
const GOLD = 0xc9a23a;

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
    if (SNOWY) stone.push(column(w + 0.04, d + 0.04, x, top, top + 0.12, z, SNOW)); // snow on the walkway
  }
}

function tower(s: Structure, y: number, stone: THREE.BufferGeometry[]): void {
  const { round, half, height } = s.data as { round: boolean; half: number; height: number };
  const top = y + height;
  if (round) {
    stone.push(part(new THREE.CylinderGeometry(half, half * 1.06, height + 0.6, 14), STONE, s.x, y - 0.6 + (height + 0.6) / 2, s.z));
    stone.push(part(new THREE.CylinderGeometry(half + 0.35, half + 0.35, 0.5, 14), STONE_DARK, s.x, top - 0.25, s.z));
    stone.push(part(new THREE.ConeGeometry(half + 0.6, half * 1.6, 14), SNOWY ? SNOW : SLATE, s.x, top + (half * 1.6) / 2, s.z));
  } else {
    stone.push(column(half * 2, half * 2, s.x, y - 0.6, top, s.z, STONE));
    stone.push(column(half * 2 + 0.6, half * 2 + 0.6, s.x, top - 0.5, top, s.z, STONE_DARK));
    if (SNOWY) stone.push(column(half * 2 + 0.5, half * 2 + 0.5, s.x, top, top + 0.15, s.z, SNOW));
    const e = half + 0.3 - MERLON.d / 2;
    const c = [[-e, -e], [e, -e], [e, e], [-e, e]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k];
      const [bx, bz] = c[(k + 1) % 4];
      merlons(s.x + ax, s.z + az, s.x + bx, s.z + bz, top, 0, 0, stone);
    }
  }
}

function gatehouse(s: Structure, stone: THREE.BufferGeometry[], iron: THREE.BufferGeometry[], roadWidth: number, flames: THREE.Vector3[]): void {
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
    if (SNOWY) stone.push(column(t.hx * 2 + 0.4, t.hz * 2 + 0.4, t.x, top, top + 0.15, t.z, SNOW));
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
    stone.push(part(new THREE.CylinderGeometry(0.14, 0.08, 0.3, 5), IRON, t.x, y + t.y + 0.05, t.z)); // the cup
    flames.push(new THREE.Vector3(t.x, y + t.y + 0.38, t.z));
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

/**
 * Cobbled setts over a rectangle, in rows of slightly varied stone, following the ground. Streets
 * (`along` set) run their rows across the road and have a darker gutter down the middle.
 */
function setts(r: { x: number; z: number; w: number; d: number }, lift: number, along: 'x' | 'z' | null, ground: (x: number, z: number) => number, pos: number[], col: number[], seed: number): void {
  const size = 1.0;
  const c = new THREE.Color();
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Work in (u across rows, v along rows); rows run across a street.
  const alongX = along === 'x';
  const [U, V] = alongX ? [r.w, r.d] : [r.d, r.w];
  const rows = Math.floor(U / size);
  const per = Math.floor(V / size);
  for (let j = 0; j < rows; j++) {
    const shift = (j % 2) * size * 0.5;
    for (let i = 0; i <= per; i++) {
      const v0 = Math.max(-V / 2, -V / 2 + i * size - shift) + 0.05;
      const v1 = Math.min(V / 2, -V / 2 + (i + 1) * size - shift) - 0.05;
      if (v1 - v0 < 0.2) continue;
      const u0 = -U / 2 + j * size + 0.05;
      const u1 = u0 + size - 0.1;
      const gutter = along && Math.abs((v0 + v1) / 2) < 0.6;
      c.setHex(STONE_DARK).lerp(new THREE.Color(STONE), gutter ? 0 : rand() * 0.8).multiplyScalar(gutter ? 0.6 : 0.78 + rand() * 0.15);
      const P = (u: number, v: number) => (alongX ? [r.x + u, r.z + v] : [r.x + v, r.z + u]);
      // Counter-clockwise from above whichever way the street runs.
      const quad = alongX ? [P(u0, v1), P(u1, v1), P(u1, v0), P(u0, v0)] : [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, z] = quad[k];
        pos.push(x, ground(x, z) + lift, z);
        col.push(c.r, c.g, c.b);
      }
    }
  }
}

/** The square's cobbles, and the interior streets and junctions cobbled with a gutter. */
function cobbles(q: District, city: CityData, ground: (x: number, z: number) => number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col: number[] = [];
  for (const p of q.dressing.ground) if (p.kind === 'cobbles') setts(p, 0.07, null, ground, pos, col, 1);
  // Under the road markings (0.02 up), over the asphalt.
  const inner = new Set(q.interior);
  for (const road of city.roads) {
    if (!q.streets.has(`${road.a}>${road.b}`)) continue;
    setts(road.rect, 0.012, road.rect.w > road.rect.d ? 'x' : 'z', ground, pos, col, road.a * 31 + road.b);
  }
  for (const id of inner) {
    const n = city.graph.nodes[id];
    const box = city.intersections.find((r) => Math.abs(r.x - n.x) < 0.5 && Math.abs(r.z - n.z) < 0.5);
    if (box) setts(box, 0.012, null, ground, pos, col, id + 7);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A ruin: a shell of broken walls round its lot, jagged on top, with a fallen block or two. */
function ruin(s: Structure, y: number, stone: THREE.BufferGeometry[]): void {
  const { w, d, h, heights } = s.data as { w: number; d: number; h: number; heights: number[] };
  const t = 0.7;
  const x0 = s.x - w / 2 + t / 2, x1 = s.x + w / 2 - t / 2, z0 = s.z - d / 2 + t / 2, z1 = s.z + d / 2 - t / 2;
  const sides: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  const per = Math.floor(heights.length / 4);
  sides.forEach(([ax, az, bx, bz], side) => {
    for (let k = 0; k < per; k++) {
      const hk = h * heights[side * per + k];
      if (hk < 0.5) continue;
      const u0 = k / per, u1 = (k + 1) / per;
      const x = ax + (bx - ax) * (u0 + u1) / 2, z = az + (bz - az) * (u0 + u1) / 2;
      const len = Math.hypot(bx - ax, bz - az) / per + 0.02;
      const alongX = az === bz;
      stone.push(column(alongX ? len : t, alongX ? t : len, x, y - 0.3, y + hk, z, (side + k) % 3 ? STONE : STONE_DARK));
    }
  });
  stone.push(part(box(1.2, 0.7, 0.8).rotateY(0.5), STONE_DARK, s.x + w * 0.15, y + 0.3, s.z - d * 0.1));
  stone.push(part(box(0.9, 0.5, 1.4).rotateY(-0.3), STONE, s.x - w * 0.2, y + 0.2, s.z + d * 0.18));
}

/** The town hall's four clock faces, with hands that follow the game clock and strike the hour. */
function clock(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext, stone: THREE.BufferGeometry[], metal: THREE.Material): DistrictView {
  const hall = city.buildings.find((b) => b.district === 'oldtown' && b.lot === 'townHall' && inRect(q.bounds, b));
  if (!hall) return {};
  const y0 = groundBase(city.terrain, hall.x, hall.z, Math.max(hall.w, hall.d) / 2) - 0.3; // as CityBuilder stands it
  const t = clockTowerFrame(hall, 'hip');
  const faces = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const frames = faces.map(([nx, nz]) => {
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(nx, nz));
    m.setPosition(t.x + nx * (t.half + 0.04), y0 + t.dialY, t.z + nz * (t.half + 0.04));
    return m;
  });
  // Dials: a white face in a dark ring with hour marks, merged with the stone.
  for (const m of frames) {
    const dial = [
      part(new THREE.CircleGeometry(t.dialR, 20), 0xf2ecdc),
      part(new THREE.RingGeometry(t.dialR, t.dialR + 0.18, 20), 0x2a2a2e, 0, 0, 0.005),
      ...Array.from({ length: 12 }, (_, k) => {
        const a = (k / 12) * Math.PI * 2;
        return part(new THREE.PlaneGeometry(k % 3 ? 0.06 : 0.12, 0.28).rotateZ(-a), 0x2a2a2e, Math.sin(a) * t.dialR * 0.82, Math.cos(a) * t.dialR * 0.82, 0.01);
      }),
    ].map((g) => g.applyMatrix4(m));
    stone.push(...dial);
  }
  // Hands: instanced (four faces each), pivoting at the dial's centre and pointing up at 12.
  const hand = (length: number, width: number) => {
    const g = part(new THREE.BoxGeometry(width, length, 0.04).translate(0, length / 2 - 0.15, 0.03), 0x1c1c20);
    const mesh = new THREE.InstancedMesh(g, metal, 4);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    return mesh;
  };
  const hourHand = hand(t.dialR * 0.55, 0.16);
  const minuteHand = hand(t.dialR * 0.85, 0.1);
  const turn = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  let lastHour = Math.floor(ctx.hour0);
  const at = new THREE.Vector3(t.x, y0 + t.dialY, t.z);
  const set = (hours: number) => {
    for (const [mesh, angle] of [[hourHand, ((hours % 12) / 12) * Math.PI * 2], [minuteHand, (hours % 1) * Math.PI * 2]] as const) {
      turn.makeRotationZ(-angle);
      frames.forEach((m, k) => mesh.setMatrixAt(k, out.multiplyMatrices(m, turn)));
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  set(ctx.hour0);
  return {
    update(_dt, time) {
      const hours = ctx.hour0 + time / 3600;
      set(hours);
      const h = Math.floor(hours);
      if (h !== lastHour) {
        lastHour = h;
        ctx.bell?.(((h + 11) % 12) + 1, at);
      }
    },
  };
}

export function renderOldCity(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  [STONE, STONE_DARK] = STONES[ctx.climate.name] ?? STONES.temperate;
  SNOWY = ctx.climate.snowRoofs;
  const stone: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  const flames: THREE.Vector3[] = [];
  const base = (f: { x: number; z: number; hx: number; hz: number }) =>
    Math.min(ctx.ground(f.x, f.z), ctx.ground(f.x - f.hx, f.z - f.hz), ctx.ground(f.x + f.hx, f.z - f.hz), ctx.ground(f.x - f.hx, f.z + f.hz), ctx.ground(f.x + f.hx, f.z + f.hz));
  for (const s of q.dressing.structures) {
    if (s.kind === 'wall') wall(s, stone);
    else if (s.kind === 'tower') tower(s, base(s.footprints[0]), stone);
    else if (s.kind === 'gatehouse') gatehouse(s, stone, iron, city.config.roadWidth, flames);
    else if (s.kind === 'postern') postern(s, Math.min(...s.footprints.map(base)), stone);
    else if (s.kind === 'ruin') ruin(s, base(s.footprints[0]), stone);
  }
  decks(q, ctx.ground, stone);
  const paving = cobbles(q, city, ctx.ground);
  if (paving) stone.push(paving);
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, metalness: 0.6 });
  const view = clock(q, city, scene, ctx, stone, metal);
  for (const [geos, mat] of [[stone, solid], [iron, metal]] as const) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  torches(flames, scene, ctx.lampGlow);
  return view;
}

/**
 * Torch flames: unlit and tone-map free, so they glow (the same instanced material as the street
 * lamps' bulbs: no new shader); dim orange by day, bright at night, within OLD_CITY.maxGlow.
 */
function torches(flames: THREE.Vector3[], scene: THREE.Scene, lampGlow: number): void {
  const count = Math.min(flames.length, OLD_CITY.maxTorches);
  if (!count) return;
  const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.15, 0.45, 5).translate(0, 0.1, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), count);
  const day = new THREE.Color(0xc8742a);
  const night = new THREE.Color(0xffc060).multiplyScalar(1.6);
  const color = day.lerp(night, lampGlow);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, m.makeTranslation(flames[i].x, flames[i].y, flames[i].z));
    mesh.setColorAt(i, color);
  }
  scene.add(mesh);
}
