# Polygons

Triangle counts per prop, building and vehicle, so we can see where the triangles go and push the
total down. Measured 2026-11-05 after the first round of cuts (see the log). Re-measure after any model change
and update the tables and the log.

## How to measure

- **Per model, headless (~3 s):** `npm run polygons -- [seeds=20] [props|buildings|cars]`
  (`scripts/polygons.ts`). Props: triangles per instance and the mean count per rolled city
  (`city.streetProps` only, so park trees and umbrellas from the build are missing). Buildings: wall
  and roof triangles per building by lot kind, over 20 rolled cities plus 4 made for each district.
  Vehicles: every part of each spec's mesh.
- **Whole scene, browser:** `scripts/evals/polygons.js` (every mesh, visible or not, instanced as
  tris × count, grouped by `Game.owned` owner; also props by model with their real counts):
  ```
  perl -e 'alarm 300; exec @ARGV' npm run check:browser -- --query "seed=9&debug&oldtown=1&chinatown=1&harbor=1" \
    --start 2000 --no-final --eval-file scripts/evals/polygons.js
  ```
- **What the camera draws** (after culling, per pass): `scripts/evals/tri-breakdown.js`
  ([OPTIMIZATIONS.md](OPTIMIZATIONS.md)). This doc is the cost *before* culling: what each thing adds.

Shadow casters are drawn twice (shadow pass + main pass), so a triangle there counts double.

## Scene total by owner

Seed 9 with `oldtown=1&chinatown=1&harbor=1` (the perf reference city), day, no police:
**746 k triangles** in the scene (924 k before the first round of cuts).

| Owner | Tris | Of which cast shadows | Biggest pieces |
|---|---:|---:|---|
| `props` | 294 k | 176 k | fence 62.6 k (108 × 580), lamp 39.5 k (80 × 494), dragonLamp 31.1 k (546 × 57), unlit 12-tri boxes 19.2 k (× 1 598, not identified), signal lenses 18.4 k (48 × 384) |
| `city` | 201 k | 85 k | building roofs and trims 71 k (shadow), sidewalks/parks/plazas 38 k, ground/roads top 31 k, road paint 27 k, canal water 19 k, building walls (one mesh per facade style) ~8 k each |
| `districts` | 98 k | 87 k | Chinatown lanterns 26.9 k (112 × 240), district meshes 9–21 k each |
| `sea` | 78 k | 0 | one mesh |
| cars (untagged) | 24 k | 16 k | ~28 cars at ~850 each |
| `roadworks` | 21 k | 21 k | 770 per piece |
| `landmarks` | 12 k | 11 k | 356 × 10, 578 × 4, 200 × 8 |
| `parkPieces` | 10 k | 0 | one merged mesh |
| `effects` | 6 k | 0 | |
| sky, water, marker, glows | 1.7 k | 0 | |

## Props (per instance)

The 20 biggest by what they cost a rolled city (tris × mean count over 20 rolled cities, no district
forced), all 5 164 street props **506 k**. District props show small means because few cities have
that district; a city that has it pays more (dragonLamp: 57 in the seed-9 Chinatown = 31 k).
Every model: `npm run polygons -- props`.

| Model | Tris | Mean count / city | Tris / city |
|---|---:|---:|---:|
| `fence` | 108 | 2163.6 | 233663 |
| `lamp` | 80 | 1095.9 | 87672 |
| `bench` | 108 | 234.5 | 25326 |
| `hydrant` | 102 | 178.9 | 18248 |
| `sign-round` | 56 | 273.4 | 15313 |
| `dragonLamp` | 546 | 22.3 | 12176 |
| `fence-chainlink` | 260 | 42.9 | 11154 |
| `cone` | 68 | 134.0 | 9112 |
| `fence-rail` | 72 | 118.7 | 8543 |
| `tree-fruit-pear` | 554 | 14.0 | 7756 |
| `signal` | 90 | 68.2 | 6138 |
| `barrels` | 480 | 12.7 | 6072 |
| `sign-diamond` | 28 | 200.3 | 5607 |
| `oilLamp` | 118 | 42.0 | 4950 |
| `tree-fruit` | 554 | 8.2 | 4515 |
| `pallet` | 576 | 7.6 | 4378 |
| `sign-square` | 28 | 150.7 | 4218 |
| `pumpkin` | 326 | 12.7 | 4124 |
| `sign-octagon` | 32 | 123.8 | 3960 |
| `drums` | 192 | 13.9 | 2669 |

