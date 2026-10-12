# Weight study (3c): lightest sound design

Author: the weight-study agent. Analysis only: nothing under `src/` was edited and no git command was run. The study ran on a throwaway copy of the repo in `/private/tmp/ws/repo` (see Method). Eric is weight-sensitive (D-58); the sled is 144.4 lb empty against a 100-120 lb hope.

## Bottom line

| Package | Empty mass | Saved vs today (144.37) | Safe / green rider range | Cargo capacity (target 200) | Resting capacity (target 250) |
|---|---|---|---|---|---|
| Today (3c-5) | 144.37 lb | n/a | 50-250+ / 50-210 | 207 lb | 359 lb |
| Today less the foot block cleats (approved by Eric, D-57) | 143.00 lb | 1.37 | 50-250+ / 50-210 | 208 lb | 359 lb |
| **A. Free-only** (13 changes, no row newly above 0.9, nothing Eric chose changes) | **127.5 lb** | **16.9** | 50-250+ / 50-220 | 212 lb | 350 lb |
| **B. A plus trade-offs** (a row gets tighter, or a detail shrinks) | **116.0 lb** | **28.4** | 50-250+ / 50-230 | 236 lb | 281 lb |
| C. B plus items Eric chose (ash for non-critical oak, no side signs) | 111.5 lb | 32.9 | 50-250+ / 50-240 | 236 lb | 281 lb |

Even package C does not reach 100 lb. The 100-120 lb target is reachable only with package B; package A alone gets to 127.5 lb.

**Recommendation:** do package A in full (every item is a number change or a vendor choice, and it keeps every range and capacity). Then take from the trade-off list in this order, stopping when Eric is happy: the lighter wheel (2.8 lb), 4 mm ply for the sides and box, a 1/2 in transom, and the smaller handle posts. That gets to about 120 lb without touching anything Eric chose. Leave the deck ply, the axle diameter and the rail sizes alone: they are where the model says the design is already tight. Species (ash) is the single biggest lever left (4 to 7 lb) and it is Eric's call.

## 1. Where the 144.4 lb goes

Empty mass by group (lb, share of 144.37):

| Group | lb | % |
|---|---|---|
| Body (deck, transom, bulkhead, sides) | 40.5 | 28.1 |
| Running gear (wheels, rear axle and beam) | 26.4 | 18.3 |
| Front end (beam, stubs, king beam, tongue, chains, eye bolts) | 20.0 | 13.9 |
| Frame (rails, joists, hangers) | 14.4 | 10.0 |
| Brake and handle sockets | 13.3 | 9.2 |
| Seat | 10.3 | 7.1 |
| Storage box | 8.4 | 5.8 |
| Hardware (fasteners, epoxy allowance, from the joint list) | 5.6 | 3.9 |
| Removable (handlebow, posts, signs) | 3.3 | 2.3 |
| Lighting | 2.0 | 1.4 |

By material: white oak 73.2 lb (51%), okoume ply 23.3 (16%), the four wheels 16.0 (11%), steel 7.7 + eye bolts 2.7 + chain 1.5 + clamps 1.5, 316 fasteners 4.9, foam 2.4, aluminum sockets 2.2.

Top 30 part numbers (summed over identical pieces):

