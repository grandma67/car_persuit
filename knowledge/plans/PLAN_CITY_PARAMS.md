# Plan: city parameter files (JSON)

A city today is a function of its seed: dozens of rolls spread over `CityGenerator`, `Terrain`,
`Landmarks`, `Roadworks`, the districts, `Climate`, `CityTheme` and `Game`. To look at one situation
(Chinatown's festival on a flat night map, a harvest night, two crossing canals, a ramp next to a
roadworks site) we hunt for a seed that happens to roll it (`npm run find`, `flatSeeds`, seed 9 in
`check:restart`), and the seed breaks the next time a roll is added or moved.

**Goal:** split generation into two steps: **decide** (seed → `CityParams`, every random choice the
city makes, as plain JSON) and **build** (`CityParams` → `CityData`). Any of those choices can then be
pinned: by a JSON file when debugging, by feature words (`flat night chinatown festival`) in tests and
in `npm run city -- make`, instead of seeds that happen to have it.

**The pipeline, in one line each:**
- Seed only (the game, today): `rollCityParams(seed)` → params → `generateCity(params)`.
- URL flags: `rollCityParams(seed, urlOverrides(location))`, same as today.
- Words (tests, `city make`): `makeCityParams(words, { seed })` turns the words into overrides, calls
  `rollCityParams(seed, overrides)`, checks the words came true, else tries the next seed.
- A JSON file (debugging): `parseCityParams(json)` → overrides → `rollCityParams(file.seed, overrides)`.

So `rollCityParams(seed, overrides)` is the only place anything is rolled; everything else feeds it
overrides.

## Decisions

- **Two layers.** `rollCityParams(seed, overrides?) → CityParams` makes every roll. `generateCity(params)`
  makes none of the choices listed below; it only builds. `generateCity(seed, config, opts)` stays as a
  thin wrapper (`generateCity(rollCityParams(seed, …))`) so existing callers and tests keep working
  while they move over.
- **No seed moves.** With no file, `rollCityParams` makes exactly today's rolls in today's order, so
  every seed builds the identical city. Proven by hashing `generateCity` for 60 seeds before and after
  each refactor milestone, plus the `BuildingGeometry` snapshots.
- **Draw, then override.** Where a pinned value replaces a roll inside a shared stream (the main `rng`,
  a district's `seed ^ salt` stream), the roll is still drawn and its result thrown away:
  `const festival = pin(cfg.festival, rng.next() < CHINATOWN.festivalChance)`. Pinning one value then
  never shifts the draws after it, so a file that pins only the festival still gets the seed's lots,
  roles and dressing. Rolls whose draw count depends on the choice (district placement, `planLandmarks`)
  cannot keep later draws aligned; there the pinned value is followed by whatever its stream draws next.
  **That's accepted (user decision B):** a params city is "the params + its seed for the rest", and it
  is repeatable. If a test needs something to stay put, that thing gets a field in the params.
  Nothing extra (no sub-salts) is done to keep unpinned parts identical to the seed.
- **Partial params.** Params have a `seed` and only the fields someone pinned; everything left out is
  rolled from that seed as usual. `dump`/`dbg.dumpCity` write complete files; a hand-trimmed debug
  file can be a few lines.
- **A dump reloads as the identical city.** That's the whole point of `dbg.dumpCity` while debugging,
  and it must hold despite pinning skipping draws. Where a pinned value skips a *variable* number of
  draws (district placement; `planLandmarks` when its list is given), the dump also records that
  stream's state right after the skipped part, as an opaque number (`"stream": 2836104477`); on load
  the stream resumes from it. `Rng` gets a state getter and a `resume(state)` constructor for this.
  Hand-made or word-made params don't carry it, and their district interiors roll from wherever
  pinned placement left the stream, which is accepted (decision B below).
- **Grid units, not metres.** Positions are grid indices (`i`, `j`, road lines, block coordinates), so
  a file stays readable, editable by hand and valid if `blockSize`/`roadWidth` tuning changes.
- **No props.** Street props (lamps, signs, signals, benches, cones), plaza planters, trees, single
  buildings (heights, lots in a block) and district dressing pieces (containers, graffiti, wrecks,
  stalls) stay seed-driven and are not in the file. They're the bulk of the data, and junction rules
  come from the signals and signs (`isJunctionControl`), which must stay generated from the graph.
  Roadworks cones follow their site (the site is in the file).
- **URL flags unchanged.** `?seed`, `?time`, `?<district>=0|1`, `?roadworks`, `?canalramp`, `?england`,
  `?canals`, `?blocks`, `?city`, `?weather`, `?hill` keep their exact meaning (including which need
  `?debug`). They become one function, `urlOverrides(params) → Partial<CityParams>`, fed into
  `rollCityParams`, instead of edits to `config` inside `Game`. **No new URL flag**: files load
  through the debug tools (below), not the URL. The share link keeps carrying only the seed.
- **Validated, never silently fixed.** A file that asks for something impossible (a canal on the ring
  road, a district over a bridge, plazas that cut the network, a festival without Chinatown) fails with
  a list of reasons naming the field. It is never quietly rolled differently. Things that are possible
  but won't show, or look off, are **warnings** (user decision C): a night-only feature (festival,
  harvest) with `time` not night, a pinned district rect outside its zone rules (`rings`, `minShare`),
  a theme that doesn't suit the climate.
