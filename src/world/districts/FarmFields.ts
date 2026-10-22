// What grows and stands in the Farm's fields: the corn maze, the orchard's rows of fruit trees with
// their bins, the pumpkin patch and its stand at the kerb, the hay field's round bales and stacks
// of square ones, scarecrows, the parked combine and the farm's tractors and implements, and the
// farmyard's clutter. Pure data; crops are drawn by render/districts/farmCrops.ts.
import type { Rng } from '../../core/Rng';
import { FARM_FIELDS as FF } from '../../gameplay/balance';
import type { Building, Rect } from '../CityGenerator';
import { shrink } from '../lots';
import { footprintsOverlap, propFootprint, rectFootprint, type Footprint, type PropKind, type StreetProp } from '../StreetProps';
import type { GroundPatch, Structure } from './District';
import type { Field } from './Farm';

/** A gap in a field's fence: on the fence line, with its side's outward normal. */
export interface FenceGap {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** A round bale lying on its side: solid, its axis along `yaw`. */
export interface RoundBaleData {
  r: number;
  len: number;
}

export interface FieldDressing {
  props: StreetProp[];
  structures: Structure[];
  solids: Footprint[];
  ground: GroundPatch[];
}

/** The way in through a gap, a few metres deep into the field (kept clear of anything solid). */
export function gapLane(g: FenceGap, depth: number = FF.gapLane): Footprint {
  const w = FF.gapWidth / 2 + 1;
  return g.nx
    ? { x: g.x - g.nx * depth / 2, z: g.z, hx: depth / 2, hz: w, yaw: 0 }
    : { x: g.x, z: g.z - g.nz * depth / 2, hx: w, hz: depth / 2, yaw: 0 };
}

/** The sidewalk in front of a gap, out to the kerb (kept clear so a car can drive straight in). */
export function gapMouth(g: FenceGap, sidewalk: number): Footprint {
  const depth = sidewalk + 1.5;
  const w = FF.gapWidth / 2 + 0.5;
  return g.nx
    ? { x: g.x + g.nx * (depth / 2 - 0.5), z: g.z, hx: depth / 2, hz: w, yaw: 0 }
    : { x: g.x, z: g.z + g.nz * (depth / 2 - 0.5), hx: w, hz: depth / 2, yaw: 0 };
}

/** A spot for something `hx` × `hz` inside `area`, clear of `taken`; null after a few tries. */
function spot(area: Rect, hx: number, hz: number, yaw: number, taken: Footprint[], rng: Rng, tries = 30): Footprint | null {
  for (let k = 0; k < tries; k++) {
    const fp: Footprint = {
      x: area.x + rng.range(-1, 1) * Math.max(0, area.w / 2 - Math.max(hx, hz)),
      z: area.z + rng.range(-1, 1) * Math.max(0, area.d / 2 - Math.max(hx, hz)),
      hx, hz, yaw,
    };
    if (!taken.some((t) => footprintsOverlap(fp, t))) return fp;
  }
  return null;
}

/** Place a prop of a kind in `area`, clear of `taken` (and taking its place). */
export function put(kind: PropKind, area: Rect, taken: Footprint[], rng: Rng, extra: Partial<StreetProp> = {}, yaw = rng.range(0, Math.PI * 2)): StreetProp | null {
  const probe: StreetProp = { kind, x: 0, z: 0, yaw, ...extra };
  const fp = propFootprint(probe, 0.3);
  const at = spot(area, fp.hx, fp.hz, yaw, taken, rng);
  if (!at) return null;
  const p = { ...probe, x: at.x, z: at.z };
  taken.push(propFootprint(p, 0.3));
  return p;
}

/**
 * A corn maze: a spanning tree of ~4 m paths over a coarse grid of cells in the field, each fence
 * gap joined to the cell beside it, so every gap reaches every other. Returns the path rects.
 */
export function cornMaze(field: Rect, gaps: FenceGap[], rng: Rng): Rect[] {
  const n = Math.max(3, Math.floor(Math.min(field.w, field.d) / FF.mazeCell));
  const cw = field.w / n, cd = field.d / n;
  const cx = (i: number) => field.x - field.w / 2 + cw * (i + 0.5);
  const cz = (j: number) => field.z - field.d / 2 + cd * (j + 0.5);
  const path = FF.mazePath;
  const out: Rect[] = [];
  // Depth-first carve from a random cell.
  const seen = new Set<number>();
  const stack = [rng.int(0, n * n - 1)];
  seen.add(stack[0]);
  while (stack.length) {
    const c = stack[stack.length - 1];
    const i = c % n, j = Math.floor(c / n);
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([di, dj]) => [i + di, j + dj])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && !seen.has(b * n + a));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [a, b] = rng.pick(next);
    seen.add(b * n + a);
    stack.push(b * n + a);
    // The path between the two cells' centres.
    const x0 = Math.min(cx(i), cx(a)), x1 = Math.max(cx(i), cx(a)), z0 = Math.min(cz(j), cz(b)), z1 = Math.max(cz(j), cz(b));
    out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0 + path, d: z1 - z0 + path });
  }
  // From each gap straight in to the nearest cell centre in line with it, then along to it.
  for (const g of gaps) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((g.x - (field.x - field.w / 2)) / cw)));
    const j = Math.min(n - 1, Math.max(0, Math.floor((g.z - (field.z - field.d / 2)) / cd)));
    const tx = cx(i), tz = cz(j);
    if (g.nx) {
      const x0 = Math.min(g.x, tx), x1 = Math.max(g.x, tx);
      out.push({ x: (x0 + x1) / 2, z: g.z, w: x1 - x0 + path, d: path });
      out.push({ x: tx, z: (g.z + tz) / 2, w: path, d: Math.abs(g.z - tz) + path });
    } else {
      const z0 = Math.min(g.z, tz), z1 = Math.max(g.z, tz);
      out.push({ x: g.x, z: (z0 + z1) / 2, w: path, d: z1 - z0 + path });
      out.push({ x: (g.x + tx) / 2, z: tz, w: Math.abs(g.x - tx) + path, d: path });
    }
  }
  return out;
}

