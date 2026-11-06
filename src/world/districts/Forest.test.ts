import { describe, expect, it } from 'vitest';
import { FOREST } from '../../gameplay/balance';
import { NavGrid } from '../../ai/NavGrid';
import { generateCity, type CityData } from '../CityGenerator';
import { alone, districtCities } from '../paramsTesting';
import { inRect, shrink } from '../lots';
import { softGroundOf } from '../softGround';
import { at } from './rules';
import { gateBlocks, mainGate, roleBlocks, streetSidesOf } from './Megapark';
import { forestClearings, forestTracks, FOREST_DEF, rangerBlock } from './Forest';
import { yardFrame } from './ForestSet';
import { DISTRICTS } from '../../gameplay/balance';
import { footprintsOverlap, rectFootprint } from '../StreetProps';
import { isJunctionControl } from './apply';
import { forestTrees, trackDistance } from './ForestWoods';
import { DISTRICT_DEFS } from './index';
import { LIT_PROPS, propFootprint, propSpec } from '../StreetProps';
import { joinRunDressing } from './runtime';
import { widestBody } from '../../vehicles/VehicleSpecs';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 11);
const ALONE = alone('forest');
const placed = SEEDS.flatMap((seed) => {
  const c = generateCity(seed, undefined, { force: ALONE });
  const q = c.districts.find((d) => d.kind === 'forest');
  return q ? [[seed, c, q] as const] : [];
});
const inner = (c: CityData, k: number) => shrink(c.blocks[k].rect, c.config.sidewalk);

// Shared rules (solids off the paving, junction controls, prop spacing, kerb offset, overhead
// clearance, stable per seed, a block apart, other rolls unmoved) are in DistrictRules.test.ts.

