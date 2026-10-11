SCORE: 6/10

# Phase 3 buildability review, round 2

Reviewer stance: experienced woodworker and small-shop fabricator, home shop (table saw, bandsaw, router, drill press, Domino, maybe Shaper Origin or CNC; no lathe, mill or welder; steel plate outsourced). Evidence comes from a parts dump of `buildModel(defaultParams())` (224 parts, scripts in `/private/tmp/crit2/`, not in the repo), world-frame bounding boxes computed from the part transforms, `body.ts`, `joinery.ts`, `frame.ts`, `layout.ts`, `running-gear.ts`, `brake.ts`, `storage.ts`, `seat.ts`, `kingpin-plates.ts`, `build-utils.ts`, and DECISIONS D-35..D-44 plus the F1-F4 and visual-pass notes. Nothing in the repo was edited.

## Verdict

Round 1's joinery impossibilities are mostly gone, and they were fixed properly: real Domino face widths, loose tenons in place of the "CNC tenon", a rail that actually sits under the chine, a socketed prow, vented dados, scuppers, a 4x rough allowance, outsourced steel with stock and sourcing, and no lathe work in the brake. A hobby woodworker can now cut almost every individual part.

The grade stays at **6/10** because looking at the parts as one object turns up four problems a builder cannot get past without a redesign. The nose and the cabin are not joined to each other at all. The side-to-frame Dominos cannot be installed in the stated assembly order. The brake shaft bearing and lever pivot do not fit the rail they bolt to. The rear axle beam has no attachment to the frame. None of them is a cutting-detail problem. They are "what holds this to that" gaps, and a volunteer would hit each on the shop floor. With the four MUSTs fixed this is a 7; with the SHOULDs it reaches 8.

---

## 1. Round-1 verification

