# Phase 3c-10 notes: matched tracks and a gradual bow taper (D-66), and the slotted brake knee

Author: the 3c-10 agent. Scope: D-66 (Eric 2026-10-12) plus the viewer fix the coordinator added (the brake knee was drawn solid; per D-65 it is slotted). `DECISIONS.md` D-66 has the spec; the implemented numbers are below. Nothing is committed.

## Results at the defaults

| | D-65 (before) | D-66 (now) |
|---|---|---|
| Rear track / front track | 32 / 34.5 in | **30 / 30 in** (the straight-ahead wheels line up) |
| Tire to body gap, rear | 1.75 in at 32 | **1.25 in** (3/4 in is the least) |
| Body | 24 in, then 1.25 in a side over the last 14 in | 24 in to **x = 20**, then one long S to **18.5 in outside** at the bulkhead (2.75 in a side), finished at x = 42.25, parallel to the bulkhead |
| Taper | abrupt, steepest about 7 degrees | **22 in long, steepest 13 degrees, tightest bend radius 31 in** (limit 9.4 in for a 0.234 in band) |
| Overall width | 38.8 in | **34.3 in** (30 in track + hub + axle end; Eric expected about 36) |
| Mass (empty) | 119.9 lb | **115.5 lb** (-4.4) |
| Cargo CG rule (`cargoCgHeightIn`) | 12 in | **10 in** |
| Cargo tip angle (200 lb, worst placement) | 41.9 deg (limit 40) | **40.65 deg**, passes, marginal band; 9 in would give 41.9 as before |
| Cargo capacity | 269 lb (front beam) | **226 lb, limited by tip-straight** |
| Rider safe / green | 50-250+ / 50-240 | **50-250+ / 50-180** (see "Rows above 0.9") |
| Turn radius (outer edge) | 147.6 in | **145.4 in** (limit 150, marginal as before) |
| Resting capacity | 348 lb | 348 lb (the heavier wheel is the tightest member, 73% at 250 lb) |

No row fails at 150 lb, 200 lb or the 200 lb cargo. Rows above 0.9: `tip-straight` (0.92 rider, 0.98 cargo, marginal), `turn-radius` 0.97, and the fit facts `lash-points` 6/6, `seat-stow` 0.94, `park-hold` (cargo case, info).

## The taper is derived, not typed

`bowTaper(p)` in `src/params.ts` (cached; read through `bowTurnInAt`, `Layout.turnIn` and `Layout.taper`):

- Params: `bowTaperStartIn` (20), `bowWidthIn` (18.5, the outside width at the bulkhead), `bowTaperSlackIn` (0.125). `bowTurnInIn` and `bowTurnLenIn` are gone (old links still load).
- Shape: a **smootherstep** from `bodyWidthIn / 2` at the start to `bowWidthIn / 2`: first and second derivatives vanish at both ends, so it is curvature-continuous (no kink where it leaves the straight side). The old smoothstep had a curvature jump.
- End point: `tireSweepInnerEdge` sweeps the front tire's inner face (a plan rectangle, A-4) through every steering angle in +-lock and gives the smallest |y| the tire reaches at each x. The taper must stay `steerClearIn + bowTaperSlackIn` (0.875 in) outside that. The S is ended as far forward as that allows (bisection on the end x, floored to 1/4 in, capped at the bulkhead). A longer S is gentler, so this is the gentlest S that clears. At the defaults the binding point is the tire's inner REAR corner at lock, x = 34.8 in, where the body half width has to be 9.99 in or less. If even the shortest S cannot clear, `validateParams` errors and names the bow width, start, track and lock.
- `steerGeometry` reads the same taper (`clearAtLock`, `minTrack`); min track now answers "what track does THIS body shape need" (29.65 in).
- Everything follows `Layout.turnIn`: chine, gunwale, web, rails, deck outline, bow bulkhead width, king beam length, chain-joist anchor, grab boards, cargo bed width.

