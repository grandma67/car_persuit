// DOM overlay HUD. Grows timer/stars/health/destination widgets in M3+.
export class Hud {
  private speedEl: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-speed"><span id="hud-speed-value">0</span><small>km/h</small></div>
      <div class="hud-help">W/↑ drive · S/↓ brake/reverse · A/D steer · Space handbrake · R reset</div>
    `;
    this.speedEl = root.querySelector('#hud-speed-value')!;
  }

  update(speedMs: number): void {
    this.speedEl.textContent = Math.round(Math.abs(speedMs) * 3.6).toString();
  }
}
