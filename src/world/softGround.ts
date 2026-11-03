// What every car drives on off the firm ground: shallow water first (wading, or ice when the
// climate freezes it), then the districts' soft ground (the Farm's fields, the Slums' rubble lots).
// Pure data: `Game` hands the result to `Vehicle.softGround`.
import { WATER } from '../gameplay/balance';
import type { SoftPatch } from '../vehicles/Vehicle';
import type { CityData, Rect } from './CityGenerator';
import type { DistrictDef } from './districts/District';
import { inWater, waterReach } from './Water';

export type SoftGround = { at: (x: number, z: number) => SoftPatch | null };

/** The patches are shared objects: `Vehicle` compares them by identity to tell a change. */
export const WADING: SoftPatch = { grip: WATER.grip, drag: WATER.drag, dragPerSpeed: WATER.dragPerSpeed, water: 'wet' };
export const ICE: SoftPatch = { grip: WATER.iceGrip, drag: 0, water: 'ice' };

const inside = (r: Rect, x: number, z: number) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;

/** Null when the city has none (every car then skips the lookup). */
export function softGroundOf(city: CityData, defs: DistrictDef[], frozen: boolean): SoftGround | null {
  const water = city.water.map((w) => ({ w, reach: waterReach(w) }));
  const wet = frozen ? ICE : WADING;
  const soft = city.districts.flatMap((q) => {
    const patch = defs.find((d) => d.kind === q.kind)?.softGround;
    return patch && q.dressing.soft?.length ? [{ bounds: q.bounds, rects: q.dressing.soft, patch }] : [];
  });
  if (!water.length && !soft.length) return null;
  return {
    at: (x, z) => {
      for (const { w, reach } of water) {
        if (Math.abs(x - w.x) <= reach && Math.abs(z - w.z) <= reach && inWater(w, x, z)) return wet;
      }
      for (const s of soft) if (inside(s.bounds, x, z) && s.rects.some((r) => inside(r, x, z))) return s.patch;
      return null;
    },
  };
}
