// Fields pinned by hand end up in the built city where the file puts them: canals and their
// bridges, the hill, plazas, the spawn, destinations, roadworks sites and a district's rect. The
// words (cityWords*.test.ts) cover counts and features; this covers positions.
import { describe, expect, it } from 'vitest';
import { cityDestinations, generateCity, type CityData } from './CityGenerator';
import { CityParamsError, type CityParams } from './CityParams';

const n = 10;
const base: CityParams = { version: 1, seed: 3, blocks: n };
const node = (city: CityData, [i, j]: [number, number]) => city.graph.nodes[j * (n + 1) + i];

describe('pinned fields end up in the city', () => {
  it('a canal on its road line, with a bridge on each road line asked', () => {
    const city = generateCity({ ...base, terrain: { hill: false, canals: [{ axis: 'x', line: 5, width: 30, bridges: [2, 6, 9] }] } });
    expect(city.terrain.canals).toHaveLength(1);
    const [c] = city.terrain.canals;
    expect(c).toMatchObject({ axis: 'x', line: 5, half: 15 });
    expect(c.at).toBeCloseTo(node(city, [0, 5]).z);
    expect(city.terrain.bridges.map((b) => b.x).sort((a, b) => a - b)).toEqual([2, 6, 9].map((i) => node(city, [i, 5]).x));
    expect(city.terrain.hill).toBeNull();
  });

  it('the hill where and as it is given', () => {
    const hill = { x: 60, z: -40, height: 12, rx: 220, rz: 260, yaw: 0.3 };
    const city = generateCity({ ...base, terrain: { hill, canals: 0 } });
    expect(city.terrain.hill).toEqual(hill);
    expect(city.terrain.canals).toEqual([]);
  });

  it('plazas pave over exactly the streets listed', () => {
    const city = generateCity({ ...base, plazas: ['h3,4', 'v7,2'] });
    expect(city.params.plazas).toEqual(['h3,4', 'v7,2']);
    expect(node(city, [3, 4]).neighbors).not.toContain(node(city, [4, 4]).id);
    expect(node(city, [7, 2]).neighbors).not.toContain(node(city, [7, 3]).id);
    expect(node(city, [3, 3]).neighbors).toContain(node(city, [4, 3]).id); // a street not listed stays
  });

  it('the run starts at its junction, facing the next one; the destinations are the junctions given', () => {
    const destinations: [number, number][] = [[1, 1], [8, 8], [1, 8]];
    const city = generateCity({ ...base, roadworks: 0, spawn: { node: [3, 3], toward: [4, 3] }, destinations });
    const start = node(city, [3, 3]);
    expect(city.graph.nearest(city.spawn.x, city.spawn.z).id).toBe(start.id);
    const to = node(city, [4, 3]);
    expect(Math.sin(city.spawn.yaw) * (to.x - start.x) + Math.cos(city.spawn.yaw) * (to.z - start.z)).toBeGreaterThan(0);
    expect(cityDestinations(city).map((d) => d.id)).toEqual(destinations.map((ij) => node(city, ij).id));
  });

  it('roadworks sites on the junction and the street given, and nowhere else', () => {
    const city = generateCity({ ...base, roadworks: [{ node: [2, 7] }, { edge: 'h6,2' }] });
    expect(city.roadworks).toHaveLength(2);
    const [junction, road] = city.roadworks;
    expect(junction.kind).toBe('junction');
    expect(junction.node).toBe(node(city, [2, 7]).id);
    expect(road.kind).toBe('road');
    expect([...road.edge!].sort((a, b) => a - b)).toEqual([node(city, [6, 2]).id, node(city, [7, 2]).id]);
  });

  it('a district rect is placed exactly there, or the build says why it can\'t be', () => {
    let placed = 0;
    for (const [i, j] of [[3, 3], [4, 3], [3, 4], [5, 5], [2, 6]]) {
      const rect = { i, j, w: 2, h: 2 };
      try {
        const city = generateCity({ ...base, districts: [{ kind: 'oldtown', rect }] });
        expect(city.districts.map((q) => q.kind)).toEqual(['oldtown']);
        expect(city.districts[0].grid).toMatchObject({ i0: i, j0: j, w: 2, h: 2 });
        expect(city.params.districts![0].rect).toEqual(rect);
        placed++;
      } catch (e) {
        if (!(e instanceof CityParamsError)) throw e;
        expect(e.reasons.some((r) => r.startsWith('districts[0]')), e.reasons.join('\n')).toBe(true);
      }
    }
    expect(placed).toBeGreaterThan(0);
  });
});
