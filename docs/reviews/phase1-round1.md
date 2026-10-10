SCORE: 7/10

Phase 1 round 1 critic review. Method: read BRIEF/DECISIONS/spec and all of `src/model`, `src/truck`, `src/viewer`, `src/ui`, `src/main.ts`. Ran `npm test` (173 pass) and `npm run typecheck` (clean). Dumped the full parts list, masses, CGs, OBB extents and truck-fit cases with a throwaway test (deleted). Ran 18 param variants through the overlap check and truck fit. Drove the app in the browser at 800, 940 and 1440 px. Viewed the five r0 screenshots.

The block model is geometrically coherent at defaults:
- Rider fits: no rider-vs-structure overlap above 0.26", feet land on the foot stop at x = 47.3".
- Front tires clear the nose by about 0.9" and the cabin shoulder by about 0.8" at ±40°.
- Brake shoes sit tangent to the tread at 45°, centred in the tire width.
- Rear brake lever fits in the 1.8" gap between hull and tire.
- Ground clearance is 4.4" against a 3.5" minimum.

The problems are an over-budget mass, one unbuildable stack (kingpin through the axle rod), a truck-fit check that does not yet answer D-23, tests that only guard the default design, and layout between 900 and ~1200 px.

## Numbers from the dump (defaults, 13" wheels, captured-ply sides)

| Group | Mass lb | W-1 "default" | Comment |
|---|---|---|---|
| running-gear | 46.3 | 46.3 | Matches. Wheels 22.0, axles 10.1, beams 11.4, clamps 2.8. |
| steering | 14.8 | ~9 | Bolster 8.3, turntable 3.5, tongue 1.65, bridle 1.0. |
| frame | 9.4 | 13.9 | Only 3 cabin joists plus 0 nose joists. |
| body | 28.1 | ~29 | Deck 8.5 + 2.7, sides ~10, transoms 5.2. |
| seat | **19.2** | ~5 | Seat back 8.7, seat base 6.4, foot stop 2.2, cushion 1.5, pad 0.4. |
| storage | 7.7 | 5.1 | |
| brake | 3.5 | ~4 | |
| removable | 5.0 | 3.7 | Signs plus handle. |
| lighting + hardware | 3.2 | | |
| **Empty** | **137.2** | ~121 | Spec said "roughly 100-125". |

- Operating-rider total is 312 lb and goal-rider total is 362 lb.
- CG: empty (20.4, 0.1, 9.7); operating (16.5, 0.05, 15.7); goal (16.4, 0.0, 16.6).
- Rear-axle static load fraction is about 66% loaded.
- Transport configuration (removables off) is 119.3 lb. The UI reports it nowhere.

