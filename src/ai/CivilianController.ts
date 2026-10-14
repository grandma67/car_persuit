// Civilian driver: wanders the road network in its lane (the right-hand one, or the left in an
// English city: `keep` mirrors every side below), obeys traffic lights and
// stop signs, speeds up on main streets signed 90, keeps its distance from whatever is ahead, takes its turn at junctions with the other
// civilians (junctions.ts), yields to the player and cops about to cross its path, and after a
// crash backs off and drives round whatever it's wedged against. Buses call at every bus stop.
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { Rng } from '../core/Rng';
import type { RoadGraph, RoadNode } from '../world/RoadGraph';
import { signalState, yellowLeft, type ApproachControl } from '../world/TrafficControl';
import type { Vehicle } from '../vehicles/Vehicle';
import { cornerSpeedLimit, purePursuit, turnAngle } from './pursuit';
import { CrashRecovery, hazardSpeedLimit, type Awareness, type Obstacle, type Self } from './awareness';
import type { Keep } from '../world/driveSide';
import { addFootprint, alongTrack, type JunctionClaim, type Junctions } from './junctions';

const LANE_OFFSET = 3; // metres to the kerb side of the road centre line
const JUNCTION_EDGE = 7; // lane points sit this far from the junction centre
const STOP_LINE = 6 + 4.4; // junction centre → stop line
const COMFORT_DECEL = 4; // m/s² for planned stops
const CORNER_SPEED = 6;
const TURN_DECEL = 2.5; // m/s² we plan to slow for a turn with
const GAP = 2.5; // metres kept to the vehicle ahead at a standstill…
const GAP_TIME = 0.4; // …plus this many seconds of our speed on the move
const EXIT_ROOM = 6; // metres wanted past the car ahead on the road out before we enter a junction
const FOLLOW_CLOSE = 1.5; // m/s per metre of room left, closing up behind the vehicle ahead
// Brake lights ahead within this many seconds (or metres) of us: ease off toward its speed at
// once, a little each step, rather than wait for the gap to close.
const REACT_TIME = 3;
const REACT_DISTANCE = 20;
const REACT_EASE = 0.8; // m/s under our speed we aim for: a firm lift, light braking
const STOP_SIGN_WAIT = 1.2;
// At a stop sign, pull out only with a gap: nothing on the way into the junction (beyond the
// ground already claimed there) due within this many seconds. More for a slow-pulling heavy.
const PULL_OUT_TIME = 3;
const HEAVY_PULL_OUT_TIME = 5;
const GAP_RANGE = 150; // metres out we look for it
const FAST_CRUISE = [22, 25];
const STOP_MARGIN = 1.5; // metres short of the stop line
const YELLOW_MARGIN = 1; // metres to spare reaching the line before the red
const HARD_STEER = 0.6; // fraction of full lock above which we hold cornering speed
const SIGNAL_DISTANCE = 40; // metres before a junction to start indicating a turn
const PANIC_TIME = 1; // seconds stopped after a knock before carrying on
const DODGE_OFFSET = 3.5; // metres sideways to pass something blocking the lane
const DODGE_SPEED = 5;
const DODGE_GAP = 2;
const HEAVY_MASS = 5000; // kg: buses and trucks drive like heavies
const HEAVY_LATERAL = 1.8; // m/s² sideways in a corner: standing passengers, high centre of mass
const HEAVY_ACCEL = 1.5; // m/s² pulling away, about what a loaded bus manages
const HEAVY_DECEL = 2.2; // m/s² for planned stops
const TURN_SPEED = 3.5; // m/s a heavy rolls through a tight turn (sets its turning radius)
// A heavy's line through a turn, as bus drivers are taught (and tuned in CivilianTurns.test so no
// part of the body crosses the kerb, where the signal poles, signs and hydrants stand):
// - across the oncoming lane: carry on a little deeper, turn in a wide arc and come out just
//   beside the centre line, then ease over to the kerb lane;
const FAR_TURN_DEEP = -3; // metres along the approach from the junction centre where the turn starts
const FAR_TURN_OUT = 12; // metres out along the new road where it comes out…
const FAR_TURN_HUG = 1.8; // …this far from the centre line
// - onto the kerb side: ease toward the centre line on the last of the approach and go well into
//   the junction before steering, using the road it turns into (it has to: a 12m bus can't make
//   that turn from lane to lane without its rear wheels climbing the kerb corner).
const NEAR_TURN_EASE = STOP_LINE + 8; // metres before the centre the approach starts easing over
const NEAR_TURN_DEEP = -4;
const NEAR_TURN_IN = 1; // metres from the centre line at the turn
const NEAR_TURN_OUT = 12;
const TURN_SETTLE = 14; // metres to ease back into the kerb lane after either
// Physics steps between looks around (rays ahead, crossing traffic): 20 a second is plenty to
// react, and sensing every step for every car was the bulk of the traffic AI's cost.
const SENSE_EVERY = 3;
const SWEEP_STEP = 0.5; // metres between poses when working out the ground we'll sweep through a junction
const CORRIDOR_POINTS = 4; // lane points ahead the forward sensor follows
const ASK_TIME = 3; // seconds out from the stop line we start asking for our turn at a junction (or further: see takeTurn)
const ASK_DISTANCE = 10; // …or metres, whichever is further
const COMMIT_AFTER = 0.1; // seconds after first asking before we commit to a junction
const CLAIM_MARGIN = 0.5; // metres round our body we want clear of anyone crossing
const HEAVY_CLAIM_MARGIN = 0.8; // more round a heavy: it doesn't hold its line as closely
const BUS_DWELL = 3; // seconds a bus stands at a stop
const BUS_STOP_PAST = 1; // metres the bus's nose pulls up past the sign (front door by the pole)
const BUS_STOP_REACH = 2; // metres either side of its mark a bus counts as at the stop

