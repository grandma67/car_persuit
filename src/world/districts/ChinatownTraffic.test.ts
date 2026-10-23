// Chinatown's traffic on real cities with the district forced on (alone, and beside the Old City):
// civilians keep 40 km/h on the main street, don't jam, and get past the double-parked vans
// without touching them; buses and trucks may come in.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CHINATOWN } from '../../gameplay/balance';
import { generateCity } from '../CityGenerator';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import { passVans } from './trafficSim';

describe('Chinatown traffic', () => {
  beforeAll(() => RAPIER.init());

  // Beside the Old City: ChinatownTrafficOldCity.test.ts (its own file, so the two sims run in parallel).
  it('civilians keep the main-street cap, never jam and get past the parked vans (alone)', () => passVans({ chinatown: true, oldtown: false }), 180_000);
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
