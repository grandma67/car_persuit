// Chinatown's traffic beside the Old City (the alone case and the rules are in ChinatownTraffic.test.ts;
// this sim has its own file so the two run in parallel).
import { beforeAll, describe, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { passVans } from './trafficSim';

describe('Chinatown traffic', () => {
  beforeAll(() => RAPIER.init());

  it('civilians keep the main-street cap, never jam and get past the parked vans (beside the Old City)', () => passVans({ chinatown: true, oldtown: true }), 180_000);
});
