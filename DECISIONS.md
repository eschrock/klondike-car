# Design decisions & assumptions

Living record of every assumption behind `src/params.ts`. Each entry has an ID so the code, UI and checkpoint reviews can cite it. **Status:** ✅ decided · 🔶 provisional (Phase 2 will confirm) · ❓ needs Eric's input.

Units are inches, pounds and degrees throughout.

---

## Conventions

| ID | Decision | Status |
|---|---|---|
| C-1 | **Model frame:** +X forward (toward the bridle), +Y left, +Z up. Origin is on the ground under the rear-axle centre, midway between the rear wheels. The viewer uses Z-up to match, so no frame conversion happens anywhere. | ✅ |
| C-2 | **Single source of truth:** `src/params.ts` → `src/model/*` → `Part[]`. Nothing downstream holds geometry or magic numbers. The model and analysis code have no three.js imports, so they run headless in tests. | ✅ |
| C-3 | **Enumerated choices** (axle style, ply species, brake type, drawbar) are stored as numbers, so that every param serializes into the shareable URL hash the same way. | ✅ |
| C-4 | Every param carries a `status`: locked (from the brief or rules), verify (Eric to measure), assumed (engineering assumption, cited here), or explore (Phase 2 optimizes it). | ✅ |

## Loads & factors

| ID | Decision | Status |
|---|---|---|
| D-1 | **Two rider masses.** The *operating* rider is **150 lb**, the largest realistic scout, and **every check must pass at it**. The *goal* rider is **200 lb** (an adult or stretch case). Structural members are sized to 200 lb × dynamic factor. Stability and brake checks are reported at both masses. If 200 lb would force a design compromise, that's flagged rather than silently designed around. (Eric, 2026-10-10.) | ✅ |
| D-2 | **Structural design load** = (goal rider + cargo) × 3 dynamic = (200 + 25) × 3 = **675 lbf**. Wood then gets SF ≥ 2 on top; steel is checked against yield/2. | ✅ (brief) |
| D-3 | **Seated rider CG** sits 9.5" above the seat surface (roughly navel height for a slightly reclined teen or adult). Rider stature is 68" for the mannequin. | 🔶 |
| D-4 | **White oak properties** come from the USDA Wood Handbook (FPL-GTR-282, Table 5-3a), clear wood at 12% MC: SG 0.68 → **47 lb/ft³**, MOR **15,200 psi**, MOE **1.78 Mpsi**, shear ∥ **2,000 psi**. Exterior reduction uses the NDS wet-service factor C_M: **0.85** on strength and **0.90** on stiffness. **Design bending stress** = 15,200 × 0.85 / 2 = **6,460 psi** at dynamic load. We select clear, straight-grained stock, so no grade knock-down is applied. That is consistent with an expert woodworker milling their own parts. | 🔶 |
| D-5 | **Plywood**: okoume marine (BS 1088, ~33 lb/ft³) by default, with exterior Baltic birch (~42 lb/ft³) as the alternative. Okoume is about 20% lighter per panel. Every gram counts here (see W-1). | 🔶 |

## Truck fit & transport

| ID | Decision | Status |
|---|---|---|
| D-6 | **Track width is the truck's call.** The wheels sit on the bed floor. With the tires beside the wheel wells, track + tire width + 2 × 0.5" clearance ≤ 41.5" gives a **max track of 36.5"** with a 4" tire. **Alternative ("straddle")**: the bed is 60.5" and the wells span roughly 18–52" from the bulkhead. With a wheelbase of about 48–50", the front wheels can sit *ahead* of the wells and the rear wheels *behind* them, at the bed's end or on the tailgate. The track is then limited only by the 57" floor width, so roughly a 44–48" track becomes possible, which is a big stability gain. The catch: the body must be under 41.5" wide below the 10" well height, and the cart must land in exactly the right fore-aft spot. **Needs measured well positions.** Phase 2 will evaluate both. | ❓ |
| D-7 | **Loading:** a **two-person lift**, with no ramps or winch. A 31–33" load height at ≤ 20° needs a ramp ≥ 91" long, longer than the cart. At ~65–75 lb, the cart is an easy two-person lift using the axle beams or grab handles as lift points. The deck-panels-as-ramps idea is rejected. | ✅ |
| D-8 | **Usable stowage length** = bed 60.5 + tailgate 20 = **80.5"**. The default overall length is 64" plus a tongue. The tongue pivots up or pins off for transport. | 🔶 |
| D-9 | **Removable for transport:** rear push handle, seat back, tongue, prow ornament and signs. They attach with knobs, pins or threaded inserts. The truck-fit check runs in both configurations. | ✅ (brief) |

