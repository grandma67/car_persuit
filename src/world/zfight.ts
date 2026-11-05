// Z-fighting sweeps over built geometry, shared by the tests (BuildingZFight, PropModels) and
// `npm run zfight` (scripts/zfight.ts), which lists every overlap with where to look.
import { Rng } from '../core/Rng';
import { buildingGeometry, buildingReach } from './CityBuilder';
import type { CityData } from './CityGenerator';
import { ALL_THEMES, type CityTheme } from './CityTheme';
import { CLIMATES, type Climate } from './Climate';
import { buildModels } from './PropSystem';
import { colourTag, coplanarOverlaps, trianglesOf, type Overlap, type Tri } from '../render/coplanar';

/** A building overlap: `key` groups it by lot kind (`lot: meshes` or `lot | lot: meshes`). */
export interface BuildingFight {
  key: string;
  overlap: Overlap;
  /** The building indices (one, or two neighbours). */
  buildings: number[];
}

/** Every wall and roof triangle, tagged `building:mesh:colour`: built one building at a time with the
 * rng shared in order and each building's reach from the whole city, which gives the same geometry
 * as building them all at once (BuildingZFight.test checks it). */
export function trianglesByBuilding(city: CityData, theme: CityTheme, climate: Climate, seed: number): Tri[] {
  const rng = new Rng(seed ^ 0x5eed);
  const reach = buildingReach(city.buildings);
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

/** The theme and climate the building sweep gives a seed: every theme and both roof kinds in turn. */
export const sweepLook = (seed: number): { theme: CityTheme; climate: Climate } => ({
  theme: ALL_THEMES[seed % ALL_THEMES.length],
  climate: seed % 2 ? CLIMATES.temperate : CLIMATES.snow,
});

/** A building's lot kind: `district/lot`, else its zone. */
const lotOf = (city: CityData, i: number) => {
  const b = city.buildings[i];
  return b.district ? `${b.district}/${b.lot}` : b.zone;
};

/** Faces of one building, or of two, sharing a plane and facing the same way: they z-fight. */
export function buildingFights(city: CityData, theme: CityTheme, climate: Climate, seed: number): BuildingFight[] {
  return coplanarOverlaps(trianglesByBuilding(city, theme, climate, seed)).map((overlap) => {
    const [a, b] = overlap.tags.map((t) => t.split(':'));
    const meshes = [a[1], b[1]].sort().join('/');
    const key = a[0] === b[0]
      ? `${lotOf(city, +a[0])}: ${meshes}`
      : `${[lotOf(city, +a[0]), lotOf(city, +b[0])].sort().join(' | ')}: ${meshes}`;
    return { key, overlap, buildings: a[0] === b[0] ? [+a[0]] : [+a[0], +b[0]] };
  });
}

/** The looks the prop sweep builds every model in. */
export const PROP_LOOKS = [
  { leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: false },
  { leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: true },
];

/** Two parts of a prop model in one plane, facing the same way, in different colours. */
export function propFights(): { key: string; snowy: boolean; overlap: Overlap }[] {
  const out: { key: string; snowy: boolean; overlap: Overlap }[] = [];
  for (const look of PROP_LOOKS) {
    for (const [key, g] of Object.entries(buildModels(look))) {
      const col = g.attributes.color?.array;
      if (!col) continue;
      for (const overlap of coplanarOverlaps(trianglesOf(g.attributes.position.array, g.index?.array ?? null, colourTag(col)))) {
        out.push({ key, snowy: look.snowy, overlap });
      }
    }
  }
  return out;
}

/** One overlap as a line: where it is, which way it faces, how big. */
export const describeOverlap = (o: Overlap) =>
  `${o.tags.join(' vs ')} facing (${o.normal.map((v) => v.toFixed(2))}) at (${o.at.map((v) => v.toFixed(2))}), ${o.area.toFixed(3)} m²`;
