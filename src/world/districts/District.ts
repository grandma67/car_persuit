// City districts: themed zones (Old City, Chinatown, Harbor, Farm …) laid over a rectangle of
// blocks as the last step of generateCity. Each district is a definition (DistrictDef): where it may
// go, how it fills its blocks, which props it drops or swaps, and how it dresses itself. The
// generic code places, fills and wires any number of them. Pure data — no Three.js.
import type { Rng } from '../../core/Rng';
import type { Building, CityData, Zone, Rect } from '../CityGenerator';
import type { Landmark } from '../Landmarks';
import type { LotStyle } from '../lots';
import type { Footprint, PropKind, StreetProp } from '../StreetProps';
import type { FacadeStyle } from '../../render/Facades';

export type { LotStyle } from '../lots';

/** Grows with the registry (world/districts/index.ts). */
export type DistrictKind = 'oldtown' | 'chinatown' | 'harbor' | 'farm';

/** What a special (unfilled) block is for; the district's dressing fills it. */
export type BlockRole = 'square' | 'yard' | 'field' | 'farmyard';

// --- Building looks (rendered by CityBuilder's addBuilding through the facade pipeline) ---

export type RoofShape = 'flat' | 'gable' | 'steepGable' | 'hip' | 'gambrel' | 'sawtooth' | 'barrel' | 'monopitch' | 'pagoda';
export type TrimKind = 'jetty' | 'colonnade' | 'balcony' | 'loadingDock' | 'porch' | 'chimney' | 'hoist' | 'clockTower' | 'radarMast';

/** How a lot's building looks: facade per floor band, roof, palette and merged trims. */
export interface LotLook {
  facade: FacadeStyle; // upper floors
  ground?: FacadeStyle; // floor 0 only (shopfronts, roller doors, barn doors); defaults to `facade`
  roof: RoofShape;
  palette: number[]; // wall tints, picked by the building's variant
  roofTiles?: number[]; // roof colours for pitched roofs
  trims?: TrimKind[];
}

// --- Placement results ---

/** A way into the district: an interior street where it crosses the wall line. */
export interface Gate {
  node: number; // the perimeter junction
  inner: number; // the junction at the street's other end, inside
  edge: string; // `${node}>${inner}`
  x: number; // centre of the opening, on the wall line
  z: number;
  yaw: number; // heading into the district
  opening: number; // width of the opening, metres
}

/** A solid set piece: walls, gatehouses, paifang, cranes, ships … rendered by the district's renderer. */
export interface Structure {
  kind: string;
  x: number;
  z: number;
  yaw: number;
  /** Solid footprints (also in dressing.solids). */
  footprints: Footprint[];
  /** Anything else the renderer needs (heights, spans, tiers …). */
  data?: Record<string, unknown>;
}

/** Visual-only dressing over the road (lantern strings, canopies, arches): no collider. */
export interface Overhead {
  kind: string;
  /** Polyline it hangs along, or its centre. */
  points: { x: number; z: number }[];
  /** Lowest point above the ground, metres: ≥ DISTRICTS.overheadClearance over any road. */
  bottom: number;
  data?: Record<string, unknown>;
}

/** A flush texture patch on the ground: cobbles, apron, weighbridge, rails, fields. */
export interface GroundPatch extends Rect {
  kind: string;
  yaw?: number;
}

export interface DistrictDressing {
  landmarks: Landmark[]; // solid set pieces (well, lion, bollard …), appended to city.landmarks
  props: StreetProp[]; // breakables and clutter, appended to city.streetProps
  structures: Structure[];
  overhead: Overhead[];
  ground: GroundPatch[];
  solids: Footprint[]; // everything solid off the road, for colliders and NavGrid
  drivable: Rect[]; // off-road areas a car may use (yard corridors, fields)
  soft?: Rect[]; // ground with less grip and more rolling drag (fields; wired in FM4)
  extra?: Record<string, unknown>; // district-specific data (festival, night market …)
}

export const emptyDressing = (): DistrictDressing => ({ landmarks: [], props: [], structures: [], overhead: [], ground: [], solids: [], drivable: [] });

export interface District {
  kind: DistrictKind;
  /** Grid rectangle of blocks: lower-corner block (i0, j0), w × h blocks. */
  grid: { i0: number; j0: number; w: number; h: number };
  blocks: number[]; // indices into city.blocks
  roles: Map<number, BlockRole>; // block index → role (special blocks, not filled)
  bounds: Rect; // the blocks' union, interior streets included
  frontage?: Rect; // coast only: ring road + promenade + a strip of sea
  /** Which side the frontage is on (coast only): the outward normal. */
  coast?: { nx: number; nz: number };
  /** Junctions strictly inside (interior nodes) and on the perimeter. */
  interior: number[];
  perimeter: number[];
  streets: Set<string>; // interior road edges, "a>b" both ways
  mainStreet: string[]; // longest straight interior run, "a>b" in order along it
  gates: Gate[];
  dressing: DistrictDressing;
}

/** Vehicle limits inside a district. */
export interface DistrictTraffic {
  speed?: number; // m/s cap
  speedOn?: 'all' | 'mainStreet';
  density: number; // spawn density multiplier inside
  heavy: boolean; // false: no buses or trucks inside
  weights?: Partial<Record<string, number>>; // spawn weight multiplier per vehicle spec name inside
}

export interface DistrictDef {
  kind: DistrictKind;
  salt: number; // RNG stream: seed ^ salt
  chance: number; // independent roll per seed
  site: 'inland' | 'coast';
  shapes: [number, number][]; // cluster sizes in blocks; both orientations are tried
  rings: Zone[]; // zones its blocks may sit in
  minShare?: Partial<Record<Zone, number>>; // e.g. { midtown: 0.5 }
  gates: 'all' | 'mainStreet';
  extraGates?: number; // with 'mainStreet': up to this many more
  buildingStyle: LotStyle;
  looks: Record<string, LotLook>; // per lot kind (Building.lot)
  roles(q: District, city: CityData, rng: Rng): Map<number, BlockRole>;
  lots(q: District, buildings: Building[], city: CityData, rng: Rng): void; // assigns Building.lot
  drop(p: StreetProp): boolean; // props removed inside (never junction controls)
  swap: Partial<Record<PropKind, PropKind>>;
  keepZebras: boolean;
  traffic: DistrictTraffic;
  copSpawnSkip: number; // 0..1 chance a cop spawn try inside is re-rolled
  roadblockGates: boolean; // 4★+ roadblocks prefer a gate edge
  mapColor: number;
  label: string; // for the start toast, e.g. "Old City"
  dress(q: District, city: CityData, rng: Rng): DistrictDressing;
}
