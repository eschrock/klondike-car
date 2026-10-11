# Phase 3 round 3, front / fittings (critic r2: eng N-5, N-6, N-9, S-5; build S3, S4, S5, S8, S10, S12)

Proposed decision ID: **D-47** (D-46 is the front-end block). `DECISIONS.md` not edited. Code cites D-47.

## Per item
| # | Item | What changed | Values |
|---|---|---|---|
| 1 | Eng N-5 turntable support, pitch path | Carrier plate widened 2.5" to 4.0" (`kingpinPlateWidthIn`, max 4.5); the plate under the beam keeps 2.5" (`kingpinUnderPlateWidthIn`). New params `turntableRaceDiaIn` 9" and `turntablePlateThickIn` 3/16" (both `verify`). `pitch-path` rewritten: the "couple between the bolster rails through the plate margins" row and text are gone; the path is bolster rails, top plate, ball ring, lower plate, carrier, beam, U-bolts. New rows: lower-plate overhang bending (0.66 at 200 lb; 4" carrier vs 2.5" lowers it), carrier bearing on the beam (0.07). Clamp/edge-contact rows now use only the part of the carrier that lies on the beam (3.375", the carrier overhangs the front face by 0.625"). | carrier +1.9 lb |
| 1b | New INFO row `turntable-ring` | e = M_p/V = 2.10" vs kern R/2 = 2.25" (93%); P_eq = V + 4M/D_p = 1026 lbf = 137% of rating/margin 2 (750). Reported, NOT judged: the ring diameter is assumed and the maker's tilting-moment rating is unknown. If judged at the project margin, pitch-path would FAIL at 150 lb too. Needs a decision / vendor data. | info |
| 2 | Eng N-6 bridle tie | Eye bolt 3/8" to 1/2", washer 1" to 2" OD, new `bridleTieOverloadFactor` 2 (rows evaluated at 150 x 2 = 300 lbf). Eye shank 0.52, washer 0.28, hole 0.03 at 300 lbf; also holds a 250 lbf design pull x 2. BOM says the eye bolt is the intended weak link. Legacy `kingpin-split` web shear-out row removed (the bolt-line row tear-out in `kingpin-bolts`, bridle-pull case, checks that load). | +0.1 lb |
| 3 | Eng N-9 / S-5 finger guard | `fingerAnalysis` now scans the whole outline (S-curve and nose side). Zone is x 28.3-30.9 (min gap 0.75" at x about 29.7), straddling xn = 30.375; guard x 27.8-31.4. Guard is ONE printed ASA mesh per side (profile swept along the real outer face, ~3.6" long, any bed), inserts on the cabin gunwale (curve) and nose gunwale (straight), `joinery.ts` updated. Infeasible reason added when the zone reaches the sheer rise. | +0.01 lb each |
| 4 | Build S5 kingpin bolt | 3/4-10 x 6" grade 8 hex bolt (ASME B18.2.1: thread 1.75", shank 4.25" vs 4.13" needed: head underside to 1/4" past the top of the crossbar plate). Nut and washers in a counterbore (floor 1/4" above the crossbar plate), 1 washer under the head, 1 under the nut, tail cut to 5-1/8". | pin -0.05 lb |
| 5 | Build S8 sleeve fit | New `kingpinSleeveClearIn` 0.006: bore reamed/honed to 0.756 +0.002/-0.000 (pin body 0.7439-0.7500), 0.006-0.014" diametral clearance. | - |
| 6 | Build S10 order | `STEP`: frame 3, body 4 (hull 4.0-4.4), steering 4.5, gear 4.6, new `kingpin` 4.9 (turn upright, pin in from below, nut through the access opening), then seat/storage 5. `HULL_STEP` doc has step 6. | - |
| 7 | Build S12 stop blocks | Stock rounded up to 1/32" (e.g. 3.238 to 3.25"), blank = stock + 1/8" (`stopBlockRoughAllowIn`, was +1/2"), face cut 1/16" proud; fit procedure folded into the shim-pack joint note (screw on with 1/32" pack, lock, plane to the 0.003" feeler, finish with shims). | - |
| 8 | Build S3 storage box | `storageSideClearIn` 1/8" each side; layout.ts box width and height formulas use it. Box 0.25" narrower, taller to hold 2,000 in3; `storage-pack` still passes (0.83). | +0.1 lb |
| 9 | Build S8 lash plate | New `lashDoublerThickIn` 1". The plate (1.5 x 0.9) is centered on the doubler (glued to the gunwale inner face), wholly over it; 4 #10 screws at +-0.5625 x +-0.25 straight down, 0.25" from each doubler face, tips 0.375" above the doubler bottom. Drawn as joints with `at` on both parts. `lash-load` unchanged (0.71). | +0.1 lb |
| 10 | Build S4 nose gunwale | Already laminated flat (3 x 1/2" layers, fab bentlam). Notes now state the method: groove plowed in the bottom layer while straight (router table, 1/4" bit, two passes, fence moved 0.026"; 0.375" deep in a 1/2" layer), then laminate on the sheer form; tightest radius computed (R/t shown). No curved-edge routing. | - |
| 11 | Build S12 banding | `edgeBandIn` 3/16 to 1/4" (strip 1/4 x 5/16, epoxy, flush-trim) on straight edges; curved corners use 1/16" oak edge veneer. New `accessOpeningCornerRadiusIn` 1": deck opening and panel are rounded (router template, 1/2" bit); panel is now an extrusion; insert positions pulled in. | +0.1 lb |

