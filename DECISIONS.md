# Decisions

The decisions that hold today, each with its reason. Code comments, tests and `ref` fields in `src/params.ts` cite these IDs. The sled itself is described in [DESIGN.md](DESIGN.md). Decisions that no longer hold are mapped to what replaced them in [Retired IDs](#retired-ids), because old comments may still cite them.

Units are inches, pounds and degrees. "Verify" marks a value to confirm on real parts or measurements before ordering.

## Conventions

| ID | Decision |
|---|---|
| C-1 | **Frame:** +X forward (toward the bridle), +Y left, +Z up; origin on the ground under the rear-axle center. The viewer uses the same frame, so nothing converts. |
| C-2 | **One source of truth:** `src/params.ts` → `src/model/*` → `Part[]`. Model and analysis code is plain TS with no three.js imports, so it runs headless in tests. |
| C-3 | Enumerated choices are stored as numbers so every param serializes into the shareable URL hash. |
| C-4 | Each param has a `status` (locked, verify, assumed, explore). `validateParams()` rejects impossible combinations and the panel shows them live. |
| C-5 | **One Part is one physical piece.** `massLb` is per piece; identical pieces share a `partNo`, and the cut list and BOM aggregate on it. Every part names its rigid `body` for articulation and the sim. |
| C-6 | **The displayed steer angle is view state,** not a design param: it lives in the viewer toolbar, is clamped to the lock, and is never stored in the URL. |

## Use, loads and factors

| ID | Decision |
|---|---|
| D-1 | **Two rider masses.** The operating rider is **150 lb** (the largest realistic scout) and every check must pass at it. The goal rider is **200 lb**, and structure is sized to it; where 200 lb would force a compromise it is flagged, not designed around. 80 lb is the light rider for rearward pitch. |
| D-2 | **Factors.** Member checks use the static load × a dynamic factor of 3; wood and steel get a safety factor of 2 on top. The structural payload is the goal rider plus 25 lb. The bump model (D-55) sets wheel and axle loads. |
| D-3 | **Seated rider model:** stature 68", CG 9.5" above the seat and 4" ahead of the H-point, legs extended. Anthropometric approximations that size leg reach (35-3/4"), foot room and the mannequin. |
| D-4 | **Materials.** White oak (USDA Wood Handbook, clear wood at 12% MC): 47 lb/ft³, MOR 15,200 psi, MOE 1.78 Mpsi, shear 2,000 psi, compression perpendicular 1,070 psi, with wet-service factors of 0.85 (strength) and 0.90 (stiffness), giving a **design bending stress of 6,460 psi**. Compression perpendicular governs axle grooves and the kingpin. Axles are solid **1045 or cold-drawn rod, 70 ksi** (not A36, not 1018: both fail the check; verify the mill cert). |
| D-5 | **Plywood** values used for the 12 mm deck and seat back: okoume marine (BS 1088) 33 lb/ft³, E 0.9 Mpsi, MOR 5,000 psi; Baltic birch as the fallback (42 lb/ft³, 1.3 Mpsi, 7,000 psi). The thin sheet is chosen separately (D-73). |
| D-13 | **Brake friction assumptions:** shoe-to-tire μ 0.4 (0.25 fouled), linkage efficiency 0.95. They feed the braking rows (D-57, D-65). |
| D-14 | **Pull load:** steady pull is 20 to 50 lbf; the design peak is **150 lbf** (several scouts surging) at a 30" hand height along an 8 ft bridle. |
| D-16 | **Ground:** minimum clearance 3"; tire-to-ground μ 0.5 (damp packed dirt); wet leaves can be about 0.3. |
| D-21 | **Weight is reported, not gated.** Eric is weight-sensitive: no part gets heavier to pass a check unless the lightest option was shown. The `targetMass*` params (60 to 70 lb) describe a possible lightweight preset; the default is the full-featured sled. |
| D-24 | **Parking on a hill is not a design driver.** The brake need not hold the loaded sled on 15° (info only); the wheel chocks must (`park-hold`). On steep slopes chock a wheel or have someone hold it. |
| D-50 | **Load philosophy: bumps, not curbs.** Camp has no curbs. Normal-use cases (bumps, roots, braking, steering, towing, lifting) carry full margins; a hard hit is bend-don't-break and never releases a wheel. Purchased parts are judged on their real material and service record. |
| D-55 | **Bump loads.** Normal use is a **1" step at walking pace (3 mph)** with full margins. The hard-hit case is a **2" step at jogging pace (5 mph)**, fail-safe. The model uses a rigid-body corner mass and a 500 lb/in tire (verify by measuring tire squash). |
| D-58 | **Cargo and resting load.** Post-race **payload 200 lb**, judged with the walking-pace bump. A **resting load** check: a 250 lb adult sitting still or standing on one foot anywhere on the deck, full safety factors, no bump; the standing deck deflection limit is span/240 (the general limit is span/300). The storage lid is not strengthened: it is engraved "DO NOT STEP" and left out of the step-in check. |

