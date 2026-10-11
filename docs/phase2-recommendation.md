# Phase 2 recommendation: configuration to detail in Phase 3

**Status:** proposed, waiting for Eric's approval (BRIEF §10 checkpoint).

**Try it:** [open the recommended design](https://eschrock.github.io/klondike-car/#wheelbaseIn=44&crossmemberSpacingIn=8&axleYieldPsi=70000&steerLockDeg=37&kingpinLeadIn=1.5&kingpinDiameterIn=0.75&kingpinSleeveOdIn=1.25&drawbar=0&brakeLeverRatio=12&frontAxleBeamThicknessIn=4&deckPlyIn=0.472&bridleRopeRunIn=96). The link reproduces the exact design; the Analysis tab shows every check with its formula.

**Up front:**
- **Weight:** 127 lb empty, 81% over the brief's 60–70 lb target. Per D-21 we build the full-featured design first and treat weight as information; a lightweight variant follows Phase 4.
- **Lifting:** 117 lb with the removable parts off, or **58 lb per person** for a two-adult lift.

**How it was chosen:**
1. **Analysis:** `src/analysis` implements every BRIEF §7 check, plus the load cases the critic added: obstacle strike, roll path, an 80 lb lightest rider, the tyre-edge turning radius, and an effective-width deck check.
2. **Sweep:** about 45k designs (`docs/phase2-exploration.md`) found which variables drive which checks.
3. **Hand-built design:** the sweep's best design solved the curb strike with a 1" kingpin and a wider beam. I built this design by hand from it instead, fixing the kingpin load path. The sweep ran **before** that kingpin model existed, so its counts ("176 pass") and mass range don't describe this design exactly.
4. **Verification:** `scripts/recommend-table.ts` regenerates the table below, and the vitest `src/analysis/recommended.test.ts` asserts zero failures.

## Changes from the Phase 1 defaults

| Parameter | Phase 1 | Recommended | Mass | Why |
|---|---|---|---|---|
| Wheelbase | 48" | **44"** | −3.4 lb | The turning radius to the outer tyre edge was 97.25" against 96" (a fail). It is 93.4" at 44". |
| Steering lock | 38.5° | **37°** | +0.5 lb | The kingpin sleeve (next row) moves the kingpin 1.5" ahead of the axle, which narrows the nose the tyres allow. At 37° the nose is 14.0", enough for feet in boots (12.1" needed inside). |
| Kingpin | ½" grade 8, stopping at the turntable top | **¾" grade 8, through the beam *and* a chassis crossbar, in 1¼"-OD steel sleeves**; lead 1.5", front beam 4.0" | +2.3 lb | A front-wheel curb strike pushes the axle back through the kingpin. The old cantilevered ½" pin was 2.4× over. Real wagons pin the axle to the chassis; the crossbar cuts the bending lever from 2.9" to 1.1", and the sleeves spread the load into the oak. |
| Axle rod | ¾" 1018 (50 ksi) | **¾" 1045 turned-ground-polished shafting (≈ 70 ksi)** | 0 | The rear axle with the 200 lb rider, plus tyre side friction, was **0.7% over** on 1018. 1045 TGP is stock in ¾" and fits standard ¾"-bore hand-truck wheel bearings. **Alternative:** move the clamp plate ¼" toward the hub and keep 1018 (7% margin). |
| Deck | 9 mm okoume on 12" joists | **12 mm okoume on 8" joists** | +5.1 lb | A 200 lb scout standing mid-panel deflected 0.069" in 9 mm against L/300 = 0.032". 12 mm on 8" deflects 0.01". Bending was never the problem. **Lighter alternative:** 9 mm on 6" joists (−1.7 lb, more joists to cut). |
| Pull attachment | 24" oak tongue | **Rope bridle tied to the axle ends** | −1.5 lb | See the rope rig section below. |
| Bridle rope | (72" run assumed) | **8 ft tails, tied low at the axle ends** | — | The rear-pitch result depends on the rope angle (below). |
| Brake lever ratio | 10:1 | **12:1** | 0 | No mass or geometry cost. Handle force to hold the 200 lb case on 15° drops from 28.1 to 23.7 lbf. |

**Unchanged:** track 35.5", 13" pneumatic wheels, 9" deck, seat 12" ahead of the rear axle, ladder frame with captured okoume sides, storage over the rear axle, auto nose geometry.

## Rope rig and rearward pitch
On a 15° climb, a hard pull (150 lbf design surge) angled up toward the pullers' hands lifts the front of the cart. The check reports **the pull needed to lift the front wheels ÷ 150 lbf** (limit 1.25×). The lightest rider (80 lb) governs.

| Rig (recommended design otherwise) | 80 lb | 150 lb | 200 lb |
|---|---|---|---|
| **Rope bridle, 8 ft tails, hands at 30"** | **3.07×** | 3.84× | 4.40× |
| 24" oak tongue, same rope | 1.71× | 2.13× | 2.43× |
| Rope bridle, the old 6 ft run assumption | 1.92× | 2.41× | 2.76× |

Rope-bridle sensitivity to hand height and rope length, at 80 lb / 150 lb:

| Hand height | 6 ft | 8 ft | 10 ft |
|---|---|---|---|
| 30" | 1.92× / 2.41× | 3.07× / 3.84× | 4.89× / 6.13× |
| 36" | 1.43× / 1.79× | 2.13× / 2.66× | 3.08× / 3.87× |
| 40" | **1.23× / 1.55×** (80 lb fails) | 1.78× / 2.23× | 2.49× / 3.12× |

- **What decides this check is rope length, not the tongue.** With 8 ft tails both rigs pass.
- **I still recommend the rope bridle.**
  - It is 1.5 lb lighter.
  - The cart is 71" long instead of 83", so it **fits the truck fully assembled**.
  - It is the traditional Klondike rig.
  - It steers and self-centres. A pull on the axle-end ropes yaws the front axle about the kingpin, and with the kingpin 1.5" ahead the axle trails like a caster (the critic confirmed this by hand).
- **The tongue's advantage** is better steering leverage and keeping the ropes clear of the tyres; the ropes can graze the front tyre sidewalls. If you prefer the tongue, it passes with 8 ft rope, but the cart must lose the tongue to fit the truck.
- **Phase 3:** a mock-up of the rope-to-tyre geometry.

## Result

| Case | Mass | CG (x fwd of rear axle, height) | Size (L × W, without rope) |
|---|---|---|---|
| Empty | **126.9 lb** | 19.6", 9.2" | 71.0" × 40.5" |
| Transport (seat back, handle, signs off) | **116.7 lb** | 20.3", 8.3" | 62.8" × 40.5" |
| + 150 lb rider + 25 lb cargo | 301.9 lb | 16.0", 15.0" | |
| + 200 lb rider + 25 lb cargo | 351.9 lb | 16.0", 15.7" | |

### Checks

Every rider case is evaluated: 150 lb is pass/fail, 200 lb is the goal (flagged), and 80 lb is the rearward-pitch case. **Result: 0 failures in any case.** "Margin" is how far the value sits inside the limit; "marginal" means it passes by less than 10%.

| Check | 150 lb | 200 lb | 80 lb | Limit | Status |
|---|---|---|---|---|---|
| Lateral tip, straight | 49.8° | 48.3° | | ≥ 40° | pass |
| Lateral tip, full lock | 46.0° | 44.5° | | ≥ 35° | pass |
| Slide before tip (SSF) | 1.13 | 1.07 | | ≥ 0.75 | pass |
| Turn rollover speed | 9.2 mph | 9.0 mph | | info (1.5× jog = 9.0) | info |
| Turning radius, outer tyre edge | 93.4" | | | ≤ 96" | marginal (2.7% margin) |
| Steering clearance (full sweep) | 0.76" | | | ≥ 0.70" | marginal (9%) |
| Forward pitch, braking downhill | 67° margin | | | > 0 | pass |
| Rearward pitch: pull to lift the front | 3.84× | 4.40× | 3.07× | ≥ 1.25× | pass |
| Brake handle force, 15° hold | 20.3 lbf | 23.7 lbf | | ≤ 30 lbf | pass |
| Rear axle (vertical + tyre side load) | 21.6 ksi | 25.2 ksi | | ≤ 35 ksi | pass |
| Front / rear axle beams | | 1035 / 115 psi | | 6460 / 850 psi | pass |
| Axle groove bearing (⊥) | | 299 psi | | ≤ 358 psi | pass |
| Frame rails, static deflection | | 0.10" | | ≤ 0.15" | pass |
| Deck, standing scout | | 0.01" | | ≤ 0.02" | pass |
| Kingpin, bridle pull | | 67 psi bearing | | ≤ 358 psi | pass |
| **Kingpin, 3" curb strike** (average crossbar bearing) | 281 psi | **331 psi** | | ≤ 358 psi | pass at 150 lb; **marginal at 200 lb, see below** |
| Roll: side-bearers / kingpin uplift / bolster bolts | | 272 psi / 210 psi / 0.39 | | 358 / 358 / 1.0 | pass |
| **Turntable rating** | 399 lbf | **469 lbf** | | ≤ 500 lbf (½ of the 1000 lb rating) | marginal at 200 lb |
| Truck fit | fits **fully assembled**, beside the wells, both orientations | | | ≥ 1 case | pass (see the bedliner caveat) |

**Qualitative sim:** the tilt-table cross-check lands within 0.6–1.0° of the static tip angles, straight and at full lock. The sim pulls from a single point, not the two-rope bridle; that refinement is for Phase 3.

## What isn't resolved yet (honest list)
1. **Steering stops are not yet checked, and they would fail.** A one-wheel curb strike yaws the front axle into its stop with about **2,150 lbf**, roughly 4× what the 1½" oak stop posts can bear. That's a **Phase 3 must-fix**: steel stop faces, or stops placed further from the kingpin to cut the force. A check will be added.
2. **Kingpin curb strike: the margin isn't really known.**
   - The 331 vs 358 psi is an *average* bearing. A rigid pin peaks higher, and the pin may also carry the turntable pitch moment, which could exceed the allowable by up to ~3×.
   - The load case is a deliberate envelope: both wheels square into a 3" curb with the 3× dynamic factor on top. Without the factor, H = 245 lbf instead of 735 lbf.
   - The crossbar actually bears parallel to grain, which is stronger than the check assumes, but its side ligaments could split. Cleavage is unchecked.
   - **Phase 3:** a deeper crossbar, a steel bearing plate, and a defined pitch-moment path.
3. **Turntable at 200 lb (6% margin).** Option: a heavy-duty steel ring rated ≥ 1500 lb (~+2 lb).
4. **Turning radius (2.7% margin).** Option: 0.375" boot allowance at 38.5° lock gives 5.2%, but less room for feet.
5. **Truck width.** 40.5" overall against the 41.5" well gap leaves only 0.5" each side at the **unverified** default bed dimensions, and a drop-in bedliner would break it. Please measure (Q-1).
6. **Finger gap.** At full lock there is a 0.76" gap between the tyre and the hull. That's a pinch risk for fingers on the nose, so Phase 3 adds a guard or a wider gap. The kingpin nut sits under the nose deck, so the nose deck becomes removable for access.

## Carried into Phase 3
- **Steering hardware:**
  - stop design and its check (item 1);
  - stops mounted on the chassis-side turntable plate;
  - kingpin peak bearing, pitch path, crossbar cleavage, bearing plate (item 2);
  - sleeve spec;
  - front U-bolts run down around the underslung beam.
- **Bridle:** tie points and tie load on the axle ends, rope spec, rope-to-tyre geometry mock-up.
- **Fasteners and parts to specify:** designed bolster fasteners, which are assumed 4 × ¼" so far; hub-bore confirmation for the chosen wheels.
- **Rider safety and handling:** finger-gap guard; removable nose deck for kingpin access; lift handles at both ends.
