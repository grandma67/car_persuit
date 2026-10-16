// Chinatown's shopfronts: signboards and vertical neon signs, awnings, the restaurants' door lanterns,
// roast-duck windows and fish tanks, the banquet hall's moon window, the tea house's lattice, the
// herbal shop's drawer wall, the bakery's window, wares hung under the five-foot ways, AC units and
// laundry poles. Static pieces merge into one vertex-coloured mesh (the landmarks' material), signs
// into one mesh on the facades' material settings, the ducks into one instanced mesh (the props'
// material): no new shader programs, three draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/Rng';
import { part } from '../geometry';
import type { Building, CityData } from '../../world/CityGenerator';
import type { District } from '../../world/districts/District';
import { ARCADE_DEPTH } from '../../world/districts/trims';
import { inRect } from '../../world/lots';
import { groundBase } from '../../world/Terrain';
import { glyphAtlas, glyphPlate, NEON, type GlyphCell, type Signboard } from './glyphs';
import type { DistrictRenderContext } from './index';

const FLOOR = 3.5; // as CityBuilder's FLOOR_HEIGHT
const RED = 0xb0221e;
const GOLD = 0xd6a637;
const WOOD = 0x4a2c1c;
const DARK = 0x1e1a18;
const AWNINGS = [0xc8302a, 0x2f7a55, 0xd8a637, 0x2f5f80, 0xe8e0cc];
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg);

/** One street face of a building, in its own frame: local X along the wall, +Z out of it, y = 0 at the footing. */
interface Face {
  frame: THREE.Matrix4;
  len: number;
  at: THREE.Vector3; // the face's centre at the footing
}

function faces(b: Building, y0: number): Face[] {
  const out: Face[] = [];
  const sides: [number, number, number][] = [[0, 1, 1], [0, -1, 2], [1, 0, 4], [-1, 0, 8]];
  for (const [nx, nz, bit] of sides) {
    if (!((b.street ?? 0) & bit)) continue;
    const x = b.x + (nx * b.w) / 2, z = b.z + (nz * b.d) / 2;
    const at = new THREE.Vector3(x, y0, z);
    const frame = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, nz)), new THREE.Vector3(1, 1, 1));
    out.push({ frame, len: nx ? b.d : b.w, at });
  }
  return out;
}

/** A plate of a glyph cell for the signs mesh: non-indexed, white vertex colours (as the facade walls). */
function plate(w: number, h: number, cell: GlyphCell, gap: number): THREE.BufferGeometry {
  const g = glyphPlate(w, h, cell, gap).toNonIndexed();
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
  return g;
}

/** A roast duck hanging from its hook, origin at the hook. */
function duckGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(0.02, 0.12, 0.02), 0x9a9aa0, 0, -0.06),
    part(new THREE.SphereGeometry(0.13, 7, 5).scale(0.8, 1.6, 0.7), 0xa8501e, 0, -0.32),
    part(new THREE.ConeGeometry(0.05, 0.16, 5).rotateX(Math.PI), 0x8a3a14, 0, -0.6),
  ]);
}

