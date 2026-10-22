import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAMP, TRACTOR_CAB, rampHullPoints, type VehicleSpec } from './VehicleSpecs';

export interface CarMesh {
  root: THREE.Group;
  /** Everything but the wheels: pitches and rolls on the suspension (Vehicle sets its rotation). */
  body: THREE.Group;
  /** Tailpipe tips, body-local, where exhaust smoke comes out. */
  exhausts: THREE.Vector3[];
  /** Per wheel: pivot (positioned + steered) and spinners (roll about X; two on a tandem rear). Order: FL, FR, RL, RR. */
  wheels: { pivot: THREE.Group; spinners: THREE.Mesh[] }[];
  /** Brake lights: lit red when braking or not driving, dark while accelerating. */
  taillight: THREE.MeshStandardMaterial;
  headlight: THREE.MeshStandardMaterial;
  /** Soft glow sprites around the lamps, so they read at night. */
  headGlows: THREE.Sprite[];
  tailGlows: THREE.Sprite[];
  /** Amber turn indicators per side (front, rear and side repeater share a material), with glows. */
  indicators: Record<'left' | 'right', { lamp: THREE.MeshStandardMaterial; glows: THREE.Sprite[] }>;
  /** Road-lighting headlight beams, one per lamp (off by day). */
  beams: THREE.SpotLight[];
  /** Police light bar halves (red, blue), flashed by the cop code. */
  sirenLights?: { red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial; redGlow: THREE.Sprite; blueGlow: THREE.Sprite };
  /** Every glow sprite above, for GlowBatch, which draws them (the camera skips GLOW_LAYER). */
  glows: THREE.Sprite[];
  /** Body paint, darkened when wrecked. */
  paint: THREE.MeshStandardMaterial;
  /** Free this car's own geometries and materials (on despawn). */
  dispose(): void;
}

/** Car glow sprites live here: the camera never draws them one by one, GlowBatch does all at once. */
export const GLOW_LAYER = 1;

/** Sky reflection for paint, glass and rims (see Environment); set once per city, before any car is built. */
let environment: THREE.Texture | null = null;
export function setCarEnvironment(env: THREE.Texture): void {
  environment = env;
}

/** Metallic flake: a fine tiled normal map of tiny random tilts, sparkling under the clear coat. */
let flakes: THREE.Texture | null = null;
function flakeTexture(): THREE.Texture {
  if (flakes) return flakes;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    const x = Math.random() - 0.5, y = Math.random() - 0.5;
    data[i] = 128 + x * 120;
    data[i + 1] = 128 + y * 120;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  flakes = new THREE.DataTexture(data, size, size);
  flakes.wrapS = flakes.wrapT = THREE.RepeatWrapping;
  flakes.repeat.setScalar(4); // UVs are in metres: a tile every 25 cm
  flakes.generateMipmaps = true;
  flakes.minFilter = THREE.LinearMipmapLinearFilter;
  flakes.needsUpdate = true;
  return flakes;
}

/**
 * Body shell: a box with rounded edges (so the sun runs along them in a highlight) and its front
 * top edge pulled down by `noseDrop` of the half-height. Smooth normals; UVs box-projected in metres.
 */
function bodyGeometry(hx: number, hy: number, hz: number, noseDrop: number): THREE.BufferGeometry {
  const radius = Math.min(0.12, hy * 0.35);
  let geo: THREE.BufferGeometry = new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, radius);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // Bilinear, so the corners land where the old box's did: front top fully down, back and bottom not.
    const y = pos.getY(i), z = pos.getZ(i);
    pos.setY(i, y - hy * noseDrop * ((z + hz) / (2 * hz)) * ((y + hy) / (2 * hy)));
  }
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [pos.getZ(i), pos.getY(i)] : ay >= az ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv.set([u, v], i * 2);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** One built car per shape (body, size, wheels, livery, kerb side): new cars are clones of it. */
const templates = new Map<string, CarMesh>();

