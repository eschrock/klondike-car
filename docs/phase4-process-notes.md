# Phase 4 process outputs: notes (2026-10-12)

Files: `src/build/assembly.ts`, `finishing.ts`, `verify.ts` (tests beside them). All are pure functions of `(parts, params)`; no three.js.

## Assembly steps (`assemblySteps`, 28 at the defaults)
Prep (no parts): 0 Verify before ordering; 1 Mill the oak and resaw the strips; 2 Cut the Shaper parts and make the forms; 3 Seal the sheet parts and dados.
Build: 4 Bend-laminate the rails; 5 Frame and deck as one unit; 6 Side sandwiches, cure 1 (web, inner bands, sign backers); 7 Side sandwiches, cure 2 (outer bands, scuppers); 8 Dry-fit, measure, trim (process); 9 Lower the frame + deck unit into the inverted sides (process); 10 Close the rear (transom + backers); 11 Close the bow (bulkhead); 12 Rear axle hangers; 13 Rear beam, axle, hold-downs; 14 Front axle (beam, kingpin, stubs, roll pads, eye bolts); 15 Wheels; 16 Turn the hull upright (process); 17 Tongue, bridle, check chains; 18 Storage box; 19 Storage lid; 20 Seat stop blocks and crest strip; 21 Seat back, hinges, pins, cushions; 22 Brake knees and backers; 23 Brake flaps, pads, cords, chocks; 24 Push handle; 25 Lash doublers and flag blocks; 26 Finish (process, see below); 27 Final fit (grab boards, signs, hardware, lights).
- `BuildStep` extends `AssemblyStep` with `id, kind ('prep'|'build'|'process'), modelStep, partIds, tools, checks, cure, view`. `cumulativeParts(steps, n)` and `stepParts(steps, n)` drive the viewer.
- Parts are handed to a template by id regex and model step; leftovers go to the last template of their model step or to a generated step, so a new part can never drop out (tested).
- Epoxy: 206 for ordinary glue-ups (pot 20-25 min, clamp 8-10 h, full 24 h+), 209 for closing the transom and bulkhead (pot 90-120 min, clamp 20-24 h). Winter figures at 60 °F are scaled by 2^(10/18) = 1.47 (`epoxyTimeFactor`).
- Running gear steps use view `under` (hull inverted); everything else iso/top/side/front.

## Finish quantities (`finishingSchedule`, gross area 97 ft²: 51 oak, 46 okoume, 5.6 ft² oak end grain)
- Epoxy 105/207: coat 1 at 60 ft²/qt mixed, coat 2 at 80 ft²/qt (okoume + 2x end grain = 57 ft²) = 1.9 qt mixed: **2 qt resin + 1 pt hardener**.
- Varnish: 4 coats at 125 ft²/qt = 3.6 qt: **1 gal**, plus 1 pt thinner. Stain (150 ft²/qt) 1 pt; conditioner and gel stain (125 ft²/qt) 1 pt each; black enamel/pigment for the lid legend 1 pt. +15 % waste on all.
- Steps: offcut tests, sand 120/150 (roundover = param), stain, epoxy seal (2 coats), engrave DO NOT STEP (after the epoxy cures, filled with black epoxy), 4 coats spar varnish at 320.