Where the clearance comes from, and what the narrower bow cost: at 30 in tracks the body at x = 34.8 must be 2.0 in in from full width, which is why the S cannot be much shorter. Starting it at x = 20 (not 22 to 25) keeps the steepest part at 13 degrees.

## Re-checks (item 4)

- **Rider foot room at the bow:** 17.25 in inside at the bulkhead (18.5 less two 5/8 in sides) against 12 to 14 in needed; validator rule added (bow inside width >= foot span + boots + 1/4 in).
- **Tip at lock and straight:** tip-lock passes (0.80), straight 43.6 deg for the 200 lb rider (green only up to 180 lb), 45.0 deg at 150 lb. Slide-before-tip 1.01 (needs 0.75). Narrower tracks cost about 3 degrees; see below for the options.
- **Turn radius:** 145.4 in outer edge, 120.9 in tire centerline; wheelbase and lock unchanged.
- **Front axle beam:** 27.5 in long (was 32.0), stubs 8 in, clamp plates unchanged; front-beam 0.83, front-stub 0.33. King beam is 17 in between the rails (was 21): king-beam 0.32.
- **Roll pads / king beam:** at the bow the rails stand at 8.5 to 9.25 in off center, so the pads at 11.5 in would have been off the rail. Pads moved to **9.5 in** (`rollPadRadiusIn`): under the rail at every angle (the check reports it), king-bearing 0.80, lever shorter so the pad force is higher but still passes.
- **Steering chains:** the beam eye (`steerChainBeamYIn`) moved in to 8 in (was 10.4) and the anchor (`steerChainAnchorYIn`) to 7.8 in so the chain stays inside the narrowed rails through the swing (it clipped the rail's ramp step at 10.4). steer-stops 0.41.
- **Rear plates (new constraint at 30 in):** the rear U-bolt plate runs 11.75 to 13.25 in off center (tire face at 13.25) and the 12 in rail is above its inner 1/4 in. The rail's relief notch is now cut high enough to clear the plate (zero cost, `frame.ts`), and the validator rule is "plate starts outboard of the rail's INNER face" (where the hanger stands). The alternative, a 1-1/4 in plate, failed bearing-groove (1.03 cargo). Bearing-groove 0.82 as before.
- **Brake:** brake rows unchanged except as noted below. `brake-clear` 0.22 in; the flap, the knee (x 6.25 to 8.75) and the sign (x < 6) do not move; the rear track change moves the flap in with the wheel.
- **Sign:** unchanged (outside of the tall rear side, x -8.2 to 4.3).
- **Lash points and grab boards:** lash plates stay on the straight part of the side, which now ends at x = 20: three per side at x -4.7, 6.8, 18.9 (6 total, the 6 required). Grab boards at x 8 to 17 are unchanged (straight there). `lashPositions` also blocks an under-seat box now.
- **Storage box and seat:** unchanged; box x -8.8 to 7.2, seat cushion to x = 24 where the hull has turned in 0.12 in (cushion 18 in wide in 22.5 in).
- **Cargo bed:** a 20 in wide payload now fits only where the cabin is still 20 in wide inside (`cargoBed`, the load length shrinks); the capacity rows still pass at 200 lb.
- **Deck:** 1 in sampling of the plan outline (was 2 in) so the 13 degree curve is faithful.
- **Truck fit:** fits beside in the bed assembled and in Transport mode, best clearance 3.6 in. Length unchanged.
- **Joists:** the chain joist (1.25 in) now uses its own thickness when its length is set from the rail inner face (a latent bug the straight part of the side hid).

## Rows above 0.9 and the lightest fix (item 5)

The 200 lb goal rider is in the 10% marginal band of `tip-straight` (43.6 deg against 40): from 190 lb the Simple view shows yellow, and the green range is 50 to 180 lb (it was 240). Nothing is red. The 200 lb cargo is at 40.65 deg (limit 40).

Options, lightest first (none applied, Eric decides):
1. **Accept it:** 200 lb rider is "close to the limit" (yellow), not a failure.
2. **Rule 9 in instead of 10 in:** cargo tip back to 41.9 deg (the D-65 margin). Costs nothing; it is a placard number.
3. **Track 30.5 in front and rear:** green to 200 lb, cargo capacity 248 lb, gap 1.5 in, the taper ends at x = 44.25. 31 in: green to 220 lb, capacity 276 lb.
4. **Lower the seat or CG:** not tried.

## Slotted brake knee (coordinator addition)

The knee was an extruded solid, so the flap tongue and pivot block passed through it in the viewer.
- `kneeSlottedMesh` (`model/brake.ts`) builds the knee as a mesh: the (y, z) profile extruded along x in three prisms, the slot (tongue 1.25 in + 1/16 in a side = 1.375 in) sawn from the rear face to a derived depth through the whole arm: inboard ear (with the leg, 2.31 in), outboard ear (0.81 in), and the solid bridge ahead of the slot. The pin hole, clevis pin through the outboard ear, tongue and block and 1 in blind into the inboard ear, and the clip outboard are unchanged.
- **Slot depth is derived:** the four corners of the tongue + block stack are swung through the 2.76 degree stroke and the slot ends `brakePivotSlotClearIn` past the farthest (x = 7.90; it was pin + 0.81, which the flap's 6 degree slope let the block corner enter by 0.03 in). The bridge is 0.85 in of solid oak.
- `Geometry.mesh.boxes` (new, `types.ts`, `bounds.ts`): explicit tight boxes for the overlap tests so the slot is empty. The `brake- x brake-` allow-list entry in `model.test.ts` no longer covers the knee (only pin x knee and chock cord x knee, which are real contact).
- `brake-clear` measured the moving group against the knee only through a skip list; now the knee is measured: tongue and block 1/16 in from the slot walls at every pose, the tongue nose 1/16 in short of the slot end. The sweep also uses the flap's tight box list (the plan outline) instead of one box, and `flapOutline` has a vertex where the tongue ends so the boxes cut there.
- `brake-pivot` gets two more details for the real ear: the outboard ear as a cantilever from the bridge (bending 0.05, shear 0.15). Edge distances (2.0 pin diameters) and end distance (2.0) were already from the real ear sizes. `brake-mount` is unchanged (the arm section beyond the leg is intact; 0.50).
- Test: `brake.test.ts` "the slotted knee is real geometry": the slot is empty, the ears hold the pin, and the flap, pivot block, shoe, pad and foot tread never touch the knee at 11 poses; the block is inside the slot walls by the clearance.

## Tests

- `src/d66.test.ts` (new): the D-66 numbers.
- `src/test-fixtures.ts`: `PRE_D66` restores the D-58 design (32 / 34.5 in tracks, 12 in rule, pads 11.5, chain eyes 10.4 / 8.4, the old 1.25 in turn-in as `bowWidthIn` 21.5 from x = 35, no slack) for the hand-calculation files (front, rear, stability, checks, axle, cargo, hull analysis, track-d58, d60-weight). Spread it BEFORE `PRE_D60`.
- Updated for the taper: `params.test.ts`, `body.test.ts`, `pivot.test.ts` (clearance against the tapered side at the same x; a derived-taper test), `hull`, `seat-stow`, `d63`, `d62` (load-height rule), `plan-wall` (face tilt 13 degrees), `rider-sweep`, `removable`, `fit`, `model.test.ts` (variants, fuzz keys, the rear plate rule, the one narrow seat-hinge fuzz case), `fittings` (wide seat back).
- Overlap boxes for plan walls are 0.4 in long now (were 1.25) so the steeper curve does not inflate the boxes; `model.test.ts` takes about 2 minutes.

## Files touched

`src/params.ts` (taper functions, params, validator), `src/model/{layout,body,frame,storage,plan-wall,brake,brake-layout,bounds,types}.ts`, `src/analysis/{brake,stability}.ts`, `src/ui/simple-text.ts`, `src/test-fixtures.ts`, `docs/phase3c-10-notes.md`, and the tests listed above.
