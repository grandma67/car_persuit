import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_CITY, generateCity, type CityData, type Rect } from './CityGenerator';
import { addGround } from './CityBuilder';
import { groundHeight, inCanal, landPieces, onGround, type Canal, type Terrain } from './Terrain';
import { staticLineOfSight } from '../ai/lineOfSight';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);
// Every seed with its own canal widths, plus some pinned to the narrowest and widest canals.
const WIDTHS = [DEFAULT_CITY.canalWidth[0], DEFAULT_CITY.canalWidth[1]];
const CASES: [number, number | null][] = [
  ...SEEDS.map((s): [number, null] => [s, null]),
  ...SEEDS.slice(0, 12).flatMap((s) => WIDTHS.map((w): [number, number] => [s, w])),
];
const cities = new Map<string, CityData>();
const cityFor = (seed: number, width: number | null = null) => {
  const key = `${seed}:${width}`;
  const canalWidth: [number, number] = width === null ? DEFAULT_CITY.canalWidth : [width, width];
  if (!cities.has(key)) cities.set(key, generateCity(seed, { ...DEFAULT_CITY, roadworksChance: 0, canalWidth }));
  return cities.get(key)!;
};
const contains = (r: Rect, x: number, z: number) => Math.abs(x - r.x) <= r.w / 2 + 1e-6 && Math.abs(z - r.z) <= r.d / 2 + 1e-6;

describe('terrain', () => {
  it('is deterministic per seed', () => {
    expect(generateCity(77).terrain).toEqual(generateCity(77).terrain);
  });

  it('varies with the seed: 0, 1 or 2 canals, either way, in different places; hill or flat', () => {
    const counts = new Set(SEEDS.map((s) => cityFor(s).terrain.canals.length));
    expect(counts).toEqual(new Set([0, 1, 2]));
    const canals = SEEDS.flatMap((s) => cityFor(s).terrain.canals);
    expect(new Set(canals.map((c) => c.axis))).toEqual(new Set(['x', 'z']));
    expect(new Set(canals.map((c) => c.line)).size).toBeGreaterThan(4);
    const hills = SEEDS.map((s) => cityFor(s).terrain.hill);
    expect(hills.some((h) => h === null)).toBe(true);
    expect(new Set(hills.filter(Boolean).map((h) => Math.round(h!.height))).size).toBeGreaterThan(4);
    const widths = canals.map((c) => c.half * 2);
    expect(Math.min(...widths)).toBeLessThan(40);
    expect(Math.max(...widths)).toBeGreaterThan(70);
  });

  it.each(SEEDS.slice(0, 12))('seed %i: the hill is gentle and the shore stays at sea level', (seed) => {
    const city = cityFor(seed);
    const t = city.terrain;
    const edge = city.islandSize / 2;
    for (let k = -edge; k <= edge; k += 8) {
      for (const [x, z] of [[k, edge], [k, -edge], [edge, k], [-edge, k]]) expect(groundHeight(t, x, z)).toBe(0);
    }
    let steepest = 0;
    for (let x = -edge; x < edge; x += 6) {
      for (let z = -edge; z < edge; z += 6) {
        const h = groundHeight(t, x, z);
        steepest = Math.max(steepest, Math.abs(groundHeight(t, x + 1, z) - h), Math.abs(groundHeight(t, x, z + 1) - h));
      }
    }
    expect(steepest).toBeLessThanOrEqual(DEFAULT_CITY.maxGrade + 0.005);
  });

  it.each(CASES)('seed %i, width %s: canals cut the island shore to shore, bridged every few blocks', (seed, pinned) => {
    const city = cityFor(seed, pinned);
    const t = city.terrain;
    // No road runs along a canal, and every road edge that crosses one lands on a bridge.
    for (const a of city.graph.nodes) {
      for (const id of a.neighbors) {
        const b = city.graph.nodes[id];
        for (const c of t.canals) {
          const [ua, ub] = c.axis === 'x' ? [a.z, b.z] : [a.x, b.x];
          expect(ua === c.at && ub === c.at).toBe(false);
          if ((ua - c.at) * (ub - c.at) > 0) continue; // same side
          const across = c.axis === 'x' ? { x: a.x, z: c.at } : { x: c.at, z: a.z };
          expect(t.bridges.some((r) => contains(r, across.x, across.z))).toBe(true);
        }
      }
    }
    // Bridges only on some of the roads that meet each canal, a few blocks apart.
    for (const c of t.canals) {
      const on = t.bridges.filter((b) => (c.axis === 'x' ? b.z : b.x) === c.at).map((b) => (c.axis === 'x' ? b.x : b.z)).sort((a, b) => a - b);
      expect(on.length).toBeGreaterThan(0);
      expect(on.length).toBeLessThan(city.config.blocks / 2);
      for (let k = 1; k < on.length; k++) expect(on[k] - on[k - 1]).toBeGreaterThanOrEqual(2 * (city.config.blockSize + city.config.roadWidth));
      expect(c.half * 2).toBeGreaterThanOrEqual(city.config.canalWidth[0]);
      expect(c.half * 2).toBeLessThanOrEqual(city.config.canalWidth[1]);
    }
    // The land pieces plus the canal strips make up the whole island.
    const land = t.land.reduce((sum, r) => sum + r.w * r.d, 0);
    const island = city.islandSize ** 2;
    const width = (axis: 'x' | 'z') => t.canals.filter((c) => c.axis === axis).reduce((sum, c) => sum + 2 * c.half, 0);
    const water = (width('x') + width('z')) * city.islandSize - width('x') * width('z');
    expect(land + water).toBeCloseTo(island, 3);
  });

  it.each(CASES)('seed %i, width %s: nothing stands in the water and the spawn is on dry land', (seed, width) => {
    const city = cityFor(seed, width);
    const t = city.terrain;
    const wet = (x: number, z: number) => !onGround(t, x, z);
    expect(city.buildings.filter((b) => inCanal(t, b.x, b.z, Math.max(b.w, b.d) / 2))).toEqual([]);
    expect(city.trees.filter((p) => wet(p.x, p.z))).toEqual([]);
    expect(city.props.filter((p) => wet(p.x, p.z))).toEqual([]);
    expect(city.streetProps.filter((p) => wet(p.x, p.z))).toEqual([]);
    expect(city.landmarks.filter((p) => wet(p.x, p.z))).toEqual([]);
    expect(wet(city.spawn.x, city.spawn.z)).toBe(false);
    for (const r of city.roads) {
      // Road segments reach onto the bridge decks, never into open water.
      for (const [x, z] of [[r.rect.x - r.rect.w / 2, r.rect.z - r.rect.d / 2], [r.rect.x + r.rect.w / 2, r.rect.z + r.rect.d / 2]]) {
        expect(wet(x * 0.999 + r.rect.x * 0.001, z * 0.999 + r.rect.z * 0.001)).toBe(false);
      }
    }
  });
});

