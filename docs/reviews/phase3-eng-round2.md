SCORE: 7/10

# Phase 3 engineering critic, round 2

Scope: working tree at `main` (15759b7 plus an uncommitted one-line `DECISIONS.md` edit). `npm test` 964 pass (26 files), `npm run typecheck` clean, `validateParams(defaults)` returns no issues. Every number below is either read from `runChecks(defaultParams())` or from throwaway perturbation scripts (kept in the session scratchpad, not in the repo). Where I give a number of my own (not from the code) I say so.

**Why 7 and not 8.** Round 2 closed all four round-1 must-fixes by redesign rather than by relabeling, and most of the should-fixes. The notes are honest. A competent engineer would not sign off yet, for three reasons:

1. The front-end row that sets the 200 lb limit (`kingpin-bolts`, 0.985 at the goal rider) has no tolerance. It passes only if three inputs hold: a 0.005" stop fit-up, a pad modulus within about 2x of 1,500 psi, and full-thickness bearing in a carrier that is drawn with flush flat-head screws. Each flips the goal row to fail. Two of them make the 150 lb row marginal or failing.
2. One stop-dog joint (the riser screws, 2.6 kip each) has no bearing or edge-distance row. By the repo's own steel bearing rule it is 1.4x to 3.4x over.
3. Two claims in the documents are not true of the code: D-44 "the nose section is the minimum" (the analysis reads the sheered gunwale at full bow height), and the pitch path (S-4), which is unchanged from round 1.

Fix the three MUSTs and the grade is 8.

## 1. Round-1 verification

"Fixed" means I confirmed it in the code and the numbers, not in the notes.

