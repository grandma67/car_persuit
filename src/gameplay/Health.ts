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

  /** Apply a collision (velocity change in m/s). Returns the damage dealt. */
  applyImpact(impact: number): number {
    if (this.destroyed) return 0;
    const damage = Math.max(0, impact - this.cfg.impactThreshold) * this.cfg.impactScale;
    this.value = Math.max(0, this.value - damage);
    return damage;
  }
}
