# Status

Where the design stands (2026-10-14). The sled itself is in [DESIGN.md](../DESIGN.md); the decisions that hold are in [DECISIONS.md](../DECISIONS.md).

## Now
- The design, analysis and build outputs are complete and deployed to GitHub Pages on every push to `main` once the tests pass.
- **Cost pass done (D-79 to D-83, 2026-10-14).** With glued knees: Standard BOM **$1,377** (was $2,303), Extreme **$2,271** (was $3,119), excluding shipping and tax (removable knees, now the default, are in the next item); estimates are 3.5% of the Standard total. Standard empty mass **122.1 lb**, 54 engineering rows with no failure (turn radius marginal at 0.97), riders safe **50 to 230 lb**, green **50 to 210 lb** (the grab-board row, D-84), cargo capacity **286 lb**. The Extreme spec's 6 mm okoume passes the side-web row (0.44).
- **Removable brake knees are the default** (D-78, 2026-10-19; glued knees are the option): same empty mass; Standard BOM **$1,411**, Extreme **$2,309** (+$34: the ratchet-and-wrench pouch and anti-seize, estimates); cargo capacity **277 lb** (the dry knee's brake-mount row; 286 lb glued), rider ranges unchanged. The BOM has no separate bulk section any more: pack-priced parts sit in Fasteners and sandpaper in Consumables.
- **Briefing book** for the troop committee (Build mode, Download briefing book; `?briefing` after the app address previews it): purpose, two pictures, cost by group with the donated lumber and plywood subtotaled, and a troop budget on the rest.
- Waiting on Eric: the open choices below, measured Tacoma bed dimensions (Q-1), and the yard calls in the open items.

## Open items and parked ideas

- **D-76 rib trims (Eric's call):** a 1-3/4" head (−0.05 lb), 1/2" knees (−0.07 lb).
- **Fastener mass allowance:** a 3/8" stainless bolt set (bolt, nylock, washer) is counted at about 0.1 lb; a real 3/8 × 3-1/2 set is nearer 0.16 lb. Sled-wide that may understate the empty mass by about 1/2 lb. Recount when the hardware is bought.
- **Applied outside stiles** (frame-and-panel look): skipped for now; easy to add later.
- **Yard calls before ordering (cost pass):** Peach State: is the "Level 2" price sheet the walk-in price, is the oak kiln-dried, and does the 6 mm Baltic birch have 5 plies (count them; the side-web margin assumes it); 12 mm okoume BS 1088 for the deck (Peach State or Randall Brothers; priced at The Wood Yard's $90); the Harbor Freight D-ring bracket holes and rating. Still unpriced online: 1/8" x 1-1/4" stainless strip (estimate), #10-32 hardwood inserts, 3/8" detent pins, clevis pins, a 1/4" UHMW offcut, ribbed rubber tread, an oil-embedded bronze sleeve.
- **Handlebow option:** a 1" bar from one 5/4 board instead of the two-layer 1-1/4" glued block passes (handle-bow 0.29), is 0.39 lb lighter with no glue line, but costs about $12.50 more in 5/4. Eric's call.
- **Grab boards (D-84):** done. Try the hole position with a real scout in a mock-up (Verify list, `grab-reach`). The 250 lb rider now fails the grab-board row (230 lb is the safe limit); to carry more, lengthen the board or the lap. No ribs under the boards (the side already passes).
- **To verify on real parts before ordering** (also in the Build mode Verify list): the wheel's hub length and bore, the 6 mm Baltic birch's thickness and ply count, the axle rod's steel grade, tire squash for the bump model, the bow-post rib station with a booted rider (D-76), and the truck bed dimensions.
