import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { BOX_TRUCK_SPEC, BUS_SPEC, PICKUP_SPEC, PLAYER_SPEC, RAMP_TRUCK_SPEC, VAN_SPEC, type VehicleSpec } from '../vehicles/VehicleSpecs';
import { RoadGraph } from '../world/RoadGraph';
import { CivilianController } from './CivilianController';
import { asCivilian } from './CivilianTraffic';

const DT = 1 / 60;
const HALF_ROAD = 6; // CityGenerator roadWidth 12

// A crossroads at (100,0), arms 100m long, each continuing one more block so no route doubles back.
// Coming from the west in the right-hand lane (z=+3): north (+z) is a right turn, south a left.
const RIGHT = 2;
const LEFT = 3;
const STRAIGHT = 4;
function crossroads(): RoadGraph {
  return new RoadGraph([
    { id: 0, x: 0, z: 0, neighbors: [1] },
    { id: 1, x: 100, z: 0, neighbors: [0, 2, 3, 4] },
    { id: 2, x: 100, z: 100, neighbors: [1, 5] },
    { id: 3, x: 100, z: -100, neighbors: [1, 6] },
    { id: 4, x: 200, z: 0, neighbors: [1, 7] },
    { id: 5, x: 100, z: 200, neighbors: [2] },
    { id: 6, x: 100, z: -200, neighbors: [3] },
    { id: 7, x: 300, z: 0, neighbors: [4] },
  ]);
}
const onRoad = (x: number, z: number) => Math.abs(z) <= HALF_ROAD || Math.abs(x - 100) <= HALF_ROAD;
const STOP_LINE = 10.4; // junction centre → stop line (CivilianController)
/**
 * How far a point is over the centre line into the oncoming lane, on the road we came in on or the
 * one we leave by, beyond the stop line, where that road's traffic queues for the junction.
 */
function intoOncoming(x: number, z: number, to: number): number {
  if (x < 100 - STOP_LINE) return -z; // came in at z = +3, heading +x
  if (to === RIGHT && z > STOP_LINE) return x - 100; // leaving +z: lane at x = 97
  if (to === LEFT && z < -STOP_LINE) return 100 - x; // leaving -z: lane at x = 103
  if (to === STRAIGHT && x > 100 + STOP_LINE) return -z;
  return 0;
}
const distOffRoad = (x: number, z: number) => (onRoad(x, z) ? 0 : Math.min(Math.abs(z), Math.abs(x - 100)) - HALF_ROAD);

/**
 * Drive a civilian through the junction; report how far any wheel or body corner strayed off the
 * road. keep -1: left-hand traffic, starting in the left lane (z = -3). The crossroads mirrors
 * across z = 0 onto the right-hand one, so oncoming-lane checks run on the mirrored position.
 */
function driveThrough(spec: VehicleSpec, to: number, keep: 1 | -1 = 1) {
  const mirroredTo = keep > 0 ? to : to === RIGHT ? LEFT : to === LEFT ? RIGHT : to;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const v = new Vehicle(world, spec, { x: 40, y: 1.2 - (spec.wheelY ?? 0), z: 3 * keep }, Math.PI / 2);
  const c = new CivilianController(v, crossroads(), new Map(), () => Infinity, new Rng(1), 0, 1, undefined, keep);
  const internals = c as unknown as { route: number[]; rebuild(): void };
  internals.route = [0, 1, to, to + 3, to];
  internals.rebuild();

  const { wheelX, wheelZ, halfExtents: h } = spec;
  const wheels = [[wheelX, wheelZ], [-wheelX, wheelZ], [wheelX, -wheelZ], [-wheelX, -wheelZ]];
  const corners = [[h.x, h.z], [-h.x, h.z], [h.x, -h.z], [-h.x, -h.z]];
  const exit = to === RIGHT ? { x: 100, z: 40 } : to === LEFT ? { x: 100, z: -40 } : { x: 160, z: 0 };
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const worst = (pts: number[][], measure = distOffRoad) =>
    Math.max(...pts.map(([x, z]) => (p.set(x, 0, z).applyQuaternion(q).add(v.position), measure(p.x, p.z))));

  let wheelsOff = 0;
  let bodyOff = 0;
  let lateral = 0;
  let oncoming = 0;
  const signals = new Set<string | null>(); // indicator on the approach, 30m out to the junction
  let t = 0;
  for (; t < 40; t += DT) {
    v.drive(c.update(DT, t), DT);
    if (v.position.x > 70 && v.position.x < 95) signals.add(v.indicator);
    world.step();
    v.snapshot();
    const r = v.body.rotation();
    q.set(r.x, r.y, r.z, r.w);
    wheelsOff = Math.max(wheelsOff, worst(wheels));
    bodyOff = Math.max(bodyOff, worst(corners));
    oncoming = Math.max(oncoming, worst(corners, (x, z) => intoOncoming(x, z * keep, mirroredTo)));
    lateral = Math.max(lateral, Math.abs(v.body.angvel().y * v.speed));
    if (Math.hypot(v.position.x - exit.x, v.position.z - exit.z) < 5) break;
  }
  return { arrived: t < 40, wheelsOff, bodyOff, lateral, oncoming, signals: [...signals] };
}

