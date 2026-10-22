// Seed-chosen look: a real-world building/pavement style plus a time of day. Each palette colour
// is nudged slightly per seed, so cities sharing a style still differ, while staying in realistic
// ranges (unit-tested).
import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { Zone } from './CityGenerator';
import { pickClimate, type Climate } from './Climate';
import type { FacadeStyle } from '../render/Facades';
import type { DistrictKind, LotLook } from './districts/District';

/** The Old City in sandstone (desert) and whitewash (by the sea), lot by lot. */
const OLD_CITY_SANDSTONE: Record<string, Partial<LotLook>> = {
  halfTimbered: { palette: [0xe8cfa0, 0xdcc08e, 0xeed8ac] },
  stoneHouse: { palette: [0xd9b47e, 0xceaa72, 0xe0bf8c], roofTiles: [0xb0643a, 0xa05a34] },
  townHall: { palette: [0xd4ae78, 0xdcb886] },
  arcade: { palette: [0xd9b47e, 0xe0bf8c] },
};
const OLD_CITY_WHITEWASH: Record<string, Partial<LotLook>> = {
  halfTimbered: { palette: [0xf6f3ec, 0xf2eee4, 0xfaf8f2] },
  stoneHouse: { palette: [0xf0ece2, 0xe8e2d4, 0xf4f0e8], roofTiles: [0xb85a36, 0xc0683e, 0xa8502e] },
  townHall: { palette: [0xf2eee6, 0xeae4d8] },
  arcade: { palette: [0xf0ece2, 0xf4f0e8] },
};

/** Chinatown sun-bleached in the desert: faded reds, chalky pastels, weathered tiles. */
const CHINATOWN_FADED: Record<string, Partial<LotLook>> = {
  shophouse: { palette: [0xe6d0c2, 0xd6d4bc, 0xeadab6, 0xd0d2c8, 0xe2d2d6] },
  restaurant: { palette: [0xb8645a, 0xa85e52, 0xc27262, 0xc4a678], roofTiles: [0x6a9478, 0x5e866c] },
  banquetHall: { palette: [0xb8645a, 0xc27262], roofTiles: [0xc4a86a] },
  temple: { palette: [0xb06a5a, 0xa86454], roofTiles: [0xc4a86a] },
  teaHouse: { palette: [0x9a7458, 0x8e6a50], roofTiles: [0x6a9478] },
};
/** Chinatown by the beach: brighter pastel shophouses and shops. */
const CHINATOWN_BRIGHT: Record<string, Partial<LotLook>> = {
  shophouse: { palette: [0xffc4d0, 0xb4eed4, 0xfff09a, 0xb4d8ff, 0xf6c4f0, 0xffdcb0, 0xc8f4b8] },
  bubbleTea: { palette: [0xffb0d8, 0xa8f0ff, 0xfff08a] },
  bakery: { palette: [0xffe0a8, 0xfff0c8] },
};
/** The Harbor in the desert: sun-faded, dusty sheds. */
const HARBOR_DUSTY: Record<string, Partial<LotLook>> = {
  warehouse: { palette: [0xb8aa94, 0xa89c88, 0xc4b49a, 0x9c9282], roofTiles: [0x9a8a74, 0x8a7e6c] },
  transitShed: { palette: [0xc8bca4, 0xb8ae98], roofTiles: [0x9a8a74] },
  coldStore: { palette: [0xe8e0d0, 0xdcd4c4] },
  harborOffice: { palette: [0xd8ccb4, 0xe0d6c0] },
  silo: { palette: [0xd0c2a8, 0xc4b69c] },
};
/** The Harbor by the beach: brighter paint on the sheds. */
const HARBOR_BRIGHT: Record<string, Partial<LotLook>> = {
  warehouse: { palette: [0x5a9ad0, 0xe07a4a, 0x4ab08a, 0xe8c24a, 0xd85a5a, 0x7a8ad8] },
  transitShed: { palette: [0x6ab0d8, 0xe8d8a8, 0x8ad0b8] },
  harborOffice: { palette: [0xf4f0e8, 0xe8f2f6] },
};

