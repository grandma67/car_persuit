// The Slums' set pieces: the destroyed building on each ruin lot (wall stubs with window holes,
// hanging slabs, rebar and joists, a rubble mound to the sidewalk, loose bricks, a KEEP OUT
// hoarding), the rusted rail overpass on the main-street gate, the junkyard (corrugated fence,
// wreck stacks in rows with corridors from street to street, a magnet crane, a crusher, tyre
// mountains) and the tent camp. Pure data; drawn by render/districts/Slums.ts.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, SLUMS_SET as SS } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import { shrink } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type StreetProp } from '../StreetProps';
import { groundBase, groundHeight } from '../Terrain';
import { inDistrict, isJunctionControl } from './apply';
import type { District, Gate, Overhead, Structure } from './District';
import { streetSides } from './Harbor';
import type { Ruin } from './Slums';

type P3 = { x: number; y: number; z: number };

/** A heading whose local +X runs along (dx, dz). */
const yawAlong = (dx: number, dz: number) => Math.atan2(-dz, dx);

// --- The destroyed building ---

/** A standing wall stub: along its local X, `tops` the height of each ~1 m column (ragged), window holes per storey. */
export interface WallStub {
  x: number;
  z: number;
  yaw: number;
  len: number;
  t: number;
  tops: number[];
  holes: boolean[]; // per column: a window column (holes between sill and lintel on every storey it reaches)
}

export interface RuinData {
  base: number; // footing (world)
  walls: WallStub[];
  slabs: { a: P3; b: P3; w: number }[]; // floor slabs from a hinge on a wall down to the heap (heights above the footing)
  bars: { a: P3; b: P3; r: number; wood: boolean }[]; // rebar and joists
  mound: Rect; // the heap's ground (its solid)
  front: { nx: number; nz: number }; // the street the heap spills to
  hoarding: { x: number; z: number; yaw: number; w: number }; // the KEEP OUT board, facing the street (+Z local)
}

const FACE: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];

/**
 * A ruin lot taken down: two or three wall stubs at the back and sides (2–4 storeys, ragged, with
 * window holes), slabs hanging from them onto the heap, joists and rebar sticking out, the rubble
 * heap over the lot and out over the sidewalk (short of the kerb, and of any junction control),
 * loose bricks on the sidewalk beyond it, and a KEEP OUT hoarding at the heap's foot.
 */
