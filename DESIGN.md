# Troop 455 Klondike sled: current design

This is the design as it stands today, for someone arriving fresh. Numbers come from the code at its default parameters (`buildModel`, `runChecks`, `riderSweep`, `bom`). If a number here disagrees with the app, the app is right: fix this file.

Related: [DECISIONS.md](DECISIONS.md) (the decisions that hold, with IDs cited in code), [docs/STATUS.md](docs/STATUS.md) (status and open items), [CLAUDE.md](CLAUDE.md) (working rules).

## 1. What it is

A **Klondike Derby sled on wheels** for Boy Scout Troop 455: a solid, wide, reusable white-oak sled with four wheels.

- **Use.** The patrol pulls it from town to town on a rope bridle. A passenger rides in the seat. A musher at the back pushes on the handlebow and steps on a brake flap to slow it. Walking or jogging pace, camp roads and trails, no curbs. After the race it is a hauler for camp gear (firewood, coolers, duffels) with the seat stowed.
- **Storage.** Garage-kept, used a few times a year. It gets wet only if it rains during a derby. That sets the default weather spec (section 4).
- **Who builds it.** Eric, an experienced woodworker, mostly alone and sometimes with helpers.

## 2. Requirements

### Event rules (Bert Adams Scout Camp Klondike Derby, 2026 AAC; the camp's handout)
- Each troop or patrol builds a Klondike sled to use in the competition.
- The sled must carry **at least one Scout** throughout, as the team goes from town to town. Someone must be riding as the team approaches each program area.
- **Wheels are allowed** while traveling between towns.
- The team announces itself with a **Patrol Yell** on arriving at each town and finishes with it on leaving.
- Each team carries the **10 Essentials of Scouting**. Other equipment is provided at the towns.
- Graded in each town on accuracy, neatness, Scout Law and completion.
- It is a **timed race** that starts outside Staff HQ at about 7 pm (dark): collect all seven tokens, then meet the staff. First to third place are announced at closing campfire. The camp lends a cart to provisional scouts who want to team up.

### Design requirements
- **Riders.** A **150 lb** rider (the largest realistic scout) must pass every check. A **200 lb** rider is the goal (an adult or stretch case); show where it limits the design. Lightest rider considered: 80 lb (rearward pitch). Cargo mode: a **200 lb** payload on the bed with the seat stowed.
- **Pace and loads.** Walking pace (3 mph) with a 1" bump is the normal case and carries full margins. A 2" bump at 5 mph is the bend-don't-break case. There are no curbs at camp. Pull peaks at 150 lbf (several scouts surging).
- **Weight.** Eric is weight-sensitive. Nothing gets heavier to pass a check unless the lightest option was shown first. Empty mass is reported, not gated.
- **Typical riders** are 80 to 150 lb. Helmets are recommended. Getting in and out must be quick (seven stations). The structural payload is the goal rider plus 25 lb of gear.
- **Cost.** Eric is cost-sensitive too. Show the cheapest credible option first; separate quoted prices from estimates.
- **The shop.** Full woodshop, bandsaw that resaws 6" at most, Festool Domino DF 500 (4 to 10 mm tenons; no DF 700 XL), Shaper Origin (handheld CNC; flat parts are cut from SVG files), a CNC router, an XTool S1 laser with the conveyor (1/4" wood sheet, pieces up to 18-1/2" × 118"; D-86) and 3D printers (ASA for light clips). **No welding, no lathe.**
- **No-fabrication rule for metal.** Every metal part is bought ready-made, or stock cut on a metal bandsaw and drilled on a drill press. No bending, welding, tapping, machining or countersinking. A test enforces it (D-77).
- **Materials.** White oak for solid parts; plywood only as captured or sandwiched panels, with no exposed plywood edges; stainless or galvanized fasteners; threaded inserts for anything removable.
- **Truck fit.** It rides in a 2007 Toyota Tacoma short bed with the tailgate down, loaded by two people (no ramps). The bed numbers are estimates until measured; every one is a parameter. Parts that are removable for transport come off without tools.
- **Safety and use.** Low seat with a back, grab boards, no pinch points, lights and reflectors for the night start, a tie-down on each side rib, and a storage box sized for the 10 Essentials.

