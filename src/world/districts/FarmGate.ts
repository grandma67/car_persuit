// The Farm's set pieces: the ranch gate over the main street where it comes in from town (log posts
// on the sidewalks, a crossbeam and a hanging sign, wagon wheels, a mailbox), cattle grids on the
// other gates, the silos, grain bins, windmill and water tower in the farmyard, and split-rail
// fences round the fields with gates facing the streets. Pure data; drawn by render/districts/Farm.ts.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, FARM_GATE as FG } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { LANDMARK_RADIUS, type Landmark, type LandmarkKind } from '../Landmarks';
import { shrink } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type StreetProp } from '../StreetProps';
import { groundBase, groundHeight } from '../Terrain';
import { inDistrict, isJunctionControl } from './apply';
import type { District, Gate, GroundPatch, Overhead, Structure } from './District';

/** Made-up farm names for the ranch gate's sign (never a real brand). */
export const FARM_NAMES = ['Hollow Creek Farm', 'Willow Bend Ranch', 'Cedar Ridge Farm', 'Maple Hollow Farm', 'Two Oaks Ranch', 'Red Gate Acres', 'Sunny Meadow Farm', 'Juniper Flats'];

/** The ranch gate in its frame: X across the street, Z into the district, origin on the ground at its middle. */
export interface RanchGateData {
  half: number; // post centres either side, across
  base: number; // footing height (world)
  beam: number; // crossbeam underside above the footing
  sign: { w: number; h: number; bottom: number }; // the hanging board, its bottom above the footing
  name: number; // index into FARM_NAMES
}

/** A gate's frame: into the district (dx, dz) and across it (ax, az), and a point in it. */
function frame(g: Gate) {
  const dx = Math.sin(g.yaw), dz = Math.cos(g.yaw);
  const ax = dz, az = -dx;
  return { dx, dz, ax, az, at: (c: { x: number; z: number }, x: number, z: number) => ({ x: c.x + ax * x + dx * z, z: c.z + az * x + dz * z }) };
}

/** The highest ground across a gate's opening, from `c`, ±`half` across. */
function topAcross(city: CityData, g: Gate, c: { x: number; z: number }, half: number): number {
  const f = frame(g);
  return Math.max(...[-1, -0.5, 0, 0.5, 1].map((u) => { const p = f.at(c, u * half, 0); return groundHeight(city.terrain, p.x, p.z); }));
}

/**
 * The ranch gate: its posts on the sidewalks either side of the street, set in from the wall line as
 * far as it must be to keep them off the junction's controls. Its sign and crossbeam stay at least
 * DISTRICTS.overheadClearance above the highest road under them.
 */
export function ranchGateAt(q: District, city: CityData, g: Gate, rng: Rng): { s: Structure; solids: Footprint[]; overhead: Overhead; props: StreetProp[] } | null {
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const f = frame(g);
  const half = rw / 2 + sw / 2;
  const name = rng.int(0, FARM_NAMES.length - 1);
  for (const setIn of FG.setIn) {
    const c = { x: g.x + f.dx * setIn, z: g.z + f.dz * setIn };
    const posts: Footprint[] = [-1, 1].map((sx) => ({ ...f.at(c, sx * half, 0), hx: FG.post, hz: FG.post, yaw: 0 }));
    if (posts.some((p) => controls.some((k) => footprintsOverlap(p, k)))) continue;
    const base = Math.min(...posts.map((p) => groundBase(city.terrain, p.x, p.z, FG.post))) - 0.05;
    const lift = topAcross(city, g, c, half) - base; // the road's highest point above the footing
    const signBottom = DISTRICTS.overheadClearance + FG.headroom + lift;
    const beam = signBottom + FG.signHeight + FG.chain;
    const data: RanchGateData = { half, base, beam, sign: { w: FG.signWidth, h: FG.signHeight, bottom: signBottom }, name };
    const s: Structure = { kind: 'ranchGate', ...c, yaw: g.yaw, footprints: posts, data: data as unknown as Record<string, unknown> };
    const overhead: Overhead = { kind: 'ranchSign', points: [f.at(c, -half, 0), f.at(c, half, 0)], bottom: signBottom - lift };
    // A mailbox on its post by the right-hand post, on the sidewalk, facing the road.
    const mb = f.at(c, half, FG.mailboxOut);
    const props: StreetProp[] = [{ kind: 'mailbox', ...mb, yaw: g.yaw + Math.PI / 2 }];
    return { s, solids: posts, overhead, props };
  }
  return null;
}

