import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyClimate, CLIMATE_NAMES, CLIMATES, pickClimate, pickWeather, playerGrip } from './Climate';
import { ALL_THEMES, pickTheme, pickTimeOfDay } from './CityTheme';

const lightness = (hex: number) => {
  const out = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(out, THREE.SRGBColorSpace);
  return out;
};

describe('pickClimate', () => {
  it('is deterministic per seed and covers every climate', () => {
    expect(pickClimate(7)).toBe(pickClimate(7));
    const names = new Set(Array.from({ length: 300 }, (_, i) => pickClimate(i).name));
    expect(names).toEqual(new Set(CLIMATE_NAMES));
  });

  it('honours a valid override and ignores junk', () => {
    expect(pickClimate(1, 'desert').name).toBe('desert');
    expect(pickClimate(42, 'moon').name).toBe(pickClimate(42).name);
  });

  it('only uses building styles that exist', () => {
    const names = ALL_THEMES.map((t) => t.name);
    for (const c of Object.values(CLIMATES)) for (const s of c.styles) expect(names).toContain(s);
    for (const name of CLIMATE_NAMES) expect(pickTheme(3, CLIMATES[name]).name).toMatch(new RegExp(CLIMATES[name].styles.join('|')));
  });
});

describe('pickWeather', () => {
  it('rains sometimes in temperate cities, snows only in snow cities', () => {
    const temperate = new Set(Array.from({ length: 200 }, (_, i) => pickWeather(i, CLIMATES.temperate)));
    expect(temperate).toEqual(new Set(['clear', 'rain']));
    const snow = new Set(Array.from({ length: 200 }, (_, i) => pickWeather(i, CLIMATES.snow)));
    expect(snow).toEqual(new Set(['clear', 'snow']));
    for (let i = 0; i < 200; i++) expect(pickWeather(i, CLIMATES.beach)).not.toBe('snow');
  });

  it('maps an override to what the climate allows', () => {
    expect(pickWeather(1, CLIMATES.beach, 'snow')).toBe('rain');
    expect(pickWeather(1, CLIMATES.snow, 'rain')).toBe('snow');
    expect(pickWeather(1, CLIMATES.temperate, 'clear')).toBe('clear');
  });
});

describe('applyClimate', () => {
  it('rain dims the sun, greys the sky, pulls the fog in and costs grip', () => {
    const day = pickTimeOfDay(0, 'day');
    const wet = applyClimate(day, CLIMATES.temperate, 'rain');
    expect(wet.sunIntensity).toBeLessThan(day.sunIntensity);
    expect(wet.fogFar).toBeLessThan(day.fogFar);
    expect(lightness(wet.skyZenith).s).toBeLessThan(lightness(day.skyZenith).s);
    expect(wet.lampGlow).toBeGreaterThan(0);
    expect(playerGrip(CLIMATES.temperate, 'rain')).toBeLessThan(1);
    expect(applyClimate(day, CLIMATES.temperate, 'clear')).toEqual(day);
  });

  it('snow is the slipperiest', () => {
    expect(playerGrip(CLIMATES.snow, 'snow')).toBeLessThan(playerGrip(CLIMATES.temperate, 'rain'));
  });
});
