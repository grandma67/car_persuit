import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Third-person follow camera. Tracks the car's heading only (not pitch/roll) so bumps and
// crashes don't shake the view; pulls back and widens FOV with speed.
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private heading = new THREE.Vector3(0, 0, 1);
  private desired = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1200);
  }

  update(dt: number, target: THREE.Object3D, speedRatio: number): void {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(target.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-4) {
      fwd.normalize();
      // Heading lags slightly behind the car, which gives a sense of rotation in turns.
      this.heading.lerp(fwd, 1 - Math.exp(-5 * dt)).normalize();
    }

    const distance = 6.5 + speedRatio * 3;
    const height = 2.6 + speedRatio * 0.6;
    this.desired.copy(target.position).addScaledVector(this.heading, -distance).addScaledVector(UP, height);
    this.lookAt.copy(target.position).addScaledVector(this.heading, 3).addScaledVector(UP, 0.8);

    if (!this.initialised) {
      this.camera.position.copy(this.desired);
      this.initialised = true;
    } else {
      this.camera.position.lerp(this.desired, 1 - Math.exp(-10 * dt));
    }
    this.camera.lookAt(this.lookAt);

    const fov = 60 + speedRatio * 14;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
