import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { DEFAULT_CITY, generateCity } from '../world/CityGenerator';
import { MISSION } from './balance';
import { MissionSystem, pickDestinations, routeAim } from './MissionSystem';

const setup = (seed: number) => {
  const city = generateCity(seed);
  const start = city.graph.nearest(city.spawn.x, city.spawn.z);
  const destinations = pickDestinations(city.graph, new Rng(seed), start.id);
  return { city, start, destinations };
};

describe('pickDestinations', () => {
  it.each([1, 42, 1234, 99999])('seed %i: 5 distinct destinations, 700-1100m apart by road', (seed) => {
    const { city, start, destinations } = setup(seed);
    expect(destinations).toHaveLength(MISSION.destinations);
    expect(new Set(destinations.map((d) => d.id)).size).toBe(destinations.length);
    let from = start.id;
    for (const d of destinations) {
      const len = city.graph.pathLength(city.graph.path(from, d.id)!);
      expect(len).toBeGreaterThanOrEqual(MISSION.minRouteDistance);
      expect(len).toBeLessThanOrEqual(MISSION.maxRouteDistance + 1e-6);
      from = d.id;
    }
  });

  it('a map too small for the range still picks only reachable junctions (seed 10, 4×4, canal)', () => {
    const city = generateCity(10, { ...DEFAULT_CITY, blocks: 4 });
    const start = city.graph.nearest(city.spawn.x, city.spawn.z);
    const destinations = pickDestinations(city.graph, new Rng(10), start.id);
    expect(destinations).toHaveLength(MISSION.destinations);
    let from = start.id;
    for (const d of destinations) {
      expect(city.graph.path(from, d.id)).not.toBeNull();
      from = d.id;
    }
  });

  it('is deterministic for a seed', () => {
    expect(setup(7).destinations.map((d) => d.id)).toEqual(setup(7).destinations.map((d) => d.id));
  });
});

describe('MissionSystem', () => {
  const { destinations } = setup(42);

  it('advances through destinations and wins', () => {
    const m = new MissionSystem(destinations);
    expect(m.update(1, 0, 0)).toBeNull();
    for (let i = 0; i < destinations.length - 1; i++) {
      const d = destinations[i];
      expect(m.update(0.1, d.x + 5, d.z)).toBe('reached');
      expect(m.index).toBe(i + 1);
    }
    const last = destinations.at(-1)!;
    expect(m.update(0.1, last.x, last.z)).toBe('won');
    expect(m.status).toBe('won');
    expect(m.current).toBeNull();
    expect(m.update(1, 0, 0)).toBeNull(); // no further events
  });

  it('does not count a destination out of order or outside the radius', () => {
    const m = new MissionSystem(destinations);
    expect(m.update(0.1, destinations[1].x, destinations[1].z)).toBeNull();
    expect(m.update(0.1, destinations[0].x + MISSION.reachRadius + 1, destinations[0].z)).toBeNull();
    expect(m.index).toBe(0);
  });

  it('loses when the timer runs out', () => {
    const m = new MissionSystem(destinations);
    m.update(MISSION.timeLimit - 1, 9999, 9999);
    expect(m.timeLeft).toBeCloseTo(1);
    expect(m.update(2, 9999, 9999)).toBe('lost');
    expect(m.loseReason).toBe('time');
    expect(m.timeLeft).toBe(0);
  });

  it('can be failed by destruction, only once', () => {
    const m = new MissionSystem(destinations);
    m.fail('destroyed');
    m.fail('time');
    expect(m.status).toBe('lost');
    expect(m.loseReason).toBe('destroyed');
  });
});

describe('routeAim', () => {
  it('follows roads and reports road distance', () => {
    const { city, destinations } = setup(42);
    const g = city.graph;
    const dest = destinations[0];
    const start = g.nearest(city.spawn.x, city.spawn.z);
    const aim = routeAim(g, start.x, start.z, dest.id);
    // Aim is an intersection adjacent to (or at) the start, never straight through blocks.
    const aimNode = g.nearest(aim.x, aim.z);
    expect([start.id, ...start.neighbors]).toContain(aimNode.id);
    expect(aim.distance).toBeCloseTo(g.pathLength(g.path(start.id, dest.id)!), 0);
    expect(aim.path.at(-1)).toBe(dest.id);
    expect(g.nearest(aim.x, aim.z).id).toBe(aim.path[0]);
  });

  it('distance is ~0 at the destination', () => {
    const { city, destinations } = setup(42);
    const d = destinations[0];
    expect(routeAim(city.graph, d.x, d.z, d.id).distance).toBeCloseTo(0);
  });
});
