// The Old City's traffic and police, on real cities with the district forced on: civilians obey
// the speed cap and the no-heavies rule, don't jam inside, and never touch the kerb clutter; cop
// spawns inside the walls are rarer than without the district's skip.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { DISTRICTS, OLD_CITY, WANTED } from '../../gameplay/balance';
import { CivilianTraffic, TRAFFIC } from '../../ai/CivilianTraffic';
import { CopDirector, DIRECTOR_TUNING } from '../../ai/CopDirector';
import { generateCity, type CityData } from '../CityGenerator';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint } from '../StreetProps';
import { approachControls, busStops, fastStreets } from '../TrafficControl';
import { keepOf } from '../driveSide';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';

const DT = 1 / 60;
const HEAVY = new Set(['bus', 'boxtruck', 'truck', 'ramptruck']);

/** Seeds whose forced Old City sits on flat ground (the sim's ground is a plane). */
function flatSeeds(count: number): [number, CityData, District][] {
  const out: [number, CityData, District][] = [];
  for (let i = 0; out.length < count && i < 200; i++) {
    const seed = i * 7919 + 11;
    const city = generateCity(seed, undefined, { force: { oldtown: true } });
    const q = city.districts.find((d) => d.kind === 'oldtown');
    if (q && !city.terrain.hill && !city.terrain.canals.length) out.push([seed, city, q]);
  }
  return out;
}

/** A physics world with the ground, the buildings and every solid the district adds. */
function cityWorld(city: CityData, q: District): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setFriction(1));
  for (const b of city.buildings) world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z));
  for (const s of q.dressing.solids) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(s.hx, 5, s.hz).setTranslation(s.x, 5, s.z).setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) }));
  }
  for (const l of city.landmarks) {
    if (l.kind === 'ramp') continue;
    world.createCollider(RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 2, l.radius * 0.8).setTranslation(l.x, 2, l.z));
  }
  return world;
}

describe('Old City traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians keep the cap, keep heavies out, never touch the clutter and do not jam inside', () => {
    const report: Record<string, number>[] = [];
    for (const [seed, city, q] of flatSeeds(2)) {
      const world = cityWorld(city, q);
      const rules = districtTraffic(city);
      const traffic = new CivilianTraffic(
        world, new THREE.Scene(), city.graph, approachControls(city.graph, city.streetProps), new Rng(seed ^ 0x7a4f1c), 0,
        undefined, keepOf(city.driveSide), fastStreets(city.graph, city.streetProps), busStops(city.graph, city.streetProps), rules,
      );
      traffic.count = 30;
      // The "player" stands off to one side, so traffic spawns all round the district.
      const centre = new THREE.Vector3(q.bounds.x, 0, q.bounds.z);
      const clutter = q.dressing.props.map((p) => propFootprint(p));
      const inner: typeof q.bounds = { ...q.bounds, w: q.bounds.w - 30, d: q.bounds.d - 30 }; // past the cap's easing-in
      const stats = { seed, insideSeconds: 0, cars: 0, heavyInside: 0, clutterTouches: 0, overCap: 0, jammed: 0 };
      const seen = new Set<object>();
      for (let step = 0; step < 150 / DT; step++) {
        const t = step * DT;
        const player = centre.clone().add(new THREE.Vector3(Math.cos(t / 20) * 220, 0, Math.sin(t / 20) * 220));
        for (const car of traffic.cars) car.vehicle.drive(car.controller.update(DT, t), DT);
        world.step();
        for (const car of traffic.cars) car.vehicle.snapshot();
        for (const car of traffic.cars) {
          const v = car.vehicle;
          const p = v.position;
          if (!inRect(q.bounds, p)) continue;
          stats.insideSeconds += DT;
          if (!seen.has(car)) (seen.add(car), stats.cars++);
          if (HEAVY.has(v.spec.body ?? '')) stats.heavyInside++;
          const he = v.spec.halfExtents;
          const fwd = v.forward(new THREE.Vector3());
          const body = { x: p.x, z: p.z, hx: he.x, hz: he.z, yaw: Math.atan2(fwd.x, fwd.z) };
          if (clutter.some((f) => footprintsOverlap(body, f))) stats.clutterTouches++;
          if (inRect(inner, p) && v.speed > OLD_CITY.speed * 1.15) stats.overCap++;
          if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
        }
        traffic.update(player, []);
      }
      report.push(stats);
    }
    expect(report.length).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.cars, JSON.stringify(r)).toBeGreaterThan(5);
      expect(r.heavyInside, JSON.stringify(r)).toBe(0);
      expect(r.clutterTouches, JSON.stringify(r)).toBe(0);
      expect(r.overCap * DT, JSON.stringify(r)).toBeLessThan(1); // seconds over the cap, all cars together
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
  }, 120_000);

  it('kerb clutter leaves every lane clear: nothing within clutterMinOffset of a centre line', () => {
    for (const [, city, q] of flatSeeds(6)) {
      for (const p of q.dressing.props) {
        const fp = propFootprint(p);
        const reach = Math.hypot(fp.hx, fp.hz);
        for (const { rect } of city.roads.filter((r) => footprintsOverlap(rectFootprint({ ...r.rect, w: r.rect.w + 10, d: r.rect.d + 10 }), fp))) {
          const lateral = rect.w > rect.d ? Math.abs(p.z - rect.z) : Math.abs(p.x - rect.x);
          expect(lateral - reach).toBeGreaterThanOrEqual(DISTRICTS.clutterMinOffset - 1e-6);
        }
      }
    }
  });
});

describe('Old City police', () => {
  beforeAll(() => RAPIER.init());

  it('cop spawns inside the walls are rarer than without the skip', () => {
    const inside = { skip: 0, none: 0 };
    let total = 0;
    for (const [seed, city, q] of flatSeeds(4)) {
      // The player waits at junctions 150–230 m from the district, so its streets are in spawn range.
      const d = (n: { x: number; z: number }) => Math.hypot(n.x - q.bounds.x, n.z - q.bounds.z);
      const targets = city.graph.nodes.filter((n) => n.neighbors.length && d(n) > 150 && d(n) < 230).slice(0, 16);
      for (const target of targets) {
        for (const mode of ['skip', 'none'] as const) {
          const world = cityWorld(city, q);
          const districts = mode === 'skip' ? { skipAt: copSpawnSkips(city), gates: roadblockGates(city) } : { skipAt: () => 0, gates: new Set<string>() };
          const director = new CopDirector(world, new THREE.Scene(), city.graph, () => false, new Rng(seed ^ target.id), 0, { ...DIRECTOR_TUNING, firstSpawnDelay: 0 }, undefined, keepOf(city.driveSide), null, districts);
          const player = { position: new THREE.Vector3(target.x, 0.5, target.z), velocity: new THREE.Vector3() };
          // A 5★-sized pack: few enough that hidden spots never run out (the fallback isn't skipped).
          const level = { ...WANTED[2], maxCops: 10, spawnInterval: 0, roadblocks: false };
          for (let i = 0; i < 10; i++) director.update(0.1, player, new THREE.Vector3(1, 0, 0), level, null, null);
          inside[mode] += director.cops.filter((c) => inRect(q.bounds, c.vehicle.position)).length;
          if (mode === 'skip') total += director.cops.length;
        }
      }
    }
    expect(total).toBeGreaterThan(400);
    expect(inside.none).toBeGreaterThan(10);
    expect(inside.skip).toBeLessThan(inside.none * 0.75);
  }, 120_000);
});
