#!/usr/bin/env node
// Rapier step cost on the game's city, for comparing Rapier versions (see RAPIER.md):
//   node scripts/rapier-bench.mjs [version…]        e.g. 0.18.2 0.20.0  (default: the installed one)
//   PKG=@dimforge/rapier3d-simd-compat node scripts/rapier-bench.mjs 0.20.0
// Each version is fetched with `npm pack` into a temp folder (the project's node_modules is not
// touched). The scene is a real city (scripts/rapier-scene.ts, seed 11 with the Old City): its
// static boxes, a ground slab, and ray-cast vehicles with the game's wheel and suspension numbers.
// Prints µs per world step (best of 3 runs of 900 steps, the first second skipped).
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pkg = process.env.PKG ?? '@dimforge/rapier3d-compat';
const tmp = mkdtempSync(join(tmpdir(), 'rapier-bench-'));
const scenePath = join(tmp, 'scene.json');
execSync(`node scripts/run-ts.mjs scripts/rapier-scene.ts ${scenePath}`, { stdio: 'ignore' });
const scene = JSON.parse(readFileSync(scenePath, 'utf8'));

/** The package's ESM entry for a version (or the installed one). */
function entry(version) {
  if (!version) return join(process.cwd(), 'node_modules', pkg, JSON.parse(readFileSync(join('node_modules', pkg, 'package.json'), 'utf8')).module);
  const dir = join(tmp, version);
  execSync(`mkdir -p ${dir} && cd ${dir} && npm pack ${pkg}@${version} --silent && tar -xzf *.tgz`, { stdio: 'ignore' });
  const find = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? find(join(d, f)) : f === 'rapier.mjs' ? [join(d, f)] : []));
  return find(join(dir, 'package'))[0];
}

function run(RAPIER, cars, drive) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(600, 0.5, 600).setTranslation(0, -0.5, 0));
  for (const [x, y, z, hx, hy, hz] of scene.boxes) world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
  const vehicles = scene.spots.slice(0, cars).map(([x, z, yaw]) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.95, 0.3, 2.2).setMass(1200), body);
    const c = world.createVehicleController(body);
    for (const [wx, wz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
      const i = c.numWheels();
      c.addWheel({ x: wx, y: -0.1, z: wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.35, 0.34);
      c.setWheelSuspensionStiffness(i, 30);
      c.setWheelMaxSuspensionTravel(i, 0.3);
      c.setWheelMaxSuspensionForce(i, 48000);
      c.setWheelFrictionSlip(i, 2.2);
      c.setWheelSideFrictionStiffness(i, 1);
    }
    return c;
  });
  const steps = 900;
  let total = 0;
  for (let s = 0; s < steps; s++) {
    const t0 = performance.now();
    vehicles.forEach((c, k) => {
      if (drive) {
        c.setWheelEngineForce(2, 2500);
        c.setWheelEngineForce(3, 2500);
        const steer = 0.2 * Math.sin(s / 40 + k);
        c.setWheelSteering(0, steer);
        c.setWheelSteering(1, steer);
      }
      c.updateVehicle(1 / 60);
    });
    world.step();
    if (s >= 60) total += performance.now() - t0;
  }
  world.free();
  return Math.round((total / (steps - 60)) * 1000);
}

const quiet = console.warn;
console.warn = () => {}; // Rapier's init deprecation warning
const versions = process.argv.slice(2);
console.log(`${pkg} on seed ${scene.seed}: ${scene.boxes.length} static boxes; µs per step, best of 3`);
console.log('version'.padEnd(10), ['empty city', '40 parked', '20 driving', '40 driving'].map((h) => h.padStart(11)).join(''));
for (const v of versions.length ? versions : [undefined]) {
  const path = entry(v);
  if (!path || !existsSync(path)) {
    console.log(`${v}: not found`);
    continue;
  }
  const RAPIER = (await import(pathToFileURL(path).href)).default;
  await RAPIER.init();
  const cells = [[0, false], [40, false], [20, true], [40, true]].map(([n, d]) => Math.min(run(RAPIER, n, d), run(RAPIER, n, d), run(RAPIER, n, d)));
  console.log((v ?? 'installed').padEnd(10), cells.map((c) => String(c).padStart(11)).join(''));
}
console.warn = quiet;