Truck fit at defaults (80.5" usable):
- Installed: no case fits. The cart is 83.1" long because of the tongue.
- Removed: all four cases fit. The "beside" cases have 1.00" minimum clearance and the "straddle" cases 0.75".

## Issues, prioritized

### HIGH

**H1. The kingpin passes through the front axle rod, so the front stack is not buildable.**
- Files: `src/model/layout.ts:189` (kingpin z0 = beam bottom), `src/model/running-gear.ts` (axle-F, rod at x = WB, z = 6.5), `src/model/model.test.ts:22` (allow-list).
- Problem:
  - The ¾" through rod lies in a full-depth groove, with beam top = r + rodR.
  - The ½" kingpin runs vertically at (WB, 0) from z = 4.4 to 9.1, straight through the middle of that rod (z 6.125-6.875).
  - You cannot drill a ½" hole through a ¾" rod and keep it as a dead axle.
  - The test hides this with `kingpin x axle-F: 'passes through the stack'`.
- Fix, pick one and make it explicit in the model:
  - (a) Front axle as two stub axles per D-10. The kingpin then goes through solid beam, and the `ALLOW` line is only needed for beam, turntable and bolster.
  - (b) Offset the kingpin ≥ 1" fore or aft of the axle line. This adds caster and trail, and moves the turntable.
  - (c) Bolt the axle under the beam so the groove is not at the kingpin.
- Also add a `validateParams` error for throughRod + kingpin coincident, or have the model choose stubs for the steered axle automatically.
- Remove `axle-F` from the kingpin allow-list.

**H2. Empty mass is 137 lb against a spec of ~100-125 and W-1's ~121, and the test band is too loose to notice.**
- File: `src/model/model.test.ts:123-124` asserts only 80 < mass < 150.
- Fix:
  - Tighten the band to the spec figure, or assert per-group budgets.
  - Pin the groups to the W-1 table with ±15% tolerances. Seat (+14 lb) and steering (+6 lb) would then fail loudly.
  - Reduce the real block-model artifacts (see M1 to M4).
- This is the main driver of the 16 lb overshoot.

**H3. Overlap and clearance tests guard only the default design, and variants break.**
- File: `src/model/model.test.ts:79-96` (overlaps run at defaults only); the param sweep at `:154-195` checks only "does not throw / is finite".
- I ran 18 single-param variants. Each had `validateParams` errors = 0 unless noted. Overlaps found (>0.05"):

| Variant | Overlaps | Notes |
|---|---|---|
| `axleBeamPosition = overslung` | 12 | bolster x deck-nose 0.50, kingpin x deck-nose 0.60, beam-R x joist-cabin-1 1.38 |
| `seatXIn = 20` | 14 | seat base pokes into the nose: side-nose-L-chine x seat-base 1.35, web x cushion 1.85 |
| `gunwaleFlareIn = 2` | 8 | side web x sign 0.86, web x brake lever 1.73 |
| `wheelDiameterIn = 10` (beam 1.75") | 2 | turntable x tongue 0.38, brake-lever x reflector 0.13 |
| `brakeType = drum` | 2 | axle-R x brake-drum 0.50, so the drum bore is not allow-listed |
| `bodyWidthIn = 32` | 20 | validator does fire here, which is fine |

- Fix:
  - Add a parametrized test over {wheel 10/11.5/13, WB 44/48/56, frame 0/1, sides 0/1/2, storage 0/1/2, beam pos 0/1, seatX 8/12/16, flare 0/1.5, lock 30/40} asserting `validateParams` has no errors, so the overlaps list is empty.
  - Failures should become either geometry fixes or new validator errors.
  - Also add rider-vs-structure overlap (payload is excluded today, so the rider fit I verified is untested), and `min z of wheels == 0` plus min non-wheel z ≥ `minGroundClearanceIn`.
- The tongue is placed at beam height, so it hits the turntable when the beam gets shallower (see the 10" wheel variant). Place it from `L.beamF` bounds, not `beamCz ± 1.25`.

**H4. Truck-fit does not yet deliver D-23, and its "straddle" mode is a label rather than a result.**
- File: `src/truck/fit.ts:178-231`.
- Problems:
  - `besideOk` is only a track check. `okMode('beside')` ignores x, so the "beside" winner at defaults is actually rear wheels at x = 10-23 (partly beside the well) and front wheels at x = 58-71 (behind the wells).
  - In "straddle", `lowEdge + tx <= ws` and `highEdge + tx >= we` have zero margin. The winning wheel/well clearance of 1.00" is the lateral gap, not fore-aft.
  - I swept track 35.5, 38, 40, 44 and 48 (removed, nose-to-tailgate). Beside and straddle both fail everywhere above 35.5 (best min clearance 0.25"), because with a 48" wheelbase the cart needs a single tx = 11.0 and the rear light then sits 0.2" off the bulkhead.
  - So D-6's claimed ~44-48" straddle track is not reachable at WB 48 / 10" rear overhang, and nothing in the UI says so.
- Fix:
  - For each mode and configuration, solve for the maximum feasible track (bisect the track param, rebuild, run the placement search).
  - Report per mode: "max track X in (limit set by: wheel/well | rear light/bulkhead | tailgate end)" and the wheelbase window that makes straddle feasible.
  - Add a stability delta (static SSF at the max track versus the current one) to the table. Phase 2 can supply the SSF, but the track number belongs in Phase 1 because D-23 asks for it.
  - Apply a real clearance margin to the `okMode` x test, not `<=`.
  - Add tests: straddle fits for the real cart at defaults; straddle fails for WB 44; wheel x-extents at the straddle placement are outside [ws, we]; max-track function monotonic.

### MEDIUM

**M1. The seat group is 19.2 lb, mostly block-model artifacts. Biggest avoidable item (about 12-14 lb).**
- Files: `src/model/seat.ts:21-31` (base), `:44-49` (back).
- Seat back 8.7 lb:
  - It is a solid 0.75 × 25 × 16" oak slab. 25" is the full cabin width for a 13" torso.
  - A captured 6 mm okoume panel in an oak frame (or an open oak frame with a ply web), ~16" wide, is about 2.5-3 lb. Make seat-back construction and width params (width to ~stature × 0.19 + margin).
- Seat base 6.4 lb:
  - It is a 2"-strip oak ring under a cushion that already sits on a ply deck, with no top surface modelled.
  - In the default `rearOverAxle` mode it is structurally redundant.
  - Delete it (cushion directly on the deck): −6.4 lb and −1.5" on rider CG height. Keep it only for `underSeat` storage.
- Foot stop 2.2 lb is a solid 1.5 × 13 × 4" block. Make it a stop bar or ply (about 0.8 lb).

**M2. The bolster is a solid oak 12 × 13 × 1.8" slab, 8.3 lb, and carries no structural logic.**
- File: `src/model/steering.ts:36-41`.
- W-1 had about 3 lb for nose and bulkheads in total.
- Make it two 1.75"-deep oak rails (or a 1.75" frame) with the ply deck on top, about 3 lb. That is a save of ~5 lb.
- Also see M5: the 12" turntable sits on a 2.5"-wide beam.

**M3. Storage box is 7.7 lb against W-1's 5.1 lb, and the lid is a frame with no lid surface.**
- File: `src/model/storage.ts:20-23`.
- The oak lid frame (2.6 lb) has no panel, so the box is not weatherproof as modelled.
- Interior is 15.8 × 27 × 4.9" (about 1,900 in³). That is a flat tray, 4.7" interior depth, for rain shells and water; mention in Phase 2 that a taller, narrower box is better.
- Fix: model a ply lid (0.236") with an oak perimeter strip about 1" wide. That should come to roughly 5 lb.

**M4. Axle beams: 2 × 5.7 lb solid 2.5 × 2.5 × 32" oak.**
- Files: `src/model/running-gear.ts` (beam box), `params.ts` `axleBeamThicknessIn` / `axleBeamDepthIn`.
- W-1 lean beams are 1.5 × 2 for about 4.9 lb in total. This is a real structural member rather than an artifact, so leave it to Phase 2's stress check.
- Call the number out: the beam stress sizing could save 5-6 lb (a real, avoidable contributor).

**M5. Turntable and beam are not a buildable load path.**
- Files: `src/model/running-gear.ts` (beam 2.5" thick in x), `src/model/steering.ts:27-33`.
- A 12" square plate bolts to a beam that is only 2.5" fore-aft, so the plate overhangs by ~4.75" on each side.
- D-12 says roll and pitch moments must go through rub blocks or side-bearers. The only blocks modelled are the 1.5 × 1.5 × 1" stops.
- Fix:
  - Add a steering plate or crosshead (oak, 12 wide × beam width) under the turntable, plus two side-bearer pads at ±(ts/2 + 1)", or shorten the plate to the beam width.
  - Phase 1 only needs the blocks and masses.

**M6. The viewer lacks a CG marker and any dimension overlay. The brief and Phase 1 checkpoint list live CG.**
- Files: `src/viewer/viewer.ts` (no marker), `src/ui/right-panel.ts:92-127`.
- The summary table shows numbers only.
- Fix:
  - Add a CG sphere (empty, operating or goal, selectable) plus a drop line to the ground, updated with `update()`.
  - Add a wheelbase, track and overall-length dimension overlay (three lines with text sprites).
  - Show mass by group (a small table) so the artifacts above are visible.
  - Show the transport-config mass (119 lb). D-7 plans a two-person lift and the app never states the lift weight.

**M7. Explode view mostly translates the whole cart upward.**
- Files: `src/model/build-utils.ts:111-116` (`defaultExplode`), `viewer.ts:267-304`.
- Every non-gear part gets z = +1 and the same distance, so frame, deck, sides and seat do not separate from each other.
- Only wheels (±y) and gear (−z) move differently. The rider and cargo explode too.
- Fix:
  - Explode distance = amount × layer index from `step` (gear below, steering, frame, body, seat and storage, brake, finish).
  - Add a y component for side parts (sides, signs, grabs) and x for the handle, tongue and prow.
  - Exclude payload and truck parts.

**M8. Truck-fit gaps.**
- Files: `src/truck/bed.ts:47`, `src/truck/fit.ts:174`, `:128-136`.
- The bulkhead solid stops at `truckBedDepthIn` (18.5"). Any cart part above 18.5" can sit within the ±1" behind the bulkhead without colliding, but the cab wall is taller. Make the bulkhead tall (e.g. 80").
- Only the all-installed or all-removed configurations are checked. The installed cart fails by one part (tongue, 83.1 vs 80.5"), and `drawbar = none` fits installed. Add a "tongue only removed" and "tongue + handle removed" case so the report says what the minimum disassembly is.
- The tailgate hinge gap and latch lip are ignored (documented). Straddle puts the front wheels across the x = 60.5" bed/tailgate joint. Add a `truckTailgateGapIn` param (default 0.5-1") that offsets the tailgate solid.
- Clearance is the maximum axis-separation (SAT), a lower bound of the true distance. That is conservative and fine, but the label "Min gap" should say so.

### LOW

**L1. Hard-coded design numbers that should be params, versus acceptable named placeholders.**
- Acceptable placeholders (named constants, labelled as spec): clamp mass, rider segment fractions, prow shape, reflector and light sizes, hub diameter fraction.
- Should be params (they drive mass, fit or structure):
  - `RAIL_BAND_IN` 1.5 (chine and gunwale height, `layout.ts:16`)
  - `SEAT_BASE_LEN_IN` 16 (seat depth, `layout.ts:18`)
  - `SEAT_BACK_THICK_IN` 0.75 and seat width (`baseW = 2*hwC − 2`, `layout.ts`)
  - `FOOT_STOP_Z_IN` 4 and `FOOT_STOP_X_IN` (`seat.ts:13-14`)
  - `TONGUE_Y_IN` × `TONGUE_Z_IN` 1 × 2.5 (`steering.ts:14-15`; D-14 sizes the pull load, and this is structural)
  - `SHOE_SIZE` and the 45° angle (`brake.ts:8-9`)
  - Brake-lever section, handle upright inset and crossbar
  - `STORAGE_OVER_SIDE_IN`
  - Fit `STEP_IN`
  - Turntable mass 3.5 lb (`steering.ts`)
- The rider ankle offsets in `rider.ts` (`+2`, `-0.5`) are bare literals inside an expression.

**L2. Layout: the 3-column grid still squeezes the viewer between about 900 and 1200 px. The ≤ 900 px stack works but has two issues.**
- File: `src/style.css:123-137`.
- Measured:
  - At 800 px the stack works.
  - At 940 px the viewer is about 430 px wide and the two-row toolbar covers about a third of it.
  - The 1100 px breakpoint (250 + 260 px side columns) leaves only 390-590 px for the viewer at 901-1100.
- Recommendations:
  - Raise the stack breakpoint to ≤ 1200 px (viewer on top at 60vh, panels below).
  - Alternatively, below 1200 px keep two columns (viewer + one tabbed drawer for params and analysis).
  - Move the toolbar out of the canvas overlay into its own bar above it (grid row). It is two rows at ≤ 1100 px and covers the cart.
  - In stacked mode the order is viewer, analysis (right), params (left). The params are at the bottom, so you scroll past the analysis to reach any slider. Put params first, or use a collapsible "Parameters" section.
  - Make the viewer `position: sticky` (top) in stacked mode.

**L3. Right-panel truck-fit table is unreadable at 340 px.**
- File: `src/ui/right-panel.ts:131-146`.
- The "Fit" cell wraps ("N o"), the Show button is clipped, and the five-column limiting text overflows.
- Use a card list (one card per case: pass/fail pill, min gap, one limiting pair, Show button), or `white-space: nowrap` on the Fit and Min-gap columns plus a two-line row.
- The summary header "+ Operating" also wraps.
- When a case is shown, switch the tab to "Truck fit" and scroll to the row (a minor thing, but it is currently possible to be in truck view with a different tab visible).

**L4. Screenshots for the checkpoint are weak.**
- Files: `docs/screenshots/phase1/r0-*`. Several are 430 × 400 and below the claimed 1440 × 900.
- The brief asks for "several angles". There is no front view, no section or exploded shot, no full-lock top view, and no truck-view straddle shot.
- Re-shoot at 1440 × 900 once the fixes land: iso, side, top, front, lock ±40 top, exploded, section Y = 0, truck beside and truck straddle (removed).

**L5. Minor geometry and model notes.**
- Brake shoe and lever are floating until Phase 3, which is fine. The shoe's linkage has to cross over the tire from the shaft at x = −8 to a shoe at x = +5. Say so in notes, because that arm is about 14" and in the way of the seat back (x 3-8).
- The shoe overlap test is silenced by `ALLOW brake-shoe-/wheel-` because the tire OBB is a box. Add an exact check: the shoe face distance from the axle = r (it is, by construction), and the shoe y range lies inside the tire width.
- The rear brake lever clears the hull and tire by only 0.1" and 0.2" (y 14.1-15.6 in a 1.8" gap). The overlap test passes at 0.05" tolerance; widen the rear-tire-to-body gap or move the lever inboard.
- Grab handles are 1"-tall blocks on the 0.5" gunwale. A hand cannot wrap them. Phase 3 should make them loops or notches. (Note for the checklist.)
- The bridle is a straight 0.5" bar at ground-ish height (z = 5.4). The brief says "wide bridle". Okay as a placeholder.
- Steering stops are 1.5 × 1.5 × 1 blocks at ±7" but the turntable corner reaches 8.5". The stop test is "bear on the bolster" only; confirm geometrically in Phase 2.
- `centerOfGravity` uses OBB centres for non-box parts (prow, hollow box). That is fine for now, but set `cgIn` on the storage box and prow in Phase 3.
- Hidden-group toggles persist across rebuilds, which is good. The "reference" group hides rider and cargo together.
- The viewer does not dispose materials (cached), which is fine. `sweep` geometry logs a warning and renders nothing; Phase 3 will need it.

## Specific answers to the review questions

1. **Geometry plausibility:** good. Rider fits, the foot stop is touched, front wheels clear at lock, brake shoes are tangent, and storage is a flat tray. Defects: the kingpin/axle conflict (H1), the turntable/beam load path (M5), and the lever clearance (L5).
2. **Mass:** 137 lb. Seat group +14 lb over W-1, bolster +5, storage +2.6, frame −4.5. The biggest real contributors are wheels (22), axles (10), beams (11.4), deck (11) and sides (10). The biggest avoidable block-model artifacts are the seat back (8.7 lb), the seat base (6.4 lb) and the bolster (8.3 lb): about 17-19 lb if rebuilt as frames or removed.
3. **Param-driven:** mostly yes. Items for L1 are the structural exceptions.
4. **Truck fit:** correct for geometry and orientation, with a conservative SAT clearance. Straddle at defaults really places the wheels outside the well zone (rear wheel edge at x = 18.0, front at 53.0; clearance is carried by lateral gaps) but has no fore-aft margin. The mode logic is under-delivered against D-23 (H4, M8).
5. **Viewer/UX:** orbit, presets, explode, section, group toggles, truck view, live weight/CG numbers and the steer slider all work. Section is a keep-low-side clip with no cap. Missing or weak: CG marker, dimension overlays, a meaningful explode, narrow-window layout (L2) and the truck table (L3).
6. **Tests:** 173 pass, but H3 shows the default-only coverage. The fit tests are good on synthetic parts, but nothing exercises the real cart in straddle or tests wheel positions. Add the tests listed in H3 and H4.

## Suggested order of work for round 2
1. H1 (axle/kingpin), H2/M1/M2/M3 (mass rebuild plus tighter tests).
2. H3 (variant overlap tests) and H4/M8 (truck-fit report: max track per mode, minimum-removal case).
3. M5, M6, M7 (viewer CG marker and dimensions, explode layers, turntable load path).
4. L2/L3 (layout), L4 (screenshots at 1440 × 900 incl. front, explode, section, straddle).
