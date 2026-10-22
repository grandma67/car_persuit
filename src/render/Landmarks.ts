import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from './geometry';
import { deckHeight, rampDeckHulls, rampFrame, rampShape, type Landmark, type RampShape } from '../world/Landmarks';
import { groundBase, groundTop, type Terrain } from '../world/Terrain';
import { TireSmoke } from './TireSmoke';

const STONE = 0xc9c3b6;
const STONE_DARK = 0x9c968a;
const BRONZE = 0x5e7f6e; // weathered patina
const STEEL = 0xb8c0c8;
const WATER = 0x3f8fb8;
const DECK = 0x3a3d44; // polished dark granite
const GOLD = 0xd8a62a;
const WING = 0xb08a52; // polished bronze
const RAMP_SEGMENTS = 16;
const SPRAY_PER_SECOND = 40;
const SPRAY_RANGE = 160; // only spray fountains near the camera

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

function fountain(): THREE.BufferGeometry {
  return mergeGeometries([
    part(cyl(5, 5.2, 0.6, 16), STONE, 0, 0.3),
    part(new THREE.TorusGeometry(4.85, 0.25, 4, 16).rotateX(Math.PI / 2), STONE_DARK, 0, 0.65),
    part(cyl(0.6, 0.75, 2, 8), STONE, 0, 1.0),
    part(cyl(2, 1.2, 0.4, 12), STONE, 0, 2.1),
    part(cyl(0.3, 0.4, 1, 8), STONE, 0, 2.75),
    part(cyl(0.8, 0.4, 0.25, 10), STONE, 0, 3.3),
  ]);
}

function fountainWater(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.CircleGeometry(4.7, 16).rotateX(-Math.PI / 2), WATER, 0, 0.62),
    part(new THREE.CircleGeometry(1.85, 12).rotateX(-Math.PI / 2), WATER, 0, 2.31),
  ]);
}

function statue(): THREE.BufferGeometry {
  // Stone plinth with cornices, bronze figure with a raised arm, facing +Z.
  const figure = [
    part(box(0.26, 1.05, 0.3), BRONZE, -0.17, 2.95),
    part(box(0.26, 1.05, 0.3), BRONZE, 0.17, 2.95),
    part(cyl(0.36, 0.52, 0.9, 6), BRONZE, 0, 3.2), // coat
    part(box(0.72, 0.85, 0.42), BRONZE, 0, 3.95),
    part(new THREE.SphereGeometry(0.22, 6, 4), BRONZE, 0, 4.62),
    part(box(0.18, 0.8, 0.18), BRONZE, -0.46, 3.85), // arm at side
    part(box(0.18, 0.95, 0.18).translate(0, 0.45, 0).rotateZ(-0.5).rotateX(-0.35), BRONZE, 0.42, 4.3), // raised arm
  ];
  return mergeGeometries([
    part(box(2.8, 0.3, 2.8), STONE_DARK, 0, 0.15),
    part(box(2.3, 2.0, 2.3), STONE, 0, 1.3),
    part(box(2.6, 0.25, 2.6), STONE_DARK, 0, 2.35),
    ...figure,
  ]);
}

function obelisk(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(3.2, 0.5, 3.2), STONE_DARK, 0, 0.25),
    part(box(2.3, 1.3, 2.3), STONE, 0, 1.15),
    part(cyl(0.55, 0.95, 12, 4).rotateY(Math.PI / 4), STONE, 0, 7.8),
    part(cyl(0, 0.55, 1.1, 4).rotateY(Math.PI / 4), STONE_DARK, 0, 14.35),
  ]);
}

function sculpture(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(3.6, 0.6, 3.6), STONE_DARK, 0, 0.3),
    part(box(1.0, 1.2, 1.0), STONE, 0, 1.2),
    part(new THREE.TorusGeometry(2, 0.38, 6, 14), STEEL, 0, 3.75),
    part(new THREE.TorusGeometry(1.2, 0.22, 6, 12).rotateY(Math.PI / 2), STEEL, 0, 3.75),
  ]);
}

// --- Old City set pieces ---
const OLD_STONE = 0xb5aa93;
const OLD_STONE_DARK = 0x8a806d;
const IRON = 0x2e2f33;
const OAK = 0x6b4a2c;
const SLATE = 0x4f5560;

