# Visual review, Phase 3c, round 1 (after 3c-5)

Reviewer: visual critic. Method: live app at localhost:5179 in the Browser pane (dev server had to be started with `preview_start klondike-dev`). Desktop 1440x900 and phone 375x812 (mobile preset, reloaded), light and dark, Simple and Advanced, Iso / Side / Top / Front, steering at 0 and +20, seat flat, handle parked, wheel chocks on, rider on and off. Close-ups by moving `__klondikeViewer.camera` / `.controls` and `renderNow()` (sides, sign, rear light, reflectors, bow and lamp, handlebow, front axle and tongue, brake flaps, wheels, grab boards). Note for the next reviewer: the pane's screenshots lag one frame, so I took each shot twice. References read: `reference/02`, `03` (concept), `D-53..D-59`, `docs/phase3c-5-notes.md`, `docs/phase3c-4b-notes.md`, `visual-round3.md`. No source edited.

## Grade: 7 / 10

The sled itself now reads as a crafted wooden sled: the concave sheer, the level sign, the red rear light and the lamp in the bow are all good. Two things keep it under 8: the **Advanced view opens with a stack of huge gray boxes (rider and cargo)** that wrecks the picture, and a **debug axes line** stands up through the bed in every view. Fix those two and the grain scale and it is an 8.

## Owner's asks: checklist

| Ask | Status | Evidence |
|---|---|---|
| Sides with character: concave sheer, low bow to 14" rear | DONE | Side and Iso show a clear concave sweep from about 14" at the rear to a low bow, a smooth gunwale line, same on both sides. |
| Sides render as one clean board (no stretched or twisted strips) | DONE | Close-up Side: one long-grain oak/okoume face, a gunwale highlight along the sheer, a lower chine band. No diagonal bands, no seams at the transom or bulkhead. Light and dark. |
| Gentle turn-in at the bow | DONE | Visible in Top: the sides pull in over the last 14" into the bulkhead; reads as a soft nose, not a pinch. |
| Bow bulkhead curve matches the handlebow crown | DONE | The bulkhead top is a shallow arch; the handlebow is the same gentle arch. They echo each other (Iso, Front). |
| Troop 455 sign level, legible, well placed | DONE | Level green oval, cream border, "TROOP 455 / WILDERNESS RANGERS", fleur-de-lis, crisp at close range and readable at phone size. Sits on the tall rear side clear of the flap and hinge. Best element in the scene. |
| Front lamp clipped in the bow hand-hold, drawn as a real lamp | DONE | A chrome bezel, a warm domed lens and a dark rear housing sit in the slot with a dark clip plug. It reads as a headlamp. Small next to the bulkhead but correct. |
| Red rear light | DONE | A dark rounded housing with a deep red lens and ribs on the transom. Reads as a rear light, not salmon. |
| Reflectors that look like reflectors (amber front, red rear, prism) | DONE (amber), PARTIAL (red) | Amber side reflector: a clear honeycomb prism texture with a rim. The red one is correct in color but at normal zoom reads as a flat red rectangle, and it is small. |
| No stray gray placeholder boxes | PARTIAL | The hardware boxes are gone and the brake hinge is a real hinge. **But** the rider figure is still three huge pale-gray boxes plus a cargo box, on by default in Advanced (see MUST 1), and the aluminum handle sockets are plain flat gray bars. |
| "Sled" not "Cart" in visible text | DONE | Scanned the body text in Simple and Advanced and every tab (Analysis, Simulation, Truck fit, Cut list, BOM, Exports, Assembly): no "cart" or "carts" anywhere. Title is "Troop 455 Klondike Derby Sled". |
| Wheels not excessively far out | DONE, with a nit | Track 32 vs body 24. In Front the front wheels stand about 4" clear of the body on a visible axle stub, which looks a little "stuck on" but not wide. The rear wheels tuck under the brake flaps. |
| Solid, crafted, sled-like character | MOSTLY | The warm oak, the through-bolt hardware, the grab boards, the hinged flaps and the chunky wheels sell "built". The bow end is still a flat slab (no curled prow as in the concept), so it reads more as a wedge wagon than a boat. Owner chose it, not penalized heavily. |

