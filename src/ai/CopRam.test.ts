import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import type { RoadGraph } from '../world/RoadGraph';
import { CopController } from './CopController';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

describe('cop ramming', () => {
  beforeAll(() => RAPIER.init());

  it.each(Object.values(COP_SPECS))('$name keeps backing off and ramming a stopped suspect instead of just pushing', (spec) => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 }, Math.PI / 2);
    const cop = new Vehicle(world, spec, { x: 0, y: 1, z: -16 });
    // Open ground in plain sight: the cop never needs the road graph.
    const controller = new CopController(cop, {} as RoadGraph, () => true);
    const target = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };

    let hits = 0;
    let touching = false;
    const states = new Set<string>();
    // Each ram shoves the (sliding) suspect a few metres before the cop backs off: ~3-4 s a cycle.
    for (let i = 0; i < 16 / DT; i++) {
      target.position.copy(player.position);
      const pv = player.body.linvel();
      target.velocity.set(pv.x, 0, pv.z);
      player.drive({ ...IDLE, handbrake: true }, DT);
      cop.drive(controller.update(DT, target), DT);
      world.step();
      player.snapshot();
      cop.snapshot();
      states.add(controller.state);
      let now = false;
      world.contactPair(player.collider, cop.collider, (m) => {
        for (let c = 0; c < m.numContacts(); c++) if (m.contactDist(c) < 0.05) now = true;
      });
      if (now && !touching) hits++;
      touching = now;
    }
    expect(states.has('backoff')).toBe(true);
    expect(hits).toBeGreaterThanOrEqual(4);
  });
});
