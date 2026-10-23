// Look at models and lot buildings on their own, from several angles, in one run:
//   npm run check:browser -- --query "seed=11&debug&studio=dumpster,wreck-,lot:slums/tenement&angles=4&closeups=1" \
//     --start 1500 --out-dir <dir> --no-final --eval-file scripts/evals/studio.js
// `studio=` names (comma separated): prop model keys (`dumpster`, `fence-torn`), prefixes ending in
// `-` (`wreck-`, `sign-`), tints (`couch~6a3a2a`: tinted models show white where the tint goes),
// lot buildings (`lot:slums/gutted`, `lot:farm/barn@9` with a height). Shots: `grid-<k>` from
// `angles` directions round the whole grid (default 4), one low eye-level grid shot with `low=1`,
// and with `closeups=1` each item alone from the front-left and back-right (`<i>-<name>-a|b`).
// `city=snow|desert|beach` picks the climate's looks. The studio has its own lights: it compiles
// its own programs, so take `dbg.stats()` in another run.
(async () => {
  const params = new URLSearchParams(location.search);
  const names = (params.get('studio') ?? 'dumpster,wreck-').split(',').filter(Boolean);
  const angles = Number(params.get('angles') ?? 4);
  await dbg.police(false);
  const laid = await dbg.studio(names);
  if (!laid.length) return { error: `nothing matched ${names.join(',')}` };
  const shots = [];
  for (let k = 0; k < angles; k++) {
    await dbg.studioShot({ from: Math.PI * 0.25 + (k * Math.PI * 2) / angles });
    await shot(`grid-${k}`);
    shots.push(`grid-${k}`);
  }
  if (params.get('low') === '1') {
    await dbg.studioShot({ from: Math.PI * 0.25, height: 1.6 });
    await shot('grid-low');
    shots.push('grid-low');
  }
  if (params.get('closeups') === '1') {
    for (let i = 0; i < laid.length; i++) {
      const safe = laid[i].name.replace(/[^a-z0-9-]+/gi, '_');
      for (const [tag, from] of [['a', Math.PI * 0.2], ['b', Math.PI * 1.2]]) {
        await dbg.studioShot({ focus: i, from });
        await shot(`${i}-${safe}-${tag}`);
        shots.push(`${i}-${safe}-${tag}`);
      }
    }
  }
  await dbg.studio(false);
  return { laid, shots };
})()
