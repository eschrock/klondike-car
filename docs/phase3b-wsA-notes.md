# Phase 3b WS-A (Stage 1): the Ackermann front end parts and the re-laid center linkage

Status: A1 done. `npx vitest run src/model/front-end.test.ts src/model/ackermann.test.ts` passes (47 tests). `npx tsc --noEmit` is clean for the WS-A files. The full suite at the time of writing had two failures outside WS-A: `analysis/ride.test.ts` "ride-envelope ... GO corners" (WS-D) and a timing test in `truck/fit.test.ts` (load).

## 1. How to build the new front end

`buildModel(params, { frontEnd: 'ackermann', steerDeg, mode })` (new `ViewState.frontEnd`, default `'turntable'`). Use `phase3bDefaults()` params (their `frontEndType = 1` selects the matching hull). With the default view the old turntable front end builds unchanged (tested). At the Stage 2 flip change the default in `makeCtx` (build-utils.ts) to `p.frontEndType === 1 ? 'ackermann' : 'turntable'` and delete the old branch (section 8).

`mode`: `'both'` (default; tongue and stick both installed, pin in TOW, stick parked at neutral), `'tow'` (no stick, cables, guard), `'ride'` (no tongue, link, hinge clevis, eye bolt, bridle; cross-bar pinned to the bellcrank; stick moves). `steerDeg` is the inner-wheel angle, clamped to the tow lock, or in `'ride'` to the inner angle of the ride lock (8.59 deg).

Files: new `front-end.ts` (parts), `front-end.test.ts`; rewritten `front-layout.ts` (published geometry); `ackermann.ts` (exact center linkage); small edits to `build-utils.ts` (ViewState.frontEnd, Ctx.pose type, `poseOf`, `placement`/`cylinder` pose lookup, `STEP.linkage 4.7` / `STEP.spindles 4.9`, `defaultExplode` for the new ids, ride-mode clamp), `mesh-utils.ts` (`customPart` takes `body` and applies `ctx.pose[body]`), `types.ts` (`RigidBody` += `'drag-link' | 'tongue-link'`), `running-gear.ts` (front axle/beam/clamps skipped; front wheels carry `pose['steer-L'/'steer-R']`; bore = stub diameter), `index.ts` (picks `buildFrontEnd`), `layout.ts` (one exact-string edit: `computeFrontLayout` also receives `deckTop`, `noseTop`), `params.ts` (below).

## 2. Deviation 2 fixed: the re-laid center linkage

Stage 0 said the exact linkage gave 31.8 deg tongue yaw against the 25 deg stop. Cause: with the output arm aft and the input arm forward, the drag link ran along the car almost parallel to its arm (a near toggle), so it could not carry the tie-rod center's sideways travel (1.35"). The fix is topological, not a tweak of lengths:

