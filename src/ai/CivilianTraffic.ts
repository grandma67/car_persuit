// Sparse civilian traffic around the player: enough to weave through, never a wall. Cars are
// recycled — despawned when far behind or stuck, respawned on roads out of sight nearby.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import type { ApproachControl } from '../world/TrafficControl';
import { FLAT, type GroundHeight } from '../world/Terrain';
import { Vehicle } from '../vehicles/Vehicle';
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

export const TRAFFIC = {
  count: 20, // default (menu); each difficulty sets its own
  spawnMin: 170, // metres by road from the player — far enough to drive into view, not pop in
  spawnMax: 340,
  despawnDistance: 420, // straight-line
  stuckLimit: 6, // seconds
  spacing: 18, // metres between spawn points and existing traffic
  rampChance: 0.05, // per spawn, while no ramp truck is around
};

const MOVER_MIN_MASS = 400; // kg: cars and up, not knocked-over cones and bins
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

function civilianSpec(rng: Rng): VehicleSpec {
  let roll = rng.next() * MIX_TOTAL;
  const pick = MIX.find((m) => (roll -= m.weight) < 0) ?? MIX[0];
  return asCivilian(pick.spec, rng.pick(pick.colors));
}

/** A base spec detuned for civilian driving: no livery, gentler engine, capped top speed. */
export function asCivilian(base: VehicleSpec, color = base.color): VehicleSpec {
  return {
    ...base,
    name: 'Civilian',
    color,
    livery: undefined,
    engineForce: Math.min(base.engineForce, 3200 * (base.mass / 1200)),
    maxSpeed: Math.min(base.maxSpeed, 20),
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
 * don't make drivers brake.
 */
export function forwardObstacle(world: RAPIER.World, vehicle: Vehicle, range: number): Obstacle | null {
  const p = vehicle.position;
  const f = vehicle.forward();
  const start = vehicle.spec.halfExtents.z + 0.3;
  const reach = vehicle.spec.halfExtents.x - 0.1;
  // Bumper height, not the body centre: from a tall bus the centre-height ray passed over cars.
  const y = p.y - vehicle.spec.halfExtents.y + 0.3;
  let best: Obstacle | null = null;
  let blocker: RAPIER.Collider | null = null;
  for (const side of [0, -1, 1]) {
    // Right of the heading is (-f.z, f.x).
    const ox = p.x + f.x * start - f.z * reach * side;
    const oz = p.z + f.z * start + f.x * reach * side;
    // Along the car's pitch, so on a hill it still sees the car ahead up (or down) the slope.
    const ray = new RAPIER.Ray({ x: ox, y, z: oz }, { x: f.x, y: f.y, z: f.z });
    const hit = world.castRay(ray, best?.distance ?? range, true, RAPIER.QueryFilterFlags.EXCLUDE_FIXED, undefined, vehicle.collider, vehicle.body);
    if (!hit) continue;
    best = { distance: hit.timeOfImpact, aligned: true, moving: false, side };
    blocker = hit.collider;
  }
  const body = blocker?.parent();
  if (best && body) {
    const q = body.rotation();
    // Blocker's heading (+Z rotated by its quaternion), dotted with ours.
    const bx = 2 * (q.x * q.z + q.w * q.y);
    const bz = 1 - 2 * (q.x * q.x + q.y * q.y);
    best.aligned = bx * f.x + bz * f.z > ALIGNED;
    const v = body.linvel();
    best.moving = Math.hypot(v.x, v.z) > 1;
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

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    private graph: RoadGraph,
    private controls: Map<string, ApproachControl>,
    private rng: Rng,
    private headlights: number,
    private ground: GroundHeight = FLAT,
  ) {
    // Forward sensor: a ray from the front bumper that only sees moving bodies (cars), so
    // buildings at junction corners don't make drivers brake.
    this.awareness = { obstacle: (vehicle, range) => forwardObstacle(this.world, vehicle, range), movers: () => this.moverList };
    this.sense = (vehicle, range) => forwardObstacle(this.world, vehicle, range)?.distance ?? Infinity;
  }

  /** Snapshot every moving vehicle-sized body, for drivers checking what's about to cross them. */
  private sampleMovers(): void {
    const list: Mover[] = [];
    const civilians = new Set(this.cars.map((c) => c.vehicle.body.handle));
    this.world.bodies.forEach((b) => {
      if (!b.isDynamic() || b.mass() < MOVER_MIN_MASS) return;
      const v = b.linvel();
      if (v.x * v.x + v.z * v.z < 4) return;
      const t = b.translation();
      list.push({ handle: b.handle, x: t.x, z: t.z, vx: v.x, vz: v.z, civilian: civilians.has(b.handle) });
    });
    this.moverList = list;
  }

  /** The rare ramp truck, if one is on the road (shown on the minimap). */
  get rampTruck(): Civilian | undefined {
    return this.cars.find((c) => c.vehicle.spec.body === 'ramptruck');
  }

  /** Fill to the target count around the player, recycle far/stuck cars. Once per frame. */
  update(playerPos: THREE.Vector3): void {
    this.sampleMovers();
    for (const car of [...this.cars]) {
      const p = car.vehicle.position;
      const far = Math.hypot(p.x - playerPos.x, p.z - playerPos.z) > TRAFFIC.despawnDistance;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(car.vehicle.quaternion).y;
      if (far || car.controller.stuckFor > TRAFFIC.stuckLimit || up < 0.2) {
        car.vehicle.dispose();
        this.cars.splice(this.cars.indexOf(car), 1);
      }
    }
    // Spawn at most one car per frame to spread the cost.
    if (this.cars.length < this.count) this.spawn(playerPos);
  }

  private spawn(playerPos: THREE.Vector3): void {
    const g = this.graph;
    const from = g.nearest(playerPos.x, playerPos.z);
    const dist = g.distancesFrom(from.id);
    const candidates = g.nodes.filter((n) => dist[n.id] >= TRAFFIC.spawnMin && dist[n.id] <= TRAFFIC.spawnMax);
    if (!candidates.length) return;
    const node = this.rng.pick(candidates);
    const to = g.nodes[this.rng.pick(node.neighbors)];
    // Start in the right-hand lane just past the junction, heading along the road.
    const len = Math.hypot(to.x - node.x, to.z - node.z);
    const dx = (to.x - node.x) / len;
    const dz = (to.z - node.z) / len;
    const x = node.x + dx * 12 - dz * 3;
    const z = node.z + dz * 12 + dx * 3;
    if (this.cars.some((c) => Math.hypot(c.vehicle.position.x - x, c.vehicle.position.z - z) < TRAFFIC.spacing)) return;
    const ramp = !this.rampTruck && this.rng.next() < TRAFFIC.rampChance;
    const spec = ramp ? rampTruckSpec() : civilianSpec(this.rng);
    // Drop tall bodies in from a little higher so their wheels land rather than spawn in the road.
    const y = this.ground(x, z) + 1.2 - (spec.wheelY ?? 0);
    const vehicle = new Vehicle(this.world, spec, { x, y, z }, Math.atan2(dx, dz));
    vehicle.tractionAssist = CIVILIAN_TRACTION;
    vehicle.headlights = this.headlights;
    vehicle.beamEnabled = false;
    this.scene.add(vehicle.mesh.root);
    this.cars.push({ vehicle, controller: new CivilianController(vehicle, g, this.controls, this.sense, this.rng, node.id, to.id, this.awareness) });
  }
}
