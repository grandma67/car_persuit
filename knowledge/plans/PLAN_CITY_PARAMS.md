# City params: decisions and design log

How it works now: [CITY_PARAMS.md](../CITY_PARAMS.md). This file keeps why, and what changed on the way.

**Status:** M0–M7 done on `city-params`, merged to main 2026-10-30. Hash identical for all 120 cities
after every milestone; every dump reloads as its city.

**Problem it solved:** a city was a function of its seed, with rolls spread over `CityGenerator`,
`Terrain`, `Landmarks`, `Roadworks`, the districts, `Climate`, `CityTheme` and `Game`. To look at one
situation (a festival on a flat night map, two crossing canals) we hunted for a seed that rolled it,
and the seed broke the next time a roll moved.

## User decisions

- **A: trimmed scope.** Pinnable: climate, weather, time, start minute, theme; blocks, drive side;
  hill, canals, bridges; plazas (they change what a district gets: a plaza inside it, a quay square
  on its edge, the Farm's paved field exits); ramps and canal ramps; roadworks; spawn; destinations;
  districts (kind, rect, features). Special blocks (Slums camp/junkyard, pagoda square, Harbor yards)
  are features; the district picks the block. Read-only: zones, parks, non-ramp landmarks, roles.
  Dropped: `city min`, drag-and-drop, a generated JSON Schema (only if hand-editing turns out common).
- **B: a params city is "the params + its seed for the rest"**, repeatable. Nothing extra (no
  sub-salts) keeps unpinned parts identical to the seed when a pin changes a stream's draw count.
- **C: possible but won't show = warning**, not an error (night-only feature by day, rect outside zone
  rules, theme vs climate).
- **D: one generator, two front ends.** `makeCityParams` for tests, `npm run city -- make` for people;
  same words, no fixture JSON.
- **No new URL flag;** files load through `dbg.loadCity`, the share link stays seed-only. URL flags
  became `urlOverrides` over the words' table, meanings unchanged.

## Where the build bent from the plan

- Most rolls depend on the layout built before them, so `rollCityParams` rolls only the up-front
  choices and `generateCity` resolves the rest through `pin()`, returning `city.params`.
- Hill in metres, not grid units (a conversion moved a rolled hill by an ulp: seeds moved).
- No `landmarkStream` or district `stream` in dumps: pinned ramps replace rolled ones after the squares
  roll, and a district list first tries the seed's own placement. Roadworks sites carry a `stream`
  instead (needed for `?roadworks` dumps).
- `canalRamps`/`roadworks` take `'all'` and counts; `ramps` is a count; `force` is a field.
- Features as found in the M0 audit: no Slums `train` (dead knob), Old City `roundTowers` only (ruins are
  lot shares), Farm `steelSilos` not `silo`, Harbor `yards` a count.
- `startHour` moved to `CityTheme` (`startMinuteOf`, `startHourAt`).

## Found on the way

- `Harbor.built` read the tank farm from the lots, but `dress` swaps that lot for the tank structure,
  so `tankFarm` could never be made.
- The Slums junkyard roll is skipped when no block is spare: `features.junkyard` was unset (now `false`).
- `!flat` (any `!word`) was accepted as the bare word; now only on/off district features are `negatable`.
- `npm run find` built on the 12-block grid while its `?seed=N&<kind>=1` hint opened the seed's rolled
  size (a different city); it now prints a `city dump` line with `blocks=12`.
- Draw calls read a few high for a frame or two after any restart; evals compare the lowest sample.

## Test budget

Word tests on 2 seeds for words that pin a field outright, 10 for layout-dependent ones; round trip
20 × 2 in the suite, 60 × 2 in `npm run hash -- --reload`. Suite CPU 250 s after M4, 243 s after M6
(tests moved from seed hunts to words).
