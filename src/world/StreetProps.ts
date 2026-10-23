// Breakable street furniture: placement (pure data) and 2D footprint overlap. PropSystem turns
// these into meshes and physics bodies.
import type { Rng } from '../core/Rng';
import type { Block, CityConfig, Rect } from './CityGenerator';
import { inRampLane, type Landmark } from './Landmarks';
import type { TreeKind } from './Climate';

export type PropKind =
  | 'lamp' | 'hydrant' | 'bench' | 'fence' | 'sign' | 'signal' | 'cone' | 'tree' | 'umbrella'
  // Old City
  | 'amphora' | 'pot' | 'cart' | 'stall' | 'barrels' | 'cannonballs' | 'pillory' | 'haybale' | 'signpost' | 'oilLamp'
  // Chinatown
  | 'dragonLamp' | 'produceStall' | 'lanternStand' | 'dimSumCart' | 'fishCrate' | 'mahjongTable' | 'menuBoard' | 'firecrackerCrate' | 'parkedVan'
  | 'lionDance' | 'dragonFloat'
  // Harbor
  | 'pallet' | 'crates' | 'drums' | 'cableReel' | 'lifebuoy' | 'forklift' | 'boomGate' | 'crossbuck'
  // Farm
  | 'mailbox' | 'woodLamp' | 'milkChurn' | 'feedSacks' | 'wheelbarrow' | 'waterTrough' | 'fruitBin' | 'pumpkin' | 'farmStand' | 'scarecrow'
  | 'toolRack' | 'parkedTractor' | 'hayRake' | 'plough' | 'seedDrill' | 'baler' | 'hayWagon' | 'jackOLantern' | 'roundBale'
  // Slums
  | 'rubble';
export type SignVariant = 'stop' | 'priority' | 'speed30' | 'speed50' | 'speed90' | 'noParking' | 'noSmoking' | 'children' | 'pedestrian' | 'busStop';

export interface StreetProp {
  kind: PropKind;
  x: number;
  z: number;
  /** Heading: local +Z (lamp arm, bench front, sign face) points along (sin yaw, cos yaw). Fences run along local X. */
  yaw: number;
  variant?: SignVariant; // signs
  axis?: 'x' | 'z'; // signals: travel axis of the traffic they face
  phase?: number; // signals: junction cycle offset, seconds
  armRight?: boolean; // signals: arm reaches to the driver's right (pole on the left kerb, left-hand traffic)
  tree?: TreeKind; // trees
  scale?: number; // trees: size multiplier
  color?: number; // umbrellas: canopy colour; trees: tint; stalls: awning colour
  style?: 'old' | 'chainlink' | 'rail' | 'pear'; // restyled by a district (old iron posts, chain-link or split-rail fencing): same kind and variant, so the same rules
  banner?: 'fu' | 'chun'; // dragon lamps: a lucky-character banner (福 fortune, 春 spring)
}

export interface PropSpec {
  hx: number; // footprint half-extents (local X, Z), metres
  hz: number;
  height: number;
  mass: number; // kg once knocked loose
  /** Car speed (m/s) needed to knock it loose; slower and it's solid. */
  breakSpeed: number;
  /** Fraction of the car's speed lost when smashing through it. */
  slowdown: number;
}

