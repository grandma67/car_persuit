// The Mega-park: one grand city park over a rectangle of blocks, its interior streets turned into
// tree-lined park drives. One block is a lake (an island, a footbridge, the boathouse and its jetty,
// sometimes a fountain jet), one or two are sports grounds (a soccer pitch and a tennis court, or a
// running track), one a fenced playground, one a bandstand lawn with the café pavilion; the rest
// are lawns with winding paths, trees, flower beds and picnic tables. Every block is grass (a park
// block), the lawns soft. A gate lodge stands by the main gate. Slow drives, light traffic, no
// buses or trucks, fewer cops. Pure data; drawn by render/districts/Megapark.ts.
import type { Rng } from '../../core/Rng';
import { MEGAPARK } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { propFootprint, rectFootprint, type StreetProp } from '../StreetProps';
import { emptyDressing, feature, type BlockRole, type District, type DistrictDef, type DistrictDressing, type Gate, type LotLook } from './District';
import { isJunctionControl } from './apply';
import { clearOf } from './HarborYard';
import { layLake } from './MegaparkLake';
import { ranchGate } from './Farm';
import { streetSides } from './Harbor';
import { shuffle } from './place';

export type MegaparkLot = 'cafe' | 'lodge' | 'boathouse';

/** A block side: its outward normal and the Building.street bit for it. */
export interface Side {
  nx: number;
  nz: number;
  bit: number;
}
export const SIDES: Side[] = [
  { nx: 0, nz: 1, bit: 1 },
  { nx: 0, nz: -1, bit: 2 },
  { nx: 1, nz: 0, bit: 4 },
  { nx: -1, nz: 0, bit: 8 },
];

/** The sides of block k on a street. */
export function streetSidesOf(k: number, city: CityData): Side[] {
  const s = streetSides(k, city);
  return SIDES.filter((d) => (d.nx > 0 ? s.px : d.nx < 0 ? s.nx : d.nz > 0 ? s.pz : s.nz));
}

/** The main gate: the main-street gate nearest the island's centre (the way in from town). */
export const mainGate = (q: District): Gate => ranchGate(q);

/** The two blocks either side of a gate's street, inside the district. */
export function gateBlocks(q: District, city: CityData, g: Gate): number[] {
  const [a, b] = g.edge.split('>').map(Number);
  const A = city.graph.nodes[a], B = city.graph.nodes[b];
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
  const across = (city.config.blockSize + city.config.roadWidth) / 2;
  return q.blocks.filter((k) => Math.abs(Math.hypot(city.blocks[k].rect.x - mx, city.blocks[k].rect.z - mz) - across) < 1);
}

/** The blocks of one role. */
export const roleBlocks = (q: District, role: BlockRole) => [...q.roles].filter(([, r]) => r === role).map(([k]) => k);

/** The block the gate lodge stands in (chosen with the roles). */
const LODGE_BLOCK = new WeakMap<District, number>();
export const lodgeBlock = (q: District) => LODGE_BLOCK.get(q) ?? (q.dressing.extra?.lodgeBlock as number | undefined);

function roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole> {
  // Every block is park ground (grass; the city's park picket fences are dropped).
  for (const k of q.blocks) city.blocks[k].park = true;
  const out = new Map<number, BlockRole>();
  const pool = [...q.blocks];
  shuffle(pool, rng);
  // The lodge's block: one beside the main gate. It never holds the lake or a sports ground.
  const lodge = gateBlocks(q, city, mainGate(q)).find((k) => pool.includes(k)) ?? pool[0];
  LODGE_BLOCK.set(q, lodge);
  // The lake in the middle (the block nearest the centre), the rest in turn.
  const cx = q.bounds.x, cz = q.bounds.z;
  const d = (k: number) => Math.hypot(city.blocks[k].rect.x - cx, city.blocks[k].rect.z - cz);
  const open = pool.filter((k) => k !== lodge);
  const lake = open.reduce((a, b) => (d(b) < d(a) - 1e-6 ? b : a));
  out.set(lake, 'lake');
  // Sports grounds: as many as rolled, leaving room for the playground and the bandstand.
  const wantSports = feature(q, 'sports', rng.int(MEGAPARK.sports[0], MEGAPARK.sports[1]));
  const track = feature(q, 'track', rng.next() < MEGAPARK.trackChance);
  const free = open.filter((k) => !out.has(k));
  const sports = free.slice(0, Math.max(0, Math.min(wantSports, q.blocks.length - 3)));
  sports.forEach((k, i) => out.set(k, track && i === sports.length - 1 ? 'track' : 'sports'));
  // The playground and the bandstand lawn (the lodge's block may take either), the rest lawns.
  const rest = pool.filter((k) => !out.has(k));
  out.set(rest[0], 'playground');
  out.set(rest[1], 'bandstand');
  for (const k of rest.slice(2)) out.set(k, 'lawn');
  return out;
}

