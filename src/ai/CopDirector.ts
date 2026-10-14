// Spawns, keeps in range and retires cop cars, scaling with the wanted level: how many cops,
// which types, how aggressive, and (4★+) roadblocks on the player's route.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import { FLAT, type GroundHeight } from '../world/Terrain';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS } from '../vehicles/VehicleSpecs';
import { Health } from '../gameplay/Health';
import { DAMAGE, ROADBLOCK_INTERVAL, type CopType, type StarLevel } from '../gameplay/balance';
import { COP_TUNING, CopController, type ChaseTarget, type CopTuning, type LineOfSight } from './CopController';
import type { Keep } from '../world/driveSide';
import type { NavGrid } from './NavGrid';
import { obstacleProbe } from './lineOfSight';
import { SUNK_BELOW } from '../render/Sea';

const UP = new THREE.Vector3(0, 1, 0);
const tmpUp = new THREE.Vector3(); // scratch, for reading a car's up axis

/** Off-road routing and feelers for the cops; without it they keep to the roads and drive blind. */
export interface CopSteering {
  nav: NavGrid;
  /** Colliders the feelers look past: the suspect's car, which cops are meant to hit. */
  ignore: (collider: RAPIER.Collider) => boolean;
}

export interface DirectorTuning {
  firstSpawnDelay: number; // seconds after the mission starts
  spawnMin: number; // metres by road from the player
  spawnMax: number;
  leashDistance: number; // straight-line metres; beyond this a cop is moved back into play
  aheadChance: number; // share of spawns placed on the player's route ahead (to cut them off)
  wreckClearTime: number; // seconds a wrecked cop burns before being removed
  roadblockAhead: [number, number]; // metres along the player's route
  checkpointClear: number; // metres around the current destination where no cop spawns
  cornerSetback: number; // metres down a side street from the junction a hidden cop starts
  startSpeed: number; // m/s a spawned cop is already doing
}

export const DIRECTOR_TUNING: DirectorTuning = {
  firstSpawnDelay: 3,
  spawnMin: 120,
  spawnMax: 260,
  leashDistance: 260,
  wreckClearTime: 5,
  roadblockAhead: [140, 260],
  aheadChance: 0.6,
  checkpointClear: 60,
  cornerSetback: 20,
  startSpeed: 10,
};

const LANE_OFFSET = 3; // in the lane, as civilians drive (kerb side of the centre line)
const SPAWN_TRIES = 16; // candidate junctions tried before giving up on a hidden spot

