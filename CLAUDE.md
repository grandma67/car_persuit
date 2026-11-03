# Car Pursuit: notes for Claude

Three.js + Rapier browser driving game (TypeScript, Vite, Vitest): procedural city per seed, mission
destinations, cops, civilian traffic, themed districts.

## Docs (read the one the task needs)

| File | What | Git |
|---|---|---|
| `knowledge/plans/PLAN_GAME.md` | the game: rules, tech, world, police, URL flags, versions | tracked |
| `knowledge/CITY_PARAMS.md` | **read before adding a roll, feature or word**: pipeline, rules, schema, words, roll audit | tracked |
| `knowledge/DISTRICTS.md` | what each district is (table + descriptions) | tracked |
| `knowledge/DISTRICTS_DEV.md` | **read before district work**: framework, files, rules, budgets, pitfalls, tests | tracked |
| `knowledge/COPS_DEV.md` | **read before cop AI work**: brain, tuning and why, pitfalls, `npm run cops` metrics | tracked |
| `knowledge/BROWSER_CHECKS.md` | **read before a browser run**: `check:browser`, evals, `window.dbg`, pitfalls | tracked |
| `knowledge/LEAKS.md` | **read before touching `dispose()` or anything Retry rebuilds**: `check:restart`, `gpuTrace`, leak causes | tracked |
| `knowledge/OPTIMIZATIONS.md` | **read before perf work**: techniques, measured costs, ranked fixes, `perf-profile.js` | tracked |
| `knowledge/OPTIMIZATION_TASKS.md` | perf tasks step by step: baseline, milestones M1–M4, checks per task | tracked |
| `knowledge/RAPIER.md` | why we stay on Rapier 0.18.2 | tracked |
| `knowledge/plans/PLAN_DISTRICTS.md` | district decisions, dropped ideas | tracked |
| `knowledge/plans/PLAN_CITY_PARAMS.md` | city params decisions, what changed from the plan | tracked |
| `knowledge/plans/PLAN_NATURE.md` | park pond/pitch, shallow water, Mega-park, Swamp, Forest (planned) | tracked |
| `knowledge/TASKS.md` | current branch and milestones, open items | **local, never commit** |
| `knowledge/TODO.md` | the user's task list | **local, never commit** |
| `knowledge/STAGE2_IDEAS.md` | future gameplay ideas | **local, never commit** |

## Commands

Each script's header lists its options; the doc named here says when to use it.

- Type check `npx tsc --noEmit`; build `npm run build`.
- Tests: `npm run t` (failures + summary only; ~26–35 s wall, ~250 s CPU; killed after 300 s, `T_LIMIT=`).
  Area: `npm run t -- src/world/districts`, `-t "name"`. Never pipe vitest through `grep`/`tail` without
  a limit. Suite time: `npm run t -- --times [save]` (CPU and wall s, slowest files, Δ% vs the saved run):
  judge by CPU (wall swings by a third with load); don't rerun the suite to time it.
- One-off TS: `node scripts/run-ts.mjs <file.ts> [args]` (default export gets args), for numbers instead
  of scratch tests (vitest swallows `console.log`). In the scratchpad it needs absolute `src/` imports
  and `node_modules` symlinked next to it.
- City from words: `npm run city -- make <words…> seed=N` (e.g. `flat night chinatown festival`; may
  move to a later seed and says which; without `seed=` it starts from a random one, so checks and tests
  always pass it), `dump <seed> [URL words]`, `check <file…>`, `show <file | seed | words…>` (ASCII map),
  `words`. `CITY_PARAMS.md`.
- Seeds to look at: `npm run find -- harbor straddle:2 flatcar ship=container gallery=0 [seeds=60] [flat]`
  (`name:N` at least, `name=N` exactly; counts structures, landmarks, props, ground patches, lots,
  roles; `flat` = no hill/canals). Never write a search script for this.
- Seed guard: `npm run hash -- --vs HEAD` (or any ref on/after city params: hashes 120 cities on a temp
  worktree, names those that moved; `--out f` / `--vs f` for a file; `--reload` also proves every dump
  reloads as its city). Older refs need a file baseline.
