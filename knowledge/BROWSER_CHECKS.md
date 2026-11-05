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
  The output's `cityLoadMs` times that load (a cold one: the page compiles that look's shaders).
- **`--table`**: a `perf-profile.js` result as one table (phases × systems, with `--vs` both sides
  and Δ%; budget, stats, memory, logs, profile tops under it) instead of the JSON, which goes to
  `--json f` (default `<out-dir>/result.json`). `node scripts/perf-table.mjs <saved.json>` for a saved one.
- Phone: `--size 390x844`; `--throttle 4` slows the CPU during the expression (a mid-range phone's
  CPU, not its GPU); `&touch` in the query for the game's phone settings (1024² shadow map, car
  shadows culled, half the precipitation, touch controls): the size alone keeps the desktop ones; `--profile f.json` adds CPU and heap sampling profiles (top self time and bytes
  per function; the line is the function's first line).
- **Before/after: `--vs <ref>`** runs the same check on that ref first (a temporary worktree, removed
  at the end or on Ctrl+C, and its own Vite on port + 100), then here; prints `{ vs, sha, base, current }`,
  shots in `<out-dir>/base` and `/current`. Use it for every before/after: a baseline from the server
  you're editing against picks up your edits as Vite hot-reloads them. An eval run on an older ref must
  cope with `dbg` helpers it lacks (`dbg.x?.()`).
- **District on vs off: `--vs-make "<words>"`** runs the same check on a city made from those words
  first (`nodistricts …`: the same city without districts), then on `--make`'s, on this tree and port;
  printed like `--vs` (with `--table`, a Δ% table). Both sides get `focus=x,z,w,d` in the query: the
  `--make` city's first district (`--focus-kind <kind>` for another; `npm run city -- focus <words>`
  prints them). `dbg.focus()` reads it, and `district-tour`, `perf-profile` and `gpu-ab` (`at=focus`)
  start there, so the city without the district is measured and shot in the same place, not at its spawn.
- **Compare two shots:** `node scripts/png-diff.mjs a.png b.png [--threshold 24] [--out diff.png]`:
  pixels that differ, their share and bounding box, the differences in red over a dimmed copy (exit 1
  when any differ). Traffic, rain and the HUD always differ a little: judge by where the box falls.

## Ready-made evals (`scripts/evals/`): start there

Each file's header lists its query options and what it returns.

