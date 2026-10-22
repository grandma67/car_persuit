// Procedural facade textures: one 8×8 grid of window cells per style, each cell one window bay
// (WINDOW_WIDTH metres wide, one floor tall). Diffuse is drawn light so the building's vertex
// colour tints it; emissive holds the randomly lit windows; the surface map makes glass glossy
// (green = roughness, blue = metalness, as MeshStandardMaterial reads them).
import * as THREE from 'three';
import type { Rng } from '../core/Rng';

export type FacadeStyle =
  | 'curtain' | 'office' | 'brick' | 'stucco' | 'shutters' | 'siding' | 'adobe' | 'industrial' | 'halfTimber' | 'ashlar' | 'shophouse' | 'storefront'
  | 'rollerDoors' | 'panel' | 'boards' | 'barnDoors';

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
  halfTimber: {
    // Light plaster between dark oak: posts at each bay's edges, a rail at sill and floor, and
    // diagonal braces either side; a small leaded casement in the middle.
    wall: (c, rng) => speckle(c, rng, 238, 14),
    panes: [{ x: 0.36, y: 0.3, w: 0.28, h: 0.36 }],
    glass: '#2a3138', wallRough: 0.95, glassRough: 0.2, glassMetal: 0.1, lit: 0.28, mullions: 'cross', frame: '#3b2a1c',
    extras: (c, x, y) => {
      const oak = '#3b2a1c';
      const t = PX * 0.07;
      c.fillStyle = oak;
      c.fillRect(x, y, t, PX); // post (the next bay's post closes the right side)
      c.fillRect(x, y + PX - t, PX, t); // floor rail
      c.fillRect(x, y + PX * 0.72, PX * 0.3, t * 0.8); // sill rail beside the window
      c.fillRect(x + PX * 0.7, y + PX * 0.72, PX * 0.3, t * 0.8);
      c.fillRect(x, y + PX * 0.18, PX, t * 0.7); // head rail
      // Braces from the posts up to the head rail, either side of the window.
      c.strokeStyle = oak;
      c.lineWidth = t * 0.8;
      c.beginPath();
      c.moveTo(x + t, y + PX * 0.72);
      c.lineTo(x + PX * 0.3, y + PX * 0.2);
      c.moveTo(x + PX, y + PX * 0.72);
      c.lineTo(x + PX * 0.7, y + PX * 0.2);
      c.stroke();
      leaded(c, { x: 0.36, y: 0.3, w: 0.28, h: 0.36 }, x, y);
    },
  },
  ashlar: {
    // Coursed stone blocks, each tinted a little differently; small deep windows with leaded
    // diamond panes under a lintel.
    wall: (c, rng) => {
      c.fillStyle = grey(200); // mortar
      c.fillRect(0, 0, SIZE, SIZE);
      const course = PX / 5;
      for (let r = 0; r * course < SIZE; r++) {
        let x = -rng.range(0, PX / 2);
        while (x < SIZE) {
          const w = PX * rng.range(0.35, 0.65);
          c.fillStyle = grey(205 + Math.floor(rng.next() * 45));
          c.fillRect(x + 1, r * course + 1, w - 2, course - 2);
          x += w;
        }
      }
    },
    panes: [{ x: 0.38, y: 0.26, w: 0.24, h: 0.44, arch: true }],
    glass: '#262c33', wallRough: 0.95, glassRough: 0.2, glassMetal: 0.1, lit: 0.24, mullions: 'none', frame: '#6f6656',
    extras: (c, x, y) => {
      c.fillStyle = grey(245);
      c.fillRect(x + PX * 0.33, y + PX * 0.7, PX * 0.34, PX * 0.06); // sill
      leaded(c, { x: 0.38, y: 0.26, w: 0.24, h: 0.44 }, x, y);
    },
  },
  shophouse: {
    // Chinatown's upper floors: pastel plaster, two tall windows with round fanlights between
    // pilasters, louvred shutters folded back beside each, a moulded band at each floor.
    wall: (c, rng) => {
      speckle(c, rng, 240, 10);
      for (let y = 0; y < WINDOW_CELLS; y++) { c.fillStyle = grey(212); c.fillRect(0, y * PX + PX - 4, SIZE, 4); }
    },
    panes: [{ x: 0.2, y: 0.2, w: 0.22, h: 0.6, arch: true }, { x: 0.58, y: 0.2, w: 0.22, h: 0.6, arch: true }],
    glass: '#263039', wallRough: 0.9, glassRough: 0.15, glassMetal: 0.15, lit: 0.3, mullions: 'cross', frame: '#f4f0e6',
    extras: (c, x, y) => {
      c.fillStyle = grey(250); // pilasters at the bay's edges
      c.fillRect(x, y, PX * 0.07, PX);
      c.fillRect(x + PX * 0.93, y, PX * 0.07, PX);
      // Shutters, coloured by bay.
      c.fillStyle = ['#3f7a5e', '#2f5f80', '#8a3a30', '#3f7a5e'][(x / PX + y / PX * 3) % 4];
      for (const sx of [0.1, 0.43, 0.8]) {
        c.fillRect(x + PX * sx, y + PX * 0.28, PX * 0.09, PX * 0.52);
      }
      c.fillStyle = 'rgba(0,0,0,0.25)';
      for (const sx of [0.1, 0.43, 0.8]) for (let k = 0; k < 7; k++) c.fillRect(x + PX * sx, y + PX * (0.31 + k * 0.07), PX * 0.09, 1);
    },
  },
  storefront: {
    // A shop's ground floor: a signboard band over wide glazing in a dark frame, a roller shutter
    // half down on some bays.
    wall: (c, rng) => speckle(c, rng, 235, 8),
    panes: [{ x: 0.06, y: 0.32, w: 0.88, h: 0.64 }],
    glass: '#2a3138', wallRough: 0.85, glassRough: 0.1, glassMetal: 0.2, lit: 0.55, mullions: 'vertical', frame: '#3a2a22',
    extras: (c, x, y) => {
      c.fillStyle = grey(150); // the signboard band (a darker shade of the wall)
      c.fillRect(x, y + PX * 0.08, PX, PX * 0.17);
      c.fillStyle = grey(235);
      c.fillRect(x, y + PX * 0.25, PX, PX * 0.03);
      if (((x / PX) * 5 + (y / PX) * 3) % 7 < 2) {
        // A roller shutter, part way down.
        c.fillStyle = '#9aa0a6';
        c.fillRect(x + PX * 0.06, y + PX * 0.32, PX * 0.88, PX * 0.3);
        c.fillStyle = '#7d838a';
        for (let k = 0; k < 9; k++) c.fillRect(x + PX * 0.06, y + PX * (0.33 + k * 0.032), PX * 0.88, 1);
      }
    },
  },
  rollerDoors: {
    // A shed's ground floor: corrugated cladding, a full-height roller door on every other bay with
    // black dock bumpers either side and a hazard-striped sill; a small personnel door between.
    wall: (c, rng) => {
      speckle(c, rng, 222, 10);
      for (let x = 0; x < SIZE; x += 4) { c.fillStyle = grey(188); c.fillRect(x, 0, 1.5, SIZE); }
    },
    panes: [],
    glass: '#2c343c', wallRough: 0.6, glassRough: 0.2, glassMetal: 0.2, lit: 0,
    extras: (c, x, y) => {
      if ((x / PX) % 2 === 0) {
        const x0 = x + PX * 0.1, w = PX * 0.8, y0 = y + PX * 0.1;
        c.fillStyle = grey(150); // the door's frame and head box
        c.fillRect(x0 - 2, y0 - 4, w + 4, PX * 0.9 + 4);
        c.fillStyle = grey(205);
        c.fillRect(x0, y0, w, PX * 0.9);
        c.fillStyle = grey(170); // its slats
        for (let k = 0; k < 18; k++) c.fillRect(x0, y0 + k * (PX * 0.05), w, 1);
        // Hazard stripes along the sill, bumpers either side of the door.
        for (let k = 0; k < 8; k++) {
          c.fillStyle = k % 2 ? '#1c1c1c' : '#e0b62a';
          c.fillRect(x0 + (w * k) / 8, y + PX - 3, w / 8, 3);
        }
        c.fillStyle = '#1a1a1a';
        c.fillRect(x + PX * 0.02, y + PX * 0.62, PX * 0.07, PX * 0.16);
        c.fillRect(x + PX * 0.91, y + PX * 0.62, PX * 0.07, PX * 0.16);
      } else {
        // A personnel door and a small wired window.
        c.fillStyle = '#4a5560';
        c.fillRect(x + PX * 0.38, y + PX * 0.38, PX * 0.24, PX * 0.62);
        c.fillStyle = '#2c343c';
        c.fillRect(x + PX * 0.43, y + PX * 0.45, PX * 0.14, PX * 0.12);
      }
    },
  },
  panel: {
    // A cold store: windowless insulated sandwich panels, a joint each metre or so, rivet lines.
    wall: (c, rng) => {
      speckle(c, rng, 238, 6);
      const joint = PX / 3.5;
      for (let y = 0; y < SIZE; y += joint) { c.fillStyle = grey(208); c.fillRect(0, y, SIZE, 1.5); }
      for (let x = 0; x < SIZE; x += PX) { c.fillStyle = grey(215); c.fillRect(x, 0, 1, SIZE); }
    },
    panes: [],
    glass: '#2c343c', wallRough: 0.5, glassRough: 0.2, glassMetal: 0.2, lit: 0,
  },
  boards: {
    // The Farm's barns and sheds: barn-red board-and-batten (painted into the texture, so white trim
    // stays white), a small square window per bay in a white frame, white corner boards at the
    // bays' edges.
    wall: (c, rng) => {
      c.fillStyle = BARN_RED;
      c.fillRect(0, 0, SIZE, SIZE);
      boardGrain(c, rng);
    },
    panes: [{ x: 0.38, y: 0.3, w: 0.24, h: 0.24 }],
    glass: '#20262c', wallRough: 0.9, glassRough: 0.2, glassMetal: 0.1, lit: 0.15, mullions: 'cross', frame: '#f4f2ea',
    extras: (c, x, y) => {
      c.fillStyle = '#f4f2ea'; // window trim: a wider white surround and a sill
      c.fillRect(x + PX * 0.33, y + PX * 0.56, PX * 0.34, PX * 0.05);
      if ((x / PX) % 4 === 0) c.fillRect(x, y, PX * 0.05, PX); // corner boards now and then
    },
  },
  barnDoors: {
    // A barn's ground floor: big X-braced sliding doors in white trim on every other bay (their
    // track along the top), boards between with a small square window.
    wall: (c, rng) => {
      c.fillStyle = BARN_RED;
      c.fillRect(0, 0, SIZE, SIZE);
      boardGrain(c, rng);
    },
    panes: [],
    glass: '#20262c', wallRough: 0.9, glassRough: 0.2, glassMetal: 0.1, lit: 0,
    extras: (c, x, y) => {
      const white = '#f4f2ea';
      if ((x / PX) % 2 === 0) {
        const x0 = x + PX * 0.06, x1 = x + PX * 0.94, y0 = y + PX * 0.12, y1 = y + PX;
        const t = PX * 0.06;
        c.fillStyle = '#2a2a2a'; // the track
        c.fillRect(x, y0 - PX * 0.05, PX, PX * 0.03);
        c.fillStyle = white;
        c.fillRect(x0, y0, x1 - x0, t);
        c.fillRect(x0, y1 - t, x1 - x0, t);
        c.fillRect(x0, y0, t, y1 - y0);
        c.fillRect(x1 - t, y0, t, y1 - y0);
        c.fillRect((x0 + x1) / 2 - t / 2, y0, t, y1 - y0); // the two leaves meet in the middle
        c.strokeStyle = white;
        c.lineWidth = t * 0.9;
        c.beginPath();
        for (const [a, b] of [[x0, (x0 + x1) / 2], [(x0 + x1) / 2, x1]]) {
          c.moveTo(a + t, y0 + t);
          c.lineTo(b - t, y1 - t);
          c.moveTo(b - t, y0 + t);
          c.lineTo(a + t, y1 - t);
        }
        c.stroke();
      } else {
        c.fillStyle = white;
        c.fillRect(x + PX * 0.36, y + PX * 0.3, PX * 0.28, PX * 0.28);
        c.fillStyle = '#20262c';
        c.fillRect(x + PX * 0.4, y + PX * 0.34, PX * 0.2, PX * 0.2);
      }
    },
  },
};