## Checklist ids (`verifyChecklist`)
`tire-squash` (squash >= 0.55" at 300 lb, rate <= 560 lb/in = 1.12 x the modeled 500), `wheel`, `axle-tube`, `steering-parts`, `bridle`, `seat-back`, `sign-knobs`, `brake-knee`, `lamp-clip`, plus `other-params` (built from whatever `verify` params no check claims: the truck dims Q-1, `oakNdsShearPsi`). 35 verify params at the defaults, all covered (tested).

## Assumptions
- Areas are gross (glued faces included): epoxy is right, stain and varnish are 15-25 % high. Coverages are typical label / WEST figures, cited in the schedule; epoxy per the D-20 note (about 300 ft² per mixed gallon).
- The first epoxy coat is the assembly seal (step 3); the finishing quantity counts both coats once.
- Finish happens in step 26, after the brake and handle are on, so those removable parts come off for finishing. Hardware goes on last.
- Frame and deck are one glue-up (backers the day before); the rails are laminated first (their own cure).
- Side sandwiches take 4 cures with one S-form (two per side). Lowering uses 206 per side; the ends use 209.
- Lid engraving depth is the model's 0.03"; the schedule has an offcut test against the face veneer of the 4 mm ply.

## Model notes found stale or contradictory (not fixed)
1. Scarf text survives D-68: the band joints say the band "bridges the web scarf", the web note says "no scarf (sideWebScarf is the option for 2 x 4 sheets)" and names Aircraft Spruce, and `docs/phase3c-7-notes.md` still describes the scarf. The HULL_STEP comment (steps 1 and 3) also says "Scarf the two halves" and "thin okoume ships as 2 x 4 ft sheets".
2. Sequence: D-63 cuts the deck 1/16" narrower than the measured gap between the BENT webs, but HULL_STEP.deck (4) glues the deck to the frame before the sides (4.2) exist. I put the check in the dry-fit step ("pare the deck edge"); a cleaner order is to bend one side first and pattern the deck from it.
3. `storage-hinge-L/R` are step 7, but the crest strip (step 5) must be bedded over the hinge leaves "screwed on first". I tell the builder to fit the leaves at step 5.
4. `axle-hanger-L/R` (step 4.6) carry 5x30 Dominos to `joist-1` (step 3), which is already glued and cut back 0.88": the Domino cannot be fitted after the fact without an open mortise. The bolts and the 5" x 3" glue face carry the load.
5. Checkpoint item 8 ("hold a real hinge to the first beveled brake knee") is stale since D-65 (pull-pin pivot, hinge gone). The check now tests the pin, slot, tongue and tire clearance on the first knee.
6. D-20 estimates 60-70 ft² of wood surface; the gross geometry is 97 ft² (the body model credits glued faces, so the net is lower; finishing.ts quotes gross).
7. `STEP.steering` (4.5) and `STEP.linkage` (4.7) have no parts at the defaults; the templates accept them if they appear.

## Round 2 (build review 6/10 fixes: assembly.ts, finishing.ts, verify.ts)
- **Order (30 steps).** verify, mill, shaper, seal; rails, hangers, frame, sides x2, dry-fit, lower, transom, bulkhead; rear-beam, front-beam, gear-fit, finish-under, flip; tongue, box, lid, seat blocks, seat back, brake knees, flaps, handle, wood-fitout; finish; **hang**; final-fit.
- **Finish after hardware (MUST-1).** The gear is fitted and drilled on the inverted hull (gear-fit), taken off, and the underside is finished before the flip. `isHangPart` (assembly.ts: purchased/metal/printed wheels, axles, plates, roll pads, eye bolts, chains, rope, hinges, pins, cushions, handle sockets and pins, brake pins/cords/pads) puts those parts in the final `hang` step, so `cumulativeParts` shows them only once on. Choice: hardware parts in the final step, not the fit step. The hang step's `modelStep` is clamped up to 7 (the list stays nondecreasing); the tests exempt it. Beams, hold-downs, kingpin, tongue and sleeve stay on and are finished in place (D-65).
- **Stain vs seal (MUST-2).** Seal step: dados, edges, hidden faces only; show faces bare. Finishing: stain, then epoxy (offcut test gates both). Water-based dye under epoxy is the safe route.
- **Rail ends (MUST-3).** End mortises are cut in the dry-fit step after the flush-cut trim; joint types are read from the rail's joints (loose tenon at the transom, 8x50 Domino at the bulkhead, D-69).
- **Backers (MUST-4).** `brake-backer-*` go wherever `Part.step` says: the frame template takes them (and drills the knee-bolt holes) if the model step is 3, brake-knees otherwise; both orders are tested.
- **Chine tie (MUST-5)** at the end of sides-outer: count and size from the rail/chine Domino joints. **S-ramp and rail form (MUST-6)** are quoted from `formDrawings` dims (`ramp-rise`, `ramp-length`, `ramp-ribs`, `form-length`; optional `stack-height`, else layers = ceil(rail depth / 0.75")). One term: S-ramp for the sides, rail form for the rails.
- **Resaw (MUST-9)** quotes `cutList().resaw` (board, slabs, boards, `stripSlots`, `spares`); panel glue-ups come from `oakBoardFeet().glueUps`.
- **Epoxy (MUST-10).** 105 with 207 and 209 is 3:1 (`EPOXY_RESIN_PARTS = 3`). Buy list adds 209 (sized from the transom/bulkhead joints, `closeEpoxyFlOz`) and `schedule.supplies` (303 mini pump set; kept out of `buy` so its unit type stays gal/qt/pt). `glueEpoxyFlOz(parts, only?)`: Domino 0.1-0.25 by size, loose tenon 0.12, dado 0.6, fillet butt 0.5, lamination 1 fl oz/ft2 by contact area, else 0.25; about 51 fl oz mixed at the defaults (no waste).
- **Also:** handle-socket T-nuts set in the backers at the transom step (no wrench behind the box; BOM nylock nut becomes a T-nut), hinge leaves taped as spacers under the crest strip, station cradles from the layout, joist-end scribing (angle from the taper), stop-block screws pre-drilled from below while inverted, verify items `strip-bend` (before ordering) and `ply-thickness` (before cutting).

## Round 3 (build review 7/10 fixes)
- **Knees before the underside finish (MUST-A).** The `brake-knees` step now sits between the front beam and the wheel dry fit (hull inverted, view `under`): epoxy to bare rail and chine outer face, nylocks in the backer counterbores, finished in place with the underside. `Template.at` sets its order position; `EARLY_STEP_IDS` clamps its `modelStep` DOWN to the running step (4.6) so the list stays nondecreasing, while the parts keep `STEP.brake` (6). The viewer shows the knees when they are glued; flaps, pins, pads and cords stay in `brake-flaps` / `hang`. Tests exempt the knee step from "min part step = modelStep". The one-knee verify test is a step-0 gate.
- **Step 1 boards (MUST-B)** come from the cut list board column (`boardOf`); strip pools are found via the cut list's strip rows, never the raw `rough`.
- **Rip first (MUST-C).** Step 1 prescribes rip lanes, then resaw each lane, and quotes `lanes`, `stripSlots`, `spares` from `cutList().resaw`. Strip bend test (verify, step 2) uses the planned spares; a passing strip goes into the laminate.
- **Web** (59.49" net, 59.59" blank, from `flatPattern` and `stock.l`) is stated in step 2 and the dry fit. **Handle screws** are parsed from the joint size text (`socketScrewText`). **Hang** says how the hull is supported (side on a blanket, or padded horses).
- **Stop-block pilots** (`stopBlockPilots`, from the wedges' screw `at` through `transform`): 17.55" and 18.54" forward of the transom outer face, 7.38" off the centerline, drilled at the wheel dry fit; the seat-blocks step drives the screws from the underside with the sled on its side (no "from below" on an upright hull).
- **207** is bought with >= 25 % spare (`HARDENER_MARGIN`): 0.46 qt need becomes 1 qt, not a pint.

## Right-sized finish (Eric, 2026-10-12)

A snow sled kept in a garage, not a boat. Before to after, at the defaults (`finishing.ts`, `finishing.test.ts`; assembly 209 text and the BOM resin share follow):
- **Areas:** gross 97.5 ft² (51.5 oak, 46.0 okoume) became net 83.0 ft² (42.8 oak, 40.2 okoume) after 14.5 ft² of glued lamination contacts came off both parts. Of the net: 41.2 ft² show (17.1 oak, 24.1 okoume), 41.8 ft² hidden (25.7 oak, 16.0 okoume), by the `SHOW_RULES` table.
- **Epoxy coating:** two coats at 60 / 80 ft² per quart (about 59 fl oz mixed) became ONE saturation coat at 78 ft² per mixed quart (West System 105/206 table midpoint), 23 fl oz mixed. Second coat on the deck top and 207 are options, not in the quantities.
- **Glue:** 51.2 fl oz became 50.8 (rate 1.0 down to 0.6 fl oz/ft², West's 0.5-0.75; the two-strip rail glue line is now counted), 60.9 with 20 % waste. Closes use 206 in small batches (no 209, no 303 pumps).
- **Total mixed epoxy:** about 140 fl oz (coats + glue + the 209 closes) became 84 fl oz = 70 resin + 14 hardener (5:1, 206 only).
- **Varnish:** 4 coats on all wood, one gallon (3.6 qt) became 3 coats show / 2 hidden at 140 ft²/qt, 1.7 qt, so 2 quarts. Stain and conditioner: show faces only, one coat.

## Instructions rewrite (Eric, 2026-10-12)

Assembly, finishing and verify text rewritten as a one-line `goal`, 2-10 short `items` with sub-bullets (`Instr { text, sub?, parts? }`), `{{part-id}}` tokens for part mentions (rendered as names, chips in the UI, links to the cut list in the book), shop fractions, locations from `part-drawings.ts`, no buying, no param / file / raw part names; `instructions` stays as the flat fallback. Verify items gain `how` and `passList`. Tests enforce it in all three specs.
- **Before (mill, laminations):** "Face-laminate the thick parts BEFORE anything is notched, bored or slotted (no 12/4 is bought, D-70): beam-R (3 × 3/4" from 4/4); … Plane each layer to the rough thickness in the cut list's layer table (the 0.125" planing allowance is taken once, on the glued block), edge-glue any wide layer first, then epoxy …"
- **After:** "Face-laminate the thick parts before anything is notched, bored or slotted (see D-70)." – Rear axle beam: 3 × 3/4" from 4/4. – … – Plane each layer to its rough thickness (cut list, layer table). – Epoxy the layers face to face: 206 slow, thickened a little with silica. – Clamp flat between cauls, ends and edges flush; cure overnight. – Mill the cured block to its final size.
- **Before (band strips):** "Band strips: 8, rough 0.333" × 1.625" × 59.25" (finished 0.208" × 1.5" × 58.75"), resawn from 4/4, RIP FIRST: rip 5 lanes in all (3 × 1.625", 1 × 1.113" + 1 spare lane …) … Buy 1 × 4/4 × 9" × 6 ft …"
- **After:** "Resaw the band strips: 8 for the chine and gunwale bands (cut list, strips table)." – Rip the lanes from a 10"-wide board first: 5 lanes, 4 at 1-7/8" and 1 at 1-3/8" (one is the spare). – Then resaw each lane on edge into 2 slabs: resaw height 1-7/8" (your bandsaw: 6"). Never stand the whole board on edge. – That gives 10 strips for the 8 needed: 2 spares for the bend test. – Plane or drum-sand each strip to 5.3 mm.
- **Locations:** e.g. rails, "Cut the beam notch in the bottom edge of each rail." – 2-3/8" wide × 1-3/32" deep in the bottom edge, starting 8-5/16" from the rear end (to 10-11/16"). The forms step presents `formDrawings()[i].build`. `partDrawings` now takes about 2 s, so `assemblySteps` caches it per parts array and params.
