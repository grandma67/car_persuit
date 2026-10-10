# Car Pursuit — Game Plan

A browser 3D car-chase game (GTA-style wanted system) on a random city map, deployed to GitHub Pages.

## Rules

- **Win:** reach all 5 destinations (sequential, one shown at a time) within 10:00.
- **Lose:** your car's health reaches 0, or the timer runs out.
- Wanted level (stars) rises over time; ramming/wrecking cops adds extra heat.
- City is generated from a seed (`?seed=1234` replays a map).

## Decisions

| Topic | Decision |
|---|---|
| Art style | Low-poly, but sharp, cool-looking cars (clean silhouettes, strong colors, emissive lights) |
| Destinations | Sequential, one visible at a time, GPS arrow + minimap |
| Mobile | Later (M7). Desktop keyboard first |
| Civilian traffic | Added in M6. Sparse, so it is something to weave through, not a wall that blocks escape |

## Tech stack

- TypeScript + Vite (static build → GitHub Pages)
- Three.js (rendering, InstancedMesh for the city)
- Rapier (`@dimforge/rapier3d-compat`): physics + raycast vehicle controller; WASM embedded, no MIME issues
- HTML/CSS overlay for HUD; Howler.js for audio (M6)

## Architecture

```
src/
  main.ts                 bootstrap, game state machine (Menu → Playing → Won/Lost)
  core/      Game (fixed 60Hz physics, render interpolation), Input, Rng (seeded), Events
  world/     CityGenerator (pure data), RoadGraph (A*), CityBuilder (meshes + colliders)
  vehicles/  Vehicle, VehicleSpecs, PlayerController
  ai/        CopController (Navigate → Chase → Ram → Recover), CopDirector (spawn/despawn)
  gameplay/  WantedSystem, MissionSystem, DamageSystem, balance.ts (all tuning numbers)
  render/    ChaseCamera, Minimap, Effects
  ui/        Hud, Menus
```

Generation and gameplay logic are pure data/logic (no Three.js) so they can be unit-tested.

## City generation

- Grid ~12×12 blocks (~60m blocks, ~12m roads, ~900m city).
- Random block merges (parks/plazas), ~10% road removal with connectivity check, a few wide avenues.
- Noise-based districts: downtown (tall), residential (low), industrial (warehouses).
- Road graph (intersections = nodes) drives AI pathing, spawn points and destination placement.
- Destinations: road nodes with A* distance ≥ ~400m between consecutive ones.

## Wanted escalation

| Stars | At ~ | Max cops | New threat |
|---|---|---|---|
| 1 | 0:00 | 2 | Patrol car (your speed, light) |
| 2 | 1:30 | 4 | More patrols, faster reactions |
| 3 | 3:00 | 6 | Interceptor (faster than you, fragile) |
| 4 | 5:00 | 8 | SUV rammer (heavy) + roadblocks |
| 5 | 7:00 | 10 | Armored truck (very heavy) |

## Cop AI

- Navigate: A* on road graph, pure-pursuit steering along waypoints.
- Chase: line of sight → steer at predicted player position.
- Ram: close range, full throttle.
- Recover: stuck >1.5s → reverse + turn.
- Director: spawn 150–250m away off-screen, despawn >400m behind, mild rubber-banding.

## Damage

Collision contact force above a threshold × opponent mass factor → health loss. Smoke at 50%, fire at 20%, explosion at 0. Cops have health too.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 ✅ | Scaffold + deploy pipeline | Scene with Rapier physics live on GitHub Pages |
| M1 ✅ | Drivable car, chase camera | Driving feels fun |
| M2 | City generator + colliders | Seeded city, can't drive through walls |
| M3 | Mission system + HUD | Full loop playable without cops |
| M4 | One patrol cop AI | Convincing single chase |
| M5 | Director, stars, all cop types, damage | Complete game |
| M6 | Polish: audio, particles, minimap, menus, car models, sparse civilian traffic | Showable |
| M7 | Mobile touch controls, difficulty, leaderboard | — |
