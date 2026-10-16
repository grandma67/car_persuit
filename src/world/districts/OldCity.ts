// The Old City: a walled medieval core in the middle ring. Tight street walls of half-timbered and
// stone houses, a market square with the town hall facing it, ruins, slow traffic and no heavies.
// Pure data; drawn by render/districts/OldCity.ts.
import type { Rng } from '../../core/Rng';
import { OLD_CITY, OLD_CITY_WALLS } from '../../gameplay/balance';
import type { Block, Building, CityData } from '../CityGenerator';
import { LANDMARK_RADIUS, makeSquare, type Landmark, type LandmarkKind } from '../Landmarks';
import { inRect } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp } from '../StreetProps';
import { inDistrict, isJunctionControl, kerbClutter } from './apply';
import { emptyDressing, type BlockRole, type District, type DistrictDef, type DistrictDressing, type LotLook, type Structure } from './District';
import { clearOfWalls, wallDressing, wallPlan } from './OldCityWalls';

export type OldCityLot = 'halfTimbered' | 'stoneHouse' | 'townHall' | 'arcade' | 'ruin';

/** The four sides of a block, as the step from it to its neighbour in grid coordinates. */
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The market square's block (the district's only role block). */
export function squareBlock(q: District): number | undefined {
  for (const [k, role] of q.roles) if (role === 'square') return k;
  return undefined;
}

/**
 * Buildings facing the square across a street: in a block beside it, with the face towards the
 * square on the block's sidewalk line. `side` is the step from the square to that block.
 */
export function facingSquare(q: District, city: CityData, buildings: Building[]): { b: Building; side: [number, number] }[] {
  const sq = squareBlock(q);
  if (sq === undefined) return [];
  const n = city.config.blocks;
  const si = sq % n;
  const sj = Math.floor(sq / n);
  const s = city.config.sidewalk;
  const out: { b: Building; side: [number, number] }[] = [];
  for (const [di, dj] of SIDES) {
    const k = (sj + dj) * n + (si + di);
    if (!q.blocks.includes(k) || si + di < 0 || si + di >= n) continue;
    const r: Block['rect'] = city.blocks[k].rect;
    for (const b of buildings) {
      if (Math.abs(b.x - r.x) > r.w / 2 || Math.abs(b.z - r.z) > r.d / 2) continue;
      // The block's sidewalk line on the square's side, and the building's face there.
      const line = di ? r.x - di * (r.w / 2 - s) : r.z - dj * (r.d / 2 - s);
      const face = di ? b.x - di * (b.w / 2) : b.z - dj * (b.d / 2);
      if (Math.abs(face - line) <= 1) out.push({ b, side: [di, dj] });
    }
  }
  return out;
}

function roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole> {
  // A 3×3 has its square in the middle, a 4×4 in one of its four middle blocks, a 2×2 in any block.
  const { i0, j0, w, h } = q.grid;
  const n = city.config.blocks;
  const middle = q.blocks.filter((k) => { const i = k % n, j = Math.floor(k / n); return i > i0 && i < i0 + w - 1 && j > j0 && j < j0 + h - 1; });
  const square = w === 3 && h === 3 ? (j0 + 1) * n + (i0 + 1) : rng.pick(middle.length ? middle : q.blocks);
  return new Map([[square, 'square']]);
}

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
  clearOfWalls(buildings, wallPlan(q, city).solids);
  for (const b of buildings) {
    const r = rng.next();
    b.lot = r < OLD_CITY.ruinShare ? 'ruin' : r < OLD_CITY.ruinShare + OLD_CITY.stoneShare ? 'stoneHouse' : 'halfTimbered';
  }
  // Exactly one town hall: the most central building facing the square.
  const sq = squareBlock(q);
  const facing = facingSquare(q, city, buildings);
  if (sq === undefined || !facing.length) return;
  const c = city.blocks[sq].rect;
  const off = ({ b, side }: { b: Building; side: [number, number] }) => (side[0] ? Math.abs(b.z - c.z) : Math.abs(b.x - c.x));
  const best = facing.reduce((u, v) => (off(v) < off(u) || (off(v) === off(u) && v.b.w * v.b.d > u.b.w * u.b.d) ? v : u));
  best.b.lot = 'townHall';
  best.b.h = Math.max(best.b.h, OLD_CITY.townHallHeight);
  // Arcades along one other side of the square.
  const sides = [...new Set(facing.map((f) => f.side.join()))].filter((k) => k !== best.side.join());
  if (!sides.length) return;
  const side = rng.pick(sides);
  for (const f of facing) if (f.side.join() === side && f.b !== best.b) f.b.lot = 'arcade';
}

