# Optimization tasks

Step-by-step tasks for the fixes in `OPTIMIZATIONS.md`, which holds the research, the measurements and
the reasons behind them. The tasks fall into four milestones on one branch, `perf/<topic>`, per the
working rules: one commit per milestone, then stop for approval before merging.

## Before anything: the baseline

Every task is judged against the branch's start. `--vs <ref>` runs the same check there (its own
worktree and Vite, so your edits can't hot-reload into the baseline) and then on the working tree:

```sh
npm run check:browser -- --vs <branch-start> --query "seed=9&debug&oldtown=1&chinatown=1&harbor=1" \
  --start 2000 --no-final --eval-file scripts/evals/perf-profile.js > <scratchpad>/desktop.json
# phone: --size 390x844 --throttle 4
```

Read from `base` and `current`:
- `per` (ms per frame for each system); on phones judge by `FRAME` ms, not FPS;
- `allocMBperSec`, `gcPerSec` and `budget`;
- `render.calls` and `render.triangles`, `gpuMsPerFrame`, `memory`.

Wall time swings with machine load: compare the cruise phase, and run twice if the numbers are close.

### Measure before choosing (the plan's guesses were wrong in every milestone)

- **The numbers, compared:** `--table` with `--vs` prints perf-profile as one Δ% table (full JSON
  beside it). Small systems swing ±10–20 % run to run with no change: read `FRAME` and the big rows.
- **What the scene is:** `dbg.sceneBreakdown()`: objects per owner, how many three recomposes each
  frame, shadow casters, the lights in the shader loop. (M3's plan blamed static scenery; 70 % of the
  objects were car parts.)
- **A GPU cost:** `scripts/evals/gpu-ab.js` (`ab=pointLights|shadowPass|owner:<name>` or `abExpr=`):
  on/off alternating in one page, with paired rounds. Separate pages drift more than most changes.
- **Load time:** `cityLoadMs` (any `--make`/`--city` run, cold) and `scripts/evals/cold-load.js`
  (warm reloads of it). The browser caches shaders: only a cold load shows a compile cost.
- **Phones:** `--size 390x844 --throttle 4` and `&touch`, or the desktop settings run at phone size.
- **Where triangles and calls go:** `scripts/evals/tri-breakdown.js` (per pass, biggest meshes in view).
- **Where CPU and garbage go:** `--profile <file.json>` (CPU and heap sampling around the eval; top
  self time and bytes per function), with `--throttle 4` for a phone's CPU.
- **Program lookups:** `dbg.programLookups()` (expected `[]` while driving).
- **Looks:** shots from both sides of `--vs`, compared with `node scripts/png-diff.mjs`; the game's own
  camera far off with `dbg.aim(point, {dist, height})`, close up with `look: 1`; a cop with
  `dbg.cop(i)`, a blast with `dbg.wreckCop(i)`.

## Checks every task ends with

- `npx tsc --noEmit`, plus the area tests while editing and `npm run t` once per milestone.
- `npm run hash -- --vs HEAD`: no city may move. These tasks are render and runtime only, so a moved
  seed is a bug.
- `dbg.stats().programs` the same as before or lower, measured before any `aerial()`.
- `npm run check:restart` after anything that adds or splits meshes or materials. Each new
  material or geometry must still be freed by `Game.dispose()`.
- `perf-profile.js` again with `--vs <branch-start>` (`budget` all true). The result goes in the
  commit body.
- Anything that changes what's drawn: a shot pair through `--vs`, diffed with `png-diff.mjs`.

---

## Milestone 1: less garbage (GC)

