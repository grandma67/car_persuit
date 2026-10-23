// The Slums' lettering: the ruins' KEEP OUT hoardings and the junkyard's BEWARE OF DOG sign. One
// canvas atlas drawn at load; plates carry white vertex colours and use the facade walls' material
// settings (vertex colours and four maps), so they add no shader program.
import * as THREE from 'three';

const W = 512;
const H = 512;
const SANS = '"Helvetica Neue", Arial, sans-serif';

export type SlumsCell = 'keepOut' | 'dog';

/** Each cell's rectangle in atlas pixels (top-left origin). */
const CELLS: Record<SlumsCell, { x: number; y: number; w: number; h: number }> = {
  keepOut: { x: 0, y: 0, w: 512, h: 256 },
  dog: { x: 0, y: 256, w: 512, h: 192 },
};

/** Seeded scatter for the grime, so every load draws the same boards. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function draw(g: CanvasRenderingContext2D): void {
  const rnd = rand(4242);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // KEEP OUT: a plywood hoarding, the words sprayed in red over a stencilled DANGER band.
  const k = CELLS.keepOut;
  g.fillStyle = '#b89a6a';
  g.fillRect(k.x, k.y, k.w, k.h);
  for (let x = 0; x < k.w; x += 128) {
    g.fillStyle = 'rgba(70,50,30,0.5)';
    g.fillRect(k.x + x, k.y, 3, k.h); // sheet joints
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(60,45,30,${0.08 + rnd() * 0.15})`;
    g.fillRect(k.x + rnd() * k.w, k.y + rnd() * k.h, 4 + rnd() * 30, 2 + rnd() * 10);
  }
  g.fillStyle = '#e8c21a';
  g.fillRect(k.x + 30, k.y + 22, k.w - 60, 54);
  g.fillStyle = '#1a1a1a';
  g.font = `bold 44px ${SANS}`;
  g.fillText('DANGER', k.x + k.w / 2, k.y + 51);
  g.fillStyle = '#b8241c';
  g.font = `bold 104px ${SANS}`;
  g.save();
  g.translate(k.x + k.w / 2, k.y + 162);
  g.rotate(-0.05);
  g.fillText('KEEP OUT', 0, 0, k.w - 40);
  g.restore();
  // Drips under the spray.
  for (let i = 0; i < 14; i++) {
    g.fillStyle = 'rgba(184,36,28,0.8)';
    g.fillRect(k.x + 50 + rnd() * (k.w - 100), k.y + 200, 3, 8 + rnd() * 40);
  }
  // BEWARE OF DOG: a rusty enamel plate, red on white.
  const d = CELLS.dog;
  g.fillStyle = '#7a3a22';
  g.fillRect(d.x, d.y, d.w, d.h);
  g.fillStyle = '#ece8dc';
  g.fillRect(d.x + 12, d.y + 12, d.w - 24, d.h - 24);
  g.fillStyle = '#b8241c';
  g.font = `bold 70px ${SANS}`;
  g.fillText('BEWARE', d.x + d.w / 2, d.y + 64, d.w - 60);
  g.fillText('OF DOG', d.x + d.w / 2, d.y + 134, d.w - 60);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(120,60,30,${0.2 + rnd() * 0.4})`;
    const x = d.x + 12 + rnd() * (d.w - 24);
    g.fillRect(x, d.y + 12, 2 + rnd() * 4, 6 + rnd() * 40); // rust runs from the top
  }
}

let atlas: THREE.Texture | null = null;

function slumsAtlas(): THREE.Texture {
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
export function slumsSignMaterial(glow: number): THREE.MeshStandardMaterial {
  const map = slumsAtlas();
  const surface = new THREE.DataTexture(new Uint8Array([0, 230, 0, 255]), 1, 1);
  surface.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    vertexColors: true, map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: glow,
    roughnessMap: surface, metalnessMap: surface, roughness: 1, metalness: 1,
  });
}

/** A w × h plate facing +Z with a cell on it, white vertex colours. */
export function slumsPlate(w: number, h: number, cell: SlumsCell): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const c = CELLS[cell];
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (c.x + uv.getX(i) * c.w) / W, 1 - (c.y + (1 - uv.getY(i)) * c.h) / H);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  return geo;
}
