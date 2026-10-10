import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './core/Game';
import { seedFromUrl } from './core/Rng';

async function start(): Promise<void> {
  await RAPIER.init();
  const game = new Game(document.getElementById('app')!, document.getElementById('hud')!, seedFromUrl());
  game.start();
}

start().catch((err) => {
  document.getElementById('hud')!.textContent = `Failed to start: ${err}`;
  console.error(err);
});
