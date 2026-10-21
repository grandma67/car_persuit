import { describe, expect, it } from 'vitest';
import { PassBy } from './passBy';

// Player at the origin facing +z (right is -x). The other car comes head-on in the next lane.
const RIGHT = [-1, 0] as const;

/** Step a car along z toward and past the player; returns every whoosh it made. */
function pass(lane: number, closing: number, mass = 1300) {
  const p = new PassBy();
  const car = {};
  const out = [];
  for (let z = 60; z > -60; z -= closing / 60) {
    const w = p.check(car, lane, z, 0, -closing, RIGHT[0], RIGHT[1], mass);
    if (w) out.push({ ...w, z });
  }
  return out;
}

describe('pass-by whoosh', () => {
  it('a fast near miss swishes once, just before it draws level, on its side', () => {
    const w = pass(-3, 30); // passing on the right
    expect(w).toHaveLength(1);
    expect(w[0].z).toBeGreaterThan(0);
    expect(w[0].z).toBeLessThan(30 * 0.15);
    expect(w[0].pan).toBeGreaterThan(0.5);
    expect(w[0].strength).toBeGreaterThan(0.3);
    expect(pass(3, 30)[0].pan).toBeLessThan(-0.5);
  });

  it('is louder the faster and closer the pass', () => {
    expect(pass(-3, 40)[0].strength).toBeGreaterThan(pass(-3, 20)[0].strength);
    expect(pass(-2.6, 30)[0].strength).toBeGreaterThan(pass(-4.5, 30)[0].strength);
  });

  it('slow, distant or colliding passes make none', () => {
    expect(pass(-3, 10)).toHaveLength(0);
    expect(pass(-9, 40)).toHaveLength(0);
    expect(pass(-0.5, 40)).toHaveLength(0);
  });

  it('head-on, both speeds add up: 40 + 40 km/h is an 80 km/h pass', () => {
    const kmh = 40 / 3.6;
    const w = pass(-3, 2 * kmh);
    expect(w).toHaveLength(1);
    expect(w[0].speed).toBeCloseTo(2 * kmh, 5);
    expect(pass(-3, kmh)).toHaveLength(0); // one car at 40 alone is too slow to swish
  });

  it('heavy vehicles buffet more', () => {
    expect(pass(-3, 30, 5000)[0].heavy).toBe(1);
    expect(pass(-3, 30, 1200)[0].heavy).toBe(0);
  });

  it('swishes again on the next pass', () => {
    const p = new PassBy();
    const car = {};
    let n = 0;
    for (const _ of [0, 1]) for (let z = 30; z > -30; z -= 0.5) if (p.check(car, -3, z, 0, -30, -1, 0, 1300)) n++;
    expect(n).toBe(2);
  });
});
