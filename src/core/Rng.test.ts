import { describe, expect, it } from 'vitest';
import { Rng } from './Rng';

const take = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next());

describe('Rng', () => {
  it('replays the same sequence for the same seed, and a different one otherwise', () => {
    expect(take(new Rng(1234), 50)).toEqual(take(new Rng(1234), 50));
    expect(take(new Rng(1234), 50)).not.toEqual(take(new Rng(1235), 50));
  });

  it('stays within its ranges, including both ends of int()', () => {
    const rng = new Rng(7);
    const ints = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const r = rng.range(-3, 5);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(5);
      ints.add(rng.int(1, 4));
    }
    expect(ints).toEqual(new Set([1, 2, 3, 4]));
  });

  it('picks every item eventually and nothing else', () => {
    const rng = new Rng(99);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set(Array.from({ length: 300 }, () => rng.pick(items)));
    expect(seen).toEqual(new Set(items));
  });
});
