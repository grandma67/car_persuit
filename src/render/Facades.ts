// Procedural facade textures: one 8×8 grid of window cells per style, each cell one window bay
// (WINDOW_WIDTH metres wide, one floor tall). Diffuse is drawn light so the building's vertex
// colour tints it; emissive holds the randomly lit windows; the surface map makes glass glossy
// (green = roughness, blue = metalness, as MeshStandardMaterial reads them).
import * as THREE from 'three';
import type { Rng } from '../core/Rng';

export type FacadeStyle =
  | 'curtain' | 'office' | 'brick' | 'stucco' | 'shutters' | 'siding' | 'adobe' | 'industrial' | 'halfTimber' | 'ashlar' | 'shophouse' | 'storefront'
  | 'rollerDoors' | 'panel' | 'boards' | 'barnDoors' | 'tenement' | 'boarded' | 'charred';

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
  /** Drawn per cell last, on all three maps (a boarded window mustn't glow): diffuse, emissive, surface. */
  cell?: (m: CellMaps, x: number, y: number, rng: Rng, lit: boolean) => void;
}

interface CellMaps { d: Ctx; e: Ctx; s: Ctx; wall: string }

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
  tenement: {
    // The Slums' walk-ups: grimy brick, a plain window per bay with a concrete sill, every window
    // its own story (dirty, cracked, smashed, boarded, curtained), stains running down from the sills.
    wall: (c, rng) => {
      c.fillStyle = grey(190);
      c.fillRect(0, 0, SIZE, SIZE);
      const course = PX / 12;
      for (let r = 0; r * course < SIZE; r++) {
        const brick = PX / 4;
        for (let x = (r % 2) * -brick / 2; x < SIZE; x += brick) {
          c.fillStyle = grey(150 + Math.floor(rng.next() * 45));
          c.fillRect(x + 1, r * course + 1, brick - 1, course - 1);
        }
      }
      grime(c, rng);
    },
    panes: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.56 }],
    glass: '#1e2328', wallRough: 0.97, glassRough: 0.35, glassMetal: 0.1, lit: 0.18, mullions: 'vertical', frame: '#8a8478',
    extras: (c, x, y) => {
      c.fillStyle = grey(200); // sill and lintel
      c.fillRect(x + PX * 0.26, y + PX * 0.76, PX * 0.48, PX * 0.05);
      c.fillRect(x + PX * 0.27, y + PX * 0.15, PX * 0.46, PX * 0.05);
    },
    cell: (m, x, y, rng, lit) => {
      const p = { x: 0.3, y: 0.2, w: 0.4, h: 0.56 };
      const roll = rng.next();
      if (roll < 0.14) boardOver(m, p, x, y, rng);
      else if (roll < 0.24) smashed(m, p, x, y, rng);
      else if (roll < 0.4) cracks(m.d, p, x, y, rng);
      else if (roll < 0.6) curtains(m, p, x, y, rng, lit);
      // Dirt runs from the sill.
      if (rng.next() < 0.6) streak(m.d, x + PX * (0.3 + rng.next() * 0.4), y + PX * 0.81, PX * (0.15 + rng.next() * 0.3), 'rgba(40,30,20,0.35)');
    },
  },
  boarded: {
    // Shut shops on the ground floor: plywood over the windows, rusted roller shutters, barred glass.
    wall: (c, rng) => {
      speckle(c, rng, 200, 24);
      grime(c, rng);
    },
    panes: [{ x: 0.06, y: 0.3, w: 0.88, h: 0.66 }],
    glass: '#1a1e22', wallRough: 0.9, glassRough: 0.3, glassMetal: 0.15, lit: 0.06, mullions: 'none', frame: '#3a3430',
    extras: (c, x, y) => {
      c.fillStyle = grey(120); // the old signboard band
      c.fillRect(x, y + PX * 0.08, PX, PX * 0.16);
    },
    cell: (m, x, y, rng) => {
      const p = { x: 0.06, y: 0.3, w: 0.88, h: 0.66 };
      const roll = rng.next();
      if (roll < 0.4) boardOver(m, p, x, y, rng);
      else if (roll < 0.75) {
        // A rusted roller shutter, all the way down.
        const px = x + p.x * PX, py = y + p.y * PX, w = p.w * PX, h = p.h * PX;
        for (const c of [m.d, m.e, m.s]) { c.fillStyle = c === m.d ? '#8a8e90' : c === m.e ? '#000' : m.wall; c.fillRect(px, py, w, h); }
        m.d.fillStyle = '#6a6e72';
        for (let k = 0; k < 16; k++) m.d.fillRect(px, py + (k * h) / 16, w, 1);
        for (let k = 0; k < 5; k++) streak(m.d, px + rng.next() * w, py, h * (0.3 + rng.next() * 0.7), 'rgba(130,60,25,0.45)');
        m.d.fillStyle = '#2a2a2a';
        m.d.fillRect(px + w / 2 - 3, py + h - 5, 6, 3); // the padlock
      } else {
        // Barred glass.
        m.d.fillStyle = '#2a2a2a';
        for (let k = 1; k < 8; k++) m.d.fillRect(x + (p.x + (p.w * k) / 8) * PX - 1, y + p.y * PX, 2, p.h * PX);
        m.d.fillRect(x + p.x * PX, y + (p.y + p.h * 0.5) * PX, p.w * PX, 2);
        cracks(m.d, p, x, y, rng);
      }
    },
  },
  charred: {
    // Burnt-out shells: soot-blackened brick, empty window holes, scorch plumes up from each.
    wall: (c, rng) => {
      c.fillStyle = grey(120);
      c.fillRect(0, 0, SIZE, SIZE);
      const course = PX / 12;
      for (let r = 0; r * course < SIZE; r++) {
        const brick = PX / 4;
        for (let x = (r % 2) * -brick / 2; x < SIZE; x += brick) {
          c.fillStyle = grey(95 + Math.floor(rng.next() * 40));
          c.fillRect(x + 1, r * course + 1, brick - 1, course - 1);
        }
      }
      grime(c, rng);
    },
    panes: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.56 }],
    glass: '#0a0a0a', wallRough: 1, glassRough: 1, glassMetal: 0, lit: 0, mullions: 'none',
    cell: (m, x, y, rng) => {
      // Soot plume up from the window head, darkest at the hole.
      const px = x + PX * 0.3, w = PX * 0.4, top = y + PX * 0.2;
      const g = m.d.createLinearGradient(0, top, 0, top - PX * (0.25 + rng.next() * 0.35));
      g.addColorStop(0, 'rgba(10,10,10,0.85)');
      g.addColorStop(1, 'rgba(10,10,10,0)');
      m.d.fillStyle = g;
      m.d.beginPath();
      m.d.moveTo(px - 2, top);
      m.d.lineTo(px + w + 2, top);
      m.d.lineTo(px + w + PX * 0.12, top - PX * 0.5);
      m.d.lineTo(px - PX * 0.12, top - PX * 0.5);
      m.d.fill();
      if (rng.next() < 0.3) boardOver(m, { x: 0.3, y: 0.2, w: 0.4, h: 0.56 }, x, y, rng);
    },
  },
};

