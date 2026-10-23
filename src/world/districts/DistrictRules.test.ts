import { describe, expect, it } from 'vitest';
import { generateCity, type CityData } from '../CityGenerator';
import type { District } from './District';
import { DISTRICT_DEFS } from './index';
import { rollDistricts } from './place';
import {
  clutterOnCentreLine, controlsInSolids, districtSignature, districtsTouching, junctionControlChanges, lowOverhead,
  partialDistricts, propCollisions, solidsOnPaving,
} from './rules';

// The rules every real district keeps, each checked over all seeds in one test: a failure lists
// every break with its seed. A new district gets them all by registering in DISTRICT_DEFS.

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const KINDS = DISTRICT_DEFS.map((d) => d.kind);
/** Vehicles parked in the kerb lane: they stand in the road's edge by design. */
const KERB_PARKED = new Set(['wreck', 'parkedVan']);

const plain = new Map(SEEDS.map((seed) => [seed, generateCity(seed, undefined, { defs: [] })]));
type Run = { seed: number; c: CityData; q: District };
/** Every break of `rule` over the runs, labelled with its seed. */
const breaks = <T extends { seed: number }>(runs: T[], rule: (r: T) => string[]) => runs.flatMap((r) => rule(r).map((v) => `seed ${r.seed}: ${v}`));

for (const def of DISTRICT_DEFS) {
  describe(`${def.kind} keeps the district rules`, () => {
    const alone = (seed: number) => generateCity(seed, undefined, { force: Object.fromEntries(KINDS.map((k) => [k, k === def.kind])) });
    const runs: Run[] = SEEDS.flatMap((seed) => {
      const c = alone(seed);
      const q = c.districts.find((d) => d.kind === def.kind);
      return q ? [{ seed, c, q }] : [];
    });

    it('places on some seeds, in one of its listed shapes either way round', () => {
      expect(runs.length).toBeGreaterThan(0);
      const shapes = def.shapes.flatMap(([a, b]) => [`${a}x${b}`, `${b}x${a}`]);
      expect(breaks(runs, ({ q }) => (shapes.includes(`${q.grid.w}x${q.grid.h}`) ? [] : [`${q.grid.w}x${q.grid.h}`]))).toEqual([]);
    });

    it('nothing solid stands on a road, junction or plaza', () => {
      expect(breaks(runs, ({ c, q }) => solidsOnPaving(c, q))).toEqual([]);
    });

    it('junction controls are untouched, and clear of every solid', () => {
      expect(breaks(runs, ({ seed, c }) => junctionControlChanges(c, plain.get(seed)!))).toEqual([]);
      expect(breaks(runs, ({ c, q }) => controlsInSolids(c, q))).toEqual([]);
    });

    it('props stand clear of solids, landmarks, buildings and each other', () => {
      expect(breaks(runs, ({ c, q }) => propCollisions(c, q))).toEqual([]);
    });

    it('props keep clutterMinOffset from the centre line (kerb-parked vehicles aside)', () => {
      expect(breaks(runs, ({ c, q }) => clutterOnCentreLine(c, q.dressing.props.filter((p) => !KERB_PARKED.has(p.kind))))).toEqual([]);
    });

    it('everything overhead clears the tallest vehicle', () => {
      expect(breaks(runs, ({ q }) => lowOverhead(q))).toEqual([]);
    });

    it('generates the same district every time for a seed', () => {
      for (const { seed, c, q } of runs.slice(0, 5)) {
        const again = alone(seed);
        expect(districtSignature(again, again.districts.find((d) => d.kind === def.kind)!), `seed ${seed}`).toBe(districtSignature(c, q));
      }
    });
  });
}

describe('every district forced on', () => {
  const all = SEEDS.map((seed) => ({ seed, c: generateCity(seed, undefined, { force: Object.fromEntries(KINDS.map((k) => [k, true])) }) }));

  it('districts keep a block apart; each is whole or absent', () => {
    expect(breaks(all, ({ c }) => districtsTouching(c))).toEqual([]);
    expect(breaks(all, ({ c }) => partialDistricts(c, KINDS))).toEqual([]);
  });

  it('several share a city on most seeds', () => {
    expect(all.filter(({ c }) => c.districts.length >= 2).length).toBeGreaterThan(SEEDS.length / 2);
  });

  it.each(KINDS)('adding %s leaves the other rolls alone', (kind) => {
    const without = DISTRICT_DEFS.filter((d) => d.kind !== kind);
    const rolls = (seed: number, defs: typeof DISTRICT_DEFS) => rollDistricts(seed, defs).map((r) => r.def.kind).filter((k) => k !== kind);
    for (const seed of SEEDS) expect(rolls(seed, DISTRICT_DEFS), `seed ${seed}`).toEqual(rolls(seed, without));
  });
});
