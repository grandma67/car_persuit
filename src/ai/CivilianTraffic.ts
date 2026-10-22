// Sparse civilian traffic around the player: enough to weave through, never a wall. Cars are
// recycled — despawned when far behind or stuck, respawned on roads out of sight nearby.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import type { ApproachControl } from '../world/TrafficControl';
import { FLAT, type GroundHeight } from '../world/Terrain';
import { SUNK_BELOW } from '../render/Sea';

import { CAR_GROUPS, Vehicle } from '../vehicles/Vehicle';
import {
  PLAYER_SPEC,
  COP_SUV_SPEC,
  VAN_SPEC,
  PICKUP_SPEC,
  BUS_SPEC,
  BOX_TRUCK_SPEC,
  RAMP_TRUCK_SPEC,
  type VehicleSpec,
} from '../vehicles/VehicleSpecs';
import { CivilianController, type ForwardSensor } from './CivilianController';
import type { Awareness, Mover, Obstacle } from './awareness';
import { Junctions } from './junctions';
import type { Keep } from '../world/driveSide';
import type { DistrictTraffic } from '../world/districts/District';
import type { DistrictTrafficRules } from '../world/districts/runtime';

const UP = new THREE.Vector3(0, 1, 0);
const tmpUp = new THREE.Vector3(); // scratch, for reading a car's up axis

export const TRAFFIC = {
  count: 20, // default (menu); each difficulty sets its own
  spawnMin: 170, // metres by road from the player — far enough to drive into view, not pop in
  spawnMax: 340,
  despawnDistance: 420, // straight-line
  stuckLimit: 6, // seconds
  spacing: 18, // metres between spawn points and existing traffic
  rampChance: 0.05, // per spawn, while no ramp truck is around
};

const ALIGNED = 0.5; // heading dot product above which a blocker counts as queueing, not crashed

// Traction assist (per second) for civilians: they hold their lane on any surface instead of
// sliding wide, and shake off the spin from a knock instead of spinning out into a jam.
const CIVILIAN_TRACTION = 6;

// Everyday car colours.
const COLORS = [0xc9ccd1, 0xf0f0ee, 0x1c1e22, 0x24345a, 0x6e1a1f, 0x5b6068, 0xb8a98c, 0x2f4a3a, 0x8a8f96, 0x3a5f8a];
const BUS_COLORS = [0xd8a21c, 0xc0392b, 0x2a6fb0, 0x2e8b57];
const TRUCK_COLORS = [0xf0f0ee, 0x24345a, 0x6e1a1f, 0x2f4a3a];

// Weighted mix of civilian vehicles: mostly cars, a fair few vans/pickups, the odd bus and truck.
const MIX: { weight: number; spec: VehicleSpec; colors: number[] }[] = [
  { weight: 34, spec: { ...PLAYER_SPEC, body: 'sedan' }, colors: COLORS },
  { weight: 16, spec: { ...COP_SUV_SPEC, livery: undefined, maxHealth: undefined, engineForce: 5000 }, colors: COLORS },
  { weight: 10, spec: { ...PLAYER_SPEC, body: 'sports' }, colors: COLORS },
  { weight: 12, spec: VAN_SPEC, colors: COLORS },
  { weight: 10, spec: PICKUP_SPEC, colors: COLORS },
  { weight: 8, spec: BUS_SPEC, colors: BUS_COLORS },
  { weight: 10, spec: BOX_TRUCK_SPEC, colors: TRUCK_COLORS },
];
const MIX_TOTAL = MIX.reduce((s, m) => s + m.weight, 0);

const isHeavy = (spec: VehicleSpec) => spec.body === 'bus' || spec.body === 'boxtruck' || spec.body === 'ramptruck';

/** A civilian from the mix; inside a district, its weights (and no buses or trucks where it bans them). */
function civilianSpec(rng: Rng, district?: DistrictTraffic): VehicleSpec {
  const weight = (m: (typeof MIX)[number]) =>
    !district ? m.weight : !district.heavy && isHeavy(m.spec) ? 0 : m.weight * (district.weights?.[m.spec.name] ?? 1);
  const total = district ? MIX.reduce((sum, m) => sum + weight(m), 0) : MIX_TOTAL;
  let roll = rng.next() * total;
  const pick = MIX.find((m) => (roll -= weight(m)) < 0) ?? MIX[0];
  return asCivilian(pick.spec, rng.pick(pick.colors));
}

