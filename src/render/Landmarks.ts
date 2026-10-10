import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Landmark } from '../world/Landmarks';
import { TireSmoke } from './TireSmoke';

const STONE = 0xc9c3b6;
const STONE_DARK = 0x9c968a;
const BRONZE = 0x5e7f6e; // weathered patina
const STEEL = 0xb8c0c8;
const WATER = 0x3f8fb8;
const SPRAY_PER_SECOND = 40;
const SPRAY_RANGE = 160; // only spray fountains near the camera

/** Vertex-coloured part for merging (one material for all stone/bronze parts). */
function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

function fountain(): THREE.BufferGeometry {
  return mergeGeometries([
    part(cyl(5, 5.2, 0.6, 16), STONE, 0, 0.3),
    part(new THREE.TorusGeometry(4.85, 0.25, 4, 16).rotateX(Math.PI / 2), STONE_DARK, 0, 0.65),
    part(cyl(0.6, 0.75, 2, 8), STONE, 0, 1.0),
    part(cyl(2, 1.2, 0.4, 12), STONE, 0, 2.1),
    part(cyl(0.3, 0.4, 1, 8), STONE, 0, 2.75),
    part(cyl(0.8, 0.4, 0.25, 10), STONE, 0, 3.3),
  ]);
}

function fountainWater(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.CircleGeometry(4.7, 16).rotateX(-Math.PI / 2), WATER, 0, 0.62),
    part(new THREE.CircleGeometry(1.85, 12).rotateX(-Math.PI / 2), WATER, 0, 2.31),
  ]);
}

function statue(): THREE.BufferGeometry {
  // Stone plinth with cornices, bronze figure with a raised arm, facing +Z.
  const figure = [
    part(box(0.26, 1.05, 0.3), BRONZE, -0.17, 2.95),
    part(box(0.26, 1.05, 0.3), BRONZE, 0.17, 2.95),
    part(cyl(0.36, 0.52, 0.9, 6), BRONZE, 0, 3.2), // coat
    part(box(0.72, 0.85, 0.42), BRONZE, 0, 3.95),
    part(new THREE.SphereGeometry(0.22, 6, 4), BRONZE, 0, 4.62),
    part(box(0.18, 0.8, 0.18), BRONZE, -0.46, 3.85), // arm at side
    part(box(0.18, 0.95, 0.18).translate(0, 0.45, 0).rotateZ(-0.5).rotateX(-0.35), BRONZE, 0.42, 4.3), // raised arm
  ];
  return mergeGeometries([
    part(box(2.8, 0.3, 2.8), STONE_DARK, 0, 0.15),
    part(box(2.3, 2.0, 2.3), STONE, 0, 1.3),
    part(box(2.6, 0.25, 2.6), STONE_DARK, 0, 2.35),
    ...figure,
  ]);
}

function obelisk(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(3.2, 0.5, 3.2), STONE_DARK, 0, 0.25),
    part(box(2.3, 1.3, 2.3), STONE, 0, 1.15),
    part(cyl(0.55, 0.95, 12, 4).rotateY(Math.PI / 4), STONE, 0, 7.8),
    part(cyl(0, 0.55, 1.1, 4).rotateY(Math.PI / 4), STONE_DARK, 0, 14.35),
  ]);
}

function sculpture(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(3.6, 0.6, 3.6), STONE_DARK, 0, 0.3),
    part(box(1.0, 1.2, 1.0), STONE, 0, 1.2),
    part(new THREE.TorusGeometry(2, 0.38, 6, 14), STEEL, 0, 3.75),
    part(new THREE.TorusGeometry(1.2, 0.22, 6, 12).rotateY(Math.PI / 2), STEEL, 0, 3.75),
  ]);
}

// Builds every landmark (meshes + solid colliders) and runs the fountain spray.
export class Landmarks {
  private spray = new TireSmoke({
    color: 0xe2f2ff, maxAlpha: 0.5, additive: false, growth: 0.5, lift: [3.5, 5], gravity: 9.8, spread: 1.2, life: [0.9, 1.2],
  });
  private spouts: { position: THREE.Vector3; budget: number }[] = [];

  /**
   * lampGlow: 0 by day … 1 at night (fountain water glows a little after dark).
   * Returns collider handles so crash marks treat landmarks like walls.
   */
  constructor(landmarks: Landmark[], scene: THREE.Scene, world: RAPIER.World, lampGlow: number, readonly colliders = new Set<number>()) {
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, metalness: 0.6 });
    const water = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.2,
      emissive: 0x2a6f99,
      emissiveIntensity: 0.15 + lampGlow * 0.5,
    });
    const paving = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.95 });
    const models = { fountain: fountain(), statue: statue(), obelisk: obelisk(), sculpture: sculpture() };

    for (const l of landmarks) {
      const group = new THREE.Group();
      group.position.set(l.x, 0, l.z);
      group.rotation.y = l.yaw;
      // A circle of darker paving under the centrepiece.
      const base = new THREE.Mesh(new THREE.CircleGeometry(l.radius + 3.5, 24).rotateX(-Math.PI / 2), paving);
      base.position.y = 0.055;
      base.receiveShadow = true;
      group.add(base);
      const mesh = new THREE.Mesh(models[l.kind], l.kind === 'statue' || l.kind === 'sculpture' ? metal : solid);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (l.kind === 'fountain') {
        group.add(new THREE.Mesh(fountainWater(), water));
        this.spouts.push({ position: new THREE.Vector3(l.x, 3.45, l.z), budget: 0 });
      }
      scene.add(group);

      // Solid footprint: the basin for fountains, the plinth/base otherwise.
      const desc =
        l.kind === 'fountain'
          ? RAPIER.ColliderDesc.cylinder(0.6, l.radius).setTranslation(l.x, 0.6, l.z)
          : RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 3, l.radius * 0.8).setTranslation(l.x, 3, l.z);
      this.colliders.add(world.createCollider(desc).handle);
    }
    scene.add(this.spray.points);
  }

  update(dt: number, camera: THREE.Camera, viewportHeight: number, fov: number): void {
    this.spray.resize(viewportHeight, fov);
    for (const s of this.spouts) {
      if (s.position.distanceTo(camera.position) > SPRAY_RANGE) continue;
      s.budget += SPRAY_PER_SECOND * dt;
      while (s.budget >= 1) {
        this.spray.emit(s.position, ZERO, 0);
        s.budget--;
      }
    }
    this.spray.update(dt);
  }
}

const ZERO = new THREE.Vector3();