| # | partNo | lb | % | Notes |
|---|---|---|---|---|
| 1 | wheel (x4) | 16.00 | 11.1 | 4.0 lb each (placeholder `wheelMass10Lb`) |
| 2 | deck | 13.88 | 9.6 | 12 mm okoume |
| 3 | transom-rear | 8.20 | 5.7 | one 3/4 in oak board, 24 x 16.4 |
| 4 | bow-bulkhead | 7.01 | 4.9 | 1-3/4 in oak, foot-stop util only 0.10 |
| 5 | rail (x2) | 6.93 | 4.8 | |
| 6 | joist (x6) | 5.09 | 3.5 | plus chain-joist 1.70 |
| 7 | hardware | 5.01 | 3.5 | 43 bolt sets 2.47, screws 1.02, epoxy 0.74 |
| 8 | beam-F | 4.97 | 3.4 | front axle beam |
| 9 | axle-R | 4.64 | 3.2 | solid 3/4 in rod, 37 in |
| 10 | beam-R | 4.58 | 3.2 | rear axle beam (util 0.17) |
| 11 | brake-flap (x2) | 4.02 | 2.8 | |
| 12 | side-web (x2) | 3.80 | 2.6 | 6 mm okoume |
| 13 | brake-knee (x2) | 3.60 | 2.5 | |
| 14 | stub-axle-F (x2) | 3.04 | 2.1 | |
| 15 | side-gunwale (x2) | 2.96 | 2.0 | |
| 16 | king-beam | 2.77 | 1.9 | |
| 17 | side-chine (x2) | 2.55 | 1.8 | |
| 18 | handle-socket (x2) | 2.15 | 1.5 | 16 in aluminum tube |
| 19 | transom-backer (x2) | 2.00 | 1.4 | |
| 20 | bridle-tongue | 1.99 | 1.4 | |
| 21 | seat-cushion | 1.81 | 1.3 | |
| 22 | chain-joist | 1.70 | 1.2 | |
| 23 | seat-grip (x2) | 1.66 | 1.1 | |
| 24 | axle-clamp (x12) | 1.53 | 1.1 | |
| 25 | steer-chain (x2) | 1.49 | 1.0 | |
| 26 | storage-end (x2) | 1.40 | 1.0 | |
| 27 | storage-lid | 1.37 | 0.9 | |
| 28 | steer-eye + steer-anchor (x4) | 2.68 | 1.9 | 1/2 in forged eye bolts |
| 29 | foot-slot (x4) | 1.26 | 0.9 | removed by Eric's decision (below) |
| 30 | brake-chock (x2) | 1.19 | 0.8 | |

The 12 biggest items are 63% of the mass. Wheels, deck, transom, bulkhead, rails, beams and the axle rod are where weight can be won or lost.

## 2. Already approved by Eric: drop the foot block and its cleats

The four slot cleats (`foot-slot-L1/R1/L2/R2`, 1.26 lb) and their fasteners (about 0.1 lb of screws and epoxy in the hardware allowance) go: **143.00 lb** with no other change. The block itself was already out by default (`footBlockSlot` 0), so it adds no mass. Effects found:

- The `foot-stop` row already uses the bow bulkhead alone when no `foot-block` part exists (`footStopLoads` in `src/analysis/hull.ts`): 0.10 at the defaults, unchanged. The block and slot-wall branches in that row become dead code.
- No analysis row names the cleats. `storage.ts` (sign and plate placement) only mentions them in a comment; `Layout.footBlock.behind` goes empty.
- To implement it: `footBlockPositions` needs `min: 0` and default 0 (that is all this study changed); the cleat loop in `src/model/seat.ts` then adds nothing. Also remove params `footBlockSlot`, `footBlockStepIn`, `footBlockThickIn`, `footBlockPositions`, the `validateParams` warning that mentions the slots (`src/params.ts` near line 1994), and update the tests that mention foot-slot or foot-block (`params.test.ts`, `analysis/hull.test.ts`, `analysis/checks.test.ts`, `model/fittings.test.ts`, `model/seat-stow.test.ts`, `model/model.test.ts`, `model/body.test.ts`).
- Cargo capacity 207 to 208 lb, safe and green ranges unchanged, resting capacity 358 to 359 lb (a little less mass).

All other numbers below are measured against this 143.00 lb baseline ("B0").

## 3. Method

