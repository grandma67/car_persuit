import { describe, expect, it } from 'vitest';
import { waterNearby } from './shore';

describe('water nearby', () => {
  it('measures to the nearest quay edge and finds the point on it', () => {
    const w = waterNearby(180, -40, 200, []);
    expect(w.sea).toBe(20);
    expect(w.wallX).toBe(200);
    expect(w.wallZ).toBe(-40);
    expect(w.canal).toBe(Infinity);
    const s = waterNearby(-10, -195, 200, []);
    expect(s.sea).toBe(5);
    expect([s.wallX, s.wallZ]).toEqual([-10, -200]);
  });

  it('is zero past the quay', () => {
    expect(waterNearby(230, 0, 200, []).sea).toBe(0);
  });

  it('measures across a canal to its water', () => {
    // Along X: the canal is a band in z.
    const canals = [{ axis: 'x' as const, line: 3, at: 50, half: 10 }];
    expect(waterNearby(0, 75, 200, canals).canal).toBe(15);
    expect(waterNearby(0, 55, 200, canals).canal).toBe(0);
  });
});
