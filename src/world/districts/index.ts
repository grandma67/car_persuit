// The district registry: Old City, Chinatown, Harbor, Farm. Each rolls on its own stream in this
// order; placement then goes in a per-seed shuffled order (applyDistricts), a later district keeping
// a block away from the earlier ones.
import { CHINATOWN_DEF } from './Chinatown';
import { FARM_DEF } from './Farm';
import { HARBOR_DEF } from './Harbor';
import type { DistrictDef } from './District';
import { OLD_CITY_DEF } from './OldCity';

export const DISTRICT_DEFS: DistrictDef[] = [OLD_CITY_DEF, CHINATOWN_DEF, HARBOR_DEF, FARM_DEF];
