SCORE: 7/10

# Phase 2 checkpoint review, round 2 (analysis) and round 1 (recommendation)

`npm test` 468/468 pass, `tsc --noEmit` clean. I regenerated the table with `node scripts/run-ts.mjs scripts/recommend-table.ts`: **every number in the doc's table matches the code**. The link hash matches `encodeHash`. Hand checks and ablations (revert each change in turn, then evaluate) were done with a throwaway script, since deleted.

**Verdict.** The analysis fixes from round 1 are essentially all in, and the recommended configuration is a coherent, mostly justified design with 0 fails. The score is held at 7 because:
1. The doc misstates several numbers.
2. The headline kingpin-strike margin hides an unresolved moment path.
3. The steering stops, which a one-wheel curb strike loads, are not checked at all.
4. The bridle rig that replaces the tongue is validated by neither the analysis (steering) nor the sim (it pulls from one point).

None of these needs a redesign. Items 1, 2 and 4 are wording and presentation plus short carry-overs. Item 3 needs one carry-over line with a number.

## 1. Analysis round-1 fixes

| R1 issue | Status | Verification at the recommended config |
|---|---|---|
| H1 obstacle strike on the kingpin | **Fixed**, with a caveat on the moment model (A1, A2 below) | 3" curb, both wheels, goal: V_w = 78.2 × 3 = 234.7 lbf, cos φ = 3.5/6.5, tanφ = 1.56, H = 2 × 367 = **735 lbf** ✓. τ = 1663 psi, M = H × 1.077" = 791 lb·in, σ = 19.1 ksi (allowable 65), crossbar bearing 735/(1.25 × 1.778) = **331 psi** vs 358 ✓ |
| H2 roll path (side-bearer, uplift, bolster bolts) | **Fixed** | F_sb = 235.3 × 17.75/6.81 = 613 lbf, U = 613 − 235 = 378 lbf up the bolt, 272 psi bearer, 210 psi washer ✓. The bolster fasteners (4 × ¼" A307) are *assumed*, not designed |
| H3 pitch-rear (T_lift, light rider, rope-run param) | **Fixed** | 80 lb case: W = 231.9, CG (16.1", 13.29"), T_lift = 2798/9.70 = 288 lbf, **1.92×** ✓. See R1 and R6 for what the doc does with it |
| M1 turn radius to the tyre edge | **Fixed** | I rebuilt the geometry by hand: axle centre (44.30, −0.90), IC y = 57.9", outer wheel (54.98, −15.08), R = 91.4" + 2.0" = **93.4"** ✓ |
| M2 C_M ⊥ = 0.67 | **Fixed** | 1070 × 0.67/2 = 358.45 ✓ |
| M3 rails self-weight | **Fixed** | UDL present |
| M4 front axle on the slope | **Fixed** | front axle = max(level 128.2, nose-down 156.5) ✓ |
| M5 tyre side load on the axle | **Fixed** | Rear: M_v = 336.3 × 2 + 56.1 × 6.5 = 1037 lb·in, σ = 25.2 ksi ✓ |
| D1 deck effective width | **Fixed.** The joist-snap oddity is also fixed (the joist is replaced by one on each side of the beam) | b_eff = 10 + 0.625 × 6.8 = 14.3", δ = 0.011". Robust: even with no load spread (b_eff = 10") δ ≈ 0.016" < L/300 = 0.023" |
| D3, D5, D6 notes | Partly. D6 (peak bearing is at least 2× the average for a rigid pin) is noted in `how` but never used | see A2 |
| L1 pitch-fwd | **Fixed** | cosθ form |
| L2 brake wet-pad sensitivity | **Fixed** | |
| **L3 steering-exclusion regex** | **Not fixed, slightly worse.** `fixed` now excludes the whole `steering` group (bolster, crossbar, sleeves) and `kingpin`, as well as the regex. Vertical separation makes this harmless today, but the sweep is blind to the bolster and crossbar | low |
| P1, P2, P4, P6 (chips, utilisation, C_M, rope run) | **Fixed** | |
| P3 (which parts the shear plane crosses) | **Fixed** in the `how` text, but the footnote is stale (P1 below) | |

### New analysis findings

**A1. The "equal-lever" kingpin moment `a = g/2 + min(D1, D2)/2` is not derivable from equilibrium.** Severity: medium. Location: `structure.ts:406-418`.
- A pin loaded by two opposite forces H at different heights has an unbalanced couple. The couple must come from a pitch moment path (side-bearers, turntable, non-uniform bearing).
- H enters the beam at axle height z = 6.5". The beam's mid-depth is 5.6".
- The side-bearers are centred on the kingpin x (44.6–46.1 against 45.5), so they have almost no fore-aft lever. The doc admits this in Phase 3 item 4 ("pitch moment path").
- **Bounds.** Even with the full centre-to-centre lever (1.25 + 0.375 + 0.89 = 2.52"), M = 735 × 2.52 = 1852 lb·in gives σ = 44.7 ksi, under the 65 ksi allowable. So the pin's bending verdict is **insensitive to the model**. The shear plane and bending pass either way.
- The oak bearing is **not** insensitive (A2).

**A2. The kingpin strike bearing at 331/358 psi (8%) is an average, and the true margin is likely ≤ 0 on the stated allowable.** Severity: **high for the "marginal 8%" characterisation**, low for the design.
- Round-1 D6 said a rigid pin peaks at ≥ 2× the average. That is not applied.
- **Equal-lever case.** The beam resultant sits 0.36" off its centre: e = 0.36" against D/6 = 0.42". That gives peak/average = 1 + 6e/D = **1.86**. So beam peak = 437 psi, over 358.
- **Pitch moment through the pin.** If the pin takes H·(6.5 − 5.6) = 0.9 H, the beam resultant moves to 0.375" below the top face. The bearing is then triangular over ~1.1", peaking near **1050 psi**.
- 358 psi already includes SF 2 and C_M 0.67. The unfactored wet limit is 717 psi. So the real state is "unresolved, between 1× and 3× the allowable", not "8% under".
- **Mitigations.**
  - The crossbar bearing is **parallel to grain** for a fore-aft H (the crossbar is `grain x`), where the allowable is ~3,000 psi, but the check uses ⊥. This is conservative for fore-aft H, but cleavage at the 0.875" side ligaments and the 0.75" front ligament is not checked.
  - The 3× stack makes H = 735 against 245 lbf at 1×V (static climbing force). At 1× the crossbar bearing is ~110 psi.
- **Is stacking the 3× on tanφ defensible?**
  - 3× models a vertical bump. Using it as the wheel's normal load while climbing is an envelope, not strictly physics.
  - A real head-on strike at jog speed is governed by momentum, not V·tanφ. 350 lb at 6 mph over the ~0.4 ft of climb stops in ~0.1 s, so the true impulse could be higher.
  - So the stack is not double-counting, but its conservatism should not be used to wave away the marginal flag. I would keep it as the deterministic envelope, show H at 1× next to it, and state that the check is neither strictly conservative nor an impact analysis.

**A3. Steering stops carry the one-wheel-strike yaw torque and are not checked.** Severity: **high, carry to Phase 3 with the number**. The `how` text says "swings the steer body into its stop" but no row checks it.
- One-wheel curb (goal): H_w = 368 lbf × 17.75" = **6.5k lb·in** about the kingpin.
- The stop posts are 1.5" square × 1" high, at y ≈ openHalfY/2 = 3.0" off the centreline, bearing flat on the aft bolster rail (oak ⊥).
- F = 6530/3.03 = **2150 lbf over 1.5 in² ≈ 1440 psi against 358, about 4× over**.
- Also, steady steering at full lock with a hard 150 lbf rope pull on one axle end (150 × 20" = 3000 lb·in) gives ~660 psi, 1.8× over.
- Fix: steel stops, or oak posts ≥ 3" × 1.75" bearing on a steel face. Add a check row.

**A4. The axle check ignores the rope tie load.** Severity: low. Ropes tie at the axle ends, up to 150 lbf on one end at ~3" beyond the clamp: ~450 lb·in fore-aft. The front resultant goes from 17.6 to ~21 ksi. It still passes, but it should be a row.

**A5. Sim does not represent the recommended rig.** Severity: medium. `src/sim/spec.ts` puts a single pull force at the bridle's near end (the beam's front face, 1.4" ahead of the kingpin).
- The recommended rig is two ropes at the axle ends, 20" off the centreline.
- Steering authority and self-centring in the sim therefore say nothing about the rig. The doc's "run the scenarios to get a feel" should say "not the bridle steering".

## 2. Recommendation

### Must fix before the checkpoint

**R1. Wrong or apples-to-oranges numbers in the changes table.** Severity: high (the owner reads these).

| Claim | Code now | Fix |
|---|---|---|
| "An 80 lb rider tips back at 1.07× [tongue]. The rope bridle gives 2.41×" | Bridle **80 lb = 1.92×** (2.41× is the 150 lb case). The tongue at 80 lb is **1.17×** at the recommended geometry (1.07× was a stale round-1 number at WB 48). 24" tongue: op 1.46×, light 1.17× (both below the 1.25 limit, so fail) | Compare like with like: bridle 1.92× vs tongue 1.17× at 80 lb |
| Axle "3% over" at 1018 | 25,163 vs 25,000 psi = **0.65%** over | Say 0.65%. Then see R4 |
| Result table: "Rearward pitch 2.41×" with pass/pass/pass | Per case: 150 lb 2.41×, 200 lb 2.76×, 80 lb **1.92×**. The 80 lb column shows a value that belongs to 150 lb | Show per-case values here, and for kingpin strike (150 lb 281, 200 lb 331 psi) and turntable (399 / 469 lbf) |
| "Turning radius marginal (−2.7%)" | It passes with +2.7% margin; a minus sign reads as a fail | "+2.7% margin" |
| "shortens the cart from 83" to ~67"" | Installed envelope (the 18" bridle drawn as a rigid bar) is **76.0"**, and removables-off is **62.8"** | State which |

**R2. Rear-pitch headline is valid only for a long, low rope.**
- The light-rider 1.92× assumes a 30" hand height and 72" rope run, with the pull line at the axle ends.
- Sensitivity (80 lb, 15°):

  | Hand / rope run | Ratio | vs 1.25 limit |
  |---|---|---|
  | 30" / 72" | 1.92× | pass |
  | 36" / 60" | 1.15× | fail |
  | 40" / 72" | 1.23× | fail |
  | 40" / 48" | 0.82× | front lifts below 150 lbf |

- Put a rope spec in the doc (≥ 8 ft, tie low) and carry it into Phase 3. A 12" tongue passes (1.87× op, 1.50× light) and was not discussed. "No 24" tongue passed" is true but narrow.

**R3. State the weight against the brief.** 127 lb empty against BRIEF §4.6's 60–70 lb is +81%. D-21 covers it, but the Result section should say so up front.
- Also give the per-change mass: 9 mm @ 12" joists to 12 mm @ 8" costs +5.1 lb; sleeves, crossbar and the 4" beam about +3.9 lb.
- Transport is 58 lb per person, which is not a scout lift (D-7, Q-7). The owner should see this on the first screen.

**R4. Re-characterise kingpin-strike (A2) and add the stops (A3).** The doc currently says "8% marginal, fixed by a deeper crossbar in detailing". Say instead: "bearing is an average; the pitch-moment path and peak bearing are unresolved; stops are unchecked; both are the first Phase 3 items". Also show H at 1×V (245 lbf) beside the 3× value (735 lbf).

**R5. Exploration is stale relative to the final model.**
- `phase2-exploration.md` ran at commit 443377b, **before** the crossbar and sleeve kingpin (c298d87), the 1045 axle and the final deck.
- "176 pass at every rider weight" and "every passing design 121–135 lb" are therefore about the earlier kingpin model. Either re-run or say so.
- Also, the recommended config is a hand-built variant, not a sweep result. Say that.

**R6. Update DECISIONS.md, at least list the pending IDs.**
- D-8 and D-9 (tongue pins off, 82" with tongue), D-12 (½" kingpin), D-14 (tongue is the default), D-25 / D-26 (lead 1.0", lock 38.5°, nose 13.5") and D-4 (axle yield 50 ksi) are now contradicted by the recommendation. The claim "fits assembled, consistent with D-8/D-9" is true of the result but false of the text.
- Proposed IDs: D-27 bridle-only, D-28 crossbar kingpin with sleeve, D-29 1045 TGP, D-30 lock and wheelbase.

### Judgment on each change

| Change | Justified? | Simpler or lighter alternative the doc missed |
|---|---|---|
| Bridle only | **Yes**, with R1 and R2 | A 12" tongue passes pitch (light 1.50×) and adds steering lever; it adds ~12" of length (76" + 12" does not fit the 80.5" bed). Bridle-only is the right call |
| WB 44" | **Yes.** At WB 48 and lock 37 the radius is 100.0" (fail). At the Phase 1 defaults it is 97.25" | WB 46" at lock 37 still fails (~96.7"). Fine |
| Lock 37° | **Yes** (38.5° is invalid: the nose falls under the feet minimum). Two undocumented options exist | `bootAllowance` 0.375" at 38.5° gives radius 90.96" (5.2% margin vs 2.7%). R2 (lock 36°) gives 95.1" (1%). The doc should say why boot 0.5" was kept |
| ¾" pin + crossbar + 1¼" sleeve | **Yes.** The sleeve, not the pin, sets the bore bearing. Without the crossbar the old ½" pin fails at 166 ksi vs 65 | A 5/8" pin also passes (326 psi, same bore). ¾" is a standard-stock choice, not an analysis result. A sleeve of 1⅛" fails the goal case (365 psi). A steel drag-link strap would avoid the pitch-moment problem entirely (A2) |
| Lead 1.5" / beam 4" | Yes (sleeve geometry; ½" ligament ✓, ¾" end ✓) | None |
| 1045 TGP axle | Reasonable and available (McMaster-type 1045 turned, ground, polished, ¾" × 3–6 ft; TGP also gives the better bearing-fit tolerance). 70 ksi is plausible but **cite the source** (the vendor spec) | The 0.65% exceedance on a stack of 3× + friction + SF 2 does not need a material change. Cheaper: **move the clamp 0.25" closer to the hub** (a = 1.75"), which gives σ ≈ 23.1 ksi, a 7% pass on 1018. Keep 1045 as the belt-and-braces option |
| 12 mm deck @ 8" | **Yes.** 9 mm @ 12" fails (0.119" vs 0.039"). 9 mm @ 8" fails goal (0.026 vs 0.023). 12 mm @ 12" fails (0.050 vs 0.039) | 9 mm @ 6" passes (0.014") at 125.2 lb (−1.7 lb) but adds joists; 12 mm @ 10" passes (0.022") at 126.4 lb. Neither is better enough to matter |
| Brake 12:1 | Yes, free. 10:1 is marginal at the goal case (24.4 lbf vs 30) | |

### Bridle steering (the question you asked)

By hand, yes, it steers and self-centres.
- With both ropes taut to a puller 6 ft ahead, the axle lines up square to the line of the puller, since the rope lengths differ as the axle yaws.
- When one rope slackens, the taut one acts on a 20" lever and restores to centre, about T × 20" (3000 lb·in at 150 lbf).
- The 1.5" lead adds only a small caster trail for the rolling case with the ropes slack.

Caveats, all Phase 3:
- **Rope vs tyre.** A rope from the axle end (y ≈ 21") to a point 72" ahead stays outside the tyre (outer face y = 19.75") until x ≈ +5.5" and then grazes the sidewall by ~0.1–0.3". It must run outboard of the tyre or tie to a forward spreader.
- **No analysis** validates steering authority. A mock-up is cheap and should precede the final tie-point design.

### Is 1045 TGP reasonable with standard hand-truck bearings?
Yes. ¾" bores are standard (5/8" also common). The ground finish helps the fit.
- No lathe means no grooves: use cross-drilled cotter pins or shaft collars.
- Drilling 1045 needs sharp cobalt bits.
- Confirm the hub bore (¾" vs 5/8") before ordering; D-11 / Q-4 is still open.

### Truck-fit claim
Correct for the defaults: fits assembled, beside the wells, both orientations (regenerated, installed config).
- **The margin is only 0.45" per side**: overall width is 40.6" (y = ±20.3") against the unverified 41.5" gap.
- **A drop-in bedliner takes ~0.5–1" per side and would break it.** Say so in the doc.
- The cart has ~9.8° of tip margin to spare (49.8° against 40°), so a measured bed can be absorbed by a narrower **rear** track. A narrower front track costs nose width at lock (about 0.8" of nose per inch of track), which is why only the rear track is a cheap hedge.

### BRIEF §4.7 (rider safety, ergonomics)
- The kingpin, crossbar, stops and turntable sit under the nose deck (the crossbar top is flush at 9.03", under the 12 mm ply at 9.5"). The feet are on the deck with no exposed pinch at the pivot.
- **Tyre-to-hull gap at full lock is 0.76"**: a finger-trap gap at the inner tyre corner and nose side. Add a guard, or a fender strip, in Phase 3.
- **Kingpin nut access.** The nut sits flush under the nose deck, so the front deck panel must come off for service. Make it removable, with threaded inserts.
- Foot well: nose 14.0" outside, ~13.0" inside, against 12.1" required ✓. At lock the feet are inside; nothing else is near them. The ropes run outside the tyres.

### Marginal items: honestly characterised?
- Turn radius +2.7% and steering clearance 0.76/0.70 are honest.
- Turntable 469/500 (6%) is honest, but the load is the 15° nose-down, 3×, 200 lb case. The ≥1500 lb fifth-wheel option is the right fix.
- Kingpin 8% is **not** honest (A2).
- Missing from the list: rollover speed at the goal rider is 9.0 mph = 1.49× jog, just under the A-1 1.5× reference (info only, accepted by Eric, but it should be noted); rear traction parked nose-down is 1.02×.

### Phase 3 carry-over: missing items
1. Steering-stop strength (A3: ~2,150 lbf, 4× over as drawn).
2. Peak bearing and the pitch-moment path, plus crossbar cleavage at the 0.875" side ligaments (A2).
3. Rope spec (≥ 8 ft, low tie, hand ≤ 30") and tie geometry vs the tyre (R2).
4. Rope tie load on the axle end (A4).
5. Kingpin nut access and a removable nose deck.
6. Tyre-to-hull finger gap at lock.
7. Sleeve spec (1¼" OD × ¾" ID DOM tube, press or epoxy fit in the oak).
8. Bedliner and bed measurement, and the rear-track hedge.
9. Hub-bore confirmation.
10. The bolster fasteners are assumed (4 × ¼" A307, interaction 0.39). Design them for ~735 lbf.
11. The sim's bridle model (A5).

## 3. Presentation

**P1. The Analysis panel footnote is stale.** Severity: medium (the owner reads it).
- `analysis-panel.ts:121` still says the kingpin is "single shear at the turntable interface, cantilever over the whole stack". It is now single shear with an equal-lever moment through beam, turntable and crossbar.
- The axle row says "1018 CD, yield taken as 50 ksi". It is 70 ksi 1045 at the recommended config.
- There is no sleeve-yield row (36 ksi, bearing allowable 16.2 ksi) and no note that ×3 applies to V in the strike.
- Fix: derive the footnote text from params.

**P2. Doc structure.**
- The "how it was chosen" block tells the story well, but a one-paragraph "what you are approving" at the top would help. Include 127 lb vs 60–70 lb, the 58 lb per person lift, the truck-fit assumption, and the 3 marginal items.
- The changes table "Why" column is dense; split numbers from rationale.
- "Phase 1" kingpin is described as a cantilever, but the Phase 1 default already has `kingpinThroughBolster = 1`; the ½" no-crossbar case was the Phase 2 analysis fix, not a shipped default. Reword.

**P3. Repo hygiene.** `scripts/_probe.ts` is a committed scratch file; delete it. Add one vitest regression test that `RECOMMENDED` has 0 fails at op, goal and light, so the doc's claim cannot silently rot. It costs ~10 lines.

## 4. Priority summary

**Must fix before the checkpoint (doc and text only, no redesign):**
1. R1: correct the 2.41× vs 1.92× (80 lb) comparison, the 1.07× tongue number, the 3% (0.65%) axle figure and the "−2.7%" sign, and show per-case values for the cases that differ.
2. R2: state the rope assumptions and the sensitivity.
3. R3: put weight vs brief and per-change mass up front.
4. R4: re-characterise the kingpin-strike margin and add the stops to the marginal list with the number.
5. R5: flag that the exploration predates the final kingpin model.
6. R6: update DECISIONS.md or list the pending IDs.
7. P1: fix the stale panel footnote.

**Can carry to Phase 3:** A1–A5 implementation, steering-stop and crossbar redesign, rope/tyre geometry, finger-gap guard, nut access, bedliner/rear-track hedge, hub bore, the L3 steering-exclusion regex, the regression test (P3), and removing `scripts/_probe.ts`.
