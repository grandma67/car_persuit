// Full-screen overlays: start menu, pause, win/lose. Keyboard shortcuts are handled by Game.

import { fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from './fullscreen';

export interface EndScreenInfo {
  won: boolean;
  title: string;
  detail: string;
  seed: number;
  /** Win only: leaderboard lines and whether this run set a new best. */
  newBest?: boolean;
  board?: { time: string; label: string; current: boolean }[];
  /** The run traced on the city map, its legend (HTML) and a stats line. */
  run?: { map: HTMLElement; legend: string; stats: string };
  /** Share this result: the brag (the city's link is appended) and the run map as an image. */
  share?: { text: string; image: Promise<Blob | null> };
}

export type SteerMode = 'buttons' | 'tilt';

/** Phones with a tilt sensor: steer with the on-screen buttons or by turning the phone. */
export interface SteerChoice {
  mode: SteerMode;
  /** Resolves the mode in effect: tilt can fall back to buttons when the sensor is refused. */
  onChange: (mode: SteerMode) => Promise<SteerMode>;
}

export interface MenuInfo {
  seed: number;
  look: string; // style · time of day
  difficulties: { id: string; label: string; police: boolean }[];
  difficulty: string;
  best: string | null; // best time on this city at this difficulty
  steering?: SteerChoice | null;
}

export class Screens {
  private el: HTMLElement;

  constructor(parent: HTMLElement, private uiSound: (kind: 'hover' | 'click') => void = () => {}) {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    this.el.hidden = true;
    parent.appendChild(this.el);
    onFullscreenChange(() => this.syncFullscreenLabel());
  }

  /** Corner-arrows icon: pointing out to enter fullscreen, in to leave it. */
  private fullscreenIcon(): string {
    const path = isFullscreen() ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  private fullscreenLabel(): string {
    return isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
  }

  private fullscreenButton(): string {
    if (!fullscreenSupported()) return '';
    const label = this.fullscreenLabel();
    return `<button data-action="fullscreen" class="secondary icon" aria-label="${label}" title="${label}">${this.fullscreenIcon()}</button>`;
  }

  private syncFullscreenLabel(): void {
    const button = this.el.querySelector('[data-action="fullscreen"]');
    if (!button) return;
    button.innerHTML = this.fullscreenIcon();
    button.setAttribute('aria-label', this.fullscreenLabel());
    button.setAttribute('title', this.fullscreenLabel());
  }

  private show(html: string, actions: Record<string, () => void>, cardClass = ''): void {
    this.el.innerHTML = `<div class="screen-card ${cardClass}">${html}</div>`;
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

  private seedLink(seed: number): string {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    return url.toString();
  }

  /** Briefly swap a button's label, e.g. to confirm a copy. */
  private flash(action: string, text: string): void {
    const button = this.el.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (!button) return;
    const original = button.innerHTML;
    button.textContent = text;
    setTimeout(() => (button.innerHTML = original), 1600);
  }

  /** Share a link to this city: the native share sheet where there is one, else copy to the clipboard. */
  private async share(seed: number): Promise<void> {
    const link = this.seedLink(seed);
    const flash = (text: string) => this.flash('share', text);
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

  /** The steering button: shows the mode, a tap switches it. Empty without a choice to offer. */
  private steerButton(steering: SteerChoice | null | undefined, actions: Record<string, () => void>): string {
    if (!steering) return '';
    let mode = steering.mode;
    const label = () => `Steer: ${mode === 'tilt' ? 'Tilt' : 'Buttons'}`;
    actions.steer = () =>
      void steering.onChange(mode === 'tilt' ? 'buttons' : 'tilt').then((m) => {
        mode = m;
        const button = this.el.querySelector('[data-action="steer"]');
        if (button) button.textContent = label();
      });
    return `<button data-action="steer" class="secondary">${label()}</button>`;
  }

  menu(info: MenuInfo, onStart: () => void, onDifficulty: (id: string) => void): void {
    const choices = info.difficulties
      .map((d) => `<button data-action="diff-${d.id}" class="choice${d.id === info.difficulty ? ' selected' : ''}${d.police ? '' : ' practice'}">${d.label}</button>`)
      .join('');
    const actions: Record<string, () => void> = {
      start: onStart,
      share: () => void this.share(info.seed),
      fullscreen: toggleFullscreen,
    };
    for (const d of info.difficulties) actions[`diff-${d.id}`] = () => onDifficulty(d.id);
    this.show(
      `
      <h1>CAR PURSUIT</h1>
      <p class="screen-lead">Reach all destinations before the timer buzz!<br>Follow the route on the map. Don't get wrecked.</p>
      <ul class="screen-keys">
        <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</li>
        <li><kbd>Space</kbd> handbrake · <kbd>B</kbd> look back · <kbd>H</kbd> horn</li>
        <li><kbd>R</kbd> reset car</li>
        <li><kbd>P</kbd> pause · <kbd>M</kbd> mute · <kbd>F</kbd> fullscreen</li>
      </ul>
      <div class="screen-choices" role="group" aria-label="Difficulty">${choices}</div>
      <div class="screen-buttons">
        <button data-action="start">Start <kbd>Enter</kbd></button>
        <button data-action="share" class="secondary">Share this game</button>
        ${this.steerButton(info.steering, actions)}
        ${this.fullscreenButton()}
      </div>
      <p class="screen-seed">City #${info.seed} · ${info.look}${info.best ? ` · Best ${info.best}` : ''}</p>
    `,
      actions,
    );
  }

  /** `touch`: on touch screens, also offer mute and fullscreen (no M/F keys there). */
  pause(
    seed: number,
    onResume: () => void,
    onRetry: () => void,
    touch?: { muted: boolean; onMute: () => boolean; steering?: SteerChoice | null } | null,
  ): void {
    const muteLabel = (muted: boolean) => (muted ? 'Unmute' : 'Mute');
    const actions: Record<string, () => void> = { resume: onResume, retry: onRetry, share: () => void this.share(seed) };
    if (touch) {
      actions.mute = () => {
        const button = this.el.querySelector('[data-action="mute"]');
        const muted = touch.onMute();
        if (button) button.textContent = muteLabel(muted);
      };
      actions.fullscreen = toggleFullscreen;
    }
    this.show(
      `<h2>PAUSED</h2>
      <div class="screen-buttons">
        <button data-action="resume">Resume <kbd>P</kbd></button>
        <button data-action="retry" class="secondary">Retry <kbd>Enter</kbd></button>
        <button data-action="share" class="secondary">Share this game</button>
        ${touch ? `<button data-action="mute" class="secondary">${muteLabel(touch.muted)}</button>` : ''}
        ${this.steerButton(touch?.steering, actions)}
        ${touch ? this.fullscreenButton() : ''}
      </div>`,
      actions,
    );
  }

  /**
   * Share the result with the map image: the native share sheet where it takes files, else save the
   * image and copy the text. `image` is already rendered, so the share sheet opens within the click.
   */
  private async shareResult(seed: number, brag: string, image: Blob | null): Promise<void> {
    const text = `${brag} ${this.seedLink(seed)}`;
    const file = image && new File([image], `car-pursuit-${seed}.png`, { type: 'image/png' });
    if (navigator.share && (!file || navigator.canShare?.({ files: [file] }))) {
      try {
        await navigator.share(file ? { files: [file], text } : { text });
      } catch {
        // Cancelled by the user: nothing to do.
      }
      return;
    }
    if (file) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    try {
      await navigator.clipboard.writeText(text);
      this.flash('share-result', file ? 'Image saved · text copied!' : 'Copied!');
    } catch {
      window.prompt('Copy this:', text);
    }
  }

  end(info: EndScreenInfo, onRetry: () => void, onNewCity: () => void): void {
    const { run, share } = info;
    const actions: Record<string, () => void> = { retry: onRetry, new: onNewCity };
    if (share) {
      let image: Blob | null = null;
      void share.image.then((blob) => (image = blob));
      actions['share-result'] = () => void this.shareResult(info.seed, share.text, image);
    }
    this.show(
      `
      ${run ? `<div class="screen-run"><div data-slot="map"></div>${run.legend}</div><div class="screen-summary">` : ''}
      <h2 class="${info.won ? 'won' : 'lost'}">${info.title}</h2>
      ${info.newBest ? '<p class="screen-record">NEW RECORD!</p>' : ''}
      <p class="screen-lead">${info.detail}</p>
      ${run ? `<p class="screen-stats">${run.stats}</p>` : ''}
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
        ${share ? '<button data-action="share-result" class="secondary">Share this result</button>' : ''}
      </div>
      <p class="screen-seed">City #${info.seed}</p>
      ${run ? '</div>' : ''}
    `,
      actions,
      run ? 'with-run' : '',
    );
    if (run) this.el.querySelector('[data-slot="map"]')?.replaceWith(run.map);
  }
}
