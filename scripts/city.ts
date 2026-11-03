// City params from the command line: make a city from words, dump a seed, check a file, show a map.
//   npm run city -- make <words…> [seed=N] [--full] [--out f.json]   params with every word come true
//   npm run city -- dump <seed> [URL words…] [--out f.json]          exactly what ?seed=N&… builds
//   npm run city -- check <file…>                                     errors (exit 1) and warnings
//   npm run city -- show <file | seed [URL words…] | words…>          an ASCII map and a summary
//   npm run city -- words                                             the vocabulary
// `make` writes the words' params (a few lines, the rest rolls from its seed); --full writes the
// complete params instead, as a dump does. Without --out the JSON goes to stdout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEdgeKey, type CityParams } from '../src/world/CityParams';
import { generateCity, type CityData } from '../src/world/CityGenerator';
import { parseCityParams, readCityParams, serializeCityParams } from '../src/world/CityParamsFile';
import { makeCity, urlOverrides, WORDS } from '../src/world/makeCityParams';

const USAGE = `usage: npm run city -- make <words…> [seed=N] [--full] [--out f.json]
       npm run city -- dump <seed> [URL words…] [--out f.json]
       npm run city -- check <file…>
       npm run city -- show <file | seed [URL words…] | words…>
       npm run city -- words`;

/** The run's look and layout in one line. */
export function summary(city: CityData): string {
  const p = city.params;
  const t = city.terrain;
  const canals = t.canals.map((c) => `${c.axis}${c.line} ${c.half * 2}m`).join(', ');
  const ramps = city.landmarks.filter((l) => l.kind === 'ramp');
  const districts = city.districts.map((q) => {
    const f = Object.entries(q.features).map(([k, v]) => (v === true ? k : v === false ? `!${k}` : `${k}=${v}`));
    return `${q.kind} ${q.grid.w}x${q.grid.h}${f.length ? ` (${f.join(' ')})` : ''}`;
  });
  return [
    `seed ${p.seed}`, `${p.climate} ${p.weather} ${p.time} :${String(p.startMinute).padStart(2, '0')}`, `theme ${p.theme}`,
    `${p.blocks}x${p.blocks}`, p.driveSide === 'left' ? 'drives left' : '',
    t.hill ? `hill ${t.hill.height.toFixed(0)}m` : 'no hill', canals ? `canals ${canals}` : 'no canals',
    `${p.plazas?.length ?? 0} plazas`, `${ramps.length - ramps.filter((l) => l.crossing !== undefined).length} ramps`,
    `${ramps.filter((l) => l.crossing !== undefined).length} canal ramps`, `${city.roadworks.length} roadworks`,
    `${city.parkPieces.filter((q) => q.kind === 'pond').length} ponds`, `${city.parkPieces.filter((q) => q.kind === 'pitch').length} pitches`,
    districts.length ? districts.join(', ') : 'no districts',
  ].filter(Boolean).join(' · ');
}

const DISTRICT_CHAR: Record<string, string> = { oldtown: 'o', chinatown: 'c', harbor: 'h', farm: 'f', slums: 's', megapark: 'p' };

/**
 * The grid as text, j = 0 at the top: a block is 3 characters (zone D M R I, lower case a park; then
 * its district's letter; then * for a town square), a junction 1 and a street 1. See LEGEND.
 */
