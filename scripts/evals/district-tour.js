// A milestone's browser check in one run, for the district forced on in the URL:
//   npm run check:browser -- --query "seed=11&debug&harbor=1" --start 2000 --out-dir <dir> \
//     --no-final --eval-file scripts/evals/district-tour.js
// Police off; programs, calls and FPS measured first (before any aerial view: the overview camera
// turns the fog off and every material recompiles); then a road-level shot and an aerial shot of
// the first of each structure kind (up to `tour=N` kinds, default 8), and one overview of the
// district. Read only the shots you need. Add `&tourKinds=crane,ship` to pick the kinds.
(async () => {
  const params = new URLSearchParams(location.search);
  const kinds = ['oldtown', 'chinatown', 'harbor', 'farm'];
  const kind = kinds.find((k) => params.get(k) === '1');
  const q = dbg.district(kind);
  if (!q) return { error: `no ${kind ?? 'district'} placed on this seed` };
  await dbg.police(false);
  const out = { kind: q.kind, grid: q.grid, stats: dbg.stats(), fps: await dbg.fps(2000), views: {} };
  const firsts = new Map();
  for (const s of q.dressing.structures) if (!firsts.has(s.kind)) firsts.set(s.kind, s);
  for (const l of q.dressing.landmarks) if (!firsts.has(l.kind)) firsts.set(l.kind, l);
  const pick = params.get('tourKinds')?.split(',');
  const max = Number(params.get('tour') ?? 8);
  const list = [...firsts].filter(([k]) => !pick || pick.includes(k)).slice(0, max);
  // Road-level views first (all with the fog on), then the aerial ones.
  for (const [k, t] of list) {
    out.views[k] = await dbg.view(t, { dist: 35 });
    if (out.views[k]) await shot(`${k}-road`);
  }
  for (const [k, t] of list) {
    await dbg.aerial(t, { dist: 55, height: 35, from: -2.4 });
    await shot(`${k}-air`);
  }
  const b = q.bounds;
  await dbg.aerial(b, { dist: Math.max(b.w, b.d) * 1.3, height: Math.max(b.w, b.d) * 0.8, from: -2.6 });
  await shot('overview');
  await dbg.aerial(false);
  out.shots = [...list.flatMap(([k]) => [`${k}-road`, `${k}-air`]), 'overview'];
  return out;
})()
