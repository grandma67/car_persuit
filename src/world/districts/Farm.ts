// The Farm: fields and one farmyard on the island's edge. The farmyard is the block by the ranch
// gate (farmhouse, barn, machine shed, granary, henhouse); every other block is a field of corn,
// wheat, pumpkins, an orchard or hay, drivable and soft. Light traffic, pickups and tractors.
// Pure data; drawn by render/districts/Farm.ts.
import type { Rng } from '../../core/Rng';
import { FARM } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type PropKind, type StreetProp } from '../StreetProps';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type Gate, type LotLook } from './District';
import { inDistrict, isJunctionControl, kerbClutter } from './apply';
import { cattleGrid, fieldFence, ranchGateAt, yardPieces } from './FarmGate';
import { cornMaze, dressFields, gapLane, gapMouth, put, yardClutter, type FenceGap } from './FarmFields';
import { clearOf } from './HarborYard';
import { shuffle } from './place';
import { frontMask } from './Harbor';

export type FarmLot = 'farmhouse' | 'barn' | 'machineShed' | 'granary' | 'henhouse';
export type Crop = 'corn' | 'wheat' | 'pumpkin' | 'orchard' | 'hay';
export const CROPS: Crop[] = ['corn', 'wheat', 'pumpkin', 'orchard', 'hay'];

/** A field: its block, crop, the area inside the sidewalk line, and which way its rows run. */
export interface Field {
  block: number;
  crop: Crop;
  rect: Rect; // inside the sidewalk line: drivable and soft
  rowsAlongX: boolean;
  maze?: Rect[]; // a corn maze's paths
}

/** The most fields of one crop: twice, unless the farm has more fields than that allows. */
export const cropCap = (fields: number) => Math.max(2, Math.ceil(fields / CROPS.length));

/** Does a gate lead in along the main street? */
const onMainStreet = (q: District, g: Gate) => {
  const [a, b] = g.edge.split('>');
  return q.mainStreet.includes(g.edge) || q.mainStreet.includes(`${b}>${a}`);
};

/** The ranch gate: the main-street gate nearest the island's centre (the way in from town). */
export function ranchGate(q: District): Gate {
  const main = q.gates.filter((g) => onMainStreet(q, g));
  const pool = main.length ? main : q.gates;
  return pool.reduce((a, b) => (Math.hypot(b.x, b.z) < Math.hypot(a.x, a.z) ? b : a));
}

/** The farmyard's block: the one block that isn't a field. */
export const farmyardBlock = (q: District) => q.blocks.find((k) => !q.roles.has(k))!;

/** The fields, as dressed. */
export const farmFields = (q: District) => (q.dressing.extra?.fields ?? []) as Field[];

/** The gaps in each field's fence (by block), with the outward normal of the side they're on. */
export const fenceGaps = (q: District) => (q.dressing.extra?.gaps ?? {}) as Record<number, FenceGap[]>;

/** Kerb clutter along the farm's streets. */
const CLUTTER: PropKind[] = ['haybale', 'haybale', 'barrels', 'milkChurn', 'pumpkin', 'crates'];

/** Does the main street run along X? */
function mainAlongX(q: District, city: CityData): boolean {
  const [a, b] = q.mainStreet[0].split('>').map(Number);
  return Math.abs(city.graph.nodes[a].z - city.graph.nodes[b].z) < 0.5;
}

function roles(q: District, city: CityData): Map<number, BlockRole> {
  // The farmyard is the block nearest the ranch gate; every other block is a field.
  const g = ranchGate(q);
  const d = (k: number) => Math.hypot(city.blocks[k].rect.x - g.x, city.blocks[k].rect.z - g.z);
  const yard = q.blocks.reduce((a, b) => (d(b) < d(a) ? b : a));
  return new Map(q.blocks.filter((k) => k !== yard).map((k) => [k, 'field' as BlockRole]));
}

