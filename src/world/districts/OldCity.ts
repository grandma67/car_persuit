// The Old City: a walled medieval core in the middle ring. Tight street walls of half-timbered and
// stone houses, a market square with the town hall facing it, ruins, slow traffic and no heavies.
// Pure data; drawn by render/districts/OldCity.ts.
import type { Rng } from '../../core/Rng';
import { OLD_CITY } from '../../gameplay/balance';
import type { Block, Building, CityData } from '../CityGenerator';
import type { StreetProp } from '../StreetProps';
import { emptyDressing, type BlockRole, type District, type DistrictDef } from './District';

export type OldCityLot = 'halfTimbered' | 'stoneHouse' | 'townHall' | 'ruin';

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
  // A 3×3 has its square in the middle; a 2×2 in any of its blocks.
  const { i0, j0, w, h } = q.grid;
  const n = city.config.blocks;
  const square = w === 3 && h === 3 ? (j0 + 1) * n + (i0 + 1) : rng.pick(q.blocks);
  return new Map([[square, 'square']]);
}

function lots(q: District, buildings: Building[], city: CityData, rng: Rng): void {
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
  shapes: [[2, 2], [3, 3]],
  rings: ['midtown', 'downtown'],
  minShare: { midtown: 0.5 },
  gates: 'all',
  buildingStyle: { lots: [3, 5], height: [6, 14], gap: [0, 0.5], empty: 0 },
  looks: {}, // the midtown look until the Old City facades land
  roles,
  lots,
  drop,
  swap: {},
  keepZebras: false,
  traffic: { speed: OLD_CITY.speed, speedOn: 'all', density: OLD_CITY.density, heavy: false },
  copSpawnSkip: OLD_CITY.copSpawnSkip,
  roadblockGates: true,
  mapColor: 0xb3a68c,
  dress: () => emptyDressing(),
};
