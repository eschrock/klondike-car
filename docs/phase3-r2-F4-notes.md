# Phase 3 round 2, F4 (seat, storage, lighting): proposed DECISIONS text

**D-40 amendment (seat detail).**
- **Frame joints (build M1/S9).** The seat-back stile and rail joints are one **4×20 Domino** (not 6×40) per joint, chosen by `chooseDomino` with the light-frame edge margin (`dominoEdgeLightIn` 0.10"). The Domino sits in the outer 1.125" band of the 1.5" member, clear of the 3/8" panel groove. The stile groove is stopped at the rail faces; the rail groove runs through into the stile's solid edge. The panel's corner tongues are notched.
- **Grab handle.** Each post is joined to the pad by a **4×20 Domino**, and to the bar by a **blind 3/8 × 3/4 × 1/2 tenon** (a through tenon the full 1" width left no shoulder on the 1" post).
- **Stud.** The knob stud is 3/8-16 × 3-1/2", with a nylon-insert jam nut on the stile and threadlocker on the insert end (S14).
- **Foot stop (S6).** The "stopped dado in each side" is gone: the nose side is a chine and a 6 mm web, with nothing to dado. The board is held by **two oak corner cleats** (1.25" × 0.75", full stop height) epoxied to the inboard face of each side. They stand **ahead** of the board so the foot load bears on them in compression, and each is pinned to the board by two 5×30 Dominos. The cleats go behind the board when the board sits against the front transom (the validator limit). Deck screws stay. The analysis row for the foot stop belongs to F2: the load path is board end to cleat bearing and cleat to chine glue, with the deck screws as backup.

**D-41 amendment (storage and fittings).**
- **Floor (plan item 5).** The ply floor panel is **deleted** when the box stands on the deck (rear and under-seat locations). The epoxy-sealed deck is the floor, with a 3/8" fillet inside and a bead outside, and glass tape. The two 3/8" drains go through the deck at the aft corners (stainless nipples epoxied in), and the deck is faired about 1/8" toward each drain so the box cannot hold water. A **raised** box (forward location) has no deck under it and keeps its floor. The interior is 0.236" taller as a result.
- **Corners (S4).** The wall corners are **tape-and-fold 45° bevels** (2" glass tape across the open seam, folded, then a 3/8" epoxy fillet inside). There is **no spline**: a 1/8" slot in 6 mm ply leaves 0.055".
- **Wall tops (S4).** A **3/8" × 1/2" oak coaming** caps the walls (flush outside, ledge inside). The gasket seals on oak, never on a ply edge. The ply wall stops 3/8" lower, and the interior calculation subtracts the ledge. New params: `storageCoamingThickIn` and `storageCoamingWidthIn`.
- **Lid frame (M1).** The corners are 4×20 Dominos in the 1" × 1/2" rim (20 mm = 0.787" in 1.0" with a 0.1" margin).
- **Hinges and latches (S5).**
  - The hinge screws are #8 × 1" into a **1" hinge backer**, which stops under the coaming.
  - Each latch screws into an **oak block** (3/8" on the rear transom's inner face, or 3/4" behind the 6 mm aft end), not into a bare transom face or a thin ply skin.
  - A **316 stainless friction stay** (on the left hinge backer) holds the lid open, because the 75° stop leaves it free to fall closed.
- **Lash points (S-9).** Each D-ring is on a **4-hole plate with 4 stainless #10 × 1-1/4 screws** (was 2). A new row, **`lash-load`**, pulls one plate at 300 lbf and 45° (`lashLoadLbf`, `lashPullAngleDeg`):
  - Withdrawal: NDS W = 1380·G²·D = 121.2 lbf/in; thread penetration 0.875"; wet C_M 0.7; 74.3 lbf per screw, 297.0 lbf for 4, against V = 212.1 lbf, so util **0.71**. Two screws would give 148.5 lbf and fail.
  - Lateral bearing: 319 psi against 1,700, so util 0.19.
  - The row is reported-only for the rider sweep (info light), like `lash-points`.
- **Stainless (S7).** All hinges, latches, catches, drains, D-rings, the stay and the screws are 316 stainless. Heat-set inserts live in the printed ASA clips, away from the oak.
- **Sourcing (M9).** Every purchased part in these groups, including the catches and the hardware lump, names a source.

**Joinery and Domino orientation (open question for Eric).** The repo rule (`chooseDomino`) and the build review both treat a Domino's **length** (40 mm for a 6×40) as the dimension **along the joint face**. On a real DF 500 the length is the **depth into the two pieces** (about 20 mm each) and the face dimension is the 12–14 mm **width**. If that is right, 6×40 would have fit the 1.5" members after all. We follow the repo rule (conservative) and record this as an assumption to verify against the tool before cutting.

**Mass (changes in my files only, current layout):** floor −2.10 lb, ply wall height −0.18 lb, coaming +0.50 lb, latch blocks +0.03 lb, lid stay +0.12 lb, foot-stop cleats +0.23 lb, 12 extra lash screws about +0.1 lb. **Net about −1.3 lb** (the plan asked for −2.0).

**Needed from other owners.**
- **F2:** a foot-stop analysis row (load path above), the `foot-stop-cleat-*` ids, and the 4× rough length (already landed: my test passes).
- **Shared edits:** the new `lash-load` id is added to `GROUP_OF_ID` (types.ts), to `LIGHT_OF_ID` (rider-sweep.ts, info) and to `INFO_STRUCTURE` (rider-sweep.test.ts).
- **Pre-existing failures that are not from F4:** defaults currently fail validation (turntable overhang error), `brake-shaft` fails, and the brake and hull tests are red. These are other agents' work in flight.
