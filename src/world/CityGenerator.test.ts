import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity, rollCityBlocks, type Rect } from './CityGenerator';
import { RoadGraph, type RoadNode } from './RoadGraph';

const overlaps = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-6 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-6;

const SEEDS = [1, 42, 1234, 99999, 314159];
/** [seed, blocks per side]: the default grid, plus a mid and the largest run size. */
const CASES: [number, number][] = [...SEEDS.map((s): [number, number] => [s, DEFAULT_CITY.blocks]), [42, 16], [1234, 20]];
const sized = (seed: number, blocks: number, extra = {}) => generateCity(seed, { ...DEFAULT_CITY, blocks, ...extra });

describe('generateCity', () => {
  it('is deterministic for a seed', () => {
    const a = generateCity(42);
    const b = generateCity(42);
    expect(a.buildings).toEqual(b.buildings);
    expect(a.plazas).toEqual(b.plazas);
    expect(a.spawn).toEqual(b.spawn);
    expect(generateCity(43).buildings).not.toEqual(a.buildings);
  });

  it('rolls a grid of 12 to 20 blocks per seed, the same every time', () => {
    const rolls = Array.from({ length: 200 }, (_, s) => rollCityBlocks(s));
    expect(new Set(rolls)).toEqual(new Set([12, 13, 14, 15, 16, 17, 18, 19, 20]));
    expect(rollCityBlocks(42)).toBe(rolls[42]);
  });

  it.each(CASES)('seed %i, %i blocks: road network is connected with no dead ends', (seed, blocks) => {
    // Before any roadworks close junctions (Roadworks.test checks the network around those).
    const city = sized(seed, blocks, { roadworksChance: 0 });
    // Junctions in a canal's line are open water unless a bridge carries a road through them.
    const open = city.graph.nodes.filter((n) => n.neighbors.length);
    const { canals, bridges } = city.terrain;
    const inLine = city.graph.nodes.filter((n) => canals.some((c) => (c.axis === 'x' ? n.z : n.x) === c.at));
    expect(city.graph.nodes.length - open.length).toBe(inLine.length - bridges.length);
    expect(city.graph.reachable(0).size).toBe(open.length);
    for (const node of open) expect(node.neighbors.length).toBeGreaterThanOrEqual(2);
    expect(city.plazas.length).toBeGreaterThan(0);
  });

  it.each(CASES)('seed %i, %i blocks: nothing solid sits on a road or intersection', (seed, blocks) => {
    const city = sized(seed, blocks);
    const paved = [...city.roads.map((r) => r.rect), ...city.intersections];
    const solids: Rect[] = [...city.buildings, ...city.props, ...city.trees.map((t) => ({ ...t, w: 1, d: 1 }))];
    const hits = solids.filter((s) => paved.some((p) => overlaps(s, p)));
    expect(hits).toEqual([]);
  });

  it.each(CASES)('seed %i, %i blocks: buildings do not overlap each other and stay inside the city', (seed, blocks) => {
    const city = sized(seed, blocks);
    const half = city.size / 2;
    const outside = city.buildings.filter((b) => Math.abs(b.x) + b.w / 2 > half || Math.abs(b.z) + b.d / 2 > half || b.h <= 0);
    expect(outside).toEqual([]);
    let overlapping = 0;
    city.buildings.forEach((b, i) => {
      for (let k = i + 1; k < city.buildings.length; k++) if (overlaps(b, city.buildings[k])) overlapping++;
    });
    expect(overlapping).toBe(0);
  });

  it.each(CASES)('seed %i, %i blocks: spawn is on a drivable road', (seed, blocks) => {
    const city = sized(seed, blocks);
    const onRoad = [...city.roads.map((r) => r.rect), ...city.intersections].some((r) =>
      overlaps({ x: city.spawn.x, z: city.spawn.z, w: 0.1, d: 0.1 }, r),
    );
    expect(onRoad).toBe(true);
  });

  it('has every zone type and a sensible amount of buildings', () => {
    const city = generateCity(42);
    const zones = new Set(city.buildings.map((b) => b.zone));
    expect(zones).toEqual(new Set(['downtown', 'midtown', 'residential', 'industrial']));
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
