import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Cop } from '../ai/CopDirector';
import { Sirens } from './Sirens';

// One point light serves the nearest cop's siren and a blast's flash: the light count never changes
// (a change recompiles every material), and an idle light still costs every lit pixel.
const cop = (x: number, wrecked = false) =>
  ({ wreckedFor: wrecked ? 1 : null, vehicle: { position: new THREE.Vector3(x, 0, 0), mesh: { root: { position: new THREE.Vector3(x, 0, 0) } } } }) as unknown as Cop;
const lights = (scene: THREE.Scene) => {
  const out: THREE.PointLight[] = [];
  scene.traverse((o) => (o as THREE.PointLight).isPointLight && out.push(o as THREE.PointLight));
  return out;
};

describe('sirens', () => {
  it('light the nearest live cop, with one light whatever happens', () => {
    const scene = new THREE.Scene();
    const sirens = new Sirens(scene);
    const [light] = lights(scene);
    const player = new THREE.Vector3();
    expect(sirens.update(0.01, [cop(-80), cop(30), cop(10, true)], player, 0, true)).toBe(30);
    expect(light.position.x).toBe(30);
    expect(light.intensity).toBeGreaterThan(0);
    sirens.update(0.01, [], player, 0, true);
    expect(light.intensity).toBe(0);
    sirens.update(0.01, [cop(30)], player, 0, false); // won: sirens off
    expect(light.intensity).toBe(0);
    expect(lights(scene)).toHaveLength(1);
  });

  it('give the light to a blast while its flash outshines the siren, then take it back', () => {
    const scene = new THREE.Scene();
    const sirens = new Sirens(scene);
    const [light] = lights(scene);
    const flash = { at: new THREE.Vector3(5, 2, 5), intensity: 600 };
    sirens.update(0.01, [cop(30)], new THREE.Vector3(), 0, true, flash);
    expect(light.position.toArray()).toEqual([5, 2, 5]);
    expect(light.intensity).toBe(600);
    expect(light.color.getHex()).toBe(0xff9a40);
    flash.intensity = 1; // decayed
    sirens.update(0.01, [cop(30)], new THREE.Vector3(), 0, true, flash);
    expect(light.position.x).toBe(30);
    expect(light.intensity).toBe(40);
    flash.intensity = 5; // no cops: the flash has the light to itself
    sirens.update(0.01, [], new THREE.Vector3(), 0, true, flash);
    expect(light.intensity).toBe(5);
  });
});
