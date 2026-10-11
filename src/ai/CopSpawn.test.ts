import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import { WANTED } from '../gameplay/balance';
import { DEFAULT_CITY, generateCity } from '../world/CityGenerator';
import { CopDirector, DIRECTOR_TUNING } from './CopDirector';

// Stand-in for building occlusion on the street grid: you can see straight down your own street.
const sameStreet = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.abs(a.x - b.x) < 8 || Math.abs(a.z - b.z) < 8;

describe('cop spawning', () => {
  beforeAll(() => RAPIER.init());

  it.each([1, 42, 1234])('seed %i: cops start hidden around corners, already moving, away from the destination', (seed) => {
    const city = generateCity(seed, { ...DEFAULT_CITY, roadworksChance: 0 });
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const director = new CopDirector(world, new THREE.Scene(), city.graph, sameStreet, new Rng(seed), 0, { ...DIRECTOR_TUNING, firstSpawnDelay: 0 });
    const start = city.graph.nearest(city.spawn.x, city.spawn.z);
    const player = { position: new THREE.Vector3(start.x, 0.5, start.z), velocity: new THREE.Vector3() };
    // Destination 3 junctions away along the route, so "ahead" spawns are tempted to use it.
    const route = [start.id];
    while (route.length < 6) {
      const last = city.graph.nodes[route[route.length - 1]];
      route.push(last.neighbors.find((id) => !route.includes(id))!);
    }
    const goal = city.graph.nodes[route[route.length - 1]];
    const level = { ...WANTED[4], maxCops: 8, spawnInterval: 0, roadblocks: false };
    for (let i = 0; i < 8; i++) director.update(0.1, player, new THREE.Vector3(0, 0, 1), level, route, goal);

    expect(director.cops.length).toBe(8);
    for (const cop of director.cops) {
      const p = cop.vehicle.position;
      const v = cop.vehicle.body.linvel();
      expect(Math.hypot(p.x - goal.x, p.z - goal.z)).toBeGreaterThan(DIRECTOR_TUNING.checkpointClear);
      expect(sameStreet(player.position, p)).toBe(false);
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(DIRECTOR_TUNING.startSpeed, 1);
    }
  });
});
