// The Slums' streets: kerb junk and dumpsters at the alley mouths, wrecks at the kerb and in the
// rubble lots, payphones outside the corner store, one working lamp per junction, stumps where the
// trees were, graffiti on walls, shutters, piers and fences, utility poles with sagging wires and
// hanging sneakers, laundry lines between facing walk-ups, and the road worn through (potholes,
// oil, puddles, cracks, faded markings, litter, steaming manholes). Pure data, drawn by
// render/districts/Slums.ts.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, SLUMS, SLUMS_SET, SLUMS_STREET as ST } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { keepOf } from '../driveSide';
import { inRect, shrink } from '../lots';
import { footprintsOverlap, PROP_SPECS, propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp, type WreckKind } from '../StreetProps';
import { groundBase, groundHeight } from '../Terrain';
import { kerbClutter } from './apply';
import type { DistrictDressing, District, GroundPatch, Overhead } from './District';
import type { RunDressing } from './runtime';
import type { JunkyardData, OverpassData } from './SlumsSet';

/** A graffiti piece: a plane facing +Z local (out of its wall), `y` its centre (world), cell in the atlas. */
export interface Decal {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  cell: number;
  wall: { x: number; z: number; nx: number; nz: number; half: number; y0: number; y1: number }; // the face it's on (centre, normal, half length, height span)
}

/** The graffiti atlas: 32 cells (4 × 8, each 2:1), in families. */
export const GRAFFITI = { cells: 32, tags: [0, 8], bubbles: [8, 16], throws: [16, 22], stencils: [22, 26], murals: [26, 32] } as const;
const pickIn = (rng: Rng, [a, b]: readonly [number, number]) => rng.int(a, b - 1);

/** A sagging wire (pole to pole, or across the street), with its two end heights (world). */
export interface WireData {
  y0: number;
  y1: number;
  sag: number;
  sneakers: boolean; // a pair hanging off it by their laces, mid-span
}

/** A laundry line across an interior street: end heights (world), sag, and the clothes pegged on it. */
export interface LaundryData {
  y0: number;
  y1: number;
  sag: number;
  clothes: { t: number; w: number; h: number; color: number }[];
}

const CLUTTER: PropKind[] = ['trashBags', 'trashBags', 'trashBags', 'shoppingCart', 'tyres', 'mattress', 'couch', 'burnBarrel', 'pallet', 'crates', 'drums'];
const WRECK_KINDS: [WreckKind, number][] = [['burnt', 3], ['bricks', 2], ['stripped', 2], ['flipped', 1], ['crushed', 1]];
const WRECK_PAINT = [0x8a2a22, 0x2a4a7a, 0x4a5a3a, 0x9a9a92, 0x6a5a4a, 0x7a6a3a, 0x3a3e44, 0xb8b0a0, 0x5a2a4a];
const BURNT = [0x6a5a52, 0x5a4a44, 0x7a5a48];
const DUMPSTER = [0x2f5a3a, 0x2f4a6a, 0x5a4a3a, 0x3a3e44];
const COUCH = [0x6a3a2a, 0x4a5a3a, 0x7a6a5a, 0x3a4a6a, 0x8a7a5a];
const CLOTHES = [0xd8d0c0, 0x2f5f9a, 0xb03a2e, 0x3f7a4a, 0xe8c21a, 0xf2f2ee, 0x5a4a7a, 0xd8762a, 0x2a2a2a];
const WRECK_HALF_W = 0.92;
const WRECK_HALF_L = 2.15;

/** One street of the district, A → B, with its sides. */
interface Street {
  a: number;
  b: number;
  A: { x: number; z: number };
  B: { x: number; z: number };
  len: number;
  dx: number;
  dz: number;
}

function streetsOf(q: District, city: CityData): Street[] {
  const out: Street[] = [];
  const done = new Set<string>();
  for (const key of q.streets) {
    const [a, b] = key.split('>').map(Number);
    if (done.has(`${b}>${a}`)) continue;
    done.add(key);
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    out.push({ a, b, A, B, len, dx: (B.x - A.x) / len, dz: (B.z - A.z) / len });
  }
  return out;
}

