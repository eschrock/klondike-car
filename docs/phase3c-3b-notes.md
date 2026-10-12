# Phase 3c-3b: bump-model recalibration

Scope: `src/analysis/bump.ts`, `src/analysis/bump.test.ts`, and the bump params in `src/params.ts`. Nothing else was touched. Context: Eric's challenge (D-50, D-53, D-54) that a 1" bump at 5 mph put about 510 lbf on a front wheel that statically carries about 70 lb (7x). Aim: physical honesty, not a target number.

## 1. What was wrong

| Input | Before | Problem |
|---|---|---|
| Effective mass `m_e` | `1.5 x` the struck wheel's static load | Too big. A rigid cart struck at one wheel pivots about its other contacts; only a fraction of the total weight moves with the wheel. |
| Wheel rate `k` | 400 lb/in (assumed, "verify") | About right, but unsourced. Now derived from tire data (below). |
| Cross-check | none | No comparison to the conventional dynamic-factor approach. |

The velocity-pulse geometry itself (`sin(beta) = (r-h)/r`, `v_n = v cos(beta)`, `F_n = v_n sqrt(k m_e)`) is physically right for a rigid wheel meeting a sharp step and is unchanged.

## 2. Sources and derivations

### 2.1 Vertical stiffness of a 10" pneumatic hand-truck / caster tire

Catalog data found (no manufacturer publishes a deflection curve for this size; none was found):

- Marathon universal-fit 4.10/3.50-4 hand-truck tire: 10.5" diameter, 3.3" wide, 30 psi max, 300 lb max load. <https://hemlockhardware.com/products/701046-marathon-universal-fit-hand-truck-tire>
- VXB 2-pack 10" pneumatic hand-truck wheels: 300 lb per tire at 30 psi, 10" x 3.2". <https://vxb.com/products/2-pack-pneumatic-air-filled-10-inch-hand-truck-whe>
- Dynaline 80105 (same size) lists 280 lb; a PPI 4510 caster-type lists 352 lb at 35 psi; Colson's 10.5" solid-rim pneumatic lists 50 psi. Ratings run 280 to 352 lb at 30 to 50 psi. <https://checkout.cobaltindustrial.ca/products/dynaline-80105-pneumatic-hand-truck-wheel-10-410350-r4.oembed>
- For scale: a car-tire patent quotes radial rates of 1,000 to 1,200 lb/in at normal pressure (US 4,111,249, "Band reinforced radial tire"); a lab method defines the rate as load / deflection at a fixed load. <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4111249>

Derivation (no published lb/in figure exists for this tire, so this is an engineering estimate, flagged `verify`):