- **Harness:** `/private/tmp/ws/lib.ts` (`evaluate(overrides)`) builds the model, runs `runChecks` (150 lb operating rider, 200 lb goal rider, 200 lb cargo case, the resting case), `riderSweep` (50-250 lb in 10 lb steps) and `cargoCapacity`. Resting capacity is the `rest-load` row's computed maximum. Every candidate is run alone against B0, then the packages are built cumulatively so interactions show. `validateParams` errors are reported (a candidate with one is not usable as is).
- **Row utilization** is the larger of the rider/goal/hard-hit value and the cargo value (`util`, `utilCargo`). Rows that are build-fit facts or unchanged by any candidate (`park-hold`, `lash-points` 1.00 which is a count, `seat-stow` 0.97, `storage-pack` 0.88, `turn-radius` 0.98 marginal, `steer-clear` 0.88, `brake-traction`) are left out of the "worst row" columns. `turn-radius` is the one marginal row at B0 and no candidate changes it.
- **Throwaway repo copy** `/private/tmp/ws/repo` (the real repo is untouched). Four small patches were needed for ideas that have no parameter: `footBlockPositions` min 0 (the approved change); a hollow-axle option (`tubeWall`, `tubeWallF`: mass and the bending section of the rear rod and front stubs, applied to `axle-stress`, `rest-load` and `front-stub`); a switch that keeps the seat-back panel at 6 mm when the other panels go to 4 mm; and a mass-only species swap for chosen oak part numbers (density 47 to 42 lb/ft3).
- **Thresholds:** "free" = the change passes every row, no row newly above about 0.9, the safe range (50-250+) and green range (50-210) do not shrink, cargo capacity stays at or above 200 lb, resting capacity at or above 250 lb, and nothing Eric chose changes. "Trade-off" = a row gets tight (0.85 to 1.0) or a range or feature shrinks. "Owner choice" = changes something recorded as Eric's decision.
- **Wheel data** comes from retailer listings, not from the model: Wesco 10 in pneumatic offset wheel 151551, 3.5 lb, 350 lb rating (B&H listing); Tractor Supply 4.10/3.50-4 wheel 3551979, 2.8 lb, 300 lb rating, steel rim; B&P 10 in wheel 6 lb (shipping), 350 lb; Dynaline 80105, 280 lb rating, 2.28 in hub width. **Bore (3/4 vs 5/8 in) and hub length are not confirmed for any of them** and must be checked before buying: the model assumes a 3/4 in bore and a 3 in hub. Listing weights are retailer figures and may differ from the maker's.
- **Species values** (white ash, USDA Wood Handbook): 42 lb/ft3, MOR 15,000, MOE 1.74 million, shear 1,910, compression parallel 7,410, perpendicular 1,160 psi, against 47 / 15,200 / 1.78 million / 2,000 / 7,440 / 1,070 for white oak. NDS-type values were scaled by specific gravity (0.60 against 0.68).
- Caveat on the four hand-picked rating numbers in the wheel rows: the model's `wheelRatingLb` drives the `wheel-rating` and `rest-load` rows only; it is a placeholder (`verify`) today.

## 4. Candidates, one at a time (mass saved against B0 = 143.00 lb)

"Worst row" is the highest non-fit row after the change (the front beam at 0.98 under 200 lb cargo is the worst row at B0, so it shows for most lines). Class: **A** free, **B** trade-off, **C** changes something Eric chose, **X** rejected (a row fails or a range shrinks too much).

### Wheels and axles

