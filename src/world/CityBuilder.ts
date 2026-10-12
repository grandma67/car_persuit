import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import type { Building, CityData, Rect } from './CityGenerator';
import type { CityTheme } from './CityTheme';
import type { Climate, TreeKind } from './Climate';
import type { StreetProp } from './StreetProps';
import { clipRect, groundBase, groundHeight, groundNormal, isFlat, type Terrain } from './Terrain';
import { SEA_LEVEL } from '../render/Sea';

const WINDOW_CELLS = 8; // window texture is an 8×8 grid of window cells
const FLOOR_HEIGHT = 3.5;
const WINDOW_WIDTH = 4;
export const SNOW = 0xeef2f6;
const CELL = 4; // metres: mesh and heightfield spacing for ground that follows the hill
/** Cells along a length: CELL-sized on the hill, a single one on flat ground. */
const cells = (length: number, flat: boolean) => (flat ? 1 : Math.max(1, Math.ceil(length / CELL - 1e-6)));
/** A segment's bounding rectangle, for the flatness check. */
const segmentRect = (ax: number, az: number, bx: number, bz: number): Rect => ({ x: (ax + bx) / 2, z: (az + bz) / 2, w: Math.abs(bx - ax), d: Math.abs(bz - az) });
const ISLAND_DEPTH = 8; // quay walls reach this far below the streets
const DECK_DEPTH = 1.4; // bridge deck thickness
const PARAPET = { thick: 0.5, height: 0.9 }; // low walls along the canals and bridges
// Parapets stand this far back from the quay or deck edge, so their faces never share a plane
// with the walls below (which z-fight along the ground line).
const PARAPET_INSET = 0.04;

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

  /**
   * Rectangle following the ground, `lift` above it, in cells of at most CELL metres. `down`
   * faces it downwards (a bridge's underside).
   */
  drape(r: Rect, lift: number, color: THREE.Color, t: Terrain, down = false): void {
    const flat = isFlat(t, r);
    const nx = cells(r.w, flat);
    const nz = cells(r.d, flat);
    const base = this.positions.length / 3;
    for (let b = 0; b <= nz; b++) {
      for (let a = 0; a <= nx; a++) {
        const x = r.x - r.w / 2 + (r.w * a) / nx;
        const z = r.z - r.d / 2 + (r.d * b) / nz;
        const n = down ? { x: 0, y: -1, z: 0 } : groundNormal(t, x, z);
        this.positions.push(x, groundHeight(t, x, z) + lift, z);
        this.normals.push(n.x, n.y, n.z);
        this.colors.push(color.r, color.g, color.b);
        this.uvs.push(0, 0);
      }
    }
    for (let b = 0; b < nz; b++) {
      for (let a = 0; a < nx; a++) {
        const i0 = base + b * (nx + 1) + a; // low x, low z
        const i1 = i0 + 1;
        const i2 = i0 + nx + 1;
        const i3 = i2 + 1;
        if (down) this.indices.push(i2, i1, i3, i2, i0, i1);
        else this.indices.push(i2, i3, i1, i2, i1, i0);
      }
    }
  }

  /** Vertical walls round a rectangle, from the ground down to bottom(groundHeight). */
  skirt(r: Rect, color: THREE.Color, t: Terrain, bottom: (top: number) => number): void {
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
    // Each side runs A → B with the outward normal on its right, as in box().
    const sides: [number, number, number, number, number[]][] = [
      [x0, z1, x1, z1, [0, 0, 1]],
      [x1, z0, x0, z0, [0, 0, -1]],
      [x1, z1, x1, z0, [1, 0, 0]],
      [x0, z0, x0, z1, [-1, 0, 0]],
    ];
    for (const [ax, az, bx, bz, normal] of sides) {
      const steps = cells(Math.hypot(bx - ax, bz - az), isFlat(t, segmentRect(ax, az, bx, bz)));
      for (let k = 0; k < steps; k++) {
        const p = [k / steps, (k + 1) / steps].map((u) => {
          const x = ax + (bx - ax) * u;
          const z = az + (bz - az) * u;
          const top = groundHeight(t, x, z);
          return { x, z, top, bottom: bottom(top) };
        });
        this.quad([[p[0].x, p[0].bottom, p[0].z], [p[1].x, p[1].bottom, p[1].z], [p[1].x, p[1].top, p[1].z], [p[0].x, p[0].top, p[0].z]], normal, color);
      }
    }
  }

  /** A low wall along an axis-aligned line, following the ground. */
  parapet(ax: number, az: number, bx: number, bz: number, color: THREE.Color, t: Terrain): void {
    const alongX = bx !== ax;
    const [u0, u1] = alongX ? [Math.min(ax, bx), Math.max(ax, bx)] : [Math.min(az, bz), Math.max(az, bz)];
    const steps = cells(u1 - u0, isFlat(t, segmentRect(ax, az, bx, bz)));
    const h = PARAPET.thick / 2;
    const at = (u: number) => {
      const g = alongX ? groundHeight(t, u, az) : groundHeight(t, ax, u);
      return { lo: g - 0.3, hi: g + PARAPET.height };
    };
    for (let k = 0; k < steps; k++) {
      const s0 = u0 + ((u1 - u0) * k) / steps;
      const s1 = u0 + ((u1 - u0) * (k + 1)) / steps;
      const a = at(s0);
      const b = at(s1);
      if (alongX) {
        const x0 = s0, x1 = s1, z0 = az - h, z1 = az + h;
        this.quad([[x0, a.lo, z1], [x1, b.lo, z1], [x1, b.hi, z1], [x0, a.hi, z1]], [0, 0, 1], color);
        this.quad([[x1, b.lo, z0], [x0, a.lo, z0], [x0, a.hi, z0], [x1, b.hi, z0]], [0, 0, -1], color);
        this.quad([[x1, b.lo, z1], [x1, b.lo, z0], [x1, b.hi, z0], [x1, b.hi, z1]], [1, 0, 0], color);
        this.quad([[x0, a.lo, z0], [x0, a.lo, z1], [x0, a.hi, z1], [x0, a.hi, z0]], [-1, 0, 0], color);
        this.quad([[x0, a.hi, z1], [x1, b.hi, z1], [x1, b.hi, z0], [x0, a.hi, z0]], [0, 1, 0], color);
      } else {
        const z0 = s0, z1 = s1, x0 = ax - h, x1 = ax + h;
        this.quad([[x0, b.lo, z1], [x1, b.lo, z1], [x1, b.hi, z1], [x0, b.hi, z1]], [0, 0, 1], color);
        this.quad([[x1, a.lo, z0], [x0, a.lo, z0], [x0, a.hi, z0], [x1, a.hi, z0]], [0, 0, -1], color);
        this.quad([[x1, b.lo, z1], [x1, a.lo, z0], [x1, a.hi, z0], [x1, b.hi, z1]], [1, 0, 0], color);
        this.quad([[x0, a.lo, z0], [x0, b.lo, z1], [x0, b.hi, z1], [x0, a.hi, z0]], [-1, 0, 0], color);
        this.quad([[x0, b.hi, z1], [x1, b.hi, z1], [x1, a.hi, z0], [x0, a.hi, z0]], [0, 1, 0], color);
      }
    }
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

export interface CityLook {
  theme: CityTheme;
  climate: Climate;
  windowGlow: number; // emissive strength of lit windows (time of day, weather)
  wet: boolean; // rain: glossy, darker roads and pavements
  sea: number; // deep water colour, for the canals
}

/**
 * Build meshes and colliders. Returns the handles of wall colliders (buildings, sea wall) — the
 * surfaces that take crash marks — and the breakable greenery and beach umbrellas, for PropSystem.
 */
export function buildCity(
  city: CityData,
  scene: THREE.Scene,
  world: RAPIER.World,
  look: CityLook,
): { walls: Set<number>; props: StreetProp[] } {
  const { theme, climate, windowGlow, wet } = look;
  const terrain = city.terrain;
  const wallColliders = new Set<number>();
  // Visual-only randomness uses its own stream so it can't change the layout.
  const rng = new Rng(city.seed ^ 0x5eed);
  const color = (hex: number) => new THREE.Color(hex);
  const { roadWidth } = city.config;

  // --- Island: asphalt top (roads are what's left between blocks) draped over the hill, in pieces
  // between the canals, with concrete quay walls down into the sea; bridge decks carry the roads
  // across the canals ---
  const island = city.islandSize;
  const quay = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const asphalt = wet
    ? new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.asphalt).multiplyScalar(0.75), roughness: 0.32, metalness: 0.3 })
    : new THREE.MeshStandardMaterial({ color: theme.asphalt, roughness: 0.95 });
  // Pushed back in depth so pavements and markings laid a few centimetres above always win.
  asphalt.polygonOffset = true;
  asphalt.polygonOffsetFactor = 1;
  asphalt.polygonOffsetUnits = 1;
  const top = new GeometryBuilder();
  const sides = new GeometryBuilder();
  const stone = color(theme.seaWall);
  for (const piece of terrain.land) {
    top.drape(piece, 0, stone, terrain);
    sides.skirt(piece, color(theme.quay), terrain, () => -ISLAND_DEPTH);
    addGround(world, piece, terrain);
  }
  for (const deck of terrain.bridges) {
    top.drape(deck, 0, stone, terrain);
    sides.skirt(deck, stone, terrain, (h) => h - DECK_DEPTH);
    sides.drape(deck, -DECK_DEPTH, stone, terrain, true);
    addGround(world, deck, terrain);
  }
  const ground = new THREE.Mesh(top.build(), asphalt);
  ground.receiveShadow = true;
  const quayMesh = new THREE.Mesh(sides.build(), quay);
  quayMesh.castShadow = quayMesh.receiveShadow = true;
  scene.add(ground, quayMesh);

  // --- Canals: sea water between the quays, a parapet along each side and on every bridge ---
  if (terrain.canals.length) {
    const water = new GeometryBuilder();
    const walls = new GeometryBuilder();
    const seaColor = color(look.sea);
    const edge = island / 2;
    for (const c of terrain.canals) {
      // Water runs under the shore's sea wall and out to sea, a touch below it so the sea wins there.
      const strip = c.axis === 'x' ? { x: 0, z: c.at, w: island + 8, d: c.half * 2 } : { x: c.at, z: 0, w: c.half * 2, d: island + 8 };
      water.rect(strip, SEA_LEVEL - 0.05, seaColor);
      // Gaps in the canal-side walls: the bridges and any crossing canal.
      const gaps: [number, number][] = [
        ...terrain.bridges.filter((b) => (c.axis === 'x' ? b.z === c.at : b.x === c.at)).map((b) => span(b, c.axis)),
        ...terrain.canals.filter((o) => o.axis !== c.axis).map((o): [number, number] => [o.at - o.half, o.at + o.half]),
      ];
      for (const side of [-1, 1]) {
        const off = c.at + side * (c.half + PARAPET_INSET + PARAPET.thick / 2);
        for (const [u0, u1] of openSpans(-edge, edge, gaps)) {
          if (c.axis === 'x') wallAlong(walls, world, wallColliders, u0, off, u1, off, stone, terrain);
          else wallAlong(walls, world, wallColliders, off, u0, off, u1, stone, terrain);
        }
      }
    }
    // Bridge railings on both road edges (the sea wall stops at the canal mouths).
    for (const b of terrain.bridges) {
      // Over a canal along X the deck runs along Z; railings reach on to the canal-side walls.
      const crossesX = terrain.canals.some((c) => c.axis === 'x' && c.at === b.z);
      const [lo, hi] = crossesX ? [b.z - b.d / 2 - PARAPET.thick, b.z + b.d / 2 + PARAPET.thick] : [b.x - b.w / 2 - PARAPET.thick, b.x + b.w / 2 + PARAPET.thick];
      for (const side of [-1, 1]) {
        if (crossesX) {
          const x = b.x + side * (b.w / 2 - PARAPET_INSET - PARAPET.thick / 2);
          wallAlong(walls, world, wallColliders, x, lo, x, hi, stone, terrain);
        } else {
          const z = b.z + side * (b.d / 2 - PARAPET_INSET - PARAPET.thick / 2);
          wallAlong(walls, world, wallColliders, lo, z, hi, z, stone, terrain);
        }
      }
    }
    const waterMesh = new THREE.Mesh(water.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.2 }));
    waterMesh.receiveShadow = true;
    const wallMesh = new THREE.Mesh(walls.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    wallMesh.castShadow = wallMesh.receiveShadow = true;
    scene.add(waterMesh, wallMesh);
  }

  // --- Sidewalks, parks, plazas ---
  const flats = new GeometryBuilder();
  // Paving follows the ground and stops at the canals.
  const pave = (r: Rect, lift: number, c: THREE.Color) => {
    for (const piece of terrain.land) {
      const part = clipRect(r, piece);
      if (part) flats.drape(part, lift, c, terrain);
    }
  };
  for (const block of city.blocks) {
    pave(block.rect, 0.03, color(theme.sidewalk));
    if (block.square) {
      const m = city.config.sidewalk;
      pave({ ...block.rect, w: block.rect.w - m * 2, d: block.rect.d - m * 2 }, 0.045, color(theme.plaza));
    }
    if (block.park) {
      const m = city.config.sidewalk;
      pave({ ...block.rect, w: block.rect.w - m * 2, d: block.rect.d - m * 2 }, 0.05, color(theme.grass));
    }
  }
  for (const plaza of city.plazas) pave(plaza, 0.03, color(theme.plaza));
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
    pave(r, 0.03, color(theme.promenade ?? theme.sidewalk));
  }
  const flatMesh = new THREE.Mesh(flats.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: wet ? 0.6 : 1 }));
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
  // Draped over the hill (roads run on over the bridge decks, which follow the same ground).
  const paint = new GeometryBuilder();
  for (const mk of markings) paint.drape(mk, 0.02, color(mk.c), terrain);
  scene.add(new THREE.Mesh(paint.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  const m4 = new THREE.Matrix4();

  // --- Buildings: merged walls (windowed) + merged roofs, one collider each ---
  const walls = new GeometryBuilder();
  const roofs = new GeometryBuilder();
  // On a slope a building stands on its lowest corner; the uphill side sinks into the ground.
  const footings = city.buildings.map((b) => groundBase(terrain, b.x, b.z, Math.max(b.w, b.d) / 2) - 0.3);
  city.buildings.forEach((b, i) => addBuilding(b, footings[i], theme.buildings[b.district], walls, roofs, rng, climate.snowRoofs));
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
  city.buildings.forEach((b, i) => {
    wallColliders.add(world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, footings[i] + b.h / 2, b.z)).handle);
  });

  // --- Plaza planters ---
  const planterGeo = new THREE.BoxGeometry(1, 0.9, 1).translate(0, 0.45, 0);
  const planters = new THREE.InstancedMesh(planterGeo, new THREE.MeshStandardMaterial({ color: theme.planter, flatShading: true }), city.props.length);
  city.props.forEach((p, i) => {
    const y = groundBase(terrain, p.x, p.z, Math.max(p.w, p.d) / 2);
    planters.setMatrixAt(i, m4.makeScale(p.w, 1, p.d).setPosition(p.x, y, p.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(p.w / 2, 0.45, p.d / 2).setTranslation(p.x, y + 0.45, p.z));
  });
  planters.castShadow = planters.receiveShadow = true;
  scene.add(planters);

  // --- Trees (the climate's kinds) and beach umbrellas: breakable, so PropSystem builds them ---
  const props: StreetProp[] = city.trees.map((t) => ({
    kind: 'tree',
    tree: pickTree(climate, rng),
    x: t.x,
    z: t.z,
    yaw: rng.range(0, Math.PI * 2),
    scale: rng.range(0.8, 1.3),
    color: new THREE.Color().setScalar(rng.range(0.85, 1.1)).getHex(), // a little tonal variety
  }));
  if (climate.beachProps) props.push(...addBeach(city, scene, rng));

  // --- Sea wall along the island edge: a low visible barrier, plus a tall invisible one so a
  // car launched off something can't sail into the sea. It stops where a canal opens to the sea
  // (bridges there have their own railings) ---
  const wallT = 0.6;
  const wallH = 1;
  const edge = island / 2 - wallT / 2;
  const mouths = (axis: 'x' | 'z') =>
    terrain.canals.filter((c) => c.axis === axis).map((c): [number, number] => [c.at - c.half, c.at + c.half]);
  const seaWall = new GeometryBuilder();
  const runs: Rect[] = [];
  // Walls along X are cut by canals running along Z, and vice versa.
  for (const [u0, u1] of openSpans(-island / 2, island / 2, mouths('z'))) {
    for (const z of [edge, -edge]) runs.push({ x: (u0 + u1) / 2, z, w: u1 - u0, d: wallT });
  }
  for (const [u0, u1] of openSpans(-island / 2 + wallT, island / 2 - wallT, mouths('x'))) {
    for (const x of [edge, -edge]) runs.push({ x, z: (u0 + u1) / 2, w: wallT, d: u1 - u0 });
  }
  for (const r of runs) {
    seaWall.box(r, 0, wallH, color(theme.seaWall), null, color(theme.seaWall));
    wallColliders.add(world.createCollider(RAPIER.ColliderDesc.cuboid(r.w / 2, 10, r.d / 2).setTranslation(r.x, 10, r.z)).handle);
  }
  const seaWallMesh = new THREE.Mesh(seaWall.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  seaWallMesh.castShadow = seaWallMesh.receiveShadow = true;
  scene.add(seaWallMesh);
  return { walls: wallColliders, props };
}

function addBuilding(b: Building, y0: number, palette: number[], walls: GeometryBuilder, roofs: GeometryBuilder, rng: Rng, snowy: boolean): void {
  const wallColor = new THREE.Color(palette[Math.floor(b.variant * palette.length)]);
  const roofColor = snowy ? new THREE.Color(SNOW) : wallColor.clone().multiplyScalar(0.55);
  // Per-building window pattern offset, snapped to whole cells so windows line up with floors.
  const uOff = Math.floor(b.variant * 97) % WINDOW_CELLS / WINDOW_CELLS;
  const vOff = Math.floor(b.variant * 389) % WINDOW_CELLS / WINDOW_CELLS;
  const wallUv = (w: number, h: number) => {
    const u = Math.max(1, Math.round(w / WINDOW_WIDTH)) / WINDOW_CELLS;
    const v = Math.max(1, Math.round(h / FLOOR_HEIGHT)) / WINDOW_CELLS;
    return [[uOff, vOff], [uOff + u, vOff], [uOff + u, vOff + v], [uOff, vOff + v]];
  };
  walls.box(b, y0, b.h, wallColor, roofs, roofColor, wallUv);

  // Rooftop details on taller buildings: AC units, stair housings.
  if (b.h > 14) {
    const count = rng.int(1, 3);
    for (let k = 0; k < count; k++) {
      const w = rng.range(2, Math.min(6, b.w * 0.4));
      const d = rng.range(2, Math.min(6, b.d * 0.4));
      const x = b.x + rng.range(-(b.w - w) / 2 + 0.5, (b.w - w) / 2 - 0.5);
      const z = b.z + rng.range(-(b.d - d) / 2 + 0.5, (b.d - d) / 2 - 0.5);
      const unitColor = snowy ? wallColor.clone().multiplyScalar(0.7) : roofColor.clone().multiplyScalar(1.4);
      roofs.box({ x, z, w, d }, y0 + b.h, rng.range(1.2, 3.5), unitColor, null, roofColor);
    }
  }
}

function pickTree(climate: Climate, rng: Rng): TreeKind {
  let roll = rng.next();
  for (const t of climate.trees) if ((roll -= t.weight) < 0) return t.kind;
  return climate.trees[climate.trees.length - 1].kind;
}

/** Beach umbrellas (breakable props, returned) and towels along the promenade, between its lamps and benches. */
function addBeach(city: CityData, scene: THREE.Scene, rng: Rng): StreetProp[] {
  const half = city.size / 2;
  const spots: { x: number; z: number }[] = [];
  const sides = [
    { nx: 1, nz: 0, tx: 0, tz: 1 },
    { nx: -1, nz: 0, tx: 0, tz: 1 },
    { nx: 0, nz: 1, tx: 1, tz: 0 },
    { nx: 0, nz: -1, tx: 1, tz: 0 },
  ];
  const out = half + city.config.promenade / 2;
  for (const side of sides) {
    // Lamps stand every 30 m from -half + 15 and benches halfway between: use the quarter points.
    for (let t = -half + 22.5; t <= half - 22.5; t += 15) {
      if (rng.next() < 0.3) continue;
      const along = t + rng.range(-1.5, 1.5);
      spots.push({ x: side.nx * out + side.tx * along, z: side.nz * out + side.tz * along });
    }
  }
  const towels = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.9, 0.02, 1.9).translate(0, 0.045, 0),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    spots.length,
  );
  const palette = [0xe84a3c, 0xf4f0e6, 0x2f8fd8, 0xf2c230, 0x2fb8a0];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const umbrellas: StreetProp[] = spots.map((p, i) => {
    const umbrella: StreetProp = { kind: 'umbrella', x: p.x, z: p.z, yaw: rng.range(0, Math.PI * 2), color: rng.pick(palette) };
    q.setFromAxisAngle(up, rng.range(-0.4, 0.4) + (Math.abs(p.x) > Math.abs(p.z) ? 0 : Math.PI / 2));
    const tx = p.x + rng.range(-1.6, 1.6);
    const tz = p.z + rng.range(-1.6, 1.6);
    towels.setMatrixAt(i, m4.compose(new THREE.Vector3(tx, groundHeight(city.terrain, tx, tz), tz), q, one));
    towels.setColorAt(i, new THREE.Color(rng.pick(palette)));
    return umbrella;
  });
  towels.receiveShadow = true;
  scene.add(towels);
  return umbrellas;
}

