import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './Vehicle';
import { COP_SPECS, PLAYER_SPEC } from './VehicleSpecs';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function flat() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(1));
  return world;
}

function run(world: RAPIER.World, cars: Vehicle[], seconds: number, input = IDLE) {
  for (let i = 0; i < seconds / DT; i++) {
    for (const c of cars) c.drive(input, DT);
    world.step();
    for (const c of cars) c.snapshot();
  }
}

describe('crash knock', () => {
  beforeAll(() => RAPIER.init());

  it('a T-bone at 54 km/h shoves a parked car about as far as sliding tyres allow', () => {
    // Real numbers: ~8.5 m/s of delta-V, then rubber sliding at ~0.75 g: v²/2μg ≈ 5 m.
    const world = flat();
    const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 }, Math.PI / 2);
    const cop = new Vehicle(world, COP_SPECS.patrol, { x: 0, y: 1, z: -12 });
    player.teleport(0, 0.75, 0, Math.PI / 2);
    cop.teleport(0, 0.75, -10, 0, 15);
    run(world, [player, cop], 3);
    expect(player.position.z).toBeGreaterThan(4);
    expect(player.position.z).toBeLessThan(9);
  });

  it('clipping the rear corner at speed spins the car round its front wheels', () => {
    const world = flat();
    const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
    const cop = new Vehicle(world, COP_SPECS.patrol, { x: 3, y: 1, z: -7 });
    player.teleport(0, 0.75, 0, 0, 25);
    cop.teleport(2.8, 0.75, -7, -0.25, 31);
    let maxYaw = 0;
    for (let i = 0; i < 3 / DT; i++) {
      run(world, [player, cop], DT, { ...IDLE, throttle: 0.5 });
      const f = player.forward();
      maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(f.x, f.z)));
    }
    expect(maxYaw).toBeGreaterThan(Math.PI / 2);
  });

  it('settles: grip comes back once the slide has died down', () => {
    const world = flat();
    const car = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
    run(world, [car], 0.5);
    car.body.setLinvel({ x: 8, y: 0, z: 0 }, true); // shoved sideways
    run(world, [car], DT);
    expect(car.knock[0]).toBeGreaterThan(0.5);
    run(world, [car], 2);
    expect(car.knock).toEqual([0, 0]);
    expect(Math.abs(car.body.linvel().x)).toBeLessThan(0.1);
  });
});
