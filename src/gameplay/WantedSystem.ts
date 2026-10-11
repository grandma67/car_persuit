// Wanted level: stars rise with time spent on the run plus "heat" from trouble you cause.
// Pure logic — unit-tested.
import { CHECKPOINT_HEAT_RATE, HEAT, WANTED, type StarLevel } from './balance';

export class WantedSystem {
  private elapsed = 0;
  private heat = 0;
  /** Wanted time passes this many times faster than real time. */
  rate = 1;

  constructor(private levels: StarLevel[] = WANTED) {}

  /** 1..5 */
  get stars(): number {
    const t = this.elapsed + this.heat;
    let stars = 0;
    for (const level of this.levels) if (t >= level.at) stars++;
    return Math.max(1, stars);
  }

  get level(): StarLevel {
    return this.levels[this.stars - 1];
  }

  /** 0..1 progress toward the next star (1 at max). */
  get progress(): number {
    const s = this.stars;
    if (s >= this.levels.length) return 1;
    const t = this.elapsed + this.heat;
    const from = this.levels[s - 1].at;
    const to = this.levels[s].at;
    return (t - from) / (to - from);
  }

  /** Advance time; returns the new star count if it went up, else null. */
  update(dt: number): number | null {
    const before = this.stars;
    this.elapsed += dt * this.rate;
    return this.stars > before ? this.stars : null;
  }

  /** Add heat (seconds). Returns the new star count if it went up, else null. */
  addHeat(seconds: number): number | null {
    const before = this.stars;
    this.heat += seconds;
    return this.stars > before ? this.stars : null;
  }

  /** A destination was reached: the heat builds faster from now on. */
  checkpoint(): void {
    this.rate *= CHECKPOINT_HEAT_RATE;
  }

  civilianHit(): number | null {
    return this.addHeat(HEAT.civilianHit);
  }

  copWrecked(): number | null {
    return this.addHeat(HEAT.copWrecked);
  }

  /** The player rammed a cop at `speed` m/s: harder hits draw more heat. */
  copWhacked(speed: number): number | null {
    return this.addHeat(Math.min(HEAT.copWhackedMax, HEAT.copWhacked + HEAT.copWhackedPerMs * speed));
  }

  propSmashed(): number | null {
    return this.addHeat(HEAT.propSmashed);
  }

  /** Debug: jump straight to the next star. */
  bump(): number | null {
    const s = this.stars;
    if (s >= this.levels.length) return null;
    return this.addHeat(this.levels[s].at - (this.elapsed + this.heat) + 0.01);
  }
}
