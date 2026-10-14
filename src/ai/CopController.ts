// Cop driving brain: turns "where is the suspect" into a DriveInput for the same Vehicle physics
// the player uses.
//   navigate — follow the road graph toward the suspect, slowing for corners
//   chase    — line of sight: drive at where the suspect will be (lead pursuit)
//   ram      — close: floor it at the suspect
//   recover  — stuck: reverse out with opposite lock, then carry on
//   backoff  — rammed into the suspect and pinned against them: reverse a few metres, ram again
// Off the road network (suspect or cop in a park, square or plaza) the route comes from the
// NavGrid instead, round statues, planters and trees; and in every state a few feeler rays steer
// round whatever is in the way right now (civilians, other cops, props).
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { RoadGraph, Route } from '../world/RoadGraph';
import type { Vehicle } from '../vehicles/Vehicle';
import { cornerSpeedLimit, purePursuit, turnAngle } from './pursuit';
import type { NavGrid } from './NavGrid';
import type { ObstacleProbe } from './lineOfSight';

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
  /** Route cost, in extra metres, of a 90° turn (time lost slowing for it; scales with the angle)… */
  turnCost: number;
  /** …and of turning round (stop, turn, pull away again). */
  uTurnCost: number;
  /** Plan on the NavGrid when the suspect is within this many metres and either of us is off the road… */
  navRange: number;
  /** …or this close regardless (out of sight but near: behind planters, round a corner). */
  navAlways: number;
  /** Seconds between feeler checks for something in the way. */
  probeInterval: number;
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
  turnCost: 20,
  uTurnCost: 80,
  navRange: 220,
  navAlways: 60,
  probeInterval: 0.1,
};