/** A building on a block's edge: long side along it, `along` metres from the edge's middle, `inset` in from the sidewalk line. */
export function edgeLot(inner: Rect, side: Side, [long, short]: [number, number], along = 0, inset: number = MEGAPARK.lotInset): Rect {
  const w = side.nx ? short : long;
  const d = side.nx ? long : short;
  return side.nx
    ? { x: inner.x + side.nx * (inner.w / 2 - inset - w / 2), z: inner.z + along, w, d }
    : { x: inner.x + along, z: inner.z + side.nz * (inner.d / 2 - inset - d / 2), w, d };
}

/** The lodge: in the corner of its block by the main gate, back from the gate's posts. */
export function lodgeRect(q: District, city: CityData): Rect {
  const k = lodgeBlock(q)!;
  const g = mainGate(q);
  const inner = shrink(city.blocks[k].rect, city.config.sidewalk);
  const sx = Math.sign(g.x - inner.x) || 1, sz = Math.sign(g.z - inner.z) || 1;
  const [long, short] = MEGAPARK.lodge.size;
  // The gate's street runs along its heading: the lodge stands back from it by the posts' room.
  const alongX = Math.abs(Math.sin(g.yaw)) > 0.5;
  const w = alongX ? long : short, d = alongX ? short : long;
  const inX = alongX ? MEGAPARK.lotInset : 3, inZ = alongX ? 3 : MEGAPARK.lotInset;
  return { x: inner.x + sx * (inner.w / 2 - inX - w / 2), z: inner.z + sz * (inner.d / 2 - inZ - d / 2), w, d };
}

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  buildings.length = 0; // every block has a role: nothing was filled
  const sw = city.config.sidewalk;
  const make = (r: Rect, k: number, lot: MegaparkLot, h: number): Building =>
    ({ ...r, h, zone: city.blocks[k].zone, variant: rng.next(), district: 'megapark', lot });
  // The gate lodge by the main gate.
  const lodgeK = lodgeBlock(q)!;
  buildings.push(make(lodgeRect(q, city), lodgeK, 'lodge', MEGAPARK.lodge.h));
  // The café on a street side of the bandstand's block (away from the lodge when they share it).
  const band = roleBlocks(q, 'bandstand')[0];
  const bandInner = shrink(city.blocks[band].rect, sw);
  const lodge = buildings[0];
  const cafeSides = streetSidesOf(band, city);
  shuffle(cafeSides, rng);
  const away = (s: Side) => (band === lodgeK ? -((lodge.x - bandInner.x) * s.nx + (lodge.z - bandInner.z) * s.nz) : 0);
  const cafeSide = cafeSides.reduce((a, b) => (away(b) > away(a) ? b : a), cafeSides[0] ?? SIDES[0]);
  buildings.push(make(edgeLot(bandInner, cafeSide, MEGAPARK.cafe.size), band, 'cafe', MEGAPARK.cafe.h));
  // The boathouse on a street side of the lake's block, its jetty out into the water.
  const lake = roleBlocks(q, 'lake')[0];
  const lakeSides = streetSidesOf(lake, city);
  const boatSide = lakeSides.length ? rng.pick(lakeSides) : rng.pick(SIDES);
  buildings.push(make(edgeLot(shrink(city.blocks[lake].rect, sw), boatSide, MEGAPARK.boathouse.size), lake, 'boathouse', MEGAPARK.boathouse.h));
  for (const b of buildings) b.street = frontMask(b, city);
}

/** The sides of a park building on the sidewalk line of its block (Building.street bits). */
function frontMask(b: Building, city: CityData): number {
  const block = city.blocks.find((bl) => inRect(bl.rect, b))!.rect;
  const s = city.config.sidewalk, near = MEGAPARK.lotInset + 0.5;
  return (Math.abs(b.z + b.d / 2 - (block.z + block.d / 2 - s)) <= near ? 1 : 0) | (Math.abs(b.z - b.d / 2 - (block.z - block.d / 2 + s)) <= near ? 2 : 0) |
    (Math.abs(b.x + b.w / 2 - (block.x + block.w / 2 - s)) <= near ? 4 : 0) | (Math.abs(b.x - b.w / 2 - (block.x - block.w / 2 + s)) <= near ? 8 : 0);
}

