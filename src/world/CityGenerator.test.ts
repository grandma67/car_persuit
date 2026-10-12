import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity, type Rect } from './CityGenerator';
import { RoadGraph, type RoadNode } from './RoadGraph';

const overlaps = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-6 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-6;

const SEEDS = [1, 42, 1234, 99999, 314159];

describe('generateCity', () => {
  it('is deterministic for a seed', () => {
    const a = generateCity(42);
    const b = generateCity(42);
    expect(a.buildings).toEqual(b.buildings);
    expect(a.plazas).toEqual(b.plazas);
    expect(a.spawn).toEqual(b.spawn);
    expect(generateCity(43).buildings).not.toEqual(a.buildings);
  });

  it.each(SEEDS)('seed %i: road network is connected with no dead ends', (seed) => {
    // Before any roadworks close junctions (Roadworks.test checks the network around those).
    const city = generateCity(seed, { ...DEFAULT_CITY, roadworksChance: 0 });
    expect(city.graph.reachable(0).size).toBe(city.graph.nodes.length);
    for (const node of city.graph.nodes) expect(node.neighbors.length).toBeGreaterThanOrEqual(2);
    expect(city.plazas.length).toBeGreaterThan(0);
  });

  it.each(SEEDS)('seed %i: nothing solid sits on a road or intersection', (seed) => {
    const city = generateCity(seed);
    const paved = [...city.roads.map((r) => r.rect), ...city.intersections];
    const solids: Rect[] = [...city.buildings, ...city.props, ...city.trees.map((t) => ({ ...t, w: 1, d: 1 }))];
    const hits = solids.filter((s) => paved.some((p) => overlaps(s, p)));
    expect(hits).toEqual([]);
  });

  it.each(SEEDS)('seed %i: buildings do not overlap each other and stay inside the city', (seed) => {
    const city = generateCity(seed);
    const half = city.size / 2;
    const outside = city.buildings.filter((b) => Math.abs(b.x) + b.w / 2 > half || Math.abs(b.z) + b.d / 2 > half || b.h <= 0);
    expect(outside).toEqual([]);
    let overlapping = 0;
    city.buildings.forEach((b, i) => {
      for (let k = i + 1; k < city.buildings.length; k++) if (overlaps(b, city.buildings[k])) overlapping++;
    });
    expect(overlapping).toBe(0);
  });

  it.each(SEEDS)('seed %i: spawn is on a drivable road', (seed) => {
    const city = generateCity(seed);
    const onRoad = [...city.roads.map((r) => r.rect), ...city.intersections].some((r) =>
      overlaps({ x: city.spawn.x, z: city.spawn.z, w: 0.1, d: 0.1 }, r),
    );
    expect(onRoad).toBe(true);
  });

  it('has every district type and a sensible amount of buildings', () => {
    const city = generateCity(42);
    const districts = new Set(city.buildings.map((b) => b.district));
    expect(districts).toEqual(new Set(['downtown', 'midtown', 'residential', 'industrial']));
    expect(city.buildings.length).toBeGreaterThan(300);
    expect(city.buildings.length).toBeLessThan(1500);
  });
});

describe('RoadGraph', () => {
  // 3x3 grid with the middle-row link (1,1)-(2,1) missing.
  const grid = () => {
    const nodes: RoadNode[] = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) nodes.push({ id: j * 3 + i, x: i * 10, z: j * 10, neighbors: [] });
    const link = (a: number, b: number) => (nodes[a].neighbors.push(b), nodes[b].neighbors.push(a));
    [[0, 1], [1, 2], [3, 4], [6, 7], [7, 8], [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8]].forEach(([a, b]) => link(a, b));
    return new RoadGraph(nodes);
  };

  it('finds the shortest path', () => {
    const g = grid();
    expect(g.path(0, 8)).toHaveLength(5);
    expect(g.pathLength(g.path(0, 8)!)).toBeCloseTo(40);
  });

  it('detours around a missing link', () => {
    const g = grid();
    const p = g.path(4, 5)!;
    expect(p[0]).toBe(4);
    expect(p.at(-1)).toBe(5);
    expect(g.pathLength(p)).toBeCloseTo(30);
  });

  it('returns null when unreachable and finds the nearest node', () => {
    const g = new RoadGraph([
      { id: 0, x: 0, z: 0, neighbors: [] },
      { id: 1, x: 50, z: 0, neighbors: [] },
    ]);
    expect(g.path(0, 1)).toBeNull();
    expect(g.nearest(40, 3).id).toBe(1);
  });
});
