import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Health } from '../gameplay/Health';
import type { PropBreak } from '../world/PropSystem';
import { SkidMarks } from './SkidMarks';
import { TireSmoke } from './TireSmoke';

const FRONT_WHEELS = [0, 1];
const REAR_WHEELS = [2, 3];
const SMOKE_PER_SECOND = 55; // per rear wheel at full skid
const ENGINE_SMOKE_PER_SECOND = 30;
const FIRE_PER_SECOND = 40;
// Exhaust: the engine's effort shows in the fumes, from every tailpipe the car's mesh has (rates
// are per pipe). Grey-black puffs at idle, pulsing with the firing; more, faster and denser under
// load (throttle at low speed, the engine working hardest); and a black cloud of soot when it's
// kicked: each gear biting under throttle, and the throttle snapped open (the rich mixture
// before the revs catch up).
const EXHAUST_IDLE = 9; // wisps per second, per pipe
const EXHAUST_LOAD = 34; // more at full load, per pipe
const EXHAUST_PULSE_HZ = 2.2; // idle chug
const EXHAUST_EXIT = [0.8, 3.5]; // m/s backward out of the pipe, idle → full throttle
const EXHAUST_CARRY = 0.7; // share of the car's speed the fumes keep at first (its wake), then drag slows them
const SOOT_SHIFT = 5; // black puffs per pipe as a gear bites
const SOOT_SNAP = 4; // black puffs per pipe as the throttle snaps open
const SOOT_LUGGING = 7; // per pipe per second at full throttle crawling away (lugging, rich)
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
  // Exhaust: grey-black puffs, and black soot clouds when the engine is kicked (see EXHAUST_*).
  // They ride the car's wake for a moment (carry) instead of dropping straight back into the chase
  // camera, and only fade right at the lens: the camera sits ~5 m from the pipe, inside the
  // default fade-in range that keeps tyre smoke out of your eyes.
  private exhaust = new TireSmoke({
    color: 0x4a4c50, maxAlpha: 0.6, additive: false, startSize: 0.3, growth: 1.6, lift: [0.2, 0.5], spread: 0.4, life: [0.7, 1.2], jitter: 0.06,
    carry: EXHAUST_CARRY, nearFade: [0.8, 2.2],
  });
  private soot = new TireSmoke({
    color: 0x0e0f11, maxAlpha: 0.85, additive: false, startSize: 0.4, growth: 2.4, lift: [0.25, 0.6], spread: 0.5, life: [0.8, 1.4], jitter: 0.08,
    carry: EXHAUST_CARRY, nearFade: [0.8, 2.2],
  });
  private exhaustBudget = 0;
  private sootBudget = 0;
  private exhaustTime = 0;
  private nextPipe = 0; // round-robin across the tailpipes, carried between frames
  private lastThrottle = 0;
  private flash = new THREE.PointLight(0xff9a40, 0, 60, 1.5);
  private geysers: { position: THREE.Vector3; timeLeft: number; budget: number }[] = [];
  private smokeBudget = 0;
  private engineSmokeBudget = 0;
  private fireBudget = 0;
  private tmpContact = new THREE.Vector3();
  private tmpVel = new THREE.Vector3();
  private exhaustAt = new THREE.Vector3();

  constructor(scene: THREE.Scene, sprayColor: number) {
    this.smoke.setColor(sprayColor);
    scene.add(this.skidMarks.mesh, this.smoke.points);
    scene.add(this.exhaust.points, this.soot.points, this.engineSmoke.points, this.fire.points, this.water.points, this.fireball.points, this.flash);
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

  /** A car plunging into the water at `at` (on the surface), moving at `velocity`. */
  splash(at: THREE.Vector3, velocity: THREE.Vector3): void {
    for (let i = 0; i < 90; i++) {
      // Flung outward in a ring, carried on a little in the car's direction.
      const a = Math.random() * Math.PI * 2;
      const out = 15 + Math.random() * 25; // emit() keeps 15% of this as sideways speed
      this.tmpVel.set(Math.cos(a) * out + velocity.x * 0.8, 0, Math.sin(a) * out + velocity.z * 0.8);
      this.water.emit(at, this.tmpVel, 0);
    }
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
    // Fronts leave their own marks when they scrub or the brakes bite (no smoke: the rears carry that).
    const frontSkid = player.frontSkid;
    for (const w of FRONT_WHEELS) {
      const contact = frontSkid > 0.25 ? player.wheelContact(w, this.tmpContact) : null;
      this.skidMarks.add(w, contact, frontSkid);
    }
    this.smoke.update(dt);
    this.updateExhaust(dt, player);

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

  /**
   * Fumes from each of the car's tailpipes in turn, following the engine's effort: puffs that
   * thicken and blow out faster with load, and soot puffs on its kicks (gear biting, throttle
   * snapped open, lugging).
   */
  private updateExhaust(dt: number, player: Vehicle): void {
    const shifted = player.consumeShift();
    const throttle = player.lastInput.throttle;
    const snapped = throttle > 0.6 && this.lastThrottle < 0.1;
    this.lastThrottle = throttle;
    this.exhaustTime += dt;
    if (!player.lightsOff) {
      const speed = Math.abs(player.speed);
      const load = throttle * (1 - Math.min(1, speed / player.spec.maxSpeed) * 0.6);
      const chug = 0.6 + 0.4 * Math.sin(this.exhaustTime * EXHAUST_PULSE_HZ * Math.PI * 2);
      const { body, exhausts } = player.mesh;
      const pipes = exhausts.length;
      this.exhaustBudget += (EXHAUST_IDLE * chug + EXHAUST_LOAD * load) * pipes * dt;
      const lugging = throttle > 0.8 && speed < 8 ? SOOT_LUGGING * throttle * dt : 0;
      this.sootBudget += (lugging + (shifted ? SOOT_SHIFT * throttle : 0) + (snapped ? SOOT_SNAP : 0)) * pipes;
      const wisps = Math.floor(this.exhaustBudget);
      const puffs = Math.floor(this.sootBudget);
      this.exhaustBudget -= wisps;
      this.sootBudget -= puffs;
      if (wisps + puffs > 0) {
        body.updateWorldMatrix(true, false);
        // Blown out backwards, harder the more throttle, then left hanging in the air.
        const exit = EXHAUST_EXIT[0] + (EXHAUST_EXIT[1] - EXHAUST_EXIT[0]) * throttle;
        const back = player.forward(this.tmpContact).multiplyScalar(-exit);
        const v = player.body.linvel();
        // emit() keeps EXHAUST_CARRY of this: the car's speed (its wake) plus the exit speed.
        this.tmpVel.set(v.x + back.x / EXHAUST_CARRY, 0, v.z + back.z / EXHAUST_CARRY);
        const emit = (smoke: TireSmoke, count: number) => {
          for (let i = 0; i < count; i++) {
            const tip = this.exhaustAt.copy(exhausts[this.nextPipe++ % pipes]);
            smoke.emit(body.localToWorld(tip).setY(tip.y - 0.15), this.tmpVel, 0);
          }
        };
        emit(this.exhaust, wisps);
        emit(this.soot, puffs);
      }
    }
    this.exhaust.update(dt);
    this.soot.update(dt);
  }

  resize(viewportHeight: number, fov: number): void {
    for (const p of [this.exhaust, this.soot, this.smoke, this.engineSmoke, this.fire, this.water, this.fireball]) p.resize(viewportHeight, fov);
  }
}
