// Every z-fighting overlap in building and prop geometry, with where to look (the tests stop at the
// first per kind; this lists them all). knowledge/DISTRICTS_LOOKS.md, "No z-fighting".
//   npm run zfight -- [seeds=40] [from=1] [limit=3] [only=<text>] [props] [words…]
// Buildings: the test's sweep (rolled cities, seeds from..from+seeds-1, a theme and climate per seed),
// or cities made from words (`chinatown snow`: makeCity, so a seed may move on, and says so).
// Per overlap: its key (`lot: meshes` or `lot | lot: meshes`), seed, building indices with their lot
// box (x z w d h), the tags, the plane's normal, a point in it and the area. `limit` caps the lines per
// key (the count is still given); `only` keeps keys containing that text. `props`: the prop models instead.
import { generateCity, type CityData } from '../src/world/CityGenerator';
import { makeCity } from '../src/world/makeCityParams';
import { buildingFights, describeOverlap, propFights, sweepLook } from '../src/world/zfight';

export default function (args: string[]): void {
  const opt = (name: string, def: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? def;
  const limit = Number(opt('limit', '3')), only = opt('only', '');
  const words = args.filter((a) => !a.includes('=') && a !== 'props');
  const counts = new Map<string, number>();
  const line = (key: string, text: string) => {
    if (only && !key.includes(only)) return;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n <= limit) console.log(`${key} | ${text}`);
  };

  if (args.includes('props')) {
    for (const f of propFights()) line(f.key, `${f.snowy ? 'snowy' : 'plain'} | ${describeOverlap(f.overlap)}`);
  } else {
    const from = Number(opt('from', '1')), seeds = Number(opt('seeds', '40'));
    for (let seed = from; seed < from + seeds; seed++) {
      let city: CityData;
      if (words.length) {
        city = makeCity(words, { seed }).city;
        if (city.seed !== seed) console.log(`(seed ${seed}: words moved it to ${city.seed})`);
      } else city = generateCity({ seed });
      const { theme, climate } = sweepLook(city.seed);
      for (const f of buildingFights(city, theme, climate, city.seed)) {
        const lots = f.buildings.map((i) => {
          const b = city.buildings[i];
          return `#${i} (${[b.x, b.z, b.w, b.d, b.h].map((v) => v.toFixed(2)).join(' ')})`;
        });
        line(f.key, `seed ${city.seed} ${climate.name} | ${lots.join(' ')} | ${describeOverlap(f.overlap)}`);
      }
    }
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  console.log(total ? `\n${total} overlaps:` : 'no z-fighting');
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${key}`);
}
