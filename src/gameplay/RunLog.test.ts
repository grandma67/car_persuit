import { describe, expect, it } from 'vitest';
import { RunLog } from './RunLog';

describe('RunLog', () => {
  it('thins the track to a point every quarter second', () => {
    const log = new RunLog();
    for (let t = 0; t < 1; t += 1 / 60) log.sample(t, t * 10, 0, -10);
    expect(log.track.length).toBe(4);
    expect(log.track[0].speed).toBe(10); // reversing still counts as speed
  });

  it('measures distance and top speed', () => {
    const log = new RunLog();
    log.sample(0, 0, 0, 5);
    log.sample(1, 30, 40, 20);
    log.sample(2, 30, 0, 12);
    expect(log.distance).toBe(90);
    expect(log.topSpeed).toBe(20);
  });

  it('breaks the track where the car was teleported', () => {
    const log = new RunLog();
    log.sample(0, 0, 0, 10);
    log.sample(0.25, 2.5, 0, 10);
    log.sample(0.5, 400, 0, 10); // reset to a road far away
    log.sample(0.75, 402.5, 0, 10);
    expect(log.track.map((p) => p.jump)).toEqual([false, false, true, false]);
    expect(log.distance).toBe(5);
  });

  it('folds a grind along a wall into one incident', () => {
    const log = new RunLog();
    expect(log.add('wall', 10, 0, 0, '')).toBe(true);
    expect(log.add('wall', 10.5, 3, 0, '')).toBe(false);
    expect(log.add('rammed', 10.6, 3, 0, '')).toBe(true); // a different kind still counts
    expect(log.add('wall', 10.7, 40, 0, '')).toBe(true); // somewhere else
    expect(log.add('wall', 13, 0, 0, '')).toBe(true); // later
    expect(log.count('wall')).toBe(3);
  });

  it('never folds one-off incidents', () => {
    const log = new RunLog();
    log.add('stars', 5, 0, 0, '2');
    log.add('stars', 5.1, 0, 0, '3');
    expect(log.count('stars')).toBe(2);
  });
});