export function ruinLayout(r: Ruin, city: CityData, controls: Footprint[], rng: Rng): { s: Structure; solids: Footprint[]; props: StreetProp[] } {
  const faces = FACE.filter(([bit]) => r.street & bit);
  const [, nx, nz] = faces.length ? rng.pick(faces) : FACE[0];
  const ax = Math.abs(nz), az = Math.abs(nx); // along the street face
  const W = nx ? r.d : r.w; // along the face
  const D = nx ? r.w : r.d; // back to front
  const at = (u: number, v: number) => ({ x: r.x + ax * u + nx * v, z: r.z + az * u + nz * v });
  const rectAt = (uc: number, vc: number, ul: number, vl: number): Rect => ({ ...at(uc, vc), w: ax ? ul : vl, d: ax ? vl : ul });
  const block = city.blocks[r.block].rect;
  const kerb = nx ? (block.x + (nx * block.w) / 2 - r.x) * nx : (block.z + (nz * block.d) / 2 - r.z) * nz; // the kerb, from the lot's centre
  const sideLine = kerb - city.config.sidewalk;
  const t = SS.wall;
  const F = SS.floor;
  const base = groundBase(city.terrain, r.x, r.z, Math.max(r.w, r.d) / 2) - 0.3;
  const floors = rng.int(SS.stubFloors[0], SS.stubFloors[1]);
  const walls: WallStub[] = [];
  const solids: Footprint[] = [];
  /** A wall from (u0, v0) to (u1, v1), its tops falling from `hi` at the first end to `lo` at the other. */
  const stub = (u0: number, v0: number, u1: number, v1: number, hi: number, lo: number) => {
    const len = Math.hypot(u1 - u0, v1 - v0);
    const n = Math.max(2, Math.round(len));
    const tops: number[] = [];
    let wobble = 0;
    for (let i = 0; i < n; i++) {
      wobble = wobble * 0.6 + rng.range(-1.2, 1.2);
      const k = i / (n - 1);
      tops.push(Math.max(1.2, hi + (lo - hi) * k * k + wobble));
    }
    const holes = tops.map((_, i) => i % 3 === 1 && i < n - 1);
    const a = at(u0, v0), b = at(u1, v1);
    const du = u1 - u0, dv = v1 - v0;
    const dx = ax * du + nx * dv, dz = az * du + nz * dv;
    walls.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: yawAlong(dx, dz), len, t, tops, holes });
    const along = Math.abs(du) > Math.abs(dv);
    solids.push(rectFootprint(rectAt((u0 + u1) / 2, (v0 + v1) / 2, along ? len : t, along ? t : len)));
  };
  const hi = floors * F + rng.range(-0.8, 0.6);
  // The back wall stands tallest in the middle of the lot, broken lower towards one end.
  const back = -D / 2 + t / 2;
  const broken = rng.next() < 0.5 ? -1 : 1;
  stub(-broken * (W / 2 - t / 2), back, broken * (W / 2 - t / 2), back, hi, hi * 0.35);
  // One or two side walls from the back corners towards the street, falling away.
  const sides = rng.next() < 0.55 ? [-1, 1] : [-broken];
  for (const sd of sides) {
    const reach = D * rng.range(0.45, 0.85);
    stub(sd * (W / 2 - t / 2), back + t / 2, sd * (W / 2 - t / 2), back + reach, sd === -broken ? hi * 0.9 : hi * 0.6, 1.4);
  }
  // The heap: the whole lot and out over the sidewalk, short of the kerb and of the junction's controls.
  const front = Math.max(D / 2, sideLine + SS.spill);
  let mound = rectAt(0, (front - D / 2) / 2, W, front + D / 2);
  if (controls.some((c) => footprintsOverlap(rectFootprint(mound), c))) mound = rectAt(0, 0, W, D);
  solids.push(rectFootprint(mound));
  const moundFront = nx ? (mound.x + (nx * mound.w) / 2 - r.x) * nx : (mound.z + (nz * mound.d) / 2 - r.z) * nz;
  // Slabs: hinged on the back wall a storey or two up, their far edge down on the heap.
  const slabs: RuinData['slabs'] = [];
  const bars: RuinData['bars'] = [];
  const p3 = (u: number, v: number, y: number): P3 => ({ ...at(u, v), y });
  for (let k = 1; k < floors && slabs.length < 2; k++) {
    if (rng.next() < 0.35 && slabs.length) continue;
    const w = W * rng.range(0.3, 0.5);
    const u = rng.range(-W / 2 + w / 2 + 0.6, W / 2 - w / 2 - 0.6);
    const reach = Math.min(D * rng.range(0.4, 0.7), k * F * 1.6);
    const a = p3(u, back + t / 2 + 0.1, k * F - 0.2);
    const b = p3(u + rng.range(-1, 1), back + reach, rng.range(0.6, 1.4));
    slabs.push({ a, b, w });
    // Rebar out of its torn far edge.
    for (let i = 0; i < 5; i++) {
      const o = (i / 4 - 0.5) * w * 0.8;
      bars.push({ a: pointOn(a, b, 0.97, o, ax, az), b: { ...pointOn(a, b, 1.08 + rng.range(0, 0.06), o + rng.range(-0.2, 0.2), ax, az), y: b.y + rng.range(0.2, 0.8) }, r: 0.025, wood: false });
    }
  }
  // Joists sticking out of the back wall at the storey lines, rebar bent up off the stubs' tops.
  for (let k = 1; k < floors; k++) {
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const u = rng.range(-W / 2 + 1, W / 2 - 1);
      const len = rng.range(1, 3.2);
      bars.push({ a: p3(u, back + t / 2, k * F - 0.3), b: p3(u + rng.range(-0.3, 0.3), back + t / 2 + len, k * F - 0.3 - rng.range(0.2, 1.4)), r: 0.09, wood: true });
    }
  }
  for (const w of walls) {
    for (let i = 0; i < w.tops.length; i += 2) {
      if (rng.next() < 0.5) continue;
      const lx = -w.len / 2 + ((i + 0.5) * w.len) / w.tops.length;
      const c = Math.cos(w.yaw), s = -Math.sin(w.yaw);
      const a = { x: w.x + c * lx, y: w.tops[i] - 0.1, z: w.z + s * lx };
      bars.push({ a, b: { x: a.x + rng.range(-0.4, 0.4), y: a.y + rng.range(0.5, 1.1), z: a.z + rng.range(-0.4, 0.4) }, r: 0.02, wood: false });
    }
  }
  // The hoarding at the heap's foot, to one side, facing the street.
  const hw = Math.min(4.2, W * 0.4);
  const hu = (rng.next() < 0.5 ? -1 : 1) * (W / 2 - hw / 2 - 0.4);
  const hoarding = { ...at(hu, moundFront - 0.35), yaw: Math.atan2(nx, nz), w: hw };
  // Loose bricks on the sidewalk past the heap, short of the kerb.
  const props: StreetProp[] = [];
  const room = kerb - 0.6 - (moundFront + 0.7);
  if (room > 0.2) {
    for (let n = rng.int(SS.bricks[0], SS.bricks[1]); n > 0; n--) {
      props.push({ kind: 'rubble', ...at(rng.range(-W / 2 + 0.6, W / 2 - 0.6), moundFront + 0.7 + rng.range(0, room)), yaw: rng.range(0, Math.PI * 2) });
    }
  }
  const data: RuinData = { base, walls, slabs, bars, mound, front: { nx, nz }, hoarding };
  return { s: { kind: 'ruin', x: r.x, z: r.z, yaw: 0, footprints: solids, data: data as unknown as Record<string, unknown> }, solids, props };
}

