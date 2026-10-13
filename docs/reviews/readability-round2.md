# Build-output readability critic, round 2 (commit 539d2b5)

Re-read pkg2 (steps.md, build-book.html, cutlist.csv, drawings/, forms/, README) and the live UI (Build mode, 1440×900 and 390×844; no horizontal scroll at 390).

**Grade: 7/10** (round 1: 5). Eric could now follow most of this in the shop.
- The cut list really is the actual cuts, glue-ups and mill sizes, in the UI, the CSV and the book alike.
- Rough sizes agree across the cut list, drawings and part cards.
- The glue card replaced the paragraphs, the D-IDs and decimals are out of the build text, and every multi-place feature is located.
- Three things still stop it reaching 8: drawings that say their own hole positions are off, the knee lamination described two ways, and a few leftover contradictions in step 2.

## Round-1 MUSTs
| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Exports match the UI | Fixed | CSV opens "# 1. Cuts … # 2. Glue-ups … # 3. Finished parts"; the book's §2 is the same; Rail L is `3/4 × 3 × 59` |
| 2 | Rough sizes agree and are rounded up | Fixed | storage-rim-side "rough 7/8 × 1 × 16-3/4"; hanger 3-7/8; seat-wedge 2-3/8 × 7-1/8; beam-F 2-7/8 × 29-1/2 |
| 3 | Rail reads 8/4 | Fixed | "resawn from 8/4 white oak" |
| 4 | Knee T × W × L | Fixed | "final 2-1/8 × 8-5/8 × 4-1/2 (T × W × L)" on the drawing, the CSV and the card |
| 5 | Allowance rule | Fixed | "1/8" thicker, 1/4" wider and 1" longer … glued-up … 3/8" wider and 2" longer"; this matches the crossmember (5/8×1-3/4×22-1/2 → 3/4×2×23-1/2) |
| 6 | Step 22 hole | Fixed | "3/8" hole, 1-1/16" deep … tilted 15° … Mouth: 1-9/32" … 1-29/32""; "75° from level" |
| 7 | All positions | Fixed | Step 13 "at 1-3/8" and 26-1/8""; step 14 has 4 plate places; step 21 has 3 dados; step 11 socket "9-3/8" either side … 1-3/4" up" |
| 8 | Rail form layers | Partly | The form is fixed. The step 2 lead line still says "**4 layers** of 3/4" MDF (3", …)", and the next line says "a stack of 5 layers" |
| 9 | Mirror ramp | Fixed | Ribs, cap, cleat spacers and the flip are given in the form and in steps 2, 7 and 8 |
| 10 | "passed" in Verify | Fixed | Book "☐1. Tire squash test"; step 0 checks are now to-dos |
| 11 | Unfilled template text | Fixed | "2 × 1/4-20 × 1-1/4" stainless button-head cap screws per socket"; "at both ends of each crossmember" |
| 12 | Decimals | Fixed in the build text | Plywood is `7/32 × 14-11/32 × 59-19/32`, the forms show none, "about 3/64"". Decimals remain only in the BOM and the Verify ratios |
| 13 | Internal names | Partly | Steps, forms and drawings are clean. The BOM still has "(D-70: beam-R …; brake-knee …)", "ESTIMATE (D-75)" and "S7". The part card still shows "brake-knee · 2 identical" for a mirror pair |
| 14 | Clamp/cure paragraph | Fixed | Glue card in step 1; one-liners such as "Epoxy: clamp 8-10 h, full cure 24 h (glue card, step 1)" |
| 15 | Physical items | Fixed (but see new MUST 1) | Cross-laminated knee; tongue "flat and square out past both bolt holes … 3" deep"; backer pin "2-1/2" from the rear edge"; inserts and screws on the front face; flush 1/8" backing plate |
| 16 | Buying talk | Fixed | Step 0: "The wheel and axle notes are in the Verify section" |

## MUST (new or remaining)
1. **Three drawings say their own holes are in the wrong place.** Each warning sits on a drawing that a step points to for drilling:
   - `rail-rail-L.svg`: "The model puts 4 of the 4 points for the left brake knee backer 3/8" outside this part; they are drawn at the nearest face." Step 6 drills the knee bolts "from the rail drawing".
   - `side-gunwale-in-side-L-gunwale-in.svg`: "…6 of the 6 points for the left grab board 5/16" outside this part…" Step 29 says "positions on the inner gunwale band drawing".
   - `storage-rim-end-storage-rim-end-fore.svg`: "…2 of the 2 points for the lid friction stay 1/2" outside…"
   - Fix the model geometry so the points land in the part (this may be a real backer/rail misplacement), or drop those holes from the drawing and say "drill through the mating part".
   - A shop drawing must never carry a model-debug note.
2. **Step 1 still laminates the knee the old way.** It reads: "Brake pivot knee L and brake pivot knee R: 3 layers … each layer edge-glued from boards" (in the laminate list and again under "Saw the bandsaw blanks"). Step 15 reads "Glue up each knee block cross-laminated … Center layer: grain upright … one piece".
   - Someone following step 1 glues all three layers with horizontal grain, and step 15 then glues the knee up a second time.
   - Put the cross-lamination (across / upright / across, center layer one piece, outer joint 3-15/32" up) in step 1, where the blocks are glued. Step 15 should only say "from the cross-laminated block (step 1)".
3. **Step 2 contradictions:**
   - Change "4 layers of 3/4" MDF (3", never less than the 3" rail depth)" to "5 layers, 3-3/4" tall".
   - "the blank is 59-19/32"" disagrees with the CSV ("start from a 59-5/8" blank (+1/8" trim)"). Use 59-5/8 in both. The plywood table's "Final … 59-19/32" should also read 59-1/2: that is the final length.
4. **Step 6 doesn't say which backer gets the recess.** "The day before, on the bench: cut the plate recess in the inner face of each backer" sits right after the seat-hinge backers and before the brake backers are mentioned. Write "in the inboard face of each **brake knee backer**", and move that bullet under the brake-backer bullet.

## SHOULD
- Knee drawing: show the three layers, their grain arrows and the outer-layer glue joint (3-15/32" up).
- The "glued block rough 2-1/4 × 10-5/8 × 6-1/2" has outer layers only 9-1/2" tall and a center layer only 4-7/8" wide. Say "center the upright layer; the block is not square until it is milled".
- Step 2: "The mirror ramp (step 5)" means the form's item 5, but assembly step 5 is the axle hangers. Write "(side form, item 5)".
- Mirror-ramp cap: "cut to the web's full outline … 16-3/32" wide across the ribs". The web outline is 14-11/32" tall, so say which dimension is 16-3/32".
- Step 15: 1" washers on bolts 1-1/16" apart, 17/32" from the rear face, leave 1/32" to the edge. Check this, or call for 7/8" washers.
- Step 2 still says "Print the templates: … brake flap and knee"; there is no knee template in Forms.
- Step 16: "in line across the sled" contradicts pilots at 17-1/2" and 18-17/32" fore-aft (round to 18-1/2").
- Step 9: the cradles need a sketch (notch shape and depth). "Cut the bands and webs … less 1/32"" still contradicts "cut net from the file".
- Step 13: "cotter cross holes 5/32" near each end" should give the distance from the rod end.
- The cut stage has 4 rows named just "Crossmember". Number them (2–4, 5, 1, 8), as the book's board-yield table already does.
- Show in 3D on the knee still frames it behind the rail (the highlight barely shows). Ghost the other parts or frame wider.
- BOM text: drop the D-IDs, "S7" and part keys (beam-R, brake-knee).

## NIT
- Empty "Clamp/cure:" lines in steps.md (steps 2, 9, 13, 14, 16–18, 27).
- "about 4-9/32" apart" (step 7): write "about 4-1/4"".
- "Drill a 5/8 access hole" (step 25) is missing its inch mark.
- "1/4 in white oak plywood"; "pooled fasteners" (step 29); "Step 15 of 29" for 30 steps.
- Verify 3: "the rear axle row is 0.78 …" is analysis talk. Verify 12 still lists "Axle tube yield strength (DOM)" for a solid-rod design.
- The book's "Too thick for any board …" line repeats "3 layers: 3 × 3/4" from 4/4, glue up, then mill…" six times.

## What works
- Three-stage cut list everywhere, with the uneven knee boards called out ("board 1 is the bottom edge, board 2 the top").
- The glue card is short and the per-step lines are scannable.
- Located features use fractions from named edges.
- The forms read as build instructions (layers, base, caul, ribs, cleats on spacers, flip to the mirror ramp).
- The physical fixes are explained in one line each ("four fender washers would overlap", "the taper to the stem starts inside the bolt heads").