/** Static ground collider for a rectangle of terrain: a heightfield sampled every CELL metres. */
export function addGround(world: RAPIER.World, r: Rect, t: Terrain): void {
  const flat = isFlat(t, r);
  const ncols = cells(r.w, flat); // along X
  const nrows = cells(r.d, flat); // along Z
  const heights = new Float32Array((nrows + 1) * (ncols + 1));
  // Column-major: rows run along Z, columns along X.
  for (let col = 0; col <= ncols; col++) {
    for (let row = 0; row <= nrows; row++) {
      heights[col * (nrows + 1) + row] = groundHeight(t, r.x - r.w / 2 + (r.w * col) / ncols, r.z - r.d / 2 + (r.d * row) / nrows);
    }
  }
  world.createCollider(RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, { x: r.w, y: 1, z: r.d }).setTranslation(r.x, 0, r.z).setFriction(1));
}

/** A rectangle's extent along an axis. */
function span(r: Rect, axis: 'x' | 'z'): [number, number] {
  return axis === 'x' ? [r.x - r.w / 2, r.x + r.w / 2] : [r.z - r.d / 2, r.z + r.d / 2];
}

/** [from, to] minus the gaps. */
function openSpans(from: number, to: number, gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = from;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 > at) out.push([at, Math.min(g0, to)]);
    at = Math.max(at, g1);
  }
  if (at < to) out.push([at, to]);
  return out.filter(([a, b]) => b - a > 0.2);
}

