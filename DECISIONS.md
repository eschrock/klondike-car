# Design decisions & assumptions

Living record of every assumption behind `src/params.ts`. Params cite these IDs through their `ref` field.
**Status:** ✅ decided · 🔶 provisional (Phase 2 will confirm) · ❓ needs Eric's input.
Units are inches, pounds and degrees throughout.

---

## Conventions

| ID | Decision | Status |
|---|---|---|
| C-1 | **Model frame:** +X forward (toward the bridle), +Y left, +Z up. The origin is on the ground under the rear-axle centre. The viewer uses the same Z-up frame, so no frame conversion happens anywhere. | ✅ |
| C-2 | **Single source of truth:** `src/params.ts` → `src/model/*` → `Part[]`. Model and analysis code is plain TS with no three.js imports, so it runs headless in tests. | ✅ |
| C-3 | Enumerated choices are stored as numbers so every param serializes into the shareable URL hash. | ✅ |
| C-4 | Each param has a `status`: locked, verify, assumed or explore. `validateParams()` rejects impossible combinations, such as a nose wider than the cabin, a goal rider lighter than the operating rider, or a deck below the axle stack. The panel shows those problems live. | ✅ |
| C-5 | **One Part = one physical piece.** `massLb` is per piece. Identical pieces share a `partNo`, and the cut list and BOM aggregate on it. Every part names its rigid `body` (chassis / steer / wheel-xx / rider / cargo / truck) for articulation and the sim. | ✅ |
| C-6 | **The displayed steer angle is view state, not a design param.** It lives in the viewer toolbar, is clamped to ± lock, and is never stored in the URL. | ✅ |

## Loads & factors

| ID | Decision | Status |
|---|---|---|
| D-1 | **Two rider masses.** The *operating* rider is **150 lb**, the largest realistic scout, and every check must pass at it. The *goal* rider is **200 lb** (adult or stretch case). Structure is sized to the goal rider. Stability and brake are reported at both. If 200 lb would force a compromise, it is flagged rather than designed around. (Eric, 2026-10-10.) | ✅ |
| D-2 | **Structural load case:** (goal rider 200 + cargo 25) × 3 = **675 lbf** payload. Members that also carry the cart's own weight (axles, axle beams, kingpin, turntable) add **cart mass × 3**, roughly +210–250 lbf. Wood gets SF 2 on top. Steel is checked against yield / 2. | ✅ |
| D-3 | **Seated rider model:** CG **9.5" above the seat** and **4" ahead of the H-point** (legs extended forward). H-point to foot stop is **36"**, about 0.53 × a 68" stature with knees slightly bent. These are anthropometric approximations, not measurements. | 🔶 |
| D-4 | **White oak**, USDA Wood Handbook FPL-GTR-282, Table 5-3a, clear wood at 12% MC: SG 0.68 → **47 lb/ft³**; MOR **15,200 psi**; MOE **1.78 Mpsi**; shear ∥ **2,000 psi**; compression ∥ **7,440 psi**; compression ⊥ **1,070 psi**. Wet-service factors (NDS C_M) are **0.85** on strength and **0.90** on stiffness. **Design bending stress** = 15,200 × 0.85 / 2 = **6,460 psi** at dynamic load. Compression ⊥ governs axle grooves, kingpin bearing and bolt crush. We select clear, straight-grained stock, so no grade knock-down. **Steel:** 1018 CD, yield taken as 50 ksi (book value 54), E = 29 Mpsi. **Kingpin** is SAE grade 8 at 130 ksi. 18-8 stainless at 30–65 ksi is the alternative and would need a larger diameter. | 🔶 |
| D-5 | **Plywood:** okoume marine (BS 1088) at **33 lb/ft³**, effective E 0.9 Mpsi and MOR 5,000 psi with face grain along the span. Exterior Baltic birch is the alternative: **42 lb/ft³**, 1.3 Mpsi, 7,000 psi. These are typical published panel values, and Phase 2 uses them only for deck-span checks. Okoume is **~21% lighter** per panel. | 🔶 |
| D-14 | **Pull loads.** Steady pull is rolling resistance (Crr ≈ 0.06 on dirt × ~290 lb ≈ 17 lbf) plus grade (10% grade ≈ +29 lbf), so **~20–50 lbf**. Design peak is **150 lbf**, for 4–6 scouts surging. It is applied at a puller hand height of 30". The short oak **tongue** (24" ahead of the kingpin) is the default because it gives a steering lever arm and keeps the bridle away from the front tires. Phase 2 compares it with a bridle tied to the axle ends. | 🔶 |

