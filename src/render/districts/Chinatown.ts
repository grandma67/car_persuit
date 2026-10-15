// Chinatown's paifang and lantern strings. Each paifang is merged into one vertex-coloured mesh
// with the landmarks' material settings, its name board a glyph plate on the street signs' material;
// the lanterns are one instanced mesh with the props' material settings, swung on the CPU. No new
// shader programs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part } from '../geometry';
import type { CityData } from '../../world/CityGenerator';
import type { District, Overhead, Structure } from '../../world/districts/District';
import { wireY, type LanternData, type PaifangData } from '../../world/districts/ChinatownGates';
import { glyphMaterial, glyphPlate } from './glyphs';
import type { DistrictRenderContext, DistrictView } from './index';

const RED = 0xa8231f;
const RED_DARK = 0x6e1714;
const GOLD = 0xd4a53a;
const TILE = 0x2f7a55; // green-glazed tiles
const TILE_DARK = 0x205a3e;
const PANEL = 0x23465e; // the frieze between the beams
const STONE = 0xa7a39a;
const SNOW = 0xeef2f6;
const WIRE = 0x2a2522;

const BOARD = { w: 3.4, h: 0.85 };
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/**
 * A tile roof along X: two slopes from the eaves (depth either side) up to a ridge, with flared
 * corners, a ridge with upturned ends and exposed rafter ends under the eaves.
 */
function roof(out: THREE.BufferGeometry[], cx: number, y: number, half: number, depth: number, rise: number, snowy: boolean): void {
  const slope = Math.hypot(depth, rise);
  const angle = Math.atan2(rise, depth);
  const tiles = snowy ? SNOW : TILE;
  for (const side of [-1, 1]) {
    // The slope, its lower edge at the eave line.
    out.push(part(box(half * 2, 0.14, slope).rotateX(side * angle), tiles, cx, y + rise / 2, (side * depth) / 2));
    // A darker fascia along the eave, standing proud of the slope's end.
    out.push(part(box(half * 2 + 0.1, 0.16, 0.12), TILE_DARK, cx, y - 0.04, side * (depth + 0.02)));
    // Upturned corners.
    for (const end of [-1, 1]) {
      out.push(part(box(0.6, 0.14, 0.34).rotateZ(-end * 0.45).rotateY(side * end * 0.5), TILE_DARK, cx + end * (half + 0.2), y + 0.12, side * (depth - 0.05)));
      out.push(part(box(0.1, 0.22, 0.1), GOLD, cx + end * (half + 0.44), y + 0.33, side * (depth - 0.05)));
    }
    // Rafter ends under the eave.
    for (let x = -half + 0.2; x <= half - 0.2; x += 0.36) out.push(part(box(0.1, 0.1, 0.5), RED_DARK, cx + x, y - 0.2, side * (depth - 0.3)));
  }
  // The ridge and its upturned ends.
  out.push(part(box(half * 2 - 0.2, 0.2, 0.22), TILE_DARK, cx, y + rise + 0.06, 0));
  for (const end of [-1, 1]) out.push(part(box(0.18, 0.5, 0.24).rotateZ(end * 0.35), GOLD, cx + end * (half - 0.1), y + rise + 0.3, 0));
}

