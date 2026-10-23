// The Slums: run-down blocks on the frayed edge just outside the centre. Brick walk-ups shoulder to
// shoulder, one or two vacant blocks gone to rubble (a bumpy shortcut behind torn chain-link), maybe
// a tent camp and a junkyard, a destroyed building or two, burnt-out shells, one corner store still
// open. Light traffic, no buses or trucks, fewer cops. Pure data; drawn by render/districts/Slums.ts.
import type { Rng } from '../../core/Rng';
import { SLUMS } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { propFootprint, type StreetProp } from '../StreetProps';
import { emptyDressing, type TrimKind, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook } from './District';
import { isJunctionControl } from './apply';
import { frontMask, streetSides } from './Harbor';
import { clearOf } from './HarborYard';
import { shuffle } from './place';
import { campLayout, junkyardLayout, overpassAt, ruinLayout } from './SlumsSet';
import { climateDressing, streetDressing } from './SlumsStreet';
import { footprintsOverlap } from '../StreetProps';

export type SlumsLot = 'tenement' | 'boarded' | 'gutted' | 'cornerStore' | 'squat';

/** A vacant block: its rubble lot (drivable and soft), and the camp's half when the camp is in it. */
export interface VacantLot {
  block: number;
  rect: Rect; // the rubble, inside the sidewalk line: drivable and soft
  camp?: Rect; // the tent camp's ground: solid, never drivable
  holes: { x: number; z: number; nx: number; nz: number }[]; // torn gaps in the chain-link, on street sides
}

/** The destroyed buildings: lots that front a street, their building taken down to stubs and rubble. */
export interface Ruin extends Rect {
  street: number; // the sides on a street (Building.street bits)
  block: number;
}

/** The ruins `lots` takes out of the buildings, until `dress` lays them out. */
const RUINS = new WeakMap<District, Ruin[]>();

export const vacantLots = (q: District) => (q.dressing.extra?.vacant ?? []) as VacantLot[];
export const ruinsOf = (q: District) => (q.dressing.extra?.ruins ?? []) as Ruin[];
export const roleBlocks = (q: District, role: BlockRole) => [...q.roles].filter(([, r]) => r === role).map(([k]) => k);

function roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole> {
  const out = new Map<number, BlockRole>();
  const rough = (k: number) => city.blocks[k].zone !== 'midtown';
  const pool = [...q.blocks];
  shuffle(pool, rng);
  // Rubble and junk go on the outer blocks first (residential, industrial), never more than half the district.
  pool.sort((a, b) => Number(rough(b)) - Number(rough(a)));
  const spare = Math.floor(q.blocks.length / 2);
  const vacant = Math.min(rng.int(SLUMS.vacant[0], SLUMS.vacant[1]), spare);
  for (const k of pool.slice(0, vacant)) out.set(k, 'vacant');
  // The camp takes one vacant block (all of it, or half).
  if (rng.next() < SLUMS.campChance) out.set(pool[0], 'camp');
  // The junkyard: an industrial block where there is one, a block with streets on two opposite sides.
  const big = q.blocks.length >= 9;
  if (out.size < spare && (big || rng.next() < SLUMS.junkyardChance)) {
    const through = (k: number) => { const s = streetSides(k, city); return (s.px && s.nx) || (s.pz && s.nz); };
    const left = pool.slice(vacant).filter(through);
    const yard = left.find((k) => city.blocks[k].zone === 'industrial') ?? left[0];
    if (yard !== undefined) out.set(yard, 'junkyard');
  }
  return out;
}

