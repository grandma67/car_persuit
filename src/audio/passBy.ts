// Spots a car flashing past the player close and fast, for the "whoosh". The swish you hear is the
// other car's bow wave and wake buffeting yours plus its tyre and wind roar sweeping by (pitch
// dropping as it goes, like a Doppler shift). Tyre roar dominates from ~40 km/h and wind noise
// joins in from ~55 km/h, so only a relative speed above that and a near miss make one. Pure
// logic, fed positions and velocities, so it is unit-tested.

const MIN_SPEED = 14; // m/s closing speed (~50 km/h) before anything swishes
const FULL_SPEED = 40; // m/s at which it is as loud as it gets
const NEAR = 2.2; // metres between centres: closer than this is a crash, not a near miss
const FAR = 6; // metres between centres at closest approach: wider passes are quiet
const LEAD = 0.12; // seconds before the closest point that the sound starts, so its peak lines up

export interface Whoosh {
  strength: number; // 0..1
  pan: number; // -1 left .. 1 right (where the other car passes)
  heavy: number; // 0..1, a bus or truck: more low buffeting
  speed: number; // m/s closing speed (both cars' speeds added head-on): shapes the sweep
}

export class PassBy {
  private armed = new WeakMap<object, boolean>();

  /**
   * One other car, relative to the player: `rx/rz` its offset, `ux/uz` its velocity minus the
   * player's, `rightX/rightZ` the player's right. Returns a whoosh the moment it is due, once per pass.
   */
  check(car: object, rx: number, rz: number, ux: number, uz: number, rightX: number, rightZ: number, mass: number): Whoosh | null {
    const speed2 = ux * ux + uz * uz;
    const tca = -(rx * ux + rz * uz) / Math.max(speed2, 1e-6); // seconds to closest approach
    if (tca <= 0) {
      this.armed.delete(car); // going away: the next approach can swish again
      return null;
    }
    if (this.armed.get(car) || tca > LEAD) return null;
    this.armed.set(car, true);
    const speed = Math.sqrt(speed2);
    const miss = Math.hypot(rx + ux * tca, rz + uz * tca);
    if (speed < MIN_SPEED || miss < NEAR || miss > FAR) return null;
    const fast = Math.min(1, (speed - MIN_SPEED) / (FULL_SPEED - MIN_SPEED));
    const close = 1 - (miss - NEAR) / (FAR - NEAR);
    const side = (rx + ux * tca) * rightX + (rz + uz * tca) * rightZ;
    return {
      strength: (0.3 + 0.7 * fast) * close * close,
      pan: Math.max(-1, Math.min(1, side / 2.5)),
      heavy: Math.max(0, Math.min(1, (mass - 1500) / 3500)),
      speed,
    };
  }
}
