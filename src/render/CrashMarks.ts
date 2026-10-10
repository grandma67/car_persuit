import * as THREE from 'three';

const MAX_MARKS = 160;
const Z = new THREE.Vector3(0, 0, 1);

/** Scuffed, scraped paint/concrete: dark core, scratches, a few paint flecks (tinted per mark). */
function markTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const core = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  core.addColorStop(0, 'rgba(20,18,16,0.85)');
  core.addColorStop(0.55, 'rgba(30,26,22,0.45)');
  core.addColorStop(1, 'rgba(30,26,22,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  // Horizontal scrape streaks.
  for (let i = 0; i < 26; i++) {
    const y = s * 0.25 + Math.random() * s * 0.5;
    const x = Math.random() * s * 0.3;
    g.strokeStyle = Math.random() < 0.7 ? 'rgba(10,10,10,0.55)' : 'rgba(200,200,200,0.35)';
    g.lineWidth = 0.5 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + s * (0.4 + Math.random() * 0.5), y + (Math.random() - 0.5) * 8);
    g.stroke();
  }
  // Paint flecks — light grey, tinted per mark with the colour of the car that hit the wall.
  for (let i = 0; i < 18; i++) {
    g.fillStyle = 'rgba(235,235,235,0.75)';
    g.fillRect(s * 0.2 + Math.random() * s * 0.6, s * 0.3 + Math.random() * s * 0.4, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Scuff marks stamped onto walls where cars hit them (ring buffer; oldest overwritten).
export class CrashMarks {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private spin = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();

  constructor() {
    const material = new THREE.MeshStandardMaterial({
      map: markTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 0.95,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MAX_MARKS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Stamp a mark at a wall point facing along `normal`; strength 0..1 sets its size; paint = car colour. */
  add(point: THREE.Vector3, normal: THREE.Vector3, strength: number, paint: THREE.Color): void {
    if (Math.abs(normal.y) > 0.5) return; // walls only
    const size = 0.9 + strength * 2.2;
    this.q.setFromUnitVectors(Z, normal);
    this.spin.setFromAxisAngle(Z, (Math.random() - 0.5) * 0.5); // slight tilt, mostly horizontal scrape
    this.q.multiply(this.spin);
    this.pos.copy(point).addScaledVector(normal, 0.02);
    this.pos.y = Math.max(this.pos.y, size * 0.3);
    this.m4.compose(this.pos, this.q, this.scale.set(size * 1.4, size * 0.7, 1));
    this.mesh.setMatrixAt(this.next, this.m4);
    // Tint: the dark scuff stays dark, the light flecks take the car's paint colour.
    this.mesh.setColorAt(this.next, paint);
    this.mesh.instanceColor!.needsUpdate = true;
    this.next = (this.next + 1) % MAX_MARKS;
    this.mesh.count = Math.min(MAX_MARKS, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
