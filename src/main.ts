import RAPIER from '@dimforge/rapier3d-compat';
import { CarAudio } from './audio/CarAudio';
import { Game, createRenderer, type GameShell } from './core/Game';
import { debugTools } from './core/debugTools';
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
  bar.style.transform = `translateX(${progress - 100}%)`;
  // Wanted level climbs with the loading bar: five stars when ready.
  const lit = Math.floor((progress / 100) * stars.children.length);
  [...stars.children].forEach((star, i) => star.classList.toggle('on', i < lit));
  stars.classList.toggle('full', lit === stars.children.length);
  // Two frames so the browser paints the update before the next blocking step.
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

let hideTimer = 0;

/** Fade the splash out, then take it out of layout (its animations stop) until the next city. */
function hideSplash(): void {
  splash.classList.add('done');
  hideTimer = window.setTimeout(() => (splash.hidden = true), 700);
}

/** The splash again while Retry / New city builds the next city, at the start of its bar. */
function showSplash(): void {
  window.clearTimeout(hideTimer);
  splash.hidden = false;
  splash.classList.remove('done');
  status.hidden = false;
  bar.style.transform = 'translateX(-100%)';
  [...stars.children].forEach((star) => star.classList.remove('on'));
  stars.classList.remove('full');
}

/** Fade the splash out. After a reload (Retry / New city) skip the "press any key" step. */
function dismissSplash(game: Game): void {
  const done = hideSplash;
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

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
let game: Game | null = null;
let restarting = false;

// Retry and New city build the next Game in this page rather than reloading it: a reload leaves
// fullscreen, and the browser won't go back in without a fresh tap. Renderer and audio carry over.
const shell: GameShell = {
  renderer: createRenderer(app),
  audio: new CarAudio(),
  restart: (seed) => {
    if (restarting) return;
    restarting = true;
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    history.replaceState(history.state, '', url); // share links and a reload keep this city
    game?.dispose();
    game = null;
    showSplash();
    build(seed)
      .then((next) => {
        game = next;
        next.audioUnlocked(); // the tap on Retry was the gesture: the menu loop plays as on first start
        hideSplash();
      })
      .catch(failed)
      .finally(() => (restarting = false));
  },
};

async function build(seed: number): Promise<Game> {
  await stage(`Building city #${seed}`, 55);
  const next = new Game(app, hud, seed, shell);
  // For browser checks: the game's renderer and city, and helpers to frame and measure (debugTools).
  if (new URLSearchParams(window.location.search).has('debug')) Object.assign(window, { game: next, dbg: debugTools(next) });
  await stage('Placing street furniture', 90);
  next.start();
  // After start(): the stage's two frames render the scene first, settling its lights.
  await stage('Warming up the engine', 95);
  await next.prewarmShaders();
  await stage('Ready', 100);
  return next;
}

async function start(): Promise<void> {
  const seed = seedFromUrl();
  // GPU leak hunting: window.gpuTrace names what the renderer still holds (see BROWSER_CHECKS.md).
  if (new URLSearchParams(window.location.search).has('gputrace')) (await import('./core/gpuTrace')).installGpuTrace();
  await stage('Starting physics engine', 25);
  await RAPIER.init();
  game = await build(seed);
  dismissSplash(game);
}

function failed(err: unknown): void {
  status.textContent = `Failed to start: ${err}`;
  console.error(err);
}

start().catch(failed);
