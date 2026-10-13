// A busy four-way junction, simulated: cars, vans, buses and trucks arrive from every arm, under
// stop signs and under traffic lights, and must all get through without colliding, without
// running a red or a stop sign, and without straying into the lane where the other direction's
// traffic drives or queues. The kerbs carry what the city puts there (signal poles or stop signs,
// hydrants, lamps), unbreakable here: a vehicle that snags one is a failure, as in the game, where
// a bus stuck on a pole gets written off and vanishes.
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { BOX_TRUCK_SPEC, BUS_SPEC, COP_SUV_SPEC, PICKUP_SPEC, PLAYER_SPEC, VAN_SPEC, type VehicleSpec } from '../vehicles/VehicleSpecs';
import { RoadGraph } from '../world/RoadGraph';
import { signalState, type ApproachControl } from '../world/TrafficControl';
import type { Keep } from '../world/driveSide';
import { CivilianController } from './CivilianController';
import { TRAFFIC, asCivilian, forwardObstacle } from './CivilianTraffic';
import type { Awareness, Mover } from './awareness';
import { Junctions } from './junctions';

const DT = 1 / 60;
const HALF_ROAD = 6;
const STOP_LINE = 10.4; // junction centre → stop line (CivilianController)
const ARM = 72; // junction centre → next junction on each arm (a 60m block and a 12m road)
const SPAWN_AT = 62; // metres out from the centre a new arrival starts
const EXIT_AT = 45; // metres out along the exit arm: through
const SECONDS = 210;
const DRAIN = 90; // seconds at the end with no new arrivals: everyone should be through by then

// Arms: 0 east, 1 north, 2 west, 3 south. Node 0 is the junction, 1–4 the arm ends, 5–8 beyond.
const ARMS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];
function crossroads(): RoadGraph {
  const nodes = [{ id: 0, x: 0, z: 0, neighbors: [1, 2, 3, 4] }];
  ARMS.forEach((a, i) => nodes.push({ id: 1 + i, x: a.x * ARM, z: a.z * ARM, neighbors: [0, 5 + i] }));
  ARMS.forEach((a, i) => nodes.push({ id: 5 + i, x: a.x * ARM * 2, z: a.z * ARM * 2, neighbors: [1 + i] }));
  return new RoadGraph(nodes);
}

// The game's traffic mix (CivilianTraffic MIX): mostly cars, about one in five a bus or truck.
const MIX: { weight: number; spec: VehicleSpec }[] = [
  { weight: 34, spec: asCivilian({ ...PLAYER_SPEC, body: 'sedan' }) },
  { weight: 16, spec: asCivilian({ ...COP_SUV_SPEC, livery: undefined, maxHealth: undefined, engineForce: 5000 }) },
  { weight: 10, spec: asCivilian({ ...PLAYER_SPEC, body: 'sports' }) },
  { weight: 12, spec: asCivilian(VAN_SPEC) },
  { weight: 10, spec: asCivilian(PICKUP_SPEC) },
  { weight: 8, spec: asCivilian(BUS_SPEC) },
  { weight: 10, spec: asCivilian(BOX_TRUCK_SPEC) },
];
const MIX_TOTAL = MIX.reduce((s, m) => s + m.weight, 0);
function pickSpec(rng: Rng): VehicleSpec {
  let roll = rng.next() * MIX_TOTAL;
  return (MIX.find((m) => (roll -= m.weight) < 0) ?? MIX[0]).spec;
}

/**
 * Kerbside poles round the junction, where the city places them: per approach, the stop sign
 * before the junction or the signal across it (2.5m from the junction edge, 0.7m in from the
 * kerb, on the driver's side); a hydrant 6m and a lamp 12m along each kerb from every corner.
 */
