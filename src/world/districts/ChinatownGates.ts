// Chinatown's way in: a paifang (a freestanding gate of red columns under tiered tile roofs) at
// each gate, a pair of guardian lions in front of it, and red lanterns strung across the streets.
// Pure data; render/districts/Chinatown.ts draws it.
import type { Rng } from '../../core/Rng';
import { CHINATOWN_GATES as G, DISTRICTS } from '../../gameplay/balance';
import type { Building, CityData } from '../CityGenerator';
import { LANDMARK_RADIUS, type Landmark } from '../Landmarks';
import { footprintsOverlap, propFootprint, type Footprint } from '../StreetProps';
import { groundHeight } from '../Terrain';
import { isJunctionControl } from './apply';
import type { District, Gate, Overhead, Structure } from './District';
import { edgeKey } from './place';

/** What a paifang's renderer needs (Structure.data). */
export interface PaifangData {
  /** Column offsets across the road from its centre line, one side (mirrored). */
  columns: number[];
  /** Beam underside above the structure's base (its lowest column footing). */
  beam: number;
  /** The main roof's half span across the road. */
  half: number;
  four: boolean;
}

/** What a lantern string's renderer needs (Overhead.data): wire end heights and the sag. */
export interface LanternData {
  ya: number; // wire ends, world heights
  yb: number;
  sag: number;
  /** Lantern positions along the wire, 0..1. */
  at: number[];
}

/** Where along a lantern wire (0..1) its lowest point is, and the wire's height there. */
export function wireY(d: LanternData, t: number): number {
  return d.ya + (d.yb - d.ya) * t - d.sag * 4 * t * (1 - t);
}

const ground = (city: CityData, x: number, z: number) => groundHeight(city.terrain, x, z);

/**
 * Paifang and lions for every gate. The paifang stands across the street G.setIn in from the gate
 * line, its columns on the sidewalks; the lions sit in front of it, facing out. A paifang whose
 * column would touch a junction control steps further in; a lion that would, moves behind it.
 */
export function paifangs(q: District, city: CityData, rng: Rng): { structures: Structure[]; landmarks: Landmark[]; overhead: Overhead[]; solids: Footprint[] } {
  const { roadWidth: rw, sidewalk: s } = city.config;
  const keep = city.streetProps.filter((p) => isJunctionControl(p));
  const clear = (f: Footprint) => !keep.some((p) => footprintsOverlap(f, propFootprint(p, 0.1)));
  const structures: Structure[] = [];
  const landmarks: Landmark[] = [];
  const overhead: Overhead[] = [];
  const solids: Footprint[] = [];
  for (const g of q.gates) {
    const ix = Math.sin(g.yaw), iz = Math.cos(g.yaw);
    const at = (along: number, lateral: number) => ({ x: g.x + ix * along + iz * lateral, z: g.z + iz * along - ix * lateral });
    const four = rng.next() < G.fourChance;
    const columns = four ? [rw / 2 + 0.75, rw / 2 + s - 0.5] : [rw / 2 + s / 2]; // on the sidewalks, clear of the road
    const colFoot = (along: number) =>
      columns.flatMap((c) => [-1, 1].map((side) => ({ ...at(along, c * side), hx: G.column, hz: G.columnAlong, yaw: g.yaw })));
    const setIn = G.setIn.find((d) => colFoot(d).every(clear)) ?? G.setIn[G.setIn.length - 1];
    const feet = colFoot(setIn);
    // Its base is the lowest footing; the beam clears the highest ground under the span.
    const half = columns[columns.length - 1] + G.column;
    const span = [-half, -half / 2, 0, half / 2, half].map((l) => at(setIn, l));
    const y0 = Math.min(...feet.map((f) => ground(city, f.x, f.z)));
    const top = Math.max(...span.map((p) => ground(city, p.x, p.z)));
    const beam = top - y0 + G.beam;
    const c = at(setIn, 0);
    const data: PaifangData = { columns, beam, half, four };
    structures.push({ kind: 'paifang', x: c.x, z: c.z, yaw: g.yaw, footprints: feet, data: data as unknown as Record<string, unknown> });
    solids.push(...feet);
    overhead.push({ kind: 'paifang', points: [span[0], span[4]], bottom: G.beam });
    // Lions on plinths in front of the outer columns, facing out; behind them if a sign is there.
    const r = LANDMARK_RADIUS.lion;
    for (const side of [-1, 1]) {
      const lateral = side * (rw / 2 + s / 2);
      const spot = [setIn - G.lionOut, setIn + G.lionOut]
        .map((d) => at(d, lateral))
        .find((p) => clear({ ...p, hx: r, hz: r, yaw: g.yaw }) && !feet.some((f) => footprintsOverlap(f, { ...p, hx: r, hz: r, yaw: g.yaw })));
      if (spot) landmarks.push({ kind: 'lion', ...spot, yaw: g.yaw + Math.PI, radius: r });
    }
  }
  return { structures, landmarks, overhead, solids };
}

