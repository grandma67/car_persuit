import { describe, expect, it } from 'vitest';
import { generateCity, type CityData } from '../CityGenerator';
import { fastStreets } from '../TrafficControl';
import { inRect } from '../lots';
import { pickDestinations } from '../../gameplay/MissionSystem';
import { Rng } from '../../core/Rng';
import { DISTRICTS } from '../../gameplay/balance';
import { emptyDressing, type District, type DistrictDef } from './District';
import { inDistrict, isJunctionControl, kerbClutter, perimeterWall } from './apply';
import { rollDistricts } from './place';
import { copSpawnSkips, districtOfNode, districtTraffic, roadblockGates } from './runtime';

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
        const n = city.graph.nodes[id];
        expect(skips(n.x, n.z)).toBe(q.kind === 'oldtown' ? 0.6 : 0);
      }
      for (const g of q.gates) expect(gates.has(g.edge)).toBe(q.kind === 'oldtown');
      for (const id of q.perimeter) expect(districtOfNode(city, id)).toBeUndefined();
      // Off the district's blocks there is no skip.
      expect(skips(q.bounds.x + q.bounds.w / 2 + 20, q.bounds.z)).toBe(0);
    }
  });

  it('with no definitions the city has no districts', () => {
    expect(generateCity(42).districts).toEqual([]);
  });
});