/** Modern street furniture that doesn't belong inside the walls (junction controls always stay). */
const DROP_SIGNS = new Set(['noParking', 'noSmoking', 'children', 'pedestrian', 'busStop']);
const drop = (p: StreetProp) =>
  p.kind === 'hydrant' || p.kind === 'bench' || p.kind === 'umbrella' || (p.kind === 'sign' && DROP_SIGNS.has(p.variant ?? ''));

export const OLD_CITY_DEF: DistrictDef = {
  kind: 'oldtown',
  label: 'Old City',
  salt: 0x01dc17,
  chance: OLD_CITY.chance,
  site: 'inland',
  shapes: [[2, 2], [2, 3], [3, 3], [3, 4], [4, 4]],
  rings: ['midtown', 'downtown', 'residential', 'industrial'], // any inner block; minCore keeps it central
  minCore: 0.5,
  gates: 'all',
  buildingStyle: { lots: [3, 5], height: [6, 14], gap: [0, 0.5], empty: 0 },
  looks: OLD_CITY_LOOKS(),
  roles,
  lots,
  drop,
  swap: { lamp: 'oilLamp' },
  keepZebras: false,
  traffic: { speed: OLD_CITY.speed, speedOn: 'all', density: OLD_CITY.density, heavy: false },
  copSpawnSkip: OLD_CITY.copSpawnSkip,
  roadblockGates: true,
  mapColor: 0xb3a68c,
  dress,
};

function OLD_CITY_LOOKS(): Record<OldCityLot, LotLook> {
  const plaster = [0xf2ead8, 0xeadfc6, 0xf0e4cc, 0xe6d8bc, 0xf4eee0, 0xe9d9c4];
  const stone = [0xd8ccb2, 0xcfc1a4, 0xe0d4bc, 0xc8b898];
  const tiles = [0x8a3b2a, 0x7a3626, 0x6e3a28, 0x94503a, 0x5e4436];
  return {
    halfTimbered: { facade: 'halfTimber', roof: 'steepGable', palette: plaster, roofTiles: tiles, trims: ['jetty', 'chimney'] },
    stoneHouse: { facade: 'ashlar', roof: 'steepGable', roofAlt: 'hip', palette: stone, roofTiles: tiles, trims: ['chimney'] },
    townHall: { facade: 'ashlar', roof: 'hip', palette: [0xe4d8c0, 0xdccdb0], roofTiles: [0x4f5560, 0x55504a], trims: ['clockTower'] },
    arcade: { facade: 'ashlar', roof: 'steepGable', palette: stone, roofTiles: tiles, trims: ['colonnade', 'chimney'] },
    ruin: { facade: 'ashlar', roof: 'flat', palette: stone }, // ruins become structures (see dress)
  };
}

/** Kerb clutter inside the walls. */
const CLUTTER: PropKind[] = ['pot', 'pot', 'barrels', 'cart', 'haybale', 'amphora'];
const AWNINGS = [0xb83a2e, 0x2e5a8a, 0xd8b23a, 0x3a7a4a, 0xe8e0cc, 0x8a3a6a];

