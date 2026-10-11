# Visual review, round 1 (D-44 visual pass)

Reviewer: visual critic. Method: live app at localhost:5179 in the Browser pane, 1440x900 and mobile 375x812, light and dark, Simple and Advanced, Iso/Side/Top views, close-ups via `__klondikeViewer.camera`. Judged against `reference/02` and `03`. Note: the pane screenshot is downscaled (800 px wide), so fine texture was judged from camera close-ups, not pixel peeping.

## Grade: 5 / 10

Clearly past "block version" (grain, a sheer line, lugged tires, soft shadows, and dark mode actually looks good), but it still reads as a pale, clean CAD/toy model of a plywood cart, not a stained, crafted wooden sled-boat. The concept's identity (dark amber stain, painted green signs, rope, brass/steel hardware, a huge swan prow) is mostly missing, and the cart is small in the frame, so the finishing work is hard to see at default zoom. Eric will likely still say "it looks like unfinished plywood".

## What works

- Rendering is clean and fast: no console errors, soft shadow, ACES tone mapping, environment lighting gives believable shading.
- The sheer line (gunwale rising to the bow) is visible in the Side view and gives the hull a real boat profile. The crowned transoms and rounded gunwale edges catch light and soften the box look.
- Oak grain direction follows the board length, end grain on transom and rail ends is distinct (striped), and each board has its own offset so neighbors differ. Close-up reads as real boards (rails, rail blocks, lamination stack at the bow).
- Tires: 26 lug chevrons plus rounded sidewall, chrome hub nut and brass-like cap, reads as a chunky off-road tire.
- Seat back is a rounded, slightly crowned pad; cushion has a sheen. Rope bridle is a clear V.
- Dark theme is the best-looking configuration: warm wood against a deep blue-black gradient, strong contrast, shadows grounded.
- Simple/Advanced chrome, theme toggle and canvas gradient integrate well. Mobile has no black canvas.

## What does not

1. Color. Okoume side panels are a very pale cream (almost white) with barely visible veneer; oak is a saturated light orange-honey. Together it reads as bare plywood and pine, nothing like the dark brown/amber stain in the concepts. The white-to-orange contrast between panel and rails is stark and looks pieced together.
2. Scale in frame. In Iso on desktop the cart fills only about 45% of the canvas width and 45% of its height (the canvas is nearly square, about 780x780 CSS px, so there is a lot of empty floor). On phone it is about 40% of the width. All the finishing detail is therefore a few pixels.
3. Default view clutter. Simple mode shows the rider and reference ghosts by default: five translucent blue slabs overlap the cart and hide the seat, the hull interior and the finishing work. In Advanced a blue shop-aid slab (`prow-form`, 25% opacity `#4d8dff`) sticks out of the bow at the default view, reads as a bug, and a red CG label sits on the seat.
4. Signs, rope and metal have no finish. `sign-L/R` are the same wood texture as the hull: no green paint, no lettering, no fleur-de-lis. The bridle rope is a thin tan cylinder with almost no strand relief. Grey cuboids on the gunwales (lash points and hardware) are flat light-grey boxes and look like placeholders. The concept's green steel grab handles are plain oak blocks here.
5. Panel faces are too smooth. The big plywood side faces are flat, uniform and low-contrast, with no wear, edge darkening, plank joints, or subtle color variation. Large areas read as paper cardboard.
6. Wheel rims. Rim and dish are black on black tire, so the wheel reads as a solid black disc with a chrome nub. Concept shows a visible rim and spokes.
7. Cushion. It is near-black with a visible pebble bump and reads as carpet or a rubber mat from above, rather than stitched vinyl. No seam, welt, or button detail.
8. Top view: the cast shadow is offset to the upper left and looks like a ghost duplicate of the cart; the Top view does not follow the "light from above" expectation.
9. Prow. A swan-neck bent sweep, thin and tall, with a plain rectangular cross-section; the concept's is a broad, carved, curved, thick crest. It reads as a curved stick.

## Prioritized fixes

### MUST