/** A point `t` of the way from a to b, `o` across (along the lot's face), at that height. */
function pointOn(a: P3, b: P3, t: number, o: number, ax: number, az: number): P3 {
  return { x: a.x + (b.x - a.x) * t + ax * o, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t + az * o };
}

// --- The rail overpass ---

/** The overpass in its frame: X across the street, Z along it, origin on the ground at its middle. */
export interface OverpassData {
  half: number; // pier centres either side, across
  depth: number; // the deck along the street
  span: number; // the deck's length across
  bottom: number; // the girders' underside above the footing
  base: number; // footing (world)
}

/**
 * The rail overpass on the gate where the main street comes in (else any gate): riveted piers on
 * both sidewalks, set in from the wall line as far as it must be to keep them off the junction's
 * controls, the deck across road and sidewalks with its underside at least
 * DISTRICTS.overheadClearance (plus headroom) above the highest road under it.
 */
export function overpassAt(q: District, city: CityData): { s: Structure; solids: Footprint[]; overhead: Overhead; gate: Gate } | null {
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
  const gates = [...q.gates].sort((a, b) => Number(main.has(b.edge)) - Number(main.has(a.edge)));
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const half = rw / 2 + sw / 2;
  const depth = SS.overpassDepth;
  for (const g of gates) {
    const dx = Math.sin(g.yaw), dz = Math.cos(g.yaw); // into the district
    const ax = dz, az = -dx; // across (frame X)
    for (const setIn of SS.overpassSetIn) {
      const c = { x: g.x + dx * (setIn + depth / 2), z: g.z + dz * (setIn + depth / 2) };
      const at = (x: number, z: number) => ({ x: c.x + ax * x + dx * z, z: c.z + az * x + dz * z });
      const piers: Footprint[] = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ ...at(sx * half, sz * (depth / 2 - 0.7)), hx: SS.pier, hz: SS.pier, yaw: 0 })));
      if (piers.some((p) => controls.some((k) => footprintsOverlap(p, k)))) continue;
      const base = Math.min(...piers.map((p) => groundHeight(city.terrain, p.x, p.z))) - 0.05;
      const top = Math.max(...[-half - sw / 2, -half, 0, half, half + sw / 2].flatMap((x) => [-1, 1].map((z) => { const p = at(x, (z * depth) / 2); return groundHeight(city.terrain, p.x, p.z); })));
      const lift = top - base;
      const bottom = DISTRICTS.overheadClearance + SS.overpassHeadroom + lift;
      const data: OverpassData = { half, depth, span: rw + sw * 2 - 0.1, bottom, base };
      const s: Structure = { kind: 'overpass', ...c, yaw: g.yaw, footprints: piers, data: data as unknown as Record<string, unknown> };
      const overhead: Overhead = { kind: 'overpass', points: [at(-half - sw / 2, 0), at(half + sw / 2, 0)], bottom: bottom - lift };
      return { s, solids: piers, overhead, gate: g };
    }
  }
  return null;
}

