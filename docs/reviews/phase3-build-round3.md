SCORE: 6/10

# Phase 3 buildability review, round 3 (final)

Reviewer stance: experienced woodworker and small-shop fabricator, home shop (table saw, bandsaw, router, drill press, Domino, maybe a Shaper Origin or CNC; no lathe, mill or welder; steel plate and all welding outsourced). Evidence: a dump of `buildModel(defaultParams())` (229 parts, scratch scripts in `/private/tmp/crit3/`, not in the repo), world bounding boxes from the part transforms, sweep path radii recomputed from `rail-cabin-L` and the chine path, `src/model/{joinery,build-utils,frame,body,rear-mount,brake}.ts`, DECISIONS D-21..D-48, `docs/hull-curve-notes.md`, the three `phase3-r3-*` notes and both earlier reviews. `npx vitest run src/model` passes (9 files, 459 tests). Nothing in the repo was edited.

## Verdict

The round-2 structural gaps are closed, and closed properly. The nose and cabin are now one load path (shoulder beam, continuous bent members), the Dominos engage vertically in an inverted build, the deck rabbets have clearance, the rear beam is notched and held down with 316 angles, the brake bearings sit in outsourced plates bolted into solid wood with a doubler, and the old prow problem is gone because the prow is gone. Many round-2 SHOULDs are fixed with evidence below.

The grade stays at **6/10**, for a different reason than round 2. The S-curve moved the difficulty from "what holds this to that" to "can this be made". Four things stop a volunteer:

1. The side-to-frame Domino tie is specified at a size that does not fit either member, and two of the six per side sit on the 5.6" arcs.
2. The bent-lamination process is not engineered as a process. The S-curve needs a two-sided form, the web has to enter two curved 0.276" grooves with about 0.02" of slop, and the notes give two different (and both awkward) ways of cutting the grooves.
3. The three welded assemblies are not defined as things a fab shop can quote, and one of them (the kingpin carrier "C") is described as welded "with the beam as the jig".
4. The scarf at the end of the curve does not fit the parts it is drawn on (a 6" scarf on a 5.6" nose rail), and every long member is spliced at the same station.

Each is a bounded fix. With the four MUSTs closed this is a 7; with the SHOULDs it reaches 8.

---

## 1. Round-2 verification

### MUSTs

