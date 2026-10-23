// Test helpers for the district traffic tests (not used by the game): flat seeds with a district
// forced on, a physics world of the city, and a civilian traffic sim that hands every car to the
// test on every step. A test only says what it counts and what it expects.
import { expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { CHINATOWN } from '../../gameplay/balance';
import { CivilianTraffic, TRAFFIC, type Civilian } from '../../ai/CivilianTraffic';
import type { Vehicle } from '../../vehicles/Vehicle';
import { generateCity, type CityData } from '../CityGenerator';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint } from '../StreetProps';
import { approachControls, busStops, fastStreets } from '../TrafficControl';
import { keepOf } from '../driveSide';
import { districtTraffic, type DistrictTrafficRules } from './runtime';
import type { District, DistrictKind } from './District';
import type { DistrictForce } from './place';

export const DT = 1 / 60;

type Box = { x: number; z: number; hx: number; hz: number; yaw: number };

/** Seeds whose forced `kind` sits on flat ground with no canals (the sim's ground is a plane) and passes `keep`. */
export function flatSeeds(kind: DistrictKind, count: number, force: DistrictForce, keep: (q: District) => boolean = () => true): [number, CityData, District][] {
  const out: [number, CityData, District][] = [];
  for (let i = 0; out.length < count && i < 300; i++) {
    const seed = i * 7919 + 11;
    const city = generateCity(seed, undefined, { force });
    const q = city.districts.find((d) => d.kind === kind);
    if (q && !city.terrain.hill && !city.terrain.canals.length && keep(q)) out.push([seed, city, q]);
  }
  return out;
}

/** A fixed box collider standing on the ground, `h` half-height. */
export function addBox(world: RAPIER.World, s: Box, h: number): void {
  world.createCollider(RAPIER.ColliderDesc.cuboid(s.hx, h, s.hz).setTranslation(s.x, h, s.z).setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) }));
}

/** A physics world with the ground, the buildings, the given districts' solids and the landmarks (ramps aside). */
export function cityWorld(city: CityData, districts: readonly District[] = city.districts): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setFriction(1));
  for (const b of city.buildings) world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z));
  for (const q of districts) for (const s of q.dressing.solids) addBox(world, s, 5);
  for (const l of city.landmarks) {
    if (l.kind === 'ramp') continue;
    world.createCollider(RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 2, l.radius * 0.8).setTranslation(l.x, 2, l.z));
  }
  return world;
}

/** A car's footprint, for `footprintsOverlap`. */
export function carFootprint(v: Vehicle): Box {
  const p = v.position;
  const he = v.spec.halfExtents;
  const fwd = v.forward(new THREE.Vector3());
  return { x: p.x, z: p.z, hx: he.x, hz: he.z, yaw: Math.atan2(fwd.x, fwd.z) };
}

export interface SimOptions {
  world: RAPIER.World;
  /** The "player" circles this point at `radius` m, so traffic spawns all round it. */
  centre: { x: number; z: number };
  radius: number;
  seconds: number;
  rules?: DistrictTrafficRules;
}

/** 30 civilians driven for `seconds`; `each` sees every car after every physics step. */
export function simulate(seed: number, city: CityData, o: SimOptions, each: (car: Civilian, index: number) => void): void {
  const traffic = new CivilianTraffic(
    o.world, new THREE.Scene(), city.graph, approachControls(city.graph, city.streetProps), new Rng(seed ^ 0x7a4f1c), 0,
    undefined, keepOf(city.driveSide), fastStreets(city.graph, city.streetProps), busStops(city.graph, city.streetProps), o.rules ?? districtTraffic(city),
  );
  traffic.count = 30;
  const centre = new THREE.Vector3(o.centre.x, 0, o.centre.z);
  for (let step = 0; step < o.seconds / DT; step++) {
    const t = step * DT;
    const player = centre.clone().add(new THREE.Vector3(Math.cos(t / 20) * o.radius, 0, Math.sin(t / 20) * o.radius));
    for (const car of traffic.cars) car.vehicle.drive(car.controller.update(DT, t), DT);
    o.world.step();
    for (const car of traffic.cars) car.vehicle.snapshot();
    traffic.cars.forEach(each);
    traffic.update(player, []);
  }
}

// Parked vans (Chinatown's double-parked deliveries).

