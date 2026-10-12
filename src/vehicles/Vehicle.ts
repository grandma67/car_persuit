import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { DriveInput } from '../core/Input';
import { RAMP, rampHullPoints, type VehicleSpec } from './VehicleSpecs';
import { buildCarMesh, type CarMesh } from './carMesh';

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
  /** Rear tyre grip, 0 (locked and sliding) .. 1 (normal). Drops on the handbrake, recovers after. */
  private rearGrip = 1;
  // Collision detection by sudden velocity change; contact forces don't scale usefully with impact speed.
  private lastVel = new THREE.Vector3();
  private impact = 0;
  /** Velocity just before the strongest recent impact (direction of travel into the obstacle). */
  readonly impactVelocity = new THREE.Vector3();
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
        .setRestitution(0.1),
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
    if (deck) this.world.createCollider(deck.setDensity(0).setFriction(1.2).setRestitution(0), this.body);
    const { z0, z1, top } = RAMP.cab;
    const bottom = -this.spec.halfExtents.y;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(RAMP.halfWidth, (top - bottom) / 2, (z1 - z0) / 2)
        .setTranslation(0, (top + bottom) / 2, (z0 + z1) / 2)
        .setDensity(0)
        .setFriction(0.4),
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

    const absSpeed = Math.abs(speed);
    const drifting = this.updateRearGrip(input, speed, dt);
    // Handbrake = rear wheels only, clutch in: the locked rears get no drive.
    if (input.handbrake) engine = 0;
    // Locked rears slide sideways at any speed; after release their grip comes back gradually.
    const rearSide = input.handbrake ? s.driftSideFriction : THREE.MathUtils.lerp(s.driftSideFriction, s.sideFriction, this.rearGrip);

    // Rear-wheel drive.
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      c.setWheelEngineForce(i, rear ? engine : 0);
      c.setWheelBrake(i, rear ? (input.handbrake ? s.handbrakeForce : brake * REAR_BRAKE) : brake * FRONT_BRAKE);
      c.setWheelSideFrictionStiffness(i, rear ? rearSide : s.sideFriction);
    }

    c.updateVehicle(dt);
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

    if (this.tractionAssist > 0 && (c.wheelIsInContact(0) || c.wheelIsInContact(2))) this.assistTraction(dt);

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

  /** Signed angle between where the car points and where it's going (radians, 0 = no slide). */
  private slipAngle(): number {
    const v = this.body.linvel();
    const f = this.forward(tmpVec);
    return Math.atan2(v.x * f.z - v.z * f.x, v.x * f.x + v.z * f.z);
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
    if (dv > 1.5 && dv > this.impact) {
      this.impact = dv;
      this.impactVelocity.copy(this.lastVel);
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
    this.snapshot();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Update the mesh, interpolating between the last two physics steps. */
  syncMesh(alpha: number): void {
    this.mesh.root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const c = this.controller;
    this.mesh.wheels.forEach(({ pivot, spinner }, i) => {
      const conn = c.wheelChassisConnectionPointCs(i)!;
      const len = c.wheelSuspensionLength(i) ?? this.spec.suspensionRestLength;
      pivot.position.set(conn.x, conn.y - len, conn.z);
      pivot.rotation.y = c.wheelSteering(i) ?? 0;
      spinner.rotation.x = c.wheelRotation(i) ?? 0;
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
    for (const g of m.tailGlows) (g.material as THREE.SpriteMaterial).opacity = brake * (0.35 + this.headlights * 0.45);

    const head = this.lightsOff ? 0 : this.headlights;
    m.headlight.emissiveIntensity = 1.2 + head * 3;
    for (const beam of m.beams) {
      beam.intensity = head * 300; // two overlapping beams, a bit brighter overall than the old single one
      beam.visible = head > 0 && this.beamEnabled;
    }
    for (const g of m.headGlows) (g.material as THREE.SpriteMaterial).opacity = head * 0.9;

    // About 1.5 flashes a second (road rules allow 1–2), lit for the first half of each.
    const flash = !this.lightsOff && this.signal !== null && ((performance.now() - this.signalSince) / 1000) * INDICATOR_HZ % 1 < 0.5;
    for (const side of ['left', 'right'] as const) {
      const on = flash && this.signal === side ? 1 : 0;
      const { lamp, glows } = m.indicators[side];
      lamp.emissiveIntensity = on * 2.5;
      for (const g of glows) (g.material as THREE.SpriteMaterial).opacity = on * (0.55 + this.headlights * 0.35);
    }
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
    this.mesh.root.removeFromParent();
  }
}