export const PROP_SPECS: Record<PropKind, PropSpec> = {
  lamp: { hx: 0.15, hz: 0.15, height: 6.2, mass: 120, breakSpeed: 4, slowdown: 0.08 },
  hydrant: { hx: 0.22, hz: 0.22, height: 0.8, mass: 80, breakSpeed: 3, slowdown: 0.1 },
  bench: { hx: 0.9, hz: 0.3, height: 0.9, mass: 40, breakSpeed: 2.5, slowdown: 0.05 },
  fence: { hx: 1.45, hz: 0.06, height: 1.0, mass: 15, breakSpeed: 2, slowdown: 0.03 },
  sign: { hx: 0.08, hz: 0.08, height: 2.6, mass: 20, breakSpeed: 2.5, slowdown: 0.02 },
  signal: { hx: 0.15, hz: 0.15, height: 5.6, mass: 150, breakSpeed: 4, slowdown: 0.09 },
  cone: { hx: 0.25, hz: 0.25, height: 0.75, mass: 4, breakSpeed: 1, slowdown: 0.01 },
  // Trees take a real hit to snap and cost a lot of speed; the footprint is the trunk only.
  tree: { hx: 0.35, hz: 0.35, height: 5, mass: 300, breakSpeed: 7, slowdown: 0.28 },
  umbrella: { hx: 0.12, hz: 0.12, height: 2.6, mass: 6, breakSpeed: 1.5, slowdown: 0.02 },
  // Old City clutter and market.
  amphora: { hx: 0.25, hz: 0.25, height: 0.95, mass: 15, breakSpeed: 1, slowdown: 0.01 },
  pot: { hx: 0.3, hz: 0.3, height: 0.6, mass: 12, breakSpeed: 1, slowdown: 0.01 },
  cart: { hx: 0.8, hz: 1.3, height: 1.2, mass: 120, breakSpeed: 3, slowdown: 0.08 },
  stall: { hx: 1.3, hz: 0.9, height: 2.6, mass: 60, breakSpeed: 2, slowdown: 0.06 },
  barrels: { hx: 0.6, hz: 0.6, height: 1.0, mass: 90, breakSpeed: 2.5, slowdown: 0.06 },
  cannonballs: { hx: 0.45, hz: 0.45, height: 0.6, mass: 300, breakSpeed: 3, slowdown: 0.1 },
  pillory: { hx: 0.9, hz: 0.35, height: 2.2, mass: 50, breakSpeed: 2, slowdown: 0.05 },
  haybale: { hx: 0.6, hz: 0.6, height: 1.2, mass: 60, breakSpeed: 1.5, slowdown: 0.06 },
  signpost: { hx: 0.1, hz: 0.1, height: 2.8, mass: 20, breakSpeed: 2, slowdown: 0.02 },
  oilLamp: { hx: 0.15, hz: 0.15, height: 4.2, mass: 80, breakSpeed: 3, slowdown: 0.06 },
  // Chinatown
  dragonLamp: { hx: 0.2, hz: 0.2, height: 4.9, mass: 110, breakSpeed: 3.5, slowdown: 0.07 },
  produceStall: { hx: 1.2, hz: 0.75, height: 2.4, mass: 70, breakSpeed: 2, slowdown: 0.06 },
  lanternStand: { hx: 0.45, hz: 0.45, height: 2.2, mass: 25, breakSpeed: 1.5, slowdown: 0.03 },
  dimSumCart: { hx: 0.45, hz: 0.75, height: 1.3, mass: 60, breakSpeed: 2, slowdown: 0.05 },
  fishCrate: { hx: 0.5, hz: 0.4, height: 0.55, mass: 25, breakSpeed: 1, slowdown: 0.02 },
  mahjongTable: { hx: 0.55, hz: 0.55, height: 0.8, mass: 30, breakSpeed: 1.5, slowdown: 0.03 },
  menuBoard: { hx: 0.3, hz: 0.25, height: 1.1, mass: 8, breakSpeed: 1, slowdown: 0.01 },
  firecrackerCrate: { hx: 0.4, hz: 0.4, height: 0.6, mass: 15, breakSpeed: 1, slowdown: 0.02 },
  // A delivery van double-parked in the kerb lane: heavy, and it takes a real hit to shove.
  parkedVan: { hx: 1.0, hz: 2.5, height: 2.3, mass: 1600, breakSpeed: 9, slowdown: 0.35 },
  // Lunar New Year (festival nights): a lion-dance costume on its stand and a dragon on a wheeled float.
  lionDance: { hx: 0.6, hz: 1.2, height: 1.9, mass: 30, breakSpeed: 1.5, slowdown: 0.03 },
  dragonFloat: { hx: 0.9, hz: 4.2, height: 2.4, mass: 150, breakSpeed: 2, slowdown: 0.08 },
  // Harbor: dock clutter (drums and cable reels roll once loose), a forklift that takes a real hit,
  // the boom barriers at the yard's corridor mouths (the arm along local X) and level-crossing posts.
  pallet: { hx: 0.6, hz: 0.5, height: 0.9, mass: 60, breakSpeed: 1.5, slowdown: 0.03 },
  crates: { hx: 0.6, hz: 0.6, height: 1.3, mass: 80, breakSpeed: 2, slowdown: 0.05 },
  drums: { hx: 0.3, hz: 0.3, height: 0.9, mass: 40, breakSpeed: 1.2, slowdown: 0.02 },
  cableReel: { hx: 0.5, hz: 0.8, height: 1.6, mass: 150, breakSpeed: 2.5, slowdown: 0.06 },
  lifebuoy: { hx: 0.25, hz: 0.15, height: 1.6, mass: 10, breakSpeed: 1, slowdown: 0.01 },
  forklift: { hx: 0.65, hz: 1.6, height: 2.3, mass: 2500, breakSpeed: 8, slowdown: 0.3 },
  boomGate: { hx: 3.6, hz: 0.15, height: 1.2, mass: 30, breakSpeed: 1.5, slowdown: 0.03 },
  crossbuck: { hx: 0.1, hz: 0.1, height: 3.0, mass: 20, breakSpeed: 2.5, slowdown: 0.02 },
  // Farm
  mailbox: { hx: 0.25, hz: 0.3, height: 1.3, mass: 10, breakSpeed: 1.2, slowdown: 0.01 },
  woodLamp: { hx: 0.16, hz: 0.16, height: 6.2, mass: 90, breakSpeed: 3.5, slowdown: 0.07 },
  milkChurn: { hx: 0.22, hz: 0.22, height: 0.9, mass: 25, breakSpeed: 1.2, slowdown: 0.01 },
  feedSacks: { hx: 0.6, hz: 0.4, height: 0.8, mass: 60, breakSpeed: 1.5, slowdown: 0.03 },
  wheelbarrow: { hx: 0.35, hz: 0.8, height: 0.7, mass: 30, breakSpeed: 1.2, slowdown: 0.02 },
  waterTrough: { hx: 0.5, hz: 1.2, height: 0.7, mass: 150, breakSpeed: 3, slowdown: 0.06 },
  fruitBin: { hx: 0.6, hz: 0.6, height: 0.9, mass: 90, breakSpeed: 2.5, slowdown: 0.05 },
  pumpkin: { hx: 0.32, hz: 0.32, height: 0.5, mass: 12, breakSpeed: 0.8, slowdown: 0.01 },
  farmStand: { hx: 1.4, hz: 0.7, height: 2.4, mass: 70, breakSpeed: 2, slowdown: 0.05 },
  scarecrow: { hx: 0.15, hz: 0.15, height: 2.2, mass: 10, breakSpeed: 1, slowdown: 0.01 },
  toolRack: { hx: 0.9, hz: 0.25, height: 1.8, mass: 30, breakSpeed: 1.5, slowdown: 0.02 },
  // Heavy machinery: it takes a real hit to shove and costs a lot of speed.
  parkedTractor: { hx: 1.15, hz: 1.9, height: 2.8, mass: 3800, breakSpeed: 8, slowdown: 0.32 },
  hayRake: { hx: 1.6, hz: 1.1, height: 1.4, mass: 450, breakSpeed: 5, slowdown: 0.12 },
  plough: { hx: 1.0, hz: 1.6, height: 1.1, mass: 700, breakSpeed: 6, slowdown: 0.15 },
  seedDrill: { hx: 1.6, hz: 0.8, height: 1.4, mass: 800, breakSpeed: 6, slowdown: 0.15 },
  baler: { hx: 1.2, hz: 2.2, height: 2.0, mass: 1600, breakSpeed: 7, slowdown: 0.22 },
  hayWagon: { hx: 1.2, hz: 2.6, height: 2.6, mass: 900, breakSpeed: 6, slowdown: 0.18 },
  jackOLantern: { hx: 0.3, hz: 0.3, height: 0.5, mass: 10, breakSpeed: 0.8, slowdown: 0.01 },
  // A round bale on its side (axle along local X): heavy, but a solid shove sets it rolling.
  roundBale: { hx: 0.75, hz: 0.8, height: 1.6, mass: 350, breakSpeed: 3, slowdown: 0.1 },
  // Slums: a pile of loose bricks off a ruin's heap.
  rubble: { hx: 0.45, hz: 0.4, height: 0.5, mass: 80, breakSpeed: 1.2, slowdown: 0.03 },
};

