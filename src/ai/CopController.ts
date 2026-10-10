// Cop driving brain: turns "where is the suspect" into a DriveInput for the same Vehicle physics
// the player uses.
//   navigate — follow the road graph toward the suspect, slowing for corners
//   chase    — line of sight: drive at where the suspect will be (lead pursuit)
//   ram      — close: floor it at the suspect
//   recover  — stuck: reverse out with opposite lock, then carry on
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { RoadGraph } from '../world/RoadGraph';
import type { Vehicle } from '../vehicles/Vehicle';

export type CopState = 'navigate' | 'chase' | 'ram' | 'recover';

export interface ChaseTarget {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

/** Can a cop at `from` see `to`? (Raycast against buildings; injected so tests can supply it.) */
export type LineOfSight = (from: THREE.Vector3, to: THREE.Vector3) => boolean;

export interface CopTuning {
  chaseRange: number; // metres: switch from roads to direct pursuit when visible
  ramRange: number;
  cornerSpeed: number; // m/s through a turn
  brakeDecel: number; // m/s², used to plan slowing before corners
  lookahead: number; // metres of road ahead to aim at (pure pursuit), plus lookaheadPerSpeed × speed
  lookaheadPerSpeed: number;
  repathInterval: number; // seconds
  sightInterval: number;
  stuckTime: number; // seconds near-stationary while trying to drive before recovering
  recoverTime: number; // max seconds reversing; stops earlier once pointing the right way
  recoverMin: number;
  /** Extra speed allowance when far behind (rubber-banding), as a multiplier at 300m+. */
  catchUp: number;
}

export const COP_TUNING: CopTuning = {
  chaseRange: 90,
  ramRange: 18,
  cornerSpeed: 12,
  brakeDecel: 7, // a margin under the ~10 m/s² the car can actually do
  lookahead: 5,
  lookaheadPerSpeed: 0.45,
  repathInterval: 0.8,
  sightInterval: 0.2,
  stuckTime: 1.2,
  recoverTime: 2.5,
  recoverMin: 0.8,
  catchUp: 1.15,
};

const NO_INPUT: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export class CopController {
  state: CopState = 'navigate';
  /** Roadblock: sit still until the suspect is close, then join the chase. */
  holdUntilClose = false;
  private path: THREE.Vector3[] = [];
  private segment = 0; // index of the path segment we're on
  private roadOnlyFor = 0; // after recovering, follow the road rather than aiming straight at the target
  private repathTimer = 0;
  private sightTimer = 0;
  private seesTarget = false;
  private stuckFor = 0;
  private recoverFor = 0;
  private recoverSteer = 1;
  private aim = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(
    readonly vehicle: Vehicle,
    private graph: RoadGraph,
    private canSee: LineOfSight,
    public tuning: CopTuning = COP_TUNING,
  ) {}

  /** Call once per physics step, before vehicle.drive(). */
  update(dt: number, target: ChaseTarget): DriveInput {
    const t = this.tuning;
    const v = this.vehicle;
    const pos = v.position;
    const speed = v.speed;
    const dist = Math.hypot(target.position.x - pos.x, target.position.z - pos.z);
    if (this.holdUntilClose) {
      if (dist > 35) return { ...NO_INPUT, brake: Math.abs(speed) > 1 ? 1 : 0 };
      this.holdUntilClose = false;
    }

    if (this.state === 'recover') {
      this.recoverFor += dt;
      // Reverse until the nose points roughly where we want to go (or we give up waiting).
      const aimAngle = this.angleTo(this.aim, this.vehicle.forward(this.tmp));
      const aligned = this.recoverFor > t.recoverMin && Math.abs(aimAngle) < 0.45;
      if (!aligned && this.recoverFor < t.recoverTime) {
        // Reversing with the wheels turned one way swings the nose the other way.
        this.recoverSteer = -Math.sign(aimAngle) || this.recoverSteer;
        return { throttle: 0, brake: 1, steer: this.recoverSteer, handbrake: false };
      }
      this.state = 'navigate';
      this.repathTimer = 0;
      this.roadOnlyFor = 1.5;
    }
    this.roadOnlyFor = Math.max(0, this.roadOnlyFor - dt);

    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = t.sightInterval;
      this.seesTarget = dist < t.chaseRange && this.canSee(pos, target.position);
    }

    // Pick where to steer. Direct pursuit only when the suspect is visible and roughly ahead;
    // otherwise (or if they've just ducked round a corner) follow the road.
    let desiredSpeed = v.spec.maxSpeed * THREE.MathUtils.lerp(1, t.catchUp, THREE.MathUtils.clamp((dist - 100) / 200, 0, 1));
    const fwd = v.forward(this.tmp);
    const direct = this.seesTarget && this.roadOnlyFor === 0;
    if (direct && dist < t.ramRange) {
      this.state = 'ram';
      this.aim.copy(target.position).addScaledVector(target.velocity, 0.25);
    } else if (direct) {
      this.state = 'chase';
      const lead = THREE.MathUtils.clamp(dist / Math.max(Math.abs(speed), 10), 0, 1);
      this.aim.copy(target.position).addScaledVector(target.velocity, lead);
    }
    if (!direct || (this.state === 'chase' && Math.abs(this.angleTo(this.aim, fwd)) > 0.9)) {
      this.state = 'navigate';
      desiredSpeed = Math.min(desiredSpeed, this.followPath(dt, target));
    } else {
      this.repathTimer = 0; // replan when we drop back to road following
    }

    // Steering toward the aim point, in the car's frame.
    const angle = this.angleTo(this.aim, fwd);
    const steer = THREE.MathUtils.clamp(angle * 2.2, -1, 1);

    // Big heading errors need a slower car to turn in.
    if (Math.abs(angle) > 0.6) desiredSpeed = Math.min(desiredSpeed, t.cornerSpeed);

    const input: DriveInput = { ...NO_INPUT, steer };
    if (speed < desiredSpeed - 0.5) input.throttle = 1;
    else if (speed > desiredSpeed + 3 && speed > 2) input.brake = 1;
    // Power-slide round tight turns at speed, like a pursuit driver would.
    input.handbrake = Math.abs(angle) > 1.1 && speed > 16;

    // Stuck: trying to drive but not moving.
    if (input.throttle > 0 && Math.abs(speed) < 1.5) this.stuckFor += dt;
    else this.stuckFor = Math.max(0, this.stuckFor - dt);
    if (this.stuckFor > t.stuckTime) {
      this.state = 'recover';
      this.recoverFor = 0;
      this.recoverSteer = -(Math.sign(angle) || 1);
      this.stuckFor = 0;
      return { throttle: 0, brake: 1, steer: this.recoverSteer, handbrake: false };
    }
    return input;
  }