1. **Default framing and canvas fill.** `src/viewer/viewer.ts` `frame()/setView()`: fit the model's bounding sphere to about 80% of the shorter canvas side in Iso (currently about 45%). Use a tighter FOV (30 to 35 degrees) and a smaller margin factor (target margin 1.1 to 1.15 instead of the current value). In Iso, aim the target slightly below the vertical center (so the cart sits low-center). Mobile: apply the same fit on the narrow dimension and reduce the canvas's wasted top/bottom (see 9). Re-frame for Side/Front/Top so the cart fills about 80% of the width.
2. **Darker, richer stain.** `src/viewer/textures.ts` and `materials.ts`. Oak: shift the base tone to a mid-to-dark amber brown (face base about `#8a5a2b`, ring/dark lines `#5a3716`, late wood `#6e4520`, pores `#3d2410`) and keep a lighter early-wood highlight `#b07a3e` for contrast. Do not use a saturated orange. Okoume: tint to a stained mahogany-brown (`#a8744a` with veneer lines `#7a4d2c`), not cream, so the panel and the rail read as the same project. Add a per-part tint jitter of +/-6% in lightness (from the id hash) so boards do not match exactly. Keep the roughness 0.55 to 0.65 for an oiled, satin look (currently 0.9 to 0.95 which looks chalky). Option: expose a `stain` toggle (Natural / Dark walnut / Scout brown) in a rendering setting, default Dark.
3. **Hide ghosts and shop aids by default in Simple mode.** `src/viewer/viewer.ts` and `src/ui/*` (the "Show rider" default and the `shopAid` visibility): Show rider should default OFF in Simple, the rider shown as a solid, opaque, single-tone mannequin silhouette (not 5 glass slabs) when on. Hide `shopAid` parts (`prow-form`) unless the user opens the Advanced "shop aids" group, and if shown use hatched wireframe at about 12% opacity in a neutral grey, never saturated blue.
4. **Painted signs.** `src/viewer/textures.ts` (new `signPaint` canvas texture) and `materials.ts` (lookOf for ids `sign-L`/`sign-R` or a `finish.surface: 'paint'` tag from `src/model/finish.ts`): painted forest-green `#2f4a34` background with a cream `#d8c9a3` border line, "TROOP 455" in a bold slab or stencil font, "WILDERNESS RANGERS" below, and a fleur-de-lis glyph; roughness 0.7, with the underlying wood grain faintly showing through (multiply 85% paint with a 15% grain bump). Map UVs across the sign face. This is the single most recognizable element in the concept and costs a few canvas calls.
5. **Cushion and seat back as vinyl.** `materials.ts` vinyl: base `#1d1f22` (slightly lighter than now) with a lower bump scale, an anisotropic sheen (`sheen: 1`, `sheenColor #5a6068`, `sheenRoughness 0.5`), and roughness 0.45. `partMesh.ts` soft parts: add a welt/piping ring (small torus or inset ridge along the crowned perimeter), plus a center channel stitch line on the back pad (a thin dark groove with 14 px canvas stitch dashes in the normal map). Increase the crown to 10 to 12% of thickness and the corner radius to about 1.5".
6. **Wheel rim contrast.** `src/viewer/wheel.ts`: rim dish painted a mid color distinct from the tire (satin steel `#9aa0a6` metalness 0.9 roughness 0.35 or, to match the concept, a dark charcoal `#2a2d31` rim against a pure-black tire `#0c0c0d`), raise the rim visible radius so about 55% of the radius is visible, add 5 to 6 raised spoke or cutout shapes or at least a recessed disc plus a lighter bead ring. The hub: add a hex nut and a thin axle stub. Tire material roughness 0.9 with a subtle lighter dust tone on lug tops (vertex color or a tread texture at 8% lighter).

### SHOULD

