// The Slums' graffiti: one canvas atlas drawn at load, 32 cells (4 × 8, each 2:1) in families —
// tags, bubble letters, throw-ups, stencils, murals (world/districts/SlumsStreet.ts GRAFFITI). Each
// piece is painted on its own ground (a buffed patch, plywood, bare concrete), so the cells are
// opaque and the pieces merge into one mesh with the facade walls' material settings: no new
// shader program. Made-up words only.
import * as THREE from 'three';
import { GRAFFITI } from '../../world/districts/SlumsStreet';

const W = 1024;
const H = 1024;
const CW = 256;
const CH = 128;
const WORDS = ['ZORK', 'MEKA', 'VEXO', 'KROOM', 'BLIP', 'SNUZ', 'OKRA', 'FIZZ', 'NUBO', 'TAZE', 'GROK', 'YUMI', 'RAKE', 'DUSK', 'PLOW', 'ZEEP'];
const INK = ['#e23a2e', '#f2c21a', '#2fa8e0', '#5ad24a', '#e04ab8', '#f27a1a', '#ffffff', '#1a1a1a', '#8a4ae0'];
const ROUND = '"Arial Rounded MT Bold", "Arial Black", Impact, sans-serif';
const HAND = '"Marker Felt", "Comic Sans MS", "Brush Script MT", cursive';
const STENCIL = 'Impact, "Arial Black", sans-serif';

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

type G = CanvasRenderingContext2D;

/** A wall the city painted over: a flat patch of grey or beige with a ragged roller edge. */
function buff(g: G, x: number, y: number, rnd: () => number): void {
  const tones = ['#8a8680', '#9a9288', '#7a7a76', '#a89c88', '#6e6a66'];
  g.fillStyle = tones[Math.floor(rnd() * tones.length)];
  g.fillRect(x, y, CW, CH);
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.06})`;
    g.fillRect(x + rnd() * CW, y, 6 + rnd() * 30, CH); // roller strokes
  }
}

function plywood(g: G, x: number, y: number, rnd: () => number): void {
  g.fillStyle = '#b89a6a';
  g.fillRect(x, y, CW, CH);
  for (let k = 0; k < 18; k++) {
    g.fillStyle = `rgba(90,60,30,${0.08 + rnd() * 0.12})`;
    g.fillRect(x, y + rnd() * CH, CW, 1 + rnd() * 2);
  }
  g.fillStyle = 'rgba(60,40,20,0.5)';
  g.fillRect(x + CW / 2, y, 2, CH);
}

function concrete(g: G, x: number, y: number, rnd: () => number): void {
  g.fillStyle = '#a8a49a';
  g.fillRect(x, y, CW, CH);
  for (let k = 0; k < 60; k++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + rnd() * 0.08})`;
    g.fillRect(x + rnd() * CW, y + rnd() * CH, 2 + rnd() * 6, 2 + rnd() * 6);
  }
}

/** Paint drips under a piece. */
function drips(g: G, x: number, y: number, w: number, colour: string, rnd: () => number): void {
  g.fillStyle = colour;
  for (let k = 0; k < 6; k++) g.fillRect(x + rnd() * w, y, 2, 6 + rnd() * 20);
}

function tag(g: G, x: number, y: number, word: string, rnd: () => number): void {
  buff(g, x, y, rnd);
  const ink = INK[Math.floor(rnd() * INK.length)];
  g.save();
  g.translate(x + CW / 2, y + CH / 2);
  g.rotate((rnd() - 0.5) * 0.3);
  g.font = `italic bold 58px ${HAND}`;
  g.fillStyle = ink;
  g.fillText(word, 0, 0, CW - 30);
  g.lineWidth = 3;
  g.strokeStyle = ink;
  g.beginPath(); // the underline flourish
  g.moveTo(-CW * 0.38, 30);
  g.quadraticCurveTo(0, 48, CW * 0.4, 22);
  g.stroke();
  g.restore();
  drips(g, x + 40, y + CH / 2 + 18, CW - 80, ink, rnd);
}

function bubble(g: G, x: number, y: number, word: string, rnd: () => number): void {
  buff(g, x, y, rnd);
  const fill = INK[Math.floor(rnd() * 6)], outline = '#1a1a1a';
  g.save();
  g.translate(x + CW / 2, y + CH / 2 + 4);
  g.rotate((rnd() - 0.5) * 0.15);
  g.font = `bold 78px ${ROUND}`;
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = '#f4f2ea'; // the white cloud round it
  g.strokeText(word, 0, 0, CW - 24);
  g.lineWidth = 7;
  g.strokeStyle = outline;
  g.strokeText(word, 0, 0, CW - 24);
  const grad = g.createLinearGradient(0, -30, 0, 30);
  grad.addColorStop(0, fill);
  grad.addColorStop(1, INK[Math.floor(rnd() * 6)]);
  g.fillStyle = grad;
  g.fillText(word, 0, 0, CW - 24);
  g.fillStyle = 'rgba(255,255,255,0.7)'; // shine
  for (let k = 0; k < 4; k++) g.fillRect(-CW / 2 + 30 + k * 50, -24, 8, 4);
  g.restore();
}

