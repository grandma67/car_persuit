// The Mega-park's set blocks: the sports ground (a soccer pitch and a tennis court), the running
// track, the fenced playground and the bandstand lawn with the café's terrace. Each lays out in its
// block (inside the sidewalk line) in a frame turned to its own long axis. Pure data.
import type { Rng } from '../../core/Rng';
import { MEGAPARK, PARKS } from '../../gameplay/balance';
import type { Building, Rect } from '../CityGenerator';
import { pitchAt, type ParkPiece } from '../ParkPieces';
import type { Footprint, StreetProp } from '../StreetProps';
import type { GroundPatch, Structure } from './District';

export interface GroundsLayout {
  structures: Structure[];
  solids: Footprint[];
  props: StreetProp[];
  ground: GroundPatch[];
  pieces: ParkPiece[];
}

const empty = (): GroundsLayout => ({ structures: [], solids: [], props: [], ground: [], pieces: [] });

/** Half the block's grass a piece may reach (as a park's, inside where its fence stood). */
const reachOf = (inner: Rect) => inner.w / 2 - 1.3;

/** A frame over the block: u along its long axis (world X when alongX), v across. */
function frame(inner: Rect, alongX: boolean) {
  const at = (u: number, v: number) => (alongX ? { x: inner.x + u, z: inner.z + v } : { x: inner.x + v, z: inner.z + u });
  // A rect in the frame (centre u, v; length along u, width along v) as a world rect.
  const rect = (u: number, v: number, len: number, wid: number): Rect => ({ ...at(u, v), w: alongX ? len : wid, d: alongX ? wid : len });
  // Heading of local +Z for a prop facing along +u (or +v).
  const yawU = alongX ? Math.PI / 2 : 0;
  const yawV = alongX ? 0 : Math.PI / 2;
  return { at, rect, yawU, yawV };
}

/** A box footprint (`len` along u, `wid` along v) in the frame. */
const boxIn = (f: ReturnType<typeof frame>, alongX: boolean, u: number, v: number, len: number, wid: number, margin = 0): Footprint => {
  const p = f.at(u, v);
  return { ...p, hx: (alongX ? len : wid) / 2 + margin, hz: (alongX ? wid : len) / 2 + margin, yaw: 0 };
};

/** Chain-link (or picket) panels round a rect, a gap `gap` wide in the middle of each listed side (+1/-1 along u or v). */
export function fenceRound(r: Rect, gaps: { axis: 'x' | 'z'; side: number; width: number }[], style: 'chainlink' | undefined, inset = 0.3): StreetProp[] {
  const panel = 3; // a 2.9 m panel and a hand's gap: neighbours never overlap
  const x0 = r.x - r.w / 2 + inset, x1 = r.x + r.w / 2 - inset, z0 = r.z - r.d / 2 + inset, z1 = r.z + r.d / 2 - inset;
  const c = 0.2; // the corners: a side's panels stop short of the one across
  const sides = [
    { axis: 'z' as const, side: -1, fixed: z0, lo: x0 + c, hi: x1 - c, mid: r.x },
    { axis: 'z' as const, side: 1, fixed: z1, lo: x0 + c, hi: x1 - c, mid: r.x },
    { axis: 'x' as const, side: -1, fixed: x0, lo: z0 + c, hi: z1 - c, mid: r.z },
    { axis: 'x' as const, side: 1, fixed: x1, lo: z0 + c, hi: z1 - c, mid: r.z },
  ];
  const out: StreetProp[] = [];
  for (const s of sides) {
    const gap = gaps.find((g) => g.axis === s.axis && g.side === s.side);
    const runs: [number, number][] = gap ? [[s.lo, s.mid - gap.width / 2], [s.mid + gap.width / 2, s.hi]] : [[s.lo, s.hi]];
    for (const [a, b] of runs) {
      const n = Math.floor((b - a) / panel + 0.05);
      const pad = (b - a - n * panel) / 2;
      for (let k = 0; k < n; k++) {
        const t = a + pad + panel * (k + 0.5);
        out.push({ kind: 'fence', ...(style ? { style } : {}), x: s.axis === 'x' ? s.fixed : t, z: s.axis === 'x' ? t : s.fixed, yaw: s.axis === 'x' ? Math.PI / 2 : 0 });
      }
    }
  }
  return out;
}