/** A cannon on a timber carriage, barrel along +Z. */
function cannon(): THREE.BufferGeometry {
  return mergeGeometries([
    ...[-0.45, 0.45].map((x) => part(box(0.14, 0.55, 2.0), OAK, x, 0.55)), // cheeks
    part(box(1.05, 0.18, 1.7), OAK, 0, 0.35, -0.1),
    ...[-0.6, 0.6].flatMap((x) => [0.55, -0.55].map((z) => part(cyl(0.38, 0.38, 0.1, 10).rotateZ(Math.PI / 2), OAK, x, 0.38, z))),
    part(cyl(0.2, 0.27, 2.5, 10).rotateX(Math.PI / 2), IRON, 0, 0.95, 0.35),
    part(new THREE.SphereGeometry(0.28, 8, 6), IRON, 0, 0.95, -0.95), // cascabel
    part(cyl(0.29, 0.29, 0.12, 10).rotateX(Math.PI / 2), IRON, 0, 0.95, 1.55), // muzzle ring
  ]);
}

/** A broken column on its plinth. */
function column(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(1.6, 0.45, 1.6), OLD_STONE_DARK, 0, 0.22),
    part(cyl(0.48, 0.55, 0.3, 12), OLD_STONE, 0, 0.6),
    part(cyl(0.42, 0.45, 3.1, 12), OLD_STONE, 0, 2.3),
    part(cyl(0.3, 0.42, 0.5, 7).rotateZ(0.25), OLD_STONE, 0.05, 4.05), // broken stub, leaning
    part(cyl(0.42, 0.42, 1.4, 12).rotateZ(Math.PI / 2).rotateY(0.6), OLD_STONE, 1.6, 0.45, 0.7), // fallen drum
  ]);
}

/** A ruined archway standing whole: two piers and a round arch, along X. */
function ruinArch(): THREE.BufferGeometry {
  const stones: THREE.BufferGeometry[] = [];
  for (const x of [-1.9, 1.9]) {
    stones.push(part(box(1.1, 4.2, 1.1), OLD_STONE, x, 2.1));
    stones.push(part(box(1.3, 0.35, 1.3), OLD_STONE_DARK, x, 4.35));
  }
  // A full round arch of voussoirs springing from the pier caps, the keystone standing proud.
  for (let k = 0; k < 9; k++) {
    const a = Math.PI - (k + 0.5) * (Math.PI / 9);
    const key = k === 4;
    const g = box(key ? 0.72 : 0.62, key ? 1.1 : 0.9, key ? 1.1 : 1.0).rotateZ(a - Math.PI / 2);
    const r = key ? 2.0 : 1.9;
    stones.push(part(g, key ? OLD_STONE : k % 2 ? OLD_STONE : OLD_STONE_DARK, Math.cos(a) * r, 4.5 + Math.sin(a) * r));
  }
  return mergeGeometries(stones);
}

/** A stone well: round curb, two posts, a little roof and a windlass. */
function well(): THREE.BufferGeometry {
  return mergeGeometries([
    part(cyl(1.25, 1.35, 0.95, 14), OLD_STONE, 0, 0.47),
    part(new THREE.TorusGeometry(1.15, 0.13, 4, 14).rotateX(Math.PI / 2), OLD_STONE_DARK, 0, 0.98),
    part(cyl(0.98, 0.98, 0.04, 14), 0x23323a, 0, 0.85), // dark water
    ...[-1.05, 1.05].map((x) => part(box(0.18, 2.2, 0.18), OAK, x, 2.0)),
    part(cyl(0.1, 0.1, 2.3, 6).rotateZ(Math.PI / 2), OAK, 0, 2.3),
    part(cyl(0.06, 0.06, 0.6, 4), IRON, 0, 1.9), // rope
    part(box(0.4, 0.4, 0.4), OAK, 0, 1.45),
    part(cyl(0, 1.75, 0.9, 4).rotateY(Math.PI / 4), SLATE, 0, 3.5),
  ]);
}

/** Market cross: an open-sided roofed shelter on a stepped stone base round a cross shaft. */
function marketCross(): THREE.BufferGeometry {
  const parts = [
    part(cyl(3.2, 3.3, 0.35, 8), OLD_STONE_DARK, 0, 0.17),
    part(cyl(2.7, 2.8, 0.35, 8), OLD_STONE, 0, 0.52),
    part(cyl(0.35, 0.4, 4.6, 8), OLD_STONE, 0, 3.0),
    part(box(1.4, 0.3, 0.3), OLD_STONE, 0, 4.9),
    part(box(0.3, 1.2, 0.3), OLD_STONE, 0, 4.9),
  ];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    parts.push(part(box(0.32, 3.4, 0.32), OLD_STONE, Math.cos(a) * 2.35, 2.4, Math.sin(a) * 2.35));
  }
  parts.push(part(cyl(2.85, 2.85, 0.4, 8), OLD_STONE_DARK, 0, 4.25));
  parts.push(part(cyl(0, 3.3, 2.2, 8), SLATE, 0, 5.55));
  parts.push(part(new THREE.SphereGeometry(0.25, 6, 4), 0xc9a23a, 0, 6.75));
  return mergeGeometries(parts);
}

