import * as THREE from 'three';

const MAX_SEGMENTS = 3000;
const MARK_WIDTH = 0.28;
const MIN_SEGMENT_LENGTH = 0.3;
const UP = new THREE.Vector3(0, 1, 0);

// Tyre marks as a ring buffer of quads in one mesh; the oldest marks are overwritten first.
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private positions = new Float32Array(MAX_SEGMENTS * 4 * 3);
  private alphas = new Float32Array(MAX_SEGMENTS * 4);
  private positionAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
  private alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
  private next = 0;
  /** Last point laid by each tracked wheel; null when its mark is broken. */
  private lastPoints = new Map<number, THREE.Vector3 | null>();
  private side = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor() {
    const geo = new THREE.BufferGeometry();
    const index = new Uint32Array(MAX_SEGMENTS * 6);
    for (let s = 0; s < MAX_SEGMENTS; s++) {
      const v = s * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], s * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setAttribute('position', this.positionAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() { gl_FragColor = vec4(vec3(1.0 - min(vAlpha * 1.25, 0.9)), 1.0); }
      `,
      // Multiply: darken whatever is underneath by a ratio, so marks still show on asphalt in
      // shadow or at night. A fixed dark colour vanished there (it was the road's own colour).
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Extend the mark for a wheel. Pass point=null (or intensity 0) to lift the mark. */
  add(wheelId: number, point: THREE.Vector3 | null, intensity: number): void {
    const last = this.lastPoints.get(wheelId) ?? null;
    if (!point || intensity <= 0) {
      this.lastPoints.set(wheelId, null);
      return;
    }
    if (!last) {
      this.lastPoints.set(wheelId, point.clone());
      return;
    }
    if (last.distanceToSquared(point) < MIN_SEGMENT_LENGTH ** 2) return;
    if (last.distanceToSquared(point) > 9) {
      // Teleport/reset — don't draw a streak across the map.
      last.copy(point);
      return;
    }

    this.dir.subVectors(point, last).normalize();
    this.side.crossVectors(this.dir, UP).multiplyScalar(MARK_WIDTH / 2);
    // The physics ground is flat at y=0, but sidewalks, plazas and landmark paving are drawn up
    // to 0.06 above it; stay above all of them or the marks vanish under those surfaces.
    const lift = 0.07;
    const s = this.next;
    this.next = (this.next + 1) % MAX_SEGMENTS;
    const p = this.positions;
    const o = s * 12;
    p[o] = last.x - this.side.x; p[o + 1] = last.y + lift; p[o + 2] = last.z - this.side.z;
    p[o + 3] = last.x + this.side.x; p[o + 4] = last.y + lift; p[o + 5] = last.z + this.side.z;
    p[o + 6] = point.x - this.side.x; p[o + 7] = point.y + lift; p[o + 8] = point.z - this.side.z;
    p[o + 9] = point.x + this.side.x; p[o + 10] = point.y + lift; p[o + 11] = point.z + this.side.z;
    const a = 0.25 + intensity * 0.45;
    this.alphas.fill(a, s * 4, s * 4 + 4);
    last.copy(point);

    // Upload just this quad: re-sending the whole ring buffer each frame of a drift is ~190 KB.
    this.positionAttr.addUpdateRange(o, 12);
    this.positionAttr.needsUpdate = true;
    this.alphaAttr.addUpdateRange(s * 4, 4);
    this.alphaAttr.needsUpdate = true;
  }
}