/** A point `t` along a street, `lateral` out to `side` (kerbClutter's convention). */
const along = (s: Street, t: number, lateral: number, side: number) => ({ x: s.A.x + s.dx * t - s.dz * lateral * side, z: s.A.z + s.dz * t + s.dx * lateral * side });

/**
 * Everything on the Slums' streets, after the set pieces: appended to `out` (props, structures,
 * solids, overhead, ground, extra). Draws only after everything else on the district's stream.
 */
export function streetDressing(q: District, city: CityData, out: DistrictDressing, rng: Rng): void {
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const streets = streetsOf(q, city);
  const perimeter = new Set(q.perimeter);
  const built = city.buildings.filter((b) => b.district === 'slums' && inRect(q.bounds, b));
  const inBounds = (p: { x: number; z: number }) => inRect(q.bounds, p, 2);
  const taken: Footprint[] = [
    ...built.map(rectFootprint),
    ...out.solids,
    ...city.streetProps.filter(inBounds).map((p) => propFootprint(p, 0.3)),
    ...out.props.map((p) => propFootprint(p, 0.3)),
  ];
  // Ways in stay open: the junkyard's corridors across the sidewalk and out over the kerb lane, the
  // same in front of each torn fence hole.
  const lane = 3;
  const vacant = (out.extra?.vacant ?? []) as { rect: Rect; holes: { x: number; z: number; nx: number; nz: number }[] }[];
  for (const r of out.drivable) {
    if (vacant.some((v) => v.rect === r)) continue;
    taken.push(rectFootprint(r.w > r.d ? { ...r, w: r.w + lane * 2 } : { ...r, d: r.d + lane * 2 }));
  }
  for (const v of vacant) {
    for (const h of v.holes) {
      const reach = sw + SLUMS.fenceInset + lane;
      const c = { x: h.x + (h.nx * reach) / 2, z: h.z + (h.nz * reach) / 2 };
      taken.push({ ...c, hx: h.nx ? reach / 2 : SLUMS.fenceHole / 2, hz: h.nx ? SLUMS.fenceHole / 2 : reach / 2, yaw: 0 });
    }
  }
  const free = (fp: Footprint) => !taken.some((f) => footprintsOverlap(fp, f));
  const added: StreetProp[] = [];
  const place = (p: StreetProp, pad = 0.3) => {
    const fp = propFootprint(p);
    if (!free(fp)) return false;
    taken.push(propFootprint(p, pad));
    added.push(p);
    return true;
  };
  const clearAt = (id: number) => rw / 2 + DISTRICTS.clutterGap + (perimeter.has(id) ? sw : 0);
  const gates = q.gates.map((g) => ({ x: g.x, z: g.z }));
  const nearGate = (p: { x: number; z: number }) => gates.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < DISTRICTS.clutterGap);

  // One working lamp per junction: the nearest dead one comes back on.
  const nodes = city.graph.nodes.filter((n) => inRect(q.bounds, n, rw / 2 + 1)); // the perimeter's junctions too
  const lit = new Set<StreetProp>();
  for (const n of nodes) {
    let best: StreetProp | undefined, d = 30;
    for (const p of city.streetProps) {
      if (p.kind !== 'brokenLamp' || lit.has(p)) continue;
      const k = Math.hypot(p.x - n.x, p.z - n.z);
      if (k < d) (best = p), (d = k);
    }
    if (best) lit.add(best);
  }
  // And on each street, the dead lamp nearest its middle buzzes on and off at night.
  const flicker = new Set<StreetProp>();
  for (const s of streets) {
    const mid = along(s, s.len / 2, 0, 1);
    let best: StreetProp | undefined, d = s.len / 2;
    for (const p of city.streetProps) {
      if (p.kind !== 'brokenLamp' || lit.has(p) || flicker.has(p)) continue;
      const k = Math.hypot(p.x - mid.x, p.z - mid.z);
      if (k < d) (best = p), (d = k);
    }
    if (best) flicker.add(best);
  }
  city.streetProps = city.streetProps.map((p) => (lit.has(p) ? { ...p, kind: 'lamp' as const } : flicker.has(p) ? { ...p, kind: 'lamp' as const, flicker: true } : p));

  // Stumps where the trees were.
  const stumps = city.trees.filter((t) => inRect(q.bounds, t));
  city.trees = city.trees.filter((t) => !inRect(q.bounds, t));

  // Torn chain-link round the rubble lots.
  out.props = out.props.map((p) => (p.kind === 'fence' && p.style === 'chainlink' && rng.next() < ST.tornFence ? { ...p, style: 'torn' as const } : p));

  // Dumpsters at the alley mouths: against the building line, just past the junction gap.
  for (const s of streets) {
    for (const [t, id] of [[clearAt(s.a) + 1.2, s.a], [s.len - clearAt(s.b) - 1.2, s.b]] as [number, number][]) {
      if (t < 0 || t > s.len || perimeter.has(id) && rng.next() < 0.5) continue;
      for (const side of [-1, 1]) {
        if (rng.next() >= ST.dumpsterChance) continue;
        const p = along(s, t, rw / 2 + sw - 0.85, side);
        const nx = -s.dz * side, nz = s.dx * side; // out from the centre line
        place({ kind: 'dumpster', ...p, yaw: Math.atan2(-nx, -nz), color: rng.pick(DUMPSTER) });
      }
    }
  }

  // Wrecks at the kerb, up on it a little, facing the way their lane runs; clear of junction mouths and gates.
  const keep = keepOf(city.driveSide);
  const lateral = rw / 2 - WRECK_HALF_W + ST.wreckOnKerb;
  const wreck = (): Pick<StreetProp, 'wreck' | 'color'> => {
    const total = WRECK_KINDS.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total, kind: WreckKind = 'burnt';
    for (const [k, w] of WRECK_KINDS) if ((r -= w) < 0) { kind = k; break; }
    return { wreck: kind, color: kind === 'burnt' ? rng.pick(BURNT) : rng.pick(WRECK_PAINT) };
  };
  let wrecks = 0;
  const wantKerb = rng.int(ST.kerbWrecks[0], ST.kerbWrecks[1]);
  const order = [...streets];
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  for (const s of order) {
    if (wrecks >= wantKerb) break;
    const lo = rw / 2 + DISTRICTS.clutterGap + WRECK_HALF_L + (perimeter.has(s.a) ? sw : 0), hi = s.len - rw / 2 - DISTRICTS.clutterGap - WRECK_HALF_L - (perimeter.has(s.b) ? sw : 0);
    if (hi <= lo) continue;
    for (const side of [-1, 1]) {
      for (let n = rng.int(0, 2); n > 0 && wrecks < wantKerb; n--) {
        const t = rng.range(lo, hi);
        const p = along(s, t, lateral, side);
        const nx = -s.dz * side, nz = s.dx * side;
        const d = keep > 0 ? { x: nz, z: -nx } : { x: -nz, z: nx };
        if (nearGate(p)) continue;
        if (place({ kind: 'wreck', ...p, yaw: Math.atan2(d.x, d.z), ...wreck() }, 0.2)) wrecks++;
      }
    }
  }
  // And a few dumped in the rubble lots.
  for (const v of (out.extra?.vacant ?? []) as { rect: Rect }[]) {
    if (!v.rect.w) continue;
    const r = shrink(v.rect, 3.5);
    if (r.w < 2 || r.d < 2) continue;
    for (let n = rng.int(ST.lotWrecks[0], ST.lotWrecks[1]); n > 0 && wrecks < SLUMS.maxWrecks; n--) {
      const p = { x: r.x + rng.range(-r.w / 2, r.w / 2), z: r.z + rng.range(-r.d / 2, r.d / 2) };
      if (place({ kind: 'wreck', ...p, yaw: rng.range(0, Math.PI * 2), ...wreck() }, 0.5)) wrecks++;
    }
  }

  // Payphones outside the corner store, on the kerb side of its sidewalk, facing the shop.
  const store = built.find((b) => b.lot === 'cornerStore');
  if (store) {
    const block = q.blocks.map((k) => city.blocks[k].rect).find((r) => inRect(r, store));
    const faces: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];
    let n = rng.int(ST.payphones[0], ST.payphones[1]);
    for (const [bit, nx, nz] of faces) {
      if (!block || !(store.street! & bit) || n <= 0) continue;
      const kerb = nx ? block.x + (nx * block.w) / 2 : block.z + (nz * block.d) / 2;
      const u = (nx ? store.d : store.w) / 2 - 1.5;
      for (const off of [u, -u]) {
        if (n <= 0) break;
        const at = nx ? { x: kerb - nx * 0.9, z: store.z + off } : { x: store.x + off, z: kerb - nz * 0.9 };
        if (place({ kind: 'payphone', ...at, yaw: Math.atan2(-nx, -nz) })) n--;
      }
    }
  }

  // Kerb junk along every street.
  const around = { ...city, streetProps: [...city.streetProps, ...out.props, ...added] };
  for (const p of kerbClutter(q, around, CLUTTER, rng, { step: [6, 12] })) {
    if (p.kind === 'couch') p.color = rng.pick(COUCH);
    if (!out.solids.some((s) => footprintsOverlap(propFootprint(p), s))) place(p);
  }
  out.props.push(...added);

  // Utility poles along one side of each street, wires sagging pole to pole, one across the street with sneakers.
  const wires: Overhead[] = [];
  for (const s of streets) {
    const side = rng.next() < 0.5 ? -1 : 1;
    const lo = rw / 2 + 3, hi = s.len - rw / 2 - 3;
    const poles: { x: number; z: number; y: number }[] = [];
    for (let t = lo + rng.range(0, 6); t < hi; t += ST.poleSpacing + rng.range(-3, 3)) {
      for (const shift of [0, 1.5, -1.5, 3, -3]) {
        const p = along(s, Math.min(hi, Math.max(lo, t + shift)), rw / 2 + 0.45, side);
        const fp: Footprint = { ...p, hx: 0.16, hz: 0.16, yaw: 0 };
        if (!free(fp) || nearGate(p)) continue;
        taken.push({ ...fp, hx: 0.5, hz: 0.5 });
        poles.push({ ...p, y: groundBase(city.terrain, p.x, p.z, PROP_SPECS.utilityPole.hx) });
        break;
      }
    }
    // Breakable, like the lamps: the wires drop with a pole knocked down (the renderer). A transformer can on some.
    for (const p of poles) {
      const pole: StreetProp = { kind: 'utilityPole', x: p.x, z: p.z, yaw: Math.atan2(s.dx, s.dz) };
      if (Math.abs(p.x * 13 + p.z * 7) % 10 < 3) pole.style = 'transformer';
      out.props.push(pole);
    }
    const top = (p: { y: number }) => p.y + PROP_SPECS.utilityPole.height - 0.8;
    for (let i = 1; i < poles.length; i++) wires.push(wire(poles[i - 1], poles[i], top(poles[i - 1]), top(poles[i]), ST.wireSag, false, city));
    // Across the street from the middle pole to the far building line, a pair of sneakers on it now and then.
    if (poles.length) {
      const p = poles[Math.floor(poles.length / 2)];
      const t = (p.x - s.A.x) * s.dx + (p.z - s.A.z) * s.dz;
      const far = along(s, t, rw / 2 + sw - 0.2, -side);
      const yFar = highest(p, far, city) + PROP_SPECS.utilityPole.height - 1.6; // level with the highest ground under it, on a hill too
      wires.push(wire(p, far, top(p), yFar, ST.wireSag * 0.8, rng.next() < 0.5, city));
    }
  }

  // Laundry lines across interior streets, between walk-ups facing each other.
  const laundry: Overhead[] = [];
  const want = rng.int(ST.laundryLines[0], ST.laundryLines[1]);
  for (const s of order) {
    if (laundry.length >= want) break;
    if (perimeter.has(s.a) && perimeter.has(s.b)) continue;
    const facing = (side: number) => built.filter((b) => (b.lot === 'tenement' || b.lot === 'squat') && faceOn(b, s, side, rw, sw));
    const left = facing(-1), right = facing(1);
    for (const l of left) {
      const r = right.find((o) => overlap(span(l, s), span(o, s)) >= 3);
      if (!r || rng.next() < 0.4) continue;
      const [a0, a1] = span(l, s), [b0, b1] = span(r, s);
      const t = rng.range(Math.max(a0, b0) + 1, Math.min(a1, b1) - 1);
      const pa = along(s, t, faceAt(l, s), -1), pb = along(s, t, faceAt(r, s), 1);
      const lowTop = Math.min(footing(l, city) + l.h, footing(r, city) + r.h) - 1;
      const g = Math.max(groundHeight(city.terrain, pa.x, pa.z), groundHeight(city.terrain, pb.x, pb.z));
      const y = Math.max(g + DISTRICTS.overheadClearance + 2.4, g + 7);
      if (y > lowTop) continue;
      const clothes: LaundryData['clothes'] = [];
      const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      for (let u = 1 + rng.range(0, 0.6); u < len - 1; u += rng.range(0.8, 1.6)) clothes.push({ t: u / len, w: rng.range(0.4, 0.9), h: rng.range(0.4, 0.85), color: rng.pick(CLOTHES) });
      const sag = 0.45;
      const data: LaundryData = { y0: y, y1: y + rng.range(-0.3, 0.3), sag, clothes };
      const lowest = Math.min(data.y0, data.y1) - sag - Math.max(0, ...clothes.map((c) => c.h)) - g;
      laundry.push({ kind: 'laundry', points: [pa, pb], bottom: lowest, data: data as unknown as Record<string, unknown> });
      break;
    }
  }
  out.overhead.push(...wires, ...laundry);

  // Graffiti, at most maxTags: the overpass's piers and parapets, the junkyard fence, then the walk-ups.
  const decals: Decal[] = [];
  const spans: Map<string, [number, number][]> = new Map();
  /** A piece on a face: centre (x, z), normal, half length; along `u` from its centre, `y` (world) its centre. */
  const paint = (key: string, wall: Decal['wall'], u: number, y: number, w: number, h: number, cell: number, proud = 0.025) => {
    if (decals.length >= SLUMS.maxTags) return false;
    if (Math.abs(u) + w / 2 > wall.half || y - h / 2 < wall.y0 || y + h / 2 > wall.y1) return false;
    // One row of pieces per face: no two overlap along it.
    const used = spans.get(key) ?? [];
    if (used.some(([a, b]) => u + w / 2 > a - 0.3 && u - w / 2 < b + 0.3)) return false;
    used.push([u - w / 2, u + w / 2]);
    spans.set(key, used);
    const tx = wall.nz, tz = -wall.nx; // along the face: the plane's local +X
    decals.push({ x: wall.x + tx * u + wall.nx * proud, y, z: wall.z + tz * u + wall.nz * proud, yaw: Math.atan2(wall.nx, wall.nz), w, h, cell, wall });
    return true;
  };
  for (const st of out.structures) {
    if (st.kind === 'overpass') {
      const d = st.data as unknown as OverpassData;
      const c = Math.cos(st.yaw), sn = Math.sin(st.yaw);
      const toWorld = (x: number, z: number) => ({ x: st.x + c * x + sn * z, z: st.z - sn * x + c * z });
      const zPier = d.depth / 2 - 0.7, P = SLUMS_SET.pier * 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (rng.next() < 0.35) continue;
        const at = toWorld(sx * d.half, sz * (zPier + P / 2));
        const n = { x: sn * sz, z: c * sz };
        const wall = { ...at, nx: n.x, nz: n.z, half: P / 2 + 0.01, y0: d.base + 0.5, y1: d.base + d.bottom };
        paint(`pier${sx}${sz}`, wall, 0, d.base + rng.range(1.2, 2.4), 0.8, 0.4, pickIn(rng, GRAFFITI.tags));
      }
      for (const sz of [-1, 1]) {
        const at = toWorld(0, sz * d.depth / 2);
        const wall = { ...at, nx: sn * sz, nz: c * sz, half: (d.span + 1.2) / 2, y0: d.base + d.bottom + 1.66, y1: d.base + d.bottom + 2.52 }; // the parapet, under its top bar
        for (let k = rng.int(1, 3); k > 0; k--) paint(`deck${sz}`, wall, rng.range(-wall.half + 1, wall.half - 1), (wall.y0 + wall.y1) / 2, 1.6, 0.8, pickIn(rng, rng.next() < 0.5 ? GRAFFITI.bubbles : GRAFFITI.throws));
      }
    } else if (st.kind === 'junkFence') {
      const d = st.data as unknown as JunkyardData;
      d.fence.forEach((r, i) => {
        const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
        if (len < 3 || rng.next() < 0.4) return;
        const mx = (r.a.x + r.b.x) / 2, mz = (r.a.z + r.b.z) / 2;
        const ux = (r.b.x - r.a.x) / len, uz = (r.b.z - r.a.z) / len;
        let nx = -uz, nz = ux;
        if ((mx - st.x) * nx + (mz - st.z) * nz < 0) (nx = -nx), (nz = -nz); // outwards
        const g = groundHeight(city.terrain, mx, mz);
        const wall = { x: mx + nx * 0.04, z: mz + nz * 0.04, nx, nz, half: len / 2, y0: g + 0.1, y1: g + d.height - 0.3 };
        const w = Math.min(len - 0.4, rng.range(1.6, 3.2));
        paint(`fence${i}`, wall, rng.range(-(len - w) / 2, (len - w) / 2), g + 0.3 + w / 4 + rng.range(0, 0.4), w, w / 2, pickIn(rng, rng.next() < 0.6 ? GRAFFITI.throws : GRAFFITI.bubbles));
      });
    }
  }
  const FACES: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];
  for (const b of built) {
    const y0 = footing(b, city);
    const shut = b.lot === 'boarded' || b.lot === 'cornerStore';
    for (const [bit, nx, nz] of FACES) {
      if (!((b.street ?? 0) & bit)) continue;
      const half = (nx ? b.d : b.w) / 2;
      const at = { x: b.x + (nx * b.w) / 2, z: b.z + (nz * b.d) / 2 };
      const g = groundHeight(city.terrain, at.x, at.z);
      const wall = { ...at, nx, nz, half, y0, y1: y0 + b.h };
      const key = `${b.x},${b.z},${bit}`;
      for (let n = Math.floor((half * 2) / (shut ? 3.2 : 4.5)); n > 0; n--) {
        if (rng.next() > (shut ? 0.85 : 0.6)) continue;
        const roll = rng.next();
        const fam = roll < 0.35 ? GRAFFITI.tags : roll < 0.6 ? GRAFFITI.bubbles : roll < 0.8 ? GRAFFITI.throws : roll < 0.93 ? GRAFFITI.stencils : GRAFFITI.murals;
        const w = fam === GRAFFITI.murals ? rng.range(3.6, 4.4) : fam === GRAFFITI.tags || fam === GRAFFITI.stencils ? rng.range(1.0, 1.8) : rng.range(1.8, 3.2);
        paint(key, wall, rng.range(-half + w / 2, half - w / 2), g + 0.35 + w / 4 + rng.range(0, 0.6), w, w / 2, pickIn(rng, fam));
      }
      // A heaven spot: up by the roof, where nobody could reach.
      if (b.h > 9 && rng.next() < ST.heavenSpot) {
        const w = rng.range(2.8, 4.2);
        paint(`${key}^`, wall, rng.range(-half + w / 2, half - w / 2), y0 + b.h - 0.6 - w / 4, w, w / 2, pickIn(rng, rng.next() < 0.5 ? GRAFFITI.bubbles : GRAFFITI.throws));
      }
    }
  }

  // The roads worn through: faded markings, potholes, oil, puddles and cracks, manholes; litter on the sidewalks.
  const ground: GroundPatch[] = [];
  const potholes: Rect[] = [];
  const marks: Rect[] = [];
  const clearOfWear = (r: Rect) => !marks.some((m) => Math.abs(m.x - r.x) < (m.w + r.w) / 2 + 0.15 && Math.abs(m.z - r.z) < (m.d + r.d) / 2 + 0.15);
  const roads = city.roads.filter((r) => q.streets.has(`${r.a}>${r.b}`) || q.streets.has(`${r.b}>${r.a}`));
  for (const m of city.roadMarks) {
    if (!inRect(q.bounds, m) || (m.kind !== 'centerline' && m.kind !== 'edgeline') || rng.next() > ST.fadedMarks) continue;
    const alongX = m.w > m.d;
    const len = Math.min(alongX ? m.w : m.d, rng.range(1.5, 4));
    const off = rng.range(-1, 1) * ((alongX ? m.w : m.d) - len) / 2;
    const r = alongX ? { x: m.x + off, z: m.z, w: len, d: m.d + 0.1 } : { x: m.x, z: m.z + off, w: m.w + 0.1, d: len };
    if (!clearOfWear(r)) continue;
    marks.push(r);
    ground.push({ kind: 'faded', ...r });
  }
  for (const road of roads) {
    const r = shrink(road.rect, 0.6);
    const area = r.w * r.d;
    const drop = (kind: string, w: number, d: number) => {
      for (let tries = 0; tries < 6; tries++) {
        const p = { x: r.x + rng.range(-(r.w - w) / 2, (r.w - w) / 2), z: r.z + rng.range(-(r.d - d) / 2, (r.d - d) / 2), w, d };
        if (!clearOfWear(p)) continue;
        marks.push(p);
        ground.push({ kind, ...p });
        return p;
      }
      return null;
    };
    for (let n = Math.round((area / 100) * ST.potholesPer100m2 * rng.range(0.5, 1.5)); n > 0; n--) {
      const s = rng.range(0.6, 1.5);
      const p = drop('pothole', s * rng.range(0.8, 1.3), s);
      if (p) potholes.push(p);
    }
    for (let n = Math.round((area / 100) * ST.wearPer100m2 * rng.range(0.5, 1.5)); n > 0; n--) {
      const roll = rng.next();
      if (roll < 0.35) drop('oil', rng.range(0.6, 1.8), rng.range(0.6, 1.6));
      else if (roll < 0.6) drop('puddle', rng.range(1.2, 3.4), rng.range(0.9, 2.2));
      else if (roll < 0.9) { const long = rng.range(1.5, 4.5); drop('crack', rng.next() < 0.5 ? long : 0.07, rng.next() < 0.5 ? 0.07 : long); }
      else drop('patch', rng.range(1.5, 3), rng.range(1.2, 2.5)); // a darker repair
    }
    // A manhole in the middle of a lane, now and then.
    if (rng.next() < 0.5) drop('manhole', 0.75, 0.75);
  }
  for (const s of streets) {
    for (const side of [-1, 1]) {
      for (let t = rw / 2 + rng.range(0, 3); t < s.len - rw / 2; t += 10 / ST.litterPer10m * rng.range(0.5, 1.5)) {
        const p = along(s, t, rw / 2 + rng.range(0.4, sw - 0.4), side);
        const w = rng.range(0.25, 0.8), d = rng.range(0.25, 0.8);
        const r = { ...p, w, d };
        if (!inRect(q.bounds, p) || !clearOfWear(r)) continue;
        marks.push(r);
        ground.push({ kind: 'litter', ...r });
      }
    }
  }
  out.ground.push(...ground);
  out.extra = { ...out.extra, decals, stumps, potholes, manholes: ground.filter((g) => g.kind === 'manhole').map((g) => ({ x: g.x, z: g.z })) };
}

