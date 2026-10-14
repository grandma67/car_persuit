import * as THREE from 'three';
import { sharedGlowTexture, type CarMesh } from '../vehicles/carMesh';

const START_CAPACITY = 256;

// Every car's lamp glows in one draw call. Each car keeps its glow sprites (positioned in its tree,
// faded by setGlow) on a layer the camera doesn't draw; this copies the lit ones into billboarded
// instances. As separate sprites they were a draw call each — over a hundred whenever the
// headlights are on (night, afternoon, rain), which lagged at busy junctions.
export class GlowBatch {
  readonly mesh: THREE.InstancedMesh;
  private capacity = START_CAPACITY;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    // Additive and no depth writes, like the sprites: the draw order between glows doesn't matter.
    const material = new THREE.MeshBasicMaterial({ map: sharedGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = this.build(new THREE.PlaneGeometry(1, 1), material);
    scene.add(this.mesh);
  }

  update(cars: CarMesh[], camera: THREE.Camera): void {
    camera.getWorldQuaternion(this.quat);
    let n = 0;
    for (const car of cars) {
      if (!car.root.parent || !car.root.visible) continue;
      car.root.updateMatrixWorld();
      for (const glow of car.glows) {
        const opacity = (glow.material as THREE.SpriteMaterial).opacity;
        if (!glow.visible || opacity <= 0) continue;
        if (n === this.capacity) this.grow();
        this.pos.setFromMatrixPosition(glow.matrixWorld);
        this.scale.set(glow.scale.x, glow.scale.y, 1);
        this.mesh.setMatrixAt(n, this.matrix.compose(this.pos, this.quat, this.scale));
        // Additive: fading the colour is the same as fading the opacity.
        this.mesh.setColorAt(n, this.color.copy((glow.material as THREE.SpriteMaterial).color).multiplyScalar(opacity));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private build(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, this.color.set(0)); // creates instanceColor
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** More lit glows than fit: double the buffers (the shader stays the same, no recompile). */
  private grow(): void {
    const old = this.mesh;
    this.capacity *= 2;
    const matrices = new Float32Array(this.capacity * 16);
    matrices.set(old.instanceMatrix.array as Float32Array);
    const colors = new Float32Array(this.capacity * 3);
    colors.set(old.instanceColor!.array as Float32Array);
    old.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
    old.instanceColor = new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  }
}
