// DOM overlay HUD. Stars and health join in M5.
import { TIMER_WARNING } from '../gameplay/balance';

export interface MissionHudState {
  index: number; // 0-based current destination
  total: number;
  timeLeft: number; // seconds
  distance: number | null; // metres by road, null when no active target
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
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-timer">10:00</div>
      <div class="hud-mission">
        <div class="hud-dest"></div>
        <div class="hud-dist"></div>
      </div>
      <div class="hud-toast"></div>
      <div class="hud-speed"><span id="hud-speed-value">0</span><small>km/h</small></div>
      <div class="hud-help">W/↑ drive · S/↓ brake/reverse · A/D steer · Space handbrake · R reset · P pause · M mute</div>
      <div class="hud-muted" hidden>🔇 Muted</div>
    `;
    this.speedEl = root.querySelector('#hud-speed-value')!;
    this.muteEl = root.querySelector('.hud-muted')!;
    this.timerEl = root.querySelector('.hud-timer')!;
    this.destEl = root.querySelector('.hud-dest')!;
    this.distEl = root.querySelector('.hud-dist')!;
    this.toastEl = root.querySelector('.hud-toast')!;
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

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
  }

  toast(text: string, seconds = 2): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTimer = seconds;
  }
}
