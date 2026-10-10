SCORE: 7/10

Phase 1 critic round 2. Method: read BRIEF, DECISIONS (D-21, D-25, W-1, A-4), the round-1 review, and `src/params.ts`, `src/model/**`, `src/truck/**`, `src/viewer/viewer.ts`, `src/ui/*`, `src/main.ts`, `src/style.css`. `npm test` (308 pass) and `npm run typecheck` (clean). Throwaway vitest scripts (deleted) dumped parts, masses, stacks, fit cases and feasible windows. They also swept validator ranges, fuzzed 600 random designs for overlaps, and sampled steer angles. I drove the app at 1100 and 1440 px.

Round 1 went from 137 lb to 119 lb, the seat, bolster and storage are real members, the validator is far stronger, and the viewer has a CG marker and dimensions. But two new defects come from D-25 and from the geometry the allow-list hides, and the truck-fit windows report designs the validator rejects.

## Verdict on the suspicion (truck-fit "beside wells")

**The collision check is correct. Nothing is skipped or mis-bounded.** The numbers are real:

- The cylinder OBB is right. `build-utils.ts:240` rotates the local z axis onto world y, and `bounds.ts:localBounds` gives half-length L/2.
- `axle-R` and `axle-F` are in `prepare()`. They are not `payload`, not `reference`, and not matched by the bridle regex. The default dump shows the rods as limiting pairs: `axle-R/truck-well-L: 1.01`.
- World AABB of `axle-R` is y ±20.25. That is track/2 + hub/2 + extra = 17.75 + 1.5 + 1.0, so the rod is 40.5", not the 41.5" the review quoted. At track 36.5 it is 41.5" and flush with the 41.5" well gap.
- At wheelbase 48 the cart can be placed so both rods sit fore-aft **outside** the wells (x 18-52). At tx = 16.75 the rear rod is at x ≈ 16.4-17.1, which is 0.87" ahead of the well start (x = 18).
- The front rod is at 64.75, behind the well end.
- The reported 1.01 is hypot(0.87 fore-aft, 0.5 lateral), not a lateral gap.
- Only the tires (13" diameter, ±6.5" in x) overlap the well span. Their lateral gap to the well is 20.75 − 19.75 = 1.00.
- Beside mode is therefore a hybrid: the axles straddle the wells fore-aft while the wheels sit partly beside them.

Proof the rods are checked: at wheelbase 30 or 34 (rod forced into the well span, track 36.5) the limiter flips to `axle-R/truck-well-L: 0.00`, with the wheels at 0.50.

What is wrong, in the reporting rather than the collision code:

1. **The track limit contradicts the validator.** The fit window says max beside track 36.5" at WB 48. `derived().maxTrackBesideWells` and the `validateParams` warning (`params.ts:976`) still say 35.5", from D-6's rod-end half-width of 2.5". Neither mentions that the rods sit outside the well span at that wheelbase. Below roughly WB 46 (well length 34 + rod and clearance margins) the 36.5" track is false and 35.5" is the true limit.
2. **`beside` is not a distinct mode.** `okMode('beside')` (`fit.ts:~245`) checks only `besideOk`, a lateral wheel check, with no fore-aft rule for the rods. Say in the UI whether the axle ends are beside or fore/aft of the wells, or add a stricter "all parts beside" mode.
3. **The wheel box is ±2.0" while the rod end is ±2.5" from the wheel centre.** The rod end sticks out 0.5" beyond the tire. That is correct for the real cart, but the 1.00" "wheel gap" is not the clearance that matters. Show the rod-end gap as its own limiter.
4. **The windows ignore `validateParams`.** See issue M1.

## Round-1 status

