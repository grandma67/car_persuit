// Chinese characters for Chinatown's name boards, banners and signs: real, neutral glyphs (中華街
// Chinatown, 福 fortune, 春 spring) drawn once at load into one canvas atlas from the system's fonts
// (nearly every phone has CJK fonts; a generic serif is the last resort). Plates use the sign faces'
// material settings, so they add no shader program.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FONT = '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Noto Serif CJK SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "SimHei", serif';
const SIZE = 1024;

export type GlyphCell = 'board' | 'fu' | 'chun';

/** Each cell's rectangle in atlas pixels (top-left origin). */
const CELLS: Record<GlyphCell, { x: number; y: number; w: number; h: number }> = {
  board: { x: 0, y: 0, w: 1024, h: 256 },
  fu: { x: 0, y: 256, w: 256, h: 512 },
  chun: { x: 256, y: 256, w: 256, h: 512 },
};

const RED = '#a8191c';
const GOLD = '#e0b13e';
const GOLD_DARK = '#8a5f12';

function draw(g: CanvasRenderingContext2D): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // The paifang's name board: gold leaf in a red frame, the name in deep red.
  const b = CELLS.board;
  g.fillStyle = RED;
  g.fillRect(b.x, b.y, b.w, b.h);
  g.fillStyle = GOLD;
  g.fillRect(b.x + 22, b.y + 22, b.w - 44, b.h - 44);
  g.strokeStyle = GOLD_DARK;
  g.lineWidth = 6;
  g.strokeRect(b.x + 36, b.y + 36, b.w - 72, b.h - 72);
  g.fillStyle = RED;
  g.font = `bold 168px ${FONT}`;
  ['中', '華', '街'].forEach((ch, i) => g.fillText(ch, b.x + b.w * (0.25 + i * 0.25), b.y + b.h / 2 + 6));
  // Banners: red cloth with a gold edge and one gold character.
  for (const [cell, ch] of [['fu', '福'], ['chun', '春']] as const) {
    const c = CELLS[cell];
    g.fillStyle = RED;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.strokeStyle = GOLD;
    g.lineWidth = 12;
    g.strokeRect(c.x + 18, c.y + 18, c.w - 36, c.h - 36);
    g.fillStyle = GOLD;
    g.font = `bold 190px ${FONT}`;
    g.fillText(ch, c.x + c.w / 2, c.y + c.h * 0.45);
    // A fringe of tassels along the bottom.
    for (let k = 0; k < 7; k++) g.fillRect(c.x + 26 + k * 33, c.y + c.h - 60, 10, 42);
  }
}

let atlas: THREE.Texture | null = null;

/** The shared atlas texture (drawn on first use). */
export function glyphAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  draw(canvas.getContext('2d')!);
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/** The material for glyph plates: the same settings as the street signs' faces (no new program). */
export function glyphMaterial(): THREE.MeshStandardMaterial {
  const map = glyphAtlas();
  return new THREE.MeshStandardMaterial({ map, roughness: 0.45, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.12 });
}

/** Map a plane's UVs (0..1) onto a cell. */
function toCell(geo: THREE.BufferGeometry, cell: GlyphCell): THREE.BufferGeometry {
  const c = CELLS[cell];
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (c.x + uv.getX(i) * c.w) / SIZE, 1 - (c.y + (1 - uv.getY(i)) * c.h) / SIZE);
  return geo;
}

/**
 * A w × h plate showing a cell, facing +Z, with a back face `gap` behind it facing -Z (turned
 * round, so it reads the right way too, and needs no double-sided material).
 */
export function glyphPlate(w: number, h: number, cell: GlyphCell, gap = 0): THREE.BufferGeometry {
  const front = toCell(new THREE.PlaneGeometry(w, h), cell).translate(0, 0, gap / 2);
  const back = toCell(new THREE.PlaneGeometry(w, h), cell).rotateY(Math.PI).translate(0, 0, -gap / 2);
  return mergeGeometries([front, back]);
}
