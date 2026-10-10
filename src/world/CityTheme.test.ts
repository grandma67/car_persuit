import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ALL_THEMES, pickTheme, pickTimeOfDay } from './CityTheme';

const hsl = (hex: number) => {
  const out = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(out, THREE.SRGBColorSpace);
  return out;
};

describe('pickTheme', () => {
  it('is deterministic per seed and varies across seeds', () => {
    expect(pickTheme(42)).toEqual(pickTheme(42));
    const names = new Set(Array.from({ length: 200 }, (_, i) => pickTheme(i).name));
    expect(names.size).toBe(ALL_THEMES.length);
  });

  it('keeps building and pavement colours realistic (no neon, no pure black/white)', () => {
    for (let seed = 0; seed < 300; seed++) {
      const t = pickTheme(seed);
      const facades = Object.values(t.buildings).flat();
      for (const c of facades) {
        const { s, l } = hsl(c);
        expect(s).toBeLessThanOrEqual(0.6);
        expect(l).toBeGreaterThan(0.15);
        expect(l).toBeLessThan(0.95);
      }
      for (const c of [t.asphalt, t.sidewalk, t.plaza, t.quay]) {
        expect(hsl(c).s).toBeLessThanOrEqual(0.35); // paving is greyish
      }
      expect(hsl(t.asphalt).l).toBeLessThan(hsl(t.sidewalk).l); // roads darker than pavements
    }
  });
});

describe('pickTimeOfDay', () => {
  it('covers day, golden hour and night across seeds', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => pickTimeOfDay(i).name));
    expect(names).toEqual(new Set(['day', 'afternoon', 'night']));
  });

  it('honours a valid override and ignores junk', () => {
    expect(pickTimeOfDay(1, 'night').name).toBe('night');
    expect(pickTimeOfDay(42, 'banana').name).toBe(pickTimeOfDay(42).name);
  });
});