/**
 * How a vehicle drives for its size. Long vehicles can't follow a car's line through a right
 * turn: their rear axle tracks inside the front wheels, so they run deeper into the junction
 * before turning (swinging wide), corner slower, and pull away and brake more gently.
 */
interface DrivingStyle {
  wheelbase: number;
  /** Tightest radius the rear axle can follow at turning speed. */
  turnRadius: number;
  cornerSpeed: number;
  decel: number;
  maxThrottle: number;
  /** Buses and trucks: their own line through turns (see FAR_TURN_*, NEAR_TURN_*). */
  heavy: boolean;
}

function drivingStyle(spec: Vehicle['spec']): DrivingStyle {
  const wheelbase = spec.wheelZ * 2;
  const heavy = spec.mass > HEAVY_MASS;
  const radiusAt = (speed: number) => wheelbase / Math.tan(steerLimit(spec, speed));
  const cornerSpeed = heavy ? Math.min(CORNER_SPEED, Math.sqrt(HEAVY_LATERAL * radiusAt(TURN_SPEED))) : CORNER_SPEED;
  // Tightest arc at the speed it actually corners at, plus a little slack for the controller.
  const turnRadius = radiusAt(cornerSpeed) + 1;
  const accel = (spec.engineForce * 2) / spec.mass; // two driven wheels at full throttle
  return {
    wheelbase,
    turnRadius,
    cornerSpeed,
    decel: heavy ? HEAVY_DECEL : COMFORT_DECEL,
    maxThrottle: heavy ? Math.min(1, HEAVY_ACCEL / accel) : 1,
    heavy,
  };
}

/** Steering lock (radians) the vehicle allows at this speed; mirrors Vehicle.drive. */
function steerLimit(spec: Vehicle['spec'], speed: number): number {
  return THREE.MathUtils.lerp(spec.maxSteer, spec.minSteer, Math.min(Math.abs(speed) / spec.maxSpeed, 1));
}

/** Free distance ahead along the car's heading (dynamic bodies only), Infinity if clear. */
export type ForwardSensor = (vehicle: Vehicle, range: number) => number;

type P = { x: number; z: number };

export class CivilianController {
  private route: number[]; // node ids: [previous, next, …]
  private path: THREE.Vector3[] = [];
  private segment = 0;
  private aim = new THREE.Vector3();
  private panicFor = 0;
  private stoppedAt: number | null = null; // junction where we've already stopped at the sign
  private stopWait = 0;
  private recovery: CrashRecovery;
  private rear = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  /** The junction control on the leg we're driving, looked up once per leg rather than every step. */
  private next3: RoadNode[] = []; // nextNodes' result, reused
  private leg: { from: number; to: number; control: ApproachControl | undefined } = { from: -1, to: -1, control: undefined };
  private style: DrivingStyle;
  private senseIn = 0; // steps until the next look around
  private ahead: Obstacle | null = null;
  private free = Infinity;
  private hazardLimit = Infinity;
  private claim: JunctionClaim | null = null; // our turn through a junction (see junctions.ts)
  private claimNode = -1;
  private claimedAt = 0; // when we put in the claim we hold
  private waitingFor = -1; // junction we've been waiting at, and since when (kept through red lights)
  private waitingSince = 0;
  private mayEnter = true;
  private servedStop: string | null = null; // street whose bus stop we've called at
  private dwell = 0;
  readonly cruise: number;
  readonly fastCruise: number; // on a stretch signed 90
  /** Seconds spent unable to move for no traffic reason; the manager respawns stuck cars. */
  stuckFor = 0;