function poles(mode: Mode, keep: Keep): { x: number; z: number; half: number }[] {
  const out: { x: number; z: number; half: number }[] = [];
  for (const a of ARMS) {
    const dx = -a.x; // travel toward the junction from this arm
    const dz = -a.z;
    const rx = -dz * keep; // driver's kerb side
    const rz = dx * keep;
    const along = mode === 'signal' ? HALF_ROAD + 2.5 : -(HALF_ROAD + 2.5); // a priority sign stands where a stop sign would
    out.push({ x: dx * along + rx * (HALF_ROAD + 0.7), z: dz * along + rz * (HALF_ROAD + 0.7), half: 0.15 });
    for (const side of [-1, 1]) {
      out.push({ x: a.x * (HALF_ROAD + 6) - dz * side * (HALF_ROAD + 0.6), z: a.z * (HALF_ROAD + 6) + dx * side * (HALF_ROAD + 0.6), half: 0.22 });
      out.push({ x: a.x * (HALF_ROAD + 12) - dz * side * (HALF_ROAD + 0.7), z: a.z * (HALF_ROAD + 12) + dx * side * (HALF_ROAD + 0.7), half: 0.15 });
    }
  }
  return out;
}

/** Which arm a point is out on, and how far (null: inside the junction box). */
function armOf(x: number, z: number): { arm: number; out: number } | null {
  if (Math.abs(z) <= HALF_ROAD && Math.abs(x) > HALF_ROAD) return { arm: x > 0 ? 0 : 2, out: Math.abs(x) };
  if (Math.abs(x) <= HALF_ROAD && Math.abs(z) > HALF_ROAD) return { arm: z > 0 ? 1 : 3, out: Math.abs(z) };
  return null;
}

interface Car {
  id: number;
  vehicle: Vehicle;
  controller: CivilianController;
  entry: number; // arm index
  exit: number;
  spawned: number;
  crossedAt: number | null; // time the nose crossed the stop line
  minSpeedAtLine: number;
  wrongLane: number; // worst metres over the centre line, beyond the stop lines
  offRoad: number;
  dodged: boolean;
  hardBrake: number; // worst deceleration over half a second, m/s²
  top: number; // top speed, m/s
  speeds: number[]; // the last half second
  through: number | null; // time it reached EXIT_AT
  wrongAt: string;
  poleHits: number;
  writtenOff: boolean; // stuck long enough that the game's traffic manager would delete it
  offTrack: number; // worst metres between where it drove through the junction and where it said it would
  brakeAt: string;
}

/**
 * 'priority': the x road has priority (no stop), the z road stops for it. 'fast': the same, with
 * the x road signed 90 and its traffic arriving from twice as far out, up to speed.
 */
type Mode = 'stop' | 'signal' | 'priority' | 'fast';
const FAST_SPAWN_AT = 130;

