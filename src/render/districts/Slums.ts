// The Slums: the destroyed buildings (wall stubs, hanging slabs, rebar, the rubble heap, the KEEP
// OUT hoarding), the rusted rail overpass, the junkyard (corrugated fence, scrap heaps, magnet
// crane, crusher, tyre mountains, the BEWARE OF DOG sign), the vacant lots' rubble and weeds and
// the tent camp. Ground drapes with the city's paving settings, the set pieces merge into one mesh
// with the district structures' settings, wrecks and camp pieces are instanced with the props'
// instanced settings and tinted per instance, the boards use the facade walls' settings. No new
// shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import { GeometryBuilder } from '../../world/CityBuilder';
import type { District, GroundPatch, Structure } from '../../world/districts/District';
import { WRECK, type CampKind, type CampPiece, type CraneData, type JunkyardData, type OverpassData, type RuinData, type Wreck } from '../../world/districts/SlumsSet';
import { SLUMS_SET as SS } from '../../gameplay/balance';
import { groundBase } from '../../world/Terrain';
import type { GroundHeight } from '../../world/Terrain';
import { slumsPlate, slumsSignMaterial } from './slumsSigns';
import type { DistrictRenderContext, DistrictView } from './index';

const RUST = 0x7a4a32;
const RUST_DARK = 0x5a3626;
const CONCRETE = 0x9a968c;
const BRICK = 0x8a5040;
const WOOD = 0x7a5a3a;
const STEEL = 0x4a4e52;
const SNOW = 0xeef2f6;

type V3 = { x: number; y: number; z: number };
type Rnd = () => number;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const frameOf = (x: number, y: number, z: number, yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));

/** Seeded scatter, so a seed's ruins look the same every load (the city's data never draws from it). */
function rand(seed: number): Rnd {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** `geo` built along +Y (unit length, centred), stretched from a to b, its X kept level. */
function beam(geo: THREE.BufferGeometry, a: V3, b: V3, color: number): THREE.BufferGeometry {
  const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = d.length();
  d.normalize();
  const x = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, d);
  const m = new THREE.Matrix4().makeBasis(x, d, z).scale(new THREE.Vector3(1, len, 1));
  m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return part(geo, color).applyMatrix4(m);
}

/**
 * A heap over a rect: a flat-shaded height field `height(u, v)` (u across 0…1, v from the high
 * side to the low one), down to `lip` at its edges, each facet coloured from `palette`.
 */
