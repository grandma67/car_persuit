// Test helpers for city params: the city as comparable JSON, the vocabulary suite (every word gives
// a city that has it, for 10 base seeds; 2 for direct pins) and the dump round trip (20 seeds ×
// defaults and every district forced), each split over a few files so they run in parallel.
import { describe, expect, it } from 'vitest';
import { generateCity, type CityData } from './CityGenerator';
import { TIME_NAMES } from './CityTheme';
import { CLIMATES, WEATHER_NAMES } from './Climate';
import { parseCityParams, serializeCityParams } from './CityParamsFile';
import { DISTRICT_DEFS } from './districts/index';
import type { District, DistrictKind } from './districts/District';
import { makeCity, urlOverrides, WORDS, type Word } from './makeCityParams';

/**
 * The city as JSON (Maps, Sets as arrays; the graph as its nodes; what describes the city rather than
 * being it left out). The config's roll knobs are left out too: the URL used to edit them
 * (?roadworks: roadworksChance 1), it now pins the choice, and nothing after generation reads them.
 */
const KNOBS = ['roadworksChance', 'canalRampChance', 'leftHandChance', 'canalOdds', 'hillChance'];
export const cityJson = (city: CityData) =>
  JSON.stringify(city, (key, value) => {
    if (key === 'params' || key === 'warnings' || key === 'features' || key === 'pins') return undefined;
    if (key === 'config') return Object.fromEntries(Object.entries(value).filter(([k]) => !KNOBS.includes(k)));
    if (value instanceof Map || value instanceof Set) return [...value];
    if (key === 'graph') return value.nodes;
    return value;
  });

/**
 * A district's cities with `words` pinned (its kind added: it alone, unless the words name others),
 * one per start seed: [the seed makeCity used, the city, the district]. For a feature test, on and off:
 * `districtCities('farm', ['maze'])`, `districtCities('farm', ['!maze'])`.
 */
export function districtCities(kind: DistrictKind, words: string[], seeds = [11, 7930]): [number, CityData, District][] {
  return seeds.map((seed) => {
    const { params, city } = makeCity([kind, ...words], { seed });
    return [params.seed, city, city.districts.find((d) => d.kind === kind)!];
  });
}

/** Values for the words that take a number. */
const NUMBERS: Record<string, string[]> = {
  roadworks: ['0', '2'], blocks: ['6'], canalramps: ['1'], ramps: ['0', '2'], canalwidth: ['30'], startminute: ['7'], yards: ['1'], ponds: ['0', '2'], pitches: ['0', '2'],
};

/** Each word as it is used: bare, !name for an on/off feature, each named value, a sample count. */
export function samples(w: Word): string[] {
  const base = w.name.split('.').pop()!;
  if (w.value === undefined) return w.negatable ? [w.name, `!${w.name}`] : [w.name];
  if (w.value.includes('|')) {
    const named = w.value.split('|').map((v) => `${w.name}=${v}`);
    return w.url === 'value' && DISTRICT_DEFS.some((d) => d.kind === w.name) ? [w.name, ...named] : named;
  }
  const nums = NUMBERS[base];
  if (!nums) throw new Error(`no sample values for "${w.name}=${w.value}": add them to NUMBERS`);
  return [...(w.url === 'flag' ? [w.name] : []), ...nums.map((v) => `${w.name}=${v}`)];
}

const isFeature = (name: string) => {
  const [kind, f] = name.includes('.') ? name.split('.') : [undefined, name];
  return DISTRICT_DEFS.some((d) => (kind === undefined || d.kind === kind) && f in d.features);
};

