// Breakable street furniture: placement (pure data) and 2D footprint overlap. PropSystem turns
// these into meshes and physics bodies.
import type { Rng } from '../core/Rng';
import type { Block, CityConfig, Rect } from './CityGenerator';
import type { Landmark } from './Landmarks';

export type PropKind = 'lamp' | 'hydrant' | 'bench' | 'fence' | 'sign' | 'signal';
export type SignVariant = 'stop' | 'speed30' | 'speed50' | 'noParking' | 'noSmoking' | 'children' | 'pedestrian';

export interface StreetProp {
  kind: PropKind;
  x: number;
  z: number;
  /** Heading: local +Z (lamp arm, bench front, sign face) points along (sin yaw, cos yaw). Fences run along local X. */
  yaw: number;
  variant?: SignVariant; // signs
  axis?: 'x' | 'z'; // signals: travel axis of the traffic they face
  phase?: number; // signals: junction cycle offset, seconds
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
};

/** Oriented rectangle on the ground plane. */
export interface Footprint {
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
}

export function propFootprint(p: StreetProp, margin = 0): Footprint {
  const s = PROP_SPECS[p.kind];
  return { x: p.x, z: p.z, hx: s.hx + margin, hz: s.hz + margin, yaw: p.yaw };
}

/** Separating-axis test for two oriented rectangles. */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
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

      if (!block.park && (block.district === 'downtown' || block.district === 'midtown') && rng.next() < 0.4) {
        props.push({ kind: 'bench', ...at(block, side, BENCH_INSET, rng.range(-5, 5)), yaw: yawFacing(side.nx, side.nz) });
      }

      // Picket fences: around parks (entrance gap mid-side) and along some residential blocks.
      const fenced = block.park || (block.district === 'residential' && rng.next() < 0.6);
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
      props.push({ kind: 'bench', x, z, yaw: Math.atan2(l.x - x, l.z - z) });
    }
  }

  // Plazas: benches near each end, along the plaza.
  for (const p of plazas) {
    const alongX = p.w > p.d;
    for (const end of [-1, 1]) {
      const t = end * (config.blockSize / 2 - 4);
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
  return props;
}
