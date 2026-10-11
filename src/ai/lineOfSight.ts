import RAPIER from '@dimforge/rapier3d-compat';
import type { LineOfSight } from './CopController';

const SIGHT_HEIGHT = 0.6; // under planter tops (0.9m), over the road

/**
 * Cop line of sight: two rays a car-width apart against static geometry (buildings etc.), low
 * enough that plaza planters block it too — a cop can't drive straight through those.
 */
export function staticLineOfSight(world: RAPIER.World): LineOfSight {
  return (from, to) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return true;
    for (const off of [-0.9, 0.9]) {
      const ox = (-dz / len) * off;
      const oz = (dx / len) * off;
      const ray = new RAPIER.Ray({ x: from.x + ox, y: SIGHT_HEIGHT, z: from.z + oz }, { x: dx / len, y: 0, z: dz / len });
      const hit = world.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      if (hit && hit.timeOfImpact < len - 2) return false;
    }
    return true;
  };
}
