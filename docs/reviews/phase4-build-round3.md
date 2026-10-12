# Phase 4 build package: buildability critic, round 3 (final; 2026-10-12, commit 7d799e4)

**Question:** could Eric and two shop-literate helpers build the sled from these outputs alone?
**Grade: 8/10** (rounds 1 → 3: 6 → 7 → 8). Yes, with minor questions. All three round-2 MUSTs are fixed, and I found no regressions in the sequence. One small text MUST remains: step 1's lane count omits the spare lane that the bend test relies on. The rest is polish.

Reviewed: the re-dumped `pkg/` (`build-book.html`, CSVs, JSON, `shaper/`, `forms/` (44 tiles), `nesting/`) and the Round 3 notes. I checked the stop-block pilots against the model geometry with a scratch script in the scratchpad; no repo file was touched.

## Round-2 MUSTs
| # | Status | Evidence |
|---|---|---|
| A. Knees glued onto varnish | **Fixed** | `brake-knees` is now step 15, inverted, between the front beam and gear-fit: "epoxied to the bare rail and chine outer face … finished in place with the underside". Nylocks go on while the backer is reachable, and the one-knee test comes first. Step 17 finish-under lists "the brake knees and their backers". |
| B. Step 1 "16/4" | **Fixed** | "brake shoes (5/4), chocks (12/4)". The cut list has shoe 0.923 × 3 × 3.208 (5/4) and chock 2.5 × 3.5 × 4.702 (12/4). The book has no "Data warnings". |
| C. Band yield depended on cut order | **Fixed** (arithmetic), **text gap → MUST 1** | Rip-first is prescribed. Bands use 4/4 × 9": 4 × 1.625 + 1.113 + 4 × 0.125 = 8.113 ≤ 9, giving 5 lanes × 2 slabs = 10 strips (2 spare). Rails use 5/4 × 10": 3 × 3.125 + 2 × 0.125 = 9.625 ≤ 10, giving 6 (2 spare). Thickness: 2 × 0.359 + 0.125 = 0.843 ≤ 0.875; 2 × 0.5 + 0.125 = 1.125 ≤ 1.125 (5/4 usable; zero margin, see NIT). |

## Round-2 SHOULDs
1. Cut list grain and step columns. **Fixed.** Grain reads "along L"; the "Assembly step" column has 11 (transom), 6 (joists), 20 / 21 (box and lid), matching the step numbers.
2. Web net vs blank. **Fixed.**
   - Step 2: "cut NET 59.49" from the file; blank 59.59".
   - Step 9 repeats it, and the cut-list note says "cut net 59.49"; blank 59.59" (+0.1" trim, S1)".
   - `side-form.svg` reads "web length 59.49".
3. Handle-socket screws. **Fixed.** Steps 25 and 28 and the BOM all say 1/4-20 × 1-1/4. The stack is 0.06 + 0.13 + 0.5 + 0.75 = 1.44, so the tip stops 0.19 short of the backer face. That matters because the socket (y 9.375) sits inside the box footprint (half-width 9.72) and the box aft wall is at the backer face.
   - New detail: the notes claim "0.56 in of T-nut engaged". Actual engagement is the T-nut barrel length − 0.19, about 0.19" (4 threads) for a common 3/8" barrel (SHOULD 2).
4. Chine screws. **Fixed.** #6 × 3-1/2 (3" zone, 4 a side) and #6 × 2-1/2 (1.8" zone, 1 a side), piloted, between the Dominos. That gives about 0.4–0.7" of bite. The BOM has 8 + 2.
5. 207. **Fixed.** 1 qt (the BOM has 2 pt). Resin 110.25 of the kit's 128 fl oz: OK.
   - Still open: the finishing buy list (and the book) still lists "105 epoxy resin 1 qt + 1 pt" with no "covered by the gallon kit" note (SHOULD 1).
