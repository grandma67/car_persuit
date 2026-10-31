// Load time of a city, cold and warm. The run's `cityLoadMs` (check:browser with --city or --make)
// is the cold one: the first time this page builds that look, every shader compiles. This eval then
// reloads the same city `warm=N` times (default 2) in the page, where the browser's shader cache
// makes compiles nearly free, and returns those times. A change to shader compiling (programs,
// checkShaderErrors) shows in the cold number; one to building the city (generate, build, NavGrid,
// districts) in both. Compare with --vs, and repeat the run: a cold load swings by ~3 %.
//   npm run check:browser -- --query "debug" --make "night snow seed=9" --no-final \
//     --eval-file scripts/evals/cold-load.js            (one look at a time: night, snow, a district…)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const n = Number(new URLSearchParams(location.search).get('warm') ?? 2);
  const text = window.dbg.dumpCity(false);
  const warm = [];
  for (let i = 0; i < n; i++) {
    await sleep(800);
    const t = performance.now();
    await window.dbg.loadCity(text);
    const f0 = window.game.renderer.info.render.frame;
    while (window.game.renderer.info.render.frame < f0 + 2) await sleep(5);
    warm.push(Math.round(performance.now() - t));
  }
  return { warmMs: warm, programs: window.game.renderer.info.programs.length };
})()
