# Districts: how they are built

Read before touching `src/world/districts/`, `render/districts/` or a district's props/looks. What each
district is: [DISTRICTS.md](DISTRICTS.md). *District* = themed area; *zone* = distance ring (a district
block keeps its zone).

## Framework (`src/world/districts/`)

- `District.ts`: types (`DistrictDef`, `District`, `DistrictDressing`, `LotLook`…).
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

**Placement:** roll a shape, try every rectangle of it (both orientations) in `rings` meeting
`minShare`/`minCore`, shuffled; else other shapes largest first; else drop (a district only shrinks).
Inland stays off `DISTRICTS.outerRing` (2 rows); coast/edge only in outer zones touching the edge.
Rejected if: an edge is a canal, quay square or bridge (coast: no canal mouth or ring-road bridge in
the frontage); it holds a ramp landmark or ramp node; an interior edge is `speed90`; within one block of
an earlier district; < 2 gates or a disconnected interior. The spawn may be inside. Town squares inside
are taken over, parks lose their trees, roadworks are allowed (they reject a cluster only when inside it).

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

**Runtime:** `dressing.solids` → unbreakable box colliders + NavGrid obstacles (cops off-road use
NavGrid built from data, so anything solid must be there, not just in a mesh); `drivable` → NavGrid
ground; `softGround` → `Vehicle.softGround.at` returns a `SoftPatch` (grip, drag); `extra.potholes` →
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
- Ramps, roadworks, town squares, canals and the spawn are placed before the overlay. 4★+ roadblocks go
  140–260 m ahead on the route (`roadblockAhead`).

## Rules every district keeps

Checked once for all `DISTRICT_DEFS` in `rules.ts` / `DistrictRules.test.ts` (solids off
roads/junctions/plazas, junction controls untouched and clear, props clear of solids/buildings/each
other, kerb offset, overhead clearance, stable per seed, a block apart, rolls independent). Add a rule
there if it holds for all districts; don't repeat it in a district's test.

- **Overhead:** anything above a road has `bottom` ≥ `DISTRICTS.overheadClearance` (tallest
  `vehicleTop` + 1.5 m), never hard-coded; nothing above the kerb collides.