describe('Forest placement and roles', () => {
  it('places on most seeds when forced on', () => {
    expect(placed.length).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it.each(placed)('seed %i: on the island edge, residential and industrial, every block open ground with a role', (_seed, c, q) => {
    const { i0, j0, w, h } = q.grid;
    const n = c.config.blocks;
    expect(i0 === 0 || j0 === 0 || i0 + w === n || j0 + h === n).toBe(true);
    for (const k of q.blocks) expect(['residential', 'industrial']).toContain(c.blocks[k].zone);
    expect(q.blocks.every((k) => c.blocks[k].park)).toBe(true);
    expect(q.roles.size).toBe(q.blocks.length);
    expect(q.gates.length).toBeGreaterThanOrEqual(2);
    // Buildings: the ranger station, and the sawmill when there's a lumber yard.
    const lots = c.buildings.filter((b) => inRect(q.bounds, b)).map((b) => b.lot).sort();
    expect(lots).toEqual(q.features.lumberyard ? ['ranger', 'sawmill'] : ['ranger']);
  });

  it.each(placed)('seed %i: the lumber yard beside the main gate, the lookout deepest in (of the blocks a track can cross), one of each at most', (_seed, c, q) => {
    for (const role of ['lumberyard', 'lookout', 'campsite'] as const) {
      expect(roleBlocks(q, role).length).toBe(q.features[role] ? 1 : 0);
    }
    const g = mainGate(q);
    const [yard] = roleBlocks(q, 'lumberyard');
    const beside = gateBlocks(q, c, g);
    if (yard !== undefined && beside.length) expect(beside).toContain(yard);
    const [lookout] = roleBlocks(q, 'lookout');
    if (lookout === undefined) return;
    const far = (k: number) => Math.hypot(c.blocks[k].rect.x - g.x, c.blocks[k].rect.z - g.z);
    for (const k of q.blocks) if (k !== yard && streetSidesOf(k, c).length >= 2) expect(far(k)).toBeLessThanOrEqual(far(lookout) + 1e-6);
  });

  it('pinned features come true, on and off', () => {
    for (const name of ['lumberyard', 'lookout', 'campsite']) {
      for (const on of [true, false]) {
        for (const [seed, c, q] of districtCities('forest', [on ? name : `!${name}`])) {
          expect(q.features[name], `${name} seed ${seed}`).toBe(on);
          expect(FOREST_DEF.built!(q, c)[name], `${name} built, seed ${seed}`).toBe(on);
        }
      }
    }
  });
});

describe('Forest tracks and trees', () => {
  it.each(placed)('seed %i: tracks run sidewalk line to sidewalk line on street sides, wide enough, inside their block', (_seed, c, q) => {
    const breaks: string[] = [];
    const tracks = forestTracks(q);
    for (const t of tracks) {
      const room = inner(c, t.block);
      if (t.width < widestBody({ offRoad: true }) + 1) breaks.push(`track in ${t.block} ${t.width} m wide`);
      for (const p of t.points) if (!inRect(room, p, 0.01)) breaks.push(`track in ${t.block} leaves the block at ${at(p)}`);
      const sides = streetSidesOf(t.block, c);
      for (const end of [t.points[0], t.points[t.points.length - 1]]) {
        const on = sides.some((s) => (s.nx ? Math.abs(end.x - (room.x + (s.nx * room.w) / 2)) < 0.01 : Math.abs(end.z - (room.z + (s.nz * room.d) / 2)) < 0.01));
        if (!on) breaks.push(`track in ${t.block} ends at ${at(end)}, not on a street side`);
      }
      // The ends leave square to their sidewalk line, clear of the corners.
      const [a, b] = [t.points[0], t.points[1]];
      if (Math.hypot(a.x - b.x, a.z - b.z) < FOREST.trackLead - 1e-6) breaks.push(`track in ${t.block} turns at the mouth`);
      const square = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.z - b.z) < 1e-6;
      if (!square(a, b) || !square(t.points[t.points.length - 1], t.points[t.points.length - 2])) breaks.push(`track in ${t.block} leaves at a slant`);
    }
    // Every special block in the woods has its track (through the clearing); most woods blocks one.
    for (const k of [...roleBlocks(q, 'lookout'), ...roleBlocks(q, 'campsite')]) {
      if (!tracks.some((t) => t.block === k)) breaks.push(`no track in the ${q.roles.get(k)} block ${k}`);
      if (!forestClearings(q).some((g) => g.block === k)) breaks.push(`no clearing in the ${q.roles.get(k)} block ${k}`);
    }
    for (const k of roleBlocks(q, 'lumberyard')) if (tracks.some((t) => t.block === k)) breaks.push(`a track in the lumber yard ${k}`);
    expect(breaks).toEqual([]);
  });

  it('most woods blocks have a track', () => {
    const woods = placed.flatMap(([, c, q]) => roleBlocks(q, 'woods').map((k) => forestTracks(q).some((t) => t.block === k) && streetSidesOf(k, c).length >= 2));
    expect(woods.filter(Boolean).length / woods.length).toBeGreaterThan(FOREST.trackChance - 0.12);
  });

  it.each(placed)('seed %i: trees 3.4–6 m apart, inside the sidewalk line, off the tracks and out of the clearings; none in the yard', (_seed, c, q) => {
    const trees = forestTrees(q);
    const breaks: string[] = [];
    const tracks = forestTracks(q);
    const clearings = forestClearings(q);
    const yard = roleBlocks(q, 'lumberyard');
    for (const t of trees) {
      const k = q.blocks.find((b) => inRect(c.blocks[b].rect, t));
      if (k === undefined || !inRect(shrink(inner(c, k), FOREST.edge - 0.01), t)) breaks.push(`tree at ${at(t)} outside the woods`);
      if (k !== undefined && yard.includes(k)) breaks.push(`tree at ${at(t)} in the lumber yard`);
      if (t.tree !== 'pine' && t.tree !== 'round') breaks.push(`tree at ${at(t)} is a ${t.tree}`);
      const trunk = propSpec(t).hx;
      for (const tr of tracks) if (tr.block === k && trackDistance(tr, t) < tr.width / 2 + FOREST.trackClear + trunk - 1e-6) breaks.push(`tree at ${at(t)} on the track`);
      for (const g of clearings) if (Math.hypot(g.x - t.x, g.z - t.z) < g.r) breaks.push(`tree at ${at(t)} in a clearing`);
    }
    // Spacing: no two closer than twice the smallest disc.
    const sorted = [...trees].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].x - sorted[i].x < FOREST.spacing[0] * 2; j++) {
        if (Math.hypot(sorted[j].x - sorted[i].x, sorted[j].z - sorted[i].z) < FOREST.spacing[0] * 2 - 1e-6) breaks.push(`trees at ${at(sorted[i])} and ${at(sorted[j])} too close`);
      }
    }
    expect(breaks).toEqual([]);
    // Dense: a woods block holds a good many.
    for (const k of roleBlocks(q, 'woods')) expect(trees.filter((t) => inRect(c.blocks[k].rect, t)).length).toBeGreaterThan(50);
  });

  it.each(placed.slice(0, 8))('seed %i: no street lamps, benches or hydrants; nothing of the city\'s left inside the blocks; track mouths clear', (_seed, c, q) => {
    const own = new Set(q.dressing.props);
    const inside = c.streetProps.filter((p) => inRect(q.bounds, p));
    expect(inside.filter((p) => !own.has(p) && FOREST_DEF.drop(p)).map(at)).toEqual([]);
    const loose = inside.filter((p) => !own.has(p) && q.blocks.some((k) => inRect(inner(c, k), p)) && !['signal', 'sign'].includes(p.kind));
    expect(loose.map((p) => `${p.kind} ${at(p)}`)).toEqual([]);
  });

  it.each(placed.slice(0, 6))('seed %i: the forest floor is soft, tracks included', (_seed, c, q) => {
    const ground = softGroundOf(c, DISTRICT_DEFS, false)!;
    const floor = { grip: FOREST.floorGrip, drag: FOREST.floorDrag };
    for (const k of q.blocks) expect(ground.at(c.blocks[k].rect.x + 5, c.blocks[k].rect.z + 5)).toEqual(floor);
    for (const t of forestTracks(q)) expect(ground.at(t.points[3].x, t.points[3].z)).toEqual(floor);
    expect(ground.at(q.bounds.x + q.bounds.w * 10, q.bounds.z)).toBeNull();
  });
});

