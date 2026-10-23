import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cornerSpeedLimit, distanceToBend, purePursuit, turnAngle } from './pursuit';

const p = (x: number, z: number) => ({ x, z });

describe('turnAngle', () => {
  it('is zero straight on, ±90° at a corner and 180° for a U-turn', () => {
    expect(turnAngle(p(0, 0), p(10, 0), p(20, 0))).toBeCloseTo(0);
    const left = turnAngle(p(0, 0), p(10, 0), p(10, 10));
    const right = turnAngle(p(0, 0), p(10, 0), p(10, -10));
    expect(Math.abs(left)).toBeCloseTo(Math.PI / 2);
    expect(right).toBeCloseTo(-left);
    expect(Math.abs(turnAngle(p(0, 0), p(10, 0), p(0, 0)))).toBeCloseTo(Math.PI);
  });
});

describe('purePursuit', () => {
  const out = new THREE.Vector3();

  it('aims lookahead metres down a straight road', () => {
    const { segment } = purePursuit([p(0, 0), p(100, 0), p(200, 0)], 0, p(90, 2), 20, out);
    expect(segment).toBe(0);
    expect(out.x).toBeCloseTo(110);
    expect(out.z).toBeCloseTo(0);
  });

  it('only wraps ~4m round a sharp bend instead of cutting the corner', () => {
    purePursuit([p(0, 0), p(100, 0), p(100, 100)], 0, p(90, 0), 20, out);
    expect(out.x).toBeCloseTo(100);
    expect(out.z).toBeCloseTo(4);
  });

  it('never searches backwards along the path', () => {
    const path = [p(0, 0), p(50, 0), p(100, 0), p(150, 0)];
    const { segment } = purePursuit(path, 2, p(10, 0), 5, out);
    expect(segment).toBe(2);
    expect(out.x).toBeCloseTo(105);
  });

  it('stops at the end of the path', () => {
    purePursuit([p(0, 0), p(10, 0)], 0, p(5, 0), 50, out);
    expect(out.x).toBeCloseTo(10);
  });
});

describe('cornerSpeedLimit', () => {
  it('is unlimited on a straight road', () => {
    expect(cornerSpeedLimit([p(0, 0), p(100, 0), p(200, 0)], 0, p(10, 0), 30, 10, 8)).toBe(Infinity);
  });

  it('brakes for a sharp bend within braking distance', () => {
    const limit = cornerSpeedLimit([p(0, 0), p(100, 0), p(100, 100)], 0, p(70, 0), 30, 10, 8);
    // 30m to the corner, 8m of slack: v² = 10² + 2·8·22.
    expect(limit).toBeCloseTo(Math.sqrt(100 + 2 * 8 * 22));
    expect(limit).toBeLessThan(30);
  });

  it('ignores bends beyond braking distance and gentle curves', () => {
    expect(cornerSpeedLimit([p(0, 0), p(200, 0), p(200, 100)], 0, p(0, 0), 10, 10, 8)).toBe(Infinity);
    expect(cornerSpeedLimit([p(0, 0), p(50, 0), p(100, 10)], 0, p(40, 0), 30, 10, 8)).toBe(Infinity);
  });
  it('by angle: a gentle bend may be taken faster than a right angle, a hairpin slower', () => {
    // At the bend (8 m of slack), the limit is the corner speed itself.
    const at = (end: { x: number; z: number }) => cornerSpeedLimit([p(0, 0), p(100, 0), end], 0, p(95, 0), 30, 10, 8, true);
    expect(at(p(100, 100))).toBeCloseTo(10);
    expect(at(p(200, 100))).toBeGreaterThan(10); // 45°
    expect(at(p(0, 5))).toBeLessThan(10); // turning round
    expect(cornerSpeedLimit([p(0, 0), p(100, 0), p(200, 100)], 0, p(95, 0), 30, 10, 8)).toBeCloseTo(10); // not by angle: all alike
  });
});

describe('distanceToBend', () => {
  it('measures along the path to the next sharp bend, past gentle ones', () => {
    expect(distanceToBend([p(0, 0), p(50, 0), p(100, 5), p(100, 100)], 0, p(10, 0))).toBeCloseTo(40 + Math.hypot(50, 5));
    expect(distanceToBend([p(0, 0), p(100, 0), p(200, 0)], 0, p(10, 0))).toBe(Infinity);
  });
});