/** A building's footing (CityBuilder's: its lowest corner, sunk 0.3). */
const footing = (b: Building, city: CityData) => groundBase(city.terrain, b.x, b.z, Math.max(b.w, b.d) / 2) - 0.3;

/** A building's extent along a street (t from A). */
function span(b: Building, s: Street): [number, number] {
  const t = (b.x - s.A.x) * s.dx + (b.z - s.A.z) * s.dz;
  const half = Math.abs(s.dx) * (b.w / 2) + Math.abs(s.dz) * (b.d / 2);
  return [t - half, t + half];
}
const overlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/** How far a building's face towards a street stands from its centre line. */
function faceAt(b: Building, s: Street): number {
  const off = Math.abs((b.x - s.A.x) * -s.dz + (b.z - s.A.z) * s.dx);
  return off - (Math.abs(s.dz) * (b.w / 2) + Math.abs(s.dx) * (b.d / 2));
}

/** Does a building front this street on that side (its face within a few metres of the sidewalk line)? */
function faceOn(b: Building, s: Street, side: number, rw: number, sw: number): boolean {
  const off = (b.x - s.A.x) * -s.dz + (b.z - s.A.z) * s.dx;
  if (Math.sign(off) !== side) return false;
  const [t0, t1] = span(b, s);
  if (t1 < 0 || t0 > s.len) return false;
  return Math.abs(faceAt(b, s) - (rw / 2 + sw)) < 2.5;
}

