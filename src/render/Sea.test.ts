import { describe, expect, it } from 'vitest';
import { seaGeometry } from './Sea';

const SIZE = 3000; // Sea.ts

describe('sea mesh', () => {
  for (const half of [180, 260, 400]) {
    it(`island half ${half}: faces up, covers the sea once, no cracks, few triangles`, () => {
      const geo = seaGeometry(half);
      const p = geo.attributes.position.array, idx = geo.index!.array;
      const edges = new Map<string, number>();
      let area = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
        // Up-facing (counter-clockwise seen from +y, three's front side): (b - a) × (c - a) has +y.
        const cross = (p[c * 3] - p[a * 3]) * (p[b * 3 + 2] - p[a * 3 + 2]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
        expect(cross).toBeGreaterThan(0);
        area += cross / 2;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const key = u < v ? `${u}-${v}` : `${v}-${u}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      // Every edge is shared by two triangles, except the outer border and the hole under the
      // island: a vertex in the middle of a neighbour's edge (a T-junction) would leave an edge used once.
      const hole = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < SIZE / 2 - 1;
      for (const [key, n] of edges) {
        expect(n).toBeLessThanOrEqual(2);
        if (n === 1) {
          const [u, v] = key.split('-').map(Number);
          const mx = (p[u * 3] + p[v * 3]) / 2, mz = (p[u * 3 + 2] + p[v * 3 + 2]) / 2;
          if (hole(mx, mz)) expect(Math.max(Math.abs(mx), Math.abs(mz))).toBeLessThan(half);
        }
      }
      // Covers the square once, less the hole (whole grid cells, so its size isn't exact).
      expect(area).toBeLessThan(SIZE * SIZE);
      expect(area).toBeGreaterThan(SIZE * SIZE - (2 * half) ** 2);
      expect(idx.length / 3).toBeLessThan(80_000);
    });
  }
});
