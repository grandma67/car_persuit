// The Harbor's quay: the apron paving with its edge line and crane rails, fenders on the quay face,
// the gantry cranes (each merged, red and white, boom down over a container ship or raised when
// idle; trolley, cables, spreader and box move as four instances) and the moored ship (merged,
// bobbing gently, mooring lines to the bollards). Vertex-coloured, the district structures'
// material settings; no new shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONTAINER } from '../../gameplay/balance';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import { GeometryBuilder } from '../../world/CityBuilder';
import type { District, Structure } from '../../world/districts/District';
import { quayRow } from '../../world/districts/Harbor';
import { coastFrame, coastRect, quayLines, uOf, uSpan, type CraneData, type ShipData } from '../../world/districts/HarborQuay';
import { SEA_LEVEL } from '../Sea';
import type { DistrictRenderContext } from './index';

const RED = 0xb8322a;
const WHITE = 0xe8e6e0;
const STEEL = 0x4a4f54;
const RAIL = 0x3a3d40;
const RUBBER = 0x1c1c1e;
const GLASS = 0x2a3a48;
const SNOW = 0xeef2f6;
const YELLOW = 0xe0b62a;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);

/** A thin bar between two points. */
function bar(a: THREE.Vector3, b: THREE.Vector3, r: number, color: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = cyl(r, r, len, 4).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return part(g, color, a.x, a.y, a.z);
}

/** A crane in its frame (X along the rail, Z out to sea, footing at y = 0). */
function crane(d: CraneData, snowy: boolean): THREE.BufferGeometry {
  const g: THREE.BufferGeometry[] = [];
  const hx = d.gauge / 2;
  const top = d.boom; // girder underside
  for (const z of [d.land, d.water]) {
    for (const x of [-hx, hx]) {
      g.push(part(box(1.2, top, 1.2), WHITE, x, top / 2, z));
      g.push(part(box(1.26, 3, 1.26), RED, x, 1.5, z)); // a red foot band
      g.push(part(box(2.6, 0.9, 1.0), STEEL, x, 0.45, z)); // wheel bogie on the rail
    }
    // Ties along the rail: low (above a car's roof), at the portal and at the girder.
    for (const y of [6, d.portal + 0.8, top - 0.6]) g.push(part(box(d.gauge, 1.0, 0.9), RED, 0, y, z));
  }
  // The portal girders across the road (the overhead pieces), and the girder above.
  for (const x of [-hx, hx]) {
    g.push(part(box(1.0, 1.6, d.water - d.land), RED, x, d.portal + 0.8, (d.land + d.water) / 2));
    g.push(part(box(1.0, 1.4, d.water - d.land), RED, x, top - 0.7, (d.land + d.water) / 2));
  }
  // The trolley girder: two box beams from behind the landside legs to the waterside legs.
  const back = d.land - d.backreach;
  for (const x of [-2.2, 2.2]) g.push(part(box(1.0, 1.8, d.water - back), RED, x, top + 0.9, (back + d.water) / 2));
  // Snow on the girder.
  if (snowy) for (const x of [-2.2, 2.2]) g.push(part(box(1.0, 0.08, d.water - back), SNOW, x, top + 1.84, (back + d.water) / 2));
  // The machinery house on the back end.
  g.push(part(box(8, 4, 11), WHITE, 0, top + 1.8 + 2, back + 5.5));
  g.push(part(box(8.2, 0.3, 11.2), snowy ? SNOW : STEEL, 0, top + 1.8 + 4.15, back + 5.5));
  // The A-frame over the waterside legs, its back stays and the stay to the boom.
  const apex = new THREE.Vector3(0, top + 17, d.water - 4);
  for (const x of [-2.6, 2.6]) {
    g.push(bar(new THREE.Vector3(x, top + 1.8, d.water - 1), apex.clone().setX(x * 0.3), 0.35, WHITE));
    g.push(bar(new THREE.Vector3(x, top + 1.8, d.land), apex.clone().setX(x * 0.3), 0.3, WHITE));
  }
  g.push(part(box(2.2, 1.2, 1.2), RED, 0, apex.y, apex.z));
  // The boom: down over the berth when working, raised when idle.
  const boom: THREE.BufferGeometry[] = [];
  for (const x of [-2.2, 2.2]) boom.push(part(box(1.0, 1.6, d.outreach), RED, x, 0.8, d.outreach / 2));
  for (let z = 4; z < d.outreach; z += 6) boom.push(part(box(5.4, 0.3, 0.3), RED, 0, 0.1, z));
  boom.push(part(box(5.4, 0.8, 0.6), WHITE, 0, 0.8, d.outreach - 0.3));
  const raise = d.working ? 0 : -1.25; // ~72° up
  const hinge = new THREE.Matrix4().makeRotationX(raise).premultiply(new THREE.Matrix4().makeTranslation(0, top, d.water));
  const boomGeo = mergeGeometries(boom).applyMatrix4(hinge);
  g.push(boomGeo);
  // Stays from the apex to the boom's tip.
  const tip = new THREE.Vector3(0, 1.6, d.outreach).applyMatrix4(hinge);
  for (const x of [-2, 2]) g.push(bar(apex.clone().setX(x * 0.3), tip.clone().setX(x), 0.09, STEEL));
  // An idle crane parks its cab under the girder's back end.
  if (!d.working) g.push(...trolleyParts(d.land + 2, top));
  if (d.truck !== undefined) g.push(...truck(d.truck));
  return mergeGeometries(g);
}

