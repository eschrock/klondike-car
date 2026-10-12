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
