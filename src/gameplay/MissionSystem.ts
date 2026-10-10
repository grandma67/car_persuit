// Destinations, timer and win/lose. Pure logic — no Three.js — so it is unit-tested.
import type { Rng } from '../core/Rng';
import type { RoadGraph, RoadNode } from '../world/RoadGraph';
import { MISSION, type MissionConfig } from './balance';

export type MissionStatus = 'playing' | 'won' | 'lost';
export type LoseReason = 'time' | 'destroyed';
export type MissionEvent = 'reached' | 'won' | 'lost';

/** Pick sequential destinations, each min..max metres by road from the previous one. */
export function pickDestinations(graph: RoadGraph, rng: Rng, startId: number, cfg: MissionConfig = MISSION): RoadNode[] {
  const out: RoadNode[] = [];
  const used = new Set([startId]);
  let from = startId;
  for (let k = 0; k < cfg.destinations; k++) {
    const dist = graph.distancesFrom(from);
    const within = (min: number, max: number) =>
      graph.nodes.filter((n) => !used.has(n.id) && dist[n.id] >= min && dist[n.id] <= max);
    // Relax the range rather than fail on an unusual map.
    let candidates = within(cfg.minRouteDistance, cfg.maxRouteDistance);
    if (!candidates.length) candidates = within(cfg.minRouteDistance, Infinity);
    if (!candidates.length) candidates = within(0, Infinity);
    const next = rng.pick(candidates);
    out.push(next);
    used.add(next.id);
    from = next.id;
  }
  return out;
}

export class MissionSystem {
  index = 0;
  elapsed = 0;
  status: MissionStatus = 'playing';
  loseReason: LoseReason | null = null;

  constructor(
    readonly destinations: RoadNode[],
    private cfg: MissionConfig = MISSION,
  ) {}

  get current(): RoadNode | null {
    return this.status === 'playing' ? this.destinations[this.index] : null;
  }

  get timeLeft(): number {
    return Math.max(0, this.cfg.timeLimit - this.elapsed);
  }

  get total(): number {
    return this.destinations.length;
  }

  /** Advance the clock and check arrival at the player's position. */
  update(dt: number, x: number, z: number): MissionEvent | null {
    if (this.status !== 'playing') return null;
    this.elapsed = Math.min(this.elapsed + dt, this.cfg.timeLimit);

    const target = this.destinations[this.index];
    if (Math.hypot(target.x - x, target.z - z) <= this.cfg.reachRadius) {
      this.index++;
      if (this.index >= this.destinations.length) {
        this.status = 'won';
        return 'won';
      }
      return 'reached';
    }
    if (this.elapsed >= this.cfg.timeLimit) {
      this.fail('time');
      return 'lost';
    }
    return null;
  }

  fail(reason: LoseReason): void {
    if (this.status !== 'playing') return;
    this.status = 'lost';
    this.loseReason = reason;
  }
}

export interface Route {
  x: number; // point to steer toward
  z: number;
  distance: number; // metres by road
  path: number[]; // remaining node ids, starting at the aim point
}

/**
 * GPS guidance: the point to steer toward and the remaining road distance to `destId`.
 * Follows the road route, so guidance points at the next turn rather than through buildings.
 */
export function routeAim(graph: RoadGraph, x: number, z: number, destId: number): Route {
  const start = graph.nearest(x, z);
  const path = graph.path(start.id, destId) ?? [destId];
  // If we're already past the nearest node towards the next one, aim at the next one.
  let i = 0;
  if (path.length > 1) {
    const a = graph.nodes[path[0]];
    const b = graph.nodes[path[1]];
    if (Math.hypot(b.x - x, b.z - z) < Math.hypot(b.x - a.x, b.z - a.z)) i = 1;
  }
  const aim = graph.nodes[path[i]];
  const remaining = path.slice(i);
  const distance = Math.hypot(aim.x - x, aim.z - z) + graph.pathLength(remaining);
  return { x: aim.x, z: aim.z, distance, path: remaining };
}