Other models at 300+ tris each: `dragonFloat` 1338, `goal` 892, `tennisNet` 660, `hayWagon` 560, `climber` 444, `hayRake` 424, `flowerPlanter` 364, `parkedTractor` 362, `jackOLantern` 358, `lionDance` 354, `dimSumCart` 352, `lanternStand` 351, `farmStand` 334.

## Buildings (per building)

Walls + roof triangles by lot kind (zone for plain buildings, `district/lot` otherwise). A rolled
city's buildings total **38.5 k mean, 109 k max** (20 seeds). Plain buildings are cheap per building
but there are hundreds (residential ~500 per city); district lots are few but heavy.

| Lot kind | Mean tris | Max tris | Buildings seen |
|---|---:|---:|---:|
| `slums/tenement` | 967 | 1342 | 99 |
| `chinatown/banquetHall` | 653 | 924 | 6 |
| `chinatown/restaurant` | 608 | 894 | 36 |
| `harbor/silo` | 586 | 682 | 7 |
| `chinatown/shophouse` | 532 | 1160 | 872 |
| `slums/cornerStore` | 497 | 728 | 6 |
| `slums/boarded` | 486 | 824 | 34 |
| `slums/squat` | 393 | 636 | 20 |
| `harbor/warehouse` | 274 | 586 | 147 |
| `chinatown/temple` | 266 | 306 | 5 |
| `farm/granary` | 228 | 228 | 10 |
| `oldtown/arcade` | 221 | 308 | 66 |
| `harbor/harborOffice` | 191 | 200 | 17 |
| `megapark/cafe` | 178 | 178 | 9 |
| `harbor/transitShed` | 169 | 204 | 13 |
| `slums/gutted` | 147 | 208 | 8 |
| `farm/farmhouse` | 133 | 156 | 10 |
| `farm/barn` | 102 | 102 | 10 |
| `chinatown/teaHouse` | 85 | 86 | 12 |
| `farm/machineShed` | 61 | 64 | 3 |
| `downtown` | 55 | 78 | 782 |
| `oldtown/townHall` | 52 | 57 | 17 |
| `oldtown/halfTimbered` | 44 | 66 | 899 |
| `midtown` | 40 | 58 | 5326 |
| `chinatown/bakery` | 39 | 58 | 13 |
| `chinatown/bubbleTea` | 33 | 48 | 11 |
| `oldtown/stoneHouse` | 33 | 50 | 569 |
| `chinatown/herbalShop` | 31 | 48 | 12 |
| `harbor/coldStore` | 21 | 26 | 12 |
| `megapark/lodge` | 21 | 38 | 9 |
| `residential` | 19 | 28 | 22255 |
| `industrial` | 19 | 28 | 3672 |
| `megapark/boathouse` | 18 | 18 | 9 |
| `farm/henhouse` | 18 | 18 | 7 |

## Vehicles (per car)

All parts (body, cabin, wheels, lights). Built once per spec and cloned, so the cost is per car on
screen: ~28 in a normal run, more in a 5★ chase.

| Vehicle | Tris | Meshes |
|---|---:|---:|
| Player | 872 | 17 |
| Patrol | 846 | 20 |
| Interceptor | 908 | 20 |
| SUV | 854 | 20 |
| Armored | 854 | 20 |
| Van | 806 | 17 |
| Pickup | 830 | 17 |
| Bus | 842 | 18 |
| Box truck | 674 | 22 |
| Ramp truck | 682 | 22 |
| Tractor | 878 | 17 |

## How triangles are kept down

- **Prop models drop their buried faces** (`dropHiddenFaces` in `render/geometry.ts`, run on every
  model in `buildModels`): a triangle wholly inside another closed convex part of the same model (a
  pole's cap inside its base, a box sitting on another) is never seen from any angle, even on a prop
  knocked over and tumbling. Faces flush with another part and facing the same way are kept (two parts
  sharing an outer face would otherwise both lose it). Close-ups are pixel-identical. Open parts
  (plates, open cylinders) and non-convex ones (tori) hide nothing. Undersides on the ground are
  **not** dropped: a hit prop tumbles and shows them. Finding them costs ~27 ms per look, once: the
  kept triangles are cached per look and model, so Retry and New city skip it.
- **Thin round parts use 6 sides** (lamp, sign and signal poles, hydrant): at their size 8 read the same.
- **Ground drapes merge flat cells** (`GeometryBuilder.drape`): only cells under the hill keep 4 m
  cells; the rest of a land piece is merged into big rectangles. Where a rectangle meets a hill cell
  the extra vertex lies on flat ground on the rectangle's straight edge, so nothing cracks.
- **The sea is coarse where it's far** (`seaGeometry`): a 4 m grid only within 80 m of the shore (the
  breakers end ~75 m out); beyond, the lines widen, and the strips alongside the island widen along
  the shore too, stitched row to row with fans so the moving waves never crack (`Sea.test.ts`).

