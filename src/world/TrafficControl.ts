// Junction control: traffic lights at busy crossroads, stop signs elsewhere, speed-limit signs
// along streets, plus zebra crossings and stop lines painted on controlled approaches.
// Traffic drives on the right. Pure data — PropSystem/CityBuilder render it.
import type { Rng } from '../core/Rng';
import type { CityConfig, Rect } from './CityGenerator';
import type { RoadGraph } from './RoadGraph';
import type { StreetProp } from './StreetProps';

export interface RoadMark extends Rect {
  kind: 'crosswalk' | 'stopline';
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

const CORNER_BACK = 2.5; // sign/signal distance back from the junction edge
const KERB_INSET = 0.7; // into the sidewalk
const CROSSWALK_FROM = 0.5; // zebra band, measured back from the junction edge
const CROSSWALK_DEPTH = 3;
const STOPLINE_BACK = 4.4;

export function generateTrafficControl(graph: RoadGraph, config: CityConfig, size: number, rng: Rng): TrafficControl {
  const rw = config.roadWidth;
  const ring = size / 2 - rw / 2; // coordinate of the outer ring road
  const onRing = (x: number, z: number) => Math.abs(Math.abs(x) - ring) < 0.5 || Math.abs(Math.abs(z) - ring) < 0.5;
  const props: StreetProp[] = [];
  const marks: RoadMark[] = [];

  for (const node of graph.nodes) {
    const degree = node.neighbors.length;
    if (degree < 3) continue; // straight-through or corner: nothing to control
    const busy = Math.hypot(node.x, node.z) < size * 0.3;
    const signals = degree === 4 && (busy || rng.next() < 0.15);
    const phase = rng.range(0, SIGNAL_CYCLE);

    for (const nId of node.neighbors) {
      const from = graph.nodes[nId];
      // A side road meeting the ring road stops; the ring road itself has priority.
      if (!signals && onRing(node.x, node.z) && onRing(from.x, from.z)) continue;

      // Approach direction d (toward the junction) and the driver's right-hand side.
      const len = Math.hypot(node.x - from.x, node.z - from.z);
      const dx = (node.x - from.x) / len;
      const dz = (node.z - from.z) / len;
      const rx = -dz;
      const rz = dx;
      const back = (m: number) => ({ x: node.x - dx * (rw / 2 + m), z: node.z - dz * (rw / 2 + m) });
      const alongX = Math.abs(dx) > 0.5;

      // Post on the right-hand corner, facing oncoming traffic.
      const post = back(CORNER_BACK);
      props.push({
        kind: signals ? 'signal' : 'sign',
        variant: signals ? undefined : 'stop',
        axis: signals ? (alongX ? 'x' : 'z') : undefined,
        phase: signals ? phase : undefined,
        x: post.x + rx * (rw / 2 + KERB_INSET),
        z: post.z + rz * (rw / 2 + KERB_INSET),
        yaw: Math.atan2(-dx, -dz),
      });

      // Zebra stripes across the whole road, parallel to the traffic.
      const band = back(CROSSWALK_FROM + CROSSWALK_DEPTH / 2);
      for (let lat = -rw / 2 + 1; lat <= rw / 2 - 1 + 1e-6; lat += 1.1) {
        const x = band.x + rx * lat;
        const z = band.z + rz * lat;
        marks.push(alongX ? { kind: 'crosswalk', x, z, w: CROSSWALK_DEPTH, d: 0.55 } : { kind: 'crosswalk', x, z, w: 0.55, d: CROSSWALK_DEPTH });
      }

      // Stop line across the incoming (right-hand) lane only.
      const line = back(STOPLINE_BACK);
      const x = line.x + rx * (rw / 4);
      const z = line.z + rz * (rw / 4);
      const span = rw / 2 - 0.5;
      marks.push(alongX ? { kind: 'stopline', x, z, w: 0.45, d: span } : { kind: 'stopline', x, z, w: span, d: 0.45 });
    }
  }

  // Occasional speed-limit signs mid-street, on the right, facing traffic.
  for (const node of graph.nodes) {
    for (const nId of node.neighbors) {
      if (nId < node.id || rng.next() > 0.25) continue; // each street once, ~1 in 4
      const other = graph.nodes[nId];
      const dir = rng.next() < 0.5 ? 1 : -1; // which way the sign faces
      const [a, b] = dir > 0 ? [node, other] : [other, node];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      const mid = { x: (a.x + b.x) / 2 - dx * 9, z: (a.z + b.z) / 2 - dz * 9 };
      props.push({
        kind: 'sign',
        variant: 'speed',
        x: mid.x - dz * (rw / 2 + KERB_INSET),
        z: mid.z + dx * (rw / 2 + KERB_INSET),
        yaw: Math.atan2(-dx, -dz),
      });
    }
  }
  return { props, marks };
}