/** Per tree kind: trunk half-width at scale 1, how tall the collider is, and how sturdy. */
const TREE_SPECS: Record<TreeKind, Partial<PropSpec>> = {
  round: { hx: 0.35, hz: 0.35, height: 5 },
  pine: { hx: 0.3, hz: 0.3, height: 5.5 },
  palm: { hx: 0.26, hz: 0.26, height: 6.5, mass: 200, breakSpeed: 6, slowdown: 0.2 },
  cactus: { hx: 0.42, hz: 0.42, height: 3.4, mass: 150, breakSpeed: 3, slowdown: 0.1 },
  fruit: { hx: 0.3, hz: 0.3, height: 4, mass: 180, breakSpeed: 5, slowdown: 0.18 },
};

/** The spec for this particular prop: trees vary by kind and size. */
export function propSpec(p: StreetProp): PropSpec {
  const base = PROP_SPECS[p.kind];
  if (p.kind !== 'tree') return base;
  const s = p.scale ?? 1;
  const t = { ...base, ...TREE_SPECS[p.tree ?? 'round'] };
  return { ...t, hx: t.hx * s, hz: t.hz * s, height: t.height * s, mass: t.mass * s * s };
}

/** Oriented rectangle on the ground plane. */
export interface Footprint {
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
}