/**
 * A car for this spec, cloned from a cached template of its shape and given its own paint colour.
 * Building one from scratch (geometry, merging the body parts) took a frame-sized stall each
 * time a cop or civilian spawned. Clones share geometry and the materials nothing changes at run
 * time; the paint, lamps, glows and siren halves are their own, so each car still lights, flashes
 * and darkens on its own.
 */
export function buildCarMesh(spec: VehicleSpec): CarMesh {
  const { body, halfExtents, wheelRadius, rearWheelRadius, tandemRear, livery, kerb, paint } = spec;
  const door = body === 'bus' ? (kerb === 'left' ? 'left' : 'right') : null; // the kerb side only places a bus's door
  const key = JSON.stringify({ body, halfExtents, wheelRadius, rearWheelRadius, tandemRear, livery, door, paint });
  let template = templates.get(key);
  if (!template) templates.set(key, (template = createCarMesh(spec)));
  return cloneCarMesh(template, spec.color);
}

function cloneCarMesh(t: CarMesh, color: number): CarMesh {
  const root = t.root.clone();
  // The clone has the template's tree shape, so the two traversals pair each part with its copy.
  const from: THREE.Object3D[] = [];
  const to: THREE.Object3D[] = [];
  t.root.traverse((o) => from.push(o));
  root.traverse((o) => to.push(o));
  const copies = new Map(from.map((o, i) => [o, to[i]]));
  const copy = <T extends THREE.Object3D>(o: T) => copies.get(o) as T;

  const lamps: THREE.Material[] = [t.paint, t.headlight, t.taillight, t.indicators.left.lamp, t.indicators.right.lamp];
  if (t.sirenLights) lamps.push(t.sirenLights.red, t.sirenLights.blue);
  const own = new Map<THREE.Material, THREE.Material>(lamps.map((m) => [m, m.clone()]));
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite)) return;
    const m = o.material as THREE.Material;
    if (!own.has(m) && !(o instanceof THREE.Sprite)) return; // shared: glass, trim, tyres…
    if (!own.has(m)) own.set(m, m.clone()); // each glow fades on its own
    o.material = own.get(m)!;
  });
  const mat = <T extends THREE.Material>(m: T) => own.get(m) as T;
  const paint = mat(t.paint);
  paint.color.setHex(color);

  // A cloned spotlight aims at a fresh copy of its target, not the one cloned into the tree.
  const beams = t.beams.map((b) => {
    const beam = copy(b);
    beam.target = copy(b.target);
    return beam;
  });

  const owned = new Set(to);
  const dispose = () => {
    // Others' layers (scratch decals) share geometry and material: free only their instance data.
    root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && !owned.has(o)) o.dispose();
    });
    for (const m of own.values()) m.dispose(); // geometry and the rest belong to the template
  };

  return {
    root,
    body: copy(t.body),
    exhausts: t.exhausts.map((v) => v.clone()),
    wheels: t.wheels.map((w) => ({ pivot: copy(w.pivot), spinners: w.spinners.map(copy) })),
    taillight: mat(t.taillight),
    headlight: mat(t.headlight),
    headGlows: t.headGlows.map(copy),
    tailGlows: t.tailGlows.map(copy),
    glows: t.glows.map(copy),
    indicators: {
      left: { lamp: mat(t.indicators.left.lamp), glows: t.indicators.left.glows.map(copy) },
      right: { lamp: mat(t.indicators.right.lamp), glows: t.indicators.right.glows.map(copy) },
    },
    beams,
    sirenLights: t.sirenLights && {
      red: mat(t.sirenLights.red),
      blue: mat(t.sirenLights.blue),
      redGlow: copy(t.sirenLights.redGlow),
      blueGlow: copy(t.sirenLights.blueGlow),
    },
    paint,
    dispose,
  };
}