/**
 * The orchard's trees on a ~6 m grid inside the field, the middle line of each side left as an
 * aisle (the fence gaps open into it), apples or pears for the whole farm.
 */
export function orchardTrees(field: Rect, pears: boolean, rng: Rng): StreetProp[] {
  const out: StreetProp[] = [];
  const s = FF.orchardSpacing;
  const nx = Math.floor((field.w - 2 * FF.orchardInset) / s / 2), nz = Math.floor((field.d - 2 * FF.orchardInset) / s / 2);
  for (let a = -nx; a < nx; a++) {
    for (let b = -nz; b < nz; b++) {
      const x = field.x + (a + 0.5) * s, z = field.z + (b + 0.5) * s;
      out.push({ kind: 'tree', tree: 'fruit', style: pears ? 'pear' : undefined, x, z, yaw: rng.range(0, Math.PI * 2), color: rng.pick([0xffffff, 0xeef6e8, 0xf6f2e4]) });
    }
  }
  return out;
}

/** What each field holds. `taken`: buildings, yard pieces and the fences, kept clear of. */
export function dressFields(
  fields: Field[], gaps: Record<number, FenceGap[]>, taken: Footprint[], rng: Rng,
): FieldDressing {
  const out: FieldDressing = { props: [], structures: [], solids: [], ground: [] };
  const pears = rng.next() < 0.5;
  let combine = false;
  for (const f of fields) {
    // The ways in through the gates; across a hay field they run right through (between the bales).
    const deep = f.crop === 'hay' ? Math.max(f.rect.w, f.rect.d) : FF.gapLane;
    const lanes = (gaps[f.block] ?? []).map((g) => gapLane(g, deep));
    const busy: Footprint[] = [...taken, ...lanes];
    const inner = shrink(f.rect, FF.edgeClear);
    // Scarecrows stand in the corn, wheat and pumpkins.
    const scarecrows = f.crop === 'corn' || f.crop === 'wheat' || f.crop === 'pumpkin' ? rng.int(FF.scarecrows[0], FF.scarecrows[1]) : 0;
    // A maze's paths stay clear too (its scarecrow stands in a path, where it can be seen).
    if (f.maze) busy.push(...f.maze.map((r) => rectFootprint(r)));
    switch (f.crop) {
      case 'orchard': {
        const trees = orchardTrees(f.rect, pears, rng).filter((t) => !busy.some((b) => footprintsOverlap(propFootprint(t, 0.5), b)));
        out.props.push(...trees);
        busy.push(...trees.map((t) => propFootprint(t, 1.2)));
        for (let k = rng.int(FF.fruitBins[0], FF.fruitBins[1]); k > 0; k--) {
          const p = put('fruitBin', inner, busy, rng);
          if (p) out.props.push(p);
        }
        break;
      }
      case 'pumpkin': {
        out.ground.push({ kind: 'vines', ...f.rect, yaw: f.rowsAlongX ? 0 : Math.PI / 2 });
        for (let k = 0; k < FF.pumpkins; k++) {
          const p = put('pumpkin', inner, busy, rng, { scale: rng.pick([0.6, 0.8, 1, 1, 1.3]) });
          if (p) out.props.push(p);
        }
        break;
      }
      case 'hay': {
        out.ground.push({ kind: 'stubble', ...f.rect, yaw: f.rowsAlongX ? 0 : Math.PI / 2 });
        // Round bales in loose rows along the field, solid; stacks of square ones, breakable.
        const along = f.rowsAlongX;
        for (let row = -1; row <= 1; row++) {
          const off = row * (along ? inner.d : inner.w) * 0.3;
          for (let u = -0.4; u <= 0.4; u += rng.range(0.12, 0.2)) {
            const len = (along ? inner.w : inner.d) * u;
            const x = f.rect.x + (along ? len : off) + rng.range(-1.5, 1.5), z = f.rect.z + (along ? off : len) + rng.range(-1.5, 1.5);
            const yaw = rng.range(0, Math.PI);
            const fp: Footprint = { x, z, hx: FF.baleLength / 2, hz: FF.baleRadius, yaw };
            if (busy.some((b) => footprintsOverlap(fp, { ...b, hx: b.hx + 0.6, hz: b.hz + 0.6 }))) continue;
            const data: RoundBaleData = { r: FF.baleRadius, len: FF.baleLength };
            out.structures.push({ kind: 'roundBale', x, z, yaw, footprints: [fp], data: data as unknown as Record<string, unknown> });
            out.solids.push(fp);
            busy.push({ ...fp, hx: fp.hx + FF.baleGap, hz: fp.hz + FF.baleGap });
          }
        }
        for (let k = rng.int(FF.baleStacks[0], FF.baleStacks[1]); k > 0; k--) {
          const at = spot(inner, 1.8, 1.2, 0, busy, rng);
          if (!at) continue;
          for (const [dx, dz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65], [1.95, 0]]) out.props.push({ kind: 'haybale', x: at.x + dx, z: at.z + dz, yaw: 0 });
          busy.push({ ...at, hx: at.hx + 0.5, hz: at.hz + 0.5 });
        }
        const wagon = put('hayWagon', inner, busy, rng);
        if (wagon) out.props.push(wagon);
        const baler = put('baler', inner, busy, rng);
        if (baler) out.props.push(baler);
        const rake = put('hayRake', inner, busy, rng);
        if (rake) out.props.push(rake);
        break;
      }
      case 'wheat': {
        // The combine (one per farm) parked at the field's edge, its header on a trailer beside it.
        if (!combine) {
          const yaw = f.rowsAlongX ? Math.PI / 2 : 0;
          const edge = shrink(f.rect, 6);
          const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: edge.x + sx * (edge.w / 2 - 2), z: edge.z + sz * (edge.d / 2 - 2) }));
          for (const c of corners) {
            const body: Footprint = { ...c, hx: FF.combine[0] / 2, hz: FF.combine[1] / 2, yaw };
            const off = f.rowsAlongX ? { x: 0, z: (c.z > f.rect.z ? -1 : 1) * 5 } : { x: (c.x > f.rect.x ? -1 : 1) * 5, z: 0 };
            const trailer: Footprint = { x: c.x + off.x, z: c.z + off.z, hx: FF.header[0] / 2, hz: FF.header[1] / 2, yaw: yaw + Math.PI / 2 };
            if ([body, trailer].some((fp) => busy.some((b) => footprintsOverlap(fp, b)))) continue;
            out.structures.push({ kind: 'combine', ...c, yaw, footprints: [body] });
            out.structures.push({ kind: 'headerTrailer', x: trailer.x, z: trailer.z, yaw: trailer.yaw, footprints: [trailer] });
            out.solids.push(body, trailer);
            busy.push(...[body, trailer].map((fp) => ({ ...fp, hx: fp.hx + 2, hz: fp.hz + 2 })));
            combine = true;
            break;
          }
        }
        break;
      }
    }
    for (let k = 0; k < scarecrows; k++) {
      const p = put('scarecrow', inner, busy, rng, {}, rng.range(0, Math.PI * 2));
      if (p) out.props.push(p);
    }
    // Bales and crates by the field's gates, inside the fence beside the opening.
    for (const g of gaps[f.block] ?? []) {
      if (rng.next() > FF.gateClutter) continue;
      const side = rng.next() < 0.5 ? -1 : 1;
      const along = FF.gapWidth / 2 + 1.2;
      const x = g.x - g.nx * 1.4 + (g.nx ? 0 : side * along), z = g.z - g.nz * 1.4 + (g.nz ? 0 : side * along);
      const p: StreetProp = { kind: rng.next() < 0.6 ? 'haybale' : 'crates', x, z, yaw: rng.range(-0.3, 0.3) };
      if (!busy.some((b) => footprintsOverlap(propFootprint(p), b) && !lanes.includes(b))) out.props.push(p);
    }
  }
  return out;
}

