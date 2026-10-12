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
 * statues, planters, props (those near a car have bodies) and other cars. Two rays a car-width
 * apart, at bumper height, following the ground. `ignore` skips colliders that aren't in the way
 * (the suspect, whom the cop wants to hit). Returns `len` when the way is clear.
 */
export type ObstacleProbe = (from: { x: number; z: number }, dirX: number, dirZ: number, len: number) => number;

const PROBE_HEIGHT = 0.5;
const CAR_MASS = 600; // kg: loose props and debris lighter than this aren't worth steering round

export function obstacleProbe(
  world: RAPIER.World,
  self: RAPIER.RigidBody,
  ignore: (collider: RAPIER.Collider) => boolean,
  ground: GroundHeight = FLAT,
): ObstacleProbe {
  const solid = (c: RAPIER.Collider) => {
    if (ignore(c)) return false;
    const body = c.parent();
    return !body || !body.isDynamic() || body.mass() > CAR_MASS;
  };
  return (from, dirX, dirZ, len) => {
    const y0 = ground(from.x, from.z) + PROBE_HEIGHT;
    const dy = ground(from.x + dirX * len, from.z + dirZ * len) + PROBE_HEIGHT - y0;
    const l = Math.hypot(len, dy);
    let free = len;
    for (const off of [-0.9, 0.9]) {
      const ray = new RAPIER.Ray({ x: from.x - dirZ * off, y: y0, z: from.z + dirX * off }, { x: (dirX * len) / l, y: dy / l, z: (dirZ * len) / l });
      const hit = world.castRay(ray, l, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, self, solid);
      if (hit) free = Math.min(free, (hit.timeOfImpact / l) * len);
    }
    return free;
  };
}
