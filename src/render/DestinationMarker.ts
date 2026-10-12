import * as THREE from 'three';

const BEAM_HEIGHT = 140;

// Tall light beam (visible over rooftops and through fog) plus a pulsing ground ring.
export class DestinationMarker {
  readonly group = new THREE.Group();
  private beamMaterial: THREE.ShaderMaterial;
  private ringMaterial: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private time = 0;

  constructor(radius: number) {
    this.beamMaterial = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color() }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vHeight;
        void main() {
          vHeight = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float time;
        varying float vHeight;
        void main() {
          // Bright at the base, fading up; faint bands scroll upward.
          float bands = 0.75 + 0.25 * sin(vHeight * 60.0 - time * 4.0);
          float a = pow(1.0 - vHeight, 0.9) * 0.85 * bands;
          gl_FragColor = vec4(color, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, BEAM_HEIGHT, 24, 1, true), this.beamMaterial);
    beam.position.y = BEAM_HEIGHT / 2;
    beam.frustumCulled = false;

    this.ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 1, radius, 48).rotateX(-Math.PI / 2), this.ringMaterial);
    this.ring.position.y = 0.08;

    this.group.add(beam, this.ring);
    this.group.visible = false;
  }

  show(x: number, y: number, z: number, final: boolean): void {
    const color = new THREE.Color(final ? 0x4dff88 : 0xffb020);
    this.beamMaterial.uniforms.color.value.copy(color);
    this.ringMaterial.color.copy(color);
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    this.beamMaterial.uniforms.time.value = this.time;
    const pulse = (Math.sin(this.time * 4) + 1) / 2;
    this.ring.scale.setScalar(0.92 + pulse * 0.08);
    this.ringMaterial.opacity = 0.5 + pulse * 0.4;
  }
}
