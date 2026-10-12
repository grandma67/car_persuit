import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_CITY, generateCity } from './CityGenerator';
import { canalRampShape, inRampLane, rampDeckHulls, rampFrame, rampShape, type Landmark } from './Landmarks';
import { groundHeight, inCanal } from './Terrain';
import { Vehicle } from '../vehicles/Vehicle';
import { PLAYER_SPEC } from '../vehicles/VehicleSpecs';

const inside = (r: { x: number; z: number; w: number; d: number }, p: { x: number; z: number }) =>
  Math.abs(p.x - r.x) <= r.w / 2 && Math.abs(p.z - r.z) <= r.d / 2;

describe('jump ramp monument', () => {
  it.each([1, 42, 1234, 99999])('seed %i: exactly one, on a paved street in line with the roads, with a clear run', (seed) => {
    const city = generateCity(seed, { ...DEFAULT_CITY, canalRampChance: 0 });
    const ramps = city.landmarks.filter((l) => l.kind === 'ramp');
    expect(ramps.length).toBe(1);
    const ramp = ramps[0];
    expect(city.plazas.some((p) => p.x === ramp.x && p.z === ramp.z)).toBe(true);
    // A road straight on behind the run-up junction and beyond the landing one.
    const pitch = city.config.blockSize + city.config.roadWidth;
    const fx = Math.sin(ramp.yaw);
    const fz = Math.cos(ramp.yaw);
    for (const along of [-pitch, pitch]) {
      const p = { x: ramp.x + fx * along, z: ramp.z + fz * along };
      expect(city.roads.some((r) => inside(r.rect, p))).toBe(true);
    }
    const half = city.config.blockSize / 2;
    const near = (p: { x: number; z: number }) => Math.abs(p.x - ramp.x) < half && Math.abs(p.z - ramp.z) < half;
    for (const p of city.streetProps) if (near(p)) expect(inRampLane(ramp, p)).toBe(false);
    for (const p of city.props) if (near(p)) expect(inRampLane(ramp, p)).toBe(false);
  });
});

// Nothing of a bridge in a ramp's lane, from behind the run-up to past the landing.
function laneCrossesBridge(city: ReturnType<typeof generateCity>, l: ReturnType<typeof generateCity>['landmarks'][number]): boolean {
  const fx = Math.sin(l.yaw);
  const fz = Math.cos(l.yaw);
  for (let a = -100; a <= 120; a += 2) {
    const p = { x: l.x + fx * a, z: l.z + fz * a };
    if (city.terrain.bridges.some((b) => inside(b, p))) return true;
  }
  return false;
}

describe('ramps and bridges', () => {
  it('neither ramp runs over a bridge', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const city = generateCity(seed, { ...DEFAULT_CITY, canalRampChance: 1 });
      for (const l of city.landmarks.filter((l) => l.kind === 'ramp')) expect(laneCrossesBridge(city, l), `seed ${seed}`).toBe(false);
    }
  });
});

describe('canal ramp', () => {
  const withCanals = { ...DEFAULT_CITY, canalOdds: [0, 1, 0] as [number, number, number], canalRampChance: 1 };

  it('is common, with how many decided by the seed', () => {
    const counts = new Set<number>();
    let cities = 0;
    let withRamps = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const city = generateCity(seed);
      if (!city.terrain.canals.length) continue;
      cities++;
      const ramps = city.landmarks.filter((l) => l.crossing !== undefined);
      if (ramps.length) withRamps++;
      counts.add(ramps.length);
      expect(ramps.length).toBeLessThanOrEqual(DEFAULT_CITY.canalRamps[1]);
      expect(generateCity(seed).landmarks.filter((l) => l.crossing !== undefined).length).toBe(ramps.length);
      // Never two at one crossing, nor within a block and a half of each other.
      for (const a of ramps) for (const b of ramps) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(40);
    }
    expect(withRamps / cities).toBeGreaterThan(0.4);
    expect(counts.size).toBeGreaterThan(2); // none, one, several
  });

  it.each([3, 8, 21, 77])('seed %i: lip at the quay, facing straight across the canal', (seed) => {
    const city = generateCity(seed, withCanals);
    const ramp = city.landmarks.find((l) => l.crossing !== undefined);
    expect(ramp).toBeDefined();
    const canal = city.terrain.canals.find((c) => c.at === ramp!.crossing)!;
    const fx = Math.sin(ramp!.yaw);
    const fz = Math.cos(ramp!.yaw);
    // Heading across the canal, toward the water, lip within a few metres of it.
    const toWater = canal.axis === 'x' ? (canal.at - ramp!.z) * fz : (canal.at - ramp!.x) * fx;
    expect(toWater).toBeGreaterThan(canal.half);
    expect(toWater).toBeLessThan(canal.half + 4);
  });

  beforeAll(() => RAPIER.init());

  // The narrowest and widest canals, and between.
  it.each([12, 40, 70, 100])('a %i m canal is cleared from a street-length run-up', (width) => {
    const DT = 1 / 60;
    const shape = canalRampShape(width + 8);
    const lip = 0;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Ground up to 2 m past the lip, the canal, then the far bank.
    const near = 200;
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, near / 2).setTranslation(0, -0.5, lip + 2 - near / 2).setFriction(1));
    const far = lip + 2 + width;
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 100).setTranslation(0, -0.5, far + 100).setFriction(1));
    for (const pts of rampDeckHulls(shape, 16)) world.createCollider(RAPIER.ColliderDesc.convexHull(pts)!.setFriction(1));
    // A quay street, junction and the road behind: ~120 m.
    const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: shape.toe - 120 });
    let landed: number | null = null;
    let airborne = false;
    for (let i = 0; i < 25 / DT && landed === null; i++) {
      car.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false }, DT);
      world.step();
      car.snapshot();
      const z = car.position.z;
      if (z > lip + 1) {
        const touching = [0, 1, 2, 3].some((w) => car.controller.wheelIsInContact(w));
        if (!touching) airborne = true;
        else if (airborne) landed = z;
      }
      if (car.position.y < -5) break;
    }
    expect(landed).not.toBeNull();
    expect(landed!).toBeGreaterThan(far + 2);
  });
});