| # | Round-1 finding | Status | Evidence in the model data |
|---|---|---|---|
| M1 | Impossible Domino sizes (seat back, lid frame, grip posts) | **Fixed** | `chooseDomino` (joinery.ts:55-65) now uses the face width `wMm`. Seat back is 8x50 (22 mm wide) in the outer 1.125" band past the groove; lid rim 5x30 (19 mm in a 1.0" face); grip post 5x30 (19 mm in a 1" post, 0.16" wall in the 0.75" pad). All three come from `chooseDomino`/`frameJoint` (seat.ts:59, 199, 309). Open nit: lid panel is called "captured" but its joint is a 1/4 x 1/4 "rabbet" (N3). |
| M2 | Finger-guard inserts break into the web groove | **Fixed** | Inserts at `guardInsertZ`, 0.785" above the gunwale bottom, which clears the 0.375" groove by 0.25" plus the hole radius. 316 stainless. joinery.ts:~330, body.ts:36-38. |
| M3 | Prow retention cannot take a grab | **Fixed** | 4.0" leg bears in an oak U-block (`prow-socket`, 3.28 x 1.52 x 4.0, 0.75" cheeks). Two 5/16-18 inserts only retain. `prow-grab` row at 25 lbf. Leg width 1.75". See S6 for the 0.015" clearance. |
| M4 | Assembly order infeasible, closed dados hydraulic-lock | **Partial** | Order is now data (`HULL_STEP`, build-utils.ts:48) and in every hull part note. Vents are real: 1/8" holes at the 4 web dado ends and 4 deck dado ends. **But the stated order contradicts itself** (MUST-2) and the deck rabbet/dado has no clearance (MUST-2). |
| M5 | Groove too tight for sealed 6 mm ply | **Fixed** | `grooveSlopIn` 0.04, groove 0.276", 0.175" walls (body.ts:547, hull notes). The deck rabbet (0.472" for a 0.472" deck) did not get the same treatment (MUST-2). |
| M6 | Chine/gunwale not tied to the frame | **Partial** | Rails now run flush under the chines (`ladderRailY`, frame.ts:13); chine bears on the rail's outer 0.375" with 4x20 Dominos every 6" and an epoxy bed (joinery.ts:207-224). Geometry is right, but the Domino cannot be fitted (MUST-2), and the nose/cabin junction has no tie at all (MUST-1). |
| M7 | No deck drainage | **Fixed** | Six 3/8" 316 nipples through the chines at deck level (`scupperSites`, body.ts:~85). Hole centers 9.24" and 10.24" leave 0.22" above them to the groove bottom. Nose scuppers are ahead of the foot-stop board, so the footwell drains aft over the step, not forward. Acceptable. |
| M8 | 1x rough length allowance | **Mostly fixed** | `roughOf` (build-utils.ts:62) adds 4x; every lumber part checked: rough l = stock l + 0.5". **Exception:** `stop-block-AL/FL/FR/AR` still +0.125" (stops.ts). |
| M9 | Metal parts lack stock and sourcing | **Partial** | 27 metal parts now carry stock and a sourcing line. Still missing: `clamp-RL1/2`, `clamp-RR1/2` (no sourcing, no stock, "mass is an estimate"); `steer-stop-L/R` (formed channel: sourcing, no stock/flat pattern); the two brake bearing plates and the 3" x 3" plates are "not drawn" so they are in no cut list (F3 notes admit it). |
| M10 | Brake hubs/crank need lathe/mill/broach | **Fixed** | Bought face-tapped collars, 1/4" roll pins cross-drilled with the shaft, crank bored by step drill and reamer on the drill press, no keyseats (brake.ts:504, notes on `brake-crank`). Sourcing flagged "confirm a face-tapped 3/4" collar exists". Shaft is 4140 pre-hard; see S9. |
| M11 | Laser/CNC named for steel | **Fixed** | New `Fab` value `outsource`; quadrant, kingpin plates, stop channels all say waterjet/laser service (types.ts:48, brake-quadrant, kp-*). |
| M12 | Turntable bolt pattern vs 4" beam | **Partial** | A 3/8" x 2.5" x 11.94" carrier plate (`kp-carrier`) is the mounting plate; the bearing is screwed to it through two inner-flange holes. The note itself says "verify the bought bearing" and "assumed 6.25" center hole". It is a documented assumption, not a verified one (O-1). |
| S1 | 1/2" transoms/sides marginal | **Fixed** | Transoms 3/4", chine/gunwale 5/8". |
| S2 | "CNC blind tenon" is not a CNC op | **Fixed** | Relabeled as loose tenon, both parts mortised (`endJoint`, joinery.ts:98). Tenons are very small, see N1. |
| S3 | Chine/gunwale wall fragility | **Partial** | 5/8" stock, 0.175" walls, "mill from quartersawn" in the note. Flare is still allowed by the params (default 0). |
| S4 | Box miters/spline/coaming | **Fixed** | Tape-and-fold, no spline, floor deleted, 3/8 x 1/2 oak coaming caps the wall tops. |
| S5 | Hinge/latch screws, lid stay | **Fixed** | #8 x 1 into a 1" backer, oak latch blocks, 316 friction stay. Latch-block note says "bite 0.56" of block" but the block is 0.375" thick (screw continues into the transom; fine, wording only). |
| S6 | Foot stop "dado in each side" | **Fixed** | Two oak corner cleats epoxied to the chine and web, pinned to the board by 5x30 Dominos; `foot-stop` check. Note says "fills the 1/8" step to the web"; the real step is 0.195" (web inner face 6.57" vs chine 6.375"). |
| S7 | Dissimilar metals in oak | **Partial** | Hinges, D-rings, drains, inserts, brake pins/links are 316. Front U-bolts and rear clamps are still "zinc-plated"; axles (`axle-F/R`, bare A36) have no finish note; steel plates say zinc-rich primer + paint. |
| S8 | Zero-clearance DOM sleeve | **Not fixed** | `kingpin-sleeve-beam` still "ID 0.750"... hone to +0.003" if needed" for a grade 8 pin whose body can be 0.750". Also see S5 below (bolt length). |
| S9 | Seat-back Domino vs groove | **Fixed** | Groove stopped at the rail faces, Domino offset into the outer band. |
| S10 | Mud in the brake shoes | **Partial** | Bonded lining, 3/8" retract, stainless pins/springs. Splash shield not modeled (F3 notes). |
| S11 | Prow lamination method | **Partial** | Notes now say cauls/vacuum, slow epoxy, wax the form, 6 strips of 0.125 x 2.00 x 25 plus 2 spares, test strip. The `prow` part's `stock`/`rough` still describe the finished 0.75 x 1.75 x 22.66 block, not strips (P1 below). |
| S12 | Edge banding fiddly | **Not fixed** | `edgeBandIn` still 3/16" on 0.236" ply; kingpin-access opening corner radius not stated. |
| S13 | Transom pull-through | **Fixed** | Two 3/4" `transom-backer-*`, rear box starts 0.75" further forward. Bolts too short, see N5. |
| S14 | Stud length | **Fixed** | 3/8-16 x 3-1/2 with jam nut and threadlocker. |
| P1 | Cut-list correctness | **Partial** | Transom notes now say "glued up from two boards" but `rough` is still one 10.78" / 12" wide board. Prow still a block. Beams still unstated 12/4 vs laminate. Derived irrational sizes remain (1.778, 1.5905, 1.8161, 3.2384). |
| P2 | DXF details (bit-radius corners) | **Not fixed** | Web ends and stopped dados still square in the data. |
| P3 | Finish sequence | **Partial** | Epoxy-seal-first is in the notes; short-barrel tee-nuts adopted. No sequence list for the amine blush wash/scuff. |
| P4 | Printed parts | **Fixed** | Print orientation, ASA, perimeters and ribs are in the guard note. |
| P5 | Hardware verification list | **Partial** | Turntable and sleeve notes mention verification; no consolidated list. |
| P6 | Pinch/sharp edges | **Fixed** | Dome caps on the shaft, acorn nuts, `brake-clear` gaps. |

