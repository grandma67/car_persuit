// Junction sim with every driver on the traffic LOD (CivilianTraffic: thinking every 3rd step past
// lodNear), so mid-range cars still take their turn, stop and queue without a crash (junctionSim.ts).
import { TRAFFIC } from './CivilianTraffic';
import { junctionSuite } from './junctionSim';

junctionSuite('signal', [1], false, TRAFFIC.lodEvery);
junctionSuite('stop', [-1], true, TRAFFIC.lodEvery);
