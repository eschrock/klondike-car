# Phase 3b WS-C: brakes and rider brake controls

Status: Stage 1 done. Typecheck clean, my four test files pass (`model/brake-front.test.ts` 19, `analysis/brake-ride.test.ts` 22, plus the old `brake`/`rear`/`rear-mount` suites unchanged). Full suite: one red test that is not mine (see "Handoffs", item 1). Numbers below are from the model at `phase3bDefaults()`, operating rider 150 lb + 25 lb cargo (357.7 lb) and goal rider 200 lb + 25 lb (407.7 lb).

## What changed, in one paragraph

Every new behavior is behind `frontBrakeType` 0, `brakeShoeBacking` 1 and the new `rideBrakeControls` 1. Those three live in `PHASE3B_DEFAULT_OVERRIDES` (the Stage 0 pattern); `defaultParams()` keeps the old rear-only cart (types 2 / 0 / 0), so the 1,400-odd old tests are untouched. `phase3bDefaults()` gives the new cart.

## Files

New model: `src/model/brake-front.ts` (geometry + parts), `src/model/brake-controls.ts` (hip lever, cable, lost-motion plate, lap belt). New analysis: `analysis/brake-chain.ts` (shared formulas), `analysis/brake-ride.ts` (the rows), `analysis/brake-sweep-front.ts` (front sweep). New tests: `model/brake-front.test.ts`, `analysis/brake-ride.test.ts`.
Edited: `model/brake.ts` (lined-shoe option, exports), `analysis/brake.ts` (ratio, force, clearance rows; `scaleLimits` now local), `analysis/brake-mount.ts` and `rear.ts` (`boltCapacity` now from `./nds`), `model/index.ts` (two builders), `analysis/index.ts` (`...brakeRideRows(ctx)` in `ackermannRows`), `params.ts` (below), `sim/spec.ts` (front share wiring, one line plus two imports).

## Mechanism