// Low-poly but sharp: wedge nose, faceted canopy, spoiler, emissive lights.
// Built in chassis-local space: origin is the chassis collider centre, +Z is forward.
function createCarMesh(spec: VehicleSpec): CarMesh {
  const root = new THREE.Group();
  const { x: hx, y: hy, z: hz } = spec.halfExtents;

  // Metallic base under a glossy clear coat: the coat throws a sharp sun glint, the flakes sparkle.
  // Work vehicles (tractors, truck chassis) get a dull, rough coat with no flakes.
  const work = spec.paint === 'work';
  const paint = new THREE.MeshPhysicalMaterial({
    color: spec.color,
    metalness: work ? 0.15 : 0.75,
    roughness: work ? 0.65 : 0.4,
    normalMap: work ? null : flakeTexture(),
    normalScale: new THREE.Vector2(0.25, 0.25),
    clearcoat: work ? 0.25 : 1,
    clearcoatRoughness: work ? 0.5 : 0.06,
    envMap: environment,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x111822, metalness: 0.9, roughness: 0.08, flatShading: true, envMap: environment });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, flatShading: true });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.9, roughness: 0.25, flatShading: true, envMap: environment });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0x5a0a10, emissive: 0xff1a28, emissiveIntensity: 0 });
  const glowTexture = sharedGlowTexture();
  const glow = (color: number, size: number) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    s.scale.setScalar(size);
    s.layers.set(GLOW_LAYER);
    return s;
  };
  const headGlows: THREE.Sprite[] = [];
  const tailGlows: THREE.Sprite[] = [];
  const indicatorLamp = () => new THREE.MeshStandardMaterial({ color: 0x6a4410, emissive: 0xff7a00, emissiveIntensity: 0 });
  const indicators: CarMesh['indicators'] = {
    left: { lamp: indicatorLamp(), glows: [] },
    right: { lamp: indicatorLamp(), glows: [] },
  };

  const body = spec.body ?? 'sports';
  // Body: a box with the front top edge pulled down — a sharp wedge for sports cars, a gentle
  // bonnet slope for sedans/SUVs, flat-fronted for trucks and buses.
  const noseDrop = { sports: 0.85, sedan: 0.7, suv: 0.3, truck: 0, van: 0.35, pickup: 0.3, bus: 0, boxtruck: 0, ramptruck: 0, tractor: 0.2 }[body];
  const tall = body === 'bus' || body === 'boxtruck';
  // The box truck is drawn as a cab plus a cargo box instead (below).
  if (body !== 'boxtruck') {
    const bodyGeo = bodyGeometry(hx, hy, hz, noseDrop);
    root.add(new THREE.Mesh(bodyGeo, body === 'ramptruck' ? trim : paint));
  }
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };

  // Hangs 2 cm below the body: flush bottoms z-fight (seen on a car lying on its roof).
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.04, 0.12, hz * 2 - 0.3), trim);
  skirt.position.y = -hy + 0.04;
  root.add(skirt);

  // Cabin / glasshouse and the body's own extras; each returns where the roof ends up (for the light bar).
  const parts: BodyParts = { spec, root, hx, hy, hz, noseDrop, paint, trim, glass, box };
  let roof: number;
  switch (body) {
    case 'truck': roof = armoredTruck(parts); break;
    case 'bus': roof = bus(parts); break;
    case 'boxtruck': roof = boxTruck(parts); break;
    case 'van': roof = van(parts); break;
    case 'pickup': roof = pickup(parts); break;
    case 'ramptruck': roof = rampTruck(parts); break;
    case 'suv': roof = suv(parts); break;
    case 'tractor': roof = tractor(parts); break;
    case 'sedan':
    case 'sports': roof = canopyCar(parts, body); break;
  }

  for (const x of [-0.65, 0.65]) {
    // The sports wedge drops the nose below the body's middle: its lamps sit lower, on the face.
    const lampY = body === 'truck' ? -hy * 0.3 : tall ? -hy * 0.6 : body === 'van' ? -hy * 0.2 : body === 'sports' ? -hy * 0.45 : 0;
    // Tail lamps low on tall bodies; the ramp truck's sit at the deck's tail lip.
    const tailY = body === 'ramptruck' ? RAMP.tail.y + 0.1 : tall ? -hy * 0.45 : hy - 0.08;
    const tailZ = body === 'ramptruck' ? RAMP.tail.z : -hz;
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.05), headlight);
    hl.position.set(x * (hx / 0.95), lampY, hz);
    root.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05), taillight);
    tl.position.set(x * (hx / 0.95), tailY, tailZ);
    const hg = glow(0xfff1d6, 1.6);
    hg.position.set(x * (hx / 0.95), lampY, hz + 0.12);
    const tg = glow(0xff2a2a, 1.0);
    tg.position.set(x * (hx / 0.95), tailY, tailZ - 0.1);
    root.add(hg, tg);
    headGlows.push(hg);
    tailGlows.push(tg);
    root.add(tl);

    // Turn indicators (+X is the car's left): front and rear just outboard of the lamps, plus a
    // repeater on the flank behind the front wheel, so a car alongside can see it too.
    const side = indicators[x > 0 ? 'left' : 'right'];
    const ix = Math.sign(x) * (Math.abs(x) * (hx / 0.95) + 0.12);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.05), side.lamp);
    front.position.set(ix, lampY - 0.1, hz + 0.01);
    // Below the tail lamp, except on the ramp truck where the deck lip sits under it.
    const rearY = tailY + (body === 'ramptruck' ? 0.12 : -0.12);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.05), side.lamp);
    rear.position.set(ix, rearY, tailZ - 0.01);
    const repeater = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.2), side.lamp);
    repeater.position.set(Math.sign(x) * (hx + 0.02), lampY, hz * 0.55);
    const fg = glow(0xffa02a, 0.9);
    fg.position.set(ix, lampY - 0.1, hz + 0.1);
    const rg = glow(0xffa02a, 0.9);
    rg.position.set(ix, rearY, tailZ - 0.1);
    side.glows.push(fg, rg);
    root.add(front, rear, repeater, fg, rg);
  }

  const tyre = (r: number, w: number) => [
    new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2),
    new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 6).rotateZ(Math.PI / 2),
  ];
  const [tireGeo, rimGeo] = tyre(spec.wheelRadius, 0.32);
  // A tractor's tall, wide rear tyres.
  const [rearTireGeo, rearRimGeo] = spec.rearWheelRadius ? tyre(spec.rearWheelRadius, 0.5) : [tireGeo, rimGeo];
  const wheels: CarMesh['wheels'] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    // A tandem rear: two wheels one behind the other, either side of the physics axle between them.
    const offsets = spec.tandemRear && i >= 2 ? [spec.tandemRear / 2, -spec.tandemRear / 2] : [0];
    const spinners = offsets.map((z) => {
      const spinner = new THREE.Mesh(i >= 2 ? rearTireGeo : tireGeo, tire);
      spinner.add(new THREE.Mesh(i >= 2 ? rearRimGeo : rimGeo, rim));
      spinner.position.z = z;
      pivot.add(spinner);
      return spinner;
    });
    root.add(pivot);
    wheels.push({ pivot, spinners });
  }

  // Lamps and rims sit flush in the body and tyres: their shadows would fall inside those anyway.
  const noShadow = new Set<THREE.Material>([headlight, taillight, rim, indicators.left.lamp, indicators.right.lamp]);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = !noShadow.has(o.material as THREE.Material);
  });
  let sirenLights: CarMesh['sirenLights'];
  if (spec.livery === 'police') {
    // Black side stripes and a roof light bar.
    const black = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, flatShading: true });
    if (body === 'sedan' || body === 'suv') {
      for (const side of [-1, 1]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, hy * 1.1, hz * 1.3), black);
        stripe.position.set(side * (hx + 0.01), -hy * 0.15, -0.1);
        root.add(stripe);
      }
    }
    const barZ = body === 'suv' ? -hz * 0.1 : body === 'truck' ? hz * 0.55 : -0.3;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.32), black);
    base.position.set(0, roof + 0.05, barZ);
    root.add(base);
    const red = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1010, emissiveIntensity: 0 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x00105a, emissive: 0x1040ff, emissiveIntensity: 0 });
    const redGlow = glow(0xff2020, 2.2);
    const blueGlow = glow(0x2060ff, 2.2);
    for (const [mat, x, g] of [[red, -0.33, redGlow], [blue, 0.33, blueGlow]] as const) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.28), mat);
      lamp.position.set(x, roof + 0.18, barZ);
      g.position.set(x, roof + 0.22, barZ);
      root.add(lamp, g);
    }
    sirenLights = { red, blue, redGlow, blueGlow };
  }

  // A spotlight from each lamp, toed out a little: two pools of light on the road that overlap
  // in the middle, like real headlights.
  const beams = [-1, 1].map((side) => {
    const x = side * 0.65 * (hx / 0.95);
    const beam = new THREE.SpotLight(0xfff1d6, 0, 75, 0.42, 0.5, 1.3);
    beam.position.set(x, 0.1, hz);
    beam.target.position.set(x + side * 1.6, -1.2, hz + 25);
    // Hidden until Vehicle.updateLights turns it on: a spawning car must not flash an extra light
    // into the scene for a frame, which would make three.js recompile every lit material (a hitch).
    beam.visible = false;
    root.add(beam, beam.target);
    return beam;
  });

  // Tailpipes under the rear bumper: twin on the sports car, one on the right otherwise. The
  // ramp truck's rear is its deck, so it gets an upright stack on the cab instead.
  const pipe = new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 0.9, roughness: 0.3 });
  const soot = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  let exhausts: THREE.Vector3[];
  if (body === 'ramptruck') {
    // Up the right side of the cab, clear of the deck cars launch off.
    const { z0, z1, top } = RAMP.cab;
    const x = -RAMP.halfWidth - 0.12;
    const z = z0 + (z1 - z0) * 0.25;
    const length = top + 0.5 - hy;
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, length, 10), pipe);
    stack.position.set(x, hy + length / 2, z);
    root.add(stack);
    exhausts = [new THREE.Vector3(x, top + 0.55, z)];
  } else {
    const pipeGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.24, 10).rotateX(Math.PI / 2);
    const sootGeo = new THREE.CircleGeometry(0.04, 10).rotateY(Math.PI);
    const pipeY = -hy + 0.1;
    const pipeZ = -hz - 0.06;
    exhausts = (body === 'sports' ? [0.42, -0.42] : [-0.5]).map((f) => {
      const x = f * hx;
      const p = new THREE.Mesh(pipeGeo, pipe);
      p.position.set(x, pipeY, pipeZ);
      const hole = new THREE.Mesh(sootGeo, soot);
      hole.position.set(x, pipeY, pipeZ - 0.121);
      root.add(p, hole);
      return new THREE.Vector3(x, pipeY, pipeZ - 0.15);
    });
  }

  // Body on its own group, so it can pitch and roll on the suspension while the wheels stay put.
  const bodyGroup = new THREE.Group();
  const pivots = new Set<THREE.Object3D>(wheels.map((w) => w.pivot));
  for (const child of [...root.children]) if (!pivots.has(child)) bodyGroup.add(child);
  mergeByMaterial(bodyGroup);
  root.add(bodyGroup);

  // Only what this function built: other code hangs shared decals on the body (CarScratches).
  const owned = new Set<THREE.Object3D>();
  root.traverse((o) => owned.add(o));
  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((o) => {
      // Others' layers (scratch decals) share geometry and material: free only their instance data.
      if (o instanceof THREE.InstancedMesh && !owned.has(o)) o.dispose();
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite) || !owned.has(o)) return;
      geometries.add(o.geometry);
      materials.add(o.material as THREE.Material);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose(); // textures (glow, chevrons) are shared: left alone
  };

  const glows: THREE.Sprite[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Sprite) glows.push(o);
  });
  return { root, body: bodyGroup, exhausts, wheels, taillight, headlight, headGlows, tailGlows, glows, indicators, beams, paint, sirenLights, dispose };
}

