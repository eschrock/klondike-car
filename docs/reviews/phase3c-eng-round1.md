SCORE: 8/10

# Phase 3c engineering critic, round 1

Scope: the working tree at `main` (2557811) plus the uncommitted edit Eric made while this review ran (`handleSocketDepthIn` 12 to 14 in, with its test updates). `npm test`: 1,385 tests in 43 files pass on that tree. Every number below comes from `runChecks` on the real code or from a throwaway script (kept in `/private/tmp/r3c/`, not in the repo; recipes in section 7). Where a number is my own estimate and not from the code I say so.

Calibration used: wagons, garden carts and billy carts at walking pace, a supervised event, a 200 lb post-race load. I did not invent load cases outside that. Where the code is cautious and the real-world answer is the same, I say "fine" and move on.

## Why 8

This is a sound design that a competent engineer would sign for a supervised scout event and post-race hauling, with the verification list in section 5. In round 3 of Phase 3 the grade was 7 because the front end rested on an assumed vendor plate and an ungated info row. All of that is gone: the load paths now run through parts the build actually contains (oak, grade-8 bolt, UHMW, chain), the rows are hand-checkable, and nothing I tried is a safety-level problem. The bump model, which Eric rightly attacked, now holds up against an independent simulation.

Why not 9:

1. **One real defect existed at HEAD** and was closed during this review: with the 12 in handle sockets the riding-position retaining pin sat 0.19 in above the foot of the post (MUST-1). The 14 in change cures it; it needs to be committed with a guard so it cannot come back.
2. **The bridle hardware is not buildable as specified**, and the "shackle pin is the intended weak link" logic does not describe any real part (MUST-2). The lightest fix removes weight.
3. **The numbers that decide the front end and the rear beam are single assumptions marked verify**: the 500 lb/in tire rate, the 300 lb wheel rating and the 70 ksi tube. The design is robust to most of them (section 1d), but the first row to flip is the front beam's groove wall under a hard hit with the 200 lb load forward, at only 1.12 times the assumed tire rate.

With MUST-1 committed, MUST-2 fixed and the wheel squash test done, this is a 9.

## 1. Load cases and the bump model

### a. The bump pulse, checked independently

The coded pulse is `F_n = v_n sqrt(k m_e)` with the rigid-body corner weight `W_c = W / (1 + x²/ky² + y²/kx²)` for the struck wheel. My hand check of the rear wheel, 200 lb goal rider, 1 in step at 3 mph: W = 345.6 lb, CG 16.48 in ahead of the rear axle, wheel at (-16.48, 16) from the CG, ky = 44/sqrt(12) = 12.70, kx = 33.25/sqrt(12) = 9.60: W_c = 345.6 / (1 + 1.684 + 2.778) = 63.3 lb; m_e = 0.1639 lb s²/in; v_n = 0.6 x 52.8 = 31.7 in/s; F_n = 31.7 x sqrt(500 x 0.1639) = 286.9 lbf; V = 229.5, H = 172.1. The code prints 287 / 229 / 172. Exact.

Then a stronger test, which the repo did not have: a 3-DOF rigid body (bounce, pitch, roll) on four 500 lb/in tire springs, the struck wheel's hub driven up the step along the 5 in radius arc at constant horizontal speed (script `bump3dof.mjs`). Peak force on the struck tire, static load included:

| Case | Code (V + static) | 3-DOF, uniform plate inertia | 3-DOF, mass bunched at the middle |
|---|---|---|---|
| 200 lb rider, rear, 1 in at 3 mph | 337 | 353 (+5%) | n/a |
| 200 lb rider, front, 1 in at 3 mph | 258 | 270 (+5%) | n/a |
| 200 lb cargo aft, rear, 1 in at 3 mph | 346 | 361 (+4%) | 326 (-6%) |
| 200 lb cargo forward, front, 1 in at 3 mph | 391 | 386 (-1%) | 352 (-10%) |
| 200 lb rider, rear, 2 in at 5 mph (hard) | 490 | 678 (+38%) | n/a |
| 200 lb cargo forward, front, 2 in at 5 mph (hard) | 556 | 724 (+30%) | 651 (+17%) |

