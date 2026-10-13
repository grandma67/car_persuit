// Civilian road sense: spotting traffic about to cross our path before it hits us, and getting
// going again after a crash instead of sitting wedged in a jam. Pure logic; CivilianTraffic
// supplies what the world looks like.
import type { DriveInput } from '../core/Input';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Keep } from '../world/driveSide';

/** A moving heavy body (car, cop, the player), sampled once per frame. */
export interface Mover {
  handle: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  civilian: boolean; // follows the same give-way rules as us (unlike the player and cops)
}

/** The first thing the forward rays hit. side: which ray saw it (-1 left, 0 centre, +1 right). */
export interface Obstacle {
  distance: number;
  aligned: boolean; // pointing the same way as us (a queue), not across or at us (a crash)
  moving: boolean;
  side: number;
  handle?: number; // the body it is
  civilian?: boolean; // one of the traffic: queueing like us, never parked for good
  speed?: number; // m/s along our lane
  braking?: boolean; // its brake lights are on
}

export interface Awareness {
  /** Nearest dynamic body ahead within `range` (along `corridor`, the lane ahead, if given), null if the road is clear. */
  obstacle(vehicle: Vehicle, range: number, corridor?: readonly { x: number; z: number }[]): Obstacle | null;
  movers(): Mover[];
}

export interface Self {
  handle: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  fx: number; // unit heading
  fz: number;
  halfWidth: number;
  halfLength: number;
  turning: boolean;
  /**
   * Taking the kerb-side turn (right, or left keeping left) at the junction ahead: its centre and
   * our heading into it. That turn stays in the corner between our lane and the exit lane, so
   * traffic that never enters that corner (oncoming, or crossing in the far lane) is no threat.
   */
  nearTurn?: { x: number; z: number; ux: number; uz: number } | null;
}

const HAZARD_RANGE = 50; // metres
const HAZARD_HORIZON = 3; // seconds of look-ahead
const HAZARD_REACT = 1.2; // closer than this in time: stop
const HAZARD_MARGIN = 0.8; // metres of clearance wanted
const OTHER_HALF_WIDTH = 1.3; // assume a car-sized other
const OTHER_HALF_LENGTH = 2.5;
const CORNER_SLACK = 1; // metres past the centre lines a mover's centre may stray and still miss our corner
const CORNER_SAMPLES = 12;

/** Whether a mover's straight-line course over the horizon enters the corner a kerb-side turn sweeps. */
function entersCorner(turn: NonNullable<Self['nearTurn']>, m: Mover, keep: Keep): boolean {
  // u: along our approach (negative before the junction centre); s: toward the kerb side (the exit road).
  const sx = -turn.uz * keep;
  const sz = turn.ux * keep;
  for (let i = 0; i <= CORNER_SAMPLES; i++) {
    const t = (HAZARD_HORIZON * i) / CORNER_SAMPLES;
    const px = m.x + m.vx * t - turn.x;
    const pz = m.z + m.vz * t - turn.z;
    if (px * turn.ux + pz * turn.uz < CORNER_SLACK && px * sx + pz * sz > -CORNER_SLACK) return true;
  }
  return false;
}

/**
 * Speed limit that avoids a moving vehicle on a collision course (one crossing a junction in
 * front of us, running a light, or coming head-on): Infinity when nothing is coming. Stationary
 * bodies are left to the forward sensor, and anything behind us is ignored — braking for a car
 * about to rear-end us would only make it worse. Everyone gives way to the player and cops;
 * between civilians only one side gives way, or both would brake, then both creep on together:
 * yield to the right (to the left when keeping left), and a turning car yields to oncoming traffic.
 * A car turning onto its kerb side only minds traffic that will come into the corner it turns
 * through: it doesn't cross the oncoming lane or the far lane of the road it joins.
 * `civilians` false: leave other civilians out (junction turns sort out who goes first).
 */
