// Words → city params: one vocabulary for tests, `npm run city -- make` and the URL. A word that is
// a URL flag is spelled and means exactly what the flag does (`england`, `roadworks`, `time=night`,
// `harbor=1` …); the rest say what the URL can't (`harbor`: exactly these districts; `festival`,
// `!festival`, `ship=bulk`: a district's features, which bring their district; `flat`, `ramps=2` …).
// makeCityParams pins what it can, builds, checks every word came true and otherwise tries the next
// seed; it never hands back a city without what was asked.
import { CityParamsError, PARAMS_VERSION, type CityParams, type DistrictParams, type FeatureValue } from './CityParams';
import { generateCity, type CityConfig, type CityData } from './CityGenerator';
import { ALL_THEMES, TIME_NAMES, type TimeOfDayName } from './CityTheme';
import { CLIMATES, WEATHER_NAMES, type ClimateName, type WeatherName } from './Climate';
import type { DistrictKind } from './districts/District';
import { DISTRICT_DEFS } from './districts/index';

type Mode = 'make' | 'url';

interface Draft {
  o: Partial<CityParams>;
  exact: Map<DistrictKind, DistrictParams>;
  force: Partial<Record<DistrictKind, boolean>>;
  owners: Map<string, { word: string; value: string }>;
}

export interface Word {
  name: string;
  /** Also a URL flag: present or not ('flag'), or with a value. */
  url?: 'flag' | 'value';
  debug?: boolean; // the URL reads it only with ?debug
  value?: string; // what follows `=`, for the help
  negatable?: boolean; // `!name`: an on/off district feature, off
  help: string;
  /** Pin it; an error message when the value won't do. */
  apply(d: Draft, v: string | undefined, mode: Mode, word: string): string | void;
  /** Why the built city lacks it, or nothing. */
  check?(city: CityData, v: string | undefined): string | void;
}

/** Pin one field, refusing a second word that wants it otherwise. */
function set<K extends keyof CityParams>(d: Draft, key: K, value: CityParams[K], word: string, slot: string = key): string | void {
  const json = JSON.stringify(value);
  const had = d.owners.get(slot);
  if (had && had.value !== json) return `"${word}" conflicts with "${had.word}"`;
  d.owners.set(slot, { word, value: json });
  d.o[key] = value;
}

function setTerrain(d: Draft, key: 'hill' | 'canals' | 'canalWidth', value: boolean | number, word: string): string | void {
  const json = JSON.stringify(value);
  const had = d.owners.get(`terrain.${key}`);
  if (had && had.value !== json) return `"${word}" conflicts with "${had.word}"`;
  d.owners.set(`terrain.${key}`, { word, value: json });
  d.o.terrain = { ...d.o.terrain, [key]: value };
}

/** A whole number in range (the URL reads leading digits, as it always has). */
function int(v: string | undefined, lo: number, hi: number, mode: Mode): number | undefined {
  if (v === undefined) return undefined;
  const n = mode === 'url' ? Number.parseInt(v, 10) : /^\d+$/.test(v) ? Number(v) : NaN;
  return n >= lo && n <= hi ? n : undefined;
}

const count = (got: number, want: number, what: string) => (got === want ? undefined : `${what}: ${got}, not ${want}`);
const rampCount = (city: CityData) => city.landmarks.filter((l) => l.kind === 'ramp' && l.crossing === undefined).length;
const pieceCount = (city: CityData, kind: 'pond' | 'pitch') => city.parkPieces.filter((p) => p.kind === kind).length;
const canalRampCount = (city: CityData) => city.landmarks.filter((l) => l.kind === 'ramp' && l.crossing !== undefined).length;

