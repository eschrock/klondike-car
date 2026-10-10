SCORE: 7/10

# Phase 2 analysis review, round 1 (critic)

Scope: `src/analysis/**`, the layout/params it reads, the Analysis panel. `npm test` 423/423 pass, `tsc --noEmit` clean. Every number below was recomputed by hand or with a throwaway script (deleted afterwards) at `defaultParams()` (13" wheels, 48" WB, 35.5" track, 38.5° lock, kingpin lead 1.125").

**Overall.** The geometry and stability core is correct and reproduces my hand numbers. The structural block is mostly sound but only checks vertical load at the axle and the 150 lbf rope pull at the kingpin, so several governing load paths are never loaded. Two default FAIL rows (`pitch-rear`, `deck`) are driven by method choices, not by the hardware being bad.

## Verified correct (no action)

| Check | My number | Code | Note |
|---|---|---|---|
| Contacts at lock 38.5° | FL (37.19, +13.19), FR (59.30, −14.59) | same | rotation about K = 49.125 correct |
| `tip-straight` op | atan(17.70/15.08) = 49.6° | 49.56° | |
| `tip-lock` op | edge FL-RL, d = 15.5", 45.8° | 45.81° | left lock governs, min over both directions correct |
| SSF outer | 16.85/15.08 = 1.12 | 1.117 | outer edge is correct (turning right, left edge) |
| Instant centre | y = 48.245/tan38.5° − 1.125·sin38.5° = 59.95" | 60.0" | lead handled correctly (axle line, not kingpin) |
| Outer front tyre-centre radius | √(59.3² + 74.54²) = 95.25" | 95.25" | |
| `v-rollover` | √(386.1·62.1·1.117)/17.6 = 9.3 mph | 9.30 | |
| Axle rod | σ = 688.3·0.375/0.01553 = 16.6 ksi (rear, goal) | 16,619 psi | root at clamp outer edge, a = 17.75 − 15.75 = 2.0" |
| Brake force | 297.2·sin15°/0.4/(10·0.8) = 24.0 lbf | 24.04 | |
| Rails (ladder) | M = 337.5·49.1/4 = 4145 lb·in, σ = 3684 psi | same | midspan placement is conservative vs the real seat x ≈ 16 (+14%) |
| `beam-front/rear`, `turntable`, `tongue` | match | match | arithmetic and units fine |
| Allowables | 15,200·0.85/2 = 6460; 2000·0.85/2 = 850; 1070·0.85/2 = 455 | same | see M2 for C_M on ⊥ |

DECISIONS hand-calc table cross-check holds within 1° (straight tip 49.6 vs 50.2, SSF 1.12 vs 1.11, v_roll 9.3 vs 9.1).

