// When a civilian driver leans on the horn: a long blast a moment after being bumped, and short
// beeps when something other than traffic (the player, a cop, a car sideways across the lane)
// stands in its way, getting longer the longer it lasts. Queueing behind traffic never honks.
// Pure logic: the controller feeds it, the game plays what it takes.

export type Honk = 'beep' | 'blast';

const BUMP_REACT = 0.35; // seconds from the knock to the blast
const BLOCK_FIRST = 1.2; // seconds blocked before the first beep
const BLOCK_REPEAT = 3.5; // seconds between honks while still blocked
const MAX_HONKS = 5; // per blockage, then the driver gives up honking
const COOLDOWN = 2; // seconds between any two honks

export class Horn {
  private cooldown = 0;
  private blockedFor = 0;
  private honks = 0; // this blockage
  private bumpIn = -1; // seconds until the bump's blast, -1 none due
  private pending: Honk | null = null;

  /** temper: ~0.75 (impatient) .. 1.25 (calm), scales the waits while blocked. */
  constructor(private temper = 1) {}

  /** Knocked by something: blast back after a moment (unless we just honked). */
  bumped(): void {
    if (this.bumpIn < 0 && this.cooldown <= 0) this.bumpIn = BUMP_REACT;
  }

  /** One step; `blocked`: wanting to go but held up by something that isn't traffic. */
  update(dt: number, blocked: boolean): void {
    this.cooldown -= dt;
    if (this.bumpIn >= 0) {
      this.bumpIn -= dt;
      if (this.bumpIn < 0) this.sound('blast');
    }
    if (!blocked) {
      this.blockedFor = 0;
      this.honks = 0;
      return;
    }
    this.blockedFor += dt;
    const due = (BLOCK_FIRST + this.honks * BLOCK_REPEAT) * this.temper;
    if (this.honks < MAX_HONKS && this.blockedFor >= due && this.cooldown <= 0) {
      this.sound(this.honks >= 2 ? 'blast' : 'beep');
      this.honks++;
    }
  }

  /** The honk due this step, if any (once). */
  take(): Honk | null {
    const honk = this.pending;
    this.pending = null;
    return honk;
  }

  private sound(honk: Honk): void {
    this.pending = honk;
    this.cooldown = COOLDOWN;
  }
}
