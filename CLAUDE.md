# Car Pursuit: notes for Claude

Three.js + Rapier browser driving game (TypeScript, Vite, Vitest): procedural city per seed, mission
destinations, cops, civilian traffic, themed districts.

## Docs (read the one the task needs)

| File | What | Git |
|---|---|---|
| `knowledge/plans/PLAN_GAME.md` | the game: rules, layout, world, police, URL flags, versions | tracked |
| `knowledge/DISTRICTS.md` | what each district is (table + descriptions) | tracked |
| `knowledge/DISTRICTS_DEV.md` | **read before district work**: framework, rules, budgets, pitfalls, tests | tracked |
| `knowledge/BROWSER_CHECKS.md` | **read before a browser run**: `check:browser`, evals, `window.dbg`, pitfalls | tracked |
| `knowledge/RAPIER.md` | why we stay on Rapier 0.18.2 | tracked |
| `knowledge/TASKS.md` | current district branch, open items | **local, never commit** |
| `knowledge/plans/PLAN_DISTRICTS.md` | district decisions, dropped ideas | tracked |
| `knowledge/TODO.md` | the user's task list | **local, never commit** |
| `knowledge/STAGE2_IDEAS.md` | future gameplay ideas | **local, never commit** |

## Commands

- Type check: `npx tsc --noEmit`. Build: `npm run build`.
- Tests: `npm run t` (~20 s, prints only failures + summary, killed after 300 s, `T_LIMIT=`). Area:
  `npm run t -- src/world/districts`, `-t "name"`. Never pipe vitest through `grep`/`tail` without a limit.
- One-off TS script: `node scripts/run-ts.mjs <file.ts> [args]` (default export gets args). Use it for
  numbers instead of scratch tests (vitest swallows `console.log`).
- District numbers: `npm run stats -- oldtown [seeds=100]` (placement rate forced/natural, shapes, gates,
  avg lots/landmarks/props/structures, gen ms on vs off).
- Seeds to look at: `npm run find -- harbor straddle:2 flatcar ship=container gallery=0 [seeds=60] [flat]`
  (`name:N` at least, `name=N` exactly; counts structures, landmarks, props, ground patches, lots,
  roles; `flat` = no hill/canals, for physics sims). Never write a search script for this.
- Building budget: `npm run budget -- harbor [seeds=20]` (walls + roofs triangles, facade styles, gen +
  geometry ms on vs off).
- Rapier: `node scripts/rapier-bench.mjs 0.18.2 <new>` (see `knowledge/RAPIER.md`).
- Browser: `npm run check:browser …` (see `knowledge/BROWSER_CHECKS.md`).

## Working rules (from the user)

- **Git:** commit per milestone, short subject + bulleted body (what and why). Never push without asking.
- **Districts:** one branch each (`districts/<kind>`). Within a branch do all milestones without asking;
  at branch end **stop for the user's approval**, then merge to main and branch the next from main.
  Keep `knowledge/TASKS.md` ticked (it tells the next session where things stand).
- **Storage:** the origin is shared; touch only the game's own localStorage/IndexedDB keys.
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
- **Junction rules come from props** (`approachControls`, `fastStreets`, `busStops` read signals/signs):
  never drop or move signals or `stop`/`priority`/`speed*` signs (`isJunctionControl`).
- Tuning → `gameplay/balance.ts`; generation config → `DEFAULT_CITY`.
- Buildings: one merged mesh per facade style, one shared roof mesh; never give a lot its own mesh or material.
- New hooks: optional constructor params defaulting to "no district", so tests and seeds don't move.
- Big files (`CityBuilder`, `CivilianController`, `CopDirector`, `PropSystem`, `Game`): `grep -n`, read slices.
- Physics sim in tests: call `vehicle.snapshot()` after `world.step()` (`position` is the snapshot).

## Testing

- Run area tests while editing; the full suite once per milestone before commit.
- `BuildingGeometry.test.ts` snapshots no-district geometry per theme: a failure is a bug unless intended
  (then `npx vitest run -u` and explain in the commit).
- A refactor meant to change nothing: hash `generateCity` for ~60 seeds first (`run-ts.mjs` in the
  scratchpad), compare after.
- A new prop, look or material: `renderer.info.programs` must not grow (browser run, on vs off).
- District tests and rules: `knowledge/DISTRICTS_DEV.md`.