## Truck fit & transport

| ID | Decision | Status |
|---|---|---|
| D-6 | **Track width is set by the truck.** With the wheels *beside* the wheel wells, track + 4" tire + 2 × 0.5" clearance ≤ 41.5", so **max track is 36.5"** (the default). **"Straddle" alternative:** put the front wheels *ahead of* the wells and the rear wheels *behind* them, and the track is limited only by the 57" floor. That allows roughly a 44–48" track, a large stability gain. With the default well position (18–52" from the bulkhead), front wheel centre ≤ 18 − 6.5 − 0.5 = 11" and rear wheel centre ≥ 52 + 7 = 59". That needs **wheelbase ≥ 48" with zero fore-aft slack**, and puts the rear tires across the tailgate hinge gap. The body must also stay under 41.5" wide below the 10" well height. **This depends on measured well positions (Q-1).** | ❓ |
| D-7 | **Loading is a two-person lift**, with no ramps and no winch. A 32" load height at ≤ 20° needs a ramp ≥ 94" long, longer than the cart. The axle beams and grab handles are the lift points. | ✅ |
| D-8 | **Stowage length** = bed 60.5 + tailgate 20 = **80.5"**. The default **body** is 66" long. With the tongue fitted the cart is 82", so the **tongue must pin off or fold up** for transport (D-9). | 🔶 |
| D-9 | **Removable for transport:** rear push handle, seat back, tongue, prow ornament and signs. They attach with knobs, pins or threaded inserts. The truck-fit check runs both with and without them. | ✅ |

## Structure & layout

| ID | Decision | Status |
|---|---|---|
| D-10 | **Dead (non-rotating) axles.** Hand-truck wheels have sealed bearings in the hub, so the axle can be clamped to the oak beam. That avoids pillow blocks, which are cast iron at ~1.5 lb each. **Options:** a through rod, or **stub axles**, ~8" of rod per wheel clamped in a ≥ 2½"-deep beam. Stubs save ~6 lb of steel but need a heavier beam, and on the lean budget (W-1) a ⅝" through rod on lean beams comes out ~2 lb lighter overall. Phase 2 decides with the stress check. A live axle is needed only for the wood-drum brake. | 🔶 |
| D-11 | **Wheels: 13" (4.10/3.50-6) by default, 10" (4.10/3.50-4) as the alternative.** These are the two common pneumatic sizes with ¾" or ⅝" ball-bearing bores. Mass is **~5.5 lb per 13" wheel and ~4 lb per 10" wheel**. Flat-free foam tires are an option at about +1.25 lb per wheel. All values are placeholders until a catalog part is chosen (Q-4). | 🔶 ❓ |
| D-12 | **Steering:** wagon steer on a 12" square, 1000 lb lazy-susan turntable (~⅜" stack), with a ½" grade-8 kingpin. **The turntable is not moment-rated**, so the roll moment from one front wheel hitting a bump must go through oak rub blocks or side-bearers at the beam ends, not through the bearing. Mechanical stops are oak blocks on the beam bearing on the frame, with lock at 40° (explored). | 🔶 |
| D-13 | **Brake:** shoes on the **rear tire treads** (default), with a wood drum as the alternative. Shoe friction acts at the tire radius, so it is 1:1 with ground force: no drum and no live axle. One lever works both shoes through a cross shaft, with a ratchet detent for parking. Linkage efficiency is taken as **0.8**. | 🔶 |
| D-15 | **Vertical stack at the axles.** By default the axle beam is **underslung**: the axle sits in a groove on top of the beam, held by U-bolts. With a 13" wheel the beam spans z = 4.4–6.9"; that is ≥ 3.5" clearance ✅. **Front:** beam 6.9 + turntable 0.38 + crossmember 1.75 + ply 0.35 puts the deck at **≥ 9.35"** over the front axle. The main deck is 9", so the forward deck steps up **0.5"** (`frontDeckRaiseIn`). **Rear:** beam + ply needs only 7.2", so the rear beam can be recessed between the rails. **Front-wheel swing:** at 40° lock the inner tire's rear corner reaches **(32.6, ±8.3)**, about 15" behind the front axle. So the hull narrows to **14"** (1.3" clearance each side), starting **18" behind the front axle**. This narrow section is the rider's foot well. | 🔶 |
| D-16 | **Ground and friction:** minimum ground clearance is **3.5"** (roots, trail crown). Tire-to-ground μ is **0.5** (damp packed dirt or gravel); wet leaves can be ~0.3. Shoe-to-tire μ is **0.4** (wet). | 🔶 |
| D-17 | **Primary structure, two candidates.** (a) A **ladder frame**: two ¾ × 3" oak rails plus crossmembers, with the deck on top. (b) **Hull-as-beam**: the sides are deep girders (oak chine + oak gunwale + captured ply web), and floor joists carry the deck between them. That deletes the rails, saving ~8 lb, and is how the "boat" character pays for itself. The max unsupported deck span (joist spacing) is 12" by default. Phase 2 sizes both against D-2 and L/300. | 🔶 |
| D-18 | **Seat:** a 2" closed-cell foam cushion (vinyl-covered, drains), with a back 16" tall reclined 15°, removable for transport. The H-point sits 12" ahead of the rear axle (explored). | 🔶 |
| D-19 | **Storage:** about **1,800 in³** (~1 ft³) of interior volume for the patrol's shared kit: first-aid kit ~150, 4 L of water ~300, 6 rain shells ~400, lights ~60, food ~200, spare layers ~600, map, compass and fire kit ~60. Default location is **behind the seat over the rear axle**, which adds traction to the rear-wheel brake (see the brake calc below). That's better than over the front wheels, where the box would have to be raised above the 13" tire. | 🔶 |

