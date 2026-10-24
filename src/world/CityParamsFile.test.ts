import { describe, expect, it } from 'vitest';
import type { CityParams } from './CityParams';
import { generateCity } from './CityGenerator';
import { parseCityParams, serializeCityParams, validateCityParams } from './CityParamsFile';
import { makeCity, parseWords } from './makeCityParams';

const parseErrors = (json: unknown) => parseCityParams(typeof json === 'string' ? json : JSON.stringify(json)).errors;
const file = (o: object) => ({ version: 1, seed: 3, ...o });

describe('parseCityParams', () => {
  it('reads a short hand-made file', () => {
    const { params, errors } = parseCityParams('{"version": 1, "seed": 9, "time": "night", "districts": [{"kind": "chinatown", "features": {"festival": true}}]}');
    expect(errors).toEqual([]);
    expect(params).toEqual({ version: 1, seed: 9, time: 'night', districts: [{ kind: 'chinatown', features: { festival: true } }] });
  });

  it.each([
    ['{"seed": 1', /^not JSON/],
    [[1, 2], /not a params object/],
    [{ seed: 1 }, /^version: missing/],
    [{ version: 1 }, /^seed: missing/],
    [{ version: 2, seed: 1 }, /^version: 2 \(this game reads version 1\)/],
    [file({ seeds: 1 }), /^seeds: unknown key/],
    [file({ terrain: { hill: { x: 0 } } }), /^terrain\.hill\.z: missing/],
    [file({ terrain: { canals: [{ axis: 'y', line: 3 }] } }), /^terrain\.canals\[0\]\.axis: "y" is not x \| z/],
    [file({ terrain: { canals: [{ axis: 'x', line: 3, depth: 2 }] } }), /^terrain\.canals\[0\]\.depth: unknown key/],
    [file({ time: 'dusk' }), /^time: "dusk" is not day \| afternoon \| night/],
    [file({ startMinute: 60 }), /^startMinute: not 0 to 59/],
    [file({ roadworks: 'some' }), /^roadworks: not a list \(or all, count\)/],
    [file({ roadworks: [{ node: [1, 2], edge: 'h1,2' }] }), /^roadworks\[0\]: a node or an edge/],
    [file({ spawn: { node: [1, 2] } }), /^spawn\.toward: missing/],
    [file({ destinations: [[1, 2, 3]] }), /^destinations\[0\]: not \[i, j\]/],
    [file({ districts: [{ kind: 'suburbs' }] }), /^districts\[0\]\.kind: "suburbs" is not oldtown/],
    [file({ districts: [{ kind: 'farm', rect: { i: 1, j: 1, w: 2 } }] }), /^districts\[0\]\.rect\.h: missing/],
    [file({ force: { farm: 1 } }), /^force\.farm: not true or false/],
  ])('%j: %s', (json, why) => {
    const errors = parseErrors(json);
    expect(errors.some((e) => why.test(e)), errors.join('\n')).toBe(true);
  });
});

describe('serializeCityParams', () => {
  it('writes the keys in file order, short things on one line', () => {
    const text = serializeCityParams({ districts: [], time: 'night', seed: 9, version: 1, terrain: { hill: null, canals: [] } } as CityParams);
    expect(text).toBe('{\n  "version": 1,\n  "seed": 9,\n  "time": "night",\n  "terrain": {"hill":null,"canals":[]},\n  "districts": []\n}\n');
    expect(serializeCityParams(generateCity(11).params).split('\n').every((l) => l.length <= 100)).toBe(true);
  });
});