**Steering-clearance exclusions are not hiding interference.** I re-ran the sweep with the exclusion regex removed (steer-body turntable/kingpin/steer-stop/side-bearer vs every fixed part, ±38.5° in 1° steps). Everything below 0.5" is an intended contact:
- turntable vs bolster: 0.000 (face contact)
- steer-stop vs aft bolster: 0.000 at ±lock (by design)
- side-bearer wear face vs bolster: 0.063 (the 1/16" running clearance)
- the next-closest is turntable vs `transom-front` at 0.50"

The regex is wider than it needs to be: it exempts those parts against *all* chassis parts, so a future layout change could hide a real hit. See L3.

## WRONG (bugs or incorrect physics)

### H1. Kingpin and steering-structure loads omit the dominant horizontal and roll cases. HIGH
`structure.ts:326-343` (`kingpinCheck`), `:345-358` (`turntableCheck`).

- **Kingpin load.** It sees only the 150 lbf rope pull, at 35.1 ksi (54% of the 65 ksi allowable). The front wheels' obstacle reaction is not applied to it. Everything the front axle gets from a root or curb strike reaches the chassis horizontally through that one ½" bolt: nothing else carries horizontal translation, since the stops and side-bearers only resist rotation.
- **Horizontal force.** Using the code's own vertical design wheel load (3 × front static, goal = 355 lbf axle) and the Phase 2 sim obstacles:
  - 3" curb: φ = acos((6.5−3)/6.5) = 57.4°, H = V·tanφ = 1.56 × 355 = **555 lbf**. σ_bolt = 35.1 ksi × 555/150 = **130 ksi**, which is yield. Allowable is 65 ksi, so 2.0× over.
  - 2" root across both wheels: H = 369 lbf, σ = 86 ksi (1.3× over).
  - One wheel only, 3" curb: 278 lbf, σ = 65 ksi, exactly at the limit.
  - Bore bearing at 555 lbf = 444 psi against 455 psi (and about 359 psi if C_M for ⊥ is corrected, M2).
- **Cantilever length.** The cantilever length s = 2.875" is generous (load plane to bottom of the beam). Even with an effective s = 1.5", σ = 68 ksi, still over.
- **Fix.** Add a "front-wheel obstacle strike" case. For example H = 3·N_front·tan(acos((r−h)/r)) for h = 3" (curb) and 2" (root), applied at the hub height and reacted at the kingpin. Report τ, bending and bore bearing. A ⅝" kingpin drops σ to 18 ksi at the current 150 lbf, which is 3.4× lower at H = 150, and about 2× lower than the curb case at 555.
- **Why it matters.** A curb or root strike is the dominant horizontal load on a Klondike Derby cart, and the `kingpin` row currently shows PASS with 46% headroom.

### H2. D-12 roll-moment path (side-bearers, bolster, uplift at the kingpin) has no check. HIGH
D-12 states the turntable is not moment-rated and that bump roll goes through the side-bearers. No row checks that path.
- **Hand numbers.** One front wheel carries 3 × 59.3 = 178 lbf at y = 17.75" (goal), the other unloaded. The side-bearers sit at y ≈ 6.8", so F_sb = 178 × 17.75/6.8 = **464 lbf** on a 1.5" × 1.5" block (206 psi, OK against ⊥ 455 psi). Vertical balance then forces F_turntable = 178 − 464 = **−286 lbf of uplift** through the kingpin and turntable.
- **Why it matters.** The kingpin as modelled (`layout.kingpin` z 4.375…7.25) ends at the turntable top, so the retention of the chassis onto the beam in uplift depends on the lazy-susan's tension capacity and the top-plate bolts into the bolster. None of these is checked: side-bearer bearing, uplift on the kingpin nut/washer and bore (286 lbf on a 1" washer = 365 psi against 455), or bolster-bolt shear for H (H1).
- **Fix.** Add `roll-path` rows: side-bearer ⊥ stress, kingpin tension plus washer bearing on the oak, and turntable top-plate fastener shear for H.

### H3. `pitch-rear` limit and load case are inconsistent and miss the light-rider case. HIGH (changes pass/fail, so the default FAIL is not decision-grade)
`stability.ts:150-185`.

- **Moment balance is right.** The lift moment (2664 lb·in at α = 18.7°) and tip-back slope (23.7°) match my hand numbers.
- **Light rider is worst, not the 150 lb rider.** BRIEF §4.1 says typical riders are 80–150 lb, and the 150/200 case set never evaluates the light one. At 80 lb + 25 lb cargo (W = 227, CG 16.6, 13.4): tip-back slope = **17.6°**. The front lifts at only 1.17× the design slope. Equivalent pull-to-lift at 15° is 2854/17.76 = **161 lbf vs the 150 lbf peak: 1.07×**. At 150 lb it is 200 lbf (1.33×); at 200 lb it is 229 lbf (1.53×).
- **"≥ 2 × design slope" is arbitrary and stacks conservatism.** The pull is already the 150 lbf surge peak (D-14), and then another 2× on the angle. At 15° the cart needs only T = W(sinθ + 0.06 cosθ) = 94 lbf (op) steady. At a consistent T(θ) the tip-back slope would be ~33°. The check also holds T = 150 lbf constant when the design slope changes (at `designSlopeDeg` 20 the value stays 23.73°, only the limit moves).
- **Rope run is a hidden constant.** `ROPE_RUN_IN = 72` (`stability.ts:156`) is not a parameter and the 6 ft rope is not documented in the UI.
- **Fix.** Report the pull required to lift the front at `designSlopeDeg`, T_lift = W(x·cosθ − h·sinθ)/(x_p·sinα − z_p·cosα), and require T_lift ≥ 1.25–1.5 × `pullForceLbf`. Add a light rider case (80 lb, a param) for this row only. Promote the rope run to a param.

### M1. `turn-radius`: "outer front tyre centre is the conservative reading" is false. MEDIUM
`stability.ts:132`, A-2.
- **Why.** Because the instant centre lies on the front axle line, the radial direction at the front wheel *is* the axle direction. The outer tyre edge is at 95.25" + w/2 = 95.25 + 2.0 = **97.25" (8.10 ft)**.
- **Result.** The curb-to-curb figure fails the 96" limit, where the code shows a marginal pass.
- **Fix.** Either report the swept outer-edge radius (and add 2" to the value), or reword A-2/the `how` string to say "tyre centre", which is the less conservative reading. This is also a method choice, but the claim in DECISIONS is wrong as written.

### M2. Wet-service factor on compression ⊥ is 0.85; NDS C_M for Fc⊥ is 0.67. MEDIUM
`structure.ts:25` (`oakPerp`).
- **Result.** ⊥ allowable = 1070 × 0.67/2 = **358 psi**, not 455 (27% lower). `bearing-groove` goes from 67% to 85% utilised (306 psi), and `kingpin` bore bearing from 26% to 33%.
- **Related.** Shear C_M (0.97 in NDS) is correctly conservative at 0.85.
- **Fix.** Add `wetServiceFactorPerp` (0.67), or note in the footnote that all strengths use 0.85 (the footnote lists a single "C_M").

### M3. Rails omit the cart's own weight. MEDIUM
`structure.ts` `railsCheck` uses payload × 3 only.
- **Why.** D-2 explicitly adds cart mass × 3 for members that carry self-weight. The rails are those members: the deck, seat, sides and storage (about 85 lb of sprung mass) sit on them.
- **Result.** An extra 85 × 3 = 255 lbf UDL gives ΔM ≈ 255 × 49.1/8/2 = 782 lb·in per rail, +19% bending: **3684 → ~4,400 psi (68% utilised)**. Still passes, but the row overstates margin.
- **Fix.** Add the UDL (or the hull-beam equivalent) to `ev` in `railsCheck`.

### M4. Structural wheel and axle loads use level static distribution only. MEDIUM
`structure.ts:44-54` (`wheelLoads`).
- **Why.** Nose-down braking or descent puts N_f = W·cosθ − N_r on the front. At goal, 15°, N_r = 191 lb, so N_f = 144 lb vs 118 level (+22%). On top of ×3: turntable 433 lbf against 500 (87% vs 71%). Cornering load transfer to the outer wheel (share up to 0.5 + μ·h/T = 0.71) is also absent.
- **Fix.** Use max(level, nose-down at `designSlopeDeg`) for the front axle, or document that ×3 envelopes it.

### M5. No lateral load on the axle. MEDIUM
- **Why.** A cornering or curb side force H_lat ≈ 0.5·P_outer·dynamic factor gives M_lat = H·a in the orthogonal plane, and the resultant is √(M_v² + M_h²). For H_lat = 0.5·P this raises σ by ~12% at the rear (16.6 → ~18.6 ksi) and puts a 6.5" arm moment on the hub bearings.
- **Fix.** Combine the two planes and report.

### L1. `pitch-fwd` formula double counts the grade term. LOW (conservative, the answer is not close)
`stability.ts:119-123`.
- **Why.** Rear-brake force fraction F_b/W is being used as "a/g". The tip condition is F_b/W = (x_fc − x_cg)/h · cosθ = 2.02. The code's (x_fc−x_cg)/h − tanθ − a/g effectively puts the threshold at 1.82. The result is 46° of "equivalent slope" either way, so it never matters, but the margin value is not physically meaningful.
- **Missing cases.** The more relevant forward-pitch loads are never applied: (a) front-wheel obstacle strike (H1) and (b) rear handler holding back on the 34" handle. The handler case needs 232 lbf, so it is fine, but it should be stated.
- **Fix.** Use the cosθ form and say what "equivalent angle" means.

### L2. `brake-force` states ratio semantics ambiguously. LOW
- **Why.** F = shoe-normal/(ratio·η) treats 10:1 as handle-to-total-shoe-force. With one lever on a cross shaft driving two shoes, each shoe sees half the shaft torque, so this is the right reading, but it is an assumption nobody states.
- **Also.** μ_pad is 0.4 dry; wet or snow-contaminated shoes at 0.25 give 24 → 38 lbf (>30).
- **Fix.** Add one sentence to `how`, and a wet-pad sensitivity line in the expanded details.

### L3. Steering exclusion regex is broader than needed. LOW
`steering.ts:15`.
- **Why.** Exempting `turntable|kingpin|steer-stop|side-bearer` against all chassis parts means any new part near the bolster is blind. The kingpin is also `body: 'chassis'` while the turntable is steer; "turntable vs kingpin" returns −0.375" in the unfiltered sweep.
- **Fix.** Exclude only (turntable, steer-stop, side-bearer) × (bolster-*, kingpin) pairs and keep everything else.

## METHOD CHOICE (defensible alternatives)

### D1. Deck: 12" simply-supported strip with a full 200 lb on a 4×10 patch is over-conservative; with a fair method 9 mm may pass. MEDIUM
`structure.ts:239-259`; default fails, 0.092" vs L/300 = 0.032" (2.9×).

Numbers I get (t = 0.354", L = 9.5", E = 810 ksi, patch 4" along span × 10" across, 200 lb):

| Treatment | δ | Verdict at 9 mm |
|---|---|---|
| Code: 12" strip, pinned, all 200 lb | 0.092" (L/104) | fail |
| One-way plate, effective width b_eff = 10 + 2.5·x(1 − x/L) = 15.9" | 0.069" (L/138) | fail L/300 and L/240 (0.040") |
| Same, with ~50% rotational fixity from the captured rabbet/dado (spec says panels are captured, glued) | ~0.031" (L/300) | marginal pass |
| 12 mm (0.472") with b_eff = 15.9", pinned | 0.029" (L/330) | pass |

- **Stress.** Bending stress is never the issue: 1,496 psi vs 2,125 (70%).
- **Required thickness.** To pass the code's own L/300 with the 12" strip you need 13 mm (0.50"). A fair method passes at ~12 mm pinned, or ~9 mm with realistic edge fixity.
- **Cheap fixes.**
  - (i) Use b_eff for the one-way plate (EC2/AASHTO-style) in place of the fixed 12".
  - (ii) Split the 200 lb across two feet (100 lb each), which is the stated "standing scout".
  - (iii) Accept L/240 for a transient foot load.
  - (iv) Report a 9 mm / 12 mm / 13 mm sensitivity line.
  - Without one of these the check steers the design to a thicker, heavier deck on a questionable basis.
- **Oddity (LOW).** `maxDeckSpan` jumps from 9.5" to 10.8" when `deckPlyIn` goes from 9 to 12 mm: the first cabin joist snaps from x = 0.375" to 1.675" (`layout.ts:167`). A thicker deck gets a longer span, which is a layout-coupling artefact.

### D2. Front-wheel obstacle strike and impact load factors. MEDIUM (see H1 for numbers)
The ×3 (D-2) is vertical only. Apply a horizontal/obstacle equivalent for the kingpin, tongue root and bolster fasteners, or state that H1 is the case.

### D3. Axle root at the clamp outer edge. LOW
Pressure under the downward-loaded rod peaks at the beam end (y = 16.125), 0.375" outboard of the clamp edge. The code's a = 2.0" vs a "true" ≈ 1.6–2.0" is bracketed correctly, so this is fine as a conservative simplification. Say so in `how`.

### D4. `v-rollover` holds SSF at its full-lock value for 2×/3×/4× r. LOW
Conservative and stated. The "1.55× jog" headline at r_min is a steady full-lock turn, which a pulled cart does not hold. The row is info only, so nothing to change.

### D5. Rails at midspan over 49.1". LOW
Conservative (+14% vs seat CG at x ≈ 16), and the span runs to the kingpin rather than the bolster face. The load path to the aft bolster through the nose girders is not shown. State it.

### D6. Kingpin as a single-shear cantilever of the whole 2.875" stack with an average (not peak) bore bearing. LOW
Conservative in bending, optimistic in bearing: bore pressure is at least ×2 the average for a rigid pin. Using 2× average (240 psi) is still under 455, so the row is unaffected at 150 lbf, but with H1 the bearing becomes critical.

### D7. Operating = 150 lb only for stability/brake. MEDIUM (partly H3)
Stability rows that improve with a lighter rider do not matter. `pitch-rear` degrades with a lighter rider (H3). Add an optional light-rider case for the rows where lighter is worse.

## PRESENTATION

### P1. A row can show a FAIL chip with a passing displayed value. MEDIUM
Stability rows show the operating value while the chip is worst(op, goal). Structure rows show the goal value while `statusOperating` is what D-1 treats as pass/fail. The load-case line and the amber "fails at goal rider" flag help, but the chip semantics ("FAIL" at the operating load = a real fail, vs at the goal rider = flagged) differ. Split the chip into two small ones (op | goal) or colour the goal chip differently.

### P2. Utilisation is hidden until a row is expanded. MEDIUM
Most structure rows are 5–70% utilised (`beam-front` 14%, `beam-rear` 14%, `turntable` 71%, `bearing-groove` 67%). Only `ap-details` shows util. Add a util % or a bar to the row head. It would also show that both axle beams are heavily over-built (mass).

### P3. `how` strings are good but long. LOW
They contain the formula, numbers and limit, so a hand check is possible. Nice. The `kingpin` how says "double shear" vs "single shear" but never says which parts the bolt crosses. State which interface carries the shear plane.

### P4. Footnote lists "C_M" once. LOW
See M2: it should say it is 0.85 for all strengths, including ⊥ and shear.

### P5. Info rows with a synthetic limit. LOW
`cg` shows "no limit (info)" (OK). `v-rollover` shows "ref ≥ 9.0 mph" and `brake-traction` "ref ≥ 1.00×", which look like pass/fail limits. The info chip carries it, but a muted limit style would help.

### P6. `pitch-rear` assumptions invisible. LOW
Rope length (72") and puller hand height 30" should appear in the expanded details and the footnote (hand height already does).

## Prioritised fix list

1. **H1/H2** Add the obstacle-strike case at the kingpin (plus bore and bolster bolts) and the side-bearer/uplift roll path. Default ½" bolt fails the 3" curb case (130 ksi vs 65).
2. **H3** Replace the `pitch-rear` slope-angle limit with T_lift/T_peak ≥ 1.25–1.5 at the design slope, add the 80 lb rider case, and make the rope run a parameter. Today's FAIL is partly an artifact; the light rider gives only 1.07×.
3. **D1** Rework the deck method (effective width or a two-foot load, plus an explicit deflection criterion) before the thickness is picked from this row.
4. **M1** Fix the A-2 "conservative" claim and report the 97.25" edge radius.
5. **M2/M3/M4/M5** C_M ⊥ = 0.67; rails self-weight (+19%); front-axle load transfer on the slope (+22%); lateral axle load.
6. **P1/P2** Op/goal chips and a visible utilisation column.
