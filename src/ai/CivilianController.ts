// Civilian driver: wanders the road network in the right-hand lane, obeys traffic lights and
// stop signs, keeps its distance from whatever is ahead, and stops briefly when hit.
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { Rng } from '../core/Rng';
import type { RoadGraph } from '../world/RoadGraph';
import { signalState, type ApproachControl } from '../world/TrafficControl';
import type { Vehicle } from '../vehicles/Vehicle';
import { cornerSpeedLimit, purePursuit } from './pursuit';

const LANE_OFFSET = 3; // metres right of the road centre line
const JUNCTION_EDGE = 7; // lane points sit this far from the junction centre
const STOP_LINE = 6 + 4.4; // junction centre → stop line
const COMFORT_DECEL = 4; // m/s² for planned stops
const CORNER_SPEED = 6;
const GAP = 6; // metres kept to the vehicle ahead
const STOP_SIGN_WAIT = 1.2;
const STOP_MARGIN = 1.5; // metres short of the stop line

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
  ) {
    this.route = [from, to];
    this.cruise = rng.range(10, 13.5);
    this.extend();
    this.rebuild();
  }

  /** Bump from a collision: stop and collect yourself for a moment. */
  hit(): void {
    this.panicFor = 2.5;
  }

  update(dt: number, time: number): DriveInput {
    const v = this.vehicle;
    const pos = v.position;
    const speed = v.speed;
    const input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    // Advance the route once we're past the next junction.
    const next = this.graph.nodes[this.route[1]];
    const after = this.graph.nodes[this.route[2]];
    const leaving = { x: next.x + (after.x - next.x) * 0.15, z: next.z + (after.z - next.z) * 0.15 };
    if (Math.hypot(leaving.x - pos.x, leaving.z - pos.z) < 6) {
      this.route.shift();
      this.extend();
      this.rebuild();
      this.stoppedAt = null;
    }

    this.segment = purePursuit(this.path, this.segment, pos, 4 + 0.4 * Math.abs(speed), this.aim).segment;
    const fwd = v.forward();
    const toX = this.aim.x - pos.x;
    const toZ = this.aim.z - pos.z;
    const angle = Math.atan2(toX * -fwd.z + toZ * fwd.x, toX * fwd.x + toZ * fwd.z);
    input.steer = THREE.MathUtils.clamp(angle * 2.2, -1, 1);

    let desired = Math.min(this.cruise, cornerSpeedLimit(this.path, this.segment, pos, Math.abs(speed), CORNER_SPEED, COMFORT_DECEL));

    // Junction control on our approach to the next node.
    const junction = this.graph.nodes[this.route[1]];
    const toStop = Math.hypot(junction.x - pos.x, junction.z - pos.z) - STOP_LINE - v.spec.halfExtents.z;
    const control = this.controls.get(`${this.route[0]}>${this.route[1]}`);
    if (control && toStop > -1) {
      let mustStop = false;
      if (control.kind === 'signal') {
        const light = signalState(control.axis, time + control.phase);
        // Stop for red; for yellow only if we can stop comfortably.
        mustStop = light === 'red' || (light === 'yellow' && speed * speed > 0.01 && toStop > (speed * speed) / (2 * COMFORT_DECEL) * 0.6);
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
      if (mustStop) desired = Math.min(desired, toStop < STOP_MARGIN ? 0 : Math.sqrt(2 * COMFORT_DECEL * (toStop - STOP_MARGIN)));
    }

    // Keep a gap to whatever is ahead (cars, the player, cops).
    const free = this.sense(v, 30);
    if (free < Infinity) desired = Math.min(desired, Math.max(0, (free - GAP) * 0.8));

    if (this.panicFor > 0) {
      this.panicFor -= dt;
      desired = 0;
    }

    if (speed < desired - 0.3) input.throttle = desired - speed > 2 ? 1 : 0.5;
    else if (speed > desired + 0.5) input.brake = speed > 0.3 ? Math.min(1, (speed - desired) / 2) : 0;
    // Holding still: S below ~1 m/s means reverse, so hold the car on the handbrake instead.
    if (desired < 0.3 && Math.abs(speed) < 1) {
      input.brake = 0;
      input.throttle = 0;
      input.handbrake = true;
    }

    // Wanting to move but not moving (wedged against something).
    this.stuckFor = desired > 2 && Math.abs(speed) < 0.5 ? this.stuckFor + dt : 0;
    return input;
  }

  /** Keep at least three junctions of route ahead: random turns, no U-turns unless a dead end. */
  private extend(): void {
    while (this.route.length < 4) {
      const prev = this.route[this.route.length - 2];
      const cur = this.graph.nodes[this.route[this.route.length - 1]];
      const options = cur.neighbors.filter((n) => n !== prev);
      this.route.push(options.length ? this.rng.pick(options) : prev);
    }
  }

  /** Lane polyline: for each junction, an entry point and an exit point offset into the right lane. */
  private rebuild(): void {
    const g = this.graph;
    const n = this.route.map((id) => g.nodes[id]);
    const dir = (a: P, b: P) => {
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
    };
    const lanePoint = (at: P, d: { dx: number; dz: number }, along: number) =>
      new THREE.Vector3(at.x + d.dx * along + -d.dz * LANE_OFFSET, 0, at.z + d.dz * along + d.dx * LANE_OFFSET);
    const pts: THREE.Vector3[] = [];
    const first = dir(n[0], n[1]);
    pts.push(lanePoint(n[0], first, JUNCTION_EDGE));
    for (let i = 1; i < n.length - 1; i++) {
      const dIn = dir(n[i - 1], n[i]);
      const dOut = dir(n[i], n[i + 1]);
      pts.push(lanePoint(n[i], dIn, -JUNCTION_EDGE));
      pts.push(lanePoint(n[i], dOut, JUNCTION_EDGE));
    }
    const last = dir(n[n.length - 2], n[n.length - 1]);
    pts.push(lanePoint(n[n.length - 1], last, -JUNCTION_EDGE));
    this.path = pts;
    this.segment = 0;
  }
}