// --- The junkyard ---

/** One wrecked car in a stack: centre on the ground plan, tier, which way it lies, paint, how flat. */
export interface Wreck {
  x: number;
  z: number;
  tier: number;
  alongX: boolean;
  yaw: number; // a little off square
  color: number;
  crush: number; // its height as a share of a whole car's
}

export const WRECK = { l: 4.3, w: 1.9, h: 1.05 }; // a crushed shell, before `crush`
const WRECK_SLOT = 4.6;
const WRECK_ROW = 2.25; // a column of stacks across
const FENCE_IN = 0.3; // the fence line inside the sidewalk line
const RUST = [0x8a4a2a, 0x6a5a4a, 0x5a6a7a, 0x7a2a22, 0x4a5a3a, 0x9a8a6a, 0x3a3e44, 0xa89a7a, 0x2a3a5a, 0x7a6a3a];

export interface JunkyardData {
  rowsAlongX: boolean;
  fence: { a: { x: number; z: number }; b: { x: number; z: number } }[]; // corrugated runs on the fence line
  height: number;
  sign?: { x: number; z: number; yaw: number }; // BEWARE OF DOG on the fence, facing out
}

export interface CraneData {
  pivot: P3; // the boom's foot (heights above the footing)
  tip: P3;
  magnet: number; // the magnet's bottom above the footing
}

export interface Junkyard {
  structures: Structure[]; // 'wreckStack' (data.wrecks), 'junkBand', 'magnetCrane', 'crusher', 'tyres', 'junkFence'
  solids: Footprint[];
  corridors: Rect[]; // drivable, block edge to block edge
  overhead: Overhead[]; // the crane's boom over a corridor
  rowsAlongX: boolean;
}

/**
 * A junkyard block: rows of wreck stacks along the axis with streets at both ends, corridors
 * between them (and between the rows and the bands along the fence) from street to street, and
 * one across the middle. The bands along the long fences hold the scrap heaps: a magnet crane
 * reaching over the first row, the crusher, tyre mountains; each half band one solid. Corrugated
 * fence on the fence line, open at every corridor mouth.
 */
