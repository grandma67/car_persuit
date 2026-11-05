import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import '../../world/districts/index'; // the district registry first
import type { Structure } from '../../world/districts/District';
import { districtCities } from '../../world/paramsTesting';
import { colourTag, coplanarOverlaps, trianglesOf } from '../coplanar';
import { ranchGate } from './Farm';
import { boulder, firePit, gatePosts, logLoader, logStack, logTruck, lookout, stump } from './ForestSet';

// The Forest's set pieces (the district mesh: neither PropModels.test nor the building sweep sees
// them): no coplanar faces of different colours (z-fighting), in and out of the snow, and each
// within its polygon budget (knowledge/POLYGONS.md). Each piece is built at the origin: at world
// coordinates float32 error in the normals fakes overlaps.

const BUDGET: Record<string, number> = {
  logStack: 500, logTruck: 900, logLoader: 260, lookout: 900, firePit: 400, gatePosts: 160, logArch: 320, boulder: 80, stump: 80,
};

function build(s: Structure, snowy: boolean): THREE.BufferGeometry {
  const out: THREE.BufferGeometry[] = [];
  const at = { ...s, x: 0, z: 0, footprints: s.footprints.map((f) => ({ ...f, x: f.x - s.x, z: f.z - s.z })) };
  if (s.kind === 'logStack') logStack(at, 0, snowy, out);
  else if (s.kind === 'logTruck') logTruck(at, 0, snowy, out);
  else if (s.kind === 'logLoader') logLoader(at, 0, snowy, out);
  else if (s.kind === 'lookout') lookout(at, 0, snowy, out);
  else if (s.kind === 'firePit') firePit(at, 0, snowy, out);
  else if (s.kind === 'gatePosts') gatePosts(at, () => 0, snowy, out);
  else if (s.kind === 'logArch') ranchGate(at, snowy, out, [], false);
  else if (s.kind === 'boulder') boulder(at, 0, snowy, out);
  else if (s.kind === 'stump') stump(at, 0, snowy, out);
  else throw new Error(`no builder for ${s.kind}`);
  return mergeGeometries(out);
}

describe('forest set pieces', () => {
  for (const snowy of [false, true]) {
    for (const [seed, , q] of districtCities('forest', ['lumberyard', 'lookout', 'campsite', ...(snowy ? ['snow'] : [])], [11, 7930, 42, 1234])) {
      it(`seed ${seed}${snowy ? ', snow' : ''}: no z-fighting, within budget`, () => {
        const kinds = new Set<string>();
        for (const s of q.dressing.structures) {
          kinds.add(s.kind);
          const g = build(s, snowy);
          const pos = g.attributes.position.array, col = g.attributes.color.array;
          const fights = coplanarOverlaps(trianglesOf(pos, null, colourTag(col)));
          expect(fights.map((o) => `${s.kind} ${o.tags.join('/')} at ${o.at.map((v) => v.toFixed(2))}`)).toEqual([]);
          expect(pos.length / 9, s.kind).toBeLessThanOrEqual(BUDGET[s.kind]);
        }
        expect(kinds.has('logStack') && kinds.has('lookout') && kinds.has('firePit')).toBe(true);
      });
    }
  }
});
