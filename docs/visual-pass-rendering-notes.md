# Visual pass: rendering notes (D-44)

Owner feedback: "no fine design, textures, curved wood... still basically the block version." This pass is the viewer side
(`src/viewer/**`, plus a canvas-gradient edit in `src/style.css`). The model side adds `Part.finish` tags (roundover, soft,
tread, surface); the viewer works with or without them (it falls back to the material name, as before).

## What changed

| File | Role |
|---|---|
| `noise.ts` | Seeded PRNG, string hash, tileable value noise (pure, tested). |
| `shapes.ts` | `roundedBoxMesh` (exact-bounds rounded box, optional interior grid), `crownFace` (pillow bulge that never leaves the bounds). Pure, tested. |
| `grainUv.ts` | `projectGrainUVs`: per-triangle box mapping with u along the part's `grain` axis; end grain / ply edges get their own mapping and geometry group. Pure, tested. |
| `textures.ts` | Canvas textures, generated once and cached: oak face (rings, fibers, pores, ray flecks), okoume veneer, oak end grain, ply edge layers, vinyl/rubber pebble bump, rope strands, contact-shadow blob. ~90 ms one time at startup (oak 65 ms). |
| `materials.ts` | `lookOf(part)` (finish.surface, else material name) and shared materials: oak/okoume `[long, end]` pairs, vinyl (physical, sheen), rubber, steel/aluminum (metalness 1), ASA, rope, rim, brass. |
| `wheel.ts` | Tire lathe with rounded sidewall, 26-chevron lug tread (or ribbed), dished rim, hub barrel, brass caps. One merged geometry, five groups, cached per size. |
| `partMesh.ts` | `buildPart(part)`: picks geometry + materials + sharp-edge outline per part. Roundover for boxes (own rounded box) and extrusions (`ExtrudeGeometry` bevel with `bevelOffset = -r`, depth shortened by 2r, so the outer bounds stay exact). Soft parts become crowned, rounded pillows. |
| `sweep.ts` | Now also returns `uvs` (arc length along the path, across the face) so bent laminations get grain that follows the curve. |
| `viewer.ts` | Uses `buildPart`; ACES Filmic tone mapping, sRGB output, `RoomEnvironment` PMREM, key sun with a shadow box fitted to the model, contact-shadow blobs under the body and each wheel, Edges toggle, theme-aware grid/shadow, `benchmark()` + `window.__klondikeViewer` debug hook. |
| `style.css` | `.viewer-canvas` background is a CSS gradient (`--viewer-bg-top` to `--viewer-bg`), light and dark. The WebGL canvas is transparent. |

Details worth knowing:
- Grain direction: `part.grain`, else the longest axis (extrusions: the longer of x/y). Each part gets a UV offset from its id hash, so neighbors differ.
- Oak: faces perpendicular to the grain show end grain. Okoume (`ply` / `kind: 'sheet'`): the two big faces are veneer, every other face shows plywood layers.
- Highlight, the exposed-edge red tint, joint markers, explode, steering, sim ground, rider/reference ghosts, dimensions and section clipping are unchanged. Material arrays are handled in `highlightMaterial`.
- Shadows: three 0.186 removed `PCFSoftShadowMap`; this uses `PCFShadowMap` with `shadow.radius = 3`. The key light sits front-left-high so shadows fall to the right of the default iso view (the old light put them behind the cart).
- Edge lines are the part's un-rounded outline at 28% opacity, under the new "Edges" checkbox (on by default, also shown in Simple). Soft and wheel parts have none.

## Black canvas on first load (fixed)

Cause: the first frame was framed before the layout settled (collapsed canvas, wild aspect, camera far away), nothing re-framed it until a view button was clicked, and `renderer.setSize` clears the canvas, so a hidden or throttled page (no rAF) showed an empty dark canvas. Fixes in `viewer.ts`:
1. `resize()` re-frames the current view until the user orbits (`userMoved`), and renders synchronously after `setSize`.
2. The aspect used for framing is clamped (>= 0.25).
3. `setView()` renders immediately; a `visibilitychange` listener redraws when the page becomes visible.
4. The renderer is transparent over a CSS gradient, so even an unrendered frame is the themed background, never solid black.

## Performance (Chrome in the Browser pane, Apple GPU, 775x1000 CSS px at DPR 2)