/**
 * A cattle grid across the street on a gate's wall line (steel bars over a pit, flush), and short
 * white fence wings across the sidewalks either side. Nothing overhead.
 */
export function cattleGrid(city: CityData, g: Gate): { ground: GroundPatch; props: StreetProp[] } {
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const f = frame(g);
  const c = { x: g.x - f.dx * sw / 2, z: g.z - f.dz * sw / 2 }; // over the perimeter street's sidewalk line
  const alongX = Math.abs(f.dx) > 0.5; // the street runs along X
  const ground: GroundPatch = { kind: 'cattleGrid', x: c.x, z: c.z, w: alongX ? FG.gridDepth : rw, d: alongX ? rw : FG.gridDepth };
  // Wings: a fence panel across each sidewalk, just inside the wall line.
  const props: StreetProp[] = [-1, 1].map((sx) => ({ kind: 'fence', ...f.at(g, sx * (rw / 2 + sw / 2), 0.4), yaw: alongX ? Math.PI / 2 : 0 }));
  return { ground, props };
}

/** A solid farm piece's footprint radius (its collider box is 0.8 of it, as for every plain landmark). */
const radius = (kind: LandmarkKind) => LANDMARK_RADIUS[kind];

/**
 * The farmyard's tall pieces in the gaps between its buildings: 1–3 silos in a row, 2–4 grain bins
 * in a row, a windmill and at most one water tower, each clear of the buildings and of each other
 * and inside the sidewalk line. A piece that won't fit in the yard tries the field corners next to
 * it (fields are open ground). Silos are concrete or blue steel per farm.
 */
export function yardPieces(yard: Rect, fields: Rect[], buildings: Building[], rng: Rng): Landmark[] {
  const out: Landmark[] = [];
  const taken: Footprint[] = buildings.map((b) => rectFootprint({ ...b, w: b.w + FG.pieceGap * 2, d: b.d + FG.pieceGap * 2 }));
  const fits = (fp: Footprint, area: Rect) =>
    Math.abs(fp.x - area.x) + fp.hx <= area.w / 2 && Math.abs(fp.z - area.z) + fp.hz <= area.d / 2 && !taken.some((t) => footprintsOverlap(fp, t));
  const steel = rng.next() < 0.5 ? 1 : 0;
  /** A row of `n` pieces (fewer if it won't fit), at random spots in the yard, then the field corners. */
  const row = (kind: LandmarkKind, n: number, min: number) => {
    const r = radius(kind);
    const spacing = r * 2 + FG.rowGap;
    const areas = [shrink(yard, 1), ...fields.map((f) => shrink(f, 1))];
    for (let want = n; want >= min; want--) {
      for (const [i, area] of areas.entries()) {
        for (let attempt = 0; attempt < (i === 0 ? 60 : 12); attempt++) {
          const alongX = rng.next() < 0.5;
          const len = (want - 1) * spacing;
          // Fields: tuck the row into a corner, out of the middle.
          const cx = i === 0 ? rng.range(area.x - area.w / 2, area.x + area.w / 2) : area.x + (rng.next() < 0.5 ? -1 : 1) * (area.w / 2 - r - (alongX ? len / 2 : 0) - 0.5);
          const cz = i === 0 ? rng.range(area.z - area.d / 2, area.z + area.d / 2) : area.z + (rng.next() < 0.5 ? -1 : 1) * (area.d / 2 - r - (alongX ? 0 : len / 2) - 0.5);
          const whole: Footprint = { x: cx, z: cz, hx: r + (alongX ? len / 2 : 0), hz: r + (alongX ? 0 : len / 2), yaw: 0 };
          if (!fits(whole, area)) continue;
          for (let k = 0; k < want; k++) {
            const u = -len / 2 + k * spacing;
            out.push({ kind, x: cx + (alongX ? u : 0), z: cz + (alongX ? 0 : u), yaw: rng.range(0, Math.PI * 2), radius: r, variant: kind === 'silo' ? steel : undefined });
          }
          taken.push({ ...whole, hx: whole.hx + FG.pieceGap, hz: whole.hz + FG.pieceGap });
          return;
        }
      }
    }
  };
  row('silo', rng.int(FG.silos[0], FG.silos[1]), 1);
  row('grainBin', rng.int(FG.bins[0], FG.bins[1]), 2);
  row('windmill', 1, 1);
  if (rng.next() < FG.waterTowerChance) row('waterTower', 1, 1);
  return out;
}

