import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input, type DriveInput } from './Input';
import { Rng } from './Rng';
import { safeStorage } from './storage';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { buildCarMesh, setCarEnvironment, setCarShadow, type CarMesh } from '../vehicles/carMesh';
import { createEnvironment } from '../render/Environment';
import { ChaseCamera } from '../render/ChaseCamera';
import { DEFAULT_CITY, generateCity, type CityConfig, type CityData } from '../world/CityGenerator';
import { groundHeight, type GroundHeight } from '../world/Terrain';
import { buildCity } from '../world/CityBuilder';
import { pickTheme, pickTimeOfDay, type TimeOfDayName } from '../world/CityTheme';
import { applyClimate, pickClimate, pickWeather, playerGrip, weatherLabel } from '../world/Climate';
import { Sky } from '../render/Sky';
import { Precipitation } from '../render/Precipitation';
import { CopDirector, DIRECTOR_TUNING, type Cop } from '../ai/CopDirector';
import { CivilianTraffic, civilianSpecVariants } from '../ai/CivilianTraffic';
import { approachControls, busStops, fastStreets } from '../world/TrafficControl';
import { CrashMarks } from '../render/CrashMarks';
import { Landmarks } from '../render/Landmarks';
import type { ChaseTarget } from '../ai/CopController';
import { staticLineOfSight } from '../ai/lineOfSight';
import { NavGrid } from '../ai/NavGrid';
import { PropSystem, type PropBreak } from '../world/PropSystem';
import { RoadworksSite } from '../world/RoadworksSite';
import { Hud, formatTime } from '../ui/Hud';
import { Screens } from '../ui/Screens';
import { toggleFullscreen } from '../ui/fullscreen';
import { CarAudio } from '../audio/CarAudio';
import { Effects } from '../render/Effects';
import { Sirens } from '../render/Sirens';
import { Sea, SEA_LEVEL, swellAtWall } from '../render/Sea';
import { waterNearby } from '../audio/shore';
import { PassBy } from '../audio/passBy';
import { keepOf } from '../world/driveSide';
import { scratchCar, scratchPrewarmMesh } from '../render/CarScratches';
import type { CanalWater } from '../render/CanalWater';
import { Minimap } from '../ui/Minimap';
import { Health } from '../gameplay/Health';
import { DestinationMarker } from '../render/DestinationMarker';
import { MissionSystem, pickDestinations, routeAim, type Route } from '../gameplay/MissionSystem';
import { MISSION } from '../gameplay/balance';
import { WantedSystem } from '../gameplay/WantedSystem';
import { DIFFICULTIES, difficultyById, scaledCopCap, type Difficulty } from '../gameplay/difficulty';
import { Records } from '../gameplay/Records';
import { loadPrefs, savePrefs } from '../gameplay/Prefs';
import { CopContact } from '../gameplay/CopContact';
import { RunLog, type IncidentKind } from '../gameplay/RunLog';
import { Airtime, type Takeoff } from '../gameplay/Airtime';
import { rampShape } from '../world/Landmarks';
import { RunMap } from '../ui/RunMap';
import { DISTRICT_DEFS } from '../world/districts/index';
import { copSpawnSkips, districtOfNode, districtTraffic, nightProps, roadblockGates } from '../world/districts/runtime';
import { buildDistricts, type DistrictView } from '../render/districts/index';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { COP_RAM, DAMAGE } from '../gameplay/balance';
import { GlowBatch } from '../render/GlowBatch';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 3; // more only snowballs on a slow phone: each catch-up step makes the frame slower still
const ROUTE_REFRESH = 0.25; // seconds between GPS route recalculations
const CIVILIAN_PROP_RANGE = 90; // metres: civilians nearer the player than this collide with props
const WHACK_SPEED = 3; // m/s the player must be driving into a cop for a hit to count as a ram
const SINK_DEPTH = 3; // metres under the surface a car in the water comes to rest
const NO_INPUT: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const SHADOW_HALF = 125; // metres: half the width of the sun's shadow map
const SHADOW_LEAD = 60; // metres ahead of the car to centre the shadow map, towards what the camera sees
/** On phones, other cars further than this cast no shadow (switched back on 10 m nearer, so it doesn't flicker). */
const CAR_SHADOW_RANGE = 65;

