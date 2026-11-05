# Districts: looks, budgets and night glow

Read before adding a district's buildings, props, set pieces or lights. Framework and rules:
[DISTRICTS_DEV.md](DISTRICTS_DEV.md); triangle counts and model budgets: [POLYGONS.md](POLYGONS.md).

## Budgets (read before designing a milestone: found late, they cost rework)

- ≤ 3 new facade styles; **no new shader programs** (`renderer.info.programs`, on vs off).
- Merged walls + roofs < ~60k triangles; build time within ~50 ms of district off (`npm run budget -- <kind>`).
- Props: placed in hundreds ≤ 64 tris, in tens ≤ 300, a district's tree ≤ ~250, a set piece ≤ 1 500
  (`POLYGONS.md`).
- `maxGlow` sized from `npm run stats -- <kind>` (below).
- Minimap colour must stand out from the park green (`Minimap.test`, contrast > 2.2: dark green or olive fails).
- Phone FPS on vs off within noise.

Run `npm run stats`, `npm run zfight` and `npm run polygons` before the first browser tour, not after.

## Buildings

- `buildingGeometry` → `addBuilding(b, look: LotLook)`. `LotLook` (`facade`, optional `ground` for
  floor 0, `roof`, `roofAlt`, `palette`, `roofTiles`, `trims`) per lot kind in `def.looks`, overridable
  per climate in `CityTheme.districts.<kind>`; no lot → `zoneLook`. One merged wall mesh per facade
  style (`render/Facades.ts`, 8×8 window cells, 512² canvases, `CAPS`, per-window `cell` hook), one
  shared roof mesh (`addRoof` by `RoofShape`, `addTrims` by `TrimKind`); the collider stays the lot box.
- **Facade styles** (reuse before adding one). Upper floors: `curtain` (full glazing), `office` (stone
  grid), `brick` (arched windows), `stucco` (smooth render, light surrounds), `shutters` (louvred,
  balcony rail), `siding` (horizontal boards, white frames: takes any palette tint), `adobe` (earthen,
  deep windows), `industrial` (corrugated, strip glazing), `halfTimber`, `ashlar` (coursed stone,
  leaded windows), `shophouse` (Chinatown pastel, fanlights), `tenement` (grimy brick walk-ups),
  `charred` (burnt-out shells), `panel` (windowless cold store). **`boards` has barn red painted into
  its texture** (palettes are near-white shades over it): it is always a red barn. Ground floors:
  `storefront` (signboard, wide glazing), `rollerDoors`, `barnDoors` (X-braced, white trim), `boarded`.
  Look at one alone: `studio.js` with `?studio=lot:…`.

## Materials and programs

- **Programs to expect** (`dbg.stats().programs`; `check:browser --vs-make "nodistricts …" --make
  "<kind> …"`): a city with no canals compiles the canal water's program for its first shallow water
  (pond, lake, Swamp pools: +1, accepted); fireflies and wisps add one on the nights they show (+1,
  shared by every district); snow ice is a plain material. Compare the same climate on both sides:
  no-district baselines differ by climate (seed 11: desert 31, beach 32).
- A new prop or look reuses an existing material's settings; `InstancedMesh` only with an existing
  instanced material. Tint instanced repeats with `setColorAt` on the props' material settings, or
  textures on the sign faces' settings (map + emissive map); never both on one material. Transparency
  would be a new program (Slums graffiti is opaque cells in one merged mesh; Swamp mist was dropped).
- Instance repeats (never merge them into walls), merge static geometry per structure, extend
  `prewarmShaders` if anything new compiles.
- Parked vehicles: never `buildCarMesh` in a district (its two SpotLights change the light count and
  recompile everything; `paint: 'work'` is a new program). Merge a vertex-coloured body instead.
- Text on signs: canvas text from system fonts into an atlas at load (generic serif/sans fallback);
  name boards: `farmSigns.ts` / `megaparkSigns.ts` (facade walls' material settings: no program).

## No z-fighting

- Never overlap coplanar faces. Butt-join exactly or stand one part 2–3 cm proud; ground layers ≥ 2 cm
  apart or `polygonOffset` on the lower (asphalt 1/1, street cobbles 0.5/0.5, markings none). Ground
  lifts: sidewalk 0.03, grass 0.05, paths 0.065, patches 0.07, water rim / lines 0.09–0.1.
- Tests: `PropModels.test` (every prop model) and `BuildingZFight.test` (40 rolled cities, every
  building and its neighbours; `render/coplanar.ts`, `world/zfight.ts`). Neither sees a district's own
  merged set pieces: test those per piece built at the origin (at world coordinates float32 normals
  fake overlaps), as `render/districts/ForestSet.test.ts` does.
- To fix: `npm run zfight -- [seeds=40] [limit=3] [only=<text>] [props] [words…]` lists every overlap
  with the buildings' lot boxes (the tests stop at the first per kind).
- Terrace neighbours stand 0.3–0.5 m apart and often share a height, so anything built past the walls
  lands in the other's planes. Roof-mesh geometry stays inside `buildingReach` (half the gap to each
  neighbour): overhangs are cut there, boxes stop 2 cm short. A new trim past the walls needs nothing more.
- Fix it in the geometry, not the camera: a chase camera `near` of 0.5 was tried and dropped (no visible
  gain at range; it cut the rain and snow nearest the lens).

## Night lighting and the glow budget

- **What glows:** lit props (`LIT_PROPS` in `StreetProps.ts`: `lamp`, `woodLamp`, `oilLamp`,
  `dragonLamp`, `jackOLantern`) get a bulb and a light pool from `PropSystem`. A district's own lights
  (lanterns, torches, bulb strings, windows) are an `InstancedMesh` of `MeshBasicMaterial({ toneMapped:
  false })` with a colour per instance, dim by day and `× 1.6` warm at night by `ctx.lampGlow` (Old City
  `torches`, Mega-park `glows`): the lamp bulbs' program, no light. Lit glass on a name board: the sign
  atlas's warm swatch (`onWarm`, `farmSignMaterial(2.5)`). Fireflies/wisps: `fireflies.ts`.
- `GlowBatch` is the **cars'** lamp sprites only; never add district lights there. No point lights.
- Flicker/blink via shader uniforms, never per-light JS.
- **`maxGlow`** (each district's balance block, declared on its def): glowing things at night, lit
  props plus the renderer's own. Lay the lamps last and fill what's left: count everything lit already
  inside (`LIT_PROPS` on `city.streetProps` in the bounds **and** set blocks' props not pushed yet, such
  as a pitch's floodlights), minus what the renderer adds (2 lanterns a gate, the bulbs). Fireflies
  take what remains.
- **Sizing:** a district's streets carry ~8 lamps a block (swapped to its lamp kind), so a 3×3's
  streets alone hold ~72. `npm run stats -- <kind>` prints `glow` (average, worst, worst seed and shape)
  against `maxGlow`: size on the worst, the renderer's lights on top.
- Keep one lamp per junction lit where a district goes dark (Slums, Swamp): too dark to drive on phones otherwise.
