import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { pickDestinations } from '../gameplay/MissionSystem';
import { cityDestinations, DEFAULT_CITY, generateCity, rollCityBlocks, type CityConfig, type CityData } from './CityGenerator';
import { urlOverrides } from './CityParams';
import { pickTheme, pickTimeOfDay, startHour, startHourAt } from './CityTheme';
import { CLIMATES, pickClimate, pickWeather } from './Climate';
import { districtOfNode } from './districts/runtime';
import { DISTRICT_DEFS } from './districts/index';

const KINDS = DISTRICT_DEFS.map((d) => d.kind);

/**
 * The city as JSON (Maps, Sets as arrays; the graph as its nodes; the params left out). The config's
 * roll knobs are left out too: the URL used to edit them (?roadworks: roadworksChance 1), it now pins
 * the choice, and nothing after generation reads them.
 */
const KNOBS = ['roadworksChance', 'canalRampChance', 'leftHandChance', 'canalOdds', 'hillChance'];
const json = (city: CityData) =>
  JSON.stringify(city, (key, value) => {
    if (key === 'params' || key === 'warnings' || key === 'features' || key === 'pins') return undefined;
    if (key === 'config') return Object.fromEntries(Object.entries(value).filter(([k]) => !KNOBS.includes(k)));
    if (value instanceof Map || value instanceof Set) return [...value];
    if (key === 'graph') return value.nodes;
    return value;
  });

/** What Game did before the params: config edits from the URL, then generateCity and the look pickers. */
function before(seed: number, search: string) {
  const params = new URLSearchParams(search);
  const debug = params.has('debug');
  const climate = pickClimate(seed, debug ? params.get('city') : null);
  const weather = pickWeather(seed, climate, debug ? params.get('weather') : null);
  const time = pickTimeOfDay(seed, params.get('time')).name;
  const config: CityConfig = { ...DEFAULT_CITY };
  const blocks = Number.parseInt(params.get('blocks') ?? '', 10);
  config.blocks = blocks >= 4 && blocks <= 30 ? blocks : rollCityBlocks(seed, config);
  if (params.has('roadworks')) config.roadworksChance = 1;
  if (params.has('canalramp')) config.canalRampChance = 1;
  if (params.has('england')) config.leftHandChance = 1;
  const canals = Number.parseInt(params.get('canals') ?? '', 10);
  if (debug && canals >= 0 && canals <= 2) config.canalOdds = [canals === 0 ? 1 : 0, canals === 1 ? 1 : 0, canals === 2 ? 1 : 0];
  if (debug && params.has('hill')) config.hillChance = params.get('hill') === '0' ? 0 : 1;
  const force = Object.fromEntries(KINDS.filter((k) => params.get(k) === '0' || params.get(k) === '1').map((k) => [k, params.get(k) === '1']));
  const city = generateCity(seed, config, { force });
  const start = city.graph.nearest(city.spawn.x, city.spawn.z);
  const dest = pickDestinations(city.graph, new Rng(seed ^ 0xde57), start.id, undefined, (id) => districtOfNode(city, id)).map((n) => n.id);
  return { city: json(city), climate: climate.name, weather, time, theme: pickTheme(seed, climate), hour: startHour(seed, time), dest };
}

function after(seed: number, search: string) {
  const debug = new URLSearchParams(search).has('debug');
  const city = generateCity({ seed, ...urlOverrides(search, debug, KINDS) });
  const p = city.params;
  return {
    city: json(city), climate: p.climate, weather: p.weather, time: p.time, theme: pickTheme(seed, CLIMATES[p.climate!], p.theme),
    hour: startHourAt(p.time!, p.startMinute!), dest: cityDestinations(city).map((n) => n.id),
  };
}

describe('URL flags → city params', () => {
  const flags = [
    '', 'time=night', 'time=afternoon', 'time=bogus', 'blocks=6', 'blocks=40', 'roadworks', 'canalramp', 'england',
    'oldtown=1', 'chinatown=1&harbor=0', 'farm=1&slums=1', 'canals=2', 'hill=0',
    'debug&city=snow', 'debug&city=desert&weather=snow', 'debug&weather=rain', 'debug&city=snow&weather=rain',
    'debug&canals=0', 'debug&canals=1', 'debug&canals=2', 'debug&hill=0', 'debug&hill=1', 'debug&hill',
    'debug&canals=2&canalramp&roadworks&england&blocks=10&time=night&chinatown=1&oldtown=0',
  ];
  it.each(flags)('?%s builds what the game built before', (search) => {
    for (const seed of [9, 11, 7930]) expect(after(seed, search)).toEqual(before(seed, search));
  });

  it('ignores the debug-only flags without ?debug', () => {
    expect(urlOverrides('city=snow&weather=rain&canals=2&hill=0', false, KINDS)).toEqual({});
    expect(urlOverrides('debug&city=snow&weather=rain&canals=2&hill=0', true, KINDS)).toEqual({
      climate: 'snow', weather: 'rain', terrain: { canals: 2, hill: false },
    });
  });
});