1. Rated load 300 lb, section height (10.5 - 4.0 rim) / 2 = 3.25". Small bias-ply tires are rated at roughly 15 to 20% section deflection, so the squash at rating is 0.5 to 0.65". Secant rate 300 / 0.6 = **500 lb/in** (range 460 to 600).
2. Contact-patch check: at 30 psi and a 2.7" wide footprint, 300 lb needs a 3.7" patch, i.e. a geometric squash of (3.7/2)^2 / (2 x 5.25) = 0.33". The sidewall adds to that, so 0.33" is a lower bound on squash and about 900 lb/in an upper bound on k.
3. Scaling a car tire (1,500 lb/in, 35 psi, 6" footprint) by pressure x footprint width x sqrt(R / delta): 0.32 x 1,500 = 480 lb/in.
4. Stiffness rises with pressure (at 15 to 20 psi, expect 300 to 350).

Result: `bumpWheelRateLbIn` = 500 lb/in (was 400), range 150 to 1,500, status `verify`. The note carries Eric's field test: stand a known weight on the cart over one wheel and measure the squash with a ruler against the hub; k = load / squash. A bathroom scale under the wheel and a ruler is enough. At rated load a 10" wheel should squash about 0.6".

### 2.2 Mass that participates at one wheel (rigid body)

Derivation, not a lookup. A free rigid body of weight W with radii of gyration `kx` (roll) and `ky` (pitch), given a vertical impulse J at a point (x, y) from its CG, moves that point at `dv = J (1/m + x^2/Iy + y^2/Ix)`. The effective weight at the point is

`W_c = W / (1 + x^2/ky^2 + y^2/kx^2)`

A uniform plate struck at its corner: `kx^2 = T^2/12`, `ky^2 = L^2/12`, corner at (L/2, T/2), so W_c = W / (1 + 3 + 3) = **W/7**. For a symmetric four-wheel cart each wheel carries W/4 statically, so the effective mass is **4/7 = 0.57 x the wheel's static load** (before: 1.5x; a factor 2.6 lower in mass, 1.6 lower in force).

On the real cart `cornerWeightLb` uses the wheel contacts (`contactsAt`), the case CG, and plate radii of gyration over the wheelbase x track. The wheel nearer the CG moves more of the cart, so the rear wheel gets about W/6 and the front about W/8. Param `bumpMassShare` (default 1, range 0.5 to 2) scales it for mass bunched in the middle (below 1) or piled at the ends (above 1).

Check on the free-body assumption: a 3-DOF simulation of the rigid cart on four 500 lb/in tire springs (the other three tires resist during the pulse) gives a peak within 3 to 6% of the closed form for a plate-like mass distribution (unit test `fourSpringPeak`). It is NOT valid for mass concentrated at the middle (radius of gyration 0.6 x the plate's): the simulation then gives 1.5 to 1.8x the free-body force because the other tires stiffen the system. Hence the lower range limit on the multiplier is a real risk, not a conservative one; if the cart turns out to be center-loaded (cargo piled over the box, rider in the middle), raise `bumpMassShare` toward 1.5.

Horizontal inertia of the cart (the whole cart must slow for the wheel to climb) is neglected: it adds about 7% to the compliance at the normal angle, i.e. the force is overstated by about 3 to 4%.

Related quasi-static rule, not a bump model: caster practice sizes each caster for the total weight divided by (N - 1), so one wheel can lift on a dock joint or bump (CasterHQ guidance, <https://casterhq.com/blogs/news/caster-load-capacity-calculator-weight-rating-guide>). For four wheels that is 1.33x the share, a static case already inside the 2 to 3x below.

### 2.3 Conventional dynamic load factors

What I could find, and its quality:

| Source | Value | Quality |
|---|---|---|
| Latvian tipping-trailer frame paper: dynamic coefficient on fortified roads and terrain without considerable irregularities; rougher terrain handled by lower speed (<https://iitf.lbtu.lv/conference/proceedings2021/Papers\TF117.pdf>) | 1.5 | Peer-reviewed paper, smooth ground |
| Caster-industry sizing guidance (CasterHQ): 1.25 to 1.33 general, 1.5 for impact or outdoor service, per-application matrix up to 3 for hand-pushed carts, speed derate 0.8 at 3 to 8 mph, shock derate 0.7 to 0.85 | 1.5 to 3 | Vendor guidance, not a standard |
| Blickle safety factor S for manual indoor use, DIN EN 12527 to 12533 / ISO 22878 to 22884 (<https://www.blickle.com.au/guide/load-capacity>) | 1.0 to 1.5 | Manufacturer summary of the standard |
| Forum recollection of a truck and trailer handbook: 3 g on road, 5 g off road | 3 to 5 | Anecdotal, weakest |
| Dexter Axle: dynamic loading and trailer design "can significantly affect" an axle; the trailer maker must test | no number | Manufacturer caveat |

Not retrieved (paywalled or no number found): EN 1757 (pedestrian-propelled trucks), ANSI MH31.1, EN 12530 test loads, ASABE trailer standards. I could not confirm a published 2 to 3x design factor, so `bumpDlfCheck` = 3 is an engineering convention from vehicle practice (design the structure for roughly 2 to 3 g at the wheel on ordinary rough ground), not a quoted standard. Eric should treat it as a yardstick, not a limit.

Cross-check implemented: every strike carries `conventionalLb = bumpDlfCheck x static wheel load` and the `how` text of every bump row now prints it with the ratio. The rows are NOT capped to it: a square 1" step at jogging pace is not the "ordinary rough ground" that factor describes.

Second cross-check (independent form): the classic impact formula `F/W_e = 1 + sqrt(1 + 2H/d_st)` with the equivalent free-drop height H = v_n^2 / 2g (3.6" for the 1" step at 5 mph) and d_st = W_e / k reproduces the pulse force plus the static weight of the effective mass (422 lbf vs 380 + 40 for the 70 lb wheel, 1", 5 mph: 1 + sqrt(1 + 2 x 3.6 / 0.08) = 10.55, x 40 lb); it is the same energy balance written another way. `BumpStrike.dropEqIn` reports H.

## 3. Before and after

Setup: 10" wheel (r = 5"), symmetric four-wheel cart (W = 4 x static wheel load), sharp square step. Before: `m_e = 1.5 W_s`, k = 400. After: `m_e = 4/7 W_s`, k = 500. Force in lbf, factor = force / static wheel load, "conv" = 3 x static.

| Static wheel | Step | Speed | Before lbf | Before x | After lbf | After x | Conv. lbf |
|---|---|---|---|---|---|---|---|
| 70 | 1" | 3 mph | 330 | 4.7 | 228 | 3.3 | 210 |
| 70 | 1" | 5 mph | 551 | 7.9 | 380 | 5.4 | 210 |
| 70 | 2" | 3 mph | 441 | 6.3 | 304 | 4.3 | 210 |
| 70 | 2" | 5 mph | 734 | 10.5 | 507 | 7.2 | 210 |
| 150 | 1" | 3 mph | 484 | 3.2 | 334 | 2.2 | 450 |
| 150 | 1" | 5 mph | 806 | 5.4 | 556 | 3.7 | 450 |
| 150 | 2" | 3 mph | 645 | 4.3 | 445 | 3.0 | 450 |
| 150 | 2" | 5 mph | 1,075 | 7.2 | 742 | 4.9 | 450 |
| 250 | 1" | 3 mph | 624 | 2.5 | 431 | 1.7 | 750 |
| 250 | 1" | 5 mph | 1,041 | 4.2 | 718 | 2.9 | 750 |
| 250 | 2" | 3 mph | 833 | 3.3 | 575 | 2.3 | 750 |
| 250 | 2" | 5 mph | 1,388 | 5.6 | 958 | 3.8 | 750 |

Hand check, first 5 mph row: r = 5, h = 1: sin(beta) = 0.8, cos(beta) = 0.6; v = 88 in/s; v_n = 52.8 in/s; m_e = 40 lb / 386.1 = 0.1036 lb s2/in; sqrt(500 x 0.1036) = 7.197; F_n = 380.0 lbf; H = 228, V = 304.

The same cart as built (defaults at the time of writing: 13" wheels, wheelbase 44", goal 200 lb rider, 5 mph, k 500). The other agent (3c-3a) is replacing the wheels and body, so these will move.

| Case | Wheel | Static lb | W_c lb | Old 1" lbf (x) | New 1" lbf (x) | New 2" lbf (x) |
|---|---|---|---|---|---|---|
| Empty (146 lb) | front | 34 | 18 | 342 (10.0) | 229 (6.7) | 310 (9.1) |
| Empty | rear | 42 | 24 | 379 (9.0) | 260 (6.2) | 351 (8.4) |
| 150 lb rider (321 lb) | front | 76 | 39 | 511 (6.7) | 332 (4.4) | 450 (5.9) |
| 150 lb rider | rear | 96 | 54 | 573 (6.0) | 393 (4.1) | 532 (5.5) |
| 200 lb rider (371 lb) | front | 90 | 45 | 555 (6.2) | 359 (4.0) | 486 (5.4) |
| 200 lb rider | rear | 110 | 62 | 613 (5.6) | 420 (3.8) | 569 (5.2) |

The "510 lbf on a 70 lb wheel" Eric cited now reads 332 lbf on 76 lb (4.4x) for the 150 lb rider's front wheel at 5 mph.

## 4. The honest answer

The correction (rigid-body mass, k = 500) lowers the force by about 33% (the fixed ratio sqrt(0.57 x 500 / (1.5 x 400)) = 0.69). It does not make the multiples small. For a sharp square 1" step:

- At walking pace (3 mph) the multiples are 1.7x to 3.3x, bracketing the conventional 2 to 3x.
- At 5 mph they are 2.9x to 5.4x. A 1" step at jogging pace equals dropping the corner mass 3.6" onto a 500 lb/in spring. That is a hard knock for a 10" hand-truck wheel and the physics says so.
- The light front wheels are hit hardest in multiples (force goes as the square root of the mass, the static load as the mass): empty front wheel 6.7x, 70 lb wheel 5.4x, 250 lb wheel 2.9x.
- The 2" hard hit at 5 mph on a 70 lb wheel is 7.2x (507 lbf). It is the fail-safe case (ultimate / 1.25), not a normal-use case.

Things the model does not credit and that would lower the numbers (all uncertain, so none is included):

1. The tread envelops a sharp edge (local indentation is softer than the radial rate); a rounded root or a ramped bump is easier than a square step. Edge rounding alone changes little: even a half-round root of radius h only cuts v_n by about 8%.
2. Tire damping and the compliance of the wooden frame and handle.
3. The handlers slowing the cart for a bump they see.

And one that would raise them: mass bunched mid-cart (see 2.2), and tire bottoming. Peak squash is F / k; above about 60% of the section height (1.9") the rim is reached and the rate jumps. The worst row in the table (250 lb wheel, 2", 5 mph, 958 lbf) squashes 1.9", right at that limit; the 70 lb wheel 2" hit (507 lbf, 1.0") is not.

Knobs for Eric, in order of effect on the result: `bumpSpeedMph` (force is proportional to speed), `bumpNormalHeightIn` (0.75" at 5 mph is about 25% lower), `bumpWheelRateLbIn` (force goes as sqrt(k): x0.5 gives 0.71, x2.5 gives 1.58), `bumpMassShare` (sqrt).

## 5. What changed

`src/analysis/bump.ts`
- New `rigidCornerWeightLb`, `plateGyration`, `cornerWeightLb(ctx, c, wheel)` (uses `contactsAt`, the same source `wheelLoads` uses).
- `bumpPulse` takes optional `meWeightLb` (rigid-body weight) and `dlfCheck`; the old `massShare x staticLb` form still works when `meWeightLb` is absent, so existing callers and the old test pins are unchanged.
- `BumpStrike` gained `meWeightLb`, `dropEqIn`, `conventionalLb`. The `bumpText` signature is unchanged; it now prints m_e as the rigid-body weight and the conventional comparison.
- `bumpStrike` now builds `meWeightLb = bumpMassShare x cornerWeightLb`. `sensitivityText`, `bumpCases`, `bumpSeatG`, `seatFactor`, `peakVertical`, `goodmanPulsating` have the same signatures.

`src/params.ts` (targeted): `bumpWheelRateLbIn` 400 -> 500 with the derivation and measuring note; `bumpMassShare` redefined as a multiplier on the rigid-body corner mass (default 1, was 1.5 x static); new `bumpDlfCheck` (3, cross-check only).

`src/analysis/bump.test.ts`: 13 tests (5 old, two of them adapted; 8 new) with the hand calculations above, including a four-spring simulation cross-check.

## 6. Assumptions to verify

1. Tire rate 500 lb/in: measure squash by standing on the cart at one wheel (target: about 0.6" at 300 lb; at the real 150 lb cart load per wheel about 0.3").
2. Tire pressure: the rate scales with it. Inflate to the sidewall value (30 psi).
3. Mass distribution: radii of gyration are those of a uniform plate over the wheel footprint. Rocking the loaded cart on one wheel will not show it; a cheap check is the loaded cart's pitch period on its tires.
4. The 2 to 3x conventional factor is not from a standard I could read (EN 1757, ANSI MH31.1 not available to me).
5. Swivel casters (3c-3a) add trail and fork compliance not modeled; the front wheel rate is for the tire only.
6. Other tests that now fail because the loads dropped (rows that used to fail now pass): see the final report; none is in the bump files.