/** The barn red painted into the farm's board textures (Farm.ts BARN_RED). */
const BARN_RED = '#a8322a';

/** Board-and-batten: a battens every quarter bay and a little grain in the boards between. */
function boardGrain(c: Ctx, rng: Rng): void {
  for (let x = 0; x < SIZE; x += PX / 8) {
    c.fillStyle = `rgba(0,0,0,${0.04 + rng.next() * 0.08})`;
    c.fillRect(x, 0, PX / 8, SIZE);
  }
  for (let x = 0; x < SIZE; x += PX / 4) {
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(x + 3, 0, 1, SIZE);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(x, 0, 3, SIZE);
  }
}

/** Lead cames in a diamond lattice over a pane. */
function leaded(c: Ctx, p: Pane, x: number, y: number): void {
  const px = x + p.x * PX, py = y + p.y * PX, w = p.w * PX, h = p.h * PX;
  c.save();
  c.beginPath();
  c.rect(px, py, w, h);
  c.clip();
  c.strokeStyle = 'rgba(30,30,30,0.85)';
  c.lineWidth = 1;
  c.beginPath();
  const step = w / 3;
  for (let k = -6; k <= 6; k++) {
    c.moveTo(px + k * step, py);
    c.lineTo(px + k * step + h, py + h);
    c.moveTo(px + k * step, py + h);
    c.lineTo(px + k * step + h, py);
  }
  c.stroke();
  c.restore();
}

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
