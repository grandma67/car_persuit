// The witch house's block: a crooked two-storey stilt house on a dry island in the middle of the
// biggest pool, its porch facing a rickety boardwalk that runs out from the nearest street (a
// raised deck the car can drive, ramped at both ends, landing on the island before the porch).
// A cauldron on the porch, a pumpkin patch, two jack-o'-lanterns by the steps, a stick totem.
// No figure, no real occult symbols. Pure data; drawn by render/districts/SwampWitch.ts.
import type { Rng } from '../../core/Rng';
import { SWAMP } from '../../gameplay/balance';
import type { CityData, Rect } from '../CityGenerator';
import type { Deck } from '../Deck';
import { inDeck } from '../Deck';
import { footprintsOverlap, propFootprint, type Footprint, type StreetProp } from '../StreetProps';
import type { ShallowWater } from '../Water';
import type { Structure } from './District';
import { shuffle } from './place';
import { streetSidesOf } from './Megapark';

export interface WitchLayout {
  structures: Structure[]; // the house (data: porch, cauldron, facing)
  solids: Footprint[];
  decks: Deck[];
  props: StreetProp[];
  /** The sidewalk strip in front of the boardwalk: the city's clutter leaves it. */
  mouth: Rect;
}

/** Local (u across, v along a yaw's local Z) to world. */
const local = (x: number, z: number, yaw: number, u: number, v: number) => ({ x: x + u * Math.cos(yaw) + v * Math.sin(yaw), z: z - u * Math.sin(yaw) + v * Math.cos(yaw) });

/**
 * Lay the house on `pool` (given its island here) in block `k`, whose inside the sidewalk line is
 * `inner`; the boardwalk from the street side nearest the pool's middle.
 */
export function layWitch(city: CityData, k: number, inner: Rect, pool: ShallowWater, rng: Rng): WitchLayout {
  const I = SWAMP.witchIsland;
  pool.island = I;
  const sides = streetSidesOf(k, city);
  // The street side whose sidewalk line is nearest the island (ties: any).
  const reach = (s: { nx: number; nz: number }) => (s.nx ? inner.w / 2 - s.nx * (pool.x - inner.x) : inner.d / 2 - s.nz * (pool.z - inner.z));
  shuffle(sides, rng);
  const side = sides.reduce((a, b) => (reach(b) < reach(a) - 0.5 ? b : a), sides[0] ?? { nx: 0, nz: 1, bit: 1 });
  // The boardwalk: local +Z from the street towards the island's middle.
  const sx = side.nx ? inner.x + (side.nx * inner.w) / 2 : pool.x;
  const sz = side.nx ? pool.z : inner.z + (side.nz * inner.d) / 2;
  const dx = -side.nx, dz = -side.nz;
  const dist = Math.hypot(pool.x - sx, pool.z - sz);
  const [r0, r1] = SWAMP.deckRamps;
  const L = dist - I + r1 - 0.5; // the island-end ramp lands r1 - 0.5 m onto the island
  const yaw = Math.atan2(dx, dz);
  const half = SWAMP.deck.width / 2;
  const deck: Deck = { x: sx + (dx * L) / 2, z: sz + (dz * L) / 2, yaw, hx: half, hz: L / 2, top: SWAMP.deck.top, ramps: [r0, r1] };
  // The house: set back from the middle, facing the boardwalk (its local +Z towards the street).
  const H = SWAMP.house;
  const hx = pool.x + dx * H.back, hz = pool.z + dz * H.back;
  const hyaw = Math.atan2(-dx, -dz);
  const lean = rng.range(-0.06, 0.06); // the whole house turned a little off true
  const solid: Footprint = { ...local(hx, hz, hyaw + lean, 0, H.porch / 2), hx: H.w / 2, hz: (H.d + H.porch) / 2, yaw: hyaw + lean };
  const house: Structure = {
    kind: 'witchHouse', x: hx, z: hz, yaw: hyaw + lean, footprints: [solid],
    data: { w: H.w, d: H.d, porch: H.porch, stilts: H.stilts, h: H.h, chimneySide: rng.next() < 0.5 ? -1 : 1, patches: rng.int(2, 4), seed: rng.int(1, 1e6) },
  };
  // Props: two jack-o'-lanterns at the porch steps, a pumpkin patch and a stick totem round the island.
  const props: StreetProp[] = [];
  for (const u of [-1, 1]) {
    const p = local(hx, hz, hyaw + lean, u * (H.w / 2 - 0.4), H.d / 2 + H.porch + 0.7);
    props.push({ kind: 'jackOLantern', x: p.x, z: p.z, yaw: hyaw + lean });
  }
  const busy = (f: Footprint) => footprintsOverlap(f, { ...solid, hx: solid.hx + 0.5, hz: solid.hz + 0.5 }) || inDeck(deck, f.x, f.z, 1.2)
    || props.some((o) => footprintsOverlap(f, propFootprint(o, 0.25)));
  const onIsland = (x: number, z: number, r: number) => Math.hypot(x - pool.x, z - pool.z) < I - r - 0.4;
  const totemAt = rng.range(0, Math.PI * 2);
  for (let tries = 0; tries < 12; tries++) {
    const a = totemAt + tries * 0.5, r = I - 1.4;
    const t: StreetProp = { kind: 'scarecrow', x: pool.x + Math.cos(a) * r, z: pool.z + Math.sin(a) * r, yaw: rng.range(0, Math.PI * 2) };
    if (!busy(propFootprint(t)) && onIsland(t.x, t.z, 0.3)) { props.push(t); break; }
  }
  // The patch: behind the house where there's room, else round its sides.
  const want = rng.int(SWAMP.pumpkins[0], SWAMP.pumpkins[1]);
  let laid = 0;
  for (let tries = 0; tries < 80 && laid < want; tries++) {
    const a = Math.atan2(dz, dx) + rng.range(-1.6, 1.6), r = rng.range(5, I - 0.8);
    const p: StreetProp = { kind: 'pumpkin', x: pool.x + Math.cos(a) * r, z: pool.z + Math.sin(a) * r, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.3) };
    if (!onIsland(p.x, p.z, 0.35) || busy(propFootprint(p))) continue;
    props.push(p);
    laid++;
  }
  // The sidewalk strip the boardwalk starts from.
  const sw = city.config.sidewalk;
  const mouth: Rect = side.nx
    ? { x: sx + (side.nx * sw) / 2, z: sz, w: sw, d: SWAMP.deck.width + 3 }
    : { x: sx, z: sz + (side.nz * sw) / 2, w: SWAMP.deck.width + 3, d: sw };
  return { structures: [house], solids: [solid], decks: [deck], props, mouth };
}
