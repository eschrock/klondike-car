# Phase 2 recommendation: configuration to detail in Phase 3

**Status:** proposed, waiting for Eric's approval (BRIEF §10 checkpoint).

**Try it:** [open the recommended design](https://eschrock.github.io/klondike-car/#wheelbaseIn=44&crossmemberSpacingIn=8&axleYieldPsi=70000&steerLockDeg=37&kingpinLeadIn=1.5&kingpinDiameterIn=0.75&kingpinSleeveOdIn=1.25&drawbar=0&brakeLeverRatio=12&frontAxleBeamThicknessIn=4&deckPlyIn=0.472). The link reproduces the exact design; open the Analysis tab for every check with its formula.

**How it was chosen:**
- **Analysis:** `src/analysis` covers every BRIEF §7 check. The critic graded it 7/10. Its round-1 fixes added obstacle strikes, the roll path, the lightest-rider case, the tyre-edge turning radius and a fair deck method.
- **Exploration** (`docs/phase2-exploration.md`): about 45k designs, of which 176 pass at every rider weight.
- **Targeted fixes:** the kingpin load path below, then a final check of named variants (`scripts/candidate.ts`, `scripts/recommend-table.ts`).

## What changes from the Phase 1 defaults

| Parameter | Phase 1 | Recommended | Why |
|---|---|---|---|
| Pull attachment | 24" oak tongue | **Rope bridle to the axle ends** | Under a 150 lbf surge on a 15° climb, the tongue tip lifts the front. An **80 lb** rider then tips back at 1.07× the needed margin, a fail. The rope bridle gives **2.41×**. It also shortens the cart from 83" to ~67", so it fits the truck fully assembled. No 24" tongue passed anywhere in the sweep. |
| Wheelbase | 48" | **44"** | The turning radius to the outer tyre edge was 97.25" at 48", against 96". At 44" it is 93.4". A shorter cart is also lighter and handier. |
| Steering lock | 38.5° | **37°** | The steel kingpin sleeve below pushes the kingpin 1.5" ahead of the axle, which narrows the nose the front tyres allow. At 37° the nose is 14.0", enough for feet and boots. The turning radius still passes because of the shorter wheelbase. |
| Kingpin | ½" grade 8, cantilevered from the beam | **¾" grade 8, through the beam *and* a chassis crossbar, in 1¼"-OD steel sleeves** | A front wheel hitting a 3" curb puts ~700 lbf through the kingpin. That is 2.4× over in the old design, where the pin stopped at the turntable top. Real wagons pin the axle to the chassis. The crossbar cuts the pin's bending lever from 2.9" to 1.1", and the sleeves spread the bearing into the oak. |
| Kingpin lead / front beam | 1.125" / 3.5" | **1.5" / 4.0"** | Leaves ½" of oak between the axle groove and the sleeve bore, and ¾" at each beam end (D-25 rules). |
| Axle rod | ¾" 1018 (50 ksi) | **¾" 1045 turned-ground-polished shafting (≈70 ksi)** | The rear axle at the 200 lb rider, with tyre side friction, was 3% over. A stronger steel at the same size beats a heavier 1" rod, which would need non-standard wheel bores. |
| Deck | 9 mm okoume on 12" joists | **12 mm okoume on 8" joists** | A 200 lb scout standing mid-panel deflected 0.069" in 9 mm against L/300 = 0.032". 12 mm on 8" gives about 0.01". Bending was never the problem. |
| Brake lever ratio | 10:1 | **12:1** | Costs nothing. Handle force to hold the 200 lb case on 15° drops from 28 to 20 lbf. |

Unchanged: track 35.5" (fits beside the wheel wells), 13" pneumatic wheels, 9" deck height, seat 12" ahead of the rear axle, ladder frame with captured okoume sides, storage over the rear axle, and auto nose geometry.

## Result

| Case | Mass | CG (x fwd of rear axle, height) |
|---|---|---|
| Empty | **126.9 lb** | 19.6", 9.2" |
| Transport (seat back, handle, signs off) | **116.7 lb**, 58 lb per person for two | 20.3", 8.3" |
| + 150 lb rider + 25 lb cargo | 301.9 lb | 16.0", 15.0" |
| + 200 lb rider + 25 lb cargo | 351.9 lb | 16.0", 15.7" |

### All checks
**0 failures** at 150 lb, 200 lb and the 80 lb rear-pitch case. Columns: "150", "200" and "80" are the rider weights in lb.

| Check | Value | Limit | 150 | 200 | 80 |
|---|---|---|---|---|---|
| Lateral tip, straight | 49.8° | ≥ 40° | pass | pass | |
| Lateral tip, full lock | 46.0° | ≥ 35° | pass | pass | |
| Slide before tip (SSF) | 1.13 | ≥ 0.75 | pass | pass | |
| Turn rollover speed | 9.2 mph | info (1.5× jog = 9.0) | info | info | |
| Turning radius, outer tyre edge | 93.4" | ≤ 96" | marginal (−2.7%) | | |
| Steering clearance (full sweep) | 0.76" | ≥ 0.70" | marginal | | |
| Forward pitch, braking downhill | 67° margin | > 0 | pass | pass | |
| Rearward pitch: pull to lift the front | 2.41× | ≥ 1.25× | pass | pass | pass |
| Brake handle force, 15° hold | 20.4 lbf | ≤ 30 | pass | pass | |
| Rear axle (vertical + tyre side load) | 25.2 ksi | ≤ 35 ksi | pass | pass | |
| Front / rear axle beams | 1035 / 115 psi | 6460 / 850 | pass | pass | |
| Axle groove bearing (⊥) | 299 psi | ≤ 358 | pass | pass | |
| Frame rails, static deflection | 0.10" | ≤ 0.15" | pass | pass | |
| Deck, standing scout | 0.01" | ≤ 0.02" | pass | pass | |
| Kingpin, bridle pull | 67 psi bearing | ≤ 358 | pass | pass | |
| **Kingpin, 3" curb strike** | 331 psi crossbar bearing | ≤ 358 | pass | **marginal (8%)** | |
| Roll: side-bearers / kingpin uplift / bolster bolts | 272 psi / 210 psi / 0.39 | 358 / 358 / 1.0 | pass | pass | |
| **Turntable rating** | 469 lbf | ≤ 500 (½ of 1000 lb rating) | pass | **marginal (6%)** | |
| Truck fit | fits **fully assembled**, beside the wells, both orientations | ≥ 1 case | pass | | |

### Qualitative sim
In the Simulation tab, the tilt-table cross-check lands within 0.6–1.0° of the static tip angles, straight and at full lock. Run the scenarios (downhill, curb strike, full-lock turn, braking) to get a feel for the cart. The Analysis tab is the real validation.

## Tradeoffs considered

- **Straddling the wheel wells for a wider track** (D-6, D-23): rejected. Lateral stability never limits this cart: the tip angles carry 30% or more margin at a 35.5" track. Straddling needs a wheelbase of 47" or more, which brings back the turning-radius problem. It adds ~7 lb and depends on exact well positions. **It stays available:** once you measure the bed, the Truck fit tab shows what each mode allows.
- **Bigger kingpin instead of the crossbar.** The sweep's answer was a 1" pin with a wider beam. It works, but costs steering clearance and weight, and leaves the pin as a cantilever. The crossbar is how wagons are actually built.
- **Wooden tongue:** rejected for rear-pitch safety and length. The steering leverage it offered isn't needed. The rope bridle on the axle ends gives ~18" of lever and is the traditional Klondike rig.
- **Smaller (10") wheels:** they would save ~6 lb and help the turning radius. They roll worse over roots and lose ground clearance under the axle beams. 13" kept for the trail.
- **Weight:** 127 lb empty is the honest number for the full-featured design (D-21). Every passing design in the sweep was 121–135 lb. The lightweight variant comes after Phase 4.

## Remaining marginal items (will be watched in Phase 3)
1. **Turning radius, −2.7%.** A shorter wheelbase or 38° lock would add margin but trade against the nose (feet).
2. **Kingpin curb strike at the 200 lb rider, 8%.** A deeper bolster crossbar (more bearing depth) fixes it in detailing. The load case is conservative: both wheels square into a 3" curb with the 3× dynamic factor on top.
3. **Turntable at the 200 lb rider, 6%.** Option: a heavy-duty steel fifth-wheel ring rated ≥ 1500 lb (~+2 lb).
4. **Steering clearance, 0.76 vs 0.70".** The auto nose sizes itself to this on purpose.

## Carried into Phase 3 (detail design)
- Steering stops mount to the lower turntable plate, which is chassis-side.
- Front U-bolts run down around an underslung beam.
- Crossbar bearing depth (item 2).
- The pitch moment path through the turntable (side-bearers carry roll only).
- Bridle tie points and rope spec.
- Lift handles at both ends (the transport lift is 58 lb per person).
