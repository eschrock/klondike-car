# Visual review, round 2 (D-44 visual pass)

Reviewer: visual critic. Method: live app at localhost:5179 in the Browser pane (1440x900 and 375x812), light/dark, Simple/Advanced, Iso/Top/Side/Front, rider, explode, edges, shop aids, camera close-ups via `__klondikeViewer`. Pane screenshots are downscaled, so fine texture is judged from close-ups. Judged against `reference/02` and `03`.

## Grade: 7 / 10

A big step up from round 1 (5). First load now shows a stained, signed, upholstered cart that fills the canvas, on desktop and phone. It reads as a crafted wooden cart, but not yet as the concept: the stain is still a light honey/orange (concept is dark walnut), a few bright unstained orange blocks and grey cuboid hardware look like placeholders, the wheel spokes are loose grey boxes, the prow is still a thin curved stick, and the rope is a flat tan stick. Fix the MUSTs below and it reaches 8.

## Round-1 MUST verification

| # | Round-1 MUST | Status | Evidence |
|---|---|---|---|
| 1 | Framing/fill | FIXED | Iso on desktop: cart spans about 75% of canvas width and about 70% of height. Phone: about 88% of width. Side, Top and Front fill the canvas. Remaining nit: Explode is not re-fit (parts leave the frame at 29 deg). |
| 2 | Darker, richer stain | PARTIAL | Pale cream is gone. Okoume is mid-brown and oak is amber, and the per-part jitter works. But the overall tone is still light honey/orange tan, especially in light theme and on rails and blocks; nowhere near the dark amber walnut of the concept. Roughness is satin now (good). No stain option. |
| 3 | Hide ghosts/shop aids | FIXED | Rider is off by default in Simple and in Advanced (observed unchecked on load; the notes say ON in Advanced, which was not what I saw). Shop aids are hidden until the "Shop aids" box is checked, then a grey wireframe. No blue. Remaining: the red CG dot and label still sit on the seat by default in Advanced; the rider mannequin is three crude grey boxes. |
| 4 | Painted signs | FIXED | Green panel, cream border, "TROOP 455" over "WILDERNESS RANGERS", fleur-de-lis at both ends; reads right on both sides (checked from -Y and +Y). Nit: the sign is a flat rectangle, no shaped outline, no oak edge frame, and the lettering is a plain sans (concept: stencil/slab with a central fleur). |
| 5 | Vinyl cushion/back | FIXED | Cushion is dark vinyl with sheen, welt and stitch line; the back pad is rounded with a rolled edge. Reads as upholstery, not carpet. |
| 6 | Wheel rim contrast | PARTIAL | Rim is now distinct (grey dish, steel bead ring, chrome hub nut, brass cap). But the 5 spokes are loose flat grey rectangles that float off the dish, and the dish is open: oak shows through behind the hub in a close-up. Tire is smooth at medium zoom (tread only visible on the silhouette). |
| Top shadow | FIXED | Shadow is under the cart in Top. |

## What works

- Framing and canvas size: the finish is finally visible, and the phone view is good (taller canvas, cart about 88% wide).
- Signs are the best element: instantly "Troop 455".
- Cushion and back pad: convincing vinyl with welt and stitch.
- Wood: grain follows board length, end grain differs, tint jitter breaks up the pieces, and lighting is warm with soft shadows. Dark theme remains the nicest configuration.
- Wheels read as chunky off-road tires with a visible rim from normal distance.
- Decluttered defaults: no ghost slabs in the first view. Explode looks great (parts well separated, grain clearly visible) and Edges off is clean.
- Sheer line and rounded gunwale edges are visible in Side.

## What does not

1. Stain still too light and orange. Several parts (the foot stop/step blocks, the lash-point blocks, rail blocks at the prow, the plate by the tongue) are saturated bright orange and look unstained/placeholder against the brown hull. They read like a different material.
2. Hardware: grey cuboid lash points on the gunwales (about 8 visible) and grey boxes at the prow and tongue are flat placeholders. The grab handles are oak blocks (concept: green steel U-handles).
3. Prow is unchanged: thin, tall curved stick with a square section. The concept has a broad carved crest. This is the least boat-like element, and it is the first thing seen at the front.
4. Rope/bridle: a flat tan stick lying on the ground in a V, with no strands, no knots, no wraps at the stem. Concept has thick twisted rope with knots.
5. Wheel spokes as detached boxes; open dish.
6. Ground is still a CAD white grid (light theme), and in dark theme the grid is invisible and the cart floats on black.
7. Panels still have no edge darkening or plank seams, so the side panels look clean and slightly flat (grain is there, but no wear or AO).
8. Rider mannequin: three giant grey boxes, with the seat back poking through. Crude when "Show rider" is on.
9. The CG dot and label (red) show by default in Advanced and sit on the cushion.
10. Explode is not re-fit: parts leave the canvas at 29 deg.

