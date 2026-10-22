import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { addDebrisColliders, buildModels, debrisParts, modelKey } from './PropSystem';
import { CAR_GROUPS } from '../vehicles/Vehicle';
import { propSpec, type SignVariant, type StreetProp } from './StreetProps';

const VARIANTS: SignVariant[] = ['stop', 'priority', 'speed30', 'children', 'pedestrian'];
/** Props with pieces reaching past the pole, in every model they come in. */
const TALL = [
  ...[undefined, 'old' as const].flatMap((style) => [
    ...VARIANTS.map((variant) => ({ kind: 'sign', variant, style })),
    { kind: 'signal', style },
    { kind: 'signal', armRight: true, style },
  ]),
  { kind: 'lamp' },
  { kind: 'signpost' },
  { kind: 'oilLamp' },
  { kind: 'dragonLamp' },
  { kind: 'umbrella' },
  { kind: 'boomGate' },
].map((p) => ({ x: 0, z: 0, yaw: 0, ...p }) as StreetProp);

const models = buildModels({ leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: false });

function vertices(p: StreetProp): THREE.Vector3[] {
  const pos = models[modelKey(p)].getAttribute('position');
  return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
}

/** How far a point of the model lies outside the pole's box and every debris part. */
function outside(p: StreetProp, v: THREE.Vector3): number {
  const s = propSpec(p);
  const base = p.kind === 'boomGate' ? { x: -3.4, y: 0.6, z: 0, hx: 0.25, hy: 0.6, hz: 0.25 } : { x: 0, y: s.height / 2, z: 0, hx: s.hx, hy: s.height / 2, hz: s.hz };
  const boxes = [{ ...base, yaw: 0, round: false }, ...debrisParts(p)];
  return Math.min(
    ...boxes.map((b) => {
      const c = Math.cos(b.yaw ?? 0);
      const sn = Math.sin(b.yaw ?? 0);
      const dx = (v.x - b.x) * c - (v.z - b.z) * sn;
      const dz = (v.x - b.x) * sn + (v.z - b.z) * c;
      const ey = Math.max(0, Math.abs(v.y - b.y) - b.hy);
      const exz = b.round ? Math.max(0, Math.hypot(dx, dz) - b.hx) : Math.hypot(Math.max(0, Math.abs(dx) - b.hx), Math.max(0, Math.abs(dz) - b.hz));
      return Math.hypot(ey, exz);
    }),
  );
}

/** The intact collider PropSystem gives the prop: its pole's box, or a boom gate's post. */
function pole(p: StreetProp): RAPIER.ColliderDesc {
  const s = propSpec(p);
  if (p.kind === 'boomGate') return RAPIER.ColliderDesc.cuboid(0.25, 0.6, 0.25).setTranslation(-3.4, 0.6, 0).setMass(s.mass).setFriction(0.6);
  return RAPIER.ColliderDesc.cuboid(s.hx, s.height / 2, s.hz).setTranslation(0, s.height / 2, 0).setMass(s.mass).setFriction(0.6);
}

/** Drop the prop lying down (from above its reach) onto flat ground, as PropSystem builds its debris; its lowest vertex once settled. */
function settle(p: StreetProp, roll: THREE.Quaternion, parts: boolean): number {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0).setFriction(0.6));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 4.5, 0).setRotation(roll));
  world.createCollider(pole(p), body);
  if (parts) addDebrisColliders(world, body, p);
  for (let i = 0; i < 300; i++) world.step();
  const t = body.translation();
  const r = body.rotation();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion(r.x, r.y, r.z, r.w), new THREE.Vector3(1, 1, 1));
  const low = Math.min(...vertices(p).map((v) => v.applyMatrix4(m).y));
  world.free();
  return low;
}

/** Laid on its back, front and either side: whatever reaches out lands underneath one of them. */
const ROLLS = [
  [1, 0, 0, Math.PI / 2],
  [1, 0, 0, -Math.PI / 2],
  [0, 0, 1, Math.PI / 2],
  [0, 0, 1, -Math.PI / 2],
].map(([x, y, z, a]) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z), a));

describe('PropSystem debris colliders', () => {
  beforeAll(() => RAPIER.init());

  it('cover the whole model of every tall prop', () => {
    for (const p of TALL) {
      const worst = Math.max(...vertices(p).map((v) => outside(p, v)));
      expect(worst, modelKey(p)).toBeLessThan(0.06);
    }
  });

  it('keep a fallen prop on top of the ground, whichever way it lands', () => {
    for (const p of TALL) {
      for (const roll of ROLLS) expect(settle(p, roll, true), modelKey(p)).toBeGreaterThan(-0.06);
    }
  });

  it('are what holds it up: on its bare pole the lamp head and signal arm sink', () => {
    const lowest = (p: StreetProp) => Math.min(...ROLLS.map((roll) => settle(p, roll, false)));
    expect(lowest(TALL.find((p) => p.kind === 'lamp')!)).toBeLessThan(-0.5);
    expect(lowest(TALL.find((p) => p.kind === 'signal')!)).toBeLessThan(-1);
    expect(lowest(TALL.find((p) => p.kind === 'boomGate')!)).toBeLessThan(-1);
  });

  it("let cars through a fallen boom gate's arm", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const debris = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const p = { kind: 'boomGate', x: 0, z: 0, yaw: 0 } as StreetProp;
    addDebrisColliders(world, debris, p);
    const car = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const chassis = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 2).setTranslation(0, 1, 0).setCollisionGroups(CAR_GROUPS), car);
    world.step();
    let touching = 0;
    world.contactPairsWith(chassis, (other) => world.contactPair(chassis, other, (m) => (touching += m.numContacts())));
    const ray = new RAPIER.Ray({ x: 0, y: 1, z: -5 }, { x: 0, y: 0, z: 1 });
    expect(touching).toBe(0);
    expect(world.castRay(ray, 10, true, undefined, CAR_GROUPS, chassis)).toBeNull();
    expect(world.castRay(ray, 10, true, undefined, undefined, chassis)).not.toBeNull(); // still there for everything else
    world.free();
  });
});