  constructor(
    readonly vehicle: Vehicle,
    private graph: RoadGraph,
    private controls: Map<string, ApproachControl>,
    private sense: ForwardSensor,
    private rng: Rng,
    from: number,
    to: number,
    private awareness?: Awareness,
    private keep: Keep = 1,
    private junctions?: Junctions,
    private fast: Set<string> = new Set(),
    private stops: Map<string, number> = new Map(),
  ) {
    this.recovery = new CrashRecovery(keep);
    this.route = [from, to];
    // Buses and trucks cruise a little slower than cars.
    this.cruise = Math.min(rng.range(10, 13.5), vehicle.spec.maxSpeed - 3);
    // The same temperament on a fast stretch (no extra roll: keeps every driver's route as it was).
    const [lo, hi] = FAST_CRUISE;
    this.fastCruise = Math.max(this.cruise, Math.min(lo + ((this.cruise - 10) / 3.5) * (hi - lo), vehicle.spec.maxSpeed - 3));
    this.style = drivingStyle(vehicle.spec);
    this.extend();
    this.rebuild();
  }

  /** Bump from a collision: stop and collect yourself for a moment, then carry on. */
  hit(): void {
    this.panicFor = PANIC_TIME;
    this.recovery.hit();
  }

  update(dt: number, time: number): DriveInput {
    const v = this.vehicle;
    const pos = v.position;
    const speed = v.speed;
    const input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    // Backing away from a crash.
    const backing = this.recovery.override(dt);
    if (backing) {
      v.indicator = null;
      this.stuckFor = Math.abs(speed) < 0.3 ? this.stuckFor + dt : 0;
      return backing;
    }

    // Advance the route once we're past the next junction.
    const next = this.graph.nodes[this.route[1]];
    const after = this.graph.nodes[this.route[2]];
    const leaving = { x: next.x + (after.x - next.x) * 0.15, z: next.z + (after.z - next.z) * 0.15 };
    if (Math.hypot(leaving.x - pos.x, leaving.z - pos.z) < 6) {
      this.route.shift();
      this.extend();
      this.rebuild();
      this.stoppedAt = null;
      this.servedStop = null;
      this.dwell = 0;
      this.recovery.progress();
    }

    // Pure pursuit from the rear axle (bicycle model): steer onto the arc through the aim point.
    // Measuring from the rear axle is what makes a long vehicle start its turn late enough.
    const { wheelbase, cornerSpeed, decel } = this.style;
    const fwd = v.forward(this.fwd);
    const rear = this.rear.copy(pos).addScaledVector(fwd, -wheelbase / 2);
    const lookahead = wheelbase / 2 + 4 + 0.4 * Math.abs(speed);
    this.segment = purePursuit(this.path, this.segment, rear, lookahead, this.aim).segment;
    const dodging = this.recovery.dodgeFor > 0;
    if (dodging) this.offsetAim(this.recovery.dodgeSide * DODGE_OFFSET);
    v.indicator = this.signal(pos, dodging);
    const toX = this.aim.x - rear.x;
    const toZ = this.aim.z - rear.z;
    const alpha = Math.atan2(toX * -fwd.z + toZ * fwd.x, toX * fwd.x + toZ * fwd.z);
    const wheelAngle = Math.atan((2 * wheelbase * Math.sin(alpha)) / Math.hypot(toX, toZ));
    // Aim behind us (knocked round, or overshot): full lock toward it.
    input.steer = Math.abs(alpha) > Math.PI / 2 ? Math.sign(alpha) : THREE.MathUtils.clamp(wheelAngle / steerLimit(v.spec, speed), -1, 1);

    // Slow for a turn early and gently, as a driver does once the indicator's on, not late and hard.
    let desired = Math.min(this.cruiseHere(pos, decel), cornerSpeedLimit(this.path, this.segment, pos, Math.abs(speed), cornerSpeed, Math.min(decel, TURN_DECEL)));
    // Still winding the wheel on: no pulling away out of a turn until it's coming straight, or
    // the car runs wide over the centre line of the road it's turning into.
    if (Math.abs(input.steer) > HARD_STEER) desired = Math.min(desired, cornerSpeed);

    // Junction control on our approach to the next node.
    const junction = this.graph.nodes[this.route[1]];
    const toStop = Math.hypot(junction.x - pos.x, junction.z - pos.z) - STOP_LINE - v.spec.halfExtents.z;
    const control = this.legControl();
    let mustStop = false;
    let redLight = false;
    if (control && toStop > -1) {
      if (control.kind === 'signal') {
        const light = signalState(control.axis, time + control.phase);
        // Stop for red. On yellow: stop if we can do it comfortably; if not, carry on through only
        // if we'll be over the line before it turns red, else stop anyway (harder).
        const comfortable = toStop - STOP_MARGIN > (speed * speed) / (2 * decel);
        const makeIt = toStop < speed * yellowLeft(control.axis, time + control.phase) - YELLOW_MARGIN;
        mustStop = light === 'red' || (light === 'yellow' && (comfortable || !makeIt));
        redLight = light === 'red';
      } else if (this.stoppedAt !== this.route[1]) {
        mustStop = true;
        if (toStop < STOP_MARGIN + 1.5 && Math.abs(speed) < 0.6) {
          this.stopWait += dt;
          if (this.stopWait > STOP_SIGN_WAIT) {
            this.stoppedAt = this.route[1];
            this.stopWait = 0;
            mustStop = false;
          }
        }
      }
      // Aim to stop a little short of the line; inside that margin, stop now.
      if (mustStop) desired = Math.min(desired, toStop < STOP_MARGIN ? 0 : Math.sqrt(2 * decel * (toStop - STOP_MARGIN)));
    }

    if (this.vehicle.spec.body === 'bus') desired = Math.min(desired, this.busStop(dt, pos, fwd, speed, decel));

    // Keep a gap to whatever is ahead (cars, the player, cops), looking further the faster we go.
    // Looking around (forward rays, then traffic about to cross us) runs every few steps.
    if (--this.senseIn <= 0) {
      this.senseIn = SENSE_EVERY;
      const range = Math.max(30, (speed * speed) / (2 * decel) + GAP + GAP_TIME * Math.abs(speed) + 10);
      // Along the lane ahead, so through a turn the sensor looks where we're going.
      const corridor = dodging ? undefined : this.path.slice(this.segment + 1, this.segment + 1 + CORRIDOR_POINTS);
      this.ahead = this.awareness?.obstacle(v, range, corridor) ?? null;
      this.free = this.awareness ? (this.ahead?.distance ?? Infinity) : this.sense(v, range);
      // Yield to anything on a collision course: cross traffic, a light-runner, the player head-on.
      this.hazardLimit = Infinity;
      if (this.awareness) {
        const lv = v.body.linvel();
        const self: Self = { handle: v.body.handle, x: pos.x, z: pos.z, vx: lv.x, vz: lv.z, fx: fwd.x, fz: fwd.z, halfWidth: v.spec.halfExtents.x, halfLength: v.spec.halfExtents.z, turning: Math.abs(input.steer) > 0.3, nearTurn: this.nearTurn(pos) };
        this.hazardLimit = hazardSpeedLimit(self, this.awareness.movers(), speed, this.keep, !this.junctions);
      }
      if (this.junctions) this.mayEnter = this.takeTurn(time, toStop, mustStop, redLight, speed, control);
    }
    // Not our turn at the junction yet: wait at the stop line.
    if (!this.mayEnter && toStop > -1) desired = Math.min(desired, toStop < STOP_MARGIN ? 0 : Math.sqrt(2 * decel * (toStop - STOP_MARGIN)));
    const { ahead, free } = this;
    const gap = dodging ? DODGE_GAP : GAP + GAP_TIME * Math.max(0, speed);
    // Planned braking down to the gap (as for a stop line), tightening to a crawl in the last metres.
    if (free < Infinity) {
      const room = Math.max(0, free - gap);
      desired = Math.min(desired, Math.sqrt(2 * decel * room), FOLLOW_CLOSE * room);
    }
    // Only while closing on it: below that the planned braking above takes us up to the queue (easing
    // off from a crawl behind a car standing on its brakes would leave us stopped well short of it).
    if (ahead?.braking && ahead.aligned && ahead.speed !== undefined && speed > ahead.speed + REACT_EASE && ahead.distance < Math.max(REACT_DISTANCE, speed * REACT_TIME)) {
      desired = Math.min(desired, Math.max(ahead.speed, speed - REACT_EASE));
    }
    if (dodging) desired = Math.min(desired, DODGE_SPEED);
    desired = Math.min(desired, this.hazardLimit);

    if (this.panicFor > 0) {
      this.panicFor -= dt;
      desired = 0;
    } else {
      this.recovery.observe(dt, ahead, speed, gap);
    }

    const { maxThrottle } = this.style;
    // Heavies hold back to pull away gently, but take what they need to keep rolling through a
    // tight turn, where the tyres scrub off more than half throttle gives.
    if (speed < desired - 0.3) input.throttle = Math.min(1, (desired - speed > 1 ? 1 : 0.5) * maxThrottle * (Math.abs(input.steer) > HARD_STEER ? 3 : 1));
    else if (speed > desired + 0.5) input.brake = speed > 0.3 ? Math.min(1, (speed - desired) / 2) * (decel / COMFORT_DECEL) : 0;
    // Holding still: S below ~1 m/s means reverse, so hold the car on the handbrake instead.
    if (desired < 0.3 && Math.abs(speed) < 1) {
      input.brake = 0;
      input.throttle = 0;
      input.handbrake = true;
    }

    // Wanting to move but not moving (wedged against something).
    this.stuckFor = desired > 2 && Math.abs(speed) < 0.5 ? this.stuckFor + dt : 0;
    if (this.recovery.gaveUp) this.stuckFor = Infinity;
    return input;
  }

