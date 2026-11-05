# Car Pursuit: notes for Claude

Three.js + Rapier browser driving game (TypeScript, Vite, Vitest): procedural city per seed, mission
destinations, cops, civilian traffic, themed districts.

## Docs (read the one the task needs)

| File | Read before | Git |
|---|---|---|
| `knowledge/plans/PLAN_GAME.md` | anything about the game itself: rules, tech, world, police, URL flags, versions | tracked |
| `knowledge/CITY_PARAMS.md` | adding a roll, feature or word: pipeline, rules, schema, words, roll audit | tracked |
| `knowledge/DISTRICTS.md` | what each district is (table + descriptions) | tracked |
| `knowledge/DISTRICTS_DEV.md` | district work: framework, rules, adding one, building blocks, pitfalls, tests | tracked |
| `knowledge/DISTRICTS_LOOKS.md` | a district's looks: facades, programs, budgets, z-fighting, night glow | tracked |
| `knowledge/COPS_DEV.md` | cop AI work: brain, tuning and why, pitfalls, `npm run cops` | tracked |
| `knowledge/BROWSER_CHECKS.md` | a browser run: `check:browser`, evals, `window.dbg`, pitfalls | tracked |
| `knowledge/LEAKS.md` | touching `dispose()` or anything Retry rebuilds: `check:restart`, `gpuTrace` | tracked |
| `knowledge/OPTIMIZATIONS.md` | perf work: where the frame goes, what was done and learned, how to measure, what's open | tracked |
| `knowledge/POLYGONS.md` | adding or changing a model: triangles per prop/building/car, budgets | tracked |
| `knowledge/AUDIO_LIMITS.md` | audio start-up, gestures, autoplay warnings: what browsers allow and cost, `check:audio` | tracked |
| `knowledge/RAPIER.md` | a Rapier upgrade (we stay on 0.18.2) | tracked |
| `knowledge/plans/PLAN_DISTRICTS.md`, `PLAN_NATURE.md`, `PLAN_CITY_PARAMS.md` | revisiting a decision: why, what was dropped, where the build bent | tracked |
| `knowledge/TASKS.md` | starting work: current branch, milestones, open items | **local, never commit** |
| `knowledge/TODO.md` | the user's task list | **local, never commit** |
| `knowledge/STAGE2_IDEAS.md` | future gameplay ideas (losing the cops) | **local, never commit** |

## Commands

Each script's header lists its options; the doc named says when to use it.