## What works

- Side walls: clean, rich, the sheer line is the hero of the Side view.
- The sign, in light and dark, and on a phone.
- Wheels: solid steel dish, five spokes, chrome hub nut, chunky lugged tread. Excellent in close-up.
- Hardware: lash D-rings on plates, screw heads on the hinge leaves, ring at the tongue tip, the through-bolts on the side.
- Grab boards: oak with the routed hand hole, rounded corners, bolted through. Look right and crafted.
- Handlebow: a gentle one-board crown, matches the bulkhead. Parked pose works (bow rests over the transom), seat-flat pose gives a clean flat bed, chocks appear only when toggled and look like wooden wedges.
- Steering slider: the front axle and tongue swing as expected at +20 degrees; no clipping into the hull seen.
- Dark theme: ground pool and contact shadow keep it grounded; the sign and the lamp pop. Light theme is clean.
- Phone: Simple fits the canvas well (sled about 85 percent of the width), the controls wrap sensibly, text is legible.

## Prioritized fixes

### MUST

1. **Rider and cargo figure are still gray boxes, and on by default in Advanced** (`src/viewer/partMesh.ts` rider parts, plus the default in `src/viewer/viewer.ts` / `src/main.ts`: the "Show rider & cargo" state). Three huge pale-gray cuboids stacked taller than the handlebow plus a cargo block; at 150 lb the head floats about 30" above the bed. It dominates every Advanced screenshot (desktop and phone, light and dark) and is the first thing the owner sees after clicking Advanced. Do both: (a) default the toggle OFF in Advanced, as in Simple; (b) when on, draw a mannequin: rounded or capsule limbs, torso about 14 x 9 x 20", head sphere about 8" across, thigh and shin angled to the foot brace, in a dark translucent navy (`opacity 0.55`, `depthWrite false`), and the cargo as a single low rounded crate (about the box footprint) tinted tan. Check that the figure sits seated on the cushion, not on the seat back.
2. **Debug AxesHelper is always visible** (`src/viewer/viewer.ts` line about 620, `new THREE.AxesHelper(24)` added to the scene and pushed in `envObjects`). The blue Z line stands 24" up through the cargo bed and the seat area at the rear-axle origin in every view (seen beside the seat back and over the deck in Iso, Side and the sign close-up); the red and green lines hide under the sled. Hide it by default and show it only with "Shop aids" or Dimensions on, or delete it.

### SHOULD

