SCORE: 6/10

# Phase 3 buildability review, round 1

Reviewer stance: expert furniture maker / boatbuilder with a full shop (CNC router, Shaper Origin, DF 500 + XL, laser, printers; no lathe, no welding). Evidence comes from the default `buildModel()` parts dump (stock, rough, grain, fab, joints, edges), `body.ts`, `joinery.ts`, `seat.ts`, `storage.ts`, `lighting.ts`, `brake.ts`, `steering.ts`, and DECISIONS D-35..D-42.

Overall: the captured-ply hull idea is sound and the joint records are unusually complete. But several joints cannot physically be cut as specified, the prow retention is under-built for a thing scouts will grab, the assembly order is not feasible as drawn without a stated sequence and glue relief, and the metal parts have no stock or source, so Phase 4 cannot emit a metal cut list. Fix the MUST items and the model is buildable.

## MUST-FIX

**M1. Three Domino specs are geometrically impossible (6x40 = 1.57" long).**
- `seat.ts:165` (seat-back stile/rail, members are 1.5" wide: the 40 mm Domino is longer than the member, and its slot also lands in the 3/8" panel groove).
- `storage.ts:220` (lid frame rim is 1.0" wide: 1.57" Domino cannot fit).
- `seat.ts:267` (grip post is 1" x 1": the Domino must lie across a 1" face).
- Fix: seat back: 5x30 is also too long beside a 3/8" groove (1.5 - 0.375 = 1.125" < 1.18"), so use 4x20 (0.79") offset past the groove, or stop the groove 1/2" short of each joint and use a haunched stub tenon. Lid frame: 4x20 (fits 1" with 0.1" margin) or half-lap/bridle corners. Grip posts: 4x20, or a plain 3/8 x 3/4 x 5/8" blind tenon. Make `chooseDomino` (joinery.ts:44) the single source for these three places instead of hard-coded strings.

**M2. Finger-guard inserts break into the web groove (joinery.ts:272 -> `side-nose-*-gunwale`).**
- The insert axis is 0.40" above the gunwale bottom with a ~0.32" hole, so it spans 0.24..0.56". The web groove occupies 0..0.375" and is 0.252" wide in 0.5" stock. A 3/8"-deep hole from the outer face (wall behind the face is only 0.124") opens into the groove and the ply edge.
- Fix: put the inserts above the groove (z >= groove top + 0.25" + insert radius, i.e. >= 0.8" above the gunwale bottom, which means a 1.5" band is the minimum), or use through-bolts with a back plate, or thicken the gunwale locally with a 3/4" oak doubler on the inboard face (same pattern as the grip doublers) and drive the inserts from the outside into the doubler through the groove-free zone. Also move the inserts off stainless/brass ambiguity (see S7).

**M3. Prow retention cannot take a grab (joinery.ts:237, body.ts:24 `PROW_LEG_MAX_IN = 3`).**
- Leg is 2.5" long; the two 1/4-20 x 3/8" inserts are 1.125" apart (at 0.75" and 1.875" above the foot). The tip is 20.9" above the foot. A 25 lbf forward or sideways pull at the tip is 520 in-lbf: ~280 lbf in the top insert, 560 lbf at 50 lbf. A 3/8"-long brass insert in 3/4" lam pulls at roughly 250-400 lbf, and the lam face has glue lines across the insert.
- Fix: do not retain the moment with inserts. Give the prow a socket: a 3/4" x 1-1/2" x 3" deep mortised oak block (or a short steel tube sleeve like the push-handle sockets, D-39) bolted inside the front transom, with the leg lengthened to >= 4" so the leg bears in the socket and the knob/pin only retains. Back the 1/2" transom with a 3/4" doubler where the leg bears. If the lift slot prevents a longer leg, drop the slot position on the front transom or move the prow to the nose deck. Use stainless inserts, 5/16-18 minimum, and shorten the 2" knob bolt (it sticks ~1.1" into the nose space where boots go).

