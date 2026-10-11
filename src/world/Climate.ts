// Seed-chosen climate (temperate / snow / beach / desert) and weather (clear / rain / snowfall).
// The climate decides which building styles fit, what covers the parks, which trees grow and how
// much grip the tyres have; the weather greys out the sky, pulls the fog in and wets the roads.
// Both are overridable from the URL (?city=snow, ?weather=rain) so a shared link keeps them.
import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { TimeOfDay } from './CityTheme';

export type ClimateName = 'temperate' | 'snow' | 'beach' | 'desert';
export type WeatherName = 'clear' | 'rain' | 'snow';
export type TreeKind = 'round' | 'pine' | 'palm' | 'cactus';

export interface Climate {
  name: ClimateName;
  label: string;
  styles: string[]; // CityTheme names that suit this climate
  ground: number | null; // replaces park grass (snow, sand); null keeps the style's grass
  paveTint: { color: number; amount: number } | null; // dusts sidewalks/plazas (snow, sand)
  promenade: number | null; // the seafront strip: sand on the beach
  snowRoofs: boolean;
  trees: { kind: TreeKind; weight: number }[];
  beachProps: boolean; // umbrellas and towels along the promenade
  haze: { color: number; amount: number } | null; // tints the horizon / fog
  sea: number | null; // deep water colour; null keeps the time of day's
  shallow: number; // water colour near the quay
  grip: number; // player tyre grip multiplier
  spray: number; // colour of what the tyres kick up when sliding
  weather: { name: WeatherName; weight: number }[];
}

export const CLIMATES: Record<ClimateName, Climate> = {
  temperate: {
    name: 'temperate', label: 'Classic',
    styles: ['Modern American', 'Old Brick', 'Mediterranean', 'Nordic'],
    ground: null, paveTint: null, promenade: null, snowRoofs: false,
    trees: [{ kind: 'round', weight: 1 }],
    beachProps: false, haze: null, sea: null, shallow: 0x66cfd9, grip: 1, spray: 0xd8dde4,
    weather: [{ name: 'clear', weight: 0.72 }, { name: 'rain', weight: 0.28 }],
  },
  snow: {
    name: 'snow', label: 'Snow',
    styles: ['Nordic', 'Old Brick', 'Modern American'],
    ground: 0xe9eef4, paveTint: { color: 0xe4eaf0, amount: 0.55 }, promenade: null, snowRoofs: true,
    trees: [{ kind: 'pine', weight: 1 }],
    beachProps: false, haze: { color: 0xdfe6ee, amount: 0.3 }, sea: 0x2a5a72, shallow: 0x7aa8b4, grip: 0.72, spray: 0xf4f8ff,
    weather: [{ name: 'snow', weight: 0.65 }, { name: 'clear', weight: 0.35 }],
  },
  beach: {
    name: 'beach', label: 'Beach',
    styles: ['Beach Pastel', 'Mediterranean'],
    ground: 0x5d8a3e, paveTint: { color: 0xe6d6b0, amount: 0.25 }, promenade: 0xe3cf9f, snowRoofs: false,
    trees: [{ kind: 'palm', weight: 0.85 }, { kind: 'round', weight: 0.15 }],
    beachProps: true, haze: null, sea: 0x1b8fb5, shallow: 0x6fe8dc, grip: 1, spray: 0xe8e0cc,
    weather: [{ name: 'clear', weight: 0.85 }, { name: 'rain', weight: 0.15 }],
  },
  desert: {
    name: 'desert', label: 'Desert',
    styles: ['Desert Southwest'],
    ground: 0xd2b386, paveTint: { color: 0xd4c8b0, amount: 0.3 }, promenade: 0xd8bf92, snowRoofs: false,
    trees: [{ kind: 'palm', weight: 0.45 }, { kind: 'cactus', weight: 0.55 }],
    beachProps: false, haze: { color: 0xe6c9a0, amount: 0.4 }, sea: 0x2a7f9a, shallow: 0x70d0c4, grip: 0.95, spray: 0xd9c29a,
    weather: [{ name: 'clear', weight: 0.95 }, { name: 'rain', weight: 0.05 }],
  },
};

