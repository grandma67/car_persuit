// DOM overlay HUD. Wanted stars join in M5.
import { TIMER_WARNING } from '../gameplay/balance';

export interface MissionHudState {
  index: number; // 0-based current destination
  total: number;
  timeLeft: number; // seconds
  distance: number | null; // metres by road, null when no active target
  health: number; // 0..1
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private speedEl: HTMLElement;
  private muteEl: HTMLElement;
  private timerEl: HTMLElement;
  private destEl: HTMLElement;
  private distEl: HTMLElement;
  private toastEl: HTMLElement;
  private healthFill: HTMLElement;
  private damageEl: HTMLElement;
  private toastTimer = 0;
  private flash = 0;

  constructor(root: HTMLElement, minimap: HTMLCanvasElement) {
    root.innerHTML = `
      <div class="hud-damage"></div>
      <div class="hud-timer">10:00</div>
      <div class="hud-mission">
        <div class="hud-dest"></div>
        <div class="hud-dist"></div>
      </div>
      <div class="hud-topright">
        <div class="hud-minimap-slot"></div>
        <div class="hud-health"><div class="hud-health-fill"></div></div>
        <div class="hud-muted" hidden>🔇 Muted</div>
      </div>
      <div class="hud-toast"></div>
      <div class="hud-speed"><span id="hud-speed-value">0</span><small>km/h</small></div>
      <div class="hud-help">W/↑ drive · S/↓ brake/reverse · A/D steer · Space handbrake · R reset · P pause · M mute</div>
    `;
    root.querySelector('.hud-minimap-slot')!.appendChild(minimap);
    this.speedEl = root.querySelector('#hud-speed-value')!;
    this.muteEl = root.querySelector('.hud-muted')!;
    this.timerEl = root.querySelector('.hud-timer')!;
    this.destEl = root.querySelector('.hud-dest')!;
    this.distEl = root.querySelector('.hud-dist')!;
    this.toastEl = root.querySelector('.hud-toast')!;
    this.healthFill = root.querySelector('.hud-health-fill')!;
    this.damageEl = root.querySelector('.hud-damage')!;
  }

  setMuted(muted: boolean): void {
    this.muteEl.hidden = !muted;
  }

  update(dt: number, speedMs: number, mission: MissionHudState): void {
    this.speedEl.textContent = Math.round(Math.abs(speedMs) * 3.6).toString();
    this.timerEl.textContent = formatTime(mission.timeLeft);
    this.timerEl.classList.toggle('warning', mission.timeLeft <= TIMER_WARNING);
    const n = Math.min(mission.index + 1, mission.total);
    this.destEl.textContent = n === mission.total ? `FINAL DESTINATION ${n}/${mission.total}` : `DESTINATION ${n}/${mission.total}`;
    this.destEl.classList.toggle('final', n === mission.total);
    this.distEl.textContent = mission.distance === null ? '' : `${Math.round(mission.distance)} m`;

    // Health: green → amber → red, flashing when critical.
    const h = Math.max(0, Math.min(1, mission.health));
    this.healthFill.style.width = `${h * 100}%`;
    this.healthFill.style.background = h > 0.5 ? '#4dd96b' : h > 0.2 ? '#ffb020' : '#ff3b30';
    this.healthFill.classList.toggle('critical', h > 0 && h <= 0.2);

    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.damageEl.style.opacity = String(this.flash);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
  }

  /** Red screen-edge flash; strength 0..1. */
  flashDamage(strength: number): void {
    this.flash = Math.min(1, Math.max(this.flash, 0.35 + strength));
  }

  toast(text: string, seconds = 2): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTimer = seconds;
  }
}
