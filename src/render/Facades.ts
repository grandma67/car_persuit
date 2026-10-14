// Procedural facade textures: one 8×8 grid of window cells per style, each cell one window bay
// (WINDOW_WIDTH metres wide, one floor tall). Diffuse is drawn light so the building's vertex
// colour tints it; emissive holds the randomly lit windows; the surface map makes glass glossy
// (green = roughness, blue = metalness, as MeshStandardMaterial reads them).
import * as THREE from 'three';
import type { Rng } from '../core/Rng';

export type FacadeStyle = 'curtain' | 'office' | 'brick' | 'stucco' | 'shutters' | 'siding' | 'adobe' | 'industrial';

export const WINDOW_CELLS = 8;
const PX = 64; // pixels per cell
const SIZE = PX * WINDOW_CELLS;

export interface FacadeTextures {
  map: THREE.Texture;
  emissive: THREE.Texture;
  surface: THREE.Texture;
}

type Ctx = CanvasRenderingContext2D;
interface Pane { x: number; y: number; w: number; h: number; arch?: boolean }

/** Per-style look: wall pattern, window panes within a cell (0..1 of the cell, y down), extras. */
interface StyleSpec {
  wall: (c: Ctx, rng: Rng) => void;
  panes: Pane[];
  glass: string;
  wallRough: number;
  glassRough: number;
  glassMetal: number;
  lit: number; // chance a window is lit
  mullions?: 'cross' | 'vertical' | 'none';
  frame?: string; // window frame colour
  extras?: (c: Ctx, x: number, y: number) => void; // drawn per cell after the window
}

const grey = (v: number) => `rgb(${v},${v},${v})`;

