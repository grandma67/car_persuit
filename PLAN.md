# Car Pursuit — Design Notes

A browser 3D car-chase game (GTA-style wanted stars) on a seeded island city, deployed to GitHub Pages as an installable PWA. All milestones (M0–M7) are done; work now is polish and features.

## Versions

No git tags; versions are grouped by day of work.

- **v0.1 (2026-10-10):** milestones M0–M7 — Vite/Three.js/Rapier scaffold, drivable car, seeded city, 5-destination mission, cops with wanted stars and roadblocks, civilian traffic, traffic lights and signs, breakable props, minimap, health and explosions, touch controls, difficulty, leaderboard.
- **v0.2 (2026-10-11):** buses, trucks and a ramp truck; climates (snow, beach, desert) and rain; roadworks; "The Leap" jump ramp; cops spawn hidden around corners; share link; more health, with repairs at destinations.
- **v0.3 (2026-10-12):** installable offline PWA; seeded hill and canals with bridges and canal ramps; falling into water ends the run; handbrake drifts; turn signals; car scratches and dents; body dive/squat and gears.
- **v0.4 (2026-10-13):** No Police mode; left-hand traffic on rare seeds; junction priority, bus stops, 90 km/h main streets, smarter civilians; cops chase off-road; exhaust fumes; splash chase scene; end-screen run map shareable as an image; mute and difficulty remembered between sessions.
- **v0.5 (2026-10-14):** performance work (long runs, spawns, shader warm-up, phone shadows), Node 24 and updated dependencies, turn-aware cop routing, FPS counter, wanted-level sound, fullscreen icon with landscape lock.
- **v0.6 (2026-10-15):** city districts framework; the Old City: a walled medieval quarter with gatehouses, a market square and clock tower, half-timbered streets, cannons, ruins and breakable market clutter, 30 km/h traffic and fewer cops inside.
- **v0.7 (2026-10-16):** districts come in 2×2 to 4×4 and in many more places; Chinatown: paifang gates with guardian lions, dragon lamps and lantern strings, shophouses with five-foot ways, restaurants, a pagoda square, breakable stalls and firecracker crates, double-parked vans, a glowing night market and Lunar New Year festival nights with fireworks.
- **v0.8 (2026-10-22):** the Harbor: a cargo port on the coast with gantry cranes straddling the seafront road (working a container ship, or idle with booms up beside bulk and cargo ships), a fenced container yard to drive through (boom barriers, straddle carriers, floodlight masts, a rail siding with level crossings), sawtooth and barrel-roofed sheds, a harbor office, silo and tank farm, a terminal gate, rolling drums and cable reels, and crane and aviation lights at night.
- **v0.9 (2026-10-22):** the Farm: fields on the island's edge (corn you plough through with a maze on some seeds, swaying wheat, a pumpkin patch, an orchard, hay with round bales) behind split-rail fences, a ranch gate and cattle grids, a red barn, farmhouse, silos, grain bins and a windmill, scarecrows, parked tractors and machinery, crops that flatten where cars drive, soft ground off the road, slow tractors in traffic, fireflies and harvest nights with jack-o'-lanterns.
- **v0.10 (2026-10-23):** the Slums: brick walk-ups with fire escapes, boarded shops and burnt-out shells, a destroyed building fallen to rubble, a rusted rail overpass over the main street in, rubble lots behind torn chain-link (a bumpy shortcut), a junkyard of wreck stacks with a magnet crane, a tent camp, graffiti everywhere, wrecks and junk at the kerb, dead street lamps, sagging wires and laundry lines, potholes that jolt every car, and burn barrels glowing at night.

## Rules

- **Win:** reach 5 destinations (one shown at a time, 700–1100 m apart by road) before the clock runs out.
- **Lose:** car wrecked (health 0), fall into the sea or a canal, or time runs out.
- Wanted level rises with time and heat (ramming or wrecking cops, smashing props, hitting civilians); each checkpoint speeds it up and repairs the car a little.
- Difficulty: No Police (Hard without cops), Easy, Normal, Hard — time limit, health, damage, wanted rate, cop cap and traffic density (`gameplay/difficulty.ts`).

## Tech

TypeScript + Vite, Three.js, Rapier (`@dimforge/rapier3d-compat`, raycast vehicles), HTML/CSS HUD, procedural Web Audio. No server: records and prefs live in localStorage under the game's own keys (the github.io origin is shared).

## Code layout

```
src/
  core/      Game (fixed 60 Hz physics, state machine), Input, seeded Rng, storage
  world/     CityGenerator, RoadGraph, Terrain, Climate, CityTheme, TrafficControl,
             Landmarks, Roadworks, StreetProps/PropSystem, CityBuilder (meshes + colliders)
  vehicles/  Vehicle, VehicleSpecs, carMesh, gears
  ai/        CopController, CopDirector, NavGrid, pursuit, lineOfSight,
             CivilianTraffic/CivilianController, junctions
  gameplay/  Mission, Wanted, Health, CopContact, Records, RunLog, Prefs, difficulty, balance.ts
  render/    camera, sky, sea/canals, weather, skid marks, smoke, crash marks, scratches, glows
  audio/     car engine, sound effects, menu music
  ui/        Hud, Minimap, RunMap, Screens, TouchControls, fullscreen
```

