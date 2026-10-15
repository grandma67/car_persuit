# Car Pursuit: notes for Claude

A Three.js + Rapier browser driving game: a procedural city per seed, a mission of destinations,
cops, civilian traffic. TypeScript, Vite, Vitest. `PLAN.md` describes the game; `PLAN_DISTRICTS.md`
and `TASKS.md` (local, **never commit them**, nor `TODO.md` / `STAGE2_IDEAS.md`) describe the city
districts work in progress.

## Commands

| What | Command |
|---|---|
| Type check | `npx tsc --noEmit` |
| All tests | `npx vitest run` (~20 s) |
| One area | `npx vitest run src/world/districts` or `-t "name"` |
| Build | `npm run build` |
| Browser check | `npm run check:browser -- --query "seed=42&debug" --out <png> --eval "<js>" [--start 5000] [--size 390x844]` |

`scripts/browser-check.mjs` starts Vite, opens headless Chrome **muted** (always mute: the user hears
it otherwise), waits for the splash, optionally presses Start, evaluates a JS expression and saves a
screenshot. It prints JSON with the value and every console error, warning and exception. With
`?debug` the page exposes `window.game` (renderer, city, traffic, director …), so checks look like:

```
--eval "JSON.stringify({programs: game.renderer.info.programs.length, calls: game.renderer.info.render.calls, districts: game.city.districts.map(d => d.kind)})"
```

The Rapier "deprecated parameters" warning is pre-existing and harmless. Read the screenshot with
the Read tool to look at it. To compare against main, `git worktree add <scratch>/mainwt main`,
symlink `node_modules`, and run the script there with `--port 5299`.

## Working rules (from the user)

- **Git:** commit at each milestone, with a short subject and a structured body (bullets: what and why).
  Never push without asking.
- **Districts:** one branch per district (`districts/q0-framework`, `districts/oldtown`, …). At the
  end of a branch, **stop and wait for the user's approval**, then merge to main and branch the next
  one from main. Inside a branch, carry on through its milestones without asking.
- **Storage:** the site shares its origin with others; only touch the game's own localStorage keys.
- **Testing split:** Claude owns the *logic*: unit tests that the generation and the rules are
  right, plus the headless browser check (no errors, draw calls, shader programs, frame rate,
  screenshots). The user does the *feel* (does a chase through the gates feel right).

## Naming

- **Zone:** the distance ring every block is in: `downtown | midtown | residential | industrial`
  (`Zone`, `block.zone`, `building.zone`, `ZONE_STYLE`, `theme.facades[zone]`).
- **District:** a themed area laid over a rectangle of blocks: Old City (`oldtown`), Chinatown,
  Harbor, Farm (`District`, `DistrictDef`, `block.district`, `building.district` + `building.lot`,
  `city.districts`, `DISTRICTS` in balance, `?oldtown=0|1`). A district block keeps its zone.

## Architecture you need first

- `world/CityGenerator.ts` → `CityData` (pure data, no Three.js). `world/CityBuilder.ts` turns it into
  meshes and colliders; `world/PropSystem.ts` (breakables), `render/Landmarks.ts` (solid set pieces).
- **Determinism is sacred.** Every subsystem draws from its own stream, `new Rng(seed ^ SALT)`. The
  main `rng` in `generateCity` is shared in order (zone noise, parks, `fillBlock`, plazas, spawn), so
  never add a draw to it; give new features their own salt. A change that moves anything for
  existing seeds needs a reason.
- **Junction rules come from props.** `approachControls`, `fastStreets`, `busStops` read signals and
  signs. Never drop or move signals or `stop` / `priority` / `speed*` signs (`isJunctionControl`).
- Tuning numbers go in `gameplay/balance.ts`; generation config in `DEFAULT_CITY`.
- Buildings: `buildingGeometry` → `addBuilding(b, look: LotLook)`. One merged mesh per facade style
  (`render/Facades.ts`, 8×8 window cells), one shared roof mesh (`addRoof` dispatches on `RoofShape`,
  `addTrims` on `TrimKind`). Never give a lot its own mesh or material.

## Districts: how to build one well

The framework (Q0) lives in `src/world/districts/`:

- `District.ts`: types (`DistrictDef`, `District`, `DistrictDressing`, `LotLook` …).
- `place.ts`: `rollDistricts` (independent roll per def on `seed ^ salt`, URL force),
  `placeDistrict` (candidate rectangles, rejection rules, interior streets, gates, main street).
- `apply.ts`: `applyDistricts`, the overlay at the end of `generateCity` (refill from the district's
  stream, drop/swap props, zebras, dressing), plus helpers `kerbClutter`, `perimeterWall`,
  `isJunctionControl`, `inDistrict`.
