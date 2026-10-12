import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input, type DriveInput } from './Input';
import { Rng } from './Rng';
import { safeStorage, storageGet, storageSet } from './storage';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { buildCarMesh } from '../vehicles/carMesh';
import { ChaseCamera } from '../render/ChaseCamera';
import { DEFAULT_CITY, generateCity, type CityConfig, type CityData } from '../world/CityGenerator';
import { groundHeight, type GroundHeight } from '../world/Terrain';
import { buildCity } from '../world/CityBuilder';
import { pickTheme, pickTimeOfDay, type TimeOfDay } from '../world/CityTheme';
import { applyClimate, pickClimate, pickWeather, playerGrip, weatherLabel } from '../world/Climate';
import { Sky } from '../render/Sky';
import { Precipitation } from '../render/Precipitation';
import { CopDirector, DIRECTOR_TUNING, type Cop } from '../ai/CopDirector';
import { CivilianTraffic, civilianSpecVariants } from '../ai/CivilianTraffic';
import { approachControls } from '../world/TrafficControl';
import { CrashMarks } from '../render/CrashMarks';
import { Landmarks } from '../render/Landmarks';
import type { ChaseTarget } from '../ai/CopController';
import { staticLineOfSight } from '../ai/lineOfSight';
import { PropSystem, type PropBreak } from '../world/PropSystem';
import { RoadworksSite } from '../world/RoadworksSite';
import { Hud, formatTime } from '../ui/Hud';
import { Screens } from '../ui/Screens';
import { CarAudio } from '../audio/CarAudio';
import { Effects } from '../render/Effects';
import { Sirens } from '../render/Sirens';
import { Sea, SEA_LEVEL } from '../render/Sea';
import { scratchCar } from '../render/CarScratches';
import type { CanalWater } from '../render/CanalWater';
import { Minimap } from '../ui/Minimap';
import { Health } from '../gameplay/Health';
import { DestinationMarker } from '../render/DestinationMarker';
import { MissionSystem, pickDestinations, routeAim, type Route } from '../gameplay/MissionSystem';
import { MISSION } from '../gameplay/balance';
import { WantedSystem } from '../gameplay/WantedSystem';
import { DIFFICULTIES, difficultyById, scaledCopCap, type Difficulty } from '../gameplay/difficulty';
import { Records } from '../gameplay/Records';
import { CopContact } from '../gameplay/CopContact';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { DAMAGE } from '../gameplay/balance';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 3; // more only snowballs on a slow phone: each catch-up step makes the frame slower still
const ROUTE_REFRESH = 0.25; // seconds between GPS route recalculations
const CIVILIAN_PROP_RANGE = 90; // metres: civilians nearer the player than this collide with props
const WHACK_SPEED = 3; // m/s the player must be driving into a cop for a hit to count as a ram
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
  private ground: GroundHeight = (x, z) => groundHeight(this.city.terrain, x, z);
  private fog: THREE.Fog;
  private time: TimeOfDay;
  private precipitation: Precipitation | null = null;
  private sky: Sky;
  private overview = false; // ?debug only: top-down map view on C
  private debug = new URLSearchParams(window.location.search).has('debug');
  private hud: Hud;
  private screens: Screens;
  private audio = new CarAudio();
  private effects: Effects;
  private marker = new DestinationMarker(MISSION.reachRadius);
  private sea: Sea;
  private canalWater: CanalWater | null;
  private minimap: Minimap;
  private health = new Health();
  private difficulty: Difficulty = difficultyById(storageGet('cp-difficulty'));
  private records = new Records(safeStorage());
  private touch: TouchControls | null = null;
  private destinations: ReturnType<typeof pickDestinations>;
  private look = '';
  private props: PropSystem;
  private roadworks: RoadworksSite[];
  private director: CopDirector;
  private wanted = new WantedSystem();
  private traffic: CivilianTraffic;
  private crashMarks = new CrashMarks();
  private walls: Set<number>; // collider handles of buildings, sea wall, landmarks
  private copContact: CopContact;
  private ramSound = 0; // a cop started ramming the player this frame: crash strength 0..1
  private landmarks: Landmarks;
  private chaseTarget: ChaseTarget = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private sirens: Sirens;
  private mission: MissionSystem;
  private route: Route | null = null;
  private routeTimer = 0;
  private state: GameState = 'menu';
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

    // The seed picks a climate, a weather, a time of day and a building style that suits the climate.
    // Overrides for testing, only with ?debug: ?city=temperate|snow|beach|desert, ?weather=clear|rain|snow.
    // a time of day (?time=day|afternoon|night) and a building style that suits the climate.
    const params = new URLSearchParams(window.location.search);
    const climate = pickClimate(seed, this.debug ? params.get('city') : null);
    const weather = pickWeather(seed, climate, this.debug ? params.get('weather') : null);
    const time = (this.time = applyClimate(pickTimeOfDay(seed, params.get('time')), climate, weather));
    const theme = pickTheme(seed, climate);
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
    // ?roadworks forces every (rare) roadworks slot and ?canalramp the (rare) canal jump, for testing. With ?debug, ?canals=0|1|2 and
    // ?hill=0|1 force the terrain.
    const config: CityConfig = { ...DEFAULT_CITY };
    if (params.has('roadworks')) config.roadworksChance = 1;
    if (params.has('canalramp')) config.canalRampChance = 1;
    const canals = Number.parseInt(params.get('canals') ?? '', 10);
    if (this.debug && canals >= 0 && canals <= 2) config.canalOdds = [canals === 0 ? 1 : 0, canals === 1 ? 1 : 0, canals === 2 ? 1 : 0];
    if (this.debug && params.has('hill')) config.hillChance = params.get('hill') === '0' ? 0 : 1;
    this.city = generateCity(seed, config);
    const built = buildCity(this.city, this.scene, this.world, { theme, climate, windowGlow: time.windowGlow, wet: weather === 'rain', sea: time.sea, shallow: climate.shallow });
    this.canalWater = built.canalWater;
    this.walls = built.walls;
    this.landmarks = new Landmarks(this.city.landmarks, this.city.terrain, this.scene, this.world, time.lampGlow, this.walls);
    this.sea = new Sea(this.city.islandSize / 2, time.sea, climate.shallow, this.city.terrain.canals);
    this.props = new PropSystem(this.city, this.scene, this.world, time.lampGlow, built.props, {
      leaves: theme.leaves[0],
      trunk: theme.trunk,
      snowy: climate.snowRoofs,
    });
    this.roadworks = this.city.roadworks.map((site) => new RoadworksSite(site, this.city.terrain, this.scene, this.world, this.walls));

    const { spawn } = this.city;
    this.player = new Vehicle(this.world, PLAYER_SPEC, { x: spawn.x, y: this.ground(spawn.x, spawn.z) + 1.2, z: spawn.z }, spawn.yaw);
    this.player.headlights = Math.max({ day: 0, afternoon: 0.45, night: 1 }[time.name], weather === 'clear' ? 0 : 0.45);
    this.player.setGrip(playerGrip(climate, weather));
    this.effects = new Effects(this.scene, climate.spray);
    if (weather !== 'clear') {
      this.precipitation = new Precipitation(weather, mobile ? 0.5 : 1);
      this.scene.add(this.precipitation.object);
    }
    this.scene.add(this.player.mesh.root);
    this.scene.add(this.marker.group, this.sea.mesh);

    // Destinations get their own RNG stream so they're stable per seed.
    const startNode = this.city.graph.nearest(spawn.x, spawn.z);
    this.destinations = pickDestinations(this.city.graph, new Rng(seed ^ 0xde57), startNode.id);
    this.mission = new MissionSystem(this.destinations, { ...MISSION, timeLimit: this.difficulty.timeLimit });

    this.director = new CopDirector(this.world, this.scene, this.city.graph, staticLineOfSight(this.world, this.ground), new Rng(seed ^ 0xc095), this.player.headlights, DIRECTOR_TUNING, this.ground);
    this.traffic = new CivilianTraffic(
      this.world,
      this.scene,
      this.city.graph,
      approachControls(this.city.graph, this.city.streetProps),
      new Rng(seed ^ 0x7a4f1c),
      this.player.headlights,
      this.ground,
    );
    this.scene.add(this.crashMarks.mesh);
    this.sirens = new Sirens(this.scene);
    this.copContact = new CopContact(this.world, this.player);

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.minimap = new Minimap(this.city);
    this.hud = new Hud(hudRoot, this.minimap.canvas);
    this.screens = new Screens(document.body, (kind) => this.audio.uiBlip(kind));
    this.look = [climate.name === 'temperate' ? null : climate.label, theme.name, time.label, weatherLabel(weather) || null]
      .filter(Boolean)
      .join(' · ');
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
      this.effects.resize(window.innerHeight, this.chase.camera.fov);
    };
    onResize();
    window.addEventListener('resize', onResize);
    // Switching tab or app mid-run pauses it; the player resumes from the pause menu.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setPaused(true);
    });

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
      if (pressed('KeyT') && target && this.state === 'playing') this.player.teleport(target.x, this.ground(target.x, target.z) + 1.2, target.z, 0);
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
    this.props.updateActive(frameDt, this.propToucherPositions());
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
      this.scratch(this.player, playerHit);
      impact = Math.max(impact, playerHit);
      for (const car of this.traffic.cars) {
        car.vehicle.snapshot();
        const hit = car.vehicle.consumeImpact();
        this.scratch(car.vehicle, hit);
        if (hit > 0) this.markWall(car.vehicle, hit);
        if (hit > 3) crashSound = Math.max(crashSound, this.crashLoudness(car.vehicle, hit));
        if (hit > 3) {
          car.controller.hit();
          // Hitting a civilian draws attention — but driving up the ramp truck's deck isn't a crash.
          // Measured along the truck's own up axis, so it still holds parked on a slope.
          const onRamp =
            car.vehicle.spec.body === 'ramptruck' &&
            this.player.position.clone().sub(car.vehicle.position).dot(new THREE.Vector3(0, 1, 0).applyQuaternion(car.vehicle.quaternion)) > -0.5;
          if (this.state === 'playing' && !onRamp && car.vehicle.position.distanceTo(this.player.position) < 8) this.raiseStars(this.wanted.civilianHit());
        }
      }
      breaks.push(...this.scratchOnProps(this.player, this.props.checkVehicle(this.player, FIXED_DT)));
      for (const cop of this.director.cops) {
        cop.vehicle.snapshot();
        breaks.push(...this.scratchOnProps(cop.vehicle, this.props.checkVehicle(cop.vehicle, FIXED_DT)));
        if (copsChase && cop.wreckedFor === null) ramDamage += this.copContactDamage(cop, FIXED_DT);
        const hit = cop.vehicle.consumeImpact();
        if (hit > 0) this.markWall(cop.vehicle, hit);
        this.scratch(cop.vehicle, hit);
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
        this.mission.current,
      );
    }
    const nearestCop = this.sirens.update(this.clock.elapsedTime, this.director.cops, this.player.position, this.player.headlights, this.state !== 'won');
    this.audio.setSiren(this.state === 'playing' ? nearestCop : null);
    this.props.sync();
    this.props.updateSignals(this.clock.elapsedTime);
    for (const works of this.roadworks) works.update(frameDt, this.clock.elapsedTime);
    const carPos = this.player.mesh.root.position;
    const [sx, sy, sz] = this.time.sunOffset;
    this.sun.position.set(carPos.x + sx, carPos.y + sy, carPos.z + sz);
    this.sun.target.position.copy(carPos);

    if (this.state === 'playing') this.applyDamage(impact, ramDamage);
    if (this.state === 'playing' && this.player.position.y < SEA_LEVEL - 0.3) this.drown();
    if (this.state === 'playing') this.updateMission(frameDt, carPos);
    this.marker.update(frameDt);
    this.sea.update(frameDt);
    this.canalWater?.update(frameDt);
    this.precipitation?.update(frameDt, this.chase.camera.position);
    this.landmarks.update(frameDt, this.chase.camera, window.innerHeight, this.chase.camera.fov);
    this.effects.update(frameDt, this.player, this.health);
    this.updatePropBreaks(breaks);
    this.updateCrashAudio(frameDt, impact, crashSound);

    const speedRatio = Math.min(Math.abs(this.player.speed) / this.player.spec.maxSpeed, 1);
    this.chase.update(frameDt, this.player.mesh.root, speedRatio);
    this.effects.resize(window.innerHeight, this.chase.camera.fov);
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
      this.rampTruckOnMap(),
    );

    this.sky.follow(this.chase.camera);
    this.renderer.render(this.scene, this.overview ? this.overviewCamera() : this.chase.camera);
    this.input.endFrame();
  }

  /** Vehicles whose surroundings need solid props: the player, cops, and civilians in view of the player. */
  private propToucherPositions(): THREE.Vector3[] {
    const p = this.player.position;
    const out = [p];
    for (const cop of this.director.cops) out.push(cop.vehicle.position);
    for (const car of this.traffic.cars) {
      if (car.vehicle.position.distanceToSquared(p) < CIVILIAN_PROP_RANGE ** 2) out.push(car.vehicle.position);
    }
    return out;
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

  /** Damage from a cop touching the player this step; a fresh ram also bangs, and may raise the heat. */
  private copContactDamage(cop: Cop, dt: number): number {
    const contact = this.copContact.check(cop, this.chaseTarget.velocity, dt);
    if (contact.started) {
      // A ram can shove the player without a sharp velocity jump, so it gets its own bang.
      this.ramSound = Math.max(this.ramSound, impactStrength(contact.closing));
      // The player drove into the cop (not just got rammed): assaulting an officer raises the heat.
      if (contact.whack > WHACK_SPEED && this.state === 'playing') this.raiseStars(this.wanted.copWhacked(contact.whack));
    }
    return contact.damage * this.difficulty.damageScale;
  }
  /** Into the sea or a canal: a splash, the car sinks, and that's the run over. */
  private drown(): void {
    const body = this.player.body;
    const v = body.linvel();
    this.effects.splash(this.player.position.clone().setY(SEA_LEVEL), new THREE.Vector3(v.x, 0, v.z));
    // Water drag: it slows hard and settles slowly into the deep.
    body.setLinearDamping(3);
    body.setAngularDamping(2);
    this.player.lightsOff = true;
    this.chase.shake(0.6);
    this.audio.stopEngine();
    this.audio.impact(0.8);
    this.mission.fail('drowned');
    this.endMission();
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
    this.effects.explode(at, { fireball: 90, smoke: 60, fire: 30, flash: 4000 });
    this.chase.shake(1.6);

    this.audio.stopEngine();
    this.audio.explosion();
    this.mission.fail('destroyed');
    this.endMission();
  }

  /** The ramp truck for the minimap: where it is and which way it launches you. */
  private rampTruckOnMap(): { x: number; z: number; yaw: number } | null {
    const truck = this.traffic.rampTruck?.vehicle;
    if (!truck) return null;
    const f = truck.forward();
    return { x: truck.position.x, z: truck.position.z, yaw: Math.atan2(f.x, f.z) };
  }

  /** Scratch a car's paint where an impact (velocity change, m/s) struck it. */
  private scratch(vehicle: Vehicle, impact: number): void {
    if (impact > 0) scratchCar(vehicle, vehicle.impactPush, Math.min(1, impact / 15));
  }

  /** Smashing through street furniture scuffs the front (or whichever way the car was going). */
  private scratchOnProps(vehicle: Vehicle, hits: PropBreak[]): PropBreak[] {
    if (hits.length) {
      const v = vehicle.body.linvel();
      scratchCar(vehicle, new THREE.Vector3(v.x, 0, v.z), 0.15 * hits.length);
    }
    return hits;
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
    this.effects.explode(at, { fireball: 60, smoke: 40, fire: 0, flash: 3000 });
    const dist = at.distanceTo(this.player.position);
    this.chase.shake(Math.max(0, 1 - dist / 60));
    this.audio.explosion(Math.max(0.15, 1 - dist / 200));
    this.hud.toast('COP WRECKED!', 1.5);
  }

  private showDestination(): void {
    const target = this.mission.current;
    if (!target) return;
    this.marker.show(target.x, this.ground(target.x, target.z), target.z, this.mission.index === this.mission.total - 1);
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
    const showDelay = reason === 'destroyed' ? 2000 : reason === 'drowned' ? 1500 : 0;
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
        title: won ? 'YOU MADE IT!' : reason === 'destroyed' ? 'WRECKED' : reason === 'drowned' ? 'SLEEPING WITH THE FISHES' : "TIME'S UP",
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

  private updatePropBreaks(breaks: PropBreak[]): void {
    for (const b of breaks) {
      if (this.state === 'playing') this.raiseStars(this.wanted.propSmashed());
      this.audio.propBreak(b.kind, b.strength, b.tree);
      this.effects.propBreak(b);
    }
  }

  /** How loud another car's crash sounds at the player: impact strength fading with distance. */
  private crashLoudness(vehicle: Vehicle, hit: number): number {
    const near = THREE.MathUtils.clamp(1 - vehicle.position.distanceTo(this.player.position) / 150, 0, 1);
    return impactStrength(hit) * near * near;
  }

  private updateCrashAudio(dt: number, impact: number, crashSound: number): void {
    const p = this.player;
    const playerCrash = Math.max(impact > 0 ? impactStrength(impact) : 0, this.ramSound);
    this.ramSound = 0;
    this.audio.impact(Math.max(playerCrash, crashSound));
    this.audio.update(dt, { speed: p.speed, throttle: p.lastInput.throttle, skid: p.skid, maxSpeed: p.spec.maxSpeed });
  }
}

/** F: enter/leave fullscreen (still within the key press's user activation, so browsers allow it). */
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Impact = velocity change (or closing speed) in m/s: ~3 is a scrape, 40+ is a full-speed hit. */
function impactStrength(speed: number): number {
  return THREE.MathUtils.clamp((speed - 1.5) / 20, 0.1, 1);
}
