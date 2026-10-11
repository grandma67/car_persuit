import { describe, expect, it } from 'vitest';
import { DAMAGE } from './balance';
import { Health } from './Health';
import { DIFFICULTIES } from './difficulty';

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

describe('Easy mode car', () => {
  const [easy, normal] = DIFFICULTIES;
  const make = (d: typeof easy) => new Health({ ...DAMAGE, maxHealth: d.maxHealth, impactThreshold: d.armor, impactScale: DAMAGE.impactScale * d.damageScale });

  it('shrugs off light rams that would hurt on Normal', () => {
    expect(make(easy).applyImpact(7)).toBe(0);
    expect(make(normal).applyImpact(7)).toBeGreaterThan(0);
  });

  it('survives about four times as many 60 km/h wall hits', () => {
    const hitsToWreck = (h: Health) => {
      let n = 0;
      while (!h.destroyed) {
        h.applyImpact(17); // ≈ 60 km/h into a wall
        n++;
      }
      return n;
    };
    expect(hitsToWreck(make(normal))).toBe(7);
    expect(hitsToWreck(make(easy))).toBeGreaterThanOrEqual(15);
  });
});

describe('checkpoint repair', () => {
  const make = (d: (typeof DIFFICULTIES)[number]) => new Health({ ...DAMAGE, maxHealth: d.maxHealth });

  it('restores less on harder difficulties', () => {
    const restored = DIFFICULTIES.map((d) => {
      const h = make(d);
      h.applyDamage(d.maxHealth / 2);
      return h.repair(d.checkpointRepair) / d.maxHealth;
    });
    expect(restored[0]).toBeGreaterThan(restored[1]);
    expect(restored[1]).toBeGreaterThan(restored[2]);
    expect(restored[2]).toBeGreaterThan(0);
  });

  it('never goes above full health or revives a wreck', () => {
    const h = new Health({ ...DAMAGE, maxHealth: 100 });
    h.applyDamage(5);
    expect(h.repair(0.5)).toBe(5);
    expect(h.value).toBe(100);
    h.applyDamage(100);
    expect(h.repair(0.5)).toBe(0);
    expect(h.destroyed).toBe(true);
  });
});