export interface CityTheme {
  name: string;
  buildings: Record<Zone, number[]>;
  facades: Record<Zone, FacadeStyle>;
  gables: boolean; // residential houses get pitched roofs
  asphalt: number;
  sidewalk: number;
  plaza: number;
  quay: number;
  seaWall: number;
  planter: number;
  grass: number;
  leaves: number[];
  trunk: number;
  centerLine: number;
  edgeLine: number;
  promenade?: number; // seafront strip; defaults to the sidewalk colour
  /** Per-climate overrides of a district's lot looks (a sandstone Old City in the desert …). */
  districts?: Partial<Record<DistrictKind, Record<string, Partial<LotLook>>>>;
}

/** Roof colours for pitched roofs. */
export const ROOF_TILES = [0x6e3a2e, 0x45484d, 0x5a4e44, 0x7a4a36];

/** A zone's look, from the theme: its facade, wall palette, and pitched roofs on residential houses where the style has them. */
export function zoneLook(theme: CityTheme, zone: Zone): LotLook {
  return { facade: theme.facades[zone], roof: theme.gables && zone === 'residential' ? 'gable' : 'flat', palette: theme.buildings[zone], roofTiles: ROOF_TILES };
}

export type TimeOfDayName = 'day' | 'afternoon' | 'night';

export interface TimeOfDay {
  name: TimeOfDayName;
  label: string;
  skyZenith: number;
  skyHorizon: number; // also the fog colour, so distance blends into the sky
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunOffset: [number, number, number]; // sun position relative to the player
  exposure: number;
  windowGlow: number; // emissive intensity of lit windows
  lampGlow: number; // 0 = street lamps off, 1 = full night
  sea: number;
}

