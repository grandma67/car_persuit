// Tuning data for every vehicle type. Cops (M4/M5) get their own entries here.

export interface VehicleSpec {
  name: string;
  color: number;
  livery?: 'police';
  body?: 'sports' | 'sedan' | 'suv' | 'truck' | 'van' | 'pickup' | 'bus' | 'boxtruck' | 'ramptruck'; // mesh shape, default sports
  maxHealth?: number; // default 100
  kerb?: 'left' | 'right'; // side the doors open onto (buses), default right
  mass: number; // kg
  halfExtents: { x: number; y: number; z: number }; // chassis collider, metres
  wheelRadius: number;
  wheelX: number; // lateral offset of wheels from centre
  wheelZ: number; // longitudinal offset of axles from centre
  wheelY?: number; // height of the wheel mounts relative to the chassis centre (tall bodies), default 0
  dualRear?: boolean; // twin tyres on each rear hub, like a loaded truck or bus (drawn only: physics keeps 4 wheels)
  suspensionRestLength: number;
  suspensionStiffness: number;
  engineForce: number; // N per driven wheel
  reverseForce: number;
  brakeForce: number;
  handbrakeForce: number;
  maxSpeed: number; // m/s
  maxReverseSpeed: number; // m/s
  maxSteer: number; // radians at low speed
  minSteer: number; // radians at top speed
  steerRate: number; // how fast steering input follows the keys (1/s)
  frictionSlip: number;
  sideFriction: number;
  driftSideFriction: number; // rear side friction while handbraking
  downforce: number; // N per (m/s) of speed, keeps the car planted
}

export const PLAYER_SPEC: VehicleSpec = {
  name: 'Player',
  color: 0xff3b1f,
  mass: 1200,
  halfExtents: { x: 0.95, y: 0.3, z: 2.2 },
  wheelRadius: 0.38,
  wheelX: 0.9,
  wheelZ: 1.4,
  suspensionRestLength: 0.45,
  suspensionStiffness: 28,
  engineForce: 4200,
  reverseForce: 2600, // quick to back out of trouble
  brakeForce: 45,
  handbrakeForce: 30,
  maxSpeed: 42, // ~150 km/h
  maxReverseSpeed: 14,
  maxSteer: 0.6,
  minSteer: 0.14,
  steerRate: 6,
  frictionSlip: 2.2,
  sideFriction: 1.4,
  driftSideFriction: 0.3,
  downforce: 60,
};

// Patrol car: as quick off the line as the player but a little slower flat out, so a clean
// driver can pull away on a straight.
export const COP_PATROL_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'Patrol',
  reverseForce: 3000, // cops back off hard between rams
  maxReverseSpeed: 10,
  color: 0xf2f2f2,
  livery: 'police',
  body: 'sedan',
  mass: 1350,
  engineForce: 4300,
  maxSpeed: 39, // ~140 km/h
};

// Interceptor (3★): faster than the player, but light and fragile.
export const COP_INTERCEPTOR_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'Interceptor',
  reverseForce: 3000,
  maxReverseSpeed: 10,
  color: 0x1a1d24,
  livery: 'police',
  body: 'sports',
  mass: 1250,
  engineForce: 5200,
  maxSpeed: 46, // ~165 km/h
  maxHealth: 70,
};

// SUV rammer (4★): heavy, hits hard, a bit slower.
export const COP_SUV_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'SUV',
  reverseForce: 5000,
  maxReverseSpeed: 10,
  color: 0x2b2f36,
  livery: 'police',
  body: 'suv',
  mass: 2300,
  halfExtents: { x: 1.05, y: 0.45, z: 2.45 },
  wheelRadius: 0.45,
  wheelX: 1.0,
  wheelZ: 1.6,
  suspensionRestLength: 0.5,
  engineForce: 7000,
  brakeForce: 85,
  handbrakeForce: 55,
  maxSpeed: 37,
  maxSteer: 0.5,
  downforce: 100,
  maxHealth: 160,
};

// Armored truck (5★): very heavy and slow, nearly unstoppable.
export const COP_ARMORED_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'Armored',
  reverseForce: 10000,
  maxReverseSpeed: 10,
  color: 0x23262b,
  livery: 'police',
  body: 'truck',
  mass: 5000,
  halfExtents: { x: 1.25, y: 0.85, z: 3.1 },
  wheelRadius: 0.55,
  wheelX: 1.15,
  wheelZ: 2.1,
  suspensionRestLength: 0.55,
  suspensionStiffness: 35,
  engineForce: 14000,
  brakeForce: 180,
  handbrakeForce: 110,
  maxSpeed: 33, // ~120 km/h
  maxSteer: 0.45,
  frictionSlip: 2.6,
  downforce: 200,
  maxHealth: 400,
};

export const COP_SPECS = {
  patrol: COP_PATROL_SPEC,
  interceptor: COP_INTERCEPTOR_SPEC,
  suv: COP_SUV_SPEC,
  armored: COP_ARMORED_SPEC,
};

