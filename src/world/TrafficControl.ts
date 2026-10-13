// Junction control and street signage, for traffic keeping right (or, in an English city, left:
// everything below mirrors to the driver's left).
// - Traffic lights at busy crossroads, far-side: across the junction on the driver's kerb side,
//   head hanging over the driver's lane, facing them (visible while waiting at the stop line).
// - Elsewhere one road has priority: a priority-road sign (yellow diamond) for its traffic, and
//   stop signs, near-side on the driver's kerb side before the junction, for the road crossing it.
//   At a T the through road has priority; at a crossroads the more important street (the ring
//   road, else a per-street roll, so a main street keeps priority all along its length).
// - Zebra crossings + stop lines on every controlled approach, with a solid centre line leading up
//   to the stop line; zebras too across a priority road where a side road meets it (the top of
//   the T); some mid-block zebra crossings.
// - Edge lines carried on across a junction's closed sides (the top of a T, a corner's outside).
// - Main streets: where one runs between junctions it has priority at (or just bends), a fast
//   stretch signed 90 km/h, no zebras.
// - Street signs where they make sense: speed limits, no parking, children, pedestrian crossing,
//   no smoking at park entrances.
// - Bus stops mid-block on plenty of ordinary streets (not the fast stretches, nor where a zebra
//   crosses mid-block): buses call at each one (busStops).
// Pure data — PropSystem/CityBuilder render it.
import { Rng } from '../core/Rng';
import type { Block, CityConfig, Rect } from './CityGenerator';
import type { RoadGraph } from './RoadGraph';
import type { SignVariant, StreetProp } from './StreetProps';
import type { Keep } from './driveSide';

export interface RoadMark extends Rect {
  kind: 'crosswalk' | 'stopline' | 'centerline' | 'edgeline';
}

export interface TrafficControl {
  props: StreetProp[];
  marks: RoadMark[];
}

/** Seconds in one full signal cycle (both directions). */
export const SIGNAL_CYCLE = 22;
export type SignalLight = 'red' | 'yellow' | 'green';

/** Light shown to traffic travelling along `axis` at time t (junction phase offset applied). */
export function signalState(axis: 'x' | 'z', t: number): SignalLight {
  const c = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  // X traffic: green 0–8, yellow 8–10, red 10–22. Z traffic: red 0–11, green 11–19, yellow 19–21, red 21–22.
  // The 1s all-red gaps let the junction clear.
  if (axis === 'x') return c < 8 ? 'green' : c < 10 ? 'yellow' : 'red';
  return c < 11 ? 'red' : c < 19 ? 'green' : c < 21 ? 'yellow' : 'red';
}

/** Seconds of yellow left for traffic along `axis` at time t (0 unless it's yellow). */
export function yellowLeft(axis: 'x' | 'z', t: number): number {
  const c = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const end = axis === 'x' ? 10 : 21; // see signalState
  return signalState(axis, t) === 'yellow' ? end - c : 0;
}

const CORNER_BACK = 2.5; // post distance from the junction edge
const KERB_INSET = 0.7; // into the sidewalk
const CROSSWALK_FROM = 0.5; // zebra band, measured back from the junction edge
const CROSSWALK_DEPTH = 3;
const STOPLINE_BACK = 4.4;
const STOPLINE_DEPTH = 0.45;
const SOLID_CENTER = 12; // no-overtaking centre line back from the stop line
const MAIN_STREET_ODDS = 0.3; // chance a street (a whole line of the grid) is a main street
const EDGE_IN = 0.7; // edge line inset from the kerb (as CityBuilder paints it along the roads)
const BUS_STOP_ODDS = 0.4; // per street and direction
const BUS_STOP_PAST_MID = 4; // metres past the middle of the block, well clear of both junctions

/** Unit travel direction d and the driver's kerb side r (right, or left when keep is -1) for travel from a to b. */
function travel(a: { x: number; z: number }, b: { x: number; z: number }, keep: Keep) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  return { dx, dz, rx: -dz * keep, rz: dx * keep, alongX: Math.abs(dx) > 0.5 };
}

