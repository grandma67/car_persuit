// The Swamp's renderer. The pools draw with the city's shallow water (render/ShallowWater.ts) and
// the banks as park ground; the witch house, boardwalks, shacks and trees come with later milestones.
import type * as THREE from 'three';
import type { CityData } from '../../world/CityGenerator';
import type { District } from '../../world/districts/District';
import type { DistrictRenderContext, DistrictView } from './index';

export function renderSwamp(_q: District, _city: CityData, _scene: THREE.Scene, _ctx: DistrictRenderContext): DistrictView {
  return {};
}
