# Nature: park pieces and three nature districts (plan)

Plan written 2026-11-03. Branch 1 built (see "Where branch 1 bent" at the end). Milestones go in `TASKS.md`. How districts are built:
`DISTRICTS_DEV.md`; rolls, fields and words: `CITY_PARAMS.md`. From `TODO.md` #17 (fish pond, swamp
with a witch house) plus the user's forest and mega-park.

Four branches, in this order (each later one reuses what the earlier ones add):

| # | Branch | What | Effort |
|---|---|---|---|
| 1 | `parks/pond-pitch` | fish pond + soccer pitch as park centrepieces; **shallow water** (wading) | 6–8 h |
| 2 | `districts/megapark` | Mega-park: one big park over 2×2–3×3 blocks | 10–12 h |
| 3 | `districts/swamp` | Swamp (wooded) or marsh (reeds), the witch house | 14–16 h |
| 4 | `districts/forest` | Forest: dense woods, tracks, lumber yard | 12–15 h |

## The ground rules, as they apply to nature

- **Roads never change** (`DISTRICTS.md`): a nature district is roads through nature. Interior streets
  stay streets with lanes, signals and signs; character comes from the blocks between them, the kerbs
  and overhead pieces.
- **Nothing drowns outside the sea and canals.** Drowning is `position.y < SEA_LEVEL - 0.3`
  (`Game.checkWater`), and park and swamp water sits on land well above that. All new water is
  **shallow**: a water surface ~0.35 m above the ground, the ground under it a `SoftPatch` with high drag
  and lower grip, spray from the wheels. You wade and slow down hard; you never sink.
- **No new shader programs.** Water reuses the canal water's material (`render/CanalWater.ts`) if its
  look holds away from a canal (algae along the quay walls and the sea-mouth blend read canal uniforms;
  check off-canal with both canals inactive), else the Slums puddle look. Mist and glows reuse existing
  transparent or emissive settings (tyre smoke, Farm fireflies); `renderer.info.programs` on vs off is
  the check. No new lights.
- **No animals or people** (frozen ones look dead: the henhouse rule). No ducks, fish shown only as
  ripples, no players on the pitch, no witch, no black cat.
- **Trees are breakable props and hard NavGrid cells** (`ai/NavGrid.ts`): woods block cops off-road
  except along tracks and clearings, which is the point. Trees thin with distance like the Farm's crops.
- **Determinism:** each new roll is on its own salt; nothing new draws from the main `rng` or the
  landmark stream `0x1a4d`.

## Shallow water (branch 1, reused by 2 and 3)

- `world/Water.ts` (pure data): `ShallowWater { shape: rect | ellipse | polygon, y, depth, look }` in
  `city.water`; `SoftPatch` lookup joined into `Vehicle.softGround.at` (one lookup chain for district
  soft ground and water, a spatial grid, no allocation).
- Tuning in `balance.ts` `WATER`: `grip` ~0.7, `drag` ~6 m/s² (a 70 km/h car through a 15 m pond ends
  near 30), `iceGrip` ~0.35 with no drag for frozen water (snow climate), `surface` 0.35 m.
- NavGrid: water is a soft cell (passable at a high cost), so cops go round when they can.
- Civilians never route into it (it's never on a lane). Splash and spray reuse tyre smoke and the canal
  splash sound, quieter; one wading loop sound, faded by speed.
- Snow climate: frozen, white-grey ice surface, ice grip, no spray. Desert: kept (an oasis look).
- **Done when:** a car through a pond loses the planned speed in a headless sim, never sets `sunk`, cops
  in the chase sim cross only when the detour is long, programs unchanged.

## Branch 1: park pieces (fish pond, soccer pitch)

Today about half the parks get a fountain or statue (`planLandmarks`, stream `0x1a4d`). That roll stays
exactly as it is. A **new stream** (`seed ^ PARKS.salt`) then rolls, for each park the old roll left
empty: pond (~0.3), pitch (~0.25), nothing. Trees inside the piece's area (plus clearance) are removed.

- **Fish pond** (`kind: 'pond'`): an irregular blob 14–22 m across, off-centre; a low stone or reed edge
  (stones are a solid ring 0.3 m high with gaps so a car can wade in, reeds breakable), lily pads, a small
  wooden jetty (solid, drivable deck at ground level), a moored rowboat (solid), a bench or two facing
  the water, a "No fishing" sign (breakable), now and then a small fountain jet in the middle. Fish are
  only rising rings in the water shader.
- **Soccer pitch** (`kind: 'pitch'`): a 7-a-side pitch ~44×28 m (fits the ~54 m park ground with run-off),
  long side along the block's long axis or random. Striped mown grass, painted lines (decal, no
  z-fighting: `polygonOffset` per the ground-layer rule), two goals (breakable posts with a small
  collider; the net is opaque cells, no transparency), corner flags, two benches as dugouts, a
  low fence behind each goal (breakable), **a ball** (round collider, rolls like a drum, no heat).
  Floodlight masts at the corners (reuse the Harbor mast; lit at night, under the glow cap). Grass is
  drivable, slightly soft.
