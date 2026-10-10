SCORE: 8/10

Phase 1 critic round 3 (final). Method: read BRIEF, DECISIONS (D-21, D-25, D-26, A-4, W-1), the round-2 review, `src/params.ts`, `src/model/**`, `src/truck/**`, `src/ui/right-panel.ts`, the viewer/main/style diffs, and the new tests. `npm test`: 345 pass. `npm run typecheck`: clean. Throwaway vitest scripts (deleted; repo clean) dumped the parts and ligaments, bisected the stop contact angle, recomputed A-4 and the turning radius by hand, ran an independent 2 x 3000-design fuzz with a different seed and a wider jitter, swept slider validity, and dumped all 12 truck cases, the feasible windows and the SSF preview.

Verdict: both round-2 HIGH defects are genuinely fixed. The stops contact at lock by construction, the beam has 0.94" ligaments, and the clamps straddle the rod. The remaining problems are in reporting and usability (the straddle preview misleads, and the front-track slider is nearly dead), plus missing checkpoint screenshots. Nothing in the geometry blocks the checkpoint.

## Independent verification at the new defaults (lock 38.5, lead 1.0, nose 13.5, shoulder 18.0)

| Item | My number | Claimed / limit | Result |
|---|---|---|---|
| Stop first-contact angle (post vs `bolster-aft` OBB overlap, bisected) | -0.387" at 30°, -0.061" at 37°, -0.020" at 38°, -0.002" at 38.45°, **0.000 at 38.50°**. L and R identical. | contact at lock | **Verified.** Strictly clear before lock, flat face contact at lock (post axis-aligned). No other chassis contact at lock. |
| Swing inner corner y (kingpin frame) | 15.75·cos38.5 − 7.5·sin38.5 = **7.657"** | A-4 | Correct. The left wheel's rear-inner corner binds, not the right wheel's front-inner corner. |
| Nose limit | 2 × (7.657 − 0.75) = **13.81"**, nose 13.5, so tire-to-nose gap **0.91"** | ≥ 0.75 | OK (0.31" spare). |
| Shoulder | swing rear 18.164 − lead 1.0 + 0.75 = **17.91"**, design 18.0 | ≥ 17.91 | OK, **0.09" spare**. This binds the lock: 39° fails the shoulder rule by 0.01". D-26's "largest lock that fits" is true for the 0.5° step. |
| Turning radius (kinematic: axle centre moves as the kingpin leads, instant centre on the rear axle line) | outer front tire centre **95.21"**, rear centre 60.0" | ≤ 96" | Matches 95.2". **Knife edge**: 38° gives 96.06" (fail), 37° gives 97.8". |
| Beam-F (3.5") x range | 46.69-50.19; rod 47.63-48.38; kingpin 48.75-49.25 | ≥ 0.75" ligament | **0.9375" behind the rod and 0.9375" ahead of the kingpin.** |
| Web between rod groove and kingpin hole | 48.75 − 48.375 = **0.375"** | not ruled | Not covered by the ligament rule (carry item 3). |
| Clamps (front) | plate centres 47.375 and 48.625; rod x = 48.000 | rod ± (rodR + 0.25) | **Straddles the rod**, symmetric, tested. |
| Boot rule | foot span (2·0.05 + 0.06)·68 = 10.88; need 10.88 + 1.0 + 0.25 = 12.13; inner nose 12.5 | OK | 0.81" per side to the side panel, 0.5" boot + 0.31" play. Rider stature 72" is correctly rejected. |
| Mass | **122.1 lb** (running gear 48.6, body 28.0, steering 10.5, frame 9.5, storage 8.1, seat 5.9, removable 5.0, brake 3.5, hardware 2.5, lighting 0.7) | W-1 ~121 | OK. Lift weight (removables off) **110.1 lb = 55 lb per person**. |
| Loaded CG / SSF | operating rider + cargo: CG (16.4, 0.05, 15.08); SSF = 17.75/15.08 = **1.177** | UI shows 1.177 | The UI preview matches my number. |

## Round-2 issues

| ID | Status | Notes |
|---|---|---|
| H1 steering stops bind at 5.5° | **Fixed.** | Contact exactly at ±38.5°, verified by bisection (table above). The allow-list line is gone. The sweep test steps 0.5° and asserts strict clearance until the last half degree. |
| H2 beam ligaments and clamps | **Fixed.** | Ligaments 0.94"/0.94" (equal, because the beam is centred on the rod + kingpin pair). Validator rule, clamp-straddle test and ligament test all present. Beam-F grew to 7.9 lb (+2.2 lb; budget it). |
| M1 windows vs validator | **Fixed, with a reporting hole** (see C1). | The scan skips validator-rejected points and names the validator as the limiter. It now says max beside track 35.75" (shoulder rule at 36"), against the old 36.5". |
| M1 straddle "no slack", axis margins | **Fixed.** | Cards show slack (`straddle|nose-bulkhead|removed` correctly says 0), per-axle tire and rod-end fore-aft gaps, and hinge gap. |
| M2 swing reference | **Fixed.** | `swingRearBehindAxleIn` = swingRear − lead. The tire-to-shoulder gap at the limit equals 0.75" exactly (tested). D-26 supersedes the old numbers. |
| M3 deck-height / fuzz | **Mostly fixed.** | Transom rule and clamp rule added; a seeded 300-design fuzz exists (84 clean). My independent fuzz found 2 residual overlap classes in ~600 clean designs (carry item 4). |
| M4 boot allowance | **Fixed.** | `bootAllowanceIn` 0.5" per side, in the validator. The cost is lock 40 to 38.5 and a turning radius that is now marginal. |
| M5 side-bearers | **Mostly fixed.** | Roll path is real: 1.5 x 1.5" oak blocks, 0.75" embedded, 3/16" UHMW wear, 1/16" clearance to the bolster end rail. **Pitch is still unaddressed** (carry item 2). |
| M6 mass | **Fixed** (mass-by-group table in the UI). | The test band is still self-referential against `EXPECTED_EMPTY_LB`; low. |
| M7 explode | **Partial (acceptable).** | Distance now scales with distance from the CG (0.25-1.5x), so layering is better. It is not by assembly step. |
| L1 slider ranges | **Partial.** | seatX, lock and lead are tightened (lock slider 30-40, 86% valid). But `frontTrackIn` is only **3% valid** and `noseWidthIn` 12% (see C1). |
| L2 layout | **Fixed.** | The stacked viewer is sticky at 45vh. |
| L3 docs | **Mostly fixed.** | D-26 supersedes D-12/15/25 and A-4. D-7 still says ~107 lb / 54 lb each; the model says 110.1 / 55. |
| L4 screenshots | **Not fixed.** | `r2-*` is two images (800x500 and 432x430): no iso/side/front, no section, no truck-fit shot, no exploded view. |

## Must fix before the Phase 1 checkpoint

**C1. [MEDIUM] The Truck view's stability preview misleads about straddle (D-23, Q-1), and the front-track slider is a trap.**
- Files: `src/truck/fit.ts` (`computeFeasibleWindows`, the `ssfAtMax` and `maxTrackBedOnlyIn` fields), `src/params.ts` (`frontTrackIn`, `noseWidthIn`).
- Straddle at the defaults reports "max track 35.75" · limited by the validator. Bed alone would allow ~51"" and an SSF preview of **1.177 → 1.185**.
- That implies straddle buys nothing. The real tradeoff is T/2/h = 22/15.1 = **~1.45 at a 44" track** and 25.5/15.1 = **~1.69 at 51"**.
- The validator caps the track at 35.75" only because the nose width and shoulder were tuned for 35.5". The cap is an artefact of fixed dependent params, not a physical limit.
- `frontTrackIn` is valid over 35.25-35.75" of a 26-52" slider, and `noseWidthIn` over 13.25-13.75". Eric dragging the headline parameter at the checkpoint hits a wall of red errors.
- Fix (cheap):
  - (a) In the window search, also report SSF and CG height at the bed-only max track (the model builds fine there), labelled "needs nose width and shoulder re-derived".
  - (b) Show the effective valid range under the `frontTrackIn` and `noseWidthIn` sliders, as the seatX fix did. Better: add an "auto" option so `noseWidthIn` and `noseTaperStartIn` are derived from `derived().swing*` when the track or lock changes. Without it, the Phase 2 track sweep needs hand repair at every point; the fuzz test already repairs them with exactly that code.

**C2. [LOW-MEDIUM] Screenshots do not meet the checkpoint.**
- BRIEF §10 asks for "screenshots from several angles, weight/CG, truck fit". There are two `r2-*` images, both under 1440x900.
- Needed at ≥ 1440x900: iso (CG shown), side, front, top at full lock (±38.5), exploded, section y = 0, and the truck-fit beside and straddle placements.
- The existing top shot is 432 px wide and crops the toolbar.

**C3. [LOW] Refresh the stale documentation numbers.**
- D-7 says ~107 lb / 54 lb per person; the model says 110.1 / 55.
- W-1 and the D-21 expectation of 90-120 lb do not mention that the model is now **122.1 lb**, with an honest +4-6 lb of fasteners still to come (about 127 lb).
- State the lift weight next to the number in the UI, and note that two scouts cannot lift it (Q-7).

## Fine to carry into Phase 2/3

1. **Stop-post mounting (Phase 3).**
   - The posts are modelled `steer:true` and stand on the turntable's top plate, which is the chassis-side plate in a real lazy susan (the bolster rails sit on the same plate). A post that rotates with the beam must bolt to the lower plate and reach up through a cut-out.
   - Phase 3 must split the turntable into a lower and an upper plate. Also check the stop bearing in Phase 2: a 150 lbf pull at a 24" tongue gives roughly 3,600 lb-in about the kingpin, about 950 lbf at the 3.8" stop arm, on a 1.5" x 1" face.
2. **Pitch moment path (Phase 2/3).** The side bearers sit at the kingpin line (x ≈ -0.4 to +1.1" from it), so they give roll support only. Fore-aft pitch from the tongue and braking goes through the turntable, which D-12 says is not moment-rated. Add fore/aft bearer blocks, or confirm the bearing's moment rating.
3. **Groove-to-kingpin web (Phase 3).** The web between the rod groove and the kingpin bore is **0.375"** of short-grain oak at the point where the tongue pull reacts into the rod. The ligament rule only covers the outer faces. Add a rule: web ≥ 0.5", or lead ≥ rodR + kpR + 0.5 = 1.125".
4. **Fuzz residue (low).**
   - A wheelbase of 40.5" with a 14" rear overhang (otherwise valid) overlaps `foot-stop` and `transom-front` by 0.375". The foot stop is at x = 48.38, fixed by the seat, and the rule compares the feet to the body's outer front rather than the transom's inner face. Fix: `seatX + legReach + footStopDepth ≤ WB + frontOverhang − side`.
   - A flared chine (bodyWidth 25, sideHeight 4.5, flare 1) overlaps its web by 0.053" (tolerance 0.05).
   - The repo fuzz jitters 28 of ~120 params at ±20% and checks only neutral and ±lock; despite its title it never builds the transport (removed) config. Add a removed-config pass, more seeds, and rider stature, back angle and storage volume.
5. **Turning radius margin.** 95.2" against 96" is 0.8" of margin, and only at lock ≥ 38.5° (38° gives 96.06"). Phase 2 should either report it as marginal or give back nose width, which is the lock limiter along with the shoulder at 0.09" spare. The D-26 note is honest about this.
6. **Clamps (Phase 3).** The front U-bolt plates sit on top of the beam beside the rod. For an underslung beam the legs run down through the wood and the plates belong on the underside. The leg gap of 0.25" implies an oversized (1") U-bolt that must be sourced or machined.
7. **Tongue joint.** Still a butt joint at the beam's front face, with 150 lbf design pull (carried from round 2). It needs a lap or through-bolt.
8. **Mass test** is still pinned to the model's own value (`EXPECTED_EMPTY_LB`). Phase 3 should re-baseline it against the real fastener list.
9. **UX nits.** Explode is by distance from the CG, not by assembly layer. CG shows the current view's rider state, not a fixed case. Dimensions say "overall".

## Score rationale (8/10)

The geometry, validator and test discipline are now solid. Every one of my independent checks (stop contact, A-4, turning radius, ligaments, clamps, SSF preview, boot rule) agrees with the code to better than 0.01". The remaining weaknesses are presentation and exploration: the straddle preview understates what the track buys, the front-track slider is almost dead, and the screenshots are thin. They are cheap to fix and none touches the model. Proceed to the checkpoint once C1 and C2 are done.