**Done** (`febe8ac`): 30 → 16 MB/s, phone frame 11.5 → 9.5 ms. Under 10 MB/s wasn't reached (what's
left: `OPTIMIZATIONS.md` section 4), so the budget is ≤ 21. 1.1 found two more causes than listed
(instance colours, the shadow pass's depth material).

Goal: cut `allocMBperSec` from ~30–38 to under ~10 while cruising.

### 1.1 Separate the materials shared between instanced and plain meshes

**Why:** three.js builds a different shader program depending on whether a mesh is instanced. When
one material is drawn on both kinds, three rebuilds the program parameters and the cache key on
every switch, every frame. That accounts for ~27% of all garbage and ~6% of phone CPU.

**Where (measured):**
- `src/render/Landmarks.ts`: `solid` is used by the per-landmark `THREE.Mesh` (~line 474) and by the
  repeated-landmark `InstancedMesh` (~line 494). `metal` likely has the same problem through
  `addRamp`; check it.
- `src/render/districts/OldCity.ts`: `metal` is used by the clock's `InstancedMesh(g, metal, 4)`
  (~line 322) and by the merged iron `Mesh` (~line 377).
- `src/render/districts/HarborQuay.ts`: `material` is used by the merged meshes, the ship and the
  mooring lines (`Mesh`), and by the `InstancedMesh(geo, material, n)` (~line 335).

**Steps:**
1. At each site, make a second material for the instanced users, e.g.
   `const solidInst = solid.clone()`, and pass it to the `InstancedMesh`. Keep the plain meshes on
   the original.
2. Check that both materials are reachable by `disposeScene` (they are, if they're on meshes in the
   scene) and that `gpuTrace.orphans` stays clean.
3. Look for other sites:
   ```sh
   grep -rn "InstancedMesh(" src | grep -v "\.test\."
   ```
   For each, check whether the material variable is also given to a `new THREE.Mesh`. Already
   separate: `Slums.ts` (`instanced`), `PropSystem` (its own `material`), `containers.ts`
   (`snowMat`).
4. **Guard against it coming back:** add a check in `scripts/evals/restart.js`, or a small debug
   helper `dbg.mixedMaterials()` that `perf-profile.js` returns. It walks `game.scene` and lists
   every material with both an `InstancedMesh` user and a plain-mesh user. The expected list is
   empty: fail the check if it isn't.
5. **Measure:**
   - `getParameters`/`getProgramCacheKey` should leave the heap profile;
   - `allocMBperSec` should drop by roughly a quarter;
   - `programs` should be unchanged. Both variants were already compiled; the flip only moved
     between them.

### 1.2 Read Rapier body state once per step

**Why:** every `body.translation()`, `rotation()`, `linvel()` and `angvel()` call creates a JS object
and registers it with a `FinalizationRegistry`. `Vehicle.ts` makes 21 such calls, run per car per
step: ~53 MB per 18 s, ~18% of the garbage.

**Steps:**
1. In `Vehicle`, add reused fields next to `currPos`/`currQuat`:
   `readonly vel = new THREE.Vector3()` and `readonly spin = new THREE.Vector3()`.
2. In `snapshot()` (~line 568), which runs right after `world.step()`, read the four getters once and
   fill `currPos`, `currQuat`, `vel` and `spin`.
3. Replace the reads in the methods that run between two steps with the fields:
   - `drive` and its helpers: `updateBody`, `assistTraction`, `softDrag`, `potholeJolt`;
   - the getters: `speed`, `lateralSpeed`.

   They see the state after the last step, which is what they see today.

   **The catch:** code that calls `applyImpulse` and then reads `linvel()` in the same step sees the
   new velocity today. Grep `applyImpulse\|setLinvel\|setAngvel` in `Vehicle.ts` and keep a live
   read after any write, or update the field by hand.
4. Fix `get grounded()`. `[0, 1, 2, 3].some((i) => …)` creates an array and a closure on every call;
   use a plain `for` loop.
5. In `CivilianTraffic.sampleMovers` (~line 238), read `vehicle.vel` and `vehicle.currPos` instead of
   `b.linvel()`/`b.translation()`.

   This reads the same step's values: `traffic.update` runs after the step loop and after
   `snapshot()`.
6. In `forwardObstacle` (~line 170), the blocker is a Rapier body (`blocker.parent()`). Look its
   `Vehicle` up by handle (the traffic already keeps a handle set) and read its fields. Keep the
   getters for bodies that aren't vehicles.
7. **Tests:**
   - the vehicle and traffic unit tests;
   - `npm run cops -- --vs main`. The metrics should match within noise; a shift means a read moved
     across a write.
8. **Measure:** `register`, `linvel`, `translation`, `angvel` and `rotation` should leave the top of
   the heap profile.

### 1.3 Stop the traffic AI allocating per car per step

**Why:** `CivilianController.update` and its helpers (`trafficDue`, `districtLimit`, `cruiseFor`,
`signal`, `takeTurn`) plus `CivilianTraffic.forwardObstacle` create ~30 MB per 18 s.

**Steps:**
1. Replace destructured pairs like `const [ux, uz] = [a, b]` with two `const`s. V8 doesn't always
   optimize the array away.
   ```sh
   grep -n "const \[.*\] = \[" src/ai/*.ts
   ```
2. Give helpers that return `{ x, z }` (`extend` in `CivilianTraffic.ts` and the like) an `out`
   parameter, and pass a module-level scratch object. Be careful only where a result is stored
   (in a route, a claim or `best`): those must stay fresh objects.
3. Have `sampleMovers` reuse its list:
   - keep `this.moverList` and a pool of `Mover` objects;
   - set `list.length = 0` and refill the pooled objects instead of pushing new literals;
   - do the same with `forwardObstacle`'s `best` result: one reused object per caller, reset on use.
4. Check any `.filter`/`.map`/`.some`/`.find` with an arrow in the per-step path, and turn those into
   loops. `rampTruck` (`cars.find`) runs once per frame for the minimap and can stay.
5. Run the traffic tests (`src/ai`) and `npm run cops -- --vs main`.
6. **Measure:** the CivilianController/CivilianTraffic sites should leave the top 20.

### 1.4 Per-frame allocations in `Game.frame` and `Vehicle`

**Steps:**
1. `Game.frame`:
   - **Traffic vehicle list:** `this.traffic.update(…, [this.player, ...this.director.cops.map((c) => c.vehicle)])`
     builds a new array every frame. Use a reused `this.otherVehicles` array, refilled like
     `glowCars`.
   - **Director level:** `this.director.update(…, { ...level, maxCops: … })` creates an object every
     frame. Keep one `this.levelArg` object and assign its fields.
   - **Minimap cops:** `this.director.activeCops.map((c) => c.vehicle.position)` creates an array every
     frame. Use a reused array.
   - **Prop breaks:** `breaks.push(...smashed)` spreads arrays. Loop-push, or skip when `smashed`
     is empty (it nearly always is).
   - **Ramp check:** `this.player.position.clone()…new THREE.Vector3(0, 1, 0)` in the ramp-truck check
     allocates on every hard hit. Use module-level `tmp` vectors.
2. `Vehicle.updateLights`: `for (const side of ['left', 'right'] as const)` creates the array every
   call. Hoist it to a module constant (`const SIDES = ['left', 'right'] as const`).
3. `Vehicle.syncMesh`: read it for closures or `{}` literals and hoist them.
4. `PropSystem.updateSignals` (4 MB): read it and hoist whatever it allocates.
5. **Measure:** the result goes in the milestone commit, from the baseline to the new
   `allocMBperSec` and `gcPerSec`.

### 1.5 Make the budget a check

1. In `perf-profile.js`, return `budget: { allocMBperSec: cruise.allocMBperSec <= 10 }`. Set the
   limit at what 1.1–1.4 reach, plus ~30%.
2. Mention it in `BROWSER_CHECKS.md` under ready-made evals: "after anything in the frame loop".
3. **Commit:** "Perf M1: cut per-frame garbage". The body lists each source, with MB/s before and
   after.

---

## Milestone 2: draw only what can be seen

**Done** (`2c78f02`): triangles 1.79 → 1.10 M, calls 327 → 308, phone frame 9.5 → 8.0 ms. 2.1 packs
props by distance instead of tiling (one draw per model kept); 2.2 was tried and dropped (walls are
~5k triangles in view); 2.3 as planned, plus the sky and the beacon. The main pass is at 0.80 M, not
0.6 M: the rest is two city-wide meshes and the props within the fog.

Goal: main-pass triangles from ~1.28 M to under ~0.6 M, and the shadow pass with them; no more draw
calls than today (~220 main).

### 2.1 Tile the instanced props

**Why:** each `PropSystem` model is one city-wide `InstancedMesh` with `frustumCulled = false`. Of
12 376 instances, 1 308 are on screen and within the fog. That is 87 k of 814 k triangles, and all of
them are drawn in both passes.

**Steps:**
1. Read `PropSystem` (`grep -n`, read slices).
   - **Mapping:** each prop's state holds `key` + `instance`, so a prop maps to one mesh slot. Find
     every use of `this.meshes[...]`: `setMatrixAt`, `setColorAt`, breakage and debris (lines ~1375,
     1552, 1691).
   - **Lifetime:** find where props are hidden on break and restored on Retry.
2. Choose tiles: a square grid over the city (start at ~150 m, about two blocks). The tile is
   `Math.floor(x / T), Math.floor(z / T)` of the prop's rest position, a pure function, so no rng
   draw and no seed moves.
3. Build the meshes by key and tile:
   - make one `InstancedMesh` per (key, tile) that has instances;
   - **all of them share the one prop `material`**, so programs don't grow;
   - set `frustumCulled = true` and call `computeBoundingSphere()` after the matrices are set;
   - leave the fences' `castShadow` rule as is.
4. Store `mesh` + `instance` in the prop's state instead of `key` + `instance`, and update every
   `this.meshes[key]` use.
5. **Debris:** a broken prop that flies to another tile keeps its slot in the old tile's mesh. That
   mesh's bounding sphere no longer contains it, so it may be culled while still visible. Choose
   one fix:
   - (a) move debris to a small, never-culled "loose props" instanced mesh while it has a body,
     then back (or keep it there);
   - (b) recompute the tile mesh's bounding sphere when a prop in it moves. This is cheap: only for
     the few active ones.

   (a) is cleaner.
6. **Draw calls:** keys × visible tiles can exceed today's 59 calls.
   - **Count:** count calls on the baseline seed.
   - **If calls exceed today's:** grow the tile size, or for keys with few instances (district
     props, `-old` props) keep one mesh per key.
   - **Distance cull:** also add `mesh.visible = distance(tile centre, camera) < fog.far + T` each
     ~10 frames, which drops tiles behind the fog that frustum culling keeps.
