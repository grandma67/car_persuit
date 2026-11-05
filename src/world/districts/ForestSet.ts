// The Forest's set pieces: the log arch over the main street with the forest's name board (the
// Farm's ranch gate, its own names, no wheels), plain timber posts at the other gates, the lumber
// yard by the main gate (log stacks in rows with corridors between, a log loader and a parked log
// truck on the apron, yard lamps; the sawmill shed is a lot), the fire lookout tower in its
// clearing, and the campsite (a ring of tents round a fire pit, picnic tables). Pure data; drawn by
// render/districts/ForestSet.ts.
import { Rng } from '../../core/Rng';
import { FOREST } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { footprintsOverlap, type Footprint, type StreetProp } from '../StreetProps';
import type { District, Gate, Overhead, Structure } from './District';
import { ranchGateAt } from './FarmGate';
import { SIDES, mainGate, type Side } from './Megapark';
import type { Clearing, Track } from './ForestWoods';

/** Made-up forest names for the log arch's board (never a real park). */
export const FOREST_NAMES = ['Pinecrest Woods', 'Bramble Hollow', 'Fernvale Forest', 'Old Hemlock Woods', 'Larkspur Forest', 'Greystone Woods', 'Thornbury Forest', 'Mossy Ridge Woods'];

type P = { x: number; z: number };

/** A frame on a block's street side: u along it, v in from the sidewalk line. */
export interface SideFrame {
  side: Side;
  inner: Rect;
  at(u: number, v: number): P;
  /** The yaw that lays a footprint's local X along u. */
  yawU: number;
  /** A rect in (u, v) as a world rect. */
  rect(u0: number, u1: number, v0: number, v1: number): Rect;
}

export function sideFrame(inner: Rect, side: Side): SideFrame {
  // In from the side: -n. Along it: the side's tangent (n rotated a quarter turn).
  const tx = -side.nz, tz = side.nx;
  const edge = side.nx ? inner.w / 2 : inner.d / 2;
  const at = (u: number, v: number) => ({ x: inner.x + side.nx * (edge - v) + tx * u, z: inner.z + side.nz * (edge - v) + tz * u });
  return {
    side, inner, at,
    yawU: Math.atan2(-tz, tx),
    rect(u0, u1, v0, v1) {
      const a = at(u0, v0), b = at(u1, v1);
      return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, w: Math.abs(a.x - b.x), d: Math.abs(a.z - b.z) };
    },
  };
}

/** The side of block k that faces gate g's street. */
export function gateSide(city: CityData, k: number, g: Gate): Side {
  const c = city.blocks[k].rect;
  const hx = Math.sin(g.yaw), hz = Math.cos(g.yaw);
  const across = SIDES.filter((s) => Math.abs(s.nx * hx + s.nz * hz) < 0.5);
  return across.reduce((a, b) => (b.nx * (g.x - c.x) + b.nz * (g.z - c.z) > a.nx * (g.x - c.x) + a.nz * (g.z - c.z) ? b : a));
}

/** The lumber yard's frame: its block's side on the main gate's street. */
export const yardFrame = (q: District, city: CityData, k: number) => sideFrame(shrink(city.blocks[k].rect, city.config.sidewalk), gateSide(city, k, mainGate(q)));

/** The sawmill shed's lot: along the yard's back, its long side across the block. */
export function sawmillRect(f: SideFrame): Rect {
  const [long, short] = FOREST.sawmill.size;
  const depth = f.side.nx ? f.inner.w : f.inner.d;
  return f.rect(-long / 2, long / 2, depth - FOREST.lotInset - short, depth - FOREST.lotInset);
}

