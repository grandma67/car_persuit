// Chinatown's traffic on real cities with the district forced on (alone, and beside the Old City):
// civilians keep 40 km/h on the main street, don't jam, and get past the double-parked vans
// without touching them; buses and trucks may come in.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { CHINATOWN } from '../../gameplay/balance';
import { CivilianTraffic, TRAFFIC } from '../../ai/CivilianTraffic';
import { generateCity, type CityData } from '../CityGenerator';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint } from '../StreetProps';
import { approachControls, busStops, fastStreets } from '../TrafficControl';
import { keepOf } from '../driveSide';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';
import type { DistrictForce } from './place';

const DT = 1 / 60;

/** Seeds on flat ground with no canals (the sim's ground is a plane) whose Chinatown has a parked van. */
function flatSeeds(count: number, force: DistrictForce): [number, CityData, District][] {
  const out: [number, CityData, District][] = [];
  for (let i = 0; out.length < count && i < 300; i++) {
    const seed = i * 7919 + 11;
    const city = generateCity(seed, undefined, { force });
    const q = city.districts.find((d) => d.kind === 'chinatown');
    if (q && !city.terrain.hill && !city.terrain.canals.length && q.dressing.props.some((p) => p.kind === 'parkedVan')) out.push([seed, city, q]);
  }
  return out;
}

/** The ground, the buildings, every district solid and landmark, and the vans as kinematic bodies (as PropSystem makes them). */
function cityWorld(city: CityData): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setFriction(1));
  for (const b of city.buildings) world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z));
  for (const q of city.districts) {
    for (const s of q.dressing.solids) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(s.hx, 5, s.hz).setTranslation(s.x, 5, s.z).setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) }));
    }
  }
  for (const l of city.landmarks) {
    if (l.kind === 'ramp') continue;
    world.createCollider(RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 2, l.radius * 0.8).setTranslation(l.x, 2, l.z));
  }
  for (const v of city.streetProps.filter((p) => p.kind === 'parkedVan')) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, 0, v.z).setRotation({ x: 0, y: Math.sin(v.yaw / 2), z: 0, w: Math.cos(v.yaw / 2) }));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 1.15, 2.5).setTranslation(0, 1.15, 0), body);
  }
  return world;
}

function simulate(seed: number, city: CityData, q: District) {
  const world = cityWorld(city);
  const rules = districtTraffic(city);
  const traffic = new CivilianTraffic(
    world, new THREE.Scene(), city.graph, approachControls(city.graph, city.streetProps), new Rng(seed ^ 0x7a4f1c), 0,
    undefined, keepOf(city.driveSide), fastStreets(city.graph, city.streetProps), busStops(city.graph, city.streetProps), rules,
  );
  traffic.count = 30;
  const centre = new THREE.Vector3(q.bounds.x, 0, q.bounds.z);
  const vans = city.streetProps.filter((p) => p.kind === 'parkedVan');
  const vanFoot = vans.map((p) => propFootprint(p));
  const mainLines = q.mainStreet.map((k) => k.split('>').map((id) => city.graph.nodes[Number(id)]));
  // Well inside the main street (past the cap's easing-in at its ends).
  const onMain = (p: THREE.Vector3) => mainLines.some(([A, B]) => {
    const alongX = Math.abs(A.z - B.z) < 0.5;
    const [lo, hi] = alongX ? [Math.min(A.x, B.x), Math.max(A.x, B.x)] : [Math.min(A.z, B.z), Math.max(A.z, B.z)];
    const t = alongX ? p.x : p.z;
    return Math.abs(alongX ? p.z - A.z : p.x - A.x) < 6 && t > lo + 20 && t < hi - 20;
  });
  const stats = { seed, vans: vans.length, insideSeconds: 0, cars: 0, heavy: 0, vanTouches: 0, passedVans: 0, overCap: 0, jammed: 0 };
  const seen = new Set<object>();
  const passed = new Set<string>();
  const side = new Map<string, number>();
  for (let step = 0; step < 150 / DT; step++) {
    const t = step * DT;
    const player = centre.clone().add(new THREE.Vector3(Math.cos(t / 20) * 220, 0, Math.sin(t / 20) * 220));
    for (const car of traffic.cars) car.vehicle.drive(car.controller.update(DT, t), DT);
    world.step();
    for (const car of traffic.cars) car.vehicle.snapshot();
    traffic.cars.forEach((car, ci) => {
      const v = car.vehicle;
      const p = v.position;
      if (!inRect(q.bounds, p)) return;
      stats.insideSeconds += DT;
      if (!seen.has(car)) (seen.add(car), stats.cars++);
      if (['bus', 'boxtruck'].includes(v.spec.body ?? '')) stats.heavy++;
      const he = v.spec.halfExtents;
      const fwd = v.forward(new THREE.Vector3());
      const body = { x: p.x, z: p.z, hx: he.x, hz: he.z, yaw: Math.atan2(fwd.x, fwd.z) };
      if (vanFoot.some((f) => footprintsOverlap(body, { ...f, hx: f.hx + 0.05, hz: f.hz + 0.05 }))) stats.vanTouches++;
      // A car going past a van: the side of the van's cross line it's on flips while it's beside it.
      vans.forEach((van, vi) => {
        const ax = Math.sin(van.yaw), az = Math.cos(van.yaw);
        const along = (p.x - van.x) * ax + (p.z - van.z) * az;
        const across = Math.abs((p.x - van.x) * az - (p.z - van.z) * ax);
        if (across > 6) return;
        const key = `${ci}:${vi}`;
        const s = Math.sign(along);
        if (side.has(key) && side.get(key) !== s && !passed.has(`${car.vehicle.collider.handle}:${vi}`)) (passed.add(`${car.vehicle.collider.handle}:${vi}`), stats.passedVans++);
        side.set(key, s);
      });
      if (onMain(p) && v.speed > CHINATOWN.speed * 1.15) stats.overCap++;
      if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
    });
    traffic.update(player, []);
  }
  return stats;
}

