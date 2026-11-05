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
 * City districts (Old City, Chinatown, Harbor, Farm, Slums): shared rules. Anything above a road (gate
 * arches, lantern strings, crane portals) clears the tallest vehicle by 1.5 m; kerb clutter may
 * poke into the roadway but stays this far from the centre line (about 0.75 m beside the widest
 * body in its lane).
 */
export const DISTRICTS = {
  max: 5, // safety cap on districts per city, in placement order
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
  tractorWeight: 4,
  tractorEdge: 2, // tractors' weight on the perimeter streets (none anywhere else in the city)
  copSpawnSkip: 0.4,
  maxCrop: 6000, // crop row-strip instances drawn, at most
  trampleRes: 64, // trample texture per field, texels a side
  mazeChance: 0.3, // a corn maze in one corn field
  harvestChance: 0.25, // harvest night (night runs only)
  fieldGrip: 0.7, // tyre grip multiplier on soft ground
  fieldDrag: 2.5, // extra rolling drag on soft ground, m/s²
  maxGlow: 110, // at night: timber street lamps, the yard light, the barn lantern, jack-o'-lanterns, fireflies
  jackOLanterns: 24, // on a harvest night, at most
  fireflies: 36, // on a warm night, at most (within maxGlow)
  pivotInset: 3, // the irrigator's reach stops this far inside its field
  pivotTower: 0.6, // a tower's solid footprint, half side
  pivotHeight: 3.2, // the truss above the ground
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

/** What stands in the Farm's fields and yard (world/districts/FarmFields.ts), metres. */
export const FARM_FIELDS = {
  gapLane: 12, // kept clear of solids and clutter, in from each fence gap
  gapWidth: FARM_GATE.fieldGate,
  edgeClear: 2.5, // things in a field keep this far in from its fence
  mazeCell: 9, // a corn maze's grid
  mazePath: 4, // its paths' width
  orchardSpacing: 6, // fruit trees on this grid
  orchardInset: 2,
  scarecrows: [1, 2] as [number, number],
  fruitBins: [2, 4] as [number, number],
  pumpkins: 45, // per pumpkin field, at most
  baleRadius: 0.8, // round bales
  baleLength: 1.5,
  baleGap: 1.6, // between round bales, at least (a car squeezes through)
  baleStacks: [1, 3] as [number, number], // stacks of square bales per hay field
  combine: [3.6, 9] as [number, number], // the combine's footprint, across and along
  header: [2.6, 9.5] as [number, number], // its header on a trailer
  gateClutter: 0.5, // chance of a bale or crates by a field gate
  standIn: 0.95, // the pumpkin stand's centre, in from the kerb
  standAlong: 3, // and along from the gate's edge
  tractors: [1, 3] as [number, number],
};

/** The Slums: run-down blocks just outside the centre (world/districts/Slums.ts), metres where not said. */
export const SLUMS = {
  chance: 0.35,
  density: 0.6,
  pickupWeight: 2, // spawn weight multipliers inside
  vanWeight: 1.5,
  copSpawnSkip: 0.5,
  vacant: [1, 2] as [number, number], // vacant blocks (rubble lots), one of which may be the camp
  campChance: 0.6, // a tent camp in a vacant block (or half of one)
  junkyardChance: 0.6, // a junkyard block (3×3 always, when it has the room)
  ruins: [1, 2] as [number, number], // destroyed buildings on lots that front a street
  ruinMin: 10, // a ruin's lot, at least this each way
  gutted: [1, 3] as [number, number], // burnt-out shells
  boardedShare: 0.25, // of the remaining lots: shop rows shut on the ground floor
  squatShare: 0.15, // tenements with one bay fallen in, a tarp over it
  fenceInset: 0.3, // a vacant lot's chain-link stands this far inside the sidewalk line
  fenceHole: 9, // the torn gap in it on a street side, wide enough for any car
  weeds: [4, 9] as [number, number], // weed patches per vacant lot
  maxTags: 260, // graffiti decals in the district, at most
  maxWrecks: 40, // wrecked cars, at most
  maxGlow: 90, // at night: the few working lamps, lit windows, the corner store's sign, burn barrels and camp fires
  rubbleGrip: 0.8, // tyre grip multiplier on rubble lots
  rubbleDrag: 1.5, // extra rolling drag there, m/s²
  potholeKick: 0.35, // vertical kick when a wheel crosses a pothole, m/s of the car's speed per 10 m/s
  trainChance: 0.5, // a freight train crosses the overpass now and then (per seed)
};

/** The Slums' set pieces (world/districts/SlumsSet.ts). */
export const SLUMS_SET = {
  floor: 3, // a storey, metres
  wall: 0.45, // a wall stub's thickness
  stubFloors: [2, 4] as [number, number], // the tallest stub's storeys
  spill: 1.6, // the rubble mound runs this far out over the sidewalk (kerb side kept clear)
  bricks: [3, 6] as [number, number], // loose `rubble` piles on the sidewalk past the mound
  overpassSetIn: [3, 6, 9, 13], // the overpass in from the wall line (further in if a pier would touch a junction control)
  overpassDepth: 5, // the deck along the street
  pier: 0.42, // a pier column's footprint, half side
  overpassHeadroom: 0.6, // the deck's underside above overheadClearance
  junkCorridor: 7, // between wreck rows, street to street
  junkCross: 7, // across the rows, through the middle
  junkRows: [2, 3] as [number, number],
  junkHigh: [1, 3] as [number, number], // wrecks per stack
  junkFence: 2.6, // corrugated sheet height
  tyreMountains: [1, 3] as [number, number],
  campGap: 1, // the camp stands this far inside its lot all round
  campDensity: 0.65, // share of the camp's grid cells with a shelter
};

/** The Slums' streets: clutter, wrecks, graffiti, wires and laundry, road wear (world/districts/SlumsStreet.ts), metres. */
export const SLUMS_STREET = {
  wreckOnKerb: 0.7, // how far a kerb wreck stands up on the kerb (less into the lane than a parked van)
  kerbWrecks: [6, 14] as [number, number],
  lotWrecks: [1, 3] as [number, number], // per rubble lot
  dumpsterChance: 0.4, // per street end and side, at the alley mouths
  tornFence: 0.3, // share of a rubble lot's chain-link panels torn
  payphones: [1, 2] as [number, number], // outside the corner store
  heavenSpot: 0.18, // share of walk-ups with a tag up by the roof
  poleSpacing: 24,
  wireSag: 0.9,
  laundryLines: [2, 6] as [number, number],
  potholesPer100m2: 0.5, // on the district's roads
  wearPer100m2: 1.2, // oil stains, puddles, cracks
  fadedMarks: 0.45, // share of lane markings worn away in a patch
  litterPer10m: 1.4, // along each sidewalk
  gutterStrip: [0.45, 0.9] as [number, number], // slush (snow) or blown sand (desert) along the kerbs, width
  driftChance: 0.5, // desert: sand banked against a building front, per street face
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

/** The Mega-park: one grand park over a rectangle of blocks (world/districts/Megapark.ts), metres where not said. */
export const MEGAPARK = {
  chance: 0.3,
  speed: 30 / 3.6, // m/s cap on the park drives
  density: 0.5,
  copSpawnSkip: 0.5,
  lawnGrip: 0.85, // tyre grip multiplier on the lawns
  lawnDrag: 1, // extra rolling drag there, m/s²
  sports: [1, 2] as [number, number], // sports blocks (a 2×2 has room for one)
  trackChance: 0.4, // one sports block is a running track
  fountainChance: 0.6, // a fountain jet in the lake
  maxGlow: 130, // at night: the drives' and paths' lamps, the gate lanterns, the bandstand's bulbs, fireflies (a 3×3's drives alone have 72 lamps)
  bandstandBulbs: 16, // a string of bulbs round the bandstand's eaves
  fireflies: 30, // over the lawns on a warm night, at most (within maxGlow)
  /** The lots: footprint (long, short) and height. */
  cafe: { size: [15, 9] as [number, number], h: 4.6 },
  lodge: { size: [8, 7] as [number, number], h: 6.5 },
  boathouse: { size: [11, 7] as [number, number], h: 5 },
  lotInset: 1, // in from the sidewalk line
  lakeRadius: [19, 21] as [number, number], // the lake's long half-axis (shrunk to fit its block: ~20 m)
  lakeDepth: 0.4,
  lakeBank: 2.5, // dry bank kept round the lake inside the block (and before the boathouse)
  island: 3.6, // the island's radius (solid)
  bridgeWidth: 2.6,
  jetty: [2.6, 7] as [number, number], // width, length out from the boathouse
  jettyHeight: 0.65, // the deck over the ground
  rowboats: 2,
  pitchRunOff: 3.5, // as PARKS
  court: [30, 15] as [number, number], // a tennis court inside its chain-link, along and across
  trackStraight: 14, // the running track's straights
  trackOuter: 17.5, // its outer radius at the bends
  trackWidth: 5,
  bleachers: [16, 4] as [number, number],
  playground: [30, 24] as [number, number], // the fenced playground
  bandstand: 5, // radius
  deckChairs: [6, 10] as [number, number],
  pathWidth: 2.6,
  lawnTrees: [7, 12] as [number, number], // per lawn block
  avenueStep: 13, // avenue trees along the drives, this far apart
  avenueIn: 2.4, // in from the kerb
  pathLampStep: 16,
  beds: [2, 4] as [number, number], // flower beds per lawn block
  picnicTables: [2, 4] as [number, number],
};

/** The Swamp: low wet ground on the island's edge, causeway streets between pools (world/districts/Swamp.ts). */
export const SWAMP = {
  chance: 0.3,
  swampChance: 0.6, // the wooded swamp; otherwise the open reed marsh
  maxRise: 3, // metres the hill may vary under it, at most (low, flat ground)
  density: 0.4,
  copSpawnSkip: 0.4,
  pickupWeight: 3,
  mudGrip: 0.8, // tyre grip multiplier on the banks
  mudDrag: 1.5, // extra rolling drag there, m/s²
  maxGlow: 60, // at night: one lamp a junction, the witch house's windows and cauldron, the wisps
  poolDepth: 0.35, // the water's surface over the ground
  bank: 2, // dry bank kept inside the sidewalk line
  poolGap: 2, // dry ground between two pools
  /** Share of an ordinary block under water: swamp, marsh. */
  cover: { swamp: [0.4, 0.6], marsh: [0.55, 0.7] } as Record<'swamp' | 'marsh', [number, number]>,
  bigPool: [14, 26] as [number, number], // the first pool's long half-axis, metres (sized from the share, shrunk to fit)
  smallPool: [5, 11] as [number, number], // the others'
  witchPool: [21, 24] as [number, number], // the witch house's pool (shrunk to fit its block)
  witchIsland: 8.5, // the dry island in its middle, radius
  /** The witch house: width, depth (without the porch), the porch's depth, stilts' height, wall height; set back from the island's middle. */
  house: { w: 7.5, d: 6.5, porch: 2, stilts: 1.2, h: 6.4, back: 1.5 },
  deck: { width: 4, top: 0.6 }, // a boardwalk: ≥ widest body + 1 m; its surface over the ground (the water stands 0.35)
  deckRamps: [3.5, 3] as [number, number], // street end, island end
  pumpkins: [6, 10] as [number, number],
  wispChance: 0.75, // will-o'-the-wisps over the water at night
  wisps: 18,
  boardwalks: [1, 2] as [number, number], // boardwalks across pool blocks, street to street (as many as fit)
  boardwalkRamps: [3.5, 3.5] as [number, number],
  railGaps: 0.15, // share of a boardwalk's rail sections missing
  shacks: [1, 2] as [number, number], // stilt shacks per pool block
  shack: { long: [6.5, 8.5] as [number, number], short: [5, 6] as [number, number], h: [4, 5] as [number, number] },
  baitShop: { size: [10, 7] as [number, number], h: 5 },
  lotInset: 1, // in from the sidewalk line
  jetty: [2.4, 8] as [number, number], // width, length out from the bait shop's back
  jettyHeight: 0.65,
  airboatChance: 0.7,
  guardRailStep: [3.2, 6] as [number, number], // kerb guard rail sections, this far apart
  signs: 2, // "Mind the bog" signs inside the gates, at most
  /** Per block: trees (cypress in the swamp, willows in the marsh), snags, reed clumps per pool, lily pads per pool. */
  woods: {
    swamp: { trees: [6, 10], snags: [2, 4], reeds: [1, 3], pads: 8 },
    marsh: { trees: [1, 3], snags: [0, 2], reeds: [4, 7], pads: 12 }, // reed clumps of two: the model is 240 tris
  } as Record<'swamp' | 'marsh', { trees: [number, number]; snags: [number, number]; reeds: [number, number]; pads: number }>,
  logChance: 0.5, // a half-sunk log in a block's first pool
};

/** The Forest: dense woods on the island's edge, dirt tracks through them (world/districts/Forest.ts). */
export const FOREST = {
  chance: 0.3,
  density: 0.5,
  copSpawnSkip: 0.5,
  pickupWeight: 3,
  floorGrip: 0.85, // tyre grip multiplier on the forest floor (the tracks included)
  floorDrag: 1, // extra rolling drag there, m/s²
  maxGlow: 70, // at night: the lumber yard's lights, the campfire, the gate's lanterns (no street lamps inside)
  /** Trees: each claims a disc of this radius (two stand at least the sum apart: 3.4–6 m). */
  spacing: [1.7, 3] as [number, number],
  pineShare: 0.55, // of the trees in temperate woods (the rest round)
  edge: 1, // trees keep this far inside the sidewalk line
  trackChance: 0.85, // a woods block with a track through it
  track: 4.6, // a track's width: ≥ widest off-road body + 1 m, with a little to spare
  trackClear: 1.4, // trunks keep this far off a track's edge
  trackLead: 4, // each end runs straight in from the sidewalk line this far
  trackWobble: 9, // how far a track's middle swings off the straight line, metres (at most)
  bendShare: 0.35, // tracks that leave by a side street (a bend) rather than straight across
  clearing: [12.5, 14.5] as [number, number], // a special block's clearing, radius
  lumberyardChance: 0.75, // the lumber yard by the main gate
  lookoutChance: 0.6, // the fire lookout tower in a clearing
  campsiteChance: 0.6,
  lotInset: 1, // lots stand this far in from the sidewalk line
  sawmill: { size: [24, 12] as [number, number], h: 7 }, // long side along the yard's back
  ranger: { size: [10, 7] as [number, number], h: 4.5 }, // the ranger station by the main gate
  /** The lumber yard, out from its street (the main gate's): an open apron, rows of log stacks with corridors between, an aisle up the middle. */
  yard: { apron: 9, row: 2.8, corridor: 5, aisle: 6, stack: 7, stackGap: 0.5, rows: 3, stackH: [1.8, 2.6] as [number, number], lamps: 4 },
  lookout: { cabin: 14, legs: 2.2, leg: 0.3 }, // cabin floor height; legs ± this from the middle at the foot
  camp: { tents: [3, 5] as [number, number], pit: 0.9, pitOut: 3.4, ring: 3.6, tables: 2 },
  post: 0.3, // a timber gate post's footprint, half side
};

/** Shallow water on land (park ponds, lakes, swamp pools): wading, never drowning. */
export const WATER = {
  grip: 0.7, // tyre grip multiplier in the water
  drag: 2, // extra rolling drag in the water, m/s²…
  // …plus this per m/s (1/s): flat out through 15 m of pond, 70 km/h comes out near 48 and 100 near 68;
  // wading tops out near 19 km/h, so a stopped car still drives out (SoftGround.test).
  dragPerSpeed: 0.9,
  iceGrip: 0.35, // frozen (snow climate): grip multiplier, no drag
  shoreRamp: 1.5, // metres over which the surface rises from the rim to its full depth
  navPenalty: 100, // NavGrid step cost added in the water (road 10, off-road 15): cops go round
  sprayPerSecond: 40, // spray puffs per rear wheel wading at speed
};

/** Park pieces (`world/ParkPieces.ts`): a fish pond or a soccer pitch in a park with no centrepiece. */
export const PARKS = {
  salt: 0x9a4c5, // their own stream: nothing that rolled before moves
  pondChance: 0.12, // per park without a centrepiece (0.3 gave ~3 in 4 cities a pond: too many)
  pitchChance: 0.25,
  fenceInset: 3.3, // the park's picket fence, in from the block edge (StreetProps' FENCE_INSET)
  pondRadius: [7, 11] as [number, number], // the long half-axis, metres
  pondDepth: 0.35, // surface over the ground
  pondOffset: 4, // the pond's centre may sit this far off the park's
  bankRoom: 4, // metres kept round the water inside the fence (benches, the boat)
  stoneRimChance: 0.5, // else a grass bank with more reeds
  benchOut: 2.4, // benches this far up the bank from the edge
  boatOut: 1.6, // the rowboat pulled up on the bank
  boatRadius: 1.4, // its solid footprint
  signOut: 3.2,
  pads: 10, // lily pads, at most
  treeClear: 4.5, // trees and loose benches this close to the water go (clear of the sign and the boat)
  pitchLength: 40, // a 7-a-side pitch, touchline to touchline: metres
  pitchWidth: 25,
  pitchRunOff: 3.5, // its footprint past the lines (goals, fences, floodlights): cleared of trees
  fenceBehind: 2.6, // chain-link this far behind each goal line
  fencePanel: 3, // one panel and its gap (a panel is 2.9 m)
  lampOut: 1.6, // floodlights off each corner, both ways
  benchBack: 2.2, // the dugout benches behind a touchline
  dugout: 5, // either side of the halfway line
};
