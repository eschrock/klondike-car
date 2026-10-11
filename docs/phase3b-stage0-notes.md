# Phase 3b Stage 0: what landed

Additive only. The old model, analysis and sim are untouched. `npm run typecheck`, `npm test` (31 files, 1,203 tests; the 1,109 existing ones all pass unchanged) and `npm run build` are green.

## Files

New: `src/model/ackermann.ts`, `src/model/ackermann.test.ts` (20 tests), `src/model/front-layout.ts` (the `FrontLayout` type and `computeFrontLayout`), this note.
Edited (targeted): `src/params.ts` (the `'ride'` group, 71 new params, `ackSpec`, `phase3bDefaults`, scrub validator), `src/model/layout.ts` (`Layout.front`), `src/model/types.ts` (`RigidBody`), `src/model/build-utils.ts` (`ViewState.mode`, `Ctx.steer`, `Ctx.pose`), `src/analysis/geometry.ts` (`ContactInputs.ack`), `src/model/hull-curve.ts` (`TireSweepSpec.ack`).

## Interface notes for Stage 1 (read these)

1. **Changed defaults are NOT applied to `defaultParams()` yet.** Changing `steerLockDeg` (37 to 35.5), `kingpinLeadIn` (1.5 to 1.25), `kingpinDiameterIn` (0.75 to 0.375), `turnRadiusMaxIn` (96 to 108) or `brakeLiningThickIn` (0.125 to 0.25) broke about 60 old tests (old front-end and brake numbers). They live in `PHASE3B_DEFAULT_OVERRIDES`; `phase3bDefaults()` returns `defaultParams()` with them applied. New code and tests should use `phase3bDefaults()`; the flip (Stage 2) moves the values into the `PARAM_DEFS` defaults (and widens `steerLockDeg` to 28-42, `kingpinDiameterIn` min to 0.25). `phase3bDefaults()` still trips the old kingpin-sleeve web validator (an error that disappears with the old front end); the new scrub rule is clean.
2. **`ackSpec(p)`** is in `params.ts`, as spec 1.8. `AckSpec` has one extra optional field, `stickCableArm` (default 1.5), so `stickDeg` can be computed. `tieLen` is derived (`neutralTieLen`).
3. **`solveSteer`** input is the inner wheel angle, + = left. For negative input `leftDeg` is the OUTER angle (negative) and `rightDeg` the inner one. `ok` is false when a circle intersection fails or when the tie rod is mis-assembled (neutral toe over 0.5 deg, so +/-1" of rod length is rejected). A binding linkage returns the ideal Ackermann pose (finite, never NaN) with `ok: false`.
4. Extra exports in `ackermann.ts`: `neutralTieLen`, `kpL/kpR`, `centerLinkage` (neutral pins and derived link lengths), `solveCenterExact`, `applyPlan`.
5. **`Layout.front` (`FrontLayout`, in `front-layout.ts`)**: vectors are `Vec3` where a z is meaningful (`kp`, `stub`, `armTip`, `knuckle.*`, `stick`, `hipLever`, `mode`), `Vec2` plan points for `bellcrank.pivot/outPin/inPin`, `tongue.hinge/linkPin`. Beam: `thick` is the fore-aft width (`frontBeamWidthIn`), centered on the stub axis in z (top = r + depth/2 = 7.5"), underslung. `bracket.{L,R}` has `web`, `footprint`, `pivot`, `lowerLeaf`, `upperLeaf`, `bolts[4]` (position on the beam end face and axis). `knuckle.{L,R}` has `bossPos`, `bossAxis` (up, tilted back by caster and in by KPI), `shoePivot`, `shoeAngleDeg`. Also `trailIn`. **Provisional placements** that Stage 1 should refine: `knuckle.shoePivot`, `stick` and `hipLever` positions, `mode` sockets (TOW at the bellcrank input end, RIDE on the cross-arm toward the right), and the z levels of the links (`bellcrank.z` = r, `bellcrank.inZ` = beam top + rod end diameter, `tongue.z` = r). The kinematic fields (`kp`, `stub`, `armTip`, `tieRod`, pins, hinge, ear) are final.
6. **`Ctx`** now has `steer: SteerSolution` and `pose: Record<SteerBodyId, Mat4>` (neutral frame to steered pose, `Ctx.pivot` kept). `view.mode` defaults to `'both'`. The steer angle is still clamped to `|steerLockDeg|`. `placement()` is untouched: A1 must add the `ctx.pose[s.body]` lookup when it moves parts.
7. **`RigidBody`** gained `steer-L | steer-R | tie-rod | bellcrank | tongue`; `'steer'` remains until the flip.
8. **`contactsAt(g, innerRad)`** with `g.ack` takes the INNER wheel angle (+ = left) and returns the solved wheel centers, `kx = ack.kx`; `instantCenterY` (so `turnGeometry`) uses the mean instant center when `ack` is present. Without `ack`: the old rotation, unchanged.
9. **`leftTirePolys`** with `spec.ack` ignores `kx`, `frontTrack` and `lockDeg` and sweeps the left tire rectangle about the LEFT kingpin by the solved left-knuckle angle for input -towLock..+towLock (72 polygons at 1 deg, left angle -26.0..+35.5). `CurveClearanceSpec` inherits `ack`. `hullCurveSpec` was NOT changed (B owns it): it still builds the old spec.

## Derived numbers vs the spec (phase3bDefaults)

| Quantity | Spec (calc) | Stage 0 result |
|---|---|---|
| Tie rod length | 27.06 | 27.060 |
| Arm tips at neutral | (42.51, +/-13.53) | (42.51, +/-13.53) |
| Tow lock outer (inner 35.5) | 26.0 (ideal 25.96) | 25.99 (ideal 25.96) |
| Ackermann error | worst 0.58 near 25 | worst 0.587 at 24 deg inner; 0.030 at the lock |
| Wheel centers at the tow lock | (42.49, 16.47), (45.44, -17.99) | (42.49, 16.47), (45.44, -17.99) |
| Instant centers | 76.0", 75.2" | 76.04", 75.21" (mean 75.62") |
| Tow outer edge radius | 8.81-8.87 ft, mean 8.84 | 8.81 ft (right IC), 8.87 ft (left IC) |
| Rod center travel at the tow lock | 1.34" | 1.345" |
| Ride lock: outer 8, inner | 8.55 | 8.59 (within the test tolerance 0.05) |
| Ride rod travel / bellcrank / stick | 0.39" / 7.5 deg / 15 deg | 0.393" / 7.52 deg / 15.04 deg |
| Tow bellcrank / tongue yaw | 26.5 / 24.3 deg | 26.6 / 24.4 deg (lateral-transfer model) |
| Sweep min inner |y| | 11.08" at x 38.4" | 11.08" near x 38.4"; rear-most 36.0", front-most 52.2" |
| Nose outside | 20.65", round down to 20.625" | 20.65" and 20.625" |
| Track at lock | about 34.5" | 34.5" |

## Deviation to read: the center linkage is idealized in the spec

The spec's bellcrank and tongue numbers (26.5 and 24.3 deg, ride 7.5 deg) are the lateral-transfer model: `bellArm * sin(bell) = rod-center lateral travel`, `tongueLinkArm * sin(tongue) = same travel`. `solveSteer` uses that model, so every spec number is reproduced. The REAL link geometry is different. With the straight lever (output arm aft, input arm forward, pivot 6.5" behind the kingpin), the drag link is only 6.76" long and almost parallel to the lever arm, so the fore-aft arc of the arm and the 0.48" forward motion of the rod center are not negligible: the exact circle-intersection solution (`solveCenterExact`) gives a **bellcrank of 33.1 deg and a tongue yaw of 31.8 deg at the tow lock** (vs 26.6 and 24.4), which exceeds `tongueMaxYawDeg` 25. A grid search over the two arm angles found no layout that is both well conditioned (not near a toggle) and gives 24.3 deg. Stage 1 (A1) must either re-lay the center linkage (for example a different drag-link attachment or a longer link/larger bellcrank-to-rod distance so the links stand near-orthogonal to the arms), reduce `tongueLinkArmIn`'s effect by raising it, or accept the exact numbers and raise the yaw stop. `ackermann.test.ts` pins this (the exact tongue yaw exceeds the stop) so the decision is visible. The 4-bar (knuckles, tie rod, wheel centers, instant centers, locks) is exact and unaffected; only the bellcrank, tongue and stick angles are affected, and those are visual-only bodies in the sim.

## Smaller notes

- `frontBeamWidthIn` is the fore-aft dimension and `frontBeamDepthIn` the vertical one; the tongue hinge is `tongueHingeAheadOfBeamIn` ahead of the beam FRONT face (47.25").
- Beam length uses `kingpinBracketLeafRadiusIn` for the spec's "1.0 inch" (`2 (kpHalf - leafR) + 0.2` = 27.7").
- Every new param has status and ref (D-53 to D-56 and D-49/D-51 as reserved IDs) and a note where the reason matters. Orchestrator decisions applied: `spindleStub` 25 mm (option 0 = 17 mm), scrub 3.0 (note on dished wheels), steel front beam, `failSafeFactor` 1.25, `frontBrakeType` 0 (tread shoe on a knuckle swing arm). The 1" front wheel bore decision is a note on `spindleStub` (no param).
- New validator in `validateParams`: scrub >= hubLength/2 + bracket leaf radius + 0.5 (defaults sit exactly on the limit; a 4" hub or 2.5" scrub errors).
- Old shared links load: `sanitizeParams` ignores unknown keys and fills new ones from defaults (tested).
- Not done in Stage 0 by design: `hullCurveSpec` ack wiring (B), analysis rows (D), explode vectors for the new ids (A1), `placement()` pose lookup (A1).
