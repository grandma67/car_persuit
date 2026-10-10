import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './Input';
import { Rng } from './Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { ChaseCamera } from '../render/ChaseCamera';
import { buildPlayground } from '../world/Playground';
import { Hud } from '../ui/Hud';
import { CarAudio } from '../audio/CarAudio';
import { TireSmoke } from '../render/TireSmoke';
import { SkidMarks } from '../render/SkidMarks';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const REAR_WHEELS = [2, 3];
const SMOKE_PER_SECOND = 55; // per rear wheel at full skid

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private input = new Input();
  private chase: ChaseCamera;
  private sun: THREE.DirectionalLight;
  private player: Vehicle;
  private hud: Hud;
  private audio = new CarAudio();
  private smoke = new TireSmoke();
  private skidMarks = new SkidMarks();
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

    this.scene.background = new THREE.Color(0x1a2233);
    this.scene.fog = new THREE.Fog(0x1a2233, 80, 320);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202020, 0.9));

    // Shadow-casting sun follows the player so a small shadow frustum covers the visible area.
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -50;
    s.right = s.top = 50;
    s.near = 1;
    s.far = 150;
    this.scene.add(this.sun, this.sun.target);

    this.world.timestep = FIXED_DT;
    buildPlayground(this.scene, this.world, new Rng(seed));

    this.player = new Vehicle(this.world, PLAYER_SPEC, { x: 0, y: 1.2, z: 0 });
    this.scene.add(this.player.mesh.root);
    this.scene.add(this.skidMarks.mesh, this.smoke.points);

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.hud = new Hud(hudRoot);

    const onResize = () => {
      this.chase.resize(window.innerWidth / window.innerHeight);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.smoke.resize(window.innerHeight, this.chase.camera.fov);
    };
    onResize();
    window.addEventListener('resize', onResize);
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const frameDt = Math.min(this.clock.getDelta(), 0.1);

    if (this.input.wasPressed('KeyR')) this.player.reset();
    if (this.input.wasPressed('KeyM')) this.hud.setMuted(this.audio.toggleMute());

    // Fixed-timestep physics, rendered with interpolation for smoothness on any refresh rate.
    this.accumulator += frameDt;
    let steps = 0;
    let impact = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.player.drive(this.input.drive(), FIXED_DT);
      this.world.step();
      this.player.snapshot();
      impact = Math.max(impact, this.player.consumeImpact());
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind; drop the backlog
    const alpha = this.accumulator / FIXED_DT;

    this.player.syncMesh(alpha);
    const carPos = this.player.mesh.root.position;
    this.sun.position.set(carPos.x + 30, carPos.y + 60, carPos.z + 20);
    this.sun.target.position.copy(carPos);

    this.updateEffects(frameDt, impact);

    const speedRatio = Math.min(Math.abs(this.player.speed) / this.player.spec.maxSpeed, 1);
    this.chase.update(frameDt, this.player.mesh.root, speedRatio);
    this.smoke.resize(window.innerHeight, this.chase.camera.fov);
    this.hud.update(this.player.speed);

    this.renderer.render(this.scene, this.chase.camera);
    this.input.endFrame();
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

    // Impact = velocity change in m/s: ~3 is a scrape, 40+ is a full-speed wall hit.
    if (impact > 0) this.audio.impact(THREE.MathUtils.clamp((impact - 1.5) / 20, 0.1, 1));
    this.audio.update(dt, { speed: p.speed, throttle: p.lastInput.throttle, skid, maxSpeed: p.spec.maxSpeed });
  }
}
