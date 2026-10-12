import * as THREE from 'three';
import type { Canal } from '../world/Terrain';

// Stale canal water: no swell like the open sea, just a restless skin. A murky green-brown body
// with slowly drifting silt clouds (domain-warped noise), dancing light where two moving Voronoi
// layers overlap, algae scum collecting along the quay walls, rafts of duckweed, small wavelets
// that bob the surface against the walls, a fast fine shimmer, and now and then a ring ripple
// (a bug, a drip) that catches the light. Everything is computed in world space, so the strips
// that overlap where two canals cross shade identically and never show a seam. Toward the open
// sea the water clears to the sea's own shallows colour so the mouth blends in.

const GLSL = /* glsl */ `
  uniform float time;
  uniform float islandHalf;
  uniform vec4 canalA; // (along X ? 1 : 0, centre line, half width, active)
  uniform vec4 canalB;
  uniform vec3 deep;
  uniform vec3 murk;
  uniform vec3 algae;
  uniform vec3 shallow;
  varying vec2 vCanalPos;

  float cwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 cwHash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }
  float cwNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cwHash(i), cwHash(i + vec2(1, 0)), u.x), mix(cwHash(i + vec2(0, 1)), cwHash(i + vec2(1, 1)), u.x), u.y);
  }
  float cwFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * cwNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
  // Distances to the nearest and second-nearest jittered cell point (F1, F2).
  vec2 cwVoronoi(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y);
      vec2 o = cwHash2(i + g);
      o = 0.5 + 0.4 * sin(t + 6.2831 * o); // points wander slowly in place
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return vec2(f1, f2);
  }
  // Small wavelets criss-crossing the canal: (height, d/dx, d/dz).
  vec3 cwWaves(vec2 p, float t) {
    vec3 sum = vec3(0.0);
    // direction, wavelength (m), speed (m/s), amplitude (m)
    vec4 w[4];
    w[0] = vec4(0.8, 0.6, 5.0, 1.1);
    w[1] = vec4(-0.5, 0.87, 3.3, 0.9);
    w[2] = vec4(0.2, -0.98, 2.1, 0.7);
    w[3] = vec4(-0.94, -0.34, 1.4, 0.55);
    float amp[4] = float[4](0.035, 0.025, 0.016, 0.01);
    for (int i = 0; i < 4; i++) {
      vec2 dir = normalize(w[i].xy);
      float k = 6.2831 / w[i].z;
      float ph = k * (dot(dir, p) - w[i].w * t);
      sum += vec3(sin(ph), dir * cos(ph) * k) * amp[i];
    }
    return sum;
  }
  // Metres from the point to the nearest quay wall (negative outside the water).
  float cwEdge(vec4 c, vec2 p) {
    if (c.w < 0.5) return -1e3;
    return c.z - abs((c.x > 0.5 ? p.y : p.x) - c.y);
  }
`;

export class CanalWater {
  readonly material: THREE.MeshStandardMaterial;
  private time = { value: 0 };