Verdict: **the normal-use model is right within about 5 to 10%** (the mass-share worry in the 3c-3b notes does not bite: the code's plate inertia over the wheel footprint is, if anything, slightly high for roll). The hard-hit pulse is 30 to 40% low against an arc-input model. The reason is that the code applies the vertical corner mass along the contact normal (the proper normal-direction mass is `1 / (cos²b/M + sin²b/m_c)`, 133 lb for the 2 in step against the 63 lb used). I do **not** recommend changing it. The hard hit is a fail-safe case, my model has no tire damping and no pullers, and Eric's calibration is the right philosophy. What matters is the margin, and I measured that directly: with every bump force multiplied by 1.41 (`bumpMassShare` 2) the **only** hard-basis detail that exceeds its limit is the oak groove wall under the front stub (a dent, not a break); no bolt, axle, wheel retention or joint reaches its ultimate. So the fail-safe claim of D-50 holds even if the hard hit is really 40% worse than modeled.

### b. What the design needs from the tire (the pre-order gate)

Rows above 1.0 as the tire rate `bumpWheelRateLbIn` is raised (everything else at the defaults):

| k (lb/in) | Rows over their limit |
|---|---|
| 500 (assumed) | none |
| 600 | front-beam, 200 lb cargo forward, hard-hit groove wall 1.03 |
| 800 | adds rear-beam-seat (1.00 for the 200 lb rider), bearing-groove and king-bearing (cargo 1.02 to 1.03) |
| 1,000 | front-beam 1.32 (cargo), rear-beam-seat 1.08, bearing-groove 1.07, king-bearing 1.14 |
| 2,000 and up | axle bending, wheel rating and the steering chains join |

So the design passes as modeled only if the real rate is below about 560 lb/in with the load forward (about 800 for the rider cases). The cheap test is already in the notes and should be a gate: tire at 30 psi, a known weight over one wheel, measure the squash. **A squash of 0.55 in or more at 300 lb means everything passes as built; 0.4 to 0.55 in means lengthen the outer front clamp plate (S-3); under 0.4 in, stop and re-run.** Flat-free or foam-filled wheels are several times stiffer than this and are **not modeled** (S-4).

### c. Cases a real sled sees that the model does not carry, and my verdicts

| Case | Verdict |
|---|---|
| Bridle snatch at the start of a run (slack, then taut) | Not covered by 150 lbf x 2. My estimate (rope plus pullers about 100 lb/in, sled 320 lb, 2 to 4 mph relative speed): 320 to 640 lbf. Oak dents (washer crush, kingpin hole edge) but nothing breaks. Cheap fix with no weight: S-1. |
| Dropping one end when lifting (12 in) | Bounded by the existing hard hit. My estimate: about 690 lbf per rear wheel for the empty sled, while the 200 lb rider and cargo hard hits already put 590 to 656 lbf on a rear wheel. No new row needed. |
| Towing on a side slope | Fine. Lateral tip is 48 degrees (150 lb rider) and 42 degrees (cargo) against a 10 to 15 degree slope. |
| Dragging it sideways | Fine. Skid force mu x P is 72 lbf per wheel against 150 (0.5 x the rating); cross-hole thrust 0.04 to 0.10. |
| Kids sitting or leaning on the sides | Not analyzed, see N-1. The free web between chine and gunwale is only 4 to 6 in over most of the length (11 in only in the last 10 in beside the transom), so I expect it to be fine; the row is missing, not the strength. |
| Loading up the tailgate end-first | Same as the dropped end. |
| Snow, ice, cold | The fouled pad (mu 0.25) and the wet chock (mu 0.4) are in the rows; the loaded sled is not held by the chock on ice or wet leaves, and the row says so. |

### d. The dynamic-factor floor

`dynamicFactor` 3 (locked) is still the floor on every seat, rail, deck and joist load, while the bump physics gives 1 + V/W = 1.66 to 1.74. It stacks on the safety factor of 2. It does not cost weight today (rails are set by static deflection, the deck and joists by the static 250 lb adult), so leave it, but it is the one place left where the code is more cautious than D-50 asks.

## 2. The center-pivot front axle

| Item | Finding |
|---|---|
| Kingpin (5/8 in grade 8) | 0.77, set by the hole-edge bearing in the oak axle beam from the nose-up tow couple. Fine. The pull case is the only one that scales fast: at a 250 lbf design pull the row is 1.28 (S-1). |
| Roll pads | 297 psi on the rail underside in the cargo-forward case (0.83), minimum overlap 1.49 in² of 6 over the lock. The rail is 0.75 in wide, so the contact is a narrow strip; a 1/8 in build error moves the overlap a lot. The gap window (0.03 to 0.125 in) is the same size as the seasonal movement of the 2.25 in beam plus the 1.75 in rail (my estimate 0.04 to 0.09 in per 3% MC change): re-set the shim at the event (N-2). |
| Bearing pressure and wear | Disc 49 psi static against 1,000. Wear is negligible: the disc only slides at walking pace and the pads only under a bump. |
| Friction torque against the pullers | Disc: 0.25 x 259 lb x 0.67 x 1.5 in = 65 lb in = 6.3 lbf at the shackle (10.25 in lever, limit 15). A bearing pad adds 28 lbf per 100 lbf of pad force, but only during a bump. The tire scrub at a standstill dominates and is the same on any wagon. Fine. |
| Oak tongue (1-1/4 x 1-3/4 on edge) | 1,245 psi at full lock (0.19). Fine. |
| Shackle | **Not buildable as drawn**: MUST-2. |
| Check chains | 0.39 rider / 0.53 cargo. The coded angular derate of the eye bolt is gentle (60% at 45 degrees). Vendor tables for eye bolts are usually much steeper (often quoted as about 30% at 45 degrees; confirm). If the vendor says 30%, the capacity at the real 33 degree pull angle is about 440 lbf, not 624, and the cargo row becomes about 0.76. It still passes; verify the table (section 8). |
| Front beam and stubs | Front beam 0.86 / 0.94, stub 0.33 / 0.48. The beam's hole at the chain eye bolt is not in the row (S-2); with a proper net section it is 0.75 in the worst case, so it passes. |
| King beam | 0.45 / 0.67, end joint 0.12. Fine. |
| Roll restraint and tip | The 0.0875 in gap is about 0.44 degrees of roll, so the four-wheel polygon used by the tip rows is right. |
| Handling when overrun | The axle has no trail and no centering: when the sled overruns a slack rope on a downhill it will not track straight (N-3). |

## 3. Axle tubes, wheels and the rear beam

- **Tube section.** 3/4 x 0.120 in: I = pi/64 (0.75⁴ - 0.51⁴) = 0.012211 in⁴, S = 0.03256 in³. Matches the code.
- **Rear stub bending, hand check.** Hub center y = 16, plate edge y = 14.25, so a = 1.75 in. R = sqrt(172² + 337.6²) = 379 lbf; M = 663 lb in; sigma = 20.4 ksi against 35 ksi (yield 70 / SF 2): 0.58. Code: 0.58. The hard hit (ultimate 80 / 1.25 = 64 ksi) is 0.59.
- **Strength is only as good as the tube.** 70 ksi is right for DOM or CDS tube to ASTM A513 Type 5 (1020 or 1026). Ordinary ERW "mechanical" tube is about 45 ksi yield / 55 ksi ultimate: the row goes from 0.59 to 0.94 (checked by rerunning with those strengths), no margin. Order DOM and keep the mill cert or the supplier's A513 T5 statement.
- **Cotter cross hole.** 5/32 in at 3/8 in from the end, net section, wheel force at the hub edge (arm 0.625 in), rear goal case: I_net = 0.012211 - (2/3)(0.15625)(0.375³ - 0.255³) = 0.008445 in⁴, sigma = 379 x 0.625 x 0.375 / 0.008445 = 10.5 ksi, 0.30 of the allowable. The code's worst (front, cargo) is 0.34; pin bearing and tear-out 0.04 to 0.10. Fine.
- **Ring bending under the clamp plates.** 0.30 for the wheel load. I also looked at the clamp preload, which is not a row: a 3/8 in bolt torqued to 10 ft lb is about 1,600 lbf, far more than the oak groove (0.75 x 1.5 in at 1,070 psi x 0.67) can carry, so the oak crushes first and caps the preload near 800 lbf (about 22 ksi in the ring). Not a risk, but oak creep will loosen the clamps: re-check the nuts before each event.
- **Tube outside diameter against the wheel bearing.** DOM tolerance is about 0.004 in either way; a sealed ball bearing wants a shaft within a thousandth or two. Check the first wheel on the first tube before ordering four.
- **Wheels.** Static load on the heavier wheel is 108 lb (150 lb rider, rear) and 144 lb (200 lb cargo forward, front) against 300 lb. The peak vertical load is 338 / 391 lbf against 600 (2 x the rating). The rating is a hand-truck listing figure (smooth floors, vertical load); the real limit at a sled's side loads and bumps is probably the rim and the bearing seals, not the stated 300 lb. If the real rating were 200 lb, `rest-load` goes to 1.10 (the 250 lb adult): the rating matters for D-58, not for the bump rows. The lighter wheel and the unknown bearing bore are on the verify list.
- **Rear beam seat.** 0.84 / 0.87. The hanger is 7/8 in x 5 in, glued and bolted to the rail. I read the reaction as going up the hanger by compression and glue shear (22 psi on the 5 x 3 in lap), not by shear at the end of a notched beam, so the NDS notch reduction that the round-3 review worried about does not apply as written, and the row's net-section shear (337 of 400 lbf) is conservative. Fine.

## 4. Structure

| Item | Row | Finding |
|---|---|---|
| Deck 12 mm | 0.57 | Hand check below. |
| Joists (8.5 in, 5/8 in) | 0.65 | Fine. |
| Rails (0.75 x 3) | 0.63 | Set by static deflection; fine. |
| Sides (4 mm okoume) | none | No row (N-1). |
| Bow bulkhead (1-1/2 in) | foot-stop 0.14, lift 0.05 | Very comfortable. |
| Rear transom (1/2 in) | lift 0.67, sockets 0.50 | It carries the handle socket bolts (washer pull-through), the rear lift bar and the bungee eyes. The brake knee bolts to the rail and its backer, not the transom. At 14 in sockets the washer is at 147 psi (0.41). Fine. |
| Seat back, hinge, pins | 0.59 | The stile bends at the stop-block crest; the hinge sees 42 lbf of 250. The 3/8 in latch pins are not a row: they only hold the back against a forward pull (a scout hauling himself up by it) or flat in the bed; a 100 lbf pull is about 270 psi on the 1 in blind hole in the stop block (0.16). Fine. |
| Grab boards | 0.83 | The finger gap (1.5 in against 1.25) governs, not strength. |
| Lash points | 0.71 | Strap tension 79 lbf of 300. Fine. |
| Lid | 0.75 (cargo) | Engraved DO NOT STEP; accepted in D-58. |

Hand check of the deck, 250 lb adult on one foot (4 x 10 in) at the middle of the widest bay: span 8.4 in, b_eff = 10 + 0.625 x 8.4 = 15.25 in, I = 15.25 x 0.472³/12 = 0.1336 in⁴, EI = 810,000 x 0.1336 = 108,200 lb in²; a 4 in patch at the center of a simply supported span gives w c (8L³ - 4L c² + c³) / (384 EI) = 62.5 x 4 x 4,268 / (384 x 108,200) = 0.0257 in against 0.035 (span/240). The code says 0.025. A scout (150 lb) is 0.015 in.

## 5. Stability

- **Tip angles.** Cargo (200 lb, 3 in off center, CG 12 in over the deck): 41.9 degrees against 40, the bare minimum. By hand: edge distance 14.58 in over CG height 15.79 in is 42.7 degrees before the steering sweep takes about a degree. It holds, but it is very sensitive to the cargo CG height, which is an assumption:

  | Cargo CG over the deck | 12 in | 18 in | 24 in |
  |---|---|---|---|
  | Tip angle | 41.9 | 36.0 | 31.4 |
  | Slide before tip (needs 0.75) | 0.90 | 0.73 | 0.61 |

  A coolers-on-firewood stack puts the CG at 18 in. That is still safe at walking pace (a 10 degree side slope plus a 15 degree wheel drop is 25), but it is no longer "slide before tip". Put a load-height rule on the Simple view and a placard (S-5). The 40 degree rule is the brief's, not a physical limit.
- **Turn radius.** 147.6 in: WB / sin 20 degrees = 128.65, plus 17.25 plus 1.75. Matches. It is marginal against the 150 in limit and cannot be improved by a degree of lock because `steer-clear` is 0.855 against 0.75. It is a usability number, not a safety one. Accept it.
- **Pitch-back.** 2.4 to 2.8 times the pull (limit 1.25), 1.84 for the 80 lb rider. Fine.

## 6. The step brake and the handle sockets

- **Slowing.** The flaps at the 90 lbf limit and the fouled pad (mu 0.25) give a pad force of 87 lbf, which holds a 296 lb sled (150 lb rider) up to asin(87.2/295.6) = 17.2 degrees with both feet; the row says 17.17. With one foot the figure is about 8.6 degrees. At a more realistic 45 lbf per foot it is about 9.5 degrees with two feet. The row is honest ("slows, and stops on 10 degrees"), and the hill question stays open until the camp slope is measured (Q-4).
- **Chock.** Passes on dirt (1.13) and fails at the wet mu (0.76); the cargo case climbs the chock (info). The Simple view already says so. The practical rule: face the loaded sled uphill, or put the chocks under the downhill wheels (the front pair when nose-down), because the rear tires are almost unloaded when a forward load is parked facing downhill (N-5).
- **Flap, hinge, knee.** 0.64 / 0.63 / 0.74, the 150 lbf abuse stomp 0.54. The weak part of the knee is the nut washer on the backer face (0.74), which is a dent, not a break. Fine.
- **Handle sockets.** At HEAD (12 in sockets): the post foot sat 1.69 in below the socket mouth and the riding-position pin hole 1.5 in below the mouth, **0.19 in above the foot of the post**, so the hole's lower edge had 0.036 in of wood under it. The pin could not retain anything, and the row's bearing assumption (`contact = depth/4 = 3 in`) was longer than the post's real insertion. With 14 in sockets (Eric's edit): insertion 3.69 in, pin 2.19 in from the foot (7 pin diameters), mouth reaction 106 lbf per post against 194 at 12 in, row 0.50. The model mass is +0.46 lb (the posts also get 2 in longer), not the +0.2 lb quoted. Fine, and cheap.
- **Handle strength.** Each post fails in bending at about 105 lbf at the grip (11/16 in oak, 12 in lever, 12.9 ksi), so 210 lbf total at the handlebow. A musher who slips on ice and hangs on will break a post, probably cleanly at the mouth. That is the right weakest link for a handle that must not hurt anyone; no change.

