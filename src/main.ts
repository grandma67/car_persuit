import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './core/Game';
import { seedFromUrl } from './core/Rng';

// Backstop for the CSS: some Android browsers still start a selection or open a menu on long-press.
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const splash = document.getElementById('splash')!;
const bar = splash.querySelector<HTMLElement>('.splash-bar-fill')!;
const status = splash.querySelector<HTMLElement>('.splash-status')!;

function stage(text: string, progress: number): Promise<void> {
  status.textContent = text;
  bar.style.width = `${progress}%`;
  // Two frames so the browser paints the update before the next blocking step.
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Fade the splash out. After a reload (Retry / New city) skip the "press any key" step. */
function dismissSplash(game: Game): void {
  const done = () => {
    splash.classList.add('done');
    window.setTimeout(() => splash.remove(), 700);
  };
  let seenBefore = false;
  try {
    seenBefore = sessionStorage.getItem('cp-splash-seen') === '1';
    sessionStorage.setItem('cp-splash-seen', '1');
  } catch {
    // Storage unavailable (private mode etc.): just show the prompt.
  }
  if (seenBefore || new URLSearchParams(window.location.search).has('debug')) {
    done();
    return;
  }
  status.hidden = true;
  splash.querySelector<HTMLElement>('.splash-continue')!.hidden = false;
  const go = (e: Event) => {
    // This key only dismisses the splash; don't let it also press Start on the menu.
    e.stopPropagation();
    window.removeEventListener('keydown', go, true);
    window.removeEventListener('pointerdown', go, true);
    game.audioUnlocked(); // a key/click is the gesture browsers need before playing sound
    done();
  };
  window.addEventListener('keydown', go, true);
  window.addEventListener('pointerdown', go, true);
}

async function start(): Promise<void> {
  const seed = seedFromUrl();
  await stage('Starting physics engine', 25);
  await RAPIER.init();
  await stage(`Building city #${seed}`, 55);
  const game = new Game(document.getElementById('app')!, document.getElementById('hud')!, seed);
  await stage('Placing street furniture', 90);
  game.start();
  await stage('Ready', 100);
  dismissSplash(game);
}

start().catch((err) => {
  status.textContent = `Failed to start: ${err}`;
  console.error(err);
});
