# Phase 3c-6 notes: the weight package (D-60)

Author: the 3c-6 agent. Source: `docs/weight-study-3c.md` and DECISIONS D-60. Final state: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:single` green.

## Result

| | 3c-5 | cleats gone (study B0) | **now** | study |
|---|---|---|---|---|
| Empty mass | 144.4 lb | 143.0 lb | **120.6 lb** | A + the first four trade-offs: about 120.7 lb |
| Safe / green rider range | 50-250+ / 50-210 | same | **50-250+ / 50-230** | 50-250+ / 50-230 (B) |
| Cargo capacity (target 200) | 207 lb | 208 lb | **233 lb** (limiter: front-beam) | 212 (A), 236 (B) |
| Resting capacity (target 250) | 335 lb in D-59 (the study's harness: 359) | 359 lb | **348 lb** | 350 (A), 348 (B, after the 1/2 in transom) |
| Rows failing at 150 lb, 200 lb or cargo | none | none | **none** | none |
| Marginal rows | turn-radius 0.98 | same | **turn-radius 0.98** (unchanged) | same |

Mass by group (lb): body 36.1, running gear 18.6, front end 16.3, frame 13.4, brake and sockets 10.9, seat 8.4, storage 7.0, hardware 5.5, removable 2.4, lighting 2.0. Before the package (cleats gone): body 40.5, running gear 26.4, front end 20.0, frame 14.4.

Rows above 0.9 (rider / goal, cargo): turn-radius 0.98 (marginal, unchanged), lash-points 1.00 (a count), park-hold 0.88 / cargo 2.84 (fit fact, unchanged), seat-stow 0.94, tip-straight 0.86 / 0.95 cargo, front-beam 0.86 / 0.94 cargo. No other row is above 0.9. Every one of these is where the study predicted it (A: tip-straight 0.95, front-beam 0.97; B: seat-stow 0.94, front-beam 0.93).

## What changed

**1. Foot block gone.** `footBlockSlot`, `footBlockStepIn`, `footBlockThickIn`, `footBlockPositions` and the four `foot-slot-*` cleats are removed (`seat.ts`, `layout.ts`, `hull.ts` foot-stop, the `validateParams` warning). `footStopHeightIn` stays (the band of the bulkhead the heels press, used by the foot-stop row). Old links that carry the four keys still load: `decodeHash` ignores unknown keys (test in `params.test.ts` and `d60-weight.test.ts`). The `validateParams` heel warning now fires when the heel is more than 1 in short of the bulkhead face.

**2. Package A.** All 12 items, as parameter edits (each has `D-60` in its ref or note): 3/8 in eye bolts (WLL 900, verify), 3/16 in chain (WLL 1,000, verify), 1-1/4 in chain joist; tongue 1-1/4 x 1-3/4 in; bow bulkhead 1-1/2 in; 5/8 in joists; 12 in handle sockets; hollow axles (below); rear clamp plates 1/4 in; rear beam 2-1/4 in; 7/8 x 3 in brake flaps; and the small items (3/4 in brake backer, 3/4 in lid rim, 1/8 in hold-down angle, 1-3/4 in knee leg, 1-1/4 in seat-back frame, 5/8 in grab boards).

**3. The first four trade-offs.** 2.8 lb wheel rated 300 lb with a 2.28 in hub (below); 4 mm okoume for the side webs, box, lid (and the sign blanks) with the seat back kept at 6 mm (new `seatBackPlyIn`); 1/2 in rear transom; smaller handle posts.

## The hollow axle (new model and analysis)

`axleWallIn` (default 0.120 in; 0 = the old solid 1045 rod) on all three axle pieces (rear through axle or rear stubs, two front stubs). Stock: DOM mild-steel tube, 3/4 in OD x 0.120 in wall (1020 or 1026); same OD as the shafting, so bearings, clamp plates and beam grooves do not change. Strength: `axleTubeYieldPsi` 70,000 and `axleTubeUltimatePsi` 80,000 (1026 DOM; status verify; 1020 DOM may be 60 ksi, which puts axle-stress at about 0.69, still passing). Mass: 3.5 lb saved over the four pieces (2.19 rear, 0.75 each front).

- `src/analysis/axle.ts` holds the tube section, the strengths and the rows that exist because it is a tube with a cross hole. Used by `axle-stress`, `front-stub` and `rest-load`.
- **Bending/yield:** the tube's I = 0.012211 in4 (79% of the rod); `axle-stress` 0.59 (cargo 0.61), `front-stub` 0.33 (cargo 0.48).
- **Cotter-pin cross hole** (`axleCrossHoleDiaIn` 5/32 in, `axleCrossHoleFromEndIn` 3/8 in): net-section bending with the whole wheel force at the outboard edge of the hub (the worst case, since the real moment at the hole is zero) and the hole in the extreme fibers (0.30 / 0.31 hard); pin bearing on the walls and tear-out of the end under a side thrust of mu x V (0.04 to 0.10).
- **Ring bearing at the clamp plates:** the thin wall under a clamp plate's line contact as ring bending (M = 0.318 P' r, sigma = 6M/t^2): rear 0.30 (one station of 1.5 in), front 0.12 (two stations). A 0.03 in wall fails it; the study's 0.095 in wall (0.4 lb lighter, axle-stress 0.76) has dent risk under the clamps.
- `validateParams`: wall that leaves no bore is an error; a cross hole too near the end (less than 1.5 hole diameters) or leaving under 1/2 in for the collar warns.
- Model: `cylinder()` takes `wall`; `Geometry.cylinder` has an optional `wall`; the viewer draws a hollow tube (annulus extrude). Sourcing and notes say DOM tube, the cross holes, "oil or paint the bore and plug the ends" (mild steel rusts inside).

## The wheel (verify before ordering)

2.8 lb, 300 lb rating: Tractor Supply 4.10/3.50-4 wheel (item 3551979, listing figures). The listing gives **neither bore nor hub length**; the study's 2.28 in hub is the Dynaline 80105 listing's. New param `wheelBoreIn` (0.75 in, verify) and a `validateParams` warning when it differs from the axle diameter (many 10 in hand-truck wheels ship with a 5/8 in bore). Weigh the wheel you order. A shorter hub lengthens the front beam by 0.7 in (+0.11 lb) and moves the front stub clamp stations outboard.

## Where the implementation differs from the study (decisions, all small)

1. **Lash doubler kept at 1 in** (the study had 3/4 in, 0.13 lb): the lash plate is 0.9 in wide and would overhang a 3/4 in doubler into the gunwale (an overlap in the model), leaving 1/8 in of oak beside each screw row. Not taken.
2. **Handle posts 11/16 x 1-3/16 in, not 3/4 x 1-1/4:** with the socket tube following the post (outside = post + 2 x (wall + slip)), 11/16 x 1-3/16 in gives the standard 1 x 1-1/2 x 1/8 in 6061 tube; the study's size needs a 1-1/16 x 1-9/16 in tube that is not a catalog size. Saves 0.18 lb more. handle-sockets stays 0.78 (the 1/2 in transom's washer pull-through governs); post bending 0.50. The 3/8 in dowel into the post top now leaves only 5/32 in of oak either side.
3. **Rider leg reach 35.5 to 35.75 in:** the 1-1/2 in bulkhead's rear face (the foot brace) is 1/4 in further forward with the tip where it was. Shortening the front overhang instead drove `king-bearing` to infinity (the rail step moves off the roll pad), so the reach went up 1/4 in (seatXIn + reach = the bulkhead face, as before).
4. **Roll pad radius 11 to 11.5 in:** the 2.28 in hub moves the inner clamp station outboard and the pad (9.5 to 12.5 in from the center) fell inside it; `validateParams` warned. king-bearing is unchanged (0.70 / 0.83).
5. **Sign blanks follow the 4 mm ply** (they use `panelPlyIn`, as in the study run): 4 mm hung signs dent more easily. If Eric wants a 6 mm sign, give it its own param.
6. **`wheel-F x clamp-F` is now an ALLOW entry** in `model.test.ts`: with the 3-1/2 in tire against a 2.28 in hub the tire's OBB reaches the outer clamp plate by 0.24 in; it was already a known artifact of wider-than-hub tires in the variants.

## Things Eric should know (not in the study)

- **Handle sockets: only about 1.7 in of post stays in the socket when riding** (it was 5.7 in): the parked position still sinks the post 9.8 in, so a 12 in socket leaves 12 - 0.5 - 9.8. The row passes the 50 lbf hold-back at 0.78, but the handle will have more play. Options if it feels loose: a 14 in socket (+0.2 lb, insertion 3.7 in) or a shallower parked position.
- **Bridle-eye: the shackle pin is no longer the highest row.** The thinner tongue shortens the pin's jaw gap (pin 0.51, was 0.59) and the bolts' pry lever (nut-washer crush 0.63, was 0.57). The oak under the 2 in washers dents first (a crush, not a break); nothing that breaks is within 0.3 of the pin. A 2-1/2 in washer fixes the ordering if wanted. `bridle.test.ts` records it.
- **Cargo tip angle:** 43.0 to 42.1 degrees (limit 40, marginal as before): a lighter sled lets the payload's high CG count for more.
- 4 mm lid: lid-load (cargo case) 0.42 to 0.75; keep the engraved DO NOT STEP (D-58).
- Overall width falls 39.5 to 38.8 in (the shorter hub).

## Tests

- New: `src/analysis/axle.test.ts` (tube section, strengths, mass, cross-hole and ring details by hand, rows, validation), `src/d60-weight.test.ts` (params with status/refs, foot block gone and old links, mass by group and per part, 4 mm / 6 mm ply, headline analysis results and the rows above 0.9), `src/test-fixtures.ts` (`PRE_D60`).
- Updated with comments: mass bands (`model.test.ts` 146 to 120.6 lb, group bands), hull layout numbers (`hull.test.ts`, `body.test.ts`: 1/2 in transom, bulkhead face at 49.25 in), tongue and bridle hand calcs, the foot-stop, lift and rider-sweep numbers, the truck width. The older hand-calc fixtures (`front`, `bump`, `stability`, `rear`, `checks`, `track-d58` tests) spread `PRE_D60` over the defaults so their hand calculations stay valid against the formulas.
