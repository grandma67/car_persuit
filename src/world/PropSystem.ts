import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vehicle } from '../vehicles/Vehicle';
import type { CityData } from './CityGenerator';
import { PROP_SPECS, footprintsOverlap, propFootprint, type Footprint, type PropKind, type StreetProp } from './StreetProps';
import { signalState, type SignalLight } from './TrafficControl';

const GRID_CELL = 10; // metres, spatial hash for vehicle-vs-prop checks
const LAMP_HEAD = new THREE.Vector3(0, 5.8, 1.3); // bulb position in lamp space
const LIGHT_POOL_RADIUS = 7;
const SIGN_FACE_Y = 2.35;
const SIGNAL_HEAD_X = -3.7; // signal arm reaches over the lane along local -X
const SIGNAL_LIGHTS: [SignalLight, number, number, number][] = [
  // light, lens y, lit colour, dark colour
  ['red', 5.2, 0xff2a1a, 0x3a0d0a],
  ['yellow', 4.85, 0xffb000, 0x3a2a05],
  ['green', 4.5, 0x2aff6a, 0x0a3a1a],
];
const UP = new THREE.Vector3(0, 1, 0);

type ModelKey = 'lamp' | 'hydrant' | 'bench' | 'fence' | 'sign-stop' | 'sign-speed' | 'signal';
const modelKey = (p: StreetProp): ModelKey => (p.kind === 'sign' ? `sign-${p.variant ?? 'stop'}` : p.kind);

export interface PropBreak {
  kind: PropKind;
  position: THREE.Vector3;
  strength: number; // 0..1 from impact speed
}

/** A part drawn by another instanced mesh that rides along with the prop (bulb, sign face, lens). */
interface Attachment {
  mesh: THREE.InstancedMesh;
  index: number;
  local: THREE.Matrix4;
}

interface PropState {
  def: StreetProp;
  body: RAPIER.RigidBody;
  broken: boolean;
  key: ModelKey;
  instance: number; // index within its model's instanced mesh
  attachments: Attachment[];
  pool?: number; // lamp bulb + light-pool instance (the pool stays on the ground)
  lenses?: number; // first signal-lens instance (3 consecutive)
}

// --- Low-poly prop models. Local space: origin on the ground, +Z is the front. ---