/** Run the junction for SECONDS, a new arrival on each arm every `gap` seconds (min, max). */
function simulate(mode: Mode, seed: number, keep: Keep, gap: [number, number]) {
  const rng = new Rng(seed);
  const graph = crossroads();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(600, 0.5, 600).setTranslation(0, -0.5, 0));
  const controls = new Map<string, ApproachControl>();
  const phase = rng.range(0, 22);
  ARMS.forEach((a, i) => {
    if ((mode === 'priority' || mode === 'fast') && a.x !== 0) return; // the priority road: no control
    controls.set(`${1 + i}>0`, { kind: mode === 'signal' ? 'signal' : 'stop', axis: a.x !== 0 ? 'x' : 'z', phase });
  });
  const fast = new Set<string>();
  if (mode === 'fast') for (const i of [0, 2]) for (const k of [`${5 + i}>${1 + i}`, `${1 + i}>0`, `0>${1 + i}`, `${1 + i}>${5 + i}`]) fast.add(k);
  const poleColliders = poles(mode, keep).map((p) => world.createCollider(RAPIER.ColliderDesc.cuboid(p.half, 1.5, p.half).setTranslation(p.x, 1.5, p.z)));

  let movers: Mover[] = [];
  const handles = new Set<number>();
  const awareness: Awareness = {
    obstacle: (v, range, corridor) => {
      const o = forwardObstacle(world, v, range, corridor);
      if (o?.handle !== undefined) o.civilian = handles.has(o.handle);
      return o;
    },
    movers: () => movers,
  };
  const junctions = new Junctions();
  const cars: Car[] = [];
  const done: Car[] = [];
  const collisions: string[] = [];
  const touching = new Set<string>();
  const nextSpawn = ARMS.map(() => rng.range(0, 4));
  let nextId = 0;

  for (let t = 0; t < SECONDS; t += DT) {
    // Arrivals: on each arm, every few seconds, if the spawn spot is clear.
    ARMS.forEach((a, i) => {
      if (t < nextSpawn[i] || t > SECONDS - DRAIN) return;
      const dx = -a.x;
      const dz = -a.z; // heading in toward the junction
      const fastArm = mode === 'fast' && a.x !== 0;
      const out = fastArm ? FAST_SPAWN_AT : SPAWN_AT;
      const x = a.x * out - dz * 3 * keep;
      const z = a.z * out + dx * 3 * keep;
      if (cars.some((c) => Math.hypot(c.vehicle.position.x - x, c.vehicle.position.z - z) < 16)) return;
      nextSpawn[i] = t + rng.range(gap[0], gap[1]);
      const spec = { ...pickSpec(rng), kerb: keep > 0 ? ('right' as const) : ('left' as const) };
      const vehicle = new Vehicle(world, spec, { x, y: 1.2 - (spec.wheelY ?? 0), z }, Math.atan2(dx, dz));
      vehicle.tractionAssist = 6;
      vehicle.mesh.root.visible = false;
      const controller = new CivilianController(vehicle, graph, controls, () => Infinity, rng, fastArm ? 5 + i : 1 + i, fastArm ? 1 + i : 0, awareness, keep, junctions, fast);
      handles.add(vehicle.body.handle);
      const route = (controller as unknown as { route: number[] }).route;
      cars.push({ id: nextId++, vehicle, controller, entry: i, exit: route[route.indexOf(0) + 1] - 1, spawned: t, crossedAt: null, minSpeedAtLine: Infinity, wrongLane: 0, offRoad: 0, dodged: false, hardBrake: 0, top: 0, speeds: [], through: null, wrongAt: '', offTrack: 0, brakeAt: '', poleHits: 0, writtenOff: false });
    });

    movers = cars.flatMap(({ vehicle: v }) => {
      const lv = v.body.linvel();
      if (lv.x * lv.x + lv.z * lv.z < 4) return [];
      const p = v.body.translation();
      return [{ handle: v.body.handle, x: p.x, z: p.z, vx: lv.x, vz: lv.z, civilian: true }];
    });
    for (const c of cars) c.vehicle.drive(c.controller.update(DT, t), DT);
    world.step();

    for (const c of cars) {
      const v = c.vehicle;
      v.snapshot();
      if (v.consumeImpact() > 3) c.controller.hit();
      for (const pole of poleColliders) {
        world.contactPair(v.collider, pole, (m) => {
          if (m.numContacts() > 0 && m.contactDist(0) < 0.05) c.poleHits++;
        });
      }
      if (c.controller.stuckFor > TRAFFIC.stuckLimit) c.writtenOff = true;
      const claim = (c.controller as unknown as { claim: { track: { x: number; z: number }[] } | null }).claim;
      if (claim && Math.max(Math.abs(v.position.x), Math.abs(v.position.z)) < STOP_LINE) {
        const d = Math.min(...claim.track.map((q) => Math.hypot(q.x - v.position.x, q.z - v.position.z)));
        c.offTrack = Math.max(c.offTrack, d);
      }
      const speed = v.speed;
      c.top = Math.max(c.top, speed);
      c.speeds.push(speed);
      if (c.speeds.length > 30) c.speeds.shift();
      // Braking from speed: the handbrake taking the last 1 m/s off at a stop isn't a lurch.
      const decel = (c.speeds[0] - speed) / (c.speeds.length * DT);
      if (t - c.spawned > 2 && c.speeds[0] > 3 && decel > c.hardBrake) {
        c.hardBrake = decel;
        c.brakeAt = `t=${t.toFixed(1)} (${v.position.x.toFixed(1)},${v.position.z.toFixed(1)}) ${c.speeds[0].toFixed(1)}→${speed.toFixed(1)}`;
      }
      if ((c.controller as unknown as { recovery: { dodgeFor: number } }).recovery.dodgeFor > 0) c.dodged = true;

      // Stop line: nose position along the entry arm.
      const a = ARMS[c.entry];
      const out = v.position.x * a.x + v.position.z * a.z - v.spec.halfExtents.z;
      if (c.crossedAt === null) {
        if (out < STOP_LINE + 4) c.minSpeedAtLine = Math.min(c.minSpeedAtLine, Math.abs(speed));
        if (out < STOP_LINE - 0.5) c.crossedAt = t;
      }

      // Body corners: over the centre line on any arm beyond the stop line, or off the road.
      const r = v.body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const h = v.spec.halfExtents;
      for (const [cx, cz] of [[h.x, h.z], [-h.x, h.z], [h.x, -h.z], [-h.x, -h.z]]) {
        const p = new THREE.Vector3(cx, 0, cz).applyQuaternion(q).add(v.position);
        const where = armOf(p.x, p.z);
        if (!where && (Math.abs(p.x) > HALF_ROAD || Math.abs(p.z) > HALF_ROAD)) {
          c.offRoad = Math.max(c.offRoad, Math.min(Math.abs(p.x), Math.abs(p.z)) - HALF_ROAD);
          continue;
        }
        if (!where) continue;
        if (where.out < STOP_LINE) continue;
        // Travel direction on this arm: in toward the centre on the entry arm, out on the exit.
        const arm = ARMS[where.arm];
        const sign = where.arm === c.entry ? -1 : where.arm === c.exit ? 1 : 0;
        if (sign === 0) {
          c.wrongLane = Math.max(c.wrongLane, 99); // out on an arm that isn't ours at all
          continue;
        }
        const dx = arm.x * sign;
        const dz = arm.z * sign;
        const lateral = (p.x * -dz + p.z * dx) * keep; // + toward our kerb
        if (-lateral > c.wrongLane) {
          c.wrongLane = -lateral;
          c.wrongAt = `arm ${where.arm} ${where.out.toFixed(1)}m out, t=${t.toFixed(1)}`;
        }
      }
    }

    // Car-on-car contacts.
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const A = cars[i];
        const B = cars[j];
        if (A.vehicle.position.distanceTo(B.vehicle.position) > 16) continue;
        let hit = false;
        world.contactPair(A.vehicle.collider, B.vehicle.collider, (manifold) => {
          if (manifold.numContacts() > 0 && manifold.contactDist(0) < 0.05) hit = true;
        });
        const key = `${A.id}-${B.id}`;
        if (hit && !touching.has(key)) {
          touching.add(key);
          collisions.push(`t=${t.toFixed(1)} #${A.id} ${A.vehicle.spec.body ?? 'sports'} ${A.entry}→${A.exit} hit #${B.id} ${B.vehicle.spec.body ?? 'sports'} ${B.entry}→${B.exit} at (${A.vehicle.position.x.toFixed(1)},${A.vehicle.position.z.toFixed(1)})`);
        }
      }
    }

    // Through: retire it.
    for (const c of [...cars]) {
      const e = ARMS[c.exit];
      const p = c.vehicle.position;
      if (p.x * e.x + p.z * e.z > EXIT_AT && c.crossedAt !== null) {
        c.through = t;
        c.vehicle.dispose();
        cars.splice(cars.indexOf(c), 1);
        done.push(c);
      }
    }
  }

  const redRuns = done.concat(cars).filter((c) => {
    if (mode !== 'signal' || c.crossedAt === null) return false;
    return signalState(ARMS[c.entry].x !== 0 ? 'x' : 'z', c.crossedAt + phase) === 'red';
  });
  const stopRuns = done.concat(cars).filter((c) => (mode === 'stop' || (mode !== 'signal' && ARMS[c.entry].x === 0)) && c.crossedAt !== null && c.minSpeedAtLine > 0.6);
  // Still on the road a full DRAIN after the last arrival.
  return { done, stuck: cars, collisions, redRuns, stopRuns, fastRoad: mode === 'fast' };
}