  constructor(canals: Canal[], islandHalf: number, seaColor: number, shallowColor: number) {
    const sea = new THREE.Color(seaColor);
    const deep = sea.clone().lerp(new THREE.Color(0x1f2d1a), 0.72);
    const murk = deep.clone().lerp(new THREE.Color(0x4d5a2e), 0.6);
    const algae = new THREE.Color(0x5f7a2c).lerp(sea, 0.15);
    const pack = (c?: Canal) => (c ? new THREE.Vector4(c.axis === 'x' ? 1 : 0, c.at, c.half, 1) : new THREE.Vector4(0, 0, 0, 0));
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.1 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        time: this.time,
        islandHalf: { value: islandHalf },
        canalA: { value: pack(canals[0]) },
        canalB: { value: pack(canals[1]) },
        deep: { value: deep },
        murk: { value: murk },
        algae: { value: algae },
        shallow: { value: new THREE.Color(shallowColor) },
      });
      shader.vertexShader = `${GLSL}\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vCanalPos = (modelMatrix * vec4(position, 1.0)).xz;
        transformed.y += cwWaves(vCanalPos, time).x; // bobs against the quay walls
        `,
      );
      shader.fragmentShader = `${GLSL}\n${shader.fragmentShader}`
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          vec2 p = vCanalPos;
          float t = time;
          float edge = max(cwEdge(canalA, p), cwEdge(canalB, p));
          // 0 in the canal, 1 out at the shore line where it opens to the sea.
          float toSea = islandHalf - max(abs(p.x), abs(p.y));
          float open = 1.0 - smoothstep(0.0, 30.0, toSea);

          // Silt clouds: domain-warped fbm, drifting very slowly.
          vec2 q = p * 0.035;
          vec2 warp = vec2(cwFbm(q + vec2(t * 0.010, 0.0)), cwFbm(q + vec2(5.2, 1.3) - t * 0.008));
          float silt = cwFbm(q * 1.3 + warp * 1.8 + t * 0.004);
          vec3 water = mix(deep, murk, smoothstep(0.35, 0.75, silt) * 0.85);

          // Dancing light: two Voronoi layers sliding past each other; only where both cells'
          // borders meet does it brighten, so the pattern keeps breaking up instead of
          // standing still like cracks in ice.
          vec2 v1 = cwVoronoi(p * 0.35 + vec2(t * 0.35, t * 0.12) + warp, t * 1.1);
          vec2 v2 = cwVoronoi(p * 0.5 - vec2(t * 0.2, -t * 0.3) - warp, t * 0.9 + 3.0);
          float g1 = v1.y - v1.x, g2 = v2.y - v2.x;
          float dance = (1.0 - smoothstep(0.0, 0.25, g1)) * (1.0 - smoothstep(0.0, 0.25, g2));
          dance *= 1.0 - smoothstep(0.05, 0.2, fwidth(g1) + fwidth(g2)); // fade out before it aliases
          water += vec3(0.55, 0.7, 0.5) * dance * 0.11;

          // Algae scum gathered against the quay walls, ragged at its edge.
          float band = 1.0 - smoothstep(0.4, 2.5 + 4.0 * cwNoise(p * 0.12), edge);
          float scum = band * smoothstep(0.3, 0.6, cwNoise(p * 0.55 + warp * 2.0));
          // Duckweed: rafts of tiny round leaves drifting on the open water.
          float raft = smoothstep(0.5, 0.64, cwFbm(p * 0.045 + vec2(13.0, 7.0) + t * 0.003));
          float leaf = 1.0 - smoothstep(0.16, 0.24, cwVoronoi(p * 1.7, 0.0).x);
          float weed = raft * leaf;
          scum *= 1.0 - open;
          weed *= 1.0 - open;
          float cover = clamp(max(scum * 0.9, weed), 0.0, 1.0);
          water = mix(water, algae * (0.85 + 0.3 * cwNoise(p * 2.1)), cover);
          diffuseColor.rgb = mix(water, shallow, open * 0.8);
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          // Open water is glassy, the scum matte.
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, cover);',
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          // Ring ripples: each 10 m cell now and then sends out a ring that spreads and fades.
          vec2 slope = vec2(0.0);
          vec2 cell = floor(p / 10.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 id = cell + vec2(x, y);
            vec2 h = cwHash2(id * 1.37);
            float period = 5.0 + 6.0 * h.x;
            float life = fract(t / period + h.y);
            vec2 centre = (id + 0.2 + 0.6 * cwHash2(id + floor(t / period + h.y))) * 10.0;
            vec2 d = p - centre;
            float r = length(d) + 1e-3;
            float front = r - life * 7.0;
            float ring = sin(front * 4.0) * exp(-front * front * 1.5) * (1.0 - life) * (1.0 - life);
            slope += d / r * ring * 0.35;
          }
          // The wavelets, and a fast fine shimmer on top: the surface never sits still.
          slope += cwWaves(p, t).yz;
          vec2 f = p * 1.3;
          slope += vec2(cwNoise(f + vec2(t * 1.7, t * 0.6)) - cwNoise(f + vec2(0.7, 0.0) + vec2(t * 1.7, t * 0.6)),
                        cwNoise(f.yx - vec2(t * 1.3, -t * 0.9)) - cwNoise(f.yx + vec2(0.7, 0.0) - vec2(t * 1.3, -t * 0.9))) * 0.45;
          slope *= 1.0 - cover;
          normal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);
          `,
        );
    };
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}
