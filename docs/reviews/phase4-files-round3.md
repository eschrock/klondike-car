# Phase 4 review, round 3: Shaper SVGs, forms/tiling, STL, zip (commit 7d799e4)

Grade: **8.5/10. No MUSTs.** Nothing regressed. Every round-2 SHOULD that was about the files is addressed. What is left is a short list of NITs and the one test import that only a real Shaper can do.

## Regression re-run (all pass)
- **Shaper files (12):** `width`/`height` in inches still match the viewBox. No cut path is open. The fill/stroke conventions are unchanged.
- **Stock match:** every outline equals its stock (w x l) except the web (59.49 net vs 59.59 stock, as documented). Lid 18.75 x 14.796, seat back 16 x 16, grab board 8 x 5.5, bulkhead 18.5 x 7.15, deck 59.25 x 23.093.
- **Depths:** bulkhead outline and hand hole 1 in (DEEP CUT); all others thickness + 0.02.
- **Features unchanged:**
  - Pockets: 0.197 and 0.512 wide x 0.25 deep; mortise 0.25 x 0.875 x 0.375.
  - Holes: 0.266 (transom x4, grab board x6 each), 0.406 (seat back x2, deck x2).
  - Hand holes: 4.5 x 1.25 and 4.5 x 1.5.
- **STL:** size = 84 + 50n, n = 68 for both clips. Every edge is shared by exactly 2 triangles. Volumes 165610 and 103506 mm3 (positive: outward). Identical to rounds 1 and 2.
- **Zip:** `zipfile.testzip()` and `unzip -t` pass. The UTF-8 flag is set, the zero-length entry and a 300 kB entry are right.
- **Tiles (44):** all are 8.5 x 11 in with a window viewBox equal to its size (1:1). No tile has a solid fill. The check square is 1.0000 in in each form. Registration crosses still align between neighbors. The render of `side-form-B3` is clean line art.

## Round-2 SHOULDs
| SHOULD | Status |
|---|---|
| Forms' `<text>` filled and unguarded | **Fixed.** All 4 forms: 0 text elements outside a guide group, 0 with a fill. |
| Blank tile pages | **Mostly fixed.** 52 -> 44 pages: side 27 -> 20 (A7-A9 and C1-C4 dropped), rail 14, crown 8 -> 7, flap 3. The footers no longer name skipped neighbors (`A6` lists `<-A5 vB6` only). The side form is still 20 pages, many holding a guide line or two (`B3` is four lines and an edge). |
| README / `SHAPER_NOTES` stale | **Fixed.** README lines 18-21 cover the bit per feature, DEEP CUT, annotation-only text and the 5/16 in insert VERIFY. |
| Hairline tag text | Not changed (cosmetic; the text is annotation only). |
| 1/8 in mortise floor | Left at the limit, knowingly (listed in the geometry notes). |
| NIT: footer off the page edge | **Fixed** ("... neighbors: ->B4 <-B2 ^A3" fits, and the title is truncated with an ellipsis). |
| NIT: grain label over its arrow | Reported fixed; I did not re-render the lid. |

## NIT
- The footer is now two lines, and the second ("print at 100%, no scaling; overlay neighbors so the crosses coincide, then trim (14, 9.5) in") sits at the TOP of the page in the margin, above the top crosses. Fine, but it reads as a stray line; keep both lines together at the bottom.
- The two crosses per corner still look busy (they are right).
- 20 side-form pages are still a lot of paper for four straight lines on many of them. The Shaper-cut jig (cleat holes and a sheer score cut straight into the table board) remains the better route, as noted in round 1.
- Facets of 15 degrees on the rounded corners (0.021 in sag at 2.5 in radius): acceptable.
- The sign is still a rectangle; the note asks Eric.

## Still unverifiable from here (one test import)
Whether Origin pre-fills depth from `shaper:cutDepth="...in"`, the exact guide blue and pocket gray values, and what it does with `<text>` in a group marked `shaper:cutType="guide"` (the worst case is blue-stroked guides, never a cut). Import `transom-rear.svg` and `bow-bulkhead.svg` first, then do a test cut on offcut before the good ply and oak.
