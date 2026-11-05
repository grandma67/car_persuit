// Shallow water on land (`world/Water.ts`) as one merged mesh: a polar grid per pond whose surface
// follows the ground, rising from the rim to its depth over `WATER.shoreRamp`. Unfrozen it is the
// canal water's shader in pond mode (no new program; uv.x = metres from the shore); in the snow
// it is ice, a plain standard material.
import * as THREE from 'three';
import { WATER } from '../gameplay/balance';
import { groundHeight, type Terrain } from '../world/Terrain';
import { rimPoints, shoreDistance, type ShallowWater } from '../world/Water';
import { CanalWater } from './CanalWater';

const SEGMENTS = 40; // round the rim
const RINGS = 7; // from the rim to the middle
export const RIM_LIFT = 0.09; // the rim's height over the ground (park grass sits at 0.05, the Swamp's bog patch at 0.07)

/** The merged surface geometry: position, normal (up), uv.x = metres from the shore. */
export function shallowWaterGeometry(waters: ShallowWater[], terrain: Terrain): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const w of waters) {
    const rim = rimPoints(w, SEGMENTS);
    const base = pos.length / 3;
    // Ring r = 0 is the rim, r = RINGS the centre (one vertex), or the island's shore (a ring) when it has one.
    const isle = w.island ?? 0;
    for (let r = 0; r <= RINGS; r++) {
      const f = 1 - r / RINGS;
      const count = r === RINGS && !isle ? 1 : SEGMENTS;
      for (let i = 0; i < count; i++) {
        const l = Math.hypot(rim[i].x - w.x, rim[i].z - w.z) || 1;
        const ix = w.x + ((rim[i].x - w.x) / l) * isle, iz = w.z + ((rim[i].z - w.z) / l) * isle;
        const x = ix + (rim[i].x - ix) * f;
        const z = iz + (rim[i].z - iz) * f;
        const shore = r === 0 || (isle && r === RINGS) ? 0 : Math.max(0, shoreDistance(w, x, z));
        const rise = Math.min(1, shore / WATER.shoreRamp);
        pos.push(x, groundHeight(terrain, x, z) + RIM_LIFT + (w.depth - RIM_LIFT) * rise, z);
        uv.push(shore, 0);
      }
    }
    for (let r = 0; r < (isle ? RINGS : RINGS - 1); r++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const a = base + r * SEGMENTS + i;
        const b = base + r * SEGMENTS + ((i + 1) % SEGMENTS);
        const c = a + SEGMENTS;
        const d = b + SEGMENTS;
        index.push(a, c, b, b, c, d); // counter-clockwise seen from above
      }
    }
    if (isle) continue;
    const centre = base + RINGS * SEGMENTS;
    const last = base + (RINGS - 1) * SEGMENTS;
    for (let i = 0; i < SEGMENTS; i++) index.push(last + i, centre, last + ((i + 1) % SEGMENTS));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export class ShallowWaterView {
  readonly mesh: THREE.Mesh;
  private water: CanalWater | null;

  constructor(waters: ShallowWater[], terrain: Terrain, look: { sea: number; shallow: number; frozen: boolean; islandHalf: number }) {
    this.water = look.frozen ? null : new CanalWater([], look.islandHalf, look.sea, look.shallow, true);
    const material = this.water?.material ?? new THREE.MeshStandardMaterial({ color: 0x9fc4dc, roughness: 0.1, metalness: 0.15 });
    this.mesh = new THREE.Mesh(shallowWaterGeometry(waters, terrain), material);
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  update(dt: number): void {
    this.water?.update(dt);
  }
}