## Running gear

| ID | Decision | Status |
|---|---|---|
| D-10 | **Dead axles** (non-rotating). Pneumatic hand-truck wheels already have sealed ball bearings in the hub, so the axle can be clamped to the oak axle beam and needs no pillow blocks (which are cast iron, about 1.5 lb each). A live axle is needed only for the wooden-drum brake option. **Axle style choices:** (a) a through rod (default, simplest, steel takes the bending); (b) **stub axles** (about 8" of rod per wheel, clamped into a deeper oak beam), which saves **~6 lb** at ¾". Phase 2 picks one using the beam/axle stress check. | 🔶 |
| D-11 | **Wheels: 13" (4.10/3.50-6) default, with 10" (4.10/3.50-4) as the alternative.** These are the two common pneumatic sizes, readily available with ¾" or ⅝" ball-bearing bores. 13" rolls better over roots. Each wheel is ~5 lb (verify against the chosen catalog part). Flat-free PU versions run about +1 lb each. | 🔶 ❓ |
| D-12 | **Steering:** wagon steer on a 12" square, 1000 lb-rated lazy-susan turntable, with a ½" grade-8 kingpin bolt. A short oak tongue on the front axle beam carries the rope bridle, and Phase 2 compares it with a bridle-only setup. Mechanical stops are oak blocks on the axle beam bearing on the frame. The lock angle (default 40°) is explored. | 🔶 |
| D-13 | **Brake:** shoes bear on the **rear tire treads** (default), with a wood-drum version as the alternative. The tread shoe acts at the tire radius, so pad friction translates 1:1 into ground force: no drum, no live axle, lighter. One lever works both shoes through a cross shaft, with a ratchet/detent for parking. | 🔶 |

## Analysis-criterion interpretations

| ID | Decision | Status |
|---|---|---|
| A-1 | **Turn rollover criterion is physically unreachable as written.** The brief asks for v_rollover ≥ 3 × 6 mph = 18 mph at the minimum radius. Rollover lateral accel is (T/2)/h ≈ **1.1 g** for this cart. At r ≈ 5 ft, 18 mph needs **4.4 g**, which no seated-rider cart can reach. **Proposed replacement:** (i) rollover speed ≥ **1.5×** jog speed at minimum radius, i.e. ≥ 2.25× lateral-accel margin; (ii) **slide-before-tip**: tire-ground μ < static stability factor (T/2)/h, so the cart skids before it tips on flat ground; (iii) report the v_rollover-vs-radius curve. Curb- or root-*tripped* rollover can't be checked statically, so the sim covers it qualitatively. | ❓ |
| A-2 | **Turning-radius target (≤ 8 ft)** is read as the *outer front tire path* (curb to curb), which is the conservative reading. The rear-axle-centre radius L / tan δ is also reported. | 🔶 |
| A-3 | **Full-lock tip check** uses the actual support polygon: rear contacts at (0, ±T_r/2), and front contacts rotated about the kingpin by the lock angle. The tip axis is the polygon edge nearest the CG. | ✅ |

## Weight budget (first-pass hand estimate)

| ID | Item | Estimate |
|---|---|---|
| W-1 | 4 × 13" pneumatic wheels | 20 lb |
| | 2 × ¾" through-rod axles, ~41" long (5/8": 7.1 lb; stubs: ~4 lb) | 10.3 lb |
| | Turntable + kingpin | 4.5 lb |
| | Brake linkage, axle clamps, stops, fasteners, threaded inserts | 5 lb |
| | Seat cushion + back pad | 3 lb |
| | Lights, reflectors, printed parts, bridle rope | 2.5 lb |
| | **Non-wood subtotal** | **~45 lb** (~39 lb with stubs) |
| | **Left for wood + finish to hit 65 lb** | **~20–26 lb** |

For scale: oak is 3.9 lb per board foot finished. A 28 × 50" deck is 9.4 lb in 9 mm okoume or 16 lb in 12 mm Baltic birch. Two ½ × 7" oak sides are about 11 lb. Two 2½" square axle beams are about 10 lb.

**Read:** 60–70 lb is achievable only with every lever pulled: okoume ply, stub or ⅝" axles, lean axle beams, and light or open-frame sides. **First honest expectation is 70–80 lb.** Phase 1 will compute it from the real parts list, and Phase 2/3 will push it down. See Q-2 for the biggest lever needing Eric's OK.

## Preliminary stability & brake hand-calcs

These are sanity numbers from the defaults. Phase 2 replaces them with live checks.

- **Loaded CG height:** rider CG ≈ 8.5 deck + 2.5 cushion + 9.5 = 20.5"; cart ≈ 8"; cargo ≈ 11". At 150 lb: **h ≈ 16.1"**. At 200 lb: **≈ 16.9"**.
- **Straight lateral tip:** atan(18.25 / 16.1) ≈ **49°** at 150 lb, and **47°** at 200 lb. Target ≥ 40° ✅.
- **Full-lock tip (40°, 48" WB):** the inner front contact swings to about (36.3, 14.0). The nearest edge sits ~16.0" from the CG → **~45°**. Target ≥ 35° ✅.
- **Turning radius:** rear centre is 48 / tan 40° = **4.8 ft**. Outer front tire is ≈ 48/sin 40° + 18.25 ≈ **7.8 ft**. Target ≤ 8 ft ✅ (marginal; it grows with wheelbase).
- **Brake holding force on 15°:** 150 lb case, W ≈ 242 lb → 63 lbf downslope. 200 lb case, W ≈ 292 lb → 76 lbf. Shoe force = 76 / 0.4 = 189 lbf total. At ≤ 30 lbf on the handle this needs a **lever ratio ≥ 6.3:1** (default 7).
- ⚠️ **Rear-only braking traction is marginal nose-down.** With the CG ~18" ahead of the rear axle, the rear wheels carry ~124 lb facing downhill on 15°. At μ_ground 0.5 they can resist only ~62 lbf, so the cart *just* slides at 150 lb and slides at 200 lb. Wet leaves (μ ≈ 0.3) are clearly worse. Facing uphill (~166 lb on the rear) it holds. **Options for Phase 2:** move the seat aft; add a front parking chock or pin; brake all four wheels for parking only; or accept "park across the slope" as the procedure. This is the most likely check to drive the layout.

## Open questions for Eric

| ID | Question |
|---|---|
| Q-1 | Measured bed dimensions, especially the **fore-aft position of the wheel wells** (which settles D-6 straddle vs. between-wells). |
| Q-2 | **Side panels:** the brief puts plywood only in the deck, floor and bulkheads, and makes the sides solid oak. Solid ½" oak sides cost ~11 lb. 4–6 mm okoume side panels captured in an oak frame (gunwale + chine + posts; no exposed edges) would weigh ~5 lb. **Is captured ply acceptable for the sides?** |
| Q-3 | Accept the A-1 replacement for the turn-rollover criterion? |
| Q-4 | Course details (steepest hill, surface, roots/curbs) and any preferred wheel source. |
| Q-5 | Signage text and art: "Troop 455 / Wilderness Rangers" as in the renders? |
