import { describe, expect, it } from 'vitest';
import { WANTED } from './balance';
import { WantedSystem } from './WantedSystem';

describe('WantedSystem', () => {
  it('starts at one star and climbs with time at the configured thresholds', () => {
    const w = new WantedSystem();
    expect(w.stars).toBe(1);
    expect(w.update(WANTED[1].at - 1)).toBeNull();
    expect(w.update(1.01)).toBe(2);
    w.update(WANTED[4].at);
    expect(w.stars).toBe(5);
    expect(w.progress).toBe(1);
    expect(w.update(1000)).toBeNull(); // capped at five
  });

  it('heat from wrecking cops and smashing props brings stars sooner', () => {
    const w = new WantedSystem();
    w.update(70);
    expect(w.stars).toBe(1);
    expect(w.copWrecked()).toBe(2); // 70s + 25s heat ≥ 90s
    const v = new WantedSystem();
    v.update(85);
    for (let i = 0; i < 10; i++) v.propSmashed(); // 85 + 10 × 0.6 ≥ 90
    expect(v.stars).toBe(2);
  });

  it('reports progress toward the next star', () => {
    const w = new WantedSystem();
    w.update(WANTED[1].at / 2);
    expect(w.progress).toBeCloseTo(0.5);
  });

  it('escalation table is sane: more cops and tougher mix each star', () => {
    for (let i = 1; i < WANTED.length; i++) {
      expect(WANTED[i].at).toBeGreaterThan(WANTED[i - 1].at);
      expect(WANTED[i].maxCops).toBeGreaterThan(WANTED[i - 1].maxCops);
      expect(WANTED[i].spawnInterval).toBeLessThanOrEqual(WANTED[i - 1].spawnInterval);
    }
    expect(WANTED[4].mix.armored).toBeGreaterThan(0);
    expect(WANTED[0].roadblocks).toBe(false);
    expect(WANTED[3].roadblocks).toBe(true);
  });

  it('bump jumps exactly one star', () => {
    const w = new WantedSystem();
    expect(w.bump()).toBe(2);
    expect(w.bump()).toBe(3);
  });
});

import { pickCopType } from '../ai/CopDirector';

describe('pickCopType', () => {
  it('follows the spawn weights', () => {
    const mix = { patrol: 0.3, interceptor: 0.3, suv: 0.2, armored: 0.2 };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const t = pickCopType(mix, i / 1000);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    expect(counts).toEqual({ patrol: 300, interceptor: 300, suv: 200, armored: 200 });
    expect(pickCopType({ patrol: 1 }, 0.999)).toBe('patrol');
  });
});
