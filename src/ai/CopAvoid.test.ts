import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { RoadGraph } from '../world/RoadGraph';
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
    const probe = obstacleProbe(world, cop.body, (c) => c.parent()?.handle === player.body.handle, undefined, spec.halfExtents.x);
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

  it.each(Object.values(COP_SPECS))('$name brakes behind a stalled car it cannot get round, and stops short of it', (spec) => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    // A 5 m lane between walls: no room to swerve past.
    for (const x of [-3.5, 3.5]) world.createCollider(RAPIER.ColliderDesc.cuboid(1, 2, 200).setTranslation(x, 2, 50));
    const stalled = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
    const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 200 });
    const cop = new Vehicle(world, spec, { x: 0, y: 1, z: -90 });
    cop.body.setLinvel({ x: 0, y: 0, z: 25 }, true);
    const graph = new RoadGraph([
      { id: 0, x: 0, z: -150, neighbors: [1] },
      { id: 1, x: 0, z: 250, neighbors: [0] },
    ]);
    const probe = obstacleProbe(world, cop.body, (c) => c.parent()?.handle === player.body.handle, undefined, spec.halfExtents.x);
    // Out of sight: following the road toward the suspect beyond the stalled car.
    const controller = new CopController(cop, graph, () => false, COP_TUNING, null, probe);
    const target = { position: player.position, velocity: new THREE.Vector3() };

    let hit = false;
    for (let i = 0; i < 8 / DT; i++) {
      stalled.drive({ ...IDLE, handbrake: true }, DT);
      cop.drive(controller.update(DT, target), DT);
      world.step();
      stalled.snapshot();
      cop.snapshot();
      world.contactPair(stalled.collider, cop.collider, (m) => {
        for (let c = 0; c < m.numContacts(); c++) if (m.contactDist(c) < 0.05) hit = true;
      });
    }
    expect(hit).toBe(false);
    expect(Math.abs(cop.speed)).toBeLessThan(1);
    expect(cop.position.z).toBeGreaterThan(-25); // came up behind it, not stopped miles back
  });
});
