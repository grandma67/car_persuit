// A milestone's browser check in one run, for the district forced on in the URL:
//   npm run check:browser -- --query "seed=11&debug&harbor=1" --start 2000 --out-dir <dir> \
//     --no-final --eval-file scripts/evals/district-tour.js
// Police off; programs, calls and FPS measured first (before any aerial view: the overview camera
// turns the fog off and every material recompiles); then a road-level shot and an aerial shot of
// the first of each structure kind (up to `tour=N` kinds, default 8), and one overview of the
// district. Read only the shots you need. Add `&tourKinds=crane,ship` to pick the kinds; kinds the
// district lacks come from the whole city (`dbg.find`: landmarks, lots, `park`, `square`), so
// `?seed=N&debug&tourKinds=park,square,statue` tours them with no district at all. `&orbit=N` takes
// each aerial from N angles round it (`<kind>-air-<i>`) instead of one (`<kind>-air`).
(async () => {
  const params = new URLSearchParams(location.search);
  const kinds = ['oldtown', 'chinatown', 'harbor', 'farm', 'slums'];
  const kind = kinds.find((k) => params.get(k) === '1');
  const q = dbg.district(kind);
  const pick = params.get('tourKinds')?.split(',');
  if (!q && (kind || !pick)) return { error: `no ${kind ?? 'district'} placed on this seed` };
  await dbg.police(false);
  const out = { kind: q?.kind, grid: q?.grid, stats: dbg.stats(), fps: await dbg.fps(2000), views: {} };
  const firsts = new Map();
  for (const s of q?.dressing.structures ?? []) if (!firsts.has(s.kind)) firsts.set(s.kind, s);
  for (const l of q?.dressing.landmarks ?? []) if (!firsts.has(l.kind)) firsts.set(l.kind, l);
  for (const k of pick ?? []) if (!firsts.has(k) && dbg.find(k)) firsts.set(k, dbg.find(k));
  const max = Number(params.get('tour') ?? 8);
  const orbit = Number(params.get('orbit') ?? 0);
  const list = [...firsts].filter(([k]) => !pick || pick.includes(k)).slice(0, max);
  out.missing = (pick ?? []).filter((k) => !firsts.has(k));
  // Road-level views first (all with the fog on), then the aerial ones.
  for (const [k, t] of list) {
    out.views[k] = await dbg.view(t, { dist: 35 });
    if (out.views[k]) await shot(`${k}-road`);
  }
  const airs = [];
  for (const [k, t] of list) {
    // A block (park, square) is framed whole; anything else from the structures' usual distance.
    const size = t.w && t.d ? Math.max(t.w, t.d) : 0;
    // Orbits look down steeper: from every side, some angle has a roof close to the lens.
    const dist = Math.max(55, size * 1.2), height = Math.max(orbit ? 50 : 35, size * 0.8);
    for (let i = 0; i < Math.max(1, orbit); i++) {
      const name = orbit ? `${k}-air-${i}` : `${k}-air`;
      await dbg.aerial(t, { dist, height, from: -2.4 + (i * Math.PI * 2) / Math.max(1, orbit) });
      await shot(name);
      airs.push(name);
    }
  }
  if (q) {
    const b = q.bounds;
    await dbg.aerial(b, { dist: Math.max(b.w, b.d) * 1.3, height: Math.max(b.w, b.d) * 0.8, from: -2.6 });
    await shot('overview');
  }
  await dbg.aerial(false);
  out.shots = [...list.filter(([k]) => out.views[k]).map(([k]) => `${k}-road`), ...airs, ...(q ? ['overview'] : [])];
  return out;
})()
