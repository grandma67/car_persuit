import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { PLAYER_SPEC } from './VehicleSpecs';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

// `vel`/`spin`/`position`/`quaternion` stand in for the Rapier getters (which allocate): they must
// read exactly what the getters would, after each step and after a write from outside the step.
describe('vehicle state without the Rapier getters', () => {
  beforeAll(() => RAPIER.init());

  const setup = () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
    const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
    return { world, car };
  };
  const live = (car: Vehicle) => {
    const v = car.body.linvel();
    const w = car.body.angvel();
    const t = car.body.translation();
    const r = car.body.rotation();
    expect(car.vel.toArray()).toEqual([v.x, v.y, v.z]);
    expect(car.spin.toArray()).toEqual([w.x, w.y, w.z]);
    expect(car.position.toArray()).toEqual([t.x, t.y, t.z]);
    expect(car.quaternion.toArray()).toEqual([r.x, r.y, r.z, r.w]);
  };

  it('match the body after every step: driving, drifting, traction assist', () => {
    const { world, car } = setup();
    car.tractionAssist = 6;
    const inputs = [
      { ...IDLE, throttle: 1 },
      { ...IDLE, throttle: 1, steer: 0.8, handbrake: true },
      { ...IDLE, throttle: 1, steer: -0.6 },
      { ...IDLE, brake: 1 },
    ];
    for (const input of inputs) {
      for (let i = 0; i < 90; i++) {
        car.drive(input, DT);
        world.step();
        car.snapshot();
        live(car);
      }
    }
    expect(car.vel.length()).toBeGreaterThan(0.5);
  });

  it('stay current through push and setVelocity', () => {
    const { world, car } = setup();
    for (let i = 0; i < 30; i++) {
      car.drive({ ...IDLE, throttle: 1 }, DT);
      world.step();
      car.snapshot();
    }
    car.push({ x: 300, y: 2000, z: -150 }, { x: 100, y: 0, z: 50 });
    live(car);
    car.setVelocity({ x: 1.1, y: 0.3, z: -7.7 }, { x: 0.1, y: 0.2, z: 0.3 });
    live(car);
    car.drive({ ...IDLE, throttle: 1 }, DT);
    world.step();
    car.snapshot();
    live(car);
  });
});
