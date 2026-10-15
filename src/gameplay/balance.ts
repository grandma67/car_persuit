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
  max: 4, // safety cap on districts per city, in registry order
  clutterMinOffset: 5, // metres from the centre line
  overheadClearance: Math.max(...ALL_SPECS.map(vehicleTop)) + 1.5,
  frontageSea: 50, // metres of sea a coast district's frontage reaches out
  clutterGap: 8, // metres kept clear at junction mouths and gate approaches
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
  crossOffset: 13, // market cross from the well, metres
  stalls: 9, // round the well (fewer where the cross stands)
  stallRing: 16, // metres from the well
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
