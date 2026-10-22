// The Harbor's smaller set pieces: the terminal gate (canopy, columns, booth, lane lights, its
// name), the silo's gallery and loader tower, the yard's floodlight masts, reach stacker, straddle
// carriers, flatcars and buffer stops; the rail track, level crossings, rumble strips and
// weighbridge plates on the ground; shed numbers and the harbor office's control-room glass.
// Solids go into the district's merged structure mesh, flat pieces into its ground mesh, lettering
// and lit glass onto harborSigns plates.
import * as THREE from 'three';
import { part } from '../geometry';
import type { Building, CityData } from '../../world/CityGenerator';
import { GeometryBuilder } from '../../world/CityBuilder';
import type { District, GroundPatch, Structure } from '../../world/districts/District';
import type { GalleryData, TerminalGateData } from '../../world/districts/HarborGate';
import { FLATCAR, type StraddleData } from '../../world/districts/HarborYard';
import { controlRoom } from '../../world/districts/trims';
import { groundBase } from '../../world/Terrain';
import { onCell, SHED_NUMBERS, type HarborCell } from './harborSigns';

const WHITE = 0xe8e6e0;
const STEEL = 0x5a6168;
const DARK = 0x2a2d30;
const YELLOW = 0xe0b62a;
const RED = 0xc8302a;
const SNOW = 0xeef2f6;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const frameOf = (x: number, y: number, z: number, yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));

/** A bar between two points (world), into `out`. */
function bar(out: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, r: number, color: number): void {
  const len = a.distanceTo(b);
  const g = box(r * 2, len, r * 2).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  out.push(part(g, color, a.x, a.y, a.z));
}

/** Pieces for the merged structures mesh, and plates for the signs mesh (lettering, lit glass). */
export interface HarborPieces {
  solid: THREE.BufferGeometry[];
  signs: THREE.BufferGeometry[];
  lit: THREE.BufferGeometry[]; // glow at night (control room, lane lights)
}

/** A plate facing +Z, w × h, on a cell, in its own frame. */
const plate = (w: number, h: number, cell: HarborCell) => onCell(new THREE.PlaneGeometry(w, h), cell);
/** A box on a swatch cell (lit glass, lamps). */
const swatchBox = (w: number, h: number, d: number, cell: HarborCell) => onCell(box(w, h, d), cell, false);

function terminalGate(s: Structure, snowy: boolean, glass: HarborCell, out: HarborPieces): void {
  const d = s.data as unknown as TerminalGateData;
  const m = frameOf(s.x, d.base, s.z, s.yaw);
  const g: THREE.BufferGeometry[] = [];
  const top = d.bottom;
  for (const x of [-d.half, d.half]) {
    for (const z of [-1, 1]) {
      g.push(part(box(0.7, top, 0.7), WHITE, x, top / 2, z * (d.depth / 2 - 0.6)));
      g.push(part(box(0.74, 1.2, 0.74), YELLOW, x, 0.6, z * (d.depth / 2 - 0.6))); // a yellow guard band at the foot
    }
  }
  // The canopy: a deep fascia all round, a slab, and the underside's lights strip.
  const w = d.half * 2 + 2;
  g.push(part(box(w, 1.4, d.depth), 0x3a5a7a, 0, top + 0.7, 0));
  g.push(part(box(w + 0.2, 0.2, d.depth + 0.2), snowy ? SNOW : WHITE, 0, top + 1.5, 0));
  // The guard booth: white walls, a blue band, glass all round, a flat roof.
  const b = d.booth;
  g.push(part(box(1.5, 1.1, 1.5), WHITE, b.x, 0.55, b.z));
  g.push(part(box(1.6, 0.25, 1.6), 0x1f4f8a, b.x, 1.2, b.z));
  g.push(part(box(1.5, 0.6, 1.5), WHITE, b.x, 2.45, b.z));
  g.push(part(box(1.9, 0.15, 1.9), snowy ? SNOW : DARK, b.x, 2.8, b.z));
  // Barriers' posts by each lane's exit, out of the lanes.
  out.solid.push(...g.map((p) => p.applyMatrix4(m)));
  out.lit.push(swatchBox(1.46, 0.95, 1.46, glass).translate(b.x, 1.8, b.z).applyMatrix4(m));
  // The name on both fascias, 2 cm proud.
  for (const side of [-1, 1]) {
    const p = plate(Math.min(w - 1, 16), 1.1, 'terminal');
    if (side < 0) p.rotateY(Math.PI);
    out.signs.push(p.translate(0, top + 0.7, side * (d.depth / 2 + 0.02)).applyMatrix4(m));
  }
  // A red and a green lamp over each lane, on both faces' undersides.
  for (const x of d.lanes) {
    for (const side of [-1, 1]) {
      out.lit.push(swatchBox(0.35, 0.35, 0.2, 'red').translate(x - 0.25, top - 0.2, side * (d.depth / 2 - 0.3)).applyMatrix4(m));
      out.lit.push(swatchBox(0.35, 0.35, 0.2, 'green').translate(x + 0.25, top - 0.2, side * (d.depth / 2 - 0.3)).applyMatrix4(m));
    }
  }
}