| Round-1 finding | Status | Evidence |
|---|---|---|
| **MF-1** 60/40 share not buildable; add bounding row; feed stop reaction to the pin | **Fixed in structure, not in robustness** (see N-1) | Urethane pads, k = E·A/t = 1500 × 2.567 / 0.25 = 15,403 lbf/in (hand check agrees), share computed = ½ + k·δ/2P = 0.523 (`front.ts:143,165`). `steer-stops-bound` exists (`front.ts:284`, 0.886 at goal). Net force enters every pin row through `pinLoads` (`front.ts:117`). But the 0.52 depends on δ = 0.005" (`params.ts:822`). |
| **MF-2** dogs bolted through the lazy-susan plate | **Fixed** (relies on an assumed 6.25" center hole) | Dogs are channel + riser + arm on the carrier inside the hole (`steering.ts:249-298`, `model/stops.ts`). Arm corner clearance is enforced by `validateParams` (`params.ts:2110`). The hole size is `assumed`; no vendor part is named. |
| **MF-3** 1,700 psi dowel allowable overstated | **Fixed by removal** | The pin runs in a steel sleeve and bears on steel plates (`front.ts:318-355`). `kingpin-peak` is an info row (`front.ts:488`). The oak now sees only bolt groups. The new rows have their own problems (N-2). |
| **MF-4** cleavage check 3-4x unconservative | **Fixed** | NDS 3.4.3.3 form `V_r = ⅔F'v·b·d_e` = 662.8 lbf against about 1,280 lbf pushed (`front.ts:579-590`). Four ⅜" 316 cross-bolts are designed to carry all of it: 320 lbf each, 3.9 ksi of 32.5 ksi, washers 142 of 358 psi. The 850 psi rows are gone. The web row at 200 of 318 psi is a leftover and conservative (the load does not go through that ligament any more). |
| **S-1** tests recompute the code's formulas | **Mostly fixed** | `front.test.ts` pins literals: 534.8 lbf, 1.2809, ΣY² = 101.318, 15,403 lbf/in, r_eff 4.429". `brake.test.ts` works hold force and ratio by hand. Remaining weakness: H is read back from the code (`front.test.ts:222`), so the load side is still self-referential. |
| **S-2** turntable 0.97 / kingpin-strike 0.95 | **Fixed** | Preset 2 (1,500 lb) with `frontDeckRaiseIn` 1.0. `turntable` 0.70, `kingpin-strike` 0.68. |
| **S-3** brake ratio not solved; wet μ | **Fixed** | Tail solved by bisection to 13.2:1 (hand: (22.57/1.75)·(1.84/1.80) = 13.18). Bonded lining μ 0.45 wet and 0.35 fouled are both pass/fail. Hold at the goal: 386.6·sin15°/0.35/(13.2·0.8) = 27.07 lbf (hand agrees). |
| **S-4** pitch couple path | **Not fixed** | `front.ts:539` still routes M_p "through the turntable plate margins" between the bolster rails. The margins touch nothing. The carrier is now 2.5" wide under a 12" bearing (N-5). D-32 is unchanged. |
| **S-5** forward finger wedge | **Not fixed** | Guard still covers x 26.4-31.6 only, top and rear (`guard-L/R` in the parts list). No analysis row; D-37 still says "the open forward side is not closed" (N-9). |
| **S-6** rod flush, nut allowance, rear U-bolts | **Partial** | Front nut 3.60" (validator keeps it). The front rod is still flush with the beam top (axle z 6.125-6.875, beam top 6.875), so the U-bolt bridge cannot clamp the rod. Rear clamps are still mass-only boxes (`running-gear.ts:146-156`, "Mass is an estimate"). |
| **S-7** lift share and row | **Fixed as a check; the number got worse** | `lift` row exists, CG-weighted: rear 77.4 lb, front 73.7 lb (`hull.ts:40`); σ = 3,713 of 6,460 psi. Per-person load is on one hand (O-1). |
| **S-8** galling in honed sleeve | **Fixed** | Unthreaded grade 8 pin over the grip in a 1¼" sleeve (D-35 text, `steering.ts` kingpin part). |
| **S-9** lash withdrawal | **Fixed** | `lash-load` row: 4 screws, W = 1380·G²·D = 121.2 lbf/in, 297 lbf vs 212 lbf demand (0.71). |
| **S-10** lever abuse 100 lbf | **Not fixed** | Members are still at λ = 2 (43 lbf at the grip). No 100 lbf row; no chock in the kit list or label (`grep chock` finds only the sim). |
| Brake details (round-1 §4) | **Fixed** | ¾" solid shaft replaced by pre-hardened 4140 with cross-drilled roll pins; net-section von Mises 40.1 of 50 ksi (0.80). Released lining gap 0.37" (was 0.29"), `brake-clear` 0.16" of 0.10". Pinch gaps checked (0.64" to hull, 0.11" to ratchet plate). Ratchet span 28° against 23.4° needed. |
| Mass cuts (round-1 §7) | **Taken, then swamped** | Storage floor deleted, aluminum sockets, 10" joists: about -4 lb. Front end +8.9, hull +5.2, sheer/crown +1.0. Empty mass 147.8 → **161.6 lb** (transport 151.0). Brake goal row was 23.0 lbf (0.77 of 30) in round 1, 27.07 lbf (0.90) now, so the brake has lost its slack (N-8). |
| Not-covered list (§8) | **Mostly fixed** | Sharp ends capped, lever/ratchet pinch fixed, prow socketed (`prow-grab` 0.88), foot stop has a row (`foot-stop` 0.33). Open: rope-to-tire mock-up (Phase 4), wet parking nose-down (D-24, chock still missing). |

M1-M11 as a set: M1 stops, M2 pin peak, M4 cleavage, M6, M7, M10, M11 closed; M3 not closed (S-4); M5 and M8 partial; M9 closed.

## 2. Hand checks I redid (agree with the code)

| Item | My number | Code |
|---|---|---|
| r_eff of the stop face, s = 2.91…5.65" | ⅔(180.36-24.64)/(31.92-8.47) = 4.43" | 4.43" |
| Pair force P = T/r_eff, T = 414.2 lbf × 17.75" = 7,352 | 1,660 lbf | 1,659.9 |
| Share at δ = 0.005" | 0.5 + 15,403 × 0.005 / (2 × 1,660) = 0.523 | 0.523 |
| Carrier-end bolt load | 1.2809 × 491.2 / 6 + 7,352 × 5.469 / 101.32 = 104.9 + 396.9 = 501.8 lbf | 501.7 |
| NDS Z, ⅜" plate, θ = 90° (my own re-derivation of IIIs) | about 534 × 0.952 = 509 | 509.1 |
| Brake hold, goal, fouled | 27.07 lbf | 27.07 |
| Rear lifter | 151.0 × (52.13 - 20.5) / (52.13 + 9.63) = 77.3 lb | 77.4 |

The arithmetic is sound. The problems are in what the arithmetic assumes.

## 3. New findings

### MUST

#### N-1. The stop share and `kingpin-bolts` margin hold only at a tolerance no shop can promise
Evidence (`runChecks`, goal / operating utilization, all else default):

| Perturbation | `kingpin-bolts` | `steer-stops` |
|---|---|---|
| default: δ = 0.005", E = 1,500 psi | 0.985 / 0.858 | 0.75 / 0.66 |
| δ = 0.010" | **1.02** / 0.89 | 0.79 / 0.69 |
| δ = 0.020" | 1.08 / 0.95 | 0.85 / 0.76 |
| δ = 0.030" | 1.15 / **1.02** | **1.06** / 1.15 |
| E = 3,000 psi (stiffer pad, or cold urethane), δ = 0.005" | **1.02** / 0.89 | 0.70 / 0.61 |
| E = 800 psi (softer pad), δ = 0.005" | 0.97 / 0.84 | **1.38** / 1.20 (pad strain over 0.30) |

- 0.005" at r_eff 4.43" is 0.065° of lock. Four glued-and-screwed oak blocks will not repeat that without adjustment. The round-1 argument for MF-1 was exactly that fit-up cannot be held; the fix moved the problem from "wood is too stiff" to "pad is exactly this stiff and the fit is exactly this good".
- At a plausible 0.02" the goal row fails (1.08) and the 150 lb row is at 0.95. At 0.03" the 150 lb row fails. D-1 says 150 lb must pass everything.
- The share only matters because 79% of the outer-bolt load is the stop-torque term (397 of 502 lbf). That term does not depend on the share at all.
- The `steer-stops-bound` row passes (0.886) only because it is an abuse case at strength with the safety factors removed; it is not a substitute for a design row at a buildable fit.

Fix (pick one, then re-run):
1. Make the stops adjustable and write the fit-up into the assembly data. Example: a set-screw jack on each stop block face or a shim stack under each block, with a feeler-gauge step ("both pads must touch within 0.005" at lock; set at 70°F"). Keep δ = 0.005 and record it as a build requirement, not an assumption.
2. Or design to a buildable value: set `steerStopFitMismatchIn` to 0.015-0.02 and add capacity. The cheapest capacity is to take the stop torque out of the bolt line: a pair of ½" shear pins (or a keyed block) through the carrier into the beam at y = ±5.7" carries T as a 645 lbf couple per pin, and the six bolts keep only the 105 lbf pin reaction. Alternatively accept a lower limit (see O-4).
3. In either case add the pad-modulus window to the notes: temperature (a winter-night event), durometer tolerance and aging all move E by 2x. Order a pad sample and measure k before the build.

Files: `src/params.ts` (`steerStopFitMismatchIn`, `steerStopPadModulusPsi` notes/defaults), `src/analysis/front.ts` (`kingpinBoltsCheck`, `beamBoltDetails`), `src/model/steering.ts` and `kingpin-plates.ts` if a shear pin is added, `src/model/stops.ts` for an adjuster, `DECISIONS.md` D-35/D-36 text.

#### N-2. Carrier-end bolt capacity is overstated: countersunk heads and opposed loads at the two faces
Evidence:
- The plate bolts are "flat heads flush in the carrier" (`params.ts:870` note; `steering.ts` carrier joint). `boltCapacity` (`front.ts:107`) uses the full ⅜" carrier as the side member (`ls = 0.375`). A countersink removes bearing length: AISC 360 (Sect. J3, countersunk bolts) reduces bearing by 50% of the countersink depth. I could not open the spec in this session, so treat the exact clause as "verify". A 5/16" 82° head is about 0.18" deep, so the effective plate is about 0.29".
- NDS mode IIIs scales with `ls`. Re-running `lateralZ` with the repo's own inputs:

| Effective side-plate thickness | Z × 0.952 (lbf) | Utilization at 501.7 lbf (goal) | at 436.8 lbf (150 lb) |
|---|---|---|---|
| 0.375" (as modeled) | 509 | 0.99 | 0.86 |
| 0.286" (flat head, 50% rule) | 449 | **1.12** | **0.97** |
| 0.250" | 428 | 1.17 | 1.02 |
| ½" carrier (mode IV caps) | 522 | 0.96 | 0.84 |

  With the countersink penalty the safe rider range falls from 200 lb to about 160 lb (linear interpolation of the two demand points; my estimate). Changing the carrier to ½" does not help much, because mode IV (bolt bending) caps at 548 lbf for a 5/16" grade 8 bolt.
- Opposed forces. `pinReactions` gives R_top = +1.281H at the carrier and R_bot = -0.281H at the beam plate, on the same six bolts through a 2.5" beam. The net into the wood is H, but moment balance of the plate stack about the beam mid-depth leaves a 2.2·H lb·in couple (about 1,800 lb·in at the 823 lbf two-wheel strike) that the wood bearing alone cannot resist (the wood reaction would have to act 1.28 depths from the bottom face, outside the beam). It must go into plate-face contact and bolt clamp. The check treats each end as an independent single-shear bolt with the full 2.5" of embedment. If the effective embedment is only about 1.25" (the two ends share the depth), mode Im governs at 464 lbf and the goal row is 1.08. This is probably fine with preloaded bolts, but nothing states or checks it, and wet oak shrinks.
- The NDS model is otherwise implemented correctly (Fe⊥ = 6,100·G^1.45/√D = 6,238 psi, Rd = 3.2-4·Kθ, C_M 0.7, C_D 1.6 cap, C_g 0.85, which is conservative for a load across the grain where Cg = 1.0).

Fix:
1. Remove the countersink from the load path: counterbore for a low-head socket screw from the underside and a nut or hex head on top inside a pocket, or use the ½" carrier with the head recessed only 0.1". Or enter the penalty in `boltCapacity` as `ls_eff = t - 0.5·countersink depth` and let the row show it.
2. Add the plate-stack couple to `kingpin-bolts` or to the pitch-path row, and specify bolt preload (castle nut or Belleville washers) and a retorque after the first wet day.
3. Re-run the sweep. If the row fails at 200 lb, state the safe limit (O-4) or add the shear pin from N-1.

Files: `src/analysis/front.ts` (`boltCapacity`, `plateModel`), `src/model/steering.ts` (carrier bolt joint note and size), `src/model/kingpin-plates.ts`, `src/params.ts:870` note, `DECISIONS.md`.

#### N-3. Stop-dog riser joint has no bearing or edge-distance row, and the screws are tapped into 1/8" bar
Evidence:
- At the goal rider, `steer-stops` lists the riser screws at 2,591 lbf shear each (0.6" apart, 3/8-16 grade 8, F/2 plus the dog's vertical-axis moment M_z = 868 × 1.77" = 1,533 lb·in over a 0.6" lever). Only an interaction ratio is checked (0.63). `stopDetails` (`front.ts:184-246`) has bearing rows for the arm screws on the carrier, but none for the riser screws.
- Geometry (`steering.ts:278-294`): the riser is a 1/8" thick, 0.5" deep bar (`steerStopRiserDepthIn` 0.5). Screws pass down through the 5/16" web into the 1/8" riser and up through the arm into the same riser, so the riser carries the full 2,591 lbf in bearing and has two threads engaged.
- Using the repo's own steel bearing allowable (`allowables.plateBrg` = 0.9 × 36,000 / 2 = 16,200 psi): web 2,591 / (0.375 × 0.3125) = 22.1 ksi (1.36x over); riser 2,591 / (0.375 × 0.125) = **55 ksi (3.4x over)**. A ⅜" hole in a 0.5" deep bar leaves 0.055" of steel at the edge in the direction of the couple load.
- An AISC-style bearing value (about 1.2·d·t·Fu) would pass the web but still leave the riser's edge distance (0.055") and thread engagement unchecked. In the share = 1 case the couple load per screw rises to about 4,970 lbf. The bounding row also omits these rows.

Fix: add three rows to `stopDetails` (screw bearing on the web, on the riser, edge distance to the riser end, and thread engagement in the riser). Then change the joint rather than the allowable: make the riser a 3/8" × 1" block with a 4-screw 0.9" × 0.9" pattern (halves the couple load; +0.05 lb), or tap the arm only and let the web clear the screws. Check it still stays out of the crossbar shadow at lock (`stops.ts` planner).

Files: `src/analysis/front.ts` (`stopDetails`), `src/params.ts` (`steerStopRiserDepthIn`, screw pattern), `src/model/steering.ts:257-298`, `src/model/stops.ts`, `front.test.ts` (one hand anchor).

### SHOULD

#### N-4. D-44's "nose section is the minimum" is false: `hullLayers` reads the gunwale's bounding box
Evidence: `structure.ts:230-238` builds the nose girder layers from `worldAABB(side-nose-L-gunwale)`. With the new sheer line that part is a curved extrusion, so its box runs from the flat underside to the bow top: 4.0" tall at the default 2.5" rise instead of one 1.5" rail band (`stock.w` = 4.0 vs 1.5). With the hull-beam frame style (the only style that uses this layer stack):

| `sheerRiseIn` | gunwale layer height | "nose side bending at the shoulder" |
|---|---|---|
| 0 | 1.5" | 938 psi |
| 2.5 (default) | 4.0" | **608 psi** |
| 4 | 5.5" | 488 psi |

The stress drops as the rise grows, which is the wrong direction for a "minimum section" claim. At the defaults (ladder frame) the nose section is not used, so no default number changes, and the hull-beam row has a 7x margin (938 of 6,460 psi). It is still a false statement in `docs/visual-pass-geometry-notes.md` and D-44, and a trap for anyone who switches frame style.
Fix: in `hullLayers`, take the gunwale layer as `z1 = z0 + railBand` (or clip to `L.noseTop + L.sideH`) instead of the box, and add a regression test that `rails` nose bending is independent of `sheerRiseIn`. Correct the D-44 text.
Files: `src/analysis/structure.ts:217-242`, `src/model/visual-geometry.test.ts` or `src/analysis/checks.test.ts`, `docs/visual-pass-geometry-notes.md`, `DECISIONS.md` D-44.

#### N-5. Turntable support and the pitch path (S-4 unchanged)
Evidence (part boxes from `buildModel`): the 12" bearing (x 39.50-51.50, z 7.25-7.75) bottoms on the carrier strip only (x 44.25-46.75, 2.5" wide). The beam top is at z 6.875, so there is a 0.375" air gap under the rest of the plate. If the race is about 9" in diameter (my assumption; the notes say the corner holes are 10" apart), only about 64° of its 360° lies over the carrier; the rest is on the unsupported lower plate, 3.25" out from the carrier edge. The 1,500 lb rating assumes a flat supported mounting. `turntable` is a rating-only comparison (526 of 750 lbf).
The pitch path text (`front.ts:539`) is unchanged. The real path is simpler and benign: the ball ring in eccentric compression (M_p = 823 lbf × 1.34" = 1,106 lb·in against V·r_race of about 526 × 4.5 = 2,370 lb·in, so e = 2.1" and the ring does not unload).
Fix: widen the carrier to the beam width (`kingpinPlateWidthIn` 2.5 → 4.0; +1.9 lb; check it clears the rod groove front edge) or add shim blocks under the overhang; add a bottom-plate bending row with the vendor's plate thickness; rewrite the pitch-path description to the ring-in-compression load path and check ring pressure.
Files: `src/params.ts:847`, `src/model/kingpin-plates.ts`, `src/analysis/front.ts:501-546`, `DECISIONS.md` D-32.

#### N-6. Bridle tie and rope-pull margin is thin
Evidence: at `pullForceLbf` 250 the tie row is 1.05 (washer crush 358 psi; eye shank 0.97), at 400 it is 1.67 (shank 1.55). The 150 lbf basis is "4-6 scouts surging" (`params.ts:146`); 250 lbf is 40-60 lbf per scout. The eye bolt is the weak link, which is the correct order, but it should be a stated one. The `kingpin-split` web shear-out (200 of 318 psi) also rises to 1.05 at 250 lbf, but that ligament is no longer in the load path.
Fix: size the tie hardware for 300 lbf (½" eye bolt or a 2" fender washer; +0.2 lb), say in the BOM that the eye bolt is the intended weak link, and drop or relabel the legacy web row. The pull basis itself is O-2.
Files: `src/params.ts` (`eyeBoltDiameterIn`, `eyeBoltWasherDiameterIn`), `src/analysis/front.ts:601-602`, `src/model/steering.ts`.

#### N-7. No wheel, tire or hub rating row
Evidence: nothing in `src/analysis` reads a wheel rating (`grep wheel.*rat` finds nothing). The rear wheels see about 360 lbf each at the goal rider with the 3x factor (static about 120 lb) and the front wheels 265 lbf. The hand-truck wheel is sourced by description only (`running-gear.ts:42`). Hub bearings in these wheels are radial; lateral skid loads (μ·P) are not in their ratings.
Fix: add a `wheel-rating` row: static goal-rider wheel load against an assumed catalog rating (`wheelRatingLb`, status `verify`), and the lateral skid as a fraction of it. Put the real rating in the BOM.
Files: `src/params.ts`, new row in `src/analysis/structure.ts`, `src/analysis/index.ts`, `src/analysis/rider-sweep.ts` (`LIGHT_OF_ID`), `src/model/running-gear.ts` sourcing.

#### N-8. Brake: no slack, and the lever abuse case is missing
Evidence: mass +13.8 lb since round 1 cost about 1 lbf (the force slope is 0.07 lbf per lb: 27.07 lbf now, 3 lbf of headroom is about 41 lb of added mass). The 4.8 → 6.8 lb hardware set is an estimate, and μ_fouled 0.35 and η 0.8 are assumed. Raising `brakeRatioHeadroom` from 1.1 to 1.2 gives a 0.83 force row, but then `brake-lever` goes to 1.01 (tail pin bearing) and the grip travel to 7.0" (6.4" now), so the geometry is already balanced and the lever is the next limit. Grip travel of 6.4" is untested by hand; F3 flagged it. S-10 (100 lbf hang-on abuse) is still not a row: λ = 2 is 43 lbf; scaling the 40.1 ksi net-section shaft stress to 100 lbf gives about 90 ksi against 100 ksi yield, so a scout hanging on the lever bends the shaft, with no rider injury but no brake.
Fix: add `brake-abuse` (100 lbf at the grip: tail shear, shaft net section, pin shear, ratchet tooth) with yield-level limits; take mass out elsewhere or find ≥ 0.05 of μ in the lining test; put "chock the wheels on a slope" in the kit list and a lever label; feel-test the 6.4" travel on the mock-up.
Files: `src/analysis/brake.ts`, `src/params.ts` (`brakeAbuseLbf`), `src/analysis/index.ts`.

#### N-9. Finger-entrapment wedge (S-5) and the sheer length
Evidence: `guard-L/R` cover x 26.4-31.6, y 6.8-12.5, z 13.75-16.75 (top and shoulder side). The forward wedge between the tire sidewall and nose side at lock (0.76" neck at the defaults) is open, and there is still no analysis row. The sheer notes admit that `sheerLengthIn` above about 21" puts the rise over the guard with no validator.
Fix: a `finger-gap` row that sweeps the tire against the whole nose side over the lock range and reports the minimum gap and whether it sits in the 0.25-1.25" band; extend the guard to a fender or raise the neck. Add the `sheerLengthIn` validator.
Files: `src/model/body.ts` (guard), `src/analysis/` new row, `src/params.ts` validator.

#### N-10. S-6 leftovers
Front rod flush in a groove exactly its diameter (U-bolt bridge bottoms on the beam top, not the rod): set groove depth 0.70-0.72" (`axleBeamDepthIn`/groove param); the rear U-bolts and plates are still boxes with "mass is an estimate" (`running-gear.ts:146-156`). The rear axle is the one carrying 120 lb × 3 per wheel; its clamp is undrawn and unchecked.
Files: `src/model/running-gear.ts`, `src/model/layout.ts`, `src/params.ts`.

#### N-11. Decision ID collisions
The code and the F1 notes cite "D-35" for the kingpin plates and "D-36" for the new stops, and `params.ts` refs say D-35; but DECISIONS.md D-35 is the captured-ply hull and D-36 is the bent-lam prow. D-43 is a stub that points at four notes files. The citation rule in `CLAUDE.md` cannot work like this. Renumber (D-45, D-46) and consolidate at the checkpoint.
Files: `DECISIONS.md`, `src/params.ts`, `src/analysis/front.ts`, `src/model/kingpin-plates.ts`, `src/model/steering.ts`, test titles.

### NICE

- **Ground μ.** At `tireGroundMu` 0.9 (dry asphalt or camp road) `slide-before-tip` fails (1.23 on its own scale) and `axle-stress` reaches 1.00. The cart tips before it slides in a hard turn on grippy ground. Add a speed note on the Simple view.
- **Winter night.** The event is "winter" in Georgia, in the dark: cold urethane stiffens (N-1), printed ASA guards and clips are less impact tolerant. No data in the repo; mention in the assembly notes.
- **Preload.** Specify Belleville washers and a retorque for the plate bolts (oak moves across the grain).
- **Sim.** The rigid-wheel Rapier sim gives 34-91x peak load factors for a 3" curb at 4-8 mph and tips at 6 mph. It cannot back the 3x factor; the scenario text should say so.
- **Domino orientation.** F4's open question (length versus width) is still open; verify against the tool before cutting.
- **Fastener corrosion.** Grade 8 in white oak: epoxy sealing is specified; good. Keep it as an inspection item.

## 4. Decisions for Eric (not fixes)

| # | Decision | Why it is yours |
|---|---|---|
| O-1 | **Two-person lift.** Transport mass is 151 lb. The rear lifter carries 77.4 lb and the front 73.7 lb, each through one 4.5" slot with one hand. The slot bar passes (0.58); the human load does not look reasonable for youth. Choices: a four-person lift with side hand-holds, a ramp or dolly, a second slot per end, or switch to the lightweight variant (D-21). | Safety policy and the brief's 60-70 lb target. The cart is now 2.3x that. |
| O-2 | **Design bridle pull.** 150 lbf is an assumption (D-14). The tie fails near 250 lbf. | Your judgment of how hard the scouts surge. |
| O-3 | **Impact basis.** The 3x factor is a judgment. My back-of-envelope (not from the code): design contact force on a 3" curb is V_w/cosφ = 265/0.5375 = 492 lbf; with a radial tire stiffness of 700 lbf/in (assumed) that matches a closing speed of about 1-1.6 mph (F = v·√(k·m), m = front-end share to whole cart). Walking pace is 2-3 mph. Either accept it with a rule ("walk over curbs, hold the cart back at steps"), or raise the factor and take the mass. A real tire stiffness number would settle it. | Operating rule versus mass. |
| O-4 | **Goal rider.** With N-1/N-2 unresolved, treat the Simple view's "safe to 200 lb, green to 160 lb" as optimistic by up to 40 lb. Fix it (more steel) or label the limit at about 160-175 lb. | Whether 200 lb is a requirement or a goal (D-1 says goal). |
| O-5 | **Parking and surface.** Rear-only traction is 0.99x nose-down at μ 0.5 (info, D-24). On wet leaves or grass (μ 0.3) it is about 0.6x. Keep D-24 but require a chock in the kit list. | Already accepted; the kit list is yours. |
| O-6 | **Truck bed.** Fit margin is 0.50" in the nose-at-bulkhead mode with the rope and tongue installed, on an unmeasured bed (D-29); the straddle mode does not fit at all. | A 150 lb cart that does not fit is a late surprise. Measure when convenient. |
| O-7 | **Vendor items that need a purchase decision.** The 12" bearing with a 6.25" center hole and a known bottom-plate thickness (N-5), the lining sample, the pad durometer sample. | Cost and lead time. |

## 5. Phase-4 verify list

Bearing center hole and plate thickness; pad k under load at cold and warm; lining μ on a wet tire; weigh a hardware set; rope to tire mock-up; 6.4" lever travel feel test; grade 8 countersunk or counterbored head detail on the carrier; rear U-bolt drawing; wheel rating; Domino face width on the real DF 500; test strip for the prow spring-back.
