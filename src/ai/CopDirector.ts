// Spawns, keeps in range and retires cop cars. M4: a single patrol car; M5 scales this with the
// wanted level.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_PATROL_SPEC } from '../vehicles/VehicleSpecs';
import { Health } from '../gameplay/Health';
import { CopController, type ChaseTarget, type LineOfSight } from './CopController';

export interface DirectorTuning {
  maxCops: number;
  firstSpawnDelay: number; // seconds after the mission starts
  respawnDelay: number; // after a cop is wrecked
  spawnMin: number; // metres by road from the player
  spawnMax: number;
  leashDistance: number; // straight-line metres; beyond this a cop is moved closer
  wreckClearTime: number; // seconds a wrecked cop burns before being removed
}

export const DIRECTOR_TUNING: DirectorTuning = {
  maxCops: 1,
  firstSpawnDelay: 4,
  respawnDelay: 8,
  spawnMin: 150,
  spawnMax: 300,
  leashDistance: 450,
  wreckClearTime: 5,
};

export interface Cop {
  vehicle: Vehicle;
  controller: CopController;
  health: Health;
  wreckedFor: number | null; // seconds since wrecked, null while active
  flippedFor: number;
}

export class CopDirector {
  readonly cops: Cop[] = [];
  private spawnTimer: number;

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    private graph: RoadGraph,
    private canSee: LineOfSight,
    private rng: Rng,
    private headlights: number,
    private tuning: DirectorTuning = DIRECTOR_TUNING,
  ) {
    this.spawnTimer = tuning.firstSpawnDelay;
  }

  get activeCops(): Cop[] {
    return this.cops.filter((c) => c.wreckedFor === null);
  }

  /** Housekeeping once per frame: spawning, leash, clearing wrecks. */
  update(dt: number, player: ChaseTarget, playerForward: THREE.Vector3): void {
    for (const cop of this.cops) {
      if (cop.wreckedFor !== null) {
        cop.wreckedFor += dt;
        continue;
      }
      const p = cop.vehicle.position;
      // Lost the plot (far away, or on its roof): bring it back into play nearby.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cop.vehicle.quaternion).y;
      cop.flippedFor = up < 0.3 ? cop.flippedFor + dt : 0;
      const far = Math.hypot(p.x - player.position.x, p.z - player.position.z) > this.tuning.leashDistance;
      if (far || cop.flippedFor > 3) this.place(cop.vehicle, player, playerForward);
    }
    // Remove burnt-out wrecks.
    for (const cop of this.cops.filter((c) => c.wreckedFor !== null && c.wreckedFor > this.tuning.wreckClearTime)) {
      cop.vehicle.dispose();
      this.cops.splice(this.cops.indexOf(cop), 1);
    }

    if (this.activeCops.length < this.tuning.maxCops) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(player, playerForward);
        this.spawnTimer = this.tuning.respawnDelay;
      }
    }
  }

  wreck(cop: Cop): void {
    cop.wreckedFor = 0;
    cop.vehicle.lightsOff = true;
  }

  private spawn(player: ChaseTarget, playerForward: THREE.Vector3): void {
    const vehicle = new Vehicle(this.world, COP_PATROL_SPEC, { x: 0, y: -50, z: 0 });
    vehicle.headlights = this.headlights;
    this.place(vehicle, player, playerForward);
    this.scene.add(vehicle.mesh.root);
    this.cops.push({
      vehicle,
      controller: new CopController(vehicle, this.graph, this.canSee),
      health: new Health(),
      wreckedFor: null,
      flippedFor: 0,
    });
  }

  /** Put a cop on a road 150–300m from the player by road, preferably behind them, facing them. */
  private place(vehicle: Vehicle, player: ChaseTarget, playerForward: THREE.Vector3): void {
    const g = this.graph;
    const from = g.nearest(player.position.x, player.position.z);
    const dist = g.distancesFrom(from.id);
    const inRange = g.nodes.filter((n) => dist[n.id] >= this.tuning.spawnMin && dist[n.id] <= this.tuning.spawnMax);
    const behind = inRange.filter(
      (n) => (n.x - player.position.x) * playerForward.x + (n.z - player.position.z) * playerForward.z < 0,
    );
    const pool = behind.length ? behind : inRange.length ? inRange : g.nodes;
    const node = this.rng.pick(pool);
    // Face along the first road toward the player.
    const route = g.path(node.id, from.id);
    const next = route && route.length > 1 ? g.nodes[route[1]] : from;
    const yaw = Math.atan2(next.x - node.x, next.z - node.z);
    vehicle.teleport(node.x, 1.2, node.z, yaw);
  }
}
