// The Harbor's seafront: the quay apron on the promenade, bollards along its edge, gantry cranes
// straddling the seafront road (landside legs on the quay row's sidewalk, waterside legs on the
// quay edge) and the ship moored alongside. Pure data, in a frame along the coast; drawn by
// render/districts/HarborQuay.ts.
import type { Rng } from '../../core/Rng';
import { CONTAINER, HARBOR, HARBOR_QUAY as QY } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import { LANDMARK_RADIUS, type Landmark } from '../Landmarks';
import { footprintsOverlap, propFootprint, type Footprint } from '../StreetProps';
import { groundHeight } from '../Terrain';
import { inDistrict, isJunctionControl } from './apply';
import type { District, GroundPatch, Overhead, Structure } from './District';
import { LINE_COLOURS } from './HarborYard';

/**
 * Coordinates along the coast: u along it, v out towards the sea (from the city's centre line).
 * The frame is a rotation (local X = along, local Z = out), so structures turn by `yaw`.
 */
export interface CoastFrame {
  ax: number; // along (unit)
  az: number;
  nx: number; // out to sea (unit)
  nz: number;
  yaw: number; // turns local Z onto (nx, nz) and local X onto (ax, az)
}

export function coastFrame(q: District): CoastFrame {
  const { nx, nz } = q.coast!;
  return { ax: nz, az: -nx, nx, nz, yaw: Math.atan2(nx, nz) };
}
export const toWorld = (f: CoastFrame, u: number, v: number) => ({ x: f.ax * u + f.nx * v, z: f.az * u + f.nz * v });
export const uOf = (f: CoastFrame, p: { x: number; z: number }) => p.x * f.ax + p.z * f.az;
export const vOf = (f: CoastFrame, p: { x: number; z: number }) => p.x * f.nx + p.z * f.nz;
/** A rectangle's extent along the coast. */
export function uSpan(f: CoastFrame, r: Rect): [number, number] {
  const c = uOf(f, r);
  const half = (Math.abs(f.ax) * r.w + Math.abs(f.az) * r.d) / 2;
  return [c - half, c + half];
}
/** An axis-aligned world rectangle from spans along (u) and out (v). */
export function coastRect(f: CoastFrame, [u0, u1]: [number, number], [v0, v1]: [number, number]): Rect {
  const c = toWorld(f, (u0 + u1) / 2, (v0 + v1) / 2);
  const along = u1 - u0, out = v1 - v0;
  return f.ax ? { ...c, w: along, d: out } : { ...c, w: out, d: along };
}

/** Lines across the coast: where the road, the quay and the legs are. */
export function quayLines(city: CityData) {
  const half = city.size / 2;
  const { roadWidth: rw, sidewalk: s, promenade } = city.config;
  return {
    sidewalk: [half - rw - s, half - rw] as [number, number], // the quay row's seafront sidewalk
    road: [half - rw, half] as [number, number],
    edge: half + promenade, // the quay edge (the sea wall's outer face)
    landLeg: half - rw - s / 2,
    waterLeg: half + promenade - QY.waterLeg,
  };
}

export type ShipType = keyof typeof QY.shipOdds;

/** A ship's data: in its own frame (X along its length, bow towards +X when bow > 0; Z out to sea). */
export interface ShipData {
  type: ShipType;
  name: string;
  length: number;
  beam: number;
  deck: number; // deck height above the quay's ground (y = 0)
  keel: number; // hull bottom, below
  bow: 1 | -1; // which end along X is the bow
  /** Container ships: deck boxes in the ship's frame, forties along X. */
  boxes: { x: number; z: number; tier: number; color: number }[];
  /** Bulk carriers and general cargo: hatch positions along X. */
  hatches: number[];
  /** Mooring lines: from the ship's deck edge (frame X) to bollards (world). */
  lines: { x: number; to: { x: number; z: number } }[];
  tug?: { x: number; z: number; length: number }; // in the ship's frame
}

