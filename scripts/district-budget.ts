// A district's building-mesh budget over many seeds (knowledge/DISTRICTS_DEV.md):
//   npm run budget -- <kind> [seeds=20]
// Per seed that places it: its buildings' merged walls + roofs triangles (budget < ~60k) and
// generation + building geometry ms forced on vs off (budget: within ~50 ms; the first 3 seeds are
// JIT warm-up, left out of worstExtraMs); then the facade styles its buildings use. Shader programs
// and FPS need the browser (dbg.stats(), dbg.fps()).
import { generateCity, type CityData } from '../src/world/CityGenerator';
import { buildingGeometry, lookFor } from '../src/world/CityBuilder';
import { pickTheme } from '../src/world/CityTheme';
import { pickClimate } from '../src/world/Climate';
import { Rng } from '../src/core/Rng';
import type { DistrictKind } from '../src/world/districts/District';
import { DISTRICT_DEFS } from '../src/world/districts/index';

export default function ([kind = 'harbor', arg = '20']: string[]): void {
  const n = arg.replace(/^seeds=/, ''); // `seeds=20` or `20`
  if (!DISTRICT_DEFS.some((d) => d.kind === kind)) {
    console.log(`unknown district "${kind}"; registered: ${DISTRICT_DEFS.map((d) => d.kind).join(', ')}`);
    return;
  }
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
  console.log(rows.length ? rows.join('\n') : `no seed placed ${kind}`);
  console.log(`worstTris ${worst} · worstExtraMs ${extra.toFixed(1)} · facades ${[...facades].join(', ')}`);
}
