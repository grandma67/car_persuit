# Car Pursuit: design notes

A browser 3D car-chase game (GTA-style wanted stars) on a seeded island city, deployed to GitHub Pages
as an installable PWA. Work now is polish and features. Districts: [DISTRICTS.md](../DISTRICTS.md);
city params: [CITY_PARAMS.md](../CITY_PARAMS.md); physics version: [RAPIER.md](../RAPIER.md).

## Rules

- **Win:** reach 5 destinations (one shown at a time, 700–1100 m apart by road) before the clock runs out.
- **Lose:** car wrecked (health 0), fall into the sea or a canal, or time runs out.
- Wanted level rises with time and heat (ramming or wrecking cops, smashing props, hitting civilians);
  each destination makes it build 1.3× faster and repairs the car a little. Nothing lowers it.
- Difficulty (`gameplay/difficulty.ts`): No Police (Hard without cops), Easy, Normal, Hard: time limit,
  health, damage, wanted rate, cop cap, traffic density.

## Tech

TypeScript + Vite, Three.js, Rapier (`@dimforge/rapier3d-compat` 0.18.2, ray-cast vehicles), HTML/CSS
HUD, procedural Web Audio, Node ≥ 24. No server: records and prefs live in localStorage (prefs also in
IndexedDB) under the game's own keys; the github.io origin is shared.

```
src/
  core/      Game (fixed 60 Hz physics, state machine), Input, seeded Rng, storage, debugTools, gpuTrace
  world/     CityParams, makeCityParams, CityGenerator, RoadGraph, Terrain, Climate, CityTheme,
             TrafficControl, Landmarks, Roadworks, StreetProps/PropSystem, CityBuilder, districts/
  vehicles/  Vehicle, VehicleSpecs, carMesh, gears
  ai/        CopController, CopDirector, NavGrid, pursuit, lineOfSight, CivilianTraffic/Controller, junctions, horn
  gameplay/  Mission, Wanted, Health, CopContact, Records, RunLog, Prefs, difficulty, balance.ts
  render/    camera, sky, sea/canals, weather, skid marks, smoke, crash marks, scratches, glows, districts/
  audio/     engine, effects, menu music
  ui/        Hud, Minimap, RunMap, Screens, TouchControls, fullscreen
```

Generation and gameplay logic are pure data (no Three.js), unit-tested with Vitest.

**Restart in place:** Retry and New city don't reload the page (that would leave fullscreen on phones).
`main.ts` disposes the Game (`Game.dispose()`: scene GPU resources, Rapier world, DOM, listeners, car
mesh templates) and builds the next one behind the splash, keeping the renderer and audio (`GameShell`).
The seed goes into the URL with `history.replaceState`. Anything a run adds to the page must be undone
in `dispose()` (`npm run check:restart`, [LEAKS.md](../LEAKS.md)).

## World

- 8×8 to 15×15 grid (rolled per seed, own stream) of 60 m blocks, 12 m roads, on a seeded hill, ringed
  by a 10 m promenade (lamps, benches facing the sea), a quay and an animated sea; 0–2 canals
  (12–100 m wide) with bridges every few blocks.
- Zones by distance, scaling with the grid (at 12×12: ~12 downtown tower blocks, a thin midtown ring of
  ~32, residential/industrial outside by noise, the two outer rows always). Parks, drivable plazas
  (shortcuts cops don't path through), town squares with fountains and statues, jump ramps ("The Leap",
  canal ramps).
- The seed picks style, time of day, climate (temperate, snow, beach, desert), weather (rain/snow) and,
  rarely, left-hand traffic.
- Traffic lights, priority junctions with stop signs, crossings, bus stops, 90 km/h main streets,
  roadworks; lamps, hydrants, signs, fences, trees and more are breakable.
- Parks with no centrepiece may get a fish pond (shallow water you wade through, never drown in;
  ice in the snow) or a 7-a-side soccer pitch (goals, floodlights, a ball that rolls and adds no heat).
- Districts (Old City, Chinatown, Harbor, Farm, Slums, Mega-park, Swamp, Forest) overlay themed blocks.

## Police

| Stars | At | Max cops | Adds |
|---|---|---|---|
| 1 | 0:00 | 2 | Patrol cars |
| 2 | 1:30 | 4 | Faster spawns |
| 3 | 3:00 | 6 | Interceptors |
| 4 | 5:00 | 8 | SUV rammers + roadblocks (every 35 s, 140–260 m ahead on the route) |
| 5 | 7:00 | 10 | Armored trucks |