function gallery(s: Structure, snowy: boolean, out: HarborPieces): void {
  const d = s.data as unknown as GalleryData;
  const g: THREE.BufferGeometry[] = [];
  const a = new THREE.Vector3(d.a.x, d.a.y, d.a.z), b = new THREE.Vector3(d.b.x, d.b.y, d.b.z);
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  // The enclosed conveyor: a box along the line, its roof, a truss line under it.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const tube = (geo: THREE.BufferGeometry, colour: number, dy: number) => {
    const p = part(geo, colour);
    p.applyQuaternion(q);
    p.translate(mid.x, mid.y + dy, mid.z);
    g.push(p);
  };
  tube(box(d.width, 2.2, len), 0xc8c4b8, 0);
  tube(box(d.width + 0.3, 0.2, len), snowy ? SNOW : STEEL, 1.2);
  tube(box(0.2, 0.2, len), STEEL, -1.4);
  // The loader tower: four legs, bracing, a deck, and the loading spout reaching out to sea.
  const t = d.tower;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.push(part(box(0.35, t.h, 0.35), STEEL, t.x + dx * 1.3, t.base + t.h / 2, t.z + dz * 1.3));
  }
  for (let y = 3; y < t.h; y += 3.5) g.push(part(box(2.9, 0.15, 2.9), STEEL, t.x, t.base + y, t.z));
  g.push(part(box(3.6, 2.4, 3.6), 0xc8c4b8, t.x, t.base + t.h + 1.2, t.z));
  const out2 = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  bar(g, new THREE.Vector3(t.x, t.base + t.h + 1, t.z), new THREE.Vector3(t.x + out2.x * 9, t.base + t.h - 3, t.z + out2.z * 9), 0.4, YELLOW);
  out.solid.push(...g);
}

function mast(s: Structure, y: number, out: HarborPieces): void {
  const g: THREE.BufferGeometry[] = [part(cyl(0.22, 0.45, 26, 8), 0xb8bcc0, 0, 13), part(box(1.0, 0.6, 1.0), 0x8a8f94, 0, 0.3)];
  // A ring headframe with six floodlights.
  g.push(part(new THREE.TorusGeometry(1.3, 0.08, 4, 12).rotateX(Math.PI / 2), 0x8a8f94, 0, 25.6));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.push(part(box(0.6, 0.4, 0.25).rotateY(-a), DARK, Math.cos(a) * 1.3, 25.4, Math.sin(a) * 1.3));
  }
  const m = frameOf(s.x, y, s.z, 0);
  out.solid.push(...g.map((p) => p.applyMatrix4(m)));
}

function reachStacker(s: Structure, y: number, out: HarborPieces): void {
  const g: THREE.BufferGeometry[] = [
    part(box(3.6, 1.6, 6.8), 0xe8b02a, 0, 1.6, -0.6),
    part(box(3.8, 0.9, 1.2), 0xe8b02a, 0, 1.3, -4.3), // counterweight
    part(box(1.6, 2.0, 1.8), 0x2a3a48, 0, 3.4, -1.0), // cab
    part(box(1.7, 0.15, 1.9), 0xe8b02a, 0, 4.45, -1.0),
  ];
  for (const z of [1.8, -3]) for (const x of [-1.6, 1.6]) g.push(part(cyl(0.75, 0.75, 0.7, 12).rotateZ(Math.PI / 2), DARK, x, 0.75, z));
  // The boom raised forward, the spreader hanging under its head.
  bar(g, new THREE.Vector3(0, 2.6, -3), new THREE.Vector3(0, 9.5, 4.2), 0.45, 0xe8b02a);
  g.push(part(box(2.6, 0.4, 6.2), DARK, 0, 8.6, 4.4));
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.solid.push(...g.map((p) => p.applyMatrix4(m)));
}

