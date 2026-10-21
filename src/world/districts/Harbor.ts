// The Harbor: a cargo port on the coast. A container yard on the quay row, warehouses and transit
// sheds behind, a harbor office, sometimes a grain silo and a tank farm; heavy traffic, no speed
// cap. Pure data; drawn by render/districts/Harbor.ts.
import type { Rng } from '../../core/Rng';
import { HARBOR } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect } from '../lots';
import type { Footprint, StreetProp } from '../StreetProps';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook, type Structure } from './District';
import { capContainers, yardLayout } from './HarborYard';

export type HarborLot = 'warehouse' | 'transitShed' | 'coldStore' | 'harborOffice' | 'silo' | 'tankFarm';

/** A block's grid coordinates. */
const cell = (k: number, city: CityData) => ({ i: k % city.config.blocks, j: Math.floor(k / city.config.blocks) });

/** The blocks along the seafront (the frontage side), in order along it. */
export function quayRow(q: District, city: CityData): number[] {
  const { i0, j0, w, h } = q.grid;
  const c = q.coast!;
  return q.blocks
    .filter((k) => {
      const { i, j } = cell(k, city);
      return c.nz ? j === (c.nz < 0 ? j0 : j0 + h - 1) : i === (c.nx < 0 ? i0 : i0 + w - 1);
    })
    .sort((a, b) => (c.nz ? cell(a, city).i - cell(b, city).i : cell(a, city).j - cell(b, city).j));
}

/** The blocks behind the quay row. */
export function backRows(q: District, city: CityData): number[] {
  const quay = new Set(quayRow(q, city));
  return q.blocks.filter((k) => !quay.has(k));
}

/** The container-yard blocks. */
export const yardBlocks = (q: District) => [...q.roles].filter(([, r]) => r === 'yard').map(([k]) => k);

/** Which sides of a block face a street (a road segment, not a plaza): ±X and ±Z. */
export function streetSides(k: number, city: CityData): { px: boolean; nx: boolean; pz: boolean; nz: boolean } {
  const n = city.config.blocks;
  const { i, j } = cell(k, city);
  const id = (a: number, b: number) => b * (n + 1) + a;
  const roads = new Set(city.roads.flatMap((r) => [`${r.a}>${r.b}`, `${r.b}>${r.a}`]));
  const has = (a: number, b: number) => roads.has(`${a}>${b}`);
  return {
    nz: has(id(i, j), id(i + 1, j)),
    pz: has(id(i, j + 1), id(i + 1, j + 1)),
    nx: has(id(i, j), id(i, j + 1)),
    px: has(id(i + 1, j), id(i + 1, j + 1)),
  };
}

/**
 * Which way a yard's rows run: along the seafront when the side streets are both there (the
 * corridors then join them), else across it.
 */
export function yardRowsAlongX(k: number, q: District, city: CityData): boolean {
  const s = streetSides(k, city);
  const alongCoast = !!q.coast!.nz; // the coast runs along X
  const sidesAlong = alongCoast ? s.px && s.nx : s.pz && s.nz; // the streets the rows would join
  return sidesAlong ? alongCoast : !alongCoast;
}

function roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole> {
  const quay = quayRow(q, city);
  const want = Math.min(rng.int(HARBOR.yards[0], HARBOR.yards[1]), quay.length - 1);
  // A run of neighbouring quay blocks, each with streets on two opposite sides where it can be.
  const through = (k: number) => { const s = streetSides(k, city); return (s.px && s.nx) || (s.pz && s.nz); };
  const starts = Array.from({ length: quay.length - want + 1 }, (_, i) => i);
  const good = starts.filter((i) => quay.slice(i, i + want).every(through));
  const at = rng.pick(good.length ? good : starts);
  return new Map(quay.slice(at, at + want).map((k) => [k, 'yard' as BlockRole]));
}

