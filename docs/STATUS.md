# Status

Where the design stands (2026-10-13). The sled itself is in [DESIGN.md](../DESIGN.md); the decisions that hold are in [DECISIONS.md](../DECISIONS.md).

## Now
- The design, analysis and build outputs are complete and deployed to GitHub Pages on every push to `main` once the tests pass.
- Standard spec: empty mass **121.1 lb**, 54 engineering rows with no failure (turn radius is marginal at 0.97), riders safe **50 to 250+ lb**, green **50 to 220 lb**, cargo capacity **254 lb**, BOM **$2,303**.
- Extreme-weather spec with its default 4 mm okoume: **$3,119** and the `side-web` row fails (see the plywood item below).
- Waiting on Eric: the open choices below and measured Tacoma bed dimensions (Q-1).

## Work in flight
- **Removable brake knee (D-78), optional toggle** (Eric approved the idea as a setting, like the weather spec; default stays the bolted knee). Study and sketches: `docs/wip/removable-knee/` (retire in the commit that finishes the build outputs: fold into DESIGN.md and DECISIONS.md, delete the folder).

## Open items and parked ideas

- **Extreme-weather plywood:** with the corrected across-grain side-web check, 4 mm okoume fails at 2.0 and 3 mm Baltic at 4.8 (1/4" white oak ply passes at 0.61). Choose a sheet for the Extreme spec: probably 6 mm okoume, or the same white oak ply.
- **D-76 rib trims (Eric's call):** a 1-3/4" head (−0.05 lb), 5/8" washers (−0.05 lb), 1/2" knees (−0.07 lb).
- **Applied outside stiles** (frame-and-panel look): skipped for now; easy to add later.
- **Cost pass:** after the build outputs are final. The BOM is large for a troop project: consumables, whole-board lumber pricing and purchased parts are the places to look.
- **Grab-board backing strip:** the 1/16" × 1" × 6" stainless strip on the outer gunwale under the six bolt heads (D-63) shows as a bare gray bar. Options: fender washers under each head, bolts the other way (heads inside, nuts outside), or an oak strip. Eric to choose.
- **Grab-board ends:** make the front and back edges vertical (to match the ribs and transom) instead of perpendicular to the sloping gunwale. It is a Shaper part, so only the outline changes.
- **No extra ribs under the grab boards:** the side already passes with them through-bolted, so ribs there would only add weight. Not planned.
- **To verify on real parts before ordering** (also in the Build mode Verify list): the wheel's hub length and bore, the 1/4" white oak plywood's real thickness, the axle rod's steel grade, tire squash for the bump model, the bow-post rib station with a booted rider (D-76), and the truck bed dimensions.
