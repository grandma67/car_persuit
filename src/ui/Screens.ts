// Full-screen overlays: start menu, pause, win/lose. Keyboard shortcuts are handled by Game.

export interface EndScreenInfo {
  won: boolean;
  title: string;
  detail: string;
  seed: number;
}

export class Screens {
  private el: HTMLElement;

  constructor(parent: HTMLElement, private uiSound: (kind: 'hover' | 'click') => void = () => {}) {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  private show(html: string, actions: Record<string, () => void>): void {
    this.el.innerHTML = `<div class="screen-card">${html}</div>`;
    this.el.hidden = false;
    for (const [action, fn] of Object.entries(actions)) {
      const button = this.el.querySelector(`[data-action="${action}"]`);
      button?.addEventListener('mouseenter', () => this.uiSound('hover'));
      button?.addEventListener('click', () => {
        this.uiSound('click');
        fn();
      });
    }
  }

  hide(): void {
    this.el.hidden = true;
  }

  menu(seed: number, look: string, onStart: () => void): void {
    this.show(
      `
      <h1>CAR PURSUIT</h1>
      <p class="screen-lead">Reach all 5 destinations in under 10 minutes.<br>Follow the route on the map. Don't get wrecked.</p>
      <ul class="screen-keys">
        <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</li>
        <li><kbd>Space</kbd> handbrake</li>
        <li><kbd>R</kbd> reset car</li>
        <li><kbd>P</kbd> pause · <kbd>M</kbd> mute</li>
      </ul>
      <button data-action="start">Start <kbd>Enter</kbd></button>
      <p class="screen-seed">City #${seed} · ${look}</p>
    `,
      { start: onStart },
    );
  }

  pause(onResume: () => void): void {
    this.show(`<h2>PAUSED</h2><button data-action="resume">Resume <kbd>P</kbd></button>`, { resume: onResume });
  }

  end(info: EndScreenInfo, onRetry: () => void, onNewCity: () => void): void {
    this.show(
      `
      <h2 class="${info.won ? 'won' : 'lost'}">${info.title}</h2>
      <p class="screen-lead">${info.detail}</p>
      <div class="screen-buttons">
        <button data-action="retry">Retry city <kbd>Enter</kbd></button>
        <button data-action="new" class="secondary">New city <kbd>N</kbd></button>
      </div>
      <p class="screen-seed">City #${info.seed}</p>
    `,
      { retry: onRetry, new: onNewCity },
    );
  }
}