/** Shrink a building about its centre to at most `w` × `d`. */
const clampSize = (b: Building, w: number, d: number) => {
  b.w = Math.min(b.w, w);
  b.d = Math.min(b.d, d);
};

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  // A harbor always has an office: if every lot came up empty, the first ordinary block gets one.
  if (!buildings.length) {
    const k = q.blocks.find((b) => !q.roles.has(b))!;
    const r = city.blocks[k].rect;
    const side = HARBOR.officeSide;
    buildings.push({ x: r.x, z: r.z, w: side, d: side, h: HARBOR.officeHeight[0], zone: city.blocks[k].zone, variant: rng.next(), district: 'harbor' });
  }
  const quay = new Set(quayRow(q, city));
  const onQuay = (b: Building) => [...quay].some((k) => inRect(city.blocks[k].rect, b));
  for (const b of buildings) b.lot = onQuay(b) && rng.next() < HARBOR.transitShedShare ? 'transitShed' : 'warehouse';
  // Exactly one harbor office, overlooking the quay where it can.
  const front = buildings.filter(onQuay);
  const office = rng.pick(front.length ? front : buildings);
  office.lot = 'harborOffice';
  office.h = rng.range(HARBOR.officeHeight[0], HARBOR.officeHeight[1]);
  clampSize(office, HARBOR.officeSide, HARBOR.officeSide);
  const free = () => buildings.filter((b) => b.lot === 'warehouse' || b.lot === 'transitShed');
  // A grain silo on the quay row where it can (its gallery runs to the quay).
  if (rng.next() < HARBOR.siloChance) {
    const pool = free().filter(onQuay);
    const silo = pool.length ? rng.pick(pool) : free().length ? rng.pick(free()) : undefined;
    if (silo) {
      silo.lot = 'silo';
      silo.h = rng.range(HARBOR.siloHeight[0], HARBOR.siloHeight[1]);
      // A battery two cylinders deep.
      if (silo.w >= silo.d) clampSize(silo, 36, 12);
      else clampSize(silo, 12, 36);
    }
  }
  // A tank farm on a big back-row lot.
  if (rng.next() < HARBOR.tankFarmChance) {
    const pool = free().filter((b) => !onQuay(b) && Math.min(b.w, b.d) >= 16);
    if (pool.length) rng.pick(pool).lot = 'tankFarm';
  }
  const cold = rng.int(HARBOR.coldStores[0], HARBOR.coldStores[1]);
  const warehouses = free().filter((b) => b.lot === 'warehouse');
  for (let k = 0; k < cold && warehouses.length; k++) warehouses.splice(rng.int(0, warehouses.length - 1), 1)[0].lot = 'coldStore';
}

/** Street furniture that doesn't suit a working port (junction controls, hydrants and bus stops stay). */
const DROP_SIGNS = new Set(['noSmoking', 'children']);
const drop = (p: StreetProp) => p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'sign' && DROP_SIGNS.has(p.variant ?? ''));

/** Sheds and stores in corrugated steel and concrete; the office in glass. */
function HARBOR_LOOKS(): Record<Exclude<HarborLot, 'tankFarm'>, LotLook> {
  const steel = [0x8a9aa6, 0x6f8492, 0xa7aeb2, 0x7c8a6e, 0x9a7a5e, 0x5f7a8e];
  return {
    warehouse: { facade: 'industrial', roof: 'flat', palette: steel },
    transitShed: { facade: 'industrial', roof: 'flat', palette: [0xa7aeb2, 0x8a9aa6, 0xb8b2a0] },
    coldStore: { facade: 'industrial', roof: 'flat', palette: [0xe8ecee, 0xdfe4e6, 0xf0f0ec] },
    harborOffice: { facade: 'office', roof: 'flat', palette: [0xd8dcdc, 0xc8d0d4, 0xe6e2d8] },
    silo: { facade: 'industrial', roof: 'flat', palette: [0xc8c4b8, 0xb8b4a8] },
  };
}

