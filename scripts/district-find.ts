// Find seeds whose district has what you want to look at, instead of a throwaway search script:
//   npm run find -- harbor straddle:2 flatcar ship=container gallery=0 [seeds=60] [flat]
// Each condition is name:N (at least N), name=N (exactly N) or a bare name (at least 1); no < or >,
// which the shell would take for redirects. Names are
// counted over the district's structures, landmarks, district props, ground patches, buildings'
// lots and roles; `ship` / `size` compare the ship type and "WxH". `flat`: no hill, no canals (the
// physics sims' ground). Forces the district on (the others off). Seeds are i * 7919 + 11.
import { generateCity } from '../src/world/CityGenerator';
import type { DistrictKind } from '../src/world/districts/District';
import { DISTRICT_DEFS } from '../src/world/districts/index';

export default function ([kind = 'harbor', ...args]: string[]): void {
  if (!DISTRICT_DEFS.some((d) => d.kind === kind)) return void console.log(`unknown district "${kind}"`);
  const n = Number(args.find((a) => a.startsWith('seeds='))?.slice(6) ?? 60);
  const flat = args.includes('flat');
  const conds = args.filter((a) => !a.startsWith('seeds=') && a !== 'flat').map((a) => {
    const m = a.match(/^(\w+)([:=])?(.*)$/)!;
    return { name: m[1], op: m[2] ?? ':', value: m[3] || '1' };
  });
  const force = Object.fromEntries(DISTRICT_DEFS.map((d) => [d.kind, d.kind === kind]));
  const hits: string[] = [];
  for (let i = 0; i < n; i++) {
    const seed = i * 7919 + 11;
    const city = generateCity(seed, undefined, { force });
    const q = city.districts.find((d) => d.kind === (kind as DistrictKind));
    if (!q || (flat && (city.terrain.hill || city.terrain.canals.length))) continue;
    const counts: Record<string, number> = {};
    const add = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    q.dressing.structures.forEach((s) => add(s.kind));
    q.dressing.landmarks.forEach((l) => add(l.kind));
    q.dressing.props.forEach((p) => add(p.kind));
    q.dressing.ground.forEach((g) => add(g.kind));
    city.buildings.filter((b) => b.district === q.kind).forEach((b) => add(b.lot ?? '?'));
    [...q.roles.values()].forEach(add);
    const ship = (q.dressing.structures.find((s) => s.kind === 'ship')?.data as { type?: string } | undefined)?.type ?? '';
    const size = `${q.grid.w}x${q.grid.h}`;
    const ok = conds.every(({ name, op, value }) => {
      if (name === 'ship' || name === 'size') return (name === 'ship' ? ship : size) === value;
      const have = counts[name] ?? 0, want = Number(value);
      return op === ':' ? have >= want : have === want;
    });
    if (!ok) continue;
    const shown = conds.filter((c) => c.name !== 'ship' && c.name !== 'size').map((c) => `${c.name}=${counts[c.name] ?? 0}`).join(' ');
    hits.push(`${seed}  ${size}${ship ? ` ${ship}` : ''}${city.terrain.hill ? ' hill' : ''}${city.terrain.canals.length ? ' canals' : ''}  ${shown}`);
  }
  console.log(hits.length ? hits.join('\n') : 'no seed matched');
  console.log(`(${hits.length} of ${n} seeds; open with ?seed=N&debug&${kind}=1)`);
}