function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildModels(): Record<ModelKey, THREE.BufferGeometry> {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg);
  const metal = 0x3a3f47;
  const wood = 0x8a5a33;
  const iron = 0x2a2d33;
  const red = 0xc8202a;
  const white = 0xe8e4da;
  const signPost = 0x9aa0a8;
  const signBack = 0x8a9098;

  const lamp = mergeGeometries([
    part(cyl(0.18, 0.4), metal, 0, 0.2),
    part(cyl(0.08, 6), metal, 0, 3),
    part(box(0.07, 0.07, 1.4), metal, 0, 5.95, 0.65),
    part(box(0.45, 0.12, 0.32), metal, 0, 5.9, 1.3),
  ]);
  const hydrant = mergeGeometries([
    part(cyl(0.22, 0.08), 0x8f1820, 0, 0.04),
    part(cyl(0.16, 0.55), red, 0, 0.32),
    part(cyl(0.2, 0.07), 0x8f1820, 0, 0.62),
    part(new THREE.SphereGeometry(0.14, 6, 4), red, 0, 0.66),
    part(box(0.5, 0.1, 0.1), 0x9aa0a8, 0, 0.42),
  ]);
  const bench = mergeGeometries([
    ...[-0.17, 0, 0.17].map((z) => part(box(1.8, 0.05, 0.14), wood, 0, 0.45, z)),
    ...[0.62, 0.82].map((y) => part(box(1.8, 0.12, 0.05), wood, 0, y, -0.27)),
    ...[-0.8, 0.8].flatMap((x) => [part(box(0.06, 0.45, 0.5), iron, x, 0.22), part(box(0.06, 0.55, 0.05), iron, x, 0.7, -0.27)]),
  ]);
  const fence = mergeGeometries([
    ...[-1.35, 1.35].map((x) => part(box(0.1, 1.0, 0.1), white, x, 0.5)),
    ...[0.35, 0.75].map((y) => part(box(2.8, 0.07, 0.04), white, 0, y)),
    ...[-0.95, -0.48, 0, 0.48, 0.95].map((x) => part(box(0.12, 0.88, 0.03), white, x, 0.44, 0.03)),
  ]);
  // Sign post with a plain metal back plate; the printed face is a separate textured attachment.
  const signBackPlate = (segments: number) =>
    part(new THREE.CircleGeometry(0.44, segments, Math.PI / segments).rotateY(Math.PI), signBack, 0, SIGN_FACE_Y, 0.05);
  const signPostGeo = () => part(cyl(0.045, SIGN_FACE_Y + 0.2), signPost, 0, (SIGN_FACE_Y + 0.2) / 2);
  const signStop = mergeGeometries([signPostGeo(), signBackPlate(8)]);
  const signSpeed = mergeGeometries([signPostGeo(), signBackPlate(24)]);
  // Signal: pole, arm over the lane, housing hanging at the arm's end.
  const signal = mergeGeometries([
    part(cyl(0.2, 0.3), iron, 0, 0.15),
    part(cyl(0.1, 5.6), iron, 0, 2.8),
    part(box(3.9, 0.12, 0.12), iron, SIGNAL_HEAD_X / 2, 5.45),
    part(box(0.42, 1.15, 0.3), 0x1d2024, SIGNAL_HEAD_X, 4.85),
    part(box(0.52, 1.25, 0.04), 0x111316, SIGNAL_HEAD_X, 4.85, -0.16), // backboard
  ]);
  return { lamp, hydrant, bench, fence, 'sign-stop': signStop, 'sign-speed': signSpeed, signal };
}

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d')!, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function lightPoolTexture(): THREE.Texture {
  return canvasTexture((g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

function signFaceTextures(): Record<'stop' | 'speed', THREE.Texture> {
  const octagon = (g: CanvasRenderingContext2D, cx: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      g.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
    }
    g.closePath();
  };
  return {
    stop: canvasTexture((g, s) => {
      g.fillStyle = '#ffffff';
      octagon(g, s / 2, s / 2);
      g.fill();
      g.fillStyle = '#c8102e';
      octagon(g, s / 2, s / 2 - 6);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = 'bold 34px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('STOP', s / 2, s / 2 + 2);
    }),
    speed: canvasTexture((g, s) => {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#c8102e';
      g.lineWidth = 13;
      g.beginPath();
      g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#111111';
      g.font = 'bold 54px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('50', s / 2, s / 2 + 3);
    }),
  };
}

// Street furniture: solid when nudged slowly, knocked loose (becomes a dynamic body) when a vehicle
// arrives fast enough. Detection runs a step ahead of contact so smashing through doesn't feel
// like hitting a wall.
export class PropSystem {
  private props: PropState[] = [];
  private grid = new Map<string, number[]>();
  private meshes = {} as Record<ModelKey, THREE.InstancedMesh>;
  private bulbs: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private lenses: THREE.InstancedMesh;
  private signals: number[] = []; // prop indices of traffic signals
  private moving = new Set<number>(); // broken props whose body is still awake
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private color = new THREE.Color();

  /** lampGlow: 0 = lamps off (daytime) … 1 = full night glow. */
  constructor(city: CityData, scene: THREE.Scene, world: RAPIER.World, lampGlow: number) {
    const models = buildModels();
    const counts = {} as Record<ModelKey, number>;
    for (const key of Object.keys(models) as ModelKey[]) counts[key] = 0;
    for (const p of city.streetProps) counts[modelKey(p)]++;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
    for (const key of Object.keys(models) as ModelKey[]) {
      const mesh = new THREE.InstancedMesh(models[key], material, Math.max(1, counts[key]));
      mesh.count = counts[key];
      mesh.castShadow = key !== 'fence'; // thousands of fence pickets aren't worth the shadow pass
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[key] = mesh;
      scene.add(mesh);
    }
    const addAttachmentMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      mesh.count = count;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };

    // Lamp bulbs (unlit, so they glow) and soft light pools on the ground beneath them.
    const lamps = counts.lamp;
    this.bulbs = addAttachmentMesh(new THREE.BoxGeometry(0.38, 0.05, 0.24), new THREE.MeshBasicMaterial({ toneMapped: false }), lamps);
    this.pools = addAttachmentMesh(
      new THREE.PlaneGeometry(LIGHT_POOL_RADIUS * 2, LIGHT_POOL_RADIUS * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: lightPoolTexture(),
        color: 0xffc98a,
        transparent: true,
        opacity: 0.32 * lampGlow,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      lamps,
    );
    this.pools.visible = lampGlow > 0;

    // Sign faces, one textured mesh per sign type.
    const faces = signFaceTextures();
    const faceMesh = {
      stop: addAttachmentMesh(
        new THREE.CircleGeometry(0.44, 8, Math.PI / 8),
        new THREE.MeshStandardMaterial({ map: faces.stop, roughness: 0.5 }),
        counts['sign-stop'],
      ),
      speed: addAttachmentMesh(
        new THREE.CircleGeometry(0.44, 24),
        new THREE.MeshStandardMaterial({ map: faces.speed, roughness: 0.5 }),
        counts['sign-speed'],
      ),
    };

    // Signal lenses (unlit so lit ones glow), three per signal head.
    this.lenses = addAttachmentMesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      counts.signal * 3,
    );

    const next = {} as Record<ModelKey, number>;
    for (const key of Object.keys(models) as ModelKey[]) next[key] = 0;
    const nextFace = { stop: 0, speed: 0 };
    let nextLens = 0;
    const warm = new THREE.Color(0xffe2b0).lerp(new THREE.Color(0xc8c8c8), 1 - lampGlow); // unlit by day

    city.streetProps.forEach((def, i) => {
      const spec = PROP_SPECS[def.kind];
      this.q.setFromAxisAngle(UP, def.yaw);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(def.x, 0, def.z)
          .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(spec.hx, spec.height / 2, spec.hz).setTranslation(0, spec.height / 2, 0).setMass(spec.mass).setFriction(0.6),
        body,
      );
      const key = modelKey(def);
      const state: PropState = { def, body, broken: false, key, instance: next[key]++, attachments: [] };
      this.props.push(state);
      const world4 = new THREE.Matrix4().compose(this.v.set(def.x, 0, def.z), this.q, this.one);
      this.meshes[key].setMatrixAt(state.instance, world4);

      const attach = (mesh: THREE.InstancedMesh, index: number, local: THREE.Matrix4, color?: THREE.Color) => {
        state.attachments.push({ mesh, index, local });
        mesh.setMatrixAt(index, world4.clone().multiply(local));
        if (color) mesh.setColorAt(index, color);
      };
      if (def.kind === 'lamp') {
        const li = (state.pool = state.instance); // lamp, bulb and pool share an index
        attach(this.bulbs, li, new THREE.Matrix4().makeTranslation(LAMP_HEAD), warm);
        const head = LAMP_HEAD.clone().applyQuaternion(this.q);
        this.pools.setMatrixAt(li, new THREE.Matrix4().makeTranslation(def.x + head.x, 0.06, def.z + head.z));
      } else if (def.kind === 'sign') {
        const variant = def.variant ?? 'stop';
        attach(faceMesh[variant], nextFace[variant]++, new THREE.Matrix4().makeTranslation(0, SIGN_FACE_Y, 0.065));
      } else if (def.kind === 'signal') {
        state.lenses = nextLens;
        this.signals.push(i);
        for (const [, y, , dark] of SIGNAL_LIGHTS) {
          attach(this.lenses, nextLens++, new THREE.Matrix4().makeTranslation(SIGNAL_HEAD_X, y, 0.16), this.color.setHex(dark));
        }
      }

      // Spatial hash over the cells the footprint touches.
      const r = Math.max(spec.hx, spec.hz);
      for (let cx = Math.floor((def.x - r) / GRID_CELL); cx <= Math.floor((def.x + r) / GRID_CELL); cx++) {
        for (let cz = Math.floor((def.z - r) / GRID_CELL); cz <= Math.floor((def.z + r) / GRID_CELL); cz++) {
          const cell = `${cx},${cz}`;
          const list = this.grid.get(cell);
          if (list) list.push(i);
          else this.grid.set(cell, [i]);
        }
      }
    });
  }

  get brokenCount(): number {
    return this.props.filter((p) => p.broken).length;
  }

  /** Run the traffic-light cycle. `time` in seconds. */
  updateSignals(time: number): void {
    let changed = false;
    for (const i of this.signals) {
      const p = this.props[i];
      if (p.broken) continue;
      const lit = signalState(p.def.axis ?? 'x', time + (p.def.phase ?? 0));
      SIGNAL_LIGHTS.forEach(([light, , on, off], k) => {
        const hex = light === lit ? on : off;
        this.lenses.getColorAt(p.lenses! + k, this.color);
        if (this.color.getHex() !== hex) {
          this.lenses.setColorAt(p.lenses! + k, this.color.setHex(hex));
          changed = true;
        }
      });
    }
    if (changed) this.lenses.instanceColor!.needsUpdate = true;
  }

  /**
   * Call after each physics step for each vehicle. Knocks loose any intact prop the vehicle is
   * about to hit fast enough, and takes a little speed off the vehicle.
   */
  checkVehicle(vehicle: Vehicle, dt: number): PropBreak[] {
    const lv = vehicle.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (speed < 2) return [];

    const fwd = vehicle.forward(this.v);
    const pos = vehicle.position;
    const margin = 0.25 + speed * dt * 1.5; // reach one step ahead
    const he = vehicle.spec.halfExtents;
    const car: Footprint = { x: pos.x, z: pos.z, hx: he.x + margin, hz: he.z + margin, yaw: Math.atan2(fwd.x, fwd.z) };

    const events: PropBreak[] = [];
    const seen = new Set<number>();
    const reach = he.z + margin;
    for (let cx = Math.floor((pos.x - reach) / GRID_CELL); cx <= Math.floor((pos.x + reach) / GRID_CELL); cx++) {
      for (let cz = Math.floor((pos.z - reach) / GRID_CELL); cz <= Math.floor((pos.z + reach) / GRID_CELL); cz++) {
        for (const i of this.grid.get(`${cx},${cz}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const p = this.props[i];
          const spec = PROP_SPECS[p.def.kind];
          if (p.broken || speed < spec.breakSpeed || !footprintsOverlap(car, propFootprint(p.def))) continue;
          events.push(this.knockLoose(i, vehicle, speed));
        }
      }
    }
    return events;
  }

  private knockLoose(i: number, vehicle: Vehicle, speed: number): PropBreak {
    const p = this.props[i];
    const spec = PROP_SPECS[p.def.kind];
    p.broken = true;
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

    // Thrown ahead of the car, slightly up, tumbling over the axis across the car's path.
    const lv = vehicle.body.linvel();
    const dx = lv.x / speed;
    const dz = lv.z / speed;
    const lift = 1.5 + Math.random() * 2;
    p.body.setLinvel({ x: lv.x * 1.05 + (Math.random() - 0.5) * 2, y: lift, z: lv.z * 1.05 + (Math.random() - 0.5) * 2 }, true);
    const tall = p.def.kind === 'lamp' || p.def.kind === 'signal';
    const spin = (tall ? 3 : 6) * Math.min(1, speed / 15);
    p.body.setAngvel({ x: dz * spin, y: (Math.random() - 0.5) * 4, z: -dx * spin }, true);

    const keep = 1 - spec.slowdown;
    vehicle.body.setLinvel({ x: lv.x * keep, y: lv.y, z: lv.z * keep }, true);

    // Lights go out.
    if (p.def.kind === 'lamp') {
      this.bulbs.setColorAt(p.pool!, this.color.setHex(0x222222));
      this.bulbs.instanceColor!.needsUpdate = true;
      this.pools.setMatrixAt(p.pool!, this.m4.makeScale(0, 0, 0));
      this.pools.instanceMatrix.needsUpdate = true;
    } else if (p.def.kind === 'signal') {
      SIGNAL_LIGHTS.forEach(([, , , off], k) => this.lenses.setColorAt(p.lenses! + k, this.color.setHex(off)));
      this.lenses.instanceColor!.needsUpdate = true;
    }
    this.moving.add(i);

    const t = p.body.translation();
    const y = tall ? 2 : 0.5;
    return { kind: p.def.kind, position: new THREE.Vector3(t.x, y, t.z), strength: Math.min(1, speed / 30) };
  }

  /** Move debris meshes to their physics bodies. Call once per rendered frame. */
  sync(): void {
    const touched = new Set<THREE.InstancedMesh>();
    for (const i of this.moving) {
      const p = this.props[i];
      const t = p.body.translation();
      const r = p.body.rotation();
      this.q.set(r.x, r.y, r.z, r.w);
      this.m4.compose(this.v.set(t.x, t.y, t.z), this.q, this.one);
      const mesh = this.meshes[p.key];
      mesh.setMatrixAt(p.instance, this.m4);
      touched.add(mesh);
      for (const a of p.attachments) {
        a.mesh.setMatrixAt(a.index, this.m4.clone().multiply(a.local));
        touched.add(a.mesh);
      }
      // Debris at rest (or lost in the sea) no longer needs updating.
      if (p.body.isSleeping() || t.y < -20) this.moving.delete(i);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }
}
