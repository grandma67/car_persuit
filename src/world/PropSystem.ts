import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../render/geometry';
import { SUNK_BELOW } from '../render/Sea';
import { glyphMaterial, glyphPlate } from '../render/districts/glyphs';
import type { Vehicle } from '../vehicles/Vehicle';
import type { CityData } from './CityGenerator';
import { footprintsOverlap, propFootprint, propSpec, type Footprint, type PropKind, type SignVariant, type StreetProp } from './StreetProps';
import type { TreeKind } from './Climate';
import { signalState, type SignalLight } from './TrafficControl';
import { groundBase, groundHeight, groundNormal } from './Terrain';

const GRID_CELL = 10; // metres, spatial hash for vehicle-vs-prop checks
/** Grid cell key: a number, not a "cx,cz" string — looked up for every car every physics step. */
const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
const LAMP_HEAD = new THREE.Vector3(0, 5.8, 1.3); // bulb position in lamp space
const OIL_LAMP_HEAD = new THREE.Vector3(0, 3.75, 0); // the lantern's flame, on top of its post
const DRAGON_LAMP_HEAD = new THREE.Vector3(0, 4.12, 0); // the pagoda lantern's glass
const LAMP_HEADS: Partial<Record<PropKind, THREE.Vector3>> = { lamp: LAMP_HEAD, oilLamp: OIL_LAMP_HEAD, dragonLamp: DRAGON_LAMP_HEAD };
/** Props that light up at night: a bulb (or flame) and a pool of light under it. */
const LIGHTS = new Set<PropKind>(['lamp', 'oilLamp', 'dragonLamp']);
/** A dragon lamp's banner: hung from the brackets on its street side, edge-on to the kerb. */
const BANNER = { w: 0.5, h: 1.05, y: 2.45, z: 0.42 };
const LIGHT_POOL_RADIUS = 7;
const SIGN_FACE_Y = 2.35;
const SIGNAL_HEAD_X = -3.7; // signal arm reaches over the lane along local -X
const SIGNAL_LIGHTS: [SignalLight, number, number, number][] = [
  // light, lens y, lit colour, dark colour
  ['red', 5.2, 0xff2a1a, 0x3a0d0a],
  ['yellow', 4.85, 0xffb000, 0x3a2a05],
  ['green', 4.5, 0x2aff6a, 0x0a3a1a],
];
const UP = new THREE.Vector3(0, 1, 0);
// Thousands of props as permanent physics bodies cost more per step than all the cars together,
// so an intact prop only exists in physics while a vehicle is near it.
const ACTIVE_RADIUS = 22; // metres: give props within this of a vehicle a body…
const INACTIVE_RADIUS = 30; // …and take it away once every vehicle is this far
const NO_BREAKS: readonly PropBreak[] = Object.freeze([]);
const ACTIVE_REFRESH = 0.15; // seconds between refreshes (a 70 m/s car covers ~10 m)

type SignShape = 'octagon' | 'round' | 'triangle' | 'square' | 'diamond';
const SIGN_SHAPE: Record<SignVariant, SignShape> = {
  stop: 'octagon',
  priority: 'diamond',
  speed30: 'round',
  speed50: 'round',
  speed90: 'round',
  noParking: 'round',
  noSmoking: 'round',
  children: 'triangle',
  pedestrian: 'square',
  busStop: 'square',
};
const SIGN_VARIANTS = Object.keys(SIGN_SHAPE) as SignVariant[];
/** Plate geometry per shape. Circle-based so UVs map the square texture straight on. */
const plateGeometry = (shape: SignShape, grow = 0): THREE.BufferGeometry => {
  switch (shape) {
    case 'octagon':
      return new THREE.CircleGeometry(0.5 + grow, 8, Math.PI / 8);
    case 'round':
      return new THREE.CircleGeometry(0.48 + grow, 32);
    case 'triangle':
      return new THREE.CircleGeometry(0.62 + grow, 3, Math.PI / 2); // point up
    case 'square':
      return new THREE.CircleGeometry(0.6 + grow, 4, Math.PI / 4);
    case 'diamond':
      return new THREE.CircleGeometry(0.55 + grow, 4); // point up
  }
};

type PlainKind = Exclude<PropKind, 'sign' | 'tree'>;
type ModelKey = PlainKind | `sign-${SignShape}` | 'signal-right' | `tree-${TreeKind}` | `sign-${SignShape}-old` | 'signal-old' | 'signal-right-old';
const modelKey = (p: StreetProp): ModelKey => {
  const key: ModelKey =
    p.kind === 'sign' ? `sign-${SIGN_SHAPE[p.variant ?? 'stop']}` : p.kind === 'tree' ? `tree-${p.tree ?? 'round'}` : p.kind === 'signal' && p.armRight ? 'signal-right' : p.kind;
  return p.style === 'old' && (p.kind === 'sign' || p.kind === 'signal') ? (`${key}-old` as ModelKey) : key;
};
/** Props tinted per instance (umbrella canopies, tree shades, stall awnings, van paint). */
const TINTED = new Set<PropKind>(['tree', 'umbrella', 'stall', 'produceStall', 'parkedVan']);

/** Colours for the greenery: the city style's leaves and bark, and whether it's snowed. */
export interface Greenery {
  leaves: number;
  trunk: number;
  snowy: boolean;
}
const DEFAULT_GREENERY: Greenery = { leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: false };

export interface PropBreak {
  kind: PropKind;
  tree?: TreeKind; // trees: which kind (cacti don't sound like wood)
  position: THREE.Vector3;
  strength: number; // 0..1 from impact speed
}

/** A part drawn by another instanced mesh that rides along with the prop (bulb, sign face, lens). */
interface Attachment {
  mesh: THREE.InstancedMesh;
  index: number;
  local: THREE.Matrix4;
}

interface PropState {
  def: StreetProp;
  y: number; // ground under it
  body: RAPIER.RigidBody | null; // null while no vehicle is near
  broken: boolean;
  /** Debris at rest whose body was taken away (no vehicle near): where it lies. null: sunk, gone. */
  rest?: { t: RAPIER.Vector; r: RAPIER.Rotation } | null;
  key: ModelKey;
  instance: number; // index within its model's instanced mesh
  attachments: Attachment[];
  pool?: number; // lamp bulb (or lantern flame) + light-pool instance (the pool stays on the ground)
  lenses?: number; // first signal-lens instance (3 consecutive)
}

// --- Low-poly prop models. Local space: origin on the ground, +Z is the front. ---

/** Low-poly trees. */
function treeModels(look: Greenery): Record<`tree-${TreeKind}`, THREE.BufferGeometry> {
  const cyl = (top: number, bottom: number, h: number, seg: number) => new THREE.CylinderGeometry(top, bottom, h, seg);
  const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 7);
  const SNOW = 0xeef2f6;
  const pineGreen = look.snowy ? 0x3a5e48 : 0x2a4f36;
  const fronds = Array.from({ length: 7 }, (_, k) =>
    part(new THREE.BoxGeometry(0.7, 0.06, 3.2).translate(0, 0, 1.6).rotateX(0.45).rotateY((k / 7) * Math.PI * 2), 0x4f8a3a, 0, 6.4),
  );
  const cactus = 0x4f7a3a;
  return {
    'tree-round': mergeGeometries([
      part(cyl(0.25, 0.35, 3, 5), look.trunk, 0, 1.5),
      part(new THREE.IcosahedronGeometry(1.8, 0), look.leaves, 0, 4.2),
    ]),
    'tree-pine': mergeGeometries([
      part(cyl(0.2, 0.3, 2, 5), look.trunk, 0, 1),
      part(cone(2.2, 3.6), pineGreen, 0, 3.3),
      part(cone(1.6, 2.8), pineGreen, 0, 5.1),
      ...(look.snowy ? [part(cone(1.08, 1.85), SNOW, 0, 5.65)] : []), // snow cap over the top tier
    ]),
    'tree-palm': mergeGeometries([part(cyl(0.16, 0.26, 6.5, 6), 0x8a6a48, 0, 3.25), ...fronds]),
    'tree-cactus': mergeGeometries([
      part(cyl(0.38, 0.42, 3.4, 7), cactus, 0, 1.7),
      part(cyl(0.22, 0.22, 0.9, 7).rotateZ(Math.PI / 2), cactus, 0.75, 1.5),
      part(cyl(0.22, 0.22, 1.3, 7), cactus, 1.15, 2.05),
      part(cyl(0.2, 0.2, 0.7, 7).rotateZ(Math.PI / 2), cactus, -0.65, 2.2),
      part(cyl(0.2, 0.2, 1.0, 7), cactus, -0.95, 2.6),
    ]),
  };
}

