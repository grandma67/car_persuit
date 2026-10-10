import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// M0 smoke test: proves Three.js rendering + Rapier WASM physics work in the deployed build.

function buildCarMesh(bodyColor: number): THREE.Group {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.6, roughness: 0.35, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x111822, metalness: 0.9, roughness: 0.1, flatShading: true });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, flatShading: true });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff2030, emissiveIntensity: 2 });

  // Low, wide wedge body: a box with the front top vertices pulled down for a sharp nose.
  const bodyGeo = new THREE.BoxGeometry(2, 0.6, 4.4);
  const pos = bodyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > 0 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) - 0.35);
  }
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, paint);
  body.position.y = 0.55;
  car.add(body);

  // Cabin: tapered canopy set slightly back.
  const cabinGeo = new THREE.CylinderGeometry(0.75, 1.0, 0.5, 4, 1);
  cabinGeo.rotateY(Math.PI / 4);
  cabinGeo.scale(1.15, 1, 1.6);
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.position.set(0, 1.08, -0.3);
  car.add(cabin);

  // Spoiler.
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.35), paint);
  spoiler.position.set(0, 1.15, -2.05);
  car.add(spoiler);

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]]) {
    const wheel = new THREE.Mesh(wheelGeo, tire);
    wheel.position.set(x, 0.38, z);
    car.add(wheel);
  }

  for (const x of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.05), headlight);
    hl.position.set(x, 0.6, 2.2);
    car.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05), taillight);
    tl.position.set(x, 0.75, -2.2);
    car.add(tl);
  }

  car.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return car;
}

async function start(): Promise<void> {
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2233);
  scene.fog = new THREE.Fog(0x1a2233, 30, 90);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(8, 5, 10);
  camera.lookAt(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202020, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(10, 20, 8);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const car = buildCarMesh(0xff3b1f);
  scene.add(car);

  // Physics: fixed ground + falling crates around the car.
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setTranslation(0, -0.1, 0));

  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x3fa9f5, flatShading: true });
  const crates: { mesh: THREE.Mesh; body: RAPIER.RigidBody }[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(Math.cos(angle) * 5, 4 + i * 1.5, Math.sin(angle) * 5)
        .setRotation({ x: 0.3, y: 0.2, z: 0.1, w: 1 }),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
    const mesh = new THREE.Mesh(crateGeo, crateMat);
    mesh.castShadow = true;
    scene.add(mesh);
    crates.push({ mesh, body });
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    world.timestep = dt;
    world.step();
    for (const { mesh, body } of crates) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    car.rotation.y += dt * 0.5;
    renderer.render(scene, camera);
  });
}

start().catch((err) => {
  document.getElementById('hud')!.textContent = `Failed to start: ${err}`;
  console.error(err);
});