6. Hang support. **Fixed.** "roll it onto its side on a padded blanket … or flip it onto padded horses … and flip it back onto the wheels".
7. Stop-block pilots. **Fixed and verified against the model.**
   - Pilots are 17.55" and 18.54" forward of the transom outer face (model x = 7.55 and 8.54), 7.38" off the centerline.
   - They clear joist-2 (x ≤ 5.67) and the seat-hinge backer pads (x ≥ 9.00), and land inside the stop block (box fore end at x 7.05).
   - A #8 × 1-1/4 through the 0.472" deck gives about 0.78" of bite. Screws are driven with the sled on its side, and the flip step leaves the blocks ≥ 4" clear for a stubby driver.

## Spot checks (new)
- Step order: step 15 knees (4.6) → 16 gear-fit → 17 finish-under → 18 flip → … → 27 finish → 28 hang. This is feasible.
  - Nothing is glued to a finished face. The brake-flap pivot bore is drilled after the finish and sealed with a brush of epoxy (step 24).
- Verify `brake-knee` now says "cut the other only when it passes" (the round-1 "three knees" nit is fixed).
- Lumber 49 bf, $614.50; total $2,696.56, 86 % estimates. Plausible.

## MUST
1. **Step 1 lane count leaves out the spare lane.** The step says "rip 4 lanes in all (3 × 1.625", 1 × 1.113")" for the bands and "rip 2 lanes in all (2 × 3.125")" for the rails, then "it yields 10 / 6 strips". As written that gives 8 and 4 strips with **no spares**, and step 2's bend test "cut from the planned spares" depends on them.
   - Fix: quote the spare lanes, e.g. "rip 5 lanes: 4 × 1.625" + 1 × 1.113" (the 4th wide lane is the 2 spares)" and "3 lanes of 3.125" (the 3rd is the 2 spares)".
   - The spare lanes are in `cutList().resaw` (`stripSlots` − `strips`); only the lane text is wrong.

## SHOULD
1. **Finishing buy list:** mark the "105 resin 1 qt + 1 pt" lines "covered by the BOM's gallon kit" (in the book too), so nobody buys about $80 of resin twice.
2. **T-nut engagement.**
   - Specify a 1/4-20 316 T-nut with a ≥ 3/8" barrel, or a 1/2"-long epoxied insert.
   - Correct the "0.56 in engaged" note to barrel − 0.19.
   - Have the transom step check that a dry screw reaches at least 3 threads into the barrel.
3. **Rough-width margin:** the 9" and 10" strip boards keep only 0.89" and 0.375" for straight-lining an edge. Say "a 10" board must measure 10" after the first jointed edge, or buy 11"".

## NIT
- Step 16 says "2 a block, in line across the sled"; the two pilots are in line fore-aft (same 7.38" offset, 1" apart).
- Step 15 says "nylock nuts … in 1/2" counterbores in the backer (deck underside, facing up)". The counterbores are on the backer's inboard face; say "inboard face of the backer".
- 5/4 resaw has zero thickness margin (2 × 0.5 + 0.125 = 1.125 usable). Ask for full 1-1/4" or thicker rough 5/4.
- Unchanged from earlier rounds:
  - verify items are numbered 1–5, 7, 10, then 6, 8, 9, 11, 12;
  - step 3's cure block is labeled 105/206;
  - step 4 says "Mortise the rail tops: … 5×30 ×14" (the 5×30s go in the inner faces);
  - step 17 repeats "Offcut test first";
  - step 21 says "plugged stainless screws" through 4 mm;
  - step 24 says "bandsawn from 3" stock" for the 5/4 shoe;
  - the BOM has 4 gasket pieces where the steps call for one spliced run.

## What is good
- The build sequence is now physically sound end to end:
  - the bent-lam frame and sides;
  - mortises after the trim;
  - the knees glued to bare wood while the hull is inverted;
  - running gear fitted, drilled, tagged and removed;
  - the underside finished before the flip;
  - topside finish, then hang;
  - a support method for every under-hull job.
- The stock plan is correct and shop-real: rip-first lanes, honest spares, edge-glued panels scheduled, the near-empty board folded away, and a yard-ready board list with lane plans.
- The BOM can be ordered line by line. Every fastener has a size and length, and the epoxy is sized by joint type with correct 5:1 and 3:1 ratios and pumps.
- The build book is a complete offline shop document. The Shaper files and forms agree with the cut list to 0.02".
