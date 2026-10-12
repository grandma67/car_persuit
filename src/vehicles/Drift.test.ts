import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { PLAYER_SPEC } from './VehicleSpecs';
import type { DriveInput } from '../core/Input';

const DT = 1 / 60;
const IDLE: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function setup(): { world: RAPIER.World; car: Vehicle } {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0));
  const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
  run(world, car, IDLE, 1);
  car.teleport(0, car.position.y, 0, 0, 25);
  return { world, car };
}

function run(world: RAPIER.World, car: Vehicle, input: DriveInput, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) {
    car.drive(input, DT);
    world.step();
    car.snapshot();
  }
}

const flatSpeed = (car: Vehicle) => Math.hypot(car.body.linvel().x, car.body.linvel().z);

const heading = (car: Vehicle) => {
  const f = car.forward();
  return Math.atan2(f.x, f.z);
};

describe('handbrake vs footbrake', () => {
  beforeAll(() => RAPIER.init());

  it('footbrake stops straight; handbrake swings the tail out', () => {
    const a = setup();
    run(a.world, a.car, { ...IDLE, brake: 1, steer: 1 }, 0.8);
    const b = setup();
    run(b.world, b.car, { ...IDLE, handbrake: true, steer: 1 }, 0.8);
    // Handbrake rotates the car much further and slides it sideways.
    expect(Math.abs(heading(b.car))).toBeGreaterThan(Math.abs(heading(a.car)) * 1.5);
    expect(Math.abs(b.car.lateralSpeed)).toBeGreaterThan(3);
    // Footbrake keeps the tyres tracking: the car turns, it doesn't slide.
    expect(Math.abs(a.car.lateralSpeed)).toBeLessThan(2);
  });

  it('footbrake in a straight line stops the car without slewing', () => {
    const { world, car } = setup();
    run(world, car, { ...IDLE, brake: 1 }, 2.5);
    expect(car.speed).toBeLessThan(2);
    expect(Math.abs(heading(car))).toBeLessThan(0.05);
  });

  it('a handbrake flick, then throttle and counter-steer, holds a drift and drives out of it', () => {
    const { world, car } = setup();
    run(world, car, { ...IDLE, handbrake: true, steer: 1 }, 0.5);
    let minSpeed = Infinity;
    let slidingAfterRelease = 0;
    for (let i = 0; i < 0.8 / DT; i++) {
      run(world, car, { ...IDLE, throttle: 1 }, DT);
      minSpeed = Math.min(minSpeed, flatSpeed(car));
      if (Math.abs(car.lateralSpeed) > 4) slidingAfterRelease += DT;
    }
    // The slide carries on under power after the handbrake is let go, and keeps its speed.
    expect(slidingAfterRelease).toBeGreaterThan(0.5);
    expect(minSpeed).toBeGreaterThan(14);
    run(world, car, { ...IDLE, throttle: 1, steer: -0.4 }, 0.6);
    run(world, car, { ...IDLE, throttle: 1 }, 0.5);
    // Caught and straightened: a good 90°+ corner turned, not spun round, back up to speed.
    expect(Math.abs(car.lateralSpeed)).toBeLessThan(1);
    expect(Math.abs(heading(car))).toBeGreaterThan(1.4);
    expect(Math.abs(heading(car))).toBeLessThan(2.6);
    expect(flatSpeed(car)).toBeGreaterThan(18);
  });
});
