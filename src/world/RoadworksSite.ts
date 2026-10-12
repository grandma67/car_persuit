// Meshes and colliders for a roadworks site, from the layout Roadworks planned: machines (concrete
// mixer with a turning drum, backhoe, tipper) with amber beacons flashing, a fenced-off dig, dirt,
// pipes, a light tower, a portable toilet, barrier boards and repair patches. All solid but the patches.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../render/geometry';
import type { Roadworks, WorksItem, WorksItemKind } from './Roadworks';
import { groundBase, groundHeight, groundNormal, type Terrain } from './Terrain';

const DRUM_SPEED = 1.2; // rad/s
const BEACON_ON = 0xffa21a;
const BEACON_OFF = 0x3a2508;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Wheel: axle along X. */
const wheel = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);

const TYRE = 0x1b1c1f;
const HUB = 0x9aa0a8;
const GLASS = 0x26303d;

/** Concrete mixer, +Z forward, origin on the ground at its centre. Drum is separate (it spins). */
function mixerModel(): { body: THREE.BufferGeometry; drum: THREE.BufferGeometry; drumAt: THREE.Vector3; half: THREE.Vector3 } {
  const cab = 0xe8e6e0;
  const frame = 0x2d3036;
  const wheels = [3.0, -1.2, -2.6].flatMap((z) =>
    [-1.1, 1.1].flatMap((x) => [part(wheel(0.55, 0.45), TYRE, x, 0.55, z), part(wheel(0.3, 0.47), HUB, x, 0.55, z)]),
  );
  const body = mergeGeometries([
    part(box(2.2, 0.4, 8.0), frame, 0, 1.0),
    part(box(2.4, 1.9, 2.0), cab, 0, 2.05, 3.2),
    part(box(2.2, 0.75, 0.05), GLASS, 0, 2.45, 4.21),
    part(box(0.05, 0.6, 1.2), GLASS, -1.21, 2.5, 3.4),
    part(box(0.05, 0.6, 1.2), GLASS, 1.21, 2.5, 3.4),
    part(box(2.4, 0.3, 0.2), 0x3a3d44, 0, 1.25, 4.25), // bumper
    part(box(2.3, 0.15, 5.4), frame, 0, 1.25, -1.3), // drum bed
    part(box(0.5, 1.3, 0.5), frame, 0, 1.95, 1.6), // drum front stand
    part(box(0.9, 0.9, 0.5), frame, 0, 1.8, -3.6), // rear stand
    part(box(0.5, 0.2, 1.4).rotateX(0.5), 0x8a8f96, 0, 2.35, -4.4), // chute
    ...[-1, 1].map((s) => part(box(0.25, 0.08, 1.4), 0xff7a10, s * 1.18, 1.0, -2.0)), // side stripes
    ...wheels,
  ]);
  // Drum: tapered barrel along Z (wide at the front), with spiral-ish bands so the turning shows.
  const drum = mergeGeometries([
    part(new THREE.CylinderGeometry(1.25, 0.75, 4.6, 14), 0xe9e4d6).rotateX(Math.PI / 2),
    // Thin bars across the barrel, just proud of its surface, each turned a bit further round.
    ...[-1.4, -0.2, 1.0].map((z, k) => {
      const r = 0.75 + ((z + 2.3) / 4.6) * 0.5;
      return part(box(0.25, r * 2 + 0.08, 0.3), 0xff6a1a, 0, 0, z).rotateZ(k * 0.8);
    }),
  ]);
  return { body, drum, drumAt: new THREE.Vector3(0, 2.65, -1.0), half: new THREE.Vector3(1.25, 1.95, 4.35) };
}

