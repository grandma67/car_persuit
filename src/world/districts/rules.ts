// Rules every district keeps, as checks that list what breaks them (empty when kept).
// DistrictRules.test.ts runs them on each registered district; the district's own test file
// keeps only what is particular to it. Tests only: nothing in the game imports this.
import { DISTRICTS } from '../../gameplay/balance';
import type { CityData } from '../CityGenerator';
import type { Landmark } from '../Landmarks';
import { FootprintIndex, footprintsOverlap, propFootprint, rectFootprint, type Footprint, type StreetProp } from '../StreetProps';
import type { District } from './District';
import { isJunctionControl } from './apply';

export const at = (p: { x: number; z: number }) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;

/** A landmark's footprint: the square round its radius. */
export const landmarkFootprint = (l: Landmark): Footprint => ({ x: l.x, z: l.z, hx: l.radius, hz: l.radius, yaw: 0 });

/** Road segments and junctions, and with `plazas` the plazas' paving too. */
export function pavedOf(c: CityData, { plazas = false } = {}): Footprint[] {
  return [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint), ...(plazas ? c.plazas.map(rectFootprint) : [])];
}

/** The district's solids (structures' footprints are among them) and landmarks. */
export const solidsOf = (q: District): Footprint[] => [...q.dressing.solids, ...q.dressing.landmarks.map(landmarkFootprint)];

/** Every solid and landmark off the roads, junctions and plazas. */
export function solidsOnPaving(c: CityData, q: District): string[] {
  const paved = new FootprintIndex(pavedOf(c, { plazas: true }), 16);
  return [
    ...q.dressing.solids.filter((f) => paved.hits(f)).map((f) => `solid at ${at(f)}`),
    ...q.dressing.landmarks.filter((l) => paved.hits(landmarkFootprint(l))).map((l) => `${l.kind} at ${at(l)}`),
  ];
}

/** Junction controls (signals, stop and priority signs …) as in the city without districts; only their style may change. */
export function junctionControlChanges(c: CityData, plain: CityData): string[] {
  const key = ({ style: _style, ...p }: StreetProp) => JSON.stringify(p);
  const had = new Set(plain.streetProps.filter(isJunctionControl).map(key));
  const has = new Set(c.streetProps.filter(isJunctionControl).map(key));
  return [...[...had].filter((k) => !has.has(k)).map((k) => `lost ${k}`), ...[...has].filter((k) => !had.has(k)).map((k) => `new ${k}`)];
}

/** No junction control stands inside a solid or landmark. */
export function controlsInSolids(c: CityData, q: District): string[] {
  const solid = new FootprintIndex(solidsOf(q), 16);
  return c.streetProps.filter(isJunctionControl).filter((p) => solid.hits(propFootprint(p))).map((p) => `${p.kind} ${p.variant ?? ''} at ${at(p)}`);
}

/** The district's props stand clear of its solids and landmarks, of every building and of each other. */
export function propCollisions(c: CityData, q: District): string[] {
  const solid = new FootprintIndex(solidsOf(q));
  const buildings = new FootprintIndex(c.buildings.map(rectFootprint), 16);
  const placed = new FootprintIndex();
  const out: string[] = [];
  for (const p of q.dressing.props) {
    const f = propFootprint(p);
    if (solid.hits(f)) out.push(`${p.kind} in a solid at ${at(p)}`);
    if (buildings.hits(f)) out.push(`${p.kind} in a building at ${at(p)}`);
    if (placed.hits(f)) out.push(`${p.kind} on another prop at ${at(p)}`);
    placed.add(f);
  }
  return out;
}

/** These props keep `DISTRICTS.clutterMinOffset` from the centre line of every road beside them. */
export function clutterOnCentreLine(c: CityData, props: StreetProp[]): string[] {
  const out: string[] = [];
  for (const p of props) {
    const f = propFootprint(p);
    const reach = Math.hypot(f.hx, f.hz);
    const near = propFootprint(p, c.config.sidewalk);
    for (const { rect } of c.roads) {
      if (!footprintsOverlap(near, rectFootprint(rect))) continue;
      const lateral = rect.w > rect.d ? Math.abs(p.z - rect.z) : Math.abs(p.x - rect.x);
      if (lateral - reach < DISTRICTS.clutterMinOffset - 1e-6) out.push(`${p.kind} ${(lateral - reach).toFixed(2)} m off the centre line at ${at(p)}`);
    }
  }
  return out;
}

/** Everything over the road clears the tallest vehicle. */
export function lowOverhead(q: District): string[] {
  return q.dressing.overhead.filter((o) => o.bottom < DISTRICTS.overheadClearance).map((o) => `${o.kind} ${o.bottom.toFixed(2)} m up`);
}

/** Districts keep at least a block apart. */
export function districtsTouching(c: CityData): string[] {
  const out: string[] = [];
  c.districts.forEach((a, i) => c.districts.slice(i + 1).forEach((b) => {
    const g = a.grid, o = b.grid;
    if (g.i0 - 1 < o.i0 + o.w && o.i0 < g.i0 + g.w + 1 && g.j0 - 1 < o.j0 + o.h && o.j0 < g.j0 + g.h + 1) out.push(`${a.kind} touches ${b.kind}`);
  }));
  return out;
}

/** A placed district owns its blocks and its buildings stand inside it; one that sat out leaves no trace. */
export function partialDistricts(c: CityData, kinds: string[]): string[] {
  const out: string[] = [];
  for (const kind of kinds) {
    const q = c.districts.find((d) => d.kind === kind);
    const blocks = c.blocks.flatMap((b, k) => (b.district === kind ? [k] : []));
    const built = c.buildings.filter((b) => b.district === kind);
    if (!q) {
      if (blocks.length || built.length) out.push(`${kind} sat out but left ${blocks.length} blocks, ${built.length} buildings`);
      continue;
    }
    if (blocks.slice().sort().join() !== q.blocks.slice().sort().join()) out.push(`${kind} blocks differ from its grid`);
    for (const b of built) if (Math.abs(b.x - q.bounds.x) > q.bounds.w / 2 || Math.abs(b.z - q.bounds.z) > q.bounds.d / 2) out.push(`${kind} ${b.lot} outside at ${at(b)}`);
  }
  return out;
}

/** Everything a district generates, for comparing two runs of a seed. */
export function districtSignature(c: CityData, q: District): string {
  return JSON.stringify({ ...q, roles: [...q.roles], streets: [...q.streets], buildings: c.buildings.filter((b) => b.district === q.kind) });
}
