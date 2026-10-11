# Phase 3 round 2: F3 (brake and metal) notes

Files: `src/model/brake.ts`, `src/analysis/brake.ts` and their tests; brake group in `src/params.ts`; small edits to `src/model/types.ts` (new `Fab` value `'outsource'`), `src/model/model.test.ts` (allowlist, brake mass baseline, track30 case) and `src/analysis/checks.test.ts` (brake-force hand calc).

## Proposed DECISIONS text

**D-38 (amend; supersedes the "μ 0.4, 13.0:1, 19.9 / 23.0 lbf" figures).** The brake lever ratio is still derived from geometry, and the lever tail is now **solved** from it. With `brakeLeverTailAuto` on, the tail is found by bisection so that the critical (de-servo, rolling backward) ratio equals the target × `brakeRatioHeadroom` (12 × 1.1 = 13.2:1), for any wheel size. If the shortest tail (1") cannot reach it (wheels under about 12"), the crank is lengthened; if that is still short, `brake-ratio` fails honestly (10" to 11" wheels, about 3.7 to 9.4:1). Defaults at the 13" wheel: tail 1.76", crank 3.0" at 322° (was 1.9", 2.4" at 315°), forward (servo) ratio 18.9:1, grip travel 6.4" for the 3/8" shoe stroke. Shoe stroke is now 3/8" (was 0.3") so a muddy shoe retracts clear of the tread; the ratchet span is 28° (was 20°) to cover it at 1.5× reserve.

**D-13 (amend, friction).** Each oak pad is faced with a **1/8" woven or molded brake lining** bonded with contact or epoxy adhesive and held by two countersunk stainless screws: μ ≈ 0.45 against a wet tread (`brakePadMu`, was 0.4 "wet oak"). A **mud / slush-fouled case, μ 0.35** (`brakePadMuFouled`), is now pass/fail for the handle force (30 lbf) and sizes every member (`holdMu` = the lower of the two). Bare wet oak (μ 0.25) would need 32 lbf operating and 37 lbf goal; it is reported as an info row to show why the lining exists. Test a lining sample on a wet tire before the build. Pads are 2.5" wide (was 3").

**D-38 (amend, metal work, build M10, M11, M9).** No lathe, mill, broach or welder:
- Arm hubs are **bought 3/4"-bore face-tapped (flange-mount) shaft collars**; the arms bolt to the tapped face. The shaft and each collar are **cross-drilled together on the drill press** and a 1/4" heavy-duty roll pin is driven through (arm collars: one pin; crank: two pins at 90°). No keyseats. The crank is 3/4" × 1.5" A36 bar with the shaft hole drilled and reamed on the drill press (3/8" ligament each side).
- The cross-drilled shaft is checked at net section (diametral 1/4" hole: Z_net = 0.0594 in³, S_net = 0.0180 in³). At 2× the hold load the net-section von Mises stress is 40.2 ksi, which a 1045 shaft at 70 ksi (35 ksi allowable) cannot carry. The shaft is therefore **pre-hardened 4140 ground rod** (`brakeShaftYieldPsi` 100 ksi, allowable 50 ksi, 80% used). The alternative is a 7/8" 1045 shaft, which costs +1.8 lb.
- The ratchet quadrant (1/4" A36 plate) is **outsourced to a waterjet / laser cutting service** (`fab: 'outsource'`); the shop laser and router do not cut steel. The bracket is a bought 2" × 2" × 1/4" angle, cut and drilled, not bent. Arms, crank, pawl, bracket and pin are bandsawed and drilled.
- Every metal part now carries `stock` (section × cut length) and `sourcing`. Oak pad rough length uses the 4× allowance (build M8).
- Corrosion: link, clevises, pivot bolt, pawl screw, shoe pins and springs are 316 or 302 stainless (the zinc clevis and plain rod are gone); the steel (shaft, arms, crank, quadrant, bracket) is galvanized or zinc-rich primer plus paint with an epoxy barrier where it touches oak (note on each part). The sleeve bearings stay SAE 841 bronze.
- No sharp ends at shin height: dome end caps on both shaft ends, an acorn nut on the pivot bolt and pawl screw, capped cotter ends on the shoe pins.

**D-39 (amend).** The push-handle sockets are **6061-T6 aluminum rectangular tube**, 1.25" × 1.75" × 1/8" wall × 6" (0.40 lb each, was 1.17 lb steel: −1.5 lb for the pair), anodized or epoxy-coated and bedded against the transom; allowable 17.5 ksi (35 ksi yield ÷ 2). New rows in `handle-sockets`: tube bending 1,760 psi, bolt bearing on the 1/8" wall 1,709 psi, pin bearing on the walls 640 psi, washer pull-through on the transom 148 psi (limit 358, oak ⊥ grain). All pass with margin.

**Pinch gaps (new, in `brake-clear`).** The lever stands 0.64" off the hull (outside the 3/16" to 1/2" finger-entrapment band) and 0.11" off the ratchet plate (≥ 0.06" so it cannot rub, ≤ 3/16" so a fingertip cannot enter). The old geometry had the plate and the lever overlapping by 0.02" in y; that is fixed (the plate is now placed relative to the lever). A violation fails the row.

## Numbers at the defaults (13" wheel, W = 326 lb operating, 376 lb goal, ratio 13.2:1, η 0.8)

| Case | μ | Operating | Goal | Limit |
|---|---|---|---|---|
| Wet bonded lining (design) | 0.45 | 17.7 lbf | 20.5 lbf | 30 |
| Mud / slush fouled (pass/fail) | 0.35 | 22.8 lbf | 26.3 lbf | 30 |
| Bare wet oak, info only | 0.25 | 31.9 lbf | 36.8 lbf | n/a |

Hand check (goal, fouled): 375.8 × sin 15° = 97.3 lbf; 97.3 / 0.35 / (13.2 × 0.8) = 26.3 lbf.

## Mass

Brake group (`group: 'brake'`, includes the sockets) 12.26 lb → 10.96 lb (−1.3 lb). Sockets −1.53 lb; shorter shaft and narrower pads −0.35; purchased collars −0.1; widened crank boss +0.5; lining, caps and nuts +0.15. Handle posts are in `removable` and unchanged. The brake row in `EXPECTED_GROUP_LB` is now 11.0.

## Open issues and coordination

- **Rear transom (F2).** Socket bolts bear on and pull through `L.side` of oak; if F2 adds a backer or thickens the transom through another param, the pull-through row should read it. The quadrant bracket bolts also pass through the backer. Ask F2 for the backer footprint (sockets at y = ±(hwC − 2"), z 10 to 16; bracket at the left corner, z 13.5 to 14.6) so the three never collide. The static-overlap tests pass at present.
- **Grip travel 6.4"** at the 3/8" stroke and 13.2:1 is long for a hand lever. Dropping `brakeShoeTravelIn` to 0.3" gives about 5.1" but only 0.3" retract. Needs a feel test on the mock-up.
- **Small wheels.** Wheels of 11" and below cannot reach the target even with the longest crank, because the lever pivot height (6.1") and the shaft height (r) are fixed. Default and 12" to 13" are fine; 11.5" gives 12.1:1. The wheel param range is 10" to 13".
- **Bearing plates.** The 1/4" steel bearing plates set in the oak blocks are still noted but not drawn (so not in the cut list): two 3" × 3" × 1/4" A36 plates with a 1-1/4" hole, outsourced. Add to the Phase 4 list.
- **Roll-pin and collar sourcing is by description** (vendor and generic part, no SKU). Confirm a 3/4" face-tapped collar of about 1-1/4" OD exists before ordering; the fallback is a plain clamp collar plus a cross-drilled pin through the shaft and an arm bolted to a drilled flat.
- **Splash shield** between the tire and the shaft (build S10) is not modeled; shoes are stainless-pinned, greased, and retract 3/8".
- **Validator mirror** in `params.ts` (ground-clearance and tire-reach warnings) uses the manual `brakeLeverTailIn` and `brakeCrankIn`, not the solved values; the analysis (`brake-clear`) reports the real ground clearance (3.60" lowest, limit 3.5").
- **In-flight failures not mine** at the last full run: `model.test.ts` "front track and lock sliders are now mostly valid with auto on" and "masses > prints the empty-mass breakdown" (body group 35.3 lb against the 29.7 baseline, F2).
