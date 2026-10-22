// The Farm's lettering: the ranch gate's name board, carved-and-painted, one cell per made-up farm
// name. One canvas atlas drawn at load; plates carry white vertex colours and use the facade walls'
// material settings (vertex colours and four maps), so they add no shader program.
import * as THREE from 'three';
import { FARM_NAMES } from '../../world/districts/FarmGate';

const W = 1024;
const CELL_H = 128;
const H = 1024;
const SERIF = 'Georgia, "Times New Roman", serif';

let atlas: THREE.Texture | null = null;

function farmAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  FARM_NAMES.forEach((name, i) => {
    const y = i * CELL_H;
    // Weathered planks, a darker border, the name in cream letters.
    g.fillStyle = '#5a3e26';
    g.fillRect(0, y, W, CELL_H);
    for (let k = 0; k < 3; k++) {
      g.fillStyle = k % 2 ? '#6a4a2e' : '#634429';
      g.fillRect(8, y + 8 + k * ((CELL_H - 16) / 3), W - 16, (CELL_H - 16) / 3 - 2);
    }
    g.strokeStyle = '#3a2616';
    g.lineWidth = 8;
    g.strokeRect(4, y + 4, W - 8, CELL_H - 8);
    g.fillStyle = '#f2e6c8';
    g.font = `bold 76px ${SERIF}`;
    g.fillText(name.toUpperCase(), W / 2, y + CELL_H / 2 + 4, W - 60);
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** The plates' material: the facade walls' settings (vertex colours, map, emissive, roughness and metalness maps). */
export function farmSignMaterial(glow: number): THREE.MeshStandardMaterial {
  const map = farmAtlas();
  const surface = new THREE.DataTexture(new Uint8Array([0, 230, 0, 255]), 1, 1);
  surface.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    vertexColors: true, map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: glow,
    roughnessMap: surface, metalnessMap: surface, roughness: 1, metalness: 1,
  });
}

/** A w × h plate facing +Z with farm name `i` on it, white vertex colours. */
export function namePlate(w: number, h: number, i: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 1 - (i * CELL_H + (1 - uv.getY(k)) * CELL_H) / H);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  return geo;
}