describe('Forest floor', () => {
  it.each(placed)('seed %i: ferns, fallen logs, boulders and stumps in the woods, off the tracks and out of the clearings', (_seed, c, q) => {
    const breaks: string[] = [];
    const tracks = forestTracks(q);
    const clearings = forestClearings(q);
    const pieces = [
      ...q.dressing.structures.filter((s) => s.kind === 'boulder').map((s) => ({ kind: s.kind, f: s.footprints[0] })),
      ...q.dressing.props.filter((p) => p.kind === 'log' || p.kind === 'stump').map((p) => ({ kind: p.kind, f: propFootprint(p) })),
    ];
    for (const { kind, f } of pieces) {
      const s = { kind };
      const k = q.blocks.find((b) => inRect(c.blocks[b].rect, f));
      if (k === undefined || q.roles.get(k) === 'lumberyard') breaks.push(`${s.kind} at ${at(f)} outside the woods`);
      for (const t of tracks) if (trackDistance(t, f) < t.width / 2 + FOREST.trackClear) breaks.push(`${s.kind} at ${at(f)} on a track`);
      for (const g of clearings) if (Math.hypot(g.x - f.x, g.z - f.z) < g.r) breaks.push(`${s.kind} at ${at(f)} in a clearing`);
    }
    const ferns = q.dressing.props.filter((p) => p.kind === 'fern');
    for (const p of ferns) for (const t of tracks) if (trackDistance(t, p) < t.width / 2) breaks.push(`fern at ${at(p)} on a track`);
    expect(breaks).toEqual([]);
    const woods = roleBlocks(q, 'woods').length;
    expect(ferns.length).toBeGreaterThanOrEqual(woods * 5);
    const logs = q.dressing.props.filter((p) => p.kind === 'log');
    expect(logs.length).toBeGreaterThanOrEqual(woods * 0.5);
    // A log is a prop a car can roll aside (heavy: it takes a real hit), not a solid structure.
    for (const p of logs) expect(propSpec(p).breakSpeed).toBeLessThan(Infinity);
    // So is a stump, not a solid: nothing left of them to drive into for good.
    expect(q.dressing.props.filter((p) => p.kind === 'stump').length).toBeGreaterThan(0);
    expect(q.dressing.structures.filter((s) => s.kind === 'stump')).toEqual([]);
  });
});

