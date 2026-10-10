import * as THREE from 'three';

const SIZE = 3000;
const SEGMENTS = 160;
const LEVEL = -1.6; // below the island top so waves never poke through the streets

// Low-poly animated sea: a grid displaced by a few sine waves in the vertex shader. With flat
// shading, every triangle catches light differently, giving faceted waves that match the art style.
export class Sea {
  readonly mesh: THREE.Mesh;
  private time = { value: 0 };

  constructor() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x2a7396,
      roughness: 0.22,
      metalness: 0.15,
      flatShading: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.time;
      shader.vertexShader = `uniform float time;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `
          vec3 transformed = vec3(position);
          float x = position.x, z = position.z;
          transformed.y += sin(x * 0.045 + time * 1.1) * 0.7
                         + sin(z * 0.06 - time * 0.8) * 0.55
                         + sin((x + z) * 0.11 + time * 1.7) * 0.3;
        `,
      );
    };
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.position.y = LEVEL;
    this.mesh.receiveShadow = true;
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}