- `renderer.render` + 1-pixel readback (GPU-synced), 30 to 60 frames: **4 to 6 ms** per frame (2.6 ms at 775x258). Sim view: about 5 ms.
- Per frame: about 900 draw calls (shadow pass included), 113k triangles, 14 textures, 436 geometries.
- `Viewer.update(parts)` (rebuild all 224 parts): 16 to 22 ms.
- Startup texture generation: about 90 ms once.
- Not measured on a low-end laptop GPU; the budget is 30 ms, so there is a wide margin.

## Verified

- 1440x900-class and 775x1000 layouts, light and dark: textured wood, lugged tires, dark vinyl cushions, soft shadows. Mobile preset (375x812, dark): cart renders on first load (no black canvas). Sim view (curb) renders and the sun follows the cart.
- `npm run typecheck`, `npm test` (935 tests, 24 files), `npm run build`, `npm run build:single` all pass.

## Known gaps

- Tire lugs are plain boxes (no rounding), and the rim/hub are generic: there is no hub nut or spokes. The tire's inner radius is derived from the hub size, not a param.
- No seam / piping on the cushions (needs a finer mesh or a normal map); the crown is a smooth pillow only.
- Rope is a texture on the existing cylinders, not a twisted-strand mesh. `mesh`-type parts (rider, truck) keep flat materials.
- Curved extrusion edges (prow) get ply-edge texture on any non-face triangle; the mapping is per triangle, so a tiny seam can show where a curve crosses 45 degrees.
- The render loop is still continuous (not on demand); fine at these frame times but it keeps the GPU busy while idle.
- The sim ground still has no texture, and cast shadows there are subtle at low sun.

## Requests for the geometry side

- `finish.softFace` (which face of a cushion crowns) instead of the viewer guessing from the transform (thin local axis, toward world +Z, else +X).
- Wheels: a `rimDiameter` (or tire sidewall height) param; the viewer uses `max(1.35 x hubR, 0.56 x R)` for now.
- If seat/back foam has a bigger intended radius or crown, a `finish.crownIn`; today the viewer uses 14% of the thickness.

## Round 2 (response to `docs/reviews/visual-round1.md`, 5/10)

Files: `src/viewer/{materials,textures,wheel,partMesh,shapes,viewer}.ts`, new `src/viewer/upholstery.ts` (+ test), small edits in `src/main.ts`, `src/style.css`, `src/ui/simple-view.css`. No model or params changes.

