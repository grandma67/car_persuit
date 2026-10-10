// Tuning data for every vehicle type. Cops (M4/M5) get their own entries here.

export interface VehicleSpec {
  name: string;
  color: number;
  livery?: 'police';
  body?: 'sports' | 'sedan' | 'suv' | 'truck'; // mesh shape, default sports
  maxHealth?: number; // default 100
  mass: number; // kg
  halfExtents: { x: number; y: number; z: number }; // chassis collider, metres
  wheelRadius: number;
  wheelX: number; // lateral offset of wheels from centre
  wheelZ: number; // longitudinal offset of axles from centre
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
  reverseForce: 1400,
  brakeForce: 45,
  handbrakeForce: 30,
  maxSpeed: 42, // ~150 km/h
  maxReverseSpeed: 10,
  maxSteer: 0.6,
  minSteer: 0.14,
  steerRate: 6,
  frictionSlip: 2.2,
  sideFriction: 1.4,
  driftSideFriction: 0.45,
  downforce: 60,
};

// Patrol car: as quick off the line as the player but a little slower flat out, so a clean
// driver can pull away on a straight.
export const COP_PATROL_SPEC: VehicleSpec = {
  ...PLAYER_SPEC,
  name: 'Patrol',
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