## Mass and checks
Steering group 23.13 to 25.35 lb (+2.2: carrier +1.9, eye bolts +0.3), body +0.2, storage +0.1; about +2.5 lb of mine (mixed in the tree with the brake agent's +3 lb, so the empty mass reads 166.9 vs the 165.66 ceiling in `model.test.ts`). No check of mine changes status at 150/200 lb; new info row `turntable-ring`. `kingpin-bolts` 0.88 (unchanged), `steer-stops` 0.96 marginal at 200 lb.

Safe range (brake rows excluded, because the brake agent's `brake-shaft` is failing mid-edit): no failure to 210 lb, first failure 220 lb (`steer-stops` 1.00); green to 170 lb. Before: 220 / 180. The 10 lb loss is added mass (steer-stops pad strain scales with weight), not an assumption change. Re-measure after the brake agent finishes.

## Files touched
src/params.ts, src/model/{steering,kingpin-plates,storage,body,joinery,layout,build-utils}.ts, src/analysis/{front,structure,index,rider-sweep,types}.ts; tests: src/analysis/front.test.ts, src/model/{front,hull,model}.test.ts, new src/model/r3-fittings.test.ts.

## Proposed DECISIONS text
| D-47 | **Front and fittings, round 3.** Carrier plate 4" wide (lazy-susan lower support), pitch path rewritten (ball ring, lower plate, carrier, beam), ring diameter and plate thickness assumed (verify); `turntable-ring` info row until the maker's moment rating is known. Rope tie sized for 2 x the design pull on a 1/2" eye bolt (intended weak link) and a 2" washer. Finger guard covers the real hazard zone across the S-curve as one printed piece. Kingpin: 3/4-10 x 6 grade 8 bolt cut to 5-1/8", sleeve reamed to 0.756. Build order: hull, then front stack and axles on the inverted hull, kingpin after turning upright. Stop blocks 1/32" stock, 1/16" proud, fit to the feeler. Storage box 1/8" off the chine. Lash plates on a 1" doubler. 1/4" edge bands, 1" opening radius. | assumed |

## Phase 4 verify
Ring diameter, lower-plate thickness, tilting-moment rating; pin body diameter and reamed fit; stop block fit procedure; veneer bend at R = 1".
