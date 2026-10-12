import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from './geometry';
import { RAMP, type Landmark } from '../world/Landmarks';
import { groundBase, groundHeight, groundNormal, groundTop, type Terrain } from '../world/Terrain';
import { TireSmoke } from './TireSmoke';

const STONE = 0xc9c3b6;
const STONE_DARK = 0x9c968a;
const BRONZE = 0x5e7f6e; // weathered patina
const STEEL = 0xb8c0c8;
const WATER = 0x3f8fb8;
const DECK = 0x3a3d44; // polished dark granite
const GOLD = 0xd8a62a;
const WING = 0xb08a52; // polished bronze
const RAMP_SEGMENTS = 16;
const SPRAY_PER_SECOND = 40;
const SPRAY_RANGE = 160; // only spray fountains near the camera

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

/** Deck height at local z along the ramp (0 before the toe, peak at the lip). */
function deckHeight(z: number): number {
  const t = THREE.MathUtils.clamp((z - RAMP.toe) / (RAMP.lip - RAMP.toe), 0, 1);
  return RAMP.height * Math.pow(t, RAMP.curve);
}

/**
 * "The Leap": a curved granite kicker with racing-kerb gold edges, solid stone cheeks, and a
 * pair of bronze wings sweeping up from plinths either side of the lip, as if the ramp itself
 * were taking off. Returns the stone/deck geometry and the bronze wings separately.
 */
