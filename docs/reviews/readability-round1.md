# Build-output readability critic, round 1

Package at defaults (pkg2: steps.md, build-book.html, cutlist.csv, drawings/, forms/, README) plus the live UI (Build mode, 1440×900 and 390×844).
Test: could Eric follow this in the shop without decoding it?

**Grade: 5/10.** The UI is much better: numbered steps with sub-bullets, part chips, a three-stage cut list (cuts → glue-ups → mill), forms with real build steps, and a dimensioned drawing for each part. The exports lag behind the UI, though. The drawings, cut list, steps and form notes contradict each other in several places, and one step gives the wrong hole. Several of Eric's complaints are still there: 27/32" from 4/4, decimals, D-IDs and param names, buying talk, and features with no location.

## MUST fix
1. **Exports do not match the UI cut list.** The UI shows CUTS / GLUE-UPS / FINISHED, but `cutlist.csv` and build book §2 still show the old final-size table. There, "Rail L" is listed at `3/8 × 3 × 59` (the rail is 3/4 thick), the knee and transom glue-up boards are missing, and the layer table reads `0.75 × 2.63 × 29.5`. Generate the CSV and the book from the same three-stage data as the UI.
2. **Drawing rough sizes disagree with the cut list, and some still aren't rounded up to 1/8".**
   - storage-rim-side: `rough 27/32" × 1" × 16-3/4", from 4/4`. This is exactly Eric's complaint; the cut list says 7/8.
   - axle-hanger: `3-27/32`; the cut list says 3-7/8.
   - seat-hinge-backer: `4-15/32`; the cut list says 4-1/2.
   - seat-wedge: `2-5/16 × 7-3/32`; the cut list says 2-3/8 × 7-1/8.
   - bridle-tongue: `6-1/4 × 11-1/2`; the cut list says 6-3/4 × 12-1/2.
   - beam-F: `2-3/4 × 28-1/2`; the cut list says 2-7/8 × 29-1/2.
   - brake-knee: `2-1/4 × 8-7/8 × 5-1/2`; the cut list says 9-1/2 × 6-1/2.
   - The knee's part card shows both figures at once ("Rough cut … 4-3/4 × 6-1/2" and "Board: rough … 8-7/8 × 5-1/2").
   - Fix: one rough-size function, used everywhere.
3. **The rail drawing says "Stock: … from 4/4 white oak"**, while the cut list resaws the rail strips from 8/4. Change it to 8/4.
4. **Knee T × W × L is swapped.** The drawing says `2-1/8 × 4-1/2 × 8-5/8 (T × W × L)` but calls 4-1/2 the "length" in its grain line. The cut list says `2-1/8 × 8-5/8 × 4-1/2`. Pick one convention.
5. **Step 1 states the wrong allowance:** "Rough is the final size + 1/8" in thickness and width, + 1/2" in length." The cut list actually adds about 1" in length (crossmember 22-1/2 → 23-1/2) and 3/8" in width on glue-ups. Restate it as the real rule, or say "see the cut list".
6. **Step 22 gives the wrong hole:** "Drill the upright latch hole … 1/8" blind, 29/32" deep … Mouth 1/2" and 1-17/32" from the rear edge". Those numbers are the two screw pilots in the bottom end. The latch hole on the seat-wedge drawing is 3/8", 1-1/16" deep, tilted 15°, mouth 1-9/32" from the rear edge and 1-29/32" up. Also give the 75° end cut in the step ("the back angle" alone gives no number).
7. **Features with only one of several locations given.**
   - Step 13: clamp-plate bolts "1-3/8" from the left end" and hold-down bolts "4-3/16" from the left end". Add "and the same from the right end".
   - Step 14: clamp-plate bolts "1-1/8" from the left end". The drawing has 1-1/8, 6-7/8, 20-5/8 and 26-3/8. The eye-bolt holes are at 5-3/4 and 21-3/4, and the roll pads at 4-1/4 and 23-1/4; the step gives only the left of each.
   - Step 21: "Batten dados … starting 10-15/16"". The drawing has 3: 3-13/16, 7-3/8 and 10-15/16, each 1" wide.
   - Step 11: the handle sockets have no position on the transom (no distance from the centerline or the top edge).