describe('district generation logic', () => {
  const blockOf = (city: CityData, k: number) => ({ i: k % city.config.blocks, j: Math.floor(k / city.config.blocks) });

  it.each(SEEDS)('seed %i: interior streets are exactly the roads between two district blocks', (seed) => {
    const city = withDistricts(seed);
    const n = city.config.blocks;
    const pitch = city.config.blockSize + city.config.roadWidth;
    for (const q of city.districts) {
      const mine = new Set(q.blocks);
      for (const r of city.roads) {
        // The two blocks either side of this road segment.
        const alongX = r.rect.w > r.rect.d;
        const toBlock = (x: number, z: number) => {
          const i = Math.floor((x + city.size / 2) / pitch);
          const j = Math.floor((z + city.size / 2) / pitch);
          return i >= 0 && j >= 0 && i < n && j < n ? j * n + i : -1;
        };
        const sides = alongX
          ? [toBlock(r.rect.x, r.rect.z - pitch / 2), toBlock(r.rect.x, r.rect.z + pitch / 2)]
          : [toBlock(r.rect.x - pitch / 2, r.rect.z), toBlock(r.rect.x + pitch / 2, r.rect.z)];
        const between = sides.every((k) => mine.has(k));
        expect(q.streets.has(`${r.a}>${r.b}`)).toBe(between);
        expect(q.streets.has(`${r.b}>${r.a}`)).toBe(between);
        // Roadworks never close one (placement rejects them inside).
        if (between) expect(city.graph.nodes[r.a].neighbors).toContain(r.b);
      }
      // Blocks are a w × h rectangle at the grid position.
      const cells = q.blocks.map((k) => blockOf(city, k));
      expect(new Set(cells.map((c) => c.i)).size).toBe(q.grid.w);
      expect(new Set(cells.map((c) => c.j)).size).toBe(q.grid.h);
      expect(Math.min(...cells.map((c) => c.i))).toBe(q.grid.i0);
      expect(Math.min(...cells.map((c) => c.j))).toBe(q.grid.j0);
    }
  });

  it.each(SEEDS)('seed %i: the main street is the longest straight run, and gates follow the definition', (seed) => {
    const city = withDistricts(seed);
    const nodes = city.graph.nodes;
    for (const q of city.districts) {
      const def = DEFS.find((d) => d.kind === q.kind)!;
      // Consecutive edges share a junction and keep the heading.
      const pairs = q.mainStreet.map((k) => k.split('>').map(Number));
      for (let i = 1; i < pairs.length; i++) expect(pairs[i][0]).toBe(pairs[i - 1][1]);
      // No straight run of interior streets is longer: walk every street both ways.
      let longest = 0;
      for (const key of q.streets) {
        let [a, b] = key.split('>').map(Number);
        let run = 1;
        for (;;) {
          const dx = nodes[b].x - nodes[a].x, dz = nodes[b].z - nodes[a].z;
          const next = nodes[b].neighbors.find((c) => q.streets.has(`${b}>${c}`) && Math.abs((nodes[c].x - nodes[b].x) - dx) < 1 && Math.abs((nodes[c].z - nodes[b].z) - dz) < 1);
          if (next === undefined) break;
          [a, b] = [b, next];
          run++;
        }
        longest = Math.max(longest, run);
      }
      expect(q.mainStreet.length).toBe(longest);
      const candidates = [...q.streets].filter((k) => {
        const [a, b] = k.split('>').map(Number);
        return q.perimeter.includes(a) && q.interior.includes(b);
      });
      if (def.gates === 'all') {
        expect(q.gates.map((g) => g.edge).sort()).toEqual(candidates.sort());
      } else {
        // The main street's ends on the perimeter, plus at most extraGates (or enough to make two).
        const ends = q.gates.filter((g) => q.mainStreet.includes(`${g.node}>${g.inner}`) || q.mainStreet.includes(`${g.inner}>${g.node}`));
        const mainEnds = candidates.filter((k) => {
          const [a, b] = k.split('>');
          return q.mainStreet.includes(k) || q.mainStreet.includes(`${b}>${a}`);
        });
        expect(ends.length).toBe(mainEnds.length);
        expect(q.gates.length - ends.length).toBeLessThanOrEqual(Math.max(def.extraGates ?? 0, 2 - mainEnds.length));
      }
      expect(new Set(q.gates.map((g) => g.edge)).size).toBe(q.gates.length);
    }
  });

  it.each(SEEDS)('seed %i: the perimeter wall closes round the district, open only at the gates', (seed) => {
    const city = withDistricts(seed);
    const s = city.config.sidewalk;
    for (const q of city.districts) {
      const { segments, corners } = perimeterWall(q, city);
      const ring = 2 * (q.bounds.w - 2 * s) + 2 * (q.bounds.d - 2 * s);
      const walled = segments.reduce((sum, w) => sum + Math.hypot(w.bx - w.ax, w.bz - w.az), 0);
      const crossings = [...q.streets].filter((k) => {
        const [a, b] = k.split('>').map(Number);
        return q.perimeter.includes(a) && !q.perimeter.includes(b);
      });
      const open = crossings.length * (city.config.roadWidth + 2 * s);
      expect(walled + open).toBeCloseTo(ring, 3);
      // Every segment lies on the wall line, inside the blocks, never on a road.
      const half = { x: q.bounds.w / 2 - s, z: q.bounds.d / 2 - s };
      for (const w of segments) {
        for (const [x, z] of [[w.ax, w.az], [w.bx, w.bz]]) {
          const onX = Math.abs(Math.abs(x - q.bounds.x) - half.x) < 1e-6;
          const onZ = Math.abs(Math.abs(z - q.bounds.z) - half.z) < 1e-6;
          expect(onX || onZ).toBe(true);
        }
        const mid = { x: (w.ax + w.bx) / 2, z: (w.az + w.bz) / 2 };
        expect(city.roads.some((r) => inRect(r.rect, mid, -0.01))).toBe(false);
      }
      expect(corners).toHaveLength(4);
      // Each gate sits in a gap of the wall, centred on its street.
      for (const g of q.gates) {
        const blocked = segments.some((w) => {
          const t = ((g.x - w.ax) * (w.bx - w.ax) + (g.z - w.az) * (w.bz - w.az)) / ((w.bx - w.ax) ** 2 + (w.bz - w.az) ** 2);
          const px = w.ax + (w.bx - w.ax) * t, pz = w.az + (w.bz - w.az) * t;
          return t > 0 && t < 1 && Math.hypot(px - g.x, pz - g.z) < 0.5;
        });
        expect(blocked).toBe(false);
      }
    }
  });

  it.each(SEEDS)('seed %i: district buildings stand in their lots, off the roads and sidewalks', (seed) => {
    const city = withDistricts(seed);
    const s = city.config.sidewalk;
    for (const q of city.districts) {
      for (const b of city.buildings.filter((x) => x.district === q.kind)) {
        const k = q.blocks.find((k) => inRect(city.blocks[k].rect, b));
        expect(k).toBeDefined();
        const r = city.blocks[k!].rect;
        expect(Math.abs(b.x - r.x) + b.w / 2).toBeLessThanOrEqual(r.w / 2 - s + 1e-6);
        expect(Math.abs(b.z - r.z) + b.d / 2).toBeLessThanOrEqual(r.d / 2 - s + 1e-6);
        if (q.kind === INLAND.kind) expect(b.lot).toBe('house');
        expect(q.roles.has(k!)).toBe(false);
      }
      // A role block of the coast stub is on the district's list.
      for (const [k] of q.roles) expect(q.blocks).toContain(k);
    }
  });
});
