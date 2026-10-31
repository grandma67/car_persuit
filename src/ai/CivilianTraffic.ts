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
  TRACTOR_SPEC,
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
const TRACTOR_COLORS = [0x2f7a3a, 0xc8302a, 0x2f5a9a, 0xd8a02a];

// Weighted mix of civilian vehicles: mostly cars, a fair few vans/pickups, the odd bus and truck.
// `local`: only where a district asks for it by name (the Farm's tractors), never elsewhere.
const MIX: { weight: number; spec: VehicleSpec; colors: number[]; local?: boolean }[] = [
  { weight: 34, spec: { ...PLAYER_SPEC, body: 'sedan' }, colors: COLORS },
  { weight: 16, spec: { ...COP_SUV_SPEC, livery: undefined, maxHealth: undefined, engineForce: 5000 }, colors: COLORS },
  { weight: 10, spec: { ...PLAYER_SPEC, body: 'sports' }, colors: COLORS },
  { weight: 12, spec: VAN_SPEC, colors: COLORS },
  { weight: 10, spec: PICKUP_SPEC, colors: COLORS },
  { weight: 8, spec: BUS_SPEC, colors: BUS_COLORS },
  { weight: 10, spec: BOX_TRUCK_SPEC, colors: TRUCK_COLORS },
  { weight: 5, spec: TRACTOR_SPEC, colors: TRACTOR_COLORS, local: true },
];
const MIX_TOTAL = MIX.reduce((s, m) => s + (m.local ? 0 : m.weight), 0);

const isHeavy = (spec: VehicleSpec) => spec.body === 'bus' || spec.body === 'boxtruck' || spec.body === 'ramptruck';