## 3. The sled today

### Overall
| | Default |
|---|---|
| Body length, rear transom to bow | 60-3/4" (65-3/4" with the tongue) |
| Body width | 24" outside, narrowing to 18-1/2" at the bow over a gradual 22" taper |
| Overall width over the wheels | 34-1/4" |
| Wheels | 10" pneumatic, 4 of them, wheelbase 44", both tracks 30" |
| Deck height | 8" |
| Side height | 4" at the bow rising in a concave sweep to 14" at the rear |
| Empty mass (Standard spec) | **122.7 lb** (113.6 lb in Transport mode with the removable knees off, 56.8 lb per person for the two-person lift; 116.8 lb and 58.4 lb with knees that stay on) |

### Construction
- **Body.** The two sides are sandwiches: a thin plywood web with oak bands glued on both faces at the top (gunwale) and bottom (chine). No grooves. The bow bulkhead is a shaped oak board that is the foot brace and a hand-hold. A 12 mm okoume deck rides on oak rails and 8-1/2" joists. The rear transom is 1/2" oak. Four oak **ribs** per side stand on the inside face of the web (rear, box, mid and bow-post stations). Their heads carry the eight D-ring tie-downs (zinc-plated steel Standard, 316 stainless Extreme), through-bolted on two bolts each (D-83), and they stiffen the sides sideways (D-76).
- **Front end.** One laminated oak axle beam under the bow carries two stub axles. It pivots about a single 5/8" grade 8 kingpin through a UHMW thrust washer into an oak king beam. UHMW roll pads take the roll. A check chain on each side is the steering stop and limits the swing to **±20°**; a short 1/8" shock cord through a screw eye under the deck holds each chain's slack 3-1/2" or more off the ground (D-56). The pullers steer through an oak **tongue** whose rope bridle ties to it on a bowline (the rope is the intended weak link). Turning radius is about 12 ft to the outer tire edge, limit 12.5 ft (the one marginal row).
- **Rear end.** A fixed laminated oak beam on solid 5/8" 1045 steel rod axles, held by 316 or 304 clamp plates and hold-down angles into notches in the rails.
- **Seat.** A 1-1/2" EVA foam cushion and back pad (kneeling pads, closed-cell, no cover, on hook-and-loop strips; D-83), and a frameless 12 mm okoume seat back that **flips flat and latches** with pins, so it stays on the sled (D-57). The leg reach is about 35-3/4". Two oak **grab boards** (one board per side with a routed hand hole) are bolted to the gunwales (D-84): the hole sits 5-1/2" ahead of where the rider's hip rests, 6-5/8" above the seat, so a gloved hand finds it with the forearm about level; the ends are plumb and the top corners round (1" radius); five staggered stainless screws pull through a 1/8" × 1-1/4" stainless strip, and a 1/2" oak cap glued over the strip and the heads hides them. The boards are permanent and finished in place.
- **Storage box.** Behind the seat, over the rear axle: a thin-ply box with an oak-framed lid hinged on a fixed oak strip across the front of the box top, so the lid opens past upright and rests on the upright seat back (D-89), two oak turn-buttons on the transom to hold it shut, a gasket and two drains (drilled, epoxy-lined holes under the Standard spec; D-83). About 2,000 in³. In cargo mode it holds the cushions, lamp and chocks; in race mode, the 10 Essentials (a packing check places every item).
- **Brake.** A scooter-style **step brake**: an oak flap hinged over each rear tire with a rubber pad, a bungee return and a cord down-tie that sets the released height and goes slack when the tread is pressed (D-90). Each flap pivots on a stainless strap and clevis pin on an oak **knee** (cross-laminated oak, D-75, D-77) bolted to the rail. A wheel chock on a cord parks it. The flap kit comes off in seconds. The knees are **removable** by default (D-78, section 4): each comes off with a ratchet and wrench; knees that stay on (glued) are the option. It is judged on slowing the loaded sled (pass/fail); the brake itself need not hold the sled on a 15° slope (info only), but the wheel chocks must (the `park-hold` row, which passes at 0.88).
- **Handlebow.** A removable bandsawn oak handlebow on two posts that drop into sockets on the rear transom, with a second pin position that parks it low (D-57).
- **Lights and signs.** A front lamp and a rear red light in snap-in printed ASA clips that fill the lift hand-holds; amber front and red rear reflectors; a flag tube in a rear corner; a "TROOP 455 / WILDERNESS RANGERS" oval sign on each rear side, screwed to the rear and box ribs (D-85).

### Lift and transport
Two people lift it by the rear transom slot and the bow bulkhead hand-hold (the tongue is not a lift point). **Transport mode** (handle parked, seat back flat with its latch pins in, brake kit, lights, chocks and seat pad off, plus the knees and their straps with removable knees, the default) fits the Tacoma bed with the tailgate down, and so does the fully assembled sled.

## 4. Materials and options

### Weather spec (`weatherSpec`)
| | Standard (default) | Extreme weather |
|---|---|---|
| Meant for | garage-kept, used a few times a year, wet at worst at a rainy derby | stored outside or near salt |
| Stainless | 304 (18-8) | 316 throughout |
| Collars, inserts, D-rings, eye bolts and chain | zinc-plated or hot-dip galvanized | 316 |
| Glue | Titebond III where a glue-up is wood-to-wood throughout; epoxy where any joint in it needs epoxy (D-92) | epoxy everywhere |
| Dominos | beech (shop stock) | beech, epoxied in |
| Finish | exterior spar urethane; epoxy only where needed | marine varnish over epoxy, gallon epoxy kit |
| Thin sheet (follows the spec, D-80) | 6 mm Baltic birch | 6 mm okoume |
| Drains | drilled holes | stainless nipples |
| Empty mass | 122.7 lb | 121.0 lb |
| BOM total (no shipping or tax) | **$1,511** | **$2,401** |

### Brake knees (`kneeMount`, D-78)
Default **Removable knees (bolts, ratchet)** (a checkbox in the viewer toolbar beside Transport mode, and the Brake knees dropdown in Advanced): the knee is fitted dry and held by four 3/8" bolts. The option **Knees stay on (bolted, glued)** keeps the same four bolts, washers, nylock nuts and backer, and epoxies the knee to the rail and chine band:

| | Knees stay on (option) | Removable knees (default) |
|---|---|---|
| Knee to rail | epoxy plus four bolts | fitted dry, the four bolts clamp it; no finish bridges the joint |
| Build order | knees glued and bolted with the hull inverted, finished in place | knees drilled through the rail's holes and fitted dry with the hull inverted for the wheel dry fit, taken off, finished on the bench with the flap kits (the rail patch is finished with the underside), bolted on at the hang step |
| Backing plate | drilled only | bedded in thickened epoxy in its recess at the frame step, so it stays when the bolts come out |
| Comes off with the flap kit (Brakes off, Transport mode) | flaps, pivot blocks and pins, shoes, pads, treads, cords | the same, plus both knees and straps; the chock stays its own toggle, stays tied to the eye under its knee and travels with it |
| Stays on the rail | knees, backers, backing plates | backers, backing plates and four open bolt holes a side |
| Tools | none | a 3/8" drive ratchet, 9/16" socket and 9/16" wrench in a 9" × 3" × 2" pouch (a tool, not sled mass; in the box in cargo mode only), eight spare lock nuts, anti-seize |
| Tightening | snug | snug, then a quarter turn (about 35 in-lb; the quarter turn is the spec, more crushes the 7/8" washers and the oak); check snug before each outing, retighten after the first |
| Time | flap off in about 15 s a side | knee and flap off in about 5 minutes a side (longer the first time), lying beside the sled and reaching in under the deck between the two crossmembers just ahead of the rear wheel |
| Empty mass | 122.7 lb | 122.7 lb (identical); Transport mode drops 4.0 lb more in the viewer (2 knees and 2 straps 3.2 lb, their 8 bolt sets about 0.8 lb); the mass and lift rows count only the 3.2 lb |
| Storage packing | 0.87 / 0.88 (Standard / Extreme) | the same in race mode; the pouch lies in the cargo-mode layer (floor-area fill 0.11 to 0.17) |
| BOM | $1,381 / $2,267 | $1,415 / $2,305: +$33.97 Standard (the ratchet-and-wrench pouch and anti-seize, estimates; you may already own them) |

The analysis is the same in both settings except `brake-mount` (and `brake-abuse`, which reuses it): the glued knee never counted glue or friction, but its uniform dowel bearing treated knee, rail and backer as one unit. For a dry knee the row adds the NDS single-shear yield-mode check of the worst bolt between the 1-3/4" leg and the 1-3/8" of rail and backer left by the plate recess, across the grain: Z' about 296 lbf (mode II, with C_M 0.70 wet, C_D 1.6 for the stomp as an impact, C_g 0.85) against a worst bolt of about 256 lbf, **0.87**, which governs the row and passes. Because that pass leans on C_D 1.6, a second detail holds the knee to a sustained hold at C_D 1.0: **0.69**. The NDS spacing and edge minimums are not met, so the yield-mode value is an estimate (tear-out and splitting are checked separately). Why not pins or clamped inserts: [docs/studies/removable-knee.md](docs/studies/removable-knee.md).

### Thin sheet (`thinSheetMaterial`)
The thin sheet is the side webs, storage box and lid, and sign blanks. The 12 mm deck and seat back are always okoume. The default **follows the weather spec**.

| Option | Used by default in | Thickness | Notes |
|---|---|---|---|
| 6 mm (1/4") Baltic birch | Standard | 0.236" (verify: count 5 plies, measure the sheet) | side-web check 0.33; Peach State $49 |
| 6 mm okoume BS 1088 | Extreme | 0.236" | side-web check 0.44; Aircraft Spruce $158.65 |
| 1/4" white oak plywood | none | 0.21" | side-web check 0.61 |
| 3 mm (1/8") Baltic birch | none | 0.118" | side-web check **4.8 (fails)** |

Sheets are always full 4' × 8' (D-68). Solid parts up to 1-3/4" thick come from one 8/4 board (D-95). Thicker parts are face-laminated: the axle beams, brake knees and chocks are 3 × 3/4" layers from 4/4, milled to 2-1/8" (D-70, D-74).

### Other materials
- **White oak** (USDA Wood Handbook, 12% MC): design bending stress 6,460 psi after the wet-service factor and a safety factor of 2.
- **Axles** 5/8" solid 1045 or cold-drawn steel rod (70 ksi yield; not A36, not 1018).
- **Wheels** Harbor Freight 10" pneumatic (5/8" bore, rated 300 lb, about 3 lb each; verify the hub length).
- **Fasteners** three wood-screw sizes, all #8 (5/8, 1-1/4, 2-1/2), and stock bolt lengths (D-72, D-82).

## 5. Key numbers (Standard spec, default parameters)

- **Mass** 122.7 lb empty: white oak 57.4 lb, plywood 27.3 lb, wheels 12 lb, axles 5 lb, hardware, fasteners and everything else about 21 lb.
- **Checks.** 54 engineering rows, **none fail**. One is marginal: turning radius (0.97 of its limit). The tightest passes: seat stowage 0.95, park-hold 0.88, storage packing 0.87, kingpin 0.86.
- **Rider range.** Safe (nothing fails) **50 to 230 lb**; green (nothing marginal) **50 to 210 lb** (the grab-board row sets both ends, D-84; the brake-mount row also sets 210 with removable knees). The 150 lb rider is a plain pass; the 200 lb goal rider is green.
- **Cargo.** The 200 lb payload passes. Capacity is **276 lb** (the dry removable knee's brake-mount row; 286 lb with glued knees, where the rear beam under the seat sets it); comfortable (still green) to **231 lb** (the rear beam under the seat).
- **Resting load.** A 250 lb adult sitting or standing on one foot anywhere on the deck passes (capacity 348 lb).
- **Stability.** Straight tip 45° against a 35° limit; full-lock tip the same; slides before it tips (0.78 of limit).
- **Sides.** A 50 lbf push moves a gunwale about 0.12" (under the 1/8" "feels solid" mark; reported, not judged).
- **Cost.** BOM **$1,511** Standard ($2,401 Extreme; 8/4 oak for the solid blocks is +$96 over laminating them, D-95), excluding shipping and tax; about 6.8% of the Standard total is estimates (the $30 ratchet-and-wrench pouch for the removable knees is most of it), the rest quoted from listings ([docs/price-research/price-research-cost-pass-2026-10.md](docs/price-research/price-research-cost-pass-2026-10.md) and the earlier files). Owned shop stock (beech Dominos, sandpaper, supplies, Titebond III, mineral spirits, contact cement, paracord) is listed at $0 (D-79).
- **Materials by section (Standard BOM).** Lumber $544 (Peach State 4/4, 5/4 and 8/4), plywood $139, metal $107, purchased parts $287, fasteners $147, consumables $165, finishing touches $138. Parts sold in packs far larger than the sled needs are priced by the whole pack in their own section (there is no separate bulk section).

## 6. How the app is organized

One parameter file drives everything.

```
src/params.ts            every design number, with unit, range, status and a note; validateParams()
src/model/               params -> Part[] (plain data, no three.js): body, front end, rear mount, brake, seat, storage, joinery, mass
src/analysis/            runChecks(params) -> engineering rows; riderSweep; cargoCapacity (plain TS); engine.ts runs
                         them (and the truck fit) in two Web Workers (client.ts, analysis.worker.ts) so the page never waits
src/sim/                 Rapier rigid-body sim of the sled (qualitative)
src/truck/               truck-bed fit check
src/build/               build outputs: cut list, nesting, BOM and prices, Shaper and laser SVGs, forms, drawings, assembly (and its step sketches in figures/), finishing, verify, zip
src/viewer/              three.js viewer: materials, textures, joinery cuts, mannequin
src/ui/                  panels: params, analysis, sim, Simple view, Build mode
```

- **Frame.** +X forward (toward the bridle), +Y left, +Z up; origin on the ground under the rear-axle center. Inches, pounds, degrees.
- **One part is one physical piece.** `massLb` is per piece; identical pieces share a `partNo`; every view (viewer, analysis, sim, cut list, BOM, exports, assembly) reads `buildModel(params): Part[]`.
- **Modes.** **Simple** (the default) answers "is it safe, and for what rider weights?" with a rider sweep, six traffic lights and a spec card. **Advanced** has the sliders, the viewer toggles (brakes, lights, chocks, seat flat, handle parked, Transport mode), the full analysis table and the sim. **Build** holds the outputs below.
- **Sharing.** The whole design is in the URL hash.
- **Tests.** `npm test` runs the model, analysis and build outputs headless, including fuzz and overlap tests of the model.

## 7. Build outputs (Build mode and the zip)

Everything is a pure function of the parameters.

**Build order (D-94).** Nothing is cut to its final size before what it fits against exists. Milling, edge-glued panels and laminations come first and stay oversize. The 12 mm deck and seat back are cut next: the deck is the reference, and the frame is dry-fitted and set to it (deck edge 1/2" in from each rail's outer face). The side webs are cut at the side forms, after a 1/8" hardboard test web has proved the forms and the deck's edge has been measured (59-1/2"). Once the hull is glued, the transom and bow bulkhead are cut, after laser-cut 1/4" plywood end templates (dados and mortises cut through) have been pushed onto it; both ends are dry-fitted together before any epoxy. The brake flaps are cut after their template is tried on the knee and tire at the wheel dry fit, the signs and grab boards after the ribs (and the reach check), and the storage walls and lid to the box ribs and box as built. The dry fit is two steps (the frame dropped into the sides, then the rails trimmed, mortised and piloted), and the last holes from below are their own step after the wheel dry fit. Every step that cuts a part opens with a "Before you cut" check: what to measure, from which edge, the design number, the tolerance, and what to do if it is off. The glue card is one box before the steps; each glue step points to it.

| Section | What it gives you |
|---|---|
| Verify | the checks to make on real parts before ordering (wheel hub, sheet thickness, axle steel, and so on); with removable knees, a refit check (flat seat, a slip of paper at the joint, the backing plate in its recess, no washer pressed into the oak, bolts after the first outing, the chock cord eye, wobble) |
| Cut list | the actual cuts (an edge-glued panel is its boards, then the glue-up), rough sizes rounded up to 1/8", laminate allowances, board yields, a bandsaw resaw check; each plywood row says whether the laser cuts it (plain rectangles are sawn) |
| Nesting | plywood layouts on 4' × 8' sheets; the oak shopping list as linear feet by whole-inch width per thickness (any board at least that wide rips down), then the whole-board plan the BOM prices and the board feet |
| BOM | priced lines with vendor links, quoted vs estimated, Standard vs Extreme; the price research is in docs/price-research/price-research-2026-10.md and docs/price-research/price-research-standard-2026-10.md |
| Shaper | SVG files for every flat part (outside, inside, pocket, guide conventions) |
| Laser | full-size SVGs for the XTool S1 (D-86): the shaped thin parts that fit the bed (the webs), the lid's lettering (engrave only) and every 1/4" template and pattern, with red cuts and blue scores (plain rectangles are sawn); the rail form's counter-form is here |
| Forms and drawings | glue-up forms and templates (tiled to Letter pages), including the end templates for the transom and bow bulkhead (D-94), and a dimensioned drawing of every non-Shaper part |
| Assembly | numbered steps in the build order above (each cut step opens with its "Before you cut" check) with sub-bullets, part chips with dimensions and Show in 3D, and a 3D step-through; labeled sketches on the steps that are hard to picture (the forms, the side cures, the joints), and a "What this is for" line on the jig steps, whose 3D view highlights the parts the jig makes; with removable knees the knee step fits the knees dry, they are finished on the bench and bolted on at the hang step, and a last step takes them off and puts them back |
| Finishing | the schedule for the chosen weather spec |
| Downloads | one zip: Shaper SVGs, laser SVGs, forms, drawings, nesting, STLs for the lamp clips, cutlist.csv, bom.csv, a build book (printable HTML) and a README |
| Briefing book | a short printable handout for the troop committee (Download briefing book, beside the build book; `?briefing` after the app address shows it in place of the app): what the sled is for and its other uses, two pictures from the 3D view (ready to roll, and Transport mode), the BOM by section in plain words, a subtotal of the lumber and plywood (donated by the builder), the parts the troop buys, the total, and a troop budget: the bought parts plus 15% for shipping, tax and price changes. The prose is in `src/build/briefing-book.ts`; the numbers come from the model and the BOM. Not in the zip (its pictures need the 3D view) |

Build text follows Eric's shop-readability rules: fractions, no internal names, every notch, hole and mortise located from a named edge, short steps with sub-bullets.

## 8. Reading the code

- Design numbers live only in `src/params.ts`. Model code holds derived geometry, never a literal design dimension.
- Code comments cite decision IDs (D-xx, A-xx) instead of repeating the reasoning; look them up in [DECISIONS.md](DECISIONS.md).
- The studies behind a decision are kept where they are still the engineering basis: [docs/studies/side-stiffness-study.md](docs/studies/side-stiffness-study.md) (D-76), [docs/studies/removable-knee.md](docs/studies/removable-knee.md) (D-78).
- Deploy: pushing to `main` runs the tests, then publishes `dist/` to GitHub Pages (`.github/workflows/pages.yml`). `npm run build:single` makes one self-contained HTML file.