/** Backhoe loader, +Z forward. */
function tractorModel(): { body: THREE.BufferGeometry; half: THREE.Vector3; centreZ: number } {
  const yellow = 0xf2b705;
  const dark = 0x2a2c30;
  const body = mergeGeometries([
    part(box(1.9, 0.6, 3.6), yellow, 0, 0.95, 0.2),
    part(box(1.4, 1.0, 1.8), yellow, 0, 1.6, 1.3), // engine hood
    part(box(0.12, 0.6, 0.12), dark, 0.45, 2.3, 1.6), // exhaust
    part(box(1.7, 1.5, 1.6), GLASS, 0, 2.0, -0.5), // cab glass
    part(box(1.9, 0.14, 1.8), yellow, 0, 2.82, -0.5), // roof
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(box(0.1, 1.5, 0.1), yellow, sx * 0.85, 2.0, -0.5 + sz * 0.78))),
    // Front loader: arms and bucket resting on the road.
    ...[-1, 1].map((s) => part(box(0.14, 0.2, 1.9).rotateX(0.45), dark, s * 1.0, 1.15, 2.3)),
    part(box(2.3, 0.7, 0.6), yellow, 0, 0.4, 3.2),
    // Rear backhoe: boom up and back, dipper down to a bucket on the ground.
    part(box(0.28, 0.28, 2.0).rotateX(-0.75), yellow, 0, 2.2, -2.2),
    part(box(0.24, 2.0, 0.24), yellow, 0, 1.75, -3.0),
    part(box(0.7, 0.55, 0.55), dark, 0, 0.35, -3.05),
    ...[-1, 1].map((s) => part(box(0.25, 0.9, 0.25), dark, s * 1.0, 0.45, -1.6)), // stabiliser legs
    // Big rear wheels, small front ones.
    ...[-1, 1].flatMap((s) => [part(wheel(0.85, 0.5), TYRE, s * 1.05, 0.85, -0.7), part(wheel(0.45, 0.52), yellow, s * 1.05, 0.85, -0.7)]),
    ...[-1, 1].flatMap((s) => [part(wheel(0.5, 0.35), TYRE, s * 0.95, 0.5, 1.5), part(wheel(0.25, 0.37), yellow, s * 0.95, 0.5, 1.5)]),
  ]);
  return { body, half: new THREE.Vector3(1.2, 1.5, 3.3), centreZ: 0.05 };
}

/** Tipper truck, +Z forward: cab and a raised-sided bed of gravel. */
function tipperModel(): THREE.BufferGeometry {
  const cab = 0xd9442b;
  const frame = 0x2d3036;
  return mergeGeometries([
    part(box(2.2, 0.4, 7.0), frame, 0, 1.0),
    part(box(2.4, 1.8, 1.9), cab, 0, 2.0, 2.6),
    part(box(2.2, 0.7, 0.05), GLASS, 0, 2.4, 3.56),
    part(box(0.05, 0.6, 1.1), GLASS, -1.21, 2.45, 2.8),
    part(box(0.05, 0.6, 1.1), GLASS, 1.21, 2.45, 2.8),
    part(box(2.4, 1.2, 4.4), 0x6b6f76, 0, 1.85, -1.2), // bed
    part(box(2.1, 0.5, 4.1), 0x8d7b62, 0, 2.4, -1.2), // gravel load
    ...[2.6, -0.8, -2.4].flatMap((z) =>
      [-1.1, 1.1].flatMap((x) => [part(wheel(0.55, 0.45), TYRE, x, 0.55, z), part(wheel(0.3, 0.47), HUB, x, 0.55, z)]),
    ),
  ]);
}

const BOARD_RED = 0xd8262b;
const BOARD_WHITE = 0xf2f2ee;
/** Red/white striped barrier board on two feet, along Z, `len` long. */
function boardParts(len: number, x = 0, z = 0, alongX = false): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const stripes = Math.max(3, Math.round(len / 0.4));
  for (let k = 0; k < stripes; k++) {
    const t = -len / 2 + (len * (k + 0.5)) / stripes;
    const g = alongX ? box(len / stripes, 0.28, 0.05) : box(0.05, 0.28, len / stripes);
    parts.push(part(g, k % 2 ? BOARD_WHITE : BOARD_RED, x + (alongX ? t : 0), 0.85, z + (alongX ? 0 : t)));
  }
  for (const e of [-1, 1]) {
    const fx = x + (alongX ? e * len * 0.4 : 0);
    const fz = z + (alongX ? 0 : e * len * 0.4);
    parts.push(part(box(0.06, 0.8, 0.06), 0xdddddd, fx, 0.4, fz), part(box(0.5, 0.06, 0.5), 0x2a2c30, fx, 0.03, fz));
  }
  return parts;
}

