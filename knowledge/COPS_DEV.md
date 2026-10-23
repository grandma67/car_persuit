# Cops: developer notes

Read before changing how cops drive, route, spawn or avoid things. Measure every change with
`npm run cops -- --vs main` (below): cop driving is chaotic, and a change that reads well can make
things worse.

## Where things are

| File | What |
|---|---|
| `ai/CopController.ts` | One cop's brain: state machine, steering, speed, feelers (`avoid`), routing (`replan`, `planRoute`) |
| `ai/CopDirector.ts` | Spawning, leash (> 260 m or flipped 3 s → moved back into play), roadblocks, tuning per star level |
| `ai/pursuit.ts` | Path maths shared with civilians: `purePursuit`, `cornerSpeedLimit`, `distanceToBend`, `turnAngle` |
| `ai/lineOfSight.ts` | `staticLineOfSight` (buildings and planters block it) and `obstacleProbe` (the feelers' raycasts) |
| `ai/NavGrid.ts` | 2 m grid A* for off-road chasing; route cost only, no heading |
| `world/RoadGraph.ts` | `route()`: A* over (node, came-from) states with turn costs (`turnCost`) |
| `gameplay/balance.ts` | `WANTED`: cops per star level, mix, `chaseRange`, `catchUp` |

## The brain, per physics step

1. `holdUntilClose` (roadblock): wait until the suspect is within 35 m.
2. `recover` (stuck 1.2 s): reverse with opposite lock until pointing at the aim. Boxed in behind →
   hold still instead. Then follow roads only for 1.5 s.
3. `backoff` (pinned against the suspect while ramming): reverse until there's room, unless something is behind.
4. Sight check every 0.2 s. Seen and roughly ahead: `chase` (lead pursuit), or `ram` under 18 m.
   Otherwise `navigate`: replan every 0.8 s and follow the path with pure pursuit.
5. Feelers every 0.1 s (`avoid`) adjust the heading (`dodge`) and cap the speed (`dodgeSpeed`).
6. Speed caps: catch-up allowance, the next bend (`cornerSpeedLimit` by angle), heading error, obstacles.

`replan`: NavGrid when the suspect is within `navAlways` (60 m), or within `navRange` (220 m) when
either car is off the road. A moving cop on the road ignores a grid path that starts behind it
(`startsBehind`). Otherwise `planRoute` on the road graph, aimed `interceptTime` ahead of the suspect.

## Tuning and why (`COP_TUNING`)

- `turnCost` 60 / `uTurnCost` 220 (metres of road): the time a turn really costs. Braking 30 → 12 m/s
  and pulling away again loses ~2 s (60 m at cruise); turning round loses ~7 s. At 20/80, cops took
  every short cut that had them braking and turning round.
- `uTurnSpeed` 5 m/s: above this the route never starts by doubling back.
- `cornerSpeed` 9 m/s, for a right angle. At 12 m/s a car can't make the turn inside a 12 m road: it
  swings wide onto the outer kerb props. `cornerSpeedLimit(..., byAngle)` takes gentle bends up to 1.14×
  faster and hairpins down to 0.74×; civilians don't pass `byAngle`.
- Heading error over 0.3 rad caps the speed at `cornerSpeed × 0.6 / error` (no slides into the kerb).
- `interceptTime` 2 s: road routes aim at `suspect + velocity × lead`, the lead ramping up from 40 m away.
- Feelers (`avoid`): length = stopping distance + reaction (up to `FEELER_MAX` 55 m), but never past the
  next bend + 4 m (beyond it they only find the corner's buildings). Something ahead is *followed*:
  speed = its speed along our way + √(2·decel·gap). The cop swerves only when closing on it soon
  (`urgent`); with no side clear, it brakes. When an obstacle sets the speed, it brakes at +0.5 m/s, not +3.

## Facts that cost time

- **Brake input reverses** below 1 m/s (`Vehicle.drive`). To hold still, use the handbrake, not `brake: 1`.
- Feelers ignore dynamic bodies under 600 kg (`CAR_MASS` in `lineOfSight.ts`): loose props and debris.
  Props near a car get a fixed body (`PropSystem`) and break when hit fast (`breakSpeed`). Signs, fences,
  benches etc. are `SOFT` in the NavGrid: a route may go through them at a cost.
- Feeler geometry is per vehicle: three rays across `halfExtents.x` (a pole fits between two) and the
  nose at `halfExtents.z + 0.2`. The armored truck is 3.1 m from centre to nose, the patrol car 2.2 m.
- The NavGrid has no idea which way the cop faces; a grid path straight back is a U-turn on the spot.
- Most U-turns come from crashes: hit something, stop, reverse out, carry on the other way. Fix the
  crash, not the U-turn logic.
- Cops ram the suspect by design: the probe's `ignore` skips the suspect's collider.

## Benchmark: `npm run cops`

`scripts/cop-bench.mjs` runs `scripts/cop-bench.ts` (one config per process, all in parallel, ~2 min):

```
npm run cops                      # 3★, 5★, ghost 3★ on the working tree
npm run cops -- --vs main         # also on a temp worktree of main (today's bench, main's game code), with Δ%
npm run cops -- --diag hits       # one run: what the fast hits were (also: uturns, recovers); --stars 5, --ghost
   --seeds 24 --secs 120 --maxBlocks 12 --verbose
```

Cities: the game's per-seed grid, the first 24 flat, canal-free seeds (i × 7919 + 11) no wider than
12 blocks. Each has 30 civilians and street props as **fixed, unbreakable** boxes. The suspect is a
feeler-less cop brain driving to far junctions, and the real `CopDirector` runs at the star level.

**Ghost** (`--ghost`, the third column): the suspect and the cops pass through each other. Otherwise
the suspect gets pinned within seconds (~9 m/s average) and distance numbers mean nothing. Ghost
measures pursuit; the other two columns measure crashes.

Metrics are per-city averages over 120 s. "far" = more than 30 m from the suspect (en route, not the scrum):

| Metric | Meaning |
|---|---|
| `near`, `meanDist`, `firstNear` | s with a cop within 25 m; mean nearest-cop distance (m); s to the first |
| `suspectSpeed` | m/s; lower in the normal runs = pinned more |
| `playerHits` | cop → suspect contacts (wanted, but not in ghost) |
| `civHits`, `propHits`, `wallHits`, `copHits` (+ `far*`) | contact onsets, debounced 1 s per pair |
| `fastHits` | civilian/prop/wall hits at > 8 m/s: the ones that hurt |
| `fastCop` | cop↔cop at > 6 m/s closing speed (slow shoving in the scrum is harmless) |
| `recovers`, `farRecovers` | times stuck and reversing out |
| `uTurns` | heading swung > 150° within 25 m driven, more than 30 m from the suspect |
| `respawns`, `suspectResets` | cops moved back into play; suspect put back after driving off the island (no sea here) |

Reading it:

- **Noise is ±10–20 %** on a single metric even over 24 cities; a change moves many cars' traffic.
  Trust a direction that shows across several metrics and columns, not one number.
- Per-city numbers depend on which cities ran before in the same process (shared state somewhere in the
  physics). Totals for the same city list repeat exactly, so compare like with like.
- Ghost artefact: a cop going for a ram drives *through* the suspect, then turns round. Ghost `uTurns`
  and recoveries near the suspect aren't real.
- Prop hits read higher than in the game (props here never break).
- `--diag hits` tallies each field separately: what was hit, state, speed, sliding or gripping, kerb /
  road / off-road, bend or straight, grid or road plan, and whether the feelers had seen it. Examples print
  the last 2 s as a trace.

Workflow: `--vs main` once for the baseline, change one thing, run again, and use `--diag` when a
number moves the wrong way. Results from the last round (2026-10-23, main → feelers, turn costs,
intercept): fast hits −30 / −16 / −24 %, far prop hits about −30 %, 3★ mean distance −25 %, ghost
time-near +8 %.

## Tests

- `CopAvoid.test.ts`: swerves round a statue to the suspect; brakes behind a stalled car in a lane too
  narrow to pass (every cop type).
- `CopRoute.test.ts`: `planRoute` at speed never doubles back, turns when there's room, prefers fewer turns.
- `pursuit.test.ts`: corner speeds (by angle too), `distanceToBend`, pure pursuit.
- `CopDirector.test.ts`, `CopRam.test.ts`, `CopSpawn.test.ts`, `LineOfSight.test.ts`, `NavGrid.test.ts`.

## Open

- The NavGrid A* has no turn cost: grid paths zigzag, and 2/3 of fast hits happen on grid paths, mostly at
  the kerb (signs, lamps). A heading-aware grid (8 states per cell) or path smoothing is the next step.
- Several cops ramming a pinned suspect shove each other (5★ `copHits` near the suspect).
- Cops don't coordinate: no flanking or blocking the suspect's exits.
