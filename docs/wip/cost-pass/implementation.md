# Cost pass: implementation contract (2026-10-14)

Working notes for the parallel implementation; deleted when the cost pass lands. Every agent reads this first, then picks.md and savings.md in this folder for the reasoning. Price evidence (URLs, tags) is in research-*.md / research-*.json here.

## Rules for every agent
- Read CLAUDE.md (repo root). US English. Design numbers live only in `src/params.ts` (with `status`, `ref`, `note`). `src/model/**` and `src/analysis/**` have no three.js imports.
- **Never run `git stash`, `checkout`, `reset`, `commit`** or any git command that changes state. Other agents share this working tree.
- Edit only the files your brief owns. A file outside your list: use only small exact-string edits, and only where your brief says so.
- New decision IDs (cite them in code comments and `ref` fields; the orchestrator writes DECISIONS.md):
  - **D-79** Cost pass, sourcing: Peach State Lumber (Kennesaw) for oak and the thin sheet; 4/4 and 5/4 white oak only (6/4, 8/4 not bought; thicker parts face-laminated, D-70); owned shop stock priced at $0; the vendor picks of the bundle.
  - **D-80** Thin sheet: Standard = **6 mm Baltic birch** (4 x 8, Peach State $49); Extreme = **6 mm okoume BS 1088** (Aircraft Spruce $158.65). Supersedes the thin-sheet part of D-73 (4 mm okoume failed the side-web row).
  - **D-81** Domino rules: a tenon at most about a third of the stock (cap 0.34, was 0.42); DF 500 sizes only (Eric has no DF 700 XL); the chine-to-rail tie has **no Dominos** (epoxy bed plus screws; the analysis never credited them).
  - **D-82** Screws: the #6 x 2-1/2 is replaced by **#8 x 2-1/2** (no stainless #6 that long exists), driven into a pilot hole; every wood screw is then a #8 (amends D-72).
  - **D-83** Standard-spec simplifications: drilled, epoxy-lined drain holes (no nipples; Extreme keeps them); a plated-steel Rockler lid support (Extreme keeps the stainless stay); EVA kneeling-pad seat pads, 1-1/2" (no vinyl); bolt-on cargo D-rings rated 233 lb working load on two 1/4-20 bolts; no stain (clear finish only); rear clamp plates 1/4 x 2 stock bar.