Generation and gameplay logic are pure data (no Three.js) and unit-tested with Vitest. All tuning numbers live in `gameplay/balance.ts`.

## World

- 12×12 block grid on a seeded hill, ringed by a quay and an animated sea; 0–2 canals (12–100 m wide) with bridges every few blocks.
- Zones (downtown towers → residential/industrial), parks, drivable plazas (shortcuts cops don't path through), town squares with fountains, statues and the occasional jump ramp ("The Leap", canal ramps).
- Seed picks style, time of day, climate (temperate, snow, beach, desert), weather (rain/snow) and, rarely, left-hand traffic.
- Traffic lights, priority junctions with stop signs, crossings, bus stops, roadworks sites; lamps, hydrants, signs, fences, trees and more are breakable.
- Districts: themed areas laid over a rectangle of blocks, each rolled per seed on its own stream (`world/districts/`). Sizes are rolled (2×2, 3×3 or 4×4) and places vary; the inland districts keep off the two outer rows. Odds per seed (300 seeds): no district 5%, one 25% (Old City 8%, Chinatown 6%, Harbor 4%, Slums 4%, Farm 3%), two 36%, three 25%, four 9%, all five under 1%. The **Old City** (55% roll): crenellated walls with corner towers, a gatehouse at every street in (arch, raised portcullis, drawbridge deck, torches, banners), cobbled streets with a gutter, half-timbered and stone houses with jetties and steep roofs, a market square (well, market cross, pillory, stalls, cannons) faced by a town hall whose clock keeps the game time and strikes the hour, ruins, and breakable pots, barrels, carts and haybales on the kerbs. Inside: 30 km/h, half the traffic, no buses or trucks, cops spawn less, and 4★+ roadblocks prefer the gates. Sandstone in the desert, limewashed by the sea, snow on the walls in winter.
- **Chinatown** (50% roll, inner city): a paifang (red columns, green-tiled roofs, a 中華街 name board) and a pair of stone lions at each end of its main street, dragon lamp posts with 福 / 春 banners, red lanterns strung across the streets (they swing as you pass under), pastel shophouses over covered five-foot ways, red-and-gold restaurants with roast ducks and fish tanks under pagoda caps, a tea house, bakery, herbal and bubble-tea shops, a temple, bilingual signboards and vertical neon, sometimes a pagoda on a small square. Breakable produce stalls, dim-sum carts, lantern stands, fish crates, mahjong tables, menu boards and firecracker crates (a hop, no damage); 1–3 vans parked up on the kerb. 40 km/h on the main street only, busier traffic, buses still through, paifang roadblocks. At night it is the brightest place in town: glowing lanterns and shop windows, flickering neon, a night market (more stalls, bare-bulb strings); a quarter of seeds are Lunar New Year (twice the lanterns with gold ones, a lion dance and a dragon float that burst into red-and-gold confetti, fireworks over the pagoda). Faded reds in the desert, brighter pastels by the beach, snow on roofs and awnings.
- **Harbor** (45% roll, coast: an outer-row cluster with its long side on the sea, mostly industrial): the seafront road runs under 1–3 red-and-white gantry cranes (landside legs on the sidewalk, waterside on the quay edge), the promenade turned into a concrete apron with crane rails, bollards and lifebuoys; a ship moored alongside (container ship, bulk carrier or general cargo, sometimes a tug) with mooring lines; on a container ship the cranes swing boxes between ship and parked terminal trucks, otherwise they stand idle, booms raised. One or two quay blocks are a chain-link-fenced container yard: stacks 1–4 high in rows with corridors from street to street (breakable boom barriers at each mouth), straddle carriers you drive between the legs of, a reach stacker by the empties, floodlight masts, and a rail siding with flatcars and level crossings. Behind: warehouses (roller doors, loading docks, sawtooth or barrel roofs, painted shed numbers), open-sided transit sheds on the quay, cold stores, the harbor office with its radar mast and lit control room, sometimes a silo battery with a conveyor gallery over the road and a tank farm. A terminal gate (canopy, lane lights, guard booth, weighbridge) where the main street leaves inland. Breakable pallets, crates, drums and cable reels (these roll), forklifts. No speed cap, slightly lighter traffic with more box trucks and vans, roadblocks at the gates. Sodium floodlights and blinking aviation lights at night; dusty in the desert, brighter paint by the beach, snow on boxes, girders and roofs.
- **Farm** (40% roll, edge: an outer-row cluster touching the island's edge, mostly residential): the block by the ranch gate (log posts, a hanging name board over the main street, wagon wheels, a mailbox) is the farmyard: a red gambrel barn with a hay hood, a white farmhouse with a porch, a lean-to machine shed open to the yard, a granary on stilts, a henhouse, 1–3 silos, grain bins with augers, a windmill turning in the wind, sometimes a water tower. Every other block is a field behind split-rail fences with gates onto the streets: corn (row strips you plough through; a maze on some seeds), wheat, a pumpkin patch with a roadside stand, an orchard of apple or pear trees with drivable aisles, or hay with solid round bales. Crops bend and break where cars drive; fields are soft (less grip, more drag, dust or mud, ruts). Scarecrows, parked tractors, a combine by the wheat, ploughs, balers, hay wagons, churns and feed sacks, all breakable. Cattle grids rattle under the other gates. Light traffic with pickups and slow tractors (inside and on the roads round it), fewer cops spawn inside, roadblocks at the gates, cops follow across the fields. Timber street lamps, a yard light and barn lantern at night, fireflies on warm nights; on harvest nights jack-o'-lanterns and a bale pyramid. Snowy fields, dry stalks and bare orchards in winter (no pumpkins); bleached crops and a parked centre-pivot irrigator in the desert; brighter paint and greener fields by the beach.
- **Slums** (35% roll, inland, 2×2 or 3×3, at least half residential or industrial): grimy brick walk-ups (each window dirty, cracked, smashed, boarded or curtained) with zigzag fire escapes, crumbling parapets, water tanks and dishes, over boarded shop rows (plywood, rusted shutters, barred glass); burnt-out shells open to the sky with charred joists; squats with a tarp over a fallen-in bay; one corner store still open (OPEN 24 band, payphones outside). One or two destroyed buildings: ragged wall stubs with window holes, slabs hanging onto a rubble heap that spills over the sidewalk, rebar and joists, a KEEP OUT hoarding, loose bricks. A riveted rail overpass spans the main street where it comes in. One or two vacant blocks are rubble lots behind torn chain-link with holes on the street sides: soft and bumpy (less grip, more drag), a shortcut cops follow; a tent camp may take one (tarps, tents, a couch round a fire ring; solid). A junkyard: wreck stacks in rows with corridors from street to street, a magnet crane, a crusher, tyre mountains, corrugated fence with BEWARE OF DOG. Graffiti on walls, shutters, piers, parapets and fences (tags, bubble letters, throw-ups, stencils, murals; a few up by the roofs). Wrecks at the kerb and in the lots (burnt out, on bricks, stripped, on their roof, crushed; the ones on bricks or on their roof don't budge), dumpsters at alley mouths, bags, carts, mattresses, couches, tyres and burn barrels, all breakable. Utility poles with sagging wires and hanging sneakers, laundry lines across the streets, stumps for trees, potholes that jolt every car, oil, puddles, cracks, faded lines, litter, steaming manholes. Inside: 0.6× traffic with more pickups and vans, no buses or trucks, half the cop spawns skipped, roadblocks at the gates. At night most lamps are dead (one working per junction, one buzzing per street), burn barrels and the camp fire glow. Slush in the gutters, icicles on the fire escapes and barrels lit by day in the snow; blown sand, adobe-toned walls and bleached wrecks in the desert; chalky pastels and salt-rusted wrecks by the beach.

## Police

| Stars | At | Max cops | Adds |
|---|---|---|---|
| 1 | 0:00 | 2 | Patrol cars |
| 2 | 1:30 | 4 | Faster spawns |
| 3 | 3:00 | 6 | Interceptors |
| 4 | 5:00 | 8 | SUV rammers + roadblocks |
| 5 | 7:00 | 10 | Armored trucks |

- Director spawns cops hidden around corners, often ahead on the player's route; leashes far or flipped cops back.
- Cops follow turn-aware, speed-aware road routes, switch to lead pursuit with line of sight, ram, back off when pinned, and steer off-road around obstacles.

## Civilians

Cars, vans, pickups, buses, box trucks and a rare ramp truck. They keep lane, obey lights and priority, signal, queue, react to brake lights, stop at bus stops and drive on after crashes. Checked by headless junction sims.

## Presentation

Damage (smoke, fire, explosion, scratches/dents), skid marks and tyre smoke, body dive/squat, lights and indicators, minimap, end-screen run map (route by speed plus incidents, shareable as an image), splash scene, local leaderboard, touch controls, fullscreen.

## Debug (`?debug`)

FPS counter; C overview, T teleport to destination, Y 3 s left, K +1 star; `?city=`, `?weather=`, `?hill=0|1`; `window.game` in the console (used by `npm run check:browser`). Without debug: `?seed=`, `?time=`, `?oldtown=0|1` / `?chinatown=0|1` / `?harbor=0|1` / `?farm=0|1` / `?slums=0|1` (force a district off or on), `?roadworks`, `?canalramp`, `?england`, `?canals=N`, `?touch`.
