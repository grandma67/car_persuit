// City params as a JSON file: parse (versioned, unknown keys are errors), serialize (stable key
// order, short things on one line, a zone row per line) and validate (every rule: the file's
// shape here, then the build's own checks, which name the field). Never silently fixed.
import { CITY_KEYS, CityParamsError, PARAMS_VERSION, rollCityParams, type CityParams } from './CityParams';
import { generateCity, type CityData } from './CityGenerator';
import { ALL_THEMES, TIME_NAMES } from './CityTheme';
import { CLIMATES, WEATHER_NAMES } from './Climate';
import { DISTRICT_DEFS } from './districts/index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isIJ = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isInt);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check an object's keys against the allowed ones; returns it (or null) for the field checks. */
function keys(v: unknown, path: string, allowed: readonly string[], errors: string[], required: string[] = []): Obj | null {
  if (!isObj(v)) {
    errors.push(`${path}: not an object`);
    return null;
  }
  for (const k of Object.keys(v)) if (!allowed.includes(k)) errors.push(`${path ? `${path}.` : ''}${k}: unknown key`);
  for (const k of required) if (!(k in v)) errors.push(`${path ? `${path}.` : ''}${k}: missing`);
  return v;
}

const oneOf = (v: unknown, names: readonly string[], path: string, errors: string[]) => {
  if (v !== undefined && !names.includes(v as string)) errors.push(`${path}: ${JSON.stringify(v)} is not ${names.join(' | ')}`);
};

/** A params file's text (or parsed JSON) → params, or the list of what's wrong with its shape. */
export function parseCityParams(input: string | unknown): { params: CityParams | null; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { params: null, errors: [`not JSON: ${(e as Error).message}`] };
    }
  }
  const o = keys(raw, '', CITY_KEYS, errors, ['version', 'seed']);
  if (!o) return { params: null, errors: ['not a params object'] };
  if (o.version !== undefined && o.version !== PARAMS_VERSION) errors.push(`version: ${JSON.stringify(o.version)} (this game reads version ${PARAMS_VERSION})`);
  if (o.seed !== undefined && !isInt(o.seed)) errors.push('seed: not a whole number');
  if (o.note !== undefined && typeof o.note !== 'string') errors.push('note: not a string');
  oneOf(o.climate, Object.keys(CLIMATES), 'climate', errors);
  oneOf(o.weather, WEATHER_NAMES, 'weather', errors);
  oneOf(o.time, TIME_NAMES, 'time', errors);
  oneOf(o.theme, ALL_THEMES.map((t) => t.name), 'theme', errors);
  oneOf(o.driveSide, ['right', 'left'], 'driveSide', errors);
  if (o.startMinute !== undefined && !(isInt(o.startMinute) && o.startMinute >= 0 && o.startMinute < 60)) errors.push('startMinute: not 0 to 59');
  if (o.blocks !== undefined && !isInt(o.blocks)) errors.push('blocks: not a whole number');
  if (o.ramps !== undefined && !(isInt(o.ramps) && o.ramps >= 0)) errors.push('ramps: not a count');
  if (o.terrain !== undefined) {
    const t = keys(o.terrain, 'terrain', ['hill', 'canals', 'canalWidth'], errors);
    if (t) {
      if (t.hill !== undefined && t.hill !== null && typeof t.hill !== 'boolean') {
        const h = keys(t.hill, 'terrain.hill', ['x', 'z', 'height', 'rx', 'rz', 'yaw'], errors, ['x', 'z', 'height', 'rx', 'rz', 'yaw']);
        if (h) for (const k of ['x', 'z', 'height', 'rx', 'rz', 'yaw']) if (k in h && !isNum(h[k])) errors.push(`terrain.hill.${k}: not a number`);
      }
      if (Array.isArray(t.canals)) {
        t.canals.forEach((c, k) => {
          const cn = keys(c, `terrain.canals[${k}]`, ['axis', 'line', 'width', 'bridges'], errors, ['axis', 'line']);
          if (!cn) return;
          oneOf(cn.axis, ['x', 'z'], `terrain.canals[${k}].axis`, errors);
          if (!isInt(cn.line)) errors.push(`terrain.canals[${k}].line: not a road line`);
          if (cn.width !== undefined && !isNum(cn.width)) errors.push(`terrain.canals[${k}].width: not a number`);
          if (cn.bridges !== undefined && !(Array.isArray(cn.bridges) && cn.bridges.every(isInt))) errors.push(`terrain.canals[${k}].bridges: not a list of road lines`);
        });
      } else if (t.canals !== undefined && !isInt(t.canals)) errors.push('terrain.canals: not a count or a list');
      if (t.canalWidth !== undefined && !isNum(t.canalWidth)) errors.push('terrain.canalWidth: not a number');
    }
  }
  const strings = (v: unknown, path: string) => {
    if (v !== undefined && !(Array.isArray(v) && v.every((s) => typeof s === 'string'))) errors.push(`${path}: not a list of strings`);
  };
  strings(o.plazas, 'plazas');
  strings(o.zones, 'zones');
  const list = (v: unknown, path: string, item: (x: unknown, p: string) => void, extra: readonly unknown[] = []) => {
    if (v === undefined || extra.includes(v) || (extra.includes('count') && isInt(v))) return;
    if (!Array.isArray(v)) errors.push(`${path}: not a list${extra.length ? ` (or ${extra.map(String).join(', ')})` : ''}`);
    else v.forEach((x, k) => item(x, `${path}[${k}]`));
  };
  list(o.landmarks, 'landmarks', (x, p) => {
    const l = keys(x, p, ['kind', 'block', 'edge', 'dir'], errors, ['kind']);
    if (!l) return;
    if (l.block !== undefined && !isIJ(l.block)) errors.push(`${p}.block: not [i, j]`);
    if (l.edge !== undefined && typeof l.edge !== 'string') errors.push(`${p}.edge: not an edge key`);
    if (l.dir !== undefined && l.dir !== 1 && l.dir !== -1) errors.push(`${p}.dir: not 1 or -1`);
  });
  list(o.canalRamps, 'canalRamps', (x, p) => {
    const c = keys(x, p, ['edge', 'dir'], errors, ['edge', 'dir']);
    if (c && c.dir !== 1 && c.dir !== -1) errors.push(`${p}.dir: not 1 or -1`);
  }, ['all', 'count']);
  list(o.roadworks, 'roadworks', (x, p) => {
    const w = keys(x, p, ['node', 'edge', 'stream'], errors);
    if (!w) return;
    if ((w.node === undefined) === (w.edge === undefined)) errors.push(`${p}: a node or an edge`);
    if (w.node !== undefined && !isIJ(w.node)) errors.push(`${p}.node: not [i, j]`);
    if (w.stream !== undefined && !isInt(w.stream)) errors.push(`${p}.stream: not a stream state`);
  }, ['all', 'count']);
  if (o.spawn !== undefined) {
    const s = keys(o.spawn, 'spawn', ['node', 'toward'], errors, ['node', 'toward']);
    if (s && !(isIJ(s.node) && isIJ(s.toward))) errors.push('spawn: node and toward are [i, j]');
  }
  list(o.destinations, 'destinations', (x, p) => {
    if (!isIJ(x)) errors.push(`${p}: not [i, j]`);
  });
  const kinds = DISTRICT_DEFS.map((d) => d.kind);
  list(o.districts, 'districts', (x, p) => {
    const d = keys(x, p, ['kind', 'rect', 'roles', 'features'], errors, ['kind']);
    if (!d) return;
    oneOf(d.kind, kinds, `${p}.kind`, errors);
    if (d.rect !== undefined) {
      const r = keys(d.rect, `${p}.rect`, ['i', 'j', 'w', 'h'], errors, ['i', 'j', 'w', 'h']);
      if (r && !['i', 'j', 'w', 'h'].every((k) => isInt(r[k]))) errors.push(`${p}.rect: i, j, w, h are whole numbers`);
    }
    if (d.roles !== undefined && !isObj(d.roles)) errors.push(`${p}.roles: not an object`);
    if (d.features !== undefined && !isObj(d.features)) errors.push(`${p}.features: not an object`);
  });
  if (o.force !== undefined) {
    const f = keys(o.force, 'force', kinds, errors);
    if (f) for (const [k, v] of Object.entries(f)) if (typeof v !== 'boolean') errors.push(`force.${k}: not true or false`);
  }
  return errors.length ? { params: null, errors } : { params: o as unknown as CityParams, errors };
}

