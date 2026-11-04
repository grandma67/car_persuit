// The Mega-park's lawns and the rest of its dressing: winding gravel paths from the streets into
// each block (round the lake, up to the bandstand, out of the playground's gates, through the
// lawns to a flower bed), flower beds, scattered trees, picnic tables, benches and lamps along the
// paths, a kiosk, avenue trees along the drives, and the gates: iron gates on stone pillars at
// every street in, the park's name on a wall by the main gate. Pure data.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, MEGAPARK } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { FootprintIndex, propFootprint, type Footprint, type StreetProp } from '../StreetProps';
import { rimPoints, shoreDistance, type ShallowWater } from '../Water';
import type { District, Gate, GroundPatch, Structure } from './District';
import { edgeKey } from './place';
import { streetSidesOf, type Side } from './Megapark';

/** A gravel path: its centre line and width. */
export interface ParkPath {
  points: { x: number; z: number }[];
  width: number;
}

/** Made-up, generic park names (no real park): one per park, on the wall by the main gate. */
export const PARK_NAMES = ['Elmwood Park', 'Fairmead Gardens', 'Linden Green', 'Ashcombe Park', 'Willowmere Park', 'Rosehill Gardens', 'Holloway Common', 'Brightwater Park'];

/** Metres from (x, z) to a polyline. */
export function toPath(points: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** A winding path from a to b: a gentle S, `amp` metres either side of the straight line, kept inside `inner`. */
function winding(a: { x: number; z: number }, b: { x: number; z: number }, inner: Rect, rng: Rng): ParkPath {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / 2.5));
  const nx = -(b.z - a.z) / (len || 1), nz = (b.x - a.x) / (len || 1);
  const amp = rng.range(1.5, Math.min(5, len / 5)) * (rng.next() < 0.5 ? -1 : 1);
  const amp2 = rng.range(-1, 1);
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    // The ends leave square to the street and arrive square at the hub.
    const off = amp * Math.sin(Math.PI * t) * Math.min(1, t * 4) + amp2 * Math.sin(2 * Math.PI * t);
    const x = a.x + (b.x - a.x) * t + nx * off, z = a.z + (b.z - a.z) * t + nz * off;
    const m = MEGAPARK.pathWidth / 2 + 0.3;
    return { x: Math.max(inner.x - inner.w / 2 + m, Math.min(inner.x + inner.w / 2 - m, x)), z: Math.max(inner.z - inner.d / 2 + m, Math.min(inner.z + inner.d / 2 - m, z)) };
  });
  points[0] = a; // starts at the sidewalk line
  return { points, width: MEGAPARK.pathWidth };
}

/** A point on a block's sidewalk line on side s, `along` metres from the side's middle. */
const edgePoint = (inner: Rect, s: Side, along: number) => (s.nx
  ? { x: inner.x + s.nx * inner.w / 2, z: inner.z + along }
  : { x: inner.x + along, z: inner.z + s.nz * inner.d / 2 });

export interface LawnsLayout {
  paths: ParkPath[];
  ground: GroundPatch[];
  structures: Structure[];
  solids: Footprint[];
  props: StreetProp[];
  trees: { x: number; z: number }[];
  name: number;
}

/**
 * Everything but the set pieces: paths, beds, trees, tables, benches, lamps, the kiosk, the
 * avenue trees and the gates. `taken` holds what's already laid (solids, buildings, set props);
 * `grounds` the flat set pieces trees and tables keep off (courts, the terrace, the playground…).
 */