/** What each word promises, asserted on the built city independently of the word's own check. */
function promise(word: string, city: CityData): void {
  const neg = word.startsWith('!');
  const [name, v] = (neg ? word.slice(1) : word).split('=');
  const p = city.params;
  const def = DISTRICT_DEFS.find((d) => d.kind === name);
  if (name === 'flat') expect([city.terrain.hill, city.terrain.canals.length]).toEqual([null, 0]);
  else if (def && v === undefined) expect(city.districts.map((q) => q.kind)).toEqual([name]);
  else if (def) expect(city.districts.some((q) => q.kind === name)).toBe(v === '1');
  else if (name === 'startminute') expect(p.startMinute).toBe(Number(v));
  else if (name === 'theme') expect(p.theme).toBe(v);
  else if (name === 'england') expect(city.driveSide).toBe('left');
  else if (name === 'canals') expect(city.terrain.canals.length).toBe(Number(v));
  else if (name === 'blocks') expect(city.blocks.length).toBe(Number(v) ** 2);
  else if (name === 'pond' || name === 'ponds') expect(city.water.length).toBe(v === undefined ? 1 : Number(v));
  else if (name === 'pitch' || name === 'pitches') expect(city.streetProps.filter((q) => q.kind === 'goal').length).toBe(2 * (v === undefined ? 1 : Number(v)));
  else if (isFeature(name)) {
    const [kind, f] = name.includes('.') ? name.split('.') : [DISTRICT_DEFS.find((d) => name in d.features)!.kind, name];
    const q = city.districts.find((x) => x.kind === kind);
    expect(q, `${kind} placed`).toBeDefined();
    expect(q!.features[f]).toBe(neg ? false : v === undefined ? true : /^\d+$/.test(v) ? Number(v) : v);
  }
}

export const BASE_SEEDS = Array.from({ length: 10 }, (_, k) => k * 7919 + 11);
export const ALL_SAMPLES = WORDS.flatMap(samples);

/**
 * Words that pin a field outright can't miss on any seed, nor can a feature's district.name alias of
 * a bare word: two base seeds do for them (the suite's time), the ten for what depends on the layout.
 */
const DIRECT = new Set(['england', 'time', 'blocks', 'city', 'weather', 'canals', 'hill', 'flat', 'startminute', 'theme', ...TIME_NAMES, ...WEATHER_NAMES, ...Object.keys(CLIMATES)]);
const seedsFor = (word: string) => {
  const name = word.replace(/^!/, '').split('=')[0];
  const alias = name.includes('.') && WORDS.some((w) => w.name === name.split('.')[1]);
  return DIRECT.has(name) || alias ? BASE_SEEDS.slice(0, 2) : BASE_SEEDS;
};

/** Part `part` (0-based) of `parts` of the vocabulary: each sample word, from each base seed. */
export function wordSuite(part: number, parts: number): void {
  const mine = ALL_SAMPLES.filter((_, k) => k % parts === part);
  describe(`city words (part ${part + 1} of ${parts})`, () => {
    it.each(mine)('%s comes true from the base seeds and reloads from its file', (word) => {
      seedsFor(word).forEach((seed, k) => {
        const { params, city } = makeCity([word], { seed });
        promise(word, city);
        if (k > 0) return;
        // the words' params, written and read back, build the same city
        const back = parseCityParams(serializeCityParams(params));
        expect(back.errors).toEqual([]);
        expect(cityJson(generateCity(back.params!))).toBe(cityJson(city));
      });
    });
  });
}

/** The dump written and read back builds the same city, and dumps the same file again. */
function reloads(city: CityData) {
  const file = serializeCityParams(city.params);
  const { params, errors } = parseCityParams(file);
  expect(errors).toEqual([]);
  const back = generateCity(params!);
  expect(back.warnings).toEqual([]);
  expect(cityJson(back)).toBe(cityJson(city));
  expect(serializeCityParams(back.params)).toBe(file); // the look and the destinations too
}

/**
 * Part `part` of `parts` of "a dump reloads as the identical city": 20 of the hash's 60 seeds (all 60:
 * `npm run hash -- --reload`, at each milestone); the last part also takes the URL flags.
 */
export function roundTripSuite(part: number, parts: number): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i * 3 * 7919 + 11).filter((_, k) => k % parts === part);
  const all = Object.fromEntries(DISTRICT_DEFS.map((d) => [d.kind, true]));
  describe(`a dump reloads as the identical city (part ${part + 1} of ${parts})`, () => {
    it.each(seeds)('seed %i, with the defaults and with every district forced', (seed) => {
      reloads(generateCity(seed));
      reloads(generateCity(seed, undefined, { force: all }));
    });
    if (part !== parts - 1) return;
    // the flags that pin a variable number of draws (roadworks sites lay out from their stream)
    const flags = ['roadworks', 'canalramp', 'debug&canals=2&canalramp&roadworks', 'england&time=night&blocks=10&chinatown=1&farm=1'];
    it.each(flags)('?%s, 10 seeds', (search) => {
      for (const seed of BASE_SEEDS) reloads(generateCity({ seed, ...urlOverrides(search, search.includes('debug')) }));
    });
  });
}
