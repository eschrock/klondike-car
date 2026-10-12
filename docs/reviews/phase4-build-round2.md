# Phase 4 build package: buildability critic, round 2 (2026-10-12, commit 0f631ee)

**Question:** could Eric and two shop-literate helpers build the sled from these outputs alone?
**Grade: 7/10** (round 1: 6/10). This is a large improvement:
- the order now runs fit, drill and remove; finish the underside; flip; finish; hang;
- stain comes before seal;
- the BOM can be ordered;
- the build book is complete and printable.

Three MUSTs remain, and all are small. One is a sequence bug that the finish-under change introduced. With them fixed this is an 8.

Reviewed: the re-dumped `pkg/` (README, `build-book.html`, the CSVs, the JSON files, `shaper/`, `forms/`, `nesting/`) and the Round 2 notes.

## Round-1 MUSTs
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Finish before hardware | **Fixed, but caused new MUST A** | Steps 13–15 fit, drill, then remove; 16 finish-under; 27 finish; 28 hang. Step 27 says "No hardware is on the sled". Tongue finished in place (D-65). |
| 2 | Stain vs seal | Fixed | Step 3 seals only dados, edges and hidden faces; show faces stay bare. Finishing: stain → 105/207 → varnish. |
| 3 | Rail end mortises cut, then trimmed off | Fixed | Step 4: "Do NOT cut the end mortises yet". Step 9 trims with a flush-cut saw or multi-tool, then cuts the mortises. |
| 4 | Brake backers | Fixed | Step 6 glues them and drills the knee-bolt holes; cut list Step = 3. |
| 5 | Chine Domino tie | Fixed | Step 8: 9 a side, 4×20, vertical, on the glue line, marked from the rail. |
| 6 | Stale S-ramp, rail form | Fixed | Step 2: rise 2.75", 29.5", 3 ribs; rail form 4 layers (3"). One term per form. |
| 7 | Bulkhead grain | **Mostly fixed** | SVG: "grain along the 18.5" length". The cut list Grain column is still x/y/z, now local axes, which is meaningless at the bench (SHOULD 1). |
| 8 | Sizes disagree | **Mostly fixed** | Lid 18.75 × 14.796, grab board 8 × 5.5, seat back 16: all agree. Web: SVG cuts net **59.49**, while the cut list and step 2 ("cut to … 59.59") give the blank. `side-form.svg` still says "bow end at 59.24" (SHOULD 2). |
| 9 | Resaw text | Fixed for bands and rails, **new error, MUST B** | Bands from 4/4 × 8", rails from 8/4 × 7": the text matches the plan. |
| 10 | BOM gaps | Fixed | 209, 303 and 301 pumps, 3:1, collars, 5/32 cotters, end plugs, #10-32 × 3/8, 3/8 rods, #8 × 3-1/2 chine screws, button plugs, nylon washers, Dual Lock, banding, polysulfide, contact cement, #6 batten screws. |
| 11 | Unorderable lines | Fixed | No "(per joint note)" lines left. Thumb knobs 8. Hanger bolts 1/4 × 2-1/4; roll pad #10 × 1; T-nuts 4. |

## Spot checks
1. **Band resaw, 4/4 × 8" × 6 ft, claimed 9 strips.**
   - Thickness: 2 × 0.359 + 0.125 = 0.843 ≤ 0.875 usable. OK, 2 slabs.
   - Width, if each full-width slab is ripped on its own (what `packLayers` / `spareSlots` model):
     - slab 1: 4 × 1.625 + 3 × 0.125 = 6.875;
     - slab 2: 2 × 1.625 + 2 × 1.113 + 3 × 0.125 = 5.851, plus a kerf and a 1.625 spare = 7.60 ≤ 8;
     - total 9, so the claim holds.
   - **If the board is ripped into lanes first and each lane resawn** (the usual way, and the only way on a bandsaw with less than 8" resaw height), the lanes are shared by both slabs: 4 × 1.625 + 3 × 0.125 = 6.875, and the 1.0" left over can't take even the 1.113 strip. That gives **8 strips and no spare**, and step 2's bend test uses the spare. → MUST C.
2. **Rail resaw, 8/4 × 7".** 3 × 0.5 + 2 × 0.125 = 1.75 ≤ 1.875, and 2 × 3.125 + 0.125 = 6.375 ≤ 7, so 6 strips with 2 spares. This holds whether lanes or slabs come first; resaw height only 3.125". OK.
3. **Epoxy resin** 110.25 fl oz = glue 61.44 × 5/6 + seal 58.56 × 3/4 + closes 20.17 × 3/4, which is under the kit's 128. OK.
   - **207:** 58.56 / 4 = 14.6 fl oz against a 16 fl oz pint, over two finishing campaigns. Tight (SHOULD 5).
4. 1/4" nylocks 24 = 4 hanger + 8 hold-down + 12 grab; washers 48; T-nuts 4. OK.
5. Hanger bolt: 0.875 + 0.75 + washer + nylock ≈ 2.0, so 2-1/4 is OK. Grab board: 1.31 stack + washer + nut ≈ 1.8, so 2" is OK.
6. **Handle-socket screws.** Steps 25 and 28 say **1/4-20 × 2**; the BOM and the joint say **× 1-3/4**. The stack is 0.13 + 0.06 + 0.5 + 0.75 = 1.44, so the screw tip stands 0.31" (or 0.56") past the backer face. That is the plane where the box aft wall sits (`rearLane`) (SHOULD 3).
7. **Step 1:** "brake shoes (**16/4**), chocks (**16/4**)", while the cut list says shoes 5/4 and chocks 12/4. Nothing 16/4 is bought; the book's "Data warnings" show the model's rough T × W is transposed. → MUST B.
8. **Lumber** 49.25 bf, $635 (was 55.25, $684); the near-empty 4/4 board is gone. Total $2,679. Plausible.
9. **Chine screws** #8 × 3-1/2 through the rail. The rail is 3" deep aft but 1.8" deep forward of x = 37.7, so a screw there runs about 1.6" into a 0.39" edge whose oak band is only 1.5" tall. A #8 centered on the band/ply line leaves about 0.11" a side (SHOULD 4).

## MUST fix
- **A. Knees glued onto finished wood.** Step 16 (finish-under) stains, seals and varnishes the rails and the outside of the sides. Step 23, after the flip, then "epoxy[s] … the leg against the rail and chine outer face" and puts nylocks in counterbores in the backer under the deck. Epoxy won't bond to varnish, and the nuts are now under an upright hull. Fix:
  - Move step 23 (knees; they "stay bolted on for finishing") before step 16, while the hull is inverted.
  - Run the verify `brake-knee` one-knee test before that.
  - Or, at minimum, mask the knee footprints in step 16.
- **B. Step 1 bandsaw-blank stock.** Read the board from the cut list's (corrected) board column, not from the raw `rough.t`. Better still, fix the transposed `rough` on `brake-shoe` / `brake-chock` in the model, so the data warnings disappear.
- **C. Band-strip yield depends on the cut order.** Either:
  - state in steps 1–2 and on the board list: "resaw the full 8" width into two slabs FIRST (needs ≥ 8" resaw height), then rip each slab: 4 wide strips from one, 2 wide + 2 narrow + 1 spare wide from the other"; or
  - plan with shared lanes (rip first) and buy 4/4 × 10" (5 lanes give 10 strips).
  
  Also make `spareSlots` model the method the steps tell the builder to use.

## SHOULD
1. Cut list (CSV and book): show grain as "along L" or "along W", and print assembly step numbers (0–29), not model steps (4.2, 4.6).
2. Web: step 2 should say the Shaper file cuts **net 59.49** and that the 59.59 blank is for hand-cutting. Otherwise drop the 0.1 (the 1/4" dados absorb the S1 trim). Fix "bow end at 59.24" in `side-form.svg`.
3. Handle screws: make the steps and BOM agree, and use 1-1/2" (tip about 0.06" past the T-nut) or confirm the screws sit outboard of the box aft wall.
4. Chine screws: #6, piloted, with a length per zone (3" rail zone vs 1.8" stepped zone), or "skip the stepped zone".
5. 207: buy 1 qt, since 9 % margin across two campaigns plus pump priming is too thin. The book shows both the finishing buy list (1 qt + 1 pt 105) and the gallon kit that already covers it; say "covered by the kit" on the finishing list.
6. **Hang step support.** Step 28 puts on clamp-plate nuts "under the beam", chain-joist eye-bolt nuts and roll pads under the rails while the hull "stands on its blocks". Say "flip it again onto padded horses (60 lb), hang the gear, flip onto the wheels" or "on its side".
7. Seat stop blocks. Step 15 pre-drills pilots from below with no location given, before the blocks or the box exist. Step 21 still says "screw from below" on the upright hull, while step 15 says they can't be reached. Either give the x/y of the pilots and drive the screws in step 21 with the hull on its side, or screw down through the blocks and plug the holes.

## NIT
- Verify `brake-knee` still says "the other three knees" (there are two).
- The book numbers the verify items 1–5, 7, 10, then 6, 8, 9, 11, 12; renumber by group.
- Step 3's cure block is labeled 105/206 for a 105/207 seal coat.
- Step 4 "Mortise the rail tops: … 5×30 ×14": the 5×30s go in the inner faces.
- Step 16 repeats "Offcut test first", which step 3 already did.
- Step 20 "plugged screws from the top" through 4 mm (round 1, unchanged).
- Gaskets: 4 pieces in the BOM vs one continuous splice (unchanged).

## What is good
- The new order is right in spirit and well explained. The tagged-kit fit, drill and remove routine, finishing the underside while it's accessible, and the T-nuts that remove the blind wrench job are exactly how a careful builder works.
- Every round-1 BOM gap is closed with sized, countable lines, and the epoxy is now sized by joint type with honest arithmetic.
- The build book is genuinely shop-usable. It has the verify list with params, the cut list with ids per group, a yard-ready board list with lane plans, the nesting drawings, and the steps with cure times.
- The Shaper files now state the cut face, the bit and the deep-cut method, and the sizes match the cut list.
