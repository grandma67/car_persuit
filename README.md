# Car Pursuit

A low-poly 3D car-chase game for the browser. Reach 5 destinations across a randomly generated island city before the clock runs out, while an escalating police force (wanted stars 1–5) tries to wreck you.

## Play

```bash
npm install && npm run dev
```

Add `?seed=1234` to replay a city, `?time=day|afternoon|night` to force the time of day, `?blocks=N` for the grid size. Installable as an offline PWA.

| | Keyboard | Touch |
|---|---|---|
| Gas / brake & reverse | W / S (or arrows) | GAS / BRAKE |
| Steer | A / D | ◀ ▶ |
| Handbrake (drift) | Space | HB |
| Reset car | R | ⟲ |
| Horn / look back | H / B | |
| Pause / mute / fullscreen | P or Esc / M / F | pause menu |

## Features

- Seeded island city on a hill with canals, bridges, parks, plazas, town squares and jump ramps; climates (temperate, snow, beach, desert), rain and snow, day to night.
- Themed districts, each forced with `?<kind>=1`:
  - **Old City** (`oldtown`): walls, gatehouses, a market square, a striking town-hall clock.
  - **Chinatown** (`chinatown`): paifang gates, lantern-strung streets, a night market, Lunar New Year fireworks.
  - **Harbor** (`harbor`): gantry cranes over the seafront road, a moored ship, a container yard to drive through.
  - **Farm** (`farm`): red barn, silos, a windmill, fields of crops to tear through.
  - **Slums** (`slums`): graffiti, a destroyed building, a rail overpass, rubble shortcuts, a junkyard, potholes.
  - **Mega-park** (`megapark`): a lake and island, sports grounds, a bandstand, slow tree-lined drives.
  - **Swamp** (`swamp`): causeways between pools, stilt shacks, a crooked witch house up a drivable boardwalk.
  - **Forest** (`forest`): dense woods, winding tracks cops must follow, a lumber yard, a fire lookout, a campsite.
- Rapier vehicle physics, drifting, crash damage, scratches and explosions.
- Cops that route, cut you off, ram and set roadblocks; patrol cars, interceptors, SUVs and armored trucks.
- Civilian traffic that obeys lights and right of way, including buses and trucks; breakable street props.
- Four difficulties (incl. No Police), local leaderboard, end-screen run map, procedural audio, touch controls.

## Development

```bash
npm run dev     # dev server
npm run t       # unit tests (Vitest; failures + summary only)
npm run build   # type-check + build into dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. Design notes and URL flags: [PLAN_GAME.md](knowledge/plans/PLAN_GAME.md); districts: [DISTRICTS.md](knowledge/DISTRICTS.md); developer docs index: [CLAUDE.md](CLAUDE.md).