describe('Forest police routing', () => {
  it.each(placed.slice(0, 10))('seed %i: NavGrid crosses the woods only along a track or a clearing', (_seed, c, q) => {
    const nav = new NavGrid(c);
    const tracks = forestTracks(q);
    const clearings = forestClearings(q);
    const yard = new Set(roleBlocks(q, 'lumberyard'));
    const breaks: string[] = [];
    for (const k of q.blocks) {
      if (yard.has(k)) continue;
      const r = c.blocks[k].rect, room = shrink(r, c.config.sidewalk + 0.5);
      const t = tracks.find((t) => t.block === k);
      // Along its track (end to end), or straight across one without.
      const a = t ? t.points[0] : { x: r.x - r.w / 2 - 3, z: r.z }, b = t ? t.points[t.points.length - 1] : { x: r.x + r.w / 2 + 3, z: r.z };
      const path = nav.findPath(a, b, 300000);
      if (!path) {
        breaks.push(`no route by block ${k}`);
        continue;
      }
      for (let i = 1; i < path.length; i++) {
        const p0 = path[i - 1], p1 = path[i];
        const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z));
        for (let s = 0; s <= n; s++) {
          const p = { x: p0.x + ((p1.x - p0.x) * s) / Math.max(1, n), z: p0.z + ((p1.z - p0.z) * s) / Math.max(1, n) };
          if (!inRect(room, p)) continue;
          const onTrack = tracks.some((tr) => tr.block === k && trackDistance(tr, p) <= tr.width / 2 + 1.5);
          const inGlade = clearings.some((g) => Math.hypot(g.x - p.x, g.z - p.z) <= g.r + 1.5);
          if (!onTrack && !inGlade) breaks.push(`route through the woods of block ${k} at ${at(p)}`);
        }
      }
      if (t && !path.slice(1).some((p) => inRect(room, p))) {
        const len = path.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - path[i].x, p.z - path[i].z), 0);
        if (len > Math.hypot(b.x - a.x, b.z - a.z) * 3) breaks.push(`route by block ${k} goes round (${len.toFixed(0)} m), not along its track`);
      }
    }
    expect([...new Set(breaks)].slice(0, 8)).toEqual([]);
  });
});

