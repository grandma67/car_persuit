// Tuning data for every vehicle type. Cops (M4/M5) get their own entries here.

export interface VehicleSpec {
  name: string;
  color: number;
  livery?: 'police';
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
  mass: 1350,
  engineForce: 4300,
  maxSpeed: 39, // ~140 km/h
};
