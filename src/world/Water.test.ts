import { describe, expect, it } from 'vitest';
import { generateCity } from './CityGenerator';
import { DISTRICT_DEFS } from './districts';
import { ICE, softGroundOf, WADING } from './softGround';
import { inWater, rimPoints, shoreDistance, waterReach, type ShallowWater } from './Water';

const pond = (over: Partial<ShallowWater> = {}): ShallowWater => ({
  kind: 'pond', x: 10, z: -20, rx: 8, rz: 5, yaw: 0.6, wobble: [[3, 0.12, 0.4], [5, 0.06, 2.1]], depth: 0.35, ...over,
});

describe('shallow water shape', () => {
  it('a circle: shore distance is exact', () => {
    const w = pond({ rx: 6, rz: 6, yaw: 0, wobble: [] });
    expect(shoreDistance(w, w.x, w.z)).toBeCloseTo(6);
    expect(shoreDistance(w, w.x + 4, w.z)).toBeCloseTo(2);
    expect(shoreDistance(w, w.x, w.z + 9)).toBeCloseTo(-3);
    expect(inWater(w, w.x + 5.9, w.z)).toBe(true);
    expect(inWater(w, w.x + 6.1, w.z)).toBe(false);
    expect(inWater(w, w.x + 4, w.z, 1)).toBe(true);
    expect(inWater(w, w.x + 5.5, w.z, 1)).toBe(false);
  });

  it('rim points lie on the rim, rotated and wobbled, and inside the reach', () => {
    const w = pond();
    const reach = waterReach(w);
    for (const p of rimPoints(w, 64)) {
      expect(Math.abs(shoreDistance(w, p.x, p.z))).toBeLessThan(1e-9);
      expect(Math.max(Math.abs(p.x - w.x), Math.abs(p.z - w.z))).toBeLessThanOrEqual(reach + 1e-9);
    }
    for (const p of rimPoints(w, 64, 1)) expect(shoreDistance(w, p.x, p.z)).toBeCloseTo(1);
  });

  it('the long axis follows the yaw', () => {
    const w = pond({ yaw: Math.PI / 2, wobble: [] }); // local X (8 m) along world −Z
    expect(inWater(w, w.x, w.z - 7.5)).toBe(true);
    expect(inWater(w, w.x + 7.5, w.z)).toBe(false);
  });
});

describe('soft ground with water', () => {
  const base = generateCity(1);
  const w = pond();

  it('wading in the water, ice when frozen, nothing outside; null with nothing soft', () => {
    const city = { ...base, districts: [], water: [w] };
    const soft = softGroundOf(city, DISTRICT_DEFS, false)!;
    expect(soft.at(w.x, w.z)).toBe(WADING);
    expect(soft.at(w.x + 30, w.z)).toBeNull();
    expect(softGroundOf(city, DISTRICT_DEFS, true)!.at(w.x, w.z)).toBe(ICE);
    expect(softGroundOf({ ...base, districts: [], water: [] }, DISTRICT_DEFS, false)).toBeNull();
  });
});