export function junkyardLayout(k: number, city: CityData, rng: Rng): Junkyard {
  const block = city.blocks[k].rect;
  const s = streetSides(k, city);
  const rowsAlongX = s.px && s.nx ? true : s.pz && s.nz ? false : block.w >= block.d;
  const sw = city.config.sidewalk;
  const L = (rowsAlongX ? block.w : block.d) - sw * 2;
  const D = (rowsAlongX ? block.d : block.w) - sw * 2;
  const at = (u: number, v: number) => (rowsAlongX ? { x: block.x + u, z: block.z + v } : { x: block.x + v, z: block.z + u });
  const rect = (uc: number, vc: number, ul: number, vl: number): Rect => ({ ...at(uc, vc), w: rowsAlongX ? ul : vl, d: rowsAlongX ? vl : ul });
  const fpOf = (r: Rect): Footprint => ({ x: r.x, z: r.z, hx: r.w / 2, hz: r.d / 2, yaw: 0 });
  const C = SS.junkCorridor, X = SS.junkCross;
  const fu = L / 2 - FENCE_IN, fv = D / 2 - FENCE_IN; // the fence line
  const inU = fu - 0.6, inV = fv - 0.4; // inside it
  // Rows and how many stacks across each; fewer if the bands along the fence come out under 4.5 m.
  let wides: number[] = [];
  let band = 0;
  for (let rows = rng.int(SS.junkRows[0], SS.junkRows[1]); rows >= 1; rows--) {
    wides = Array.from({ length: rows }, () => rng.int(1, 2));
    for (;;) {
      band = (inV * 2 - wides.reduce((a, w) => a + w * WRECK_ROW, 0) - (rows + 1) * C) / 2;
      const two = wides.indexOf(2);
      if (band >= 4.5 || two < 0) break;
      wides[two] = 1;
    }
    if (band >= 4.5) break;
  }
  const out: Junkyard = { structures: [], solids: [], corridors: [], overhead: [], rowsAlongX };
  const half0 = X / 2 + 0.3, half1 = inU; // a half row's span along u
  const halfLen = half1 - half0;
  // Bands, corridors and rows across, from −v.
  let v = -inV;
  const bands = [v + band / 2, inV - band / 2];
  v += band;
  const rowCentres: number[] = [];
  const corridorV: number[] = [];
  for (const [r, wide] of wides.entries()) {
    corridorV.push(v + C / 2);
    v += C;
    const depth = wide * WRECK_ROW;
    rowCentres.push(v + depth / 2);
    for (const side of [-1, 1]) {
      const n = Math.floor(halfLen / WRECK_SLOT);
      const used = n * WRECK_SLOT;
      const uc = side * (half0 + halfLen / 2);
      const wrecks: Wreck[] = [];
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < wide; c++) {
          const p = at(uc - used / 2 + WRECK_SLOT * (i + 0.5), v + WRECK_ROW * (c + 0.5));
          const high = rng.int(SS.junkHigh[0], SS.junkHigh[1]);
          for (let tier = 0; tier < high; tier++) wrecks.push({ ...p, tier, alongX: rowsAlongX, yaw: rng.range(-0.08, 0.08), color: rng.pick(RUST), crush: rng.range(0.55, 0.9) });
        }
      }
      const fp = fpOf(rect(uc, v + depth / 2, used, depth));
      out.solids.push(fp);
      out.structures.push({ kind: 'wreckStack', x: fp.x, z: fp.z, yaw: 0, footprints: [fp], data: { wrecks, row: r } as unknown as Record<string, unknown> });
    }
    v += depth;
  }
  corridorV.push(v + C / 2);
  for (const vc of corridorV) out.corridors.push(rect(0, vc, L + sw * 2, C));
  out.corridors.push(rect(0, 0, X, D + sw * 2));
  // The bands: scrap heaps, each half one solid; the crane by the first row, the crusher, tyres.
  const craneSide = rng.next() < 0.5 ? -1 : 1;
  const tyreBand = rng.next() < 0.5 ? 0 : 1;
  for (const [b, vc] of bands.entries()) {
    for (const side of [-1, 1]) {
      const uc = side * (half0 + halfLen / 2);
      const fp = fpOf(rect(uc, vc, halfLen, band - 0.1));
      out.solids.push(fp);
      out.structures.push({ kind: 'junkBand', x: fp.x, z: fp.z, yaw: 0, footprints: [fp], data: { alongX: rowsAlongX, len: halfLen, depth: band - 0.1 } });
      if (b !== tyreBand && side === craneSide) {
        // The magnet crane: its tracks in the band, the boom reaching over the nearest row.
        const toward = b === 0 ? 1 : -1;
        const row = b === 0 ? 0 : rowCentres.length - 1;
        const cu = uc + side * rng.range(-halfLen / 4, halfLen / 4);
        const pivot = { ...at(cu, vc + toward * 0.6), y: 6.4 };
        const tip = { ...at(cu, rowCentres[row]), y: 12.5 };
        const near = vc + toward * (band / 2); // the corridor's near edge
        const t = Math.abs(near - (vc + toward * 0.6)) / Math.abs(rowCentres[row] - (vc + toward * 0.6));
        const lowest = pivot.y + (tip.y - pivot.y) * t - 0.45;
        const base = groundBase(city.terrain, fp.x, fp.z, Math.max(fp.hx, fp.hz)) - 0.05;
        const lift = Math.max(...[0, 0.5, 1].map((f) => { const p = at(cu, near + toward * C * f); return groundHeight(city.terrain, p.x, p.z); })) - base;
        const data: CraneData = { pivot, tip, magnet: 5.6 };
        out.structures.push({ kind: 'magnetCrane', ...at(cu, vc), yaw: 0, footprints: [], data: data as unknown as Record<string, unknown> });
        out.overhead.push({ kind: 'craneBoom', points: [at(cu, near), at(cu, near + toward * C)], bottom: lowest - lift });
      } else if (b !== tyreBand) {
        const cu = uc + side * rng.range(-halfLen / 5, halfLen / 5);
        out.structures.push({ kind: 'crusher', ...at(cu, vc), yaw: rowsAlongX ? 0 : Math.PI / 2, footprints: [], data: { len: Math.min(8, halfLen - 2), depth: Math.min(3.6, band - 0.8) } });
      } else {
        for (let n = rng.int(SS.tyreMountains[0], SS.tyreMountains[1]); n > 0; n--) {
          const r = Math.min(band / 2 - 0.2, rng.range(1.8, 2.6));
          out.structures.push({ kind: 'tyres', ...at(uc + rng.range(-halfLen / 2 + r, halfLen / 2 - r), vc), yaw: rng.range(0, Math.PI), footprints: [], data: { r, h: rng.range(1.6, 2.8) } });
        }
      }
    }
  }
  // The corrugated fence: along the long sides open at the cross corridor, across the ends open at every corridor.
  const fence: JunkyardData['fence'] = [];
  const run = (u0: number, v0: number, u1: number, v1: number) => {
    if (Math.hypot(u1 - u0, v1 - v0) < 0.4) return;
    fence.push({ a: at(u0, v0), b: at(u1, v1) });
    const along = Math.abs(u1 - u0) > Math.abs(v1 - v0);
    out.solids.push(fpOf(rect((u0 + u1) / 2, (v0 + v1) / 2, along ? Math.abs(u1 - u0) : 0.16, along ? 0.16 : Math.abs(v1 - v0))));
  };
  const gap = 0.06;
  for (const sv of [-1, 1]) {
    run(-fu, sv * fv, -X / 2 - gap, sv * fv);
    run(X / 2 + gap, sv * fv, fu, sv * fv);
  }
  const ends = [-fv, ...corridorV.flatMap((c) => [c - C / 2 - gap, c + C / 2 + gap]), fv];
  for (const su of [-1, 1]) for (let i = 0; i < ends.length; i += 2) run(su * fu, ends[i], su * fu, ends[i + 1]);
  // BEWARE OF DOG on an end, beside the first corridor's mouth, facing the street.
  const su = rng.next() < 0.5 ? -1 : 1;
  const signV = (ends[0] + ends[1]) / 2;
  const sign = ends[1] - ends[0] > 2 ? { ...at(su * (fu + 0.1), signV), yaw: rowsAlongX ? (su > 0 ? Math.PI / 2 : -Math.PI / 2) : su > 0 ? 0 : Math.PI } : undefined;
  const data: JunkyardData = { rowsAlongX, fence, height: SS.junkFence, sign };
  out.structures.push({ kind: 'junkFence', x: block.x, z: block.z, yaw: 0, footprints: [], data: data as unknown as Record<string, unknown> });
  return out;
}

