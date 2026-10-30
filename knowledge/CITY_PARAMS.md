# City params: how a city is decided

Read before adding a roll, a district feature or a word. Why it was built this way and what changed
from the plan: [plans/PLAN_CITY_PARAMS.md](plans/PLAN_CITY_PARAMS.md).

Every choice that shapes a city is a field of `CityParams` (`world/CityParams.ts`), plain JSON, so any
of them can be pinned: by feature words in tests and `npm run city -- make`, by a JSON file while
debugging. Pure data, no Three.js.

## Pipeline

- **Seed (the game):** `rollCityParams(seed, overrides?)` rolls the up-front choices (climate, weather,
  time, start minute, theme, grid size, drive side) and passes the rest through as pins.
  `generateCity(params)` resolves every later choice where it builds it, `pin(params.x, roll)`, and
  returns the complete set as `city.params` (plus `city.warnings`). One pass, no second build.
- **URL flags:** `urlOverrides(search, debug)` (`world/makeCityParams.ts`) → overrides. `Game` never
  reads the URL for city choices.
- **Words:** `makeCity(words, { seed, tries })` → `{ params, city }`; `makeCityParams` → params only.
  Pins what it can, builds, and if a word isn't met tries `seed+1, seed+2, …` (100 tries by default),
  then fails naming the word. Never hands back a city without the feature.
- **File:** `readCityParams` (`world/CityParamsFile.ts`): `parseCityParams` (version 1; unknown keys and
  bad shapes are errors) then a build. `serializeCityParams` writes `CITY_KEYS` order, anything ≤ 100
  chars on one line.
- `generateCity(seed, config, opts)` still works and builds exactly what it always did (it wraps
  `rollCityParams`); `generateCity(seed)` uses the config's fixed 12-block grid, `generateCity({ seed })`
  and words roll it (8–15) like the game.

## Rules

- **Draw, then override.** A pinned value inside a shared stream still makes its draw:
  `pin(cfg.festival, rng.next() < CHINATOWN.festivalChance)`. Pinning one value never shifts the draws
  after it. Where the draw count depends on the choice (district placement, landmarks), later draws
  can't stay aligned; accepted: a params city is "the params + its seed for the rest", repeatable.
  If a test needs something to stay put, it gets a field.
- **No seed moves.** With no pins every seed builds the identical city. `npm run hash -- --vs HEAD`
  (120 cities) before each commit; `--reload` proves every dump reloads as its city.
- **Partial params.** A file has `seed` and only what was pinned; the rest rolls from the seed.
  Dumps are complete; a hand-trimmed file can be a few lines.
- **Grid units, not metres** (indices, road lines, edge keys `h4,8` / `v6,3`), except the hill (metres
  from the island centre: a grid → metre conversion moved it by an ulp).
- **Not in params:** street props, plaza planters, trees, single buildings and lots, district dressing
  pieces (junction rules come from signals and signs, which must stay generated), runtime AI streams
  (cops `seed ^ 0xc095`, civilians `seed ^ 0x7a4f1c`), cosmetic `Math.random`. So after a code change to
  props or lots a dump keeps its layout and features but the furniture may differ.
- **Validated, never silently fixed.** Impossible pins (a canal on the ring road, a district over a
  bridge, plazas cutting the network, a feature without its district) throw `CityParamsError` with
  reasons naming the field; a pinned rect that `tryPlace` rejects fails with its reason. Possible but
  odd is a **warning**: a night-only feature by day, a rect outside its zone rules, a theme the climate
  never rolls, weather fixed up by the climate.
- **Read-only fields** (`zones`, non-ramp `landmarks`, district `roles`): dumped and compared on load (a
  difference warns: stale dump), never pinned. Make one pinnable only when a test needs it.
- **No committed JSON.** Tests hold their words; `npm run city` writes wherever `--out` says.
  A `version` bump comes with a migration in `parseCityParams`.

## Schema (v1, as built)