/** Yaw that turns a sign's face (local +Z) toward traffic travelling along (dx, dz). */
const facingTraffic = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export function generateTrafficControl(
  graph: RoadGraph,
  roads: Rect[],
  blocks: Block[],
  config: CityConfig,
  size: number,
  rng: Rng,
  keep: Keep = 1,
): TrafficControl {
  const rw = config.roadWidth;
  const half = config.blockSize / 2;
  const ring = size / 2 - rw / 2; // coordinate of the outer ring road
  const onRing = (x: number, z: number) => Math.abs(Math.abs(x) - ring) < 0.5 || Math.abs(Math.abs(z) - ring) < 0.5;
  const blockAt = (x: number, z: number) =>
    blocks.find((b) => Math.abs(b.rect.x - x) <= half && Math.abs(b.rect.z - z) <= half);
  const props: StreetProp[] = [];
  const marks: RoadMark[] = [];
  // How important each street is (keyed by axis and line coordinate): the ring road outranks all,
  // then main streets (1 and up), then the rest.
  const rank = new Map<string, number>();
  const streetRank = (alongX: boolean, x: number, z: number) => {
    const key = alongX ? `x${Math.round(z)}` : `z${Math.round(x)}`;
    if (!rank.has(key)) {
      const roll = rng.next();
      rank.set(key, onRing(alongX ? 0 : x, alongX ? z : 0) ? 2 : roll < MAIN_STREET_ODDS ? 1 + roll : roll);
    }
    return rank.get(key)!;
  };
  // Bus stops roll on their own stream, so adding them left every other sign where it was.
  const busRng = new Rng(rng.seed ^ 0xb5570b);
  // Unsignalled junctions: whether the road along X has priority there.
  const priorityAt = new Map<number, boolean>();

  const zebra = (cx: number, cz: number, t: ReturnType<typeof travel>) => {
    for (let lat = -rw / 2 + 1; lat <= rw / 2 - 1 + 1e-6; lat += 1.1) {
      const x = cx + t.rx * lat;
      const z = cz + t.rz * lat;
      marks.push(t.alongX ? { kind: 'crosswalk', x, z, w: CROSSWALK_DEPTH, d: 0.55 } : { kind: 'crosswalk', x, z, w: 0.55, d: CROSSWALK_DEPTH });
    }
  };
  /** Sign on the driver's kerb side, `back` metres before point (px, pz), facing them. */
  const signBefore = (px: number, pz: number, t: ReturnType<typeof travel>, back: number, variant: SignVariant) => {
    props.push({
      kind: 'sign',
      variant,
      x: px - t.dx * back + t.rx * (rw / 2 + KERB_INSET),
      z: pz - t.dz * back + t.rz * (rw / 2 + KERB_INSET),
      yaw: facingTraffic(t.dx, t.dz),
    });
  };

  // --- Junctions ---
  for (const node of graph.nodes) {
    const degree = node.neighbors.length;
    if (degree === 2) {
      // Straight through: carry the dashed centre line across, in step with the segments' dashes
      // (3m dash, 3m gap; they stop 8m and 7m short of the node square either side).
      const [a, b] = node.neighbors.map((id) => graph.nodes[id]);
      if (a.x !== b.x && a.z !== b.z) continue; // a corner
      const alongX = a.z === b.z;
      for (const s of [-9.5, -3.5, 2.5, 8.5]) {
        marks.push(alongX ? { kind: 'centerline', x: node.x + s, z: node.z, w: 3, d: 0.25 } : { kind: 'centerline', x: node.x, z: node.z + s, w: 0.25, d: 3 });
      }
    }
    if (degree < 3) continue; // straight-through or corner: nothing to control
    const busy = Math.hypot(node.x, node.z) < size * 0.3;
    const signals = degree === 4 && (busy || rng.next() < 0.15);
    const phase = rng.range(0, SIGNAL_CYCLE);
    // Without signals, one axis has priority: the through road of a T, else the higher-ranked street.
    const legs = node.neighbors.map((id) => graph.nodes[id]);
    const xLegs = legs.filter((n) => n.z === node.z).length;
    const priorityX = degree === 3 ? xLegs === 2 : streetRank(true, node.x, node.z) > streetRank(false, node.x, node.z);
    if (!signals) priorityAt.set(node.id, priorityX);

    for (const nId of node.neighbors) {
      const from = graph.nodes[nId];
      const t = travel(from, node, keep);
      const before = (m: number) => ({ x: node.x - t.dx * (rw / 2 + m), z: node.z - t.dz * (rw / 2 + m) });
      const band = before(CROSSWALK_FROM + CROSSWALK_DEPTH / 2);
      zebra(band.x, band.z, t);
      // The priority road: a sign saying so, and no stop line.
      if (!signals && t.alongX === priorityX) {
        signBefore(node.x, node.z, t, rw / 2 + CORNER_BACK, 'priority');
        continue;
      }

      if (signals) {
        // Far side, driver's kerb side, facing back at the approaching driver.
        const far = { x: node.x + t.dx * (rw / 2 + CORNER_BACK), z: node.z + t.dz * (rw / 2 + CORNER_BACK) };
        props.push({
          kind: 'signal',
          axis: t.alongX ? 'x' : 'z',
          phase,
          ...(keep < 0 && { armRight: true }),
          x: far.x + t.rx * (rw / 2 + KERB_INSET),
          z: far.z + t.rz * (rw / 2 + KERB_INSET),
          yaw: facingTraffic(t.dx, t.dz),
        });
      } else {
        signBefore(node.x, node.z, t, rw / 2 + CORNER_BACK, 'stop');
      }

      const line = before(STOPLINE_BACK);
      const x = line.x + t.rx * (rw / 4);
      const z = line.z + t.rz * (rw / 4);
      const span = rw / 2 - 0.5;
      marks.push(t.alongX ? { kind: 'stopline', x, z, w: STOPLINE_DEPTH, d: span } : { kind: 'stopline', x, z, w: span, d: STOPLINE_DEPTH });
      // Solid centre line from the stop line back: no overtaking into the junction.
      const solid = before(STOPLINE_BACK - STOPLINE_DEPTH / 2 + SOLID_CENTER / 2);
      const len = SOLID_CENTER;
      marks.push(t.alongX ? { kind: 'centerline', x: solid.x, z: solid.z, w: len, d: 0.25 } : { kind: 'centerline', x: solid.x, z: solid.z, w: 0.25, d: len });
    }
  }

  // --- Edge lines across each junction's closed sides (no paved road that way; a road closed for
  // roadworks is still paved, so it stays open) ---
  for (const node of graph.nodes) {
    if (!node.neighbors.length) continue;
    const open = (dx: number, dz: number) => {
      const x = node.x + dx * (rw / 2 + 1);
      const z = node.z + dz * (rw / 2 + 1);
      return roads.some((r) => Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2);
    };
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (open(nx, nz)) continue;
      // Along the closed side; each end meets the road's edge line (open that way) or the
      // neighbouring closed side's edge line (a corner).
      const [ax, az] = [-nz, nx];
      const lo = open(-ax, -az) ? rw / 2 : rw / 2 - EDGE_IN + 0.075;
      const hi = open(ax, az) ? rw / 2 : rw / 2 - EDGE_IN + 0.075;
      const off = rw / 2 - EDGE_IN;
      const mid = (hi - lo) / 2;
      const x = node.x + nx * off + ax * mid;
      const z = node.z + nz * off + az * mid;
      marks.push(nx === 0 ? { kind: 'edgeline', x, z, w: lo + hi, d: 0.15 } : { kind: 'edgeline', x, z, w: 0.15, d: lo + hi });
    }
  }

  // --- Streets: one pass per segment, signs for each direction of travel ---
  for (const node of graph.nodes) {
    for (const nId of node.neighbors) {
      if (nId < node.id) continue; // each street once
      const other = graph.nodes[nId];
      const mid = { x: (node.x + other.x) / 2, z: (node.z + other.z) / 2 };
      const busy = Math.hypot(mid.x, mid.z) < size * 0.32;
      const alongX = node.z === other.z;

      // A fast stretch of main street: priority (or a bend) at both ends. 90 signs just past each end.
      const clear = (n: typeof node) => n.neighbors.length === 2 || priorityAt.get(n.id) === alongX;
      if (streetRank(alongX, mid.x, mid.z) >= 1 && clear(node) && clear(other)) {
        const back = Math.hypot(other.x - node.x, other.z - node.z) / 2 - (rw / 2 + 8);
        for (const [a, b] of [[node, other], [other, node]]) signBefore(mid.x, mid.z, travel(a, b, keep), back, 'speed90');
        continue;
      }

      // Mid-block zebra crossing on some busy streets, announced in both directions.
      if (busy && !onRing(mid.x, mid.z) && rng.next() < 0.3) {
        zebra(mid.x, mid.z, travel(node, other, keep));
        for (const [a, b] of [[node, other], [other, node]]) signBefore(mid.x, mid.z, travel(a, b, keep), 6, 'pedestrian');
        continue;
      }

      for (const [a, b] of [[node, other], [other, node]]) {
        const t = travel(a, b, keep);
        if (busRng.next() < BUS_STOP_ODDS) signBefore(mid.x, mid.z, t, -BUS_STOP_PAST_MID, 'busStop');
        // The block on this direction's kerb side decides what the street is like.
        const side = blockAt(mid.x + t.rx * (rw / 2 + 10), mid.z + t.rz * (rw / 2 + 10));
        const homes = side?.district === 'residential' || side?.park === true;
        const roll = rng.next();
        if (homes && roll < 0.3) signBefore(mid.x, mid.z, t, 12, 'children');
        else if (roll < 0.45) signBefore(mid.x, mid.z, t, 9, side?.district === 'residential' ? 'speed30' : 'speed50');
        else if (!homes && side && roll < 0.7) signBefore(mid.x, mid.z, t, -13, 'noParking');
      }
    }
  }

  // --- No smoking at park entrances (the gap in the fence mid-side), facing out to visitors ---
  for (const b of blocks) {
    if (!b.park) continue;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (rng.next() > 0.5) continue;
      const inset = 3.8; // just inside the fence line
      props.push({
        kind: 'sign',
        variant: 'noSmoking',
        x: b.rect.x + nx * (half - inset) + -nz * 3.9,
        z: b.rect.z + nz * (half - inset) + nx * 3.9,
        yaw: Math.atan2(nx, nz),
      });
    }
  }
  return { props, marks };
}