7. **Hardware that looks like hardware.** The grey cuboids on the gunwale: tag as `steel` with brushed texture (`#8b9096`, roughness 0.4, metalness 1) and add a rounded box (radius 0.04") plus a bolt-head cylinder detail on top; or draw as a D-ring loop. Grab handles: model as a `U` tube (3 segments: two verticals and a rounded bar) in `src/model/seat.ts` with `finish.surface: 'powdercoat'` forest green `#2f5a3a` (matches the concept); viewer material roughness 0.45, metalness 0.2.
8. **Rope.** `src/viewer/textures.ts` rope: increase the strand relief (normal map with 3 twisted strands at about 35 degree helix, repeat every 0.6"), color `#b58f5a` with darker valleys `#6e5230`, roughness 0.95; swap the cylinder for a real helical `TubeGeometry` (wireframe-free, 12 radial segments) if the cost is small, or at least scale texture repeat so the twist is visible at 0.75" diameter. Add a knot or wrap at the stem (two torus turns) at the bridle attach point.
9. **Canvas aspect and phone layout.** `src/style.css`: on mobile the canvas is about 360x215 and the cart is tiny. Make it at least `min(70vh, 100vw)` tall in Simple (about 380 px at 375 wide), keep the view buttons overlaid on the canvas rather than stacked above it, and put the Advanced part checkboxes behind "More". On desktop the canvas can be wider than tall: make the Iso camera use `aspect` for fitting so the empty floor above and below is smaller.
10. **Break up the big panel faces.** Okoume faces: add low-frequency tone variation (value noise at 1/4 panel scale, +/-5% lightness), a subtle edge darkening (ambient occlusion baked as a gradient 0.5" from the edges via the UV-based vignette in the texture), and add visible plank seams (or shallow bevel lines) on wide decks and the nose side. Use `aoMap` or a vertex color AO if the geometry is cheap.
11. **Prow presence.** `src/model/` prow sweep and `partMesh.ts`: widen the stem profile in section toward the base (a tapered 1.5" x 4" to 1.5" x 2.5" tip) and chamfer or round the curved edges with the existing bevel path (the curved extrusion currently shows square edges). Add the carved scroll outline in a tinted dark line. Currently tall and thin. Concept prow is broad and chunky.
12. **Top view shadow.** `viewer.ts`: in Top/Front/Side views, reduce the shadow offset by moving the sun closer to the camera direction (e.g. 25 degrees off-axis rather than 45+), or fade the contact shadow plane to 40%; the Top view currently shows a detached grey ghost of the cart at the upper left.
13. **Wear and variation.** A subtle global darkening in the corners and joints (screen-space AO, `SSAOPass` or `GTAOPass` at half resolution if the budget holds; we have about 25 ms of spare time per frame).
14. **Ground.** Replace the flat white-grid floor in Iso with a faint asphalt/snow-colored gradient disc and a soft radial falloff: fade the grid by distance from the cart (radius about 120"). The infinite pale grid makes it feel like a CAD viewport.
15. **Lighting warmth.** Key sun warm `#fff1dc` at intensity about 2.6, hemisphere sky `#cfe0ff` / ground `#6b5a46` at 0.5, environment intensity 0.6 to 0.8 so the wood stays saturated while shadows stay readable. Light theme currently looks flat and washed out (lots of ambient, little modeling shadow).

### NICE

16. Add a lantern, a flag on the pole, and a small brass plate (the concept has a lantern with a glass pane and flame glow). Parts exist (`lantern-mount`, `flag-mount`), but there is no visible lantern body.
17. Edge wear: lighten the roundover highlight lines by 8% (a worn edge look) and add small dark knots in the oak (2 to 3 per 24" board) in `textures.ts`.
18. Rivet/screw heads on side panels: instanced small cylinders with brass or steel material at the fastener positions (the model already knows them from joinery).
19. A subtle vignette and a soft bloom on specular highlights in the canvas (CSS `radial-gradient` overlay is enough).
20. Explode: add easing and a faint leader line per part (not checked in depth; works).
21. Optional screenshot button ("Save image") with a transparent background for sharing with the troop.

## Notes per configuration

- **Desktop light (default).** Washed out. Pale panels, orange rails, white grid. Rider ghosts occlude. Cart about 45% of canvas.
- **Desktop dark.** Best look. Warm wood pops, shadow reads, still small in frame and still pale panel colors.
- **Simple vs Advanced.** Advanced canvas is smaller (about 430 px wide) so the cart is tiny; the blue prow-form slab and the red CG label are visible by default. Layout otherwise fine.
- **Side view.** Sheer line reads well; wheels look good; panel is blank pale. Cart is about 50% of the width.
- **Top view.** Shows the seat and cushion nicely; shadow ghost at upper left; the planking reads pale.
- **Close-up (seat and wheel).** Seat back and the roundovers are good; cushion is dark grey noise (reads as carpet); grey hardware cubes look like placeholders; wheel rim black on black.
- **Phone (375x812).** No black canvas. Cart about 40% of width in a short canvas (about 215 px tall); light and dark both OK, but too small to see any finish. Advanced remembered from the earlier session (state persists; fine).
- **Explode/Edges.** Not inspected beyond default (Edges on). Edge lines at 28% are subtle and fine.

## Performance and console

- `__klondikeViewer.benchmark(60)`: **4.0 to 4.5 ms** per redraw at 1440x900 (budget 30 ms), so there is plenty of headroom for AO, a helical rope, and a few more textures.
- Console: no errors or warnings; only Vite HMR `connecting`/`connected` debug lines.
- Scene: 214 parts, `partsGroup` 214 children.
