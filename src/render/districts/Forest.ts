// The Forest's renderer: the forest floor over each block (a ground patch's lift) and the dirt
// tracks on it, in one vertex-coloured flat mesh (the Swamp's verges' settings: no new program).
// The trees are ordinary tree props (PropSystem).
import * as THREE from 'three';
import type { CityData } from '../../world/CityGenerator';
import type { District } from '../../world/districts/District';
import { forestClearings, forestTracks } from '../../world/districts/Forest';
import { shrink } from '../../world/lots';
import { GeometryBuilder } from '../../world/CityBuilder';
import { drapePolyline } from '../geometry';
import type { DistrictRenderContext, DistrictView } from './index';

const FLOOR_LIFT = 0.07; // a patch's
const GLADE_LIFT = 0.09; // 2 cm over the floor
const TRACK_LIFT = 0.11; // and over a clearing

/** The floor and track colours per climate: needles and leaf litter, dirt; snow over both in the snow. */
export function forestColours(climate: string): { floor: number; track: number; clearing: number } {
  if (climate === 'snow') return { floor: 0xe6eaee, track: 0xb8b0a4, clearing: 0xeef0f2 };
  if (climate === 'desert') return { floor: 0xb49c74, track: 0xc8ac80, clearing: 0xbca47c };
  if (climate === 'beach') return { floor: 0x4e6a34, track: 0x9a8460, clearing: 0x5e7a3c };
  return { floor: 0x3e4a2a, track: 0x6e5a40, clearing: 0x5a6a38 };
}

export function renderForest(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const c = forestColours(ctx.climate.name);
  const flat = new GeometryBuilder();
  const floor = new THREE.Color(c.floor);
  for (const k of q.blocks) flat.drape(shrink(city.blocks[k].rect, city.config.sidewalk), FLOOR_LIFT, floor, city.terrain);
  const track = new THREE.Color(c.track);
  for (const t of forestTracks(q)) drapePolyline(flat, t.points, t.width, TRACK_LIFT, track, city.terrain);
  // A clearing: a disc of grass over the floor, at the track's lift (the track runs through it).
  const glade = new THREE.Color(c.clearing);
  for (const g of forestClearings(q)) {
    const n = 24;
    const ring = Array.from({ length: n + 1 }, (_, i) => ({ x: g.x + Math.cos((i / n) * Math.PI * 2) * g.r * 0.5, z: g.z + Math.sin((i / n) * Math.PI * 2) * g.r * 0.5 }));
    drapePolyline(flat, ring, g.r, GLADE_LIFT, glade, city.terrain);
  }
  if (flat.positions.length) {
    const mesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return {};
}
