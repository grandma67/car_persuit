// Difficulty presets. Multipliers apply on top of the base tuning in balance.ts.

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  timeLimit: number; // seconds
  damageScale: number; // crash damage multiplier
  heatRate: number; // wanted-clock speed multiplier
  copCap: number; // max-cops multiplier
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', label: 'Easy', timeLimit: 720, damageScale: 0.7, heatRate: 0.8, copCap: 0.75 },
  { id: 'normal', label: 'Normal', timeLimit: 600, damageScale: 1, heatRate: 1, copCap: 1 },
  { id: 'hard', label: 'Hard', timeLimit: 480, damageScale: 1.3, heatRate: 1.25, copCap: 1.25 },
];

export function difficultyById(id: string | null | undefined): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

/** Cops allowed at a star level for this difficulty (always at least one). */
export function scaledCopCap(baseCap: number, d: Difficulty): number {
  return Math.max(1, Math.round(baseCap * d.copCap));
}