**Front brake (per knuckle).** A lined tread shoe sits on the FRONT of the tread (`frontBrakeShoeAngleDeg`, 0 deg = at the axle line) on two swing arms. The arms pivot on a pin carried by a horn plate bolted to the spindle brake boss, inboard of the tire, and a yoke (crossbar in front of the tire plus an outboard plate) supports the other end of the pin. Everything is on `steer-L` / `steer-R`, so the shoe keeps its gap to the tire at every steer angle by construction. A 1/4" 7x19 Bowden cable pulls the arm tail. Its housing ends in a clamp on the kingpin axis (above the upper bracket leaf), so the chord from the knuckle's housing stop to the clamp is the same at every steer angle (0.00 in change over the sweep): the housing only twists, bend radius 2.6" (min 2.5").
**Rear.** Shoes are purchased lined steel-backed (0.125" back + 0.25" lining, 3.0" x 3.7", about 0.67 lb each), on the existing arms and pin. Geometry, ratio and tail solve are unchanged.
**Split.** A balance (bias) bar on the main lever tail pin splits the lever force. The front cable lug is `a_f` from the lever pin and the rear link `B - a_f` (B = 3.0"), so the front branch gets phi = 1 - a_f/B of the force; `a_f` is solved so the front share of the total shoe normal force equals `frontBrakeBias`. Result: a_f 1.24" of 3.0", phi 0.587. This is a closed-form solve (the spec says bisection; it is a one-line algebra and a bisection checks it).
**Front arm offset (a choice you did not ask for).** The rear arm has a friction-line ratio |Kt/Kn| of 0.395, so its force-per-hand-force changes by +/-18% between rolling directions. If the front arm were tangent to the tread (no offset) the front/rear split would drift with direction and pad mu by about +/-8 points. I offset the front pivot by the same ratio (rho x arm length = 1.98"), so the split is 0.600 forward and 0.600 backward at any mu. The spec's "0.5 +/- 0.02 in both rolling directions" is therefore met (test: 0.4, 0.5, 0.55, 0.6 all within 0.02).
**Equalizer.** A rocker under the nose deck, equal pull to both knuckles.
**Hip lever.** 1/4" x 1" 6061 bar, pivot on a bracket on the left chine inner face, 9" arm, cable lug 1.5" below the pivot, 45 deg throw (7.07" at the grip), return spring. Cable: 5/32" 7x19 in a Bowden housing, channel (printed ASA) along the chine inner face to the storage box, one grommeted hole through the chine just ahead of the box fore end (x 6.4), then OUTSIDE the chine aft to a housing stop behind the main lever; 3.1" of bare inner cable runs forward to a pin in a slotted plate on the INBOARD face of the main lever, 4.1" above its pivot. Pulling the cable into the housing pulls the pin aft = applies the main lever. The slot (1.4") exceeds the main lever's full link-point stroke (1.00"), so the handler's lever moves 0.40" free of the cable (lost motion) and neither lever back-drives the other.
**Parking.** Unchanged: quadrant and pawl on the main lever hold both axles. The hip lever sets the brake and the pawl catches; only the main lever's thumb tab releases it (handler).
**Lap belt.** Two steel anchor plates on the deck at the chine (x = seat H-point), two 3/8" 316 bolts each through the deck, the rail and a 3/16" steel doubler strap under the rail; 2" webbing, quick-release buckle (webbing drawn as stubs only).

## Deviations from the spec, and why (read these)

1. **The front brake does not halve the hold force.** Spec 4.1 says the hold force falls from 25 lbf to about 13. By virtual work it cannot: hand force x grip stroke = sum of N x shoe stroke, and the four shoes need the same total N to hold (mu_pad x N_total = W sin 15 deg) with the same 5/16" stroke each. The model agrees: total ratio 14.9:1 (rolling backward, the critical direction) vs 14.4:1 rear-only, hold force 24.2 lbf (operating) / 27.6 lbf at the HIP grip for the goal rider (22.2 / 25.3 at the main grip). What the front brake does buy: braking capacity at the ground (two more tires), parking margin (park-hold 1.87 vs 1.0 rear-only) and stopping distance on a slope. The only way to cut hand force is more grip travel or less shoe stroke.
2. **Bias 0.60, not 0.50.** With the CG 17.2" ahead of the rear axle and 14" high, the REAR axle slides first below a front share of 0.56 (operating) / 0.565 (goal) at tire-ground mu 0.5, on every slope 5-10 deg (the lock order does not depend on slope here). Rear-first slides sideways; the spec's own rule is "front locks no later than the rear" and "share in 0.4-0.6". 0.60 is the only value that satisfies both. At mu 0.7 the rear still slides first (0.46 g) but that needs 70+ lbf at the hip, beyond the 50 lbf limit, so it cannot be reached by hand.
3. **Lined shoe sizes.** Spec: 4" x 2.5" for all four. Reality: the rear shoe sits 11 deg below the axle line, and a 4" shoe puts its released corner 3.06" off the ground (limit 3.5"; 3.25" gives 3.41"); at 3.0" the lowest rear part is the crank clevis at 3.51" (the same as the oak cart). So the REAR shoe is 3.0" x 3.7" (the 4" tire leaves 3.7"), and the FRONT shoes, at the axle line where length costs no clearance, are 5.5" x 3.7". Params: `brakeLinedShoeLengthIn` 3, `brakeLinedShoeWidthIn` 3.7, `frontBrakeShoeLengthIn` 5.5, `frontBrakeShoeAngleDeg` 0.
4. **Heat target vs the spec's contact fraction.** Spec expects ~570 ft at 8 deg for four 4"x2.5" lined shoes, but with `brakeHeatContactFrac` 0.5 (also spec) the same formula gives 160-170 ft: the 570 figure only follows with a contact fraction of 1. With the shoe sizes above the operating rider gets 308 ft (limit 300): a pass by 3%, so treat it as marginal. See the heat numbers below; it is the row most worth a bench test.
5. **Hip lever moved 2" forward and 0.5" inboard** (`hipLeverAheadOfHpointIn` 5, `hipLeverInsetIn` 1.5): the gunwale lash eye and its doubler occupy x 13.5-15.5, y 12.4-13.4, which the lever and its swing hit at the spec position (overlap suite caught it).
6. **Hip cable is 5/32", throw 45 deg.** At the 100 lbf abuse pull the hip cable carries 600 lbf (100 x 9" / 1.5"). 1/8" 7x19 breaks at about 1,760 lbf, a factor of 2.9 against the required 3.5; 5/32" gives 4.6. At 1/8" with the spec's 40 deg throw the cable stretch (0.07") uses up the 0.05" of cable travel left after the main lever's 1.00" link stroke, so the throw is 45 deg (cable travel 1.18").
7. **Hip cable route.** The storage box leaves only 0.125" off the chine (the spec says 0.5"), so the cable cannot run inside past it. It goes through the chine just ahead of the box and OUTSIDE aft to the lever; the housing stop behind the lever is a joinery item (bracket to the transom end) not modeled as a joint. The main run front cable (about 57") passes under the deck through the joists and the rear axle beam: holes needed in `joist-cabin-*` and `beam-R` (frame owner), drawn only as the 4" exposed at the bias bar so it does not collide.
8. **Front cable and housing stretch** is a real cost: 57" main run + two 21" outers at the hold force stretch 0.09" (1/4" cable, effective modulus 3.5 Mpsi including housing compression), which adds 0.78" to the main grip travel (6.49" of the 6.5" limit at the goal rider). A 3/16" cable would be 6.66" and fail. `bowdenEffModulusPsi` is a verify item; a bench test of one run replaces it.
9. **Mass is much more than the spec's 5.3 lb.** See Mass.
10. **Pins are 17-4 PH stainless (100 ksi yield assumed).** The wide lined shoe loads the 1/2" shoe pin to 40 ksi at the 100 lbf abuse pull; A36/316 annealed (36 ksi) cannot take it. New param `brakeShoePinYieldPsi` (36,000 old, 100,000 phase3b).

## Numbers per check (operating 150 lb / goal 200 lb)

| Row | Operating | Goal | Limit | Note |
|---|---|---|---|---|
| brake-ratio | 14.4:1 rear / 14.9:1 total (back), 21.2 fwd | same | >= 12 | front branch 15.2:1 alone; grip travel 5.71" rear-only, 6.39 / 6.49" with front cable stretch (limit 6.5) |
| brake-force (hold 15 deg, mud-fouled mu 0.35) | main 22.2, hip 24.2 lbf | main 25.3, hip 27.6 lbf | <= 30 | hip = 0.927 x main / cable efficiency 0.85 |
| brake-emergency (0.30 g, 8 deg) | hip 38.3 lbf | hip 43.7 lbf | <= 50 | main 35.2 lbf operating |
| brake-stop (10 mph, 1 s reaction, mu 0.5) | 31.5 ft at 8 deg, 36.0 at 10, 26.3 at 5 | 31.2 ft at 8 | <= 40 (8), <= 55 (10) | mu 0.4: 39.1 ft, mu 0.3: 56.9 ft at 8 deg. Limited by tire traction (front slides first at 0.341 g), not by the 50 lbf hand |
| brake-bias | front share 0.600 fwd and back | same | 0.4-0.6, front first | lockup at 8 deg mu 0.5: front 0.34 g, rear 0.42 g. At bias 0.5 the rear slides first (front 0.47 g / rear 0.34 g): row fails |
| brake-heat (lined, 8 deg) | 308 ft | 237 ft | >= 300 | 10 deg: 178 ft; 15 deg: 70 ft; oak shoes: 21 ft. Rear shoes are the hotter ones (3.0" x 3.7") |
| park-hold (15 deg, both axles) | 1.87x at mu 0.5 | 1.87x | >= 1.5 | 1.12x at mu 0.3 (info); rear-only was 1.0x with no margin |
| brake-front (structure) | pass, worst grip travel 6.39" (0.98) | marginal, 6.49" (1.00) | util <= 1 | swing arm 0.77, horn bending 0.61, pivot pin and shoe pin under 0.5; shoe gap 0.31" (stroke 0.3125), arms to tire 0.15", parts to hull 5.2", housing bend radius 2.6" |
| hip-cable | pass; cable SF 4.6, lug reserve +0.11" | marginal (hold force 27.6 lbf, 0.92) | SF >= 3.5 | lost-motion slot spare 0.40" |
| belt-anchor (ultimate) | pass | pass | no SF | goal: 1,000 lbf over two anchors, 500 lbf each, 250 lbf per bolt; bolt tension 21 ksi vs 100 ksi, webbing 6,000 lbf |
| brake-abuse, brake-shoes, brake-lever, brake-links, brake-shaft, brake-ratchet | pass; abuse marginal 0.94 | | | rear members are held at the full lever load (front cable failure case), so they are unchanged except the shoe pin |
| brake-clear | pass 0.158" (limit 0.1) | | | front sweep: 25 steer angles from the outer to the inner tow lock |

**Brake-steer through the knuckle.** Each front wheel's ground brake force acts 3.0" (hub-height scrub) or 2.32" (ground level, after the 6 deg KPI) from the kingpin: at the 2x hold sizing load 244 / 189 lbf.in per wheel (about 130 lbf.in at the 0.30 g stop). Equal on both sides they cancel in the tie rod (the equalizer keeps them equal). A 20% left/right imbalance leaves 98 lbf.in = 36 lbf in the drag link at the sizing load, which is about 3.8 lbf at the stick grip in ride mode (T = 36 lbf on a 1.5" cable arm over the 14" stick) and about 2 lbf at the 0.30 g stop. One wheel braking alone (a cable fault) is five times that, 15-20 lbf at the grip: stops, not the hand, hold it.

## Envelope implications

- Ride-envelope table (`analysis/ride.ts`, WS-D) uses the front share +/-0.1. With bias 0.60 its 8 deg / mu 0.4 corner reads 0.161 g (CAUTION) instead of 0.2 g (GO). At the real solved share (0.600, no tolerance) that corner is 0.218 g and 10 deg / mu 0.5 is 0.292 g. The solved share is accurate to +/-0.02 (a bench-set bias bar, a lining mu difference of 0.1 moves it more), so a tolerance of +/-0.05 is honest. The camp-test rule "GO needs mu 0.4 up to 8 deg" holds at the solved share and fails at +/-0.1 around 0.6.
- 10 mph from 8 deg stops in 31.5 ft (40 ft limit) including 16.4 ft of reaction; 36 ft on 10 deg.
- Heat: 308 ft of continuous braking at 8 deg for the operating rider (237 ft at 200 lb), 178 ft at 10 deg, 70 ft at 15 deg. A 300 ft ride run on 8 deg is on the edge; 10 deg needs a stop every ~175 ft. The contact fraction 0.5 is a guess (flat shoe on a round tire; a conforming shoe is nearer 0.8, which would make it about 2.5x better); bench-test it.
- Oak shoes (the old cart) allow only 21 ft at 8 deg: ride mode needs the lined shoes.
- The rider can set the brake but cannot release the pawl, so with a spring pawl the hip lever ratchets. The rider cannot modulate DOWN once a tooth is caught (see open questions).

## Mass (lb)

Brake group 15.98 -> 31.01 (+15.0); cart 169.0 -> 182.7 (+13.6 including hardware remainder); the spec budgeted 2.5 + 1.4 + 1.4 = 5.3.

| Item | lb |
|---|---|
| Front brake, both sides (horns 1.1, arms 4 x 0.5, yokes, pins, two 5.5" x 3.7" shoes 2.3, cables 0.8, equalizer, bias bar) | 10.2 |
| Hip lever, bracket, channel, cable, slot plate, stop | 1.6 |
| Lap belt, anchors, doublers | 2.0 |
| Rear lined shoes vs oak pad + lining + shield | +0.7 |

Trim candidates if the weight matters: the arm bars run 11" from the cable tail through the pivot to the shoe (0.8 lb each, 3.2 lb in all); shortening the cable tail with a pulley or a bellcrank, and narrowing the arms to 3/4", is worth about 1.5-2 lb; the 5.5" front shoes could be 4.5" at a 14% heat penalty (-0.5 lb); the horn could go to 3/16".

## Params added (all in the `brake` group, exact-string edits)

Gating: `rideBrakeControls` (0 old, 1 phase3b). Shoes: `brakeLinedShoeLengthIn` 3, `brakeLinedShoeWidthIn` 3.7, `frontBrakeShoeLengthIn` 5.5, `frontBrakeShoeAngleDeg` 0, `brakeShoePinYieldPsi` 36,000 / 100,000. Front: `frontBrakeArmLenIn` 5, `frontBrakePivotPinDiaIn` 3/8, `frontBrakeCableDiaIn` 1/4, `frontBrakeHousingMinBendIn` 2.5, `brakeBiasBarIn` 3, `bowdenEffModulusPsi` 3.5e6, `brakeCableBreakPsi` 112,600 (MBS = this x d^2), `frontBrakeImbalanceFrac` 0.2. Hip and belt: `hipLostMotionSlotIn` 1.4, `hipLinkAboveLeverPivotIn` 4.1, `hipCableEfficiency` 0.85, `beltWebbingBreakLbf` 6,000, `beltAnchorBoltDiaIn` 3/8, `beltAnchorBoltUltPsi` 100,000, `beltAnchorDoublerThickIn` 3/16. Heat: `brakeRollingCrr` 0.03, `brakeHeatPartitionOak/Lined` 0.7 / 0.5, `brakeEffusivityOak/Lined` 550 / 450.
Changed defaults: `frontBrakeBias` 0.6, `hipLeverAheadOfHpointIn` 5, `hipLeverInsetIn` 1.5, `hipCableDiaIn` 5/32 (step 1/32), `hipLeverThrowDeg` 45; `frontBrakeType` (2 old / 0 new) and `brakeShoeBacking` (0 / 1) moved into the overrides. The rear params validator (`padLow` ground clearance) now reads the lined shoe length.

## Handoffs to other workstreams

1. **WS-D `analysis/ride.ts` / `ride.test.ts`:** `ride-envelope is an info row; its two GO corners...` is red because of the bias default (0.6 +/- 0.1 puts 0.7 in the worst-case set). Use +/-0.05 (or the solved share's real tolerance) in `worstBiasDecelG`, or accept CAUTION at 8 deg / mu 0.4 and raise `rideMuGo8` to 0.5. I did not edit their file.
2. **WS-E:** done: `sim/spec.ts` now defaults `frontBrakeShare` to `frontBrakeShare(p, computeLayout(p))` from `model/brake-front.ts` (mean of the forward / backward shares, 0.60; `null` and so the old 0.5 fallback when `frontBrakeType` is not 0, which keeps the 28 sim tests green on `defaultParams()`). `SpecOptions.frontBrakeShare` still overrides. The Simple view's "stops in about N ft" reads `brake-stop` (value = feet at the envelope slope).
3. **Simple-text ids** exist already for `brake-stop/-emergency/-heat/-bias`, `park-hold`, `brake-front`; I added `hip-cable` and `belt-anchor` (both already in `GROUP_OF_ID`); they need plain names and failure sentences in `ui/simple-text.ts` if not present.
4. **WS-A / frame owner:** `Layout.front.knuckle.shoePivot` (provisional) is not used by me; the front brake is derived locally from `brakeShoeThickIn`, the arm length and the friction-line ratio. Needs: a spindle brake boss (2 x 5/16" bolts) for the horn, an eyelet/clamp on the kingpin axis above the upper bracket leaf for the housing end (`housingAnchor`), and a grommet/hole through the nose rail for the two outer housings (I drew none). The equalizer sits under the nose deck at x = `xn + 5.5`, z = beam top + 0.8; it overlaps the OLD turntable stack, which goes away.
5. **Frame / joinery owner:** holes in `joist-cabin-*` and `beam-R` for the 57" main cable; a bracket to the rear transom end for the hip housing stop; a 1/4" hole in the left chine at x 6.4 for the grommet; four vertical 3/8" bolt holes through the deck and rails at x = H-point for the belt anchors.
6. **Model-test ALLOW list:** none needed. I named the front arms, pivot pins and yoke `brake-shoe-arm-F*`, `brake-shoe-pivot-F*`, `brake-shoe-yoke*` so the existing "brake-shoe vs wheel" allowance covers the tire's conservative box.
7. **Hull:** nothing from me beyond what the clearance rows already say (front parts to hull 5.2" at the sweep worst case; the nose half width is derived from the sweep exactly as WS-B does, `noseOuterHalf` in `brake-front.ts`).

## Open questions and purchased-part choices

1. **Spindle brake boss.** The horn assumes a boss on the spindle (2 x 5/16" bolts, 1.5" tall plate bending). Real kart spindles vary; the boss and the spindle bending near it are the first thing a load test should cover. The horn at the boss carries the pivot reaction of 377 lbf at the 2x sizing load, 5.4" out: 0.61 of the 18 ksi allowable.
2. **Lined shoe part.** A 3.0" and a 5.5" shoe, 3.7" wide, 0.125" back + 0.25" lining, radius 6.5"+: not a stock item that I know of. Candidates are go-kart or industrial band-brake linings riveted to a bent 1/8" back, or a custom bent strap with a molded lining sheet. Part number to confirm; the model uses a parametric stand-in (mass 0.67 / 1.2 lb).
3. **Contact fraction and lining mu** (0.5 and 0.45 wet / 0.35 fouled) drive the heat and force rows; bench-test one lined shoe on a wet tire.
4. **Cable and Bowden stiffness** (`bowdenEffModulusPsi`) sets the front cable's grip-travel loss (0.78" at the goal hold force). A bench test of a 57" run with a lever and a scale: stretch vs load.
5. **Ride-mode ratchet.** A spring pawl catches on the way up; the rider cannot release it (spec), so he cannot modulate down. Proposal: a pawl keeper (a spring-loaded detent that holds the pawl lifted) for ride mode, parking mode drops it. Not modeled; the parking-hold row assumes the pawl is engaged.
6. **Bias bar.** It makes the split a lever-arm ratio, but a 1/4" shift of the front lug moves the share by about 4 points. Two scales on the mock-up set it; add a slotted lug with a lock screw.
7. **Hip cable friction** (0.85) over a 35" run with two bends is a guess. If it is 0.7 the goal-rider hold force at the hip is 33 lbf (fails).
8. **Front shoe at the axle line** sits ahead of the tire, where the tire's mud and spray arrive first; the fouled mu (0.35) is used for it as for the rear.
9. **Lap belt** webbing path across a rider's lap and the buckle position are not modeled (anchors and stubs only).