const THEMES: CityTheme[] = [
  {
    name: 'Modern American',
    facades: { downtown: 'curtain', midtown: 'office', residential: 'siding', industrial: 'industrial' },
    gables: true,
    buildings: {
      downtown: [0x8fa6c4, 0x6f87a8, 0xa9b8cc, 0x7d8fa3, 0x5f7390],
      midtown: [0xb8a99a, 0x9aa2ad, 0xc4b59e, 0x8f8a85, 0xa39488],
      residential: [0xd9b38c, 0xc98f6b, 0xe0d3b8, 0xa8b8a0, 0xbfa0a0],
      industrial: [0x8a8478, 0x7a8088, 0x9c9284, 0x6e6a64],
    },
    asphalt: 0x2a2d33, sidewalk: 0x8a8d93, plaza: 0x77727e, quay: 0x5a5f69, seaWall: 0x8a8f99, planter: 0x6b6f78,
    grass: 0x3a6b3c, leaves: [0x2f6b3a, 0x3d7a3f, 0x2a5e40, 0x4a7d32], trunk: 0x4a3426,
    centerLine: 0xe0b84a, edgeLine: 0xd8dbe0,
  },
  {
    name: 'Old Brick',
    facades: { downtown: 'office', midtown: 'brick', residential: 'brick', industrial: 'brick' },
    gables: true,
    buildings: {
      downtown: [0x5d6b78, 0x707b85, 0x8c8478, 0x4f5a66, 0x9a8f80],
      midtown: [0x8e4a3a, 0x7a3e30, 0xa0583f, 0xb89a74, 0x6e3a2e],
      residential: [0x9a5642, 0xb5714f, 0xd8c8a8, 0x7f4636, 0xc9b48f],
      industrial: [0x6b3b30, 0x5e5650, 0x7d4a3a, 0x4f4a46],
    },
    asphalt: 0x25272b, sidewalk: 0x7c7a76, plaza: 0x8a7f70, quay: 0x5c5a57, seaWall: 0x84807a, planter: 0x5f5b56,
    grass: 0x355e33, leaves: [0x2d5e30, 0x3a6b35, 0x28553a, 0x46703a], trunk: 0x3f2c22,
    centerLine: 0xe6e6e0, edgeLine: 0xe6e6e0,
  },
  {
    name: 'Mediterranean',
    facades: { downtown: 'office', midtown: 'shutters', residential: 'shutters', industrial: 'industrial' },
    gables: false,
    buildings: {
      downtown: [0xbfc6cc, 0xd8d2c4, 0x9fb0bd, 0xc9bfae, 0xa8b4bc],
      midtown: [0xe8e2d4, 0xd9a95b, 0xe0b8a8, 0xcf9a6a, 0xeae0c8],
      residential: [0xf0eadc, 0xd9a95b, 0xc0703f, 0xe0b8a8, 0xe6d3a3],
      industrial: [0xb8a78c, 0xa0937e, 0xc4b394, 0x8f8574],
    },
    asphalt: 0x34363b, sidewalk: 0xb7ab95, plaza: 0xa88f6e, quay: 0x9c9080, seaWall: 0xd8cfbf, planter: 0xb59a78,
    districts: { oldtown: OLD_CITY_WHITEWASH },
    grass: 0x56733d, leaves: [0x4a6b34, 0x5a7a3a, 0x3e5f30, 0x6b7f40], trunk: 0x5a4430,
    centerLine: 0xeeeeea, edgeLine: 0xeeeeea,
  },
  {
    name: 'Nordic',
    facades: { downtown: 'curtain', midtown: 'stucco', residential: 'siding', industrial: 'industrial' },
    gables: true,
    buildings: {
      downtown: [0x4e5b66, 0x66717a, 0x3f4a54, 0x7a848c, 0x55606a],
      midtown: [0xe3c46a, 0x9fb59a, 0xa8524a, 0x8fa9bf, 0xe6e3dc],
      residential: [0xe3c46a, 0xa8524a, 0xe6e3dc, 0x9fb59a, 0xd98e5c],
      industrial: [0x6e7075, 0x5f6266, 0x7f7a72, 0x4e5155],
    },
    asphalt: 0x2b2d30, sidewalk: 0x6e7075, plaza: 0x7a7c82, quay: 0x55585d, seaWall: 0x7c7f85, planter: 0x5a5d62,
    grass: 0x2f5a35, leaves: [0x2a5a33, 0x335f38, 0x244f30, 0x3d6a3a], trunk: 0x3d2e24,
    centerLine: 0xe8e8e4, edgeLine: 0xe8e8e4,
  },
  {
    name: 'Desert Southwest',
    facades: { downtown: 'office', midtown: 'adobe', residential: 'adobe', industrial: 'industrial' },
    gables: false,
    buildings: {
      downtown: [0x9c8f7d, 0x7a6a55, 0xb0a28c, 0x8c7b66, 0x6f7a80],
      midtown: [0xc79a6b, 0xd8c09a, 0xb5653c, 0xa9846a, 0xc4a57e],
      residential: [0xd8c09a, 0xc79a6b, 0xb5653c, 0xe0cfae, 0xa9846a],
      industrial: [0xa08c70, 0x8f7f68, 0xb39c7c, 0x7d705e],
    },
    asphalt: 0x3a3835, sidewalk: 0xc2b49a, plaza: 0xb08f6a, quay: 0x9a8a72, seaWall: 0xcbbd9f, planter: 0xa38a6a,
    districts: { oldtown: OLD_CITY_SANDSTONE, chinatown: CHINATOWN_FADED, harbor: HARBOR_DUSTY },
    grass: 0x6b7a3e, leaves: [0x5f6e34, 0x6f7a3c, 0x55642f, 0x7a8240], trunk: 0x5a4632,
    centerLine: 0xe0b84a, edgeLine: 0xe6e2d8,
  },
  {
    name: 'Beach Pastel',
    facades: { downtown: 'curtain', midtown: 'stucco', residential: 'shutters', industrial: 'industrial' },
    gables: false,
    buildings: {
      downtown: [0xa8c8d8, 0xd8e4ea, 0x9fbcc8, 0xc8d8d0, 0xb4c4d4],
      midtown: [0xf2c6c2, 0xa8dcd0, 0xf4e2b0, 0xc8b8e0, 0xf0d8c8],
      residential: [0xf4d0c8, 0xb8e0d4, 0xf6e6b8, 0xd8c8e8, 0xf6eee0],
      industrial: [0xc4b8a4, 0xb0a894, 0xd0c4ae, 0x9c9484],
    },
    asphalt: 0x36383d, sidewalk: 0xcfc6b4, plaza: 0xc8bca6, quay: 0xa0988a, seaWall: 0xe8e2d6, planter: 0xc0a888,
    districts: { oldtown: OLD_CITY_WHITEWASH, chinatown: CHINATOWN_BRIGHT, harbor: HARBOR_BRIGHT },
    grass: 0x5d8a3e, leaves: [0x4f8a3a, 0x5c9440, 0x467a34, 0x6a9a48], trunk: 0x8a6a48,
    centerLine: 0xe0b84a, edgeLine: 0xeeeeea,
  },
];