// Steering lock (radians, the bicycle-model angle) of the real thing, from turning circles and
// wheelbases: a car about 37° (a 10.5m kerb-to-kerb circle on a 2.8m wheelbase), an SUV, van or
// pickup about 35° (12–13m on 3–3.7m). The player's and cops' specs keep less, for the feel at
// speed; a civilian rounding a corner at walking pace needs all of it, or it runs wide over the
// centre line of the road it turns into. Buses and trucks already have theirs (VehicleSpecs).
const CIVILIAN_LOCK: Partial<Record<NonNullable<VehicleSpec['body']>, number>> = {
  sedan: 0.65,
  sports: 0.65,
  suv: 0.61,
  van: 0.61,
  pickup: 0.61,
};

/** A base spec detuned for civilian driving: no livery, gentler engine, capped top speed, a real car's lock. */
export function asCivilian(base: VehicleSpec, color = base.color): VehicleSpec {
  return {
    ...base,
    name: 'Civilian',
    color,
    livery: undefined,
    engineForce: Math.min(base.engineForce, 3200 * (base.mass / 1200)),
    maxSpeed: Math.min(base.maxSpeed, 28), // room for 90 km/h on a fast stretch
    maxSteer: Math.max(base.maxSteer, CIVILIAN_LOCK[base.body ?? 'sports'] ?? 0),
  };
}

function rampTruckSpec(): VehicleSpec {
  return { ...RAMP_TRUCK_SPEC, color: 0xe8701a };
}

/** One spec per civilian body/livery, for compiling their shaders before they first spawn. */
export function civilianSpecVariants(): VehicleSpec[] {
  return [...MIX.map((m) => ({ ...m.spec, livery: undefined })), rampTruckSpec()];
}

/**
 * Forward sensor: rays from the centre and both corners of the front bumper, so a car half in
 * our lane is seen too. They only see moving bodies (cars), so buildings at junction corners
 * don't make drivers brake. Given the lane ahead (`corridor`: points along it, nearest first),
 * the rays follow it leg by leg, so through a turn they look where the car is going rather than
 * straight off the bonnet at the cars waiting at the cross street's stop line.
 */
let sensorRay: RAPIER.Ray | null = null; // reused: three new rays per car per look was GC churn

