import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { DriveInput } from '../core/Input';
import { RAMP, rampHullPoints, type VehicleSpec } from './VehicleSpecs';
import { buildCarMesh, setGlow, type CarMesh } from './carMesh';
import { gearFor } from './gears';

const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(-1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();
const BRAKE_LIGHT_HOLD = 0.4; // seconds
const INDICATOR_HZ = 1.5; // turn-signal flashes per second
// Footbrake balance: weight shifts forward under braking, so real cars put ~65% of it on the front.
const FRONT_BRAKE = 1.3;
const REAR_BRAKE = 0.7;
// Rear grip while drifting (0 = handbrake-locked, 1 = full grip), per second.
const DRIFT_GRIP_DROP = 10; // handbrake pulled: rear lets go almost at once
const DRIFT_GRIP_RECOVER = 1.2; // released: grip returns gradually, so the slide carries on
const DRIFT_GRIP_POWER = 0.45; // on the throttle mid-slide the rears keep spinning: grip holds here (power oversteer)
const DRIFT_MIN_SPEED = 6; // m/s; below this the handbrake just holds the car
const DRIFT_YAW_KICK = 5; // rad/s² of extra rotation toward the steer while the handbrake is pulled
const DRIFT_MAX_YAW = 2.4; // rad/s; spin cap so a drift stays catchable
const DRIFT_POWER_PUSH = 9; // m/s² along the slide on full throttle at zero rear grip, so drifts keep their speed
const DRIFT_HOLD_SLIP = 0.12; // rad; a slide at least this sideways counts as still drifting
const DRIFT_CARRY = 0.9; // per second: how fast the velocity swings toward the nose mid-slide
// Body on its suspension (visual only). Load moves to the front axle in proportion to deceleration
// (m·a·h / wheelbase), so the nose dives under braking and the tail squats pulling away, and the
// body leans out of corners. A damped spring, a touch under-damped so it rocks back once when the
// car stops. Angles in radians per m/s² of acceleration, capped.
const BODY_PITCH = 0.0042;
const BODY_ROLL = 0.0035;
const BODY_MAX_TILT = 0.07;
const BODY_FREQ = 11; // rad/s
const BODY_DAMPING = 0.45; // fraction of critical
const ACCEL_SMOOTHING = 14; // per second: low-pass on the measured acceleration (contact jitter)
// Gear changes (player only): the drive is cut while the clutch is in, then bites again with a kick:
// the tail squats and the engine's torque twists the body. Flooring it from low speed twists it too.
const SHIFT_CUT = 0.14; // seconds
const SHIFT_CUT_DRIVE = 0.15; // share of the engine force left during the cut
const SHIFT_KICK_PITCH = 0.35; // rad/s squat as the clutch bites
const TORQUE_KICK_ROLL = 0.28; // rad/s torque reaction twist
// Knocked by a crash: a hard shove sideways overwhelms the tyres on the axle that took it, and
// they slide. Sliding rubber is plain kinetic friction (~0.75 g on dry asphalt: a steady drag, not
// a grip), far below this car's arcade cornering grip, so while an axle is knocked its side grip is
// swapped for that drag, applied at the axle, until its slide dies down. A T-bone shoves the whole
// car sideways; a clip on the rear corner knocks only the rears loose and the car pivots round its
// still-gripping fronts, like a PIT. Without it the tyres cancel a shove within a car length.
const KNOCK_FULL_SHOVE = 5; // m/s of sideways velocity change at an axle in a step for a full knock
const SLIDE_FRICTION = 0.75; // × g, tyres sliding sideways
const KNOCK_SETTLED = 1.5; // m/s sideways at the axle below which its tyres start to bite again
const KNOCK_RECOVER = 3; // per second, once settled
// In the air (arcade air control): pitch and roll spin is damped and the body eased back level, so
// a car that leaves a lip nose-down or twisted still comes down on its wheels instead of digging
// its bumper in. Yaw is left alone. Kicks in after a short hop so kerbs and bumps feel unchanged.
const AIR_CONTROL_AFTER = 0.12; // seconds airborne
const AIR_SPIN_DAMP = 3.5; // per second
const AIR_LEVEL = 5; // rad/s² per radian of tilt
// The springs and tyres take a landing along the car's own up axis: that share of a jolt counts
// this much toward the impact (damage, crunch); hits from the side or onto the roof count in full.
const SUSPENSION_ABSORB = 0.35;

// Collision groups (membership << 16 | filter). Debris in CAR_PASSES rests on the ground and on
// fixed things but not on cars, their wheel rays or forward sensors: a barrier's long fallen arm
// would otherwise wedge across a corridor like a wall.
export const CAR_PASSES = 0x0002;
export const CAR_GROUPS = ((0xffff << 16) | (0xffff & ~CAR_PASSES)) >>> 0;

// A Rapier raycast vehicle plus its mesh. The same class drives the player and (later) cops;
// only the DriveInput source differs.
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly mesh: CarMesh;
  private steer = 0;
  /** Last input applied, for audio and lights. */
  lastInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** Headlight strength: 0 by day, 1 at night. Set from the time of day. */
  headlights = 0;
  /**
   * Traction assist for AI civilians, per second: bleeds off sideways sliding and spin so they
   * hold their lane instead of drifting into each other. 0 = pure physics (player, cops).
   */
  tractionAssist = 0;
  private brakeLightTimer = 0; // seconds the brake lights stay lit after the last brake input
  /** Road-lighting spotlight; cops use glowing lamps only. */
  beamEnabled = true;
  /** All lights out (wrecked). */
  lightsOff = false;
  /** Turn signal the driver has on; set by the AI. */
  private signal: 'left' | 'right' | null = null;
  private signalSince = 0;
  /** 0..1 how hard the tyres are sliding (drift, handbrake or locked brakes). */
  skid = 0;
  /**
   * 0..1 how hard the front tyres are sliding: scrubbing sideways (understeer, a spin) or braking
   * hard. Not the handbrake: that locks only the rears, and in a drift the fronts point where the
   * car is going, so they roll and leave no mark.
   */
  frontSkid = 0;
  /** Simulated gearbox with shift cuts and kicks (the player's car). */
  gearShifts = false;
  private gear = 0;
  private shiftCut = 0;
  private shifted = false;
  private lastThrottle = 0;
  private stepDt = 1 / 60;
  private accelLong = 0; // smoothed, m/s², along the car (+ = speeding up)
  private accelLat = 0; // smoothed, m/s², toward the car's left
  private pitch = 0; // body tilt, rad (+ = nose down)
  private pitchVel = 0;
  private roll = 0; // rad (+ = left side up)
  private rollVel = 0;
  /** Rear tyre grip, 0 (locked and sliding) .. 1 (normal). Drops on the handbrake, recovers after. */
  private rearGrip = 1;
  private airborneFor = 0; // seconds with no wheel touching
  /** 0..1 how hard the last crash knocked each axle's tyres loose, front and rear (see SLIDE_FRICTION). */
  readonly knock = [0, 0];
  private lastYawRate = 0;
  private gripScale = 1; // road grip (wet, ice)
  // Collision detection by sudden velocity change; contact forces don't scale usefully with impact speed.
  private lastVel = new THREE.Vector3();
  private impact = 0;
  /** Velocity just before the strongest recent impact (direction of travel into the obstacle). */
  readonly impactVelocity = new THREE.Vector3();
  /** Velocity lost in that impact: points from the car toward what it hit. */
  readonly impactPush = new THREE.Vector3();
  // Previous/current physics transforms, for render interpolation between fixed steps.
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currPos = new THREE.Vector3();
  private currQuat = new THREE.Quaternion();

  constructor(
    private world: RAPIER.World,
    readonly spec: VehicleSpec,
    position: { x: number; y: number; z: number },
    yaw = 0,
  ) {
    const { x: hx, y: hy, z: hz } = spec.halfExtents;
    const rot = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAngularDamping(0.8)
        .setLinearDamping(0.05),
    );
    this.body.userData = this; // so whoever sees the body (a driver behind) can see its brake lights
    // Explicit mass properties: lowered centre of mass so the car resists rolling.
    const m = spec.mass;
    const [w, h, d] = [hx * 2, hy * 2, hz * 2];
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(
          m,
          { x: 0, y: -hy, z: 0 },
          { x: (m / 12) * (h * h + d * d), y: (m / 12) * (w * w + d * d), z: (m / 12) * (w * w + h * h) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.4)
        .setRestitution(0.1)
        .setCollisionGroups(CAR_GROUPS),
      this.body,
    );
    if (spec.body === 'ramptruck') this.addRampColliders();

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    // Wheel order: FL, FR, RL, RR (+X is the car's left side when facing +Z).
    const wy = spec.wheelY ?? 0;
    const wheelPositions = [
      { x: spec.wheelX, y: wy, z: spec.wheelZ },
      { x: -spec.wheelX, y: wy, z: spec.wheelZ },
      { x: spec.wheelX, y: wy, z: -spec.wheelZ },
      { x: -spec.wheelX, y: wy, z: -spec.wheelZ },
    ];
    wheelPositions.forEach((p, i) => {
      this.controller.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspensionRestLength, spec.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, spec.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, 0.83 * 2 * Math.sqrt(spec.suspensionStiffness) * 0.3);
      this.controller.setWheelSuspensionRelaxation(i, 0.88 * 2 * Math.sqrt(spec.suspensionStiffness) * 0.3);
      this.controller.setWheelMaxSuspensionTravel(i, 0.3);
      this.controller.setWheelMaxSuspensionForce(i, spec.mass * 40);
      this.controller.setWheelFrictionSlip(i, spec.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, spec.sideFriction);
    });

    this.mesh = buildCarMesh(spec);
    this.snapshot();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Deck wedge and cab: massless extra colliders on the same body (the chassis carries the mass). */
  private addRampColliders(): void {
    const deck = RAPIER.ColliderDesc.convexHull(rampHullPoints(this.spec));
    if (deck) this.world.createCollider(deck.setDensity(0).setFriction(1.2).setRestitution(0).setCollisionGroups(CAR_GROUPS), this.body);
    const { z0, z1, top } = RAMP.cab;
    const bottom = -this.spec.halfExtents.y;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(RAMP.halfWidth, (top - bottom) / 2, (z1 - z0) / 2)
        .setTranslation(0, (top + bottom) / 2, (z0 + z1) / 2)
        .setDensity(0)
        .setFriction(0.4)
        .setCollisionGroups(CAR_GROUPS),
      this.body,
    );
  }

  /** Signed forward speed in m/s. */
  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  get position(): THREE.Vector3 {
    return this.currPos;
  }

  get quaternion(): THREE.Quaternion {
    return this.currQuat;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(FORWARD).applyQuaternion(this.currQuat);
  }

  /** Sideways velocity in m/s (positive = sliding right). */
  get lateralSpeed(): number {
    const v = this.body.linvel();
    tmpVec.copy(RIGHT).applyQuaternion(this.currQuat);
    return v.x * tmpVec.x + v.y * tmpVec.y + v.z * tmpVec.z;
  }

  /** Any wheel touching the ground (false only when the car is in the air). */
  get grounded(): boolean {
    return [0, 1, 2, 3].some((i) => this.controller.wheelIsInContact(i));
  }

  /** World-space ground contact point of a wheel, or null if it is in the air. */
  wheelContact(i: number, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.controller.wheelIsInContact(i)) return null;
    const p = this.controller.wheelContactPoint(i);
    return p ? out.set(p.x, p.y, p.z) : null;
  }

  /** Apply driver input. Call once per fixed step, before world.step(). */
  drive(input: DriveInput, dt: number): void {
    const s = this.spec;
    const c = this.controller;
    const speed = this.speed;
    const speedRatio = Math.min(Math.abs(speed) / s.maxSpeed, 1);

    // Smoothed, speed-sensitive steering. Positive wheel angle turns left, so negate.
    const maxDelta = s.steerRate * dt;
    this.steer += THREE.MathUtils.clamp(input.steer - this.steer, -maxDelta, maxDelta);
    const steerAngle = -this.steer * THREE.MathUtils.lerp(s.maxSteer, s.minSteer, speedRatio);
    c.setWheelSteering(0, steerAngle);
    c.setWheelSteering(1, steerAngle);

    let engine = 0;
    let brake = 0;
    if (input.throttle > 0) {
      if (speed < -1) brake = s.brakeForce; // pressing W while rolling backwards
      else if (speed < s.maxSpeed) engine = s.engineForce * input.throttle;
    } else if (input.brake > 0) {
      if (speed > 1) brake = s.brakeForce * input.brake;
      else if (speed > -s.maxReverseSpeed) engine = -s.reverseForce * input.brake;
    } else {
      brake = 1.5; // engine braking when coasting
    }

    if (this.gearShifts) engine = this.gearbox(input, speed, engine, dt);
    this.stepDt = dt;

    const absSpeed = Math.abs(speed);
    const drifting = this.updateRearGrip(input, speed, dt);
    // Handbrake = rear wheels only, clutch in: the locked rears get no drive.
    if (input.handbrake) engine = 0;
    // Locked rears slide sideways at any speed; after release their grip comes back gradually.
    const rearSide = input.handbrake ? s.driftSideFriction : THREE.MathUtils.lerp(s.driftSideFriction, s.sideFriction, this.rearGrip);
    const knockedFront = this.knock[0] > 0 ? this.slideAfterKnock(0, dt) : 1;
    const knockedRear = this.knock[1] > 0 ? this.slideAfterKnock(1, dt) : 1;

    // Rear-wheel drive.
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      c.setWheelEngineForce(i, rear ? engine : 0);
      c.setWheelBrake(i, rear ? (input.handbrake ? s.handbrakeForce : brake * REAR_BRAKE) : brake * FRONT_BRAKE);
      c.setWheelSideFrictionStiffness(i, rear ? rearSide * knockedRear : s.sideFriction * knockedFront);
    }

    c.updateVehicle(dt, undefined, CAR_GROUPS);
    if (drifting && speed > 0) this.driftAssist(input, dt);
    this.lastInput = input;
    // Brake lights follow real braking (not coasting), held briefly so feathering doesn't flicker.
    const braking = (input.brake > 0 && speed > 0.5) || input.handbrake;
    this.brakeLightTimer = braking ? BRAKE_LIGHT_HOLD : Math.max(0, this.brakeLightTimer - dt);

    // Skid intensity: sideways slide, handbrake lock, or hard braking at speed.
    let skid = THREE.MathUtils.clamp((Math.abs(this.lateralSpeed) - 2.5) / 6, 0, 1);
    if (input.handbrake && absSpeed > 5) skid = Math.max(skid, 0.6);
    if (absSpeed > DRIFT_MIN_SPEED) skid = Math.max(skid, (1 - this.rearGrip) * 0.8);
    // Hard cornering at high speed: grip holds, but the tyres still squeal a little.
    skid = Math.max(skid, Math.abs(this.steer) * THREE.MathUtils.clamp((absSpeed - 20) / 15, 0, 1) * 0.35);
    if (brake >= s.brakeForce * 0.5 && absSpeed > 8) skid = Math.max(skid, 0.4);
    this.skid = c.wheelIsInContact(2) || c.wheelIsInContact(3) ? skid : 0;
    // Weight moves forward under braking, so the fronts mark hardest when you stand on the brakes.
    let frontSkid = THREE.MathUtils.clamp((Math.abs(this.frontSlipSpeed(steerAngle)) - 2.5) / 6, 0, 1);
    if (brake >= s.brakeForce * 0.5 && absSpeed > 8) frontSkid = Math.max(frontSkid, 0.5);
    this.frontSkid = c.wheelIsInContact(0) || c.wheelIsInContact(1) ? frontSkid : 0;

    // A knocked civilian slides like anyone else; the lane-keeping help returns as it recovers.
    if (this.tractionAssist > 0 && this.knock[0] + this.knock[1] === 0 && (c.wheelIsInContact(0) || c.wheelIsInContact(2))) this.assistTraction(dt);
    this.airborneFor = this.grounded ? 0 : this.airborneFor + dt;
    if (this.airborneFor > AIR_CONTROL_AFTER) this.airControl(dt);

    // Speed-scaled downforce keeps the car planted in fast corners.
    const rot = this.body.rotation();
    tmpVec.copy(UP).applyQuaternion(tmpQuat.set(rot.x, rot.y, rot.z, rot.w));
    const f = -s.downforce * Math.abs(speed) * dt;
    this.body.applyImpulse({ x: tmpVec.x * f, y: tmpVec.y * f, z: tmpVec.z * f }, true);
  }

  /**
   * Handbrake drops rear grip fast; on release it comes back slowly, and holds partway while the
   * driver stays on the throttle in a slide. Returns whether the car is in a drift.
   */
  private updateRearGrip(input: DriveInput, speed: number, dt: number): boolean {
    let target = 1;
    let rate = DRIFT_GRIP_RECOVER;
    // Forward speed only: a car shoved sideways (or reversing) on the handbrake isn't drifting.
    if (input.handbrake && speed > DRIFT_MIN_SPEED) {
      target = 0;
      rate = DRIFT_GRIP_DROP;
    } else if (this.rearGrip < 1 && input.throttle > 0 && Math.abs(this.slipAngle()) > DRIFT_HOLD_SLIP) {
      target = DRIFT_GRIP_POWER;
    }
    if (speed < DRIFT_MIN_SPEED * 0.5) target = 1; // stopped: no drift to hold
    const step = rate * dt;
    this.rearGrip += THREE.MathUtils.clamp(target - this.rearGrip, -step, step);
    return this.rearGrip < 0.98;
  }

  /**
   * Gear changes: on an upshift under throttle the drive is mostly cut for SHIFT_CUT, then bites
   * again with a kick to the body. Snapping the throttle open from low speed kicks it too. Returns
   * the engine force to apply.
   */
  private gearbox(input: DriveInput, speed: number, engine: number, dt: number): number {
    const gear = gearFor(speed);
    if (gear > this.gear && input.throttle > 0 && speed > 0) this.shiftCut = SHIFT_CUT;
    this.gear = gear;
    if (this.shiftCut > 0) {
      this.shiftCut -= dt;
      if (this.shiftCut > 0) return engine * SHIFT_CUT_DRIVE;
      // Clutch bites: squat, and the engine twists the body against its rotation.
      this.pitchVel -= SHIFT_KICK_PITCH * input.throttle;
      this.rollVel += TORQUE_KICK_ROLL * 0.6 * input.throttle;
      this.shifted = true;
    }
    if (input.throttle > 0.6 && this.lastThrottle < 0.1 && speed > -1 && speed < 12) {
      this.rollVel += TORQUE_KICK_ROLL;
      this.pitchVel -= SHIFT_KICK_PITCH * 0.5;
    }
    this.lastThrottle = input.throttle;
    return engine;
  }

  /** A gear change just completed (for the exhaust puff); clears the flag. */
  consumeShift(): boolean {
    const s = this.shifted;
    this.shifted = false;
    return s;
  }

  /** Body pitch and roll on the suspension, from the acceleration this step (see BODY_PITCH). */
  private updateBody(ax: number, ay: number, az: number, dt: number): void {
    const f = this.forward(tmpVec);
    const along = ax * f.x + ay * f.y + az * f.z;
    const left = ax * f.z - az * f.x; // horizontal, toward the car's left (+X)
    const k = Math.min(1, ACCEL_SMOOTHING * dt);
    const grounded = this.grounded;
    // In the air nothing loads the springs: the body settles level.
    this.accelLong += ((grounded ? along : 0) - this.accelLong) * k;
    this.accelLat += ((grounded ? left : 0) - this.accelLat) * k;
    const pitchTarget = THREE.MathUtils.clamp(-this.accelLong * BODY_PITCH, -BODY_MAX_TILT, BODY_MAX_TILT);
    const rollTarget = THREE.MathUtils.clamp(this.accelLat * BODY_ROLL, -BODY_MAX_TILT, BODY_MAX_TILT);
    const w2 = BODY_FREQ * BODY_FREQ;
    const c = 2 * BODY_DAMPING * BODY_FREQ;
    this.pitchVel += (w2 * (pitchTarget - this.pitch) - c * this.pitchVel) * dt;
    this.rollVel += (w2 * (rollTarget - this.roll) - c * this.rollVel) * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.pitchVel * dt, -BODY_MAX_TILT * 1.5, BODY_MAX_TILT * 1.5);
    this.roll = THREE.MathUtils.clamp(this.roll + this.rollVel * dt, -BODY_MAX_TILT * 1.5, BODY_MAX_TILT * 1.5);
  }

  /**
   * Arcade help that makes drifts satisfying rather than a spin: a yaw kick toward the steer while
   * the handbrake is pulled, a cap on spin, and velocity that swings toward the nose so a held slide
   * carries its speed around the corner and counter-steer straightens it out.
   */
  private driftAssist(input: DriveInput, dt: number): void {
    const w = this.body.angvel();
    let yaw = w.y;
    // Positive yaw turns left; positive steer is right.
    if (input.handbrake) yaw -= Math.sign(input.steer) * Math.min(1, Math.abs(input.steer)) * DRIFT_YAW_KICK * dt;
    yaw = THREE.MathUtils.clamp(yaw, -DRIFT_MAX_YAW, DRIFT_MAX_YAW);
    this.body.setAngvel({ x: w.x, y: yaw, z: w.z }, true);

    const v = this.body.linvel();
    const flat = Math.hypot(v.x, v.z);
    if (flat < 1) return;
    // Spinning rears still push: on the throttle the slide holds its speed instead of scrubbing off.
    if (!input.handbrake && input.throttle > 0 && flat < this.spec.maxSpeed) {
      const k = 1 + (DRIFT_POWER_PUSH * input.throttle * (1 - this.rearGrip) * dt) / flat;
      v.x *= k;
      v.z *= k;
    }
    // Swing the velocity a fraction of the way toward the heading each step; speed is kept.
    const slip = this.slipAngle();
    if (Math.abs(slip) > Math.PI / 2) return; // facing backwards: let it spin out
    const turn = -slip * Math.min(1, DRIFT_CARRY * (1 - this.rearGrip * 0.5) * dt);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    this.body.setLinvel({ x: v.x * cos + v.z * sin, y: v.y, z: -v.x * sin + v.z * cos }, true);
  }

  /**
   * One knocked axle (0 front, 1 rear): its side grip mostly gone (returned as the share left for
   * its wheels), its sideways slide braked by kinetic friction at the axle instead, which turns the
   * car as well as slowing it. Once the axle has settled its grip comes back.
   */
  private slideAfterKnock(axle: 0 | 1, dt: number): number {
    const d = axle === 0 ? this.spec.wheelZ : -this.spec.wheelZ; // axle offset along the car
    const v = this.body.linvel();
    const w = this.body.angvel();
    const f = this.forward(tmpVec);
    // Sideways velocity at the axle, along (f.z, -f.x): the body's plus the spin swinging it.
    const u = v.x * f.z - v.z * f.x + w.y * d;
    if (Math.abs(u) < KNOCK_SETTLED) this.knock[axle] = Math.max(0, this.knock[axle] - KNOCK_RECOVER * dt);
    const k = Math.min(1, this.knock[axle] * 2);
    if (this.grounded) {
      const { x: hx, z: hz } = this.spec.halfExtents;
      const m = this.spec.mass;
      const inertia = (m / 12) * (4 * hx * hx + 4 * hz * hz);
      // Each axle carries half the weight; never push past stopping the axle's slide.
      const stop = Math.abs(u) / (1 / m + (d * d) / inertia);
      const j = -Math.sign(u) * Math.min(stop, SLIDE_FRICTION * 9.81 * this.gripScale * (m / 2) * k * dt);
      this.body.setLinvel({ x: v.x + (f.z * j) / m, y: v.y, z: v.z - (f.x * j) / m }, true);
      this.body.setAngvel({ x: w.x, y: w.y + (j * d) / inertia, z: w.z }, true);
    }
    return 1 - 0.97 * k;
  }

  /** Damp pitch and roll spin in the air and ease the body level (see AIR_SPIN_DAMP). */
  private airControl(dt: number): void {
    const r = this.body.rotation();
    const up = tmpVec.copy(UP).applyQuaternion(tmpQuat.set(r.x, r.y, r.z, r.w));
    if (up.y < 0) return; // upside down already: no saving it
    // Axis and angle that would bring the car's up back to world up (up × Y, |.| = sin tilt).
    const ax = -up.z;
    const az = up.x;
    const w = this.body.angvel();
    // Split the spin into yaw (about world up, kept) and the tumble (pitch and roll, damped).
    const damp = Math.min(1, AIR_SPIN_DAMP * dt);
    const level = AIR_LEVEL * dt;
    this.body.setAngvel({ x: w.x * (1 - damp) + ax * level, y: w.y, z: w.z * (1 - damp) + az * level }, true);
  }

  /** Signed angle between where the car points and where it's going (radians, 0 = no slide). */
  private slipAngle(): number {
    const v = this.body.linvel();
    const f = this.forward(tmpVec);
    return Math.atan2(v.x * f.z - v.z * f.x, v.x * f.x + v.z * f.z);
  }

  /** Sideways speed of the front tyres across the way they're steered (m/s, 0 = rolling true). */
  private frontSlipSpeed(steerAngle: number): number {
    const v = this.body.linvel();
    const wy = this.body.angvel().y;
    const f = this.forward(tmpVec);
    // Velocity at the front axle: the body's, plus the yaw spin swinging the nose round.
    const rx = f.x * this.spec.wheelZ;
    const rz = f.z * this.spec.wheelZ;
    const vx = v.x + wy * rz;
    const vz = v.z - wy * rx;
    const cos = Math.cos(steerAngle);
    const sin = Math.sin(steerAngle);
    const hx = f.x * cos + f.z * sin;
    const hz = -f.x * sin + f.z * cos;
    return vx * hz - vz * hx;
  }

  /** Remove part of the sideways velocity, and of any yaw spin the steering isn't asking for. */
  private assistTraction(dt: number): void {
    const k = Math.min(1, this.tractionAssist * dt);
    const v = this.body.linvel();
    const f = this.forward(tmpVec);
    const lateral = v.x * f.z - v.z * f.x; // velocity along the car's right/left axis
    this.body.setLinvel({ x: v.x - f.z * lateral * k, y: v.y, z: v.z + f.x * lateral * k }, true);
    // Yaw rate a car rolling at this speed and steering angle would have (bicycle model).
    const s = this.spec;
    const speed = v.x * f.x + v.z * f.z;
    const steerAngle = -this.steer * THREE.MathUtils.lerp(s.maxSteer, s.minSteer, Math.min(1, Math.abs(speed) / s.maxSpeed));
    const wanted = (speed * Math.tan(steerAngle)) / Math.max(1, s.wheelZ * 2);
    // Only rein in spin beyond that (the model over-predicts, so never add turning).
    const w = this.body.angvel();
    const limit = Math.abs(wanted) + 0.15;
    const target = Math.sign(w.y) === Math.sign(wanted) || wanted === 0 ? THREE.MathUtils.clamp(w.y, -limit, limit) : 0;
    this.body.setAngvel({ x: w.x, y: w.y + (target - w.y) * k, z: w.z }, true);
  }

  /** Call after world.step() to record the new physics transform. */
  snapshot(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);

    // Normal driving changes velocity < 0.2 m/s per step; anything well above is a hit.
    const v = this.body.linvel();
    const dv = Math.hypot(v.x - this.lastVel.x, v.y - this.lastVel.y, v.z - this.lastVel.z);
    const dt = this.stepDt;
    this.updateBody((v.x - this.lastVel.x) / dt, (v.y - this.lastVel.y) / dt, (v.z - this.lastVel.z) / dt, dt);
    // The part of the jolt along the car's up axis lands on the suspension (see SUSPENSION_ABSORB).
    const up = tmpVec.copy(UP).applyQuaternion(this.currQuat);
    const along = (v.x - this.lastVel.x) * up.x + (v.y - this.lastVel.y) * up.y + (v.z - this.lastVel.z) * up.z;
    const absorbed = along > 0 ? Math.sqrt(Math.max(0, dv * dv - along * along * (1 - SUSPENSION_ABSORB * SUSPENSION_ABSORB))) : dv;
    // Knock each axle by the sideways jolt it took: the body's shove plus the sudden spin.
    const f = this.forward(tmpVec);
    const shove = (v.x - this.lastVel.x) * f.z - (v.z - this.lastVel.z) * f.x;
    const yawRate = this.body.angvel().y;
    const spin = yawRate - this.lastYawRate;
    this.lastYawRate = yawRate;
    if (absorbed > 1.5) {
      for (const axle of [0, 1] as const) {
        const jolt = Math.abs(shove + spin * (axle === 0 ? this.spec.wheelZ : -this.spec.wheelZ));
        this.knock[axle] = Math.min(1, Math.max(this.knock[axle], jolt / KNOCK_FULL_SHOVE));
      }
    }
    if (absorbed > 1.5 && absorbed > this.impact) {
      this.impact = absorbed;
      this.impactVelocity.copy(this.lastVel);
      this.impactPush.set(this.lastVel.x - v.x, this.lastVel.y - v.y, this.lastVel.z - v.z);
    }
    this.lastVel.set(v.x, v.y, v.z);
  }

  /** Strongest collision (velocity change, m/s) since the last call; 0 if none. */
  consumeImpact(): number {
    const i = this.impact;
    this.impact = 0;
    return i;
  }

  /** Put the car back on its wheels at its current spot, keeping its heading. */
  reset(): void {
    const fwd = this.forward(tmpVec);
    const t = this.body.translation();
    this.teleport(t.x, Math.max(t.y, 0) + 1.5, t.z, Math.atan2(fwd.x, fwd.z));
  }

  /** Place the car upright at a position and heading, at rest or already rolling forward at `speed` m/s. */
  teleport(x: number, y: number, z: number, yaw: number, speed = 0): void {
    const q = tmpQuat.setFromAxisAngle(UP, yaw);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    const v = { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed };
    this.body.setLinvel(v, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel.set(v.x, v.y, v.z);
    this.pitch = this.pitchVel = this.roll = this.rollVel = this.accelLong = this.accelLat = this.airborneFor = this.lastYawRate = 0;
    this.knock.fill(0);
    this.snapshot();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Update the mesh, interpolating between the last two physics steps. */
  syncMesh(alpha: number): void {
    this.mesh.root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    this.mesh.body.rotation.set(this.pitch, 0, this.roll);
    const c = this.controller;
    this.mesh.wheels.forEach(({ pivot, spinners }, i) => {
      const conn = c.wheelChassisConnectionPointCs(i)!;
      const len = c.wheelSuspensionLength(i) ?? this.spec.suspensionRestLength;
      pivot.position.set(conn.x, conn.y - len, conn.z);
      pivot.rotation.y = c.wheelSteering(i) ?? 0;
      for (const spinner of spinners) spinner.rotation.x = c.wheelRotation(i) ?? 0;
    });
    this.updateLights();
  }

  get indicator(): 'left' | 'right' | null {
    return this.signal;
  }

  /** Switch the turn signal; a fresh signal starts on a flash, like the real thing. */
  set indicator(side: 'left' | 'right' | null) {
    if (side !== this.signal) this.signalSince = performance.now();
    this.signal = side;
  }

  /** Scale tyre grip (wet or icy roads). */
  setGrip(scale: number): void {
    this.gripScale = scale;
    for (let i = 0; i < 4; i++) this.controller.setWheelFrictionSlip(i, this.spec.frictionSlip * scale);
  }

  /**
   * Brake lights while braking, a dim tail-light glow with the headlights on; headlights per time
   * of day; everything off when wrecked.
   */
  private updateLights(): void {
    const m = this.mesh;
    const brake = this.lightsOff ? 0 : this.brakeLightTimer > 0 ? 1 : this.headlights * 0.3;
    m.taillight.emissiveIntensity = brake * 5;
    for (const g of m.tailGlows) setGlow(g, brake * (0.35 + this.headlights * 0.45));

    const head = this.lightsOff ? 0 : this.headlights;
    m.headlight.emissiveIntensity = 1.2 + head * 3;
    for (const beam of m.beams) {
      beam.intensity = head * 300; // two overlapping beams, a bit brighter overall than the old single one
      // Wrecked, a beam just goes dark: hiding it changes the scene's light count, which recompiles
      // every lit material — a hitch right as the car blows up.
      beam.visible = this.headlights > 0 && this.beamEnabled;
    }
    for (const g of m.headGlows) setGlow(g, head * 0.9);

    // About 1.5 flashes a second (road rules allow 1–2), lit for the first half of each.
    const flash = !this.lightsOff && this.signal !== null && ((performance.now() - this.signalSince) / 1000) * INDICATOR_HZ % 1 < 0.5;
    for (const side of ['left', 'right'] as const) {
      const on = flash && this.signal === side ? 1 : 0;
      const { lamp, glows } = m.indicators[side];
      lamp.emissiveIntensity = on * 2.5;
      for (const g of glows) setGlow(g, on * (0.55 + this.headlights * 0.35));
    }
  }

  /** Brake lights on (as the driver behind sees them). */
  get brakeLit(): boolean {
    return this.brakeLightTimer > 0 && !this.lightsOff;
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
    this.mesh.root.removeFromParent();
    this.mesh.dispose();
  }
}
