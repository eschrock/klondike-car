# Price research, cost pass, October 2026

Accessed 2026-10-14. This is the cost pass: it replaces estimates with real prices and looks for cheaper credible options for the **Standard** weather spec, and it prices the thin sheet for the **Extreme** spec. It covers lumber and plywood (white oak, the thin sheet, the 12 mm deck sheet), metal stock, fasteners, purchased parts, and the epoxy and finishing consumables. Where it overlaps the two earlier files, **this file supersedes them**; those two stay as the record of the 2026-10-12 pass: `docs/price-research/price-research-standard-2026-10.md` (Standard spec) and `docs/price-research/price-research-2026-10.md` (Extreme spec). Nothing was bought. Machine-readable twin: `docs/price-research/price-research-cost-pass-2026-10.json` (same keys as the earlier JSON files, plus `eachUsd` and `tag` where the raw data has them; `spec` is `standard`, `extreme`, `both`, `reference` or `comparison`).

The **Recommended** tables below are the prices the bill of materials now uses. Three groups are not priced from a quote: shop stock Eric already owns (listed at $0), items removed from the Standard spec, and the items under "Still to quote", which stay estimates or NOT FOUND.

## How to read the evidence

- **[F]** the page (or PDF) was fetched and the price read from it. **[S]** the price came from a search snippet, not a fetched page. **[L]** manufacturer list price. Rows tagged NOT_FOUND or BLOCKED have no price.
- **Blocked or unreadable:** Home Depot, Lowe's, Ace, Walmart, Zoro, Modern Bike, MarineEngine, Academy Sports (403 or bot check; read through search snippets or, for Home Depot and Zoro, partly through the browser pane); Rockler (404 on fetch; snippet only); Backcountry / Competitive Cyclist (empty page); Sportsman's Warehouse (404); crlumber.com (403); Noah's Marine (prices in a JavaScript variant picker); Jamestown Distributors and CLC (no values returned); McMaster-Carr (JavaScript page never renders); Metals Depot (prices only after choosing a size in the cart; plain fetch 403); Fastenal and Grainger (403 or empty). Bolt Depot, Online Metals, Zoro and Home Depot were also read through the browser pane for the metal and fastener pass. No price is guessed.
- Search-engine snippets were sometimes stale (the Speedy Metals 5/8 1045 rod showed $16.33 in a snippet and $34.04 on the live page), so only fetched numbers carry [F].
- "Recommended" is the cheapest credible price at the right spec. A substitute is labelled as one. Prices exclude shipping and tax unless stated; the small online-only vendors (Knot & Rope Supply, U.S. Composites, Need A Trailer Part) ship from out of state, and their shipping was not read.
- Notes marked **BOM uses this** are the prices in the bill of materials; **RECOMMENDED** marks the cheapest credible raw-research pick where the BOM does not name it.

## Coverage

288 research rows (not counting the bending-data and blocked-site rows): **253 priced** (180 [F], 77 [S]), **26 NOT_FOUND**, **5 BLOCKED**, and the rest are ranges or notes without a single price; **69** carry a recommended flag (one or more per item and spec). New in this pass: the Peach State Lumber plywood PDF (7 priced sheets, plus two lines that are not offered: marine plywood, and edge banding in short lengths), Aircraft Spruce okoume in 4 mm and 6 mm (no 12 mm), and a Randall Brothers (Atlanta) line with nothing found online.

## Recommended prices the BOM uses

### Lumber and sheet

| Item | Vendor | Price | Note |
|---|---|---|---|
| White oak 4/4 FAS, rough | Peach State Lumber, Kennesaw | $8.25/bf [F] | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf>. Sheet "Hardwoods LEVEL 2", last updated 8/5, printed 9/9/2026. Confirm the walk-in tier and kiln drying. |
| White oak 5/4 FAS, rough | Peach State Lumber | $10.00/bf [F] | same sheet. Wood Vendors $10.20 (100+ bf, delivered extra) is the second real quote. |
| White oak 8/4 FAS | Peach State Lumber | $12.50/bf [F] | same sheet; listed, not bought (thicker parts are face-laminated). |
| White oak 6/4 | none in Atlanta | not bought | Wood Vendors $10.50/bf at 100+ bf [F]; Hickory & Oak (Michigan) $8.50/bf [F], freight unknown. |
| White oak, other Atlanta quote | The Wood Yard | 4/4 $10.00, 8/4 $15.00 [F] | no 5/4 or 6/4 on the list. |
| 6 mm Baltic birch 4x8 (Standard thin sheet) | Peach State Lumber | $49.00 [F] | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf>, "LAST UPDATED 8/9". Replaces the 4 mm okoume. |
| 6 mm okoume BS 1088 4x8 (Extreme thin sheet) | Aircraft Spruce | $158.65 [F] | part 02-00076, 5-ply. Boulter $98 [F] is lower (undated page, freight extra). |
| 12 mm marine plywood 4x8 (deck sheet) | The Wood Yard | $90.00 [F] | species and BS 1088 stamp not stated. Reference price; ask Peach State and Randall Brothers for 12 mm okoume BS 1088. |
| 1/4" white oak plywood 4x8 | The Wood Yard $113 [F]; Peach State B-2 white oak veneer core $75 [F] | option only | not in the build. |

### Metal stock

| Item | Vendor | Price | Note |
|---|---|---|---|
| 1045 cold-finished round, 5/8 x 60" | Speedy Metals | $34.04 [F] | <https://www.speedymetals.com/p-1651-x.aspx>; fixed 60" is cheaper than by the inch ($55.80). Online Metals: quote only. |
| 304 flat bar 1/4 x 2, 15" | Speedy Metals | $19.95 [F] | $1.33/in. 316 for Extreme: $29.10. |
| 304 flat bar 1/8 x 2, 13" | Speedy Metals | $9.23 [F] | $0.71/in. 316 for Extreme: $12.61. |
| 304 angle 1-1/2 x 1-1/2 x 1/8, 5" | Speedy Metals | $7.75 [F] | $1.55/in. 316 for Extreme: Online Metals $20.09 (12"). |
| 6061-T6 rectangular tube 1 x 1-1/2 x 1/8, 36" | Online Metals | $29.24 [F] | <https://www.onlinemetals.com/buy/x/pid/14469>. Speedy's 6063-T52 at $18.90 is weaker; not used. |

### Fasteners (Bolt Depot, Bolts and Nuts, Home Depot; per piece)

BD = Bolt Depot, B&N = Bolts and Nuts, HD = Home Depot. The per-piece prices apply at the BOM counts. The Standard column is 18-8 / 304 or zinc; the Extreme column is 316 where it exists. The `#8 x 2-1/2` 18-8 wood screw ($0.60 each) replaces the `#6 x 2-1/2`, which does not exist in stainless.

| Item | Standard (18-8/304/zinc) | Extreme (316) |
|---|---|---|
| 7. #6 x 2-1/2 flat-head wood screw (18) | #8 x 2-1/2 18-8 Phillips flat, 18 x $0.60 = $10.80 (no #6 x 2-1/2 in stainless) | 316 #8 x 2, 18 x $0.57 = $10.26 (no 2-1/2) |
| 8. #10-32 threaded insert, 5/16 long (14) | B&N zinc #10-32 x 5/16 T-nut 14 x $0.24 = $3.36 | 18-8 T-nut 14 x $1.05 = $14.70; 316 not found |
| 9. Thumb screw #10-32 (8) | BD zinc #10-32 x 1 thumb screw 8 x $0.21 = $1.68 | B&N 18-8 #10-32 x 1, 8 x $1.60 = $12.80 (no 7/8, no 316) |
| 10. #8 x 1-1/4 pan-head wood screw (8) | BD Type A pan 18-8 8 x $0.12 = $0.96 (or wood flat $2.32) | 316 Type A pan 8 x $0.24 = $1.92 (wood flat $3.84) |
| 11. #10 screw eye (8) | HD Everbilt SS screw eye 1/4 x 2, 4 packs of 2 = $6.28 | 316 not found |
| 12. 3/8-16 x 6-1/2 carriage bolt (2) | BD 18-8 3/8-16 x 6, 2 x $1.88 = $3.76 (6-1/2 is $4.89 each) | BD 316 x 6, 2 x $3.68 = $7.36 |
| 13. 1/4-20 x 2-3/4 hex bolt (4) | BD 4 x $0.50 = $2.00 | BD 316 4 x $0.93 = $3.72 |
| 14. 3/8-16 x 4 hex bolt 316 (8) | BD 18-8 8 x $1.37 = $10.96 | BD 316 8 x $2.36 = $18.88 |
| 15. 5/32 x 1-1/2 cotter pin (4) | BD 4 x $0.32 = $1.28 | Zoro 316 25-pack $21.19 |
| 16. #10-32 x 3/8 flat-head machine screw (6) | BD 6 x $0.13 = $0.78 | BD 316 6 x $0.12 = $0.72 |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | BD flat head set 24 x ($0.27 + $0.15 + $0.10) = $12.48 (pan $13.20) | 316 flat set 24 x ($0.28 + $0.21 + $0.16) = $15.60 (pan $17.76) |
| 18. M3/M4 screws (2 each), heat-set inserts (2 each) | BD M3x8 2 x $0.05, M4x10 2 x $0.08; Adafruit M3 50-pack $5.95; Prusa M4 50-pack $11.99 | same |
| 19. 1/4 nylon flat washer (4) | BD nylon 1/4 washer 4 x $0.09 = $0.36 | same |
| 20. 5/8 bore set-screw collar (4) | Penn Tool Climax C-062 4 x $4.52 = $18.08 | Newegg/Zoro CRC-062-S 316, 4 x $19.89 = $79.56 (+$5 ship) |
| 21. 3/8 x 2-1/4 316 rod / clevis pin (2) | n/a | Speedy 316 3/8 rod 5 in $4.55 (or Zoro clevis pins $2.49 each, may need 8) |
| 22. 5/8-11 x 6 grade 8 bolt + nylock + 2 washers | BD grade 8 bolt $4.14 + zinc nylock $0.56 + 2 SAE washers $0.30 = $5.00 | same |
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | BD 2 x $11.10 + 2 x $11.94 = $46.08 (HD 5-packs $59.96 for 10; Ace/Marine Engine about $9.98 for 2-1/2 in [S]) | same (HDG only) |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | See item 24 table | |
| 25. #8 x 1-1/4 exterior wood screws, coated vs 18-8 | HD Deckmate #8 x 1-1/4 star, 186 pc $10.97 ($0.059 each) vs 18-8 $0.29 each | |

### Purchased parts

| Item | Vendor | Price | Note |
|---|---|---|---|
| Front light, Giant Recon 600 USB (87 g) | Bicycle Warehouse | $41.95 [F] | |
| Rear light, Planet Bike Spok USB | Bicycle Warehouse | $21.99 [F] | |
| Kneeling pad, Harbor Freight EVA #56572 (1-1/2") | Harbor Freight | $7.99 each [F], 3 | two for the seat, one for the back |
| Hook-and-loop, Velcro Industrial 2" x 4 ft (replaces Dual Lock) | Blue Dog Ink / Walmart / Home Depot | $7.52 [S] | weaker in peel than Dual Lock |
| Cargo D-ring 1/4", 2-pack #60319 | Harbor Freight | $2.99 per pack [F], 3 packs | 233 lb working load, 700 lb break; verify the bracket holes |
| Lid gasket, Frost King EPDM D-profile, 17 ft | Home Depot | $8.69 [S] | |
| Lid stay, Rockler 6" medium-duty pair (#39529) | Rockler | $9.99 [S] | Standard; Extreme keeps the Sugatsune S-93L at $26.40 [F] |
| Shock cord 1/4" (brake return) | Knot & Rope Supply | $0.19/ft [F] | plus shipping |
| Storage-box hinges, Everbilt 2-1/2" stainless pair | Home Depot | $5.47 [S] | stainless grade not stated |
| Seat-back hinge, 2" stainless tight-pin pair | Ace Hardware | $12.99 [S] | stainless grade not stated |
| Edge banding, Band-It red oak 3/4" x 25 ft | Ace Hardware | $9.99 [S] | |
| Lettering paint, Sharpie oil-based paint marker | Walmart | $4.90 [S] | |
| Drain holes | none | $0 | Standard drills and epoxy-lines the holes; real 304 nipples cost $10-13 each (Extreme keeps them) |

### Consumables

| Item | Vendor | Price | Note |
|---|---|---|---|
| Epoxy 635 thin 2:1, 64 + 32 oz (96 oz) | U.S. Composites | $53.45 [F] | plus 2:1 pumps $8.50 = $61.95. List dated 2026-08-07. Thin resin: joints and fillets need thickener. Shipping not read. |
| Fumed silica, 1 qt | U.S. Composites | $4.60 [F] | volume, not weight |
| Glass tape, 2" | U.S. Composites | $0.70/yd [F] | 20 ft = $4.67 |
| Bedding sealant, Life-Calk 2.8 oz | BoatLIFE | $15.69 [S] | handle sockets are bedded in thickened epoxy instead |
| Spar urethane, Minwax Helmsman quart | Walmart | $22.88 [S] | raw-research pick; one quart per 100 ft2 |

### Shop stock Eric owns ($0, "from existing shop stock") and removed lines

