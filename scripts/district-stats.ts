// District numbers over many seeds, without writing a throwaway test:
//   npm run stats -- oldtown [seeds=100]
// Placement rate forced on and natural, sizes, what a placed district holds on average, and the
// generation time with it forced on and off. Seeds are i * 7919 + 11, as in the tests.
import { generateCity, type CityData } from '../src/world/CityGenerator';
import type { DistrictKind } from '../src/world/districts/District';
import { inDistrict } from '../src/world/districts/apply';
import { DISTRICT_DEFS } from '../src/world/districts/index';

const count = <T>(items: T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((out, t) => ((out[key(t)] = (out[key(t)] ?? 0) + 1), out), {});
const avg = (rows: Record<string, number>[], n: number) => {
  const sum: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
  return Object.fromEntries(Object.entries(sum).sort(([, a], [, b]) => b - a).map(([k, v]) => [k, +(v / n).toFixed(1)]));
};

export default function ([kind = DISTRICT_DEFS[0]?.kind, arg = '100']: string[]): void {
  const n = arg.replace(/^seeds=/, ''); // `seeds=100` or `100`
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
    generateMs: { on: +(tOn / seeds.length).toFixed(1), off: +(tOff / seeds.length).toFixed(1) },
  };
  console.log(JSON.stringify(out, null, 2));
}