  /**
   * A bus calls at the stop on this street, or the next one (it can be close past the junction):
   * planned braking to pull up with its nose just past the sign, BUS_DWELL seconds standing
   * there, then on its way. The speed it may do for that, Infinity if no stop is coming up.
   */
  private busStop(dt: number, pos: P, fwd: P, speed: number, decel: number): number {
    const front = { x: pos.x + fwd.x * this.vehicle.spec.halfExtents.z, z: pos.z + fwd.z * this.vehicle.spec.halfExtents.z };
    const [a, b, c] = this.route.slice(0, 3).map((id) => this.graph.nodes[id]);
    let key = `${a.id}>${b.id}`;
    let toStop: number;
    const here = this.stops.get(key);
    if (here !== undefined) {
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      toStop = here + BUS_STOP_PAST - ((front.x - a.x) * (b.x - a.x) + (front.z - a.z) * (b.z - a.z)) / len;
    } else {
      key = `${b.id}>${c.id}`;
      const next = this.stops.get(key);
      if (next === undefined) return Infinity;
      toStop = Math.hypot(b.x - front.x, b.z - front.z) + next + BUS_STOP_PAST;
    }
    if (this.servedStop === key || toStop < -BUS_STOP_REACH) return Infinity;
    if (toStop < BUS_STOP_REACH && Math.abs(speed) < 0.5) {
      this.dwell += dt;
      if (this.dwell >= BUS_DWELL) {
        this.servedStop = key;
        this.dwell = 0;
        return Infinity;
      }
      return 0;
    }
    return toStop < 0 ? 0 : Math.sqrt(2 * decel * toStop);
  }