/**
 * Bake the body's fixed parts into one mesh per material (and shadow setting): a car is ~35
 * separate parts, and every one cost a draw call, twice with shadows. Lamps keep their own
 * materials, so they still light up independently.
 */
function mergeByMaterial(group: THREE.Group): void {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || child.children.length) continue;
    const material = child.material as THREE.Material;
    const key = `${material.uuid}|${child.castShadow}|${child.receiveShadow}`;
    const list = buckets.get(key);
    if (list) list.push(child);
    else buckets.set(key, [child]);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const material = meshes[0].material as THREE.MeshStandardMaterial;
    const keep = material.map || material.normalMap ? ['position', 'normal', 'uv'] : ['position', 'normal'];
    const parts = meshes.map((m) => {
      m.updateMatrix();
      let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (g.index) g = g.toNonIndexed();
      for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
      g.clearGroups();
      return g;
    });
    const merged = new THREE.Mesh(mergeGeometries(parts)!, material);
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    for (const p of parts) p.dispose();
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    group.add(merged);
  }
}

const shadowState = new WeakMap<CarMesh, { casters: THREE.Object3D[]; on: boolean }>();
/**
 * Switch a car's shadow on or off (its parts that cast one). Every part is a draw call in the
 * shadow pass, and a car far off casts a shadow a few pixels big.
 */
