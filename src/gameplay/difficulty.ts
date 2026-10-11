// Difficulty presets. Multipliers apply on top of the base tuning in balance.ts.

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  timeLimit: number; // seconds
  maxHealth: number; // player car health
  checkpointRepair: number; // share of max health restored on reaching a destination
  damageScale: number; // crash damage multiplier
  armor: number; // impacts (m/s of velocity change) up to this do no damage
  heatRate: number; // wanted-clock speed multiplier
  copCap: number; // max-cops multiplier
  traffic: number; // civilian cars on the road around the player
}

export const DIFFICULTIES: Difficulty[] = [
  // Easy: a tougher car — 60% more health than Normal, armor that shrugs off scrapes and light
  // rams, half damage. Each destination reached patches the car up, less so on harder settings.
  { id: 'easy', label: 'Easy', timeLimit: 720, maxHealth: 240, checkpointRepair: 0.25, damageScale: 0.5, armor: 8, heatRate: 0.8, copCap: 0.75, traffic: 16 },
  { id: 'normal', label: 'Normal', timeLimit: 600, maxHealth: 150, checkpointRepair: 0.15, damageScale: 1, armor: 5, heatRate: 1, copCap: 1, traffic: 24 },
  { id: 'hard', label: 'Hard', timeLimit: 480, maxHealth: 150, checkpointRepair: 0.08, damageScale: 1.3, armor: 5, heatRate: 1.25, copCap: 1.25, traffic: 34 },
];

export function difficultyById(id: string | null | undefined): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

/** Cops allowed at a star level for this difficulty (always at least one). */
export function scaledCopCap(baseCap: number, d: Difficulty): number {
  return Math.max(1, Math.round(baseCap * d.copCap));
}
