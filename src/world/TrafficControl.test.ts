import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity } from './CityGenerator';
import { signalState, SIGNAL_CYCLE } from './TrafficControl';

const inside = (m: { x: number; z: number; w: number; d: number }, r: { x: number; z: number; w: number; d: number }) =>
  Math.abs(m.x - r.x) + m.w / 2 <= r.w / 2 + 1e-6 && Math.abs(m.z - r.z) + m.d / 2 <= r.d / 2 + 1e-6;

describe('signalState', () => {
  it('never shows green to both directions, and each direction gets green and yellow', () => {
    const seen = { x: new Set<string>(), z: new Set<string>() };
    for (let t = 0; t < SIGNAL_CYCLE * 2; t += 0.1) {
      const x = signalState('x', t);
      const z = signalState('z', t);
      expect(x !== 'red' && z !== 'red').toBe(false);
      seen.x.add(x);
      seen.z.add(z);
    }
    expect(seen.x).toEqual(new Set(['green', 'yellow', 'red']));
    expect(seen.z).toEqual(new Set(['green', 'yellow', 'red']));
  });
});

describe('generateTrafficControl', () => {
  // A sign's face (local +Z) points along (sin yaw, cos yaw); drivers it addresses travel the other way.
  const facing = (p: { yaw: number }) => ({ fx: Math.sin(p.yaw), fz: Math.cos(p.yaw) });

  it.each([1, 42, 1234])('seed %i: junction signs and signals face their traffic, on the driver\'s right', (seed) => {
    const city = generateCity(seed);
    const controls = city.streetProps.filter((p) => p.kind === 'signal' || p.variant === 'stop');
    for (const p of controls) {
      const { fx, fz } = facing(p);
      const [dx, dz] = [-fx, -fz]; // drivers' travel direction
      const node = city.graph.nearest(p.x, p.z);
      const toNode = { x: node.x - p.x, z: node.z - p.z };
      const ahead = toNode.x * dx + toNode.z * dz; // + means the junction is still ahead of the post
      // Stop signs stand before the junction; signals stand beyond it (far side).
      if (p.kind === 'signal') expect(ahead).toBeLessThan(0);
      else expect(ahead).toBeGreaterThan(0);
      // On the driver's right: right of travel is (-dz, dx).
      const right = -(toNode.x * -dz + toNode.z * dx);
      expect(right).toBeGreaterThan(city.config.roadWidth / 2);
      // Travel is along a road axis, toward/through this junction.
      expect(Math.abs(dx) > 0.99 || Math.abs(dz) > 0.99).toBe(true);
    }
  });

  it.each([1, 42])('seed %i: signal heads hang over the lane they face', (seed) => {
    const city = generateCity(seed);
    for (const p of city.streetProps.filter((q) => q.kind === 'signal')) {
      // Head is 3.7m along local -X from the pole: world offset = -3.7 * (cos yaw, -sin yaw).
      const hx = p.x - 3.7 * Math.cos(p.yaw);
      const hz = p.z + 3.7 * Math.sin(p.yaw);
      const onRoad = city.roads.some((r) => Math.abs(hx - r.rect.x) < r.rect.w / 2 && Math.abs(hz - r.rect.z) < r.rect.d / 2);
      expect(onRoad).toBe(true);
    }
  });

  it.each([1, 42, 1234])('seed %i: signals downtown, stop signs elsewhere, speed signs', (seed) => {
    // Without canals: a canal through downtown turns its four-way junctions into T-junctions.
    const city = generateCity(seed, { ...DEFAULT_CITY, canalOdds: [1, 0, 0] });
    const kinds = (k: string, v?: string) => city.streetProps.filter((p) => p.kind === k && (v === undefined || p.variant === v)).length;
    expect(kinds('signal')).toBeGreaterThan(40);
    expect(kinds('sign', 'stop')).toBeGreaterThan(100);
    for (const v of ['speed30', 'speed50', 'noParking', 'noSmoking', 'children', 'pedestrian']) expect(kinds('sign', v)).toBeGreaterThan(5);
    // Signals sit on busy central junctions more than anywhere else.
    const signals = city.streetProps.filter((p) => p.kind === 'signal');
    const central = signals.filter((p) => Math.hypot(p.x, p.z) < city.size * 0.35).length;
    expect(central / signals.length).toBeGreaterThan(0.6);
  });

  it.each([1, 42, 1234])('seed %i: every crossing and stop line is painted on road, not sidewalk', (seed) => {
    const city = generateCity(seed);
    const paved = [...city.roads.map((r) => r.rect), ...city.intersections];
    const off = city.roadMarks.filter((m) => !paved.some((r) => inside(m, r)));
    expect(off).toEqual([]);
    expect(city.roadMarks.filter((m) => m.kind === 'stopline').length).toBeGreaterThan(100);
  });
});

import { approachControls } from './TrafficControl';

describe('approachControls', () => {
  it.each([1, 42])('seed %i: every stop sign and signal maps to a real road approach', (seed) => {
    const city = generateCity(seed);
    const controls = approachControls(city.graph, city.streetProps);
    const expected = city.streetProps.filter((p) => p.kind === 'signal' || p.variant === 'stop').length;
    expect(controls.size).toBe(expected);
    for (const [key, c] of controls) {
      const [from, to] = key.split('>').map(Number);
      expect(city.graph.nodes[from].neighbors).toContain(to);
      const a = city.graph.nodes[from];
      const b = city.graph.nodes[to];
      expect(c.axis).toBe(Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? 'x' : 'z');
    }
  });
});
