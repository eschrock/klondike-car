# Phase 3c-5 notes: visual fixes and two small structural items

Author: the 3c-5 agent. `DECISIONS.md` and `STATUS.md` are not edited beyond one STATUS line; proposed decision text is at the end. Final state: `npm run typecheck`, `npm test` (40 files, 1,286 tests), `npm run build`, `npm run build:single` green. Nothing committed.

## 1. What was wrong with the sides

**Geometry, not texture.** The curved side members (chine, gunwale, okoume web, rails; `src/model/plan-wall.ts`) are meshes whose faces are the cylinder y = yc(x). The mesh was cut into triangles by **ear clipping**. On a long thin outline (a 58 in chine 1.5 in tall, a rail with a notch) ear clipping makes **fans of skinny triangles that run the whole length of the part**. A triangle that spans 20 in of x while the face bends 1.25 in is a flat chord of a curve, so it:

1. left the curved face (up to a few tenths of an inch: the twisted strips, and the web and chine did not seat in their grooves);
2. had a wrong normal (flat shading per triangle, so each streak was lit differently: the diagonal band across the side);
3. in the viewer, a triangle whose normal tilted far enough was classified by the box mapping (`grainUv.ts`) as an END face (x or z dominant), so it got the end-grain texture instead of the long-grain texture: the streaky grain.

The UVs were fine; the texture mapping only did what the bad triangles told it to.

**Fix (model).** `planWallGeometry` now triangulates with `trapezoidTriangles` (vertical trapezoid decomposition: cut at every outline vertex x, pair the spanning edges in each strip). Every face triangle sits inside one column at most the subdivision length (1.5 in) wide, so it stays on the face to a few thousandths of an inch. Mass, bounds, overlap slabs and joinery are unchanged (the outline, thickness and `yc` are the same); `earClip` is gone.

**Fix (viewer).** (a) Plan-wall meshes use creased normals (`toCreasedNormals`, 40 degrees): smooth along the face, crisp at the 90 degree rims. (b) New optional `Geometry.mesh.grainFollowsTop` (set on the gunwale only): the gunwale is bandsawn to the sheer, so its grain/UVs follow the top edge (u = arc length along the sheer, v = depth under it) and the stripes run along the curve instead of being cut by it. The chine stays straight-grained (a constant band), the web keeps its straight okoume veneer. Tests: `src/model/plan-wall.test.ts` (trapezoids tile the polygon exactly; every face triangle of the real chine, gunwale, webs and rails is at most 1.6 in wide in x and within a few degrees of the face normal; the face areas).

Checked in Iso, Side and Top (light and dark): each side now reads as oak gunwale following the sheer, a flat okoume panel, an oak chine; no diagonal band, no gaps at the transom or the bulkhead.

## 2. Bow crown matches the handlebow

`Layout.bulkhead.zCorner = deck + bowBulkheadHeightIn - handleBowCrownIn`, `zCenter = deck + bowBulkheadHeightIn`: the crown IS `handleBowCrownIn` (7/8 in), so the two arches echo each other and change together. `bowBulkheadHeightIn` is now the PEAK height (center), default **5.75 in** (was 9; min 5): corners 4 7/8 in, a hair above the 4 in side tops, which end against the bulkhead's rear face. 5.75 = 3 in hand clearance + 1.25 in slot + **1.5 in of oak over the hand-hold** (`liftBarMinIn` is 0.75). Validation: error if the peak is under clearance + slot + bar; warning if the corners are lower than the side tops at the bow. Rows (150 / 200 lb): `foot-stop` util 0.08 / 0.10 (unchanged: the 4 in foot band and the 1.25 in slot are the same); `lift` front bar bending 0.05 (was under 0.01 with 4.75 in over the slot; the rear bar, 0.54, still governs the row), shear 0.06. The bulkhead is **7.0 lb (was 9.0)**.

## 3. Sign level

