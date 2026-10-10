import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import type { Building, CityData, District, Rect } from './CityGenerator';

const WINDOW_CELLS = 8; // window texture is an 8×8 grid of window cells
const FLOOR_HEIGHT = 3.5;
const WINDOW_WIDTH = 4;

const PALETTE: Record<District, number[]> = {
  downtown: [0x8fa6c4, 0x6f87a8, 0xa9b8cc, 0x7d8fa3, 0x5f7390],
  midtown: [0xb8a99a, 0x9aa2ad, 0xc4b59e, 0x8f8a85, 0xa39488],
  residential: [0xd9b38c, 0xc98f6b, 0xe0d3b8, 0xa8b8a0, 0xbfa0a0],
  industrial: [0x8a8478, 0x7a8088, 0x9c9284, 0x6e6a64],
};

const COLORS = {
  asphalt: 0x23272f,
  sidewalk: 0x4a505c,
  plaza: 0x5c5866,
  grass: 0x2f5233,
  marking: 0xd8c27a,
  edgeLine: 0x9aa0a8,
  planter: 0x6b6f78,
  trunk: 0x4a3426,
  leaves: [0x2f6b3a, 0x3d7a3f, 0x2a5e40, 0x4a7d32],
};

/** Accumulates flat-shaded quads into one BufferGeometry. */
class GeometryBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /** Quad from 4 corners (counter-clockwise seen from the front). */
  quad(corners: number[][], normal: number[], color: THREE.Color, uv?: number[][]): void {
    const base = this.positions.length / 3;
    corners.forEach((c, k) => {
      this.positions.push(c[0], c[1], c[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color.r, color.g, color.b);
      const t = uv?.[k] ?? [0, 0];
      this.uvs.push(t[0], t[1]);
    });
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Flat ground rectangle at height y. */
  rect(r: Rect, y: number, color: THREE.Color): void {
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
    this.quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], color);
  }

  /** Box with 4 walls + roof. wallUv maps a face's (width, height) to UV corners. */
  box(r: Rect, y0: number, h: number, wallColor: THREE.Color, roof: GeometryBuilder | null, roofColor: THREE.Color,
      wallUv?: (w: number, h: number) => number[][]): void {
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2, y1 = y0 + h;
    const faces: [number[][], number[], number][] = [
      [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], r.w],
      [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], r.w],
      [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], r.d],
      [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], r.d],
    ];
    for (const [corners, normal, width] of faces) this.quad(corners, normal, wallColor, wallUv?.(width, h));
    (roof ?? this).quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], roofColor);
  }

  build(withUv = false): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (withUv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Window grid: diffuse map (wall + dark glass) and emissive map (randomly lit windows). */
function createWindowTextures(rng: Rng): { map: THREE.Texture; emissive: THREE.Texture } {
  const px = 64;
  const size = px * WINDOW_CELLS;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')!] as const;
  };
  const [diffuseCanvas, d] = make();
  const [emissiveCanvas, e] = make();
  d.fillStyle = '#ffffff';
  d.fillRect(0, 0, size, size);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, size, size);
  for (let cy = 0; cy < WINDOW_CELLS; cy++) {
    for (let cx = 0; cx < WINDOW_CELLS; cx++) {
      const x = cx * px + px * 0.18, y = cy * px + px * 0.2, w = px * 0.64, h = px * 0.5;
      d.fillStyle = '#26303d';
      d.fillRect(x, y, w, h);
      const roll = rng.next();
      if (roll < 0.22) e.fillStyle = '#ffd59a';
      else if (roll < 0.28) e.fillStyle = '#bcd6ff';
      else continue;
      e.fillRect(x, y, w, h);
    }
  }
  const toTexture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: toTexture(diffuseCanvas, true), emissive: toTexture(emissiveCanvas, true) };
}