8. **Rail form layer count contradicts itself.** Step 2 says "4 layers of 3/4" MDF (3", …)", then "5 layers make a stack 3-3/4" tall". Make it 5 in the lead line.
9. **The "mirror ramp" is never defined.**
   - Step 8 Clamp/cure says "Flip the web onto the mirror ramp", and the side-form notes say "Do the other face on the mirror ramp".
   - The form's HOW TO BUILD IT (and step 2) say "Flip the web … on the same template and ramp".
   - Once the inner bands have cured, the S curves the other way, so either the instructions describe how to build the second ramp (a hollow), or they say why the same ramp works.
   - The same form says ribs are "3-15/32" apart" and "about 4-1/2" apart". Pick one.
10. **Step 0 in steps.md and in the book prints every check as "passed"** ("Tire squash test: passed | Wheel…: passed …"). The UI correctly shows "0 of 12 done". Print empty boxes.
11. **Template text left unfilled.** Step 25 and step 28 say "the socket screws from the parts list per socket into the T-nuts". State them, e.g. "2 × 1/4-20 × 1-1/4" button-heads per socket". Step 6 says "in each end, in the left end: 7/8" from the bottom edge"; it should be "in both ends, 7/8" up from the bottom edge, centered on the thickness".
12. **Decimals remain in shop-facing text.**
    - Plywood table (UI, CSV and book): `7/32 (0.21) × 14-11/32 (14.347) × 59-19/32 (59.59)` and `cut net 59.49" … blank 59.59" (+0.1" trim, S1)`.
    - Steps 3 and 7: "deck + 0.04"". Step 14: "about 0.1" (1/32" to 1/8")".
    - Side form "Dimensions and notes": `59.49"`, `14.347"`, `4.293"`, `29.49"`, `22.49"` and `Cleats on the sheer line: 15"`.
    - Book: "(21.142)"-style parentheticals and the board-yield table (`5.88" × 26"`, `joist-3 2" × 23.5"`).
    - Book cut-list lead: "Resaw … 8 strips of 3/8" rough … RIP FIRST into 4 lanes". Steps say 5 lanes.
13. **Internal names and IDs in the running text.**
    - D-IDs in steps 1, 2, 9, 12, 19, 21, 24 and 27, in Finishing ("the D-70 face laminations", "see D-58") and in the cut-list headings ("D-70").
    - Book and UI Verify: "Params: bumpWheelRateLbIn · Guards: wheel-RL…", "Q-1", and "the hard-hit rows … flip".
    - Drawing headers: "Part brake-knee", "MAKE 3 identical (joist-2, joist-3, joist-4)".
    - Part keys under every UI cut-list row (side-gunwale-in, beam-F, joist).
    - Keep IDs in tooltips or Advanced mode only.
14. **The Clamp/cure paragraph is the dense paragraph Eric complained about,** copied into about 20 steps. It includes the Titebond sentence even where no Titebond joint exists (steps 19, 22–24, 26, 28, 29). Replace it with one line per step, e.g. "Epoxy: clamp overnight (8-10 h at 70 °F, 12-15 h at 60 °F)", and put the full glue card once in the front matter. The empty "Clamp/cure:" lines in steps.md go too.
15. **Physical items to settle with the engineering critic.**
    - (a) The brake knee grain runs horizontal ("along the 4-1/2"" dimension), so the 1-3/4"-wide bolted leg below the 4-1/8" shoulder is short grain. The 2-board edge-glue line also lands near that shoulder. Turn the grain vertical, or cross the middle layer.
    - (b) The bridle-tongue bolt holes run from the rear end and exit on the 38° shoulder, about 4-1/4" deep at 1" from the edge, not 3". A 6-1/2" carriage bolt through that plus the 2-1/2" beam is about 3/4" short, and its head would sit on a slope. A square spot-face or counterbore is needed.
    - (c) Seat-hinge backer: a 3/8" hole centered 5/32" from the rear edge breaks out of the edge.
    - (d) Step 23 says inserts go in blind holes "from the front face" but screws go "into the inserts on the back". Pick the back.
    - (e) Step 6 says to drill the knee bolt holes "the knee as a template", but the knees are made in step 15. Use the rail drawing (feature E) or move that drilling.
    - (f) Step 15's 1-1/2" fender washers on bolts 1-1/16" apart overlap, and "1/2" counterbores" doesn't say whether that is the diameter or the depth.
16. **Buying talk in the build steps:**
    - Step 0: "Try ONE wheel first… Get the other three only when…" and "The axle steel should come with a mill cert."
    - Step 3: "The Extreme setting (stored outside) uses epoxy everywhere…"
    - Move these to Verify or the BOM.

## SHOULD
- Step 4: "about 6-9/16" apart". Say "9 equally spaced, 3-1/4" to 55-3/4" (rail drawing, G)". Label which crossmember each of the 7 inboard mortises takes.
- Step 2 says "Print the templates: … brake flap and knee". There is no knee template in Forms.
- Step 2 bands: the side form glues "the chine band (7/32" × 1-1/2")", but the inner chine band is 7/32 × 1.
- Clamp counts differ: 15 per band (form) vs about 14 per band pair (step 7 Clamp/cure). Cleats are "4-9/32" apart" in one place and "every 4-5"" in another.
- Step 9 cradles have only a position, width and height. Add a cradle sketch (notch shape and depth) or put them in Forms.
- Step 9: "Cut the bands and webs to that length less 1/32"" contradicts step 2's "cut net from the file". Say whether the webs get trimmed.
- Step 5's hanger bolts are the same holes as the step 13 hold-down angle. Say "the step 5 bolts come out and go back through the angle".
- Step 22: "1/16" detent groove 23/32" from the mouth". Name the tool here (hook tool, as in Verify 6).
- Step 16: "in line across the sled" contradicts the pilots at 17-1/2" and 18-17/32" fore-aft. Round to 18-1/2".
- Step 24: give the shoe's tire radius (5"), not just "cut to the tire radius".
- The BOM buys a MAS 5:1 kit, while the steps and Finishing say West System 105/206 and 406. Use one brand or say "105/206 or equivalent".
- Bridle sleeve: 1-1/2" long in a 1-1/4" stem, but the check says "Sleeve flush".
- Cut-list names: "Left chine band (outer)" qty 2 and "rear left axle clamp plate" qty 6 should be "Chine band, outer (L + R)" and "Axle clamp plate". Number the four plain "Crossmember" cut rows (2–4, 5, 1, 8).
- Show in 3D on the knee frames it almost entirely behind the rail. Ghost the other parts or frame wider.
- README: `0.266 in`, `0.406 in`, `0.344 in` and `0.02 in` holes; the duplicated "Weather spec" line; "5mm-sheet" file names for 1/4" ply.

## NIT
- "5.3 mm (just under 7/32")": just say 7/32".
- "1/4 in white oak plywood": write 1/4".
- "Step 15 of 29" when there are 30 steps (0–29).
- Verify numbering runs 1, 2, 3, 4, 5, 7, 10 / 6, 8, 9, 11, 12.
- 32nds where a scribe or fit governs: crossmember 5 at 21-5/32 (scribed), the bench top at "65-1/2" × 20-11/32"", the handlebow radius "50-21/32"".
- "pooled fasteners", "65 lbf sideways" and "the S" are shop-unfriendly.
- Rail form: 61" strips on a 41-1/4" form leave about 19-3/4", not "about 18"".

## What works
- UI steps: short imperative bullets with nested detail. Most cuts are located from a named edge, with a depth.
- Part chips open a card with sizes, a drawing link and Show in 3D.
- The UI cut list in three stages, with edge-glued and face-laminated boards listed individually. Resaw is planned as rip lanes first, then on edge, within the 6" bandsaw.
- Laminated blocks are 3 × 3/4" from 4/4, milled to 2-1/8" (no 27/32 on the laminations).
- Drawings: datums named, balloon features with locations and depths, MAKE 2 / mirror called out.
- Forms: material, layers, base, caul, tape, clamp count and spacing, and a spring-back test.
- Mobile 390 px: no horizontal scroll, and the cut list collapses to cards.