7. **Attachment meshes** (`bulbs`, `pools`, signal heads, …) are built the same city-wide way
   (`addAttachmentMesh`, ~line 1302) and get the same treatment. Do them in the same pass, or note
   them as a follow-up.
8. **Tests:**
   - the PropSystem unit tests (breakage, debris, restore);
   - `npm run check:restart` (leaks, since there are more meshes now);
   - `district-drive.js` (props still collide; colliders don't depend on meshes);
   - a `district-tour.js` shot pair before and after: the same image.
9. **Measure:** `render.triangles`, `render.calls`, `renderer.render` ms and
   `renderer.shadowMap.render` ms.

### 2.2 Tile the merged buildings

**Why:** walls are merged per facade style for the whole city (`CityBuilder.ts` ~line 358,
`wallsFor`), so their bounding spheres span the city and are never culled (~418 k triangles).

**Steps:**
1. Key `walls` by `facade + tile` instead of `facade` (the same tile function as 2.1, perhaps a
   larger `T`), and do the same for roofs and trims.
2. **All tiles of a style share one material and one facade texture set.** Create the textures once
   per style (`createFacadeTextures(facade, rng)`), not once per tile. The `rng` draw order must stay
   the same, or seeds move. The seed guard catches it.
3. Colliders: keep "one collider each" as it is. Physics doesn't care about render tiles.
4. Districts and lots that add to the same builders: check `building.district` / `lot` paths in
   `addBuilding` for anything that assumes one mesh per style.
5. `BuildingGeometry.test.ts` snapshots: if they snapshot the merged result per style, they'll change.
   Prefer making the test merge tiles back per style, so the snapshot stays put. Otherwise use
   `-u` and explain it in the commit.
6. `stats().staticTris` stays the same (same triangles, more meshes).
7. Same checks as 2.1. Rule from CLAUDE.md: never a mesh or material per lot. Per tile and style is
   fine.

### 2.3 Far plane at the fog end

1. In the frame, after `chase.update`, set `chase.camera.far = fog.far + 20` (and
   `updateProjectionMatrix()` only when it changed). `ChaseCamera.ts:21` sets 1200.
2. **Things that must stay visible past the fog:**
   - the sky dome: it follows the camera (`sky.follow`), so check its radius fits inside `far`,
     scale it down, or give it `material.depthTest = false` and render it first;
   - the sea and the horizon;
   - the overview camera, which has its own camera, so leave it.
3. **Check:** shots at day, night and rain (`district-tour.js`) before and after. The horizon must
   look the same.

**Commit:** "Perf M2: cull props and buildings by tile". The body has calls, triangles and ms before
and after, and a note on the debris approach.

---

## Milestone 3: less CPU per frame

**Done:** phone frame 8.0 → 6.8 ms cruising, 8.5 → 7.1 in a 5★ chase. 3.1: mid-range civilians think
every 3rd step (far from the player and every cop), off-screen ones keep their last drawn pose and
skip their matrices; no phone traffic cut (the frame is at 40% of budget; fewer cars is a gameplay
call). 3.2: most matrix work was the cars' ~35 parts each, not the static scene: car parts are
manual, the scene root is, and the frame updates matrices once (the glows did it a second time);
only the city and the props are frozen (districts, landmarks and roadworks animate parts). 3.3 as
planned.

Measure each task's target first (`--profile` at `--throttle 4`: is `updateMatrixWorld` still 5 %, is
`Precipitation.update` still there, what does each civilian cost now?) and drop or reshape a task the
numbers don't support. Phone frame at the start of M3: 8.0 ms.

