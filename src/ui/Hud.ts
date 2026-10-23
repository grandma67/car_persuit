// DOM overlay HUD. Wanted stars join in M5.
import { TIMER_WARNING } from '../gameplay/balance';

export interface MissionHudState {
  index: number; // 0-based current destination
  total: number;
  timeLeft: number; // seconds
  distance: number | null; // metres by road, null when no active target
  health: number; // 0..1
  stars: number; // wanted level 1..5
  starProgress: number; // 0..1 toward the next star
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
  private starEls: HTMLElement[];
  private starProgressEl: HTMLElement;
  private starsWrap: HTMLElement;
  private wantedEl: HTMLElement;
  private toastTimer = 0;
  private flash = 0;
  private fpsEl: HTMLElement;
  private fpsFrames = 0;
  private fpsSince = 0; // performance.now() when the current FPS sample started

  constructor(root: HTMLElement, minimap: HTMLCanvasElement) {
    root.innerHTML = `
      <div class="hud-damage"></div>
      <div class="hud-timer">10:00</div>
      <div class="hud-wanted" aria-label="Wanted level">
        <div class="hud-stars">${'<span>★</span>'.repeat(5)}</div>
        <div class="hud-star-progress"><div></div></div>
      </div>
      <div class="hud-mission">
        <div class="hud-dest"></div>
        <div class="hud-dist"></div>
      </div>
      <div class="hud-topright">
        <div class="hud-minimap-slot"></div>
        <div class="hud-health-row">
          <svg class="hud-health-icon" viewBox="0 0 24 24" aria-label="Health">
            <path d="M12 21s-7.5-4.6-10-9.3C.3 8.4 2.1 4.5 5.8 4.1c2.3-.3 4.2.9 6.2 3.2 2-2.3 3.9-3.5 6.2-3.2 3.7.4 5.5 4.3 3.8 7.6C19.5 16.4 12 21 12 21z"/>
          </svg>
          <div class="hud-health"><div class="hud-health-fill"></div></div>
        </div>
        <div class="hud-muted" hidden>🔇 Muted</div>
      </div>
      <div class="hud-fps" hidden></div>
      <div class="hud-toast"></div>
      <div class="hud-speed"><span id="hud-speed-value">0</span><small>km/h</small></div>
      <div class="hud-help">W/↑ drive · S/↓ brake/reverse · A/D steer · Space handbrake · B look back · H horn · R reset · P pause · M mute · F fullscreen</div>
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
    this.wantedEl = root.querySelector('.hud-wanted')!;
    this.starsWrap = root.querySelector('.hud-stars')!;
    this.starEls = Array.from(root.querySelectorAll('.hud-stars span'));
    this.starProgressEl = root.querySelector('.hud-star-progress div')!;
    this.fpsEl = root.querySelector('.hud-fps')!;
  }

  /** ?debug only: frames per second, averaged over half a second. */
  showFps(): void {
    this.fpsEl.hidden = false;
    this.fpsSince = performance.now();
  }

  setMuted(muted: boolean): void {
    this.muteEl.hidden = !muted;
  }

  /** Show or hide the wanted stars (hidden with no police: there's no wanted level to show). */
  setWantedVisible(visible: boolean): void {
    this.wantedEl.hidden = !visible;
  }

  update(dt: number, speedMs: number, mission: MissionHudState): void {
    this.speedEl.textContent = Math.round(Math.abs(speedMs) * 3.6).toString();
    this.timerEl.textContent = formatTime(mission.timeLeft);
    this.timerEl.classList.toggle('warning', mission.timeLeft <= TIMER_WARNING);
    const n = Math.min(mission.index + 1, mission.total);
    this.destEl.textContent = n === mission.total ? `FINAL DESTINATION ${n}/${mission.total}` : `DESTINATION ${n}/${mission.total}`;
    this.destEl.classList.toggle('final', n === mission.total);
    this.distEl.textContent = mission.distance === null ? '' : `${Math.round(mission.distance)} m`;

    // Health bar pulses when critical.
    const h = Math.max(0, Math.min(1, mission.health));
    this.healthFill.style.width = `${h * 100}%`;
    this.healthFill.classList.toggle('critical', h > 0 && h <= 0.2);

    this.starEls.forEach((el, i) => el.classList.toggle('on', i < mission.stars));
    this.starProgressEl.style.width = `${mission.stars >= 5 ? 100 : mission.starProgress * 100}%`;

    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.damageEl.style.opacity = String(this.flash);

    if (!this.fpsEl.hidden) {
      this.fpsFrames++;
      const now = performance.now();
      if (now - this.fpsSince >= 500) {
        this.fpsEl.textContent = `${Math.round((this.fpsFrames * 1000) / (now - this.fpsSince))} FPS`;
        this.fpsFrames = 0;
        this.fpsSince = now;
      }
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
  }

  /** Pulse the stars when the wanted level rises. */
  flashStars(): void {
    this.starsWrap.classList.remove('flash');
    void this.starsWrap.offsetWidth; // restart the animation
    this.starsWrap.classList.add('flash');
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
