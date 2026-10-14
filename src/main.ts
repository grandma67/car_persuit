import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './core/Game';
import { seedFromUrl } from './core/Rng';
import { isTouchDevice } from './ui/TouchControls';

// Backstop for the CSS: some Android browsers still start a selection or open a menu on long-press.
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Service worker makes the game installable as an app and playable offline. Production only:
// in dev it would cache Vite's unhashed modules and serve stale code.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

const splash = document.getElementById('splash')!;
const bar = splash.querySelector<HTMLElement>('.splash-bar-fill')!;
const status = splash.querySelector<HTMLElement>('.splash-status')!;
const stars = splash.querySelector<HTMLElement>('.splash-stars')!;

function stage(text: string, progress: number): Promise<void> {
  status.textContent = text;
  bar.style.width = `${progress}%`;
  // Wanted level climbs with the loading bar: five stars when ready.
  const lit = Math.floor((progress / 100) * stars.children.length);
  [...stars.children].forEach((star, i) => star.classList.toggle('on', i < lit));
  stars.classList.toggle('full', lit === stars.children.length);
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
  const prompt = splash.querySelector<HTMLElement>('.splash-continue')!;
  if (isTouchDevice()) prompt.textContent = 'Tap to continue';
  prompt.hidden = false;
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
  // After start(): the stage's two frames render the scene first, settling its lights.
  await stage('Warming up the engine', 95);
  await game.prewarmShaders();
  await stage('Ready', 100);
  dismissSplash(game);
}

start().catch((err) => {
  status.textContent = `Failed to start: ${err}`;
  console.error(err);
});