- `runtime.ts`: what the game systems read: `districtTraffic` (speed caps, no-heavy streets, spawn
  mix), `copSpawnSkips`, `roadblockGates`, `districtOfNode`.
- `index.ts`: `DISTRICT_DEFS`, the registry in placement order.
- `render/districts/index.ts`: `DISTRICT_RENDERERS[kind]` draws structures, overhead and ground patches.

To add a district (each milestone in `TASKS.md` is a small step of this):

1. Write `world/districts/<Name>.ts` exporting a `DistrictDef`: values from the plan's table; tuning in
   `balance.ts` (`OLD_CITY` …). Register it in `index.ts`. It's playable from here (`?<kind>=1`).
2. `roles` / `lots` / `dress` stay **pure data** and use only the `rng` they're given. Put
   everything solid in `dressing.solids` (colliders and NavGrid come from there, not from meshes),
   off-road ground in `drivable`, and overhead pieces with their `bottom` ≥ `DISTRICTS.overheadClearance`.
3. Looks: add facade styles to `Facades.ts` (and `CAPS`), roof shapes in `addRoof`, trims in
   `addTrims`. Keep the shared material program (no new shader compiles).
4. A renderer in `render/districts/<Name>.ts`, registered in `DISTRICT_RENDERERS`. Instance anything
   repeated, merge static geometry per structure, and extend `prewarmShaders`.

Pitfalls already met:

- The grid is 12×12; midtown is a thin ring, and canals and town squares take many blocks. Placement
  rules that sound harmless can make a district almost never appear. **Measure the placement rate
  over ~40 seeds** whenever you add a rule (a quick test that counts `city.districts`), and look at
  rejection reasons if it's low. Roadworks only reject a cluster when they're inside it.
- Interior streets may be plaza (removed) edges: they're not streets and never gates.
- `perimeterWall` opens at *every* street crossing the wall line, not only gates; a
  `'mainStreet'` district has crossings without a gate.
- Don't derive a random pick list from a `Record` you extend: `LANDMARK_KINDS` (town square
  centrepieces) is an explicit list so new landmark kinds don't move every seed.
- Cops spawn 20 m down a side street, so district rules about spawns must test the spot
  (`skipAt(x, z)`), not the junction.
- A physics sim in a test must call `vehicle.snapshot()` after `world.step()`: `position` is the
  snapshot, so without it cars look parked at their spawn.
- `StreetProps.test` and `BuildingGeometry.test` use the default registry or `defs: []`; a new
  district shows up on their seeds, so district dressing is exempted where it's allowed to differ.
- Two "district" meanings existed once; if you read old commits, `district` there means zone.

## Testing districts

- `world/districts/Districts.test.ts` uses **stub definitions** (one inland, one coast) so the
  framework is tested without a real district. It covers rolls, the overlay invariant (everything
  outside the blocks and frontage is identical to the city without districts), placement rules,
  gates, main street, the wall loop, lots, clutter offsets and the runtime rules. Run it after any
  change in `world/districts`, `CityGenerator` or `lots.ts`.
- For a real district, add a `<Name>.test.ts` beside it. Force it on with
  `generateCity(seed, undefined, { force: { oldtown: true } })` over ~40 seeds (`i * 7919 + 11`),
  and assert the plan's tests as plain logic: geometry against road rects (`footprintsOverlap`,
  `rectFootprint`, `city.roads`, `city.intersections`), heights against `overheadClearance`, counts
  of lots and roles, junction controls unchanged. Prefer properties that hold on every seed over
  hand-picked seeds.
- `world/BuildingGeometry.test.ts` snapshots building geometry for every theme with no districts.
  If it fails, an ordinary building changed: that's a bug unless intended (then
  `npx vitest run -u` and say why in the commit).
- Before a refactor that must change nothing, record a fingerprint first (a throwaway test that
  hashes `generateCity` output for ~60 seeds into the scratchpad), refactor, then compare. Delete the
  throwaway test before committing.
- Browser check per milestone: the district forced on and off for the same seed, the screenshot,
  `renderer.info.programs` (must not grow), draw calls, console logs empty. Use `--size 390x844` for
  the phone viewport and read the HUD's FPS (`?debug` shows it).

## Working efficiently

- Read only the slice of a big file you need (`grep -n` first); `CityBuilder.ts`,
  `CivilianController.ts`, `CopDirector.ts` and `Game.ts` are long.
- Wire new hooks behind optional constructor parameters that default to "no district", so
  existing tests and seeds don't move.
- Commit per milestone, and keep `TASKS.md` ticked as you go (it's how the next session knows where
  things stand).
