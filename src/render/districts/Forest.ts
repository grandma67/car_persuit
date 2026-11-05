// The Forest's renderer: the forest floor over each block (a ground patch's lift), the dirt tracks
// and clearings on it and the lumber yard's gravel, in one vertex-coloured flat mesh (the Swamp's
// verges' settings); the set pieces merged into one vertex-coloured mesh (the district structures'
// settings); the log arch's name board on the Farm's sign plates (its own names); the campfire and
// the lookout's windows as glow instances (the lamp bulbs' unlit material). No new programs. The
// trees are ordinary tree props (PropSystem).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FOREST_NAMES } from '../../world/districts/ForestSet';
import { ranchGate } from './Farm';
import { farmSignMaterial } from './farmSigns';
import { boulder, fallenLog, firePit, gatePosts, stump, logLoader, logStack, logTruck, lookout, tent } from './ForestSet';
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
export function forestColours(climate: string): { floor: number; track: number; clearing: number; yard: number } {
  if (climate === 'snow') return { floor: 0xe6eaee, track: 0xb8b0a4, clearing: 0xeef0f2, yard: 0xc4c8cc };
  if (climate === 'desert') return { floor: 0xb49c74, track: 0xc8ac80, clearing: 0xbca47c, yard: 0xc8bca4 };
  if (climate === 'beach') return { floor: 0x4e6a34, track: 0x9a8460, clearing: 0x5e7a3c, yard: 0xb4a88e };
  return { floor: 0x3e4a2a, track: 0x6e5a40, clearing: 0x5a6a38, yard: 0x9a8e7a };
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
  // The lumber yard's open ground: gravel (trodden snow in the snow).
  const gravel = new THREE.Color(c.yard);
  for (const k of q.blocks) if (q.roles.get(k) === 'lumberyard') flat.drape(shrink(city.blocks[k].rect, city.config.sidewalk), GLADE_LIFT, gravel, city.terrain);
  if (flat.positions.length) {
    const mesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // The set pieces.
  const snowy = ctx.climate.snowRoofs;
  const solid: THREE.BufferGeometry[] = [];
  const signs: THREE.BufferGeometry[] = [];
  const fires: THREE.Vector3[] = [];
  const windows: THREE.Vector3[] = [];
  for (const s of q.dressing.structures) {
    const y = ctx.ground(s.x, s.z) - 0.05;
    if (s.kind === 'logStack') logStack(s, y, snowy, solid);
    else if (s.kind === 'logTruck') logTruck(s, y, snowy, solid);
    else if (s.kind === 'logLoader') logLoader(s, y, snowy, solid);
    else if (s.kind === 'lookout') windows.push(...lookout(s, y, snowy, solid));
    else if (s.kind === 'tent') tent(s, y, snowy, solid);
    else if (s.kind === 'firePit') fires.push(firePit(s, y, snowy, solid));
    else if (s.kind === 'gatePosts') gatePosts(s, ctx.ground, snowy, solid);
    else if (s.kind === 'logArch') ranchGate(s, snowy, solid, signs, false);
    else if (s.kind === 'fallenLog') fallenLog(s, y, snowy, solid);
    else if (s.kind === 'boulder') boulder(s, y, snowy, solid);
    else if (s.kind === 'stump') stump(s, y, snowy, solid);
  }
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (signs.length) scene.add(new THREE.Mesh(mergeGeometries(signs), farmSignMaterial(0.08 + ctx.lampGlow * 0.15, FOREST_NAMES)));
  // The campfire burns day and night; the lookout's windows light up at night.
  const night = ctx.lampGlow;
  const glow = (shape: THREE.BufferGeometry, at: THREE.Vector3[], color: THREE.Color) => {
    if (!at.length) return;
    const mesh = new THREE.InstancedMesh(shape, new THREE.MeshBasicMaterial({ toneMapped: false }), at.length);
    const m = new THREE.Matrix4();
    at.forEach((p, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      mesh.setColorAt(i, color);
    });
    scene.add(mesh);
  };
  glow(new THREE.ConeGeometry(0.32, 0.8, 6).translate(0, 0.2, 0), fires, new THREE.Color(0xff8a2a).multiplyScalar(1 + night * 0.8));
  glow(new THREE.BoxGeometry(1.2, 0.8, 0.04), windows.filter((_, i) => i % 2 === 0), new THREE.Color(0x384048).lerp(new THREE.Color(0xffc870).multiplyScalar(1.4), night));
  glow(new THREE.BoxGeometry(0.04, 0.8, 1.2), windows.filter((_, i) => i % 2 === 1), new THREE.Color(0x384048).lerp(new THREE.Color(0xffc870).multiplyScalar(1.4), night));
  return {};
}
