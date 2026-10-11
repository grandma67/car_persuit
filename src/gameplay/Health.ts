// Vehicle health. Pure logic; cops will use the same class in M5.
import { DAMAGE, type DamageConfig } from './balance';

export class Health {
  value: number;

  constructor(private cfg: DamageConfig = DAMAGE) {
    this.value = cfg.maxHealth;
  }

  get ratio(): number {
    return this.value / this.cfg.maxHealth;
  }

  get destroyed(): boolean {
    return this.value <= 0;
  }

  get smoking(): boolean {
    return this.ratio < this.cfg.smokeBelow;
  }

  get burning(): boolean {
    return this.ratio < this.cfg.fireBelow;
  }

  /** Take a fixed amount of damage (no threshold). Returns the damage dealt. */
  applyDamage(amount: number): number {
    if (this.destroyed || amount <= 0) return 0;
    const damage = Math.min(this.value, amount);
    this.value -= damage;
    return damage;
  }

  /** Restore a share (0..1) of max health, up to full. A wreck stays wrecked. Returns the health restored. */
  repair(share: number): number {
    if (this.destroyed) return 0;
    const restored = Math.min(this.cfg.maxHealth - this.value, share * this.cfg.maxHealth);
    this.value += restored;
    return restored;
  }

  /** Apply a collision (velocity change in m/s). Returns the damage dealt. */
  applyImpact(impact: number): number {
    if (this.destroyed) return 0;
    const damage = Math.max(0, impact - this.cfg.impactThreshold) * this.cfg.impactScale;
    this.value = Math.max(0, this.value - damage);
    return damage;
  }
}
