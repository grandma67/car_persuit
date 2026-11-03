// Park pieces' static dressing as one merged, vertex-coloured mesh (the quay's material settings, so
// no new program): a pond's stone rim and lily pads, a pitch's mown stripes and painted lines. The
// water itself is ShallowWaterView; reeds, benches, signs, goals, flags and the ball are props; the
// rowboat is a landmark.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ClimateName } from '../world/Climate';
import type { ParkPiece } from '../world/ParkPieces';
import { groundHeight, type Terrain } from '../world/Terrain';
import { rimPoints } from '../world/Water';
import { part } from './geometry';

const STONES = [0x8f8a80, 0x7d786f, 0xa29c90, 0x6f6b64];
const PADS = [0x3f7a34, 0x4a8a3a, 0x356a2c];
const BLOSSOM = 0xf2d0dc;

/** A pitch's mown stripes (two shades) and line paint, per climate: snow pitches get red lines. */
const PITCH: Record<ClimateName, { stripes: [number, number]; line: number }> = {
  temperate: { stripes: [0x5f9a46, 0x538c3c], line: 0xf2f2ec },
  beach: { stripes: [0x68a64c, 0x5a9842], line: 0xf2f2ec },
  desert: { stripes: [0xb89a62, 0xac8e58], line: 0xf2f2ec }, // a dirt pitch
  snow: { stripes: [0xe6ecf0, 0xdbe3e8], line: 0xc8382e },
};
const STRIPE_LIFT = 0.07; // over the park grass (0.05)
const LINE_LIFT = 0.09;
const LINE = 0.12; // line width, metres
const CELL = 2; // draped quads at most this long

/**
 * A flat quad from (u0, v0) to (u1, v1) in a pitch's frame, draped over the ground `lift` above it
 * (cut into cells so it follows the hill), as triangles with an up normal and one colour.
 */