The director spawns cops hidden round corners 120–260 m away, 60% ahead on the player's route, never
within 60 m of the destination; cops > 260 m away or flipped for 3 s are moved back into play. Cops take
turn-aware road routes aimed ahead of the suspect, lead-pursue and ram in sight, and go off-road on a
NavGrid. How the brain works: [COPS_DEV.md](../COPS_DEV.md). Ideas for losing them: `STAGE2_IDEAS.md`.

## Civilians

Cars, vans, pickups, buses, box trucks, tractors (Farm) and a rare ramp truck. They keep lane, obey
lights and priority, signal, queue, react to brake lights, stop at bus stops, drive on after crashes,
and honk (a blast when bumped, beeps when the player or a crashed car blocks them, never at a queue).
Checked by headless junction and real-city traffic sims.

## Presentation

Damage (smoke, fire, explosion, scratches/dents, delta-V crash damage), skid marks and tyre smoke, body
dive/squat, lights and indicators, sea and canal sounds, pass-by whoosh, horns (H for the player), look
back (B), minimap, end-screen run map (route by speed plus incidents, shareable as an image), splash
scene, local leaderboard, touch controls (optional tilt steering), fullscreen.

## URL flags

- Anyone: `?seed=`, `?time=day|afternoon|night`, `?<district>=0|1` (`oldtown`, `chinatown`, `harbor`,
  `farm`, `slums`), `?roadworks`, `?canalramp`, `?england`, `?blocks=N`, `?touch`.
- `?debug`: FPS counter; keys C overview, T teleport to destination, Y 3 s left, K +1 star; `?city=`,
  `?weather=`, `?canals=N`, `?hill=0|1`; `window.game` and `window.dbg` (`BROWSER_CHECKS.md`), including
  `dbg.dumpCity()` / `dbg.loadCity(json)` (`CITY_PARAMS.md`).
- `?gputrace`: `window.gpuTrace` names every GPU resource with its creation site (leak hunting).
- City flags are words: `urlOverrides` in `world/makeCityParams.ts`; `npm run city -- dump <seed> <flags>`
  shows what a link builds.

## Versions

No git tags; grouped by day of work.

- **v0.1 (2026-10-10):** scaffold, drivable car, seeded city, 5-destination mission, cops with wanted
  stars and roadblocks, civilian traffic, lights and signs, breakable props, minimap, health and
  explosions, touch controls, difficulty, leaderboard.
- **v0.2 (10-11):** buses, trucks, ramp truck; climates and rain; roadworks; "The Leap"; hidden cop
  spawns; share link; repairs at destinations.
- **v0.3 (10-12):** offline PWA; hill, canals, bridges, canal ramps; drowning; handbrake drifts; turn
  signals; scratches and dents; body dive/squat and gears.
- **v0.4 (10-13):** No Police; left-hand traffic; junction priority, bus stops, 90 km/h streets, smarter
  civilians; off-road cops; exhaust; splash scene; shareable run map; mute and difficulty remembered.
- **v0.5 (10-14):** performance (long runs, spawns, shader warm-up, phone shadows), Node 24, turn-aware
  cop routing, FPS counter, wanted-level sound, fullscreen with landscape lock.
- **v0.6 (10-15):** districts framework; the Old City; sea waves, safer jump landings, pass-by whoosh,
  crash kinematics and delta-V damage.
- **v0.7 (10-16):** districts 2×2 to 4×4 in more places; Chinatown.
- **v0.8–v0.10 (10-22, 10-23):** the Harbor, the Farm, the Slums.
- **v0.11 (10-23, 10-24):** grid size per seed (8–15); cops brake for what's ahead, costlier turns,
  head the suspect off; look back (B); civilian horns and the player's (H); Retry/New city in place.
- **v0.12 (10-30):** city params: every city choice as JSON, built from feature words.
- **v0.13 (11-03):** shallow water; park fish ponds and soccer pitches.
- **v0.14 (11-04):** the Mega-park.
- **v0.15 (11-05):** the Swamp (the witch house, drivable boardwalks).
- **v0.16 (11-05):** the Forest (woods cops can't cut through, dirt tracks, lumber yard, lookout, campsite).
