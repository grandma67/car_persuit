# Districts: how they are built

Read before touching `src/world/districts/`, `render/districts/` or a district's props. What each
district is: [DISTRICTS.md](DISTRICTS.md). Looks, budgets, z-fighting, night glow:
[DISTRICTS_LOOKS.md](DISTRICTS_LOOKS.md). Rolls, features and words: [CITY_PARAMS.md](CITY_PARAMS.md).

## Framework (`src/world/districts/`)

- `District.ts`: types (`DistrictKind`, `DistrictDef`, `District`, `DistrictDressing`, `LotLook`…).
- `place.ts`: `rollDistricts` (independent roll per def on `seed ^ salt`, so adding a district never moves
  older rolls; URL force; `DISTRICTS.max` 5; placement order shuffled per seed on `DISTRICTS.orderSalt`)
  and `placeDistrict`.
- `apply.ts`: `applyDistricts`, the overlay at the end of `generateCity`; helpers `kerbClutter`,
  `perimeterWall`, `isJunctionControl`, `inDistrict` (squares: `makeSquare` in `world/Landmarks.ts`).
- `runtime.ts`: `districtTraffic` (speed caps with ease-in, `heavy: false` keeps buses/trucks out,
  `density`, spawn `weights`), `copSpawnSkips` (`skipAt(x, z)` on the spawn spot), `roadblockGates`,
  `districtOfNode`, `joinRunDressing` (`Game` joins `extra.nightProps` on night runs and
  `extra.byClimate[climate]` (props, ground, tint) per run; generation never depends on time or climate).
- `index.ts`: `DISTRICT_DEFS`. `rules.ts`: checks every district keeps. `trims.ts`: shared trims.
  Renderers: `render/districts/index.ts` (`DISTRICT_RENDERERS[kind]`: structures, overhead, ground).

| District | Data (`world/districts/`) | Render (`render/districts/`) |
|---|---|---|
| Old City | `OldCity`, `OldCityWalls` | `OldCity` |
| Chinatown | `Chinatown`, `ChinatownGates` | `Chinatown`, `ChinatownShops`, `glyphs` |
| Harbor | `Harbor`, `HarborGate`, `HarborQuay`, `HarborYard` | `Harbor`, `HarborGate`, `HarborQuay`, `containers`, `harborLights`, `harborSigns` |
| Farm | `Farm`, `FarmFields`, `FarmGate`, `FarmNight` | `Farm`, `farmCrops`, `farmSigns` |
| Slums | `Slums`, `SlumsSet` (ruins, overpass, junkyard, camp), `SlumsStreet` (street dressing, last on the stream; `climateDressing`) | `Slums`, `slumsGraffiti`, `slumsSigns` |
| Mega-park | `Megapark`, `MegaparkLake`, `MegaparkGrounds`, `MegaparkLawns` | `Megapark`, `megaparkSigns` |
| Swamp | `Swamp` (roles, lots, `fits`: low ground), `SwampPools`, `SwampWitch`, `SwampSet` (boardwalks, landing), `SwampStreet` (verges, rails, lamps, signs), `SwampWoods` (trees, reeds, logs, pads) | `Swamp`, `SwampWitch` (house, boardwalk, jetty, airboat, log) |
| Forest | `Forest` (roles, lots, dress, climate swaps), `ForestWoods` (tracks, clearings, trees, floor), `ForestSet` (log arch, posts, lumber yard, lookout, campsite; `sideFrame`) | `Forest` (floor, tracks, glows), `ForestSet` (stacks, truck, loader, tower, fire pit); tents and logs are props |

**Placement:** roll a shape, try every rectangle of it (both orientations) in `rings` meeting
`minShare`/`minCore`, shuffled; else other shapes largest first; else drop (a district only shrinks).
Inland stays off `DISTRICTS.outerRing` (2 rows); coast/edge only in outer zones touching the edge;
`def.fits(bounds, city)` adds a ground rule (the Swamp turns down a hill). Rejected if: an edge is a
canal, quay square or bridge (coast: no canal mouth or ring-road bridge in the frontage); it holds a
ramp landmark or ramp node; an interior edge is `speed90`; within one block of an earlier district;
< 2 gates or a disconnected interior. The spawn may be inside. Town squares inside are taken over,
parks lose their trees, roadworks are allowed (they reject a cluster only when inside it).