/** The highest ground on the line from a to b. */
function highest(a: { x: number; z: number }, b: { x: number; z: number }, city: CityData): number {
  let g = -Infinity;
  for (let k = 0; k <= 8; k++) g = Math.max(g, groundHeight(city.terrain, a.x + ((b.x - a.x) * k) / 8, a.z + ((b.z - a.z) * k) / 8));
  return g;
}

/** A wire from a to b between those heights (world), sagging in a parabola; its bottom the least clearance along it (sneakers mid-span). */
function wire(a: { x: number; z: number }, b: { x: number; z: number }, y0: number, y1: number, sag: number, sneakers: boolean, city: CityData): Overhead {
  let bottom = Infinity;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t) - (sneakers && k === 8 ? 0.7 : 0);
    bottom = Math.min(bottom, y - groundHeight(city.terrain, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
  }
  const data: WireData = { y0, y1, sag, sneakers };
  return { kind: 'wire', points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], bottom, data: data as unknown as Record<string, unknown> };
}

/**
 * The Slums by climate, chosen per run (generation never depends on it): slush along the kerbs in
 * the snow; blown sand along the kerbs and banked against the walk-ups in the desert, the wrecks'
 * paint bleached; by the beach, the wrecks salt-rusted. On the district's stream, after everything.
 */
