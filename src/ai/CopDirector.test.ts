import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import { ROADBLOCK_INTERVAL, WANTED, type CopType } from '../gameplay/balance';
import { DIFFICULTIES, scaledCopCap } from '../gameplay/difficulty';
import { RoadGraph, type RoadNode } from '../world/RoadGraph';
import { CopDirector, DIRECTOR_TUNING } from './CopDirector';
import { SUNK_BELOW } from '../render/Sea';

// 11×3 grid of junctions 100m apart: x = 0..1000, z = 0..200. Node id = row * 11 + col.
function grid(): RoadGraph {
  const nodes: RoadNode[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 11; col++) nodes.push({ id: row * 11 + col, x: col * 100, z: row * 100, neighbors: [] });
  }
  for (const n of nodes) {
    const col = n.id % 11;
    const row = Math.floor(n.id / 11);
    if (col < 10) n.neighbors.push(n.id + 1);
    if (col > 0) n.neighbors.push(n.id - 1);
    if (row < 2) n.neighbors.push(n.id + 11);
    if (row > 0) n.neighbors.push(n.id - 11);
  }
  return new RoadGraph(nodes);
}

const EAST = new THREE.Vector3(1, 0, 0);
const ROUTE = [11, 12, 13, 14, 15, 16, 17, 18]; // along the middle row, z = 100
const hidden = () => false; // every spot is out of sight

function setup() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const director = new CopDirector(world, new THREE.Scene(), grid(), hidden, new Rng(5), 0, { ...DIRECTOR_TUNING, firstSpawnDelay: 0 });
  const player = { position: new THREE.Vector3(0, 0.5, 100), velocity: new THREE.Vector3() };
  return { director, player };
}

describe('CopDirector', () => {
  beforeAll(() => RAPIER.init());

  it('fills up to the star level cap and no further', () => {
    const { director, player } = setup();
    const level = { ...WANTED[2], maxCops: 3, spawnInterval: 0, roadblocks: false };
    for (let i = 0; i < 50; i++) director.update(0.1, player, EAST, level, ROUTE, null);
    expect(director.cops).toHaveLength(3);
  });

  it('respects the spawn interval', () => {
    const { director, player } = setup();
    const level = { ...WANTED[2], maxCops: 10, spawnInterval: 2, roadblocks: false };
    for (let i = 0; i < 50; i++) director.update(0.1, player, EAST, level, ROUTE, null); // 5 s
    expect(director.cops.length).toBe(3); // at 0 s, 2 s and 4 s
  });

  it('replaces a wrecked cop, and clears the wreck after it burns out', () => {
    const { director, player } = setup();
    const level = { ...WANTED[2], maxCops: 2, spawnInterval: 0, roadblocks: false };
    for (let i = 0; i < 5; i++) director.update(0.1, player, EAST, level, ROUTE, null);
    const wrecked = director.cops[0];
    director.wreck(wrecked);
    director.update(0.1, player, EAST, level, ROUTE, null);
    expect(director.activeCops).toHaveLength(2); // a replacement is already on its way
    expect(director.cops).toContain(wrecked); // the wreck is still burning
    for (let t = 0; t < DIRECTOR_TUNING.wreckClearTime + 0.5; t += 0.1) director.update(0.1, player, EAST, level, ROUTE, null);
    expect(director.cops).not.toContain(wrecked);
    expect(director.cops).toHaveLength(2);
  });

  it('removes a cop that sank into the water at once, wrecked or not, and sends a replacement', () => {
    const { director, player } = setup();
    const level = { ...WANTED[2], maxCops: 2, spawnInterval: 0, roadblocks: false };
    for (let i = 0; i < 5; i++) director.update(0.1, player, EAST, level, ROUTE, null);
    const [sunk, wreck] = director.cops;
    director.wreck(wreck); // a wreck that then went in: no burning out under water
    for (const cop of [sunk, wreck]) cop.vehicle.teleport(500, SUNK_BELOW - 1, 300, 0);
    director.update(0.1, player, EAST, level, ROUTE, null);
    expect(director.cops).not.toContain(sunk);
    expect(director.cops).not.toContain(wreck);
    expect(director.activeCops).toHaveLength(1); // replacements come one per spawn tick
  });

  it('sets up a two-SUV roadblock across the road ahead on the player route at 4+ stars', () => {
    const { director, player } = setup();
    const level = { ...WANTED[3], maxCops: 0, roadblocks: true };
    director.update(9, player, EAST, level, ROUTE, null);
    expect(director.cops).toHaveLength(0); // the first one comes after 10 s
    director.update(1.1, player, EAST, level, ROUTE, null);
    expect(director.cops).toHaveLength(2);
    for (const cop of director.cops) {
      expect(cop.type).toBe('suv');
      expect(cop.controller.holdUntilClose).toBe(true);
      const p = cop.vehicle.position;
      expect(Math.abs(p.z - 100)).toBeLessThan(5); // on the route's road
      expect(p.x - player.position.x).toBeGreaterThanOrEqual(DIRECTOR_TUNING.roadblockAhead[0]);
      expect(p.x - player.position.x).toBeLessThanOrEqual(DIRECTOR_TUNING.roadblockAhead[1] + 20);
    }
    // Then not again until the interval has passed.
    director.update(ROADBLOCK_INTERVAL - 1, player, EAST, level, ROUTE, null);
    expect(director.cops).toHaveLength(2);
    director.update(1.1, player, EAST, level, ROUTE, null);
    expect(director.cops).toHaveLength(4);
  });

  it('retires roadblock cops over the cap once they fall behind, but brings back cops within it', () => {
    const { director, player } = setup();
    const level = { ...WANTED[3], maxCops: 1, spawnInterval: 0, roadblocks: true };
    director.update(10.1, player, EAST, level, ROUTE, null); // the roadblock, plus one regular cop
    expect(director.activeCops).toHaveLength(3);
    // The player drives on far past all three of them.
    const far = { ...player, position: player.position.clone().setX(DIRECTOR_TUNING.leashDistance * 3) };
    director.update(0.1, far, EAST, { ...level, roadblocks: false }, null, null);
    expect(director.activeCops).toHaveLength(1); // the two over the cap are gone…
    const kept = director.activeCops[0].vehicle.position;
    expect(Math.hypot(kept.x - far.position.x, kept.z - far.position.z)).toBeLessThan(DIRECTOR_TUNING.leashDistance); // …the other was moved back into play
  });

  it('no roadblock next to the destination', () => {
    const nearGoal = setup();
    const four = { ...WANTED[3], maxCops: 0, roadblocks: true };
    // Destination at the only route junction 140–260m ahead: nowhere left to block.
    nearGoal.director.update(11, nearGoal.player, EAST, four, ROUTE, { x: 200, z: 100 });
    expect(nearGoal.director.cops).toHaveLength(0);
  });
});

