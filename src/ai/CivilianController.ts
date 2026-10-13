// Civilian driver: wanders the road network in its lane (the right-hand one, or the left in an
// English city: `keep` mirrors every side below), obeys traffic lights and
// stop signs, keeps its distance from whatever is ahead, yields to traffic about to cross its
// path, and after a crash backs off and drives round whatever it's wedged against.
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import { signalState, type ApproachControl } from '../world/TrafficControl';
import type { Vehicle } from '../vehicles/Vehicle';
import { cornerSpeedLimit, purePursuit, turnAngle } from './pursuit';
import { CrashRecovery, hazardSpeedLimit, type Awareness, type Obstacle, type Self } from './awareness';
import type { Keep } from '../world/driveSide';

const LANE_OFFSET = 3; // metres to the kerb side of the road centre line
const JUNCTION_EDGE = 7; // lane points sit this far from the junction centre
const STOP_LINE = 6 + 4.4; // junction centre → stop line
const COMFORT_DECEL = 4; // m/s² for planned stops
const CORNER_SPEED = 6;
const GAP = 6; // metres kept to the vehicle ahead
const STOP_SIGN_WAIT = 1.2;
const STOP_MARGIN = 1.5; // metres short of the stop line
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
// Where a heavy's near-side turn (right, or left keeping left) pivots, relative to its turning
// radius (see rightTurnStart). Tuned in
// CivilianTurns.test: 2m less and the front swings over the far kerb, 2m more and the rear wheels
// cut over the near kerb corner.
const RIGHT_TURN_SETBACK = 12.5;
// Physics steps between looks around (rays ahead, crossing traffic): 20 a second is plenty to
// react, and sensing every step for every car was the bulk of the traffic AI's cost.
const SENSE_EVERY = 3;

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
  /** Heavies: where the right turn pivots, metres along the approach from the junction centre (null: a car's line). */
  rightTurnStart: number | null;
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
    // A car cuts the right-turn corner from 7m before the junction centre; a heavy can't turn that
    // tight. It carries on deeper and pivots on a corner further in, so it sweeps a wider arc.
    rightTurnStart: heavy ? turnRadius - RIGHT_TURN_SETBACK : null,
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
  private style: DrivingStyle;
  private senseIn = 0; // steps until the next look around
  private ahead: Obstacle | null = null;
  private free = Infinity;
  private hazardLimit = Infinity;
  readonly cruise: number;
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
  ) {
    this.recovery = new CrashRecovery(keep);
    this.route = [from, to];
    // Buses and trucks cruise a little slower than cars.
    this.cruise = Math.min(rng.range(10, 13.5), vehicle.spec.maxSpeed - 3);
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
      this.recovery.progress();
    }

    // Pure pursuit from the rear axle (bicycle model): steer onto the arc through the aim point.
    // Measuring from the rear axle is what makes a long vehicle start its turn late enough.
    const { wheelbase, cornerSpeed, decel } = this.style;
    const fwd = v.forward();
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

    let desired = Math.min(this.cruise, cornerSpeedLimit(this.path, this.segment, pos, Math.abs(speed), cornerSpeed, decel));

    // Junction control on our approach to the next node.
    const junction = this.graph.nodes[this.route[1]];
    const toStop = Math.hypot(junction.x - pos.x, junction.z - pos.z) - STOP_LINE - v.spec.halfExtents.z;
    const control = this.controls.get(`${this.route[0]}>${this.route[1]}`);
    if (control && toStop > -1) {
      let mustStop = false;
      if (control.kind === 'signal') {
        const light = signalState(control.axis, time + control.phase);
        // Stop for red; for yellow only if we can stop comfortably.
        mustStop = light === 'red' || (light === 'yellow' && speed * speed > 0.01 && toStop > (speed * speed) / (2 * decel) * 0.6);
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

    // Keep a gap to whatever is ahead (cars, the player, cops), looking further the faster we go.
    // Looking around (forward rays, then traffic about to cross us) runs every few steps.
    if (--this.senseIn <= 0) {
      this.senseIn = SENSE_EVERY;
      const range = Math.max(30, (speed * speed) / (2 * decel) + GAP + 10);
      this.ahead = this.awareness?.obstacle(v, range) ?? null;
      this.free = this.awareness ? (this.ahead?.distance ?? Infinity) : this.sense(v, range);
      // Yield to anything on a collision course: cross traffic, a light-runner, the player head-on.
      this.hazardLimit = Infinity;
      if (this.awareness) {
        const lv = v.body.linvel();
        const self: Self = { handle: v.body.handle, x: pos.x, z: pos.z, vx: lv.x, vz: lv.z, fx: fwd.x, fz: fwd.z, halfWidth: v.spec.halfExtents.x, halfLength: v.spec.halfExtents.z, turning: Math.abs(input.steer) > 0.3, nearTurn: this.nearTurn(pos) };
        this.hazardLimit = hazardSpeedLimit(self, this.awareness.movers(), speed, this.keep);
      }
    }
    const { ahead, free } = this;
    const gap = dodging ? DODGE_GAP : GAP;
    if (free < Infinity) desired = Math.min(desired, Math.max(0, (free - gap) * 0.8));
    if (dodging) desired = Math.min(desired, DODGE_SPEED);
    desired = Math.min(desired, this.hazardLimit);

    if (this.panicFor > 0) {
      this.panicFor -= dt;
      desired = 0;
    } else {
      this.recovery.observe(dt, ahead, speed, gap);
    }

    const { maxThrottle } = this.style;
    if (speed < desired - 0.3) input.throttle = (desired - speed > 2 ? 1 : 0.5) * maxThrottle;
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
   * Turn signal: the side we're pulling out to round an obstacle, else the turn at the next
   * junction from SIGNAL_DISTANCE out until we've left it (straight on: none).
   */
  private signal(pos: P, dodging: boolean): 'left' | 'right' | null {
    if (dodging) return this.recovery.dodgeSide > 0 ? 'right' : 'left';
    const [a, b, c] = this.route.slice(0, 3).map((id) => this.graph.nodes[id]);
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
    if (this.style.rightTurnStart !== null) return null;
    const [a, b, c] = this.route.slice(0, 3).map((id) => this.graph.nodes[id]);
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
      const easy = this.style.rightTurnStart === null ? options : options.filter((n) => turnAngle(from, cur, this.graph.nodes[n]) * this.keep <= 0.5);
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
    const { rightTurnStart: start, turnRadius } = this.style;
    const pts: THREE.Vector3[] = [];
    const first = dir(n[0], n[1]);
    pts.push(lanePoint(n[0], first, JUNCTION_EDGE));
    for (let i = 1; i < n.length - 1; i++) {
      const dIn = dir(n[i - 1], n[i]);
      const dOut = dir(n[i], n[i + 1]);
      pts.push(lanePoint(n[i], dIn, -JUNCTION_EDGE));
      if (start !== null && turnAngle(n[i - 1], n[i], n[i + 1]) * k > 0.5) {
        // Heavy turning near-side: carry on deeper into the junction before turning, swing a wide
        // arc onto the new road, then ease back into the right lane.
        pts.push(lanePoint(n[i], dIn, start));
        pts.push(lanePoint(n[i], dOut, LANE_OFFSET + turnRadius, -start));
        pts.push(lanePoint(n[i], dOut, LANE_OFFSET + turnRadius + 14));
      } else {
        pts.push(lanePoint(n[i], dOut, JUNCTION_EDGE));
      }
    }
    const last = dir(n[n.length - 2], n[n.length - 1]);
    pts.push(lanePoint(n[n.length - 1], last, -JUNCTION_EDGE));
    this.path = pts;
    this.segment = 0;
  }
}
