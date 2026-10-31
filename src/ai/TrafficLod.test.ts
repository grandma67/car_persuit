import { beforeAll, describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { generateCity } from '../world/CityGenerator';
import { approachControls } from '../world/TrafficControl';
import { CivilianTraffic, TRAFFIC } from './CivilianTraffic';

const DT = 1 / 60;

// Traffic LOD: past lodNear from the player and every cop a civilian thinks every lodEvery-th step,
// standing for the steps between; closer, every step. Driving under it: IntersectionSim.lod.test.ts.
describe('traffic LOD', () => {
  beforeAll(() => RAPIER.init());

  const setup = (lod: boolean) => {
    const city = generateCity(11);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
    const traffic = new CivilianTraffic(world, new THREE.Scene(), city.graph, approachControls(city.graph, city.streetProps), new Rng(5), 0);
    traffic.lod = lod;
    traffic.count = 12;
    const player = new THREE.Vector3(city.spawn.x, 0, city.spawn.z);
    for (let i = 0; i < 200 && traffic.cars.length < traffic.count; i++) traffic.update(player);
    traffic.update(player); // bands the last one spawned, as the next frame does
    return { world, traffic, player };
  };

  it('a far car thinks every lodEvery-th step, for the time since; near the player or a cop, every step', () => {
    const { world, traffic, player } = setup(true);
    expect(traffic.cars.length).toBeGreaterThan(4);
    // Spawned 170+ m away by road: all far.
    expect(traffic.cars.every((c) => c.controller.every === TRAFFIC.lodEvery)).toBe(true);
    const spies = traffic.cars.map((c) => vi.spyOn(c.controller, 'update'));
    for (let s = 0; s < 3 * TRAFFIC.lodEvery; s++) {
      traffic.drive(DT, s * DT);
      world.step();
      for (const c of traffic.cars) c.vehicle.snapshot();
    }
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(3);
      for (const [dt] of spy.mock.calls.slice(1)) expect(dt).toBeCloseTo(TRAFFIC.lodEvery * DT, 9);
    }
    // A cop beside one car brings it (only it) back to every step; so does the player.
    const target = traffic.cars[0];
    const cop = new Vehicle(world, PLAYER_SPEC, { x: target.vehicle.position.x + 30, y: 1, z: target.vehicle.position.z });
    traffic.update(player, [cop]);
    expect(target.controller.every).toBe(1);
    expect(traffic.cars.filter((c) => c.controller.every === 1).length).toBeLessThan(traffic.cars.length);
    traffic.update(target.vehicle.position.clone());
    expect(target.controller.every).toBe(1);
  });

  it('off (the sims), every car thinks every step', () => {
    const { traffic } = setup(false);
    traffic.update(new THREE.Vector3(1e4, 0, 1e4));
    expect(traffic.cars.every((c) => c.controller.every === 1)).toBe(true);
  });
});
