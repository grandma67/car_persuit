import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { RoadGraph } from '../world/RoadGraph';
import { Rng } from '../core/Rng';
import { CivilianController } from './CivilianController';
import { forwardObstacle } from './CivilianTraffic';
import { hazardSpeedLimit, type Mover, type Self } from './awareness';

// Heading +X at 10 m/s from the origin. Right of +X is +Z.
const me: Self = { handle: 0, x: 0, z: 0, vx: 10, vz: 0, fx: 1, fz: 0, halfWidth: 0.95, halfLength: 2.2, turning: false };
const mover = (m: Partial<Mover>): Mover => ({ handle: 1, x: 0, z: 0, vx: 0, vz: 0, civilian: false, ...m });

describe('hazardSpeedLimit', () => {
  it('brakes for the player crossing in front, hard when it is close', () => {
    // Player 20m ahead, 20m to the side, crossing at 10 m/s: both reach (20, 0) in 2s.
    const soon = hazardSpeedLimit(me, [mover({ x: 20, z: 20, vz: -10 })], 10);
    expect(soon).toBeLessThan(10);
    const now = hazardSpeedLimit(me, [mover({ x: 10, z: 10, vz: -10 })], 10);
    expect(now).toBe(0);
  });

  it('ignores traffic that will miss us, stands still, or is behind', () => {
    expect(hazardSpeedLimit(me, [mover({ x: 40, z: -6, vx: -10 })], 10)).toBe(Infinity); // oncoming lane
    expect(hazardSpeedLimit(me, [mover({ x: 15, z: 0 })], 10)).toBe(Infinity); // parked: the sensor's job
    expect(hazardSpeedLimit(me, [mover({ x: -10, z: 0, vx: 20 })], 10)).toBe(Infinity); // closing from behind
    expect(hazardSpeedLimit(me, [mover({ handle: 0, x: 20, z: 20, vz: -10 })], 10)).toBe(Infinity); // ourselves
  });

  it('between civilians only the one with the other on its right gives way', () => {
    const fromRight = mover({ x: 20, z: 20, vz: -10, civilian: true });
    const fromLeft = mover({ x: 20, z: -20, vz: 10, civilian: true });
    expect(hazardSpeedLimit(me, [fromRight], 10)).toBeLessThan(10);
    expect(hazardSpeedLimit(me, [fromLeft], 10)).toBe(Infinity);
  });

  it('a turning civilian gives way to oncoming traffic', () => {
    // Oncoming civilian slightly to our left, on a course through our nose.
    const oncoming = mover({ x: 30, z: -1, vx: -10, civilian: true });
    expect(hazardSpeedLimit(me, [oncoming], 10)).toBe(Infinity);
    expect(hazardSpeedLimit({ ...me, turning: true }, [oncoming], 10)).toBeLessThan(10);
  });
});

describe('crash recovery', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('a civilian wedged behind a car sideways across its lane backs off, drives round and carries on', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    const graph = new RoadGraph([
      { id: 0, x: 0, z: 0, neighbors: [1] },
      { id: 1, x: 100, z: 0, neighbors: [0, 2] },
      { id: 2, x: 200, z: 0, neighbors: [1] },
    ]);
    // Heading +X in the right-hand lane (z = +3); a crashed car sits across that lane at x = 45.
    const car = new Vehicle(world, PLAYER_SPEC, { x: 20, y: 1.2, z: 3 }, Math.PI / 2);
    const wreck = new Vehicle(world, PLAYER_SPEC, { x: 45, y: 1.2, z: 3 }, 0);
    const awareness = { obstacle: (v: Vehicle, range: number) => forwardObstacle(world, v, range), movers: () => [] };
    const driver = new CivilianController(car, graph, new Map(), () => Infinity, new Rng(1), 0, 1, awareness);
    const hold = { throttle: 0, brake: 0, steer: 0, handbrake: true };

    let stoppedShort = false;
    let t = 0;
    for (; t < 30 && car.position.x < 70; t += 1 / 60) {
      car.drive(driver.update(1 / 60, t), 1 / 60);
      wreck.drive(hold, 1 / 60);
      world.step();
      car.snapshot();
      wreck.snapshot();
      if (car.position.x > 30 && car.position.x < 42 && Math.abs(car.speed) < 0.3) stoppedShort = true;
    }
    expect(stoppedShort).toBe(true); // it stopped behind the wreck rather than ploughing into it
    expect(car.position.x).toBeGreaterThan(70); // then got round it and carried on
    expect(driver.stuckFor).toBeLessThan(6); // without being written off as stuck
    expect(Math.hypot(wreck.position.x - 45, wreck.position.z - 3)).toBeLessThan(0.3); // and without shunting it
  });
});