- **Params:** park pieces stay read-only `landmarks` (`pond@[i,j]`, `pitch@[i,j]`) and get two
  pinnable counts, `ponds` and `pitches` (at least N, like `ramps`), with words `pond`, `pond=N`,
  `pitch`, `pitch=N`, and `!pond` / `!pitch`. Pinned with too few parks → the word tries the next seed.
- **Seeds:** this changes every city with a park that rolls a piece (trees removed, a piece added) and
  nothing else. `npm run hash -- --vs main` must name only those cities; the test asserts the list
  equals the cities with a pond or pitch. Best times on changed cities: accept (as for districts).
- **Tests:** pieces only in parks without a centrepiece, inside the park ground, clear of the sidewalk;
  trees and props clear of them; words on and off; wading sim; ball rolls and adds no heat.
- **Milestones:** M1 shallow water (data, soft patch, NavGrid, sim tests) · M2 pond (data + render +
  sounds) · M3 pitch (data + render + ball) · M4 params, words, night, climate, perf, docs.

## Branch 2: Mega-park (`megapark`)

One grand city park over a rectangle of blocks, its interior streets turned into park drives.

- **Site:** inland, 2×2 or 3×3 (rolled), ≥ ½ residential, midtown allowed. Roll chance ~0.3.
  Existing parks inside lose their trees and centrepieces (the district plants its own).
- **Gates:** every street in gets park gates (wrought-iron gate posts with lamps, a gate lodge at the
  main-street gate; gates stand open, posts off the roadway). Interior drives: tree-lined both sides
  (avenue trees on the sidewalk line, no overhead), 30 km/h, traffic 0.5×, buses out, cop spawns
  skipped 0.5.
- **Blocks** (roles, each a feature): one **lake** block (a big shallow-water lake 35–45 m with an
  island and a footbridge, rowboats at a boathouse, a fountain jet; `lake` always), one or two
  **sports** blocks (soccer pitch from branch 1, tennis courts behind chain-link, a running track loop;
  `sports=N`), a **playground** (swings, slide, climbing frame, sandpit: breakable props, low fence),
  a **bandstand** lawn (octagonal bandstand, deck chairs breakable), the rest **lawns** (soft grass,
  winding paths, scattered trees, flower beds, picnic tables). A café pavilion with a terrace on one
  block edge (lot with a facade style; ≤ 3 new styles).
- **Props:** Victorian lamps (one `oldLamp` look reusing the oil lamp material), benches, bins,
  picnic tables, ice-cream kiosk and cart, deck chairs, flower planters, park signs (made-up park
  name, generic): breakable, add heat.
- **Cops and traffic:** lawns are soft ground cops follow; the lake is a costly cell; nothing new in the AI.
- **Night:** lamps along drives and paths, lit café and bandstand (glow cap), fireflies on warm nights.
- **Climate:** snow: frozen lake (ice, skating rink look), snowy lawns, bare trees; desert: dry lawns
  with a cactus garden, the lake kept as an oasis; beach: palms, brighter beds.
- **Milestones:** M1 placement + roles + lots · M2 lake (+ boathouse, island, footbridge) · M3 sports,
  playground, bandstand, café · M4 lawns, paths, props, gates, traffic + police · M5 look, night,
  climate, perf, docs.

