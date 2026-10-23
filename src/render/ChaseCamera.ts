import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Third-person follow camera. Tracks the car's heading only (not pitch/roll) so bumps and
// crashes don't shake the view. With speed it drops lower and only eases back a little, and the
// FOV widens: how fast the road seems to stream past scales with speed over camera height, so a
// camera that climbed and pulled back at speed made 150 km/h feel like 100.
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private heading = new THREE.Vector3(0, 0, 1);
  private desired = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private lastTarget = new THREE.Vector3();
  private initialised = false;
  private shakeAmount = 0;
  private lookingBack = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1200);
  }

  /** lookBack: same rig mirrored in front of the car, facing backwards (hold B). */
  update(dt: number, target: THREE.Object3D, speedRatio: number, lookBack = false): void {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(target.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-4) {
      // Heading lags slightly behind the car, which gives a sense of rotation in turns.
      // Smoothed as an angle (shortest way round) so even an instant 180° turn can't stall it.
      const target = Math.atan2(fwd.x, fwd.z);
      if (!this.initialised) this.yaw = target;
      else this.yaw += Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw)) * (1 - Math.exp(-5 * dt));
      this.heading.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }

    const distance = 6.5 + speedRatio * 1;
    const height = 2.6 - speedRatio * 0.5;
    const dir = lookBack ? -1 : 1;
    this.desired.copy(target.position).addScaledVector(this.heading, -distance * dir).addScaledVector(UP, height);
    this.lookAt.copy(target.position).addScaledVector(this.heading, 3 * dir).addScaledVector(UP, 0.8);

    // Cut straight to the other side: easing there would swing the camera through the car.
    if (!this.initialised || lookBack !== this.lookingBack) {
      this.camera.position.copy(this.desired);
      this.initialised = true;
      this.lookingBack = lookBack;
    } else {
      // Carry the camera along with the car, then smooth only the rest (turns, bumps). Lerping the
      // whole way left it trailing ~speed/10 metres behind: 4m of extra pull-back at top speed.
      this.camera.position.add(this.lastTarget.subVectors(target.position, this.lastTarget));
      this.camera.position.lerp(this.desired, 1 - Math.exp(-10 * dt));
    }
    this.lastTarget.copy(target.position);
    if (this.shakeAmount > 0.001) {
      const k = this.shakeAmount;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.position.z += (Math.random() - 0.5) * k;
      this.shakeAmount *= Math.exp(-4 * dt);
    }
    this.camera.lookAt(this.lookAt);

    const fov = 60 + speedRatio * 22;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Kick the camera; decays over about a second. */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
