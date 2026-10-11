import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity } from './CityGenerator';
import { MAX_SITES } from './Roadworks';

const SEEDS = [1, 42, 1234, 99999];
const withWorks = { ...DEFAULT_CITY, roadworksChance: 1 };

describe('roadworks', () => {
  it.each(SEEDS)('seed %i: closes several junctions and keeps the rest of the network connected', (seed) => {
    const city = generateCity(seed, withWorks);
    const { graph, roadworks } = city;
    expect(roadworks.length).toBeGreaterThan(1);
    expect(roadworks.length).toBeLessThanOrEqual(MAX_SITES);
    const closed = new Set(roadworks.map((w) => w.node));
    expect(closed.size).toBe(roadworks.length);
    for (const works of roadworks) {
      expect(graph.nodes[works.node].neighbors).toEqual([]);
      for (const n of graph.nodes) expect(n.neighbors).not.toContain(works.node);
      // Nearest-junction lookups never land on a closed one.
      expect(closed.has(graph.nearest(works.x, works.z).id)).toBe(false);
    }
    const open = graph.nodes.filter((n) => n.neighbors.length);
    expect(open.length).toBe(graph.nodes.length - roadworks.length);
    expect(open.every((n) => n.neighbors.length >= 2)).toBe(true); // no dead ends
    expect(graph.reachable(open[0].id).size).toBe(open.length);
  });

  it.each(SEEDS)('seed %i: sites are spread out, cones close every approach, the spawn stays open', (seed) => {
    const city = generateCity(seed, withWorks);
    const { roadworks } = city;
    const cones = city.streetProps.filter((p) => p.kind === 'cone');
    expect(cones.length).toBeGreaterThanOrEqual(roadworks.length * (3 * 5 + 4));
    for (const c of cones) expect(Math.min(...roadworks.map((w) => Math.hypot(c.x - w.x, c.z - w.z)))).toBeLessThan(14);
    const spawnNode = city.graph.nearest(city.spawn.x, city.spawn.z);
    for (const w of roadworks) expect(Math.hypot(spawnNode.x - w.x, spawnNode.z - w.z)).toBeGreaterThan(100);
    for (const a of roadworks) {
      for (const b of roadworks) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(100); // not next door
      }
    }
  });

  it('is rare by default, sometimes more than one, and stable per seed', () => {
    const counts = Array.from({ length: 200 }, (_, i) => generateCity(i * 7919).roadworks.length);
    const withAny = counts.filter((c) => c > 0).length;
    expect(withAny).toBeGreaterThan(0);
    expect(withAny).toBeLessThan(140);
    expect(counts.some((c) => c > 1)).toBe(true);
    expect(counts.filter((c) => c > 1).length).toBeLessThan(withAny / 2);
    expect(generateCity(7).roadworks).toEqual(generateCity(7).roadworks);
  });
});
