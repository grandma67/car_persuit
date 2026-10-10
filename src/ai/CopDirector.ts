// Spawns, keeps in range and retires cop cars, scaling with the wanted level: how many cops,
// which types, how aggressive, and (4★+) roadblocks on the player's route.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS } from '../vehicles/VehicleSpecs';
import { Health } from '../gameplay/Health';
import { DAMAGE, ROADBLOCK_INTERVAL, type CopType, type StarLevel } from '../gameplay/balance';
import { COP_TUNING, CopController, type ChaseTarget, type LineOfSight } from './CopController';

export interface DirectorTuning {
  firstSpawnDelay: number; // seconds after the mission starts
  spawnMin: number; // metres by road from the player
  spawnMax: number;
  leashDistance: number; // straight-line metres; beyond this a cop is moved closer
  wreckClearTime: number; // seconds a wrecked cop burns before being removed
  roadblockAhead: [number, number]; // metres along the player's route
}

export const DIRECTOR_TUNING: DirectorTuning = {
  firstSpawnDelay: 4,
  spawnMin: 150,
  spawnMax: 300,
  leashDistance: 450,
  wreckClearTime: 5,
  roadblockAhead: [140, 260],
};

export interface Cop {
  type: CopType;
  vehicle: Vehicle;
  controller: CopController;
  health: Health;
  wreckedFor: number | null; // seconds since wrecked, null while active
  flippedFor: number;
}

/** Weighted pick from a spawn mix. */
export function pickCopType(mix: Partial<Record<CopType, number>>, roll: number): CopType {
  const entries = Object.entries(mix) as [CopType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = roll * total;
  for (const [type, w] of entries) {
    if (r < w) return type;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

export class CopDirector {
  readonly cops: Cop[] = [];
  private spawnTimer: number;
  private roadblockTimer = 10;

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

  /**
   * Housekeeping once per frame: spawning to the star level's cap, roadblocks, leash, clearing
   * wrecks. `route` is the player's GPS route (node ids) for roadblock placement.
   */
  update(dt: number, player: ChaseTarget, playerForward: THREE.Vector3, level: StarLevel, route: number[] | null): void {
    for (const cop of this.cops) {
      if (cop.wreckedFor !== null) {
        cop.wreckedFor += dt;
        continue;
      }
      // Aggression follows the wanted level.
      cop.controller.tuning = { ...COP_TUNING, chaseRange: level.chaseRange, catchUp: level.catchUp };
      // Lost the plot (far away, or on its roof): bring it back into play nearby.
      const p = cop.vehicle.position;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cop.vehicle.quaternion).y;
      cop.flippedFor = up < 0.3 ? cop.flippedFor + dt : 0;
      const far = Math.hypot(p.x - player.position.x, p.z - player.position.z) > this.tuning.leashDistance;
      if (far || cop.flippedFor > 3) {
        this.place(cop.vehicle, player, playerForward);
        cop.controller.holdUntilClose = false;
      }
    }
    // Remove burnt-out wrecks.
    for (const cop of this.cops.filter((c) => c.wreckedFor !== null && c.wreckedFor > this.tuning.wreckClearTime)) {
      cop.vehicle.dispose();
      this.cops.splice(this.cops.indexOf(cop), 1);
    }

    if (this.activeCops.length < level.maxCops) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(pickCopType(level.mix, this.rng.next()), player, playerForward);
        this.spawnTimer = level.spawnInterval;
      }
    }

    if (level.roadblocks && route) {
      this.roadblockTimer -= dt;
      // A roadblock may briefly exceed the cap by its two SUVs.
      if (this.roadblockTimer <= 0 && this.roadblock(player, route)) this.roadblockTimer = ROADBLOCK_INTERVAL;
    }
  }

  wreck(cop: Cop): void {
    cop.wreckedFor = 0;
    cop.vehicle.lightsOff = true;
  }

  private create(type: CopType): Cop {
    const vehicle = new Vehicle(this.world, COP_SPECS[type], { x: 0, y: -50, z: 0 });
    vehicle.headlights = this.headlights;
    vehicle.beamEnabled = false; // glowing lamps only — ten spotlights would cost too much
    this.scene.add(vehicle.mesh.root);
    const cop: Cop = {
      type,
      vehicle,
      controller: new CopController(vehicle, this.graph, this.canSee),
      health: new Health({ ...DAMAGE, maxHealth: COP_SPECS[type].maxHealth ?? DAMAGE.maxHealth }),
      wreckedFor: null,
      flippedFor: 0,
    };
    this.cops.push(cop);
    return cop;
  }

  private spawn(type: CopType, player: ChaseTarget, playerForward: THREE.Vector3): void {
    this.place(this.create(type).vehicle, player, playerForward);
  }

  /**
   * Two SUVs parked across a road on the player's route, 140–260m ahead. They wait until the
   * player is close before joining the chase. Returns false if no suitable spot.
   */
  private roadblock(player: ChaseTarget, route: number[]): boolean {
    const g = this.graph;
    let along = 0;
    let prev = { x: player.position.x, z: player.position.z };
    for (let i = 0; i < route.length - 1; i++) {
      const node = g.nodes[route[i]];
      along += Math.hypot(node.x - prev.x, node.z - prev.z);
      prev = node;
      if (along < this.tuning.roadblockAhead[0]) continue;
      if (along > this.tuning.roadblockAhead[1]) return false;
      // Block the road leaving this node toward the next one, a little past the junction.
      const next = g.nodes[route[i + 1]];
      const len = Math.hypot(next.x - node.x, next.z - node.z);
      const dx = (next.x - node.x) / len;
      const dz = (next.z - node.z) / len;
      const cx = node.x + dx * 20;
      const cz = node.z + dz * 20;
      const across = Math.atan2(-dz, dx); // perpendicular to the road
      for (const side of [-1, 1]) {
        const cop = this.create('suv');
        cop.vehicle.teleport(cx + -dz * side * 3, 1.2, cz + dx * side * 3, across + (side > 0 ? Math.PI : 0));
        cop.controller.holdUntilClose = true;
      }
      return true;
    }
    return false;
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
    // Don't stack spawns on top of each other.
    const free = (list: typeof inRange) =>
      list.filter((n) => this.activeCops.every((c) => Math.hypot(c.vehicle.position.x - n.x, c.vehicle.position.z - n.z) > 12));
    const pool = [free(behind), free(inRange), behind, inRange, g.nodes].find((l) => l.length)!;
    const node = this.rng.pick(pool);
    // Face along the first road toward the player.
    const route = g.path(node.id, from.id);
    const next = route && route.length > 1 ? g.nodes[route[1]] : from;
    const yaw = Math.atan2(next.x - node.x, next.z - node.z);
    vehicle.teleport(node.x, 1.2, node.z, yaw);
  }
}
