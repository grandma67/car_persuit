import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { generateCity } from './CityGenerator';
import { buildingGeometry, type GeometryBuilder } from './CityBuilder';
import { ALL_THEMES } from './CityTheme';
import { CLIMATES } from './Climate';

/** A cheap fingerprint of a builder's arrays: counts plus a rolling sum (catches moved vertices). */
function fingerprint(g: GeometryBuilder): string {
  let h = 0;
  for (const arr of [g.positions, g.normals, g.colors, g.uvs, g.indices]) {
    for (let i = 0; i < arr.length; i++) h = (h * 31 + Math.round(arr[i] * 1000)) % 1_000_000_007;
  }
  return `${g.positions.length / 3}v ${g.indices.length}i #${h}`;
}

describe('building geometry', () => {
  // With no district, every theme's buildings come out exactly as before the LotLook refactor.
  it.each([1, 42, 1234])('seed %i: walls per facade and roofs are unchanged', (seed) => {
    const city = generateCity(seed);
    const out: Record<string, Record<string, string>> = {};
    for (const theme of ALL_THEMES) {
      for (const climate of [CLIMATES.temperate, CLIMATES.snow]) {
        const { walls, roofs } = buildingGeometry(city, theme, climate, new Rng(seed ^ 0x5eed));
        const row: Record<string, string> = { roofs: fingerprint(roofs) };
        for (const [facade, g] of walls) row[facade] = fingerprint(g);
        out[`${theme.name}/${climate.name}`] = row;
      }
    }
    expect(out).toMatchSnapshot();
  });
});
