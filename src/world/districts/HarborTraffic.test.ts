// The Harbor's traffic and police on real cities with the district forced on: civilians don't jam
// on its streets or the seafront road under the cranes, heavies come in; NavGrid drives the yard's
// corridors and never through a stack; three districts together place the same way every time.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { HARBOR } from '../../gameplay/balance';
import { CivilianTraffic, TRAFFIC } from '../../ai/CivilianTraffic';
import { NavGrid } from '../../ai/NavGrid';
import { generateCity, type CityData } from '../CityGenerator';
import { footprintsOverlap } from '../StreetProps';
import { approachControls, busStops, fastStreets } from '../TrafficControl';
import { keepOf } from '../driveSide';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';
import { inDistrict } from './apply';

const DT = 1 / 60;
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = { harbor: true, oldtown: false, chinatown: false, farm: false };

/** Seeds on flat ground with no canals (the sim's ground is a plane). */
function flatSeeds(count: number): [number, CityData, District][] {
  const out: [number, CityData, District][] = [];
  for (let i = 0; out.length < count && i < 300; i++) {
    const seed = i * 7919 + 11;
    const city = generateCity(seed, undefined, { force: ALONE });
    const q = city.districts.find((d) => d.kind === 'harbor');
    if (q && !city.terrain.hill && !city.terrain.canals.length) out.push([seed, city, q]);
  }
  return out;
}

/** The ground, the buildings, every district solid and landmark. */
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
  return world;
}

function simulate(seed: number, city: CityData, q: District) {
  const world = cityWorld(city);
  const traffic = new CivilianTraffic(
    world, new THREE.Scene(), city.graph, approachControls(city.graph, city.streetProps), new Rng(seed ^ 0x7a4f1c), 0,
    undefined, keepOf(city.driveSide), fastStreets(city.graph, city.streetProps), busStops(city.graph, city.streetProps), districtTraffic(city),
  );
  traffic.count = 30;
  const centre = new THREE.Vector3(q.bounds.x, 0, q.bounds.z);
  const solids = q.dressing.solids;
  const stats = { seed, cars: 0, heavy: 0, solidTouches: 0, jammed: 0, insideSeconds: 0 };
  const seen = new Set<object>();
  for (let step = 0; step < 120 / DT; step++) {
    const t = step * DT;
    const player = centre.clone().add(new THREE.Vector3(Math.cos(t / 20) * 200, 0, Math.sin(t / 20) * 200));
    for (const car of traffic.cars) car.vehicle.drive(car.controller.update(DT, t), DT);
    world.step();
    for (const car of traffic.cars) car.vehicle.snapshot();
    for (const car of traffic.cars) {
      const v = car.vehicle;
      const p = v.position;
      if (!inDistrict(q, p)) continue;
      stats.insideSeconds += DT;
      if (!seen.has(car)) {
        seen.add(car);
        stats.cars++;
        if (['bus', 'boxtruck'].includes(v.spec.body ?? '')) stats.heavy++;
      }
      const he = v.spec.halfExtents;
      const fwd = v.forward(new THREE.Vector3());
      const body = { x: p.x, z: p.z, hx: he.x, hz: he.z, yaw: Math.atan2(fwd.x, fwd.z) };
      if (solids.some((f) => footprintsOverlap(body, f))) stats.solidTouches++;
      if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
    }
    traffic.update(player, []);
  }
  return stats;
}

describe('Harbor traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians come in, heavies too, and never jam or touch a crane leg, stack or truck', () => {
    const report = flatSeeds(2).map(([seed, city, q]) => simulate(seed, city, q));
    expect(report.length).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.cars, JSON.stringify(r)).toBeGreaterThan(5);
      expect(r.solidTouches, JSON.stringify(r)).toBe(0);
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
    expect(report.some((r) => r.heavy > 0), JSON.stringify(report)).toBe(true);
  }, 180_000);
});

