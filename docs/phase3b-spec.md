# Phase 3b spec: Ackermann ride-mode front end, gentle-taper hull, bump loads, ride rules

Status: draft for Eric. Implements DECISIONS D-49, D-50, D-51, D-52. Supersedes the front end of D-12, D-25, D-31..D-34, D-43, D-46, D-47 and part 2 of D-45. Proposed new decision IDs (reserve them): D-53 Ackermann geometry and params, D-54 bump load case and fail-safe rules, D-55 ride envelope and in-app rules, D-56 brakes (front, lined shoes, hip lever), D-57 hull taper build, D-58 sim and viewer articulation.

Method note: every "(calc)" number below came from throwaway scripts (a hand port of the kinematics and of `buildPlanCurve`, checked by reproducing the old S-curve's 5.69" radius). They are expectations for the implementing agents to reproduce in tests, not authoritative. Nothing under `src/` was touched.

---

## 0. Summary of the design

| Item | Decision |
|---|---|
| Steering | Fixed front beam. Two purchased racing-kart spindles on bolt-on kingpin brackets. Tie rod behind the beam. Center bellcrank with a drag link to the tie-rod center. |
| Inputs | Tow: a tongue hinged ahead of the beam, linked to the bellcrank. Ride: a right-hip side stick on pull-pull cables to the bellcrank. |
| Interlock | One keyed mode pin connects only one input to the bellcrank at a time. |
| Locks | Tow: inner wheel 35.5 deg (outer about 26 deg), edge radius about 8.8 ft. Ride: outer wheel +/-8 deg (inner 8.55 deg) with a centering spring. |
| Front track | The parameter and the transport width are unchanged (wheel centers 35.5"). Kingpin spacing becomes track minus 2 x scrub (29.5"). |
| Hull | One long S-curve (14.5" to 38") from the 28" cabin to a 20.6" nose. R_min about 30". One deck level, no deck step, no shoulder beam. Sides are 2-ply laminated (not solid sprung). Continuous single-level deck. |
| Brakes | Existing rear linkage plus a front brake on each knuckle (tread shoe on a swing arm), front share 0.5 set by a cable takeoff arm. Rear shoes become lined steel-backed. Left hip lever on a Bowden cable into the main lever through a lost-motion link. |
| Loads | Curb rows replaced by a velocity-pulse bump model at 10 mph (1" normal-use, 2" hard hit). Normal-use rows use full margins. Hard-hit rows use ultimate stress ("bend, don't break") plus wheel retention. |
| App | A "Riding it downhill" card with the slope x friction table, speed rule and procedure. New analysis rows for stop distance, heat and bias. Camp friction test note. |

Expected effect on mass: about -11 lb (169 lb to roughly 158 lb, plus or minus 10). The 60-70 lb target is not in play (D-21).

### 0.1 Derived geometry at the defaults (calc)

Defaults: wheelbase 44", front track 35.5", 13" wheel (r 6.5"), tire 4" wide, kingpin lead 1.25", scrub 3.0", steering arm 3.0" at 24 deg, steering clearance 0.75".

| Quantity | Value |
|---|---|
| Kingpin axis at hub height | x = 45.25" (`L.kx`), y = +/-14.75" |
| Steering-arm tie-rod pins, neutral | (42.51, +/-13.53) |
| Tie rod length (derived) | 27.06" |
| Tow lock, inner 35.5 deg | outer 26.0 deg (ideal 25.96). Ackermann error stays within 0.6 deg over the whole range (worst 0.58 deg near 25 deg inner). |
| Tow turning radius, outer tire edge | 8.81-8.87 ft depending on which wheel's axle line is used. Mean 8.84 ft. Limit 9 ft = 108". |
| Rod center travel at tow lock | 1.34". Bellcrank 1:1 (3.0" arms). Tongue link arm 3.25" gives tongue yaw 24.3 deg. |
| Ride lock, outer 8.0 deg | inner 8.55 deg. Rod travel 0.39". Bellcrank 7.5 deg. Stick +/-15 deg with a 1.5" cable arm. |
| Tire sweep envelope (left tire, all angles from -26 to +35.5) | Min inner |y| = 11.08" at x = 38.4". Rear-most x = 36.0". Front-most x = 52.2". |
| Nose, outside | 2 x (11.08 - 0.75) = 20.65", round down to 20.625". D-52 said "about 23"": that figure assumed the wheel pivots on its own center. With a 3" scrub and 1.25" lead it is 20.6" (scrub 1.25 gives 21.4"; zero scrub and lead gives 23.0"). Tell Eric. |
| Hull S-curve | start x = 14.5", end x = 38" (6" behind the axle), centerline half widths 13.69" to 10.02". R_min about 30", peak heading about 20 deg. The old curve had R 5.7". |
| Wheel centers at tow lock | Left (inner) (42.49, 16.47). Right (outer) (45.44, -17.99). Track at lock is about 34.5". |

---

## 1. Geometry and params (Ackermann)

### 1.1 Parts (new or rebuilt), model frame, neutral

All parts are in `group: 'steering'` unless noted. Bodies are listed in section 1.4.

| Part id | What it is | Source / fab |
|---|---|---|
| `beam-F` | Fixed front beam. **Steel rectangular tube 2" x 2" x 0.120" A500, length = 2 x (kpHalf - 1.0") + 0.2"**. Center x = kx - 0.5" = 44.75". Top z = stub-axis height + 1.0" = 7.5". Underslung like the rear. About 8.7 lb. | Purchased, cut and drilled. No welds. |
| `kp-bracket-L/R` | Kingpin bracket: a **3/16" A36 C-channel bent from one flat blank** (web + upper leaf + lower leaf). The web bolts to the beam end face. The leaves carry the kingpin bolt through the spindle boss. The caster and inclination are built in as hole offsets between the upper and lower leaf (offset = leaf gap x tan(angle)). Leaf footprint radius about 1.0" around the pivot. | Outsourced laser cut and press-brake bend (`fab: 'outsource'`). No welding. |
| `kp-bracket-bolt` x4 per side | 5/16" grade 8 through the beam end with **crush sleeves** inside the tube, nylock nuts. | Hardware (counted in `applyHardwareMass`). |
| `spindle-L/R` | Purchased racing-kart spindle: stub (17 or 25 mm), kingpin boss, steering arm (arm tip pin at `steerArmLengthIn`, `ackermannAngleDeg`), brake boss. Modeled as a parametric mesh (`customPart` + `tubeAlong`), not a vendor drawing. | Purchased. Verify (section 12). |
| `kingpin-bolt-L/R` | Grade 8 bolt (default 3/8") through upper leaf, spindle boss and lower leaf, with a spacer shim stack and a nylock nut. Axis tilted by KPI and caster. | Purchased. |
| `wheel-FL/FR` | Existing wheel part. Bore adapter (sleeve) from the stub to the hub bore, castle nut + cotter. | Purchased. |
| `tie-rod` | 1/2" threaded rod (or 5/8" tube) with left- and right-hand 5/16" rod ends (adjustable toe). Length 27.06", passes behind the beam. | Purchased. |
| `drag-link` | Short link from the bellcrank output pin to the tie-rod center clevis. Length is derived. | Purchased rod ends + rod. |
| `bellcrank` | 1/4" steel plate pivoting on a vertical bolt. Pivot at x = kx - 6.5", y = 0. Two arms, 3.0" each (output to the drag link, input to the tongue link), plus a cable cross-arm. | Outsourced plate. |
| `mode-plate`, `mode-pin` | A 1/8" steel shuttle plate with two detents (TOW, RIDE) and one captured 3/8" pin on a lanyard. The pin passes through exactly one of two ears. TOW pins the tongue link to the bellcrank. RIDE pins the cable crossbar to the bellcrank. The plate window also sets the bellcrank stop (wide = tow lock, narrow = ride lock). | Outsourced plate + purchased pin. |
| `tongue` | Existing oak tongue, kept: `tongueLengthIn` 24", 1" x 2.0". Now hinged ahead of the beam (vertical hinge pin 1.5" ahead of the beam front face, x = 47.25") in a bolted clevis, with a link-pin ear at `tongueLinkArmIn` 3.25". Yaw stops at +/-25 deg. `removable: true`. | Oak + 1/4" plate clevis. |
| `tongue-link` | Link from the tongue ear to the bellcrank input arm, passing over the beam top. | Purchased rod + ends. |
| `eyebolt-T`, `bridle` | The bridle tie moves to the **tongue tip**: one forged shoulder eye bolt through the tongue (axis vertical), and the existing single-lead `bridle` rope part (hidden in the viewer). | Purchased. |
| `steer-stop-tow-L/R` | A stop tab with an adjustable set screw on each bracket leaf bearing on the steering arm: the primary tow-lock stop (35.5 deg inner), steel on a urethane bumper. | Tab bolted to the leaf. |
| `centering-spring-L/R` | Two extension springs (or a bungee) from the bellcrank to the beam. Neutral at rest, about 2.5 lbf at the stick grip at ride lock. | Purchased. |
| `ride-stick` | Right-side stick: 3/4" aluminum tube, 14" pivot-to-grip, rubber grip, 1.5" cable arm below the pivot. Pivot base on a bracket bolted to the inside of the right chine/rail. Removable for tow (stows in a socket on the hull). Includes `stick-guard` (printed ASA, covers the lower 4" toward the thigh). | Purchased tube + printed guard. |
| `stick-cable-A/B` | Two 1/8" 7x19 stainless pull-pull cables with swage sleeves and turnbuckles (preload 10 lbf). They run from the stick lever through a grommeted slot in the deck near the right gunwale, then below the deck to the bellcrank cross-arm. | Purchased. Material text contains "cable" (not "rope") so the viewer draws them. |
| `cable-guide-R` | Covered channel (printed ASA) over the cable at the slot so a foot cannot catch it. | Printed. |

Rejected alternatives: rods instead of cables (rods through the lap region are a pinch hazard); a tongue connected in ride mode (a stiff tongue would swing at the nose).

### 1.2 Kinematics (one source of truth: `src/model/ackermann.ts`)

