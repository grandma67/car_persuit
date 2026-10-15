import { describe, expect, it } from 'vitest';
import { generateCity, type CityData } from '../CityGenerator';
import { fastStreets } from '../TrafficControl';
import { inRect } from '../lots';
import { pickDestinations } from '../../gameplay/MissionSystem';
import { Rng } from '../../core/Rng';
import { DISTRICTS } from '../../gameplay/balance';
import { emptyDressing, type District, type DistrictDef } from './District';
import { inDistrict, isJunctionControl, kerbClutter } from './apply';
import { rollDistricts } from './place';
import { copSpawnSkips, districtNames, districtOfNode, districtTraffic, roadblockGates } from './runtime';

const base = {
  looks: {},
  roles: () => new Map(),
  lots: () => {},
  swap: {},
  keepZebras: false,
  traffic: { density: 1, heavy: true },
  copSpawnSkip: 0,
  roadblockGates: false,
  mapColor: 0xffffff,
};

/** Old City-like: a walled block cluster in the middle ring. */
const INLAND: DistrictDef = {
  ...base,
  kind: 'oldtown',
  label: 'Inland stub',
  salt: 0x11aa22,
  chance: 0.55,
  site: 'inland',
  shapes: [[2, 2], [3, 3]],
  rings: ['midtown', 'downtown'],
  minShare: { midtown: 0.5 },
  gates: 'all',
  buildingStyle: { lots: [3, 5], height: [6, 14], gap: [0, 0.5], empty: 0 },
  lots: (_q, buildings) => buildings.forEach((b) => (b.lot = 'house')),
  drop: (p) => p.kind === 'hydrant' || p.kind === 'bench' || (p.kind === 'sign' && p.variant === 'busStop'),
  traffic: { speed: 8.3, density: 0.5, heavy: false },
  dress: (q, city, rng) => ({ ...emptyDressing(), props: kerbClutter(q, city, ['cone'], rng) }),
};

/** Harbor-like: a coast cluster with a frontage on the sea. */
const COAST: DistrictDef = {
  ...base,
  kind: 'harbor',
  label: 'Coast stub',
  salt: 0x33bb44,
  chance: 0.45,
  site: 'coast',
  shapes: [[3, 2], [4, 2]],
  rings: ['industrial', 'residential'],
  minShare: { industrial: 0.5 },
  gates: 'mainStreet',
  extraGates: 1,
  buildingStyle: { lots: [1, 2], height: [7, 14], gap: [2, 4], empty: 0.2 },
  drop: (p) => p.kind === 'bench',
  roles: (q) => new Map([[q.blocks[0], 'yard']]),
  dress: () => emptyDressing(),
};

const DEFS = [INLAND, COAST];
const ON = { oldtown: true, harbor: true };
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);

const withDistricts = (seed: number) => generateCity(seed, undefined, { defs: DEFS, force: ON });
const without = (seed: number) => generateCity(seed, undefined, { defs: [] });

function outside(city: CityData, districts: District[]) {
  const out = (p: { x: number; z: number }) => !districts.some((q) => inDistrict(q, p));
  return {
    buildings: city.buildings.filter(out),
    trees: city.trees.filter(out),
    props: city.streetProps.filter(out),
    landmarks: city.landmarks.filter(out),
    marks: city.roadMarks.filter(out),
    planters: city.props,
  };
}

describe('district rolls', () => {
  it('each roll comes out near its chance, and adding a definition leaves the others alone', () => {
    let inland = 0;
    let coast = 0;
    for (let seed = 0; seed < 500; seed++) {
      const one = rollDistricts(seed, [INLAND]).map((r) => r.def.kind);
      const both = rollDistricts(seed, DEFS).map((r) => r.def.kind);
      expect(both.filter((k) => k === 'oldtown')).toEqual(one);
      inland += one.length;
      coast += both.includes('harbor') ? 1 : 0;
    }
    expect(inland / 500).toBeCloseTo(INLAND.chance, 1);
    expect(coast / 500).toBeCloseTo(COAST.chance, 1);
  });

  it('URL overrides force a roll on or off', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(rollDistricts(seed, DEFS, ON)).toHaveLength(2);
      expect(rollDistricts(seed, DEFS, { oldtown: false, harbor: false })).toHaveLength(0);
    }
  });
});