| Candidate | Saved lb | Rows that change | Safe / green | Cargo | Rest | Class |
|---|---|---|---|---|---|---|
| Rear through-rod becomes 3/4 x 0.12 in wall DOM tube | 2.14 | axle-stress 0.53 to 0.67 | same | 208 | 360 | A (sourcing: tube yield, end cross-hole for the cotter) |
| Same, 0.188 wall | 1.15 | axle-stress 0.56 | same | 208 | 359 | A (safer, smaller saving) |
| Same, 0.095 wall | 2.58 | axle-stress 0.76 | same | 208 | 360 | B (thin wall, dent risk under the clamps) |
| Front stubs become 3/4 x 0.12 tube | 1.40 | front-stub 0.49 to 0.62 | same | 210 | 359 | A |
| Wheels 3.5 lb, 350 lb rating (Wesco 151551 class) | 2.00 | wheel-rating 0.66 to 0.56, rest-load 0.69 | same | 209 | 361 | A (verify bore and hub) |
| Wheels 2.8 lb, 300 lb rating (Tractor Supply class) | 4.80 | none | same | 210 | 360 | B (listing only; bore may be 5/8 in) |
| Hub 3.0 to 2.28 in (short-hub wheel) | 0.04 | front-beam 0.98 to 0.94, front-stub 0.38 | same | 231 | 359 | A (free bonus, comes with the wheel) |
| Hypothetical 3.0 lb wheel rated 250 lb | 4.00 | rest-load 0.88, wheel-rating 0.79 | same | 210 | 290 | B (needs rating at or above about 230 to hold 250 lb at rest) |
| Hypothetical 3.0 lb wheel rated 200 lb | 4.00 | rest-load 1.13 | - | 206 | 221 | X |
| Rear stub axles instead of a through rod (existing `axleStyle`) | 2.63 | axle-stress 0.46 | same | 208 | 360 | B (no row checks the stub bearing in the rear beam end; the same detail at the front is the cargo limiter at 0.98) |
| All axles 3/4 to 5/8 in solid | 2.18 | bearing-groove 1.08, front-beam 1.18, axle-stress 0.91 | 50-170 / none | 132 | 360 | X |
| 9 in wheels | 1.14 | front-beam 1.06 | same | 173 | 359 | X |
| 8 in wheels | 2.37 | brake-clear fails, front-beam 1.15 | none | 140 | 360 | X |
| Flat-free tires | -5.00 | | green 50-200 | 206 | 357 | X (heavier) |
| Rear beam 2.5 to 2.25 in fore-aft | 0.50 | beam-rear 0.19 | same | 208 | 359 | A |
| Rear beam to 2.0 in | 1.00 | validation error (0.63 in ligament) | | | | X |
| Axle beams 2.25 to 2.0 in deep | 1.07 | kingpin 0.77 to 0.96 | green none | 209 | 359 | X |
| Rear clamp plates 3/8 to 1/4 in | 0.51 | none | same | 209 | 359 | A |
| Beam hold-down angle 3/16 to 1/8 in | 0.21 | none | same | 208 | 359 | A |

### Front end

| Candidate | Saved lb | Rows that change | Safe / green | Cargo | Rest | Class |
|---|---|---|---|---|---|---|
| Eye bolts 1/2 to 3/8 in (WLL 900) | 0.96 | steer-stops 0.46 to 0.54 | same | 209 | 359 | A (WLL is a supplier number to confirm) |
| Chain 1/4 to 3/16 in (WLL 1,000) | 0.65 | none | same | 209 | 359 | A |
| Both, plus chain joist 1.5 to 1.25 in | 1.88 | steer-stops 0.54 | same | 210 | 359 | A |
| Both, chain joist to 1.0 in | 2.15 | steer-stops 0.71 | same | 210 | 359 | B |
| Tongue 1.5 x 2 to 1.25 x 1.75 in | 0.36 | bridle-eye 0.59 to 0.63 | same | 209 | 359 | A |
| King beam 3.0 to 2.5 in long | 0.48 | king-beam 0.68 to 0.87 | same | 209 | 359 | B |
| Front beam 2.5 to 2.25 in | 0.46 | front-beam 1.00 | green none | 200 | 359 | X (even with a 2.28 in hub it sits at 1.00) |
| Front stubs 8 to 6 in | 0.50 | front-beam 1.13 | same | 147 | 359 | X |

### Deck, frame, hull

