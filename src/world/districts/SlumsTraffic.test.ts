// The Slums' traffic and police on real cities with the district forced on: civilians don't jam on
// its streets past the kerb wrecks, heavies stay out, pickups and vans come in; cops spawn less,
// roadblocks go on its gates; NavGrid drives across the rubble lots and down the junkyard's
// corridors, never through the camp, a wreck stack or a ruin.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { SLUMS } from '../../gameplay/balance';
import { CivilianTraffic, TRAFFIC } from '../../ai/CivilianTraffic';
import { NavGrid } from '../../ai/NavGrid';
import { generateCity, type CityData } from '../CityGenerator';
import { footprintsOverlap, propFootprint } from '../StreetProps';
import { approachControls, busStops, fastStreets } from '../TrafficControl';
import { keepOf } from '../driveSide';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';
import { inDistrict } from './apply';
import { vacantLots } from './Slums';

const DT = 1 / 60;
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = { slums: true, oldtown: false, chinatown: false, harbor: false, farm: false };

/** Seeds on flat ground with no canals (the sim's ground is a plane). */
function flatSeeds(count: number): [number, CityData, District][] {
  const out: [number, CityData, District][] = [];
  for (let i = 0; out.length < count && i < 300; i++) {
    const seed = i * 7919 + 11;
    const city = generateCity(seed, undefined, { force: ALONE });
    const q = city.districts.find((d) => d.kind === 'slums');
    if (q && !city.terrain.hill && !city.terrain.canals.length) out.push([seed, city, q]);
  }
  return out;
}

/** The ground, the buildings, every district solid, and the wrecks (fixed: the worst case, none shoved aside). */
function cityWorld(city: CityData, q: District): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setFriction(1));
  for (const b of city.buildings) world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z));
  const box = (s: { x: number; z: number; hx: number; hz: number; yaw: number }, h: number) =>
    world.createCollider(RAPIER.ColliderDesc.cuboid(s.hx, h, s.hz).setTranslation(s.x, h, s.z).setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) }));
  for (const d of city.districts) for (const s of d.dressing.solids) box(s, 5);
  for (const p of q.dressing.props.filter((w) => w.kind === 'wreck')) box(propFootprint(p), 0.7);
  for (const l of city.landmarks) {
    if (l.kind === 'ramp') continue;
    world.createCollider(RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 2, l.radius * 0.8).setTranslation(l.x, 2, l.z));
  }
  return world;
}

function simulate(seed: number, city: CityData, q: District) {
  const world = cityWorld(city, q);
  const traffic = new CivilianTraffic(
    world, new THREE.Scene(), city.graph, approachControls(city.graph, city.streetProps), new Rng(seed ^ 0x7a4f1c), 0,
    undefined, keepOf(city.driveSide), fastStreets(city.graph, city.streetProps), busStops(city.graph, city.streetProps), districtTraffic(city),
  );
  traffic.count = 30;
  const centre = new THREE.Vector3(q.bounds.x, 0, q.bounds.z);
  const solids = [...q.dressing.solids, ...q.dressing.props.filter((p) => p.kind === 'wreck').map((p) => propFootprint(p))];
  const stats = { seed, cars: 0, wrecks: solids.length - q.dressing.solids.length, solidTouches: 0, jammed: 0, insideSeconds: 0 };
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

describe('Slums traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians come in and pass the kerb wrecks without jamming or touching a solid', () => {
    const report = flatSeeds(2).map(([seed, city, q]) => simulate(seed, city, q));
    expect(report.length).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.wrecks, JSON.stringify(r)).toBeGreaterThan(0);
      expect(r.cars, JSON.stringify(r)).toBeGreaterThan(3);
      expect(r.solidTouches, JSON.stringify(r)).toBe(0);
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
  }, 180_000);
});

