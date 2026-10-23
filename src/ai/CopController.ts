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
import { cornerSpeedLimit, distanceToBend, purePursuit, turnAngle } from './pursuit';
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
  /** Road routes aim this far ahead of the suspect (seconds of their velocity) when 120 m+ away, less nearer. */
  interceptTime: number;
}

export const COP_TUNING: CopTuning = {
  chaseRange: 90,
  ramRange: 18,
  cornerSpeed: 9,
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
  uTurnSpeed: 5,
  // Time lost braking for a turn and pulling away again, as metres of road at cruising speed:
  // 30 → 12 m/s and back (7 m/s² braking, ~4 m/s² pulling away) loses ~2 s, ~60 m. Turning round
  // (down to walking pace, the manoeuvre itself, then away) loses ~7 s.
  turnCost: 60,
  uTurnCost: 220,
  navRange: 220,
  navAlways: 60,
  probeInterval: 0.1,
  interceptTime: 2,
};

const OFF_ROAD = 7.5; // metres from a road's centre line: past its kerb
/** Headings tried round an obstacle, relative to where we want to go (radians, + = right). */
const DODGES = [0.2, 0.35, 0.7, 1.05, 1.4];
const FEELER_MAX = 55; // metres: stopping from top speed, with a margin
const STOP_GAP = 2; // metres left between our bumper and whatever we stop behind
const REAR_GAP = 1.2; // reversing: stop this short of something behind

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
  private toCorner = Infinity; // metres along the route to its next sharp bend (feelers stop there)
  private aim = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private hit = { vx: 0, vz: 0 };
  private goal = new THREE.Vector3();
  private readonly nose: number; // metres from the car's centre to its front bumper (and its rear one)
  private onGrid = false; // the route came from the NavGrid, not the road graph

  constructor(
    readonly vehicle: Vehicle,
    private graph: RoadGraph,
    private canSee: LineOfSight,
    public tuning: CopTuning = COP_TUNING,
    private nav: NavGrid | null = null,
    private probe: ObstacleProbe | null = null,
  ) {
    this.nose = vehicle.spec.halfExtents.z + 0.2;
  }

  /** What the driving brain is thinking, for `npm run cops` diagnostics. */
  debug(): { onGrid: boolean; dodge: number; dodgeSpeed: number; toCorner: number } {
    return { onGrid: this.onGrid, dodge: this.dodge, dodgeSpeed: this.dodgeSpeed, toCorner: this.toCorner };
  }

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
        // Reversing with the wheels turned one way swings the nose the other way. Boxed in behind
        // too: wait for the way to clear rather than shove whatever is there.
        this.recoverSteer = -Math.sign(aimAngle) || this.recoverSteer;
        if (!this.roomBehind()) return { ...NO_INPUT, steer: this.recoverSteer, handbrake: true };
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
      // A pinned suspect slides along with the push, so the cop may still be rolling forward when
      // it gives up: keep reversing until there's room for a run-up (within twice the time).
      const room = dist > t.pinRange;
      const reversing = this.backoffFor > 0 || (!room && this.backoffFor > -t.backoffTime);
      if (reversing && this.roomBehind()) return { throttle: 0, brake: 1, steer: 0, handbrake: false };
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
    this.toCorner = Infinity;
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

    // Heading errors need a slower car to turn in without sliding wide: corner speed at 0.6 rad,
    // more for smaller ones.
    if (Math.abs(angle) > 0.3) desiredSpeed = Math.min(desiredSpeed, Math.max(t.cornerSpeed, (t.cornerSpeed * 0.6) / Math.abs(angle)));

    const input: DriveInput = { ...NO_INPUT, steer };
    // Something in the way sets the pace: brake on time for it, and creeping up, hold the handbrake
    // (the brake pedal would reverse once stopped).
    const blocked = this.dodgeSpeed <= desiredSpeed;
    if (speed < desiredSpeed - 0.5) input.throttle = 1;
    else if (blocked && speed > desiredSpeed + 0.5) input.brake = speed > 1 ? 1 : 0;
    else if (speed > desiredSpeed + 3 && speed > 2) input.brake = 1;
    // Power-slide round tight turns at speed, like a pursuit driver would.
    input.handbrake = (Math.abs(angle) > 1.1 && speed > 16) || (blocked && speed > desiredSpeed + 0.5 && speed <= 1);

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
   * stop? Something ahead that is moving our way is followed: we keep to the speed that stops short
   * of it, given how fast it is going. Only when we'd close on it soon do we swerve, to the nearest
   * heading either side that is clear (sticking to the side already chosen, so we don't dither);
   * if neither side is, we brake.
   */
  private avoid(angle: number, speed: number, targetDist: number): void {
    const decel = this.tuning.brakeDecel;
    const fwd = this.vehicle.forward(this.tmp);
    const v = Math.abs(speed);
    const reach = THREE.MathUtils.clamp(6 + (v * v) / (2 * decel) + v * 0.3, 6, FEELER_MAX);
    // Following the road, not past its next bend: beyond it the feelers would only find the corner's buildings.
    const len = Math.min(reach, targetDist - 1, Math.max(this.toCorner + 4, 8)) + this.nose;
    const base = THREE.MathUtils.clamp(angle, -0.8, 0.8);
    const free = (off: number, hit?: { vx: number; vz: number }) => {
      const a = base + off;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = fwd.x * c - fwd.z * s; // right of travel is (-fz, fx)
      const dz = fwd.z * c + fwd.x * s;
      const d = this.probe!(this.vehicle.position, dx, dz, len, hit) - this.nose;
      return { d, along: hit ? hit.vx * dx + hit.vz * dz : 0 };
    };
    const clear = () => {
      this.dodge = this.dodgeSide = 0;
      this.dodgeSpeed = Infinity;
    };
    if (len <= this.nose + 1) return clear();
    const { d: ahead, along } = free(0, this.hit);
    if (ahead >= len - this.nose - 0.01) return clear();
    // Speed that still stops STOP_GAP short of it, plus however fast it is pulling away.
    const follow = Math.max(0, along) + Math.sqrt(2 * decel * Math.max(0, ahead - STOP_GAP));
    const closing = v - along;
    const urgent = closing > 0 ? (closing * closing) / (2 * decel) + closing * 0.5 + 6 : 6;
    if (ahead > urgent) {
      // Not closing on it yet: keep our line, just don't run up its back.
      this.dodge = this.dodgeSide = 0;
      this.dodgeSpeed = follow + 1;
      return;
    }
    let best = 0;
    let bestScore = ahead;
    const side = this.dodgeSide;
    for (const off of DODGES) {
      for (const sign of side ? [side, -side] : [1, -1]) {
        const o = off * sign;
        if (Math.abs(base + o) > 1.6) continue;
        const score = free(o).d - off * 4 + (sign === side ? 3 : 0);
        if (score > bestScore) {
          best = o;
          bestScore = score;
        }
      }
    }
    this.dodgeSide = Math.sign(best);
    this.dodge = best + base - angle; // relative to the aim, which moves on between checks
    // Nowhere to swerve: brake to stop behind it (or keep its pace if it's going our way).
    const room = best === 0 ? ahead : Math.max(ahead, free(best).d);
    this.dodgeSpeed = best === 0 ? follow : Math.sqrt(2 * decel * Math.max(0, room - STOP_GAP)) + 2;
  }

  /** Reversing: is there room behind us? (No feelers: assume so.) */
  private roomBehind(): boolean {
    if (!this.probe) return true;
    const f = this.vehicle.forward(this.tmp);
    return this.probe(this.vehicle.position, -f.x, -f.z, this.nose + REAR_GAP + 0.5) > this.nose + REAR_GAP;
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
    this.toCorner = distanceToBend(this.path, this.segment, pos);
    return cornerSpeedLimit(this.path, this.segment, pos, speed, t.cornerSpeed, t.brakeDecel, true);
  }

  /** Route: our position → road nodes → the suspect, or across open ground when off the roads. */
  private replan(target: ChaseTarget): void {
    const v = this.vehicle;
    this.segment = 0;
    const t = this.tuning;
    const dist = Math.hypot(target.position.x - v.position.x, target.position.z - v.position.z);
    const fwd = v.forward(this.tmp);
    if (this.nav && dist < t.navRange) {
      const offRoad = (p: THREE.Vector3) => this.graph.nearestEdge(p.x, p.z).off > OFF_ROAD;
      const off = offRoad(target.position) || offRoad(v.position);
      if (dist < t.navAlways || off) {
        const path = this.nav.findPath(v.position, target.position);
        // The grid knows nothing of which way we face: on the roads and moving, a way that starts
        // behind us is a U-turn on the spot. The road route turns round only where it's worth it.
        const back = !off && Math.abs(v.speed) > t.uTurnSpeed && path !== null && startsBehind(path, v.position, fwd);
        if (path && !back) {
          this.onGrid = true;
          this.path = path.map((p) => new THREE.Vector3(p.x, 0, p.z));
          return;
        }
      }
    }
    this.onGrid = false;
    // Head them off: by road, aim where the suspect will be by the time we get near, not where they are.
    const lead = THREE.MathUtils.clamp((dist - 40) / 40, 0, t.interceptTime);
    const goal = this.goal.copy(target.position).addScaledVector(target.velocity, lead);
    this.path = planRoute(this.graph, v.position, fwd, Math.abs(v.speed), goal, this.tuning);
  }
}

type P = { x: number; z: number };

/** Does `path` head off behind a car at `pos` facing `fwd` (judged 10 m along it)? */
function startsBehind(path: P[], pos: P, fwd: P): boolean {
  let along = 0;
  for (let i = 1; i < path.length; i++) {
    along += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (along < 10 && i < path.length - 1) continue;
    const dx = path[i].x - pos.x;
    const dz = path[i].z - pos.z;
    return dx * fwd.x + dz * fwd.z < -0.3 * Math.hypot(dx, dz);
  }
  return false;
}

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
