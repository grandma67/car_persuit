// Park pieces' static dressing as one merged, vertex-coloured mesh (the quay's material settings, so
// no new program): a pond's stone rim and its lily pads. The water itself is ShallowWaterView; the
// reeds, benches and sign are props; the rowboat is a landmark.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParkPiece } from '../world/ParkPieces';
import { groundHeight, type Terrain } from '../world/Terrain';
import { rimPoints } from '../world/Water';
import { part } from './geometry';

const STONES = [0x8f8a80, 0x7d786f, 0xa29c90, 0x6f6b64];
const PADS = [0x3f7a34, 0x4a8a3a, 0x356a2c];
const BLOSSOM = 0xf2d0dc;

/** Deterministic 0..1 from two numbers (looks only). */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function parkPiecesGeometry(pieces: ParkPiece[], terrain: Terrain, frozen: boolean): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const p of pieces) {
    if (p.kind !== 'pond' || !p.water) continue;
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
export function buildParkPieces(pieces: ParkPiece[], terrain: Terrain, scene: THREE.Scene, frozen: boolean): void {
  const geo = parkPiecesGeometry(pieces, terrain, frozen);
  if (!geo) return;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);
}
