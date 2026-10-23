// The Old City's traffic and police, on real cities with the district forced on: civilians obey
// the speed cap and the no-heavies rule, don't jam inside, and never touch the kerb clutter; cop
// spawns inside the walls are rarer than without the district's skip.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { DISTRICTS, OLD_CITY, WANTED } from '../../gameplay/balance';
import { TRAFFIC } from '../../ai/CivilianTraffic';
import { CopDirector, DIRECTOR_TUNING } from '../../ai/CopDirector';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint } from '../StreetProps';
import { keepOf } from '../driveSide';
import { copSpawnSkips, roadblockGates } from './runtime';
import { carFootprint, cityWorld, DT, flatSeeds, simulate } from './trafficSim';

const HEAVY = new Set(['bus', 'boxtruck', 'truck', 'ramptruck']);
const FORCE = { oldtown: true };

describe('Old City traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians keep the cap, keep heavies out, never touch the clutter and do not jam inside', () => {
    const report: Record<string, number>[] = [];
    for (const [seed, city, q] of flatSeeds('oldtown', 2, FORCE)) {
      // The "player" circles off to one side, so traffic spawns all round the district.
      const clutter = q.dressing.props.map((p) => propFootprint(p));
      const inner: typeof q.bounds = { ...q.bounds, w: q.bounds.w - 30, d: q.bounds.d - 30 }; // past the cap's easing-in
      const stats = { seed, insideSeconds: 0, cars: 0, heavyInside: 0, clutterTouches: 0, overCap: 0, jammed: 0 };
      const seen = new Set<object>();
      simulate(seed, city, { world: cityWorld(city, [q]), centre: q.bounds, radius: 220, seconds: 150 }, (car) => {
        const v = car.vehicle;
        const p = v.position;
        if (!inRect(q.bounds, p)) return;
        stats.insideSeconds += DT;
        if (!seen.has(car)) (seen.add(car), stats.cars++);
        if (HEAVY.has(v.spec.body ?? '')) stats.heavyInside++;
        const body = carFootprint(v);
        if (clutter.some((f) => footprintsOverlap(body, f))) stats.clutterTouches++;
        if (inRect(inner, p) && v.speed > OLD_CITY.speed * 1.15) stats.overCap++;
        if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
      });
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
    for (const [, city, q] of flatSeeds('oldtown', 6, FORCE)) {
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
    for (const [seed, city, q] of flatSeeds('oldtown', 4, FORCE)) {
      // The player waits at junctions 150–230 m from the district, so its streets are in spawn range.
      const d = (n: { x: number; z: number }) => Math.hypot(n.x - q.bounds.x, n.z - q.bounds.z);
      const targets = city.graph.nodes.filter((n) => n.neighbors.length && d(n) > 150 && d(n) < 230).slice(0, 16);
      for (const target of targets) {
        for (const mode of ['skip', 'none'] as const) {
          const world = cityWorld(city, [q]);
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