/** Grime: darker drifts down the wall and a dirty band along each floor. */
function grime(c: Ctx, rng: Rng): void {
  for (let k = 0; k < 30; k++) streak(c, rng.next() * SIZE, rng.next() * SIZE, PX * (0.4 + rng.next()), `rgba(30,24,18,${0.08 + rng.next() * 0.12})`, PX * (0.05 + rng.next() * 0.2));
  for (let y = 0; y < WINDOW_CELLS; y++) {
    const g = c.createLinearGradient(0, y * PX + PX * 0.7, 0, y * PX + PX);
    g.addColorStop(0, 'rgba(30,24,18,0)');
    g.addColorStop(1, 'rgba(30,24,18,0.18)');
    c.fillStyle = g;
    c.fillRect(0, y * PX + PX * 0.7, SIZE, PX * 0.3);
  }
}

/** A streak fading downwards from (x, y). */
function streak(c: Ctx, x: number, y: number, len: number, colour: string, w = 2): void {
  const g = c.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, colour);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(x - w / 2, y, w, len);
}

/** Plywood nailed over a pane: no glow, no gloss. */
function boardOver(m: CellMaps, p: Pane, x: number, y: number, rng: Rng): void {
  const px = x + p.x * PX - 2, py = y + p.y * PX - 2, w = p.w * PX + 4, h = p.h * PX + 4;
  const tone = 150 + Math.floor(rng.next() * 50);
  m.d.fillStyle = `rgb(${tone},${Math.floor(tone * 0.8)},${Math.floor(tone * 0.55)})`;
  m.d.fillRect(px, py, w, h);
  m.d.fillStyle = 'rgba(60,40,20,0.25)';
  for (let k = 0; k < 4; k++) m.d.fillRect(px, py + rng.next() * h, w, 1);
  if (w > PX * 0.5) m.d.fillRect(px + w / 2, py, 1, h); // the sheets' joint
  m.e.fillStyle = '#000';
  m.e.fillRect(px, py, w, h);
  m.s.fillStyle = m.wall;
  m.s.fillRect(px, py, w, h);
}

