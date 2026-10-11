// Meshes and colliders for the roadworks site: a dug-up patch of road, a concrete mixer with a
// turning drum and a yellow backhoe tractor, both parked solid, with amber beacons flashing.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../render/geometry';
import type { Roadworks } from './Roadworks';

const MIXER_LATERAL = 3.2; // metres from the junction centre, sideways
const TRACTOR_LATERAL = -2.4;
const TRACTOR_ANGLE = 0.35; // parked a little askew
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

export class RoadworksSite {
  private drum: THREE.Mesh;
  private beacons: THREE.InstancedMesh;
  private beaconLit = -1;
  private color = new THREE.Color();

  /** Adds the trucks to the scene and the world; their collider handles go into `walls`. */
  constructor(site: Roadworks, scene: THREE.Scene, world: RAPIER.World, walls: Set<number>) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.15 });
    const baseYaw = site.alongX ? Math.PI / 2 : 0;
    const up = new THREE.Vector3(0, 1, 0);
    // Sideways direction in the world for the junction's local frame.
    const latX = Math.cos(baseYaw);
    const latZ = -Math.sin(baseYaw);
    const at = (lateral: number) => new THREE.Vector3(site.x + latX * lateral * site.side, 0, site.z + latZ * lateral * site.side);

    // Dug-up patch of road under the trucks.
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 7).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }),
    );
    patch.position.set(site.x, 0.026, site.z);
    patch.rotation.y = baseYaw;
    patch.receiveShadow = true;
    scene.add(patch);

    const place = (geo: THREE.BufferGeometry, pos: THREE.Vector3, yaw: number) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.copy(pos);
      mesh.rotation.y = yaw;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };
    const collider = (pos: THREE.Vector3, yaw: number, half: THREE.Vector3, offsetZ = 0) => {
      const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
      const off = new THREE.Vector3(0, half.y, offsetZ).applyQuaternion(q);
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setTranslation(pos.x + off.x, off.y, pos.z + off.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      walls.add(c.handle);
    };

    const mixer = mixerModel();
    const mixerYaw = baseYaw + (site.side > 0 ? 0 : Math.PI);
    const mixerPos = at(MIXER_LATERAL);
    const mixerMesh = place(mixer.body, mixerPos, mixerYaw);
    this.drum = new THREE.Mesh(mixer.drum, material);
    this.drum.position.copy(mixer.drumAt);
    this.drum.rotation.x = 0.12; // tilted up toward the back
    this.drum.castShadow = true;
    mixerMesh.add(this.drum);
    collider(mixerPos, mixerYaw, mixer.half);

    const tractor = tractorModel();
    const tractorYaw = baseYaw + Math.PI + TRACTOR_ANGLE * site.side;
    const tractorPos = at(TRACTOR_LATERAL);
    const tractorMesh = place(tractor.body, tractorPos, tractorYaw);
    collider(tractorPos, tractorYaw, tractor.half, tractor.centreZ);

    // Amber beacons on the cab roofs (unlit material so they glow at night).
    this.beacons = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.16, 0.22, 10), new THREE.MeshBasicMaterial({ toneMapped: false }), 2);
    const beaconAt = (mesh: THREE.Object3D, local: THREE.Vector3) => mesh.localToWorld(local.clone());
    mixerMesh.updateMatrixWorld();
    tractorMesh.updateMatrixWorld();
    [beaconAt(mixerMesh, new THREE.Vector3(0, 3.12, 3.2)), beaconAt(tractorMesh, new THREE.Vector3(0, 3.0, -0.5))].forEach((p, i) => {
      this.beacons.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      this.beacons.setColorAt(i, this.color.setHex(BEACON_OFF));
    });
    scene.add(this.beacons);
  }

  /** Turn the drum and flash the beacons, alternating. `time` in seconds. */
  update(dt: number, time: number): void {
    this.drum.rotateZ(DRUM_SPEED * dt);
    const lit = Math.floor(time * 2.5) % 2;
    if (lit === this.beaconLit) return;
    this.beaconLit = lit;
    for (let i = 0; i < 2; i++) this.beacons.setColorAt(i, this.color.setHex(i === lit ? BEACON_ON : BEACON_OFF));
    this.beacons.instanceColor!.needsUpdate = true;
  }
}