### 3.1 Traffic LOD

**Why:** 30 civilians with full raycast-vehicle physics: `drive`, controller and `syncMesh` take
~2.5 ms of a 4×-throttled phone frame.

**Steps:**
1. In the step loop (`Game.frame`), give each civilian a distance band from the player:
   - **near**, < 120 m: as today;
   - **mid**, < fog end: `controller.update` every 3rd step, staggered by `index % 3`, reusing the
     last input in between;
   - **far**: out of view and past the fog, despawn and respawn near the player. Read
     `CivilianTraffic.update` first: it may already do this by distance. If so, lower its radius
     instead.
2. Keep physics stepping for all bodies: Rapier steps the world as a whole. The saving is the
   controller (raycasts, junction logic) and `syncMesh` for cars outside the camera frustum. Skip
   `syncMesh` when `!frustum.intersectsSphere(car)`, but keep `prevPos`/`currPos` right.
3. Phones: scale `TRAFFIC.count` by a quality tier. There's no tier yet; `carShadowCull` already
   detects phones, so reuse that.
4. **Tests:**
   - `npm run cops -- --vs main` (cops weave through traffic);
   - the traffic tests.

   A civilian that reacts late at mid range must not crash into the player's path: test junction
   claims with mid-band cars.

### 3.2 Freeze the static scene graph