/** A smashed pane: a dark hole with shards left in the frame. */
function smashed(m: CellMaps, p: Pane, x: number, y: number, rng: Rng): void {
  const px = x + p.x * PX, py = y + p.y * PX, w = p.w * PX, h = p.h * PX;
  m.d.fillStyle = '#0c0c0c';
  m.d.fillRect(px, py, w, h);
  m.e.fillStyle = '#000';
  m.e.fillRect(px, py, w, h);
  m.d.fillStyle = '#3a4650';
  for (const [cx, cy] of [[px, py], [px + w, py], [px, py + h], [px + w, py + h]]) {
    if (rng.next() < 0.5) continue;
    m.d.beginPath();
    m.d.moveTo(cx, cy);
    m.d.lineTo(cx + (px + w / 2 - cx) * rng.range(0.3, 0.8), cy);
    m.d.lineTo(cx, cy + (py + h / 2 - cy) * rng.range(0.3, 0.8));
    m.d.fill();
  }
}

/** Cracks across a pane. */
function cracks(c: Ctx, p: Pane, x: number, y: number, rng: Rng): void {
  const px = x + p.x * PX, py = y + p.y * PX, w = p.w * PX, h = p.h * PX;
  const ox = px + rng.next() * w, oy = py + rng.next() * h;
  c.strokeStyle = 'rgba(220,225,230,0.7)';
  c.lineWidth = 1;
  c.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = rng.next() * Math.PI * 2, r = rng.range(0.3, 0.7) * Math.max(w, h);
    c.moveTo(ox, oy);
    c.lineTo(Math.min(px + w, Math.max(px, ox + Math.cos(a) * r)), Math.min(py + h, Math.max(py, oy + Math.sin(a) * r)));
  }
  c.stroke();
}

/** Curtains or a sheet hung inside: a colour, glowing through when the window's lit. */
function curtains(m: CellMaps, p: Pane, x: number, y: number, rng: Rng, lit: boolean): void {
  const colours = ['#8a3a30', '#3a5a7a', '#c8b88a', '#5a7a4a', '#d8d0c0', '#7a4a6a'];
  const colour = colours[Math.floor(rng.next() * colours.length)];
  const px = x + p.x * PX, py = y + p.y * PX, w = p.w * PX, h = p.h * PX;
  const gap = rng.range(0, 0.5) * w;
  m.d.fillStyle = colour;
  m.d.fillRect(px, py, (w - gap) / 2, h);
  m.d.fillRect(px + (w + gap) / 2, py, (w - gap) / 2, h);
  if (lit) {
    m.e.fillStyle = colour;
    m.e.fillRect(px, py, (w - gap) / 2, h);
    m.e.fillRect(px + (w + gap) / 2, py, (w - gap) / 2, h);
  }
}

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
      spec.cell?.({ d, e, s, wall: wallSurface }, x, y, rng, !!lit);
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