---

## 2. New findings

### MUST

**MUST-1. The nose and the cabin are two unconnected assemblies.**
- Evidence: a scan of every non-reference part's world bounding box finds **no part spanning x = 26.4**, the cabin/nose boundary (`xs`). Cabin chine, gunwale, web, rail, deck all end at x = 26.38; nose chine/gunwale/web/rail/deck start at 26.38. Cabin rails are at |y| 13.25-14.0, nose rails at |y| 6.25-7.0, so they do not meet. The cabin deck (z 8.53-9.0) and nose deck (z 9.53-10.0) are 0.53" apart vertically, so their edges do not touch either. There is no joint record between any cabin member and any nose member. `joist-nose` does not exist (the nose rail run is 9.6", less than the 10" joist spacing). The nose rails stop at x = 36.0 while the bolster-aft rail starts at 39.5, leaving 3.5" of 12 mm ply as the only link. The shoulder panel (x 26.14-26.375, |y| 7.0-13.375) touches the nose side at a line (nose side starts at x = 26.375) and the cabin side only by a fillet on a 0.236" edge. Everything forward of the shoulder, including the front axle and the rider's feet, hangs on nothing.
- Why a builder stalls: the frame and hull drawings produce two boxes and no way to join them. The first lift of the finished cart would show it.
- Fix:
  1. Add an oak `joist-shoulder`, 1.5" x 3" x full width, under the front edge of the cabin deck at x = xs-1.5..xs. Domino 5x30 into both cabin rails (same pattern as `joist-cabin-*`).
  2. Extend the nose rails back to bear against its front face (loose tenon or Domino 5x30 x2 each side) and step the deck edge over it. Add the deck-to-beam glue joint for both decks.
  3. Bridge the 3.5" nose-rail-to-bolster gap with a short spine piece or a rail end block, or state that the 12 mm deck carries it and prove it in the analysis.
  4. Give the cabin sides a front end: a 1.5" x 1.5" x 7" oak corner post at each cabin front corner, Domino-tied to the chine and gunwale, grooved for the shoulder panel; extend the shoulder panel to the web face (N2).
  5. Add `deck-nose`/`deck-cabin`/`joist-shoulder` joint records so the structural check and the cut list see it.
- Touches: `frame.ts`, `joinery.ts` (shoulder block and corner posts), `body.ts` (shoulder panel y-range), `layout.ts` (a `shoulderBeam` x range), `hull.test.ts`, `analysis/structure.ts` (rails model).

