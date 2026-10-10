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
