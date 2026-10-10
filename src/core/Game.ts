import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input, type DriveInput } from './Input';
import { Rng } from './Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { ChaseCamera } from '../render/ChaseCamera';
import { generateCity, type CityData } from '../world/CityGenerator';
import { buildCity } from '../world/CityBuilder';
import { pickTheme, pickTimeOfDay, type TimeOfDay } from '../world/CityTheme';
import { Sky } from '../render/Sky';
import { PropSystem, type PropBreak } from '../world/PropSystem';
import { Hud, formatTime } from '../ui/Hud';
import { Screens } from '../ui/Screens';
import { CarAudio } from '../audio/CarAudio';
import { TireSmoke } from '../render/TireSmoke';
import { Sea } from '../render/Sea';
import { Minimap } from '../ui/Minimap';
import { Health } from '../gameplay/Health';
import { SkidMarks } from '../render/SkidMarks';
import { DestinationMarker } from '../render/DestinationMarker';
import { MissionSystem, pickDestinations, routeAim, type Route } from '../gameplay/MissionSystem';
import { MISSION } from '../gameplay/balance';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const REAR_WHEELS = [2, 3];
const SMOKE_PER_SECOND = 55; // per rear wheel at full skid
const ROUTE_REFRESH = 0.25; // seconds between GPS route recalculations
const ENGINE_SMOKE_PER_SECOND = 30;
const FIRE_PER_SECOND = 40;
const GEYSER_SECONDS = 6;
const GEYSER_PER_SECOND = 70;
const NO_INPUT: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