- **Owned:** beech Dominos (all sizes, both specs; epoxied in under Extreme), sandpaper, the supplies lot (brushes, rollers, cups, gloves), Titebond III, mineral spirits, contact cement, paracord (chock cords and brake stop cords). The bridle rope stays a bought part (3/8" three-strand nylon, the weak link).
- **Removed from the Standard spec:** stain and pre-stain conditioner (clear finish only); scuppers and box drain nipples (drilled holes instead).

## Still to quote

Items no one could price online; each stays an estimate in the BOM or is bought by phone or in person.

- **12 mm okoume BS 1088, 4x8, locally.** Peach State lists no marine sheet (the PDF has birch and white oak veneer-core and fiber-core sheets and a 12 mm Baltic birch at $80.25); Aircraft Spruce has okoume only in 4 and 6 mm; Randall Brothers (Atlanta) showed nothing online (site did not render, searches empty). The Wood Yard's "Marine Grade" 1/2" at $90 is the reference; Boulter okoume 12 mm 9-ply is $150 [F].
- **1/16 x 1 stainless strip.** Not at Speedy Metals or Online Metals (smallest 1/8"); McMaster blocked. Fallback 304 1/8 x 1, 13" is $5.33 [F] (twice as thick); 316 $6.37 [F].
- **#10-32 hardwood threaded inserts** in 3/8" and 5/16" lengths. The priced substitute is the 3-prong T-nut, zinc $0.24 each (18-8 $1.05); Bolt Depot's brass hardwood insert is $1.52 each; stainless #10-32 inserts and 316 tee nuts were not found.
- **3/8" detent pins** (1-1/2" usable, ideally with a lanyard): Zoro stainless detent hitch pin $2.35 each, sold in 9s ($21.15) [S]; no 2-pack found.
- **Clevis and lynch pins** (3/8 x 2): SC Fastening zinc, 25-pack, $14.64 [S]; no 2-pack found.
- **1/4" UHMW offcut** (2 x 6): none sold; cut from the 1/2" piece (eBay 1/2 x 4 x 12, $15.94 [S]).
- **Ribbed rubber tread**, 1/8", 4 x 5: none found (idea: stair tread or door-mat scrap).
- **Oil-embedded bronze sleeve bearing**, 5/8 x 1 x 1-1/2: price hidden at McMaster and Applied; the cast (not oil-embedded) Bunting EBCB101612 is $13.59 [S].
- **Peach State "Level 2" tier.** The Peach State lumber sheet is marked "Hardwoods LEVEL 2"; the tier is not explained, and the plywood PDF carries no tier mark. Ask whether it is the retail or the contractor price and whether the oak is kiln dried. (770) 428-3622, 4000 Moon Station Rd NW, Kennesaw GA.
- Also unpriced: shipping for the small online vendors; U.S. Composites 635 blush and cure data; the 6/4 white oak in Atlanta; Jamestown marine epoxy; butyl tape; a 5x10 Baltic birch sheet; Joubert measured bending values; any meranti BS 1088 strength data.

## 1 White oak, rough kiln-dried

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| White oak 4/4 | both | Peach State Lumber Products (Kennesaw, GA) | FAS White Oak 4/4, rough (drying not stated on sheet), price sheet 'last updated 8/5', printed 9/9/2026 | per bf | $8.25 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf> | **BOM uses this.** PDF fetched and text-extracted. Sheet marks 'Hardwoods LEVEL 2' (tier meaning unexplained; call to confirm retail vs contractor). Site: peachstatelumber.com/pricing-info, (770) 428-3622, 4000 Moon Station Rd NW, Kennesaw GA. |
| White oak 5/4 | both | Peach State Lumber Products (Kennesaw, GA) | FAS White Oak 5/4, price sheet 'last updated 8/5', printed 9/9/2026 | per bf | $10.00 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf> | **BOM uses this.** Column header 5/4. Near Atlanta (about 25 mi NW). Drying not stated on sheet; ask. Sheet says prices subject to change. |
| White oak 6/4 | both | Peach State Lumber Products (Kennesaw, GA) | FAS White Oak, 6/4 not on the sheet | per bf | n/a | NOT_FOUND | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf> | 6/4 is not bought. Sheet has only 4/4, 5/4, 8/4 columns and states 'some species available in 6/4, 10/4, 12/4 & 16/4' (hardwoods note reads 6/4, 10/4, 12/4, 16/4). Call for a 6/4 white oak quote. |
| White oak 8/4 | both | Peach State Lumber Products (Kennesaw, GA) | FAS White Oak 8/4, price sheet 'last updated 8/5', printed 9/9/2026 | per bf | $12.50 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf> | Listed but not bought (4/4 and 5/4 only; thicker parts are face-laminated). Cheapest 8/4 in the Atlanta area found, but see wo-8/4-woodyard ($15) for in-town. Peach State recommended for 8/4 on price. |
| White oak 4/4 | both | The Wood Yard (Atlanta area) | White Oak 4/4 (grade not stated); knotty 4/4 'CG' is $7.50; quartersawn 4/4 $14.50 | per bf | $10.00 | F | <https://thewoodyard.com/current-pricing-list/> | Page says base prices valid for in-store purchase only, updated October 2026; no unit printed (assumed per bf). Confirmed list: 4/4 $10, 4/4 knotty $7.50, 8/4 $15, 12/4 $25, QS 4/4 $14.50. NO 5/4 and NO 6/4 on the list. |
| White oak 8/4 | both | The Wood Yard (Atlanta area) | White Oak 8/4 (grade not stated) | per bf | $15.00 | F | <https://thewoodyard.com/current-pricing-list/> | In-store base price, October 2026. |
| White oak 5/4 and 6/4 | both | The Wood Yard (Atlanta area) | Not listed | per bf | n/a | NOT_FOUND | <https://thewoodyard.com/current-pricing-list/> | Confirmed the current list has no 5/4 or 6/4 white oak line. |
| White oak 5/4 | both | Wood Vendors (online; ship-from location not stated) | White oak flat sawn 5/4, 84-100% clear, rough, kiln dried, random widths 5"+, lengths 7'+ | per bf | $10.20 | F | <https://woodvendors.com/white-oak-lumber/> | Tier 100-249 bf $10.20; 250-499 $7.70; 500-999 $7.20; 1000+ $6.70. Page stamped 'as of Oct 14, 2026'. Delivered price needs the page calculator (ZIP). Minimum appears to be 100 bf. Quartersawn/rift 5/4 is $16.35 at 100-249 bf. |
| White oak 6/4 | both | Wood Vendors (online; ship-from location not stated) | White oak flat sawn 6/4, 84-100% clear, rough, kiln dried, random widths 5"+, lengths 7'+ | per bf | $10.50 | F | <https://woodvendors.com/white-oak-lumber/> | Best documented 6/4 quote but not bought (no 6/4 in the BOM). Tier 100-249 bf $10.50; 250-499 $8.00; 500-999 $7.50; 1000+ $7.00. Page stamped 'as of Oct 14, 2026'. Best-documented current 6/4 quote; freight extra (use page calculator). Minimum appears to be 100 bf. |
| White oak 4/4 and 8/4 | both | Wood Vendors | Same page, flat sawn rough KD | per bf | n/a | F | <https://woodvendors.com/white-oak-lumber/> | 4/4 at 100-249 bf $9.25; 8/4 $12.85 (usd left null: see notes, tiers in wo-5/4 and wo-6/4 rows). |
| White oak 6/4 | both | Hickory & Oak (Decatur, Michigan) | White oak 6/4, rough sawn, kiln dried, Select & Better | per bf | $8.50 | F | <http://www.hickoryandoak.com/prices.php> | Cheapest 6/4 found but not bought. Page headed '2026 Lumber price sheet'. 4/4 $7.50, 6/4 $8.50, 8/4 $12.00, no 5/4. 15% discount at 100 bf or more. Freight from Michigan to Atlanta not stated; cheapest 6/4 found but delivered cost unknown. Select & Better, not FAS. |
| White oak 4/4 and 8/4 | both | Hickory & Oak (Decatur, Michigan) | Rough KD Select & Better | per bf | n/a | F | <http://www.hickoryandoak.com/prices.php> | 4/4 $7.50; 8/4 $12.00 (see wo-6/4-hickoryandoak). No 5/4 line. |
| White oak 6/4 | both | Alderfer Lumber (PA) | White oak FAS, rough cut, kiln dried 7-10% MC, 25 bf pack, boards at least 6" wide | per bf | $9.10 | F | <https://alderferlumber.com/products/white-oak-hardwood-lumber-top-grade-fas> | SOLD OUT when fetched. Same page: 4/4 $7.75, 5/4 $8.65, 8/4 $10.75, 10/4 $12.10. Shipping calculated at checkout. 5/4 at $8.65 is the cheapest 5/4 seen but sold out. |
| White oak 5/4 | both | Alderfer Lumber (PA) | White oak FAS, rough cut, KD, 25 bf pack | per bf | $8.65 | F | <https://alderferlumber.com/products/white-oak-hardwood-lumber-top-grade-fas> | SOLD OUT when fetched; freight not included. |
| White oak 6/4 | both | Plywood Company (Fort Worth, TX) | White oak 6/4 rough, FAS, random widths 8-16 ft, drying not stated | per bf | $10.21 | F | <https://www.plywoodcompany.com/pd/white-oak-6-4/562> | All lengths out of stock when fetched. A search snippet had shown $10.61; the fetched page shows $10.21. |
| White oak 6/4 | both | Woodworkers Source (Phoenix AZ) | White oak flat sawn 6/4 S2S (1-5/16"), Select & Better | per bf | $12.99 | F | <https://www.woodworkerssource.com/white-oak-flat-sawn/white-oak-flat-sawn-64-lumber.html> | Surfaced 2 sides, not rough. Temporarily out of stock (restock 10/18/2026). No quantity tiers on the page (a snippet claimed $9.74 at 100+ bf; not on the fetched page). Size requests +$1.50/bf. Boards over 7 ft ship by truck freight. |
| White oak 8/4 | both | Woodworkers Source (Phoenix AZ) | White oak flat sawn 8/4 S2S (1-13/16"), Select & Better | per bf | $16.99 | F | <https://www.woodworkerssource.com/white-oak-flat-sawn/white-oak-flat-sawn-84-lumber.html> | Surfaced. 4/4 S2S is $9.99 (wo44 page). 5/4 page returned 404. |
| White oak 4/4, 5/4, 6/4, 8/4 | both | Cline Lumber (Georgia/Tennessee; far from Atlanta) | Kiln dried white oak FAS, <100 bf column: 4/4 $7.52, 5/4 $9.17, 6/4 $10.82, 8/4 $11.72; 500+ bf column: 5.49, 6.36, 8.01, 8.91 | per bf (net tally) | $10.82 | F | <https://clinelumber.com/products/kiln-dried-hardwood/white-oak/> | STALE: page says 'Pricing updated: January 2023'. 100-500 bf column: 6.41 / 6.95 / 9.04 / 9.94. usd shown is the 6/4 <100 bf price. Phone 706-259-3241. |
| White oak 4/4, 5/4, 8/4 (no 6/4) | both | Hearne Hardwoods (PA) | White oak Common & FAS, rough sawn, 4/4, 5/4, 8/4, 12/4 | per bf | n/a | F | <https://www.hearnehardwoods.com/price-list> | Page dated 2026-09-28 gives only a range ($6.50-19.50 per bf across thicknesses and grades; QS $12.50-19.00), no per-thickness price, so usd null. No 6/4 listed. |
| White oak | both | Ocooch Hardwoods (WI) | White oak, Select & Better, rough or S2S; thicknesses 4/4 and 8/4 only | per bf | n/a | NOT_FOUND | <https://ocoochhardwoods.com/WhiteOak/> | Page showed only $8.90/bf for 13/16" S2S 47" lengths; no 5/4 or 6/4 offered; rough prices not readable (variant selector). |
| White oak 5/4, 6/4 | both | Advantage Lumber | White oak 5/4 $9.90, 6/4 $10.60 (page gives no unit, grade, drying or surfacing) | unknown (likely per bf) | n/a | S | <https://www.advantagelumber.com/whiteoak.htm> | Numbers read from the page, but unit, grade and rough/S2S not stated, so not used. 5/4 #1 $7.10, 6/4 #1 $7.80, QS 5/4 $13.00, QS 6/4 $13.55. Phone 1-877-232-3915. |
| White oak (other Atlanta yards) | both | Atlanta Hardwoods; Highland Woodworking; Hardwood Inc. | No published price list | per bf | n/a | NOT_FOUND | <https://www.atlantahardwoods.com> | Atlanta Hardwoods: quote form only, (678) 848-4024. Highland Woodworking list is dated 8/1/2009 (stale; QS 4/4 $7.90, QS 8/4 $9.90). hardwoodinc.com is a parked domain. Bell Forest (bellforest.com) is a parked domain. Hearne see above. |

## 2 Plywood, 4 x 8 sheets

Peach State rows come from their plywood PDF (<https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf>, "LAST UPDATED 8/9", read 2026-10-14 [F]): 1/4" import C-2 white birch VC $27.00; 1/4" 6 mm Baltic birch 4x8 $49.00 and 5x5 $33.00; 1/2" 12 mm Baltic birch 4x8 $80.25; 1/4" B-2 white oak VC $75.00 and FC (fiber core) $93.25; 1/2" B-2 P/S white oak VC $89.75. No marine, okoume or meranti is listed. Toledo Plywood's trucks deliver within 80 miles only; the Baltic birch glue (exterior or interior) is unconfirmed at every vendor.

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 6 mm okoume BS 1088, 4x8 | extreme | Boulter Plywood | Okoume A/B BS1088, 1/4" (6 mm), 5-ply, 4x8 | per sheet | $98.00 | F | <https://www.boulterplywood.com/MarinePlywood_4.htm> | Lower price than Aircraft Spruce but not used: undated page, freight extra. Page undated; quantity discounts mentioned, no shipping info (call 888-958-6237). Freight on a full sheet to Atlanta will be significant. Same page: 5 mm $95 (5-ply), 4 mm $70 (3-ply), 7 mm $104, 9 mm $114 (7-ply), 12 mm $150 (9-ply). |
| 6 mm okoume BS 1088, 4x8 | extreme | Boat Builder Central (FL) | Okoume BS1088 Lloyd's certified, 6 mm, 99 x 48 in, WBP glue, 25 lb | per sheet | $145.08 | F | <https://boatbuildercentral.com/?p=79> | Ply count not stated. Shipping calculated for continental US at checkout (phone 772-742-8535). A search snippet had shown $112; fetched page shows $145.08. |
| 6 mm okoume BS 1088, 4x8 | extreme | Aircraft Spruce | Okoume plywood 6 mm, 4x8, BS1088, part 02-00076, 5-ply | per sheet | $158.65 | F | <https://www.aircraftspruce.com/catalog/wppages/okume.php> | **BOM uses this** (Extreme thin sheet, part 02-00076). Boulter at $98 is lower but its page is undated and freight is extra. 4 mm (part 02-20100, 3-ply, about 14.5 lb) is $121.75 on the same page (the brief's reference was $122). Sheets may be cut down for shipping. |
| 6 mm okoume BS 1088, 4x8 | extreme | Fiberglass Supply | 6MM Okoume Marine Plywood BS1088, 4x8 | per sheet | $180.60 | F | <https://fiberglasssupply.com/core-materials/marine-plywood/> | Also 3 mm $139.75, 4 mm $138.98, 9 mm $216.72. No shipping info on page. |
| 5 mm okoume BS 1088, 4x8 | extreme | Boulter Plywood | Okoume A/B BS1088, 3/16" (5 mm), 5-ply | per sheet | $95.00 | F | <https://www.boulterplywood.com/MarinePlywood_4.htm> | Page undated. |
| 4 mm okoume BS 1088, 4x8 | extreme | Boulter Plywood | Okoume A/B BS1088, 5/32" (4 mm), 3-ply | per sheet | $70.00 | F | <https://www.boulterplywood.com/MarinePlywood_4.htm> | Page undated. Compare Aircraft Spruce 4 mm $121.75 [F]. |
| 4 mm okoume BS 1088, 4x8 | extreme | Wood-Source | Okoume Marine Plywood E4818OKOUME, 4 mm, 3-ply, 4x8, BS1088 | per sheet | n/a | NOT_FOUND | <https://wood-source.com/?p=55632> | Page says contact a salesperson for price (a snippet claimed $89.90); special order, 3-week lead time; no 5/6 mm listed. |
| 4 mm okoume BS 1088, 4x8 | extreme | Aircraft Spruce | Okoume marine plywood, 4 mm, 3-ply (02-20100) | per sheet | $121.75 | F | <https://www.aircraftspruce.com/catalog/wppages/okume.php> | Fails the side-web row, so not used. Read 2026-10-14. |
| 12 mm okoume BS 1088, 4x8 | both | Boulter Plywood | Okoume A/B BS1088, 1/2" (12 mm), 9-ply | per sheet | $150.00 | F | <https://www.boulterplywood.com/MarinePlywood_4.htm> | Page undated. |
| 12 mm marine plywood 4x8 | both | Fiberglass Supply | 12mm HYDROTEK BS1088 9-ply (species not stated) | per sheet | $209.43 | F | <https://fiberglasssupply.com/core-materials/marine-plywood/> |  |
| 12 mm okoume BS 1088, 4x8 | both | Aircraft Spruce | okoume listed only in 4 mm (02-20100, $121.75) and 6 mm (02-00076, $158.65) | - | n/a | NOT_FOUND | <https://www.aircraftspruce.com/catalog/wppages/okume.php> | No 12 mm okoume at Aircraft Spruce. |
| 12 mm okoume BS 1088, 4x8 | both | Randall Brothers (Atlanta) | nothing found online (site did not render, searches empty) | - | n/a | NOT_FOUND | - | To call. No URL was read. |
| 6 mm meranti BS 1088, 4x8 | extreme | Boulter Plywood | Meranti A/B (Hydroteck) BS1088, 1/4" (6 mm), 5-ply | per sheet | $86.00 | F | <https://www.boulterplywood.com/MarinePlywood_4.htm> | Page undated. 4 mm $70 (3-ply), 9 mm $122 (7-ply), 12 mm $152 (9-ply). |
| 6 mm meranti BS 1088, 4x8 | extreme | Fiberglass Supply | 6mm HYDROTEK Meranti BS1088, 5-ply, 4x8 | per sheet | $149.28 | F | <https://fiberglasssupply.com/core-materials/marine-plywood/> | 9 mm Hydrotek 7-ply $179.38. |
| 6 mm (1/4") Baltic birch, 4x8 | standard | Toledo Plywood (Ohio) | Baltic Birch 1/4" BB/BB, 5-ply, 4x8; page says 4x8 Baltic uses exterior glue | per sheet | $34.95 | F | <https://www.toledoplywood.com/product-category/categories/hardwoods/baltic-birch/> | Lower price but not used: exterior glue and freight to Atlanta unconfirmed. Peach State is local. Glue per sheet inferred from a page-wide note about 4x8 Baltic, not named WBP/phenolic: confirm before ordering. Same page 5x5 1/4" BB/BB 5-ply $26.95 (INTERIOR glue); 5x5 is too short for 61"+ webs. Trucks deliver within 80 miles of Toledo; no out-of-area rates, so freight to Atlanta must be quoted. Page undated. |
| 6 mm Baltic birch 5x5 | standard | Toledo Plywood (Ohio) | Baltic Birch 1/4" BB/BB, 5-ply, 5x5, interior glue | per sheet | $26.95 | F | <https://www.toledoplywood.com/product-category/categories/hardwoods/baltic-birch/> | 5x5 too short for the 61"+ side webs. B/BB no-patch version $29.95. |
| 1/4" Baltic birch | standard | The Wood Yard (Atlanta area) | Baltic 1/4" (6 mm); size and glue not stated | per sheet (assumed) | $58.00 | F | <https://thewoodyard.com/current-pricing-list/> | In-store base price. Same page Baltic 1/8" $40, 1/2" $79, 3/4" $98. Ask sheet size (likely 5x5) and glue. |
| 1/4" Baltic birch | standard | Woodworkers Source | 1/4" Baltic birch BB/BB pre-cut pack, 25 sq ft, 5-ply, INTERIOR-rated adhesive | per pack | $79.00 | F | <https://www.woodworkerssource.com/plywood/14-baltic-birch-plywood-pack-choose-your-size.html> | Not a full sheet; interior glue. Useful only as evidence that much Baltic birch is interior glue. |
| Baltic birch WBP 4x8 | standard | Berta Store (NJ) | Baltic birch BB/BB WBP glue 4x8; thicknesses 3/16", 1/2", 3/4", 7/8" (no 1/4") | per sheet | n/a | NOT_FOUND | <https://bertastore.com/products/baltic-birch-plywood-bb-bb> | $99.90/sheet for 1-9 sheets is for the thicknesses it lists, no 1/4". |
| 6 mm Baltic birch 4x8 | standard | Wood Vault (Ottawa, Canada) | 1/4" (6 mm) Baltic birch 4x8 standard grade, glue not stated | per sheet (CAD) | n/a | NOT_FOUND | <https://woodvault.com/products/baltic-birch-4-x-8> | Priced $98.95 CAD; Canadian shipping only quoted; not used. |
| 6 mm (1/4") Baltic birch, 4x8 | standard | Peach State Lumber Products (Kennesaw, GA) | 1/4 x 4x8, 6 mm Baltic birch | per sheet | $49.00 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | **BOM uses this** (Standard thin sheet). Plywood PDF "LAST UPDATED 8/9", read 2026-10-14. Glue not stated (probably interior; the sled is garage-kept and sealed). (770) 428-3622. |
| 6 mm Baltic birch, 5x5 | standard | Peach State Lumber Products (Kennesaw, GA) | 1/4 x 5x5, 6 mm Baltic birch | per sheet | $33.00 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Too short for the webs (needs 8 ft). Same PDF. |
| 12 mm (1/2") Baltic birch, 4x8 | standard | Peach State Lumber Products (Kennesaw, GA) | 1/2 x 4x8, 12 mm Baltic birch | per sheet | $80.25 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Baltic birch, not marine; same PDF. The 12 mm deck sheet stays the marine reference. |
| 1/4" import white birch, 4x8 | standard | Peach State Lumber Products (Kennesaw, GA) | 1/4 x 4x8 (IMPORT) C-2 white birch VC (veneer core) | per sheet | $27.00 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Cheapest 1/4" sheet found; thin, with a C-2 face. Not used. Same PDF. |
| 1/4" white oak plywood, 4x8 | both | Peach State Lumber Products (Kennesaw, GA) | 1/4 x 4x8 B-2 white oak VC (veneer core) | per sheet | $75.00 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Option only; lower than the Wood Yard at $113. Same PDF. |
| 1/4" white oak plywood, fiber core, 4x8 | both | Peach State Lumber Products (Kennesaw, GA) | 1/4 x 4x8 B-2 white oak FC (fiber core) | per sheet | $93.25 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Same PDF. |
| 1/2" white oak plywood, 4x8 | both | Peach State Lumber Products (Kennesaw, GA) | 1/2 x 4x8 B-2 P/S white oak VC (veneer core) | per sheet | $89.75 | F | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Same PDF. |
| Marine / okoume / meranti plywood | both | Peach State Lumber Products (Kennesaw, GA) | none listed (3/4 meranti N/A) | - | n/a | NOT_FOUND | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | The plywood PDF lists no marine, okoume or meranti sheet. Ask by phone about 12 mm okoume BS 1088. |
| Edge banding | both | Peach State Lumber Products (Kennesaw, GA) | edge banding, 250 ft rolls only | - | n/a | NOT_FOUND | <https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf> | Sold only in 250 ft rolls (no short length); the 25 ft Ace roll stays the pick. |
| 1/4" domestic hardwood plywood 4x8 (HD/Lowe's) | both | Home Depot; Lowe's | Columbia PureBond birch/maple 1/4 x 4x8 (HD 100092485); Sande 1/4 x 4x8 (HD 203414042); Patriot 1/4 sanded (Lowe's) | per sheet | n/a | BLOCKED | <https://www.homedepot.com/p/Columbia-Forest-Products-1-4-in-x-4-ft-x-8-ft-PureBond-Birch-Plywood-165891/100092485> | homedepot.com and lowes.com return 403 to fetch; search snippets gave no 4x8 1/4 price. Glue type and ply count not verified (page unreadable). Do It Best / True Value 1/4 birch and lauan pages loaded but showed no price. |
| 1/4" hardwood plywood 4x8 (Atlanta) | both | The Wood Yard (Atlanta area) | 1/4" (6 mm): Birch $38, Baltic $58, Mahogany $68, Maple $75, Red oak $79, Cherry $89, White oak $113, Walnut $135, Birch prefinished $44, MDF $45 | per sheet (assumed 4x8) | $38.00 | F | <https://thewoodyard.com/current-pricing-list/> | Not used. In-store base price. Cheapest 1/4" hardwood ply at an Atlanta-area yard is birch $38 (usd = this). Glue type and ply count not stated; ask. |
| 1/4" white oak plywood 4x8 | both | The Wood Yard (Atlanta area) | White oak plywood 1/4" (6 mm) | per sheet | $113.00 | F | <https://thewoodyard.com/current-pricing-list/> | Option only (Peach State B-2 white oak VC at $75 is lower, see the Peach State rows). No cheaper US price found. Mason's Mill & Lumber stocks 1/4" white oak ply (veneer or MDF core, 4x8/4x10) but quotes by email only; Wood Vault lists $79.95 CAD for MDF core (not comparable). |
| 12 mm marine plywood 4x8 | both | The Wood Yard (Atlanta area) | Marine Grade 1/2" (12 mm); species and standard not stated on the list | per sheet | $90.00 | F | <https://thewoodyard.com/current-pricing-list/> | **BOM keeps this as the reference.** May be sourced elsewhere: ask Peach State or Randall Brothers for 12 mm okoume BS 1088. In-store base price. 3/4" Marine Grade $160. Verify okoume and BS1088 stamp. |
| 6 mm okoume BS 1088, 4x8 | extreme | Noah's Marine (Toronto) | BS 1088 Lloyd's European Okoume 48x98.5 and 60x120 | per sheet | n/a | BLOCKED | <https://noahsmarine.com/collections/okoume> | Prices are variant-selector JS (page showed a placeholder $28.43), currency not stated (likely CAD). Not usable. |
| 6 mm okoume BS 1088, 4x8 | extreme | Jamestown Distributors; Chesapeake Light Craft | - | per sheet | n/a | BLOCKED | <https://clcboats.com/products/okoume-marine-plywood> | Jamestown listing returned no values; CLC page returned navigation only (JS-rendered). CLC says full sheets ship individually or by pallet, shipping starts around $200 (snippet). |

## 3 Bending properties of thin plywood

Backs the thin-sheet choice for the side webs (bending across the face grain). Units are N/mm2 (MPa); "long" is along the face grain, "cross" across it.

Long = along the face grain; cross = across it (the web case: bending across the face grain).

| Source | Thickness / plies | MOR long | MOR cross | E long | E cross |
|---|---|---|---|---|---|
| Bellotti okoume marine, EN 310 [F] ([PDF](https://bellottispa.com/wp-content/uploads/pdf/datasheets/TDS-C-Okoume-Marine_R05_EN.pdf)) | 4 mm, 3 layers | 48 | 16 | 7700 | 4200 |
| same | 6 mm, 5 layers | 35 | 32 | 4650 | 3770 |
| Metsä Wood birch, DoP ([PDF](https://www.metsagroup.com/globalassets/metsa-wood/dop-documents/dop_metsa_wood_birch_plywood_muf_2019-12-2_en.pdf)) [F] | 4 mm, 3 plies | 65.9 (char.) | 10.6 (char.) | 16471 (mean) | 1029 (mean) |
| same | 6.5 mm, 5 plies | 50.9 (char.) | 29.0 (char.) | 12737 (mean) | 4763 (mean) |
| Robbins "Elite" marine ply, UK ([PDF](https://www.robbins.co.uk/wp-content/uploads/2022/02/Marine-Plywood-Technical-Data.pdf)) [F] | thickness and species not given | 26 | 34 | 3300 | 3900 |
| Robbins "Super Elite+" marine ply | same | 52 | 45 | 6200 | 5200 |

Notes:
- Joubert okoume BS 1088: ply count 4 mm = 3-ply, 6 mm = 5-ply (spec sheet via [Atlantic Plywood](https://www.atlanticplywood.com/wp-content/uploads/2019/10/Joubert-Okoume-Plywood-Specifications.pdf), 2010) [F]. Joubert publishes no measured MOR or E. Its declarations of performance ([6 mm](https://www.joubert-group.com/wp-content/uploads/joubert-dop/en/MARINE-PLY-DoP-6mm-K1-EN.pdf), [4 mm](https://www.joubert-group.com/wp-content/uploads/joubert-dop/en/MARINE-PLY-DoP-4mm-K1-EN.pdf), dated 1 July 2013) give only EN 636 classes: 6 mm bending strength class F30/10 and stiffness class E40/15; 4 mm has no bending class declared (non-structural below 6 mm). Under EN 636 convention these read as characteristic strength 30 parallel / 10 perpendicular N/mm2 and stiffness 40/15 in units of 100 N/mm2 (4000/1500); this reading is not printed in the DoP and should be checked against EN 636.
- Metsä DoP fetched is the MUF (melamine-reinforced UF, interior gluing, EN 636-1 dry use) birch; the PDF also lists bonding quality class 3. Strengths are characteristic (5th percentile); moduli are mean values. The 4 mm 3-ply is very weak across the grain (10.6 N/mm2, E about 1000) while the 5-ply 6.5 mm keeps 29.0 and 4763: this matters for webs bent across the face grain.
- Bellotti's 4 mm cross-grain E (4200) is oddly high next to Metsä's 3-ply (1029); Bellotti says its values are indicative. Both okoume 3-ply and birch 3-ply are weak across grain by lamination logic; do not rely on the Bellotti 4 mm cross figures without a test.
- Meranti BS 1088 6 mm: NOT FOUND (BS 1088 carries no strength data; supplier sheets give density only).

- Joubert okoume BS 1088: 4 mm is 3-ply and 6 mm is 5-ply (spec sheet via [Atlantic Plywood](https://www.atlanticplywood.com/wp-content/uploads/2019/10/Joubert-Okoume-Plywood-Specifications.pdf), 2010) [F]. Joubert publishes no measured MOR or E. Its declarations of performance ([6 mm](https://www.joubert-group.com/wp-content/uploads/joubert-dop/en/MARINE-PLY-DoP-6mm-K1-EN.pdf), [4 mm](https://www.joubert-group.com/wp-content/uploads/joubert-dop/en/MARINE-PLY-DoP-4mm-K1-EN.pdf), 1 July 2013) give only EN 636 classes: 6 mm bending strength class F30/10 and stiffness class E40/15; 4 mm has no bending class (non-structural below 6 mm). Reading these as characteristic strength 30 parallel / 10 perpendicular N/mm2 and stiffness 4000 / 1500 follows EN 636 convention; the DoP does not print it.
- The Metsä DoP fetched is the MUF (melamine-reinforced UF, interior gluing, dry use) birch; bending strengths are characteristic (5th percentile), moduli are mean values. The 4 mm 3-ply is very weak across the grain (10.6 N/mm2, E about 1000) while the 5-ply 6.5 mm keeps 29.0 and 4763.
- Bellotti's 4 mm cross-grain E (4200) is oddly high next to Metsä's 3-ply (1029); Bellotti says its values are indicative. Do not rely on the Bellotti 4 mm cross figures without a test.
- Meranti BS 1088 6 mm: NOT FOUND (BS 1088 carries no strength data; supplier sheets give density only).

## 4 Metal stock

### 1. 5/8 in 1045 round rod, 60 in

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 1. 5/8 in 1045 round rod, 60 in | both | Speedy Metals | 5/8 in 1045 steel round, cold finished, 60 in fixed length | each | $34.04 | F | <https://www.speedymetals.com/p-1651-x.aspx> | **RECOMMENDED.** By-the-inch $0.93/in (60 in would be $55.80); fixed 60 in is cheaper. Tol +/-3/4 in, so 59-1/4 in minimum; 57 in + kerfs fits. 72 in $39.15, 48 in $28.47. No cut fee. |
| 1. 5/8 in 1045 round rod, 60 in | both | Speedy Metals | 5/8 in 1045 steel round, turned ground & polished (TGP), 60 in | each | $34.36 | F | <https://www.speedymetals.com/p-1620-x.aspx> | Only $0.32 more than cold finished; alternative if a polished surface is wanted. By-the-inch $0.70/in. 72 in $37.80, 48 in $30.24. |
| 1. 5/8 in 1045 round rod, 60 in | both | Online Metals | 5/8 in 1045 cold finish round (pid 21684) | each | n/a | NOT_FOUND | <https://www.onlinemetals.com/buy/x/pid/21684> | Page says 'Request a Quote'; no online price. (1/2 in 1045 72 in is $8.56 and 3/4 in 1045 72 in is $27.74 at Online Metals, so 5/8 in would be about $17-19 per 72 in if quoted.) |
| 1. 5/8 in 1045 round rod, 60 in | comparison | Speedy Metals | 5/8 in 1018 steel round, cold finished, 60 in (NOT acceptable) | each | $23.46 | F | <https://www.speedymetals.com/p-29-x.aspx> | Comparison only. By-the-inch $0.64/in. |
| 1. 5/8 in 1045 round rod, 60 in | comparison | Speedy Metals / Online Metals | 5/8 in A36 hot-rolled round | each | n/a | NOT_FOUND | - | Not located (comparison only, not acceptable); not pursued. |
| 1. 5/8 in 1045 round rod, 60 in | both | McMaster-Carr / Metals Depot | 5/8 in 1045 round | each | n/a | BLOCKED | <https://www.mcmaster.com/> | McMaster page never renders in the browser pane (spinner, JS). Metals Depot lists sizes but shows no price without choosing a size in the cart. |

### 2. 304/316 flat 1/4 x 2 (about 15 in)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 2. 304/316 flat 1/4 x 2 (about 15 in) | standard | Speedy Metals | 304 flat bar 1/4 x 2, annealed & pickled, by the inch (order 15 in) | per inch | $19.95 ($1.33 each) | F | <https://www.speedymetals.com/p-1732-x.aspx> | **RECOMMENDED.** $1.33/in, 15 in = $19.95. Fixed: 12 in $23.89, 18 in $30.71, 24 in $35.83. Six 2-1/4 in plates + 5 kerfs = 14-1/8 in, so 15 in. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | standard | Online Metals | 0.25 x 2 304/304L rectangle bar (pid 4413), fixed lengths | 12 in / 24 in | $21.52 | F | <https://www.onlinemetals.com/buy/x/pid/4413> | 12 in $21.52 (too short for 15 in); 24 in $41.86; 36 in $57.14. Custom-cut option exists but its price did not display. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | standard | Online Metals | 1/4 x 1.75 (1-3/4) 304/304L rectangle bar (pid 4412) | 12 in / 24 in | $18.93 | F | <https://www.onlinemetals.com/buy/x/pid/4412> | Exact 1-3/4 in width exists at Online Metals: 12 in $18.93, 24 in $36.84. 12 in is too short unless the plate count fits in 12 in. Speedy has no 1/4 x 1-3/4. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | extreme | Speedy Metals | 316 flat bar 1/4 x 2, annealed & pickled, by the inch (order 15 in) | per inch | $29.10 ($1.94 each) | F | <https://www.speedymetals.com/p-2547-x.aspx> | **RECOMMENDED.** $1.94/in, 15 in = $29.10. Fixed: 12 in $34.86, 24 in $52.29. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | extreme | Online Metals | 0.25 x 2 316/316L rectangle bar (pid 664), fixed lengths | 12 in / 24 in | $23.27 | F | <https://www.onlinemetals.com/buy/x/pid/664> | 12 in $23.27 (too short); 24 in $45.24; 36 in $61.76. 1/4 x 1.75 316 is $31.18 for 12 in (pid 663). |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | comparison | Online Metals | 1/4 x 2 A36 hot-rolled carbon steel flat (pid 9600), 12 in | 12 in | $5.36 | F | <https://www.onlinemetals.com/buy/x/pid/9600> | Comparison only. 24 in $10.43. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | comparison | Online Metals | 1/4 x 2 6061-T6511 aluminum rectangle bar (pid 1145) | 12 in | $5.71 | F | <https://www.onlinemetals.com/buy/x/pid/1145> | Category listing price $5.71 (12 in); product page table also shows 12 in $9.17, 24 in $17.88, 36 in $24.43 (ambiguous which row is the 1/4 x 2). Comparison only. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | comparison | Home Depot | Everbilt plain steel flat bar 1-1/2 in x 3 ft x 1/4 in (model 0749); 2 in x 3 ft x 1/8 in is $30.45 (0716) | each | $32.48 | F | <https://www.homedepot.com/s/1%2F4%20in%20x%202%20in%20steel%20flat%20bar> | Retail flat bar is expensive; no 1/4 x 2 listed. Galvanized not found. Comparison only. |
| 2. 304/316 flat 1/4 x 2 (about 15 in) | standard | Zoro (Online Metal Supply) | 304 true flat bar 1/4 x 2 x 48 in | each | $145.99 | S | <https://www.zoro.com/online-metal-supply-14-in-x-2-in-x-48-in-304-stainless-steel-flat-bar-hrap-304truefbt025w2l481/i/G623020772/> | Search snippet only; far above Speedy/Online Metals. |

### 3. 304/316 flat 1/8 x 2 (about 13 in)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 3. 304/316 flat 1/8 x 2 (about 13 in) | standard | Speedy Metals | 304 flat bar 1/8 x 2, annealed & pickled, by the inch (order 13 in) | per inch | $9.23 ($0.71 each) | F | <https://www.speedymetals.com/p-1717-x.aspx> | **RECOMMENDED.** $0.71/in. Fixed: 12 in $12.74, 18 in $16.39, 24 in $19.12. 1/8 x 1-3/4 is $0.69/in (pid 1716). |
| 3. 304/316 flat 1/8 x 2 (about 13 in) | standard | Online Metals | 0.125 x 2 304/304L rectangle bar (pid 4391), 12 in | 12 in | $8.14 | F | <https://www.onlinemetals.com/buy/x/pid/4391> | Cheapest if 12 in is enough: 12 in $8.14, 24 in $15.81, 36 in $21.59. If 13 in is needed, Speedy by-the-inch $9.23 wins. |
| 3. 304/316 flat 1/8 x 2 (about 13 in) | extreme | Speedy Metals | 316 flat bar 1/8 x 2, annealed & pickled, by the inch (order 13 in) | per inch | $12.61 ($0.97 each) | F | <https://www.speedymetals.com/p-2540-x.aspx> | **RECOMMENDED.** $0.97/in. Fixed: 12 in $17.44, 24 in $26.16. |
| 3. 304/316 flat 1/8 x 2 (about 13 in) | extreme | Online Metals | 0.125 x 2 316/316L rectangle bar (pid 642), 12 in | 12 in | $13.34 | F | <https://www.onlinemetals.com/buy/x/pid/642> | 12 in $13.34 (if 12 in suffices, ties Speedy 13 in); 24 in $25.95. |

### 4. 304/316 flat 1/16 x 1 (about 13 in)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 4. 304/316 flat 1/16 x 1 (about 13 in) | both | Speedy Metals / Online Metals / McMaster | 304 or 316 flat 1/16 (0.0625 or 0.06) x 1 | each | n/a | NOT_FOUND | - | No 1/16 in thick flat bar at Speedy (smallest 1/8 in) or Online Metals (smallest 1/8 in rectangle bar; keyword search for 0.0625 returned nothing). McMaster blocked. Zoro search showed only unrelated flat bar/sheet. |
| 4. 304/316 flat 1/16 x 1 (about 13 in) | standard | Speedy Metals | FALLBACK 304 flat bar 1/8 x 1 by the inch (13 in) | per inch | $5.33 ($0.41 each) | F | <https://www.speedymetals.com/p-1713-x.aspx> | Twice as thick as asked; 12 in $7.40. Fallback only if 1/16 cannot be sourced. |
| 4. 304/316 flat 1/16 x 1 (about 13 in) | extreme | Speedy Metals | FALLBACK 316 flat bar 1/8 x 1 by the inch (13 in) | per inch | $6.37 ($0.49 each) | F | <https://www.speedymetals.com/p-2538-x.aspx> | Fallback only. Online Metals 316 1/8 x 1 12 in $7.48 (pid 639); 304 12 in $6.85 (pid 4388). |

### 5. 304 angle 1-1/2 x 1-1/2 x 1/8 (about 5 in)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 5. 304 angle 1-1/2 x 1-1/2 x 1/8 (about 5 in) | standard | Speedy Metals | 304 angle 1/8 x 1-1/2 x 1-1/2, annealed & pickled, by the inch (order 5 in) | per inch | $7.75 ($1.55 each) | F | <https://www.speedymetals.com/p-1693-x.aspx> | **RECOMMENDED.** $1.55/in. 12 in $17.15, 18 in $23.88. Online Metals does not stock 304 1-1/2 x 1-1/2 x 1/8 (only 3/16 in pid 9 and 1/4 in pid 10). |
| 5. 304 angle 1-1/2 x 1-1/2 x 1/8 (about 5 in) | extreme | Online Metals | 316/316L angle 1-1/2 x 1-1/2 x 1/8 (pid 2162), 12 in | 12 in | $20.09 | F | <https://www.onlinemetals.com/buy/x/pid/2162> | **RECOMMENDED.** Now $20.09 (was $19.83). 24 in $39.09. Speedy 316 angle not located. |

### 6. 6061-T6 rect tube 1 x 1-1/2 x 1/8 (about 29 in)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 6. 6061-T6 rect tube 1 x 1-1/2 x 1/8 (about 29 in) | both | Online Metals | 1 x 1-1/2 x 0.125 aluminum rectangle tube 6061-T6 (pid 14469), 36 in | 36 in | $29.24 | F | <https://www.onlinemetals.com/buy/x/pid/14469> | **RECOMMENDED.** 24 in $21.39 (too short for 29 in), 36 in $29.24, 48 in $36.54, 72 in $40.31. Custom cut offered, price not shown. |
| 6. 6061-T6 rect tube 1 x 1-1/2 x 1/8 (about 29 in) | both | Speedy Metals | 1 x 1-1/2 x .125 wall 6063-T52 rect tube (NOT 6061), by the inch (30 in) | per inch | $18.90 ($0.63 each) | F | <https://www.speedymetals.com/p-4670-x.aspx> | Not 6061-T6: 6063-T52 is weaker (about 21 ksi yield vs 40). Saves about $10; needs Eric's OK. 12 in $11.42, 36 in $22.84. |
| 6. 6061-T6 rect tube 1 x 1-1/2 x 1/8 (about 29 in) | both | Zoro (Online Metal Supply) | 1 x 1-1/2 x 1/8 6061-T6 rect tube, 24 in | each | $52.39 | S | <https://www.zoro.com/online-metal-supply-1-in-x-1-12-in-x-18-in-wall-x-24-inches-6061-t6-aluminum-rectangle-tube-61rectbh1w15t0125l241/i/G823039499/> | Snippet; much higher than Online Metals. |

## 5 Fasteners and small hardware

### 7. #6 x 2-1/2 flat-head wood screw (18)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 7. #6 x 2-1/2 flat-head wood screw (18) | standard | Bolt Depot | #8 x 2-1/2 Phillips flat head wood screw 18-8 (prod 5416) | each | $10.80 ($0.60 each) | F | <https://boltdepot.com/Product-Details?product=5416> | **RECOMMENDED.** No #6 x 2-1/2 in 18-8 exists at Bolt Depot (no 18-8 #6 wood screws at all) or Bolts and Nuts. #8 substitute: 18 = $10.80; bag of 100 $39.55. |
| 7. #6 x 2-1/2 flat-head wood screw (18) | standard | Bolt Depot | #6 x 2-1/2 slotted flat head wood screw, zinc plated (prod 2085) | each | $4.14 ($0.23 each) | F | <https://boltdepot.com/Product-Details?product=2085> | Zinc, slotted only (the only #6 x 2-1/2 at Bolt Depot); 18 = $4.14. Dry hidden spots only. |
| 7. #6 x 2-1/2 flat-head wood screw (18) | extreme | Bolt Depot | #8 x 2 Phillips flat head wood screw 316 (prod 16368) | each | $10.26 ($0.57 each) | F | <https://boltdepot.com/Product-Details?product=16368> | **RECOMMENDED.** No 316 #8 x 2-1/2 or #6 x 2-1/2 (316 #6 stops at 2 in: #6 x 2 $0.55 prod 16361; #8 x 2-1/2 316 does not exist). 18 x $0.57 = $10.26. 1/2 in shorter than the design. |
| 7. #6 x 2-1/2 flat-head wood screw (18) | extreme | Bolts and Nuts | #8 x 2 SS Phillips flat head wood screw | each | n/a | F | <https://boltsandnuts.com/products/8x2-stainless-steel-phillips-flat-head-wood-screws> | Grade listed only as stainless. Costlier than Bolt Depot. |

### 8. #10-32 threaded insert, 5/16 long (14)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 8. #10-32 threaded insert, 5/16 long (14) | standard | Bolts and Nuts | #10-32 x 5/16 3-prong T-nut, steel zinc clear (barrel 5/16, flange 3/4) | each | $3.36 ($0.24 each) | F | <https://boltsandnuts.com/products/10-32x5-16-steel-3-prong-t-nuts-zinc-clear> | **RECOMMENDED.** 14 x $0.24 = $3.36 (single piece; 150 for $26.79). Hammer-in prong insert, not a screw-in knife-thread insert. |
| 8. #10-32 threaded insert, 5/16 long (14) | standard | Home Depot | Everbilt #10-32 zinc plated tee nut, 4-pack (model 825021) | pack of 4 | $1.57 ($0.39 each) | F | <https://www.homedepot.com/s/10-32%20threaded%20insert%20wood> | 4 packs = 16 nuts = $6.28. |
| 8. #10-32 threaded insert, 5/16 long (14) | extreme | Bolts and Nuts | #10-32 x 5/16 18-8 stainless 3-prong T-nut | each | $14.70 ($1.05 each) | F | <https://boltsandnuts.com/products/10-32x5-16-18-8-stainless-steel-3-prong-t-nuts> | **RECOMMENDED.** 14 x $1.05 = $14.70 (100 for $78.74). This is 18-8 (304), not 316. Cheapest stainless found. |
| 8. #10-32 threaded insert, 5/16 long (14) | extreme | Home Depot | Hillman #10-32 x 9/32 x 3/4 stainless pronged tee nut, 12-pack (model 4148) | pack of 12 | $12.95 ($1.08 each) | F | <https://www.homedepot.com/s/10-32%20threaded%20insert%20wood> | Grade not stated (likely 18-8). 14 needs 2 packs = $25.90. |
| 8. #10-32 threaded insert, 5/16 long (14) | extreme | McMaster-Carr / others | #10-32 316 stainless insert or tee nut for wood | each | n/a | BLOCKED | <https://www.mcmaster.com/products/e-z-lok-inserts/> | 316 not found at Bolt Depot, Bolts and Nuts or Home Depot; McMaster (JS) not readable. McMaster does list 316 tee nuts per search snippet; price unknown. |
| 8. #10-32 threaded insert, 5/16 long (14) | reference | Bolt Depot | #10-32 x 0.500 hardwood insert, slotted, brass (prod 23846) | pack of 25 / each | $29.25 ($1.52 each) | F | <https://boltdepot.com/Product-Details?product=23846> | Knife-thread insert for hardwood, brass, 1/2 in long. Stainless hardwood insert at Bolt Depot is #10-24 x 0.500 18-8 $5.64 each (prod 23886), not #10-32. |

### 9. Thumb screw #10-32 (8)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 9. Thumb screw #10-32 (8) | standard | Bolt Depot | #10-32 x 1 spade thumb screw, zinc plated steel (prod 23990) | each | $1.68 ($0.21 each) | F | <https://boltdepot.com/Product-Details?product=23990> | **RECOMMENDED.** 8 x $0.21 = $1.68; bag of 100 $16.87. |
| 9. Thumb screw #10-32 (8) | standard | Bolts and Nuts | #10-32 x 1 spade thumb screw 18-8 stainless | each | $12.80 ($1.60 each) | F | <https://boltsandnuts.com/products/10-32x1-18-8-stainless-steel-thumb-screws> | 8 x $1.60 = $12.80. Also 3/4 in $1.64, 1-1/2 in $1.70. No 7/8 in anywhere. |
| 9. Thumb screw #10-32 (8) | extreme | Bolts and Nuts | #10-32 x 7/8 stainless thumb screw: not stocked; use #10-32 x 1 18-8 (or 3/4) | each | $12.80 ($1.60 each) | F | <https://boltsandnuts.com/products/10-32x1-18-8-stainless-steel-thumb-screws> | **RECOMMENDED.** 316 thumb screws not found anywhere. Bolt Depot stainless thumb screws are #10-24 only ($1.81 for 1 in, 18-8, prod 24040). Zoro Z1086-SS 18-8 1 in is $27.89 each. |
| 9. Thumb screw #10-32 (8) | extreme | Zoro | Zoro Select #10-32 spade thumb screw 18-8, 1 in, 1/2 in head (Z1086-SS) | each | $27.89 | F | <https://www.zoro.com/i/G2786892/> | Shown for completeness; far too expensive. |

### 10. #8 x 1-1/4 pan-head wood screw (8)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 10. #8 x 1-1/4 pan-head wood screw (8) | standard | Bolt Depot | #8 x 1-1/4 Phillips pan head self-tapping (Type A) 18-8 (prod 2312) | each | $0.96 ($0.12 each) | F | <https://boltdepot.com/Product-Details?product=2312> | **RECOMMENDED.** 8 x $0.12 = $0.96. This is a sheet metal screw (Type A, coarse), not a true wood screw; works in hardwood with a pilot hole. Bolt Depot sells no pan-head wood screw. |
| 10. #8 x 1-1/4 pan-head wood screw (8) | standard | Bolt Depot | #8 x 1-1/4 Phillips flat head WOOD screw 18-8 (prod 3961) | each | $2.32 ($0.29 each) | F | <https://boltdepot.com/Product-Details?product=3961> | 8 x $0.29 = $2.32; bag of 100 $18.29. Slotted round head wood screw also $0.29 (prod 3876). |
| 10. #8 x 1-1/4 pan-head wood screw (8) | extreme | Bolt Depot | #8 x 1-1/4 Phillips pan head self-tapping (Type A) 316 (prod 17004) | each | $1.92 ($0.24 each) | F | <https://boltdepot.com/Product-Details?product=17004> | **RECOMMENDED.** 8 x $0.24 = $1.92. |
| 10. #8 x 1-1/4 pan-head wood screw (8) | extreme | Bolt Depot | #8 x 1-1/4 Phillips flat head WOOD screw 316 (prod 16366) | each | $3.84 ($0.48 each) | F | <https://boltdepot.com/Product-Details?product=16366> | 8 x $0.48 = $3.84; true wood screw thread. |

### 11. #10 screw eye (8)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 11. #10 screw eye (8) | standard | Home Depot | Everbilt 1/4 x 2 stainless screw eye, 2-piece (model 824351) | pack of 2 | $1.57 ($0.79 each) | F | <https://www.homedepot.com/s/stainless%20steel%20screw%20eye> | **RECOMMENDED.** 8 needs 4 packs = $6.28. Size is eye diameter x length (no '#10' size given; check eye ID). Grade not stated (likely 18-8). Also 3/16 x 1-5/8 2-pack $1.57 (824341). |
| 11. #10 screw eye (8) | standard | Bolt Depot | Screw eye 18-8, size 8 (1/2 in I.D., prod 15513) | each | $8.64 ($1.08 each) | F | <https://boltdepot.com/Product-Details?product=15513> | Smallest at Bolt Depot is far larger than a #10 (1/2 in I.D.). |
| 11. #10 screw eye (8) | extreme | Home Depot / Bolt Depot / Bolts and Nuts | #10 (about 1/4 in I.D.) screw eye 316 | each | n/a | NOT_FOUND | - | No 316 screw eyes found at Bolt Depot (18-8 only), Bolts and Nuts or Home Depot. |

### 12. 3/8-16 x 6-1/2 carriage bolt (2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 12. 3/8-16 x 6-1/2 carriage bolt (2) | standard | Bolt Depot | 3/8-16 x 6 carriage bolt 18-8 (prod 954) | each | $3.76 ($1.88 each) | F | <https://boltdepot.com/Product-Details?product=954> | **RECOMMENDED.** 2 x $1.88 = $3.76. 6 in is stock; 6-1/2 in is $4.89 each (prod 11937, 2 = $9.78). |
| 12. 3/8-16 x 6-1/2 carriage bolt (2) | standard | Bolt Depot | 3/8-16 x 6-1/2 carriage bolt 18-8 (prod 11937) | each | $9.78 ($4.89 each) | F | <https://boltdepot.com/Product-Details?product=11937> | Special-length price; use 6 in if the design allows. |
| 12. 3/8-16 x 6-1/2 carriage bolt (2) | extreme | Bolt Depot | 3/8-16 x 6 carriage bolt 316 (prod 18411) | each | $7.36 ($3.68 each) | F | <https://boltdepot.com/Product-Details?product=18411> | **RECOMMENDED.** 2 x $3.68 = $7.36. 316 6-1/2 in not stocked at Bolt Depot. Bolts and Nuts 316 carriage bolts start at 7 in ($13.76). |

### 13. 1/4-20 x 2-3/4 hex bolt (4)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 13. 1/4-20 x 2-3/4 hex bolt (4) | standard | Bolt Depot | 1/4-20 x 2-3/4 hex bolt 18-8 (prod 8977) | each | $2.00 ($0.50 each) | F | <https://boltdepot.com/Product-Details?product=8977> | **RECOMMENDED.** 4 x $0.50 = $2.00. |
| 13. 1/4-20 x 2-3/4 hex bolt (4) | extreme | Bolt Depot | 1/4-20 x 2-3/4 hex bolt 316 (prod 16076) | each | $3.72 ($0.93 each) | F | <https://boltdepot.com/Product-Details?product=16076> | **RECOMMENDED.** 4 x $0.93 = $3.72. Full-thread tap bolt 316 is $0.83 (prod 27266). Bolts and Nuts 316 $1.41. |

### 14. 3/8-16 x 4 hex bolt 316 (8)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 14. 3/8-16 x 4 hex bolt 316 (8) | extreme | Bolt Depot | 3/8-16 x 4 hex bolt 316 (prod 16139) | each | $18.88 ($2.36 each) | F | <https://boltdepot.com/Product-Details?product=16139> | **RECOMMENDED.** 8 x $2.36 = $18.88; bag of 50 $90.83. Bolts and Nuts $4.22. |
| 14. 3/8-16 x 4 hex bolt 316 (8) | standard | Bolt Depot | 3/8-16 x 4 hex bolt 18-8 (prod 166) | each | $10.96 ($1.37 each) | F | <https://boltdepot.com/Product-Details?product=166> | **RECOMMENDED.** Confirmed $1.37 each; 8 = $10.96. |

### 15. 5/32 x 1-1/2 cotter pin (4)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 15. 5/32 x 1-1/2 cotter pin (4) | standard | Bolt Depot | 5/32 x 1-1/2 cotter pin 18-8 (prod 14571) | each | $1.28 ($0.32 each) | F | <https://boltdepot.com/Product-Details?product=14571> | **RECOMMENDED.** 4 x $0.32 = $1.28; 100 for $22.64. Bolts and Nuts extended-prong 18-8 $0.65 each. |
| 15. 5/32 x 1-1/2 cotter pin (4) | extreme | Zoro | Zoro Select extended prong cotter pin 5/32 x 1-1/2, 316 stainless, 25 pack (U55700.015.0150) | pack of 25 | $21.19 ($0.85 each) | F | <https://www.zoro.com/i/G3426151/> | **RECOMMENDED.** Only 316 source found; must buy the 25-pack ($21.19) for 4 pins. Bolt Depot has no 316 cotter pins. |

### 16. #10-32 x 3/8 flat-head machine screw (6)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 16. #10-32 x 3/8 flat-head machine screw (6) | standard | Bolt Depot | #10-32 x 3/8 Phillips flat head machine screw 18-8 (prod 1267) | each | $0.78 ($0.13 each) | F | <https://boltdepot.com/Product-Details?product=1267> | **RECOMMENDED.** 6 x $0.13 = $0.78. |
| 16. #10-32 x 3/8 flat-head machine screw (6) | extreme | Bolt Depot | #10-32 x 3/8 Phillips flat head machine screw 316 (prod 16938) | each | $0.72 ($0.12 each) | F | <https://boltdepot.com/Product-Details?product=16938> | **RECOMMENDED.** 6 x $0.12 = $0.72 (316 is cheaper than 18-8 here). Bolts and Nuts $0.18. |

### 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | standard | Bolt Depot | #8-32 x 2 Phillips pan head machine screw 18-8 (prod 1352) | each | $7.20 ($0.30 each) | F | <https://boltdepot.com/Product-Details?product=1352> | 24 x $0.30 = $7.20 (bag of 100 $20.06). Flat head (prod 1254) $0.27 each = $6.48. |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | standard | Bolt Depot | #8-32 x 2 Phillips flat head machine screw 18-8 (prod 1254) | each | $6.48 ($0.27 each) | F | <https://boltdepot.com/Product-Details?product=1254> | **RECOMMENDED.** 24 x $0.27 = $6.48 (use if head style allows). |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | standard | Bolt Depot | #8 x 3/4 fender washer 18-8 (prod 7147) | each | $3.60 ($0.15 each) | F | <https://boltdepot.com/Product-Details?product=7147> | **RECOMMENDED.** 24 x $0.15 = $3.60 (100 for $9.86). |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | standard | Bolt Depot | #8-32 hex nylon insert lock nut 18-8 (prod 2551) | each | $2.40 ($0.10 each) | F | <https://boltdepot.com/Product-Details?product=2551> | **RECOMMENDED.** 24 x $0.10 = $2.40 (100 for $6.93). Standard set (flat head) = $12.48; pan head $13.20. |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | extreme | Bolt Depot | #8-32 x 2 Phillips pan head machine screw 316 (prod 16819) | each | $8.88 ($0.37 each) | F | <https://boltdepot.com/Product-Details?product=16819> | 24 x $0.37 = $8.88. Flat head (prod 16902) $0.28 = $6.72. |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | extreme | Bolt Depot | #8-32 x 2 Phillips flat head machine screw 316 (prod 16902) | each | $6.72 ($0.28 each) | F | <https://boltdepot.com/Product-Details?product=16902> | **RECOMMENDED.** 24 x $0.28 = $6.72. |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | extreme | Bolt Depot | #8 x 3/4 fender washer 316 (prod 19564) | each | $5.04 ($0.21 each) | F | <https://boltdepot.com/Product-Details?product=19564> | **RECOMMENDED.** 24 x $0.21 = $5.04. |
| 17. #8-32 x 2 screw, #8 fender washer, #8-32 nylock (24 each) | extreme | Bolt Depot | #8-32 hex nylon insert lock nut 316 (prod 16005) | each | $3.84 ($0.16 each) | F | <https://boltdepot.com/Product-Details?product=16005> | **RECOMMENDED.** 24 x $0.16 = $3.84. Extreme set (flat head) = $15.60; pan head $17.76. Bolts and Nuts nylock 316 $0.20. |

### 18. M3/M4 screws (2 each), heat-set inserts (2 each)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 18. M3/M4 screws (2 each), heat-set inserts (2 each) | both | Bolt Depot | M3 x 0.5 x 8 Phillips pan head machine screw 18-8 (prod 6831) | each | $0.10 ($0.05 each) | F | <https://boltdepot.com/Product-Details?product=6831> | **RECOMMENDED.** 2 x $0.05 = $0.10. 316 metric not checked. |
| 18. M3/M4 screws (2 each), heat-set inserts (2 each) | both | Bolt Depot | M4 x 0.7 x 10 Phillips pan head machine screw 18-8 (prod 5167) | each | $0.16 ($0.08 each) | F | <https://boltdepot.com/Product-Details?product=5167> | **RECOMMENDED.** 2 x $0.08 = $0.16. |
| 18. M3/M4 screws (2 each), heat-set inserts (2 each) | both | Adafruit | Brass heat-set inserts for plastic, M3 x 4 mm, 50 pack (product 4255) | pack of 50 | $5.95 | F | <https://www.adafruit.com/product/4255> | **RECOMMENDED.** Smallest pack. M3 x 3 mm is out of stock (product 4256). |
| 18. M3/M4 screws (2 each), heat-set inserts (2 each) | both | Prusa (CNC Kitchen design) | Heat set inserts M4 standard, 50 pcs | pack of 50 | $11.99 | F | <https://www.prusa3d.com/product/heat-set-inserts-m4-standard-50-pcs/> | **RECOMMENDED.** Smallest pack found for M4. Bolt Depot brass inserts M3/M4 ($0.89/$0.92 each, prod 23870/23871) are for wood, not heat-set. |

### 19. 1/4 nylon flat washer (4)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 19. 1/4 nylon flat washer (4) | both | Bolt Depot | Nylon 6/6 flat washer 1/4 (prod 15939) | each | $0.36 ($0.09 each) | F | <https://boltdepot.com/Product-Details?product=15939> | **RECOMMENDED.** 4 x $0.09 = $0.36; 100 for $5.17. |
| 19. 1/4 nylon flat washer (4) | both | Bolts and Nuts | USA made nylon flat washer 0.500 OD x 0.257 ID x 0.032 | each | $0.32 ($0.08 each) | F | <https://boltsandnuts.com/products/0-500-x-0-257-x-0-032-usa-made-nylon-flat-washer> | 4 x $0.08 = $0.32 (thin 0.032 in). |

### 20. 5/8 bore set-screw collar (4)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 20. 5/8 bore set-screw collar (4) | standard | Penn Tool Co. | Climax C-062 steel (zinc plated) one-piece set screw collar, 5/8 bore, 1-1/8 OD x 1/2 wide | each | $18.08 ($4.52 each) | F | <https://www.penntoolco.com/87986402> | **RECOMMENDED.** Now $4.52 (was $4.43); 4 = $18.08. Cheaper: KBC Stafford 1-906-6L010P2 $2.39 (Canadian site, currency unclear) [S]. |
| 20. 5/8 bore set-screw collar (4) | standard | PartsSource | Climax GSC-062-Z zinc collar 5/8 | each | $4.99 | S | <https://www.partssource.com/parts/climax-metal-products/gsc062z> | Snippet only. |
| 20. 5/8 bore set-screw collar (4) | extreme | Newegg (sold and shipped by Zoro) | Climax CRC-062-S 316 stainless one-piece set screw collar, 5/8 bore, 1-1/8 OD x 1/2 wide | each | $79.56 ($19.89 each) | F | <https://www.newegg.com/p/0PS-00NR-00036> | **RECOMMENDED.** 4 x $19.89 = $79.56 plus $5.00 shipping listed. Same item direct at Zoro likely similar (Zoro blocked for fetch). |
| 20. 5/8 bore set-screw collar (4) | extreme | PartsSource | Climax CRC-062-S 316 collar | each | $26.29 | F | <https://partssource.com/parts/climax-metal-products/crc062s> | 4 = $105.16. Motion MI 02393094 $25.56 [S]. |
| 20. 5/8 bore set-screw collar (4) | extreme | Walmart | Climax C-062-S set screw collar 5/8 'SS' | each | $15.45 | S | <https://www.walmart.com/ip/Climax-Metal-Products-Shaft-Collar-Clamp-1Pc-5-8-In-Steel-1C-062/905609755> | Snippet; C-062-S is probably 303 stainless, NOT 316; confirm before using. |

### 21. 3/8 x 2-1/4 316 rod / clevis pin (2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 21. 3/8 x 2-1/4 316 rod / clevis pin (2) | extreme | Speedy Metals | 3/8 in 316 stainless round, cold finished annealed, by the inch (order 5 in) | per inch | $4.55 ($0.91 each) | F | <https://www.speedymetals.com/p-2616-x.aspx> | **RECOMMENDED.** $0.91/in; 5 in = $4.55 for two 2-1/4 in pieces (cut on the metal bandsaw). 12 in $8.18. |
| 21. 3/8 x 2-1/4 316 rod / clevis pin (2) | extreme | Zoro | Huyett standard clevis pin 3/8 dia x 2-49/64 usable, 316 stainless (CLPS6-0375-3000/D) | each | $4.98 ($2.49 each) | F | <https://www.zoro.com/i/G500006608/> | $2.49 each; page also says 'sold in multiples of 8 for $19.92', so a minimum of 8 may apply. 2 = $4.98 if singles allowed. SC Fastening 3/8 x 3 316 clevis pin comes 5/pk (price not shown). |
| 21. 3/8 x 2-1/4 316 rod / clevis pin (2) | standard | Bolt Depot | 3/8 x 3 ft 18-8 unthreaded rod (prod 25832) | each | $20.38 | F | <https://boltdepot.com/Product-Details?product=25832> | 18-8, 3 ft only; too much for 4-1/2 in. |

### 22. 5/8-11 x 6 grade 8 bolt + nylock + 2 washers

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 22. 5/8-11 x 6 grade 8 bolt + nylock + 2 washers | both | Bolt Depot | 5/8-11 x 6 hex bolt, zinc plated grade 8 yellow (prod 678) | each | $4.14 | F | <https://boltdepot.com/Product-Details?product=678> | **RECOMMENDED.** Grade 5 zinc is $3.67 (prod 434), plain zinc $2.80 (prod 285) if grade 8 is not required. |
| 22. 5/8-11 x 6 grade 8 bolt + nylock + 2 washers | both | Bolt Depot | 5/8-11 hex nylon insert lock nut, zinc plated steel (prod 2628) | each | $0.56 | F | <https://boltdepot.com/Product-Details?product=2628> | **RECOMMENDED.** Grade 5 zinc $0.81 (21808); grade 8 yellow $0.87 (2681). |
| 22. 5/8-11 x 6 grade 8 bolt + nylock + 2 washers | both | Bolt Depot | 5/8 SAE flat washer, zinc plated steel (prod 4273) | each | $0.30 ($0.15 each) | F | <https://boltdepot.com/Product-Details?product=4273> | **RECOMMENDED.** 2 x $0.15 = $0.30. Set total $5.00. |

### 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | both | Bolt Depot | 3/8-16 x 2-1/2 forged shoulder eye bolt w/ nut, HDG, domestic (prod 13448) | each | $22.20 ($11.10 each) | F | <https://boltdepot.com/Product-Details?product=13448> | 2 x $11.10 = $22.20; 10 for $95.09. |
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | both | Bolt Depot | 3/8-16 x 4-1/2 forged shoulder eye bolt w/ nut, HDG, domestic (prod 13449) | each | $23.88 ($11.94 each) | F | <https://boltdepot.com/Product-Details?product=13449> | 2 x $11.94 = $23.88. Four-bolt set = $46.08. |
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | both | Home Depot | Hardware Essentials 3/8-16 x 2-1/2 forged steel HDG eye bolt w/ hex nut, shoulder pattern, 5-pack (model 851889) | pack of 5 | $26.05 ($5.21 each) | F | <https://www.homedepot.com/s/3%2F8-16%20forged%20shoulder%20eye%20bolt%20galvanized> | Need 2 only: pack $26.05 for 5 ($5.21 each if all used). Rating/WLL not stated on the listing. |
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | both | Home Depot | Hardware Essentials 3/8-16 x 4-1/2 forged HDG eye bolt w/ nut, shoulder, 5-pack (model 851890) | pack of 5 | $33.91 ($6.78 each) | F | <https://www.homedepot.com/s/3%2F8-16%20forged%20shoulder%20eye%20bolt%20galvanized> | Both packs = $59.96 for 10 bolts (6 spare); more than Bolt Depot's $46.08 for exactly 4 unless the spares are useful. 6 in is $35.79 (851891). |
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | both | Ace Hardware | National Hardware 3/8 x 2-1/2 galvanized forged steel eyebolt, nut included | each | $19.98 ($9.99 each) | S | <https://www.acehardware.com/p/5703319?x429=true> | Snippet only (page 403). Do it Best lists the same item with a 1,200 lb load rating. No 4-1/2 in found. |
| 23. 3/8-16 forged shoulder eye bolt, galvanized (2 each: 2-1/2, 4-1/2) | both | Marine Engine | Chicago Hardware 084390 HDG shoulder eyebolt 3/8 x 2-1/2, drop forged | each | $19.96 ($9.98 each) | S | <https://www.marineengine.com/boat-accessories/hardware/084390> | Snippet only (page 403). Penn Tool Chicago Hardware version $14.95 (meets ASME B30.26, 1,200 lb) [S]. |

### 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 2-1/4 hex bolt 18-8 (prod 8976) | each | $0.43 | F | <https://boltdepot.com/Product-Details?product=8976> | Hex bolt per piece. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 2-1/2 hex bolt 18-8 (prod 134) | each | $0.47 | F | <https://boltdepot.com/Product-Details?product=134> | Hex bolt per piece. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 2-3/4 hex bolt 18-8 (prod 8977) | each | $0.50 | F | <https://boltdepot.com/Product-Details?product=8977> | Hex bolt per piece. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 3 hex bolt 18-8 (prod 135) | each | $0.53 | F | <https://boltdepot.com/Product-Details?product=135> | Hex bolt per piece. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 1-1/4 socket button head cap screw 18-8 (prod 4414) | each | $0.33 | F | <https://boltdepot.com/Product-Details?product=4414> | Button head per piece. Bolt Depot does not list 2-1/4 or 2-3/4 in button heads. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 1-1/2 socket button head cap screw 18-8 (prod 4415) | each | $0.37 | F | <https://boltdepot.com/Product-Details?product=4415> | Button head per piece. Bolt Depot does not list 2-1/4 or 2-3/4 in button heads. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 2 socket button head cap screw 18-8 (prod 4417) | each | $0.56 | F | <https://boltdepot.com/Product-Details?product=4417> | Button head per piece. Bolt Depot does not list 2-1/4 or 2-3/4 in button heads. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 2-1/2 socket button head cap screw 18-8 (prod 4418) | each | $0.73 | F | <https://boltdepot.com/Product-Details?product=4418> | Button head per piece. Bolt Depot does not list 2-1/4 or 2-3/4 in button heads. |
| 24. 1/4-20 consolidation (Bolt Depot 18-8, per piece) | standard | Bolt Depot | 1/4-20 x 3 socket button head cap screw 18-8 (prod 4419) | each | $0.94 | F | <https://boltdepot.com/Product-Details?product=4419> | Button head per piece. Bolt Depot does not list 2-1/4 or 2-3/4 in button heads. |

### 25. #8 x 1-1/4 exterior wood screws, coated vs 18-8

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 25. #8 x 1-1/4 exterior wood screws, coated vs 18-8 | standard | Home Depot | Deckmate #8 x 1-1/4 tan star flat head wood deck screw, 1 lb (186 pc), model 115975 | box of 186 | $10.97 ($0.059 each) | F | <https://www.homedepot.com/s/%238%20x%201-1%2F4%20in%20wood%20screws%20exterior%20coated> | **RECOMMENDED.** $0.059 each vs $0.29 for 18-8 at Bolt Depot (about 5x cheaper). |
| 25. #8 x 1-1/4 exterior wood screws, coated vs 18-8 | standard | Home Depot | Everbilt #8 x 1-1/4 star flat head exterior wood screws, 242-pack, model 117333 | pack of 242 | $13.98 ($0.058 each) | F | <https://www.homedepot.com/s/%238%20x%201-1%2F4%20in%20wood%20screws%20exterior%20coated> | Also Grip-Rite PTN114S1 Phillips bugle 1 lb $10.97; SPAX wafer 195 pc $15.27; Everbilt zinc Phillips flat 100-pack $8.98 ($0.09 each, model 801832). No GRK #8 x 1-1/4 box of 100 found. |
| 25. #8 x 1-1/4 exterior wood screws, coated vs 18-8 | standard | Home Depot | Everbilt #8 x 1-1/4 Phillips flat head zinc plated wood screw, 100-pack, model 801832 | pack of 100 | $8.98 ($0.09 each) | F | <https://www.homedepot.com/s/%238%20x%201-1%2F4%20in%20wood%20screws%20exterior%20coated> | Zinc plated (interior/dry only). |

## 6 Purchased parts

### 1. Front headlight

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 1. Front headlight | both | Modern Bike | Cygolite Metro Plus 800 USB headlight | each | $58.95 | S | <https://www.modernbike.com/cygolite-metro-plus-800-rechargeable-headlight> | Current spec. Snippet price (list $73.95). Page returned 403 to fetch (see blocked rows). |
| 1. Front headlight | both | Bicycle Warehouse | Cygolite Metro Plus 800 Rechargeable Front Bike Light | each | $73.95 | F | <https://bicyclewarehouse.com/products/cygolite-metro-plus-800-rechargeable-front-bike-light> | Read from the store's search JSON; full price. |
| 1. Front headlight | both | Bicycle Warehouse | Giant Recon 600 LED USB headlight (600/300/150 lm, 1600 mAh) | each | $41.95 | F | <https://bicyclewarehouse.com/products/recon-600-led-usb-bike-headlight> | **BOM uses this.** Compare-at $55. 87 g without mount. Confirmed, but only $17 below Metro. Fallback if the combo below is gone. |
| 1. Front headlight | both | Competitive Cyclist / Backcountry | Blackburn Dayblazer 400 front + Click USB rear light combo | set (front+rear) | $31.65 | S | <https://origin-www.competitivecyclist.com/blackburn-dayblazer-400-and-click-usb-light-combo> | Raw-research pick, not used: the rear light is about 20 lm. The BOM uses the Giant Recon 600 front plus the Planet Bike Spok rear. Clearance (was $49.95). Front 400 lm, USB; rear is the weak 20 lm Click. Covers items 1 and 2 together. Fetch returned no content, so stock unconfirmed. |
| 1. Front headlight | both | evo | Blackburn Dayblazer 400 front light | each | $12.99 | F | <https://www.evo.com/products/145089-blackburn-dayblazer-400-front-bike-light> | Was $33.00. 59 g; universal mount fits 22-35 mm bars. SOLD OUT when read. |
| 1. Front headlight | both | Academy Sports | Bell Lumina 1075 USB light set (400 lm front) | set (front+rear) | $34.99 | S | <https://www.academy.com/p/bell-lumina-1075-bike-light-set> | Snippet price; Ace Hardware lists $41.99. Academy blocked fetch. |
| 1. Front headlight | both | Ride Review / retail listings | Ascher USB rechargeable bike light set (generic, claims up to 800 lm) | set (front+rear) | $16.00 | S | <https://ridereview.com/products/ascher-usb-rechargeable-bike-lights-front-and-back> | Generic. Lumen claims unverified, build quality unknown. Other store listing $17.09. |
| 1. Front headlight | both | Walmart (third-party) | Generic USB front+rear sets (various, 'Bike Light Set') | set | $11.99 | S | <https://www.walmart.com/c/kp/bicycle-headlights-and-taillights> | Snippet range about $5-$18. Lumen ratings are marketing numbers. Walmart blocks fetch. |

### 2. Rear red light

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 2. Rear red light | both | Modern Bike | Cygolite Hotshot Pro 200C USB tail light | each | $44.95 | S | <https://www.modernbike.com/cygolite-lights> | Current spec. Snippet price (list $49.95). |
| 2. Rear red light | both | Bicycle Warehouse | Cygolite Hotshot Pro 200 USB rear light | each | $49.95 | F | <https://bicyclewarehouse.com/products/cygolite-hotshot-pro-200-usb-rechargeable-rear-bike-light> | Full price, 208 in stock. |
| 2. Rear red light | both | Bicycle Warehouse | Cygolite Hotshot 120 USB tail light | each | $39.95 | F | <https://bicyclewarehouse.com/products/cygolite-hotshot-120-usb-taillight> | 120 lm class. |
| 2. Rear red light | both | Bicycle Warehouse | Planet Bike Spok USB tail light | each | $21.99 | F | <https://bicyclewarehouse.com/products/planet-bike-spok-usb-taillight> | **BOM uses this.** Lumen figure not read from the page; rear light on a pulled sled at walking pace. Cheapest confirmed name-brand USB rear light. |
| 2. Rear red light | both | Bicycle Warehouse | Lezyne Femto USB-C Drive tail light | each | $21.99 | F | <https://bicyclewarehouse.com/products/femto-usb-c-drive-taillight> | Small, about 5 lm class (not read from page); needs the strap mount. |
| 2. Rear red light | both | Competitive Cyclist / Backcountry | Click USB rear (in the Dayblazer 400 combo, row 1) | incl. in combo | n/a | S | <https://origin-www.competitivecyclist.com/blackburn-dayblazer-400-and-click-usb-light-combo> | Rear comes with the combo at $31.65 total; no separate price. |

### 3. Seat cushion / back pad

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 3. Seat cushion / back pad | both | Harbor Freight | Foam Kneeling Pad #56572, EVA, 11 x 18 x 1-1/2 in. | each | $7.99 | F | <https://www.harborfreight.com/foam-kneeling-pad-56572.html> | **BOM uses this.** Three pads (two for the seat, one for the back). 1.0 lb shipping weight. Closed-cell type foam (EVA). Short side is 11 in., so two pads (15.98) or one pad plus a cut piece make 18 x 14-1/2; 1-1/2 in. not 2 in. |
| 3. Seat cushion / back pad | both | Walmart | Ozark Trail closed-cell foam camp sleeping pad (blue) | each | $14.98 | S | <https://www.walmart.com/ip/18682160798> | 'From' price; size not read (camp pads are about 20 x 72 x 3/8 in.). Cut and stack/glue 4-5 layers for 1-1/2 to 2 in. Walmart blocks fetch. |
| 3. Seat cushion / back pad | both | Campmor | Texsport Pack-Lite closed cell foam pad 72 x 20 x 3/8 in. | each | $19.99 | S | <https://www.campmor.com/products/texsport-pack-lite-closed-cell-foam-pad> | Sold out when seen. |
| 3. Seat cushion / back pad | both | Campmor | Therm-a-Rest RidgeRest Regular | each | $31.95 | S | <https://campmor.com/products/therm-a-rest-ridgerest-closed-cell-foam-pad-regular> | Higher quality, more cost. |
| 3. Seat cushion / back pad | both | Sportsman's Warehouse | Cascade Mountain 17 in. stadium seat cushion, waterproof vinyl bottom, PU foam, 16 x 13 x 2.5 in. | each | $27.97 | S | <https://www.sportsmans.com/camping-gear-supplies/camp-furniture/chairs-seats-loungers/cascade-mountain-17-inch-stadium-seat-cushion-bluewhite/p/1775846> | Ready-made and covered; PU foam may be open-cell. Page 404 on fetch. |
| 3. Seat cushion / back pad | both | Walmart | Ozark Trail foam stadium seat cushion, 13.75 x 13 x 0.8 in., water resistant | each | $7.13 | S | <https://www.walmart.com/ip/seort/529055225> | Too thin for a 2 in. seat; fine as a back pad idea. |
| 3. Seat cushion / back pad | both | Olympic Outdoor Center | Minicel L200 closed-cell PE foam 12 x 24 x 2 in. (gray or white) | each | $29.95 | F | <https://www.olympicoutdoorcenter.com/products/closed-cell-foam-blocks> | Two pieces needed to cover 18 x 14-1/2, so about $60: not cheaper. 1 in. is $24.95, 1/2 in. $14.95, 4 in. $59.95. |

### 4. Hook-and-loop for pads

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 4. Hook-and-loop for pads | both | Walmart | 3M Dual Lock 1 in. x 6 ft | roll | $19.99 | NOT_FOUND | <https://www.walmart.com/c/kp/3m-lock> | Not re-confirmed (Walmart blocks fetch; no 1 in x 6 ft listing in snippets). eBay 1 in x 4 ft SJ3550 $15.98 [S]. |
| 4. Hook-and-loop for pads | both | Blue Dog Ink | VELCRO Brand Industrial Strength 2 in. x 4 ft, white (90595) | roll | $7.52 | S | <https://www.bluedogink.com/velcro-brand-industrial-strength-heavy-duty-fasteners-2-x-4-ft-white-90595.html> | **BOM uses this.** Also $8.02 OfficeCrave; Amazon $6.19 (Feb 2026 Slickdeals note). Rated about 10 lb; hook/loop not Dual Lock: lower peel strength, quieter, fine for light pads. |
| 4. Hook-and-loop for pads | both | Walmart | VELCRO Brand Industrial Strength 2 in. x 15 ft black | roll | $21.97 | S | <https://www.walmart.com/ip/1782906834> | Only if more length is wanted. |

### 5. Tie-down D-rings (need 6)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 5. Tie-down D-rings (need 6) | both | etrailer | etrailer D-ring tie-down anchor RRING-R6000, zinc steel, WLL 2,000 lb (6,000 lb break), 4 mounting holes | each | $9.87 | F | <https://etrailer.com/Trailer-Tie-Down-Anchors/etrailer/RRING-R6000.html> | Read today at $9.87 (earlier snippet $9.24). Page lists 3/8 in. mounting holes: too large for #8-32; ring ID 1-3/8 in. |
| 5. Tie-down D-rings (need 6) | both | Harbor Freight | HAUL-MASTER 1/4 in. Cargo D-Ring Anchor, 2-pack #60319, zinc forged ring + 12 ga bracket | 2-pack | $2.99 | F | <https://www.harborfreight.com/14-in-cargo-d-ring-anchor-2-pack-60319.html> | **BOM uses this.** 233 lb working load, 700 lb break; verify the bracket holes. Three packs. $1.50 each; 3 packs = 6 rings = $8.97. WLL 233 lb, break 700 lb (below the 300 lbf target). Ring 1-7/8 x 1-7/16 in.; 0.22 lb per pack. Hole count/size not listed. |
| 5. Tie-down D-rings (need 6) | both | Harbor Freight | HAUL-MASTER 1/2 in. Forged Cargo D-Ring Anchor #60323 | each | $4.99 | S | <https://www.harborfreight.com/12-in-forged-cargo-d-ring-anchor-60323.html> | Price from HF search page [F]; working load 3,333 lb from snippet [S]. 6 = $29.94. Heavy for a lightweight sled. |
| 5. Tie-down D-rings (need 6) | both | Need A Trailer Part | 3/8 in. bolt-on D-ring, 1 hole, forged steel, zinc, WLL 2,400 lb, 4-pack (B21-4) | 4-pack | $14.24 | F | <https://needatrailerpart.com/products/3-8-bolt-on-d-ring-1-hole-2-4k-rated-multipack-of-4-b21-4> | Raw-research pick, not used: the BOM uses the Harbor Freight D-rings. $3.56 each; 0.9 lb per 4-pack. One hole, size not stated (3/8 in. likely: too big for #8-32). Shipping extra. |
| 5. Tie-down D-rings (need 6) | both | U.S. Cargo Control | 1-1/2 in. bolt-on D-ring with 2-hole bracket, zinc, WLL 2,000 lb | each | $5.99 | F | <https://www.uscargocontrol.com/1-1-2-D-Ring-Tie-Down-with-Mounting-Bracket> | 10-pack $49.99 ($4.99 each). Hole size not stated. |
| 5. Tie-down D-rings (need 6) | both | Ace Hardware | Keeper 1 in. D-ring with bracket, WLL 400 lb | each | $2.59 | S | <https://www.acehardware.com/p/8869489> | Snippet only; Ace blocks fetch. Likely the closest match to 300+ lb and small holes; verify in store. |

### 6. Lid gasket (EPDM)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 6. Lid gasket (EPDM) | both | Zoro | Trim-Lok EPDM trim seal 5M062B3X1/64A-25 (3/8 in., top bulb), 25 ft | 25 ft | $46.45 | S | <https://www.zoro.com/k/trim-lok-5m062b3x164a-25/> | Nearest Trim-Lok in results; the $52.74 current price was not reproduced. Zoro blocks fetch. |
| 6. Lid gasket (EPDM) | both | Home Depot | Frost King V25WA white EPDM D-section self-stick weatherseal 5/16 x 1/4 in. x 17 ft | 17 ft | $8.69 | S | <https://www.homedepot.com/p/100145681> | **BOM uses this.** V25GA grey $7.98 [S]; Amazon V25BK black $7.69 (Mar 2026 tracker) [S]. D-section, not a bulb: less compression travel. 17 ft covers the 6-7 ft needed. Home Depot blocks fetch. |
| 6. Lid gasket (EPDM) | both | Home Depot | Frost King V23WA ribbed EPDM 3/8 x 1/8 in. x 17 ft | 17 ft | $4.77 | S | <https://www.homedepot.com/p/100145681> | Thin ribbed profile, only for small gaps. |

### 7. Lid stay

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 7. Lid stay | extreme | Sugatsune USA | S-93L stainless (304, polished) friction stay, 30 kg | each | $26.40 | F | <https://sugatsune.com/s-s-stay-s-93r> | **RECOMMENDED.** Extreme spec keeps the stainless stay; the Standard spec uses the Rockler support. Confirmed. S-93R (right) is $31.70. 75 g, handed (need one L or R per lid). 4 mm screws. |
| 7. Lid stay | standard | Rockler | 6 in. Medium-Duty Quiet Action Lid Support (pair), item 39529 | pair | $9.99 | S | <https://www.rockler.com/6-medium-duty-quiet-action-lid-support> | **BOM uses this.** Snippet price $9.99; the $4.99 sale price was NOT confirmed. Plated steel, not stainless. Page 404 on fetch. |
| 7. Lid stay | both | Wurth | 304 stainless lid stay 185 mm, satin | each | $44.53 | S | <https://wurthlac.com/product/138003/Lid-Stay-185mm-Satin> | Costs more. |
| 7. Lid stay | both | U.S. Cargo Control | 1/8 in. T304 stainless proof coil chain by the foot | per ft | $2.16 | S | <https://uscargocontrol.com/products/stainless-steel-proof-coil-chain-by-the-foot-1-8-t304> | A 2 ft chain stay is about $4.30 plus two eye screws. Limits opening angle only; no friction hold. |
| 7. Lid stay | both | Metrol (UK) | NS-FF-4-100 mini gas strut, 100 mm stroke | each | n/a | NOT_FOUND | <https://www.metrol.com/online-shop/new-products/new-gas-struts.html> | UK price GBP 22-31 only; no US small stainless strut found. |

### 8. Chock cord (5 ft of 1/4 in.)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 8. Chock cord (5 ft of 1/4 in.) | both | Knot & Rope Supply | 1/4 in. solid braid polyester, white, per foot | per ft | $0.12 | F | <https://www.knotandrope.com/products/1-4-solid-braid-polyester> | Not bought: paracord from the shop stock is used for the chock cords. 5 ft = $0.60 plus shipping (not read). Tag lists about 1,300 lb breaking strength. Black $0.15/ft. Solid braid: cannot be spliced. |
| 8. Chock cord (5 ft of 1/4 in.) | both | Home Depot | Everbilt 1/4 in. x 50 ft hollow-braid poly rope (yellow) | 50 ft | $5.13 | S | <https://homedepot.com/p/Everbilt-1-4-in-x-50-ft-Hollow-Braid-Poly-Rope-Yellow-17974/202079607> | Fiber may be polypropylene, not polyester. Local pickup avoids shipping. |
| 8. Chock cord (5 ft of 1/4 in.) | both | Home Depot (SGT Knots) | 1/4 in. x 50 ft heavy-duty twisted polyester rope, white | 50 ft | $7.17 | S | <https://homedepot.com/p/SGT-KNOTS-1-4-in-x-50-ft-Heavy-Duty-All-Weather-Twisted-Polyester-Rope-White-RH-TP-14x50ft-White/330203945> | Twisted, not braided. |
| 8. Chock cord (5 ft of 1/4 in.) | both | Walmart | 550 paracord 100 ft (West Coast Paracord / Atwood) | 100 ft | $10.99 | S | <https://www.walmart.com/ip/645716601> | $10.99-$13.99. 4 mm (5/32 in.), 550 lb break: thinner than 1/4 in. |

### 9. Brake return bungee (2 ft of 1/4 in.)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 9. Brake return bungee (2 ft of 1/4 in.) | both | Home Depot | T.W. Evans 1/4 in. x 100 ft shock cord | 100 ft | $18.60 | S | <https://homedepot.com/p/T-W-Evans-Cordage-1-4-in-x-100-ft-Elastic-Bungee-Shock-Cord-SC-104-100/205327122> | Confirms the $18.60 current spec. |
| 9. Brake return bungee (2 ft of 1/4 in.) | both | Knot & Rope Supply | 1/4 in. shock cord, white or black, per foot | per ft | $0.19 | F | <https://www.knotandrope.com/products/1-4-shock-cord-500-spool> | **BOM uses this.** 2 ft = $0.38 plus shipping (not read); buy with the chock cord. |
| 9. Brake return bungee (2 ft of 1/4 in.) | both | Campmor | 1/4 in. bungee shockcord by the foot (polypropylene sheath) | per ft | $0.99 | S | <https://www.campmor.com/collections/general-maintenance/brand_e-l-wood-braiding-company> | Higher per-foot price but a local-type retailer. |
| 9. Brake return bungee (2 ft of 1/4 in.) | both | eBay seller | 25 ft 1/4 in. marine-grade shock cord | 25 ft | $19.99 | S | <https://www.ebay.com/itm/373397193117> | No saving. |

### 10. Deck drain nipples (need 6)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 10. Deck drain nipples (need 6) | extreme | Nassau National Cable | 3/8 in. hose barb x 3/8 in. male NPT, 304 stainless hose nipple (73952) | each | $12.73 | S | <https://nassaunationalcable.com/products/3-8-in-hose-barb-3-8-in-male-npt-304-stainless-steel-hose-nipple-mip-adapt-73952> | 304 confirmed in listing. 6 = $76. |
| 10. Deck drain nipples (need 6) | extreme | G.W. Kent | 3/8 in. hose nipple x 3/8 in. NPT male, 304L stainless | each | $12.95 | S | <https://www.gwkent.com/hose-nipple-x-3-8-npt-3-8.html> | $11.66 each at 5, $10.36 each at 10: 6 at the 5-tier = $70. |
| 10. Deck drain nipples (need 6) | extreme | Titan Fittings | 3/8 in. hose x 3/8 in. NPT male rigid barb, 316 stainless | each | $9.12 | S | <https://titanfittings.com/3-8-hose-x-3-8-npt-male-pipe-rigid-stainless-hose-barb> | 316, not 304. Snippets show $9.12 straight and $6.32 for a 45 degree style. |
| 10. Deck drain nipples (need 6) | standard | (no purchase) | Drilled drain hole sealed with epoxy | 6 holes | $0.00 | NOT_FOUND | - | **BOM uses this.** Standard spec: drilled, epoxy-lined drain holes. The Extreme spec keeps stainless nipples at the real $10-13 each. Free. The $5.20 estimate for a real 304 nipple is too low: the real price is $9-13 each ($55-76 for six). |

### 11. Storage-box lid hinges (2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 11. Storage-box lid hinges (2) | both | MarineEngine | Seachoice 34911 butt hinge 1-5/8 x 2-1/2 in., 304 SS, 2-pack | 2-pack | $18.42 | S | <https://www.marineengine.com/boat-accessories/hardware/34911> | Confirms the current spec ($9.21 per hinge). Site blocks fetch. |
| 11. Storage-box lid hinges (2) | both | Home Depot | Everbilt 2-1/2 in. stainless non-removable-pin narrow utility hinge, 2-pack (29207) | 2-pack | $5.47 | S | <https://homedepot.com/p/Everbilt-2-1-2-in-Stainless-Steel-Non-Removable-Pin-Narrow-Utility-Hinge-2-Pack-29207/314151807> | **BOM uses this.** Stainless grade not stated (could be 201/430); 0 in stock at the store shown. Check magnet or ask before using in wet oak. |
| 11. Storage-box lid hinges (2) | both | Ace Hardware | Ace 2-1/2 in. stainless narrow hinge, 2-pack | 2-pack | $16.99 | S | <https://www.acehardware.com/p/5297809> | Grade not stated. |

### 12. Seat-back hinge (2 x 2 in. 304)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 12. Seat-back hinge (2 x 2 in. 304) | both | MarineEngine | Sea-Dog 201582-1 stainless butt hinge 2 x 2 in., 2-pack (304) | 2-pack | $22.01 | S | <https://www.marineengine.com/boat-accessories/hardware/201582-1> | Confirms the current spec. Fisheries Supply 205142-1 (316) $23.50. |
| 12. Seat-back hinge (2 x 2 in. 304) | both | Ace Hardware | Ace 2 in. stainless narrow tight-pin hinge, 2-pack | 2-pack | $12.99 | S | <https://www.acehardware.com/departments/hardware/door-hardware/door-hinges/5006016> | **BOM uses this.** Grade not stated. Narrow (non-mortise) style. |
| 12. Seat-back hinge (2 x 2 in. 304) | both | Home Depot | Everbilt 2 in. stainless narrow utility hinge, 2-pack (29197) | 2-pack | n/a | NOT_FOUND | <https://www.homedepot.com/p/Everbilt-2-in-Stainless-Steel-Non-Removable-Pin-Narrow-Utility-Hinge-2-Pack-29197/314151585> | Price not read; the 1-1/2 in. is $4.47 and 2-1/2 in. is $5.47 for 2-pack (so about $5): do not rely on this without a look. |

### 13. Draw latches 304 (2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 13. Draw latches 304 (2) | both | Walmart (Unique Bargains) | 1.83 in. SUS304 stainless draw toggle latch, spring-steel hook, 2 pcs | 2-pack | $9.79 | S | <https://www.walmart.com/ip/48403369> | Confirms the $9.79. Uxcell 2-pc $8.91 and DRAFIDEEP 2-pack $8.84 (grade not confirmed). |

### 14. Quick-release detent pin 3/8 in. (2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 14. Quick-release detent pin 3/8 in. (2) | both | Zoro | Detent hitch pin 3/8 in. dia, 1-1/2 in. usable, stainless (G9106146) | each (9-pack $21.15) | $2.35 | S | <https://www.zoro.com/i/G9106146/> | Sold in multiples of 9; no lanyard. Zoro blocks fetch. |
| 14. Quick-release detent pin 3/8 in. (2) | both | vxb.com | 304 stainless push-button quick-release pin with 250 mm rope | each | n/a | NOT_FOUND | <https://vxb.com/ja/products/stainless-steel-304-push-button-quick-release-pin> | Price in snippet was garbled. |

### 15. Clevis pin + lynch pin (2)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 15. Clevis pin + lynch pin (2) | both | SC Fastening Systems | Clevis pin 3/8 x 2 in. zinc (domestic, cotterless), pack of 25 | 25-pack | $14.64 | S | <https://catalog.scfastening.com/printitem/pins/clevis-pins/clp-038-0200-z-c?plpver=30> | Pack of 25; imported $29.73. Lynch pins not included. |
| 15. Clevis pin + lynch pin (2) | both | Tractor Supply | CountyLine assorted adjustable clevis pins, 14-pack | 14-pack | $14.99 | S | <https://www.tractorsupply.com/tsc/catalog/clevis-pins> | Sizes not confirmed. |

### 16. UHMW pieces

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 16. UHMW pieces | both | eBay (FL seller) | UHMW white 1/2 x 4 x 12 in. | each | $15.94 | S | <https://www.ebay.de/itm/324868029306> | Old-looking listing; matches the current $15.88 eBay estimate. Cut the 3 x 3 disc from it. |
| 16. UHMW pieces | both | Walmart (Fix Supply) | White UHMW 6 x 6 x 1/2 in. | each | $25.82 | S | <https://www.walmart.com/ip/237259136> | Price tracker shows $19.11 on 14 Jul 2026. |
| 16. UHMW pieces | both | Woodcraft / Piedmont | UHMW 1/2 x 4 x 48 in. | each | $41.99 | S | <https://www.woodcraft.com/products/uhmw-sheet-1-2-thick> | Large piece; shipping surcharge. |
| 16. UHMW pieces | both | (none found) | UHMW 1/4 x 2 x 6 in. | each | n/a | NOT_FOUND | - | No small 1/4 in. US price found; Global Industrial 12 x 12 with adhesive is $38.95 [S]. Cut it from the 1/2 in. piece or use scrap. |

### 17. Rubber for brake pads and tread

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 17. Rubber for brake pads and tread | both | Zoro | High-strength neoprene sheet 70A, 3/8 x 6 x 12 in. | each | $15.59 | S | <https://www.zoro.com/i/G7797929/> | Above the $8 estimate. Zoro blocks fetch. |
| 17. Rubber for brake pads and tread | both | Zoro | Commercial-grade neoprene 60A, 3/8 x 12 x 12 in. | each | $19.59 | S | <https://www.zoro.com/i/G6257815/> | Adhesive backed. |
| 17. Rubber for brake pads and tread | both | Home Depot (Rubber-Cal) | SBR sheet 3/8 x 12 x 36 in. | each | $30.94 | S | <https://www.homedepot.com/p/Rubber-Cal-Styrene-Butadiene-Rubber-SBR-3-8-in-T-x-12-in-W-x-36-in-L-Rubber-Sheets-20-100-0375-36-012/315723852> | Much more than needed. |
| 17. Rubber for brake pads and tread | both | (none found) | 1/8 in. ribbed rubber tread 4 x 5 in. | each | n/a | NOT_FOUND | - | No small-piece price found. Idea (unpriced): a rubber stair tread or door mat scrap from a hardware store. |

### 18. Oil-embedded bronze sleeve bearing 5/8 x 1 x 1-1/2

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 18. Oil-embedded bronze sleeve bearing 5/8 x 1 x 1-1/2 | both | Zoro | Bunting EBCB101612 cast bronze sleeve bearing 5/8 ID x 1 OD x 1-1/2 L (not oil-embedded) | each | $13.59 | S | <https://www.zoro.com/bunting-bearings-sleeve-bearing-58-id-1-od-1-12l-ebcb101612/i/G5910390/> | Cast bronze, needs grease, lead-free. Same size; double the $7 estimate. |
| 18. Oil-embedded bronze sleeve bearing 5/8 x 1 x 1-1/2 | both | McMaster-Carr / Applied | SAE 841 oil-embedded 5/8 x 1 x 1-1/2 in. | each | n/a | NOT_FOUND | <https://www.mcmaster.com/product/6391K411/> | Prices are hidden in snippets (McMaster shows '00000'; Applied 'price unavailable'). Estimate of $7 unconfirmed. |

### 19. Tool pouch and tools

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 19. Tool pouch and tools | both | Harbor Freight | YUKON 12 in. Zipper Utility Pouch, black | each | $2.99 | F | <https://www.harborfreight.com/search?q=tool+pouch> | Read from the search list; 12 in. is longer than the 9 in. needed. Check the cut-out in store. |
| 19. Tool pouch and tools | both | Harbor Freight | BAUER 12-Pocket Framers Pouch | each | $9.99 | F | <https://www.harborfreight.com/search?q=tool+pouch> | Open-top, not zippered. |
| 19. Tool pouch and tools | both | Harbor Freight | PITTSBURGH 3/8 in. Drive Quick-Release Ratchet #70591 | each | $11.99 | F | <https://www.harborfreight.com/38-in-drive-quick-release-ratchet-70591.html> | Regular $29.97 shown as sale; the $7.96 coupon expired 11 Oct 2026. 0.84 lb. |
| 19. Tool pouch and tools | both | Harbor Freight | PITTSBURGH 3/8 in. Drive SAE Impact Socket Set, 8-piece #67909 (5/16 to 3/4 in., includes 9/16) | set | $14.99 | F | <https://www.harborfreight.com/38-in-drive-sae-impact-socket-set-8-piece-67909.html> | No single 9/16 socket sold; this is the cheapest set found. |
| 19. Tool pouch and tools | both | Harbor Freight | PITTSBURGH Fully Polished SAE Combination Wrench Set, 9-piece #42304 (includes 9/16) | set | $7.99 | F | <https://www.harborfreight.com/search?q=9/16+wrench> | Coupon price valid to 29 Oct 2026; list $9.99. No single 9/16 wrench sold. Ratchet+sockets+wrenches = $34.97: only worth it if the troop has no tools. |

### 20. Anti-seize

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 20. Anti-seize | both | Walmart | Permatex Anti-Seize Lubricant 1 oz tube (81343) | 1 oz | $3.97 | S | <https://www.walmart.com/ip/19868891> | Was $5.00. Tube not brush-top. |
| 20. Anti-seize | both | Ace Hardware | Permatex Anti-Seize Lubricant 1 oz | 1 oz | $6.99 | S | <https://www.acehardware.com/departments/automotive-rv-and-marine/fluids-and-lubrication/anti-seize-lubricants/87644> | Classic Industries $5.99 sale [S]. |
| 20. Anti-seize | both | Walmart | Permatex copper anti-seize 8 oz brush-top (9128) | 8 oz | $17.11 | S | <https://www.walmart.com/c/kp/antiseize> | Brush-top only comes in large sizes; copper type. |

### 21. ASA filament 1 kg

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 21. ASA filament 1 kg | both | Overture | Overture ASA 1.75 mm, 1 kg | 1 kg | $19.99 | F | <https://overture3d.com/products/overture-asa-filament-1-75mm> | Base variant price (range to $29.99 for other colors/sizes). Print needs only about 0.4 lb total. |
| 21. ASA filament 1 kg | both | Polymaker US | Polymaker ASA | 1 kg | $24.99 | F | <https://us.polymaker.com/products/asa> | Starting price; PolyLite ASA colors $26.99 at MatterHackers. |
| 21. ASA filament 1 kg | both | MatterHackers | MH Build Series ASA 1 kg | 1 kg | $29.99 | F | <https://www.matterhackers.com/store/c/asa> | $22.49 in bulk. Bambu ASA $46.99. |

## 7 Consumables, glue and finish

### 22. Epoxy (47-60 fl oz mixed, with pumps)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | MAS Epoxies | 5:1 Traditional Marine Epoxy Kit, 38.4 fl oz, slow or fast, with 2 pumps + 2 cups | 38.4 oz kit | $59.99 | F | <https://masepoxies.com/products/5-1-traditional-marine-epoxy-kits> | Confirmed. Two kits = 76.8 oz = $119.98. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | MAS Epoxies | 5:1 Traditional Marine Epoxy Kit, 1.2 gal (153.6 oz), pumps incl. | 1.2 gal kit | $149.99 | F | <https://masepoxies.com/products/5-1-traditional-marine-epoxy-kits> |  |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | MAS Epoxies | 2:1 Premium Non-Blushing Marine Epoxy Kit, 1.5 qt (48 oz), slow/medium/fast | 1.5 qt kit | $72.99 | F | <https://masepoxies.com/collections/marine-epoxy-products> | Pumps/cups per the MAS kit contents (not re-checked per size). 0.75 gal $122.99; 1.5 gal $196.99. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | Amazon (third-party mirror) | MAS Marine Epoxy Resin Kit 1.5 qt, medium, 2:1, cups and pumps | 1.5 qt kit | $54.99 | S | <https://sentinel.rocketium.com/products/amazon/B0CT64Y8ZP> | Mirror of the Amazon listing, not the Amazon page; price below MAS's own $72.99 so unverified. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | TotalBoat | 5:1 Traditional Epoxy quart kit (about 36 fl oz), fast or slow | quart kit | $68.99 | F | <https://www.totalboat.com/products/5-1-marine-epoxy-resin-kits> | Gallon kit (about 152 fl oz) $159.99; no 1.5 qt in 5:1. Calibrated pumps in kit per product page. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | U.S. Composites | 635 Thin Epoxy 3:1 kit EPOX-635313: 1/2 gal resin + 21.3 oz hardener (about 85 oz mixed) | kit | $51.00 | F | <https://uscomposites.com/prices.html> | Price list dated 7 Aug 2026. Pot life 20-25 min. 3:1 pump set (EPX-P31) $8.50 extra. Shipping not read. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | U.S. Composites | 635 Thin Epoxy 2:1 (hardener #556, 35-40 min): 64 oz resin + 32 oz hardener (96 oz mixed) | kit | $53.45 | F | <https://uscomposites.com/prices.html> | **BOM uses this.** The 96 oz kit with the 2:1 pumps ($8.50) is $61.95. Thin resin: joints and fillets need thickener. Shipping not read. Price list dated 7 Aug 2026. Add 2:1 pump set $8.50 (each stroke 1 fl oz) = $61.95 for 96 oz. Thin resin: thicken with silica for joints and fillets. Shipping not read. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | U.S. Composites | Epoxy pump set EPX-P31 (3:1) or 2:1, 38 mm screw top | set | $8.50 | F | <https://www.uscomposites.com/epoxy.html> | **BOM uses this.** West #300 pumps $26.79. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | U.S. Composites | 635 Thin Epoxy 3:1 kit EPOX-635312: quart resin + 10.6 oz hardener (about 43 oz) | kit | $29.45 | F | <https://uscomposites.com/prices.html> | Two quart kits = 86 oz = $58.90, no cheaper than the 1/2 gal. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | Fiberglass Supply | System Three General Purpose epoxy 3-pint kit: 1 qt resin + 1 pt hardener (48 oz) | kit | $72.00 | F | <https://fiberglasssupply.com/epoxy/system-three-epoxies/system-three-gp-epoxies/> | 1.5 pint kit $47.50; 3 quart kit $139.00. Pumps not included. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | Boat Builder Central | Marinepoxy System All Purpose Epoxy Kit (smallest) | kit | $65.13 | F | <https://boatbuildercentral.com/product-category/epoxy/marinepoxy/> | Range $65.13 to $1,020; size of the smallest kit not read. No pumps listed. |
| 22. Epoxy (47-60 fl oz mixed, with pumps) | both | Jamestown Distributors | marine epoxy kit 1.5 qt | kit | n/a | NOT_FOUND | - | Searched; only a ThickSet Cast and Coat 2 qt at $44.99 on Woodcraft, a casting resin, not marine. West 105/206 1.2 qt $94 not re-checked. |

### 23. Thickener (fumed/colloidal silica)

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 23. Thickener (fumed/colloidal silica) | both | Fiberglass Supply | West System 406 Colloidal Silica 5.5 oz | 5.5 oz | $41.82 | F | <https://fiberglasssupply.com/epoxy/west-system/west-system-fillers/west-system-406-colloidal-silica/> | Confirmed. Hamilton Marine/Powerboat Supply $39.08 [S]. 1.7 oz $23.73. |
| 23. Thickener (fumed/colloidal silica) | both | U.S. Composites | Aerosil / Cab-O-Sil fumed silica, 1 quart | 1 qt | $4.60 | F | <https://uscomposites.com/prices.html> | **BOM uses this.** 2.5 qt $6.95; 5 qt $10.75. Volume (quart), not weight. Best bundled with the epoxy order for one shipping charge. |
| 23. Thickener (fumed/colloidal silica) | both | TotalBoat | Silica Thickener, 1 quart | 1 qt | $14.99 | F | <https://www.totalboat.com/products/silica-thickener> | 5 quart $27.99. |
| 23. Thickener (fumed/colloidal silica) | both | MAS Epoxies | Colloidal Silica sag-resistant structural filler, quart (2.0 lb) | 1 qt | $21.99 | F | <https://masepoxies.com/products/colloidal-silica-sag-resistant-structural-filler> | Dense filler, not the fluffy fumed type. |
| 23. Thickener (fumed/colloidal silica) | both | MAS Epoxies | Wood Flour structural wood filler, quart | 1 qt | $18.99 | F | <https://masepoxies.com/collections/marine-epoxy-products> | Free alternative: sanding dust. |

### 24. Bedding sealant

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 24. Bedding sealant | both | Flecks Marine | BoatLIFE Life-Calk 1033 white 10.6 oz cartridge | 10.6 oz | $27.00 | S | <https://flecksmarine.com/products/boatlife-life-calk-cartridge-white-1033> | Confirms the $27.00 (was $29.99). DRSA $29.99; TackleDirect $34.99. |
| 24. Bedding sealant | both | Powerboat Supply | BoatLIFE Life-Calk 1030 white 2.8 oz tube | 2.8 oz | $15.69 | S | <https://powerboatsupply.com/boat-supplies-accessories/paint-maintenance/sealant-adhesive/caulks-sealants/boat-life-life-calk-tube-white-1030> | **BOM uses this.** Priced; the handle sockets are bedded in thickened epoxy instead. Was $32.19. Fisheries Supply $16.42; liquid 1055 black $13.99 at Mealey Marine. |
| 24. Bedding sealant | both | Walmart | 3M Marine Adhesive Sealant 4000 UV 05280 white, 3 fl oz | 3 oz | $20.92 | S | <https://www.walmart.com/ip/3M-Marine-Adhesive-Sealant-4000-UV-05280-Medium-Strength-Flexible-Waterproof-Boats-RVs-Resistant-Cures-24-Hours-White-3-fl-oz-Tube/7881952480> | Not cheaper; ToolUp 6-pack $88.20. |
| 24. Bedding sealant | both | (none found) | butyl tape | roll | n/a | NOT_FOUND | - | Not searched at a vendor with a price. |

### 25. Fiberglass tape 2 in.

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 25. Fiberglass tape 2 in. | both | Defender / Powerboat Supply | West System 729-10 glass tape 2 in. x 10 ft (9 oz) | 10 ft | $14.88 | S | <https://defender.com/en_us/west-system-episize-glass-2-x-10-729-10> | Confirms $14.88. West 2024 list $14.03. |
| 25. Fiberglass tape 2 in. | both | U.S. Composites | 8.7 oz glass cloth tape 2 in., by the yard | per yd | $0.70 | F | <https://uscomposites.com/prices.html> | **BOM uses this.** 20 ft = 6.7 yd = $4.67. Full 50 yd roll $21.75. Shipping not read. |
| 25. Fiberglass tape 2 in. | both | Fiberglass Supply | 2 in. wide 8.71 oz fiberglass tape | per yd | $0.99 | S | <https://fiberglasssupply.com/2in-wide-8-71-oz-fiberglass-tape/> | Unit of measure 'Yard'; 50 yd roll price not read. |
| 25. Fiberglass tape 2 in. | both | Aircraft Spruce | 8.7 oz glass tape 2 in. x 50 yd | 50 yd | $75.75 | S | <https://www.aircraftspruce.com/catalog/pnpages/01-06600.php> | Conflicting prices across pages ($62.80 to $107.75). |

### 26. Spar urethane

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 26. Spar urethane | both | Walmart | Minwax Helmsman spar urethane, quart | 1 qt | $22.88 | S | <https://www.walmart.com/ip/Minwax-630520444-Water-Based-Helmsman-Indoor-Outdoor-Spar-Urethane-Satin-Clear-1-Quart-1-Piece-1-Pack/17300104> | Confirms $22.88 for one listing (up to $45.76 for other options). Ace water-based gloss quart $29.99 [S]. |
| 26. Spar urethane | both | eBay | Minwax Helmsman oil-based spar urethane gloss, gallon (dented can) | 1 gal | $59.99 | S | <https://www.ebay.com/p/1800816478> | Ace gallon $59.99 not reproduced (Ace blocks fetch); Walmart water-based gallon $71.99. |

### 27. Contact cement

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 27. Contact cement | both | Walmart | DAP Weldwood Original Contact Cement 00271, 1 pint | 1 pt | $9.12 | S | <https://www.walmart.com/ip/Dap-00271-Weldwood-Original-Contact-Cement-1-Pint/17243980> | Eric owns contact cement; the BOM lists it at $0. Wylaco pint $10.43 [S]. Third-party pricing varies. |
| 27. Contact cement | both | Walmart | DAP Weldwood contact cement 3 oz can | 3 oz | $7.39 | S | <https://www.walmart.com/c/kp/contact-cement> | 'From' price; range $7.39-$9.97. |
| 27. Contact cement | both | Walmart | Barge All-Purpose Cement 2 oz | 2 oz | $9.98 | S | <https://www.walmart.com/c/kp/glue-cement> | Quart $39. |

### 28. Oak veneer edge banding 3/4 x 25 ft

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 28. Oak veneer edge banding 3/4 x 25 ft | both | Ace Hardware | Band-It red oak edge banding 0.75 in. x 25 ft, pre-glued | 25 ft | $9.99 | S | <https://www.acehardware.com/p/5005152> | **BOM uses this.** Ace blocks fetch. 0.88 in. wide version $12.99. |
| 28. Oak veneer edge banding 3/4 x 25 ft | both | Home Depot | EdgeMate 13/16 in. x 25 ft prefinished red oak veneer edgebanding | 25 ft | $12.97 | S | <https://homedepot.com/p/EDGEMATE-13-16-in-x-25-ft-Prefinished-Red-Oak-Real-Wood-Veneer-Edgebanding-with-Hot-Melt-Adhesive-4983030/314095449> | 13/16 in. wide, not 3/4 in. |

### 29. Black paint for engraved lettering

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 29. Black paint for engraved lettering | both | Walmart | Sharpie Oil-Based Paint Marker, fine point, black | each | $4.90 | S | <https://www.walmart.com/ip/seort/5468037669> | **BOM uses this.** Medium tip single $2.91 at Staples (2025 page) [S]. |
| 29. Black paint for engraved lettering | both | Klem's (MA) | Rust-Oleum Stops Rust gloss black protective enamel, half pint | 1/2 pt | $9.99 | S | <https://klemsonline.com/p/rust-oleum-stops-rust-gloss-black-protective-enamel-020066777975> | Local-pickup store; shows the half pint exists at about $10. |

### 30. Mineral spirits

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 30. Mineral spirits | both | Walmart | Klean-Strip odorless mineral spirits, quart | 1 qt | $8.68 | S | <https://www.walmart.com/ip/516574302> | Eric owns mineral spirits; the BOM lists it at $0. Other Walmart listings $10.23. No pint found; quart is the smallest size seen. |
| 30. Mineral spirits | both | Ace Hardware | Klean-Strip odorless mineral spirits, quart | 1 qt | $9.99 | S | <https://www.acehardware.com/p/1438621> |  |

### 31. Shop supplies

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 31. Shop supplies | both | Harbor Freight | HARDY 5 mil nitrile powder-free gloves, 100-pack, medium | 100 | $12.99 | F | <https://www.harborfreight.com/5-mil-nitrile-powder-free-gloves-100-pack-medium-light-blue-68496.html> | Part of the supplies lot Eric owns; $0 in the BOM. Regular $16.28; in-store only. |
| 31. Shop supplies | both | Harbor Freight | 3 in. chip brushes, 12-pack | 12 | $9.99 | F | <https://www.harborfreight.com/3-in-chip-brushes-12-pack-58086.html> | Part of the supplies lot Eric owns; $0 in the BOM. 4 in. 12-pack $15.99 [S]. |
| 31. Shop supplies | both | Harbor Freight | High-Density Foam Mini Roller Kit, 3-piece #59777 | kit | $3.49 | S | <https://www.harborfreight.com/high-density-foam-mini-roller-kit-3-piece-59777.html> | Part of the supplies lot Eric owns; $0 in the BOM. Snippet price; the coupon version of this price expired 8 Oct 2026. |
| 31. Shop supplies | both | MAS Epoxies | 32 oz mixing cup | each | $6.99 | F | <https://masepoxies.com/collections/marine-epoxy-products> | 16 oz cups 10-count $17.99. MAS kits already include 2 quart cups. |

### 32. Festool Domino tenons

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 32. Festool Domino tenons | both | The Power Tool Store | Festool Beech Domino D 5x30 /300 (494938) | 300 | $25.00 | F | <https://thepowertoolstore.com/products/festool-494938> | Eric owns beech Dominos in all sizes; $0 in the BOM. Confirms $25.00 (Fisheries Supply $31.00). |
| 32. Festool Domino tenons | both | The Power Tool Store | Festool Beech Domino D 8x50 /100 (494941) | 100 | $25.00 | F | <https://thepowertoolstore.com/collections/power-tools/products/festool-494941> | Eric owns beech Dominos in all sizes; $0 in the BOM. Confirms $25.00. |
| 32. Festool Domino tenons | both | The Power Tool Store | Festool Sipo Domino D 5x30 /300 (494869) | 300 | $57.00 | F | <https://thepowertoolstore.com/collections/power-tools/products/festool-494869> | Smallest Sipo size found. |
| 32. Festool Domino tenons | extreme | The Power Tool Store | Sipo Domino D 4x20 | pack | n/a | NOT_FOUND | <https://thepowertoolstore.com/search/suggest.json?q=domino+4x20> | No Sipo 4x20 listed at this dealer; only Beech 4x20 /450 (495661) at $25.00 [F]. |
| 32. Festool Domino tenons | both | The Power Tool Store | Festool Beech Domino D 4x20 /450 (495661) | 450 | $25.00 | F | <https://thepowertoolstore.com/search/suggest.json?q=domino+4x20> | Eric owns beech Dominos in all sizes; $0 in the BOM. Beech, not Sipo: not an exterior-rated tenon. |

### 33. Pre-stain conditioner and water-based dye

| Item | Spec | Vendor | Product | Unit | Price | Tag | URL | Notes |
|---|---|---|---|---|---|---|---|---|
| 33. Pre-stain conditioner and water-based dye | both | Walmart | Minwax Water-Based Pre-Stain Wood Conditioner, quart | 1 qt | $18.48 | S | <https://www.walmart.com/ip/345399508> | Removed from the Standard spec (clear finish only, no stain). Was $24.97. Ace $21.99-$24.99; True Value $21.99. The $16.77 current spec was not reproduced. |
| 33. Pre-stain conditioner and water-based dye | both | Woodcraft | General Finishes Water Based Dye, pint (B042-L) | 1 pt | $20.99 | F | <https://www.woodcraft.com/products/general-finishes-water-based-dye> | Removed from the Standard spec (clear finish only, no stain). Oak Tree Supply $19.60 [S]; some Walmart sellers up to $29.95. |

## 8 Blocked and not found

- **Blocked:** homedepot.com and lowes.com for plywood (403); noahsmarine.com prices (JavaScript variant picker); Jamestown Distributors and CLC (no values returned); crlumber.com (403); McMaster-Carr (JavaScript page never renders; affects the 1045 rod, 1/16 strip, 316 tee nuts and inserts, 316 thumb screws); Metals Depot (prices only after choosing a size in the cart; plain fetch 403); Fastenal, Grainger (403 or empty); Lowe's, Albany County Fasteners, Fastener Superstore, Jamestown (fasteners; not used, nothing cheaper expected than Bolt Depot or Bolts and Nuts); Modern Bike, Walmart, Home Depot, Ace, Zoro, MarineEngine, Academy Sports, Rockler, Backcountry / Competitive Cyclist, Sportsman's Warehouse (snippet prices only).
- **Not found (lumber and sheet):** Atlanta Hardwoods and Highland Woodworking current white oak prices; Peach State 6/4 white oak; any Atlanta source of 5/4 or 6/4 other than Peach State's 5/4; 5 or 6 mm okoume in Georgia; 12 mm okoume at Aircraft Spruce, Peach State, or Randall Brothers online; BS 6566 6 mm price; a 5x10 Baltic birch price; Wood-Source 6 mm; Hearne and Ocooch 5/4 and 6/4 prices; Joubert measured MOR/E; any meranti BS 1088 strength data.
- **Stale:** Cline Lumber (January 2023), Highland Woodworking (2009).
- **Not found (metal and fasteners):** 5/8 1045 round online at Online Metals (quote only); 1/16 x 1 stainless flat; 304 1-1/2 x 1-1/2 x 1/8 angle at Online Metals and 316 angle at Speedy; #6 x 2-1/2 flat-head wood screw in 18-8 or 316 (does not exist at Bolt Depot or Bolts and Nuts); 316 #10-32 insert or tee nut, 316 thumb screw, 316 screw eye, 316 #8 x 2-1/2 wood screw; A36 5/8 round (comparison, not checked).
- **Not found (parts and consumables):** Dual Lock 1" x 6 ft at Walmart; a small stainless gas strut in the US; Everbilt 2" hinge price; a 3/8" detent pin with lanyard; a 2-pack of 3/8" clevis and lynch pins; UHMW 1/4 x 2 x 6; ribbed 1/8" rubber tread; oil-embedded bronze bearing 5/8 x 1 x 1-1/2; Jamestown marine epoxy 1.5 qt; butyl tape; Sipo Domino 4x20 (Festool makes none; the smallest Sipo is 5x30); the Trim-Lok $52.74 and Minwax conditioner $16.77 current prices; Ace gallon spar urethane $59.99.

### Blocked-site rows (parts and consumables pass)

| Site | Status | Notes |
|---|---|---|
| Modern Bike | BLOCKED | Prices from this site are search snippets [S] only. |
| Walmart (all pages: bot check) | BLOCKED | Prices from this site are search snippets [S] only. |
| Home Depot (403) | BLOCKED | Prices from this site are search snippets [S] only. |
| Ace Hardware (403) | BLOCKED | Prices from this site are search snippets [S] only. |
| Zoro (403) | BLOCKED | Prices from this site are search snippets [S] only. |
| MarineEngine (403) | BLOCKED | Prices from this site are search snippets [S] only. |
| Academy Sports (bot check) | BLOCKED | Prices from this site are search snippets [S] only. |
| Rockler (404 on fetch) | BLOCKED | Prices from this site are search snippets [S] only. |
| Backcountry / Competitive Cyclist (empty page) | BLOCKED | Prices from this site are search snippets [S] only. |
