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
