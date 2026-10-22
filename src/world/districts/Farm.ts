// The Farm: fields and one farmyard on the island's edge. The farmyard is the block by the ranch
// gate (farmhouse, barn, machine shed, granary, henhouse); every other block is a field of corn,
// wheat, pumpkins, an orchard or hay, drivable and soft. Light traffic, pickups and tractors.
// Pure data; drawn by render/districts/Farm.ts.
import type { Rng } from '../../core/Rng';
import { FARM } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import type { StreetProp } from '../StreetProps';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type Gate, type LotLook } from './District';
import { isJunctionControl } from './apply';
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

/** Timber and steel farm buildings (refined in FM2). */
function FARM_LOOKS(): Record<FarmLot, LotLook> {
  const red = [0xa8322a, 0x9a2c26, 0xb03a2e];
  const white = [0xf2efe6, 0xefe6c8, 0xe8e4d8];
  const steel = [0x9aa2a8, 0x8a949a, 0xa8aca4];
  const tin = [0x6a7076, 0x7a6a5e, 0x5a646c];
  return {
    barn: { facade: 'siding', roof: 'gable', palette: red, roofTiles: tin },
    farmhouse: { facade: 'siding', roof: 'gable', palette: white, roofTiles: [0x5a4a44, 0x4a4e56, 0x6a5040], trims: ['chimney'] },
    machineShed: { facade: 'industrial', roof: 'flat', palette: steel, roofTiles: tin },
    granary: { facade: 'siding', roof: 'gable', palette: [0x8a6a4a, 0x9a7a56], roofTiles: tin },
    henhouse: { facade: 'siding', roof: 'gable', palette: [0xb0503a, 0xe0d8c0], roofTiles: tin },
  };
}

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
  swap: {},
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
  // Fields: ploughed soil inside the sidewalk line, rows along the long side; drivable and soft.
  const fields = plantFields(q, city, rng);
  for (const f of fields) {
    out.ground.push({ kind: 'soil', ...f.rect, yaw: f.rowsAlongX ? 0 : Math.PI / 2 });
    out.drivable.push(f.rect);
    out.soft.push(f.rect);
  }
  // Nothing of the city's own stands in a field (street props stay on the sidewalks).
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !fields.some((f) => inRect(f.rect, p)));
  out.extra = { fields };
  return out;
}
