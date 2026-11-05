// The district registry: Old City, Chinatown, Harbor, Farm, Slums, Mega-park, Swamp, Forest. Each rolls on its own stream in this
// order; placement then goes in a per-seed shuffled order (applyDistricts), a later district keeping
// a block away from the earlier ones.
import { CHINATOWN_DEF } from './Chinatown';
import { FARM_DEF } from './Farm';
import { FOREST_DEF } from './Forest';
import { HARBOR_DEF } from './Harbor';
import { MEGAPARK_DEF } from './Megapark';
import type { DistrictDef } from './District';
import { OLD_CITY_DEF } from './OldCity';
import { SLUMS_DEF } from './Slums';
import { SWAMP_DEF } from './Swamp';

export const DISTRICT_DEFS: DistrictDef[] = [OLD_CITY_DEF, CHINATOWN_DEF, HARBOR_DEF, FARM_DEF, SLUMS_DEF, MEGAPARK_DEF, SWAMP_DEF, FOREST_DEF];
