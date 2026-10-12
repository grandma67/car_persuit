import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import type { RoadGraph } from '../world/RoadGraph';
import { COP_TUNING, CopController } from './CopController';
import { obstacleProbe } from './lineOfSight';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

describe('cop obstacle avoidance', () => {
  beforeAll(() => RAPIER.init());

  it.each(Object.values(COP_SPECS))('$name swerves round a statue between it and the suspect, then reaches them', (spec) => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    const statue = world.createCollider(RAPIER.ColliderDesc.cylinder(2, 1.6).setTranslation(0.3, 2, -25));
    const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 }, Math.PI / 2);
    const cop = new Vehicle(world, spec, { x: 0, y: 1, z: -60 });
    // Pretend it can see straight through: the worst case, aiming dead at the statue.
    const probe = obstacleProbe(world, cop.body, (c) => c.parent()?.handle === player.body.handle);
    const controller = new CopController(cop, {} as RoadGraph, () => true, COP_TUNING, null, probe);
    const target = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };

    let hitStatue = false;
    let reached = false;
    for (let i = 0; i < 10 / DT && !reached; i++) {
      target.position.copy(player.position);
      player.drive({ ...IDLE, handbrake: true }, DT);
      cop.drive(controller.update(DT, target), DT);
      world.step();
      player.snapshot();
      cop.snapshot();
      world.contactPair(statue, cop.collider, (m) => {
        for (let c = 0; c < m.numContacts(); c++) if (m.contactDist(c) < 0.05) hitStatue = true;
      });
      reached = cop.position.distanceTo(player.position) < 7;
    }
    expect(hitStatue).toBe(false);
    expect(reached).toBe(true);
  });
});
