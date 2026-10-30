// A dumped city loads back as the same city (dbg.dumpCity → dbg.loadCity), Retry keeps the params,
// New city drops them:
//   npm run check:reload   (seed 9, every district forced, night, rain; shots in node_modules/.cache/check-reload)
//   npm run check:browser -- --query "seed=N&debug[&<URL flags>]" --out-dir <dir> --no-final \
//     --eval-file scripts/evals/city-reload.js
// Shots `seed` and `file` are the same aerial of the same city (compare them); stats are taken before
// any aerial, so programs and draw calls must match. Returns `ok` and `failures` first.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const splash = document.getElementById('splash');
  const failures = [];
  const fail = (what) => failures.push(what);
  /** Restart through `trigger` and wait for main.ts to swap in the next Game. */
  const next = async (trigger) => {
    const old = window.game;
    await trigger(old);
    for (let i = 0; i < 600; i++) {
      if (window.game !== old && splash.hidden) return true;
      await sleep(100);
    }
    return false;
  };
  // What the city is, beyond its params: every building, prop and landmark where it stands.
  const fingerprint = () => {
    const c = game.city;
    let sum = 0;
    for (const b of c.buildings) sum += b.x * 3 + b.z * 7 + b.h;
    for (const p of c.streetProps) sum += p.x + p.z * 5;
    for (const l of c.landmarks) sum += l.x * 11 + l.z;
    return { buildings: c.buildings.length, props: c.streetProps.length, landmarks: c.landmarks.length, districts: c.districts.map((q) => q.kind).join(','), sum: +sum.toFixed(3) };
  };
  // Draw calls read a few high for a frame or two after a restart: take the settled (lowest) of 4.
  const settled = async () => {
    const all = [];
    for (let i = 0; i < 4; i++) (all.push(dbg.stats()), await sleep(700));
    return all.reduce((m, x) => (x.calls < m.calls ? x : m));
  };
  const view = async (name) => {
    await dbg.aerial({ x: 0, z: 0 }, { dist: 260, height: 220, wait: 1500 });
    await shot(name);
  };

  // The seed's city, as the URL built it.
  await sleep(1500);
  const seed = game.city.seed;
  const text = dbg.dumpCity(false);
  const a = { stats: await settled(), city: fingerprint() };
  await view('seed');

  // Its dump, loaded in place.
  const loaded = await dbg.loadCity(text);
  await sleep(1500);
  const b = { stats: await settled(), city: fingerprint() };
  await view('file');
  if (loaded.warnings.length) fail(`warnings: ${loaded.warnings.join('; ')}`);
  if (dbg.dumpCity(false) !== text) fail('the loaded city dumps differently');
  if (JSON.stringify(a.city) !== JSON.stringify(b.city)) fail(`city ${JSON.stringify(a.city)} → ${JSON.stringify(b.city)}`);
  for (const k of ['programs', 'calls', 'staticTris']) if (a.stats[k] !== b.stats[k]) fail(`${k} ${a.stats[k]} → ${b.stats[k]}`);
  if (Number(new URLSearchParams(location.search).get('seed')) !== seed) fail('URL seed changed');

  // Retry keeps the params; New city goes back to a seed.
  if (!(await next((old) => old.retry()))) fail('retry: next city never came up');
  else if (!game.loaded || dbg.dumpCity(false) !== text) fail('retry dropped the params');
  if (!(await next((old) => old.restart(seed + 1)))) fail('new city: next city never came up');
  else if (game.loaded || game.city.seed !== seed + 1) fail(`new city kept the params (seed ${game.city.seed})`);

  // A file with errors restarts nothing.
  const before = window.game;
  const refused = await dbg.loadCity({ version: 1, seed: 3, blocks: 40 }).then(() => null, (e) => String(e));
  if (!refused || !/blocks: 40/.test(refused)) fail(`bad file: ${refused}`);
  if (window.game !== before) fail('bad file restarted the game');

  return { ok: failures.length === 0, failures, seed, a, b, refused };
})()
