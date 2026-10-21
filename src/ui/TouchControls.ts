// On-screen controls for touch devices: steering on the left, pedals and handbrake on the right,
// pause/reset at the top. Each button is held independently, so multi-touch works naturally.
import type { TouchDrive } from '../core/Input';

export function isTouchDevice(): boolean {
  return (
    new URLSearchParams(window.location.search).has('touch') ||
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window
  );
}

export class TouchControls {
  private el: HTMLElement;
  readonly state: TouchDrive = { left: false, right: false, gas: false, brake: false, handbrake: false };

  constructor(parent: HTMLElement, actions: { pause: () => void; reset: () => void }) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="touch-steer">
        <button data-hold="left" aria-label="Steer left">◀</button>
        <button data-hold="right" aria-label="Steer right">▶</button>
      </div>
      <div class="touch-pedals">
        <button data-hold="handbrake" class="touch-small" aria-label="Handbrake">HB</button>
        <button data-hold="brake" class="touch-brake" aria-label="Brake / reverse">BRAKE/<br>REVERSE</button>
        <button data-hold="gas" class="touch-gas" aria-label="Gas">GAS</button>
      </div>
      <div class="touch-top">
        <button data-tap="reset" aria-label="Reset car">⟲</button>
        <button data-tap="pause" aria-label="Pause">II</button>
      </div>
    `;
    parent.appendChild(this.el);

    for (const button of this.el.querySelectorAll<HTMLElement>('[data-hold]')) {
      const key = button.dataset.hold as keyof TouchDrive;
      const set = (on: boolean) => (e: PointerEvent) => {
        e.preventDefault();
        this.state[key] = on;
        button.classList.toggle('active', on);
        if (on) button.setPointerCapture(e.pointerId);
      };
      button.addEventListener('pointerdown', set(true));
      button.addEventListener('pointerup', set(false));
      button.addEventListener('pointercancel', set(false));
      button.addEventListener('lostpointercapture', () => {
        this.state[key] = false;
        button.classList.remove('active');
      });
      button.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    for (const button of this.el.querySelectorAll<HTMLElement>('[data-tap]')) {
      const action = button.dataset.tap as 'pause' | 'reset';
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        actions[action]();
      });
    }
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (!visible) for (const k of Object.keys(this.state) as (keyof TouchDrive)[]) this.state[k] = false;
  }
}
