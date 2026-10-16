# Car Pursuit: notes for Claude

Three.js + Rapier browser driving game (TypeScript, Vite, Vitest): procedural city per seed, mission
destinations, cops, civilian traffic. `PLAN.md` = the game. `PLAN_DISTRICTS.md`, `TASKS.md`, `TODO.md`,
`STAGE2_IDEAS.md` are local: **never commit them**.

## Commands

- Type check: `npx tsc --noEmit`
- Tests: `npm run t` (~20 s, prints only failures + summary, killed after 300 s, `T_LIMIT=`). Area:
  `npm run t -- src/world/districts`, `-t "name"`. Never pipe vitest through `grep`/`tail` without a limit.
- District numbers: `npm run stats -- oldtown [seeds=100]` (placement rate forced/natural, shapes,
  gates, avg lots/landmarks/props/structures, gen ms on vs off)
- One-off TS script: `node scripts/run-ts.mjs <file.ts> [args]` (default export gets args). Use for
  numbers instead of scratch tests (vitest swallows `console.log`).
- Rapier: `node scripts/rapier-bench.mjs 0.18.2 <new>`; see `RAPIER.md` (stay on 0.18.2).
- Build: `npm run build`
- Browser: `npm run check:browser -- --query "seed=11&debug&oldtown=1" --start 2000 --out-dir <dir> --no-final --eval-file <file.js>`

**Browser checks** (`scripts/browser-check.mjs`): headless Chrome, always **muted**. Reuses a Vite
server on the port: start `npx vite --port 5199` once per session in the background (~10 s per run).
With `?debug`, `window.game` and `window.dbg` (`src/core/debugTools.ts`) exist; `await shot('name')`
any number of times, so **one run per milestone with all its views**. Eval file goes in the scratchpad:

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

`dbg`: `district(kind?)`, `place(x,z,yaw,speed)`, `view(point,{dist})` (picks a clear road spot; never
place the car by hand), `gate(i,{back,speed,lateral})`, `find(kind)` (landmark/structure/prop/lot),
`hold(code,ms)`, `stars(n)`, `fps(ms)`, `stats()` (programs, calls, triangles, static triangles), `car()`.
Output JSON: `val`, `shots`, console errors/warnings (Rapier deprecation filtered). Read only needed
screenshots. Compare with main: `git worktree add <scratch>/mainwt main`, symlink `node_modules`, `--port 5299`.

## Working rules (from the user)

- **Git:** commit per milestone, short subject + bulleted body (what and why). Never push without asking.
- **Districts:** one branch each (`districts/q0-framework`, `districts/oldtown`, …). At branch end,
  **stop for the user's approval**, then merge to main and branch the next from main. Within a branch,
  do all milestones without asking. Keep `TASKS.md` ticked (it tells the next session where things stand).
- **Storage:** origin is shared; touch only the game's own localStorage keys.
- **Testing split:** Claude owns logic (unit tests of generation/rules + headless browser check: no
  errors, draw calls, programs, fps, screenshots). The user judges feel.

## Naming

- **Zone:** distance ring of a block: `downtown | midtown | residential | industrial` (`Zone`,
  `block.zone`, `building.zone`, `ZONE_STYLE`, `theme.facades[zone]`).
- **District:** themed area over a rectangle of blocks: Old City (`oldtown`), Chinatown, Harbor, Farm
  (`District`, `DistrictDef`, `block.district`, `building.district` + `building.lot`, `city.districts`,
  `DISTRICTS` in balance, `?oldtown=0|1`). A district block keeps its zone. In old commits "district" meant zone.

## Architecture

- `world/CityGenerator.ts` → `CityData` (pure data). `world/CityBuilder.ts` → meshes + colliders;
  `world/PropSystem.ts` breakables; `render/Landmarks.ts` solid set pieces.
- **Determinism is sacred.** Each subsystem uses its own `new Rng(seed ^ SALT)`. The main `rng` in
  `generateCity` is shared in order (zone noise, parks, `fillBlock`, plazas, spawn): never add a draw
  to it; new features get a new salt. Anything that moves existing seeds needs a reason.
- **Junction rules come from props**: `approachControls`, `fastStreets`, `busStops` read signals/signs.
  Never drop or move signals or `stop`/`priority`/`speed*` signs (`isJunctionControl`).
- Tuning → `gameplay/balance.ts`; generation config → `DEFAULT_CITY`.
- Buildings: `buildingGeometry` → `addBuilding(b, look: LotLook)`. One merged mesh per facade style
  (`render/Facades.ts`, 8×8 window cells), one shared roof mesh (`addRoof` by `RoofShape`, `addTrims` by
  `TrimKind`). Never give a lot its own mesh or material.
- Big files (`CityBuilder`, `CivilianController`, `CopDirector`, `PropSystem`, `Game`): `grep -n`, read slices.
- New hooks: optional constructor params defaulting to "no district", so tests and seeds don't move.

## Districts

