import { describe, expect, it } from 'vitest';
import { BOX_TRUCK_SPEC, BUS_SPEC, type VehicleSpec } from './VehicleSpecs';
import { TYRE_WIDTH, frontArch } from './carMesh';

// The bus and box truck have flat sides that come down past the top of their tyres; at full lock
// a front tyre swings out past the side and in under the body, so it turns inside a wheel arch.
describe('front wheel arches', () => {
  it.each([['bus', BUS_SPEC], ['box truck', BOX_TRUCK_SPEC]] as [string, VehicleSpec][])('%s: a front tyre at any lock stays inside its arch', (_name, spec) => {
    const arch = frontArch(spec);
    // Outline of the tyre seen from above (a TYRE_WIDTH × diameter rectangle), turned to every angle up to full lock.
    for (let a = -spec.maxSteer; a <= spec.maxSteer + 1e-9; a += spec.maxSteer / 20) {
      for (const [lx, lz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const x = (lx * TYRE_WIDTH) / 2;
        const z = lz * spec.wheelRadius;
        const along = x * Math.sin(a) + z * Math.cos(a); // from the axle, along the body
        const across = spec.wheelX + x * Math.cos(a) - z * Math.sin(a); // from the centre line
        expect(Math.abs(along)).toBeLessThan(arch.halfLength);
        expect(across).toBeGreaterThan(arch.wellHalfWidth);
      }
    }
    // Over the top of the tyre even with the suspension squashed onto its bump stop.
    expect(arch.top).toBeGreaterThan((spec.wheelY ?? 0) - spec.suspensionRestLength * 0.3 + spec.wheelRadius);
    // The arch stays between the front bumper and the door / cargo box behind it.
    expect(spec.wheelZ + arch.halfLength).toBeLessThan(spec.halfExtents.z);
  });
});
