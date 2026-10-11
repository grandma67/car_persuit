import { describe, expect, it } from 'vitest';
import { generateCity } from './CityGenerator';
import { inRampLane } from './Landmarks';

describe('jump ramp monument', () => {
  it.each([1, 42, 1234, 99999])('seed %i: exactly one, in a town square, with a clear run-up and landing', (seed) => {
    const city = generateCity(seed);
    const ramps = city.landmarks.filter((l) => l.kind === 'ramp');
    expect(ramps.length).toBe(1);
    const ramp = ramps[0];
    expect(city.blocks.some((b) => b.square && b.rect.x === ramp.x && b.rect.z === ramp.z)).toBe(true);
    const half = city.config.blockSize / 2;
    const inSquare = (p: { x: number; z: number }) => Math.abs(p.x - ramp.x) < half && Math.abs(p.z - ramp.z) < half;
    for (const t of city.trees) if (inSquare(t)) expect(inRampLane(ramp, t)).toBe(false);
    for (const p of city.streetProps) if (p.kind === 'bench' && inSquare(p)) expect(inRampLane(ramp, p)).toBe(false);
  });
});