## Scope and shape

| ID | Decision |
|---|---|
| D-53 | **A Klondike sled on wheels, not a ridden cart.** The rider is a passenger; the patrol pulls on a bridle; the musher pushes and brakes from behind at walking or jogging pace. Wheels are required, the front pivots, and the sled is a solid, wide, reusable oak hauler afterwards with a 200 lb cargo target. No ride mode, no front brakes, no lap belt. The seat stows for a flat cargo bed. |
| D-54 | **Sled-shaped body:** about 24" wide with straight parallel sides, a sled side profile (low at the bow, tall at the back; D-57) and 10" wheels outboard of the body so the deck stays low. Width and both side heights are sliders. |
| D-57 | **Character and ergonomics.** Side tops sweep in a concave curve from a 4" bow to a **14" rear** with a gentle plan curve into the bow. The **bow bulkhead** is the foot brace and a hand-hold (no foot block). A 1" flag tube sits inside a rear corner. The **seat is full size and its back flips flat** and latches without tools; the box holds only the cushions and the 10 Essentials. The rear handlebow has a second pin position to park it low. Grab handles are one oak board per side with a routed hand hole. The **handlebow** has a ¾" to 1" crown and is bandsawn from one board. The **brake** is a scooter-style step brake: an oak flap hinged over each rear tire with a rubber pad, about 1.8:1 leverage and a bungee return, judged on slowing the loaded sled; a wheel chock on a cord parks it. It needs no welding or custom steel. The sign sits on the tall rear of each side. |
| D-66 | **Matched tracks and a gradual bow taper.** Front and rear track are both **30"** (the wheels line up) with about 1-1/4" between tire and body. The body narrows over a 22" taper (a curvature-continuous smootherstep derived from the real wheel sweep) to **18-1/2"** outside at the bow, so the ±20° swing clears. The cargo load-height rule is about 10". |
| D-67 | **Straight tip limit is 35°** (the same as full lock, A-3). A tilt-table angle: tan θ is the sideways g the loaded sled resists before the uphill wheels lift. 35° is conservative for a low passenger sled at walking pace. Widening the bed was rejected for weight. |
| D-69 | **Bow bulkhead** aligns with the sides: bottom at the bottom of the stepped front rail, corners at the bow side top, crown equal to the handlebow's; the hand-hold sits under the crown with 3/4" of oak above it and at least 2-1/2" of hand room over the deck. |

## Running gear and front end

