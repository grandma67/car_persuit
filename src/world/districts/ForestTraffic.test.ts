// The Forest's traffic and police on real cities with the district forced on: civilians come in and
// drive its streets past the gate posts and the log arch without jamming, heavies stay out, pickups
// come in; cops spawn less, roadblocks go on its gates. (NavGrid keeping to the tracks: Forest.test.)
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { alone } from '../paramsTesting';
import { FOREST } from '../../gameplay/balance';
import { TRAFFIC } from '../../ai/CivilianTraffic';
import { generateCity, type CityData } from '../CityGenerator';
import { footprintsOverlap } from '../StreetProps';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';
import { inDistrict } from './apply';
import { carFootprint, cityWorld, DT, flatCities, simulate } from './trafficSim';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = alone('forest');

function trafficSim(seed: number, city: CityData, q: District) {
  const solids = q.dressing.solids;
  const stats = { seed, cars: 0, solidTouches: 0, jammed: 0, insideSeconds: 0 };
  const seen = new Set<object>();
  simulate(seed, city, { world: cityWorld(city), centre: q.bounds, radius: 200, seconds: 120 }, (car) => {
    const v = car.vehicle;
    if (!inDistrict(q, v.position)) return;
    stats.insideSeconds += DT;
    if (!seen.has(car)) (seen.add(car), stats.cars++);
    if (solids.some((f) => footprintsOverlap(carFootprint(v), f))) stats.solidTouches++;
    if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
  });
  return stats;
}

describe('Forest traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians come in and drive the woods\' streets past the posts and the arch without jamming or touching anything', () => {
    const report = flatCities('forest', ['forest', 'lumberyard'], 2).map(([seed, city, q]) => trafficSim(seed, city, q));
    expect(report.length).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.cars, JSON.stringify(r)).toBeGreaterThan(2);
      expect(r.solidTouches, JSON.stringify(r)).toBe(0);
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
  }, 180_000);
});

describe('Forest runtime rules', () => {
  const placed = SEEDS.slice(0, 20).map((seed) => generateCity(seed, undefined, { force: ALONE })).filter((c) => c.districts.some((d) => d.kind === 'forest'));

  it('0.5× density, heavies out, pickups weighted up, cop spawns skipped, gate roadblocks', () => {
    expect(placed.length).toBeGreaterThan(10);
    for (const city of placed) {
      const q = city.districts.find((d) => d.kind === 'forest')!;
      const rules = districtTraffic(city);
      for (const k of q.streets) expect(rules.noHeavy.has(k)).toBe(true);
      for (const id of q.interior) {
        const t = rules.nodes.get(id)!;
        expect(t.density).toBe(FOREST.density);
        expect(t.weights?.Pickup).toBe(FOREST.pickupWeight);
      }
      expect(copSpawnSkips(city)(q.bounds.x, q.bounds.z)).toBe(FOREST.copSpawnSkip);
      const gates = roadblockGates(city);
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(true);
    }
  });
});
