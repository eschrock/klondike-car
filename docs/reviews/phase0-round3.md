SCORE: 9/10

# Phase 0 review, round 3 (final)

Checks run: `npm test` gives 136 pass; `npm run typecheck` is clean. A scratch run (since removed) gave `validateParams(defaultParams()) = []`. Every number below was recomputed independently (Python plus a scratch vitest file, both deleted; `git status` clean apart from this file).

## Numbers re-derived

| Item | My result | Doc | Verdict |
|---|---|---|---|
| A-4 inner rear-inner corner y, 40°, track 35.5, w 4, r 6.5 | 15.75·cos40 − 6.5·sin40 = **7.887** | 7.89 | OK |
| A-4 rear-most tire extent | 19.75·sin40 + 6.5·cos40 = **17.674** | 17.67 | OK |
| Nose limit / shoulder limit | 2·(7.887 − 0.75) = **14.27"**; 17.674 + 0.75 = **18.42"** | 14.3 / 18.42 | OK; defaults 14 and 18.5 pass |
| Monotonic in δ (both worst at full lock) | y falls for all δ < 90°; rear extent peaks at atan(19.75/6.5) = 71.8° | "≈72°" | OK |
| Geometry sanity (rotation convention) | the left tire's outer-rear corner is the rear-most point, at (−17.67, 10.95); hull step at −18.5 clears it by 0.83" | | OK |
| Wheel-well logic | outer half-width max(2, 1.5 + 1) = 2.5; 35.5 + 5 + 1 = 41.5 (exact); `overallWidthIn` 40.5, `maxTrackBesideWells` 35.5 | 35.5 | OK |
| Straddle window | front centre ≤ 18 − 6.5 − 0.5 = 11; rear ≥ 52 + 7 = 59; wheelbase ≥ 48 | 48, zero slack | OK |
| W-1 non-wood, default / lean 10" / lean 13" | 46.9 / 35.1 / 41.1 | same | OK |
| W-1 wood rows, default (68.4) + finish 5.9 | 74.3 | 74.3 | OK |
| W-1 wood rows, lean (41.2) + finish 5.4 | 46.6 | 46.6 | OK |
| W-1 totals | 121.2 / 81.7 / 87.7 | ~121 / ~82 / ~88 | OK |
| Axle steel ¾" × 41.5" ×2 | 10.4 lb | 10.4 | OK (see issue 2 on the 41.5") |
| D-20 finish | 0.09 lb/ft² × 65 ft² = 5.85 lb; ~60 ft² area is plausible (deck 21, sides 13, rails 7, beams 6, box 8) | 5.9 | OK |
| D-2 cart × 3 | 84 → 252; 119 → 357 | +250 / +360 | OK |
| Hand calc: W, CG x/h, straight tip, lock tip, SSF out, v_roll, brake ratio, rear μ·N_r | all 4 rows reproduce (e.g. 119/200: W 344, CG 17.5/15.6, 48.6°, 45.1°, 1.05, 8.9 mph, 9.27:1, 91.2 vs 89.0) | same | OK, within rounding |
| Brake default | 10:1 × 30 × 0.8 × 0.4 = 96 lbf against 89.0 worst case | "covers 9.3:1" | OK, +8% |
| Turn radius | rear centre 48/tan40 = 57.2" = 4.77 ft; outer front wheel centre 48/sin40 + 17.75 = 92.4" = 7.7 ft | 4.8 / 7.7 | OK |
| D-19 rear-load delta | about +8 to +10 lb | "~8 lb" | OK |

## `validateParams` at defaults and failure modes (scratch run)

| Case | Result |
|---|---|
| Defaults | `[]` |
| `noseWidthIn` 16 | error, "≤ 14.27" wide" |
| `steerLockDeg` 50 | two errors (nose ≤ 8.79", shoulder ≥ 20.06") |
| `noseTaperStartIn` 15 | error, "≥ 18.42" |
| Track 40/40 | shoulder error plus overall-width warning (45.0", max track 35.5") |
| 10" wheel | only the ground-clearance warning (2.88"), which is correct for a 2.5" underslung beam |

The round-2 gaps (swing clearance and `maxTrackBesideWells` not enforced) are closed.

## Round-2 issue status