## 7. Findings

### MUST

**MUST-1. Commit the 14 in handle sockets and add a guard (closed in the working tree; not committed).**
Evidence: section 6. At HEAD the 12 in socket leaves the post pin hole 0.19 in from the post foot (`zPin - zFoot` = 0.19 in); no row or `validateParams` check sees it. Lightest fix: commit Eric's `handleSocketDepthIn` 14 (+0.46 lb in the model), and add to `validateParams` an error when the riding-position pin is closer than 4 pin diameters (1.25 in) to the post foot, and a warning when the insertion is under 3 in. Also cap the bearing contact length at the insertion in `handleSockets` (`contact = min(lEff, depth/4)`), and fix the two stale texts (the `handleSocketDepthIn` note and D-60 still say "about 1.7 in"). Files: `src/params.ts`, `src/analysis/brake.ts`, `DECISIONS.md`.

**MUST-2. The bridle hardware does not exist as specified, and there is no real "weak link".**
Evidence: `bridleEye` assumes a 1/2 in pin across a 1.5 in jaw gap (tongue 1.25 in plus 1/4 in). A catalog 1/2 in screw-pin shackle has a jaw of about 13/16 in (my recollection of the standard drop-forged table; confirm on the vendor listing); the tongue needs a 7/8 to 1 in shackle (about 1.5 to 2.5 lb, rated at several tons) or a thinned tip. A real shackle is hundreds of times stronger than 300 lbf, so the line in the BOM and the notes that the pin is the intended weak link (D-47) is not true of any part you can buy; nothing in the chain is designed to let go first (and a rope breaking under load is not something to design for). The tie row passes at 0.63 with nothing to say about the real part. Lightest fix, and it saves 0.59 lb: drop the shackle. Tie the rope through the bronze sleeve (a 1 in OD sleeve takes a 1/2 in rope and a bowline or an eye splice with a thimble), check the sleeve edge is rounded, and delete the weak-link wording in `bridle.ts`, `pivot.ts` and D-47. If Eric wants a hardware tie, specify the shackle that fits and the number. Files: `src/model/bridle.ts`, `src/model/pivot.ts`, `src/analysis/bridle.ts`.