/**
 * A guardian lion on its plinth, facing +Z: sitting up on its haunches, curly-maned, one front paw
 * on a ball. Granite grey, the mane and eyes picked out darker.
 */
function lion(): THREE.BufferGeometry {
  const grey = 0xb7b2a8;
  const dark = 0x7f7a72;
  const curl = (x: number, y: number, z: number, r = 0.13) => part(new THREE.SphereGeometry(r, 5, 4), dark, x, y, z);
  return mergeGeometries([
    part(box(1.1, 0.75, 1.1), STONE_DARK, 0, 0.375), // plinth
    part(box(1.2, 0.12, 1.2), STONE, 0, 0.81),
    part(box(0.7, 0.45, 0.8), grey, 0, 1.1, -0.12), // haunches
    part(box(0.62, 0.65, 0.42), grey, 0, 1.45, 0.08).rotateX(-0.12), // chest
    ...[-0.2, 0.2].map((x) => part(box(0.16, 0.62, 0.18), grey, x, 1.18, 0.28)), // front legs
    part(new THREE.SphereGeometry(0.2, 7, 5), grey, 0.22, 0.98, 0.5), // the ball
    part(box(0.18, 0.1, 0.24), grey, 0.22, 1.21, 0.46), // paw on it
    part(box(0.55, 0.5, 0.5), grey, 0, 1.98, 0.12), // head
    part(box(0.36, 0.2, 0.2), grey, 0, 1.86, 0.43), // muzzle
    ...[-0.13, 0.13].map((x) => part(box(0.08, 0.06, 0.03), 0x2a2622, x, 2.08, 0.38)), // eyes
    // Mane: rows of curls round the head, and a tuft of tail.
    ...[-0.3, -0.1, 0.1, 0.3].flatMap((x) => [curl(x, 2.26, 0.05), curl(x, 1.72, -0.08)]),
    ...[-0.32, 0.32].flatMap((x) => [curl(x, 2.05, 0.02), curl(x, 1.88, 0)]),
    curl(0, 1.25, -0.55, 0.18),
  ]);
}

/** A Chinatown pagoda: octagonal red storeys narrowing upward, each under a flared green roof, on a stone plinth. */
function pagoda(tiers: number, snowy: boolean): THREE.BufferGeometry {
  const red = 0xb0221e;
  const tile = snowy ? 0xeef2f6 : 0x2f7a55;
  const parts = [part(cyl(3.6, 3.9, 0.6, 8), STONE_DARK, 0, 0.3), part(cyl(3.2, 3.3, 0.3, 8), STONE, 0, 0.75)];
  let y = 0.9;
  for (let k = 0; k < tiers; k++) {
    const r = 2.5 - k * (1.6 / tiers);
    const h = k === 0 ? 3 : 2.3;
    parts.push(part(cyl(r, r, h, 8), red, 0, y + h / 2));
    parts.push(part(cyl(r + 0.05, r + 0.05, 0.25, 8), GOLD, 0, y + h - 0.35)); // a gold band under the eaves
    const eave = r + 1.1;
    parts.push(part(cyl(r * 0.55, eave, 0.8, 8), tile, 0, y + h + 0.4));
    parts.push(part(cyl(eave, eave + 0.1, 0.12, 8), 0x205a3e, 0, y + h + 0.02)); // eave edge
    for (let c = 0; c < 8; c++) {
      const a = (c / 8) * Math.PI * 2;
      parts.push(part(box(0.18, 0.18, 0.6).rotateX(-0.7).rotateY(-a + Math.PI / 2), GOLD, Math.cos(a) * (eave + 0.1), y + h + 0.18, Math.sin(a) * (eave + 0.1)));
    }
    y += h + 0.8;
  }
  parts.push(part(cyl(0.08, 0.2, 2.2, 6), GOLD, 0, y + 1.1));
  for (let k = 0; k < 3; k++) parts.push(part(new THREE.SphereGeometry(0.28 - k * 0.06, 8, 5), GOLD, 0, y + 0.5 + k * 0.6));
  return mergeGeometries(parts);
}

