// The Harbor's traffic and police on real cities with the district forced on: civilians don't jam
// on its streets or the seafront road under the cranes, heavies come in; NavGrid drives the yard's
// corridors and never through a stack; three districts together place the same way every time.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HARBOR } from '../../gameplay/balance';
import { TRAFFIC } from '../../ai/CivilianTraffic';
import { NavGrid } from '../../ai/NavGrid';
import { generateCity, type CityData } from '../CityGenerator';
import { footprintsOverlap } from '../StreetProps';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';
import { inDistrict } from './apply';
import { carFootprint, cityWorld, DT, flatSeeds, simulate } from './trafficSim';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = { harbor: true, oldtown: false, chinatown: false, farm: false, slums: false };

function solidSim(seed: number, city: CityData, q: District) {
  const world = cityWorld(city);
  const solids = q.dressing.solids;
  const stats = { seed, cars: 0, heavy: 0, solidTouches: 0, jammed: 0, insideSeconds: 0 };
  const seen = new Set<object>();
  simulate(seed, city, { world, centre: q.bounds, radius: 200, seconds: 120 }, (car) => {
    const v = car.vehicle;
    if (!inDistrict(q, v.position)) return;
    stats.insideSeconds += DT;
    if (!seen.has(car)) {
      seen.add(car);
      stats.cars++;
      if (['bus', 'boxtruck'].includes(v.spec.body ?? '')) stats.heavy++;
    }
    const body = carFootprint(v);
    if (solids.some((f) => footprintsOverlap(body, f))) stats.solidTouches++;
    if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
  });
  return stats;
}

describe('Harbor traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians come in, heavies too, and never jam or touch a crane leg, stack or truck', () => {
    const report = flatSeeds('harbor', 2, ALONE).map(([seed, city, q]) => solidSim(seed, city, q));
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