const CARS = [{ ...PLAYER_SPEC, body: 'sedan' as const }, VAN_SPEC, PICKUP_SPEC].map((s) => asCivilian(s));
const HEAVIES = [BUS_SPEC, BOX_TRUCK_SPEC].map((s) => asCivilian(s)).concat(RAMP_TRUCK_SPEC);
const label = (spec: VehicleSpec) => spec.body ?? 'sports';

describe('civilian turns', () => {
  beforeAll(() => RAPIER.init());

  it.each(HEAVIES.flatMap((s) => [[label(s), 'right', s, RIGHT], [label(s), 'left', s, LEFT]] as const))(
    '%s takes a %s turn wide and gently, wheels on the road',
    (_name, _turn, spec, to) => {
      const r = driveThrough(spec, to);
      expect(r.arrived).toBe(true);
      // The ramp truck's wheels sit outside a deck two cars wide; it fills the lane.
      expect(r.wheelsOff).toBeLessThan(spec.body === 'ramptruck' ? 0.5 : 0.3);
      // The front overhang sweeps wider than the wheels (on a left turn too): like a real bus,
      // it may swing out over the pavement, but not far.
      expect(r.bodyOff).toBeLessThan(1);
      expect(r.lateral).toBeLessThan(2.5); // m/s²: a bus corners gently
    },
  );

  // Turning right, a heavy's front sweeps over the new road's centre line where its traffic waits
  // at the stop line, blocking it: so they turn left or carry on instead when there's the choice.
  it.each(HEAVIES.map((s) => [label(s), s] as const))('%s keeps off right turns when it has another way on', (_name, spec) => {
    for (let seed = 1; seed <= 40; seed++) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const v = new Vehicle(world, spec, { x: 40, y: 1.2, z: 3 }, Math.PI / 2);
      const c = new CivilianController(v, crossroads(), new Map(), () => Infinity, new Rng(seed), 0, 1);
      expect((c as unknown as { route: number[] }).route[2]).not.toBe(RIGHT);
    }
  });

  it('cars still turn right', () => {
    const spec = CARS[0];
    const picks = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const v = new Vehicle(world, spec, { x: 40, y: 1.2, z: 3 }, Math.PI / 2);
      picks.add((new CivilianController(v, crossroads(), new Map(), () => Infinity, new Rng(seed), 0, 1) as unknown as { route: number[] }).route[2]);
    }
    expect(picks.has(RIGHT)).toBe(true);
  });

  it.each(HEAVIES.flatMap((s) => [[label(s), 'left', s, LEFT], [label(s), 'straight on', s, STRAIGHT]] as const))(
    '%s going %s stays out of the lanes where traffic queues for the junction',
    (_name, _turn, spec, to) => {
      const r = driveThrough(spec, to);
      expect(r.arrived).toBe(true);
      expect(r.oncoming).toBeLessThan(0.3);
    },
  );

  it.each(CARS.flatMap((s) => [[label(s), 'right', s, RIGHT], [label(s), 'left', s, LEFT], [label(s), 'straight on', s, STRAIGHT]] as const))(
    '%s turns %s and stays on the road',
    (_name, _turn, spec, to) => {
      const r = driveThrough(spec, to);
      expect(r.arrived).toBe(true);
      expect(r.wheelsOff).toBeLessThan(0.3);
      // Indicates the whole approach: the side it turns to, nothing going straight on.
      expect(r.signals).toEqual([to === RIGHT ? 'right' : to === LEFT ? 'left' : null]);
    },
  );

  // England: everyone keeps left. The near-side (tight) turn is now the left one.
  describe('keeping left', () => {
    it.each(CARS.flatMap((s) => [[label(s), 'left', s, LEFT], [label(s), 'right', s, RIGHT], [label(s), 'straight on', s, STRAIGHT]] as const))(
      '%s turns %s in the left lane, signalling the way it goes',
      (_name, _turn, spec, to) => {
        const r = driveThrough(spec, to, -1);
        expect(r.arrived).toBe(true);
        expect(r.wheelsOff).toBeLessThan(0.3);
        expect(r.oncoming).toBeLessThan(0.8);
        expect(r.signals).toEqual([to === RIGHT ? 'right' : to === LEFT ? 'left' : null]);
      },
    );

    it.each(HEAVIES.flatMap((s) => [[label(s), 'right', s, RIGHT], [label(s), 'straight on', s, STRAIGHT]] as const))(
      '%s going %s keeps out of the queueing lanes',
      (_name, _turn, spec, to) => {
        const r = driveThrough(spec, to, -1);
        expect(r.arrived).toBe(true);
        expect(r.oncoming).toBeLessThan(0.3);
      },
    );

    it.each(HEAVIES.map((s) => [label(s), s] as const))('%s keeps off left turns when it has another way on', (_name, spec) => {
      for (let seed = 1; seed <= 40; seed++) {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        const v = new Vehicle(world, spec, { x: 40, y: 1.2, z: -3 }, Math.PI / 2);
        const c = new CivilianController(v, crossroads(), new Map(), () => Infinity, new Rng(seed), 0, 1, undefined, -1);
        expect((c as unknown as { route: number[] }).route[2]).not.toBe(LEFT);
      }
    });

    it.each(HEAVIES.map((s) => [label(s), s] as const))('%s still gets round a left turn with its wheels on the road', (_name, spec) => {
      const r = driveThrough(spec, LEFT, -1);
      expect(r.arrived).toBe(true);
      expect(r.wheelsOff).toBeLessThan(spec.body === 'ramptruck' ? 0.5 : 0.3);
    });
  });
});