**M4. Assembly order is infeasible as modeled, and the closed dados will hydraulic-lock.**
- The deck enters chine rabbets that open to the inside-bottom (the chine overhangs the deck edge), so it must come from below or sideways; its rear edge is in a closed 1/4" dado in a transom that hangs 1.28" below the deck, so it cannot rise past the transom. The webs enter stopped dados (`body.ts:514`, `joinery.ts:155`), so they only move in X. With 0.016" slop and epoxy, a 1/4"-deep stopped dado cannot vent (same for the deck dado).
- Required sequence (state it in Phase 4): (1) epoxy-seal every groove, rabbet, dado, and all ply faces and edges; (2) glue each web into its chine + gunwale on the bench; (3) frame + deck as a glued unit; (4) slide each side assembly inboard (Y) onto the deck edge in its rabbet; (5) the transom goes on LAST, sliding in X onto deck, web ends, chine/gunwale tenons and rail tenons in one glue-up (14 joints at the rear, so use 120-minute slow epoxy and rehearse twice). The nose run mirrors this at the front transom.
- Fix in the model: vent each stopped dado with a 1/8" relief hole at its end (or leave 1/32" extra depth), widen slop (see M5), and write the order into the assembly steps.

**M5. Groove width is too tight for epoxy-sealed 6 mm okoume (`grooveSlopIn` 0.016" -> 0.252" groove).**
- Real 6 mm okoume measures 5.5-5.9 mm; two epoxy coats on faces and edges add ~0.3-0.5 mm; glue film needs another 0.3 mm. A 0.252" (6.4 mm) groove has 0.4 mm total slop. You will be forcing sealed panels into grooves, wiping the epoxy off as you go.
- Fix: cut the groove from the measured panel + 0.8-1.0 mm (about 0.275-0.28", a 7 mm CNC cutter), and have the validator reference measured thickness. At 1/2" stock that leaves 0.11" walls (see S1, which fixes it properly).

**M6. Chines/gunwales are not mechanically tied to the frame in the default (ladder) build.**
- `body.ts` chine bottom is flush with `deckBot` and sits at y = hwC..hwC+0.5; the ladder rail occupies y <= hwC. Nothing is under the chine. The side load path is web -> chine -> 1/4" lap on the 12 mm deck edge, peeling the top veneer (~1.6 in² of bond for a 6.5" grip), plus end joints to the transom. Grab pads, lash plates (300 lbf each) and the rider's hands all load this path.
- Fix: choose one: (a) default to the hull-girder frame (the model's alternative, which glues the girder under the chine with bronze screws at 8"); (b) thicken chine/gunwale to 3/4" and shift the rails outboard so each rail is 0.5" wider under the chine, with #8 SS screws up through the rail into the chine lip at 8" and an epoxy bed. Add a `side-to-frame` joint record either way.

**M7. No deck drainage: the hull is a closed-bottom tub.**
- Deck is surrounded by 7" sides and two full-width transoms; the only drains are the box's two 3/8" drains (`storage.ts` drain nipples). Wet snow, slush and rain pool on the cabin and nose decks, against the chine rabbets, and under the cushion.
- Fix: 3/8" scupper holes through the deck at each rear corner and the nose low point (or 1/2" x 1/4" notches at the web foot), epoxy-lined, with stainless nipples (no cut ply edge). Add to the drain list and the joint list.

**M8. `rough` length allowance is 1x, not 4x, in every builder.**
- `params.ts` note says length gets 4x (about 1/2"); code adds 1x (1/8") at `body.ts:120`, `body.ts:585`, `build-utils.ts:184`, `brake.ts:355`, `steering.ts:246`, `profile.ts:106`. Every board in the Phase 4 cut list will be 3/8" too short for crosscutting and end-trimming.
- Fix: `l: stock.l + 4 * p.millingAllowanceIn` in all six places (or a shared helper).

**M9. Metal parts have no stock dims and no sourcing (27 parts, 24 with `fab: drill-tap/cnc/laser`).**
- `axle-F/R`, `clamp-F*2`, `steer-stop-face-*`, `brake-shaft`, arms, hubs, crank, quadrant, bracket, pawl, pins, link: `stock` and `sourcing` are undefined. Phase 4 cannot generate a bar/plate/rod list.
- Fix: add `stock` (bar section x length, or plate t x outline) and `sourcing` (McMaster-class SKU family or a named supplier) to each; put the cut length in the cut list.

**M10. Brake hubs and cranks need a lathe, a mill or a broach (`brake.ts:469, 578`).**
- "Round steel bar bored to the shaft, keyseat broached" and "cranks bored to the shaft": no lathe.
- Fix: buy flange-mount or face-tapped 3/4"-bore shaft collars (or keyed hubs) and bolt the arms to the collar faces; or cross-drill shaft and hub for 3/16" roll pins (drill-press only). Delete the keyseat step or pair the hubs with a purchased 3/16" key + a keyed shaft collar.

**M11. Laser and CNC are named for steel.**
- `brake-quadrant` fab `laser` (1/4" A36), `steer-stop-face-*` fab `cnc` (A36, `steering.ts:228`): a shop CO2/diode laser and a router do not cut 1/4" steel.
- Fix: outsource the quadrant and stop faces (SendCutSend/Oshcut class, laser or waterjet) and say so in `sourcing`, or hacksaw/band-saw and file; for the stop faces, 1/8" A36 flat bar cut to length is simpler.

**M12. Turntable bolt pattern is unverified against the 4" beam (`steering.ts:79`).**
- A 12" square lazy-susan bottom plate has corner holes on roughly a 9-10.5" spacing; `beam-F` is 4" fore-aft with the kingpin and rod groove, so four 5/16 x 2-1/2" lags "into the beam top" cannot all land in the beam.
- Fix: confirm the actual hole pattern before ordering, or add a 3/4" oak mounting plate under the bearing that spans the beam and the bolster, with the lags into the beam only where they land and a bolt through to the bolster elsewhere. Also confirm the center hole passes the 1-1/4" sleeve or at least the 3/4" kingpin with radial clearance.

## SHOULD-FIX

**S1. 1/2" transoms/sides are marginal; go to 5/8" or 3/4".**
- At 1/2": Domino 4x20 leaves 0.106" (below the model's own 0.15" rule), so every chine/gunwale/rail joint falls to a CNC blind tenon with a 1/8" skin on the outer (varnished) face; the chine tenon is 3/16 x 1/4 x 3/8" (a toothpick, `joinery.ts:151, 156`), and a flat 1/2" lift-slot bar bears on a gloved hand at 62 lb (4.5 ksi, bar 0.75" x 0.5").
- Fix: transoms and chine/gunwale at 5/8" (Domino 4x20 leaves 0.23") or 3/4" (5x30 OK). Cost about 2-3 lb. Replace the micro-tenons with a quarter-knee (oak triangular gusset, epoxy-bonded to both transom and gunwale) at each end. Rework the lift bar: 3/4" thickness with a 3/8" roundover, or glue a 1" half-round oak grip over the bar.

**S2. "CNC blind tenon" is not a CNC operation.**
- A flat-bed router cannot cut a tenon on the end of a 36" x 3" rail. Either mortise both parts in the CNC and use a loose tenon (stadium mortises need rounded-edge tenon stock), or cut integral tenons on a table-saw/router tenoning jig. Relabel in `joinery.ts` and `fab`.

**S3. Chine/gunwale walls and fragility.**
- 36" x 1.5" x 1/2" oak with a 0.252"-wide, 3/8"-deep groove leaves two 1/8" walls; with the 3/8" rabbet below at the chine (0.472" tall), milling these straight without breaking is poor. With any flare the groove tilts and one wall goes to zero (the validator only warns below 0.1").
- Fix: 5/8" stock (S1), mill from quartersawn stock, and cut the groove from the best face with a hold-down. Make flare >0 illegal until S1 lands.

**S4. Storage box: 45-degree miters with a 1/8" spline in 6 mm ply do not work.**
- A 1/8" spline slot in 0.236" stock leaves 0.055" of ply each side. `storage.ts:219` also leaves wall-top edges exposed under the gasket (the `edges: 'captured'` flag is wrong).
- Fix: tape-and-fold miters (cut with a 45-degree bevel, tape the outside, fold, glue) plus a 3/8" epoxy fillet and 2" glass tape inside; drop the spline. Cap the wall tops with an oak coaming strip (3/8" x 1/2") so the gasket sits on oak and the ply edge is covered.

**S5. Hinge and latch screws.**
- Hinge `#8 x 5/8` through the 6 mm end ply into a 0.75" backer engages only ~3/8" of oak; use #8 x 1". Latch `#8 x 3/8` into a 1/2" transom at the face-grain gets no real margin once S1 is not applied; blocking exists for everything else (D-42) but not for these. A 75-degree stop (D-41) leaves the lid falling closed: add a friction stay or hold-open strap.

**S6. Foot stop ends are described as housed in "a stopped dado in each side" (`seat.ts:290`).**
- The nose side is a 1.5" chine + a 6 mm web; there is nothing to dado. The stop is an end-grain epoxy joint on 1/2" chines plus 4 screws up through a 12 mm deck.
- Fix: glue/bolt two oak corner blocks to the web or gunwale, or a screwed oak cleat. Make the check carry rider load through the cleats.

**S7. Dissimilar and corroding metals in white oak.**
- Brass inserts and zinc-plated square U-bolts (`running-gear.ts`), A36 plates and bright 1045 shafts sit in wet tannin-rich oak. BRIEF §5.2 asks for stainless or HDG. 3/8-16 inserts are stainless but the 1/4-20 and #10-32 inserts are brass.
- Fix: stainless (316) inserts and U-bolts or hot-dip galvanized; zinc-rich primer + paint (or powder coat) the A36 plates; plate/grease the brake shaft; isolate steel from oak with an epoxy barrier coat.

**S8. 3/4" ID DOM sleeve for a 3/4" grade 8 bolt is zero-clearance (`steering.ts:197`).**
- Grade 8 body is up to 0.750". "Hone to +0.003" needs a hone. Specify ID 0.765" (49/64 reamed) or buy 1-1/4" OD x 0.188" wall and ream to 49/64".

**S9. Seat-back panel Domino vs groove (`seat.ts:165`).** Even after M1, a 6 mm Domino cut in the rail end coincides with the 6 mm groove. Stop the groove short of the Domino or use a haunch.

**S10. Mud and snow in the rear-low brake shoes.**
- The shoes sit just behind the tire at axle height, directly in the rooster-tail. Wet snow will freeze shoes to the tread; the music-wire return spring and bronze sleeves will pack with ice.
- Fix: 1/4" UHMW/leather faces on the shoes; add a retraction stop; put a splash shield between the tire and the shaft; use stainless springs and grease; make the shoe retract >= 3/8" from the tread.

**S11. Prow lamination method.**
- 6 x 1/8" white oak, 23" radius, cold bend is fine. Epoxy (slow hardener) is the right glue; UF is not waterproof enough. Corrections: ratchet straps do not clamp a convex form along its length; use a vacuum bag, or cauls and bar clamps every 2-3", or a male/female form pair cut from the same toolpath. Tape or wax the MDF (epoxy bonds to MDF). Test-bend a 3-ply strip first: spring-back for a 3/4" lam at 23" radius with 6 plies is realistically 4-8%; 6% is a fair placeholder, measure it. Resaw from 4/4 quartersawn/rift stock to 5/32" and drum-sand to 1/8" (strips are 6 x 1/8" x 1.75" x 24.5" per `body.ts`; yield about 40%). The Part's `stock`/`rough` currently describe the finished 3/4" block, not the strips (see P1).

**S12. Edge banding is fiddly.** 3/16" x 0.236" (6 mm) oak strips on all four edges of the shoulder panels and access panel have almost no glue face and no clamp face. Make the bands proud (5/16" strip, flush-trimmed) and tape. Give the kingpin access opening (nose deck rim) corner radii of at least 3/8" so the banding can be mitered or bent. Consider an oak frame-and-panel instead of banded ply for the shoulders.

**S13. Pull-through on the 1/2" transom.** Handle sockets, brake quadrant bracket and prow carry bolt loads (a 50 lbf pull at 34" is 1,700 in-lbf) through 1/4" carriage bolts with fender washers on a 1/2" oak plank with a 4.5" slot. D-42 blocks the light plate, grip pads and lash plates but not these. Add a 3/4" oak backer (or a steel back plate) behind the sockets and bracket.

**S14. Stud length.** The seat-back stud is 3": stile 0.75" + wedge (about 1") + box end 0.236" + insert engagement 0.75" is about 2.8". Check with the real back angle (15 degrees) and wedge depth at the stud; use a 3.5" stud. Add nylon-insert jam nut or blue threadlocker so the knob does not back off; the stile bears on the wedge so the knob only holds against overturn.

## PHASE-4 NOTES

**P1. Cut list correctness.**
- `prow`: emit 6 strips (1/8" x 1.75" x 24.5", plus 2 spares), not the 3/4" x 1.625" x 22.6" block. Emit `prow-form` as MDF sheets (5 x 3/4" layers).
- `transom-rear` 9.56" x 28" and `transom-front` 8.75" x 14": no board is that wide; list an edge-glued panel (two boards) with the glue line away from the slot.
- Beams: `beam-F` rough 2.625" x 4.125" x 32.375" and `beam-R` rough 2.625" x 2.625": 12/4 stock, or glue-ups from 3 x 5/4; say which. Rough oak is 16.8 bf net (5.5 bf of 4/4; 4.0 bf >8/4 for the beams); order 28-30 bf.
- Derived irrational sizes (1.778", 1.7155", 2.738") on bolster, crossbar, steer stops, stop blocks: snap to 1/32" with joint-consistent rounding.
- Ply: both decks fit one half-sheet of 12 mm; all 6 mm parts fit one 4 x 8 with room. Cut size of captured panels (seat back, lid) includes tongues: carry `stock` vs `geometry` into DXFs.

**P2. DXF/CNC details.** Stopped dado ends and CNC mortises have bit-radius corners; round the web tongues and loose tenons accordingly (or chisel). Tilted grooves with flare need a 3D toolpath or a tilted saw cut; document or forbid flare.

**P3. Finish sequence.** Epoxy-seal captured ply (faces and edges), groove/dado/rabbet surfaces and the underside before assembly; amine-blush wash; scuff between coats; fillets after glue-up; varnish last (no varnish in glue joints). Sign blanks and ply 6 mm tee-nut barrels (about 5/16") protrude 0.08" inside the hull; use short-barrel tee-nuts.

**P4. Printed parts.** Print the finger guard and lantern/flag clips with the extrusion profile in the bed plane (layers parallel to the profile, strong in bending), ASA, 4+ perimeters; the 0.5" hood flange cantilevers ~5.5" so add ribs or print in CF-nylon. M5 thumbscrews into printed legs need heat-set inserts (as noted). Add 1/8" fillets at the leg-to-hood joggle.

**P5. Hardware verification list.** Square U-bolt stock widths (4" inside width at 3/8" rod), eye-bolt rating vs the tie load, hand-truck wheel bore/hub (13 x 5.00-6 with 3/4" bore, 3" hub), lazy-susan center hole and plate pattern (M12), 316 butt hinge size, EPDM bulb seat width (6 mm ply top is too narrow; S4), 1045 ground rod and SAE 841 sleeves (swap to stainless-sleeved or flanged UCFL204 3/4" bearings where mud is a concern).

**P6. Pinch/sharp edges.** Quadrant teeth at the rear corner are exposed near a hand: add a plate guard or a printed cover. Deburr all steel plates and round the pawl tab. Radius all stop-face corners.

**P7. Grain/movement (no further action needed once S1 is done).** Transoms are grain across the width (good); the ply web ends are glued into end-grain dado walls (weak glue, fine for a located fit); the web vertical restraint on a 9.5" transom is about 0.025" seasonal, acceptable with a slow epoxy bed. Seat-back and lid frames use ply floating panels in frames: bed with epoxy, no movement concern. Lid battens 25" long glued to 6 mm ply are fine.