export function hazardSpeedLimit(me: Self, movers: Mover[], speed: number, keep: Keep = 1, civilians = true): number {
  const rightX = -me.fz;
  const rightZ = me.fx;
  const sideClear = me.halfWidth + OTHER_HALF_WIDTH + HAZARD_MARGIN;
  const alongClear = me.halfLength + OTHER_HALF_LENGTH;
  let limit = Infinity;
  for (const m of movers) {
    if (m.handle === me.handle) continue;
    const rx = m.x - me.x;
    const rz = m.z - me.z;
    if (rx * me.fx + rz * me.fz < 0 || rx * rx + rz * rz > HAZARD_RANGE * HAZARD_RANGE) continue;
    if (m.vx * m.vx + m.vz * m.vz < 4) continue;
    if (m.civilian && !civilians) continue;
    if (me.nearTurn && !entersCorner(me.nearTurn, m, keep)) continue;
    if (m.civilian) {
      const onRight = (rx * rightX + rz * rightZ) * keep > 0; // keeping left: yield to the left
      const oncoming = m.vx * me.fx + m.vz * me.fz < 0;
      if (!onRight && !(oncoming && me.turning)) continue;
    }
    // Closest approach under constant velocities, in our frame.
    const wx = m.vx - me.vx;
    const wz = m.vz - me.vz;
    const w2 = wx * wx + wz * wz;
    if (w2 < 1) continue;
    const t = -(rx * wx + rz * wz) / w2;
    if (t <= 0 || t > HAZARD_HORIZON) continue;
    const cx = rx + wx * t;
    const cz = rz + wz * t;
    const along = cx * me.fx + cz * me.fz;
    const side = cx * rightX + cz * rightZ;
    if (Math.abs(side) > sideClear || along < -alongClear || along > alongClear + HAZARD_MARGIN) continue;
    const allowed = t <= HAZARD_REACT ? 0 : (Math.abs(speed) * (t - HAZARD_REACT)) / (HAZARD_HORIZON - HAZARD_REACT);
    limit = Math.min(limit, allowed);
  }
  return limit;
}

const UNSTICK_AFTER = 2.5; // seconds wedged against a crash before backing off
const QUEUE_PATIENCE = 25; // seconds behind a stopped car facing our way (longer than any red)
const REVERSE_TIME = 1.3;
const DODGE_TIME = 5; // seconds driving round it, at walking pace
const MAX_TRIES = 3; // back-offs without progress before giving up (the manager recycles us)
const RECENT_HIT = 10; // seconds after a knock during which a blockage counts as a crash

/**
 * After a crash: if we're wedged against a car sideways across our lane (or one we just hit),
 * back off for a moment, then pull out round it and carry on along the route.
 */
export class CrashRecovery {
  private reverseFor = 0;
  private reverseSteer = 0;
  private blockedFor = 0;
  private tries = 0;
  private sinceHit = Infinity;
  /** Seconds left steering round the blockage, and which side of the lane (-1 left, +1 right). */
  dodgeFor = 0;
  dodgeSide = -1;
  /** Backing off hasn't worked several times: the manager should recycle the car. */
  gaveUp = false;

  /** keep: +1 traffic keeps right (pass blockages on the left), -1 keeps left. */
  constructor(private keep: Keep = 1) {}

  hit(): void {
    this.sinceHit = 0;
  }

  /** We've made it to the next junction: whatever was in the way is behind us. */
  progress(): void {
    this.tries = 0;
  }

  /** Advance timers; while backing away from a crash, returns the input to use instead. */
  override(dt: number): DriveInput | null {
    this.sinceHit += dt;
    // The dodge clock runs once we're driving forward again.
    if (this.reverseFor <= 0) {
      if (this.dodgeFor > 0) this.dodgeFor -= dt;
      return null;
    }
    this.reverseFor -= dt;
    // S at a standstill reverses.
    return { throttle: 0, brake: 1, steer: this.reverseSteer, handbrake: false };
  }

  /** One step of normal driving, given what's directly ahead and the gap we keep to it. */
  observe(dt: number, ahead: Obstacle | null, speed: number, gap: number): void {
    if (!ahead || ahead.distance > gap + 2 || Math.abs(speed) > 0.5) {
      this.blockedFor = 0;
      return;
    }
    const crash = !ahead.aligned || this.sinceHit < RECENT_HIT;
    // Queued behind another civilian: it's waiting its turn at a junction like us, so wait too
    // (pulling out round the queue is driving down the oncoming lane). If it's really stuck, the
    // manager recycles it and the queue moves.
    const queue = !crash && ahead.civilian;
    const patience = crash && !ahead.moving ? UNSTICK_AFTER : ahead.moving || queue ? Infinity : QUEUE_PATIENCE;
    this.blockedFor += dt;
    if (this.blockedFor < patience) return;
    this.blockedFor = 0;
    if (++this.tries > MAX_TRIES) {
      this.gaveUp = true;
      return;
    }
    // Pull out away from the blocker: on the overtaking side (away from the kerb) by default.
    this.dodgeSide = ahead.side < 0 ? 1 : ahead.side > 0 ? -1 : -this.keep;
    this.dodgeFor = DODGE_TIME;
    this.reverseFor = REVERSE_TIME;
    // Reversing swings the nose opposite to the wheels, so steer away from the side we'll pass on.
    this.reverseSteer = -this.dodgeSide;
  }
}
