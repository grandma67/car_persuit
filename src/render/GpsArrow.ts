import * as THREE from 'three';

// Chevron floating above the car, pointing along the road route to the next destination.
export class GpsArrow {
  readonly mesh: THREE.Mesh;
  private yaw = 0;
  private time = 0;

  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.1);
    shape.lineTo(0.85, -0.5);
    shape.lineTo(0, -0.1);
    shape.lineTo(-0.85, -0.5);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    // Lay flat with the tip pointing along +Z.
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0.09, 0);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 1.4, flatShading: true }),
    );
    this.mesh.scale.setScalar(1.3);
    // Yaw first, then tilt the tip up so the flat face is readable from the chase camera.
    this.mesh.rotation.order = 'YXZ';
    this.mesh.visible = false;
  }

  /** Place above `carPos`, smoothly turning to face (aimX, aimZ). */
  update(dt: number, carPos: THREE.Vector3, aimX: number, aimZ: number, color: number): void {
    this.time += dt;
    const target = Math.atan2(aimX - carPos.x, aimZ - carPos.z);
    // Shortest-way angle smoothing.
    const delta = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
    this.yaw += delta * Math.min(1, dt * 8);
    this.mesh.position.set(carPos.x, carPos.y + 2.3 + Math.sin(this.time * 3) * 0.08, carPos.z);
    this.mesh.rotation.set(-0.55, this.yaw, 0);
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(color);
    mat.emissive.setHex(color);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
