// Cop driving brain: turns "where is the suspect" into a DriveInput for the same Vehicle physics
// the player uses.
//   navigate — follow the road graph toward the suspect, slowing for corners
//   chase    — line of sight: drive at where the suspect will be (lead pursuit)
//   ram      — close: floor it at the suspect
//   recover  — stuck: reverse out with opposite lock, then carry on
//   backoff  — rammed into the suspect and pinned against them: reverse a few metres, ram again
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { RoadGraph } from '../world/RoadGraph';
import type { Vehicle } from '../vehicles/Vehicle';
import { cornerSpeedLimit, purePursuit, turnAngle } from './pursuit';

export type CopState = 'navigate' | 'chase' | 'ram' | 'recover' | 'backoff';

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
  /** Pinned against the suspect (this close, under 2 m/s closing speed) for pinTime → back off for backoffTime, then ram again. */
  pinRange: number;
  pinTime: number;
  backoffTime: number;
  runUpTime: number; // after backing off, seconds of charging before we can count as pinned again
  /** Extra speed allowance when far behind (rubber-banding), as a multiplier at 300m+. */
  catchUp: number;
  /** Above this speed (m/s) the route never doubles back: we carry on to the next junction. */
  uTurnSpeed: number;
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
  pinRange: 8,
  pinTime: 0.3,
  backoffTime: 1.0,
  runUpTime: 1.0,
  catchUp: 1.15,
  uTurnSpeed: 8,
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
  private pinnedFor = 0;
  private backoffFor = 0;
  private runUpFor = 0; // after backing off: charging back in, not pinned yet
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

    // Backing off for another run at the suspect: straight back, then straight back into ram.
    if (this.state === 'backoff') {
      this.backoffFor -= dt;
      if (this.backoffFor > 0) return { throttle: 0, brake: 1, steer: 0, handbrake: false };
      this.state = 'ram';
      this.runUpFor = t.runUpTime;
    }
    this.runUpFor = Math.max(0, this.runUpFor - dt);

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

    // Pinned (close and no longer closing in: stopped against the suspect, or shoving them
    // along): don't just push — back off and hit them again.
    const lv = v.body.linvel();
    const closing = Math.hypot(lv.x - target.velocity.x, lv.z - target.velocity.z);
    if (this.state === 'ram' && this.runUpFor === 0 && dist < t.pinRange && closing < 2) this.pinnedFor += dt;
    else this.pinnedFor = 0;
    if (this.pinnedFor > t.pinTime) {
      this.state = 'backoff';
      this.backoffFor = t.backoffTime;
      this.pinnedFor = 0;
      this.stuckFor = 0;
      return { throttle: 0, brake: 1, steer: 0, handbrake: false };
    }

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
    const speed = Math.abs(this.vehicle.speed);
    this.segment = purePursuit(this.path, this.segment, pos, t.lookahead + t.lookaheadPerSpeed * speed, this.aim).segment;
    return cornerSpeedLimit(this.path, this.segment, pos, speed, t.cornerSpeed, t.brakeDecel);
  }

  /** Route: our position → road nodes → the suspect. */
  private replan(target: ChaseTarget): void {
    const v = this.vehicle;
    this.path = planRoute(this.graph, v.position, v.forward(this.tmp), Math.abs(v.speed), target.position, this.tuning);
    this.segment = 0;
  }
}

type P = { x: number; z: number };

/**
 * Road route from `pos` to `target` (start, junctions, target) for a car heading along `heading`
 * at `speed`. A fast car can't double back or make a turn it's too close to brake for, so then
 * the route starts at the junction ahead, never heads back the way we came, and if the first
 * turn can't be made it carries straight on through that junction and turns at the next.
 */
export function planRoute(
  g: RoadGraph,
  pos: P,
  heading: P,
  speed: number,
  target: P,
  t: Pick<CopTuning, 'cornerSpeed' | 'brakeDecel' | 'uTurnSpeed'>,
): THREE.Vector3[] {
  const dist = (p: P, q: P) => Math.hypot(p.x - q.x, p.z - q.z);
  // Finish at whichever end of the suspect's road gives the shorter way in.
  const there = g.nearestEdge(target.x, target.z);
  const goals = there.off < 15 ? [there.a, there.b] : [g.nearest(target.x, target.z)];
  /** Cheapest node sequence starting with `lead`, then on (no U-turn back to `noUTurnFrom`) to the suspect. */
  const route = (lead: number[], noUTurnFrom?: number): { ids: number[]; cost: number } => {
    let best = { ids: [...lead], cost: Infinity };
    for (const goal of goals) {
      const rest = g.path(lead[lead.length - 1], goal.id, noUTurnFrom);
      if (!rest) continue;
      const ids = [...lead, ...rest.slice(1)];
      const cost = dist(pos, g.nodes[ids[0]]) + g.pathLength(ids) + dist(goal, target);
      if (cost < best.cost) best = { ids, cost };
    }
    return best;
  };

  const here = g.nearestEdge(pos.x, pos.z);
  let ids: number[];
  if (here.off > 10) {
    ids = route([g.nearest(pos.x, pos.z).id]).ids; // off the road grid (plaza, park): nearest junction
  } else if (speed <= t.uTurnSpeed) {
    // Slow enough to turn round: start from whichever end of our road is the better way.
    const viaA = route([here.a.id]);
    const viaB = route([here.b.id]);
    ids = (viaA.cost <= viaB.cost ? viaA : viaB).ids;
  } else {
    const forwardIsB = (here.b.x - here.a.x) * heading.x + (here.b.z - here.a.z) * heading.z >= 0;
    const ahead = forwardIsB ? here.b : here.a;
    const behind = forwardIsB ? here.a : here.b;
    ids = route([ahead.id], behind.id).ids;
    // Too fast to make the first turn (onto the next road, or toward the suspect if they're on
    // it)? Go straight through and turn at the next junction.
    const next = ids.length > 1 ? g.nodes[ids[1]] : target;
    if (dist(ahead, next) > 1) {
      const turn = Math.abs(turnAngle(pos, ahead, next));
      const brakeDistance = (speed * speed - t.cornerSpeed * t.cornerSpeed) / (2 * t.brakeDecel);
      if (turn > 0.5 && brakeDistance > dist(pos, ahead) + 4) {
        const straight = ahead.neighbors
          .map((id) => g.nodes[id])
          .find((n) => Math.abs(turnAngle(pos, ahead, n)) < 0.35);
        if (straight) ids = route([ahead.id, straight.id], ahead.id).ids;
      }
    }
  }
  return [
    new THREE.Vector3(pos.x, 0, pos.z),
    ...ids.map((id) => new THREE.Vector3(g.nodes[id].x, 0, g.nodes[id].z)),
    new THREE.Vector3(target.x, 0, target.z),
  ];
}