/** The farmyard's clutter and equipment, in the gaps round the buildings. */
export function yardClutter(yard: Rect, shed: Building | undefined, taken: Footprint[], rng: Rng): StreetProp[] {
  const out: StreetProp[] = [];
  const busy = [...taken];
  const area = shrink(yard, 1.5);
  const add = (kind: PropKind, extra: Partial<StreetProp> = {}, where = area, yaw?: number) => {
    const p = put(kind, where, busy, rng, extra, yaw);
    if (p) out.push(p);
    return p;
  };
  // Tractors: one in front of the machine shed's open side where there is one, the rest in the yard.
  const colours = [0x2f7a3a, 0xc8302a, 0x2f5a9a, 0xd8a02a];
  const tractors = rng.int(FF.tractors[0], FF.tractors[1]);
  for (let k = 0; k < tractors; k++) {
    const open = k === 0 && shed?.open ? shed.open : 0;
    const [nx, nz] = open === 1 ? [0, 1] : open === 2 ? [0, -1] : open === 4 ? [1, 0] : open === 8 ? [-1, 0] : [0, 0];
    const mouth: Rect = nx ? { x: shed!.x + nx * (shed!.w / 2 + 3), z: shed!.z, w: 5, d: shed!.d } : nz ? { x: shed!.x, z: shed!.z + nz * (shed!.d / 2 + 3), w: shed!.w, d: 5 } : area;
    // Nose out of the shed.
    const yaw = nx || nz ? Math.atan2(nx, nz) : undefined;
    add('parkedTractor', { color: rng.pick(colours) }, mouth, yaw);
  }
  add('plough');
  add('seedDrill');
  add('waterTrough');
  add('wheelbarrow');
  add('toolRack');
  add('feedSacks');
  for (let k = rng.int(2, 3); k > 0; k--) add('milkChurn');
  add('barrels');
  for (let k = rng.int(1, 3); k > 0; k--) add('haybale');
  for (let k = rng.int(0, 2); k > 0; k--) add('pumpkin', { scale: rng.pick([0.8, 1, 1.2]) });
  return out;
}
