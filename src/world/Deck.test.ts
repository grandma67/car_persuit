import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../vehicles/Vehicle';
import { COP_PATROL_SPEC, PLAYER_SPEC, type VehicleSpec } from '../vehicles/VehicleSpecs';
import { SWAMP } from '../gameplay/balance';
import type { DriveInput } from '../core/Input';
import { deckHeight, deckPoint, deckShapes, inDeck, type Deck } from './Deck';
import type { Terrain } from './Terrain';

const DT = 1 / 60;
const FLAT: Terrain = { hill: null, canals: [], bridges: [], land: [] };
/** A boardwalk along +Z from z = 10 to z = 40, as the witch house's. */
const DECK: Deck = { x: 0, z: 25, yaw: 0, hx: SWAMP.deck.width / 2, hz: 15, top: SWAMP.deck.top, ramps: SWAMP.deckRamps };

function world(deck: Deck): RAPIER.World {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(1));
  for (const s of deckShapes(deck, FLAT)) {
    const rot = { x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) };
    const desc = 'box' in s ? RAPIER.ColliderDesc.cuboid(...s.box) : RAPIER.ColliderDesc.convexHull(new Float32Array(s.hull))!;
    w.createCollider(desc.setTranslation(s.at.x, s.at.y, s.at.z).setRotation(rot).setFriction(1));
  }
  return w;
}

/** Drive along the deck's axis from `from` (local v) at `speed`, steering to hold the line; the highest point and where it ends. */
function drive(spec: VehicleSpec, deck: Deck, from: number, dir: 1 | -1, speed: number, seconds: number) {
  const w = world(deck);
  const start = deckPoint(deck, 0, from);
  const car = new Vehicle(w, spec, { x: start.x, y: 1, z: start.z });
  const heading = deck.yaw + (dir > 0 ? 0 : Math.PI);
  for (let i = 0; i < 30; i++) (car.drive({ throttle: 0, brake: 0, steer: 0, handbrake: false }, DT), w.step(), car.snapshot());
  car.teleport(start.x, car.position.y, start.z, heading, speed);
  let top = -Infinity, minSpeed = Infinity;
  for (let i = 0; i < seconds / DT; i++) {
    const input: DriveInput = { throttle: car.speed < speed ? 0.6 : 0, brake: 0, steer: Math.max(-1, Math.min(1, -car.position.x * 0.3 * dir)), handbrake: false };
    car.drive(input, DT);
    w.step();
    car.snapshot();
    if (inDeck(deck, car.position.x, car.position.z, -1)) top = Math.max(top, car.position.y);
    if (i > 30) minSpeed = Math.min(minSpeed, car.speed);
  }
  return { top, end: car.position, minSpeed, ground: car.position.y };
}

describe('raised deck', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('knows its outline and its height along it', () => {
    expect(inDeck(DECK, 0, 25)).toBe(true);
    expect(inDeck(DECK, DECK.hx + 0.1, 25)).toBe(false);
    expect(inDeck(DECK, 0, 9.9)).toBe(false);
    expect(deckHeight(DECK, FLAT, -15)).toBeCloseTo(0, 5);
    expect(deckHeight(DECK, FLAT, 0)).toBeCloseTo(SWAMP.deck.top, 5);
    expect(deckHeight(DECK, FLAT, 15)).toBeCloseTo(0, 5);
    const turned = { ...DECK, x: 0, z: 0, yaw: Math.PI / 2 }; // local Z along +X
    expect(deckPoint(turned, 0, 10).x).toBeCloseTo(10, 5);
    expect(inDeck(turned, 12, 0)).toBe(true);
  });

  it.each([[PLAYER_SPEC.name, PLAYER_SPEC], [COP_PATROL_SPEC.name, COP_PATROL_SPEC]] as const)('%s drives up the ramp, along the boards and off the far end, both ways', (_n, spec) => {
    for (const [from, dir] of [[-25, 1], [25, -1]] as const) {
      const run = drive(spec, DECK, from, dir, 8, 7);
      expect(run.top, `${spec.name} from ${from}`).toBeGreaterThan(SWAMP.deck.top + 0.3); // the body rode up on the deck
      expect(run.minSpeed, `${spec.name} from ${from}`).toBeGreaterThan(3); // never stopped at a lip
      expect(dir * (run.end.z - DECK.z), `${spec.name} from ${from}`).toBeGreaterThan(DECK.hz); // came off the far end
      expect(Math.abs(run.end.x)).toBeLessThan(DECK.hx + 1);
    }
  });
});