/** A terminal tractor and its skeletal chassis on the apron along X at frame Z = z: the bed under the box (centred on X = 0), the cab at +X. */
function truck(z: number): THREE.BufferGeometry[] {
  const bed = CONTAINER.l40 + 0.6;
  const out = [
    part(box(bed, 0.35, 2.3), STEEL, 0, TRUCK_BED - 0.175, z), // chassis bed, its top where a box sits
    part(box(0.25, 0.9, 2.4), 0xd8b02a, -bed / 2 - 0.1, 1.0, z), // rear bumper bar
    part(box(3.0, 2.6, 2.4), 0x2f5f9a, bed / 2 + 1.7, 1.9, z), // cab
    part(box(1.0, 1.0, 2.42), GLASS, bed / 2 + 2.7, 2.5, z),
    part(box(3.4, 0.4, 2.42), STEEL, bed / 2 + 1.6, 0.75, z),
  ];
  for (const x of [-bed / 2 + 1.0, -bed / 2 + 2.3, bed / 2 - 1.2, bed / 2 + 2.4]) {
    for (const side of [-1, 1]) out.push(part(cyl(0.5, 0.5, 0.4, 10).rotateX(Math.PI / 2), RUBBER, x, 0.5, z + side * 1.0));
  }
  return out;
}

/** The trolley riding the girder with the driver's cab under it, at frame Z = z. */
function trolleyParts(z: number, top: number): THREE.BufferGeometry[] {
  return [
    part(box(5.6, 1.4, 5), STEEL, 0, top - 0.1, z),
    part(box(2.6, 2.4, 2.8), WHITE, 1.4, top - 2.6, z + 0.6),
    part(box(2.4, 1.0, 2.82), GLASS, 1.4, top - 3.0, z + 0.6),
  ];
}

/** The hull's plan: a transom stern at -X, the bow tapering to a point at +X. */
function hullShape(length: number, beam: number): THREE.Shape {
  const s = new THREE.Shape();
  const L = length / 2, B = beam / 2, bow = Math.min(beam * 1.3, length * 0.2);
  s.moveTo(-L, -B * 0.9);
  s.lineTo(-L + 3, -B);
  s.lineTo(L - bow, -B);
  s.quadraticCurveTo(L - bow * 0.25, -B * 0.85, L, 0);
  s.quadraticCurveTo(L - bow * 0.25, B * 0.85, L - bow, B);
  s.lineTo(-L + 3, B);
  s.lineTo(-L, B * 0.9);
  s.closePath();
  return s;
}

/** A slab of hull between two heights, plan from the shape, as a merge-ready part. */
function hullSlab(shape: THREE.Shape, y0: number, y1: number, color: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // the shape's plane onto the ground, extruded upwards
  return part(g, color, 0, y0);
}