| Candidate | Saved lb | Rows that change | Safe / green | Cargo | Rest | Class |
|---|---|---|---|---|---|---|
| Deck ply 12 to 9 mm, joists at 8.5 in | 2.86 | deck 1.31, rest-load 1.64 | 50-150 / none | 209 | 152 | X |
| Deck ply 9 mm with joists at 7 in (3 more joists) | 2.18 | deck 1.04, rest-load 1.30 | 50-190 / 50-170 | 209 | 192 | X (the extra joists eat the gain) |
| Joist spacing 8.5 to 10 in (7 joists, undo the D-59 joist) | 0.84 | rest-load 0.90, deck 0.72 | same | 209 | 279 | B (rest target 250 still met) |
| Joists 3/4 to 5/8 in thick | 0.80 | joists 0.54 to 0.65 | same | 209 | 351 | A |
| Joists 1.75 to 1.5 in deep | 1.07 | joists 0.85 | **50-230** / 50-210 | 209 | 359 | B (range shrinks) |
| Joists 1.75 to 1.25 in deep | 2.14 | joists 1.48 | fails | | 288 | X |
| Rear transom 3/4 to 5/8 in | 1.24 | lift 0.54 to 0.64 | same | 208 | 359 | A |
| Rear transom to 1/2 in | 2.48 | lift 0.78 | same | 207 | 358 | B (Domino wall and socket bolts get thin) |
| Bow bulkhead 1.75 to 1.5 in | 0.89 | foot-stop 0.10 to 0.14 | same | 209 | 359 | A |
| Bow bulkhead to 1.25 in | 1.77 | foot-stop 0.20 | green 50-200 alone, 50-220 in the package | 210 | 358 | B |
| Bow bulkhead to 1.0 in | 2.66 | foot-stop 0.31 | green 50-200 | 211 | 358 | B |
| Chine and gunwale stock 5/8 to 1/2 in | 0.98 | none | same | 208 | 357 | B (groove walls only 0.11 in) |
| Chine and gunwale band 1.5 to 1.25 in | 0.80 | brake-mount 0.83 | same | 209 | 359 | B |
| Chine and gunwale band to 1.0 in | 1.64 | brake-mount 0.87 | same | 209 | 359 | B |
| Rail depth 3 to 2.75 in | 0.61 | rails 0.65 to 0.84 | same | 208 | 359 | B |
| Rail depth to 2.5 in | 1.21 | rails 1.11 | 50-170 | 195 | 359 | X |
| Rail thickness 3/4 to 11/16 in | 0.49 | king-bearing 0.91 | same | 208 | 359 | B |
| Rail thickness to 5/8 in | 0.98 | king-bearing 1.01 (cargo) | same | 197 | 359 | X |
| 4 mm okoume for sides, box and lid, seat back kept at 6 mm | 2.27 | lid-load 0.42 to 0.71, storage-pack 0.89 | same | 208 | 360 | B (thin skin and lid; dents) |
| 4 mm okoume everywhere including the seat back | 2.53 | seat-back 1.09 | 50-180 | 208 | 360 | X |
| Box volume 2,000 to 1,600 in3 | 0.77 | storage-pack and seat-stow fail | same | 207 | 359 | X |

### Handle, brake, seat, small parts

| Candidate | Saved lb | Rows that change | Safe / green | Cargo | Rest | Class |
|---|---|---|---|---|---|---|
| Handle sockets 16 to 14 in | 0.43 | handle-sockets 0.41 | same | 208 | 359 | A |
| Handle sockets 16 to 12 in | 1.00 | handle-sockets 0.78 | same | 208 | 359 | A |
| Handle sockets to 10 in | 1.73 | handle-sockets 2.25 | none | | | X |
| Socket wall 1/8 to 1/16 in | 1.16 | none in the model | same | 208 | 360 | X (no row models the wall; dents) |
| Handle posts 15/16 to 3/4 in thick | 0.41 | handle-sockets 0.34 | same | 208 | 359 | B |
| Handle posts 1-7/16 to 1-1/4 in wide | 0.37 | none | same | 208 | 359 | B |
| Brake flap 1 to 7/8 in thick | 0.53 | brake-return 0.61 | same | 208 | 359 | A |
| Brake flap 3.5 to 3 in wide | 0.68 | brake-return 0.61 | same | 208 | 359 | A |
| Both together | 1.14 | brake-flap 0.68, brake-return 0.55 | same | 208 | 359 | A |
| Brake knee 2.5 to 2 in deep | 0.81 | brake-mount 0.88, brake-abuse 0.63 | **50-240 / 50-200** | 208 | 359 | B |
| Knee leg 2 to 1.75 in | 0.20 | none | same | 208 | 359 | A |
| Knee backer 1.25 to 0.75 in | 0.30 | none | same | 208 | 359 | A |
| One chock instead of two | 0.61 | park-hold fails | none | 208 | 359 | X |
| Seat back frame 1.5 to 1.25 in | 0.32 | seat-back 0.53 | same | 208 | 359 | A |
| Seat back 16 to 14 in high | 0.41 | seat-back 0.50 | same | 208 | 359 | B (less support) |
| Seat back 16 to 14 in wide | 0.49 | seat-back 0.50 | same | 208 | 359 | B |
| Seat back panel 3/4 to 1/2 in | 0.62 | seat-back 1.03 | 50-190 | 208 | 359 | X |
| Cushion 2 to 1.5 in | 0.32 | none | same | 208 | 359 | B (comfort) |
| Grab boards 3/4 to 5/8 in | 0.26 | none | same | 208 | 359 | A |
| Grab boards to 1/2 in, or 6 in long | 0.52 / 0.48 | none | same | 208 | 359 | B (feel; the row does not model the hole) |
| Lid frame rim 1 to 0.75 in | 0.24 | lid-load 0.44 | same | 208 | 359 | A |
| Lash doubler 1 to 0.75 in | 0.13 | none | same | 208 | 359 | A |
| Lash points 3 to 2 per side | 0.46 | lash-points fails | | | | X |