function heap(r: { x: number; z: number; w: number; d: number }, n: { nx: number; nz: number }, height: (u: number, v: number) => number, lip: number, palette: number[], ground: GroundHeight, rnd: Rnd): THREE.BufferGeometry {
  const across = n.nx ? r.d : r.w, deep = n.nx ? r.w : r.d;
  const nu = Math.max(2, Math.round(across / 1.1)), nv = Math.max(2, Math.round(deep / 1.1));
  const at = (i: number, j: number): V3 => {
    const u = i / nu, v = j / nv;
    // v runs from the back (−n) to the front (+n); u along the face.
    const off = (v - 0.5) * deep, side = (u - 0.5) * across;
    const x = r.x + n.nx * off + Math.abs(n.nz) * side;
    const z = r.z + n.nz * off + Math.abs(n.nx) * side;
    const edge = i === 0 || j === 0 || i === nu || j === nv;
    const h = edge ? lip : Math.max(lip, height(u, v) + (rnd() - 0.5) * 0.5);
    return { x, y: ground(x, z) + h, z };
  };
  const grid: V3[][] = [];
  for (let i = 0; i <= nu; i++) {
    grid.push([]);
    for (let j = 0; j <= nv; j++) grid[i].push(at(i, j));
  }
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  const tri = (a: V3, b: V3, d: V3) => {
    // Wind each facet upwards.
    const ux = b.x - a.x, uz = b.z - a.z, vx = d.x - a.x, vz = d.z - a.z;
    const pts = uz * vx - ux * vz > 0 ? [a, b, d] : [a, d, b];
    c.setHex(palette[Math.floor(rnd() * palette.length)]);
    for (const p of pts) {
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
    }
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      tri(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1]);
      tri(grid[i][j], grid[i + 1][j + 1], grid[i][j + 1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// --- The destroyed building ---

function ruin(s: Structure, ground: GroundHeight, snowy: boolean, solid: THREE.BufferGeometry[], signs: THREE.BufferGeometry[], rnd: Rnd): void {
  const d = s.data as unknown as RuinData;
  const F = SS.floor;
  const brick = [BRICK, 0x7a4636, 0x8e5a48, 0x6e4a3e];
  // Wall stubs: ~1 m columns, ragged tops, window holes (sill to lintel) on every storey a window column reaches.
  for (const w of d.walls) {
    const m = frameOf(w.x, d.base, w.z, w.yaw);
    const cw = w.len / w.tops.length;
    const g: THREE.BufferGeometry[] = [];
    w.tops.forEach((top, i) => {
      const x = -w.len / 2 + cw * (i + 0.5);
      const c = brick[i % brick.length];
      const spans: [number, number][] = [];
      if (!w.holes[i]) spans.push([0, top]);
      else {
        let y = 0;
        for (let k = 0; y < top; k++) {
          const sill = k * F + 1.0, lintel = k * F + 2.3;
          spans.push([y, Math.min(top, sill)]);
          y = lintel;
        }
      }
      for (const [y0, y1] of spans) if (y1 - y0 > 0.05) g.push(part(box(cw + 0.01, y1 - y0, w.t), c, x, (y0 + y1) / 2, 0));
      // A plaster line at each storey on the inner face (the rooms that were there).
      for (let k = 1; k * F < top - 0.3; k++) g.push(part(box(cw + 0.01, 0.18, 0.03), 0xb8ae9a, x, k * F - 0.1, w.t / 2 + 0.015));
      if (snowy) g.push(part(box(cw, 0.06, w.t + 0.04), SNOW, x, top + 0.03, 0));
    });
    solid.push(...g.map((p) => p.applyMatrix4(m)));
  }
  // Slabs hanging from the back wall onto the heap; joists and rebar.
  const lift = (p: V3) => ({ x: p.x, y: d.base + p.y, z: p.z });
  for (const sl of d.slabs) solid.push(beam(box(sl.w, 1, 0.24), lift(sl.a), lift(sl.b), 0xa8a294));
  for (const b of d.bars) solid.push(b.wood ? beam(box(b.r * 2, 1, b.r * 2.6), lift(b.a), lift(b.b), 0x5a4430) : beam(cyl(b.r, b.r, 1, 4), lift(b.a), lift(b.b), 0x6a3a26));
  // The heap: tallest against the back wall, spilling down to the sidewalk.
  const top = Math.min(F * 1.4, Math.max(...d.walls.map((w) => Math.max(...w.tops))) * 0.45);
  const palette = snowy ? [SNOW, 0xd8dce0, CONCRETE, 0xe4e8ec] : [CONCRETE, 0x8e8a80, 0x8a7266, 0x86685c, 0x9e988c, 0x7e7a70];
  solid.push(heap(d.mound, d.front, (u, v) => top * Math.pow(1 - v, 1.2) * (0.75 + 0.25 * Math.sin(u * Math.PI)) + 0.3, 0.3, palette, ground, rnd));
  // Broken blocks and bricks on it.
  const n = d.front, mw = n.nx ? d.mound.d : d.mound.w, md = n.nx ? d.mound.w : d.mound.d;
  for (let k = 0; k < 14; k++) {
    const u = (rnd() - 0.5) * (mw - 1), v = rnd() * 0.8 - 0.45;
    const x = d.mound.x + n.nx * v * md + Math.abs(n.nz) * u, z = d.mound.z + n.nz * v * md + Math.abs(n.nx) * u;
    const h = top * Math.pow(0.5 - v, 1.2) * 0.85 + 0.3;
    const big = rnd() < 0.4;
    const g = big ? box(1.2 + rnd(), 0.22, 0.9 + rnd() * 0.6) : box(0.5, 0.25, 0.3);
    solid.push(part(g.rotateY(rnd() * 3).rotateX((rnd() - 0.5) * 0.6), big ? 0xa8a294 : BRICK, x, ground(x, z) + h, z));
  }
  // The hoarding: plywood on two posts, KEEP OUT facing the street.
  const h = d.hoarding;
  const y = ground(h.x, h.z);
  const m = frameOf(h.x, y, h.z, h.yaw);
  const board = [part(box(h.w, 1.9, 0.04), 0xa88a5a, 0, 1.2, 0)];
  for (const sx of [-1, 1]) board.push(part(box(0.1, 2.2, 0.1), WOOD, sx * (h.w / 2 - 0.3), 1.1, -0.08));
  solid.push(...board.map((p) => p.applyMatrix4(m)));
  signs.push(slumsPlate(h.w - 0.1, 1.8, 'keepOut').translate(0, 1.2, 0.03).applyMatrix4(m));
}

// --- The rail overpass ---

function overpass(s: Structure, snowy: boolean, out: THREE.BufferGeometry[], rnd: Rnd): void {
  const d = s.data as unknown as OverpassData;
  const g: THREE.BufferGeometry[] = [];
  const zPier = d.depth / 2 - 0.7;
  const P = SS.pier * 2;
  const len = d.span + 1.2;
  // Piers: concrete footings, riveted columns with flanged edges, a cap beam along the street.
  for (const sx of [-1, 1]) {
    const x = sx * d.half;
    for (const sz of [-1, 1]) {
      const z = sz * zPier;
      g.push(part(box(P + 0.3, 0.5, P + 0.3), CONCRETE, x, 0.25, z));
      g.push(part(box(P, d.bottom, P), RUST, x, d.bottom / 2, z));
      for (const fx of [-1, 1]) g.push(part(box(0.06, d.bottom, P + 0.12), RUST_DARK, x + fx * (P / 2 + 0.03), d.bottom / 2, z));
      // Rivet rows up the faces that look along the street.
      for (let y = 0.8; y < d.bottom - 0.2; y += 0.45) {
        for (const rx of [-0.28, 0.28]) for (const fz of [-1, 1]) g.push(part(box(0.06, 0.06, 0.04), RUST_DARK, x + rx, y, z + fz * (P / 2 + 0.02)));
      }
    }
    g.push(part(box(P + 0.2, 1.0, d.depth), RUST_DARK, x, d.bottom + 0.5, 0));
  }
  // Girders across the street: web, top and bottom flanges, stiffeners; floor beams between them.
  for (const sz of [-1, 1]) {
    const z = sz * (d.depth / 2 - 0.3);
    g.push(part(box(len, 1.4, 0.16), RUST, 0, d.bottom + 0.7, z));
    g.push(part(box(len, 0.08, 0.6), RUST_DARK, 0, d.bottom + 0.04, z));
    g.push(part(box(len, 0.08, 0.6), RUST_DARK, 0, d.bottom + 1.36, z));
    for (let x = -len / 2 + 0.6; x < len / 2; x += 1.2) g.push(part(box(0.08, 1.3, 0.5), RUST_DARK, x, d.bottom + 0.7, z));
    // Rust streaks down the outer face.
    for (let k = 0; k < 6; k++) g.push(part(box(0.12 + rnd() * 0.2, 0.5 + rnd() * 0.7, 0.01), 0x8a5030, (rnd() - 0.5) * (len - 1), d.bottom + 0.9 - rnd() * 0.3, z + sz * 0.085));
  }
  for (let x = -len / 2 + 0.5; x < len / 2; x += 1.5) g.push(part(box(0.25, 0.5, d.depth - 0.8), RUST_DARK, x, d.bottom + 0.9, 0));
  // The deck, ballast, sleepers and two rails; parapets along both edges.
  g.push(part(box(len, 0.25, d.depth), 0x5a4a40, 0, d.bottom + 1.52, 0));
  g.push(part(box(len, 0.25, 3.0), snowy ? SNOW : 0x7a7670, 0, d.bottom + 1.77, 0));
  for (let x = -len / 2 + 0.35; x < len / 2; x += 0.7) g.push(part(box(0.22, 0.12, 2.4), 0x4a3a2e, x, d.bottom + 1.95, 0));
  for (const rz of [-0.72, 0.72]) g.push(part(box(len, 0.14, 0.08), 0x8a8a88, 0, d.bottom + 2.08, rz));
  for (const sz of [-1, 1]) {
    g.push(part(box(len, 0.9, 0.1), RUST, 0, d.bottom + 2.1, sz * (d.depth / 2 - 0.05)));
    g.push(part(box(len, 0.08, 0.18), RUST_DARK, 0, d.bottom + 2.58, sz * (d.depth / 2 - 0.05)));
  }
  const m = frameOf(s.x, d.base, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
}

// --- The junkyard ---

function junkFence(s: Structure, ground: GroundHeight, solid: THREE.BufferGeometry[], signs: THREE.BufferGeometry[], rnd: Rnd): void {
  const d = s.data as unknown as JunkyardData;
  const sheets = [0x8a8e90, 0x7a5a42, 0x6a7078, 0x8a4a2e, 0x9a9a92, 0x5a6a72];
  for (const r of d.fence) {
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    const yaw = Math.atan2(-(r.b.z - r.a.z), r.b.x - r.a.x);
    const n = Math.max(1, Math.round(len / 1.2));
    const cw = len / n;
    const g: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + cw * (i + 0.5);
      const h = d.height - rnd() * 0.25;
      g.push(part(box(cw + 0.02, h, 0.05), sheets[Math.floor(rnd() * sheets.length)], x, h / 2, (i % 2) * 0.03 - 0.015));
      if (i % 2 === 0) g.push(part(box(0.09, d.height + 0.2, 0.09), STEEL, x - cw / 2, (d.height + 0.2) / 2, -0.07));
    }
    g.push(part(box(0.09, d.height + 0.2, 0.09), STEEL, len / 2, (d.height + 0.2) / 2, -0.07));
    const mx = (r.a.x + r.b.x) / 2, mz = (r.a.z + r.b.z) / 2;
    const m = frameOf(mx, ground(mx, mz) - 0.05, mz, yaw);
    solid.push(...g.map((p) => p.applyMatrix4(m)));
  }
  if (d.sign) {
    const m = frameOf(d.sign.x, ground(d.sign.x, d.sign.z), d.sign.z, d.sign.yaw);
    signs.push(slumsPlate(1.1, 0.42, 'dog').translate(0, 1.7, 0.07).applyMatrix4(m));
  }
}

/** A band of scrap along the fence: a heap of twisted metal, a fridge or two, drums. */
function junkBand(s: Structure, ground: GroundHeight, snowy: boolean, out: THREE.BufferGeometry[], rnd: Rnd): void {
  const d = s.data as { alongX: boolean; len: number; depth: number };
  const r = { x: s.x, z: s.z, w: d.alongX ? d.len : d.depth, d: d.alongX ? d.depth : d.len };
  const scrap = snowy ? [SNOW, 0xd8dce0, 0x6a6e72] : [0x6a5a4a, 0x6e5040, 0x5e5e5c, 0x76624c, 0x585250];
  // The heap's "front" is along its short side, so the height field rises to its middle.
  const n = d.alongX ? { nx: 0, nz: 1 } : { nx: 1, nz: 0 };
  out.push(heap(r, n, (u, v) => 0.4 + 2.2 * Math.sin(v * Math.PI) * (0.6 + 0.4 * Math.sin(u * Math.PI * 3 + 1)), 0.3, scrap, ground, rnd));
  for (let k = Math.round(d.len / 4); k > 0; k--) {
    const u = (rnd() - 0.5) * (d.len - 2), v = (rnd() - 0.5) * (d.depth - 2);
    const x = s.x + (d.alongX ? u : v), z = s.z + (d.alongX ? v : u);
    const y = ground(x, z);
    const roll = rnd();
    if (roll < 0.35) out.push(part(box(0.7, 1.6, 0.7).rotateZ((rnd() - 0.5) * 1.2).rotateY(rnd() * 3), 0xd8d4c8, x, y + 1.0, z)); // a fridge
    else if (roll < 0.7) out.push(part(cyl(0.3, 0.3, 0.9, 8).rotateX(rnd() < 0.5 ? Math.PI / 2 : 0).rotateY(rnd() * 3), rnd() < 0.5 ? 0x2f5f9a : RUST, x, y + 0.9, z)); // a drum
    else out.push(part(box(2.2, 0.08, 1.2).rotateX((rnd() - 0.5) * 1.4).rotateY(rnd() * 3), 0x8a8a84, x, y + 1.2, z)); // a sheet
  }
}

function magnetCrane(s: Structure, city: CityData, out: THREE.BufferGeometry[]): void {
  const d = s.data as unknown as CraneData;
  const base = groundBase(city.terrain, s.x, s.z, 3) - 0.05;
  const yaw = Math.atan2(-(d.tip.z - d.pivot.z), d.tip.x - d.pivot.x) - Math.PI / 2; // local +Z towards the tip
  const yellow = 0xc89a2a;
  const g = [
    ...[-1, 1].map((sx) => part(box(0.8, 0.9, 4.2), 0x2a2a2a, sx * 1.2, 0.45, 0)), // tracks
    part(box(2.4, 0.5, 2.6), STEEL, 0, 1.1, 0),
    part(box(2.6, 1.6, 3.2), yellow, 0, 2.15, -0.2), // the house
    part(box(1.2, 1.4, 1.2), 0x3a4a54, 0.6, 3.5, 0.6), // the cab
    part(box(2.4, 1.0, 0.8), 0x5a5a5a, 0, 2.6, -2.0), // counterweight
    part(box(0.7, 3.8, 0.7), yellow, -0.4, 4.6, 0.3), // the mast up to the boom's foot
  ];
  const m = frameOf(s.x, base, s.z, yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
  const pivot = { x: d.pivot.x, y: base + d.pivot.y, z: d.pivot.z };
  const tip = { x: d.tip.x, y: base + d.tip.y, z: d.tip.z };
  out.push(beam(box(0.6, 1, 0.6), pivot, tip, yellow));
  out.push(beam(box(0.08, 1, 0.08), { ...pivot, y: pivot.y - 1.6 }, { ...tip, y: tip.y - 0.2 }, STEEL)); // the hoist line along it
  out.push(beam(cyl(0.03, 0.03, 1, 4), { ...tip, y: tip.y - 0.3 }, { ...tip, y: base + d.magnet + 0.5 }, 0x2a2a2a)); // the cable
  out.push(part(cyl(0.95, 0.95, 0.45, 14), 0x3a3a3a, tip.x, base + d.magnet + 0.22, tip.z));
}

function crusher(s: Structure, ground: GroundHeight, out: THREE.BufferGeometry[]): void {
  const d = s.data as { len: number; depth: number };
  const yellow = 0xb8902a;
  const y = ground(s.x, s.z) - 0.05;
  const g = [
    part(box(d.len, 1.4, d.depth), yellow, 0, 0.7, 0),
    part(box(d.len * 0.6, 1.0, 0.15), RUST, -d.len * 0.15, 1.9, d.depth / 2 - 0.08), // the chamber's walls
    part(box(d.len * 0.6, 1.0, 0.15), RUST, -d.len * 0.15, 1.9, -d.depth / 2 + 0.08),
    part(box(1.6, 2.6, d.depth), yellow, d.len / 2 - 0.8, 2.7, 0), // the ram housing
    part(cyl(0.25, 0.25, d.len * 0.5, 8).rotateZ(Math.PI / 2), 0x9aa0a4, d.len * 0.05, 2.4, 0),
    part(box(1.0, 1.6, 1.0), 0x3a4a54, d.len / 2 - 0.8, 4.8, 0), // the operator's box
    part(box(1.4, 0.6, 1.2), 0x7a2a22, -d.len / 2 - 1.0, 0.3, 0), // a crushed bale out of the end
  ];
  const m = frameOf(s.x, y, s.z, s.yaw);
  out.push(...g.map((p) => p.applyMatrix4(m)));
}

function tyres(s: Structure, ground: GroundHeight, snowy: boolean, out: THREE.BufferGeometry[], rnd: Rnd): void {
  const d = s.data as { r: number; h: number };
  const y = ground(s.x, s.z) - 0.05;
  out.push(part(new THREE.ConeGeometry(d.r, d.h, 9), 0x1e1e20, s.x, y + d.h / 2, s.z));
  const tyre = () => new THREE.TorusGeometry(0.32, 0.13, 4, 8).rotateX(Math.PI / 2);
  for (let k = Math.round(d.r * 10); k > 0; k--) {
    const a = rnd() * Math.PI * 2, t = Math.sqrt(rnd());
    const rr = t * d.r * 0.92;
    const x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr;
    out.push(part(tyre().rotateX((rnd() - 0.5) * 1.2).rotateZ((rnd() - 0.5) * 1.2), rnd() < 0.1 && snowy ? SNOW : 0x262628, x, y + d.h * (1 - rr / d.r) + 0.05, z));
  }
}

/** A crushed shell, X along it, on the ground at y 0, white where the paint tints it. */
function wreckGeometry(): THREE.BufferGeometry {
  const L = WRECK.l, Wd = WRECK.w, H = WRECK.h;
  return mergeGeometries([
    part(box(L, H * 0.55, Wd), 0xffffff, 0, H * 0.275, 0),
    part(box(L * 0.5, H * 0.42, Wd * 0.86).translate(0, 0, 0), 0xe8e8e8, -L * 0.04, H * 0.76, 0), // the flattened cabin
    part(box(L * 0.52, H * 0.18, Wd * 0.88), 0x2a2e32, -L * 0.04, H * 0.72, 0), // its windows
    part(box(L * 0.3, H * 0.3, 0.02), 0x8a5a3a, L * 0.2, H * 0.3, Wd / 2 + 0.005), // rust on the side
    part(box(0.04, H * 0.3, Wd * 0.7), 0x9a9a9a, L / 2 + 0.01, H * 0.3, 0), // the bumper
    part(box(0.04, H * 0.3, Wd * 0.7), 0x9a9a9a, -L / 2 - 0.01, H * 0.3, 0),
  ]);
}

/** Wrecks in their stacks, one instanced mesh tinted per wreck. */
function wrecks(list: Wreck[], ground: GroundHeight, material: THREE.Material): THREE.InstancedMesh | null {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(wreckGeometry(), material, list.length);
  const height = new Map<string, number>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  list.forEach((w, i) => {
    const key = `${w.x.toFixed(2)},${w.z.toFixed(2)}`;
    const y = height.get(key) ?? ground(w.x, w.z) - 0.02;
    const h = WRECK.h * w.crush;
    height.set(key, y + h);
    q.setFromAxisAngle(up, w.yaw + (w.alongX ? 0 : Math.PI / 2));
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(w.x, y, w.z), q, new THREE.Vector3(1, w.crush, 1)));
    mesh.setColorAt(i, c.setHex(w.color));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// --- The tent camp ---

/** Each camp piece's model, facing +Z, on the ground at y 0, white where the instance's tint shows. */
function campModel(kind: CampKind): THREE.BufferGeometry {
  const pole = 0x8a8a8a, dark = 0x3a3a3a;
  switch (kind) {
    case 'dome':
      return mergeGeometries([
        part(new THREE.SphereGeometry(1.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1), 0xffffff),
        part(box(0.7, 0.75, 0.02), 0x4a4a4a, 0, 0.38, 1.12), // the door
      ]);
    case 'ridge':
      return mergeGeometries([
        part(cyl(0.95, 0.95, 2.3, 3).rotateX(Math.PI / 2).rotateZ(Math.PI), 0xffffff, 0, 0.48, 0),
        part(box(0.04, 1.2, 0.04), pole, 0, 0.6, 1.2),
        part(box(0.04, 1.2, 0.04), pole, 0, 0.6, -1.2),
      ]);
    case 'leanTo':
      return mergeGeometries([
        part(box(2.4, 0.03, 2.0).rotateX(0.5), 0xffffff, 0, 1.1, 0),
        ...[-1.1, 1.1].map((x) => part(box(0.06, 1.6, 0.06), pole, x, 0.8, 0.85)),
        part(box(2.0, 0.14, 1.4), 0xa88a5a, 0, 0.07, -0.1), // the pallet floor
        part(box(1.8, 0.12, 0.8), 0x5a5a6a, 0, 0.2, -0.2), // a bedroll
      ]);
    case 'cardboard':
      return mergeGeometries([
        part(box(1.8, 0.05, 0.9), 0xffffff, 0, 0.025, 0),
        part(box(0.6, 0.45, 0.5).rotateY(0.3), 0xe8e8e8, 0.5, 0.25, 0.1),
        part(box(0.5, 0.35, 0.4).rotateY(-0.4), 0xd8d8d8, -0.45, 0.18, -0.15),
      ]);
    case 'couch':
      return mergeGeometries([
        part(box(2.0, 0.45, 0.9), 0xffffff, 0, 0.3, 0),
        part(box(2.0, 0.6, 0.25), 0xe0e0e0, 0, 0.75, -0.33),
        ...[-1, 1].map((sx) => part(box(0.25, 0.65, 0.9), 0xe0e0e0, sx * 0.88, 0.45, 0)),
      ]);
    case 'fireRing': {
      const stones: THREE.BufferGeometry[] = [part(cyl(0.6, 0.6, 0.04, 10), 0x2a2826, 0, 0.02, 0)]; // ash
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        stones.push(part(new THREE.DodecahedronGeometry(0.17, 0).scale(1, 0.7, 1), 0xffffff, Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7));
      }
      stones.push(part(box(0.7, 0.08, 0.08).rotateY(0.6), 0x2a1a10, 0, 0.08, 0), part(box(0.6, 0.08, 0.08).rotateY(-0.9), 0x2a1a10, 0.05, 0.13, 0)); // charred sticks
      return mergeGeometries(stones);
    }
    case 'pallets':
      return mergeGeometries([0, 1, 2].flatMap((k) => [
        part(box(1.2, 0.03, 1.0), 0xc8a878, 0, 0.13 + k * 0.15, 0),
        ...[-0.45, 0, 0.45].map((z) => part(box(1.2, 0.1, 0.1), 0xa88a5a, 0, 0.06 + k * 0.15, z)),
      ]));
    case 'cart':
      return mergeGeometries([
        part(box(0.9, 0.55, 0.55), 0xffffff, 0, 0.75, 0),
        part(box(0.05, 0.6, 0.5), dark, -0.45, 0.35, 0),
        part(box(0.05, 0.6, 0.5), dark, 0.45, 0.35, 0),
        ...[-0.38, 0.38].flatMap((x) => [-0.22, 0.22].map((z) => part(box(0.08, 0.1, 0.03), dark, x, 0.05, z))),
        part(box(0.04, 0.04, 0.55), dark, 0.5, 1.05, 0), // the handle
      ]);
    case 'tarpWall':
      return mergeGeometries([
        part(box(1.75, 1.4, 0.03).rotateX(0.05), 0xffffff, 0, 0.85, 0),
        ...[-0.85, 0.85].map((x) => part(box(0.05, 1.7, 0.05), pole, x, 0.85, -0.05)),
      ]);
  }
}

/** The camp's pieces, one instanced mesh per kind, tinted per piece. */
function camp(pieces: CampPiece[], ground: GroundHeight, material: THREE.Material, scene: THREE.Scene): void {
  const byKind = new Map<CampKind, CampPiece[]>();
  for (const p of pieces) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  for (const [kind, list] of byKind) {
    const mesh = new THREE.InstancedMesh(campModel(kind), material, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, ground(p.x, p.z) - 0.02, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale)));
      mesh.setColorAt(i, c.setHex(p.color));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}

// --- Ground ---

/** Flecks of another colour over a patch: debris, oil, gravel. */
function flecks(flat: GeometryBuilder, p: GroundPatch, city: CityData, lift: number, per: number, size: [number, number], colours: THREE.Color[], rnd: Rnd): void {
  for (let n = Math.round((p.w * p.d) / per); n > 0; n--) {
    const w = size[0] + rnd() * (size[1] - size[0]), d = size[0] + rnd() * (size[1] - size[0]);
    const x = p.x + (rnd() - 0.5) * (p.w - w), z = p.z + (rnd() - 0.5) * (p.d - d);
    flat.drape({ x, z, w, d }, lift, colours[Math.floor(rnd() * colours.length)], city.terrain);
  }
}

function ground(flat: GeometryBuilder, p: GroundPatch, city: CityData, snowy: boolean, rnd: Rnd): void {
  const col = (hex: number) => (snowy ? new THREE.Color(hex).lerp(new THREE.Color(0xe4e8ec), 0.75) : new THREE.Color(hex));
  if (p.kind === 'rubble') {
    flat.drape(p, 0.055, col(0x7a7268), city.terrain);
    flecks(flat, p, city, 0.078, 10, [0.25, 0.8], [col(0x7e6a5e), col(0x868076), col(0x6c665c)], rnd);
  } else if (p.kind === 'weeds') {
    flat.drape(p, 0.1, col(0x5e6238), city.terrain);
  } else if (p.kind === 'campGround') {
    flat.drape(p, 0.055, col(0x6a5a44), city.terrain);
    flecks(flat, p, city, 0.078, 20, [0.4, 1.2], [col(0x76664c), col(0x5e5040)], rnd);
  } else if (p.kind === 'ruinLot') {
    flat.drape(p, 0.055, col(0x8a8478), city.terrain);
  } else if (p.kind === 'junkGround') {
    flat.drape(p, 0.055, col(0x5a5248), city.terrain);
    flecks(flat, p, city, 0.078, 24, [0.6, 2.0], [col(0x3e3832), col(0x4a443c)], rnd); // oil and mud
  }
}

export function renderSlums(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const rnd = rand(city.seed * 31 + q.bounds.x * 7 + q.bounds.z);
  const flat = new GeometryBuilder();
  for (const p of q.dressing.ground) ground(flat, p, city, snowy, rnd);
  if (flat.positions.length) {
    const mesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const solid: THREE.BufferGeometry[] = [];
  const signs: THREE.BufferGeometry[] = [];
  const instanced = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
  const stacked: Wreck[] = [];
  for (const s of q.dressing.structures) {
    if (s.kind === 'ruin') ruin(s, ctx.ground, snowy, solid, signs, rnd);
    else if (s.kind === 'overpass') overpass(s, snowy, solid, rnd);
    else if (s.kind === 'junkFence') junkFence(s, ctx.ground, solid, signs, rnd);
    else if (s.kind === 'junkBand') junkBand(s, ctx.ground, snowy, solid, rnd);
    else if (s.kind === 'magnetCrane') magnetCrane(s, city, solid);
    else if (s.kind === 'crusher') crusher(s, ctx.ground, solid);
    else if (s.kind === 'tyres') tyres(s, ctx.ground, snowy, solid, rnd);
    else if (s.kind === 'wreckStack') stacked.push(...((s.data as { wrecks: Wreck[] }).wrecks));
    else if (s.kind === 'camp') camp((s.data as { pieces: CampPiece[] }).pieces, ctx.ground, instanced, scene);
  }
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (signs.length) scene.add(new THREE.Mesh(mergeGeometries(signs), slumsSignMaterial(0.06 + ctx.lampGlow * 0.1)));
  const stack = wrecks(stacked, ctx.ground, instanced);
  if (stack) scene.add(stack);
  return {};
}