describe('Forest set pieces', () => {
  it.each(placed)('seed %i: the sawmill at the yard\'s back, the ranger station by the main gate; tracks and trees clear of both', (_seed, c, q) => {
    const breaks: string[] = [];
    const sawmill = c.buildings.find((b) => b.lot === 'sawmill' && inRect(q.bounds, b));
    const [yard] = roleBlocks(q, 'lumberyard');
    if (sawmill) {
      if (!inRect(inner(c, yard), sawmill, 0.01)) breaks.push('sawmill outside its yard');
      // At the back: farther from the main gate's street than the yard's middle.
      const f = yardFrame(q, c, yard);
      const front = f.at(0, 0);
      if (Math.hypot(sawmill.x - front.x, sawmill.z - front.z) < 30) breaks.push('sawmill not at the back of the yard');
    }
    const ranger = c.buildings.find((b) => b.lot === 'ranger' && inRect(q.bounds, b))!;
    const k = rangerBlock(q, c)!;
    if (!inRect(inner(c, k), ranger, 0.01)) breaks.push('ranger station outside its block');
    expect(gateBlocks(q, c, mainGate(q))).toContain(k);
    for (const b of [sawmill, ranger]) {
      if (!b) continue;
      for (const t of forestTracks(q)) for (const p of t.points) if (footprintsOverlap({ x: p.x, z: p.z, hx: t.width / 2, hz: t.width / 2, yaw: 0 }, rectFootprint(b))) breaks.push(`track on the ${b.lot} at ${at(p)}`);
      for (const t of forestTrees(q)) if (footprintsOverlap({ x: t.x, z: t.z, hx: 0.5, hz: 0.5, yaw: 0 }, rectFootprint(b))) breaks.push(`tree in the ${b.lot} at ${at(t)}`);
    }
    expect(breaks).toEqual([]);
  });

  it.each(placed)('seed %i: a log arch over the main street (its board clear overhead), timber posts at the other gates', (_seed, c, q) => {
    const arches = q.dressing.structures.filter((s) => s.kind === 'logArch');
    expect(arches.length).toBeLessThanOrEqual(1);
    const posts = q.dressing.structures.filter((s) => s.kind === 'gatePosts');
    expect(posts.length + arches.length).toBe(q.gates.length);
    const board = q.dressing.overhead.find((o) => o.kind === 'archSign');
    if (arches.length) expect(board!.bottom).toBeGreaterThanOrEqual(DISTRICTS.overheadClearance);
    const paving = [...c.roads.map((r) => rectFootprint(r.rect)), ...c.intersections.map(rectFootprint)];
    const breaks = posts.flatMap((s) => s.footprints).filter((f) => paving.some((r) => footprintsOverlap(f, r))).map(at);
    expect(breaks).toEqual([]);
  });

  it.each(placed.filter(([, , q]) => q.features.lumberyard))('seed %i: the lumber yard: stacks in rows, corridors, apron and aisle wide enough and clear; a truck and a loader parked by the street', (_seed, c, q) => {
    const [yard] = roleBlocks(q, 'lumberyard');
    const room = inner(c, yard);
    const stacks = q.dressing.structures.filter((s) => s.kind === 'logStack');
    expect(stacks.length).toBeGreaterThanOrEqual(8);
    const breaks: string[] = [];
    const sawmill = c.buildings.find((b) => b.lot === 'sawmill' && inRect(q.bounds, b))!;
    const solids = q.dressing.solids;
    for (const s of stacks) {
      const f = s.footprints[0];
      if (!inRect(room, { x: f.x, z: f.z }, -Math.min(f.hx, f.hz))) breaks.push(`stack at ${at(s)} outside the yard`);
      if (footprintsOverlap(f, rectFootprint(sawmill))) breaks.push(`stack at ${at(s)} in the sawmill`);
    }
    const lane = widestBody({ offRoad: true }) + 1;
    for (const r of q.dressing.drivable) {
      if (Math.min(r.w, r.d) < lane - 1e-6) breaks.push(`corridor at ${at(r)} ${Math.min(r.w, r.d).toFixed(1)} m wide`);
      if (!inRect(room, r, 0.01)) breaks.push(`corridor at ${at(r)} leaves the yard`);
      for (const f of solids) if (footprintsOverlap(rectFootprint(shrink(r, 0.05)), f)) breaks.push(`corridor at ${at(r)} blocked by a ${q.dressing.structures.find((s) => s.footprints.includes(f))?.kind}`);
      if (footprintsOverlap(rectFootprint(shrink(r, 0.05)), rectFootprint(sawmill))) breaks.push(`corridor at ${at(r)} runs into the sawmill`);
    }
    for (const kind of ['logTruck', 'logLoader']) expect(q.dressing.structures.filter((s) => s.kind === kind)).toHaveLength(1);
    expect(breaks).toEqual([]);
  });

  it.each(placed.filter(([, , q]) => q.features.lookout))('seed %i: the lookout stands on four legs in its clearing, off the track', (_seed, _c, q) => {
    const towers = q.dressing.structures.filter((s) => s.kind === 'lookout');
    expect(towers).toHaveLength(1);
    const [k] = roleBlocks(q, 'lookout');
    const glade = forestClearings(q).find((g) => g.block === k)!;
    const track = forestTracks(q).find((t) => t.block === k)!;
    const legs = towers[0].footprints;
    expect(legs).toHaveLength(4);
    for (const f of legs) {
      expect(Math.hypot(f.x - glade.x, f.z - glade.z)).toBeLessThan(glade.r);
      expect(trackDistance(track, f)).toBeGreaterThan(track.width / 2 + 1);
    }
  });

  it.each(placed.filter(([, , q]) => q.features.campsite))('seed %i: the campsite: a fire pit and two tents or more in the clearing, off the track', (_seed, _c, q) => {
    const [k] = roleBlocks(q, 'campsite');
    const glade = forestClearings(q).find((g) => g.block === k)!;
    const track = forestTracks(q).find((t) => t.block === k)!;
    const pits = q.dressing.structures.filter((s) => s.kind === 'firePit');
    const tents = q.dressing.props.filter((p) => p.kind === 'tent');
    expect(pits).toHaveLength(1);
    expect(tents.length).toBeGreaterThanOrEqual(2);
    for (const f of [...pits.map((s) => s.footprints[0]), ...tents.map((p) => propFootprint(p))]) {
      expect(Math.hypot(f.x - glade.x, f.z - glade.z) + Math.hypot(f.hx, f.hz)).toBeLessThanOrEqual(glade.r);
      expect(trackDistance(track, f)).toBeGreaterThan(track.width / 2);
    }
  });

  it('pinned lumber yard, lookout and campsite all fit together', () => {
    for (const [seed, c, q] of districtCities('forest', ['lumberyard', 'lookout', 'campsite'])) {
      const built = FOREST_DEF.built!(q, c);
      expect(built, `seed ${seed}`).toEqual({ lumberyard: true, lookout: true, campsite: true });
      expect(q.dressing.structures.some((s) => s.kind === 'lookout'), `seed ${seed}`).toBe(true);
      expect(q.dressing.structures.some((s) => s.kind === 'firePit'), `seed ${seed}`).toBe(true);
      expect(c.streetProps.filter((p) => inRect(q.bounds, p) && isJunctionControl(p)).length).toBeGreaterThan(0);
    }
  });
});

