import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RAMP, rampHullPoints, type VehicleSpec } from './VehicleSpecs';

export interface CarMesh {
  root: THREE.Group;
  /** Per wheel: pivot (positioned + steered) and spinner (rolls about X). Order: FL, FR, RL, RR. */
  wheels: { pivot: THREE.Group; spinner: THREE.Mesh }[];
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
  /** Body paint, darkened when wrecked. */
  paint: THREE.MeshStandardMaterial;
}

// Low-poly but sharp: wedge nose, faceted canopy, spoiler, emissive lights.
// Built in chassis-local space: origin is the chassis collider centre, +Z is forward.
export function buildCarMesh(spec: VehicleSpec): CarMesh {
  const root = new THREE.Group();
  const { x: hx, y: hy, z: hz } = spec.halfExtents;

  const paint = new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.6, roughness: 0.35, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x111822, metalness: 0.9, roughness: 0.1, flatShading: true });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, flatShading: true });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.8, roughness: 0.3, flatShading: true });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0x5a0a10, emissive: 0xff1a28, emissiveIntensity: 0 });
  const glowTexture = sharedGlowTexture();
  const glow = (color: number, size: number) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    s.scale.setScalar(size);
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
  const noseDrop = { sports: 1.15, sedan: 0.7, suv: 0.3, truck: 0, van: 0.35, pickup: 0.3, bus: 0, boxtruck: 0, ramptruck: 0 }[body];
  const tall = body === 'bus' || body === 'boxtruck';
  // The box truck is drawn as a cab plus a cargo box instead (below).
  if (body !== 'boxtruck') {
    const bodyGeo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > 0 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) - hy * noseDrop);
    }
    bodyGeo.computeVertexNormals();
    root.add(new THREE.Mesh(bodyGeo, body === 'ramptruck' ? trim : paint));
  }
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.04, 0.12, hz * 2 - 0.3), trim);
  skirt.position.y = -hy + 0.06;
  root.add(skirt);

  // Cabin / glasshouse, and where the roof ends up (for the light bar).
  let roof: number;
  if (body === 'truck') {
    // Armored truck: slit windscreen and side vision ports in the slab body, roof hatch.
    const slit = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.7, hy * 0.35, 0.06), glass);
    slit.position.set(0, hy * 0.45, hz + 0.01);
    root.add(slit);
    for (const side of [-1, 1]) {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.06, hy * 0.3, hz * 0.5), glass);
      port.position.set(side * (hx + 0.01), hy * 0.45, hz * 0.45);
      root.add(port);
    }
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), trim);
    hatch.position.set(0, hy + 0.06, -hz * 0.3);
    root.add(hatch);
    roof = hy;
  } else if (body === 'bus') {
    // City bus: a long window band down both sides, big windscreen, white roof.
    for (const side of [-1, 1]) box(0.04, hy * 0.6, hz * 1.7, glass, side * (hx + 0.01), hy * 0.35, -hz * 0.05);
    box(hx * 1.8, hy * 0.75, 0.04, glass, 0, hy * 0.3, hz + 0.01);
    box(hx * 1.8, 0.4, 0.04, glass, 0, hy * 0.75, -hz - 0.01);
    box(hx * 1.95, 0.08, hz * 1.95, new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6, flatShading: true }), 0, hy + 0.04, 0);
    // Door on the kerb (right, -X) side.
    box(0.05, hy * 1.5, 1.1, trim, -hx - 0.02, -hy * 0.2, hz * 0.72);
    roof = hy + 0.08;
  } else if (body === 'boxtruck') {
    // Short cab with a windscreen, tall white cargo box behind it.
    const cabLen = 1.9;
    const cabTop = hy * 0.35;
    box(hx * 2, cabTop + hy, cabLen, paint, 0, (cabTop - hy) / 2, hz - cabLen / 2);
    box(hx * 1.7, (cabTop + hy) * 0.35, 0.04, glass, 0, cabTop - (cabTop + hy) * 0.22, hz + 0.01);
    for (const side of [-1, 1]) box(0.04, (cabTop + hy) * 0.3, cabLen * 0.5, glass, side * (hx + 0.01), cabTop - (cabTop + hy) * 0.22, hz - cabLen * 0.4);
    const cargo = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7, flatShading: true });
    box(hx * 2.04, hy * 2, hz * 2 - cabLen - 0.15, cargo, 0, 0, -cabLen / 2 - 0.075);
    roof = hy;
  } else if (body === 'van') {
    // Tall glasshouse almost the length of the van.
    box(hx * 1.9, hy * 0.55, 0.04, glass, 0, hy * 0.5, hz - 0.15);
    for (const side of [-1, 1]) box(0.04, hy * 0.45, hz * 1.2, glass, side * (hx + 0.01), hy * 0.5, hz * 0.05);
    roof = hy;
  } else if (body === 'pickup') {
    // Cab up front, open bed with low walls behind.
    box(hx * 1.86, 0.7, hz * 0.62, glass, 0, hy + 0.35, hz * 0.12);
    box(hx * 1.9, 0.06, hz * 0.64, paint, 0, hy + 0.72, hz * 0.12);
    for (const side of [-1, 1]) box(0.08, 0.3, hz * 0.8, paint, side * (hx - 0.04), hy + 0.15, -hz * 0.58);
    box(hx * 2, 0.3, 0.08, paint, 0, hy + 0.15, -hz + 0.04);
    roof = hy + 0.75;
  } else if (body === 'ramptruck') {
    // Cab in the paint colour; the tilted deck in dark steel with yellow/black chevrons on top.
    const { z0, z1, top } = RAMP.cab;
    box(RAMP.halfWidth * 2, top - hy, z1 - z0, paint, 0, (top + hy) / 2, (z0 + z1) / 2);
    box(RAMP.halfWidth * 1.7, (top - hy) * 0.4, 0.04, glass, 0, top - (top - hy) * 0.3, z1 + 0.01);
    for (const side of [-1, 1]) box(0.04, (top - hy) * 0.35, (z1 - z0) * 0.5, glass, side * (RAMP.halfWidth + 0.01), top - (top - hy) * 0.3, z1 - (z1 - z0) * 0.3);
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.7, roughness: 0.45, flatShading: true });
    root.add(new THREE.Mesh(new ConvexGeometry(pointsOf(rampHullPoints(spec))), steel));
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
    roof = top;
  } else if (body === 'suv') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.86, 0.72, hz * 1.25), glass);
    cabin.position.set(0, hy + 0.36, -hz * 0.18);
    root.add(cabin);
    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.9, 0.06, hz * 1.27), paint);
    roofPanel.position.set(0, hy + 0.74, -hz * 0.18);
    root.add(roofPanel);
    roof = hy + 0.77;
  } else {
    // Faceted canopy, set slightly back; taller and longer on a sedan.
    const cabinGeo = new THREE.CylinderGeometry(0.75, 1.0, body === 'sedan' ? 0.6 : 0.5, 4, 1);
    cabinGeo.rotateY(Math.PI / 4);
    cabinGeo.scale(1.15, 1, body === 'sedan' ? 1.85 : 1.6);
    const cabin = new THREE.Mesh(cabinGeo, glass);
    cabin.position.set(0, hy + (body === 'sedan' ? 0.28 : 0.23), body === 'sedan' ? -0.2 : -0.3);
    root.add(cabin);
    roof = hy + (body === 'sedan' ? 0.58 : 0.48);
  }

  if (body === 'sports') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 - 0.1, 0.08, 0.35), paint);
    spoiler.position.set(0, hy + 0.3, -hz + 0.15);
    root.add(spoiler);
    for (const x of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.12), trim);
      strut.position.set(x, hy + 0.15, -hz + 0.2);
      root.add(strut);
    }
  }

  for (const x of [-0.65, 0.65]) {
    const lampY = body === 'truck' ? -hy * 0.3 : tall ? -hy * 0.6 : body === 'van' ? -hy * 0.2 : 0;
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

  const tireGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.32, 12);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(spec.wheelRadius * 0.6, spec.wheelRadius * 0.6, 0.34, 6);
  rimGeo.rotateZ(Math.PI / 2);
  const wheels: CarMesh['wheels'] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    const spinner = new THREE.Mesh(tireGeo, tire);
    spinner.add(new THREE.Mesh(rimGeo, rim));
    pivot.add(spinner);
    root.add(pivot);
    wheels.push({ pivot, spinner });
  }

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
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

  return { root, wheels, taillight, headlight, headGlows, tailGlows, indicators, beams, paint, sirenLights };
}

let glowCache: THREE.Texture | null | undefined;
/** One glow texture shared by every car; none in headless tests (no DOM). */
function sharedGlowTexture(): THREE.Texture | null {
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
