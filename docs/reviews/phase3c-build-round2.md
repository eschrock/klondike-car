SCORE: 8/10

# Phase 3c buildability review, round 2

Reviewer stance and method as in round 1 (`docs/reviews/phase3c-build-round1.md`): experienced woodworker and fabricator, home shop with a Shaper Origin, no welding, catalog hardware. Evidence: a fresh dump of `buildModel(defaultParams())` (175 parts; scratch scripts in `/private/tmp/crit3c/`, not in the repo), world positions from the part transforms and extrusion outlines, `src/model/{body,layout,build-utils,running-gear,pivot,brake-layout,seat,handle}.ts`, `docs/phase3c-7-notes.md`, D-61/D-62. Nothing in the repo was edited and no git commands were run.

## Verdict

The fix round closed all five round-1 MUSTs in the model data, and closed M1 and M2 properly (they were the hard ones). The sandwich side is a real improvement: no grooves, strips in the cut list, the S-bend happens where the web is only about 5 in tall, and the sheer is edge-bent in a region where the plan is straight. The bridge clamp does what it should. No part needs welding or a machine shop.

The grade goes from 7 to **8/10**. Three new MUSTs remain, all small and local, and two of them are consequences of the fixes themselves (one is an error in my own round-1 advice):

1. **Seat-back latch geometry.** The upright pin hole is 1.5 in deep in a stop block that is 1.16 in thick at the pin, and the flat-position pin lands 0.5 in past the backer and on the edge of `joist-3`.
2. **Handle-socket access holes are 0.375 in, but the screw head is 0.44 in plus a washer.** The screws cannot be pushed in through them. Round 1 suggested 3/8; that was wrong.
3. **The deck has zero lateral clearance.** Its half-width equals the web's inner face, so a rigid 23.218 in deck has to drop between two webs spaced 23.218 in (plus or minus the jig error).

Plus a SHOULD that I would not skip: the glue-up of a web with four bands is a two-direction bend (sheer in the plane of the web, S across it), and the notes do not say how it is held. It is buildable, but the notes need the posture.

---

## 1. Verification of round-1 findings

