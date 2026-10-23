# Car Pursuit: design notes

A browser 3D car-chase game (GTA-style wanted stars) on a seeded island city, deployed to GitHub Pages
as an installable PWA. Milestones M0–M7 are done; work now is polish and features. Districts:
[DISTRICTS.md](../DISTRICTS.md). Physics engine version: [RAPIER.md](../RAPIER.md).

## Rules

- **Win:** reach 5 destinations (one shown at a time, 700–1100 m apart by road) before the clock runs out.
- **Lose:** car wrecked (health 0), fall into the sea or a canal, or time runs out.
- Wanted level rises with time and heat (ramming or wrecking cops, smashing props, hitting civilians);
  each destination makes it build 1.3× faster and repairs the car a little. Nothing lowers it.
- Difficulty (`gameplay/difficulty.ts`): No Police (Hard without cops), Easy, Normal, Hard: time limit,
  health, damage, wanted rate, cop cap, traffic density.

## Tech

TypeScript + Vite, Three.js, Rapier (`@dimforge/rapier3d-compat` 0.18.2, ray-cast vehicles), HTML/CSS
HUD, procedural Web Audio. No server: records and prefs live in localStorage (and IndexedDB for prefs)
under the game's own keys; the github.io origin is shared.

```
src/
  core/      Game (fixed 60 Hz physics, state machine), Input, seeded Rng, storage, debugTools
  world/     CityGenerator, RoadGraph, Terrain, Climate, CityTheme, TrafficControl, Landmarks,
             Roadworks, StreetProps/PropSystem, CityBuilder (meshes + colliders), districts/
  vehicles/  Vehicle, VehicleSpecs, carMesh, gears
  ai/        CopController, CopDirector, NavGrid, pursuit, lineOfSight, CivilianTraffic/Controller, junctions
  gameplay/  Mission, Wanted, Health, CopContact, Records, RunLog, Prefs, difficulty, balance.ts
  render/    camera, sky, sea/canals, weather, skid marks, smoke, crash marks, scratches, glows, districts/
  audio/     engine, effects, menu music
  ui/        Hud, Minimap, RunMap, Screens, TouchControls, fullscreen
```

Generation and gameplay logic are pure data (no Three.js), unit-tested with Vitest. Tuning lives in
`gameplay/balance.ts`.

## World

- 8x8 to 15×15 grid (rolled per seed, own RNG stream) of 60 m blocks, 12 m roads, on a seeded hill,
  ringed by a 10 m promenade (lamps, benches facing the sea), a quay and an animated sea; 0–2 canals
  (12–100 m wide) with bridges every few blocks.
- Zones by distance, scaling with the grid: at 12×12 downtown towers (~12 blocks), a thin midtown ring (~32), residential/industrial
  outside by noise (the two outer rows always). Parks, drivable plazas (shortcuts cops don't path
  through), town squares with fountains and statues, jump ramps ("The Leap", canal ramps).
- The seed picks style, time of day, climate (temperate, snow, beach, desert), weather (rain/snow) and,
  rarely, left-hand traffic.
- Traffic lights, priority junctions with stop signs, crossings, bus stops, 90 km/h main streets,
  roadworks; lamps, hydrants, signs, fences, trees and more are breakable.
- Districts (Old City, Chinatown, Harbor, Farm, Slums) overlay themed blocks: [DISTRICTS.md](../DISTRICTS.md).

## Police

| Stars | At | Max cops | Adds |
|---|---|---|---|
| 1 | 0:00 | 2 | Patrol cars |
| 2 | 1:30 | 4 | Faster spawns |
| 3 | 3:00 | 6 | Interceptors |
| 4 | 5:00 | 8 | SUV rammers + roadblocks (every 35 s, 140–260 m ahead on the route) |
| 5 | 7:00 | 10 | Armored trucks |

- The director spawns cops hidden round corners 120–260 m away, 60% ahead on the player's route, never
  within 60 m of the destination; cops > 260 m away or flipped for 3 s are moved back into play.
- Cops follow turn- and speed-aware road routes (a turn costs the time lost braking for it: 60 m of
  road per 90°, 220 m to turn round) aimed up to 2 s ahead of the suspect, switch to lead pursuit with
  line of sight, ram, back off when pinned, and steer off-road (`NavGrid`, never a U-turn on the spot
  while moving) round obstacles. Feelers reach as far as stopping takes: they follow a car ahead at its
  pace, swerve when closing, brake when boxed in, and check behind before reversing. Ideas for losing them: `STAGE2_IDEAS.md`.

## Civilians

Cars, vans, pickups, buses, box trucks, tractors (Farm) and a rare ramp truck. They keep lane, obey
lights and priority, signal, queue, react to brake lights, stop at bus stops and drive on after
crashes. Checked by headless junction and real-city traffic sims.

## Presentation

Damage (smoke, fire, explosion, scratches/dents, delta-V crash damage), skid marks and tyre smoke, body
dive/squat, lights and indicators, sea and canal sounds, pass-by whoosh, minimap, end-screen run map
(route by speed plus incidents, shareable as an image), splash scene, local leaderboard, touch controls
(optional tilt steering), fullscreen.

## URL flags

- Anyone: `?seed=`, `?time=day|afternoon|night`, `?<district>=0|1` (`oldtown`, `chinatown`, `harbor`,
  `farm`, `slums`), `?roadworks`, `?canalramp`, `?england`, `?canals=N`, `?blocks=N` (grid size), `?touch`.
- `?debug`: FPS counter; keys C overview, T teleport to destination, Y 3 s left, K +1 star; `?city=`,
  `?weather=`, `?hill=0|1`; `window.game` and `window.dbg` in the console (see `BROWSER_CHECKS.md`).

## Versions

No git tags; versions are grouped by day of work.

- **v0.1 (2026-10-10):** M0–M7: scaffold, drivable car, seeded city, 5-destination mission, cops with
  wanted stars and roadblocks, civilian traffic, lights and signs, breakable props, minimap, health and
  explosions, touch controls, difficulty, leaderboard.
- **v0.2 (10-11):** buses, trucks, ramp truck; climates and rain; roadworks; "The Leap"; cops spawn
  hidden round corners; share link; repairs at destinations.
- **v0.3 (10-12):** offline PWA; hill, canals, bridges, canal ramps; drowning ends the run; handbrake
  drifts; turn signals; scratches and dents; body dive/squat and gears.
- **v0.4 (10-13):** No Police mode; left-hand traffic; junction priority, bus stops, 90 km/h main
  streets, smarter civilians; cops chase off-road; exhaust; splash scene; shareable run map; mute and
  difficulty remembered.
- **v0.5 (10-14):** performance (long runs, spawns, shader warm-up, phone shadows), Node 24, turn-aware
  cop routing, FPS counter, wanted-level sound, fullscreen with landscape lock.
- **v0.6 (10-15):** districts framework; the Old City; sea waves, safer jump landings, pass-by whoosh,
  crash kinematics and delta-V damage.
- **v0.7 (10-16):** districts 2×2 to 4×4 in more places; Chinatown.
- **v0.8 (10-22):** the Harbor.
- **v0.9 (10-22):** the Farm.
- **v0.10 (10-23):** the Slums.