### Things Eric chose (class C)

| Candidate | Saved lb | Rows that change | Safe / green | Cargo | Rest | Note |
|---|---|---|---|---|---|---|
| White ash instead of white oak, everywhere | 7.29 | kingpin 0.94, rear-beam-seat 0.95, front-beam 0.90 (cargo 226) | 50-250+ / none (150 lb rider goes yellow) | 226 | 361 | the biggest single lever; not rot-resistant like white oak; sealed it is fine, bare it is not |
| Ash for 21 non-critical oak part numbers only (transom, bulkhead, joists, gunwale, chine, flaps, seat, box, handle, backers; oak kept for beams, king beam, rails, hangers, knees, tongue, chocks) | 5.06 | none | same | 209 | 361 | strength within 1 to 4% of oak (not re-run per member: joists 0.55) |
| Hard maple instead of white oak | 3.64 | brake-hinge 0.75; others improve (bearing-groove 0.66) | same | 246 | 360 | stronger, only 5% lighter, same decay issue as ash |
| Side signs off | 0.95 | none | same | 208 | 359 | D-57 item 9 restored them |
| Rear side height 14 to 12 in | 2.31 | brake-return 0.76, handle-sockets 0.46 | same | 208 | 360 | D-57 item 2 |
| Body width 24 to 23 in | 1.62 | brake-mount 0.88, seat-stow 1.00 | 50-240 / 50-200 | 237 | 361 | "keep the width" (D-53) |
| Body width 24 to 22 in | 3.22 | king-bearing 1.10, seat-stow fails | 50-200 | 161 | 361 | X |

Not modeled, hand estimates only (low value, not in the packages): scooping the middle of the rear beam where `beam-rear` is only 0.17 (about 0.4 to 0.6 lb); wire rope for the steering check chains (about 0.3 lb); lightening cut-outs in the transom (about 0.5 lb, hurts the lift row); a lower-density softwood for the joists (the deck bays are already the tight part). None changes the conclusion.

## 5. Ranking by lb saved per risk and effort

Effort: P = a parameter edit, S = sourcing or a design check before it is safe.

**A. Free (take all of these)**

| Rank | Change | lb | Effort | Why it is free |
|---|---|---|---|---|
| 1 | Hollow 3/4 x 0.12 in axles (rear rod and front stubs) | 3.55 | S | axle-stress 0.67, front-stub 0.62; check tube yield and the end cross-hole |
| 2 | Lighter 10 in wheels, 3.5 lb with a 350 lb rating | 2.00 | S | wheel-rating improves; verify bore and hub (a 2.8 lb 300 lb wheel exists too, class B) |
| 3 | 3/8 in eye bolts, 3/16 in chain, 1.25 in chain joist | 1.88 | P | steer-stops 0.54 (supplier WLL to confirm) |
| 4 | Rear transom 5/8 in | 1.24 | P | lift 0.64 |
| 5 | Brake flaps 7/8 x 3 in | 1.14 | P | brake-return improves to 0.55 |
| 6 | Handle sockets 12 in | 1.00 | P | handle-sockets 0.78 |
| 7 | Bow bulkhead 1.5 in | 0.89 | P | foot-stop 0.14 |
| 8 | Deck joists 5/8 in thick | 0.80 | P | joists 0.65, resting 350 lb |
| 9 | Rear clamp plates 1/4 in | 0.51 | P | no row moves |
| 10 | Rear beam 2.25 in | 0.50 | P | beam-rear 0.19 |
| 11 | Tongue 1.25 x 1.75 in | 0.36 | P | bridle-eye 0.63 |
| 12 | Small items: backer 3/4, seat back frame 1.25, grab boards 5/8, lid rim 3/4, hold-down angle 1/8, knee leg 1.75, lash doubler 3/4 | 1.63 | P | no row above 0.68 |