| ID | Status | Notes |
|---|---|---|
| H1 kingpin through axle | **Fixed, with regressions (see H1/M2 below)** | Kingpin leads by 1.25" and the allow-list no longer contains `axle-F`. Beam wood ligaments around the rod and the kingpin are now ¼" and ⅜", and the clamp plates are mispositioned. |
| H2 mass 137 lb | **Fixed** | 119.2 lb against W-1 ~121. The test band is ±10% of the model's own 119.2, so it is self-referential, not tied to W-1. |
| H3 variant overlap tests | **Mostly fixed** | 32 variants x 3 steer poses, rider clash, ground contact, and validated seat extremes. Gaps: the `steer-stop/bolster` allow-list hides a real defect (H1), and fuzzing finds about 4.7% of validator-clean designs still overlap (M3). |
| H4 truck-fit vs D-23 | **Partial** | Added: max track and wheelbase windows per mode and config, true separation, hinge gap, tall cab wall, tongue-off config. Missing: the stability delta for the track limit; windows that skip validity; a straddle min gap that hides zero fore-aft slack (M1). |
| M1 seat 19 lb | **Fixed** | 5.8 lb: no base ring, frame plus panel back. |
| M2 bolster slab | **Fixed** | Rails 2.5 lb, steering group 10.4 lb. |
| M3 storage | **Partial** | The ply lid and oak rim are real now, but the group is 8.1 lb, up from 7.7 and against W-1's 5.1. |
| M4 axle beams | **Not fixed (accepted)** | 2 x 5.7 lb. Phase 2 sizing; worth a visible flag. |
| M5 turntable load path | **Partial** | Side bearers exist at the beam, 0.31" tall. They are token shims, and the steering stops are wrong (H1). |
| M6 viewer CG and dimensions | **Mostly fixed** | CG ball, drop line and label; dimension overlay; lift weight (107.3 lb). Not done: mass-by-group table. |
| M7 explode | **Partial** | Per-subsystem directions, but every part moves the same distance, so the sides/deck/frame/seat layering is only angular. |
| M8 truck-fit gaps | **Fixed** | Cab wall, hinge gap, and a tongue-off config. |
| L1 hard-coded numbers | **Mostly fixed** | Chine band, seat depth, tongue section, bearer width and clearance are params. Still literal: `STOP_SIZE`, `STOP_GAP`, `CLAMP_*`, brake `SHOE_SIZE`. |
| L2 layout | **Fixed** | Stack at ≤ 1200 px, toolbar in its own bar. Not sticky in stacked mode; at 1100 px the cart is small. |
| L3 truck table | **Fixed** | Per-case cards. |
| L4 screenshots | **Not fixed** | `r1-*` are 800x500 or 432x410, not 1440x900. No section, no full-lock top shot, no straddle-beside shot. |
| L5 minor | **Partial** | The brake lever clearance is unchanged. |

## Issues

### HIGH

**H1. The steering stops bind at about 5.5° of steer, not 40°, and the test allow-list hides it.**
- Files: `src/model/steering.ts:~74-82` (stop placement), `src/model/model.test.ts:20` (`steer-stop-/bolster-` allow-list).
- Problem:
  - The stops are `steer:true` boxes at the beam x (`kx − 0.625`), y = ±(halfY + 0.125 + 0.75) = ±8.44, z 6.875-7.875.
  - They rotate about the kingpin. At 5.5° the left stop first touches `bolster-aft` or `bolster-end-L` (overlap 0.02", rising to 0.23" at 10° and 0.63" at 20-40°).
  - In a real build the cart cannot steer past about 5-6°. The lock check, turning radius and swing derivation all assume 40°.
- Fix:
  - Make the stops bear at lock by construction. Put them on the non-steering chassis or bolster side and a counter-block on the beam, or solve their position for the contact angle at `steerLockDeg`: a stop at radius R from the kingpin should first touch the bolster end rail at exactly lock.
  - Add a test: first steer-stop contact angle is within 0.5° of lock, and no overlap beyond that.
  - Remove the allow-list line. Allow only `contact within tolerance at lock`.

**H2. The front beam has ¼" and ⅜" oak ligaments around the rod and the kingpin, and the clamps are not on the rod (D-25 regression).**
- Files: `src/model/layout.ts:~108` (`beamF` centred at `WB + lead/2`), `src/model/running-gear.ts:~83-90` (clamp x = `b.x ± 0.8`).
- Dump (defaults):

| Item | x range, in |
|---|---|
| beam-F | 47.38-49.88 (thick 2.5) |
| axle rod | 47.63-48.38 (groove 0.75" wide, 0.75" deep) |
| kingpin | 49.00-49.50 |

  - Wood behind the rod groove is **0.25"**. Wood ahead of the kingpin hole is **0.375"**. Both are short grain, 0.5" or less, on the member that carries the tongue pull and bump loads (D-12, D-14). Compression ⊥ governs here (D-4).
- Clamps: plates are at `b.x ± 0.8` = 47.43-48.23 and 49.02-49.82 in x. The rod centre is x = 48.0.
  - One plate sits on top of the rod, offset 0.2" off its axis.
  - The other is 1.4" ahead of the rod and clamps nothing.
  - A U-bolt around a ¾" rod needs both legs at about ±0.5" of the rod centre. A leg at x ≈ 47.5 leaves 0.12" before the beam's rear face.
- Fix:
  - Add a validator rule: `(axleBeamThicknessIn − kingpinLeadIn)/2 ≥ rodR + 0.75` (rod side) and `≥ kingpinR + 0.75` (kingpin side). At defaults that needs thickness ≥ 3.25-3.5", e.g. a 2x4 on edge at 3.5" with the rod and kingpin offset toward the beam centre.
  - Alternatively cap lead near 0.875 and thickness 3.5.
  - Place the clamp plates at `rodX ± (rodR + legGap)`, not at `b.x ± 0.8`.
  - The 3.5" beam adds about 1.5 lb: `beam-F` 5.7 lb goes to about 8 lb.
  - Add a test: wood ligament ≥ 0.75" on both sides of each hole, and the clamps' centroid is within 0.1" of the rod x.

### MEDIUM

**M1. The feasible-window search reports tracks and wheelbases the validator rejects.**
- File: `src/truck/fit.ts:~385-440` (`verdicts` / `scan`). It rebuilds the model at modified params and never calls `validateParams`.
- Defaults: max beside track 36.5" (at 36.5 the validator **errors** "Front tires hit the cabin shoulder at full lock ... ≥ 19.70", is 19.5"), and **max straddle track 51"** (the nose and body would be impossible).
- Also, the stability effect of the larger track, which D-23 and Q-1 ask for, is not computed anywhere. Phase 2's SSF can supply it, but the number belongs next to the track limit.
- Fix:
  - Skip or flag a scan point whose params produce a `validateParams` error, showing "design invalid at this track".
  - Show the tradeoff per window. A cheap proxy that needs no Phase 2: `(T/2)/CG height` from the model CG at the max track.
  - Mark the straddle wheelbase window "no slack" when min = default wheelbase (48 = 48, zero slack).
  - Show the axis-wise margins, not only the corner distance. The straddle case "min gap 1.12" is hypot(0.5 fore-aft, 1.0 lateral): the real fore-aft margin is exactly the 0.5" requirement.