  /** Signed angle (radians, + = right) from the car's heading to a point. */
  private angleTo(p: THREE.Vector3, fwd: THREE.Vector3): number {
    const pos = this.vehicle.position;
    const toX = p.x - pos.x;
    const toZ = p.z - pos.z;
    return Math.atan2(toX * -fwd.z + toZ * fwd.x, toX * fwd.x + toZ * fwd.z); // right of travel is (-fz, fx)
  }

  /**
   * Pure pursuit along the road route: aim at a point a little way ahead of our closest point on
   * the route's centre line. Drifting off the road pulls the aim back onto it, so the cop never
   * steers at an intersection hidden behind a building. Returns the speed allowed by the next corner.
   */
  private followPath(dt: number, target: ChaseTarget): number {
    const t = this.tuning;
    const pos = this.vehicle.position;
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.path.length < 2) {
      this.repathTimer = t.repathInterval;
      this.replan(target);
    }
    const path = this.path;

    // Closest point on the next couple of segments (never search backwards).
    let best = Infinity;
    let bestSeg = this.segment;
    let bestT = 0;
    for (let i = this.segment; i < Math.min(path.length - 1, this.segment + 3); i++) {
      const a = path[i];
      const b = path[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const u = THREE.MathUtils.clamp(((pos.x - a.x) * abx + (pos.z - a.z) * abz) / len2, 0, 1);
      const d = Math.hypot(a.x + abx * u - pos.x, a.z + abz * u - pos.z);
      if (d < best) {
        best = d;
        bestSeg = i;
        bestT = u;
      }
    }
    this.segment = bestSeg;

    // Walk the lookahead distance along the route from there.
    let remaining = t.lookahead + t.lookaheadPerSpeed * Math.abs(this.vehicle.speed);
    let i = bestSeg;
    let u = bestT;
    for (;;) {
      const a = path[i];
      const b = path[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const left = segLen * (1 - u);
      if (remaining <= left || i + 2 >= path.length) {
        const f = Math.min(1, u + remaining / (segLen || 1));
        this.aim.set(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f);
        break;
      }
      remaining -= left;
      i++;
      u = 0;
      // Don't let the aim wrap far round a sharp bend, or we'd cut the corner into a building.
      const p0 = path[i - 1];
      const p1 = path[i];
      const p2 = path[i + 1];
      const turn = Math.abs(
        Math.atan2((p1.x - p0.x) * (p2.z - p1.z) - (p1.z - p0.z) * (p2.x - p1.x), (p1.x - p0.x) * (p2.x - p1.x) + (p1.z - p0.z) * (p2.z - p1.z)),
      );
      if (turn > 0.5) remaining = Math.min(remaining, 4);
    }

    // Slow for every sharp turn within braking distance so we can make it.
    const speed = Math.abs(this.vehicle.speed);
    const horizon = (speed * speed) / (2 * t.brakeDecel) + 30;
    let allowed = Infinity;
    let along = Math.hypot(path[bestSeg + 1].x - pos.x, path[bestSeg + 1].z - pos.z);
    for (let k = bestSeg + 1; k + 1 < path.length && along < horizon; k++) {
      const a = path[k - 1];
      const corner = path[k];
      const after = path[k + 1];
      const inX = corner.x - a.x;
      const inZ = corner.z - a.z;
      const outX = after.x - corner.x;
      const outZ = after.z - corner.z;
      const turn = Math.abs(Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ));
      if (turn > 0.5) allowed = Math.min(allowed, Math.sqrt(t.cornerSpeed ** 2 + 2 * t.brakeDecel * Math.max(0, along - 8)));
      along += Math.hypot(outX, outZ);
    }
    return allowed;
  }

  /** Route: our position → road nodes → the suspect. */
  private replan(target: ChaseTarget): void {
    const pos = this.vehicle.position;
    const g = this.graph;
    const start = g.nearest(pos.x, pos.z);
    const goal = g.nearest(target.position.x, target.position.z);
    const ids = g.path(start.id, goal.id) ?? [goal.id];
    const pts = ids.map((id) => new THREE.Vector3(g.nodes[id].x, 0, g.nodes[id].z));
    // If we're on the road from the nearest node toward the next one (between them, near the
    // centre line), that road is the first leg: start the route at the node behind us.
    // Otherwise start from where we are.
    let first = pos.clone().setY(0);
    if (pts.length > 1) {
      const [a, b] = pts;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len = Math.hypot(abx, abz) || 1;
      const u = ((pos.x - a.x) * abx + (pos.z - a.z) * abz) / (len * len);
      const off = Math.abs((pos.x - a.x) * abz - (pos.z - a.z) * abx) / len;
      if (u > 0 && u < 1 && off < 8) first = pts.shift()!;
    }
    this.path = [first, ...pts, target.position.clone().setY(0)];
    this.segment = 0;
  }
}
