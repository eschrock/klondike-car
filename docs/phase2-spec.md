# Phase 2 spec: analysis, simulation, exploration

BRIEF §7 (checks), §8 (sim) and §10 Phase 2 are the requirements. Decisions that shape them:
- **D-1:** must pass at 150 lb; 200 lb is reported and flagged.
- **D-2:** load factors.
- **D-21:** mass is info only.
- **A-1:** slide-before-tip criterion.
- **D-24:** traction on a hill is info only.
- **D-26:** current front geometry.

Units are inches, lb and degrees; g = 386.1 in/s². Model frame per C-1.

## Load cases
Mass and CG come from `buildModel` and `src/model/mass.ts`.

| Case | Contents | Used for |
|---|---|---|
| **empty** | no rider, no cargo | |
| **operating** | 150 lb rider + 25 lb cargo | **pass/fail case** |
| **goal** | 200 lb rider + 25 lb cargo | reported. If it fails while operating passes, status is `fail` with a "goal rider" flag in `how`. The panel shows both. |

**Structural** checks use the **goal** case, per D-2:
- payload load = (goal rider + cargo) × `dynamicFactor`;
- members that carry self-weight add cart mass × `dynamicFactor`.

**Allowables:**
- **Oak bending:** `derived().oakDesignMorPsi` (MOR × C_M / SF).
- **Oak shear:** oakShear × C_M / SF.
- **Oak compression ⊥:** oakCompPerp × C_M / SF.
- **Ply:** `derived().plyDesignMorPsi`.
- **Steel:** `axleAllowablePsi` (yield / SF). Kingpin: kingpinYield / kingpinMargin.
- **Deflection** uses the **static** (×1) load and E × C_M.

## Wheel contacts and support polygon
- **Rear contacts:** (0, ±T_r/2, 0).
- **Front contacts at steer δ:** kingpin K = (WB + lead, 0); each contact is K + R(δ)·(−lead, ±T_f/2). Use the tire centre-plane contact point; ignore tire width (conservative).
- **Static axle loads:** from the CG x, with N_front = W·x_cg / x_frontContactMean. Use the proper 2D static distribution for a 4-point support at δ = 0. At lock, report per-wheel loads with the tripod-free approximation: rear pair and front pair, each split equally. Info only.

## Checks
Each check returns a `CheckResult`: id, label, value, unit, limit, sense, status, load, how, refs. `status` = 'marginal' when it passes by less than 10% of the limit.

| id | Check | Method | Limit |
|---|---|---|---|
| `mass-empty` | Empty mass | Σ part mass, no payload | info (D-21). Also report the transport-config mass and the lift per person (÷2). |
| `cg` | CG empty / operating / goal | mass-weighted | info |
| `tip-straight` | Lateral tip, straight | δ = 0. d = horizontal distance from the CG ground projection to the nearest side edge of the support polygon. θ = atan(d / h). Both sides. | ≥ `tipStraightMinDeg` (40°) |
| `tip-lock` | Lateral tip at full lock | δ = ±lock. Polygon from the 4 contacts; take the **min over all edges and both lock directions**. | ≥ `tipLockMinDeg` (35°) |
| `slide-before-tip` | SSF vs friction (A-1) | SSF_out = d_outer / h. Use the outer edge at full lock in the turn direction: turning left, the right side is outer. | SSF ≥ `slideMarginFactor` × `tireGroundMu` |
| `v-rollover` | Turn rollover speed | v = √(g · r_cg · SSF_out). r_cg = distance from the instantaneous centre (rear axle line at y = WB / tan δ, ignoring lead) to the CG. Also report v at 2×, 3× and 4× r_min, and v_roll / jog speed. | info (A-1) |
| `turn-radius` | Turning radius | Outer front tire centre radius about the instant centre at lock. Also report the rear-axle-centre radius. | ≤ `turnRadiusMaxIn` |
| `steer-clear` | Steering clearance | OBB sweep: front tires, and the whole steer body vs chassis, at δ = 0 … ±lock in 1° steps. Report the minimum clearance. | ≥ `steeringClearanceIn` − 0.05 (tolerance) |
| `pitch-fwd` | Forward pitch-over braking downhill | On `designSlopeDeg`, nose down. Rear brake at its traction limit a = μ·N_r / m (rear-only). Margin: (x_fc − x_cg)/h − (tan θ + a/g), with x_fc the front contact x. Express as an equivalent angle. | margin > 0, report deg |
| `pitch-rear` | Rearward pitch, climbing | Nose up on `designSlopeDeg`, with the bridle pull up at the puller hand height (pull angle from tongue tip height to `pullerHandHeightIn` over 6 ft of rope). Tip-back angle atan(x_cg / h), reduced by the pull's lift moment. | ≥ 2 × designSlope |
| `brake-force` | Lever force to hold on the slope | F = W·sin θ / μ_pad / (ratio · eff). | ≤ `handleForceLimitLbf` |
| `brake-traction` | Rear-only traction, nose-down park | N_r·μ_ground vs W·sin θ (formula in DECISIONS). | info (D-24) |
| `axle-stress` | Axle bending | Per axle and design load (wheel static load × dynamic factor). **Through rod:** a cantilever from the nearest clamp plate's outer edge to the wheel hub centre; M = P·a. **Stub axles:** cantilever from the beam face. σ = M·c / I. Also report tip deflection at the hub, δ = P·a³ / 3EI (static load). | σ ≤ axleAllowable; deflection ≤ 0.05" static (info) |
| `beam-front` | Front axle beam bending + shear | The turntable delivers the front axle load at the kingpin, spread over the turntable footprint as two loads at ±size/2. The beam reacts at the clamp plates. Simple-span bending with the actual section (thickness × depth, minus the rod groove depth from depth). Shear check at the clamps. | σ ≤ oak design; τ ≤ design shear |
| `beam-rear` | Rear axle beam | Rails/girders load the beam at their y. Reactions at the clamps. Overhang bending M = R·(y_clamp − y_rail). Same σ and τ. | same |
| `bearing-groove` | Compression ⊥ at the axle groove | Wheel design load / (rod dia × clamp plate length × 2 plates). | ≤ oak C⊥ design |
| `rails` | Frame rails or side girders | Goal rider + cargo × dyn as a point load at the worst x between the rear beam and the front bolster, shared equally by 2 members. Simple span. Rails: rectangular section. **Hull-beam girders:** an I-section from chine + gunwale flanges and the ply web; use transformed-section E ratio ply / oak. | σ ≤ oak design; static deflection ≤ L / `deflectionLimitRatio` |
| `deck` | Deck ply panel | (a) Seat case: goal rider × dyn spread over the seat footprint, on a 12"-wide strip beam spanning the joist spacing. (b) Standing scout: 200 lb static on a 4 × 10 patch at mid-span on the same strip. | σ ≤ ply design; (b) deflection ≤ span/300 |
| `kingpin` | Kingpin bolt | Horizontal pull `pullForceLbf` acting at the turntable plane. Double shear if the bolt passes beam + bolster; otherwise single shear plus bending over the stack height (from layout.kingpin). | τ, σ ≤ kingpinYield / kingpinMargin (use 0.577·yield for shear) |
| `turntable` | Turntable rating | Front axle load (goal) × dyn ≤ rating / kingpinMargin. | as stated |
| `tongue` | Tongue bending | `pullForceLbf` at 45° to the tongue axis. Lateral component at the tip makes a cantilever moment at the beam joint. Also check the vertical component. | σ ≤ oak design |
| `truck-fit` | Transport config fits | From `checkTruckFit`: any fitting case in the 'removed' config. Also say whether 'tongue off' fits. | pass/fail |

