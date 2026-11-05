// Triangle counts per prop model, building kind and vehicle, for knowledge/polygons.md.
//   npm run polygons -- [seeds=20] [props|buildings|cars]
// Props: triangles of one instance of each model (plain look), and how many a rolled city places on
// average (`city.streetProps` only: park trees and umbrellas come from the build, see the browser eval),
// so tris × count is what the model costs a city. Buildings: triangles per building by lot kind (zone,
// or district/lot) over rolled cities plus a city made for each district, mean and max. Cars: the
// triangles of each vehicle spec's mesh (all parts, wheels included).
import * as THREE from 'three';
import { Rng } from '../src/core/Rng';
import { buildingGeometry, buildingReach } from '../src/world/CityBuilder';
import { generateCity, type CityData } from '../src/world/CityGenerator';
import { makeCity } from '../src/world/makeCityParams';
import { buildModels, modelKey } from '../src/world/PropSystem';
import { PROP_LOOKS, sweepLook } from '../src/world/zfight';
import { ALL_SPECS } from '../src/vehicles/VehicleSpecs';
import { buildCarMesh } from '../src/vehicles/carMesh';

const DISTRICT_KINDS = ['oldtown', 'chinatown', 'harbor', 'farm', 'slums', 'megapark', 'swamp'];
const trisOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const pad = (s: string | number, n: number) => String(s).padStart(n);

function cities(seeds: number): CityData[] {
  const out: CityData[] = [];
  for (let seed = 1; seed <= seeds; seed++) out.push(generateCity({ seed }));
  for (const kind of DISTRICT_KINDS) for (let seed = 1; seed <= Math.max(2, seeds / 5); seed++) out.push(makeCity([kind], { seed }).city);
  return out;
}

function props(seeds: number): void {
  const models = buildModels(PROP_LOOKS[0]);
  const counts = new Map<string, number>();
  for (let seed = 1; seed <= seeds; seed++) {
    for (const p of generateCity({ seed }).streetProps) counts.set(modelKey(p), (counts.get(modelKey(p)) ?? 0) + 1);
  }
  const rows = Object.entries(models).map(([key, g]) => {
    const per = trisOf(g), n = (counts.get(key) ?? 0) / seeds;
    return { key, per, n, total: per * n };
  }).sort((a, b) => b.total - a.total || b.per - a.per);
  console.log(`## props (tris per instance; mean count in ${seeds} rolled cities; tris × count)`);
  for (const r of rows) console.log(`${r.key.padEnd(26)} ${pad(r.per, 6)} ${pad(r.n.toFixed(1), 8)} ${pad(Math.round(r.total), 9)}`);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  console.log(`${'all street props'.padEnd(26)} ${pad('', 6)} ${pad(rows.reduce((s, r) => s + r.n, 0).toFixed(0), 8)} ${pad(Math.round(sum), 9)}`);
}

function buildings(seeds: number): void {
  const by = new Map<string, number[]>();
  const perCity: number[] = [];
  let rolled = 0;
  for (const city of cities(seeds)) {
    const { theme, climate } = sweepLook(city.seed);
    const rng = new Rng(city.seed ^ 0x5eed);
    const reach = buildingReach(city.buildings);
    let cityTotal = 0;
    city.buildings.forEach((b, i) => {
      const { walls, roofs } = buildingGeometry({ ...city, buildings: [b] }, theme, climate, rng, [reach[i]]);
      let t = roofs.indices.length / 3;
      for (const w of walls.values()) t += w.indices.length / 3;
      const key = b.district ? `${b.district}/${b.lot}` : b.zone;
      (by.get(key) ?? by.set(key, []).get(key)!).push(t);
      cityTotal += t;
    });
    if (rolled++ < seeds) perCity.push(cityTotal);
  }
  console.log(`\n## buildings (tris per building: mean, max; n buildings seen)`);
  const rows = [...by].map(([key, ts]) => ({ key, mean: ts.reduce((s, t) => s + t, 0) / ts.length, max: Math.max(...ts), n: ts.length }));
  rows.sort((a, b) => b.mean - a.mean);
  for (const r of rows) console.log(`${r.key.padEnd(26)} ${pad(Math.round(r.mean), 6)} ${pad(r.max, 6)} ${pad(r.n, 6)}`);
  const mean = perCity.reduce((s, t) => s + t, 0) / perCity.length;
  console.log(`${'per rolled city'.padEnd(26)} ${pad(Math.round(mean), 6)} ${pad(Math.max(...perCity), 6)}`);
}

function cars(): void {
  console.log(`\n## vehicles (tris per car, all parts; meshes)`);
  for (const spec of ALL_SPECS) {
    const car = buildCarMesh(spec);
    let tris = 0, meshes = 0;
    car.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      tris += trisOf(m.geometry) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    });
    console.log(`${spec.name.padEnd(26)} ${pad(tris, 6)} ${pad(meshes, 6)}`);
  }
}

export default function (args: string[]): void {
  const seeds = Number(args.find((a) => a.startsWith('seeds='))?.slice(6) ?? 20);
  const only = args.find((a) => ['props', 'buildings', 'cars'].includes(a));
  if (!only || only === 'props') props(seeds);
  if (!only || only === 'buildings') buildings(seeds);
  if (!only || only === 'cars') cars();
}
