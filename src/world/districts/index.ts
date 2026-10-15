// The district registry, in placement order: Old City, Chinatown, Harbor, Farm. Placement follows
// this order, and a later district keeps a block away from the earlier ones.
import { CHINATOWN_DEF } from './Chinatown';
import type { DistrictDef } from './District';
import { OLD_CITY_DEF } from './OldCity';

export const DISTRICT_DEFS: DistrictDef[] = [OLD_CITY_DEF, CHINATOWN_DEF];
