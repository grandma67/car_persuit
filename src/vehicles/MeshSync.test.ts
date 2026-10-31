import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Vehicle } from './Vehicle';
import { BUS_SPEC, PLAYER_SPEC } from './VehicleSpecs';

const DT = 1 / 60;

// Car parts' matrices are manual (Vehicle freezes them; syncMesh updates the moving ones), and an
// off-screen car's root is too (holdMesh): every local matrix must still match its transform.
describe('car mesh matrices', () => {
  beforeAll(() => RAPIER.init());

  const setup = (spec = PLAYER_SPEC) => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    return { world, car: new Vehicle(world, spec, { x: 0, y: 1, z: 0 }) };
  };
  const stale = (root: THREE.Object3D) => {
    const out: string[] = [];
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      if (o === root) return; // automatic: three updates it in the render
      m.compose(o.position, o.quaternion, o.scale);
      if (!m.equals(o.matrix)) out.push(`${o.type} ${o.name}`);
    });
    return out;
  };

  it('every part but the root is manual, and current after driving, steering and syncing', () => {
    for (const spec of [PLAYER_SPEC, BUS_SPEC]) {
      const { world, car } = setup(spec);
      const parts: boolean[] = [];
      car.mesh.root.traverse((o) => o !== car.mesh.root && parts.push(o.matrixAutoUpdate));
      expect(parts.length).toBeGreaterThan(10);
      expect(parts.every((auto) => !auto)).toBe(true);
      for (let i = 0; i < 90; i++) {
        car.drive({ throttle: 1, brake: 0, steer: i < 45 ? 1 : -0.5, handbrake: false }, DT);
        world.step();
        car.snapshot();
      }
      car.syncMesh(0.5);
      expect(car.mesh.wheels[0].pivot.rotation.y).not.toBe(0); // steering shows
      expect(stale(car.mesh.root)).toEqual([]);
    }
  });

  it('holdMesh keeps the root as last drawn, and syncs a car never drawn', () => {
    const { world, car } = setup();
    const root = car.mesh.root;
    car.holdMesh(1); // never drawn: synced instead, so it isn't left at the origin
    expect(root.matrixAutoUpdate).toBe(true);
    expect(root.position.y).toBeCloseTo(car.position.y, 5);
    car.holdMesh(1);
    expect(root.matrixAutoUpdate).toBe(false);
    for (let i = 0; i < 30; i++) {
      car.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false }, DT);
      world.step();
      car.snapshot();
    }
    const held = root.position.z;
    car.holdMesh(1);
    expect(root.position.z).toBe(held);
    car.syncMesh(1); // back in view
    expect(root.matrixAutoUpdate).toBe(true);
    expect(root.position.z).toBeCloseTo(car.position.z, 5);
  });
});
