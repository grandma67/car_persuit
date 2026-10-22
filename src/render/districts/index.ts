// District renderers: each district kind draws its own structures (walls, gates, cranes, ships),
// overhead pieces and ground patches. Buildings go through CityBuilder's facade pipeline and
// landmarks and props through Landmarks / PropSystem, as everywhere else.
import type * as THREE from 'three';
import type { CityData } from '../../world/CityGenerator';
import type { CityTheme } from '../../world/CityTheme';
import type { Climate } from '../../world/Climate';
import type { District, DistrictKind } from '../../world/districts/District';
import type { GroundHeight } from '../../world/Terrain';
import { renderChinatown } from './Chinatown';
import { renderFarm } from './Farm';
import { renderHarbor } from './Harbor';
import { renderOldCity } from './OldCity';

export interface DistrictRenderContext {
  theme: CityTheme;
  climate: Climate;
  lampGlow: number; // 0 by day … 1 at night
  /** A night run: night-only dressing shows (Chinatown's night market and festival). */
  night: boolean;
  ground: GroundHeight;
  /** The game clock at the start of the run, in hours (10.5 = half past ten). */
  hour0: number;
  /** A bell rings out from `at` (the Old City's clock striking the hour). */
  bell?: (strikes: number, at: THREE.Vector3) => void;
  /** The cars on the move (the player and the cops): the Farm's crops flatten under them. */
  movers?: () => { position: THREE.Vector3 }[];
  /** A firework bursts at `at` in one of a few colours (Chinatown's festival nights). */
  firework?: (at: THREE.Vector3, colour: number) => void;
}

/** A district's meshes, with whatever moves each frame. */
export interface DistrictView {
  update?(dt: number, time: number, camera: THREE.Camera): void;
}

export type DistrictRenderer = (q: District, city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext) => DistrictView;

/** One renderer per district kind (registered as each district is built). */
export const DISTRICT_RENDERERS: Partial<Record<DistrictKind, DistrictRenderer>> = {
  oldtown: renderOldCity,
  chinatown: renderChinatown,
  harbor: renderHarbor,
  farm: renderFarm,
};

/** Draw every placed district's structures, overhead pieces and ground patches. */
export function buildDistricts(city: CityData, scene: THREE.Scene, ctx: DistrictRenderContext): DistrictView[] {
  return city.districts.flatMap((q) => {
    const render = DISTRICT_RENDERERS[q.kind];
    return render ? [render(q, city, scene, ctx)] : [];
  });
}