## Branch 3: Swamp (`swamp`)

Low wet ground on the island edge: roads become causeways between pools, the witch house its signature.

- **Variant** (feature `look=swamp|marsh`, rolled ~60/40): **swamp** = wooded (cypress with hanging moss,
  dead snags, dark water); **marsh** = open reeds and grass tussocks with wide shallow pools, a few
  willows. Beach climate dresses either as mangrove.
- **Site:** edge (outer rows, touching the island edge; coast frontage allowed: the promenade becomes
  a reed bank with a wooden walk, roadway unchanged), 2×2 or 3×3, ≥ ½ residential + industrial.
  Prefer low ground: reject rects whose hill height varies more than `SWAMP.maxRise` (placement rate
  checked with `npm run stats -- swamp`). Roll chance ~0.3.
- **Blocks:** shallow-water pools from branch 1 cover 40–70 % of each ordinary block, with tussock
  islands, half-sunk logs (solid), reeds (breakable, bend like crops), lily pads, duckweed. Boardwalks
  on stilts cross some blocks street to street (drivable deck ≥ widest body + 1 m, wooden rails
  breakable). Stilt shacks and a bait shop (2 facade styles), a rotting jetty with an airboat and
  rowboats (solid), a tilting "Gator crossing"-style sign without the animal (made-up wording).
- **Roads:** muddy verges (soft), wooden guard rails on the kerb (breakable, kerb-clutter rules),
  zebras removed, one lamp per junction (it's dark, like the Slums rule).
- **Witch house** (always, the signature block; `built()` reports it): a crooked two-storey stilt
  house on its own island in the biggest pool, reached by a rickety boardwalk from the nearest street.
  Leaning walls and a twisted chimney, a pointed shingle roof patched in places, round and crooked
  windows lit green at night, a bubbling cauldron on the porch (green glow, bubbles in a shader),
  hanging bottles and dried herbs, a broom by the door, a scarecrow-like totem of sticks, a pumpkin
  patch, will-o'-the-wisps drifting over the water at night (Farm firefly glow, shader-driven, under
  `SWAMP.maxGlow`). Solid; the boardwalk is drivable to the porch; the bottles, herbs and pumpkins are
  breakable. Fairy-tale only: no real religious or occult symbols (no pentagrams), no figure.
  The house is merged geometry per the structure rule, not lots.
- **Features:** `look`, `boardwalks=N`, `airboat`, `wisps` (night-only).
- **Traffic and cops:** traffic 0.4×, pickups ↑, buses and trucks out, cop spawns skipped 0.4. Pools are
  costly NavGrid cells, so chases funnel onto the causeways; roadblocks at the gates.
- **Night and weather:** low mist over the water (reusing a transparent material already in use; drop
  it if it needs a new program), croaks and insect drone in the ambience if audio is ever done.
- **Climate:** snow: frozen pools (ice), frosted reeds, the cauldron still glows; desert: a dried
  salt marsh (cracked mud flats soft and dusty, dead snags, a little water left), the witch house
  kept; beach: mangrove roots and brighter water.
- **Milestones:** M1 placement + roles + pools (branch 1 water) · M2 the witch house · M3 boardwalks,
  shacks, jetty, roads · M4 trees, reeds, props, traffic + police · M5 marsh variant, look, night,
  climate, perf, docs.

## Branch 4: Forest (`forest`)

Woods on the island edge, the one district cops can't cut through.

- **Site:** edge, 2×2 to 4×4, ≥ ½ residential + industrial. Roll chance ~0.3. A forest and a Farm
  may sit side by side (the one-block gap still holds).
- **Blocks:** dense woods (trees spaced 4–7 m, climate kinds: pine in snow, round + pine temperate,
  palms and undergrowth by the beach, sparse dry woodland with dead snags and cactus in the desert).
  Dirt **tracks** wind through most blocks, street to street (≥ widest body + 1 m, soft), so the
  player has a way through that cops have to follow. Undergrowth, fallen logs (a heavy prop: rolled aside by a hard hit), stumps,
  boulders (solid), ferns (breakable).
