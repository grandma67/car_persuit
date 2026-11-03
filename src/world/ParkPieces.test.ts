import { describe, expect, it } from 'vitest';
import { PARKS } from '../gameplay/balance';
import { generateCity, type Block, type CityData } from './CityGenerator';
import { rollParkPieces } from './ParkPieces';
import { footprintsOverlap, propFootprint } from './StreetProps';
import { onGround } from './Terrain';
import { inWater, shoreDistance, waterReach } from './Water';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const cities = SEEDS.map((seed) => generateCity({ seed }));
const ponds = (c: CityData) => c.parkPieces.filter((p) => p.kind === 'pond');
const blockOf = (c: CityData, [i, j]: [number, number]) => c.blocks[j * c.config.blocks + i];

describe('park pieces: rolls', () => {
  it('one draw per block: a park\'s roll depends on nothing else', () => {
    const blocks: Block[] = Array.from({ length: 40 }, (_, k) => ({ rect: { x: k * 72, z: 0, w: 60, d: 60 }, zone: 'residential', park: k % 3 === 0 }));
    const all = rollParkPieces(blocks, () => false, 9);
    // Taking parks away (a district over them) leaves the other parks' pieces as they were.
    const fewer = rollParkPieces(blocks.map((b, k) => (k < 12 ? { ...b, park: false } : b)), () => false, 9);
    expect([...fewer]).toEqual([...all].filter(([k]) => k >= 12));
    // A pin changes that park only.
    const k0 = blocks.findIndex((b) => b.park);
    const pinned = rollParkPieces(blocks, () => false, 9, new Map([[k0, 'pitch']]));
    expect(pinned.get(k0)).toBe('pitch');
    expect([...pinned].filter(([k]) => k !== k0)).toEqual([...all].filter(([k]) => k !== k0));
  });

  it('ponds and pitches come up near their chances', () => {
    const blocks: Block[] = Array.from({ length: 2000 }, () => ({ rect: { x: 0, z: 0, w: 60, d: 60 }, zone: 'residential', park: true }));
    const rolled = [...rollParkPieces(blocks, () => false, 4242).values()];
    expect(rolled.filter((k) => k === 'pond').length / 2000).toBeCloseTo(PARKS.pondChance, 1);
    expect(rolled.filter((k) => k === 'pitch').length / 2000).toBeCloseTo(PARKS.pitchChance, 1);
  });

  it('only in parks with no centrepiece and outside the districts; some seeds have ponds', () => {
    const breaks: string[] = [];
    for (const c of cities) {
      for (const p of c.parkPieces) {
        const b = blockOf(c, p.block);
        if (!b.park || b.district || b.square) breaks.push(`${c.seed} ${p.block}: not an ordinary park`);
        if (c.landmarks.some((l) => l.x === b.rect.x && l.z === b.rect.z)) breaks.push(`${c.seed} ${p.block}: has a centrepiece`);
      }
    }
    expect(breaks).toEqual([]);
    expect(cities.filter((c) => ponds(c).length).length).toBeGreaterThan(5);
  });
});

describe('park pieces: the pond', () => {
  it('inside its park\'s fence, on dry ground, its water in city.water', () => {
    const breaks: string[] = [];
    for (const c of cities) {
      for (const p of ponds(c)) {
        const w = p.water!;
        const b = blockOf(c, p.block);
        const half = c.config.blockSize / 2 - PARKS.fenceInset;
        const reach = waterReach(w);
        if (Math.abs(w.x - b.rect.x) + reach > half || Math.abs(w.z - b.rect.z) + reach > half) breaks.push(`${c.seed} ${p.block}: past the fence`);
        if (!onGround(c.terrain, w.x, w.z, reach)) breaks.push(`${c.seed} ${p.block}: over a canal`);
        if (!c.water.includes(w)) breaks.push(`${c.seed} ${p.block}: water missing`);
      }
    }
    expect(breaks).toEqual([]);
  });

  it('no trees near the water; only reeds stand in it, all at the edge; props don\'t overlap the boat', () => {
    const breaks: string[] = [];
    for (const c of cities) {
      for (const p of ponds(c)) {
        const w = p.water!;
        for (const t of c.trees) if (shoreDistance(w, t.x, t.z) > -PARKS.treeClear) breaks.push(`${c.seed} ${p.block}: tree by the water`);
        const near = c.streetProps.filter((q) => Math.hypot(q.x - w.x, q.z - w.z) < waterReach(w) + 6);
        for (const q of near) {
          if (q.kind === 'reeds' && Math.abs(shoreDistance(w, q.x, q.z)) > 1) breaks.push(`${c.seed} ${p.block}: reeds off the edge`);
          if (q.kind !== 'reeds' && inWater(w, q.x, q.z, -0.5)) breaks.push(`${c.seed} ${p.block}: ${q.kind} in the water`);
        }
        const boats = c.landmarks.filter((l) => l.kind === 'rowboat' && Math.hypot(l.x - w.x, l.z - w.z) < waterReach(w) + 4);
        if (boats.length !== 1) breaks.push(`${c.seed} ${p.block}: ${boats.length} boats`);
        for (const boat of boats) {
          if (shoreDistance(w, boat.x, boat.z) > -1) breaks.push(`${c.seed} ${p.block}: boat in the water`);
          const fp = { x: boat.x, z: boat.z, hx: boat.radius, hz: boat.radius, yaw: boat.yaw };
          for (const q of near) if (footprintsOverlap(fp, propFootprint(q))) breaks.push(`${c.seed} ${p.block}: ${q.kind} on the boat`);
        }
      }
    }
    expect(breaks).toEqual([]);
  });

  it('two benches face the water; a no-fishing sign faces away from it', () => {
    const breaks: string[] = [];
    for (const c of cities) {
      for (const p of ponds(c)) {
        const w = p.water!;
        const near = c.streetProps.filter((q) => shoreDistance(w, q.x, q.z) > -PARKS.signOut - 0.5);
        const benches = near.filter((q) => q.kind === 'bench');
        const signs = near.filter((q) => q.kind === 'sign' && q.variant === 'noFishing');
        if (benches.length !== 2 || signs.length !== 1) breaks.push(`${c.seed} ${p.block}: ${benches.length} benches, ${signs.length} signs`);
        const facing = (q: { x: number; z: number; yaw: number }) => Math.sin(q.yaw) * (w.x - q.x) + Math.cos(q.yaw) * (w.z - q.z);
        for (const q of benches) if (facing(q) <= 0) breaks.push(`${c.seed} ${p.block}: bench turned away`);
        for (const q of signs) if (facing(q) >= 0) breaks.push(`${c.seed} ${p.block}: sign facing the water`);
      }
    }
    expect(breaks).toEqual([]);
  });

  it('lily pads float well inside the water, apart', () => {
    const breaks: string[] = [];
    for (const c of cities) {
      for (const p of ponds(c)) {
        const pads = p.pads ?? [];
        if (!pads.length) breaks.push(`${c.seed} ${p.block}: no pads`);
        for (const a of pads) {
          if (shoreDistance(p.water!, a.x, a.z) < 1.2 + a.r) breaks.push(`${c.seed} ${p.block}: pad at the edge`);
          for (const b of pads) if (a !== b && Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r) breaks.push(`${c.seed} ${p.block}: pads overlap`);
        }
      }
    }
    expect(breaks).toEqual([]);
  });
});
