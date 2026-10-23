# Car Pursuit

A low-poly 3D car-chase game for the browser. Reach 5 destinations across a randomly generated island city before the clock runs out, while an escalating police force (wanted stars 1–5) tries to wreck you.

## Play

```bash
npm install && npm run dev
```

Add `?seed=1234` to replay a city, `?time=day|afternoon|night` to force the time of day. Installable as an offline PWA.

| | Keyboard | Touch |
|---|---|---|
| Gas / brake & reverse | W / S (or arrows) | GAS / BRAKE |
| Steer | A / D | ◀ ▶ |
| Handbrake (drift) | Space | HB |
| Reset car | R | ⟲ |
| Pause / mute / fullscreen | P or Esc / M / F | pause menu |

## Features

- Seeded island city on a hill with canals, bridges, parks, plazas, town squares and jump ramps; climates (temperate, snow, beach, desert), rain and snow, day to night.
- Themed districts: a walled Old City with gatehouses, a market square and a striking town-hall clock (`?oldtown=1` to force it); Chinatown with paifang gates, lantern-strung streets, shophouses, a night market and Lunar New Year fireworks (`?chinatown=1`); a Harbor with gantry cranes over the seafront road, a moored ship and a container yard to drive through (`?harbor=1`); a Farm on the island's edge with a red barn, silos, a windmill and fields of corn, wheat, pumpkins, orchard and hay to tear through (`?farm=1`); and the Slums, with graffiti-covered walk-ups, a destroyed building, a rail overpass, rubble-lot shortcuts, a junkyard and potholes that jolt the car (`?slums=1`).
- Rapier vehicle physics, drifting, crash damage, scratches and explosions.
- Cops that route, cut you off, ram and set roadblocks; patrol cars, interceptors, SUVs and armored trucks.
- Civilian traffic that obeys lights and right of way, including buses and trucks; breakable street props.
- Four difficulties (incl. No Police), local leaderboard, end-screen run map, procedural audio, touch controls.

## Development

```bash
npm run dev     # dev server
npm test        # unit tests (Vitest)
npm run build   # type-check + build into dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. Design notes and URL flags: [PLAN_GAME.md](knowledge/plans/PLAN_GAME.md); districts: [DISTRICTS.md](knowledge/DISTRICTS.md).
