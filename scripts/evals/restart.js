// In-place restart check (Retry / New city build the next Game in the page, see PLAN_GAME.md Tech):
//   npm run check:restart   (10 quick restarts, GPU trace on, on a city made from words with every
//                            district, Chinatown's festival, the Farm's harvest, night and rain:
//                            `--make "…"` loads it with dbg.loadCity, and the quick restarts reload it)
//   npm run check:browser -- --query "seed=N&debug&gputrace&restarts=10&shots=1" [--city f | --make "words"] \
//     --start 1500 --out-dir <dir> --no-final --eval-file scripts/evals/restart.js
// Needs ?debug (window.game, dbg); ?gputrace adds the leak list. Returns `ok` and `failures` first.
// (1) Fullscreen is entered once (`busy` ms of 5★ chase, default 8000, before the first two end screens) (the eval runs as a user gesture), then Retry, New city, Retry, New
// city are clicked on the end screen (time's up via debug Y), each new mission started with Enter.
// After each: still fullscreen, the seed kept (Retry) or changed (New city) and in the URL, the splash
// hidden with no animation left running on it, one WebGL canvas, one .screen, at most one .touch, menu state.
// (2) `restarts` quick same-city restarts: the loaded params again if the run started from a file
// (New city in (1) dropped them), then Retry. Per restart heap MB after gc(), geometries, textures,
// programs. Same city, so GPU counts must hold (±2 geometries: props) and heap must not climb
// (> 1.5 MB per restart from the 2nd on fails). Every old Game must be collected (an eval holding one
// in a loop variable keeps it alive: restart only through `next`). With ?gputrace, `orphans` names what the
// renderer holds that nothing draws: only MeshDepthMaterial and DFG_LUT (three's own) belong there.
(async () => {
  const params = new URLSearchParams(location.search);
  const quick = Number(params.get('restarts') ?? 10);
  const takeShots = params.has('shots');
  const busy = Number(params.get('busy') ?? 8000); // ms of 5★ chase before the first two end screens; 0 skips
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const splash = document.getElementById('splash');
  const failures = [];
  const fail = (what) => failures.push(what);
  const key = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  };
  const collect = () => (gc(), gc());
  const refs = [];
  /**
   * Restart through `trigger`, then wait until main.ts has swapped in the next Game and faded the
   * splash out. The old Game is only held here (and weakly in `refs`), so it's free once this returns.
   */
  const next = async (trigger) => {
    const old = window.game;
    refs.push(new WeakRef(old));
    trigger(old);
    for (let i = 0; i < 600; i++) {
      if (window.game !== old && splash.hidden) return true;
      await sleep(100);
    }
    return false;
  };
  const page = () => ({
    seed: game.city.seed,
    urlSeed: Number(new URLSearchParams(location.search).get('seed')),
    fullscreen: !!document.fullscreenElement,
    splashAnimations: document.getAnimations().filter((a) => a.effect?.target?.closest?.('#splash')).length,
    canvases: document.querySelectorAll('#app canvas').length, // the WebGL canvas
    screens: document.querySelectorAll('.screen').length,
    touch: document.querySelectorAll('.touch').length,
    state: game.state,
  });
  const gpu = () => {
    const r = game.renderer.info;
    collect();
    return { heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs.length };
  };

  const file = game.loaded ? dbg.dumpCity(false) : null; // the params the run was started from, as text
  // A material on both an instanced and a plain mesh rebuilds its program key every frame (garbage).
  const mixed = () => { for (const m of dbg.mixedMaterials()) fail(`mixed material: ${m}`); };
  mixed();
  const fsError = await document.documentElement.requestFullscreen().then(() => null, (e) => String(e));
  if (fsError) fail(`could not enter fullscreen: ${fsError}`);
  await sleep(300);

  // (1) Through the end screen's buttons.
  const steps = [];
  const busyRuns = [];
  for (const action of ['retry', 'new', 'retry', 'new']) {
    const before = game.city.seed;
    // The first two runs get busy first, so what only mid-run events make (cops spawning, scratches,
    // broken props, crashes, festival fireworks) is in the game being disposed: a 5★ chase flat out.
    if (busy && steps.length < 2) {
      await dbg.stars(5);
      await dbg.hold('KeyW', busy);
      const busyRun = { cops: game.director.cops.length, speed: Math.round(dbg.car().speed), wanted: game.wanted.stars };
      busyRuns.push(busyRun);
      if (busyRuns.length === 1) mixed();
      if (!busyRun.cops) fail(`busy run ${busyRuns.length}: no cops spawned`);
    }
    key('KeyY'); // debug: 3 s left on the clock
    let button = null;
    for (let i = 0; i < 100 && !(button = document.querySelector(`[data-action="${action}"]`)); i++) await sleep(100);
    if (!button) {
      fail(`${action}: no end screen button`);
      break;
    }
    if (takeShots) await shot(`end-${steps.length}`);
    if (!(await next(() => button.click()))) {
      fail(`${action}: next city never came up`);
      break;
    }
    await sleep(500);
    const s = { action, ...page() };
    steps.push(s);
    const at = `${action} #${steps.length}`;
    if (!fsError && !s.fullscreen) fail(`${at}: left fullscreen`);
    if ((action === 'retry') !== (s.seed === before)) fail(`${at}: seed ${before} → ${s.seed}`);
    if (s.urlSeed !== s.seed) fail(`${at}: URL seed ${s.urlSeed}, city ${s.seed}`);
    if (s.splashAnimations) fail(`${at}: ${s.splashAnimations} splash animations still running`);
    if (s.canvases !== 1 || s.screens !== 1 || s.touch > 1) fail(`${at}: ${s.canvases} canvases, ${s.screens} screens, ${s.touch} touch layers`);
    if (s.state !== 'menu') fail(`${at}: state ${s.state}`);
    if (takeShots) await shot(`menu-${steps.length}`);
    key('Enter');
    await sleep(1200);
    if (game.state !== 'playing') fail(`${at}: Enter didn't start the mission (${game.state})`);
  }

  // (2) Quick same-city restarts, for leaks: the file's city first, if there was one.
  const rows = [];
  for (let i = 0; i < quick; i++) {
    if (!(await next((old) => (i === 0 && file ? old.loadCity(JSON.parse(file)) : old.retry())))) {
      fail(`quick restart ${i}: next city never came up`);
      break;
    }
    await sleep(300);
    rows.push(gpu());
  }
  await sleep(1000);
  collect();
  const alive = refs.map((r, i) => (r.deref() ? i : -1)).filter((i) => i >= 0);
  if (alive.length) fail(`old Games still alive: #${alive.join(', #')} of ${refs.length}`);
  if (rows.length >= 3) {
    const [a, z] = [rows[1], rows[rows.length - 1]];
    const perRestart = (z.heapMB - a.heapMB) / (rows.length - 2);
    if (perRestart > 1.5) fail(`heap climbs ${perRestart.toFixed(1)} MB per restart (${a.heapMB} → ${z.heapMB})`);
    if (Math.abs(z.geometries - a.geometries) > 2) fail(`geometries ${a.geometries} → ${z.geometries}`);
    if (z.textures !== a.textures) fail(`textures ${a.textures} → ${z.textures}`);
    if (z.programs !== a.programs) fail(`programs ${a.programs} → ${z.programs}`);
  }

  const out = { ok: failures.length === 0, failures, busyRuns, steps, restarts: rows.map((r) => `${r.heapMB}MB ${r.geometries}g ${r.textures}t ${r.programs}p`).join(' | ') };
  if (window.gpuTrace) {
    const orphans = gpuTrace.orphans([game.scene, game.staging].filter(Boolean));
    out.orphans = orphans.map((e) => `${e.label} @ ${e.site}`);
    const extra = orphans.filter((e) => !/MeshDepthMaterial|DFG_LUT/.test(e.label));
    if (extra.length) {
      out.ok = false;
      failures.push(`${extra.length} GPU resources nothing draws (see orphans)`);
    }
  }
  out.fps = await dbg.fps(2000);
  return out;
})()