const TIMES: Record<TimeOfDayName, TimeOfDay> = {
  day: {
    name: 'day', label: 'Day',
    skyZenith: 0x4f8fd0, skyHorizon: 0xbcd6ea, fogNear: 150, fogFar: 650,
    // Strong sky + pavement bounce so street canyons in shadow aren't gloomy.
    hemiSky: 0xe4f0ff, hemiGround: 0x9a9284, hemiIntensity: 2.6,
    sunColor: 0xfff6e8, sunIntensity: 3.2, sunOffset: [35, 90, 25], exposure: 1.1,
    windowGlow: 0.06, lampGlow: 0, sea: 0x2a80a8,
  },
  afternoon: {
    name: 'afternoon', label: 'Golden hour',
    skyZenith: 0x5a78a8, skyHorizon: 0xf0b07a, fogNear: 120, fogFar: 560,
    hemiSky: 0xffd2a8, hemiGround: 0x6a5550, hemiIntensity: 1.6,
    sunColor: 0xffaa60, sunIntensity: 3.0, sunOffset: [85, 32, 40], exposure: 1.05,
    windowGlow: 0.35, lampGlow: 0.35, sea: 0x2f6d8a,
  },
  night: {
    name: 'night', label: 'Night',
    skyZenith: 0x0d1424, skyHorizon: 0x1a2233, fogNear: 100, fogFar: 480,
    hemiSky: 0xbfd4ff, hemiGround: 0x202020, hemiIntensity: 0.9,
    sunColor: 0xd8e2ff, sunIntensity: 2, sunOffset: [30, 60, 20], exposure: 1.0,
    windowGlow: 0.9, lampGlow: 1, sea: 0x1f6488,
  },
};

/** Small, seed-driven nudge to a colour: keeps hue family, varies tone. */
function jitter(hex: number, rng: Rng): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace); // perceptual, as seen on screen
  const h = (hsl.h + rng.range(-0.015, 0.015) + 1) % 1;
  const s = THREE.MathUtils.clamp(hsl.s * rng.range(0.88, 1.08), 0, 0.58); // margin for 8-bit rounding
  const l = THREE.MathUtils.clamp(hsl.l + rng.range(-0.035, 0.035), 0.08, 0.92);
  return new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace).getHex();
}

const tint = (hex: number, to: { color: number; amount: number } | null) =>
  to ? new THREE.Color(hex).lerp(new THREE.Color(to.color), to.amount).getHex() : hex;

/** A building style that suits the climate, with the climate's ground cover and dusted paving. */
export function pickTheme(seed: number, climate: Climate = pickClimate(seed)): CityTheme {
  const rng = new Rng(seed ^ 0x7e3e);
  const base = rng.pick(THEMES.filter((t) => climate.styles.includes(t.name)));
  const j = (hex: number) => jitter(hex, rng);
  const buildings = Object.fromEntries(
    Object.entries(base.buildings).map(([d, colors]) => [d, colors.map(j)]),
  ) as Record<Zone, number[]>;
  return {
    ...base,
    buildings,
    asphalt: j(base.asphalt),
    sidewalk: j(tint(base.sidewalk, climate.paveTint)),
    plaza: j(tint(base.plaza, climate.paveTint)),
    quay: j(base.quay),
    seaWall: j(base.seaWall),
    planter: j(base.planter),
    grass: j(climate.ground ?? base.grass),
    promenade: climate.promenade === null ? undefined : j(climate.promenade),
    leaves: base.leaves.map(j),
    trunk: j(base.trunk),
  };
}

export function pickTimeOfDay(seed: number, override?: string | null): TimeOfDay {
  if (override && override in TIMES) return TIMES[override as TimeOfDayName];
  const roll = new Rng(seed ^ 0x71de).next();
  return TIMES[roll < 0.4 ? 'day' : roll < 0.7 ? 'afternoon' : 'night'];
}

export const ALL_THEMES = THEMES;
