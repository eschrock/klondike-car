# Hull curve (D-45): construction notes

Implements D-45: no prow, one S-curve in plan from the cabin side to the nose side, and the 1" deck step kept out of the side profile. Code: `src/model/hull-curve.ts` (the curve and the tire clearance), `layout.ts`, `body.ts`, `frame.ts`, `joinery.ts`, `params.ts`; tests in `src/model/hull-curve.test.ts` plus the updated `model.test.ts` / `hull.test.ts`.

## 1. The curve

At the defaults the cabin side (outside half width 14.0") is straight up to **x = 18" (`hullCurveStartIn`)**, then narrows to the nose (7.0") by **x = 30.375"**, and the nose side is straight from there to the front transom.

- **Shape.** Defined on the side's centerline (the plane of the okoume web). Heading is built from a curvature profile: curvature ramps linearly up from 0 over the first quarter of each half, holds, and ramps back down to 0 at the inflection; the second half mirrors it with the opposite sign. So heading *and* curvature are continuous at both ends and at the inflection (no kink, no curvature jump). Compared with a quintic "smootherstep" of the same length it has about 20% more radius at the tightest point, which is what a lamination cares about. Solved numerically for the exact end points (`buildPlanCurve`, cached, 24 chords, exact end points).
- **Radius.** Tightest centerline radius 5.69" (peak heading 67 degrees from the axis at the inflection: the tire sweep forces a steep drop of 7" in 12.4" of length).
- **Where it ends is derived** (`latestCurveEnd`, called from `resolveParams` when `autoNoseGeometry` = 1): the largest `x1` for which the *outer face* of the side keeps `steeringClearanceIn` (0.75") from the left front tire rectangle at every degree of steering from -lock to +lock, rounded back to 1/8", re-verified after rounding. The result is stored in `noseTaperStartIn` (now "the curve end, measured behind the front axle", 13.625" at the defaults, was 17.625" for the square shoulder). It is capped at 12" behind the axle (room for the shoulder beam, joists and bolster). At the defaults the pinch is the tire's rear-inner corner at about x = 30.
- **Start is a slider** (`hullCurveStartIn`, default 18, range 8-34). With auto on, `resolveParams` moves it **earlier, never later** if the bend radius would otherwise violate the lamination limit (monotone: earlier = longer = gentler; bisection in 0.5" steps). Manual (auto off): the validator reports it.
- **Flare is ignored** (`gunwaleFlareIn`): the S-curve web is laminated around a plan form, so it is vertical. The param is kept so old links load; the validator warns when it is non-zero and `Layout.flare` is 0.

### Validation (`validateParams`)
Errors (all in D-45 wording): curve start behind the grab-handle front; curve shorter than 3"; the seat cushion front corners (width 18") inside the narrowing hull by less than 1/4"; the cushion running into the deck step (shoulder beam); hull outline within `steeringClearanceIn` of the tire sweep (real rotated-rectangle sweep, 1 degree steps); inside-face bend radius of the chine/gunwale, the rail and the web below its limit; the web leaving less than 1" between chine and gunwale; the end less than 12" behind the axle. The old "front tires hit the cabin shoulder" error is gone (the nose-width error stays, it is exact at the swing limit).

## 2. Parts

Side members are `sweep`s with the path **in plan** (local XZ = model XY: path z = -|y| for the left, +|y| for the right; `width` = the member height; `thickness` = across the side; `plies` = lamination count). New factory `bandPart` in `build-utils.ts`. They run from the rear transom to the **end of the curve, x = xn**, so the curve is part of one continuous member with the straight cabin run; the straight nose run (x = xn to the front transom) is the old box / sheer extrusion. They are joined by 1:8 **scarf** joints at xn, where both are straight (a scarf never bends).

| Member | Cabin run (rear transom to xn) | Nose run (xn to front transom) | Joint at xn |
|---|---|---|---|
| Chine (oak 5/8 x 1.5) | `side-cabin-*-chine`, bent lam, 5 plies of 1/8" | `side-nose-*-chine`, box | scarf 1:8 (5") |
| Gunwale (oak 5/8 x 1.5) | `side-cabin-*-gunwale`, bent lam | `side-nose-*-gunwale`, sheer extrusion (unchanged), laminated flat from 3 layers (fixes the short-grain note S4) | scarf |
| Side panel (6 mm okoume) | `side-cabin-*-web`, a sweep, **2 x 3 mm sheets** laminated on the same form (`hullWebPlies`) | `side-nose-*-web`, extrusion | scarf 8:1 (1.9") |
| Ladder rail (oak 3/4 x 4) | `rail-cabin-*`, bent lam, 6 plies | `rail-nose-*`, box | scarf 1:8 (6") |

`side-cabin-*-board` / `-gunwale` / `-post-*` (solid oak and open frame) are built the same way; `girder-cabin-*` (hull-beam frame) too.

**Why these.** A sweep is already a viewer primitive and already means "bent lamination"; the plan path needs no new geometry type. One continuous bent member per rail through the transition is the structurally best choice: no joint in the curve itself, and the flange continuity (chine = tension flange of the side beam) the engineering review asked for. The scarfs are in the straight run beyond the curve.

**Bend limits** (new params `hullLamThicknessIn` 1/8", `hullLamMinRadiusFactor` 40, `hullWebPlies` 2): the inside face of each lamination is `minRadius - thickness/2` and must be at least 40 x the strip. At the defaults: chine/gunwale 5.38" vs 5.0" (5 x 1/8" strips), rail 5.32" vs 5.0", web 5.58" vs 4.72" (2 x 3 mm sheets; one 6 mm sheet needs 9.6" and is rejected). The curve start has a few inches of slack: at start 19 the limit is violated, so auto moves it earlier. A tighter curve needs thinner strips or steaming (the validator says which).

## 3. The side profile does not step (item 4)

A deck that steps 1" cannot sit in a chine rabbet that ramps 1": the rabbet and the deck edge would separate, and a 1.5"-tall oak bar cannot be bent edgewise 1" over a useful length anyway. So **the side lines are the same height along the whole hull**: for the default captured-ply sides the chine bottom, the web and the gunwale are all at the *nose* deck level and the cabin deck (1" lower) sits on a ledge notched into the cabin rail's inner face:

- chine z 9.53-11.03 (`Layout.chineBot`), web 11.03-14.5, gunwale 14.5-16.0 (plus the D-44 sheer from x = 33.75, flat before it), everywhere. `Layout.sideTop` = deckTop + sideH = 16 replaces `noseTop + sideH` (the nose side is 1" lower above the nose deck than before: 6" instead of 7").
- the ladder rails are 1" taller (4", z 5.53-9.53, `Layout.railTop`) so the chine still sits flush on them; their top is flush with the chine bottom; the rail's inner face is relieved flush with the chine's inner face above the cabin deck (so the storage box, backers and the seat parts see the same inner width).
- the cabin deck (z 8.53-9.0) sits on a 1/4" ledge in the rail (open at the top: it drops in, ply edge against oak, no exposed edge); the nose deck (z 9.53-10.0) is in a 1/4" rabbet in the chine underside from the deck step forward. Non-captured constructions keep the old stepped bottom (the bolster ring sits under the nose deck and would otherwise hit the board).
- **the step is closed inside** by the shoulder beam (below): its rear face is the riser (oak, no ply edge shows; the cabin deck's banded front edge butts it), its top carries the nose deck.
- finger guard references moved to the cabin-level gunwale (`sideTop`), which is where it actually is.

The deck outlines (`deck-cabin`, `deck-nose`) are polygons that follow the plan: cabin deck outline = rail inner face + capture depth; nose deck = chine inner face + capture depth. Tested: every outline point is 1/4" inside the corresponding member centerline offset.

## 4. Load path and frame (build review MUST-1)

Rails stay with the hull: the cabin rail is one bent lamination from the rear transom to xn (outer face flush under the chine all the way, so D-43 holds through the curve), then scarfs to the straight nose rail (x 30.4-36.0). **No straight rail and no blocking** is needed in the transition.

- **Shoulder beam** (new `shoulder-beam`, oak 1.5" x 12.5" x 2.75", `shoulderBeamIn`): x = xs..xn (28.9-30.4"), directly behind the end of the curve, between the (nearly nose-width) rails, Domino-tied to both cabin rails (2 per end), glued to both decks. Rail, beam, rail is the cabin-to-nose tie: a member of every longitudinal line crosses the old boundary (the chine, gunwale, web and rail are continuous through the transition) and the beam makes the two rail pairs one frame.
- **Nose rails** now start at xn and still stop at the turntable swing limit (x = 36.0"), 3.5" short of the bolster. I did **not** add a bridge: it would sit in the turntable corner swing. The nose past 36" is carried by the continuous chine + web + gunwale side beam (full length, now through the transition) and by the bolster glued/bolted to the nose deck, which is captured in the chine rabbets. Open question 2.
- Cabin joists in the curve are cut to the rail's inner face at their narrowest point; nose joists between xn and the rail end are unchanged (still none at the defaults: the run is shorter than the 10" spacing; the beam is the member there).

## 5. Assembly (build review MUST-2)

Choice: **build inverted (option A), which also works for the curved sides.** A curved side cannot slide inboard onto a curved deck edge, and a protruding Domino blocks both moves. So (HULL_STEP text in `build-utils.ts`, part notes updated):

1. Seal every groove, rabbet and dado, all faces and edges (epoxy).
2. Frame + deck glued as a unit right side up (rails, joists, shoulder beam; deck on the rail ledges and joist tops); Domino mortises cut in the rail tops.
3. Laminate the chine, gunwale and rails around the plan form (one form for the chine and web; the rail on its own); glue each web into its chine and gunwale on the bench: a side assembly with the curve built in.
4. Stand the two side assemblies inverted in a jig; **turn the frame + deck unit over and lower it into them**. The Dominos (all vertical) and the chine rabbets engage together.
5. Transoms slide on last in X (unchanged).

**Deck rabbet / dado clearance:** new `deckSlopIn` (0.04"): the chine rabbets, the rail ledges and both transom dados are the deck + 0.04" (0.512" for the 0.472" ply), filled with thickened epoxy; the part notes and joint sizes say so. The tie Dominos are now larger where the bearing strip is wider (the cabin chine has no rabbet, so the strip is the full 5/8"). I left the DF 500 selection rule as it was.

## 6. New and removed params

| New (ref D-45) | Default | |
|---|---|---|
| `hullCurveStartIn` | 18 | x where the cabin begins to narrow (explore) |
| `hullLamThicknessIn` | 1/8" | strip thickness for chine, gunwale, rails |
| `hullLamMinRadiusFactor` | 40 | cold-bend limit as a multiple of the strip |
| `hullWebPlies` | 2 | sheets in the curved 6 mm web |
| `deckSlopIn` | 0.04" | rabbet/dado clearance over the deck |
| `shoulderBeamIn` | 1.5" | thickness of the beam under the step |

Changed meaning: `noseTaperStartIn` (curve end behind the axle; range 12-26, default 13.25, auto-derived), `gunwaleFlareIn` (ignored). Removed: `prowLegMinIn`, `prowSocketCheekIn`, `prowGrabLbf`, `prowInsertAllowLbf`, `prowHeightIn`, `prowReachIn`, `prowWidthIn`, `prowLamThicknessIn`, `prowPlies`, `prowSpringbackFrac`, `prowMinRadiusFactor`. `sanitizeParams` ignores unknown keys, so old links that carry them load (tested).

Layout additions: `xc0` (curve start), `xn` (curve end), `xs` (= xn - shoulder beam: the deck step, same role as before), `hull` (the `PlanCurve`), `chineBot`, `railTop`, `chineH`, `shoulderBeam`, `sideTop`; helpers `sidePath`, `innerHalfWidth`. Cabin furniture (grips, reflectors, signs, scuppers) is behind `xc0`; lash plates may stand on the first part of the curve where the gunwale is within 25 degrees of the axis, turned to follow it (`lashReachX`), so the 3 per side the brief needs still fit.

## 7. Mass and checks

Empty mass at the defaults (same baseline tree, so the steering agent's changes are in both columns): **161.56 -> 161.24 lb (-0.32 lb)**; of that the steering group is +0.47 (the other agent's stops), so the hull change is about -0.8 lb.

| Group | Before | After | |
|---|---|---|---|
| body | 36.62 | 33.22 | prow -0.88, prow socket -0.42, shoulder panels -0.58, web/gunwale/chine/deck/transom reshaping, finger guards -0.66 (shorter), signs -0.58 (shorter) |
| frame | 10.10 | 13.48 | cabin rails +2.2 lb (4" tall, 1" taller), shoulder beam +1.47, nose rails -0.3 |
| removable | 4.38 | 3.79 | prow |
| hardware | 6.77 | 6.58 | fewer fasteners |

Checks (defaults): **no check changed status because of the hull**. `prow-grab` is gone. The brake handle force at the 200 lb goal rider is still marginal (23.55 vs 30 lbf limit, was 23.57: the 0.3 lb is not enough, the margin is a property of the brake ratio, not the hull). `steer-stops` goes pass -> marginal at the goal rider, which is the other agent's change. Deck: the cabin deck is 2.5" longer (the step moved from x = 26.4 to 28.9), so the last bay grew from 9.44" to 10.16" and the 9 mm deck deflection at the 200 lb foot patch went 0.068 -> 0.083" (it already failed L/300 in the Phase 1 configuration; the defaults still pass).

Analysis changes: `hull.ts` loses the prow check; `structure.ts` `hullLayers` now builds the side-beam layers from the real member section (5/8" x railBand for chine and gunwale, the girder from `railDepth`, the web from `Layout.web`), **not the bounding box** of the part (eng N-4: the sheered gunwale bbox was 4" tall; the curved members' boxes are 7" wide). The rail check, the rear-axle beam rail position and the steering clearance sweep (`analysis/steering.ts` now uses tight boxes and a broad phase) and the brake clearance obstacles use the real shape too. New `partOBBs` / `partsOverlap` in `bounds.ts` (one box per sweep segment; narrow slabs for tapering extrusions; world-box early out), used by the overlap tests.

## 8. Tests

Removed: all prow tests (`hull.test.ts`: the "bent-lam prow and its form" describe, the prow socket test, the prow lines in the inserts test; `analysis/hull.test.ts`: prow grab by hand, prow grab fails at 1.5", the lift/prow/foot-stop list now lift/foot-stop), the prow row in the assembly-order test, the `prow`/`prow-socket` allow rows. Rewritten: shoulder rule (A-4 M2) -> S-curve vs tire sweep, "front tires hitting the cabin shoulder" (params), auto nose derivations (Phase 1 and Phase 2), nose widths vs track, the "resolved nose" test (uses `xn`), flared captured-ply (now: flare is ignored), rail/chine geometry tests that read a box (they read the sweep), deck/web/transom position tests, the finger-guard insert test (cabin-level gunwale), visual-geometry heights (`sideTop`), mass group baselines (body 33.3, frame 13.5, removable 3.8), the deck D1 hand numbers, the lift (front transom top) formula, seat range (the default seat is at the forward limit) and slider fractions, and the auto-nose fuzz thresholds (auto no longer multiplies the valid count; the manual curve default already suits the default sweep).

Added `hull-curve.test.ts` (35): tangent continuity at both ends; no kink and a continuous curvature profile; monotone; outside the seat/grips/storage zone; the nose side straight; hull outline clears the sweep + clearance for 13 variants (track, lock, wheel size, lead, start, clearance, tire width) both analytically and on the built parts at both locks; tightness of the derived end; manual too-late end is an error; bend radius of every sweep vs the 40x rule; thick strips / one 6 mm sheet rejected; auto moves the start earlier and is idempotent; deck edges captured along the curve (distance to the chine / rail centerline = side/2 - dd, railT/2 - dd); `deckSlopIn` in the dados and rabbets; side lines the same height cabin-to-nose; the riser; sheer on top of the constant line; the shoulder beam joints, scarfs and continuity; the prow is gone and old links load; `hullLayers` uses the real section whatever the sheer or curve (N-4). Overlap suites: 11 new variants in `model.test.ts` (curve start 15/16/20, strips 1/16 and 3/16, 3 web sheets, thick beam, no deck clearance, 2" deck step, hull-beam + solid) and the 300-design fuzz now also jitters the curve params (31 designs pass validation and are clean). Allow rules added for the deck on the rail ledge, the doubler on the curve, and the rail relief above the deck.

## 9. Viewer follow-ups (no `types.ts` change)

I used only the existing `sweep` and `extrusion` geometries; **`types.ts` is untouched**.

- **`sweep` with a plan path.** The sweep's local XZ plane is the model XY plane (transform `[1,0,0 / 0,0,1 / 0,-1,0]`, so local y = up = the member height, centered on the part's z). The path is the centerline of the member; `thickness` is across the path in plan. Chine, gunwale, rail and the curved web are such sweeps (kinds `bentlam`, and `sheet` for the web, all `fab: 'bentlam'`). Grain follows the path (`grain: 'x'` is the nominal axis; the viewer should take the sweep path as the grain direction for these, as it did for the prow). The sweep builder must not assume the width axis is the model Y or that the path rises in z.
- The web sweep is 0.236" thick and 4.2" tall with plies 2; if the viewer draws ply lines for `plies`, 2 is correct for the curved web (sheets), 5 for the 5/8" chine, 6 for the 3/4" rail.
- Finish: the oak sweeps get `roundoverIn = min(0.25, 1/3 x min(width, thickness))` from `finish.ts` (0.208" on the chine), `okoume` for the web.
- New part `shoulder-beam` (box). No mesh parts were needed.
- `deck-cabin` and `deck-nose` are now many-vertex polygons (46 and ~50 points), not rectangles.

## 10. Open questions for Eric

1. **Chine at the nose level, side 1" lower in the nose.** The chine bottom, the web and the gunwale are now at the same height along the whole hull (nose side above the nose deck is 6", cabin 7"), and the cabin rails are 4" tall. That is what lets the side profile not step without bending a 1.5" oak bar edgewise. If you would rather keep the nose side 7" tall above the nose deck, the line has to ramp through a joint (not buildable as one lamination); say so.
2. **Rail to bolster gap (3.5").** Not bridged (it is inside the turntable corner sweep). The side beam and the deck carry it. If the structural reviewer wants a member there, the option is a short oak spine under the nose deck on the centerline between the nose-rail ends and the bolster aft rail, which needs the turntable clearance rechecked.
3. **Finger pinch behind the nose.** The pinch wedge (tire rear-inner corner against the curved side) is now at x = 27-30, on the curve; the guard can only be a straight extrusion on the straight nose side, so it covers x = 30.4-31.4 only (0.03 lb each). The wedge itself opens rearward (the side curves away from the tire), min gap 0.75" at about x = 30. Options: a printed guard that follows the curve (a swept profile), or accept the wedge (it is open to the rear and the rider's hands are on the grips, 12" behind).
4. **Seat cannot move forward.** The cushion front corners (18" wide, front at x = 24") are within 1/4" of the narrowing hull at the default seat, so the seat range only reaches back from here. Start the curve later (but the radius then needs thinner strips) or narrow the cushion.
5. **Brake force at the 200 lb goal** is still marginal; the hull did not restore it.
6. **Flare is gone.** The captured-ply web is laminated on a plan form and is vertical.
7. **Steaming not needed** at the defaults (5.4" inside radius vs 5.0" limit with 1/8" strips). If the build team wants 3/16" strips (fewer plies), the start moves to about x = 16 or the curve is steamed.
