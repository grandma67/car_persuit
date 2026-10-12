import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/CityGenerator';
import { footprintDistance, NavGrid } from './NavGrid';

/** Does the segment a → b pass within `r` of the circle at c? */
function segmentNear(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, r: number): boolean {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * abx + (c.z - a.z) * abz) / (abx * abx + abz * abz || 1)));
  return Math.hypot(a.x + abx * t - c.x, a.z + abz * t - c.z) < r;
}

describe('NavGrid', () => {
  const seeds = [1, 2, 3, 7, 42];

  it('measures distance to a rotated rectangle', () => {
    const fp = { x: 0, z: 0, hx: 2, hz: 1, yaw: Math.PI / 2 }; // local X now along world −Z
    expect(footprintDistance(fp, 0, 0)).toBe(0);
    expect(footprintDistance(fp, 3, 0)).toBeCloseTo(2); // 1 m half-depth along world X
    expect(footprintDistance(fp, 0, 3)).toBeCloseTo(1);
  });

  it('routes into a park centrepiece square and round the statue, never through it', () => {
    for (const seed of seeds) {
      const city = generateCity(seed);
      const nav = new NavGrid(city);
      for (const l of city.landmarks.filter((m) => m.kind !== 'ramp')) {
        // Start on a road well away, end just behind the landmark.
        const from = city.graph.nearest(l.x + 70, l.z + 70);
        const to = { x: l.x + l.radius + 4, z: l.z };
        if (!nav.passable(to.x, to.z)) continue;
        const path = nav.findPath(from, to, 200000);
        expect(path, `seed ${seed} ${l.kind}`).not.toBeNull();
        for (let i = 0; i + 1 < path!.length; i++) expect(segmentNear(path![i], path![i + 1], l, l.radius)).toBe(false);
      }
    }
  });

  it('never routes through a building', () => {
    const city = generateCity(3);
    const nav = new NavGrid(city);
    const a = city.graph.nodes[20];
    const b = city.graph.nodes[100];
    const path = nav.findPath(a, b, 200000)!;
    expect(path).not.toBeNull();
    for (let i = 0; i + 1 < path.length; i++) {
      const p = path[i];
      const q = path[i + 1];
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z));
      for (let s = 0; s <= steps; s++) {
        const x = p.x + ((q.x - p.x) * s) / (steps || 1);
        const z = p.z + ((q.z - p.z) * s) / (steps || 1);
        for (const bld of city.buildings) expect(Math.abs(x - bld.x) < bld.w / 2 && Math.abs(z - bld.z) < bld.d / 2).toBe(false);
      }
    }
  });

  it('plans a nearby chase quickly', () => {
    const city = generateCity(42);
    const nav = new NavGrid(city);
    const nodes = city.graph.nodes;
    const t0 = performance.now();
    let found = 0;
    for (let i = 0; i < 40; i++) {
      const a = nodes[(i * 37) % nodes.length];
      const b = { x: a.x + 120 * Math.cos(i), z: a.z + 120 * Math.sin(i) };
      if (nav.findPath(a, b)) found++;
    }
    const each = (performance.now() - t0) / 40;
    expect(found).toBeGreaterThan(20);
    expect(each).toBeLessThan(15);
  });
});