export function asciiMap(city: CityData): string {
  const p = city.params;
  const n = p.blocks!;
  const W = 4 * n + 1;
  const rows = Array.from({ length: 2 * n + 1 }, () => Array<string>(W).fill(' '));
  const col = (i: number) => 4 * i; // a road line's column
  const put = (r: number, c: number, s: string) => [...s].forEach((ch, k) => (rows[r][c + k] = ch));
  const id = (i: number, j: number) => j * (n + 1) + i;
  const road = new Set(city.roads.flatMap((s) => [`${s.a}>${s.b}`, `${s.b}>${s.a}`]));
  const plazas = new Set(p.plazas);
  const open = (i: number, j: number) => city.graph.nodes[id(i, j)].neighbors.length > 0;
  // canal lines: which nodes and streets are water
  const water = (i: number, j: number, horizontal?: boolean) =>
    city.terrain.canals.some((c) => (c.axis === 'x' ? j === c.line && horizontal !== false : i === c.line && horizontal !== true));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const r = 2 * j, c = col(i);
      put(r, c, open(i, j) ? '+' : water(i, j) ? '~' : ' ');
      if (i < n) {
        const key = `h${i},${j}`;
        put(r, c + 1, road.has(`${id(i, j)}>${id(i + 1, j)}`) ? '---' : plazas.has(key) ? '###' : water(i, j, true) ? '~~~' : '   ');
      }
      if (j < n) {
        const key = `v${i},${j}`;
        put(r + 1, c, road.has(`${id(i, j)}>${id(i, j + 1)}`) ? '|' : plazas.has(key) ? '#' : water(i, j, false) ? '~' : ' ');
      }
    }
  }
  // bridges: open junctions on a canal line
  for (const cn of city.terrain.canals) for (const b of p.terrain && typeof p.terrain.canals === 'object' ? p.terrain.canals.find((x) => x.axis === cn.axis && x.line === cn.line)?.bridges ?? [] : []) {
    const [i, j] = cn.axis === 'x' ? [b, cn.line] : [cn.line, b];
    put(2 * j, col(i), '=');
  }
  (p.zones ?? []).forEach((row, j) => [...row].forEach((z, i) => put(2 * j + 1, col(i) + 1, z)));
  for (const q of city.districts) {
    for (let j = q.grid.j0; j < q.grid.j0 + q.grid.h; j++) for (let i = q.grid.i0; i < q.grid.i0 + q.grid.w; i++) put(2 * j + 1, col(i) + 2, DISTRICT_CHAR[q.kind] ?? '?');
  }
  city.blocks.forEach((b, k) => b.square && put(2 * Math.floor(k / n) + 1, col(k % n) + 3, '*'));
  const edgeMark = (key: string, ch: string) => {
    const e = parseEdgeKey(key);
    if (e) e.horizontal ? put(2 * e.j, col(e.i) + 2, ch) : put(2 * e.j + 1, col(e.i), ch);
  };
  for (const l of p.landmarks ?? []) if (l.kind === 'ramp' && l.edge) edgeMark(l.edge, 'R');
  if (Array.isArray(p.canalRamps)) for (const c of p.canalRamps) edgeMark(c.edge, 'r');
  if (Array.isArray(p.roadworks)) for (const w of p.roadworks) w.node ? put(2 * w.node[1], col(w.node[0]), 'X') : edgeMark(w.edge!, 'x');
  (p.destinations ?? []).forEach(([i, j], k) => put(2 * j, col(i), String(k + 1)));
  if (p.spawn) put(2 * p.spawn.node[1], col(p.spawn.node[0]), '@');
  return rows.map((r) => r.join('').trimEnd()).join('\n');
}

const LEGEND = 'blocks: D M R I zone (lower case: park), o c h f s p district, * square · + junction, ~ canal, = bridge, # plaza · ' +
  '@ spawn, 1-5 destinations, R ramp, r canal ramp, X x roadworks (junction, street)';

/** --out f / --flag → removed from args. */
function take(args: string[], flag: string, value: boolean): string | boolean | undefined {
  const k = args.indexOf(flag);
  if (k < 0) return undefined;
  const v = value ? args[k + 1] : true;
  args.splice(k, value ? 2 : 1);
  return v;
}

function write(text: string, out: string | undefined) {
  if (!out) return void process.stdout.write(text);
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}

/** A seed and the URL's words → overrides; unknown words and debug-only words without debug say so. */
function fromUrl(seed: number, words: string[]): { params: CityParams; notes: string[] } {
  const urlWords = new Map(WORDS.filter((w) => w.url).map((w) => [w.name, w]));
  const debug = words.includes('debug');
  const notes: string[] = [];
  for (const raw of words) {
    const name = raw.split('=')[0];
    const w = urlWords.get(name);
    if (name === 'debug') continue;
    if (!w) throw new Error(`"${raw}" is not a URL flag (URL words: debug, ${[...urlWords.keys()].join(', ')})`);
    if (w.debug && !debug) notes.push(`"${raw}" is ignored without debug, as in the game`);
  }
  return { params: { seed, ...urlOverrides(words.join('&'), debug) }, notes };
}

