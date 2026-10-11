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