**M2. The swing derivation is over-conservative by exactly `kingpinLeadIn` for the shoulder (`params.ts:~833, 970-973`).**
- `swingRearXIn` is relative to the kingpin, but the shoulder test compares it to `noseTaperStartIn`, which is measured from the front axle. The correct bound is `swingRear − lead + c`. Defaults: required 18.13" against the code's 19.38" (design value 19.5").
- Consequences:
  - Roughly 1.25" more full-width cabin than necessary.
  - Changing `kingpinLeadIn` moves the shoulder rule the wrong way. Lead 0.875 raises clearance to 1.07" and lead 2 errors at the same time.
- The nose-width rule uses the kingpin-relative corner correctly (12.67" allowed against 12.5"). I measured tire-to-nose clearance at lock: 0.83" against 0.75" required.
- Fix: subtract the lead in the shoulder rule (the A-4 formula should name the reference point), and update D-15 and A-4, which still quote the pre-D-25 numbers (nose 14", shoulder 18.5").

**M3. About 4.7% of validator-clean designs still have overlaps.**
- Fuzz of 600 random designs over wheelbase, tracks, deck height, body width, seatX, wheel diameter and lock: 279 passed validation, 13 had overlaps.
- Sample failures:
  - `turntable x transom-front` (0.38-0.63"), `tongue x transom-front` (0.13-0.25"). Both appear when deck height is 7.5-8.1" (e.g. `deckHeightIn=8`).
  - `clamp-R* x rail-cabin-*` (2 cases).
- Fix:
  - Add a validator rule: turntable top, tongue top and bolster against the front transom bottom. The transom spans z 7.75-16.5 at defaults.
  - Add a fuzz test using the existing `overlaps()` in the test file, with a deterministic seed, asserting empty overlaps for every validator-clean design.

**M4. Nose at 12.5" fits a 68" rider with no boot allowance (0.35" per side).**
- Rider feet span y ±5.4, inner nose half-width 5.75; the shin box reaches 5.8" (within the rider-clash tolerance of 0.1").
- The foot stop is at x = 48.0, the toe tip at 47.6" (touching), and the foot reaches 47.6" ahead of the seat. So the layout works for the mannequin, but a scout in winter boots (about +0.5" per boot) does not fit.
- `validateParams` rejects stature 72" (needs 11.8" inside, 11.5" available), which is the right call. The lead cost about 1.7" of nose width (14.25" to 12.5").
- Fix: add a `bootAllowanceIn` param (≥ 0.5" per side) to the foot-span rule. To afford it, either drop lock to 35° (nose then up to about 15.4" at lead 1.25) or lead to 0.875 (about 13.1"). A-1 already floats 35°.

**M5. Side bearers and stops are token geometry (D-12).**
- Files: `src/model/steering.ts`, `layout.ts:sideBearer`.
- Side bearers are 1.5" x 2.5" x 0.31" and weigh 0.04 lb each: a 0.3"-thick wooden shim cannot carry the roll moment. D-12 says the roll moment goes through the rub blocks, so give them real depth (≥ ½" and run on a hardened or UHMW wear strip).
- Pitch moment: the turntable overhangs the 2.5"-thick beam fore-aft by 4.75" each side, and only the bolster rails (not the bearers) sit there.

**M6. Mass: 119.2 lb is credible against W-1 (~121), but it is a pre-joinery number and the test bands are self-referential.**
- Per group (lb):

| Group | Model | W-1 | Comment |
|---|---|---|---|
| running gear | 46.3 | 46.3 | Matches. |
| steering | 10.4 | 9 | OK. |
| frame | 9.5 | 13.9 | −4.4 (nose rails stop at the turntable swing). |
| body | 27.5 | 29 | OK. |
| seat | 5.8 | 5 | OK. |
| storage | 8.1 | 5.1 | +3.0 (box is 1,900 in³). |
| brake | 3.5 | 4 | OK. |
| removable | 4.9 | 3.7 | OK. |
| hardware + lighting | 3.2 | 2.5 | Lump sum. |

- Missing items that real builds carry: fasteners and threaded inserts, hinges and latches, wheel retention, glue fillets, hubcaps, and the kingpin nut and washers. W-1 budgets 3.0 lb for clamps plus fasteners and the model carries 2.8 lb of clamps only. Expect about +4-6 lb in Phase 3, so 120-125 lb is the honest figure, inside D-21's 90-120 upper edge.
- Transport weight is 107.3 lb: 53.6 lb per person for a two-person lift, against D-7's assumed ~45 lb each. Show this tension next to the lift number.
- Fix: pin the test to W-1 per group (±20%) as well as to the model's own value. A deliberate change should update both.

### LOW

**L1. `validateParams` is justified, but the slider ranges are not (seatX range and lock 45).**
- seatX: valid 1.5-16.0 against slider -4..36, so 22 of 40 inches are invalid. Both limits are physical:
  - Low (1.5): `MIN_REAR_STORAGE_LENGTH_IN` = 6" between the transom and the seat back for the rear box. It relaxes with `storageLocation` 1 or 2.
  - High (16.4): the cushion front reaches the shoulder at xs = 28.5.
  - Fix: tighten the `PARAM_DEFS` min and max, or show the effective range under the slider. The messages are good.
- Lock: 41° and up are rejected (the nose would exceed 11.5-12" and the tires hit the shoulder). 45° is impossible at this nose width and lead. A 45° lock gains nothing: at 40° the turning radius is about 57" to the rear axle, and A-1 prefers 35°. The slider max of 50° is dead range from 41° up. Cap `steerLockDeg.max` at 40 or 42.
- kingpinLead: accepted 0.875-1.25 only (2" fails on the turntable overhang plus swing). The slider max is 4. Same remedy.

**L2. Viewer and UX.**
- CG: the 3D marker follows the current view (rider on or off). The summary table is the only place with all three; a toggle for empty, operating or goal would match it.
- CG and dimensions are hidden while exploded (`viewer.ts:310`). Fine; say so in the tooltip.
- Dimension "Height" runs to the AABB top (handle, ornament, 35.9") and "Length" includes the tongue. Fine, but label "overall, installed".
- Explode: every part moves the same distance, so the layering is only by direction. Scale by `step` or layer index.
- Truck view: cards, window rows and Show buttons work. Selecting a case does not scroll to or switch to the Truck tab.
- Mass-by-group table is not in the summary (round 1 M6).
- Stacked layout (≤ 1200 px): viewer, parameters, analysis; usable. The viewer is not sticky, so the cart scrolls away while editing sliders. At 1100 px the viewer is wide but short.
- Performance: `checkTruckFit` plus four builds run on every parameter change; the window search then runs after a 400 ms debounce (75 evals, about 270 ms), yielding between evals. Acceptable.

**L3. Docs and screenshots.**
- `docs/screenshots/phase1/r1-*` are 800x500 or 432x410, below the claimed 1440x900. Reshoot: iso, side, top, front, lock ±40 top, exploded, section y = 0, and truck beside and straddle.
- D-15 and A-4 quote stale numbers (nose 14", shoulder 18.5", swing y = 7.89). The `phase1-spec.md` banner covers the code but not the decisions.
- The tongue is a butt joint into the beam's front face. Pull load is 150 lb (D-14). Phase 3 needs a lap or a through-bolt joint.

## Suggested order for round 3
1. H1 (steer stops at lock) and H2 (beam ligaments, clamp positions), with the matching validator rules and tests.
2. M1 (validate windows, stability proxy, slack and axis margins) and the beside-mode reporting.
3. M2 (swing reference point) and M3 (fuzz test and the deck-height rule).
4. M4 (boot allowance, lock or lead trade), M5 (side-bearer depth).
5. L1-L3 cleanups and the screenshots.
