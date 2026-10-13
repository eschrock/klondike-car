# Removable brake knee: study

2026-10-13. **Study only: no model, params, analysis or build-output changes.** For Eric's decision (parked item in `docs/STATUS.md`).

Eric's ask: the rear step brake is already a pull-pin flap (D-65), but its oak knee (D-75 / D-77) stays on the sled and sticks out **3.69"** beside each rear tire (3.81" with the strap). He wants the knee and flap to come off as **one unit, tool-free**, with nothing protruding when the brakes are off. His lead: anchor the knee at the rear tie-down rib, "one quick release on top and one underneath".

Sketches (SVG, real model coordinates, side view and sections): `docs/removable-knee/`.

| Sketch | What it shows |
|---|---|
| `0-today.svg` | Today's knee, four clamped bolts, 3.69" out |
| `a-rib-head-and-rail-pins.svg` | **A**: Eric's lead, a pin on the rib head and a pin through the rail |
| `b-slide-on-cleat-dovetail.svg` | **B**: French cleat (B1) and dovetail socket (B2) with one lock pin |
| `c-two-rail-pins.svg` | **C**: two pins through the rail and backer |
| `d-hook-tenon-blade.svg` | **D**: three ways to drop the bottom pin (hook, tenon, blade) |

## 1. Short answer

**Recommend A, Eric's lead, with four refinements.** It is the only concept that passes the brake loads with ordinary bought parts and no exotic joinery, and the geometry is unusually kind to it: the brake force line from the pivot runs within **0.2"** of a pin on the rib head. Everything I found that avoids the bottom pin (B, D) is weaker, harder to build, or costs about the same.

The refinements, all needed (sections 4 and 6):

