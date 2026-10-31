import * as THREE from 'three';
import type { Cop } from '../ai/CopDirector';
import { setGlow } from '../vehicles/carMesh';

const SIREN = { distance: 45, decay: 1.6 };
const FLASH = { color: 0xff9a40, distance: 60, decay: 1.5 };

// Cop light bars: flashes every cop's bar, and lights the street round the nearest one with the
// scene's only point light. Every light is a loop iteration in every lit pixel even at intensity 0
// (three sirens-and-flash lights were ~12% of the GPU frame), and the count must never change (that
// recompiles every material), so one light, always there, serves the siren and a car blowing up.
export class Sirens {
  private light = new THREE.PointLight(0xff2020, 0, SIREN.distance, SIREN.decay);

  constructor(scene: THREE.Scene) {
    scene.add(this.light);
  }

  /**
   * `on`: false switches every siren off (the player won). `night` 0..1 brightens the glow.
   * `flash`: a blast's light (Effects.flash), which takes the light while it outshines the siren.
   * Returns the distance to the nearest active cop, or null when there is none.
   */
  update(time: number, cops: Cop[], playerPos: THREE.Vector3, night: number, on: boolean, flash?: { at: THREE.Vector3; intensity: number }): number | null {
    const redOn = Math.sin(time * Math.PI * 6) > 0; // alternating ~3 Hz
    let nearest: Cop | null = null;
    let nearestD = Infinity;
    for (const cop of cops) {
      const bar = cop.vehicle.mesh.sirenLights;
      if (cop.wreckedFor === null) {
        const d = cop.vehicle.position.distanceTo(playerPos);
        if (d < nearestD) (nearest = cop), (nearestD = d);
      }
      if (!bar) continue;
      const lit = cop.wreckedFor === null && on;
      bar.red.emissiveIntensity = lit && redOn ? 6 : 0.2;
      bar.blue.emissiveIntensity = lit && !redOn ? 6 : 0.2;
      setGlow(bar.redGlow, lit && redOn ? 0.5 + night * 0.5 : 0);
      setGlow(bar.blueGlow, lit && !redOn ? 0.5 + night * 0.5 : 0);
    }
    const light = this.light;
    const siren = nearest && on ? 40 + night * 160 : 0;
    if (flash && flash.intensity > siren) {
      light.position.copy(flash.at);
      light.color.setHex(FLASH.color);
      light.distance = FLASH.distance;
      light.decay = FLASH.decay;
      light.intensity = flash.intensity;
    } else if (nearest && siren > 0) {
      const root = nearest.vehicle.mesh.root.position;
      light.position.copy(root).setY(root.y + 1.8);
      light.color.setHex(redOn ? 0xff2020 : 0x2050ff);
      light.distance = SIREN.distance;
      light.decay = SIREN.decay;
      light.intensity = siren;
    } else {
      light.intensity = 0;
    }
    return nearest ? nearestD : null;
  }
}
