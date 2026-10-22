// A district's building-mesh budget over many seeds, without a throwaway script:
//   npm run budget -- harbor [seeds=20]
// Per seed: its buildings' merged walls + roofs triangles (budget < ~60k), new facade styles it
// uses, and generation + building geometry time with it forced on vs off (budget: within ~50 ms;
// the first seeds include JIT warm-up). Shader programs and FPS need the browser (dbg.stats(), dbg.fps()).
import { generateCity, type CityData } from '../src/world/CityGenerator';
import { buildingGeometry, lookFor } from '../src/world/CityBuilder';
import { pickTheme } from '../src/world/CityTheme';
import { pickClimate } from '../src/world/Climate';
import { Rng } from '../src/core/Rng';
import type { DistrictKind } from '../src/world/districts/District';

export default function ([kind = 'harbor', n = '20']: string[]): void {
  const rows: string[] = [];
  let worst = 0, extra = 0;
  const facades = new Set<string>();
  for (let i = 0; i < Number(n); i++) {
    const seed = i * 7919 + 11;
    const climate = pickClimate(seed), theme = pickTheme(seed, climate);
    const build = (force: boolean) => {
      const t0 = performance.now();
      const city = generateCity(seed, undefined, { force: { [kind]: force } });
      buildingGeometry(city, theme, climate, new Rng(seed));
      return { city, ms: performance.now() - t0 };
    };
    const on = build(true), off = build(false);
    if (!on.city.districts.some((q) => q.kind === (kind as DistrictKind))) continue;
    const mine: CityData = { ...on.city, buildings: on.city.buildings.filter((b) => b.district === kind) };
    for (const b of mine.buildings) {
      const look = lookFor(b, theme);
      facades.add(look.facade);
      if (look.ground) facades.add(look.ground);
    }
    const { walls, roofs } = buildingGeometry(mine, theme, climate, new Rng(seed));
    const tris = [...walls.values(), roofs].reduce((s, g) => s + g.indices.length / 3, 0);
    worst = Math.max(worst, tris);
    if (i >= 3) extra = Math.max(extra, on.ms - off.ms);
    rows.push(`${seed}  walls+roofs ${tris} tris  on ${on.ms.toFixed(0)} ms  off ${off.ms.toFixed(0)} ms`);
  }
  console.log(rows.join('\n'));
  console.log({ worstTris: worst, worstExtraMs: +extra.toFixed(1), facadeStyles: [...facades] });
}