### SHOULD

**S-1. Cap the start-up snatch with a shock section; use nylon, not low-stretch polyester.**
Evidence: section 1c. The BOM specifies 1/2 in braided polyester "low stretch", which is the worst choice for a rope that goes taut from slack. A 3 ft shock-cord (bungee) section in the bridle, about 10 lb/in, caps the snatch at roughly 100 to 200 lbf for the same speeds; 1/2 in nylon double-braid cuts it by about a third. The tongue and kingpin rows reach their design limits at 390 to 480 lbf (kingpin hole edge 0.77 at 300; nut washer 0.63; kingpin row 1.28 at a 250 lbf design pull), so this is protection against dents and wear rather than breakage. Zero weight, a few dollars. Files: `src/model/bridle.ts` (rope text).

**S-2. Front-beam chain eye bolt: move the hole and add the missing section.**
Evidence: the 3/8 in eye bolt goes fore-aft through the beam at mid depth of the full 2.25 in beam (z = 4.25 in), but the stub groove occupies the top 0.75 in there, so the hole's top edge is 0.17 in below the groove floor: a 0.17 in wafer of oak that will split in drilling. The row `front-beam` does not look at this section at all. With the proper net section (hole 0.406 in at 0.375 in above the neutral axis of the 1.5 in lower part: S_net 0.555 against 0.938) the stress is 4.8 ksi (0.75) in the 200 lb cargo-forward case and 6.9 ksi (0.53 of MOR) in the hard hit, so it passes, but it would become the governing detail of the row. Lightest fix, zero weight: center the hole in the ligament under the groove, `beamZ = (beamBot + beamTop - axleDiameterIn) / 2` in `steerGeometry` (z = 3.875 in): the net section loses under 1% and the wafer is gone. Also add the net-section detail to `frontBeamCheck`. (Moving `steerChainBeamYIn` from 10.4 to 12.5 in would also cut the moment by 30% with no other row changing: steer-stops 0.40 / 0.55, steer-clear unchanged. Either helps; the first removes the wafer.) Files: `src/params.ts` (`steerGeometry`), `src/analysis/front.ts`.

