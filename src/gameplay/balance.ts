// All gameplay tuning numbers in one place. Wanted/cop tuning joins this in M5.
import { ALL_SPECS, vehicleTop } from '../vehicles/VehicleSpecs';

export interface MissionConfig {
  timeLimit: number; // seconds
  destinations: number;
  minRouteDistance: number; // metres by road between consecutive destinations
  maxRouteDistance: number;
  reachRadius: number; // metres from the destination centre that counts as arrived
}

export const MISSION: MissionConfig = {
  timeLimit: 600,
  destinations: 5,
  minRouteDistance: 700,
  maxRouteDistance: 1100,
  reachRadius: 9,
};

/** Seconds left at which the timer turns red. */
export const TIMER_WARNING = 60;

export interface DamageConfig {
  maxHealth: number;
  /** Impacts (velocity change, m/s) at or below this do no damage — scrapes and kerbs. */
  impactThreshold: number;
  /** Health lost per m/s of impact above the threshold. */
  impactScale: number;
  smokeBelow: number; // health ratio
  fireBelow: number;
}

// Rough feel: 60 km/h into a wall ≈ 20% health, 150 km/h ≈ 65%.
export const DAMAGE: DamageConfig = {
  maxHealth: 100,
  impactThreshold: 5,
  impactScale: 1.8,
  smokeBelow: 0.5,
  fireBelow: 0.2,
};

/**
 * Cop contact damage to the player, from the kinematics of the hit: the delta-V the cop's push
 * gave the player's car (the contact impulse over its mass, which already carries the cop's mass,
 * the closing speed along the contact normal and the bounce). Crash damage grows with crush energy,
 * faster than delta-V, so a bump or a glancing bounce barely marks the car while a square ram at
 * medium speed hurts. Replaces normal crash damage for that hit and ignores armor, so a cop that
 * keeps ramming always wears the car down; scaled by the difficulty's damage multiplier.
 */
export const COP_RAM = {
  /** Seconds after contact begins that count as the crash itself (real crash pulses: 0.07–0.15 s). */
  pulse: 0.15,
  /** Delta-V (m/s) a hit can give without damage: bumper-to-bumper nudges. */
  bump: 1.5,
  /** Health per (m/s of delta-V above the bump)^1.5: ~25 for a patrol car ramming at 54 km/h. */
  bangPerDv: 1.35,
  /** After the pulse, while pushing or pinning the player: health per m/s of delta-V it adds. */
  grindPerDv: 0.5,
};

export type CopType = 'patrol' | 'interceptor' | 'suv' | 'armored';

export interface StarLevel {
  /** Effective seconds (elapsed + heat) at which this star level starts. */
  at: number;
  maxCops: number;
  spawnInterval: number; // seconds between spawns while under the cap
  mix: Partial<Record<CopType, number>>; // spawn weights
  roadblocks: boolean;
  /** Cop aggression: how far they spot you and how hard they push to catch up. */
  chaseRange: number;
  catchUp: number;
}

// Index 0 = 1 star … index 4 = 5 stars.
export const WANTED: StarLevel[] = [
  { at: 0, maxCops: 2, spawnInterval: 6, mix: { patrol: 1 }, roadblocks: false, chaseRange: 110, catchUp: 1.2 },
  { at: 90, maxCops: 4, spawnInterval: 4.5, mix: { patrol: 1 }, roadblocks: false, chaseRange: 120, catchUp: 1.25 },
  { at: 180, maxCops: 6, spawnInterval: 3.5, mix: { patrol: 0.6, interceptor: 0.4 }, roadblocks: false, chaseRange: 135, catchUp: 1.3 },
  { at: 300, maxCops: 8, spawnInterval: 3, mix: { patrol: 0.4, interceptor: 0.3, suv: 0.3 }, roadblocks: true, chaseRange: 150, catchUp: 1.35 },
  { at: 420, maxCops: 10, spawnInterval: 2.5, mix: { patrol: 0.3, interceptor: 0.3, suv: 0.2, armored: 0.2 }, roadblocks: true, chaseRange: 160, catchUp: 1.4 },
];

