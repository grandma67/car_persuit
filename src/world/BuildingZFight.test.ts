import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { generateCity } from './CityGenerator';
import { buildingGeometry, buildingReach } from './CityBuilder';
import { ALL_THEMES } from './CityTheme';
import { CLIMATES, type Climate } from './Climate';
import type { CityData } from './CityGenerator';
import type { CityTheme } from './CityTheme';
import { colourTag, coplanarOverlaps, trianglesOf, type Tri } from '../render/coplanar';

// Building faces sharing a plane, facing the same way, in different colours or from different
// buildings: they z-fight. Swept over rolled cities (districts on), every theme and climate in turn.

const SEEDS = Array.from({ length: 40 }, (_, k) => k + 1);

/** Every wall and roof triangle, tagged `building:mesh:colour`: built one building at a time with the
 * rng shared in order, which gives the same geometry as building them all at once (tested below). */
function trianglesByBuilding(city: CityData, theme: CityTheme, climate: Climate, seed: number): Tri[] {
  const rng = new Rng(seed ^ 0x5eed);
  const reach = buildingReach(city.buildings); // from the whole city: each building's room next to its neighbours
  const tris: Tri[] = [];
  city.buildings.forEach((b, i) => {
    const { walls, roofs } = buildingGeometry({ ...city, buildings: [b] }, theme, climate, rng, [reach[i]]);
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
    expect([...found.values()]).toEqual([]);
  });
});

describe('buildingReach', () => {
  const lot = (x: number, z: number, w = 10, d = 10) => ({ x, z, w, d });

  it('splits the gap between neighbours, 1 cm short of the middle each', () => {
    const [a, b] = buildingReach([lot(0, 0), lot(10.5, 0)]); // walls at 5 and 5.5
    expect(a.x1).toBeCloseTo(5.24);
    expect(b.x0).toBeCloseTo(5.26);
    expect([a.x0, a.z0, a.z1, b.x1]).toEqual([-Infinity, -Infinity, Infinity, Infinity]);
  });

  it('a gap too narrow to stand out in: the walls themselves', () => {
    const [a, b] = buildingReach([lot(0, 0), lot(10.06, 0)]);
    expect(a.x1).toBe(5);
    expect(b.x0).toBeCloseTo(5.06);
  });

  it('diagonal neighbours split along the axis they are furthest apart on', () => {
    const [a, b] = buildingReach([lot(0, 0), lot(10.4, 10.8)]); // 0.4 apart in x, 0.8 in z
    expect(a.z1).toBeCloseTo(5.39);
    expect(b.z0).toBeCloseTo(5.41);
    expect([a.x1, b.x0]).toEqual([Infinity, -Infinity]);
  });

  it('far neighbours leave it unlimited', () => {
    expect(buildingReach([lot(0, 0), lot(20, 0)])[0].x1).toBe(Infinity);
  });
});
