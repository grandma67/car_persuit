# Districts: decisions and design log

What each district is: `DISTRICTS.md`. How they are built: `DISTRICTS_DEV.md`. Open work: `TASKS.md`.

**Status:** Q0, Old City, Chinatown, Harbor and Farm built and merged (their ambience audio skipped).
Slums built on `districts/slums`, waiting for approval to merge. Effort: Q0 ~5–6 h, Old City ~9–11 h,
Chinatown ~12–14 h, Harbor, Farm, Slums ~12–15 h each.

## Design intent worth keeping (beyond what the code shows)

- **Harbor:** crane span = sidewalk + road + promenade from `DEFAULT_CITY` (~25 m), never hard-coded;
  cranes clear of gate mouths. Ship 120–180 m fitted to the frontage, draught deep enough for storm
  swell, hull one solid (a car off the quay hits it and drops in). Boom gates off the street, never
  across a lane. Apron trucks stay parked.
- **Farm:** farmyard = the one ordinary block nearest the main-street gate; every other block a field,
  ≥ 1 corn, no crop more than twice; each field ≥ 2 fence gaps facing different streets; maze paths
  connect ≥ 2 gaps; crops as row strips/shells, never per-plant meshes, thinned by distance; trample
  texture per run, not saved; tractors spawn only in the Farm and on its perimeter roads.
- **Slums:** ruins are lots (`ruinsOf(q)`), not block roles; the camp is a `camp` role on a vacant block
  (whole, or half with rubble on the other half); squat = a tarp over a fallen-in roof bay. Civilians
  ignore potholes (only the jolt). Keep one lamp per junction lit (too dark to drive on phones otherwise).

## Decisions

- **Best times on changed cities (2026-10-16): accept.** Districts decorate and add no challenge; roads,
  spawn and destinations unchanged. No `cityVersion`.
- **Chinatown glyphs (2026-10-15):** canvas text from system fonts into an atlas at load, generic
  serif/sans fallback.
- **Ambience audio (all districts): skipped** so far (see `TASKS.md`).

## Dropped ideas

- 1×3 Chinatown strip (no interior street → no main street); Chinatown 2×3 too.
- Removing modern signs wholesale (breaks priority, fast stretches, bus stops).
- Walled Old City on the quay (outer ring is never midtown); the seafront became the Harbor.
- Harbor on a canal (narrow, bridged quays); maybe a later canal-wharf variant.
- Driving onto the ship via a ro-ro ramp (needs a ramp over water + deck as ground); later.
- Farm animals and people in the Slums (no walking NPCs; frozen ones look dead): henhouse stays empty.
- Moving combine or ploughing tractor in a field (NavGrid can't plan round it); tractors move only as
  road traffic. Rotating centre-pivot irrigator (moving solids): parked, desert only.
- A drivable or breakable Slums camp (see Respect in `DISTRICTS.md`).
- Buildings that collapse when hit (colliders are the lot box); the ruin is already down.
- A ramp off the ruin's leaning slab (ramps are placed before the overlay); maybe later.
- Slums freight train over the overpass (optional, skipped).