/** Shrink a building about its centre so its long side is at most `long` and its short side `short`. */
function clampSize(b: Building, [long, short]: [number, number]): void {
  const [lw, ld] = b.w >= b.d ? [long, short] : [short, long];
  b.w = Math.min(b.w, lw);
  b.d = Math.min(b.d, ld);
}

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  // A farm always has a farmhouse and a barn: with fewer than two lots built, the farmyard is
  // split in two along its long side.
  const k = farmyardBlock(q);
  const block = city.blocks[k];
  if (buildings.length < 2) {
    buildings.length = 0;
    const inner = shrink(block.rect, city.config.sidewalk);
    const alongX = inner.w >= inner.d;
    for (const side of [-1, 1]) {
      const lot: Rect = alongX
        ? { x: inner.x + (side * inner.w) / 4, z: inner.z, w: inner.w / 2, d: inner.d }
        : { x: inner.x, z: inner.z + (side * inner.d) / 4, w: inner.w, d: inner.d / 2 };
      const fp = shrink(lot, rng.range(FARM_STYLE.gap[0], FARM_STYLE.gap[1]));
      buildings.push({ ...fp, h: 6, zone: block.zone, variant: rng.next(), district: 'farm' });
    }
  }
  // The biggest lot is the barn, another the farmhouse; the rest are, in turn, the machine shed,
  // the granary and the henhouse.
  const order = [...buildings];
  shuffle(order, rng);
  const barn = order.reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a));
  const rest = order.filter((b) => b !== barn);
  const kinds: FarmLot[] = ['farmhouse', 'machineShed', 'granary', 'henhouse'];
  barn.lot = 'barn';
  rest.forEach((b, i) => (b.lot = kinds[i] ?? 'machineShed'));
  for (const b of buildings) {
    clampSize(b, FARM.lotSize[b.lot!]);
    const range = b.lot === 'barn' ? FARM.barnHeight : b.lot === 'farmhouse' ? FARM.farmhouseHeight : b.lot === 'machineShed' ? null : FARM.lowHeight;
    if (range) b.h = Math.round(rng.range(range[0], range[1]) * 10) / 10;
  }
  // A granary and a henhouse the lots didn't make go in free corners of the yard.
  const inner = shrink(block.rect, city.config.sidewalk);
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  shuffle(corners, rng);
  for (const lot of ['granary', 'henhouse'] as FarmLot[]) {
    if (buildings.some((b) => b.lot === lot)) continue;
    const [long, short] = FARM.lotSize[lot];
    const [w, d] = rng.next() < 0.5 ? [long, short] : [short, long];
    for (const [sx, sz] of corners) {
      const b: Building = {
        x: inner.x + sx * (inner.w / 2 - FARM.cornerInset - w / 2), z: inner.z + sz * (inner.d / 2 - FARM.cornerInset - d / 2), w, d,
        h: Math.round(rng.range(FARM.lowHeight[0], FARM.lowHeight[1]) * 10) / 10, zone: block.zone, variant: rng.next(), district: 'farm', lot,
      };
      const gap = FARM.yardGap;
      if (buildings.some((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + gap && Math.abs(o.z - b.z) < (o.d + b.d) / 2 + gap)) continue;
      buildings.push(b);
      break;
    }
  }
  for (const b of buildings) b.street = frontMask(b, q, city, 16);
  // The machine shed stands open on the side facing the middle of the yard.
  for (const b of buildings) {
    if (b.lot !== 'machineShed') continue;
    const dx = inner.x - b.x, dz = inner.z - b.z;
    b.open = Math.abs(dx) * b.d > Math.abs(dz) * b.w ? (dx > 0 ? 4 : 8) : dz > 0 ? 1 : 2;
  }
}

/** The field blocks, each with its crop: at least one corn, none more than `cropCap`. */
function plantFields(q: District, city: CityData, rng: Rng): Field[] {
  const blocks = [...q.roles].filter(([, r]) => r === 'field').map(([k]) => k);
  const cap = cropCap(blocks.length);
  const bag: Crop[] = CROPS.flatMap((c) => Array.from({ length: c === 'corn' ? cap - 1 : cap }, () => c));
  shuffle(bag, rng);
  const crops = ['corn' as Crop, ...bag.slice(0, blocks.length - 1)];
  shuffle(crops, rng);
  const along = mainAlongX(q, city);
  return blocks.map((block, i) => {
    const rect = shrink(city.blocks[block].rect, city.config.sidewalk);
    const rowsAlongX = Math.abs(rect.w - rect.d) < 0.5 ? along : rect.w > rect.d;
    return { block, crop: crops[i], rect, rowsAlongX };
  });
}

