# Phase 3 round 3: rear / brake notes

Files: `src/model/rear-mount.ts` (new: one source of geometry for the bearing plates, shaft notch, beam seat, hold-downs, bolt-length helpers), `src/model/brake.ts`, `frame.ts` (rear end), `running-gear.ts`, `src/analysis/brake.ts`, `brake-mount.ts` (new: closed-linkage statics and bolt group), `rear.ts` (new: `wheel-rating`, `rear-beam-seat`), tests `src/model/rear-mount.test.ts`, `src/analysis/rear.test.ts` plus updates to `brake.test.ts` (both), `model.test.ts`, `hull.test.ts`. Small edits: `params.ts` (new params, validator, new defaults), `layout.ts` (joists always straddle an underslung rear beam), `analysis/index.ts`, `rider-sweep.ts` (light mapping).

## Proposed DECISIONS text

**D-48 (rear mounts, brake headroom, wheel rating; Phase 3 r3, build MUST-3 / MUST-4 / S2 / S7 / S9 / S13 / r1 S10, eng N-7 / N-8).**

*Brake bearing and lever pivot (MUST-3).* The shaft crosses the 0.75" x 4" rail 0.97" above its bottom and 1.25" from its end, so no bolt pattern "around the shaft" can have edge distance. The rail is **notched from below** (1.375" x 1.45", open at the bottom, 1.4" of oak left over it) and the shaft passes through the notch. Each bearing is a flanged bronze sleeve pressed into a **3/16" A36 plate (waterjet/laser service) on the outside of the rail**, bolted in the solid wood **forward** of the notch: 2 rows x 2 columns of 3/8" 316 bolts (rows 0.80" above the rail bottom and 0.90" under the deck ledge, first column 2.95" = 7.9D from the rail end, 1.01" from the notch, 1.75" pitch), 1.5" fender washers and nylock nuts inside. A **1.5" oak doubler** is glued inside the rail behind the grid (forward of the shaft's path, clipped around deck joists), so the bolts go through 2.25" of oak: the NDS cleavage limit and the lateral bolt capacity are not met by 0.75" of rail alone. The **lever pivot is a 3/4" A36 post welded (outsourced, 3/16" fillet) to an ear of the left plate** that reaches behind the rail end (no hole in the rail, nothing in the transom's end grain), with thrust washers and a bronze sleeve; round 2's 3/8" bolt there would have bent (cantilever, about 460 lbf·in at the 2x hold load against 80 allowable), which no check had looked at. The analysis treats the linkage as a closed loop (vector statics, both rolling directions): the link pushes the crank one way and the shoes pull the arms the other, so the net in-plane load on the left plate is about 470 lbf, not the 1,000+ lbf sum of magnitudes round 2 used; the bolt group is solved elastically with in-plane torsion and tilt moments. New rows in `brake-shaft`: bolt shear vs NDS, tension, interaction, washer pull-through, plate bearing/tear-out, end/edge/notch/pitch distances, cleavage both edges, bushing pressure.

*Rear axle beam (MUST-4).* The beam top (z 6.88") is 1.35" above the rail bottom (5.53"). The rails are **notched 2.63" x 1.35" on the underside** and bear on the beam top (ceiling bearing 190 psi against 358); 2.65" of rail remains. Each rail has a **316 stainless angle (1.5" x 1.5" x 3/16", 2.25" long) inside it**: two 1/4" bolts through the upright leg and the rail, two 1/4" bolts down through the flat leg and the beam, either side of the axle rod. New row `rear-beam-seat` (notch ceiling and wall bearing, net-section rail shear 0.88, rebound/skid tension, washers). The 316 flat-bar rear clamp plates replace the zinc "mass is an estimate" boxes. The blanket whitelist ("rails are notched or drilled ... joinery is Phase 3") is removed from `model.test.ts`; two narrower entries name the shaft notch and the beam notch and are bounded by `rear-mount.test.ts` (the beam/rail overlap equals the notch depth; the notch boxes are in the joint records).

*Brake headroom and abuse (N-8).* Goal-rider handle force was 27.1 lbf (0.90). `brakeRatioHeadroom` 1.1 -> **1.2** (critical ratio 14.4:1), shoe stroke 3/8" -> **5/16"**, lever 2.0" thick, clevis pin 3/8": goal force **25.2 lbf (0.84)** even with +5 lb of plates, doublers and shaft. Grip travel **5.7"** (was 6.4"); new `brakeGripTravelMaxIn` 6.5" (status verify, feel-test it) is enforced in `brake-ratio`. **Trade, stated plainly:** each +0.1 of headroom buys about 1.1 lbf of goal force and costs about 0.3" of grip travel and 0.07 of lever-tail utilization; at 1.2 with the 3/8" stroke the travel would be 7.0" (past the limit), so the stroke gives up 1/16" (17% less mud retract). A 1.25 headroom needs a wider lever (1.0" wide runs into the tire). New `brake-abuse`: 100 lbf at the grip (lever, link, crank, shaft, pins, shoes, ratchet, plate bolts, pivot post, weld) at yield level (design allowable x steel SF): passes at 0.89. It is the case that sizes the **shaft: 7/8" 4140 (+1.7 lb)**; the 3/4" shaft's net section reaches 139 ksi at 100 lbf (eng predicted 90) against a 100 ksi yield.

*Wheel rating (N-7).* `wheel-rating`: heavier wheel's static goal-rider load (about 125 lb) vs `wheelRatingLb` 300 (**verify: read it off the vendor listing**), dynamic peak (x3) vs `wheelRatingPeakMult` 2 x the rating, skid mu*P vs `wheelSideRatingFrac` 0.5 x the rating. Util 0.62. The rating and the two multiples are assumptions until a listing is read.