describe('Harbor runtime rules', () => {
  const placed = SEEDS.slice(0, 20).map((seed) => generateCity(seed, undefined, { force: ALONE })).filter((c) => c.districts.some((d) => d.kind === 'harbor'));

  it('no speed cap, 0.9× density, box trucks and vans weighted up, buses allowed, no spawn skip, gate roadblocks', () => {
    expect(placed.length).toBeGreaterThan(10);
    for (const city of placed) {
      const q = city.districts.find((d) => d.kind === 'harbor')!;
      const rules = districtTraffic(city);
      for (const k of q.streets) expect(rules.limits.has(k)).toBe(false);
      expect([...q.streets].some((k) => rules.noHeavy.has(k))).toBe(false);
      for (const id of q.interior) {
        const t = rules.nodes.get(id)!;
        expect(t.density).toBe(HARBOR.density);
        expect(t.weights?.['Box truck']).toBe(HARBOR.boxTruckWeight);
        expect(t.weights?.Van).toBe(HARBOR.vanWeight);
      }
      expect(copSpawnSkips(city)(q.bounds.x, q.bounds.z)).toBe(0);
      const gates = roadblockGates(city);
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(true);
      // The apron's trucks are parked solids, not traffic.
      expect(q.dressing.props.some((p) => p.kind === 'parkedVan')).toBe(false);
    }
  });
});

describe('Harbor police routing', () => {
  const placed = SEEDS.slice(0, 12).flatMap((seed) => {
    const c = generateCity(seed, undefined, { force: ALONE });
    const q = c.districts.find((d) => d.kind === 'harbor');
    return q ? [[seed, c, q] as const] : [];
  });

  it.each(placed)('seed %i: NavGrid drives a yard corridor end to end and never through a stack', (_seed, city, q) => {
    const nav = new NavGrid(city);
    const stacks = q.dressing.structures.filter((s) => s.kind === 'stack' || s.kind === 'flatcar').flatMap((s) => s.footprints);
    // The corridors along the rows (not the cross one), end to end at the fence line.
    const corridors = q.dressing.drivable.filter((r) => q.dressing.drivable.some((o) => o !== r && (r.w > r.d) === (o.w > o.d)));
    expect(corridors.length).toBeGreaterThan(0);
    let routed = 0;
    for (const r of corridors) {
      const alongX = r.w > r.d;
      const half = (alongX ? r.w : r.d) / 2 - 4;
      const a = alongX ? { x: r.x - half, z: r.z } : { x: r.x, z: r.z - half };
      const b = alongX ? { x: r.x + half, z: r.z } : { x: r.x, z: r.z + half };
      if (!nav.passable(a.x, a.z) || !nav.passable(b.x, b.z)) continue;
      const path = nav.findPath(a, b, 200000);
      expect(path).not.toBeNull();
      routed++;
      for (const p of path!) for (const s of stacks) expect(footprintsOverlap({ x: p.x, z: p.z, hx: 0.5, hz: 0.5, yaw: 0 }, s)).toBe(false);
      // Straight through where no straddle carrier stands in it (their gaps may send it round by the next corridor).
      if (q.dressing.structures.some((st) => st.kind === 'straddle' && Math.abs(alongX ? st.z - r.z : st.x - r.x) < 2)) continue;
      const len = path!.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path![i].x, p.z - path![i].z), 0);
      expect(len).toBeLessThan(Math.hypot(b.x - a.x, b.z - a.z) * 1.3);
    }
    expect(routed).toBeGreaterThan(0);
  });
});

describe('three districts together', () => {
  const ALL = { oldtown: true, chinatown: true, harbor: true };
  it.each(SEEDS.slice(0, 15))('seed %i: places the same districts in the same places every time, apart', (seed) => {
    const a = generateCity(seed, undefined, { force: ALL });
    const b = generateCity(seed, undefined, { force: ALL });
    const sig = (c: CityData) => JSON.stringify(c.districts.map((q) => [q.kind, q.grid, [...q.roles], q.dressing.solids.length, q.dressing.props.length]));
    expect(sig(a)).toBe(sig(b));
    for (let i = 0; i < a.districts.length; i++) {
      for (let j = i + 1; j < a.districts.length; j++) {
        const g = a.districts[i].grid, h = a.districts[j].grid;
        const apart = h.i0 >= g.i0 + g.w + 1 || g.i0 >= h.i0 + h.w + 1 || h.j0 >= g.j0 + g.h + 1 || g.j0 >= h.j0 + h.h + 1;
        expect(apart).toBe(true);
      }
    }
  });

  it('the Harbor places on most seeds with all three forced on', () => {
    const n = SEEDS.filter((seed) => generateCity(seed, undefined, { force: ALL }).districts.some((q) => q.kind === 'harbor')).length;
    expect(n).toBeGreaterThan(SEEDS.length * 0.7);
  });
});
