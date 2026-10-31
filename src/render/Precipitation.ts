import * as THREE from 'three';

// Rain streaks or snowflakes in a box that travels with the camera. Each particle lives in world
// space (so driving through the weather looks right) and wraps around the box when it leaves it.
// All of it runs in the vertex shader: the buffer holds each particle's start and never changes,
// and the position at a time is worked out in closed form (drift, fall, sway, then the wrap round
// the box), so a frame only sets two uniforms. Moving 9 200 particles on the CPU and uploading them
// every frame was ~2% of a phone's frame.
const BOX = { x: 70, y: 36, z: 70 };
const RAIN_COUNT = 2200;
const SNOW_COUNT = 2600;
const RAIN_SPEED = 22; // m/s
const RAIN_STREAK = 0.9; // metres
const WIND = { x: 2.2, z: 1.2 }; // m/s, slants the rain and carries the snow
const FLOOR_BELOW = 4; // the box's floor under the camera (never below the street)
// The shader's clock wraps here, so float precision holds in a long run: the particles jump to a
// fresh scatter once an hour, which in falling rain or snow nobody sees.
const TIME_WRAP = 3600;

/** The shader's position for a particle: start `position`, `aPrecip` = (phase or fall speed, tail end). */
const SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter; // camera x, the box floor, camera z
attribute vec2 aPrecip;
vec3 precipitate(vec3 p0) {
  float t = uTime;
  vec3 p;
#ifdef RAIN
  p = p0 + vec3(${WIND.x.toFixed(3)}, -${RAIN_SPEED.toFixed(3)}, ${WIND.z.toFixed(3)}) * t;
#else
  float phase = aPrecip.x;
  float fall = aPrecip.y;
  p.x = p0.x + ${(WIND.x * 0.5).toFixed(3)} * t - ${(0.6 / 1.3).toFixed(5)} * (cos(1.3 * t + phase) - cos(phase));
  p.y = p0.y - fall * t;
  p.z = p0.z + ${(WIND.z * 0.5).toFixed(3)} * t + 0.5 * (sin(t + phase) - sin(phase));
#endif
  vec2 halfBox = vec2(${(BOX.x / 2).toFixed(1)}, ${(BOX.z / 2).toFixed(1)});
  p.xz = uCenter.xz + mod(p.xz - uCenter.xz + halfBox, halfBox * 2.0) - halfBox;
  p.y = uCenter.y + mod(p.y - uCenter.y, ${BOX.y.toFixed(1)});
#ifdef RAIN
  // The streak's tail: up and back along the drop's path.
  p += aPrecip.y * vec3(${(-WIND.x * (RAIN_STREAK / RAIN_SPEED)).toFixed(5)}, ${RAIN_STREAK.toFixed(3)}, ${(-WIND.z * (RAIN_STREAK / RAIN_SPEED)).toFixed(5)});
#endif
  return p;
}
`;

export class Precipitation {
  readonly object: THREE.LineSegments | THREE.Points;
  private readonly uniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } };

  /** density: share of the full particle count (lower on phones). */
  constructor(kind: 'rain' | 'snow', density = 1) {
    const count = Math.round((kind === 'rain' ? RAIN_COUNT : SNOW_COUNT) * density);
    const rain = kind === 'rain';
    const per = rain ? 2 : 1; // a streak is a line: head and tail share the start
    const start = new Float32Array(count * per * 3);
    const params = new Float32Array(count * per * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * BOX.x;
      const y = Math.random() * BOX.y;
      const z = (Math.random() - 0.5) * BOX.z;
      const phase = Math.random() * Math.PI * 2;
      for (let e = 0; e < per; e++) {
        const v = i * per + e;
        start.set([x, y, z], v * 3);
        // Rain: (unused, tail end); snow: (sway phase, fall speed), five speeds as before.
        params[v * 2] = phase;
        params[v * 2 + 1] = rain ? e : 1.3 + (i % 5) * 0.12;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(start, 3));
    geo.setAttribute('aPrecip', new THREE.BufferAttribute(params, 2));
    const material = rain
      ? new THREE.LineBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.42, depthWrite: false })
      : new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, map: flakeTexture(), transparent: true, opacity: 0.9, depthWrite: false });
    material.defines = { [rain ? 'RAIN' : 'SNOW']: '' };
    material.userData.uniforms = this.uniforms; // where dispose and gpuTrace look (LEAKS.md)
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = SHADER + shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = precipitate(position);');
    };
    this.object = rain ? new THREE.LineSegments(geo, material) : new THREE.Points(geo, material);
    this.object.frustumCulled = false;
  }

  update(dt: number, center: THREE.Vector3): void {
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % TIME_WRAP;
    u.uCenter.value.set(center.x, Math.max(0, center.y - FLOOR_BELOW), center.z);
  }
}

/** Soft round dot so flakes aren't square. */
function flakeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
