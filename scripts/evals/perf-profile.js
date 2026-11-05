// Frame profile: per-subsystem CPU ms per frame (wraps Game members with timers, no source change),
// GPU ms (EXT_disjoint_timer_query_webgl2), JS heap churn MB/s and GCs/s, draw calls, triangles, and a
// GPU/heap memory estimate, over idle, a police-off cruise and a 5★ chase. See knowledge/OPTIMIZATIONS.md.
//   npm run check:browser -- --query "seed=9&debug&oldtown=1&chinatown=1&harbor=1" --start 2000 --no-final \
//     --eval-file scripts/evals/perf-profile.js        (phone: --size 390x844)
// Wraps private members by name: a renamed member just drops out of `per`. With `focus=` in the query
// (--vs-make adds it) or `&at=focus`, it starts at the district (dbg.focus) instead of the spawn.
(async () => {
  const g = window.game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = {}; // name -> {ms, n}
  const wrap = (obj, method, name) => {
    if (!obj || typeof obj[method] !== 'function') return;
    const orig = obj[method];
    obj[method] = function (...a) {
      const t = performance.now();
      try { return orig.apply(this, a); } finally {
        const e = (T[name] ??= { ms: 0, n: 0 }); e.ms += performance.now() - t; e.n++;
      }
    };
  };
  // Prototype wraps catch every instance (cars, cops, controllers).
  const protoWrap = (inst, method, name) => inst && wrap(Object.getPrototypeOf(inst), method, name);
  wrap(g, 'frame', 'FRAME');
  wrap(g.world, 'step', 'physics.step');
  wrap(g.props, 'updateActive', 'props.updateActive');
  wrap(g.props, 'checkVehicle', 'props.checkVehicle');
  wrap(g.props, 'sync', 'props.sync');
  wrap(g.props, 'updateSignals', 'props.updateSignals');
  wrap(g.props, 'updateLamps', 'props.updateLamps');
  wrap(g.traffic, 'update', 'traffic.update');
  wrap(g.director, 'update', 'director.update');
  wrap(g.minimap, 'render', 'minimap.render');
  wrap(g.hud, 'update', 'hud.update');
  wrap(g.glows, 'update', 'glows.update');
  wrap(g.landmarks, 'update', 'landmarks.update');
  wrap(g.effects, 'update', 'effects.update');
  wrap(g.sirens, 'update', 'sirens.update');
  wrap(g.chase, 'update', 'chase.update');
  wrap(g.sea, 'update', 'sea.update');
  wrap(g.audio, 'update', 'audio.update');
  wrap(g, 'cullCarShadows', 'cullCarShadows');
  wrap(g, 'checkWater', 'checkWater');
  wrap(g, 'updateMission', 'updateMission');
  wrap(g, 'scratch', 'scratch');
  wrap(g, 'markWall', 'markWall');
  wrap(g, 'updatePropBreaks', 'updatePropBreaks');
  for (const w of g.roadworks ?? []) wrap(w, 'update', 'roadworks.update');
  for (const v of g.districtViews ?? []) wrap(v, 'update', 'districtViews.update');
  wrap(g.renderer, 'render', 'renderer.render');
  const car = g.traffic.cars[0];
  protoWrap(car?.controller, 'update', 'civ.controller.update');
  protoWrap(g.player, 'drive', 'vehicle.drive');
  protoWrap(g.player, 'snapshot', 'vehicle.snapshot');
  protoWrap(g.player, 'syncMesh', 'vehicle.syncMesh');
  // Shadow pass is inside renderer.render: time it separately.
  const sm = g.renderer.shadowMap;
  wrap(sm, 'render', 'renderer.shadowMap.render');

  // GPU timer
  const gl = g.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let gpuMs = 0, gpuN = 0;
  const pendingQ = [];
  if (ext) {
    const rr = g.renderer.render;
    g.renderer.render = function (...a) {
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try { return rr.apply(this, a); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pendingQ.push(q); }
    };
  }
  const pollGpu = () => {
    while (pendingQ.length && gl.getQueryParameter(pendingQ[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pendingQ.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { gpuMs += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gpuN++; }
      gl.deleteQuery(q);
    }
  };

  // Heap churn: sum of positive heap deltas per rAF; drops = GCs.
  let heapStats;
  const sample = async (ms) => {
    for (const k in T) delete T[k];
    gpuMs = 0; gpuN = 0;
    let alloc = 0, gcs = 0, gcFreed = 0, frames = 0, worst = 0, last = performance.memory.usedJSHeapSize, lastT = performance.now();
    const gaps = [];
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const h = performance.memory.usedJSHeapSize;
        if (h >= last) alloc += h - last; else { gcs++; gcFreed += last - h; }
        last = h;
        const now = performance.now(); gaps.push(now - lastT); lastT = now;
        frames++;
        if (ext) pollGpu();
        if (now - t0 < ms) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    const secs = (performance.now() - t0) / 1000;
    const nFrames = T.FRAME?.n || 1;
    const per = Object.fromEntries(Object.entries(T).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => [k, { msPerFrame: +(v.ms / nFrames).toFixed(3), callsPerFrame: +(v.n / nFrames).toFixed(1) }]));
    gaps.sort((a, b) => a - b);
    return {
      fps: +(frames / secs).toFixed(1),
      frameGapP50: +gaps[Math.floor(gaps.length * 0.5)].toFixed(1), frameGapP99: +gaps[Math.floor(gaps.length * 0.99)].toFixed(1),
      allocMBperSec: +(alloc / 1e6 / secs).toFixed(2), gcPerSec: +(gcs / secs).toFixed(2),
      gpuMsPerFrame: gpuN ? +(gpuMs / gpuN).toFixed(2) : 'n/a',
      cars: g.traffic.cars.length, cops: g.director.cops.length,
      render: { ...g.renderer.info.render }, mem: { ...g.renderer.info.memory },
      per,
    };
  };

  const out = {};
  // `focus=…` in the URL (--vs-make passes it) or `at=focus`: idle, cruise and chase start at the
  // district (the same spot with it on and off), not at the run's spawn.
  const params = new URLSearchParams(location.search);
  if (params.has('focus') || params.get('at') === 'focus') {
    const f = dbg.focus?.();
    out.at = f ? await dbg.view(f, { dist: 25 }) : null;
  }
  out.stats = dbg.stats();
  out.mixedMaterials = dbg.mixedMaterials?.(); // expected empty (OPTIMIZATION_TASKS 1.1)
  out.idle = await sample(3000);
  dbg.police(false);
  const drive = dbg.hold('KeyW', 7000);
  await sleep(1500);
  out.cruise = await sample(5000);
  // Garbage budget while cruising (OPTIMIZATION_TASKS M1: 30 → 16 MB/s on seed 9, + ~30%). Most of
  // what's left is three's WebGL uniform calls (per draw) and Rapier's getters (per car per step).
  out.staleMatrices = window.dbg.staleMatrices?.() ?? []; // frozen objects moved without updateMatrix (expected empty)
  out.budget = { allocMBperSec: out.cruise.allocMBperSec <= 21, mixedMaterials: !out.mixedMaterials?.length, staleMatrices: !out.staleMatrices.length };
  await drive;
  dbg.police(true);
  await dbg.stars(5);
  const chase = dbg.hold('KeyW', 12000);
  await sleep(4000);
  out.chase5 = await sample(7000);
  await chase;

  // Memory: JS heap after GC, GPU buffers/textures estimate.
  gc(); gc(); await sleep(200);
  const geos = new Set(), texs = new Set();
  let geoBytes = 0, geoHeap = 0, texBytes = 0, meshes = 0, castShadow = 0, instanced = 0, instances = 0;
  const byGeoOwner = {};
  g.scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    if (o.castShadow) castShadow++;
    if (o.isInstancedMesh) { instanced++; instances += o.count; }
    const geo = o.geometry;
    if (geo && !geos.has(geo)) {
      geos.add(geo);
      // GPU size from count (a static city mesh drops its JS copy after upload: array null).
      const size = (a) => a.count * a.itemSize * (a.array?.BYTES_PER_ELEMENT ?? 4);
      let b = geo.index ? size(geo.index) : 0;
      for (const a of Object.values(geo.attributes)) {
        b += size(a);
        if (a.array) geoHeap += a.array.byteLength;
      }
      if (geo.index?.array) geoHeap += geo.index.array.byteLength;
      if (o.isInstancedMesh) b += o.instanceMatrix.array.byteLength + (o.instanceColor?.array.byteLength ?? 0);
      geoBytes += b;
      const key = o.name || o.parent?.name || o.type;
      byGeoOwner[key] = (byGeoOwner[key] ?? 0) + b;
    }
    for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) {
      if (v && v.isTexture && !texs.has(v)) {
        texs.add(v);
        const img = v.image;
        const w = img?.width ?? 0, h = img?.height ?? 0;
        texBytes += w * h * 4 * (v.generateMipmaps !== false ? 1.33 : 1);
      }
    }
  });
  out.memory = {
    jsHeapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1),
    meshes, castShadow, instanced, instances,
    geometries: geos.size, geometryMB: +(geoBytes / 1e6).toFixed(1), geometryHeapMB: +(geoHeap / 1e6).toFixed(1),
    textures: texs.size, textureMB: +(texBytes / 1e6).toFixed(1),
    topGeometryOwners: Object.entries(byGeoOwner).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}: ${(v / 1e6).toFixed(2)} MB`),
    shadowMap: g.sun?.shadow?.mapSize?.x,
    pixelRatio: g.renderer.getPixelRatio(),
    rapierBodies: g.world.bodies.len(), rapierColliders: g.world.colliders.len(),
  };
  return out;
})()