const TIME_WORD = (name: TimeOfDayName): Word => ({
  name, help: `time=${name}`,
  apply: (d, _v, _m, word) => set(d, 'time', name, word),
  check: (c) => (c.params.time === name ? undefined : `time is ${c.params.time}`),
});
const WEATHER_WORD = (name: WeatherName): Word => ({
  name, help: name === 'snow' ? 'weather=snow in the snow climate' : `weather=${name}`,
  apply: (d, _v, _m, word) => set(d, 'weather', name, word) ?? (name === 'snow' ? set(d, 'climate', 'snow', word) : undefined),
  check: (c) => (c.params.weather === name ? undefined : `weather is ${c.params.weather} (${c.params.climate})`),
});
const CLIMATE_WORD = (name: ClimateName): Word => ({
  name, help: `city=${name}`,
  apply: (d, _v, _m, word) => set(d, 'climate', name, word),
  check: (c) => (c.params.climate === name ? undefined : `climate is ${c.params.climate}`),
});

/** A district by name: bare, exactly these districts; =1 / =0 (the URL's), forced on or off, the rest rolled. */
const DISTRICT_WORD = (kind: DistrictKind): Word => ({
  name: kind, url: 'value', value: '0|1', help: `${kind}: exactly the districts named; ${kind}=1|0 forces its roll (the URL's)`,
  apply: (d, v, mode) => {
    if (v === undefined && mode === 'make') {
      if (!d.exact.has(kind)) d.exact.set(kind, { kind });
      return;
    }
    if (v !== '0' && v !== '1') return `${kind}=${v}: 0 or 1`;
    d.force[kind] = v === '1';
  },
  check: (c, v) => {
    const has = c.districts.some((q) => q.kind === kind);
    return v === '0' ? (has ? `${kind} placed` : undefined) : has ? undefined : `no ${kind} (no room for it)`;
  },
});

/** A district feature (bool: bare or !name; int: name=N; one of names: name=x). Brings its district. */
function featureWords(): Word[] {
  const seen = new Map<string, number>();
  for (const def of DISTRICT_DEFS) for (const f of Object.keys(def.features)) seen.set(f.toLowerCase(), (seen.get(f.toLowerCase()) ?? 0) + 1);
  return DISTRICT_DEFS.flatMap((def) =>
    Object.entries(def.features).flatMap(([f, kind]) => {
      const valueOf = (v: string | undefined): FeatureValue | undefined => {
        if (kind === 'bool') return v === undefined || v === '1' ? true : v === '0' ? false : undefined;
        if (kind === 'int') return int(v, 0, 99, 'make');
        return v !== undefined && (kind as readonly string[]).includes(v) ? v : undefined;
      };
      const word = (name: string): Word => ({
        name, value: kind === 'bool' ? undefined : kind === 'int' ? 'N' : (kind as readonly string[]).join('|'), negatable: kind === 'bool',
        help: `${def.kind}'s ${f}${kind === 'bool' ? ' (!name: without)' : ''}${def.nightFeatures?.includes(f) ? ', night only' : ''}`,
        apply: (d, v, mode, w) => {
          if (mode === 'url') return 'not a URL flag';
          const value = valueOf(v);
          if (value === undefined) return `"${w}": ${kind === 'bool' ? 'bare, !name, =1 or =0' : kind === 'int' ? 'a count' : (kind as readonly string[]).join(' | ')}`;
          const entry = d.exact.get(def.kind) ?? { kind: def.kind };
          d.exact.set(def.kind, entry);
          const had = entry.features?.[f];
          if (had !== undefined && had !== value) return `"${w}" conflicts with an earlier ${f}`;
          entry.features = { ...entry.features, [f]: value };
        },
        check: (c, v) => {
          const q = c.districts.find((x) => x.kind === def.kind);
          if (!q) return `no ${def.kind}`;
          const got = def.built?.(q, c)[f] ?? q.features[f];
          return got === valueOf(v) ? undefined : `${def.kind}'s ${f} is ${JSON.stringify(got)}`;
        },
      });
      return seen.get(f.toLowerCase())! > 1 ? [word(`${def.kind}.${f}`)] : [word(f), word(`${def.kind}.${f}`)];
    }),
  );
}