- **Special blocks (features):** a **lumber yard** at the main-street gate (sawmill shed, log stacks in
  rows with corridors, a log loader, a parked log truck: merged vertex-coloured, no `buildCarMesh`;
  `lumberyard`), a **fire lookout tower** in a clearing (tall, solid legs; `lookout`), a **campsite**
  (a ring of tents solid, picnic tables and a fire pit, glow at night; `campsite`), now and then a
  **pond** from branch 1 (`pond` count).
- **Gate:** a log arch with a made-up name board over the main street (bottom ≥ overhead clearance),
  a ranger station at it (lot). Other gates: plain timber posts.
- **Traffic and cops:** traffic 0.5×, pickups ↑, log trucks ↑ (a box-truck spec with a log load, if
  the traffic code takes a new body cheaply; otherwise dropped), no buses, cop spawns skipped 0.5.
  Woods are hard NavGrid cells: cops off-road only along tracks; line of sight blocked by tree cover
  (if `lineOfSight` reads props; if not, a note for `STAGE2_IDEAS.md`, no change here).
- **Performance is the risk:** a 3×3 forest is ~1–2k trees. Thin by distance (the crop shell method),
  merged far shells per block, colliders stay lazy (props near vehicles only). Budget: tris in view
  (`tri-breakdown.js`), build time (`npm run budget -- forest`), phone FPS on vs off within noise.
  If it doesn't fit, lower the density before anything else.
- **Night:** the darkest district (no street lamps inside, only the lumber yard light and the
  campfire); headlights matter.
- **Milestones:** M1 placement + roles + tree layout + tracks · M2 tree rendering and LOD (measure
  first) · M3 lumber yard, lookout, campsite, gate · M4 props, traffic + police · M5 look, night,
  climate, perf, docs.

## Questions left open (decide on the branch, not now)

- Roll chances: with eight districts and `DISTRICTS.max` 5, more cities get more districts; the
  placement order is shuffled over the rolled-on list, so adding a def moves where older districts
  land on seeds where the new one rolls (as with Harbor, Farm and Slums: accepted). Recheck the odds
  line in `DISTRICTS.md` with `npm run stats` after each branch and lower chances if cities get crowded.
- Whether the pitch's ball should ever count a goal (a sound, nothing else; toasts are for game modes).
  Default: no.
- Mega-park drives at 30 km/h: keep only if the chase still feels fair (the user judges feel).

## Where branch 1 bent from the plan

- **Pond chance 0.12, not 0.3** (the user: 0.3 put a pond in ~3 of 4 cities); now ~1 in 3, ~0.5 a
  city. Pitches stay 0.25 (~1 a city, in ~60 % of cities).
- **One more program is accepted** (the user): a pond city with no canals compiles the canal water's
  program; with canals or in the snow (ice: a plain material) the count is unchanged.
