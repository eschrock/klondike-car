# Phase 3 analysis-honesty fixes (critic r3 MUST-1, MUST-2, MUST-3)

Scope: analysis and Simple-view wording only. No part geometry or sizes changed, no bound tuned to pass. `DECISIONS.md` not edited.

## Result

| | before | after |
|---|---|---|
| Safe range (Simple view) | 50-210 lb, green to 170 | **none: 150 lb fails, and so does every weight 50-250 lb** |
| Limiter at 150 lb | `steer-stops` 1.00 at 220 | `steer-stops` 1.93 (arm toe on the carrier, bounding cases); at the nominal pad and fit-up 1.63 |
| Rows failing at 150 lb | none | `steer-stops` 1.93, `steer-stops-bound` 1.18, `kingpin-bolts` 1.07, `turntable-ring` 1.18 |

Every other row (brake, rear mounts, axles, rails, deck, `pitch-path` 0.57, `kingpin-plates` 0.57) still passes at 150 lb. Only front-end rows fail.

## MUST-3: stop-stand overturning arm (`src/analysis/front.ts`, `stopDetails`)

- The force now acts at the **pad centroid**, read from the built part `steer-stop-face-L1` (z 8.1875-9.4375, centroid 8.8125). Arms: 1.3125" above the riser base and riser-to-arm weld (z 7.5), 1.0" above the web-to-riser weld plane (z 7.8125), 1.5625" above the carrier top (z 7.25). Previously `Mr = F x 0.3125"`.
- Bearing model: the web floats 0.0625" above the turntable top plate (7.8125 vs 7.75), so the "web bears on the top plate" credit is gone. The stand tips about the **toe of the arm**. The far arm screw is the only tension member (the other gets no credit); lever = arm half-length 0.933" + screw offset 0.55" = 1.483", both read from the arm part and its screw joint. The toe presses on the beam top over the existing strip (arm length x (carrier 3/8" + 1/2")).
- The arm-toe bearing row (`arm toe on the carrier, onto the beam top (oak perpendicular)`) now carries the true moment. Riser bending, both weld rows, screw tension, thread stripping and the interaction row use the right arms too.
- Hand-anchored test added (`front.test.ts`, "MUST-3 hand check").

Stiff 3,000 psi pad at the nominal fit-up (the critic's recipe), utilization:

| Row | 150 lb | 200 lb |
|---|---|---|
| arm toe (was 0.44 / 0.49) | **1.63** (585 psi vs 358) | **1.81** (649 psi) |
| web-to-riser weld (was 0.54 / 0.60) | 0.58 | 0.65 |
| riser-to-arm weld | 0.61 | 0.68 |
| `steer-stops-bound` toe, abuse allowable | 1.18 | 1.36 |

Screw thread stripping 0.62 / 0.69 and screw bearing 0.72 / 0.80 stay under 1. These match the critic's recomputation (1.6 / 1.8).

## MUST-1: `turntable-ring` gated

- No longer `info`: `LIGHT_OF_ID['turntable-ring'] = 'strength'`, so it feeds the Strength light and the safe range. The label lost "(info)".
- **Rating basis (stated in the row's `how`):** the equivalent thrust P_eq = V + 4 M_p / D_p against the vertical load rating `turntableRatingLb` (1,500 lb) divided by the project margin `kingpinMargin` (2), the same convention as the `turntable` row; plus the ring-stays-loaded rule e = M_p/V <= kern R/2. Margin convention unchanged. The ring diameter and plate thickness remain `verify` params.
- The critic's alternative basis (1.0 x rating, since the 3x dynamic factor is already in the load) is printed in the row text "for Eric's decision, NOT applied": P_eq would be 59% (150 lb) and 68% (200 lb).
- Values: P_eq 888 lbf at 150 lb (**118%** of 750), 1,025 lbf at 200 lb (**137%**); e = 2.10" = 93% of the 2.25" kern at every weight (marginal).

## MUST-2: bounding cases in the rows (not just the nominal)

New params (all `verify`, not tuned to pass): `steerStopFitMismatchMaxIn` 0.030", `kingpinTorqueTopShareBound` 1.0 (ears share nothing), and `steerStopPadModulusMinPsi` lowered 1,000 to 700 psi. Nominal params (0.018", ear share 0.6, 1,500 psi) stay as the detail.

- `steer-stops`: every pad modulus (700 / 1,500 / 3,000) is evaluated at the nominal fit-up and at 0.030"; each row is the worst of the six.
- `pinLoads` (feeds `kingpin-bolts`, `kingpin-plates`, `kingpin-split`): added the three pads at fit-up 0.030", and three cases with the ears sharing nothing (the bolt rows only). The ear web and weld rows still carry the nominal 40%.
- The cases are not stacked (fit-up bound and ears-nothing are separate cases), matching the critic's one-at-a-time table.

Utilization, bounded vs nominal:

| Row | 150 lb nominal | 150 lb bounded | 200 lb nominal | 200 lb bounded |
|---|---|---|---|---|
| `steer-stops` (worst row) | 1.63 | **1.93** | 1.81 | 2.11 |
| pad strain (soft pad, 0.030") | 0.84 | **1.23** | 0.96 | 1.39 |
| `kingpin-bolts` carrier-end bolt | 0.80 | **1.07** | 0.88 | 1.20 |
| `turntable-ring` | 1.18 | 1.18 | 1.37 | 1.37 |

The 1.07 carrier-end bolt matches the critic's number; the soft pad is now 700 psi at fit-up 0.030".

## Simple view (`simple-text.ts`)

The view reads `riderSweep`; with no safe weight (all 21 weights fail) the browser at localhost:5179 now shows:

- Headline: "Not yet shown safe for a 150 lb rider: the steering stops could crush or loosen at full turn."
- Subline: "No rider weight from 50 to 250 lb passes the checks yet. What stops it: the steering stops at full turn. Everything else passes at this weight. The front end (steering stops, plates and pivot) is being redesigned."
- Bar: all 21 blocks red; note under the bar: "150 lb: a check fails, because the steering stops could crush or loosen at full turn."
- Strength card: "The weakest point is the steering stops at full turn, at 193% of the load this design allows. The design keeps a safety factor in reserve, so this is a shortfall in margin, not a forecast that it will break, but it must be fixed before the cart is built. The front end (steering stops, plates and pivot) is being redesigned."
- No NaN, empty headline or "safe up to" text. The "below / above" limit lines and advice are hidden when there is no safe range. A range that excludes 150 lb but has safe light weights reads "... This cart is comfortably safe for riders 50-100 lb. ..." (tested).
- `FRONT_END_IDS` and `FRONT_END_NOTE` in `simple-text.ts` hold the "being redesigned" wording; delete the note when the redesigned front end passes. A non-front-end limiter gets "Not safe for ..." and the limiter's own advice.
- Added `turntable-ring` part and reason text.

## Proposed D-46 text (replaces the "50-220 lb" sentence; for Eric's sign-off)

> **Front end, round 3, as corrected (critic Phase 3 r3).** Stops adjustable with realistic fit-up (nominal 0.018", bounded at 0.030"); pad modulus 700-3,000 psi; torque shared by two welded shear ears (nominal 60/40, **bounded with the ears sharing nothing, no credit given**). Carrier bolts from below, tapped, preload 1,500 lbf. The stop stand is one welded stand and overturns about the toe of the arm with the force at the pad centroid (the web gets no bearing credit). `turntable-ring` is a gated strength row on the rating / margin 2 basis. **Safe range: none yet.** The checks fail at 150 lb (steer-stops 1.93, steer-stops-bound 1.18, kingpin-bolts 1.07, turntable-ring 1.18) until the front end is redesigned. No rider range is quoted; 150 lb is required (D-1) and 200 lb a goal. Phase 4 bench test (ear share by dial indicator, pad k warm and cold, stops shimmed to a 0.003" feeler, torque proof load) is a go/no-go gate.

D-47: change "`turntable-ring` info row until the maker's moment rating is known" to "`turntable-ring` is a gated row on the rating / margin 2 basis; a named bearing with a published moment rating is needed to pass it".

## Files touched

`src/analysis/front.ts`, `src/analysis/rider-sweep.ts`, `src/params.ts` (3 params), `src/ui/simple-text.ts`; tests `src/analysis/front.test.ts`, `rider-sweep.test.ts`, `brake.test.ts`, `rear.test.ts`, `recommended.test.ts`, `src/ui/simple-text.test.ts` (each changed assertion has a comment saying why). `simple-view.ts` needed no change (every path already handled a null safe range).
