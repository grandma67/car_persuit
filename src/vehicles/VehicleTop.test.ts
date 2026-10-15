import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCarMesh } from './carMesh';
import { ALL_SPECS, vehicleTop } from './VehicleSpecs';
import { DISTRICTS } from '../gameplay/balance';

/** Highest point of a car's meshes (glow sprites and lights left out), chassis-local. */
function meshTop(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) box.expandByObject(o, true);
  });
  return box.max.y;
}

describe('vehicleTop', () => {
  it.each(ALL_SPECS.map((s) => [s.name, s] as const))('%s: matches the body mesh', (_, spec) => {
    const ride = spec.wheelRadius + spec.suspensionRestLength - (spec.wheelY ?? 0);
    const measured = ride + meshTop(buildCarMesh(spec).root);
    expect(vehicleTop(spec)).toBeGreaterThanOrEqual(measured - 1e-3);
    expect(vehicleTop(spec)).toBeLessThan(measured + 0.1);
  });

  it('overhead clearance is the tallest vehicle plus 1.5 m', () => {
    const tallest = Math.max(...ALL_SPECS.map(vehicleTop));
    expect(DISTRICTS.overheadClearance).toBeCloseTo(tallest + 1.5, 6);
    expect(DISTRICTS.overheadClearance).toBeGreaterThan(4.5);
  });
});