describe('district placement', () => {
  it('places both stubs on most seeds', () => {
    const placed = SEEDS.map((s) => withDistricts(s).districts.length);
    expect(placed.filter((n) => n === 2).length).toBeGreaterThan(SEEDS.length * 0.6);
  });

  it.each(SEEDS)('seed %i: everything outside the districts is as without them', (seed) => {
    const a = withDistricts(seed);
    const b = without(seed);
    expect(outside(a, a.districts)).toEqual(outside(b, a.districts));
    expect(a.spawn).toEqual(b.spawn);
    expect(a.roads).toEqual(b.roads);
    expect(a.plazas).toEqual(b.plazas);
  });

  it.each(SEEDS)('seed %i: junction controls are untouched', (seed) => {
    const count = (c: CityData) => c.streetProps.filter(isJunctionControl).map((p) => `${p.kind}${p.variant ?? ''}${p.x},${p.z}`).sort();
    expect(count(withDistricts(seed))).toEqual(count(without(seed)));
  });

  it.each(SEEDS)('seed %i: every district passes the placement rules', (seed) => {
    const city = withDistricts(seed);
    const n = city.config.blocks;
    const nodes = city.graph.nodes;
    const fast = fastStreets(city.graph, city.streetProps);
    const spawnNode = city.graph.nearest(city.spawn.x, city.spawn.z);
    for (const q of city.districts) {
      const { i0, j0, w, h } = q.grid;
      // A full rectangle of blocks, marked, in the right zones.
      expect(q.blocks).toHaveLength(w * h);
      const def = DEFS.find((d) => d.kind === q.kind)!;
      for (const k of q.blocks) {
        expect(city.blocks[k].district).toBe(q.kind);
        expect(def.rings).toContain(city.blocks[k].zone);
        expect(city.blocks[k].square).toBeFalsy();
      }
      // No canal, quay or bridge junction; no spawn; no fast street inside.
      const all = [...q.interior, ...q.perimeter];
      expect(all).toHaveLength((w + 1) * (h + 1));
      for (const id of all) {
        const nd = nodes[id];
        expect(city.terrain.canals.some((c) => Math.abs((c.axis === 'x' ? nd.z : nd.x) - c.at) < c.half + 6)).toBe(false);
        expect(id).not.toBe(spawnNode.id);
      }
      for (const key of q.streets) expect(fast.has(key)).toBe(false);
      expect(city.landmarks.some((l) => l.kind === 'ramp' && inRect(q.bounds, l, 12))).toBe(false);
      // Gates: at least two, each an interior street with one end on the perimeter, at the wall line.
      expect(q.gates.length).toBeGreaterThanOrEqual(2);
      for (const g of q.gates) {
        expect(q.streets.has(g.edge)).toBe(true);
        expect(q.perimeter).toContain(g.node);
        expect(q.perimeter).not.toContain(g.inner);
        expect(g.opening).toBe(city.config.roadWidth + 2 * city.config.sidewalk);
        expect(Math.hypot(g.x - nodes[g.node].x, g.z - nodes[g.node].z)).toBeCloseTo(city.config.roadWidth / 2 + city.config.sidewalk, 6);
      }
      // Main street: a straight run of interior streets.
      expect(q.mainStreet.length).toBeGreaterThanOrEqual(1);
      for (const key of q.mainStreet) expect(q.streets.has(key)).toBe(true);
      const ends = q.mainStreet.flatMap((k) => k.split('>').map(Number));
      expect(new Set(ends.map((id) => nodes[id].x)).size === 1 || new Set(ends.map((id) => nodes[id].z)).size === 1).toBe(true);
      // Coast: long side on the outer row or column, frontage clear of canal mouths and bridges.
      if (def.site === 'coast') {
        const long = w >= h ? (j0 === 0 || j0 + h === n) : (i0 === 0 || i0 + w === n);
        expect(long).toBe(true);
        const f = q.frontage!;
        expect(f).toBeDefined();
        expect(city.terrain.bridges.some((b) => Math.abs(b.x - f.x) < (b.w + f.w) / 2 && Math.abs(b.z - f.z) < (b.d + f.d) / 2)).toBe(false);
        expect(city.terrain.canals.some((c) => (c.axis === 'x' ? Math.abs(c.at - f.z) < f.d / 2 + c.half : Math.abs(c.at - f.x) < f.w / 2 + c.half))).toBe(false);
      }
    }
    // Never within a block of each other.
    for (const a of city.districts) {
      for (const b of city.districts) {
        if (a === b) continue;
        const g = a.grid, o = b.grid;
        const near = g.i0 - 1 < o.i0 + o.w && o.i0 < g.i0 + g.w + 1 && g.j0 - 1 < o.j0 + o.h && o.j0 < g.j0 + g.h + 1;
        expect(near).toBe(false);
      }
    }
  });

  it.each(SEEDS)('seed %i: the overlay fills, drops and clutters by the definition', (seed) => {
    const city = withDistricts(seed);
    for (const q of city.districts) {
      const def = DEFS.find((d) => d.kind === q.kind)!;
      const inside = city.streetProps.filter((p) => inDistrict(q, p));
      for (const p of inside) if (def.drop(p)) expect(isJunctionControl(p) || (p.variant === 'busStop' && def.traffic.heavy)).toBe(true);
      if (!def.keepZebras) expect(city.roadMarks.some((m) => m.kind === 'crosswalk' && inRect(q.bounds, m))).toBe(false);
      const built = city.buildings.filter((b) => inRect(q.bounds, b));
      for (const b of built) expect(b.district).toBe(q.kind);
      // Role blocks stay empty.
      for (const [k] of q.roles) expect(built.some((b) => inRect(city.blocks[k].rect, b))).toBe(false);
      // Kerb clutter: off the roadway's middle, clear of the junction mouths.
      const { roadWidth: rw } = city.config;
      for (const p of q.dressing.props) {
        for (const key of q.streets) {
          const [a, b] = key.split('>').map((id) => city.graph.nodes[Number(id)]);
          const alongX = Math.abs(a.z - b.z) < 1;
          const lateral = alongX ? Math.abs(p.z - a.z) : Math.abs(p.x - a.x);
          const within = alongX ? Math.min(a.x, b.x) < p.x && p.x < Math.max(a.x, b.x) : Math.min(a.z, b.z) < p.z && p.z < Math.max(a.z, b.z);
          if (within) expect(lateral).toBeGreaterThanOrEqual(DISTRICTS.clutterMinOffset);
        }
        for (const id of q.interior) {
          const nd = city.graph.nodes[id];
          expect(Math.hypot(p.x - nd.x, p.z - nd.z)).toBeGreaterThan(rw / 2 + DISTRICTS.clutterGap - 1);
        }
      }
    }
  });

  it.each(SEEDS)('seed %i: at most one mission destination per district', (seed) => {
    const city = withDistricts(seed);
    const start = city.graph.nearest(city.spawn.x, city.spawn.z);
    const dests = pickDestinations(city.graph, new Rng(seed ^ 0xde57), start.id, undefined, (id) => districtOfNode(city, id));
    for (const q of city.districts) expect(dests.filter((d) => q.interior.includes(d.id)).length).toBeLessThanOrEqual(1);
  });

  it.each(SEEDS.slice(0, 10))('seed %i: runtime rules come from the definitions', (seed) => {
    const city = withDistricts(seed);
    const rules = districtTraffic(city, DEFS);
    const skips = copSpawnSkips(city, [{ ...INLAND, copSpawnSkip: 0.6 }, COAST]);
    const gates = roadblockGates(city, [{ ...INLAND, roadblockGates: true }, COAST]);
    for (const q of city.districts) {
      const def = DEFS.find((d) => d.kind === q.kind)!;
      for (const k of q.streets) {
        expect(rules.limits.get(k)).toBe(def.traffic.speed);
        expect(rules.noHeavy.has(k)).toBe(!def.traffic.heavy);
      }
      for (const id of q.interior) {
        expect(rules.nodes.get(id)).toBe(def.traffic);
        expect(districtOfNode(city, id)).toBe(q.kind);
        expect(skips.get(id) ?? 0).toBe(q.kind === 'oldtown' ? 0.6 : 0);
      }
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(q.kind === 'oldtown');
      for (const id of q.perimeter) expect(districtOfNode(city, id)).toBeUndefined();
    }
    expect(districtNames(city, DEFS).split(' · ').length).toBe(city.districts.length || 1);
  });

  it('with no definitions the city has no districts', () => {
    expect(generateCity(42).districts).toEqual([]);
  });
});