- **Kerb clutter:** on the sidewalk; may poke out but never within `clutterMinOffset` (5 m) of the
  centre line; ~8 m gaps at junction mouths and gates; 3 m into the road clear in front of corridor
  mouths and fence holes. The rule (`clutterOnCentreLine`) measures a prop by its **radius**
  (`hypot(hx, hz)`) whichever way it faces: a 2.9 m rail section along the kerb counts 1.45 m of reach,
  so it stands ≥ 6.5 m off the centre line (the Swamp's rails at `rw/2 + 0.65`).
- **Solid vs breakable:** structures (walls, columns, legs, stacks, lions, bollards) solid, unbreakable,
  off the roadway; smaller things are breakable props that add heat. Long or wide breakables get a small
  collider (a 7 m boom arm thrown ahead jammed a straddle carrier's gap like a wall).
- **Glow:** cap emissive instances (`<DISTRICT>.maxGlow`); flicker/blink via shader uniforms, never per-light JS.
- **Corridors and gaps** (yards, junkyard, orchard aisles, carrier legs): ≥ widest body + 1 m and
  connected to ≥ 2 streets. Test widths against
  `widestBody({ offRoad: true })` (2.5 m: the ramp truck, 4 m, never leaves the road) or `widestBody()`.
- **No z-fighting:** never overlap coplanar faces. Butt-join exactly or stand one part 2–3 cm proud;
  ground layers ≥ 2 cm apart or `polygonOffset` on the lower (asphalt 1/1, street cobbles 0.5/0.5,
  markings none).
  Tests catch it: `PropModels.test` (every prop model) and `BuildingZFight.test` (40 rolled cities,
  every building and its neighbours; `render/coplanar.ts`, `world/zfight.ts`). To fix one, list them
  all with where to look: `npm run zfight` (`props`, `only=chinatown`, or city words for a district's
  own cities). Neighbours in a terrace stand 0.3–0.5 m apart and often share a height, so anything one
  builds past its walls lands in the other's planes. Building geometry in the roof mesh is
  kept inside `buildingReach` (half the gap to each neighbour): overhangs are cut there, boxes stop
  2 cm short, a jetty grows only that far. A new trim reaching past the walls needs nothing more.
  Fix z-fighting in the geometry, not the camera: a chase camera `near` of 0.5 (5x the depth
  precision far off) was tried and dropped. Nothing changed visibly at range, and it cut the
  rain and snow nearest the lens, the streaks that sell it.

## Looks and performance

- Buildings: `buildingGeometry` → `addBuilding(b, look: LotLook)`. `LotLook` (`facade`, optional `ground`
  for floor 0, `roof`, `roofAlt`, `palette`, `roofTiles`, `trims`) per lot kind in `def.looks`,
  overridable per climate in `CityTheme.districts.<kind>`; no lot → `zoneLook`. One merged wall mesh per
  facade style (`render/Facades.ts`, 8×8 window cells, 512² canvases, `CAPS`, per-window `cell` hook), one
  shared roof mesh (`addRoof` by `RoofShape`, `addTrims` by `TrimKind`); the collider stays the lot box.
  Never give a lot its own mesh or material.
- **Facade styles** (`render/Facades.ts`; reuse before adding one). Upper floors: `curtain` (full
  glazing), `office` (stone grid), `brick` (arched windows), `stucco` (smooth render, light surrounds),
  `shutters` (louvred, balcony rail), `siding` (horizontal boards, white frames: takes any palette tint),
  `adobe` (earthen, deep windows), `industrial` (corrugated, strip glazing), `halfTimber` (plaster and
  oak), `ashlar` (coursed stone, leaded windows), `shophouse` (Chinatown pastel, fanlights), `tenement`
  (grimy brick walk-ups), `charred` (burnt-out shells), `panel` (windowless cold store). **`boards` has
  barn red painted into its texture** (palettes are near-white shades over it): it is always a red
  barn. Ground floors: `storefront` (signboard, wide glazing), `rollerDoors` (shed doors), `barnDoors`
  (X-braced, white trim), `boarded` (shut shops). Look at one alone: `studio.js` with `?studio=lot:…`.
- **Programs to expect** (`dbg.stats().programs`; compare on vs off with `check:browser --vs-make
  "nodistricts …" --make "<kind> …"`): a city with no canals compiles the canal water's program for
  its first shallow water (a pond, a lake, the Swamp's pools: +1, accepted); fireflies and wisps add
  their own on the nights they show (+1, shared by every district); the snow's ice is a plain material.
  Compare the same climate on both sides: no-district baselines differ by climate (seed 11: desert 31,
  beach 32).
- **Budget per district:** ≤ 3 new facade styles, no new shader programs (`renderer.info.programs`),
  merged walls + roofs < ~60k triangles, build time within ~50 ms of district off (`npm run budget`),
  phone FPS on vs off within noise.
- Instance repeats (never merge them into walls), merge static geometry per structure, extend
  `prewarmShaders` if anything new compiles.
- A new prop or look must reuse an existing material's settings; `InstancedMesh` only with an existing
  instanced material. Tint instanced repeats with `setColorAt` on the props' material settings, or
  textures on the sign faces' settings (map + emissive map); never both on one material. Transparency
  would be a new program (Slums graffiti is opaque cells in one merged mesh).
- Parked vehicles: never `buildCarMesh` in a district (its two SpotLights change the light count and
  recompile everything; `paint: 'work'` is a new program). Merge a vertex-coloured body instead.
- Text on signs: canvas text from system fonts into an atlas at load (generic serif/sans fallback).

## Adding a district

One branch per district; each step is a `TASKS.md` milestone (placement + lots, signature structures,
buildings/dressing/props, traffic + police, look/night/climate/perf/docs; steps 1–2 make it playable).

1. `world/districts/<Name>.ts` exports a `DistrictDef` (tuning in `balance.ts`, e.g. `OLD_CITY`);
   register in `index.ts`. Playable via `?<kind>=1`.
2. `roles`/`lots`/`dress` are **pure data** using only the given `rng`. Solids in `dressing.solids`,
   off-road ground in `drivable`, overhead pieces with `bottom` ≥ clearance.
   Each named roll (a special block, a signature piece, an on/off look) is a **feature**: roll it as
   `feature(q, 'festival', rng.next() < CHINATOWN.festivalChance)` (the draw is made even when pinned),
   declare it in the def's `features` (`'bool'`, `'int'` or a list of names; night-only ones in
   `nightFeatures`), and add `built(q, city)` if a pinned one can find no room. That gives it a word
   (`festival`, `!festival`, `<kind>.name` on a clash), a field in dumps, and a check in
   `cityWords*.test.ts` ([CITY_PARAMS.md](CITY_PARAMS.md)).
3. Looks: facade styles in `Facades.ts` (+ `CAPS`), roofs in `addRoof`, trims in `addTrims`.
4. Renderer `render/districts/<Name>.ts` in `DISTRICT_RENDERERS`.
5. Docs: `DISTRICTS.md` (table row + section, odds line from `npm run stats -- odds`), `plans/PLAN_GAME.md` version line, README mention.

**Every file a new kind touches** (beyond its own `world/districts/<Name>*.ts`, renderer and tests):
the `DistrictKind` union (`District.ts`); `world/districts/index.ts`; `render/districts/index.ts`;
`scripts/city.ts` (`DISTRICT_CHAR`); the kind lists in `scripts/evals/district-tour.js`
and `district-drive.js`; `NUMBERS` in `paramsTesting.ts` for an `'int'` feature; `CityTheme` climate
looks (optional); new props in `StreetProps.ts` + `PropSystem.ts`. Other districts' tests use
`alone(kind…)` / `everyDistrict()` (`paramsTesting.ts`), so they need no edit. `check:restart` runs
two cities (`:core`, five districts; `:nature`, Mega-park and Swamp): add a new kind and its
features to `check:restart:nature`'s `--make` in `package.json` (`DISTRICTS.max` is 5 a city).

## Conventions

- **Footprint yaw:** local X is `(cos yaw, −sin yaw)`, local Z `(sin yaw, cos yaw)` (three's rotation
  about Y, so `frameOf(x, y, z, f.yaw)` lays a part on its footprint). A `Structure`'s yaw is the same.
- **A prop's local +Z is its front** (a bench's seat, a board's face, a kiosk's hatch).
- **`ShallowWater`:** `yaw = atan2(−nz, nx)` points local X along `(nx, nz)`; `rx`/`rz` the half
  extents; `shoreDistance` > 0 in the water, < 0 on the bank.
- **`Building.street` bits:** 1 = +Z side, 2 = −Z, 4 = +X, 8 = −X (`Megapark`'s `SIDES`).
- **`Gate`:** `x, z` on the wall line (the block's sidewalk line), `yaw` heading in, `opening` = road +
  both sidewalks; anything beside it stands past `opening / 2`.
- **Ground lifts** (no z-fighting): sidewalk 0.03, grass 0.05, paths 0.065, patches 0.07, lines 0.09–0.1.
- **Reading the dressing while laying it:** `q.dressing` is assigned after `dress` returns; a helper
  that reads the pieces laid so far gets `q.dressing = out` first (`Megapark.dress`).

## Reuse before writing

- `block.park = true` in `roles`: grass ground and the minimap's park colour.
- `ParkPiece.district` for a district's own pond or pitch (`pitchAt`, the park-piece renderer, the ball).
- `rowboat()` (`render/Landmarks.ts`); Victorian lamps are the Old City's `oilLamp` (glow included).
- `drapePolyline` / `upTri` (`render/geometry.ts`): a strip along a polyline on the ground (paths,
  tracks, boardwalk shadows); `GeometryBuilder.drape` for rects.
- A name board atlas: `farmSigns.ts` / `megaparkSigns.ts` (facade walls' material settings: no program).
- `clearOf` (`HarborYard.ts`) keeps props off solids and each other, **dropping** what doesn't fit,
  earlier props first: lay what must exist (a gate's board) before the filler, or into the busy index
  first. Why is a prop missing: `CLEAROF=parkBoard node scripts/run-ts.mjs <script>` logs each drop
  of those kinds (`*` all) and what it hit; a test can pass a `dropped` array.
- **Raised drivable decks** (`world/Deck.ts`, `dressing.decks`): a boardwalk or ramp-ended platform
  a car drives up onto. Colliders (a box and two hull wedges) in `CityBuilder`, firm ground over water
  (`softGround` checks decks first), NavGrid ground at the off-road cost; `deckHeight` for the render.
  Rails beside one are props just outside its outline: keep them out of `clearOf`'s solids by passing
  the deck's exact outline. `Deck.test.ts` drives a player and a patrol car over one both ways.
- `ShallowWater.island`: a dry round island in the middle of a pool (the witch house's).
- `DistrictDef.fits(bounds, city)`: a ground rule for a candidate rect (the Swamp turns down a hill).
- `RunDressing.trees`: tree kinds swapped per climate inside the district (the Swamp's desert snags,
  beach mangroves). District tree props carry their own `tree` kind (`cypress`, `snag`, `willow`,
  `mangrove` beside the climates' kinds).
- `rolledFeatures(q)`: each feature's roll before pins (a dump records every feature as a pin; the
  night-only warning uses it so a feature that rolled on by itself reloads by day without a warning).
- `fireflies(spots, n, seed, scene, ground, look?)` (`render/districts/fireflies.ts`): the Farm's, the
  Mega-park's and the Swamp's wisps (`look`: colour, size); one program for all.

## Night lighting and the glow budget

- **What glows:** lit props (`LIT_PROPS` in `StreetProps.ts`: `lamp`, `woodLamp`, `oilLamp`,
  `dragonLamp`, `jackOLantern`) get a bulb and a light pool from `PropSystem`. A district's own lights
  (lanterns, torches, bulb strings) are an `InstancedMesh` of `MeshBasicMaterial({ toneMapped: false })`
  with a colour per instance, dim by day and `× 1.6` warm at night by `ctx.lampGlow` (Old City
  `torches`, Mega-park `glows`): the lamp bulbs' program, no light. Lit glass on a name board: the
  sign atlas's warm swatch (`onWarm`, `farmSignMaterial(2.5)`). Fireflies: `fireflies.ts`.
  `GlowBatch` is the **cars'** lamp sprites only; never add district lights there. No point lights
  (one in the scene, shared).
- **`maxGlow`** (each district's balance block, declared on its def): how many glowing things at night,
  lit props plus the renderer's own. Lay the lamps last and fill what's left: count everything lit
  already inside (`LIT_PROPS` on `city.streetProps` in the bounds **and** the set blocks' props not
  pushed yet, such as a pitch's floodlights), minus what the renderer will add (2 lanterns a gate, the
  bulbs). Fireflies take what remains.
- **Sizing it:** a district's streets carry ~8 lamps a block (swapped to its lamp kind), so a 3×3's
  streets alone hold ~72. `npm run stats -- <kind>` prints `glow`: lit props (average, worst, the
  worst seed and shape) against `maxGlow`. Size the budget on the worst, with the renderer's lights on top.

## Pitfalls

- **Seed guard per milestone:** `npm run hash -- --vs HEAD --expect <kind>` fails if anything moved
  outside cities that hold the district, and says how many of those moved (all of them when it first
  lands, a few for a tweak). Several kinds: `--expect farm,slums`.
- **Measure placement rate** (`npm run stats -- <kind>`; it also prints shallow water's share per block) after any rule, alone and with all districts
  forced; check rejection reasons if low. A district's position depends on those placed before it.
- `perimeterWall` opens at *every* street crossing the wall, not just gates (`'mainStreet'` districts
  have gateless crossings).
- Never derive a random pick list from an extendable `Record`: `LANDMARK_KINDS` is an explicit list.
- Cops spawn 20 m down a side street: spawn rules must test the spot (`skipAt`), not the junction.
- Civilians' forward sensor skips fixed bodies, so lane obstacles need kinematic bodies; dodging into a
  parked van scraped, so vans park on the kerb (`vanOnKerb`).
- A search for buildings "on the street" must allow the lot gap: Chinatown's `streetMask` wants faces
  within 1 m of the sidewalk line, Harbor lots stand 2–4 m back (`frontMask`).
- A texture given to a shader by `onBeforeCompile` must also sit in `material.userData.uniforms`, or
  Retry leaks it (`npm run check:restart`, `LEAKS.md`).
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
  over ~40 seeds (`i * 7919 + 11`) for the invariants. A test about one feature pins it with words,
  on and off: `districtCities('farm', ['maze'])` / `['!maze']`, `makeCity(['chinatown', 'festival',
  'night'], { seed })`; a "when there is one" sweep also runs on the pinned cities. Assert plan items as logic: geometry vs road rects
  (`footprintsOverlap`, `rectFootprint`, `city.roads`, `city.intersections`), heights vs clearance,
  lot/role counts, junction controls unchanged. Prefer all-seed properties. Checks return the list of
  breaks: `expect(breaks).toEqual([])`, never `expect` inside a loop over props × roads (that cost 40 s).
- Traffic/cops on a real city: `districts/trafficSim.ts` (`flatCities(kind, words, n)`: flat 12-block
  cities from words, `cityWorld`, `simulate` hands each car per step; see `SlumsTraffic.test.ts`).
  Don't extend the synthetic junction sims (`ai/junctionSim.ts`, `IntersectionSim`, `CivilianTurns`):
  they can't hold a district. A sim over ~8 s gets its own file
  (files run in parallel, tests in a file don't).
- `StreetProps.test` / `BuildingGeometry.test` use the default registry or `defs: []`; new districts
  appear on their seeds, so exempt district dressing where it may differ.
- Browser checks per milestone: [BROWSER_CHECKS.md](BROWSER_CHECKS.md); `--make "<kind> <feature>
  night"` opens a city that has it.
