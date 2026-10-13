# Phase 4 data outputs: notes (cutlist, nesting, bom, prices)

Files: `src/build/{cutlist,nesting,bom,prices}.ts` and their tests. New params (group `stock`, status `assumed`): `oakWasteAllowance` 0.30, `resawKerfIn` 0.125, `nestKerfIn` 0.25.

## Board thickness map (rough thickness -> smallest board; `BOARD_THICKNESSES` in cutlist.ts)
4/4 -> 13/16" usable, 5/4 -> 1-1/16", 6/4 -> 1-5/16", 8/4 -> 1-3/4", 12/4 -> 2-3/4". 16/4 (3-3/4") is my addition (not in the spec, rarely stocked) for parts that need more than 2-3/4".
Rough thickness already includes `millingAllowanceIn` (0.125), so a part fits a board when rough T <= usable.

## Oak board feet (nominal thickness x rough W x rough L / 144; +30 % waste = the priced quantity)
| Board | Net bf | With 30 % | Suggested boards (6" wide) | Whole boards bf |
|---|---|---|---|---|
| 4/4 | 7.05 | 9.17 | 2 x 10 ft | 10.0 |
| 5/4 | 2.64 | 3.44 | 1 x 10 ft | 6.25 |
| 6/4 | 0.61 | 0.80 | 1 x 6 ft | 4.5 |
| 8/4 | 7.65 | 9.95 | 1 x 8 ft + 1 x 6 ft (band resaw) | 14.0 |
| 12/4 | 11.92 | 15.50 | 1 x 6 ft + 1 x 10 ft + 1 x 6 ft (rail resaw) | 33.0 |
| Total | 29.89 | 38.85 | | 67.75 |

The suggested boards are whole boards, so they run higher than the allowance. The BOM prices the allowance (per the spec); buying exactly the suggested boards would add about $448 (`wholeBoardsExtraUsd`). Real shops will use the offcuts of the 8/4 and 12/4 boards for the 5/4 and 6/4 bits, so the truth is in between: ask the yard for an 8/4 and a 12/4 board first and see what is left.
Resaw: the 8 bands (0.359" rough strips) come from one 8/4 x 6" x 6 ft board (3 strips per board thickness, 3 layers, 6 bf). The 4 rail strips (0.5" rough, 3.125" wide, one per layer) come from one 12/4 x 6 ft board (4 strips, 9 bf). The pool picks the board with the fewest board feet, then the fewest boards.

## Sheets
- 4 mm okoume: 9 parts, 36.7 % used; largest offcut 36.0 x 47.5 in. The two webs lie lengthwise (unrolled, 59.2 x 14.3 in), the box, lid and signs beside them.
- 12 mm okoume: deck + seat back, 33.0 % used; offcut 79.25 x 24.2 in beside the deck.
- Unplaced: none. Grain turned: none. Seat-back-panel has `grain: 'z'` (the thickness axis), so its grain is unknown and it was placed without a grain rule (see below).
- Packing is by bounding box (MaxRects, 0/90 degrees); the drawing carries the true outlines.

## BOM at the defaults (total $2,376.65; 84 % estimates)
Lumber $540.79, Plywood $265.00 (2 sheets), Metal stock $109.06, Purchased $609.00 ($372 quoted from the model's `costUsd`, $237 estimates), Fasteners $240.80, Consumables $612.00 (epoxy $240, varnish $210, the rest fillers, tape, stain, sandpaper). Every table price is an estimate; only 20 purchased lines are `quoted` (the model's own `costUsd`).
Fastener joint counts equal `fastenerBreakdown` (screws 95, bolts 55, inserts 12, knobs 10, Dominos 34, glue 115).

## Assumptions
- Prices (prices.ts) are 2026 US retail guesses, no SKUs. Both okoume sheets are full 4 x 8 sheets from a local supplier (4 mm $95, 12 mm $170). Oak $9.50/bf (4/4) to $18/bf (12/4).
- Waste allowance 30 % on net board feet; the 6" board width and 6/8/10 ft lengths are assumed; wide parts (> 6") are split into glue-up pieces (transom, bow bulkhead, brake knees).
- Rip, crosscut and resaw kerf are all `resawKerfIn`. Resaw yield = floor((usable + kerf) / (rough strip + kerf)); the planing allowance is already in the model's rough strip.
- Metal: priced per foot of cut length plus 0.25" per cut.
- Fasteners: each bolt gets a lock nut and 2 fender washers (1 for carriage bolts); the kingpin and the steering eye bolts are parts, so only the eye bolts' nut and washer are listed. All 316.
- Epoxy: 0.12 fl oz per glue joint + okoume area (faces + edges, 46 ft2) x 2 coats x 0.7 fl oz/ft2, +20 %: 94 fl oz, bought as the cheapest kit mix (3 quart kits). Glass tape 1.5 ft per taped joint (15 ft). Varnish 4 coats at 100 ft2/qt/coat, +15 % (5 qt); stain 1 qt, conditioner 1 qt. These mirror, but do not read, the finishing schedule (`finishing.ts`).
- Printed ASA clips are in Purchased parts at $3 each.

## Model data found wrong or missing (not fixed)
- `seat-crest-strip` stock/rough are T 13.5 x W 0.288 x L 1.5: transposed (the grain axis y is 13.5 long). The cut list treats it as 0.288 x 1.5 x 13.5 and warns.
- `brake-chock` (3.5 x 2.5 x 4.7) and `brake-shoe` (3 x 0.92 x 3.2) also have T that is not the smallest dimension. I sort the dimensions ascending (chock -> 2.5 thick, 12/4; shoe -> 0.92 thick, 5/4); if the real thickness is the 3-3/4" one, the chock needs 16/4 or two glued 8/4.
- `seat-grip-backing` (kind metal) has no `stock`; the size (1/16" x 1" x 6") is read from its sourcing text.
- `seat-back-panel` grain is `z` (the plywood normal), not an in-plane axis, so the nest cannot honor it. Its face grain should run along x or y.
- Several bolt joints give no length ("0.25" 316 button-head cap screws, 3 columns x 2 rows", the hanger bolts): listed as "length per joint note".
- A joint listed on both parts is deduped by (mate, count, type) as in `fastenerBreakdown`; a joint whose mate lists a different count is counted from both sides.
- `lighting.ts` treats `clamp-*` bolts as itemized (nuts and washers only), but the clamp bolts are not parts; the BOM lists them in full, so the hardware mass allowance is slightly low.

## Round 2 (build review MUST-9/10/11, boards, build book)
BOM total at the defaults **$2,678.39**: Lumber $635.13, Plywood $265.00, Metal stock $109.06, Purchased $609.00, Fasteners $283.40, Consumables $776.80.
- BOM now lists wheel collars (4) and cotter pins (4, 5/32 for the 0.156" hole), axle end plugs (6), hinge machine screws (6), handlebow rods (2), rail-to-chine screws (10, #8 x 3-1/2), button plugs (4), nylon washers (4), lid-batten screws (12), Dual Lock, edge banding, sealant, contact cement. Joint-text items are parsed in `jointItems`; note-only items sit in `NOTE_ITEMS` (cites the note, test checks the parts exist).
- Every screw/bolt line has a length (`Bom.unresolved` is empty, tested). Missing lengths fall back to the part-thickness stack, rounded up to a stock length. A `knob` joint with no screw size orders nothing. T-nuts are read from the joint text.
- Epoxy: glue epoxy = `glueEpoxyFlOz(parts)` (51 fl oz) + 20% waste; resin kits sized on resin (5/6 of the glue mix, 3/4 of the 3:1 mixes); 207/209 and the pumps come from the finishing buy list/supplies, plus a 301 set for the glue.
- Boards: `planResaw` now picks board thickness AND width (6/7/8") for the fewest bf with at least 1 spare strip: bands 8 strips from 1 x 4/4 x 8" x 6 ft (9 yielded, 1 spare); rails 4 strips from 1 x 8/4 x 7" x 6 ft (6 yielded, 2 spares). `ResawPool` carries `boardWidthIn`, `stripSlots`, `spares`, `yieldPerBoard`. The third 4/4 board is gone: its lid battens and rim pieces are cut from free lanes of the 5/4 and 6/4 boards (`OakPlan.folded`, `BoardCut.fromBoard`). Oak buy: 47.3 bf.
- `build-book.html` (and `nesting/*.svg`) are in the zip; the book is generated by `build-book.ts` from `BuildData`.
- Open: `lighting.ts` gives the M4 lamp screws no length (10 mm assumed in `METRIC_SCREW_MM`).

## Round 3 (build critic 7/10, files critic 8/10)
BOM total **$2,696.56**: Lumber $614.50, Plywood $265.00, Metal stock $109.06, Purchased $609.00, Fasteners $284.20, Consumables $814.80 (the consumables move with the finishing agent's changes). Mass 115.5106 -> 115.5906 lb (+0.080): the 10 rail-to-chine screws are now model joints, so the hardware allowance counts them (0.008 lb each).
- **MUST-B:** `brake-shoe` stock is now T 0.92 x W 3 x L 3.2 (5/4), `brake-chock` T 2.5 x W 3.5 x L 4.7 (12/4); the seat-grip backing strip has stock. The cut list has NO data warnings; tests: no oak part has T > W or L (no exceptions).
- **MUST-C:** `planResaw` rips FIRST: strips go into lanes (a lane = its widest strip + kerf, `k` slabs per lane via `makeLanes`), lanes are packed across board widths 6 to 10 in (`spareSlots` counts whole spare lanes). Critic's numbers (0.359 x 1.625, kerf 0.125, 4/4): 8 strips, 0 spare at 8 in; **bands now 1 x 4/4 x 9 in x 6 ft (4.5 bf, 10 strips, 2 spares)**, rails 1 x 5/4 x 10 in (6.25 bf, 6 strips, 2 spares). `ResawPool.layers/layerStrips` are now `lanes/laneStrips`.
- **Cut list:** `grainWord` ("along L / along W / vertical (T)", from the local extent), `assemblySteps` (the caller passes `stepMapOf(assemblySteps(...))`; `BuildData.cutList` does) next to the model `step`, and a `note` on the side web ("cut net 59.49" from the Shaper file; blank 59.59").
- **Hardware:** handle-socket screws 1/4-20 x 1-1/4 (1-3/4 stood 0.31 in past the backer face; now 0.19 short, 0.56 in of T-nut engaged). Rail-to-chine screws are #6 x 3-1/2 (3 in zone, 4 a side) and #6 x 2-1/2 (1.8 in zone, 1 a side), piloted, BETWEEN the Dominos (`joinery.ts`; the BOM no longer parses them out of the Domino text).
- **Forms/tiles:** form text is stroke-only in guide groups (print tiles fill it); pages with no cut path or drill mark are skipped (side form 27 -> 20; all forms 52 -> 44 pages); footer in two short lines; grain label clear of its arrow.

## D-70, links and finishing touches (2026-10-12)
- **No 12/4:** `OAK_STOCKED['12/4']` is false. `planLamination` (cutlist.ts) face-laminates any part no stocked board yields, from the cheapest mix per ft2 of face (sum of nominal x $/bf): the beams (3 x 3/4" from 4/4, $30/ft2), the knees and chocks (3 x 0.833" from 4/4). The 1/8" allowance is taken once on the glued block. Data: `OakRow.lamination/layerPieces`, group `laminated`, `CutList.layers`, `csv.layers`, `OakPlan.laminated`, `BoardCut.layer/layers`. Mass and analysis unchanged (115.5906 lb). Lumber $750.75 -> $500.75 (-$250).
- **Links:** `Price.url` (Wood Yard list and `#plywood`, Aircraft Spruce okoume) -> `BomLine.url`, the CSV `URL` column, `<a rel="noopener" target="_blank">` in the book. The model has no `sourcing.url` yet; the BOM honors one if it appears.
- **Finishing touches:** section `touches` after the core (lights, seat comfort, reflectors, tie-downs; `BomLine.group`, `BomSection.groups`). Lash doublers stay in Lumber (noted). Their fasteners follow them (M3/M4 screws and inserts, 24 lash screws, Dual Lock).
- **Bulk parts:** section `bulk` between core and touches. `Price.packQty/packUsd` (ESTIMATES; real pack data comes from the price research); a line needing under `BULK_SHARE` (50%) of a pack, or in `BULK_ALWAYS` (sandpaper), is priced by whole packs (`needed, packQty, packs, packUsd`; `qty` = packs). Bolts and one-at-a-time items stay. Touches lines keep their own section but use pack pricing.
- **Materials:** `BomLine.materialNote` on every fastener and metal hardware line (`fastenerMaterialNote`, `hardwareMaterialNote`); 316 default with the reason in the Fasteners note (`FASTENER_MATERIAL_NOTE`). Dominos are Festool Sipo, never beech (4x20 Sipo availability: VERIFY).
- **Totals:** `coreUsd + bulkUsd + touchesUsd = totalUsd` and `totalsText`. Default: core $2,143.83 + bulk $525.00 + touches $283.00 = $2,951.83 (pack pricing adds real money: Dominos $210, wood screws in 12 sizes $9 each).

## Price research applied (2026-10-12)

Source: `docs/price-research-2026-10.md` and `.json`. Every researched price is `quoted` with its URL, vendor and date in the note; prices the search tool read (not fetched) say "price read via search, confirm on the page". A model `costUsd` still wins except where the research found an exact part (seat hinges, lights, drains; the gasket, split four ways, is one roll).
- Totals before (all estimates): build $1,954.13 + bulk $525.00 + touches $283.00 = $2,762.13, 67% estimate. After: build $2,263.37 + bulk $652.11 + touches $338.60 = $3,254.08, 18% estimate ($599.73).
- Base is always the spec item. Cheaper items that miss the spec are `alternatives` in the line notes (SPEC GAP): 5/8" wheels, 304 collars, beech Dominos, thicker 1/8" bar, 18-8 cotter pins and clips, 2" hinges, 304 lid stay, small D-ring, 2" snap hook, big reflectors, short thumb knob. Fiberglass Supply epoxy ($205.80) is the gallon-group alternative to Rock West ($179.99).
- Pumps: one West System 300 Mini Pump Set ($28.99) replaces the 301 and 303 lines. 207 and 209 are not bought (206 only; sizes are 0.66 pt and 0.33 gal); a schedule that names one is flagged unpriced.
- Pack sizes now real: Sipo 5x30 pack of 300 and 8x50 pack of 100 ($57 each); Bolt Depot screws, washers and 1/4-20 nuts per 100; glass tape per 10 ft roll (2 rolls); metal bought as the vendor's fixed piece (60 in DOM, 12 in bars, 48 in tube); cords per 100 ft roll. A packed fastener is now priced by whole packs even when over half a pack is needed.
- Not found (kept estimates, noted): 1/4 x 1-3/4 and 1/16 x 1 bar, UHMW 1/4", bronze sleeve, 2-1/2" hinge, 316 draw latch, detent pin, clevis pin, #10 screw eye, 316 inserts, ASA filament, and screw/bolt lengths the research did not read.
- Decisions for Eric (`Bom.decisions`): (1) Domino 4x20: no Sipo exists (beech fully encapsulated, or 5x30 Sipo); (2) wheel spec: the 3/4" Access Casters wheel (hub 2-3/4", about 5 lb) against 5/8" axles with a $9.99 wheel; (3) shaft collars 316 ($133) or 304 ($17); (4) eye bolts at stock lengths 4-1/2" and 2-1/2", galvanized or 316 (4x); (5) carriage bolt 6" for 6-1/4".

## Weather spec (Standard / Extreme)

D-73, Eric 2026-10-12. `weatherSpec` 0 = **Standard** (default: garage-kept, a few times a year, wet at most at a rainy derby), 1 = **Extreme** (stored outside, near salt). Prices: Standard `docs/price-research-standard-2026-10.md`, Extreme `docs/price-research-2026-10.md`; nearest-size Standard listings are `estimate`s with their link.
- **Standard:** 18-8 (304) fasteners and hinges, latch and stay; zinc collars, inserts and D-rings; galvanized eye bolts and chain; beech Dominos; Titebond III (16 oz, `TITEBOND_VS_EPOXY` 0.4 of the epoxy estimate per joint; epoxy only for bent and D-70 face laminations, deck, fillets/tape, thickened bedding: `standardAdhesive`); epoxy coat on edges not captured + oak end grain + deck underside only; exterior spar urethane (100 ft2/qt; gallon once 3 qt); epoxy kit chosen among MAS 38.4 oz, TotalBoat quart and West (+300 pumps), others listed as alternatives. **Extreme:** as before (316 incl. eye bolts and chain, Sipo, epoxy everywhere, marine varnish, West kits).
- **By the piece:** `Price.eachUsd`; the BOM takes the cheaper of pieces and whole packs (Bulk parts $340 to $87 at Standard). Applies to both specs.
- **Differences:** `Bom.weatherCompare` (lazy, not enumerable; `bom(parts, p, { noCompare })` for the inner call) = totals, Extreme minus Standard by section, empty mass (thin sheet: white oak ply is 2.83 lb heavier, so Extreme is lighter). UI: BOM toggle, chip, per-section list; build book header, BOM and finishing; README line.
- **Fixes:** lid-batten screws #8 x 5/8 (3 wood-screw sizes in both specs); plywood line from `thinSheet(p)`; `finishMaterial(part, p)` classes white oak ply as `oakPly` (not okoume), Baltic as `birch`; `FinishAreas.plyFt2` is all plywood. Estimates: #6 x 2-1/2 18-8 (not found), 304 metal stock (85% of 316), 18-8 knurled thumb screw, zinc inserts (softwood type), 5/8 collars in 316.

## Cut list: actual cuts, rounded rough, allowances (Eric)

Eric 2026-10-12: the cut list lists the cuts, not the glued-up parts; rough sizes are not 15-21/32; laminate pieces need more tolerance; his bandsaw resaws 6".
- **Allowances (params, assumed):** thickness +`millingAllowanceIn` 1/8; plain solid width +`roughWidthAllowanceIn` 1/4, length +`roughLengthAllowanceIn` 1; glued/bent pieces (panel boards, D-70 layers, resaw strips) width +`laminateWidthAllowanceIn` 3/8, length +`laminateLengthAllowanceIn` 2. `roughOf(p, stock, laminate)` and `planOakPart` (cutlist.ts) apply them; the mass reads `stock`, so mass and analysis are unchanged (120.707 lb sum before and after).
- **Rounding:** every rough T/W/L rounds UP to 1/8 (T capped at what the board yields, so no part moves to a thicker board); finals round to the nearest 1/32 for display, exact in `final`. Helpers `roughFrac`, `finalFrac`, `roughDimsText`, `finalDimsText` in `src/build/units.ts`.
- **Cuts:** `CutList.cuts` (board/layer/strip/solid, with `qty`), `glueUps` (panel or block: `from`, `roughBlock`, `finalText`), `finished` (what each part is milled to). A panel is the fewest boards whose share of the width + 3/8 fits a 6" board (transom: 3 x 5-7/8; bulkhead, tongue, knee layers: 2).
- **Bandsaw (`bandsawResawCapacityIn` 6, locked):** rip first, so the resaw height is the strip WIDTH (rail 3-3/8", bands 1-7/8"), never the board's (7"-10"). `ResawPool.resawHeightIn/withinCapacity/text`; a strip taller than the saw is a warning. 
- **Board feet (defaults):** net 27.98 -> 31.37 bf, purchase 42.00 -> 48.25 bf (4/4 19.5 -> 25.0, 5/4 10 -> 3.75, 6/4 4.5, 8/4 8 -> 15; the rails now resaw from 8/4 x 7" because a 3-3/8" lane needs a third lane in 5/4 x 10"). Layers plane to 7/8" (not 25/32).

## Realistic board yields (Eric)

Eric 2026-10-13: "4/4 stock is often closer to 3/4 ... I can't mill 4/4 reliably to 27/32." New params (group stock, assumed): `boardYield44In` 3/4, `54` 1, `64` 1-1/4, `84` 1-3/4, `124` 2-3/4, `164` 3-3/4 = the reliable FINISHED thickness of each board after jointing and planing; `laminationCleanupIn` 1/8 (joint and plane the glued block flat and square).
- **Board choice** (`boardForThickness(finalT, p)`): thinnest stocked board whose finished yield >= the part's FINAL thickness. No solid part changed board at the defaults (nothing sits between the old and new thresholds). Resaw keeps the rough board (`resawUsableIn` = min(nominal - 1/8, yield + 1/8), the same numbers today), so the 8 band and 4 rail strips and their boards are unchanged.
- **Laminations** (`planLamination(finalT, _, p)`): layers planed to the yield rounded DOWN to 1/16 (3/4, 1, 1-1/4, 1-3/4); valid when sum(layers) - cleanup >= final; cheapest $/ft2 of face, then quoted-only within 15% (`LAMINATION_QUOTED_TOLERANCE`, was 5%: the 5/4 price is an estimate and a lone 5/4 board for one layer cost more in whole boards), then fewer layers. Beams (2-1/4): 8/4 + 4/4 ("1-3/4" + 3/4", then mill to 2-1/4""). Knees and chocks (2-1/2): 4 x 3/4 from 4/4. `LaminationLayer.finalT` now equals the planed layer thickness (it was a proportional share, hence 27/32).
- **Cost:** oak 48.25 -> 51.25 bf, $583.08 -> $653.08 (+$70.00): 4/4 25 -> 20, 8/4 15 -> 23 bf. If the beams and knees/chocks were 2-1/8 (3 x 3/4 - 1/8) the old $583.08 and 48.25 bf come back.
