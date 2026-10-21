// The Harbor's yards, stacks and tank farm. Containers are two instanced meshes (forties and
// twenties) with the props' instanced material settings, tinted per container; the tank farm is
// merged into one vertex-coloured mesh with the district structures' settings; the yard paving
// drapes over the ground with the city's paving settings. No new shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONTAINER, HARBOR } from '../../gameplay/balance';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import { GeometryBuilder } from '../../world/CityBuilder';
import type { District } from '../../world/districts/District';
import type { TankFarmData } from '../../world/districts/Harbor';
import { containersOf } from '../../world/districts/HarborYard';
import type { DistrictRenderContext, DistrictView } from './index';

const CONCRETE = 0xb4b2aa;
const YELLOW = 0xe0b62a;
const TANK = 0xdcdcd6;
const STEEL_DARK = 0x4a4f54;
const SNOW = 0xeef2f6;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** One container along Z, base at y = 0: the box, darker corner posts and end frames, door bars. */
function containerGeometry(len: number): THREE.BufferGeometry {
  const { w, h } = CONTAINER;
  const g = [part(box(w - 0.04, h - 0.04, len - 0.04), 0xffffff, 0, h / 2)];
  const frame = 0x9a9a9a;
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.push(part(box(0.14, h, 0.14), frame, (x * (w - 0.12)) / 2, h / 2, (z * (len - 0.12)) / 2));
  for (const z of [-1, 1]) {
    for (const y of [0.07, h - 0.07]) g.push(part(box(w, 0.14, 0.14), frame, 0, y, (z * (len - 0.12)) / 2));
  }
  // Locking bars on the doors (+Z end).
  for (const x of [-0.75, -0.3, 0.3, 0.75]) g.push(part(box(0.05, h - 0.3, 0.05), 0x7a7a7a, x, h / 2, len / 2 + 0.005));
  return mergeGeometries(g);
}

function tankFarm(d: TankFarmData, x: number, z: number, y: number, snowy: boolean, out: THREE.BufferGeometry[]): void {
  const t = 0.4;
  const concrete = 0xa8a49a;
  out.push(part(box(d.w, d.bund, t), concrete, x, y + d.bund / 2, z - d.d / 2 + t / 2));
  out.push(part(box(d.w, d.bund, t), concrete, x, y + d.bund / 2, z + d.d / 2 - t / 2));
  out.push(part(box(t, d.bund, d.d - 2 * t), concrete, x - d.w / 2 + t / 2, y + d.bund / 2, z));
  out.push(part(box(t, d.bund, d.d - 2 * t), concrete, x + d.w / 2 - t / 2, y + d.bund / 2, z));
  for (const k of d.tanks) {
    out.push(part(new THREE.CylinderGeometry(k.r, k.r, k.h, 20), TANK, k.x, y + k.h / 2, k.z));
    // A shallow cone roof, a band near the top, a ladder up one side.
    out.push(part(new THREE.ConeGeometry(k.r + 0.1, k.r * 0.18, 20), snowy ? SNOW : 0xc8c8c0, k.x, y + k.h + k.r * 0.09, k.z));
    out.push(part(new THREE.CylinderGeometry(k.r + 0.06, k.r + 0.06, 0.3, 20, 1, true), 0x8a3a2e, k.x, y + k.h - 1.2, k.z));
    out.push(part(box(0.5, k.h, 0.1), STEEL_DARK, k.x, y + k.h / 2, k.z + k.r + 0.06));
  }
}

export function renderHarbor(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  // Yard paving: concrete over the block, yellow lines along each corridor's edges.
  const paving = new GeometryBuilder();
  const concrete = new THREE.Color(CONCRETE);
  const yellow = new THREE.Color(YELLOW);
  for (const p of q.dressing.ground) if (p.kind === 'yard') paving.drape(p, 0.055, concrete, city.terrain);
  for (const r of q.dressing.drivable) {
    const yard = q.dressing.ground.find((p) => p.kind === 'yard' && Math.abs(p.x - r.x) < p.w / 2 && Math.abs(p.z - r.z) < p.d / 2);
    if (!yard) continue;
    // The corridor's edges inside the paving.
    const alongX = r.w > r.d;
    const len = alongX ? yard.w : yard.d;
    for (const side of [-1, 1]) {
      const line = alongX ? { x: yard.x, z: r.z + side * (r.d / 2 - 0.3), w: len, d: 0.18 } : { x: r.x + side * (r.w / 2 - 0.3), z: yard.z, w: 0.18, d: len };
      paving.drape(line, 0.08, yellow, city.terrain);
    }
  }
  if (paving.positions.length) {
    const mesh = new THREE.Mesh(paving.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Containers, the top tiers capped (the data is capped already; this guards the instance count).
  const containers = containersOf(q.dressing.structures).slice(0, HARBOR.maxContainers);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
  const m = new THREE.Matrix4();
  const rot = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const colour = new THREE.Color();
  const yaw90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const tops = new Map<string, number>();
  for (const c of containers) tops.set(`${c.x},${c.z}`, Math.max(tops.get(`${c.x},${c.z}`) ?? 0, c.tier));
  for (const len of [CONTAINER.l40, CONTAINER.l20]) {
    const list = containers.filter((c) => c.len === len);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(containerGeometry(len), material, list.length);
    list.forEach((c, i) => {
      // A column stands on the ground under its middle, a touch sunk.
      pos.set(c.x, ctx.ground(c.x, c.z) - 0.05 + c.tier * CONTAINER.h, c.z);
      rot.copy(c.alongX ? yaw90 : new THREE.Quaternion());
      mesh.setMatrixAt(i, m.compose(pos, rot, one));
      mesh.setColorAt(i, colour.setHex(snowy && c.tier === tops.get(`${c.x},${c.z}`) ? SNOW : c.color));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // The tank farm.
  const geos: THREE.BufferGeometry[] = [];
  for (const s of q.dressing.structures) {
    if (s.kind !== 'tankFarm') continue;
    const d = s.data as unknown as TankFarmData;
    const y = Math.min(...s.footprints.map((f) => ctx.ground(f.x, f.z))) - 0.05;
    tankFarm(d, s.x, s.z, y, snowy, geos);
  }
  if (geos.length) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return {};
}
