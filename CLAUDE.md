# Car Pursuit: notes for Claude

Three.js + Rapier browser driving game (TypeScript, Vite, Vitest): procedural city per seed, mission
destinations, cops, civilian traffic, themed districts.

## Docs (read the one the task needs)

| File | What | Git |
|---|---|---|
| `knowledge/plans/PLAN_GAME.md` | the game: rules, layout, world, police, URL flags, versions | tracked |
| `knowledge/DISTRICTS.md` | what each district is (table + descriptions) | tracked |
| `knowledge/DISTRICTS_DEV.md` | **read before district work**: framework, rules, budgets, pitfalls, tests | tracked |
| `knowledge/COPS_DEV.md` | **read before cop AI work**: brain, tuning and why, pitfalls, `npm run cops` metrics | tracked |
| `knowledge/BROWSER_CHECKS.md` | **read before a browser run**: `check:browser`, evals, `window.dbg`, pitfalls | tracked |
| `knowledge/RAPIER.md` | why we stay on Rapier 0.18.2 | tracked |
| `knowledge/TASKS.md` | current district branch, open items | **local, never commit** |
| `knowledge/plans/PLAN_DISTRICTS.md` | district decisions, dropped ideas | tracked |
| `knowledge/plans/PLAN_CITY_PARAMS.md` | city params (JSON, words): decisions, what exists, the roll audit | tracked |
| `knowledge/TODO.md` | the user's task list | **local, never commit** |
| `knowledge/STAGE2_IDEAS.md` | future gameplay ideas | **local, never commit** |

## Commands

- Type check: `npx tsc --noEmit`. Build: `npm run build`.
- Tests: `npm run t` (~26–35 s wall, ~250 s CPU; prints only failures + summary, killed after 300 s,
  `T_LIMIT=`). Area: `npm run t -- src/world/districts`, `-t "name"`. Never pipe vitest through
  `grep`/`tail` without a limit.
- Suite time: `npm run t -- --times` (CPU s, wall s, slowest files, Δ% vs the saved run; `--times save`
  stores this run as the one to compare with). Wall time swings by a third with load: judge by CPU, and
  don't rerun the full suite to measure by hand.
- One-off TS script: `node scripts/run-ts.mjs <file.ts> [args]` (default export gets args). Use it for
  numbers instead of scratch tests (vitest swallows `console.log`). A script in the scratchpad needs
  absolute `src/` imports and `node_modules` symlinked next to it.
- Cop driving: `npm run cops -- --vs main` (3★, 5★, ghost 3★ chase sims, Δ% vs a ref, ~2 min);
  `--diag hits|uturns|recovers` says why. Never write a chase sim for this.
- District numbers: `npm run stats -- oldtown [seeds=100]` (placement rate forced/natural, shapes, gates,
  avg lots/landmarks/props/structures, gen ms on vs off).
- City params: `npm run city -- make <words…> [seed=N] [--full] [--out f]` (a city with the words
  come true, e.g. `flat night chinatown festival`, `canals=2 canalramps=1 england`; may move to a later
  seed and says which; without `seed=` it starts from a random one, so a check or test always passes
  `seed=`), `dump <seed> [URL words]` (what `?seed=N&…` builds, complete), `check <file…>`,
  `show <file | seed | words…>` (ASCII map), `words` (the vocabulary). In the game with `?debug`:
  `dbg.dumpCity()` / `dbg.loadCity(json)`; `check:browser --city f` / `--make "words"`.
- Seeds to look at: `npm run find -- harbor straddle:2 flatcar ship=container gallery=0 [seeds=60] [flat]`
  (`name:N` at least, `name=N` exactly; counts structures, landmarks, props, ground patches, lots,
  roles; `flat` = no hill/canals, for physics sims). Never write a search script for this.
- Building budget: `npm run budget -- harbor [seeds=20]` (walls + roofs triangles, facade styles, gen +
  geometry ms on vs off).
- Seed guard: `npm run hash -- --vs HEAD` (or `main`, any ref on/after the city-params branch: hashes
  120 cities on a temporary worktree and names those that moved; `--out f` / `--vs f` for a file;
  `--reload` also proves every dump reloads as its city). Refs before city params need a file baseline.
- Rapier: `node scripts/rapier-bench.mjs 0.18.2 <new>` (see `knowledge/RAPIER.md`).
- Browser: `npm run check:browser …` (see `knowledge/BROWSER_CHECKS.md`).
- Restart/leaks: `npm run check:restart` (Retry/New city in place on a city made with every district and
  feature: fullscreen, splash, heap, GPU orphans named by creation site via `?gputrace`). Run it after
  anything that adds to the scene, page or listeners.