/** Does a building have street sides along both X and Z (a street corner)? */
const onCorner = (b: Building) => !!(b.street! & 3) && !!(b.street! & 12);

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  // At least three lots: a ruin, the corner store and a tenement (a split block if the lots came up short).
  if (buildings.length < 3) {
    const k = q.blocks.find((b) => !q.roles.has(b))!;
    const inner = shrink(city.blocks[k].rect, city.config.sidewalk);
    buildings.length = 0;
    for (let i = 0; i < 3; i++) {
      const w = inner.w / 3;
      buildings.push({ x: inner.x - inner.w / 2 + w * (i + 0.5), z: inner.z, w: w - 1, d: inner.d, h: 12, zone: city.blocks[k].zone, variant: rng.next(), district: 'slums' });
    }
  }
  for (const b of buildings) b.street = frontMask(b, q, city);
  const order = [...buildings];
  shuffle(order, rng);
  // The ruins: lots fronting a street, big enough to read as a fallen building.
  const blockOf = (b: Building) => q.blocks.find((k) => inRect(city.blocks[k].rect, b))!;
  const fit = order.filter((b) => b.street && b.w >= SLUMS.ruinMin && b.d >= SLUMS.ruinMin);
  const ruins = (fit.length ? fit : order).slice(0, Math.min(rng.int(SLUMS.ruins[0], SLUMS.ruins[1]), buildings.length - 2));
  RUINS.set(q, ruins.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, street: b.street!, block: blockOf(b) })));
  for (const r of ruins) buildings.splice(buildings.indexOf(r), 1);
  const rest = order.filter((b) => !ruins.includes(b));
  // Exactly one corner store, on a corner where it can.
  const store = rest.find(onCorner) ?? rest.find((b) => b.street) ?? rest[0];
  store.lot = 'cornerStore';
  const others = rest.filter((b) => b !== store);
  // One to three burnt-out shells; then boarded shop rows and squats; the rest are tenements.
  const gutted = Math.min(rng.int(SLUMS.gutted[0], SLUMS.gutted[1]), others.length);
  others.forEach((b, i) => {
    if (i < gutted) b.lot = 'gutted';
    else {
      const roll = rng.next();
      b.lot = roll < SLUMS.boardedShare && b.street ? 'boarded' : roll < SLUMS.boardedShare + SLUMS.squatShare ? 'squat' : 'tenement';
    }
  });
}

/** Street furniture that doesn't belong (junction controls, hydrants and bus stops stay). */
const DROP_SIGNS = new Set(['noSmoking', 'children', 'pedestrian', 'noParking']);
const drop = (p: StreetProp) => p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'sign' && DROP_SIGNS.has(p.variant ?? ''));

/** Grimy brick walk-ups over shut shops; burnt-out shells open to the sky; squats under a tarp. */
function SLUMS_LOOKS(): Record<SlumsLot, LotLook> {
  const brick = [0x8a5a48, 0x7a4e40, 0x6e5a50, 0x8a6a58, 0x5e4a42];
  const soot = [0x6a5a52, 0x5a4e48, 0x625650];
  const walkUp: TrimKind[] = ['brokenParapet', 'fireEscape', 'roofJunk'];
  return {
    tenement: { facade: 'tenement', ground: 'boarded', roof: 'flat', palette: brick, trims: walkUp },
    boarded: { facade: 'tenement', ground: 'boarded', roof: 'flat', palette: brick, trims: ['brokenParapet', 'roofJunk'] },
    gutted: { facade: 'charred', roof: 'open', palette: soot },
    cornerStore: { facade: 'tenement', ground: 'boarded', roof: 'flat', palette: brick, trims: ['brokenParapet', 'roofJunk'] },
    squat: { facade: 'tenement', roof: 'flat', palette: brick, trims: ['brokenParapet', 'tarp'] },
  };
}

const SLUMS_STYLE = { lots: [2, 4] as [number, number], height: [9, 18] as [number, number], gap: [0, 2] as [number, number], empty: 0.15 };

export const SLUMS_DEF: DistrictDef = {
  kind: 'slums',
  label: 'Slums',
  salt: 0x51a3b7,
  chance: SLUMS.chance,
  site: 'inland',
  shapes: [[2, 2], [2, 3], [3, 3], [3, 4]],
  rings: ['midtown', 'residential', 'industrial'],
  minShare: { 'residential+industrial': 0.5 },
  gates: 'all',
  buildingStyle: SLUMS_STYLE,
  looks: SLUMS_LOOKS(),
  roles,
  lots,
  drop,
  swap: { lamp: 'brokenLamp' },
  keepZebras: false,
  traffic: { density: SLUMS.density, heavy: false, weights: { Pickup: SLUMS.pickupWeight, Van: SLUMS.vanWeight } },
  copSpawnSkip: SLUMS.copSpawnSkip,
  softGround: { grip: SLUMS.rubbleGrip, drag: SLUMS.rubbleDrag },
  roadblockGates: true,
  mapColor: 0x8a4a2a,
  dress,
};

