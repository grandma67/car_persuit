import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { BOX_TRUCK_SPEC, BUS_SPEC, PICKUP_SPEC, PLAYER_SPEC, RAMP, RAMP_TRUCK_SPEC, VAN_SPEC } from './VehicleSpecs';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function flatWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  return world;
}

function step(world: RAPIER.World, cars: [Vehicle, typeof IDLE][], seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    for (const [v, input] of cars) v.drive(input, DT);
    world.step();
    for (const [v] of cars) v.snapshot();
    each?.();
  }
}

describe('civilian heavies', () => {
  beforeAll(() => RAPIER.init());

  it.each([VAN_SPEC, PICKUP_SPEC, BUS_SPEC, BOX_TRUCK_SPEC, RAMP_TRUCK_SPEC])('$name settles on its wheels and drives', (spec) => {
    const world = flatWorld();
    const v = new Vehicle(world, spec, { x: 0, y: 1.2 - (spec.wheelY ?? 0), z: 0 });
    step(world, [[v, IDLE]], 2);
    // Body clear of the road, all wheels down.
    expect(v.position.y - spec.halfExtents.y).toBeGreaterThan(0.2);
    for (let i = 0; i < 4; i++) expect(v.controller.wheelIsInContact(i)).toBe(true);
    step(world, [[v, { ...IDLE, throttle: 1 }]], 4);
    expect(v.speed).toBeGreaterThan(8);
  });
});

describe('ramp truck', () => {
  beforeAll(() => RAPIER.init());

  // Dead centre, and off to one side (a car's width off-centre still lands on the deck).
  it.each([0, 1.0])('launches a car that catches it from behind over the cab (offset %s m)', (offset) => {
    const world = flatWorld();
    const truck = new Vehicle(world, RAMP_TRUCK_SPEC, { x: 0, y: 1.2, z: 0 });
    const car = new Vehicle(world, PLAYER_SPEC, { x: offset, y: 1, z: -30 });
    const cruise = { ...IDLE, throttle: 0.5 };
    step(world, [[truck, IDLE], [car, IDLE]], 1);

    let peak = 0;
    let passedCab = false;
    step(world, [[truck, cruise], [car, { ...IDLE, throttle: 1 }]], 6, () => {
      peak = Math.max(peak, car.position.y);
      // Ahead of the cab's front without having hit it head on.
      if (car.position.z > truck.position.z + RAMP.cab.z1 + 2) passedCab = true;
    });
    expect(peak).toBeGreaterThan(truck.position.y + RAMP.cab.top + 0.5);
    expect(passedCab).toBe(true);
    // The truck shrugs it off.
    const up = truck.body.rotation();
    expect(Math.abs(up.x) + Math.abs(up.z)).toBeLessThan(0.1);
  });
});