- **One generator, two front ends (user decision D).** `world/makeCityParams.ts` turns a list of
  words into valid `CityParams`. `npm run city -- make <words…>` is the command line over it and
  writes the JSON. Tests call `makeCityParams([...])` directly with the same words. The repo holds no
  fixture `.json`: what a test needs is in the test, as the words it asks for.
- **One vocabulary, the URL's spelling first.** A word that exists as a URL flag is spelled and means
  exactly what the flag does: `england`, `roadworks` (every slot), `canalramp`, `<district>=0|1`
  (force on/off, the rest still rolled), `time=`, `canals=`, `blocks=`, `city=`, `weather=`, `hill=0|1`.
  New words only for what the URL can't say:
  - a bare district name (`harbor`, `chinatown farm`): **exactly** these districts, no others;
  - its features by name (`festival`, `harvest`, `maze`, `camp`, `!festival` for off), from each
    district's declaration;
  - `flat` (no hill, no canals), `roadworks=N` (N sites, 0 = none), `canalramps=N`, `ramps=N`,
    `canalwidth=W`, `startminute=M`, `theme=`.
  URL flags parse through the same table, so `urlOverrides` is `makeCityParams`' parser applied to
  the query string, limited to the URL words (and their `?debug` gating). No new URL flag comes of it.
- **Runtime AI randomness is out.** Cop/civilian streams (`seed ^ 0xc095`, `seed ^ 0x7a4f1c`) and the
  cosmetic `Math.random` (smoke, scratches) aren't city parameters. Mission destinations are in, since
  they're a per-seed placement and the usual way an event gets reached.

## Scope: trimmed (user decision A)

**Pinnable in v1:** climate, weather, time, start minute, theme; blocks, drive side; hill, canals,
bridges; **plazas** (kept in because they change what a district gets: a plaza inside a district,
a quay square on its edge, the Farm's paved field exits); ramp landmarks and canal ramps (on/off and
count, by edge when given); roadworks sites; spawn; destinations; districts (kind, rect, features).
District features that are really special blocks (Slums camp and junkyard, Chinatown's pagoda
square, Harbor yards) are pinned as features. The district picks the block.

**Dumped but read-only in v1** (shown by `dump`/`show`): the zone map and parks, non-ramp landmark
kinds and blocks, district roles by block. On load they aren't pinned; they're compared with what
got built, and a difference is a warning (a stale dump), silent otherwise. Each can become pinnable
later without breaking files (`version`). Add one when a test needs it, not before.

**Dropped from v1:** `city min`, drag-and-drop (the `dbg.loadCity` console call does the same).
The generated JSON Schema is still a maybe: worth it only if hand-editing dumps turns out common.

## What a file holds (schema v1)