/** The ranger station's lot: in the corner of its block by the main gate, back from the gate's street. */
export function rangerRect(city: CityData, k: number, g: Gate): Rect {
  const f = sideFrame(shrink(city.blocks[k].rect, city.config.sidewalk), gateSide(city, k, g));
  const [long, short] = FOREST.ranger.size;
  const along = f.side.nx ? f.inner.d : f.inner.w;
  // Towards the gate's end of the side (where the street comes in), 3 m off the corner for the post.
  const p0 = f.at(-along / 2, 0), p1 = f.at(along / 2, 0);
  const sign = Math.hypot(p1.x - g.x, p1.z - g.z) < Math.hypot(p0.x - g.x, p0.z - g.z) ? 1 : -1;
  const u = sign * (along / 2 - 3 - long / 2);
  return f.rect(u - long / 2, u + long / 2, FOREST.lotInset, FOREST.lotInset + short);
}

export interface SetLayout {
  structures: Structure[];
  solids: Footprint[];
  overhead: Overhead[];
  drivable: Rect[];
  props: StreetProp[];
}

const empty = (): SetLayout => ({ structures: [], solids: [], overhead: [], drivable: [], props: [] });

/** The log arch over the main gate's street, timber posts beside every other gate. */
export function layGates(q: District, city: CityData, rng: Rng): SetLayout {
  const out = empty();
  const main = mainGate(q);
  const arch = ranchGateAt(q, city, main, rng, FOREST_NAMES);
  if (arch) {
    out.structures.push({ ...arch.s, kind: 'logArch' });
    out.solids.push(...arch.solids);
    out.overhead.push({ ...arch.overhead, kind: 'archSign' });
  }
  for (const g of q.gates) {
    if (g === main && arch) continue;
    const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw), hx = Math.sin(g.yaw), hz = Math.cos(g.yaw);
    const o = g.opening / 2 + 0.6;
    const posts = [-1, 1].map((e): Footprint => ({ x: g.x + lx * e * o + hx * 0.6, z: g.z + lz * e * o + hz * 0.6, hx: FOREST.post, hz: FOREST.post, yaw: g.yaw }));
    out.structures.push({ kind: 'gatePosts', x: g.x, z: g.z, yaw: g.yaw, footprints: posts });
    out.solids.push(...posts);
  }
  return out;
}

/**
 * The lumber yard: an open apron along its street, then rows of log stacks across the block with
 * corridors between them and an aisle up the middle to the sawmill at the back. On the apron a log
 * loader and a parked log truck; lamps at the apron's ends and by the sawmill.
 */