- Planar model. Each knuckle rotates about a vertical axis through its kingpin point at hub height, `K_L = (kx, +kpHalf)`, `K_R = (kx, -kpHalf)`, with `kx = WB + kingpinLeadIn` and `kpHalf = frontTrackIn/2 - scrubRadiusIn`. The wheel center in the knuckle frame is `(-lead, +scrub)` for the left and `(-lead, -scrub)` for the right. KPI and caster are **not** applied in the rotation (camber and lift change from KPI are neglected: state this in the part notes). They are used for geometry display, ground trail and scrub, and the analysis rows (self-centering, jacking info).
- Steering arms point rearward and inboard: arm vector from the kingpin to the pin at neutral = `(-A cos g, -/+A sin g)`. `A = steerArmLengthIn`, `g = ackermannAngleDeg`. Ideal Ackermann (arms meeting at the rear-axle center) is `atan(kpHalf/kx)` = 18.1 deg. The default **24 deg** is tuned so the 4-bar tracks ideal at the tow lock (error 0.03 deg there, worst 0.58 deg mid-range). A smaller angle underperforms at large lock. The tie rod length is derived so neutral is straight (`2 x (kpHalf - A sin g)`).
- **The steering input scalar** (`ViewState.steerDeg`, sim input, all checks) is **the inner wheel angle, signed + = turn left**. The solver takes it and returns the outer angle from the 4-bar: for steerDeg > 0 left = inner, right = outer; mirrored for < 0. Reason: the tow lock and ride lock are both stated at one wheel, and the 4-bar is simplest to solve from one knuckle.
- `solveSteer(spec, steerDeg)` also solves, with exact circle intersections (choose the root nearest the previous one), the tie-rod rigid pose, the drag-link/bellcrank angle, and the tongue yaw. It returns `ok: false` when the linkage binds.
- Locks. `steerLockDeg` (existing key, **meaning changed**: tow-mode inner wheel angle, default 35.5, range 28-42). `steerRideLockDeg` (new: outer wheel angle, default 8, range 4-12). `lockLimits(spec, 'tow'|'ride')` returns the inner limit. For ride, the inner limit is solved from the outer (8.55 deg).
- Turning geometry: the instant center is on the rear axle line (x = 0). With the 4-bar the two wheel axle lines meet within about 1 ft of each other at the tow lock (calc: 76.0" and 75.2"). Use the mean for `turn-radius` and for tip/rollover; report both in `how`.

### 1.3 How steer angle maps to each wheel, and what moves

| Thing | Motion for steerDeg = d |
|---|---|
| Left knuckle, spindle, wheel-FL, front-left brake parts | Rotate about `K_L` by `left(d)` |
| Right knuckle, spindle, wheel-FR, front-right brake parts | Rotate about `K_R` by `right(d)` |
| `tie-rod` | Rigid transform fitted to the two arm-tip pins (translation + small rotation). Both are computed, not approximated. |
| `drag-link` | Rigid transform between the rod center pin and the bellcrank output pin |
| `bellcrank` | Rotate about its pivot by `bellcrankDeg(d)` |
| `tongue`, `tongue-link` | Tongue rotates about its hinge by `tongueDeg(d)` |
| `ride-stick`, `stick-cable-A/B` | The stick rotates about its pivot by `stickDeg(d) = bellcrank cable motion / 1.5"` (about +/-15 deg at ride lock). Cables are redrawn as straight segments between their ends at the current pose. |
| `beam-F`, brackets, stop tabs, springs (fixed end), mode plate | Fixed (chassis) |

Only the mode in view moves the input end: in `tow` mode the stick is parked upright in its socket (not connected), in `ride` mode the tongue is omitted (removed and stowed) and the tongue-link ear is open. The mode pin appears in the matching socket.

### 1.4 RigidBody and build-state changes

- `RigidBody` (`src/model/types.ts`): drop `'steer'`; add `'steer-L' | 'steer-R' | 'tie-rod' | 'bellcrank' | 'tongue'`. Wheels stay `wheel-FL/FR` and are driven by the same pose as their knuckle. `'tie-rod'`, `'bellcrank'`, `'tongue'` are **visual-only bodies** in the sim (section 8).
- `ViewState` (`build-utils.ts`): `steerDeg` doc becomes "inner-wheel angle, + = left, clamped to the lock of the current mode". Add `mode?: 'both' | 'tow' | 'ride'`. Default `'both'` so analysis, tests and mass see everything: tongue and stick both present, the mode pin in the TOW socket. `'tow'` omits the stick; `'ride'` omits the tongue, its link, its hinge clevis and the tongue-tip eye bolt.
- `Ctx`: replace `pivot` with `steer: SteerSolution` and `pose: Record<'steer-L'|'steer-R'|'tie-rod'|'bellcrank'|'tongue', Mat4>` (from `poseMatrices(spec, sol)`). `PartSpec.steer?: boolean` is replaced by `body` (the existing field). `placement()` looks up `ctx.pose[s.body]`.
- `STEP`: `kingpin` becomes `spindles` (4.9). Steps: beam and brackets 4.6, spindles/wheels 4.9 (the wheel/spindle assemblies go on after the hull is turned upright and the beam is bolted).

### 1.5 Does the front track change?

