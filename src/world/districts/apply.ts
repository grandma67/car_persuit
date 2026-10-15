// The district overlay: the last step of generateCity. Each placed district refills its own blocks
// from its own stream, filters and restyles the props inside, and adds its dressing; everything
// outside its blocks and frontage stays exactly as the same seed without it. Pure data.
import type { Rng } from '../../core/Rng';
import { DISTRICTS } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import { fillBlock, inRect } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp } from '../StreetProps';
import { edgeKey, placeDistrict, rollDistricts, type DistrictForce, type DistrictGrid } from './place';
import type { Gate, District, DistrictDef } from './District';

/** Signals and stop / priority / speed signs: junction rules and fast stretches come from these, so they are never dropped. */
export function isJunctionControl(p: StreetProp): boolean {
  return p.kind === 'signal' || (p.kind === 'sign' && (p.variant === 'stop' || p.variant === 'priority' || p.variant?.startsWith('speed') === true));
}

/** Inside a district's blocks (interior streets included) or its frontage. */
export function inDistrict(q: District, p: { x: number; z: number }): boolean {
  return inRect(q.bounds, p) || (!!q.frontage && inRect(q.frontage, p));
}

export function applyDistricts(city: CityData, grid: DistrictGrid, defs: DistrictDef[], force: DistrictForce = {}): void {
  const placed: District[] = [];
  for (const { def, rng } of rollDistricts(city.seed, defs, force)) {
    if (placed.length >= DISTRICTS.max) break;
    const q = placeDistrict(def, grid, city, rng, placed);
    if (!q) continue;
    overlay(def, q, city, rng);
    placed.push(q);
  }
  city.districts = placed;
}

function overlay(def: DistrictDef, q: District, city: CityData, rng: Rng): void {
  const { bounds } = q;
  // 1. Mark the blocks (a park inside becomes ordinary ground) and pick the special blocks.
  for (const k of q.blocks) {
    city.blocks[k].district = def.kind;
    city.blocks[k].park = false;
  }
  q.roles = def.roles(q, city, rng);
  // 2. Clear the blocks (park centrepieces too) and refill the ordinary ones from the district's stream.
  city.buildings = city.buildings.filter((b) => !inRect(bounds, b));
  city.trees = city.trees.filter((t) => !inRect(bounds, t));
  city.landmarks = city.landmarks.filter((l) => !inRect(bounds, l));
  const built: Building[] = [];
  const trees: { x: number; z: number }[] = [];
  for (const k of q.blocks) {
    if (q.roles.has(k)) continue;
    fillBlock(city.blocks[k], city.config.sidewalk, rng, built, trees, def.buildingStyle);
  }
  for (const b of built) b.district = def.kind;
  // 3. What each lot is.
  def.lots(q, built, city, rng);
  city.buildings.push(...built);
  city.trees.push(...trees);
  // 4. Props inside: junction controls always stay (restyled at most); bus stops stay while buses
  // may come in; the rest is the district's to drop or swap. Nothing may stand in a new building.
  const solid = built.map(rectFootprint);
  city.streetProps = city.streetProps.flatMap((p) => {
    if (!inDistrict(q, p)) return [p];
    if (isJunctionControl(p)) return [p];
    const busStop = p.kind === 'sign' && p.variant === 'busStop';
    if (busStop && def.traffic.heavy) return [p];
    if (def.drop(p)) return [];
    const fp = propFootprint(p);
    if (solid.some((s) => footprintsOverlap(fp, s))) return [];
    const kind = def.swap[p.kind];
    return [kind ? { ...p, kind } : p];
  });
  // 5. Zebra crossings go unless the district keeps them; stop lines always stay.
  if (!def.keepZebras) city.roadMarks = city.roadMarks.filter((m) => m.kind !== 'crosswalk' || !inRect(bounds, m));
  // 6. Dressing.
  q.dressing = def.dress(q, city, rng);
  city.landmarks.push(...q.dressing.landmarks);
  city.streetProps.push(...q.dressing.props);
}

// --- Shared helpers for definitions ---

/**
 * Clutter along the interior streets: on the sidewalk (small things may poke into the roadway, but
 * never nearer the centre line than DISTRICTS.clutterMinOffset), leaving clutterGap clear at the
 * junction mouths and at the gates. Skips anything that would touch a building or another prop.
 */