| # | Round-2 finding | Status | Evidence in the model data |
|---|---|---|---|
| M1 | Nose and cabin unconnected | **Fixed** | `shoulder-beam` (oak 1.5" x 12.5" x 2.75", x 28.88-30.38, z 6.78-9.53) with 5x30 Dominos x 2 per end into `rail-cabin-L/R` and glue to the nose-rail ends and both decks. Bent chine, gunwale, web and rail run continuously through the curve to xn = 30.375 and scarf into the nose runs. The rail inner face at the beam rear is 6.33" off the centerline against the beam's 6.25", a 0.08" wedge that epoxy fills (checked from the rail path). Remaining 3.5" rail-to-bolster gap is an owner/engineering item, unchanged from round 2. See new M4 for the scarf geometry. |
| M2 | Dominos cannot be installed in the stated order; no deck clearance | **Fixed in principle, new defect in the Domino size** | Inverted build is data: `HULL_STEP` doc (`build-utils.ts:44-59`), repeated in every hull part note; all Dominos vertical. `deckSlopIn` 0.04 gives rabbets/ledge/dados of 0.512" for the 0.472" deck (`deck-cabin`, `deck-nose`, `transom-*` joints). Domino size is wrong (new M1). Nose chine rabbet text says 1.512" (S2 below). |
| M3 | Brake bearing and lever pivot do not fit the rail | **Fixed** | `brake-bearing-plate-L/R` (0.1875" A36, outsource) at x -10.13..-3.74 (L) / -9.01..-3.74 (R), y 14.0-14.19. `rail-cabin-L` joint: 4 x 3/8" 316 bolts, first column 2.95" from the rail end and 1.01" from the shaft notch (x -8.69..-7.31, 1.53" high, open at the bottom). `brake-rail-doubler-L/R` 1.5" oak, x -7.2..-3.65, y 11.75-13.25, z 5.53-8.53: clear of the shaft (x -8.44..-7.56) by 0.36" and of `joist-cabin-1` (x -2.05..-1.3) by 1.6". Pivot post (`brake-lever-pin`, 3/4" x 1.85") is welded to the plate ear at x -9.25..-10.13, outside the rail and beside the transom end. Bolt lengths from stacks: handle sockets 1/4-20 x 2-1/4 button head, quadrant bracket 2-1/4 / 1-1/2. The doubler is installed from below at step 6 with the cart upright or on its side. |
| M4 | Rear axle beam not attached | **Fixed** | `beam-hold-down-L/R` (316 angle 1.5" x 1.5" x 3/16" x 2.25", upright leg on the rail inner face z 6.88-8.38, flat leg on the beam top) with 2 x 1/4" bolts through the rail and 2 x 1/4" x 3-1/4 down through the beam. `rail-cabin-L` carries the 2.63" x 1.35" notch joint with the beam. Angle ends (x +/-1.13) clear the straddling joists (x -2.05..-1.3 and 1.3..2.05) by 0.17". `clamp-R*` are now 316 flat bar with sourcing. |

### SHOULDs

| # | Round-2 finding | Status | Evidence |
|---|---|---|---|
| S1 | Cabin side front end, shoulder panel slot | **Fixed by design** | D-45 deleted the shoulder panel. The web is continuous (curved 2 x 3 mm cabin web scarfed to the straight nose web). |
| S2 | Rear bolts too short, carriage bolts in aluminum | **Fixed** | `handle-socket-L`: 1/4-20 x 2-1/4 button-head cap screws, round holes, grip 1.63". `brake-quadrant-bracket`: 2-1/4 where the backer is, 1-1/2 where it is not (`rear-mount.ts` computes from the stack). |
| S3 | Storage box zero side clearance | **Fixed** | `storage-side-L` outer face y 13.25 against chine inner face 13.375: 1/8" a side (`storageSideClearIn`). |
| S4 | Nose gunwale short grain, groove method | **Fixed for the nose, open for the cabin** | `side-nose-L-gunwale`: 3 flat 0.5" layers, groove plowed in the straight bottom layer (R/t 130). The cabin gunwale/chine groove is still routed after lamination, and the two notes disagree (new M2). |
| S5 | Kingpin bolt shank | **Fixed** | 3/4-10 x 6 grade 8, ASME thread 1.75", shank 4.25" vs 4.13" needed; sleeve bore reamed to 0.756" (`kingpinSleeveClearIn`). The cut-to-length of a grade 8 bolt is a shop operation not described (N4). |
| S6 | Prow socket and bar details | **Fixed by deletion** | No prow parts; D-45. |
| S7 | Push handle post/socket fit, bar joint | **Fixed** | `handle-post-L` 0.938" x 1.438" in a 1.25 x 1.75 x 0.13" tube (ID 0.99 x 1.49); bar is a bought 1-1/4" oak dowel pinned with 3/8" 316 rod; the handle lifts out as one U. Nit: `handle-bar` has `fab: table-saw` for a bought dowel (N7). |
| S8 | Lash plate pattern | **Fixed** | `doubler-lash-*` 1" x 1.5" x 2" oak glued to the gunwale inner face; plate centered on it; four #10 x 1-1/4 at +/-0.25" from the doubler centerline, tips 0.38" above its bottom. |
| S9 | Brake shaft stock and drilling | **Mostly fixed** | 72" of 7/8" 4140 ordered, 38.09" used; cobalt bits, V-block, 300 rpm, pecking. Face-tapped 7/8" flange collar still "confirm a stock item" (`brake-hub-L-in` sourcing). |
| S10 | Front stack step order | **Fixed** | `STEP`: frame 3, body 4.0-4.4, steering 4.5, gear 4.6, kingpin 4.9, seat/storage 5, brake 6. Matches the part `step` values in the dump. |
| S11 | Cushion sewn in-house, back-pad screws | **Not fixed** | `seat-cushion` and `seat-back-pad` sourcing still say "sewn in-house"; `seat-back-pad` joint is still 4 x #6 x 3/4 pan head into `seat-back-panel` (0.236" thick, tips stand 0.5" proud). |
| S12 | Stop blocks tolerance, fit plan | **Fixed** | Stock rounded up to 1/32" (1.78125 x 1.78125 x 3.125), rough +1/8" (1.906 x 1.906 x 3.25), face cut 1/16" proud, 0.003" feeler procedure and shim packs in the `stop-block-*` joint note. |
| S13 | Missing BOM parts, sign spacers | **Partial** | Bearing plates, clamps, hold-downs, shields are real parts with sourcing. `steer-stop-L/R` has no flat pattern, bend radius or brake-press note for a 3/8" U channel, and `sign-L/R` (y 14.0-14.24 over a web outer face at 13.81) still has no spacer washers for the 0.19" standoff. |

Other round-2 items that matter now: N1 (chine end tenons) is unchanged (front transom chine tenon is still 3/16 x 1/4 x 3/8, `transom-front` joints); R2 P1 (cut list lists blocks, not strips) is not fixed and now bites harder (S4); R2 P3/N8 (finish sequence, tolerance table, consolidated hardware verification list) are still open.

---

## 2. The curved hull as a build

### 2.1 What is there and what it needs

Per side, from the data: chine 5 plies of 1/8" (1.5" tall, 42.5" path), gunwale 5 plies, rail 6 plies (4" tall, 0.75" thick), cabin web 2 x 3 mm okoume (4.22" tall, 42.7"), plus the nose gunwale (3 x 0.5" layers, plowed groove) and the straight nose pieces. That is 16 strips of 1/8" oak per side plus 2 web sheets, 32 and 4 for the cart, before spares and scarf tails. The centerline radius is a constant 5.63-5.76" over about 6" of arc on each half of the S, peak heading 64 degrees (recomputed from the sweep paths), so about 12" of arc each way sits on the tightest radius. Inside radius is 5.25-5.4" on the chine/rail against a 40x limit of 5.0": R/t 42-43 on 1/8" white oak is at the edge of cold bending. The rail note prints "inside radius 5.0" vs 5.0" limit" (formula in `frame.ts:93`), while `hull-curve-notes.md` says 5.32": either way there is under 6% margin on the one member that is 4" wide and cannot be re-bent.

Needs that are not in the data: strip schedule, form drawings, clamping method, spring-back allowance, order of operations. See M2, S3, S4, S5, S6.

### 2.2 Specific questions

**Strips and board stock.** Rail strips are 4.125" x 1/8" x about 49" (cabin path 42.46" plus a straight scarf tail and trim); chine/gunwale strips 1.625" x 1/8" x about 48". Total about 5-6 bf of rift-sawn white oak after resaw kerf and planing, so the lumber is not the problem. The problem is that the cut list will print `rough` 0.875" x 4.125" x 42.96" for `rail-cabin-L` and `side-nose-L-gunwale` rough 0.75" x 4.125" x 21.875" (a 4"-wide board) when the real nose gunwale is three 0.5" x 0.625" strips. Planing a 4" wide 1/8" strip needs a sled or drum sander, not a lunchbox planer (chatter and snipe): say so.