**B. Trade-offs (in order of value for the cost)**

| Rank | Change | lb | What gets tighter |
|---|---|---|---|
| 1 | 2.8 lb 300 lb wheel with a 2.28 in hub, instead of the 3.5 lb one | 2.73 | listing only; bore and hub must match; cargo capacity rises to 236 lb |
| 2 | 4 mm okoume for sides, box and lid (seat back stays 6 mm) | 2.27 | thin skin dents; lid-load 0.71 |
| 3 | Rear transom 1/2 in | 1.24 more | lift 0.78; Domino and socket bolt edge distances |
| 4 | Chine and gunwale 1/2 in stock and 1.25 in band | 1.65 | groove walls 0.11 in; brake-mount 0.83 |
| 5 | Bow bulkhead 1.25 in | 0.89 more | foot-stop 0.20 |
| 6 | Handle posts 3/4 x 1-1/4 in | 0.57 | handle feel |
| 7 | Cushion 1.5 in and seat back 14 in high | 0.72 | comfort |
| 8 | Joists back to 10 in spacing | 0.72 | resting capacity 359 to 281 lb (target 250), rest-load 0.89; reverses part of D-59 |
| 9 | King beam 2.5 in long | 0.47 | king-beam 0.85 |
| 10 | Grab boards 1/2 in | 0.25 more | feel |

Not recommended even though they save weight: joists 1.5 in deep (safe range shrinks to 230), brake knee 2 in (range 240), rear stub axles (unchecked bearing).

**C. Changes something Eric chose (flag, do not do without asking)**: ash for non-critical oak (-3.8 on top of B), side signs off (-0.8), rear side height 12 in (-2.3), narrower body (-1.6), ash everywhere (-7.3 alone but kingpin 0.94, rear-beam-seat 0.95 and the green range goes), hard maple.

## 6. The packages in detail

Each line is the cumulative run (mass change in that step, then the result so far). Every step re-runs all rows, both ranges, cargo capacity and resting capacity with the earlier steps in place.

### Package A: free only (127.5 lb)

| Step | Change in step | Mass | Safe / green | Cargo | Rest |
|---|---|---|---|---|---|
| Today | | 144.37 | 50-250+ / 50-210 | 207 | 359 |
| Foot block cleats gone (approved) | -1.37 | 143.00 | 50-250+ / 50-210 | 208 | 359 |
| Steering: 3/8 eye bolts, 3/16 chain, 1.25 chain joist | -1.88 | 141.12 | same | 210 | 359 |
| Tongue 1.25 x 1.75 | -0.36 | 140.76 | same | 210 | 359 |
| Bow bulkhead 1.5 in | -0.89 | 139.87 | same | 211 | 359 |
| Rear transom 5/8 in | -1.24 | 138.63 | same | 211 | 359 |
| Joists 5/8 in thick | -0.80 | 137.83 | same | 211 | 350 |
| Handle sockets 12 in | -1.00 | 136.83 | same | 210 | 350 |
| Axle tubes (rear and front) | -3.55 | 133.28 | same | 211 | 350 |
| Rear clamp plates 1/4 in | -0.51 | 132.77 | same | 212 | 350 |
| Rear beam 2.25 in | -0.50 | 132.27 | 50-250+ / 50-220 | 212 | 350 |
| Flaps 7/8 x 3 in | -1.14 | 131.14 | same | 211 | 350 |
| Small items (7 changes) | -1.63 | 129.50 | same | 212 | 350 |
| Wheels 3.5 lb, 350 lb rating | -2.00 | **127.50** | **50-250+ / 50-220** | **212** | **350** |

