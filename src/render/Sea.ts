import * as THREE from 'three';

const SIZE = 3000;
const SEGMENTS = 160;
const LEVEL = -1.6; // below the island top so waves never poke through the streets

// Low-poly animated sea: a grid displaced by a few sine waves in the vertex shader. With flat
// shading, every triangle catches light differently, giving faceted waves that match the art style.
// The fragment shader adds turquoise shallows, whitecaps on crests and surf along the quay.
export class Sea {
  readonly mesh: THREE.Mesh;
  private time = { value: 0 };

  /** islandHalf: half the island's width, for shallows and shore foam. */
  constructor(islandHalf: number) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x1f6488, // deep water; shallows are mixed in by the shader
      roughness: 0.22,
      metalness: 0.15,
      flatShading: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.time;
      shader.uniforms.islandHalf = { value: islandHalf };
      shader.vertexShader = `uniform float time;\nvarying vec2 vSeaPos;\nvarying float vWave;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `
          vec3 transformed = vec3(position);
          float x = position.x, z = position.z;
          float wave = sin(x * 0.045 + time * 1.1) * 0.7
                     + sin(z * 0.06 - time * 0.8) * 0.55
                     + sin((x + z) * 0.11 + time * 1.7) * 0.3;
          transformed.y += wave;
          vSeaPos = position.xz;
          vWave = wave;
        `,
      );
      shader.fragmentShader = /* glsl */ `
        uniform float time;
        uniform float islandHalf;
        varying vec2 vSeaPos;
        varying float vWave;
        float seaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float seaNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(seaHash(i), seaHash(i + vec2(1, 0)), u.x),
                     mix(seaHash(i + vec2(0, 1)), seaHash(i + vec2(1, 1)), u.x), u.y);
        }
        ${shader.fragmentShader}`
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          // Distance from the quay (island is an axis-aligned square).
          float shoreDist = max(abs(vSeaPos.x), abs(vSeaPos.y)) - islandHalf;
          vec3 shallow = vec3(0.13, 0.62, 0.68);
          diffuseColor.rgb = mix(shallow, diffuseColor.rgb, smoothstep(0.0, 120.0, shoreDist));

          float n = seaNoise(vSeaPos * 0.07 + vec2(time * 0.12, -time * 0.09));
          float n2 = seaNoise(vSeaPos * 0.23 - vec2(time * 0.2, time * 0.15));
          // Whitecaps where crests are high, broken up by noise.
          float crest = smoothstep(1.05, 1.45, vWave + (n - 0.5) * 0.9) * (0.55 + 0.45 * n2);
          // Solid foam against the wall, then surf lines rolling outward and fading.
          float wallFoam = 1.0 - smoothstep(0.5, 4.0 + n * 3.0, shoreDist);
          float surf = smoothstep(0.6, 0.92, sin(shoreDist * 0.7 - time * 2.4 + n * 3.0) * 0.5 + 0.5)
                     * (1.0 - smoothstep(2.0, 22.0, shoreDist)) * (0.5 + 0.5 * n2);
          float foam = clamp(max(crest, max(wallFoam, surf)), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), foam);
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(0.12, 0.14, 0.16) * foam; // foam stays visible at night
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
