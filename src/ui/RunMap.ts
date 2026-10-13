// The end-screen map: the whole city with the route the player drove (coloured by speed), the
// destinations, and an icon for everything that happened. Hover or tap an icon for what and when.
import type { Incident, IncidentKind, RunLog } from '../gameplay/RunLog';
import { formatTime } from './Hud';
import { BASE_SCALE, type Minimap } from './Minimap';

const SIZE = 840; // canvas pixels (drawn at 2× its largest on-screen size)
const MARGIN = 25; // metres of sea around the island in view
const HIT_RADIUS = 14; // CSS px: how near the pointer must be to an icon for its tooltip

export const INCIDENT_STYLE: Record<IncidentKind, { icon: string; label: string; order: number }> = {
  stars: { icon: '⭐', label: 'Heat up', order: 0 },
  civilian: { icon: '🚗', label: 'Civilians hit', order: 1 },
  wall: { icon: '💥', label: 'Wall hits', order: 2 },
  rammed: { icon: '🚓', label: 'Rammed by cops', order: 3 },
  whack: { icon: '👊', label: 'Cops rammed', order: 4 },
  copWrecked: { icon: '🔥', label: 'Cops wrecked', order: 5 },
  checkpoint: { icon: '🏁', label: 'Destinations', order: 6 },
  timeout: { icon: '⏱️', label: "Time's up", order: 7 },
  wrecked: { icon: '💀', label: 'Wrecked', order: 7 },
  drowned: { icon: '🌊', label: 'Drowned', order: 7 },
};

/** Speed → route colour: blue when crawling, through green and yellow, to red flat out. */
function speedColor(ratio: number): string {
  return `hsl(${Math.round(220 * (1 - Math.min(1, Math.max(0, ratio))))} 95% 55%)`;
}

export interface RunMapInfo {
  log: RunLog;
  destinations: { x: number; z: number }[];
  reached: number; // destinations reached
  maxSpeed: number; // m/s, for the route colours
}

