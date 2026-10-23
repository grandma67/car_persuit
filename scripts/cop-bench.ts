// One cop chase benchmark run (`npm run cops` runs three of these and compares; see knowledge/COPS_DEV.md):
//   node scripts/run-ts.mjs scripts/cop-bench.ts [stars=3] [seeds=24] [secs=120] [maxBlocks=12] [ghost] [diag=hits|uturns|recovers] [verbose]
// Real cities (the game's per-seed grid, flat ones no wider than maxBlocks), 30 civilians, street
// props as fixed boxes, a scripted suspect driving to far junctions, and the real CopDirector at a
// star level. `ghost`: the suspect and the cops pass through each other, so the suspect never gets
// pinned and the run measures how well cops keep up. Prints per-city averages as `RESULT {json}`.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Rng } from '../src/core/Rng';
import { WANTED } from '../src/gameplay/balance';
import { CivilianTraffic } from '../src/ai/CivilianTraffic';
import { CopDirector, DIRECTOR_TUNING, type Cop } from '../src/ai/CopDirector';
import { COP_TUNING, CopController, planRouteIds } from '../src/ai/CopController';
import { NavGrid } from '../src/ai/NavGrid';
import { staticLineOfSight } from '../src/ai/lineOfSight';
import { Vehicle } from '../src/vehicles/Vehicle';
import { PLAYER_SPEC } from '../src/vehicles/VehicleSpecs';
import { DEFAULT_CITY, generateCity, rollCityBlocks, type CityData } from '../src/world/CityGenerator';
import { propSpec } from '../src/world/StreetProps';
import { approachControls, busStops, fastStreets } from '../src/world/TrafficControl';
import { keepOf } from '../src/world/driveSide';
import { districtTraffic } from '../src/world/districts/runtime';
import { cityWorld } from '../src/world/districts/trafficSim';

const DT = 1 / 60;
const FAR = 30; // metres from the suspect: contacts and recoveries past this are en route, not the scrum round them
const NEAR = 25; // "a cop is on them"
const FAST = 8; // m/s: a hit at this speed or more does damage (props: breaks them)
const FAST_COP = 6; // m/s closing speed between two cops
const U_TURN = 2.6; // radians of heading swing…
const U_TURN_WITHIN = 25; // …within this many metres driven
const DEBOUNCE = 1; // seconds: a pair that touches again this soon is the same contact
/** Trace letters for the diag examples. */
const STATE_LETTER: Record<string, string> = { navigate: 'n', chase: 'c', ram: 'R', recover: 'v', backoff: 'b' };

type Opts = { stars: number; seeds: number; secs: number; maxBlocks: number; ghost: boolean; diag: string; verbose: boolean };

function parse(args: string[]): Opts {
  const o: Opts = { stars: 3, seeds: 24, secs: 120, maxBlocks: 12, ghost: false, diag: '', verbose: false };
  for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, ''];
    if (k === 'ghost') o.ghost = true;
    else if (k === 'verbose') o.verbose = true;
    else if (k === 'diag') o.diag = v;
    else if (k in o) (o as Record<string, unknown>)[k] = Number(v);
  }
  return o;
}

const cityOf = (seed: number) => generateCity(seed, { ...DEFAULT_CITY, blocks: rollCityBlocks(seed) });

/** The benchmark's cities: seeds i * 7919 + 11 (as the tests) that are flat, canal-free and small. */
export function benchSeeds(count: number, maxBlocks: number): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < count && i < 600; i++) {
    const seed = i * 7919 + 11;
    if (rollCityBlocks(seed) > maxBlocks) continue;
    const c = cityOf(seed);
    if (!c.terrain.hill && !c.terrain.canals.length) out.push(seed);
  }
  return out;
}