export function setCarShadow(car: CarMesh, on: boolean): void {
  let state = shadowState.get(car);
  if (!state) {
    const casters: THREE.Object3D[] = [];
    car.root.traverse((o) => o.castShadow && casters.push(o));
    shadowState.set(car, (state = { casters, on: true }));
  }
  if (state.on === on) return;
  state.on = on;
  for (const o of state.casters) o.castShadow = on;
}

/** Fade a lamp glow; a fully faded one is hidden, so it costs no draw call (most of the day). */
export function setGlow(sprite: THREE.Sprite, opacity: number): void {
  (sprite.material as THREE.SpriteMaterial).opacity = opacity;
  sprite.visible = opacity > 0;
}

let glowCache: THREE.Texture | null | undefined;
/** What the per-body builders below draw with: the car's size, its root and shared materials. */
interface BodyParts {
  spec: VehicleSpec;
  root: THREE.Group;
  hx: number;
  hy: number;
  hz: number;
  noseDrop: number;
  paint: THREE.Material;
  trim: THREE.Material;
  glass: THREE.Material;
  /** Adds a box to the root, centred at (x, y, z). */
  box: (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
}

/** Armored truck: slit windscreen and side vision ports in the slab body, roof hatch. */
function armoredTruck({ hx, hy, hz, trim, glass, box }: BodyParts): number {
  box(hx * 1.7, hy * 0.35, 0.06, glass, 0, hy * 0.45, hz + 0.01);
  for (const side of [-1, 1]) box(0.06, hy * 0.3, hz * 0.5, glass, side * (hx + 0.01), hy * 0.45, hz * 0.45);
  box(0.9, 0.12, 0.9, trim, 0, hy + 0.06, -hz * 0.3);
  return hy;
}

/** City bus: a long window band down both sides, big windscreen, white roof, door on the kerb side. */
function bus({ spec, hx, hy, hz, trim, glass, box }: BodyParts): number {
  for (const side of [-1, 1]) box(0.04, hy * 0.6, hz * 1.7, glass, side * (hx + 0.01), hy * 0.35, -hz * 0.05);
  box(hx * 1.8, hy * 0.75, 0.04, glass, 0, hy * 0.3, hz + 0.01);
  box(hx * 1.8, 0.4, 0.04, glass, 0, hy * 0.75, -hz - 0.01);
  box(hx * 1.95, 0.08, hz * 1.95, new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6, flatShading: true }), 0, hy + 0.04, 0);
  // Door on the kerb side: right (-X), or left (+X) where traffic keeps left.
  const door = spec.kerb === 'left' ? 1 : -1;
  box(0.05, hy * 1.5, 1.1, trim, door * (hx + 0.02), -hy * 0.2, hz * 0.72);
  return hy + 0.08;
}

