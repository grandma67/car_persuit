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
  `districtOfNode`, `nightProps` (`dressing.extra.nightProps`, joined to `city.streetProps` by `Game` on
  night runs only; generation never depends on time).
- `index.ts`: `DISTRICT_DEFS`. `rules.ts`: checks every district keeps. Renderers:
  `render/districts/index.ts` (`DISTRICT_RENDERERS[kind]`: structures, overhead, ground patches).

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

- Grid 12×12 blocks of 60 m, 12 m roads, 10 m promenade, then sea. Midtown is a thin ring; canals and
  town squares take many blocks, so harmless-sounding rules can kill placement.
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
  mouths and fence holes.
- **Solid vs breakable:** structures (walls, columns, legs, stacks, lions, bollards) solid, unbreakable,
  off the roadway; smaller things are breakable props that add heat. Long or wide breakables get a small
  collider (a 7 m boom arm thrown ahead jammed a straddle carrier's gap like a wall).
- **Glow:** cap emissive instances (`<DISTRICT>.maxGlow`); flicker/blink via shader uniforms, never per-light JS.
- **Corridors and gaps** (yards, junkyard, orchard aisles, carrier legs): ≥ widest body + 1 m and
  connected to ≥ 2 streets.
- **No z-fighting:** never overlap coplanar faces. Butt-join exactly or stand one part 2–3 cm proud;
  ground layers ≥ 2 cm apart or `polygonOffset` on the lower (asphalt 1/1, street cobbles 0.5/0.5,
  markings none).

## Looks and performance

- Buildings: `buildingGeometry` → `addBuilding(b, look: LotLook)`. `LotLook` (`facade`, optional `ground`
  for floor 0, `roof`, `roofAlt`, `palette`, `roofTiles`, `trims`) per lot kind in `def.looks`,
  overridable per climate in `CityTheme.districts.<kind>`; no lot → `zoneLook`. One merged wall mesh per
  facade style (`render/Facades.ts`, 8×8 window cells, 512² canvases, `CAPS`, per-window `cell` hook), one
  shared roof mesh (`addRoof` by `RoofShape`, `addTrims` by `TrimKind`); the collider stays the lot box.
  Never give a lot its own mesh or material.
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
3. Looks: facade styles in `Facades.ts` (+ `CAPS`), roofs in `addRoof`, trims in `addTrims`.
4. Renderer `render/districts/<Name>.ts` in `DISTRICT_RENDERERS`.
5. Docs: `DISTRICTS.md` (table row + section, odds line), `plans/PLAN_GAME.md` version line, README mention.

## Pitfalls

- **Measure placement rate** (`npm run stats -- <kind>`) after any rule, alone and with all districts
  forced; check rejection reasons if low. A district's position depends on those placed before it.
- `perimeterWall` opens at *every* street crossing the wall, not just gates (`'mainStreet'` districts
  have gateless crossings).
- Never derive a random pick list from an extendable `Record`: `LANDMARK_KINDS` is an explicit list.
- Cops spawn 20 m down a side street: spawn rules must test the spot (`skipAt`), not the junction.
- Civilians' forward sensor skips fixed bodies, so lane obstacles need kinematic bodies; dodging into a
  parked van scraped, so vans park on the kerb (`vanOnKerb`).
- A search for buildings "on the street" must allow the lot gap: Chinatown's `streetMask` wants faces
  within 1 m of the sidewalk line, Harbor lots stand 2–4 m back (`frontMask`).
- Watch: cops snagging clutter near junctions (push `clutterMinOffset` out), the chase camera clipping
  low overhead pieces, crane span tracking sidewalk + road + promenade (~25 m, from `DEFAULT_CITY`), a
  shallow hull poking through the shader swell, cops bogging in soft ground, glow and fill cost on phones.

## Testing

- `Districts.test.ts` uses **stub defs** (one inland, one coast): rolls, overlay invariant, placement,
  gates, main street, wall loop, lots, clutter offsets, runtime rules. Run after any change in
  `world/districts`, `CityGenerator`, `lots.ts`.
- Real district: `<Name>.test.ts` beside it, `generateCity(seed, undefined, { force: { oldtown: true } })`
  over ~40 seeds (`i * 7919 + 11`). Assert plan items as logic: geometry vs road rects
  (`footprintsOverlap`, `rectFootprint`, `city.roads`, `city.intersections`), heights vs clearance,
  lot/role counts, junction controls unchanged. Prefer all-seed properties. Checks return the list of
  breaks: `expect(breaks).toEqual([])`, never `expect` inside a loop over props × roads (that cost 40 s).
- Traffic/cops on a real city: `districts/trafficSim.ts` (`flatSeeds`, `cityWorld`, `simulate` hands each
  car per step; see `SlumsTraffic.test.ts`). Don't extend the synthetic junction sims (`ai/junctionSim.ts`,
  `IntersectionSim`, `CivilianTurns`): they can't hold a district. A sim over ~8 s gets its own file
  (files run in parallel, tests in a file don't).
- `StreetProps.test` / `BuildingGeometry.test` use the default registry or `defs: []`; new districts
  appear on their seeds, so exempt district dressing where it may differ.
- Browser checks per milestone: [BROWSER_CHECKS.md](BROWSER_CHECKS.md).
