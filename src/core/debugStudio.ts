// A photo studio for headless checks (`dbg.studio` with ?debug): prop models, vehicles, zone
// buildings and district lot buildings laid out on a grid on a plain floor, away from the city, each labelled, shot from any
// angle or close up. The game keeps running underneath; the studio takes over the screen until
// `dbg.studio(false)`. Its own lights compile their own shader programs: measure `dbg.stats()` first.
import * as THREE from 'three';
import { createFacadeTextures } from '../render/Facades';
import { buildModels } from '../world/PropSystem';
import { buildingGeometry } from '../world/CityBuilder';
import type { Building, CityData, Zone } from '../world/CityGenerator';
import { ZONE_STYLE } from '../world/lots';
import { buildCarMesh } from '../vehicles/carMesh';
import {
  BOX_TRUCK_SPEC, BUS_SPEC, COP_SPECS, PICKUP_SPEC, PLAYER_SPEC, RAMP_TRUCK_SPEC, TRACTOR_SPEC, VAN_SPEC, type VehicleSpec,
} from '../vehicles/VehicleSpecs';
import { pickTheme } from '../world/CityTheme';
import { pickClimate } from '../world/Climate';
import { DISTRICT_DEFS } from '../world/districts/index';
import { Rng } from './Rng';

export interface StudioShot {
  /** Look at the whole grid (default) or the item at this index. */
  focus?: number;
  /** Compass angle the camera looks from, radians (0 = from +Z). */
  from?: number;
  /** Camera height and distance, metres; defaults fit the grid or the item. */
  height?: number;
  dist?: number;
}

interface Item {
  name: string;
  object: THREE.Object3D;
  size: THREE.Vector3; // its bounding box
}

const FLOOR = 0x9a9c9e;
const BACKDROP = 0xd8dadc;

/** A label floating over an item: white text on a dark tag, always facing the camera. */
function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,22,26,0.85)';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffffff';
  g.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50, 490);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(4, 0.75, 1);
  return s;
}

/** Vehicles by studio key (`car:<key>`): the player, each cop, and each civilian body (civilian paint). */
const CARS: Record<string, VehicleSpec> = {
  player: PLAYER_SPEC,
  'cop-patrol': COP_SPECS.patrol,
  'cop-interceptor': COP_SPECS.interceptor,
  'cop-suv': COP_SPECS.suv,
  'cop-armored': COP_SPECS.armored,
  sedan: { ...PLAYER_SPEC, body: 'sedan', color: 0x24345a },
  sports: { ...PLAYER_SPEC, body: 'sports', color: 0xc9ccd1 },
  suv: { ...COP_SPECS.suv, livery: undefined, color: 0x2f4a3a },
  van: { ...VAN_SPEC, color: 0xf0f0ee },
  pickup: { ...PICKUP_SPEC, color: 0x6e1a1f },
  bus: { ...BUS_SPEC, color: 0xd8a21c },
  boxtruck: { ...BOX_TRUCK_SPEC, color: 0xf0f0ee },
  ramptruck: { ...RAMP_TRUCK_SPEC, color: 0xe8701a },
  tractor: { ...TRACTOR_SPEC, color: 0x2f7a3a },
};

/** Default footprint (w × d, metres) of a `zone:` building: about a typical lot of that zone. */
const ZONE_LOT: Record<Zone, [number, number]> = {
  downtown: [22, 20],
  midtown: [16, 14],
  residential: [12, 10],
  industrial: [20, 16],
};

/** A car standing at rest: wheels hung at their rest length, lifted so the tyres touch y = 0. */
function parkedCar(spec: VehicleSpec): THREE.Group {
  const car = buildCarMesh(spec);
  const wy = spec.wheelY ?? 0;
  const ry = wy + (spec.rearWheelRadius ?? spec.wheelRadius) - spec.wheelRadius;
  car.wheels.forEach(({ pivot }, i) => {
    pivot.position.set(i % 2 ? -spec.wheelX : spec.wheelX, (i >= 2 ? ry : wy) - spec.suspensionRestLength, i >= 2 ? -spec.wheelZ : spec.wheelZ);
  });
  // Meshes only: the lamp glows are sprites with a box of their own, hidden or not.
  car.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  car.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) box.expandByObject(o, false);
  });
  car.root.position.y = -box.min.y;
  return car.root;
}

