import RAPIER from '@dimforge/rapier3d-compat';
import type { LineOfSight } from './CopController';
import { FLAT, type GroundHeight } from '../world/Terrain';

const SIGHT_HEIGHT = 0.6; // above the ground: under planter tops (0.9m), over the road

/**
 * Cop line of sight: two rays a car-width apart against static geometry (buildings etc.), low
 * enough that plaza planters block it too — a cop can't drive straight through those. Over a
 * hill crest the ground itself blocks the view.
 */
export function staticLineOfSight(world: RAPIER.World, ground: GroundHeight = FLAT): LineOfSight {
  return (from, to) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 1) return true;
    const y0 = ground(from.x, from.z) + SIGHT_HEIGHT;
    const dy = ground(to.x, to.z) + SIGHT_HEIGHT - y0;
    const len = Math.hypot(dx, dy, dz);
    for (const off of [-0.9, 0.9]) {
      const ox = (-dz / flat) * off;
      const oz = (dx / flat) * off;
      const ray = new RAPIER.Ray({ x: from.x + ox, y: y0, z: from.z + oz }, { x: dx / len, y: dy / len, z: dz / len });
      const hit = world.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      if (hit && hit.timeOfImpact < len - 2) return false;
    }
    return true;
  };
}

/**
 * How far a car can drive from `from` along (dirX, dirZ) before hitting something: walls,
 * statues, planters, props (those near a car have bodies) and other cars. Three rays across the car's
 * width (`halfWidth`), at bumper height, following the ground. `ignore` skips colliders that aren't in the way
 * (the suspect, whom the cop wants to hit). Returns `len` when the way is clear; `hit`, if given,
 * gets the velocity of what is nearest (zero for walls and props), so a car ahead can be followed.
 */
export type ObstacleProbe = (from: { x: number; z: number }, dirX: number, dirZ: number, len: number, hit?: { vx: number; vz: number }) => number;

const PROBE_HEIGHT = 0.5;
const CAR_MASS = 600; // kg: loose props and debris lighter than this aren't worth steering round

export function obstacleProbe(
  world: RAPIER.World,
  self: RAPIER.RigidBody,
  ignore: (collider: RAPIER.Collider) => boolean,
  ground: GroundHeight = FLAT,
  halfWidth = 1,
): ObstacleProbe {
  // Across the car, just inside its sides, and down the middle: a lamp post or sign pole fits between the outer two.
  const feelers = [-(halfWidth - 0.1), 0, halfWidth - 0.1];
  const solid = (c: RAPIER.Collider) => {
    if (ignore(c)) return false;
    const body = c.parent();
    return !body || !body.isDynamic() || body.mass() > CAR_MASS;
  };
  return (from, dirX, dirZ, len, hit) => {
    const y0 = ground(from.x, from.z) + PROBE_HEIGHT;
    const dy = ground(from.x + dirX * len, from.z + dirZ * len) + PROBE_HEIGHT - y0;
    const l = Math.hypot(len, dy);
    let free = len;
    if (hit) hit.vx = hit.vz = 0;
    for (const off of feelers) {
      const ray = new RAPIER.Ray({ x: from.x - dirZ * off, y: y0, z: from.z + dirX * off }, { x: (dirX * len) / l, y: dy / l, z: (dirZ * len) / l });
      const h = world.castRay(ray, l, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, self, solid);
      if (!h || (h.timeOfImpact / l) * len >= free) continue;
      free = (h.timeOfImpact / l) * len;
      if (hit) {
        const body = h.collider.parent();
        const v = body && !body.isFixed() ? body.linvel() : null;
        hit.vx = v?.x ?? 0;
        hit.vz = v?.z ?? 0;
      }
    }
    return free;
  };
}