// Civilian heavies. Tall bodies mount their wheels low (wheelY) so the box clears the road.
// Engine and brake forces scale with mass so they pull away and stop like everyone else.
const heavy = (mass: number) => ({
  mass,
  engineForce: 2.6 * mass,
  brakeForce: 0.036 * mass,
  handbrakeForce: 0.022 * mass,
  downforce: 0.04 * mass,
});

export const VAN_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'Van',
  body: 'van',
  ...heavy(2100),
  halfExtents: { x: 1.0, y: 0.75, z: 2.5 },
  wheelRadius: 0.4,
  wheelX: 0.95,
  wheelZ: 1.7,
  wheelY: -0.35,
  maxSteer: 0.55,
};

export const PICKUP_SPEC: VehicleSpec = {
  ...COP_SUV_SPEC,
  name: 'Pickup',
  livery: undefined,
  maxHealth: undefined,
  body: 'pickup',
  ...heavy(2000),
  halfExtents: { x: 1.05, y: 0.45, z: 2.7 },
  wheelZ: 1.85,
  // A real pickup's lock: with the SUV's 0.5 on this long wheelbase it couldn't get round a
  // kerb-side turn without swinging over the centre line of the road it turned into.
  maxSteer: 0.6,
};

export const BUS_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'Bus',
  body: 'bus',
  ...heavy(11000),
  halfExtents: { x: 1.25, y: 1.15, z: 5.5 },
  // Real bus tyres (295/80R22.5, 11R22.5) stand about 1.05m tall, well over a car's ~0.65m;
  // scaled like the cars' are. Mounted higher to keep the body at the same height.
  wheelRadius: 0.6,
  wheelX: 1.2, // tyres a little proud of the body sides, so turning they don't cut through them
  wheelZ: 3.0, // 6m wheelbase, like a real 12m city bus
  wheelY: -0.65,
  dualRear: true,
  suspensionRestLength: 0.5,
  suspensionStiffness: 40,
  maxSpeed: 16,
  // A city bus's lock: about 45°, so it turns inside an 11.8m outer circle like a real 12m bus
  // (the EU limit is 12.5m). Less and it sweeps over the far kerb into the signal poles.
  maxSteer: 0.78,
  minSteer: 0.45, // heavies never go fast; keep most of the lock for slow turns
  frictionSlip: 2.6,
};

export const BOX_TRUCK_SPEC: VehicleSpec = {
  ...BUS_SPEC,
  name: 'Box truck',
  body: 'boxtruck',
  ...heavy(7000),
  halfExtents: { x: 1.2, y: 1.2, z: 3.8 },
  wheelX: 1.2, // a little proud of the body, like the bus
  wheelZ: 2.5,
  wheelY: -0.7, // the bus's big 22.5" tyres (inherited), and twin rears for the load

  maxSteer: 0.75,
};

// The rare ramp truck: a long low-loader whose deck tilts up from just above the road behind
// it to above the cab. Catch it from behind, drive up the deck and launch over the cab. The
// wheels sit outside the deck, which is about two cars wide so it's easy to line up with.
export const RAMP_TRUCK_SPEC: VehicleSpec = {
  ...BUS_SPEC,
  name: 'Ramp truck',
  body: 'ramptruck',
  ...heavy(9000),
  halfExtents: { x: 2.0, y: 0.45, z: 4.6 },
  wheelRadius: 0.6, // truck tyres, like the bus's
  wheelX: 2.15,
  wheelZ: 3.0,
  wheelY: 0.05, // keeps the deck where it was with the bigger tyres
  dualRear: false, // an inner twin would sit buried in the deck
  suspensionRestLength: 0.55,
  maxSpeed: 14,
  maxSteer: 0.6, // its wheels sit outside the deck: more lock would turn them into the hull
};

/** Ramp truck deck and cab in chassis-local space (+Z forward), shared by physics and mesh. */
export const RAMP = {
  halfWidth: 2.0,
  tail: { z: -8.2, y: -0.86 }, // lip just above the road behind the truck
  lip: 0.06, // deck thickness at the tail
  top: { z: 2.0, y: 2.4 }, // launch edge, above the cab roof
  cab: { z0: 2.3, z1: 4.6, top: 1.9 },
};

/** Corners of the deck wedge as a flat xyz list (for a convex hull). */
export function rampHullPoints(spec: VehicleSpec): Float32Array {
  const w = RAMP.halfWidth;
  const bottom = -spec.halfExtents.y;
  const pts: number[] = [];
  for (const x of [-w, w]) {
    pts.push(x, RAMP.tail.y - RAMP.lip, RAMP.tail.z);
    pts.push(x, RAMP.tail.y, RAMP.tail.z);
    pts.push(x, RAMP.top.y, RAMP.top.z);
    pts.push(x, bottom, RAMP.top.z);
  }
  return new Float32Array(pts);
}
