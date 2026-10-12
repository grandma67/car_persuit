// The player's simulated gearbox, shared by the engine sound and the car's shift kick.

/** Upper speed (m/s) of each gear; rpm sweeps within the band, dropping on each upshift. */
export const GEAR_TOP_SPEEDS = [9, 17, 25, 33, 39, 46];

/** Gear (0-based) for a speed in m/s. */
export function gearFor(speed: number): number {
  const gear = GEAR_TOP_SPEEDS.findIndex((top) => Math.abs(speed) < top);
  return gear < 0 ? GEAR_TOP_SPEEDS.length - 1 : gear;
}