/** Walls (one mesh per facade style, textured as in game) and roofs of buildings on flat ground. */
function buildingGroup(city: CityData, b: Building, theme: ReturnType<typeof pickTheme>, climate: ReturnType<typeof pickClimate>): THREE.Group {
  const flat: CityData = { ...city, terrain: { hill: null, canals: [], bridges: [], land: [] }, buildings: [b] };
  const { walls, roofs } = buildingGeometry(flat, theme, climate, new Rng(city.seed));
  const group = new THREE.Group();
  for (const [facade, builder] of walls) {
    const tex = createFacadeTextures(facade, new Rng(city.seed));
    group.add(new THREE.Mesh(builder.build(true), new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: tex.surface, metalnessMap: tex.surface, roughness: 1, metalness: 1,
    })));
  }
  group.add(new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
  group.position.y = 0.3; // buildings stand 0.3 below their footing's ground
  return group;
}

/**
 * The studio's items from names: a prop model key (`dumpster`, `wreck-flipped`, `fence-torn`), a
 * prefix ending in `-` for every key that starts with it (`wreck-`), a key with a tint
 * (`couch~6a3a2a`; tinted models show white where the tint goes), or a district lot's building
 * (`lot:slums/tenement`, optionally `lot:slums/tenement@18` for its height), a vehicle
 * (`car:bus`, `car:cop-` for every cop, `car:` for all, `car:sedan~c9ccd1` repainted; keys in CARS), or
 * an ordinary city building of a zone (`zone:residential`, `zone:` for all four, then optionally
 * `@height`, `v<variant>` 0..1 for its colour, roof and trims, `=WxD` for its footprint).
 */
function makeItems(names: string[], city: CityData): Item[] {
  const models = buildModels({ leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: false });
  const keys = Object.keys(models);
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
  const params = new URLSearchParams(location.search);
  const climate = pickClimate(city.seed, params.get('city'));
  const theme = pickTheme(city.seed, climate);
  const out: Item[] = [];
  const add = (name: string, object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    out.push({ name, object, size: box.getSize(new THREE.Vector3()) });
  };
  for (const raw of names) {
    if (raw.startsWith('lot:')) {
      const [kind, rest] = raw.slice(4).split('/');
      const [lot, h] = rest.split('@');
      const def = DISTRICT_DEFS.find((d) => d.kind === kind);
      if (!def?.looks[lot]) continue;
      const b: Building = { x: 0, z: 0, w: 12, d: 10, h: Number(h) || 13, zone: 'residential', variant: 0.37, district: def.kind, lot, street: 15 };
      const group = buildingGroup(city, b, theme, climate);
      add(raw, group);
      continue;
    }
    if (raw.startsWith('car:')) {
      const [name, tint] = raw.slice(4).split('~');
      const all = Object.keys(CARS);
      const matched = name === '' || name.endsWith('-') ? all.filter((k) => k.startsWith(name)) : all.includes(name) ? [name] : [];
      for (const key of matched) {
        const spec = tint ? { ...CARS[key], color: parseInt(tint, 16) } : CARS[key];
        add(`car:${key}${tint ? `~${tint}` : ''}`, parkedCar(spec));
      }
      continue;
    }
    if (raw.startsWith('zone:')) {
      const m = /^zone:(\w*)(?:@([\d.]+))?(?:v([\d.]+))?(?:=([\d.]+)x([\d.]+))?$/.exec(raw);
      if (!m) continue;
      const zones = (Object.keys(ZONE_LOT) as Zone[]).filter((z) => !m[1] || z === m[1]);
      for (const zone of zones) {
        const [lo, hi] = ZONE_STYLE[zone].height;
        const [w, d] = m[4] ? [Number(m[4]), Number(m[5])] : ZONE_LOT[zone];
        const b: Building = { x: 0, z: 0, w, d, h: Number(m[2]) || Math.round((lo + hi) / 2), zone, variant: m[3] ? Number(m[3]) : 0.37 };
        add(m[1] ? raw : `zone:${zone}${raw.slice(5)}`, buildingGroup(city, b, theme, climate));
      }
      continue;
    }
    const [name, tint] = raw.split('~');
    const matched = name.endsWith('-') ? keys.filter((k) => k.startsWith(name)) : keys.includes(name) ? [name] : [];
    for (const key of matched) {
      const geo = models[key as keyof typeof models];
      const mesh = new THREE.InstancedMesh(geo, propMat, 1); // the props' instanced settings, so tints show as in game
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.setColorAt(0, new THREE.Color(tint ? parseInt(tint, 16) : 0xffffff));
      const holder = new THREE.Group();
      holder.add(mesh);
      // Instanced meshes have no Box3 from the object itself: measure the geometry.
      geo.computeBoundingBox();
      const size = geo.boundingBox!.getSize(new THREE.Vector3());
      out.push({ name: tint ? `${key}~${tint}` : key, object: holder, size });
    }
  }
  return out;
}