export function renderChinatownShops(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): void {
  const rng = new Rng(city.seed ^ 0x5409);
  const solid: THREE.BufferGeometry[] = [];
  const signs: THREE.BufferGeometry[] = [];
  const ducks: THREE.Matrix4[] = [];
  const restaurantBoards: Signboard[] = ['restaurant', 'restaurant2', 'restaurant3'];
  let nextBoard = 0;
  // How far a point is from the main street's centre line.
  const mainLines = q.mainStreet.map((k) => k.split('>').map((id) => city.graph.nodes[Number(id)]));
  const offMain = (p: THREE.Vector3) => Math.min(...mainLines.map(([A, B]) => {
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const t = Math.max(0, Math.min(len, ((p.x - A.x) * (B.x - A.x) + (p.z - A.z) * (B.z - A.z)) / len));
    return Math.hypot(p.x - (A.x + ((B.x - A.x) * t) / len), p.z - (A.z + ((B.z - A.z) * t) / len));
  }));
  const onMain = city.config.roadWidth / 2 + city.config.sidewalk + 1;
  const buildings = city.buildings.filter((b) => b.district === 'chinatown' && inRect(q.bounds, b) && b.street);

  for (const b of buildings) {
    const y0 = groundBase(city.terrain, b.x, b.z, Math.max(b.w, b.d) / 2) - 0.3;
    const floors = Math.max(1, Math.round(b.h / FLOOR));
    const floor = b.h / floors;
    const list = faces(b, y0);
    if (!list.length) continue;
    const arcade = (b.lot === 'shophouse' || b.lot === 'temple') && floors >= 2;
    // The face to dress: on the main street if it has one there, else its longest.
    const front = list.find((f) => offMain(f.at) <= onMain) ?? list.reduce((u, v) => (v.len > u.len ? v : u));
    const add = (into: THREE.BufferGeometry[], f: Face, geo: THREE.BufferGeometry) => into.push(geo.applyMatrix4(f.frame));
    const sign = (f: Face, cell: GlyphCell, w: number, h: number, x: number, y: number, z: number, gap: number, turn = 0) => {
      add(signs, f, plate(w, h, cell, gap).rotateY(turn).translate(x, y, z));
    };
    // A signboard over the shopfront, on a dark backing.
    const board = (f: Face, cell: Signboard, out = 0.12) => {
      const w = Math.min(f.len - 1.5, 5.2);
      const y = floor - 0.55;
      const z = out;
      add(solid, f, part(box(w + 0.2, 1.45, 0.1), DARK, 0, y, z - 0.03));
      sign(f, cell, w, w / 4, 0, y, z + 0.04, 0);
    };
    const awning = (f: Face, w: number, x: number, color: number) => {
      // Under the signboard (its bottom is ~1.3 m below the floor line).
      add(solid, f, part(box(w, 0.08, 1.4).rotateX(0.32), color, x, floor - 1.5, 0.68));
      add(solid, f, part(box(w, 0.32, 0.05), color, x, floor - 1.87, 1.34));
    };
    const lantern = (f: Face, x: number, y: number, z: number) => {
      add(solid, f, part(new THREE.SphereGeometry(0.28, 8, 6).scale(1, 0.85, 1), 0xd62a22, x, y, z));
      for (const dy of [-0.24, 0.24]) add(solid, f, part(cyl(0.11, 0.05), GOLD, x, y + dy, z));
      add(solid, f, part(box(0.04, 0.3, 0.04), 0xe8b02a, x, y - 0.42, z));
      add(solid, f, part(box(0.03, 0.03, z), DARK, x, y + 0.45, z / 2)); // bracket to the wall
    };
    // A shallow lit display window proud of the wall, w × h, its sill at `y`.
    const display = (f: Face, x: number, w: number, y: number, h: number, back: number) => {
      add(solid, f, part(box(w, h, 0.06), back, x, y + h / 2, 0.04));
      for (const sx of [-1, 1]) add(solid, f, part(box(0.1, h + 0.1, 0.45), WOOD, x + (sx * (w + 0.1)) / 2, y + h / 2, 0.22));
      add(solid, f, part(box(w + 0.3, 0.12, 0.5), WOOD, x, y - 0.06, 0.24));
      add(solid, f, part(box(w + 0.3, 0.1, 0.5), WOOD, x, y + h + 0.05, 0.24));
    };

    switch (b.lot) {
      case 'restaurant':
      case 'banquetHall': {
        board(front, restaurantBoards[nextBoard++ % restaurantBoards.length]);
        for (const x of [-1.3, 1.3]) lantern(front, x, floor - 1.5, 0.55);
        // Roast ducks in the window on one side of the door, a fish tank on the other.
        const side = rng.next() < 0.5 ? -1 : 1;
        const wx = side * Math.min(front.len / 2 - 1.6, 3);
        display(front, wx, 2.0, 0.9, 1.4, 0xf2c27a);
        add(solid, front, part(box(1.9, 0.04, 0.04), 0x9a9aa0, wx, 2.15, 0.22)); // the rail
        for (let k = 0; k < 5; k++) ducks.push(front.frame.clone().multiply(new THREE.Matrix4().makeTranslation(wx - 0.76 + k * 0.38, 2.13, 0.22)));
        const tx = -side * Math.min(front.len / 2 - 1.6, 3);
        display(front, tx, 1.6, 0.9, 1.1, 0x3a8aa0);
        for (let k = 0; k < 4; k++) add(solid, front, part(box(0.16, 0.07, 0.04), 0xff8a2a, tx - 0.5 + k * 0.3 + rng.range(-0.08, 0.08), 1.2 + rng.range(0, 0.6), 0.12));
        if (b.lot === 'banquetHall' && floors >= 3) {
          // A round moon window on the floor above the balcony.
          const y = floor * 2 + floor * 0.5;
          add(solid, front, part(new THREE.CylinderGeometry(1.25, 1.25, 0.05, 20).rotateX(Math.PI / 2), 0x2a1a14, 0, y, 0.03));
          add(solid, front, part(new THREE.TorusGeometry(1.3, 0.12, 6, 24), GOLD, 0, y, 0.08));
        }
        break;
      }
      case 'teaHouse': {
        board(front, 'teaHouse');
        // A dark-wood lattice screen across the ground floor.
        const w = Math.min(front.len - 2, 6), h = floor - 1.4;
        for (let k = 0; k <= Math.round(w / 0.4); k++) add(solid, front, part(box(0.05, h, 0.05), WOOD, -w / 2 + k * 0.4, 0.2 + h / 2, 0.08));
        for (let k = 0; k <= Math.round(h / 0.4); k++) add(solid, front, part(box(w, 0.05, 0.05), WOOD, 0, 0.2 + k * 0.4, 0.1));
        for (const x of [-w / 2 - 0.4, w / 2 + 0.4]) lantern(front, x, floor - 1.5, 0.5);
        break;
      }
      case 'bubbleTea':
        board(front, 'bubbleTea');
        awning(front, Math.min(front.len - 1, 5), 0, rng.pick([0xf4a6c8, 0x9ae0e8, 0xf6dc78]));
        break;
      case 'herbalShop': {
        board(front, 'herbalShop');
        // A wall of little drawers in the window, jars on the sill.
        const x = rng.next() < 0.5 ? -1.6 : 1.6;
        display(front, x, 2.2, 0.8, 1.5, 0x6a4028);
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 6; c++) {
            add(solid, front, part(box(0.32, 0.3, 0.05), 0x8a5a36, x - 0.9 + c * 0.36, 0.98 + r * 0.36, 0.1));
            add(solid, front, part(box(0.05, 0.05, 0.04), GOLD, x - 0.9 + c * 0.36, 0.98 + r * 0.36, 0.14));
          }
        }
        for (let k = 0; k < 5; k++) add(solid, front, part(cyl(0.1, 0.26), [0xc8a868, 0x8a6a3a, 0xe8d8b0][k % 3], x - 0.9 + k * 0.45, 0.13, 0.36));
        break;
      }
      case 'bakery': {
        board(front, 'bakery');
        awning(front, Math.min(front.len - 1, 5), 0, rng.pick(AWNINGS));
        const x = rng.next() < 0.5 ? -1.8 : 1.8;
        display(front, x, 2.2, 0.8, 1.2, 0xf4e2c0);
        for (const [y, color] of [[0.86, 0xf2c23a], [1.3, 0x9a5a22], [1.74, 0xf2c23a]] as const) {
          add(solid, front, part(box(2.1, 0.03, 0.35), WOOD, x, y - 0.03, 0.2));
          for (let k = 0; k < 6; k++) add(solid, front, part(cyl(0.12, 0.07, 10), color, x - 0.85 + k * 0.34, y + 0.03, 0.2));
        }
        break;
      }
      case 'temple':
        // A gold plaque over the door.
        add(solid, front, part(box(2.4, 0.9, 0.12), GOLD, 0, floor + 0.2, 0.1));
        add(solid, front, part(box(2.1, 0.65, 0.04), RED, 0, floor + 0.2, 0.18));
        break;
      case 'shophouse': {
        // A signboard over the five-foot way on some, hung wares under it on others.
        const roll = rng.next();
        if (roll < 0.35) board(front, rng.pick(['grocery', 'herbalShop', 'bakery'] as Signboard[]), 0.12);
        else if (roll < 0.7 && arcade) {
          for (let k = 0; k < 5; k++) {
            const x = -front.len / 2 + 1 + rng.range(0, front.len - 2);
            const kind = rng.int(0, 2);
            const y = floor - 0.9;
            if (kind === 0) add(solid, front, part(new THREE.CylinderGeometry(0.25, 0.18, 0.3, 8), 0xb08a52, x, y, -ARCADE_DEPTH / 2)); // rattan basket
            else if (kind === 1) add(solid, front, part(new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x2a2a2e, x, y + 0.2, -ARCADE_DEPTH / 2)); // wok
            else add(solid, front, part(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 10).rotateX(Math.PI / 2), 0xc8a868, x, y, -ARCADE_DEPTH / 2)); // sieve
            add(solid, front, part(box(0.02, 0.6, 0.02), DARK, x, floor - 0.35, -ARCADE_DEPTH / 2));
          }
        }
        break;
      }
    }

    // Every street face: a vertical neon sign on some, AC units here and there, laundry poles
    // off some balconies.
    for (const f of list) {
      if (floors >= 3 && rng.next() < 0.4) {
        const cell = `neon${rng.int(0, NEON.length - 1)}` as GlyphCell;
        const x = rng.range(-f.len / 2 + 1, f.len / 2 - 1);
        const h = Math.min(3.6, floor * 1.1);
        const y = floor * 1.2 + h / 2 + rng.range(0, floor);
        // Edge-on to the wall, so it reads up and down the street; on brackets 0.4 m out.
        add(solid, f, part(box(0.1, h + 0.1, 0.95), DARK, x, y, 0.4 + 0.48));
        sign(f, cell, 0.9, h, x, y, 0.88, 0.14, Math.PI / 2);
        for (const dy of [-h / 2 + 0.3, h / 2 - 0.3]) add(solid, f, part(box(0.05, 0.05, 0.4), DARK, x, y + dy, 0.2));
      }
      for (let k = 0; k < floors - 1; k++) {
        if (rng.next() > 0.25) continue;
        const x = rng.range(-f.len / 2 + 0.8, f.len / 2 - 0.8);
        const y = floor * (k + 1) + floor * 0.25;
        add(solid, f, part(box(0.8, 0.55, 0.45), 0xd8d8d2, x, y, 0.23));
        add(solid, f, part(cyl(0.2, 0.02, 10).rotateX(Math.PI / 2), 0x55585c, x, y, 0.46));
      }
      if (b.lot === 'shophouse' && floors >= 3 && rng.next() < 0.3) {
        // Bamboo poles out from the balcony rail, with washing on them.
        const y = Math.ceil(4.5 / floor - 1e-6) * floor + 1.3;
        const x = rng.range(-f.len / 2 + 1.5, f.len / 2 - 1.5);
        for (const dx of [-0.6, 0.6]) add(solid, f, part(cyl(0.025, 1.6, 5).rotateX(Math.PI / 2), 0xc8a868, x + dx, y, 1.5));
        for (let k = 0; k < 3; k++) {
          const z = 1.1 + k * 0.4;
          add(solid, f, part(box(1.1, rng.range(0.4, 0.7), 0.02), rng.pick([0xe8e8e8, 0x6a8ac8, 0xd86a6a, 0xe8d06a]), x, y - 0.3, z));
        }
      }
    }
  }

  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (signs.length) {
    // The facade walls' material settings (vertex colours and four maps), so the same program;
    // the signs glow a little by day and brightly at night.
    const atlas = glyphAtlas();
    const surface = new THREE.DataTexture(new Uint8Array([0, 150, 0, 255]), 1, 1);
    surface.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.25 + ctx.lampGlow * 1.1,
      roughnessMap: surface, metalnessMap: surface, roughness: 1, metalness: 1,
    });
    scene.add(new THREE.Mesh(mergeGeometries(signs), material));
  }
  if (ducks.length) {
    const mesh = new THREE.InstancedMesh(duckGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 }), ducks.length);
    ducks.forEach((m, i) => mesh.setMatrixAt(i, m));
    scene.add(mesh);
  }
}