describe('Chinatown traffic', () => {
  beforeAll(() => RAPIER.init());

  for (const [label, force] of [['alone', { chinatown: true, oldtown: false }], ['beside the Old City', { chinatown: true, oldtown: true }]] as const) {
    it(`civilians keep the main-street cap, never jam and get past the parked vans (${label})`, () => {
      const report = flatSeeds(2, force).map(([seed, city, q]) => simulate(seed, city, q));
      expect(report.length).toBeGreaterThan(0);
      for (const r of report) {
        expect(r.cars, JSON.stringify(r)).toBeGreaterThan(5);
        expect(r.vanTouches, JSON.stringify(r)).toBe(0);
        expect(r.passedVans, JSON.stringify(r)).toBeGreaterThan(0);
        expect(r.overCap * DT, JSON.stringify(r)).toBeLessThan(1); // seconds over the cap, all cars together
        expect(r.jammed, JSON.stringify(r)).toBe(0);
      }
    }, 180_000);
  }
});

describe('Chinatown runtime rules', () => {
  const placed = Array.from({ length: 20 }, (_, i) => i * 7919 + 11)
    .map((seed) => generateCity(seed, undefined, { force: { chinatown: true, oldtown: false } }))
    .filter((c) => c.districts.some((d) => d.kind === 'chinatown'));

  it('40 km/h on the main street only, 1.3× density, vans weighted up, buses allowed, no spawn skip, paifang roadblocks', () => {
    expect(placed.length).toBeGreaterThan(10);
    for (const city of placed) {
      const q = city.districts.find((d) => d.kind === 'chinatown')!;
      const rules = districtTraffic(city);
      const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
      for (const k of q.streets) expect(rules.limits.get(k)).toBe(main.has(k) ? CHINATOWN.speed : undefined);
      expect([...q.streets].some((k) => rules.noHeavy.has(k))).toBe(false);
      for (const id of q.interior) {
        const t = rules.nodes.get(id)!;
        expect(t.density).toBe(CHINATOWN.density);
        expect(t.heavy).toBe(true);
        expect(t.weights?.Van).toBe(CHINATOWN.vanWeight);
      }
      const skip = copSpawnSkips(city);
      expect(skip(q.bounds.x, q.bounds.z)).toBe(0);
      const gates = roadblockGates(city);
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(true);
    }
  });
});
