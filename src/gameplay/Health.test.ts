import { describe, expect, it } from 'vitest';
import { DAMAGE } from './balance';
import { Health } from './Health';

describe('Health', () => {
  it('ignores scrapes', () => {
    const h = new Health();
    expect(h.applyImpact(DAMAGE.impactThreshold)).toBe(0);
    expect(h.ratio).toBe(1);
  });

  it('scales with impact: a 60 km/h wall hit hurts, a 150 km/h one hurts a lot', () => {
    // Measured in the physics sim: impact (Δv) ≈ 17 m/s at 60 km/h, ≈ 42 m/s at 150 km/h.
    expect(new Health().applyImpact(17)).toBeCloseTo(21.6);
    const h = new Health();
    h.applyImpact(42);
    expect(h.ratio).toBeCloseTo(0.334, 2);
    expect(h.smoking).toBe(true);
    expect(h.burning).toBe(false);
  });

  it('is destroyed at zero and stays clamped', () => {
    const h = new Health();
    h.applyImpact(42);
    h.applyImpact(42);
    expect(h.value).toBe(0);
    expect(h.destroyed).toBe(true);
    expect(h.burning).toBe(true);
    expect(h.applyImpact(50)).toBe(0);
  });
});
