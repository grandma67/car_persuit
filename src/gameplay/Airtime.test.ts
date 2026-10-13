import { describe, expect, it } from 'vitest';
import { Airtime } from './Airtime';

/** Fly from x=0 for `seconds` at 20 m/s (60 fps), then touch down; returns every event. */
function flight(air: Airtime, seconds: number) {
  const events = [];
  let t = 0;
  events.push(air.update(t, true, 0, 0, 20));
  for (; t < seconds; t += 1 / 60) events.push(air.update(t + 1 / 60, false, t * 20, 0, 20));
  events.push(air.update(t + 1 / 60, true, (t + 1 / 60) * 20, 0, 20));
  return events.filter((e) => e !== null);
}

describe('Airtime', () => {
  it('reports a jump once, from where the car left the ground, and its landing', () => {
    const [takeoff, landing, ...rest] = flight(new Airtime(), 1);
    expect(takeoff).toMatchObject({ type: 'takeoff', x: 0, speed: 20 });
    expect(landing.type).toBe('landing');
    if (landing.type !== 'landing') return;
    expect(landing.airtime).toBeCloseTo(1, 1);
    expect(landing.distance).toBeCloseTo(20, 0);
    expect(rest).toEqual([]);
  });

  it('ignores a hop over a bump', () => {
    expect(flight(new Airtime(), 0.2)).toEqual([]);
  });

  it('drops a flight cut short by a reset', () => {
    const air = new Airtime();
    for (let t = 0; t < 0.5; t += 1 / 60) air.update(t, false, 0, 0, 20);
    air.cancel();
    expect(air.update(0.6, true, 300, 0, 0)).toBeNull();
  });
});
