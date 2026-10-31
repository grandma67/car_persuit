// A/B in one page: switch one thing on and off, alternating, and time each state: GPU ms per frame
// (timer query), the JS frame and renderer.render. GPU time drifts between pages by more than most
// changes are worth, so a GPU question gets this instead of two perf-profile runs.
//   npm run check:browser -- --query "seed=9&debug&oldtown=1&ab=pointLights" --start 2000 --no-final \
//     --eval-file scripts/evals/gpu-ab.js                  (phone: --size 390x844 and &touch)
// Query options:
//   ab=pointLights | spotLights | shadowPass | precipitation | owner:<name>   what "off" turns off
//      (owner: anything a builder tagged, see dbg.sceneBreakdown: city, props, districts, landmarks,
//      roadworks, sea, sky…; also player, cops, traffic)
//   abExpr=<js>   instead: a function body run with `on` (true/false) and `game`, e.g.
//      abExpr=game.renderer.setPixelRatio(on%3F1%3A0.75)   (URL-encode ? and :)
//   rounds=4  ms=2500  drive=1 (hold W: cruising; default a still camera, the steadiest GPU number)
// Returns per state the mean and each round, Δ% off vs on, and in how many paired rounds off was
// lower (GPU time drifts up over a run: trust 4/4 or 0/4, not a mean Δ of a few % with 2/4). A light hidden or a castShadow
// switched recompiles: the first frames after a switch are left out (settle=400 ms).
(async () => {
  const g = window.game;
  const q = new URLSearchParams(location.search);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rounds = Number(q.get('rounds') ?? 4);
  const ms = Number(q.get('ms') ?? 2500);
  const settle = Number(q.get('settle') ?? 400);
  const ab = q.get('ab');
  const expr = q.get('abExpr');

  // What "on"/"off" means.
  const owners = new Map();
  owners.set(g.player.mesh.root, 'player');
  for (const c of g.director.cops) owners.set(c.vehicle.mesh.root, 'cops');
  for (const c of g.traffic.cars) owners.set(c.vehicle.mesh.root, 'traffic');
  const ownerOf = (o) => o.userData.owner ?? owners.get(o);
  const visibleAll = (list) => (on) => list.forEach((o) => (o.visible = on));
  let set;
  if (expr) set = new Function('on', 'game', expr).bind(null);
  else if (ab === 'pointLights' || ab === 'spotLights') {
    const type = ab === 'pointLights' ? 'isPointLight' : 'isSpotLight';
    const list = [];
    g.scene.traverse((o) => o[type] && o.visible && list.push(o));
    set = visibleAll(list);
  } else if (ab === 'shadowPass') {
    const sm = g.renderer.shadowMap;
    set = (on) => ((sm.autoUpdate = on), (sm.needsUpdate = false));
  } else if (ab === 'precipitation') {
    set = visibleAll(g.scene.children.filter((o) => ownerOf(o) === 'precipitation'));
  } else if (ab?.startsWith('owner:')) {
    const name = ab.slice(6);
    const list = g.scene.children.filter((o) => ownerOf(o) === name);
    if (!list.length) return { error: `nothing owned by "${name}"`, owners: [...new Set(g.scene.children.map(ownerOf).filter(Boolean))] };
    set = visibleAll(list);
  } else return { error: 'ab=pointLights|spotLights|shadowPass|precipitation|owner:<name>, or abExpr=<js>' };
  const apply = (on) => (expr ? set(on, g) : set(on));

  // Timers: GPU per render, CPU per frame.
  const gl = g.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let gpu = 0, gpuN = 0, frame = 0, render = 0, frames = 0;
  const rr = g.renderer.render;
  g.renderer.render = function (...a) {
    const t0 = performance.now();
    const query = ext && gl.createQuery();
    if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    try { return rr.apply(this, a); } finally {
      if (query) (gl.endQuery(ext.TIME_ELAPSED_EXT), pending.push(query));
      render += performance.now() - t0;
    }
  };
  const fr = g.frame;
  g.frame = function (...a) {
    const t0 = performance.now();
    try { return fr.apply(this, a); } finally { frame += performance.now() - t0; frames++; }
  };
  const poll = () => {
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) (gpu += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6), gpuN++;
      gl.deleteQuery(query);
    }
  };
  const measure = async () => {
    await sleep(settle);
    while (pending.length) (poll(), await sleep(5)); // results of the frames before
    gpu = gpuN = frame = render = frames = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) (poll(), await new Promise((r) => requestAnimationFrame(r)));
    return { gpu: gpuN ? +(gpu / gpuN).toFixed(3) : null, frame: +(frame / frames).toFixed(3), render: +(render / frames).toFixed(3) };
  };

  dbg.police(false);
  const driving = q.get('drive') === '1' ? dbg.hold('KeyW', rounds * 2 * (ms + settle + 200) + 1000) : null;
  const runs = { on: [], off: [] };
  for (let i = 0; i < rounds; i++) {
    for (const on of [true, false]) {
      apply(on);
      runs[on ? 'on' : 'off'].push(await measure());
    }
  }
  apply(true);
  g.renderer.render = rr;
  g.frame = fr;
  if (driving) await driving;
  const mean = (list, k) => (list.every((r) => r[k] !== null) ? +(list.reduce((t, r) => t + r[k], 0) / list.length).toFixed(3) : null);
  const sum = (k) => {
    const a = mean(runs.on, k), b = mean(runs.off, k);
    // Paired rounds: GPU time creeps up over a run, so "off lower in 4/4" says more than the means.
    const lower = runs.off.filter((r, i) => r[k] !== null && r[k] < runs.on[i][k]).length;
    return { on: a, off: b, delta: a && b !== null ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%` : null, offLower: `${lower}/${rounds}` };
  };
  return { ab: expr ?? ab, gpu: sum('gpu'), frame: sum('frame'), render: sum('render'), rounds: runs, timer: !!ext };
})()
