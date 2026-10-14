# Status

Where the design stands (2026-10-14). The sled itself is in [DESIGN.md](../DESIGN.md); the decisions that hold are in [DECISIONS.md](../DECISIONS.md).

## Now
- The design, analysis and build outputs are complete and deployed to GitHub Pages on every push to `main` once the tests pass.
- Standard spec: empty mass **121.3 lb**, 54 engineering rows with no failure (turn radius is marginal at 0.97), riders safe **50 to 250+ lb**, green **50 to 220 lb**, cargo capacity **254 lb**, BOM **$2,286**.
- Extreme-weather spec with its default 4 mm okoume: **$3,100** and the `side-web` row fails (see the plywood item below).
- Optional **removable brake knees** (D-78): same empty mass and race packing; the `brake-mount` row adds a dry-knee bolt check (0.87, passes; 0.69 sustained); about $38 more in the BOM (tool pouch and anti-seize, estimates).
- Waiting on Eric: the open choices below and measured Tacoma bed dimensions (Q-1).

## Work in flight
- **Cost pass** (2026-10-14): research and the savings analysis are in [docs/wip/cost-pass/](wip/cost-pass/) (savings.md, picks.md, shopping-checklist.md, the three research-*.md/json files). Waiting on Eric's picks; the commit that implements them folds what holds into DESIGN.md, DECISIONS.md and docs/price-research/ and deletes the folder.

## Open items and parked ideas

- **Extreme-weather plywood:** with the corrected across-grain side-web check, 4 mm okoume fails at 2.0 and 3 mm Baltic at 4.8 (1/4" white oak ply passes at 0.61). Choose a sheet for the Extreme spec: probably 6 mm okoume, or the same white oak ply.
- **D-76 rib trims (Eric's call):** a 1-3/4" head (−0.05 lb), 1/2" knees (−0.07 lb).
- **Fastener mass allowance:** a 3/8" stainless bolt set (bolt, nylock, washer) is counted at about 0.1 lb; a real 3/8 × 3-1/2 set is nearer 0.16 lb. Sled-wide that may understate the empty mass by about 1/2 lb. Recount when the hardware is bought.
- **Applied outside stiles** (frame-and-panel look): skipped for now; easy to add later.
- **Cost pass:** after the build outputs are final. The BOM is large for a troop project: consumables, whole-board lumber pricing and purchased parts are the places to look.
- **Grab-board backing strip:** the 1/16" × 1" × 6" stainless strip on the outer gunwale under the six bolt heads (D-63) shows as a bare gray bar. Options: fender washers under each head, bolts the other way (heads inside, nuts outside), or an oak strip. Eric to choose.
- **Grab-board ends:** make the front and back edges vertical (to match the ribs and transom) instead of perpendicular to the sloping gunwale. It is a Shaper part, so only the outline changes.
- **No extra ribs under the grab boards:** the side already passes with them through-bolted, so ribs there would only add weight. Not planned.
- **To verify on real parts before ordering** (also in the Build mode Verify list): the wheel's hub length and bore, the 1/4" white oak plywood's real thickness, the axle rod's steel grade, tire squash for the bump model, the bow-post rib station with a booted rider (D-76), and the truck bed dimensions.