**Implementation rules:**
- Put the code in `src/analysis/` as pure TS (no three.js). One module per area (`stability.ts`, `structure.ts`, `brake.ts`, `index.ts` exporting `runChecks(p): CheckResult[]`).
- Read geometry from `computeLayout(p)` and the parts list, never by re-deriving it.
- Every check's `how` string states the formula and the numbers used, so the user can verify it by hand.
- **Unit tests** must include hand-calculated cases with simple numbers: a symmetric box CG, a known beam, and a known axle cantilever, each checked to 3 significant figures. They must also cross-check `tip-straight` and `turn-radius` against the DECISIONS hand-calc table (within ~1°).

## Analysis panel (UI)
- `src/ui/analysis-panel.ts` exports `mountAnalysisPanel(host)` returning `update(p, checks)`.
- It shows a table grouped into Stability / Steering / Braking / Structure / Mass & transport. Each row has a status chip, the value, the limit and the load case. Clicking a row expands its `how` text and the refs.
- A summary line gives pass / marginal / fail counts at operating and goal.
- A "material properties used" footnote lists the oak and ply values, factors and their sources (brief §7 asks for this).

## Simulation (BRIEF §8), qualitative
- `src/sim/` uses `@dimforge/rapier3d-compat`, loaded lazily the first time the Simulation tab opens.
- **Bodies:**
  - **Chassis:** all `chassis` parts plus rider and cargo as fixed mass. Set its mass, CG and inertia from the parts list, approximating inertia as Σ part OBB inertias plus parallel-axis terms.
  - **Steer:** joined to the chassis by a revolute joint about the vertical kingpin axis, with limits ±lock.
  - **4 wheels:** cylinders on revolute joints about the axle axes.
  - **Colliders:** compound cuboids from the major part OBBs, used only for ground contact of the hull.
- **Ground:** a large cuboid or heightfield with an adjustable downhill slope (0–20°) and side slope / camber, plus optional bumps: a root (2" half-cylinder) and a curb (3" step).
- **Controls:**
  - pull force (lbf) and pull direction (steer input via a force at the tongue tip);
  - brake on/off and brake force, as a friction torque on the rear wheels;
  - rider mass (operating / goal / custom);
  - scenario presets: downhill roll, side-slope tilt table, root/curb strike at speed, full-lock turn at speed, braking event.
- **Readouts:** speed, per-wheel normal load (contact force), a "wheel lift" warning when any normal load is ≈ 0, and a **tip-over event** when roll > 60° or the hull touches the ground.
- **Display:** drive the existing viewer by posing parts per rigid body, so the sim reuses the model meshes. Provide play/pause/reset and time-scale. Use a fixed timestep of 1/240 s with substeps.
- Label everything **"Qualitative — the Analysis tab is the real validation."**
- **Cross-check test (vitest, Node):** a tilt-table scenario raises the side slope slowly until a wheel lifts. The onset angle must fall within ±3° of the analysis `tip-straight` value for the operating case. Also check that the full-lock onset is lower than the straight onset.

## Exploration
- `scripts/explore.ts` (run with `npx vite-node`) sweeps track (beside and straddle), wheelbase, wheel diameter, deck height and lock.
- Nose width and shoulder come from an "auto" derivation from `derived().swing*` plus the boot and clearance rules, so the coupling from the Phase 1 r3 review (C1) doesn't cap the sweep.
- Output is a Markdown table in `docs/phase2-exploration.md`: per design, mass, the pass/fail/marginal counts at operating and goal, and the key margins (tip-lock, slide-before-tip, turn-radius, brake-force, rails, deck, axle), plus truck fit (both modes).
- The recommended configuration and its tradeoffs go in `docs/phase2-recommendation.md`.
