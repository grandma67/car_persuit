import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Rng } from '../core/Rng';
import type { Building, CityData, Rect } from './CityGenerator';
import { ROOF_TILES, zoneLook, type CityTheme } from './CityTheme';
import { DISTRICT_DEFS } from './districts/index';
import type { LotLook, TrimKind } from './districts/District';
import { ARCADE_DEPTH, EAVE, JETTY_FROM, clockTowerFrame, jettyDepth, roofRise } from './districts/trims';
import type { Climate, TreeKind } from './Climate';
import type { StreetProp } from './StreetProps';
import { clipRect, groundBase, groundHeight, groundNormal, isFlat, type Terrain } from './Terrain';
import { SEA_LEVEL } from '../render/Sea';
import { CanalWater } from '../render/CanalWater';
import { createFacadeTextures, WINDOW_CELLS, type FacadeStyle } from '../render/Facades';

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
const CANAL_RAMP_GAP = 6; // half-width of the parapet gaps at a canal ramp
const SOLID_HEIGHT = 10; // district solids' colliders: tall enough that nothing jumps them

/** Accumulates flat-shaded quads into one BufferGeometry. */
export class GeometryBuilder {
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

  /** Flat rectangle at height y, split into cells of about `step` metres (for vertex animation). */
  grid(r: Rect, y: number, color: THREE.Color, step: number): void {
    const nx = Math.max(1, Math.round(r.w / step));
    const nz = Math.max(1, Math.round(r.d / step));
    for (let b = 0; b < nz; b++) {
      for (let a = 0; a < nx; a++) {
        this.rect({ x: r.x - r.w / 2 + (r.w * (a + 0.5)) / nx, z: r.z - r.d / 2 + (r.d * (b + 0.5)) / nz, w: r.w / nx, d: r.d / nz }, y, color);
      }
    }
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

export interface CityLook {
  theme: CityTheme;
  climate: Climate;
  windowGlow: number; // emissive strength of lit windows (time of day, weather)
  wet: boolean; // rain: glossy, darker roads and pavements
  sea: number; // deep water colour, for the canals
  shallow: number; // the sea's colour at the shore, where the canals open into it
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
): { walls: Set<number>; props: StreetProp[]; canalWater: CanalWater | null } {
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
  let canalWater: CanalWater | null = null;
  if (terrain.canals.length) {
    const water = new GeometryBuilder();
    const walls = new GeometryBuilder();
    const seaColor = color(look.sea);
    const edge = island / 2;
    for (const c of terrain.canals) {
      // Water runs under the shore's sea wall and out to sea, a touch below it so the sea wins there.
      const strip = c.axis === 'x' ? { x: 0, z: c.at, w: island + 8, d: c.half * 2 } : { x: c.at, z: 0, w: c.half * 2, d: island + 8 };
      water.grid(strip, SEA_LEVEL - 0.05, seaColor, 3);
      // Gaps in the canal-side walls: the bridges and any crossing canal.
      const gaps: [number, number][] = [
        ...terrain.bridges.filter((b) => (c.axis === 'x' ? b.z === c.at : b.x === c.at)).map((b) => span(b, c.axis)),
        ...terrain.canals.filter((o) => o.axis !== c.axis).map((o): [number, number] => [o.at - o.half, o.at + o.half]),
        // A canal ramp's lane, on both banks: nothing to clip taking off or touching down.
        ...city.landmarks
          .filter((l) => l.crossing === c.at && (c.axis === 'x') === (Math.abs(Math.cos(l.yaw)) > 0.5))
          .map((l): [number, number] => {
            const u = c.axis === 'x' ? l.x : l.z;
            return [u - CANAL_RAMP_GAP, u + CANAL_RAMP_GAP];
          }),
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
    canalWater = new CanalWater(terrain.canals, island / 2, look.sea, look.shallow);
    const waterMesh = new THREE.Mesh(water.build(), canalWater.material);
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
  const markColor = { centerline: theme.centerLine, edgeline: theme.edgeLine, crosswalk: 0xf2f2ee, stopline: 0xf2f2ee };
  for (const mark of city.roadMarks) markings.push({ ...mark, c: markColor[mark.kind] });
  // Draped over the hill (roads run on over the bridge decks, which follow the same ground).
  const paint = new GeometryBuilder();
  for (const mk of markings) paint.drape(mk, 0.02, color(mk.c), terrain);
  scene.add(new THREE.Mesh(paint.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  const m4 = new THREE.Matrix4();

  // --- Buildings: merged walls per facade style (windowed) + merged roofs, one collider each ---
  const { walls, roofs, footings } = buildingGeometry(city, theme, climate, rng);
  const meshes = [...walls].map(([facade, builder]) => {
    const tex = createFacadeTextures(facade, rng);
    return new THREE.Mesh(
      builder.build(true),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: 0xffffff,
        emissiveIntensity: windowGlow,
        roughnessMap: tex.surface,
        metalnessMap: tex.surface,
        roughness: 1, // both scaled by the surface map
        metalness: 1,
      }),
    );
  });
  meshes.push(new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
  for (const mesh of meshes) {
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  city.buildings.forEach((b, i) => {
    wallColliders.add(world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, footings[i] + b.h / 2, b.z)).handle);
  });

  // --- District solids (walls, towers, stacks, crane legs …): unbreakable, and they take crash marks ---
  for (const q of city.districts) {
    for (const fp of q.dressing.solids) {
      const y = groundBase(terrain, fp.x, fp.z, Math.hypot(fp.hx, fp.hz)) - 1;
      const desc = RAPIER.ColliderDesc.cuboid(fp.hx, SOLID_HEIGHT / 2, fp.hz)
        .setTranslation(fp.x, y + SOLID_HEIGHT / 2, fp.z)
        .setRotation({ x: 0, y: Math.sin(fp.yaw / 2), z: 0, w: Math.cos(fp.yaw / 2) });
      wallColliders.add(world.createCollider(desc).handle);
    }
  }

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
  return { walls: wallColliders, props, canalWater };
}

/**
 * Every building's geometry: walls merged per facade style (windowed, UV-mapped to the facade
 * texture) and roofs, caps and base courses merged into one more. Also each building's footing.
 * `rng` is the city's visual stream (rooftop details), shared with the facade textures after.
 */
export function buildingGeometry(city: CityData, theme: CityTheme, climate: Climate, rng: Rng): { walls: Map<FacadeStyle, GeometryBuilder>; roofs: GeometryBuilder; footings: number[] } {
  const terrain = city.terrain;
  const walls = new Map<FacadeStyle, GeometryBuilder>();
  const roofs = new GeometryBuilder();
  // On a slope a building stands on its lowest corner; the uphill side sinks into the ground.
  const footings = city.buildings.map((b) => groundBase(terrain, b.x, b.z, Math.max(b.w, b.d) / 2) - 0.3);
  city.buildings.forEach((b, i) => addBuilding(b, footings[i], lookFor(b, theme), walls, roofs, rng, climate.snowRoofs, terrain));
  return { walls, roofs, footings };
}

/** A building's look: its district lot's, else its zone's. */
export function lookFor(b: Building, theme: CityTheme): LotLook {
  const def = b.district && b.lot ? DISTRICT_DEFS.find((d) => d.kind === b.district) : undefined;
  const look = def && b.lot ? def.looks[b.lot] : undefined;
  if (!look) return zoneLook(theme, b.zone);
  const full = { ...look, ...theme.districts?.[b.district!]?.[b.lot!] };
  // Some lots take the look's alternative roof.
  return full.roofAlt && (b.variant * 5) % 1 < 0.4 ? { ...full, roof: full.roofAlt } : full;
}

/** Flat-roof cap per facade: overhang past the walls, height above the roof line, depth below it. */
const CAPS: Record<FacadeStyle, { over: number; up: number; down: number; stone: boolean }> = {
  curtain: { over: 0.08, up: 0.6, down: 0.3, stone: false },
  office: { over: 0.45, up: 0.35, down: 0.5, stone: true },
  brick: { over: 0.4, up: 0.5, down: 0.6, stone: true },
  stucco: { over: 0.15, up: 0.5, down: 0.25, stone: false },
  shutters: { over: 0.15, up: 0.5, down: 0.25, stone: false },
  siding: { over: 0.3, up: 0.3, down: 0.3, stone: false },
  adobe: { over: 0.1, up: 0.7, down: 0.1, stone: false },
  industrial: { over: 0.05, up: 0.4, down: 0.2, stone: false },
  halfTimber: { over: 0.25, up: 0.25, down: 0.25, stone: false },
  ashlar: { over: 0.35, up: 0.5, down: 0.45, stone: true },
};
const WHITE = new THREE.Color(0xffffff);

/** The builder for a facade style's merged walls (made on first use). */
function wallsFor(walls: Map<FacadeStyle, GeometryBuilder>, facade: FacadeStyle): GeometryBuilder {
  let g = walls.get(facade);
  if (!g) walls.set(facade, (g = new GeometryBuilder()));
  return g;
}

/**
 * One building on the facade pipeline: windowed walls merged per facade style (floor 0 into the
 * look's ground style, when it has one), and its roof, caps and trims into the shared roof mesh.
 */
function addBuilding(
  b: Building, y0: number, look: LotLook, walls: Map<FacadeStyle, GeometryBuilder>, roofs: GeometryBuilder, rng: Rng, snowy: boolean, terrain: Terrain,
): void {
  const upper = wallsFor(walls, look.facade);
  const ground = look.ground && look.ground !== look.facade ? wallsFor(walls, look.ground) : null;
  const palette = look.palette;
  const wallColor = new THREE.Color(palette[Math.floor(b.variant * palette.length)]);
  const roofColor = snowy ? new THREE.Color(SNOW) : wallColor.clone().multiplyScalar(0.55);
  // Per-building window pattern offset, snapped to whole cells so windows line up with floors.
  const uOff = Math.floor(b.variant * 97) % WINDOW_CELLS / WINDOW_CELLS;
  const vOff = Math.floor(b.variant * 389) % WINDOW_CELLS / WINDOW_CELLS;
  // Each wall in whole floors. On a slope the building stands on its lowest corner, so uphill the
  // ground climbs its walls: any floor whose windows would start below the ground along that wall
  // is a plain base course instead (untextured, with the roofs), and the windows begin above it.
  const floors = Math.max(1, Math.round(b.h / FLOOR_HEIGHT));
  const floor = b.h / floors;
  const sill = 0.3; // window bottoms sit about this far up their floor (see Facades)
  const baseColor = wallColor.clone().multiplyScalar(0.72);
  const y1 = y0 + b.h;
  // Tall towers step back for their top floors (visual only: the collider stays the full box).
  const glassy = look.facade === 'curtain' || look.facade === 'office';
  const split = glassy && b.h > 50 ? Math.round(floors * (0.65 + b.variant * 0.15)) : floors;
  const ySplit = y0 + split * floor;
  const inset = Math.min(b.w, b.d) * 0.14;
  const top: Rect = split < floors ? { x: b.x, z: b.z, w: b.w - inset * 2, d: b.d - inset * 2 } : b;

  const wallFaces = (r: Rect, ya: number, yb: number, fa: number, fb: number, onGround: boolean) => {
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
    const faces: [number[], number[], number[]][] = [
      [[x0, z1], [x1, z1], [0, 0, 1]],
      [[x1, z0], [x0, z0], [0, 0, -1]],
      [[x1, z1], [x1, z0], [1, 0, 0]],
      [[x0, z0], [x0, z1], [-1, 0, 0]],
    ];
    for (const [[ax, az], [bx, bz], normal] of faces) {
      let blank = 0;
      if (onGround) {
        let groundY = -Infinity;
        for (let k = 0; k <= 4; k++) groundY = Math.max(groundY, groundHeight(terrain, ax + ((bx - ax) * k) / 4, az + ((bz - az) * k) / 4));
        blank = Math.min(fb, Math.max(0, Math.ceil((groundY - ya) / floor - sill + 0.02)));
      }
      let yw = ya + blank * floor;
      if (blank > 0) roofs.quad([[ax, ya, az], [bx, ya, bz], [bx, yw, bz], [ax, yw, az]], normal, baseColor);
      let f = fa + blank;
      if (f >= fb) continue;
      const u = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / WINDOW_WIDTH)) / WINDOW_CELLS;
      const band = (to: GeometryBuilder, f0: number, f1: number, yA: number, yB: number) => {
        const v0 = vOff + f0 / WINDOW_CELLS;
        const v1 = vOff + f1 / WINDOW_CELLS;
        to.quad([[ax, yA, az], [bx, yA, bz], [bx, yB, bz], [ax, yB, az]], normal, wallColor, [[uOff, v0], [uOff + u, v0], [uOff + u, v1], [uOff, v1]]);
      };
      // The ground floor in its own style (shopfronts, roller doors), when it's at street level.
      if (ground && f === 0) {
        band(ground, 0, 1, yw, yw + floor);
        f = 1;
        yw += floor;
        if (f >= fb) continue;
      }
      band(upper, f, fb, yw, yb);
    }
  };
  const trims = look.trims ?? [];
  // An arcade sets its ground floor back behind columns; a jetty pushes the upper floors out.
  const arcade = trims.includes('colonnade') && split === floors && floors >= 2;
  const jetFloor = Math.ceil(JETTY_FROM / floor - 1e-6);
  const jetty = !arcade && trims.includes('jetty') && split === floors && jetFloor < floors ? jettyDepth(b.variant) : 0;
  let roofB: Building = b;
  if (arcade) {
    wallFaces(grow(b, -ARCADE_DEPTH), y0, y0 + floor, 0, 1, true);
    wallFaces(b, y0 + floor, ySplit, 1, split, false);
  } else if (jetty) {
    const yj = y0 + jetFloor * floor;
    roofB = { ...b, ...grow(b, jetty) };
    wallFaces(b, y0, yj, 0, jetFloor, true);
    wallFaces(roofB, yj, y1, jetFloor, floors, false);
  } else {
    wallFaces(b, y0, ySplit, 0, split, true);
    if (split < floors) wallFaces(top, ySplit, y1, split, floors, false);
  }

  addRoof(look, roofB, { y1, ySplit, split, floors, top: roofB === b ? top : roofB }, roofs, rng, wallColor, roofColor, snowy);
  addTrims(trims, b, { y0, floor, jetty, jetFloor, roofB, roof: look.roof, tile: roofColor }, roofs, wallColor, snowy);
}

const grow = (r: Rect, m: number): Rect => ({ x: r.x, z: r.z, w: r.w + m * 2, d: r.d + m * 2 });

interface RoofFrame {
  y1: number; // wall tops
  ySplit: number; // where a tower steps back
  split: number;
  floors: number;
  top: Rect; // the top floors' footprint
}

/** The roof for a look's shape, into the shared roof mesh. Shapes still to come stand in as gable or flat. */
function addRoof(look: LotLook, b: Building, f: RoofFrame, roofs: GeometryBuilder, rng: Rng, wallColor: THREE.Color, roofColor: THREE.Color, snowy: boolean): void {
  const tiles = look.roofTiles ?? ROOF_TILES;
  const tile = () => (snowy ? new THREE.Color(SNOW) : new THREE.Color(tiles[Math.floor(b.variant * 31) % tiles.length]));
  switch (look.roof) {
    case 'steepGable':
      addGable(b, f.y1, roofs, wallColor, tile(), roofRise('steepGable', b));
      return;
    case 'hip':
      addHip(b, f.y1, roofs, tile(), roofRise('hip', b));
      return;
    case 'gable':
    case 'gambrel': // stub
    case 'monopitch': // stub
      addGable(b, f.y1, roofs, wallColor, tile());
      return;
    case 'flat':
    case 'sawtooth': // stub
    case 'barrel': // stub
    case 'pagoda': // stub
      addFlatRoof(look.facade, b, f, roofs, rng, wallColor, roofColor, snowy);
  }
}

/** A cornice or parapet slab (at the step-back too), and rooftop details on taller buildings. */
function addFlatRoof(facade: FacadeStyle, b: Building, f: RoofFrame, roofs: GeometryBuilder, rng: Rng, wallColor: THREE.Color, roofColor: THREE.Color, snowy: boolean): void {
  const { top, y1 } = f;
  // A cornice or parapet slab with a soffit under its overhang.
  const cap = CAPS[facade];
  const capColor = cap.stone ? wallColor.clone().lerp(WHITE, 0.45) : wallColor.clone().multiplyScalar(0.9);
  const slab = (r: Rect, y: number) => {
    const o = cap.over;
    const outer = { x: r.x, z: r.z, w: r.w + o * 2, d: r.d + o * 2 };
    roofs.box(outer, y - cap.down, cap.down + cap.up, capColor, null, roofColor);
    if (o > 0.05) {
      const x0 = outer.x - outer.w / 2, x1 = outer.x + outer.w / 2, z0 = outer.z - outer.d / 2, z1 = outer.z + outer.d / 2, yb = y - cap.down;
      roofs.quad([[x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1]], [0, -1, 0], capColor.clone().multiplyScalar(0.7));
    }
  };
  if (f.split < f.floors) slab(b, f.ySplit);
  slab(top, y1);

  // Rooftop details on taller buildings: AC units, stair housings.
  if (b.h > 14) {
    const count = rng.int(1, 3);
    for (let k = 0; k < count; k++) {
      const w = rng.range(2, Math.min(6, top.w * 0.4));
      const d = rng.range(2, Math.min(6, top.d * 0.4));
      const x = top.x + rng.range(-(top.w - w) / 2 + 0.5, (top.w - w) / 2 - 0.5);
      const z = top.z + rng.range(-(top.d - d) / 2 + 0.5, (top.d - d) / 2 - 0.5);
      const unitColor = snowy ? wallColor.clone().multiplyScalar(0.7) : roofColor.clone().multiplyScalar(1.4);
      roofs.box({ x, z, w, d }, y1 + cap.up, rng.range(1.2, 3.5), unitColor, null, roofColor);
    }
  }
}

interface TrimFrame {
  y0: number; // footing
  floor: number; // storey height
  jetty: number; // how far the upper floors stand out (0: none)
  jetFloor: number; // the first jettied floor
  roofB: Rect; // the footprint the roof covers
  roof: LotLook['roof'];
  tile: THREE.Color;
}

/**
 * Trims: a few merged boxes and quads in the roof mesh (no new draw calls). The collider stays the
 * lot box. Each district milestone fills in its own.
 */
function addTrims(trims: TrimKind[], b: Building, f: TrimFrame, roofs: GeometryBuilder, wallColor: THREE.Color, snowy: boolean): void {
  const oak = new THREE.Color(0x3b2a1c);
  const y1 = f.y0 + b.h;
  for (const trim of trims) {
    switch (trim) {
      case 'jetty': {
        if (!f.jetty) break;
        // A dark bressumer beam round the overhang, and its underside.
        const yj = f.y0 + f.jetFloor * f.floor;
        const r = f.roofB;
        roofs.box(r, yj - 0.25, 0.25, oak, null, oak);
        const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2, yb = yj - 0.25;
        roofs.quad([[x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1]], [0, -1, 0], oak.clone().multiplyScalar(0.7));
        break;
      }
      case 'chimney': {
        // On some houses (by variant): a stack near one end of the ridge, rising past it.
        if ((b.variant * 7) % 1 >= 0.55) break;
        const r = f.roofB;
        const alongX = r.w >= r.d;
        const end = ((b.variant * 31) % 1 < 0.5 ? -1 : 1) * ((alongX ? r.w : r.d) / 2 - 1.2);
        const across = ((b.variant * 17) % 1 - 0.5) * Math.min(r.w, r.d) * 0.3;
        const x = alongX ? r.x + end : r.x + across;
        const z = alongX ? r.z + across : r.z + end;
        const top = y1 + roofRise(f.roof, r) + 1.1;
        const brick = new THREE.Color(0x8a4a3a);
        roofs.box({ x, z, w: 0.8, d: 0.8 }, y1 - 0.5, top - y1 + 0.5, brick, null, snowy ? new THREE.Color(SNOW) : new THREE.Color(0x2a2a2a));
        roofs.box({ x, z, w: 1.0, d: 1.0 }, top - 0.25, 0.25, brick.clone().multiplyScalar(0.8), null, snowy ? new THREE.Color(SNOW) : brick);
        break;
      }
      case 'clockTower': {
        // The tower and its spire; the district renderer adds the dials and hands.
        const t = clockTowerFrame(b, f.roof);
        const stone = wallColor.clone().lerp(WHITE, 0.15);
        roofs.box({ x: t.x, z: t.z, w: t.half * 2, d: t.half * 2 }, f.y0 + t.base, t.top - t.base, stone, null, stone);
        roofs.box({ x: t.x, z: t.z, w: t.half * 2 + 0.5, d: t.half * 2 + 0.5 }, f.y0 + t.top - 0.4, 0.4, stone.clone().multiplyScalar(0.8), null, stone);
        const apex = f.y0 + t.top + t.half * 2.4;
        const h = t.half + 0.25;
        const yb = f.y0 + t.top;
        const c = [[-h, -h], [h, -h], [h, h], [-h, h]];
        const slope = Math.hypot(apex - yb, h);
        for (let k = 0; k < 4; k++) {
          const [ax, az] = c[k];
          const [bx, bz] = c[(k + 1) % 4];
          // The face's outward direction is its bottom edge's midpoint (the tower is centred).
          const mx = (ax + bx) / 2 / h, mz = (az + bz) / 2 / h;
          const n = [(mx * (apex - yb)) / slope, h / slope, (mz * (apex - yb)) / slope];
          roofs.quad([[t.x + bx, yb, t.z + bz], [t.x + ax, yb, t.z + az], [t.x, apex, t.z], [t.x, apex, t.z]], n, f.tile);
        }
        break;
      }
      case 'colonnade': {
        // Columns on the lot line every ~3 m round the set-back ground floor, and the arcade's ceiling.
        const top = f.y0 + f.floor;
        const col = wallColor.clone().lerp(WHITE, 0.3);
        const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
        const sides: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
        for (const [ax, az, bx, bz] of sides) {
          const len = Math.hypot(bx - ax, bz - az);
          const n = Math.max(2, Math.round(len / 3));
          // Just inside the lot line, so the columns stay within the collider.
          const ix = az === bz ? 0 : Math.sign(b.x - ax) * 0.25;
          const iz = ax === bx ? 0 : Math.sign(b.z - az) * 0.25;
          for (let k = 0; k < n; k++) {
            const u = (k + 0.5) / n;
            roofs.box({ x: ax + (bx - ax) * u + ix, z: az + (bz - az) * u + iz, w: 0.5, d: 0.5 }, f.y0, f.floor, col, null, col);
          }
        }
        const yb = top - 0.02;
        roofs.quad([[x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1]], [0, -1, 0], col.clone().multiplyScalar(0.6));
        break;
      }
      case 'balcony':
      case 'loadingDock':
      case 'porch':
      case 'hoist':
      case 'radarMast':
        break;
    }
  }
}

/** Pitched roof with overhanging eaves, ridge along the longer side, gable ends in the wall colour. */
function addGable(b: Rect, y: number, roofs: GeometryBuilder, wallColor: THREE.Color, tileColor: THREE.Color, rise = roofRise('gable', b)): void {
  const o = EAVE;
  const alongX = b.w >= b.d;
  const len = (alongX ? b.w : b.d) / 2 + o; // half-length along the ridge
  const run = (alongX ? b.d : b.w) / 2 + o; // eave to ridge, horizontally
  // Local (a along the ridge, c across it) to world; swapping axes mirrors, so flip the winding.
  const P = (a: number, h: number, c: number) => (alongX ? [b.x + a, h, b.z + c] : [b.x + c, h, b.z + a]);
  const N = (a: number, h: number, c: number) => (alongX ? [a, h, c] : [c, h, a]);
  const quad = (corners: number[][], normal: number[], color: THREE.Color) =>
    roofs.quad(alongX ? corners : [...corners].reverse(), normal, color);
  const ea = len - o; // gable ends sit in the wall planes
  const ec = run - o;
  const yr = y + rise;
  const ye = y - (rise * o) / ec; // eaves dip below the wall top, so the gables are exact triangles
  const k = Math.hypot(run, yr - ye);
  quad([P(-len, ye, run), P(len, ye, run), P(len, yr, 0), P(-len, yr, 0)], N(0, run / k, (yr - ye) / k), tileColor);
  quad([P(len, ye, -run), P(-len, ye, -run), P(-len, yr, 0), P(len, yr, 0)], N(0, run / k, -(yr - ye) / k), tileColor);
  quad([P(-len, ye, -run), P(len, ye, -run), P(len, ye, run), P(-len, ye, run)], [0, -1, 0], tileColor.clone().multiplyScalar(0.6));
  quad([P(ea, y, ec), P(ea, y, -ec), P(ea, yr, 0), P(ea, yr, 0)], N(1, 0, 0), wallColor);
  quad([P(-ea, y, -ec), P(-ea, y, ec), P(-ea, yr, 0), P(-ea, yr, 0)], N(-1, 0, 0), wallColor);
}

/** Hipped roof: sloping on all four sides, a short ridge along the longer side, overhanging eaves. */
function addHip(b: Rect, y: number, roofs: GeometryBuilder, tileColor: THREE.Color, rise: number): void {
  const o = EAVE;
  const alongX = b.w >= b.d;
  const len = (alongX ? b.w : b.d) / 2 + o;
  const run = (alongX ? b.d : b.w) / 2 + o;
  const ridge = Math.max(0, len - run); // hips at 45° in plan
  const ye = y - (rise * o) / (run - o);
  const yr = y + rise;
  const P = (a: number, h: number, c: number) => (alongX ? [b.x + a, h, b.z + c] : [b.x + c, h, b.z + a]);
  const N = (a: number, h: number, c: number) => (alongX ? [a, h, c] : [c, h, a]);
  const quad = (corners: number[][], normal: number[], color: THREE.Color) => roofs.quad(alongX ? corners : [...corners].reverse(), normal, color);
  const k = Math.hypot(run, yr - ye);
  quad([P(-len, ye, run), P(len, ye, run), P(ridge, yr, 0), P(-ridge, yr, 0)], N(0, run / k, (yr - ye) / k), tileColor);
  quad([P(len, ye, -run), P(-len, ye, -run), P(-ridge, yr, 0), P(ridge, yr, 0)], N(0, run / k, -(yr - ye) / k), tileColor);
  const kh = Math.hypot(len - ridge, yr - ye);
  quad([P(len, ye, run), P(len, ye, -run), P(ridge, yr, 0), P(ridge, yr, 0)], N((yr - ye) / kh, (len - ridge) / kh, 0), tileColor.clone().multiplyScalar(0.92));
  quad([P(-len, ye, -run), P(-len, ye, run), P(-ridge, yr, 0), P(-ridge, yr, 0)], N(-(yr - ye) / kh, (len - ridge) / kh, 0), tileColor.clone().multiplyScalar(0.92));
  quad([P(-len, ye, -run), P(len, ye, -run), P(len, ye, run), P(-len, ye, run)], [0, -1, 0], tileColor.clone().multiplyScalar(0.6));
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