/** Short cab with a windscreen, tall white cargo box behind it (instead of the body shell). */
function boxTruck({ hx, hy, hz, paint, glass, box }: BodyParts): number {
  const cabLen = 1.9;
  const cabTop = hy * 0.35;
  box(hx * 2, cabTop + hy, cabLen, paint, 0, (cabTop - hy) / 2, hz - cabLen / 2);
  box(hx * 1.7, (cabTop + hy) * 0.35, 0.04, glass, 0, cabTop - (cabTop + hy) * 0.22, hz + 0.01);
  for (const side of [-1, 1]) box(0.04, (cabTop + hy) * 0.3, cabLen * 0.5, glass, side * (hx + 0.01), cabTop - (cabTop + hy) * 0.22, hz - cabLen * 0.4);
  const cargo = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7, flatShading: true });
  box(hx * 2.04, hy * 2, hz * 2 - cabLen - 0.15, cargo, 0, 0, -cabLen / 2 - 0.075);
  return hy;
}

/** Tall glasshouse almost the length of the van. */
function van({ hx, hy, hz, glass, box }: BodyParts): number {
  box(hx * 1.9, hy * 0.55, 0.04, glass, 0, hy * 0.5, hz - 0.15);
  for (const side of [-1, 1]) box(0.04, hy * 0.45, hz * 1.2, glass, side * (hx + 0.01), hy * 0.5, hz * 0.05);
  return hy;
}