/**
 * Drive the player flat out at a canal ramp in a real city, along the ramp's line: from as far
 * back as the road runs straight, over the ground as it lies (hill included), the ramp placed as
 * the game places it. Returns how far past the lip it landed, and where the far bank starts.
 */
function jumpInCity(city: ReturnType<typeof generateCity>, l: Landmark) {
  const s = rampShape(l);
  const fx = Math.sin(l.yaw);
  const fz = Math.cos(l.yaw);
  const rx = Math.cos(l.yaw);
  const rz = -Math.sin(l.yaw);
  const at = (a: number) => ({ x: l.x + fx * a, z: l.z + fz * a });
  const wet = (a: number) => {
    const p = at(a);
    return inCanal(city.terrain, p.x, p.z) && !city.terrain.bridges.some((b) => inside(b, p));
  };
  const drivable = (a: number) => {
    const p = at(a);
    return !wet(a) && [...city.roads.map((r) => r.rect), ...city.intersections, ...city.plazas].some((r) => inside(r, p));
  };
  let back = s.toe;
  while (back > s.toe - 300 && drivable(back - 1)) back -= 1;
  let wetFrom = 0;
  while (!wet(wetFrom)) wetFrom += 0.5;
  let farBank = wetFrom;
  while (wet(farBank)) farBank += 0.5;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // The road along the line, a metre-long slab at a time following the hill, open over the water.
  for (let a = back - 5; a < farBank + 150; a += 1) {
    if (a + 1 > wetFrom && a < farBank) continue;
    const pts: number[] = [];
    for (const along of [a, a + 1]) {
      for (const across of [-6, 6]) {
        const x = l.x + fx * along + rx * across;
        const z = l.z + fz * along + rz * across;
        const y = groundHeight(city.terrain, x, z);
        pts.push(x, y, z, x, y - 0.5, z);
      }
    }
    world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!.setFriction(1));
  }
  const { y, quaternion: q } = rampFrame(l, city.terrain);
  for (const pts of rampDeckHulls(s, 16)) {
    world.createCollider(RAPIER.ColliderDesc.convexHull(pts)!.setTranslation(l.x, y, l.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(1));
  }
  const start = at(back + 3);
  const car = new Vehicle(world, PLAYER_SPEC, { x: start.x, y: groundHeight(city.terrain, start.x, start.z) + 1, z: start.z }, l.yaw);
  let airborne = false;
  for (let i = 0; i < 40 * 60; i++) {
    car.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60);
    world.step();
    car.snapshot();
    const along = (car.position.x - l.x) * fx + (car.position.z - l.z) * fz;
    const touching = [0, 1, 2, 3].some((w) => car.controller.wheelIsInContact(w));
    if (along > 1 && !touching) airborne = true;
    if (airborne && touching) return { landed: along, farBank };
    if (car.position.y < -6) break;
  }
  return { landed: NaN, farBank };
}

describe('canal ramps in real cities', () => {
  beforeAll(() => RAPIER.init());

  // Run-up as the road allows, hills and all: every ramp has to carry the car to the far bank.
  it('every canal ramp in the first 40 seeds clears its canal', () => {
    let ramps = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const city = generateCity(seed);
      for (const l of city.landmarks.filter((q) => q.crossing !== undefined)) {
        ramps++;
        const { landed, farBank } = jumpInCity(city, l);
        expect(landed, `seed ${seed} ramp at ${l.x},${l.z}`).toBeGreaterThan(farBank + 1);
      }
    }
    expect(ramps).toBeGreaterThan(10);
  });
});