/** Street furniture that doesn't suit the country (junction controls and bus stops stay). */
const DROP_SIGNS = new Set(['noSmoking', 'children', 'pedestrian', 'noParking']);
const drop = (p: StreetProp) =>
  p.kind === 'hydrant' || p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'sign' && DROP_SIGNS.has(p.variant ?? ''));

/**
 * Board-and-batten barns in red with white trim (the paint is in the boards' texture, so the
 * palettes are near-white shades), a white or pale yellow farmhouse, a steel machine shed.
 */
function FARM_LOOKS(): Record<FarmLot, LotLook> {
  const shades = [0xffffff, 0xf2ece6, 0xe6dcd4];
  const tin = [0x6a7076, 0x7a6a5e, 0x5a646c, 0x8a3a30];
  return {
    barn: { facade: 'boards', ground: 'barnDoors', roof: 'gambrel', palette: shades, roofTiles: [0x5a5e62, 0x6a4a40, 0x4e5a5e], trims: ['hoist'], paint: BARN_RED },
    farmhouse: { facade: 'siding', roof: 'gable', palette: [0xf4f2ea, 0xf2e6b8, 0xeef0ec], roofTiles: [0x5a4a44, 0x4a4e56, 0x6a5040], trims: ['porch', 'chimney'] },
    machineShed: { facade: 'industrial', roof: 'monopitch', palette: [0x9aa2a8, 0x8a949a, 0xa8aca4, 0x7c8a6e], roofTiles: tin, trims: ['colonnade'] },
    granary: { facade: 'boards', roof: 'gable', palette: shades, roofTiles: tin, trims: ['stilts'], paint: BARN_RED },
    henhouse: { facade: 'boards', roof: 'monopitch', palette: shades, roofTiles: tin, paint: BARN_RED },
  };
}

/** The red the boards' texture is painted (see Facades.ts). */
export const BARN_RED = 0xa8322a;

const FARM_STYLE = { lots: [1, 2] as [number, number], height: [5, 10] as [number, number], gap: [6, 10] as [number, number], empty: 0.3 };