function straddle(s: Structure, y: number, out: HarborPieces): void {
  const d = s.data as unknown as StraddleData;
  const g: THREE.BufferGeometry[] = [];
  const off = d.gap / 2 + d.frame / 2;
  // In its frame: X along the corridor, Z across (turned below when the corridor runs along Z).
  for (const side of [-1, 1]) {
    for (const x of [-d.length / 2 + 0.4, d.length / 2 - 0.4]) g.push(part(box(0.5, d.height, 0.5), 0xd8d8d0, x, d.height / 2, side * off));
    g.push(part(box(d.length, 0.7, d.frame), 0xd8762a, 0, 0.9, side * off)); // the bogie beam and its wheels
    for (const x of [-d.length / 2 + 1, -1.2, 1.2, d.length / 2 - 1]) g.push(part(cyl(0.6, 0.6, 0.45, 10).rotateX(Math.PI / 2), DARK, x, 0.6, side * off));
    g.push(part(box(d.length, 0.9, 0.6), 0xd8762a, 0, d.height - 0.45, side * off));
  }
  for (const x of [-d.length / 2 + 0.4, d.length / 2 - 0.4]) g.push(part(box(0.7, 0.9, off * 2 + 0.6), 0xd8762a, x, d.height - 0.45, 0));
  g.push(part(box(2, 2, 2), WHITE, d.length / 2 - 1.5, d.height + 1, off)); // the driver's cab
  g.push(part(box(2.04, 0.8, 2.04), 0x2a3a48, d.length / 2 - 1.5, d.height + 1.3, off));
  const m = frameOf(s.x, y, s.z, d.alongX ? 0 : Math.PI / 2);
  out.solid.push(...g.map((p) => p.applyMatrix4(m)));
}

function flatcar(s: Structure, y: number, out: HarborPieces): void {
  const { length, width, deck } = FLATCAR;
  const g: THREE.BufferGeometry[] = [part(box(width, 0.3, length), 0x6a3a2a, 0, deck - 0.15), part(box(0.5, 0.5, length - 2), DARK, 0, deck - 0.55)];
  for (const z of [-length / 2 + 2, length / 2 - 2]) {
    g.push(part(box(2.2, 0.5, 2.6), DARK, 0, 0.55, z));
    for (const dz of [-0.8, 0.8]) for (const x of [-0.72, 0.72]) g.push(part(cyl(0.42, 0.42, 0.12, 10).rotateZ(Math.PI / 2), 0x3a3a3a, x, 0.42, z + dz));
  }
  for (const z of [-length / 2 - 0.25, length / 2 + 0.25]) g.push(part(box(0.3, 0.3, 0.5), DARK, 0, deck - 0.4, z)); // couplers
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.solid.push(...g.map((p) => p.applyMatrix4(m)));
}

function bufferStop(s: Structure, y: number, out: HarborPieces): void {
  const g = [
    part(box(2.4, 0.3, 0.6), DARK, 0, 0.6, 0),
    part(box(2.2, 0.5, 0.15), 0xf2f2ee, 0, 1.05, 0.25),
    ...[-0.55, 0, 0.55].map((x) => part(box(0.3, 0.52, 0.17), RED, x, 1.05, 0.26)),
    ...[-0.9, 0.9].map((x) => part(cyl(0.18, 0.18, 0.5, 8).rotateX(Math.PI / 2), DARK, x, 0.8, 0.5)),
  ];
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.solid.push(...g.map((p) => p.applyMatrix4(m)));
}

/** Rail on the ground, sleepers across, two rails along the rectangle's long side. */
function track(flat: GeometryBuilder, r: GroundPatch, city: CityData, onRoad: boolean): void {
  const alongX = r.w > r.d;
  const len = alongX ? r.w : r.d;
  const t = city.terrain;
  const lift = onRoad ? 0.05 : 0.075;
  if (onRoad) flat.drape(r, lift, new THREE.Color(0x8a8a84), t); // the crossing's concrete panels
  const n = Math.floor(len / 0.7);
  for (let k = 0; k < n; k++) {
    const u = -len / 2 + (k + 0.5) * (len / n);
    const sl = alongX ? { x: r.x + u, z: r.z, w: 0.24, d: 2.5 } : { x: r.x, z: r.z + u, w: 2.5, d: 0.24 };
    if (!onRoad) flat.drape(sl, lift, new THREE.Color(0x4a3a2c), t);
  }
  for (const side of [-0.72, 0.72]) {
    const rl = alongX ? { x: r.x, z: r.z + side, w: len, d: 0.09 } : { x: r.x + side, z: r.z, w: 0.09, d: len };
    flat.drape(rl, lift + 0.02, new THREE.Color(0x9aa0a6), t);
  }
}