**The forms.** The curve is an S: the first half is concave to one side, the second half to the other. A one-sided form cannot press a lamination around both halves, so it needs a two-part form (male and female cauls, or a slot form with wedges or a vacuum bag over a profile), cut as stacked MDF layers from the plan offsets. No form is in the data (inside radii of the chine face, web face and rail face differ by 0.19-0.31" so "one form for the chine and web" does not work without a spacer for the web). A Shaper Origin or router template cut from a DXF of the offsets is the easy route; a bandsaw and a sander with a 10:1 pattern also works. Needed: form DXFs with the three offset curves, the clamp spacing (every 3" for the 4" rail), and where the straight tails of the form go.

**Glue-up and clamping.** Epoxy with slow hardener is right. The rail is 6 plies x 4" x 49" and the chine/gunwale can be stacked in one pass, 10 strips with wax paper between. Pot-life budget: 6 plies of 4.125" x 49" needs about 250 mL of epoxy to wet, so mix in two batches and wet out the second half while the first batch is still open. Rehearse dry first.

**Spring-back.** For epoxy laminates of this thickness, expect about 3-5% of radius, i.e. the end of each 6" arc sits 0.1-0.2" off the form. The members that must match each other are the rail (laminated in step 2 but its Domino mortises are cut in step 1, see M4/S6), the chine (Domino mortises in its bottom) and the web (0.276" groove). Three different thicknesses (0.75, 0.625, 0.236") spring back by different amounts. The data has no allowance and no "fit to the finished neighbor" instruction.

**How the web groove is cut in a laminated curved chine and gunwale.** The notes say two different things: chine "route it with a template after the lamination"; cabin gunwale "bearing-guided slot cutter riding the plan form template". Both are cut on a bent 5/8" member with 0.175" walls, along a path of constant 5.6" radius, ending in a stopped dado. A 1/4" bit in a template-guided router on a curved edge is a skill job, and a hand-held slot cutter on a 5/8" edge is a blow-out lottery. Better: **lay the groove in during the lamination.** The plies are stacked across the member, so make two walls out of whole plies and shorten the middle plies by the groove depth (0.375"). Example: 7 plies of about 0.089" (3/32" resawn and sanded), plies 1-2 and 6-7 full height (walls 0.178", close to the present 0.175"), plies 3-5 stopped 0.375" short (groove 0.267" wide plus the gap you leave when you plane to 0.0893; target 0.28"). Same trick for the rail deck ledge (the two or three inner plies 1" shorter) and the nose deck rabbet. This also takes R/t from 42 to 60 on the same form, which fixes the bend margin at no cost. The nose gunwale already uses the same idea (groove plowed in the straight layer).