**Why:** all 1 042 objects have `matrixAutoUpdate = true`. `updateMatrixWorld` + `multiplyMatrices`
take ~5.6% of phone CPU.

**Steps:**
1. At the end of the build (after districts overlay), walk the static roots and freeze them:
   - **which roots:** city meshes, landmarks, district views' static parts, props' instanced meshes
     (their instances are in buffers; the mesh itself doesn't move);
   - **how:** call `updateMatrixWorld(true)` once, then set `matrixAutoUpdate = false` and
     `matrixWorldAutoUpdate = false`.
2. Don't freeze anything that moves or animates: cars, cops, effects, sirens, the marker,
   precipitation, sea, roadworks (barriers swing), district views with `update`, debris, the
   camera, the sun and its target. The safest list is opt-in: the builder marks static roots, and
   only those are frozen.
3. `GlowBatch.update` calls `car.root.updateMatrixWorld()` for each car. Keep it if the glows read
   before `renderer.render` updates the scene; check the order in `frame`.
4. **Check:** drive through every district with `district-drive.js` and a tour. A frozen object that
   should move shows as stuck (a gate that doesn't swing, a crane that doesn't turn).

### 3.3 Precipitation in the vertex shader

**Why:** `Precipitation.update` moves 9 200 particles on the CPU each frame and re-uploads the buffer
(1.7% of phone CPU).

**Steps:**
1. Keep a static buffer of start positions and phases (one attribute).
2. **The shader:** use `onBeforeCompile` on `PointsMaterial`/`LineBasicMaterial`, adding uniforms
   `uTime` and `uCenter` and doing the fall, sway and `mod()` wrap around the centre, as `update`
   does today. Put the uniforms in `material.userData.uniforms` (`LEAKS.md`: `dispose` and
   `gpuTrace` look there).
3. **Rain streaks:** the line pairs need both ends. Give each vertex an `aEnd` flag (0 or 1) and offset
   the tail in the shader.
4. **The random respawn height:** replace it with a per-particle phase, so the wrap is deterministic
   in the shader.
5. `update()` then sets two uniforms. No `needsUpdate`.
6. **Check:** rain and snow shots, before and after (`?weather=rain` / snow with `?debug`).
   `programs` grows by at most the one modified material, which it already has.

**Commit:** "Perf M3: traffic LOD, static matrices, GPU precipitation".

---

## Milestone 4: load, lights, shadows, memory

**Done:** 4.1 kept (cold load −3.5 %, not 9 %: warm reloads hit the browser's shader cache either
way). 4.2: one shared point light for the nearest siren and a blast's flash, 3 → 1 (GPU −12 % at both
sizes). 4.3 dropped: phones already had a 1024² map, and 90 m instead of 125 m saved 0.04 of 0.66 ms.
4.4 for the city's merged meshes only: heap 104 → 89 MB.