```jsonc
{
  "version": 1,
  "seed": 9,                       // everything not listed below rolls from this
  "note": "Chinatown festival, flat, night",

  // --- the run's look (Climate, CityTheme, startHour) ---
  "climate": "temperate",          // temperate | snow | beach | desert
  "weather": "clear",              // clear | rain | snow (same climate fix-ups as ?weather)
  "time": "night",                 // day | afternoon | night
  "startMinute": 12,               // the minutes startHour adds from the seed
  "theme": "brick",                // building style name from CityTheme (with its seed nudge)

  // --- layout ---
  "blocks": 12,                    // grid size (rollCityBlocks)
  "driveSide": "right",            // rollDriveSide
  "terrain": {
    "hill": { "at": [5.5, 7], "height": 14, "radius": [260, 310], "yaw": 0.2 },   // or null
    "canals": [{ "axis": "x", "line": 6, "width": 40, "bridges": [1, 4, 8, 11] }]
  },
  "plazas": ["h3,4", "v7,2"],      // inner road segments paved over (edge keys as in edgeIndex)
  "zones": [                       // READ-ONLY in v1. One row per j, one char per block: D M R I; lower case = park
    "RRRMMMMMRRII",
    "…"
  ],
  "landmarks": [                   // ramps pinnable; the rest READ-ONLY in v1
    { "kind": "fountain", "block": [6, 5] },
    { "kind": "ramp", "edge": "h4,8", "dir": 1 }
  ],
  "landmarkStream": 912334051,     // dumps only: resumes planLandmarks' stream (see "A dump reloads…")
  "canalRamps": [{ "edge": "v6,3", "dir": -1 }],
  "roadworks": [{ "node": [4, 9] }, { "edge": "h8,2" }],
  "spawn": { "node": [6, 6], "toward": [6, 7] },
  "destinations": [[2, 3], [10, 1], [7, 11], [1, 9], [11, 6]],

  // --- districts (the whole list when given; [] = none) ---
  "districts": [
    {
      "kind": "chinatown",
      "rect": { "i": 3, "j": 4, "w": 3, "h": 2 },   // grid rectangle; omitted = placed by its stream
      "stream": 2836104477,                          // dumps only: the stream right after placement
      "roles": { "4,5": "pagodaSquare" },            // READ-ONLY in v1
      "features": { "festival": true, "banquet": false, "temple": true }
    },
    { "kind": "farm", "features": { "harvest": true, "maze": true } }
  ]
}
```

`features` per district are its own named rolls, from `balance.ts` and the district modules:
Old City (wall shape, ruins), Chinatown (`square`, `banquet`, `temple`, `festival`), Harbor (`silo`,
`tankFarm`, ship kind, `tug`), Farm (`silo`, `waterTower`, `maze`, `harvest`), Slums (`camp`,
`junkyard`, `train`). M0 lists each one with its code site. Per-street rolls (`dumpsterChance`,
`driftChance`, `gateClutter`, per-lot shares) count as props and stay out.

Each district module declares its features in its `DistrictDef` (`features: { festival: 'bool', … }`),
so the validator, `dump` and `show` read them from the registry, and a new district adds
its own without touching the framework.

## The script: `npm run city`

`scripts/city.ts` via `run-ts.mjs` (like `find`/`stats`):

- **`npm run city -- make <words…> [seed=N] [--out f.json]`: the main command.** Params with the
  words come true, e.g. `make flat night chinatown festival` or `make canals=2 canalramps=2
  roadworks=1 england`. Everything unnamed rolls from the seed (random if none given). It may move to
  a later seed to meet a word, and prints the seed it used. If a word can't be met, it fails and says
  why; it never hands back a city without the feature.
- `npm run city -- dump <seed> [URL words…] [--out f.json]`: the complete params of exactly that seed
  with those URL flags, i.e. what the game builds for `?seed=N&…`. Never moves the seed, so a link
  you were sent turns straight into a file.
- `npm run city -- check <file…>`: validate. Prints errors and warnings, exit 1 on errors.
- `npm run city -- show <file|seed|words…>`: an ASCII map (zones, parks, plazas, canals, bridges,
  districts, roadworks, spawn, destinations) plus a one-line summary, so you can see a city without
  the browser.
- `npm run find` prints `npm run city -- dump N …` next to each hit.

Files written by the script go wherever `--out` says (the scratchpad by default for checks); none are
committed.

## In the game (debug only)

- With `?debug`: `dbg.loadCity(json)` in the console. The game restarts in place (`Game.restart`
  already does Retry/New city in place) with those params.
- `dbg.dumpCity()` downloads the current run's resolved params. **This is the main debugging gain:**
  something odd happens on a random run → dump → `city show` it, reload it with `dbg.loadCity` while
  fixing → turn what mattered into `makeCityParams` words in a test.