export function layYard(q: District, city: CityData, k: number, rng: Rng): SetLayout {
  const out = empty();
  const f = yardFrame(q, city, k);
  const Y = FOREST.yard;
  const width = f.side.nx ? f.inner.d : f.inner.w;
  const half = width / 2;
  const depth = f.side.nx ? f.inner.w : f.inner.d;
  const mill = FOREST.sawmill.size[1] + FOREST.lotInset;
  const yawU = f.yawU;
  // Rows of stacks either side of the aisle, logs lying along u.
  let v = Y.apron;
  const rowsEnd: number[] = [];
  for (let r = 0; r < Y.rows && v + Y.row <= depth - mill - Y.corridor; r++) {
    for (const e of [-1, 1]) {
      const from = Y.aisle / 2, to = half - 0.5;
      const n = Math.floor((to - from + Y.stackGap) / (Y.stack + Y.stackGap));
      for (let i = 0; i < n; i++) {
        const u = e * (from + Y.stack / 2 + i * (Y.stack + Y.stackGap));
        const p = f.at(u, v + Y.row / 2);
        const fp: Footprint = { ...p, hx: Y.stack / 2, hz: Y.row / 2, yaw: yawU };
        out.structures.push({ kind: 'logStack', ...p, yaw: yawU, footprints: [fp], data: { h: rng.range(Y.stackH[0], Y.stackH[1]), seed: rng.int(1, 1e6) } });
        out.solids.push(fp);
      }
    }
    v += Y.row;
    rowsEnd.push(v);
    v += Y.corridor;
  }
  // The open ground: the apron, the corridors between the rows (and on to the sawmill), the aisle.
  out.drivable.push(f.rect(-half, half, Y.parked, Y.apron)); // behind the parked truck and loader
  for (const e of rowsEnd) out.drivable.push(f.rect(-half, half, e, Math.min(e + Y.corridor, depth - mill)));
  out.drivable.push(f.rect(-Y.aisle / 2, Y.aisle / 2, 0, depth - mill));
  // On the apron: the loader on one side of the aisle, the truck on the other, both along u.
  const side = rng.next() < 0.5 ? 1 : -1;
  const truck = f.at(side * (Y.aisle / 2 + 8), Y.parked / 2);
  const truckFp: Footprint = { ...truck, hx: 5.2, hz: 1.3, yaw: yawU };
  out.structures.push({ kind: 'logTruck', ...truck, yaw: yawU + (rng.next() < 0.5 ? Math.PI : 0), footprints: [truckFp] });
  const loader = f.at(-side * (Y.aisle / 2 + 6), Y.parked / 2);
  const loaderFp: Footprint = { ...loader, hx: 2, hz: 1.4, yaw: yawU };
  out.structures.push({ kind: 'logLoader', ...loader, yaw: yawU + (side > 0 ? 0 : Math.PI), footprints: [loaderFp] });
  out.solids.push(truckFp, loaderFp);
  // Lamps: at the apron's two ends and either side of the aisle in front of the sawmill.
  for (const [u, vv] of [[-(half - 1.5), 1.2], [half - 1.5, 1.2], [-(Y.aisle / 2 + 1), depth - mill - 1.5], [Y.aisle / 2 + 1, depth - mill - 1.5]].slice(0, Y.lamps)) {
    out.props.push({ kind: 'lamp', ...f.at(u, vv), yaw: yawU + Math.PI / 2 });
  }
  return out;
}

/** Track direction and its normal at its middle (where the clearing sits). */
function across(t: Track): { nx: number; nz: number } {
  const i = Math.floor(t.points.length / 2);
  const a = t.points[i - 1], b = t.points[i + 1];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { nx: -(b.z - a.z) / l, nz: (b.x - a.x) / l };
}

/** Inside the clearing and clear of the track (and of what's already there). */
function fitsGlade(fp: Footprint, g: Clearing, t: Track, taken: Footprint[]): boolean {
  const reach = Math.hypot(fp.hx, fp.hz);
  if (Math.hypot(fp.x - g.x, fp.z - g.z) + reach > g.r - 0.5) return false;
  const lane: Footprint[] = t.points.slice(1).map((p, i) => {
    const a = t.points[i];
    return { x: (a.x + p.x) / 2, z: (a.z + p.z) / 2, hx: t.width / 2 + 0.8, hz: Math.hypot(p.x - a.x, p.z - a.z) / 2 + 0.5, yaw: Math.atan2(p.x - a.x, p.z - a.z) };
  });
  return ![...lane, ...taken].some((o) => footprintsOverlap(fp, o));
}

/** The fire lookout: a tall timber tower on four splayed legs beside the track in its clearing. */
export function layLookout(t: Track, g: Clearing, rng: Rng): SetLayout {
  const out = empty();
  const n = across(t);
  const L = FOREST.lookout;
  for (const e of rng.next() < 0.5 ? [1, -1] : [-1, 1]) {
    const off = t.width / 2 + 2 + L.legs + L.leg;
    const c = { x: g.x + n.nx * e * off, z: g.z + n.nz * e * off };
    const yaw = Math.atan2(n.nx, n.nz);
    const legs = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]): Footprint => ({
      x: c.x + Math.cos(yaw) * a * L.legs + Math.sin(yaw) * b * L.legs, z: c.z - Math.sin(yaw) * a * L.legs + Math.cos(yaw) * b * L.legs, hx: L.leg, hz: L.leg, yaw,
    }));
    const whole: Footprint = { ...c, hx: L.legs + L.leg, hz: L.legs + L.leg, yaw };
    if (!fitsGlade(whole, g, t, [])) continue;
    out.structures.push({ kind: 'lookout', ...c, yaw: yaw + (e < 0 ? Math.PI : 0), footprints: legs, data: { cabin: L.cabin } });
    out.solids.push(...legs);
    break;
  }
  return out;
}

