import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import '../../world/districts/index'; // the district registry first (Swamp.ts and it import each other)
import { witchPool } from '../../world/districts/Swamp';
import { districtCities } from '../../world/paramsTesting';
import { boardwalk, witchHouse, witchIsland } from './SwampWitch';

// The Swamp's set pieces keep the polygon budgets (knowledge/polygons.md): the witch house and its
// island one landmark (<= 1 500), the boardwalks by the metre (planks without their hidden edges).

const tris = (gs: THREE.BufferGeometry[]) => gs.reduce((n, g) => n + (g.index ? g.index.count : g.getAttribute('position').count) / 3, 0);

describe('swamp set pieces stay low-poly', () => {
  for (const [seed, city, q] of districtCities('swamp', [])) {
    it(`seed ${seed}`, () => {
      const pool = witchPool(city, q);
      const house = q.dressing.structures.find((s) => s.kind === 'witchHouse');
      if (pool && house) expect(tris(witchIsland(pool.x, pool.z, 0, false, seed)) + tris(witchHouse(house, 0, false).solid)).toBeLessThanOrEqual(1500);
      for (const d of q.dressing.decks ?? []) {
        const perMetre = tris(boardwalk(d, city.terrain, false, seed)) / (d.hz * 2);
        expect(perMetre, `deck ${d.hz * 2} m long`).toBeLessThanOrEqual(32);
      }
    });
  }
});