| # | Round-2 issue | Status | Evidence |
|---|---|---|---|
| 1 | Hand calcs at the old 67 lb cart; 9:1 brake fails at 119 lb | **Fixed** | Table re-run at 84 and 119 lb; the 10:1 default covers 9.27:1. D-13, D-14 (290 lb) and D-2 updated. Small residual in issue 1 below. |
| 2 | D-19 "+23 lb" double-count | **Fixed** | Now "~8 lb", described as a small help, with margins of +2% to +5% quoted in the table and "fails at μ 0.3" stated. |
| 3 | D-15 swing prose only | **Fixed** | `swingInnerYIn`, `swingRearXIn`, `steeringClearanceIn` and two validator errors; A-4 formulas verified. `noseTaperLengthIn` was not added, which is fine because the shoulder is modelled as a step. |
| 4 | `maxTrackBesideWells` unused; axle-end protrusion ignored | **Mostly fixed** | `wheelOuterHalfIn` (2.5") feeds `overallWidthIn` and `maxTrackBesideWells`, and a warning fires. There is still no straddle-window check, which is acceptable as D-6 and Q-1 are open. |
| 5 | Storage geometry unverified | **Partly fixed** | D-19 now gives 24 × 12 × 6½" and 1,800 in³ is consistent (1,872). There are still no envelope params or validator, and 12" fore-aft is asserted without a layout. Low. |
| 6 | A-1 criterion partly meaningless | **Fixed** | A-1 adds slide-before-tip and an SSF ≥ 1.5·μ criterion (1.00–1.11 against 0.75) and recommends SSF as pass/fail with v_roll as information. The 6.1 mph slide speed is stated. Q-3 is framed correctly. |
| 7 | Wheel diameter 10 or 13 only | **Fixed** | Continuous 10–13, mass interpolated in `derived()`. D-11 still says "the two common sizes" and the param note says ~12" exists. Cosmetic. |
| 8 | Rails missing from the D-15 stack | **Fixed** | Rails z 5.6–8.6, notched over the rear beam. |
| 9 | `CheckResult.pass` boolean | **Fixed** | `status: pass/marginal/fail/info`. |
| 10 | Lean recipe vs ground clearance | **Fixed** | D-15 says a 10" build needs a 1¾" or overslung beam (3.3" with a 2" beam is correct). |
| 11 | Placeholder deck length | **Fixed** | `bodyLengthIn` is now used. |
| 12 | Small items | **Mostly fixed** | Finish is now computed (D-20, source-based). Still open: `turntableRatingLb` min 500, `axleYieldPsi` max 120 ksi, `tireWidthIn` independent of diameter, D-7 "✅" without a weight caveat. All low. |

## Remaining issues

No high or medium issues.

**1. LOW. Stale / inconsistent hand-calc labels.**
- Location: DECISIONS D-15, D-2 and the hand-calc intro.
- Problem:
  - D-15 still quotes the inner-tire corner as (32.6, ±8.3). That is the round-2 36.5" track value. At 35.5" it is (32.9, ±7.9), which agrees with A-4's y = 7.89.
  - The hand calc calls the lean 13" cart "~84 lb", but W-1 now gives lean 13" ≈ 88 lb (82 lb at 10").
  - D-2 uses 84 → +250 lbf, while 88 lb gives +264 lbf.
  - The default is 119 in the calc and 121 in W-1.
  - A few table roundings are off (v_roll 8.87 shown as 8.8; rear hold +4.7% shown "+4%", +4.4% shown "+5%"). None changes a ✅/⚠.
- Fix: change (32.6, ±8.3) to (32.9, ±7.9). Say "calcs use 84 and 119 lb as round placeholders for W-1's 82–88 and 121 lb", or re-label them 88 and 121.

**2. LOW. Through-axle length uses 41.5" (W-1 and D-10).**
- Location: W-1 axle row.
- Problem: with `axleEndExtraIn` the rod is track + 2·(hub/2 + extra) = 35.5 + 5 = 40.5". The mass error is about 0.2 lb.
- Fix: derive the length in `derived()` when Phase 1 starts. No doc change needed.

**3. LOW. No straddle-window validator and no storage envelope params.**
- Location: `validateParams`, D-6 and D-19.
- Fix: defer to Phase 1. Add `storageLengthIn` and `storageHeightIn` with a volume check. Add the wheelbase ≥ `truckWellLengthIn` + 2·(r + clearance) warning once Q-1 is settled.

**4. LOW. Leftovers.**
- D-7 "✅" two-person lift: 121 lb is about 60 lb each. Add "at ≤ ~85 lb lean; 121 lb is Q-7".
- D-11 still says "the two common sizes" although the param is continuous.
- `turntableRatingLb` min 500 (the brief needs ≥ 1,000).
- `axleYieldPsi` max 120 ksi is too high for 1018.
- W-1's lean column quietly uses a 2" beam on a 10" wheel (3.3" clearance, below the 3.5" limit). D-15 notes the fix, but W-1 should too.

## Bottom line

Every round-2 issue is fixed or reduced to cosmetic items. The A-4 formulas, defaults, 35.5" track and wheel-well logic, W-1, D-20 and the hand-calc table all reproduce independently, and the validator is clean at defaults and catches the new failure modes. No regressions found. The only substantive item left is the 3% to 5% rear-brake traction margin at μ 0.5 (and the failure at μ 0.3), which is documented as a layout driver for Phase 2. Ready for Phase 1.
