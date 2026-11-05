import { describe, expect, it } from 'vitest';
import { SWAMP } from '../../gameplay/balance';
import { generateCity, type CityData } from '../CityGenerator';
import { alone, districtCities } from '../paramsTesting';
import { inRect, shrink } from '../lots';
import { softGroundOf, WADING } from '../softGround';
import { inWater, rimPoints, shoreDistance } from '../Water';
import { at } from './rules';
import { gateBlocks, mainGate, roleBlocks } from './Megapark';
import { swampFits, swampLook, swampPools, witchPool, SWAMP_DEF } from './Swamp';
import { coverage, poolArea } from './SwampPools';
import { DISTRICT_DEFS } from './index';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = alone('swamp');
const placed = SEEDS.flatMap((seed) => {
  const c = generateCity(seed, undefined, { force: ALONE });
  const q = c.districts.find((d) => d.kind === 'swamp');
  return q ? [[seed, c, q] as const] : [];
});
const inner = (c: CityData, k: number) => shrink(c.blocks[k].rect, c.config.sidewalk);

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart, other rolls unmoved) are in DistrictRules.test.ts.

describe('Swamp placement', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it.each(placed)('seed %i: on the island edge, residential and industrial, low flat ground, every block open ground', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    expect(i0 === 0 || j0 === 0 || i0 + w === n || j0 + h === n).toBe(true);
    for (const k of q.blocks) expect(['residential', 'industrial']).toContain(c.blocks[k].zone);
    expect(swampFits(q.bounds, c)).toBeUndefined();
    expect(q.blocks.every((k) => c.blocks[k].park)).toBe(true);
    expect(q.gates.length).toBeGreaterThanOrEqual(2);
  });

  it('turns down the flank of a hill', () => {
    const hill = { x: 0, z: 0, height: 20, rx: 300, rz: 300, yaw: 0 };
    const city = { terrain: { hill, canals: [], bridges: [], land: [] } } as unknown as CityData;
    expect(swampFits({ x: 150, z: 0, w: 130, d: 130 }, city)).toMatch(/rises/);
    expect(swampFits({ x: 420, z: 0, w: 130, d: 130 }, city)).toBeUndefined(); // off the hill
  });
});

describe('Swamp roles and pools', () => {
  it.each(placed)('seed %i: a landing by the main gate, the witch house farthest from it, the rest pools; no buildings yet', (_seed, c, q) => {
    expect(q.roles.size).toBe(q.blocks.length);
    const [landing] = roleBlocks(q, 'landing');
    const [witch] = roleBlocks(q, 'witch');
    expect(roleBlocks(q, 'landing')).toHaveLength(1);
    expect(roleBlocks(q, 'witch')).toHaveLength(1);
    expect(roleBlocks(q, 'pools')).toHaveLength(q.blocks.length - 2);
    const beside = gateBlocks(q, c, mainGate(q));
    if (beside.length) expect(beside).toContain(landing);
    const g = mainGate(q);
    const far = (k: number) => Math.hypot(c.blocks[k].rect.x - g.x, c.blocks[k].rect.z - g.z);
    for (const k of q.blocks) if (k !== landing) expect(far(k)).toBeLessThanOrEqual(far(witch) + 1e-6);
    expect(c.buildings.filter((b) => inRect(q.bounds, b))).toEqual([]);
  });

  it.each(placed)('seed %i: pools inside each block with a dry bank, apart, 35–60 % under water; the witch pool the biggest', (_seed, c, q) => {
    const pools = swampPools(c, q);
    const breaks: string[] = [];
    for (const k of q.blocks) {
      const room = shrink(inner(c, k), SWAMP.bank - 0.01);
      const mine = pools.filter((w) => inRect(c.blocks[k].rect, w));
      if (!mine.length) breaks.push(`no pool in block ${k}`);
      for (const w of mine) {
        if (w.depth !== SWAMP.poolDepth) breaks.push(`pool at ${at(w)} depth ${w.depth}`);
        for (const p of rimPoints(w, 64)) if (!inRect(room, p)) breaks.push(`pool at ${at(w)} past the bank at ${at(p)}`);
        for (const o of mine) {
          if (o === w) continue;
          if (rimPoints(w, 64).some((p) => shoreDistance(o, p.x, p.z) > -SWAMP.poolGap + 0.05)) breaks.push(`pools at ${at(w)} and ${at(o)} closer than the gap`);
        }
      }
      const share = coverage(inner(c, k), mine);
      if (share < 0.33 || share > 0.62) breaks.push(`block ${k} (${q.roles.get(k)}) ${(share * 100).toFixed(0)} % under water`);
    }
    expect(breaks).toEqual([]);
    const witch = witchPool(c, q)!;
    expect(witch).toBeDefined();
    for (const w of pools) if (w !== witch) expect(poolArea(w)).toBeLessThan(poolArea(witch));
  });

  it.each(placed.slice(0, 6))('seed %i: a car wades in the pools and drives soft mud on the banks', (_seed, c, q) => {
    const ground = softGroundOf(c, DISTRICT_DEFS, false)!;
    const w = witchPool(c, q)!;
    expect(ground.at(w.x, w.z)).toBe(WADING);
    // A bank point: in the block, out of every pool.
    const room = inner(c, roleBlocks(q, 'witch')[0]);
    const bank = { x: room.x + room.w / 2 - 0.5, z: room.z + room.d / 2 - 0.5 };
    expect(swampPools(c, q).some((p) => inWater(p, bank.x, bank.z))).toBe(false);
    expect(ground.at(bank.x, bank.z)).toEqual({ grip: SWAMP.mudGrip, drag: SWAMP.mudDrag });
  });
});

describe('Swamp looks and street', () => {
  it('pinned looks come true', () => {
    for (const look of ['swamp', 'marsh'] as const) {
      for (const [seed, , q] of districtCities('swamp', [`look=${look}`])) expect(swampLook(q), `seed ${seed}`).toBe(look);
    }
  });

  it.each(placed.slice(0, 8))('seed %i: no fences, umbrellas or bus stops; wooden lamps; nothing of the city\'s left inside the blocks', (_seed, c, q) => {
    const inside = c.streetProps.filter((p) => inRect(q.bounds, p));
    expect(inside.filter((p) => SWAMP_DEF.drop(p)).map(at)).toEqual([]);
    expect(inside.filter((p) => p.kind === 'lamp').map(at)).toEqual([]);
    const own = new Set(q.dressing.props);
    const loose = inside.filter((p) => !own.has(p) && q.blocks.some((k) => inRect(inner(c, k), p)) && !['signal', 'sign'].includes(p.kind));
    expect(loose.map((p) => `${p.kind} ${at(p)}`)).toEqual([]);
  });
});