**Coast frontage:** long side on the outer row; `frontage` = ring road + promenade + sea to
`frontageSea` (50 m). The ring road stays an ordinary street; the district may dress the promenade
(replace lamps/benches), never the roadway. At a corner only the long side is frontage.

**Streets:** interior = district blocks on both sides. Removed-plaza edges stay paved shortcuts: not
streets, never gates. Gate = interior edge with one end on the perimeter, opening road + 2 × sidewalk.
Main street = longest straight interior run.

**Overlay** (each district on its own stream; everything outside its blocks + frontage is
byte-identical to the district off, tested): mark blocks + roles → refill ordinary blocks with
`fillBlock(…, def.buildingStyle, districtRng)` (special blocks empty) → `lots` → `drop`/`swap` props in
bounds + frontage (never junction controls) → remove zebras unless `keepZebras` (stop lines stay) →
`dress` (must not overlap what stays) → `city.districts`.

**Runtime:** `dressing.solids` → unbreakable box colliders + NavGrid obstacles (cops off-road use a
NavGrid built from data, so anything solid must be there, not just in a mesh); `drivable` → NavGrid
ground; `softGround` → `Vehicle.softGround.at` returns a `SoftPatch` (grip, drag); `thicket` → NavGrid
blocks it except along its paths; `decks` → raised drivable decks; `extra.potholes` →
`Vehicle.potholes` (an upward kick at a wheel dropping in).

## City facts districts depend on

