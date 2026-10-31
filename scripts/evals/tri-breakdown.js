// Where the triangles and draw calls go, before choosing what to cull or merge (OPTIMIZATIONS.md):
// calls and triangles of the shadow pass and the main pass over one frame while cruising, and the
// meshes the chase camera's frustum keeps, biggest first (triangles × instances drawn, bounding
// radius and centre, whether three may cull it, whether it casts shadows).
//   npm run check:browser -- --query "seed=9&debug&oldtown=1&chinatown=1&harbor=1" --start 2000 --no-final \
//     --eval-file scripts/evals/tri-breakdown.js
// ?top=N lists N meshes (default 25).
(async () => {
  const g = window.game, r = g.renderer, sm = r.shadowMap;
  const top = Number(new URLSearchParams(location.search).get('top') ?? 25);
  dbg.police(false);
  const hold = dbg.hold('KeyW', 3000);
  await dbg.sleep(2000);
  // The shadow pass runs first inside renderer.render: read the counters as it ends.
  let shadow = null;
  const orig = sm.render;
  sm.render = function (...a) {
    const out = orig.apply(this, a);
    shadow = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    return out;
  };
  await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
  sm.render = orig;
  const total = { calls: r.info.render.calls, triangles: r.info.render.triangles };

  // The main pass: the meshes three's frustum test keeps (bounding sphere against the six planes).
  const cam = g.chase.camera;
  const e = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
  const planes = [];
  const plane = (a, b, c, d) => { const l = Math.hypot(a, b, c); planes.push([a / l, b / l, c / l, d / l]); };
  for (const [i, s] of [[0, -1], [0, 1], [1, 1], [1, -1], [2, -1], [2, 1]]) plane(e[3] + s * e[i], e[7] + s * e[4 + i], e[11] + s * e[8 + i], e[15] + s * e[12 + i]);
  const rows = [];
  g.scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    if (o.frustumCulled && !o.isInstancedMesh) {
      const c = bs.center.clone().applyMatrix4(o.matrixWorld);
      const rad = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (planes.some((p) => p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] < -rad)) return;
    }
    const tris = ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    const m = [].concat(o.material)[0];
    const at = o.isInstancedMesh ? '' : ` r=${Math.round(bs.radius)} at ${Math.round(bs.center.x)},${Math.round(bs.center.z)}`;
    rows.push([tris, `${Math.round(tris / 100) / 10}k ${o.isInstancedMesh ? `instanced ×${o.count}` : 'mesh'} ${m.type}${m.map ? ' textured' : ''}${at}${o.frustumCulled ? '' : ' never-culled'}${o.castShadow ? ' shadow' : ''} ${o.name || o.parent?.name || ''}`.trim()]);
  });
  await hold;
  rows.sort((a, b) => b[0] - a[0]);
  return {
    shadow,
    main: { calls: total.calls - shadow.calls, triangles: total.triangles - shadow.triangles },
    total,
    meshesInView: rows.length,
    top: rows.slice(0, top).map((row) => row[1]),
  };
})()
