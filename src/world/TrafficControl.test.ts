import { describe, expect, it } from 'vitest';
import { generateCity } from './CityGenerator';
import { signalState, SIGNAL_CYCLE } from './TrafficControl';

const inside = (m: { x: number; z: number; w: number; d: number }, r: { x: number; z: number; w: number; d: number }) =>
  Math.abs(m.x - r.x) + m.w / 2 <= r.w / 2 + 1e-6 && Math.abs(m.z - r.z) + m.d / 2 <= r.d / 2 + 1e-6;

describe('signalState', () => {
  it('never shows green to both directions, and each direction gets green and yellow', () => {
    const seen = { x: new Set<string>(), z: new Set<string>() };
    for (let t = 0; t < SIGNAL_CYCLE * 2; t += 0.1) {
      const x = signalState('x', t);
      const z = signalState('z', t);
      expect(x !== 'red' && z !== 'red').toBe(false);
      seen.x.add(x);
      seen.z.add(z);
    }
    expect(seen.x).toEqual(new Set(['green', 'yellow', 'red']));
    expect(seen.z).toEqual(new Set(['green', 'yellow', 'red']));
  });
});

describe('generateTrafficControl', () => {
  it.each([1, 42, 1234])('seed %i: signals downtown, stop signs elsewhere, speed signs', (seed) => {
    const city = generateCity(seed);
    const kinds = (k: string, v?: string) => city.streetProps.filter((p) => p.kind === k && (v === undefined || p.variant === v)).length;
    expect(kinds('signal')).toBeGreaterThan(40);
    expect(kinds('sign', 'stop')).toBeGreaterThan(100);
    expect(kinds('sign', 'speed')).toBeGreaterThan(30);
    // Signals sit on busy central junctions more than anywhere else.
    const signals = city.streetProps.filter((p) => p.kind === 'signal');
    const central = signals.filter((p) => Math.hypot(p.x, p.z) < city.size * 0.35).length;
    expect(central / signals.length).toBeGreaterThan(0.6);
  });

  it.each([1, 42, 1234])('seed %i: every crossing and stop line is painted on road, not sidewalk', (seed) => {
    const city = generateCity(seed);
    const paved = [...city.roads.map((r) => r.rect), ...city.intersections];
    const off = city.roadMarks.filter((m) => !paved.some((r) => inside(m, r)));
    expect(off).toEqual([]);
    expect(city.roadMarks.filter((m) => m.kind === 'stopline').length).toBeGreaterThan(100);
  });
});