describe('Slums runtime rules', () => {
  const placed = SEEDS.slice(0, 20).map((seed) => generateCity(seed, undefined, { force: ALONE })).filter((c) => c.districts.some((d) => d.kind === 'slums'));

  it('0.6× density, heavies out, pickups and vans weighted up, half the cop spawns skipped, gate roadblocks', () => {
    expect(placed.length).toBeGreaterThan(10);
    for (const city of placed) {
      const q = city.districts.find((d) => d.kind === 'slums')!;
      const rules = districtTraffic(city);
      for (const k of q.streets) expect(rules.noHeavy.has(k)).toBe(true);
      for (const id of q.interior) {
        const t = rules.nodes.get(id)!;
        expect(t.density).toBe(SLUMS.density);
        expect(t.weights?.Pickup).toBe(SLUMS.pickupWeight);
        expect(t.weights?.Van).toBe(SLUMS.vanWeight);
      }
      expect(copSpawnSkips(city)(q.bounds.x, q.bounds.z)).toBe(SLUMS.copSpawnSkip);
      const gates = roadblockGates(city);
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(true);
      // The overpass stands on one of those gates.
      const over = q.dressing.structures.find((s) => s.kind === 'overpass')!;
      expect(q.gates.some((g) => Math.hypot(g.x - over.x, g.z - over.z) < 20)).toBe(true);
    }
  });
});

describe('Slums police routing', () => {
  const placed = SEEDS.slice(0, 14).flatMap((seed) => {
    const c = generateCity(seed, undefined, { force: ALONE });
    const q = c.districts.find((d) => d.kind === 'slums');
    return q ? [[seed, c, q] as const] : [];
  });
  const hardOf = (q: District) => q.dressing.structures.filter((s) => s.kind === 'camp' || s.kind === 'wreckStack' || s.kind === 'ruin').flatMap((s) => s.footprints);
  const clearOf = (path: { x: number; z: number }[], hard: ReturnType<typeof hardOf>) => {
    for (const p of path) for (const s of hard) expect(footprintsOverlap({ x: p.x, z: p.z, hx: 0.5, hz: 0.5, yaw: 0 }, s)).toBe(false);
  };

  it.each(placed)('seed %i: NavGrid crosses a rubble lot hole to hole, never through the camp, a stack or a ruin', (_seed, city, q) => {
    const nav = new NavGrid(city);
    const hard = hardOf(q);
    let routed = 0;
    for (const v of vacantLots(q)) {
      if (v.holes.length < 2) continue;
      const [h0, h1] = v.holes;
      const a = { x: h0.x - h0.nx * 3, z: h0.z - h0.nz * 3 }, b = { x: h1.x - h1.nx * 3, z: h1.z - h1.nz * 3 };
      if (!nav.passable(a.x, a.z) || !nav.passable(b.x, b.z)) continue;
      // From the street outside one hole, into the lot and out of the other onto its street.
      const from = { x: h0.x + h0.nx * 6, z: h0.z + h0.nz * 6 }, to = { x: h1.x + h1.nx * 6, z: h1.z + h1.nz * 6 };
      const path = nav.findPath(a, b, 200000);
      expect(path).not.toBeNull();
      clearOf(path!, hard);
      const len = path!.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path![i].x, p.z - path![i].z), 0);
      expect(len).toBeLessThan(Math.hypot(b.x - a.x, b.z - a.z) * 1.5); // straight across, not out and round
      for (const [x, y] of [[from, a], [b, to]]) {
        const leg = nav.findPath(x, y, 200000);
        expect(leg).not.toBeNull(); // the holes let it in from one street and out onto the other
        clearOf(leg!, hard);
      }
      routed++;
    }
    const corridors = q.dressing.drivable.filter((d) => !vacantLots(q).some((v) => v.rect === d));
    for (const r of corridors) {
      const alongX = r.w > r.d;
      const half = (alongX ? r.w : r.d) / 2 - 4;
      const a = alongX ? { x: r.x - half, z: r.z } : { x: r.x, z: r.z - half };
      const b = alongX ? { x: r.x + half, z: r.z } : { x: r.x, z: r.z + half };
      if (!nav.passable(a.x, a.z) || !nav.passable(b.x, b.z)) continue;
      const path = nav.findPath(a, b, 200000);
      expect(path).not.toBeNull();
      clearOf(path!, hard);
      routed++;
    }
    // Heaps, stacks and the camp block their cells (a ruin's thin wall stubs stand inside its heap).
    for (const s of hard.filter((f) => Math.min(f.hx, f.hz) >= 1)) expect(nav.passable(s.x, s.z)).toBe(false);
    expect(routed).toBeGreaterThan(0);
  });
});
