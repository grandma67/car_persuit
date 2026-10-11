import * as THREE from 'three';
import type { Cop } from '../ai/CopDirector';

const SIREN_LIGHTS = 2; // shared flashing lights, given to the nearest cops (fixed count avoids shader recompiles)

// Cop light bars: flashes every cop's bar and parks a few real point lights on the nearest ones.
export class Sirens {
  private lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < SIREN_LIGHTS; i++) {
      const light = new THREE.PointLight(0xff2020, 0, 45, 1.6);
      this.lights.push(light);
      scene.add(light);
    }
  }

  /**
   * `on`: false switches every siren off (the player won). `night` 0..1 brightens the glow.
   * Returns the distance to the nearest active cop, or null when there is none.
   */
  update(time: number, cops: Cop[], playerPos: THREE.Vector3, night: number, on: boolean): number | null {
    const redOn = Math.sin(time * Math.PI * 6) > 0; // alternating ~3 Hz
    const active = cops
      .filter((c) => c.wreckedFor === null)
      .map((c) => ({ c, d: c.vehicle.position.distanceTo(playerPos) }))
      .sort((a, b) => a.d - b.d);
    for (const cop of cops) {
      const bar = cop.vehicle.mesh.sirenLights;
      if (!bar) continue;
      const lit = cop.wreckedFor === null && on;
      bar.red.emissiveIntensity = lit && redOn ? 6 : 0.2;
      bar.blue.emissiveIntensity = lit && !redOn ? 6 : 0.2;
      (bar.redGlow.material as THREE.SpriteMaterial).opacity = lit && redOn ? 0.5 + night * 0.5 : 0;
      (bar.blueGlow.material as THREE.SpriteMaterial).opacity = lit && !redOn ? 0.5 + night * 0.5 : 0;
    }
    this.lights.forEach((light, i) => {
      const nearest = active[i];
      if (!nearest || !on) {
        light.intensity = 0;
        return;
      }
      const root = nearest.c.vehicle.mesh.root.position;
      light.position.copy(root).setY(root.y + 1.8);
      light.color.setHex((i % 2 === 0) === redOn ? 0xff2020 : 0x2050ff);
      light.intensity = 40 + night * 160;
    });
    return active.length ? active[0].d : null;
  }
}
