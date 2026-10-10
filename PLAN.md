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

- Grid 12×12 blocks (60m blocks, 12m roads, ~876m city), generated in 1–5ms.
- ~10% of inner road segments become **plazas**: paved, drivable shortcuts with planters, not in the road graph (cops path by roads, so plazas are escape routes). Outer ring road always kept; network stays connected with **no dead ends**.
- Districts: downtown towers (centre), midtown, then residential/industrial split by smooth value noise; ~8% parks with trees (drivable).
- Buildings: merged wall/roof meshes with lit-window textures, one static collider each; invisible boundary walls.
- Road graph (intersections = nodes) drives AI pathing, spawn points and destination placement.
- Destinations: road nodes with A* distance ≥ ~400m between consecutive ones.
- `?seed=N` reproduces a city; `?debug` + C toggles a top-down overview. `npm test` covers generator invariants.
- Not done: wide avenues (deferred; uniform roads for now).

## Mission (M3)

- 5 sequential destinations, 400–800m by road apart (Dijkstra), own RNG stream so they're fixed per seed.
- Light beam + pulsing ring marks the target (green for the final one); GPS chevron above the car follows the road route.
- States: menu → playing ⇄ paused → won/lost. Retry reloads the same seed; New city picks a random one.
- Debug (`?debug`): C overview, T teleport to destination, Y leave 3s on the clock, `window.__game` for browser tests.

## Island, minimap, health (added after M3)

- City sits on an island: 10m promenade, concrete quay, low sea wall (+ tall invisible collider); animated flat-shaded sea around it.
- Round heading-up minimap (top right) with road route, destination (pinned to rim when off-map) and player arrow; replaces the 3D GPS arrow.
- Health (gameplay/Health.ts): crash damage from impact Δv (5 m/s free, 1.8 HP per m/s above); smoke <50%, fire <20%, wrecked at 0 → lose. Health bar under the minimap, red flash on hits.

## World dressing (added after M3)

- Breakable street props (lamps with light pools, hydrants with geysers, benches, picket fences): solid when nudged, knocked loose above a break speed (`world/StreetProps.ts`, `world/PropSystem.ts`).
- Seed picks a realistic city style (Modern American, Old Brick, Mediterranean, Nordic, Desert Southwest; colours jittered per seed) and a time of day (day / golden hour / night). `?time=` overrides. Sky dome, fog, lights, lamps, windows and sea follow the time of day.
- Wreck = explosion (fireball, flash, shake, engine cut), then end screen after 2s.
- Destinations 700–1100m apart by road.
- Traffic control (`world/TrafficControl.ts`, right-hand traffic): far-side traffic lights at busy 4-way junctions (head over the driver's lane), near-side stop signs elsewhere (side roads stop at the ring road); zebra crossings and right-lane stop lines; mid-block crossings with pedestrian signs; speed 30/50, no parking, children, no smoking (park entrances). Facing/placement unit-tested. Signs and signals are breakable.

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

## Cop AI (M4, as built)

- `ai/CopController.ts`: navigate (pure pursuit along the A* road route, lookahead clamped at sharp bends, brakes for every bend within braking distance), chase (lead pursuit when two-ray line of sight within 90m and roughly ahead), ram (<18m), recover (reverse with opposite lock until pointing the right way). Rubber-band speed when far.
- `ai/CopDirector.ts`: spawns 150–300m by road away, preferring behind the player; leash back if >450m or flipped; wrecked cops burn 5s then are removed; respawn delay 8s.
- Cops share Vehicle physics, Health/impact damage, prop smashing. Light bar + 2 shared flashing PointLights on the nearest cops; siren wail/yelp by distance; minimap dots.
- Headless sim (scratchpad): 15/15 stationary catches in ~10–15s with no recoveries; sustained close pursuit of a moving target.

## Damage

Collision contact force above a threshold × opponent mass factor → health loss. Smoke at 50%, fire at 20%, explosion at 0. Cops have health too.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 ✅ | Scaffold + deploy pipeline | Scene with Rapier physics live on GitHub Pages |
| M1 ✅ | Drivable car, chase camera | Driving feels fun |
| M2 ✅ | City generator + colliders | Seeded city, can't drive through walls |
| M3 ✅ | Mission system + HUD | Full loop playable without cops |
| M4 ✅ | One patrol cop AI | Convincing single chase |
| M5 | Director, stars, all cop types, damage | Complete game |
| M6 | Polish: audio, particles, minimap, menus, car models, sparse civilian traffic | Showable |
| M7 | Mobile touch controls, difficulty, leaderboard | — |
