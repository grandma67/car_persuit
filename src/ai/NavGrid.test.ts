import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/CityGenerator';
import { footprintDistance, NavGrid } from './NavGrid';
import { inWater, type ShallowWater } from '../world/Water';

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

describe('NavGrid: shallow water', () => {
  // A block cleared of everything, with a pond in its middle; the route crosses the block west to east.
  const base = generateCity(1);
  const block = base.blocks.find((b) => !b.park && !b.square && Math.abs(b.rect.x) < 100 && Math.abs(b.rect.z) < 100)!;
  const r = block.rect;
  const inBlock = (x: number, z: number) => Math.abs(x - r.x) < r.w / 2 + 1 && Math.abs(z - r.z) < r.d / 2 + 1;
  const pond: ShallowWater = { kind: 'pond', x: r.x, z: r.z, rx: 11, rz: 11, yaw: 0, wobble: [], depth: 0.35 };
  const cleared = {
    ...base,
    buildings: base.buildings.filter((b) => !inBlock(b.x, b.z)),
    streetProps: base.streetProps.filter((p) => !inBlock(p.x, p.z)),
    props: base.props.filter((p) => !inBlock(p.x, p.z)),
    landmarks: base.landmarks.filter((l) => !inBlock(l.x, l.z)),
  };
  const from = { x: r.x - r.w / 2 + 4, z: r.z };
  const to = { x: r.x + r.w / 2 - 4, z: r.z };
  const wet = (path: { x: number; z: number }[], w = pond) => {
    let n = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      for (let s = 0; s <= 10; s++) {
        const x = path[i].x + ((path[i + 1].x - path[i].x) * s) / 10;
        const z = path[i].z + ((path[i + 1].z - path[i].z) * s) / 10;
        if (inWater(w, x, z, 0.5)) n++;
      }
    }
    return n;
  };

  it('water is passable but a route goes round it when it can', () => {
    const dry = new NavGrid({ ...cleared, water: [] }).findPath(from, to, 200000)!;
    expect(wet(dry)).toBeGreaterThan(0); // without the pond the straight way crosses its spot
    const nav = new NavGrid({ ...cleared, water: [pond] });
    expect(nav.passable(pond.x, pond.z)).toBe(true);
    const path = nav.findPath(from, to, 200000)!;
    expect(path).not.toBeNull();
    expect(wet(path)).toBe(0);
  });

  it('wades when going round is far longer', () => {
    // A wall of buildings across the block north and south of the pond, leaving only the water.
    const walls = [-1, 1].map((side) => ({ ...base.buildings[0], x: r.x, z: r.z + side * (r.d / 2 + 30), w: 400, d: r.d + 40, yaw: 0 }));
    const big = { ...pond, rz: r.d / 2 + 6 };
    const nav = new NavGrid({ ...cleared, buildings: [...cleared.buildings, ...walls], water: [big] });
    const path = nav.findPath(from, to, 400000);
    expect(path).not.toBeNull();
    expect(wet(path!, big)).toBeGreaterThan(0);
  });
});
