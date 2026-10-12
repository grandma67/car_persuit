import * as THREE from 'three';

const SIZE = 3000;
export const SEA_LEVEL = -1.6; // below the island top so waves never poke through the streets
const NEAR_STEP = 4; // grid spacing (m) in the surf zone, fine enough for the shore swell
const SURF_ZONE = 140; // metres of sea around the island meshed at NEAR_STEP
const FAR_GROWTH = 1.18; // beyond that, each grid step is this much wider than the last

// Shared GLSL: distance from the island and the phase of the swell rolling in toward it.
// Both shaders call it, so the foam lines sit exactly on the displaced crests.
const SHORE_GLSL = /* glsl */ `
  uniform float time;
  uniform float islandHalf;
  // True distance from the (square) island: contours round off past the corners, so the
  // swell wraps around them instead of meeting at a diagonal seam.
  float seaShoreDist(vec2 p) {
    vec2 q = abs(p) - vec2(islandHalf);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  // Shoaling: wavenumber rises from 0.05 out at sea to 0.2 at the quay (waves bunch up).
  // The phase is k integrated over distance, so crests keep one speed as they shorten.
  // Adding time makes constant-phase crests move to smaller distances: toward the shore.
  float seaSwellPhase(vec2 p, float d) {
    const float K0 = 0.05, K1 = 0.2, D = 160.0;
    float dd = clamp(d, 0.0, D);
    float phase = K1 * dd - (K1 - K0) * dd * dd / (2.0 * D) + K0 * max(d - D, 0.0);
    // Wobble the crest lines along the shore so they are not ruler-straight.
    phase += sin(p.x * 0.013 + p.y * 0.017) * 1.3 + sin(p.y * 0.031 - p.x * 0.009 + time * 0.2) * 0.7;
    return phase + time * 1.5;
  }
  // 0..1 swell profile with sharp crests and wide troughs.
  float seaSwellShape(float phase) {
    return pow(0.5 + 0.5 * sin(phase), 3.0);
  }
`;

// Grid lines along one axis: NEAR_STEP apart up to the edge of the surf zone, then widening.
function axisLines(islandHalf: number): number[] {
  const inner = islandHalf + SURF_ZONE;
  const half = SIZE / 2;
  const pos: number[] = [];
  for (let x = 0; x < inner; x += NEAR_STEP) pos.push(x);
  for (let x = inner, step = NEAR_STEP; x < half; x += step, step *= FAR_GROWTH) pos.push(x);
  pos.push(half);
  return [...pos.slice(1).map((x) => -x).reverse(), ...pos];
}

// A flat grid, dense near the shore and coarse out at sea. Cells well inside the island are
// left out: they are hidden under it anyway.
function seaGeometry(islandHalf: number): THREE.BufferGeometry {
  const lines = axisLines(islandHalf);
  const n = lines.length;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) positions.set([lines[i], 0, lines[j]], (j * n + i) * 3);
  }
  const hidden = islandHalf - 2 * NEAR_STEP;
  const indices: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const inside = Math.max(Math.abs(lines[i]), Math.abs(lines[i + 1])) < hidden
        && Math.max(Math.abs(lines[j]), Math.abs(lines[j + 1])) < hidden;
      if (inside) continue;
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Low-poly animated sea. Out at sea a few crossing sine waves; nearer the island they give way
// to a swell that rolls in toward the quay, shortening and steepening as it comes, breaking into
// foam on its last few crests and splashing against the wall. With flat shading, every triangle
// catches light differently, giving faceted waves that match the art style.
export class Sea {
  readonly mesh: THREE.Mesh;
  private time = { value: 0 };

  /** islandHalf: half the island's width, for shallows and shore foam. */
  constructor(islandHalf: number, deepColor: number, shallowColor = 0x66cfd9) {
    const geo = seaGeometry(islandHalf);
    const material = new THREE.MeshStandardMaterial({
      color: deepColor, // shallows are mixed in by the shader
      roughness: 0.22,
      metalness: 0.15,
      flatShading: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.time;
      shader.uniforms.islandHalf = { value: islandHalf };
      shader.uniforms.shallow = { value: new THREE.Color(shallowColor) };
      shader.vertexShader = `${SHORE_GLSL}\nvarying vec2 vSeaPos;\nvarying float vWave;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `
          vec3 transformed = vec3(position);
          float x = position.x, z = position.z;
          float openSea = sin(x * 0.045 + time * 1.1) * 0.7
                        + sin(z * 0.06 - time * 0.8) * 0.55
                        + sin((x + z) * 0.11 + time * 1.7) * 0.3;
          float d = seaShoreDist(position.xz);
          float nearShore = 1.0 - smoothstep(50.0, 180.0, d);
          // Swell grows as it shoals, then flattens right at the wall where it breaks.
          float amp = mix(0.8, 2.0, nearShore) * smoothstep(0.0, 8.0, d);
          float swell = (seaSwellShape(seaSwellPhase(position.xz, d)) - 0.35) * amp;
          float wave = mix(openSea, swell, nearShore);
          transformed.y += wave;
          vSeaPos = position.xz;
          vWave = openSea * (1.0 - nearShore);
        `,
      );
      shader.fragmentShader = /* glsl */ `
        ${SHORE_GLSL}
        uniform vec3 shallow;
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
          float shoreDist = seaShoreDist(vSeaPos);
          diffuseColor.rgb = mix(shallow, diffuseColor.rgb, smoothstep(0.0, 120.0, shoreDist));

          float n = seaNoise(vSeaPos * 0.07 + vec2(time * 0.12, -time * 0.09));
          float n2 = seaNoise(vSeaPos * 0.23 - vec2(time * 0.2, time * 0.15));
          // Whitecaps on the open-sea crests, broken up by noise.
          float crest = smoothstep(1.05, 1.45, vWave + (n - 0.5) * 0.9) * (0.55 + 0.45 * n2);

          // Breakers: the swell's crests turn white over the last stretch before the quay,
          // with the foam band widening the closer they get.
          float phase = seaSwellPhase(vSeaPos, shoreDist);
          float shape = seaSwellShape(phase + (n - 0.5) * 0.8);
          float breakZone = 1.0 - smoothstep(10.0, 60.0 + n * 15.0, shoreDist);
          float breaker = smoothstep(mix(0.8, 0.4, breakZone), 0.9, shape) * breakZone * (0.45 + 0.55 * n2);
          // Spent foam trailing behind each breaker (on the seaward side), thinning out.
          float trail = smoothstep(0.55, 0.95, seaSwellShape(phase - 0.9 + (n2 - 0.5)))
                      * breakZone * smoothstep(0.35, 0.75, n) * 0.6;

          // Splash at the wall: surges each time a crest arrives, then drains back.
          float arrive = seaSwellShape(seaSwellPhase(vSeaPos, 0.0) - 0.4);
          float wallFoam = 1.0 - smoothstep(0.5, 2.5 + arrive * 6.0 + n * 3.0, shoreDist);

          float foam = clamp(max(max(crest, wallFoam), max(breaker, trail)), 0.0, 1.0);
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
    this.mesh.position.y = SEA_LEVEL;
    this.mesh.receiveShadow = true;
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}
