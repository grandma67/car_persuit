// Reflection map for shiny surfaces (car paint, glass, building windows): the time of day's sky
// gradient over the ground colour, with a bright disc where the sun is. Rendered and prefiltered
// once per city; nothing per frame. Only materials that are given it reflect it.
import * as THREE from 'three';
import type { TimeOfDay } from '../world/CityTheme';

export function createEnvironment(renderer: THREE.WebGLRenderer, time: TimeOfDay): THREE.Texture {
  const linear = (hex: number) => new THREE.Color(hex); // ColorManagement converts sRGB hex to linear
  const sunDir = new THREE.Vector3(...time.sunOffset).normalize();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: linear(time.skyZenith) },
      horizon: { value: linear(time.skyHorizon) },
      ground: { value: linear(time.hemiGround) },
      sunColor: { value: linear(time.sunColor).multiplyScalar(time.sunIntensity * 12) },
      sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, horizon, ground, sunColor, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 sky = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.6));
        vec3 col = d.y >= 0.0 ? sky : mix(horizon, ground, clamp(-d.y * 6.0, 0.0, 1.0));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (smoothstep(0.9990, 0.9996, s) + 0.02 * pow(s, 64.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  scene.add(sphere);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 50);
  pmrem.dispose();
  sphere.geometry.dispose();
  material.dispose();
  return target.texture;
}