const HULLS = [0x1f2c44, 0x1c1c1e, 0x1f3a2e, 0x5a1e1e, 0x2a4a7a];
const FUNNELS = [0xd8762a, 0x2f5f9a, 0xb03a2e, 0xe8c22a, 0x3f7a4a];

/** The ship in its frame: X along it, Z out to sea, y world height. Its cargo is placed by the data (bow side included). */
function ship(d: ShipData, seed: number, snowy: boolean): THREE.BufferGeometry {
  // The hull and its superstructure, built bow towards +X and turned end for end if the bow is at -X.
  const g: THREE.BufferGeometry[] = [];
  const shape = hullShape(d.length, d.beam);
  const waterline = SEA_LEVEL + 0.8;
  const hullColour = HULLS[seed % HULLS.length];
  g.push(hullSlab(shape, d.keel, waterline, 0x8a2a24)); // antifouling
  g.push(hullSlab(shape, waterline, d.deck, hullColour));
  // The deck, a little inside the hull's edge, and a white sheer line.
  const deck = hullSlab(shape, d.deck, d.deck + 0.05, snowy ? SNOW : 0x5a6a5a);
  deck.scale(0.98, 1, 0.94);
  g.push(deck);
  g.push(part(box(d.length * 0.8, 0.3, d.beam + 0.04), WHITE, -d.length * 0.05, d.deck - 0.6, 0));
  // Accommodation aft, the bridge on top with wings, the funnel behind.
  const aft = -(d.length / 2 - d.length * 0.17);
  const h = d.type === 'container' ? 16 : 12;
  g.push(part(box(12, h, d.beam - 6), WHITE, aft, d.deck + h / 2, 0));
  for (let y = d.deck + 2; y < d.deck + h - 1; y += 2.8) g.push(part(box(12.04, 0.9, d.beam - 5.96), GLASS, aft, y + 1.2, 0));
  g.push(part(box(7, 3, d.beam + 1), WHITE, aft + 2, d.deck + h + 1.5, 0)); // bridge and its wings
  g.push(part(box(7.04, 1.2, d.beam + 1.04), GLASS, aft + 2, d.deck + h + 2, 0));
  g.push(part(box(7.4, 0.25, d.beam + 1.4), snowy ? SNOW : STEEL, aft + 2, d.deck + h + 3.1, 0));
  const funnel = FUNNELS[(seed >> 3) % FUNNELS.length];
  g.push(part(box(5, 7, 5), funnel, aft - 7, d.deck + h - 1, 0));
  g.push(part(box(5.04, 1.2, 5.04), RUBBER, aft - 7, d.deck + h + 2.1, 0));
  g.push(part(box(0.3, 6, 0.3), STEEL, aft + 2, d.deck + h + 6, 0)); // mast
  g.push(part(box(10, 2.4, d.beam * 0.5), hullColour, d.length / 2 - 12, d.deck + 1.2, 0)); // forecastle
  const hull = mergeGeometries(g);
  if (d.bow < 0) hull.rotateY(Math.PI);

  const c: THREE.BufferGeometry[] = [hull];
  if (d.type === 'container') {
    // Hatch covers under each bay's boxes; the boxes themselves, snow on the top ones.
    for (const x of new Set(d.boxes.map((b) => b.x))) c.push(part(box(CONTAINER.l40 + 0.6, 0.6, d.beam - 2), 0x6a6e6a, x, d.deck + 0.3, 0));
    const tops = new Map<string, number>();
    for (const b of d.boxes) tops.set(`${b.x},${b.z}`, Math.max(tops.get(`${b.x},${b.z}`) ?? 0, b.tier));
    for (const b of d.boxes) {
      const colour = snowy && tops.get(`${b.x},${b.z}`) === b.tier ? SNOW : b.color;
      c.push(part(box(CONTAINER.l40 - 0.06, CONTAINER.h - 0.06, CONTAINER.w - 0.06), colour, b.x, d.deck + 0.6 + (b.tier + 0.5) * CONTAINER.h, b.z));
    }
  } else {
    // Hatch coamings and covers; deck cranes (bulk) or derrick posts with their booms (general cargo).
    const cover = d.type === 'bulk' ? 0x2f5f4a : 0x3a4a6a;
    for (const x of d.hatches) {
      c.push(part(box(11, 1.4, d.beam * 0.62), cover, x, d.deck + 0.7, 0));
      c.push(part(box(11.04, 0.12, d.beam * 0.62 + 0.04), snowy ? SNOW : 0x2a2a2a, x, d.deck + 1.45, 0));
    }
    const between = d.hatches.slice(1).map((x, i) => (x + d.hatches[i]) / 2);
    for (const [i, x] of between.entries()) {
      if (d.type === 'bulk') {
        c.push(part(cyl(1.4, 1.6, 8, 10), WHITE, x, d.deck + 4, 0));
        c.push(part(box(3, 2.4, 3), WHITE, x, d.deck + 9, 0));
        c.push(bar(new THREE.Vector3(x, d.deck + 9, 0), new THREE.Vector3(x + 14 * d.bow, d.deck + 18, (i % 2 ? 1 : -1) * 4), 0.4, YELLOW));
      } else {
        for (const z of [-2.5, 2.5]) c.push(part(box(0.7, 12, 0.7), WHITE, x, d.deck + 6, z));
        c.push(part(box(0.5, 0.5, 5.5), WHITE, x, d.deck + 11, 0));
        c.push(bar(new THREE.Vector3(x, d.deck + 1.5, 0), new THREE.Vector3(x + 10 * d.bow, d.deck + 9, 0), 0.22, STEEL));
      }
    }
  }
  if (d.tug) {
    // The tug off the outer side: a short hull, a tall wheelhouse, a black fender band; facing as the ship.
    const t = d.tug;
    const ts = hullShape(t.length, 8);
    const tug = mergeGeometries([
      hullSlab(ts, -3.5, waterline, 0x8a2a24),
      hullSlab(ts, waterline, 1.2, 0x1f2c44),
      part(box(t.length * 0.9, 0.6, 8.3), RUBBER, -0.5, 0.6, 0),
      part(box(8, 3, 6), WHITE, 0, 2.7, 0),
      part(box(5, 2.4, 5.6), WHITE, 1, 5.4, 0),
      part(box(5.04, 0.9, 5.64), GLASS, 1, 5.8, 0),
      part(box(1.6, 3, 1.6), funnel, -3, 5, 0),
    ]);
    if (d.bow < 0) tug.rotateY(Math.PI);
    c.push(tug.translate(t.x, 0, t.z));
  }
  return mergeGeometries(c);
}

