import * as THREE from 'three';

// Gradient sky dome that follows the camera: horizon colour (matching the fog) up to the zenith.
export class Sky {
  readonly mesh: THREE.Mesh;

  constructor(zenith: number, horizon: number) {
    const material = new THREE.ShaderMaterial({
      uniforms: { zenith: { value: new THREE.Color(zenith) }, horizon: { value: new THREE.Color(horizon) } },
      vertexShader: /* glsl */ `
        varying float vUp;
        void main() {
          vUp = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith;
        uniform vec3 horizon;
        varying float vUp;
        void main() {
          float t = pow(clamp(vUp, 0.0, 1.0), 0.55);
          gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