function buildModels(look: Greenery): Record<ModelKey, THREE.BufferGeometry> {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg);
  const metal = 0x3a3f47;
  const wood = 0x8a5a33;
  const iron = 0x2a2d33;
  const red = 0xc8202a;
  const white = 0xe8e4da;
  const signPost = 0x9aa0a8;
  const signBack = 0x8a9098;

  const lamp = mergeGeometries([
    part(cyl(0.18, 0.4), metal, 0, 0.2),
    part(cyl(0.08, 6), metal, 0, 3),
    part(box(0.07, 0.07, 1.4), metal, 0, 5.95, 0.65),
    part(box(0.45, 0.12, 0.32), metal, 0, 5.9, 1.3),
  ]);
  const hydrant = mergeGeometries([
    part(cyl(0.22, 0.08), 0x8f1820, 0, 0.04),
    part(cyl(0.16, 0.55), red, 0, 0.32),
    part(cyl(0.2, 0.07), 0x8f1820, 0, 0.62),
    part(new THREE.SphereGeometry(0.14, 6, 4), red, 0, 0.66),
    part(box(0.5, 0.1, 0.1), 0x9aa0a8, 0, 0.42),
  ]);
  const bench = mergeGeometries([
    ...[-0.17, 0, 0.17].map((z) => part(box(1.8, 0.05, 0.14), wood, 0, 0.45, z)),
    ...[0.62, 0.82].map((y) => part(box(1.8, 0.12, 0.05), wood, 0, y, -0.27)),
    ...[-0.8, 0.8].flatMap((x) => [part(box(0.06, 0.45, 0.5), iron, x, 0.22), part(box(0.06, 0.55, 0.05), iron, x, 0.7, -0.27)]),
  ]);
  const fence = mergeGeometries([
    ...[-1.35, 1.35].map((x) => part(box(0.1, 1.0, 0.1), white, x, 0.5)),
    ...[0.35, 0.75].map((y) => part(box(2.8, 0.07, 0.04), white, 0, y)),
    ...[-0.95, -0.48, 0, 0.48, 0.95].map((x) => part(box(0.12, 0.88, 0.03), white, x, 0.44, 0.03)),
  ]);
  // Sign post with a plain metal back plate; the printed face is a separate textured attachment.
  const sign = (shape: SignShape) =>
    mergeGeometries([
      part(cyl(0.045, SIGN_FACE_Y + 0.2), signPost, 0, (SIGN_FACE_Y + 0.2) / 2),
      part(plateGeometry(shape, 0.02).rotateY(Math.PI), signBack, 0, SIGN_FACE_Y, 0.05),
    ]);
  // Signal: pole, arm over the lane, housing hanging at the arm's end. `side` -1 reaches to the
  // driver's left (pole on the right kerb), +1 to the right (left-hand traffic).
  const signalModel = (side: number) => {
    const headX = side * -SIGNAL_HEAD_X;
    return mergeGeometries([
      part(cyl(0.2, 0.3), iron, 0, 0.15),
      part(cyl(0.1, 5.6), iron, 0, 2.8),
      part(box(3.9, 0.12, 0.12), iron, headX / 2, 5.45),
      part(box(0.42, 1.15, 0.3), 0x1d2024, headX, 4.85),
      part(box(0.52, 1.25, 0.04), 0x111316, headX, 4.85, -0.16), // backboard
    ]);
  };
  const signal = signalModel(-1);
  // Traffic cone: black base, orange body, reflective white band.
  const cone = mergeGeometries([
    part(box(0.5, 0.05, 0.5), 0x1a1a1a, 0, 0.025),
    part(new THREE.CylinderGeometry(0.035, 0.2, 0.7, 10), 0xff5a10, 0, 0.4),
    part(new THREE.CylinderGeometry(0.1, 0.13, 0.14, 10), 0xf4f4f0, 0, 0.42),
  ]);
  // Beach umbrella: the canopy is tinted per instance (white here, so the tint shows true).
  const umbrella = mergeGeometries([
    part(cyl(0.05, 2.6, 5), 0xe8e4dc, 0, 1.3),
    part(new THREE.ConeGeometry(1.7, 0.7, 8), 0xffffff, 0, 2.55),
  ]);
  // Old-style junction controls (a district's `style: 'old'`): black iron posts with a moulded
  // foot and a ball finial; same faces, heads and lenses.
  const oldSign = (shape: SignShape) =>
    mergeGeometries([
      part(cyl(0.16, 0.35, 6), iron, 0, 0.17),
      part(cyl(0.06, SIGN_FACE_Y + 0.35), iron, 0, (SIGN_FACE_Y + 0.35) / 2),
      part(new THREE.SphereGeometry(0.1, 6, 4), OLD_GOLD, 0, SIGN_FACE_Y + 0.45),
      part(plateGeometry(shape, 0.02).rotateY(Math.PI), iron, 0, SIGN_FACE_Y, 0.05),
    ]);
  const oldSignal = (side: number) => {
    const headX = side * -SIGNAL_HEAD_X;
    return mergeGeometries([
      part(cyl(0.3, 0.5, 8), iron, 0, 0.25),
      part(cyl(0.2, 0.25, 8), iron, 0, 0.6),
      part(cyl(0.11, 5.6, 8), iron, 0, 2.8),
      part(new THREE.SphereGeometry(0.16, 6, 4), OLD_GOLD, 0, 5.75),
      part(box(3.9, 0.1, 0.1), iron, headX / 2, 5.45),
      part(new THREE.TorusGeometry(0.5, 0.04, 4, 10, Math.PI / 2).rotateZ(side < 0 ? Math.PI / 2 : 0), iron, side * -0.5, 4.95), // scroll bracket
      part(box(0.42, 1.15, 0.3), 0x1f2a22, headX, 4.85),
      part(box(0.52, 1.25, 0.04), 0x141a16, headX, 4.85, -0.16),
    ]);
  };
  return {
    ...treeModels(look),
    umbrella,
    lamp, hydrant, bench, fence, signal, 'signal-right': signalModel(1), cone,
    'sign-octagon': sign('octagon'), 'sign-round': sign('round'), 'sign-triangle': sign('triangle'), 'sign-square': sign('square'), 'sign-diamond': sign('diamond'),
    'signal-old': oldSignal(-1), 'signal-right-old': oldSignal(1),
    'sign-octagon-old': oldSign('octagon'), 'sign-round-old': oldSign('round'), 'sign-triangle-old': oldSign('triangle'), 'sign-square-old': oldSign('square'), 'sign-diamond-old': oldSign('diamond'),
    ...oldCityModels(),
    ...chinatownModels(),
  };
}

const OLD_GOLD = 0xb8923a;