export interface CraneMotion {
  cranes: { s: Structure; d: CraneData; frame: THREE.Matrix4; phase: number; centre: THREE.Vector3 }[];
  trolley: THREE.InstancedMesh;
  cables: THREE.InstancedMesh;
  spreader: THREE.InstancedMesh;
  box: THREE.InstancedMesh;
}

/** Spreader height (above the footing) when hoisted. */
const HOIST = (d: CraneData) => d.boom - 4.5;
const TRUCK_BED = 1.55;
const CYCLE = 44; // seconds: ship → truck and back is two cycles

/** Where a working crane's trolley, spreader (its underside) and box are at time t, in its frame; the box carried or resting. */
function craneAt(d: CraneData, t: number): { z: number; y: number; carried: boolean; restZ: number; restY: number } {
  const ship = d.ship!, truck = d.truck!;
  const deckY = d.deckTop!;
  const high = HOIST(d);
  const n = Math.floor(t / CYCLE);
  const u = t - n * CYCLE;
  // Odd cycles carry ship → truck, even ones truck → ship.
  const outbound = n % 2 === 0;
  const [from, to] = outbound ? [ship, truck] : [truck, ship];
  // Box bottoms where it's picked up and set down; the spreader comes down onto its top.
  const [fromY, toY] = outbound ? [deckY, TRUCK_BED] : [TRUCK_BED, deckY];
  const [fromS, toS] = [fromY + CONTAINER.h, toY + CONTAINER.h];
  const ease = (k: number) => k * k * (3 - 2 * k);
  const seg = (a: number, b: number) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))));
  // 0–6 lower, 6–8 lock, 8–14 hoist, 14–24 travel, 24–30 lower, 30–32 release, 32–38 hoist, 38–44 travel back.
  let z: number, y: number;
  if (u < 14) (z = from), (y = u < 8 ? high + (fromS - high) * seg(0, 6) : fromS + (high - fromS) * seg(8, 14));
  else if (u < 24) (z = from + (to - from) * seg(14, 24)), (y = high);
  else if (u < 38) (z = to), (y = u < 32 ? high + (toS - high) * seg(24, 30) : toS + (high - toS) * seg(32, 38));
  else (z = to + (from - to) * seg(38, 44)), (y = high);
  const carried = u >= 6 && u < 30;
  // At rest, the box waits where it was set down.
  const restZ = u < 6 ? from : to;
  const restY = u < 6 ? fromY : toY;
  return { z, y, carried, restZ, restY };
}