**S-3. Front stub groove wall: the thinnest hard-hit margin on the sled.**
Evidence: `front-beam`, "HARD: fore-aft bump force on the groove wall", 672 of 717 psi (0.94) in the 200 lb cargo-forward case. It flips at a tire rate of 560 lb/in (section 1b) and at 1.4 times the hard force. It is a dent, not a break, but a dented groove lets the stub toe in and out. Lightest fix: lengthen the outer front clamp plate from 1.5 to 2 in along the stub (the beam end is 15.98 in out, the station ends at 15.73, so the station moves inboard 0.5 in): the wall stress falls by 25% (0.70), +0.03 lb. Alternative: a 1/16 in aluminum or steel strip lining the groove walls under the outer station. Files: `src/params.ts` (a front-only plate length; the rear plates are already close to the beam end), `src/model/pivot.ts`.

**S-4. The flat-free tire option is silently invalid.**
Evidence: `tireType` flat-free only changes the mass (`params.ts` line 1948); the bump rate stays 500 lb/in. A PU foam-filled hand-truck tire is several times stiffer (section 1b: at 2,000 lb/in half the structure rows fail). Lightest fix: make `validateParams` return an error for `flatFree` unless `bumpWheelRateLbIn` is set from a measurement, or scale the rate by a documented factor when the option is selected. Files: `src/params.ts`.