**How the curved web enters both grooves.** Today the web is laminated separately from two 3 mm sheets (0.236"), then offered to two separately laminated members with 0.276" grooves: total slop 0.04" including 0.02" of epoxy on a sealed web, over 43" of 5.6" S-curve and with three different spring-backs. It will bind, or you will find a 1/16" ridge at the first dry fit. Also the web is 4.222" tall against grooves 0.375" deep with a visible gap of 3.47": zero vertical slack, so a web 1/32" over size makes the chine and gunwale stand 1/32" proud of the web on both ends. Fix: laminate the web **in place** in the grooves. Hold the chine and gunwale on the form (gunwale on the top spacer), slide two loose 3 mm sheets in, wet the interface and the grooves, clamp: the two thin sheets conform to the grooves instead of being forced. Cut the web 1/16" short (4.16"). Then scarf-joint the nose web with a 1.9" scarf in the straight.

**The scarfs at the curve end.** Chine, gunwale, web, rail and the shoulder beam all meet at x = 30.375 (every scarf `at` is x = 30.375). All four long-grain members are spliced at one station, a hinge across the entire side, and the shoulder beam is directly behind it. The scarf lengths (chine and gunwale 5.0", rail 6.0", web 1.9") do not fit where the parts end: the cabin members end at xn and the nose members start at xn, so the tapered overlap would lie in the last 5-6" of the cabin curve (heading 0 at xn but heading 5-10 degrees at x = 28.5-29.1, R 6-9"), not in a straight run, and `rail-nose-L` is 5.62" long against a 6.0" scarf. Details in M4.

**Inverted assembly sequence.** The logic is sound: the frame and deck unit is turned over and lowered into two inverted side assemblies, every move is vertical, the transoms slide on in X last, and vents are provided. Problems: (1) the order of steps 1 and 2 in the doc is circular on paper: the frame unit (rails) is step 1 and "laminate the chine, gunwale and rails" is step 2 (S3). (2) A jig that holds two 64" long, 6.7" tall side assemblies (0.236" web) vertical at the right spacing, with the 2.5" sheer rise at the nose, is not defined (S5). (3) About 14 joints per transom must close at once, each with 0.04" or less of slop and with 1/16" of spring-back error, in 120-minute epoxy: "rehearse twice" is right, but also put the backers 1/16" off the sides (S1). (4) The tie Dominos are wrong (M1).

**Shoulder beam and deck step closure.** Works: beam z 6.78-9.53 sits between rails; its rear face is a 0.53" riser from the cabin deck top (9.0) to the nose deck top; cabin deck front edge banded and butted; nose deck on the beam top. One wording problem: the glue joint to the nose rail "scarf face" is a glancing contact at x = 30.38 (M4).

**Deck polygons and rabbet fit.** `deck-cabin` (46 vertices) and `deck-nose` (about 50) follow the rail and chine inner faces plus 0.25" capture. They need a CNC or Shaper Origin (no jigsaw route holds a 46-point S-curve outline). The capture depth gives a real tolerance of about +/-0.15" sideways, so the polygon does not need to be perfect, but there is a conflict about how much the rail ledge removes (M1) and the nose deck rabbet text on the nose chine says 1.512" tall (S2).

### 2.3 Welded and outsourced parts

Three weldments exist, each described across several part ids with different `fab` values:

| Weldment | Parts | Problem for a fab shop |
|---|---|---|
| Kingpin carrier "C" | `kp-carrier` (4" x 11.94" x 3/8"), `kp-ear-L/R` (1/4" x 0.75" x 2.5"), `kp-under` (2.5" x 11.94" x 3/16") | `kp-under` spans x 44.25-46.75 and the ears stand at x 46.88-47.63, so the "tab in the outline" for the ear weld is not in the stock size (2.5") and is 0.13" off the plate edge; `kp-carrier` ends at x 47.5 but the ear reaches 47.63. The note says weld "on the bench with the beam as the jig", which a shop will not do (oak beam, welding sparks, epoxy). If the C is welded rigid the gap must equal the beam height (2.50") +/- 0.01 and the beam must be planed to match; the bolts then cannot "clamp the beam" with preload because the plates cannot close on it. No weld symbols, no gap, no tolerance on parallelism, no fixture spacer. |
| Steering stop stand (x2) | `steer-stop-L` (formed 3/8" channel, outsource), `steer-stop-riser-L` (5/16" x 0.5" x 1.25", a 0.31" sawn bar piece, `drill-tap`), `steer-stop-arm-L` (1/4" x 1.87" x 2.09", `drill-tap`), 2 urethane pads | Three parts, three fab modes; the joint note says "weld the dog to the stand on the bench" but the shop has no welder. A 5/16" long sawn riser is not a handleable part. No weld size for the arm joint beyond "1/4" E70 all around". No flat pattern/bend radius for the 3/8" channel. |
| Lever pivot (x1) | `brake-bearing-plate-L` + `brake-lever-pin` 3/4" x 1.85" | Reasonably clear: fillet size and finish given. But sourcing says "hot-dip galvanize or zinc-rich primer", and the plate has a 1.13" bore reamed to a press fit and 0.41" holes: galvanizing closes the bore by about 0.005-0.01", and a post welded to a 3/16" plate distorts when galvanized. |

Finish for all outsourced steel: "hot-dip galvanize OR zinc-rich primer + paint" is two different processes with different thread/bore effects (tapped 5/16" and 3/8-16 threads in `kp-carrier`, press-fit bearing bore). Pick one, and say what is chased/reamed after.

### 2.4 Rear mounts

Good. Notches (shaft 1.38" x 1.53" open at the bottom; beam seat 2.63" x 1.35") are cuttable with a bandsaw and a chisel; 2.65" of rail is left over the beam seat; the shaft notch leaves 2.47" of rail. Bearing plates and doubler keep every bolt in solid oak with edge distance (2.95" = 7.9D). The doubler is glued from below after the deck is on. Residual points: the notch ceilings and walls need 1/4" radius relief and an epoxy coat (the rail is a bent lamination, so a rear-end rail crack at the notch corner will run along a glue line); `brake-rail-doubler` rough is 1.625 x 3.125 x 4.05; the rail drilling for the plate (4 x 0.41" through 0.75" rail + 1.5" doubler = 2.25" deep) must be done with the doubler clamped in place, the notes say so. Backer clearance is a defect (S1).

### 2.5 Curved ASA finger guard

One printed ASA piece per side, 3.6" long, x 27.8-31.4, hood 1.5" wide at z 13.75, leg 0.125" in the 0.19" web recess, 3 inserts into the cabin gunwale and 1 into the nose gunwale. Prints hood down on any bed, no supports, 4+ perimeters. Fine as a build. Two nits: the inserts at x 29.25 and 30.13 and the one at 31.0 sit in the scarf glue zone of the gunwale (N3); and the part is a mesh, so Phase 4 must export an STL (there is no STL export in `src/`).

### 2.6 Step order

Step values (`Part.step`): frame 3 → deck 4.0 → sides 4.2 → shoulder 4.3 → transoms 4.4 → steering 4.5 → gear 4.6 → kingpin 4.9 → seat/storage 5 → brake 6 → finish 7. Consistent with the doc strings, except the circular step 1/2 text. The hull is flipped twice (inverted for the front stack and axles, then upright for the kingpin). With axles, wheels, beam, turntable and bolster on, the flipped hull weighs well over 100 lb: say how it is flipped (4 people, padded horses) and note that the stop-block fit (step 4.5) needs the turntable to turn, which it can on the ball ring without the pin (kingpin is at 4.9), but with the hull inverted.

---

## 3. Findings

### MUST

**M1. The chine-to-rail Domino tie cannot be cut as specified, and the spec for the rail ledge contradicts itself.**
- Evidence: `joinery.ts:241-246` picks the Domino from the chine width `flat = L.side` (0.625") with a 0.1" wall rule, so a 10 mm tenon (0.394") passes and every cabin tie is **10x50** (`side-cabin-L-chine` joint: "10×50 (DF 500) every 6\""; `rail-cabin-L` same). (a) A 10 mm Domino in 0.625" stock leaves 0.116" walls (Festool's own minimum for a 10 mm Domino is well above 5/8"). (b) The rail top is not 0.625" wide at the Dominos. The rail note says the deck sits on a **0.25" ledge, open at the top** (`deckCaptureDepthIn`; deck outline at y +/-13.5, rail inner face 13.255), which leaves a land of 13.505-14.005 = **0.5"**, a Domino wall of 0.053". The same note says the rail inner face "above the deck is relieved flush with the chine's inner face" (13.375), which would leave a lip of 0.125" over the deck edge so the deck could not drop in. Both cannot be true. (c) Two of the six per side (x = 20.47 and 27.07) sit on the 5.6" arcs: a straight 50 mm slot over R 5.6" has a sagitta of 0.086" (c^2/8R), so the mortise end runs 0.086" off the member centerline, leaving 0.03" on one side of the chine. (d) Spacing is by x, not arc length, so the two arc Dominos are about 13" apart along the path.
- Why a builder stalls: this is the whole hull-to-frame tie; the first mortise would blow out the chine or rail top.
- Fix: choose one rail-land reading (recommend: ledge 0.25", land 0.5", delete the "relieved flush" sentence). Then use **5x30** (walls 0.15" in the 0.5" land; sagitta 0.031" on R 5.6") at 4" pitch in the straight and 3" on the arcs, or drop the Dominos in the arcs and use 316 #10 x 5" pilot-bored screws up through the rail with a Forstner counterbore (the note already calls for screws every other Domino but gives no size or length: a 4" rail plus 1" into the chine needs a 5" screw, which exists only in #10 construction-grade 316). Cut the chine mortises with the chine on the finished rail (spring-back, see 2.2), using the DF 500 wide-mortise setting, not both in advance. Make the nose and cabin `flat` use the real land.
- Touches: `joinery.ts:236-253` (`flat`, spacing by arc length, per-zone Domino), `frame.ts:93` note, `params.ts` (`chineTieSpacingIn`, `deckCaptureDepthIn` note).

**M2. The bent-lamination process is not engineered: no S-curve form, conflicting groove methods, web fit with 0.02" slop.**
- Evidence: sections 2.1-2.2. The hull notes and part notes say "plan-view form" and "one form for the chine and web", with no form data; the S needs a two-sided form. Chine note: "route it with a template after the lamination". Gunwale note: "bearing-guided slot cutter riding the plan form template". Web: a separate 0.236" laminate going into 0.276" grooves with the 4.222" height filling both 0.375" grooves (0.375 + 3.47 + 0.375). `hullWebPlies` 2 and 3 mm sheets are at the bend limit (4.7" limit against 5.57" inside radius). Rail note: 5.0" vs 5.0". Spring-back is never mentioned for the hull.
- Why a builder stalls: after two weeks of lamination, the first dry fit of web to groove will not close, and the groove routing is the most likely place to ruin a finished lamination.
- Fix: (1) Build the groove, the rail ledge and the nose rabbet into the lay-up by shortening selected plies (section 2.2), using about 7 plies of 3/32" so walls are whole plies and R/t improves from 42 to 60. (2) Lay the 3 mm web sheets in place between the held chine and gunwale; make the web 1/16" short. (3) Publish the form: two-sided, stacked-MDF, with the three offset curves from `LayoutHull`, a clamp spacing of 3", and a practice lamination (one rail-width strip stack over the form) before the real ones. (4) Order 25% spare strips and bend a dry test strip over the form first; if it cracks, drop to 3/32" or steam (owner decision O-1). (5) Reconcile the rail radius statement (5.0" in the note, 5.32" in `hull-curve-notes.md`).
- Touches: `body.ts` and `frame.ts` notes (plies, groove method, web), `joinery.ts` groove strings, `build-utils.ts` HULL_STEP text, `params.ts` (`hullLamThicknessIn`, groove width, ply counts), `hull-curve-notes.md` §2, new form DXF export for Phase 4.

**M3. The three welded assemblies are not specified so that a fab shop can quote and build them.**
- Evidence: section 2.3. `kp-under` x 44.25-46.75 vs `kp-ear-L` x 46.88-47.63 (no overlap, no tab in the drawn 2.5" stock); `kp-carrier` front edge x 47.5 vs ear to 47.63; note says weld "with the beam as the jig" and "check both plates are parallel"; `steer-stop-*` split into an outsourced channel plus two `drill-tap` pieces that the troop is told to "weld on the bench"; no assembly part id, no weld symbols, no gap/parallelism tolerance, no flat pattern for the 3/8" channel, galvanize-or-paint ambiguity.
- Why a builder stalls: nobody can place the order; a volunteer with a MIG welder will "just do it" without a drawing, or the troop will discover at the shop that the ears cannot be welded to a 2.5" plate.
- Fix: define three weldment parts (`kp-carrier-weldment`, `steer-stop-weldment-L/R`, `brake-bearing-plate-L-weldment`) as single `outsource` items with their children shown for fit-up. For the carrier weldment: laser-cut carrier, under plate with a 1.0" x 1" tab on each side, two ears; welded with a 2.53" spacer bar (beam planed to 2.50") at the shop; thick epoxy bed for fit; state the tolerances. Make the stop stand one weldment of three laser-cut pieces (arm, riser, channel as a formed or laser-cut and welded U) with a drawing. Pick one finish (hot-dip galvanize after masking/reaming, or zinc-rich primer and two coats), and say that bores and threads are chased after finishing.
- Touches: `steering.ts` (ear/stand notes and ids), `kingpin-plates.ts` (kp-under tab, stock sizes), `brake.ts` (plate/post), BOM export.

**M4. The scarf at the curve end cannot be built on the parts as drawn, and everything is spliced at one station.**
- Evidence: `rail-nose-L` stock l 5.624" (x 30.37-36.0) against its own 6.0" scarf joint; chine and gunwale 5.0" scarfs; web 1.9" (all `at` x = 30.375). Cabin members end at xn and nose members begin at xn, so the scarf bevels (5-6") have to lie in the cabin curve's last 5-6", where R is 6-17" and heading is up to 10 degrees (R 6.09" at x 28.47, 8.60" at 29.1), not straight. Chine, gunwale, web, rail and the shoulder beam (x 28.88-30.38) are all joined at the same cross-section.
- Why a builder stalls: the nose rail is a 5.6" piece with a 6" scarf (a wedge with no length); a scarf cut in a curve needs the lamination to have a straight tail that is not in the part lengths, so every cabin strip, form and cut length is wrong.
- Fix: laminate the cabin members through the curve **and a 6" straight tail** (rail to x = 36.0 in one piece; no rail scarf, no `rail-nose-*` part), and move the chine, gunwale and web scarfs to the straight nose run at staggered stations (for example chine at 33, web at 37, gunwale at 41, at least 4" apart and none within 2" of the shoulder beam). Update part lengths, `rough`, strip lengths (about 55" for the rail), and the scarf `at` points.
- Touches: `frame.ts` (delete `rail-nose`, extend `rail-cabin`), `body.ts` and `joinery.ts` (scarf positions and strings), `layout.ts` (member end x), `hull-curve-notes.md` §2.

### SHOULD

**S1. Backers ride the sliding transom with no clearance.** `transom-backer-L` spans y 10-13.38 and z 9.5-16, the chine/gunwale inner face is 13.375 (0.005" interference) and the rail top is at 9.53 (0.03" overlap). They are glued to the transom before it slides in X. Pull them in to y 13.25 and z 9.6. Files: `body.ts:718`.

**S2. Nose-chine rabbet text says 1.512".** `joinery.ts:168` builds `rabbetSize` with `bot = L.deckBot` (cabin deck underside 8.53) for the nose run, so the nose chine and nose-deck joints read "1/4" × 1.512" rabbet", taller than the 1.5" chine; the correct number is 0.512" (the transom dado is right). Use `L.noseBot` for the nose run. Files: `joinery.ts:147-168`.

**S3. Sequence text is circular.** `HULL_STEP` doc: step 1 glues the frame (rails) and step 2 laminates the rails. Write the true order: forms, laminate rails/chine/gunwale/web, fit-check, frame + deck unit, side assemblies, join, transoms, front stack. Also list the fixtures (forms, jig, cradle for the flip). Files: `build-utils.ts:44-59`, part notes.

**S4. Strip schedule and cut-list.** Bent-lam parts list a finished block as `stock`/`rough`: `side-cabin-L-chine` rough 0.75 x 1.625 x 42.96, `rail-cabin-L` 0.875 x 4.125 x 42.96, `side-nose-L-gunwale` 0.75 x 4.125 x 21.875. Replace with strip dimensions, count, spares, resaw/plane notes, and strip length including scarf tails and trim. Files: `build-utils.ts` (`bandPart`, `roughOf`), `body.ts`, `frame.ts`.

**S5. Jig.** Define the inverted side jig (stations every 12", locator pins, spacing 28" at the rear narrowing to 14" at the nose, sheer rise support at the bow) and the flip procedure. Without it, two floppy 0.236" webbed assemblies are positioned by eye. Files: new doc/DXF, `build-utils.ts` doc.

**S6. Tolerance management between the bent members.** Rail Domino/screw positions are cut in step 1 before the chine exists. Cut the chine mortises or pilot holes from the finished rail, do not pre-cut both. Put a 1/16" fit-check step (dry lay each chine on its rail on the form) before the epoxy. Files: `build-utils.ts`, `joinery.ts` notes.

**S7. Cushion still sewn in-house.** `seat-cushion` / `seat-back-pad` sourcing says sewn in-house; the back pad's #6 x 3/4 screws go through a 0.236" panel. Switch to a purchased marine cushion, or a staple-wrapped vinyl over 1/4" ply, and a #6 x 3/8 (or Dual Lock). Files: `seat.ts`.

**S8. Sign standoff.** `sign-L` sits at y 14.0-14.24 against a web outer face at 13.81; the 4 thumb screws have no spacer, so tightening dishes the 6 mm sign into the 0.19" gap. Add 3/16" spacer washers or a 0.19" backing strip. Files: `body.ts` sign.

**S9. Finish and sealing sequence.** Every groove, rabbet, dado, Domino mortise and ply edge is "sealed first": that thickens each fit by 0.005-0.01" per face. The notes need a sequence list: seal, wash amine blush, scuff glue faces, glue, fillet, final coats. Include a tolerance table (hull square within 1/16", axle parallelism, toe-in, kingpin plumb) and a consolidated "verify before ordering" hardware list (turntable bearing, collar, wheel rating, pad k, ear share). Files: `docs/`, `finish.ts` notes.

**S10. Chine end tenons are still locating pins.** Front transom chine tenon 3/16 x 1/4 x 3/8, nose chine bearing strip 0.375". Either widen to 3/4 in the 1.5" height the way the gunwale tenon is (3/16 x 3/4) or add two 1/4" stainless dowels. Files: `joinery.ts` `endJoint`, `chineBand` (`deckTopZ`, 0.2).

**S11. Squeeze-out and drying in the stopped dados.** The web groove is "vented" only at the transom; the chine/gunwale grooves are 43" of sealed 0.276" slot with the web in place. The notes say "wipe squeeze-out from the grooves" but give no method for the blind part. Specify a notched glue brush/syringe application and a bead of thickened epoxy at the groove mouth rather than filling the groove. Files: `body.ts` web note.

### NICE

- **N1.** Reaming/honing the kingpin sleeve to 0.756" needs a reamer or a machine-shop visit; the note says so. Consider a bought 3/4" ID oilite sleeve so no reaming is needed. Files: `steering.ts`.
- **N2.** `rail-cabin-L` shaft notch and beam seat need corner relief and an epoxy seal; state a 1/4" radius for the shaft notch too (only the beam seat has it). Files: `frame.ts`.
- **N3.** Guard inserts at x 29.25, 30.13 and 31.0 lie in the gunwale scarf zone. After M4 they will not (scarf moves), but re-check. Files: `joinery.ts` guard section.
- **N4.** Kingpin bolt "cut to 5-1/8 after the nose is on" and "thread length trimmed" on the grade 8 carrier bolts: say cutoff wheel and die, and consider buying the standard 5-1/2" and deepening the counterbore. Files: `steering.ts:155-165`.
- **N5.** Hot-dip galvanizing a 3/16" plate with a welded post warps it; paint is the safer default for the pivot plate. Files: `brake.ts` finish string.
- **N6.** Weight 169.0 lb empty (D-48 notes); flip and transport need four people. See O-5.
- **N7.** `handle-bar` and other bought dowels carry `fab: table-saw`; use `buy` plus cut-to-length. Files: `brake.ts`.
- **N8.** The handle's post-top joint is a 3/8" rod 3/4" into a 1.25" dowel (across the grain) and 1-1/2" into end grain. A bridle or two 1/2" dowels per post would be less fragile for a handle that is pulled with 200 lbf. Files: `brake.ts` handle geometry.
- **N9.** Cabin deck ply edge sits in a 0.5" x 0.125" slot under the chine overhang that traps water and dirt; fill with thickened epoxy after the deck is in. Files: `frame.ts` ledge note.
- **N10.** A thin sliver of the rail top near the transom/backers (0.03" overlap) and the 0.08" wedge at the shoulder beam rear face: note "fill with thickened epoxy" in the beam note. Files: `frame.ts` shoulder beam.

---

## 4. Owner decisions

- **O-1. Bent-lam strip thickness and species.** 1/8" white oak at R/t 42 is at the edge of cold bending. Choose 3/32" strips (7-8 plies, grooves laid in the lamination), keep 1/8" with a bend test and 25% spares, or steam. Blocks the strip order and the form drawing.
- **O-2. CNC / Shaper Origin availability.** Twelve parts are `cnc` or need a template: both decks, two transoms, two nose webs, the access panel, the forms. If the troop has no CNC, each needs a router-template recipe recorded in the data.
- **O-3. Weldments.** Confirm a shop that will weld the three assemblies, plus a finish route (galvanize and chase, or paint). If not, redesign: bolted ears (angle + 4 bolts), bolted stop riser, through-bolt pivot with an outboard cheek.
- **O-4. Chine-to-rail tie.** 5x30 Dominos plus screws, or screws only on the arcs (M1), or move the deck ledge (wider land) to allow larger tenons.
- **O-5. Rail continuity and the splice station.** One 6" longer cabin rail to x = 36 (M4) and staggered scarfs for chine, gunwale and web.
- **O-6. Turntable ring and bearing.** Unchanged from round 2 O-1: ring diameter 9" and plate thickness are `verify`, `turntable-ring` is an info row with no judgment. Buy a bearing and measure before ordering `kp-carrier`.
- **O-7. Cushions.** Purchased marine cushion, no-sew wrap, or a volunteer who can sew (S7 above is the finding).
- **O-8. Weight.** 169 lb empty against the D-21 target of 90-120 lb and a two-person lift of about 80 lb each; the build adds ~5 lb in this round. Decide whether to accept it or dig out mass (shaft, rails, doubler).
- **O-9. Brake grip travel 5.7" (limit 6.5") and the 1/4"-shorter shoe stroke.** Must be felt on a mock-up before the shaft is cut.
- **O-10. Face-tapped 7/8" flange collar.** Vendor check (S9 round 2), or fall back to a shop-welded hub.

---

## 5. Resolved or no action

- Domino face widths and tenon sizes are from the real catalog (`DOMINOS`), now with the exception of M1.
- Vent holes (1/8") at all dado ends are in the joint data; hydraulic lock addressed.
- Stop blocks, shims and fit-up procedure (round-2 S12) are complete.
- Rear mount bolt edge distances, notch sizes, hold-downs and doubler clearance are consistent with the part bounding boxes.
- Print size of the finger guard (3.6") fits any bed.
- `npx vitest run src/model`: 9 files, 459 tests pass.