/** Extra "wanted time" (seconds) for trouble you cause. */
export const HEAT = {
  copWrecked: 25,
  copWhacked: 6, // each time the player rams a cop, plus copWhackedPerMs × ramming speed
  copWhackedPerMs: 0.4,
  copWhackedMax: 20,
  propSmashed: 0.6,
  civilianHit: 2,
};

/** Each destination reached makes the wanted level climb this much faster. */
export const CHECKPOINT_HEAT_RATE = 1.3;

/** Seconds between roadblock attempts at 4+ stars. */
export const ROADBLOCK_INTERVAL = 35;

/**
 * City districts (Old City, Chinatown, Harbor, Farm): shared rules. Anything above a road (gate
 * arches, lantern strings, crane portals) clears the tallest vehicle by 1.5 m; kerb clutter may
 * poke into the roadway but stays this far from the centre line (about 0.75 m beside the widest
 * body in its lane).
 */
export const DISTRICTS = {
  max: 4, // safety cap on districts per city, in placement order
  orderSalt: 0x0d3e7, // stream for the per-seed placement order of the rolled districts
  clutterMinOffset: 5, // metres from the centre line
  overheadClearance: Math.max(...ALL_SPECS.map(vehicleTop)) + 1.5,
  frontageSea: 50, // metres of sea a coast district's frontage reaches out
  clutterGap: 8, // metres kept clear at junction mouths and gate approaches
  outerRing: 2, // rows of blocks round the edge kept for the outer districts (Harbor, Farm)
};

/** The Old City: a walled medieval core in the middle ring (world/districts/OldCity.ts). */
export const OLD_CITY = {
  chance: 0.55,
  speed: 30 / 3.6, // m/s cap on every street inside
  density: 0.5,
  copSpawnSkip: 0.6,
  /** Share of the ordinary lots per kind (the rest are half-timbered). */
  stoneShare: 0.35,
  ruinShare: 0.08,
  townHallHeight: 12, // at least, metres
  ruinWall: 3.5, // highest a ruin's broken walls stand, metres (its arch rises to ~7)
  crossOffset: 13, // market cross from the well, metres
  stalls: 9, // round the well (fewer where the cross stands)
  stallRing: 16, // metres from the well
  // Glow budget: emissive instances inside the walls (oil lamps + gatehouse torches, two a gate,
  // at most maxTorches). Oil lamps past it are thinned out evenly.
  maxGlow: 60,
  maxTorches: 16,
};

/** Chinatown: an open, busy district behind paifang gates (world/districts/Chinatown.ts). */
export const CHINATOWN = {
  chance: 0.5,
  speed: 40 / 3.6, // m/s cap on the main street only
  density: 1.3,
  vanWeight: 2, // spawn weight multiplier for vans inside
  squareChance: 0.4, // a small square for the pagoda
  restaurants: [2, 4] as [number, number],
  banquetChance: 0.5,
  templeChance: 0.4,
  templeHeight: 9, // at most, metres
  squareStalls: 7, // stalls and mahjong tables round the pagoda
  vans: [1, 3] as [number, number], // delivery vans double-parked on the main street
  vanGap: 15, // metres, at least, from a junction mouth or a gate
  vanOnKerb: 0.6, // how far a parked van stands up on the kerb (its inner side then clears the widest bus in the lane)
  /** How many of each small shop, at most (from the lots fronting a street). */
  shops: { teaHouse: 2, bubbleTea: 2, herbalShop: 2, bakery: 2 },
  /** Lunar New Year: rolled per seed on the district's stream, shown at night. */
  festivalChance: 0.25,
  /** Glowing pieces at night, at most: string lanterns (festival ones included) plus night-market bulbs. */
  maxGlow: 1100,
  nightStalls: [3.5, 6] as [number, number], // metres between night-market stalls on the main street
  bulbHeight: 4.4, // bare-bulb strings tie to the shopfronts this high
  bulbSpan: 6, // between ties
  bulbSag: 0.45,
  bulbSpacing: 0.75, // between bulbs
  fireworks: [1.2, 3] as [number, number], // seconds between bursts over the pagoda (festival nights)
  fireworksRange: 350, // only while the camera is this near
};

