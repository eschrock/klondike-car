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
