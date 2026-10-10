import * as THREE from 'three';
import type { VehicleSpec } from './VehicleSpecs';

export interface CarMesh {
  root: THREE.Group;
  /** Per wheel: pivot (positioned + steered) and spinner (rolls about X). Order: FL, FR, RL, RR. */
  wheels: { pivot: THREE.Group; spinner: THREE.Mesh }[];
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
  const taillight = new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff2030, emissiveIntensity: 2 });

  // Wedge body: front top vertices pulled down for a sharp nose.
  const bodyGeo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  const pos = bodyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > 0 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) - hy * 1.15);
  }
  bodyGeo.computeVertexNormals();
  root.add(new THREE.Mesh(bodyGeo, paint));

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.04, 0.12, hz * 2 - 0.3), trim);
  skirt.position.y = -hy + 0.06;
  root.add(skirt);

  // Faceted canopy, set slightly back.
  const cabinGeo = new THREE.CylinderGeometry(0.75, 1.0, 0.5, 4, 1);
  cabinGeo.rotateY(Math.PI / 4);
  cabinGeo.scale(1.15, 1, 1.6);
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.position.set(0, hy + 0.23, -0.3);
  root.add(cabin);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 - 0.1, 0.08, 0.35), paint);
  spoiler.position.set(0, hy + 0.3, -hz + 0.15);
  root.add(spoiler);
  for (const x of [-0.6, 0.6]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.12), trim);
    strut.position.set(x, hy + 0.15, -hz + 0.2);
    root.add(strut);
  }

  for (const x of [-0.65, 0.65]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.05), headlight);
    hl.position.set(x, 0.0, hz);
    root.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05), taillight);
    tl.position.set(x, hy - 0.08, -hz);
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
  return { root, wheels };
}