- Type check `npx tsc --noEmit`; build `npm run build`.
- Tests: `npm run t` (failures + summary, first 6 items of each failing break list, `T_ITEMS=`; ~30 s
  wall, ~250 s CPU; killed after 300 s, `T_LIMIT=`). Area: `npm run t -- src/world/districts`,
  `-t "name"`. Never pipe vitest through `grep`/`tail` without a limit. Suite time:
  `npm run t -- --times [save]` (CPU/wall, slowest files, Δ% vs saved; judge by CPU, don't rerun to time).
- One-off TS: `node scripts/run-ts.mjs <file.ts> [args]` (default export gets args) for numbers instead
  of scratch tests (vitest swallows `console.log`). In the scratchpad: absolute `src/` imports and
  `node_modules` symlinked next to it.
- City from words: `npm run city -- make|dump|check|show|focus|words` (`CITY_PARAMS.md`). Always pass
  `seed=` in checks and tests (without it the start seed is random).
- Seeds with something: `npm run find -- harbor straddle:2 ship=container [seeds=60] [flat]`. Never
  write a search script for this.
- Seed guard: `npm run hash -- --vs HEAD [--reload] [--expect <kind>]` (`CITY_PARAMS.md`, `DISTRICTS_DEV.md`).
- District numbers: `npm run stats -- <kind>|odds`, `npm run budget -- <kind>`, `npm run zfight`,
  `CLEAROF=<kind>` on any run-ts script (`DISTRICTS_DEV.md`, `DISTRICTS_LOOKS.md`).
- Triangles: `npm run polygons -- [props|buildings|cars]`; scene by owner `scripts/evals/polygons.js` (`POLYGONS.md`).
- Cop driving: `npm run cops -- --vs main [--samples 2] [--diag hits]` (~2 min, `COPS_DEV.md`). Never
  write a chase sim for this.
- Rapier: `node scripts/rapier-bench.mjs 0.18.2 <new>` (`RAPIER.md`).
- Browser (`BROWSER_CHECKS.md`): always under a hard limit, `perl -e 'alarm 300; exec @ARGV' npm run …`;
  ~10 s plus the eval with Vite on 5199; one run at a time per port; settle seed and words first, run in
  the background while editing. `npm run check:browser …` (`--vs <ref>` before/after, `--vs-make
  "nodistricts <words>" --make "<kind> <words>"` district on/off, `--table` perf);
  `npm run check:audio` (~1 min, real input, after any change to audio start-up: `AUDIO_LIMITS.md`);
  `npm run check:restart` (~3 min, `:core` / `:nature`) after anything that adds to the scene, page or
  listeners (`LEAKS.md`); `npm run check:reload` after a change to `Game`'s setup,
  `dbg.loadCity`/`dumpCity` or `city.params`. Never measure while `npm run cops` or tests run.

## Working rules (from the user)

- **Git:** commit per milestone, short subject + bulleted body (what and why). Never push without asking.
- **Branches** (districts and other multi-milestone work): one each (`districts/<kind>`, `perf/<topic>`).
  Within a branch do all milestones without asking; at branch end **stop for the user's approval**,
  then merge to main and branch the next from main. Keep `knowledge/TASKS.md` ticked (it tells the next
  session where things stand); hand off at milestone boundaries.
- **Storage:** the origin is shared; touch only the game's own localStorage/IndexedDB keys.
- **Tests ship with the code.** Never commit part of a milestone without the tests for what it adds.
- **Testing split:** Claude owns logic (unit tests + headless browser checks: no errors, draw calls,
  programs, fps, screenshots). The user judges feel.
- No district names in the start toast; toasts are for game modes (England…).

## Naming

- **Zone:** distance ring of a block: `downtown | midtown | residential | industrial` (`Zone`,
  `block.zone`, `ZONE_STYLE`, `theme.facades[zone]`).
- **District:** themed area over a rectangle of blocks (`oldtown`, `chinatown`, `harbor`, `farm`,
  `slums`, `megapark`, `swamp`, `forest`; `District`, `DistrictDef`, `block.district`,
  `building.district` + `building.lot`, `city.districts`, `DISTRICTS` in balance, `?<kind>=0|1`). A
  district block keeps its zone. In old commits "district" meant zone.

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
- **Props move.** Anything new a car can reach (clutter, set dressing, logs, tents) is a prop (`PropKind`
  + `PROP_SPECS`), not a solid structure: a hard enough hit knocks it loose. Tune it, don't freeze it:
  `breakSpeed` (below it, it stands like a wall and the crash damages the car), `slowdown` (speed the
  hit costs), `mass`; heavy things (logs, bales) take a real hit. Solid structures only for built
  things (walls, sheds, stacks, buildings); a prop that must never budge gets `breakSpeed: Infinity`
  and a comment saying why.
- Buildings: one merged mesh per facade style, one shared roof mesh; never give a lot its own mesh or material.
- A material is drawn by one kind of mesh only: plain, instanced, or instanced with `instanceColor`
  (give every instanced user colours, or each kind a `.clone()`); otherwise three switches programs every
  draw. `dbg.mixedMaterials()` must stay `[]` (shadow pass included: `separateInstancedShadows`).
- A vehicle's state: read `vehicle.position`/`quaternion`/`vel`/`spin` (as of the last step), not the
  Rapier getters (each allocates); change its velocity from outside the step with `push`/`setVelocity`
  (never `body.applyImpulse`/`setLinvel`), or `vel` goes stale.
- New hooks: optional constructor params defaulting to "no district", so tests and seeds don't move.
- Anything a run adds to the page or scene must be freed by `Game.dispose()` (Retry/New city restart in
  place). A builder adding to the scene goes through `Game.owned('<name>', …)`, which tags its objects
  for `dbg.sceneBreakdown` and `gpu-ab.js` (`ab=owner:<name>`).
- Matrices: the scene root, the city's and props' meshes and every car part are manual
  (`matrixAutoUpdate = false`); `Game.frame` updates the scene once before the glows and the render.
  Moving one of those (a car part outside `syncMesh`, a city mesh) needs `updateMatrix()`;
  `dbg.staleMatrices()` lists any that moved without it. District, landmark and roadworks objects stay
  automatic. The city's merged meshes drop their vertex arrays once uploaded (`releaseAfterUpload`):
  read city geometry at build time only.
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