/**
 * The fast stretches, keyed `${fromNode}>${toNode}` per direction: wherever a 90 sign faces the
 * traffic (so drivers go by what's there, as with approachControls).
 */
export function fastStreets(graph: RoadGraph, props: StreetProp[]): Set<string> {
  const fast = new Set<string>();
  for (const p of props) {
    if (p.kind !== 'sign' || p.variant !== 'speed90') continue;
    const dx = -Math.sin(p.yaw);
    const dz = -Math.cos(p.yaw);
    for (const a of graph.nodes) {
      for (const id of a.neighbors) {
        const b = graph.nodes[id];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (((b.x - a.x) * dx + (b.z - a.z) * dz) / len < 0.99) continue;
        const along = (p.x - a.x) * dx + (p.z - a.z) * dz;
        const side = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx);
        if (along > 0 && along < len && side < 12) fast.add(`${a.id}>${b.id}`);
      }
    }
  }
  return fast;
}

/**
 * Where the bus stops are, keyed `${fromNode}>${toNode}` per direction: metres from fromNode along
 * the street to the sign (it faces the traffic that calls there, on the driver's kerb side).
 */
export function busStops(graph: RoadGraph, props: StreetProp[]): Map<string, number> {
  const stops = new Map<string, number>();
  for (const p of props) {
    if (p.kind !== 'sign' || p.variant !== 'busStop') continue;
    const dx = -Math.sin(p.yaw);
    const dz = -Math.cos(p.yaw);
    for (const a of graph.nodes) {
      for (const id of a.neighbors) {
        const b = graph.nodes[id];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (((b.x - a.x) * dx + (b.z - a.z) * dz) / len < 0.99) continue;
        const along = (p.x - a.x) * dx + (p.z - a.z) * dz;
        const side = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx);
        if (along > 0 && along < len && side < 12) stops.set(`${a.id}>${b.id}`, along);
      }
    }
  }
  return stops;
}

