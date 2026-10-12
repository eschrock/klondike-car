SCORE: 7/10

# Phase 3c buildability review, round 1

Reviewer stance: experienced woodworker and small-shop fabricator, home shop (table saw, bandsaw, router, drill press, Domino, a CNC for small parts, hand tools). No welding, no custom steel unless truly needed, hardware from McMaster, hardware stores and Tractor Supply. Evidence: a dump of `buildModel(defaultParams())` (177 parts incl. 11 reference/payload; scratch scripts in `/private/tmp/crit3c/`, not in the repo), world positions from the part transforms, `src/model/{frame,running-gear,pivot,brake-layout,build-utils,joinery,rear-mount,body,handle,seat,storage,lighting}.ts`, `src/params.ts`, DECISIONS D-53..D-60, the four phase 3c notes (`3c-4a`, `3c-4b`, `3c-5`, `3c-6`) and `docs/reviews/phase3-build-round3.md` for style. Nothing in the repo was edited.

## Verdict

This is a much more buildable sled than the round-3 one (6/10). The welded kingpin carrier, the steel stop stands, the S-curve scarfs, the shoulder beam and the three weldments are all gone. What is left is wood, ply, stock tube and catalog hardware, and almost every part has a source, a fab method and a joint. A competent hobby woodworker can see how most of it goes together.

It is a 7, not an 8, because five things would stop or mislead a builder, and four of them are only visible when you do the geometry by hand:

1. The curved sides (gunwale, web, grooves) are described by a process that cannot be carried out in the order written, wastes about 85% of a 12-inch-wide bent blank, and gives the gunwale 19 degrees of cross-grain at the transom.
2. The axle clamp plates, as drawn, never touch the axle tube (0.075 in gap), and their bolt holes leave a 0.045 in sliver of oak next to the groove. This is on all 12 plates, front and rear.
3. The step-brake hinge is top-mounted but must fold downward, which a butt hinge cannot do.
4. After the move to a 4 mm web, two joints put screws into the web (flag block, sign tee-nuts).
5. The handle sockets are specified with their screw heads inside the tube the post slides in.

All five are small to moderate fixes. With the MUSTs closed this is an 8. Below, the seven areas you named are answered in section 1, then the findings.

---

## 1. Answers by area

### 1. Curved sides, forms, grooves, scarfs, assembly order

What the data says (`side-L-chine`, `side-L-gunwale`, `side-L-web`, `rail-L`, `HULL_STEP` in `build-utils.ts`):