/** A crane's data, in its frame (X along the rail, Z out to sea; origin on the road's centre line). */
export interface CraneData {
  land: number; // landside legs' Z
  water: number; // waterside legs' Z
  gauge: number; // between legs along X
  base: number; // footing height (world)
  portal: number; // portal underside above the footing
  boom: number; // boom height above the footing
  outreach: number; // past the waterside legs
  backreach: number;
  working: boolean; // boom down over a container ship; else raised, idle
  /** Trolley stops (frame Z): over the ship and over the truck on the apron. */
  ship?: number;
  truck?: number;
  deckTop?: number; // where the spreader sets a box down on the ship (above the footing)
}

const SHIP_NAMES = ['Northern Gull', 'Saltmere', 'Kestrel Bay', 'Amber Tide', 'Halvard Star', 'Cape Linnet', 'Moorhen', 'Tessaly', 'Grey Petrel', 'Orrin Venture', 'Bramble Sound', 'Lark of Ostend'];
const SHIP_DIMS: Record<ShipType, { beam: [number, number]; deck: number; keel: number }> = {
  container: { beam: [26, 32], deck: 4.5, keel: -9 },
  bulk: { beam: [26, 30], deck: 3.8, keel: -10 },
  general: { beam: [18, 22], deck: 3.4, keel: -8 },
};

export interface Quay {
  landmarks: Landmark[];
  structures: Structure[];
  solids: Footprint[];
  ground: GroundPatch[];
  overhead: Overhead[];
}

/**
 * Lay out the quay. `containers`: how many containers the yard already holds (the ship's deck
 * fills up to HARBOR.maxContainers).
 */