type GameState = 'menu' | 'playing' | 'paused' | 'won' | 'lost';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private input = new Input();
  private chase: ChaseCamera;
  private sun: THREE.DirectionalLight;
  private player: Vehicle;
  readonly city: CityData;
  private fog: THREE.Fog;
  private time: TimeOfDay;
  private sky: Sky;
  private overview = false; // ?debug only: top-down map view on C
  private debug = new URLSearchParams(window.location.search).has('debug');
  private hud: Hud;
  private screens: Screens;
  private audio = new CarAudio();
  private smoke = new TireSmoke();
  private skidMarks = new SkidMarks();
  private marker = new DestinationMarker(MISSION.reachRadius);
  private sea: Sea;
  private minimap: Minimap;
  private health = new Health();
  private engineSmoke = new TireSmoke({ color: 0x2b2b30, maxAlpha: 0.55, additive: false, growth: 3 });
  private fire = new TireSmoke({ color: 0xff6a1a, maxAlpha: 0.7, additive: true, growth: 0.6 });
  private water = new TireSmoke({
    color: 0xd6ecff, maxAlpha: 0.55, additive: false, growth: 0.9, lift: [7, 11], gravity: 9.8, spread: 1.6, life: [1.2, 1.8],
  });
  private fireball = new TireSmoke({
    color: 0xff8a2a, maxAlpha: 0.9, additive: true, growth: 5, lift: [1, 7], spread: 12, life: [0.5, 1.1],
  });
  private blast = new THREE.PointLight(0xff9a40, 0, 60, 1.5);
  private props: PropSystem;
  private geysers: { position: THREE.Vector3; timeLeft: number; budget: number }[] = [];
  private engineSmokeBudget = 0;
  private fireBudget = 0;
  private mission: MissionSystem;
  private route: Route | null = null;
  private routeTimer = 0;
  private state: GameState = 'menu';
  private smokeBudget = 0;
  private tmpContact = new THREE.Vector3();
  private tmpVel = new THREE.Vector3();
  private accumulator = 0;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement, hudRoot: HTMLElement, seed: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    // The seed picks a time of day (overridable with ?time=day|afternoon|night) and a city style.
    const time = (this.time = pickTimeOfDay(seed, new URLSearchParams(window.location.search).get('time')));
    const theme = pickTheme(seed);
    this.renderer.toneMappingExposure = time.exposure;
    this.fog = new THREE.Fog(time.skyHorizon, time.fogNear, time.fogFar);
    this.scene.background = new THREE.Color(time.skyHorizon);
    this.scene.fog = this.fog;
    this.sky = new Sky(time.skyZenith, time.skyHorizon);
    this.scene.add(this.sky.mesh);
    this.scene.add(new THREE.HemisphereLight(time.hemiSky, time.hemiGround, time.hemiIntensity));

    // Shadow-casting sun follows the player so a small shadow frustum covers the visible area.
    this.sun = new THREE.DirectionalLight(time.sunColor, time.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -50;
    s.right = s.top = 50;
    s.near = 1;
    s.far = 150;
    this.scene.add(this.sun, this.sun.target);

    this.world.timestep = FIXED_DT;
    this.city = generateCity(seed);
    buildCity(this.city, this.scene, this.world, theme, time.windowGlow);
    this.sea = new Sea(this.city.islandSize / 2, time.sea);
    this.props = new PropSystem(this.city, this.scene, this.world, time.lampGlow);

    const { spawn } = this.city;
    this.player = new Vehicle(this.world, PLAYER_SPEC, { x: spawn.x, y: 1.2, z: spawn.z }, spawn.yaw);
    this.scene.add(this.player.mesh.root);
    this.scene.add(this.skidMarks.mesh, this.smoke.points, this.marker.group, this.sea.mesh);
    this.scene.add(this.engineSmoke.points, this.fire.points, this.water.points, this.fireball.points, this.blast);

    // Destinations get their own RNG stream so they're stable per seed.
    const startNode = this.city.graph.nearest(spawn.x, spawn.z);
    this.mission = new MissionSystem(pickDestinations(this.city.graph, new Rng(seed ^ 0xde57), startNode.id));

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.minimap = new Minimap(this.city);
    this.hud = new Hud(hudRoot, this.minimap.canvas);
    this.screens = new Screens(document.body);
    this.screens.menu(seed, `${theme.name} · ${time.label}`, () => this.startMission());

    const onResize = () => {
      this.chase.resize(window.innerWidth / window.innerHeight);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.resizeParticles();
    };
    onResize();
    window.addEventListener('resize', onResize);

    if (this.debug) (window as unknown as { __game: Game }).__game = this; // for browser tests
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private startMission(): void {
    if (this.state !== 'menu') return;
    this.state = 'playing';
    this.screens.hide();
    this.showDestination();
    this.hud.toast('GO!', 1.2);
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.screens.pause(() => this.setPaused(false));
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this.screens.hide();
      this.clock.getDelta(); // don't count the paused time as one huge frame
    } else {
      return;
    }
    this.audio.setPaused(paused);
  }

  /** Reload with a seed: simplest way to guarantee a completely fresh world. */
  private restart(seed: number): void {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    window.location.href = url.toString();
  }

  private handleKeys(): void {
    const pressed = (...codes: string[]) => codes.some((c) => this.input.wasPressed(c));
    if (pressed('KeyR') && this.state === 'playing') this.player.reset();
    if (pressed('KeyM')) this.hud.setMuted(this.audio.toggleMute());
    if (pressed('KeyP', 'Escape')) this.setPaused(this.state === 'playing');
    if (pressed('Enter', 'NumpadEnter')) {
      if (this.state === 'menu') this.startMission();
      else if (this.state === 'won' || this.state === 'lost') this.restart(this.city.seed);
    }
    if (pressed('KeyN') && (this.state === 'won' || this.state === 'lost')) {
      this.restart(Math.floor(Math.random() * 1_000_000));
    }
    if (this.debug) {
      if (pressed('KeyC')) {
        this.overview = !this.overview;
        this.scene.fog = this.overview ? null : this.fog;
        this.sky.mesh.visible = !this.overview;
      }
      // T: jump to the current destination. Y: leave 3 seconds on the clock.
      const target = this.mission.current;
      if (pressed('KeyT') && target && this.state === 'playing') this.player.teleport(target.x, 1.2, target.z, 0);
      if (pressed('KeyY') && this.state === 'playing') this.mission.elapsed = MISSION.timeLimit - 3;
    }
  }

  private frame(): void {
    const frameDt = Math.min(this.clock.getDelta(), 0.1);
    this.handleKeys();
    if (this.state === 'paused') {
      this.input.endFrame();
      return;
    }

    // Fixed-timestep physics, rendered with interpolation for smoothness on any refresh rate.
    // The world runs in every state so the car settles and coasts; only 'playing' takes input.
    const driveInput = this.state === 'playing' ? this.input.drive() : NO_INPUT;
    this.accumulator += frameDt;
    let steps = 0;
    let impact = 0;
    const breaks: PropBreak[] = [];
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.player.drive(driveInput, FIXED_DT);
      this.world.step();
      this.player.snapshot();
      impact = Math.max(impact, this.player.consumeImpact());
      breaks.push(...this.props.checkVehicle(this.player, FIXED_DT));
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind; drop the backlog
    const alpha = this.accumulator / FIXED_DT;

    this.player.syncMesh(alpha);
    this.props.sync();
    this.props.updateSignals(this.clock.elapsedTime);
    const carPos = this.player.mesh.root.position;
    const [sx, sy, sz] = this.time.sunOffset;
    this.sun.position.set(carPos.x + sx, carPos.y + sy, carPos.z + sz);
    this.sun.target.position.copy(carPos);

    if (this.state === 'playing') this.applyDamage(impact);
    if (this.state === 'playing') this.updateMission(frameDt, carPos);
    this.marker.update(frameDt);
    this.sea.update(frameDt);
    this.updateEffects(frameDt, impact);
    this.updatePropEffects(frameDt, breaks);

    const speedRatio = Math.min(Math.abs(this.player.speed) / this.player.spec.maxSpeed, 1);
    this.chase.update(frameDt, this.player.mesh.root, speedRatio);
    this.resizeParticles();
    this.hud.update(frameDt, this.player.speed, {
      index: this.mission.index,
      total: this.mission.total,
      timeLeft: this.mission.timeLeft,
      distance: this.state === 'playing' ? (this.route?.distance ?? null) : null,
      health: this.health.ratio,
    });
    const fwd = this.player.forward();
    const target = this.state === 'playing' ? this.mission.current : null;
    this.minimap.render(
      frameDt,
      carPos.x,
      carPos.z,
      Math.atan2(fwd.x, fwd.z),
      target ? (this.route?.path ?? null) : null,
      target ? { x: target.x, z: target.z, final: this.mission.index === this.mission.total - 1 } : null,
    );

    this.sky.follow(this.chase.camera);
    this.renderer.render(this.scene, this.overview ? this.overviewCamera() : this.chase.camera);
    this.input.endFrame();
  }

  private updateMission(dt: number, carPos: THREE.Vector3): void {
    const event = this.mission.update(dt, carPos.x, carPos.z);
    if (event === 'reached') {
      this.audio.jingle('reached');
      const left = this.mission.total - this.mission.index;
      this.hud.toast(left === 1 ? 'FINAL DESTINATION!' : `DESTINATION REACHED · ${left} LEFT`);
      this.showDestination();
    } else if (event === 'won' || event === 'lost') {
      this.endMission();
      return;
    }

    const target = this.mission.current!;
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) {
      this.route = routeAim(this.city.graph, carPos.x, carPos.z, target.id);
      this.routeTimer = ROUTE_REFRESH;
    }
  }

  private applyDamage(impact: number): void {
    if (impact <= 0) return;
    const damage = this.health.applyImpact(impact);
    if (damage > 0) this.hud.flashDamage(damage / 40);
    if (this.health.destroyed) this.explode();
  }

  /** Wrecked: the car blows up — fireball, flash, smoke, a jolt into the air — then the lose screen. */
  private explode(): void {
    const body = this.player.body;
    const m = this.player.spec.mass;
    body.applyImpulse({ x: (Math.random() - 0.5) * m * 2, y: m * 7, z: (Math.random() - 0.5) * m * 2 }, true);
    body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 3, y: (Math.random() - 0.5) * m, z: (Math.random() - 0.5) * m * 3 }, true);

    this.player.mesh.paint.color.multiplyScalar(0.15);
    this.player.mesh.taillight.emissiveIntensity = 0;
    const at = this.player.mesh.root.position.clone().setY(this.player.mesh.root.position.y + 0.8);
    this.tmpVel.set(0, 0, 0);
    for (let i = 0; i < 90; i++) this.fireball.emit(at, this.tmpVel, 0);
    for (let i = 0; i < 60; i++) this.engineSmoke.emit(at, this.tmpVel, 1);
    for (let i = 0; i < 30; i++) this.fire.emit(at, this.tmpVel, 1);
    this.blast.position.copy(at).setY(at.y + 2);
    this.blast.intensity = 4000;
    this.chase.shake(1.6);

    this.audio.stopEngine();
    this.audio.explosion();
    this.mission.fail('destroyed');
    this.endMission();
  }

  private enginePosition(): THREE.Vector3 {
    return this.player.forward(this.tmpContact).multiplyScalar(1.5).add(this.player.mesh.root.position).setY(this.player.mesh.root.position.y + 0.5);
  }

  private resizeParticles(): void {
    for (const p of [this.smoke, this.engineSmoke, this.fire, this.water, this.fireball]) p.resize(window.innerHeight, this.chase.camera.fov);
  }

  private showDestination(): void {
    const target = this.mission.current;
    if (!target) return;
    this.marker.show(target.x, target.z, this.mission.index === this.mission.total - 1);
    this.routeTimer = 0; // recompute the route on the next update
  }

  private endMission(): void {
    const won = this.mission.status === 'won';
    this.state = won ? 'won' : 'lost';
    this.marker.hide();
    // After an explosion, let the boom land before the jingle.
    this.audio.jingle(won ? 'won' : 'lost', this.mission.loseReason === 'destroyed' ? 0.9 : 0);
    const reason = this.mission.loseReason;
    // Let an explosion play out before the end screen covers it.
    const showDelay = reason === 'destroyed' ? 2000 : 0;
    window.setTimeout(() => this.showEndScreen(won), showDelay);
  }

  private showEndScreen(won: boolean): void {
    const reason = this.mission.loseReason;
    this.screens.end(
      {
        won,
        title: won ? 'YOU MADE IT!' : reason === 'destroyed' ? 'WRECKED' : "TIME'S UP",
        detail: won
          ? `All ${this.mission.total} destinations in ${formatTime(this.mission.elapsed)}.`
          : `Reached ${this.mission.index} of ${this.mission.total} destinations.`,
        seed: this.city.seed,
      },
      () => this.restart(this.city.seed),
      () => this.restart(Math.floor(Math.random() * 1_000_000)),
    );
  }

  private overviewCam?: THREE.PerspectiveCamera;

  /** Debug top-down camera over the whole city. */
  private overviewCamera(): THREE.Camera {
    if (!this.overviewCam) {
      this.overviewCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 10, 3000);
      this.overviewCam.position.set(0, this.city.size * 1.25, this.city.size * 0.35);
      this.overviewCam.lookAt(0, 0, 0);
    }
    return this.overviewCam;
  }

  private updatePropEffects(dt: number, breaks: PropBreak[]): void {
    for (const b of breaks) {
      this.audio.propBreak(b.kind, b.strength);
      if (b.kind === 'lamp' || b.kind === 'signal') {
        for (let i = 0; i < 14; i++) this.fire.emit(b.position, this.tmpVel.set(0, 0, 0), 0); // sparks
      } else if (b.kind === 'hydrant') {
        this.geysers.push({ position: b.position.clone().setY(0.3), timeLeft: GEYSER_SECONDS, budget: 0 });
      }
    }
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

  private updateEffects(dt: number, impact: number): void {
    const p = this.player;
    const skid = p.skid;

    // Skid marks + smoke from rear wheels while sliding.
    const v = p.body.linvel();
    this.tmpVel.set(v.x, v.y, v.z);
    // Scaled by speed so a car that has slowed down stops piling smoke on itself.
    const speedFactor = THREE.MathUtils.clamp(Math.abs(p.speed) / 15, 0, 1);
    this.smokeBudget += skid > 0.15 ? SMOKE_PER_SECOND * skid * speedFactor * dt : 0;
    const puffs = Math.floor(this.smokeBudget);
    this.smokeBudget -= puffs;
    for (const w of REAR_WHEELS) {
      const contact = p.wheelContact(w, this.tmpContact);
      this.skidMarks.add(w, skid > 0.25 ? contact : null, skid);
      if (contact) for (let i = 0; i < puffs; i++) this.smoke.emit(contact, this.tmpVel, skid);
    }
    this.smoke.update(dt);

    // Damage: engine smoke below half health, fire when critical (and while wrecked).
    const h = this.health;
    if (h.smoking) {
      const at = this.enginePosition();
      this.engineSmokeBudget += ENGINE_SMOKE_PER_SECOND * (1 - h.ratio / 0.5 + 0.3) * dt;
      while (this.engineSmokeBudget >= 1) {
        this.engineSmoke.emit(at, this.tmpVel, 0.5);
        this.engineSmokeBudget--;
      }
      if (h.burning) {
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
    this.blast.intensity *= Math.exp(-6 * dt);

    // Impact = velocity change in m/s: ~3 is a scrape, 40+ is a full-speed wall hit.
    if (impact > 0) this.audio.impact(THREE.MathUtils.clamp((impact - 1.5) / 20, 0.1, 1));
    this.audio.update(dt, { speed: p.speed, throttle: p.lastInput.throttle, skid, maxSpeed: p.spec.maxSpeed });
  }
}
