// The physics scene for scripts/rapier-bench.mjs: a real city's static collision boxes (buildings,
// district solids, plaza planters) and 40 car spots on road centre lines, written as JSON.
//   node scripts/run-ts.mjs scripts/rapier-scene.ts <out.json> [seed=11]
import { writeFileSync } from 'node:fs';
import { generateCity } from '../src/world/CityGenerator';

export default function ([out = 'rapier-scene.json', seed = '11']: string[]): void {
  const c = generateCity(Number(seed), undefined, { force: { oldtown: true } });
  const boxes = [
    ...c.buildings.map((b) => [b.x, b.h / 2, b.z, b.w / 2, b.h / 2, b.d / 2]),
    ...c.districts.flatMap((q) => q.dressing.solids.map((s) => [s.x, 5, s.z, s.hx, 5, s.hz])),
    ...c.props.map((p) => [p.x, 0.45, p.z, p.w / 2, 0.45, p.d / 2]),
  ];
  const spots = c.roads.slice(0, 40).map((r) => [r.rect.x, r.rect.z, r.rect.w > r.rect.d ? Math.PI / 2 : 0]);
  writeFileSync(out, JSON.stringify({ seed: Number(seed), boxes, spots }));
  console.log(`${boxes.length} static boxes, ${spots.length} car spots → ${out}`);
}