* The output pin stands off to the LEFT of the pivot so the drag link runs ACROSS the car (2.09" long, nearly along y), perpendicular to the rod's sideways travel. The rod center also moves 0.48" forward at lock; with the link across the car that term is second order, so left and right turns are nearly symmetric.
* The tongue ear sits on a clevis cross-plate to the RIGHT of and BEHIND the hinge pin, so the tongue yaw moves it fore-aft along a fore-aft tongue link (the old straight-ahead ear moved sideways, which a fore-aft link cannot transmit).
* `solveSteer` now uses the EXACT circle-intersection solution for the bellcrank, tongue and stick (the lateral-transfer model is gone). `solveCenterExact`, `centerPins` (all pin positions at a pose) and `linkageConditioning` (worst arm/link sine, 1 = perpendicular, 0 = toggle) are exported. `ok` is false when a link binds or the worst transmission is under 0.15. Left and right turns are no longer exact mirrors for bellcrank/tongue/stick (the 4-bar, knuckles and wheel centers still are).

Numbers at the defaults (`phase3bDefaults`), exact solution:

| Quantity | Value |
|---|---|
| Output arm | 4.5" at 27.5 deg (drag link pin at 42.74, +2.08), pivot (38.75, 0) unchanged |
| Input arm | 3.0" at 54 deg (tongue-link pin at 40.51, +2.43), standoff up to the link plane |
| Tongue ear | 1.75" behind and 1.75" right of the hinge pin (45.50, -1.75); hinge (47.25, 0) |
| Drag link / tongue link length (pin to pin) | 2.09" / 6.51" |
| Tow lock, inner 35.5 deg | bellcrank -18.1 deg (left turn), +17.1 deg (right); tongue yaw +21.9 / -21.5 deg; stop 25 deg, margin 3.1 deg |
| Ride lock (outer 8, inner 8.59) | bellcrank -5.85 / +6.02 deg; stick 15.0 / 15.4 deg (cross-bar half length 3.8", stick cable arm 1.5") |
| Worst link transmission (sine) over -35.5..+35.5 | 0.83 (Stage 0 layout: under 0.3) |
| Tongue-yaw monotone in steer | yes (test) |

Sign convention: steer > 0 = left turn = tongue yaw CCW (+) = grip pulled aft (stickDeg +). The bellcrank turns CW for a left turn.

New/changed params (all `D-53`, steering group): `bellcrankArmIn` 3 -> 4.5 (now the OUTPUT arm), `tongueLinkArmIn` 3.25 -> 1.75 (ear offset to the right of the hinge); new `bellcrankOutAngleDeg` 27.5, `bellcrankInArmIn` 3, `bellcrankInAngleDeg` 54, `bellcrankCableArmIn` 3.8, `tongueEarAheadIn` -1.75. `AckSpec` gained optional `bellOutDeg, bellInArm, bellInDeg, bellCableArm, tongueEar` (absent = the Stage 0 straight layout, kept only as the documented bad case in a test). `ackSpec()` fills them. `poseMatrices` returns `Record<PoseId, Mat4>` with two extra poses, `'drag-link'` and `'tongue-link'` (a superset of the five `SteerBodyId`s, so existing consumers still typecheck).

Not reproduced from the spec: its 26.5/24.3 deg numbers were the lateral-transfer model; the 21.9 deg tongue yaw above is the real linkage.

## 3. Geometry decisions that differ from the spec (read these)

1. **Beam length 26.94" (spec 27.7").** Spec: ends 0.9" from the kingpin axis. With the bracket web (3/16") and a spindle boss of radius 0.75" (WS-D's `spindleBossRadiusIn`) that cannot fit (boss inner edge at 14.0 vs web outer face at 13.8 even before the KPI lean). The beam now ends `bossR + KPI lean at the boss top + web + 0.05` = 1.28" from the axis. `F.beam.len` is derived; `ackermann.test.ts` was updated. The bracket leaves still reach 1.0" past the axis.
2. **The modeled spindle boss and kingpin bolt are VERTICAL.** The plan kinematics rotate a body about a vertical axis (KPI and caster neglected, spec 1.2); a boss tilted 6 deg and turned about a vertical axis sweeps a cone through the web. The design tilt (`knuckle.bossAxis`) stays published for the analysis; the bracket holes carry it.
3. **The steering arms and tie rod are BELOW the beam** (z 5.0, `tieRod.z`, `armTip` z; they were at the axle height, which put them through the bracket web). Arm plate top 5.19 vs beam bottom 5.50. `Layout.front.armTip` z and `tieRod.z` changed from `r` to 5.0.
4. **Steering arm is a bolt-on plate** (`steer-arm-L/R`, hull of the foot post, kingpin axis and tip), on a foot post under the spindle carrier; a kart spindle with a one-piece arm would not reach under the bracket. Sourcing note says verify.
5. **The tongue passes UNDER the front transom bottom by 0.25"** (spec 3.6): tongue top = `noseTop - crossmemberDepthIn - 0.25` = 7.0", bottom 4.5", center 5.75" (`F.tongue.z`, which WS-D's tongue-tie row reads as the eye height; it was ~6.5). The ear plate and tongue link must pass over the beam top (7.5), so they stand higher on spacer sleeves: ear plate 7.63-7.81, tongue link 7.81-8.00, deck underside 8.53.
6. **Tongue hinge is a true double-shear clevis** (WS-D's note says "double shear"): top and bottom plates plus two flanged walls (`tongue-hinge-top/-bottom/-wall-L/-R`), 1/2" pin (`tongueHingePinDiaIn`), the ear plate bolted to the tongue through two arc slots in the top plate. The tongue yaw stop at 25 deg is not a separate part (the wall inner faces are 1.15" off the centerline and clear the tongue corner at the stop; the tow lock is reached 3 deg before it).
7. **Tow-lock stops are blocks on the beam underside** (`steer-stop-tow-L/R`), not tabs on the bracket leaf: the leaf is 2.2" above the arm plane. Position solved from the arm hull at the lock (1/16" gap at 35.5 deg inner, never touched before it, nowhere near the outer-wheel lock).
8. The cable pass-through is straight segments: `stick-cable-X-up` (stick arm to the deck slot to the waypoint under the joists), `stick-cable-X` (under the deck), `stick-cable-X-end` (to the cross-bar pin). The pull-pull pulley for B is not drawn.

## 4. Parts built (ids, mass, fab, step)

Steering group total 26.9 lb at the defaults (41 parts; the spec 11.1 estimate for the same items is about 20.5 lb, the linkage plates and tie rod are the difference). Unlisted fasteners are in the joint-driven hardware remainder.

| Part id | lb | Fab | Step | Notes |
|---|---|---|---|---|
| `beam-F` | 6.89 | drill-tap (cut A500 2x2x0.120 tube, no welds) | 4.6 | joints: 4 bolts to each bracket (crush sleeves); WS-B's hold-down angles |
| `kp-bracket-L/R` | 1.10 each | outsource (3/16" A36 C-channel, bent) | 4.6 | 4 x 5/16" to the beam end |
| `spindle-L/R` | 2.20 each | buy (kart spindle, stand-in mesh) | 4.9 | stub 25 mm, body `steer-L/R` |
| `steer-arm-L/R` | 0.43 each | buy | 4.9 | body `steer-L/R` |
| `kingpin-bolt-L/R` | 0.15 each | buy (grade 8 3/8") | 4.9 | chassis (clamped by the leaves) |
| `wheel-FL/FR` | (running-gear) | buy | 4.6 | pose of `steer-L/R`, bore = stub dia |
| `tie-rod` | 1.76 | buy | 4.7 | body `tie-rod` |
| `drag-link` | 0.11 | drill-tap | 4.7 | body `drag-link` |
| `bellcrank` | 1.33 | outsource (1/4" plate hull) | 4.7 | body `bellcrank` |
| `bell-bracket` | 0.88 | outsource | 4.6 | 2 bolts through the beam rear face |
| `bell-standoff` | 0.21 | buy | 4.7 | body `bellcrank`; lifts the TOW socket over the beam |
| `cable-crossbar` | 0.33 | drill-tap | 4.7 | body `bellcrank` in ride, chassis (neutral) otherwise |
| `mode-plate` | 0.62 | outsource | 4.7 | chassis; window/detents are notes only |
| `mode-pin` | 0.10 | buy | 4.7 | body `bellcrank`; TOW socket in both/tow, RIDE in ride |
| `centering-spring-L/R` | 0.05 each | buy | 4.7 | drawn between pins at the current pose |
| `steer-stop-tow-L/R` | 0.14 each | drill-tap | 4.6 | |
| `tongue` | 1.56 | table-saw | 4.9 | oak, removable, body `tongue` |
| `tongue-plate` | 0.27 | outsource | 4.9 | body `tongue`, removable |
| `tongue-link` | 0.29 | drill-tap | 4.9 | body `tongue-link`, removable |
| `tongue-hinge-top`, `-bottom`, `-wall-L/R`, `tongue-hinge-pin` | 0.37, 0.37, 0.36 x2, 0.33 | outsource / buy | 4.6 / 4.9 | chassis; omitted in ride |
| `eyebolt-T`, `bridle` | 0.35, 0.50 | buy | 4.9 | body `tongue`, removable |
| `stick-bracket` | 0.89 | outsource (U channel) | 5 | chassis |
| `ride-stick` | 0.51 | drill-tap (6061 tube) | 5 | removable; chassis body, pose in the transform |
| `stick-guard`, `cable-guide-R` | 0.10 each | print (ASA) | 5 | |
| `stick-cable-A/B`, `-up`, `-end` | 0.02-0.06 | buy | 5 | removable; material text "stainless steel cable" (no "rope") |

## 5. Interface published for the other workstreams

* **Layout.front** (`FrontLayout`): everything from Stage 0 plus `armTip`/`tieRod.z` at the tie-rod level; `bellcrank.{z, inZ, dragZ, bracketZ, modeZ, ridePin, cablePins, springPin, springAnchor, plate, bracket}`; `tongue.{z, top, bot, hingeTop, hingeBot, plate, link, rearX, tipX}`; `knuckle.{foot, armHull}`; `towStop.{L,R}`; `cable.{armA, armB, slot, slotSize, dropA, dropB, endA, endB, pinA, pinB}`; `keepOut.{center, cable}`; `mode.{plate, pinTow, pinRide}` (3-D). The kingpin bracket bolt pattern is `bracket.{L,R}.bolts` (4 points on the beam end face, axes along y).
* **Poses:** `ctx.pose` now includes `'drag-link'` and `'tongue-link'`. **WS-E action:** `sim/core.ts` `poses()` sets `tie-rod`, `bellcrank`, `tongue` only; add `out.set('drag-link', multiply(ch, pm['drag-link']))` and the same for `'tongue-link'` or the two links stay at neutral in the sim view. The stick, cables and crossbar are `chassis`/`bellcrank` bodies (WS-E's request); the mode pin is `bellcrank`. The links needed their own bodies because a rigid link does not move with the bellcrank or the tongue.
* **WS-B (hull and frame), needed:** (1) cut the deck slot at `Layout.front.cable.slot` (1.6" x 0.5", x = stick x + 2.6); (2) the nose joists `joist-nose-1/2` (x 42.95-43.7 and 45.8-46.55) collide with the center corridor `Layout.front.keepOut.center` (x 34.45-48.45, |y| <= 3.4, z 4.6-8.15). Joist 1 crosses the bell bracket/tongue link and joist 2 the hinge clevis. Move them out of the corridor or notch them; `front-end.test.ts` lists these as PENDING and nothing else may overlap. (3) Front transom bottom (7.25") is the tongue's ceiling; it must not come down. (4) The deck underside must stay above 8.2" in the corridor.
* **WS-C:** `knuckle.shoePivot/shoeAngleDeg` unchanged. The cable corridor under the deck (z 5.2-6.7, y -10.5..+4.3, x 18-38.75) is mine; the front brake cables and equalizer must not use it. With WS-C's parts in the tree, `kp-bracket-L/R` shows a bounding-box overlap of 0.16-0.29" with `brake-front-horn-L/R` (the C-channel box over-covers its round leaf); WS-C should check the horn against the leaf disc (radius `kingpinBracketLeafRadiusIn` about the kingpin, z 7.2-7.4 and 9.4-9.6).
* **WS-D:** use `buildModel(p, { frontEnd: 'ackermann' })` to get the parts. Hinge pin is double shear (section 3.6); the tongue pull is horizontal. The tongue-tie eye height is `F.tongue.top + eyeBoltEyeOffsetIn` (8.0"); `F.tongue.z` is the tongue's center (5.75"). Bracket bolt pattern `bracket.L.bolts`; the web reaches the beam bottom (5.5) up to the upper leaf top (9.59).

## 6. Tests

`front-end.test.ts` (26): part list/sourcing/mass; old family absent; bolted only; articulation (moves, fixed parts fixed, poses applied, rod/links keep their pin lengths over the range, clamps, stick swing about 15 deg only in ride, cable length within 0.3" over the ride range); modes and the interlock (omissions, pin socket per mode, sockets > pin dia + 1 apart, removed config); overlap sweep over the tow range and the ride range with a documented allow list (below); analytic clearances (spindle mesh vertices to the beam and webs >= 0.15", arms under the beam, stop gap, leaf disc tangent to the tire face, thigh/hull >= 1.25"); published geometry (z stack, tongue under the transom, cable path, stops); old front end still the default. `ackermann.test.ts` (21): tongue yaw 21-23 deg both directions and 2 deg inside the stop, conditioning 0.83 vs the Stage 0 layout, pin lengths, link poses, monotone tongue map, beam length updated, `frontBrakeType` default tolerated at 0 or 2.

Allow list (bounding boxes over-cover or the contact is intended); copy these into `model.test.ts` ALLOW at the flip: `beam-F`/`rail-nose-*` (notch); `kp-bracket-*` with `spindle-*`, `kingpin-bolt-*` and `wheel-F*`; `spindle-*` with `wheel-F*`, `kingpin-bolt-*`, `beam-F`; `steer-arm-*` with `tie-rod`, `steer-stop-tow-*`; `bellcrank`/`centering-spring-*`; the mode pin, standoff, tongue link, ear plate, cross-bar and hinge pin chain; `tongue` with `tongue-hinge-pin` and `eyebolt-T`; `bridle`/`eyebolt-T`; `stick-bracket`/`ride-stick`/cable-up/guard; the three segments of one cable; `stick-cable-*-up` and `cable-guide-R` with `deck` (the slot). Reasons are in the test file.

## 7. Open questions and risks

1. **Spindle boss radius 0.75" is large for this packaging** (beam shortened 0.8"; any bigger boss shortens it more). Real spindle needed (spec 12.1).
2. **Cable length varies by 0.23" over the ride range** (the up-run is steep, cos 0.77, so the stick's tip travel is not fully seen by the cable). A pull-pull cable is inextensible, so this is slack/bind: use a spring in the turnbuckle, or make the effective cable arm `1.5 cos(theta)`. Not fixed.
3. **Stick to cushion edge is 0.6"** (stick axis 9.98" off center, cushion half width 9.0, tube radius 0.375); the thigh is 3.1" away and the hull 3.0". The guard covers the lower 4". Spec insets (3.4") leave it; moving `rideStickInsetIn` to 4.4" gives a 1.6" gap.
4. The mode plate's window stops, the tongue yaw stop, the stick stow socket, the pulley for cable B and the hinge wall flanges are described in notes, not drawn. The ride stops rely on the plate window (analysis row `steer-stop-load`).
5. Bell bracket is a cantilevered 3/16" plate on two bolts through a thin-wall tube, carrying the bellcrank pivot; WS-D should give it a row.
6. `frontBrakeType` default is 2 (WS-C) while `ackermann.test.ts` expected 0; the test now accepts both.
7. The fastener count: kingpin bracket and clevis wall bolts need crush sleeves inside the tube; flange details are not drawn.
8. Weights: a new-front-end build at `phase3bDefaults` is 172.9 lb total with the other workstreams' current state (old model on the same params: 182.7).

## 8. Stage 2 removal list (prepared, NOT executed)

Model (WS-A files): delete `src/model/steering.ts` (turntable, bolster, kingpin, crossbar, sleeves, carrier/under/bar plates, ears, stop dogs/pads/blocks/risers, access panel, rope-leg bridle; keep `frac` and `roundedRectCCW` only if another file imports them: `grep` first, `joinery.ts` has its own `frac`), `kingpin-plates.ts`, `stops.ts`, `model/front.test.ts`. In `running-gear.ts` remove the front axle branch: the `fy`/`ctx.pivot` wheel placement, the front half of the `axles` loop (`ax.tag === 'F'`: through rod/stubs, oak `beam-F`, the square U-bolts `clamp-F?1/2`, the `kingpinPlatesOn` joint, the `kingpinPlatePlan` import) and the `ack` flag. In `layout.ts`: `turntable`, `bolster`, `sideBearer`, `kingpin`, `kpPlates`, `crossbar`, `accessPanel`, `beamF` (old oak beam; `Layout.front.beam` is the beam), the `xs`/`noseTop`/`noseBot`/`shoulderBeam` aliases (WS-B). In `build-utils.ts`: `ViewState.frontEnd` default flips; delete `Ctx.pivot`/`steerRad`, `PartSpec.steer`, the `steer ? ctx.pivot` branches, `'steer'` in `RigidBody`, `STEP.kingpin`, the `kingpin`/`steer-stop`/`side-bearer` lines in `defaultExplode`, the comments about the bolster. In `mesh-utils.ts` `customPart`: the `steer` option. `index.ts`: drop `buildSteering`. Params (Stage 3, WS-A/B/D): the section 2.2 families (`turntable*`, `bolster*`, `sideBearer*`, `steerStop*`, `stopBlock*`, `kingpinTorqueTopShare*`, `kingpinEar*`, `kingpinPlate*`, `carrierPlateThickIn`, `kingpinCrossBolt*`, `kingpinCrossbar*`, `kingpinSleeve*`, `kingpinWasherDiameterIn`, `kingpinThroughBolster`, `rodKingpinWebMinIn`, `weldFexxPsi`, `accessPanel*`, `uboltBeamClearIn`, `uboltNutAllowanceIn`, `bridleTieOffsetIn`, `bolsterFastener*`, `frontDeckRaiseIn`, `shoulderBeamIn`, `turntableRatingLb`, `drawbar`, `frontAxleBeamThicknessIn`), their validators, and then move the changed defaults into `PARAM_DEFS`. Keep `eyeBolt*` and `bridleTieOverloadFactor` (the tongue-tip tie uses them) and `uboltRodDiameterIn` (rear plates). Tests: the stop/kingpin/access/crossbar describes in `r3-fittings.test.ts`, the front describes in `model.test.ts` (steer-body clamp, kingpin stays, bridle legs) and the ALLOW entries naming the old parts (`kingpin*`, `bolster*`, `steer-stop*`, `stop-block*`, `side-bearer*`, `clamp-F*`, `eyebolt-[LR]`, `bridle-[LR]`, `nose-access-panel`), `src/analysis/front.test.ts` per spec 2.4.