/** One paifang in its own frame: across the road along X, the street along Z, base at y = 0. */
function paifang(d: PaifangData, snowy: boolean): THREE.BufferGeometry {
  const g: THREE.BufferGeometry[] = [];
  const outer = d.columns[d.columns.length - 1];
  const inner = d.columns[0];
  const centre = d.four ? inner + 0.5 : outer + 0.5; // the main beams' half length
  const b1 = d.beam; // underside of the main beam
  const top = b1 + 2.1; // the main roof's eave line
  const colTop = (c: number) => (d.four && c === outer ? b1 + 1.2 : top);
  for (const c of d.columns) {
    for (const side of [-1, 1]) {
      const x = side * c;
      g.push(part(box(0.95, 0.5, 0.95), STONE, x, 0.25)); // plinth
      g.push(part(box(0.75, 0.12, 0.75), STONE, x, 0.56));
      g.push(part(new THREE.CylinderGeometry(0.32, 0.34, colTop(c) - 0.62, 10), RED, x, 0.62 + (colTop(c) - 0.62) / 2));
      // Drum stones either side along the street, propping the column.
      for (const z of [-1, 1]) g.push(part(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10).rotateZ(Math.PI / 2), STONE, x, 0.82, z * 0.5));
    }
  }
  // Main beams, the frieze and the name board between them.
  g.push(part(box(centre * 2, 0.42, 0.5), RED, 0, b1 + 0.21));
  g.push(part(box(centre * 2 - 0.2, 0.1, 0.52), GOLD, 0, b1 + 0.47));
  g.push(part(box(centre * 2 - 0.4, 0.95, 0.3), PANEL, 0, b1 + 1.0));
  g.push(part(box(BOARD.w + 0.3, BOARD.h + 0.25, 0.34), RED_DARK, 0, b1 + 1.0)); // board frame
  g.push(part(box(centre * 2, 0.38, 0.5), RED, 0, b1 + 1.66));
  // Gold trim dots along the frieze.
  for (let x = -centre + 0.6; x <= centre - 0.6; x += 0.9) if (Math.abs(x) > BOARD.w / 2 + 0.3) g.push(part(box(0.14, 0.14, 0.34), GOLD, x, b1 + 1.0));
  roof(g, 0, top, centre + 0.5, 1.35, 0.95, snowy);
  // A smaller top tier over the middle.
  g.push(part(box(2.2, 0.9, 0.36), RED, 0, top + 1.35));
  roof(g, 0, top + 1.85, 1.9, 0.95, 0.7, snowy);
  // Four columns: lower side bays over the sidewalks, each with its beam and roof.
  if (d.four) {
    for (const side of [-1, 1]) {
      const mid = side * (inner + outer) / 2;
      const len = outer - inner + 0.7;
      g.push(part(box(len, 0.36, 0.42), RED, mid, b1 + 0.75));
      g.push(part(box(len - 0.3, 0.3, 0.26), PANEL, mid, b1 + 1.0));
      roof(g, mid, b1 + 1.3, len / 2 - 0.2, 1.1, 0.7, snowy);
    }
  }
  return mergeGeometries(g);
}

interface StringState {
  o: Overhead;
  d: LanternData;
  mid: THREE.Vector3;
  axis: THREE.Vector3; // along the wire
  pivots: THREE.Vector3[]; // where each lantern hangs from the wire
  first: number; // its first lantern instance
  kick: number; // extra swing from a car passing under, decaying
  phase: number;
}

const LANTERN_HANG = 0.25; // pivot to the lantern's centre (G.lanternDrop is to its bottom)

function lanternGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(0.02, LANTERN_HANG - 0.22, 0.02), WIRE, 0, -(LANTERN_HANG - 0.22) / 2), // cord
    part(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), GOLD, 0, -LANTERN_HANG + 0.25),
    part(new THREE.SphereGeometry(0.3, 10, 7).scale(1, 0.82, 1), 0xd62a22, 0, -LANTERN_HANG),
    part(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), GOLD, 0, -LANTERN_HANG - 0.25),
    part(box(0.05, 0.28, 0.05), 0xe8b02a, 0, -LANTERN_HANG - 0.42), // tassel
  ]);
}

/** Wires as thin bars along the sag curve, merged. */
function wires(strings: StringState[], out: THREE.BufferGeometry[]): void {
  for (const s of strings) {
    const [a, b] = s.o.points;
    const n = 10;
    let prev = new THREE.Vector3(a.x, s.d.ya, a.z);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const p = new THREE.Vector3(a.x + (b.x - a.x) * t, wireY(s.d, t), a.z + (b.z - a.z) * t);
      const len = prev.distanceTo(p);
      const bar = new THREE.CylinderGeometry(0.018, 0.018, len, 4).translate(0, len / 2, 0);
      bar.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(prev).normalize()));
      out.push(part(bar, WIRE, prev.x, prev.y, prev.z));
      prev = p;
    }
  }
}

