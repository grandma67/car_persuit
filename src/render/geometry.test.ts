import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dropHiddenFaces, part } from './geometry';

const tris = (g: THREE.BufferGeometry) => g.attributes.position.count / 3;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

describe('dropHiddenFaces', () => {
  it('drops a face buried inside another part', () => {
    // A pole standing in a base: its bottom cap is inside the base (the base's own bottom stays).
    const g = mergeGeometries([part(box(1, 1, 1), 0xffffff, 0, 0.5), part(box(0.2, 3, 0.2), 0xffffff, 0, 1.6)]);
    const out = dropHiddenFaces(g);
    expect(tris(out)).toBe(tris(g) - 2);
    expect(out.attributes.color.count).toBe(out.attributes.position.count);
  });

  it('drops a face flush against another part and facing into it', () => {
    // A box sitting on another: its underside lies on the lower box's top, facing down into it.
    const g = mergeGeometries([part(box(1, 1, 1), 0xffffff, 0, 0.5), part(box(0.4, 0.4, 0.4), 0xffffff, 0, 1.2)]);
    expect(tris(dropHiddenFaces(g))).toBe(tris(g) - 2);
  });

  it('keeps faces flush with another part facing the same way (no holes)', () => {
    // Two identical boxes: each face lies on the other's; dropping both copies would leave a hole.
    const g = mergeGeometries([part(box(1, 1, 1), 0xffffff), part(box(1, 1, 1), 0xffffff)]);
    expect(tris(dropHiddenFaces(g))).toBe(tris(g));
  });

  it('only closed convex parts hide anything', () => {
    // A plane is open (a half-space would hide everything behind it); a torus isn't convex.
    const plane = part(new THREE.PlaneGeometry(4, 4), 0xffffff, 0, 0, 1);
    const torus = part(new THREE.TorusGeometry(1, 0.4, 6, 12), 0xffffff);
    const small = part(box(0.1, 0.1, 0.1), 0xffffff, 1, 0, 0); // inside the torus's ring
    for (const g of [mergeGeometries([plane, part(box(0.5, 0.5, 0.5), 0xffffff)]), mergeGeometries([torus, small])]) {
      expect(tris(dropHiddenFaces(g))).toBe(tris(g));
    }
  });
});