export function renderQuay(q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): { update(dt: number, time: number, camera: THREE.Camera): void; ship: THREE.Mesh | null } {
  const f = coastFrame(q);
  const L = quayLines(city);
  const snowy = ctx.climate.snowRoofs;
  const front = uSpan(f, q.frontage!);

  // Apron paving, its edge line, the crane rails (on the apron and along the quay row's sidewalks).
  const flat = new GeometryBuilder();
  for (const p of q.dressing.ground) if (p.kind === 'apron') flat.drape(p, 0.05, new THREE.Color(0xa9a79f), city.terrain);
  const strip = (u: [number, number], v: number, w: number, color: number) => flat.drape(coastRect(f, u, [v - w / 2, v + w / 2]), 0.075, new THREE.Color(color), city.terrain);
  strip(front, L.edge - 2.2, 0.2, YELLOW);
  const cranes = q.dressing.structures.filter((s) => s.kind === 'crane');
  if (cranes.length) {
    strip(front, L.waterLeg, 0.16, RAIL);
    // Landside rails along the quay blocks' sidewalks the cranes stand on.
    const blocks = quayRow(q, city).map((k) => city.blocks[k].rect).filter((r) => {
      const [a, b] = uSpan(f, r);
      return cranes.some((s) => { const u = uOf(f, s); return u > a && u < b; });
    });
    for (const r of blocks) strip(uSpan(f, r), L.landLeg, 0.16, RAIL);
  }
  const flatMesh = new THREE.Mesh(flat.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  flatMesh.receiveShadow = true;
  scene.add(flatMesh);

  const geos: THREE.BufferGeometry[] = [];
  // Fenders on the quay face along the berth.
  const shipS = q.dressing.structures.find((s) => s.kind === 'ship');
  if (shipS) {
    const d = shipS.data as unknown as ShipData;
    const su = uOf(f, shipS);
    for (let u = su - d.length / 2 + 4; u <= su + d.length / 2 - 4; u += 12) {
      const p = { x: f.ax * u + f.nx * (L.edge + 0.3), z: f.az * u + f.nz * (L.edge + 0.3) };
      const g = box(1.4, 2.2, 0.6).rotateY(f.yaw);
      geos.push(part(g, RUBBER, p.x, -0.4, p.z));
    }
  }
  // The cranes, each in its frame.
  const motion: CraneMotion['cranes'] = [];
  for (const s of cranes) {
    const d = s.data as unknown as CraneData;
    const frame = new THREE.Matrix4().compose(new THREE.Vector3(s.x, d.base, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1));
    geos.push(crane(d, snowy).applyMatrix4(frame));
    if (d.working) motion.push({ s, d, frame, phase: motion.length * 17.3, centre: new THREE.Vector3(s.x, d.base, s.z) });
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });
  if (geos.length) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // The ship: merged, bobbing as one; mooring lines from its deck edge to the bollards.
  let shipMesh: THREE.Mesh | null = null;
  if (shipS) {
    const d = shipS.data as unknown as ShipData;
    shipMesh = new THREE.Mesh(ship(d, city.seed, snowy), material);
    shipMesh.position.set(shipS.x, 0, shipS.z);
    shipMesh.rotation.order = 'YXZ';
    shipMesh.rotation.y = shipS.yaw;
    shipMesh.castShadow = shipMesh.receiveShadow = true;
    scene.add(shipMesh);
    const lines: THREE.BufferGeometry[] = [];
    const turn = new THREE.Matrix4().makeRotationY(shipS.yaw).setPosition(shipS.x, 0, shipS.z);
    for (const l of d.lines) {
      const from = new THREE.Vector3(l.x, d.deck + 0.6, -d.beam / 2 + 0.4).applyMatrix4(turn);
      const to = new THREE.Vector3(l.to.x, ctx.ground(l.to.x, l.to.z) + 0.6, l.to.z);
      lines.push(bar(from, to, 0.07, 0xd8cfae));
    }
    if (lines.length) scene.add(new THREE.Mesh(mergeGeometries(lines), material));
  }

  // The moving parts of the working cranes.
  const n = Math.max(1, motion.length);
  const inst = (geo: THREE.BufferGeometry) => {
    const m = new THREE.InstancedMesh(geo, material, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.frustumCulled = false;
    m.count = motion.length;
    scene.add(m);
    return m;
  };
  const top = (d: CraneData) => d.boom;
  const trolley = inst(mergeGeometries(trolleyParts(0, 0)));
  // Four hoist ropes, a unit long (scaled to the drop), hanging from y = 0.
  const cables = inst(mergeGeometries([-1, 1].flatMap((x) => [-1, 1].map((z) => part(box(0.06, 1, 0.06), STEEL, x * 1.1, -0.5, z * 4)))));
  const spreader = inst(mergeGeometries([
    part(box(2.5, 0.5, CONTAINER.l40 + 0.2), YELLOW, 0, 0.25, 0),
    part(box(1.2, 0.6, 3), STEEL, 0, 0.8, 0),
  ]));
  const boxMesh = inst(part(box(CONTAINER.w, CONTAINER.h, CONTAINER.l40), 0xffffff, 0, CONTAINER.h / 2, 0));
  const tint = new THREE.Color();
  motion.forEach((_, i) => boxMesh.setColorAt(i, tint.setHex([0xb03a2e, 0x2f5f9a, 0xd8762a, 0x3f7a4a][i % 4])));
  // Everything moving runs along the rail's X, so turned a quarter to lie along it.
  const along = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const m = new THREE.Matrix4();
  const place = (c: CraneMotion['cranes'][number], time: number) => {
    const d = c.d;
    const s = craneAt(d, time + c.phase);
    m.makeTranslation(0, top(d) - 1, s.z).premultiply(c.frame);
    trolley.setMatrixAt(motion.indexOf(c), m);
    const drop = top(d) - 1.6 - (s.y + 1.1);
    m.makeScale(1, Math.max(0.1, drop), 1).multiply(along).premultiply(new THREE.Matrix4().makeTranslation(0, top(d) - 1.6, s.z)).premultiply(c.frame);
    cables.setMatrixAt(motion.indexOf(c), m);
    m.copy(along).premultiply(new THREE.Matrix4().makeTranslation(0, s.y, s.z)).premultiply(c.frame);
    spreader.setMatrixAt(motion.indexOf(c), m);
    const bz = s.carried ? s.z : s.restZ, by = s.carried ? s.y - CONTAINER.h : s.restY;
    m.copy(along).premultiply(new THREE.Matrix4().makeTranslation(0, by, bz)).premultiply(c.frame);
    boxMesh.setMatrixAt(motion.indexOf(c), m);
  };
  for (const c of motion) place(c, 0);
  const NEAR = 450;
  return {
    ship: shipMesh,
    update(_dt, time, camera) {
      const cam = camera.position;
      let moved = false;
      for (const c of motion) {
        if (cam.distanceTo(c.centre) > NEAR) continue;
        place(c, time);
        moved = true;
      }
      if (moved) for (const mesh of [trolley, cables, spreader, boxMesh]) mesh.instanceMatrix.needsUpdate = true;
      if (shipMesh && cam.distanceTo(shipMesh.position) < 700) {
        shipMesh.position.y = Math.sin(time * 0.45) * 0.12;
        shipMesh.rotation.x = Math.sin(time * 0.31 + 1) * 0.004;
      }
    },
  };
}