describe('terrain physics', () => {
  beforeAll(() => RAPIER.init());

  const hilly = (): Terrain => ({ hill: { x: 20, z: -10, height: 18, rx: 260, rz: 200, yaw: 0.3 }, canals: [], bridges: [], land: [] });

  it('the ground collider matches the drawn hill', () => {
    const t = hilly();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    addGround(world, { x: 0, z: 0, w: 600, d: 500 }, t);
    world.step();
    for (const [x, z] of [[20.3, -9.7], [-130, 70], [150, 40], [-280, -240], [91, -177]]) {
      const hit = world.castRay(new RAPIER.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 }), 200, true);
      expect(hit).not.toBeNull();
      expect(100 - hit!.timeOfImpact).toBeCloseTo(groundHeight(t, x, z), 1);
    }
  });

  it('cops lose sight of the player over a hill crest', () => {
    const t = hilly();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    addGround(world, { x: 0, z: 0, w: 600, d: 500 }, t);
    world.step();
    const see = staticLineOfSight(world, (x, z) => groundHeight(t, x, z));
    const at = (x: number, z: number) => new THREE.Vector3(x, groundHeight(t, x, z) + 0.5, z);
    expect(see(at(-160, -10), at(200, -10))).toBe(false); // either side of the top
    expect(see(at(10, -10), at(40, -10))).toBe(true); // both near the top
  });

  it('a car climbs the hill from rest, over the top and across a bridge', () => {
    // Hill at the origin, a canal along X just past the top, bridged where the car crosses.
    const canal: Canal = { axis: 'x', line: 0, at: 120, half: 9 };
    const t: Terrain = {
      hill: { x: 0, z: 0, height: 20, rx: 290, rz: 290, yaw: 0 },
      canals: [canal],
      bridges: [{ x: 0, z: 120, w: 12, d: 18 }],
      land: landPieces(448, [canal]),
    };
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    for (const r of [...t.land, ...t.bridges]) addGround(world, r, t);
    const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: groundHeight(t, 0, -260) + 1.2, z: -260 }, 0);
    let lowest = Infinity;
    for (let i = 0; i < 60 * 30 && car.position.z < 200; i++) {
      car.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60);
      world.step();
      car.snapshot();
      lowest = Math.min(lowest, car.position.y - groundHeight(t, car.position.x, car.position.z));
    }
    expect(car.position.z).toBeGreaterThan(200);
    expect(Math.abs(car.position.x)).toBeLessThan(3);
    expect(lowest).toBeGreaterThan(0); // never sank into the ground or dropped into the canal
  });
});
