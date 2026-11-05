// The whole scene's triangles by owner (Game.owned tags; untagged roots are cars), visible or not,
// for knowledge/polygons.md: what each builder costs a city before culling (instanced: tris × count).
// Also the street props by model (tris × instances) and the biggest meshes of each owner.
//   npm run check:browser -- --query "seed=9&debug&oldtown=1&chinatown=1&harbor=1" --start 2000 --no-final \
//     --eval-file scripts/evals/polygons.js
// ?top=N meshes per owner (default 5).
(async () => {
  const g = window.game;
  const top = Number(new URLSearchParams(location.search).get('top') ?? 5);
  dbg.police(false);
  const tris = (geo) => (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
  const owners = new Map();
  for (const root of g.scene.children) {
    const owner = root.userData.owner ?? `${root.type} (cars, untagged)`;
    const row = owners.get(owner) ?? owners.set(owner, { tris: 0, shadowTris: 0, meshes: 0, list: [] }).get(owner);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const per = tris(o.geometry), n = o.isInstancedMesh ? o.count : 1, t = per * n;
      row.tris += t;
      row.meshes++;
      if (o.castShadow) row.shadowTris += t;
      const m = [].concat(o.material)[0];
      row.list.push([t, `${Math.round(t)} ${o.isInstancedMesh ? `(${per}×${n})` : ''} ${m.type}${m.map ? ' textured' : ''}${o.castShadow ? ' shadow' : ''} ${o.name || o.parent?.name || ''}`.replace(/\s+/g, ' ').trim()]);
    });
  }
  const rows = [...owners].sort((a, b) => b[1].tris - a[1].tris);
  const props = Object.entries(g.props?.meshes ?? {})
    .map(([key, m]) => [key, tris(m.geometry), m.count])
    .filter(([, , n]) => n)
    .sort((a, b) => b[1] * b[2] - a[1] * a[2])
    .map(([key, per, n]) => `${key}: ${per}×${n} = ${per * n}`);
  return {
    total: Math.round(rows.reduce((s, [, r]) => s + r.tris, 0)),
    owners: Object.fromEntries(rows.map(([o, r]) => [o, {
      tris: Math.round(r.tris), shadowTris: Math.round(r.shadowTris), meshes: r.meshes,
      top: r.list.sort((a, b) => b[0] - a[0]).slice(0, top).map((x) => x[1]),
    }])),
    props,
  };
})()
