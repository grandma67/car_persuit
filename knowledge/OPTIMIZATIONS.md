# Optimizations

Where the frame goes, what was done and learned, how to measure, what's open. Triangles per model:
[POLYGONS.md](POLYGONS.md). Tools in full: [BROWSER_CHECKS.md](BROWSER_CHECKS.md). The rules these
fixes left behind (one material per mesh kind, manual matrices, one point light, vehicle state reads)
are in `CLAUDE.md`, Architecture.

## Where it stands

`perf/runtime` (M1–M4, merged `a4b027a`), measured with `perf-profile.js` on the reference city
(`seed=9&debug&oldtown=1&chinatown=1&harbor=1`, 30 civilians, 6 cops at 5★), cruising. Phone = 390×844
at `--throttle 4`: a mid-range phone's CPU, not its GPU. Each column against the one before with `--vs`.

| | Start (ac1e4c8) | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| Phone `FRAME` | 11.5 ms | 9.5 | 8.0 | 6.8 | ~6.8 |
| Phone `renderer.render` / shadow pass | 5.9 / 1.6 ms | 4.6 / 1.0 | 3.9 / 0.8 | 3.4 / 0.8 | same |
| Phone civilians (controller + `syncMesh` + glows) | 2.5 ms | | 1.2 | 0.5 | same |
| GPU ms (point lights on → off, same page) | | | | | desktop 2.35 → 2.08, phone 1.79 → 1.56 |
| Garbage (desktop) | 30 MB/s, 1.4 GC/s | 16, 0.6 | 16 | 15 | same |
| Triangles per frame (main pass) | 1.79 M (1.28 M) | same | 1.10 M (0.80 M) | same | same |
| Calls / programs | 327 / 37 | 327 / 34 | 308 / 34 | 308 / 34 | 308 / 34 |
| JS heap after GC / geometry kept in it | 107–123 / 31 MB | | | 101 / 30 | 87 / 16 |
| Cold load of a new look (`loadCity`) | | | | 645 ms | 622 ms |

Then `perf/polygons` (merged `1549da4`): scene 924 k → 746 k triangles (`POLYGONS.md`). 5★ chase phone
frame after M3: 7.1 ms. Physics is not the cost: `world.step` ~1 ms on a phone ([RAPIER.md](RAPIER.md)).
Rapier held 136 bodies and 1 937 colliders at the start; memory is not a problem.

**What was done:**
- M1, garbage: no mixed materials, Rapier reads once per step (`vehicle.vel`, `.spin`), fewer traffic
  AI allocations, no per-frame arrays in `Game.frame`. `perf-profile` budget: cruise ≤ 21 MB/s.
- M2, draw less: props packed (each model's instances within fog end + 30 m copied to the front of its
  buffer and `count` cut, repacked every 20 m of camera travel; one draw per model); far plane at the fog end.
- M3, CPU: traffic LOD (past 120 m from the player and every cop a civilian thinks every 3rd step,
  off-screen ones hold their pose and skip matrices), manual matrices, precipitation in the vertex shader.
- M4: shader error checks off in builds, one shared point light (3 → 1), the city's vertex arrays freed
  after upload.

## How to measure

**Measure before choosing: the plan's guesses were wrong in every milestone.**

| Question | Tool |
|---|---|
| The numbers, compared | `check:browser --vs <branch-start> --table … --eval-file scripts/evals/perf-profile.js` (`per`, `allocMBperSec`, `gcPerSec`, `budget`, `render.calls/triangles`, `gpuMsPerFrame`, `memory`) |
| What the scene is | `dbg.sceneBreakdown()`: objects per owner, recomposed per frame, shadow casters, lights in the shader loop |
| A GPU cost | `gpu-ab.js` (`ab=pointLights\|shadowPass\|owner:<name>\|props:<prefix>`, `abExpr=`): on/off alternating in one page, paired rounds; separate pages drift more than most changes |
| Load time | `cityLoadMs` (any `--make`/`--city` run, cold), `cold-load.js` (warm reloads). The browser caches shaders: only a cold load shows a compile cost |
| Phones | `--size 390x844 --throttle 4` and `&touch`, or it runs the desktop settings at phone size. Judge `FRAME` ms, not FPS |
| Triangles and calls | `tri-breakdown.js` (per pass, biggest meshes in view) |
| CPU and garbage | `--profile f.json` (CPU and heap sampling), with `--throttle 4` for a phone's CPU |
| Program lookups | `dbg.programLookups()` (`[]` while driving), `dbg.mixedMaterials()` (`[]`) |
| Looks | both sides of `--vs`, `node scripts/png-diff.mjs`; far off `dbg.aim(point, {dist, height})`, close up `look: 1`; `dbg.cop(i)`, `dbg.wreckCop(i)` |

Noise: runs swing ~15 % with load, small systems ±10–20 % with no change: read `FRAME` and the big rows,
run twice when close, compare the cruise phase, never with `npm run cops` or tests going.

**Every perf task ends with:** `npx tsc --noEmit`; area tests, `npm run t` once per milestone;
`npm run hash -- --vs HEAD` (render and runtime work: a moved seed is a bug); `dbg.stats().programs` the
same or lower, read before any `aerial()`; `npm run check:restart` after adding or splitting meshes or
materials; `perf-profile.js` with `--vs <branch-start>` (`budget` all true, result in the commit body);
a shot pair through `--vs` if what's drawn changed.

## What was learned

- **Program lookups had three causes.** Plain/instanced pairs (Landmarks, OldCity, Harbor) were small.
  The bulk: one prop material on 48 `InstancedMesh`es with only the tinted ones using `instanceColor`
  (three keys programs on `instancingColor` too), and **three's single shadow depth material**, shared
  by every caster without a `customDepthMaterial` (~29 lookups a frame). Fixes: every prop model gets
  (white) instance colours; `separateInstancedShadows`.