const NOSE = 2.4; // metres from the car's centre to its front bumper
const OFF_ROAD = 7.5; // metres from a road's centre line: past its kerb
/** Headings tried round an obstacle, relative to where we want to go (radians, + = right). */
const DODGES = [0.35, 0.7, 1.05, 1.4];

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
  private probeTimer = 0;
  private dodge = 0; // heading offset currently steering round an obstacle (0 = way clear)
  private dodgeSide = 0; // which way we're swerving round it (+1 right, −1 left)
  private dodgeSpeed = Infinity; // speed that still stops short of it
  private aim = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(
    readonly vehicle: Vehicle,
    private graph: RoadGraph,
    private canSee: LineOfSight,
    public tuning: CopTuning = COP_TUNING,
    private nav: NavGrid | null = null,
    private probe: ObstacleProbe | null = null,
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

    // Steering toward the aim point, in the car's frame, round anything in the way.
    let angle = this.angleTo(this.aim, fwd);
    if (this.probe) {
      this.probeTimer -= dt;
      if (this.probeTimer <= 0) {
        this.probeTimer = t.probeInterval;
        // Chasing or ramming, only what's between us and the suspect counts.
        this.avoid(angle, speed, this.state === 'navigate' ? Infinity : dist);
      }
      angle += this.dodge;
      desiredSpeed = Math.min(desiredSpeed, this.dodgeSpeed);
    }
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

  /**
   * Feelers: is the way toward `angle` (relative to our heading) clear for the distance we need to
   * stop or swerve? If not, pick the nearest heading either side that is (sticking to the side
   * already chosen, so we don't dither), and the speed that stops short of whatever's ahead.
   */
  private avoid(angle: number, speed: number, targetDist: number): void {
    const fwd = this.vehicle.forward(this.tmp);
    const reach = THREE.MathUtils.clamp(4 + Math.abs(speed) * 0.7, 6, 26);
    const len = Math.min(reach, targetDist - 1) + NOSE;
    const base = THREE.MathUtils.clamp(angle, -0.8, 0.8);
    const free = (off: number) => {
      const a = base + off;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return this.probe!(this.vehicle.position, fwd.x * c - fwd.z * s, fwd.z * c + fwd.x * s, len) - NOSE; // right of travel is (-fz, fx)
    };
    const ahead = len > NOSE + 1 ? free(0) : Infinity;
    if (ahead >= len - NOSE - 0.01) {
      this.dodge = this.dodgeSide = 0;
      this.dodgeSpeed = Infinity;
      return;
    }
    let best = 0;
    let bestScore = ahead;
    const side = this.dodgeSide;
    for (const off of DODGES) {
      for (const sign of side ? [side, -side] : [1, -1]) {
        const o = off * sign;
        if (Math.abs(base + o) > 1.6) continue;
        const score = free(o) - off * 4 + (sign === side ? 3 : 0);
        if (score > bestScore) {
          best = o;
          bestScore = score;
        }
      }
    }
    this.dodgeSide = Math.sign(best);
    this.dodge = best + base - angle; // relative to the aim, which moves on between checks
    const room = best === 0 ? ahead : Math.max(ahead, free(best));
    this.dodgeSpeed = Math.sqrt(2 * this.tuning.brakeDecel * Math.max(0, room - 1.5)) + 2;
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

  /** Route: our position → road nodes → the suspect, or across open ground when off the roads. */
  private replan(target: ChaseTarget): void {
    const v = this.vehicle;
    this.segment = 0;
    const t = this.tuning;
    const dist = Math.hypot(target.position.x - v.position.x, target.position.z - v.position.z);
    if (this.nav && dist < t.navRange) {
      const offRoad = (p: THREE.Vector3) => this.graph.nearestEdge(p.x, p.z).off > OFF_ROAD;
      if (dist < t.navAlways || offRoad(target.position) || offRoad(v.position)) {
        const path = this.nav.findPath(v.position, target.position);
        if (path) {
          this.path = path.map((p) => new THREE.Vector3(p.x, 0, p.z));
          return;
        }
      }
    }
    this.path = planRoute(this.graph, v.position, v.forward(this.tmp), Math.abs(v.speed), target.position, this.tuning);
  }
}

type P = { x: number; z: number };

type RouteTuning = Pick<CopTuning, 'cornerSpeed' | 'brakeDecel' | 'uTurnSpeed' | 'turnCost' | 'uTurnCost'>;

/**
 * Road route from `pos` to `target` (start, junctions, target) for a car heading along `heading`
 * at `speed`. A fast car can't double back or make a turn it's too close to brake for, so then
 * the route starts at the junction ahead, never heads back the way we came, and if the first
 * turn can't be made it carries straight on through that junction and turns at the next.
 * Turns cost time, so the route prefers fewer and gentler ones, and turning round costs most.
 */
export function planRoute(g: RoadGraph, pos: P, heading: P, speed: number, target: P, t: RouteTuning): THREE.Vector3[] {
  const { ids } = planRouteIds(g, pos, heading, speed, target, t);
  return [
    new THREE.Vector3(pos.x, 0, pos.z),
    ...ids.map((id) => new THREE.Vector3(g.nodes[id].x, 0, g.nodes[id].z)),
    new THREE.Vector3(target.x, 0, target.z),
  ];
}

/** planRoute's junctions, and the route's cost in metres (turns included); Infinity if unreachable. */
export function planRouteIds(g: RoadGraph, pos: P, heading: P, speed: number, target: P, t: RouteTuning): Route {
  const dist = (p: P, q: P) => Math.hypot(p.x - q.x, p.z - q.z);
  const costs = { turn: t.turnCost, uTurn: t.uTurnCost };
  // Finish at whichever end of the suspect's road gives the shorter way in.
  const there = g.nearestEdge(target.x, target.z);
  const goals = there.off < 15 ? [there.a, there.b] : [g.nearest(target.x, target.z)];
  /**
   * Cheapest node sequence starting with `lead`, then on to the suspect: no U-turn back to
   * `noUTurnFrom`, and turns counted from the way we drive through the lead. `extra`: cost to add.
   */
  const route = (lead: number[], noUTurnFrom?: number, extra = 0): Route => {
    const last = g.nodes[lead[lead.length - 1]];
    const before = lead.length > 1 ? g.nodes[lead[lead.length - 2]] : pos;
    // The way into the last lead junction; when we're right on it, the way we're facing.
    const arrive = dist(before, last) > 1 ? { x: last.x - before.x, z: last.z - before.z } : heading;
    const leadCost = extra + dist(pos, g.nodes[lead[0]]) + g.pathLength(lead);
    let best: Route = { ids: [...lead], cost: Infinity };
    for (const goal of goals) {
      const rest = g.route(last.id, goal.id, costs, arrive, noUTurnFrom);
      if (!rest) continue;
      const cost = leadCost + rest.cost + dist(goal, target);
      if (cost < best.cost) best = { ids: [...lead, ...rest.ids.slice(1)], cost };
    }
    return best;
  };

  const here = g.nearestEdge(pos.x, pos.z);
  if (here.off > 10) return route([g.nearest(pos.x, pos.z).id]); // off the road grid (plaza, park): nearest junction
  const forwardIsB = (here.b.x - here.a.x) * heading.x + (here.b.z - here.a.z) * heading.z >= 0;
  const ahead = forwardIsB ? here.b : here.a;
  const behind = forwardIsB ? here.a : here.b;
  if (speed <= t.uTurnSpeed) {
    // Slow enough to turn round: carry on, or turn round (at a cost) and head for the other end.
    const viaAhead = route([ahead.id]);
    const viaBehind = route([behind.id], undefined, t.uTurnCost);
    return viaAhead.cost <= viaBehind.cost ? viaAhead : viaBehind;
  }
  let best = route([ahead.id], behind.id);
  // Too fast to make the first turn (onto the next road, or toward the suspect if they're on
  // it)? Go straight through and turn at the next junction.
  const next = best.ids.length > 1 ? g.nodes[best.ids[1]] : target;
  if (dist(ahead, next) > 1) {
    const turn = Math.abs(turnAngle(pos, ahead, next));
    const brakeDistance = (speed * speed - t.cornerSpeed * t.cornerSpeed) / (2 * t.brakeDecel);
    if (turn > 0.5 && brakeDistance > dist(pos, ahead) + 4) {
      const straight = ahead.neighbors
        .map((id) => g.nodes[id])
        .find((n) => Math.abs(turnAngle(pos, ahead, n)) < 0.35);
      if (straight) best = route([ahead.id, straight.id], ahead.id);
    }
  }
  return best;
}