export function kerbClutter(
  q: District, city: CityData, palette: PropKind[], rng: Rng,
  { step = [5, 10] as [number, number], minOffset = DISTRICTS.clutterMinOffset } = {},
): StreetProp[] {
  const { roadWidth: rw, sidewalk } = city.config;
  const nodes = city.graph.nodes;
  const perimeter = new Set(q.perimeter);
  const taken: Footprint[] = [
    ...city.buildings.filter((b) => inRect(q.bounds, b)).map(rectFootprint),
    ...city.streetProps.filter((p) => inRect(q.bounds, p, 2)).map((p) => propFootprint(p, 0.4)),
  ];
  const out: StreetProp[] = [];
  const done = new Set<string>();
  for (const key of q.streets) {
    const [a, b] = key.split('>').map(Number);
    if (done.has(edgeKey(b, a))) continue;
    done.add(key);
    const A = nodes[a];
    const B = nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / len;
    const dz = (B.z - A.z) / len;
    const clearAt = (id: number) => rw / 2 + DISTRICTS.clutterGap + (perimeter.has(id) ? sidewalk : 0);
    const t0 = clearAt(a);
    const t1 = len - clearAt(b);
    for (const side of [-1, 1]) {
      for (let t = t0 + rng.range(0, step[0]); t < t1; t += rng.range(step[0], step[1])) {
        const kind = rng.pick(palette);
        const lateral = rw / 2 + rng.range(0.5, sidewalk - 0.5);
        const p: StreetProp = { kind, x: A.x + dx * t - dz * lateral * side, z: A.z + dz * t + dx * lateral * side, yaw: rng.range(0, Math.PI * 2) };
        const fp = propFootprint(p);
        // Nearest point to the centre line (a footprint's corner reaches out by its half diagonal).
        if (lateral - Math.hypot(fp.hx, fp.hz) < minOffset) continue;
        if (taken.some((f) => footprintsOverlap(fp, f))) continue;
        taken.push(propFootprint(p, 0.4));
        out.push(p);
      }
    }
  }
  return out;
}

export interface WallSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Outward normal (away from the district). */
  nx: number;
  nz: number;
}

/**
 * The district's perimeter wall line, on the block side of the sidewalk all round: segments split at
 * the gates (each opening `gate.opening` wide), the four outer corners, and the gates themselves.
 */
export function perimeterWall(q: District, city: CityData): { segments: WallSegment[]; corners: { x: number; z: number }[]; gates: Gate[] } {
  const s = city.config.sidewalk;
  const b: Rect = { ...q.bounds, w: q.bounds.w - s * 2, d: q.bounds.d - s * 2 };
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const sides: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }[] = [
    { ax: x0, az: z0, bx: x1, bz: z0, nx: 0, nz: -1 },
    { ax: x1, az: z0, bx: x1, bz: z1, nx: 1, nz: 0 },
    { ax: x1, az: z1, bx: x0, bz: z1, nx: 0, nz: 1 },
    { ax: x0, az: z1, bx: x0, bz: z0, nx: -1, nz: 0 },
  ];
  const segments: WallSegment[] = [];
  for (const side of sides) {
    const alongX = side.az === side.bz;
    const lo = alongX ? Math.min(side.ax, side.bx) : Math.min(side.az, side.bz);
    const hi = alongX ? Math.max(side.ax, side.bx) : Math.max(side.az, side.bz);
    const fixed = alongX ? side.az : side.ax;
    // Gates on this side: their wall-line point lies on it.
    const gaps = q.gates
      .filter((g) => Math.abs((alongX ? g.z : g.x) - fixed) < 0.5)
      .map((g) => [(alongX ? g.x : g.z) - g.opening / 2, (alongX ? g.x : g.z) + g.opening / 2] as [number, number])
      .sort((u, v) => u[0] - v[0]);
    let at = lo;
    const spans: [number, number][] = [];
    for (const [g0, g1] of gaps) {
      if (g0 > at) spans.push([at, g0]);
      at = Math.max(at, g1);
    }
    if (at < hi) spans.push([at, hi]);
    for (const [u0, u1] of spans) {
      if (u1 - u0 < 0.5) continue;
      segments.push(alongX
        ? { ax: u0, az: fixed, bx: u1, bz: fixed, nx: side.nx, nz: side.nz }
        : { ax: fixed, az: u0, bx: fixed, bz: u1, nx: side.nx, nz: side.nz });
    }
  }
  return { segments, corners: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], gates: q.gates };
}