const isSeed = (s: string | undefined) => s !== undefined && /^-?\d+$/.test(s);

/** show's argument: a file, a seed with URL words, or make's words. */
function cityOf(args: string[]): CityData {
  if (args.length === 1 && existsSync(args[0])) {
    const { params, errors } = parseCityParams(readFileSync(args[0], 'utf8'));
    if (!params) throw new Error(`${args[0]}:\n  ${errors.join('\n  ')}`);
    return generateCity(params);
  }
  if (isSeed(args[0])) {
    const { params, notes } = fromUrl(Number(args[0]), args.slice(1));
    notes.forEach((s) => console.log(`note: ${s}`));
    return generateCity(params);
  }
  return makeCity(...makeArgs(args)).city;
}

function makeArgs(args: string[]): [string[], { seed: number }] {
  const s = args.find((a) => a.startsWith('seed='));
  const seed = s ? Number(s.slice(5)) : Math.floor(Math.random() * 1_000_000);
  if (!Number.isInteger(seed)) throw new Error(`${s}: not a whole number`);
  return [args.filter((a) => a !== s), { seed }];
}

export default function (argv: string[]): void {
  const [cmd, ...args] = argv;
  try {
    if (cmd === 'make') {
      const out = take(args, '--out', true) as string | undefined;
      const full = take(args, '--full', false);
      const [words, opts] = makeArgs(args);
      if (!words.length) throw new Error('make: which words? (npm run city -- words)');
      const { params, city } = makeCity(words, opts);
      console.error(`${summary(city)}${params.seed !== opts.seed ? ` (tried seeds from ${opts.seed})` : ''}`);
      city.warnings.forEach((w) => console.error(`warning: ${w}`));
      write(serializeCityParams(full ? city.params : { ...params, note: `make ${words.join(' ')}` }), out);
    } else if (cmd === 'dump') {
      const out = take(args, '--out', true) as string | undefined;
      const [seed, ...words] = args;
      if (!isSeed(seed)) throw new Error('dump: a seed first (npm run city -- dump 9 time=night harbor=1)');
      const { params, notes } = fromUrl(Number(seed), words);
      notes.forEach((s) => console.error(`note: ${s}`));
      const city = generateCity(params);
      console.error(summary(city));
      write(serializeCityParams(city.params), out);
    } else if (cmd === 'check') {
      if (!args.length) throw new Error('check: which files?');
      let bad = 0;
      for (const file of args) {
        const v = readCityParams(readFileSync(file, 'utf8'));
        bad += v.errors.length ? 1 : 0;
        console.log(`${file}: ${v.errors.length ? `${v.errors.length} error(s)` : 'ok'}${v.warnings.length ? `, ${v.warnings.length} warning(s)` : ''}`);
        v.errors.forEach((e) => console.log(`  error: ${e}`));
        v.warnings.forEach((w) => console.log(`  warning: ${w}`));
      }
      if (bad) process.exitCode = 1;
    } else if (cmd === 'show') {
      if (!args.length) throw new Error('show: a file, a seed or words');
      const city = cityOf(args);
      console.log(asciiMap(city));
      console.log(LEGEND);
      console.log(summary(city));
      city.warnings.forEach((w) => console.log(`warning: ${w}`));
    } else if (cmd === 'words') {
      for (const w of WORDS) {
        const name = `${w.name}${w.value ? `=${w.value}` : ''}`;
        console.log(`${name.padEnd(34)} ${w.help}${w.url ? ` [URL${w.debug ? ', with debug' : ''}]` : ''}`);
      }
    } else {
      console.log(USAGE);
      if (cmd) process.exitCode = 1;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
