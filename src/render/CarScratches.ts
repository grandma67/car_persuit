// Scratches and dents on a car's body where it hit something: small decals stuck to the side of
// the body box that took the knock (they ride with the car). Scraped-metal streaks and a darker
// dent smudge; harder hits leave bigger and more of them. Per car, the oldest is replaced.
import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';

const MAX_PER_CAR = 28;
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Crash damage: a dark dented scuff, scraped streaks (dark rubber/grime and bright bare metal, so
 * it reads on light and dark paint alike) and a few chips of paint knocked off.
 */
function scratchTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const dent = g.createRadialGradient(s * 0.45, s / 2, 3, s * 0.45, s / 2, s * 0.4);
  dent.addColorStop(0, 'rgba(12,12,12,0.75)');
  dent.addColorStop(0.5, 'rgba(20,20,20,0.4)');
  dent.addColorStop(1, 'rgba(20,20,20,0)');
  g.fillStyle = dent;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 30; i++) {
    const y = s * 0.25 + Math.random() * s * 0.5;
    const x = Math.random() * s * 0.35;
    g.strokeStyle = i % 2 ? `rgba(20,20,22,${0.55 + Math.random() * 0.35})` : `rgba(230,232,236,${0.6 + Math.random() * 0.35})`;
    g.lineWidth = 0.8 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + s * (0.25 + Math.random() * 0.45), y + (Math.random() - 0.5) * 12);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    g.fillStyle = i % 3 ? 'rgba(15,15,15,0.8)' : 'rgba(205,208,212,0.9)';
    g.fillRect(s * 0.2 + Math.random() * s * 0.55, s * 0.3 + Math.random() * s * 0.4, 2 + Math.random() * 4, 2 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shared: { geometry: THREE.PlaneGeometry; material: THREE.Material } | null | undefined;
function sharedLook(): typeof shared {
  if (shared !== undefined) return shared;
  const map = scratchTexture();
  shared = map && {
    geometry: new THREE.PlaneGeometry(1, 1),
    material: new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      roughness: 0.45,
      metalness: 0.6,
    }),
  };
  return shared;
}

const layers = new WeakMap<Vehicle, { mesh: THREE.InstancedMesh; next: number }>();
const local = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const normal = new THREE.Vector3();
const pos = new THREE.Vector3();
const q = new THREE.Quaternion();
const spin = new THREE.Quaternion();
const scale = new THREE.Vector3();
const m4 = new THREE.Matrix4();

/**
 * Mark the car where it was hit. `toward`: world direction from the car to what it hit (the
 * velocity it lost); strength 0..1. Knocks from below (landings) leave nothing.
 */
export function scratchCar(vehicle: Vehicle, toward: THREE.Vector3, strength: number): void {
  const look = sharedLook();
  if (!look || toward.lengthSq() < 1e-6) return;
  local.copy(toward).normalize().applyQuaternion(inverse.copy(vehicle.quaternion).invert());
  if (Math.abs(local.y) > 0.7) return;

  let layer = layers.get(vehicle);
  if (!layer) {
    const mesh = new THREE.InstancedMesh(look.geometry, look.material, MAX_PER_CAR);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    vehicle.mesh.body.add(mesh); // rides the body's pitch and roll
    layer = { mesh, next: 0 };
    layers.set(vehicle, layer);
  }

  const { x: hx, y: hy, z: hz } = vehicle.spec.halfExtents;
  const flank = hx * (vehicle.spec.body === 'boxtruck' ? 1.02 : 1) + 0.012; // the cargo box stands a touch proud
  const count = 1 + Math.round(strength * 2);
  for (let k = 0; k < count; k++) {
    // Small marks, kept wholly on the face they're on: never past the car's edges.
    let w = 0.3 + strength * 0.5 + Math.random() * 0.2;
    let h = w * 0.45;
    // The face the hit came through: a flank or an end, by where the direction meets the box.
    const side = Math.abs(local.x) / hx > Math.abs(local.z) / hz;
    // Vertical band on the face; low on the ends, where the sloped noses leave little upright face.
    const [bottom, top] = side ? [-hy * 0.9, hy * 0.9] : [-hy * 0.9, -hy * 0.15];
    h = Math.min(h, (top - bottom) * 0.8);
    const y = THREE.MathUtils.lerp(bottom + h / 2, top - h / 2, Math.random());
    if (side) {
      const sx = Math.sign(local.x);
      const along = THREE.MathUtils.clamp((local.z / Math.abs(local.x)) * hx + (Math.random() - 0.5) * 1.2, -hz * 0.8, hz * 0.8);
      w = Math.min(w, 2 * (hz * 0.95 - Math.abs(along)));
      normal.set(sx, 0, 0);
      pos.set(sx * flank, y, along);
    } else {
      const sz = Math.sign(local.z);
      const across = THREE.MathUtils.clamp((local.x / Math.abs(local.z)) * hz + (Math.random() - 0.5) * 0.6, -hx * 0.6, hx * 0.6);
      w = Math.min(w, 2 * (hx * 0.92 - Math.abs(across)));
      normal.set(0, 0, sz);
      pos.set(across, y, sz * (hz + 0.012));
    }
    // A slight tilt, shrunk to keep the tilted corners on the face too.
    const tilt = (Math.random() - 0.5) * 0.3;
    const sin = Math.abs(Math.sin(tilt)); // tilted, a w×h mark spans (w + h·sin) × (h + w·sin)
    const fit = Math.min(1 / (1 + (h / w) * sin), 1 / (1 + (w / h) * sin));
    q.setFromUnitVectors(Z, normal).multiply(spin.setFromAxisAngle(Z, tilt));
    m4.compose(pos, q, scale.set(w * fit, h * fit, 1));
    layer.mesh.setMatrixAt(layer.next, m4);
    layer.next = (layer.next + 1) % MAX_PER_CAR;
    layer.mesh.count = Math.min(MAX_PER_CAR, layer.mesh.count + 1);
  }
  layer.mesh.instanceMatrix.needsUpdate = true;
}
