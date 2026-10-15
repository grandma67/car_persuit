# Car Pursuit — Design Notes

A browser 3D car-chase game (GTA-style wanted stars) on a seeded island city, deployed to GitHub Pages as an installable PWA. All milestones (M0–M7) are done; work now is polish and features.

## Versions

No git tags; versions are grouped by day of work.

- **v0.1 (2026-10-10):** milestones M0–M7 — Vite/Three.js/Rapier scaffold, drivable car, seeded city, 5-destination mission, cops with wanted stars and roadblocks, civilian traffic, traffic lights and signs, breakable props, minimap, health and explosions, touch controls, difficulty, leaderboard.
- **v0.2 (2026-10-11):** buses, trucks and a ramp truck; climates (snow, beach, desert) and rain; roadworks; "The Leap" jump ramp; cops spawn hidden around corners; share link; more health, with repairs at destinations.
- **v0.3 (2026-10-12):** installable offline PWA; seeded hill and canals with bridges and canal ramps; falling into water ends the run; handbrake drifts; turn signals; car scratches and dents; body dive/squat and gears.
- **v0.4 (2026-10-13):** No Police mode; left-hand traffic on rare seeds; junction priority, bus stops, 90 km/h main streets, smarter civilians; cops chase off-road; exhaust fumes; splash chase scene; end-screen run map shareable as an image; mute and difficulty remembered between sessions.
- **v0.5 (2026-10-14):** performance work (long runs, spawns, shader warm-up, phone shadows), Node 24 and updated dependencies, turn-aware cop routing, FPS counter, wanted-level sound, fullscreen icon with landscape lock.

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

FPS counter; C overview, T teleport to destination, Y 3 s left, K +1 star; `?city=`, `?weather=`, `?hill=0|1`; `window.game` in the console (used by `npm run check:browser`). Without debug: `?seed=`, `?time=`, `?roadworks`, `?canalramp`, `?england`, `?canals=N`, `?touch`.