- Grid 8–15 blocks a side (rolled per seed; 12 in `generateCity(seed)` and the tools' default) of 60 m,
  12 m roads, 10 m promenade, then sea. Midtown is a thin ring; canals and town squares take many
  blocks, so harmless-sounding rules can kill placement.
- Sidewalk 3 m inside each block; lane centre 3 m from the centre line (`LANE_OFFSET`); widest body
  (armoured, bus) half width 1.25 m → edge ~4.25 m; civilian dodge 3.5 m (`DODGE_OFFSET`).
- Junction rules come from props: signals and `stop`/`priority` → `approachControls`, `speed90` →
  `fastStreets`, `busStop` → `busStops`. Never drop or move them, only restyle (`style`). A `busStop`
  may be dropped only where buses are kept out.
- Ramps, roadworks, town squares, canals and the spawn are placed before the overlay; park pieces
  after it. 4★+ roadblocks go 140–260 m ahead on the route (`roadblockAhead`).
- Nothing drowns outside the sea and canals (`position.y < SEA_LEVEL - 0.3`, `Game.checkWater`): all
  district water is shallow (below).

## Rules every district keeps

Checked once for all `DISTRICT_DEFS` in `rules.ts` / `DistrictRules.test.ts` (solids off
roads/junctions/plazas, junction controls untouched and clear, props clear of solids/buildings/each
other, kerb offset, overhead clearance, stable per seed, a block apart, rolls independent). Add a rule
there if it holds for all districts; don't repeat it in a district's test.

- **Roads never change:** character comes from buildings, props, ground patches, overhead pieces, gates.
- **Overhead:** anything above a road has `bottom` ≥ `DISTRICTS.overheadClearance` (tallest
  `vehicleTop` + 1.5 m), never hard-coded; nothing above the kerb collides.
- **Kerb clutter:** on the sidewalk; may poke out but never within `clutterMinOffset` (5 m) of the
  centre line; ~8 m gaps at junction mouths and gates; 3 m into the road clear in front of corridor
  mouths and fence holes. `clutterOnCentreLine` measures a prop by its **radius** (`hypot(hx, hz)`)
  whichever way it faces: a 2.9 m rail along the kerb counts 1.45 m, so it stands ≥ 6.5 m off the
  centre line (the Swamp's rails at `rw/2 + 0.65`).
- **Solid vs breakable:** structures only for built things (walls, columns, legs, stacks, lions,
  bollards), solid, unbreakable, off the roadway; anything a car could shove is a prop (CLAUDE.md,
  "Props move"). Long or wide breakables get a small collider (a 7 m boom arm thrown ahead jammed a
  straddle carrier's gap like a wall).
- **Corridors and gaps** (yards, junkyard, orchard aisles, carrier legs, tracks): ≥ widest body + 1 m and
  connected to ≥ 2 streets. Test widths against `widestBody({ offRoad: true })` (2.5 m; the 4 m ramp
  truck never leaves the road) or `widestBody()`.
- **Glow** under `maxGlow`; **no z-fighting** ([DISTRICTS_LOOKS.md](DISTRICTS_LOOKS.md)).
- **Respect:** no animals or people (frozen ones look dead), made-up names, no real brands, gang
  symbols, slurs, politics or occult symbols (`DISTRICTS.md`).

## Adding a district

Read the budgets first ([DISTRICTS_LOOKS.md](DISTRICTS_LOOKS.md)). One branch per district; each step a
`TASKS.md` milestone: placement + roles + lots (playable), signature structures, buildings/dressing/
props, traffic + police, look/night/climate/perf/docs.

1. `world/districts/<Name>.ts` exports a `DistrictDef` (tuning in `balance.ts`, e.g. `OLD_CITY`, with
   `maxGlow`); register in `index.ts`. Playable via `?<kind>=1`.
2. `roles`/`lots`/`dress` are **pure data** using only the given `rng`. Solids in `dressing.solids`,
   off-road ground in `drivable`, overhead pieces with `bottom` ≥ clearance. Each named roll (a special
   block, a signature piece, an on/off look) is a **feature**: `feature(q, 'festival', rng.next() <
   CHINATOWN.festivalChance)` (the draw is made even when pinned), declared in the def's `features`
   (`'bool'`, `'int'` or a list of names; night-only ones in `nightFeatures`), plus `built(q, city)` if a
   pinned one can find no room. That gives it a word (`festival`, `!festival`, `<kind>.name` on a
   clash), a field in dumps and a check in `cityWords*.test.ts`.
3. Looks: facade styles in `Facades.ts` (+ `CAPS`), roofs in `addRoof`, trims in `addTrims`.
4. Renderer `render/districts/<Name>.ts` in `DISTRICT_RENDERERS`.
5. Docs: `DISTRICTS.md` (table row + section, odds line from `npm run stats -- odds`),
   `plans/PLAN_GAME.md` version line, README mention, a design log entry in `plans/`.

**Every file a new kind touches** (beyond its own files and tests): the `DistrictKind` union
(`District.ts`); `world/districts/index.ts`; `render/districts/index.ts`; `scripts/city.ts`
(`DISTRICT_CHAR` + legend); the kind lists in `scripts/evals/district-tour.js` and `district-drive.js`;
`NUMBERS` in `paramsTesting.ts` for an `'int'` feature; `CityTheme` climate looks (optional); new props
in `StreetProps.ts` + `PropSystem.ts`; `check:restart:nature`'s `--make` in `package.json` (the kind
and its features with a look; a third city once that one holds 5). Other districts' tests use
`alone(kind…)` / `everyDistrict()` (`paramsTesting.ts`): no edit.

## Conventions

- **Footprint yaw:** local X is `(cos yaw, −sin yaw)`, local Z `(sin yaw, cos yaw)` (three's rotation
  about Y, so `frameOf(x, y, z, f.yaw)` lays a part on its footprint). A `Structure`'s yaw is the same.
- **A prop's local +Z is its front** (a bench's seat, a board's face, a kiosk's hatch).
- **`ShallowWater`:** `yaw = atan2(−nz, nx)` points local X along `(nx, nz)`; `rx`/`rz` half extents;
  `shoreDistance` > 0 in the water, < 0 on the bank.
- **`Building.street` bits:** 1 = +Z side, 2 = −Z, 4 = +X, 8 = −X (`Megapark`'s `SIDES`).
- **`Gate`:** `x, z` on the wall line (the block's sidewalk line), `yaw` heading in, `opening` = road +
  both sidewalks; anything beside it stands past `opening / 2`.
- **Reading the dressing while laying it:** `q.dressing` is assigned after `dress` returns; a helper
  that reads the pieces laid so far gets `q.dressing = out` first (`Megapark.dress`).

## Building blocks (reuse before writing)

- **Shallow water** (`world/Water.ts`, `city.water`): surface ~0.35 m over the ground, a `SoftPatch`
  in `Vehicle.softGround` (`WATER` in balance: grip ~0.7, drag growing with speed, `dragPerSpeed`, as a
  flat drag left a stopped car stuck; flat out through 15 m 70 → ~48 km/h, wading tops ~19 km/h), a
  soft NavGrid cell (cops go round), ice in the snow (`iceGrip`, no drag). Renders with the canal
  water's material. `ShallowWater.island`: a dry round island in a pool (the witch house's).
- **Park pieces:** `ParkPiece.district` for a district's own pond, pitch or lily pads (`pitchAt`, the
  park-piece renderer, the ball). `block.park = true` in `roles`: grass ground and the minimap's park
  colour (then `mapColor` sits on park green: pick one that stands out).
- **Raised drivable decks** (`world/Deck.ts`, `dressing.decks`): a boardwalk or ramp-ended platform.
  Colliders (a box and two hull wedges) in `CityBuilder`, firm ground over water (`softGround` checks
  decks first), NavGrid ground at the off-road cost; `deckHeight` for the render. Rails beside one are
  props just outside its outline: pass `clearOf` the deck's exact outline. `Deck.test.ts` drives a
  player and a patrol car over one both ways.
- **`dressing.thicket`** (`rects`, `paths`): ground the NavGrid blocks except along its paths (a
  polyline and width; one point is a round clearing). The Forest's woods: cops route only along
  tracks. `pathDistance` (`ai/NavGrid.ts`) is the distance to such a path; `NavGrid.costAt`.
- `clearOf` (`HarborYard.ts`) keeps props off solids and each other, **dropping** what doesn't fit,
  earlier props first: lay what must exist (a gate's board) before the filler. Why a prop is missing:
  `CLEAROF=parkBoard node scripts/run-ts.mjs <script>` logs each drop of those kinds (`*` all) and what
  it hit; a test can pass a `dropped` array.
- `drapePolyline` / `upTri` (`render/geometry.ts`): a strip along a polyline on the ground (paths,
  tracks, boardwalk shadows); `GeometryBuilder.drape` for rects. `fenceRound` (`MegaparkGrounds.ts`):
  a fence round a rect with gaps (Slums `chainLink` duplicates it).
- A named board over a street: `ranchGateAt(q, city, gate, rng, names)` (Farm) with your own names
  (≤ 8), drawn by `ranchGate(s, snowy, solid, signs, wheels)` and `farmSignMaterial(glow, names)` (one
  atlas per names list): the Forest's log arch.
- `sideFrame(inner, side)` / `gateSide` (`ForestSet.ts`): a block's street side as a (u along, v in)
  frame with `at`, `rect` and the yaw laying a footprint along it. `streetSidesOf(k, city)`.
- `RunDressing.trees`: tree kinds swapped per climate inside the district (desert snags, beach
  mangroves). District tree props carry their own `tree` kind (`cypress`, `snag`, `willow`, `mangrove`).
- `fireflies(spots, n, seed, scene, ground, look?)` (`render/districts/fireflies.ts`): the Farm's, the
  Mega-park's and the Swamp's wisps (`look`: colour, size); one program for all.
- `rowboat()` (`render/Landmarks.ts`); Victorian lamps are the Old City's `oilLamp` (glow included);
  the stick totem is the Farm's scarecrow; rails reuse the split-rail `fence` (`style: 'rail'`).
- `rolledFeatures(q)`: each feature's roll before pins (a dump records every feature as a pin; the
  night-only warning uses it so a feature that rolled on by itself reloads by day without a warning).

## Pitfalls

- **Edge blocks may have fewer than two street sides** (a corner on the island's edge, a removed
  plaza): anything that runs street to street (a track, a boardwalk) picks among blocks with two or more.
- **Dense props don't stop cops.** NavGrid blocks ~0.5 m round a footprint and penalises ~1.6 m:
  trees 4–7 m apart are a slalom a route takes. Ground cops must not cross goes in `dressing.thicket`.
- **Trees don't block sight:** `staticLineOfSight` reads static colliders, and props get bodies only near
  a vehicle (`STAGE2_IDEAS.md` has the idea).
- **Seed guard per milestone:** `npm run hash -- --vs HEAD --expect <kind>` (several: `--expect
  farm,slums`) fails if anything moved outside cities that hold the district, and says how many of those
  moved (all of them when it first lands). An every-district city that moved without holding it is
  rebuilt with the kind forced off: if it then hashes as before, only the placement order moved; it is
  listed as "placement order only", accepted; anything else fails.
- **Measure placement** after any rule: `npm run stats -- <kind> [seeds=100]` (placement rate, shapes,
  gates, counts, shallow water's share per block, lit props vs `maxGlow`, gen ms on vs off), alone and
  with all districts forced; check rejection reasons if low. A district's position depends on those
  placed before it. Recheck the odds line (`stats -- odds`) after each district.
- `perimeterWall` opens at *every* street crossing the wall, not just gates (`'mainStreet'` districts
  have gateless crossings).
- Never derive a random pick list from an extendable `Record`: `LANDMARK_KINDS` is an explicit list.
- Cops spawn 20 m down a side street: spawn rules test the spot (`skipAt`), not the junction.
- Civilians' forward sensor skips fixed bodies, so lane obstacles need kinematic bodies; dodging into a
  parked van scraped, so vans park on the kerb (`vanOnKerb`).
- A search for buildings "on the street" must allow the lot gap: Chinatown's `streetMask` wants faces
  within 1 m of the sidewalk line, Harbor lots stand 2–4 m back (`frontMask`).
- A texture given to a shader by `onBeforeCompile` must also sit in `material.userData.uniforms`, or
  Retry leaks it (`LEAKS.md`).
- Props that must not budge (Slums wrecks on bricks or flipped) are props with `breakSpeed` ∞
  (`SOLID_WRECKS`), not solids. A wreck at a corridor mouth cost a third of the speed (hence the 3 m rule).
- Watch: cops snagging clutter near junctions (push `clutterMinOffset` out), the chase camera clipping
  low overhead pieces, crane span tracking sidewalk + road + promenade (~25 m, from `DEFAULT_CITY`), a
  shallow hull poking through the shader swell, cops bogging in soft ground, glow and fill cost on phones.

## Testing

- `Districts.test.ts` uses **stub defs** (one inland, one coast): rolls, overlay invariant, placement,
  gates, main street, wall loop, lots, clutter offsets, runtime rules. Run after any change in
  `world/districts`, `CityGenerator`, `lots.ts`.
- Real district: `<Name>.test.ts` beside it, `generateCity(seed, undefined, { force: { oldtown: true } })`
  over ~40 seeds (`i * 7919 + 11`) for the invariants. A test about one feature pins it with words, on
  and off: `districtCities('farm', ['maze'])` / `['!maze']`, `makeCity(['chinatown', 'festival',
  'night'], { seed })`; a "when there is one" sweep also runs on the pinned cities. Assert plan items as
  logic: geometry vs road rects (`footprintsOverlap`, `rectFootprint`, `city.roads`,
  `city.intersections`), heights vs clearance, lot/role counts, junction controls unchanged. Prefer
  all-seed properties. Checks return the list of breaks: `expect(breaks).toEqual([])`, never `expect`
  inside a loop over props × roads (that cost 40 s).
- Traffic/cops on a real city: `districts/trafficSim.ts` (`flatCities(kind, words, n)`: flat 12-block
  cities from words, `cityWorld`, `simulate` hands each car per step; see `SlumsTraffic.test.ts`).
  Don't extend the synthetic junction sims (`ai/junctionSim.ts`, `IntersectionSim`, `CivilianTurns`):
  they can't hold a district. A sim over ~8 s gets its own file (files run in parallel, tests in a file don't).
- `StreetProps.test` / `BuildingGeometry.test` use the default registry or `defs: []`; new districts
  appear on their seeds, so exempt district dressing where it may differ.
- Browser checks per milestone: [BROWSER_CHECKS.md](BROWSER_CHECKS.md) (on vs off with `--vs-make`;
  `district-tour.js`, `district-drive.js`).
