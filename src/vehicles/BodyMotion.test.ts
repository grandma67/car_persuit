import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { PLAYER_SPEC } from './VehicleSpecs';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function setup() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
  const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
  car.gearShifts = true;
  const run = (input: typeof IDLE, seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds / DT; i++) {
      car.drive(input, DT);
      world.step();
      car.snapshot();
      car.syncMesh(1);
      each?.();
    }
  };
  return { car, run };
}

describe('body on its suspension', () => {
  beforeAll(() => RAPIER.init());

  it('squats pulling away, dives braking, and rocks back level at rest', () => {
    const { car, run } = setup();
    run(IDLE, 1);
    let squat = 0;
    run({ ...IDLE, throttle: 1 }, 1.5, () => (squat = Math.min(squat, car.mesh.body.rotation.x)));
    expect(squat).toBeLessThan(-0.01); // nose up
    let dive = 0;
    run({ ...IDLE, brake: 1 }, 1.2, () => (dive = Math.max(dive, car.mesh.body.rotation.x)));
    expect(dive).toBeGreaterThan(0.02); // nose down
    run(IDLE, 3);
    expect(Math.abs(car.mesh.body.rotation.x)).toBeLessThan(0.005);
    expect(Math.abs(car.mesh.body.rotation.z)).toBeLessThan(0.005);
  });

  it('leans out of a turn', () => {
    const { car, run } = setup();
    run({ ...IDLE, throttle: 1 }, 2);
    let roll = 0;
    // Steering right: the outside (left, +X) goes down.
    run({ ...IDLE, throttle: 0.4, steer: 1 }, 1, () => (roll = Math.min(roll, car.mesh.body.rotation.z)));
    expect(roll).toBeLessThan(-0.01);
  });

  it('shifts up through the gears, with a kick each time the clutch bites', () => {
    const { car, run } = setup();
    let shifts = 0;
    run({ ...IDLE, throttle: 1 }, 6, () => car.consumeShift() && shifts++);
    expect(shifts).toBeGreaterThanOrEqual(3);
  });
});
