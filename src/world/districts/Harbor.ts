// The Harbor: a cargo port on the coast. A container yard on the quay row, warehouses and transit
// sheds behind, a harbor office, sometimes a grain silo and a tank farm; heavy traffic, no speed
// cap. Pure data; drawn by render/districts/Harbor.ts.
import type { Rng } from '../../core/Rng';
import { HARBOR } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp } from '../StreetProps';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook, type Structure } from './District';
import { capContainers, clearOf, containersOf, yardFence, yardLayout } from './HarborYard';
import { inDistrict, isJunctionControl, kerbClutter } from './apply';
import { terminalGate, siloGallery } from './HarborGate';
import { clearQuay, coastFrame, quay, quayLines, toWorld, uSpan } from './HarborQuay';

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

/**
 * Which sides of its block a building fronts (as Building.street bits), its face within `reach`
 * of the block's sidewalk line: harbor lots stand a few metres back from it.
 */
export function frontMask(b: Building, q: District, city: CityData, reach = 5): number {
  const r = q.blocks.map((k) => city.blocks[k].rect).find((br) => inRect(br, b));
  if (!r) return 0;
  const s = city.config.sidewalk;
  const near = (face: number, line: number) => Math.abs(face - line) <= reach;
  return (near(b.z + b.d / 2, r.z + r.d / 2 - s) ? 1 : 0) | (near(b.z - b.d / 2, r.z - r.d / 2 + s) ? 2 : 0) |
    (near(b.x + b.w / 2, r.x + r.w / 2 - s) ? 4 : 0) | (near(b.x - b.w / 2, r.x - r.w / 2 + s) ? 8 : 0);
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
  for (const b of buildings) b.street = frontMask(b, q, city);
  // Transit sheds stand open on their quay side.
  const c = q.coast!;
  const seaward = c.nz > 0 ? 1 : c.nz < 0 ? 2 : c.nx > 0 ? 4 : 8;
  for (const b of buildings) if (b.lot === 'transitShed') b.open = seaward;
}

/** Street furniture that doesn't suit a working port (junction controls, hydrants and bus stops stay). */
const DROP_SIGNS = new Set(['noSmoking', 'children']);
const drop = (p: StreetProp) =>
  p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'fence' && !p.style) || (p.kind === 'sign' && DROP_SIGNS.has(p.variant ?? ''));

