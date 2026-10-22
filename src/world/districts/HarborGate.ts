// The Harbor's terminal gate (a canopy over the street where it leaves the district inland, a
// guard booth and weighbridge plates) and the grain silo's conveyor gallery out over the seafront
// road to a ship loader on the quay. Pure data; drawn by render/districts/HarborGate.ts.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, HARBOR_QUAY as QY } from '../../gameplay/balance';
import type { Building, CityData } from '../CityGenerator';
import { footprintsOverlap, propFootprint, type Footprint } from '../StreetProps';
import { groundBase, groundHeight } from '../Terrain';
import { inDistrict, isJunctionControl } from './apply';
import type { District, Gate, GroundPatch, Overhead, Structure } from './District';
import { coastFrame, quayLines, toWorld, uOf, uSpan, vOf } from './HarborQuay';

/** The terminal gate in its frame: X across the street, Z into the district, origin on the ground at its middle. */
export interface TerminalGateData {
  half: number; // column centres either side, across
  depth: number; // along the street
  bottom: number; // canopy underside above the footing
  base: number; // footing height (world)
  lanes: number[]; // lane-light offsets across
  booth: { x: number; z: number }; // in the frame
}

const GATE_DEPTH = 9;
const COLUMN = 0.35; // half side

/**
 * The terminal gate: on the gate where the main street leaves inland (else the inland gate nearest
 * the main street), set in from the wall line as far as it must be to keep its columns and booth
 * off the junction's controls.
 */
export function terminalGate(q: District, city: CityData, _rng: Rng): { s: Structure; solids: Footprint[]; overhead: Overhead; ground: GroundPatch[]; gate: Gate } | null {
  const f = coastFrame(q);
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const v = (g: Gate) => vOf(f, city.graph.nodes[g.node]);
  const inland = Math.min(...q.gates.map(v));
  const back = q.gates.filter((g) => Math.abs(v(g) - inland) < 1);
  const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
  const mid = q.mainStreet.map((k) => city.graph.nodes[Number(k.split('>')[0])]).reduce((a, n, _i, all) => ({ x: a.x + n.x / all.length, z: a.z + n.z / all.length }), { x: 0, z: 0 });
  const ranked = [...back].sort((a, b) => Number(main.has(b.edge)) - Number(main.has(a.edge)) || Math.abs(uOf(f, a) - uOf(f, mid)) - Math.abs(uOf(f, b) - uOf(f, mid)));
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const half = rw / 2 + sw / 2;
  for (const g of ranked) {
    const dx = Math.sin(g.yaw), dz = Math.cos(g.yaw); // into the district
    const ax = dz, az = -dx; // across (frame X)
    for (const setIn of [1.5, 4, 7, 10]) {
      const c = { x: g.x + dx * (setIn + GATE_DEPTH / 2), z: g.z + dz * (setIn + GATE_DEPTH / 2) };
      const at = (x: number, z: number) => ({ x: c.x + ax * x + dx * z, z: c.z + az * x + dz * z });
      const cols: Footprint[] = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ ...at(sx * half, sz * (GATE_DEPTH / 2 - 0.6)), hx: COLUMN, hz: COLUMN, yaw: 0 })));
      const boothAt = { x: half, z: GATE_DEPTH / 2 + 2.2 };
      const booth: Footprint = { ...at(boothAt.x, boothAt.z), hx: 0.8, hz: 0.8, yaw: g.yaw };
      const solids = [...cols, booth];
      if (solids.some((s) => controls.some((k) => footprintsOverlap(s, k)))) continue;
      const base = Math.min(...cols.map((p) => groundHeight(city.terrain, p.x, p.z))) - 0.05;
      const top = Math.max(...[-half, 0, half].flatMap((x) => [-1, 1].map((z) => { const p = at(x, z * GATE_DEPTH / 2); return groundHeight(city.terrain, p.x, p.z); })));
      const bottom = DISTRICTS.overheadClearance + 1.2 + (top - base);
      const data: TerminalGateData = { half, depth: GATE_DEPTH, bottom, base, lanes: [-rw / 4, rw / 4], booth: boothAt };
      const s: Structure = { kind: 'terminalGate', ...c, yaw: g.yaw, footprints: solids, data: data as unknown as Record<string, unknown> };
      // Weighbridge plates in each lane under the canopy (axis-aligned: streets run along X or Z).
      const along = Math.abs(dx) > 0.5;
      const ground: GroundPatch[] = [-1, 1].map((side) => {
        const p = at(side * rw / 4, 0);
        return { kind: 'weighbridge', x: p.x, z: p.z, w: along ? GATE_DEPTH - 1 : 3.4, d: along ? 3.4 : GATE_DEPTH - 1 };
      });
      const overhead: Overhead = { kind: 'terminalCanopy', points: [at(-half - 1, 0), at(half + 1, 0)], bottom: bottom - (top - base) };
      return { s, solids, overhead, ground, gate: g };
    }
  }
  return null;
}