function throwUp(g: G, x: number, y: number, word: string, rnd: () => number): void {
  plywood(g, x, y, rnd);
  const fill = rnd() < 0.5 ? '#f4f2ea' : '#c8c8c8';
  g.save();
  g.translate(x + CW / 2, y + CH / 2 + 6);
  g.font = `bold 86px ${ROUND}`;
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = rnd() < 0.5 ? '#1a1a1a' : '#b8241c';
  g.strokeText(word.slice(0, 3), 0, 0, CW - 30);
  g.fillStyle = fill;
  g.fillText(word.slice(0, 3), 0, 0, CW - 30);
  g.restore();
  drips(g, x + 30, y + CH - 24, CW - 60, '#1a1a1a', rnd);
}

function stencil(g: G, x: number, y: number, i: number, rnd: () => number): void {
  concrete(g, x, y, rnd);
  g.fillStyle = '#1a1a1a';
  g.save();
  g.translate(x + CW / 2, y + CH / 2);
  if (i % 2 === 0) {
    // A face: round head, two eyes, a flat mouth.
    g.beginPath();
    g.arc(-60, 0, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#a8a49a';
    g.fillRect(-78, -14, 12, 12);
    g.fillRect(-54, -14, 12, 12);
    g.fillRect(-76, 14, 32, 6);
    g.fillStyle = '#1a1a1a';
    g.font = `bold 40px ${STENCIL}`;
    g.fillText(['WAKE UP', 'NO WAY'][i % 4 ? 1 : 0], 40, 4);
  } else {
    // A crown over a word.
    g.beginPath();
    g.moveTo(-40, -10); g.lineTo(-40, -50); g.lineTo(-20, -28); g.lineTo(0, -56); g.lineTo(20, -28); g.lineTo(40, -50); g.lineTo(40, -10);
    g.fill();
    g.font = `bold 44px ${STENCIL}`;
    g.fillText(['KING VEX', 'SNUZ 4EVA'][i % 4 === 1 ? 0 : 1], 0, 30);
  }
  g.restore();
}

function mural(g: G, x: number, y: number, i: number, rnd: () => number): void {
  // A sky, a sun or moon, hills or waves, a stylised face or a block of colour; a frame of the wall.
  const skies = [['#2a3a7a', '#e87a4a'], ['#4ab8e8', '#f4e8c8'], ['#1a1a3a', '#6a3a8a'], ['#e8c84a', '#e84a3a'], ['#3a8a6a', '#c8e84a'], ['#8a3a6a', '#f2a24a']];
  const [top, bottom] = skies[i % skies.length];
  const grad = g.createLinearGradient(0, y, 0, y + CH);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(x, y, CW, CH);
  g.fillStyle = i % 2 ? '#f4f2ea' : '#ffd84a';
  g.beginPath();
  g.arc(x + 60 + rnd() * 130, y + 40, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ['#2a5a3a', '#1a3a6a', '#3a2a4a'][i % 3];
  g.beginPath();
  g.moveTo(x, y + CH);
  for (let k = 0; k <= 8; k++) g.lineTo(x + (k * CW) / 8, y + CH - 28 - rnd() * 34);
  g.lineTo(x + CW, y + CH);
  g.fill();
  if (i % 3 === 0) {
    // A big face in profile.
    g.fillStyle = '#c8865a';
    g.beginPath();
    g.ellipse(x + CW * 0.72, y + CH * 0.55, 34, 44, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1a1a';
    g.fillRect(x + CW * 0.72 + 8, y + CH * 0.48, 8, 6);
  }
  g.font = `bold 22px ${ROUND}`;
  g.fillStyle = '#f4f2ea';
  g.textAlign = 'left';
  g.fillText(WORDS[(i * 5) % WORDS.length], x + 10, y + CH - 10);
  g.textAlign = 'center';
}

let atlas: THREE.Texture | null = null;

function graffitiAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let c = 0; c < GRAFFITI.cells; c++) {
    const x = (c % 4) * CW, y = Math.floor(c / 4) * CH;
    const rnd = rand(c * 7919 + 17);
    const word = WORDS[c % WORDS.length];
    if (c < GRAFFITI.tags[1]) tag(g, x, y, word, rnd);
    else if (c < GRAFFITI.bubbles[1]) bubble(g, x, y, word, rnd);
    else if (c < GRAFFITI.throws[1]) throwUp(g, x, y, word, rnd);
    else if (c < GRAFFITI.stencils[1]) stencil(g, x, y, c, rnd);
    else mural(g, x, y, c, rnd);
  }
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** The pieces' material: the facade walls' settings (vertex colours, map, emissive, roughness and metalness maps). */
export function graffitiMaterial(glow: number): THREE.MeshStandardMaterial {
  const map = graffitiAtlas();
  const surface = new THREE.DataTexture(new Uint8Array([0, 235, 0, 255]), 1, 1);
  surface.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    vertexColors: true, map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: glow,
    roughnessMap: surface, metalnessMap: surface, roughness: 1, metalness: 1,
  });
}

/** A w × h piece facing +Z on cell `cell`, white vertex colours (tinted by `shade` for weathering). */
export function graffitiPlate(w: number, h: number, cell: number, shade = 1): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const x = (cell % 4) * CW, y = Math.floor(cell / 4) * CH;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * CW) / W, 1 - (y + (1 - uv.getY(i)) * CH) / H);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(shade), 3));
  return geo;
}