/** Stable key order, a key per line, short arrays and objects under them on one line, the rest indented. */
export function serializeCityParams(params: CityParams): string {
  const ordered: Obj = {};
  for (const k of CITY_KEYS) if ((params as unknown as Obj)[k] !== undefined) ordered[k] = (params as unknown as Obj)[k];
  const out = (v: unknown, indent: string, top = false): string => {
    const flat = JSON.stringify(v);
    if (flat === undefined) return 'null';
    if (typeof v !== 'object' || v === null || (!top && flat.length + indent.length <= 100)) return flat;
    const inner = indent + '  ';
    if (Array.isArray(v)) return `[\n${v.map((x) => inner + out(x, inner)).join(',\n')}\n${indent}]`;
    const entries = Object.entries(v as Obj).filter(([, x]) => x !== undefined);
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${out(x, inner)}`).join(',\n')}\n${indent}}`;
  };
  return out(ordered, '', true) + '\n';
}

/**
 * Every rule, in one place: what the build can't make is an error (naming the field), what it
 * makes but won't show (a night-only feature by day) or looks off (a style the climate never rolls,
 * snowfall outside the snow) is a warning. Returns the city when it builds.
 */
export function validateCityParams(params: CityParams): { errors: string[]; warnings: string[]; city: CityData | null } {
  const warnings: string[] = [];
  const p = rollCityParams(params.seed, params);
  const climate = CLIMATES[p.climate!];
  if (params.theme !== undefined && climate && !climate.styles.includes(params.theme)) {
    warnings.push(`theme: "${params.theme}" is not a style the ${p.climate} climate rolls (it has ${climate.styles.join(', ')})`);
  }
  if (params.weather !== undefined && p.weather !== params.weather) warnings.push(`weather: ${params.weather} becomes ${p.weather} in the ${p.climate} climate`);
  for (const [k, d] of (params.districts ?? []).entries()) {
    const night = DISTRICT_DEFS.find((def) => def.kind === d.kind)?.nightFeatures ?? [];
    for (const f of night) {
      if (d.features?.[f] === true && p.time !== 'night') warnings.push(`districts[${k}] (${d.kind}).features.${f}: only shows on a night run (time is ${p.time})`);
    }
  }
  try {
    const city = generateCity(params);
    return { errors: [], warnings: [...warnings, ...city.warnings], city };
  } catch (e) {
    if (e instanceof CityParamsError) return { errors: e.reasons, warnings, city: null };
    throw e;
  }
}