const name = (c: Car) => `#${c.id} ${c.vehicle.spec.body ?? 'sports'} ${c.entry}→${c.exit}`;

function report(r: ReturnType<typeof simulate>) {
  const all = r.done.concat(r.stuck);
  return {
    through: r.done.length,
    stuck: r.stuck.map((c) => `${name(c)} at (${c.vehicle.position.x.toFixed(1)},${c.vehicle.position.z.toFixed(1)}) v=${c.vehicle.speed.toFixed(1)}`),
    collisions: r.collisions,
    redRuns: r.redRuns.map(name),
    stopRuns: r.stopRuns.map(name),
    wrongLane: all.filter((c) => c.wrongLane > 0.3).map((c) => `${name(c)} ${c.wrongLane.toFixed(2)}m ${c.wrongAt}`),
    offTrack: all.filter((c) => c.offTrack > 1).map((c) => `${name(c)} ${c.offTrack.toFixed(2)}m`),
    slowest: r.done.reduce((m, c) => Math.max(m, c.through! - c.spawned), 0),
    poleHits: all.filter((c) => c.poleHits > 0).map(name),
    writtenOff: all.filter((c) => c.writtenOff).map(name),
    // Nothing over the kerb: a car's tail may just brush the corner, clear of the poles.
    offRoad: all.filter((c) => c.offRoad > 0.1).map((c) => `${name(c)} ${c.offRoad.toFixed(2)}m`),
    dodged: all.filter((c) => c.dodged).length,
    // Cars (not buses or trucks) in off the priority road, and the best they managed.
    fastTops: all.filter((c) => ARMS[c.entry].x !== 0 && c.vehicle.spec.mass < 5000).map((c) => c.top),
    // At 90 a car pulling out ahead can mean firm braking (short of an emergency stop).
    hardBrake: all.filter((c) => c.hardBrake > (r.fastRoad && ARMS[c.entry].x !== 0 ? 8 : 6.5)).map((c) => `${name(c)} ${c.hardBrake.toFixed(1)} ${c.brakeAt}`),
  };
}