  /**
   * Cruising speed for where we are: faster on a stretch signed 90, easing back to the usual
   * cruise by the stop line when the road after the junction isn't one. At 90 we'd only get our
   * turn at the next junction inside braking distance, so we look ahead: someone already crossing
   * it and we come in slow enough to stop for them.
   */
  private cruiseHere(pos: P, decel: number): number {
    const [prev, next, after] = this.route;
    if (!this.fast.has(`${prev}>${next}`)) return this.cruise;
    const n = this.graph.nodes[next];
    const toNext = Math.hypot(n.x - pos.x, n.z - pos.z);
    let limit = this.fastCruise;
    if (!this.fast.has(`${next}>${after}`)) limit = Math.min(limit, Math.sqrt(this.cruise * this.cruise + 2 * decel * Math.max(0, toNext - STOP_LINE)));
    // The first junction ahead (past a bend), and how far to its stop line.
    const [junction, from, toLine] =
      n.neighbors.length >= 3 ? [next, prev, toNext - STOP_LINE] : [after, next, toNext + Math.hypot(this.graph.nodes[after].x - n.x, this.graph.nodes[after].z - n.z) - STOP_LINE];
    const ours = this.claim?.committed && this.claimNode === junction; // on our way through already
    const busy = !ours && toLine > 0 && this.junctions?.list(junction).some((c) => c.committed && c.entry !== from && c.owner !== this.vehicle.body.handle);
    if (busy) limit = Math.min(limit, Math.max(this.cruise, Math.sqrt(2 * decel * Math.max(0, toLine - STOP_MARGIN))));
    return limit;
  }

