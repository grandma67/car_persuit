// The Harbor at night: sodium floodlights on the yard masts and under the cranes' portals, blinking
// red aviation lights on the crane tops, the silo and the office mast, and the moored ship's deck
// and bridge lights (riding with it). Unlit, tone-map-free instances like the street lamps' bulbs,
// so no new shader program; the blink is one material colour per frame, not per light. At most
// HARBOR.maxGlow lights: aviation first, then masts, cranes, the ship.
import * as THREE from 'three';
import { HARBOR } from '../../gameplay/balance';
import type { Building, CityData } from '../../world/CityGenerator';
import type { District } from '../../world/districts/District';
import type { CraneData, ShipData } from '../../world/districts/HarborQuay';
import { controlRoom } from '../../world/districts/trims';
import { groundBase } from '../../world/Terrain';

type P = THREE.Vector3;
const SODIUM = new THREE.Color(0xffb050);
const RED = new THREE.Color(0xff2a1a);
const DECK = new THREE.Color(0xfff0c8);

function points(geo: THREE.BufferGeometry, at: P[], colour: THREE.Color, glow: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, at.length));
  mesh.count = at.length;
  const m = new THREE.Matrix4();
  const c = colour.clone().multiplyScalar(glow);
  at.forEach((p, i) => {
    mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    mesh.setColorAt(i, c);
  });
  mesh.frustumCulled = false;
  return mesh;
}

/** Build the lights (night runs only); returns the per-frame blink. */
export function harborLights(q: District, city: CityData, scene: THREE.Scene, ship: THREE.Mesh | null, ground: (x: number, z: number) => number, lampGlow: number): ((time: number) => void) | null {
  if (lampGlow <= 0) return null;
  const aviation: P[] = [];
  const masts: P[] = [];
  const cranes: P[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const s of q.dressing.structures) {
    if (s.kind === 'mast') {
      const y = ground(s.x, s.z) + 25.2;
      for (let k = 0; k < 6; k++) masts.push(V(s.x + Math.cos((k / 6) * Math.PI * 2) * 1.3, y, s.z + Math.sin((k / 6) * Math.PI * 2) * 1.3));
    }
    if (s.kind === 'crane') {
      const d = s.data as unknown as CraneData;
      const frame = new THREE.Matrix4().compose(V(s.x, d.base, s.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), s.yaw), V(1, 1, 1));
      for (const x of [-d.gauge / 2, d.gauge / 2]) for (const z of [d.land, d.water]) cranes.push(V(x * 0.8, d.portal - 0.3, z).applyMatrix4(frame));
      aviation.push(V(0, d.boom + 17.8, d.water - 4).applyMatrix4(frame));
      aviation.push(V(0, d.boom + 6.3, d.land - d.backreach + 5.5).applyMatrix4(frame));
    }
  }
  const footing = (b: Building) => groundBase(city.terrain, b.x, b.z, Math.max(b.w, b.d) / 2) - 0.3;
  for (const b of city.buildings) {
    if (b.district !== 'harbor' || !q.blocks.some((k) => Math.abs(b.x - city.blocks[k].rect.x) <= 30 && Math.abs(b.z - city.blocks[k].rect.z) <= 30)) continue;
    if (b.lot === 'silo') for (const e of [-1, 1]) aviation.push(V(b.x + (b.w >= b.d ? e * (b.w / 2 - 1) : 0), footing(b) + b.h + 4.5, b.z + (b.w >= b.d ? 0 : e * (b.d / 2 - 1))));
    if (b.lot === 'harborOffice') {
      const r = controlRoom(b);
      aviation.push(V(r.x, footing(b) + b.h + r.h + 6.6, r.z));
    }
  }
  // The ship's lights in its own frame: posts along the deck edges, the bridge front.
  const deck: P[] = [];
  const shipS = q.dressing.structures.find((s) => s.kind === 'ship');
  if (shipS && ship) {
    const d = shipS.data as unknown as ShipData;
    for (let x = -d.length / 2 + 10; x < d.length / 2 - 8; x += 14) for (const z of [-d.beam / 2 + 0.5, d.beam / 2 - 0.5]) deck.push(V(x, d.deck + 1.2, z));
    const aft = d.bow * -(d.length / 2 - d.length * 0.17);
    const h = d.type === 'container' ? 16 : 12;
    for (const z of [-d.beam / 2, -d.beam / 4, 0, d.beam / 4, d.beam / 2]) deck.push(V(aft + d.bow * 5.6, d.deck + h + 2, z));
    aviation.push(V(aft + d.bow * 2, d.deck + h + 9.2, 0)); // the mast top (a white lamp would do; red reads at night)
  }
  // Within the glow budget, in priority order.
  let left = HARBOR.maxGlow;
  const [av, ms, cr] = [aviation, masts, cranes].map((l) => {
    const n = Math.min(l.length, left);
    left -= n;
    return l.slice(0, n);
  });
  const dk = deck.slice(0, left);
  const glow = 0.4 + lampGlow * 1.4;
  const bulb = new THREE.OctahedronGeometry(0.35);
  const flood = new THREE.BoxGeometry(0.7, 0.18, 0.7);
  scene.add(points(flood, [...ms, ...cr], SODIUM, glow));
  const red = points(bulb, av, RED, glow);
  scene.add(red);
  if (ship && dk.length) ship.add(points(new THREE.OctahedronGeometry(0.22), dk, DECK, glow));
  const mat = red.material as THREE.MeshBasicMaterial;
  return (time) => mat.color.setScalar(time % 1.5 < 0.5 ? 1 : 0.06);
}