type Point = { x: number; z: number };
type Spot = { x: number; z: number; yaw: number; speed: number };

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
  private checkpoint: Point | null = null;
  private levelTuning: CopTuning | null = null;

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    private graph: RoadGraph,
    private canSee: LineOfSight,
    private rng: Rng,
    private headlights: number,
    private tuning: DirectorTuning = DIRECTOR_TUNING,
    private ground: GroundHeight = FLAT,
    private keep: Keep = 1,
    private steering: CopSteering | null = null,
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
  update(
    dt: number,
    player: ChaseTarget,
    playerForward: THREE.Vector3,
    level: StarLevel,
    route: number[] | null,
    checkpoint: Point | null,
  ): void {
    this.checkpoint = checkpoint;
    // Roadblocks add cops over the cap; once one falls behind, retire it rather than bring it back,
    // or every roadblock of a long run stays in play for good (and each cop costs physics and AI).
    let excess = this.activeCops.length - level.maxCops;
    const retired: Cop[] = [];
    for (const cop of this.cops) {
      if (cop.vehicle.position.y < SUNK_BELOW) {
        retired.push(cop); // gone into the water, for good
        if (cop.wreckedFor === null) excess--;
        continue;
      }
      if (cop.wreckedFor !== null) {
        cop.wreckedFor += dt;
        continue;
      }
      // Aggression follows the wanted level.
      cop.controller.tuning = this.tuningFor(level);
      // Lost the plot (far away, or on its roof): bring it back into play nearby.
      const p = cop.vehicle.position;
      const up = tmpUp.copy(UP).applyQuaternion(cop.vehicle.quaternion).y;
      cop.flippedFor = up < 0.3 ? cop.flippedFor + dt : 0;
      const far = Math.hypot(p.x - player.position.x, p.z - player.position.z) > this.tuning.leashDistance;
      if (far && excess > 0) {
        retired.push(cop);
        excess--;
      } else if (far || cop.flippedFor > 3) {
        this.place(cop.vehicle, player, playerForward, route, true);
        cop.controller.holdUntilClose = false;
      }
    }
    // Remove burnt-out wrecks, sunk cops and retired ones.
    for (const cop of new Set([...retired, ...this.cops.filter((c) => c.wreckedFor !== null && c.wreckedFor > this.tuning.wreckClearTime)])) {
      cop.vehicle.dispose();
      this.cops.splice(this.cops.indexOf(cop), 1);
    }

    if (this.activeCops.length < level.maxCops) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.place(this.create(pickCopType(level.mix, this.rng.next())).vehicle, player, playerForward, route, this.rng.next() < this.tuning.aheadChance);
        this.spawnTimer = level.spawnInterval;
      }
    }

    if (level.roadblocks && route) {
      this.roadblockTimer -= dt;
      // A roadblock may briefly exceed the cap by its two SUVs.
      if (this.roadblockTimer <= 0 && this.roadblock(player, route)) this.roadblockTimer = ROADBLOCK_INTERVAL;
    }
  }

  /** Cop tuning for a star level, made once per level rather than per cop every frame. */
  private tuningFor(level: StarLevel): CopTuning {
    const t = this.levelTuning;
    if (t?.chaseRange !== level.chaseRange || t.catchUp !== level.catchUp) {
      this.levelTuning = { ...COP_TUNING, chaseRange: level.chaseRange, catchUp: level.catchUp };
    }
    return this.levelTuning!;
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
      controller: new CopController(
        vehicle,
        this.graph,
        this.canSee,
        COP_TUNING,
        this.steering?.nav ?? null,
        this.steering ? obstacleProbe(this.world, vehicle.body, this.steering.ignore, this.ground) : null,
      ),
      health: new Health({ ...DAMAGE, maxHealth: COP_SPECS[type].maxHealth ?? DAMAGE.maxHealth }),
      wreckedFor: null,
      flippedFor: 0,
    };
    this.cops.push(cop);
    return cop;
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
      if (this.nearCheckpoint(node)) continue;
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
        const x = cx + -dz * side * 3;
        const z = cz + dx * side * 3;
        cop.vehicle.teleport(x, this.ground(x, z) + 1.2, z, across + (side > 0 ? Math.PI : 0));
        cop.controller.holdUntilClose = true;
      }
      return true;
    }
    return false;
  }

  private nearCheckpoint(p: Point): boolean {
    const c = this.checkpoint;
    return c !== null && Math.hypot(p.x - c.x, p.z - c.z) < this.tuning.checkpointClear;
  }

  private occupied(p: Point): boolean {
    return this.activeCops.some((c) => Math.hypot(c.vehicle.position.x - p.x, c.vehicle.position.z - p.z) < 12);
  }

  /** Route junctions 120–260m ahead of the player, each with the next junction back toward them. */
  private routeCandidates(player: ChaseTarget, route: number[]): { node: number; toward: number }[] {
    const g = this.graph;
    let along = 0;
    let prev: Point = player.position;
    const out: { node: number; toward: number }[] = [];
    for (let i = 0; i < route.length; i++) {
      const node = g.nodes[route[i]];
      along += Math.hypot(node.x - prev.x, node.z - prev.z);
      if (along > this.tuning.spawnMax) break;
      if (along >= this.tuning.spawnMin && i > 0) out.push({ node: node.id, toward: route[i - 1] });
      prev = node;
    }
    return out;
  }

  /**
   * Hidden spawn at a junction: a little way down a side street (not the road leading to the
   * player), in its lane, rolling toward the corner — out of the player's line of
   * sight, never near the destination. Null if every side street is visible, taken or too close.
   */
  private aroundCorner(nodeId: number, towardId: number, player: ChaseTarget): Spot | null {
    const g = this.graph;
    const node = g.nodes[nodeId];
    if (this.nearCheckpoint(node)) return null;
    const sides = node.neighbors.filter((id) => id !== towardId);
    for (const sideId of this.shuffle(sides)) {
      const side = g.nodes[sideId];
      const len = Math.hypot(side.x - node.x, side.z - node.z);
      const back = this.tuning.cornerSetback;
      if (len < back * 2) continue; // short street: would start inside the next junction
      // Drive from the side street toward the junction.
      const fx = (node.x - side.x) / len;
      const fz = (node.z - side.z) / len;
      const spot = {
        x: node.x - fx * back + -fz * LANE_OFFSET * this.keep,
        z: node.z - fz * back + fx * LANE_OFFSET * this.keep,
        yaw: Math.atan2(fx, fz),
        speed: this.tuning.startSpeed,
      };
      if (this.nearCheckpoint(spot) || this.occupied(spot)) continue;
      if (this.canSee(player.position, new THREE.Vector3(spot.x, 0, spot.z))) continue;
      return spot;
    }
    return null;
  }

  private shuffle<T>(list: T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Put a cop 120–260m from the player by road, hidden around a corner and already moving.
   * `ahead`: on the player's GPS route toward their destination, to cut them off; otherwise
   * preferably behind them. Falls back to a junction (still away from the destination) if no
   * hidden spot exists.
   */
  private place(vehicle: Vehicle, player: ChaseTarget, playerForward: THREE.Vector3, route: number[] | null, ahead: boolean): void {
    const g = this.graph;
    const from = g.nearest(player.position.x, player.position.z);
    const towardPlayer = (id: number) => {
      const path = g.path(id, from.id);
      return path && path.length > 1 ? path[1] : from.id;
    };
    const dist = g.distancesFrom(from.id);
    const inRange = g.nodes.filter((n) => dist[n.id] >= this.tuning.spawnMin && dist[n.id] <= this.tuning.spawnMax);
    const behind = inRange.filter(
      (n) => (n.x - player.position.x) * playerForward.x + (n.z - player.position.z) * playerForward.z < 0,
    );
    const elsewhere = [...this.shuffle(behind), ...this.shuffle(inRange.filter((n) => !behind.includes(n)))];
    const candidates = [
      ...(ahead && route ? this.shuffle(this.routeCandidates(player, route)) : []),
      ...elsewhere.slice(0, SPAWN_TRIES).map((n) => ({ node: n.id, toward: -1 })),
    ];
    for (const c of candidates) {
      const spot = this.aroundCorner(c.node, c.toward >= 0 ? c.toward : towardPlayer(c.node), player);
      if (spot) {
        vehicle.teleport(spot.x, this.ground(spot.x, spot.z) + 1.2, spot.z, spot.yaw, spot.speed);
        return;
      }
    }
    // Nowhere hidden: a free junction in range, away from the destination, facing the player.
    const ok = (n: (typeof g.nodes)[number]) => !this.occupied(n) && !this.nearCheckpoint(n);
    const pool = [behind.filter(ok), inRange.filter(ok), inRange, g.nodes.filter((n) => n.neighbors.length)].find((l) => l.length)!;
    const node = this.rng.pick(pool);
    const next = g.nodes[towardPlayer(node.id)];
    vehicle.teleport(node.x, this.ground(node.x, node.z) + 1.2, node.z, Math.atan2(next.x - node.x, next.z - node.z));
  }
}
