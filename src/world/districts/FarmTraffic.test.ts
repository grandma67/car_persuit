// The Farm's traffic and police, on real cities with the district forced on: tractors spawn only in
// the Farm and on its perimeter streets and nobody jams behind them; the hooks carry the Farm's
// values; cops' off-road routes cross the fields and the orchard's aisles, round the bales and trunks.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { FARM, FARM_GATE } from '../../gameplay/balance';
import { TRAFFIC } from '../../ai/CivilianTraffic';
import { NavGrid } from '../../ai/NavGrid';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint } from '../StreetProps';
import { copSpawnSkips, districtTraffic, roadblockGates } from './runtime';
import type { DistrictTraffic } from './District';
import { farmFields, fenceGaps, ranchGate } from './Farm';
import { cityWorld, DT, flatSeeds, simulate } from './trafficSim';

const ALONE = { farm: true, oldtown: false, chinatown: false, harbor: false, slums: false };

describe('Farm traffic', () => {
  beforeAll(() => RAPIER.init());

  it('the hooks carry the Farm\'s values', () => {
    for (const [, city, q] of flatSeeds('farm', 3, ALONE)) {
      const rules = districtTraffic(city);
      for (const id of q.interior) {
        const t = rules.nodes.get(id)!;
        expect(t.density).toBe(FARM.density);
        expect(t.heavy).toBe(true);
        expect(t.weights).toMatchObject({ Pickup: FARM.pickupWeight, Tractor: FARM.tractorWeight });
      }
      for (const id of q.perimeter) expect(rules.edges.get(id)?.weights).toEqual({ Tractor: FARM.tractorEdge });
      expect(rules.limits.size).toBe(0);
      expect(rules.noHeavy.size).toBe(0);
      const skip = copSpawnSkips(city);
      expect(skip(q.bounds.x, q.bounds.z)).toBe(FARM.copSpawnSkip);
      expect(skip(q.bounds.x + q.bounds.w, q.bounds.z)).toBe(0);
      const g = ranchGate(q);
      expect(roadblockGates(city).has(`${g.node}>${g.inner}`)).toBe(true);
    }
  });

  it('tractors spawn only in the Farm and round it, and nobody jams behind them', () => {
    const report: Record<string, number>[] = [];
    for (const [seed, city, q] of flatSeeds('farm', 2, ALONE)) {
      // Tractors made common, so there is always one in somebody's lane.
      const rules = districtTraffic(city);
      const more = (t: DistrictTraffic): DistrictTraffic => ({ ...t, weights: { ...t.weights, Tractor: 12 } });
      for (const [k, t] of rules.nodes) rules.nodes.set(k, more(t));
      for (const [k, t] of rules.edges) rules.edges.set(k, more(t));
      const around = { ...q.bounds, w: q.bounds.w + 2 * city.config.roadWidth + 2, d: q.bounds.d + 2 * city.config.roadWidth + 2 };
      const stats = { seed, tractors: 0, strayTractors: 0, tractorSeconds: 0, jammed: 0, carsNear: 0 };
      const seen = new Set<object>();
      simulate(seed, city, { world: cityWorld(city, [q]), centre: q.bounds, radius: 200, seconds: 150, rules }, (car) => {
        const v = car.vehicle;
        const tractor = v.spec.body === 'tractor';
        if (!seen.has(car)) {
          seen.add(car);
          if (tractor) {
            stats.tractors++;
            if (!inRect(around, v.position)) stats.strayTractors++;
          }
        }
        if (tractor) stats.tractorSeconds += DT;
        if (inRect(around, v.position)) {
          stats.carsNear += DT;
          if (car.controller.stuckFor > TRAFFIC.stuckLimit) stats.jammed++;
        }
      });
      report.push(stats);
    }
    expect(report.length).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.tractors, JSON.stringify(r)).toBeGreaterThan(1);
      expect(r.strayTractors, JSON.stringify(r)).toBe(0);
      expect(r.jammed, JSON.stringify(r)).toBe(0);
    }
  }, 120_000);
});