/** The campsite: a fire pit off the track, tents in a ring round it facing in, picnic tables. The side with room for more tents wins. */
export function layCampsite(t: Track, g: Clearing, rng: Rng): SetLayout {
  const first = rng.next() < 0.5 ? 1 : -1;
  const sides = [first, -first].map((e) => campsiteOn(t, g, e, new Rng(rng.int(1, 1e9))));
  const tents = (l: SetLayout) => l.structures.filter((s) => s.kind === 'tent').length;
  return tents(sides[1]) > tents(sides[0]) ? sides[1] : sides[0];
}

function campsiteOn(t: Track, g: Clearing, e: number, rng: Rng): SetLayout {
  const out = empty();
  const n = across(t);
  const C = FOREST.camp;
  // From the track's middle (the clearing may sit a little off it), out to the side.
  const mid = t.points[Math.floor(t.points.length / 2)];
  const off = t.width / 2 + C.pitOut;
  const pit = { x: mid.x + n.nx * e * off, z: mid.z + n.nz * e * off };
  const pitFp: Footprint = { ...pit, hx: C.pit, hz: C.pit, yaw: 0 };
  if (!fitsGlade(pitFp, g, t, [])) return out;
  out.structures.push({ kind: 'firePit', ...pit, yaw: rng.range(0, Math.PI * 2), footprints: [pitFp] });
  out.solids.push(pitFp);
  const taken: Footprint[] = [{ ...pitFp, hx: C.pit + 0.6, hz: C.pit + 0.6 }];
  // Tents round the pit, away from the track first, then round towards it on either hand.
  const away = Math.atan2(n.nx * e, n.nz * e);
  const want = rng.int(C.tents[0], C.tents[1]);
  for (let i = 0; i < 9 && out.structures.length - 1 < want; i++) {
    const a = away + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.62 + rng.range(-0.06, 0.06);
    const p = { x: pit.x + Math.sin(a) * C.ring, z: pit.z + Math.cos(a) * C.ring };
    const fp: Footprint = { ...p, hx: 1.1, hz: 1.4, yaw: a }; // its door (local -Z) towards the pit
    if (!fitsGlade(fp, g, t, taken)) continue;
    out.structures.push({ kind: 'tent', ...p, yaw: a + Math.PI, footprints: [fp], data: { colour: rng.int(0, 3) } });
    out.solids.push(fp);
    taken.push({ ...fp, hx: fp.hx + 0.4, hz: fp.hz + 0.4 });
  }
  // Picnic tables on the track's other side of the clearing.
  for (let i = 0, tries = 0; i < C.tables && tries < 20; tries++) {
    const r = rng.range(t.width / 2 + 2, g.r - 2), s = rng.range(-g.r * 0.5, g.r * 0.5);
    const p = { x: mid.x - n.nx * e * r + n.nz * s, z: mid.z - n.nz * e * r - n.nx * s };
    const table: StreetProp = { kind: 'picnicTable', ...p, yaw: rng.range(0, Math.PI) };
    const fp: Footprint = { ...p, hx: 1.3, hz: 1.2, yaw: table.yaw };
    if (!fitsGlade(fp, g, t, taken)) continue;
    out.props.push(table);
    taken.push(fp);
    i++;
  }
  return out;
}

/** The buildings' footprints with a little room round them, for what's laid after. */
export const roomAround = (buildings: Building[], m: number): Footprint[] => buildings.map((b) => ({ x: b.x, z: b.z, hx: b.w / 2 + m, hz: b.d / 2 + m, yaw: 0 }));

/** Is p inside any of `rects`? */
export const inAny = (rects: Rect[], p: P, m = 0) => rects.some((r) => inRect(r, p, m));
