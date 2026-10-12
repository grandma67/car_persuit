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

  it.each([1, 42, 1234])('seed %i: T-junctions on the ring road: zebras on every leg, edge line across the top of the T', (seed) => {
    const city = generateCity(seed);
    const rw = city.config.roadWidth;
    const ring = city.size / 2 - rw / 2;
    const near = (m: { x: number; z: number }, x: number, z: number, r: number) => Math.abs(m.x - x) <= r && Math.abs(m.z - z) <= r;
    const ts = city.graph.nodes.filter((n) => n.neighbors.length === 3 && (Math.abs(Math.abs(n.x) - ring) < 0.5 || Math.abs(Math.abs(n.z) - ring) < 0.5));
    expect(ts.length).toBeGreaterThan(10);
    for (const n of ts) {
      for (const id of n.neighbors) {
        const o = city.graph.nodes[id];
        const len = Math.hypot(o.x - n.x, o.z - n.z);
        const at = (m: number) => ({ x: n.x + ((o.x - n.x) / len) * m, z: n.z + ((o.z - n.z) / len) * m });
        const band = at(rw / 2 + 2);
        expect(city.roadMarks.some((m) => m.kind === 'crosswalk' && near(m, band.x, band.z, rw / 2))).toBe(true);
      }
      // The sea side, where no road leaves the junction.
      const sea = { x: n.x + Math.sign(n.x) * (Math.abs(Math.abs(n.x) - ring) < 0.5 ? rw / 2 : 0), z: n.z + Math.sign(n.z) * (Math.abs(Math.abs(n.z) - ring) < 0.5 ? rw / 2 : 0) };
      expect(city.roadMarks.some((m) => m.kind === 'edgeline' && near(m, sea.x, sea.z, 1))).toBe(true);
    }
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

describe('left-hand traffic (England)', () => {
  const english = (seed: number) => generateCity(seed, { ...DEFAULT_CITY, leftHandChance: 1 });
  const facing = (p: { yaw: number }) => ({ fx: Math.sin(p.yaw), fz: Math.cos(p.yaw) });

  it('is rare, and decided by the seed', () => {
    let left = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const side = generateCity(seed).driveSide;
      if (side === 'left') left++;
      expect(generateCity(seed).driveSide).toBe(side);
    }
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(25);
  });

  it.each([1, 42, 1234])("seed %i: junction signs and signals stand on the driver's left", (seed) => {
    const city = english(seed);
    expect(city.driveSide).toBe('left');
    for (const p of city.streetProps.filter((q) => q.kind === 'signal' || q.variant === 'stop')) {
      const { fx, fz } = facing(p);
      const [dx, dz] = [-fx, -fz];
      const node = city.graph.nearest(p.x, p.z);
      const toNode = { x: node.x - p.x, z: node.z - p.z };
      // Left of travel is (dz, -dx): the post is on that side, so the junction centre is to its right.
      const left = -(toNode.x * dz + toNode.z * -dx);
      expect(left).toBeGreaterThan(city.config.roadWidth / 2);
    }
  });

  it.each([1, 42])('seed %i: signal heads reach right, over the left lane', (seed) => {
    const city = english(seed);
    const signals = city.streetProps.filter((q) => q.kind === 'signal');
    expect(signals.length).toBeGreaterThan(0);
    for (const p of signals) {
      expect(p.armRight).toBe(true);
      const hx = p.x + 3.7 * Math.cos(p.yaw);
      const hz = p.z - 3.7 * Math.sin(p.yaw);
      expect(city.roads.some((r) => Math.abs(hx - r.rect.x) < r.rect.w / 2 && Math.abs(hz - r.rect.z) < r.rect.d / 2)).toBe(true);
    }
  });

  it('stop lines cover the left half of each approach', () => {
    const city = english(42);
    const right = generateCity(42, { ...DEFAULT_CITY, leftHandChance: 0 });
    const lines = (c: typeof city) => c.roadMarks.filter((m) => m.kind === 'stopline');
    expect(lines(city).length).toBe(lines(right).length);
    // Same junctions, each line mirrored across its road's centre line: no line in the same place.
    const at = (m: { x: number; z: number }) => `${m.x.toFixed(1)},${m.z.toFixed(1)}`;
    const rightSpots = new Set(lines(right).map(at));
    expect(lines(city).filter((m) => rightSpots.has(at(m)))).toEqual([]);
  });
});