## Shared names (the contract between agents)
- `THIN_SHEET = { followWeather: 0, whiteOakPly: 1, okoumeMarine: 2, balticBirch3mm: 3, balticBirch6mm: 4 }`. Follow-the-weather: Standard → `balticBirch6mm`, Extreme → `okoumeMarine`.
- `ThinSheet.priceKey` values (bom.ts prices the thin-sheet line by this key, NOT by the mm class): `'white-oak-1/4'`, `'okoume-6mm'`, `'baltic-3mm'`, `'baltic-6mm'`. The 12 mm deck sheet stays keyed `'12 mm'`.
- New params: `balticSixThickIn` (default 0.236, status verify: measure the sheet), `balticSixMoePerpPsi` (486000), `balticSixMorPerpPsi` (3990): Metsä Wood declared values for 6.5 mm 5-ply birch (bending E across/along 4,763/12,737 N/mm² = 0.374; strength 29.0/50.9 = 0.57) times the D-5 along-grain birch values (1.3 Msi, 7,000 psi). The along-grain values are `birchMoePsi`, `birchMorPsi`, density `birchDensityPcf`.
- `panelPlyIn` (the okoume thin sheet) default **0.236** (6 mm), and `okoumeMoePerpPsi` **315000**, `okoumeMorPerpPsi` **3000** (6 mm BS 1088 is 5-ply per Joubert; Bellotti's EN 310 data for 6 mm give cross/long E 3770/4650 and strength 32/35 N/mm²; these values take 0.35 and 0.6 of the along-grain D-5 values, conservative).
- `seatCushionIn` default **1.5** (EVA kneeling pad, D-83). Seat back pad: 1-1/2" EVA as well (a third pad), if a thickness param exists set it; else derive.
- `lashLoadLbf` default **233** (the Harbor Freight 1/4" cargo D-ring's working load, D-83); `lashBoltYieldPsi` label to 1/4-20.
- `clampPlateWidthIn` default **2** (stock 1/4 x 2 bar, D-83) if it introduces no overlap and no failing row; otherwise leave it at 1.75 and tell the orchestrator.
- Part ids: `scupper-*` and `storage-drain-*` parts exist **only under the Extreme spec**. Under Standard, the drains are `hole` joints (3/8", epoxy-lined bore) on the chine bands, web and deck. `storage-lid-stay` exists in both specs: Standard material "plated steel lid support (Rockler 6\")", Extreme the stainless friction stay. `lash-point` parts: a bolt-on D-ring with a 2-hole bracket on two 1/4-20 button-head bolts (fender washer, nylock) in both specs; Standard zinc, Extreme 316 (sourcing estimate).
- Wood screw `#6 × 2-1/2` becomes `#8 × 2-1/2` everywhere it appears (rail to chine, the rib knees into joist 5 and the king beam).
- Domino `8×50` at the rail ends becomes `6×40` (falls out of the 0.34 cap).

## Prices (bundle; quoted unless marked)
| Item | Vendor | Price | URL / note |
|---|---|---|---|
| White oak 4/4 FAS | Peach State Lumber | $8.25/bf | https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf (sheet "Hardwoods LEVEL 2", printed 9/9/2026: confirm the walk-in tier and kiln drying) |
| White oak 5/4 FAS | Peach State | $10.00/bf | same |
| White oak 8/4 FAS | Peach State | $12.50/bf | same (not bought: OAK_STOCKED false) |
| 6/4 | none in Atlanta | Wood Vendors $10.50/bf at 100+ bf (not bought) | research-lumber-sheet.md |
| Alternatives | The Wood Yard 4/4 $10, 8/4 $15 | | thewoodyard.com list |
| 6 mm Baltic birch 4 x 8 | Peach State | $49.00 | https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf ("last updated 8/9") |
| 6 mm okoume 4 x 8 | Aircraft Spruce | $158.65 | aircraftspruce.com okume page, part 02-00076; Boulter $98 + freight |
| 12 mm marine 4 x 8 | The Wood Yard | $90 | keep; note "may be sourced elsewhere: ask Peach State or Randall Brothers for 12 mm okoume BS 1088" |
| 1/4" white oak ply | The Wood Yard $113; Peach State B-2 WO VC $75 | | option only |
| U.S. Composites 635 thin epoxy 2:1, 64 + 32 oz (96 oz) | U.S. Composites | $53.45 + 2:1 pumps $8.50 | research-parts-consumables.md item 22 (shipping not read) |
| Fumed silica 1 qt | U.S. Composites | $4.60 | item 23 |
| 2" glass tape | U.S. Composites | $0.70/yd | item 25 |
| Life-Calk 2.8 oz | BoatLIFE | $15.69 [S] | item 24; handle sockets bedded in thickened epoxy instead |
| Rockler 6" lid support pair (#39529) | Rockler | $9.99 [S] | item 7 |
| Frost King EPDM D-profile 17 ft | Home Depot | $8.69 [S] | item 6 |
| Everbilt 2-1/2" stainless hinge pair | Home Depot | $5.47 [S] | item 11 |
| 2" stainless hinge pair | Ace | $12.99 [S] | item 12 |
| HF EVA kneeling pad #56572 | Harbor Freight | $7.99 [F] each, 3 (2 for the seat, 1 for the back) | item 3 |
| Velcro Industrial 2" x 4 ft | Walmart/HD | $7.52 [S] | item 4 (replaces Dual Lock) |
| HF 1/4" cargo D-ring 2-pack #60319 | Harbor Freight | $2.99 per pack [F], 3 packs | item 5; 233 lb WLL; verify the bracket holes |
| Giant Recon 600 front | Bicycle Warehouse | $41.95 [F] | 87 g |
| Planet Bike Spok rear | Bicycle Warehouse | $21.99 [F] | |
| 1/4" shock cord | Knot & Rope Supply | $0.19/ft [F] | + shipping |
| Band-It iron-on banding 3/4 x 25 ft | Ace | $9.99 [S] | |
| Black oil-based paint marker | Sharpie | $4.90 [S] | lid lettering |
| Metal | Speedy Metals | 1045 CF 5/8 x 60" $34.04; 304 1/4 x 2 by the inch, 15" $19.95; 304 1/8 x 2, 13" $9.23; 304 angle 1-1/2 x 1/8, 5" $7.75 | research-metal-fasteners.md |
| 6061-T6 tube 1 x 1-1/2 x 1/8, 36" | Online Metals | $29.24 | |
| Fasteners | Bolt Depot / Bolts and Nuts | see research-metal-fasteners.md "Recommended" | #8 x 2-1/2 18-8 $0.60 |
| **Owned shop stock ($0, "from existing shop stock")** | — | beech Dominos (all sizes, both specs; epoxied in under Extreme), sandpaper, supplies lot (brushes, rollers, cups, gloves), Titebond III, mineral spirits, contact cement, paracord (chock cords, brake stop cords) | Eric 2026-10-14 |
| Removed (Standard) | | stain, pre-stain conditioner (clear finish only); scuppers and box drains (drilled holes) | |