export function quay(q: District, city: CityData, quayBlocks: number[], containers: number, rng: Rng): Quay {
  const f = coastFrame(q);
  const L = quayLines(city);
  const out: Quay = { landmarks: [], structures: [], solids: [], ground: [], overhead: [] };
  const front = uSpan(f, q.frontage!);
  // The berth: the frontage's length, less a little at either end.
  const berth: [number, number] = [front[0] + QY.shipEnds, front[1] - QY.shipEnds];

  // The apron: the promenade along the frontage, its edge line, and the crane rails.
  out.ground.push({ kind: 'apron', ...coastRect(f, front, [L.road[1], L.edge]) });

  // The ship: a type, a length fitted to the berth, moored off the quay face.
  const roll = rng.next();
  const odds = QY.shipOdds;
  const type: ShipType = roll < odds.container ? 'container' : roll < odds.container + odds.bulk ? 'bulk' : 'general';
  const dims = SHIP_DIMS[type];
  const room = berth[1] - berth[0];
  const length = Math.min(rng.range(QY.shipLength[0], QY.shipLength[1]), room);
  const beam = rng.range(dims.beam[0], dims.beam[1]);
  const slack = room - length;
  const su = berth[0] + length / 2 + rng.range(0, slack);
  const sv = L.edge + QY.shipGap + beam / 2;
  const bow = rng.next() < 0.5 ? 1 : -1;
  const ship: ShipData = {
    type, name: rng.pick(SHIP_NAMES), length, beam, deck: dims.deck, keel: dims.keel, bow, boxes: [], hatches: [], lines: [],
  };
  // The accommodation block stands aft (a fifth of the length from the stern); cargo forward of it.
  const aft = -bow * (length / 2 - length * 0.17);
  const cargo: [number, number] = bow > 0 ? [aft + 8, length / 2 - 12] : [-length / 2 + 12, aft - 8];
  if (type === 'container') {
    const room = Math.max(0, HARBOR.maxContainers - containers);
    const rows = Math.floor((beam - 2) / (CONTAINER.w + 0.05));
    const bays = Math.floor((cargo[1] - cargo[0]) / (CONTAINER.l40 + 0.8));
    const boxes: ShipData['boxes'] = [];
    for (let b = 0; b < bays; b++) {
      const x = cargo[0] + (CONTAINER.l40 + 0.8) * (b + 0.5);
      const high = rng.int(2, 5);
      for (let r = 0; r < rows; r++) {
        const z = -((rows - 1) * (CONTAINER.w + 0.05)) / 2 + r * (CONTAINER.w + 0.05);
        const top = Math.max(1, high - (r === 0 || r === rows - 1 ? rng.int(0, 1) : 0));
        for (let tier = 0; tier < top; tier++) boxes.push({ x, z, tier, color: rng.pick(LINE_COLOURS) });
      }
    }
    // Within the containers' cap: the top tiers go first.
    boxes.sort((a, b) => a.tier - b.tier);
    ship.boxes = boxes.slice(0, room);
  } else {
    const n = Math.max(3, Math.round((cargo[1] - cargo[0]) / (type === 'bulk' ? 18 : 22)));
    for (let k = 0; k < n; k++) ship.hatches.push(cargo[0] + ((cargo[1] - cargo[0]) * (k + 0.5)) / n);
  }
  const sc = toWorld(f, su, sv);
  const hull: Footprint = { ...sc, hx: Math.abs(f.ax) * (length / 2) + Math.abs(f.nx) * (beam / 2), hz: Math.abs(f.az) * (length / 2) + Math.abs(f.nz) * (beam / 2), yaw: 0 };
  const shipFps = [hull];
  if (rng.next() < QY.tugChance) {
    // A tug off the ship's outer side, near the bow.
    const tl = 24;
    ship.tug = { x: bow * (length / 2 - tl / 2 - 6), z: beam / 2 + 1.5 + 4, length: tl };
    const tc = toWorld(f, su + ship.tug.x, sv + ship.tug.z);
    shipFps.push({ ...tc, hx: Math.abs(f.ax) * (tl / 2) + Math.abs(f.nx) * 4, hz: Math.abs(f.az) * (tl / 2) + Math.abs(f.nz) * 4, yaw: 0 });
  }

  // Cranes: on the quay row's sidewalk, between its blocks' corners, over the ship, apart.
  const spans = quayBlocks.map((k) => uSpan(f, city.blocks[k].rect));
  const reach = QY.gauge / 2 + QY.leg;
  const ranges = spans.map(([a, b]): [number, number] => [a + QY.cornerClear + reach, b - QY.cornerClear - reach]).filter(([a, b]) => b >= a);
  const shipU: [number, number] = [su - length / 2 + reach + 2, su + length / 2 - reach - 2];
  const controls = city.streetProps.filter((p) => inDistrict(q, p) && isJunctionControl(p)).map((p) => propFootprint(p, 0.3));
  const legsAt = (u: number): Footprint[] =>
    [L.landLeg, L.waterLeg].flatMap((v) => [-1, 1].map((side) => ({ ...toWorld(f, u + side * QY.gauge / 2, v), hx: QY.leg, hz: QY.leg, yaw: 0 })));
  const cranes: number[] = [];
  const want = rng.int(HARBOR.cranes[0], HARBOR.cranes[1]);
  for (let tries = 0; tries < 24 && cranes.length < want; tries++) {
    const [a, b] = rng.pick(ranges.length ? ranges : [[0, -1] as [number, number]]);
    if (b < a) break;
    const u = rng.range(a, b);
    if (u < shipU[0] || u > shipU[1]) continue;
    if (cranes.some((c) => Math.abs(c - u) < QY.gauge + 2 * QY.leg + QY.craneGap)) continue;
    if (legsAt(u).some((leg) => controls.some((c) => footprintsOverlap(leg, c)))) continue;
    cranes.push(u);
  }
  cranes.sort((a, b) => a - b);
  const working = type === 'container';
  const deckTop = ship.deck + 2 * CONTAINER.h; // a slot two boxes up
  for (const u of cranes) {
    const legs = legsAt(u);
    const base = Math.min(...legs.map((l) => groundHeight(city.terrain, l.x, l.z))) - 0.05;
    const roadV = (L.road[0] + L.road[1]) / 2;
    const data: CraneData = {
      land: L.landLeg - roadV, water: L.waterLeg - roadV, gauge: QY.gauge, base, portal: QY.portal, boom: QY.boom,
      outreach: QY.outreach, backreach: QY.backreach, working,
    };
    const fps = [...legs];
    if (working) {
      // A terminal truck on the apron between the road and the waterside legs, under the crane.
      const tv = (L.road[1] + L.waterLeg - QY.leg) / 2;
      // Its bed under the box at the crane's middle, the cab beyond.
      const tc = toWorld(f, u + QY.truckLength / 2 - (CONTAINER.l40 + 0.6) / 2, tv);
      const truck: Footprint = { ...tc, hx: Math.abs(f.ax) * (QY.truckLength / 2) + Math.abs(f.nx) * (QY.truckWidth / 2), hz: Math.abs(f.az) * (QY.truckLength / 2) + Math.abs(f.nz) * (QY.truckWidth / 2), yaw: 0 };
      fps.push(truck);
      data.truck = tv - roadV;
      data.ship = sv - roadV - beam * 0.15;
      data.deckTop = deckTop - base;
    }
    const c = toWorld(f, u, roadV);
    out.structures.push({ kind: 'crane', ...c, yaw: f.yaw, footprints: fps, data: data as unknown as Record<string, unknown> });
    out.solids.push(...fps);
    // The portal girders over the road, for the clearance rules.
    const top = Math.max(...[L.road[0], (L.road[0] + L.road[1]) / 2, L.road[1]].flatMap((v) => [-1, 1].map((side) => {
      const p = toWorld(f, u + side * QY.gauge / 2, v);
      return groundHeight(city.terrain, p.x, p.z);
    })));
    for (const side of [-1, 1]) {
      out.overhead.push({ kind: 'cranePortal', points: [toWorld(f, u + side * QY.gauge / 2, L.landLeg), toWorld(f, u + side * QY.gauge / 2, L.waterLeg)], bottom: base + QY.portal - top });
    }
  }

  // Bollards every ~15 m along the quay edge, clear of crane legs.
  const legFps = out.solids;
  const bv = L.edge - QY.bollardInset;
  const n = Math.floor((front[1] - front[0] - 6) / QY.bollardSpacing);
  for (let k = 0; k <= n; k++) {
    const u = front[0] + 3 + ((front[1] - front[0] - 6) * k) / Math.max(1, n);
    const p = toWorld(f, u, bv);
    const fp: Footprint = { ...p, hx: QY.bollard + 0.8, hz: QY.bollard + 0.8, yaw: 0 };
    if (legFps.some((l) => footprintsOverlap(fp, l))) continue;
    out.landmarks.push({ kind: 'bollard', ...p, yaw: f.yaw, radius: LANDMARK_RADIUS.bollard });
  }
  // Mooring lines from the bow and stern to the nearest bollards beyond each end, and springs amidships.
  const bollardU = out.landmarks.map((l) => ({ l, u: uOf(f, l) }));
  const lineTo = (fromX: number, toU: number) => {
    const best = bollardU.reduce<{ l: Landmark; u: number } | null>((m, b) => (!m || Math.abs(b.u - toU) < Math.abs(m.u - toU) ? b : m), null);
    if (best) ship.lines.push({ x: fromX, to: { x: best.l.x, z: best.l.z } });
  };
  for (const end of [-1, 1]) {
    lineTo(end * (length / 2 - 4), su + end * (length / 2 + 10));
    lineTo(end * (length / 2 - 18), su + end * (length / 2 - 30));
  }
  out.structures.push({ kind: 'ship', ...sc, yaw: f.yaw, footprints: shipFps, data: ship as unknown as Record<string, unknown> });
  out.solids.push(...shipFps);
  return out;
}

/** Street furniture the quay replaces: promenade lamps and benches on the apron, and anything under a crane leg or the truck. */
export function clearQuay(q: District, city: CityData, solids: Footprint[]): void {
  const f = coastFrame(q);
  const L = quayLines(city);
  city.streetProps = city.streetProps.filter((p) => {
    if (!q.frontage || !inDistrict(q, p) || isJunctionControl(p)) return true;
    const onApron = vOf(f, p) > L.road[1] && (p.kind === 'lamp' || p.kind === 'bench');
    return !onApron && !solids.some((s) => footprintsOverlap(propFootprint(p, 0.2), s));
  });
}

export const shipOf = (q: District) => q.dressing.structures.find((s) => s.kind === 'ship');
