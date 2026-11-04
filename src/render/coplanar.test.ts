import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { colourTag, coplanarOverlaps, trianglesOf } from './coplanar';
import { part } from './geometry';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const overlaps = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts);
  return coplanarOverlaps(trianglesOf(g.attributes.position.array, null, colourTag(g.attributes.color.array)));
};

describe('coplanarOverlaps', () => {
  it('flags two boxes of one depth crossing (the bench back)', () => {
    const o = overlaps([part(box(1.8, 0.12, 0.05), 0x8a5a33, 0, 0.6, -0.27), part(box(0.06, 0.55, 0.05), 0x2a2d33, 0.8, 0.7, -0.27)]);
    expect(o.map((x) => Math.round(x.normal[2]))).toEqual(expect.arrayContaining([1, -1]));
    expect(o[0].area).toBeCloseTo(0.06 * 0.12, 4);
  });

  it('passes one box enclosing the other, faces 1 cm apart', () => {
    expect(overlaps([part(box(1.8, 0.12, 0.05), 0x8a5a33, 0, 0.6, -0.27), part(box(0.06, 0.55, 0.07), 0x2a2d33, 0.8, 0.7, -0.27)])).toEqual([]);
  });

  it('passes boxes butted end to end (only an edge shared)', () => {
    expect(overlaps([part(box(1, 1, 1), 0xff0000, 0, 0, 0), part(box(1, 1, 1), 0x00ff00, 1, 0, 0)])).toEqual([]);
  });

  it('passes same-colour parts (same pixels) and faces facing apart', () => {
    expect(overlaps([part(box(1, 1, 1), 0xff0000, 0, 0, 0), part(box(0.5, 0.5, 1), 0xff0000, 0.2, 0, 0)])).toEqual([]);
    // Two slabs back to back: the top of one and the bottom of the other share y = 0 but face apart.
    expect(overlaps([part(box(1, 1, 1), 0xff0000, 0, -0.5, 0), part(box(1, 1, 1), 0x00ff00, 0, 0.5, 0)])).toEqual([]);
  });

  it('flags tilted planes too', () => {
    const tilt = (c: number, y: number) => part(box(1, 0.1, 1).rotateX(0.4), c, 0, y, 0);
    expect(overlaps([tilt(0xff0000, 0), part(box(0.5, 0.1, 0.5).rotateX(0.4), 0x00ff00, 0.2, 0, 0)]).length).toBeGreaterThan(0);
  });
});