**S-5. Cargo height: put the rule where the loaders will see it.**
Evidence: section 5. The cargo tip margin goes from 41.9 to 36.0 degrees between a 12 in and an 18 in CG, and the slide-before-tip margin disappears at 18 in. Lightest fix: a line in the Simple view and on the sled ("heavy things low, on the deck; keep the load's center under 12 in; strap it") and an info row that prints the cargo CG height at which the tip row reaches 40 degrees (about 12.5 in). No hardware. Files: `src/ui/simple-text.ts`, `src/analysis/stability.ts`.

**S-6. Verify and document the clamp and tube details that are not rows.**
Evidence: section 3. Tube OD against bearing fit; the clamp preload is capped by the oak (about 800 lbf per clamp) and the oak creeps, so clamps loosen; the ring check is for the wheel load only. Lightest fix: add to the build notes "snug plus a quarter turn, re-check each event, do not over-torque" and a drawing note on the axle tolerance. Files: `src/model/axle-stock.ts` (the sourcing text).

### NICE

- **N-1. A row for a lateral push on the sides.** D-60 took the web from 6 to 4 mm, which cut its out-of-plane stiffness by 3.4 times (cube law) and nothing measures it. My crude bounds: the free web is 11 in tall in the last 10 in beside the transom (supported by it) and 4 to 6 in over the rest; a cantilever strip of 4 mm okoume yields at about 1.5 lb/in of side per 11 in of height and about 4.5 lb/in at 4 in. A 50 lbf lean over 20 in of gunwale at the middle of the sled is fine; a person sitting on the rear gunwale needs the row. Add one: 50 lbf lateral on the gunwale top at the middle and at the tallest section.
- **N-2. Roll pad gap.** Make the pad shim a printed, labeled part (0.03 to 0.125 in window) and re-check it after a wet week. The current method (tape under the pad) works; a labeled shim stack is better.
- **N-3. Neutral front axle.** There is no trail and no centering. Fine on a taut rope; when the sled overruns the pullers downhill it will not track. A 3 to 5 degree kingpin rake would cure it at no weight, but it changes the roll-pad geometry; I would leave it and tell the pullers to keep the rope taut and the musher to brake early. Decision for Eric.
- **N-4. Kingpin head.** The head and its plate washer hang 0.45 in below the beam: 2.67 in off the ground, the lowest point of the sled (the row text says the model test exempts it). A counterbore in the beam bottom (the beam is 2.25 in deep) or a low-profile head puts it above 3 in.
- **N-5. Parking.** Face uphill, chocks under the downhill wheels (the front pair when nose-down); say so on the sled and in the Simple view.
- **N-6. Tire to body at full lock: 0.855 in.** The row passes at 0.75 in; but it is a finger-sized gap. A flap of leather or a foam strip on the side at the pinch zone is cheaper than a rule.
- **N-7. Stale text.** `handleSocketDepthIn` note and D-60 ("about 1.7 in of post"), the `steerEyeWllLb` note ("60 percent at 45 degrees"), and D-60 "Only ~1.7 in". Update with MUST-1.