/** A dig: hole in the road ringed by barrier boards, spoil heaped at one end. */
function digModel(hw: number, hl: number): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(hw * 2 - 0.6, 0.02, hl * 2 - 1.6), 0x1d1610, 0, 0.03, 0.3), // the hole
    part(new THREE.ConeGeometry(0.9, 0.8, 7), 0x6b5236, 0, 0.4, -hl + 0.8), // spoil
    ...boardParts(hl * 2, -hw),
    ...boardParts(hl * 2, hw),
    ...boardParts(hw * 2, 0, hl, true),
    ...boardParts(hw * 2, 0, -hl, true),
  ]);
}

/** Heap of dirt, roughly oval. */
function moundModel(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.SphereGeometry(1.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1.25), 0x6b5236),
    part(new THREE.ConeGeometry(0.6, 0.5, 6), 0x5d4630, 0.5, 0.75, 0.4),
  ]);
}

/** Concrete pipes stacked three and two, lying along Z. */
function pipesModel(): THREE.BufferGeometry {
  const pipe = (x: number, y: number) => [
    part(new THREE.CylinderGeometry(0.42, 0.42, 3.0, 10).rotateX(Math.PI / 2), 0xa9a49a, x, y, 0),
    part(new THREE.CylinderGeometry(0.3, 0.3, 3.02, 10).rotateX(Math.PI / 2), 0x3a3833, x, y, 0),
  ];
  return mergeGeometries([...pipe(-0.68, 0.42), ...pipe(0, 0.42), ...pipe(0.68, 0.42), ...pipe(-0.34, 1.1), ...pipe(0.34, 1.1)]);
}

/** Light tower on a trailer: mast and a bar of four lamps (lamps returned separately, they glow). */
function towerModel(): { body: THREE.BufferGeometry; lamps: THREE.Vector3[] } {
  const yellow = 0xf2b705;
  const body = mergeGeometries([
    part(box(1.3, 0.9, 1.9), yellow, 0, 0.75),
    part(box(0.2, 0.2, 0.9), 0x2a2c30, 0, 0.4, 1.3), // drawbar
    ...[-1, 1].flatMap((s) => [part(wheel(0.32, 0.22), TYRE, s * 0.75, 0.32, -0.3)]),
    part(box(0.14, 4.2, 0.14), 0x8a8f96, 0, 3.2, -0.5), // mast
    part(box(1.6, 0.12, 0.2), 0x2a2c30, 0, 5.3, -0.5),
  ]);
  const lamps = [-0.6, -0.2, 0.2, 0.6].map((x) => new THREE.Vector3(x, 5.42, -0.5));
  return { body, lamps };
}

/** Portable toilet. */
function toiletModel(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(1.2, 2.2, 1.2), 0x2a6fb0, 0, 1.1),
    part(box(1.3, 0.1, 1.3), 0xe8e8e8, 0, 2.25),
    part(box(0.05, 1.8, 0.8), 0x245f98, 0.62, 1.0),
  ]);
}

/** Collider height per item (its footprint comes from the plan). */
const SOLID_HEIGHT: Record<Exclude<WorksItemKind, 'patch'>, number> = {
  mixer: 3.9, backhoe: 3.0, tipper: 3.0, dig: 1.0, mound: 0.8, pipes: 1.5, tower: 1.3, toilet: 2.3, barrier: 1.0,
};

export class RoadworksSite {
  private drums: THREE.Mesh[] = [];
  private beacons: THREE.InstancedMesh | null = null;
  private beaconLit = -1;
  private color = new THREE.Color();

