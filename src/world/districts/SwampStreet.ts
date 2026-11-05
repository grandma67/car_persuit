// The Swamp's streets (causeways): the roadway as ever, the sidewalks muddy verges (soft), wooden
// guard rails along the kerbs with gaps at the junctions, gates and boardwalk mouths, one lamp left
// by each junction (it's dark out here), and a "Mind the bog" sign inside the first gates. Pure data.
import type { Rng } from '../../core/Rng';
import { DISTRICTS, SWAMP } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import { inRect, shrink } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type StreetProp } from '../StreetProps';
import type { District, GroundPatch } from './District';
import { edgeKey } from './place';

/** The four sidewalk strips round a block (its rect minus the inside of the sidewalk line). */
export function verges(block: Rect, sw: number): Rect[] {
  const inner = shrink(block, sw);
  return [
    { x: block.x, z: block.z + (block.d - sw) / 2, w: block.w, d: sw },
    { x: block.x, z: block.z - (block.d - sw) / 2, w: block.w, d: sw },
    { x: block.x + (block.w - sw) / 2, z: block.z, w: sw, d: inner.d },
    { x: block.x - (block.w - sw) / 2, z: block.z, w: sw, d: inner.d },
  ];
}

export interface StreetLayout {
  ground: GroundPatch[];
  soft: Rect[];
  props: StreetProp[];
}

/** `mouths`: the boardwalks' sidewalk strips (kept clear); `solids`: what the rails keep off. */
export function swampStreets(q: District, city: CityData, mouths: Rect[], solids: Footprint[], rng: Rng): StreetLayout {
  const { roadWidth: rw, sidewalk: sw } = city.config;
  const out: StreetLayout = { ground: [], soft: [], props: [] };
  for (const k of q.blocks) {
    for (const r of verges(city.blocks[k].rect, sw)) {
      out.ground.push({ kind: 'verge', ...r });
      out.soft.push(r);
    }
  }
  // One lamp by each junction (inside and on the edge): the nearest; the others go.
  const nodes = city.graph.nodes.filter((n) => inRect(q.bounds, n, rw / 2 + 1));
  const keep = new Set<StreetProp>();
  for (const n of nodes) {
    let best: StreetProp | undefined, d = 30;
    for (const p of city.streetProps) {
      if (p.kind !== 'woodLamp' || keep.has(p) || !inRect(q.bounds, p, 1)) continue;
      const k = Math.hypot(p.x - n.x, p.z - n.z);
      if (k < d) (best = p), (d = k);
    }
    if (best) keep.add(best);
  }
  city.streetProps = city.streetProps.filter((p) => p.kind !== 'woodLamp' || !inRect(q.bounds, p, 1) || keep.has(p));
  const taken: Footprint[] = [
    ...solids,
    ...city.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint),
    ...city.streetProps.filter((p) => inRect(q.bounds, p, 2)).map((p) => propFootprint(p, 0.4)),
    ...mouths.map((m) => rectFootprint(shrink(m, -1.5))),
  ];
  const free = (p: StreetProp) => {
    const fp = propFootprint(p);
    if (taken.some((t) => footprintsOverlap(fp, t))) return false;
    taken.push(propFootprint(p, 0.3));
    return true;
  };
  // Guard rails along the kerbs of the interior streets, sections end to end with gaps between.
  const perimeter = new Set(q.perimeter);
  const done = new Set<string>();
  const gates = q.gates.map((g) => ({ x: g.x, z: g.z }));
  for (const key of q.streets) {
    const [a, b] = key.split('>').map(Number);
    if (done.has(edgeKey(b, a))) continue;
    done.add(key);
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const clearAt = (id: number) => rw / 2 + DISTRICTS.clutterGap + (perimeter.has(id) ? sw : 0) + 1.45;
    for (const side of [-1, 1]) {
      const lateral = rw / 2 + 0.65; // its far end (the rule measures the radius) clear of clutterMinOffset
      for (let t = clearAt(a) + rng.range(0, 2); t < len - clearAt(b); t += rng.range(SWAMP.guardRailStep[0], SWAMP.guardRailStep[1])) {
        const p: StreetProp = { kind: 'fence', style: 'rail', x: A.x + dx * t - dz * lateral * side, z: A.z + dz * t + dx * lateral * side, yaw: Math.atan2(-dz, dx) };
        if (gates.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < DISTRICTS.clutterGap + 2)) continue;
        if (free(p)) out.props.push(p);
      }
    }
  }
  // "Mind the bog" inside the first gates, on the kerb, facing the cars coming in.
  for (const g of q.gates.slice(0, SWAMP.signs)) {
    const hx = Math.sin(g.yaw), hz = Math.cos(g.yaw);
    const ahead = DISTRICTS.clutterGap + 4, lateral = rw / 2 + sw - 0.8;
    const p: StreetProp = { kind: 'sign', variant: 'bogCrossing', x: g.x + hx * ahead + hz * lateral, z: g.z + hz * ahead - hx * lateral, yaw: g.yaw + Math.PI };
    if (free(p)) out.props.push(p);
  }
  return out;
}