- Plan turn-in: smoothstep from x = 35 to 49, 1.25 in a side. Max curvature at the start, radius 26 in. Two 5/16 plies per member: R/t = 83 per ply, comfortable for dry white oak. Stress in a finished 5/8 in solid band forced to the same S would be about 21 ksi (E 1.8 Mpsi), above its bending strength, so the lamination must be bent in the glue-up. Correct as specified.
- Chine: 0.625 x 1.5 in, two plies, groove 0.197 x 0.375 in on top, rabbet 0.25 x 0.512 in underside. The groove can be run on a router table by flexing the stick straight against the fence (the groove stays a constant distance from the member's own face). Fine, though the note should say that, because "straight cut, fence" on an S-curved stick reads as a mistake.
- Gunwale: a 1.5 in band whose top is the concave sheer, "bent-laminated 2 x 5/16 plies, 12.0 in wide, bent flat on the plan form together with the chine, epoxied, then the sheer line is bandsawn". Groove "plowed before the sheer is sawn". This is M1.
- Web: one 4 mm okoume sheet per side, cut to the flat development of the sheer, bent in plan. No scarfs and no lamination. The scarfs of round 3 are gone, and nothing here needs one if the oak is 5 ft or longer (59.25 in rough). Good.
- Rail: 3 in tall, two 3/8 plies, bent on the same form, step and notches cut after bending. Fine. Only the last 14 in is curved.
- Forms: one S-form is needed (a pair of 3/4 MDF cauls, S of 1.25 in over 14 in). It is a half-hour job, but the form is not drawn or exported anywhere (Phase 4).
- Assembly order is still valid (inverted jig, frame + deck unit lowered vertically, Dominos and deck edge engage vertically). Two things to fix: the closing of both ends (S1) and the `HULL_STEP` text, which still describes the retired S-curve, "scarfed to nose runs at xn", the shoulder beam and "front beam in rail notches" (S10).

### 2. Bow bulkhead, rear transom, deck, joists, rail notches

- `bow-bulkhead`: 1.5 in oak, 21.5 wide, crowned top (5.75 peak, 4.875 corners), 4.5 x 1.25 hand-hold, CNC or bandsaw + router template. One 8/4 board planed to 1.5 in makes it (stock 1.5 x 7.22 x 21.5, grain across). Easy. The hand-hold is 1.25 in tall: that is a one-glove-finger gap, not a mitten gap (N1). The printed `lamp-clip` plug has 0.02 in clearance a side in a CNC-cut oak slot that will be epoxy-sealed (S9).
- `transom-rear`: 1/2 in oak, 24 x 16.4, two boards glued. It carries a 4.5 x 1.25 lift slot, a full-width deck dado 1/4 deep x 0.512, web dados 1/4 deep, four 1/8 vent holes, six loose-tenon mortises, and (via 3/4 in glued backers) the handle sockets and the rear light. Retained thickness is 1/4 in at the dados. It works because the backers glue on first, but it is thin for that many cuts (S8).
- `deck`: 12 mm okoume, 23.25 x 59.25 with the bow turn-in, CNC or bandsaw. It fits a 4x8 sheet. See S11 for the CNC bed question.
- Joists: eight at 8.5 in, 5/8 x 1.75 in, 5x30 Domino each end, epoxy to the deck under weights or a bag. `joist-6` is 1.25 in for the chain anchors. Plain work. Ends of `king-beam` and `joist-8` have to be cut to the rail's turn-in angle (about 7 degrees at x = 44); nothing says so (N2).
- Rail notch for the rear beam: 2.38 in wide x 0.91 in up from the rail bottom (`frame.ts`), plus the hanger's 2.38 x 1.35 notch. Bandsaw and chisel on straight rail, fine.

### 3. Front axle

No welding and no custom steel anywhere. The pieces are an oak beam (2.25 x 2.5 x 31.97), two DOM tube stubs, clamp plates, a 5/8 grade-8 kingpin, a UHMW disc, two UHMW roll pads, an oak tongue with a bronze sleeve and shackle, and two check chains. That is a normal home-shop assembly. Problems found:

- Clamp plates do not clamp (M2).
- `king-thrust` is 9/16 in UHMW, which is not a catalog thickness (S5). `kingpin` is "5/8 x 4-7/8 grade 8", not a stocked length; the stack is 4.40 in plus washers plus nut (S5).
- The nut slot in `king-beam` is described in two places in two positions ("just above the thrust disc" vs "at the top of the king beam"). Nut access (a 15/16 in nylock in a 1 in x 0.75 in slot, from the front) is tight but possible with a thin wrench (S5).
- Running gaps rely on a 4-link tolerance chain: axle beam thickness, disc thickness, king beam depth, rail depth. The roll pad gap is 0.09 in against limits of 0.03 to 0.125 in. A 1/16 in change in the disc (5/8 UHMW instead of 9/16) takes it to 0.03 in (S5).
- Tongue (`bridle-tongue`): 1.75 in thick x 6 wide x 10.5 long from one 8/4 board. A 1 in sleeve hole across a 1.75 in deep stem leaves 3/8 in above and below. That is the intended weak link area and the analysis covers it, but plan on the first one being a trial piece (N3).
- Check chains: 3/16 chain, quick links, four 3/8 shoulder eye bolts. All catalog. Cut the chain 10.2 in and finish the length at the quick link during the lock test; the notes already say so.

### 4. Rear axle, wheels, brake, chock

- Rear axle: one 36.28 in length of 3/4 x 0.120 DOM tube in a groove across the beam, a 5/32 in cotter hole 3/8 in from each end, collar and cotter pin. Cutting and drilling are easy. Wall under the plates is 0.12 in; the ring-bending row covers it.
- Wheels: the 4.10/3.50-4 hand-truck wheel (Tractor Supply listing) has no bore or hub length in its listing. DOM tube OD is +/-0.005 in, not a bearing fit. Order one wheel and measure before ordering the lot (S6).
- Brake: hinge direction and screw length are M3. Everything else (flap, knee, backer, shoe, pad, bungee, tread, chock, cord) is cuttable. It is 14 distinct parts per side; Eric may want to build one side and ride-test it (owner decision O5).
- Knee: 2.5 x 8 x 5.5 in blank from 10/4 oak or two glued 5/4 boards. 12 in of knees are the only 10/4 oak besides the axle beams.

### 5. Seat back, box, engraving, grab boards, handlebow, flag tube, lash points, signs

- Seat back: stiles, rails, 6 mm panel in grooves, Domino 4x20. Easy. Latch pin spec is S4.
- Box: 4 mm okoume tape-and-fold, oak coaming, gasketed lid in an oak frame with battens, two draws, two drains, stay. Buildable, but 31 parts and a glass-tape box for "cushions, a lamp and two chocks". Needlessly complex (O4). Several notes still say 6 mm (S10).
- DO NOT STEP: a 0.03 in V-carve in a 4 mm lid. The face veneer is about 0.02 to 0.04 in, so the carve goes through it. Do it as a flat-bottom 0.03 in pocket with a 1/16 in bit, not a V-carve, then fill. Small CNC is enough (lid 14.6 x 18.75) (N4).
- Grab boards: 5/8 x 5.5 x 8 oak, CNC or router template, six 1/4 carriage bolts through the gunwale. Easy, but the gunwale is the weak member (M1) and the top bolt row is 0.4 in from the sloped top edge.
- Handlebow: S7 (blank width). Sockets: M5 and O3.
- Flag tube: S3 (bottom block screws into the 4 mm web).
- Lash points: six 316 D-ring plates on 1 in oak doublers, each doubler cut square to a different slope (11 to 17 degrees). Give the builder a table (N5).
- Signs: S3.

### 6. Cut list, hardware, finishing

See section 4 (cut list) and S11/S12 (hardware).

### 7. Grade

7/10. See the MUSTs.

---

## 2. Findings

### MUST

**M1. The gunwale and the side-panel groove cannot be made as described, and the sheer cuts across the grain by up to 19 degrees.**
- Evidence:
  - `side-L-gunwale` stock 0.625 x 11.5 x 58.75 (rough 0.75 x 11.625 x 59.25), "2 plies of 0.313, 12.0 in wide, bent flat on the plan form, then the sheer line is bandsawn". The finished piece is a 1.5 in band, so 87% of each 11.6 x 59 in blank is sawdust. In 4/4 that is roughly 11 bf of resawn oak per sheet-side to get 1.4 bf of gunwale, and an 11.6 in wide ply needs three or four boards edge-glued first.
  - The same note says the underside groove is "plowed before the sheer is sawn". The groove is in the bottom edge of the band, an edge that does not exist until the sheer is sawn. Plowing it first is not possible; plowing it after means a slot cutter on an edge that slopes up to 19 degrees in elevation and also has the S in plan. That is the "blow-out lottery" the round-3 review warned about. The chine groove, by contrast, is easy (flex the stick straight against the fence).
  - The groove is 0.197 wide for a 0.157 web: 0.02 in a side. The web is bent flat to the S, the gunwale and chine are laminated to the S with their own spring-back, and all three must seat over 59 in. Round-3 M2 already said this slop is too small for a curved member; nothing changed. With two coats of epoxy on the web it will bind.
  - The sheer slope: `sheerHeightAt` = 14 - 20u + 10u^2 (u = (x + 9.25)/58.55) gives 18.9 degrees at the transom, 16 at x = 0, 12.9 at x = 10, 9.7 at x = 20. The gunwale note says "9.7 degrees at the rear". That is the mid-length figure. Sawing a band out of a straight-grained blank at 19 degrees is a grain slope of about 1:3 on a 1.5 in tall, 5/8 in thick member. The Wood Handbook slope-of-grain table puts bending strength well under half of straight-grained at that slope, and the cut edge will split along the grain at the rear. This is the member that carries the transom corner, the flag tube blocks, the lash doublers and the grab bolts.
  - The viewer (3c-5, `grainFollowsTop`) draws the gunwale grain parallel to the sheer. The part as specified has grain at 19 degrees to the sheer at the back. The picture is not what the build gives.
- Why a builder stalls: the first thing a builder does with this part is laminate a 12-inch-tall, 59-inch-long blank on edge on a form, then discover the groove cannot be plowed in the order given.
- Simplest fix (changes the note, not the model): **laminate the side as a sandwich instead of grooving.** Cut each gunwale band (and the chine band) flat as an 1/4 in x 1.5 in strip following the flat development of the sheer (the web is already cut to that development). Glue one band on each face of the web along its top edge (and along its bottom edge for the chine), bending web and bands together on the S-form. Two 0.234 in bands plus a 4 mm web equals 0.625, the same total thickness. No groove, no 12 in wide blank, no routing a curved edge, no slop. The bands are short enough to cut from 5/4 stock in two or three pieces (stagger the butt joints between inner and outer bands). The rabbet for the deck edge falls out of making the inner chine band 0.512 in shorter. Edge-bending a 1.5 in strip to the sheer (radius about 170 in) is about 0.45% strain, well inside what dry oak takes. Keep a 1/8 in oak cap or thickened-epoxy fill on the top edge so no ply edge shows.
  - If Eric prefers to keep grooves: groove width to 0.25 in and fill with thickened epoxy (not a close fit); cut the gunwale groove after sawing the sheer on a router with a bearing-guided slot cutter; say 19 degrees at the rear; and drop the claim that the grain follows the sheer.
  - Either way, correct the note ("9.7 degrees at the rear" should read 18.9) and the viewer wording.
- Touches: `body.ts` (gunwale, chine, web notes and joints), `joinery.ts` groove strings, `build-utils.ts` `HULL_STEP`, `params.ts` (`grooveSlopIn`, `grooveDepthIn`, `railBandIn`), `viewer/partMesh.ts` (`grainFollowsTop`).

**M2. The axle clamp plates do not touch the axle tube, and their bolt holes break into the groove wall. All 12 plates, front and rear.**
- Evidence (`running-gear.ts` clamp loop, `pivot.ts` same; positions from the dump):
  - Tube radius 0.375, tube centre z = 5.000, so the tube top is 5.375. The groove is the full tube diameter (`structure.ts:136`, `groove = axleDiameterIn`), so the tube is flush with the beam top (5.375). The plates sit on the beam top: `clamp-RL1` z = 5.5, 1/4 thick, underside 5.375.
  - Plate: 0.8 in long (x), centred at x = +/-0.625 (tube radius + 0.25 gap), so the near edge is at x = +/-0.225 from the tube axis. The tube surface there is at z = 5 + sqrt(0.375^2 - 0.225^2) = 5.300. The plate underside is at 5.375. **Gap 0.075 in.** The note says "the plate edge presses the rod into its groove". It cannot, because the plate is above the tube and does not reach it.
  - Why it matters: the wheel's upward force is carried by the outer clamp station pushing the tube down and the inner one up (`analysis/front.ts:378`), and the lifting of the beam goes through the plate bolts. With a 0.075 in gap the tube lifts 0.075 in before any plate takes load: about 0.7 degrees of wheel droop on a 6 in station spacing, and a clunk on every bump. Tightening the nuts does nothing.
  - Bolt holes: 0.41 in holes at x = 0.625 have their edge at 0.42 in from the axis. The groove wall is at 0.375. **Oak wall 0.045 in** (about 1 mm) for 0.75 in of groove depth. It will tear out when drilled, and the tube then bears on a bolt shank instead of oak.
- Why a builder stalls: the builder drills the holes, lays the tube in, sets the plates, and has plates floating above the tube.
- Simplest fix: **one bridge plate per station with two bolts straddling the tube**, 1/4 x 1.5 x 2.0 in 316 flat bar, bolts at +/-0.75 in from the axis (hole edge 0.545 in, oak wall 0.17 in), and cut the groove 0.70 in deep (tube 0.05 in proud). The plate bears on the tube top on a line across its 1.5 in width and the bolts pull it down. Same bolt count as now, half the plates (6 instead of 12), and a groove depth is a router-bit setting. Use a thin shim (tape or a feeler stack) under the plate ends when you first tighten, and check the plate is not rocking on the tube.
  - Alternative off the shelf: 316 two-hole pipe/tube straps for 3/4 in OD tube (McMaster stocks these), 1/4 in bolts. Check the bolt tension row (`front-beam`, `axle-stress`) because the bolt drops from 3/8 to 1/4.
  - The ring-bending row (`analysis/axle.ts`) already assumes a line contact of the plate width, so it stays valid.
  - While you are there, say how to cut the groove: both front grooves in one router-table or router-sled setup with the beam on edge, because the groove straightness sets the wheel toe and camber.
- Touches: `running-gear.ts`, `pivot.ts`, `params.ts` (`clampLegGapIn`, `clampPlateLengthIn`, a new groove depth), sourcing text, `structure.ts:136` (groove depth term), `front.ts` (station geometry).

**M3. The step-brake hinge cannot fold the way the brake needs, and its screws are as long as the flap is thick.**
- Evidence: `brake-hinge-L` is "surface-mounted on the TOPS, pin axis on the line where the two top faces meet", the knee top is flat at z = 12.52, and the flap slopes down toward the foot (6 degrees applied, 3.2 released; `brake-layout.ts`, applied pose = hinge flat on the knee top, released pose rotated 2.76 degrees clockwise). A butt hinge on the tops folds closed when the flap goes UP. A flap that goes DOWN from the flat is opening past 180 degrees, which a standard butt hinge stops at. So the hinge is already bent 3 to 6 degrees past its stop at rest.
- `brake-flap-L` joint: "6 x #10 x 1 in 316 flat-head screws through the hinge's flap leaf into the flap top". The flap is 0.875 in thick, the leaf 0.1 in, so the screw runs 0.9 in into 0.875 in of oak and can break out the underside.
- Why a builder stalls: hold a hinge up to it. Stepping on the flap will either not move, or twist the hinge and shear the screws.
- Simplest fix: bevel the knee's hinge surface to the flap's applied slope (cut the knee top 6 to 9 degrees down toward the rear on the bandsaw; the knee is a bandsawn part already) so the hinge is partly folded at rest and reaches flat, not past it, when applied. Or mount the hinge leaves on the undersides (knuckle below). Use #10 x 3/4 screws in the flap. Check a real hinge before cutting the first knee.
- Touches: `brake-layout.ts` (knee top angle), `brake.ts` (knee outline, hinge placement), `brake-hinge-L/R` notes and joints, `brake-flap-L` joint, `analysis/brake.ts` (hinge pose).

**M4. Screws specified into the 4 mm web (D-60) cannot hold, and some come out the other side.**
- Evidence:
  - `flag-block-bottom` joint: "#10 x 1-1/4 stainless, through the block into the side, into the side panel with the epoxy bed" to `side-L-web` at z = 9.15. The block is 0.75 thick and the web 0.157. Half an inch of screw is in air, so the tip comes out of the web's outer face at the chine line. Oak and ply are both unsuitable (4 mm ply holds nothing).
  - `side-L-web` joint list: 4 x "#10-32 short-barrel tee-nut, epoxied in the 4 mm web, prongs on the inside face" for `sign-L`; `sign-L` hangs on "#10-32 x 1 thumb-knob screws". A tee-nut in 0.157 in ply is a barrel with 0.1 in of bite, and a 1 in screw leaves about 0.5 in of thread sticking into the cabin beside the box (the gutter, and the tube blocks when the sign is on the left).
- Why a builder stalls: the first block pulls out when the flag is knocked.
- Simplest fix: glue a 3/4 in oak strip on the inside of the web where the sign is hung (two strips, 5 in long, between the gunwale and chine), and put threaded inserts or short through-bolts in them; the sign gets 3/4 in knobs. For the flag tube, move the bottom block's screws into the chine (z 7.5 to 9.0 is chine, not web) or glue the block with epoxy only and screw the tube to it. Search the joint list for any other `to: side-*-web` screw (only these two exist today).
- Touches: `lighting.ts` (flag blocks), `body.ts` (sign joint, web joints), sign notes.

**M5. The handle sockets are specified so the post cannot slide in them.**
- Evidence: `handle-socket-L` joint: "1/4-20 x 2 button-head cap screws (round holes), nylon washer under the head, fender washer + nylock nut inside the backer", grip "socket wall 0.13 + transom 0.5 + backer 0.75 = 1.38". Only the wall next to the transom is counted, so the screw heads are INSIDE the 0.74 x 1.24 bore, 0.14 in proud of the wall the post slides along. The post is 0.6875 x 1.1875, so it is 0.05 in smaller than the bore and cannot pass a 0.14 in head. There is also no access hole drilled in the other wall for the head and hex key.
- Text conflict: the socket note says "the 15/16 x 1-7/16 post is a slip fit in the 1.0 x 1.5 inside" (the old size, and the tube is 1.0 x 1.5 outside). The post note says "inside 0.75 x 1.25". The real inside is 1.0 - 2 x 0.13 = 0.74 x 1.24, a slip of 0.026 in a side on a post that the bow rides on at a lever of about 12 in.
- Why a builder stalls: you can get the screws in but the post will not go down, and you cannot install the screws from the open end of a 12 in tube.
- Simplest fix: drill a 3/8 in access hole in the outer wall opposite each screw (push the screw through it, head seats on the inside of the near wall, hex key through the same hole), then cut a 3/16 deep x 1/2 wide relief groove down the back of each post so it clears the heads. State the real inside dimensions and the slip. The same note must record that only about 1.7 in of post is in the socket when riding (see O3).
- Touches: `handle.ts` or `rear-mount.ts` (socket joint and notes), `handle-post` note.

### SHOULD

**S1. Closing the hull: the transom and the bow bulkhead both slide on in X in one glue-up, with about 28 joints and no slack.**
- Evidence: `transom-rear` note "slides in X onto the deck edge, both web ends, the chine and gunwale tenons and the rail tenons in one glue-up (about 14 joints)", and `bow-bulkhead` "goes on with the rear transom, last". The bulkhead has the same 12 or so joints (web dado, three loose tenons per side, deck dado, rail tenons). With both ends going on at once there is no side of the assembly that can float. The sides are "left long" (chine note) but nothing says to cut them to a measured length.
- Fix: say it plainly: dry-assemble the frame + deck unit and both side assemblies, measure the distance between the transom dado and the bulkhead dado, cut the chine, gunwale, web and rails to that minus 1/32, then rehearse. Close one end first (glue and clamp the transom end, let it kick), then bring in the bulkhead with the second batch of slow epoxy. Mix in two batches. A pair of pipe clamps along the length is needed.
- Touches: `build-utils.ts` `HULL_STEP`, part notes for `transom-rear`, `bow-bulkhead`.

**S2. Cut list lists blocks for bent laminations and a solid block for the rail.**
- Evidence: `side-L-chine` rough 0.75 x 1.625 x 59.25 (bentlam), `side-L-gunwale` rough 0.75 x 11.625 x 59.25 (bandsaw), `rail-L` rough 0.875 x 3.125 x 59.25 as a solid table-saw part although its note says two 3/8 plies. This is round-3 S4, still open. The cut list is the first place a volunteer looks.
- Fix: give strip dimensions, count, spares (add 25%), and a resaw/plane note (2 plies of 5/16 resawn from 4/4; rail plies 3/8 x 3.125 x 60; planing 3 in wide strips this thin needs a sled or a drum sander).

**S3. `flag-tube` and the sign hardware sit right on top of each other.** Check at the same time as M4: `flag-block-top` at x = -7.06, z = 20.7, tube x = -8.09, z 8.4 to 21.5; `sign-L` spans x -8.2 to 4.2 with tee-nuts at x = -6.2 and 2.25. The inside-thread poke from M4 is at x = -6.2, 1.1 in from the tube. Tell the builder to hang the sign at x >= -5.5 or drop the left sign's rearmost knob.

**S4. Seat-back latch pin: the ball-lock pin does not retain in a blind hole and is too short for the flat position.**
- Evidence: `seat-pin-L` "3/8 ball-lock, 1-3/4 usable length"; upright, it goes through the 3/4 stile "and 1 in into the stop block", a blind hole (`seat-wedge-L` joint: "3/8 blind hole 1 in deep"). Ball-lock pins retain when the balls clear the far side of a through hole. In a blind hole they only press the wall. Flat, it goes "down through the stile into the deck and its backer": 0.75 + 0.472 + 0.75 = 1.97 in against 1.75 in usable.
- Fix: through-hole the stop block and use a pin with a retainer on the far side, or a spring detent pin with a groove in the stop block, or a barrel bolt on the back of the stile. For the flat position use a 2-1/4 in usable length and a through-hole in the backer (balls clear below the backer). Keep the lanyard.
- Touches: `seat.ts` (pin and wedge joints), sourcing text.

**S5. Front-pivot dimensions that are not catalog sizes or that stack too tightly.**
- `king-thrust`: 9/16 in UHMW. McMaster steps are 1/2 and 5/8. A 5/8 in disc takes the roll pad gap from 0.09 in to 0.03 in (limit 0.03 to 0.125). Fix: use 1/2 in plus a 1/16 in shim, or plane the king beam 1/16 in shallower (1.59 to 1.53), and make the 3/16 in "steer-clear" and the 1/8 in in the `king-beam` note agree (the disc note says 0.31 in, the beam note 1/8 in, 3c-4a says 3/16 in).
- `kingpin`: "5/8 grade 8 hex bolt x 4-7/8". Stack = 2.25 beam + 0.5625 disc + 1.59 king beam = 4.40 in, plus head washer, nut washer, nut = about 5.2 in to the bolt tip. Order 5 in and cut with a cut-off wheel (grade 8 is hard, a cut-off wheel and a file, not a hacksaw), or move the nut into the slot and shorten the stack. The nut position is stated two ways in the model (slot "just above the disc" in `king-beam`, "at the top of the king beam" in `kingpin`).
- `bridle-sleeve`: "0.56 ID x 1 OD x 1.5 long" oil-bronze sleeve. 9/16 ID bushings are normally 3/4 or 13/16 OD. Confirm a stocked part before drilling a 1 in hole in the tongue.

**S6. Wheel and tube fit.**
- The Tractor Supply listing gives rating and weight but not bore or hub length. DOM OD is +/-0.005 in, which is not a bearing fit. Order one wheel, measure the bore, weigh it, and decide between a bushing, ground shafting, or a tube with a precision-sized sleeve before ordering the lot. The hub length also sets the clamp station positions on the front beam (D-60 notes 0.7 in).
- The DOM tube rusts inside (the notes say so); specify the oil or paint and the end caps in the build list, not only in the part note.

**S7. Handlebow blank width.** `handle-bar` says "ONE 5/4 white-oak board, 3.0 in wide, about 3 ft long". The part is 2.96 in wide with a crown of 0.88 in and ends 0.57 in below the post-top level, so the blank has to be at least 2.96 + 1.45 = 4.4 in wide (a 5/4 x 6 board, 5-1/4 in finished). The offcut is not the sign blank any more (signs are ply). Pick straight-grained stock; the note already gives the grain slopes (11 to 14 degrees).

**S8. Rear transom is thin for what it carries.** 1/2 in with a full-width 1/4 in deck dado, web dados 1/4 deep, six mortises and four vent holes: 1/4 in left at the dados. The sockets and light are on 3/4 in backers, so it works, but make the deck and web dados 3/16 deep (the tenons can still be 3/8 total) and glue the backers on first, as the note says. If the transom splits along the deck dado (grain runs along it), the repair is awkward.

**S9. Lamp clip clearance.** `lamp-clip` is 4.46 x 1.21 in in a 4.5 x 1.25 slot (0.02 in a side) with 0.04 in detent ribs. The slot is CNC- or router-cut in oak that is then epoxy-sealed (0.01 to 0.02 in a side) and moves seasonally. Print the clip at 0.04 to 0.05 in clearance and 0.05 in ribs, and print a 1 in test slice first.

**S10. Stale build text.** A builder reading the notes will hit these:
- `HULL_STEP` (`build-utils.ts:44-59`): "plan S-curve", "scarfed to their nose runs at x = xn", "front beam sits in its rail notches and is held down by the angles", "shoulder". None of that is in the sled any more. The real order should be: forms, laminate (M1), side assemblies, fit check, frame + deck unit, inverted assembly, close the ends (S1), then the front pivot and axles.
- Storage box walls: "6 mm ply is too thin for a spline" (the walls are 4 mm); `storage-lid-batten`: "so it can take a foot" (the lid is DO NOT STEP).
- `handle-socket`: M5. `side-L-gunwale`: M1 (9.7 degrees, 12.0 in wide).
- `brake-shoe`: "bandsawn from 2 in white oak" but stock shows a 3.125 in thick rough; clarify which face is 3 in.
- `transom-rear` note says "0.75 in of oak above the lift slot" but 1/2 in is the transom.
- Derived dimensions print as 1.5905, 4.583034, 7.9949, 19.8925. A cut list should round up to 1/16 and say so.

**S11. CNC bed size decides how the long parts are cut.** The deck (23 x 59 in), the two webs (12 x 59 in) and the web "flat development" are marked `cnc`. Most hobby CNCs cannot hold a 59 in part. If Eric's machine is 2 x 4 ft or smaller (O7), say "bandsaw/jigsaw to a plywood pattern, flush-trim with a router" for those three and keep the CNC for the bulkhead, transom, grab boards, hand-holds, lamp slot and lid lettering. The Phase 4 export should give a DXF for each pattern plus the S-form.

**S12. Hardware to confirm before ordering.** The notes mark most as "verify"; collect them in one list: wheel (bore, hub, rating), 5/8 grade 8 bolt length, 9/16 UHMW, the bronze sleeve, 3/8 shoulder eye bolts (3-7/8 and 2-5/8 lengths) with the 900 lb rating, 3/16 chain rating, 316 3 x 3 in 12-gauge hinge, 1.5 x 1.5 x 1/8 316 angle, 4-hole 316 D-ring plates, 3/8 ball-lock pin lengths (S4), tube straps (M2).

### NICE

- **N1.** The bulkhead hand-hold is 1.25 in tall: fine for one gloved finger row, tight for mittens. Cut a cardboard mock-up and try it with the troop's winter mitts before the CNC pass.
- **N2.** Say that the king beam and `joist-8` ends are cut to the rail turn-in angle (about 7 degrees at the king beam).
- **N3.** The tongue's 1 in sleeve hole across a 1.75 in stem leaves 3/8 in above and below. Cut a trial tongue and look at it; if it looks flimsy, a 2 in stem costs 0.4 lb.
- **N4.** DO NOT STEP: a flat-bottom 0.03 in pocket with a 1/16 in bit, not a V-carve (a V-carve to 0.03 in leaves lines 0.035 in wide). Seal the lid with epoxy first, carve, then fill black.
- **N5.** Give the builder a table of the six lash doubler slopes (11 to 17 degrees) so each is cut once.
- **N6.** The 4 mm web is 12 in tall and 59 in long and held only at its edges. It will drum and flex. The sign strips and grab bolts help; expect to add one vertical oak stiffener at the seat back if it feels loose.
- **N7.** Epoxy to epoxy: the web, grooves and rabbets are sealed before assembly (step 0). Say to sand or wash the amine blush off the glue faces.
- **N8.** The `seat-back-panel` is 6 mm while everything else is 4 mm. That is a third plywood purchase for one 14 in panel; laminating two 4 mm sheets or buying a 2 x 4 ft piece is the cheap answer.
- **N9.** The first side-L can be the test: bend-test a dry strip on the form before the real glue-up, and order 25% spare strips.
- **N10.** Flipping the finished hull with axles and wheels weighs about 100 lb: say four people and padded horses, and that the stop and chain fit is done inverted (the king pivot turns freely without the kingpin).

---

## 3. Assembly order check (inverted build)

Still valid with M1 and S1 fixed.

1. Seal all grooves, rabbets, dados, ply faces and edges (including the bores of any new holes).
2. Frame (rails, joists, king beam) + deck as a unit, glued under weights, upright on the bench; Domino mortises cut in the rail tops.
3. Side assemblies on the bench (web + bands, M1), vents drilled, S-form.
4. Side assemblies inverted in the jig; frame + deck unit turned over and lowered; Dominos (all vertical) and deck edges engage; screws through the rails (note: no length is given for the "screws up through the rail every other Domino"; they run through 3 in of rail plus the chine land, which is a 3-1/2 to 4 in #10, a length that is hard to find in 316; confirm a source, or drop them in favor of the epoxy bed and the Dominos).
5. Close the ends (S1).
6. Still inverted: front axle beam, kingpin, tongue stays off; rear beam with hanger angles; axles and wheels.
7. Turn upright: tongue, chains, brake, box, seat, signs, lights.

---

## 4. Cut list and stock sanity

| Item | Count | Rough | Note |
|---|---|---|---|
| Oak 4/4 (net) | about 22 bf | rails, joists, hangers, backers, seat frame, box trim, flap, grab boards, signs banding | add 40% waste |
| Oak 5/4 | about 1.7 bf | handlebow (needs a 6 in wide board, S7), handle posts | |
| Oak 6/4 | about 3.2 bf | transom backers, hinge backers | |
| Oak 8/4 | about 1.8 bf | bow bulkhead (planed to 1.5 in), tongue | |
| Oak 10/4 | about 5.0 bf | two brake knees (or glue two 5/4), both axle beams (12/4 planed to 2.25 in is usual) | |
| Gunwale blanks | 2 | 0.75 x 11.6 x 59.25 each | M1: about 11 bf of 4/4 in, 1.4 bf out; gone if sandwiched |
| Okoume 12 mm | 1 sheet | deck 23.25 x 59.25 | |
| Okoume 4 mm | 1 sheet | 2 webs 12.2 x 59, box (4 pieces), lid, signs | nest the webs along the 8 ft side |
| Okoume 6 mm | 14.25 in square | seat back | N8 |
| Epoxy | | | slow hardener, two batches at the close (S1) |

Grain is stated per part (`grain` in the dump) and is right on every part I checked except the gunwale (M1). Rough sizes come from `roughOf` (+1/8 in thickness and width, +1/2 in length) and are sensible. The two oak sizes that are wrong are the gunwale blank and the handlebow width (S7).

---

## 5. Hardware availability

Available as listed (from the vendor strings): 6061 1 x 1.5 x 0.13 tube, 3/16 chain and quick links, 1/2 braided rope, 1/2 bow shackle, 316 flat bar and angle, 316 butt hinges, EPDM gasket, draw latches, friction stay, DOM tube, UHMW sheet, rubber sheet, neoprene, PVC 1 in pipe, bungee, screw eyes, heat-set inserts, D-ring plates. Confirm the items in S12. Nothing needs welding or a machine shop. The one near-miss is the clamp plates, which are 1/4 x 1.5 in 316 flat bar cut to 0.8 in on the bandsaw (a metal blade and a drill press are enough); M2 reduces them to six plates.

## 6. Finishing access

Good. Everything is open from below until the end; the closed volumes (transom/bulkhead dados) are sealed at step 0 and vented; the box is open to the deck. Two additions: the inside of the gunwale/web sandwich (M1) is easier to coat than the grooved version; the hollow axle gets the oil/paint and end caps before it goes into the groove.

---

## 7. Owner decisions

- **O1. Side construction (M1):** sandwich the 4 mm web between bands (recommended), or keep grooves and widen them to 1/4 in with an epoxy fill.
- **O2. Axle clamp (M2):** bridge plate with two bolts (recommended) or an off-the-shelf 316 tube strap.
- **O3. Handle parked position:** a 12 in socket leaves 1.7 in of post when riding and 0.026 in of slip a side. Options: 14 in sockets (3.7 in insertion, +0.2 lb), 16 in (5.7 in, +0.7 lb each, the 3c-4b size), or park the handle by removing it and laying it on the box lid (the bow is 24 in, the lid 15 x 19.7). The play at the grip with 1.7 in of insertion is about 0.4 in; it is not a strength problem, it is a feel problem.
- **O4. Box:** keep the gasketed watertight box with two drains, or build a plain hinged ply box with a lip lid and no gasket or coaming. Same capacity, about 15 fewer parts.
- **O5. Brake:** build both flaps at once, or one side first and ride-test (the analysis says one foot holds 7.9 degrees against 15.9 with two).
- **O6. Seat-back ply:** 6 mm (separate purchase) or two 4 mm.
- **O7. CNC size:** what is the bed? It decides S11.
- **O8. Wheel:** buy and measure one wheel before the clamp stations and the hub length are frozen.

---

## 8. What I checked and found fine

- The inverted assembly principle, the loose-tenon sizes at the bulkhead and transom for hand work, the Domino sizes in the rails and joists (5x30 in a 3/4 in rail leaves a 0.16 in outer wall, acceptable), the rear hanger and beam hold-down, rail notches, the knee bolts and backers, check chains, tongue head bolts (6-1/4 in carriage bolts for 3 + 2.5 + washers), box hinges and backers, grab boards and their washers, lash plates, flag tube (apart from M4).
- No part needs welding. The only metal cutting is 316 flat bar and angle on a bandsaw, DOM tube with a chop saw, and one cut-to-length grade 8 bolt.
- The overlap tests (`model.test.ts`) have no unexplained clashes at the defaults.
- The 3c-6 weight package introduces no new buildability trouble beyond the 4 mm web screws (M4), the socket text (M5) and the short post insertion (O3).

## 9. Files touched by the fixes

`src/model/body.ts`, `src/model/joinery.ts`, `src/model/build-utils.ts`, `src/model/running-gear.ts`, `src/model/pivot.ts`, `src/model/brake-layout.ts`, `src/model/brake.ts`, `src/model/handle.ts` (or `rear-mount.ts`), `src/model/lighting.ts`, `src/model/seat.ts`, `src/model/storage.ts`, `src/params.ts`, `src/analysis/structure.ts` (groove depth term), `src/analysis/front.ts`, `src/analysis/brake.ts`, `src/viewer/partMesh.ts` (`grainFollowsTop`), `DECISIONS.md` (record O1 to O8).