1. **Sleeved pins.** A loose 3/8" pin in 3/4" oak is not a clamped bolt; checked the way the NDS checks a single-shear pin, a bare pin is over its limit at the top. Stainless sleeves (1/2" OD) in every pin hole fix the wear and bring the top pin to **0.62 to 0.89** of capacity.
2. **A 1" thick tab** on the knee's rear face, lying on the rib head, carries the top pin (section 4A).
3. **A 1/4" oak pad** on the knee's inboard face, so the knee bears on the side web up high instead of pivoting on the chine top (cuts the prying pull on the bottom pin from 150 to about 57 lbf).
4. **Delete the backer** (-0.4 lb): a sleeved pin through the 3/4" rail alone passes at 0.33 to 0.55.

What it gets you, per sled: **nothing outboard of the hull when the brakes are off** (two 1/2" flush stainless dots on each side), **about 1.6 lb lighter** than today (121.1 to about 119.5 lb), about **15 s a side** to take off, and a knee that goes back on in the same place because it is located by two sleeved holes 8.6" apart plus the hull face. The price is hardware: about **+$80 to +$120** over today's bolts (quick-release pins and sleeves; estimates, section 6).

Eric's guess that **the pivot pin could double as the top pin does not work**: section 4A.

## 2. What we are attaching to (model coordinates)

Model frame: +X forward, +Y left, +Z up, origin on the ground under the rear axle; inches. Left side shown, the right mirrors. Numbers are read from `buildModel` / `brakeGeometry` at the defaults, not typed.

| Item | Position |
|---|---|
| Hull outer face | y = 12.00 (rail, chine band). The free web between the bands is **0.21" lower** (y = 11.79) |
| Rail | 3/4" x 3" oak, z 4.53 to 7.53; backer inside it y 10.5 to 11.25, x 5.69 to 8.94 |
| Knee | x 6.25 to 8.375 (2-1/8"), z 4.53 to 14.04; leg y 12.0 to 13.75, arm to y 15.69; strap to 15.81 |
| Pivot pin | x 7.01, z 12.40, y 13.3 to 16.4 |
| Rear tire | x -5 to 5, y 13.25 to 16.75 (1-1/4" gap to the hull), top z 10 |
| Rear rib (D-76 "box rib") | head x 4.59 to 6.59 (center 5.59), z 10.77 to 17.78, y 10.63 to 11.38 (inside); a 3/4" box tie behind it at z 10.77 to 13.77; the box fore end is at x 6.99 |
| D-ring + 4 #8-32 screws | z 16.15 to 17.39; fender washers on the outer face |
| Neighbors outside | side sign ends at x 4.25; reflector x 6.91 to 9.09, z 15.46 to 16.90; grab-board strip starts x 9.23 |
| Joist 2 | x 5.04 to 5.67, ends on the rail's inner face (just behind the backer) |

So the rib head sits right behind the knee (its front edge is 0.34" past the knee's rear face) and **0.42" behind the pivot axis**; the pivot is not in the head.

## 3. The loads, and what they do to a removable joint

From `brake-mount` / `brake-pivot` / `brake-abuse` (goal rider 200 lb + 25 lb cargo, hold load on the 15° slope, brake load factor 2):

| Case | Force of the flap on the knee at the pivot |
|---|---|
| Goal hold | **197.6 lbf**: 126.5 back (-x), 151.7 **up** (+z) |
| Operating 150 lb / cargo 200 lb | 169 / 183 lbf (the goal case governs) |
| Stomp, 150 lbf on one foot (yield level, SF 2.0 on wood and steel) | 178.7 lbf (0.90 of the hold; every ratio below is about 0.45 of its hold value) |
| Sideways boot push, 10 lbf on the foot (`brakeFlapSideLoadLbf`) | 104 lbf at the strap, in or out |

The force acts about **3.00" outboard** of the hull face (`brake-mount`'s lever), so it also tries to pry the knee: **455 lbf-in** about a fore-aft axis (top of the knee pressed in, bottom pulled out) and **380 lbf-in** about a vertical axis (yaw).

What this means for a removable joint (it is what drove the whole study):

* **The load is UP.** The flap pulls the knee up. Anything that hooks *under* something is seated by the brake; anything that hooks *over* something (a French cleat) is unhooked by it.
* **Today's four bolts are clamped**, so they carry shear by friction and are never bent (`brake-mount` governor: the nut plate, 0.57). **A quick-release pin is loose.** It is a single-shear dowel between two wood members, so the limit is the NDS yield-mode capacity of a 3/8" pin in 3/4" oak, not the pin's steel strength (the 20,500 lbf double-shear breaking strength of a 3/8" ball-lock pin is irrelevant; the oak governs). This is the main reason Eric's trade ("some stiffness for removability") costs real design effort.
* **The knee is a lever.** The load is 6.4" above today's bolt group and the rail is only 3" deep, so two pins inside the rail see twice the load per pin that the four bolts do. A wide base (rib head to rail, 8.6" apart) cuts the pin loads by a factor of three. That is why Eric's "one on top, one underneath" is the right shape.

### Method (so the numbers can be checked)

* In-plane: rigid knee on its pins, elastic pin-group method (direct + twist), the same method as `brake-mount`. Out-of-plane: prying about the hull-face contact line, yaw about the tab's or knee's rear edge.
* Pin capacity: NDS single-shear yield modes Im, Is, II, IIIm, IIIs, IV (Table 12.3.1A, Rd per 12.3.1B with K_theta 1.25), wet service C_M 0.7 (`ndsWetFactorFasteners`), C_D 1.0 and no group factor (two pins, sustained hold). Dowel bearing F_e = 4,000 psi (the repo's conservative figure) to 5,700 psi (`fePerp` at 3/8", NDS Table 12.3.3), shown as a range. Pin yield 65 ksi (`ss316BoltYieldPsi`). Sleeves are modeled as a 1/2" pin with a composite yield of 44.7 ksi (pin + 304 tube). The mode equations are the ones in the Caltrans falsework worked examples ([NDS 12.3 Eq. 12.3-6 and 12.3-10 examples](https://dot.ca.gov/-/media/dot-media/programs/engineering/documents/structureconstruction/fw-appendixd-ex12-a11y.pdf)); `src/analysis/nds.ts` already has `lateralZ` and `boltCapacity` for a steel side plate, and the implementation must extend them to wood-to-wood. **I did not read the NDS text itself, so confirm the equations against it before the implementation.**
* Bearing allowables: the repo's 1,700 psi oak dowel bearing and 1,070 psi perpendicular-grain compression.
* Rules: every metal part is bought, or stock cut on a metal bandsaw and drilled (`src/model/no-fab.ts`); no bending, welding, tapping, machining or countersinking. No new wood-screw size (D-72: #6 x 2-1/2, #8 x 1-1/4, #10-32 inserts). Stainless by weather spec, `stainless(p)`: 304 for Standard, 316 for Extreme.

## 4. The concepts

### 0. Today (reference), D-65 / D-77

Four 3/8" 316 bolts through the knee leg, rail and backer, nuts on a 1/8" x 2" x 2-1/2" backing plate. Worst bolt 256 lbf (shear 0.12 of allowable, bearing 0.27). Permanent hull-side mass per sled: knees 2.75 lb, straps 0.47, backers 0.40, plates 0.35, bolts about 1.6 (estimate; the model carries fasteners in one lumped `hardware` part) = **about 5.6 lb**. Knee 3.69" outboard, always.

### A. Eric's lead: a pin on the rib head (top), a pin through the rail (bottom) (recommended)

`a-rib-head-and-rail-pins.svg`

**How it works.** The knee grows a **tab** on its rear face, x 4.6 to 6.25, z 13.2 to 15.6, 1" thick, that lies on the side web over the rib head. Top pin **T** at (x 5.6, z 14.4) goes through tab, web, filler and rib head (about 2-1/4" of grip). Bottom pin **B** at (x 7.3, z 6.0) goes through the knee leg and the rail (3/4"). Both are 3/8" quick-release (ball-lock) pins from the outboard side, in 1/2" OD stainless sleeves pressed into every hole. Pull both, lift off knee and flap as one piece.

**Why T goes there.**
* The brake force line from the pivot (up and back) passes 0.2" from T, so T takes the horizontal load almost directly and the knee's lever arm shrinks from 6.4" to 2".
* It is above the box tie's top (z 13.77), so the pin tip (a ball-lock ball sits only about 0.15" past the last member) clears the tie; the tab clears the sign's front end (x 4.25 against the tab's 4.6) by 0.35" and sits 0.3" to 0.4" under the D-ring washers. It fits beside the tire (it is above the tire top and the flap).
* The rib head is the strongest hull spot up there: 14 in² glued to the web, four through-bolts, tied to the storage box.
* A pin cannot go through the box tie, and a pin tip cannot be reached from inside the sled, so T has to be a **ball-lock** (button outboard, balls inboard); a clevis pin and clip would need access to the inside.

**Could the D-ring's own screws or the pivot pin be the top pin?** No.
* The four #8-32 screws (washers outside) are the D-ring's, are too small, and sit 2.4" higher than the load line.
* The pivot pin is 0.42" forward of the rib head's front edge. Even if the rib moved forward, a pivot pin that is also the hull pin would be a cantilever carrying 198 lbf at 3": **600 lbf-in** into a 1.17" deep socket. A 3/8" pin would see 116 ksi; a 5/8" pin 25 ksi, but the socket's end bearing would be about 4,200 psi against 1,700. The 8.6" base is what makes the joint work.

**Strength** (hold load; stomp is about 0.45 of these):

| Check | Value | Capacity | Utilization |
|---|---|---|---|
| Pin T shear (elastic group: T 125 lbf, B 87 lbf) | 125 lbf | NDS wet, sleeved, 1" tab: 141 to 200 lbf | **0.62 to 0.89** (a bare pin with a 3/4" tab: 0.91 to 1.29; hence the sleeves and the 1" tab) |
| Pin B shear, rail only | 87 lbf | 183 to 260 lbf | **0.33 to 0.55** |
| Steel pin stress at 125 lbf | 1,130 psi single shear | 18,753 psi | 0.06 |
| Bearing on oak (1/2" sleeve) | 210 to 250 psi | 1,700 psi | 0.12 to 0.15 |
| Axial retention, B (prying about the hull face, with the 1/4" pad, plus yaw) | 57 + 124 = about 180 lbf | ball-lock retention: **not found, ask the vendor** | verify |
| Axial retention, T (yaw 46 + 83 from the sideways push) | about 130 lbf | same | verify |
| Tab glue joint (to the knee's rear face, 2.4 in²) | 28 psi | 212 psi | 0.13 |

The rib head then carries 125 lbf of pin load in its plane plus up to 83 lbf pulling out, on top of the D-ring's 300 lbf rating; `lash-load` (box rib at the ring rating, 0.77) and `side-lateral` (0.78) must be re-run **with the loads combined**.

**Alignment on reattachment.** Located like a three-datum fixture: the knee's face on the hull face (y), the two sleeved holes (x, z and the rotation); clearance 0.005" per hole gives about 0.01" at the pad. The holes are drilled with the frame at the absolute layout of D-75(e), the knee tab and leg from a template. This is better than today's bolts, whose 3/8" holes have 1/16" of play.

**Weight.** Knees 2.75 + tabs 0.19 + straps 0.47 + four pins 0.4 + eight sleeves 0.12 = 3.9 lb (all removable) against 5.6 lb permanent today, so **-1.6 lb** (121.1 to about 119.5 lb). The additional removable mass for Transport mode is about 3.9 lb. Keeping the backers would make it -1.2 lb.

**Cost.** Four ball-lock pins at about $25, eight sleeves at about $5 to $6 (bronze or stainless bushings, or stainless tube cut to length at about $1), less today's bolts and plates (about $20): **about +$120**. A leaner version, ball-lock at T only and a clevis pin and hitch-pin clip at B (the underdeck cavity is open from below, so the clip can be reached), is **about +$80** but slower. All prices are estimates in the `src/build/prices.ts` sense; none has been quoted.

**What stays on the hull with the brakes off.** Two 1/2" flush stainless sleeves per side. No backer, no plate, no bolt heads, nothing proud. (The 1/4" pad lives on the knee.)

**Speed.** About 15 s a side off, 25 s on (two button pushes, lift; two holes to find). Estimates.

**Shop.** Drill the rail's B hole on the drill press with the rail on edge against a fence (it is 3/4" thick, 58" long); drill T through web, filler and rib head after the rib is glued in, using a drill block normal to the side; epoxy the sleeves; face-glue the tab to the knee's rear layer (two existing #8 x 1-1/4" screws to clamp, no new screw size). Medium.

**Risks and checks.**
* Ball-lock pins are usually 17-4 PH, not 316; the Extreme spec needs a 316 pin (or an accepted exception), and the retention rating is unpublished in what I found ([McMaster 3/8" quick-release pins](https://www.mcmaster.com/products/quick-release-pins/military-specification~nas1356c7c10d/) list the 20,500 lbf double-shear breaking strength, which is not the retention).
* The hull has a recess: the web is 0.21" below the knee's face, so the 1/4" pad's rear half sits on the web and the leg on the bands. Prying pressure on the web (about 50 lbf over a few square inches) is of the same order as the 50 lbf kick test (`side-web` 0.61); recheck.
* A forgotten top pin: the bottom pin still holds the brake loads, but the knee would drop when lifted. A lanyard to the knee keeps the pins from being lost.

### B. Slide-on bracket with one lock pin

`b-slide-on-cleat-dovetail.svg`

* **B1, French cleat** (a beveled strip on the hull, a matching strip on the knee). The strip stays on the hull, 3/4" proud, so it **fails the "nothing sticks out" rule**. It also hooks *over* the hull strip, and the brake pulls the knee *up*, so the cleat unhooks and the one pin carries all 198 lbf in single shear: **1.1 to 1.5 of capacity (fails)**. Flipping the cleat so the load seats it makes the hull strip an overhang, which is worse for protrusion.
* **B2, dovetail socket** in the rail with a key on the knee that slides up into it. Structurally good: the load seats the key on the socket's closed top (0.14 of the perpendicular-grain limit), the dovetail flanks take the prying and the fore-aft load, and the pin is only a retainer. But the socket removes about **2.1" x 2.5" of a 3" deep rail** at x 6.25 to 8.4, needs a dovetail bit in a rail and backer, and an oak-on-oak fit that swells in wet snow and sticks (or rattles when dry). Flush when off, light (-1.2 lb), cheap in hardware, but the hardest to build and the weakest on durability.

Not recommended.

### C. Two quick-release pins through the rail and backer

`c-two-rail-pins.svg`

Today's knee, the four bolts replaced by two pins in sleeves. The rail is only 3" deep, so the pins can sit at most 1.7" apart (edge distance), 5.5" below the load. Elastic group: **516 lbf on the worst pin** (twist 446 + direct 99, combined), against a wet NDS capacity of 158 to 225 lbf bare, 210 to 300 lbf sleeved: **1.7 to 2.5 over**. Two 1/2" pins in 5/8" sleeves are still **1.4 to 2.0 over**. Four 3/8" pins on today's bolt pattern, sleeved, are 0.85 to 1.21 (255 lbf worst): marginal and eight pins a sled. The pins also see about 260 lbf of axial pull from yaw and prying with no wide base to spread it.

It is the simplest to build, but it does not pass. **Not recommended.**

### D. Ways to avoid the bottom pin (my search for something better)

`d-hook-tenon-blade.svg`. Idea: the brake load is up and the hull has a free surface facing down (the rail's bottom edge), so let the knee hang *from* it and keep only the top pin. I tried three versions.

| Variant | Outcome |
|---|---|
| **D1 oak tenon** (the knee's middle y-grain layer extends 1.5" into a mortise in the rail and backer) | A tenon cannot pull the bottom of the knee inward, so the whole 455 lbf-in prying moment becomes a couple on the tenon walls: 566 lbf on 0.71" x 0.4" of oak is 2,000 psi, **1.9 times** the 1,070 psi limit (1.3 times even with 0.75" of contact). **Fails.** |
| **D2 oak foot under the rail with a lip behind the backer** | Seated by the load, and the lip stops the prying (about 110 lbf, 410 psi cross-grain tension at its root; oak is weak there and the repo has no value for it). But nothing holds the knee fore and aft (it swings on pin T), the foot can only be the 0.71" middle layer (the outer layers' grain runs the wrong way), and it hangs 1/2" below the rail. A fix needs a dowel or a notch, which is a second pin again. |
| **D3 stainless blade** (1/4" x 1-1/2" bar, in a slot in the knee's lower leg, projecting 1-1/2" into a slot in the rail and backer) | The only one that works: the couple is carried at 0.6 to 0.9 of the oak limit, no wear, a bought flat bar (the repo already prices 1/4" x 1-1/2" 316). Top pin T at 0.52 to 0.75. But it needs a precise slot in the knee leg **and** one in the rail and backer, aligned to the top pin, for about the price of a second pin and sleeve. Weight -0.8 lb (blades 0.7 lb), about +$65. Harder than A for no gain. |

None beats A. If Eric wants to drop a pin anyway, D3 is the route to test with a mock-up.

### Rejected on the way

* **Fold-flat or swing-in knee** (hinged on a vertical pin): it still sticks out about 1.75" to 2", and a hinge in the load path is worse than a pin.
* **Shrinking the knee**: it is 3.69" out because the flap lies over the tire, which stands 1-1/4" off the hull; the pivot cannot move in.
* **Backer or nut plate with knob bolts** (tool-free, but 4 per side, slow, and still 3/8" holes with 1/16" play).

## 5. Comparison

Per sled (two sides). Utilization is the worst pin at the goal hold load, NDS wet single shear, range for F_e 4,000 to 5,700 psi. Mass and cost against today.

| | Today | **A** | B1 cleat | B2 dovetail | C (2 pins) | D3 blade |
|---|---|---|---|---|---|---|
| Strength | clamped, 0.57 (nut plate) | **T 0.62 to 0.89, B 0.33 to 0.55** | pin 1.1 to 1.5 (fails) | wood 0.14; rail weakened | 1.4 to 2.5 (fails) | T 0.52 to 0.75, blade 0.6 to 0.9 |
| Pins in double shear? | n/a | No, single shear at the knee/hull interface (the pin's own stress is 0.06; wood governs) | single | n/a | single | single |
| Reattach alignment | fixed holes | **two sleeved holes, +/-0.01"** | cleat, loose | dovetail fit, swells | two sleeved holes | slot fits plus a pin |
| Mass vs today (about) | 0 | **-1.6 lb** | -1 lb | -1.2 lb | -1.2 lb | -0.8 lb |
| Added cost (est.) | 0 | **+$80 to +$120** | +$30 | +$30 | +$120 to +$200 | +$65 |
| On the hull when off | knee 3.69" out | **two flush 1/2" dots** | 3/4" cleat strips | an empty socket | four flush dots | slots and a dot |
| Time off / on | wrench, minutes | **15 s / 25 s** | 10 s / 20 s | 10 s / 20 s | 15 s / 25 s | 10 s / 20 s |
| Shop difficulty | built | **medium** | easy | hard | easy | hard |
| Verdict | | **recommend** | no | no | no | only if Eric wants one fewer pin |

The lightest option that passes is **A without backers**: -1.6 lb. Nothing else is meaningfully lighter. Times and prices are estimates; masses use the model's part masses, oak at 0.0245 lb/in³ and 0.29 lb/in³ for stainless, and an estimated 0.2 lb per bolt set.

## 6. If Eric approves A: what changes

New decision **D-78**, one model change, rewritten analysis rows, new tests, then the build outputs. Rough scope:

* **Params** (`src/params.ts`): remove `brakeMountBolt*`, `brakeBackPlate*`, `brakeBackerThickIn` and the backer params; add the tab, the pad, pin and sleeve sizes (`brakeKneeTab*`, `brakePinDia`, `brakeSleeve*`) and the pin positions (derived from the rib and the rail, not typed).
* **Model** (`brake-layout.ts`, `brake.ts`, `rear-mount.ts`, `side-ribs.ts`, `frame.ts`, `removable.ts`, `no-fab.ts` tests): the knee plus tab and pad, pins, sleeves, the rib head's sleeve joint, the rail's pin hole; `BRAKE_KIT_RE` includes the knee, strap, tab and pins (knee unit in the brake kit; the Brakes and Transport toggles then drop the knee too); the chock cords currently tie to an eye on the knee, so the chock tether has to be decided.
* **Analysis**: `brake-mount` rewritten for two sleeved single-shear pins (new NDS wood-to-wood yield-mode helper in `nds.ts`, pin axial retention, tab glue, pad bearing on the web, rail bearing); `brake-pivot` unchanged; `brake-abuse` follows; `lash-load` and `side-lateral` re-run with the pin loads on the box rib; a removed-brake configuration check (no knee, hull face flush).
* **Build outputs** (BOM, assembly steps, drawings, forms, verify items), in the build-instructions style already in the repo: new rows for the pins and sleeves, removal and refit steps, the hole layout drawings, a jig for the tab, pin and sleeve verify items.
* **Process**: Sonnet agents in parallel with no file overlap (model/params, analysis, build outputs), a critic loop to 8/10 on engineering and buildability, a green suite (`npx vitest run`, `npm run typecheck`, `npm run build`, `npm run build:single`), commit to main.

## 7. Questions for Eric

1. **Go with A?** (Or, if you want fewer pins, a mock-up of D3.)
2. **Hardware vs cost:** ball-lock pins at both holes (about +$120, fastest) or ball-lock on top and a clevis pin with a hitch-pin clip below (about +$75, reached from underneath)?
3. **Pin steel:** ball-lock pins are normally 17-4 PH. OK for the Standard spec; for Extreme (316) we would have to source a 316 pin or accept 17-4 PH as a documented exception.
4. **Delete the backers** (-0.4 lb) and **add the 1/4" pad** on the knee face? Both are in the recommendation.
5. **Brake test first?** Eric's parked note says this "trades some stiffness for removability". A mock-up of one knee, tab and two pins on a scrap rail and rib would show the slop and the feel before the model changes.

## Sources

* Brake loads and rows: `src/analysis/brake.ts` (`brake-mount`, `brake-pivot`, `brake-abuse`), D-65, D-74 to D-77 in `DECISIONS.md`.
* Geometry: `buildModel(defaultParams())` and `brakeGeometry` (coordinates in section 2).
* NDS single-shear yield-mode equations as worked in the [Caltrans falsework examples](https://dot.ca.gov/-/media/dot-media/programs/engineering/documents/structureconstruction/fw-appendixd-ex12-a11y.pdf); NDS Table 12.3.3 and 12.3.1B coefficients as already coded in `src/analysis/nds.ts`. Not checked against the NDS text.
* [McMaster 3/8" quick-release pins](https://www.mcmaster.com/products/quick-release-pins/military-specification~nas1356c7c10d/): 17-4 PH stainless, 20,500 lbf double-shear breaking strength. Prices and retention ratings not found.
* Memory notes (the build-instructions style) were not available in this session's environment; the implementation will follow the existing build outputs in `src/build/`.
