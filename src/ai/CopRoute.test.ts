import { describe, expect, it } from 'vitest';
import { RoadGraph, type RoadNode } from '../world/RoadGraph';
import { COP_TUNING, planRoute, planRouteIds } from './CopController';

// 4×3 grid of junctions 100m apart: x = 0..300, z = 0..200. Node id = row * 4 + col.
function grid(): RoadGraph {
  const nodes: RoadNode[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) nodes.push({ id: row * 4 + col, x: col * 100, z: row * 100, neighbors: [] });
  }
  for (const n of nodes) {
    const col = n.id % 4;
    const row = Math.floor(n.id / 4);
    if (col < 3) n.neighbors.push(n.id + 1);
    if (col > 0) n.neighbors.push(n.id - 1);
    if (row < 2) n.neighbors.push(n.id + 4);
    if (row > 0) n.neighbors.push(n.id - 4);
  }
  return new RoadGraph(nodes);
}

const EAST = { x: 1, z: 0 };
const at = (p: { x: number; z: number }) => `${p.x},${p.z}`;

describe('planRoute', () => {
  const g = grid();

  it('at speed, never doubles back: starts at the junction ahead even when the target is behind', () => {
    // Heading east along z=100, just past (100,100); suspect back west at (0,100).
    const route = planRoute(g, { x: 110, z: 100 }, EAST, 30, { x: 0, z: 100 }, COP_TUNING);
    expect(at(route[1])).toBe('200,100');
    expect(at(route[2])).not.toBe('100,100'); // no U-turn at the junction either
  });

  it('slow enough to turn round: heads straight back toward a target behind', () => {
    const route = planRoute(g, { x: 110, z: 100 }, EAST, 3, { x: 0, z: 100 }, COP_TUNING);
    expect(at(route[1])).toBe('100,100');
    expect(at(route[2])).toBe('0,100');
  });

  it('too fast to make the next turn: carries straight on and turns at the junction after', () => {
    // 15m before (200,100) at 35 m/s; suspect up the road to the north, at (200,200).
    const route = planRoute(g, { x: 185, z: 100 }, EAST, 35, { x: 200, z: 200 }, COP_TUNING);
    expect(at(route[1])).toBe('200,100');
    expect(at(route[2])).toBe('300,100');
  });

  it('takes the turn when there is room to brake for it', () => {
    const route = planRoute(g, { x: 110, z: 100 }, EAST, 20, { x: 200, z: 200 }, COP_TUNING);
    expect(at(route[1])).toBe('200,100');
    expect(at(route[2])).toBe('200,200');
  });

  it("ends at the suspect, entering their road from whichever end is the shorter way in", () => {
    // Suspect near the far end of road (200,0)-(300,0); coming from (300,200) that end is closer.
    const route = planRoute(g, { x: 300, z: 190 }, { x: 0, z: -1 }, 3, { x: 290, z: 0 }, COP_TUNING);
    expect(at(route[route.length - 1])).toBe('290,0');
    expect(at(route[route.length - 2])).toBe('300,0');
  });

  it('prefers the way with fewer turns when the distance is the same', () => {
    // Heading east at (110,0) to (300,100): along the bottom row then up turns once;
    // up at (200,0) then east turns twice.
    const route = planRoute(g, { x: 110, z: 0 }, EAST, 15, { x: 300, z: 100 }, COP_TUNING);
    expect(route.slice(1, -1).map(at)).toEqual(['200,0', '300,0']);
  });

  it('slow but facing away from the target: turns round, and the route is charged for it', () => {
    const { ids, cost } = planRouteIds(g, { x: 150, z: 100 }, EAST, 0, { x: 50, z: 100 }, COP_TUNING);
    expect(ids[0]).toBe(5); // (100,100): turn round and go back
    expect(cost).toBeCloseTo(50 + COP_TUNING.uTurnCost + 50);
  });
});