export function createStudio(city: () => CityData) {
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let items: (Item & { at: THREE.Vector3; tag: THREE.Sprite })[] = [];
  let span = 10;

  return {
    /** Lay out the items (names as in makeItems) on a grid. Returns what was laid out, with sizes. */
    open(names: string[]) {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(BACKDROP);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 2.4);
      sun.position.set(30, 60, 40);
      scene.add(sun);
      const found = makeItems(names, city());
      const cols = Math.ceil(Math.sqrt(found.length));
      const cell = Math.max(4, ...found.map((i) => Math.max(i.size.x, i.size.z))) + 3;
      span = cell * cols;
      items = found.map((it, i) => {
        const at = new THREE.Vector3(((i % cols) - (cols - 1) / 2) * cell, 0, (Math.floor(i / cols) - (Math.ceil(found.length / cols) - 1) / 2) * cell);
        it.object.position.add(at);
        scene!.add(it.object);
        const tag = label(it.name);
        const k = Math.min(3, Math.max(1, cell / 8)); // readable from the grid shots
        tag.scale.multiplyScalar(k);
        tag.position.set(at.x, it.size.y + 0.6 + 0.6 * k, at.z);
        scene!.add(tag);
        return { ...it, at, tag };
      });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(span + 40, span + 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 1 }));
      floor.position.y = -0.01;
      scene.add(floor);
      const grid = new THREE.GridHelper(span + 40, Math.round((span + 40) / 2), 0x6a6c6e, 0x7e8082);
      scene.add(grid);
      camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
      return items.map((i) => ({ name: i.name, size: i.size.toArray().map((v) => +v.toFixed(2)) }));
    },
    /** Point the camera: at the grid or one item, from an angle. */
    shoot({ focus, from = Math.PI * 0.25, height, dist }: StudioShot = {}) {
      if (!scene || !camera) return null;
      const it = focus !== undefined ? items[focus] : undefined;
      // A close-up shows its item alone: neighbours (a tower beside a house) would stand in the way.
      for (const i of items) i.object.visible = i.tag.visible = !it || i === it;
      const tallest = Math.max(0, ...items.map((i) => i.size.y)); // towers need the grid camera further out
      const target = it ? it.at.clone().setY(it.size.y / 2) : new THREE.Vector3(0, Math.max(1, tallest * 0.3), 0);
      const reach = it ? Math.max(it.size.x, it.size.y, it.size.z) * 1.6 + 2 : Math.max(span * 0.9 + 6, tallest * 1.6);
      const d = dist ?? reach;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      camera.position.set(target.x + Math.sin(from) * d, target.y + (height ?? d * 0.55), target.z + Math.cos(from) * d);
      camera.lookAt(target);
      return it?.name ?? 'grid';
    },
    view: () => (scene && camera ? { scene, camera } : null),
    close() {
      scene = camera = null;
      items = [];
    },
  };
}
