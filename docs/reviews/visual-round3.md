# Visual review, round 3 (final, D-44 visual pass)

Reviewer: visual critic. Method: live app at localhost:5179 in the Browser pane (1440x900 and 375x812), light/dark, Simple/Advanced, Iso/Side/Top/Front, rider on/off, Explode, camera close-ups through `__klondikeViewer`. The pane reports the page as hidden, so I forced `renderNow()` before each capture. Scope respected: no rope, prow section size and oak grab handles (D-40) not penalized, engineered geometry differs from the concept.

## Grade: 8 / 10

It now reads as a real crafted wooden cart in a polished app. The stain is a believable dark walnut with cathedral grain, the orange placeholders are gone, hardware reads as hardware, wheels are solid and chunky, and the "TROOP 455 / WILDERNESS RANGERS" sign and vinyl cushions carry the Scout identity. Remaining gaps (crude rider figure, plain grey boxes at the prow, thin prow, flat panels) keep it from 9.

## Round-2 MUST verification

| # | Round-2 MUST | Status | Evidence |
|---|---|---|---|
| 1 | Orange parts and stain depth | FIXED | No saturated orange anywhere. Hull is a warm walnut/amber brown with dark late-wood grain, in light and dark theme. Printed parts are charcoal. Blocks (foot stop, lash blocks, step) now match the hull. |
| 2 | Hardware | FIXED (viewer side) | Lash points are bolt plates with screw heads and a steel D-ring; they read well in the close-up on the gunwale and at medium distance. Steel edge break is visible. Grab handles stay oak (D-40, in scope). Remaining nit: the two plain grey rounded boxes at the prow (steering pin plate / light mount) and the black post still look like placeholder blocks. |
| 3 | Wheel spokes and dish | FIXED | Dish is a closed solid disc, five tapered spokes meet the hub, chrome nut, bead ring. Tire reads chunky; lugs are visible at 3/4 distance. |
| 4 | Prow | PARTIAL (in scope) | Section unchanged by design; rounded edges and a domed tip are visible, grain follows the curve. It is now a smooth, finished curved member rather than a square stick. Still thin next to the concept's crest (owner decision). |
| 5 | Rope | N/A | Not drawn, per owner. Cart looks clean and no stray rope sticks remain on the ground in any view. |

SHOULDs from round 2: ground grid fades by distance and a soft pool sits under the cart (dark theme no longer floats: DONE); CG dot off by default (DONE); Explode now re-fits and stays inside the canvas at 36 in (DONE, looks great). Not done: panel edge darkening, rider mannequin, sign outline shape, SSAO, tread relief.

## What works

- Wood: dark walnut with wavy cathedral grain on the panels, distinct end grain, per-part tint variation. Satin sheen, warm key light, soft shadows. Great in dark theme, good in light theme.
- Sign: crisp green panel, cream border, fleur-de-lis on both ends, readable at Iso and phone size.
- Vinyl seat cushion and back pad: welt, sheen, rounded corners. Reads as upholstery.
- Wheels: solid steel dish, spokes, hub, tread; the rim and tire contrast is strong.
- Lash D-rings, bolt plates, steel strips along sills: small details that say "built, not rendered".
- Gunwale sheer line and rounded roundovers on rails and handles are visible in Side and Iso.
- Framing: cart fills the canvas on desktop and phone; Top shows cushions, shadow and handle bars cleanly.
- Explode: well separated, grain visible, fits the frame.

## Remaining fixes

### MUST
None. Nothing blocks the 8.

### SHOULD
1. **Rider figure** (`src/viewer/partMesh.ts`, rider parts): still three huge pale grey boxes (Advanced, "Show rider" on). Use rounded boxes, a darker translucent torso/head/leg silhouette, and clip the back pad. It is the single worst-looking item when enabled, and I saw it ON in Advanced on first load (restored state), so the owner will meet it.
2. **Grey cuboids at the prow and tongue** (`src/viewer/hardware.ts` / `materials.ts`): the two light-grey rounded blocks and the black post at the front corners. Give them a steel/dark painted look with a bolt head, or make the light mount charcoal like the other printed parts.
3. **Panel finish** (`src/viewer/textures.ts`): add 0.4 to 0.5 in edge darkening or AO and faint plank seams on the side panels; they are slightly flat at close range.
4. **Prow** (owner decision): a broader carved crest would add the most boat-like character.
5. **Sign outline** (`textures.ts`): oak frame edge and a shaped top edge as in the concept.

### NICE
6. Tire lug relief stronger at medium zoom; SSAO at half res (budget is plentiful); stain selector; green powdercoated U-handles when the model allows.

## Per-configuration notes

- **Desktop dark, Simple, Iso:** best looking. Walnut on blue-black with a soft ground pool; no floating.
- **Desktop light:** clean and bright; fading grid, soft shadow, cart pops. Good.
- **Advanced:** same render; cart is smaller in the narrower canvas but still reads. With rider on, the grey box mannequin dominates the scene (SHOULD 1).
- **Iso / Side / Top / Front:** all fill the frame; Side shows the sheer line and sign; Top is tidy.
- **Explode:** attractive and in frame. **Edges:** fine.
- **Close-ups:** grain, end grain, D-ring plates, cushion welt, sign and wheel all hold up. The prow tip is smooth and domed.
- **Phone (375x812, light):** cart about 85% of canvas width, sign legible, good.

## Performance and console

- `benchmark(60)`: 4.3 ms desktop (first call 10 ms while warming); budget 30 ms.
- Console: no errors on a fresh load. One stale `lookOf is not defined` error in the log came from an earlier HMR update, before the `lookOf` import existed in `viewer.ts`; the import is present now and the error does not reproduce on reload. Only Vite debug lines otherwise.