describe('Farm off-road routes', () => {
  const placed = flatSeeds('farm', 8, ALONE);
  const onPath = (path: { x: number; z: number }[], r: { x: number; z: number; w: number; d: number }) => path.some((p) => inRect(r, p));
  /** Points along a path every half metre. */
  const dense = (path: { x: number; z: number }[]) => path.flatMap((p, i) => {
    if (!i) return [p];
    const a = path[i - 1];
    const n = Math.ceil(Math.hypot(p.x - a.x, p.z - a.z) / 0.5);
    return Array.from({ length: n }, (_, k) => ({ x: a.x + ((p.x - a.x) * (k + 1)) / n, z: a.z + ((p.z - a.z) * (k + 1)) / n }));
  });

  type Gap = { x: number; z: number; nx: number; nz: number };
  const outside = (g: Gap) => ({ x: g.x + g.nx * 6, z: g.z + g.nz * 6 });
  const inside = (g: Gap) => ({ x: g.x - g.nx * 8, z: g.z - g.nz * 8 });

  it.each(placed)('seed %i: into each field through its gates, round every bale and trunk', (_seed, city, q) => {
    const grid = new NavGrid(city);
    const trunks = q.dressing.props.filter((p) => p.kind === 'tree').map((p) => propFootprint(p));
    const bales = q.dressing.props.filter((p) => p.kind === 'roundBale').map((p) => propFootprint(p));
    for (const f of farmFields(q)) {
      for (const g of fenceGaps(q)[f.block]) {
        const path = grid.findPath(outside(g), inside(g));
        expect(path, `${f.crop} field ${f.block}`).not.toBeNull();
        const pts = dense(path!);
        // Where it crosses the fence line, it is in the gap.
        for (const p of pts) {
          const across = g.nx ? Math.abs(p.x - g.x) : Math.abs(p.z - g.z);
          const along = g.nx ? Math.abs(p.z - g.z) : Math.abs(p.x - g.x);
          if (across < 0.3) expect(along).toBeLessThan(FARM_GATE.fieldGate / 2);
        }
        for (const p of pts) for (const t of [...trunks, ...bales]) expect(footprintsOverlap({ x: p.x, z: p.z, hx: 0.1, hz: 0.1, yaw: 0 }, t)).toBe(false);
      }
    }
  });

  it('fields are shortcuts between opposite gates', () => {
    let fields = 0;
    for (const [, city, q] of placed) {
      const grid = new NavGrid(city);
      // Not the orchard: its trees make the road round the cheaper way (the aisles are tested below).
      for (const f of farmFields(q).filter((x) => x.crop !== 'orchard')) {
        const gaps = fenceGaps(q)[f.block];
        const a = gaps.find((g) => gaps.some((h) => h.nx === -g.nx && h.nz === -g.nz && (g.nx || g.nz)));
        if (!a) continue;
        const b = gaps.find((h) => h.nx === -a.nx && h.nz === -a.nz)!;
        const pts = dense(grid.findPath(outside(a), outside(b))!);
        const middle = { ...f.rect, w: f.rect.w / 2, d: f.rect.d / 2 };
        expect(onPath(pts, middle), `${f.crop} field ${f.block}`).toBe(true);
        fields++;
      }
    }
    expect(fields).toBeGreaterThan(0);
  });

  it.each(placed.filter(([, , q]) => farmFields(q).some((f) => f.crop === 'orchard')))('seed %i: down the orchard aisles to its middle', (_seed, city, q) => {
    const grid = new NavGrid(city);
    for (const f of farmFields(q).filter((x) => x.crop === 'orchard')) {
      const trunks = q.dressing.props.filter((p) => p.kind === 'tree' && inRect(f.rect, p)).map((p) => propFootprint(p));
      for (const g of fenceGaps(q)[f.block]) {
        const path = grid.findPath(outside(g), { x: f.rect.x, z: f.rect.z });
        expect(path).not.toBeNull();
        for (const p of dense(path!)) for (const t of trunks) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThan(t.hx + 0.5);
      }
    }
  });
});
