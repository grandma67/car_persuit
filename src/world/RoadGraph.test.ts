import { describe, expect, it } from 'vitest';
import { RoadGraph, type RoadNode } from './RoadGraph';

// 3×3 grid of junctions 100m apart: x = 0..200, z = 0..200. Node id = row * 3 + col.
function grid(): RoadNode[] {
  const nodes: RoadNode[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) nodes.push({ id: row * 3 + col, x: col * 100, z: row * 100, neighbors: [] });
  }
  for (const n of nodes) {
    const col = n.id % 3;
    const row = Math.floor(n.id / 3);
    if (col < 2) n.neighbors.push(n.id + 1);
    if (col > 0) n.neighbors.push(n.id - 1);
    if (row < 2) n.neighbors.push(n.id + 3);
    if (row > 0) n.neighbors.push(n.id - 3);
  }
  return nodes;
}

/** Cut the road between a and b both ways (as roadworks would). */
function cut(nodes: RoadNode[], a: number, b: number): void {
  nodes[a].neighbors = nodes[a].neighbors.filter((n) => n !== b);
  nodes[b].neighbors = nodes[b].neighbors.filter((n) => n !== a);
}

describe('RoadGraph', () => {
  it('finds the shortest path and its length', () => {
    const g = new RoadGraph(grid());
    const path = g.path(0, 8)!;
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(8);
    expect(path).toHaveLength(5); // 4 roads of 100m, no detours
    expect(g.pathLength(path)).toBe(400);
    expect(g.path(4, 4)).toEqual([4]);
  });

  it('routes around a closed road', () => {
    const nodes = grid();
    cut(nodes, 0, 1);
    const g = new RoadGraph(nodes);
    expect(g.path(0, 1)).toEqual([0, 3, 4, 1]);
    expect(g.distancesFrom(0)[1]).toBe(300);
  });

  it('returns null / Infinity for unreachable junctions', () => {
    const nodes = grid();
    cut(nodes, 8, 7);
    cut(nodes, 8, 5);
    const g = new RoadGraph(nodes);
    expect(g.path(0, 8)).toBeNull();
    expect(g.distancesFrom(0)[8]).toBe(Infinity);
    expect(g.reachable(0).has(8)).toBe(false);
    expect(g.reachable(0).size).toBe(8);
  });

  it('road distances match Dijkstra on the grid', () => {
    const d = new RoadGraph(grid()).distancesFrom(0);
    expect(d).toEqual([0, 100, 200, 100, 200, 300, 200, 300, 400]);
  });

  it('avoids a U-turn when another way exists, but takes it on a dead end', () => {
    const g = new RoadGraph(grid());
    // Arrived at 1 from 0; target 0 is straight back — must go round instead.
    const around = g.path(1, 0, 0)!;
    expect(around[1]).not.toBe(0);
    expect(around[around.length - 1]).toBe(0);

    // Dead end: 2 only connects to 1, so turning back is the only way.
    const nodes = grid();
    cut(nodes, 2, 5);
    expect(new RoadGraph(nodes).path(2, 0, 1)).toEqual([2, 1, 0]);
  });

  it('nearest prefers an open junction over a closer closed one', () => {
    const nodes = grid();
    for (const n of [...nodes[4].neighbors]) cut(nodes, 4, n); // centre junction closed
    const g = new RoadGraph(nodes);
    expect(g.nearest(105, 100).id).not.toBe(4);
    expect(g.nearest(105, 100).neighbors.length).toBeGreaterThan(0);
    expect(new RoadGraph(grid()).nearest(105, 100).id).toBe(4);
  });

  it('nearestEdge reports the road, how far along it and how far off it', () => {
    const e = new RoadGraph(grid()).nearestEdge(30, 4);
    expect([e.a.id, e.b.id].sort()).toEqual([0, 1]);
    expect(e.u).toBeCloseTo(0.3);
    expect(e.off).toBeCloseTo(4);
  });
});