describe('four-way junction simulation', () => {
  beforeAll(() => RAPIER.init());

  const safe = (r: ReturnType<typeof report>) => {
    expect(r.collisions).toEqual([]);
    expect(r.redRuns).toEqual([]);
    expect(r.stopRuns).toEqual([]);
    expect(r.wrongLane).toEqual([]);
    expect(r.offRoad).toEqual([]);
    expect(r.poleHits).toEqual([]);
    expect(r.writtenOff).toEqual([]);
    expect(r.dodged).toBe(0);
    expect(r.hardBrake).toEqual([]);
    expect(r.offTrack).toEqual([]); // the ground it claimed is the ground it drove over
  };

  // An arrival on each arm every 15–25 s: a dozen vehicles a minute through one junction, several
  // times what one sees in a game. Keeping right and keeping left.
  const CASES = (['stop', 'priority', 'fast', 'signal'] as const).flatMap((mode) => ([1, -1] as const).flatMap((keep) => (mode === 'fast' ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3]) /* the fast road: more seeds, it's the hardest */.map((seed) => ({ mode, keep, seed }))));
  it.each(CASES)('$mode, keep $keep, seed $seed: everyone through, safely and in their lane', ({ mode, keep, seed }) => {
    const r = report(simulate(mode, seed, keep, [15, 25]));
    expect(r.through).toBeGreaterThanOrEqual(20);
    expect(r.stuck).toEqual([]);
    // Behind a bus swinging wide through a turn, a queue can wait a while (at a light, a green or
    // two; on the side road of a priority junction, for a gap in the main road's traffic, which
    // at 90, both ways, takes longer).
    expect(r.slowest).toBeLessThan(mode === 'stop' ? 60 : mode === 'fast' ? 120 : 80);
    safe(r);
    if (mode === 'fast') {
      // Up to 90 on the run in (most of them; one stuck behind a bus may not get there), never over.
      expect(r.fastTops.filter((v) => v > 21).length).toBeGreaterThan(r.fastTops.length / 2);
      expect(Math.max(...r.fastTops)).toBeLessThan(25.5);
    }
  }, 120_000);

  // Rush hour: more arrivals than a stop junction can take. Queues grow, but nobody pushes in,
  // cuts across or drives round the queue.
  it.each(['stop', 'priority', 'fast', 'signal'] as const)('%s, rush hour: queues, never a crash or a shortcut', (mode) => {
    const r = report(simulate(mode, 7, 1, [4, 7]));
    expect(r.through).toBeGreaterThan(30);
    safe(r);
  }, 120_000);
});
