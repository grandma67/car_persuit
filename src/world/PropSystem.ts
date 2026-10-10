import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vehicle } from '../vehicles/Vehicle';
import type { CityData } from './CityGenerator';
import { PROP_SPECS, footprintsOverlap, propFootprint, type Footprint, type PropKind, type StreetProp } from './StreetProps';

const GRID_CELL = 10; // metres, spatial hash for vehicle-vs-prop checks
const LAMP_HEAD = new THREE.Vector3(0, 5.8, 1.3); // bulb position in lamp space
const LIGHT_POOL_RADIUS = 7;
const UP = new THREE.Vector3(0, 1, 0);

export interface PropBreak {
  kind: PropKind;
  position: THREE.Vector3;
  strength: number; // 0..1 from impact speed
}

interface PropState {
  def: StreetProp;
  body: RAPIER.RigidBody;
  broken: boolean;
  instance: number; // index within its kind's instanced meshes
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

function buildModels(): Record<PropKind, THREE.BufferGeometry> {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg);
  const metal = 0x3a3f47;
  const wood = 0x8a5a33;
  const iron = 0x2a2d33;
  const red = 0xc8202a;
  const white = 0xe8e4da;

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
  return { lamp, hydrant, bench, fence };
}

function lightPoolTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Street furniture: solid when nudged slowly, knocked loose (becomes a dynamic body) when a vehicle
// arrives fast enough. Detection runs a step ahead of contact so smashing through doesn't feel
// like hitting a wall.
export class PropSystem {
  private props: PropState[] = [];
  private grid = new Map<string, number[]>();
  private meshes = {} as Record<PropKind, THREE.InstancedMesh>;
  private bulbs: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private lampIndex = new Map<number, number>(); // prop index → lamp instance (bulbs/pools)
  private moving = new Set<number>(); // broken props whose body is still awake
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(city: CityData, scene: THREE.Scene, world: RAPIER.World) {
    const models = buildModels();
    const counts: Record<PropKind, number> = { lamp: 0, hydrant: 0, bench: 0, fence: 0 };
    for (const p of city.streetProps) counts[p.kind]++;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
    for (const kind of Object.keys(models) as PropKind[]) {
      const mesh = new THREE.InstancedMesh(models[kind], material, counts[kind]);
      mesh.castShadow = kind !== 'fence'; // thousands of fence pickets aren't worth the shadow pass
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[kind] = mesh;
      scene.add(mesh);
    }

    // Lamp bulbs (unlit, so they glow) and soft light pools on the ground beneath them.
    this.bulbs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.38, 0.05, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      counts.lamp,
    );
    this.pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(LIGHT_POOL_RADIUS * 2, LIGHT_POOL_RADIUS * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: lightPoolTexture(),
        color: 0xffc98a,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      counts.lamp,
    );
    for (const mesh of [this.bulbs, this.pools]) {
      mesh.frustumCulled = false;
      scene.add(mesh);
    }

    const next: Record<PropKind, number> = { lamp: 0, hydrant: 0, bench: 0, fence: 0 };
    const warm = new THREE.Color(0xffe2b0);
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
      const instance = next[def.kind]++;
      this.props.push({ def, body, broken: false, instance });

      this.m4.compose(this.v.set(def.x, 0, def.z), this.q, this.one);
      this.meshes[def.kind].setMatrixAt(instance, this.m4);
      if (def.kind === 'lamp') {
        this.lampIndex.set(i, instance);
        this.bulbs.setMatrixAt(instance, this.m4.clone().multiply(new THREE.Matrix4().makeTranslation(LAMP_HEAD)));
        this.bulbs.setColorAt(instance, warm);
        const head = LAMP_HEAD.clone().setY(0.06).applyQuaternion(this.q);
        this.pools.setMatrixAt(instance, new THREE.Matrix4().makeTranslation(def.x + head.x, 0.06, def.z + head.z));
      }

      // Spatial hash over the cells the footprint touches.
      const r = Math.max(spec.hx, spec.hz);
      for (let cx = Math.floor((def.x - r) / GRID_CELL); cx <= Math.floor((def.x + r) / GRID_CELL); cx++) {
        for (let cz = Math.floor((def.z - r) / GRID_CELL); cz <= Math.floor((def.z + r) / GRID_CELL); cz++) {
          const key = `${cx},${cz}`;
          const list = this.grid.get(key);
          if (list) list.push(i);
          else this.grid.set(key, [i]);
        }
      }
    });
  }

  get brokenCount(): number {
    return this.props.filter((p) => p.broken).length;
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
    const spin = (p.def.kind === 'lamp' ? 3 : 6) * Math.min(1, speed / 15);
    p.body.setAngvel({ x: dz * spin, y: (Math.random() - 0.5) * 4, z: -dx * spin }, true);

    const keep = 1 - spec.slowdown;
    vehicle.body.setLinvel({ x: lv.x * keep, y: lv.y, z: lv.z * keep }, true);

    if (p.def.kind === 'lamp') {
      const li = this.lampIndex.get(i)!;
      this.bulbs.setColorAt(li, new THREE.Color(0x222222)); // light goes out
      this.bulbs.instanceColor!.needsUpdate = true;
      this.pools.setMatrixAt(li, this.m4.makeScale(0, 0, 0));
      this.pools.instanceMatrix.needsUpdate = true;
    }
    this.moving.add(i);

    const t = p.body.translation();
    const y = p.def.kind === 'lamp' ? 2 : 0.5;
    return { kind: p.def.kind, position: new THREE.Vector3(t.x, y, t.z), strength: Math.min(1, speed / 30) };
  }

  /** Move debris meshes to their physics bodies. Call once per rendered frame. */
  sync(): void {
    const touched = new Set<PropKind>();
    for (const i of this.moving) {
      const p = this.props[i];
      const t = p.body.translation();
      const r = p.body.rotation();
      this.q.set(r.x, r.y, r.z, r.w);
      this.m4.compose(this.v.set(t.x, t.y, t.z), this.q, this.one);
      this.meshes[p.def.kind].setMatrixAt(p.instance, this.m4);
      if (p.def.kind === 'lamp') {
        this.bulbs.setMatrixAt(this.lampIndex.get(i)!, this.m4.multiply(new THREE.Matrix4().makeTranslation(LAMP_HEAD)));
        this.bulbs.instanceMatrix.needsUpdate = true;
      }
      touched.add(p.def.kind);
      // Debris at rest (or lost in the sea) no longer needs updating.
      if (p.body.isSleeping() || t.y < -20) this.moving.delete(i);
    }
    for (const kind of touched) this.meshes[kind].instanceMatrix.needsUpdate = true;
  }
}