/** The sports ground: a soccer pitch on one side of the block, a fenced tennis court on the other. */
export function laySports(inner: Rect, block: [number, number], rng: Rng): GroundsLayout {
  const out = empty();
  const alongX = rng.next() < 0.5;
  const side = rng.next() < 0.5 ? -1 : 1;
  const f = frame(inner, alongX);
  const H = reachOf(inner);
  const V = PARKS.pitchWidth / 2 + MEGAPARK.pitchRunOff;
  const centre = f.at(0, -side * (H - V));
  const pitch = pitchAt(centre.x, centre.z, alongX, block, rng);
  out.pieces.push({ ...pitch.piece, district: 'megapark' });
  out.props.push(...pitch.props);
  // The court: long side along u, beyond the pitch's run-off.
  const [cl, cw] = MEGAPARK.court;
  const cu = rng.range(-1, 1) * (H - cl / 2);
  const cv = side * (H - cw / 2);
  const court = f.rect(cu, cv, cl, cw);
  out.ground.push({ kind: 'court', ...court, yaw: alongX ? 0 : Math.PI / 2 });
  // Its gate faces the pitch.
  out.props.push(...fenceRound(court, [{ axis: alongX ? 'z' : 'x', side: -side, width: 3.4 }], 'chainlink'));
  const net = f.at(cu, cv);
  out.props.push({ kind: 'tennisNet', ...net, yaw: f.yawU }); // local X across the court (along v)
  return out;
}

/** The running track: an oval of lanes round a grass infield with a sandpit, the stand beside it. */
export function layTrack(inner: Rect, rng: Rng): GroundsLayout {
  const out = empty();
  const alongX = rng.next() < 0.5;
  const side = rng.next() < 0.5 ? -1 : 1;
  const f = frame(inner, alongX);
  const H = reachOf(inner);
  const R = MEGAPARK.trackOuter;
  const cv = -side * (H - R);
  const c = f.at(0, cv);
  out.structures.push({ kind: 'track', x: c.x, z: c.z, yaw: alongX ? 0 : Math.PI / 2, footprints: [], data: { straight: MEGAPARK.trackStraight, outer: R, width: MEGAPARK.trackWidth, alongX } });
  out.ground.push({ kind: 'sandpit', ...f.rect(rng.range(-2, 2), cv, 9, 3) });
  // The stand: tiered benches along the home straight, facing the track.
  const [bl, bd] = MEGAPARK.bleachers;
  const bv = cv + side * (R + 1.5 + bd / 2);
  const stand = boxIn(f, alongX, 0, bv, bl, bd);
  const p = f.at(0, bv);
  out.structures.push({ kind: 'bleachers', ...p, yaw: alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2, footprints: [stand], data: { length: bl, depth: bd } });
  out.solids.push(stand);
  // Benches and a bin at the stand's ends.
  for (const e of [-1, 1]) {
    const b = f.at(e * (bl / 2 + 2), bv);
    out.props.push({ kind: 'bench', ...b, yaw: f.yawV + (side > 0 ? Math.PI : 0) });
  }
  out.props.push({ kind: 'litterBin', ...f.at(bl / 2 + 3.6, bv), yaw: 0 });
  return out;
}

/** The playground's equipment, a breakable prop to a cell (footprints in `PROP_SPECS`). */
const KIT = ['swings', 'slide', 'climber', 'roundabout', 'seesaw'] as const;

/** The playground: a picket-fenced yard, gates on both long sides, its equipment on a grid of cells, a sandpit. */
export function layPlayground(inner: Rect, rng: Rng): GroundsLayout {
  const out = empty();
  const alongX = rng.next() < 0.5;
  const f = frame(inner, alongX);
  const [pl, pw] = MEGAPARK.playground;
  const cu = rng.range(-1.5, 1.5), cv = rng.range(-1.5, 1.5);
  const yard = f.rect(cu, cv, pl, pw);
  out.ground.push({ kind: 'playground', ...yard });
  // Six cells (3 along, 2 across): the kit in five, the sandpit in one.
  const cells = Array.from({ length: 6 }, (_, k) => ({ u: cu + (k % 3 - 1) * (pl / 3), v: cv + (Math.floor(k / 3) - 0.5) * (pw / 2) }));
  const order = cells.map((_, k) => k);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  KIT.forEach((kit, n) => {
    const cell = cells[order[n]];
    const turn = rng.next() < 0.5; // a quarter turn in the frame
    const p = f.at(cell.u, cell.v);
    // A breakable prop: local X along the kit's first size.
    const yaw = (alongX ? 0 : Math.PI / 2) + (turn ? Math.PI / 2 : 0);
    out.props.push({ kind: kit, ...p, yaw });
  });
  // The fence after the kit, so the kit is what clearOf keeps where they touch.
  out.props.push(...fenceRound(yard, [{ axis: alongX ? 'z' : 'x', side: -1, width: 4 }, { axis: alongX ? 'z' : 'x', side: 1, width: 4 }], undefined));
  const sand = cells[order[5]];
  out.ground.push({ kind: 'sandpit', ...f.rect(sand.u, sand.v, 5, 5) });
  // Benches inside the fence facing in, a bin by each gate, the ice-cream cart outside one.
  for (const e of [-1, 1]) {
    const b = f.at(cu + e * (pl / 2 - 1.4), cv);
    out.props.push({ kind: 'bench', ...b, yaw: f.yawU + (e > 0 ? Math.PI : 0) });
    out.props.push({ kind: 'litterBin', ...f.at(cu + 3, cv + e * (pw / 2 + 1)), yaw: 0 });
  }
  const outside = rng.next() < 0.5 ? -1 : 1;
  out.props.push({ kind: 'iceCreamCart', ...f.at(cu - 4, cv + outside * (pw / 2 + 3)), yaw: f.yawU + rng.range(-0.3, 0.3) });
  return out;
}

