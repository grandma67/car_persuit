// The Swamp's renderer: the witch house, its island and boardwalk merged into one vertex-coloured
// mesh (the district structures' settings); the windows and the cauldron's brew as glow instances
// (the lamp bulbs' unlit material: no light, no new program), green at night; bubbles rising in the
// brew; will-o'-the-wisps over the water on wisp nights (the fireflies' program). The pools draw
// with the city's shallow water (render/ShallowWater.ts).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SWAMP } from '../../gameplay/balance';
import type { CityData, Rect } from '../../world/CityGenerator';
import type { District } from '../../world/districts/District';
import { swampLook, swampPools, witchPool } from '../../world/districts/Swamp';
import { inRect, shrink } from '../../world/lots';
import { LIT_PROPS } from '../../world/StreetProps';
import { fireflies } from './fireflies';
import type { DistrictRenderContext, DistrictView } from './index';
import { airboat, boardwalk, swampJetty, witchHouse, witchIsland, type Pane } from './SwampWitch';
import { rowboat } from '../Landmarks';
import { GeometryBuilder } from '../../world/CityBuilder';

const BUBBLES = 6;

/** Unlit glow instances (the lamp bulbs' settings): one colour each, set per run. */
function glowMesh(shape: THREE.BufferGeometry, items: { m: THREE.Matrix4; c: THREE.Color }[], scene: THREE.Scene): THREE.InstancedMesh | null {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(shape, new THREE.MeshBasicMaterial({ toneMapped: false }), items.length);
  items.forEach(({ m, c }, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c);
  });
  scene.add(mesh);
  return mesh;
}

const turned = (p: Pane) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.tilt));

export function renderSwamp(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const solid: THREE.BufferGeometry[] = [];
  const panes: Pane[] = [];
  let cauldron: THREE.Vector3 | null = null;
  const pool = witchPool(city, q);
  if (pool) solid.push(...witchIsland(pool.x, pool.z, ctx.ground(pool.x, pool.z), snowy, city.seed));
  for (const s of q.dressing.structures) {
    if (s.kind !== 'witchHouse') continue;
    const house = witchHouse(s, ctx.ground(s.x, s.z), snowy);
    solid.push(...house.solid);
    panes.push(...house.panes);
    cauldron = house.cauldron;
  }
  for (const d of q.dressing.decks ?? []) solid.push(...boardwalk(d, city.terrain, snowy, city.seed));
  // The landing: the jetty, the airboat and the rowboat afloat (on the ice in the snow).
  const frozen = ctx.climate.name === 'snow';
  const surface = (x: number, z: number) => ctx.ground(x, z) + SWAMP.poolDepth;
  for (const s of q.dressing.structures) {
    if (s.kind === 'swampJetty') solid.push(...swampJetty(s, ctx.ground(s.x, s.z), snowy));
    else if (s.kind === 'airboat') solid.push(...airboat(s, surface(s.x, s.z), frozen));
    else if (s.kind === 'moored') solid.push(rowboat().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(s.x, surface(s.x, s.z) - (frozen ? 0.1 : 0.22), s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1))));
  }
  // The verges: mud over the sidewalks (patch lift), frozen white-grey in the snow.
  const flat = new GeometryBuilder();
  const mud = new THREE.Color(snowy ? 0xdfe4e8 : 0x5a4c38);
  for (const p of q.dressing.ground) if (p.kind === 'verge') flat.drape(p, 0.07, mud, city.terrain);
  // The blocks' ground: dark moss in the swamp, rank yellow-green grass in the marsh, cracked salt in
  // the desert, lusher by the beach, snow in the snow (over the park grass, a patch's lift).
  const look = swampLook(q);
  const bog = new THREE.Color(snowy ? 0xe4e8ec : ctx.climate.name === 'desert' ? 0xd6ccb4 : ctx.climate.name === 'beach' ? 0x557a3c : look === 'swamp' ? 0x4c5a32 : 0x7c8a4a);
  for (const k of q.blocks) flat.drape(shrink(city.blocks[k].rect, city.config.sidewalk), 0.07, bog, city.terrain);
  if (flat.positions.length) {
    const mesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // The windows: dark by day, a sickly green at night; the brew always glows a little.
  const night = ctx.lampGlow;
  const windowColour = new THREE.Color(0x1c2418).lerp(new THREE.Color(0x8aff5a).multiplyScalar(1.5), night);
  const brewColour = new THREE.Color(0x4a9a3a).lerp(new THREE.Color(0x9aff6a).multiplyScalar(1.7), night);
  const one = new THREE.Vector3(1, 1, 1);
  glowMesh(new THREE.BoxGeometry(1, 1, 0.02), panes.filter((p) => !p.round).map((p) => ({ m: new THREE.Matrix4().compose(p.pos, turned(p), new THREE.Vector3(p.w, p.h, 1)), c: windowColour })), scene);
  const round = panes.filter((p) => p.round).map((p) => ({ m: new THREE.Matrix4().compose(p.pos, turned(p), new THREE.Vector3(p.w, p.w, 1)), c: windowColour }));
  if (cauldron) round.push({ m: new THREE.Matrix4().compose(cauldron, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3(0.92, 0.92, 1)), c: brewColour });
  glowMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 14).rotateX(Math.PI / 2), round, scene);
  // Bubbles rising and popping in the brew (not frozen: a witch's fire keeps it going in the snow too).
  const bubbles = cauldron ? glowMesh(new THREE.SphereGeometry(0.07, 6, 4), Array.from({ length: BUBBLES }, () => ({ m: new THREE.Matrix4(), c: brewColour })), scene) : null;
  const m = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const size = new THREE.Vector3();
  // Will-o'-the-wisps over the pools on a wisp night, within the glow budget.
  const lit = city.streetProps.filter((p) => LIT_PROPS.has(p.kind) && inRect(q.bounds, p, 1)).length + panes.length + (cauldron ? 1 : 0);
  const spots: Rect[] = swampPools(city, q).map((w) => ({ x: w.x, z: w.z, w: w.rx, d: w.rx }));
  const wisps = ctx.night && q.features.wisps ? fireflies(spots, Math.max(0, Math.min(SWAMP.wisps, SWAMP.maxGlow - lit)), city.seed ^ 0x2b7d, scene, ctx.ground, { color: 0x9affd8, size: 0.6 }) : null;
  return {
    update(_dt, time) {
      if (wisps) wisps.value = time;
      if (!bubbles || !cauldron) return;
      for (let i = 0; i < BUBBLES; i++) {
        const t = (time * 0.8 + i / BUBBLES) % 1; // each rises and pops in turn
        const a = i * 2.4 + Math.floor(time * 0.8 + i / BUBBLES) * 1.7;
        at.set(cauldron.x + Math.cos(a) * 0.25, cauldron.y + t * 0.25, cauldron.z + Math.sin(a) * 0.25);
        const r = Math.sin(t * Math.PI) * (0.6 + 0.6 * ((i * 7) % 3) / 2);
        bubbles.setMatrixAt(i, m.compose(at, spin, size.copy(one).multiplyScalar(r)));
      }
      bubbles.instanceMatrix.needsUpdate = true;
    },
  };
}