export function propFootprint(p: StreetProp, margin = 0): Footprint {
  const s = propSpec(p);
  return { x: p.x, z: p.z, hx: s.hx + margin, hz: s.hz + margin, yaw: p.yaw };
}

/** Separating-axis test for two oriented rectangles. */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  // Far apart (beyond both bounding circles): no need for the axes. Same answer, much cheaper.
  const reach = Math.hypot(a.hx, a.hz) + Math.hypot(b.hx, b.hz);
  if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 > reach * reach) return false;
  const axes = (f: Footprint) => {
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    return [
      [c, -s], // local X in world
      [s, c], // local Z in world
    ];
  };
  const [ax, az] = axes(a);
  const [bx, bz] = axes(b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [nx, nz] of [ax, az, bx, bz]) {
    const dist = Math.abs(dx * nx + dz * nz);
    const ra = a.hx * Math.abs(ax[0] * nx + ax[1] * nz) + a.hz * Math.abs(az[0] * nx + az[1] * nz);
    const rb = b.hx * Math.abs(bx[0] * nx + bx[1] * nz) + b.hz * Math.abs(bz[0] * nx + bz[1] * nz);
    if (dist > ra + rb) return false;
  }
  return true;
}

/** Footprints bucketed on a grid, for "does this overlap any of them?" over many (same answers as a scan). */
export class FootprintIndex {
  private cells = new Map<number, Footprint[]>();
  constructor(items: Footprint[] = [], private size = 8) {
    for (const f of items) this.add(f);
  }

  private each(f: Footprint, fn: (key: number) => boolean | void): boolean {
    const r = Math.hypot(f.hx, f.hz);
    const i0 = Math.floor((f.x - r) / this.size), i1 = Math.floor((f.x + r) / this.size);
    const j0 = Math.floor((f.z - r) / this.size), j1 = Math.floor((f.z + r) / this.size);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (fn((i + 4096) * 8192 + (j + 4096))) return true;
    return false;
  }

  add(f: Footprint): void {
    this.each(f, (k) => {
      const list = this.cells.get(k);
      if (list) list.push(f);
      else this.cells.set(k, [f]);
    });
  }

  /** Does `f` overlap anything added? */
  hits(f: Footprint): boolean {
    return this.each(f, (k) => this.cells.get(k)?.some((o) => footprintsOverlap(f, o)) ?? false);
  }
}

export function rectFootprint(r: Rect): Footprint {
  return { x: r.x, z: r.z, hx: r.w / 2, hz: r.d / 2, yaw: 0 };
}

const LAMP_INSET = 0.7; // from the kerb
const HYDRANT_INSET = 0.6;
const BENCH_INSET = 2.4;
const FENCE_INSET = 3.3; // just inside the sidewalk, on the lot/grass side
const FENCE_LENGTH = 3;

const yawFacing = (nx: number, nz: number) => Math.atan2(nx, nz);
/** Yaw that lays a fence's local X along the tangent (tx, tz). */
const yawAlong = (tx: number, tz: number) => Math.atan2(-tz, tx);

interface Side {
  nx: number; // outward normal (toward the road)
  nz: number;
  tx: number; // tangent along the kerb
  tz: number;
}

const SIDES: Side[] = [
  { nx: 1, nz: 0, tx: 0, tz: 1 },
  { nx: -1, nz: 0, tx: 0, tz: 1 },
  { nx: 0, nz: 1, tx: 1, tz: 0 },
  { nx: 0, nz: -1, tx: 1, tz: 0 },
];