/** The Old City's breakables: market and kerb clutter, and the oil lamp. */
function oldCityModels(): Record<'amphora' | 'pot' | 'cart' | 'stall' | 'barrels' | 'cannonballs' | 'pillory' | 'haybale' | 'signpost' | 'oilLamp', THREE.BufferGeometry> {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const oak = 0x7a5432;
  const oakDark = 0x553a22;
  const clay = 0xb8643a;
  const iron = 0x2a2d33;
  const straw = 0xd9b45a;
  // A turned profile (lathe) for pottery: radius at each height.
  const lathe = (pts: [number, number][], color: number) => part(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 8), color);
  const amphora = mergeGeometries([
    lathe([[0.01, 0], [0.08, 0.02], [0.2, 0.25], [0.24, 0.5], [0.2, 0.7], [0.08, 0.8], [0.07, 0.92], [0.1, 0.95]], clay),
    ...[-1, 1].map((k) => part(new THREE.TorusGeometry(0.1, 0.025, 4, 6, Math.PI).rotateY(Math.PI / 2), clay, 0, 0.78, k * 0.1)),
  ]);
  const pot = mergeGeometries([
    lathe([[0.01, 0], [0.2, 0.02], [0.3, 0.3], [0.28, 0.5], [0.3, 0.58], [0.26, 0.6]], clay),
    part(new THREE.SphereGeometry(0.3, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x4f7a3a, 0, 0.55), // a shrub
  ]);
  const cart = mergeGeometries([
    part(box(1.3, 0.1, 2.0), oak, 0, 0.75, 0.2),
    ...[-0.62, 0.62].map((x) => part(box(0.06, 0.45, 2.0), oakDark, x, 1.0, 0.2)),
    part(box(1.3, 0.45, 0.06), oakDark, 0, 1.0, 1.18),
    ...[-0.75, 0.75].map((x) => part(cyl(0.55, 0.55, 0.08, 10).rotateZ(Math.PI / 2), oakDark, x, 0.55, 0.1)),
    ...[-0.35, 0.35].map((x) => part(box(0.07, 0.07, 1.6), oak, x, 0.6, -1.4)), // shafts
    part(box(1.0, 0.35, 1.2), straw, 0, 0.98, 0.3), // a load of hay
  ]);
  // Market stall: trestle counter under an awning (tinted per instance; drawn white here).
  const stall = mergeGeometries([
    ...[-1.2, 1.2].flatMap((x) => [-0.8, 0.8].map((z) => part(box(0.09, 2.5, 0.09), oak, x, 1.25, z))),
    part(box(2.5, 0.08, 1.2), oak, 0, 0.9, 0.2),
    part(box(2.4, 0.8, 0.05), oakDark, 0, 0.5, 0.78),
    part(box(2.7, 0.06, 2.0).rotateX(-0.18), 0xffffff, 0, 2.55),
    part(box(2.7, 0.3, 0.03), 0xffffff, 0, 2.3, 1.02),
    ...[-0.8, -0.25, 0.3, 0.85].map((x, k) => part(box(0.4, 0.25, 0.35), [0xd04a2a, 0xe8b23a, 0x6f9a3a, 0xa83a5a][k], x, 1.07, 0.3)),
  ]);
  const barrel = (x: number, z: number) => [
    part(cyl(0.3, 0.3, 0.9, 10), oak, x, 0.45, z),
    part(cyl(0.34, 0.34, 0.12, 10), oakDark, x, 0.45, z),
    ...[0.12, 0.78].map((y) => part(cyl(0.31, 0.31, 0.05, 10), iron, x, y, z)),
  ];
  const barrels = mergeGeometries([...barrel(-0.3, -0.25), ...barrel(0.32, -0.2), ...barrel(0, 0.32)]);
  const balls: THREE.BufferGeometry[] = [part(box(0.9, 0.08, 0.9), oakDark, 0, 0.04)];
  for (const [x, y, z] of [[-0.2, 0.2, -0.2], [0.2, 0.2, -0.2], [-0.2, 0.2, 0.2], [0.2, 0.2, 0.2], [0, 0.48, 0]]) {
    balls.push(part(new THREE.SphereGeometry(0.2, 7, 5), iron, x, y, z));
  }
  const cannonballs = mergeGeometries(balls);
  const pillory = mergeGeometries([
    part(box(1.8, 0.15, 0.7), oakDark, 0, 0.07),
    part(box(0.18, 2.1, 0.18), oak, 0, 1.05),
    part(box(1.4, 0.35, 0.16), oak, 0, 1.75),
    ...[-0.4, 0, 0.4].map((x) => part(cyl(0.06, 0.06, 0.18).rotateX(Math.PI / 2), 0x1a1a1a, x, 1.75)),
  ]);
  const haybale = mergeGeometries([
    part(box(1.15, 1.0, 1.15), straw, 0, 0.5),
    ...[-0.3, 0.3].map((x) => part(box(0.04, 1.02, 1.17), 0xa8823a, x, 0.5)),
  ]);
  const signpost = mergeGeometries([
    part(box(0.16, 2.8, 0.16), oak, 0, 1.4),
    part(box(1.1, 0.24, 0.05).translate(0.45, 0, 0), 0xe8dcc0, 0, 2.45, 0.1),
    part(box(1.0, 0.22, 0.05).translate(-0.4, 0, 0).rotateY(0.6), 0xe8dcc0, 0, 2.1, 0.1),
    part(box(0.9, 0.22, 0.05).translate(0.38, 0, 0).rotateY(-1.9), 0xe8dcc0, 0, 1.78, 0.1),
  ]);
  const oilLamp = mergeGeometries([
    part(cyl(0.2, 0.28, 0.5), iron, 0, 0.25),
    part(cyl(0.07, 0.09, 3.3, 6), iron, 0, 2.1),
    part(box(0.36, 0.08, 0.36), iron, 0, 3.55),
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => part(box(0.03, 0.45, 0.03), iron, a * 0.16, 3.8, b * 0.16))),
    part(cyl(0, 0.3, 0.3, 4).rotateY(Math.PI / 4), iron, 0, 4.17),
    part(new THREE.SphereGeometry(0.05, 4, 3), iron, 0, 4.35),
  ]);
  return { amphora, pot, cart, stall, barrels, cannonballs, pillory, haybale, signpost, oilLamp };
}

/** Chinatown's street furniture. */
type ChinatownKind = 'dragonLamp' | 'produceStall' | 'lanternStand' | 'dimSumCart' | 'fishCrate' | 'mahjongTable' | 'menuBoard' | 'firecrackerCrate' | 'parkedVan'
  | 'lionDance' | 'dragonFloat';