describe('validateCityParams', () => {
  const at = (o: object) => validateCityParams(file({ blocks: 10, ...o }) as CityParams);

  it.each([
    [{ blocks: 40 }, /^blocks: 40 is not a grid size from 4 to 30/],
    [{ terrain: { canals: [{ axis: 'x', line: 1 }] } }, /^terrain\.canals\[0\]\.line: 1 is not an inner road line \(2 to 8/],
    [{ terrain: { canals: [{ axis: 'x', line: 5, bridges: [] }] } }, /^terrain\.canals\[0\]\.bridges: no bridge on lines .* \(the island would split\)/],
    [{ terrain: { canals: [{ axis: 'x', line: 5, bridges: [3, 7, 40] }] } }, /^terrain\.canals\[0\]\.bridges: 40 is not a road line crossing the canal/],
    [{ plazas: ['h0,0'] }, /^plazas: h0,0 is on the ring road/],
    [{ plazas: ['h40,2'] }, /^plazas: h40,2 is not a street of a 10-block grid/],
    [{ spawn: { node: [5, 5], toward: [7, 5] } }, /^spawn\.toward: 7,5 is not a junction one road on from 5,5/],
    [{ roadworks: [{ node: [0, 0] }] }, /^roadworks\[0\]: can't close it/],
    [{ districts: [{ kind: 'farm' }, { kind: 'farm' }] }, /^districts\[1\]: farm twice/],
    [{ districts: [{ kind: 'farm', rect: { i: 8, j: 8, w: 3, h: 3 } }] }, /^districts\[0\] \(farm\)\.rect: not inside the 10×10 grid|^districts\[0\]\.rect: not inside/],
    [{ districts: [{ kind: 'farm', features: { festival: true } }] }, /features\.festival: no such feature/],
    [{ districts: [{ kind: 'harbor', features: { ship: 'liner' } }] }, /features\.ship: "liner" is not container \| bulk \| general/],
  ])('%j: %s', (o, why) => {
    const { errors, city } = at(o);
    expect(city).toBeNull();
    expect(errors.some((e) => why.test(e)), errors.join('\n')).toBe(true);
  });

  it('refuses a destination where the run starts', () => {
    const dump = generateCity({ seed: 3, blocks: 10 }).params;
    const { errors } = validateCityParams({ ...dump, destinations: [dump.spawn!.node] });
    expect(errors).toEqual([`destinations[0]: ${dump.spawn!.node} is where the run starts`]);
  });

  it('warns about what builds but will not show or looks off', () => {
    const { errors, warnings } = at({ time: 'day', climate: 'desert', weather: 'snow', theme: 'Nordic', districts: [{ kind: 'farm', features: { harvest: true } }] });
    expect(errors).toEqual([]);
    expect(warnings.join('\n')).toMatch(/theme: "Nordic" is not a style the desert climate rolls/);
    expect(warnings.join('\n')).toMatch(/weather: snow becomes \w+ in the desert climate/);
    expect(warnings.join('\n')).toMatch(/districts\[0\] \(farm\)\.features\.harvest: only shows on a night run \(time is day\)/);
  });

  it('passes every dump without a word', () => {
    expect(validateCityParams(generateCity(7930).params)).toMatchObject({ errors: [], warnings: [] });
  });
});

describe('the words refuse what they cannot mean', () => {
  it.each([
    [['flatt'], /"flatt": no such word/],
    [['night', 'day'], /"day" conflicts with "night"/],
    [['time=dusk'], /time=dusk: day \| afternoon \| night/],
    [['!flat'], /"!flat": only a district feature that is on or off takes "!"/],
    [['harbor', 'harbor=0'], /harbor=0 conflicts with naming harbor/],
    [['festival', '!festival'], /"!festival" conflicts with an earlier festival/],
    [['ship=liner'], /"ship=liner": container \| bulk \| general/],
    [['blocks=3'], /blocks=N: 4 to 30/],
  ])('%j', (words, why) => {
    expect(parseWords(words).errors.join('; ')).toMatch(why);
    expect(() => makeCity(words)).toThrow(why);
  });

  it('fails, naming the word, when no seed in range has it', () => {
    expect(() => makeCity(['blocks=4', 'farm'], { seed: 1, tries: 3 })).toThrow(/can't make "blocks=4 farm" in 3 seeds from 1: districts\[0\] \(farm\): no room/);
  });

  it('moves to a later seed only when it must, and says which', () => {
    expect(makeCity(['night'], { seed: 42 }).params.seed).toBe(42);
    const { params, city } = makeCity(['harbor', 'tug'], { seed: 42 });
    expect(params.seed).toBeGreaterThanOrEqual(42);
    expect(city.districts.find((q) => q.kind === 'harbor')!.features.tug).toBe(true);
  });
});
