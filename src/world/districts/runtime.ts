// What the game's systems need from the placed districts: speed caps and no-go streets for
// traffic, spawn weights, cop spawn skips, roadblock gates, destination zoning. Pure data.
import type { CityData } from '../CityGenerator';
import type { Footprint, PropKind, StreetProp } from '../StreetProps';
import { inRect } from '../lots';
import { DISTRICT_DEFS } from './index';
import type { DistrictDef, DistrictKind, DistrictTraffic, Structure } from './District';

const defOf = (kind: DistrictKind, defs: DistrictDef[]) => defs.find((d) => d.kind === kind);

/** The district whose interior holds this junction (perimeter junctions are ordinary city streets). */
export function districtOfNode(city: CityData, id: number): DistrictKind | undefined {
  return city.districts.find((q) => q.interior.includes(id))?.kind;
}

/** Traffic rules inside the districts, keyed by street ("a>b") and by interior junction. */
export interface DistrictTrafficRules {
  /** Speed cap (m/s) per street, entering it included. */
  limits: Map<string, number>;
  /** Streets buses and trucks keep out of. */
  noHeavy: Set<string>;
  /** Interior junctions and their district's traffic (spawn density and mix). */
  nodes: Map<number, DistrictTraffic>;
  /** Perimeter junctions of districts with an edge mix (DistrictTraffic.edge): spawns there use it. */
  edges: Map<number, DistrictTraffic>;
}

export function districtTraffic(city: CityData, defs: DistrictDef[] = DISTRICT_DEFS): DistrictTrafficRules {
  const rules: DistrictTrafficRules = { limits: new Map(), noHeavy: new Set(), nodes: new Map(), edges: new Map() };
  for (const q of city.districts) {
    const def = defOf(q.kind, defs);
    if (!def) continue;
    const t = def.traffic;
    if (t.speed !== undefined) {
      const capped = t.speedOn === 'mainStreet' ? q.mainStreet.flatMap((k) => [k, k.split('>').reverse().join('>')]) : [...q.streets];
      for (const k of capped) rules.limits.set(k, t.speed);
    }
    if (!t.heavy) for (const k of q.streets) rules.noHeavy.add(k);
    for (const id of q.interior) rules.nodes.set(id, t);
    if (t.edge) for (const id of q.perimeter) rules.edges.set(id, { density: 1, heavy: true, weights: t.edge });
  }
  return rules;
}

/**
 * Chance a cop spawn spot at (x, z) is passed over for the next: inside the blocks of a district
 * that keeps cops rarer (its interior streets included), else 0.
 */
export function copSpawnSkips(city: CityData, defs: DistrictDef[] = DISTRICT_DEFS): (x: number, z: number) => number {
  const rare = city.districts.flatMap((q) => {
    const skip = defOf(q.kind, defs)?.copSpawnSkip ?? 0;
    return skip > 0 ? [{ bounds: q.bounds, skip }] : [];
  });
  return (x, z) => rare.find((r) => inRect(r.bounds, { x, z }))?.skip ?? 0;
}

/** Gate streets (both ways) of districts whose roadblocks prefer a gate. */
export function roadblockGates(city: CityData, defs: DistrictDef[] = DISTRICT_DEFS): Set<string> {
  const out = new Set<string>();
  for (const q of city.districts) {
    if (!defOf(q.kind, defs)?.roadblockGates) continue;
    for (const g of q.gates) out.add(`${g.node}>${g.inner}`).add(`${g.inner}>${g.node}`);
  }
  return out;
}

/** Street props a district shows only at night (dressing.extra.nightProps: Chinatown's night market and festival). */
export function nightProps(city: CityData): StreetProp[] {
  return city.districts.flatMap((q) => (q.dressing.extra?.nightProps as StreetProp[] | undefined) ?? []);
}

/** Dressing a district shows only on some runs: structures with their solids, props, prop kinds taken away. */
export interface RunDressing {
  structures?: Structure[];
  solids?: Footprint[];
  props?: StreetProp[];
  drop?: PropKind[];
}

/**
 * Join the run's extra dressing into the city before it is built: on a night run each district's
 * `extra.night` (the Farm's harvest-night bale pyramid), and the climate's `extra.byClimate[name]`
 * (the desert's irrigator, no pumpkins in the snow). Generation itself never depends on either.
 */
export function joinRunDressing(city: CityData, run: { night: boolean; climate: string }): void {
  for (const q of city.districts) {
    const extra = q.dressing.extra as { night?: RunDressing; byClimate?: Record<string, RunDressing> } | undefined;
    for (const d of [run.night ? extra?.night : undefined, extra?.byClimate?.[run.climate]]) {
      if (!d) continue;
      q.dressing.structures.push(...(d.structures ?? []));
      q.dressing.solids.push(...(d.solids ?? []));
      if (d.drop?.length) {
        const gone = new Set<PropKind>(d.drop);
        q.dressing.props = q.dressing.props.filter((p) => !gone.has(p.kind));
        city.streetProps = city.streetProps.filter((p) => !gone.has(p.kind) || !inRect(q.bounds, p));
      }
    }
  }
}