## Analysis-criterion interpretations

| ID | Decision | Status |
|---|---|---|
| A-1 | **The brief's turn-rollover target can't be reached.** The brief asks for v_rollover ≥ 3 × 6 mph at minimum radius. Rollover lateral acceleration is (T/2)/h ≈ **1.05 g** here, and 18 mph at a ~5 ft radius needs **~4.4 g**. **Proposed replacement:** (i) v_rollover ≥ **1.5 × jog speed** at minimum radius, evaluated on the **outer** support edge; (ii) **slide before tip**: μ_ground < (T/2)/h, so on flat ground the cart skids rather than rolls; (iii) a plot of v_rollover against radius. **Current hand calc: 150 lb rider, 40° lock, CG radius 5.0 ft, outer edge 16.9" from the CG, h 16.1" → v_roll ≈ 8.9 mph = 1.48×. A marginal FAIL.** At 200 lb it is ≈ 1.44×. Fixes Phase 2 can use: wider track (straddle, D-6), lower CG, or a 35° lock. A trip on a curb or root can't be checked statically, so the sim covers it qualitatively. | ❓ |
| A-2 | **Turning radius (≤ 8 ft)** is measured to the outer front tire centre (curb to curb), the conservative reading. The rear-axle-centre radius L / tan δ is reported too. | 🔶 |
| A-3 | **Full-lock static tip** uses the actual support polygon. Rear contacts are at (0, ±T_r/2), and the front contacts are rotated about the kingpin by the lock angle. The tip margin is the CG's distance to the *nearest* polygon edge. The turn check (A-1) uses the *outer* edge. | ✅ |

## Weight budget (line items)

**W-1.** Oak is 0.0272 lb/in³, okoume 0.0191 lb/in³, steel 0.284 lb/in³. "Default" means the current params as written: brief-literal solid-oak sides, ladder frame, ¾" through axles, 9 mm deck. "Lean" pulls every lever without dropping any feature.