/** Sheds and stores in corrugated steel and concrete; the office in glass. */
function HARBOR_LOOKS(): Record<Exclude<HarborLot, 'tankFarm'>, LotLook> {
  const steel = [0x8a9aa6, 0x6f8492, 0xa7aeb2, 0x7c8a6e, 0x9a7a5e, 0x5f7a8e];
  const metal = [0x6a7076, 0x7a6a5e, 0x5a646c, 0x8a8f94];
  return {
    warehouse: { facade: 'industrial', ground: 'rollerDoors', roof: 'sawtooth', roofAlt: 'barrel', palette: steel, roofTiles: metal, trims: ['loadingDock'] },
    transitShed: { facade: 'industrial', roof: 'barrel', palette: [0xa7aeb2, 0x8a9aa6, 0xb8b2a0], roofTiles: metal, trims: ['colonnade'] },
    coldStore: { facade: 'panel', roof: 'flat', palette: [0xe8ecee, 0xdfe4e6, 0xf0f0ec] },
    harborOffice: { facade: 'office', roof: 'flat', palette: [0xd8dcdc, 0xc8d0d4, 0xe6e2d8], trims: ['radarMast'] },
    silo: { facade: 'industrial', roof: 'flat', palette: [0xc8c4b8, 0xb8b4a8], roofTiles: [0x8a8a84], form: 'silos' },
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
  const props: StreetProp[] = [];
  const sw = city.config.sidewalk, rw = city.config.roadWidth;
  const f = coastFrame(q);
  // The container yards: stacks solid, corridors drivable, the block paved in concrete, fenced,
  // boom barriers at the corridor mouths; a rail siding along the inland edge where the rows run
  // along the quay.
  const yards = yardBlocks(q).map((k) => {
    const r: Rect = city.blocks[k].rect;
    const alongX = yardRowsAlongX(k, q, city);
    const alongCoast = alongX === !!q.coast!.nz;
    // The inland side, across the rows (local v runs along Z when the rows run along X).
    const railAt = (alongCoast ? (alongX ? -Math.sign(q.coast!.nz) : -Math.sign(q.coast!.nx)) : 0) as -1 | 0 | 1;
    const yard = yardLayout(r, city, alongX, railAt, rng);
    out.structures.push(...yard.stacks, ...yard.pieces);
    out.solids.push(...yard.solids);
    out.drivable.push(...yard.corridors);
    out.ground.push({ kind: 'yard', x: r.x, z: r.z, w: r.w - sw * 2, d: r.d - sw * 2 });
    if (yard.rail) out.ground.push({ kind: 'rail', ...yard.rail });
    props.push(...yardFence(r, yard));
    return { k, r, yard };
  });
  // Level crossings: a rail strip carries on over an interior street beside its yard, to the next
  // yard's strip or a buffer stop on the far sidewalk.
  for (const { k, r, yard } of yards) {
    const rail = yard.rail;
    if (!rail) continue;
    const alongX = yard.rowsAlongX;
    for (const end of [-1, 1]) {
      const n = city.config.blocks;
      const i = k % n + (alongX ? end : 0), j = Math.floor(k / n) + (alongX ? 0 : end);
      const next = j * n + i;
      if (!q.blocks.includes(next)) continue; // a perimeter street: the line stops at the fence
      // The road between: along the track, from this block's edge to the next one's.
      const edge = alongX ? r.x + end * r.w / 2 : r.z + end * r.d / 2;
      const road: Rect = alongX ? { x: edge + end * rw / 2, z: rail.z, w: rw, d: rail.d } : { x: rail.x, z: edge + end * rw / 2, w: rail.w, d: rw };
      const crossing = !!yards.find((y) => y.k === next && y.yard.rail && Math.abs((alongX ? y.yard.rail.z : y.yard.rail.x) - (alongX ? rail.z : rail.x)) < 0.5);
      // Each yard draws the crossing on its +side only, so a shared one isn't drawn twice.
      if (crossing && end < 0) continue;
      out.ground.push({ kind: 'railRoad', ...road });
      for (const side of [-1, 1]) {
        const rumble = alongX ? { x: road.x, z: rail.z + side * (rail.d / 2 + 1.6), w: rw - 1, d: 1.2 } : { x: rail.x + side * (rail.w / 2 + 1.6), z: road.z, w: 1.2, d: rw - 1 };
        out.ground.push({ kind: 'rumble', ...rumble });
      }
      if (!crossing) {
        // Over the far sidewalk to a buffer stop.
        const far = edge + end * (rw + sw / 2);
        const walk: Rect = alongX ? { x: far, z: rail.z, w: sw, d: rail.d } : { x: rail.x, z: far, w: rail.w, d: sw };
        out.ground.push({ kind: 'rail', ...walk });
        const stop = alongX ? { x: far + end * (sw / 2 - 0.5), z: rail.z } : { x: rail.x, z: far + end * (sw / 2 - 0.5) };
        const fp: Footprint = { ...stop, hx: alongX ? 0.4 : 1.4, hz: alongX ? 1.4 : 0.4, yaw: 0 };
        out.structures.push({ kind: 'bufferStop', ...stop, yaw: alongX ? (end > 0 ? -Math.PI / 2 : Math.PI / 2) : end > 0 ? Math.PI : 0, footprints: [fp] });
        out.solids.push(fp);
      }
      // Crossbucks on both sidewalks, before the track either way, facing the traffic.
      const cx = alongX ? road.x : road.z; // the street's centre line, across
      for (const lat of [-1, 1]) {
        for (const app of [-1, 1]) {
          const a = cx + lat * (rw / 2 + 0.7), b = (alongX ? rail.z : rail.x) + app * (rail.d / 2 + 3.2) * (alongX ? 1 : 0) + app * (rail.w / 2 + 3.2) * (alongX ? 0 : 1);
          const pos = alongX ? { x: a, z: b } : { x: b, z: a };
          const yaw = alongX ? (app > 0 ? 0 : Math.PI) : app > 0 ? Math.PI / 2 : -Math.PI / 2;
          props.push({ kind: 'crossbuck', ...pos, yaw });
        }
      }
    }
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
  // The terminal gate where the main street leaves inland.
  const gate = terminalGate(q, city, rng);
  if (gate) {
    out.structures.push(gate.s);
    out.solids.push(...gate.solids);
    out.overhead.push(gate.overhead);
    out.ground.push(...gate.ground);
  }
  // The quay: apron, cranes over the seafront road, bollards and the ship.
  const qy = quay(q, city, quayRow(q, city), containersOf(out.structures).length, rng);
  out.landmarks.push(...qy.landmarks);
  out.structures.push(...qy.structures);
  out.solids.push(...qy.solids);
  out.ground.push(...qy.ground);
  out.overhead.push(...qy.overhead);
  // The silo's gallery out to a loader on the quay (bollards under the tower go).
  const silo = city.buildings.find((b) => b.district === 'harbor' && b.lot === 'silo' && inRect(q.bounds, b));
  const gallery = siloGallery(q, city, silo, out.solids, qy.structures.filter((st) => st.kind === 'crane'));
  if (gallery) {
    out.structures.push(gallery.s);
    out.solids.push(gallery.solid);
    out.overhead.push(gallery.overhead);
    out.landmarks = out.landmarks.filter((l) => !footprintsOverlap({ x: l.x, z: l.z, hx: l.radius + 0.3, hz: l.radius + 0.3, yaw: 0 }, gallery.solid));
  }
  // Nothing of the city's own stands on what the district put down (junction controls never do).
  clearQuay(q, city, out.solids);
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const landmarkFps = out.landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 }));
  const kept = clearOf(props, [...out.solids, ...landmarkFps, ...controls]);
  // Off the props the district keeps, the city's own that stood there go (not junction controls).
  const keptFps = kept.map((p) => propFootprint(p, 0.1));
  city.streetProps = city.streetProps.filter((p) => !inDistrict(q, p) || isJunctionControl(p) || !keptFps.some((k) => footprintsOverlap(propFootprint(p), k)));

  // Kerb clutter on the interior streets' sidewalks, clear of the corridors, crossings and gate.
  const busy = [...out.solids, ...landmarkFps, ...out.drivable.map(rectFootprint), ...out.ground.filter((g) => g.kind !== 'yard' && g.kind !== 'apron').map(rectFootprint)];
  const around = { ...city, streetProps: [...city.streetProps, ...kept] };
  const clutter = kerbClutter(q, around, CLUTTER, rng, { step: [8, 16] }).filter((p) => !busy.some((b) => footprintsOverlap(propFootprint(p, 0.2), b)));
  // Lifebuoys along the quay edge, between the bollards.
  const L = quayLines(city);
  const [fu0, fu1] = uSpan(f, q.frontage!);
  const buoys: StreetProp[] = [];
  for (let u = fu0 + 20; u < fu1 - 10; u += rng.range(35, 50)) buoys.push({ kind: 'lifebuoy', ...toWorld(f, u, L.edge - 1.9), yaw: f.yaw + Math.PI });
  // Forklifts parked by some warehouse fronts, in the lot gap.
  const lifts: StreetProp[] = [];
  const sheds = city.buildings.filter((b) => b.district === 'harbor' && (b.lot === 'warehouse' || b.lot === 'coldStore') && inRect(q.bounds, b));
  for (const b of sheds) {
    if (lifts.length >= HARBOR.forklifts || rng.next() > 0.5) continue;
    const bits: [number, number, number][] = [[1, 0, 1], [2, 0, -1], [4, 1, 0], [8, -1, 0]];
    const face = bits.find(([bit]) => (b.street ?? 0) & bit);
    if (!face) continue;
    const [, nx, nz] = face;
    const along = rng.range(-0.3, 0.3) * (nx ? b.d : b.w);
    const x = b.x + nx * (b.w / 2 + 1.2) + (nx ? 0 : along), z = b.z + nz * (b.d / 2 + 1.2) + (nz ? 0 : along);
    lifts.push({ kind: 'forklift', x, z, yaw: nx ? 0 : Math.PI / 2, color: rng.pick([0xe8b02a, 0xd8762a, 0xc8302a]) });
  }
  const buildings = city.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint);
  const extra = clearOf([...clutter, ...buoys, ...lifts], [...busy, ...buildings, ...controls], [...kept, ...city.streetProps.filter((p) => inDistrict(q, p))].map((p) => propFootprint(p, 0.2)));
  out.props = [...kept, ...extra];
  return out;
}

/** Kerb clutter: pallets, drums, crates and cable reels. */
const CLUTTER: PropKind[] = ['pallet', 'pallet', 'drums', 'drums', 'drums', 'crates', 'crates', 'cableReel'];
