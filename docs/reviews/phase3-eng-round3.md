SCORE: 7/10

# Phase 3 engineering critic, round 3 (final)

Scope: working tree at `main` (5e3bc1f, clean). `npm test`: 1,104 pass in 30 files. `npm run typecheck`: clean. Every number below is read from `runChecks` / `riderSweep` on the real code, or from a throwaway script (kept in `/private/tmp/r3/`, not in the repo; the recipes are in section 6). Where a number is my own estimate and not from the code I say so.

## Why 7 and not 8

Round 3 closed all three round-2 MUSTs for real (capacity was added or the joint was changed; nothing was only relabeled), plus six of the eight SHOULDs. The brake mount, the rear beam seat, the bridle tie and the curved-hull geometry are in good shape, and the arithmetic I redid by hand agrees with the code. A competent engineer would still not sign off yet, for three reasons:

1. **The pitch path through the turntable is carried by an assumed vendor plate and an ungated INFO row.** `pitch-path` passes only if the lazy susan's lower plate is 3/16" steel (0.57 at 150 lb). At 1/8" it is 1.28 and at 1/16" it is 5.1. The new `turntable-ring` row is 118% of the project's own margin at 150 lb (137% at 200 lb) and is excluded from every light, so the Simple view says "strength green to 170, safe to 210" while D-1 ("150 lb must pass everything") is not met by the repo's own convention. This was round-2 N-5; the r3 answer moved the finding into an info row.
2. **The front end's advertised range is not supported.** At the 150 lb requirement it fails if the ears share nothing (kingpin-bolts 1.07) or if the pad is 30% softer than the soft bound (steer-stops 1.16). The quoted "about 200 lb" (DECISIONS D-46 still says 50-220) has no margin: `steer-stops` is 0.96 at 200 lb.
3. **A new statics error in the welded stop stand (the N-3 redesign).** The overturning moment on the dog is computed with the force at "web level" (0.31" arm). The pad is bonded 1.0" above the weld plane and 1.56" above the carrier. With the real arm, the arm-toe bearing row goes from 0.49 to about 1.6 at 150 lb and 1.8 at 200 lb. See MUST-3.

Fix the three MUSTs (all are small edits) and the grade is 8.

## 1. Verification of round-2 findings

"Fixed" means I confirmed it in the code and the numbers, not in the notes.

| Finding | Status | Evidence |
|---|---|---|
| **N-1** stop share, fit-up tolerance | **Partial: fixed in structure, not in robustness** | Fit-up is now an honest `steerStopFitMismatchIn` 0.018" with shim packs (range 0.0625", validator needs range >= 2 x fit-up, `params.ts:2400`). Pad modulus is a range, 1,000/1,500/3,000 psi, and `steer-stops` reports the worst of three; `pinLoads` feeds the soft/stiff cases to every kingpin row. Share at the goal rider is 0.584 (k = 15,650 lbf/in, P = 1,687 lbf, F = 984 lbf, hand check 0.5 + 15,650 x 0.018 / 3,374 = 0.583). But the sweep is fragile (table in 2b). |
| **N-2** countersunk carrier bolts, opposed loads | **Fixed** | Carrier bolts go in from below and thread into the tapped carrier; no countersink in the load path. `boltCapacity` takes a countersink depth (`nds.ts`); the crossbar flat-head bolts are 0.45 (150) / 0.48 (200) with the penalty. New rows: plate-stack couple bolt tension 0.07, edge contact with 50% retained preload 0.56 at 150 lb in my run (the r3 notes quote 0.88 / 0.91; I did not chase the difference), preload clamp 0.62. Preload is 1,500 lbf (7.8 lb-ft) with Bellevilles. Carrier-end bolt 406 of 509 lbf at 150 lb (0.80). |
| **N-3** riser joint without bearing/edge rows | **Fixed by removal, but the replacement has a statics error** | Riser screws are gone; web, riser and arm are one welded stand (1/4" E70 fillets). Weld rows 0.54 (150) / 0.61 (200); my hand check of the fillet stress (direct 1,590 + torsion 9,430 psi + overturning) agrees with 12.7 ksi. But `Mr = F x hRiser` (0.3125") understates the overturning arm by 3-5x. See MUST-3. |
| **N-4** `hullLayers` read the gunwale bounding box | **Fixed** | `hullLayers` builds layers from the real section (railBand, `L.web`). Hull-beam frame, `rails` at 200 lb: 0.175 / 0.176 / 0.176 for `sheerRiseIn` 0 / 2.5 / 4 (was 938 -> 608 -> 488 psi). The "minimum section" sentence is gone from DECISIONS. |
| **N-5** turntable support, pitch path | **Partial** | Carrier widened to 4" (`kingpinPlateWidthIn`), `pitch-path` rewritten (ring in eccentric compression, lower plate overhang, carrier on beam). But the lower-plate row depends on an assumed 3/16" vendor plate, and the ring itself was made an INFO row. See MUST-1. |
| **N-6** bridle tie thin | **Fixed** | 1/2" eye bolt, 2" washer, rows evaluated at 150 x 2 = 300 lbf (`bridleTieOverloadFactor`): `bridle-tie` 0.52 (eye shank), washer 0.28. Legacy `kingpin-split` web row removed (the row now lists cross-bolt rows only). BOM names the eye bolt as the weak link. |
| **N-7** no wheel rating row | **Fixed as a row; the numbers are placeholders** | `wheel-rating` 0.62 at 200 lb (static 124.6 of 300 lb, peak 373.7 of 600, skid 62 of 150). `wheelRatingLb` 300, the 2x peak multiple and the 0.5 side fraction are unsourced (status verify). |
| **N-8** brake slack, abuse case | **Fixed, chock still open** | Headroom 1.2, ratio 14.4:1, goal handle force 25.3 lbf (0.84, hand check below). `brake-abuse` row exists and passes 0.89 (pivot post bending 32.0 of 36 ksi). A chock is still not in the kit list or on a label (`grep chock src` finds only the sim). |
| **N-9** forward finger wedge | **Partial** | `fingerAnalysis` now scans the whole outline; a single printed guard follows the S-curve. No `finger-gap` row. New hazard: the guard silently disappears when `sheerLengthIn` >= 21 and `validateParams` returns no issue (verified, S-3 below). |
| **N-10** rod flush, rear U-bolts | **Fixed (rear), front rod not re-checked** | Rear: real 316 hold-down angles and flat-bar clamps with a `rear-beam-seat` row (0.88). I did not re-open the front rod groove depth. |
| **N-11** decision-ID collisions | **Partial** | D-45..D-48 are unique in DECISIONS.md. Code still cites D-43 (the stub) 137 times and never cites D-46 (0 hits). D-46 text says "safe 50-220 lb"; the code says 50-210, green to 170. |

