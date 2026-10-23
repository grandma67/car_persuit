import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Health } from '../gameplay/Health';
import type { PropBreak } from '../world/PropSystem';
import { SkidMarks } from './SkidMarks';
import { TireSmoke } from './TireSmoke';

const FRONT_WHEELS = [0, 1];
const REAR_WHEELS = [2, 3];
const SMOKE_PER_SECOND = 55; // per rear wheel at full skid
const FIELD_PER_SECOND = 26; // dust puffs or mud clods per rear wheel, driving through a field at speed
const RUT = 0.5; // how dark tyre ruts in a field mark, as a skid's strength
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
  // Old City breakables: wood chips and planks, straw, a cloth puff from stall awnings, pottery shards.
  private chips = new TireSmoke({ color: 0x6b4a2c, maxAlpha: 0.95, additive: false, startSize: 0.28, growth: 0.05, lift: [2.5, 6], gravity: 9.8, spread: 5, life: [0.7, 1.1], carry: 0.4 });
  // Off-road in a field: dust behind the wheels when dry, clods of mud when it rains.
  private dust = new TireSmoke({ color: 0xb89a6a, maxAlpha: 0.4, additive: false, startSize: 0.7, growth: 2.2, lift: [0.4, 1.4], spread: 1.2, life: [0.9, 1.5] });
  private mud = new TireSmoke({ color: 0x3e2e20, maxAlpha: 0.95, additive: false, startSize: 0.14, growth: 0, lift: [1.5, 3.5], gravity: 9.8, spread: 2, life: [0.4, 0.7], carry: 0.3 });
  private fieldBudget = 0;
  private straw = new TireSmoke({ color: 0xdcbc62, maxAlpha: 0.9, additive: false, startSize: 0.3, growth: 0.5, lift: [2, 5], gravity: 4, spread: 4, life: [0.9, 1.5], carry: 0.3 });
  private cloth = new TireSmoke({ color: 0xece4d4, maxAlpha: 0.55, additive: false, startSize: 0.6, growth: 2.2, lift: [0.6, 1.6], spread: 1.5, life: [0.5, 0.9] });
  private shards = new TireSmoke({ color: 0xb8643a, maxAlpha: 0.95, additive: false, startSize: 0.2, growth: 0, lift: [1.5, 4.5], gravity: 9.8, spread: 4, life: [0.6, 0.9], carry: 0.3 });
  // Chinatown breakables: tumbling fruit, a red paper puff, steam from the baskets, mahjong tiles,
  // firecracker sparks.
  private fruit = new TireSmoke({ color: 0xe8742a, maxAlpha: 0.95, additive: false, startSize: 0.22, growth: 0, lift: [2, 5], gravity: 9.8, spread: 4.5, life: [0.7, 1.1], carry: 0.4 });
  private paper = new TireSmoke({ color: 0xd8302a, maxAlpha: 0.8, additive: false, startSize: 0.25, growth: 0.6, lift: [1, 3], gravity: 2, spread: 3, life: [0.8, 1.4], carry: 0.3 });
  private steam = new TireSmoke({ color: 0xf6f6f2, maxAlpha: 0.45, additive: false, startSize: 0.7, growth: 2.5, lift: [1, 2.2], spread: 1.2, life: [0.8, 1.3] });
  private tiles = new TireSmoke({ color: 0xf2ead8, maxAlpha: 0.95, additive: false, startSize: 0.14, growth: 0, lift: [2, 4.5], gravity: 9.8, spread: 4, life: [0.6, 0.9], carry: 0.3 });
  private sparks = new TireSmoke({ color: 0xffc040, maxAlpha: 0.9, additive: true, startSize: 0.18, growth: 0.1, lift: [2, 7], gravity: 6, spread: 6, life: [0.3, 0.7] });
  // Lunar New Year: gold confetti with the red paper (red envelopes), and firework bursts high up.
  private confetti = new TireSmoke({ color: 0xf2c23a, maxAlpha: 0.95, additive: false, startSize: 0.16, growth: 0, lift: [2, 6], gravity: 2.5, spread: 5, life: [1.2, 2], carry: 0.3 });
  private fireworks = [0xff4a3a, 0xffd04a, 0x6ad8ff].map((color) =>
    new TireSmoke({ color, maxAlpha: 1, additive: true, startSize: 0.9, growth: -0.6, lift: [-1, 1], gravity: 2.5, spread: 0, life: [1.1, 1.7], jitter: 0, carry: 1, carryUp: true, nearFade: [0, 0.01] }));
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

  constructor(scene: THREE.Scene, sprayColor: number, private wet = false) {
    this.smoke.setColor(sprayColor);
    scene.add(this.dust.points, this.mud.points);
    scene.add(this.skidMarks.mesh, this.smoke.points);
    scene.add(this.exhaust.points, this.soot.points, this.engineSmoke.points, this.fire.points, this.water.points, this.fireball.points, this.flash);
    scene.add(this.chips.points, this.straw.points, this.cloth.points, this.shards.points);
    scene.add(this.fruit.points, this.paper.points, this.steam.points, this.tiles.points, this.sparks.points, this.confetti.points);
    for (const f of this.fireworks) scene.add(f.points);
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

  /** A puff of steam rising from `at` (a manhole). */
  steamPuff(at: THREE.Vector3): void {
    this.steam.emit(at, this.tmpVel.set(0, 0, 0), 0);
  }

  /** A firework burst at `at`: a sphere of sparks in one of three colours (festival nights in Chinatown). */
  firework(at: THREE.Vector3, colour: number): void {
    const f = this.fireworks[colour % this.fireworks.length];
    const speed = 9 + Math.random() * 4;
    for (let i = 0; i < 80; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      f.emit(at, this.tmpVel.set(Math.cos(a) * r * speed, u * speed, Math.sin(a) * r * speed), 0);
    }
  }

  /** Lamps and signals spark; hydrants start a geyser; wood splinters, straw bursts, pots shatter. */
  propBreak(b: PropBreak): void {
    const burst = (emitter: TireSmoke, n: number) => {
      for (let i = 0; i < n; i++) emitter.emit(b.position, this.tmpVel.set(0, 0, 0), 0);
    };
    switch (b.kind) {
      case 'haybale': case 'roundBale': return burst(this.straw, 45);
      case 'cart': burst(this.straw, 18); return burst(this.chips, 18);
      case 'stall': burst(this.cloth, 10); return burst(this.chips, 22);
      case 'barrels': case 'pillory': case 'signpost': return burst(this.chips, 18);
      case 'pot': case 'amphora': return burst(this.shards, 16);
      case 'rubble': burst(this.steam, 8); return burst(this.chips, 16); // brick dust
      case 'dumpster': burst(this.paper, 40); burst(this.chips, 12); return burst(this.sparks, 10); // the lid flies, trash bursts
      case 'trashBags': burst(this.paper, 36); return burst(this.chips, 6); // litter everywhere
      case 'shoppingCart': case 'brokenLamp': return burst(this.sparks, 8);
      case 'mattress': burst(this.cloth, 8); return burst(this.straw, 14);
      case 'couch': burst(this.cloth, 10); burst(this.straw, 12); return burst(this.chips, 10);
      case 'tyres': return burst(this.steam, 6); // a puff of dust (the tyres scatter and roll)
      case 'burnBarrel': burst(this.fire, 14); return burst(this.sparks, 24); // embers
      case 'payphone': burst(this.shards, 14); return burst(this.sparks, 10);
      case 'wreck': burst(this.shards, 12); burst(this.steam, 10); return burst(this.sparks, 18);
      case 'oilLamp': case 'dragonLamp': return burst(this.fire, 10);
      case 'produceStall': burst(this.fruit, 30); burst(this.cloth, 8); return burst(this.chips, 12);
      case 'lanternStand': return burst(this.paper, 30);
      case 'dimSumCart': burst(this.steam, 14); return burst(this.chips, 10);
      case 'fishCrate': burst(this.water, 20); return burst(this.chips, 8);
      case 'mahjongTable': return burst(this.tiles, 40);
      case 'menuBoard': return burst(this.chips, 10);
      case 'firecrackerCrate': burst(this.sparks, 60); return burst(this.paper, 20);
      case 'parkedVan': return burst(this.shards, 10);
      case 'lionDance': burst(this.paper, 40); burst(this.confetti, 40); return burst(this.cloth, 6);
      case 'dragonFloat': burst(this.paper, 60); burst(this.confetti, 60); return burst(this.chips, 16);
      case 'pallet': case 'crates': case 'boomGate': case 'crossbuck': return burst(this.chips, b.kind === 'crates' ? 26 : 18);
      case 'cableReel': return burst(this.chips, 12);
      case 'drums': return burst(this.sparks, 8);
      case 'lifebuoy': return burst(this.cloth, 6);
      case 'forklift': burst(this.sparks, 24); return burst(this.shards, 10);
      // Farm
      case 'pumpkin': return burst(this.fruit, 22);
      case 'jackOLantern': burst(this.fruit, 22); return burst(this.fire, 6);
      case 'fruitBin': burst(this.fruit, 30); return burst(this.chips, 12);
      case 'farmStand': burst(this.fruit, 14); return burst(this.chips, 20);
      case 'feedSacks': burst(this.straw, 24); return burst(this.steam, 10); // a cloud of grain dust
      case 'scarecrow': burst(this.straw, 50); return burst(this.cloth, 5); // the hat and shirt fly off
      case 'waterTrough': return burst(this.water, 36);
      case 'milkChurn': burst(this.steam, 8); return burst(this.water, 8);
      case 'wheelbarrow': case 'toolRack': case 'mailbox': return burst(this.chips, b.kind === 'toolRack' ? 20 : 8);
      case 'woodLamp': burst(this.chips, 12); return burst(this.fire, 8);
      case 'hayWagon': burst(this.straw, 60); return burst(this.chips, 14);
      case 'parkedTractor': case 'baler': burst(this.sparks, 24); return burst(this.shards, 8);
      case 'plough': case 'seedDrill': case 'hayRake': return burst(this.sparks, 14);
    }
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
    // In a field the tyres cut ruts and throw up dust (or mud in the rain).
    const rut = player.onSoft && Math.abs(player.speed) > 2;
    this.fieldBudget += rut ? FIELD_PER_SECOND * speedFactor * dt : 0;
    const clods = Math.floor(this.fieldBudget);
    this.fieldBudget -= clods;
    for (const w of REAR_WHEELS) {
      const contact = player.wheelContact(w, this.tmpContact);
      this.skidMarks.add(w, skid > 0.25 || rut ? contact : null, Math.max(skid, rut ? RUT : 0));
      if (contact) for (let i = 0; i < puffs; i++) this.smoke.emit(contact, this.tmpVel, skid);
      if (contact && rut) for (let i = 0; i < clods; i++) (this.wet ? this.mud : this.dust).emit(contact, this.tmpVel, 0.5);
    }
    // Fronts leave their own marks when they scrub or the brakes bite (no smoke: the rears carry that).
    const frontSkid = player.frontSkid;
    for (const w of FRONT_WHEELS) {
      const contact = frontSkid > 0.25 ? player.wheelContact(w, this.tmpContact) : null;
      this.skidMarks.add(w, contact ?? (rut ? player.wheelContact(w, this.tmpContact) : null), Math.max(frontSkid, rut ? RUT : 0));
    }
    this.dust.update(dt);
    this.mud.update(dt);
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
    this.chips.update(dt);
    this.straw.update(dt);
    this.cloth.update(dt);
    for (const e of [this.fruit, this.paper, this.steam, this.tiles, this.sparks, this.confetti, ...this.fireworks]) e.update(dt);
    this.shards.update(dt);
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
    for (const p of [this.exhaust, this.soot, this.smoke, this.engineSmoke, this.fire, this.water, this.fireball, ...this.fireworks]) p.resize(viewportHeight, fov);
  }
}