- **Hot per-car code allocated through `for…of` and destructuring**, not only Rapier getters:
  `updateLights` and `syncMesh` left the heap profile once their loops were indexed.
- **What's left of the garbage** (~16 MB/s): three's WebGL uniform calls (per draw; the allocation is in
  the browser's bindings, only fewer draws cut it) and Rapier's getters (4 per car per step in
  `snapshot`, 2 after `updateVehicle`). Swapping three's uniform caches for typed arrays didn't help.
- **Tiling multiplies draw calls; phones pay for calls.** Hence packed props. **Building walls are
  cheap** (~5k triangles in view: textured quads): tiling them added ~30 calls for 0.1 M triangles and
  was dropped. The main pass's bulk is two city-wide meshes (154k and 100k) and props within the fog.
- **The far plane at the fog end** needed the sky dome scaled inside it and the destination beam's depth
  held inside it (it's meant to show past the fog).
- **Matrix work was the cars, not the scenery:** ~1 100 of ~1 400 objects are car parts (~35 a car, 6
  move), and a root that recomposes forces every world matrix under it. `updateMatrixWorld` 3.9 → 1.6 %
  of phone CPU. Only city and props are frozen: districts, landmarks and roadworks animate parts.
- **Traffic LOD saves less than its call count:** forward rays already ran every 3rd step (controller
  0.53 → 0.44 ms). Despawning past the fog wouldn't help: the target count respawns them.
- **Idle lights cost real GPU time:** three point lights at intensity 0 were ~12 % of the GPU frame. One
  shared light now serves the nearest cop's siren and a blast (its flash outshines it); the
  second-nearest cop loses its glow.
- **Shader error checks cost little once warm:** −3.5 % on a cold load of a new look, not the 9 % the
  load profile suggested.
- **Phones already had a 1024² shadow map;** 90 m instead of 125 m saved 0.04 of 0.66 ms: dropped.
- **Geometry arrays:** the city's merged meshes drop their JS copy once uploaded (bounding spheres
  computed first), 14 MB. District and landmark meshes keep theirs (the Slums re-merges its wires as
  poles fall; the rest wasn't audited).
- **Cop metrics can't prove a refactor exact** (±10–20 %): two runs giving identical numbers did. For a
  change that does move them, `npm run cops -- --samples 2` shows the noise.

## Open

- Triangles: fences, roofs and trims, sidewalks and paint (`POLYGONS.md`, "Where to cut next").
- Fewer civilians on phones: the frame is at ~40 % of budget, and it's a gameplay call. No quality tier
  exists; `carShadowCull` already detects phones.
- Static shadows in a rarely updated map: only if the shadow pass becomes a top item again (usually
  small gains on phones).
- Audit district and landmark meshes for `releaseAfterUpload`.
- One-off stalls at the mission's edges, none while driving (11-06, Mac; desktop / `--throttle 4` at phone
  size; a real phone may differ). Time Enter with `--query`: a `--make` city has its audio context already.
  Enter: `new AudioContext()` ~70 ms at any CPU speed (`CarAudio.init`, also on an earlier menu gesture).
  Touch controls' first paint: 45 / ~170 ms of the browser's rendering, no game code; not the blur; ~3/4 gone
  with their text at size 0 (fallback fonts for the arrows? one run). Unhiding them on the menu moved all of
  it there. End screen, 36 / 65 ms: `RunMap.image`, the share card, 21 / 32 ms of it, built even if unused.
  First cop: one 28–41 ms frame on the throttled phone (`director.update` 20 ms, `create` 2 ms, rest not traced).
- Not tried, from how other games do it: KTX2/Basis textures (largest today: 1024×2048 facade atlas
  11 MB, a 1024² canvas 5.6 MB, PMREM 3 MB; ~60 MB in all), impostors or LOD for far props
  (`BatchedMesh` culls per instance), Rapier in a worker.

## Background: how open-world and racing games stay fast

- **Draw calls:** web/mobile budget ~100, trouble above 500; instancing, batching, merging need shared
  materials. Culling must match grouping: an `InstancedMesh` is tested as one sphere.
  [utsubo: 100 three.js tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips),
  [per-instance culling](https://discourse.threejs.org/t/ideas-on-performing-fast-per-instance-frustum-culling-on-instancedmesh/85156)
- **Partition and LOD:** cells loaded and drawn near the player, far LOD merged per tile (HLOD),
  impostors; vehicle speed hides LOD pops; occlusion culling helps less above the streets.
  [Unigine](https://developer.unigine.com/en/docs/2.17/learn/10_optimization/2),
  [Simplygon vehicle LODs](https://developer.microsoft.com/en-us/games/articles/2025/12/level-of-detail-vehicle-models-simplygon/)
- **Shadows** are usually the second cost: tight frustum following the camera, only casters that
  matter, 512–1024 on mobile. **Lights:** each is a loop iteration in every lit pixel; constant count, small.
- **Simulation:** far cars update less often or go kinematic; population budget in a circle round the
  player (GTA's mobile ports cut density up to 60 %); let bodies sleep and don't touch them.
  [bugnet: traffic AI](https://bugnet.io/blog/how-to-fix-traffic-ai-density-tanking-frame-rate)
- **GC pauses are hitches:** reuse temporaries, pool short-lived objects, no closures or strings in the
  frame. [bugnet: GC stutters](https://bugnet.io/blog/how-to-fix-web-game-stutters-from-garbage-collection)