/** A civilian from the mix; inside a district, its weights (and no buses or trucks where it bans them). */
function civilianSpec(rng: Rng, district?: DistrictTraffic): VehicleSpec {
  const weight = (m: (typeof MIX)[number]) =>
    m.local ? m.weight * (district?.weights?.[m.spec.name] ?? 0)
    : !district ? m.weight : !district.heavy && isHeavy(m.spec) ? 0 : m.weight * (district.weights?.[m.spec.name] ?? 1);
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
const RAY_SIDES = [0, -1, 1] as const; // centre, then the left and right corners of the bumper
const tmpFwd = new THREE.Vector3();

export function forwardObstacle(world: RAPIER.World, vehicle: Vehicle, range: number, corridor?: readonly { x: number; z: number }[]): Obstacle | null {
  // Runs for every car every few steps: plain numbers and a reused ray, no objects until something is seen.
  const p = vehicle.position;
  const f = vehicle.forward(tmpFwd);
  const start = vehicle.spec.halfExtents.z + 0.3;
  const reach = vehicle.spec.halfExtents.x - 0.1;
  // Bumper height, not the body centre: from a tall bus the centre-height ray passed over cars.
  const y = p.y - vehicle.spec.halfExtents.y + 0.3;
  let bestDistance = Infinity;
  let bestSide = 0;
  let blocker: RAPIER.Collider | null = null;
  let legX = f.x;
  let legZ = f.z;
  // Legs: bumper → each corridor point in turn; without a corridor, one leg straight ahead.
  let fromX = p.x + f.x * start;
  let fromZ = p.z + f.z * start;
  let travelled = 0;
  // Lane points the bumper has already passed would send the first leg backwards.
  let first = 0;
  while (corridor && first < corridor.length - 1 && (corridor[first].x - fromX) * f.x + (corridor[first].z - fromZ) * f.z < 1) first++;
  const legs = corridor?.length ? corridor.length - first : 1;
  const ray = (sensorRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  for (let i = 0; i < legs && travelled < range && !blocker; i++) {
    // The last corridor leg runs on to the end of the range.
    let toX = corridor?.length ? corridor[first + i].x : fromX + f.x * range;
    let toZ = corridor?.length ? corridor[first + i].z : fromZ + f.z * range;
    if (i === legs - 1 && corridor) {
      const k = Math.max(1, (range - travelled) / (Math.hypot(toX - fromX, toZ - fromZ) || 1));
      toX = fromX + (toX - fromX) * k;
      toZ = fromZ + (toZ - fromZ) * k;
    }
    const len = Math.hypot(toX - fromX, toZ - fromZ);
    if (len < 0.1) continue;
    const dx = (toX - fromX) / len;
    const dz = (toZ - fromZ) / len;
    // The first leg rises and falls with the car's pitch, so on a hill it still sees the car ahead up (or down) the slope.
    const dy = i === 0 ? f.y : 0;
    const legLen = Math.min(len, range - travelled);
    for (let s = 0; s < RAY_SIDES.length; s++) {
      const side = RAY_SIDES[s];
      // Right of the leg is (-dz, dx).
      ray.origin.x = fromX - dz * reach * side;
      ray.origin.y = y;
      ray.origin.z = fromZ + dx * reach * side;
      ray.dir.x = dx;
      ray.dir.y = dy;
      ray.dir.z = dz;
      const limit = blocker ? bestDistance - travelled : legLen;
      const hit = world.castRay(ray, limit, true, RAPIER.QueryFilterFlags.EXCLUDE_FIXED, CAR_GROUPS, vehicle.collider, vehicle.body);
      if (!hit) continue;
      bestDistance = travelled + hit.timeOfImpact;
      bestSide = side;
      blocker = hit.collider;
      legX = dx;
      legZ = dz;
    }
    travelled += legLen;
    fromX = toX;
    fromZ = toZ;
  }
  if (!blocker) return null;
  const best: Obstacle = { distance: bestDistance, aligned: true, moving: false, side: bestSide };
  const body = blocker.parent();
  if (body) {
    // A car's state as of the last step, without the allocating Rapier getters; other bodies read live.
    const car = body.userData instanceof Vehicle ? body.userData : null;
    const q = car ? car.quaternion : body.rotation();
    // Blocker's heading (+Z rotated by its quaternion), dotted with the lane where we saw it.
    const bx = 2 * (q.x * q.z + q.w * q.y);
    const bz = 1 - 2 * (q.x * q.x + q.y * q.y);
    best.aligned = bx * legX + bz * legZ > ALIGNED;
    const v = car ? car.vel : body.linvel();
    best.moving = Math.hypot(v.x, v.z) > 1;
    best.handle = body.handle;
    best.speed = v.x * legX + v.z * legZ;
    best.braking = car?.brakeLit === true;
  }
  return best;
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
  private moverPool: Mover[] = [];
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
  private sampleMovers(others: readonly Vehicle[]): void {
    // Runs every frame: the list and its entries are reused (readers only look within the frame).
    const list = this.moverList;
    list.length = 0;
    this.handles.clear();
    for (const car of this.cars) {
      this.addMover(list, car.vehicle, true);
      this.handles.add(car.vehicle.body.handle);
    }
    for (const vehicle of others) this.addMover(list, vehicle, false);
  }

  private addMover(list: Mover[], vehicle: Vehicle, civilian: boolean): void {
    const v = vehicle.vel;
    if (v.x * v.x + v.z * v.z < 4) return;
    const p = vehicle.position;
    const m = (this.moverPool[list.length] ??= { handle: 0, x: 0, z: 0, vx: 0, vz: 0, civilian: false });
    m.handle = vehicle.body.handle;
    m.x = p.x;
    m.z = p.z;
    m.vx = v.x;
    m.vz = v.z;
    m.civilian = civilian;
    list.push(m);
  }

  /** The rare ramp truck, if one is on the road (shown on the minimap). */
  get rampTruck(): Civilian | undefined {
    return this.cars.find((c) => c.vehicle.spec.body === 'ramptruck');
  }

  /** Fill to the target count around the player, recycle far/stuck cars. Once per frame. */
  update(playerPos: THREE.Vector3, others: Vehicle[] = []): void {
    this.sampleMovers(others);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const p = car.vehicle.position;
      const far = Math.hypot(p.x - playerPos.x, p.z - playerPos.z) > TRAFFIC.despawnDistance;
      const up = tmpUp.copy(UP).applyQuaternion(car.vehicle.quaternion).y;
      const sunk = p.y < SUNK_BELOW;
      if (far || sunk || car.controller.stuckFor > TRAFFIC.stuckLimit || up < 0.2) {
        car.vehicle.dispose();
        this.cars.splice(i--, 1);
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
    // Along a district's perimeter streets, its edge mix (the Farm's tractors out on the roads round it).
    const edges = this.districts?.edges;
    const district = zones?.get(node.id) ?? zones?.get(to.id) ?? (edges?.has(to.id) ? edges.get(node.id) : undefined);
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
