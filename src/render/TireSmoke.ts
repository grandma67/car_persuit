import * as THREE from 'three';

const MAX_PARTICLES = 400;

const vertexShader = /* glsl */ `
  attribute float size;
  attribute float alpha;
  varying float vAlpha;
  uniform float pixelScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    // Fade puffs right in front of the camera so lingering smoke never blinds the view.
    vAlpha = alpha * smoothstep(2.0, 6.0, -mv.z);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  uniform vec3 color;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.2, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(color, a);
  }
`;

export interface SmokeStyle {
  color: number;
  maxAlpha: number;
  additive: boolean; // glow (fire) instead of normal blending
  growth: number; // metres of extra size over a particle's life
  lift?: [number, number]; // initial upward speed range, m/s
  gravity?: number; // m/s², for water that falls back down
  spread?: number; // sideways speed range, m/s
  life?: [number, number]; // lifetime range, seconds
}

const TYRE_SMOKE: SmokeStyle = { color: 0xd8dde4, maxAlpha: 0.3, additive: false, growth: 2.0 };

// Pooled billboard particles: puffs grow, drift upward and fade. Used for tyre smoke, engine
// smoke and fire with different styles.
export class TireSmoke {
  readonly points: THREE.Points;
  private positions = new Float32Array(MAX_PARTICLES * 3);
  private sizes = new Float32Array(MAX_PARTICLES);
  private alphas = new Float32Array(MAX_PARTICLES);
  private velocities = new Float32Array(MAX_PARTICLES * 3);
  private ages = new Float32Array(MAX_PARTICLES).fill(Infinity);
  private lifetimes = new Float32Array(MAX_PARTICLES).fill(1);
  private next = 0;
  private material: THREE.ShaderMaterial;

  constructor(private style: SmokeStyle = TYRE_SMOKE) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { color: { value: new THREE.Color(style.color) }, pixelScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setColor(hex: number): void {
    this.material.uniforms.color.value.set(hex);
  }

  /** Keep particle size consistent across screen heights. */
  resize(heightPx: number, fovDeg: number): void {
    this.material.uniforms.pixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(at: THREE.Vector3, carVelocity: THREE.Vector3, intensity: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.positions.set([at.x + (Math.random() - 0.5) * 0.3, at.y + 0.15, at.z + (Math.random() - 0.5) * 0.3], i * 3);
    // Left behind: a fraction of the source's velocity plus random spread and lift.
    const [liftMin, liftMax] = this.style.lift ?? [0.6, 1.4];
    const spread = this.style.spread ?? 1.5;
    this.velocities.set(
      [
        carVelocity.x * 0.15 + (Math.random() - 0.5) * spread,
        liftMin + Math.random() * (liftMax - liftMin),
        carVelocity.z * 0.15 + (Math.random() - 0.5) * spread,
      ],
      i * 3,
    );
    this.ages[i] = 0;
    const [lifeMin, lifeMax] = this.style.life ?? [0.9, 1.5];
    this.lifetimes[i] = lifeMin + Math.random() * (lifeMax - lifeMin) + intensity * 0.6;
    this.sizes[i] = 0;
    this.alphas[i] = 0;
  }

  update(dt: number): void {
    const drag = Math.exp(-1.5 * dt);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.ages[i] >= this.lifetimes[i]) {
        this.alphas[i] = 0;
        continue;
      }
      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];
      const j = i * 3;
      this.velocities[j] *= drag;
      this.velocities[j + 2] *= drag;
      this.velocities[j + 1] -= (this.style.gravity ?? 0) * dt;
      this.positions[j] += this.velocities[j] * dt;
      this.positions[j + 1] += this.velocities[j + 1] * dt;
      this.positions[j + 2] += this.velocities[j + 2] * dt;
      this.sizes[i] = 0.7 + t * this.style.growth;
      this.alphas[i] = Math.min(t * 8, 1) * (1 - t) * this.style.maxAlpha;
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }
}
