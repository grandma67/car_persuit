import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { BUS_SPEC, VAN_SPEC, type VehicleSpec } from '../vehicles/VehicleSpecs';
import { RoadGraph } from '../world/RoadGraph';
import { CivilianController } from './CivilianController';
import { asCivilian } from './CivilianTraffic';

const DT = 1 / 60;
const SIGN = 40; // metres along the street 1>2 (x = 40)

// A straight road along x: 0 → 1 → 2 → 3, blocks 100m long, eastbound lane at z = +3.
function street(): RoadGraph {
  return new RoadGraph([
    { id: 0, x: -100, z: 0, neighbors: [1] },
    { id: 1, x: 0, z: 0, neighbors: [0, 2] },
    { id: 2, x: 100, z: 0, neighbors: [1, 3] },
    { id: 3, x: 200, z: 0, neighbors: [2] },
  ]);
}

/** Drive eastbound from x = -60 past a bus stop on 1>2; sample nose position and speed every step. */
function drive(base: VehicleSpec, seconds: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const spec = asCivilian(base);
  const v = new Vehicle(world, spec, { x: -60, y: 1.5, z: 3 }, Math.PI / 2);
  const c = new CivilianController(v, street(), new Map(), () => Infinity, new Rng(1), 0, 1, undefined, 1, undefined, new Set(), new Map([['1>2', SIGN]]));
  const internals = c as unknown as { route: number[]; rebuild(): void };
  internals.route = [0, 1, 2, 3];
  internals.rebuild();
  const samples: { t: number; nose: number; speed: number }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    v.drive(c.update(DT, t), DT);
    world.step();
    v.snapshot();
    samples.push({ t, nose: v.position.x + spec.halfExtents.z, speed: v.speed });
  }
  return samples;
}

describe('bus stops', () => {
  beforeAll(() => RAPIER.init());

  it('a bus pulls up at the sign, stands about 3 seconds, then carries on', () => {
    const s = drive(BUS_SPEC, 40);
    const standing = s.filter((p) => Math.abs(p.speed) < 0.3 && p.nose > SIGN - 4 && p.nose < SIGN + 4);
    expect(standing.length).toBeGreaterThan(0);
    const time = standing[standing.length - 1].t - standing[0].t;
    expect(time).toBeGreaterThan(2.8);
    expect(time).toBeLessThan(4.5);
    // Never stops anywhere else, and is well on its way afterwards.
    expect(s.filter((p) => p.t > 2 && Math.abs(p.speed) < 0.3 && Math.abs(p.nose - SIGN) >= 4)).toEqual([]);
    expect(s[s.length - 1].nose).toBeGreaterThan(SIGN + 40);
  });

  it('other traffic drives past the stop', () => {
    const s = drive(VAN_SPEC, 15);
    expect(s.filter((p) => p.t > 2 && Math.abs(p.speed) < 3)).toEqual([]);
  });
});
