# Phase 3b WS-D notes: loads and analysis (Stage 1)

Status: Stage 1 code and tests done; `npm run typecheck` clean and `npx vitest run src/analysis src/ui` green (254 tests) at the time of writing. The old front-end rows are untouched and still run by default. Nothing here was committed.

## 1. How the switch works

`Ctx.newFront` (`analysis/context.ts`) is true when the model contains `spindle-L` (WS-A's part), or when forced: `makeContext(p, parts, { newFront: true })` and `runChecks(p, { newFront: true })`. When false, `runChecks` runs `oldRows` (exactly the pre-Phase-3b list). When true it runs `ackermannRows`: Ackermann contacts, bump load basis, the new front-end and linkage rows, ride rows. Tests use `ack-test-utils.ts` (`ackCtx`) which forces the flag on the old model, so the new rows are exercised before A1 lands. Numbers below were produced that way (old model parts, `phase3bDefaults()`), so mass-dependent values will move when A1/B land.

## 2. Bump model (`analysis/bump.ts`)

Velocity pulse per spec 5.1: `sin(beta) = (r-h)/r`, `v_n = v cos(beta)`, `m_e = bumpMassShare x static/g`, `F_n = v_n sqrt(k m_e)`, `H = F_n cos(beta)`, `V = F_n sin(beta)`; h capped at 0.9 r. API: `bumpPulse` (plain numbers), `bumpStrike(ctx, c, wheel, h, kScale)`, `bumpCases`, `bumpSeatG`/`bumpSeatGHard` (1 + V_rear/W), `seatFactor` (= `max(dynamicFactor, bumpSeatG)` on the new basis, `dynamicFactor` on the old), `peakVertical` (V plus the static wheel load), `sensitivityText` (k x 0.5 and x 2.5 line in every bump row), `goodmanPulsating`. Hand check: 65 lb front wheel, 1 inch, 10 mph, k 400: F_n = 943, H 503, V 798 (test).

Deviation from the spec: structural rows use **V + the static wheel load** as the vertical force (the tire still carries its static load while the obstacle pushes). The spec quotes V alone; this is 8-12% more conservative. Say so if you prefer the literal V.

Numbers at the defaults (`phase3bDefaults()`, old-model masses; static wheel load in lb, then F_n / H / V in lbf):

| Case | Front 1" normal | Front 2" hard | Rear 1" normal | Rear 2" hard |
|---|---|---|---|---|
| 150 lb rider | 81 lb: 1,054 / 562 / 892 | 1,428 / 1,030 / 988 | 110 lb: 1,226 / 653 / 1,038 | 1,660 / 1,198 / 1,149 |
| 200 lb rider | 93 lb: 1,128 / 601 / 955 | 1,528 / 1,102 / 1,058 | 126 lb: 1,312 / 699 / 1,110 | 1,776 / 1,282 / 1,230 |

The wheel loads are bigger than the spec's 65/100 lb because the old model weighs 178 lb and the 200 lb rider is the second row; `bumpSeatG` is about 3.9 to 4.0 (spec 3.9).

## 3. New rows (values at the operating 150 lb / goal 200 lb rider, utilization = demand / capacity, forced new basis on the OLD parts, `phase3bDefaults()`)

Basis: NORMAL = 1 inch bump, steel yield / `steelSafetyFactor`, bearing 0.9 Fy; HARD = 2 inch hit, steel ultimate / `failSafeFactor` (1.25), shear 0.6 Fu, bearing 1.5 Fu; the bolts/beam bend before they break (elastic stress vs ultimate). I added about 30 material/detail params in `params.ts` (`axleUltimatePsi`, `frontBeamUltimatePsi`, `kingpinUltimatePsi`, `bracketSteel*`, `linkRod*`, `rodEndRatingLbf`, `stickCableBreakLbf`, `spindleBossRadiusIn`, `spindleBossLengthIn`, `steerArm*`, `bellcrank*`, `tongueHingePinDiaIn`, `tongueClevisThickIn`, the wheel nut/cotter set, `rutWallLateralFrac`, `tireCorneringPerDeg`, `tirePneumaticTrailIn`, `holdDownBoltUltimatePsi`, ...). All are `assumed` or `verify` with notes.

| Row | Status | Util 150 / 200 | Governing detail |
|---|---|---|---|
| spindle-stub (25 mm) | pass | 0.54 / 0.58 | normal stub bending 29 ksi vs 50 |
| spindle-fatigue | marginal | 0.81 / 0.93 | kingpin bolt Goodman n 1.61 vs 1.5 (stub n is 9) |
| wheel-retention | marginal | 0.91 / 0.97 | stub bending with F_lat x 6.5" plus bump: 97 ksi vs 100 |
| kingpin-bolt (3/8") | FAIL | 2.75 / 2.95 | bolt bending 192 ksi vs 65 (normal) and 2.2x at the hard hit |
| kingpin-bracket (3/16" leaf) | FAIL | 5.04 / 5.42 | leaf bending out of plane (thrust through a short cantilever) |
| beam-front (2x2x0.120) | marginal | 0.91 / 0.98 | normal von Mises 22.5 ksi vs 23 |
| tie-rod | FAIL (just) | 1.03 / 1.10 | Euler P_cr/SF 600 lbf vs 658 lbf normal bump kickback; steering arm bending at 1.0 |
| drag-link | pass | 0.66 / 0.66 | rod end rating / SF |
| bellcrank (1/4 x 1.25") | FAIL | 2.64 / 2.64 | arm bending |
| steer-stop-load | pass | 0.80 / 0.86 | window plate bearing under the mode pin |
| tongue | marginal | 0.95 / 0.95 | oak lateral bending at the hinge (old tongue logic) |
| tongue-tie | FAIL | 1.32 / 1.32 | eye bolt shank (see below) |
| stick-cable (3/4 x 0.065 tube) | FAIL | 2.17 / 2.17 | stick tube bending; cable tension 560 lbf vs 486 (MBS / 3.5) |
| steer-kin / steer-lock | pass | worst error 0.59 deg; tongue yaw 21.9 vs 25 deg | |
| ride-rollover | pass | 0.42 / 0.45 | 0.26 g at 10 mph at the ride lock vs 0.5 x SSF 0.6 |
| ride-envelope (info) | info | | worst-bias 0.21 g at 8 deg / mu 0.4, 0.25 g at 10 deg / mu 0.5: both GO |
| turn-radius | marginal | | 106.1" = 8.84 ft (mean IC; 8.81 / 8.87 from the two axle lines) vs 108 |
| tip-lock (tow and ride lock) | pass | 0.70 / 0.72 | 50 deg vs 35 |

Info rows `steer-centering` (39.7 lb.in/deg total) and `ride-steer-effort` (about 7.7 lbf at the grip to hold 5 deg; the study's "2 lbf" used a smaller aligning moment) report only.

**Failures to report honestly (not tuned away):**
1. **kingpin-bolt:** a 3/8" bolt cannot carry a 1" bump through a 3" scrub arm; a 1/2" bolt (max of the param range) still gives about 1.2. The scrub radius (D-53 open question 3) is the driver. Bolt bending falls with the cube of the diameter (tested).
2. **kingpin-bracket:** the 3/16" leaf is a 0.7" cantilever taking the whole wheel thrust: it needs about 3/8" plate or a gusset, or the thrust must go through the bolt/bearing instead of the leaf.
3. **tie-rod:** a 1/2" rod, 27" long, buckles at about 1,200 lbf; the normal bump kickback is 650 lbf, SF 2 is 600. A 5/8" rod (P_cr 2,900) clears it. At the hard hit the rod buckling is reported as the intended fuse (not scored).
4. **bellcrank, stick tube:** my assumed sections (1/4" x 1.25" arms, 3/4" x 0.065" tube) are too small by 2x; they are assumptions I made, not spec numbers.
5. **tongue-tie:** a vertical eye bolt through the tongue puts the horizontal pull across the shank (bending over the eye offset). A horizontal eye (fore-aft) or a bigger eye bolt fixes it; the old rope-leg tie had the pull along the shank.
6. **Rear end on the bump basis (spec 12 risk 8 happened):** wheel-rating 1.91 / 2.06 (peak vertical 1,236 lbf vs 2 x 300), rear-beam-seat 4.4 / 4.7 (the struck wheel's 1,236 lbf all goes into one rail's notch: shear on the net section), axle-stress 1.8 / 2.0 (68 ksi vs 35; the hard hit is 1.32), bearing-groove 2.9 / 3.1. Likely fixes: 1" rear axle, a rated wheel (about 600 lb), reinforce the rail notch, or a lower ride speed over rough ground. The result moves with `bumpWheelRateLbIn` (400 lb/in, `verify`); the sensitivity line in each row shows k x 0.5 and x 2.5.
7. `steer-clear` shows a large negative value in my forced-flag runs only because the OLD wheels are swept with the NEW poses; it is meaningless until A1 lands (the machinery is tested with synthetic parts, min clearance 0.75 where it should be).
8. `foot-stop` shows a sentinel (1e9 screw load) in `phase3bDefaults()` runs because the deck-screw count came back zero from WS-B's in-flight hull (deck part renames); old defaults are fine. Re-check after B settles.

## 4. Re-based rows (new basis only; old basis unchanged)

| Row | New basis |
|---|---|
| axle-stress | rear only; normal: resultant of H and (V + static) from the 1" rear bump at the stub cantilever vs yield / SF, plus the old cornering skid at the static load; hard: 2" hit vs `axleUltimatePsi` / `failSafeFactor` |
| bearing-groove | rear only: 1" V + static vs oak perp design; hard 2": no wood safety factor |
| wheel-rating, rear-beam-seat | `analysis/rear-bump.ts` (new; rear.ts is WS-C's, untouched): normal peak vertical vs rating x `wheelRatingPeakMult`; seat: the struck wheel's V + static into its rail, hard rows at no wood SF and 316 ultimate / ff |
| beam-rear | struck rear wheel V + static replaces F/2; hard details at no wood SF |
| rails | span to the front beam (`L.front.beam.x`); payload and chassis weight x `seatFactor`; hard-hit bending details at MOR x C_M (no SF) |
| deck | seat case x `seatFactor`; hard detail at no SF |
| seat-back, seat-grip | rider x `seatFactor` (was `dynamicFactor`) |
| foot-stop | rider x `bumpSeatG` x share (was `curbStrikeG`); hard detail with `bumpSeatGHard` |
| tip-lock | min over the tow lock and the ride lock, contacts from the solved wheel centers, `cgAt` moves each side about its own kingpin |
| turn-radius | mean instant center of the two axle lines, both reported |
| slide-before-tip, v-rollover | automatically use the Ackermann instant center through `contactsAt` |
| steer-clear | `steerSweepAck`: every rigid body at its own pose (knuckle, wheel, tie rod, bellcrank, tongue, links), skipping steering-hardware vs steering-hardware pairs |

`loads.ts`: `buildLoadModel(p, parts, kingpinX, ack?)`; with `ack`, `cgAt(innerRad)` rotates the left group (`steer-L`, `wheel-FL`) and right group about their own kingpins by their own solved angle. `nds.ts` now owns `boltCapacity` and `ndsAdjust` (re-exported from the old `front.ts`).

## 5. Interfaces other workstreams need

- Part ids the sweep expects: moving bodies by `part.body` in `steer-L`, `steer-R`, `wheel-FL/FR`, `tie-rod`, `bellcrank`, `tongue`; links by id `drag-link`, `tongue-link`. Steering hardware must be `group: 'steering'` so pairs of hardware are skipped.
- `RunOptions.newFront` / `makeContext(..., { newFront })`. Auto-detection key is the part id `spindle-L`.
- WS-C: `brake-ride.ts` rows are not wired into `ackermannRows` yet (the file did not exist). When it lands, add `...brakeRideChecks(ctx)` after `brakeAbuse` in `ackermannRows` (`analysis/index.ts`) and drop `brakeTraction` for `park-hold`. Their ids (`brake-stop`, `brake-emergency`, `brake-heat`, `brake-bias`, `park-hold`, `brake-front`, `hip-cable`, `belt-anchor`) are already in `LIGHT_OF_ID` and `GROUP_OF_ID`. `ride-rollover` is mapped to the Hills light (spec 6.3), `steer-kin` / `steer-lock` to Steering.
- WS-E: no change needed from this side beyond `LIGHT_OF_ID`.

## 6. Stage 2 deletion list (WS-D side)

1. `analysis/front.ts` entirely (and `front.test.ts`), after moving nothing else: `boltCapacity`/`ndsAdjust` already live in `nds.ts`; `scaleLimits` is used by `brake.ts` (WS-C: change its import to `./dual` and move the function there; I did not touch it).
2. `analysis/rear.ts`: `wheelRating`, `rearBeamSeat` (replaced by `rear-bump.ts`); its `boltCapacity` import must point to `./nds`.
3. `structure.ts`: `kingpinGeom`, `kingpinStress`, `kingpinBearingDetails`, `kingpinCheck`, `obstacleForce`, `rollBalance`, `Strike`, `strikeCases`, `tieHalfY`, `yawTorque`, `kingpinStrikeCheck`, `rollLoads`, `rollSideBearerCheck`, `rollKingpinUpliftCheck`, `rollBolsterAttachCheck`, `turntableCheck`, `tongueCheck`, `beamFront`, and the front half of `beamEval`; collapse `axleStress`/`bearingGroove` to the bump versions (remove the `ctx.newFront` branches); `allowables` loses the kingpin/sleeve/plate/fast entries.
4. `steering.ts`: `steerSweep`, `steerClearance`, `INTENDED_CLOSE`, the `isSteer` helper (keep `steerSweepAck`, rename).
5. `stability.ts`: the old branches in `tipLock`, `turnRadius`; `ContactInputs` old rotation path in `geometry.ts` and the `kingpinLeadIn` single-pivot code.
6. `loads.ts`: the `'steer'` body and `kingpinX` parameter.
7. `index.ts`: `oldRows`, the `newFront` switch; `context.ts`: `newFront`.
8. Row ids deleted: `kingpin-strike`, `roll-side-bearer`, `roll-kingpin-uplift`, `roll-bolster-attach`, `steer-stops`, `steer-stops-bound`, `kingpin-plates`, `kingpin-bolts`, `kingpin-peak`, `kingpin-split`, `pitch-path`, `turntable-ring`, `turntable`, `kingpin`, `bridle-tie` (to `tongue-tie`), old `tongue`/`beam-front` (re-based). Remove them from `LIGHT_OF_ID` and `GROUP_OF_ID`.
9. Tests: `front.test.ts`; in `checks.test.ts` the kingpin/crossbar/turntable describe, the `obstacleForce`/`rollBalance` imports and any `frontDeckRaiseIn`/`turntable*` references; the `rider-sweep.test.ts` assertion on `steer-stops` ids; `recommended.test.ts` if it reads old params.
10. Params (Stage 3, coordinate with WS-A): `curbHeightIn`, `rootHeightIn`, `curbStrikeG` (check `hull.ts` after the flip: the old `footStopLoads` default argument), `kingpinMargin`.

## 7. Open points and caveats

- Kingpin tilt, caster and KPI are neglected in all statics (as in the kinematics).
- The kickback chain and lever arms are taken at the neutral pose (`leverage()` reads `Layout.front.bellcrank` / `tongue`); at lock the drag-link angle changes by a few degrees.
- `tongue-tie` still uses `eyeBoltEyeOffsetIn` (1.0") as the bending arm.
- The cotter pin is treated as a nut lock, not a load path (a 3/32" cotter holds 364 lbf of the 826 lbf hard-hit lateral force; the castle nut thread holds 26 kips).
- The stub arm is `scrub - spindleBossRadiusIn` = 2.25" from the boss face to the hub center. The spec's "17 mm passes normal" does not hold with that arm: the 17 mm stub is 3.2x as stressed and fails the 1 inch bump (test pins the ratio, not a pass).
- Euler buckling of the 27" rod is taken pinned-pinned at full length; the center drag-link clevis would raise it.
