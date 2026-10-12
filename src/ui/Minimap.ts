// Round, heading-up minimap: the city is pre-drawn once, then each frame it's rotated around the
// player, with the road route and destination drawn on top.
import type { CityData } from '../world/CityGenerator';
import { rampShape } from '../world/Landmarks';
import { groundHeight } from '../world/Terrain';

const SIZE_CSS = 180; // on-screen diameter
const VIEW_RADIUS = 230; // metres from the player to the map edge
const BASE_SCALE = 1; // pixels per metre in the pre-drawn city
const SEA_MARGIN = 300; // metres of sea drawn around the island

const COLORS = {
  sea: '#1a5f78',
  land: '#1b1f27',
  promenade: '#3a404b',
  road: '#6a7282',
  plaza: '#4f4860',
  park: '#25462c',
  route: '#ffb020',
  routeFinal: '#4dff88',
  player: '#ffffff',
  ramp: '#f2c12e',
};

export interface MinimapTarget {
  x: number;
  z: number;
  final: boolean;
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private half: number; // half the pre-drawn map size, in metres
  private time = 0;

  constructor(private city: CityData) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-minimap';
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.canvas.height = SIZE_CSS * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.half = city.islandSize / 2 + SEA_MARGIN;
    this.base = this.drawBase();
  }

  /**
   * World → base-canvas pixels. Looking down with +Z forward, +X is on the left, hence the minus
   * signs: this keeps the map un-mirrored relative to the 3D view.
   */
  private toMap(x: number, z: number): [number, number] {
    return [(this.half - x) * BASE_SCALE, (this.half - z) * BASE_SCALE];
  }

  private drawBase(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(this.half * 2 * BASE_SCALE);
    const g = c.getContext('2d')!;
    const rect = (x: number, z: number, w: number, d: number, fill: string) => {
      const [cx, cy] = this.toMap(x, z);
      g.fillStyle = fill;
      g.fillRect(cx - (w / 2) * BASE_SCALE, cy - (d / 2) * BASE_SCALE, w * BASE_SCALE, d * BASE_SCALE);
    };
    g.fillStyle = COLORS.sea;
    g.fillRect(0, 0, c.width, c.height);
    rect(0, 0, this.city.islandSize, this.city.islandSize, COLORS.promenade);
    rect(0, 0, this.city.size, this.city.size, COLORS.land);
    // The hill: land lightens with height.
    const { terrain } = this.city;
    if (terrain.hill) {
      const step = 8;
      const half = this.city.size / 2;
      for (let x = -half + step / 2; x < half; x += step) {
        for (let z = -half + step / 2; z < half; z += step) {
          const h = groundHeight(terrain, x, z) / terrain.hill.height;
          if (h < 0.02) continue;
          g.globalAlpha = h * 0.22;
          rect(x, z, step, step, '#ffffff');
        }
      }
      g.globalAlpha = 1;
    }
    const water = this.city.islandSize + 2 * SEA_MARGIN;
    for (const c of terrain.canals) {
      if (c.axis === 'x') rect(0, c.at, water, c.half * 2, COLORS.sea);
      else rect(c.at, 0, c.half * 2, water, COLORS.sea);
    }
    for (const b of this.city.blocks) if (b.park) rect(b.rect.x, b.rect.z, b.rect.w, b.rect.d, COLORS.park);
    for (const p of this.city.plazas) rect(p.x, p.z, p.w, p.d, COLORS.plaza);
    for (const b of this.city.blocks) if (b.square) rect(b.rect.x, b.rect.z, b.rect.w - 6, b.rect.d - 6, COLORS.plaza);
    // Landmarks: fountains as blue discs, monuments as light stone dots.
    for (const l of this.city.landmarks) {
      if (l.kind === 'ramp') continue; // drawn over the roads, below
      const [cx, cy] = this.toMap(l.x, l.z);
      g.fillStyle = l.kind === 'fountain' ? '#4aa3d8' : '#d8d2c4';
      g.beginPath();
      g.arc(cx, cy, (l.kind === 'fountain' ? l.radius : l.radius + 1.5) * BASE_SCALE, 0, Math.PI * 2);
      g.fill();
    }
    for (const r of this.city.roads) rect(r.rect.x, r.rect.z, r.rect.w, r.rect.d, COLORS.road);
    for (const i of this.city.intersections) rect(i.x, i.z, i.w, i.d, COLORS.road);
    for (const b of terrain.bridges) rect(b.x, b.z, b.w, b.d, COLORS.road);
    // Jump ramps: a gold arrow from the toe, pointing the way you fly off the lip.
    for (const l of this.city.landmarks) {
      if (l.kind !== 'ramp') continue;
      const s = rampShape(l);
      const fx = Math.sin(l.yaw);
      const fz = Math.cos(l.yaw);
      const at = (along: number, across: number) => this.toMap(l.x + fx * along + fz * across, l.z + fz * along - fx * across);
      const w = Math.max(s.width / 2, 5);
      const tip = s.lip + Math.max(10, (s.lip - s.toe) * 0.5);
      g.beginPath();
      for (const [a, c] of [[s.toe, -w * 0.6], [s.lip, -w * 0.6], [s.lip, -w * 1.5], [tip, 0], [s.lip, w * 1.5], [s.lip, w * 0.6], [s.toe, w * 0.6]]) g.lineTo(...at(a, c));
      g.closePath();
      g.fillStyle = '#ffc21a';
      g.strokeStyle = '#3a2a00';
      g.lineWidth = 2;
      g.fill();
      g.stroke();
    }
    return c;
  }

  /** yaw: player heading, atan2(forward.x, forward.z). route: node ids to draw. */
  render(
    dt: number,
    px: number,
    pz: number,
    yaw: number,
    route: number[] | null,
    target: MinimapTarget | null,
    cops: { x: number; z: number }[] = [],
    ramp: { x: number; z: number } | null = null,
  ): void {
    this.time += dt;
    const g = this.ctx;
    const r = SIZE_CSS / 2;
    const zoom = r / VIEW_RADIUS; // CSS px per metre
    const [mx, my] = this.toMap(px, pz);

    g.save();
    g.clearRect(0, 0, SIZE_CSS, SIZE_CSS);
    g.beginPath();
    g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.clip();

    // Heading-up: rotating by the yaw turns the car's forward direction to screen-up.
    g.save();
    g.translate(r, r);
    g.rotate(yaw);
    g.scale(zoom / BASE_SCALE, zoom / BASE_SCALE);
    g.translate(-mx, -my);
    g.drawImage(this.base, 0, 0);

    const color = target?.final ? COLORS.routeFinal : COLORS.route;
    if (route && route.length && target) {
      g.strokeStyle = color;
      g.lineWidth = 5 * BASE_SCALE / zoom;
      g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      g.moveTo(mx, my);
      for (const id of route) {
        const n = this.city.graph.nodes[id];
        g.lineTo(...this.toMap(n.x, n.z));
      }
      g.stroke();
    }
    g.restore();

    // Destination: drawn in screen space so it can be pinned to the rim when off the map.
    if (target) {
      const [tx, ty] = this.toMap(target.x, target.z);
      const dx = (tx - mx) * (zoom / BASE_SCALE);
      const dy = (ty - my) * (zoom / BASE_SCALE);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      let sx = dx * cos - dy * sin;
      let sy = dx * sin + dy * cos;
      const dist = Math.hypot(sx, sy);
      const maxDist = r - 10;
      if (dist > maxDist) {
        sx *= maxDist / dist;
        sy *= maxDist / dist;
      }
      const pulse = 1 + Math.sin(this.time * 5) * 0.15;
      g.fillStyle = color;
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r + sx, r + sy, 6 * pulse, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // Cops: flashing red/blue dots, pinned to the rim when off the map.
    const flash = Math.sin(this.time * Math.PI * 6) > 0;
    for (const c of cops) {
      const [cx, cy] = this.toMap(c.x, c.z);
      const dx = (cx - mx) * (zoom / BASE_SCALE);
      const dy = (cy - my) * (zoom / BASE_SCALE);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      let sx = dx * cos - dy * sin;
      let sy = dx * sin + dy * cos;
      const d = Math.hypot(sx, sy);
      if (d > r - 8) {
        sx *= (r - 8) / d;
        sy *= (r - 8) / d;
      }
      g.fillStyle = flash ? '#ff3030' : '#3a6bff';
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(r + sx, r + sy, 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // Ramp truck: a yellow triangle, only while it's on the visible map.
    if (ramp) {
      const [cx, cy] = this.toMap(ramp.x, ramp.z);
      const dx = (cx - mx) * (zoom / BASE_SCALE);
      const dy = (cy - my) * (zoom / BASE_SCALE);
      const sx = dx * Math.cos(yaw) - dy * Math.sin(yaw);
      const sy = dx * Math.sin(yaw) + dy * Math.cos(yaw);
      if (Math.hypot(sx, sy) < r - 8) {
        g.fillStyle = COLORS.ramp;
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(r + sx, r + sy - 7);
        g.lineTo(r + sx + 6, r + sy + 5);
        g.lineTo(r + sx - 6, r + sy + 5);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }

    // Player arrow, always centred and pointing up.
    g.translate(r, r);
    g.fillStyle = COLORS.player;
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(7, 7);
    g.lineTo(0, 3);
    g.lineTo(-7, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