export function renderChinatown(q: District, _city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView {
  const snowy = ctx.climate.snowRoofs;
  const geos: THREE.BufferGeometry[] = [];
  const boards: THREE.Matrix4[] = [];
  const gates = q.dressing.structures.filter((s): s is Structure => s.kind === 'paifang');
  for (const s of gates) {
    const d = s.data as unknown as PaifangData;
    const y = Math.min(...s.footprints.map((f) => ctx.ground(f.x, f.z)));
    const frame = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1));
    geos.push(paifang(d, snowy).applyMatrix4(frame));
    boards.push(frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, d.beam + 1.0, 0)));
  }

  // Lantern strings.
  const strings: StringState[] = [];
  let count = 0;
  for (const o of q.dressing.overhead) {
    if (o.kind !== 'lanterns') continue;
    const d = o.data as unknown as LanternData;
    const [a, b] = o.points;
    const pivots = d.at.map((t) => new THREE.Vector3(a.x + (b.x - a.x) * t, wireY(d, t), a.z + (b.z - a.z) * t));
    const axis = new THREE.Vector3(b.x - a.x, d.yb - d.ya, b.z - a.z).normalize();
    strings.push({ o, d, mid: new THREE.Vector3((a.x + b.x) / 2, wireY(d, 0.5), (a.z + b.z) / 2), axis, pivots, first: count, kick: 0, phase: strings.length * 1.7 });
    count += pivots.length;
  }
  wires(strings, geos);

  if (geos.length) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (boards.length) {
    // Front and back faces 2 cm proud of the board frame.
    const plate = new THREE.InstancedMesh(glyphPlate(BOARD.w, BOARD.h, 'board', 0.38), glyphMaterial(), boards.length);
    boards.forEach((m, i) => plate.setMatrixAt(i, m));
    scene.add(plate);
  }
  if (!count) return {};

  // Lanterns: the props' instanced material settings. Each string swings about its wire in the
  // breeze, and harder for a few seconds after a fast car (the camera) passes under it.
  const lanterns = new THREE.InstancedMesh(lanternGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 }), count);
  lanterns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lanterns.castShadow = true;
  lanterns.frustumCulled = false;
  scene.add(lanterns);
  const m = new THREE.Matrix4();
  const rot = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (s: StringState, angle: number) => {
    s.pivots.forEach((p, k) => {
      rot.setFromAxisAngle(s.axis, angle * (0.8 + 0.2 * Math.sin(k * 2.3)));
      lanterns.setMatrixAt(s.first + k, m.compose(p, rot, one));
    });
  };
  for (const s of strings) place(s, 0);
  const lastCam = new THREE.Vector3();
  let primed = false;
  const NEAR = 160; // only swing strings this near the camera
  return {
    update(dt, time, camera) {
      const cam = camera.position;
      const speed = primed && dt > 0 ? cam.distanceTo(lastCam) / dt : 0;
      lastCam.copy(cam);
      primed = true;
      let touched = false;
      for (const s of strings) {
        const far = cam.distanceTo(s.mid);
        if (far > NEAR) continue;
        // A car going fast within a few metres of the string's line gives it a shove.
        const flat = Math.hypot(cam.x - s.mid.x, cam.z - s.mid.z);
        if (flat < 9 && speed > 12) s.kick = Math.min(0.5, Math.max(s.kick, speed * 0.012));
        s.kick *= Math.exp(-dt * 0.7);
        place(s, (0.05 + s.kick) * Math.sin(time * 2.1 + s.phase));
        touched = true;
      }
      if (touched) lanterns.instanceMatrix.needsUpdate = true;
    },
  };
}
