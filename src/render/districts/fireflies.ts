// Fireflies drifting low over grass or crops on warm nights, each blinking on its own phase in the
// shader: one Points mesh per district, one shared program (the Farm's fields, the Mega-park's lawns).
import * as THREE from 'three';
import type { Rect } from '../../world/CityGenerator';

/**
 * `n` fireflies scattered over `spots` (round robin), placed from `seed`; returns the time uniform to
 * tick. `look`: another colour and size (the Swamp's will-o'-the-wisps; same program).
 */
export function fireflies(spots: Rect[], n: number, seed: number, scene: THREE.Scene, ground: (x: number, z: number) => number, look: { color: number; size: number } = { color: 0xd8ff6a, size: 0.35 }): { value: number } {
  const time = { value: 0 };
  if (!n || !spots.length) return time;
  const pos = new Float32Array(n * 3), phase = new Float32Array(n);
  let s = seed % 2147483647 || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const f = spots[i % spots.length];
    const x = f.x + (rnd() - 0.5) * f.w, z = f.z + (rnd() - 0.5) * f.d;
    pos.set([x, ground(x, z) + 0.6 + rnd() * 1.6, z], i * 3);
    phase[i] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.PointsMaterial({ color: look.color, size: look.size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;\nvarying float vBlink;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.x += sin(uTime * 0.5 + aPhase * 7.0) * 0.8;
transformed.z += cos(uTime * 0.43 + aPhase * 11.0) * 0.8;
transformed.y += sin(uTime * 0.7 + aPhase * 5.0) * 0.3;
vBlink = smoothstep(0.55, 1.0, sin(uTime * 1.6 + aPhase * 6.2832));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlink;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vBlink;');
  };
  mat.customProgramCacheKey = () => 'fireflies';
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return time;
}