export function buildCity(city: CityData, scene: THREE.Scene, world: RAPIER.World): void {
  // Visual-only randomness uses its own stream so it can't change the layout.
  const rng = new Rng(city.seed ^ 0x5eed);
  const color = (hex: number) => new THREE.Color(hex);
  const { roadWidth } = city.config;

  // --- Ground (asphalt everywhere; roads are what's left between blocks) ---
  const groundSize = city.size + 400;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: COLORS.asphalt, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(groundSize / 2, 0.5, groundSize / 2).setTranslation(0, -0.5, 0).setFriction(1));

  // --- Sidewalks, parks, plazas ---
  const flats = new GeometryBuilder();
  for (const block of city.blocks) {
    flats.rect(block.rect, 0.03, color(COLORS.sidewalk));
    if (block.park) {
      const m = city.config.sidewalk;
      flats.rect({ ...block.rect, w: block.rect.w - m * 2, d: block.rect.d - m * 2 }, 0.05, color(COLORS.grass));
    }
  }
  for (const plaza of city.plazas) flats.rect(plaza, 0.03, color(COLORS.plaza));
  const flatMesh = new THREE.Mesh(flats.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  flatMesh.receiveShadow = true;
  scene.add(flatMesh);

  // --- Road markings: dashed centre line + solid edge lines per segment ---
  const markings: { x: number; z: number; w: number; d: number; c: number }[] = [];
  for (const { rect } of city.roads) {
    const alongX = rect.w > rect.d;
    const length = alongX ? rect.w : rect.d;
    for (let s = -length / 2 + 3; s < length / 2 - 2; s += 6) {
      markings.push(alongX ? { x: rect.x + s + 1.5, z: rect.z, w: 3, d: 0.25, c: COLORS.marking } : { x: rect.x, z: rect.z + s + 1.5, w: 0.25, d: 3, c: COLORS.marking });
    }
    for (const side of [-1, 1]) {
      const off = side * (roadWidth / 2 - 0.7);
      markings.push(alongX ? { x: rect.x, z: rect.z + off, w: length, d: 0.15, c: COLORS.edgeLine } : { x: rect.x + off, z: rect.z, w: 0.15, d: length, c: COLORS.edgeLine });
    }
  }
  const markingGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const markingMesh = new THREE.InstancedMesh(markingGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), markings.length);
  const m4 = new THREE.Matrix4();
  markings.forEach((mk, i) => {
    markingMesh.setMatrixAt(i, m4.makeScale(mk.w, 1, mk.d).setPosition(mk.x, 0.02, mk.z));
    markingMesh.setColorAt(i, color(mk.c));
  });
  scene.add(markingMesh);

  // --- Buildings: merged walls (windowed) + merged roofs, one collider each ---
  const walls = new GeometryBuilder();
  const roofs = new GeometryBuilder();
  for (const b of city.buildings) addBuilding(b, walls, roofs, rng);
  const tex = createWindowTextures(rng);
  const wallMesh = new THREE.Mesh(
    walls.build(true),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      roughness: 0.75,
      metalness: 0.1,
    }),
  );
  const roofMesh = new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  for (const mesh of [wallMesh, roofMesh]) {
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const b of city.buildings) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z));
  }

  // --- Plaza planters ---
  const planterGeo = new THREE.BoxGeometry(1, 0.9, 1).translate(0, 0.45, 0);
  const planters = new THREE.InstancedMesh(planterGeo, new THREE.MeshStandardMaterial({ color: COLORS.planter, flatShading: true }), city.props.length);
  city.props.forEach((p, i) => {
    planters.setMatrixAt(i, m4.makeScale(p.w, 1, p.d).setPosition(p.x, 0, p.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(p.w / 2, 0.45, p.d / 2).setTranslation(p.x, 0.45, p.z));
  });
  planters.castShadow = planters.receiveShadow = true;
  scene.add(planters);

  // --- Trees: faceted low-poly crowns ---
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 5).translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.8, 0).translate(0, 4.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: COLORS.trunk, flatShading: true }), city.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), city.trees.length);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  city.trees.forEach((t, i) => {
    const s = rng.range(0.8, 1.3);
    q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, color(rng.pick(COLORS.leaves)));
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.35 * s).setTranslation(t.x, 1.5, t.z));
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // --- Invisible boundary walls just outside the ring road ---
  const half = city.size / 2;
  for (const [x, z, w, d] of [[0, half + 1, half + 2, 1], [0, -half - 1, half + 2, 1], [half + 1, 0, 1, half + 2], [-half - 1, 0, 1, half + 2]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(w, 10, d).setTranslation(x, 10, z));
  }
}

function addBuilding(b: Building, walls: GeometryBuilder, roofs: GeometryBuilder, rng: Rng): void {
  const palette = PALETTE[b.district];
  const wallColor = new THREE.Color(palette[Math.floor(b.variant * palette.length)]);
  const roofColor = wallColor.clone().multiplyScalar(0.55);
  // Per-building window pattern offset, snapped to whole cells so windows line up with floors.
  const uOff = Math.floor(b.variant * 97) % WINDOW_CELLS / WINDOW_CELLS;
  const vOff = Math.floor(b.variant * 389) % WINDOW_CELLS / WINDOW_CELLS;
  const wallUv = (w: number, h: number) => {
    const u = Math.max(1, Math.round(w / WINDOW_WIDTH)) / WINDOW_CELLS;
    const v = Math.max(1, Math.round(h / FLOOR_HEIGHT)) / WINDOW_CELLS;
    return [[uOff, vOff], [uOff + u, vOff], [uOff + u, vOff + v], [uOff, vOff + v]];
  };
  walls.box(b, 0, b.h, wallColor, roofs, roofColor, wallUv);

  // Rooftop details on taller buildings: AC units, stair housings.
  if (b.h > 14) {
    const count = rng.int(1, 3);
    for (let k = 0; k < count; k++) {
      const w = rng.range(2, Math.min(6, b.w * 0.4));
      const d = rng.range(2, Math.min(6, b.d * 0.4));
      const x = b.x + rng.range(-(b.w - w) / 2 + 0.5, (b.w - w) / 2 - 0.5);
      const z = b.z + rng.range(-(b.d - d) / 2 + 0.5, (b.d - d) / 2 - 0.5);
      roofs.box({ x, z, w, d }, b.h, rng.range(1.2, 3.5), roofColor.clone().multiplyScalar(1.4), null, roofColor);
    }
  }
}