`signPlacement` no longer turns the board to the sheer: the box has no rotation. Its top edge is 3/4 in under the gunwale line at its FORWARD end (where the sheer is lowest, so the whole board is inside the side). The first level board, 15 x 6 with its top at the forward end, put its lower third behind the brake flap that stands out beside the side (the flap's top is 4.7 in over the deck at the hinge), so it could not be read from the side. The placement now scans the forward end (never ahead of x = 6, the hinge and knee) and picks the biggest board that keeps the aspect at 2.2 or more (so `signTexture` keeps its two lines) and has its bottom edge clear of the flap's top surface by 0.3 in: **12.2 x 4.5 in, x = -7.95 to 4.25, 4.66 to 9.15 in over the deck** (it was 15 x 6 tilted). Right-reading on both sides (the viewer's outward-UV rule is unchanged); the sign texture needed no change.

## 4. Front lamp in the bow hand-hold

- **Removed:** `lantern-mount` (the printed bracket over the top of the bulkhead).
- **New `lamp-clip`** (printed ASA, removable, `src/model/lighting.ts`): a stadium plug (outline in y-z, depth along x) that fills the 4.5 x 1.25 in hand-hold less 0.02 in print clearance a side: 4.46 x 1.21 x **2.25 in** (bulkhead 1.75 + a 0.5 in lip). Its rear face is flush with the foot brace (the rider's heels meet a smooth face), the lip stands 0.5 in proud of the front face. Two 0.04 in snap-detent ribs (`pin` joint) hold it; two M4 heat-set inserts in the lip take the lamp's flat mount. To lift the nose you pull the lamp and clip out the front (they ride in the box in cargo mode) and grip the oak bar over the slot: no finger room needed. Mass **0.26 lb** (STL-ready: a profile and a depth). The `front-light` moved: its rear face rests on the lip, centered on the slot, faces +x, below the crown (its top is 4.5 in over the deck, the crown 5.75 in).
- **Net mass of items 2 and 4:** bulkhead -2.0 lb, bracket out, clip +0.26 lb: lighting group 1.9 to 2.04 lb.
- **Viewer (`src/viewer/lights.ts`):** the lamp is a lathe housing (a little wider than tall) with a chrome bezel ring and a domed warm-white lens that glows faintly (emissive 0.55, a lens texture warmer toward the rim), on a small dark rear bracket. Tests: bounds stay inside the part box, lens faces +x, chrome metalness, glow level.

## 5. Rear light

`rear-light` (box 0.75 x 2 x 1.5): a small dark rounded housing and a red lens (deep red `#8c0a10`, emissive 0.4, clear coat) with two molded ribs, facing -x. First try (emissive 0.7, brighter red) read salmon pink in the tone mapping, so it was darkened.

## 6. Reflectors

`reflector-*` names now carry the color: **red (rear), amber (front)** (`Side reflector L1 (red, rear)`, vendor text updated, DOT-C2 colors). The viewer draws a colored rounded housing and a face plane with a **cube-corner prism texture** (a canvas of hexagons each split into three rhombi of different brightness, dark seams, a diagonal sheen) with clear coat and a little emissive, facing outward on each side. The mesh is picked by `lightKindOf(part)` (`/\bred\b/` in the name). The tests install a tiny fake canvas.

## 7. The white plate, and the chock

- **The white plate on the rear side corner was two things, both real parts drawn as bare gray boxes:** (a) the **rear side reflector** (a 2 x 0.25 x 1 in box with no finish), now a red prism reflector; (b) the **brake hinge** (`brake-hinge-L/R`, a 3 x 3 x 0.1 in box of steel on the top of the knee, which reflected the white environment). It is now drawn as two leaves with screw heads and a five-knuckle barrel in a satin stainless. The aluminum material was also brightened to white by the room map (handle sockets, flag tube): it is now a darker brushed gray (`#a9aeb5`, roughness 0.5).
- **Wheel chocks:** hidden by default in the viewer (both Simple and Advanced) behind a new **"Wheel chocks"** toggle in the viewer bar (also offered in Simple). Reason: they are carried in the box while the sled is on the move (item 9), and parked under the knees they read as stray blocks. Hiding is cosmetic only: the model, mass, BOM and the park-hold row are unchanged.

## 8. Cart -> Sled

All user-visible words: UI labels and headings (Simple "Your sled", "The sled at a glance", "Change the sled"), the Simple view text, the analysis panel, every row label, `how` text and detail name, the parameter labels, notes and tooltips, the sim panel, truck-fit text, viewer hints. Done as a word-level replace (`cart`, `carts`, `Cart`, `cart's`, `empty-cart`, ...) over `src/**`, so comments changed too. Kept: **"hand cart"** and **"billy-cart"** (a generic type of vehicle, not this sled), the HTML id `sv-cart-h` (an internal id), the identifiers `cartTransform`, `cartAxle`, `cartMassLb`, part ids, param keys and file names. Tests: two new ones scan every param label/note/option and every check label/how/detail for `cart`; the visible-string tests were updated by the same replace.

## 9. Box contents

New `boxGear(parts)` (`src/model/storage.ts`): kit items from the real bounding boxes of the front lamp, the lamp clip and the wheel chocks (2 at the defaults; the count follows the parts).

- **Cargo mode (`seat-stow` row):** cushions (as before) **plus** the lamp, the clip and the chocks packed in the layer above the cushions (height left under the lid frame: 3.37 in, floor 14.8 x 19.3 in). Two new details: tallest item vs that height (2.50 of 3.37 in: the 4.7 x 2.5 x 3.5 in chock lies on its 2.5 in side) and floor fill (0.11, 106 in³ of bounding boxes in a 962 in³ layer). **Margin 0.87 in under the lid.** The row text lists the gear and the margin; the status drops to marginal or fail if the gear does not fit.
- **Race mode (`storage-pack` row):** the 10 Essentials **plus** the chocks: fill **0.875** (was 0.835), margin 253 in³ free (pass under 0.9). If it did not fit, the row says what to do without a bigger box: a small printed ASA holder that clips each chock to the outside of the box wall or the transom (about 0.1 lb each), or leave the chocks on their cords at the wheels (tested with a 1,500 in³ box).
- The two modes never need the lamp and the Essentials together. The existing note (cushions plus Essentials do not both fit; carry the Essentials in a pack on the bed in cargo mode) is unchanged.

## 10. Resting load

- **Joist spacing** `crossmemberSpacingIn` 10 to **8.5**: eight crossmembers (was seven), **+0.84 lb**. The ids shift (`joist-7` is now `joist-8`, the end joist; `joist-6` is the chain joist); no joist meets the step brake's backers any more at the defaults (joist-2 is at x = 5.5, the backer starts at 6.2), so it runs full width (22.5 in, was cut to 20); the cut-back is still tested at 10 in spacing.
- **Looser standing limit:** new param **`standDeflectionRatio`** = 160 (`assumed`, ref D-58, note "Eric: a tad looser for a standing adult"), used by the resting-weight row's standing deck deflection and by the `deck` row's standing-scout deflection (both are a person on one foot on the ply between joists). The analysis panel shows both limits.
- **A correction to the instruction:** the limit that was in force was NOT span/180; the general `deflectionLimitRatio` was **span/300** (locked) and the 3c-4a note's "span/180" was a slip (its util 1.12 came from span/300: 0.035 in against 0.031 in). So 160 is a bigger loosening than "a little" (it is what Eric named: span/160, about 0.05 in on the 8 in bay). The other beams (joists under cargo, rails, ...) keep span/300.
- **Results (defaults, `restLoadLb` 250):** resting capacity **358 lb** (was 223): `rest-load` passes (the heavier wheel against its 300 lb rating is now the limit, 0.74 at 250 lb). Each change alone: spacing alone (limit span/300) 289 lb; the looser limit alone more than 250 lb. The old finding (223 lb, deck deflection the one failure) is reproduced by the regression test with the old values. **Rider safe range (no red): 50 to 250 lb and open at the heavy end (it was 50 to 220); green range (no yellow either): 50 to 210 lb (was 50 to 200).** What is yellow at 220 lb and up: `rear-beam-seat` (0.91 to 0.96) and `bearing-groove` (0.91 to 0.95); `turn-radius` is marginal (0.98) at every weight. The deck no longer turns red. Cargo capacity 207 lb (205), limiter `front-beam`.

## Numbers

| | Before (3c-4) | Now |
|---|---|---|
| Empty mass | 145.6 lb | **144.2 lb** (body 42.5 to 40.5, frame 13.5 to 14.4, lighting 1.9 to 2.0, removable 3.7 to 3.3) |
| Bulkhead | 9 in peak, 4 in corners, 9.0 lb | 5.75 in peak, 4 7/8 in corners, 7.0 lb |
| Joists | 7 at 10 in | 8 at 8.5 in |
| Resting capacity | 223 lb | 358 lb |
| Rider safe / green | 50-220 / 50-200 | 50-250+ / 50-210 |
| Race box fill | 0.83 | 0.875 (with the chocks) |
| Cargo mode box | cushions only | cushions + lamp + clip + chocks, 0.87 in margin under the lid |
| Sign | 15 x 6 tilted, part hidden by the flap | 12.2 x 4.5 level, clear of the flap |

Performance (full-screen 1652 x 1336 canvas, Chrome in the Browser pane): `benchmark(60)` **2.2 to 4.3 ms** per frame (budget 30); about 690 draw calls, 182k triangles; `Viewer.update` (rebuild all parts) about 23 to 25 ms warm (the first call 50 ms), up from about 16 to 22 ms in the visual pass because of the creased normals on the side walls and the extra lamp meshes.

## Tests changed

Updated: `params.test` (defaults, new no-"cart" scan), `body.test` (bulkhead crown, hold bar 1.5 in, level sign, clearance), `fittings.test` (lamp clip, reflector names), `hull.test` (eight joists, level sign, mass bookkeeping), `rear-mount.test` and `r3-fittings.test` (joist ids), `model.test` (ALLOW for the clip in the hand-hold, joist patterns in `KNOWN_OFF_DEFAULT`, a dead ALLOW entry moved to the known list), `rest.test` (new capacity, the old finding as a regression), `rider-sweep.test`, `checks.test`, `track-d58.test`, `front.test` (the CG moved with the lighter bulkhead: tip angles +0.1 deg, hand-calc numbers), `analysis/hull.test` (bar 1.5 in), `cargo.test` (box contents). New: `plan-wall.test`, `viewer/lights.test`.

## Files touched

New: `src/viewer/lights.ts`, `src/viewer/lights.test.ts`, `src/model/plan-wall.test.ts`, `docs/phase3c-5-notes.md`.
Model: `src/model/{plan-wall,body,layout,lighting,storage,build-utils,types}.ts`, `src/params.ts`. Analysis: `src/analysis/{structure,rest,cargo,seat}.ts`. UI: `src/ui/analysis-panel.ts` and the word replace over `src/ui/*`. Viewer: `src/viewer/{partMesh,viewer,materials}.ts`. The word replace also touched text in `src/{main,sim/*,truck/*,analysis/*,model/*}.ts`.

## Proposed decision text (not edited into DECISIONS.md)

**D-59 (3c-5, Eric 2026-10-12): finish and small structure.** The sled's sides are drawn as one clean assembly (trapezoid-triangulated plan walls, creased normals, sheer-following gunwale grain). The bow bulkhead's crown is the handlebow's crown (`handleBowCrownIn`), peak 5.75 in. The Troop 455 sign is level and clear of the brake flap. The front lamp rides on a printed ASA clip that plugs the bulkhead's lift hand-hold (pull it out to lift the nose); the bracket over the bulkhead is gone. Red rear light, red (rear) and amber (front) prism side reflectors. The wheel chocks are hidden in the picture by default (Wheel chocks toggle). "Cart" is "sled" in all visible text. The box holds the cushions, the lamp, its clip and the chocks in cargo mode and the 10 Essentials and the chocks in race mode. One more deck joist (8.5 in spacing, +0.84 lb) and a standing-adult deflection limit of span/160 (`standDeflectionRatio`, was span/300 in force): the sled holds a 358 lb adult at rest; riders are safe to 250 lb and green to 210 lb.
