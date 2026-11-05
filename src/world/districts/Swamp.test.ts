import { describe, expect, it } from 'vitest';
import { SWAMP, WATER } from '../../gameplay/balance';
import { NavGrid } from '../../ai/NavGrid';
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
import { isJunctionControl } from './apply';
import { deckPoint, inDeck, type Deck } from '../Deck';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint } from '../StreetProps';
import { ALL_SPECS } from '../../vehicles/VehicleSpecs';

const deckFootprint = (d: Deck): Footprint => ({ x: d.x, z: d.z, hx: d.hx, hz: d.hz, yaw: d.yaw });

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

  it.each(placed.slice(0, 6))('seed %i: a car wades in the pools, drives soft mud on the banks and the island, firm boards on the boardwalk', (_seed, c, q) => {
    const ground = softGroundOf(c, DISTRICT_DEFS, false)!;
    const w = witchPool(c, q)!;
    const deck = q.dressing.decks![0];
    const across = { x: Math.cos(deck.yaw), z: -Math.sin(deck.yaw) }; // across the boardwalk
    const wet = { x: w.x + across.x * (SWAMP.witchIsland + 3), z: w.z + across.z * (SWAMP.witchIsland + 3) };
    expect(ground.at(wet.x, wet.z)).toBe(WADING);
    const isle = { x: w.x + across.x * (SWAMP.witchIsland - 1), z: w.z + across.z * (SWAMP.witchIsland - 1) };
    expect(ground.at(isle.x, isle.z)).toEqual({ grip: SWAMP.mudGrip, drag: SWAMP.mudDrag });
    expect(ground.at(deck.x, deck.z)).toBeNull();
    // A bank point: in the block, out of every pool.
    const room = inner(c, roleBlocks(q, 'witch')[0]);
    const bank = { x: room.x + room.w / 2 - 0.5, z: room.z + room.d / 2 - 0.5 };
    expect(swampPools(c, q).some((p) => inWater(p, bank.x, bank.z))).toBe(false);
    expect(ground.at(bank.x, bank.z)).toEqual({ grip: SWAMP.mudGrip, drag: SWAMP.mudDrag });
  });
});

describe('Swamp witch house', () => {
  it.each(placed)('seed %i: the house stands on the dry island, the boardwalk runs from the sidewalk line onto it, short of the porch', (_seed, c, q) => {
    const w = witchPool(c, q)!;
    const I = SWAMP.witchIsland;
    expect(w.island).toBe(I);
    const houses = q.dressing.structures.filter((s) => s.kind === 'witchHouse');
    expect(houses).toHaveLength(1);
    const solid = houses[0].footprints[0];
    const breaks: string[] = [];
    for (const [u, v] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const p = { x: solid.x + u * solid.hx * Math.cos(solid.yaw) + v * solid.hz * Math.sin(solid.yaw), z: solid.z - u * solid.hx * Math.sin(solid.yaw) + v * solid.hz * Math.cos(solid.yaw) };
      if (Math.hypot(p.x - w.x, p.z - w.z) > I - 0.3) breaks.push(`house corner off the island at ${at(p)}`);
    }
    const decks = q.dressing.decks ?? [];
    expect(decks).toHaveLength(1);
    const d = decks[0];
    if (d.hx * 2 < Math.max(...ALL_SPECS.filter((s) => s.body !== 'ramptruck').map((s) => s.halfExtents.x)) * 2 + 1) breaks.push(`boardwalk ${d.hx * 2} m wide`);
    const k = roleBlocks(q, 'witch')[0];
    const room = inner(c, k);
    const foot = deckPoint(d, 0, -d.hz), end = deckPoint(d, 0, d.hz);
    const onLine = Math.abs(Math.abs(foot.x - room.x) - room.w / 2) < 0.01 || Math.abs(Math.abs(foot.z - room.z) - room.d / 2) < 0.01;
    if (!onLine || !inRect(room, foot, 0.01)) breaks.push(`boardwalk starts at ${at(foot)}, not on the sidewalk line`);
    if (Math.hypot(end.x - w.x, end.z - w.z) > I - 1) breaks.push(`boardwalk ends at ${at(end)}, not on the island`);
    if (footprintsOverlap(deckFootprint(d), solid)) breaks.push('boardwalk runs into the house');
    for (const r of [...c.roads.map((r) => r.rect), ...c.intersections]) if (footprintsOverlap(deckFootprint(d), rectFootprint(r))) breaks.push(`boardwalk on the road at ${at(r)}`);
    expect(breaks).toEqual([]);
  });

  it.each(placed)('seed %i: pumpkins, lanterns and the totem on the dry island, clear of the house and the boardwalk; the boardwalk mouth clear', (_seed, c, q) => {
    const w = witchPool(c, q)!;
    const d = q.dressing.decks![0];
    const solid = q.dressing.structures.find((s) => s.kind === 'witchHouse')!.footprints[0];
    const mine = q.dressing.props.filter((p) => ['pumpkin', 'jackOLantern', 'scarecrow'].includes(p.kind));
    expect(mine.filter((p) => p.kind === 'jackOLantern')).toHaveLength(2);
    expect(mine.filter((p) => p.kind === 'pumpkin').length).toBeGreaterThanOrEqual(SWAMP.pumpkins[0] - 2);
    const breaks: string[] = [];
    for (const p of mine) {
      if (inWater(w, p.x, p.z)) breaks.push(`${p.kind} in the water at ${at(p)}`);
      if (footprintsOverlap(propFootprint(p), solid) || inDeck(d, p.x, p.z, 0.3)) breaks.push(`${p.kind} on the house or boardwalk at ${at(p)}`);
    }
    const foot = deckPoint(d, 0, -d.hz);
    const loose = c.streetProps.filter((p) => !isJunctionControl(p) && Math.hypot(p.x - foot.x, p.z - foot.z) < d.hx + 0.5 + c.config.sidewalk);
    breaks.push(...loose.map((p) => `${p.kind} at the boardwalk's mouth ${at(p)}`));
    expect(breaks).toEqual([]);
  });

  it.each(placed.slice(0, 4))('seed %i: cops route over the boardwalk as firm ground, the water round it costly', (_seed, c, q) => {
    const grid = new NavGrid(c);
    const d = q.dressing.decks![0];
    const w = witchPool(c, q)!;
    const cell = (x: number, z: number) => grid.costAt(x, z);
    const across = { x: Math.cos(d.yaw), z: -Math.sin(d.yaw) };
    const wet = { x: w.x + across.x * (SWAMP.witchIsland + 4), z: w.z + across.z * (SWAMP.witchIsland + 4) };
    expect(cell(d.x, d.z)).toBeGreaterThan(0);
    expect(cell(d.x, d.z) + WATER.navPenalty / 2).toBeLessThan(cell(wet.x, wet.z));
  });

  it('pinned wisps come true, on and off', () => {
    for (const on of [true, false]) {
      for (const [seed, , q] of districtCities('swamp', [on ? 'wisps' : '!wisps', 'night'])) expect(q.features.wisps, `seed ${seed}`).toBe(on);
    }
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
