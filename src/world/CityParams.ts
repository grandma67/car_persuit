// A city's choices as plain data: every roll that shapes it (climate to district features), with
// grid positions rather than metres. Partial params pin some choices and leave the rest to the
// seed; generateCity resolves each choice where it builds it (`pin(params.x, roll)`) and returns the
// complete set as `city.params`, which reloads as the identical city. Pure data — no Three.js.
import { Rng } from '../core/Rng';
import { DEFAULT_CITY, type CityConfig } from './CityGenerator';
import { CLIMATES, pickClimate, pickWeather, WEATHER_NAMES, type ClimateName, type WeatherName } from './Climate';
import { pickTheme, pickTimeOfDay, startMinuteOf, TIME_NAMES, type TimeOfDayName } from './CityTheme';
import type { DriveSide } from './driveSide';
import type { BlockRole, DistrictKind } from './districts/District';
import type { LandmarkKind } from './Landmarks';

export const PARAMS_VERSION = 1;

/** A hill in metres (its centre from the island's centre): the one choice not on the grid. */
export interface HillParams {
  x: number;
  z: number;
  height: number;
  rx: number;
  rz: number;
  yaw: number;
}

/** A canal along road line `line`, `width` metres quay to quay, bridged on the crossing lines listed. */
export interface CanalParams {
  axis: 'x' | 'z';
  line: number;
  width?: number;
  bridges?: number[];
}

export interface TerrainParams {
  /** null or false: no hill; true: a hill rolled from the seed. */
  hill?: HillParams | null | boolean;
  /** A count (each canal rolled) or the canals. */
  canals?: CanalParams[] | number;
  /** Every rolled canal this wide (the `canalwidth=` word). */
  canalWidth?: number;
}

/** A centrepiece: town squares and parks by block, street ramps by their paved-over street. */
export interface LandmarkParams {
  kind: LandmarkKind;
  block?: [number, number];
  edge?: string; // street ramps: the edge key ("h4,8"), lip toward its b end (dir 1) or a end (-1)
  dir?: 1 | -1;
}

/** A canal ramp on the quay street `edge`, run-up toward the water (`dir` along the edge). */
export interface CanalRampParams {
  edge: string;
  dir: 1 | -1;
}

/** A roadworks site: a closed junction or a closed road. */
export interface WorksParams {
  node?: [number, number];
  edge?: string;
}

export type FeatureValue = boolean | number | string;

export interface DistrictParams {
  kind: DistrictKind;
  rect?: { i: number; j: number; w: number; h: number };
  roles?: Record<string, BlockRole>; // read-only: "i,j" → role
  features?: Record<string, FeatureValue>;
}

export interface CityParams {
  version?: number;
  seed: number;
  note?: string;
  // --- the run's look ---
  climate?: ClimateName;
  weather?: WeatherName;
  time?: TimeOfDayName;
  startMinute?: number;
  theme?: string;
  // --- layout ---
  blocks?: number;
  driveSide?: DriveSide;
  terrain?: TerrainParams;
  plazas?: string[];
  zones?: string[]; // read-only
  /** Street ramps are pinned (with an edge); the other entries are read-only. */
  landmarks?: LandmarkParams[];
  /** How many ramps (street and square), the rest rolled. */
  ramps?: number;
  /** 'all': every roll comes up (as ?canalramp); a count; or the ramps. */
  canalRamps?: CanalRampParams[] | number | 'all';
  /** 'all': every slot rolls a site (as ?roadworks); a count; or the sites. */
  roadworks?: WorksParams[] | number | 'all';
  spawn?: { node: [number, number]; toward: [number, number] };
  destinations?: [number, number][];
  // --- districts ---
  /** Exactly these districts (the rest of each rolled when left out); [] = none. */
  districts?: DistrictParams[];
  /** URL style: a district's roll forced on (true) or off, the others rolled. */
  force?: Partial<Record<DistrictKind, boolean>>;
}

/** Draw, then override: the roll is always made (so later draws stay put), the pinned value wins. */
export function pin<T>(pinned: T | undefined, rolled: T): T {
  return pinned === undefined ? rolled : pinned;
}

