// The Swamp's set pieces besides the witch house: boardwalks on stilts across pool blocks from
// street to street (raised drivable decks, `world/Deck.ts`, wooden rail sections either side with
// gaps), and the landing behind the bait shop: a rotting jetty out into the pool, an airboat and a
// rowboat moored alongside. Pure data.
import type { Rng } from '../../core/Rng';
import { SWAMP } from '../../gameplay/balance';
import type { Building, CityData, Rect } from '../CityGenerator';
import type { Deck } from '../Deck';
import { shrink } from '../lots';
import { footprintsOverlap, rectFootprint, type Footprint, type StreetProp } from '../StreetProps';
import { inWater, type ShallowWater } from '../Water';
import type { District, Structure } from './District';
import { streetSides } from './Harbor';
import { spanFootprint } from './MegaparkLake';
import { roleBlocks } from './Megapark';
import { shuffle } from './place';

export interface BoardwalkLayout {
  decks: Deck[];
  props: StreetProp[]; // the rails
  mouths: Rect[]; // the sidewalk strips at each end: the city's clutter leaves them
}

/** Metres of `line` (sampled every metre) over water. */
function wetAlong(pools: ShallowWater[], x0: number, z0: number, dx: number, dz: number, len: number): number {
  let wet = 0;
  for (let t = 0; t <= len; t++) if (pools.some((w) => inWater(w, x0 + dx * t, z0 + dz * t))) wet++;
  return wet;
}

/**
 * Up to `want` boardwalks, one per pool block with streets on two opposite sides, straight across
 * from sidewalk line to sidewalk line where it crosses the most water and clears the shacks.
 */
export function layBoardwalks(q: District, city: CityData, pools: ShallowWater[], buildings: Building[], want: number, rng: Rng): BoardwalkLayout {
  const out: BoardwalkLayout = { decks: [], props: [], mouths: [] };
  const sw = city.config.sidewalk;
  const through = roleBlocks(q, 'pools').filter((k) => {
    const s = streetSides(k, city);
    return (s.px && s.nx) || (s.pz && s.nz);
  }).sort((a, b) => a - b);
  const blocks = [...through];
  shuffle(blocks, rng);
  const half = SWAMP.deck.width / 2;
  for (const k of blocks) {
    if (out.decks.length >= want) break;
    const inner = shrink(city.blocks[k].rect, sw);
    const s = streetSides(k, city);
    const alongX = s.px && s.nx && !(s.pz && s.nz && rng.next() < 0.5);
    const len = alongX ? inner.w : inner.d;
    const width = alongX ? inner.d : inner.w;
    // Candidate offsets across the block, clear of the corners; the wettest one clear of the shacks wins.
    let best: { deck: Deck; wet: number } | null = null;
    for (let c = 0; c < 9; c++) {
      const off = (c / 8 - 0.5) * (width - 2 * 9) + rng.range(-1, 1);
      const yaw = alongX ? Math.PI / 2 : 0; // local Z along +X or +Z
      const deck: Deck = { x: inner.x + (alongX ? 0 : off), z: inner.z + (alongX ? off : 0), yaw, hx: half, hz: len / 2, top: SWAMP.deck.top, ramps: SWAMP.boardwalkRamps };
      const pad: Footprint = { x: deck.x, z: deck.z, hx: half + 1.5, hz: deck.hz, yaw: deck.yaw };
      if (buildings.some((b) => footprintsOverlap(rectFootprint(b), pad))) continue;
      const x0 = alongX ? inner.x - len / 2 : deck.x, z0 = alongX ? deck.z : inner.z - len / 2;
      const wet = wetAlong(pools, x0, z0, alongX ? 1 : 0, alongX ? 0 : 1, len);
      if (!best || wet > best.wet) best = { deck, wet };
    }
    if (!best) continue;
    const d = best.deck;
    out.decks.push(d);
    // Rail sections either side of the flat run (fence rails: 2.9 m, local X along the deck), some missing.
    const [r0, r1] = d.ramps;
    const along = { x: Math.sin(d.yaw), z: Math.cos(d.yaw) }, across = { x: Math.cos(d.yaw), z: -Math.sin(d.yaw) };
    for (const u of [-1, 1]) {
      for (let v = -d.hz + r0 + 1.6; v < d.hz - r1 - 1.4; v += 3) {
        if (rng.next() < SWAMP.railGaps) continue;
        const x = d.x + along.x * v + across.x * u * (half + 0.15), z = d.z + along.z * v + across.z * u * (half + 0.15);
        out.props.push({ kind: 'fence', style: 'rail', x, z, yaw: d.yaw - Math.PI / 2 });
      }
    }
    // The sidewalk strips at both ends.
    for (const e of [-1, 1]) {
      out.mouths.push(alongX
        ? { x: inner.x + e * (inner.w / 2 + sw / 2), z: d.z, w: sw, d: SWAMP.deck.width + 3 }
        : { x: d.x, z: inner.z + e * (inner.d / 2 + sw / 2), w: SWAMP.deck.width + 3, d: sw });
    }
  }
  return out;
}

export interface LandingLayout {
  structures: Structure[]; // the jetty, the airboat, the rowboat
  solids: Footprint[];
}

/** The landing: a jetty from the bait shop's back straight out into the pool, boats alongside. */
export function layLanding(shop: Building, inner: Rect, pools: ShallowWater[], airboat: boolean, rng: Rng): LandingLayout {
  const structures: Structure[] = [];
  const solids: Footprint[] = [];
  // Out from the shop's back: the side facing the block's middle.
  const nx = Math.abs(shop.x - inner.x) > Math.abs(shop.z - inner.z) ? -Math.sign(shop.x - inner.x) : 0;
  const nz = nx ? 0 : -Math.sign(shop.z - inner.z);
  const [jw, jl] = SWAMP.jetty;
  const x0 = shop.x + nx * (shop.w / 2), z0 = shop.z + nz * (shop.d / 2);
  const x1 = x0 + nx * jl, z1 = z0 + nz * jl;
  const jetty = spanFootprint(x0, z0, x1, z1, jw / 2);
  structures.push({ kind: 'swampJetty', x: jetty.x, z: jetty.z, yaw: jetty.yaw, footprints: [jetty], data: { length: jl, width: jw, height: SWAMP.jettyHeight, seed: rng.int(1, 1e6) } });
  solids.push(jetty);
  // Boats either side of the jetty's outer half, bows out, where there's water.
  const tx = -nz, tz = nx;
  const sides = rng.next() < 0.5 ? [-1, 1] : [1, -1];
  const boats: [string, number, number, number][] = [['airboat', 1.3, 2.6, sides[0]], ['moored', 0.7, 1.75, sides[1]]];
  for (const [kind, hx, hz, side] of boats) {
    if (kind === 'airboat' && !airboat) continue;
    const along = jl * 0.68 + rng.range(-0.4, 0.4);
    const x = x0 + nx * along + tx * side * (jw / 2 + hx + 0.35), z = z0 + nz * along + tz * side * (jw / 2 + hx + 0.35);
    if (!pools.some((w) => inWater(w, x, z, 0.8))) continue;
    const fp: Footprint = { x, z, hx, hz, yaw: Math.atan2(nx, nz) + rng.range(-0.1, 0.1) };
    structures.push({ kind, x, z, yaw: fp.yaw, footprints: [fp] });
    solids.push(fp);
  }
  return { structures, solids };
}
