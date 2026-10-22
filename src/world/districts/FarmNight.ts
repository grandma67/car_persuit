// The Farm's dressing that only some runs show: harvest night (a roll on the district's stream, night
// runs only: jack-o'-lanterns along the pumpkin patch, by the stand and at the scarecrows' feet, and
// a pyramid of bales by the ranch gate) and, in the desert, a parked centre-pivot irrigator on one
// field. Generation never depends on time or climate: the game joins these in (runtime.ts). Pure data.
import type { Rng } from '../../core/Rng';
import { FARM } from '../../gameplay/balance';
import type { Rect } from '../CityGenerator';
import { FootprintIndex, propFootprint, type Footprint, type StreetProp } from '../StreetProps';
import type { Gate, Structure } from './District';
import type { Field } from './Farm';
import type { FenceGap } from './FarmFields';
import { gapLane } from './FarmFields';

/** Extra dressing joined in on some runs: structures and their solids, props. */
export interface JoinedDressing {
  structures: Structure[];
  solids: Footprint[];
  props: StreetProp[];
}

/** The centre-pivot irrigator: a centre tower, a truss out along `yaw` on wheeled towers. */
export interface PivotData {
  r: number; // the truss's reach (the green circle's radius)
  towers: number[]; // distances of the wheeled towers out along the truss
  height: number; // the truss above the ground
}

/** A harvest night's pumpkins that glow, and the bale pyramid by the ranch gate. */
export function harvestNight(fields: Field[], props: StreetProp[], busy: Footprint[], yard: Rect, gate: Gate, rng: Rng): JoinedDressing {
  const out: JoinedDressing = { structures: [], solids: [], props: [] };
  const taken = new FootprintIndex([...busy, ...props.map((p) => propFootprint(p, 0.2))]);
  const lantern = (x: number, z: number) => {
    const p: StreetProp = { kind: 'jackOLantern', x, z, yaw: rng.range(-0.6, 0.6) + Math.PI };
    const fp = propFootprint(p, 0.15);
    if (taken.hits(fp) || out.props.length >= FARM.jackOLanterns) return;
    taken.add(fp);
    out.props.push(p);
  };
  // Either side of the farm stand, then at the scarecrows' feet, then along the patch's fences.
  for (const s of props.filter((p) => p.kind === 'farmStand')) {
    const ax = Math.cos(s.yaw), az = -Math.sin(s.yaw); // the stand's local X
    for (const side of [-1, 1]) lantern(s.x + ax * side * 1.9, s.z + az * side * 1.9);
  }
  for (const s of props.filter((p) => p.kind === 'scarecrow')) lantern(s.x + 0.9, s.z + 0.6);
  for (const f of fields.filter((x) => x.crop === 'pumpkin')) {
    const r = f.rect;
    for (let u = -r.w / 2 + 3; u < r.w / 2 - 3; u += 6) for (const sz of [-1, 1]) lantern(r.x + u, r.z + sz * (r.d / 2 - 1.3));
  }
  // The bale pyramid in the farmyard's corner nearest the ranch gate.
  const cx = Math.min(yard.x + yard.w / 2 - 3, Math.max(yard.x - yard.w / 2 + 3, gate.x));
  const cz = Math.min(yard.z + yard.d / 2 - 3, Math.max(yard.z - yard.d / 2 + 3, gate.z));
  const fp: Footprint = { x: cx, z: cz, hx: 1.8, hz: 1.3, yaw: 0 };
  if (!taken.hits(fp)) {
    out.structures.push({ kind: 'balePyramid', x: cx, z: cz, yaw: 0, footprints: [fp] });
    out.solids.push(fp);
  }
  return out;
}

/**
 * The desert's centre-pivot irrigator on one field (hay, else wheat, else any but the orchard or a
 * maze), its truss turned to keep every tower clear of what stands there and of the gate lanes.
 */
export function centrePivot(fields: Field[], gaps: Record<number, FenceGap[]>, busy: Footprint[], rng: Rng): JoinedDressing {
  const out: JoinedDressing = { structures: [], solids: [], props: [] };
  const rank = (f: Field) => (f.crop === 'hay' ? 0 : f.crop === 'wheat' ? 1 : f.crop === 'orchard' || f.maze ? 9 : 2);
  const f = [...fields].sort((a, b) => rank(a) - rank(b))[0];
  if (!f || rank(f) === 9) return out;
  const taken = new FootprintIndex([...busy, ...(gaps[f.block] ?? []).map((g) => gapLane(g))]);
  const r = Math.min(f.rect.w, f.rect.d) / 2 - FARM.pivotInset;
  const towers = [0, r / 3, (2 * r) / 3, r - 1];
  const start = rng.range(0, Math.PI * 2);
  for (let k = 0; k < 16; k++) {
    const yaw = start + (k * Math.PI) / 8;
    const fps: Footprint[] = towers.map((d) => ({ x: f.rect.x + Math.sin(yaw) * d, z: f.rect.z + Math.cos(yaw) * d, hx: FARM.pivotTower, hz: FARM.pivotTower, yaw }));
    if (fps.some((fp) => taken.hits(fp))) continue;
    const data: PivotData = { r, towers, height: FARM.pivotHeight };
    out.structures.push({ kind: 'pivot', x: f.rect.x, z: f.rect.z, yaw, footprints: fps, data: data as unknown as Record<string, unknown> });
    out.solids.push(...fps);
    return out;
  }
  return out;
}