/** The Harbor: a cargo port on the coast (world/districts/Harbor.ts), metres where not said. */
export const HARBOR = {
  chance: 0.45,
  density: 0.9,
  boxTruckWeight: 3, // spawn weight multipliers inside
  vanWeight: 1.5,
  yards: [1, 2] as [number, number], // container-yard blocks on the quay row
  cranes: [1, 3] as [number, number], // gantry cranes over the seafront road
  /** Containers drawn, at most (yard stacks, flatcars, the ship's deck): the top tiers go first. */
  maxContainers: 900,
  maxGlow: 140, // floodlights, aviation lights, ship lights at night
  stackRows: [3, 4] as [number, number], // container rows across a yard block
  stackWide: [2, 3] as [number, number], // containers side by side in a row
  stackHigh: [1, 4] as [number, number], // tiers per column
  crossCorridor: 8, // the corridor across the rows, through the middle of the block
  stackMargin: 0.6, // stacks stand this far in from the sidewalk line
  straddles: [0, 2] as [number, number], // straddle carriers parked in a yard's corridors
  straddleGap: 4.0, // the drivable gap between a carrier's frames, at least (the widest body + 1 m and some)
  transitShedShare: 0.5, // quay-row lots that are open transit sheds
  coldStores: [0, 2] as [number, number],
  officeHeight: [16, 22] as [number, number],
  officeSide: 22, // the harbor office's footprint, at most, each way
  siloChance: 0.5,
  siloHeight: [22, 30] as [number, number],
  tankFarmChance: 0.4,
  forklifts: 3, // parked by shed fronts, at most
  bund: 1.2, // bund wall height round the tank farm
};

/** The Farm: fields and a farmyard on the island's edge (world/districts/Farm.ts), metres where not said. */
export const FARM = {
  chance: 0.4,
  density: 0.4,
  pickupWeight: 3, // spawn weight multipliers inside
  tractorWeight: 2,
  copSpawnSkip: 0.4,
  maxCrop: 6000, // crop row-strip instances drawn, at most
  trampleRes: 64, // trample texture per field, texels a side
  mazeChance: 0.3, // a corn maze in one corn field
  harvestChance: 0.25, // harvest night (night runs only)
  fieldGrip: 0.7, // tyre grip multiplier on soft ground
  fieldDrag: 0.6, // extra rolling drag on soft ground, m/s² at speed
  maxGlow: 60, // windows, yard lights, lanterns, fireflies at night
  /** Largest footprint per farmyard lot kind, each way (the rest of the lot is yard). */
  lotSize: {
    farmhouse: [14, 11], barn: [24, 16], machineShed: [22, 12], granary: [8, 6], henhouse: [9, 6],
  } as Record<string, [number, number]>,
  farmhouseHeight: [7, 9] as [number, number], // two storeys
  barnHeight: [8, 10] as [number, number],
  lowHeight: [3.5, 5] as [number, number], // granary and henhouse
  cornerInset: 3, // a granary or henhouse put in a free yard corner stands this far in from the sidewalk line
  yardGap: 4, // and at least this far from the other buildings
};

/** The Farm's ranch gate, cattle grids, yard pieces and fences (world/districts/FarmGate.ts), metres. */
export const FARM_GATE = {
  setIn: [1, 3.5, 6, 9], // ranch-gate posts in from the wall line (further in if a post would touch a junction control)
  post: 0.35, // a log post's solid footprint, half side
  headroom: 0.3, // the sign's bottom above overheadClearance
  signWidth: 6.5,
  signHeight: 1.3,
  chain: 0.5, // between the sign and the crossbeam
  mailboxOut: 1.6, // the mailbox, in from the right-hand post
  gridDepth: 2.6, // a cattle grid along the street
  pieceGap: 2, // silos, bins, windmill and tower keep this far from buildings and each other
  rowGap: 0.8, // between silos (or bins) in a row
  silos: [1, 3] as [number, number],
  bins: [2, 4] as [number, number],
  waterTowerChance: 0.5,
  fenceInset: 0.3, // field fences stand this far inside the sidewalk line
  fieldGate: 8, // the gap in a field's fence, wide enough for any car
  railLength: 3, // one split-rail panel
};