- **Laid after the districts**, parks inside one skipped, one draw per *block* (a district turning
  a park into a lot must not shift the other parks' rolls): districts stay byte-identical.
- **No jetty on the pond:** a deck flush with the bank can't have a collider without a step; it
  moves to the Mega-park lake. The pond has a rowboat pulled up on the bank (a solid landmark).
- **Floodlights are tall street lamps** at the corners (lit at night by the existing bulbs and
  pools), not the Harbor's masts (a district structure, not a prop).
- **Water drag grows with speed** (`SoftPatch.dragPerSpeed`): a flat drag strong enough to matter at
  70 km/h left a stopped car stuck. Flat out through 15 m: 70 → ~48 km/h; wading tops out ~19 km/h.
- **Words:** `pond` / `ponds=N`, `pitch` / `pitches=N` (exact counts, best effort; a word that isn't
  met tries the next seed). Park pieces are not read-only `landmarks` (a landmark is solid).
- Seed guard vs main: exactly the cities with a pond or pitch moved (95 of 120 before the pond
  chance came down); `city-hash` skips empty `water` / `parkPieces` lists.

## Branch 2 status (`districts/megapark`): done, waiting for the user's approval to merge (2026-11-04)

- **Committed:** M1 placement, roles, lots (4fbdca6); M2 lake block (9169656); M3 sports, track,
  playground, bandstand, café terrace, 9 new props (c758b46); M4 lawns, paths, gates, name wall,
  traffic and police tests (649776e); M5 night, desert beds, perf, docs. Seed guard after each
  moved only Mega-park cities (M4: 44 of 120).
- **M4/M5 as built:** `layLawns` runs at the end of `Megapark.dress` (reads the set pieces through
  `q.dressing = out`); gates, the name wall and its board are laid before the filler. Paths render
  with `drapePolyline` (`render/geometry.ts`), the name plate from `megaparkSigns.ts`. Night: gate
  lanterns and 16 bandstand bulbs are glow instances (the lamp bulbs' program), fireflies over the
  lawns share the Farm's (`render/districts/fireflies.ts`). Desert beds are cactus gardens; snow
  paths a darker grey to show on the snow.
- **Numbers:** placed naturally on 20 % of seeds (forced 70 %), +2 ms generation; programs unchanged
  by day (34 = 34), +1 on warm nights in a city without a Farm (the fireflies' program, as the
  pond's water); perf on vs off within noise (frame ~3.4 vs 3.3 ms, GPU ~2.4 both, 60 fps),
  +70 calls, +15 MB textures; `check:restart` on a Mega-park city ok; every gate driven at speed.
- **`maxGlow` 90 → 130:** a 3×3's drives alone carry 72 oil lamps, which left no path lamps once the
  bulbs were reserved (Farm 110, Harbor 140).
- **Bent from the plan:** shapes 2×2 / 2×3 / 3×3 (3×3 rarely fits inland: 70 % placement when forced);
  no new facade styles (café stucco and storefront, lodge ashlar, boathouse siding); the lodge has no
  porch; Victorian lamps are the Old City's `oilLamp`; the island is solid (a folly on it); the lake
  is ~40 m across, sized to fit its block.

### Before finishing M4 (done: `DISTRICTS_DEV.md` files list, conventions, reuse; `alone` / `everyDistrict`)

From the branch-2 retrospective: this session's time went to reading code for reuse points, to rework
caught by tests or screenshots, and to tool friction.
- **`DISTRICTS_DEV.md`: the full list of files a new district touches.** `DistrictKind` union,
  `districts/index.ts`, `render/districts/index.ts`, `scripts/city.ts` (`DISTRICT_CHAR` + legend),
  the kind lists in `evals/district-tour.js` and `evals/district-drive.js`, `NUMBERS` in
  `paramsTesting.ts` for an int feature, the force objects in every other district's tests,
  `CityTheme` climate looks (optional), and a separate `check:restart` run (its `--make` already
  names five districts, and `DISTRICTS.max` is 5).
- **`DISTRICTS_DEV.md`: a conventions section.** Footprint yaw (local X `(cos, −sin)`, local Z
  `(sin, cos)`); a prop's local +Z is its front; `Structure` yaw; `Water` local frame
  (`yaw = atan2(−nz, nx)` points local +X along `(nx, nz)`); `Building.street` bits (1 +Z, 2 −Z,
  4 +X, 8 −X); ground lifts (sidewalk 0.03, grass 0.05, patches 0.07, lines 0.09).
- **Reuse notes.** `block.park = true` in `roles` gives grass and the minimap colour;
  `ParkPiece.district` for a district's pond or pitch (`pitchAt`, the park-piece renderer);
  `rowboat()` is exported; Victorian lamps are `oilLamp` (glow included).
- **`alone(kind)` helper in `paramsTesting.ts`** (force every other `DISTRICT_DEFS` kind off),
  replacing the hand-written `{…, slums: false}` objects in the district tests.

### After M5 (tooling; before Swamp and Forest)

Done after the branch-2 retrospective: `hash --expect <kind>`, `stats -- odds`, glow use in `stats`
(it found the pitch floodlights missing from the park's lamp budget), `clearOf` reports drops
(`dropped`, `CLEAROF=`), a lock per port in `check:browser`, `DISTRICTS_DEV.md` "Night lighting and
the glow budget", `maxGlow` declared on every def. Still open:

- ~~A shared polyline drape~~ (done in M4: `drapePolyline`; the track could move to it) and a shared `fenceRound` (Slums `chainLink` and `MegaparkGrounds` duplicate it).
- `district-tour.js`: support `tourKinds=lot:…` and add a `top=1` straight-down view (angled aerials
  misled once, about the jetty). Studio: a props-only scale (lots make small props unreadable).
- `check:restart`: also cover districts past the five-district `--make` (a second city).
- **Planning:** a 10–15 h branch takes 3–4 sessions. Hand off at milestone boundaries with
  `TASKS.md` and this plan's status section, so the next session doesn't re-read the code.

## Branch 3 status (`districts/swamp`): done, waiting for the user's approval to merge (2026-11-05)

- **M1** (placement, roles, pools): `Swamp.ts`, `SwampPools.ts`. `DistrictDef.fits` (new, optional)
  rejects a rect whose hill varies > `SWAMP.maxRise` (3 m); edge blocks rarely sit on the hill, so
  forced placement is 99 %, natural 33 %. Roles: `landing` beside the main gate, `witch` the block
  farthest from it, the rest `pools`. Pools: the witch's laid first (one, the biggest), then per
  block a big pool sized from the rolled share plus smaller ones; ~35–57 % under water (ellipses
  pack poorly in a square, so the plan's 70 % isn't reached; marsh ~5 points wetter). Banks are soft
  mud. No buildings yet. `serializeCityParams` now counts the key in its 100-column rule (the swamp's
  six roles were the first one-line value to pass it).
- **M2** (witch house): `SwampWitch.ts` (data), `render/districts/SwampWitch.ts`. New shared pieces:
  `world/Deck.ts` (a raised drivable deck with ramped ends: one box + two convex-hull wedges as
  colliders in `CityBuilder`, firm ground in `softGround` (checked before water), NavGrid ground at
  the off-road cost; `dressing.decks`) and `ShallowWater.island` (a dry round island in the middle:
  `shoreDistance` takes the nearer shore, the water mesh's rings end at the island instead of a fan).
  The boardwalk runs from the street side nearest the island, 4 m wide, top 0.6 m, ramps 3.5 / 3 m;
  it lands on the island 2 m short of the porch steps. The house is solid (one footprint, porch
  included); jack-o'-lanterns at the steps (lit props), pumpkins, a scarecrow as the stick totem.
  Windows and the brew are lamp-bulb glow instances (green at night); bubbles are 6 instances moved
  per frame; wisps are the fireflies (new `look` colour/size, same program). `NavGrid.costAt` added.
- **M3** (set and streets): `SwampSet.ts` (boardwalks: decks across "through" pool blocks at the
  wettest offset clear of the shacks, ramps 3.5 m, rail sections either side; the landing's jetty,
  airboat and rowboat), `SwampStreet.ts` (sidewalks become muddy verges: ground patches + soft; split
  rail `fence` sections along the kerbs at rw/2 + 0.65; one wood lamp per junction; a new sign
  variant `bogCrossing`, "MIND THE BOG", inside the first two gates). Lots: the bait shop on the
  landing's side towards the main gate, 1–2 stilt shacks per pool block (`siding`: `boards` is barn
  red). No new facade styles, no new prop kinds (rails reuse `fence` `style: 'rail'`). Features
  `boardwalks` (int) and `airboat`. Night-only features rolled on by themselves no longer warn when
  a dump reloads by day (`rolledFeatures`; Farm's harvest and Chinatown's festival had the same gap).
- **M4** (growth, traffic, police): `SwampWoods.ts`. Three new `TreeKind`s (`cypress` with moss
  strands, `snag`, `willow`; models in `PropSystem.swampTrees`, specs in `TREE_SPECS`) laid as the
  district's own tree props: cypress also stand in the water, willows keep to the banks. Reed clumps
  on the rims, a half-sunk log in half the blocks (solid), lily pads as `ParkPiece`s with
  `district: 'swamp'` (the pond renderer's pads, no rim). Everything goes through `clearOf` against
  the decks' exact outlines (padded outlines would drop the boardwalk rails). Tussocks and duckweed
  dropped (the pads and reeds carry it). `SwampTraffic.test.ts`: civilians, runtime rules, and NavGrid
  crossing a pool block on its boardwalk or round by the streets, never wading.
- **M5** (looks, climate, perf, docs): a bog ground patch per block (0.07; dark moss in the swamp,
  yellow-green in the marsh, pale salt in the desert, lush by the beach); the water's rim lift 0.08 →
  0.09 (2 cm over the bog), the witch island's mud at 0.09 ending at its shore. `RunDressing.trees`
  swaps tree kinds per climate: desert cypress and willows become snags, beach cypress a new
  `mangrove` on arching roots. Snow: frozen pools, bare cypress (the moss stays), white verges and
  boardwalks. Reed clumps thinned to two (the reeds model is 240 tris).
- **Numbers:** forced 99 %, natural 33 %; odds: any Swamp 29 %. Programs: +1 in a city with no canals
  (the canal water's program for the first shallow water, accepted for ponds), +1 on wisp nights (the
  fireflies'). Perf on vs off (seed 11): frame 3.5 vs 3.6 ms, GPU 1.44 vs 1.25 ms, +~20 calls,
  +70–90 k tris in view, 60 fps. Build: walls+roofs ≤ 2.9 k tris, ≤ +22 ms worst. Glow avg 14 of 60.
  `check:restart` ok.

### Where branch 3 bent from the plan

- **Pools ~35–60 %, not 40–70 %:** wobbly ellipses don't pack a square block; the marsh is only a few
  points wetter (its character comes from reeds and willows instead).
- **The island is dry ground, not solid:** a car can wade to it; the house (porch included) is solid.
- **Boardwalks are raised decks with ramps** (0.6 m, a new shared `Deck`), so a car really drives them.
- **No mist** (it would need a new transparent program); **no dark water** (one shallow-water mesh
  shares the canal shader's colours city-wide); **no tussocks or duckweed** (reeds and lily pads carry
  it). The "gator crossing" sign is a yellow diamond reading "MIND THE BOG". The stick totem is the
  Farm's scarecrow. Rails (boardwalk and kerb) reuse the split-rail `fence`.
- **No new facade styles:** shacks and the bait shop are `siding` (`boards` is barn red).

### After M5 (tooling from the branch-3 retrospective; before the Forest)

Time went to reading for reuse points, rework caught by tests, and tool friction. Done:
- `npm run t` prints the first items of each failing break list (`T_ITEMS=`), not `[ …(7) ]`.
- Word `nodistricts`; `check:browser --vs-make "nodistricts …" --make "<kind> …"`: on vs off in one
  command (with `--table`, the perf Δ%).
- `widestBody({ offRoad })` in `VehicleSpecs` (the tests' four copies replaced).
- `npm run stats -- <kind>` prints shallow water's share per block (`Water.waterShare`).
- `dbg.ground(x, z)`; the custom-eval note points at the `dbg` table (`dbg.drive` existed: read the
  whole of `BROWSER_CHECKS.md` before writing an eval).
- `check:restart` runs two cities (`:core`, `:nature`; a new district joins `:nature`).
- `joinRunDressing` adds a climate's `props` (they were silently dropped; nothing used it yet).
- `DISTRICTS_DEV.md`: facade styles (`boards` is barn red), the clutter rule measures by radius,
  programs to expect per climate and with shallow water or fireflies.

## Branch 4 status (`districts/forest`): done, waiting for the user's approval to merge (2026-11-05)

- **M1** (placement, roles, tracks, trees): `Forest.ts`, `ForestWoods.ts`. Edge, residential +
  industrial, shapes 2×2 to 3×4 (4×4 never fits an edge); forced 97 %, natural 22 %, any Forest 23 %
  in the odds. Roles: `lumberyard` beside the main gate, `lookout` deepest in, `campsite` (both on a
  block with two street sides, the campsite off the main gate's blocks), the rest `woods`. Tracks: a
  straight 4 m lead-in from the sidewalk line, then a cubic curve to the opposite side (or a side
  street: a bend), 4.6 m wide, in ~85 % of woods blocks and always through a special block's
  clearing. Trees by dart throwing, each claiming a disc (3.4–6 m apart), off tracks and clearings.
  New shared piece: **`dressing.thicket`**: NavGrid blocks the woods except along the tracks and
  clearings, so cops really follow the tracks (without it, routes cut straight through 4–7 m spacing).
- **M2** (measure first): no LOD needed. Trees are the city's instanced tree props, drawn short of
  the fog; a 4×3 forest +49 k tris in view, calls unchanged; GPU A/B hiding the tree meshes on phone
  settings −1 % (2/4 rounds, noise). So density went up instead (~75–80 trees a block).
- **M3** (set pieces): `ForestSet.ts` (data and render). The log arch is the Farm's ranch gate with
  its own names (`ranchGateAt(…, names)`, `ranchGate(…, wheels)`, `farmSignMaterial(glow, names)`);
  timber posts at the other gates. Lumber yard: apron (truck and loader parked at its street edge),
  rows of log stacks with 5 m corridors and a 6 m aisle (drivable rects), four yard lamps, the sawmill
  lot at the back. Lookout on four legs beside the track in its clearing (windows glow at night).
  Campsite: fire pit (glows day and night) and tents round it on the roomier side, picnic tables.
  Ranger station lot by the main gate.
- **M4** (floor, traffic, police): ferns (new prop `fern`, 60 tris, breakable, soft in NavGrid),
  fallen logs, boulders, stumps (solid structures; logs later a `log` prop). `ForestTraffic.test.ts`.
- **M5**: climate (`RunDressing.trees`): snow all pine, beach palms, desert snags and cacti; no ferns
  in the snow or the desert. Floor, tracks and yard coloured per climate. `maxGlow` 16 (4 yard lamps,
  the fire, 4 windows; worst 4 lit props).
- **Numbers:** gen +11 ms; programs unchanged (temperate 32, snow 32, desert 31 both sides); perf on vs
  off (seed 23768, 3×3): frame ±2 %, GPU 0 to +4 %, 60 fps, +30–40 k tris, +6 calls, +10 MB textures
  (the board atlas, the lots' facades). No z-fighting. `check:restart` ok.

### Where branch 4 bent from the plan

- **Shapes up to 3×4:** a 4×4 never fits an edge with the zone share.
- **Log trucks in traffic dropped:** the district keeps heavies out, and a new body is a new car mesh.
- **Line of sight through trees not done:** `lineOfSight` doesn't read props (a `STAGE2_IDEAS.md` note).
- **No pond:** a Forest pond (a `pond` count) wasn't built; the clearings carry the open spaces.
- **Undergrowth is ferns only** (no bushes): ferns and floor logs carry it; the trees are dense enough.
- **The arch reuses the Farm's ranch gate** (no new structure), without the wagon wheels and mailbox.

### After M5 (tooling from the branch-4 retrospective)

Time went to browser runs one after another (~15, some redone), reading for reuse points, rework from
two documented budgets applied late (the minimap colour, the 64-tri prop budget), and tool gaps. Done:
- `--vs-make` passes the "on" city's district bounds to both sides (`focus=`, `dbg.focus()`,
  `npm run city -- focus`); `district-tour`, `perf-profile` and `gpu-ab` start there, so the side
  without the district is measured in the same place (it once had to be rerun with hand-passed x/z).
- `gpu-ab.js`: `ab=props:<prefix>` (hide one prop model, `dbg.propMeshes`) and `at=x,z | at=focus`.
- `hash --expect` proves every-district cities moved by the placement order alone (rebuilt with the
  kind off, they hash as before) and lists them apart, instead of 24 "moved outside" to sort by hand.
- `district-drive.js`: an edge gate with no road behind it is skipped, not a false hit; tracks
  (`extra.tracks`) are steered end to end with the new `dbg.follow(points)`.
- `browser-check.mjs` logs `EVAL RETURNED NOTHING` instead of printing an empty result that reads
  like a pass.
- `DISTRICTS_DEV.md`: read the budgets before designing (colour contrast, prop tris, glow,
  corridors); edge blocks with fewer than two street sides; dense props don't stop cops (`thicket`).
- **Planning:** this branch ran in one session against the 3–4-session note above; hand off at
  milestone boundaries, `TASKS.md` and this status section carrying the state.
