import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { generateCity } from '../world/CityGenerator';
import { RoadGraph } from '../world/RoadGraph';
import { SIGNAL_CYCLE, approachControls, signalState, type ApproachControl } from '../world/TrafficControl';
import { CivilianController } from './CivilianController';
import { asCivilian } from './CivilianTraffic';

const DT = 1 / 60;
const STOP_LINE = -10.4; // along the approach, relative to the junction centre (CivilianController STOP_LINE)
const START = -60; // metres before the junction

// A crossroads at the origin with arms 100m long, each continuing one more block.
// 0 W, 1 junction, 2 E, 3 S, 4 N, 5 far E, 6 far N.
function crossroads(): RoadGraph {
  return new RoadGraph([
    { id: 0, x: -100, z: 0, neighbors: [1] },
    { id: 1, x: 0, z: 0, neighbors: [0, 2, 3, 4] },
    { id: 2, x: 100, z: 0, neighbors: [1, 5] },
    { id: 3, x: 0, z: -100, neighbors: [1] },
    { id: 4, x: 0, z: 100, neighbors: [1, 6] },
    { id: 5, x: 200, z: 0, neighbors: [2] },
    { id: 6, x: 0, z: 200, neighbors: [4] },
  ]);
}

// Eastbound travels along x (right-hand lane at z=+3); northbound along z (lane at x=-3).
const APPROACHES = {
  x: { key: '0>1', route: [0, 1, 2, 5], start: { x: START, z: 3 }, yaw: Math.PI / 2, along: (p: { x: number }) => p.x },
  z: { key: '3>1', route: [3, 1, 4, 6], start: { x: -3, z: START }, yaw: 0, along: (p: { z: number }) => p.z },
} as const;

/** Drive a civilian through the junction under `control`; sample its nose position and speed every step. */
function approach(control: ApproachControl, seconds: number) {
  const a = APPROACHES[control.axis];
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const spec = asCivilian({ ...PLAYER_SPEC, body: 'sedan' as const });
  const v = new Vehicle(world, spec, { x: a.start.x, y: 1.2, z: a.start.z }, a.yaw);
  const c = new CivilianController(v, crossroads(), new Map([[a.key, control]]), () => Infinity, new Rng(1), a.route[0], a.route[1]);
  const internals = c as unknown as { route: number[]; rebuild(): void };
  internals.route = [...a.route];
  internals.rebuild();

  const samples: { t: number; nose: number; speed: number }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    v.drive(c.update(DT, t), DT);
    world.step();
    v.snapshot();
    samples.push({ t, nose: a.along(v.position) + spec.halfExtents.z, speed: v.speed });
  }
  return samples;
}

const light = (control: ApproachControl, t: number) => signalState(control.axis, t + control.phase);

// Every 2 s of the cycle, on both axes: the civilian meets green, yellow and red at every point.
const PHASES = Array.from({ length: SIGNAL_CYCLE / 2 }, (_, i) => i * 2);
const CASES = (['x', 'z'] as const).flatMap((axis) => PHASES.map((phase) => ({ axis, phase })));

describe('civilians obey traffic signals as configured', () => {
  beforeAll(() => RAPIER.init());

  it.each(CASES)('$axis-axis approach, phase $phase: never crosses on red, never waits on green, gets through', ({ axis, phase }) => {
    const control: ApproachControl = { kind: 'signal', axis, phase };
    const s = approach(control, SIGNAL_CYCLE + 12);

    // Crossing the stop line: the light was not red (yellow is fine when too close to stop).
    const crossing = s.findIndex((p) => p.nose > STOP_LINE + 0.5);
    expect(crossing).toBeGreaterThan(0);
    expect(light(control, s[crossing].t)).not.toBe('red');

    // While waiting at the line, the light was never green for more than a moment (pulling away).
    const waiting = s.filter((p) => Math.abs(p.speed) < 0.3 && p.nose > STOP_LINE - 5 && p.nose <= STOP_LINE + 0.5);
    const waitingOnGreen = waiting.filter((p) => light(control, p.t) === 'green' && light(control, p.t - 1.5) === 'green');
    expect(waitingOnGreen).toEqual([]);

    expect(s[s.length - 1].nose).toBeGreaterThan(15); // through the junction
  });

  it.each(['x', 'z'] as const)('%s-axis approach: a full stop at a stop sign, then carries on', (axis) => {
    const s = approach({ kind: 'stop', axis, phase: 0 }, 20);
    const atLine = s.filter((p) => p.nose > STOP_LINE - 4 && p.nose < STOP_LINE + 0.5);
    expect(Math.min(...atLine.map((p) => Math.abs(p.speed)))).toBeLessThan(0.6);
    expect(s[s.length - 1].nose).toBeGreaterThan(15);
  });
});

describe('the controls civilians obey are the ones placed in the city', () => {
  it.each([1, 42, 1234])('seed %i: every signal approach has a crossing approach on the other axis, never green together', (seed) => {
    const city = generateCity(seed);
    const controls = approachControls(city.graph, city.streetProps);
    const byJunction = new Map<string, ApproachControl[]>();
    for (const [key, c] of controls) {
      if (c.kind !== 'signal') continue;
      const j = key.split('>')[1];
      byJunction.set(j, [...(byJunction.get(j) ?? []), c]);
    }
    expect(byJunction.size).toBeGreaterThan(0);
    for (const list of byJunction.values()) {
      expect(new Set(list.map((c) => c.axis)).size).toBe(2);
      expect(new Set(list.map((c) => c.phase)).size).toBe(1); // one junction, one clock
      for (let t = 0; t < SIGNAL_CYCLE; t += 0.25) {
        const greens = new Set(list.filter((c) => light(c, t) === 'green').map((c) => c.axis));
        expect(greens.size).toBeLessThanOrEqual(1);
      }
    }
  });
});
