import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity, type CityData } from './CityGenerator';
import { MAX_SITES, overlaps, type WorksItem } from './Roadworks';

const SEEDS = [1, 42, 1234, 99999];
const withWorks = { ...DEFAULT_CITY, roadworksChance: 1 };

const corners = (it: WorksItem) => {
  const fx = Math.sin(it.yaw);
  const fz = Math.cos(it.yaw);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => ({ x: it.x + fx * it.hl * a + fz * it.hw * b, z: it.z + fz * it.hl * a - fx * it.hw * b }));
};

/** On the asphalt: inside a road segment or a junction box. */
function onRoad(city: CityData, x: number, z: number): boolean {
  const eps = 0.05;
  return [...city.roads.map((r) => r.rect), ...city.intersections].some((r) => Math.abs(x - r.x) <= r.w / 2 + eps && Math.abs(z - r.z) <= r.d / 2 + eps);
}

describe('roadworks', () => {
  it.each(SEEDS)('seed %i: closes junctions and roads, keeps the rest of the network connected', (seed) => {
    const city = generateCity(seed, withWorks);
    const { graph, roadworks } = city;
    expect(roadworks.length).toBeGreaterThan(1);
    expect(roadworks.length).toBeLessThanOrEqual(MAX_SITES);
    for (const works of roadworks) {
      if (works.kind === 'junction') {
        expect(graph.nodes[works.node!].neighbors).toEqual([]);
        for (const n of graph.nodes) expect(n.neighbors).not.toContain(works.node);
        expect(graph.nearest(works.x, works.z).id).not.toBe(works.node);
      } else {
        const [a, b] = works.edge!;
        expect(graph.nodes[a].neighbors).not.toContain(b);
        expect(graph.nodes[b].neighbors).not.toContain(a);
      }
    }
    const open = graph.nodes.filter((n) => n.neighbors.length);
    expect(open.every((n) => n.neighbors.length >= 2)).toBe(true); // no dead ends
    expect(graph.reachable(open[0].id).size).toBe(open.length);
  });

  it.each(SEEDS)('seed %i: everything sits on the road, solid kit never overlaps, sites are spread out', (seed) => {
    const city = generateCity(seed, withWorks);
    const { roadworks } = city;
    for (const works of roadworks) {
      const solid = works.items.filter((i) => i.kind !== 'patch');
      expect(solid.some((i) => ['mixer', 'backhoe', 'tipper', 'dig'].includes(i.kind))).toBe(true);
      for (const item of solid) for (const c of corners(item)) expect(onRoad(city, c.x, c.z)).toBe(true);
      for (const a of solid) for (const b of solid) if (a !== b) expect(overlaps(corners(a), corners(b))).toBe(false);
    }
    const pitch = city.config.blockSize + city.config.roadWidth;
    const spawnNode = city.graph.nearest(city.spawn.x, city.spawn.z);
    for (const w of roadworks) expect(Math.hypot(spawnNode.x - w.x, spawnNode.z - w.z)).toBeGreaterThan(pitch * 0.9);
    for (const a of roadworks) {
      for (const b of roadworks) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(pitch * 0.9); // not next door
    }
  });

  it.each(SEEDS)('seed %i: every closed approach is blocked by cones or barrier boards', (seed) => {
    const city = generateCity(seed, withWorks);
    const cones = city.streetProps.filter((p) => p.kind === 'cone');
    const half = city.config.roadWidth / 2;
    for (const works of city.roadworks) {
      // The mouths to block: each road into a closed junction, or both ends of a closed road.
      const mouths =
        works.kind === 'junction'
          ? city.roads.filter((r) => r.a === works.node || r.b === works.node).map((r) => ({ from: works, to: r.rect }))
          : works.edge!.map((id) => ({ from: city.graph.nodes[id], to: works }));
      for (const { from, to } of mouths) {
        const len = Math.hypot(to.x - from.x, to.z - from.z);
        const dx = (to.x - from.x) / len;
        const dz = (to.z - from.z) / len;
        // Blockers within a few metres of the line across this mouth.
        const blockers = [...cones, ...works.items.filter((i) => i.kind === 'barrier')].filter((p) => {
          const along = (p.x - from.x) * dx + (p.z - from.z) * dz;
          const across = Math.abs(-(p.x - from.x) * dz + (p.z - from.z) * dx);
          return along > half - 1 && along < half + 5 && across < half;
        });
        expect(blockers.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('lays every site out differently: a mix of junctions and roads, kit and closures', () => {
    const sites = SEEDS.flatMap((seed) => generateCity(seed, withWorks).roadworks);
    expect(new Set(sites.map((s) => s.kind)).size).toBe(2);
    const kits = new Set(sites.map((s) => s.items.filter((i) => i.kind !== 'patch').map((i) => i.kind).sort().join(',')));
    expect(kits.size).toBeGreaterThan(sites.length / 2);
    const kinds = new Set(sites.flatMap((s) => s.items.map((i) => i.kind)));
    for (const k of ['mixer', 'backhoe', 'tipper', 'dig', 'mound', 'pipes', 'tower', 'toilet', 'barrier', 'patch']) expect(kinds.has(k as WorksItem['kind'])).toBe(true);
  });

  it('is common by default, and stable per seed', () => {
    const counts = Array.from({ length: 60 }, (_, i) => generateCity(i * 7919).roadworks.length);
    expect(counts.filter((c) => c > 0).length).toBeGreaterThan(30);
    expect(generateCity(7).roadworks).toEqual(generateCity(7).roadworks);
  });
});
