// Potholes: each wheel that drops into one takes an upward kick at that wheel (harder the faster),
// once per hole, and only inside a pothole's rect.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { PLAYER_SPEC } from './VehicleSpecs';
import { SLUMS } from '../gameplay/balance';
import type { DriveInput } from '../core/Input';

const DT = 1 / 60;
const IDLE: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const FULL: DriveInput = { ...IDLE, throttle: 1 };
type Box = { x: number; z: number; w: number; d: number };
const inside = (r: Box, x: number, z: number) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;

/** Drive along +Z from z = 0 at 15 m/s for `seconds`; the jolts taken and how high the body bounced. */
function drive(holes: Box[], seconds: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0));
  const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
  const step = (input: DriveInput) => {
    car.drive(input, DT);
    world.step();
    car.snapshot();
  };
  for (let i = 0; i < 60; i++) step(IDLE);
  car.teleport(0, car.position.y, 0, 0, 15);
  const hits: { x: number; z: number }[] = [];
  Vehicle.potholes = { at: (x, z) => { const hit = holes.some((r) => inside(r, x, z)); if (hit) hits.push({ x, z }); return hit; }, kick: SLUMS.potholeKick };
  let lift = 0;
  const y0 = car.position.y;
  for (let i = 0; i < seconds / DT; i++) {
    step(FULL);
    lift = Math.max(lift, Math.abs(car.body.linvel().y));
  }
  return { jolts: car.jolts, hits, lift, y0 };
}

describe('potholes', () => {
  beforeAll(() => RAPIER.init());
  afterEach(() => (Vehicle.potholes = null));

  it('every wheel crossing a hole across the lane takes one kick', () => {
    const r = drive([{ x: 0, z: 30, w: 4, d: 0.8 }], 3);
    expect(r.jolts).toBe(4);
    expect(r.lift).toBeGreaterThan(drive([], 3).lift + 0.1); // the body bounces
  });

  it('a hole under one side jolts only that side', () => {
    const r = drive([{ x: PLAYER_SPEC.wheelX, z: 30, w: 0.6, d: 0.8 }], 3);
    expect(r.jolts).toBe(2);
  });

  it('no jolt anywhere but on a pothole rect', () => {
    expect(drive([{ x: 6, z: 30, w: 2, d: 2 }], 3).jolts).toBe(0);
    expect(drive([], 3).jolts).toBe(0);
  });
});