// --- The tent camp ---

export type CampKind = 'dome' | 'ridge' | 'leanTo' | 'cardboard' | 'couch' | 'fireRing' | 'pallets' | 'cart' | 'tarpWall';

/** One piece of the camp: where, which way, its tint (and for a strung tarp, the far end). */
export interface CampPiece {
  kind: CampKind;
  x: number;
  z: number;
  yaw: number;
  color: number;
  scale: number;
}

const TENT = [0x2f5f9a, 0x3f7a4a, 0xd8762a, 0x7a8288, 0x8a6a3a, 0x5a4a7a, 0xb03a2e, 0x4a6a6a];
const TARP = [0x2f5f9a, 0x6a7a8a, 0x3a5a3a, 0x8a8a7a];
const CARDBOARD = [0xa88a5a, 0x9a7a4a, 0xb89a6a];

/**
 * The camp on its ground, `campGap` in from the lot all round: a ring of tarp walls, pallets,
 * cardboard and carts closing it off, tents and lean-tos inside, a couch, a cold fire ring. The
 * whole camp is one solid: nobody drives through it.
 */
export function campLayout(ground: Rect, rng: Rng): { s: Structure; solid: Footprint } {
  const r = shrink(ground, SS.campGap);
  const pieces: CampPiece[] = [];
  const x0 = r.x - r.w / 2, z0 = r.z - r.d / 2;
  // The ring: along each side, a piece every ~1.7 m, facing out.
  const ring: CampKind[] = ['tarpWall', 'tarpWall', 'pallets', 'cardboard', 'cart', 'tarpWall', 'pallets'];
  const edge = (len: number, place: (t: number) => { x: number; z: number; yaw: number }) => {
    const n = Math.max(1, Math.floor(len / 1.7));
    for (let i = 0; i < n; i++) {
      const p = place(-len / 2 + (len * (i + 0.5)) / n);
      const kind = rng.pick(ring);
      pieces.push({ kind, ...p, color: kind === 'cardboard' ? rng.pick(CARDBOARD) : rng.pick(TARP), scale: 1 });
    }
  };
  const e = 0.5;
  edge(r.w, (t) => ({ x: r.x + t, z: z0 + e, yaw: Math.PI }));
  edge(r.w, (t) => ({ x: r.x + t, z: r.z + r.d / 2 - e, yaw: 0 }));
  edge(r.d - 2 * e - 1, (t) => ({ x: x0 + e, z: r.z + t, yaw: -Math.PI / 2 }));
  edge(r.d - 2 * e - 1, (t) => ({ x: r.x + r.w / 2 - e, z: r.z + t, yaw: Math.PI / 2 }));
  // Inside: a grid of shelters with a clearing round the fire ring.
  const cell = 3.6;
  const nx = Math.max(1, Math.floor((r.w - 3) / cell)), nz = Math.max(1, Math.floor((r.d - 3) / cell));
  const fire = { i: rng.int(0, nx - 1), j: rng.int(0, nz - 1) };
  let couch = false;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = x0 + 1.5 + cell * (i + 0.5) + rng.range(-0.4, 0.4);
      const z = z0 + 1.5 + cell * (j + 0.5) + rng.range(-0.4, 0.4);
      if (i === fire.i && j === fire.j) {
        pieces.push({ kind: 'fireRing', x, z, yaw: 0, color: 0x5a5650, scale: 1 });
        continue;
      }
      if (Math.abs(i - fire.i) <= 1 && Math.abs(j - fire.j) <= 1 && !couch) {
        pieces.push({ kind: 'couch', x, z, yaw: Math.atan2(fire.i - i, fire.j - j), color: rng.pick([0x6a3a2a, 0x4a5a3a, 0x7a6a5a]), scale: 1 });
        couch = true;
        continue;
      }
      if (rng.next() > SS.campDensity) {
        if (rng.next() < 0.4) pieces.push({ kind: 'cardboard', x, z, yaw: rng.range(0, Math.PI * 2), color: rng.pick(CARDBOARD), scale: 1 });
        continue;
      }
      const roll = rng.next();
      const kind: CampKind = roll < 0.5 ? 'dome' : roll < 0.8 ? 'ridge' : 'leanTo';
      pieces.push({ kind, x, z, yaw: rng.range(0, Math.PI * 2), color: kind === 'leanTo' ? rng.pick(TARP) : rng.pick(TENT), scale: rng.range(0.85, 1.15) });
      if (kind === 'leanTo' && rng.next() < 0.5) pieces.push({ kind: 'cart', x: x + 1.2, z: z + 0.8, yaw: rng.range(0, Math.PI * 2), color: 0xb8bcc0, scale: 1 });
    }
  }
  const solid = rectFootprint(r);
  return { s: { kind: 'camp', x: r.x, z: r.z, yaw: 0, footprints: [solid], data: { pieces, w: r.w, d: r.d } as unknown as Record<string, unknown> }, solid };
}
