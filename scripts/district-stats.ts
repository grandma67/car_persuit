// District numbers over many seeds (instead of a throwaway test):
//   npm run stats -- <kind> [seeds=100]
//   npm run stats -- odds [seeds=300]
// <kind>: placement rate forced on and natural, shapes, gates, the first seeds that place it, what a
// placed district holds on average, lit props (lamps, lanterns) against its `maxGlow` (average and
// worst, the worst seed and shape; the renderer's own glows, such as bulbs, torches and fireflies,
// come on top), shallow water's share of each block (min, median, max), and generation ms with it
// forced on vs off.
// odds: how many districts a city gets with nothing forced, and each one's share: the odds line of
// knowledge/DISTRICTS.md, printed ready to paste.
// Seeds i * 7919 + 11 (the fixed 12-block grid). One line per key.
import { generateCity, type CityData } from '../src/world/CityGenerator';
import type { DistrictKind } from '../src/world/districts/District';
import { inDistrict } from '../src/world/districts/apply';
import { DISTRICT_DEFS } from '../src/world/districts/index';
import { LIT_PROPS } from '../src/world/StreetProps';
import { waterShare } from '../src/world/Water';

const count = <T>(items: T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((out, t) => ((out[key(t)] = (out[key(t)] ?? 0) + 1), out), {});
const avg = (rows: Record<string, number>[], n: number) => {
  const sum: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
  return Object.fromEntries(Object.entries(sum).sort(([, a], [, b]) => b - a).map(([k, v]) => [k, +(v / n).toFixed(1)]));
};

const NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** The odds line: districts per city with nothing forced, and each district's share. */
function odds(n: number): void {
  const byCount: number[] = [];
  const alone: Record<string, number> = {};
  const any: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const kinds = generateCity(i * 7919 + 11).districts.map((q) => q.kind);
    byCount[kinds.length] = (byCount[kinds.length] ?? 0) + 1;
    if (kinds.length === 1) alone[kinds[0]] = (alone[kinds[0]] ?? 0) + 1;
    for (const k of kinds) any[k] = (any[k] ?? 0) + 1;
  }
  const pc = (v = 0) => `${Math.round((v / n) * 100)}%`;
  const label = (k: string) => DISTRICT_DEFS.find((d) => d.kind === k)?.label ?? k;
  const sorted = (o: Record<string, number>) => Object.entries(o).sort(([, a], [, b]) => b - a);
  const counts = byCount.map((v, i) => (i === 1
    ? `one ${pc(v)} (${sorted(alone).map(([k, x]) => `${label(k)} ${pc(x)}`).join(', ')})`
    : `${NUMBER_WORDS[i] ?? i} ${pc(v)}`)).filter((_, i) => byCount[i] !== undefined);
  console.log(`Odds per seed (${n} seeds): ${counts.join(', ')}. Any one: ${sorted(any).map(([k, x]) => `${label(k)} ${pc(x)}`).join(', ')}.`);
}