/**
 * Split-rail fences round a field, on the field side of the sidewalk line, with a gate in the
 * middle of every side facing an interior street (in line with the gate across the street), and on
 * a side facing the perimeter when there would otherwise be fewer than two.
 */
export function fieldFence(field: Rect, block: Rect, q: District, city: CityData): { props: StreetProp[]; gaps: { x: number; z: number; nx: number; nz: number }[] } {
  const props: StreetProp[] = [];
  const gaps: { x: number; z: number; nx: number; nz: number }[] = [];
  const inset = FG.fenceInset;
  const x0 = field.x - field.w / 2 + inset, x1 = field.x + field.w / 2 - inset;
  const z0 = field.z - field.d / 2 + inset, z1 = field.z + field.d / 2 - inset;
  const sides = [
    { nx: 0, nz: -1, fixed: z0, lo: x0, hi: x1 },
    { nx: 0, nz: 1, fixed: z1, lo: x0, hi: x1 },
    { nx: -1, nz: 0, fixed: x0, lo: z0, hi: z1 },
    { nx: 1, nz: 0, fixed: x1, lo: z0, hi: z1 },
  ];
  // What lies across the sidewalk from a side's middle: a road (a street) or not (a plaza, the edge).
  const sw = city.config.sidewalk;
  const beyond = (s: (typeof sides)[number]) => {
    const mid = (s.lo + s.hi) / 2;
    const d = sw + inset + 2;
    return s.nx ? { x: s.fixed + s.nx * d, z: mid } : { x: mid, z: s.fixed + s.nz * d };
  };
  const onRoad = (p: { x: number; z: number }) => city.roads.some((r) => Math.abs(p.x - r.rect.x) <= r.rect.w / 2 && Math.abs(p.z - r.rect.z) <= r.rect.d / 2);
  // A side faces an interior street when the block beyond the road is in the district.
  const inner = (s: (typeof sides)[number]) => {
    const p = { x: block.x + s.nx * (block.w / 2 + city.config.roadWidth + 1), z: block.z + s.nz * (block.d / 2 + city.config.roadWidth + 1) };
    return q.blocks.some((k) => { const r = city.blocks[k].rect; return Math.abs(p.x - r.x) <= r.w / 2 && Math.abs(p.z - r.z) <= r.d / 2; });
  };
  const street = sides.map((s) => onRoad(beyond(s)));
  const open = sides.map((s, k) => street[k] && inner(s));
  // Too few: the perimeter streets too, then anything (a plaza's paving is a way out as well).
  for (let k = 0; open.filter(Boolean).length < 2 && k < sides.length; k++) if (street[k]) open[k] = true;
  for (let k = 0; open.filter(Boolean).length < 2 && k < sides.length; k++) open[k] = true;
  sides.forEach((s, k) => {
    const mid = (s.lo + s.hi) / 2;
    const gap = open[k] ? [mid - FG.fieldGate / 2, mid + FG.fieldGate / 2] : null;
    if (gap) gaps.push(s.nx ? { x: s.fixed, z: mid, nx: s.nx, nz: 0 } : { x: mid, z: s.fixed, nx: 0, nz: s.nz });
    const runs: [number, number][] = gap ? [[s.lo, gap[0]], [gap[1], s.hi]] : [[s.lo, s.hi]];
    for (const [a, b] of runs) {
      const n = Math.floor((b - a) / FG.railLength);
      const pad = (b - a - n * FG.railLength) / 2;
      for (let i = 0; i < n; i++) {
        const t = a + pad + FG.railLength * (i + 0.5);
        props.push({ kind: 'fence', style: 'rail', x: s.nx ? s.fixed : t, z: s.nx ? t : s.fixed, yaw: s.nx ? Math.PI / 2 : 0 });
      }
    }
  });
  return { props, gaps };
}