  /**
   * Our turn at the junction ahead (see junctions.ts): whether we may cross the stop line now.
   * We ask once we're close, the light or sign lets us go, nobody's queued in front of us and
   * there's room on the road out (we never stop in the middle of a junction waiting for it). We
   * commit once we're inside comfortable braking distance, and keep the claim until our tail is
   * out of the junction.
   */
  private takeTurn(time: number, toStop: number, held: boolean, red: boolean, speed: number, control: ApproachControl | undefined): boolean {
    const j = this.junctions!;
    const v = this.vehicle;
    const node = this.route[1];
    const owner = v.body.handle;
    const halfLength = v.spec.halfExtents.z;
    // Clearing the junction we've just driven through.
    if (this.claim && this.claimNode !== node) {
      const c = this.claim;
      const at = this.graph.nodes[this.claimNode];
      const out = Math.max(Math.abs(v.position.x - at.x), Math.abs(v.position.z - at.z));
      if (out > STOP_LINE + halfLength) {
        j.leave(this.claimNode, owner);
        this.claim = null;
      } else {
        c.committed = true;
        c.passed = alongTrack(c.track, v.position.x, v.position.z);
        j.ask(this.claimNode, c, time);
        return true;
      }
    }
    if (this.graph.nodes[node].neighbors.length < 3) return true; // a bend: nobody to meet
    // Caught by the light turning red before we reached the line: stand down, let the cross traffic go.
    // (On yellow we're past stopping comfortably once committed: we carry on through.)
    if (this.claim?.committed && red && toStop > 0) {
      j.leave(node, owner);
      this.claim = null;
    }
    if (this.claim?.committed) {
      this.claim.passed = alongTrack(this.claim.track, v.position.x, v.position.z);
      j.ask(node, this.claim, time);
      return true;
    }
    const past = toStop < 0;
    const ahead = this.ahead;
    const firstInLine = !ahead || ahead.distance > toStop;
    const exitClear = !ahead || ahead.moving || ahead.distance > toStop + 2 * STOP_LINE + 2 * halfLength + EXIT_ROOM;
    // Early enough that a "wait" leaves room to stop comfortably (from 90, further out than ASK_TIME).
    const near = toStop < Math.max(ASK_DISTANCE, Math.abs(speed) * ASK_TIME, (speed * speed) / (2 * this.style.decel) + Math.abs(speed));
    // Waiting for a gap (never second thoughts once pulling away): at a stop sign, in the traffic
    // crossing ours; turning across the oncoming lane of a fast stretch, in its traffic.
    const [a0, b0, c0] = this.route.slice(0, 3).map((id) => this.graph.nodes[id]);
    const turnsAcross = turnAngle(a0, b0, c0) * this.keep < -0.5;
    const atSign = control?.kind === 'stop' && toStop < STOP_MARGIN + 3 && Math.abs(speed) < 1;
    const noGap = !this.claim?.committed && toStop > -1 && ((atSign && this.trafficDue(node, 'crossing')) || (turnsAcross && toStop > 0 && this.trafficDue(node, 'oncoming')));
    if (!past && (held || noGap || !near || !firstInLine || !exitClear)) {
      if (this.claim) j.leave(node, owner);
      this.claim = null;
      return !noGap && (near ? exitClear : true);
    }
    if (!this.claim) {
      if (this.waitingFor !== node) {
        this.waitingFor = node;
        this.waitingSince = time;
      }
      this.claimedAt = time;
      const [a, b, c] = this.route.slice(0, 3).map((id) => this.graph.nodes[id]);
      const turn = turnAngle(a, b, c);
      const giveWay = control?.kind === 'stop' ? 1 : 0;
      const across = !giveWay && (turn * this.keep < -0.5 || Math.abs(turn) > 2.8) ? 1 : 0;
      this.claim = {
        owner,
        entry: this.route[0],
        ...this.sweep(a, b),
        rank: [giveWay, across, this.waitingSince],
        committed: false,
        passed: -Infinity,
        seen: time,
      };
      this.claimNode = node;
    }
    if (past) this.claim.committed = true;
    const go = j.ask(node, this.claim, time);
    // Commit once stopping would be a lurch, but not on the very look we first asked: everyone
    // waiting on the same green asks within a look of each other, and the order sorts them out.
    const asked = time - this.claimedAt > COMMIT_AFTER;
    if (go && asked && toStop < (speed * speed) / (2 * this.style.decel) + 2) this.claim.committed = true;
    return go || past;
  }

  /**
   * Whether anything (another driver, the player, a cop) is heading into junction `node` on a road
   * crossing ours that doesn't stop there, or oncoming along a fast stretch, due too soon to pull
   * out in front of. Those already close enough to have put in a claim are left to the junction's
   * own right of way.
   */
  private trafficDue(node: number, kind: 'crossing' | 'oncoming'): boolean {
    if (!this.awareness) return false;
    const n = this.graph.nodes[node];
    const from = this.graph.nodes[this.route[0]];
    const len = Math.hypot(n.x - from.x, n.z - from.z) || 1;
    const [ux, uz] = [(n.x - from.x) / len, (n.z - from.z) / len]; // our way in
    const gap = this.style.heavy ? HEAVY_PULL_OUT_TIME : PULL_OUT_TIME;
    for (const m of this.awareness.movers()) {
      if (m.handle === this.vehicle.body.handle) continue;
      const speed = Math.hypot(m.vx, m.vz);
      if (speed < 3) continue;
      const [hx, hz] = [m.vx / speed, m.vz / speed];
      const along = hx * ux + hz * uz;
      if (kind === 'crossing' ? Math.abs(along) > 0.7 : along > -0.7) continue;
      const dx = n.x - m.x;
      const dz = n.z - m.z;
      const ahead = dx * hx + dz * hz; // metres to go to the junction centre
      const side = Math.abs(dx * -hz + dz * hx); // off its line through the centre
      if (ahead < STOP_LINE + 4 || ahead > GAP_RANGE || side > LANE_OFFSET * 2) continue;
      // The road it's on: the neighbour behind it. If that stops here too, it'll wait its turn.
      const back = n.neighbors.find((id) => {
        const b = this.graph.nodes[id];
        const bl = Math.hypot(b.x - n.x, b.z - n.z) || 1;
        return ((b.x - n.x) * -hx + (b.z - n.z) * -hz) / bl > 0.7;
      });
      if (back === undefined || this.controls.get(`${back}>${node}`)?.kind === 'stop') continue;
      // Oncoming traffic on an ordinary road asks for the junction in good time: the claims sort it out.
      if (kind === 'oncoming' && !this.fast.has(`${back}>${node}`)) continue;
      // Due: soon past the point where it could still stop comfortably for us. On a fast stretch,
      // reckoned at 90: one pulling away now will be doing that by the time it's here.
      const v = this.fast.has(`${back}>${node}`) ? Math.max(speed, FAST_CRUISE[1]) : speed;
      if ((ahead - (v * v) / (2 * COMFORT_DECEL)) / v < gap) return true;
    }
    return false;
  }