**MUST-2. The side-to-frame Dominos cannot be installed in the stated assembly order, and the deck has no clearance.**
- Evidence: joinery.ts:222 and every rail/chine/web note say the side assembly "slides inboard (Y) onto the deck edge ... and drops onto these Dominos". Those are mutually exclusive: a Domino protruding 0.39" from the rail top (or the chine bottom) blocks a Y slide, and the chine lip (0.25" over the deck edge, `deckCaptureDepthIn`) blocks a vertical drop because the deck top is flush with the rabbet top. Separately, the deck rabbet and the transom dado are exactly 0.472" for a 0.472" deck: two epoxy coats add 0.01-0.02" and 12 mm okoume runs 11.5-12.2 mm, so the sealed deck will not enter its own rabbet (the web groove got +0.04", the deck did not).
- Fix (pick one, owner decision O-3):
  - A. Build inverted: sides as bench-glued assemblies on a flat table, deck + frame unit lowered into them, Dominos engage vertically, transoms slide in X last. Needs a cradle for the sheer curve at the nose. Change the notes and `HULL_STEP` text from "slide inboard (Y)" to "lower the frame + deck unit".
  - B. Drop the Dominos and tie the chine to the rail with epoxy plus 316 #8 x 1-1/4 screws driven up through the rail after the sides are seated (counterbored, plugged), every 6". The chine bearing strip is only 0.375" wide, so predrill and keep to the center of the strip.
  - Either way, make the rabbet and the two deck dados `L.ply + grooveSlopIn` (0.51"), fill the gap with thickened epoxy, and say so.
- Touches: `joinery.ts:207-224` and 244-246, `body.ts:47-49` (both assembly notes), `build-utils.ts:30-48` (HULL_STEP comment), `frame.ts` notes, `body.ts` deck extrusions and dado size strings.

**MUST-3. The brake shaft bearings and the lever pivot do not fit the rail they bolt through.**
- Evidence (numbers from the dump): the shaft is at x = -8.0, z = 6.5. The cabin rail is x -9.25..26.38, z 5.53..8.53 (3" deep, 0.75" thick). Bearing bolts are specified "on a 2" square" (`brakeBearingBoltSpacingIn` 2.0, brake.ts:525) at 7/16" dia. That puts them at x = -9.0 and -7.0, z = 5.5 and 7.5:
  - x = -9.0 is **0.25" from the rail end** (hole radius 0.22): the rail end breaks out.
  - z = 5.5 is **0.03" below the rail bottom**: those two bolts miss the rail.
  - z = 7.5 is above the oak blocks (`brake-pivot-block` z 4.9-7.23; `brake-bearing-block-R` is 2.25" x 1.73", z 5.5-7.23), so two more miss the block.
  - The 3x3 plate in the F3 notes would not sit flush in a 1.73" block either.
  - The lever pivot is at x = -9.25 (`brakeLeverPivotBehindShaftIn` 1.25 behind the shaft): its bolt axis lies **on the rail's rear end face**, so "through the block and rail" is half a hole in empty air under the transom. The `at` coordinates in the joint records use a 0.625" square, which cannot enclose a 3/4" shaft and bushing, so they are placeholders and do not reflect the written pattern.
  - The same rail also takes a 1" shaft hole, three 5/16" pivot-block bolts (first at 0.375" from the end) and the rail-end tenon: a 0.75" rail with six holes in its last 3".
- Fix: re-lay out the mount as one detail. Concrete options: (a) lengthen `rearOverhangIn` by ~3" so there is rail behind the pivot (affects truck fit and mass), or (b) mount the bearings and pivot on a 4" x 4" x 3/4" oak bearing plate screwed/bolted to the outside of the rail band **and the end of the rear transom** with the rail end tenon moved, or (c) shrink the pattern to 1.25" square with 3/8" bolts, enlarge the block to 3" x 3.5" and raise `railDepthIn` to 3.5-4" (rail bottom stays above 3.5" clearance at 4.53"), and move the pivot ahead of the shaft. Re-run `brake-shaft` (the 2" spacing is what resists the overturning moment in the analysis; spacing change changes the result). Add the two 3" x 3" x 1/4" bearing plates as real `outsource` parts.
- Touches: `brake.ts` (block sizes, bolt pattern, `at`), `params.ts` (`brakeBearingBoltSpacingIn`, `brakeLeverPivotBehindShaftIn`, possibly `railDepthIn`/`rearOverhangIn`), `analysis/brake.ts`, `brake.test.ts`.

**MUST-4. The rear axle beam has no attachment to the frame.**
- Evidence: `beam-R` (x -1.25..1.25, y +/-16.13, z 4.38-6.88) has no joints (running-gear.ts builds none for it); the rail bottoms (z 5.53) hang 1.35" below the beam top (z 6.88), so the rails and beam occupy the same space. The only record of this is a whitelist in `model.test.ts:28` ("rails/girders are notched or drilled ... joinery is Phase 3"). Phase 3 never drew it. A 1.35" notch is 45% of a 3" rail, cut under the heaviest wheel load, and the rail bears on the beam only through a 0.75" x 2.5" patch. `clamp-R*` clamp the axle rod to the beam, not the beam to anything. Nothing resists rebound.
- Fix: draw the notch (2.5" wide + 1/16" each side, 1.35" deep, dado or router, in both rails) and give each side a hold-down: two 3/8" 316 bolts or a stainless strap over each rail through the beam end block, or a 3/4" oak cleat screwed to the rail face and into the beam end. Add `bolt`/`dado` joints to `beam-R` and the rails, and check bearing at the notch in `analysis/structure.ts`. Consider raising the beam into a 3" rail with a 1" notch by lowering `railDepthIn` only locally (a 1.5" pad at the beam).
- Touches: `running-gear.ts` (joints, notes), `frame.ts` or `joinery.ts` (rail notches), `model.test.ts:28`, `analysis/structure.ts`.

### SHOULD

**S1. Cabin side front end and shoulder panel (see MUST-1 step 4).** The shoulder y-range ends at `hwC` = 13.375, which is the chine inner face, but the web inner face is 0.195" further out (13.57). That leaves a 0.19" open slot between panel and web all the way up the corner, and the panel edge glues only to the 0.625" chine/gunwale faces. Extend the panel to the web face and let it into a stopped groove in the corner post. Files: `body.ts:651-665`.

**S2. Rear bolts are too short (hardware).** Handle sockets and quadrant bracket call for 1/4-20 x 1-1/2 carriage bolts (brake.ts:789, 933). The stack is 0.13" tube wall (or 0.25" angle) + 0.75" transom + 0.75" backer + fender washer + nut = about 1.95-2.15". Use 1/4-20 x 2-1/4. Also a carriage-bolt square neck will not seat in a round hole in a 0.13" aluminum wall: use a button-head cap screw with a nylock nut, or a round hole and a washer under the head. Files: `brake.ts:789, 933`.

