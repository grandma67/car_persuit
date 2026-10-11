// Full-screen overlays: start menu, pause, win/lose. Keyboard shortcuts are handled by Game.

export interface EndScreenInfo {
  won: boolean;
  title: string;
  detail: string;
  seed: number;
  /** Win only: leaderboard lines and whether this run set a new best. */
  newBest?: boolean;
  board?: { time: string; label: string; current: boolean }[];
}

export interface MenuInfo {
  seed: number;
  look: string; // style · time of day
  difficulties: { id: string; label: string }[];
  difficulty: string;
  best: string | null; // best time on this city at this difficulty
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

  /** Share a link to this city: the native share sheet where there is one, else copy to the clipboard. */
  private async share(seed: number): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    const link = url.toString();
    const button = this.el.querySelector<HTMLButtonElement>('[data-action="share"]');
    const flash = (text: string) => {
      if (!button) return;
      const original = button.innerHTML;
      button.textContent = text;
      setTimeout(() => (button.innerHTML = original), 1600);
    };
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Car Pursuit', text: `Can you beat city #${seed} in Car Pursuit?`, url: link });
      } catch {
        // Cancelled by the user: nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      flash('Link copied!');
    } catch {
      window.prompt('Copy this link:', link);
    }
  }

  menu(info: MenuInfo, onStart: () => void, onDifficulty: (id: string) => void): void {
    const choices = info.difficulties
      .map((d) => `<button data-action="diff-${d.id}" class="choice${d.id === info.difficulty ? ' selected' : ''}">${d.label}</button>`)
      .join('');
    const actions: Record<string, () => void> = { start: onStart, share: () => void this.share(info.seed) };
    for (const d of info.difficulties) actions[`diff-${d.id}`] = () => onDifficulty(d.id);
    this.show(
      `
      <h1>CAR PURSUIT</h1>
      <p class="screen-lead">Reach all destinations before the timer buzz!<br>Follow the route on the map. Don't get wrecked.</p>
      <ul class="screen-keys">
        <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</li>
        <li><kbd>Space</kbd> handbrake</li>
        <li><kbd>R</kbd> reset car</li>
        <li><kbd>P</kbd> pause · <kbd>M</kbd> mute · <kbd>F</kbd> fullscreen</li>
      </ul>
      <div class="screen-choices" role="group" aria-label="Difficulty">${choices}</div>
      <div class="screen-buttons">
        <button data-action="start">Start <kbd>Enter</kbd></button>
        <button data-action="share" class="secondary">Share this game</button>
      </div>
      <p class="screen-seed">City #${info.seed} · ${info.look}${info.best ? ` · Best ${info.best}` : ''}</p>
    `,
      actions,
    );
  }

  pause(seed: number, onResume: () => void, onRetry: () => void): void {
    this.show(
      `<h2>PAUSED</h2>
      <div class="screen-buttons">
        <button data-action="resume">Resume <kbd>P</kbd></button>
        <button data-action="retry" class="secondary">Retry <kbd>Enter</kbd></button>
        <button data-action="share" class="secondary">Share this game</button>
      </div>`,
      { resume: onResume, retry: onRetry, share: () => void this.share(seed) },
    );
  }

  end(info: EndScreenInfo, onRetry: () => void, onNewCity: () => void): void {
    this.show(
      `
      <h2 class="${info.won ? 'won' : 'lost'}">${info.title}</h2>
      ${info.newBest ? '<p class="screen-record">NEW RECORD!</p>' : ''}
      <p class="screen-lead">${info.detail}</p>
      ${
        info.board?.length
          ? `<ol class="screen-board">${info.board
              .map((r) => `<li class="${r.current ? 'current' : ''}"><span>${r.time}</span><span>${r.label}</span></li>`)
              .join('')}</ol>`
          : ''
      }
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
