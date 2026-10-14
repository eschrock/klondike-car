# Cost pass: savings analysis (2026-10-14)

Working notes; deleted when the cost pass lands (docs/STATUS.md, Work in flight). Picks so far: [picks.md](picks.md). Price evidence: research-lumber-sheet.md, research-metal-fasteners.md, research-parts-consumables.md (tags: [F] page fetched, [S] search snippet, [L] list).

Baseline (live `bom(buildModel(defaultParams()))`): **Standard $2,302.79** ($515.58 estimates), **Extreme $3,119.11**. Standard sections: lumber 583.08, plywood 203.00, metal 170.93, purchased 413.01, fasteners 154.40, consumables 401.91, bulk 87.29, touches 289.17.

Dollar deltas are against the baseline line. Mass is the empty sled (121.1 lb). "Q" = the new price is quoted with a link; "E" = still an estimate.

## A. Decided by Eric (implemented with the bundle)

| # | Change | $ | lb | Basis |
|---|---|---|---|---|
| A1 | Shop stock at $0: beech Dominos 5x30 and 8x50 (50.00), sandpaper (26.74), supplies lot (35.00), Titebond III (8.99), mineral spirits (6.60), contact cement (14.00), paracord for the chock and stop cords (34.00 roll) | −175.33 | 0 | owned |
| A2 | Drilled, epoxy-lined drain holes instead of 4 scuppers + 2 box drains (Standard; Extreme keeps nipples, really $10-13 each) | −31.20 | −0.18 | — |
| A3 | Rockler 6" lid support (pair) instead of the Sugatsune stay | −16.41 | ~0 | Q [S] $9.99 ($4.99 sale unconfirmed) |
| A4 | Brake bungee: 2 ft of 1/4" shock cord, not a 100 ft roll | ≈ −17 | 0 | Q Knot & Rope $0.19/ft [F] + shipping, or by the foot in store (E) |
| A5 | Chine tie Dominos dropped (fix: past the 1/3 rule); epoxy bed + screws locate | 0 | ~0 | — |
| A6 | Rail end into bulkhead 8x50 → 6x40 (fix: 1/3 rule); DF 500 sizes only | 0 | ~0 | — |
| | **Subtotal** | **≈ −240** | **−0.2** | |

## B. Price corrections (estimates replaced by quotes; no build change)