export const WORDS: Word[] = [
  // --- the URL's flags, meaning exactly what they do there ---
  {
    name: 'england', url: 'flag', help: 'everyone drives on the left',
    apply: (d, _v, _m, w) => set(d, 'driveSide', 'left', w),
    check: (c) => (c.driveSide === 'left' ? undefined : 'drives on the right'),
  },
  {
    name: 'roadworks', url: 'flag', value: 'N', help: 'roadworks: every slot comes up (the URL\'s); roadworks=N: N sites, 0 none',
    apply: (d, v, mode, w) => {
      if (mode === 'url' || v === undefined) return set(d, 'roadworks', 'all', w);
      const n = int(v, 0, 20, mode);
      return n === undefined ? 'roadworks=N: 0 to 20' : set(d, 'roadworks', n, w);
    },
    check: (c, v) => (v === undefined ? (c.roadworks.length ? undefined : 'no roadworks site fits') : count(c.roadworks.length, Number(v), 'roadworks')),
  },
  {
    name: 'canalramp', url: 'flag', help: 'every canal-ramp roll comes up (needs a canal)',
    apply: (d, _v, _m, w) => set(d, 'canalRamps', 'all', w, 'canalRamps'),
    check: (c) => (canalRampCount(c) ? undefined : 'no canal ramp'),
  },
  {
    name: 'time', url: 'value', value: TIME_NAMES.join('|'), help: 'time of day (also bare: night)',
    apply: (d, v, _m, w) => ((TIME_NAMES as (string | undefined)[]).includes(v) ? set(d, 'time', v as TimeOfDayName, w) : `time=${v}: ${TIME_NAMES.join(' | ')}`),
    check: (c, v) => (c.params.time === v ? undefined : `time is ${c.params.time}`),
  },
  {
    name: 'blocks', url: 'value', value: 'N', help: 'grid size, 4 to 30 blocks a side',
    apply: (d, v, mode, w) => {
      const n = int(v, 4, 30, mode);
      return n === undefined ? 'blocks=N: 4 to 30' : set(d, 'blocks', n, w);
    },
    check: (c, v) => count(c.config.blocks, Number(v), 'blocks'),
  },
  {
    name: 'city', url: 'value', debug: true, value: Object.keys(CLIMATES).join('|'), help: 'the climate (also bare: desert)',
    apply: (d, v, _m, w) => (v !== undefined && v in CLIMATES ? set(d, 'climate', v as ClimateName, w) : `city=${v}: ${Object.keys(CLIMATES).join(' | ')}`),
    check: (c, v) => (c.params.climate === v ? undefined : `climate is ${c.params.climate}`),
  },
  {
    name: 'weather', url: 'value', debug: true, value: WEATHER_NAMES.join('|'), help: 'the weather, with the climate\'s fix-ups (also bare: rain)',
    apply: (d, v, _m, w) => ((WEATHER_NAMES as (string | undefined)[]).includes(v) ? set(d, 'weather', v as WeatherName, w) : `weather=${v}: ${WEATHER_NAMES.join(' | ')}`),
    check: (c, v) => (c.params.weather === v ? undefined : `weather is ${c.params.weather} (${c.params.climate})`),
  },
  {
    name: 'canals', url: 'value', debug: true, value: '0|1|2', help: 'how many canals',
    apply: (d, v, mode, w) => {
      const n = int(v, 0, 2, mode);
      return n === undefined ? 'canals=N: 0, 1 or 2' : setTerrain(d, 'canals', n, w);
    },
    check: (c, v) => count(c.terrain.canals.length, Number(v), 'canals'),
  },
  {
    name: 'hill', url: 'value', debug: true, value: '0|1', help: 'a hill (hill=0: none)',
    apply: (d, v, mode, w) => {
      if (mode === 'make' && v !== undefined && v !== '0' && v !== '1') return 'hill=0 or hill=1';
      return setTerrain(d, 'hill', v !== '0', w);
    },
    check: (c, v) => (!!c.terrain.hill === (v !== '0') ? undefined : c.terrain.hill ? 'a hill' : 'no hill'),
  },
  ...DISTRICT_DEFS.map((def) => DISTRICT_WORD(def.kind)),
  // --- what the URL can't say ---
  {
    name: 'flat', help: 'no hill, no canals (the physics sims\' ground)',
    apply: (d, _v, _m, w) => setTerrain(d, 'hill', false, w) ?? setTerrain(d, 'canals', 0, w),
    check: (c) => (c.terrain.hill || c.terrain.canals.length ? 'not flat' : undefined),
  },
  {
    name: 'canalramps', value: 'N', help: 'N canal ramps',
    apply: (d, v, mode, w) => {
      const n = int(v, 0, 10, mode);
      return n === undefined ? 'canalramps=N: 0 to 10' : set(d, 'canalRamps', n, w, 'canalRamps');
    },
    check: (c, v) => count(canalRampCount(c), Number(v), 'canal ramps'),
  },
  {
    name: 'ramps', value: 'N', help: 'N jump ramps (street and square, not the canal ones)',
    apply: (d, v, mode, w) => {
      const n = int(v, 0, 8, mode);
      return n === undefined ? 'ramps=N: 0 to 8' : set(d, 'ramps', n, w);
    },
    check: (c, v) => count(rampCount(c), Number(v), 'ramps'),
  },
  {
    name: 'pond', help: 'a fish pond in a park (ponds=N: N of them, 0 none)',
    apply: (d, _v, _m, w) => set(d, 'ponds', 1, w),
    check: (c) => count(pieceCount(c, 'pond'), 1, 'ponds'),
  },
  {
    name: 'ponds', value: 'N', help: 'N parks with a fish pond',
    apply: (d, v, mode, w) => {
      const n = int(v, 0, 6, mode);
      return n === undefined ? 'ponds=N: 0 to 6' : set(d, 'ponds', n, w);
    },
    check: (c, v) => count(pieceCount(c, 'pond'), Number(v), 'ponds'),
  },
  {
    name: 'pitch', help: 'a soccer pitch in a park (pitches=N: N of them, 0 none)',
    apply: (d, _v, _m, w) => set(d, 'pitches', 1, w),
    check: (c) => count(pieceCount(c, 'pitch'), 1, 'pitches'),
  },
  {
    name: 'pitches', value: 'N', help: 'N parks with a soccer pitch',
    apply: (d, v, mode, w) => {
      const n = int(v, 0, 6, mode);
      return n === undefined ? 'pitches=N: 0 to 6' : set(d, 'pitches', n, w);
    },
    check: (c, v) => count(pieceCount(c, 'pitch'), Number(v), 'pitches'),
  },
  {
    name: 'canalwidth', value: 'W', help: 'every canal W metres wide (and at least one canal)',
    apply: (d, v, mode, w) => {
      const n = int(v, 4, 200, mode);
      return n === undefined ? 'canalwidth=W: 4 to 200 metres' : setTerrain(d, 'canalWidth', n, w);
    },
    check: (c, v) => (!c.terrain.canals.length ? 'no canal' : c.terrain.canals.every((cn) => cn.half * 2 === Number(v)) ? undefined : 'a canal of another width'),
  },
  {
    name: 'startminute', value: 'M', help: 'the minutes past the hour the run starts at',
    apply: (d, v, mode, w) => {
      const n = int(v, 0, 59, mode);
      return n === undefined ? 'startminute=M: 0 to 59' : set(d, 'startMinute', n, w);
    },
  },
  {
    name: 'theme', value: ALL_THEMES.map((t) => t.name).join('|'), help: 'the building style',
    apply: (d, v, _m, w) => (ALL_THEMES.some((t) => t.name === v) ? set(d, 'theme', v, w) : `theme=${v}: ${ALL_THEMES.map((t) => t.name).join(' | ')}`),
  },
  ...TIME_NAMES.map(TIME_WORD),
  ...WEATHER_NAMES.map(WEATHER_WORD),
  ...(['temperate', 'beach', 'desert'] as ClimateName[]).map(CLIMATE_WORD),
  ...featureWords(),
];