| ID | Decision |
|---|---|
| D-6 | **The truck sets the width.** With the wheels beside the wells, track + 2 × wheel half-width + 2 × clearance must stay under the 41.5" well gap. The overall width is 34-1/4" at the defaults. Verify the bed numbers (Q-1). |
| D-10 | **Dead (non-rotating) axles** on sealed-bearing wheels, a 5/8" **solid** rod clamped to an oak beam by bridge plates. A solid rod keeps margin (axle stress 0.79 at the 200 lb goal rider) and sourcing simple. |
| D-11 | **Wheels:** 10" pneumatic, Harbor Freight (5/8" bore, 300 lb rating, about 3 lb, 3-1/2" wide). Verify the hub length (assumed 2-1/4") and bore on a real wheel. Flat-free is an option. |
| D-15 | **Vertical stack:** deck at 8"; the axle beams are underslung with the rod in a groove on top, so the wheel and beam clear the deck. Minimum ground clearance 3". |
| D-56 | **Center-pivot front axle (billy-cart steering).** One laminated oak axle beam under the bow carries a 10" wheel on a stub at each end and pivots on one **5/8" grade 8 kingpin** through a UHMW thrust washer into an oak king beam; UHMW roll pads take the roll. Check chains limit the swing to **±20°**. The pullers steer through a short oak **tongue** carrying the bridle. Everything is bolted. No casters, no Ackermann: they add parts for a sled that is pulled at walking pace. |
| D-62 | **Build and detail rules.** Sandwich sides have oak bands glued to both faces of the web; **nothing is screwed into the thin web** (backing strips with inserts carry the signs). One axle clamp bridge plate per station. The **bridle** has no shackle: 3/8" nylon rope through the bronze-sleeved tongue hole on a bowline, the documented weak link (the tie row has a snatch case). The seat back is a frameless 12 mm okoume panel with an oak crest strip. Every flat part is tagged `shaper-origin`. A cargo load-height rule keeps the cargo CG low. |
| D-33 | **Bridle tie load:** 150 lbf on one leg along the taut rope to the pullers' hands at up to 40", with an overload factor of 2 for the weak-link check. |
| D-39 | **Handle sockets:** the handlebow's two oak posts drop into 14" anodized-aluminum rectangular tube sockets bolted to the outside of the rear transom, held by clevis pins (a hold-back check at the grip height). 14" gives about 3-1/2" of post engaged when riding. |
| A-1 | **Turn stability criterion:** the pass/fail is the static stability factor (T/2)/h ≥ 1.5 × μ_ground, so the sled slides before it tips; the turn rollover speed is reported as information. |
| A-2 | **Turning radius** is measured to the outer front tire edge and limited to **12.5 ft** (the small ±20° lock suits a pulled sled). It is the one marginal row (0.97). |
| A-3 | **Full-lock tip** uses the real support polygon (rear contacts and front contacts rotated about the kingpin) and the nearest edge; the turn check uses the outer edge. |
| A-4 | **Front-wheel swing clearance.** At lock δ with a = track/2, tire width w and radius r, the inner tire's rear-inner corner sits at y = (a − w/2)cos δ − r sin δ from the kingpin. The body narrows (D-66) to stay a steering clearance (3/4") outside it. The tire is treated as a rectangle at full radius, which is conservative. |

## Body, structure and joinery