/**
 * A vacant block: rubble inside the sidewalk line, weeds, chain-link round it torn open on the
 * sides that face a street. With the camp in it, the camp takes all of it or the half away from
 * the most streets, and only the rest is rubble.
 */
function vacantLot(k: number, camp: boolean, city: CityData, rng: Rng): VacantLot {
  const block = city.blocks[k].rect;
  const inner = shrink(block, city.config.sidewalk);
  const s = streetSides(k, city);
  if (!camp) return { block: k, rect: inner, holes: holes(inner, s) };
  if (rng.next() < 0.4) return { block: k, rect: { ...inner, w: 0, d: 0 }, camp: inner, holes: [] };
  // Split along the long side; the camp takes the half with fewer street sides.
  const alongX = inner.w >= inner.d;
  const halves = [-1, 1].map((side) => (alongX
    ? { x: inner.x + (side * inner.w) / 4, z: inner.z, w: inner.w / 2, d: inner.d }
    : { x: inner.x, z: inner.z + (side * inner.d) / 4, w: inner.w, d: inner.d / 2 }));
  const streets = (side: number) => (alongX ? (side < 0 ? s.nx : s.px) : side < 0 ? s.nz : s.pz) ? 1 : 0;
  const campAt = streets(-1) <= streets(1) ? 0 : 1;
  const rect = halves[1 - campAt];
  const open = alongX ? { ...s, [campAt ? 'px' : 'nx']: false } : { ...s, [campAt ? 'pz' : 'nz']: false };
  return { block: k, rect, camp: halves[campAt], holes: holes(rect, open) };
}

/** The torn gaps in a rubble lot's fence: the middle of each side facing a street. */
function holes(r: Rect, s: { px: boolean; nx: boolean; pz: boolean; nz: boolean }): VacantLot['holes'] {
  const i = SLUMS.fenceInset;
  const out: VacantLot['holes'] = [];
  if (s.px) out.push({ x: r.x + r.w / 2 - i, z: r.z, nx: 1, nz: 0 });
  if (s.nx) out.push({ x: r.x - r.w / 2 + i, z: r.z, nx: -1, nz: 0 });
  if (s.pz) out.push({ x: r.x, z: r.z + r.d / 2 - i, nx: 0, nz: 1 });
  if (s.nz) out.push({ x: r.x, z: r.z - r.d / 2 + i, nx: 0, nz: -1 });
  return out;
}

