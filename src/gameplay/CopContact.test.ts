import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Cop } from '../ai/CopDirector';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_SPECS, PLAYER_SPEC, type VehicleSpec } from '../vehicles/VehicleSpecs';
import { COP_RAM } from './balance';
import { CopContact, type ContactResult } from './CopContact';

const DT = 1 / 60;

/**
 * One car rolls into the other on flat ground. `copMoving`: the cop rams a parked player;
 * otherwise the player drives into a parked cop. Returns every contact result.
 */
function collide(copSpec: VehicleSpec, copMoving: boolean, speed = 15): ContactResult[] {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
  const copCar = new Vehicle(world, copSpec, { x: 0, y: 1, z: 0 });
  const mover = copMoving ? copCar : player;
  const parked = copMoving ? player : copCar;
  parked.teleport(0, 1, 0, 0);
  mover.teleport(0, 1, -12, 0, speed); // heading +z, straight at the parked car
  const contact = new CopContact(world, player);
  const cop = { vehicle: copCar } as Cop;
  const out: ContactResult[] = [];
  const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 3 / DT; i++) {
    const pv = player.body.linvel();
    const playerVelocity = new THREE.Vector3(pv.x, 0, pv.z);
    player.drive(idle, DT);
    copCar.drive(idle, DT);
    world.step();
    player.snapshot();
    copCar.snapshot();
    out.push(contact.check(cop, playerVelocity, DT));
  }
  return out;
}

describe('cop contact damage', () => {
  beforeAll(() => RAPIER.init());

  it('a ram is one bang scaled by closing speed, then a steady grind', () => {
    const r = collide(COP_SPECS.patrol, true);
    const starts = r.filter((c) => c.started);
    expect(starts).toHaveLength(1);
    const bang = starts[0];
    expect(bang.closing).toBeGreaterThan(8);
    const massRatio = COP_SPECS.patrol.mass / COP_RAM.referenceMass;
    expect(bang.damage).toBeCloseTo((COP_RAM.grindPerSec * DT + COP_RAM.bangPerMs * bang.closing) * massRatio);
    // The cop rammed us: we weren't driving into it.
    expect(bang.whack).toBeLessThan(1);
    for (const grind of r.filter((c) => c.damage > 0 && !c.started)) {
      expect(grind.damage).toBeCloseTo(COP_RAM.grindPerSec * DT * massRatio);
    }
  });

  it('no contact, no damage', () => {
    const r = collide(COP_SPECS.patrol, true, 0);
    expect(r.every((c) => c.damage === 0 && !c.started)).toBe(true);
  });

  it('heavier cops hit harder', () => {
    const bang = (spec: VehicleSpec) => collide(spec, true).find((c) => c.started)!;
    const patrol = bang(COP_SPECS.patrol);
    const armored = bang(COP_SPECS.armored);
    expect(armored.damage / armored.closing).toBeGreaterThan(patrol.damage / patrol.closing);
  });

  it('reports when the player drives into a cop (for wanted heat)', () => {
    const bang = collide(COP_SPECS.patrol, false).find((c) => c.started)!;
    expect(bang.whack).toBeGreaterThan(8);
  });
});
