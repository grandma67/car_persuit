import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity } from './CityGenerator';

const SEEDS = [1, 42, 1234, 99999];
const withWorks = { ...DEFAULT_CITY, roadworksChance: 1 };

describe('roadworks', () => {
  it.each(SEEDS)('seed %i: closes one junction and keeps the rest of the network connected', (seed) => {
    const city = generateCity(seed, withWorks);
    const works = city.roadworks!;
    expect(works).not.toBeNull();
    const { graph } = city;
    expect(graph.nodes[works.node].neighbors).toEqual([]);
    for (const n of graph.nodes) expect(n.neighbors).not.toContain(works.node);
    const open = graph.nodes.filter((n) => n.neighbors.length);
    expect(open.length).toBe(graph.nodes.length - 1);
    expect(open.every((n) => n.neighbors.length >= 2)).toBe(true); // no dead ends
    expect(graph.reachable(open[0].id).size).toBe(open.length);
    // Nearest-junction lookups never land on the closed one.
    expect(graph.nearest(works.x, works.z).id).not.toBe(works.node);
  });

  it.each(SEEDS)('seed %i: cones close every approach and the spawn junction stays open', (seed) => {
    const city = generateCity(seed, withWorks);
    const works = city.roadworks!;
    const cones = city.streetProps.filter((p) => p.kind === 'cone');
    expect(cones.length).toBeGreaterThanOrEqual(3 * 5 + 4);
    for (const c of cones) expect(Math.hypot(c.x - works.x, c.z - works.z)).toBeLessThan(14);
    const spawnNode = city.graph.nearest(city.spawn.x, city.spawn.z);
    expect(Math.hypot(spawnNode.x - works.x, spawnNode.z - works.z)).toBeGreaterThan(100);
  });

  it('is rare by default and stable per seed', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i * 7919);
    const sites = seeds.filter((s) => generateCity(s).roadworks).length;
    expect(sites).toBeGreaterThan(0);
    expect(sites).toBeLessThan(20);
    expect(generateCity(7).roadworks).toEqual(generateCity(7).roadworks);
  });
});