/** A tractor: the bonnet is the body; a cab on four posts over the rear axle, glass all round, a roof, an exhaust stack. */
function tractor({ hx, hy, hz, paint, trim, glass, box }: BodyParts): number {
  const top = hy + TRACTOR_CAB;
  const z0 = -hz * 0.95, z1 = -hz * 0.05; // the cab, over the rear wheels
  for (const x of [-1, 1]) for (const z of [z0, z1]) box(0.08, TRACTOR_CAB - 0.1, 0.08, trim, x * (hx - 0.05), hy + (TRACTOR_CAB - 0.1) / 2, z);
  box(hx * 1.85, TRACTOR_CAB - 0.35, 0.03, glass, 0, hy + (TRACTOR_CAB - 0.35) / 2 + 0.1, z1);
  for (const x of [-1, 1]) box(0.03, TRACTOR_CAB - 0.5, z1 - z0 - 0.1, glass, x * (hx - 0.05), hy + (TRACTOR_CAB - 0.5) / 2 + 0.2, (z0 + z1) / 2);
  box(hx * 2.1, 0.1, z1 - z0 + 0.3, paint, 0, top - 0.05, (z0 + z1) / 2);
  box(0.1, 0.9, 0.1, trim, -hx * 0.5, hy + 0.45, hz * 0.6); // the exhaust stack
  return top;
}

/** Cab up front, open bed with low walls behind. */
function pickup({ hx, hy, hz, paint, glass, box }: BodyParts): number {
  box(hx * 1.86, 0.7, hz * 0.62, glass, 0, hy + 0.35, hz * 0.12);
  box(hx * 1.9, 0.06, hz * 0.64, paint, 0, hy + 0.72, hz * 0.12);
  for (const side of [-1, 1]) box(0.08, 0.3, hz * 0.8, paint, side * (hx - 0.04), hy + 0.15, -hz * 0.58);
  box(hx * 2, 0.3, 0.08, paint, 0, hy + 0.15, -hz + 0.04);
  return hy + 0.75;
}

/** Cab in the paint colour; the tilted deck in dark steel with yellow/black chevrons on top. */
function rampTruck({ spec, root, hy, paint, glass, box }: BodyParts): number {
  const { z0, z1, top } = RAMP.cab;
  box(RAMP.halfWidth * 2, top - hy, z1 - z0, paint, 0, (top + hy) / 2, (z0 + z1) / 2);
  box(RAMP.halfWidth * 1.7, (top - hy) * 0.4, 0.04, glass, 0, top - (top - hy) * 0.3, z1 + 0.01);
  for (const side of [-1, 1]) box(0.04, (top - hy) * 0.35, (z1 - z0) * 0.5, glass, side * (RAMP.halfWidth + 0.01), top - (top - hy) * 0.3, z1 - (z1 - z0) * 0.3);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.7, roughness: 0.45, flatShading: true });
  // Drawn 1 cm inside the body's sides and floor, which it would otherwise share and flicker against.
  const hull = pointsOf(rampHullPoints(spec)).map((p) => p.set(p.x * (1 - 0.01 / RAMP.halfWidth), p.y <= -hy ? p.y + 0.01 : p.y, p.z));
  root.add(new THREE.Mesh(new ConvexGeometry(hull), steel));
  const run = RAMP.top.z - RAMP.tail.z;
  const rise = RAMP.top.y - RAMP.tail.y;
  // Flat, facing up, texture-top toward the front; then tilted to the deck slope.
  const deckGeo = new THREE.PlaneGeometry(RAMP.halfWidth * 2, Math.hypot(run, rise)).rotateX(-Math.PI / 2).rotateY(Math.PI);
  const chevrons = sharedChevronTexture();
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ map: chevrons, color: chevrons ? 0xffffff : 0xf2c12e, roughness: 0.7 }));
  deck.rotation.x = -Math.atan2(rise, run);
  deck.position.set(0, (RAMP.tail.y + RAMP.top.y) / 2 + 0.02, (RAMP.tail.z + RAMP.top.z) / 2);
  deck.receiveShadow = true;
  root.add(deck);
  return top;
}