// Each star level's config, exactly as balance.ts defines it and Game passes it in.
const STARS = WANTED.map((level, i) => ({ stars: i + 1, level }));

describe('cops per star level match the WANTED config', () => {
  beforeAll(() => RAPIER.init());

  it.each(STARS.flatMap(({ stars, level }) => DIFFICULTIES.map((d) => ({ stars, level, d }))))(
    '$stars★ on $d.label: spawns every spawnInterval up to the difficulty-scaled cap',
    ({ level, d }) => {
      const { director, player } = setup();
      const cap = scaledCopCap(level.maxCops, d); // as Game does
      const dt = 0.05;
      const spawnedAt: number[] = [];
      // route null: roadblocks (which may exceed the cap) are covered separately.
      for (let t = 0; t < (cap + 2) * level.spawnInterval; t += dt) {
        const before = director.cops.length;
        director.update(dt, player, EAST, { ...level, maxCops: cap }, null, null);
        if (director.cops.length > before) spawnedAt.push(t);
      }
      expect(director.cops).toHaveLength(cap);
      expect(spawnedAt).toHaveLength(cap);
      for (let i = 1; i < spawnedAt.length; i++) {
        expect(spawnedAt[i] - spawnedAt[i - 1]).toBeCloseTo(level.spawnInterval, 0);
        expect(Math.abs(spawnedAt[i] - spawnedAt[i - 1] - level.spawnInterval)).toBeLessThanOrEqual(dt + 1e-9);
      }
    },
  );

  it.each(STARS)('$stars★: spawns only the configured cop types, in the configured proportions', ({ level }) => {
    const { director, player } = setup();
    const N = 300;
    const big = { ...level, maxCops: N, spawnInterval: 0 };
    for (let i = 0; i < N; i++) director.update(0.01, player, EAST, big, null, null);
    expect(director.cops).toHaveLength(N);
    const counts: Partial<Record<CopType, number>> = {};
    for (const c of director.cops) counts[c.type] = (counts[c.type] ?? 0) + 1;
    const total = Object.values(level.mix).reduce((a, b) => a + b, 0);
    expect(Object.keys(counts).sort()).toEqual(Object.keys(level.mix).sort());
    for (const [type, weight] of Object.entries(level.mix) as [CopType, number][]) {
      expect((counts[type] ?? 0) / N).toBeCloseTo(weight / total, 1);
    }
  });

  it.each(STARS)('$stars★: cops chase with the configured range and catch-up', ({ level }) => {
    const { director, player } = setup();
    for (let i = 0; i < 3; i++) director.update(0.1, player, EAST, { ...level, spawnInterval: 0 }, null, null);
    // Tuning is applied to existing cops each update (a brand-new cop gets it the next frame).
    director.update(0.1, player, EAST, { ...level, maxCops: 0 }, null, null);
    expect(director.cops.length).toBeGreaterThan(0);
    for (const cop of director.cops) {
      expect(cop.controller.tuning.chaseRange).toBe(level.chaseRange);
      expect(cop.controller.tuning.catchUp).toBe(level.catchUp);
    }
  });

  it.each(STARS)('$stars★: roadblocks only where the config enables them', ({ level }) => {
    const { director, player } = setup();
    director.update(ROADBLOCK_INTERVAL, player, EAST, { ...level, maxCops: 0 }, ROUTE, null);
    const suvs = director.cops.filter((c) => c.controller.holdUntilClose);
    expect(suvs).toHaveLength(level.roadblocks ? 2 : 0);
  });

  it('the config itself escalates: 4★ and 5★ bring roadblocks, never fewer cops for more stars', () => {
    expect(WANTED.map((l) => l.roadblocks)).toEqual([false, false, false, true, true]);
    for (let i = 1; i < WANTED.length; i++) {
      expect(WANTED[i].at).toBeGreaterThan(WANTED[i - 1].at);
      expect(WANTED[i].maxCops).toBeGreaterThanOrEqual(WANTED[i - 1].maxCops);
      expect(WANTED[i].spawnInterval).toBeLessThanOrEqual(WANTED[i - 1].spawnInterval);
    }
  });
});