describe('Forest night and climate', () => {
  it.each(placed)('seed %i: at night only the yard lamps, the campfire and the lookout\'s windows glow, within maxGlow', (_seed, c, q) => {
    const lit = c.streetProps.filter((p) => LIT_PROPS.has(p.kind) && inRect(q.bounds, p, 1));
    const own = new Set(q.dressing.props);
    expect(lit.filter((p) => !own.has(p)).map(at)).toEqual([]); // no street lamps left
    const renderer = q.dressing.structures.filter((s) => s.kind === 'firePit').length + q.dressing.structures.filter((s) => s.kind === 'lookout').length * 4;
    expect(lit.length + renderer).toBeLessThanOrEqual(FOREST.maxGlow);
  });

  it('trees by climate: all pine in the snow, palms by the beach, snags and cacti in the desert; no ferns in either', () => {
    const want: Record<string, string[]> = { temperate: ['pine', 'round'], snow: ['pine'], beach: ['palm', 'pine'], desert: ['cactus', 'snag'] };
    for (const [climate, kinds] of Object.entries(want)) {
      const [[, c, q]] = districtCities('forest', [climate], [11]);
      joinRunDressing(c, { night: false, climate });
      const trees = forestTrees(q);
      expect([...new Set(trees.map((t) => t.tree))].sort(), climate).toEqual(kinds);
      const ferns = q.dressing.props.filter((p) => p.kind === 'fern').length;
      if (climate === 'desert' || climate === 'snow') expect(ferns).toBe(0);
      else expect(ferns).toBeGreaterThan(0);
    }
  });
});
