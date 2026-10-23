# Rapier: version notes

The game uses `@dimforge/rapier3d-compat` **0.18.2** (Rapier core 0.28, parry 0.23): ray-cast
vehicles (`DynamicRayCastVehicleController`), static box colliders for the city, dynamic bodies for
debris. This page records what newer versions change, what they measured on our city, and what an
upgrade would cost. Last checked **2026-10-15**, up to npm 0.21.0.

**Verdict: stay on 0.18.2.** Physics is not where the frame time goes, newer versions are at best
equal while cars drive (0.21.0 is slower), and 0.20 changes braking, sleeping and CCD, which the
game's handling depends on. Revisit only if a phone profile shows the physics step as a cost.

## Versions

The JS bindings repo (`dimforge/rapier.js`) was archived in July 2026; the bindings now live in
`dimforge/rapier` under `bindings/`, and the core `CHANGELOG.md` there is the only changelog for
npm 0.20+. The npm version and the core version differ:

| npm | Released | Core (from the wasm) | What it brings |
|---|---|---|---|
| **0.18.2** (ours) | Aug 2025 | rapier 0.28, parry 0.23 | |
| 0.19.0 | Sep 2025 | rapier 0.29 | faster with many contact constraints; removed the legacy PGS solver switches; `invPrincipalInertiaSqrt` → `invPrincipalInertia` |
| 0.19.1–0.19.3 | Oct–Nov 2025 | rapier 0.30 | voxel shapes only; kinematic bodies no longer fall asleep while moving |
| 0.20.0 | Aug 2026 | ≈ rapier 0.35 (parry 0.30) | the big rework, below |
| 0.21.0 | Sep 2026 | ≈ rapier 0.36 (parry 0.31) | experimental FEM soft bodies; `step`/`remove` take a soft-body set; old snapshots don't load |

Core 0.35 (in npm 0.20.0), from the changelog:
- Broad phase reworked for large, mostly static worlds: "~90x faster while stationary and ~18x
  faster while moving" (their test scene); no pairs between colliders on the same body.
- Narrow phase and solver rebuilt around a persistent contact graph; contact clustering and
  recycling on by default; cached angular jacobians in the 3D solver.
- SIMD always on (the `simd` features are gone); an 8-lane `simd8` option.
- **Behaviour changes:** `DynamicRayCastVehicleController` "no longer has unlimited braking friction"
  (braking is bounded by `frictionSlip`); sleeping rewritten around persistent islands and judged
  on actual pose displacement; CCD rewritten around sweep-based time of impact; contact defaults
  changed (`normalized_prediction_distance` 0.002 → 0.02).

## Measured on our city

`node scripts/rapier-bench.mjs 0.18.2 0.20.0 0.21.0` (seed 11 with the Old City: 711 static boxes
and a ground slab; ray-cast vehicles with the game's wheel and suspension numbers, throttle and a
weave). µs per `world.step()` plus the vehicle updates, best of 3 × 900 steps, Node 24 on the
development Mac:

| version | empty city | 40 cars parked | 20 driving | 40 driving |
|---|---|---|---|---|
| **0.18.2** (ours) | 36 | 97 | 87 | 146 |
| 0.20.0 | 2 | 81 | 69 | 148 |
| 0.21.0 | 56 | 136 | 124 | 200 |
| 0.18.2 SIMD build | 36 | 98 | 85 | 143 |
| 0.20.0 SIMD build | 2 | 81 | 65 | 141 |

- 0.20.0 wins on the static city (the broad-phase rework), saves ~15–20 µs with fewer cars moving,
  and is even with 40 cars driving: the cost is in the vehicles and their contacts, not the city.
- 0.21.0 is ~40% slower than 0.18.2 everywhere.
- The SIMD build (`@dimforge/rapier3d-simd-compat`, `PKG=` in the script) makes no real difference.
- In the game a step is ~0.15 ms of a 16.7 ms frame (one fixed 1/60 s step per frame at 60 FPS, up
  to 3 when a slow frame catches up). Even several
  times slower on a phone it stays around 1 ms; rendering (draw calls, shadows, triangles) is the
  budget that matters.

## What an upgrade would touch

No removed API is used (no PGS solver switches, no `invPrincipalInertiaSqrt`). The behaviour
changes reach:

| Where | What | Risk |
|---|---|---|
| `vehicles/Vehicle.ts` (`setWheelBrake`, `setWheelFrictionSlip`) | braking now bounded by friction slip | braking distances, handbrake drifts, the cop ram tuning |
| `vehicles/Vehicle.ts` (`setCcdEnabled(true)` on every vehicle) | CCD rewrite | jumps, high-speed hits, ramps |
| `world/PropSystem.ts`, `world/RoadworksSite.ts` (`isSleeping`, `setSleeping`) | sleeping rewrite (pose-based) | when debris stops being synced and gives up its body |
| every contact | prediction distance ×10 | resting contact, wall scrapes, kerb feel |

So an upgrade means: a branch, `npm run t` (the vehicle tests `Drift`, `Landing`, `Knock`,
`BodyMotion`, `RampTruck`, `IntersectionSim`, `CivilianTurns` and the cop tests all depend on the handling),
re-tuning what moved, and the user driving it for feel.

## Re-checking

When a new version comes out:

1. Read the core changelog (`dimforge/rapier`, `CHANGELOG.md`); find the core version inside the npm
   package (`strings dist/rapier_wasm3d_bg.wasm | grep -oE 'parry3d-0\.[0-9]+\.[0-9]+'`).
2. `node scripts/rapier-bench.mjs 0.18.2 <new>` (fetches each version into a temp folder; the
   project's `node_modules` is untouched). Add the row above.
3. Upgrade only for a real gain in the driving columns or a fix the game needs.
