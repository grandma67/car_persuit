// A trace of one run: where the player drove and what happened along the way, for the map on the
// end screen. Pure logic — no Three.js — so it is unit-tested.

export type IncidentKind =
  | 'checkpoint' // reached a destination
  | 'wall' // drove hard into a building or the sea wall
  | 'rammed' // a cop rammed the player
  | 'whack' // the player rammed a cop
  | 'copWrecked' // a cop blew up or went into the water
  | 'civilian' // crashed into a civilian car
  | 'stars' // the wanted level went up
  | 'takeoff' // jumped off a ramp
  | 'landing' // came back down from a ramp jump
  | 'wrecked' // the player's car blew up
  | 'drowned' // the player went into the water
  | 'timeout'; // the clock ran out

export interface Incident {
  kind: IncidentKind;
  t: number; // seconds into the run
  x: number;
  z: number;
  detail: string;
}

export interface TrackPoint {
  x: number;
  z: number;
  t: number;
  speed: number; // m/s
  jump: boolean; // got here by teleport or reset, not by driving: no line from the previous point
}

const SAMPLE_EVERY = 0.25; // seconds between track points
const MAX_TRACK_SPEED = 120; // m/s: any faster between samples and the car was teleported (reset)
/** Repeats of a kind closer than this in time and space are one incident (a grind along a wall). */
const REPEAT_TIME = 1.5;
const REPEAT_DIST = 15;
const ONE_OFF: IncidentKind[] = ['checkpoint', 'stars', 'wrecked', 'drowned', 'timeout'];

export class RunLog {
  readonly track: TrackPoint[] = [];
  readonly incidents: Incident[] = [];
  /** Street props (lamps, hydrants, trees…) the player knocked down. Too many to mark on the map. */
  propsSmashed = 0;

  /** Record the player's position; thinned to one point every SAMPLE_EVERY seconds. */
  sample(t: number, x: number, z: number, speed: number): void {
    const last = this.track[this.track.length - 1];
    if (last && t - last.t < SAMPLE_EVERY) return;
    const jump = !!last && Math.hypot(x - last.x, z - last.z) > MAX_TRACK_SPEED * Math.max(t - last.t, SAMPLE_EVERY);
    this.track.push({ x, z, t, speed: Math.abs(speed), jump });
  }

  /** Log an incident; returns false if it was folded into the same kind just before. */
  add(kind: IncidentKind, t: number, x: number, z: number, detail: string): boolean {
    if (!ONE_OFF.includes(kind)) {
      for (let i = this.incidents.length - 1; i >= 0; i--) {
        const prev = this.incidents[i];
        if (t - prev.t > REPEAT_TIME) break;
        if (prev.kind === kind && Math.hypot(prev.x - x, prev.z - z) < REPEAT_DIST) return false;
      }
    }
    this.incidents.push({ kind, t, x, z, detail });
    return true;
  }

  count(kind: IncidentKind): number {
    return this.incidents.filter((i) => i.kind === kind).length;
  }

  /** Metres driven, along the sampled track. */
  get distance(): number {
    let d = 0;
    for (let i = 1; i < this.track.length; i++) {
      const a = this.track[i - 1];
      const b = this.track[i];
      if (!b.jump) d += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return d;
  }

  /** m/s */
  get topSpeed(): number {
    return this.track.reduce((top, p) => Math.max(top, p.speed), 0);
  }
}
