// All gameplay tuning numbers in one place. Wanted/cop tuning joins this in M5.

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
 * Cop contact damage to the player, on top of normal crash damage and ignoring armor, so a cop
 * that keeps ramming always wears the car down. Scaled by the cop's mass (per 1350 kg patrol car)
 * and the difficulty's damage multiplier.
 */
export const COP_RAM = {
  /** Health per m/s of closing speed when a cop slams into the player. */
  bangPerMs: 1.5,
  /** Health per second while a cop is touching (pushing, pinning) the player. */
  grindPerSec: 4,
  referenceMass: 1350,
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
  propSmashed: 0.6,
  civilianHit: 2,
};

/** Each destination reached makes the wanted level climb this much faster. */
export const CHECKPOINT_HEAT_RATE = 1.3;

/** Seconds between roadblock attempts at 4+ stars. */
export const ROADBLOCK_INTERVAL = 35;
