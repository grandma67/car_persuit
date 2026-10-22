import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { COP_PATROL_SPEC, PLAYER_SPEC, TRACTOR_SPEC, type VehicleSpec } from './VehicleSpecs';
import { FARM } from '../gameplay/balance';
import type { DriveInput } from '../core/Input';

const DT = 1 / 60;
const IDLE: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const FULL: DriveInput = { ...IDLE, throttle: 1 };
/** A field from z = 40 to z = 140 (the car drives along +Z from z = 0). */
const FIELD = { z0: 40, z1: 140 };

function setup(spec: VehicleSpec, z: number, speed: number): { world: RAPIER.World; car: Vehicle } {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0));
  const car = new Vehicle(world, spec, { x: 0, y: 1, z });
  run(world, car, IDLE, 1);
  car.teleport(0, car.position.y, z, 0, speed);
  return { world, car };
}

function run(world: RAPIER.World, car: Vehicle, input: DriveInput, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) {
    car.drive(input, DT);
    world.step();
    car.snapshot();
  }
}

describe('soft ground (the Farm\'s fields)', () => {
  beforeAll(async () => {
    await RAPIER.init();
    Vehicle.softGround = { at: (_x, z) => z >= FIELD.z0 && z <= FIELD.z1, grip: FARM.fieldGrip, drag: FARM.fieldDrag };
  });
  afterAll(() => {
    Vehicle.softGround = null;
  });

  it('grip drops on the field and comes back off it', () => {
    const { world, car } = setup(PLAYER_SPEC, 0, 20);
    run(world, car, IDLE, 0.2);
    expect(car.onSoft).toBe(false);
    expect(car.controller.wheelFrictionSlip(0)).toBeCloseTo(PLAYER_SPEC.frictionSlip, 5);
    run(world, car, FULL, 2.2); // into the field
    expect(car.position.z).toBeGreaterThan(FIELD.z0);
    expect(car.onSoft).toBe(true);
    for (let i = 0; i < 4; i++) expect(car.controller.wheelFrictionSlip(i)).toBeCloseTo(PLAYER_SPEC.frictionSlip * FARM.fieldGrip, 5);
    run(world, car, FULL, 5); // and out the far side
    expect(car.position.z).toBeGreaterThan(FIELD.z1);
    expect(car.onSoft).toBe(false);
    for (let i = 0; i < 4; i++) expect(car.controller.wheelFrictionSlip(i)).toBeCloseTo(PLAYER_SPEC.frictionSlip, 5);
  });

  it.each([PLAYER_SPEC, COP_PATROL_SPEC, TRACTOR_SPEC].map((s) => [s.name, s] as const))('%s: coasting slows faster on the field', (_name, spec) => {
    const speed = Math.min(15, spec.maxSpeed);
    const hard = setup(spec, -200, speed);
    run(hard.world, hard.car, IDLE, 1.5);
    const soft = setup(spec, 60, speed);
    run(soft.world, soft.car, IDLE, 1.5);
    expect(soft.car.onSoft).toBe(true);
    const lostHard = speed - hard.car.speed, lostSoft = speed - soft.car.speed;
    expect(lostSoft).toBeGreaterThan(lostHard + FARM.fieldDrag * 1.5 * 0.8);
  });

  it('full throttle on the field is slower than on the road, but still quick', () => {
    const road = setup(PLAYER_SPEC, -400, 0);
    run(road.world, road.car, FULL, 3);
    const field = setup(PLAYER_SPEC, 50, 0);
    Vehicle.softGround = { at: () => true, grip: FARM.fieldGrip, drag: FARM.fieldDrag };
    run(field.world, field.car, FULL, 3);
    Vehicle.softGround = { at: (_x, z) => z >= FIELD.z0 && z <= FIELD.z1, grip: FARM.fieldGrip, drag: FARM.fieldDrag };
    expect(field.car.speed).toBeLessThan(road.car.speed);
    expect(field.car.speed).toBeGreaterThan(road.car.speed * 0.6);
  });
});
