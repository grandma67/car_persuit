// Sparse civilian traffic around the player: enough to weave through, never a wall. Cars are
// recycled — despawned when far behind or stuck, respawned on roads out of sight nearby.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import type { ApproachControl } from '../world/TrafficControl';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC, COP_SUV_SPEC, type VehicleSpec } from '../vehicles/VehicleSpecs';
import { CivilianController, type ForwardSensor } from './CivilianController';

export const TRAFFIC = {
  count: 10,
  spawnMin: 90, // metres by road from the player
  spawnMax: 260,
  despawnDistance: 330, // straight-line
  stuckLimit: 6, // seconds
};

// Everyday car colours.
const COLORS = [0xc9ccd1, 0xf0f0ee, 0x1c1e22, 0x24345a, 0x6e1a1f, 0x5b6068, 0xb8a98c, 0x2f4a3a, 0x8a8f96, 0x3a5f8a];

function civilianSpec(rng: Rng): VehicleSpec {
  const roll = rng.next();
  const color = rng.pick(COLORS);
  const base: VehicleSpec =
    roll < 0.6
      ? { ...PLAYER_SPEC, body: 'sedan' }
      : roll < 0.85
        ? { ...COP_SUV_SPEC, livery: undefined, maxHealth: undefined, engineForce: 5000 }
        : { ...PLAYER_SPEC, body: 'sports' };
  return { ...base, name: 'Civilian', color, livery: undefined, engineForce: Math.min(base.engineForce, 3200 * (base.mass / 1200)), maxSpeed: 20 };
}

export interface Civilian {
  vehicle: Vehicle;
  controller: CivilianController;
}

export class CivilianTraffic {
  readonly cars: Civilian[] = [];
  private sense: ForwardSensor;

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    private graph: RoadGraph,
    private controls: Map<string, ApproachControl>,
    private rng: Rng,
    private headlights: number,
  ) {
    // Forward sensor: a ray from the front bumper that only sees moving bodies (cars), so
    // buildings at junction corners don't make drivers brake.
    this.sense = (vehicle, range) => {
      const p = vehicle.position;
      const f = vehicle.forward();
      const start = vehicle.spec.halfExtents.z + 0.3;
      const ray = new RAPIER.Ray({ x: p.x + f.x * start, y: p.y + 0.1, z: p.z + f.z * start }, { x: f.x, y: 0, z: f.z });
      const hit = this.world.castRay(ray, range, true, RAPIER.QueryFilterFlags.EXCLUDE_FIXED, undefined, vehicle.collider, vehicle.body);
      return hit ? hit.timeOfImpact : Infinity;
    };
  }

  /** Fill to the target count around the player, recycle far/stuck cars. Once per frame. */
  update(playerPos: THREE.Vector3): void {
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
    if (this.cars.length < TRAFFIC.count) this.spawn(playerPos);
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
    if (this.cars.some((c) => Math.hypot(c.vehicle.position.x - x, c.vehicle.position.z - z) < 10)) return;
    const vehicle = new Vehicle(this.world, civilianSpec(this.rng), { x, y: 1.2, z }, Math.atan2(dx, dz));
    vehicle.headlights = this.headlights;
    vehicle.beamEnabled = false;
    this.scene.add(vehicle.mesh.root);
    this.cars.push({ vehicle, controller: new CivilianController(vehicle, g, this.controls, this.sense, this.rng, node.id, to.id) });
  }
}
