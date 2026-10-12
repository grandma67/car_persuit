import { describe, expect, it } from 'vitest';
import { generateCity } from './CityGenerator';
import { PROP_SPECS, footprintsOverlap, propFootprint, propSpec, rectFootprint, type Footprint } from './StreetProps';

const SEEDS = [1, 42, 1234, 99999];

// Generating a city is the slow part; each seed is checked by several tests.
const cities = new Map<number, ReturnType<typeof generateCity>>();
const cityFor = (seed: number) => {
  if (!cities.has(seed)) cities.set(seed, generateCity(seed));
  return cities.get(seed)!;
};

/** Broad phase: bounding circles apart means the footprints can't overlap. Skips most SAT checks. */
const near = (a: Footprint, b: Footprint) => {
  const r = Math.hypot(a.hx, a.hz) + Math.hypot(b.hx, b.hz);
  return Math.abs(a.x - b.x) < r && Math.abs(a.z - b.z) < r;
};
const overlaps = (a: Footprint, b: Footprint) => near(a, b) && footprintsOverlap(a, b);

describe('footprintsOverlap', () => {
  const box = (x: number, z: number, hx: number, hz: number, yaw = 0): Footprint => ({ x, z, hx, hz, yaw });
  it('detects axis-aligned overlap and separation', () => {
    expect(footprintsOverlap(box(0, 0, 1, 1), box(1.5, 0, 1, 1))).toBe(true);
    expect(footprintsOverlap(box(0, 0, 1, 1), box(2.5, 0, 1, 1))).toBe(false);
  });
  it('handles rotation', () => {
    // A long thin bar rotated 90° reaches a box it would miss unrotated.
    expect(footprintsOverlap(box(0, 0, 3, 0.1), box(0, 2.5, 0.3, 0.3))).toBe(false);
    expect(footprintsOverlap(box(0, 0, 3, 0.1, Math.PI / 2), box(0, 2.5, 0.3, 0.3))).toBe(true);
    // Diagonal separation that only the rotated axes reveal.
    expect(footprintsOverlap(box(0, 0, 1, 1, Math.PI / 4), box(1.6, 1.6, 0.5, 0.5, Math.PI / 4))).toBe(false);
  });
});

describe('generateStreetProps', () => {
  it('is deterministic and has every kind in sensible numbers', () => {
    const a = cityFor(42).streetProps;
    expect(generateCity(42).streetProps).toEqual(a);
    const count = (k: string) => a.filter((p) => p.kind === k).length;
    expect(count('lamp')).toBeGreaterThan(800);
    expect(count('hydrant')).toBeGreaterThan(80);
    expect(count('bench')).toBeGreaterThan(60);
    expect(count('fence')).toBeGreaterThan(200);
    expect(a.length).toBeLessThan(6500);
  });

  it.each(SEEDS)('seed %i: nothing on roads, intersections, buildings, planters or trees', (seed) => {
    const city = cityFor(seed);
    const blockers: Footprint[] = [
      ...city.roads.map((r) => rectFootprint(r.rect)),
      ...city.intersections.map(rectFootprint),
      ...city.buildings.map(rectFootprint),
      ...city.props.map(rectFootprint),
      ...city.trees.map((t) => ({ x: t.x, z: t.z, hx: 0.5, hz: 0.5, yaw: 0 })),
    ];
    // Roadworks cones stand on the road on purpose.
    const bad = city.streetProps.filter((p) => p.kind !== 'cone' && blockers.some((b) => overlaps(propFootprint(p), b)));
    expect(bad).toEqual([]);
  });

  it.each(SEEDS)('seed %i: props do not overlap each other and stay on the island', (seed) => {
    const city = cityFor(seed);
    const half = city.islandSize / 2 - 0.6; // inside the sea wall
    const fps = city.streetProps.map((p) => propFootprint(p));
    let overlaps = 0;
    for (let i = 0; i < fps.length; i++) {
      for (let k = i + 1; k < fps.length; k++) {
        if (Math.abs(fps[i].x - fps[k].x) < 4 && Math.abs(fps[i].z - fps[k].z) < 4 && footprintsOverlap(fps[i], fps[k])) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
    expect(city.streetProps.filter((p) => Math.abs(p.x) > half || Math.abs(p.z) > half)).toEqual([]);
  });

  it.each(SEEDS)('seed %i: town squares are building-free with a centrepiece; landmarks are clear of everything', (seed) => {
    const city = cityFor(seed);
    const squares = city.blocks.filter((b) => b.square);
    expect(squares.length).toBeGreaterThanOrEqual(2);
    for (const s of squares) {
      expect(city.buildings.some((b) => Math.abs(b.x - s.rect.x) < 30 && Math.abs(b.z - s.rect.z) < 30)).toBe(false);
      expect(city.landmarks.some((l) => l.x === s.rect.x && l.z === s.rect.z)).toBe(true);
    }
    const kinds = new Set(city.landmarks.map((l) => l.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    for (const l of city.landmarks) {
      const fp = { x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 };
      const blockers: Footprint[] = [
        ...city.roads.map((r) => rectFootprint(r.rect)),
        ...city.intersections.map(rectFootprint),
        ...city.buildings.map(rectFootprint),
        ...city.trees.map((t) => ({ x: t.x, z: t.z, hx: 0.5, hz: 0.5, yaw: 0 })),
        ...city.streetProps.map((p) => propFootprint(p)),
      ];
      expect(blockers.filter((b) => overlaps(fp, b))).toEqual([]);
    }
  });
});

describe('breakable greenery', () => {
  it('trees scale with size, need a real hit to snap and cacti give way easier', () => {
    const tree = (tree: 'round' | 'cactus', scale = 1) => propSpec({ kind: 'tree', tree, scale, x: 0, z: 0, yaw: 0 });
    expect(tree('round', 1.2).hx).toBeCloseTo(tree('round').hx * 1.2);
    expect(tree('round').breakSpeed).toBeGreaterThan(PROP_SPECS.bench.breakSpeed);
    expect(tree('round').slowdown).toBeGreaterThan(PROP_SPECS.lamp.slowdown);
    expect(tree('cactus').breakSpeed).toBeLessThan(tree('round').breakSpeed);
    expect(propSpec({ kind: 'umbrella', x: 0, z: 0, yaw: 0 }).breakSpeed).toBeLessThan(2);
  });
});
