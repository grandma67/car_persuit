import * as THREE from 'three';

// Rain streaks or snowflakes in a box that travels with the camera. Each particle lives in world
// space (so driving through the weather looks right) and wraps around the box when it leaves it.
const BOX = { x: 70, y: 36, z: 70 };
const RAIN_COUNT = 2200;
const SNOW_COUNT = 2600;
const RAIN_SPEED = 22; // m/s
const RAIN_STREAK = 0.9; // metres
const WIND = { x: 2.2, z: 1.2 }; // m/s, slants the rain and carries the snow

export class Precipitation {
  readonly object: THREE.LineSegments | THREE.Points;
  private positions: Float32Array; // one point per particle (rain: the drop's head)
  private buffer: Float32Array; // what the GPU draws
  private phases: Float32Array;
  private time = 0;

  constructor(private kind: 'rain' | 'snow') {
    const count = kind === 'rain' ? RAIN_COUNT : SNOW_COUNT;
    this.positions = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.positions[i * 3 + 1] = Math.random() * BOX.y;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    if (kind === 'rain') {
      this.buffer = new Float32Array(count * 6);
      geo.setAttribute('position', new THREE.BufferAttribute(this.buffer, 3).setUsage(THREE.DynamicDrawUsage));
      this.object = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.42, depthWrite: false }),
      );
    } else {
      this.buffer = this.positions;
      geo.setAttribute('position', new THREE.BufferAttribute(this.buffer, 3).setUsage(THREE.DynamicDrawUsage));
      this.object = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, map: flakeTexture(), transparent: true, opacity: 0.9, depthWrite: false }),
      );
    }
    this.object.frustumCulled = false;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.time += dt;
    const p = this.positions;
    const count = this.phases.length;
    const rain = this.kind === 'rain';
    const wrap = (v: number, c: number, size: number) => c + ((((v - c + size / 2) % size) + size) % size) - size / 2;
    const floor = center.y - 4;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      if (rain) {
        p[j] += WIND.x * dt;
        p[j + 1] -= RAIN_SPEED * dt;
        p[j + 2] += WIND.z * dt;
      } else {
        const sway = Math.sin(this.time * 1.3 + this.phases[i]);
        p[j] += (WIND.x * 0.5 + sway * 0.6) * dt;
        p[j + 1] -= (1.3 + (i % 5) * 0.12) * dt;
        p[j + 2] += (WIND.z * 0.5 + Math.cos(this.time + this.phases[i]) * 0.5) * dt;
      }
      p[j] = wrap(p[j], center.x, BOX.x);
      p[j + 2] = wrap(p[j + 2], center.z, BOX.z);
      // Below the street (or far above): respawn at the top of the box.
      if (p[j + 1] < Math.max(0, floor) || p[j + 1] > floor + BOX.y + 4) p[j + 1] = Math.max(0, floor) + BOX.y - Math.random() * 2;
      if (rain) {
        const k = i * 6;
        const s = RAIN_STREAK / RAIN_SPEED;
        this.buffer[k] = p[j];
        this.buffer[k + 1] = p[j + 1];
        this.buffer[k + 2] = p[j + 2];
        this.buffer[k + 3] = p[j] - WIND.x * s;
        this.buffer[k + 4] = p[j + 1] + RAIN_STREAK;
        this.buffer[k + 5] = p[j + 2] - WIND.z * s;
      }
    }
    this.object.geometry.attributes.position.needsUpdate = true;
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