/** Boxy glass cabin under a painted roof panel. */
function suv({ hx, hy, hz, paint, glass, box }: BodyParts): number {
  box(hx * 1.86, 0.72, hz * 1.25, glass, 0, hy + 0.36, -hz * 0.18);
  box(hx * 1.9, 0.06, hz * 1.27, paint, 0, hy + 0.74, -hz * 0.18);
  return hy + 0.77;
}

/** Faceted canopy, set slightly back; taller and longer on a sedan. Sports cars add a rear spoiler. */
function canopyCar({ root, hx, hy, hz, noseDrop, paint, trim, glass, box }: BodyParts, body: 'sedan' | 'sports'): number {
  const sedan = body === 'sedan';
  const cabinGeo = new THREE.CylinderGeometry(0.75, 1.0, sedan ? 0.6 : 0.5, 4, 1);
  cabinGeo.rotateY(Math.PI / 4);
  cabinGeo.scale(1.15, 1, sedan ? 1.85 : 1.6);
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.position.set(0, hy + (sedan ? 0.28 : 0.23), sedan ? -0.2 : -0.3);
  // The nose slopes down under the canopy: drop its bottom edge onto the body's top line (3 cm
  // into it), or the windscreen floats above the bonnet.
  const pos = cabinGeo.attributes.position;
  const bottom = Math.min(...Array.from({ length: pos.count }, (_, i) => pos.getY(i)));
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > bottom + 1e-6) continue;
    const z = pos.getZ(i) + cabin.position.z;
    const top = hy - hy * noseDrop * ((z + hz) / (2 * hz));
    pos.setY(i, top - 0.03 - cabin.position.y);
  }
  cabinGeo.computeVertexNormals();
  root.add(cabin);
  if (body === 'sports') {
    box(hx * 2 - 0.1, 0.08, 0.35, paint, 0, hy + 0.3, -hz + 0.15);
    for (const x of [-0.6, 0.6]) box(0.08, 0.3, 0.12, trim, x, hy + 0.15, -hz + 0.2);
  }
  return hy + (sedan ? 0.58 : 0.48);
}


/** One glow texture shared by every car; none in headless tests (no DOM). */
export function sharedGlowTexture(): THREE.Texture | null {
  if (glowCache === undefined) glowCache = typeof document === 'undefined' ? null : glowSpriteTexture();
  return glowCache;
}

function pointsOf(xyz: Float32Array): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < xyz.length; i += 3) out.push(new THREE.Vector3(xyz[i], xyz[i + 1], xyz[i + 2]));
  return out;
}

let chevronCache: THREE.Texture | null | undefined;
/** Yellow/black chevrons pointing up the ramp deck; none in headless tests. */
function sharedChevronTexture(): THREE.Texture | null {
  if (chevronCache === undefined) chevronCache = typeof document === 'undefined' ? null : chevronTexture();
  return chevronCache;
}

function chevronTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#f2c12e';
  // Canvas top is the deck's far (launch) end, so the chevrons point up the canvas.
  for (let y = -32; y < 256; y += 64) {
    g.beginPath();
    g.moveTo(0, y + 40);
    g.lineTo(32, y + 8);
    g.lineTo(64, y + 40);
    g.lineTo(64, y + 64);
    g.lineTo(32, y + 32);
    g.lineTo(0, y + 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowSpriteTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
