// Guard for refactors that must not move any seed: hashes every city the game would build for 60
// seeds (i * 7919 + 11), with the defaults and with every district forced on, plus the run's look
// (climate, weather, time, theme, start hour) and its destinations.
//   npm run hash -- [--out f.txt] [--vs <git ref | f.txt>] [--reload] [seeds=60]
// --out writes one line per city; --vs compares with a git ref (HEAD, main…: hashed on a temporary
// worktree of it, with this script, or the ref's own when this one can't run there) or with a file
// --out wrote, and names the cities that moved.
// --reload also writes each city's dump, reads it back and builds it: same hash, same dump (the
// suite does this for 20 of the seeds; run it with the hash at each milestone).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cityDestinations, generateCity, type CityData } from '../src/world/CityGenerator';
import { pickTheme, startHourAt } from '../src/world/CityTheme';
import { CLIMATES } from '../src/world/Climate';
import { DISTRICT_DEFS } from '../src/world/districts/index';
import { parseCityParams, serializeCityParams } from '../src/world/CityParamsFile';

/** JSON with Maps and Sets as arrays, the graph as its nodes, and no functions. */
export function cityJson(city: CityData): string {
  return JSON.stringify(city, (key, value) => {
    if (key === 'params' || key === 'warnings' || key === 'features' || key === 'pins') return undefined; // they describe the city, they aren't it
    if (key === 'water' && Array.isArray(value) && !value.length) return undefined; // added later: no water hashes as before
    if (value instanceof Map) return [...value];
    if (value instanceof Set) return [...value];
    if (typeof value === 'function') return undefined;
    if (key === 'graph') return value.nodes;
    return value;
  });
}

export const hashOf = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** What the game builds for a seed, as one hash: the city, the run's look and its destinations (all from city.params). */
export function runHash(city: CityData): string {
  const p = city.params;
  const theme = pickTheme(p.seed, CLIMATES[p.climate!], p.theme);
  const dest = cityDestinations(city).map((n) => n.id);
  return hashOf(cityJson(city) + JSON.stringify({ climate: p.climate, weather: p.weather, time: p.time, theme, hour: startHourAt(p.time!, p.startMinute!), dest }));
}

/** The hash lines of a git ref: a temporary worktree, this script first, the ref's own if this one fails there. */
function refLines(ref: string, seeds: number): string {
  const root = resolve(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'city-hash-'));
  const out = join(dir, 'hash.txt');
  const tree = join(dir, 'tree');
  execFileSync('git', ['worktree', 'add', '--detach', '-q', tree, ref], { cwd: root });
  try {
    symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'));
    copyFileSync(join(root, 'scripts/run-ts.mjs'), join(tree, 'scripts/run-ts.mjs'));
    const own = join(tree, 'scripts/city-hash.ts');
    const theirs = existsSync(own) ? readFileSync(own, 'utf8') : null;
    const run = () => execFileSync('node', ['scripts/run-ts.mjs', 'scripts/city-hash.ts', '--out', out, `seeds=${seeds}`], { cwd: tree, stdio: 'pipe' });
    copyFileSync(join(root, 'scripts/city-hash.ts'), own);
    const why = (e: unknown) => String((e as { stderr?: Buffer }).stderr ?? e).trim().split('\n').filter((l) => /error/i.test(l) && !/WebSocket/.test(l)).slice(0, 3).join('\n  ');
    try {
      run();
    } catch (e) {
      if (theirs === null) throw new Error(`can't hash ${ref} (it has no city-hash.ts of its own):\n  ${why(e)}`);
      console.log(`(this script can't run on ${ref}; hashing with ${ref}'s own)`);
      writeFileSync(own, theirs);
      try {
        run();
      } catch (e2) {
        throw new Error(`can't hash ${ref}:\n  ${why(e2)}`);
      }
    }
    return readFileSync(out, 'utf8');
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', tree], { cwd: root });
    rmSync(dir, { recursive: true, force: true });
  }
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
  const reload = args.includes('--reload');
  const unlike: string[] = [];
  const add = (name: string, city: CityData) => {
    const hash = runHash(city);
    lines.push(`${name} ${hash}`);
    if (!reload) return;
    const file = serializeCityParams(city.params);
    const { params, errors } = parseCityParams(file);
    const back = params && generateCity(params);
    if (!back || runHash(back) !== hash || serializeCityParams(back.params) !== file) unlike.push(`${name}${errors.length ? `: ${errors.join('; ')}` : ''}`);
  };
  for (let i = 0; i < n; i++) {
    const seed = i * 7919 + 11;
    add(`${seed} default`, generateCity(seed));
    add(`${seed} all`, generateCity(seed, undefined, { force: all }));
  }
  const ms = performance.now() - t0;
  const out = flag('--out');
  if (out) writeFileSync(out, lines.join('\n') + '\n');
  const vs = flag('--vs');
  if (vs) {
    const text = existsSync(vs) ? readFileSync(vs, 'utf8') : refLines(vs, n);
    const ref = new Map(text.trim().split('\n').map((l) => [l.split(' ').slice(0, 2).join(' '), l]));
    const moved = lines.filter((l) => ref.get(l.split(' ').slice(0, 2).join(' ')) !== l);
    console.log(moved.length ? `MOVED (${moved.length} of ${lines.length}):\n${moved.join('\n')}` : `identical: ${lines.length} cities`);
    if (moved.length) process.exitCode = 1;
  } else if (!out) console.log(lines.join('\n'));
  if (reload) console.log(unlike.length ? `RELOADS DIFFERENTLY (${unlike.length}):\n${unlike.join('\n')}` : `every dump reloads as its city`);
  if (unlike.length) process.exitCode = 1;
  console.log(`(${lines.length} cities in ${(ms / 1000).toFixed(1)} s)`);
}
