# Car Pursuit

A low-poly 3D car-chase game for the browser. Reach 5 destinations across a randomly generated
island city before the clock runs out, while an escalating police force (GTA-style wanted stars)
tries to wreck you.

**Play:** `npm install && npm run dev`, then open the printed URL. Every city comes from a seed —
add `?seed=1234` to replay one, `?time=day|afternoon|night` to force the time of day.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Drive / brake & reverse | W / S (or arrows) | GAS / BRAKE |
| Steer | A / D | ◀ ▶ |
| Handbrake (drift) | Space | HB |
| Reset car | R | ⟲ |
| Pause / mute | P or Esc / M | II |
| Fullscreen | F | — |
| Difficulty (menu) | ← → | tap |

## Features

- Seeded island city: districts, parks, plazas, five real-world styles, day / golden hour / night.
- Raycast-vehicle physics (Rapier), drifting with smoke and skid marks, crash damage and explosions.
- Wanted level 1–5 stars: patrol cars, interceptors, SUV rammers, armored trucks and roadblocks.
- Cop AI that navigates the road network, cuts you off ahead on your route and rams.
- Civilian traffic that obeys traffic lights and stop signs; breakable lamps, hydrants, signs, fences.
- Procedural audio (engine, siren, crashes, menu music), minimap, local leaderboard, touch controls.

## Development

```bash
npm run dev     # dev server
npm test        # unit tests (Vitest): generator, mission, wanted, traffic rules, records…
npm run build   # type-check + production build into dist/
```

`?debug` enables: C overview camera, T teleport to destination, Y 3 s left, K +1 star.

Deployment: pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes to
GitHub Pages (set *Settings → Pages → Source* to “GitHub Actions”). See `PLAN.md` for the design.