**S3. Storage box has zero side clearance.** `storage-side-L/R` outer faces are at y = +/-13.38, the chine inner face is 13.375, and the chine runs from z 8.53 to 10.03. The box has to drop in from above with nothing to spare, and the box is permanently bonded to the deck. Make the box 1/8" narrower (`storage` hw - 0.06 each side) and fill with thickened epoxy, or scribe it. Files: `layout.ts` `StorageLayout.hw`, `storage.ts`.

**S4. Nose gunwale: short grain and no stated method for the underside groove.** The gunwale is bandsawn from a 4" board along a quadratic that reaches a 15.5 degree slope (`2*rise/length` = 0.28) at the bow, leaving short grain in a 1.5" x 0.625" section whose groove walls are 0.175". Cut from a flat-sawn board it will break at the bow. The "template-guided router after sawing" note does not say how: the groove opens on a curved edge, so use a router table with a slot cutter and bearing riding the curved edge (board lying flat, cutter height sets the groove position; run it, flip the board, run again to reach 0.276", since 1/4" cutters are the common size). Better: laminate the gunwale in three 1/2" horizontal layers (bends easily: R about 65" at the bow, R/t about 130) around a simple form, or at least specify rift-sawn stock with the curve sawn in the direction that keeps grain run-out under 1:8. Files: `body.ts:588-597` note, `fab` field.

