import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input, type DriveInput } from './Input';
import { Rng } from './Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { buildCarMesh } from '../vehicles/carMesh';
import { ChaseCamera } from '../render/ChaseCamera';
import { generateCity, type CityData } from '../world/CityGenerator';
import { buildCity } from '../world/CityBuilder';
import { pickTheme, pickTimeOfDay, type TimeOfDay } from '../world/CityTheme';
import { Sky } from '../render/Sky';
import { CopDirector, type Cop } from '../ai/CopDirector';
import { CivilianTraffic, civilianSpecVariants } from '../ai/CivilianTraffic';
import { approachControls } from '../world/TrafficControl';
import { CrashMarks } from '../render/CrashMarks';
import { Landmarks } from '../render/Landmarks';
import type { ChaseTarget, LineOfSight } from '../ai/CopController';
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
import { WantedSystem } from '../gameplay/WantedSystem';
import { DIFFICULTIES, difficultyById, scaledCopCap, type Difficulty } from '../gameplay/difficulty';
import { Records } from '../gameplay/Records';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { COP_RAM, DAMAGE } from '../gameplay/balance';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const REAR_WHEELS = [2, 3];
const SMOKE_PER_SECOND = 55; // per rear wheel at full skid
const SIGHT_HEIGHT = 0.6; // cop line-of-sight rays: under planter tops (0.9m), over the road
const ROUTE_REFRESH = 0.25; // seconds between GPS route recalculations
const ENGINE_SMOKE_PER_SECOND = 30;
const FIRE_PER_SECOND = 40;
const GEYSER_SECONDS = 6;
const GEYSER_PER_SECOND = 70;
const SIREN_LIGHTS = 2; // shared flashing lights, given to the nearest cops (fixed count avoids shader recompiles)
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
  private difficulty: Difficulty = difficultyById(storageGet('cp-difficulty'));
  private records = new Records(safeStorage());
  private touch: TouchControls | null = null;
  private destinations: ReturnType<typeof pickDestinations>;
  private look = '';
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
  private director: CopDirector;
  private wanted = new WantedSystem();
  private traffic: CivilianTraffic;
  private crashMarks = new CrashMarks();
  private walls: Set<number>; // collider handles of buildings, sea wall, landmarks
  // Cop ramming: who is touching the player now, and each cop's closing speed last step.
  private copTouching = new WeakSet<Cop>();
  private copClosing = new WeakMap<Cop, number>();
  private ramSound = 0; // a cop started ramming the player this frame: crash strength 0..1
  private landmarks: Landmarks;
  private chaseTarget: ChaseTarget = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private sirenLights: THREE.PointLight[] = [];
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
    const mobile = isTouchDevice();
    // Phones: cap resolution a little lower to keep the frame rate up.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
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
    this.sun.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -50;
    s.right = s.top = 50;
    s.near = 1;
    s.far = 150;
    this.scene.add(this.sun, this.sun.target);

    this.world.timestep = FIXED_DT;
    this.city = generateCity(seed);
    this.walls = buildCity(this.city, this.scene, this.world, theme, time.windowGlow);
    this.landmarks = new Landmarks(this.city.landmarks, this.scene, this.world, time.lampGlow, this.walls);
    this.sea = new Sea(this.city.islandSize / 2, time.sea);
    this.props = new PropSystem(this.city, this.scene, this.world, time.lampGlow);

    const { spawn } = this.city;
    this.player = new Vehicle(this.world, PLAYER_SPEC, { x: spawn.x, y: 1.2, z: spawn.z }, spawn.yaw);
    this.player.headlights = { day: 0, afternoon: 0.45, night: 1 }[time.name];
    this.scene.add(this.player.mesh.root);
    this.scene.add(this.skidMarks.mesh, this.smoke.points, this.marker.group, this.sea.mesh);
    this.scene.add(this.engineSmoke.points, this.fire.points, this.water.points, this.fireball.points, this.blast);

    // Destinations get their own RNG stream so they're stable per seed.
    const startNode = this.city.graph.nearest(spawn.x, spawn.z);
    this.destinations = pickDestinations(this.city.graph, new Rng(seed ^ 0xde57), startNode.id);
    this.mission = new MissionSystem(this.destinations, { ...MISSION, timeLimit: this.difficulty.timeLimit });

    // Cops: line of sight is two rays a car-width apart against static geometry (buildings etc.),
    // low enough that plaza planters block it too — a cop can't drive straight through those.
    const canSee: LineOfSight = (from, to) => {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dz);
      if (len < 1) return true;
      for (const off of [-0.9, 0.9]) {
        const ox = (-dz / len) * off;
        const oz = (dx / len) * off;
        const ray = new RAPIER.Ray({ x: from.x + ox, y: SIGHT_HEIGHT, z: from.z + oz }, { x: dx / len, y: 0, z: dz / len });
        const hit = this.world.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
        if (hit && hit.timeOfImpact < len - 2) return false;
      }
      return true;
    };
    this.director = new CopDirector(this.world, this.scene, this.city.graph, canSee, new Rng(seed ^ 0xc095), this.player.headlights);
    this.traffic = new CivilianTraffic(
      this.world,
      this.scene,
      this.city.graph,
      approachControls(this.city.graph, this.city.streetProps),
      new Rng(seed ^ 0x7a4f1c),
      this.player.headlights,
    );
    this.scene.add(this.crashMarks.mesh);
    for (let i = 0; i < SIREN_LIGHTS; i++) {
      const light = new THREE.PointLight(0xff2020, 0, 45, 1.6);
      this.sirenLights.push(light);
      this.scene.add(light);
    }

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.minimap = new Minimap(this.city);
    this.hud = new Hud(hudRoot, this.minimap.canvas);
    this.screens = new Screens(document.body, (kind) => this.audio.uiBlip(kind));
    this.look = `${theme.name} · ${time.label}`;
    this.showMenu();
    if (mobile) {
      this.touch = new TouchControls(document.body, {
        pause: () => this.setPaused(this.state === 'playing'),
        reset: () => this.state === 'playing' && this.player.reset(),
      });
      this.input.touch = this.touch.state;
      document.body.classList.add('is-touch');
    }

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

  /** The splash screen was dismissed with a key/click: audio may start; play the menu loop. */
  audioUnlocked(): void {
    this.audio.unlock();
    if (this.state === 'menu') this.audio.menuMusic(true);
  }

  private showMenu(): void {
    const best = this.records.best(this.city.seed, this.difficulty.id);
    this.screens.menu(
      {
        seed: this.city.seed,
        look: this.look,
        difficulties: DIFFICULTIES,
        difficulty: this.difficulty.id,
        best: best ? formatTime(best.seconds) : null,
      },
      () => this.startMission(),
      (id) => this.setDifficulty(id),
    );
  }

  private setDifficulty(id: string): void {
    this.difficulty = difficultyById(id);
    storageSet('cp-difficulty', this.difficulty.id);
    // Rebuild the (not yet started) mission so the timer shows this difficulty's limit.
    this.mission = new MissionSystem(this.destinations, { ...MISSION, timeLimit: this.difficulty.timeLimit });
    this.showMenu();
  }

  private startMission(): void {
    if (this.state !== 'menu') return;
    this.state = 'playing';
    const d = this.difficulty;
    this.health = new Health({ ...DAMAGE, maxHealth: d.maxHealth, impactThreshold: d.armor, impactScale: DAMAGE.impactScale * d.damageScale });
    this.wanted.rate = d.heatRate;
    this.traffic.count = d.traffic;
    this.touch?.setVisible(true);
    this.audio.unlock();
    this.audio.menuMusic(false);
    this.audio.startEngine();
    this.audio.uiBlip('click');
    this.screens.hide();
    this.showDestination();
    this.hud.toast('GO!', 1.2);
    this.prewarmShaders();
  }

  /**
   * Compile in the background now every shader the chase can need — each cop and civilian
   * vehicle, plus effects not drawn yet (smoke, fire) — rather than stalling a frame mid-chase
   * the first time one appears. Uses the live scene's lights, settled by now (the menu has been
   * rendering).
   */
  private prewarmShaders(): void {
    const staging = new THREE.Scene();
    for (const spec of [...Object.values(COP_SPECS), ...civilianSpecVariants()]) staging.add(buildCarMesh(spec).root);
    this.renderer.compileAsync(staging, this.chase.camera, this.scene).catch(() => {});
    this.renderer.compileAsync(this.scene, this.chase.camera).catch(() => {});
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.screens.pause(this.city.seed, () => this.setPaused(false), () => this.restart(this.city.seed));
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
    if (pressed('KeyF')) toggleFullscreen();
    if (pressed('KeyP', 'Escape')) this.setPaused(this.state === 'playing');
    if (pressed('Enter', 'NumpadEnter')) {
      if (this.state === 'menu') this.startMission();
      else if (this.state === 'won' || this.state === 'lost' || this.state === 'paused') this.restart(this.city.seed);
    }
    if (this.state === 'menu' && pressed('ArrowLeft', 'ArrowRight')) {
      const i = DIFFICULTIES.indexOf(this.difficulty);
      const next = DIFFICULTIES[(i + (pressed('ArrowRight') ? 1 : DIFFICULTIES.length - 1)) % DIFFICULTIES.length];
      this.setDifficulty(next.id);
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
      if (pressed('KeyK') && this.state === 'playing') this.raiseStars(this.wanted.bump());
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
    let ramDamage = 0;
    let crashSound = 0; // loudest car-on-car/wall crash heard this frame, 0..1 (strength × distance)
    const breaks: PropBreak[] = [];
    const lv = this.player.body.linvel();
    this.chaseTarget.position.copy(this.player.position);
    this.chaseTarget.velocity.set(lv.x, 0, lv.z);
    const copsChase = this.state === 'playing';
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.player.drive(driveInput, FIXED_DT);
      const now = this.clock.elapsedTime;
      for (const car of this.traffic.cars) car.vehicle.drive(car.controller.update(FIXED_DT, now), FIXED_DT);
      for (const cop of this.director.cops) {
        const active = copsChase && cop.wreckedFor === null;
        cop.vehicle.drive(active ? cop.controller.update(FIXED_DT, this.chaseTarget) : NO_INPUT, FIXED_DT);
      }
      this.world.step();
      this.player.snapshot();
      const playerHit = this.player.consumeImpact();
      if (playerHit > 0) this.markWall(this.player, playerHit);
      impact = Math.max(impact, playerHit);
      for (const car of this.traffic.cars) {
        car.vehicle.snapshot();
        const hit = car.vehicle.consumeImpact();
        if (hit > 3) crashSound = Math.max(crashSound, this.crashLoudness(car.vehicle, hit));
        if (hit > 3) {
          car.controller.hit();
          // Hitting a civilian draws attention — but driving up the ramp truck's deck isn't a crash.
          const onRamp = car.vehicle.spec.body === 'ramptruck' && this.player.position.y > car.vehicle.position.y - 0.5;
          if (this.state === 'playing' && !onRamp && car.vehicle.position.distanceTo(this.player.position) < 8) this.raiseStars(this.wanted.civilianHit());
        }
      }
      breaks.push(...this.props.checkVehicle(this.player, FIXED_DT));
      for (const cop of this.director.cops) {
        cop.vehicle.snapshot();
        breaks.push(...this.props.checkVehicle(cop.vehicle, FIXED_DT));
        if (copsChase && cop.wreckedFor === null) ramDamage += this.copContactDamage(cop, FIXED_DT);
        const hit = cop.vehicle.consumeImpact();
        if (hit > 0) this.markWall(cop.vehicle, hit);
        if (hit > 0) crashSound = Math.max(crashSound, this.crashLoudness(cop.vehicle, hit));
        if (hit > 0 && cop.wreckedFor === null) {
          cop.health.applyImpact(hit);
          if (cop.health.destroyed) this.explodeCop(cop);
        }
      }
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind; drop the backlog
    const alpha = this.accumulator / FIXED_DT;

    this.player.syncMesh(alpha);
    for (const cop of this.director.cops) cop.vehicle.syncMesh(alpha);
    for (const car of this.traffic.cars) car.vehicle.syncMesh(alpha);
    this.traffic.update(this.player.position);
    if (this.state === 'playing') {
      this.raiseStars(this.wanted.update(frameDt));
      const level = this.wanted.level;
      this.director.update(
        frameDt,
        this.chaseTarget,
        this.player.forward(),
        { ...level, maxCops: scaledCopCap(level.maxCops, this.difficulty) },
        this.route?.path ?? null,
      );
    }
    this.updateSirens();
    this.props.sync();
    this.props.updateSignals(this.clock.elapsedTime);
    const carPos = this.player.mesh.root.position;
    const [sx, sy, sz] = this.time.sunOffset;
    this.sun.position.set(carPos.x + sx, carPos.y + sy, carPos.z + sz);
    this.sun.target.position.copy(carPos);

    if (this.state === 'playing') this.applyDamage(impact, ramDamage);
    if (this.state === 'playing') this.updateMission(frameDt, carPos);
    this.marker.update(frameDt);
    this.sea.update(frameDt);
    this.landmarks.update(frameDt, this.chase.camera, window.innerHeight, this.chase.camera.fov);
    this.updateEffects(frameDt, impact, crashSound);
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
      stars: this.wanted.stars,
      starProgress: this.wanted.progress,
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
      this.director.activeCops.map((c) => c.vehicle.position),
      this.traffic.rampTruck?.vehicle.position ?? null,
    );

    this.sky.follow(this.chase.camera);
    this.renderer.render(this.scene, this.overview ? this.overviewCamera() : this.chase.camera);
    this.input.endFrame();
  }

  private updateMission(dt: number, carPos: THREE.Vector3): void {
    const event = this.mission.update(dt, carPos.x, carPos.z);
    if (event === 'reached') {
      this.audio.jingle('reached');
      this.wanted.checkpoint(); // every delivery turns up the heat a little faster
      const repaired = this.health.repair(this.difficulty.checkpointRepair) > 0;
      const left = this.mission.total - this.mission.index;
      this.hud.toast((left === 1 ? 'FINAL DESTINATION!' : `DESTINATION REACHED · ${left} LEFT`) + (repaired ? ' · CAR REPAIRED' : ''));
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

  private applyDamage(impact: number, ramDamage: number): void {
    if (impact <= 0 && ramDamage <= 0) return;
    const damage = this.health.applyImpact(impact) + this.health.applyDamage(ramDamage);
    if (damage > 0) this.hud.flashDamage(damage / 40);
    if (this.health.destroyed) this.explode();
  }

  /**
   * Damage from a cop touching the player this step: a bang when contact starts (by the closing
   * speed just before it) plus a steady grind while it lasts. Ignores armor — see COP_RAM.
   */
  private copContactDamage(cop: Cop, dt: number): number {
    let touching = false;
    this.world.contactPair(this.player.collider, cop.vehicle.collider, (m) => {
      for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.05) touching = true;
    });
    const a = cop.vehicle.body.linvel();
    const b = this.player.body.linvel();
    const closing = this.copClosing.get(cop) ?? 0;
    this.copClosing.set(cop, Math.hypot(a.x - b.x, a.z - b.z));
    const wasTouching = this.copTouching.has(cop);
    if (!touching) {
      this.copTouching.delete(cop);
      return 0;
    }
    this.copTouching.add(cop);
    // A ram can shove the player without a sharp velocity jump, so it gets its own bang.
    if (!wasTouching) this.ramSound = Math.max(this.ramSound, impactStrength(closing));
    const damage = COP_RAM.grindPerSec * dt + (wasTouching ? 0 : COP_RAM.bangPerMs * closing);
    return damage * (cop.vehicle.spec.mass / COP_RAM.referenceMass) * this.difficulty.damageScale;
  }

  /** Wrecked: the car blows up — fireball, flash, smoke, a jolt into the air — then the lose screen. */
  private explode(): void {
    const body = this.player.body;
    const m = this.player.spec.mass;
    body.applyImpulse({ x: (Math.random() - 0.5) * m * 2, y: m * 7, z: (Math.random() - 0.5) * m * 2 }, true);
    body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 3, y: (Math.random() - 0.5) * m, z: (Math.random() - 0.5) * m * 3 }, true);

    this.player.mesh.paint.color.multiplyScalar(0.15);
    this.player.lightsOff = true;
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

  /** A hard hit into something solid: scuff the wall where the car struck it. */
  private markWall(vehicle: Vehicle, impact: number): void {
    if (impact < 6) return;
    const v = vehicle.impactVelocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 3) return;
    const p = vehicle.position;
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: v.x / speed, y: 0, z: v.z / speed });
    const hit = this.world.castRayAndGetNormal(
      ray,
      vehicle.spec.halfExtents.z + 2.5,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      undefined,
      vehicle.collider,
      vehicle.body,
      (collider) => this.walls.has(collider.handle), // walls only, not lamps/trees/planters
    );
    if (!hit) return;
    const point = new THREE.Vector3(p.x + (v.x / speed) * hit.timeOfImpact, p.y, p.z + (v.z / speed) * hit.timeOfImpact);
    this.crashMarks.add(point, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), Math.min(1, (impact - 6) / 25), vehicle.mesh.paint.color);
  }

  /** Announce a new wanted level. */
  private raiseStars(stars: number | null): void {
    if (stars === null) return;
    const news = ['', '', 'MORE UNITS RESPONDING', 'INTERCEPTORS INBOUND', 'SUVs AND ROADBLOCKS', 'ARMORED UNITS DEPLOYED'][stars];
    this.hud.toast(`${'★'.repeat(stars)}  ${news}`, 2.5);
    this.hud.flashStars();
    this.audio.jingle('reached');
  }

  /** A cop car wrecked: smaller blast, launched, burns until the director clears it. */
  private explodeCop(cop: Cop): void {
    this.director.wreck(cop);
    if (this.state === 'playing') this.raiseStars(this.wanted.copWrecked());
    const v = cop.vehicle;
    const m = v.spec.mass;
    v.body.applyImpulse({ x: 0, y: m * 5, z: 0 }, true);
    v.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 3, y: 0, z: (Math.random() - 0.5) * m * 3 }, true);
    v.mesh.paint.color.multiplyScalar(0.15);
    const at = v.position.clone().setY(v.position.y + 0.8);
    this.tmpVel.set(0, 0, 0);
    for (let i = 0; i < 60; i++) this.fireball.emit(at, this.tmpVel, 0);
    for (let i = 0; i < 40; i++) this.engineSmoke.emit(at, this.tmpVel, 1);
    this.blast.position.copy(at).setY(at.y + 2);
    this.blast.intensity = 3000;
    const dist = at.distanceTo(this.player.position);
    this.chase.shake(Math.max(0, 1 - dist / 60));
    this.audio.explosion(Math.max(0.15, 1 - dist / 200));
    this.hud.toast('COP WRECKED!', 1.5);
  }

  /** Flash light bars, park the shared siren lights on the nearest cops, and set the siren sound. */
  private updateSirens(): void {
    const t = this.clock.elapsedTime;
    const redOn = Math.sin(t * Math.PI * 6) > 0; // alternating ~3 Hz
    const night = this.player.headlights;
    const playerPos = this.player.position;
    const active = this.director.activeCops
      .map((c) => ({ c, d: c.vehicle.position.distanceTo(playerPos) }))
      .sort((a, b) => a.d - b.d);
    for (const cop of this.director.cops) {
      const lights = cop.vehicle.mesh.sirenLights;
      if (!lights) continue;
      const on = cop.wreckedFor === null && this.state !== 'won';
      lights.red.emissiveIntensity = on && redOn ? 6 : 0.2;
      lights.blue.emissiveIntensity = on && !redOn ? 6 : 0.2;
      (lights.redGlow.material as THREE.SpriteMaterial).opacity = on && redOn ? 0.5 + night * 0.5 : 0;
      (lights.blueGlow.material as THREE.SpriteMaterial).opacity = on && !redOn ? 0.5 + night * 0.5 : 0;
    }
    this.sirenLights.forEach((light, i) => {
      const nearest = active[i];
      if (!nearest || this.state === 'won') {
        light.intensity = 0;
        return;
      }
      light.position.copy(nearest.c.vehicle.mesh.root.position).setY(nearest.c.vehicle.mesh.root.position.y + 1.8);
      light.color.setHex((i % 2 === 0) === redOn ? 0xff2020 : 0x2050ff);
      light.intensity = 40 + night * 160;
    });
    this.audio.setSiren(active.length && this.state === 'playing' ? active[0].d : null);
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
    if (won) this.audio.playWinMusic();
    const reason = this.mission.loseReason;
    // Let an explosion play out before the end screen covers it.
    const showDelay = reason === 'destroyed' ? 2000 : 0;
    window.setTimeout(() => this.showEndScreen(won), showDelay);
  }

  private showEndScreen(won: boolean): void {
    const reason = this.mission.loseReason;
    this.touch?.setVisible(false);
    let newBest = false;
    let board: { time: string; label: string; current: boolean }[] | undefined;
    if (won) {
      const run = { seed: this.city.seed, difficulty: this.difficulty.id, seconds: this.mission.elapsed, date: new Date().toISOString().slice(0, 10) };
      newBest = this.records.add(run).newBest;
      board = this.records.top(5).map((r) => ({
        time: formatTime(r.seconds),
        label: `City #${r.seed} · ${difficultyById(r.difficulty).label}`,
        current: r === run,
      }));
    }
    this.screens.end(
      {
        won,
        title: won ? 'YOU MADE IT!' : reason === 'destroyed' ? 'WRECKED' : "TIME'S UP",
        detail: won
          ? `All ${this.mission.total} destinations in ${formatTime(this.mission.elapsed)}.`
          : `Reached ${this.mission.index} of ${this.mission.total} destinations.`,
        seed: this.city.seed,
        newBest,
        board,
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
      if (this.state === 'playing') this.raiseStars(this.wanted.propSmashed());
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

  /** How loud another car's crash sounds at the player: impact strength fading with distance. */
  private crashLoudness(vehicle: Vehicle, hit: number): number {
    const near = THREE.MathUtils.clamp(1 - vehicle.position.distanceTo(this.player.position) / 150, 0, 1);
    return impactStrength(hit) * near * near;
  }

  private updateEffects(dt: number, impact: number, crashSound: number): void {
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

    const playerCrash = Math.max(impact > 0 ? impactStrength(impact) : 0, this.ramSound);
    this.ramSound = 0;
    this.audio.impact(Math.max(playerCrash, crashSound));
    this.audio.update(dt, { speed: p.speed, throttle: p.lastInput.throttle, skid, maxSpeed: p.spec.maxSpeed });
  }
}

/** F: enter/leave fullscreen (still within the key press's user activation, so browsers allow it). */
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** localStorage, or null where it's unavailable (private mode, sandboxed previews). */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageGet(key: string): string | null {
  try {
    return safeStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    safeStorage()?.setItem(key, value);
  } catch {
    // Not persisted; fine.
  }
}

/** Impact = velocity change (or closing speed) in m/s: ~3 is a scrape, 40+ is a full-speed hit. */
function impactStrength(speed: number): number {
  return THREE.MathUtils.clamp((speed - 1.5) / 20, 0.1, 1);
}