## Prioritized fixes

### MUST
1. **Orange parts and overall stain depth** (`src/viewer/materials.ts`, `textures.ts`). Find which look/id groups produce the saturated orange (foot stop, lash blocks, tongue plate: probably a separate light/"softwood"/pine look). Route them to the same oak or okoume stain. Then deepen the global oak and okoume: face base about `#7a4a22`, late wood `#3a200c`, okoume `#8a5a36` to `#5e3820`; keep early wood highlight `#a86d34`. Target an average albedo luminance about 20% lower than now. Add an overall `Dark walnut` default.
2. **Hardware** (`src/viewer/materials.ts` plus a `src/model/*` request). Lash-point and grey blocks: apply a `steel` look (`#7c8288`, metalness 0.9, roughness 0.4), and make them read as D-rings or bolt plates; until the model changes, add rounded-box geometry (radius 0.05") and a bolt-head detail in `partMesh.ts`. Grab handles: model as green powdercoated U-handles (`#2f5a3a`), `src/model/seat.ts`.
3. **Wheel spokes and dish** (`src/viewer/wheel.ts`). Make the dish a solid closed disc (no see-through to the axle block) and replace the loose box spokes with 5 tapered, rounded spokes joined to the hub and the bead (or a flush 5-hole pattern in the dish), same steel color with a darker recess. Keep it inside `localBounds`.
4. **Prow** (`src/model/*` prow sweep, `partMesh.ts`). Broaden the section to about 1.5" x 4" at the base tapering to about 2.5" at the tip, round the edges with the existing bevel path, and add a darker scroll-edge line. (Requested in round 1; not done.) The prow is the signature of the cart.
5. **Rope** (`src/viewer/textures.ts`, `partMesh.ts`). It currently reads as a flat tan rod: use a helical 3-strand `TubeGeometry` (or a stronger normal-map helix at 35 deg, repeat every 0.6", valley `#6e5230`, ridge `#b58f5a`), and two torus wraps at the stem.

### SHOULD
6. **Panel finish** (`textures.ts`): bake an edge-darkening gradient (about 0.5" at each edge) and subtle seam lines into the okoume albedo; add 2 to 3 small knots in oak boards.
7. **Ground** (`src/viewer/viewer.ts`): fade the grid by distance (radius about 120"), and in dark theme use a faint lighter ground disc under the cart so it does not float; keep a soft contact shadow.
8. **Rider mannequin** (`partMesh.ts`/model rider parts): at least add rounded boxes and a torso/head silhouette; seat-back clipping fix.
9. **Defaults** (`src/main.ts`, `viewer.ts`): hide the CG dot and label by default (show when "CG" is toggled on by the user), or shrink the label.
10. **Explode re-fit** (`viewer.ts`): when explode > 0, re-run the framing with the exploded bounds (or limit the max travel so it stays in frame).
11. **Sign shape and lettering** (`textures.ts`, model `sign`): oak frame edge, slight bevel, slab/stencil font, enlarge the fleur-de-lis.
12. **SSAO** (`viewer.ts`): GTAO at half res; there is plenty of budget (3 to 4 ms against 30).
13. **Tire tread** (`wheel.ts`): stronger lug relief on the tread face so it reads at medium zoom.

### NICE
14. Lantern body and flag cloth. Brass plaque. Rivet heads on panels. Stain selector (Natural/Dark/Scout). Soft bloom/vignette overlay.

## Per-configuration notes

- **Desktop light (default Simple).** Good first impression: cart large, signed, upholstered. Honey-orange tone and the CAD grid keep it from feeling finished. Orange blocks stand out.
- **Desktop dark.** Still best: warm wood on deep blue-black. Wood is lighter than concept; cart floats (no ground).
- **Advanced.** Canvas about 430 px wide; cart still large enough. CG dot/label on the seat by default. Shop aids and rider are off by default; when on, the shop aid is a neutral grey wireframe and the rider is grey boxes.
- **Iso / Side / Top / Front.** Iso and Side are good; the sheer line and the sign read well. Top shows cushion and back pad nicely, shadow is fine. Front exposes the thin prow and rope as flat sticks and the two orange blocks.
- **Explode.** Attractive, but overflows the frame. **Edges off.** Clean.
- **Close-ups.** Signs, cushion welt/stitch and seat back are strong. Wheels: loose spokes. Hardware: grey cubes. Prow: thin stick. Rope: no strands.
- **Phone (375x812), light.** Cart about 88% of width, canvas about 300 px tall (taller than before), view buttons above it with a "More" menu. Reads well; the finish is visible. Good.

## Performance and console

- `benchmark(60)`: 3.4 to 3.8 ms (budget 30 ms). 214 parts, about 874 draw calls, about 139k triangles.
- Console: no errors or warnings; only Vite HMR connect/hot-update debug lines.