/** A pinned choice that can't be built: the field and why. */
export class CityParamsError extends Error {
  constructor(readonly reasons: string[]) {
    super(`invalid city params:\n  ${reasons.join('\n  ')}`);
  }
}

export const edgeKeyOf = (horizontal: boolean, i: number, j: number) => `${horizontal ? 'h' : 'v'}${i},${j}`;

/** Parse "h3,4" into its parts, or null. */
export function parseEdgeKey(key: string): { horizontal: boolean; i: number; j: number } | null {
  const m = /^([hv])(\d+),(\d+)$/.exec(key);
  return m ? { horizontal: m[1] === 'h', i: Number(m[2]), j: Number(m[3]) } : null;
}

/** Blocks per side for a run, from its own stream so nothing else in the seed moves. */
export function rollCityBlocks(seed: number, range: [number, number]): number {
  return new Rng(seed ^ 0x512e0b).int(...range);
}

/** Rarely the city is English and drives on the left: its own RNG stream, decided by the seed. */
export function rollDriveSide(seed: number, leftHandChance: number): DriveSide {
  return new Rng(seed ^ 0x1e7f5d).next() < leftHandChance ? 'left' : 'right';
}

/**
 * The choices made before the layout: the run's look, grid size and drive side. Overrides win (a
 * pinned weather gets the same climate fix-ups as ?weather); everything else is passed through as
 * pins for generateCity to resolve where it builds them.
 */
export function rollCityParams(seed: number, overrides: Partial<CityParams> = {}, config: CityConfig = DEFAULT_CITY): CityParams {
  const climate = pin(overrides.climate, pickClimate(seed).name);
  return {
    ...overrides,
    seed,
    climate,
    weather: pickWeather(seed, CLIMATES[climate] ?? CLIMATES.temperate, overrides.weather),
    time: pin(overrides.time, pickTimeOfDay(seed).name),
    startMinute: pin(overrides.startMinute, startMinuteOf(seed)),
    theme: pin(overrides.theme, pickTheme(seed, CLIMATES[climate] ?? CLIMATES.temperate).name),
    blocks: pin(overrides.blocks, rollCityBlocks(seed, config.blocksRange)),
    driveSide: pin(overrides.driveSide, rollDriveSide(seed, config.leftHandChance)),
  };
}

/**
 * The URL's city flags as overrides, exactly as the game has always read them: ?time, ?blocks,
 * ?roadworks, ?canalramp, ?england and ?<district>=0|1 for anyone; ?city, ?weather, ?canals and
 * ?hill only with ?debug. Unknown values are ignored (the seed rolls them).
 */
export function urlOverrides(search: string | URLSearchParams, debug: boolean, kinds: readonly DistrictKind[]): Partial<CityParams> {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: Partial<CityParams> = {};
  const time = q.get('time');
  if (time && (TIME_NAMES as string[]).includes(time)) out.time = time as TimeOfDayName;
  const blocks = Number.parseInt(q.get('blocks') ?? '', 10);
  if (blocks >= 4 && blocks <= 30) out.blocks = blocks;
  if (q.has('roadworks')) out.roadworks = 'all';
  if (q.has('canalramp')) out.canalRamps = 'all';
  if (q.has('england')) out.driveSide = 'left';
  if (debug) {
    const city = q.get('city');
    if (city && city in CLIMATES) out.climate = city as ClimateName;
    const weather = q.get('weather');
    if (weather && (WEATHER_NAMES as string[]).includes(weather)) out.weather = weather as WeatherName;
    const canals = Number.parseInt(q.get('canals') ?? '', 10);
    const terrain: TerrainParams = {};
    if (canals >= 0 && canals <= 2) terrain.canals = canals;
    if (q.has('hill')) terrain.hill = q.get('hill') !== '0';
    if (Object.keys(terrain).length) out.terrain = terrain;
  }
  const force = Object.fromEntries(kinds.filter((k) => q.get(k) === '0' || q.get(k) === '1').map((k) => [k, q.get(k) === '1']));
  if (Object.keys(force).length) out.force = force;
  return out;
}