| ID | Decision |
|---|---|
| D-9 | **Removable for transport** without tools: handlebow (or parked low), brake kit, lights, chocks and seat pad; the seat back stays on, flipped flat. **Transport mode** is that set; the tongue, signs and handle sockets stay on. The truck-fit check runs fully assembled and in Transport mode. |
| D-7 | **Loading is a two-person lift** (no ramps, no winch): 115.0 lb in Transport mode, 57.5 lb each. The lift points are the rear transom slot and the bow bulkhead hand-hold; the tongue is never one. |
| D-17 | **The sides are girders** (bands plus web) and 8-1/2" floor joists carry the deck: no frame under the deck beyond the oak rails the axles bolt to. The spacing also meets the resting load (D-58). |
| D-18 | **Seat:** a 1-1/2" closed-cell EVA foam cushion (two kneeling pads, no cover, D-83), 14-1/2" deep and 18" wide, a back 16" tall reclined 15°, with the H-point 4" ahead of the seat's rear edge. |
| D-19 | **Storage:** about **2,000 in³** behind the seat, over the rear axle, for the 10 Essentials (first aid, water, map and compass, lights, food, rain shells, spare layers). A packing check places every item in the real interior. |
| D-20 | **Finish mass** is computed from surface area at about 0.09 lb/ft², not as a percentage. |
| D-35 | **Joinery.** The deck runs 1/4" into a rabbet or dado; edges that cannot be captured get **1/4" oak banding**; no ply edge is exposed (a test fails on any). Joint rule by stock thickness: a Festool Domino (DF 500 sizes only, the tenon at most about a third of the stock, D-81) where the host keeps a wall of 0.15" or more behind the mortise; a CNC blind tenon (1/3 of the stock, 3/8" long) where it does not; glue and epoxy fillets elsewhere; threaded inserts and knobs for anything removable. Joints are stored on both mated parts. |
| D-37 | **Lift hand-holds:** a 4-1/2" × 1-1/4" stadium slot through the rear transom (and the bow hand-hold), bottom at least 3" above the deck, with at least 3/4" of oak above it. Rated for one hand carrying the whole per-person lift × 3. |
| D-40 | **Seat detail.** The back flips flat about its hinge onto the deck, held by quick-release pins, and stays on the sled. Grab boards: 1-1/2" finger gap, 4-1/2" clear hand hole, no pinch point. Loads: rider × 3 × a torso share of 0.5 aft over the back height. Verify the insert pull-out (3/8" stainless insert in white oak). |
| D-41 | **Storage and fittings.** Box: thin-ply walls on the deck with an oak lid frame and battens, an EPDM gasket, stainless butt hinges on the fore edge, draw latches aft, a lid support (D-83) and two drains (drilled and epoxy-lined under the Standard spec, D-83). **Lashing** is six bolt-on cargo D-rings, 233 lb working load each (D-76, D-83). **Lights** are printed ASA clips (D-64); side reflectors are stick-on DOT-C2. |
| D-44 | **Cosmetic finishing:** the viewer dresses parts through an optional `Part.finish` (edge roundover, upholstery, tread, surface look). Analysis, mass and overlap tests ignore it. Real shape changes go in `geometry`. Rope parts are not drawn in the viewer but stay in the model for mass, BOM and analysis. |
| D-60 | **Light parts, not thin structure.** 1/2" rear transom, 1-1/2" bow bulkhead, 5/8" joists and sides, 7/8 × 3" brake flaps, smaller handle posts and rear clamp plates, no foot block, 3 lb wheels. The deck ply, rails and axle diameter are not thinned and white oak stays (no ash) for durability. Empty mass is 121 lb, reported not gated (D-21). |
| D-61 | **Sandwich sides and shop tools.** Thin oak bands are laminated to each face of the web at the gunwale and chine, with no grooves. The shop CNC is a **Shaper Origin** (handheld, any size with ShaperTape): flat parts (deck, side webs, grab boards, bulkhead and hand-hold, box panels, sign blanks, brake flaps) go to it as SVG. |
| D-63 | **Seat-back latch pins** sit 2" up the panel (spring-detent pins, both holes blind); the deck clears the side bands by 1/16"; (its grab-board strip clause is replaced by D-84). |
| D-64 | **Lamps on snap-in clips.** The front lamp and the red rear light ride on printed ASA clips that fill the lift hand-holds and pop out before lifting. Print a 1" test slice in an eased 1/2" slot first. |
| D-65 | **Step brake details.** The flap ends at the rear transom face with a 4" foot tread and a tapered fender shape with a 1-1/4" tongue; it pivots on an oak pivot block through the knee strap (D-77) on a 3/8" clevis pin in double shear with a hitch-pin clip; the flap kit comes off in about 15 s a side with no tools. `brake-slow` is the pass/fail; `brake-force` is info. Viewer toggles (brakes, lights, chocks, seat flat, handle parked) live in Advanced; Transport mode is in Simple and Advanced. |
| D-68 | **Plywood is full 4' × 8' sheets** from a local supplier; each side web is one piece. There is no 2' × 4' or scarf-joint option. |
| D-70 | **No 12/4 lumber.** Any solid part whose thickness no stocked board yields is face-laminated from stocked boards at the lowest cost per ft² of face, and the 1/8" planing allowance is taken once on the glued block. Epoxy-laminated oak counts as solid for strength. |
| D-72 | **Few fastener sizes.** Three wood screws only (316 or 304), all #8 (D-82): #8 × 5/8 (hardware into thin stock), #8 × 1-1/4 (everything else), #8 × 2-1/2 (rail to chine and the rib knees, in a pilot hole). A joint takes the shortest standard length of its gauge that bites 1/2" and stops 1/16" short of the far face. Bolts come in stock lengths, cut after fitting where the stack is short; a test checks every screw. |
| D-74 | **Laminated parts are 2-1/8":** 3 layers of 3/4" from 4/4, glued and milled to 2-1/8", for the beams' depth, the brake knee and the chock. The rear beam's fore-aft width stays 2-1/4" so the rod groove keeps its 3/4" ligament. |
| D-75 | **Brake knee is cross-laminated** and bolted through the rail and its backer: one stainless backing plate (1/8" × 2" × 2-1/2") under the four nuts, 7/8" narrow washers under the heads (fender washers on these centers would overlap). The knee-bolt holes are 13/32". The bridle tongue's head is square from its outer corners inward so the carriage-bolt heads seat flat. |
| D-76 | **Side ribs carry the tie-downs.** Three oak ribs per side (box, mid and bow-post stations) stand on the inside face of the web, bandsawn from 4/4 offcuts planed to 3/4", each widening to a 2" head cut to the sheer. The six D-rings are through-bolted to the heads on two 1/4-20 button-head bolts each (D-83). The mid rib has a knee with two #8 × 2-1/2 screws into a crossmember (D-82; the rib stands about 3/8" ahead of it at the defaults so both screws land on the member's centerline in the bow taper), the bow post has the same knee on the king beam, and the box rib has a 3/4" × 3/4" × 3" oak tie to the box side. A 50 lbf push moves a gunwale about 0.10" (under Eric's 1/8" "feels solid" mark). Verify the bow-post station by sitting a booted rider in the sled (alternative station: the chain crossmember at x = 35). Study: [docs/studies/side-stiffness-study.md](docs/studies/side-stiffness-study.md). |
| D-77 | **Brake knee has no outboard ear: a pocket and a stainless pivot strap.** The flap slot is a pocket open at the rear and outboard faces; a 1/8" × 2" stainless strap spans it, screwed on a roof and a floor, so the pin is still in double shear. The knee layup is **upright / across / upright**. **No-fabrication rule:** every metal part is bought ready-made or is stock cut on a metal bandsaw and drilled; `src/model/no-fab.ts` checks it and `d77.test.ts` holds it at zero for both weather specs. |
| D-78 | **Brake knees can be removable, as an optional setting (`kneeMount`).** Eric's choice: the same four bolts, backer and backing plate (bedded in its recess), the knee fitted dry and bolted to snug plus a quarter turn (about 35 in-lb; the quarter turn is the spec), taken off with a ratchet and wrench (about 5 minutes a side) so nothing stands out beside the tires in transport or cargo use; the chock stays tied and travels with its knee. The default keeps the knees bolted and glued. The `brake-mount` row adds a wood-to-wood bolt check for the dry knee (0.87 at C_D 1.6 for the stomp, 0.69 for a sustained hold at C_D 1.0). Pins and clamped inserts were rejected because the 3" lever loads the thin rail and rib. See [docs/studies/removable-knee.md](docs/studies/removable-knee.md). |
| D-81 | **Domino rules.** A Domino tenon is at most about a third of the stock it sits in (the cap is 0.34; the rail ends into the bow bulkhead take a 6×40), and only the DF 500 sizes are used (the shop has no DF 700 XL). The side-to-rail tie has **no Dominos**: the side's bottom edge (outer band plus web edge, about 7/16") is too narrow for one. It is a thickened-epoxy bed plus the #8 × 2-1/2 screws up through the rail in every gap, which locate the side as the inverted frame is lowered; the analysis never credited the Dominos. |
| D-82 | **One screw gauge.** No stainless #6 × 2-1/2 wood screw is sold, so the rail-to-chine and rib-knee screws are **#8 × 2-1/2** in a pilot hole (about 1/8" of oak each side in the 7/16" edge); every wood screw is a #8 (amends D-72). |

## Sheet goods and weather

| ID | Decision |
|---|---|
| D-71 | **Cheap wheels, 5/8" axles:** the Harbor Freight 10" wheel at about $10 each (D-11) on 5/8" solid rod axles (D-10), because four wheels cost $40 against $118 for the 3/4"-bore alternative and the bearings ride on the axle. |
| D-73 | **Weather spec.** `weatherSpec` is **Standard** (default: garage-kept, used a few times a year, wet at most at a rainy derby) or **Extreme** (stored outside or near salt). Standard uses 304 stainless (zinc where it lives dry), Titebond III, beech Dominos and a clear exterior spar urethane, with epoxy only where it is needed; Extreme uses 316, epoxy throughout (beech Dominos epoxied in) and marine varnish. The thin sheet follows the spec (D-80); `thinSheet(p)` is the one source and everything on the thin sheet follows it. |
| D-80 | **Thin sheet: 6 mm.** `thinSheetMaterial` follows the weather spec: **6 mm Baltic birch** (Standard: all-birch 5-ply, 4 x 8 from Peach State; side-web 0.33) or **6 mm okoume BS 1088** (Extreme: 5-ply; side-web 0.44). 1/4" white oak plywood (0.61) stays an option; 3 mm Baltic birch (4.8) and 4 mm okoume (2.0) fail the across-grain side-web check. Verify at the yard: count 5 plies at an edge (the side-web margin assumes 5-ply; a 3-ply 6 mm sheet behaves like the failing 4 mm one), measure it (6.0 to 6.5 mm) before cutting a dado, and ask the glue. |

## Cost and sourcing

| ID | Decision |
|---|---|
| D-79 | **Buy local and cheap, count what is owned.** Oak and the thin sheet come from Peach State Lumber (Kennesaw; Eric's usual yard): white oak 4/4 and 5/4 only (6/4 and 8/4 are not bought; thicker parts are face-laminated from 4/4, D-70). The 12 mm deck sheet is priced at The Wood Yard and may come from elsewhere. What Eric already owns (beech Dominos, sandpaper, brushes and supplies, Titebond III, mineral spirits, contact cement, paracord) is listed at $0 as shop stock so it is not forgotten. Prices: [docs/price-research/price-research-cost-pass-2026-10.md](docs/price-research/price-research-cost-pass-2026-10.md). |
| D-83 | **Standard-spec simplifications** (garage-kept use does not need the marine version): drilled drain holes with an epoxy-lined bore instead of stainless nipples; a plated-steel lid support inside the box instead of a stainless stay; seat pads from 1-1/2" EVA kneeling pads (closed-cell, no vinyl cover) held with hook-and-loop; bolt-on cargo D-rings rated 233 lb (the cargo straps pull about 80 lbf a ring) on two 1/4-20 bolts; a clear finish (no stain or conditioner); one U.S. Composites epoxy order (635 epoxy, fumed silica, glass tape); 1/4 x 2 stock clamp plates (+0.24 lb over 1-3/4, but the wider bearing raises the green rider range from 220 to 240 lb and the cargo capacity from 254 to 286 lb; 1-3/4 would be a rip of stainless or about $18 more); cheaper bike lights (600 lm front). The Extreme spec keeps the nipples, the stainless stay and its marine finish. |
| D-84 | **Grab boards.** The hole center is **5-1/2" ahead of the seat's H-point** (a seated rider's elbow hangs about 5" behind it; with the forearm about level the palm lands about 6" ahead) and 3/4" above the gunwale top, so a gloved hand finds it without folding the arm back (a flat board cannot go farther forward: the sides turn in at x = 20", so the model holds it back where the stand-off would pass 1/16"). The ends are **vertical** (like the ribs and the transom) and the top corners have a 1" radius. **Five staggered screws** (three upper, two lower between them, so the washers do not collide) go through the board, bands and web to a **1/8" × 1-1/4" stainless strip (the thinnest bar sold) hidden under an oak cap** with 9/16" holes for the button heads; the strip is epoxied into the cap's pocket and the pair is bedded on the band and held by the screws. Fender washers alone cannot carry the pull in the 1-1/2" band (3/4" washers carry about 40% of it); reversed bolts, a bare oak strip, inserts or a saddle board were rejected. The analysis row treats the board as a lever turning about its lower edge: 200 lb passes at 0.84, riders are safe to 230 lb and green to 210 lb (it takes the larger of a rigid-lever and an elastic estimate for each screw). No ribs under the boards (the side passes without them). |

## Product and analysis

| ID | Decision |
|---|---|
| D-23 | **The truck bed stays fully parametric.** Every bed dimension is a live param, the Truck fit view shows the margin, and the defaults are estimates until measured (Q-1). |
| D-30 | **A Simple view is the default; Advanced and Build are one click away.** Simple answers "is it safe, and for what rider weights?": a rider-weight sweep (50 to 250 lb) with a safe-range bar, six plain-English traffic lights, a spec card and "watch it" sim demos. |

## Open questions

| ID | Question |
|---|---|
| Q-4 | **Course details:** the steepest hill, the surface and roots, and any preferred wheel source. The design assumes a 15° maximum slope. |
| Q-7 | **Team logistics:** how many pullers (the design pull is 150 lbf), and who lifts the sled into the truck (two adults assumed, 57 lb each). |
| Q-1 | **Truck bed measurements.** Measure the bed length, the tailgate length, the well gap, the well height and the fore-aft position of the wheel wells. They are estimates now; the fit has 3-5/8" of clearance in Transport mode against the 1/2" required. |

## Retired IDs

These no longer describe the design. Old comments and `ref` fields may still cite them.

| ID | Replaced by |
|---|---|
| D-8 | D-9 (Transport mode: the handle is parked or off, the tongue stays on) |
| D-12 | D-56 (the lazy-susan turntable became the center-pivot front axle); where it cites the short-grain bearing behind a rod groove, read D-4 and D-10 |
| D-22, D-45 | D-61 (sandwich sides), D-66 (bow taper) |
| D-25, D-26, D-27, D-28 | D-56 (front end), D-10 and D-71 (axle steel) |
| D-29 | D-23 |
| D-31, D-32, D-34, D-43, D-46, D-47, D-48 | D-56 (kingpin, stops and mounts of the old turntable front end), D-62 (clamp plates, bridle), D-35 (banding), D-77 (brake mount) |
| D-36 | none (the bent-lamination prow was dropped) |
| D-38 and the foot-plate brake clause of D-55 | D-57 and D-65 (step brake) |
| D-42, D-59 | folded into D-57, D-58, D-60 |
| D-63 (grab-board strip clause) | D-84 (the strip is 1/8" × 1-1/4" under an oak cap) |
| D-49, D-51, D-52 | D-53 (no ride mode), D-66 (bow taper) |
| W-1, Q-2, Q-3, Q-5, Q-6 | answered by D-21, D-61, A-1, DESIGN.md (the sign wording) and `src/params.ts` |