/** A bronze incense burner: a three-legged cauldron with handles and a little roof, on a stone step. */
function incense(): THREE.BufferGeometry {
  const bronze = 0x6a5232;
  return mergeGeometries([
    part(box(1.4, 0.3, 1.4), STONE, 0, 0.15),
    ...[0, 1, 2].map((k) => part(cyl(0.07, 0.07, 0.5, 5), bronze, Math.cos((k * 2 * Math.PI) / 3) * 0.4, 0.55, Math.sin((k * 2 * Math.PI) / 3) * 0.4)),
    part(new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bronze, 0, 1.25),
    part(cyl(0.58, 0.58, 0.08, 10), bronze, 0, 1.25),
    ...[-1, 1].map((x) => part(new THREE.TorusGeometry(0.16, 0.04, 4, 8), bronze, x * 0.6, 1.35)),
    ...[-0.25, 0, 0.25].map((x) => part(box(0.02, 0.4, 0.02), 0xc8784a, x, 1.45, 0)), // incense sticks
    part(cyl(0.05, 0.05, 0.9, 5), bronze, 0, 1.75),
    part(cyl(0.05, 0.75, 0.4, 6), 0x2f7a55, 0, 2.25),
  ]);
}

/** A mooring bollard: a squat cast-iron post with a flared cap, painted black with a yellow band. */
function bollard(): THREE.BufferGeometry {
  const iron = 0x22252a;
  return mergeGeometries([
    part(cyl(0.38, 0.4, 0.1, 10), iron, 0, 0.05),
    part(cyl(0.24, 0.28, 0.55, 10), iron, 0, 0.37),
    part(cyl(0.25, 0.25, 0.08, 10), 0xd8b02a, 0, 0.42),
    part(cyl(0.34, 0.24, 0.12, 10), iron, 0, 0.7),
    part(cyl(0.34, 0.34, 0.06, 10), iron, 0, 0.79),
  ]);
}

const SNOW = 0xeef2f6;
/** Snow lying on the Old City pieces in a snowy city. */
const SNOW_CAPS = {
  cannon: () => mergeGeometries([part(box(0.36, 0.08, 2.2), SNOW, 0, 1.2, 0.35), part(box(1.0, 0.06, 1.6), SNOW, 0, 0.47, -0.1)]),
  well: () => part(cyl(0, 1.85, 0.95, 4).rotateY(Math.PI / 4), SNOW, 0, 3.55),
  marketCross: () => part(cyl(0, 3.4, 2.25, 8), SNOW, 0, 5.6),
  column: () => part(cyl(0.44, 0.44, 0.1, 12), SNOW, 0, 3.9),
  lion: () => mergeGeometries([part(box(0.57, 0.06, 0.52), SNOW, 0, 2.26, 0.12), part(box(1.12, 0.05, 1.12), SNOW, 0, 0.89)]),
  bollard: () => part(cyl(0.33, 0.33, 0.05, 10), SNOW, 0, 0.845),
};

/** District pieces (Old City, the lions, bollards) stand straight on the ground, without a paved pad. */
const NO_PAD = new Set(['cannon', 'column', 'ruinArch', 'well', 'marketCross', 'lion', 'incense', 'bollard']);

/**
 * "The Leap": a curved granite kicker with racing-kerb gold edges, solid stone cheeks, and a
 * pair of bronze wings sweeping up from plinths either side of the lip, as if the ramp itself
 * were taking off. Returns the stone/deck geometry and the bronze wings separately.
 */