**S5. Kingpin bolt cannot have the stated unthreaded shank.** `steering.ts:159` asks for a 3/4" grade 8 bolt x 6.5" with an unthreaded shank of at least 5.34". ASME B18.2.1 puts 1.75" of thread on a 3/4" bolt up to 6" and 2.0" above 6", so a 6.5" bolt has 4.5" of shank. The thread would sit in the carrier or the crossbar plate, which is what eng S-8 warned about. Spec a 3/4-10 x 8" grade 8 (shank 6.0") and cut to suit, or a ground clevis pin with a drilled end. Also resolve the sleeve fit (ID 0.750 for a bolt that can be 0.750": ream to 0.765, S8 round 1). Files: `steering.ts:155-165`.

**S6. Prow socket and bar details.** (a) Leg clearance is 0.015" per side in the socket (`PROW_SOCKET_CLEAR_IN`). An outdoor oak leg in snow swells 0.05-0.08" across 1.75"; use 1/16" per side and a chamfered lead-in. (b) The socket is a U-slot 4" deep and 1.78" wide through the full height: say "bandsaw both sides and clean up", not CNC pocket (a 4" deep pocket needs a very long bit). (c) The `prow` part should list strips, not the block: 8 x 1/8" x 2.00" x 25" (6 + 2 spares), plus the form as sheet MDF layers. Files: `body.ts` (PROW constants, prow part), `joinery.ts` prow section.

**S7. Push handle: post does not fit its socket, and the bar joint cannot be assembled.** `handle-post-L` is 1.0" x 1.5" (finished) but the `handle-socket` is 1.25 x 1.75 x 0.13" wall tube: ID 0.99" x 1.49". The post must be about 0.94" x 1.44" to be a slip fit that survives swelling. The post-to-bar joint says "3/8-16 x 3 carriage bolt, wing nut": the bar sits on top of the post, so the nut would be inside the aluminum socket. Either the bar and posts are permanent (glued 3/8" dowels or a bridle, handle comes off as one U) or the bolt goes through a cross-hole with a barrel nut. Also the bar is "turned stock or a dowel": no lathe, so spec a bought 1-1/4" oak dowel or a 1-1/4" square with a 5/8" roundover on both router-table passes. Files: `brake.ts` (`handleGeometry`, handle-post/bar notes), `params.ts`.

**S8. Lash-point plate pattern is not drawn and does not fit.** The plate is 1.5 x 0.9" centered on the 0.625" gunwale (y 13.69), the doubler sits inboard of it (y 12.63-13.38), and the note says the screws "straddle the glue line" at y = 13.38. With the web groove at y 13.55-13.83 directly under the plate and a screw that reaches z 14.85 against a groove top at 14.875, there is no layout of four #10 screws in 0.9" that stays in solid oak. Center the plate over gunwale + doubler (y about 13.3) or use a 1.375"-wide through-bolt pattern with a back plate. Files: `storage.ts:421-436`.

**S9. Brake shaft stock and drilling.** Sourcing says 36" lengths; the cut length is 38.09". Order 72" and cut. Cross-drilling a 28-32 HRC 4140 rod on a drill press needs cobalt bits, cutting fluid and a V-block clamp; say so. Confirm that a flange-mount, face-tapped 3/4" shaft collar of the stated size exists before any ordering (F3 listed this open). Files: `brake.ts:504`, sourcing strings.

**S10. Front stack step order.** `STEP.steering = 2` and `STEP.gear = 1` put the axle, beam, turntable and bolster before the deck (step 4) that the bolster is bolted through (D-33, 4 x 3/8" carriage bolts "through the nose deck"). Phase 4's steps must build the hull first, then attach the front sub-assembly from below (hull inverted works). Files: `build-utils.ts:26-48`, Phase 4.

**S11. Cushion and pad are "sewn in-house".** Marine vinyl needs a heavy walking-foot machine and bonded thread. Either spec a purchased marine seat cushion cut to size, or a no-sew staple-wrapped vinyl over a 1/4" ply base (mentioned as an option in the note). The back pad's #6 x 3/4 pan-head screws go through a 6 mm panel (0.236") and their tips poke 0.45" out the back: use #6 x 3/8 or Dual Lock. Files: `seat.ts:191, 242`.

**S12. Stop-block geometry needs a tolerance and a shim plan.** The four oak wedges (`stop-block-*`) are 1.778 x 1.816 x 3.238" (irrational) with faces that must land at exactly +/-lock; D-31 already says "shimmed so both close". Round the stock to 1/32", cut the wedges 1/16" proud, and write the fit procedure (lock the cart at full lock on each side, plane or shim each stop to the pads). Fix `stop-block` rough (+0.125 instead of +0.5). Files: `stops.ts`.

**S13. Missing bearing/spacer parts in the BOM.** Add `brake-bearing-plate-L/R` (3 x 3 x 1/4 A36, outsourced), rear clamps' stock/sourcing, and the formed-channel flat pattern for `steer-stop-L/R`. Add spacer washers behind the sign tee-nut screws (the sign sits on the chine/gunwale faces, 0.19" proud of the web, so tightening the screws dishes the 6 mm sign). Files: `brake.ts`, `running-gear.ts`, `steering.ts`, `body.ts` (sign).

### NICE

- **N1.** Chine end tenon is 3/16 x 1/4 x 3/8 (joinery.ts:98, `chineBand` leaves 0.45"): a locating pin, not a joint. Widen to 0.4" tall or add two 1/4" stainless dowels.
- **N2.** Chine Domino mortises sit in a 0.375" strip with 0.109" walls (rule is 0.1 here, 0.15 elsewhere, `TIE_WALL_MIN_IN`). Festool's minimum stock for 4 mm Dominos is about 10 mm (0.39"), so this is marginal.
- **N3.** Lid panel is called captured but its joint is a "1/4 deep x 1/4 rabbet" and the Domino (19 mm) plus a 1/4" groove in a 1.0" face leaves 0.75" for a 0.748" tenon. Say groove or rabbet, and show the Domino band.
- **N4.** Gunwale ends meet crowned transoms. Rear transom corners stand 1.28" above the gunwale, which is fine. Front transom corners start at the gunwale top (19.5") and the 0.75" radius leaves the gunwale's outer corner sticking out up to 0.75". Flush-trim the gunwale end to the transom outline with a template after glue-up, and round both together; the visual notes already flagged it but it is not in a part note.
- **N5.** Derived dimensions (1.778", 1.5905", 3.2384" and so on) should snap to 1/32" in the cut list; keep exact values for the CNC outline.
- **N6.** Transom `rough` should be two glued boards; give the glue-up size (2 x 5.5" x 28" boards) and the beam stock (12/4 or three 5/4 laminated, rift-sawn).
- **N7.** Round web end and dado corners (bit radius 1/8") or chisel square; P2 from round 1.
- **N8.** A tolerance table in the notes (hull square within 1/16", axle parallelism, toe-in, kingpin plumb) and a finishing sequence (seal, wash amine blush, scuff, fillet, varnish last).
- **N9.** Chine-to-bolster-end bearing has no joint (bolster-end rails sit under the nose chine x 41-50). Add an epoxy bed joint or screws.
- **N10.** Front U-bolts and rear clamps are zinc-plated; spec HDG or 316, and give bare A36 axles an epoxy barrier and grease.

---

## 3. Owner decisions

- **O-1. Turntable.** The 12" square bearing's mounting pattern and center hole are assumed (6.25"). Decision: buy and measure a sample before any plate is cut, or approve the carrier-plate approach on the stated assumption. Blocks ordering `kp-carrier`/`kp-under`/`kp-bar-plate`.
- **O-2. CNC availability.** Ten parts are `fab: cnc` (both decks, four webs, two transoms, prow socket, prow form). Decision: is there a CNC or Shaper Origin for the build? If not, each needs a bandsaw/router-template alternative recorded in the data.
- **O-3. Hull assembly method (MUST-2).** Inverted build with Dominos, or upright with screws instead of Dominos. Affects the fixtures list.
- **O-4. Nose-to-cabin connection (MUST-1).** A full-width shoulder beam plus corner posts, or a spine rail from the rear beam to the bolster. Affects mass (about +1-2 lb) and the structural check.
- **O-5. Brake mount (MUST-3).** Longer rear overhang (truck fit), larger oak plate with a re-spaced pattern, or deeper rails.
- **O-6. Cushions.** Purchased or sewn by a volunteer with a machine; or a no-sew wrap.
- **O-7. Push handle.** One glued U-shaped handle or a removable bar (S7).
- **O-8. Mass.** Empty mass is 161.6 lb against the D-21 expectation of 90-120 lb and a two-person transport lift of about 80 lb each. Not a build blocker, but the shoulder beam and any brake rework add weight.

---

## 4. Resolved or no action

- F4's open Domino-orientation question is moot: `DOMINOS` now carries the real face width (4x20 = 17 mm, 5x30 = 19 mm, 8x50 = 22 mm), and the F2 correction is the one the tool uses. Consolidate the F4 note in DECISIONS.
- Prow grain, lamination method and form are workable; the only data gap is the strip list (S6).
- Scupper count and hole position are correct; the footwell drains aft over the step.
- Finger-guard print size (5.2 x 5.7 x 3.0") fits a normal bed.
