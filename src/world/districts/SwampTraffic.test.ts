// The Swamp's traffic and police on real cities with the district forced on: civilians come in and
// pass the kerb rails without jamming, heavies stay out, pickups come in; cops spawn less,
// roadblocks go on its gates; NavGrid takes a boardwalk across a pool block rather than wading.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { alone } from '../paramsTesting';
import { SWAMP } from '../../gameplay/balance';
import { TRAFFIC } from '../../ai/CivilianTraffic';
import { NavGrid } from '../../ai/NavGrid';
import { generateCity, type CityData } from '../CityGenerator';
import { deckPoint, inDeck } from '../Deck';
import { footprintsOverlap, propFootprint } from '../StreetProps';
import { inWater } from '../Water';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { District } from './District';
import { inDistrict } from './apply';
import { carFootprint, cityWorld, DT, flatCities, simulate } from './trafficSim';
import { swampPools } from './Swamp';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = alone('swamp');

function trafficSim(seed: number, city: CityData, q: District) {
  const solids = [...q.dressing.solids, ...q.dressing.props.filter((p) => p.kind === 'fence').map((p) => propFootprint(p))];
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

describe('Swamp traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians come in and drive the causeways past the kerb rails without jamming or touching anything', () => {
    const report = flatCities('swamp', ['swamp'], 2).map(([seed, city, q]) => trafficSim(seed, city, q));
    expect(report.length).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.cars, JSON.stringify(r)).toBeGreaterThan(2);
      expect(r.solidTouches, JSON.stringify(r)).toBe(0);
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
  }, 180_000);
});

describe('Swamp runtime rules', () => {
  const placed = SEEDS.slice(0, 20).map((seed) => generateCity(seed, undefined, { force: ALONE })).filter((c) => c.districts.some((d) => d.kind === 'swamp'));

  it('0.4× density, heavies out, pickups weighted up, cop spawns skipped, gate roadblocks', () => {
    expect(placed.length).toBeGreaterThan(10);
    for (const city of placed) {
      const q = city.districts.find((d) => d.kind === 'swamp')!;
      const rules = districtTraffic(city);
      for (const k of q.streets) expect(rules.noHeavy.has(k)).toBe(true);
      for (const id of q.interior) {
        const t = rules.nodes.get(id)!;
        expect(t.density).toBe(SWAMP.density);
        expect(t.weights?.Pickup).toBe(SWAMP.pickupWeight);
      }
      expect(copSpawnSkips(city)(q.bounds.x, q.bounds.z)).toBe(SWAMP.copSpawnSkip);
      const gates = roadblockGates(city);
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(true);
    }
  });
});

describe('Swamp police routing', () => {
  const placed = SEEDS.slice(0, 14).flatMap((seed) => {
    const c = generateCity(seed, undefined, { force: ALONE });
    const q = c.districts.find((d) => d.kind === 'swamp');
    return q && (q.dressing.decks ?? []).length > 1 ? [[seed, c, q] as const] : [];
  });

  it.each(placed)('seed %i: NavGrid crosses a pool block on its boardwalk, not through the water, a tree or a shack', (_seed, city, q) => {
    const nav = new NavGrid(city);
    const pools = swampPools(city, q);
    const hard = [...q.dressing.solids, ...q.dressing.props.filter((p) => p.kind === 'tree').map((p) => propFootprint(p))];
    for (const d of (q.dressing.decks ?? []).slice(1)) {
      // From the street outside one end to the street outside the other.
      const a = deckPoint(d, 0, -d.hz - 6), b = deckPoint(d, 0, d.hz + 6);
      const path = nav.findPath(a, b, 300000);
      expect(path).not.toBeNull();
      const pts: { x: number; z: number }[] = [];
      for (let i = 1; i < path!.length; i++) {
        const p0 = path![i - 1], p1 = path![i];
        const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z));
        for (let t = 0; t <= n; t++) pts.push({ x: p0.x + ((p1.x - p0.x) * t) / Math.max(1, n), z: p0.z + ((p1.z - p0.z) * t) / Math.max(1, n) });
      }
      const wading = pts.filter((p) => pools.some((w) => inWater(w, p.x, p.z, 0.5)) && !inDeck(d, p.x, p.z, 0.5)).length;
      const len = path!.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - path![i].x, p.z - path![i].z), 0);
      const onDeck = pts.filter((p) => inDeck(d, p.x, p.z, 0.5)).length;
      // Either it takes the boardwalk, or it goes round by the streets (never wading through).
      expect(wading, `deck at ${d.x.toFixed(0)},${d.z.toFixed(0)}: ${wading} m wading`).toBe(0);
      if (onDeck < d.hz) expect(len).toBeGreaterThan(d.hz * 2 + 12);
      for (const p of pts) for (const s of hard) expect(footprintsOverlap({ x: p.x, z: p.z, hx: 0.3, hz: 0.3, yaw: 0 }, s)).toBe(false);
    }
  });
});