/** The silo's gallery in world space: from the silo's seaward face, high, out to the loader on the quay. */
export interface GalleryData {
  a: { x: number; z: number; y: number }; // at the silo (world height)
  b: { x: number; z: number; y: number }; // over the loader tower
  width: number;
  tower: { x: number; z: number; h: number; base: number };
}

const TOWER = 1.6; // the loader tower's footprint, half side

/**
 * A grain silo on the quay row runs a covered conveyor out over the seafront road to a loader tower
 * at the quay edge, clear of the cranes and their trucks. Null if the silo isn't on the quay row
 * or no clear line is found.
 */
export function siloGallery(q: District, city: CityData, silo: Building | undefined, solids: Footprint[], cranes: Structure[]): { s: Structure; overhead: Overhead; solid: Footprint } | null {
  if (!silo || !q.coast) return null;
  const f = coastFrame(q);
  const L = quayLines(city);
  // On the quay row: its seaward face near the sidewalk line.
  const face = vOf(f, silo) + (Math.abs(f.nx) * silo.w + Math.abs(f.nz) * silo.d) / 2;
  if (face < L.sidewalk[0] - 8) return null;
  const [u0, u1] = uSpan(f, silo);
  const clear = QY.gauge / 2 + QY.leg + 3;
  const cu = cranes.map((s) => uOf(f, s));
  let best: number | null = null;
  for (let u = u0 + 3; u <= u1 - 3; u += 1) {
    if (cu.some((c) => Math.abs(c - u) < clear)) continue;
    const t: Footprint = { ...toWorld(f, u, L.edge - 2.6), hx: TOWER + 0.4, hz: TOWER + 0.4, yaw: 0 };
    if (solids.some((s) => footprintsOverlap(s, t))) continue;
    if (best === null || Math.abs(u - (u0 + u1) / 2) < Math.abs(best - (u0 + u1) / 2)) best = u;
  }
  if (best === null) return null;
  const footing = groundBase(city.terrain, silo.x, silo.z, Math.max(silo.w, silo.d) / 2) - 0.3;
  const tp = toWorld(f, best, L.edge - 2.6);
  const base = groundHeight(city.terrain, tp.x, tp.z) - 0.05;
  const tower = { ...tp, h: 15, base };
  const a = { ...toWorld(f, best, face), y: footing + silo.h - 3 };
  const b = { ...tp, y: base + tower.h + 1.5 };
  const data: GalleryData = { a, b, width: 2.6, tower };
  const solid: Footprint = { ...tp, hx: TOWER, hz: TOWER, yaw: 0 };
  // The lowest underside over the road: the gallery dips towards the loader.
  const roadV = L.road[1];
  const t = (roadV - face) / (L.edge - 2.6 - face);
  const yRoad = a.y + (b.y - a.y) * t - 1.6;
  const g = toWorld(f, best, roadV);
  const overhead: Overhead = { kind: 'gallery', points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], bottom: yRoad - groundHeight(city.terrain, g.x, g.z) };
  return { s: { kind: 'gallery', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: f.yaw, footprints: [solid], data: data as unknown as Record<string, unknown> }, overhead, solid };
}