export function layLawns(q: District, city: CityData, lake: ShallowWater, buildings: Building[], taken: Footprint[], grounds: Rect[], mainGate: Gate, rng: Rng): LawnsLayout {
  const out: LawnsLayout = { paths: [], ground: [], structures: [], solids: [], props: [], trees: [], name: rng.int(0, PARK_NAMES.length - 1) };
  const sw = city.config.sidewalk;
  const busy = new FootprintIndex(taken);
  const flat = new FootprintIndex(grounds.map((r) => ({ x: r.x, z: r.z, hx: r.w / 2, hz: r.d / 2, yaw: 0 })));
  const pitches = city.parkPieces.filter((p) => p.district === 'megapark' && p.kind === 'pitch');
  const onPitch = (x: number, z: number, m: number) => pitches.some((p) => Math.abs(p.alongX ? x - p.x : z - p.z) <= p.length! / 2 + MEGAPARK.pitchRunOff + m && Math.abs(p.alongX ? z - p.z : x - p.x) <= p.width! / 2 + MEGAPARK.pitchRunOff + m);
  const tracks = q.dressing.structures.filter((s) => s.kind === 'track');
  const onTrack = (x: number, z: number, m: number) => tracks.some((s) => {
    const d = s.data as { straight: number; outer: number; alongX: boolean };
    return Math.abs(x - s.x) <= (d.alongX ? d.straight / 2 + d.outer : d.outer) + m && Math.abs(z - s.z) <= (d.alongX ? d.outer : d.straight / 2 + d.outer) + m;
  });

  // --- Paths ---
  const blockPaths = new Map<number, ParkPath[]>();
  for (const k of q.blocks) {
    const role = q.roles.get(k);
    const inner = shrink(city.blocks[k].rect, sw);
    const sides = streetSidesOf(k, city);
    const paths: ParkPath[] = [];
    if (role === 'lawn' || role === 'bandstand') {
      const band = q.dressing.structures.find((s) => s.kind === 'bandstand' && inRect(inner, s));
      const hub = band ? { x: band.x, z: band.z } : { x: inner.x + rng.range(-5, 5), z: inner.z + rng.range(-5, 5) };
      const stop = band ? MEGAPARK.bandstand + 1.2 : 2.5;
      for (const s of sides) {
        const a = edgePoint(inner, s, rng.range(-6, 6));
        // Not through a building (the café's side, the lodge's corner).
        if (buildings.some((b) => inRect(b, a, 2.5) || inRect(b, { x: (a.x + hub.x) / 2, z: (a.z + hub.z) / 2 }, 1))) continue;
        const d = Math.hypot(hub.x - a.x, hub.z - a.z);
        const b = { x: hub.x + ((a.x - hub.x) / d) * stop, z: hub.z + ((a.z - hub.z) / d) * stop };
        paths.push(winding(a, b, inner, rng));
      }
      if (!band) out.ground.push({ kind: 'bed', x: hub.x, z: hub.z, w: 5, d: 5 }); // a round bed at the paths' meeting
    } else if (role === 'playground') {
      const yard = q.dressing.ground.find((g) => g.kind === 'playground' && inRect(inner, g))!;
      const alongX = yard.w > yard.d;
      for (const e of [-1, 1]) {
        // From each gate (the middle of a long side) straight out to the sidewalk line.
        const gate = alongX ? { x: yard.x, z: yard.z + e * yard.d / 2 } : { x: yard.x + e * yard.w / 2, z: yard.z };
        const s = sides.find((x) => (alongX ? x.nz === e : x.nx === e));
        if (!s) continue;
        const a = edgePoint(inner, s, alongX ? gate.x - inner.x : gate.z - inner.z);
        paths.push({ points: [a, gate], width: MEGAPARK.pathWidth });
      }
    } else if (role === 'lake') {
      // Round the lake on the bank, broken where the boathouse stands and at the block's edge.
      const ring = rimPoints(lake, 72, -1.6);
      let run: { x: number; z: number }[] = [];
      const flush = () => {
        if (run.length > 3) paths.push({ points: run, width: 1.8 });
        run = [];
      };
      for (const p of [...ring, ring[0]]) {
        const ok = inRect(shrink(inner, 1.2), p) && !buildings.some((b) => inRect(b, p, 2));
        if (ok) run.push(p);
        else flush();
      }
      flush();
    }
    blockPaths.set(k, paths);
    out.paths.push(...paths);
  }
  const nearPath = (x: number, z: number, m: number) => out.paths.some((p) => toPath(p.points, x, z) < p.width / 2 + m);
  const inLake = (x: number, z: number, m: number) => shoreDistance(lake, x, z) > -m;
  const free = (x: number, z: number, r: number, inner: Rect) =>
    inRect(shrink(inner, r + 0.3), { x, z }) && !inLake(x, z, r + 1.5) && !onPitch(x, z, r) && !onTrack(x, z, r) &&
    !busy.hits({ x, z, hx: r, hz: r, yaw: 0 }) && !flat.hits({ x, z, hx: r, hz: r, yaw: 0 });
  const put = (p: StreetProp, r: number) => {
    out.props.push(p);
    busy.add(propFootprint(p, r));
  };

  // --- The gates: stone pillars either side of each street in, iron leaves folded back inside ---
  const lodge = buildings.find((b) => b.lot === 'lodge');
  for (const g of q.gates) {
    const hx = Math.sin(g.yaw), hz = Math.cos(g.yaw); // heading in
    const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw); // across
    const main = g === mainGate;
    const fps: Footprint[] = [];
    for (const e of [-1, 1]) {
      const o = g.opening / 2 + 0.5;
      const px = g.x + lx * e * o + hx * 0.5, pz = g.z + lz * e * o + hz * 0.5;
      fps.push({ x: px, z: pz, hx: 0.45, hz: 0.45, yaw: g.yaw });
      // The leaf, open, along the wall line away from the street.
      const leaf = 0.45 + 1.45;
      fps.push({ x: px + lx * e * leaf, z: pz + lz * e * leaf, hx: 1.4, hz: 0.06, yaw: g.yaw });
    }
    out.structures.push({ kind: 'parkGate', x: g.x, z: g.z, yaw: g.yaw, footprints: fps, data: { opening: g.opening, main } });
    out.solids.push(...fps);
    for (const f of fps) busy.add(f);
    if (!main) continue;
    // The park's name on a low wall beyond the leaf, on the side away from the lodge; a notice board inside it.
    const away = lodge ? -Math.sign((lodge.x - g.x) * lx + (lodge.z - g.z) * lz) || 1 : 1;
    const o = g.opening / 2 + 0.5 + 0.45 + 2.9 + 2.2;
    const wall: Footprint = { x: g.x + lx * away * o + hx * 0.5, z: g.z + lz * away * o + hz * 0.5, hx: 1.8, hz: 0.3, yaw: g.yaw };
    out.structures.push({ kind: 'nameWall', x: wall.x, z: wall.z, yaw: g.yaw + Math.PI, footprints: [wall], data: { name: out.name } });
    out.solids.push(wall);
    busy.add(wall);
    // The first free spot just inside the wall (a fence or a picnic table may have it).
    for (const [inward, along] of [[2.2, 0], [1.4, 0], [3.2, 0], [2.2, 1.6], [2.2, -1.6], [3.6, 1.6], [3.6, -1.6]]) {
      const board: StreetProp = { kind: 'parkBoard', x: wall.x + hx * inward + lx * along, z: wall.z + hz * inward + lz * along, yaw: g.yaw + Math.PI };
      if (busy.hits(propFootprint(board, 0.4))) continue;
      put(board, 0.4);
      break;
    }
  }

  // --- Flower beds and trees ---
  const treeAt = new FootprintIndex();
  for (const k of q.blocks) {
    const role = q.roles.get(k);
    if (role === 'sports' || role === 'track') continue;
    const inner = shrink(city.blocks[k].rect, sw);
    const lawn = role === 'lawn';
    for (let n = lawn ? rng.int(MEGAPARK.beds[0], MEGAPARK.beds[1]) : 0, tries = 0; n > 0 && tries < 30; tries++) {
      const r = rng.range(1.6, 2.8);
      const x = inner.x + rng.range(-1, 1) * (inner.w / 2 - r - 2), z = inner.z + rng.range(-1, 1) * (inner.d / 2 - r - 2);
      if (!free(x, z, r + 0.5, inner) || nearPath(x, z, r + 0.6) || out.ground.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + r + 1)) continue;
      out.ground.push({ kind: 'bed', x, z, w: r * 2, d: r * 2 * rng.range(0.6, 1) });
      busy.add({ x, z, hx: r, hz: r, yaw: 0 });
      n--;
    }
    const want = lawn ? rng.int(MEGAPARK.lawnTrees[0], MEGAPARK.lawnTrees[1]) : role === 'lake' ? rng.int(3, 5) : rng.int(2, 4);
    for (let n = want, tries = 0; n > 0 && tries < 60; tries++) {
      const x = inner.x + rng.range(-1, 1) * (inner.w / 2 - 2), z = inner.z + rng.range(-1, 1) * (inner.d / 2 - 2);
      if (!free(x, z, 1.2, inner) || nearPath(x, z, 1.4) || out.ground.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + 1.2)) continue;
      if (treeAt.hits({ x, z, hx: 2.5, hz: 2.5, yaw: 0 })) continue;
      treeAt.add({ x, z, hx: 2.5, hz: 2.5, yaw: 0 });
      busy.add({ x, z, hx: 0.6, hz: 0.6, yaw: 0 });
      out.trees.push({ x, z });
      n--;
    }
    // Picnic tables on the lawns.
    for (let n = lawn ? rng.int(MEGAPARK.picnicTables[0], MEGAPARK.picnicTables[1]) : 0, tries = 0; n > 0 && tries < 30; tries++) {
      const x = inner.x + rng.range(-1, 1) * (inner.w / 2 - 3), z = inner.z + rng.range(-1, 1) * (inner.d / 2 - 3);
      if (!free(x, z, 1.4, inner) || nearPath(x, z, 1.4)) continue;
      put({ kind: 'picnicTable', x, z, yaw: rng.range(0, Math.PI) }, 0.8);
      n--;
    }
  }

  // --- Along the paths: benches facing them with a bin by some, lamps on the other side (glow budget) ---
  const lamps = () => [...city.streetProps, ...out.props].filter((p) => p.kind === 'oilLamp' && inRect(q.bounds, p, 1)).length;
  let lampRoom = MEGAPARK.maxGlow - lamps() - q.gates.length * 2; // the gate pillars' lanterns
  for (const path of out.paths) {
    const pts = path.points;
    let walked = 0, nextBench = rng.range(6, 10), nextLamp = rng.range(4, 8);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (!seg) continue;
      const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg;
      walked += seg;
      const inner = shrink(city.blocks[q.blocks.find((k) => inRect(city.blocks[k].rect, b)) ?? q.blocks[0]].rect, sw);
      if (walked >= nextBench) {
        nextBench = walked + rng.range(12, 18);
        const side = rng.next() < 0.5 ? -1 : 1, off = path.width / 2 + 0.9;
        const x = b.x - tz * side * off, z = b.z + tx * side * off;
        if (free(x, z, 1.0, inner) && !nearPath(x, z, 0.5)) {
          put({ kind: 'bench', x, z, yaw: Math.atan2(tz * side, -tx * side) }, 0.4);
          const bx = x + tx * 1.5, bz = z + tz * 1.5;
          if (rng.next() < 0.5 && free(bx, bz, 0.35, inner) && !nearPath(bx, bz, 0.3)) put({ kind: 'litterBin', x: bx, z: bz, yaw: 0 }, 0.3);
        }
      }
      if (walked >= nextLamp && lampRoom > 0) {
        nextLamp = walked + MEGAPARK.pathLampStep;
        const side = rng.next() < 0.5 ? -1 : 1, off = path.width / 2 + 0.6;
        const x = b.x - tz * side * off, z = b.z + tx * side * off;
        if (free(x, z, 0.4, inner) && !nearPath(x, z, 0.3)) {
          put({ kind: 'oilLamp', x, z, yaw: Math.atan2(-tz * side, tx * side) }, 0.5);
          lampRoom--;
        }
      }
    }
  }
  // The kiosk beside a path in a lawn (else the bandstand's block), serving hatch to the path.
  const kioskBlocks = [...q.roles].filter(([, r]) => r === 'lawn').map(([k]) => k).concat([...q.roles].filter(([, r]) => r === 'bandstand').map(([k]) => k));
  kiosk: for (const k of kioskBlocks) {
    const inner = shrink(city.blocks[k].rect, sw);
    for (const path of blockPaths.get(k) ?? []) {
      for (let i = 2; i < path.points.length - 1; i++) {
        const a = path.points[i - 1], b = path.points[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg;
        for (const side of [-1, 1]) {
          const x = b.x - tz * side * 3.2, z = b.z + tx * side * 3.2;
          if (!free(x, z, 1.8, inner) || nearPath(x, z, 1.4)) continue;
          put({ kind: 'kiosk', x, z, yaw: Math.atan2(tz * side, -tx * side) }, 0.5);
          break kiosk;
        }
      }
    }
  }

  // --- Avenue trees along the drives, both sides, on the sidewalk's inner edge ---
  const { roadWidth: rw } = city.config;
  const nodes = city.graph.nodes;
  const perimeter = new Set(q.perimeter);
  const sidewalkProps = new FootprintIndex([...city.streetProps.filter((p) => inRect(q.bounds, p, 2)), ...out.props].map((p) => propFootprint(p, 1.2)));
  const gateSolids = new FootprintIndex(out.solids.map((f) => ({ ...f, hx: f.hx + 1, hz: f.hz + 1 })));
  const done = new Set<string>();
  for (const key of q.streets) {
    const [a, b] = key.split('>').map(Number);
    if (done.has(edgeKey(b, a))) continue;
    done.add(key);
    const A = nodes[a], B = nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const clearAt = (id: number) => rw / 2 + DISTRICTS.clutterGap + (perimeter.has(id) ? sw + 2 : 0);
    for (const side of [-1, 1]) {
      const lateral = rw / 2 + MEGAPARK.avenueIn;
      for (let t = clearAt(a) + rng.range(0, 3); t < len - clearAt(b); t += MEGAPARK.avenueStep) {
        const x = A.x + dx * t - dz * lateral * side, z = A.z + dz * t + dx * lateral * side;
        const fp = { x, z, hx: 0.5, hz: 0.5, yaw: 0 };
        if (sidewalkProps.hits(fp) || gateSolids.hits(fp) || busy.hits(fp) || nearPath(x, z, 1.2)) continue; // not in a path's mouth
        out.trees.push({ x, z });
      }
    }
  }
  return out;
}

/** A Mega-park's paths (kept in its dressing's `extra`). */
export const pathsOf = (q: District) => (q.dressing.extra?.paths ?? []) as ParkPath[];