No. `frontTrackIn` stays the wheel-center spacing at straight ahead (35.5"). The truck-fit width and the `overallWidthIn` derivation are unchanged. The beam is no longer sized by the track: length = `2(kpHalf - 1.0") + 0.2"` (about 27.7"). The front track can now differ from the rear track independently. At lock the contact patches move (left center y 16.47", right 17.99", about 34.5" apart at 35.5 deg inner); the analysis uses the real moved contacts.

### 1.6 Mode interlock and stops: acceptance

- Interlock by construction: one pin, two mutually exclusive sockets. The pin cannot occupy both. In `both` mode the pin is in TOW, so a stick that is installed is not connected.
- Tow stops: the primary stops are the bracket tabs on the steering arm (35.5 deg inner, adjustable by set screw). The bellcrank window in TOW is wide enough to never be the first stop.
- Ride stops: the narrow bellcrank window in RIDE sets outer 8.0 / inner 8.55 deg. The bracket tabs are the backup. A pull at the stick grip beyond the window loads the window plate, not the cable.
- Centering spring: neutral when the stick is released; about 2.5 lbf at the grip at ride lock. In tow mode it is still attached (negligible against the tongue pull).

### 1.7 Param table (new or changed). Add all in Stage 0.

`ParamGroup` gains `'ride'` ("Ride mode and bump loads"). Everything else goes in the existing groups.

**Steering and front end (`steering` group)**

| Key | Default | Range | Status | Note |
|---|---|---|---|---|
| `spindleStub` | 1 | options 0 = 17 mm, 1 = 25 mm | verify | Stub diameter (0.669" / 0.984"). 25 mm default: S = 0.0936 in3 vs 0.0294 in3 (3.2x). |
| `spindleStubLengthIn` | 3.5 | 2.5-5 | verify | Boss face to tip |
| `spindleYieldPsi` / `spindleUltimatePsi` | 100000 / 125000 | | verify | Hardened chromoly-class assumption |
| `spindleMassLb` | 2.2 | 1-5 | verify | Each, catalog |
| `spindleBossAboveStubIn` | 1.9 | 1-3 | verify | Kingpin center above the stub axis |
| `kingpinDiameterIn` (changed) | 0.375 | 0.25-0.5 | verify | Grade 8 bolt |
| `kingpinInclinationDeg` | 6 | 0-12 | assumed | KPI |
| `casterDeg` | 6 | 0-12 | assumed | |
| `scrubRadiusIn` | 3.0 | 0.5-5 | assumed | Kingpin inboard of the wheel-center plane at hub height. Validator: `scrub >= hubLengthIn/2 + kingpinBracketLeafRadiusIn + 0.5`. |
| `kingpinLeadIn` (changed) | 1.25 | 0-3 | assumed | Kingpin ahead of the stub axis at hub height. Ground trail is derived: `lead + r tan(caster)`. |
| `steerArmLengthIn` | 3.0 | 1.5-5 | assumed | |
| `ackermannAngleDeg` | 24 | 10-40 | explore | Tuned for the tow lock |
| `steerLockDeg` (changed) | 35.5 | 28-42 | explore | Tow inner wheel |
| `steerRideLockDeg` | 8 | 4-12 | assumed | Ride outer wheel |
| `steerCenterSpringLbf` | 2.5 | 0-6 | assumed | At the grip at ride lock |
| `frontBeamWidthIn` / `frontBeamDepthIn` / `frontBeamWallIn` | 2.0 / 2.0 / 0.120 | | assumed | |
| `frontBeamBehindKingpinIn` | 0.5 | | assumed | |
| `frontBeamYieldPsi` | 46000 | | assumed | A500 grade B |
| `kingpinBracketThickIn` | 0.1875 | | assumed | |
| `kingpinBracketGapIn` | 2.0 | | verify | Leaf gap = boss height plus shims |
| `kingpinBracketLeafRadiusIn` | 1.0 | | assumed | |
| `kingpinBracketBoltDiaIn` | 0.3125 | | assumed | |
| `tieRodDiaIn` / `tieRodEndDiaIn` | 0.5 / 0.3125 | | assumed | |
| `bellcrankArmIn` | 3.0 | | assumed | |
| `bellcrankPivotAftOfKingpinIn` | 6.5 | | assumed | |
| `tongueHingeAheadOfBeamIn` | 1.5 | | assumed | |
| `tongueLinkArmIn` | 3.25 | | assumed | Gives about 24 deg tongue yaw at tow lock |
| `tongueMaxYawDeg` | 25 | | assumed | |
| `modePinDiaIn` | 0.375 | | assumed | |
| `rideStickAheadOfHpointIn` | 6 | | assumed | Stick x = `seatXIn` + this |
| `rideStickInsetIn` | 3.4 | | assumed | From the right chine inner face; y = -(inner half width at x - inset) |
| `rideStickLengthIn` | 14 | | assumed | |
| `rideStickPivotAboveSeatIn` | 1.0 | | assumed | |
| `rideStickCableArmIn` | 1.5 | | assumed | |
| `stickCableDiaIn` / `stickCablePreloadLbf` | 0.125 / 10 | | assumed | |

**Brakes (`brake` group)**

| Key | Default | Note |
|---|---|---|
| `frontBrakeType` | 0 | 0 = tread shoe on a knuckle swing arm, 1 = purchased kart mechanical disc (needs a disc hub adapter, flagged), 2 = none (for A/B) |
| `frontBrakeBias` | 0.5 | Target front share of the total shoe normal force. The cable takeoff arm is solved from it. |
| `frontShoeTravelIn` | 0.3125 | |
| `brakeShoeBacking` | 1 | 0 = oak with bonded lining (old), 1 = lined steel-backed purchased shoe |
| `brakeShoeBackThickIn` | 0.125 | |
| `brakeLiningThickIn` (changed) | 0.25 | |
| `hipLeverAheadOfHpointIn` | 3 | Left hip lever pivot x = `seatXIn` + this |
| `hipLeverInsetIn` | 1.0 | From the left chine inner face (inside the hull; the study's y 14.3 was outside it) |
| `hipLeverArmIn` | 9 | Pivot to grip |
| `hipLeverCableArmIn` | 1.5 | |
| `hipLeverThrowDeg` | 40 | |
| `hipCableDiaIn` | 0.125 | Bowden inner cable |
| `brakeEmergencyLimitLbf` | 50 | |
| `brakeHeatLimitK` | 250 | Shoe surface temperature rise limit |
| `brakeHeatContactFrac` | 0.5 | Real contact patch as a fraction of the shoe area |
| `rideRunFt` | 300 | Longest ride run without a cooling stop (assumed, Q-4) |
| `beltDesignG` | 5 | Lap belt anchors, verify |

**Ride and bump (`ride` group, plus `factors`)**

| Key | Default | Note |
|---|---|---|
| `rideSpeedMph` | 10 | Design speed (D-49) |
| `rideMaxSlopeDeg` | 10 | Walk it down above this (D-51) |
| `rideGoSlopeDeg` | 8 | GO needs the lower μ below this |
| `rideMuGo8` / `rideMuGo10` | 0.4 / 0.5 | Worst-bias table values (study section 1.5) |
| `rideMuDerate` | 0.85 | Camp-measured μ x this for speed (critic correction 5) |
| `rideStopMaxFt` | 40 | At the 8 deg envelope slope, from 10 mph, including a 1 s reaction |
| `rideReactionS` | 1.0 | |
| `bumpSpeedMph` | 10 | |
| `bumpNormalHeightIn` | 1.0 | Routine bump |
| `bumpHardHeightIn` | 2.0 | Rare hard hit (D-50: the 2" pothole or root) |
| `bumpWheelRateLbIn` | 400 | Effective radial stiffness of a pneumatic wheel including bottoming. **Verify by a deflection test.** |
| `bumpMassShare` | 1.5 | Effective mass as a multiple of the struck wheel's static load (wheel plus its share of the axle line) |
| `failSafeFactor` | 1.0 | Hard-hit rows compare to ultimate / this |
| `fatigueLoadFactor` | 2.5 | Static wheel load x this, pulsating (stub is fixed, wheel rotates) |
| `spindleEnduranceLimitPsi` | 30000 | Marin-derated, verify |
| `fatigueSafetyMin` | 1.5 | Goodman |
| `ackermannErrorMaxDeg` | 1.0 | |

Changed defaults: `turnRadiusMaxIn` 96 to 108 (D-51 relaxed to 9 ft). `dynamicFactor` stays 3, but its label becomes "Dynamic load factor (tow, lifting, rider throw)".

Removed in Stage 3 (grep-clean, then delete): `curbHeightIn`, `rootHeightIn`, `curbStrikeG`, `frontDeckRaiseIn`, `shoulderBeamIn`, `drawbar`, the whole turntable/bolster/side-bearer/steer-stop/stop-block/kingpin-plate/ear/crossbar/sleeve/washer/access-panel/U-bolt (front)/bolster-fastener family listed in section 2, `frontAxleBeamThicknessIn`, `pullerHandHeightIn` only if unreferenced. The eye-bolt params (`eyeBoltDiameterIn`, `eyeBoltYieldPsi`, `eyeBoltWasherDiameterIn`, `eyeBoltEyeOffsetIn`, `bridleTieOverloadFactor`, `bridleTieHandHeightMaxIn`) survive for the tongue-tip tie. `sanitizeParams` ignores unknown keys, so old shared links still load (add a test).

### 1.8 Ackermann spec bridge

`ackSpec(p: Params): AckSpec` lives in `params.ts` (like `hullCurveSpec`, so `ackermann.ts` stays pure plain numbers and params.ts can import from it). `Layout` carries `front.ack`.

---

## 2. Removal list

### 2.1 Model

| File / symbol | Action |
|---|---|
| `src/model/steering.ts` | Rewrite. Delete: turntable, bolster rails, kingpin (grade-8 pin through plates), crossbar, sleeves, carrier/under/bar plates, shear ears, steer-stop dogs/pads/blocks/risers, access panel (`nose-access-panel`), rope-leg bridle (`eyebolt-L/R`, `bridle-L/R`). Keep: `tongue`, `bridle` (single lead), the `roundedRectCCW` helper only if `body.ts` uses it for the deck (check). |
| `src/model/kingpin-plates.ts`, `src/model/stops.ts` | Delete |
| `src/model/running-gear.ts` | Front half: remove front through-rod/stubs, `beam-F` (oak), the front U-bolts and plates (`clamp-F?1/2`), and the `kingpinPlatesOn` joint. Add `beam-F` (steel tube), brackets, spindles. Rear is untouched. |
| `src/model/layout.ts` | Remove: `turntable`, `bolster`, `sideBearer`, `kingpin`, `kpPlates`, `crossbar`, `accessPanel`, `noseRailEnd` (becomes `xFront - transom`), `xs`, `noseTop`/`noseBot` (alias to deck for one stage, then delete), `shoulderBeam`. Add `front: FrontLayout` (section 9). Keep `kx`, `beamF`. |
| `src/model/build-utils.ts` | `Ctx.pivot` out; `ctx.pose` in; explode vectors for new ids; `HULL_STEP`/`STEP` text updated (no bolster, no deck step). |
| `src/model/body.ts` | `deck-cabin`/`deck-nose` merge into `deck`; remove the step riser/ledge parts; the access-panel opening; finger guard rebuilt on the new sweep. |
| `src/model/frame.ts` | `shoulder-beam` gone. `rail-nose-*` run from `xn` to the front transom, notched for `beam-F` like the rear beam (D-48 pattern: rail notch, 316 angle hold-downs; put the helper in a new `front-mount.ts` rather than touching `rear-mount.ts`). Nose joists straddle the beam like `cabinJoistX` does at the rear. |
| `src/model/joinery.ts` | Remove the shoulder-beam Dominos and scarf at the deck step; the bolster/crossbar joints. |
| `src/model/hull-curve.ts` | Keep the curve. Replace the tire sweep spec with the per-wheel one (section 4). |
| Mass / baselines | `applyHardwareMass`: front fasteners now come from the new joints. |

### 2.2 Params (families)

`turntable*`, `bolster*`, `sideBearer*`, `steerStop*` (incl. `steerStopLoadShare`, pad moduli, fit mismatch, adjust range, weld, riser), `stopBlock*`, `kingpinTorqueTopShare*`, `kingpinEar*`, `kingpinPlate*` and `carrierPlateThickIn`, `kingpinCrossBolt*`, `kingpinCrossbar*`, `kingpinSleeve*`, `kingpinWasherDiameterIn`, `kingpinThroughBolster`, `rodKingpinWebMinIn`, `weldFexxPsi`, `accessPanel*`/`accessOpeningCornerRadiusIn`, `uboltBeamClearIn`/`uboltNutAllowanceIn` (front-only; `uboltRodDiameterIn` is still used by the rear plates), `bridleTieOffsetIn`, `bolsterFastener*`, `frontDeckRaiseIn`, `shoulderBeamIn`, `turntableRatingLb`, `uhmwBearingPsi` (if no other user), `kingpinMargin` (if unreferenced), plus the validators that reference them in `validateParams`.

### 2.3 Analysis checks

| Check id | Fate |
|---|---|
| `steer-stops`, `steer-stops-bound`, `kingpin-plates`, `kingpin-bolts`, `kingpin-peak`, `kingpin-split`, `pitch-path`, `turntable-ring`, `turntable`, `kingpin` (bridle pull), `kingpin-strike`, `roll-side-bearer`, `roll-kingpin-uplift`, `roll-bolster-attach` | Delete. Their modules go with them (`analysis/front.ts` entirely; the kingpin/roll/turntable/strike functions in `structure.ts`). |
| `bridle-tie` | Re-based as `tongue-tie`: eye bolt through the tongue tip, 2 x design pull, 1/2" eye bolt as the intended weak link, 2" washer. The pull angle and `bridleTieHandHeightMaxIn` logic survive. |
| `tongue` | Re-based: tongue bending at the hinge, hinge pin shear and bearing, link pin, clevis, at 150 lbf. Moves out of `structure.ts` into `analysis/linkage.ts`. |
| `beam-front` | Re-based on the steel tube: bending/torsion between the rails and the cantilever to the bracket under normal and hard-hit loads. |
| `scaleLimits` | Exported from `front.ts` today and imported by `analysis/brake.ts`. Move to `analysis/dual.ts` first, update the brake import with one exact-string edit. |

### 2.4 Tests and docs

- Delete or rewrite: `src/model/front.test.ts` (stops, kingpin plates, bridle legs, U-bolt/eye-bolt mesh builders), the stop/kingpin/access/crossbar describes in `src/model/r3-fittings.test.ts` (S5, S12 x2), `src/analysis/front.test.ts` (all describes except a re-based bridle-tie), the kingpin/crossbar/turntable describe at the end of `checks.test.ts`, and every `frontDeckRaiseIn`, `turntable*`, `noseTop`, `shoulder` and `deck-nose`/`deck-cabin` reference in `model.test.ts`, `hull.test.ts`, `hull-curve.test.ts`, `visual-geometry.test.ts`, `params.test.ts`, `test-baselines.ts`. `PHASE1_BASELINE` loses `turntable*`, `frontDeckRaiseIn`, `kingpinSleeveOdIn`, `bolsterFastenerDiameterIn`, `drawbar`, `frontAxleBeamThicknessIn`, `kingpinLeadIn`.
- The sim test `sim.test.ts` and `simple-text.test.ts` lines that mention the turntable/bearer words are updated by WS-E.
- Docs: `docs/phase3-r3-front-notes.md` and `docs/phase3-honesty-notes.md` are marked superseded. `docs/hull-curve-notes.md` is replaced by `docs/hull-taper-notes.md`. `scripts/{explore,candidate,recommended,recommend-table}.ts` are outside `tsconfig` and stale; mark them legacy in the README (do not fix).
- DECISIONS annotations for orchestrator: mark the front end of D-12, D-25, D-31, D-32, D-33, D-34, D-43, D-46, D-47 and part 2 of D-45 as superseded by D-51/D-52. BRIEF §4.2 ("default to wagon steer"), §4.3 and the §7 rows "Kingpin / turntable" are rewritten.

### 2.5 What survives from old `front.ts`

- The bridle tie logic (150 lbf peak, upper-bound hand height 40" at 96" run = 16.4 deg, intended weak link, 2 x overload) as `tongue-tie`.
- `scaleLimits` (moved).
- `pinReactions`/`boltCapacity` (NDS bolt capacity) are reused by the bracket-bolt and eye-bolt rows if a row needs a wood bolt (the rail hold-down bolts); move to `analysis/nds.ts` (WS-D).

---

## 3. Hull (D-52)

### 3.1 Taper from the Ackermann sweep

Derive in this order (all in `resolveNose` and `hull-curve.ts`, driven by the Stage 0 sweep spec):

1. Left-tire sweep: the left tire rectangle (`2r` x `tireWidth`) rotated about `K_L` by the left-wheel angle, for steerDeg from -(outer at tow lock) to +(inner at tow lock) in 1 deg steps (solved by `solveSteer`). The right side mirrors it. The ride-lock sweep is inside it.
2. Nose half width = `min over sweep of inner y` minus `steeringClearanceIn`, rounded down to 1/8". At the defaults: 20.625" outside (calc).
3. Curve end `xn` = the latest end for which the OUTER face of the curve still clears the sweep (existing `latestCurveEnd`, with the new spec). At the defaults x about 38" (`noseTaperStartIn` about 6", not 13.25").
4. Curve start `hullCurveStartIn` = the earliest allowed: not ahead of the grab handles (`gripFront` = 14.4" at the defaults). Default 14.5".
5. A longer curve is better, so the old rule "move the start earlier if the radius is too tight" stays.

Keep `buildPlanCurve` (S-curve, both ends parallel to x) unchanged. It is gentle now (R_min about 30" and peak heading about 20 deg instead of R 5.7" and 67 deg). A single constant-radius arc would not reach a parallel nose; the existing curve is tested, cached and consumed by sweeps, bandParts, joinery, finger guard and the validator. Retuned `hull-curve.ts` changes only: `TireSweepSpec`/`CurveClearanceSpec` get the per-wheel fields, `HULL_CURVE_END_BEHIND_AXLE_MIN_IN` drops from 12 to 3 (no shoulder beam or bolster to leave room for), and `HULL_CURVE_START_MIN_IN` stays 8.

### 3.2 Nose deck at cabin height; shoulder beam and step removed

With no turntable, nothing raises the nose deck. Remove `frontDeckRaiseIn`, the step, the riser, the shoulder beam, the ledge in the cabin rails, and the `deck-nose`/`deck-cabin` split. One `deck` polygon spans the rear transom to the front transom (about 77" long, fits a 4 x 8 sheet). Recommended capture: the existing nose-style 1/4" rabbet in the chine underside, hull-wide (one joint type). The cabin rails shrink from 4"+1" to the plain `railDepthIn`. The side lines are the same height everywhere (`sideTop = deckTop + sideH`) with the D-44 sheer kept.

Interim aliases (one stage only, so tests can migrate): `L.noseTop = L.deckTop`, `L.noseBot = L.deckBot`, `L.xs = L.xn`, `L.shoulderBeam = 0`. `frame.ts` already skips the shoulder beam when `xn - xs <= 0.2`. Delete the aliases in Stage 3.

### 3.3 Can the chines, gunwales and rails be sprung from solid stock?

No, not at these radii. Beam theory: strain at the surface is `eps = t / (2R)`, with `R` the inside radius. At R_in = 29.5" (R_min 30" minus half the section):

| Member | Solid | Strain | Verdict |
|---|---|---|---|
| Chine/gunwale 5/8" | 1 piece | 1.06% (R/t = 47) | Above dry white oak rupture strain (about 0.8% for clear 2x2 test pieces). Even at 0.5% the held-in-place residual stress (E x eps = 8.9 ksi) is 60% of MOR. |
| Rail 3/4" | 1 piece | 1.27% (R/t = 39) | Worse |
| Chine/gunwale 5/8", 2 plies of 5/16" | laminated | 0.53% per ply as bent, stress-free once glued | Fine. R/strip = 94 is far above the existing 40x lamination rule. |
| Rail 3/4", 2 plies of 3/8" | laminated | 0.51% | Fine |

A solid spring needs about `R >= 100 t` = 62.5" for the 5/8" members. That needs the cabin about 1.8" narrower per side or a curve about 10" longer, neither of which the tire sweep or the seat allows. Cutting the curve out of wide stock leaves a grain slope of 1:2.8 at the steepest point (about 20 deg), which loses most of the strength, so that is also out.

**Recommendation:** keep bent lamination but simplify it. `hullLamThicknessIn` 1/8" to **5/16"** (2 plies for the chine and gunwale; the rail rounds to 2 x 3/8"), `hullWebPlies` 2 to **1** (a single 6 mm okoume sheet bends at R 30" easily; the old 2 x 3 mm layup was only for R 5.7"). One form, simple cauls, no steaming. Add an info validator message ("sprung solid would need R >= 100 t = X") and let Eric try a 5/8" test strip on the form before dropping the lamination. `hullLamMinRadiusFactor` stays 40.

Scarfs: keep the cabin-run/nose-run split with the 1:8 scarf at `xn` (lowest risk; the nose run is only about 14" long). Stretch goal for WS-B only if time remains: one continuous chine/gunwale/rail per side, no scarf.

### 3.4 What of `hull-curve.ts` is reused

All of it: `buildPlanCurve`, `sidePolyline`, `curveCenterY`, `offsetY`, `curveHeading`, `minGapToTires`, `curveTireGap`, `latestCurveEnd`. Changed: `TireSweepSpec`/`leftTirePolys` (per-wheel pivots and angles), the cache keys. `fingerAnalysis`, `frontTirePlan` and `computeFinger` in `body.ts` move to the same spec.

### 3.5 Finger guard

The no-pinch gap rule stays (`fingerGapMinIn` 1.5"). The hull is by design 0.75" from the tire at the inner lock, so a guard is still needed, but the pinch zone is much smaller and 10-11" farther forward: only the tire's rear inner corner against the straight nose side near x about 36-40" (the curve is over by then). The guard is the existing printed ASA joggled-L hood (0.75" above the tire top, strap on two #10-32 inserts), recomputed from the new sweep. Option B (decision for Eric): raise `steeringClearanceIn` to 1.5", which removes the guard entirely and narrows the nose to 19.3". Default stays at option A (0.75" + guard); both are tested.

### 3.6 Interior checks that move

- `validateParams` seat rules: the cushion front corners now sit in the near-straight part of the curve (inside half width at x = 24 is about 12.6" vs 9.25" needed): fixes the old "seat cannot move forward" problem. Re-run the seat range tests.
- Foot-well width: nose inside 19.4" vs the foot span plus boots about 14" at 68" stature: passes with margin.
- The kingpin-pin/turntable/bolster validators (nose deck underside vs front stack, transom bottom vs turntable top, access panel, stop fit) are deleted. New validators: tongue top below the front transom bottom by 0.25"; scrub rule (section 1.7); front beam top below the nose rail bottom; bracket outside the hull (|y| of the bracket web >= nose outer half width + 1").

---

## 4. Brakes

### 4.1 Mechanism

Rear: unchanged geometry (lever, link, crank, 7/8" cross shaft, two arms per side) except:
- Shoes become **purchased lined steel-backed shoes** (4" x 2.5" lining on a 1/8" steel back, radius-matched to the 13" tire), pinned to the existing shoe arms. `brakeShoeBacking` 1. The oak pad and bonded lining remain as option 0. Mass per shoe about 0.6 lb. `brakePadMu` 0.45 wet, `brakePadMuFouled` 0.35 unchanged.
- The main lever gets a **takeoff pin** at radius `a_f` above its pivot for the front cable, and a **lost-motion slot link** at 4.1" above the pivot for the hip cable.

Front (`frontBrakeType` 0): a tread shoe on a swing arm pivoting on each knuckle's brake boss. Because the tire's rear inner corner sweeps closest to the hull, the front shoes sit on the **front** of the tread, 11 deg below the axle line (mirror of the rear placement), where the nose is far clear. Each shoe is driven by a Bowden cable with a housing loop so the steering moves it freely. One cable from the main lever takeoff splits at an equalizer under the deck into two outers (equal pull to both knuckles; brake-steer from imbalance reported as an info row, about 40-120 lb.in per wheel at scrub 3"). Front shoe stroke 5/16".

Option 1 (`frontBrakeType` 1): a purchased kart mechanical disc and caliper on a hub adapter. Needs a wheel hub with disc mounting (the hand-truck wheels have none). Flagged; not the default.

Bias: `frontBrakeBias` 0.5 is the target front share of the total shoe normal force. The takeoff arm `a_f` is solved by bisection in the geometry (like the existing `brakeLeverTailAuto`). The solved ratio is then checked in both rolling directions.

Hip lever (left): pivot at x = `seatXIn` + 3 = 15", y = +(inner half width - 1.0") (inside the hull), grip 9" up at z about 20", 40 deg throw, return spring. Bowden cable runs aft in a printed channel on the left chine inner face just above the deck (past the seat cushion; the storage box stands 0.5" off the chine, enough for a 3/16" housing), passes outward through one grommeted 1/4" hole in the left rail near x about -6", and ends at the main lever's lost-motion slot (1.4" slot). The handler's lever moves free of the rider's. Mechanical advantage of the hip lever to the main lever grip is about 0.93:1 (hip force 0.93 x the equivalent main-grip force), so the rear-handler and rider forces are about the same for the same braking. Because the front brake takes about half the hold, the hold force on either lever roughly halves (25 lbf to about 13 lbf for the goal rider at 15 deg).

Parking: the existing quadrant and pawl hold the main lever, so both axles stay set. The hip lever cannot release the pawl (only the main lever's thumb tab does). Who releases is the handler's job (procedure).

Lap belt (ride only): 2" webbing, quick-release buckle, two through-bolted anchor plates on the rails (3/8" bolts, doubler). Anchor load = rider x `beltDesignG`.

### 4.2 Checks

| Check | Method | Limit |
|---|---|---|
| `brake-ratio` (rebased) | Report the rear branch ratio, the front branch ratio and the total. `ratio_total = N_total / F_hand = R_r / (1 - bias)`. Grip travel at the hip and main lever. | `brakeLeverRatio` target, travel <= 6.5" |
| `brake-force` (rebased) | Hold the 15 deg slope: `F = W sin(theta) / mu / (ratio_total x eta)` at the main lever grip, and the hip lever grip via the 0.93 factor. Mud-fouled lining is the pass/fail case. | <= 30 lbf both levers |
| `brake-emergency` (new) | 0.30 g at the envelope slope (8 deg) from 10 mph: friction needed `W (0.30 + sin(theta) - Crr cos(theta))`, normal force = friction / fouled mu, hand force through the chain. | <= `brakeEmergencyLimitLbf` 50 lbf |
| `brake-stop` (new, `ride-stop`) | Stopping from `rideSpeedMph` including `rideReactionS` of acceleration: distance = (v0 t + 0.5 a t^2) + v1^2 / (2 a_dec), `a_dec = g (mu_eff cos(theta) - sin(theta) + Crr cos(theta))`, mu_eff = min(tire mu, decel the bias allows). Slopes 5, 8, 10 deg at mu 0.5; info at 0.3/0.4. | <= `rideStopMaxFt` 40 ft at 8 deg, <= 55 ft at 10 deg (info) |
| `brake-bias` (new) | Front share of the total shoe force, both rolling directions, with the front-lock-first test: at the tire limit (mu_g, load transfer on the slope) the front axle locks no later than the rear. Share must lie in 0.4-0.6. | 0.4-0.6, front locks first |
| `brake-heat` (new) | Surface temperature rise `dT = 2 q sqrt(t) / (sqrt(pi) e)`. q = (partition x brake power) / (shoe area x `brakeHeatContactFrac`). Partition 0.7 for oak, 0.5 for lined steel-backed. Effusivity e: oak 550, lined 450 W s^0.5 /m2K (verify). Power `W v (sin(theta) - Crr cos(theta))` at 10 mph over four shoes. Report the allowable continuous distance to `brakeHeatLimitK` 250 K. | >= `rideRunFt` 300 ft at 8 deg. Study values (lined, four shoes): about 125 ft at 15 deg, about 330 ft at 10 deg; the model should land near 570 ft at 8 deg. Oak is a short-hop rule and fails. |
| `brake-front` (new) | Front shoe arm bending, boss bolt, cable tension at 2 x hold, housing loop clearance over the steering sweep (reuse the swept-shoe obstacle approach in `brakeSweep`). | utilization <= 1 |
| `hip-cable` (new) | Cable tension at the 100 lbf abuse grip load vs minimum break strength / 3.5. | >= 3.5 |
| `park-hold` (replaces `brake-traction`) | Both axles locked, parked on 15 deg: ground friction `mu W cos(theta)` vs `W sin(theta)` at mu 0.5 (pass) and 0.3 (info). | >= 1.5 at mu 0.5 |
| `brake-clear` | Existing rear sweep plus the front shoes against the hull and the tire over the steering sweep | existing limits |
| `belt-anchor` (new) | Rider x `beltDesignG` over two anchors, 3/8" bolts through rail + doubler (reuse the rail bolt capacity helper) | ultimate, no safety factor (fail-safe) |

Existing rows `brake-lever`, `brake-links`, `brake-shaft`, `brake-shoes`, `brake-ratchet`, `handle-sockets`, `brake-abuse` keep their logic. `brake-links` and `brake-shaft` must include the front-takeoff reaction on the main lever pin (the main lever now carries three attachments).

---

## 5. Load cases (D-50)

### 5.1 Bump model (new `analysis/bump.ts`, replaces `obstacleForce` and `strikeCases`)

Velocity-change pulse on one wheel (method from the study, section 2.3, but with pneumatic tire compliance in place of the 3,000 lb/in stack):

```
sin(beta) = (r - h) / r             contact normal tilted beta above horizontal; h capped at 0.9 r
v_n       = v cos(beta)             normal-direction speed (v = bumpSpeedMph)
m_e       = bumpMassShare x (static wheel load) / g
F_n       = v_n sqrt(k m_e)         k = bumpWheelRateLbIn
H = F_n cos(beta)   V = F_n sin(beta)   (V is up on the wheel)
```
`bumpStrike(ctx, caseData, wheel: 'front'|'rear', hIn)` returns `{ Fn, H, V, beta, factor = Fn / staticWheel }`.

Expected values at the defaults, 150 lb rider, front wheel about 65 lb, rear wheel about 100 lb (calc, approximate; the tests pin the formula, not these):

| Case | Front F_n / H / V | Rear F_n / H / V |
|---|---|---|
| 1" normal | 943 / 503 / 798 lbf (14x static) | 1,169 / 623 / 989 |
| 2" hard | 1,276 / 921 / 883 | 1,583 / 1,142 / 1,096 |

Caveat: `bumpWheelRateLbIn` is the dominant uncertainty. Every bump row prints a sensitivity line in `how` (k x 0.5 and x 2.5). A bench deflection test of one wheel is a Phase 4 gate. If a pneumatic wheel does not reach 400 lb/in effective, the numbers fall.

### 5.2 Two bases

| | Normal use (full margins) | Hard hit (fail safe) |
|---|---|---|
| Load | `bumpNormalHeightIn` 1" at 10 mph; towing, braking, steering, lifting as before | `bumpHardHeightIn` 2" at 10 mph, one wheel, front or rear |
| Steel and fasteners | Yield / `steelSafetyFactor` (2) | Ultimate / `failSafeFactor` (1). Bending, not breaking, is allowed. Compare elastic stress to ultimate (conservative against the plastic moment). |
| Wood | `oakDesignMorPsi` (MOR x C_M / 2), NDS allowables | MOR x C_M (no safety factor), no splitting or cleavage |
| Wheel | Peak V vs `wheelRatingLb x wheelRatingPeakMult` (rating verified, D-11) | **Wheel retention**: the wheel must not leave the stub. Cotter and castle nut shear against a lateral hit `F_lat = 0.8 V` (rut wall), stub-end bending to ultimate. A bent or flattened rim is accepted. |
| Order of failure | | Ductile steel yields first (beam, tie rod buckles), bolts and stubs last. The `how` lists utilizations in that order. |

### 5.3 Fatigue (normal riding)

`spindle-fatigue`: stub bending with the load direction fixed on the stub (wheel rotates), so the stress is pulsating (R = 0): `sigma_max = M / S`, `sigma_a = sigma_m = sigma_max / 2`, `n = 1 / (sigma_a / Se + sigma_m / Sut)`, with `Se = spindleEnduranceLimitPsi`, `Sut = spindleUltimatePsi`. Static wheel load x `fatigueLoadFactor` (2.5) at the arm from the bearing center to the boss. Also the kingpin bolt (shear and bending) and the steering arm. Limit `fatigueSafetyMin` 1.5. At the defaults a 25 mm stub is far below the limit; a 17 mm stub gives n about 4.7 (calc).

### 5.4 Which existing rows change basis

| Row | Old | New |
|---|---|---|
| `kingpin-strike`, `roll-*`, `pitch-path`, `turntable-ring`, `steer-stops*` | 3" curb / 2" root, H = V tan(phi), x3 | Deleted. Replaced by `spindle-stub`, `kingpin-bolt`, `kingpin-bracket`, `beam-front`, `wheel-retention`, `spindle-fatigue` on the bump model |
| `axle-stress` (rear only now) | static wheel x 3 vs yield / 2, tire-friction resultant | Normal: resultant of H and V (1" rear) at the stub, allowable yield / 2. Hard: ultimate. Likely forces the rear axle to 1" or a stronger steel; the check reports it (section 12) |
| `bearing-groove` (rear) | wheel x 3 | Normal V_bump |
| `wheel-rating` | static x 3 | Normal: V_bump (front and rear) vs rating x peak mult. Hard: `wheel-retention` only |
| `rear-beam-seat` | axle x 3 | Normal: rear wheel V_bump + rebound. Hard: ultimate of the 316 hardware |
| `rails`, `deck` | payload x `dynamicFactor` (3) | payload x `max(dynamicFactor, bumpSeatG)`, with `bumpSeatG = 1 + V_rear_one_wheel_normal / W_total` (about 3.9 at 150 lb; calibrate against the Rapier bump scenario's peak) |
| `seat-back`, `seat-grip` | rider x 3 | x `max(3, bumpSeatG)` |
| `foot-stop` | rider x `curbStrikeG` (2) x share | rider x `bumpSeatG` x share (normal). Ultimate row with the lap belt for the hard hit. |
| `lift`, `handle-sockets`, `brake-abuse`, `tip-*`, `slide-before-tip` | | Unchanged basis |

Operating (150 lb) must pass everything, goal (200 lb) is the goal: unchanged (D-1). The Simple view rider sweep keeps working because every new row is dual-case (`dualCheck`).

### 5.5 New and re-based structural rows (all dual operating/goal)

`spindle-stub` (bending, shear on the stub root, bore bearing from the hub), `kingpin-bolt` (shear and bending in two leaves, bearing), `kingpin-bracket` (leaf bending/bearing, web-to-beam bolts, crush sleeves), `beam-front`, `tie-rod` (axial, Euler buckling of the 27" rod: with 1/2" rod `Pcr` about 1,200 lbf, rod-end rating, kickback from scrub radius), `tongue` (hinge pin, link), `tongue-tie`, `stick-cable` (cable tension at 60 lbf hand and at kickback; swage sleeves), `wheel-retention`, `spindle-fatigue`. Kickback to the hand: knuckle moment from a hard front hit at the scrub arm divided through arm and bellcrank ratios (study: 44-160 lbf at the grip before the bellcrank window absorbs it; the stops must take it).

---

## 6. Ride-mode rules in the app

### 6.1 Rule content (from D-51 and the study)

- Ride only on slopes up to `rideMaxSlopeDeg` (10 deg), on dry-ish ground. Above that, the cart is walked down: rider off, handler on the brake. No belay system.
- Up to `rideSpeedMph` (10 mph) on smooth, signed runs; 5 mph wherever steps of 1" or more or the table shows CAUTION.
- Daylight only. Ride mode is off during the 7 pm race; the race runs tow mode.
- Lap belt fastened, helmet on (mandatory). An adult spotter at the bottom.
- Table (worst-bias deceleration, front share 0.4-0.6): required usable μ is 0.4 up to 8 deg and 0.5 up to 10 deg for a GO (at least 0.2 g). Below that, CAUTION (5 mph with a handler) or walk. A belted-rider rollover is an accepted risk for daylight, envelope-limited, up to 10 mph (Eric to confirm: section 12).

### 6.2 Camp friction test

One adult, one minute, top, middle and bottom of each run, repeated after rain:
1. Lock or strap all four wheels so none rotates.
2. Drag the empty cart (169 lb, or the actual weight) at a steady walk with a hand scale on a rope. `measured μ = scale reading / cart weight`.
3. Usable μ = measured x `rideMuDerate` (0.85, the 10 mph derate). Compare to the table.
4. Slope check: lock the wheels and release the empty cart from rest; if it slides on a slope θ, then μ < tan θ (it holds a 15 deg slope only when μ > 0.27).
5. Mark each run with the result and the date.

### 6.3 Where it appears

| Place | What |
|---|---|
| Simple view (`src/ui/simple-view.ts`, new section "Riding it downhill") | A card with: the slope x μ table (rows 5, 8, 10 deg; columns measured μ 0.3-0.7, already derated), the speed rule, the daylight/helmet/belt/spotter rules, "walk it down above 10 deg", and the camp μ test. Built by a pure function `rideRules(p)` in a new `src/ui/ride-rules.ts` so the numbers come from params and tests pin the text. |
| Simple view light "Hills & braking" | Adds `brake-stop`, `brake-emergency`, `brake-heat`, `brake-bias`, `ride-rollover` to the group and a sentence: "On a 8 deg hill at 10 mph it stops in about N ft." |
| Simple view "Steering" light | Adds `steer-kin`, `steer-lock` |
| Analysis panel | New info row `ride-envelope` (the table and the limits as a `how` text), new "Loads and factors" lines: Ride speed, bump heights and wheel rate, replacing the "Front strike obstacles" line; Dynamic factor line relabeled. |
| Params panel | New "Ride mode and bump loads" group. |
| README | A short "ride mode" section. |

---

## 7. Stability and steering analysis changes

| Row | Change |
|---|---|
| `steer-clear` | Sweep rewritten for per-body poses: `bodyPoses(spec, solveSteer(spec, d))` for each of -outer..+inner in 1 deg steps, moving knuckles, spindles, wheels, front shoes, tie rod, drag link, bellcrank, tongue as separate rigid bodies against every chassis OBB. Excludes the intended-close pairs (bracket vs spindle boss, tie rod end vs arm). Limit `steeringClearanceIn - 0.05`. |
| `turn-radius` | From `solveSteer` at the tow lock: the mean of the two instant centers, outer tire edge. Limit 108". |
| `tip-lock` | Contacts from the solved moved wheel centers at the tow lock (`contactsAt(g, innerRad)` takes the Ackermann spec); the existing >= 35 deg limit |
| `slide-before-tip`, `v-rollover` | Use the Ackermann instant center. |
| `steer-kin` (new) | Max Ackermann error over 0-lock <= `ackermannErrorMaxDeg`, and `ok` (linkage assembled) at both locks and at neutral. |
| `steer-lock` (new) | Tow stops reach 35.5 +/- 0.1 deg inner before any other stop; ride window 8.0 deg outer; tongue yaw <= `tongueMaxYawDeg` at the tow lock (about 24.3 deg vs 25). |
| `ride-rollover` (new) | Lateral acceleration `v^2/R` at 10 mph at the ride lock vs 0.5 x SSF at that lock; info: the tire slides first (about 0.5 g at mu 0.5; study: 1.16-1.23 g to tip). |
| `steer-centering` (new, info) | Ground trail `lead + r tan(caster) + 0.5` pneumatic, centering moment per degree, spring force at the grip. |
| `ride-steer-effort` (new, info) | Steady hand force at 5 deg (about 2 lbf), transient and kickback forces at the stick. |

`loads.ts`: `buildLoadModel(p, parts, ack)` replaces the single `kingpinX`; `cgAt(innerRad)` moves each steer group about its own kingpin by its own angle (steer bodies: `steer-L`, `steer-R`, front wheels, front shoes).

---

## 8. Viewer and sim

### 8.1 Viewer

Articulation is already a model rebuild per slider value, so no viewer geometry code is needed; the model owns the poses.
- `main.ts`: the steer slider range follows the mode (`-lock..+lock` of the active mode, inner-wheel angle). Add a Both/Tow/Ride toggle (view state, not in the URL); `view.mode` flows to `buildModel`. Slider caption: "Steer (inner wheel)".
- Explode: add vectors to `defaultExplode` for the new ids (done by WS-A in `build-utils.ts`): spindles outward and down, brackets outward, tie rod/drag link/bellcrank down and aft, tongue forward, stick up, cables down, mode plate/pin down.
- Rendering of stick, cables, mode pin: standard parts (`customPart` meshes, `tubeAlong`). Viewer "Joinery" toggle shows the new bolt joints automatically. Stretch: a "Steering sweep" overlay (plan outlines of the tire at each degree, from `leftTirePolys`) toggled on the ground plane.
- Highlight: when a part is selected in the cut list, the viewer already highlights by id; no change.

### 8.2 Sim (Rapier)

- Bodies: `chassis`, `steer-L`, `steer-R`, four wheels. `SimBodyId = 'chassis' | 'steer-L' | 'steer-R' | WheelId`. Wheels' parents are their own knuckle.
- Joints: two vertical revolutes (`kingpinL`, `kingpinR`) at `spec.kingpinM.L/R`, each with limits (tow lock outer/inner or ride lock). Coupling by position motors, not a physics linkage: the left motor target is the commanded angle, the right motor target is `right(left)` from `solveSteer` (stiff gains, as the current single-joint motor). This is the "simplified equivalent" of the tie rod.
- Visual-only bodies: `tie-rod`, `bellcrank`, `tongue` poses are computed analytically each frame from the commanded angle (`poseMatrices`) and merged into `sim.poses()`, so the viewer shows them moving.
- Bridle (tow) mode: the pull force acts on the chassis at the tongue hinge. The tongue angle follows the rope direction (target = pull direction in the cart frame, rate and damping limited, clamped to `tongueMaxYawDeg`); the commanded steer angle is `solveFromTongue(spec, thetaT)`. Qualitative, labeled so.
- Ride mode: `SimConfig.mode: 'tow' | 'ride'`. In ride mode the steer input is clamped to the ride lock and a weak centering motor pulls to zero when the input is zero.
- Brake: torque split to four wheels by the geometry's front share (`spec.frontBrakeShare` from the takeoff arm), not rear-only. `controls.brakeLbf` is the total at the four contact patches.
- Scenarios: replace "Root / curb strike" with "Bump at 10 mph" (initial speed 10, 2" root at 100", no curb); add "Ride downhill 8 deg, 10 mph, rider brakes at 1 s". Keep the curb obstacle in the engine (not a design load).
- Mass properties: knuckle bodies are light (spindle + shoe, a few lb). Keep the existing high solver-iteration setting; two knuckle loops need the same iteration budget. The `steerScrape`/`hullSteer` colliders now apply to both knuckles.
- Rows to reconcile in the sim test: tilt table vs static `tip-lock` (now uses the Ackermann contacts at the tow lock).

---

## 9. Stage 0 contract (what must land first)

All additive. `npm run typecheck` and `npm test` stay green when Stage 0 merges.

```ts
// src/model/ackermann.ts (plain numbers; no params import)
export interface AckSpec {
  wheelbase: number; kx: number; lead: number; scrub: number; kpHalf: number;
  armLen: number; armAngleDeg: number; tieLen: number;               // tieLen derived
  bellArm: number; bellPivot: [number, number];                       // plan point
  tongueHinge: [number, number]; tongueLinkArm: number;
  towLockInnerDeg: number; rideLockOuterDeg: number;
}
export interface SteerSolution {
  steerDeg: number; innerDeg: number; outerDeg: number;               // magnitudes, deg
  leftDeg: number; rightDeg: number;                                  // knuckle angles, + = CCW (turn left)
  rod: { dx: number; dy: number; rotDeg: number };
  bellcrankDeg: number; tongueDeg: number; stickDeg: number;
  ok: boolean;
}
export function solveSteer(s: AckSpec, steerDeg: number): SteerSolution;
export function solveFromTongue(s: AckSpec, tongueDeg: number): SteerSolution;
export function lockLimits(s: AckSpec, mode: 'tow' | 'ride'): { innerDeg: number; outerDeg: number };
export function idealOuterDeg(s: AckSpec, innerDeg: number): number;
export function ackermannErrorDeg(s: AckSpec, innerDeg: number): number;
export function wheelCenters(s: AckSpec, sol: SteerSolution): { L: [number, number]; R: [number, number] };
export function instantCenters(s: AckSpec, sol: SteerSolution): { fromLeft: number | null; fromRight: number | null; mean: number | null };
export type SteerBodyId = 'steer-L' | 'steer-R' | 'tie-rod' | 'bellcrank' | 'tongue';
export function poseMatrices(s: AckSpec, sol: SteerSolution): Record<SteerBodyId, Mat4>;
export function leftWheelRange(s: AckSpec): { minDeg: number; maxDeg: number };   // -outer..+inner at the tow lock
```
Also in Stage 0:
- `ackSpec(p)` and the full param block of section 1.7 in `params.ts` (new `'ride'` group), including changed defaults, with the old params untouched.
- `Layout.front: FrontLayout` (additive; old fields remain): `ack`, `kp: {L,R}`, `stub: {L,R}` (neutral wheel centers), `armTip: {L,R}`, `tieRod: {x,z,len}`, `bellcrank`, `tongue: {hinge, linkPin, z}`, `beam: Beam`, `bracket: {L,R}` (footprint, leaf z's, bolt axes), `knuckle: {L,R}` with `bossPos`, `bossAxis`, `shoePivot`, `shoeAngleDeg` (the WS-C input), `stick: {pivot, grip, cableArm}`, `hipLever: {pivot, grip}`, `mode: {plate, pinTow, pinRide}`. `L.kx` stays.
- `RigidBody` gains the new ids; `ViewState.mode`; `Ctx.pose` (while `Ctx.pivot` stays).
- `analysis/geometry.ts`: `ContactInputs` gains optional `ack`; `contactsAt(g, innerRad = 0)` uses it when present, otherwise the old rotation.
- `hull-curve.ts`: `TireSweepSpec` gains optional `ack`; `leftTirePolys` uses the per-wheel sweep when present, otherwise the old behavior.
- Tests: `src/model/ackermann.test.ts` (section 10.A).

---

## 10. Work breakdown: five workstreams, strict file ownership

Rules (CLAUDE.md): shared files `src/params.ts`, `src/model/layout.ts`, `src/model/types.ts` and the big tests (`model.test.ts`, `checks.test.ts`, `params.test.ts`, `test-baselines.ts`, `rider-sweep.test.ts`) get only small exact-string edits from workstreams that do not own them. Parallel agents never run git stash, checkout, reset or commit. Run only your own test files with `npx vitest run <file>` while others are mid-edit; the orchestrator runs the full suite and typecheck at integration.

### Sequencing

```
Stage 0  (A0, first)    additive interface: params block, ackermann.ts, Layout.front, RigidBody/ViewState/Ctx, geometry+sweep spec compat
Stage 1  (parallel)     A1 front end build + removal | B hull | C brakes | D analysis | E viewer/sim/UI
                        B, C, D, E code against the section 9 signatures; all but A1 can start once A0 lands (A0 is small).
Stage 2  (the flip)     one window: A1 deletes the old model front end; D deletes the old rows; E drops 'steer'; B drops the step aliases.
                        The orchestrator then runs typecheck + the full suite.
Stage 3  (cleanup)      A and B delete obsolete params; WS-E docs/README; orchestrator updates DECISIONS, BRIEF, STATUS, phase3b notes.
```

Dependencies that matter: C needs `Layout.front.knuckle` and `solveSteer`; B needs `leftWheelRange`/`leftTirePolys` and the shoe OBBs from C only for the clearance (C publishes shoe size as params, which B reads); D needs part ids from A1 and C but computes from `Layout.front` and params, so D's tests use the layout first and the parts after A1 lands; E needs the `SteerBodyId` list.

### WS-A: Steering core and front end (owns the geometry contract)

| Owns | |
|---|---|
| New | `src/model/ackermann.ts`, `ackermann.test.ts`, `front-end.test.ts` (parts), `src/model/rider-steer.ts` (stick, cables, guide, mode pin, spring), `src/model/front-mount.ts` (beam seat in the rails, bracket geometry) |
| Rewrite | `src/model/steering.ts` |
| Edit | `src/model/running-gear.ts` (front half), `build-utils.ts`, `types.ts` (RigidBody), `index.ts`, `layout.ts` (`front`, removals), `params.ts` (steering block, `ackSpec`, steering validators), `kingpin-plates.ts` and `stops.ts` (delete), `model/front.test.ts` (delete/replace), the front describes in `model.test.ts` and `r3-fittings.test.ts` |

Acceptance tests (names):
- `ackermann: straight ahead at 0 gives zero angles and the neutral tie rod length`
- `ackermann: the 4-bar solution is the same whether solved from the left or the right knuckle (mirror)`
- `ackermann: tow lock 35.5 inner gives outer 26.0 +/- 0.1 at the defaults`
- `ackermann: error versus ideal stays under 1 deg over 0..lock and under 0.1 deg at the tow lock`
- `ackermann: ride lock outer 8 gives inner 8.55 +/- 0.05`
- `ackermann: tongue yaw at the tow lock is 24.3 +/- 0.5 deg, under tongueMaxYawDeg`
- `ackermann: the linkage reports ok = false when the tie rod length is changed by 1 inch`
- `ackermann: poseMatrices rotates each knuckle about its own kingpin`
- `ackermann: wheel centers at the tow lock match the hand values (42.49, 16.47) and (45.44, -17.99)`
- `steering parts: buildModel at steerDeg 0 and 20 moves knuckles, wheels, tie rod, bellcrank and tongue, and leaves the beam, brackets and hull fixed`
- `steering parts: mode ride omits the tongue, mode tow omits the stick, mode both has the pin in the TOW socket`
- `steering parts: the mode pin cannot occupy both sockets (distance between sockets > pin diameter + 1 inch)`
- `steering parts: no overlaps with the rest of the cart over the steering sweep at 1 deg steps in tow and ride modes` (reuse the overlap harness)
- `steering parts: the stick, cables and guide stay >= 1.25 inches from the rider mannequin's thigh and the hull and have no pinch gap under 1.25 inches`
- `validateParams: scrub radius too small for the hub and bracket is an error; defaults are clean`
- `old links load: unknown keys (turntableType, drawbar, frontDeckRaiseIn) are ignored`
- Full existing suite (rear, brake, seat, storage) unchanged at Stage 1 end.

### WS-B: Hull taper, frame and joinery

| Owns | |
|---|---|
| Files | `src/model/hull-curve.ts`, `body.ts`, `frame.ts`, `joinery.ts` (hull parts), `storage.ts` (only if the box x range changes), `seat.ts` (only validator-related edits), `docs/hull-taper-notes.md` |
| Edits (exact-string) | `layout.ts` hull fields; `params.ts` `resolveNose`, `hullCurveSpec`, `swingGeometry`, `requiredCurveRadius` and the hull validators |
| Tests | `hull.test.ts`, `hull-curve.test.ts`, `visual-geometry.test.ts`, `fittings.test.ts`, the hull/finger/lift describes in `r3-fittings.test.ts`, the hull sections of `model.test.ts` |

Acceptance tests:
- `hull taper: nose width is 2 x (min inner sweep y - steeringClearance), rounded down to 1/8 inch, 20.625 at the defaults`
- `hull taper: the outer face clears the tire sweep by steeringClearance at every degree for 13 variants (track, lock, scrub, lead, wheel size, tire width, arm angle)`
- `hull taper: curve ends at x within 1 inch of 38 and starts at 14.5 at the defaults; auto start moves earlier, never later`
- `hull taper: tangent and curvature continuous at both ends; R_min >= 28 inches`
- `hull taper: every bent member meets the 40x strip rule with 5/16 strips (2 plies) and a single 6 mm web sheet`
- `hull taper: info message when a solid sprung member would need R >= 100 t`
- `hull deck: one deck part, no deck-step riser, no shoulder-beam, side lines at one height`
- `hull deck: captured in the chine rabbet along the whole hull (distance to the chine centerline = side/2 - deckCaptureDepth)`
- `frame: nose rails are notched for beam-F, with hold-down joints, and keep >= 1 inch of rail above the notch`
- `frame: nose joists straddle beam-F`
- `finger guard: sweep gap computed from the Ackermann sweep; guard built when gap < 1.5, absent when steeringClearance is raised to 1.5` (patch like the existing test)
- `validateParams: cushion front corners clear the narrowing hull at the default seat; seat range includes forward positions`
- Old overlap suites and the 300-design fuzz still pass.

### WS-C: Brakes and rider brake controls

| Owns | |
|---|---|
| Model | `src/model/brake.ts`, `rear-mount.ts`, new `src/model/brake-front.ts` (knuckle swing arms, shoes, cables, equalizer), new `src/model/brake-controls.ts` (hip lever, cable, channel, pass-through, lap belt and anchors) |
| Analysis | `src/analysis/brake.ts`, `brake-mount.ts`, new `src/analysis/brake-ride.ts` (stop, emergency, bias, heat, park-hold, hip-cable, belt-anchor) |
| Tests | `model/brake.test.ts`, `model/rear-mount.test.ts`, `analysis/brake.test.ts`, new `analysis/brake-ride.test.ts`, `model/brake-front.test.ts` |
| Params | brake block edits (exact-string) |

Acceptance tests:
- `brake bias: solved takeoff arm gives a front share of 0.5 +/- 0.02 in both rolling directions`
- `brake: front shoes track the wheel over the whole steering sweep and keep >= 0.25 inch to the hull and the tire (brakeSweep extended)`
- `brake force: hold on 15 deg at the main lever grip <= 30 lbf and the hip grip is 0.93 x the main-lever equivalent`
- `brake emergency: 0.30 g at 8 deg needs <= 50 lbf at the hip grip at the goal rider`
- `brake stop: from 10 mph at 8 deg and mu 0.5 stops in <= 40 ft including the 1 s reaction; formula pinned by hand at 5 deg`
- `brake heat: lined steel-backed shoes allow >= rideRunFt at 8 deg; oak shoes fail; the 250 K time scales as 1/q^2`
- `brake: park-hold on 15 deg with both axles set is >= 1.5 at mu 0.5`
- `brake: the lost-motion slot lets the main lever move 1.4 inch without moving the hip lever`
- `hip cable: tension at the 100 lbf abuse load is within break strength / 3.5`
- `belt anchor: rider x beltDesignG over two 3/8 inch bolts with the doubler passes at ultimate`
- Existing rear brake tests pass unchanged when `frontBrakeType` = 2 and `brakeShoeBacking` = 0.

### WS-D: Loads and analysis

| Owns | |
|---|---|
| Files | everything under `src/analysis/` except `brake*.ts` (WS-C): `loads.ts`, `geometry.ts`, `stability.ts`, `steering.ts`, `structure.ts`, `rear.ts`, `hull.ts`, `seat.ts`, `index.ts`, `rider-sweep.ts`, `types.ts`, `context.ts`, `dual.ts`, `transport.ts`; new `bump.ts`, `front-end.ts`, `linkage.ts`, `ride.ts`; delete `front.ts` |
| Tests | `loads`/`geometry`/`rear`/`seat`/`hull`/`beams`/`nds` tests, `checks.test.ts`, `rider-sweep.test.ts`, `recommended.test.ts`; new `bump.test.ts`, `front-end.test.ts`, `linkage.test.ts`, `ride.test.ts`; delete `front.test.ts` |
| Params | loads, ride, factors blocks (exact-string) |

Acceptance tests:
- `bump: velocity-pulse reproduces the hand numbers (1 inch, 10 mph, k 400, 65 lb front wheel) F_n = 943 +/- 15 lbf`
- `bump: force scales with speed, falls with a lower wheel rate, and is capped by 0.9 r`
- `bump: hard hit (2 inch) is larger than the normal bump for both wheels`
- `spindle rows: a 25 mm stub passes normal and hard at the goal rider; a 17 mm stub passes normal and shows its hard utilization as marginal or fail honestly`
- `spindle-fatigue: Goodman factor matches the hand value (17 mm n about 4.7) and is under the limit at the defaults`
- `wheel-retention: cotter and nut capacity vs 0.8 V at the hard hit`
- `tie-rod: Euler buckling load with a 1/2 inch rod is about 1,200 lbf`
- `tongue: hinge pin and link utilization at 150 lbf; tongue-tie keeps the old eye-bolt hand numbers`
- `geometry: contactsAt with an Ackermann spec gives the hand wheel centers; tip-lock at the tow lock uses them`
- `stability: turn-radius at the defaults is 8.8 ft and passes against 108 inches`
- `steering sweep: clearance at the defaults >= 0.7 inch (the hull sits 0.75 from the tire) and the pair is named`
- `ride: lateral acceleration at 10 mph at the ride lock is about 0.26 g against 0.5 x SSF`
- `rider sweep: every new check id has a light mapping; the old front-end ids are gone; 50-250 lb sweep still runs`
- `checks at the defaults: no non-finite values; every variant the validator accepts yields finite checks` (the existing fuzz)
- `row basis: a test per changed row in section 5.4 pins the new formula by hand`

### WS-E: Viewer, sim and UI

| Owns | |
|---|---|
| Files | `src/viewer/**`, `src/sim/**`, `src/ui/**` (including `simple-text.ts`, `simple-view.ts`, `analysis-panel.ts`, `params-panel.ts`, `right-panel.ts`, `sim-panel.ts`), `src/main.ts`, `src/state.ts`, new `src/ui/ride-rules.ts` and `ride-rules.test.ts`, README ride-mode section |
| Tests | `sim/sim.test.ts`, `ui/simple-text.test.ts`, `viewer/*.test.ts` |

Acceptance tests:
- `sim spec: bodies are chassis, steer-L, steer-R and four wheels; kingpins are two points 29.5 inches apart`
- `sim: commanding 20 deg inner drives the right knuckle to the solved outer within 0.5 deg after settling`
- `sim: the ride lock clamps the input to 8 deg outer; the tow lock to 35.5 inner`
- `sim: braking at 10 mph on 8 deg slows the cart with the front share; the run stays straight with the stick centered`
- `sim: tilt table onset is within 5 deg of the static tip-lock angle (existing assertion, updated)`
- `sim poses: tie-rod, bellcrank and tongue poses match poseMatrices`
- `ride-rules: table rows follow params (change rideMuGo8 and the table changes); text includes the daylight, helmet, belt, spotter and walk-it-down rules; camp test steps present`
- `simple-text: every new check id has a plain name and a failure sentence; no sentence mentions turntable, bolster or kingpin plates`
- `viewer: steer slider range follows the mode; the Both/Tow/Ride toggle rebuilds the model`
- `partMesh: cables are drawn (material not 'rope'); spindle mesh renders`
- Browser pass (manual): steer slider at +/-35 and the explode slider, screenshot of tow and ride, sim run.

---

## 11. Integration, mass and verification

### 11.1 Mass estimate (lb, rough)

| Removed | | Added | |
|---|---|---|---|
| Turntable | 5.5 | Front beam (steel tube) | 8.7 |
| Carrier + under plate + bar plate | 8.1 | 2 spindles | 4.4 |
| Crossbar, stops, stop stand | 4.3 | 2 brackets + bolts | 2.4 |
| Bolster rails | 4.9 | Tie rod, drag link, bellcrank, mode plate/pin, springs | 2.0 |
| Sleeves, pin, ears, bearers, panel | 2.7 | Tongue clevis + link | 1.0 |
| Front axle rod + oak beam + clamps | 16.1 | Rider stick, cables, guide | 2.0 |
| Shoulder beam | 1.5 | Hip lever, cable, channel | 1.4 |
| | | Front brake (2 shoes, arms, cables, equalizer) | 2.5 |
| | | Lap belt + anchors | 1.4 |
| | | Hull simplification (deck merge) | -0.3 |
| **Total removed** | about 43 | **Total added** | about 25.5 |

Net about -17 lb before rear axle/wheel upgrades the bump rows may require (+4 to +8 lb). Expect 155-165 lb. Report the real number from the model.

### 11.2 Verification

Orchestrator after the flip: `npm run typecheck`, `npm test` (watch the sweep test timeouts; the new Ackermann sweep is about the same cost as the old one), `npm run build`, `npm run build:single`, a browser pass on both views, and the critic loop (engineering, buildability, visual) with reviews in `docs/reviews/`. Record in `docs/STATUS.md`. Update DECISIONS D-53..D-58, BRIEF, `docs/phase3b-notes.md` (the final state, what changed in numbers).

---

## 12. Risks and open questions for Eric

Purchased-part specs to confirm (these gate the BOM; the model uses generic parametric stand-ins):
1. **Spindle**: exact racing-kart model, stub diameter (17 or 25 mm), boss height, kingpin bolt size (3/8" assumed; karts are often M8 or M10), steering-arm hole size and length, built-in caster/KPI, brake-boss geometry, material and any published rating. A load test (one spindle, bracket and wheel) before riding at speed.
2. **Front wheels**: the hand-truck wheels have a 3/4" bore and no disc mount; a 17 mm or 25 mm stub needs a sleeve adapter (or buy 1" bore wheels for 25 mm). Kart wheels (10 x 4.5-5) fit the spindles and disc brakes natively but are 10" against the rear 13". Splitting front and rear wheel sizes is not in this spec. Which way?
3. **Scrub radius 3.0"** is driven by the wheel hub (1.5" half length), the bracket leaf (1.0") and 0.5" clearance. It makes brake-steer and kickback larger than the study's 1" assumption and narrows the nose. A dished wheel or a thinner hub would give back about 1.5" of scrub and 1.6" of nose.
4. **Front brake**: tread shoe on a swing arm (default) or a purchased kart mechanical disc (needs a disc hub). Lined shoe part number and brake cable/Bowden parts.
5. **Beam**: steel tube (default, ductile, 8.7 lb) or aluminum (about 4 lb, less forgiving) or oak (heavy to bracket). Aluminum is a one-line variant if wanted.
6. **Nose width**: D-52 expected about 23"; the real sweep with hub offset gives 20.6". Is that acceptable? Option: raise the clearance rule and drop the finger guard (19.3" nose).
7. **Solid sprung rails**: the model says no (needs R >= 100 t). Try a test strip? The 2-ply laminate is as easy as it sounds.

Engineering uncertainties:
8. **Bump model**: the answer is dominated by `bumpWheelRateLbIn` (400) and `bumpMassShare` (1.5). Bench-test a wheel deflection. If the rear axle or wheel rows fail at the defaults, the likely fixes are a 1" rear axle (+3.9 lb), a higher-rated wheel (rating 400+ lb), or a lower ride speed over rough ground; the spec does not pre-apply them.
9. **Hard-hit philosophy**: ultimate with no safety factor. Does Eric want a 1.25 factor (`failSafeFactor`)?
10. **Steering feel**: 8.6 Hz shimmy coincidence at 10 mph (study); damper optional; bench-check. Tongue steering with an Ackermann trapezoid downhill pushes into the pullers (study); tongue tow is not allowed on CAUTION slopes.
11. **Ackermann error** is within 0.6 deg with the 24 deg arm; the spindle's real arm angle may differ and moves this.
12. **Kingpin tilt neglected** in the kinematics (planar rotation about a vertical axis); camber and lift change are ignored.
13. **Lock stops depend on bracket tabs** plus the bellcrank window; the tow stop is shared by the whole linkage, so a hard sideways tongue pull loads the tie rod (Euler check).
14. **Cable pass-through hole** in the left rail for the hip cable: needs a rail check at that location.

Accepted risks to re-confirm: a belted-rider rollover is accepted for daylight, envelope-limited runs (helmet + belt); ride mode is off for the dark 7 pm race; no belay system; walk it down above 10 deg.

Weight, rider range: the 150 lb rider must pass everything and 200 lb stays the goal; the true safe range is unknown until Stage 2 runs. The Simple view no longer shows the front-end honesty note once the new rows are green; if any new front-end row fails at 150 lb, keep a one-line "front end being verified" note until it clears.

### Critical Files for Implementation
- /Users/eschrock/dev/klondike-car/src/params.ts
- /Users/eschrock/dev/klondike-car/src/model/layout.ts
- /Users/eschrock/dev/klondike-car/src/model/steering.ts
- /Users/eschrock/dev/klondike-car/src/model/build-utils.ts
- /Users/eschrock/dev/klondike-car/src/model/hull-curve.ts
- /Users/eschrock/dev/klondike-car/src/analysis/structure.ts
- /Users/eschrock/dev/klondike-car/src/sim/core.ts