### 4.1 Shader error checks off in builds

1. Where the renderer is made (`Game.ts` ~line 94), add
   `renderer.debug.checkShaderErrors = import.meta.env.DEV`. Keep the checks in dev and with
   `?debug`.
2. **Measure:** time `dbg.loadCity` of the same city three times, before and after. Expect ~9% less
   load CPU. Check `npm run build && npm run preview` too: the flag is off there.

### 4.2 Fewer always-on lights

**Why:** two siren `PointLight`s and the crash-flash `PointLight` sit at intensity 0 but are in every
lit pixel's light loop.

**Steps:**
1. **Measure first:** check `gpuMsPerFrame` at `--size 390x844` with the three lights removed (a
   quick hack). If GPU time doesn't move, stop here and note it.
2. If it helps:
   - **Sirens:** keep the light count constant, since changing it recompiles. Replace them with one
     shared siren light on the nearest cop (`Sirens.update` already finds it), or with an additive
     light-pool decal under each cop (like the lamp `pools` in `PropSystem`).
   - **Crash flash:** use an emissive sprite or a `GlowBatch` entry instead of a light.
3. The light count must stay the same across all states (wrecked, night, day). `Vehicle.updateLights`
   explains why: a changed count recompiles every material.

### 4.3 Shadow map

1. Measure only after milestone 2 (the shadow pass shrinks with tiling).
2. On phones (the `carShadowCull` check), try `mapSize` 1024 and `SHADOW_HALF` ~90 m. Compare
   `renderer.shadowMap.render` ms and shots: shadow edges and the far edge of the shadowed area.
3. Static/dynamic shadow split (static map updated rarely, cars in a small dynamic map): only if
   the shadow pass is still a top item.

### 4.4 Free geometry arrays after upload

1. **Find which geometries are safe:** static merged render meshes that nothing reads back.
   - **Not safe:** geometry used to build colliders, for raycasts, by `dbg.near` or `studio`, or
     re-merged later (`Slums` wires are rebuilt as poles fall).
   - **Safe:** `staticTris` reads `index.count`, which survives.
2. For those, set `attr.onUpload(function () { this.array = null; })` on each attribute and the index.
3. **Check:**
   - `npm run check:restart` (dispose must cope with null arrays);
   - `check:reload`;
   - `gc()`'d heap before and after (expect up to ~30 MB less).

**Commit:** "Perf M4: …" with whatever of 4.1–4.4 was kept and the numbers.

---

## At the end

- Re-run the baseline commands and add an "After" column to the measurement tables in
  `OPTIMIZATIONS.md`.
- Update `BROWSER_CHECKS.md` (`perf-profile.js`, the mixed-material guard) and CLAUDE.md if a rule
  changed (props and buildings per tile).
- Stop for approval before merging to `main`.
