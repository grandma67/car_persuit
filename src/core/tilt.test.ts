import { describe, expect, it } from 'vitest';
import { TILT } from '../gameplay/balance';
import { screenRoll, tiltSteer } from './tilt';

describe('tilt steering', () => {
  it('reads no roll when the screen is level, upright or flat', () => {
    for (const angle of [0, 90, 270]) expect(screenRoll(0, 0, angle)).toBeCloseTo(0);
    expect(screenRoll(90, 0, 0)).toBeCloseTo(0); // portrait, upright
    expect(screenRoll(0, -90, 90)).toBeCloseTo(0); // landscape (turned left), upright
    expect(screenRoll(0, 90, 270)).toBeCloseTo(0); // landscape (turned right), upright
  });

  it('portrait: rolling the phone clockwise steers right', () => {
    // Upright portrait turned 20° clockwise: up leans to the screen's left.
    const b = Math.asin(Math.cos((20 * Math.PI) / 180)) * (180 / Math.PI);
    const g = 90 - b; // approximate: small rolls read mostly through gamma
    expect(screenRoll(b, g, 0)).toBeGreaterThan(0);
    expect(screenRoll(b, -g, 0)).toBeLessThan(0);
  });

  it('landscape: turning the phone like a wheel steers that way, either way up', () => {
    // Landscape turned left (angle 90), held upright: device +x points up. Turning it clockwise
    // tips the top (device +y, on the left) up, which is beta going positive.
    expect(screenRoll(15, -80, 90)).toBeCloseTo(15, 0);
    expect(screenRoll(-15, -80, 90)).toBeCloseTo(-15, 0);
    // Turned right (angle 270): device +y on the right, so the signs flip.
    expect(screenRoll(-15, 80, 270)).toBeCloseTo(15, 0);
    // Tipped back towards flat, the roll still reads.
    expect(screenRoll(15, -30, 90)).toBeGreaterThan(5);
  });

  it('maps roll to steer with a dead zone and full lock', () => {
    expect(tiltSteer(0)).toBe(0);
    expect(tiltSteer(TILT.deadZone - 0.5)).toBe(0);
    expect(tiltSteer(TILT.fullLock)).toBe(1);
    expect(tiltSteer(-60)).toBe(-1);
    const mid = tiltSteer((TILT.deadZone + TILT.fullLock) / 2);
    expect(mid).toBeCloseTo(0.5);
  });
});
