import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildModels } from './PropSystem';

// A tree is one piece: every limb, frond and crown touches the rest. The model's surface is marked
// on a fine voxel grid; parts that touch or cross share cells, so a floating part is a second
// connected group of cells (the Swamp's snag once had a limb hanging beside its leaning trunk).

const CELL = 0.06;
const LOOKS = [false, true].map((snowy) => ({ leaves: 0x3d7a3f, trunk: 0x4a3426, snowy }));

/** The model's surface cells, grouped by 26-connectivity: the number of separate pieces. */
function pieces(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const cells = new Set<string>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const at = (i: number, v: THREE.Vector3) => v.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
  for (let t = 0; t < n; t += 3) {
    at(t, a); at(t + 1, b); at(t + 2, c);
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (CELL / 2)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps;
        p.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
        cells.add(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)},${Math.floor(p.z / CELL)}`);
      }
    }
  }
  let groups = 0;
  const seen = new Set<string>();
  for (const start of cells) {
    if (seen.has(start)) continue;
    groups++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [x, y, z] = stack.pop()!.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const k = `${x + dx},${y + dy},${z + dz}`;
        if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
  }
  return groups;
}

describe('tree models', () => {
  it('every tree is one piece, in leaf and in snow', () => {
    const loose: string[] = [];
    for (const look of LOOKS) {
      for (const [key, g] of Object.entries(buildModels(look))) {
        if (!key.startsWith('tree-')) continue;
        const k = pieces(g);
        if (k > 1) loose.push(`${key}${look.snowy ? ' (snowy)' : ''}: ${k} pieces`);
      }
    }
    expect(loose).toEqual([]);
  });
});
