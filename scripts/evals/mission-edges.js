// The first frames after Start and the end screen, on a phone: the touch controls are laid out while
// hidden and can't be hit, the share image is built after the end screen is up, the Share button waits
// for it and then shares it, and a quick Retry never builds it.
//   npm run check:browser -- --query "seed=9&debug&touch" --size 390x844 --no-final \
//     --eval-file scripts/evals/mission-edges.js              (no --start: it presses Enter itself)
// Returns `ok`, `failures` and `gapsAfterStart`; also read `logs` (expected empty).
(async () => {
  const now = () => performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const check = (ok, what) => ok || failures.push(what);
  const splash = document.getElementById('splash');
  const enter = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  const shareButton = () => document.querySelector('[data-action="share-result"]');
  const hitsTouch = (el) => {
    const r = el.getBoundingClientRect();
    return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.touch');
  };
  /** Destroys the player's car, returns once the end screen is up and how many share images were built by then. */
  const wreck = async () => {
    const g = window.game;
    const counted = { images: 0 };
    const summary = g.runSummary;
    g.runSummary = function () {
      const r = summary.call(this);
      const image = r.map.image;
      r.map.image = function (...a) {
        counted.images++;
        return image.apply(this, a);
      };
      return r;
    };
    await dbg.police(false);
    g.applyDamage(0, 1e6);
    for (let i = 0; i < 200 && !shareButton(); i++) await sleep(20);
    return counted;
  };

  // Menu: laid out, not visible, not hittable.
  const touch = document.querySelector('.touch');
  const gas = touch?.querySelector('[data-hold="gas"]');
  if (!gas) return { ok: false, failures: ['no touch controls: add &touch to the query'] };
  check(game.state === 'menu', `starts on the menu, not ${game.state}`);
  check(touch.hidden && getComputedStyle(gas).visibility === 'hidden', 'menu: controls hidden');
  check(gas.getBoundingClientRect().width > 0, 'menu: controls laid out');
  check(!hitsTouch(gas), 'menu: controls can be hit');

  // Start: shown and hittable; the frames around it.
  const gaps = [];
  let last = now();
  const tick = () => {
    gaps.push(Math.round(now() - last));
    last = now();
    if (gaps.length < 20) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  enter();
  await sleep(600);
  check(game.state === 'playing', `after Enter: ${game.state}`);
  check(!touch.hidden && getComputedStyle(gas).visibility === 'visible', 'playing: controls shown');
  check(hitsTouch(gas), 'playing: controls can\'t be hit');

  // End screen: Share waits for the image, built after the screen is up, then shares it.
  const run = await wreck();
  const button = shareButton();
  check(button?.disabled === true, 'end screen: Share should wait');
  check(run.images === 0, `end screen: ${run.images} images built with the screen`);
  check(touch.hidden && !hitsTouch(gas), 'end screen: controls can be hit');
  const waited = now();
  while (button?.disabled && now() - waited < 3000) await sleep(20);
  check(!button?.disabled, 'Share never enabled');
  const readyAfterMs = Math.round(now() - waited);
  check(readyAfterMs >= 800, `Share ready too soon: ${readyAfterMs} ms`);
  check(run.images === 1, `${run.images} images built`);
  const shared = [];
  const stub = (name, value) => Object.defineProperty(navigator, name, { value, configurable: true });
  stub('canShare', () => true);
  stub('share', async (data) => void shared.push(data));
  button?.click();
  await sleep(100);
  delete navigator.canShare;
  delete navigator.share;
  const file = shared[0]?.files?.[0];
  check(file?.type === 'image/png' && file.size > 1000, `shared ${shared.length} times, file ${file?.type} ${file?.size}`);

  // A Retry within that second: no image, and the timer is gone with the old screen.
  const old = window.game;
  document.querySelector('[data-action="retry"]').click();
  for (let i = 0; i < 200 && !(window.game !== old && splash.hidden); i++) await sleep(100);
  check(window.game !== old, 'Retry made no new game');
  if (window.game.state === 'menu') enter();
  await sleep(300);
  const quick = await wreck();
  const before = window.game;
  document.querySelector('[data-action="retry"]').click();
  await sleep(1500);
  check(quick.images === 0, `quick Retry built ${quick.images} images`);
  check(window.game !== before || !shareButton(), 'quick Retry left the end screen up');
  return { ok: failures.length === 0, failures, gapsAfterStart: gaps.slice(0, 5), maxGapAfterStart: Math.max(...gaps), shareReadyAfterMs: readyAfterMs };
})()
