import { describe, expect, it } from 'vitest';
import { WATER } from '../gameplay/balance';
import { generateCity } from '../world/CityGenerator';
import { groundHeight } from '../world/Terrain';
import type { ShallowWater } from '../world/Water';
import { RIM_LIFT, shallowWaterGeometry } from './ShallowWater';

describe('shallow water mesh', () => {
  const { terrain } = generateCity(1); // on the hill: the surface follows the ground
  const ponds: ShallowWater[] = [
    { kind: 'pond', x: 30, z: 40, rx: 9, rz: 6, yaw: 0.4, wobble: [[3, 0.1, 1]], depth: 0.35 },
    { kind: 'pool', x: -50, z: 10, rx: 14, rz: 14, yaw: 0, wobble: [], depth: 0.3 },
  ];
  const geo = shallowWaterGeometry(ponds, terrain);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const normal = geo.getAttribute('normal');

  it('rim on the ground, full depth past the shore ramp, faces up', () => {
    for (let i = 0; i < pos.count; i++) {
      const lift = pos.getY(i) - groundHeight(terrain, pos.getX(i), pos.getZ(i));
      const shore = uv.getX(i);
      expect(shore).toBeGreaterThanOrEqual(0);
      if (shore === 0) expect(lift).toBeCloseTo(RIM_LIFT, 5);
      if (shore >= WATER.shoreRamp) expect(lift).toBeGreaterThan(0.29);
      expect(lift).toBeLessThanOrEqual(0.35 + 1e-6);
      expect(normal.getY(i)).toBeGreaterThan(0.9);
    }
  });
});