Framework in `src/world/districts/`: `District.ts` (types: `DistrictDef`, `District`,
`DistrictDressing`, `LotLook`…); `place.ts` (`rollDistricts`: independent roll per def on
`seed ^ salt` + URL force; `placeDistrict`: candidate rects, rejection rules, interior streets, gates,
main street); `apply.ts` (`applyDistricts` overlay at end of `generateCity`: refill from district
stream, drop/swap props, zebras, dressing; helpers `kerbClutter`, `perimeterWall`, `isJunctionControl`,
`inDistrict`); `runtime.ts` (`districtTraffic` speed caps/no-heavy/spawn mix, `copSpawnSkips`,
`roadblockGates`, `districtOfNode`, `nightProps` = `dressing.extra.nightProps`, joined to
`city.streetProps` by `Game` only on night runs; generation never depends on time); `index.ts`
(`DISTRICT_DEFS`; placement order is shuffled per seed on `DISTRICTS.orderSalt`); `render/districts/index.ts` (`DISTRICT_RENDERERS[kind]`:
structures, overhead, ground patches).

Adding one (each `TASKS.md` milestone is a step):

1. `world/districts/<Name>.ts` exports a `DistrictDef` (plan's table values; tuning in `balance.ts`,
   e.g. `OLD_CITY`); register in `index.ts`. Playable via `?<kind>=1`.
2. `roles`/`lots`/`dress` are **pure data** using only the given `rng`. Solids in `dressing.solids`
   (colliders + NavGrid come from there, not meshes), off-road ground in `drivable`, overhead pieces
   with `bottom` ≥ `DISTRICTS.overheadClearance`.
3. Looks: facade styles in `Facades.ts` (+ `CAPS`), roofs in `addRoof`, trims in `addTrims`. Keep the
   shared material program (no new shader compiles).
4. Renderer `render/districts/<Name>.ts` in `DISTRICT_RENDERERS`: instance repeats, merge static
   geometry per structure, extend `prewarmShaders`.

Pitfalls:

- Grid is 12×12, midtown is a thin ring, canals and town squares take many blocks: harmless-sounding
  rules can kill placement. **Measure placement rate** (`npm run stats`) after any rule; check rejection
  reasons if low. Roadworks only reject a cluster when inside it.
- Interior streets may be removed plaza edges: not streets, never gates.
- `perimeterWall` opens at *every* street crossing the wall, not just gates (`'mainStreet'` districts
  have gateless crossings).
- Never derive a random pick list from an extendable `Record`: `LANDMARK_KINDS` is an explicit list.
- Cops spawn 20 m down a side street: spawn rules must test the spot (`skipAt(x, z)`), not the junction.
- Physics sim in tests: call `vehicle.snapshot()` after `world.step()` (`position` is the snapshot).
- `StreetProps.test` / `BuildingGeometry.test` use the default registry or `defs: []`; new districts
  appear on their seeds, so exempt district dressing where it may differ.

## Testing districts

- `Districts.test.ts` uses **stub defs** (one inland, one coast): rolls, overlay invariant (all outside
  the blocks + frontage identical to no-district city), placement, gates, main street, wall loop, lots,
  clutter offsets, runtime rules. Run after any change in `world/districts`, `CityGenerator`, `lots.ts`.
- Real district: `<Name>.test.ts` beside it, `generateCity(seed, undefined, { force: { oldtown: true } })`
  over ~40 seeds (`i * 7919 + 11`). Assert plan tests as logic: geometry vs road rects
  (`footprintsOverlap`, `rectFootprint`, `city.roads`, `city.intersections`), heights vs
  `overheadClearance`, lot/role counts, junction controls unchanged. Prefer all-seed properties.
- `BuildingGeometry.test.ts` snapshots no-district geometry per theme; a failure is a bug unless
  intended (then `npx vitest run -u`, explain in commit).
- Refactor meant to change nothing: first hash `generateCity` for ~60 seeds (`run-ts.mjs` in scratchpad),
  then compare after.
- Traffic/cops on a real city: copy `OldCityTraffic.test.ts` (civilian sim + spawn count), don't
  extend the synthetic junction sims.
- Run area tests while editing; full suite once per milestone before commit.
- Browser check per milestone, on and off (`?<kind>=1`/`=0`, same seed): views, `dbg.stats()`
  (programs must not grow), empty console; perf with `--size 390x844` + `dbg.fps()` (capped at 60, shows
  only drops). Stills can't show flicker/feel: verify geometry, leave feel to the user.
- New prop/landmark/look: confirm `renderer.info.programs` unchanged in the browser run (same material
  settings as an existing mesh; `InstancedMesh` only with an existing instanced material).
- No z-fighting: never overlap coplanar faces. Butt-join exactly or stand one part 2–3 cm proud; ground
  layers ≥ 2 cm apart or `polygonOffset` on the lower (asphalt 1/1, street cobbles 0.5/0.5, markings none).