## 8. Items to verify before ordering

1. **Tire squash test (the one that matters).** 30 psi, a known weight over one wheel, a ruler: squash at 300 lb of 0.55 in or more is a pass.
2. **Wheel.** Rating 300 lb continuous and not "intermittent"; bore 3/4 in with sealed ball bearings, not a bushing; hub 2.28 in; mass 2.8 lb (weigh it); rim material.
3. **Axle tube.** DOM or CDS to ASTM A513 Type 5, 1020 or 1026, yield 70 ksi minimum; OD tolerance against the bearing; a mill cert.
4. **Eye bolts and chain.** 3/8 in shoulder eye bolt: the in-line WLL (900?) and the vendor's angular table; 3/16 in chain: the grade and WLL (a Grade 30 3/16 in chain may be rated about 800 lb, not 1,000; the row goes 0.53 to 0.66).
5. **Bridle.** Rope type (nylon double-braid or shock cord), the tie method (MUST-2).
6. **UHMW disc and pads.** Natural or black, the 1,000 psi allowable (assumed).
7. **Camp slope (Q-4).** The steepest grade. Above about 10 degrees the loaded sled is walked down (D-57).
8. **Okoume.** BS 1088 for all of the 4 mm panels; the epoxy wetted into the grooves.
9. **Mock-up.** The pad gap at the lock angle, the chain going taut at exactly 20 degrees, the handle pin positions riding and parked, the grip travel and the foot stroke of the flaps.
10. **Weigh the first parts.** The 120.6 lb is a sum of listed masses; wheels, shackle and eye bolts are the unknowns.