export const FARM_DEF: DistrictDef = {
  kind: 'farm',
  label: 'Farm',
  salt: 0x5f4a12,
  chance: FARM.chance,
  site: 'edge',
  shapes: [[2, 2], [3, 3], [4, 4]],
  rings: ['residential', 'industrial'],
  minShare: { residential: 0.5 },
  gates: 'mainStreet',
  extraGates: 1,
  buildingStyle: FARM_STYLE,
  looks: FARM_LOOKS(),
  roles,
  lots,
  drop,
  swap: { lamp: 'woodLamp' },
  keepZebras: false,
  traffic: { density: FARM.density, heavy: true, weights: { Pickup: FARM.pickupWeight, Tractor: FARM.tractorWeight } },
  copSpawnSkip: FARM.copSpawnSkip,
  roadblockGates: true,
  mapColor: 0xd8b04a,
  dress,
};

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  out.soft = [];
  const sw = city.config.sidewalk;
  // Fields: ploughed soil inside the sidewalk line, rows along the long side; drivable and soft.
  const fields = plantFields(q, city, rng);
  for (const f of fields) {
    out.ground.push({ kind: 'soil', ...f.rect, yaw: f.rowsAlongX ? 0 : Math.PI / 2 });
    out.drivable.push(f.rect);
    out.soft.push(f.rect);
  }
  // Nothing of the city's own stands in a field (street props stay on the sidewalks).
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !fields.some((f) => inRect(f.rect, p)));
  const props: StreetProp[] = [];
  // The ranch gate where the main street comes in from town; cattle grids on the other gates.
  const ranch = ranchGate(q);
  const gate = ranchGateAt(q, city, ranch, rng);
  if (gate) {
    out.structures.push(gate.s);
    out.solids.push(...gate.solids);
    out.overhead.push(gate.overhead);
    props.push(...gate.props);
  }
  for (const g of q.gates) {
    if (g === ranch) continue;
    const grid = cattleGrid(city, g);
    out.ground.push(grid.ground);
    props.push(...grid.props);
  }
  // The silos, bins, windmill and water tower in the farmyard (the nearest fields if it's full).
  const yard = city.blocks[farmyardBlock(q)].rect;
  const near = [...fields].sort((a, b) => Math.hypot(a.rect.x - yard.x, a.rect.z - yard.z) - Math.hypot(b.rect.x - yard.x, b.rect.z - yard.z));
  const buildings = city.buildings.filter((b) => b.district === 'farm' && inRect(q.bounds, b));
  out.landmarks.push(...yardPieces(shrink(yard, sw), near.map((f) => f.rect), buildings, rng));
  // Split-rail fences round the fields.
  const gaps: Record<number, FenceGap[]> = {};
  for (const f of fields) {
    const fence = fieldFence(f.rect, city.blocks[f.block].rect, q, city);
    props.push(...fence.props);
    gaps[f.block] = fence.gaps;
  }
  // Sometimes a maze cut through one corn field.
  const corn = fields.filter((f) => f.crop === 'corn');
  if (rng.next() < FARM.mazeChance) {
    const f = rng.pick(corn);
    f.maze = cornMaze(f.rect, gaps[f.block], rng);
  }
  // The crops' furniture, then the yard's clutter and equipment; kerb clutter along the streets.
  const yardFps = [...buildings.map((b) => rectFootprint({ ...b, w: b.w + 1, d: b.d + 1 })), ...out.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius + 1, hz: l.radius + 1, yaw: 0 }))];
  const fenceFps = props.map((p) => propFootprint(p, 0.3));
  const inFields = dressFields(fields, gaps, [...yardFps, ...fenceFps], sw, rng);
  out.structures.push(...inFields.structures);
  out.solids.push(...inFields.solids);
  out.ground.push(...inFields.ground);
  props.push(...inFields.props);
  const shed = buildings.find((b) => b.lot === 'machineShed');
  props.push(...yardClutter(shrink(yard, sw), shed, [...yardFps, ...props.map((p) => propFootprint(p, 0.3))], rng));
  // A full yard: the tractor waits at the edge of the nearest field instead.
  if (!props.some((p) => p.kind === 'parkedTractor')) {
    const busy = [...yardFps, ...out.solids, ...props.map((p) => propFootprint(p, 0.3)), ...Object.values(gaps).flat().map((g) => gapLane(g))];
    for (const f of near) {
      const p = put('parkedTractor', shrink(f.rect, 2.5), busy, rng, { color: 0x2f7a3a });
      if (p) {
        props.push(p);
        break;
      }
    }
  }
  const around = { ...city, streetProps: [...city.streetProps, ...props] };
  const mouths = Object.values(gaps).flat().map((g) => gapMouth(g, sw));
  const clutter = kerbClutter(q, around, CLUTTER, rng, { step: [14, 28] });
  props.push(...clutter.filter((p) => !fields.some((f) => inRect(f.rect, p)) && !mouths.some((m) => footprintsOverlap(propFootprint(p), m))));
  // The district's props keep off its solids, its pieces and the junction controls; the city's
  // own that stood where they go are taken away (never a junction control).
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const pieces = out.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 }));
  const kept = clearOf(props, [...out.solids, ...pieces, ...controls, ...buildings.map(rectFootprint)]);
  const blocking = [...kept.map((p) => propFootprint(p, 0.1)), ...out.solids, ...pieces];
  city.streetProps = city.streetProps.filter((p) => !inDistrict(q, p) || isJunctionControl(p) || !blocking.some((k) => footprintsOverlap(propFootprint(p), k)));
  out.props = kept;
  out.extra = { fields, gaps };
  return out;
}