| Eval | Use it for |
|---|---|
| `district-tour.js` + `?<kind>=1` | a milestone's look: stats + FPS first, then a road and an aerial shot of each structure kind and an overview. `&orbit=4` for gates and anything sized to its road; `&tourKinds=park,statue` tours city things with no district |
| `district-drive.js` + `?<kind>=1` | a district's driving: 5★ chase in under the first overhead gate (stuck cops listed), every gate at 30 m/s (one with no road behind it, on the island's edge, listed as skipped), each off-road drivable rect end to end (`hit` = stopped inside, `exit` = past it, `stuck` = never moved), up to 3 of `extra.tracks` steered end to end (`reached`, `strayed`). Use it instead of hand-written drive evals |
| `studio.js` + `?studio=…` | every new prop, vehicle, landmark or look, alone on a grey floor, before placing it (prop keys, `wreck-` prefixes, `~tint`, `lot:`, `mark:`, `car:`, `zone:`). Compiles its own programs: take `dbg.stats()` in another run |
| `perf-profile.js` | **after anything in the frame loop**: ms per system per frame, GPU ms, heap churn, calls, triangles, memory (`geometryHeapMB`: vertex copies still in the JS heap) over idle, cruise, a 5★ chase and a blast (a cop wrecked, the player destroyed; ends the run); per phase `newShaders` (compiled during play, from the eval's start: a stall the averages hide, should be none) and `worst frame ms` (one stall stays out of p99). `budget` must be all true. Reference: seed 9 `oldtown=1&chinatown=1&harbor=1`, with `--vs` ([OPTIMIZATIONS.md](OPTIMIZATIONS.md)) |
| `tri-breakdown.js` | **before choosing what to cull, merge or tile**: one cruising frame's calls and triangles per pass, and the meshes in view, biggest first |
| `gpu-ab.js` + `&ab=…` | **any GPU question** (a light, the shadow pass, a builder's meshes, a prop model, pixel ratio): switched on and off in one page, alternating; GPU, frame and render ms per state and how many paired rounds "off" won. `ab=pointLights\|spotLights\|shadowPass\|precipitation\|owner:<name>\|props:<prefix>` or `abExpr=<js>`; `at=x,z` or `at=focus` frames that spot first (`dist=`) |
| `cold-load.js` + `--make` | load time: the run's `cityLoadMs` is cold, the eval returns warm reloads of the same city. Shader compile changes show only cold |
| `mission-edges.js` + `&touch`, `--size 390x844`, no `--start` | anything on the first frames after Start, the touch controls or the end screen: controls laid out but unhittable until Start, share image built after the screen is up, Share waits for it and shares it, a quick Retry builds none. Pass/fail (`ok`, `failures`) |
| `restart.js` | `npm run check:restart`: Retry / New city leaks ([LEAKS.md](LEAKS.md)) |
| `city-reload.js` | `npm run check:reload`: a dump loads back as the same city, Retry keeps it, New city drops it |

Write a custom eval (in the scratchpad) only for drives and chases, from the helpers in the `window.dbg` table
below (`dbg.drive` already samples a drive and reports what stopped it):

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
| `city()`, `district(kind?)`, `find(kind)` | the `CityData`; a district (its `dressing`, `roles`, `gates`); a landmark/structure/prop/lot/`park`/`square` position. Any `{x, z}` works as a target for `view`/`aerial`/`aim` (a block's `rect`, a structure) |
| `view(point,{dist,wait})` | camera on a clear road spot near it (never place the car by hand) |
| `gate(i,{back,speed,lateral,kind})` | car outside gate `i`, facing in |
| `place(x,z,yaw,speed)`, `road(x,z)` | put the car; nearest road centre point |
| `near(x,z,r)` | what stands there, nearest first, roadworks included |
| `drive({from,yaw,speed,ms,police,snap})` | starts on the nearest road, holds W, samples position/speed/tilt, stops at a hit and lists what was there |
| `aerial(point,{dist,height,from,look})` / `aerial(false)` | overview camera (fog off) aimed `look` m above a point's ground; loop `from` to orbit |
| `aim(point,{dist,height,from,look})` / `aim(false)` | the game's own camera (fog and far plane as in play), for what's drawn far off or past the fog. `look` defaults to 20 m up: close up pass `look: 1` |
| `studio(names)` / `studioShot({focus,from,height,dist})` / `studio(false)` | model studio, HUD hidden |
| `hold(code,ms)`, `stars(n)`, `police(on)`, `repair()`, `sleep(ms)` | input, wanted level, cops on/off, full health |
| `ground(x,z)` | ground height there (a car's height over it: `game.player.position.y - dbg.ground(x, z)`) |
| `car()`, `stats()`, `fps(ms)` | position/speed; programs, calls, triangles, static triangles; FPS (capped at 60, shows only drops) |
| `sceneBreakdown()` | the scene by owner (`Game.owned` tags: city, props, districts…; player, cops, traffic): objects, how many three recomposes per frame (`auto`), meshes, instanced, shadow casters, and visible lights by type. First stop for a matrix, draw or light cost |
| `staleMatrices()` | frozen objects (`matrixAutoUpdate` off) moved without `updateMatrix()`, drawn where they were. Must be `[]` (in `perf-profile`'s budget and `check:restart`) |
| `cop(i)`, `wreckCop(i)` | the i-th nearest cop on duty as a point (+ dist, state) for `view`/`aim`; blow it up (fireball, flash) |
| `mixedMaterials()` | materials drawn by more than one kind of mesh (plain, instanced, instanced with colours), shadow pass included: each switches program every draw. Must be `[]` |
| `programLookups(ms)` | shader program lookups per frame by material; `[]` while driving, else `mixedMaterials()` usually says why |
| `focus(kind?)` | where a check should look: the URL's `focus=x,z,w,d` (`--vs-make` sets it), else the district's bounds |
| `follow(points,{speed,ms,ahead})` | drive along an off-road polyline (a track, a corridor), steering for a point `ahead` m on: `reached`, `strayed` (m off the line at worst), `trail`, `hit`. `drive` can't: it starts on the nearest road |
| `propMeshes(prefix)` | the props' instanced meshes whose model key starts with it (`tree-`, `fern`): what `gpu-ab`'s `ab=props:` hides |
| `dumpCity(download?)`, `loadCity(file)` | this run's params as text; restart in place with a params file ([CITY_PARAMS.md](CITY_PARAMS.md)) |

## What to check per milestone

On and off in one command: `--vs-make "nodistricts <same words>" --make "<kind> <same words>"`
(`?<kind>=0` alone lets the other districts roll in, so the two sides differ by more than the
district): views, `dbg.stats()` (programs must not grow), empty console; perf at phone size with `dbg.fps()`. Stills can't show flicker or feel: verify geometry, leave
feel to the user.

## Pitfalls

- **One run at a time per port.** Two runs share Vite's port and Chrome's debugger (port + 1000) and
  trade pages: one city's shots land in the other's folder and the other hangs. `browser-check.mjs`
  now waits for a run already on the port (lock file, `--wait-lock`); run checks one after the other,
  or give a second one its own `--port`. (`--vs` takes no lock itself: each side's run takes its own.)
- **Give every run a hard limit**, so a stuck one dies instead of holding the session (macOS has no
  `timeout`): `perl -e 'alarm 300; exec @ARGV' npm run check:browser -- …`. A run takes ~10 s plus
  the eval (`--vs` twice that); one that's slow has said why on stderr in its first lines
  ("port … busy (browser check pid …): waiting"): read them before waiting longer.
- To frame a spot a test or `npm run zfight` names: `?seed=N` builds the same city as
  `generateCity({ seed: N })`, so its x/z work in `dbg.aerial([x, z])`; in an eval, find the
  buildings by `dbg.city().buildings` (district, lot, h) rather than reading coordinates off a log.
- `--make` words without `seed=` start from a random seed: a check that must repeat passes one.
- Measure `dbg.stats()` **before** any `aerial()` (the overview turns fog off and every material
  recompiles: 35 read as 58; `stats()` warns) and before a drive breaks props (a first break can add one).
- Draw calls read a few high for a frame or two after any restart (Retry, New city, `loadCity`): compare
  the lowest of a few samples ~700 ms apart (`city-reload.js` does).
- `perf-profile.js` numbers swing with machine load (~15 % between runs; never with `npm run cops` or
  a test run going): compare sides run one after the other (`--vs` does), and run twice when they're
  close. Judge phones by `FRAME` ms at `--throttle 4`, not FPS. Small systems swing ±10–20 % with no
  change at all: judge `FRAME` and the big rows. GPU ms drifts between pages and creeps up within one:
  use `gpu-ab.js`, and trust 4/4 paired rounds, not a few % of mean.
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
- **`EVAL RETURNED NOTHING` in `logs`:** the eval gave back no value and threw nothing (a lost page
  context, a dropped promise, a missing `return`). The run proves nothing: rerun it (once a full
  `check:restart:nature` came back like this and passed on the rerun).