```jsonc
{
  "version": 1, "seed": 9, "note": "…",
  "climate": "temperate",            // temperate | snow | beach | desert
  "weather": "clear",                // clear | rain | snow (climate fix-ups as ?weather)
  "time": "night",                   // day | afternoon | night
  "startMinute": 12,
  "theme": "Old Brick",              // CityTheme style name (its colour jitter stays seeded)
  "blocks": 12,                      // 4–30 accepted; the game rolls 8–15
  "driveSide": "right",
  "terrain": {
    "hill": { "x": 40, "z": -20, "height": 14, "rx": 260, "rz": 310, "yaw": 0.2 },  // null/false: none; true: rolled
    "canals": [{ "axis": "x", "line": 6, "width": 40, "bridges": [1, 4, 8, 11] }],  // or a count
    "canalWidth": 30                 // every rolled canal this wide
  },
  "plazas": ["h3,4", "v7,2"],        // inner road edges paved over
  "zones": ["RRRMMMMMRRII", "…"],    // read-only: a row per j, D M R I, lower case = park
  "landmarks": [{ "kind": "fountain", "block": [6, 5] }, { "kind": "ramp", "edge": "h4,8", "dir": 1 }],
  "ramps": 2,                        // count; street ramps pinnable by edge, the rest read-only
  "canalRamps": [{ "edge": "v6,3", "dir": -1 }],               // or a count, or "all" (?canalramp)
  "roadworks": [{ "node": [4, 9] }, { "edge": "h8,2", "stream": 123 }],  // or a count, or "all"; stream: dumps only
  "spawn": { "node": [6, 6], "toward": [6, 7] },
  "destinations": [[2, 3], [10, 1], [7, 11], [1, 9], [11, 6]],
  "districts": [                     // exactly these; [] = none; rect omitted = placed by its stream
    { "kind": "chinatown", "rect": { "i": 3, "j": 4, "w": 3, "h": 2 },
      "roles": { "4,5": "pagodaSquare" }, "features": { "festival": true, "square": true } }
  ],
  "force": { "harbor": true }        // the URL's <district>=0|1: that roll forced, the others rolled
}
```

A district list places in its own order and first tries the seed's own placement, so a dump's rects
reload the same; only a differing hand-pinned rect goes through `tryPlace`. Pinned street ramps replace
the rolled ones after the squares roll, so the landmark stream never changes.

## Words (`WORDS` in `world/makeCityParams.ts`; `npm run city -- words` lists them)

- **URL words**, same spelling and meaning as the flag: `england`, `roadworks` (every slot) /
  `roadworks=N`, `canalramp`, `time=`, `blocks=`, `<district>=0|1` (forces that roll, others rolled);
  with `debug` only: `city=`, `weather=`, `canals=`, `hill=0|1`. `urlOverrides` is this parser on the
  query string; debug-only words without `debug` are ignored with a note.
- **Words only:** a bare district name = **exactly** the districts named; `flat` (no hill, no canals);
  `canalramps=N`, `ramps=N`, `canalwidth=W`, `startminute=M`, `theme=`. Aliases: `night`/`day`/
  `afternoon`, `rain`/`clear`/`snow` (snow also sets the snow climate), `temperate`/`beach`/`desert`.
- **Feature words** come from each def's `features`: `festival`, `!festival` (only on/off features take
  `!`), `ship=bulk`, `yards=N`, `harbor.silo` (a feature word brings its district into the list).
  Two words wanting one field differently are an error.

## District features

Each district declares `features` (`'bool'`, `'int'` or a list of names; night-only in
`nightFeatures`) and rolls them through `feature(q, name, roll)` on its own stream, in this order;
`DistrictDef.built(q, city)` reports what was actually built (for the word checks).