function chinatownModels(): Record<ChinatownKind, THREE.BufferGeometry> {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const red = 0xb0221e;
  const gold = 0xd6a637;
  const green = 0x2f6b4a;
  // After San Francisco's 1925 Grant Avenue lamps: a red bamboo-jointed shaft on a lotus base, two
  // gold dragons coiling up to a pagoda-roofed lantern (its glass is the lamp's bulb attachment).
  const dragon = (side: number) => [
    part(new THREE.TorusGeometry(0.3, 0.045, 4, 8, Math.PI * 1.2).rotateY(side < 0 ? Math.PI : 0), gold, side * 0.3, 3.35),
    part(box(0.16, 0.12, 0.2), gold, side * 0.2, 3.62, 0.04), // head, towards the lantern
  ];
  const dragonLamp = mergeGeometries([
    part(cyl(0.34, 0.4, 0.45), red, 0, 0.22),
    part(cyl(0.3, 0.34, 0.12), gold, 0, 0.5),
    part(cyl(0, 0.34, 0.35, 8).rotateX(Math.PI), gold, 0, 0.73), // lotus
    part(cyl(0.09, 0.1, 3.0, 8), red, 0, 2.15),
    ...[1.0, 1.6, 2.2, 2.8].map((y) => part(cyl(0.12, 0.12, 0.06, 8), gold, 0, y)), // bamboo joints
    // Banner brackets on the street side.
    ...[BANNER.y + BANNER.h / 2 + 0.04, BANNER.y - BANNER.h / 2 - 0.04].map((y) => part(box(0.04, 0.04, BANNER.z + 0.05), gold, 0, y, BANNER.z / 2)),
    ...dragon(-1), ...dragon(1),
    part(cyl(0.32, 0.18, 0.18, 6), gold, 0, 3.78), // lantern seat
    ...[0, 1, 2, 3, 4, 5].map((k) => {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      return part(box(0.05, 0.6, 0.05), red, Math.cos(a) * 0.29, 4.12, Math.sin(a) * 0.29);
    }),
    part(cyl(0.12, 0.62, 0.32, 6), green, 0, 4.55), // pagoda roof
    ...[0, 1, 2, 3, 4, 5].map((k) => {
      const a = (k / 6) * Math.PI * 2;
      return part(box(0.07, 0.07, 0.24).rotateX(-0.6).rotateY(-a + Math.PI / 2), gold, Math.cos(a) * 0.62, 4.45, Math.sin(a) * 0.62); // upturned eaves
    }),
    part(cyl(0.05, 0.1, 0.2, 6), red, 0, 4.8),
    part(new THREE.SphereGeometry(0.08, 6, 4), gold, 0, 4.96),
  ]);
  const wood = 0x7a5432;
  const bamboo = 0xc8a868;
  // A fruit and veg stall: a trestle of crates under an awning (tinted per instance; white here).
  const fruit = [0xe8642a, 0xf2c23a, 0x6f9a3a, 0xc8302a, 0xe8a03a];
  const produceStall = mergeGeometries([
    ...[-1.1, 1.1].flatMap((x) => [-0.65, 0.65].map((z) => part(box(0.08, 2.3, 0.08), wood, x, 1.15, z))),
    part(box(2.3, 0.08, 1.3), wood, 0, 0.85, 0),
    ...[-0.8, -0.27, 0.27, 0.8].flatMap((x, k) => [
      part(box(0.5, 0.25, 0.9).rotateX(-0.2), 0x9a7a4a, x, 1.02, 0.05),
      part(box(0.44, 0.12, 0.8).rotateX(-0.2), fruit[k], x, 1.16, 0.05),
    ]),
    part(box(2.5, 0.06, 1.8).rotateX(-0.2), 0xffffff, 0, 2.35, 0.1),
    part(box(2.5, 0.25, 0.03), 0xffffff, 0, 2.12, 1.0),
  ]);
  // Red paper lanterns hung on a bamboo stand.
  const lanternStand = mergeGeometries([
    part(box(0.6, 0.06, 0.6), wood, 0, 0.03),
    part(cyl(0.04, 0.04, 2.1, 5), bamboo, 0, 1.08),
    part(box(0.9, 0.04, 0.04), bamboo, 0, 2.0),
    ...[-0.38, 0.38].flatMap((x) => [
      part(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.85, 1), 0xd62a22, x, 1.7),
      part(cyl(0.08, 0.08, 0.04, 6), gold, x, 1.88),
      part(box(0.03, 0.2, 0.03), 0xe8b02a, x, 1.42),
    ]),
    part(new THREE.SphereGeometry(0.17, 8, 6).scale(1, 0.85, 1), gold, 0, 1.35),
  ]);
  // A steamer cart: a box on wheels with a push bar and a stack of bamboo baskets.
  const dimSumCart = mergeGeometries([
    part(box(0.8, 0.6, 1.3), 0xb8b8b4, 0, 0.6),
    ...[-0.42, 0.42].flatMap((x) => [-0.5, 0.5].map((z) => part(cyl(0.12, 0.12, 0.05, 8).rotateZ(Math.PI / 2), 0x2a2a2a, x, 0.12, z))),
    part(box(0.7, 0.04, 0.04), 0x8a8a88, 0, 1.05, -0.75),
    ...[0, 1, 2, 3].map((k) => part(cyl(0.28, 0.28, 0.14, 10), bamboo, 0, 0.98 + k * 0.15, 0.15)),
    part(cyl(0.29, 0.29, 0.03, 10), 0x9a7a4a, 0, 1.6, 0.15),
  ]);
  // A crate of fish on ice.
  const fishCrate = mergeGeometries([
    part(box(1.0, 0.4, 0.75), 0x3a6aa0, 0, 0.2),
    part(box(0.9, 0.05, 0.65), 0xe8f2f6, 0, 0.42),
    ...[-0.3, 0, 0.3].map((x) => part(box(0.18, 0.08, 0.5).rotateY(x), 0x8a9aa8, x, 0.48)),
  ]);
  // A folding table with a game of mahjong on it and two stools.
  const mahjongTable = mergeGeometries([
    part(box(0.9, 0.05, 0.9), 0x2a6a3a, 0, 0.75),
    ...[-0.38, 0.38].flatMap((x) => [-0.38, 0.38].map((z) => part(box(0.05, 0.73, 0.05), 0x3a3a3a, x, 0.36, z))),
    ...[-0.3, -0.1, 0.1, 0.3].flatMap((x) => [-0.32, 0.32].map((z) => part(box(0.08, 0.05, 0.06), 0xf2ead8, x, 0.8, z))),
    ...[-0.3, 0.3].map((x) => part(box(0.06, 0.05, 0.08), 0xf2ead8, x, 0.8, 0)),
    ...[-0.75, 0.75].map((x) => part(cyl(0.18, 0.18, 0.45, 8), 0xc8302a, x, 0.22)),
  ]);
  // An A-frame menu board.
  const menuBoard = mergeGeometries([
    part(box(0.55, 1.0, 0.04).rotateX(0.18), 0x1e1a18, 0, 0.5, 0.1),
    part(box(0.55, 1.0, 0.04).rotateX(-0.18), 0x1e1a18, 0, 0.5, -0.1),
    part(box(0.45, 0.6, 0.01).rotateX(0.18), 0xe8d8b0, 0, 0.55, 0.13),
    part(box(0.35, 0.1, 0.01).rotateX(0.18), 0xc8302a, 0, 0.88, 0.07),
  ]);
  // A red crate of firecrackers, string-bundles poking out.
  const firecrackerCrate = mergeGeometries([
    part(box(0.75, 0.45, 0.75), 0xc8202a, 0, 0.22),
    part(box(0.6, 0.12, 0.25), gold, 0, 0.3, 0.38),
    ...[-0.22, 0, 0.22].flatMap((x) => [part(cyl(0.05, 0.05, 0.3, 6), 0xd62a22, x, 0.55, -0.1), part(cyl(0.05, 0.05, 0.3, 6), 0xd62a22, x, 0.55, 0.12)]),
  ]);
  // A delivery van: the body tinted per instance (white here), dark glass, wheels.
  const parkedVan = mergeGeometries([
    part(box(1.95, 1.55, 4.9), 0xffffff, 0, 1.25, 0),
    part(box(1.9, 0.5, 0.9).rotateX(-0.5), 0xffffff, 0, 1.95, 2.25),
    part(box(1.8, 0.65, 0.05).rotateX(-0.45), 0x1c2228, 0, 1.75, 2.48),
    ...[-1, 1].map((x) => part(box(0.05, 0.5, 0.9), 0x1c2228, x * 0.985, 1.65, 1.6)),
    part(box(2.0, 0.25, 0.15), 0x2a2a2a, 0, 0.55, 2.47),
    part(box(2.0, 0.25, 0.15), 0x2a2a2a, 0, 0.55, -2.47),
    ...[-0.98, 0.98].flatMap((x) => [-1.7, 1.7].map((z) => part(cyl(0.38, 0.38, 0.25, 12).rotateZ(Math.PI / 2), 0x151515, x, 0.38, z))),
    ...[-0.7, 0.7].map((x) => part(box(0.3, 0.15, 0.04), 0xfff2cc, x, 0.9, 2.47)),
  ]);
  // A lion-dance costume on its stand, facing +Z: a big-eyed head with a horn and a mirror, a
  // red-and-gold fringed body behind it.
  const lionDance = mergeGeometries([
    part(box(0.9, 0.08, 2.2), wood, 0, 0.04),
    ...[-0.25, 0.25].map((x) => part(box(0.06, 0.75, 0.06), wood, x, 0.45, 0.65)),
    part(box(0.95, 0.85, 0.85), red, 0, 1.25, 0.75),
    part(box(1.05, 0.2, 0.3), gold, 0, 1.75, 0.95), // brow
    ...[-0.25, 0.25].flatMap((x) => [part(new THREE.SphereGeometry(0.15, 8, 6), 0xf6f2e8, x, 1.5, 1.2), part(new THREE.SphereGeometry(0.07, 6, 4), 0x141414, x, 1.5, 1.33)]),
    part(box(0.75, 0.22, 0.25), 0xf6f2e8, 0, 0.98, 1.12), // teeth
    part(cyl(0.02, 0.08, 0.35, 6).rotateX(0.4), gold, 0, 1.88, 1.0), // horn
    part(cyl(0.09, 0.09, 0.03, 10).rotateX(Math.PI / 2), 0xd8e0e8, 0, 1.6, 1.19), // mirror
    ...[-0.5, 0.5].map((x) => part(box(0.08, 0.35, 0.6), 0xf6f2e8, x, 1.1, 0.75)), // fur trim
    part(box(0.85, 0.6, 1.3), 0xd8302a, 0, 0.95, -0.35).rotateX(0.05),
    part(box(0.9, 0.12, 1.35), gold, 0, 0.62, -0.35),
    part(box(0.2, 0.25, 0.3), gold, 0, 1.05, -1.05), // tail
  ]);
  // A dragon float: a low wheeled cart along Z with a long green-and-gold dragon coiling over it,
  // head at +Z on poles.
  const scales = 0x2f8a4a;
  const dragonFloat = mergeGeometries([
    part(box(1.6, 0.35, 8.2), 0x6a1a16, 0, 0.45),
    part(box(1.7, 0.08, 8.3), gold, 0, 0.66),
    ...[-0.75, 0.75].flatMap((x) => [-3.2, 0, 3.2].map((z) => part(cyl(0.25, 0.25, 0.15, 10).rotateZ(Math.PI / 2), 0x1e1a18, x, 0.26, z))),
    ...Array.from({ length: 9 }, (_, k) => {
      const z = -3.6 + k * 0.85;
      const y = 1.45 + Math.sin(k * 1.1) * 0.35;
      return mergeGeometries([
        part(cyl(0.03, 0.03, y - 0.7, 5), wood, 0, 0.7 + (y - 0.7) / 2, z),
        part(new THREE.SphereGeometry(0.36, 8, 6).scale(0.9, 0.85, 1.3), k % 2 ? scales : 0x3aa05a, 0, y, z),
        part(box(0.08, 0.22, 0.4), gold, 0, y + 0.36, z), // spine fin
      ]);
    }),
    part(box(0.75, 0.6, 0.9), scales, 0, 1.95, 3.9), // head
    part(box(0.6, 0.2, 0.55), 0xd8302a, 0, 1.68, 4.35), // open jaw
    ...[-0.22, 0.22].map((x) => part(new THREE.SphereGeometry(0.1, 6, 4), 0xf2d23a, x, 2.15, 4.3)),
    ...[-0.25, 0.25].map((x) => part(cyl(0.02, 0.05, 0.5, 5).rotateX(-0.6), gold, x, 2.4, 3.7)), // horns
    part(box(0.6, 0.06, 0.06), 0xf6f2e8, 0, 1.92, 4.38), // whiskers
    part(new THREE.SphereGeometry(0.2, 8, 6), 0xd8302a, 0, 1.0, -4.0), // the pearl at its tail
  ]);
  return { dragonLamp, produceStall, lanternStand, dimSumCart, fishCrate, mahjongTable, menuBoard, firecrackerCrate, parkedVan, lionDance, dragonFloat };
}

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function lightPoolTexture(): THREE.Texture {
  return canvasTexture((g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

// --- Sign artwork, drawn on a 256px canvas matching the plate shapes above. ---

const RED = '#c8102e';
const BLUE = '#1f4fa8';

function regular(g: CanvasRenderingContext2D, c: number, r: number, sides: number, start: number): void {
  g.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = start + (i * Math.PI * 2) / sides;
    g.lineTo(c + Math.cos(a) * r, c - Math.sin(a) * r); // canvas y is down; centre (c, c)
  }
  g.closePath();
}

function text(g: CanvasRenderingContext2D, str: string, x: number, y: number, px: number, color: string): void {
  g.fillStyle = color;
  g.font = `bold ${px}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(str, x, y);
}

/** White disc with a red ring: base of speed and prohibition signs. */
function ringSign(g: CanvasRenderingContext2D, s: number, fill = '#ffffff'): void {
  const c = s / 2;
  g.fillStyle = RED;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, c * 0.78, 0, Math.PI * 2);
  g.fill();
}

/** Red diagonal bar across a ring sign (top-left to bottom-right). */
function prohibit(g: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  const r = c * 0.78;
  g.strokeStyle = RED;
  g.lineWidth = s * 0.1;
  g.beginPath();
  g.moveTo(c - r * 0.72, c - r * 0.72);
  g.lineTo(c + r * 0.72, c + r * 0.72);
  g.stroke();
}

/** Simple running figure: head + thick limbs, scaled around (x, y) = hips. */
function runner(g: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  g.fillStyle = g.strokeStyle = '#111111';
  g.lineWidth = 9 * k;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.arc(x + 6 * k, y - 46 * k, 9 * k, 0, Math.PI * 2);
  g.fill();
  const line = (...pts: number[]) => {
    g.beginPath();
    g.moveTo(x + pts[0] * k, y + pts[1] * k);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(x + pts[i] * k, y + pts[i + 1] * k);
    g.stroke();
  };
  line(4, -32, 0, 0); // torso
  line(3, -26, 18, -16, 26, -24); // front arm
  line(3, -26, -12, -14, -20, -4); // back arm
  line(0, 0, 14, 14, 10, 30); // front leg
  line(0, 0, -12, 12, -24, 18); // back leg
}

function signTexture(variant: SignVariant): THREE.Texture {
  return canvasTexture((g, s) => {
    const c = s / 2;
    switch (variant) {
      case 'stop':
        g.fillStyle = '#ffffff';
        regular(g, c, c, 8, Math.PI / 8);
        g.fill();
        g.fillStyle = RED;
        regular(g, c, c * 0.9, 8, Math.PI / 8);
        g.fill();
        text(g, 'STOP', c, c + 4, s * 0.27, '#ffffff');
        break;
      case 'priority': {
        // Priority road: yellow diamond in a white border, a thin black line between (matching the plate).
        g.fillStyle = '#ffffff';
        regular(g, c, c, 4, Math.PI / 2);
        g.fill();
        g.fillStyle = '#111111';
        regular(g, c, c * 0.62, 4, Math.PI / 2);
        g.fill();
        g.fillStyle = '#f5c400';
        regular(g, c, c * 0.56, 4, Math.PI / 2);
        g.fill();
        break;
      }
      case 'speed30':
      case 'speed50':
      case 'speed90':
        ringSign(g, s);
        text(g, variant.slice(5), c, c + 6, s * 0.42, '#111111');
        break;
      case 'noParking':
        ringSign(g, s, BLUE);
        text(g, 'P', c, c + 6, s * 0.46, '#ffffff');
        prohibit(g, s);
        break;
      case 'noSmoking': {
        ringSign(g, s);
        // Cigarette: filter, paper, glowing tip, with a curl of smoke.
        const y = c + s * 0.06;
        const h = s * 0.09;
        g.fillStyle = '#c98a3a';
        g.fillRect(c - s * 0.28, y, s * 0.12, h);
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#111111';
        g.lineWidth = 3;
        g.fillRect(c - s * 0.16, y, s * 0.38, h);
        g.strokeRect(c - s * 0.28, y, s * 0.5, h);
        g.fillStyle = '#ff6a1a';
        g.fillRect(c + s * 0.22, y, s * 0.05, h);
        g.strokeStyle = '#777777';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(c + s * 0.24, y - 6);
        g.bezierCurveTo(c + s * 0.14, y - s * 0.12, c + s * 0.3, y - s * 0.16, c + s * 0.2, y - s * 0.26);
        g.stroke();
        prohibit(g, s);
        break;
      }
      case 'children': {
        // Warning triangle matching the plate (point up): red border, white inside, two kids.
        const R = c;
        g.fillStyle = RED;
        regular(g, c, R, 3, Math.PI / 2);
        g.fill();
        g.fillStyle = '#ffffff';
        regular(g, c, R * 0.72, 3, Math.PI / 2);
        g.fill();
        runner(g, c - s * 0.09, c + s * 0.16, 1.15);
        runner(g, c + s * 0.11, c + s * 0.2, 0.85);
        break;
      }
      case 'pedestrian': {
        // Blue square (matching the plate), white triangle, walker on a zebra.
        const h = c * Math.SQRT1_2;
        g.fillStyle = '#ffffff';
        g.fillRect(c - h, c - h, h * 2, h * 2);
        g.fillStyle = BLUE;
        g.fillRect(c - h + 5, c - h + 5, h * 2 - 10, h * 2 - 10);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(c, c - h * 0.82);
        g.lineTo(c + h * 0.85, c + h * 0.7);
        g.lineTo(c - h * 0.85, c + h * 0.7);
        g.closePath();
        g.fill();
        g.fillStyle = '#111111';
        for (let i = 0; i < 4; i++) g.fillRect(c - h * 0.55 + i * h * 0.3, c + h * 0.5, h * 0.17, h * 0.12);
        runner(g, c - 4, c + h * 0.32, 0.72);
        break;
      }
      case 'busStop': {
        // Blue square (matching the plate) with a white bus side-on over the word BUS.
        const h = c * Math.SQRT1_2;
        g.fillStyle = '#ffffff';
        g.fillRect(c - h, c - h, h * 2, h * 2);
        g.fillStyle = BLUE;
        g.fillRect(c - h + 5, c - h + 5, h * 2 - 10, h * 2 - 10);
        const w = h * 1.3;
        const top = c - h * 0.62;
        const bh = h * 0.62;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.roundRect(c - w / 2, top, w, bh, 8);
        g.fill();
        g.fillStyle = BLUE;
        for (let i = 0; i < 4; i++) g.fillRect(c - w / 2 + 8 + i * (w - 16) * 0.25, top + 7, (w - 16) * 0.25 - 5, bh * 0.38);
        for (const x of [c - w * 0.28, c + w * 0.28]) {
          g.beginPath();
          g.arc(x, top + bh, h * 0.11, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(x, top + bh, h * 0.06, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = BLUE;
        }
        text(g, 'BUS', c, c + h * 0.55, h * 0.42, '#ffffff');
        break;
      }
    }
  });
}

/** District props: their meshes are only built in a city that has some. */
const DISTRICT_KEYS = new Set<string>(['amphora', 'pot', 'cart', 'stall', 'barrels', 'cannonballs', 'pillory', 'haybale', 'signpost', 'oilLamp', 'dragonLamp',
  'produceStall', 'lanternStand', 'dimSumCart', 'fishCrate', 'mahjongTable', 'menuBoard', 'firecrackerCrate', 'parkedVan', 'lionDance', 'dragonFloat']);

// Street furniture: solid when nudged slowly, knocked loose (becomes a dynamic body) when a vehicle
// arrives fast enough. Detection runs a step ahead of contact so smashing through doesn't feel
// like hitting a wall.
export class PropSystem {
  private props: PropState[] = [];
  private grid = new Map<number, number[]>();
  private meshes = {} as Record<ModelKey, THREE.InstancedMesh>;
  private bulbs: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private lenses: THREE.InstancedMesh;
  private signals: number[] = []; // prop indices of traffic signals
  private moving = new Set<number>(); // broken props whose body is still awake
  private active = new Set<number>(); // intact props that currently have a physics body
  private debris = new Set<number>(); // broken props that currently have a physics body
  private resting = new Set<number>(); // broken props lying still with their body taken away
  private activeTimer = 0;
  private seen = new Set<number>(); // checkVehicle's, reused
  private world: RAPIER.World;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private color = new THREE.Color();

  /** lampGlow: 0 = lamps off (daytime) … 1 = full night glow. extra: trees and umbrellas from the city build. */
  constructor(city: CityData, scene: THREE.Scene, world: RAPIER.World, lampGlow: number, extra: StreetProp[] = [], greenery = DEFAULT_GREENERY) {
    const defs = [...city.streetProps, ...extra];
    const models = buildModels(greenery);
    const counts = {} as Record<ModelKey, number>;
    for (const key of Object.keys(models) as ModelKey[]) counts[key] = 0;
    for (const p of defs) counts[modelKey(p)]++;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
    for (const key of Object.keys(models) as ModelKey[]) {
      // Old-style and district props only exist in cities that have them.
      if (!counts[key] && (key.endsWith('-old') || DISTRICT_KEYS.has(key))) continue;
      const mesh = new THREE.InstancedMesh(models[key], material, Math.max(1, counts[key]));
      mesh.count = counts[key];
      mesh.castShadow = key !== 'fence'; // thousands of fence pickets aren't worth the shadow pass
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[key] = mesh;
      scene.add(mesh);
    }
    const addAttachmentMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      mesh.count = count;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };

    // Lamp bulbs (unlit, so they glow) and soft light pools on the ground beneath them.
    const lamps = counts.lamp + counts.oilLamp + counts.dragonLamp;
    this.bulbs = addAttachmentMesh(new THREE.BoxGeometry(0.38, 0.05, 0.24), new THREE.MeshBasicMaterial({ toneMapped: false }), lamps);
    this.pools = addAttachmentMesh(
      new THREE.PlaneGeometry(LIGHT_POOL_RADIUS * 2, LIGHT_POOL_RADIUS * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: lightPoolTexture(),
        color: 0xffc98a,
        transparent: true,
        opacity: 0.32 * lampGlow,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      lamps,
    );
    this.pools.visible = lampGlow > 0;

    // Sign faces: one textured mesh per sign type.
    const faceCounts = {} as Record<SignVariant, number>;
    for (const v of SIGN_VARIANTS) faceCounts[v] = 0;
    for (const p of defs) if (p.kind === 'sign') faceCounts[p.variant ?? 'stop']++;
    const faceMesh = {} as Record<SignVariant, THREE.InstancedMesh>;
    for (const v of SIGN_VARIANTS) {
      // A touch of self-illumination reads like retroreflective sheeting at night.
      const art = signTexture(v);
      faceMesh[v] = addAttachmentMesh(
        plateGeometry(SIGN_SHAPE[v]),
        new THREE.MeshStandardMaterial({ map: art, roughness: 0.45, emissive: 0xffffff, emissiveMap: art, emissiveIntensity: 0.12 }),
        faceCounts[v],
      );
    }

    // Lucky-character banners on Chinatown's main-street dragon lamps (only built when there are some).
    const bannerCount = (b: 'fu' | 'chun') => defs.filter((p) => p.banner === b).length;
    const bannerMat = defs.some((p) => p.banner) ? glyphMaterial() : null;
    const banners = bannerMat
      ? { fu: addAttachmentMesh(glyphPlate(BANNER.w, BANNER.h, 'fu', 0.02), bannerMat, bannerCount('fu')), chun: addAttachmentMesh(glyphPlate(BANNER.w, BANNER.h, 'chun', 0.02), bannerMat, bannerCount('chun')) }
      : null;
    const nextBanner = { fu: 0, chun: 0 };

    // Signal lenses (unlit so lit ones glow), three per signal head.
    this.lenses = addAttachmentMesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      defs.filter((p) => p.kind === 'signal').length * 3, // every signal model: plain, right-arm, old
    );

    const next = {} as Record<ModelKey, number>;
    for (const key of Object.keys(models) as ModelKey[]) next[key] = 0;
    const nextFace = {} as Record<SignVariant, number>;
    for (const v of SIGN_VARIANTS) nextFace[v] = 0;
    let nextLens = 0;
    let nextLight = 0;
    const warm = new THREE.Color(0xffe2b0).lerp(new THREE.Color(0xc8c8c8), 1 - lampGlow); // unlit by day

    this.world = world;
    defs.forEach((def, i) => {
      const spec = propSpec(def);
      this.q.setFromAxisAngle(UP, def.yaw);
      const key = modelKey(def);
      const y = groundBase(city.terrain, def.x, def.z, Math.max(spec.hx, spec.hz));
      const state: PropState = { def, y, body: null, broken: false, key, instance: next[key]++, attachments: [] };
      this.props.push(state);
      const world4 = new THREE.Matrix4().compose(this.v.set(def.x, y, def.z), this.q, this.scale(def));
      this.meshes[key].setMatrixAt(state.instance, world4);
      if (TINTED.has(def.kind)) this.meshes[key].setColorAt(state.instance, this.color.setHex(def.color ?? 0xffffff));

      const attach = (mesh: THREE.InstancedMesh, index: number, local: THREE.Matrix4, color?: THREE.Color) => {
        state.attachments.push({ mesh, index, local });
        mesh.setMatrixAt(index, world4.clone().multiply(local));
        if (color) mesh.setColorAt(index, color);
      };
      if (LIGHTS.has(def.kind)) {
        const li = (state.pool = nextLight++); // bulb and pool share an index
        const at = LAMP_HEADS[def.kind]!;
        // A lantern's flame is a small upright block, a street lamp's bulb a flat panel, a dragon
        // lamp's glass a block filling its lantern.
        const local = new THREE.Matrix4().makeTranslation(at);
        if (def.kind === 'oilLamp') local.multiply(new THREE.Matrix4().makeScale(0.55, 6, 0.9));
        if (def.kind === 'dragonLamp') local.multiply(new THREE.Matrix4().makeScale(1.1, 11, 1.8));
        attach(this.bulbs, li, local, warm);
        if (def.banner && banners) {
          // Edge-on to the kerb, so it faces along the street.
          attach(banners[def.banner], nextBanner[def.banner]++, new THREE.Matrix4().makeTranslation(0, BANNER.y, BANNER.z).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
        }
        // The pool lies on the ground, tilted to the slope.
        const head = at.clone().applyQuaternion(this.q);
        const px = def.x + head.x;
        const pz = def.z + head.z;
        const n = groundNormal(city.terrain, px, pz);
        const tilt = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(n.x, n.y, n.z));
        this.pools.setMatrixAt(li, new THREE.Matrix4().compose(new THREE.Vector3(px, groundHeight(city.terrain, px, pz) + 0.1, pz), tilt, this.one));
      } else if (def.kind === 'sign') {
        const variant = def.variant ?? 'stop';
        attach(faceMesh[variant], nextFace[variant]++, new THREE.Matrix4().makeTranslation(0, SIGN_FACE_Y, 0.065));
      } else if (def.kind === 'signal') {
        state.lenses = nextLens;
        this.signals.push(i);
        for (const [, y, , dark] of SIGNAL_LIGHTS) {
          attach(this.lenses, nextLens++, new THREE.Matrix4().makeTranslation(def.armRight ? -SIGNAL_HEAD_X : SIGNAL_HEAD_X, y, 0.16), this.color.setHex(dark));
        }
      }

      // Spatial hash over the cells the footprint touches.
      const r = Math.max(spec.hx, spec.hz);
      for (let cx = Math.floor((def.x - r) / GRID_CELL); cx <= Math.floor((def.x + r) / GRID_CELL); cx++) {
        for (let cz = Math.floor((def.z - r) / GRID_CELL); cz <= Math.floor((def.z + r) / GRID_CELL); cz++) {
          const cell = cellKey(cx, cz);
          const list = this.grid.get(cell);
          if (list) list.push(i);
          else this.grid.set(cell, [i]);
        }
      }
    });
    // Parked vans are in physics from the start, wherever the player is (they stand in lanes).
    defs.forEach((d, i) => d.kind === 'parkedVan' && this.activate(i));
  }

  private scale(def: StreetProp): THREE.Vector3 {
    return def.scale ? new THREE.Vector3().setScalar(def.scale) : this.one;
  }

  /** Give a prop its (fixed) physics body. */
  private activate(i: number): RAPIER.RigidBody {
    const p = this.props[i];
    if (p.body) return p.body;
    this.q.setFromAxisAngle(UP, p.def.yaw);
    // A parked van stands in a lane: kinematic, so the civilians' forward sensor (which skips fixed
    // bodies) sees it like a stopped car and they go round it.
    const desc = p.def.kind === 'parkedVan' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
    p.body = this.world.createRigidBody(
      desc
        .setTranslation(p.def.x, p.y, p.def.z)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }),
    );
    this.addCollider(p);
    this.active.add(i);
    return p.body;
  }

  private addCollider(p: PropState): void {
    const spec = propSpec(p.def);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.hx, spec.height / 2, spec.hz).setTranslation(0, spec.height / 2, 0).setMass(spec.mass).setFriction(0.6),
      p.body!,
    );
  }

  /** Visit each prop index in the grid cells within `radius` of a point. */
  private near(x: number, z: number, radius: number, visit: (i: number) => void): void {
    for (let cx = Math.floor((x - radius) / GRID_CELL); cx <= Math.floor((x + radius) / GRID_CELL); cx++) {
      for (let cz = Math.floor((z - radius) / GRID_CELL); cz <= Math.floor((z + radius) / GRID_CELL); cz++) {
        for (const i of this.grid.get(cellKey(cx, cz)) ?? []) visit(i);
      }
    }
  }

  /**
   * Keep physics bodies only on intact props near a vehicle. Call once per frame with the
   * positions of the vehicles that can touch props (refreshes a few times a second).
   */
  updateActive(dt: number, vehicles: THREE.Vector3[]): void {
    this.activeTimer -= dt;
    if (this.activeTimer > 0) return;
    this.activeTimer = ACTIVE_REFRESH;
    const keep = new Set<number>();
    for (const v of vehicles) {
      this.near(v.x, v.z, INACTIVE_RADIUS, (i) => {
        const p = this.props[i];
        const d = Math.hypot(p.def.x - v.x, p.def.z - v.z);
        if (d < INACTIVE_RADIUS) keep.add(i);
        if (d < ACTIVE_RADIUS && !p.broken) this.activate(i);
      });
    }
    for (const i of this.active) {
      const p = this.props[i];
      if (keep.has(i) || p.broken || !p.body || p.def.kind === 'parkedVan') continue;
      this.world.removeRigidBody(p.body);
      p.body = null;
      this.active.delete(i);
    }
    // Debris at rest with nobody near gives its body up too: over a long run hundreds of smashed
    // props would otherwise stay in the physics world for good. Measured from where it lies, which
    // can be well away from where the prop stood.
    const near = (x: number, z: number, r: number) => vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < r);
    for (const i of this.debris) {
      const p = this.props[i];
      if (this.moving.has(i) || !p.body) continue;
      const t = p.body.translation();
      if (near(t.x, t.z, INACTIVE_RADIUS)) continue;
      p.rest = { t, r: p.body.rotation() };
      this.world.removeRigidBody(p.body);
      p.body = null;
      this.debris.delete(i);
      this.resting.add(i);
    }
    for (const i of this.resting) {
      const { t } = this.props[i].rest!;
      if (near(t.x, t.z, ACTIVE_RADIUS)) this.restoreDebris(i);
    }
  }

  /** Put a body back on resting debris a vehicle has come near, asleep where it lay. */
  private restoreDebris(i: number): void {
    const p = this.props[i];
    const { t, r } = p.rest!;
    p.rest = undefined;
    this.resting.delete(i);
    p.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(r).setSleeping(true));
    this.addCollider(p);
    this.debris.add(i);
  }

  /** Debris gone into the water: no body, no mesh, for good. */
  private sink(i: number): void {
    const p = this.props[i];
    if (p.body) this.world.removeRigidBody(p.body);
    p.body = null;
    p.rest = null;
    this.debris.delete(i);
    this.moving.delete(i);
    const touched = new Set<THREE.InstancedMesh>();
    this.m4.makeScale(0, 0, 0);
    this.setMatrix(this.meshes[p.key], p.instance, this.m4, touched);
    for (const a of p.attachments) this.setMatrix(a.mesh, a.index, this.m4, touched);
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  get brokenCount(): number {
    return this.props.filter((p) => p.broken).length;
  }

  /** Run the traffic-light cycle. `time` in seconds. */
  updateSignals(time: number): void {
    let changed = false;
    for (const i of this.signals) {
      const p = this.props[i];
      if (p.broken) continue;
      const lit = signalState(p.def.axis ?? 'x', time + (p.def.phase ?? 0));
      SIGNAL_LIGHTS.forEach(([light, , on, off], k) => {
        const hex = light === lit ? on : off;
        this.lenses.getColorAt(p.lenses! + k, this.color);
        if (this.color.getHex() !== hex) {
          this.lenses.setColorAt(p.lenses! + k, this.color.setHex(hex));
          changed = true;
        }
      });
    }
    if (changed) this.lenses.instanceColor!.needsUpdate = true;
  }

  /**
   * Call after each physics step for each vehicle. Knocks loose any intact prop the vehicle is
   * about to hit fast enough, and takes a little speed off the vehicle.
   */
  checkVehicle(vehicle: Vehicle, dt: number): readonly PropBreak[] {
    const lv = vehicle.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (speed < 2) return NO_BREAKS;

    const fwd = vehicle.forward(this.v);
    const pos = vehicle.position;
    const margin = 0.25 + speed * dt * 1.5; // reach one step ahead
    const he = vehicle.spec.halfExtents;
    const car: Footprint = { x: pos.x, z: pos.z, hx: he.x + margin, hz: he.z + margin, yaw: Math.atan2(fwd.x, fwd.z) };

    // Runs every physics step for every vehicle: no fresh set or array unless something breaks.
    let events: PropBreak[] | null = null;
    const seen = this.seen;
    seen.clear();
    const reach = he.z + margin;
    for (let cx = Math.floor((pos.x - reach) / GRID_CELL); cx <= Math.floor((pos.x + reach) / GRID_CELL); cx++) {
      for (let cz = Math.floor((pos.z - reach) / GRID_CELL); cz <= Math.floor((pos.z + reach) / GRID_CELL); cz++) {
        for (const i of this.grid.get(cellKey(cx, cz)) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const p = this.props[i];
          const spec = propSpec(p.def);
          if (p.broken || speed < spec.breakSpeed || !footprintsOverlap(car, propFootprint(p.def))) continue;
          (events ??= []).push(this.knockLoose(i, vehicle, speed));
        }
      }
    }
    return events ?? NO_BREAKS;
  }

  private knockLoose(i: number, vehicle: Vehicle, speed: number): PropBreak {
    const p = this.props[i];
    const spec = propSpec(p.def);
    p.broken = true;
    const body = this.activate(i);
    this.active.delete(i);
    this.debris.add(i); // debris keeps its body while a vehicle is near
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

    // Thrown ahead of the car, slightly up, tumbling over the axis across the car's path.
    const lv = vehicle.body.linvel();
    const dx = lv.x / speed;
    const dz = lv.z / speed;
    const lift = 1.5 + Math.random() * 2;
    body.setLinvel({ x: lv.x * 1.05 + (Math.random() - 0.5) * 2, y: lift, z: lv.z * 1.05 + (Math.random() - 0.5) * 2 }, true);
    const tall = LIGHTS.has(p.def.kind) || p.def.kind === 'signal' || p.def.kind === 'tree' || p.def.kind === 'umbrella' || p.def.kind === 'signpost';
    const spin = (tall ? 3 : 6) * Math.min(1, speed / 15);
    body.setAngvel({ x: dz * spin, y: (Math.random() - 0.5) * 4, z: -dx * spin }, true);

    const keep = 1 - spec.slowdown;
    vehicle.body.setLinvel({ x: lv.x * keep, y: lv.y, z: lv.z * keep }, true);

    // Lights go out.
    if (LIGHTS.has(p.def.kind)) {
      this.bulbs.setColorAt(p.pool!, this.color.setHex(0x222222));
      this.bulbs.instanceColor!.needsUpdate = true;
      this.pools.setMatrixAt(p.pool!, this.m4.makeScale(0, 0, 0));
      this.pools.instanceMatrix.needsUpdate = true;
    } else if (p.def.kind === 'signal') {
      SIGNAL_LIGHTS.forEach(([, , , off], k) => this.lenses.setColorAt(p.lenses! + k, this.color.setHex(off)));
      this.lenses.instanceColor!.needsUpdate = true;
    }
    this.moving.add(i);

    const t = body.translation();
    const y = p.y + (tall ? 2 : 0.5);
    return { kind: p.def.kind, tree: p.def.tree, position: new THREE.Vector3(t.x, y, t.z), strength: Math.min(1, speed / 30) };
  }

  /**
   * Move one instance and queue just its 16 floats for upload: a prop type can have thousands of
   * instances, and re-sending all of them every frame a piece of debris moves adds up.
   */
  private setMatrix(mesh: THREE.InstancedMesh, index: number, m: THREE.Matrix4, touched: Set<THREE.InstancedMesh>): void {
    mesh.setMatrixAt(index, m);
    mesh.instanceMatrix.addUpdateRange(index * 16, 16);
    touched.add(mesh);
  }

  /** Move debris meshes to their physics bodies. Call once per rendered frame. */
  sync(): void {
    const touched = new Set<THREE.InstancedMesh>();
    for (const i of this.moving) {
      const p = this.props[i];
      if (!p.body) continue;
      const t = p.body.translation();
      const r = p.body.rotation();
      this.q.set(r.x, r.y, r.z, r.w);
      this.m4.compose(this.v.set(t.x, t.y, t.z), this.q, this.scale(p.def));
      this.setMatrix(this.meshes[p.key], p.instance, this.m4, touched);
      for (const a of p.attachments) this.setMatrix(a.mesh, a.index, this.m4.clone().multiply(a.local), touched);
      // Debris at rest no longer needs updating; debris lost in the sea is gone.
      if (t.y < SUNK_BELOW) this.sink(i);
      else if (p.body.isSleeping()) this.moving.delete(i);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }
}