- Retry keeps the params; New city goes back to a random seed. The share link shares the seed only (a
  params city isn't shareable by URL, by design).
- `npm run check:browser -- --city <file>`: the checker loads the params through `dbg.loadCity` after
  the page starts (no URL flag). `check:restart` runs `city make` for all five districts + `festival
  harvest night rain` into the scratchpad and loads that file, instead of `seed=9&…`.

## Milestones

Branch `city-params` from main. Commit per milestone; the full suite (`npm run t`) and `npx tsc
--noEmit` before each commit. At the end, stop for the user's approval before merging.

**M0: audit and baseline.**
- A table (in this file) of every roll that shapes the city, with its file, stream (main `rng` or
  salt) and draw order. Note dead knobs as found (e.g. `SLUMS.trainChance` appears only in
  `balance.ts`; confirm where the train is actually rolled).
- `scripts/city-hash.ts` (kept, not scratch): hashes `CityData` (minus the graph object's identity)
  for seeds `i * 7919 + 11`, i < 60, with defaults and with all districts forced. Write the baseline.

**M1: `CityParams` for the layout (refactor, no seed moves).**
- `world/CityParams.ts`: the type, `rollCityParams`, `pin()`.
- Pull out of `generateCity`: blocks, drive side, terrain (`planTerrain` split into roll and build),
  bridges (`pickBridges`), plazas, zones and parks (noise still drawn from the main `rng`, then
  overridden), landmarks (`planLandmarks` takes an optional list), canal ramps, roadworks sites, spawn.
- `generateCity(params)` builds from them; the old signature wraps it.
- Hash identical for all 60 × 2 cities; snapshots unchanged.

**M2: districts.**
- `rollDistricts`/`placeDistrict`/`overlay` take the pinned list: kind set, rect (placement skips the
  candidate search but runs every `tryPlace` check, which now returns *why* it failed), roles,
  features. The order shuffle stays for unpinned placements.
- Each district's feature rolls go through `pin()` with their `DistrictDef.features` declaration.
- `?<district>=0|1` becomes an override on the list. Hash identical.

**M3: the run's look and the mission.**
- Climate, weather, time, start minute, theme and destinations into `CityParams`; `Game` reads them
  from the params instead of calling `pickClimate`/`pickWeather`/`pickTimeOfDay`/`pickTheme`/`startHour`
  /`pickDestinations` itself. Night-only dressing (`nightProps`, `joinRunDressing`) keys off
  `params.time`.
- All URL handling moves into `urlOverrides()`; `Game` stops reading `window.location` for city
  choices. A test table: each existing flag → the same params as today's code path.

**M4: JSON in and out.**
- `parseCityParams(json) → { params, errors }` (versioned, unknown keys are errors), `serialize`
  (stable key order, compact rows for `zones`), `validate` (all rules in one place: grid bounds, canal
  lines and spacing, a bridge per run, plaza connectivity and degree, ramp/roadworks/district clearances,
  features only for present districts, night-only features vs `time`, which is a warning).
- No new dependency: hand-written validator.
- `world/makeCityParams.ts`: the vocabulary table (see "One vocabulary"), parsed from strings so the
  CLI, the tests and the URL share it. How it meets a word: pin the field directly when it can (time,
  terrain, roadworks, features); for things that depend on the layout (a district needing room, a
  canal ramp needing a quay street), pin what it can, build, and if the word isn't met, try the next
  seed (bounded, deterministic order from the given seed), then fail with the reason.
- `urlOverrides` switches to that parser (URL words only); the M3 flag table must still pass.
- `scripts/city.ts` with `make`, `dump`, `check`, `show`; `find` prints the dump hint.
- Tests for `makeCityParams`: every word in the vocabulary gives a city that has it, for 10 base seeds.
- Round trip test: for 60 seeds × (defaults, all districts forced), `parse(serialize(dump(seed)))`
  builds the same hash as the seed. This is what proves "a dump reloads as the identical city"
  (stream states included).

**M5: the game.**
- `dbg.loadCity` / `dbg.dumpCity`; Retry keeps params; New city clears them.
- `check:browser --city <file>`; run `check:restart` (held params must be freed by `Game.dispose()`);
  it moves to `city make` in M6.
- Browser check: a dumped file loaded back renders the same city as its seed (screenshot pair, same
  draw calls, `renderer.info.programs` unchanged).

**M6: tests move off seeds.**
- Tests get their cities from `makeCityParams` (no JSON on disk), e.g.
  `generateCity(makeCityParams(['flat', 'harbor']))` or `makeCityParams(['canals=1',
  'canalramps=1'], { seed })`. A few-line helper may wrap the common ones, but it only passes words
  through, so a test and `npm run city -- make` always mean the same thing.
- **Every test that uses a constant seed, or searches seeds, to get a feature moves to `makeCityParams`.**
  From the current suite:
  - `trafficSim.flatSeeds` (Harbor, Farm, Slums, OldCity, Chinatown traffic) → `['flat', kind, …features]`.
  - `Landmarks.test`: `it.each([3, 8, 21, 77])` canal ramp seeds, and the loops hunting for 0 / 1 ramps
    → `canalramps=N`, `ramps=N`.
  - `Roadworks.test` `withWorks`, `CopSpawn` `roadworksChance: 0` → `roadworks=N` / `roadworks=0`.
  - `Terrain.test` `canalWidth` configs, `TrafficControl` `canalOdds: [1,0,0]` → `canals=N`, `canalwidth=W`.
  - `TrafficControl` via `leftHandChance: 1` → `england`.
  - `MissionSystem` and `CityGenerator` `blocks: 4` / `sized()` → `blocks=N`.
  - Feature tests that filter seeds for one that has it (Farm maze and harvest + desert irrigator,
    Chinatown festival, Slums junkyard/camp, Chinatown pagoda square) → pin it on, and one test pinning
    it off.
  - `check:restart`'s `seed=9&…` → `city make oldtown chinatown harbor farm slums festival harvest
    night rain`, written to the scratchpad and loaded with `--city`.
- **Stay on seeds**, because there the seed *is* the subject: the 40-seed invariant sweeps in the
  district suites (now run through `rollCityParams`, same seeds, same cities), the "rolled per seed"
  and "rare" tests (`rollDriveSide`, ramp/feature frequency, determinism `42 === 42`), and generic
  "some cities" lists like `[1, 42, 1234]` that only want variety, not a feature.
- New generator tests: each pinned field ends up in the built city (canal where asked, the district at
  its rect, the festival on), invalid params fail with the right reason, warnings come back for
  night-only features on a day run.
- Per test file, compare the time before and after; the suite must stay within today's ~20 s.
  Pinned scenarios should make some files faster (no seed hunting).

**M7: docs.**
- `CLAUDE.md`: the `npm run city` commands, "a test that needs a feature builds its params with
  `makeCityParams` (or `npm run city -- make`), never a constant seed or a committed JSON; seeds for sweeps and roll
  tests only", the `pin()` rule (draw, then override) under Determinism.
- `PLAN_GAME.md` (debug tools, no URL change), `DISTRICTS_DEV.md` (declare `features`, use `pin()`,
  add each new feature word to `makeCityParams`, use it in Testing), `BROWSER_CHECKS.md` (`--city`, `dbg.loadCity`/`dumpCity`).
- `npm run find` stays for discovery; its output points at `city dump`.

## Risks

- **Seed drift during the refactor.** It's the biggest risk, and the hash script guards it at every
  milestone. A milestone doesn't get committed with a changed hash unless the change is the point,
  and then the commit says so.
- **Pinned but invalid.** A rect that passes the validator might still meet a case `tryPlace` rejects
  (a hill grade, a ramp node). The build then fails with `tryPlace`'s reason; it never falls back.
- **Words drifting from what tests mean.** `flat` must keep meaning flat. The `makeCityParams` test
  asserts every word's promise (no hill, no canals; the district placed; the feature on).
- **Seed retries.** A word met only by trying later seeds makes the result depend on the generator.
  That's fine for tests (they assert the feature, not the seed). `make` prints which seed it used.
- **What a dump does *not* freeze.** A dump pins the v1 fields, not the props or the lots inside a
  block: those still come from the seed through today's code. Reloading a dump with the same code gives
  the identical city; after a code change to props or lots, the pinned layout and features stay and
  the furniture may differ. That's the line we drew by leaving props out.
- **Old dumps.** `version` bumps come with a migration in `parseCityParams`, never a silent
  reinterpretation. There are no committed files to migrate.