export default async function (args: string[]): Promise<void> {
  await RAPIER.init();
  const o = parse(args);
  const seeds = benchSeeds(o.seeds, o.maxBlocks);
  const sum: Record<string, number> = {};
  const diag: Diag = { events: 0, tally: new Map(), examples: [] };
  for (const seed of seeds) {
    const r = run(seed, o, diag);
    if (o.verbose) console.log(JSON.stringify({ seed, ...r }));
    for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
  }
  if (o.diag) {
    console.log(`diag=${o.diag}: ${diag.events} events`);
    for (const [field, counts] of diag.tally) {
      const row = [...counts].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${Math.round((n / diag.events) * 100)}%`);
      console.log(`  ${field.padEnd(9)} ${row.join(', ')}`);
    }
    if (diag.examples.length) console.log('examples, every 1/6 s, oldest first: state (n navigate, c chase, R ram, v recover, b backoff) + m/s + T throttle, B brake/reverse, H handbrake');
    for (const e of diag.examples.slice(0, 12)) console.log('  ' + e);
  }
  const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round((v / seeds.length) * 10) / 10]));
  console.log('RESULT ' + JSON.stringify({ cities: seeds.length, ...avg }));
}

type Diag = { events: number; tally: Map<string, Map<string, number>>; examples: string[] };

function run(seed: number, o: Opts, diag: Diag): Record<string, number> {
  /** One diagnosed event: each field tallied on its own, plus an example line. */
  const note = (fields: Record<string, string>, example?: string) => {
    diag.events++;
    for (const [k, v] of Object.entries(fields)) {
      const counts = diag.tally.get(k) ?? new Map<string, number>();
      counts.set(v, (counts.get(v) ?? 0) + 1);
      diag.tally.set(k, counts);
    }
    if (example && diag.examples.length < 40 && diag.events % 3 === 1) diag.examples.push(`seed ${seed}: ${example}`);
  };
  const city = cityOf(seed);
  const world = cityWorld(city);
  const props = propColliders(world, city);
  const graph = city.graph;
  const rng = new Rng(seed ^ 0x51);
  const randomNode = () => graph.nodes[Math.floor(rng.next() * graph.nodes.length)];

  // The suspect: a cop brain without feelers or sight, driving from one far junction to the next.
  const start = randomNode();
  const player = new Vehicle(world, PLAYER_SPEC, { x: start.x, y: 1, z: start.z }, 0);
  const driver = new CopController(player, graph, () => false, { ...COP_TUNING, catchUp: 1, interceptTime: 0 });
  const pickGoal = () => {
    for (let k = 0; k < 50; k++) {
      const n = randomNode();
      if (Math.hypot(n.x - player.position.x, n.z - player.position.z) > 250) return n;
    }
    return randomNode();
  };
  let goal = pickGoal();
  const goalTarget = { position: new THREE.Vector3(goal.x, 0, goal.z), velocity: new THREE.Vector3() };

  const traffic = new CivilianTraffic(
    world, new THREE.Scene(), graph, approachControls(graph, city.streetProps), new Rng(seed ^ 0x7a4f1c), 0,
    undefined, keepOf(city.driveSide), fastStreets(graph, city.streetProps), busStops(graph, city.streetProps), districtTraffic(city),
  );
  traffic.count = 30;
  const director = new CopDirector(world, new THREE.Scene(), graph, staticLineOfSight(world), new Rng(seed ^ 0xc095), 0, { ...DIRECTOR_TUNING, firstSpawnDelay: 1 }, undefined, keepOf(city.driveSide), {
    nav: new NavGrid(city),
    ignore: (c) => c.parent()?.handle === player.body.handle,
  });
  const level = WANTED[Math.min(5, Math.max(1, o.stars)) - 1];
  const target = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
  const fwd = new THREE.Vector3();
  let route: number[] | null = null;

  const m = {
    near: 0, meanDist: 0, firstNear: o.secs, suspectSpeed: 0, playerHits: 0,
    civHits: 0, copHits: 0, propHits: 0, wallHits: 0, farCiv: 0, farCop: 0, farProp: 0, farWall: 0,
    fastHits: 0, fastCop: 0, recovers: 0, farRecovers: 0, uTurns: 0, respawns: 0, suspectResets: 0,
  };
  let distSamples = 0;
  const touching = new Set<string>();
  const lastTouch = new Map<string, number>();
  type CopTrack = { state: string; pos: THREE.Vector3; travelled: number; headings: { h: number; at: number; t: number }[]; lastUTurn: number; trail: string[] };
  const tracks = new Map<Cop, CopTrack>();

  for (let step = 0; step < o.secs / DT; step++) {
    const t = step * DT;
    const lv = player.body.linvel();
    target.position.copy(player.position);
    target.velocity.set(lv.x, 0, lv.z);
    // Off the island (the bench has no sea to sink in): back onto a junction, or every cop is leashed every frame.
    const half = city.islandSize / 2;
    if (Math.max(Math.abs(player.position.x), Math.abs(player.position.z)) > half) {
      const n = randomNode();
      player.body.setTranslation({ x: n.x, y: 1, z: n.z }, true);
      player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.snapshot();
      m.suspectResets++;
    }
    if (Math.hypot(goal.x - player.position.x, goal.z - player.position.z) < 25) {
      goal = pickGoal();
      goalTarget.position.set(goal.x, 0, goal.z);
    }
    const active = director.activeCops;
    if (o.ghost) {
      // Suspect in group 1, cops in group 2: they never touch.
      player.collider.setCollisionGroups((0x0002 << 16) | (0xffff & ~0x0004));
      for (const cop of director.cops) cop.vehicle.collider.setCollisionGroups((0x0004 << 16) | (0xffff & ~0x0002));
    }
    player.drive(driver.update(DT, goalTarget), DT);
    for (const car of traffic.cars) car.vehicle.drive(car.controller.update(DT, t), DT);
    for (const cop of active) cop.vehicle.drive(cop.controller.update(DT, target), DT);
    world.step();
    player.snapshot();
    for (const car of traffic.cars) car.vehicle.snapshot();
    for (const cop of director.cops) cop.vehicle.snapshot();

    const civ = new Set(traffic.cars.map((c) => c.vehicle.collider.handle));
    const cops = new Set(active.map((c) => c.vehicle.collider.handle));
    const kindOf = (h: number) => (civ.has(h) ? 'civ' : cops.has(h) ? 'cop' : props.has(h) ? 'prop:' + props.get(h) : h === player.collider.handle ? 'suspect' : 'wall');
    const now = new Set<string>();
    let nearest = Infinity;
    for (const cop of active) {
      const v = cop.vehicle;
      const d = Math.hypot(v.position.x - player.position.x, v.position.z - player.position.z);
      nearest = Math.min(nearest, d);
      const st = cop.controller.state;
      let tr = tracks.get(cop);
      if (!tr) tracks.set(cop, (tr = { state: st, pos: v.position.clone(), travelled: 0, headings: [], lastUTurn: -99, trail: [] }));
      const moved = tr.pos.distanceTo(v.position);
      if (moved > 20) m.respawns++; // moved back into play by the director
      else tr.travelled += moved;
      tr.pos.copy(v.position);
      if (step % 10 === 0) {
        const li = v.lastInput;
        tr.trail.push(`${STATE_LETTER[st]}${v.speed.toFixed(0)}${li.throttle ? 'T' : ''}${li.brake ? 'B' : ''}${li.handbrake ? 'H' : ''}`);
        if (tr.trail.length > 12) tr.trail.shift();
      }

      if (st === 'recover' && tr.state !== 'recover') {
        m.recovers++;
        if (d > FAR) {
          m.farRecovers++;
          if (o.diag === 'recovers') {
            const touch: string[] = [];
            world.contactPairsWith(v.collider, (other) => void (other.handle !== 0 && touch.push(kindOf(other.handle))));
            const plan = cop.controller.debug().onGrid ? 'grid' : 'road';
            note({ touching: touch.sort().join('+') || 'nothing', plan }, `touching ${touch.join('+') || 'nothing'}, ${plan} | ${tr.trail.join(' ')}`);
          }
        }
      }
      tr.state = st;

      // A U-turn: the heading swings past U_TURN within U_TURN_WITHIN metres, away from the suspect, not reversing out.
      if (step % 15 === 0) {
        const f = v.forward(fwd);
        const h = Math.atan2(f.x, f.z);
        tr.headings.push({ h, at: tr.travelled, t });
        while (tr.headings.length && (tr.headings[0].t < t - 8 || tr.headings[0].at < tr.travelled - U_TURN_WITHIN)) tr.headings.shift();
        if (d > FAR && st !== 'recover' && st !== 'backoff' && t - tr.lastUTurn > 6) {
          const swung = tr.headings.some((e) => {
            const dh = Math.abs(h - e.h);
            return Math.min(dh, 2 * Math.PI - dh) > U_TURN;
          });
          if (swung) {
            m.uTurns++;
            tr.lastUTurn = t;
            if (o.diag === 'uturns') {
              const plan = cop.controller.debug().onGrid ? 'grid' : 'road';
              const crashed = tr.trail.some((e, i) => i > 0 && /^\w0/.test(e) && Number(tr.trail[i - 1].match(/-?\d+/)![0]) > 6);
              note({ plan, suspect: `${Math.round(d / 50) * 50}m`, before: crashed ? 'crash stop' : tr.trail.some((e) => e[0] === 'v' || e[0] === 'b') ? 'reversed' : 'driven' }, `${plan} ${Math.round(d)} m | ${tr.trail.join(' ')}`);
            }
          }
        }
      }

      world.contactPairsWith(v.collider, (other) => {
        if (other.handle === 0) return; // the ground
        let touched = false;
        world.contactPair(v.collider, other, (man) => {
          for (let c = 0; c < man.numContacts(); c++) if (man.contactDist(c) < 0.05) touched = true;
        });
        if (!touched) return;
        const a = v.collider.handle;
        const b = other.handle;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        now.add(key);
        const again = touching.has(key) || t - (lastTouch.get(key) ?? -9) < DEBOUNCE;
        lastTouch.set(key, t);
        if (again) return;
        const kind = kindOf(b);
        const far = d > FAR;
        if (kind === 'suspect') m.playerHits++;
        else if (kind === 'cop') {
          if (a > b) return; // each pair once
          m.copHits++;
          if (far) m.farCop++;
          const ov = other.parent()!.linvel();
          const cv = v.body.linvel();
          if (Math.hypot(cv.x - ov.x, cv.z - ov.z) > FAST_COP) m.fastCop++;
          return;
        } else {
          const field = kind === 'civ' ? 'civ' : kind === 'wall' ? 'wall' : 'prop';
          m[`${field}Hits` as 'civHits']++;
          if (far) m[`far${field[0].toUpperCase()}${field.slice(1)}` as 'farCiv']++;
          if (Math.abs(v.speed) > FAST) {
            m.fastHits++;
            if (o.diag === 'hits') {
              const dbg = cop.controller.debug();
              const cv = v.body.linvel();
              const f = v.forward(fwd);
              const slide = Math.abs(cv.x * f.z - cv.z * f.x) > 3 ? 'sliding' : 'gripping';
              const off = graph.nearestEdge(v.position.x, v.position.z).off;
              const where = off > 7.5 ? 'off-road' : off > 4 ? 'at kerb' : 'in road';
              const bend = dbg.toCorner < 15 ? 'at a bend' : 'straight';
              const seen = dbg.dodgeSpeed < Infinity ? 'feelers saw it' : 'feelers clear';
              note({ hit: kind, state: st, speed: `${Math.round(Math.abs(v.speed) / 5) * 5} m/s`, tyres: slide, where, path: bend, plan: dbg.onGrid ? 'grid' : 'road', feelers: seen });
            }
          }
        }
      });
    }
    touching.clear();
    for (const k of now) touching.add(k);
    if (nearest < Infinity) {
      m.meanDist += Math.min(nearest, 260);
      distSamples++;
      if (nearest < NEAR) {
        m.near += DT;
        m.firstNear = Math.min(m.firstNear, t);
      }
    }
    m.suspectSpeed += (Math.abs(player.speed) * DT) / o.secs;

    // Housekeeping at the game's frame rate (15 Hz here is plenty).
    if (step % 4 === 0) {
      traffic.update(player.position, [player, ...active.map((c) => c.vehicle)]);
      if (step % 60 === 0) route = planRouteIds(graph, player.position, player.forward(fwd), Math.abs(player.speed), goal, COP_TUNING).ids;
      director.update(4 * DT, target, player.forward(fwd), level, route, null);
    }
  }
  m.meanDist /= Math.max(1, distSamples);
  return m;
}

/** Street props as fixed boxes (unbreakable, unlike the game's): collider handle → prop kind. */
function propColliders(world: RAPIER.World, city: CityData): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of city.streetProps) {
    const s = propSpec(p);
    if (s.height < 0.3) continue;
    const rot = { x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) };
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(s.hx, s.height / 2, s.hz).setTranslation(p.x, s.height / 2, p.z).setRotation(rot));
    out.set(c.handle, p.kind);
  }
  return out;
}