const BY_NAME = new Map(WORDS.map((w) => [w.name.toLowerCase(), w]));

/** Words → overrides, the checks that they came true, and what's wrong with them. */
export function parseWords(words: string[], mode: Mode = 'make'): { overrides: Partial<CityParams>; checks: ((city: CityData) => string | undefined)[]; errors: string[] } {
  const d: Draft = { o: {}, exact: new Map(), force: {}, owners: new Map() };
  const checks: ((city: CityData) => string | undefined)[] = [];
  const errors: string[] = [];
  for (const raw of words) {
    const neg = raw.startsWith('!');
    const body = neg ? raw.slice(1) : raw;
    const eq = body.indexOf('=');
    const name = eq < 0 ? body : body.slice(0, eq);
    let v = eq < 0 ? undefined : body.slice(eq + 1);
    const w = BY_NAME.get(name.toLowerCase());
    if (!w) {
      errors.push(`"${raw}": no such word`);
      continue;
    }
    if (neg) {
      if (v !== undefined || !w.negatable) {
        errors.push(`"${raw}": only a district feature that is on or off takes "!"`);
        continue;
      }
      v = '0';
    }
    const err = w.apply(d, v, mode, raw);
    if (err) errors.push(err);
    else if (w.check) checks.push((city) => {
      const why = w.check!(city, v);
      return why === undefined ? undefined : `${raw}: ${why}`;
    });
  }
  if (d.exact.size) {
    for (const [kind, on] of Object.entries(d.force) as [DistrictKind, boolean][]) {
      if (on && !d.exact.has(kind)) d.exact.set(kind, { kind });
      if (!on && d.exact.has(kind)) errors.push(`${kind}=0 conflicts with naming ${kind}`);
    }
    d.o.districts = [...d.exact.values()];
  } else if (Object.keys(d.force).length) d.o.force = d.force;
  return { overrides: d.o, checks, errors };
}

