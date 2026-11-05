// The Mega-park's traffic and police on real cities with the district forced on: 30 km/h on every
// drive, heavies and buses out, half the cop spawns skipped, roadblocks on its gates, nobody jams on
// the drives past the gate pillars; NavGrid goes round the lake (wading is costly), never through
// the bandstand or the island.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { MEGAPARK } from '../../gameplay/balance';
import { TRAFFIC } from '../../ai/CivilianTraffic';
import { NavGrid } from '../../ai/NavGrid';
import { inRect } from '../lots';
import { shoreDistance } from '../Water';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import { roleBlocks } from './Megapark';
import { cityWorld, DT, flatCities, simulate } from './trafficSim';

const placed = flatCities('megapark', ['megapark'], 6);
const lakeOf = (c: (typeof placed)[number][1], q: (typeof placed)[number][2]) => c.water.find((w) => w.kind === 'lake' && inRect(q.bounds, w))!;

describe('Mega-park traffic', () => {
  beforeAll(() => RAPIER.init());

  it('30 km/h on every drive, heavies out, half density, half the cop spawns skipped, gate roadblocks', () => {
    expect(placed.length).toBeGreaterThan(3);
    for (const [, city, q] of placed) {
      const rules = districtTraffic(city);
      for (const k of q.streets) {
        expect(rules.limits.get(k)).toBe(MEGAPARK.speed);
        expect(rules.noHeavy.has(k)).toBe(true);
      }
      for (const id of q.interior) expect(rules.nodes.get(id)!.density).toBe(MEGAPARK.density);
      expect(copSpawnSkips(city)(q.bounds.x, q.bounds.z)).toBe(MEGAPARK.copSpawnSkip);
      const gates = roadblockGates(city);
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(true);
    }
  });

  it('civilians keep to 30 on the drives and never jam past the gates', () => {
    const report: Record<string, number>[] = [];
    for (const [seed, city, q] of placed.slice(0, 2)) {
      const stats = { seed, insideSeconds: 0, fast: 0, jammed: 0 };
      simulate(seed, city, { world: cityWorld(city, [q]), centre: q.bounds, radius: 200, seconds: 120 }, (car) => {
        const v = car.vehicle;
        if (!inRect(q.bounds, v.position)) return;
        stats.insideSeconds += DT;
        if (Math.hypot(v.vel.x, v.vel.z) > MEGAPARK.speed + 2) stats.fast++;
        if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
      });
      report.push(stats);
    }
    for (const r of report) {
      expect(r.insideSeconds, JSON.stringify(r)).toBeGreaterThan(5);
      expect(r.fast, JSON.stringify(r)).toBe(0);
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
  }, 180_000);
});

describe('Mega-park off-road routes', () => {
  it.each(placed)('seed %i: never through the bandstand or the island; round the lake, not across it', (_seed, city, q) => {
    const grid = new NavGrid(city);
    const band = q.dressing.structures.find((s) => s.kind === 'bandstand')!;
    const isle = q.dressing.structures.find((s) => s.kind === 'island')!;
    expect(grid.passable(band.x, band.z)).toBe(false);
    expect(grid.passable(isle.x, isle.z)).toBe(false);
    // From the bank on one side of the lake to the other, across its long axis.
    const lake = lakeOf(city, q);
    const block = city.blocks[roleBlocks(q, 'lake')[0]].rect;
    const alongX = Math.abs(Math.cos(lake.yaw ?? 0)) > 0.7;
    const r = (alongX ? block.w : block.d) / 2 - city.config.sidewalk - 1;
    const [a, b] = [-1, 1].map((e) => (alongX ? { x: block.x + e * r, z: lake.z } : { x: lake.x, z: block.z + e * r }));
    expect(shoreDistance(lake, a.x, a.z)).toBeLessThan(0);
    const path = grid.findPath(a, b);
    expect(path).not.toBeNull();
    const pts = path!.flatMap((p, i) => {
      if (!i) return [p];
      const o = path![i - 1];
      const n = Math.ceil(Math.hypot(p.x - o.x, p.z - o.z) / 0.5);
      return Array.from({ length: n }, (_, k) => ({ x: o.x + ((p.x - o.x) * (k + 1)) / n, z: o.z + ((p.z - o.z) * (k + 1)) / n }));
    });
    const wet = pts.filter((p) => shoreDistance(lake, p.x, p.z) > 1.5).length * 0.5;
    expect(wet).toBeLessThan(3); // metres waded, at most a corner
  });
});
