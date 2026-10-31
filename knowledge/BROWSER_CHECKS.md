# Browser checks

## The tool: `npm run check:browser` (`scripts/browser-check.mjs`; its header lists every option)

```
npm run check:browser -- --query "seed=11&debug&oldtown=1" --start 2000 --out-dir <dir> --no-final --eval-file <file.js>
```

- Headless Chrome, always **muted**, `gc()` exposed, the expression run as a user gesture (it may
  `requestFullscreen()`). `debug` in the query gives `window.game` and `window.dbg`.
- Reuses a Vite server already on the port: start `npx vite --port 5199` once per session in the
  background, then a run is ~10 s plus the eval.
- Output JSON: `val`, `shots`, `logs` (console errors/warnings, exceptions; Rapier's init deprecation
  filtered), `eval threw: …` in `logs` if the expression threw.
- `await shot('name')` any number of times: **one run per milestone with all its views**.
- A city with a feature: `--make "flat chinatown festival night seed=N"` (`npm run city -- make` into a
  temp file) or `--city <file>` (a dump or a made file), loaded with `dbg.loadCity` before `--start`.
- Phone: `--size 390x844`; `--throttle 4` slows the CPU during the expression (a mid-range phone's
  CPU, not its GPU); `&touch` in the query for the game's phone settings (1024² shadow map, car
  shadows culled, half the precipitation, touch controls): the size alone keeps the desktop ones; `--profile f.json` adds CPU and heap sampling profiles (top self time and bytes
  per function; the line is the function's first line).
- **Before/after: `--vs <ref>`** runs the same check on that ref first (its own worktree in the temp
  dir, kept for next time, and its own Vite on port + 100), then here; prints `{ vs, sha, base, current }`,
  shots in `<out-dir>/base` and `/current`. Use it for every before/after: a baseline from the server
  you're editing against picks up your edits as Vite hot-reloads them. An eval run on an older ref must
  cope with `dbg` helpers it lacks (`dbg.x?.()`).
- **Compare two shots:** `node scripts/png-diff.mjs a.png b.png [--threshold 24] [--out diff.png]`:
  pixels that differ, their share and bounding box, the differences in red over a dimmed copy (exit 1
  when any differ). Traffic, rain and the HUD always differ a little: judge by where the box falls.

## Ready-made evals (`scripts/evals/`): start there

Each file's header lists its query options and what it returns.

| Eval | Use it for |
|---|---|
| `district-tour.js` + `?<kind>=1` | a milestone's look: stats + FPS first, then a road and an aerial shot of each structure kind and an overview. `&orbit=4` for gates and anything sized to its road; `&tourKinds=park,statue` tours city things with no district |
| `district-drive.js` + `?<kind>=1` | a district's driving: 5★ chase in under the first overhead gate (stuck cops listed), every gate at 30 m/s, each off-road drivable rect end to end (`hit` = stopped inside, `exit` = past it, `stuck` = never moved). Use it instead of hand-written drive evals |
| `studio.js` + `?studio=…` | every new prop, vehicle, landmark or look, alone on a grey floor, before placing it (prop keys, `wreck-` prefixes, `~tint`, `lot:`, `mark:`, `car:`, `zone:`). Compiles its own programs: take `dbg.stats()` in another run |
| `perf-profile.js` | **after anything in the frame loop**: ms per system per frame, GPU ms, heap churn, calls, triangles, memory (`geometryHeapMB`: vertex copies still in the JS heap) over idle, cruise and a 5★ chase. `budget` must be all true. Reference: seed 9 `oldtown=1&chinatown=1&harbor=1`, with `--vs` ([OPTIMIZATIONS.md](OPTIMIZATIONS.md)) |
| `tri-breakdown.js` | **before choosing what to cull, merge or tile**: one cruising frame's calls and triangles per pass, and the meshes in view, biggest first |
| `restart.js` | `npm run check:restart`: Retry / New city leaks ([LEAKS.md](LEAKS.md)) |
| `city-reload.js` | `npm run check:reload`: a dump loads back as the same city, Retry keeps it, New city drops it |

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

## `window.dbg` (`src/core/debugTools.ts`, with `?debug`)

| Call | Does |
|---|---|
| `district(kind?)`, `find(kind)` | a district; a landmark/structure/prop/lot/`park`/`square` position |
| `view(point,{dist})` | camera on a clear road spot near it (never place the car by hand) |
| `gate(i,{back,speed,lateral,kind})` | car outside gate `i`, facing in |
| `place(x,z,yaw,speed)`, `road(x,z)` | put the car; nearest road centre point |
| `near(x,z,r)` | what stands there, nearest first, roadworks included |
| `drive({from,yaw,speed,ms,police,snap})` | starts on the nearest road, holds W, samples position/speed/tilt, stops at a hit and lists what was there |
| `aerial(point,{dist,height,from,look})` / `aerial(false)` | overview camera (fog off) aimed `look` m above a point's ground; loop `from` to orbit |
| `aim(point,{dist,height,from,look})` / `aim(false)` | the game's own camera (fog and far plane as in play), for what's drawn far off or past the fog |
| `studio(names)` / `studioShot({focus,from,height,dist})` / `studio(false)` | model studio, HUD hidden |
| `hold(code,ms)`, `stars(n)`, `police(on)`, `repair()`, `sleep(ms)` | input, wanted level, cops on/off, full health |
| `car()`, `stats()`, `fps(ms)` | position/speed; programs, calls, triangles, static triangles; FPS (capped at 60, shows only drops) |
| `mixedMaterials()` | materials drawn by more than one kind of mesh (plain, instanced, instanced with colours), shadow pass included: each switches program every draw. Must be `[]` |
| `programLookups(ms)` | shader program lookups per frame by material; `[]` while driving, else `mixedMaterials()` usually says why |
| `dumpCity(download?)`, `loadCity(file)` | this run's params as text; restart in place with a params file ([CITY_PARAMS.md](CITY_PARAMS.md)) |

## What to check per milestone

On and off (`?<kind>=1` / `=0`, same seed): views, `dbg.stats()` (programs must not grow), empty
console; perf at phone size with `dbg.fps()`. Stills can't show flicker or feel: verify geometry, leave
feel to the user.

## Pitfalls

- `--make` words without `seed=` start from a random seed: a check that must repeat passes one.
- Measure `dbg.stats()` **before** any `aerial()` (the overview turns fog off and every material
  recompiles: 35 read as 58; `stats()` warns) and before a drive breaks props (a first break can add one).
- Draw calls read a few high for a frame or two after any restart (Retry, New city, `loadCity`): compare
  the lowest of a few samples ~700 ms apart (`city-reload.js` does).
- `perf-profile.js` numbers swing with machine load (~15 % between runs; never with `npm run cops` or
  a test run going): compare sides run one after the other (`--vs` does), and run twice when they're
  close. Judge phones by `FRAME` ms at `--throttle 4`, not FPS. GPU ms drifts between pages: for a
  GPU change, switch it on and off in one page (a light's `visible`, a uniform) and alternate.
- The heap profile names functions, not lines. In hot per-car code the usual hidden costs are `for…of`
  (iterators), array destructuring, spreads and closures: index loops and plain locals instead. What
  three's WebGL uniform calls allocate is the browser's bindings: only fewer draws cut it.
- Stray triangles or holes near an aerial camera are near-plane clipping (`aerial()` sets near = 1 m):
  back the camera off before chasing them.
- Drives start on a road (`drive` snaps there). A start 25 m past a block edge lands among kerb clutter
  and the car pitches over from the first frame.
- A drive "stopping" is usually traffic, a 5★ roadblock or a building past the end of the line: check
  `hit.near` and a shot before suspecting the district. Use `police(false)` unless testing cops.
- Read screenshots one at a time and only those that answer a question; aerials answer more.