## 9. Decisions for Eric

1. **Bridle tie (MUST-2).** Rope through the bronze sleeve (lightest, no shackle), or the right shackle.
2. **Shock section (S-1).** Add 3 ft of shock cord to the bridle, or use nylon only?
3. **Flat-free tires (S-4).** If you want them, we re-run with a measured rate; I would not take them.
4. **Cargo height rule (S-5).** A printed placard and the Simple-view line, or accept the 40 degree margin as is.
5. **Neutral front axle (N-3).** Leave it (my recommendation), or add trail.
6. **Dynamic factor 3 (section 1d).** Keep it locked; it costs nothing today.
7. **Turn radius 148 in (limit 150).** Accept as a usability number.
8. **Rider restraint.** D-53 removed the lap belt; at walking pace and 50 to 250 lb I agree, with a helmet and hands on the grab boards, and the musher watching the rider on hills.

## 10. Recipes for the numbers

All scripts in `/private/tmp/r3c/` run with `node scripts/run-ts.mjs <file>` except the simulation, which is plain `node`.

- `rows.ts`, `details.ts`, `how.ts`: every row, its details and its text at the defaults.
- `hand.ts`: wheel loads and bump pulses for the empty, 150 lb, 200 lb and both cargo cases.
- `bump3dof.mjs`: the independent 3-DOF bump check of section 1a.
- `sens.ts`, `sweep.ts`, `kbreak.ts`, `hard.ts`: cargo height, tire rate, mass-share and the other sensitivity runs.
- `handle.ts`, `eyehole.ts`, `eye2.ts`, `net.ts`, `pad.ts`: the socket geometry, the beam section at the eye bolt, the moved-hole variants, the net-section arithmetic, the roll pad.