function rampMonument(): { stone: THREE.BufferGeometry; bronze: THREE.BufferGeometry } {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], hex: number) => {
    const color = new THREE.Color(hex);
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      col.push(color.r, color.g, color.b);
    }
  };
  const w = RAMP.width / 2;
  const kerb = 0.6;
  for (let i = 0; i < RAMP_SEGMENTS; i++) {
    const z0 = RAMP.toe + ((RAMP.lip - RAMP.toe) * i) / RAMP_SEGMENTS;
    const z1 = RAMP.toe + ((RAMP.lip - RAMP.toe) * (i + 1)) / RAMP_SEGMENTS;
    const y0 = deckHeight(z0) + 0.06;
    const y1 = deckHeight(z1) + 0.06;
    const kerbColor = i % 2 ? GOLD : 0xf0ece2;
    // Deck across the width: kerb, granite, kerb (counter-clockwise from above).
    for (const [xa, xb, hex] of [[-w, -w + kerb, kerbColor], [-w + kerb, w - kerb, DECK], [w - kerb, w, kerbColor]] as const) {
      quad([xa, y0, z0], [xa, y1, z1], [xb, y1, z1], [xb, y0, z0], hex);
    }
    // Side cheeks down to the ground.
    quad([w, 0, z0], [w, y0, z0], [w, y1, z1], [w, 0, z1], STONE);
    quad([-w, 0, z1], [-w, y1, z1], [-w, y0, z0], [-w, 0, z0], STONE);
  }
  // Vertical back face under the lip, with a gold band along its top.
  const top = deckHeight(RAMP.lip) + 0.06;
  quad([-w, 0, RAMP.lip], [w, 0, RAMP.lip], [w, top - 0.35, RAMP.lip], [-w, top - 0.35, RAMP.lip], STONE_DARK);
  quad([-w, top - 0.35, RAMP.lip], [w, top - 0.35, RAMP.lip], [w, top, RAMP.lip], [-w, top, RAMP.lip], GOLD);
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deck.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  deck.computeVertexNormals();

  // Plinths either side of the lip, with a gold cap, carrying the wings.
  const plinthX = w + 0.9;
  const plinthH = top + 0.6;
  const plinths = [-1, 1].flatMap((side) => [
    part(box(1.6, plinthH, 3.2), STONE, side * plinthX, plinthH / 2, RAMP.lip - 1.4),
    part(box(1.8, 0.2, 3.4), GOLD, side * plinthX, plinthH + 0.1, RAMP.lip - 1.4),
  ]);
  const stone = mergeGeometries([deck, ...plinths.map((g) => g.toNonIndexed())]);

  // Wings: a fan of long feathers per side, raked back and flaring outward and up.
  const feathers = [-1, 1].flatMap((side) =>
    [0, 1, 2, 3, 4, 5].map((k) => {
      const len = 7 - k * 0.8;
      return part(
        box(0.5, 0.1, len)
          .translate(0, 0, -len / 2) // pivot at the feather's root, pointing back (-Z)
          .rotateX(-0.55 - k * 0.17) // fan upward
          .rotateZ(side * (0.35 + k * 0.05)) // flare outward
          .rotateY(side * -0.25),
        WING,
        side * plinthX,
        plinthH + 0.3,
        RAMP.lip - 0.2,
      );
    }),
  );
  return { stone, bronze: mergeGeometries(feathers) };
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
  constructor(landmarks: Landmark[], terrain: Terrain, scene: THREE.Scene, world: RAPIER.World, lampGlow: number, readonly colliders = new Set<number>()) {
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
      if (l.kind === 'ramp') {
        this.addRamp(l, terrain, scene, world, solid, metal);
        continue;
      }
      // A circle of darker paving under the centrepiece; on a slope it's a level terrace, its top
      // flush with the ground uphill.
      const pad = l.radius + 3.5;
      const y = groundTop(terrain, l.x, l.z, pad);
      const step = y - groundBase(terrain, l.x, l.z, pad) + 0.1;
      const group = new THREE.Group();
      group.position.set(l.x, y, l.z);
      group.rotation.y = l.yaw;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(pad, pad, step, 24).translate(0, 0.055 - step / 2, 0), paving);
      base.receiveShadow = true;
      if (step > 0.3) {
        this.colliders.add(world.createCollider(RAPIER.ColliderDesc.cylinder(step / 2, pad).setTranslation(l.x, y + 0.055 - step / 2, l.z)).handle);
      }
      group.add(base);
      const mesh = new THREE.Mesh(models[l.kind], l.kind === 'statue' || l.kind === 'sculpture' ? metal : solid);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (l.kind === 'fountain') {
        group.add(new THREE.Mesh(fountainWater(), water));
        this.spouts.push({ position: new THREE.Vector3(l.x, y + 3.45, l.z), budget: 0 });
      }
      scene.add(group);

      // Solid footprint: the basin for fountains, the plinth/base otherwise.
      const desc =
        l.kind === 'fountain'
          ? RAPIER.ColliderDesc.cylinder(0.6, l.radius).setTranslation(l.x, y + 0.6, l.z)
          : RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 3, l.radius * 0.8).setTranslation(l.x, y + 3, l.z);
      this.colliders.add(world.createCollider(desc).handle);
    }
    scene.add(this.spray.points);
  }

  /** The jump monument: drivable curved deck (convex slices), solid plinths. Tilted with the slope. */
  private addRamp(l: Landmark, terrain: Terrain, scene: THREE.Scene, world: RAPIER.World, solid: THREE.Material, metal: THREE.Material): void {
    const up = new THREE.Vector3(0, 1, 0);
    const n = groundNormal(terrain, l.x, l.z);
    const q = new THREE.Quaternion()
      .setFromUnitVectors(up, new THREE.Vector3(n.x, n.y, n.z))
      .multiply(new THREE.Quaternion().setFromAxisAngle(up, l.yaw));
    const y = groundHeight(terrain, l.x, l.z) - 0.03;
    const group = new THREE.Group();
    group.position.set(l.x, y, l.z);
    group.quaternion.copy(q);
    const model = rampMonument();
    const stone = new THREE.Mesh(model.stone, solid);
    const wings = new THREE.Mesh(model.bronze, metal);
    for (const m of [stone, wings]) {
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    scene.add(group);
    group.updateMatrixWorld();

    // Deck: one convex slice per segment, from the ground up to the deck surface.
    const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
    const w = RAMP.width / 2;
    for (let i = 0; i < RAMP_SEGMENTS; i++) {
      const z0 = RAMP.toe + ((RAMP.lip - RAMP.toe) * i) / RAMP_SEGMENTS;
      const z1 = RAMP.toe + ((RAMP.lip - RAMP.toe) * (i + 1)) / RAMP_SEGMENTS;
      const y0 = deckHeight(z0) + 0.06;
      const y1 = deckHeight(z1) + 0.06;
      const pts = new Float32Array([
        -w, 0, z0, w, 0, z0, -w, 0, z1, w, 0, z1,
        -w, y0, z0, w, y0, z0, -w, y1, z1, w, y1, z1,
      ]);
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (desc) world.createCollider(desc.setTranslation(l.x, y, l.z).setRotation(rot).setFriction(1));
    }
    // Plinths are solid walls (they take crash marks).
    const plinthH = deckHeight(RAMP.lip) + 0.7;
    for (const side of [-1, 1]) {
      const local = new THREE.Vector3(side * (w + 0.9), plinthH / 2, RAMP.lip - 1.4).applyQuaternion(q);
      const desc = RAPIER.ColliderDesc.cuboid(0.8, plinthH / 2, 1.6).setTranslation(l.x + local.x, y + local.y, l.z + local.z).setRotation(rot);
      this.colliders.add(world.createCollider(desc).handle);
    }
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
