# Districts: what each one is

Themed areas laid over a rectangle of blocks, each rolled per seed on its own stream
(`world/districts/`). Roads, the road graph and lanes never change: character comes from buildings,
props, ground patches, overhead pieces and gates. How they are built: [DISTRICTS_DEV.md](DISTRICTS_DEV.md).

Odds per seed (300 seeds): none 5%, one 25% (Old City 8%, Chinatown 6%, Harbor 4%, Slums 4%, Farm 3%),
two 36%, three 25%, four 9%, all five under 1%. `?<kind>=0|1` forces one off or on.

| | Old City | Chinatown | Harbor | Farm | Slums |
|---|---|---|---|---|---|
| `kind` / URL | `oldtown` | `chinatown` | `harbor` | `farm` | `slums` |
| Roll chance | 0.55 | 0.5 | 0.45 | 0.4 | 0.35 |
| Site | inland (off the 2 outer rows) | inland | coast: outer rows, long side on the sea | edge: outer rows, touching the island edge | inland |
| Shapes (rolled) | 2×2 / 3×3 / 4×4 | same | same | same | 2×2 / 3×3 (4×4 can't meet the share) |
| Zones | ≥ ½ downtown + midtown | same | industrial + residential, ≥ ½ industrial | residential + industrial, ≥ ½ residential | midtown + residential + industrial, ≥ ½ residential + industrial |
| Gates | all (gatehouses) | main street + ≤ 1 (paifang) | all; one terminal gate | main street (ranch gate) + ≤ 1 (cattle grid) | all; rail overpass on the main-street gate |
| Speed cap | 30 km/h everywhere | 40 km/h main street | none | none | none (potholes jolt) |
| Traffic | 0.5× | 1.3× | 0.9× | 0.4× | 0.6× |
| Buses / trucks | out | in; vans ↑ | in; box trucks ↑ | in; pickups, tractors ↑ | out; pickups, vans ↑ |
| Cop spawns skipped inside | 0.6 | 0 | 0 | 0.4 | 0.5 |
| Zebras | removed | kept | removed | removed | removed (worn) |
| Map colour | stone | red | steel blue | wheat gold | rust brown |

Every district: 4★+ roadblocks prefer its gates, ≤ 1 mission destination inside, a minimap outline,
no start toast. Respect: neutral real glyphs in Chinatown (福 春 茶 飯店), no caricature; made-up names
on containers, ships, farm signs, tractors, sacks and graffiti (no real brands, gang symbols, slurs or
politics); the Slums show poverty as a place, never a joke or a target (no people, the camp is solid,
unbreakable, adds no heat and is never a shortcut).

## Old City

Crenellated walls with corner towers; a gatehouse at every street in (arch, raised portcullis,
drawbridge deck, torches, banners). Cobbled streets with a gutter, half-timbered and stone houses with
jetties and steep roofs. A market square (well, market cross, pillory, stalls, cannons) faced by a town
hall whose clock keeps the game time and strikes the hour; ruins; breakable pots, barrels, carts and
haybales on the kerbs. Climate: sandstone in the desert, limewashed by the sea, snow on the walls.

## Chinatown

A paifang (red columns, green-tiled roofs, 中華街 name board) and a pair of stone lions at each end of
the main street; dragon lamp posts with 福 / 春 banners; red lanterns strung across the streets (they
swing as you pass under). Pastel shophouses over covered five-foot ways; red-and-gold restaurants with
roast ducks and fish tanks under pagoda caps; tea house, bakery, herbal and bubble-tea shops, a temple;
bilingual signboards and vertical neon; sometimes a pagoda on a small square. Breakable produce stalls,
dim-sum carts, lantern stands, fish crates, mahjong tables, menu boards, firecracker crates (a hop, no
damage); 1–3 vans parked up on the kerb. Night: the brightest place in town (glowing lanterns and
windows, flickering neon, a night market with more stalls and bare-bulb strings). A quarter of seeds
are Lunar New Year: twice the lanterns with gold ones, a lion dance and a dragon float that burst into
confetti, fireworks over the pagoda. Climate: faded reds in the desert, brighter pastels by the beach,
snow on roofs and awnings.

## Harbor

Mostly industrial. The seafront road runs under 1–3 red-and-white gantry cranes (landside legs on the
sidewalk, waterside on the quay edge); the promenade becomes a concrete apron with crane rails,
bollards and lifebuoys. A ship moored alongside (container ship, bulk carrier or general cargo,
sometimes a tug) with mooring lines; with a container ship the cranes swing boxes between ship and
parked terminal trucks, otherwise they stand idle, booms raised. One or two quay blocks are a
chain-link container yard: stacks 1–4 high with corridors from street to street (breakable boom
barriers at each mouth), straddle carriers you drive between the legs of, a reach stacker, floodlight
masts, a rail siding with flatcars and level crossings. Behind: warehouses (roller doors, loading
docks, sawtooth or barrel roofs, shed numbers), open transit sheds on the quay, cold stores, the harbor
office (radar mast, lit control room), sometimes a silo battery with a conveyor gallery over the road
and a tank farm. A terminal gate (canopy, lane lights, guard booth, weighbridge) where the main street
leaves inland. Breakable pallets, crates, drums and cable reels (these roll), forklifts. Night: sodium
floodlights, blinking aviation lights. Climate: dusty in the desert, brighter by the beach, snow on
boxes, girders and roofs.

## Farm

Mostly residential. The block by the ranch gate (log posts, hanging name board over the main street,
wagon wheels, mailbox) is the farmyard: red gambrel barn with a hay hood, white farmhouse with a porch,
lean-to machine shed, granary on stilts, henhouse (empty), 1–3 silos, grain bins with augers, a
windmill turning in the wind, sometimes a water tower. Every other block is a field behind split-rail
fences with gates onto the streets: corn (row strips you plough through; a maze on some seeds), wheat,
a pumpkin patch with a roadside stand, an orchard (apple or pear) with drivable aisles, or hay with
solid round bales. Crops bend and break where cars drive; fields are soft (less grip, more drag, dust
or mud, ruts) and cops follow across them. Scarecrows, parked tractors, a combine by the wheat, ploughs,
balers, hay wagons, churns, feed sacks: all breakable. Cattle grids rattle under the other gate. Slow
tractors in traffic inside and on the roads round it. Night: timber lamps, a yard light and barn
lantern, fireflies on warm nights; harvest nights add jack-o'-lanterns and a bale pyramid. Climate:
snowy fields, dry stalks, bare orchards, no pumpkins in winter; bleached crops and a parked centre-pivot
irrigator in the desert; brighter paint and greener fields by the beach.

## Slums

Grimy brick walk-ups (each window dirty, cracked, smashed, boarded or curtained) with zigzag fire
escapes, crumbling parapets, water tanks and dishes, over boarded shop rows (plywood, rusted shutters,
barred glass); burnt-out shells open to the sky; squats with a tarp over a fallen-in bay; one corner
store still open (OPEN 24, payphones). One or two destroyed buildings: ragged wall stubs with window
holes, slabs hanging onto a rubble heap that spills over the sidewalk, rebar, a KEEP OUT hoarding, loose
bricks. A riveted rail overpass spans the main street where it comes in. One or two vacant blocks are
rubble lots behind torn chain-link with holes on the street sides: soft and bumpy, a shortcut cops
follow; a tent camp may take one (solid). A junkyard: wreck stacks in rows with corridors from street
to street, a magnet crane, a crusher, tyre mountains, a BEWARE OF DOG fence. Graffiti on walls,
shutters, piers, parapets and fences (a few up by the roofs). Wrecks at the kerb and in the lots (burnt,
on bricks, stripped, on their roof, crushed; those on bricks or on their roof don't budge), dumpsters at
alley mouths, bags, carts, mattresses, couches, tyres, burn barrels: all breakable. Utility poles with
sagging wires and hanging sneakers, laundry lines, tree stumps, potholes that jolt every car, oil,
puddles, cracks, faded lines, litter, steaming manholes. Night: most lamps dead (one working per
junction, one buzzing per street), burn barrels and the camp fire glow. Climate: slush, icicles and
barrels lit by day in snow; blown sand, adobe walls and bleached wrecks in the desert; chalky pastels
and salt-rusted wrecks by the beach.