### MUST
1. **Framing: done.** `setView` now fits the projected per-part bounding boxes (not the bounding sphere) to 86% of the canvas on each axis, re-centering on the projected extents (6 iterations), FOV 40 to 32 degrees. Applies to Iso, Top, Side, Front, first load and resizes. Canvas height: Simple stacked layout `min(46vh, 380px)` (min 300; was 34vh), Advanced stacked `min(56vh, 440px)` (min 340; was 45vh). At 375x812 the cart now fills about 90% of the canvas width (was about 40%).
2. **Stain: done.** Oak early/late wood is dark amber-brown (about #99612e to #45260f), okoume is stained mahogany-brown (about #9e6942 to #6e4226) with low-frequency tone drift. Roughness 0.68 (oak) and 0.64 (okoume). A per-part tint jitter (about +/-6% lightness, hair of hue, from the id hash) rides in vertex colors (`ensureColors` in `partMesh.ts`), so materials stay shared. Checked in light and dark: dark mode stays warm, not muddy. Sun 2.6 `#fff1dc`, hemisphere sky `#cfe0ff` / ground `#6b5a46` at 0.5. The Natural / Dark / Scout stain option was not added (optional in the review).
3. **Clutter: done.** "Show rider" now defaults OFF in Simple and ON in Advanced until the user touches the checkbox (`main.ts`: `riderTouched`, `setRiderShown`). Rider and cargo are drawn as a solid, matte, neutral gray (`mannequin` look) and now cast shadows. Shop aids are detected generically (`isShopAid`: reference part with `fab !== 'none'`; note that `prow-form` has `payload: true`, so the rule is the fab, not the payload flag). They are hidden by default (also in Advanced) behind a new Advanced "Shop aids" checkbox, and drawn as a neutral gray wireframe (`jig` look), never blue. The hidden form no longer counts toward framing.
4. **Signs: done.** `sign-L/R` (matched by `partNo === 'sign'`) get a canvas texture (`signTexture` in `textures.ts`): forest green `#2f4a34` over 28% oak grain, a cream double border, "TROOP 455" over "WILDERNESS RANGERS" with a rule, and a fleur-de-lis at each end (canvas paths, system font stack, no files). UVs are mapped per face from the world-space outward direction, so the lettering reads right on both signs (the right side is not mirrored); verified in the browser. The wording lives in `SIGN_LINES` (Q-5 is still open with Eric). The fleur-de-lis is a reasonable but simple glyph; it could be polished.
5. **Vinyl: done.** Base `#181a1d`, roughness 0.45, bump 0.18 (was 0.7), sheen 0.6, clearcoat 0.2. Cushion: more crown (18% of thickness) and corner radius (up to 0.9"), a welt (tube) around the top edge, dashed stitch line inset from it (vertex-colored dark thread). The seat-back pad is an extrusion, so it now goes through a new soft-extrusion path (`softExtrusion`): rolled edges, crowned front face, creased normals, UVs for the bump, welt, stitch line and a center channel groove. Both read as vinyl, not carpet, in the close-ups.
6. **Wheels: done.** `wheel.ts` has a sixth material group: a deeper dished rim (mid-gray `#5b6068`), a light steel bead ring on each side and 5 spokes per side standing off the dish; tire `#0f0f10`, lug tops slightly lighter than the tire. Rim radius 0.6R (was 0.56R). Test updated (`partMesh.test.ts`: six material groups, was five) because the geometry gained a group on purpose. Hex nut and axle stub were not added: they would exceed `localBounds`.
- **Top view shadow: fixed.** The sun direction is near vertical in the Top view (so the shadow sits under the cart), the usual front-left angle elsewhere.

### SHOULD
7. Hardware (lash blocks, grab handles): not done (needs model changes: D-ring shape, U-tube handles, `finish.surface: 'powdercoat'`). Request below.
8. Rope: partly. Stronger strand contrast (valley `#6e5230`, ridge `#b58f5a`) plus a bump map. No helical tube and no knot (needs a model change for the stem wrap).
9. Canvas aspect/phone layout: partly. Taller canvas on narrow screens, and the fit now uses the aspect. The Advanced part checkboxes were not moved behind "More".
10. Panel faces: partly. Low-frequency tone drift on okoume, per-part jitter. No baked edge AO and no plank seams.
11. Prow presence: not done (model sweep section; request below).
12. Top-view shadow: done (above).
13. SSAO: not done (the tone and welt work took the effort; benchmark headroom is there).
14. Ground: not done (grid unchanged).
15. Lighting warmth: done (values above).
NICE (16 to 21): not done.

### Performance
`__klondikeViewer.benchmark(60)`: Simple iso about 4.6 ms; Advanced with the rider shown about 12.7 ms at the same canvas. Budget 30 ms.

### Tests
`npm run typecheck`, `npm test` (25 files, 961 tests, including the new `upholstery.test.ts`), `npm run build`, `npm run build:single` all green.

### Requests (model side, not done here)
- Lash points and grab handles: model as D-ring / U-tube parts and add `finish.surface: 'powdercoat'` (forest green `#2f5a3a`) to the type, so the viewer can paint them (review 7).
- Prow: a broader, chamfered stem section (review 11).
- `Part.finish` could carry `surface: 'paint'` for the signs; the viewer matches them by `partNo === 'sign'` for now.

## Round 3 (response to `docs/reviews/visual-round2.md`, 7/10)

Files: `src/viewer/{textures,materials,partMesh,sweep,wheel,viewer}.ts`, new `src/viewer/hardware.ts` and `src/viewer/round3.test.ts`. No model or params changes, no new assets.

1. **Stain (MUST 1): done.** Oak early wood is about #78492a down to late wood about #331c0a (mean face near the #7a4a22 target after lighting), okoume about #7a4f30 to #54311c, oak end grain and ply edges lowered the same way. Key sun 2.6 to 2.3 so the dark stain is not blown out. Printed ASA parts (guards, lantern / flag / light mounts, knobs, caps) are now dark charcoal satin plastic (`#2b2f33`) instead of safety orange; there is no other orange left in the model. Unfinished "other" parts (LED, reflectors) went from near-white to a mid gray. Checked light and dark: warm walnut, grain still visible, not muddy.
2. **Hardware (MUST 2, viewer side): done.** Steel is `#7c8288`, metalness 0.9, roughness 0.35; steel and aluminum boxes get a 0.05" edge break. The six `lash-*` parts draw a bolt plate with four screw heads, a bracket and a stainless squircle D-ring standing up, all inside the part's 1.5 x 0.9 x 0.75 box (`hardware.ts`). Grab handles are untouched: oak with roundover (D-40). Model-side request stays: green powdercoated U-handles would need `finish.surface`.
3. **Wheel (MUST 3): done.** The dish is a closed solid disc (profile runs to the axis); the five spokes are tapered, rounded and run from inside the hub barrel up the dish into the bead ring. All inside `localBounds`.
4. **Prow (MUST 4, viewer side): done.** Section size is unchanged. Sweeps with a `roundoverIn` finish use `buildRoundedSweepMesh`: roundover 30% of the thinner dimension, grain UVs follow the curve and wrap the roundovers, ply lines ride the rounded surface, and the tip is a domed cap (stays inside the bounds; tested). The broad carved crest in the concept is still a model decision for Eric.
5. **Rope (MUST 5): dropped by owner decision.** Eric: "I don't think we need to show the ropes - they look kind of weird." The viewer no longer draws any rope-look part (`buildPart` returns null for it: the bridle). The parts stay in the model, so mass, BOM and analysis are unchanged. The twisted-rope code, the rope texture / bump and the rope material were removed. The ground contact shadow no longer counts the rope, and framing and the sun fit read only drawn meshes, so neither accounts for it. No toggle.
6. **SHOULDs.** Ground: the grid fades out by about 115" from the cart, and a soft warm ground pool sits under it (lit gray in dark theme, faint in light) so it does not float. CG marker and its checkbox now default off (Advanced shows it only when ticked). Explode re-fits the camera while the user has not orbited. Not done: panel edge darkening, rider mannequin, sign shape, SSAO, tire tread.

Performance: `benchmark(60)` about 3.7 ms (budget 30).
Tests: see the final summary; `round3.test.ts` covers the rounded sweep (bounds, winding) and the lash mesh bounds.
Left for the owner / model side: prow crest size, green powdercoat handles, rider figure shape.

## Round 4 (curved hull, D-45)

Files: `src/viewer/{sweep,partMesh,materials,viewer}.ts` (comments only in the last two), `sweep.test.ts`, `round3.test.ts`. No model changes.

- **Plan-path sweeps.** The mesh is built in the sweep's local space (path in XZ, width along local y), and the part transform `[1,0,0 / 0,0,1 / 0,-1,0]` (a proper rotation, so winding is unchanged) places it, so nothing needed to assume a path that rises in z. For the chine, gunwale and rail, local y is the member height, so the "width" faces are the visible outer and inner sides, and the long glue lines of the bent lamination sit on the top and bottom faces (subtle, `PLY_LINE_MAT`); the web (plies 2) draws one line on its top and bottom edge.
- **Grain.** UVs are arc length along the path (u) and across the face (v), per face, so grain follows the curve with no stretching; verified at the S-curve.
- **Roundover (D-44).** The viewer now uses the model's `finish.roundoverIn` (0.208" on the chine; before it was a fixed 30% of the thinner side, tuned for the prow). All four long edges of an oak sweep are rolled, so the gunwale top edges are covered. Normals are analytic: smooth along the path, crisp across the roundover.
- **End grain.** Both ends are now flat end-grain caps (the old domed prow tip is off: `dome` defaults to 0 and is kept only as an option). Sweeps get two material groups: long grain, and end grain (oak) or ply edge (okoume end caps and the thin top and bottom faces of the web) with the matching tile scale. This also fixed a back-facing start cap in the old rounded sweep (the winding test tolerated it).
- **Decks, shoulder beam.** `deck-cabin` and `deck-nose` (46 and about 50 vertices) go through the extrusion grain path: grain along x, no stretching, no seams in Top view. The shoulder beam is a plain box with oak grain across (`grain: y`).
- **Prow.** No viewer code expects it any more (the only leftovers were comments, reworded). The bridle-hiding rule for rope is unchanged.
- **Seam note (model side, optional).** The curved sweeps end at x = 30.375 where the nose side continues as straight parts (`side-nose-*`: a box chine and extrusion gunwale and web). Their roundover and the extrusion web's grain tile differ slightly from the sweeps, so a faint vertical joint shows there from Iso. It reads as the scarf joint it is; a model-side option is to extend the same sweep through the nose (one part per side) if a continuous look is wanted. No z-fighting or gaps were visible at the transoms or the S-curve.

Performance: `benchmark(60)` about 3.5 ms (budget 30). Checked Iso, Side, Top, light and dark, desktop and the 375x812 mobile preset (after reload).

## Sign v2 (Phase 3c-3c)

The owner said the round-2 sign "looks terrible". Rendering only: `src/viewer/textures.ts` (texture), `materials.ts` (`signMaterials`), `partMesh.ts` (sign branch). No model or params changes; the sign part's size and placement belong to 3c-3a, and the artwork is not tuned to any one size.

- **Generator:** `signTexture(aspect, shape = 'oval')`; `shape` is `'oval'` (rounded-oval plank, a superellipse of exponent `SIGN_SHAPE_EXP` = 2.6) or `'rounded'` (rounded rectangle, corner radius `signCornerRadius`). `aspect` is face length / height; every size is a fraction of the face height, so nothing is tuned to one sign. The canvas is 2048 px wide (1024 for near-square signs), height the nearest power of two (drawing is scaled so letters are not distorted), mipmapped, anisotropy at least 8. Textures are cached per (shape, aspect rounded to 0.1); `signMaterials` keeps only the four most recent and disposes the rest, so dragging a sign-size slider cannot leak GPU memory. About 100 to 280 ms once per aspect.
- **Look:** `#2f4a34` paint over bare oak (the oak grain map), with low-frequency mottling, brush streaks along the grain and grain showing through; paint worn thin toward the rim, so brown wood shows at the edges. Cream `#e4d6aa` inset border (a heavier line and a hairline). "TROOP 455" large and bold in a built-in slab-serif stack (Rockwell, Roboto Slab, Bookman, Georgia, serif), letter-spaced, with a dark outline and a slight arch. "WILDERNESS RANGERS" smaller on a gentle smile arc. A bezier fleur-de-lis (mirror-symmetric; center petal, two curled side petals, band, tail and two lower leaves) between two tapering rules. Lettering is per-glyph (own letter spacing and arc, no `ctx.letterSpacing`, which Safari lacks), then chipped with grain-aligned speckle. Text is fit to the room inside the border at its own height, so any aspect fits. Below 2.2:1 the words stack (TROOP 455 / fleur / WILDERNESS / RANGERS).
- **Wording:** still the one constant `SIGN_LINES` (Q-5).
- **Board shape:** the sign is no longer drawn as a box. `partMesh.ts` builds `signOvalGeometry` (the same `signOutline` as the border, extruded to the blank's thickness with rolled rims, inside the blank's bounds), with edge lines following the outline, so the board reads as an oval plank without alpha cutting. Right-reading on both sides: the same outward-facing UV rule as before. The blank part is unchanged, so mass, BOM and cut list are not affected. `signMaterials(aspect, shape)` and `signOvalGeometry(..., shape)` take the shape too; the viewer currently asks for the oval.
- **Checked** (preview rendered from the dev server, not on the cart): oval and rounded at 2:1, 3:1 and 4:1; also near-square and portrait (0.9, 1.1) and in 3D on both sides of the cart, in dark and light. Unit tests: `src/viewer/signOval.test.ts` (outlines, board bounds, outward winding for every thin-axis case, both shapes).
- **Not done:** the sign on the current cart is small (about 5 x 6 in), so its text is small at the default view; that is a sizing question for 3c-3a. A bump map for raised paint was skipped.

## Phase 3c visual round 2 (response to `docs/reviews/visual-3c-round1.md`, 7/10)

Files: `src/main.ts`, `src/style.css`, `src/viewer/{viewer,partMesh,materials,textures,grainUv,hardware,lights}.ts`, new `src/viewer/mannequin.ts` and `src/viewer/round2.test.ts`; model side `src/model/brake.ts` (foot tread part) and `src/model/lighting.ts` (lamp size); tests `brake.test.ts`, `lights.test.ts` adjusted. No new assets or packages.

1. **Rider and cargo (MUST): done.** "Show rider & cargo" is OFF by default in Advanced as in Simple (`main.ts`). When on, every `rider-*` box is redrawn inside its own box (`mannequin.ts`): ellipsoid head, capsule thighs and shins (elliptical cross-section, round caps, along the longest axis), heavily rounded torso, pelvis and feet; one dark navy (`#22386a`), `opacity 0.55`, `depthWrite false`, no shadow. The cargo is a low tan crate with two darker straps and an olive duffel lashed on top, all inside the model's tall load envelope (its CG height is 12 in, D-53, so the load is drawn as a crate plus duffel instead of one tall block). The mannequin sits on the cushion with the shins to the foot brace. Model, mass, CG and bounds unchanged.
2. **AxesHelper (MUST): done.** Deleted (`viewer.ts`).
3. **Wood grain (SHOULD): done.** `displayGrainAxis` (`grainUv.ts`): for boxes and extrusions the stripes run along the board's longest axis (the model's note is kept only when it is within 15% of the longest). Fixes the bow bulkhead (model grain y on a 21.5 x 7.2 board) and the handle posts (model grain z, the extrusion's thickness, which had drawn END grain on their broad faces). Stripe period doubled (oak 10 rings per 9 in tile, about 0.9 in, was 20; okoume 3, was 5), tone contrast compressed to 70% about the mean, panel-scale drift raised 0.25 to 0.3, oak bump scale 0.8 to 0.6. End grain stays on end faces (solid mode: faces whose normal is the grain axis). Unit test: every oak box and extrusion in the model gets a grain axis within 15% of its longest.
4. **Brake flaps (SHOULD): done, flap length unchanged.** New model part `brake-foot-tread-L/R` (`brake.ts`): a 1/8 in rubber sheet 5 x 3 in (the foot area, `brakeFootPadLengthIn`, by flap width less 0.5 in), glued on the flap top at the foot end, riding with the flap in `buildBrakeAt` (moving part). About 0.085 lb each, **0.17 lb for the pair (2.7 oz)**; a purchased BOM line (rubber stair tread). The viewer draws a base sheet with raised grip ribs (`treadMesh`, rubber material). The flap itself (viewer only, inside its box; the notes already say round the corners and roundover the edges) now has a plan outline that narrows to 80% over its last 7 in with 1.1 in corner radii and 0.3 in at the hinge end, and a 0.14 in roundover on every edge (`flapOutline`). I did not shorten the flap: it sets the leverage, and its rows were not touched.
5. **Red reflector (SHOULD): done within the part box (2 x 0.25 x 1).** The housing is now a light cream-gray satin bezel (about 0.08 in wide) around a bigger face (margin 0.12 to 0.08), emissive 0.16 to 0.45, brighter red prism. If it should be bigger still, the part itself is the limit (`REFLECTOR_SIZE`): 3 x 1.5 in is a one-line model change.
6. **Lamp (SHOULD): done.** The model box grew 1.25x across and tall: 3 x 2.2 x 1.8 to **3 x 2.75 x 2.25 in** (length unchanged, so the overall length is the same; the top is 4.75 in over the deck, under the 4 7/8 in bulkhead corners; mass unchanged at 0.4 lb as an estimate). The clip and every printed ASA part are now a warm black satin (`#1e1a17`) instead of gray charcoal.
7. **Aluminum sockets (SHOULD): done.** `socketMesh` (`lights.ts`): a brushed tube body (a streak bump map along the length, metalness 0.85, roughness 0.38), two dark clamp rings near the ends and two dark button-head bolts on the rear face (the model's bolt rows); the body is inset by the ring thickness so everything stays inside the box (tested).
8. **Phone "More" (NICE): done.** On narrow screens the sheet is compact (controls wrap 2 to 3 to a row, 38 px rows, `max-height: min(36vh, 150px)` with scroll) and a tap on the 3D view folds it away. The sled stays visible below it.
Other NICEs: not done (axle stub, SSAO, edge halo, deck seam line).

### Performance and checks
`benchmark(60)` about 3.4 ms with or without the rider shown (budget 30). Checked in the Browser pane: desktop Advanced and Simple, light and dark, Iso, front, rear and side close-ups (bulkhead grain, lamp and clip, flap and tread, reflectors, sockets, rider and cargo including "Seat flat"), and the 375 x 812 mobile preset after reload (light and dark, More open, tap to close). Console clean.
