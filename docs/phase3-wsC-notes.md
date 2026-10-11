# Phase 3, workstream C: brake mechanism and rear handle

Proposed DECISIONS entries (D-38, D-39) are at the end. Everything here was verified with `npm run typecheck` and `npm test` (796 tests, all green at the time of writing).

## What was built

Files: `src/model/brake.ts` (geometry + parts), `src/analysis/brake.ts` (checks), tests in `src/model/brake.test.ts` and `src/analysis/brake.test.ts`.

**Mechanism (tire-tread brake, no welding):**

| Chain link | Parts | Fabrication / source |
|---|---|---|
| Hand lever | `brake-lever` (white oak, 0.75" across × 1.5" in the plane of the pull, grain along its length), grip at 30" (4" under the push-handle grip), pivot 6.1" up on the rear rail band | table saw + drill; two bores take bronze sleeves |
| Lever pivot | `brake-pivot-block` (oak, bolted through the left rail with 3 carriage bolts), `brake-lever-pin` (3/8" bolt), `brake-lever-sleeve` (SAE 841 bronze) | McMaster-type stock sleeve, bolt, drill |
| Link | `brake-link` (3/8" rod, 3/8-24 both ends) + two zinc clevis rod ends with 5/16" pins; length adjusts with the clevises | bought; the link is a push rod (compression), buckling checked |
| Input crank | `brake-crank`, a 0.75" thick A36 plate keyed to the shaft with two 3/16" keys, 2.4" long | laser/waterjet + broach, no weld |
| Cross shaft | `brake-shaft`, 3/4" ground steel rod, 39.1" long, behind the tires at axle height (x = −8"), turning about 11° | rod cut to length |
| Shaft bearings | `brake-bushing-L/R`, bronze bushing pressed into a steel bearing plate set flush in an oak block (`brake-pivot-block` on the left, `brake-bearing-block-R` on the right), 4 × 7/16" bolts through plate, block and rail | see D-38 for why not a bushing straight in oak |
| Shoe arms | 4 × `brake-arm-*` (1/4" × 1" A36 flat bar, 1.64" from shaft to pin) on 4 keyed hubs `brake-hub-*`, two arms per side straddling the pad | cut/drilled bar, hubs bored + keyseated |
| Pad | 2 × `brake-shoe-L/R`, white oak arc cut to the 13" tire (radius 6.5" to 8"), 2" long × 3" across, swivels on `brake-shoe-pin-*` (1/2" pin) so it wraps the tread | bandsaw |
| Return | `brake-return-spring`, a torsion spring on the shaft | bought |
| Parking ratchet | `brake-quadrant` (laser-cut 1/4" plate, 9 teeth, 5/16" pitch, 0.1" deep, 20° span at 8.5" radius), `brake-quadrant-bracket` (bent angle on the transom), `brake-pawl` (flat bar on a shoulder screw), pawl spring | laser, bend, drill |
| Handle sockets | `handle-socket-L/R` (1.25" × 1.75" × 6" steel tube, 0.125" wall, bolted to the rear transom with 2 carriage bolts each), `handle-post-L/R` (oak, removable), `handle-pin-L/R` (clevis pin + lynch pin), `handle-bar` | tube cut to length |

Every part carries a structured `joints` list; bought hardware has `sourcing`; wood parts have a grain direction.

**Geometry rule of thumb:** the shoes sit on the REAR of each tread, 11° below the axle line. The cross shaft is 1.5" behind the tread (existing validator rule), so a short arm (1.64") from the shaft to the pad pin is nearly tangent to the tread: the pad swings straight in and shoe friction passes almost through the shaft, which keeps the servo effect small. (A front-upper shoe, as in Phase 1, needs a link that arches over the tire.) The wooden-drum variant keeps its drums, shaft and a simple lever; it has no linkage geometry and the analysis uses the target ratio for it.

## Derived lever ratio

Computed in the vertical x–z plane at the applied pose by `brakeGeometry` (cross products, closed link solved for the lever angle; verified by an independent virtual-work test):

`ratio = N_total / F_hand = (l_grip / d_Q) · (d_S / k)`

At the defaults: l_grip = 23.07", d_Q = 1.90" (lever pivot to link line), d_S = 1.89" (shaft to link line), lever tail 1.9", crank 2.4" at 315° (forward and down), link 2.88", k = shoe moment arm about the shaft.

Shoe friction (μ = 0.4) adds ±μ·K_t to the normal arm K_n = 1.53":

| Rolling | k | Ratio | Effect |
|---|---|---|---|
| Forward (nose-down parking, driving down the hill) | 1.285" | **17.9:1** | servo (friction helps) |
| Backward (nose-up parking, rolling back) | 1.768" | **13.0:1** | de-servo: **critical** |

`brakeLeverRatio` is now a target (12:1). The new check `brake-ratio` fails if the geometry delivers less. `brake-force` uses the critical (backward) ratio, so the 15° hold is checked in the worst direction. The shoe self-locks only if μ ≥ |K_n|/|K_t| = 2.5; dry rubber on oak (0.8) is far from it.

Handle force (limit 30 lbf): operating 19.9 lbf, goal 23.0 lbf (efficiency 0.8). Rolling forward it is 14.5 / 16.7 lbf. Wet or snowy shoes (μ 0.25) would need 31.9 / 36.8 lbf: sensitivity only, as before. Lever stroke is 4.8" at the grip for the 0.3" shoe stroke.

## New and changed params

All under the `brake` group with `ref` D-38 / D-39 (new ones listed first).

| Param | Default | Note |
|---|---|---|
| `brakeShoeTravelIn` | 0.3 | shoe stroke (released gap + compliance + wear) |
| `brakeShoePinDiameterIn` | 0.5 | pad pivot pin |
| `brakeBarWidthIn`, `brakeBarThickIn` | 1, 0.25 | flat bar for arms, pawl |
| `brakeLeverPivotBehindShaftIn`, `brakeLeverPivotZIn` | 1.25, 6.1 | pivot position (relative to the shaft, so it moves with it) |
| `brakeLeverTailIn`, `brakeCrankIn`, `brakeCrankAngleDeg` | 1.9, 2.4, 315 | the three numbers the ratio is solved with |
| `brakeLeverTiltDeg`, `brakeLeverGripBelowHandleIn` | 4, 4 | grip placement (was a model constant) |
| `brakeClearanceIn` | 0.1 | sweep limit |
| `brakeLoadFactor` | 2 | members are checked at 2× the hold load (hard pull / jerk), on top of the steel and wood safety factors of 2 |
| `brakeSteelYieldPsi` | 36000 | A36 bar, rod, pins |
| `brakePivotBoltDiameterIn`, `brakeBearingBoltDiameterIn`, `brakeBearingBoltSpacingIn`, `brakeBushingPsi`, `brakeLinkRodDiameterIn`, `brakeClevisPinDiameterIn` | 0.375, 0.4375, 2, 3000, 0.375, 0.3125 | hardware sizes |
| `brakeRatchetRadiusIn`, `PitchIn`, `ToothDepthIn`, `PlateThickIn`, `SpanDeg`, `brakePawlPinDiameterIn`, `brakeStrokeReserve` | 8.5, 0.3125, 0.1, 0.25, 20, 0.25, 1.5 | ratchet |
| `handlePostThickIn`, `handlePostWidthIn`, `handleSocketDepthIn`, `handleSocketWallIn`, `handlePinDiameterIn`, `handleHoldbackLbf` | 1, 1.5, 6, 0.125, 0.3125, 50 | sockets (the post size was a model constant) |
| changed: `brakeLeverRatio` | 12 | now the TARGET (label and note updated) |
| changed: `brakeShoeAngleDeg` | 45 → 11 | now "below the axle line, rear of the tire" (range 0–20) |
| changed: `brakeShaftDiameterIn` | 0.5 → 0.75 | ½" fails the torque check at 2× hold load |
| changed: `brakeLeverWidthIn` / `ThickIn` | 1.5 / 1 → 0.75 / 1.5 | narrow enough for the hull-to-tire gap; stronger in the plane of the pull |

Validator additions (`validateParams`): an error if the crank and clevis would reach into the rear tire (hull too close), and a warning when the lowest brake part (exact released-pad position, crank clevis, lever tail) is under `minGroundClearanceIn`.

## New checks at the defaults (goal rider, load factor 2)

| id | group | value | limit | util | governs |
|---|---|---|---|---|---|
| `brake-ratio` | Braking | 12.99:1 | ≥ 12 | 0.92 | critical = backward |
| `brake-force` | Braking | 19.9 / 23.0 lbf | ≤ 30 | 0.66 / 0.77 | handle force |
| `brake-clear` | Braking | 0.158" | ≥ 0.1 | 0.63 | arm to tire at full stroke; pads 0.29" off released and touching applied; lowest part 3.59" |
| `brake-lever` | Structure | 597 psi | 850 | 0.70 | tail shear (bending 3190/6460, pivot bearing 1149/1700) |
| `brake-links` | Structure | 6766 psi | 18000 | 0.38 | crank plate bending (rod 5099, clevis pin 2919/10386, buckling 0.23) |
| `brake-shaft` | Structure | 8019 psi | 10386 | 0.77 | key shear (torsion 5105/20195, bending + torsion 24.6/35 ksi, washers 205/358 psi) |
| `brake-shoes` | Structure | 7873 psi | 18000 | 0.44 | pad pin bending (pad rock-off μ·h = 0.3" vs 1") |
| `brake-ratchet` | Structure | 20° span | ≥ 17.4° | 0.87 | stroke coverage; tooth bearing 4000/16200, root shear 1280/10386, root bending 2458/18000 |
| `handle-sockets` | Structure | 1800 psi | 6460 | 0.28 | post bending at the socket mouth (bearing 47/358) |

No failing and no marginal row at the defaults or in the recommended configuration. `GROUP_OF_ID` is extended; `brake-ratio` and `brake-clear` are added to `LIGHT_OF_ID` ('hills'); the five member checks and the sockets are in the 'Structure' group so they color the Simple view's strength light.

## Mass

Brake group 3.5 → 12.26 lb (+8.76), removable 4.7 → 4.66 (shorter posts, + pins); net about **+8.6 lb** on the empty cart (empty mass 144.7 lb with workstreams A, B, D included). Biggest items: the 3/4" shaft 4.9 lb (was 2.0), two steel-tube sockets 2.3 lb, four arms + hubs 1.1 lb. A 7/8" × 1/8" DOM tube shaft would save about 1.6 lb and be stiffer, at the cost of a keyseat in a hollow shaft; not done.

## Tests changed in shared files (small edits)

- `src/model/model.test.ts`: `ALLOW` gained entries for brake/handle internal fits, the rail/bolt/bushing passes, and the flared-gunwale box conservatism; `EXPECTED_GROUP_LB` brake 3.5 → 12.2 and `EXPECTED_EMPTY_LB` 126.9 → 144.7 (documented per workstream); the `track30+fix` variant adds `brakeShaftBehindTireIn: 3, rearOverhangIn: 11`.
- `src/analysis/checks.test.ts`: the brake-force hand test uses the derived ratio; the wet-shoe test is ratio-independent; rear-axle numbers re-derived for the +5 lb per rear wheel (axle stress, M5, M2).
- `src/analysis/rider-sweep.ts`: two entries in `LIGHT_OF_ID`.

## Open items / known limits

1. `scripts/explore.ts` still sweeps `brakeLeverRatio` as an "extra" variable; it no longer changes brake force. Vary `brakeLeverTailIn` instead if that sweep is wanted.
2. A 24" body on a 30" track cannot hold the lever, crank, clevis and shoe arms side by side (1" hull-to-tire gap): the validator catches the crank-into-tire case; moving the shaft back clears that, but `brake-clear` still flags the stack.
3. The rear-lower pads and the link run low and open to slush; ground clearance is 3.59" against the 3.5" minimum.
4. The ratchet plate hangs behind the transom on a bent bracket (the lever pivots 1.25" behind the shaft, so the arc sweeps past the hull end). Lash points and side reflectors (workstream D) sit nearby; the plate stands 0.27" off the gunwale to clear them.
5. The push handle and its sockets reach 0.25" further behind the transom than the old uprights (truck fit still passes).
6. Hand-calc tests that depend on total mass and CG (H2, M3, M4, H3) move with every workstream and need one re-baseline at integration.

## Proposed DECISIONS text

**D-38 Brake mechanism and derived lever ratio (supersedes the "10:1 default" part of D-13; keeps D-13's shoes-on-tread choice).** The brake is a mechanism, not a free ratio. An oak hand lever (pivot 6.1" up on the left rear rail band, grip 30" up) pushes a 3/8" link to a keyed crank on a 3/4" ground cross shaft behind the rear tires; two arms per side take the pad pin; each oak pad swivels on its pin to wrap the 13" tread. The lever ratio is **derived from this geometry** in `brakeGeometry`: ratio = (l_grip/d_Q)(d_S/k), where k is the shoe moment arm about the shaft including friction. Shoes sit on the rear of the tread 11° below the axle line so the arm is short and nearly tangent; the servo effect is small and one-sided: **13.0:1 rolling backward (de-servo, critical, parked nose-up) and 17.9:1 rolling forward (servo)**. `brakeLeverRatio` (12:1) is now a target that `brake-ratio` enforces, and `brake-force` uses the critical derived ratio: 19.9 lbf operating, 23.0 lbf goal against the 30 lbf limit. Members (lever, links, shaft, shoes) are checked at 2× the hold load (`brakeLoadFactor`) with the usual safety factors of 2 on wood and steel. The shaft is 3/4" ground steel because 1/2" fails torque at that load. Bearings are bronze bushings pressed into steel plates set in oak blocks, with the 4-bolt pattern (not the oak) resisting the shoe-arm overturning moment: a bushing bearing directly on oak would crush it (about 358 psi allowable). No welding: arms, cranks and pawl are cut/drilled flat bar and plate, hubs and crank are keyed, joints are bolts, pins and clevises. The wooden-drum variant is unchanged and uses the target ratio. Status: derived, assumed friction μ 0.4 and efficiency 0.8 unchanged (D-13).

**D-39 Parking ratchet and rear push-handle sockets (extends D-9, D-13).** The lever holds with a laser-cut steel toothed quadrant (9 teeth, 5/16" pitch, 0.1" deep, 20° span, concentric with the lever pivot at 8.5" radius) and a spring-loaded flat-bar pawl on the lever, released by the thumb tab. Tooth bearing, root shear and root bending are checked at the load that holds the goal rider on 15° times the load factor (2): utilization 0.25, 0.12 and 0.14; the span must cover 1.5 × the applied lever angle so wear can be taken up. The push handle's two oak uprights drop into 1.25" × 1.75" × 6" steel-tube sockets bolted to the outside of the rear transom and are held by clevis pins (still removable, D-9). `handle-sockets` checks a 50 lbf hold-back pull at the 34" grip height: post bending 1800 psi against 6460 (0.28), bearing at the socket mouth 47 psi against 358, and the transom bolts and pin well under their limits.
