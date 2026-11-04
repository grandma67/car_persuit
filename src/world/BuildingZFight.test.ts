import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { generateCity } from './CityGenerator';
import { buildingGeometry } from './CityBuilder';
import { ALL_THEMES } from './CityTheme';
import { CLIMATES, type Climate } from './Climate';
import type { CityData } from './CityGenerator';
import type { CityTheme } from './CityTheme';
import { colourTag, coplanarOverlaps, trianglesOf, type Tri } from '../render/coplanar';

// Building faces sharing a plane, facing the same way, in different colours or from different
// buildings: they z-fight. Swept over rolled cities (districts on), every theme and climate in turn.

/**
 * What z-fights today, to fix, as `lot: meshes` (one building) or `lot | lot: meshes` (two
 * neighbours). Remove a key once it passes; a stale key fails too.
 */
const KNOWN = new Set<string>([
  // Neighbours in a terrace: lots stand 0.3–0.5 m apart, and equal-height neighbours' overhangs cross
  // that gap in one plane. Old town: steep gables' soffits (at y - STEEP * EAVE, whatever the size);
  // jettied upper floors grow on every side, so neighbours' fronts or bressumers can land in one plane.
  // Chinatown: the cap slabs and soffits under the 0.9 m pagoda skirt, in different tile colours.
  'oldtown/halfTimbered | oldtown/halfTimbered: roof/roof', 'oldtown/halfTimbered | oldtown/stoneHouse: roof/roof',
  'oldtown/arcade | oldtown/halfTimbered: roof/roof', 'oldtown/stoneHouse | oldtown/stoneHouse: roof/roof',
  'oldtown/arcade | oldtown/stoneHouse: roof/roof',
  'oldtown/halfTimbered | oldtown/halfTimbered: halfTimber/halfTimber', 'oldtown/halfTimbered | oldtown/halfTimbered: halfTimber/roof',
  'chinatown/shophouse | chinatown/shophouse: roof/roof', 'chinatown/restaurant | chinatown/shophouse: roof/roof',
]);

const SEEDS = Array.from({ length: 40 }, (_, k) => k + 1);

/** Every wall and roof triangle, tagged `building:mesh:colour`: built one building at a time with the
 * rng shared in order, which gives the same geometry as building them all at once (tested below). */
function trianglesByBuilding(city: CityData, theme: CityTheme, climate: Climate, seed: number): Tri[] {
  const rng = new Rng(seed ^ 0x5eed);
  const tris: Tri[] = [];
  city.buildings.forEach((b, i) => {
    const { walls, roofs } = buildingGeometry({ ...city, buildings: [b] }, theme, climate, rng);
    for (const [name, g] of [...walls, ['roof', roofs] as const]) {
      const col = colourTag(g.colors);
      tris.push(...trianglesOf(g.positions, g.indices, (v) => `${i}:${name}:${col(v)}`));
    }
  });
  return tris;
}

describe('building geometry z-fighting', () => {
  it('one building at a time builds the same triangles as the whole city', () => {
    const city = generateCity({ seed: 3 });
    const one = trianglesByBuilding(city, ALL_THEMES[0], CLIMATES.temperate, 3);
    const { walls, roofs } = buildingGeometry(city, ALL_THEMES[0], CLIMATES.temperate, new Rng(3 ^ 0x5eed));
    const all = [...walls.values(), roofs].flatMap((g) => trianglesOf(g.positions, g.indices, () => ''));
    const key = (t: Tri) => [t.a, t.b, t.c].flat().map((v) => v.toFixed(4)).join(',');
    expect(one.length).toBe(all.length);
    expect(new Set(one.map(key))).toEqual(new Set(all.map(key)));
  });


  it(`no faces fight across ${SEEDS.length} cities`, () => {
    const found = new Map<string, string>();
    for (const seed of SEEDS) {
      const city = generateCity({ seed });
      const theme = ALL_THEMES[seed % ALL_THEMES.length];
      const climate = seed % 2 ? CLIMATES.temperate : CLIMATES.snow;
      for (const o of coplanarOverlaps(trianglesByBuilding(city, theme, climate, seed))) {
        const [a, b] = o.tags.map((t) => t.split(':'));
        const lot = (i: string) => {
          const q = city.buildings[+i];
          return q.district ? `${q.district}/${q.lot}` : q.zone;
        };
        const meshes = [a[1], b[1]].sort().join('/');
        const key = a[0] === b[0] ? `${lot(a[0])}: ${meshes}` : `${[lot(a[0]), lot(b[0])].sort().join(' | ')}: ${meshes}`;
        if (!found.has(key)) found.set(key, `${key} (seed ${seed} ${climate.name}, buildings ${a[0]}/${b[0]} at ${o.at.map((v) => v.toFixed(1))}, ${o.area.toFixed(2)} m²)`);
      }
    }
    expect([...found].filter(([k]) => !KNOWN.has(k)).map(([, s]) => s), 'new z-fighting').toEqual([]);
    expect([...KNOWN].filter((k) => !found.has(k)), 'fixed: drop from KNOWN').toEqual([]);
  });
});
