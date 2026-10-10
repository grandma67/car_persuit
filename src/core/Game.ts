import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './Input';
import { Rng } from './Rng';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';
import { ChaseCamera } from '../render/ChaseCamera';
import { buildPlayground } from '../world/Playground';
import { Hud } from '../ui/Hud';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private input = new Input();
  private chase: ChaseCamera;
  private sun: THREE.DirectionalLight;
  private player: Vehicle;
  private hud: Hud;
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

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.hud = new Hud(hudRoot);

    window.addEventListener('resize', () => {
      this.chase.resize(window.innerWidth / window.innerHeight);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const frameDt = Math.min(this.clock.getDelta(), 0.1);

    if (this.input.wasPressed('KeyR')) this.player.reset();

    // Fixed-timestep physics, rendered with interpolation for smoothness on any refresh rate.
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.player.drive(this.input.drive(), FIXED_DT);
      this.world.step();
      this.player.snapshot();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell behind; drop the backlog
    const alpha = this.accumulator / FIXED_DT;

    this.player.syncMesh(alpha);
    const carPos = this.player.mesh.root.position;
    this.sun.position.set(carPos.x + 30, carPos.y + 60, carPos.z + 20);
    this.sun.target.position.copy(carPos);

    const speedRatio = Math.min(Math.abs(this.player.speed) / this.player.spec.maxSpeed, 1);
    this.chase.update(frameDt, this.player.mesh.root, speedRatio);
    this.hud.update(this.player.speed);

    this.renderer.render(this.scene, this.chase.camera);
    this.input.endFrame();
  }
}