  /**
   * The ground we'll sweep crossing junction b (coming from a): our own steering run ahead of
   * time, from a standstill at the stop line until we're out the other side, at cornering speed.
   */
  private sweep(a: P, b: P): Pick<JunctionClaim, 'cells' | 'track'> {
    const { spec } = this.vehicle;
    const { wheelbase, cornerSpeed, heavy } = this.style;
    const { x: hw, z: hl } = spec.halfExtents;
    const margin = heavy ? HEAVY_CLAIM_MARGIN : CLAIM_MARGIN;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let fx = (b.x - a.x) / len;
    let fz = (b.z - a.z) / len;
    const side = LANE_OFFSET * this.keep;
    let x = b.x - fx * (STOP_LINE + hl) - fz * side;
    let z = b.z - fz * (STOP_LINE + hl) + fx * side;
    const cells = new Map<number, number>();
    const track: JunctionClaim['track'] = [];
    const aim = new THREE.Vector3();
    const rear = new THREE.Vector3();
    const limit = steerLimit(spec, cornerSpeed);
    let segment = 0;
    for (let s = 0; s < 80; s += SWEEP_STEP) {
      addFootprint(cells, s, x, z, fx, fz, hw, hl, margin, b.x, b.z, STOP_LINE);
      track.push({ x, z, s });
      if (s > STOP_LINE && Math.max(Math.abs(x - b.x), Math.abs(z - b.z)) > STOP_LINE + hl) break;
      rear.set(x - (fx * wheelbase) / 2, 0, z - (fz * wheelbase) / 2);
      segment = purePursuit(this.path, segment, rear, wheelbase / 2 + 4 + 0.4 * cornerSpeed, aim).segment;
      const toX = aim.x - rear.x;
      const toZ = aim.z - rear.z;
      const alpha = Math.atan2(toX * -fz + toZ * fx, toX * fx + toZ * fz);
      const wheel = THREE.MathUtils.clamp(Math.atan((2 * wheelbase * Math.sin(alpha)) / Math.hypot(toX, toZ)), -limit, limit);
      // Bicycle model about the rear axle: it moves along the heading, which turns toward the wheels.
      rear.x += fx * SWEEP_STEP;
      rear.z += fz * SWEEP_STEP;
      const turn = (SWEEP_STEP * Math.tan(wheel)) / wheelbase;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      [fx, fz] = [fx * c - fz * sn, fz * c + fx * sn];
      x = rear.x + (fx * wheelbase) / 2;
      z = rear.z + (fz * wheelbase) / 2;
    }
    return { cells, track };
  }

  private legControl(): ApproachControl | undefined {
    const [from, to] = this.route;
    const leg = this.leg;
    if (leg.from !== from || leg.to !== to) {
      leg.from = from;
      leg.to = to;
      leg.control = this.controls.get(`${from}>${to}`);
    }
    return leg.control;
  }

  /** The junction we left, the one we're heading for and the one after it. Reused: read it at once. */
  private nextNodes(): RoadNode[] {
    const n = this.graph.nodes;
    const out = this.next3;
    for (let i = 0; i < 3; i++) out[i] = n[this.route[i]];
    return out;
  }