export const CLIMATE_NAMES = Object.keys(CLIMATES) as ClimateName[];
const WEATHER_NAMES: WeatherName[] = ['clear', 'rain', 'snow'];
const WEATHER_LABEL: Record<WeatherName, string> = { clear: '', rain: 'Rain', snow: 'Snowfall' };
/** Wet or snowy roads: extra grip loss on top of the climate's. */
const WEATHER_GRIP: Record<WeatherName, number> = { clear: 1, rain: 0.86, snow: 1 };

export function pickClimate(seed: number, override?: string | null): Climate {
  if (override && override in CLIMATES) return CLIMATES[override as ClimateName];
  const roll = new Rng(seed ^ 0xc11a).next();
  return CLIMATES[roll < 0.4 ? 'temperate' : roll < 0.6 ? 'snow' : roll < 0.8 ? 'beach' : 'desert'];
}

export function pickWeather(seed: number, climate: Climate, override?: string | null): WeatherName {
  if (override && (WEATHER_NAMES as string[]).includes(override)) {
    // No snowfall on a beach or in the desert: that becomes rain.
    if (override === 'snow' && climate.name !== 'snow') return 'rain';
    if (override === 'rain' && climate.name === 'snow') return 'snow';
    return override as WeatherName;
  }
  let roll = new Rng(seed ^ 0x3a1d).next();
  for (const w of climate.weather) {
    if ((roll -= w.weight) < 0) return w.name;
  }
  return climate.weather[climate.weather.length - 1].name;
}

export function weatherLabel(weather: WeatherName): string {
  return WEATHER_LABEL[weather];
}

export function playerGrip(climate: Climate, weather: WeatherName): number {
  return climate.grip * WEATHER_GRIP[weather];
}

/** Overcast: keep the hue, drain most of the colour and shift the brightness toward `l`. */
function overcast(hex: number, keepSat: number, l: number, amount: number): number {
  const hsl = { h: 0, s: 0, l: 0 };
  const c = new THREE.Color(hex);
  c.getHSL(hsl, THREE.SRGBColorSpace);
  return c.setHSL(hsl.h, hsl.s * keepSat, THREE.MathUtils.lerp(hsl.l, l, amount), THREE.SRGBColorSpace).getHex();
}

function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

/** The time of day's lighting adjusted for the climate's haze and the weather. */
export function applyClimate(time: TimeOfDay, climate: Climate, weather: WeatherName): TimeOfDay {
  const t = { ...time };
  if (climate.sea !== null) t.sea = time.name === 'night' ? mix(climate.sea, time.sea, 0.6) : climate.sea;
  if (climate.haze) {
    const amount = time.name === 'night' ? climate.haze.amount * 0.25 : climate.haze.amount;
    t.skyHorizon = mix(t.skyHorizon, climate.haze.color, amount);
    t.skyZenith = mix(t.skyZenith, climate.haze.color, amount * 0.3);
    t.fogNear *= 0.9;
    t.fogFar *= 0.9;
  }
  if (weather === 'clear') return t;

  const dark = time.name === 'night';
  if (weather === 'rain') {
    t.skyHorizon = overcast(t.skyHorizon, 0.2, dark ? 0.12 : 0.55, 0.6);
    t.skyZenith = overcast(t.skyZenith, 0.2, dark ? 0.06 : 0.42, 0.7);
    t.fogNear *= 0.45;
    t.fogFar *= 0.6;
    t.sunIntensity *= 0.3;
    t.hemiIntensity *= 0.85;
    t.hemiSky = overcast(t.hemiSky, 0.3, 0.8, 0.5);
    t.sea = overcast(t.sea, 0.5, 0.3, 0.4);
  } else {
    t.skyHorizon = overcast(t.skyHorizon, 0.15, dark ? 0.2 : 0.82, 0.75);
    t.skyZenith = overcast(t.skyZenith, 0.2, dark ? 0.1 : 0.68, 0.75);
    t.fogNear *= 0.4;
    t.fogFar *= 0.55;
    t.sunIntensity *= 0.45;
    t.hemiIntensity *= 1.05;
  }
  // Gloomy enough that windows, street lamps and headlights come on.
  t.windowGlow = Math.max(t.windowGlow, 0.35);
  t.lampGlow = Math.max(t.lampGlow, 0.45);
  return t;
}
