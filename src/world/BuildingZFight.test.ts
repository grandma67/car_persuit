import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { generateCity } from './CityGenerator';
import { buildingGeometry, buildingReach } from './CityBuilder';
import { ALL_THEMES } from './CityTheme';
import { CLIMATES } from './Climate';
import { trianglesOf, type Tri } from '../render/coplanar';
import { buildingFights, describeOverlap, sweepLook, trianglesByBuilding } from './zfight';

// Building faces sharing a plane, facing the same way, in different colours or from different
// buildings: they z-fight. Swept over rolled cities (districts on), every theme and climate in turn.
// `npm run zfight` lists every overlap with its buildings, for fixing one.

const SEEDS = Array.from({ length: 40 }, (_, k) => k + 1);

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
      const { theme, climate } = sweepLook(seed);
      for (const f of buildingFights(generateCity({ seed }), theme, climate, seed)) {
        if (!found.has(f.key)) found.set(f.key, `${f.key} (seed ${seed} ${climate.name}, buildings ${f.buildings.join('/')}: ${describeOverlap(f.overlap)})`);
      }
    }
    expect([...found.values()], 'npm run zfight lists them all').toEqual([]);
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
