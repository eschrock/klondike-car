# Phase 4 build package: buildability critic, round 1 (2026-10-12)

**Question:** could Eric and two shop-literate helpers build the sled from these outputs alone?
**Grade: 6/10.** The data is unusually complete and mostly right. But several steps can't be done when they are scheduled, some numbers disagree between files in ways that would cause a wrong cut, and the BOM misses parts the steps use. Each MUST below is a small edit.

Reviewed: the default package dump (README, cutlist/bom CSV, shaper/*.svg, forms/*.svg, assembly/finishing/verify/oak-plan/nesting/parts JSON) and `src/build/*.ts`.

## Spot checks (13)
| # | Number | Result |
|---|---|---|
| 1 | Web height 14.347 = 14 + 0.472 deck − 0.125 web cap | OK |
| 2 | Web length: cut list and step 2 say **59.34**; `shaper/side-web.svg`, side-form and D-68 say **59.24** | MISMATCH |
| 3 | Dominos: 4×20 ×18 (9 a side at 6" over 58.75"); 5×30 ×16 (8 members × 2); 8×50 ×2 | OK |
| 4 | 3/8 nylocks 26 = 4 rear clamp + 8 front clamp + 8 knee + 2 tongue + 4 eye; 1/4 nylocks 28 | OK |
| 5 | Every rough thickness fits its board's usable thickness (e.g. knee 2.625 in 12/4; hinge backer 1.125 in 5/4) | OK |
| 6 | Step 1 says rail strips come "from 4/4", but 2 × 0.5 + 0.125 kerf = 1.125 > 0.9375 usable (the oak plan correctly uses 5/4) | WRONG |
| 7 | Resaw: 8 band strips from one 6/4 (9 yielded); 4 rail strips from two 5/4. Steps 1–2 promise 10 and 5 "with spares" | SHORT |
| 8 | Okoume 46 ft² = deck 18.1 + webs 13.0 + seat back 3.7 + box 5.8 + lid 3.7 + signs 1.7; varnish 97 ft² × 4 / 125 + 15 % ≈ 1 gal | OK |
| 9 | Lid panel: cut list 18.75 × 14.796 (the 18.25 × 14.296 opening + a 1/4" rabbet each side); `storage-lid.svg` is **18.25 × 14.296** | WRONG FILE |
| 10 | Grab board: cut list 8 × 5.5; `seat-grip.svg` is 8.83 × 6.90 (drawn rotated 12°) | MISMATCH |
| 11 | Seat back: cut list 16.25 sq; the SVG and part notes say 16.0 | MISMATCH |
| 12 | Thumb knobs: 8 needed, BOM has 10 (2 phantoms from the `brake-snap` "knob" joint). Thrust-disc screws: 3 needed, BOM has 1 | WRONG |
| 13 | Glue epoxy: 115 joints × 0.12 fl oz = 16.6 fl oz. The 8 full-face bands alone are about 700 in². A realistic total is 40–50 fl oz plus fillets and fairing. The gallon kit still covers it | BASIS WRONG |

## MUST fix
1. **Finish before hardware (assembly steps 13–27).** The axles, wheels, clamp plates, eye bolts, handle sockets and hinges go on in steps 13–24. Step 26 then varnishes "everything", and its own check says "varnish fully hard before hardware goes on". Fix:
   - Steps 13–24 become "fit, drill and dry-assemble, then remove the bolted hardware".
   - Finish the underside before the flip (step 16), or say to finish it with the hull on its side.
   - Add a final "hang the running gear" step after step 26.
   - Drop "tongue" from step 26's take-off list (D-65: the tongue is not removable).
2. **Stain vs seal order.** Step 3 epoxy-seals *all* okoume faces (webs, box, lid, seat back) before assembly. Finishing step 3 then stains the okoume, and gel stain won't take over epoxy. Fix one of two ways:
   - run finishing steps 1–3 (test, sand, stain the show faces) on the sheet parts before assembly step 3; or
   - limit step 3 to the dados, the hidden faces and the deck underside.
3. **Rail end joints are cut, then trimmed off.** Step 4 mortises the rail ends (the transom tenon and the bulkhead 8×50), but steps 4 and 6 leave the rails 1/2" long and step 9 trims them. Fix:
   - Move the end mortises to step 9, after the trim.
   - Step 9's tool "table saw or bandsaw" can't trim rails on a glued frame + deck. Say "flush-cut saw or multi-tool, under the 1/4" deck overhang".
4. **Brake backers belong in the frame glue-up.** `brake-backer-L` notes say "the crossmember that meets it is cut back 0.75" and butts the backer face", but step 22 glues the backers after the hull is closed and flipped. Fix:
   - Move the backers to step 6 (like the seat-hinge backers), and drill the knee-bolt holes there.
   - Step 22 then only bolts the knees on.
5. **The side half of the chine Domino tie is missing.** Step 4 mortises the rail tops, and step 9 says the Dominos "engage", but no step mortises the 0.391" bottom edge of each side (outer band + web). Add this at the end of step 8: mark from the rails at a dry offer-up, then cut 9 vertical 4 mm mortises a side, centered on the web/band glue line.
6. **Stale S-ramp size.** Step 2 says "S-ramps about 1.25" high × 14" long" (pre-D-66). `forms/side-form.svg` says rise **2.75"**, ramp 29.49", 3 MDF ribs. Fix:
   - Step 2 should quote the form, and give the rail form's stack height (≥ 3", i.e. 4–5 layers of 3/4" MDF; it now says "two 3/4" MDF cauls").
   - Step 7 says both "bend on the S-form" and "lay the web FLAT on the S-ramp". Use one term.
7. **Bulkhead grain label is wrong.** `bow-bulkhead.svg` says "grain across (vertical)". The part has `grain: 'y'` (across the hull, along 18.5"), but it uses a world-frame letter while `flat.ts` reads grain in the extrusion's local frame (the transom uses local `'x'`). Following the file puts short grain in the 1.25" bar over the lift hand-hold. Fix:
   - Map grain through the part transform in `flat.ts`, or normalize `body.ts` to local axes.
   - In `cutlist.csv`, print "along L" or "along W", not x/y/z.
8. **File sizes that disagree** (rows 2, 9, 10, 11):
   - Lid SVG → 18.75 × 14.796, less a 1/32" fit.
   - Web: decide whether the 0.1" trim allowance is in the Shaper file (S1 trim at dry fit) and make the cut list, step 2 and the SVG agree.
   - Draw the grab board in its own frame (8 × 5.5, grain along 8").
   - Settle the seat back at 16 or 16.25.
9. **Resaw text** (step 1 and the `rail-L` / `side-*-in` notes): band strips from **6/4** (3 per 1.625" lane), rail strips from **5/4**. Make the purchase plan include the spares the steps promise: a third 5/4 strip board for the 5th rail strip, or drop the spare claims.
10. **BOM is missing things the steps use:**
    - West **209** hardener (steps 11–12);
    - **303 pumps**. 207 and 209 are **3:1** by volume, not 5:1 as finishing step 4 says. Re-derive the 207 quantity at 3:1 (≈ 0.48 qt; buy 1 qt).
    - 4 axle **collars + cotter pins** (step 15) and axle end caps;
    - 6 **#10-32 × 3/8 machine screws** for the seat hinges;
    - 2 **3/8" × 2-1/4" 316 rods** (handlebow);
    - about 10 **rail-to-chine screws** (step 10; give the size and length);
    - 4 **5/8" button plugs**;
    - **nylon washers** (handle sockets);
    - **Dual Lock**;
    - **oak edge banding** (seat back, signs);
    - **sealant / polysulfide**;
    - **contact cement**;
    - 12 **batten screws** (step 19).
11. **Unorderable BOM lines.** Resolve every "(length per joint note)" line:
    - 12 grab-board 1/4-20 button heads (≈ 1-3/4");
    - 4 hanger 1/4-20 bolts;
    - 4 roll-pad #10 screws;
    - the stop-block screws.
    
    Also delete the 2 phantom thumb knobs (`brake-snap` is typed `knob`) and count 3 thrust-disc screws.

## SHOULD
- **Panel glue-ups** aren't scheduled. The oak plan has `glueUps` (transom 3 boards, bulkhead 2, tongue 2, each knee 2), but neither the cut list CSV nor step 1 says so. Add a step 1 sub-step with an edge-joint allowance: three 5.5" pieces leave nothing to joint for the 16.375" transom. The transom note still says "two boards".
- **Handle-socket nut access.** The box aft wall sits on the backer plane (`rearLane` 0.75), and step 24 (sockets) comes after step 18 (box). Either epoxy T-nuts or inserts into the backers at step 11, or fit the sockets before the box.
- **Underside work after the flip:** the seat stop-block screws "from below" (step 20) and the chain-joist eye-bolt hole (step 14, drilled fore-aft between the joists). Pre-drill the chain joist in step 6, or say "tip the hull on its side".
- **Assembly cradle.** Step 9 says "stand both sides inverted in the jig", but there is no jig drawing or description. The inverted sides rest on a concave sheer, so give simple MDF station cradles at 3–4 stations with the inside width at each.
- **Angled joist ends.** Joists 5–8 and the king beam meet the bent rails at up to 13°. Say that the cut list lengths are long-point (or centerline) and that the ends are scribed at the frame dry fit.
- **Zip has no build book.** The download contains no steps, finishing, verify list, oak board plan or nesting drawing; step 2 says "nest per the nesting drawing". Add `build-book.html` (or .txt) and `nesting.svg`, or have the README say "print these from the Build tab".
- **Cut list "Step" column** uses model steps (3, 4.2, 4.6). Print assembly step numbers (0–27) so a part maps to its step.
- **Grouped rows are labeled by the first member**, e.g. "Crossmember 2 ×3" (joists 2–4) and "rear left axle clamp plate ×4" (which includes front FL2/FR2). List the ids instead.
- **Verify list:** add "measure the real 4 mm and 12 mm sheet thickness and set `deckPlyIn` / `panelPlyIn` before any dado is cut". The 0.512" deck dado leaves 0.04" over the nominal 0.472", and BS 1088 12 mm runs to 0.49" or more before the seal coat. Also move the strip bend test to "before ordering", since it decides 2 vs 3 plies.
- **Glue epoxy basis** (spot check 13): estimate from glue areas and fillet lengths so a change of kit size is honest.
- **Oak overbuy:** 4/4 board #3 carries one 1.25" lane, and the two 5/4 strip boards use 3.1" of 6". Prefer one 8" 4/4 and one 7" 5/4, or show the per-board utilization so Eric can pick at the yard.

## NIT
- Verify `brake-knee` says "the other three knees"; there are two.
- Step 1 "brake shoes (3")" and "chocks (3.5")": those are widths, not stock thickness.
- Rows named "Left …" carry qty 2 (L and R).
- Gaskets: 4 pieces in the BOM vs "continuous, spliced at one corner" in step 27.
- Step 19 "plugged screws from the top" through a 4 mm panel can't be plugged; say countersunk and filled, or screw from below.
- The `transom-backer` note still says carriage bolts; the sockets use button heads.
- Step 18 fairs the box floor with microballoons, which is soft under cargo; use silica or graphite, or note the varnish over it.

## What is good
- The step text is concise, specific and shop-literate. Cure blocks carry real West System pot, clamp and winter times. Rehearsal, vent holes, one-end-first, drill stops and the "day before" pre-steps are exactly what a builder needs.
- Fastener expansion from joints is mostly exact (the bolt, nut, washer, insert and Domino counts all tie out). Board-thickness assignment and the 1/8" allowance are consistent throughout.
- The oak board plan, lane layout and resaw yield table are genuinely useful at the lumber yard. Prices are plausible for 2026 US retail (about $2.5k total, 85 % estimates and marked so).
- The Shaper files follow the agreed conventions, with pockets for every dado and mortise. Forms carry the check square, the params stamp and tiling.
- The verify checklist covers all nine Phase 3 items with pass/fail values, param keys and what to do if each fails.