export function forwardObstacle(world: RAPIER.World, vehicle: Vehicle, range: number, corridor?: readonly { x: number; z: number }[]): Obstacle | null {
  const p = vehicle.position;
  const f = vehicle.forward();
  const start = vehicle.spec.halfExtents.z + 0.3;
  const reach = vehicle.spec.halfExtents.x - 0.1;
  // Bumper height, not the body centre: from a tall bus the centre-height ray passed over cars.
  const y = p.y - vehicle.spec.halfExtents.y + 0.3;
  let best: Obstacle | null = null;
  let blocker: RAPIER.Collider | null = null;
  let legDir = { x: f.x, z: f.z };
  // Legs: bumper → each corridor point in turn; without a corridor, one leg straight ahead.
  let from = { x: p.x + f.x * start, z: p.z + f.z * start };
  let travelled = 0;
  // Lane points the bumper has already passed would send the first leg backwards.
  let first = 0;
  while (corridor && first < corridor.length - 1 && (corridor[first].x - from.x) * f.x + (corridor[first].z - from.z) * f.z < 1) first++;
  const legs = corridor?.length ? corridor.slice(first) : [{ x: from.x + f.x * range, z: from.z + f.z * range }];
  for (let i = 0; i < legs.length && travelled < range && !best; i++) {
    const to = i === legs.length - 1 && corridor ? extend(from, legs[i], range - travelled) : legs[i];
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    if (len < 0.1) continue;
    const dx = (to.x - from.x) / len;
    const dz = (to.z - from.z) / len;
    // The first leg rises and falls with the car's pitch, so on a hill it still sees the car ahead up (or down) the slope.
    const dy = i === 0 ? f.y : 0;
    const legLen = Math.min(len, range - travelled);
    for (const side of [0, -1, 1]) {
      // Right of the leg is (-dz, dx).
      const ray = (sensorRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
      ray.origin = { x: from.x - dz * reach * side, y, z: from.z + dx * reach * side };
      ray.dir = { x: dx, y: dy, z: dz };
      const limit = best ? best.distance - travelled : legLen;
      const hit = world.castRay(ray, limit, true, RAPIER.QueryFilterFlags.EXCLUDE_FIXED, CAR_GROUPS, vehicle.collider, vehicle.body);
      if (!hit) continue;
      best = { distance: travelled + hit.timeOfImpact, aligned: true, moving: false, side };
      blocker = hit.collider;
      legDir = { x: dx, z: dz };
    }
    travelled += legLen;
    from = to;
  }
  const body = blocker?.parent();
  if (best && body) {
    const q = body.rotation();
    // Blocker's heading (+Z rotated by its quaternion), dotted with the lane where we saw it.
    const bx = 2 * (q.x * q.z + q.w * q.y);
    const bz = 1 - 2 * (q.x * q.x + q.y * q.y);
    best.aligned = bx * legDir.x + bz * legDir.z > ALIGNED;
    const v = body.linvel();
    best.moving = Math.hypot(v.x, v.z) > 1;
    best.handle = body.handle;
    best.speed = v.x * legDir.x + v.z * legDir.z;
    best.braking = (body.userData as { brakeLit?: boolean } | undefined)?.brakeLit === true;
  }
  return best;
}

/** The point `by` metres on from `to`, carrying on in the direction from → to. */
function extend(from: { x: number; z: number }, to: { x: number; z: number }, by: number) {
  const len = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  const k = Math.max(1, by / len);
  return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
}

export interface Civilian {
  vehicle: Vehicle;
  controller: CivilianController;
}

export class CivilianTraffic {
  readonly cars: Civilian[] = [];
  /** Target number of cars on the road (set per difficulty). */
  count = TRAFFIC.count;
  private sense: ForwardSensor;
  private awareness: Awareness;
  private moverList: Mover[] = [];
  private handles = new Set<number>(); // our cars' bodies
  private junctions = new Junctions();
  private spawnFrom = -1; // junction nearest the player when spawnNodes was worked out
  private spawnNodes: RoadGraph['nodes'] = [];

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    private graph: RoadGraph,
    private controls: Map<string, ApproachControl>,
    private rng: Rng,
    private headlights: number,
    private ground: GroundHeight = FLAT,
    private keep: Keep = 1,
    private fast: Set<string> = new Set(),
    private stops: Map<string, number> = new Map(),
    private districts: DistrictTrafficRules | null = null,
  ) {
    // Forward sensor: a ray from the front bumper that only sees moving bodies (cars), so
    // buildings at junction corners don't make drivers brake.
    this.awareness = {
      obstacle: (vehicle, range, corridor) => {
        const o = forwardObstacle(this.world, vehicle, range, corridor);
        if (o?.handle !== undefined) o.civilian = this.handles.has(o.handle);
        return o;
      },
      movers: () => this.moverList,
    };
    this.sense = (vehicle, range) => forwardObstacle(this.world, vehicle, range)?.distance ?? Infinity;
  }

  /**
   * Snapshot every moving vehicle, for drivers checking what's about to cross them: ours plus
   * `others` (the player, cops). Only vehicles, not every body in the world — smashed props keep
   * their bodies for good, so that list grows all game.
   */
  private sampleMovers(others: Vehicle[]): void {
    const list: Mover[] = [];
    const add = (vehicle: Vehicle, civilian: boolean) => {
      const b = vehicle.body;
      const v = b.linvel();
      if (v.x * v.x + v.z * v.z < 4) return;
      const t = b.translation();
      list.push({ handle: b.handle, x: t.x, z: t.z, vx: v.x, vz: v.z, civilian });
    };
    this.handles.clear();
    for (const car of this.cars) {
      add(car.vehicle, true);
      this.handles.add(car.vehicle.body.handle);
    }
    for (const vehicle of others) add(vehicle, false);
    this.moverList = list;
  }

  /** The rare ramp truck, if one is on the road (shown on the minimap). */
  get rampTruck(): Civilian | undefined {
    return this.cars.find((c) => c.vehicle.spec.body === 'ramptruck');
  }

  /** Fill to the target count around the player, recycle far/stuck cars. Once per frame. */
  update(playerPos: THREE.Vector3, others: Vehicle[] = []): void {
    this.sampleMovers(others);
    for (const car of [...this.cars]) {
      const p = car.vehicle.position;
      const far = Math.hypot(p.x - playerPos.x, p.z - playerPos.z) > TRAFFIC.despawnDistance;
      const up = tmpUp.copy(UP).applyQuaternion(car.vehicle.quaternion).y;
      const sunk = p.y < SUNK_BELOW;
      if (far || sunk || car.controller.stuckFor > TRAFFIC.stuckLimit || up < 0.2) {
        car.vehicle.dispose();
        this.cars.splice(this.cars.indexOf(car), 1);
      }
    }
    // Spawn at most one car per frame to spread the cost.
    if (this.cars.length < this.count) this.spawn(playerPos);
  }

  /** Pick by weight (spawn density per district). */
  private weightedPick<T>(items: T[], weight: (t: T) => number): T {
    const total = items.reduce((sum, t) => sum + weight(t), 0);
    let roll = this.rng.next() * total;
    return items.find((t) => (roll -= weight(t)) < 0) ?? items[items.length - 1];
  }

  private spawn(playerPos: THREE.Vector3): void {
    const g = this.graph;
    const from = g.nearest(playerPos.x, playerPos.z);
    // The road search only changes when the player reaches another junction; a spawn that's
    // turned down (too close to a car) tries again next frame, so don't redo it each time.
    if (this.spawnFrom !== from.id) {
      const dist = g.distancesFrom(from.id);
      this.spawnFrom = from.id;
      this.spawnNodes = g.nodes.filter((n) => dist[n.id] >= TRAFFIC.spawnMin && dist[n.id] <= TRAFFIC.spawnMax);
    }
    const candidates = this.spawnNodes;
    if (!candidates.length) return;
    const zones = this.districts?.nodes;
    const node = zones?.size ? this.weightedPick(candidates, (n) => zones.get(n.id)?.density ?? 1) : this.rng.pick(candidates);
    const to = g.nodes[this.rng.pick(node.neighbors)];
    // Inside a district (or turning into one), its own mix.
    const district = zones?.get(node.id) ?? zones?.get(to.id);
    // Start in our lane (right, or left in an English city) just past the junction, heading along the road.
    const len = Math.hypot(to.x - node.x, to.z - node.z);
    const dx = (to.x - node.x) / len;
    const dz = (to.z - node.z) / len;
    const x = node.x + dx * 12 - dz * 3 * this.keep;
    const z = node.z + dz * 12 + dx * 3 * this.keep;
    if (this.cars.some((c) => Math.hypot(c.vehicle.position.x - x, c.vehicle.position.z - z) < TRAFFIC.spacing)) return;
    const ramp = !this.rampTruck && this.rng.next() < TRAFFIC.rampChance && (district?.heavy ?? true);
    const spec: VehicleSpec = { ...(ramp ? rampTruckSpec() : civilianSpec(this.rng, district)), kerb: this.keep > 0 ? 'right' : 'left' };
    // Drop tall bodies in from a little higher so their wheels land rather than spawn in the road.
    const y = this.ground(x, z) + 1.2 - (spec.wheelY ?? 0);
    const vehicle = new Vehicle(this.world, spec, { x, y, z }, Math.atan2(dx, dz));
    vehicle.tractionAssist = CIVILIAN_TRACTION;
    vehicle.headlights = this.headlights;
    vehicle.beamEnabled = false;
    this.scene.add(vehicle.mesh.root);
    this.cars.push({ vehicle, controller: new CivilianController(vehicle, g, this.controls, this.sense, this.rng, node.id, to.id, this.awareness, this.keep, this.junctions, this.fast, this.stops, this.districts) });
  }
}
