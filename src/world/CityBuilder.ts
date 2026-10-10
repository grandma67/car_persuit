import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import type { Building, CityData, Rect } from './CityGenerator';
import type { CityTheme } from './CityTheme';

const WINDOW_CELLS = 8; // window texture is an 8×8 grid of window cells
const FLOOR_HEIGHT = 3.5;
const WINDOW_WIDTH = 4;

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

/** Build meshes and colliders. windowGlow: emissive strength of lit windows (time of day). */
export function buildCity(city: CityData, scene: THREE.Scene, world: RAPIER.World, theme: CityTheme, windowGlow: number): void {
  // Visual-only randomness uses its own stream so it can't change the layout.
  const rng = new Rng(city.seed ^ 0x5eed);
  const color = (hex: number) => new THREE.Color(hex);
  const { roadWidth } = city.config;

  // --- Island: asphalt top (roads are what's left between blocks), concrete quay sides ---
  const island = city.islandSize;
  const islandDepth = 8;
  const quay = new THREE.MeshStandardMaterial({ color: theme.quay, roughness: 0.9 });
  const asphalt = new THREE.MeshStandardMaterial({ color: theme.asphalt, roughness: 0.95 });
  // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(island, islandDepth, island), [quay, quay, asphalt, quay, quay, quay]);
  ground.position.y = -islandDepth / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(island / 2, islandDepth / 2, island / 2).setTranslation(0, -islandDepth / 2, 0).setFriction(1));

  // --- Sidewalks, parks, plazas ---
  const flats = new GeometryBuilder();
  for (const block of city.blocks) {
    flats.rect(block.rect, 0.03, color(theme.sidewalk));
    if (block.park) {
      const m = city.config.sidewalk;
      flats.rect({ ...block.rect, w: block.rect.w - m * 2, d: block.rect.d - m * 2 }, 0.05, color(theme.grass));
    }
  }
  for (const plaza of city.plazas) flats.rect(plaza, 0.03, color(theme.plaza));
  // Promenade ring between the ring road and the sea.
  const half = city.size / 2;
  const prom = city.config.promenade;
  const ring = half + prom / 2;
  for (const r of [
    { x: 0, z: ring, w: island, d: prom },
    { x: 0, z: -ring, w: island, d: prom },
    { x: ring, z: 0, w: prom, d: city.size },
    { x: -ring, z: 0, w: prom, d: city.size },
  ]) {
    flats.rect(r, 0.03, color(theme.sidewalk));
  }
  const flatMesh = new THREE.Mesh(flats.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  flatMesh.receiveShadow = true;
  scene.add(flatMesh);

  // --- Road markings: dashed centre line + solid edge lines per segment ---
  const markings: { x: number; z: number; w: number; d: number; c: number }[] = [];
  for (const { rect } of city.roads) {
    const alongX = rect.w > rect.d;
    const length = alongX ? rect.w : rect.d;
    // Dashes stop short of the junction ends, leaving room for stop lines and zebra crossings.
    for (let s = -length / 2 + 7; s < length / 2 - 6.5; s += 6) {
      markings.push(alongX ? { x: rect.x + s + 1.5, z: rect.z, w: 3, d: 0.25, c: theme.centerLine } : { x: rect.x, z: rect.z + s + 1.5, w: 0.25, d: 3, c: theme.centerLine });
    }
    for (const side of [-1, 1]) {
      const off = side * (roadWidth / 2 - 0.7);
      markings.push(alongX ? { x: rect.x, z: rect.z + off, w: length, d: 0.15, c: theme.edgeLine } : { x: rect.x + off, z: rect.z, w: 0.15, d: length, c: theme.edgeLine });
    }
  }
  for (const mark of city.roadMarks) markings.push({ ...mark, c: 0xf2f2ee });
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
  for (const b of city.buildings) addBuilding(b, theme.buildings[b.district], walls, roofs, rng);
  const tex = createWindowTextures(rng);
  const wallMesh = new THREE.Mesh(
    walls.build(true),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: 0xffffff,
      emissiveIntensity: windowGlow,
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
  const planters = new THREE.InstancedMesh(planterGeo, new THREE.MeshStandardMaterial({ color: theme.planter, flatShading: true }), city.props.length);
  city.props.forEach((p, i) => {
    planters.setMatrixAt(i, m4.makeScale(p.w, 1, p.d).setPosition(p.x, 0, p.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(p.w / 2, 0.45, p.d / 2).setTranslation(p.x, 0.45, p.z));
  });
  planters.castShadow = planters.receiveShadow = true;
  scene.add(planters);

  // --- Trees: faceted low-poly crowns ---
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 5).translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.8, 0).translate(0, 4.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: theme.trunk, flatShading: true }), city.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), city.trees.length);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  city.trees.forEach((t, i) => {
    const s = rng.range(0.8, 1.3);
    q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, color(rng.pick(theme.leaves)));
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.35 * s).setTranslation(t.x, 1.5, t.z));
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // --- Sea wall along the island edge: a low visible barrier, plus a tall invisible one so a
  // car launched off something can't sail into the sea ---
  const wallT = 0.6;
  const wallH = 1;
  const edge = island / 2 - wallT / 2;
  const seaWall = new GeometryBuilder();
  for (const r of [
    { x: 0, z: edge, w: island, d: wallT },
    { x: 0, z: -edge, w: island, d: wallT },
    { x: edge, z: 0, w: wallT, d: island - wallT * 2 },
    { x: -edge, z: 0, w: wallT, d: island - wallT * 2 },
  ]) {
    seaWall.box(r, 0, wallH, color(theme.seaWall), null, color(theme.seaWall));
    world.createCollider(RAPIER.ColliderDesc.cuboid(r.w / 2, 10, r.d / 2).setTranslation(r.x, 10, r.z));
  }
  const seaWallMesh = new THREE.Mesh(seaWall.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  seaWallMesh.castShadow = seaWallMesh.receiveShadow = true;
  scene.add(seaWallMesh);
}

function addBuilding(b: Building, palette: number[], walls: GeometryBuilder, roofs: GeometryBuilder, rng: Rng): void {
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