| Item | Default | Lean |
|---|---|---|
| 4 wheels (13" / lean column shows 10") | 22.0 | 16.0 (13": 22.0) |
| Axles (¾" through × 41.5" / ⅝" through) | 10.4 | 7.1 |
| Turntable + kingpin | 4.0 | 4.0 |
| Axle clamps, fasteners, threaded inserts | 3.0 | 2.5 |
| Brake linkage (steel cross shaft, pivots) | 2.5 | 1.5 |
| Seat cushion + back pad | 2.5 | 2.0 |
| Lights, reflectors, printed parts, bridle rope | 2.5 | 2.0 |
| **Non-wood** | **46.9** | **35.1** (13": 41.1) |
| Frame rails (¾ × 3 × 66, ×2) / none (hull-as-beam) | 8.1 | — |
| Crossmembers / floor joists | 5.8 | 4.0 |
| Axle beams (2½ × 2½ / 1½ × 2) | 10.9 | 4.9 |
| Deck (9 mm / 6 mm okoume on 8" joists) | 11.0 | 7.3 |
| Sides (½" solid oak + caps / oak chine + gunwale + 6 mm okoume web) | 15.0 | 12.5 |
| Nose, bulkheads | 3.0 | 2.0 |
| Seat frame + back | 2.5 | 1.5 |
| Storage box | 5.1 | 3.5 |
| Tongue | 1.8 | 1.5 |
| Rear push handle | 3.7 | 3.0 |
| Brake lever + shoes (oak) | 1.5 | 1.0 |
| Finish (+5% of wood) | 3.4 | 2.1 |
| **Wood + finish** | **71.8** | **43.3** |
| **Total** | **~119 lb** | **~78 lb (10") / ~84 lb (13")** |

**Takeaway:** 60–70 lb can't be reached with every feature in the brief, even with a lean design. The lean design's non-wood alone is 35–41 lb. Getting to 70 lb means dropping about 8–14 lb more, for example:
- 10" wheels (−6);
- stowing the 10 Essentials in a lashed dry bag instead of a box (−3.5);
- open-frame sides (−5);
- a lighter rear handle, or none, with the rear tether only (−3).

The removable parts (handle, seat back, tongue: ~6 lb) come off for the truck lift. Phase 1 will compute the real number from the parts list, and Phase 2 will show the tradeoffs. **The weight target needs Eric's call (Q-6).**

## Stability & brake hand calcs (defaults, 150 / 200 lb rider)

Phase 2 replaces these with live checks.

- **Loaded CG height:** rider CG 9 + 2 + 9.5 = 20.5"; cart ~8"; cargo ~11". **h ≈ 16.1" / 16.9"**.
- **Straight tip:** atan(18.25 / 16.1) = **48.6° / 47.2°** against ≥ 40° ✅.
- **Full-lock tip** (40°, 48" WB): the inner front contact sits at (36.3, 14.0), and the nearest edge is 16.0" from the CG, giving **~45°** against ≥ 35° ✅.
- **Turn rollover:** **1.48× / 1.44×** against 1.5×. ❌ marginal (A-1).
- **Turning radius:** **4.8 ft** at the rear centre and **7.75 ft** at the outer front tire, against ≤ 8 ft ✅ (marginal; it grows with wheelbase).
- **Brake lever:** the downslope force on 15° is 63 / 76 lbf. Shoe force = 76 / 0.4 = 189 lbf. At 30 lbf on the handle with 0.8 efficiency, that needs a **ratio ≥ 7.9:1**. The default is **9:1** ✅.
- ⚠️ **Rear-only traction parked nose-down on 15°:**
  - With the CG ~18" ahead of the rear axle, the rear wheels carry ~124 lb, which resists only ~62 lbf at μ 0.5. That is a **marginal fail at 150 lb and a fail at 200 lb**.
  - Putting the 25 lb storage box over the rear axle (D-19) adds ~23 lb of rear load, bringing 150 lb to ≈ even.
  - Wet leaves (μ 0.3) fail regardless. Parking nose-up holds.
  - **Phase 2 options:** move the seat aft; front parking chock or pin; four-wheel parking brake; or park across the slope as the procedure.
  - **This is the check most likely to drive the layout.**

## Open questions for Eric

| ID | Question |
|---|---|
| Q-1 | Measured bed dimensions, especially the **fore-aft positions of the wheel wells** (settles D-6, straddle vs. beside the wells). Also: bedliner type, and the cab configuration. |
| Q-2 | **Side panels:** the brief limits plywood to the deck, floor and bulkheads, and makes the sides oak. Is **6 mm okoume captured in an oak chine/gunwale frame** (no exposed edges) acceptable for the sides? It saves ~3–5 lb and makes hull-as-beam possible (D-17). |
| Q-3 | Accept the A-1 replacement turn criterion? Note that it currently fails marginally at the default layout. |
| Q-4 | Course details (steepest hill, surface, roots/curbs), and a preferred wheel source or bore. |
| Q-5 | Signage: "Troop 455 / Wilderness Rangers" as in the renders? |
| Q-6 | **The weight target:** accept ~80 lb with every feature, or set priorities, e.g. 10" wheels, no rigid storage box, open-frame sides? |
| Q-7 | Team logistics: how many pullers, and who lifts the cart into the truck (two adults, or scouts)? This sets the design pull and the lift points. |