type GameState = 'menu' | 'playing' | 'paused' | 'won' | 'lost';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private input = new Input();
  private chase: ChaseCamera;
  private sun: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(); // light position relative to the centre of the shadow map
  private sunAxes = [new THREE.Vector3(), new THREE.Vector3()]; // the shadow map's x and y in the world
  private sunTexel = 0; // metres per shadow map texel
  private shadowCentre = new THREE.Vector3();
  private player: Vehicle;
  readonly city: CityData;
  private ground: GroundHeight = (x, z) => groundHeight(this.city.terrain, x, z);
  private fog: THREE.Fog;
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
  private prefs = loadPrefs(safeStorage()); // mute and difficulty, kept between sessions
  private difficulty: Difficulty = difficultyById(this.prefs.difficulty);
  private records = new Records(safeStorage());
  private touch: TouchControls | null = null;
  private destinations: ReturnType<typeof pickDestinations>;
  private look = '';
  private props: PropSystem;
  private roadworks: RoadworksSite[];
  private districtViews: DistrictView[] = [];
  private director: CopDirector;
  private wanted = new WantedSystem();
  private traffic: CivilianTraffic;
  private crashMarks = new CrashMarks();
  private sunk = new WeakSet<Vehicle>(); // cars that have gone into the water
  private walls: Set<number>; // collider handles of buildings, sea wall, landmarks
  private copContact: CopContact;
  private passBy = new PassBy(); // cars flashing past, for the whoosh
  private runLog = new RunLog(); // the route driven and what happened, for the end-screen map
  private airtime = new Airtime(); // the player's jumps, for the run log
  private rampJump = false; // the flight in progress left from a ramp
  private ramSound = 0; // a cop started ramming the player this frame: crash strength 0..1
  private landmarks: Landmarks;
  private chaseTarget: ChaseTarget = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private sirens: Sirens;
  private glows: GlowBatch;
  private glowCars: CarMesh[] = []; // reused each frame
  private mission: MissionSystem;
  private route: Route | null = null;
  private routeTimer = 0;
  private state: GameState = 'menu';
  private accumulator = 0;
  private carShadowCull = isTouchDevice(); // measured: −10% render submission on a 4× slower CPU
  private timer = new THREE.Timer(); // ticked at the top of every frame, paused or not

  constructor(container: HTMLElement, hudRoot: HTMLElement, seed: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    const mobile = isTouchDevice();
    // Cap resolution at 1.5× on every screen: a 2× retina display costs ~80% more pixels to fill
    // for detail antialiasing already smooths over (measured: render time −18% on a 2× laptop).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // three r186 dropped PCFSoftShadowMap for this
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    // The seed picks a climate, a weather, a time of day and a building style that suits the climate.
    // Overrides for testing, only with ?debug: ?city=temperate|snow|beach|desert, ?weather=clear|rain|snow.
    // a time of day (?time=day|afternoon|night) and a building style that suits the climate.
    const params = new URLSearchParams(window.location.search);
    const climate = pickClimate(seed, this.debug ? params.get('city') : null);
    const weather = pickWeather(seed, climate, this.debug ? params.get('weather') : null);
    const time = applyClimate(pickTimeOfDay(seed, params.get('time')), climate, weather);
    const theme = pickTheme(seed, climate);
    // The sky and sun as reflected by car paint, glass and rims.
    const environment = createEnvironment(this.renderer, time);
    setCarEnvironment(environment);
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
    const mapSize = mobile ? 1024 : 2048; // reading a bigger map costs the main pass more GPU than drawing it
    this.sun.shadow.mapSize.setScalar(mapSize);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -SHADOW_HALF;
    s.right = s.top = SHADOW_HALF;
    s.near = 1;
    this.sunTexel = (2 * SHADOW_HALF) / mapSize;
    this.scene.add(this.sun, this.sun.target);

    this.world.timestep = FIXED_DT;
    // ?roadworks forces every (rare) roadworks slot, ?canalramp the canal jumps and ?england left-hand traffic, for testing. With ?debug, ?canals=0|1|2 and
    // ?hill=0|1 force the terrain.
    const config: CityConfig = { ...DEFAULT_CITY };
    if (params.has('roadworks')) config.roadworksChance = 1;
    if (params.has('canalramp')) config.canalRampChance = 1;
    if (params.has('england')) config.leftHandChance = 1;
    const canals = Number.parseInt(params.get('canals') ?? '', 10);
    if (this.debug && canals >= 0 && canals <= 2) config.canalOdds = [canals === 0 ? 1 : 0, canals === 1 ? 1 : 0, canals === 2 ? 1 : 0];
    if (this.debug && params.has('hill')) config.hillChance = params.get('hill') === '0' ? 0 : 1;
    // ?oldtown=1 forces a district's roll on, =0 off (every registered district, like ?roadworks).
    const force = Object.fromEntries(
      DISTRICT_DEFS.filter((d) => params.get(d.kind) === '0' || params.get(d.kind) === '1').map((d) => [d.kind, params.get(d.kind) === '1']),
    );
    this.city = generateCity(seed, config, { force });
    // Night-only street props (Chinatown's night market and festival) join the city on a night run.
    const night = time.name === 'night';
    if (night) this.city.streetProps.push(...nightProps(this.city));
    const built = buildCity(this.city, this.scene, this.world, { theme, climate, windowGlow: time.windowGlow, wet: weather === 'rain', sea: time.sea, shallow: climate.shallow });
    this.canalWater = built.canalWater;
    this.walls = built.walls;
    this.landmarks = new Landmarks(this.city.landmarks, this.city.terrain, this.scene, this.world, time.lampGlow, this.walls, climate.snowRoofs);
    this.sea = new Sea(this.city.islandSize / 2, time.sea, climate.shallow, this.city.terrain.canals);
    this.props = new PropSystem(this.city, this.scene, this.world, time.lampGlow, built.props, {
      leaves: theme.leaves[0],
      trunk: theme.trunk,
      snowy: climate.snowRoofs,
    });
    // Shadow casters behind the shadow camera are dropped, so it must sit up-sun of the tallest
    // tower's top: a low golden-hour sun throws shadows ~3× a building's height, and towers well
    // outside the map's footprint shade the streets in it. Only the depth range grows, not the map.
    const tallest = Math.max(0, ...this.city.buildings.map((b) => b.h)) + (this.city.terrain.hill?.height ?? 0);
    const sunDir = new THREE.Vector3(...time.sunOffset).normalize();
    const sunDist = Math.max(100, (tallest + 10) / sunDir.y);
    this.sunOffset.copy(sunDir).multiplyScalar(sunDist);
    s.far = sunDist + 100;
    // The shadow camera looks down -sunDir with world up, as Object3D.lookAt orients it.
    new THREE.Matrix4().lookAt(sunDir, new THREE.Vector3(), new THREE.Object3D().up).extractBasis(this.sunAxes[0], this.sunAxes[1], new THREE.Vector3());
    this.districtViews = buildDistricts(this.city, this.scene, {
      theme, climate, lampGlow: time.lampGlow, night, ground: this.ground, hour0: startHour(seed, time.name),
      bell: (strikes, at) => this.audio.bell(strikes, THREE.MathUtils.clamp(1 - at.distanceTo(this.player.position) / 450, 0, 1)),
      firework: (at, colour) => this.effects.firework(at, colour),
    });
    this.roadworks = this.city.roadworks.map((site) => new RoadworksSite(site, this.city.terrain, this.scene, this.world, this.walls));

    const { spawn } = this.city;
    this.player = new Vehicle(this.world, PLAYER_SPEC, { x: spawn.x, y: this.ground(spawn.x, spawn.z) + 1.2, z: spawn.z }, spawn.yaw);
    this.player.gearShifts = true;
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
    this.destinations = pickDestinations(this.city.graph, new Rng(seed ^ 0xde57), startNode.id, undefined, (id) => districtOfNode(this.city, id));
    this.mission = new MissionSystem(this.destinations, { ...MISSION, timeLimit: this.difficulty.timeLimit });

    this.director = new CopDirector(this.world, this.scene, this.city.graph, staticLineOfSight(this.world, this.ground), new Rng(seed ^ 0xc095), this.player.headlights, DIRECTOR_TUNING, this.ground, keepOf(this.city.driveSide), {
      nav: new NavGrid(this.city, built.props),
      ignore: (collider) => collider.parent()?.handle === this.player.body.handle,
    }, { skipAt: copSpawnSkips(this.city), gates: roadblockGates(this.city) });
    this.traffic = new CivilianTraffic(
      this.world,
      this.scene,
      this.city.graph,
      approachControls(this.city.graph, this.city.streetProps),
      new Rng(seed ^ 0x7a4f1c),
      this.player.headlights,
      this.ground,
      keepOf(this.city.driveSide),
      fastStreets(this.city.graph, this.city.streetProps),
      busStops(this.city.graph, this.city.streetProps),
      districtTraffic(this.city),
    );
    this.scene.add(this.crashMarks.mesh);
    this.sirens = new Sirens(this.scene);
    this.glows = new GlowBatch(this.scene);
    this.copContact = new CopContact(this.world, this.player);

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.minimap = new Minimap(this.city);
    this.hud = new Hud(hudRoot, this.minimap.canvas);
    this.audio.setMuted(this.prefs.muted);
    this.hud.setMuted(this.prefs.muted);
    this.hud.setWantedVisible(this.difficulty.police);
    if (this.debug) this.hud.showFps();
    this.screens = new Screens(document.body, (kind) => this.audio.uiBlip(kind));
    const england = this.city.driveSide === 'left' ? 'England · drive on the left' : null;
    this.look = [england, climate.name === 'temperate' ? null : climate.label, theme.name, time.label, weatherLabel(weather) || null]
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
    this.timer.connect(document); // no huge first frame back from a hidden tab
    this.timer.reset();
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
    this.prefs.difficulty = this.difficulty.id;
    savePrefs(safeStorage(), this.prefs);
    this.hud.setWantedVisible(this.difficulty.police);
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
    this.hud.setWantedVisible(d.police);
    this.touch?.setVisible(true);
    this.audio.unlock();
    this.audio.menuMusic(false);
    this.audio.startEngine();
    this.audio.uiBlip('click');
    this.screens.hide();
    this.showDestination();
    this.hud.toast(this.city.driveSide === 'left' ? 'GO!  ·  ENGLAND: KEEP LEFT' : 'GO!', this.city.driveSide === 'left' ? 2.5 : 1.2);
  }

  /**
   * Compile every shader the chase can need — each cop and civilian vehicle, crash scratches,
   * plus effects not drawn yet (smoke, fire) — while the splash is up, rather than stalling a
   * frame mid-chase the first time one appears. Call after start(), once a frame has rendered:
   * shaders are built for the scene's lights, and the headlight beams only settle on the first
   * frame.
   */
  async prewarmShaders(): Promise<void> {
    const staging = new THREE.Scene();
    for (const spec of [...Object.values(COP_SPECS), ...civilianSpecVariants()]) staging.add(buildCarMesh(spec).root);
    const scratches = scratchPrewarmMesh();
    if (scratches) staging.add(scratches);
    await Promise.all([
      this.renderer.compileAsync(staging, this.chase.camera, this.scene),
      this.renderer.compileAsync(this.scene, this.chase.camera),
    ]).catch(() => {});
  }

  /** M key or the pause menu's Mute button. Returns the new muted state. */
  private toggleMute(): boolean {
    const muted = this.audio.toggleMute();
    this.hud.setMuted(muted);
    this.prefs.muted = muted;
    savePrefs(safeStorage(), this.prefs);
    return muted;
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      // Touch has no M/F keys, so the pause menu offers mute and fullscreen buttons instead.
      const touchExtras = this.touch && {
        muted: this.audio.isMuted,
        onMute: () => this.toggleMute(),
      };
      this.screens.pause(this.city.seed, () => this.setPaused(false), () => this.restart(this.city.seed), touchExtras);
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this.screens.hide();
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
    if (pressed('KeyR') && this.state === 'playing') {
      this.player.reset();
      this.airtime.cancel();
    }
    if (pressed('KeyM')) this.toggleMute();
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
      if (pressed('KeyT') && target && this.state === 'playing') {
        this.player.teleport(target.x, this.ground(target.x, target.z) + 1.2, target.z, 0);
        this.airtime.cancel();
      }
      if (pressed('KeyY') && this.state === 'playing') this.mission.elapsed = MISSION.timeLimit - 3;
      if (pressed('KeyK') && this.state === 'playing') this.raiseStars(this.wanted.bump());
    }
  }

  /**
   * Centre the shadow map ahead of the car, where the camera looks, and move it in whole texels:
   * sliding it smoothly re-samples every static shadow each frame, which made their edges crawl.
   */
  private updateSun(carPos: THREE.Vector3): void {
    const look = this.chase.camera.getWorldDirection(this.shadowCentre);
    look.y = 0;
    const centre = look.normalize().multiplyScalar(SHADOW_LEAD).add(carPos);
    for (const axis of this.sunAxes) {
      const d = centre.dot(axis);
      centre.addScaledVector(axis, Math.floor(d / this.sunTexel) * this.sunTexel - d);
    }
    this.sun.position.addVectors(centre, this.sunOffset);
    this.sun.target.position.copy(centre);
  }

  private frame(): void {
    // Ticked while paused too, so the frame after a pause doesn't count the paused time.
    const frameDt = Math.min(this.timer.update().getDelta(), 0.1);
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
    let impact = 0; // strongest jolt the player felt this frame (crunch, shake)
    let crashImpact = 0; // the same, less what a cop's push gave: cop contact charges that itself
    let ramDamage = 0;
    let crashSound = 0; // loudest car-on-car/wall crash heard this frame, 0..1 (strength × distance)
    const breaks: PropBreak[] = [];
    const lv = this.player.body.linvel();
    this.chaseTarget.position.copy(this.player.position);
    this.chaseTarget.velocity.set(lv.x, 0, lv.z);
    const copsChase = this.state === 'playing';
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.player.drive(driveInput, FIXED_DT);
      const now = this.timer.getElapsed();
      for (const car of this.traffic.cars) car.vehicle.drive(car.controller.update(FIXED_DT, now), FIXED_DT);
      for (const cop of this.director.cops) {
        const active = copsChase && cop.wreckedFor === null;
        cop.vehicle.drive(active ? cop.controller.update(FIXED_DT, this.chaseTarget) : NO_INPUT, FIXED_DT);
      }
      this.world.step();
      this.player.snapshot();
      const playerHit = this.player.consumeImpact();
      if (playerHit > 0 && this.markWall(this.player, playerHit) && this.state === 'playing') {
        const v = this.player.impactVelocity;
        this.logIncident('wall', `Hit a wall at ${Math.round(Math.hypot(v.x, v.z) * 3.6)} km/h`);
      }
      this.scratch(this.player, playerHit);
      impact = Math.max(impact, playerHit);
      let copDv = 0;
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
          if (this.state === 'playing' && !onRamp && car.vehicle.position.distanceTo(this.player.position) < 8) {
            this.logIncident('civilian', `Crashed into a ${car.vehicle.spec.name.toLowerCase()}`);
            this.raiseStars(this.wanted.civilianHit());
          }
        }
      }
      const smashed = this.scratchOnProps(this.player, this.props.checkVehicle(this.player, FIXED_DT));
      // A firecracker crate goes off under the car: a hop and a shove back, no damage.
      if (smashed.some((b) => b.kind === 'firecrackerCrate')) {
        const v = this.player.body.linvel();
        const m = this.player.body.mass();
        this.player.body.applyImpulse({ x: -v.x * m * 0.12, y: m * 2.2, z: -v.z * m * 0.12 }, true);
      }
      if (this.state === 'playing') this.runLog.propsSmashed += smashed.length;
      breaks.push(...smashed);
      for (const cop of this.director.cops) {
        cop.vehicle.snapshot();
        breaks.push(...this.scratchOnProps(cop.vehicle, this.props.checkVehicle(cop.vehicle, FIXED_DT)));
        if (copsChase && cop.wreckedFor === null) {
          const contact = this.copContactDamage(cop, FIXED_DT);
          ramDamage += contact.damage;
          copDv += contact.dv;
        }
        const hit = cop.vehicle.consumeImpact();
        if (hit > 0) this.markWall(cop.vehicle, hit);
        this.scratch(cop.vehicle, hit);
        if (hit > 0) crashSound = Math.max(crashSound, this.crashLoudness(cop.vehicle, hit));
        if (hit > 0 && cop.wreckedFor === null) {
          cop.health.applyImpact(hit);
          if (cop.health.destroyed) this.explodeCop(cop);
        }
      }
      crashImpact = Math.max(crashImpact, playerHit - copDv);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind; drop the backlog
    const alpha = this.accumulator / FIXED_DT;

    this.player.syncMesh(alpha);
    for (const cop of this.director.cops) cop.vehicle.syncMesh(alpha);
    for (const car of this.traffic.cars) car.vehicle.syncMesh(alpha);
    if (this.carShadowCull) this.cullCarShadows();
    this.checkWater();
    this.traffic.update(this.player.position, [this.player, ...this.director.cops.map((c) => c.vehicle)]);
    if (this.state === 'playing' && this.difficulty.police) {
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
    const nearestCop = this.sirens.update(this.timer.getElapsed(), this.director.cops, this.player.position, this.player.headlights, this.state !== 'won');
    this.audio.setSiren(this.state === 'playing' ? nearestCop : null);
    this.props.sync();
    this.props.updateSignals(this.timer.getElapsed());
    for (const works of this.roadworks) works.update(frameDt, this.timer.getElapsed());
    for (const view of this.districtViews) view.update?.(frameDt, this.timer.getElapsed(), this.chase.camera);
    const carPos = this.player.mesh.root.position;
    this.updateSun(carPos);

    if (this.state === 'playing') this.applyDamage(crashImpact, ramDamage);
    if (this.state === 'playing') this.logJumps();
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
      stars: this.difficulty.police ? this.wanted.stars : 0,
      starProgress: this.difficulty.police ? this.wanted.progress : 0,
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
    const camera = this.overview ? this.overviewCamera() : this.chase.camera;
    const cars = this.glowCars;
    cars.length = 0;
    cars.push(this.player.mesh);
    for (const cop of this.director.cops) cars.push(cop.vehicle.mesh);
    for (const car of this.traffic.cars) cars.push(car.vehicle.mesh);
    this.glows.update(cars, camera);
    this.renderer.render(this.scene, camera);
    this.input.endFrame();
  }

  private cullCarShadows(): void {
    const p = this.player.position;
    const cull = (v: Vehicle) => {
      const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      if (d < CAR_SHADOW_RANGE - 10) setCarShadow(v.mesh, true);
      else if (d > CAR_SHADOW_RANGE) setCarShadow(v.mesh, false);
    };
    for (const cop of this.director.cops) cull(cop.vehicle);
    for (const car of this.traffic.cars) cull(car.vehicle);
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
    this.runLog.sample(this.mission.elapsed, carPos.x, carPos.z, this.player.speed);
    if (event === 'reached' || event === 'won') {
      const n = this.mission.index; // already counts the one just reached
      this.logIncident('checkpoint', n === this.mission.total ? 'Final destination reached' : `Destination ${n} reached`);
    }
    if (event === 'lost' && this.mission.loseReason === 'time') this.logIncident('timeout', 'Ran out of time');
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
  private copContactDamage(cop: Cop, dt: number): { damage: number; dv: number } {
    const contact = this.copContact.check(cop, this.chaseTarget.velocity, dt);
    if (contact.started) {
      // As loud as the shove it gave: a square ram booms, a sideswipe at the same speed scrapes.
      this.ramSound = Math.max(this.ramSound, impactStrength(contact.dv));
      const kmh = Math.round(contact.closing * 3.6);
      // The player drove into the cop (not just got rammed): assaulting an officer raises the heat.
      if (contact.whack > WHACK_SPEED && this.state === 'playing') {
        this.logIncident('whack', `Rammed a ${cop.vehicle.spec.name.toLowerCase()} cop at ${kmh} km/h`, cop.vehicle.position);
        this.raiseStars(this.wanted.copWhacked(contact.whack));
      } else if (contact.dv > COP_RAM.bump && this.state === 'playing') {
        this.logIncident('rammed', `Rammed by a ${cop.vehicle.spec.name.toLowerCase()} at ${kmh} km/h`);
      }
    }
    return { damage: contact.damage * this.difficulty.damageScale, dv: contact.dv };
  }
  /**
   * Cars that go into the sea or a canal: a splash and a blast on the way in, then they come to rest
   * a few metres down (there's no sea bed to stop them). The player's run is over; a cop is
   * wrecked; a civilian sinks out of sight and the traffic manager recycles it.
   */
  private checkWater(): void {
    const under = (v: Vehicle) => v.position.y < SEA_LEVEL - 0.3;
    if (under(this.player) && !this.sunk.has(this.player)) {
      this.waterBlast(this.player, 1);
      if (this.state === 'playing') this.drown();
    }
    for (const cop of this.director.cops) {
      if (!under(cop.vehicle) || this.sunk.has(cop.vehicle)) continue;
      this.waterBlast(cop.vehicle, 0.6);
      if (cop.wreckedFor === null) {
        this.director.wreck(cop);
        this.logIncident('copWrecked', `A ${cop.vehicle.spec.name.toLowerCase()} cop went for a swim`, cop.vehicle.position);
      }
    }
    for (const car of this.traffic.cars) if (under(car.vehicle) && !this.sunk.has(car.vehicle)) this.waterBlast(car.vehicle, 0.6);
    for (const v of [this.player, ...this.director.cops.map((c) => c.vehicle)]) {
      if (!this.sunk.has(v) || v.position.y > SEA_LEVEL - SINK_DEPTH) continue;
      v.body.setGravityScale(0, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Splash, fireball and boom where a car hits the water; it slows hard and goes dark. */
  private waterBlast(vehicle: Vehicle, size: number): void {
    this.sunk.add(vehicle);
    const body = vehicle.body;
    const v = body.linvel();
    const at = vehicle.position.clone().setY(SEA_LEVEL);
    this.effects.splash(at, new THREE.Vector3(v.x, 0, v.z));
    this.effects.explode(at.setY(SEA_LEVEL + 0.8), { fireball: 90 * size, smoke: 60 * size, fire: 0, flash: 4000 * size });
    body.setLinearDamping(3);
    body.setAngularDamping(2);
    vehicle.mesh.paint.color.multiplyScalar(0.15);
    vehicle.lightsOff = true;
    const dist = at.distanceTo(this.player.position);
    this.chase.shake(size >= 1 ? 1.2 : Math.max(0, 1 - dist / 60));
    this.audio.explosion(size >= 1 ? 1 : Math.max(0.15, 1 - dist / 200));
  }

  /** The player into the water: that's the run over. */
  private drown(): void {
    this.audio.stopEngine();
    this.logIncident('drowned', 'Drove into the water');
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
    this.logIncident('wrecked', 'Car destroyed');
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
  private scratchOnProps(vehicle: Vehicle, hits: readonly PropBreak[]): readonly PropBreak[] {
    if (hits.length) {
      const v = vehicle.body.linvel();
      scratchCar(vehicle, new THREE.Vector3(v.x, 0, v.z), 0.15 * hits.length);
    }
    return hits;
  }

  /** A hard hit into something solid: scuff the wall where the car struck it. True if it was a wall. */
  private markWall(vehicle: Vehicle, impact: number): boolean {
    if (impact < 6) return false;
    const v = vehicle.impactVelocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 3) return false;
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
    if (!hit) return false;
    const point = new THREE.Vector3(p.x + (v.x / speed) * hit.timeOfImpact, p.y, p.z + (v.z / speed) * hit.timeOfImpact);
    this.crashMarks.add(point, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), Math.min(1, (impact - 6) / 25), vehicle.mesh.paint.color);
    return true;
  }

  /** Note something that happened for the end-screen map: at the player, unless placed elsewhere. */
  private logIncident(kind: IncidentKind, detail: string, at: THREE.Vector3 = this.player.position): void {
    this.runLog.add(kind, this.mission.elapsed, at.x, at.z, detail);
  }

  /** Jumps off a ramp and their landings, for the run log. Other airtime (a kerb, a hilltop) isn't logged. */
  private logJumps(): void {
    const p = this.player.position;
    const event = this.airtime.update(this.mission.elapsed, this.player.grounded, p.x, p.z, this.player.speed);
    if (event?.type === 'takeoff') {
      const ramp = this.rampAt(event);
      this.rampJump = ramp !== null;
      if (ramp) this.runLog.add('takeoff', event.t, event.x, event.z, `Jumped ${ramp} at ${Math.round(event.speed * 3.6)} km/h`);
    } else if (event?.type === 'landing' && this.rampJump) {
      this.rampJump = false;
      this.logIncident('landing', `Landed ${Math.round(event.distance)} m on, after ${event.airtime.toFixed(1)} s in the air`);
    }
  }

  /** The ramp the car took off from, described for the log, or null if it left the ground elsewhere. */
  private rampAt(off: Takeoff): string | null {
    const truck = this.traffic.rampTruck?.vehicle;
    if (truck && Math.hypot(truck.position.x - off.x, truck.position.z - off.z) < 12) return 'off the ramp truck';
    for (const l of this.city.landmarks) {
      if (l.kind !== 'ramp') continue;
      const s = rampShape(l);
      // The lip, in world space: the deck runs along the ramp's local +Z.
      const lx = l.x + Math.sin(l.yaw) * s.lip;
      const lz = l.z + Math.cos(l.yaw) * s.lip;
      if (Math.hypot(lx - off.x, lz - off.z) < s.width + 4) return l.crossing !== undefined ? 'the canal' : 'The Leap';
    }
    return null;
  }

  /** Announce a new wanted level. */
  private raiseStars(stars: number | null): void {
    if (stars === null || !this.difficulty.police) return;
    this.logIncident('stars', `Wanted level ${stars} ${'★'.repeat(stars)}`);
    const news = ['', '', 'MORE UNITS RESPONDING', 'INTERCEPTORS INBOUND', 'SUVs AND ROADBLOCKS', 'ARMORED UNITS DEPLOYED'][stars];
    this.hud.toast(`${'★'.repeat(stars)}  ${news}`, 2.5);
    this.hud.flashStars();
    this.audio.wantedUp(stars);
  }

  /** A cop car wrecked: smaller blast, launched, burns until the director clears it. */
  private explodeCop(cop: Cop): void {
    this.director.wreck(cop);
    if (this.state === 'playing') this.logIncident('copWrecked', `Wrecked a ${cop.vehicle.spec.name.toLowerCase()} cop`, cop.vehicle.position);
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
    this.audio.jingle(won ? 'won' : 'lost', this.mission.loseReason === 'destroyed' || this.mission.loseReason === 'drowned' ? 0.9 : 0);
    if (won) this.audio.playWinMusic();
    const reason = this.mission.loseReason;
    // Let an explosion play out before the end screen covers it.
    const showDelay = reason === 'destroyed' || reason === 'drowned' ? 2000 : 0;
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
    const title = won ? 'YOU MADE IT!' : reason === 'destroyed' ? 'WRECKED' : reason === 'drowned' ? 'SLEEPING WITH THE FISHES' : "TIME'S UP";
    const { map, ...run } = this.runSummary();
    const time = formatTime(this.mission.elapsed);
    const reached = `${this.mission.index} of ${this.mission.total} destinations`;
    this.screens.end(
      {
        won,
        title,
        detail: won
          ? `All ${this.mission.total} destinations in ${formatTime(this.mission.elapsed)}.`
          : `Reached ${this.mission.index} of ${this.mission.total} destinations.`,
        seed: this.city.seed,
        newBest,
        board,
        run: { map: map.el, ...run },
        share: {
          text: won ? `I beat this city in ${time}, can you?` : `I reached ${reached} in this city before it got me, can you beat it?`,
          image: map.image(won ? `BEAT IT IN ${time}` : title, `City #${this.city.seed} · ${won ? this.difficulty.label : reached} · ${run.stats}`, won),
        },
      },
      () => this.restart(this.city.seed),
      () => this.restart(Math.floor(Math.random() * 1_000_000)),
    );
  }

  /** The run traced on the city map for the end screen. */
  private runSummary(): { map: RunMap; legend: string; stats: string } {
    const log = this.runLog;
    const map = new RunMap(this.minimap, {
      log,
      destinations: this.mission.destinations,
      reached: this.mission.index,
      maxSpeed: this.player.spec.maxSpeed,
    });
    const stats = [`${(log.distance / 1000).toFixed(1)} km driven`, `top speed ${Math.round(log.topSpeed * 3.6)} km/h`];
    return { map, legend: map.legend(), stats: stats.join(' · ') };
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
    if (this.state === 'playing') this.whooshes();
    this.audio.update(dt, { speed: p.speed, throttle: p.lastInput.throttle, skid: p.skid, maxSpeed: p.spec.maxSpeed });
    const w = waterNearby(p.position.x, p.position.z, this.city.islandSize / 2, this.city.terrain.canals);
    this.audio.setWater(dt, { sea: w.sea, surge: swellAtWall(w.wallX, w.wallZ, this.sea.elapsed), canal: w.canal });
  }

  /** A whoosh for each car the player flashes past close (or that flashes past them). */
  private whooshes(): void {
    const p = this.player.position;
    const pv = this.player.body.linvel();
    const right = this.player.forward(new THREE.Vector3()).cross(new THREE.Vector3(0, 1, 0)); // forward × up
    for (const v of [...this.traffic.cars.map((c) => c.vehicle), ...this.director.cops.map((c) => c.vehicle)]) {
      const rx = v.position.x - p.x;
      const rz = v.position.z - p.z;
      if (rx * rx + rz * rz > 50 * 50) continue;
      const ov = v.body.linvel();
      const w = this.passBy.check(v, rx, rz, ov.x - pv.x, ov.z - pv.z, right.x, right.z, v.spec.mass);
      if (w) this.audio.whoosh(w.strength, w.pan, w.heavy);
    }
  }
}

/** Impact = velocity change (or closing speed) in m/s: ~3 is a scrape, 40+ is a full-speed hit. */
/** The game clock when a run starts: the time of day's hour plus some minutes from the seed. */
export function startHour(seed: number, time: TimeOfDayName): number {
  const hour = { day: 10, afternoon: 17, night: 22 }[time];
  return hour + (((seed * 2654435761) >>> 0) % 60) / 60;
}

function impactStrength(speed: number): number {
  return THREE.MathUtils.clamp((speed - 1.5) / 20, 0.1, 1);
}