| # | Finding | Status | Evidence in the model data |
|---|---|---|---|
| M1 | Grooved gunwale could not be made | **Fixed** | `side-L-gunwale` / `-in`, `side-L-chine` / `-in` are 0.234 x 1.5 strips (the inner chine strip 0.988 tall), `fab: bentlam`, grooves gone, `side-L-web` is one full-height 4 mm piece (14.35 x 59.1) with `shaper-origin`. Total thickness 2 x 0.234 + 0.157 = 0.625. Slope note now says 18.8 degrees at the transom (9.7 at mid-length). Rails are `bentlam`, 0.375 x 3 x 58.75, `plies: 2`. New issues below (S1, S2, S3). |
| M2 | Clamp plates did not touch the tube; 0.045 in oak sliver | **Fixed** | Beam top 5.325, tube centre z = 5.000, tube top 5.375, so the tube is 0.05 in proud (`axleProudIn`). `clamp-RL1` is 1/4 x 1.5 x 2.25 (front outer plates 1.75 wide), underside at 5.375 = on the tube. Two bolts at +/-0.75 in from the axis, 0.41 in holes: hole edge 0.545 in, groove wall 0.375 in, **0.17 in of oak** (was 0.045). 6 plates, 12 bolts. Notes give the shim-and-check step and "snug plus a quarter turn". Checked: bolt length 3-1/4 for 0.25 + 2.25 + washer + nylock. |
| M3 | Hinge folds the wrong way; screws too long | **Fixed on paper, still needs a hinge in hand** | `brake-knee-L` note: top beveled 6 degrees to the flap's applied slope (0.26 in higher at the front), so the hinge is flat when applied and folds up 2.76 degrees when released, never past flat. Screws are #10 x 3/4, 8 per leaf. Direction logic checked and correct. The bevel is not drawn and the note says "hold a real hinge to it". Check that the hinge has 8 holes per leaf (N1). |
| M4 | Screws into the 4 mm web | **Fixed** | `sign-backer-L1/L2` (0.5 x 1.5 x 2.78 oak, glued to the web inside, two #10-32 x 3/8 inserts each). `flag-block-top/bottom` joints are epoxy to `side-L-gunwale-in` / `side-L-chine-in`, screws go only into the tube. A join list scan shows no screw, knob, insert or bolt to any web except the sign knobs, which now land in the backers. New issues S4, S5. |
| M5 | Socket heads inside the bore; text conflict | **Half fixed** | Real inside 0.75 x 1.25, slip 1/32 in, relief groove 0.5 x 0.1875 down the post (13.5 in of it enters the socket parked, covers both head stations at 1.2 and 12.8 in from the bottom). Access hole is **0.375 in: too small, see R2-M2.** Sockets are 14 in, 3.7 in of post when riding, pin end distance 2.19 in, `validateParams` errors under 4 pin diameters. |
| S1 | Closing both ends at once | **Fixed** | `HULL_STEP`: dry-fit, measure transom dado to bulkhead dado, cut to that less 1/32, close the transom end first, bulkhead with a second batch. Dados give 1/4 in of float, tenons 3/8, bands butt with fillets, so a 1/32 trim works. Ordering nit: step 3 says "cut the rails" after step 2 glued the frame (S6). |
| S2 | Cut list shows blocks for bent parts | **Fixed** | Strips, `plies`, resaw and sled notes, 25% spares. Strip length issue S2 below. |
| S3 | Flag tube and sign hardware | **Fixed**, new points S4, S5 | |
| S4 | Seat-back pin | **Partly fixed** | 2-1/4 in usable, spring-detent pin with a 1/16 in groove, through hole in the backer. The geometry does not work: R2-M1. |
| S5 | Non-catalog sizes | **Fixed** | `king-thrust` 1/2 in, `roll-pad` 1/4 in, kingpin "5/8 x 6 stock length", `king-beam` 1.703 deep. Kingpin stack 4.45 in plus washers and nut = 5.3 in to the nut face, thread starts at 4.5 in on a 6 in bolt: engages. Bronze sleeve is "0.63 ID x 1 OD, verify the stock size" (5/8 ID bushings are normally 7/8 OD; keep it as a verify). Roll-pad note text is stale (S6). |
| S6 | Wheel bore, hub, DOM tube | **Open, gated** | Validator warns on the bore, A513 Type 5 DOM named in the sourcing, mill cert. Still a pre-order measurement. |
| S7 | Handlebow blank | **Fixed** | `handle-bar` stock 1.25 x 4.40 x 24, "5/4 x 6 board". |
| S8 | Thin transom | **Not addressed** | Dados still 1/4 deep in 1/2 in. NICE. |
| S9 | Lamp clip clearance | **Not addressed** | Still 4.46 x 1.21 in a 4.5 x 1.25 slot. |
| S10 | Stale text | **Mostly fixed** | HULL_STEP, gunwale, socket, box, lid batten fixed. More stale text found, S6. |
| S11 | CNC bed size | **Fixed** | `shaper-origin` on deck, webs, bulkhead, transom, grab boards, box panels, signs, flaps, seat back. |
| S12 | Hardware list | **Mostly** | `phase3c-7-notes.md` has "items for Eric to verify". |

---

## 2. Remaining MUSTs

**R2-M1. The seat-back latch geometry does not work, in either position.**
- Evidence (extrusion outlines and transforms from the dump):
  - **Upright.** `seat-wedge-L` outline is (7.046, 8) - (9.044, 8) - (7.464, 13.897) - (7.046, 13.897). The latch pin is at z = 11.124. The sloped back face is at x = 9.044 - (3.124 / 5.897) x 1.58 = 8.21 there, so the block is **1.16 in thick** (to the box end at x = 7.046), about 1.2 in along the pin axis. The pin note and `seat-wedge-L` joint now say "3/8 blind hole 1-1/2 in deep, with a 1/16 in groove at 1 in". The hole runs through the block and about 0.3 in into the box end (4 mm ply, `storage-end-fore`). The groove at 1.0 in leaves 0.2 in of oak behind it. The pin tip then sits in the box interior.
  - **Flat.** With `seat: 'stowed'`, `seat-pin-L` is at x = 12.50, y = 7.38. `seat-hinge-backer` is 3 in wide centred at x = 10.5, so it spans **9.0 to 12.0**. `joist-3` is at x = 12.786, 0.625 thick, so it spans 12.47 to 13.10. A 13/32 hole at 12.5 is 0.3 to 0.7 in beyond the backer and its far edge clips the joist by 0.23 in. The note says "through the deck and its backer"; it goes through the deck and into the gap or the joist.
  - The 1.97 in "stack" in the pin note is the old 3/4 in stile; the panel is now 0.472 in (stack 1.69 in), so the 2-1/4 in pin has room.
- Why a builder stalls: the first hole drilled in the deck for the flat pin hits the joist edge; the first blind hole in the stop block comes out in the box.
- Simplest fix: drop both pin stations to 2.0 in up the panel (flat x = 11.5, hole edge 0.3 in inside the backer end; upright hole in a block that is about 1.4 in thick there, 1 in deep with the detent groove at 0.6 in), and widen the backer to butt `joist-3` (3.47 in). Or drill the stop-block hole 1 in deep at a 15 degree angle from the box end. Either way set the hole depth from the wedge outline, not by hand.
- Touches: `seat.ts` (pin station height `seatBackLatchHeightIn`, backer width), `seat-pin`, `seat-wedge`, `seat-hinge-backer` notes and joints, `analysis/seat.ts` (pin tear-out lever).

**R2-M2. The socket access holes are too small for the screws they are for.**
- Evidence: `handle-socket-L` joint: "1/4-20 x 2 button-head cap screws, nylon washer under the head ... push them in through a 0.375 in ACCESS HOLE in the opposite (rear) wall". A 1/4-20 button head is 0.44 in across, the nylon washer 0.5 in. Neither passes a 0.375 in hole. The hex key (5/32) would. This is my own round-1 suggestion (3/8 in) and it was wrong.
- Fix: 5/8 in access holes (a plain 5/8 Forstner or step bit through a 0.13 in wall; leaves 0.43 in of wall each side on the 1.5 in face), or feed the screw down the open end of the bore and use the 3/8 hole only for the key. Plug the holes with 5/8 in button plugs after assembly so water and grit stay out. The post groove (0.5 in wide) already clears the head.
- Touches: `handle.ts` or `rear-mount.ts` (socket joint text, access hole), `handle-socket` note.

**R2-M3. The deck has no lateral clearance between the webs.**
- Evidence: `layout.ts:152` `deckEdge = min(deckCaptureDepthIn, sideBand)` = 0.234 and `body.ts:280` `hwAt = hwC + ddS - turn(x)`: deck half-width = 11.375 + 0.234 = 11.609 in, which is the web's inner face (web centre 11.6875 in, half thickness 0.0785 in). The deck (23.218 in wide) has to drop between two web faces that are 23.218 in apart. The 0.04 in `deckSlopIn` is vertical only (under the inner band). The old rabbet design had the same property; I did not catch it in round 1.
- Why a builder stalls: two bent 4 mm webs on a jig will not be within 0.03 in of the nominal spacing over 59 in with a 1.25 in S-bend at the bow; the deck sticks on the first dry fit, or the web is bowed to suit the deck.
- Fix: cut the deck 1/16 in narrower each side (23.09 in; it still tucks 0.17 in under the inner bands) and let thickened epoxy fill the gap; add a param (`deckSideSlopIn` 0.06). Re-check the deck width in the `HULL_STEP` doc and the Shaper pattern.
- Touches: `layout.ts` (`deckEdge`), `body.ts` (deck outline, notes), `params.ts` (new slop param), `foot-stop` row if it uses the deck/web contact.

---

## 3. New findings from the changes

### SHOULD

**S1. The sandwich glue-up posture is not described, and it is a two-direction bend.**
- What holds up: the S is only about 5 in tall (the web height at x = 35 to 49 is 5.1 down to 4.35 in), so the S-form is a short, low pair of cauls, not a 12 in wall. The sheer's edge-bend (radius about 170 in, 0.45% strain) is in the straight part of the plan (x < 35); the elevation slope is under 2 degrees where the S starts. So the two bends barely overlap, which is the good news.
- What is missing: a straight 1.5 x 0.234 strip edge-bent to the sheer wants to straighten. By beam theory (E 1.8 Mpsi, I = 0.066 in4, 2.5 in of sag over 60 in) that is about 65 lbf of lateral push at mid-span per band, and the epoxy has to hold it while it cures. The web's top edge does not guide the band because the web stops 1/8 in below the band top. Something must hold the bands to the sheer line: a row of cleats or screws into a sacrificial table, or a sheer-shaped caul.
- Recommended posture (write it into the notes): lay the web **flat** on the bench with the S-ramp form (1.25 in high, 14 in long) under the bow end, cleat the sheer line, glue and clamp one face's bands, let them cure, flip and do the other face on a mirror ramp. Two cures per side. Clamp count: the bands are 1.5 in tall, so C-clamps or spring clamps across the edge every 4 to 5 in, about 14 per band pair per face; use brads or a vacuum bag if short of clamps. Do the glue faces dry first, with the web already cut to the flat development, and bend-test a dry strip (the note says so).
- Touches: `HULL_STEP` and the band notes.

**S2. Strip lengths.** `side-L-gunwale` is 59.87 in finished, 60.37 rough; `side-L-chine` 58.75 / 59.25. The notes say "a 5 ft board makes it in one". A 5 ft board does not make a 60.4 in strip. Buy 6 ft or longer white oak, or scarf (the note allows staggered butts; say where they may go, away from the grab boards, lash doublers and the first 4 in behind the transom, and by how much to stagger).

**S3. Epoxy fill at the web top.** The web stops 1/8 in under the gunwale top and the 0.157 in slot between the two bands is "filled with thickened epoxy". A 60 in slot 0.157 wide and 1/8 deep sags and voids. Fit a 0.157 x 1/8 in oak spline (or a strip of the same ply) in the slot with epoxy, or run the web flush and edge-seal it. The spline is easier because the bands can be glued with it in place.

**S4. Sign standoff and knob length.** `sign-L` is at y = 12.0 to 12.157. The bands' outer faces are at 12.0 and the web's outer face is at 11.766, so the sign sits 0.234 in off the web, with nothing between. The knobs are 1 in long: sign 0.157 + web 0.157 = 0.31 in, leaving 0.69 in in a 0.5 in strip with a 3/8 in insert: the screw runs 0.19 in out of the back of the strip. Fix: 0.234 in spacers (nylon, or glue oak pads on the sign back, or recess the sign in the 0.234 panel between the bands) and 3/4 in knob screws. This is the old round-3 S13 problem.

**S5. Flag block and band.** `flag-block-bottom` is centred at z = 9.15, 1.5 tall, so it spans 8.4 to 9.9; the inner chine band tops out at 9.03, so about 0.9 in of the block is glued to the web, not the band. `flag-block-top` is on the inner gunwale band. Both are epoxy-only on a 0.234 strip over 4 mm ply. A knocked flag staff peels them. Add a second pair of epoxied pads, or make the lower block 1.0 in tall, or bridge it to the sign backer.

**S6. More stale or contradictory text.**
- `transom-rear` and `bow-bulkhead` notes still say "the chine and gunwale tenons", "rails, chine and gunwale end on it with Dominos", "THE TRANSOM GOES ON LAST ... in one glue-up (about 14 joints)". The chine and gunwale ends are now butt joints with a fillet; the glue-up is one end at a time.
- `roll-pad-L`: "rail bottom is 0.4 in above the beam top ... gap about 0.15 in (0.03 to 1/8 in)". The notes elsewhere say 0.35 and 0.10. 0.15 is outside the window.
- `doubler-lash-*` and `seat-grip-*` joints still say "to side-*-gunwale" (the outer band, which is on the wrong face), "the web groove is behind it" and "above the web groove". The inboard face is `side-*-gunwale-in`; there is no groove.
- `HULL_STEP` step 3: "cut the bands, webs and rails to that length", but the rails were glued into the frame unit in step 2. Either measure before gluing the frame unit or say "trim the rails' ends at the transom before gluing the frame".
- `seat-pin` note: "1.97 in of stack against 2-1/4 in" (now 1.69 in).
- `crest strip` (S7 below).
- `rail-L` note: "its edge enters the chine's rabbet" (there is no rabbet).

**S7. `seat-crest-strip` is 6.7 in long; the gap it fills is 13.5 in.** The extrusion is 6.7 deep, centred, from y = -3.35 to +3.35. The wedge blocks end at y = +/-6.75 (they span 6.75 to 8.0). The strip leaves 3.4 in of the crest line unsupported on each side. The panel note says "spans the 14.75 in between the blocks" and the notes say the strip is not optional. Fix the length in the model (13.5 in) or the note.

**S8. Seat-back inserts and screws.** Hinge screws "#10-32 x 1/2 flat-head into 3/8 in inserts" in a 0.472 in panel. A 3/8 in insert needs a hole about 0.4 to 0.45 in deep, leaving 0.03 to 0.07 in of back veneer; the screw also bottoms out in the hole (0.44 in under the leaf vs a 0.375 in insert). Use 3/8 in screws and a 7/16 in deep hole stopped with a drill stop, and put the bucket pull-out test on the first panel before the other inserts.

**S9. Grab-board outer head.** `seat-grip` bolts pass the 0.234 outer band, the web and the inner band, with a round carriage-bolt head on the 0.234 in outer band. The row's 0.82 washer bearing is on the inside. A 1/4 carriage head bearing on a 0.234 strip over 4 mm ply will pull through before the inside washer fails. Put a 1 in fender washer under the head too, or use a pan head with washer.

**S10. Lamp clip clearance (round 1 S9) is unchanged.** 0.02 in a side in a Shaper-cut, epoxy-sealed slot. Print at 0.04 to 0.05 in with 0.05 in ribs and print a 1 in test slice.

**S11. Wheel bore and hub (round 1 S6).** Still the pre-order gate. The new squash test for the tire is a good addition; do the wheel bore at the same time.

### NICE

- **N1.** Check the brake hinge has 8 holes per leaf (3 x 3 in, about 12 gauge; many have 4 to 6). If not, drill extra pilot holes between the factory ones.
- **N2.** 316 flat bar in 1.75 in width is uncommon; the outer plates can be 2.0 in, or 1.5 in with a 1/4 in shim strip. Check stock.
- **N3.** The relief groove and the access holes leave the socket looking drilled. Plug the access holes with black button plugs.
- **N4.** The butt-glued band ends and web dados are now the only tie between the gunwale and the transom or bulkhead (a 0.234 in strip takes no Domino). The `foot-stop` row counts the web dado; the gunwale ends carry no load by design. If the transom corners get knocked, a 1/4 in dowel up through the transom top into the gunwale end (drill through the band and the inner band, epoxy a stainless rod) is the repair; consider building it in.
- **N5.** The Domino mortises in the chine bottom (4 x 20, at y = 11.8045) straddle the web edge and the outer band: 0.117 in of band outside and 0.04 in of web inside the slot. They work as alignment pegs; the load is carried by the epoxy bed on a 0.391 in wide land (it was 0.375). Say that in the joint note so nobody trusts the Dominos with tension.
- **N6.** Shaper Origin: a 59 x 14 in web and a 23 x 59 in deck need ShaperTape over the sheet or a spoil board; the notes mention it. Give the pattern as a DXF/SVG with a tape-line layout and the reference mark.
- **N7.** The bridle rope (3/8 in nylon three-strand, bowline round the standing part through a 5/8 in bronze sleeve) is a good simplification: one strand, no shackle. The 1 in sleeve hole in a 1.75 in stem still leaves 3/8 in above and below; make a trial tongue.

---

## 4. What I checked and found fine

- Parts and cut list: the web (14.35 x 59.1) nests two to a 4 x 8 sheet with room to spare; the deck 23.22 x 59.25 leaves a 24.8 in strip for the seat back; sheets test covers all of them. Aircraft Spruce, Peachtree City, will-call is an owner decision, not a build issue.
- The inner chine band stops 0.512 in above the bottom (deck 0.472 + 0.04); the deck edge goes under it by 0.234 in with 0.04 in vertical clearance. That works as a rabbet with no routing (apart from R2-M3).
- Clamp bolts: 3/8 x 3-1/4 for a 0.25 plate + 2.25 beam; the groove is 0.70 deep; bolts are 0.75 in either side, 0.545 in hole edge from the tube axis.
- Brake: knee bevel and screws as described. Hinge direction logic correct.
- Handle: 14 in socket, 15.17 in post, pin 12.5 in above the socket bottom (1.5 in under the mouth), relief groove covers both head stations.
- Bridle: sleeve ID 0.63 vs a 3/8 in rope, easy ends, working-load row; nothing breaks before the rope except by a hair (the notes say so honestly).
- Seat back: 16 x 16 in, 12 mm, banded, bottom corners 1/2 in radius, hinge and pin stations 0.75 in from the edge; pin hole (13/32) 0.625 in from the edge (tear-out row 0.78).
- Overlap tests at the defaults are clean; mass 121.2 lb.

---

## 5. Owner decisions

- **O1.** Sandwich glue-up posture (S1): flat on a ramp form with two cures per side (recommended), or vacuum bag.
- **O2.** Seat-back pin height: 2.0 in with a wider backer (R2-M1), or keep 3.0 in and move the backer and joist.
- **O3.** Sign: spacers on a sign hung proud, or a recessed sign between the bands (it fits: the panel between the bands is 0.234 deep).
- **O4.** Box: still the 31-part gasketed box (O4 in round 1). Not decided.
- **O5.** Wheel: measure one before freezing hub and bore.