Round-2 S-4 (pitch path) is the same item as N-5. S-5 and S-10 are covered by N-9 and N-8.

## 2. The five judgments you asked for

### (a) `turntable-ring` INFO row

**Numbers (verified).** H = 829 lbf (two-wheel 3" curb) acts 1.34375" above the pin line, so M_p = 1,114 lb-in; V = 531 lbf. The eccentricity is e = M_p/V = 2.10" at every rider weight (H and V both scale with the front axle), against a kern R/2 = 2.25" (93%). P_eq = V + 4M_p/D_p = 531 + 495 = 1,026 lbf at 200 lb, 888 lbf at 150 lb, 697 lbf at 80 lb, against 750 lbf (1,500 / 2): 137%, 118%, 93%.

**Is info-only acceptable? No.**
- It breaks D-1 by the repo's own rule: at 150 lb the row would FAIL at the margin the sibling `turntable` row uses.
- Info rows are `'info'` in `LIGHT_OF_ID`, so neither the strength light nor the safe range ever sees it.
- `pitch-path` (which does gate) is a function of an unknown: the vendor lower plate. Section 2a-2.

**What actually moves the number.** The vertical term alone is 531 lbf = 71% of the 750 lbf limit, so a bigger ring does little: D_p = 12" gives 901 lbf (120%), D_p = 15" gives 827 lbf (110%). Only a different rating basis or a different bearing passes. A thrust bearing adds nothing while the flange it sits on is a thin stamped plate.

**The convention question you have to settle.** The strike case already carries the 3x dynamic factor on both V and H. Dividing a static catalog rating by 2 on top of that is a double margin. Judged at 1.0 x the rating (1,500 lbf), P_eq is 68% at 200 lb and 59% at 150 lb, and e/kern at 93% is the remaining marginal row. That is a defensible basis, but only if (i) the vendor states a thrust rating for a moment-loaded ring, which many lazy susans do not, and (ii) the lower plate is not the weak part.

**Fix (pick one, in order of robustness).**
1. **Take the vendor out of the structure.** Build the bearing from two steel plates you already have (carrier and top plate) with an annular UHMW thrust ring (D_p 9-10", 1/4" thick) and the existing kingpin as the hold-down. The ring bears on the carrier, so the carrier must extend under the ring's fore and aft quadrants (wings in x; today the carrier is 4" fore-aft under a 9" ring, and the beam is 4"). The moment path is then steel-to-steel plus UHMW, with a pressure you can check, no unknown plate and no rating.
2. **Name a bearing.** Pick a specific 12" turntable with a published moment or tilting rating and plate thickness, put its numbers in `turntableRatingLb`, `turntablePlateThickIn`, `turntableRaceDiaIn`, and gate the row.
3. **Minimum now.** Make `turntable-ring` a pass/fail row on a stated basis (P_eq <= 1.0 x rating, e <= R/2), keep the status `verify`, and add the lower-plate thickness sweep below to the notes so Phase 4 knows what to read off the box.

Lower-plate sensitivity (`pitch-path` at 150 lb, `turntablePlateThickIn` only): 3/16" 0.57 pass; 1/8" **1.28 fail**; 1/16" **5.12 fail**. Generic 12" stamped lazy-susan plates are commonly thinner than 3/16" (my knowledge, not from the repo), so the default is the optimistic end.

### (b) Fragility of the front end

**Verified sweep** (`riderSweep` 50-260 lb step 10; one change at a time; "op" is the 150 lb operating rider):

| Change | Safe range | Green | Limiter | 150 lb |
|---|---|---|---|---|
| base | 50-210 | 50-170 | steer-stops 1.00 at 220 | passes |
| ears share nothing (`kingpinTorqueTopShare` 1.0) | **none** | none | kingpin-bolts 1.07 | **fails** (carrier-end bolt 1.07) |
| ears share 75% | 50-190 | 50-150 | kingpin-bolts 1.00 | passes (0.90) |
| fit-up 0.025" | 50-200 | 50-150 | steer-stops 1.02 | passes |
| fit-up 0.030" | 50-170 | **none** | kingpin-bolts 1.01 | marginal (0.955) |
| soft pad 700 psi (below the 1,000 soft bound) | **none** | none | steer-stops 1.16 | **fails** (pad strain 1.16) |
| stiff pad 4,000 psi | 50-210 | 50-160 | steer-stops 1.00 | passes |
| preload retained 25% | 50-210 | 50-170 | steer-stops 1.00 | passes |
| bridle pull 250 lbf | 50-210 | 50-170 | steer-stops 1.00 | passes |

This is better than the r3 notes' table in two cells (fit-up 0.030 is "none" there but 50-170 here; the brake agent's later edits changed it). It is worse in one that the notes did not run: the 150 lb requirement fails in two plausible cases.