/** Street furniture that doesn't belong: picket fences (the park is open), beach umbrellas, bus stops (no buses). */
const drop = (p: StreetProp) => p.kind === 'fence' || p.kind === 'umbrella' || (p.kind === 'sign' && p.variant === 'busStop');

/** A café pavilion in cream stucco with a green copper roof, a stone lodge, a white clapboard boathouse. */
function MEGAPARK_LOOKS(): Record<MegaparkLot, LotLook> {
  return {
    cafe: { facade: 'stucco', ground: 'storefront', roof: 'hip', palette: [0xf2ead8, 0xeee4cc, 0xf4eee2], roofTiles: [0x5f8f7a, 0x6a9a84], trims: ['colonnade'] },
    lodge: { facade: 'ashlar', roof: 'steepGable', palette: [0xc8bca4, 0xb8ac94, 0xd0c4ae], roofTiles: [0x4a4e56, 0x5a4a44], trims: ['chimney', 'porch'] },
    boathouse: { facade: 'siding', roof: 'gable', palette: [0xf2f2ec, 0xdde8ee, 0xe8eef0], roofTiles: [0x3f5a4a, 0x5a3a34] },
  };
}

const MEGAPARK_STYLE = { lots: [1, 1] as [number, number], height: [4, 6] as [number, number], gap: [2, 4] as [number, number], empty: 1 };

export const MEGAPARK_DEF: DistrictDef = {
  kind: 'megapark',
  label: 'Mega-park',
  features: { sports: 'int', track: 'bool', fountain: 'bool' },
  built: (q) => ({
    sports: roleBlocks(q, 'sports').length + roleBlocks(q, 'track').length,
    track: roleBlocks(q, 'track').length > 0,
    fountain: !!q.dressing.extra?.fountain,
  }),
  salt: 0x3e9a7c,
  chance: MEGAPARK.chance,
  site: 'inland',
  shapes: [[2, 2], [2, 3], [3, 3]],
  rings: ['midtown', 'residential'],
  minShare: { residential: 0.5 },
  gates: 'all',
  buildingStyle: MEGAPARK_STYLE,
  looks: MEGAPARK_LOOKS(),
  roles,
  lots,
  drop,
  swap: { lamp: 'oilLamp' },
  keepZebras: true,
  traffic: { speed: MEGAPARK.speed, speedOn: 'all', density: MEGAPARK.density, heavy: false },
  copSpawnSkip: MEGAPARK.copSpawnSkip,
  softGround: { grip: MEGAPARK.lawnGrip, drag: MEGAPARK.lawnDrag },
  roadblockGates: true,
  mapColor: 0x4a9a4a,
  dress,
};

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const out = emptyDressing();
  const sw = city.config.sidewalk;
  // The blocks' insides are the park's own: the city's loose benches and the like go (never a junction control).
  const inners = q.blocks.map((k) => shrink(city.blocks[k].rect, sw));
  city.streetProps = city.streetProps.filter((p) => isJunctionControl(p) || !inners.some((r) => inRect(r, p)));
  // The lawns are soft (the track and the lake's bank are not).
  out.soft = q.blocks.filter((k) => q.roles.get(k) !== 'track' && q.roles.get(k) !== 'lake').map((k) => shrink(city.blocks[k].rect, sw));
  const buildings = city.buildings.filter((b) => b.district === 'megapark' && inRect(q.bounds, b));
  const props: StreetProp[] = [];
  // The lake: water, island, footbridge, jetty and boats (the boathouse is a lot).
  const lakeK = roleBlocks(q, 'lake')[0];
  const lakeInner = shrink(city.blocks[lakeK].rect, sw);
  const fountain = feature(q, 'fountain', rng.next() < MEGAPARK.fountainChance);
  const lake = layLake(lakeInner, buildings.find((b) => b.lot === 'boathouse')!, lakeK, city.config.blocks, fountain, rng);
  city.water.push(lake.water);
  city.parkPieces.push(lake.piece);
  out.structures.push(...lake.structures);
  out.solids.push(...lake.solids);
  props.push(...lake.props);
  // The props keep clear of the solids, the buildings, the junction controls and each other.
  const controls = city.streetProps.filter((p) => inRect(q.bounds, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  out.props = clearOf(props, [...out.solids, ...controls, ...buildings.map(rectFootprint)], city.streetProps.filter((p) => inRect(q.bounds, p, 2)).map((p) => propFootprint(p, 0.1)));
  out.extra = { lodgeBlock: lodgeBlock(q), fountain: lake.fountain };
  return out;
}