- Params reload: `npm run check:reload` (a dumped city loads back as the same city, Retry keeps it, New
  city drops it). Run it after a change to `Game`'s setup, `dbg.loadCity`/`dumpCity` or `city.params`.
- Browser runs take 1–2 min each: settle their inputs (seed, words) before the first one, and run them
  in the background while editing the next thing.

## Working rules (from the user)

- **Git:** commit per milestone, short subject + bulleted body (what and why). Never push without asking.
- **Districts:** one branch each (`districts/<kind>`). Within a branch do all milestones without asking;
  at branch end **stop for the user's approval**, then merge to main and branch the next from main.
  Keep `knowledge/TASKS.md` ticked (it tells the next session where things stand).
- **Storage:** the origin is shared; touch only the game's own localStorage/IndexedDB keys.
- **Tests ship with the code.** Never commit part of a milestone without the tests for what it
  adds: untested code left for the next session hides its bugs until then.
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
  `world/PropSystem.ts` breakables; `render/Landmarks.ts` solid set pieces; districts overlay last
  (`knowledge/DISTRICTS_DEV.md`).
- **Determinism is sacred.** Each subsystem uses its own `new Rng(seed ^ SALT)`. The main `rng` in
  `generateCity` is shared in order (zone noise, parks, `fillBlock`, plazas, spawn): never add a draw to
  it; new features get a new salt. Anything that moves existing seeds needs a reason.
- **Every choice that shapes a city is a param** (`CityParams`, `world/CityParams.ts`): seed →
  `rollCityParams` → `generateCity(params)` → `city.params` (complete: a dump reloads as the same city).
  A new roll goes through `pin()`: **draw, then override** (`pin(params.x, rng.next() < chance)`), so
  pinning it never shifts the draws after it; a district's goes through `feature(q, name, roll)` and is
  declared in its def's `features`. Seed guard before each commit: `npm run hash -- --vs HEAD`.
- **Junction rules come from props** (`approachControls`, `fastStreets`, `busStops` read signals/signs):
  never drop or move signals or `stop`/`priority`/`speed*` signs (`isJunctionControl`).
- Tuning → `gameplay/balance.ts`; generation config → `DEFAULT_CITY`; URL city flags → `urlOverrides`
  (the words' table in `world/makeCityParams.ts`; `Game` never reads the URL for city choices).
- Buildings: one merged mesh per facade style, one shared roof mesh; never give a lot its own mesh or material.
- New hooks: optional constructor params defaulting to "no district", so tests and seeds don't move.
- Big files (`CityBuilder`, `CivilianController`, `CopDirector`, `PropSystem`, `Game`): `grep -n`, read slices.
- Physics sim in tests: call `vehicle.snapshot()` after `world.step()` (`position` is the snapshot).

## Testing

- Run area tests while editing; the full suite once per milestone before commit.
- **A test that needs a feature builds it from words:** `makeCity(['flat', 'harbor'], { seed })` /
  `makeCityParams(...)` (the same words as `npm run city -- make`), never a constant seed that happens
  to have it, a config chance set to 0 or 1, or a committed JSON. Pin it off too (`!festival`).
  Seeds stay only where the seed is the subject: invariant sweeps over ~40 seeds, roll and frequency
  tests, `[1, 42, 1234]` variety lists. A new pinnable thing gets a word in `WORDS` (and its test).
  A district feature on and off: `districtCities('farm', ['maze'])` / `['!maze']` (`paramsTesting.ts`).
- **Grid size:** `generateCity(seed)` builds on the config's fixed 12-block grid; `generateCity({ seed })`
  and words roll it (8–15) like the game. Moving a test from a seed to words changes its grid unless
  it adds `blocks=12` (as `flatCities` does).
- `BuildingGeometry.test.ts` snapshots no-district geometry per theme: a failure is a bug unless intended
  (then `npx vitest run -u` and explain in the commit).
- A refactor meant to change nothing: `npm run hash -- --vs HEAD` (120 cities) before committing.
- A new prop, look or material: `renderer.info.programs` must not grow (browser run, on vs off).
- Anything a run adds to the page or scene must be freed by `Game.dispose()`: `npm run check:restart`.
- Shared test helpers that import vitest live in `src/` as plain `.ts` (`world/paramsTesting.ts`,
  `districts/trafficSim.ts`). `src/` can't import from `scripts/`: `tsc` covers `src` only and has no
  Node types (`node:fs`, `node:crypto` won't type-check), so a script's helper a test needs moves to `src/`.
- District tests and rules: `knowledge/DISTRICTS_DEV.md`.