function rampMonument(s: RampShape): { stone: THREE.BufferGeometry; bronze: THREE.BufferGeometry } {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], hex: number) => {
    const color = new THREE.Color(hex);
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      col.push(color.r, color.g, color.b);
    }
  };
  const w = s.width / 2;
  const kerb = 0.6;
  for (let i = 0; i < RAMP_SEGMENTS; i++) {
    const z0 = s.toe + ((s.lip - s.toe) * i) / RAMP_SEGMENTS;
    const z1 = s.toe + ((s.lip - s.toe) * (i + 1)) / RAMP_SEGMENTS;
    const y0 = deckHeight(s, z0) + 0.06;
    const y1 = deckHeight(s, z1) + 0.06;
    const kerbColor = i % 2 ? GOLD : 0xf0ece2;
    // Deck across the width: kerb, granite, kerb (counter-clockwise from above).
    for (const [xa, xb, hex] of [[-w, -w + kerb, kerbColor], [-w + kerb, w - kerb, DECK], [w - kerb, w, kerbColor]] as const) {
      quad([xa, y0, z0], [xa, y1, z1], [xb, y1, z1], [xb, y0, z0], hex);
    }
    // Side cheeks down to the ground.
    quad([w, 0, z0], [w, y0, z0], [w, y1, z1], [w, 0, z1], STONE);
    quad([-w, 0, z1], [-w, y1, z1], [-w, y0, z0], [-w, 0, z0], STONE);
  }
  // Vertical back face under the lip, with a gold band along its top.
  const top = deckHeight(s, s.lip) + 0.06;
  quad([-w, 0, s.lip], [w, 0, s.lip], [w, top - 0.35, s.lip], [-w, top - 0.35, s.lip], STONE_DARK);
  quad([-w, top - 0.35, s.lip], [w, top - 0.35, s.lip], [w, top, s.lip], [-w, top, s.lip], GOLD);
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deck.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  deck.computeVertexNormals();

  // Plinths either side of the lip, with a gold cap, carrying the wings.
  const plinthX = w + 0.9;
  const plinthH = top + 0.6;
  const plinths = [-1, 1].flatMap((side) => [
    part(box(1.6, plinthH, 3.2), STONE, side * plinthX, plinthH / 2, s.lip - 1.4),
    part(box(1.8, 0.2, 3.4), GOLD, side * plinthX, plinthH + 0.1, s.lip - 1.4),
  ]);
  const stone = mergeGeometries([deck, ...plinths]); // part() already un-indexes

  // Wings: a fan of long feathers per side, raked back and flaring outward and up.
  const feathers = [-1, 1].flatMap((side) =>
    [0, 1, 2, 3, 4, 5].map((k) => {
      const len = 7 - k * 0.8;
      return part(
        box(0.5, 0.1, len)
          .translate(0, 0, -len / 2) // pivot at the feather's root, pointing back (-Z)
          .rotateX(-0.55 - k * 0.17) // fan upward
          .rotateZ(side * (0.35 + k * 0.05)) // flare outward
          .rotateY(side * -0.25),
        WING,
        side * plinthX,
        plinthH + 0.3,
        s.lip - 0.2,
      );
    }),
  );
  return { stone, bronze: mergeGeometries(feathers) };
}

// Builds every landmark (meshes + solid colliders) and runs the fountain spray.
export class Landmarks {
  private spray = new TireSmoke({
    color: 0xe2f2ff, maxAlpha: 0.5, additive: false, growth: 0.5, lift: [3.5, 5], gravity: 9.8, spread: 1.2, life: [0.9, 1.2],
  });
  private spouts: { position: THREE.Vector3; budget: number }[] = [];

