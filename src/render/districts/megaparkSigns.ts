// The Mega-park's lettering: the park's name on the wall by the main gate, gilt letters on a dark
// green enamel plaque, one cell per made-up park name. One canvas atlas drawn at load; plates carry
// white vertex colours and use the facade walls' material settings (vertex colours and four maps),
// as the Farm's boards, so they add no shader program.
import * as THREE from 'three';
import { PARK_NAMES } from '../../world/districts/MegaparkLawns';

const W = 1024;
const CELL_H = 160;
const H = 1280; // eight names
const SERIF = 'Georgia, "Times New Roman", serif';

let atlas: THREE.Texture | null = null;

function parkAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  PARK_NAMES.forEach((name, i) => {
    const y = i * CELL_H;
    g.fillStyle = '#1f3a2c';
    g.fillRect(0, y, W, CELL_H);
    // A gilt double border.
    g.strokeStyle = '#c8a24a';
    g.lineWidth = 6;
    g.strokeRect(10, y + 10, W - 20, CELL_H - 20);
    g.lineWidth = 2;
    g.strokeRect(22, y + 22, W - 44, CELL_H - 44);
    g.fillStyle = '#e4c66a';
    g.font = `bold 84px ${SERIF}`;
    g.fillText(name.toUpperCase(), W / 2, y + CELL_H / 2 + 4, W - 90);
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** The plates' material: the facade walls' settings (vertex colours, map, emissive, roughness and metalness maps). */
export function parkSignMaterial(glow: number): THREE.MeshStandardMaterial {
  const map = parkAtlas();
  const surface = new THREE.DataTexture(new Uint8Array([0, 200, 0, 255]), 1, 1);
  surface.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    vertexColors: true, map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: glow,
    roughnessMap: surface, metalnessMap: surface, roughness: 1, metalness: 1,
  });
}

/** A w × h plate facing +Z with park name `i` on it, white vertex colours. */
export function parkNamePlate(w: number, h: number, i: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 1 - (i * CELL_H + (1 - uv.getY(k)) * CELL_H) / H);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  return geo;
}