export const HARBOR_DEF: DistrictDef = {
  kind: 'harbor',
  label: 'Harbor',
  salt: 0x4a2b0e,
  chance: HARBOR.chance,
  site: 'coast',
  shapes: [[2, 2], [3, 3], [4, 4]],
  rings: ['industrial', 'residential'],
  minShare: { industrial: 0.5 },
  gates: 'all',
  buildingStyle: { lots: [1, 2], height: [7, 14], gap: [2, 4], empty: 0.2 },
  looks: HARBOR_LOOKS(),
  roles,
  lots,
  drop,
  swap: {},
  keepZebras: false,
  traffic: { density: HARBOR.density, heavy: true, weights: { 'Box truck': HARBOR.boxTruckWeight, Van: HARBOR.vanWeight } },
  copSpawnSkip: 0,
  roadblockGates: true,
  mapColor: 0x4a78a8,
  dress,
};

/** The tank farm's data: round tanks inside a low bund wall round the lot. */
export interface TankFarmData {
  w: number;
  d: number;
  bund: number; // wall height
  tanks: { x: number; z: number; r: number; h: number }[];
}

const BUND_T = 0.4; // bund wall thickness

/** Replace the tank-farm lot's building with tanks in a bund. */
function tankFarm(b: Building, rng: Rng): Structure {
  const inner = { w: b.w - 3, d: b.d - 3 };
  const r = rng.range(5, 7.5);
  const nx = Math.max(1, Math.floor(inner.w / (2 * r + 2)));
  const nz = Math.max(1, Math.floor(inner.d / (2 * r + 2)));
  const rr = Math.min(r, inner.w / nx / 2 - 1, inner.d / nz / 2 - 1);
  const tanks: TankFarmData['tanks'] = [];
  for (let a = 0; a < nx; a++) {
    for (let c = 0; c < nz; c++) {
      tanks.push({ x: b.x - inner.w / 2 + (inner.w * (a + 0.5)) / nx, z: b.z - inner.d / 2 + (inner.d * (c + 0.5)) / nz, r: rr, h: rng.range(7, 13) });
    }
  }
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const walls: Footprint[] = [
    { x: b.x, z: z0 + BUND_T / 2, hx: b.w / 2, hz: BUND_T / 2, yaw: 0 },
    { x: b.x, z: z1 - BUND_T / 2, hx: b.w / 2, hz: BUND_T / 2, yaw: 0 },
    { x: x0 + BUND_T / 2, z: b.z, hx: BUND_T / 2, hz: b.d / 2 - BUND_T, yaw: 0 },
    { x: x1 - BUND_T / 2, z: b.z, hx: BUND_T / 2, hz: b.d / 2 - BUND_T, yaw: 0 },
  ];
  const footprints = [...walls, ...tanks.map((t) => ({ x: t.x, z: t.z, hx: t.r, hz: t.r, yaw: 0 }))];
  const data: TankFarmData = { w: b.w, d: b.d, bund: HARBOR.bund, tanks };
  return { kind: 'tankFarm', x: b.x, z: b.z, yaw: 0, footprints, data: data as unknown as Record<string, unknown> };
}

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  // The container yards: stacks solid, corridors drivable, the block paved in concrete.
  for (const k of yardBlocks(q)) {
    const r: Rect = city.blocks[k].rect;
    const yard = yardLayout(r, city, yardRowsAlongX(k, q, city), rng);
    out.structures.push(...yard.stacks);
    out.solids.push(...yard.solids);
    out.drivable.push(...yard.corridors);
    const s = city.config.sidewalk;
    out.ground.push({ kind: 'yard', x: r.x, z: r.z, w: r.w - s * 2, d: r.d - s * 2 });
  }
  // The tank farm stands in its lot's place.
  const farm = city.buildings.find((b) => b.district === 'harbor' && b.lot === 'tankFarm' && inRect(q.bounds, b));
  if (farm) {
    city.buildings = city.buildings.filter((b) => b !== farm);
    const t = tankFarm(farm, rng);
    out.structures.push(t);
    out.solids.push(...t.footprints);
  }
  capContainers(out.structures, HARBOR.maxContainers);
  return out;
}
