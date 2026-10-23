import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { RoadGraph } from '../world/RoadGraph';
import type { Obstacle } from './awareness';
import { CivilianController } from './CivilianController';
import { asCivilian } from './CivilianTraffic';
import { Horn, type Honk } from './horn';

const DT = 1 / 60;

/** Honks (and when) over `seconds`, `blocked(t)` each step, bumped at the times in `bumps`. */
function run(horn: Horn, seconds: number, blocked: (t: number) => boolean, bumps: number[] = []) {
  const honks: { t: number; honk: Honk }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    if (bumps.some((b) => b >= t && b < t + DT)) horn.bumped();
    horn.update(DT, blocked(t));
    const honk = horn.take();
    if (honk) honks.push({ t, honk });
  }
  return honks;
}

describe('Horn', () => {
  it('blasts once, a moment after a bump, and not again for a knock right after', () => {
    const honks = run(new Horn(), 5, () => false, [1, 1.2, 1.5]);
    expect(honks.map((h) => h.honk)).toEqual(['blast']);
    expect(honks[0].t).toBeGreaterThan(1.2);
    expect(honks[0].t).toBeLessThan(1.5);
  });

  it('beeps when blocked for a while, gets longer, then gives up', () => {
    const honks = run(new Horn(), 60, () => true);
    expect(honks[0].t).toBeGreaterThan(1);
    expect(honks.map((h) => h.honk)).toEqual(['beep', 'beep', 'blast', 'blast', 'blast']);
    for (let i = 1; i < honks.length; i++) expect(honks[i].t - honks[i - 1].t).toBeGreaterThanOrEqual(2);
  });

  it('a short hold-up never honks, and the count starts over after it clears', () => {
    expect(run(new Horn(), 20, (t) => t % 2 < 1)).toEqual([]);
    const honks = run(new Horn(), 60, (t) => t < 30 || t > 31);
    expect(honks.filter((h) => h.t > 31)[0].honk).toBe('beep');
  });

  it('an impatient driver honks sooner than a calm one', () => {
    const first = (temper: number) => run(new Horn(temper), 10, () => true)[0].t;
    expect(first(0.75)).toBeLessThan(first(1.25));
  });
});

describe('a civilian honks at what blocks it', () => {
  beforeAll(() => RAPIER.init());

  /** A civilian on an empty straight with `obstacle` (if any) always 3 m ahead: the honks over 10 s. */
  function honks(obstacle: Omit<Obstacle, 'distance'> | null) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    const v = new Vehicle(world, asCivilian({ ...PLAYER_SPEC, body: 'sedan' as const }), { x: -200, y: 1.2, z: 3 }, Math.PI / 2);
    const graph = new RoadGraph([
      { id: 0, x: -300, z: 0, neighbors: [1] },
      { id: 1, x: 300, z: 0, neighbors: [0] },
    ]);
    const awareness = { obstacle: () => (obstacle ? { ...obstacle, distance: 3 } : null), movers: () => [] };
    const c = new CivilianController(v, graph, new Map(), () => Infinity, new Rng(1), 0, 1, awareness);
    const heard: Honk[] = [];
    for (let t = 0; t < 10; t += DT) {
      v.drive(c.update(DT, t), DT);
      world.step();
      v.snapshot();
      const honk = c.honk();
      if (honk) heard.push(honk);
    }
    return heard;
  }

  it('the player (or a car across the lane) standing in the way', () => {
    expect(honks({ aligned: true, moving: false, side: 0 })).toContain('beep');
    expect(honks({ aligned: false, moving: false, side: 0, civilian: true })).toContain('beep');
  });

  it('not queueing behind traffic, nor on an open road', () => {
    expect(honks({ aligned: true, moving: false, side: 0, civilian: true })).toEqual([]);
    expect(honks(null)).toEqual([]);
  });
});
