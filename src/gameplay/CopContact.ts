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
}

const NO_CONTACT: ContactResult = { damage: 0, started: false, closing: 0, whack: 0 };

// Tracks which cops are touching the player and how fast they were closing, so a ram does a bang
// when contact starts plus a steady grind while it lasts. Ignores armor — see COP_RAM.
export class CopContact {
  private touching = new WeakSet<Cop>();
  private closing = new WeakMap<Cop, number>();

  constructor(
    private world: RAPIER.World,
    private player: Vehicle,
  ) {}

  /** `playerVelocity`: the player's velocity before this frame's steps. */
  check(cop: Cop, playerVelocity: THREE.Vector3, dt: number): ContactResult {
    let touching = false;
    this.world.contactPair(this.player.collider, cop.vehicle.collider, (m) => {
      for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.05) touching = true;
    });
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
      // Did the player drive into the cop (rather than just get rammed)?
      const p = this.player.position;
      const c = cop.vehicle.position;
      const len = Math.hypot(c.x - p.x, c.z - p.z) || 1;
      whack = Math.max(0, (playerVelocity.x * (c.x - p.x) + playerVelocity.z * (c.z - p.z)) / len);
    }
    const damage = COP_RAM.grindPerSec * dt + (wasTouching ? 0 : COP_RAM.bangPerMs * closing);
    return { damage: damage * (cop.vehicle.spec.mass / COP_RAM.referenceMass), started: !wasTouching, closing, whack };
  }
}