/**
 * A parapet along an axis-aligned line: drawn low, but solid well above the ground so a car
 * thrown off a ramp can't sail over it into the water.
 */
function wallAlong(
  geo: GeometryBuilder, world: RAPIER.World, walls: Set<number>,
  ax: number, az: number, bx: number, bz: number, c: THREE.Color, t: Terrain,
): void {
  geo.parapet(ax, az, bx, bz, c, t);
  const alongX = bx !== ax;
  const [u0, u1] = alongX ? [Math.min(ax, bx), Math.max(ax, bx)] : [Math.min(az, bz), Math.max(az, bz)];
  const steps = Math.max(1, Math.ceil((u1 - u0) / 8));
  for (let k = 0; k < steps; k++) {
    const s0 = u0 + ((u1 - u0) * k) / steps;
    const s1 = u0 + ((u1 - u0) * (k + 1)) / steps;
    const g = [s0, s1].map((u) => (alongX ? groundHeight(t, u, az) : groundHeight(t, ax, u)));
    const lo = Math.min(...g) - 1;
    const hi = Math.max(...g) + 8;
    const mid = (s0 + s1) / 2;
    const half = (s1 - s0) / 2;
    const desc = alongX
      ? RAPIER.ColliderDesc.cuboid(half, (hi - lo) / 2, PARAPET.thick / 2).setTranslation(mid, (lo + hi) / 2, az)
      : RAPIER.ColliderDesc.cuboid(PARAPET.thick / 2, (hi - lo) / 2, half).setTranslation(ax, (lo + hi) / 2, mid);
    walls.add(world.createCollider(desc).handle);
  }
}
