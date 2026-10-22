// Container art: one canvas atlas, a row per shipping line (made up) — a long side with the line's
// name, a short side for twenties, the door end and the roof — corrugated, rust-streaked. Boxes are
// instanced per line and length with the street-sign faces' material settings (map and emissive
// map, no vertex or instance colours), so they add no shader program.
import * as THREE from 'three';
import { CONTAINER } from '../../gameplay/balance';
import { EMPTY_LINES, LINES, type Container } from '../../world/districts/HarborYard';

const ALL = [...LINES, ...EMPTY_LINES];
const W = 1024;
const ROW = 128;
const H = ROW * ALL.length;
/** Cells along a row, in pixels: the forty's side, the twenty's side, the door end, the roof. */
const COLS = { side40: [0, 600], side20: [600, 900], door: [900, 1000], roof: [1000, 1024] } as const;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const shade = (c: number, k: number) => {
  const col = new THREE.Color(c).multiplyScalar(k);
  return `rgb(${Math.min(255, col.r * 255) | 0},${Math.min(255, col.g * 255) | 0},${Math.min(255, col.b * 255) | 0})`;
};

/** Seeded scatter for the rust, so every load draws the same boxes. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function draw(g: CanvasRenderingContext2D): void {
  ALL.forEach((line, r) => {
    const y = r * ROW;
    const rnd = rand(r * 7919 + 3);
    const corrugate = (x0: number, x1: number) => {
      g.fillStyle = hex(line.color);
      g.fillRect(x0, y, x1 - x0, ROW);
      for (let x = x0; x < x1; x += 6) {
        g.fillStyle = shade(line.color, 0.82);
        g.fillRect(x, y, 2, ROW);
        g.fillStyle = shade(line.color, 1.08);
        g.fillRect(x + 3, y, 1, ROW);
      }
      // Rust streaks running down from the top rail, and grime along the bottom.
      for (let k = 0; k < (x1 - x0) / 40; k++) {
        const x = x0 + rnd() * (x1 - x0), len = 10 + rnd() * 50;
        const grad = g.createLinearGradient(0, y, 0, y + len);
        grad.addColorStop(0, 'rgba(120,60,30,0.55)');
        grad.addColorStop(1, 'rgba(120,60,30,0)');
        g.fillStyle = grad;
        g.fillRect(x, y + 6, 2 + rnd() * 3, len);
      }
      g.fillStyle = 'rgba(40,30,20,0.25)';
      g.fillRect(x0, y + ROW - 10, x1 - x0, 10);
      // The top and bottom rails.
      g.fillStyle = shade(line.color, 0.65);
      g.fillRect(x0, y, x1 - x0, 6);
      g.fillRect(x0, y + ROW - 6, x1 - x0, 6);
    };
    const name = (x0: number, x1: number, size: number) => {
      if (!line.name) return;
      g.fillStyle = line.color === 0xe8e8e4 ? '#2f5f9a' : '#f4f2ec';
      g.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(line.name, (x0 + x1) / 2, y + ROW / 2, x1 - x0 - 40);
    };
    corrugate(...COLS.side40);
    name(...COLS.side40, 64);
    corrugate(...COLS.side20);
    name(...COLS.side20, 40);
    // The door end: two doors, their locking bars, a plate.
    const [d0, d1] = COLS.door;
    corrugate(d0, d1);
    g.fillStyle = shade(line.color, 0.6);
    g.fillRect((d0 + d1) / 2 - 1, y, 2, ROW);
    g.fillStyle = '#5a5a5a';
    for (const f of [0.15, 0.35, 0.65, 0.85]) g.fillRect(d0 + (d1 - d0) * f - 1.5, y + 8, 3, ROW - 16);
    g.fillStyle = '#d8d8d2';
    g.fillRect(d0 + 8, y + 20, 16, 10);
    const [r0, r1] = COLS.roof;
    g.fillStyle = shade(line.color, 0.9);
    g.fillRect(r0, y, r1 - r0, ROW);
  });
}

let atlas: THREE.Texture | null = null;
function containerAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  draw(canvas.getContext('2d')!);
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** A box along Z, base at y = 0, its faces mapped onto line `r`'s cells. */
function boxGeometry(len: number, r: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(CONTAINER.w - 0.04, CONTAINER.h - 0.04, len - 0.04).translate(0, CONTAINER.h / 2, 0);
  const uv = geo.attributes.uv;
  const side = len > 9 ? COLS.side40 : COLS.side20;
  // BoxGeometry's faces in order: +X, -X, +Y, -Y, +Z, -Z, four vertices each.
  const cells = [side, side, COLS.roof, COLS.roof, COLS.door, COLS.door];
  for (let f = 0; f < 6; f++) {
    const [c0, c1] = cells[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (c0 + uv.getX(i) * (c1 - c0)) / W, 1 - (r * ROW + (1 - uv.getY(i)) * ROW) / H);
    }
  }
  return geo;
}

/** The yard's containers: one instanced mesh per line and length, snow slabs on the top boxes in a snowy city. */
export function containerMeshes(containers: Container[], ground: (x: number, z: number) => number, snowy: boolean): THREE.Object3D[] {
  const material = new THREE.MeshStandardMaterial({ map: containerAtlas(), roughness: 0.6, emissive: 0xffffff, emissiveMap: containerAtlas(), emissiveIntensity: 0.03 });
  const lineOf = (c: Container) => Math.max(0, ALL.findIndex((l) => l.color === c.color));
  const m = new THREE.Matrix4();
  const rot = new THREE.Quaternion();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const flat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const at = (c: Container) => pos.set(c.x, ground(c.x, c.z) - 0.05 + (c.base ?? 0) + c.tier * CONTAINER.h, c.z);
  const out: THREE.Object3D[] = [];
  for (const len of [CONTAINER.l40, CONTAINER.l20]) {
    for (let r = 0; r < ALL.length; r++) {
      const list = containers.filter((c) => c.len === len && lineOf(c) === r);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(boxGeometry(len, r), material, list.length);
      list.forEach((c, i) => mesh.setMatrixAt(i, m.compose(at(c), rot.copy(c.alongX ? turn : flat), one)));
      mesh.castShadow = mesh.receiveShadow = true;
      out.push(mesh);
    }
  }
  if (snowy) {
    // Snow on each column's top box: a thin white slab (the props' material settings).
    const tops = new Map<string, Container>();
    for (const c of containers) {
      const k = `${c.x},${c.z}`;
      if ((tops.get(k)?.tier ?? -1) < c.tier) tops.set(k, c);
    }
    const list = [...tops.values()];
    const slab = (len: number) => {
      const g = new THREE.BoxGeometry(CONTAINER.w - 0.1, 0.06, len - 0.1).translate(0, CONTAINER.h + 0.01, 0).toNonIndexed();
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.93), 3));
      return g;
    };
    const snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
    for (const len of [CONTAINER.l40, CONTAINER.l20]) {
      const ls = list.filter((c) => c.len === len);
      if (!ls.length) continue;
      const mesh = new THREE.InstancedMesh(slab(len), snowMat, ls.length);
      ls.forEach((c, i) => mesh.setMatrixAt(i, m.compose(at(c), rot.copy(c.alongX ? turn : flat), one)));
      mesh.receiveShadow = true;
      out.push(mesh);
    }
  }
  return out;
}
