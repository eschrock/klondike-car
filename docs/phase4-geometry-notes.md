# Phase 4 geometry exports: notes (shaper-svg, forms, stl)

Files: `src/build/shaper-svg.ts`, `forms.ts`, `stl.ts`, `svg-util.ts` (+ tests). Pure functions of `(parts, params)`; no model edits and no new model exports were needed.

## Conventions
- Real inches: `width="…in" height="…in"`, viewBox in inches (1 unit = 1 in), `xmlns:shaper` declared. A Shaper file is exactly as wide and tall as the flat pattern; the title text sits inside the part, the edge-joint notes below it (outside the viewBox, `overflow="visible"`) and in `<desc>`.
- outside = `#000` fill, no stroke; inside = white fill + black stroke; pocket = `#7F7F7F`; guide = `#0068FF` stroke, no fill; engraving = `online`, stroke only. Every path has `shaper:cutDepth`: thickness + `BREAKTHROUGH_IN` (0.02) for outside/inside, the joint depth for pockets, `legend.depthIn` for engraving, 0 for guides.
- Y is flipped (SVG down). The part is drawn as seen from the face being cut: the face carrying the pockets (the bulkhead's REAR face, so it is mirrored in u), or the legend face (lid top), else the pattern's plain view.
- Files group by `partNo`. Identical drawings share a file (`qty` 2: signs, grab boards, side webs, storage sides/ends); drawings that differ (the L/R brake flaps: cord eye inboard) get one file per part id.
- Forms: sheet = content + 1.3 in margins + title block (name, 1:1, units, params revision = a hash of the params, never the clock; `opts.date` is shown if the caller passes one), key dims as text + dimension lines, 1 in check square. The cut outline is an outside cut, dimensions are guides. The params have no date field, hence the hash.
- `tileForLetter`: 7.5 x 10 in windows, 0.5 in overlap, labels A1, A2 … (row letter, column number), corner registration crosses, dashed overlap lines, neighbor names, a 1 in check square per page.
- STL: binary, mm, local frame (outline in XY, extruded along +Z), ear clipping with hole bridging, outward winding, stored normals = edge cross products. The clips have no holes.

## Joint to feature rules (R1 to R8 are in the header of `shaper-svg.ts`)
- Geometry holes are inside cuts, or drill marks under `DRILL_BELOW_IN` (0.25 in; the 1/8 in transom vents).
- Through fasteners: hole at each `at`. #10 = 0.2, 1/4 bolt = 0.266, pin = `diaIn` + 1/32 (13/32), "N/M clearance" text otherwise. Under 0.25 in = drill mark (blue), else inside cut.
- Blind holes (inserts) and pilots ("screws down/up through X into the tongue") are drill marks; a mark on the uncut face is dashed.
- A clevis pin without "clearance hole" (flap pivot) = cross hole: guide line + note. A screw eye in an end face = tick + note.
- A point outside the outline, or closer to an edge than its own "1/2 in from every edge" rule, is a dashed guide + note, never a cut.
- Dado or mortise whose `at` is on a face (more than 20% of the thickness from mid-thickness) = pocket. Web dado: the web's lateral station and its z range at the end x (from the mesh). Deck dado: the deck's width at its end. Mortise: thin across model Y. Edge (mid-thickness) dados/rabbets, glue, bevels = notes. Glue to lumber/sheet mates = dashed footprint guides.
- Inbound fasteners that the part's own joints do not list (handle-socket bolts, brake cord eyes into the transom) are read from the other part's joints through the model frame.
- Scupper nipples (glue joint with a hole) = a drain drill mark: the hole goes through the glued-up sandwich.

## Feature counts at the defaults (13 files, 17 parts)
deck: outline only (guides: 8 crossmember footprints incl. the chain joist and king beam, 2 rails). bow-bulkhead (after D-69, 18.5 x 7.15): 1 hand hole, 3 dados (2 web 0.197 x 1/4, deck 0.512 x 1/4); its rail joints are now Dominos (edge notes), so no mortises. side-web x2: 2 drain drills. transom-rear: 1 hand hole, 4 vent drills, 3 dados, 2 mortises, 4 socket bolt holes (0.266), 2 eye pilots. sign x2: 4 drill marks (#10). seat-back-panel: 2 pin holes (13/32), 6 insert marks (guides). seat-grip x2: hand hole + 6 bolt holes. storage-side x2, storage-end x2: outline, bevel notes. storage-lid: outline + 12 engraving strokes ("DO NOT STEP"). brake-flap L, R: outline, 5 pilot marks, cross-hole guide, eye tick.

## Not placed with confidence
- Seat-back hinge inserts (6): `at` is on the hinge axis, v = 0.02 in at the foot edge and u within 0.3 in of the side edge. Guides only; set them from the hinge leaf.
- Flap pivot pin and eye: edge holes, drilled in place; flap pilots are marks to drill through the template.
- Insert and pilot depths are in the labels only.

## Model data that looks wrong
- Deck dado (closed end) and the web stopped dado in the transom and bulkhead leave 0.04 in of oak between them (both parts).
- Bulkhead (D-69): the web stopped dado comes within 0.02 in of the outline.
- Transom: the web's stopped dado (z 7.53 to 21.88) pokes about 0.015 in through the transom's rounded top corner at u = 23.8.
- Grab-board `Joint.at` is in the MODEL frame; every other part's is local (handled by trying both).
- Seat-back-panel: `grain: 'z'` is its thickness axis (no grain arrow); pin `at` z = -0.13 is outside the 0.472 thickness; the inserts are at the edge (above).
- Sign knob text: "3/16 clearance hole" for a #10-32 screw (0.19 major): the hole is smaller than the screw; drawn 0.2.
- Brake flap: block screw `at` z = 0.84 to 0.91 (above the 0.875 thickness, varying with u); screw eye `at` z = 1.15 is outside the flap; block screw at u = 16.83 nearly meets the pivot cross hole at u = 17.09 (Ø0.406).
- `HULL_STEP` comment in build-utils.ts still says a 1.25 in x 14 in S-ramp; derived: rise 2.75 in, S 22.5 in along the web, 29.5 in with the level run to the bulkhead (body.ts note says 2.75 x 22).

## Model fixes (Phase 4)
Mass before and after: 115.4913 lb, 115.4913 lb (delta 0; every fix is data or text). No analysis input changed except the seat-back hinges moving inboard 0.475 in (0.1 lb each, symmetric, no analysis reads them). Test: `src/model/phase4-fixes.test.ts`.
1. **Grab boards:** `Joint.at` is local now (mid-thickness, `bt/2`); the "try both frames" fallback is gone from `shaper-svg.ts` and a test asserts no joint point of any Shaper part falls off its pattern.
2. **Seat-back panel:** `grain: 'y'` (up the panel: the panel bends as a strip above the crest line, so the face plies carry it, and the 16 in square blank can turn on the sheet). Pin `at` z = 0.236 (mid-thickness). The inserts are at the real hinge-leaf holes: leaf centerline 0.5625 in up from the axis, 3 holes 0.5 in apart on a 2 in knuckle, front-face mouths. The old 2 in hinge centered on the pin station (7.375) stuck out of the 16 in panel by 3/8 in, so the hinges now sit 6.9 in off the center line (outer insert 0.6 in from the side edge; `HINGE_*` / `INSERT_EDGE_IN` in seat.ts); the pins stay at 7.375. The hinge's own leaf points match them. The shaper draws them as blue drill marks with an "insert hole x 0.344 deep (x3)" label. Also fixed the Dual Lock glue point (z was 0.94 on a 0.47 panel).
3. **Brake flaps:** all flap `at` points are explicit now (the world-box fallback put sloped parts outside themselves): pin z 0.75, glue and screws on the top face, shoe screws on the underside (they were at z -0.17), cord eye in the end face at mid-thickness, 0.7 in inboard. Block screws sit behind the pin (the nose end is only 0.75 in) in a zig-zag across the 1.25 in tongue, 0.375 in of oak from the cross-hole edge to the screw body (`pivotBlockScrewPoints`, brake-layout.ts). The block's and shoe's copies are derived from the same points.
4. **Sign knobs:** "7/32 clearance hole (0.219)" in the joint text; the shaper now lets an explicit "N/M clearance" beat the screw gauge, so the drill mark is 0.219.
5. **Dados:** the deck dado now runs into the web dado at both corners of the transom and bulkhead (the shaper extends it across the web pocket: one continuous pocket, no 0.04 in wall). The web dados now run out through the top edge instead of stopping short: the web top ends within 0.02 in of the rounded corner, so a stopped dado needed 1/8 in of wood, a matching relief notch on the web and a re-flatten of the web pattern; open at the top it is one plain cut, needs no relief, vents itself and is filled by the epoxy fillet. The pocket is drawn 0.03 in past the outline there. Mass credit unchanged (about 1e-4 lb).
6. **Stale text:** HULL_STEP and the side-assembly note point at `src/build/forms.ts` (rise and length come from `L.taper`, no numbers). No 2 x 4, scarf, Aircraft Spruce or 6 mm seat back text was left in the model (D-68 had caught it); fixed "6 mm" in three storage comments and the seat comment.
7. **BOM:** Consumables use `finishingSchedule().buy` plus glue epoxy (115 joints x 0.12 fl oz +20 %): 78 fl oz mixed, cheapest kits = one 105-B + 206-B gallon group ($265; prices.ts now has quart $92, so three quarts $276) + pumps + a pint of 207. Lumber is whole boards (nesting list, prices x board feet): 10 / 12.5 / 4.5 / 8 / 24 bf at 4/4 to 12/4. Bucket under 1 bf (6/4 solids, 0.6 bf) is cut from 12/4 offcuts (`OakPlan.consolidated`, `SMALL_BUCKET_BF`). Resaw yield used the surfaced thickness of the board; a resaw is cut from the rough board, so `resawUsableIn` = nominal - milling allowance: rails now 2 x 5/4 (7.5 bf, was 1 x 12/4, 9 bf), the 8 bands 1 x 6/4 (was 8/4). Board plan prefers a tight lane before sharing a wide one (5/4 board 10 ft to 8 ft).
BOM total $2,667.46 (86 % estimates): Lumber $814.00, Plywood $265.00, Metal $109.06, Purchased $609.00, Fasteners $241.60, Consumables $628.80. The allowance pricing of the same oak was $494.29.
