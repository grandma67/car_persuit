import { describe, expect, it } from 'vitest';
import { DISTRICT_DEFS } from '../world/districts/index';
import { districtCities } from '../world/paramsTesting';
import { COLORS } from './Minimap';

// A district's minimap outline must stand out from the ground under it: the land, or the park green
// when its blocks are open ground (the Swamp's dark olive once vanished on the park).

const hex = (c: string | number) => (typeof c === 'number' ? c : parseInt(c.slice(1), 16));
/** WCAG relative luminance of a 0xRRGGBB colour. */
function luminance(c: number): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: number, b: number) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((u, v) => v - u);
  return (hi + 0.05) / (lo + 0.05);
};

describe('minimap district colours', () => {
  for (const def of DISTRICT_DEFS) {
    it(`${def.kind} stands out from the ground it is drawn over`, () => {
      const [[, city, q]] = districtCities(def.kind, [], [11]);
      const grounds = new Set(q.blocks.map((k) => (city.blocks[k].park ? COLORS.park : COLORS.land)));
      for (const ground of grounds) expect(contrast(def.mapColor, hex(ground)), `${def.kind} on ${ground}`).toBeGreaterThan(2.2);
    });
  }
});