export function climateDressing(q: District, city: CityData, rng: Rng): Record<string, RunDressing> {
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const perimeter = new Set(q.perimeter);
  /** Broken strips along both kerbs of every street, in the gutter (on the road, clear of the junctions). */
  const gutter = (kind: string): GroundPatch[] => {
    const out: GroundPatch[] = [];
    for (const s of streetsOf(q, city)) {
      const t0 = rw / 2 + 1 + (perimeter.has(s.a) ? sw : 0), t1 = s.len - rw / 2 - 1 - (perimeter.has(s.b) ? sw : 0);
      for (const side of [-1, 1]) {
        for (let t = t0 + rng.range(0, 2); t < t1 - 1; ) {
          const len = Math.min(t1 - t, rng.range(2, 7)), w = rng.range(ST.gutterStrip[0], ST.gutterStrip[1]);
          const c = along(s, t + len / 2, rw / 2 - w / 2, side);
          out.push(Math.abs(s.dx) > 0.5 ? { kind, ...c, w: len, d: w } : { kind, ...c, w, d: len });
          t += len + rng.range(0.5, 4);
        }
      }
    }
    return out;
  };
  const slush = gutter('slush');
  const sand = gutter('drift');
  // Sand banked against the street fronts of the walk-ups, on the sidewalk.
  const FACES: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];
  for (const b of city.buildings) {
    if (b.district !== 'slums' || !inRect(q.bounds, b)) continue;
    for (const [bit, nx, nz] of FACES) {
      if (!((b.street ?? 0) & bit) || rng.next() >= ST.driftChance) continue;
      const len = (nx ? b.d : b.w) * rng.range(0.3, 0.8), deep = rng.range(0.5, 1.1);
      const u = rng.range(-1, 1) * ((nx ? b.d : b.w) - len) / 2;
      const c = { x: b.x + nx * (b.w / 2 + deep / 2) + (nx ? 0 : u), z: b.z + nz * (b.d / 2 + deep / 2) + (nz ? 0 : u) };
      sand.push(nx ? { kind: 'drift', ...c, w: deep, d: len } : { kind: 'drift', ...c, w: len, d: deep });
    }
  }
  return {
    snow: { ground: slush },
    desert: { ground: sand, tint: { kinds: ['wreck', 'dumpster', 'couch'], toward: 0xd8c8a8, by: 0.4 } },
    beach: { tint: { kinds: ['wreck', 'dumpster'], toward: 0x8a4a2a, by: 0.45 } },
  };
}