  /**
   * lampGlow: 0 by day … 1 at night (fountain water glows a little after dark).
   * Returns collider handles so crash marks treat landmarks like walls.
   */
  constructor(landmarks: Landmark[], terrain: Terrain, scene: THREE.Scene, world: RAPIER.World, lampGlow: number, readonly colliders = new Set<number>(), private snowy = false) {
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, metalness: 0.6 });
    const water = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.2,
      emissive: 0x2a6f99,
      emissiveIntensity: 0.15 + lampGlow * 0.5,
    });
    const paving = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.95 });
    const models = {
      fountain: fountain(), statue: statue(), obelisk: obelisk(), sculpture: sculpture(),
      cannon: cannon(), column: column(), ruinArch: ruinArch(), well: well(), marketCross: marketCross(),
      lion: lion(), incense: incense(), bollard: bollard(),
    };

    const plain = new Map<string, THREE.Matrix4[]>(); // district pieces by kind, drawn instanced
    for (const l of landmarks) {
      if (l.kind === 'ramp') {
        this.addRamp(l, terrain, scene, world, solid, metal);
        continue;
      }
      if (NO_PAD.has(l.kind)) {
        this.addPlain(l, terrain, world, plain);
        continue;
      }
      // A circle of darker paving under the centrepiece; on a slope it's a level terrace, its top
      // flush with the ground uphill.
      const pad = l.radius + 3.5;
      const y = groundTop(terrain, l.x, l.z, pad);
      const step = y - groundBase(terrain, l.x, l.z, pad) + 0.1;
      const group = new THREE.Group();
      group.position.set(l.x, y, l.z);
      group.rotation.y = l.yaw;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(pad, pad, step, 24).translate(0, 0.055 - step / 2, 0), paving);
      base.receiveShadow = true;
      if (step > 0.3) {
        this.colliders.add(world.createCollider(RAPIER.ColliderDesc.cylinder(step / 2, pad).setTranslation(l.x, y + 0.055 - step / 2, l.z)).handle);
      }
      group.add(base);
      const model = l.kind === 'pagoda' ? pagoda(l.tiers ?? 4, this.snowy) : models[l.kind as keyof typeof models];
      const mesh = new THREE.Mesh(model, l.kind === 'statue' || l.kind === 'sculpture' ? metal : solid);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (l.kind === 'fountain') {
        group.add(new THREE.Mesh(fountainWater(), water));
        this.spouts.push({ position: new THREE.Vector3(l.x, y + 3.45, l.z), budget: 0 });
      }
      scene.add(group);

      // Solid footprint: the basin for fountains, the plinth/base otherwise.
      const desc =
        l.kind === 'fountain'
          ? RAPIER.ColliderDesc.cylinder(0.6, l.radius).setTranslation(l.x, y + 0.6, l.z)
          : RAPIER.ColliderDesc.cuboid(l.radius * 0.8, 3, l.radius * 0.8).setTranslation(l.x, y + 3, l.z);
      this.colliders.add(world.createCollider(desc).handle);
    }
    // One instanced mesh per district piece kind (lions, cannons …), snow-capped in a snowy city.
    for (const [kind, matrices] of plain) {
      const model = models[kind as keyof typeof models];
      const cap = this.snowy ? SNOW_CAPS[kind as keyof typeof SNOW_CAPS]?.() : undefined;
      const mesh = new THREE.InstancedMesh(cap ? mergeGeometries([model, cap]) : model, solid, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
    scene.add(this.spray.points);
  }

  /** An Old City piece: on its lowest ground, with a box collider round its footprint. */
  private addPlain(l: Landmark, terrain: Terrain, world: RAPIER.World, plain: Map<string, THREE.Matrix4[]>): void {
    const y = groundBase(terrain, l.x, l.z, l.radius) - 0.05;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw);
    if (!plain.has(l.kind)) plain.set(l.kind, []);
    plain.get(l.kind)!.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x, y, l.z), q, new THREE.Vector3(1, 1, 1)));
    const r = l.radius * 0.8;
    const desc = RAPIER.ColliderDesc.cuboid(r, 2, r).setTranslation(l.x, y + 2, l.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    this.colliders.add(world.createCollider(desc).handle);
  }

  /** The jump monument: drivable curved deck (convex slices), solid plinths. Tilted with the slope. */
  private addRamp(l: Landmark, terrain: Terrain, scene: THREE.Scene, world: RAPIER.World, solid: THREE.Material, metal: THREE.Material): void {
    const s = rampShape(l);
    const { y, quaternion: q } = rampFrame(l, terrain);
    const group = new THREE.Group();
    group.position.set(l.x, y, l.z);
    group.quaternion.copy(q);
    const model = rampMonument(s);
    const stone = new THREE.Mesh(model.stone, solid);
    const wings = new THREE.Mesh(model.bronze, metal);
    for (const m of [stone, wings]) {
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    scene.add(group);
    group.updateMatrixWorld();

    // Deck: one convex slice per segment, from the ground up to the deck surface.
    const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
    for (const pts of rampDeckHulls(s, RAMP_SEGMENTS)) {
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (desc) world.createCollider(desc.setTranslation(l.x, y, l.z).setRotation(rot).setFriction(1));
    }
    const w = s.width / 2;
    // Plinths are solid walls (they take crash marks).
    const plinthH = deckHeight(s, s.lip) + 0.7;
    for (const side of [-1, 1]) {
      const local = new THREE.Vector3(side * (w + 0.9), plinthH / 2, s.lip - 1.4).applyQuaternion(q);
      const desc = RAPIER.ColliderDesc.cuboid(0.8, plinthH / 2, 1.6).setTranslation(l.x + local.x, y + local.y, l.z + local.z).setRotation(rot);
      this.colliders.add(world.createCollider(desc).handle);
    }
  }

  update(dt: number, camera: THREE.Camera, viewportHeight: number, fov: number): void {
    this.spray.resize(viewportHeight, fov);
    for (const s of this.spouts) {
      if (s.position.distanceTo(camera.position) > SPRAY_RANGE) continue;
      s.budget += SPRAY_PER_SECOND * dt;
      while (s.budget >= 1) {
        this.spray.emit(s.position, ZERO, 0);
        s.budget--;
      }
    }
    this.spray.update(dt);
  }
}

const ZERO = new THREE.Vector3();
