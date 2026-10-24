// Guard for refactors that must not move any seed: hashes every city the game would build for 60
// seeds (i * 7919 + 11), with the defaults and with every district forced on, plus the run's look
// (climate, weather, time, theme, start hour) and its destinations.
//   npm run hash -- [--out f.txt] [--vs f.txt] [seeds=60]
// --out writes one line per city; --vs compares with such a file and names the cities that moved.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Rng } from '../src/core/Rng';
import { pickDestinations } from '../src/gameplay/MissionSystem';
import { generateCity, type CityData } from '../src/world/CityGenerator';
import { pickTheme, pickTimeOfDay, startHour } from '../src/world/CityTheme';
import { pickClimate, pickWeather } from '../src/world/Climate';
import { districtOfNode } from '../src/world/districts/runtime';
import { DISTRICT_DEFS } from '../src/world/districts/index';

/** JSON with Maps and Sets as arrays, the graph as its nodes, and no functions. */
export function cityJson(city: CityData): string {
  return JSON.stringify(city, (key, value) => {
    if (key === 'params' || key === 'warnings' || key === 'features' || key === 'pins') return undefined; // they describe the city, they aren't it
    if (value instanceof Map) return [...value];
    if (value instanceof Set) return [...value];
    if (typeof value === 'function') return undefined;
    if (key === 'graph') return value.nodes;
    return value;
  });
}

export const hashOf = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** What the game builds for a seed, as one hash: the city, the run's look and its destinations. */
export function runHash(seed: number, city: CityData): string {
  const climate = pickClimate(seed);
  const weather = pickWeather(seed, climate);
  const time = pickTimeOfDay(seed).name;
  const theme = pickTheme(seed, climate);
  const start = city.graph.nearest(city.spawn.x, city.spawn.z);
  const dest = pickDestinations(city.graph, new Rng(seed ^ 0xde57), start.id, undefined, (id) => districtOfNode(city, id)).map((n) => n.id);
  return hashOf(cityJson(city) + JSON.stringify({ climate: climate.name, weather, time, theme, hour: startHour(seed, time), dest }));
}

export default function (args: string[]): void {
  const n = Number(args.find((a) => a.startsWith('seeds='))?.slice(6) ?? 60);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const all = Object.fromEntries(DISTRICT_DEFS.map((d) => [d.kind, true]));
  const lines: string[] = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const seed = i * 7919 + 11;
    lines.push(`${seed} default ${runHash(seed, generateCity(seed))}`);
    lines.push(`${seed} all ${runHash(seed, generateCity(seed, undefined, { force: all }))}`);
  }
  const ms = performance.now() - t0;
  const out = flag('--out');
  if (out) writeFileSync(out, lines.join('\n') + '\n');
  const vs = flag('--vs');
  if (vs) {
    const ref = new Map(readFileSync(vs, 'utf8').trim().split('\n').map((l) => [l.split(' ').slice(0, 2).join(' '), l]));
    const moved = lines.filter((l) => ref.get(l.split(' ').slice(0, 2).join(' ')) !== l);
    console.log(moved.length ? `MOVED (${moved.length} of ${lines.length}):\n${moved.join('\n')}` : `identical: ${lines.length} cities`);
    if (moved.length) process.exitCode = 1;
  } else if (!out) console.log(lines.join('\n'));
  console.log(`(${lines.length} cities in ${(ms / 1000).toFixed(1)} s)`);
}