## Where to cut next (biggest first)

1. **Fences, 108 tris × ~2 200 per city (234 k mean).** Still the biggest prop line. Fewer pickets per
   segment, or pickets as one panel, changes the look: the user's call. Each segment breaks on its own
   (3 m apart, 2.8 m long), so it keeps both posts.
2. **Roofs and trims, 71 k in seed 9, all shadow casters.** The heaviest lots are chinatown
   (shophouse ~530, restaurant ~610, banquetHall ~650) and slums/tenement (~970). Hand-built in
   `CityBuilder`; trimming them moves the `BuildingGeometry` snapshots.
3. **Sidewalks/parks 38 k, road paint 27 k:** many small rects, each its own quads; worth a look at
   whether paint dashes could be fewer or longer.
4. **Lamps, 80 × ~1 100 (88 k).** The base (8-sided) and two boxes remain.
5. **dragonLamp, 546** (31 k in a Chinatown city): the two torus dragons and the pagoda.
6. **Heavy rare props** (1 000+ tris: `dragonFloat` 1 338; 600+: `tennisNet`, `tree-fruit*`, `pallet`):
   cheap in total today, but check a new district doesn't place many.
7. **The 12-tri unlit instanced boxes (× ~1 600, 19 k):** not identified yet; find their owner first.

## Budgets for new things

Use these when adding a model (so the total only goes down):

- Street prop placed in hundreds (lamps, signs, bins, fences): **≤ 64 tris**.
- Prop placed in tens (stalls, carts, district dressing): **≤ 300 tris**.
- One-off set piece or landmark: **≤ 1 500 tris**.
- Cylinders and spheres: 6 segments unless the object is big or seen close up.
- Building lots: aim under 300 tris a building; anything over 600 needs a reason.

## Log

| Date | Commit | Change | Scene total (seed 9 ref) | Props / city | Buildings / city |
|---|---|---|---:|---:|---:|
| 2026-11-05 | `ca16fef` | first measurement | 924 k | 546 k | 38.5 k |
| 2026-11-05 | `perf/polygons` | buried faces dropped from props, 6-sided thin poles, flat ground cells merged, sea coarse past 80 m and along its far strips, Chinatown lantern/joint cuts | 746 k | 506 k | 38.5 k |
| 2026-11-05 | `districts/swamp` | the Swamp: cypress 196, willow 266, snag 100, mangrove 263 (roots 3×5 tori; 501 before); reed clumps thinned (2 a clump); a swamp city on seed 11 +70–90 k in view vs no district | — | — | — |
| 2026-11-05 | `districts/swamp` | snag 87 (limbs rooted in its leaning trunk: their bases now buried, dropped); snowy cypress/willow keep their crowns (148→196, 192→266) so the moss and fronds hang from something; boardwalk planks without their hidden ±Z edges and posts without their buried foot (≈ 42 → 30 tris a metre: the 54 m deck 2 376 → 1 672, `SwampWitch.test`); witch house + island 1 420 | — | — | — |
| 2026-11-05 | `districts/forest` | the Forest: `fern` 60 (five one-blade fronds; a first try with tips was 120); trees are the city's pine (43) and round (35), ~75 a woods block; a 4×3 forest +49 k tris in view vs no district; set pieces (stacks, truck, loader, lookout, tents, floor logs and stones) merged in one district mesh | — | — | — |
| 2026-11-05 | `districts/forest` | tents are a breakable prop, `tent` 21 (a closed canvas prism, door, pole; the merged one was ~90 and upside down); a log is one capped 7-sided cylinder with sawn-colour caps (84 → 28: stack 1 188 → 404, truck 1 360 → 776, fire pit 628 → 356 with 20-tri stones, fallen log 116 → 60); budgets per set piece in `ForestSet.test` | — | — | — |
| 2026-11-05 | `districts/forest` | fallen logs are a prop, `log` 57 (a 5 m capped 7-sided log, moss or snow along the top, a short branch stub; scaled per log by its length, 4–7 m), out of the district mesh | — | — | — |
| 2026-11-06 | `props/solid-clutter` | solids and landmarks turned props, instanced: `cannon` 336, `rowboat` 154, `stump` 56 (scaled by its radius), `sunkLog` 55 (the forest log's model) | not re-measured | | |