/** City world plus the vans as kinematic bodies (as PropSystem makes them). */
function vanWorld(city: CityData): RAPIER.World {
  const world = cityWorld(city);
  for (const v of city.streetProps.filter((p) => p.kind === 'parkedVan')) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, 0, v.z).setRotation({ x: 0, y: Math.sin(v.yaw / 2), z: 0, w: Math.cos(v.yaw / 2) }));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 1.15, 2.5).setTranslation(0, 1.15, 0), body);
  }
  return world;
}

function vanSim(seed: number, city: CityData, q: District, cap: number) {
  const vans = city.streetProps.filter((p) => p.kind === 'parkedVan');
  const vanFoot = vans.map((p) => propFootprint(p));
  const mainLines = q.mainStreet.map((k) => k.split('>').map((id) => city.graph.nodes[Number(id)]));
  // Well inside the main street (past the cap's easing-in at its ends).
  const onMain = (p: { x: number; z: number }) => mainLines.some(([A, B]) => {
    const alongX = Math.abs(A.z - B.z) < 0.5;
    const [lo, hi] = alongX ? [Math.min(A.x, B.x), Math.max(A.x, B.x)] : [Math.min(A.z, B.z), Math.max(A.z, B.z)];
    const t = alongX ? p.x : p.z;
    return Math.abs(alongX ? p.z - A.z : p.x - A.x) < 6 && t > lo + 20 && t < hi - 20;
  });
  const stats = { seed, vans: vans.length, insideSeconds: 0, cars: 0, heavy: 0, vanTouches: 0, passedVans: 0, nearCars: 0, overCap: 0, jammed: 0 };
  const seen = new Set<object>();
  const passed = new Set<string>();
  const side = new Map<string, number>();
  simulate(seed, city, { world: vanWorld(city), centre: q.bounds, radius: 220, seconds: 150 }, (car, ci) => {
    const v = car.vehicle;
    const p = v.position;
    if (!inRect(q.bounds, p)) return;
    stats.insideSeconds += DT;
    if (!seen.has(car)) (seen.add(car), stats.cars++);
    if (['bus', 'boxtruck'].includes(v.spec.body ?? '')) stats.heavy++;
    const body = carFootprint(v);
    if (vanFoot.some((f) => footprintsOverlap(body, { ...f, hx: f.hx + 0.05, hz: f.hz + 0.05 }))) stats.vanTouches++;
    // A car going past a van: the side of the van's cross line it's on flips while it's beside it.
    vans.forEach((van, vi) => {
      const ax = Math.sin(van.yaw), az = Math.cos(van.yaw);
      const along = (p.x - van.x) * ax + (p.z - van.z) * az;
      const across = Math.abs((p.x - van.x) * az - (p.z - van.z) * ax);
      if (across > 6) return;
      if (Math.abs(along) < 15 && !passed.has(`near:${car.vehicle.collider.handle}`)) (passed.add(`near:${car.vehicle.collider.handle}`), stats.nearCars++);
      const key = `${ci}:${vi}`;
      const s = Math.sign(along);
      if (side.has(key) && side.get(key) !== s && !passed.has(`${car.vehicle.collider.handle}:${vi}`)) (passed.add(`${car.vehicle.collider.handle}:${vi}`), stats.passedVans++);
      side.set(key, s);
    });
    if (onMain(p) && v.speed > cap * 1.15) stats.overCap++;
    if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
  });
  return stats;
}

/** Chinatown with `force`, two flat seeds with a parked van: civilians keep the main-street cap, never jam, get past the vans and never touch them. */
export function passVans(force: DistrictForce): void {
  const report = flatSeeds('chinatown', 2, force, (q) => q.dressing.props.some((p) => p.kind === 'parkedVan')).map(([seed, city, q]) => vanSim(seed, city, q, CHINATOWN.speed));
  expect(report.length).toBeGreaterThan(0);
  expect(report.some((r) => r.passedVans > 0), JSON.stringify(report)).toBe(true);
  for (const r of report) {
    expect(r.cars, JSON.stringify(r)).toBeGreaterThan(5);
    expect(r.vanTouches, JSON.stringify(r)).toBe(0);
    // Traffic may route clear of a van (the Old City next door changes the flows); a car that comes up to one gets past.
    if (r.nearCars > 0) expect(r.passedVans, JSON.stringify(r)).toBeGreaterThan(0);
    expect(r.overCap * DT, JSON.stringify(r)).toBeLessThan(1); // seconds over the cap, all cars together
    expect(r.jammed, JSON.stringify(r)).toBe(0);
  }
}
