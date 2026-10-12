# Visual review, Phase 3c, round 2

Reviewer: visual critic. Verifies the fixes recorded in `docs/visual-pass-rendering-notes.md` ("Phase 3c visual round 2") against `visual-3c-round1.md` (7/10). Method: live app at localhost:5179 in the Browser pane (pane was about 800 px wide, so the desktop layout was checked at that width; panels hidden by injected CSS for 1:1 close-ups), fresh reload, Advanced and Simple, light and dark, Iso / Top / Front, close-ups via `__klondikeViewer.camera`, rider and cargo on and off, seat flat, 375x812 phone preset after reload with "More" open and closed. Pane screenshots lag one frame, so each was taken twice. No source edited, no git.

## Grade: 8 / 10

The two things that held round 1 under 8 are fixed: Advanced no longer opens with gray crates, and the debug line is gone. The grain now reads as oak boards rather than corduroy, the bulkhead and transom grain runs the right way, and the brake flaps now look like foot pedals with a rubber tread. The sled reads as a crafted wooden Klondike sled in a polished app, and the owner would be pleased. It stops at 8 because the bow is still a plain slab, a few hardware pieces (the flat pale axle sleeves, the amber reflectors from the front) are not quite finished, and the mannequin is bulky. No MUST is open.

## Round-1 verification

| # | Round-1 item | Status | Evidence |
|---|---|---|---|
| MUST 1 | Rider/cargo gray boxes, on by default in Advanced | FIXED | Advanced opens with "Show rider & cargo" off (verified after a clean reload, also on the phone). Turned on: a translucent navy mannequin with an ellipsoid head, capsule thighs and shins, seated on the cushion with the shins to the foot brace. In Seat-flat mode the cargo is a tan crate with two darker straps and an olive duffel lashed on top. Both read as figures, not blocks. Nit: the torso and head are a little bulky and the head tops out at the handlebow height (NICE 1). |
| MUST 2 | Debug AxesHelper through the bed | FIXED | `scene.traverse` finds 0 AxesHelper objects. No blue line in Iso, Side or close-ups. |
| SHOULD 3 | Grain too coarse; bulkhead and posts cross-grained | FIXED | Bulkhead and transom now show long horizontal grain with a finer, softer stripe and gentle tone drift, and the side walls and handlebow posts follow the board's long axis. Close-up reads as oak. At far zoom the bulkhead still shows a few repeating dark rings and a slightly regular band period (NICE 2), not a defect. |
| SHOULD 4 | Brake flaps look like bare planks | FIXED (mostly) | Black rubber tread with raised grip ribs sits on the foot end, the flap narrows toward its end with rounded corners, hinge leaf and screws are clear. It now reads as a step pedal. It still overhangs the transom by about 18" (kept for leverage); Top and Side look intentional now. |
| SHOULD 5 | Red reflector too small to read | FIXED | A pale cream bezel around a brighter red prism face; reads as a reflector from Iso and Side. The amber reflector keeps its honeycomb. Nit: in Front view the amber ones show as small cream tabs (NICE 3). |
| SHOULD 6 | Lamp small, clip a dark slab | FIXED | Lamp is clearly larger, chrome ring, warm cream lens, and the clip is a warm black that blends into the slot. Lens reads a little flat (NICE 4). |
| SHOULD 7 | Aluminum sockets flat | FIXED | Brushed streaked body with two dark clamp rings per socket and bolt heads; reads as a clamped tube. They are still a pale gray against the dark oak posts; a slightly darker tone would help (NICE 5). |
| SHOULD 8 | Bow reads as a flat slab | NOT DONE (owner's choice, optional) | Unchanged: an arched slab with square-ish corners. Still the least characterful part (SHOULD 1 below). |
| NICE 10 | Phone "More" popover covers the canvas | FIXED | Opens as a compact two-row-wide scrolling sheet (about 36 vh); a tap on the view closes it; the canvas keeps the bow and wheels visible under it. In Advanced with More open only the lower half of the sled is visible, acceptable. |
| NICE 9, 11-13 | axle stub, deck seam, edge halo, SSAO | NOT DONE | As the notes say. The faint seam line is not visible in the current Top view. |

## Owner's asks, re-checked

All items from round 1 stay DONE and the two PARTIAL ones are now DONE:
- Sides with character, one clean board, bow turn-in, bulkhead crown matching the handlebow, level legible sign, lamp in the hand-hold, red rear light, reflectors (amber and red with prism and bezel), no gray placeholder boxes (rider and cargo are fixed; the sockets are brushed), "Sled" everywhere in the text, wheels (front track 32 against 24 body, visible axle stubs, not excessive). Solid, crafted, sled-like character: yes.

## What works (new or reconfirmed)

- Light theme: clean white grid, soft shadow, warm oak pops. Dark: warm oak on blue-black with a ground pool; sign, lamp and red light glow.
- Front view is now one of the best views: arched bulkhead, big lamp in the slot, handlebow crown, wide chunky wheels, oak tongue with the ring.
- Rear view: red light, hand-hold slot, clamp-ring sockets, level sign with red reflector, pedal flaps with treads. It reads as a built thing.
- Top view: clean outline, the bow turn-in visible, black treads at the rear corners.
- Phone Simple and Advanced (light): the sled fills the canvas, controls wrap well, no horizontal scroll.

## Remaining (no MUST)

### SHOULD
1. **Give the bow a little more character** (`src/model/*` bulkhead, optional owner decision). Roundover the two top corners (about 1.5" radius) and rout a 1/8" chamfer line along the arch top. Compared with the concept's curled prow this is the weakest area; it is also a flat 1.75" slab whose whole front face is visible in Front.
2. **Make the pale aluminum sockets darker** (`src/viewer/materials.ts`, `lights.ts` `socketMesh`). Use `#7d838b` instead of the light gray; they still read as bright bars against the dark oak posts in Rear view.

### NICE
1. Mannequin: slim the torso about 15 percent, shrink the head about 10 percent, so the head sits below the handlebow top (`src/viewer/mannequin.ts`).
2. Bulkhead grain at far zoom shows a regular ring band; add a second, longer-period noise term or randomize per-board UV offset so the bulkhead and transom do not match (`src/viewer/textures.ts`).
3. Front reflectors read as cream tabs from Front (the bezel faces the camera edge-on); tint the bezel the lens color or use a thin chrome edge (`src/viewer/lights.ts`).
4. Lamp lens is a flat cream disc; add a faint radial gradient with a bright center and a slight bulb silhouette; a soft glow sprite in dark mode (`lights.ts`).
5. A small white dot (flag tube top) sits at the rear-left corner in Top; fine, but it looks like a stray pin. Tint it dark or put a cap on it.
6. Still open from round 1: the axle stub at the front wheels, SSAO, edge halo at far zoom.

## Per-configuration notes

- **Desktop Advanced, dark and light:** default shows the sled alone. Rider on: the figure sits correctly; cargo in Seat flat mode: crate plus duffel, sensible.
- **Desktop Simple:** unchanged and good.
- **Iso / Top / Front:** all frame well and read clearly; Front is excellent.
- **Seat flat / handle parked / chocks:** no regressions seen (checked in round 1, unchanged; seat flat rechecked with cargo).
- **Phone:** Simple and Advanced both clean; More sheet compact and dismissible.

## Performance and console

- `benchmark(60)`: 2.2 to 4.0 ms (one first-call reading of 6.4 ms), draw calls about 700. Budget 30 ms.
- Console: no errors or warnings; Vite connect and hot-update debug lines only.
