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
  minRouteDistance: 400,
  maxRouteDistance: 800,
  reachRadius: 9,
};

/** Seconds left at which the timer turns red. */
export const TIMER_WARNING = 60;