*Push handle (S7).* Post planed to 15/16" x 1-7/16" so it slips (1/32" a side) into the standard 1-1/4" x 1-3/4" x 1/8" aluminum tube; the crossbar is a bought 1-1/4" oak dowel pinned (3/8" 316 rod) and epoxied to the post tops so the handle comes out as one U: no wing nut inside the socket. *Rear bolts (S2):* every bolt length is computed from its stack (`boltLength`): socket 1/4-20 x 2-1/4 button-head (wall + transom + backer = 1.625"), button head with a round hole instead of a carriage bolt in the aluminum wall; quadrant bracket 2-1/4 through the backer and 1-1/2 outboard of it. *Shaft (S9):* order 72" (the cut shaft is 38.1"), cross-drill with cobalt bits in a V-block (method in the part notes); the face-tapped collar still needs a stock check (fallback: outsourced hub welded to the arm). *Splash shield (r1 S10):* a 1/16" bent aluminum hood on the back of each shoe (0.06 lb), low end at the pad's lowest corner so ground clearance is unchanged; it does not change the mud-fouled pass/fail case.

## Per item: what changed, values, mass

| Item | Change | Mass (lb) |
|---|---|---|
| MUST-3 plates | 2 bearing plates 3/16" A36 (1.03 L incl. ear, 0.83 R), 2 bronze bearings, spacer washers; oak pivot/bearing blocks deleted (-0.2) | +1.8 |
| MUST-3 doublers | 2 oak doublers 1.5" thick | +0.9 |
| MUST-3 pivot | 3/4" post 0.20 (was a 0.07 bolt), lever 2.0" thick (+0.25) | +0.4 |
| N-8 shaft | 3/4" -> 7/8" 4140 (4.77 -> 6.50) with collars and crank widened for the bigger bore | +2.0 |
| rail notches | 3.6 in³ of oak out of each rail (shaft notch + beam notch) | -0.2 |
| MUST-4 | 2 hold-down angles 0.67; clamp plates 4 x 0.35 -> 4 x 0.13 (real 316 plate, bolts are in hardware) | +0.1 net on running-gear: -0.2 |
| S7 | posts 15/16 x 1-7/16 | -0.2 |
| S10 | shields | +0.1 |
| hardware (fastener remainder from the joint list) | plate bolts, hold-down bolts, clamp bolts | +0.9 |
| **Total** | brake group 11.0 -> 16.0, running-gear 51.0 -> 50.8, frame 13.5 -> 13.3, removable 3.8 -> 3.6, hardware 6.6 -> 7.5 | **about +5.3** |

Empty mass at the defaults is 169.0 lb (the front/fittings agent's changes are in that number; mine are the +5.3).

## Check changes (defaults)

| Check | Before | After |
|---|---|---|
| brake-force (goal) | marginal 0.90 (27.1 lbf) | pass 0.84 (25.2 lbf; operating 22.1) |
| brake-ratio | pass 13.2:1 | pass 14.4:1, adds grip-travel detail (5.7" vs 6.5") |
| brake-shaft | pass 0.80 | pass 0.89 (now governed by the 7D end distance rule; bolt group, cleavage 0.82/0.84) |
| brake-lever | pass 0.88 | pass 0.72 (post bending 0.72, weld 0.45) |
| brake-abuse, wheel-rating, rear-beam-seat | did not exist | pass 0.89, 0.62, 0.88 |
| bearing-groove | marginal 0.90 | marginal 0.93 (mass: heavier axle load) |
| handle-sockets | pass 0.41 | pass 0.41 (post bending 1800 -> 2137 psi, allowable 6460) |

Simple view safe range (`riderSweep`): **50-210 lb** (was 220), green **to 170 lb** (was 180). At 180-210 the limiting row is the front agent's `steer-stops` (marginal at 180, fail at 220); the +5 lb moves it by about 10 lb of rider. None of my rows fails at any swept weight.

## Open questions for Eric

1. **Weight.** +5.3 lb is real: shaft +2.0 (abuse), plates +1.8, doublers +0.9. Options if it matters: accept a 3/4" shaft and a failing/marginal `brake-abuse` (honest, but it turns the Strength light off at every weight); or lower `brakeAbuseLbf` (the shaft scales with it; not tried). Dropping the doublers fails the cleavage limit (tested).
2. **Welded pivot post.** New to the build (outsourced with the plate, like the kingpin ears, D-46). Alternative: a double-supported pivot with an outboard cheek (not drawn).
3. **Face-tapped collars (S9) and the 7/8" bore** need a vendor check (a 7/8" bore flange collar is stocked more widely than 3/4").
4. **Rail notch depth.** The beam seat leaves 2.65" of 4" rail over the beam; a deeper rail only deepens the notch, so the remaining lever is a shallower axle beam (not tried).
5. **Mud retract** is now 5/16" (was 3/8") to hold the grip travel; feel-test and lining test on the mock-up.

## Tests

`src/model/rear-mount.test.ts` (16): bolts clear of end/bottom/ledge/notch, `at` coordinates equal the pattern (plate and rail frames), plate edge distance, pivot on the ear not the rail end, notch and beam overlap bounded, hold-down joints and positions, 316 clamps, bolt-stack lengths, post/socket fit, shaft stock and method text, BOM parts, girder and stub-axle builds. `src/analysis/rear.test.ts` (18): wheel rating, beam seat, closed-linkage equilibrium, bolt-group solver, shaft row details, abuse and headroom trade, riderSweep. Updated: both `brake.test.ts` (headroom 1.2, 7/8" shaft, pivot post, mass), `model.test.ts` (whitelist, mass band), `hull.test.ts` (rear share 70-86 lb).