export class RunMap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private ox: number; // base-canvas pixel at the map's top-left corner
  private oy: number;
  private scale: number; // canvas pixels per base-canvas pixel
  private spots: { x: number; y: number; incident: Incident }[] = []; // canvas pixels

  constructor(
    private minimap: Minimap,
    private info: RunMapInfo,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'run-map';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.tip = document.createElement('div');
    this.tip.className = 'run-map-tip';
    this.tip.hidden = true;
    this.el.append(this.canvas, this.tip);

    // Frame the island, widened if the run strayed off it (into the sea).
    let half = minimap.city.islandSize / 2 + MARGIN;
    for (const p of info.log.track) half = Math.max(half, Math.abs(p.x) + MARGIN, Math.abs(p.z) + MARGIN);
    half = Math.min(half, minimap.half);
    const [cx, cy] = minimap.toMap(0, 0);
    this.ox = cx - half * BASE_SCALE;
    this.oy = cy - half * BASE_SCALE;
    this.scale = SIZE / (half * 2 * BASE_SCALE);
    this.draw();

    const onPointer = (e: PointerEvent) => this.showTip(e);
    this.canvas.addEventListener('pointermove', onPointer);
    this.canvas.addEventListener('pointerdown', onPointer);
    this.canvas.addEventListener('pointerleave', () => (this.tip.hidden = true));
  }

  private at(x: number, z: number): [number, number] {
    const [mx, my] = this.minimap.toMap(x, z);
    return [(mx - this.ox) * this.scale, (my - this.oy) * this.scale];
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    const { log, destinations, reached, maxSpeed } = this.info;
    const span = SIZE / this.scale;
    g.drawImage(this.minimap.base, this.ox, this.oy, span, span, 0, 0, SIZE, SIZE);
    g.fillStyle = 'rgb(0 0 0 / 0.25)'; // dim the city so the route stands out
    g.fillRect(0, 0, SIZE, SIZE);

    // The route: a dark casing, then each stretch coloured by how fast it was driven.
    const track = log.track.map((p) => ({ p, at: this.at(p.x, p.z) }));
    g.lineJoin = g.lineCap = 'round';
    if (track.length > 1) {
      g.strokeStyle = 'rgb(0 0 0 / 0.7)';
      g.lineWidth = 9;
      g.beginPath();
      for (const { p, at } of track) (p.jump ? g.moveTo : g.lineTo).call(g, ...at);
      g.stroke();
      g.lineWidth = 5;
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1];
        const b = track[i];
        if (b.p.jump) continue;
        g.strokeStyle = speedColor((a.p.speed + b.p.speed) / 2 / maxSpeed);
        g.beginPath();
        g.moveTo(...a.at);
        g.lineTo(...b.at);
        g.stroke();
      }
    }
    if (track.length) this.disc(...track[0].at, 13, '#ffffff', 'S', '#000');

    // Destinations: solid once reached, faint where the run never got.
    destinations.forEach((d, i) => {
      const final = i === destinations.length - 1;
      const color = final ? '#4dff88' : '#ffb020';
      g.globalAlpha = i < reached ? 1 : 0.45;
      this.disc(...this.at(d.x, d.z), 21, color, String(i + 1), '#000');
      g.globalAlpha = 1;
    });

    // Incidents: least interesting first, so the big moments sit on top.
    const incidents = [...log.incidents].sort((a, b) => INCIDENT_STYLE[a.kind].order - INCIDENT_STYLE[b.kind].order);
    this.spots = [];
    for (const incident of incidents) {
      const [x, y] = this.at(incident.x, incident.z);
      this.spots.push({ x, y, incident });
      if (incident.kind === 'checkpoint') continue; // drawn as its destination
      const end = INCIDENT_STYLE[incident.kind].order === 7;
      const r = end ? 28 : incident.kind === 'stars' ? 14 : 19;
      this.disc(x, y, r, end ? '#ff4d4d' : 'rgb(10 12 18 / 0.85)');
      g.font = `${Math.round(r * 1.25)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(INCIDENT_STYLE[incident.kind].icon, x, y + r * 0.08);
    }
  }

  private disc(x: number, y: number, r: number, fill: string, label?: string, labelColor = '#fff'): void {
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = fill;
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (!label) return;
    g.fillStyle = labelColor;
    g.font = `900 ${Math.round(r * 1.2)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x, y + 1);
  }

  /** The tooltip for the icon under the pointer, if any. Later spots are drawn on top, so win ties. */
  private showTip(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const k = SIZE / rect.width;
    const px = (e.clientX - rect.left) * k;
    const py = (e.clientY - rect.top) * k;
    let best: { x: number; y: number; incident: Incident } | null = null;
    let bestDist = HIT_RADIUS * k;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - px, s.y - py);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    if (!best) {
      this.tip.hidden = true;
      return;
    }
    const { incident } = best;
    this.tip.textContent = `${INCIDENT_STYLE[incident.kind].icon} ${formatTime(incident.t)} · ${incident.detail}`;
    this.tip.hidden = false;
    this.tip.style.left = `${(best.x / SIZE) * 100}%`;
    this.tip.style.top = `${(best.y / SIZE) * 100}%`;
    this.tip.classList.toggle('below', best.y < SIZE * 0.15);
  }

  /** Legend chips: an icon and a count for each kind of incident that happened, then the speed key. */
  legend(): string {
    const counts = new Map<IncidentKind, number>();
    for (const i of this.info.log.incidents) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
    const chips = [...counts]
      .filter(([kind]) => kind !== 'checkpoint' && INCIDENT_STYLE[kind].order !== 7)
      .sort(([a], [b]) => INCIDENT_STYLE[b].order - INCIDENT_STYLE[a].order)
      .map(([kind, n]) => `<span class="run-chip">${INCIDENT_STYLE[kind].icon} ${n} <small>${INCIDENT_STYLE[kind].label}</small></span>`)
      .join('');
    return `<div class="run-legend">${chips || '<span class="run-chip"><small>A clean run: not a scratch</small></span>'}</div>`;
  }
}
