import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { Cop } from '../ai/CopDirector';
import type { Vehicle } from '../vehicles/Vehicle';
import { COP_RAM } from './balance';

export interface ContactResult {
  damage: number; // to the player this step, before the difficulty's damage scale
  started: boolean; // contact began this step (a bang rather than a grind)
  closing: number; // m/s the two cars were closing at just before this step
  whack: number; // m/s the player was driving into the cop when contact began (0 otherwise)
  dv: number; // m/s of velocity the cop's push gave the player this step
}

const NO_CONTACT: ContactResult = { damage: 0, started: false, closing: 0, whack: 0, dv: 0 };

/** Damage for a crash pulse's total delta-V (see COP_RAM). */
const bang = (dv: number) => COP_RAM.bangPerDv * Math.max(0, dv - COP_RAM.bump) ** 1.5;

// Tracks which cops are touching the player and the momentum each has pushed into them: the crash
// pulse right after contact begins is the bang, anything after it the grind of a cop shoving or
// pinning the player. Ignores armor — see COP_RAM.
export class CopContact {
  private touching = new WeakSet<Cop>();
  private closing = new WeakMap<Cop, number>();
  private pulse = new WeakMap<Cop, { left: number; dv: number }>();

  constructor(
    private world: RAPIER.World,
    private player: Vehicle,
  ) {}

  /** `playerVelocity`: the player's velocity before this frame's steps. */
  check(cop: Cop, playerVelocity: THREE.Vector3, dt: number): ContactResult {
    let touching = false;
    let impulse = 0; // N·s along the contact normals in the last step
    this.world.contactPair(this.player.collider, cop.vehicle.collider, (m) => {
      for (let i = 0; i < m.numContacts(); i++) {
        if (m.contactDist(i) < 0.05) touching = true;
        impulse += m.contactImpulse(i);
      }
    });
    if (impulse > 0) touching = true;
    const a = cop.vehicle.body.linvel();
    const b = this.player.body.linvel();
    const closing = this.closing.get(cop) ?? 0;
    this.closing.set(cop, Math.hypot(a.x - b.x, a.z - b.z));
    const wasTouching = this.touching.has(cop);
    if (!touching) {
      this.touching.delete(cop);
      return NO_CONTACT;
    }
    this.touching.add(cop);
    let whack = 0;
    if (!wasTouching) {
      this.pulse.set(cop, { left: COP_RAM.pulse, dv: 0 });
      // Did the player drive into the cop (rather than just get rammed)?
      const p = this.player.position;
      const c = cop.vehicle.position;
      const len = Math.hypot(c.x - p.x, c.z - p.z) || 1;
      whack = Math.max(0, (playerVelocity.x * (c.x - p.x) + playerVelocity.z * (c.z - p.z)) / len);
    }
    const dv = impulse / this.player.spec.mass;
    const pulse = this.pulse.get(cop)!;
    let damage: number;
    if (pulse.left > 0) {
      damage = bang(pulse.dv + dv) - bang(pulse.dv);
      pulse.dv += dv;
      pulse.left -= dt;
    } else {
      damage = COP_RAM.grindPerDv * dv;
    }
    return { damage, started: !wasTouching, closing, whack, dv };
  }
}