/** Place street furniture for a generated city. */
export function generateStreetProps(
  blocks: Block[],
  plazas: Rect[],
  landmarks: Landmark[],
  config: CityConfig,
  size: number,
  rng: Rng,
): StreetProp[] {
  const props: StreetProp[] = [];
  const half = config.blockSize / 2;
  const at = (b: Block, side: Side, inset: number, t: number) => ({
    x: b.rect.x + side.nx * (half - inset) + side.tx * t,
    z: b.rect.z + side.nz * (half - inset) + side.tz * t,
  });

  for (const block of blocks) {
    for (const side of SIDES) {
      // Lamps on every block side, arm reaching over the road.
      for (const t of [-18, 18]) props.push({ kind: 'lamp', ...at(block, side, LAMP_INSET, t), yaw: yawFacing(side.nx, side.nz) });

      if (rng.next() < 0.35) {
        const t = (rng.next() < 0.5 ? -1 : 1) * (half - 6);
        props.push({ kind: 'hydrant', ...at(block, side, HYDRANT_INSET, t), yaw: rng.range(0, Math.PI * 2) });
      }

      if (!block.park && (block.zone === 'downtown' || block.zone === 'midtown') && rng.next() < 0.4) {
        props.push({ kind: 'bench', ...at(block, side, BENCH_INSET, rng.range(-5, 5)), yaw: yawFacing(side.nx, side.nz) });
      }

      // Picket fences: around parks (entrance gap mid-side) and along some residential blocks.
      const fenced = block.park || (block.zone === 'residential' && rng.next() < 0.6);
      if (fenced) {
        const length = config.blockSize - FENCE_INSET * 2;
        const count = Math.floor(length / FENCE_LENGTH);
        for (let k = 0; k < count; k++) {
          const t = -length / 2 + FENCE_LENGTH * (k + 0.5) + (length - count * FENCE_LENGTH) / 2;
          if (block.park ? Math.abs(t) < 4 : rng.next() < 0.15) continue; // entrance / driveway
          props.push({ kind: 'fence', ...at(block, side, FENCE_INSET, t), yaw: yawAlong(side.tx, side.tz) });
        }
      }
    }

    // A few park benches inside the grass, clear of the fence and of any centrepiece.
    if (block.park) {
      const inner = half - FENCE_INSET - 5;
      for (let k = rng.int(2, 3); k > 0; k--) {
        const x = block.rect.x + rng.range(-inner, inner);
        const z = block.rect.z + rng.range(-inner, inner);
        if (landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + 3)) continue;
        props.push({ kind: 'bench', x, z, yaw: rng.range(0, Math.PI * 2) });
      }
    }
  }

  // Town squares: a ring of benches facing the centrepiece.
  for (const l of landmarks) {
    if (!blocks.some((b) => b.square && b.rect.x === l.x && b.rect.z === l.z)) continue;
    const r = l.radius + 4.5;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const x = l.x + Math.cos(a) * r;
      const z = l.z + Math.sin(a) * r;
      if (l.kind === 'ramp' && inRampLane(l, { x, z })) continue;
      props.push({ kind: 'bench', x, z, yaw: Math.atan2(l.x - x, l.z - z) });
    }
  }

  // Plazas: benches near each end, along the plaza.
  for (const p of plazas) {
    const alongX = p.w > p.d;
    for (const end of [-1, 1]) {
      const t = end * ((alongX ? p.w : p.d) / 2 - 4);
      const off = (rng.next() < 0.5 ? -1 : 1) * 4;
      props.push({
        kind: 'bench',
        x: p.x + (alongX ? t : off),
        z: p.z + (alongX ? off : t),
        yaw: alongX ? yawFacing(0, -Math.sign(off)) : yawFacing(-Math.sign(off), 0),
      });
    }
  }

  // Seafront promenade: lamps lighting the walk, benches facing the sea.
  const promMid = size / 2 + config.promenade - 1.5;
  for (const side of SIDES) {
    for (let t = -size / 2 + 15; t <= size / 2 - 15; t += 30) {
      const x = side.nx * promMid + side.tx * t;
      const z = side.nz * promMid + side.tz * t;
      props.push({ kind: 'lamp', x, z, yaw: yawFacing(-side.nx, -side.nz) });
      if (t + 15 <= size / 2 - 15 && rng.next() < 0.6) {
        props.push({
          kind: 'bench',
          x: side.nx * (promMid - 1) + side.tx * (t + 15),
          z: side.nz * (promMid - 1) + side.tz * (t + 15),
          yaw: yawFacing(side.nx, side.nz),
        });
      }
    }
  }
  // The jump ramp's run-up and landing stay clear, sidewalk edges included.
  return props.filter(
    (p) => !landmarks.some((l) => l.kind === 'ramp' && Math.abs(p.x - l.x) <= half && Math.abs(p.z - l.z) <= half && inRampLane(l, p)),
  );
}