- District numbers: `npm run stats -- <kind> [seeds=100]` (placement rate, shapes, gates, counts, gen ms
  on vs off). Building budget: `npm run budget -- <kind> [seeds=20]`. `DISTRICTS_DEV.md`.
- Cop driving: `npm run cops -- --vs main` (~2 min; `--samples 2` adds the noise band, ±% per cell: a
  Δ inside it is noise; `--diag hits|uturns|recovers`; `COPS_DEV.md`).
  Never write a chase sim for this.
- Rapier: `node scripts/rapier-bench.mjs 0.18.2 <new>` (`RAPIER.md`).
- Browser (`BROWSER_CHECKS.md`; ~10 s plus the eval with Vite already on 5199, `check:restart` ~1.5 min;
  settle seed and words before the first, run in the background while editing): `npm run check:browser …`;
  `npm run check:restart` after anything that adds to the scene, page or listeners (`LEAKS.md`);
  `npm run check:reload` after a change to `Game`'s setup, `dbg.loadCity`/`dumpCity` or `city.params`.
- Before/after in the browser: `npm run check:browser -- --vs <ref> …` (that ref in its own worktree and
  server, then here; never a baseline from the server you're editing against). Shots:
  `node scripts/png-diff.mjs a.png b.png`. Perf: `--table` (perf-profile as a Δ% table), `--throttle 4`
  with `&touch` (the phone path), `--profile f.json`; evals `perf-profile.js`, `tri-breakdown.js`,
  `gpu-ab.js` (a GPU question: on/off in one page), `cold-load.js`; `dbg.sceneBreakdown()` (measure
  before choosing what to optimize). Never measure while `npm run cops` or tests run.

## Working rules (from the user)

- **Git:** commit per milestone, short subject + bulleted body (what and why). Never push without asking.
- **Branches** (districts and other multi-milestone work): one branch each (`districts/<kind>`). Within
  a branch do all milestones without asking; at branch end **stop for the user's approval**, then merge
  to main and branch the next from main. Keep `knowledge/TASKS.md` ticked (it tells the next session
  where things stand).
- **Storage:** the origin is shared; touch only the game's own localStorage/IndexedDB keys.
- **Tests ship with the code.** Never commit part of a milestone without the tests for what it adds.
- **Testing split:** Claude owns logic (unit tests + headless browser checks: no errors, draw calls,
  programs, fps, screenshots). The user judges feel.
- No district names in the start toast; toasts are for game modes (England…).

## Naming

- **Zone:** distance ring of a block: `downtown | midtown | residential | industrial` (`Zone`,
  `block.zone`, `ZONE_STYLE`, `theme.facades[zone]`).
- **District:** themed area over a rectangle of blocks: `oldtown`, `chinatown`, `harbor`, `farm`, `slums`
  (`District`, `DistrictDef`, `block.district`, `building.district` + `building.lot`, `city.districts`,
  `DISTRICTS` in balance, `?<kind>=0|1`). A district block keeps its zone. In old commits "district" meant zone.

## Architecture

- `world/CityGenerator.ts` → `CityData` (pure data). `world/CityBuilder.ts` → meshes + colliders;
  `world/PropSystem.ts` breakables; `render/Landmarks.ts` solid set pieces; districts overlay last.
- **Determinism is sacred.** Each subsystem uses its own `new Rng(seed ^ SALT)`. The main `rng` in
  `generateCity` is shared in order (zone noise, parks, `fillBlock`, plazas, spawn): never add a draw to
  it; new features get a new salt. Anything that moves existing seeds needs a reason.
- **Every choice that shapes a city is a param** (`CityParams`): seed → `rollCityParams` →
  `generateCity(params)` → `city.params` (complete: a dump reloads as the same city). A new roll goes
  through `pin()`: **draw, then override** (`pin(params.x, rng.next() < chance)`); a district's through
  `feature(q, name, roll)`, declared in its def's `features`. Seed guard before each commit.
- **Junction rules come from props** (`approachControls`, `fastStreets`, `busStops` read signals/signs):
  never drop or move signals or `stop`/`priority`/`speed*` signs (`isJunctionControl`).
- Tuning → `gameplay/balance.ts`; generation config → `DEFAULT_CITY`; URL city flags → `urlOverrides`
  (`world/makeCityParams.ts`; `Game` never reads the URL for city choices).
- Buildings: one merged mesh per facade style, one shared roof mesh; never give a lot its own mesh or material.
- A material is drawn by one kind of mesh only: plain, instanced, or instanced with `instanceColor`
  (give every instanced user colours, or each kind a `.clone()`); otherwise three switches programs every
  draw. `dbg.mixedMaterials()` must stay `[]` (shadow pass included: `separateInstancedShadows`).
- A vehicle's state: read `vehicle.position`/`quaternion`/`vel`/`spin` (as of the last step), not the
  Rapier getters (each allocates); change its velocity from outside the step with `push`/`setVelocity`
  (never `body.applyImpulse`/`setLinvel`), or `vel` goes stale.
- New hooks: optional constructor params defaulting to "no district", so tests and seeds don't move.
- Anything a run adds to the page or scene must be freed by `Game.dispose()` (Retry/New city restart in place).
  A builder adding to the scene goes through `Game.owned('<name>', …)`, which tags its objects for
  `dbg.sceneBreakdown` and `gpu-ab.js` (`ab=owner:<name>`).
- Matrices: the scene root, the city's and props' meshes and every car part are manual
  (`matrixAutoUpdate = false`); `Game.frame` updates the scene once before the glows and the render.
  `dbg.staleMatrices()` (in `perf-profile` and `check:restart`) lists frozen objects moved without it.
  Moving one of those (a car part outside `syncMesh`, a city mesh) needs `updateMatrix()`. District,
  landmark and roadworks objects stay automatic. The city's merged meshes also drop their vertex
  arrays once uploaded (`releaseAfterUpload`): read city geometry at build time only.
- Lights: one point light in the scene, shared by the siren and a blast (`Sirens`); a new light is
  ~4 % of the GPU frame even at intensity 0, and the count must never change at run time.
- Big files (`CityBuilder`, `CivilianController`, `CopDirector`, `PropSystem`, `Game`): `grep -n`, read slices.

## Testing

- Run area tests while editing; the full suite once per milestone before commit.
- **A test that needs a feature builds it from words:** `makeCity(['flat', 'harbor'], { seed })` /
  `makeCityParams(...)`; a district feature on and off: `districtCities('farm', ['maze'])` / `['!maze']`
  (`world/paramsTesting.ts`). Never a constant seed that happens to have it, a config chance set to 0
  or 1, or a committed JSON. Seeds stay only where the seed is the subject: invariant sweeps over ~40
  seeds, roll and frequency tests, `[1, 42, 1234]` variety lists. A new pinnable thing gets a word in
  `WORDS` (and its test).
- **Grid size:** `generateCity(seed)` builds the config's fixed 12-block grid; `generateCity({ seed })`
  and words roll it (8–15). Moving a test from a seed to words changes its grid unless it adds
  `blocks=12` (as `flatCities` does).
- Physics sim in tests: call `vehicle.snapshot()` after `world.step()` (`position` is the snapshot).
- `BuildingGeometry.test.ts` snapshots no-district geometry per theme: a failure is a bug unless intended
  (then `npx vitest run -u` and explain in the commit).
- A refactor meant to change nothing: `npm run hash -- --vs HEAD` before committing.
- A new prop, look or material: `renderer.info.programs` must not grow (browser run, on vs off).
- Shared test helpers that import vitest live in `src/` as plain `.ts` (`world/paramsTesting.ts`,
  `districts/trafficSim.ts`). `src/` can't import from `scripts/`: `tsc` covers `src` only and has no
  Node types (`node:fs`, `node:crypto`), so a script helper a test needs moves to `src/`.
- District tests and rules: `DISTRICTS_DEV.md`.