| District | Feature | Where | Roll |
|---|---|---|---|
| Old City | `roundTowers` (round or square towers) | `OldCityWalls.wallDressing` | 0.5 |
| Chinatown | `square` (pagoda square role), `banquet`, `temple`, `festival` (night) | `roles`; `lots`; `lots`; `nightExtras` | `*Chance` |
| Harbor | `yards` (count, role), `silo`, `tankFarm`, `ship` (container/bulk/general), `tug` | `roles`; `lots`; `lots`; `HarborQuay.quay` | `int(HARBOR.yards)`, `*Chance`, `shipOdds` |
| Farm | `steelSilos` (the silos' look; there are always 1–3), `waterTower`, `maze`, `harvest` (night) | `FarmGate.yardPieces`; `Farm.dress` | 0.5, `*Chance` |
| Slums | `camp`, `junkyard` (roles; junkyard `false` when no block is spare) | `Slums.roles` | `campChance`, `junkyardChance` (drawn only below 9 blocks) |

Not features: Old City ruins (per-lot `ruinShare`, i.e. props); `SLUMS.trainChance` (read nowhere, no
train exists); per-street rolls (`dumpsterChance`, `driftChance`, `gateClutter`, lot shares).

## Every roll that shapes a city

Streams are `new Rng(seed ^ salt)` unless "main" (`new Rng(seed)` in `generateCity`, shared in order;
never add a draw to it). Draw order top to bottom.

| What | Where | Stream | Field |
|---|---|---|---|
| Grid size | `rollCityBlocks` | `0x512e0b` | `blocks` |
| Drive side | `rollDriveSide` | `0x1e7f5d` | `driveSide` |
| Canal count, axes, lines, hill, canal widths | `Terrain.planTerrain` | `0x7e44a1` | `terrain` |
| Bridges per canal run | `Terrain.pickBridges` | `0xb41d6e` | `terrain.canals[].bridges` |
| Plaza candidate shuffle | `CityGenerator` | main | `plazas` |
| Zone noise (25), parks (1 per block) | `makeValueNoise`, `CityGenerator` | main | `zones` (read-only) |
| Buildings, park trees | `lots.fillBlock`, `scatterTrees` | main | out (props) |
| Town squares, centrepieces, street ramps, park pieces | `Landmarks.planLandmarks` | `0x1a4d` | `landmarks`, `ramps` |
| Canal ramps | `CityGenerator` | `0xca7a1` | `canalRamps` |
| Plaza planters | `CityGenerator` | main | out |
| Spawn street | `CityGenerator` | main | `spawn` |
| Roadworks (20 slots) | `Roadworks.planRoadworks` | `0x0c0e5` | `roadworks` |
| Signals, signs, stop lines; bus stops | `TrafficControl` | `0x7aff1c`, `^0xb5570b` | out |
| Street props | `StreetProps` | `0x57ee7` | out |
| District chance, then placement, roles, lots, dressing | `place.rollDistricts`/`placeDistrict`, modules | the district's salt | `districts`, `force` |
| District placement order | `apply.applyDistricts` | `DISTRICTS.orderSalt` | order of `districts` |
| Climate / weather / time | `pickClimate` / `pickWeather` / `pickTimeOfDay` | `0xc11a` / `0x3a1d` / `0x71de` | `climate`, `weather`, `time` |
| Theme (pick + colour jitter) | `CityTheme.pickTheme` | `0x7e3e` | `theme` (name) |
| Start minute | `startMinuteOf` | `(seed · 2654435761) mod 60` | `startMinute` |
| Destinations | `MissionSystem.pickDestinations` | `0xde57` | `destinations` |
| Building geometry, facades | `CityBuilder` | `0x5eed`; facades `seed` | out |
| Chinatown shop signs | `render/districts/ChinatownShops` | `0x5409` | out |

## Tools

- `npm run city -- make <words…> [seed=N] [--full] [--out f]`: the words' params (a few lines; `--full`
  the complete dump). Prints the seed it ended on. `dump <seed> [URL words]`: what `?seed=N&…` builds,
  never moves the seed. `check <file…>`: exit 1 on errors. `show <file | seed | words…>`: ASCII map,
  legend, one-line summary. `words`: the vocabulary.
- `npm run find` ends each hit with `npm run city -- dump N blocks=12 <kind>=1 <others>=0` (find builds
  on the 12-block grid).
- In the game with `?debug`: `dbg.dumpCity(download = true)` → `city.params` text (downloads
  `city-<seed>.json`); `dbg.loadCity(text | object)` restarts in place (errors throw, nothing restarts;
  warnings logged). Loaded params ignore the URL's flags and live in `game.loaded`: Retry keeps them,
  New city drops them. The share link carries the seed only; no URL flag loads a file.
- Browser: `check:browser --city f` / `--make "words"`; `npm run check:reload` (dump → load is the same
  city). Workflow for an odd run: dump → `city show` → `dbg.loadCity` while fixing → the words that
  matter go into a test.

## Tests

- `cityWords1–4.test.ts`: every word comes true, an independent check of its promise, params round-trip.
  Look/layout-pinning words and `district.feature` aliases run on 2 base seeds, layout-dependent words
  (districts, features, ramps, canal ramps, roadworks, canal width) on 10.
- `CityParamsRoundTrip1–2.test.ts` (20 seeds × 2 + URL flags; the full 60 × 2 is `npm run hash --
  --reload`), `CityParamsFile.test.ts` (parse errors, layout, build errors, warnings, refusals),
  `CityParamsPinned.test.ts` (hand-pinned positions land where asked).
- Helpers: `world/paramsTesting.ts` (`cityJson`, `districtCities`), `districts/trafficSim.ts`
  (`flatCities(kind, words, n)`: `makeCity(['flat', 'blocks=12', …])` from seed 11 onwards).
- A new pinnable thing: a field (through `pin()`), a word in `WORDS`, its check in `cityWords*`.