/** Chain-link panels round a rubble lot, the torn holes left open. */
function chainLink(v: VacantLot): StreetProp[] {
  const r = v.rect;
  const i = SLUMS.fenceInset;
  const panel = 2.9;
  const x0 = r.x - r.w / 2 + i, x1 = r.x + r.w / 2 - i, z0 = r.z - r.d / 2 + i, z1 = r.z + r.d / 2 - i;
  const sides = [
    { nx: 0, nz: -1, fixed: z0, lo: x0, hi: x1 },
    { nx: 0, nz: 1, fixed: z1, lo: x0, hi: x1 },
    { nx: -1, nz: 0, fixed: x0, lo: z0, hi: z1 },
    { nx: 1, nz: 0, fixed: x1, lo: z0, hi: z1 },
  ];
  const out: StreetProp[] = [];
  for (const s of sides) {
    // The camp's side stays open to the camp (its tents close it off).
    if (v.camp && (s.nx ? Math.abs(s.fixed - (v.camp.x + (s.nx * -v.camp.w) / 2)) < 1 : Math.abs(s.fixed - (v.camp.z + (s.nz * -v.camp.d) / 2)) < 1)) continue;
    const hole = v.holes.find((h) => h.nx === s.nx && h.nz === s.nz);
    const mid = hole ? (s.nx ? hole.z : hole.x) : 0;
    const runs: [number, number][] = hole ? [[s.lo, mid - SLUMS.fenceHole / 2], [mid + SLUMS.fenceHole / 2, s.hi]] : [[s.lo, s.hi]];
    for (const [a, b] of runs) {
      const n = Math.floor((b - a) / panel);
      const pad = (b - a - n * panel) / 2;
      for (let k = 0; k < n; k++) {
        const t = a + pad + panel * (k + 0.5);
        out.push({ kind: 'fence', style: 'chainlink', x: s.nx ? s.fixed : t, z: s.nx ? t : s.fixed, yaw: s.nx ? Math.PI / 2 : 0 });
      }
    }
  }
  return out;
}

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  out.soft = [];
  // Vacant blocks: rubble, weeds and torn chain-link; the rubble is a bumpy shortcut.
  const vacant = [...q.roles].filter(([, r]) => r === 'vacant' || r === 'camp').map(([k, r]) => vacantLot(k, r === 'camp', city, rng));
  const props: StreetProp[] = [];
  for (const v of vacant) {
    if (v.camp) out.ground.push({ kind: 'campGround', ...v.camp });
    if (!v.rect.w) continue;
    out.ground.push({ kind: 'rubble', ...v.rect });
    out.drivable.push(v.rect);
    out.soft.push(v.rect);
    for (let n = rng.int(SLUMS.weeds[0], SLUMS.weeds[1]); n > 0; n--) {
      const w = rng.range(2, 6), d = rng.range(2, 6);
      out.ground.push({ kind: 'weeds', x: v.rect.x + rng.range(-1, 1) * (v.rect.w / 2 - w / 2 - 1), z: v.rect.z + rng.range(-1, 1) * (v.rect.d / 2 - d / 2 - 1), w, d, yaw: 0 });
    }
    props.push(...chainLink(v));
  }
  // Nothing of the city's own stands in a vacant lot or the camp (street props stay on the sidewalks).
  const lots = vacant.flatMap((v) => [v.rect, ...(v.camp ? [v.camp] : [])]).filter((r) => r.w > 0);
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !lots.some((r) => inRect(r, p)));
  // The fence keeps clear of the city's props round the lot and of its own panels at the corners.
  const kept = clearOf(props, [], city.streetProps.filter((p) => inRect(q.bounds, p, 2)).map((p) => propFootprint(p)));
  const ruins = RUINS.get(q) ?? [];
  const controls = city.streetProps.filter((p) => inRect(q.bounds, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const extra: StreetProp[] = [];
  // The destroyed buildings: stubs and heap solid, loose bricks on the sidewalk.
  for (const r of ruins) {
    out.ground.push({ kind: 'ruinLot', x: r.x, z: r.z, w: r.w, d: r.d });
    const ruin = ruinLayout(r, city, controls, rng);
    out.structures.push(ruin.s);
    out.solids.push(...ruin.solids);
    extra.push(...ruin.props);
  }
  // The rail overpass on the main-street gate.
  const over = overpassAt(q, city);
  if (over) {
    out.structures.push(over.s);
    out.solids.push(...over.solids);
    out.overhead.push(over.overhead);
  }
  // The junkyard: wreck rows, corridors street to street, scrap bands, fence.
  for (const k of roleBlocks(q, 'junkyard')) {
    const y = junkyardLayout(k, city, rng);
    out.structures.push(...y.structures);
    out.solids.push(...y.solids);
    out.drivable.push(...y.corridors);
    out.overhead.push(...y.overhead);
    out.ground.push({ kind: 'junkGround', ...shrink(city.blocks[k].rect, city.config.sidewalk) });
    const inner = shrink(city.blocks[k].rect, city.config.sidewalk);
    city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !inRect(inner, p));
  }
  // The tent camp: one solid.
  for (const v of vacant) {
    if (!v.camp) continue;
    const camp = campLayout(v.camp, rng);
    out.structures.push(camp.s);
    out.solids.push(camp.solid);
  }
  // The city's own props off the solids (never junction controls); the bricks clear of everything.
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !inRect(q.bounds, p) || !out.solids.some((s) => footprintsOverlap(propFootprint(p), s)));
  const bricks = clearOf(extra, [...out.solids, ...controls], [...kept, ...city.streetProps.filter((p) => inRect(q.bounds, p, 2))].map((p) => propFootprint(p, 0.1)));
  out.props = [...kept, ...bricks];
  out.extra = { vacant, ruins };
  // The streets: junk, wrecks, lamps, graffiti, wires and laundry, worn roads (last on the stream).
  streetDressing(q, city, out, rng);
  // What each climate adds or weathers, chosen per run.
  out.extra = { ...out.extra, byClimate: climateDressing(q, city, rng) };
  return out;
}