| Line | Was (E) | Now | Δ | Source |
|---|---|---|---|---|
| 5/8" 1045 rod, 60" | 40.00 | 34.04 | −5.96 | Speedy Metals cold-finished [F] (TGP 34.36) |
| 304 flat 1/4 x 2 (model asks 1-3/4; 2" is stock), 15" | 37.50 | 19.95 | −17.55 | Speedy by the inch [F] |
| 304 flat 1/8 x 2, 13" | 30.00 | 9.23 | −20.77 | Speedy [F] |
| 304 angle 1-1/2 x 1/8, 5" | 19.83 | 7.75 | −12.08 | Speedy [F] |
| 6061-T6 tube 1 x 1-1/2 x 1/8, 36" | 36.32 | 29.24 | −7.08 | Online Metals [F] |
| Etrailer D-ring (if kept) | 9.24 ea | 9.87 ea | +3.78 | etrailer [F] |
| Bronze sleeve 5/8 x 1 x 1-1/2 | 7.00 | 13.59 | +6.59 | cast bronze [S]; oil-embedded unpriced |
| Neoprene 3/8" pad stock | 8.00 | 15.59 | +7.59 | 6 x 12 sheet [S] |
| Kingpin set (grade 8 5/8 x 6, nylock, washers) | 9.00 | 5.00 | −4.00 | Bolt Depot [F] |
| Fasteners (thumb screws 18-8, screw eyes, #8-32 sets, pan heads, collars...) | — | — | ≈ +2 | Bolt Depot / Bolts and Nuts [F] |
| **Net** | | | **≈ −47** | Speedy shipping not read |

Not found (stay estimates): 1/16 x 1 stainless strip (nothing thinner than 1/8 stocked; ties into the open grab-board backing item), a #10-32 threaded insert for hardwood (the agent found T-nuts, not inserts), the 3/8" detent pin, clevis/lynch pins, 1/4" UHMW offcut, ribbed rubber tread, oil-embedded bronze.

**Fix that costs a little:** no stainless #6 x 2-1/2 wood screw exists (Bolt Depot, Bolts and Nuts). The 18 rail-to-chine and rib-knee screws become **#8 x 2-1/2 18-8** ($0.60, +$3.60). The rail-to-chine bearing edge is about 7/16", so a #8 leaves about 1/8" each side (the #6 left 0.14"); pilot it. Every wood screw is then a #8 (5/8, 1-1/4, 2-1/2): one gauge.

## C. Savings to choose (Standard), biggest first

| # | Saving | $ | lb | Build change | Risk |
|---|---|---|---|---|---|
| C1 | **Lumber from Peach State, 4/4 and 5/4 only** (FAS 4/4 $8.25, 5/4 $10.00 [F] PDF) | **−144** | 0 | 9 more parts face-laminated from 4/4 (tongue, chain joist, king beam, bow bulkhead, 2 seat wedges, 2 lid hinge backers, handlebow): more glue-ups, +4 fl oz epoxy (fits the kit) | "Level 2" tier and kiln-drying to confirm. Milder: same board plan at Peach State −52 (no extra laminations); 4/4 only −166 (23 laminated parts) |
| C2 | **1/4" birch plywood** (The Wood Yard $38 [F]) instead of 1/4" white oak ply ($113) for the webs, box, lid, signs | **−75** | ~0 | birch faces show between the oak bands and on the box and signs | glue and core not published (the white oak ply's aren't either): ask, look at the edge, measure. Same side-web assumptions (0.61) |
| C3 | **One U.S. Composites order:** 635 epoxy 2:1, 96 oz kit + pumps $61.95, fumed silica qt $4.60, 2" glass tape 20 ft $4.67 [F] | **−120** + shipping | 0 | thin resin: thicken every glue joint (silica is in the order); 96 oz vs 77 oz today | shipping not read; new-to-you epoxy (well regarded in boat building) |
| C4 | **Seat pads: 3 Harbor Freight EVA kneeling pads** ($7.99 [F], 11 x 18 x 1-1/2) + **Velcro Industrial 2" x 4 ft** ($7.52 [S]) instead of foam + vinyl ($80) and Dual Lock ($20) | **−69** | ~0 (pads about 1 lb each, model 2.4 lb) | seat 1-1/2" thick, not 2" (param change, checks re-run); cushion is two pieces edge-glued; no vinyl cover (EVA is closed-cell, sheds rain) | comfort and looks; milder: Velcro only −12 |
| C5 | **D-rings: Harbor Freight 1/4" cargo D-ring** 3 x 2-pack $8.97 [F] instead of 6 etrailer rings ($59.22 now) | **−50** | ~+0.1 | likely 1/4" bolts in place of the 4 #8-32 per ring (check the bracket) | rated 233 lb WLL, under the 300 lbf spec; the cargo straps pull 79 lbf a ring. Rated alternative: Need A Trailer Part 2,400 lb 4-packs −34 but +0.75 lb |
| C6 | **Lid gasket: Frost King EPDM 17 ft** (~$8.69 [S]) instead of a 25 ft Trim-Lok roll ($52.74) | **−44** | 0 | D-profile, not bulb; check the size against the lid gap | low |
| C7 | **Lights: Giant Recon 600 front ($41.95 [F]) + Planet Bike Spok rear ($21.99 [F])** instead of Cygolite 800 + Hotshot Pro ($103.90) | **−40** | **−0.45** | the printed clips are sized to the light (re-measure) | 600 lm is plenty at walking pace. Cheaper: Blackburn Dayblazer 400 + Click set $31.65 [S] (−72), dim rear, stock unconfirmed |
| C8 | **No stain or conditioner**: clear spar urethane over natural oak and okoume | **−36** | 0 | one finishing step fewer | looks: okoume reads pinkish-brown next to the oak |
| C9 | **Hinges: Everbilt 2-1/2" stainless pair $5.47 [S]** (box) and **Ace 2" stainless pair $12.99 [S]** (seat back) | **−22** | 0 | none | stainless grade not stated on the listings: check the package for 304 |
| C10 | **Sealant: Life-Calk 2.8 oz tube** ($15.69 [S]) instead of the 10.6 oz cartridge; the handle sockets are bedded in thickened epoxy (already bought) so the tube covers the grab-board strip and the gasket splice | **−11** | 0 | the sockets become glued-on for good (they never come off anyway) | low; the BOM counts about 5 oz of bedding, the tube is 2.8 oz without the sockets |
| C11 | **Edge banding: Band-It iron-on, 25 ft $9.99 [S]** (white oak if stocked; the listing is red oak) | −4 | 0 | none | color if only red oak is stocked |
| C12 | **Lid lettering: black oil-based paint marker** $4.90 [S] instead of a half pint of enamel | −4 | 0 | none | low |
| C13 | **Fewer bins:** every wood screw a #8 (with the fix above); the 1/4-20 hex bolts at one length (2-3/4, the 2-1/4 spots cut or left 1/2" long) | ≈ 0 | 0 | 4 bolt lengths → 3 | none |
| — | Not recommended: zinc or coated screws in hidden spots (−$5 at most; oak's tannin eats zinc); dropping D-rings or the gasket; thinner deck | | | | |

## D. Recommended bundle

A (decided) + B (corrections and the #8 fix) + C1 to C13: **about $1,396 + shipping on two online orders** (U.S. Composites, Speedy Metals), from $2,302.79 (−39%). Mass about −0.6 lb (121.1 → about 120.5).

If C4 (kneeling pads), C5 (233 lb rings) and C8 (no stain) are left out as matters of taste or spec: **about $1,551**.

Running total of the bundle: 2302.79 → A 2062.85 → B ~2015 → C1 1871 → C2 1796 → C3 1676 → C4 1608 → C5 1557 → C6 1513 → C7 1473 → C8 1437 → C9 1415 → C10 1404 → C11 1400 → C12 1396.

## E. Extreme-weather thin sheet

| Sheet | side-web | side-lateral | Empty lb | 4 x 8 price |
|---|---|---|---|---|
| 4 mm okoume (today) | 2.01 FAIL | 0.81 | 118.3 | $121.75 Aircraft Spruce |
| 3 mm Baltic | 4.84 FAIL | 0.80 | 118.3 | $40 (5 x 5, too short anyway) |
| 1/4" white oak ply | 0.61 | 0.78 | 121.1 | $113 Wood Yard; interior glue |
| **6 mm okoume BS 1088 (5-ply)** | **0.89** (4 mm-type values) / **0.29** (Bellotti EN 310 values) | 0.81 | **120.3** | **$158.65 Aircraft Spruce will-call [F]**; Boulter $98 + freight [F]; Boat Builder Central $145.08 [F] |
| 6 mm meranti BS 1088 | 0.44 (assumed values) | 0.78 | 124.8 | Boulter $86 + freight [F] |
| 6 mm Baltic, exterior | 0.32 (Metsä values) | 0.77 | 126.1 | Toledo Plywood $34.95 [F]; "exterior" stated, WBP not confirmed |

Recommendation: **6 mm okoume** — the lightest marine sheet that passes, with margin even on the conservative values. With it the chine ties would have taken 5x30s, and with beech Dominos from stock (Eric: epoxy-coated beech is fine) the Extreme spec buys no Sipo: Extreme ≈ $3,101 with the sheet alone, ≈ $2,987 with beech Dominos, lower with the shared savings. White oak ply in Extreme would put interior glue in the "stored outside" spec; meranti and Baltic are 4.5 and 5.8 lb heavier.

Implementation note: the okoume thin-sheet properties must be split from the 12 mm deck's (`okoumeMoePsi` is shared; lowering it in a scratch run made the deck marginal).