export default function ([kind = DISTRICT_DEFS[0]?.kind, arg]: string[]): void {
  if (kind === 'odds') return odds(Number((arg ?? '300').replace(/^seeds=/, '')));
  const n = (arg ?? '100').replace(/^seeds=/, ''); // `seeds=100` or `100`
  if (!DISTRICT_DEFS.some((d) => d.kind === kind)) {
    console.log(`unknown district "${kind}"; registered: ${DISTRICT_DEFS.map((d) => d.kind).join(', ')}`);
    return;
  }
  const k = kind as DistrictKind;
  const seeds = Array.from({ length: Number(n) }, (_, i) => i * 7919 + 11);
  const placed: { seed: number; city: CityData }[] = [];
  let natural = 0;
  let tOn = 0;
  let tOff = 0;
  for (const seed of seeds) {
    let t0 = performance.now();
    const city = generateCity(seed, undefined, { force: { [k]: true } });
    tOn += performance.now() - t0;
    t0 = performance.now();
    generateCity(seed, undefined, { force: { [k]: false } });
    tOff += performance.now() - t0;
    if (city.districts.some((q) => q.kind === k)) placed.push({ seed, city });
    if (generateCity(seed).districts.some((q) => q.kind === k)) natural++;
  }
  const qs = placed.map(({ city }) => ({ city, q: city.districts.find((d) => d.kind === k)! }));
  const out = {
    kind,
    seeds: seeds.length,
    placedForced: `${placed.length} (${Math.round((placed.length / seeds.length) * 100)}%)`,
    placedNatural: `${natural} (${Math.round((natural / seeds.length) * 100)}%)`,
    shapes: count(qs, ({ q }) => `${q.grid.w}x${q.grid.h}`),
    gates: count(qs, ({ q }) => String(q.gates.length)),
    firstSeeds: placed.slice(0, 8).map((p) => p.seed),
    perDistrict: {
      lots: avg(qs.map(({ city, q }) => count(city.buildings.filter((b) => b.district === q.kind), (b) => b.lot ?? '?')), qs.length),
      landmarks: avg(qs.map(({ q }) => count(q.dressing.landmarks, (l) => l.kind)), qs.length),
      props: avg(qs.map(({ q }) => count(q.dressing.props, (p) => p.kind)), qs.length),
      streetProps: avg(qs.map(({ city, q }) => count(city.streetProps.filter((p) => inDistrict(q, p)), (p) => p.kind + (p.style ? `-${p.style}` : ''))), qs.length),
      structures: avg(qs.map(({ q }) => count(q.dressing.structures, (s) => s.kind)), qs.length),
      solids: +(qs.reduce((s, { q }) => s + q.dressing.solids.length, 0) / (qs.length || 1)).toFixed(1),
    },
    glow: (() => {
      const lit = qs.map(({ city, q }) => ({ q, n: city.streetProps.filter((p) => LIT_PROPS.has(p.kind) && inDistrict(q, p)).length }));
      const worst = lit.reduce((a, b) => (b.n > a.n ? b : a), lit[0] ?? { q: undefined, n: 0 });
      const max = DISTRICT_DEFS.find((d) => d.kind === k)?.maxGlow;
      return {
        litProps: +(lit.reduce((t, x) => t + x.n, 0) / (lit.length || 1)).toFixed(1),
        worst: worst.n,
        worstAt: worst.q ? `seed ${qs[lit.indexOf(worst)].city.seed} ${worst.q.grid.w}x${worst.q.grid.h}` : '-',
        maxGlow: max ?? 'not declared',
      };
    })(),
    // Shallow water inside each block's sidewalk line (pools, a lake, ponds): its share per block.
    water: (() => {
      const shares = qs.flatMap(({ city, q }) => q.blocks.map((b) => {
        const r = city.blocks[b].rect, s = city.config.sidewalk;
        const inner = { x: r.x, z: r.z, w: r.w - 2 * s, d: r.d - 2 * s };
        return waterShare(inner, city.water.filter((w) => Math.abs(w.x - r.x) <= r.w / 2 && Math.abs(w.z - r.z) <= r.d / 2));
      })).sort((a, b) => a - b);
      if (!shares.some((x) => x > 0)) return 'none';
      const pc = (x: number) => `${Math.round(x * 100)}%`;
      return { perBlock: `min ${pc(shares[0])}, median ${pc(shares[shares.length >> 1])}, max ${pc(shares[shares.length - 1])}`, dryBlocks: shares.filter((x) => x === 0).length };
    })(),
    generateMs: { on: +(tOn / seeds.length).toFixed(1), off: +(tOff / seeds.length).toFixed(1) },
  };
  for (const [key, v] of Object.entries(out)) {
    if (key !== 'perDistrict') console.log(`${key}: ${JSON.stringify(v)}`);
    else for (const [k, x] of Object.entries(v)) console.log(`${k}: ${JSON.stringify(x)}`);
  }
}