3. **Wood grain is too coarse and too regular, and the bulkhead grain runs the wrong way** (`src/viewer/textures.ts` and `src/viewer/grainUv.ts`). At close range the side faces, the handlebow posts and especially the bulkhead read as corduroy, with stripes about 1/3" apart at high contrast (more "wood-grain wallpaper" than oak). The bow bulkhead and the rear transom show **vertical** stripes on a board whose long axis is horizontal, which looks cross-grained and weak at the hand-hold. Fix: for plank panels set the grain direction to the part's long axis (bulkhead and transom: u along y, rotate the UV 90 degrees), lower the stripe contrast by about 30 percent, double the stripe period, and add a second low-frequency tone so planks are not uniform. Same fix for the handlebow posts (stripes run across the post).
4. **Brake flaps look like planks sticking out of the back** (`src/model/*` brake, flap length; plus `src/viewer/partMesh.ts` for pad and tread). Seen in Side, Top and the rear view: two bare oak boards about 8" x 28" standing about 18" behind the transom at wheel-top height, with no visible pad or tread, so they read as a mistake or a fender, not a brake. Either shorten the overhang past the transom to about 8-10" (the lever ratio is 2:1, so check `brake-flap` rows first), or add a visible black rubber foot pad on the top rear end (3 x 6 x 0.4", `#222`, grip ribs) and a darker oak or a stain stripe so the eye reads it as a pedal. The hinge leaf and screws already look good.
5. **Red side reflector too small to read** (`src/viewer/lights.ts` reflector mesh; size in `src/model/lighting.ts`). Same cube-corner texture as the amber one, but at 2 x 1" and dark red it reads as a flat patch from Iso. Make the housing rim lighter (a thin cream or chrome bezel, 0.1" wide) and raise the emissive from about 0.25 to 0.45, or enlarge to 3 x 1.5".
6. **Front lamp is small and the plug is a dark slab** (`src/viewer/lights.ts`). The lamp is about 2" across against a 21" bulkhead and the dark clip fills the whole slot, so the slot looks like a black cutout. Scale the lamp housing about 1.25x (still inside the 4.5 x 1.25 slot, so grow along x, not y/z), and give the clip a warmer brown-black matte so it blends with oak. A small glow sprite (0.3 opacity warm, radius 4") in dark mode would help.
7. **Aluminum handle sockets read as flat white-gray planks** (`src/viewer/materials.ts` alu, `src/viewer/partMesh.ts` socket shape). They were fixed against over-bright reflection but now look matte and flat. Add a darker edge band (two 0.2" black steel clamp rings at the top and bottom) and a slightly higher metalness (0.8) with roughness 0.35.
8. **Bow end reads as a flat slab** (`src/model/*` bulkhead; owner choice). Compared with the concept's prow, it is the least characterful element. If the owner is open to it, give the top corners a 1.5" radius roundover (the corners now sit square above the sides) and a routed chamfer line on the face edge. Optional, not a defect.

### NICE

9. Front wheel looks a little "stuck out" on its axle in Front (the axle stub is visible for about 3"). A darker, thicker axle bracket or a wheel-side hub cap that covers the stub would help.
10. Phone: the "More" popover covers the whole canvas, and its last rows (Seat flat, Handle parked) are near the bottom edge of the viewer. Make it a scrollable sheet with a max-height of about 60vh, or open it as a drawer under the viewer (`src/ui/*`).
11. A faint thin diagonal gray line crosses the deck near the storage box in the top-down pass (a hinge or lid seam, about 12" long). If it is a real part (lid line), draw it as a dark gap line, if not, hide it.
12. Edge highlight lines (Edges toggle on) leave a faint white halo around the side top edge at far zoom. Reduce to 0.6 opacity at distance.
13. SSAO at half resolution would deepen the corners and bulkhead-to-side junctions; the frame budget is large (2 to 4 ms).

## Per-configuration notes

- **Desktop, Simple, light, Iso:** good. The cargo-flat deck, sign and wheels carry it. Axes line visible next to the seat back.
- **Desktop, Simple, dark:** best of the set. Warm oak against blue-black, soft ground pool, sign and lamp glow.
- **Desktop, Advanced (light and dark):** the rider and cargo boxes dominate the view (MUST 1). With the toggle off, same quality as Simple. The summary and analysis panel are clean; no "cart" text.
- **Iso / Side / Top / Front:** all frame well. Side is the strongest (sheer, sign, brake pedals); Top shows the gentle bow turn-in and long flaps; Front shows the arched bulkhead, lamp, handlebow and the wide stance.
- **Steering +20:** front axle and tongue pivot, wheels turn, no obvious intersection.
- **Seat flat:** clean flat bed, the hinged seat back lies down on the deck as designed. **Handle parked:** bow rests over the transom, sockets show. **Wheel chocks:** wedges appear at the wheels only when on.
- **Phone, Simple, light and dark:** very good; canvas and bar fit; More popover is the only rough part (NICE 10). **Phone, Advanced:** the rider boxes fill half the canvas (MUST 1).

## Performance and console

- `benchmark(60)`: 2.2 to 4.0 ms (first call about 4 to 5 ms), well under the 30 ms budget. About 700 draw calls and 182k triangles.
- Console: no errors or warnings after a clean reload; only Vite connect debug lines.
- Layout at 1440x900 and 375x812: no horizontal scroll, no overlap.
