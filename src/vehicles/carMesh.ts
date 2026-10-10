import * as THREE from 'three';
import type { VehicleSpec } from './VehicleSpecs';

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
  /** Road-lighting headlight beam (off by day). */
  beam: THREE.SpotLight;
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

  const body = spec.body ?? 'sports';
  // Body: a box with the front top edge pulled down — a sharp wedge for sports cars, a gentle
  // bonnet slope for sedans/SUVs, flat-fronted for the armored truck.
  const noseDrop = { sports: 1.15, sedan: 0.7, suv: 0.3, truck: 0 }[body];
  const bodyGeo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  const pos = bodyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > 0 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) - hy * noseDrop);
  }
  bodyGeo.computeVertexNormals();
  root.add(new THREE.Mesh(bodyGeo, paint));

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
    const lampY = body === 'truck' ? -hy * 0.3 : 0;
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.05), headlight);
    hl.position.set(x * (hx / 0.95), lampY, hz);
    root.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05), taillight);
    tl.position.set(x * (hx / 0.95), hy - 0.08, -hz);
    const hg = glow(0xfff1d6, 1.6);
    hg.position.set(x * (hx / 0.95), lampY, hz + 0.12);
    const tg = glow(0xff2a2a, 1.0);
    tg.position.set(x * (hx / 0.95), hy - 0.08, -hz - 0.1);
    root.add(hg, tg);
    headGlows.push(hg);
    tailGlows.push(tg);
    root.add(tl);
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

  // One spotlight between the lamps lights the road ahead at night.
  const beam = new THREE.SpotLight(0xfff1d6, 0, 75, 0.5, 0.45, 1.3);
  beam.position.set(0, 0.1, hz);
  beam.target.position.set(0, -1.2, hz + 25);
  root.add(beam, beam.target);

  return { root, wheels, taillight, headlight, headGlows, tailGlows, beam, paint, sirenLights };
}

let glowCache: THREE.Texture | null | undefined;
/** One glow texture shared by every car; none in headless tests (no DOM). */
function sharedGlowTexture(): THREE.Texture | null {
  if (glowCache === undefined) glowCache = typeof document === 'undefined' ? null : glowSpriteTexture();
  return glowCache;
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