/**
 * Words → params with every word come true: from `seed` (1 by default), trying the next seeds in
 * order when a word depends on the layout and the seed's doesn't have it. The params are a file's
 * (versioned; serializeCityParams writes them). Throws with the reasons
 * when the words are wrong or no seed in `tries` has them all.
 */
export function makeCity(words: string[], opts: { seed?: number; tries?: number; config?: CityConfig } = {}): { params: CityParams; city: CityData } {
  const { overrides, checks, errors } = parseWords(words, 'make');
  if (errors.length) throw new Error(`city words: ${errors.join('; ')}`);
  const from = opts.seed ?? 1;
  const tries = opts.tries ?? 100;
  let last: string[] = [];
  for (let t = 0; t < tries; t++) {
    const params: CityParams = { version: PARAMS_VERSION, seed: from + t, ...overrides };
    let city: CityData;
    try {
      city = generateCity(params, opts.config);
    } catch (e) {
      if (!(e instanceof CityParamsError)) throw e;
      last = e.reasons;
      continue;
    }
    const unmet = checks.flatMap((c) => c(city) ?? []);
    if (!unmet.length) return { params, city };
    last = unmet;
  }
  throw new Error(`can't make "${words.join(' ')}" in ${tries} seeds from ${from}: ${last.join('; ')}`);
}

export const makeCityParams = (words: string[], opts: { seed?: number; tries?: number } = {}): CityParams => makeCity(words, opts).params;

/**
 * The URL's city flags as overrides, through the same words: ?time, ?blocks, ?roadworks, ?canalramp,
 * ?england and ?<district>=0|1 for anyone; ?city, ?weather, ?canals and ?hill only with ?debug. A
 * value a word refuses is ignored (the seed rolls it), as the URL always has.
 */
export function urlOverrides(search: string | URLSearchParams, debug: boolean): Partial<CityParams> {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const d: Draft = { o: {}, exact: new Map(), force: {}, owners: new Map() };
  for (const w of WORDS) {
    if (!w.url || (w.debug && !debug)) continue;
    if (w.url === 'flag') {
      if (q.has(w.name)) w.apply(d, undefined, 'url', w.name);
    } else {
      const v = q.get(w.name);
      if (v !== null) w.apply(d, v, 'url', w.name);
    }
  }
  if (Object.keys(d.force).length) d.o.force = d.force;
  return d.o;
}
