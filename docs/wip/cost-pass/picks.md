# Cost pass: Eric's picks so far (2026-10-14)

Working notes for the cost pass; deleted when it lands (see docs/STATUS.md, Work in flight).

## Decided
- **Shop stock, $0 lines** (kept in the BOM marked "from existing shop stock"): beech Dominos (5x30, 8x50), sandpaper, the supplies lot (brushes, rollers, cups, gloves), Titebond III, mineral spirits, contact cement, paracord (the wheel-chock cords and the brake stop cords). 
- **Bridle rope** stays in Purchased parts at its price (3/8" three-strand nylon, the weak link; not paracord).
- **Brake return bungee:** real 1/4" shock cord, bought as a short length, not a 100 ft roll.
- **Drains:** Standard drills plain 3/8" drain holes (same 4 deck sites through the chine sandwich, plus 2 in the box floor), with the bore sealed in epoxy; no nipples. Extreme keeps the stainless nipples (real price $10-13 each, not $5.20).
- **Extreme Dominos:** beech from shop stock in both specs; under the Extreme spec they are epoxied in (epoxy everywhere already), so no Sipo packs. Eric cares much less about the Extreme spec (unlikely to be built on cost): keep its changes minimal.
- **Chine tie Dominos dropped (both specs).** The vertical Dominos from the side sandwich's bottom edge (outer band + web edge, about 7/16") into the rail top were 40-47% of that edge, past the 1/3 rule and past chooseDomino's own 0.42 cap (the tie code bypassed it). The analysis credits them nothing. Keep the epoxy bed and the #6 x 2-1/2 screws up through the rail at even spacing (they locate), plus clamps and cauls at glue-up. In the savings table as a fix. The critic checks every other Domino choice against the 1/3 rule.
- **Domino audit (done, 2026-10-14):** only one other joint is past 1/3: the rail end into the bow bulkhead, 8x50 in the 3/4" two-ply rail (0.42 of it, centered on the ply glue line). Proposal: tighten chooseDomino's cap from 0.42 to about a third (0.34), which gives 6x40 there (0.31); the foot-stop row credits a fixed 1 in² per tenon, so no row changes. The joist, chain-joist, king-beam and axle-hanger 5x30s are 0.11-0.31 of their stock: fine. Eric has plenty of beech 6x40 (approved).
- **Shop Domino is the DF 500 only** (4 to 10 mm tenons; Eric has no DF 700 XL). Today's defaults use only DF 500 sizes, but `chooseDomino` can still pick the XL sizes (8x80 to 14x100) for thick stock: limit it to the DF 500 and test that no joint uses an XL size. Say "Festool Domino DF 500" in DESIGN.md's shop line.
- **Storage lid** keeps the front-edge hinge (opened from behind, latches aft).
- **Lid stay:** Rockler 6" medium-duty lid support (plated steel, inside the box), replacing the Sugatsune S-93L.

- **The bundle (savings.md section D) approved, 2026-10-14**, with these changes:
  - Thin sheet (Standard): **6 mm (1/4") Baltic birch 4 x 8, Peach State $49** [F] (plywood PDF, "last updated 8/9"), not the Wood Yard birch. All-birch 5-ply; side-web 0.32 on Metsa 6.5 mm values; +5.0 lb empty (126.1 lb). Glue probably interior: garage-kept, sealed.
  - 12 mm deck sheet: Peach State lists no marine ply; Aircraft Spruce has okoume only in 4 and 6 mm. Ask Peach State and Randall Brothers (Atlanta; nothing online) for 12 mm okoume BS 1088. BOM keeps the Wood Yard's $90 as the reference.
  - #8 x 2-1/2 18-8 with a pilot hole for the rail-to-chine and rib-knee screws (approved).
- Peach State plywood PDF: https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf (also 1/4" import C-2 white birch VC $27, 1/4" B-2 white oak VC $75; edge banding only in 250 ft rolls).

## Open
- Everything in the savings table once the metal and fastener research is in.
- Extreme: Festool makes no Sipo 4x20 Domino (the smallest Sipo is 5x30). The 4x20s are only the chine ties with the 4 mm web; with a 6 mm okoume web the model already picks 5x30 (34 in all), so the 6 mm sheet removes the problem and the 4x20 pack ($55). Scratch run: Extreme with 6 mm okoume is $2,942.11 before the sheet; at Aircraft Spruce $158.65 that is about $3,101 (-$18 vs today).
- Extreme thin sheet: 6 mm okoume (recommendation pending the full write-up).
