// District renderers: each district kind draws its own structures (walls, gates, cranes, ships),
// overhead pieces and ground patches. Buildings go through CityBuilder's facade pipeline and
// landmarks and props through Landmarks / PropSystem, as everywhere else.
import type * as THREE from 'three';
import type { CityData } from '../../world/CityGenerator';
import type { CityTheme } from '../../world/CityTheme';
import type { Climate } from '../../world/Climate';
import type { District, DistrictKind } from '../../world/districts/District';
import type { GroundHeight } from '../../world/Terrain';

export interface DistrictRenderContext {
  theme: CityTheme;
  climate: Climate;
  lampGlow: number; // 0 by day … 1 at night
  ground: GroundHeight;
}

/** A district's meshes, with whatever moves each frame. */
export interface DistrictView {
  update?(dt: number, time: number, camera: THREE.Camera): void;
}

export type DistrictRenderer = (q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext) => DistrictView;

/** One renderer per district kind (registered as each district is built). */
export const DISTRICT_RENDERERS: Partial<Record<DistrictKind, DistrictRenderer>> = {};

/** Draw every placed district's structures, overhead pieces and ground patches. */
export function buildDistricts(city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView[] {
  return city.districts.flatMap((q) => {
    const render = DISTRICT_RENDERERS[q.kind];
    return render ? [render(q, city, scene, ctx)] : [];
  });
}