/** Painted rumble bars across a lane: yellow and black. */
function rumble(flat: GeometryBuilder, r: GroundPatch, city: CityData): void {
  const alongX = r.w > r.d; // the bars run across the street, the strip along it
  const len = alongX ? r.w : r.d;
  const n = Math.floor(len / 0.6);
  for (let k = 0; k < n; k++) {
    const u = -len / 2 + (k + 0.5) * (len / n);
    const b = alongX ? { x: r.x + u, z: r.z, w: 0.3, d: r.d } : { x: r.x, z: r.z + u, w: r.w, d: 0.3 };
    flat.drape(b, 0.05, new THREE.Color(k % 2 ? 0x1c1c1c : 0xe0b62a), city.terrain);
  }
}

function weighbridge(flat: GeometryBuilder, r: GroundPatch, city: CityData): void {
  flat.drape(r, 0.05, new THREE.Color(0x6a7076), city.terrain);
  const alongX = r.w > r.d;
  const len = alongX ? r.w : r.d;
  for (const side of [-1, 1]) {
    const e = alongX ? { x: r.x, z: r.z + side * (r.d / 2 - 0.1), w: len, d: 0.2 } : { x: r.x + side * (r.w / 2 - 0.1), z: r.z, w: 0.2, d: len };
    flat.drape(e, 0.07, new THREE.Color(YELLOW), city.terrain);
  }
  for (let k = 1; k < 3; k++) {
    const u = -len / 2 + (len * k) / 3;
    const j = alongX ? { x: r.x + u, z: r.z, w: 0.08, d: r.d } : { x: r.x, z: r.z + u, w: r.w, d: 0.08 };
    flat.drape(j, 0.07, new THREE.Color(0x3a3d40), city.terrain);
  }
}

/** Shed numbers on the sheds' street fronts, the office's lit control room. */
function sheds(q: District, city: CityData, glass: HarborCell, out: HarborPieces): void {
  const mine = city.buildings.filter((b) => b.district === 'harbor' && q.blocks.some((k) => {
    const r = city.blocks[k].rect;
    return Math.abs(b.x - r.x) <= r.w / 2 && Math.abs(b.z - r.z) <= r.d / 2;
  }));
  let n = 0;
  const footing = (b: Building) => groundBase(city.terrain, b.x, b.z, Math.max(b.w, b.d) / 2) - 0.3;
  for (const b of mine) {
    if (b.lot === 'harborOffice') {
      const r = controlRoom(b);
      out.lit.push(swatchBox(r.w - 0.06, r.h - 1.1, r.d - 0.06, glass).translate(r.x, footing(b) + b.h + 0.6 + (r.h - 1.1) / 2, r.z));
      continue;
    }
    if (b.lot !== 'warehouse' && b.lot !== 'transitShed' && b.lot !== 'coldStore') continue;
    n++;
    const sides: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];
    const face = sides.find(([bit]) => (b.street ?? 0) & bit && !((b.open ?? 0) & bit));
    if (!face) continue;
    const [, nx, nz] = face;
    const len = nx ? b.d : b.w;
    const w = Math.min(6, len - 2);
    if (w < 3) continue;
    const p = plate(w, w / 4, `shed${((n - 1) % SHED_NUMBERS) + 1}` as HarborCell);
    p.rotateY(Math.atan2(nx, nz));
    p.translate(b.x + nx * (b.w / 2 + 0.03), footing(b) + b.h - 1.3, b.z + nz * (b.d / 2 + 0.03));
    out.signs.push(p);
  }
}

/** All of the above for a placed Harbor, into `out` and the ground builder. `night`: lit glass shows warm, else dark. */
export function harborPieces(q: District, city: CityData, ground: (x: number, z: number) => number, snowy: boolean, night: boolean, flat: GeometryBuilder, out: HarborPieces): void {
  const glass: HarborCell = night ? 'warm' : 'glass';
  const low = (s: Structure) => Math.min(...s.footprints.map((f) => ground(f.x, f.z))) - 0.05;
  for (const s of q.dressing.structures) {
    switch (s.kind) {
      case 'terminalGate': terminalGate(s, snowy, glass, out); break;
      case 'gallery': gallery(s, snowy, out); break;
      case 'mast': mast(s, low(s), out); break;
      case 'reachStacker': reachStacker(s, low(s), out); break;
      case 'straddle': straddle(s, low(s), out); break;
      case 'flatcar': flatcar(s, low(s), out); break;
      case 'bufferStop': bufferStop(s, low(s), out); break;
    }
  }
  for (const p of q.dressing.ground) {
    switch (p.kind) {
      case 'rail': track(flat, p, city, false); break;
      case 'railRoad': track(flat, p, city, true); break;
      case 'rumble': rumble(flat, p, city); break;
      case 'weighbridge': weighbridge(flat, p, city); break;
    }
  }
  sheds(q, city, glass, out);
}