Rows at the end (rider/goal, cargo): turn-radius 0.98 marginal (unchanged), front-beam 0.86 / 0.97, tip-straight 0.86 / 0.95, rear-beam-seat 0.86 / 0.89, bearing-groove 0.85 / 0.88, brake-ratio 0.84, seat-grip 0.83. No row is newly above 0.9; none fails at 150, 200 or cargo. The cart gets lighter so tipping rows improve for riders. Group masses: running gear 21.4, front end 16.3, frame 13.4, body 38.2, brake 11.1, seat 8.4, storage 8.1.

### Package B: A plus trade-offs (116.0 lb)

| Step | Change in step | Mass | Safe / green | Cargo | Rest |
|---|---|---|---|---|---|
| Package A | | 127.50 | 50-250+ / 50-220 | 212 | 350 |
| Bow bulkhead 1.25 in | -0.89 | 126.62 | same | 213 | 350 |
| Rear transom 1/2 in | -1.24 | 125.37 | same | 213 | 348 |
| 4 mm ply, seat back 6 mm | -2.27 | 123.10 | 50-250+ / 50-230 | 212 | 348 |
| Chine and gunwale 1/2 in stock | -0.99 | 122.11 | same | 212 | 348 |
| Chine and gunwale 1.25 in band | -0.66 | 121.45 | same | 212 | 348 |
| Handle posts 3/4 x 1-1/4 | -0.57 | 120.88 | same | 212 | 348 |
| King beam 2.5 in long | -0.47 | 120.41 | same | 213 | 366 |
| 2.8 lb 300 lb wheel with 2.28 in hub (replaces the 3.5 lb one) | -2.73 | 117.68 | same | 236 | 366 |
| Cushion 1.5 in, seat back 14 in high | -0.72 | 116.96 | same | 236 | 366 |
| Grab boards 1/2 in | -0.25 | 116.71 | same | 236 | 366 |
| Joists at 10 in spacing | -0.72 | **115.99** | **50-250+ / 50-230** | **236** | **281** |

End rows (rider/goal, cargo): turn-radius 0.98 marginal, tip-straight 0.85 / 0.96, seat-stow 0.94, front-beam 0.86 / 0.93, rest-load 0.89, rear-beam-seat 0.84 / 0.87, bearing-groove 0.83 / 0.86, king-beam 0.56 / 0.85. Nothing fails. Remove the last step (joists) and rest returns to 366 lb at 116.7 lb; remove the wheel step and the cargo capacity falls back to 213 lb. Nothing in B is a safety-margin cut: the resting target (250 lb) and the cargo target (200 lb) both still hold, with 8 to 36% in hand.

### Package C: B plus Eric-choice items (111.5 lb)

Ash for the 21 non-critical oak part numbers (-3.77) and no side signs (-0.77): 111.46 lb, green to 240 lb, cargo 236, resting 281. Ash needs a durability decision from Eric (sealed outdoor use only) and the strength figures re-checked per member before it is used.

## 7. What to do next

1. Eric picks the package. Package A needs no decision beyond confirming the two sourcing items (a 3/4 in DOM tube for the axles and a 3.5 lb 350 lb 10 in wheel with a 3/4 in bore).
2. Implement as parameter edits (A and most of B), plus two small model changes: the hollow-axle option (mass and section, in `running-gear.ts`, `pivot.ts` and the three analysis rows) and the foot block removal (section 2).
3. Re-run `npm test` (several hand-calc tests carry the old numbers: joist count, transom and bulkhead mass, wheel mass, tongue and chain parameters) and re-check the D-58 text (cargo 200 lb, resting 250 lb).
4. Ask a critic agent to grade the final package (CLAUDE.md workflow) and record it in `docs/reviews/`.

Throwaway scripts: `/private/tmp/ws/` (`lib.ts`, `table.ts`, `pkg.ts`, `batch*.ts`); copy of the repo with the study patches: `/private/tmp/ws/repo`.
