# Optimizations

What open-world and racing games do to stay fast (research, part 1), what this game costs today
(measured 2026-10-31 on `main` d06d03b, part 2), and what to fix first (part 3).

## 1. How open-world and racing games are optimized

### Rendering: draw less

- **Draw-call budget.** Each draw call costs CPU time in the driver. A common web/mobile budget is
  ~100 calls per frame, a warning at 100–500 and trouble above 500. The usual fixes are instancing
  (`InstancedMesh`), batching (`BatchedMesh`) and merging static geometry, all of which need shared
  materials. [utsubo: 100 three.js tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- **Culling has to match how the data is grouped.** three.js frustum-culls each object by its bounding
  sphere. An `InstancedMesh` is tested as one sphere, so instances spread over a whole map are
  never culled. Split them into spatial groups, or use `BatchedMesh`, which culls per instance.
  [three.js forum: per-instance culling](https://discourse.threejs.org/t/ideas-on-performing-fast-per-instance-frustum-culling-on-instancedmesh/85156)
- **World partition and streaming.** Open worlds cut the map into tiles or cells that load, draw and
  simulate only near the player. Their far LOD is often merged into one mesh per tile (HLOD).
  Occlusion culling helps less than you would expect for a camera above the streets.
  [Sons of Ryke: optimizing an open world](https://alpaca-sponge-wsff.squarespace.com/sons-of-ryke/optimizing-an-open-world-1),
  [Unigine optimization docs](https://developer.unigine.com/en/docs/2.17/learn/10_optimization/2)
- **LOD and impostors.** Distant objects get simpler meshes, and the last LOD is often a flat
  billboard impostor. Vehicle speed hides LOD pops, so racing games can switch levels aggressively.
  [Simplygon: vehicle LODs for racing games](https://developer.microsoft.com/en-us/games/articles/2025/12/level-of-detail-vehicle-models-simplygon/),
  [Simplygon: impostors](https://simplygon.com/posts/ed74d543-7ebd-493f-b9b0-f83c3249b3fe)
- **Fog as a draw distance.** Past full fog, nothing is visible. Distance culling, or a camera `far`
  at the fog end, removes it without changing the image.
- **Shadows.** Shadows are usually the second-largest cost after the main pass. Typical fixes: a tight
  shadow frustum that follows the camera, only casters that matter, maps of 512–1024 on mobile and
  1024–2048 on desktop, cascades for the sun, and static shadows not re-rendered every frame (on
  phones the gain can be small).
  [three.js forum: shadowMap.autoUpdate](https://discourse.threejs.org/t/renderer-shadowmap-autoupdate-false/50401),
  [three.js forum: render the shadow map once](https://discourse.threejs.org/t/how-to-render-shadow-map-one-time/7176)
- **Shaders and lights.** Each light in a forward renderer is a loop iteration in every lit pixel.
  Keep the light count constant, so it doesn't recompile, but small. Fake small lights with emissive
  surfaces, sprites or light pools. Share materials so programs are reused.
- **Static scene graph.** Set `matrixAutoUpdate = false` on objects that never move, so three doesn't
  recompute their matrices every frame. (utsubo)
- **Textures.** KTX2/Basis textures stay compressed on the GPU (4–8× smaller). Keep mipmaps on for
  anything seen from far away, and use atlases to cut texture binds. (utsubo)

### Simulation: simulate less

- **AI and traffic LOD.** Cars far from the player update their steering and sensing less often and
  can drop full wheel physics for kinematic spline following, switching back as they come closer.
  [bugnet: traffic AI density tanking frame rate](https://bugnet.io/blog/how-to-fix-traffic-ai-density-tanking-frame-rate),
  [BeamNG forum: simplified traffic physics](https://www.beamng.com/posts/1356458)
- **Population budget around the player.** GTA-style games spawn traffic and pedestrians in a circle
  around the player, despawn them out of view, and scale density with hard caps, per platform, by
  time of day. The mobile ports cut density by up to 60%.
  [GTA SA DE spawn distance mod](https://www.nexusmods.com/grandtheftautothetrilogy/mods/151),
  [Vice City mobile density](https://libertycity.net/files/241950-traffic-spawn-density-mobile.html)
- **Physics.** The cost grows with active bodies. Let bodies sleep, and never touch a sleeping body
  every frame, since that wakes it. Time `world.step()` on its own. Rapier can run in a worker.
  [abratabia: physics performance](https://abratabia.com/game-physics/physics-performance.php)

### JavaScript: allocate less

- **GC pauses are frame hitches.** Look for a sawtooth heap pattern in the profiler. Reuse
  temporaries such as vectors and quaternions instead of returning new objects, pool short-lived
  objects (debris, sparks, scratches), and avoid closures and string building inside the frame.
  [bugnet: web game GC stutters](https://bugnet.io/blog/how-to-fix-web-game-stutters-from-garbage-collection),
  [html5gamedevs: avoiding GC](https://www.html5gamedevs.com/topic/45482-best-practices-objectmemory-management-to-avoid-gc/),
  [abratabia: memory management](https://www.abratabia.com/web-game-performance/memory-management.php)
- **Shader compiles.** Compile up front with `compileAsync`. In production, turn off
  `renderer.debug.checkShaderErrors`: reading the info log forces a synchronous wait on every compile.

## 2. Measurements

**Setup:** headless Chrome on the dev Mac (Apple GPU), `seed=9&debug&oldtown=1&chinatown=1&harbor=1`.
The city has 30 civilian cars, 5★ brings 6 cops, and there is precipitation. Three phases: idle,
police-off cruise and 5★ chase, each 3–7 s.

**Tools:**
- `scripts/evals/perf-profile.js` (committed): CPU ms per subsystem, GPU ms, heap churn, draw
  calls, triangles, memory.
- A scratch copy of `browser-check.mjs` that adds the CDP sampling CPU profiler, the sampling heap
  profiler and `Emulation.setCPUThrottlingRate`.
- Small scratch evals for triangles per pass, prop visibility, shared materials and textures.

"Phone" below means 390×844 with a 4× CPU throttle, which stands in for a mid-range phone's CPU
(not its GPU).

### Frame time

| | Desktop | Phone (4× CPU) |
|---|---|---|
| FPS / frame gap p99 | 60 / 19 ms | 60 / 20–24 ms |
| JS frame (`Game.frame`) | 3.4–3.8 ms | 10.9–12.2 ms (of a 16.7 ms budget) |
| `renderer.render` (CPU side) | 1.8–2.0 ms | 5.6–5.9 ms |
| …of which shadow pass | 0.45–0.49 ms | 1.6–1.7 ms |
| `world.step` (Rapier) | 0.31–0.34 ms | 0.97–1.0 ms |
| `vehicle.drive` ×31–34 | 0.27 ms | 0.95–1.16 ms |
| `CivilianController.update` ×30 | 0.22–0.27 ms | 0.79–1.17 ms |
| `GlowBatch.update` | 0.18–0.20 ms | 0.51–0.54 ms |
| `vehicle.syncMesh` ×31–34 | 0.13–0.15 ms | 0.38–0.46 ms |
| everything else (HUD, minimap, props, director…) | < 0.06 ms each | < 0.2 ms each |
| GPU time per frame (timer query) | 2.9–3.7 ms | 1.7–2.4 ms |

On a phone the CPU is close to the budget, and half of it is three.js preparing draws, not game
logic. The CPU profile at 4× has the main thread idle only 25% of the time. The top self-time items
are `getParameters`/`getProgram`/`getProgramCacheKey` (6.4% together), `updateMatrixWorld` and
`multiplyMatrices` (5.6%), and `Precipitation.update` (1.7%).

### Draw calls and triangles

- **Totals:** 330–430 draw calls and **1.8 M triangles per frame**. The main pass is 222 calls and
  1.28 M triangles; the shadow pass is 116 calls and 0.52 M triangles. The scene holds 0.54 M
  static triangles in plain meshes.
- **Instanced props are the biggest item:** 762 k triangles in 59 calls (main pass), all of them shadow
  casters. `PropSystem` keeps one city-wide `InstancedMesh` per model with `frustumCulled = false`,
  and so do 83 instanced meshes in all.
- **Most of those props can't be seen:** of 12 376 instances (814 k triangles), only 3 916 are within
  the fog end (336 m), and only **1 308 instances (87 k triangles, 11%)** are both within the fog end
  and in view.
- **Fog vs. far plane:** the camera `far` is 1200 m and the fog is solid from 336 m, so everything
  between 336 and 1200 m is drawn in plain fog colour.
- **Buildings:** 275 k triangles in 74 calls, plus 143 k for vertex-coloured merged meshes. Buildings
  are one merged mesh per facade style for the whole city, so frustum culling almost never drops one.
- **Sun shadow:** a 2048² map over 250×250 m that follows the car; 404 meshes cast shadows (593 k
  triangles).

### Allocation (GC)

The heap grows by **29–38 MB/s** with about 1.3 garbage collections per second, even while idle.
No GC pause showed up in p99 on desktop, but on a phone each collection is a likely hitch.
Sampling heap profile over 18 s of driving, top 50 sites, 302 MB in all:

| Source | MB | Cause |
|---|---|---|
| three `getParameters`, `getProgramCacheKey`, `join` | **80** | **3 materials are shared between an `InstancedMesh` and a plain `Mesh`.** three keys programs on `instancing`, so each time it alternates between them it rebuilds the program parameters and cache key. This happens every frame. |
| Rapier getters (`translation`, `linvel`, `angvel`, `rotation`, FinalizationRegistry `register`) | 53 | Each call returns a new JS object, registered for finalization. `Vehicle.ts` has 21 such calls, run per car per step (`drive`, `snapshot`, `softDrag`, `assistTraction`, `grounded`…), plus `CivilianTraffic.forwardObstacle`. |
| three uniform `setValueM4` / `setValueV3f` / `setValueM3` | 53 | Probably inlined callers. Measure again after the material fix, since program switches re-upload every uniform. |
| `CivilianController.update`, `trafficDue`, `forwardObstacle`, `districtLimit`, `cruiseFor`, `signal` | ~30 | Small per-car objects every step: destructured `[ux, uz] = [...]` pairs, `{x, z}` results, `awareness.movers()`. |
| `Vehicle.updateLights`, `syncMesh` | ~14 | Runs per car per frame. |
| `PropSystem.updateSignals` | 4 | |
| `NavGrid.findPath`, `RoadGraph.pathAvoiding` | 4.5 | Only while cops replan. |

The shared materials (`MeshStandardMaterial`, white, `vertexColors`):
- **A:** used by 5 plain meshes in a group and 6 instanced meshes (counts 1–10). This is likely
  `Landmarks.ts` `solid`, which is used for both `InstancedMesh` and `Mesh`.
- **B:** used by 2 instanced meshes (count 4, 36 vertices) and 1 merged mesh. This matches
  `OldCity.ts` `metal` (`InstancedMesh(g, metal, 4)`).
- **C:** used by 3 merged meshes and 4 instanced meshes (count 2). Likely `HarborQuay.ts` `material`.

### Lights

The scene has 67 lights, but only these enter the shader light loop:
- the hemisphere light and the sun;
- **3 `PointLight`s that are always on at intensity 0:** the two siren lights and the crash flash;
- the visible headlight `SpotLight`s.

Every lit pixel loops over all of them, even at intensity 0. Keeping the count fixed is deliberate:
changing it recompiles every material.

### Memory

| Item | Size |
|---|---|
| JS heap after GC | 107–123 MB |
| Geometry (one copy on the GPU, one kept in the JS heap) | 31 MB, 398 geometries |
| Textures (estimate) | ~60 MB, 47 textures |
| Rapier | 136 bodies, 1 937 colliders |
| Scene | 1 042 objects, all with `matrixAutoUpdate = true` |

- **Textures:** the largest are a 1024×2048 canvas facade atlas (11 MB, 10 users), a 1024² canvas
  (5.6 MB, 28 users), the PMREM environment map (3 MB) and a set of 512² district sign maps.
- **Rapier:** the colliders are cheap; `step` takes 0.3 ms.
- **Verdict:** memory is not a problem today. The one easy saving is the geometry arrays kept in the
  JS heap after upload.

### Load

- **Time:** `dbg.loadCity` of the same city takes 0.78–0.89 s. `generateCity` and `buildCity` are about
  9% each, `NavGrid` 3%, districts 5%.
- **Shader compile wait:** **`getProgramInfoLog` is 9% of load CPU.** It is three's
  `checkShaderErrors`, waiting synchronously on each compile.

## 3. What to fix, ranked by gain per effort

1. **Stop the per-frame program lookups (small, safe).** Give the instanced users of `Landmarks`
   `solid`, `OldCity` `metal` and `HarborQuay` `material` their own material (`.clone()`), and check
   the other `InstancedMesh(…, sharedMat)` sites (`Slums.ts` `instanced` and `material`,
   `containers.ts`). This removes ~27% of the heap churn and ~6% of phone CPU.
   - **Programs:** the count should stay the same, since both variants are already compiled.
     Confirm with `dbg.stats()`.
   - **Guard:** add a guard in `npm run check:restart` or a unit test that walks the scene and fails
     when a material has both instanced and plain users.
2. **Cull instanced props spatially (medium, biggest GPU/CPU win).**
   - **The change:** split each `PropSystem` model's `InstancedMesh` into tiles (e.g. 4×4 blocks, or
     the existing district rects) with real bounding spheres and `frustumCulled = true`. Or, every
     ~10 frames, compact the instances within `fog.far` into the front of the buffer and set `count`.
   - **Gain:** ~89% of prop triangles are invisible, so the main pass drops from 1.28 M to roughly
     0.6 M triangles.
   - **Shadow pass:** three culls shadow casters against the shadow camera, so it shrinks once props
     are tiled.
   - **Constraints:** keep one material and one program, and keep prop ids stable for breakage
     (`PropSystem` maps prop → mesh/index). The tile choice is render-only, so seeds don't move.
3. **Match the far plane to the fog (tiny).** Set `camera.far` to about `fog.far + 20` while driving;
   the overview camera and the sky dome need their own `far`. This only helps culled objects, so it
   pays off once items 2 and 4 are done.
4. **Tile the merged buildings (medium).** One merged mesh per facade style *per tile* instead of per
   city. This keeps the CLAUDE.md rule (no mesh per lot, shared materials) and lets frustum and
   distance culling drop most of the 418 k building triangles. It costs a few more draw calls per
   visible tile.
   - **How to size tiles:** pick a size that keeps calls ≤ today's (~220 main pass) after props
     shrink.
   - **Tests:** `BuildingGeometry.test.ts` snapshots will change (intended) if the merge order changes.
5. **Cut the Rapier getter churn (small).**
   - **The change:** in `Vehicle.snapshot()`, read `translation`/`rotation`/`linvel`/`angvel` once
     per step into reused fields, and have `drive`/`softDrag`/`assistTraction`/`grounded` and
     `forwardObstacle` read those fields.
   - **Gain:** most of the 53 MB, and fewer wasm calls.
   - **Check:** `npm run cops -- --vs main` and the physics tests, since read timing within a step
     must not change.
6. **Traffic LOD (medium).** With 30 civilians and full raycast-vehicle physics, `drive`, controller
   and `syncMesh` cost ~2.5 ms per phone frame.
   - **Mid range:** cars beyond ~150 m and out of view update their controller every 2nd–4th step
     (staggered).
   - **Far:** cars beyond the fog can sleep, or be despawned and respawned near the player
     (`CivilianTraffic` already has a target count).
   - **Phones:** scale `TRAFFIC.count` like GTA's mobile ports.
   - **Check:** `npm run cops` for cop-civilian interactions.
7. **Freeze the static scene graph (small).** After the build, set `matrixAutoUpdate = false` and
   `matrixWorldAutoUpdate = false` on static roots (city meshes, districts, landmarks, instanced
   props), after one `updateMatrixWorld()`. This removes most of `updateMatrixWorld` and
   `multiplyMatrices` (5.6% of phone CPU). Moving things (cars, cops, effects, roadworks animation,
   debris) stay automatic. `GlowBatch.update` calls `car.root.updateMatrixWorld()` again for each car
   after the loop already did, so that call can go once the order is guaranteed.
8. **Precipitation on the GPU (small).** Move the fall/wrap math from the 9 200-particle CPU loop into
   the vertex shader: a `time` and `center` uniform, `mod()` wrapping, and a static buffer. This
   removes 1.7% of phone CPU and the per-frame buffer upload.
9. **Turn off shader error checks in builds (one line).**
   `renderer.debug.checkShaderErrors = import.meta.env.DEV` saves ~9% of load CPU and avoids sync
   stalls whenever a late program compiles (first break, fog-off overview, night lights).
10. **Lights (small, phones).**
    - **Sirens:** drop the always-present siren `PointLight`s. The siren glow already exists as sprites
      and glows, and a light pool decal under a cop (like the lamp pools) reads the same. Or keep one
      shared siren light on the nearest cop.
    - **Crash flash:** fake it with an emissive or sprite effect.
    - **Gain:** each removed light is one less loop iteration in every lit pixel. Measure GPU ms at
      phone size before and after.
11. **Shadow map (measure first).**
    - **Map size:** try 1024² on phones (half the 250 m width there, since the camera sees less).
    - **Static shadows:** keep them in a separate rarely-updated map. Probably not worth the
      complexity until items 2 and 4 are done.
12. **Free uploaded geometry arrays (small, memory).** For static merged meshes that nothing reads
    back (no raycast, no collider build, no `dumpCity`), call
    `attribute.onUpload(function () { this.array = null; })`. This saves up to ~30 MB of heap.
    - **Check first:** debug tools (`dbg.near`, `stats().staticTris`) and the restart/gpuTrace checks
      must not need the arrays. `staticTris` reads `index.count` and still works.

**Re-measure** after each item with the same seed and words:
- `npm run check:browser -- --query "seed=9&debug&oldtown=1&chinatown=1&harbor=1" --start 2000
  --no-final --eval-file scripts/evals/perf-profile.js`, plus `--size 390x844`.
- Compare `per`, `allocMBperSec`, `render.calls/triangles` and `gpuMsPerFrame`.
- On phones, judge by the JS frame ms, not FPS: headless desktop holds 60 either way.