/** Fine per-pixel noise, for render (stucco, adobe) or weathering. */
function speckle(c: Ctx, rng: Rng, base: number, spread: number): void {
  const img = c.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = base + (rng.next() - 0.5) * spread;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

const STYLES: Record<FacadeStyle, StyleSpec> = {
  curtain: {
    // Full-height glazing between thin mullions, a dark spandrel band at each floor slab.
    wall: (c) => { c.fillStyle = grey(225); c.fillRect(0, 0, SIZE, SIZE); },
    panes: [{ x: 0.04, y: 0.12, w: 0.44, h: 0.84 }, { x: 0.52, y: 0.12, w: 0.44, h: 0.84 }],
    glass: '#3a4a5c', wallRough: 0.5, glassRough: 0.08, glassMetal: 0.1, lit: 0.3,
  },
  office: {
    // Stone grid: wide punched windows, a horizontal band per floor.
    wall: (c, rng) => {
      speckle(c, rng, 230, 14);
      for (let y = 0; y < WINDOW_CELLS; y++) { c.fillStyle = grey(200); c.fillRect(0, y * PX, SIZE, PX * 0.08); }
    },
    panes: [{ x: 0.12, y: 0.22, w: 0.76, h: 0.56 }],
    glass: '#2a3542', wallRough: 0.8, glassRough: 0.12, glassMetal: 0.2, lit: 0.28, mullions: 'vertical', frame: '#59626c',
  },
  brick: {
    // Running-bond brick, tall arched windows with a stone sill.
    wall: (c, rng) => {
      c.fillStyle = grey(215); // mortar
      c.fillRect(0, 0, SIZE, SIZE);
      const course = PX / 12;
      for (let r = 0; r * course < SIZE; r++) {
        const brick = PX / 4;
        for (let x = (r % 2) * -brick / 2; x < SIZE; x += brick) {
          c.fillStyle = grey(175 + Math.floor(rng.next() * 40));
          c.fillRect(x + 1, r * course + 1, brick - 1, course - 1);
        }
      }
    },
    panes: [{ x: 0.3, y: 0.18, w: 0.4, h: 0.6, arch: true }],
    glass: '#222a33', wallRough: 0.95, glassRough: 0.15, glassMetal: 0.15, lit: 0.26, mullions: 'cross', frame: '#e8e4dc',
    extras: (c, x, y) => {
      c.fillStyle = grey(245); // stone sill and keystone
      c.fillRect(x + PX * 0.26, y + PX * 0.78, PX * 0.48, PX * 0.05);
      c.fillRect(x + PX * 0.46, y + PX * 0.1, PX * 0.08, PX * 0.07);
    },
  },
  stucco: {
    // Smooth render, a pair of upright windows with light surrounds.
    wall: (c, rng) => speckle(c, rng, 238, 12),
    panes: [{ x: 0.14, y: 0.22, w: 0.28, h: 0.54 }, { x: 0.58, y: 0.22, w: 0.28, h: 0.54 }],
    glass: '#28313b', wallRough: 0.9, glassRough: 0.15, glassMetal: 0.15, lit: 0.25, mullions: 'cross', frame: '#f6f4ee',
  },
  shutters: {
    // Render with a single window flanked by louvred shutters and a small balcony rail.
    wall: (c, rng) => speckle(c, rng, 240, 12),
    panes: [{ x: 0.34, y: 0.2, w: 0.32, h: 0.58 }],
    glass: '#262e36', wallRough: 0.9, glassRough: 0.15, glassMetal: 0.15, lit: 0.24, mullions: 'vertical', frame: '#f4f2ea',
    extras: (c, x, y) => {
      c.fillStyle = '#4f7a6a';
      for (const sx of [0.19, 0.67]) {
        c.fillRect(x + PX * sx, y + PX * 0.2, PX * 0.14, PX * 0.58);
        c.fillStyle = '#3e6456';
        for (let k = 0; k < 8; k++) c.fillRect(x + PX * sx, y + PX * (0.24 + k * 0.07), PX * 0.14, 1);
        c.fillStyle = '#4f7a6a';
      }
      c.fillStyle = '#3a3a3a'; // balcony rail
      c.fillRect(x + PX * 0.28, y + PX * 0.66, PX * 0.44, 2);
      for (let k = 0; k <= 6; k++) c.fillRect(x + PX * (0.28 + k * 0.073), y + PX * 0.66, 1, PX * 0.12);
    },
  },
  siding: {
    // Horizontal boards, white-framed windows with a cross mullion.
    wall: (c, rng) => {
      speckle(c, rng, 235, 8);
      const board = PX / 14;
      for (let y = 0; y < SIZE; y += board) { c.fillStyle = grey(190); c.fillRect(0, y, SIZE, 1.5); }
    },
    panes: [{ x: 0.3, y: 0.24, w: 0.4, h: 0.48 }],
    glass: '#232b34', wallRough: 0.85, glassRough: 0.15, glassMetal: 0.15, lit: 0.27, mullions: 'cross', frame: '#fbfbf8',
  },
  adobe: {
    // Coarse earthen render, small deep-set windows under a timber lintel.
    wall: (c, rng) => speckle(c, rng, 228, 30),
    panes: [{ x: 0.32, y: 0.3, w: 0.36, h: 0.4 }],
    glass: '#1f252c', wallRough: 1, glassRough: 0.2, glassMetal: 0.1, lit: 0.24, mullions: 'none', frame: '#6a5a4a',
    extras: (c, x, y) => {
      c.fillStyle = '#6b4a30';
      c.fillRect(x + PX * 0.26, y + PX * 0.22, PX * 0.48, PX * 0.06);
    },
  },
  industrial: {
    // Corrugated cladding with a high strip of factory glazing.
    wall: (c, rng) => {
      speckle(c, rng, 225, 10);
      for (let x = 0; x < SIZE; x += 4) { c.fillStyle = grey(190); c.fillRect(x, 0, 1.5, SIZE); }
    },
    panes: [{ x: 0.04, y: 0.12, w: 0.92, h: 0.3 }],
    glass: '#2c343c', wallRough: 0.6, glassRough: 0.2, glassMetal: 0.2, lit: 0.18, mullions: 'vertical', frame: '#7a7f86',
  },
};

function pane(c: Ctx, p: Pane, x: number, y: number, inset = 0): void {
  const px = x + p.x * PX + inset, py = y + p.y * PX + inset, w = p.w * PX - inset * 2, h = p.h * PX - inset * 2;
  c.beginPath();
  if (p.arch) {
    const r = w / 2;
    c.moveTo(px, py + h);
    c.lineTo(px, py + r);
    c.arc(px + r, py + r, r, Math.PI, 0);
    c.lineTo(px + w, py + h);
    c.closePath();
  } else c.rect(px, py, w, h);
  c.fill();
}

/** Diffuse, emissive and surface (roughness/metalness) maps for one facade style. */
export function createFacadeTextures(style: FacadeStyle, rng: Rng): FacadeTextures {
  const spec = STYLES[style];
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    return [canvas, canvas.getContext('2d', { willReadFrequently: true })!] as const;
  };
  const [dCanvas, d] = make();
  const [eCanvas, e] = make();
  const [sCanvas, s] = make();
  spec.wall(d, rng);
  e.fillStyle = '#000';
  e.fillRect(0, 0, SIZE, SIZE);
  const wallSurface = `rgb(0,${Math.round(spec.wallRough * 255)},0)`;
  s.fillStyle = wallSurface;
  s.fillRect(0, 0, SIZE, SIZE);
  const glassSurface = `rgb(0,${Math.round(spec.glassRough * 255)},${Math.round(spec.glassMetal * 255)})`;
  const frameW = Math.max(1, PX * 0.035);

  for (let cy = 0; cy < WINDOW_CELLS; cy++) {
    for (let cx = 0; cx < WINDOW_CELLS; cx++) {
      const x = cx * PX, y = cy * PX;
      const roll = rng.next();
      const lit = roll < spec.lit ? '#ffd59a' : roll < spec.lit * 1.25 ? '#bcd6ff' : null;
      // Blinds drawn on some unlit windows break up the glass.
      const blind = !lit && rng.next() < 0.2 ? rng.range(0.15, 0.7) : 0;
      for (const p of spec.panes) {
        if (spec.frame) { d.fillStyle = spec.frame; pane(d, p, x, y, -frameW); }
        d.fillStyle = spec.glass;
        pane(d, p, x, y);
        s.fillStyle = glassSurface;
        pane(s, p, x, y);
        if (blind) {
          d.fillStyle = '#b8b2a6';
          d.fillRect(x + p.x * PX, y + p.y * PX, p.w * PX, p.h * PX * blind);
        }
        if (lit) {
          e.fillStyle = lit;
          pane(e, p, x, y);
          if (blind) { e.fillStyle = '#5a4630'; e.fillRect(x + p.x * PX, y + p.y * PX, p.w * PX, p.h * PX * blind); }
        }
        if (spec.mullions && spec.mullions !== 'none') {
          const color = spec.frame ?? '#888';
          for (const c of [d, e]) {
            c.fillStyle = c === d ? color : '#000';
            c.fillRect(x + (p.x + p.w / 2) * PX - frameW / 2, y + p.y * PX, frameW, p.h * PX);
            if (spec.mullions === 'cross') c.fillRect(x + p.x * PX, y + (p.y + p.h * 0.4) * PX - frameW / 2, p.w * PX, frameW);
          }
        }
      }
      spec.extras?.(d, x, y);
    }
  }
  const toTexture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: toTexture(dCanvas, true), emissive: toTexture(eCanvas, true), surface: toTexture(sCanvas, false) };
}
