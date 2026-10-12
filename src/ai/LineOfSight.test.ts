import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { staticLineOfSight } from './lineOfSight';

const v = (x: number, z: number) => new THREE.Vector3(x, 0.5, z);

describe('cop line of sight', () => {
  beforeAll(() => RAPIER.init());

  function world() {
    const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    w.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0)); // ground: never blocks
    w.createCollider(RAPIER.ColliderDesc.cuboid(10, 10, 10).setTranslation(50, 10, 0)); // a building
    w.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.45, 2).setTranslation(0, 0.45, 50)); // a 0.9m planter
    // A car (dynamic) in the way.
    w.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.7, 2), w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-50, 0.7, 0)));
    w.step();
    return staticLineOfSight(w);
  }

  it('sees down an open street', () => {
    expect(world()(v(0, 0), v(0, -100))).toBe(true);
  });

  it('is blocked by buildings and low planters', () => {
    const see = world();
    expect(see(v(0, 0), v(100, 0))).toBe(false);
    expect(see(v(0, 0), v(0, 100))).toBe(false);
  });

  it('sees past other cars, and over a target right up against a wall', () => {
    const see = world();
    expect(see(v(0, 0), v(-100, 0))).toBe(true);
    expect(see(v(0, 0), v(39, 0))).toBe(true); // building face at x=40, within the 2m allowance
  });
});