/** Stripes for the deck chairs (tints). */
const CANVAS = [0x2a6ab8, 0xd83a3a, 0x2a9a5a, 0xe8b020, 0xe86a9a];
/** Parasols on the café's terrace (tints). */
const PARASOLS = [0x2f6a4a, 0xf2ece0, 0x8a2a2a];

/** The bandstand lawn: the octagonal bandstand, deck chairs round it, the café's terrace before the café. */
export function layBandstand(inner: Rect, cafe: Building, rng: Rng): GroundsLayout {
  const out = empty();
  // The café's side: its outward normal, from where it stands.
  const dx = cafe.x - inner.x, dz = cafe.z - inner.z;
  const nx = Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0, nz = nx ? 0 : Math.sign(dz);
  const R = MEGAPARK.bandstand;
  const bx = inner.x - nx * 4 + rng.range(-2, 2) * Math.abs(nz), bz = inner.z - nz * 4 + rng.range(-2, 2) * Math.abs(nx);
  const flat = R * Math.cos(Math.PI / 8);
  const octagon: Footprint[] = [{ x: bx, z: bz, hx: flat, hz: flat, yaw: 0 }, { x: bx, z: bz, hx: flat, hz: flat, yaw: Math.PI / 4 }];
  out.structures.push({ kind: 'bandstand', x: bx, z: bz, yaw: Math.atan2(nx, nz), footprints: octagon, data: { radius: R } });
  out.solids.push(...octagon);
  // Deck chairs in a loose arc facing it (not on the café's side).
  const chairs = rng.int(MEGAPARK.deckChairs[0], MEGAPARK.deckChairs[1]);
  const facing = Math.atan2(-nx, -nz); // from the bandstand away from the café
  for (let c = 0; c < chairs; c++) {
    const a = facing + rng.range(-1.6, 1.6);
    const r = rng.range(R + 3.5, R + 6.5);
    const x = bx + Math.sin(a) * r, z = bz + Math.cos(a) * r;
    out.props.push({ kind: 'deckChair', x, z, yaw: Math.atan2(bx - x, bz - z) + rng.range(-0.25, 0.25), color: rng.pick(CANVAS) });
  }
  // The terrace: paving before the café's front, tables under parasols, planters at its corners.
  const long = Math.abs(nx) ? cafe.d : cafe.w;
  const depth = 5.5;
  const fx = nx ? cafe.x - nx * (cafe.w / 2 + depth / 2) : cafe.x, fz = nz ? cafe.z - nz * (cafe.d / 2 + depth / 2) : cafe.z;
  const terrace: Rect = nx ? { x: fx, z: fz, w: depth, d: long + 2 } : { x: fx, z: fz, w: long + 2, d: depth };
  out.ground.push({ kind: 'terrace', ...terrace });
  const tables = Math.floor(long / 3.6);
  for (let t = 0; t < tables; t++) {
    const along = -((tables - 1) * 3.6) / 2 + t * 3.6;
    const out1 = (t % 2 ? 0.6 : -0.6);
    out.props.push({ kind: 'cafeTable', x: fx + (nz ? along : out1), z: fz + (nx ? along : out1), yaw: rng.range(0, Math.PI), color: rng.pick(PARASOLS) });
  }
  for (const e of [-1, 1]) {
    out.props.push({ kind: 'flowerPlanter', x: fx + (nz ? e * (long / 2 + 0.4) : -nx * (depth / 2 - 0.6)), z: fz + (nx ? e * (long / 2 + 0.4) : -nz * (depth / 2 - 0.6)), yaw: 0 });
  }
  out.props.push({ kind: 'litterBin', x: fx - nx * (depth / 2 + 1) + Math.abs(nz) * (long / 2 + 2), z: fz - nz * (depth / 2 + 1) + Math.abs(nx) * (long / 2 + 2), yaw: 0 });
  return out;
}