  /** Adds the site to the scene and the world; collider handles go into `walls`. */
  constructor(site: Roadworks, terrain: Terrain, scene: THREE.Scene, world: RAPIER.World, walls: Set<number>) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.15 });
    const up = new THREE.Vector3(0, 1, 0);
    const beaconAt: THREE.Vector3[] = [];
    const lampAt: THREE.Vector3[] = [];

    // Machines and kit stand upright on the lowest ground under them.
    const baseOf = (item: WorksItem) => groundBase(terrain, item.x, item.z, Math.max(item.hw, item.hl));
    const place = (geo: THREE.BufferGeometry, item: WorksItem) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(item.x, baseOf(item), item.z);
      mesh.rotation.y = item.yaw;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      mesh.updateMatrixWorld();
      return mesh;
    };

    for (const item of site.items) {
      if (item.kind === 'patch') {
        // Fresh tarmac or dug-up road: flat, under everything else.
        const patch = new THREE.Mesh(
          new THREE.PlaneGeometry(item.hw * 2, item.hl * 2).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: Math.abs(item.x * 7 + item.z * 13) % 2 < 1 ? 0x4a3a2a : 0x1e1f22, roughness: 1 }),
        );
        const n = groundNormal(terrain, item.x, item.z);
        patch.position.set(item.x, groundHeight(terrain, item.x, item.z) + 0.026, item.z);
        patch.quaternion
          .setFromUnitVectors(up, new THREE.Vector3(n.x, n.y, n.z))
          .multiply(new THREE.Quaternion().setFromAxisAngle(up, item.yaw));
        patch.receiveShadow = true;
        scene.add(patch);
        continue;
      }
      let mesh: THREE.Mesh;
      switch (item.kind) {
        case 'mixer': {
          const mixer = mixerModel();
          mesh = place(mixer.body, item);
          const drum = new THREE.Mesh(mixer.drum, material);
          drum.position.copy(mixer.drumAt);
          drum.rotation.x = 0.12; // tilted up toward the back
          drum.castShadow = true;
          mesh.add(drum);
          this.drums.push(drum);
          beaconAt.push(mesh.localToWorld(new THREE.Vector3(0, 3.12, 3.2)));
          break;
        }
        case 'backhoe':
          mesh = place(tractorModel().body, item);
          beaconAt.push(mesh.localToWorld(new THREE.Vector3(0, 3.0, -0.5)));
          break;
        case 'tipper':
          mesh = place(tipperModel(), item);
          beaconAt.push(mesh.localToWorld(new THREE.Vector3(0, 3.02, 2.6)));
          break;
        case 'dig':
          mesh = place(digModel(item.hw, item.hl), item);
          break;
        case 'mound':
          mesh = place(moundModel(), item);
          break;
        case 'pipes':
          mesh = place(pipesModel(), item);
          break;
        case 'tower': {
          const tower = towerModel();
          mesh = place(tower.body, item);
          for (const l of tower.lamps) lampAt.push(mesh.localToWorld(l.clone()));
          break;
        }
        case 'toilet':
          mesh = place(toiletModel(), item);
          break;
        case 'barrier':
          mesh = place(mergeGeometries(boardParts(item.hl * 2)), item);
          break;
      }
      const h = SOLID_HEIGHT[item.kind] / 2;
      const q = new THREE.Quaternion().setFromAxisAngle(up, item.yaw);
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(item.hw, h, item.hl).setTranslation(item.x, baseOf(item) + h, item.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      walls.add(c.handle);
    }

    // Amber beacons on the machines' cabs (unlit material so they glow at night).
    if (beaconAt.length) {
      this.beacons = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.16, 0.22, 10), new THREE.MeshBasicMaterial({ toneMapped: false }), beaconAt.length);
      beaconAt.forEach((p, i) => {
        this.beacons!.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
        this.beacons!.setColorAt(i, this.color.setHex(BEACON_OFF));
      });
      scene.add(this.beacons);
    }
    // Light tower lamps: always on, bright white faces.
    if (lampAt.length) {
      const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.26, 0.12), new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }), lampAt.length);
      lampAt.forEach((p, i) => lamps.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
      scene.add(lamps);
    }
  }

  /** Turn the drums and flash the beacons, alternating. `time` in seconds. */
  update(dt: number, time: number): void {
    for (const drum of this.drums) drum.rotateZ(DRUM_SPEED * dt);
    if (!this.beacons) return;
    const lit = Math.floor(time * 2.5) % 2;
    if (lit === this.beaconLit) return;
    this.beaconLit = lit;
    for (let i = 0; i < this.beacons.count; i++) this.beacons.setColorAt(i, this.color.setHex(i % 2 === lit ? BEACON_ON : BEACON_OFF));
    this.beacons.instanceColor!.needsUpdate = true;
  }
}
