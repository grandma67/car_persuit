// The Harbor's lettering and lit glass: shed numbers painted on the sheds, the terminal's name on
// its canopy, the control room's glass and the gate's lane lights. One canvas atlas drawn at load;
// plates carry white vertex colours and use the facade walls' material settings (vertex colours and
// four maps), so they add no shader program. Made-up names only.
import * as THREE from 'three';

const W = 1024;
const H = 512;
const SANS = '"Helvetica Neue", Arial, sans-serif';

export const SHED_NUMBERS = 12;
export type HarborCell = `shed${number}` | 'terminal' | 'warm' | 'glass' | 'red' | 'green' | 'white';

/** Each cell's rectangle in atlas pixels (top-left origin). */
const CELLS: Record<string, { x: number; y: number; w: number; h: number }> = {
  terminal: { x: 0, y: 384, w: 1024, h: 96 },
};
// Shed numbers: 256 × 64, four a row.
for (let i = 1; i <= SHED_NUMBERS; i++) CELLS[`shed${i}`] = { x: ((i - 1) % 4) * 256, y: Math.floor((i - 1) / 4) * 64, w: 256, h: 64 };
// Swatches: 32 × 32 along y 256.
const SWATCHES: Record<string, string> = { warm: '#ffd898', glass: '#2a3a48', red: '#ff2a1a', green: '#2aff6a', white: '#ffffff' };
Object.keys(SWATCHES).forEach((k, i) => (CELLS[k] = { x: i * 32, y: 256, w: 32, h: 32 }));

function draw(g: CanvasRenderingContext2D): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 1; i <= SHED_NUMBERS; i++) {
    // Big white stencil on a blue band, the way sheds are numbered from the quay.
    const c = CELLS[`shed${i}`];
    g.fillStyle = '#1f4f8a';
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = '#f2f2ee';
    g.font = `bold 44px ${SANS}`;
    g.fillText(`SHED ${i}`, c.x + c.w / 2, c.y + c.h / 2 + 2, c.w - 16);
  }
  const t = CELLS.terminal;
  g.fillStyle = '#e8e6e0';
  g.fillRect(t.x, t.y, t.w, t.h);
  g.fillStyle = '#1f4f8a';
  g.fillRect(t.x, t.y + t.h - 14, t.w, 14);
  g.fillStyle = '#1c2a3a';
  g.font = `bold 58px ${SANS}`;
  g.fillText('PORT OF GREYWATER · TERMINAL GATE', t.x + t.w / 2, t.y + t.h / 2 - 4, t.w - 40);
  for (const [k, colour] of Object.entries(SWATCHES)) {
    const c = CELLS[k];
    g.fillStyle = colour;
    g.fillRect(c.x, c.y, c.w, c.h);
  }
}

let atlas: THREE.Texture | null = null;

function harborAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  draw(canvas.getContext('2d')!);
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** The plates' material: the facade walls' settings (vertex colours, map, emissive, roughness and metalness maps). */
export function harborSignMaterial(glow: number): THREE.MeshStandardMaterial {
  const map = harborAtlas();
  const surface = new THREE.DataTexture(new Uint8Array([0, 150, 0, 255]), 1, 1);
  surface.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    vertexColors: true, map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: glow,
    roughnessMap: surface, metalnessMap: surface, roughness: 1, metalness: 1,
  });
}

/** White vertex colours and the UVs onto a cell (a swatch's middle for anything but a plane). */
export function onCell(geo: THREE.BufferGeometry, cell: HarborCell, whole = true): THREE.BufferGeometry {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const c = CELLS[cell];
  const n = geo.attributes.position.count;
  const uv = geo.attributes.uv;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [u, v] = whole && uv ? [uv.getX(i), uv.getY(i)] : [0.5, 0.5];
    out[i * 2] = (c.x + u * c.w) / W;
    out[i * 2 + 1] = 1 - (c.y + (1 - v) * c.h) / H;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}
