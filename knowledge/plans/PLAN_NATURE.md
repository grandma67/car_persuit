# Nature: decisions and design log

Park pieces, Mega-park, Swamp, Forest: why, and where the build bent from the plan of 2026-11-03. What
they are: `DISTRICTS.md`, `PLAN_GAME.md` (World). How to build on them: `DISTRICTS_DEV.md`, Building
blocks. Numbers for the branches' look and cost: `POLYGONS.md` log.

**Status:** all merged: `parks/pond-pitch` (cdf5416), `districts/megapark` (097355d), `districts/swamp`
(6863863), `districts/forest` (948aeea). The Zoo from `TODO.md` #17 is not planned.

## Ground rules

- **Roads never change:** a nature district is roads through nature.
- **Nothing drowns outside the sea and canals:** all new water is shallow; you wade, you never sink.
- **No new programs or lights:** water reuses the canal's material, wisps the fireflies'.
- **No animals or people** (the henhouse rule): no ducks, players on the pitch, witch, black cat.
- **Determinism:** each roll on its own salt, nothing from the main `rng` or landmark stream `0x1a4d`.
- **Seeds:** park pieces changed exactly the cities with a pond or pitch (95 of 120 before the pond
  chance came down); best times on changed cities accepted, as for districts.

## Park pieces

- The old park centrepiece roll stays; a new stream fills parks it left empty. **Laid after the
  districts**, parks inside one skipped, one draw per *block* (a district turning a park into a lot must
  not shift the other parks' rolls).
- **Pond chance 0.12, not 0.3** (the user: 0.3 put one in ~3 of 4 cities); ~1 city in 3. Pitches 0.25
  (~1 a city, in ~60 % of cities).
- **One more program accepted** (the user): a pond city with no canals compiles the canal water's.
- **No pond jetty:** a deck flush with the bank can't have a collider without a step; the rowboat is
  pulled up on the bank (solid). Fish are only rings in the water.
- **Floodlights are tall street lamps,** not the Harbor's masts (a district structure, not a prop).
- **Water drag grows with speed:** a flat drag strong enough at 70 km/h left a stopped car stuck.
- **Words:** exact counts, best effort; park pieces are not read-only `landmarks` (a landmark is solid).

## Mega-park

- Shapes 2×2 / 2×3 / 3×3 (3×3 rarely fits inland: 70 % placement when forced, 20 % of seeds naturally).
- No new facade styles (café stucco and storefront, lodge ashlar, boathouse siding); lodge without a
  porch; Victorian lamps are the Old City's `oilLamp`; the island is solid with a folly; lake ~40 m.
- **`maxGlow` 90 → 130:** a 3×3's drives alone carry 72 oil lamps (Farm 110, Harbor 140). `npm run
  stats` found the pitch floodlights missing from the park's lamp budget.
- Cost: +2 ms generation; programs unchanged by day, +1 on warm nights in a city without a Farm; frame
  ~3.4 vs 3.3 ms, GPU ~2.4 both; +70 calls, +15 MB textures.

## Swamp

- Forced 99 %, natural 33 %. `DistrictDef.fits` rejects a rect whose hill varies > `SWAMP.maxRise` (3 m).
- **Pools ~35–60 %, not 40–70 %:** wobbly ellipses don't pack a square block; the marsh is only a few
  points wetter (its character comes from reeds and willows).
- **The island is dry ground, not solid:** a car can wade to it; the house (porch included) is solid.
- **Boardwalks are raised decks with ramps** (0.6 m, 4 m wide, a new shared `Deck`), so a car really drives them.
- **Dropped:** mist (a new transparent program), dark water (one shallow-water mesh shares the canal's
  colours city-wide), tussocks and duckweed (reeds and pads carry it). "Gator crossing" became a yellow
  diamond, "MIND THE BOG". Audio skipped.
- No new facade styles or prop kinds for shacks and rails (`siding`, because `boards` is barn red).
- Reed clumps thinned to two (the model is 240 tris); glow avg 14 of 60.
- Cost: frame 3.5 vs 3.6 ms, GPU 1.44 vs 1.25 ms, +~20 calls, +70–90 k tris in view, walls + roofs
  ≤ 2.9 k tris, ≤ +22 ms worst.

## Forest

- Forced 97 %, natural 22 %. **Shapes up to 3×4:** a 4×4 never fits an edge with the zone share.
- **`dressing.thicket` is the point:** without it routes cut straight through 4–7 m tree spacing.
- **Measure first paid off:** trees are the city's instanced props, drawn short of the fog; a 4×3 forest
  +49 k tris in view, calls unchanged, GPU A/B trees on/off on phone settings −1 % (noise). So no LOD, and
  density went **up** (3.4–6 m apart, ~75–80 trees a block).
- **Log trucks in traffic dropped:** the district keeps heavies out, and a new body is a new car mesh.
- **Line of sight through trees not done:** `lineOfSight` doesn't read props (`STAGE2_IDEAS.md`).
- **No pond;** undergrowth is ferns only; the arch reuses the Farm's ranch gate without wheels and mailbox.
- **Moved to props after review:** tents (21 tris) and fallen logs (57, `breakSpeed` 3.5, `slowdown` 0.2):
  hence the "Props move" rule. Tyre marks lifted over the forest ground (0.13).
- Cost (seed 23768, 3×3): gen +11 ms, frame ±2 %, GPU 0 to +4 %, +30–40 k tris, +6 calls, +10 MB
  textures; programs unchanged (temperate 32, snow 32, desert 31); `maxGlow` 16.

## Open

- Should the pitch's ball ever count a goal (a sound only)? Default no.
- Mega-park drives at 30 km/h: keep only if the chase still feels fair (the user judges feel).
- Tooling: `district-tour.js` `tourKinds=lot:…` and a `top=1` straight-down view (angled aerials misled
  once, about the jetty); a props-only scale in the studio; Slums `chainLink` could use `fenceRound`.
- Planning: a 10–15 h branch took 1–4 sessions; hand off at milestone boundaries via `TASKS.md`.
  Most time went to reading for reuse points (now `DISTRICTS_DEV.md`), rework from budgets applied late
  (now first in `DISTRICTS_LOOKS.md`) and repeated browser runs.
