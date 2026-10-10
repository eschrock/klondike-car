SCORE: 8/10

# Phase 0 review, round 2

Scope: `BRIEF.md`, `docs/reviews/phase0-round1.md`, then `src/params.ts`, `src/model/types.ts`, `DECISIONS.md`, with a skim of `src/model/index.ts` and `src/params.test.ts`.

Checks run:
- `npm test`: 134 pass.
- `npm run typecheck`: clean.
- `validateParams(defaultParams())` returns `[]`, confirmed by a scratch script, not only by the unit test.
- Every `ref` in `params.ts` resolves to a DECISIONS entry (D-1…D-19, A-1…A-3, W-1, Q-1, Q-2).

Summary: the round-1 structural problems are mostly closed. That covers the weight narrative, the deck, vertical stack and nose geometry parameters, the cross-parameter validator, the schema, and the missing decision entries. Two things hold the score at 8:
- the hand-calc section was not re-run at the new honest mass, so a default "✅" is now wrong;
- the D-15 swing-clearance rule exists only as prose, so no check enforces it.

## Numbers I re-derived (round 2)

| Item | My result | Verdict |
|---|---|---|
| W-1 non-wood, default: 22 + 10.4 + 4 + 3 + 2.5 + 2.5 + 2.5 | 46.9 | OK |
| W-1 non-wood, lean (10"): 16 + 7.1 + 4 + 2.5 + 1.5 + 2 + 2 | 35.1 | OK |
| W-1 wood rows, default | 68.4; +5% = 71.8 | OK |
| W-1 wood rows, lean | 41.2; +5% = 43.3 | OK |
| W-1 total | 118.7 / 78.4 (10") / 84.4 (13") | Sums are right |
| Axle steel: ¾" × 41.5" | 5.21 lb each, so 10.4 lb for two | OK |
| Axle steel: ⅝" × 41.5" | 3.62 lb each, so 7.2 lb for two (doc 7.1) | OK |
| Deck, 9 mm okoume on about 1,480 in² (narrow nose) | 10.0 lb (doc 11.0 with rabbets) | Plausible |
| Rails 2 × ¾ × 3 × 66 | 8.08 lb | OK |
| D-15 stack: beam 4.375–6.875, + turntable 0.375 + crossmember 1.75 + ply 0.354 | 9.354 in | OK; deck 9 + 0.5 raise = 9.5 gives 0.15 in slack |
| D-15 rear: beam top + ply | 7.23 in against a 9 in deck | OK |
| D-15 swing: rear inner tire corner (−6.5, 16.25) rotated 40° | (−15.42, 8.27) | OK; a 14 in hull leaves 1.27 in per side |
| Swing, outer rear tire corner | (−18.0, 11.33) | See issue 3 |
| A-1 outer edge distance at the CG | 16.9 in | OK |
| A-1 CG radius | 5.0 ft | OK |
| A-1 rollover speed, 150 lb | 8.87 mph = 1.48× | OK |
| A-1 rollover speed, 200 lb | 8.65 mph = 1.44× | OK |
| A-1 required lateral acceleration for 18 mph at 5 ft | 4.3–4.4 g | OK |
| Full-lock tip, inner edge | 16.0 in → 44.9° | OK |
| Rear-centre turn radius | 57.2 in | OK |
| Outer front tire centre radius | 92.9 in = 7.74 ft | OK |
| Outer front tire edge radius | 94.9 in = 7.91 ft | OK |
| Brake ratio needed, 200 lb, cart 67 lb | 7.87:1 | Matches "7.9" |
| Brake ratio needed, 200 lb, **cart 119 lb** | **9.27:1** | **The 9:1 default fails** (issue 1) |
| D-19 "+23 lb of rear load" | **+8 lb** | **Wrong** (issue 2) |

Brake and traction at 15°, nose-down, μ_tire 0.5, shoe μ 0.4, 30 lbf at the handle, η 0.8, ratio 9. Cargo is at x = 0 in the "rear" rows. My assumptions: cart CG x = 23", cart CG height 8.5", rider CG at x = 16 and z = 20.5".

| Cart mass | Rider | Required ground force | Shoe capacity | Rear μN, cargo mid | Rear μN, cargo at rear | Result |
|---|---|---|---|---|---|---|
| 67 lb | 150 | 62.6 | 86.4 | 62.6 | 66.7 | Hand-calc case; passes |
| 67 lb | 200 | 75.6 | 86.4 | 75.9 | 80.1 | Passes |
| 84 lb (lean, 13") | 150 | 67.0 | 86.4 | 66.4 | 70.5 | Passes by about 5% at the rear |
| 84 lb | 200 | 80.0 | 86.4 | 79.7 | 83.9 | Passes by about 5% |
| 119 lb (default) | 150 | 76.1 | 86.4 | 74.4 | 78.5 | Rear passes by 3% |
| 119 lb | 200 | 89.0 | **86.4** | 87.7 | 91.9 | **Shoe capacity fails**; rear passes by 3% |

## Round-1 issue status

| # | Round-1 issue | Status | Evidence / remainder |
|---|---|---|---|
| 1 | W-1 weight narrative contradicted its own numbers | **Fixed** | Full line-item table, honest default (about 119 lb) and lean (78–84 lb), levers with lb saved, and Q-6. The arithmetic reproduces. Residual: the hand calcs still use 67 lb (new issue 1). |
| 2 | No deck or frame structure params | **Mostly fixed** | Added `frameStyle`, `sideConstruction`, `crossmemberSpacingIn`, `crossmemberDepthIn`, and ply E and MOR per species. Residual: no rail count or spacing, and no validator that links ply thickness to joist spacing (6 mm at 24" passes silently). Acceptable for Phase 0. |
| 3 | Vertical stack at the axles unmodelled | **Mostly fixed** | `turntableThicknessIn`, `axleBeamPosition`, `frontDeckRaiseIn` and `minGroundClearanceIn` are added. The stack is validated and D-15 numbers reproduce. Residual: rails are not in the stack (issue 8). There is no `kingpinOffsetX`, and the strap or U-bolt height over the beam top is not counted. |
| 4 | Nose width 16" had no clearance at 40° | **Partially fixed** | Default is 14" (1.27" clearance), and `noseTaperStartIn` and the D-15 formula are added. There is no `steeringClearanceIn`, and nothing in `validateParams` enforces the swing (issue 3). |
| 5 | Storage box vs rider legs | **Mostly fixed** | Storage moved aft over the rear axle (D-19), and the 1,800 in³ is itemised. Residual: no storage envelope params, and the box geometry is not checked (issue 5). |
| 6a | Brake ratio 7:1 had no margin | **Partially fixed** | `brakeEfficiency` 0.8 is added, ratio 9, and D-13 documents it. It is correct at 67 lb but fails the 200 lb goal case at the 119 lb W-1 mass (issue 1). |
| 6b | Rear-only traction at zero or negative margin | **Partially fixed** | Cargo moved aft, options listed, and the failure documented. There are still no `parkingChock` or `brakedAxles` params. The D-19 quantification is wrong (issue 2). |
| 6c | A-1 threshold chosen without checking it passes | **Fixed** | A-1 now states 1.48× / 1.44×, uses the outer edge, and is marked ❓ and Q-3. A-3 computes both edges. Suggestion in issue 6. |
| 7 | No cross-parameter constraints | **Mostly fixed** | `validateParams` covers about 12 rules, and the old problem combinations are caught. Gaps: no swing clearance, no `maxTrackBesideWells` check, no straddle-window check (issues 3 and 4). |
| 8 | Missing params for §7 and the sim | **Mostly fixed** | Added `riderCgAheadOfHpointIn`, `steelMoePsi`, `kingpinYieldPsi`, oak compression ∥ and ⊥, `pullForceLbf`, `pullerHandHeightIn`, `rearHandleHeightIn`, `axleEndExtraIn`, and thresholds. Still missing: oak tension ⊥ / cleavage, bridle geometry, seat width and depth, grab-handle and foot-stop geometry, and the sim scenario table (Phase 2). `axleEndExtraIn` is not used anywhere (issue 4). |
| 9 | Hard-coded ply density, no ply properties or side option | **Fixed** | Species-specific density, E and MOR are in params, and `sideConstruction` is added. Not added: nominal vs actual ply thickness, and ply shear. |
| 10 | D-14…D-19 missing and dangling refs | **Fixed** | D-14 to D-19 exist, and D-16 sources both μ values and the clearance. `ref` is a field on `ParamDef`. |
| 11 | Dynamic factor excluded the cart mass | **Fixed** | D-2 now includes cart mass × 3 for axle, beam, kingpin and turntable. The "+210–250 lbf" figure is stale (issue 1). |
| 12 | Wheel mass independent of diameter; 11–12" unavailable | **Partially fixed** | Separate 10" and 13" masses, and `derived()` picks the correct one. Diameter is still limited to the two options, although brief §4.4 says "10–13 in, make it a parameter". D-11's claim that these are "the two common sizes" is shaky. A 4.10/3.50-5 (about 11") wheel exists and I believe it is common (not sourced). |
| 13 | `steerAngleDeg` was design state | **Fixed** | Removed from params. C-6 documents it as view state, `buildModel` takes `ViewState`, and the angle is clamped to lock. |
| 14 | Truck params and D-6/D-8 arithmetic | **Mostly fixed** | Well start and length, bed width, wall height and load height are added. D-6 now says "48" with zero slack" and D-8 is corrected to 82". Cab and liner are in Q-1. Still: `truckClearanceIn` min 0, and no tailgate gap or thickness. |
| 15 | Schema could not express articulation | **Fixed** | `RigidBody` (chassis / steer / wheel-xx / rider / cargo / truck), `explode`, `partNo`, and the kingpin transform in `buildModel`. The pivot is implicit (kingpin at (wheelbase, 0)); fine for Phase 0. |
| 16 | Schema gaps for acceptance criteria | **Mostly fixed** | Added `edges`, `grain`, structured `Joint` with `at`, one Part per instance (C-5), `AssemblyStep` and `CheckResult`. Leftovers: `payload`, `group: 'reference'` and `kind: 'reference'` are still redundant, there is no finish-area field, and `CheckResult.pass` is boolean only (see issue 9). |
| 17 | Material allowances | **Not fixed** | Finish is still 5% and unsourced (epoxy plus varnish is likely 8–10% of wood). Low. |
| 18 | Range and default nits | **Partially fixed** | `deckPlyIn` max is fixed, and A-2 states its reference. Still open: `turntableRatingLb` min 500 (the brief needs ≥ 1,000), `axleYieldPsi` max 120 ksi, and `tireWidthIn` independent of wheel size. |

## New issues, prioritized

### HIGH

**1. Hand calcs are still at the old 67 lb cart, and the "✅" on the brake default is wrong at the W-1 mass.**
- Location: DECISIONS.md "Stability & brake hand calcs" and D-13; also D-2 ("+210–250 lbf") and D-14 (the 290 lb used for rolling resistance).
- Problem: W-1 says the default build is about 119 lb (84 lb lean, 13"). The calcs still use 242 / 292 lb totals, which means a 67 lb cart. At 119 lb:
  - the 200 lb case needs 89.0 lbf ground force, which is 9.27:1 at 30 lbf and η 0.8;
  - the default 9:1 delivers 86.4 lbf, so it fails by 3%;
  - the 150 lb case needs 7.9:1 and passes.
- Also: D-2's +210–250 lbf matches 70–83 lb. Cart × 3 at 119 lb is 357 lbf, of which the sprung part is about 260 lbf.
- Fix:
  - Re-state the whole calc block for one named configuration. Either the lean 13" build (84 lb), or the default 119 lb build with a note that it is hypothetical.
  - State the assumed cart CG x and z (I used 23" and 8.5").
  - Choose a brake ratio from that mass: ≥ 10:1 for 119 lb, or keep 9:1 and say it is valid only for ≤ 100 lb.
  - Update D-2 and D-14 accordingly.

### MEDIUM

**2. D-19's traction claim is double-counted.**
- Location: DECISIONS.md D-19 and the "⚠️ Rear-only traction" bullet.
- Problem: it says the 25 lb box over the rear axle "adds ~23 lb of rear load". The 25 lb of cargo is already in W = 242 and in the "CG ≈ 18"" baseline.
  - Back-solving that baseline puts the cargo at about x = 16.6".
  - Moving it to x = 0 adds only about 8.4 lb at the rear axle (125 → 133.5 lb; μN 62.6 → 66.7 lbf; +6.5%).
  - That is not the "≈ even" outcome the text implies.
  - The direction is right: cargo over the rear axle does help.
  - At the honest 119 lb mass the margin is 3% at both riders (150 lb: 74.4 → 78.5 against 76.1; 200 lb: 87.7 → 91.9 against 89.0). At μ 0.3 it fails regardless.
- Fix: state where the cargo sits in the baseline CG. Replace "+23 lb" with the actual delta, and quote margins at the W-1 mass. Say plainly that the benefit is a few percent, so the parking options (chock, front pin, park across slope) still matter.

**3. The D-15 swing-clearance rule is prose only, and the "taper" is really a step.**
- Location: `validateParams` (params.ts ~685–741), params `noseWidthIn`, `noseTaperStartIn`, `steerLockDeg`.
- Verified by scratch run: `noseWidthIn` 16 or 20 with `steerLockDeg` 50 returns no issues.
- Missing: nothing computes the swing, and there is no `steeringClearanceIn` param.
  - At 50° lock the inner rear tire corner reaches only y = a·cosδ − r·sinδ = 10.45 − 4.98 = 5.5".
  - So the hull would have to be about 11" wide, but the validator is silent.
- The default is also a step. The outer rear tire corner swings to (−18.0, 11.33).
  - A hull that is 28" wide up to x = −18 with a taper after it already contains that corner (y = 11.3 < 14).
  - The shoulder must be a near-square step at x ≈ −18, with a narrowing at ≤ 10.3" half-width at x = −18 and ≤ 7.3" at x = −15.4.
  - A 45° chamfer from 14" half-width to 7" half-width would need `noseTaperStartIn` ≈ 23–24", which puts the shoulder near the rider's knees.
- Fix:
  - Add `derived.noseSwingHalfWidthIn = (frontTrack/2 − tire/2)·cosδ − wheelRadius·sinδ`.
  - Add `derived.noseSwingStartIn = wheelRadius·cosδ + (frontTrack/2 + tire/2)·sinδ` (taper start must be ≥ this, about 18.0 at defaults).
  - Add `steeringClearanceIn` (default 1.0) and `noseTaperLengthIn`.
  - Add a validator error when `noseWidthIn/2 + clearance > noseSwingHalfWidthIn`.
  - Cite the formula as A-4.

**4. `maxTrackBesideWells` is computed but never used, and axle-end protrusion is ignored.**
- Location: `derived()` and `validateParams`; `axleEndExtraIn`.
- Verified by scratch run: `rearTrackIn` = `frontTrackIn` = 40 returns no issue, although the 36.5" limit is stated in D-6 and `rearTrackIn`'s note.
- Axle ends: hub 3" and tire 4" gives 0.5" of tire face beyond the hub end. `axleEndExtraIn` 1" then puts the collar and cotter 0.5" proud of the tire face on each side, assuming the hub is centred.
  - Overall width becomes 36.5 + 4 + 1.0 = 41.5", which is zero clearance to the 41.5" gap, not the 0.5" per side that D-6 claims.
- Fix:
  - Add `derived.overallWidthIn = track + max(tireWidth, hubLength + 2·axleEndExtra)`.
  - Add `maxTrackBesideWells` as a warn (not error, because of the straddle option).
  - Add a straddle-window check: wheelbase ≥ `truckWellLengthIn` + 2·(r + clearance) = 34 + 14 = 48" at defaults, with zero slack.

**5. Storage geometry is not verified, and there are no envelope params.**
- Location: D-19, `storageVolumeIn3`, `storageLocation`.
- Problem: the box sits behind the backrest, over the rear axle.
  - From x = −10 (body end) to about x = 9 (behind the backrest at H-point 12) it is about 19" long, and about 26" wide.
  - 1,800 in³ over a 494 in² footprint is 3.6" interior height.
  - That is a flat tray. The 4 L water container in D-19's own inventory will not fit.
- Fix:
  - Add `storageHeightIn` and `storageLengthIn`.
  - Let the box rise above the side height as the seat-back base, or choose a different shape.
  - Add a validator that checks volume against length × width × height.

**6. A-1's replacement criterion is only partly meaningful.**
- Location: DECISIONS A-1 and `rolloverSpeedFactor`.
- At μ 0.5 and CG radius 5.0 ft, the cart slides sideways at v = √(0.5 · 32.2 · 5.0) = 9.0 ft/s = 6.1 mph. That is about the jog speed, long before the 8.9 mph rollover speed.
- So "1.5 × jog" on rollover speed says nothing useful, and what the owner can actually act on is the traction limit.
- Fix: propose a criterion that is physically meaningful and passes: SSF = (T/2)/h ≥ 1.5 × μ_ground. At μ 0.5 the limit is 0.75; the cart is at 1.05 (150 lb) and 1.0 (200 lb). Keep the speed plot as information. Put that in Q-3.

**7. Wheel diameter is limited to 10" and 13".**
- Location: `wheelDiameterIn` options, D-11, brief §4.4.
- Fix: either add 11" and 12" options with their own masses, or restore a continuous range with `wheelMassLb` derived from diameter (e.g. mass per inch). Or note in D-11 that it was a deliberate restriction and ask Eric (Q-4).

### LOW

**8. Rails are missing from the D-15 vertical stack.** 3" rails with the top at the ply bottom run z = 5.65–8.65 in. They contain the axle (z = 6.5) and the front beam top (6.9). The rod must pass through a hole in the rail, and in the nose zone rails at ±7" cannot cross the front beam. Add one sentence to D-15 saying where the rails end and how the rod passes through them.

**9. `CheckResult.pass` is boolean.** It cannot express report-only checks (CG, empty weight, turn radius "aim ≤ 8 ft") or a "marginal" state. Add `status: 'pass' | 'fail' | 'marginal' | 'info'`.

**10. Lean recipe vs ground clearance.** With the 10" wheel and a 2" beam the bottom is 3.31–3.375", below the 3.5" in D-16. The validator warns, but W-1's "lean" column ignores it. Note it in W-1.

**11. Placeholder deck.** `src/model/index.ts` uses `d.overallLengthIn` (82", includes the tongue) with `deckX` computed from the body, so the deck spans −18…64 instead of −10…56. The UI mass is off. Use `bodyLengthIn`.

**12. Small items still open.** `turntableRatingLb` min 500, `axleYieldPsi` max 120 ksi, `tireWidthIn` independent of wheel size, 5% finish allowance unsourced, `riderLegReachIn` not tied to `riderStatureIn`, D-7 "✅" two-person lift against 84–119 lb (56 lb each for the 113 lb stripped default), and W-1 omits grab handles, side-bearer or rub blocks and steering stops (about 2 lb).

## Questions

Q-1…Q-7 are good. Add two:
- Cab and liner (already in Q-1), and the actual storage layout (issue 5).
- Whether lifting at 84–119 lb by two scouts is acceptable (D-7, Q-7).

## Bottom line

This round is a clear improvement: the weight table, D-15 stack, swing numbers, A-1 numbers, validator and schema all check out. The remaining work is a re-run of the hand calcs at the W-1 mass (that is when the brake default fails), and moving the D-15 swing rule from prose into `derived()` and `validateParams()`. After that the deliverable is ready for Phase 1.
