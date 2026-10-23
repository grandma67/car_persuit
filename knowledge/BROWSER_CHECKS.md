# Browser checks

`npm run check:browser -- --query "seed=11&debug&oldtown=1" --start 2000 --out-dir <dir> --no-final --eval-file <file.js>`
(`scripts/browser-check.mjs`): headless Chrome, always **muted**. It reuses a Vite server on the port:
start `npx vite --port 5199` once per session in the background (~10 s per run). Output JSON: `val`,
`shots`, console errors/warnings (Rapier deprecation filtered). Phone perf: `--size 390x844`.

Compare with main: `git worktree add <scratchpad>/mainwt main`, symlink `node_modules`, `--port 5299`.

## Ready-made evals (`scripts/evals/`): start there

- **Milestone tour** `district-tour.js` with `?seed=N&debug&<kind>=1`: stats + FPS first, then a road
  and an aerial shot of each structure kind and an overview (`&tour=N`, `&tourKinds=a,b`).
- **Driving check** `district-drive.js`: a 5★ chase in under the first overhead gate with stuck cops
  listed, every gate at 30 m/s, each off-road drivable rect end to end (`hit` = stopped inside what it
  tests, `exit` = past it, `stuck` = never moved). Use it instead of hand-written drive evals.
- **Studio** `studio.js` with `?seed=N&debug&studio=dumpster,wreck-,couch~6a3a2a,lot:slums/gutted&angles=4&closeups=1`:
  models, vehicles and buildings alone on a grey floor (prop keys, `-` prefixes, `~tint`,
  `lot:<kind>/<lot>[@height]`, `car:<key>[~hex]` (`car:` all, `car:cop-` cops; player, sedan, sports,
  suv, van, pickup, bus, boxtruck, ramptruck, tractor), `zone:<zone>[@h][v<variant>][=WxD]` (`zone:` all
  four, the seed picks the theme); `low=1` adds an eye-level shot, `city=` the climate's looks). Use it
  for every new prop, vehicle or look before placing it. It compiles its own programs: take
  `dbg.stats()` in another run.

Write a custom eval (in the scratchpad) only for drives and chases:

```js
(async () => {
  await dbg.gate(0); await shot('gate');              // 30 m outside gate 0, facing in
  await dbg.view(dbg.find('well')); await shot('square');
  await dbg.gate(1, { back: 45, speed: 36 }); await dbg.sleep(1500);
  const run = dbg.car();
  await dbg.stars(5); await dbg.hold('KeyW', 8000);   // 5★ chase
  return { run, stats: dbg.stats(), fps: await dbg.fps(2000) };
})()
```

`await shot('name')` any number of times: **one run per milestone with all its views**.

## `window.dbg` (`src/core/debugTools.ts`, with `?debug`)

| Call | Does |
|---|---|
| `district(kind?)`, `find(kind)` | a district; a landmark/structure/prop/lot position |
| `view(point,{dist})` | camera on a clear road spot near it (never place the car by hand) |
| `gate(i,{back,speed,lateral,kind})` | car outside gate `i`, facing in |
| `place(x,z,yaw,speed)`, `road(x,z)` | put the car; nearest road centre point |
| `near(x,z,r)` | what stands there, nearest first, roadworks included |
| `drive({from,yaw,speed,ms,police,snap})` | starts on the nearest road, holds W, samples position/speed/tilt, stops at a hit and lists what was there |
| `aerial(point,{dist,height,from,look})` / `aerial(false)` | overview camera aimed `look` m above a point's ground (loop `from` to orbit) |
| `studio(names)` / `studioShot({focus,from,height,dist})` / `studio(false)` | model studio, HUD hidden |
| `hold(code,ms)`, `stars(n)`, `police(on)`, `repair()`, `sleep(ms)` | input, wanted level, cops on/off, full health |
| `car()`, `stats()`, `fps(ms)` | position/speed; programs, calls, triangles, static triangles; FPS (capped at 60, shows only drops) |

## What to check per milestone

On and off (`?<kind>=1` / `=0`, same seed): views, `dbg.stats()` (programs must not grow), empty
console; perf at phone size with `dbg.fps()`. Stills can't show flicker or feel: verify geometry, leave
feel to the user.

## Pitfalls

- Measure `dbg.stats()` **before** any `aerial()` (the overview turns fog off and every material
  recompiles: 35 read as 58; `stats()` warns) and before a drive breaks props (a first break can add one).
- Stray triangles or holes near an aerial camera are near-plane clipping (`aerial()` sets near = 1 m):
  back the camera off before chasing them.
- Drives start on a road (`drive` snaps there). A start 25 m past a block edge lands among kerb clutter
  and the car pitches over from the first frame.
- A drive "stopping" is usually traffic, a 5★ roadblock or a building past the end of the line: check
  `hit.near` and a shot before suspecting the district. Use `police(false)` unless testing cops.
- Read screenshots one at a time and only those that answer a question; aerials answer more.
