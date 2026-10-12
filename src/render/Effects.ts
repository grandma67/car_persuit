import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Health } from '../gameplay/Health';
import type { PropBreak } from '../world/PropSystem';
import { SkidMarks } from './SkidMarks';
import { TireSmoke } from './TireSmoke';

const REAR_WHEELS = [2, 3];
const SMOKE_PER_SECOND = 55; // per rear wheel at full skid
const ENGINE_SMOKE_PER_SECOND = 30;
const FIRE_PER_SECOND = 40;
const GEYSER_SECONDS = 6;
const GEYSER_PER_SECOND = 70;

/** How big a car explosion is: particle counts per emitter and the flash's peak intensity. */
export interface Blast {
  fireball: number;
  smoke: number;
  fire: number;
  flash: number;
}

// Particles and marks: tyre smoke and skid marks, engine smoke and fire, explosions, sparks
// and hydrant geysers. Owns its emitters; the game just reports what happened.
export class Effects {
  private skidMarks = new SkidMarks();
  private smoke = new TireSmoke();
  private engineSmoke = new TireSmoke({ color: 0x2b2b30, maxAlpha: 0.55, additive: false, growth: 3 });
  private fire = new TireSmoke({ color: 0xff6a1a, maxAlpha: 0.7, additive: true, growth: 0.6 });
  private water = new TireSmoke({
    color: 0xd6ecff, maxAlpha: 0.55, additive: false, growth: 0.9, lift: [7, 11], gravity: 9.8, spread: 1.6, life: [1.2, 1.8],
  });
  private fireball = new TireSmoke({
    color: 0xff8a2a, maxAlpha: 0.9, additive: true, growth: 5, lift: [1, 7], spread: 12, life: [0.5, 1.1],
  });
  private flash = new THREE.PointLight(0xff9a40, 0, 60, 1.5);
  private geysers: { position: THREE.Vector3; timeLeft: number; budget: number }[] = [];
  private smokeBudget = 0;
  private engineSmokeBudget = 0;
  private fireBudget = 0;
  private tmpContact = new THREE.Vector3();
  private tmpVel = new THREE.Vector3();

  constructor(scene: THREE.Scene, sprayColor: number) {
    this.smoke.setColor(sprayColor);
    scene.add(this.skidMarks.mesh, this.smoke.points);
    scene.add(this.engineSmoke.points, this.fire.points, this.water.points, this.fireball.points, this.flash);
  }

  /** A car blowing up at `at`: fireball, smoke, flames and a flash of light above it. */
  explode(at: THREE.Vector3, blast: Blast): void {
    this.tmpVel.set(0, 0, 0);
    for (let i = 0; i < blast.fireball; i++) this.fireball.emit(at, this.tmpVel, 0);
    for (let i = 0; i < blast.smoke; i++) this.engineSmoke.emit(at, this.tmpVel, 1);
    for (let i = 0; i < blast.fire; i++) this.fire.emit(at, this.tmpVel, 1);
    this.flash.position.copy(at).setY(at.y + 2);
    this.flash.intensity = blast.flash;
  }

  /** Lamps and signals spark; hydrants start a geyser. */
  propBreak(b: PropBreak): void {
    if (b.kind === 'lamp' || b.kind === 'signal') {
      for (let i = 0; i < 14; i++) this.fire.emit(b.position, this.tmpVel.set(0, 0, 0), 0);
    } else if (b.kind === 'hydrant') {
      this.geysers.push({ position: b.position.clone().setY(b.position.y - 0.2), timeLeft: GEYSER_SECONDS, budget: 0 });
    }
  }

  update(dt: number, player: Vehicle, health: Health): void {
    const skid = player.skid;

    // Skid marks + smoke from rear wheels while sliding.
    const v = player.body.linvel();
    this.tmpVel.set(v.x, v.y, v.z);
    // Scaled by speed so a car that has slowed down stops piling smoke on itself.
    const speedFactor = THREE.MathUtils.clamp(Math.abs(player.speed) / 15, 0, 1);
    this.smokeBudget += skid > 0.15 ? SMOKE_PER_SECOND * skid * speedFactor * dt : 0;
    const puffs = Math.floor(this.smokeBudget);
    this.smokeBudget -= puffs;
    for (const w of REAR_WHEELS) {
      const contact = player.wheelContact(w, this.tmpContact);
      this.skidMarks.add(w, skid > 0.25 ? contact : null, skid);
      if (contact) for (let i = 0; i < puffs; i++) this.smoke.emit(contact, this.tmpVel, skid);
    }
    this.smoke.update(dt);

    // Damage: engine smoke below half health, fire when critical (and while wrecked).
    if (health.smoking) {
      const root = player.mesh.root.position;
      const at = player.forward(this.tmpContact).multiplyScalar(1.5).add(root).setY(root.y + 0.5);
      this.engineSmokeBudget += ENGINE_SMOKE_PER_SECOND * (1 - health.ratio / 0.5 + 0.3) * dt;
      while (this.engineSmokeBudget >= 1) {
        this.engineSmoke.emit(at, this.tmpVel, 0.5);
        this.engineSmokeBudget--;
      }
      if (health.burning) {
        this.fireBudget += FIRE_PER_SECOND * dt;
        while (this.fireBudget >= 1) {
          this.fire.emit(at, this.tmpVel, 0);
          this.fireBudget--;
        }
      }
    }
    this.engineSmoke.update(dt);
    this.fire.update(dt);
    this.fireball.update(dt);
    this.flash.intensity *= Math.exp(-6 * dt);

    // Broken hydrants spout water, tapering off.
    for (const g of this.geysers) {
      g.timeLeft -= dt;
      g.budget += GEYSER_PER_SECOND * Math.min(1, g.timeLeft / 2) * dt;
      while (g.budget >= 1) {
        this.water.emit(g.position, this.tmpVel.set(0, 0, 0), 0);
        g.budget--;
      }
    }
    this.geysers = this.geysers.filter((g) => g.timeLeft > 0);
    this.water.update(dt);
  }

  resize(viewportHeight: number, fov: number): void {
    for (const p of [this.smoke, this.engineSmoke, this.fire, this.water, this.fireball]) p.resize(viewportHeight, fov);
  }
}
