# Phase 4 review, round 2: Shaper SVGs, forms/tiling, STL, zip (commit 0f631ee)

Grade: **8/10.** All five round-1 MUSTs are fixed and verified. There are no new MUSTs. What is left is polish, plus one honest unknown (how Origin treats `<text>`) that one test import will settle.
Method: re-parsed the 12 Shaper SVGs, 4 forms and 52 tiles with my Python scripts; rendered tiles and files in Chrome; read the model through vitest; rebuilt the STL and zip checks.

## Round-1 MUSTs: verification
1. **Lid size: fixed.** `storage-lid.svg` is 18.75 x 14.7961, equal to the stock (18.75 x 14.796). The legend ink is centered on the panel, 9.375 vs 9.375 and 7.398 vs 7.398 (was 0.1 in off). A dashed guide "visible panel (inside the rabbets)" marks 0.25..18.5 x 0.25..14.546.
2. **Web tongue: fixed.** Web mesh x-range is -9.75..49.5 (it matches the deck: -9.75..49.5, and the transom and bulkhead dado bottoms). `side-web.svg` is 59.49 (stock 59.5904 = net + the 0.1 trim; the doc says so). The transom and bulkhead pocket geometry is unchanged.
3. **Print tiles: fixed.** No tile contains a `#000000`, `#7F7F7F` or `#FFFFFF` fill (0 of 52). The cut is a 0.02 in black outline and the guides stay blue. `side-form-B3` renders as line art. All 52 tiles are `8.5in x 11in` with a window viewBox equal to its size (1:1). The check square is 1.0000 in on every form and renders at 97 px (1.01 in at 96 dpi).
4. **Deep cut: fixed.** `bow-bulkhead.svg` outline and hand hole are `shaper:cutDepth="1in"`, labeled "DEEP CUT (bandsaw, then flush-trim bit)" in the path `<title>`, the features and the desc. Everything else is at most 0.895 in.
5. **Insert label: fixed.** The panel reads "Blind insert hole O0.3125 x 0.344 deep" (was O0.19). The 5/16 in drill is the model's `INSERT_DRILL_IN`, flagged VERIFY. Edge distance (0.6 in) and the 0.1875 in web between holes (0.5 in apart) are fine.

## Checks re-run (all pass)
- Root: `width`/`height` in inches match the viewBox in all 12 files. The outline bounding box equals the stock for every part (w x l) except the web (documented). Sizes: bulkhead 18.5 x 7.15, deck 59.25 x 23.093, grab board 8 x 5.5 (own frame, was 8.83 x 6.9), seat back 16 x 16, sign 12.45 x 4.583, flap 17.848 x 3.
- Conventions unchanged: black/no stroke, white/black stroke, `#7F7F7F`, blue stroke guides. All outside, inside and pocket paths are closed.
- Holes: 0.266 (x4 transom, x6 per grab board), 0.4063 (seat back x2 and the new deck holes). All inside outlines; thinnest wall 0.37 in.
- Pockets unchanged (0.197 and 0.512 wide x 1/4 deep, mortise 0.25 x 0.875 x 0.375). The thinnest wall is still the mortise floor at exactly 1/8.
- **Deck pin holes:** two 0.406 holes at (21.25, 4.17) and (21.25, 18.92). That is x = 11.5 and y = +-7.375 on the model, which is the hinge axis (x 9.5) + 2 in and the pin station. Correct.
- **Bits:** the 0.197 dado and the 0.25 mortise are 1/8 in; the 0.266 holes are 1/8 in; the 0.406 holes are 1/4 in; the engraving is "1/8 in straight bit, on-line".
- **Cut face in words:** transom "FORWARD (bow-side) face UP"; bulkhead "REAR (stern-side) face UP"; lid "TOP face UP"; shared L/R files "either face can go up". 
- STL: size = 84 + 50n, n = 68 for both. Every edge is shared by exactly 2 triangles. Volumes are 165610 and 103506 mm3 (positive: outward). Zip: `zipfile.testzip()` and `unzip -t` pass; the UTF-8 flag, zero-length entry and 300 kB entry are right.

## `<text>` in `<g shaper:cutType="guide">`: is it safe?
In all 12 Shaper files, 0 text elements sit outside `<g id="tags|annotations" shaper:cutType="guide" fill="none" stroke="#0068FF" stroke-width="0.005">`. The text itself has no fill. `annotations` start below the part (y >= H + 0.3). `tags` are inside the part, next to the feature they describe.
- If Origin ignores `<text>` (what I believe), nothing changes.
- If an importer converts glyphs to paths, they become blue-stroked, unfilled paths, which is exactly a guide. Nothing becomes an outside cut, a pocket or an inside cut. This is the right worst-case design.
- Unsure: whether Origin honors a group-level `shaper:cutType`/stroke (it does not need to; the stroke alone classifies) and whether hundreds of tiny glyph guides clutter the screen. Test with one import of `transom-rear.svg` and check that only the expected items show.

## SHOULD
- **The forms are not covered.** `forms/*.svg` (also cut files: rail form, templates, ramp) still have 9-31 `<text>` elements with `fill="#0068FF"` and no stroke, inside plain `<g id="guides|titleblock|rampdims">`. A filled blue glyph is not a guide. Apply the same stroke-only guide group (`annotations`) there, or move the text to an annotated copy.
- **Blank tile pages remain.** The count is still 52 (side 27, rail 14, crown 8, flap 3). The "skip empty pages" rule never triggers because vertical S-station lines and horizontal chine lines cross every tile. `side-form-A9` is a dashed line and one label; `B3` is four lines. Skip pages whose only content is a straight guide or a label, or draw those guides short. Better, as said in round 1: cut the cleat holes and sheer score on the Shaper instead of printing a 27-page layout.
- **README is stale.** It still says "bow bulkhead is cut from its REAR face, so it is mirrored", lists no per-feature bit, no DEEP CUT rule, no "text is annotation only", and no 5/16 in insert drill "verify". `SHAPER_NOTES` (`package.ts`) should carry these four lines.
- **The tag text inside the part is hairline.** At 0.005 in stroke, 0.11 in size, stroke-only text is hard to read on a screen preview. Not a cut problem; consider 0.008 for readability.
- **Mortise floor** (0.125 in of a 0.5 in transom) is still at the limit. Left open knowingly (the geometry notes list it).

## NIT
- The tile footer ("page 12 of 27 ... print at 100%, no scaling") runs off the right edge of the page. Shorten it or wrap it into two lines.
- Tiles now carry two crosses per corner (window edge and overlap end). They align between neighbors, as intended; it looks busy.
- The lid grain arrow passes through its "GRAIN along the 18.75"" label.
- The ramp-rib text says "level to the bow end at 59.24 in", which is the band end; the web template is 59.49. True, but confusing; add "(web ends 59.49, tongue)".
- The deck file says "either face can go up" although the two 13/32 holes are drilled with the pad in place; fine, but say so in the file.
- Facets of 15 degrees on rounded corners (0.021 in sag at the 2.5 in radius): unchanged and acceptable.
- Sign is still a plain rectangle, now stated in the note and awaiting Eric's call.
