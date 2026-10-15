import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { PLAYER_SPEC } from './VehicleSpecs';
import { RAMP, rampDeckHulls } from '../world/Landmarks';
import { Health } from '../gameplay/Health';

const DT = 1 / 60;

/**
 * Flat out off a town-square ramp at `speed`, with `pitch`/`roll` rad/s of tumble added as the car
 * leaves the lip. Returns the crash damage taken from takeoff to just after touchdown, and the
 * ground speed kept through the landing.
 */
function jump(speed: number, pitch: number, roll: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(1));
  for (const pts of rampDeckHulls(RAMP, 16)) world.createCollider(RAPIER.ColliderDesc.convexHull(pts)!.setFriction(1));
  const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: RAMP.toe - 15 });
  car.teleport(0, 0.9, RAMP.toe - 15, 0, speed);
  const health = new Health();
  let takeoff = 0;
  let landedAt = -1;
  for (let i = 0; i < 6 / DT; i++) {
    car.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false }, DT);
    world.step();
    car.snapshot();
    const hit = car.consumeImpact();
    const v = car.body.linvel();
    if (!takeoff && !car.grounded && car.position.z > RAMP.lip) {
      takeoff = Math.hypot(v.x, v.z);
      const w = car.body.angvel();
      car.body.setAngvel({ x: w.x + pitch, y: w.y, z: w.z + roll }, true);
    }
    if (takeoff) health.applyImpact(hit);
    if (takeoff && landedAt < 0 && car.grounded) landedAt = i;
    if (landedAt >= 0 && i === landedAt + 30) return { damage: 100 - health.value, kept: Math.hypot(v.x, v.z) / takeoff };
  }
  throw new Error('never landed');
}

describe('ramp landings', () => {
  beforeAll(() => RAPIER.init());

  // Nose down, nose up, rolled, both: a car leaving the lip tumbling still lands on its wheels.
  it.each([
    [0.8, 0],
    [-1.2, 0],
    [0, 1.5],
    [0.6, 0.6],
  ])('a fast jump tumbling (pitch %f, roll %f rad/s) lands without wrecking the car or its speed', (pitch, roll) => {
    const { damage, kept } = jump(35, pitch, roll);
    expect(damage).toBeLessThan(5);
    expect(kept).toBeGreaterThan(0.8);
  });
});
