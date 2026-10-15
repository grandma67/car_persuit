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
 * otherwise the player drives into a parked cop. `from`: where the mover starts (the parked car is
 * at the origin facing +z), `yaw`: the mover's heading off straight (rad), for glancing hits.
 * `throttle`: the mover keeps driving (pushing) after contact. Returns every contact result.
 */
function collide(copSpec: VehicleSpec, copMoving: boolean, speed = 15, from = { x: 0, z: -12 }, yaw = 0, throttle = 0): ContactResult[] {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const player = new Vehicle(world, PLAYER_SPEC, { x: 0, y: 1, z: 0 });
  const copCar = new Vehicle(world, copSpec, { x: 0, y: 1, z: 0 });
  const mover = copMoving ? copCar : player;
  const parked = copMoving ? player : copCar;
  parked.teleport(0, 1, 0, 0);
  mover.teleport(from.x, 1, from.z, yaw, speed); // heading (about) +z, at the parked car
  const contact = new CopContact(world, player);
  const cop = { vehicle: copCar } as Cop;
  const out: ContactResult[] = [];
  const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 3 / DT; i++) {
    const pv = player.body.linvel();
    const playerVelocity = new THREE.Vector3(pv.x, 0, pv.z);
    player.drive(copMoving ? idle : { ...idle, throttle }, DT);
    copCar.drive(copMoving ? { ...idle, throttle } : idle, DT);
    world.step();
    player.snapshot();
    copCar.snapshot();
    out.push(contact.check(cop, playerVelocity, DT));
  }
  return out;
}

/** Damage from the bang: the contact's first COP_RAM.pulse seconds. */
function bangDamage(r: ContactResult[]): number {
  const start = r.findIndex((c) => c.started);
  return r.slice(start, start + Math.round(COP_RAM.pulse / DT)).reduce((sum, c) => sum + c.damage, 0);
}

describe('cop contact damage', () => {
  beforeAll(() => RAPIER.init());

  it('a medium-speed ram is one hard bang from the delta-V it gives the player', () => {
    const r = collide(COP_SPECS.patrol, true);
    expect(r.filter((c) => c.started)).toHaveLength(1);
    const dv = r.reduce((sum, c) => sum + c.dv, 0);
    expect(dv).toBeGreaterThan(6); // ~half the 15 m/s closing speed: two similar cars
    expect(dv).toBeLessThan(11);
    const damage = bangDamage(r);
    expect(damage).toBeGreaterThan(15);
    expect(damage).toBeLessThan(40);
    // The cop rammed us: we weren't driving into it.
    expect(r.find((c) => c.started)!.whack).toBeLessThan(1);
  });

  it('a bump or a glancing scrape barely marks the car', () => {
    expect(bangDamage(collide(COP_SPECS.patrol, true, 3))).toBeLessThan(1.5);
    // Same 15 m/s, but swerving into the player's side from alongside instead of square on.
    const glancing = collide(COP_SPECS.patrol, true, 15, { x: -2.6, z: -3 }, 0.25);
    expect(glancing.some((c) => c.started)).toBe(true);
    expect(glancing.reduce((sum, c) => sum + c.damage, 0)).toBeLessThan(bangDamage(collide(COP_SPECS.patrol, true)) / 10);
  });

  it('a cop pinning the player grinds slowly', () => {
    const r = collide(COP_SPECS.patrol, true, 3, undefined, 0, 1);
    const start = r.findIndex((c) => c.started);
    const grind = r.slice(start + Math.round(COP_RAM.pulse / DT)).reduce((sum, c) => sum + c.damage, 0);
    const seconds = (r.length - start) * DT - COP_RAM.pulse;
    expect(grind / seconds).toBeGreaterThan(0.5);
    expect(grind / seconds).toBeLessThan(8);
  });

  it('no contact, no damage', () => {
    const r = collide(COP_SPECS.patrol, true, 0);
    expect(r.every((c) => c.damage === 0 && !c.started)).toBe(true);
  });

  it('heavier cops hit harder at the same speed', () => {
    expect(bangDamage(collide(COP_SPECS.armored, true))).toBeGreaterThan(bangDamage(collide(COP_SPECS.patrol, true)) * 1.5);
  });

  it('reports when the player drives into a cop (for wanted heat)', () => {
    const bang = collide(COP_SPECS.patrol, false).find((c) => c.started)!;
    expect(bang.whack).toBeGreaterThan(8);
  });
});