/**
 * Red lanterns on wires across the streets, tied to the buildings on either side: every
 * G.lanternPitch along the main street, a few on the side streets. A string goes up only where a
 * tall enough building stands at both ends, clear of the paifang and of the junction mouths.
 */
export function lanternStrings(q: District, city: CityData, buildings: Building[], paifang: Structure[], rng: Rng): Overhead[] {
  const { roadWidth: rw, sidewalk: s } = city.config;
  const nodes = city.graph.nodes;
  const line = rw / 2 + s; // the building line, from the centre line
  const out: Overhead[] = [];
  const main = new Set(q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]));
  const done = new Set<string>();
  // The building a wire end ties to: its face on the line at that point, and tall enough.
  const anchored = (x: number, z: number) =>
    buildings.some((b) => b.h >= G.wireHeight + 1 && Math.abs(x - b.x) <= b.w / 2 + 0.6 && Math.abs(z - b.z) <= b.d / 2 + 0.6);
  for (const key of [...q.mainStreet, ...[...q.streets].sort()]) {
    const [a, b] = key.split('>').map(Number);
    if (done.has(key) || done.has(edgeKey(b, a))) continue;
    done.add(key);
    const A = nodes[a], B = nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const t0 = line + G.lanternGap;
    const t1 = len - line - G.lanternGap;
    let spots: number[] = [];
    if (main.has(key)) {
      // Evenly along it, centred between the junctions.
      const n = Math.floor((t1 - t0) / G.lanternPitch) + 1;
      for (let k = 0; k < n; k++) spots.push((t0 + t1) / 2 + (k - (n - 1) / 2) * G.lanternPitch);
    } else spots = Array.from({ length: rng.int(G.sideStrings[0], G.sideStrings[1]) }, () => rng.range(t0, t1));
    for (const t of spots) {
      const cx = A.x + dx * t, cz = A.z + dz * t;
      const end = (side: number) => ({ x: cx - dz * (line - 0.15) * side, z: cz + dx * (line - 0.15) * side });
      const pa = end(-1), pb = end(1);
      const probe = (p: { x: number; z: number }, side: number) => ({ x: p.x - dz * 0.5 * side, z: p.z + dx * 0.5 * side });
      if (!anchored(probe(pa, -1).x, probe(pa, -1).z) || !anchored(probe(pb, 1).x, probe(pb, 1).z)) continue;
      // Clear of the paifang roofs.
      if (paifang.some((p) => Math.hypot(p.x - cx, p.z - cz) < G.lanternGap + 2)) continue;
      if (out.some((o) => Math.hypot((o.points[0].x + o.points[1].x) / 2 - cx, (o.points[0].z + o.points[1].z) / 2 - cz) < G.lanternPitch * 0.6)) continue;
      const data: LanternData = { ya: ground(city, pa.x, pa.z) + G.wireHeight, yb: ground(city, pb.x, pb.z) + G.wireHeight, sag: G.sag, at: [] };
      // Lanterns over the roadway and the sidewalks' outer half, evenly spaced.
      const n = Math.max(2, Math.round((2 * (rw / 2 + s / 2)) / G.lanternSpacing));
      for (let k = 0; k <= n; k++) data.at.push(0.5 + ((k / n - 0.5) * (rw + s)) / (2 * line - 0.3));
      // Lowest lantern bottom above the ground under it.
      const bottom = Math.min(...data.at.map((u) => {
        const x = pa.x + (pb.x - pa.x) * u, z = pa.z + (pb.z - pa.z) * u;
        return wireY(data, u) - G.lanternDrop - ground(city, x, z);
      }));
      if (bottom < DISTRICTS.overheadClearance) continue;
      out.push({ kind: 'lanterns', points: [pa, pb], bottom, data: data as unknown as Record<string, unknown> });
    }
  }
  return out;
}

export type { Gate };
