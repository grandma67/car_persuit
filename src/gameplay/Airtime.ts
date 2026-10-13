// Spots the player's car leaving the ground and coming back down, for the run trace. Pure logic —
// fed whether any wheel touches — so it is unit-tested.

/** Shorter hops than this (a kerb, a bump, a bounce on landing) aren't a jump. */
const MIN_AIRTIME = 0.3; // seconds

export interface Takeoff {
  type: 'takeoff';
  t: number; // when the wheels left the ground (seconds into the run)
  x: number; // where they left it
  z: number;
  speed: number; // m/s, at the lip
}

export interface Landing {
  type: 'landing';
  t: number;
  x: number;
  z: number;
  airtime: number; // seconds off the ground
  distance: number; // metres flown, along the ground
}

export class Airtime {
  private off: Omit<Takeoff, 'type'> | null = null; // in the air since
  private announced = false; // the takeoff was long enough to report

  /** Call every frame; returns a takeoff once the car has been airborne long enough, and its landing. */
  update(t: number, grounded: boolean, x: number, z: number, speed: number): Takeoff | Landing | null {
    if (!grounded) {
      if (!this.off) this.off = { t, x, z, speed: Math.abs(speed) };
      if (!this.announced && t - this.off.t >= MIN_AIRTIME) {
        this.announced = true;
        return { type: 'takeoff', ...this.off };
      }
      return null;
    }
    const off = this.off;
    const announced = this.announced;
    this.off = null;
    this.announced = false;
    if (!off || !announced) return null;
    return { type: 'landing', t, x, z, airtime: t - off.t, distance: Math.hypot(x - off.x, z - off.z) };
  }

  /** Forget a flight in progress (the car was reset or teleported). */
  cancel(): void {
    this.off = null;
    this.announced = false;
  }
}