  /**
   * Turn signal: the side we're pulling out to round an obstacle, else the turn at the next
   * junction from SIGNAL_DISTANCE out until we've left it (straight on: none).
   */
  private signal(pos: P, dodging: boolean): 'left' | 'right' | null {
    if (dodging) return this.recovery.dodgeSide > 0 ? 'right' : 'left';
    const [a, b, c] = this.nextNodes();
    if (Math.hypot(b.x - pos.x, b.z - pos.z) > SIGNAL_DISTANCE) return null;
    const turn = turnAngle(a, b, c);
    // Positive turn angle is a right turn; a U-turn swings across the road, away from the kerb.
    if (Math.abs(turn) > 2.8) return this.keep > 0 ? 'left' : 'right';
    return turn > 0.5 ? 'right' : turn < -0.5 ? 'left' : null;
  }

  /**
   * The kerb-side turn at the next junction, once we're closing on it: a car's turn stays in its
   * own corner (heavies swing out over the centre lines, so they get none).
   */
  private nearTurn(pos: P): Self['nearTurn'] {
    if (this.style.heavy) return null;
    const [a, b, c] = this.nextNodes();
    if (turnAngle(a, b, c) * this.keep <= 0.5 || Math.abs(turnAngle(a, b, c)) > 2.8) return null;
    if (Math.hypot(b.x - pos.x, b.z - pos.z) > SIGNAL_DISTANCE) return null;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: b.x, z: b.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len };
  }

  /** Shift the aim point sideways off the lane (+ = right), along the current path segment. */
  private offsetAim(offset: number): void {
    const a = this.path[this.segment];
    const b = this.path[Math.min(this.segment + 1, this.path.length - 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    this.aim.x += (-(b.z - a.z) / len) * offset;
    this.aim.z += ((b.x - a.x) / len) * offset;
  }

  /**
   * Keep at least three junctions of route ahead: random turns, no U-turns unless a dead end.
   * Heavies keep off near-side turns (right, or left keeping left) when there's another way on:
   * however they take one, the front
   * swings deep into the new road's oncoming lane, right where its traffic waits at the stop line
   * (CivilianTurns.test). Left and straight on, they keep to their side.
   */
  private extend(): void {
    while (this.route.length < 4) {
      const prev = this.route[this.route.length - 2];
      const cur = this.graph.nodes[this.route[this.route.length - 1]];
      const options = cur.neighbors.filter((n) => n !== prev);
      const from = this.graph.nodes[prev];
      const easy = !this.style.heavy ? options : options.filter((n) => turnAngle(from, cur, this.graph.nodes[n]) * this.keep <= 0.5);
      const pool = easy.length ? easy : options;
      this.route.push(pool.length ? this.rng.pick(pool) : prev);
    }
  }

  /** Lane polyline: for each junction, an entry point and an exit point offset into our lane. */
  private rebuild(): void {
    const g = this.graph;
    const n = this.route.map((id) => g.nodes[id]);
    const dir = (a: P, b: P) => {
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
    };
    // `side` metres to the kerb side of the direction of travel (our lane by default).
    const k = this.keep;
    const lanePoint = (at: P, d: { dx: number; dz: number }, along: number, side = LANE_OFFSET) =>
      new THREE.Vector3(at.x + d.dx * along + -d.dz * side * k, 0, at.z + d.dz * along + d.dx * side * k);
    const { heavy } = this.style;
    const pts: THREE.Vector3[] = [];
    const first = dir(n[0], n[1]);
    pts.push(lanePoint(n[0], first, JUNCTION_EDGE));
    for (let i = 1; i < n.length - 1; i++) {
      const dIn = dir(n[i - 1], n[i]);
      const dOut = dir(n[i], n[i + 1]);
      const turn = turnAngle(n[i - 1], n[i], n[i + 1]) * k;
      if (heavy && turn > 0.5) {
        pts.push(lanePoint(n[i], dIn, -NEAR_TURN_EASE));
        pts.push(lanePoint(n[i], dIn, NEAR_TURN_DEEP, NEAR_TURN_IN));
        pts.push(lanePoint(n[i], dOut, NEAR_TURN_OUT));
        pts.push(lanePoint(n[i], dOut, NEAR_TURN_OUT + TURN_SETTLE));
      } else if (heavy && turn < -0.5 && turn > -2.8) {
        pts.push(lanePoint(n[i], dIn, -JUNCTION_EDGE));
        pts.push(lanePoint(n[i], dIn, FAR_TURN_DEEP));
        pts.push(lanePoint(n[i], dOut, FAR_TURN_OUT, FAR_TURN_HUG));
        pts.push(lanePoint(n[i], dOut, FAR_TURN_OUT + TURN_SETTLE));
      } else {
        pts.push(lanePoint(n[i], dIn, -JUNCTION_EDGE));
        pts.push(lanePoint(n[i], dOut, JUNCTION_EDGE));
      }
    }
    const last = dir(n[n.length - 2], n[n.length - 1]);
    pts.push(lanePoint(n[n.length - 1], last, -JUNCTION_EDGE));
    this.path = pts;
    this.segment = 0;
  }
}