export interface ApproachControl {
  kind: 'signal' | 'stop';
  axis: 'x' | 'z';
  phase: number;
}

/**
 * Which control governs each junction approach, keyed `${fromNode}>${junctionNode}`. Derived from
 * the placed signs/signals (they face the traffic they control), so drivers obey what's there.
 */
export function approachControls(graph: RoadGraph, props: StreetProp[]): Map<string, ApproachControl> {
  const map = new Map<string, ApproachControl>();
  for (const p of props) {
    const isSignal = p.kind === 'signal';
    if (!isSignal && !(p.kind === 'sign' && p.variant === 'stop')) continue;
    // Drivers travel opposite to the face direction.
    const dx = -Math.sin(p.yaw);
    const dz = -Math.cos(p.yaw);
    const node = graph.nearest(p.x, p.z);
    // The approach road comes in from the neighbour behind the travel direction.
    const from = node.neighbors
      .map((id) => graph.nodes[id])
      .find((n) => {
        const len = Math.hypot(node.x - n.x, node.z - n.z);
        return ((node.x - n.x) * dx + (node.z - n.z) * dz) / len > 0.99;
      });
    if (!from) continue;
    map.set(`${from.id}>${node.id}`, { kind: isSignal ? 'signal' : 'stop', axis: Math.abs(dx) > 0.5 ? 'x' : 'z', phase: p.phase ?? 0 });
  }
  return map;
}