**What kind of cliff is it.** "Fail" here means the code's allowable (steel SF 2, wood allowables with C_M and C_D) is exceeded for the 3x dynamic curb-strike design event, not that the part breaks. Real margin to breakage is larger. But the repo's own rule is "150 lb passes everything" and the failing cases are not exotic:
- Ear share 1.0 is what you get if the ears are welded with any gap, or the beam shrinks from the plates. The 0.6/0.4 split is an assumption; my stiffness estimate (ear web in shear is far stiffer than the bolt-in-oak bearing on either side) says the real split is 0.5 +/- 0.15 when everything touches, but nothing in the build forces everything to touch.
- Pad strain is stress/E, independent of pad thickness. The 700 psi case fails for any 1/4" to 3/8" pad; only more pad area, a harder pad or a steel bottoming shoulder fixes it. The r3 note's "pad 1/4 -> 5/16" for the soft end did not change the strain row; the dog height change (area) did.

**Verdict.** Acceptable for a supervised youth event only if all of these hold: (1) the Phase 4 front-end bench test (ear share by dial indicator, pad k warm and cold, stops shimmed to a 0.003" feeler, torque proof-load to 1.5x) is a go/no-go gate with numbers written down, not a "verify" bullet; (2) the Simple view quotes what is robust, not what is computed (see Decisions); (3) the cheap robustness below is taken now.

**Most robust low-mass alternative (my recommendation, MUST-2).**
- Design the carrier-end bolt line for ear share 1.0 at 150 lb, and treat the ears as a bonus, not as credit. The row is short by 7% (1.07). The option I could not apply is 3/8" bolts (`validateParams` rejects them: the 4D loaded-edge distance does not fit the beam front); candidate fixes are an eighth and ninth bolt in a second short row on the ears' tabs, or a 3/8" plate with 3/8" tapped bolts only at the two outer positions. All are under 0.5 lb (my estimate).
- Fix the soft-pad row with area, not thickness: lengthen the dog face (2.61" -> 3.3") or add a steel bottoming shoulder at 25% strain. Either makes the 700 psi case pass at 150 lb.
- Keep the 0.018" fit-up row and the shim pack; they are fine.

I considered a welded steel yoke in place of the oak beam, three plates and bolt group. The mass is neutral to slightly worse (a 2 x 3 x 3/16" tube is about 16 lb, the oak beam plus carrier plus under plate plus ears about the same; my estimate) and it moves all the risk into welds. Not recommended unless Eric drops oak there for other reasons.

### (c) The curved hull's structure

What I checked and what holds:
- **Geometry and bends.** Inside-face radii: chine/gunwale 5.38" vs 5.0" limit (5 x 1/8" strips, factor 40), rail 5.32" vs 5.0", web 5.58" vs 4.72" (2 x 3 mm). Every sweep is validated against the 40x rule (`hull-curve.test.ts`). Member overlaps clean in the 300-design fuzz.
- **Load path.** Cabin rail is one bent lamination to xn = 30.4", then a 1:8 scarf to the straight nose rail (30.4-36.0"); the shoulder beam (28.9-30.4", 1.5" x 12.5" x 2.75", 2 Dominos per end) ties the rails and carries the deck step. The chine, web and gunwale are continuous through the curve. This is a sound arrangement.
- **Rails row.** 0.69 at 200 lb (bending 4,171 of 6,460 psi, deflection 0.104 of 0.152"). It uses a straight 0.75" x 3.0" ladder rail over the whole 45.5" span and ignores the composite side beam, so it is conservative in bending. It does not know the rail is plan-curved.
- **Deck.** 12 mm ply on a 9.16" maximum bay: standing scout 0.026 of 0.031" (0.86). Passes, close to its limit (it is the third row to go marginal at 210 lb).
- `hullLayers` (hull-beam style only, not the default): fixed (N-4).

Concerns, in order:
1. **The S-bend sits on the peak-moment zone and nothing analyzes it.** The analysis span is rear beam to kingpin (45.5") with the payload at midspan (x about 22.7"). The curve runs x = 18 to 30.4", with the peak heading of 67 degrees at the inflection (x about 24). A plan-curved beam under vertical load carries torsion as well as bending: roughly M x sin(heading minus chord angle), up to about 0.85 M near the inflection. If the side beams carried 2,000-2,500 lb-in each there (about 55% of the peak per rail; my estimate, see below), that is a torsion of the same order on a thin deep section whose only restraint is the deck, the joists and the shoulder beam. Probably carried (deck ply on ledges, 2.75" beam, Dominos), but no row says so. SHOULD-2.
2. **Residual stress of a bent lamination at t/R = 1/43.** NDS glulam curvature factor C_c = 1 - 2000 (t/R)^2 goes to about 0 at t/R = 0.023 (and the NDS limit for hardwood is about 1/100). The section is outside any published allowable; strain on a 1/8" strip at 5.4" is about 1.1%, and white oak fails in tension at roughly 0.8-1.0% (my figures). Factor 40 is at the optimistic end of cold-bent oak practice (50 is the usual shop rule). The 7% radius slack (5.38 vs 5.0") is the entire cushion.
3. **Spring-back vs clearance.** `steer-clear` is 0.75" against 0.70" required (marginal). A 67-degree S-bend will spring in or out by a fraction of an inch unless the form is compensated; the pinch is at the tire's rear inner corner.
4. **Nose load path is thin but adequate.** The bolster ring (below the 12 mm nose deck) is bolted to the deck (`roll-bolster-attach` 0.37) and the nose rails stop 3.5" short of it. Vertical load goes through the deck ply and the chine/web/gunwale side beam; my back-of-envelope (263 lbf per side at 15" lever, 6 mm okoume web) gives about 265 psi shear and 715 psi flange stress: fine, but no row exists for it in the default (ladder) style.

### (d) The brake

Hand checks (agree with the code):
- Hold at the goal rider, mud-fouled lining: W sin(theta) = 394 x sin 15 = 102.0 lbf; N = 102.0 / 0.35 = 291.4 lbf; F = 291.4 / (14.4 x 0.8) = **25.3 lbf**, limit 30 (0.84). Operating (150 lb): 22.1 lbf (0.74). Wet bonded lining: 19.7 lbf.
- Lever pivot reaction at 2x hold: link force = hand x l_grip/d_Q = 40.5 x 22.79 / 1.51 = 611 lbf; R = 611 - 40.5 = 570 lbf. The post moment is 570 x 0.83" = 473 lb-in, sigma = 32M / (pi d^3) = 11.4 ksi, matching the row (11,320 psi at 150 lb).
- Closed-loop statics: the link pushes the crank one way and the two shoes (about 309 lbf each at 2x) pull the other; the net on the shaft bearings is small, and the left plate sees the pivot reaction and the bearing reaction as an opposed pair (a couple), which is what the bolt group is solved for. The "net 470 lbf" figure is plausible; the old "sum of magnitudes" was too high. I could not independently reproduce 470 to the lbf without rebuilding the solver; the structure of the argument is right.

Findings:
- **Headroom 1.2 and travel 5.7".** The ratio is solved (tail 1.53"), critical rolling direction 14.4:1, travel 5.709" for a 0.3125" stroke vs 6.5" limit (0.88). The travel is geometry-derived but nobody has pulled it: it is the correct hand-feel check for the mock-up.
- **Abuse case.** 100 lbf at the grip is sensible. The row is at yield-level limits, and the pivot post is the weakest member (32.0 of 36 ksi, 0.89): it is the fuse, which is the right place. Shaft von Mises 74.8 of 100 ksi (0.75), crank roll pins 30.1 of 40 ksi (0.75). I would not move the abuse load down. If Eric wants a heavier abuse case (150 lbf), the post fails first, as it should.
- **7/8" shaft.** Design value 22 ksi von Mises at the cross-pin hole (0.44); net-section, no stress-concentration factor, which is fine for a ductile yield check.
- **Rail notches.** The beam-seat net-section shear row (0.88) takes the notch as an interior compression-face notch and drops the NDS d_n/d factor. With it, V_r would be 280 lbf against V = 371 lbf (1.32). The row is probably right (the glued chine, web and gunwale share the shear), but nobody quantified that sharing. NICE below.
- **Pivot post and ear.** The post is welded to the 3/16" plate ear; the weld ring is checked (0.45 / 0.55 at abuse), but the plate's own out-of-plane flexure from the post moment (473 lb-in at 2x hold, 1,327 lb-in at abuse) is not a row. The ear is backed by the rail end for most of its extent (rail starts at x -9.63", ear x -10.13 to -8.38"), so I think it is fine, but it should be stated.
- **Leftovers.** No chock in the kit list; wheel rating and peak multiple are placeholders; mud retract 5/16".

### (e) The welded parts

There are five weldments in the build: two shear ears (carrier tab to beam-plate tab), the stop stand (channel + riser + arm, two of them), and the pivot post to the left bearing plate. Sizes and allowables are conventional (0.3 F_EXX = 21 ksi on the throat with E70, equal-leg 0.707), and the code is mostly right:
- **Stop stand** weld rows 0.54 (150) / 0.61 (200). My hand check: F = 984 lbf, perimeter 3.5", throat 0.177": direct 1,590 psi; torsion M_z = 984 x 1.69 = 1,660 lb-in about the weld group (J_u = 0.670, c = 0.673") = 9,430 psi; total 11.1 ksi (code 11.1 at nominal pad, 12.7 stiff). Agrees. Torsion dominates (85%), as it should for a cantilevered face.
- **Ears.** 3/16" fillets, 0.75" long, both sides: that is exactly 4 x leg (the AWS minimum length) and a 3/16" fillet on a 3/16" tab edge (the tab is the under-plate edge). The stress is trivial (1.2 ksi of 21), so size is not the issue.
- **Pivot post.** 3/16" fillet all around a 3/4" round, the ring formula (S = pi d^2 t_e / 4) is right: 8.2 ksi (150 lb) to 23.2 ksi (abuse, vs 42).

What is **not** in the specification:
1. No weld procedure, qualification, or inspection. Add: AWS D1.1 (or D1.3 for the 3/16" plate) qualified welder, visual plus dye penetrant on the pivot post and stop stand, proof load.
2. **Contradictory fabrication notes for the ears.** The part note says "weld the ears BEFORE the plates go on, then check both plates are parallel" and also "weld the ears to the plate tabs on the bench with the beam as the jig". One of them is wrong; welding with the oak beam as the jig chars it and locks the weld shrinkage into the clamp.
3. **Distortion and flatness.** The carrier is the turntable's mounting face and takes tapped holes (stop arm screws, carrier bolts) and a reamed sleeve spigot. Weld, then machine/flatten, then tap and ream, then finish; say so. Same for the bearing plate with the bronze bearing press fit.
4. **Finish after welding.** The notes say hot-dip galvanize or zinc-rich primer; masking is needed for the reamed bores and the press fits. Do not galvanize or electroplate the grade 8 fasteners (hydrogen embrittlement); use zinc-flake.
5. **Overturning on the stop stand** is wrong (MUST-3).
6. The shop has no welder (D-46). If the answer is "outsource", the ears, stands and pivot post are three small jobs that fit one order with the laser-cut plates. If the answer is "no welding", all three need a bolted alternative and the ear credit disappears (see MUST-2).

## 3. Findings

### MUST (fix these and the grade is 8)

#### MUST-1. Gate the turntable pitch path and stop depending on an assumed vendor plate
Evidence: section 2a. `pitch-path` is 0.57 at 3/16", 1.28 at 1/8", 5.12 at 1/16" (150 lb). `turntable-ring` is 118% (150 lb) and 137% (200 lb) of the repo's own margin and never reaches a light. e = 2.10" at 93% of kern at all weights.
Fix: choose one of the three options in 2a; the minimum is a pass/fail row on a stated basis, `verify` status, and a Phase 4 vendor line that blocks the build (named bearing, plate thickness, published tilt or moment rating). Update `LIGHT_OF_ID['turntable-ring']` to `'strength'`.
Files: `src/analysis/front.ts` (`turntableRingCheck`, `ringGeometry`), `src/analysis/rider-sweep.ts` (`LIGHT_OF_ID`), `src/params.ts` (`turntableRatingLb`, `turntablePlateThickIn`, `turntableRaceDiaIn`, new margin param), `src/analysis/front.test.ts:444`, `DECISIONS.md` D-47.

#### MUST-2. Make 150 lb independent of the two unverified front-end assumptions; do not quote 200
Evidence: section 2b. 150 lb fails with ear share 1.0 (kingpin-bolts 1.07) and with a pad at 700 psi (steer-stops 1.16). Safe 50-210 / green to 170 is quoted as "about 200".
Fix: (1) add enough carrier-end bolt capacity that share 1.0 passes at 150 lb (about 7%; second short row on the ears' tabs, or higher-capacity outer bolts) and treat the ears as bonus; (2) add stop-pad area or a steel bottoming shoulder so the 700 psi case passes at 150 lb; (3) write the Phase 4 front-end bench test into `docs/STATUS.md` as a gate with acceptance numbers (ear share >= 0.4 under the under plane by dial indicator, pad k between 1,000 and 3,000 psi warm and cold, stops shimmed to 0.003" feeler, torque proof load 1.5 x 7.4 kip-in at lock); (4) change the quoted limit (see Decisions).
Files: `src/analysis/front.ts` (`beamBoltDetails`, `stopDetails`), `src/params.ts` (`kingpinTorqueTopShare`, `steerStopSizeIn`/dog length, pad params), `src/model/steering.ts`, `DECISIONS.md` D-46 (50-220 -> actual).

#### MUST-3. Stop-stand overturning moment arm is understated by 3-5x (N-3 redesign)
Evidence (`front.ts:224`): `Mr = F * hRiser` = F x 0.3125", comment "the face force acts at web level (the web bears on the top plate under overturning)". From the built parts: web bottom (weld plane) z = 7.8125, pad `steer-stop-face-L1` z = 8.188-9.438, so the force line is at about 8.81, **1.0" above the weld plane** and **1.56" above the carrier top** (z 7.25). The web and the riser are both 1.25" wide and the web cannot rotate onto the turntable top plate (z 7.75, 1/16" below the web) about the toe of the riser, so the "bears on the top plate" assumption does not hold in the elastic range (it would need a 5.7 degree tilt of a welded stand, my arithmetic).
Recomputed at the stiff-pad force (F = 1,013 lbf at 150 lb, 1,125 lbf at 200 lb): arm-screw couple force M/(0.93 + 0.55) = 1,070 lbf (150) / 1,188 lbf (200) instead of 288 / 320. The row `arm toe on the carrier, onto the beam top (oak perpendicular)`, which the code reads at 158 / 175 psi (0.44 / 0.49), becomes about 586 / 651 psi against 358 psi allowable: **1.6 / 1.8x**. Weld rows go 0.54 -> about 0.58 and 0.61 -> about 0.65; screw tension and thread stripping stay under 0.7. (These are my recomputation outside the repo, not a row.)
Fix: put the overturning arm at the pad centroid above the weld plane for the weld and riser rows and above the carrier for the arm/toe rows, with the lever to the toe of the arm (1.48"), then fix the toe: widen the arm from 1.87" to about 2.6" (lever 1.8", toe area up) and lengthen it, or add a second pair of screws, or weld the stand to a carrier tab; or lower the pad (a 1.25" dog instead of 1.625"). Add a hand-anchored test.
Files: `src/analysis/front.ts` (`stopDetails`: `Mr`, `Tarm`, `toeA`, `levArm`), `src/model/steering.ts` (arm outline), `src/params.ts` (arm width param if added), `src/analysis/front.test.ts`.

### SHOULD

#### S-1. Weld specification, sequence and inspection (section 2e)
Add to the part notes and BOM: process and qualification, fabrication order (weld, flatten/machine, tap/ream, finish), the ear note contradiction, masking for galvanizing, no electroplated grade 8, dye-penetrant on the pivot post and stop stands, and the proof load. Add a plate-flexure row (or a one-line statement of the rail backing) for the pivot ear. Decide welding with Eric first (Decisions 3).
Files: `src/model/steering.ts` (ear note), `src/model/brake.ts` (plate and post notes), `src/model/stops.ts`, `src/model/build-utils.ts` (assembly text), `DECISIONS.md` D-46/D-48.

#### S-2. S-bend torsion and bent-lamination capacity, and a bend trial
Add a simple frame or hand model for the side-beam torsion through the curve (or state the deck/joist/shoulder-beam couple that carries it with a number), apply an explicit curvature reduction to the rail/chine bending allowable (assume 0.5 until tested), and require a bend trial (the 5.0" radius, 6 plies x 4" wide, white oak, with the real glue) before the form is built. Also record the spring-back compensation against the 0.75" tire clearance.
Files: `src/analysis/structure.ts` (`railsCheck`), `src/params.ts` (`hullLamMinRadiusFactor` note, status verify), `docs/hull-curve-notes.md`, `DECISIONS.md` D-45.

#### S-3. Finger guard silently disappears
`sheerLengthIn` >= 21 (at the default 2.5" rise) drops `guard-L/R` from the build and `validateParams` returns no issue (verified: 18 -> guards present; 21, 24, 30 -> none, zero issues). `infeasible` is set in `fingerAnalysis` (`body.ts:381`) but never surfaced. The default (18) has 2.3" of slack. Also still no `finger-gap` analysis row for the 0.75" neck, which is in the 0.25-1.25" entrapment band.
Fix: add the validator error, add the row, and cap `sheerLengthIn` at nose length minus guard zone.
Files: `src/params.ts` (`validateParams`, `sheerLengthIn` max), `src/model/body.ts`, `src/analysis/` (new row), `src/analysis/rider-sweep.ts`.

#### S-4. Brake leftovers
Put "chock the wheels on a slope" in the kit list and on the lever label; run a feel test of the 5.7" travel on the mock-up; state the glued-composite shear sharing (or apply NDS d_n/d: 1.32) in `rear-beam-seat`; show the plate-ear flexure.
Files: `src/analysis/rear.ts`, `src/model/brake.ts` (label, kit), `docs/STATUS.md`.

#### S-5. Wheel rating placeholders
`wheelRatingLb` 300, peak multiple 2 and side fraction 0.5 are all unsourced. The peak multiple lets a 3x impact load reach twice the rated value. Read the real rating off the vendor listing before ordering and tighten the multiple to 1.25-1.5 unless the vendor says otherwise.
Files: `src/params.ts`, `src/analysis/rear.ts`.

#### S-6. Decision bookkeeping (N-11 leftover)
Consolidate D-43 (a stub) into the entries that now carry its content; make the code cite D-46 for the F1 content; update D-46 to the actual 50-210 / green 170; fix `src/test-baselines.ts` comments citing "D-35" for the front end.
Files: `DECISIONS.md`, `src/params.ts`, `src/analysis/front.ts`, `src/model/steering.ts`, `src/model/kingpin-plates.ts`.

### NICE

- **Lift.** Transport mass is 160.2 lb: the rear lifter carries 83.2 lb on one hand (up from 77.4 in round 2), the front 76.9 lb. The slot bar passes (0.62) but the human load is not judged. See Decisions 4.
- **Bolster ends.** The bolster end rails (y +/-7.56") stand 0.56" outside the nose side (+/-7.0"), under the chine, just behind the front tire. Check how it looks and snags in the viewer; cap or taper if it reads as a shin hazard.
- **Ground friction.** `slide-before-tip` still depends on `tireGroundMu` (round-2 NICE); add a speed note.
- **Marginal rows at 200 lb.** `bearing-groove` 0.93, `steer-stops` 0.96 (0.98 at 210), `deck` 0.90 (210), `rear-beam-seat` 0.90 (210). The goal rider is on a knife edge for four rows, which is another reason not to quote 200.
- **Geometry margins.** `turn-radius` 93.4 vs 96" and `steer-clear` 0.75 vs 0.70" are both marginal at every rider weight.
- **Cold event.** Urethane, ASA and printed parts at winter temperatures (the stiff pad bound of 3,000 psi is meant to cover this, no data).
- **Weak link ordering.** Document that the eye bolt and the pivot post are the intended fuses.

## 4. Decisions for Eric

| # | Decision | Why it is yours |
|---|---|---|
| 1 | **Turntable.** Which bearing, and which margin convention for the strike event (the 3x factor is already in the load; 2x on a static rating double counts)? A named bearing with a published moment rating, or the UHMW thrust ring on steel plates you build yourself. | Cost, lead time, and whether you want to stand behind a vendor's unpublished number. |
| 2 | **Rider limit wording.** The Simple view computes "safe 50-210, green to 170". I recommend saying: **150 lb verified (required); comfortable to 170; 200 lb is the goal, not demonstrated until the Phase 4 front-end bench test passes.** Do not advertise 210 or 220 (D-46 still says 220). | D-1 makes 200 a goal, not a requirement. Four rows are within 10% of their limits at 200 lb. |
| 3 | **Welding.** The shop has no welder (D-46). Five weldments: two ears, two stop stands, one pivot post. Outsource them with the laser-cut plates (qualified welder, penetrant check, proof load), or accept redesigns: a bolted post with an outboard cheek for the brake pivot, bolted/machined stop blocks, and no ear credit in the front end. | Cost, who certifies it, and whether a Scout-built cart should have structural welds at all. |
| 4 | **Weight and lift.** Empty 169.0 lb, transport 160.2 lb; the rear lifter carries 83 lb in one hand. Options: four-person lift with side hand-holds, a loading ramp or dolly, a second slot per end, or the lightweight variant (D-21; the 60-70 lb target in the brief). | Safety policy for youth lifting, and whether the heavy design stays the baseline. |
| 5 | **Brake abuse load and chock rule.** 100 lbf at the grip with the pivot post as the fuse (0.89 of yield) is my recommendation; raise it only if you want the post stronger. Chock is a kit-list item. | Policy about what an adult or a heavy Scout may do to the lever. |
| 6 | **Bend test.** Authorize a one-day bend trial and a form before any cut: 5.0" inside radius, 6 plies of 1/8" x 4" white oak, S-curve form with spring-back compensation. If it fails: thinner strips (more plies), steaming, or an earlier curve start (the auto path moves it earlier). | Shop time before the build and a possible change to the hull outline. |
| 7 | **Front-end bench test.** Authorize a half-day mock-up of the beam, carrier, plates, one stop pair and a pad sample, with a dial indicator and a torque wrench, to settle ear share, pad k and fit-up. | It is the cheapest way to turn MUST-2 into data. |
| 8 | **Vendor lines that block the order.** Turntable bearing (diameter, plate thickness, tilt rating), wheel rating from the real listing, pad durometer sample, lining sample. | Purchases. |

## 5. Phase 4 verify list

Ear share (dial indicator across the plates at 1.0x torque); pad k at about 20 F and 90 F; stops shimmed to a 0.003" feeler and repeatable to 0.018"; lower-plate thickness, ring diameter and tilt rating of the actual turntable; carrier bolt thread length (shank in the shear plane) and torque (7.8 lb-ft) with retorque after the first wet day; grade 8 coating (no galvanizing); weld procedure and penetrant on the pivot post and stop stands; 5.7" lever feel test and a chock procedure; bend trial and spring-back; the real wheel rating; rear U-bolt and hold-down drawing; Domino face width on the real DF 500; the S-curve clearance to the tire with the built hull; the lift with real people (transport 160 lb).

## 6. How to reproduce

Scripts live in `/private/tmp/r3/` (outside the repo) and are run as `node scripts/run-ts.mjs /private/tmp/r3/<file>`:
- `a.ts` all check rows at the defaults; `t.ts` and `h.ts` details and prose for chosen ids and rider weights (`IDS=...,W=...`); `p.ts` runChecks with parameter overrides (`V='{"name":{"param":value}}'`).
- `s.ts` and `s2.ts` the `riderSweep` sensitivity table in 2b; `w.ts` failing/marginal rows at 80, 150, 170, 200, 210 lb.
- `ov.ts` recomputes the stop-stand overturning arms and toe pressure (MUST-3); `g.ts` dumps the stop-stand z extents.
- `q.ts` the finger-guard disappearance; `z.ts` a 150-design parameter fuzz (68 valid designs: no exceptions, no NaN).

The ids and numbers cited in this file come from those runs on commit 5e3bc1f.
