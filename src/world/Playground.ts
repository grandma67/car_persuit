import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';

// Temporary M1 test area for tuning driving feel: a large gridded plane, scattered blocks
// and a ramp. Replaced by the generated city in M2.
export function buildPlayground(scene: THREE.Scene, world: RAPIER.World, rng: Rng): void {
  const size = 800;

  // Grid texture so speed and drift are readable.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2a2f38';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#3a414d';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 10, size / 10);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setTranslation(0, -0.5, 0).setFriction(1));

  // Scattered static blocks, kept clear of the spawn point.
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x5b6b82, flatShading: true });
  for (let i = 0; i < 60; i++) {
    const w = rng.range(4, 14);
    const h = rng.range(3, 20);
    const d = rng.range(4, 14);
    const x = rng.range(-size / 2 + 20, size / 2 - 20);
    const z = rng.range(-size / 2 + 20, size / 2 - 20);
    if (Math.hypot(x, z) < 30) continue;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMat);
    block.position.set(x, h / 2, z);
    block.castShadow = block.receiveShadow = true;
    scene.add(block);
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, h / 2, z));
  }

  // Ramp straight ahead of the spawn.
  const rampAngle = 0.25;
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.5, 14),
    new THREE.MeshStandardMaterial({ color: 0xffb020, flatShading: true }),
  );
  ramp.position.set(0, 1.4, 60);
  ramp.rotation.x = -rampAngle;
  ramp.castShadow = ramp.receiveShadow = true;
  scene.add(ramp);
  const q = ramp.quaternion;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(4, 0.25, 7)
      .setTranslation(ramp.position.x, ramp.position.y, ramp.position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
}