function dress(q: District, city: CityData, rng: Rng): DistrictDressing {
  const plan = wallPlan(q, city);
  const out = { ...emptyDressing(), ...wallDressing(q, city, plan, rng), solids: [...plan.solids] };
  const landmarks: Landmark[] = [];
  const props: StreetProp[] = [];
  const mark = (kind: LandmarkKind, x: number, z: number, yaw: number) => landmarks.push({ kind, x, z, yaw, radius: LANDMARK_RADIUS[kind] });

  // --- Ruins: the lot is a broken shell of stone, solid, sometimes round a fallen column or arch ---
  const ruins = city.buildings.filter((b) => b.district === 'oldtown' && b.lot === 'ruin' && inRect(q.bounds, b));
  city.buildings = city.buildings.filter((b) => !ruins.includes(b));
  for (const b of ruins) {
    const fp = rectFootprint(b);
    // Wall heights round the shell, in ~1.5 m stones: jagged, highest at a corner.
    const heights = Array.from({ length: Math.max(8, Math.round((b.w + b.d) * 2 / 1.5)) }, () => rng.range(0.6, 1) ** 2);
    // Low broken walls, so what stands inside shows over them.
    out.structures.push({ kind: 'ruin', x: b.x, z: b.z, yaw: 0, footprints: [fp], data: { w: b.w, d: b.d, h: Math.min(b.h * 0.3, OLD_CITY.ruinWall), heights } });
    out.solids.push(fp);
    if (Math.min(b.w, b.d) >= 7) {
      const kind = rng.next() < 0.5 ? 'column' : 'ruinArch';
      rng.next(); // was the arch's random turn: kept so the rest of the district's stream doesn't move
      // An arch faces the nearest street: it runs along the block side closest to the lot.
      const r = q.blocks.map((k) => city.blocks[k].rect).find((br) => inRect(br, b))!;
      const toX = r.w / 2 - Math.abs(b.x - r.x); // to the nearest side across X
      const toZ = r.d / 2 - Math.abs(b.z - r.z);
      mark(kind, b.x, b.z, toZ <= toX ? 0 : Math.PI / 2);
    }
  }

  // --- The market square: cobbles round a well, the market cross and pillory, a ring of stalls ---
  const sq = squareBlock(q);
  if (sq !== undefined) {
    const block = city.blocks[sq];
    const c = block.rect;
    const well: Landmark = { kind: 'well', x: c.x, z: c.z, yaw: rng.range(0, Math.PI * 2), radius: LANDMARK_RADIUS.well };
    ({ buildings: city.buildings, trees: city.trees } = makeSquare(block, well, city.buildings, city.trees, city.config, false));
    landmarks.push(well);
    const inner = c.w / 2 - city.config.sidewalk;
    out.ground.push({ kind: 'cobbles', x: c.x, z: c.z, w: inner * 2, d: inner * 2 });
    const dir = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
    const cross = { x: c.x + dir[0] * OLD_CITY.crossOffset, z: c.z + dir[1] * OLD_CITY.crossOffset };
    mark('marketCross', cross.x, cross.z, rng.range(0, Math.PI * 2));
    props.push({ kind: 'pillory', x: cross.x + dir[1] * 6, z: cross.z - dir[0] * 6, yaw: Math.atan2(dir[0], dir[1]) });
    // Cannons in the square's corners, pointing out.
    // Where the square is in the district's corner, its corner cannon steps in from the tower.
    const r = LANDMARK_RADIUS.cannon;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const k = [inner - 5, inner - 10].find((d) => !plan.solids.some((f) => footprintsOverlap(f, { x: c.x + sx * d, z: c.z + sz * d, hx: r, hz: r, yaw: 0 })));
      if (k !== undefined) mark('cannon', c.x + sx * k, c.z + sz * k, Math.atan2(sx, sz));
    }
    // Stalls round the well, facing in, clear of the cross and the pillory.
    const n = OLD_CITY.stalls;
    const start = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const p = { x: c.x + Math.sin(a) * OLD_CITY.stallRing, z: c.z + Math.cos(a) * OLD_CITY.stallRing };
      if (Math.hypot(p.x - cross.x, p.z - cross.z) < LANDMARK_RADIUS.marketCross + 5) continue;
      props.push({ kind: 'stall', ...p, yaw: a + Math.PI, color: rng.pick(AWNINGS) });
    }
    // A few crates of the market's leftovers by the stalls.
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(OLD_CITY.stallRing + 3, inner - 2);
      props.push({ kind: rng.pick(['barrels', 'amphora', 'pot', 'cannonballs'] as PropKind[]), x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r, yaw: rng.range(0, Math.PI * 2) });
    }
  }

  // --- Cannons just inside each gate, on the sidewalks either side, pointing out ---
  const W = OLD_CITY_WALLS;
  for (const g of q.gates) {
    const ix = Math.sin(g.yaw), iz = Math.cos(g.yaw);
    const lateral = city.config.roadWidth / 2 + city.config.sidewalk / 2;
    for (const side of [-1, 1]) {
      const at = W.thick + 3.5;
      mark('cannon', g.x + ix * at + iz * lateral * side, g.z + iz * at - ix * lateral * side, g.yaw + Math.PI);
    }
    // A pile of shot beside each pair.
    props.push({ kind: 'cannonballs', x: g.x + ix * (W.thick + 6.5) + iz * lateral, z: g.z + iz * (W.thick + 6.5) - ix * lateral, yaw: 0 });
  }

  // --- Finger posts at the inner junctions, on a sidewalk corner ---
  const s = city.config.sidewalk;
  for (const id of q.interior) {
    const node = city.graph.nodes[id];
    const [cx, cz] = rng.pick([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    const d = city.config.roadWidth / 2 + s / 2 + 0.6;
    props.push({ kind: 'signpost', x: node.x + cx * d, z: node.z + cz * d, yaw: rng.range(0, Math.PI * 2) });
  }

  // Everything solid so far: keep props and clutter off it.
  const solid: Footprint[] = [...out.solids, ...landmarks.map((l) => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 }))];
  const blocked = (p: StreetProp) => solid.some((f) => footprintsOverlap(propFootprint(p, 0.2), f));
  // Street furniture under a tower or a landmark goes (junction controls never do); junction
  // controls inside take the old iron posts.
  city.streetProps = city.streetProps.flatMap((p) => {
    if (isJunctionControl(p)) return [inDistrict(q, p) ? { ...p, style: 'old' as const } : p];
    return inDistrict(q, p) && blocked(p) ? [] : [p];
  });
  // The glow budget: thin the oil lamps evenly if they and the torches would pass it.
  const lamps = city.streetProps.filter((p) => p.kind === 'oilLamp' && inDistrict(q, p));
  const room = OLD_CITY.maxGlow - Math.min(OLD_CITY.maxTorches, 2 * q.gates.length);
  if (lamps.length > room) {
    const keep = new Set(lamps.filter((_, i) => Math.floor((i * room) / lamps.length) !== Math.floor(((i + 1) * room) / lamps.length)));
    city.streetProps = city.streetProps.filter((p) => !lamps.includes(p) || keep.has(p));
  }
  // Kerb clutter goes in last, round everything else.
  const kept: StreetProp[] = [];
  for (const p of props) {
    const fp = propFootprint(p, 0.2);
    if (blocked(p) || [...city.streetProps, ...kept].some((o) => inRect(q.bounds, o, 2) && footprintsOverlap(fp, propFootprint(o)))) continue;
    kept.push(p);
  }
  const clutter = kerbClutter(q, { ...city, streetProps: [...city.streetProps, ...kept] }, CLUTTER, rng).filter((p) => !blocked(p));
  return { ...out, landmarks, props: [...kept, ...clutter] };
}

export type { Structure };