function drapedQuad(p: ParkPiece, u0: number, v0: number, u1: number, v1: number, lift: number, color: number, terrain: Terrain): THREE.BufferGeometry {
  const pos: number[] = [];
  const nu = Math.max(1, Math.ceil(Math.abs(u1 - u0) / CELL));
  const nv = Math.max(1, Math.ceil(Math.abs(v1 - v0) / CELL));
  const at = (u: number, v: number) => {
    const x = p.alongX ? p.x + u : p.x + v;
    const z = p.alongX ? p.z + v : p.z + u;
    return [x, groundHeight(terrain, x, z) + lift, z];
  };
  for (let a = 0; a < nu; a++) {
    for (let b = 0; b < nv; b++) {
      const ua = u0 + ((u1 - u0) * a) / nu;
      const ub = u0 + ((u1 - u0) * (a + 1)) / nu;
      const va = v0 + ((v1 - v0) * b) / nv;
      const vb = v0 + ((v1 - v0) * (b + 1)) / nv;
      const q = [at(ua, va), at(ub, va), at(ub, vb), at(ua, vb)];
      for (const k of [0, 2, 1, 0, 3, 2]) pos.push(...q[k]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // Face up whichever way the frame turned the winding.
  const n = geo.getAttribute('normal');
  if (n.count && n.getY(0) < 0) {
    for (let i = 0; i < pos.length; i += 9) for (let c = 0; c < 3; c++) [pos[i + 3 + c], pos[i + 6 + c]] = [pos[i + 6 + c], pos[i + 3 + c]];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
  }
  return part(geo, color);
}

/** The pitch's ground: stripes across it, the lines on top. */
function pitchGround(p: ParkPiece, terrain: Terrain, climate: ClimateName): THREE.BufferGeometry[] {
  const L = p.length!;
  const W = p.width!;
  const { stripes, line } = PITCH[climate];
  const out: THREE.BufferGeometry[] = [];
  const bands = 10;
  for (let k = 0; k < bands; k++) {
    const u0 = -L / 2 - 1 + ((L + 2) * k) / bands;
    out.push(drapedQuad(p, u0, -W / 2 - 1, u0 + (L + 2) / bands, W / 2 + 1, STRIPE_LIFT, stripes[k % 2], terrain));
  }
  const h = LINE / 2;
  const seg = (u0: number, v0: number, u1: number, v1: number) => out.push(drapedQuad(p, u0, v0, u1, v1, LINE_LIFT, line, terrain));
  // Touchlines, goal lines, the halfway line.
  for (const s of [-1, 1]) {
    seg(-L / 2 - h, s * W / 2 - h, L / 2 + h, s * W / 2 + h);
    seg(s * L / 2 - h, -W / 2, s * L / 2 + h, W / 2);
  }
  seg(-h, -W / 2, h, W / 2);
  // Penalty boxes (14 × 7) and their spots.
  for (const s of [-1, 1]) {
    const g = s * L / 2;
    const d = g - s * 7;
    seg(Math.min(g, d), -7 - h, Math.max(g, d), -7 + h);
    seg(Math.min(g, d), 7 - h, Math.max(g, d), 7 + h);
    seg(d - h, -7, d + h, 7);
    const spot = g - s * 6;
    seg(spot - 0.11, -0.11, spot + 0.11, 0.11);
  }
  // Centre circle (r 4) as short chords, and the centre spot.
  const r = 4;
  for (let k = 0; k < 32; k++) {
    const a0 = (k / 32) * Math.PI * 2;
    const a1 = ((k + 1) / 32) * Math.PI * 2;
    const ux = (Math.cos(a0) + Math.cos(a1)) / 2 * r;
    const vx = (Math.sin(a0) + Math.sin(a1)) / 2 * r;
    const half = (Math.PI * r) / 32 + 0.02;
    // An axis-aligned dash at each chord's middle, as long as the chord, turned to it.
    const geo = drapedQuad(p, -half, -h, half, h, LINE_LIFT, line, terrain);
    // Rotate the dash about the centre spot in the ground plane, then move it out: re-drape by sampling.
    const pos = geo.getAttribute('position');
    const t = (a0 + a1) / 2 + Math.PI / 2;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) - p.x;
      const lz = pos.getZ(i) - p.z;
      let u = p.alongX ? lx : lz;
      let v = p.alongX ? lz : lx;
      [u, v] = [u * Math.cos(t) - v * Math.sin(t) + ux, u * Math.sin(t) + v * Math.cos(t) + vx];
      const x = p.alongX ? p.x + u : p.x + v;
      const z = p.alongX ? p.z + v : p.z + u;
      pos.setXYZ(i, x, groundHeight(terrain, x, z) + LINE_LIFT, z);
    }
    out.push(geo);
  }
  seg(-0.12, -0.12, 0.12, 0.12);
  return out;
}

/** Deterministic 0..1 from two numbers (looks only). */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function parkPiecesGeometry(pieces: ParkPiece[], terrain: Terrain, climate: ClimateName): THREE.BufferGeometry | null {
  const frozen = climate === 'snow';
  const parts: THREE.BufferGeometry[] = [];
  for (const p of pieces) {
    if (p.kind === 'pitch') {
      parts.push(...pitchGround(p, terrain, climate));
      continue;
    }
    if (!p.water) continue;
    const w = p.water;
    if (p.stoneRim) {
      // Rough stones laid round the edge, half on the bank.
      const n = Math.round((Math.PI * (w.rx + w.rz)) / 0.85);
      rimPoints(w, n, -0.15).forEach((q, k) => {
        const h = hash(q.x, q.z);
        const size = 0.32 + 0.18 * h;
        const geo = new THREE.DodecahedronGeometry(size, 0).scale(1.3, 0.5, 1).rotateY(h * 6.3);
        parts.push(part(geo, STONES[k % STONES.length], q.x, groundHeight(terrain, q.x, q.z) + size * 0.25, q.z));
      });
    }
    if (frozen) continue; // the pads are under the ice
    for (const pad of p.pads ?? []) {
      const y = groundHeight(terrain, pad.x, pad.z) + w.depth + 0.03;
      const leaf = new THREE.CircleGeometry(pad.r, 12, pad.yaw + 0.3, Math.PI * 2 - 0.6).rotateX(-Math.PI / 2);
      parts.push(part(leaf, PADS[Math.floor(hash(pad.x, pad.z) * PADS.length)], pad.x, y, pad.z));
      if (hash(pad.z, pad.x) < 0.3) parts.push(part(new THREE.SphereGeometry(0.11, 6, 4).scale(1, 0.6, 1), BLOSSOM, pad.x, y + 0.05, pad.z));
    }
  }
  return parts.length ? mergeGeometries(parts) : null;
}

/** Adds the dressing to the scene (nothing when there are no pieces). */
export function buildParkPieces(pieces: ParkPiece[], terrain: Terrain, scene: THREE.Scene, climate: ClimateName): void {
  const geo = parkPiecesGeometry(pieces, terrain, climate);
  if (!geo) return;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);
}
