import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { DriveInput } from '../core/Input';
import type { VehicleSpec } from './VehicleSpecs';
import { buildCarMesh, type CarMesh } from './carMesh';

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();

// A Rapier raycast vehicle plus its mesh. The same class drives the player and (later) cops;
// only the DriveInput source differs.
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly mesh: CarMesh;
  private steer = 0;
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
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(
          m,
          { x: 0, y: -hy, z: 0 },
          { x: (m / 12) * (h * h + d * d), y: (m / 12) * (w * w + d * d), z: (m / 12) * (w * w + h * h) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.4)
        .setRestitution(0.1)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      this.body,
    );

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    // Wheel order: FL, FR, RL, RR (+X is the car's left side when facing +Z).
    const wheelPositions = [
      { x: spec.wheelX, y: 0, z: spec.wheelZ },
      { x: -spec.wheelX, y: 0, z: spec.wheelZ },
      { x: spec.wheelX, y: 0, z: -spec.wheelZ },
      { x: -spec.wheelX, y: 0, z: -spec.wheelZ },
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

    // Rear-wheel drive.
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      c.setWheelEngineForce(i, rear ? engine : 0);
      c.setWheelBrake(i, rear && input.handbrake ? s.handbrakeForce : brake);
      c.setWheelSideFrictionStiffness(i, rear && input.handbrake ? s.driftSideFriction : s.sideFriction);
    }

    c.updateVehicle(dt);

    // Speed-scaled downforce keeps the car planted in fast corners.
    const rot = this.body.rotation();
    tmpVec.copy(UP).applyQuaternion(tmpQuat.set(rot.x, rot.y, rot.z, rot.w));
    const f = -s.downforce * Math.abs(speed) * dt;
    this.body.applyImpulse({ x: tmpVec.x * f, y: tmpVec.y * f, z: tmpVec.z * f }, true);
  }

  /** Call after world.step() to record the new physics transform. */
  snapshot(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Put the car back on its wheels at its current spot, keeping its heading. */
  reset(): void {
    const fwd = this.forward(tmpVec);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const q = tmpQuat.setFromAxisAngle(UP, yaw);
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: Math.max(t.y, 0) + 1.5, z: t.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
    this.mesh.root.removeFromParent();
  }
}
