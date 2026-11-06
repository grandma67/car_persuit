// The Swamp's growth: the wooded swamp has bald cypresses (half of them standing in the water) and
// dead snags; the open marsh a few weeping willows on the banks, the odd snag and far more reeds.
// Reed clumps round the pools' rims, half-sunk logs in the water (solid), lily pads on the calm
// water (the park pieces' pads). Trees and reeds are breakable props; everything keeps clear of the
// buildings, decks and set pieces (`clearOf` drops what doesn't fit, after what must exist). Pure data.
import type { Rng } from '../../core/Rng';
import { SWAMP } from '../../gameplay/balance';
import type { CityData } from '../CityGenerator';
import { shrink, inRect } from '../lots';
import type { LilyPad, ParkPiece } from '../ParkPieces';
import { footprintsOverlap, type Footprint, type StreetProp } from '../StreetProps';
import { inWater, rimPoints, shoreDistance, type ShallowWater } from '../Water';
import type { District, Structure } from './District';
import type { SwampLook } from './Swamp';

export interface WoodsLayout {
  props: StreetProp[];
  structures: Structure[]; // the logs
  solids: Footprint[];
  pieces: ParkPiece[]; // lily pads
}

const wet = (pools: ShallowWater[], x: number, z: number, margin = 0) => pools.some((w) => inWater(w, x, z, margin));

/** `avoid`: what the logs keep off (buildings, decks, solids); the props are cleared later. */
export function layWoods(q: District, city: CityData, look: SwampLook, pools: ShallowWater[], avoid: Footprint[], rng: Rng): WoodsLayout {
  const out: WoodsLayout = { props: [], structures: [], solids: [], pieces: [] };
  const sw = city.config.sidewalk;
  const n = city.config.blocks;
  const swamp = look === 'swamp';
  const T = SWAMP.woods[look];
  const island = pools.find((w) => w.island);
  const onIsland = (x: number, z: number) => !!island && Math.hypot(x - island.x, z - island.z) < (island.island ?? 0) + 1;
  for (const k of [...q.blocks].sort((a, b) => a - b)) {
    const inner = shrink(city.blocks[k].rect, sw + 0.8);
    const mine = pools.filter((w) => inRect(city.blocks[k].rect, w));
    const spot = (inWaterToo: boolean): { x: number; z: number } | null => {
      for (let t = 0; t < 12; t++) {
        const x = inner.x + rng.range(-inner.w / 2, inner.w / 2), z = inner.z + rng.range(-inner.d / 2, inner.d / 2);
        if (onIsland(x, z)) continue;
        const inside = wet(mine, x, z, -0.6);
        if (inside && !(inWaterToo && wet(mine, x, z, 1.2))) continue; // not on the shore line
        return { x, z };
      }
      return null;
    };
    // Trees: cypress stand in the water too; willows keep to the banks.
    for (let i = rng.int(T.trees[0], T.trees[1]); i > 0; i--) {
      const p = spot(swamp);
      if (p) out.props.push({ kind: 'tree', tree: swamp ? 'cypress' : 'willow', x: p.x, z: p.z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.2) });
    }
    for (let i = rng.int(T.snags[0], T.snags[1]); i > 0; i--) {
      const p = spot(true);
      if (p) out.props.push({ kind: 'tree', tree: 'snag', x: p.x, z: p.z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.15) });
    }
    // Reed clumps on the rims.
    for (const w of mine) {
      const rim = rimPoints(w, 48);
      for (let c = rng.int(T.reeds[0], T.reeds[1]); c > 0; c--) {
        const at = rng.int(0, rim.length - 1);
        for (let r = 0; r < 2; r++) {
          const p = rim[(at + r) % rim.length];
          const x = p.x + rng.range(-0.5, 0.5), z = p.z + rng.range(-0.5, 0.5);
          if (!inRect(inner, { x, z }) || onIsland(x, z)) continue;
          out.props.push({ kind: 'reeds', x, z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.4) });
        }
      }
    }
    // A half-sunk log now and then, well out in the water.
    if (mine.length && rng.next() < SWAMP.logChance) {
      const w = mine[0];
      for (let t = 0; t < 10; t++) {
        const x = w.x + rng.range(-w.rx, w.rx) * 0.7, z = w.z + rng.range(-w.rz, w.rz) * 0.7;
        const fp: Footprint = { x, z, hx: 0.35, hz: rng.range(1.8, 2.6), yaw: rng.range(0, Math.PI) };
        if (shoreDistance(w, x, z) < fp.hz + 0.5 || onIsland(x, z) || avoid.some((a) => footprintsOverlap(fp, { ...a, hx: a.hx + 1.5, hz: a.hz + 1.5 }))) continue;
        rng.range(0.15, 0.3), rng.int(1, 1e6); // the old sink and model seed: kept so the growth after them stays put
        // A prop along its local X (PROP_SPECS.sunkLog): half under the water as it lies on the bed.
        // First in the list: where a prop overlaps it, clearOf keeps the log and drops the other.
        out.props.unshift({ kind: 'sunkLog', x, z, yaw: fp.yaw + Math.PI / 2, scale: (fp.hz * 2) / 5 });
        avoid = [...avoid, fp];
        break;
      }
    }
    // Lily pads on the calm water, clear of the rim, the island and what stands in the water.
    for (const w of mine) {
      const pads: LilyPad[] = [];
      for (let t = 0; t < 60 && pads.length < T.pads; t++) {
        const x = w.x + rng.range(-w.rx, w.rx), z = w.z + rng.range(-w.rz, w.rz), r = rng.range(0.35, 0.7);
        if (shoreDistance(w, x, z) < 1 + r || avoid.some((a) => footprintsOverlap({ x, z, hx: r + 0.4, hz: r + 0.4, yaw: 0 }, a))) continue;
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.15)) continue;
        pads.push({ x, z, r, yaw: rng.range(0, Math.PI * 2) });
      }
      if (pads.length) out.pieces.push({ kind: 'pond', district: 'swamp', block: [k % n, Math.floor(k / n)], x: w.x, z: w.z, yaw: w.yaw, water: w, pads, stoneRim: false });
    }
  }
  return out;
}

/** The trees a dressed swamp planted, by kind. */
export const swampTrees = (q: District, kind?: string) => q.dressing.props.filter((p) => p.kind === 'tree' && (!kind || p.tree === kind));