/** The Harbor's quay: bollards, gantry cranes and the moored ship (world/districts/HarborQuay.ts), metres. */
export const HARBOR_QUAY = {
  bollardSpacing: 15,
  bollardInset: 1.0, // bollard centres in from the quay edge (the sea wall's inner face is 0.6 in)
  bollard: 0.35, // radius
  leg: 0.65, // half side of a crane leg's footprint
  gauge: 16, // between a crane's legs along the rail
  cornerClear: 6, // crane legs this far from a block's corner (the junction mouth)
  craneGap: 12, // between neighbouring cranes' nearest legs
  waterLeg: 1.4, // waterside leg centres in from the quay edge
  portal: 17, // portal girders' underside above the crane's footing
  boom: 33, // boom height above the footing
  outreach: 42, // the boom's reach past the waterside legs
  backreach: 16, // and behind the landside legs
  truckLength: 16.2, // a terminal truck parked on the apron under a working crane (chassis and cab)
  truckWidth: 2.5,
  shipGap: 2.2, // fenders between the quay face and the hull
  shipLength: [120, 180] as [number, number], // fitted to the frontage
  shipEnds: 8, // the ship keeps this far in from the frontage's ends
  tugChance: 0.4,
  /** Ship types per seed: container ships work the cranes; the others leave them idle, booms up. */
  shipOdds: { container: 0.5, bulk: 0.25, general: 0.25 },
};

/** ISO containers, metres. */
export const CONTAINER = { w: 2.44, h: 2.59, l20: 6.06, l40: 12.19, gap: 0.25 };

/** Chinatown's paifang, lions and lantern strings (world/districts/ChinatownGates.ts), metres. */
export const CHINATOWN_GATES = {
  setIn: [4.5, 6.5, 8.5], // paifang in from the gate line (further in if a column would touch a junction control)
  column: 0.45, // a column's solid footprint, half across the road (its plinth)…
  columnAlong: 0.8, // …and half along it (its drum stones)
  fourChance: 0.5, // four columns (two a side) rather than two
  beam: 6.2, // beam underside above the highest ground under the span (≥ DISTRICTS.overheadClearance)
  lionOut: 2.5, // lions in front of the paifang
  wireHeight: 7.6, // lantern wires tie to the buildings this high
  sag: 0.9, // wire sag at mid-span
  lanternDrop: 0.8, // wire to a lantern's bottom
  lanternSpacing: 1.6, // between lanterns on a wire
  lanternPitch: 10, // between strings on the main street
  lanternGap: 3, // strings stay this far past the building line from a junction
  sideStrings: [1, 2] as [number, number], // strings per side street
};

/** Old City walls and gatehouses (world/districts/OldCityWalls.ts), metres. */
export const OLD_CITY_WALLS = {
  height: 7, // wall top above its footing
  thick: 1.8, // from the wall line inward
  piece: 10, // longest wall stretch on one footing (walls step up a hill)
  cornerHalf: 3.5, // corner towers
  cornerHeight: 11,
  cornerOut: 1.6, // how far a corner tower stands out over the sidewalk: clear of the corner signals and signs
  gateHalf: 2.6, // gatehouse towers beside each opening
  gateHeight: 10.5,
  gateOut: 2, // how far a gatehouse tower stands out over the sidewalk
  postHalf: 1.2, // plain posts where a plaza crosses the wall line
  archAbove: 0.6, // extra headroom over overheadClearance under arches
};

/** Tilt steering on phones: the phone turned like a wheel, measured in the screen's plane. */
export const TILT = {
  deadZone: 3, // degrees of roll that do nothing, so a hand's tremble doesn't wander the car
  fullLock: 25, // degrees of roll for full steer
  smoothing: 12, // 1/s low-pass on the sensor (it updates ~60 Hz and jitters)
};
