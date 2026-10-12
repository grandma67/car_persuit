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
const distOffRoad = (x: number, z: number) => (onRoad(x, z) ? 0 : Math.min(Math.abs(z), Math.abs(x - 100)) - HALF_ROAD);

/** Drive a civilian through the junction; report how far any wheel or body corner strayed off the road. */
function driveThrough(spec: VehicleSpec, to: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const v = new Vehicle(world, spec, { x: 40, y: 1.2 - (spec.wheelY ?? 0), z: 3 }, Math.PI / 2);
  const c = new CivilianController(v, crossroads(), new Map(), () => Infinity, new Rng(1), 0, 1);
  const internals = c as unknown as { route: number[]; rebuild(): void };
  internals.route = [0, 1, to, to + 3, to];
  internals.rebuild();

  const { wheelX, wheelZ, halfExtents: h } = spec;
  const wheels = [[wheelX, wheelZ], [-wheelX, wheelZ], [wheelX, -wheelZ], [-wheelX, -wheelZ]];
  const corners = [[h.x, h.z], [-h.x, h.z], [h.x, -h.z], [-h.x, -h.z]];
  const exit = to === RIGHT ? { x: 100, z: 40 } : to === LEFT ? { x: 100, z: -40 } : { x: 160, z: 0 };
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const worst = (pts: number[][]) =>
    Math.max(...pts.map(([x, z]) => (p.set(x, 0, z).applyQuaternion(q).add(v.position), distOffRoad(p.x, p.z))));

  let wheelsOff = 0;
  let bodyOff = 0;
  let lateral = 0;
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
    lateral = Math.max(lateral, Math.abs(v.body.angvel().y * v.speed));
    if (Math.hypot(v.position.x - exit.x, v.position.z - exit.z) < 5) break;
  }
  return { arrived: t < 40, wheelsOff, bodyOff, lateral, signals: [...signals] };
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
});
