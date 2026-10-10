# Phase 0 review, round 1

Scope: `src/params.ts`, `src/model/types.ts`, `DECISIONS.md`, checked against `BRIEF.md`.

SCORE: 7/10

Summary: the hand calcs mostly reproduce. Wood properties, steel masses, the full-lock polygon, turning radius, brake force and the rear-traction warning all check out. The honest flagging of the rear-brake traction problem and of A-1 is good. The score is held down by five things:
- the weight narrative contradicts its own numbers;
- the deck structure is not parameterised at all;
- there is zero or negative margin in three defaults (nose width, lever ratio, rollover);
- an orphan reference and several unsourced "assumed" params break traceability;
- the schema cannot express articulation or several acceptance criteria.

## Numbers I re-derived

| Item | Result | Verdict |
|---|---|---|
| Oak SG 0.68 → 47.5 lb/ft³; MOR 15,200; MOE 1.78 Mpsi; shear 2,000 (12% MC) | Matches USDA FPL-GTR-282 | OK |
| Design bending stress 15,200 × 0.85 / 2 | 6,460 psi | OK |
| Steel rod ¾" | 0.1253 lb/in → 41" = 5.14 lb, ×2 = 10.3 lb | OK |
| Steel rod 5/8" | 7.1 lb | OK |
| Steel stubs 4 × 8" | 4.0 lb | OK |
| 12 mm Baltic deck 28 × 50 | 16.1 lb | OK |
| 9 mm okoume deck 28 × 50 | 9.5 lb | OK |
| Loaded CG height | 16.0" (150 lb), 16.7" (200 lb); doc says 16.1 / 16.9 | OK |
| Straight tip | atan(18.25/16.1) = 48.6° | OK |
| Full-lock polygon: inner front contact | (36.27, 13.98) | OK |
| Full-lock polygon: nearest edge to CG | 16.0" → 44.8° | OK |
| Rear-centre turn radius | 48 / tan 40° = 57.2" = 4.8 ft | OK |
| Outer front tire centre radius | 48 / sin 40° + 18.25 = 92.95" = 7.75 ft | OK |
| Outer front tire edge radius | 7.9 ft | Only 1.2" under the 8 ft target |
| Brake required, 150 lb case | 62.6 lbf | OK |
| Brake required, 200 lb case | 75.6 lbf | OK |
| Shoe force | 189 lbf; ≥ 6.3:1 at 100% efficiency | OK (see issue 6) |
| Rear normal load nose-down (150 lb) | 125 lb; μN = 62.6 vs 62.6 required, zero margin | Doc is right |
| Rear normal load nose-down (200 lb) | 147 lb; 73.4 vs 75.6, slides | Doc is right |
| Ramp length | 31 / sin 20° = 91" | OK |
| Max track beside wells | 41.5 − 4 − 1 = 36.5" | OK |
| Straddle max track | 57 − 4 − 1 = 52" | Matches the 52" max |

## Prioritized issues

### HIGH

**1. `DECISIONS.md` W-1 and the "70–80 lb honest expectation" contradict the doc's own numbers.**
- The non-wood subtotal is 45 lb, leaving 20–26 lb for wood and finish.
- The "for scale" line alone lists deck 9.4, sides 11 and axle beams 10, which is 30.4 lb. That already exceeds the budget with no rails, tongue, crossmembers, box, seat frame, push handle, gunwales or bulkheads.
- My tally with defaults:
  - wood: deck 9.5, sides 11.5, beams 11, rails ×2 about 6, tongue about 3, box and bulkhead ply about 4, seat frame about 3, handle about 2, which is about 50 lb;
  - plus 5% finish gives about 52 lb;
  - the total is about **95 lb**. The brief calls ~100 lb "too heavy".
- The brief's 60–70 lb target is probably infeasible at 13" wheels, a solid-oak hull and 36.5" track.
- Fix:
  - Rewrite W-1 as a full line-item budget covering every part class, and state a realistic default-config mass (about 90 lb).
  - Add a Q to Eric: which gives, the 60–70 lb target or 13" wheels / solid oak sides? Offer a table of levers with lb saved each: 10" wheels −4 lb, stub axles −6, ply sides −6, open frame, slats instead of ply.
  - The hand-calc mass of 67 lb is used for W (242 lb) in the brake calc. Re-state it with the honest mass.

**2. `params.ts` has no deck/frame structure variables, and the weight budget assumes an unframed deck.**
- There are no crossmember or stringer count, pitch or section, no rail count or spacing, and no deck support grid.
- A 9 mm (0.354") okoume panel cannot span anything near 28":
  - E ≈ 0.9 Mpsi, 14"-wide strip, 24" span, 200 lb static centre load: about 1.2" deflection.
  - Even 12 mm on a 14" span gives about L/130 against the L/300 requirement.
- §7 "Frame rails / deck" cannot be run, and the weight is understated.
- Fix:
  - Add `crossmemberCount`, `crossmemberDepthIn` and `crossmemberThicknessIn` (or a max unsupported ply span, e.g. `maxDeckSpanIn`, ≤ 8–10" for 9 mm).
  - Add rail count and rail spacing, and a `deckStyle` option (ply on joists / oak slats / ply sandwich).
  - Add plywood bending E and an allowable stress to materials (see issue 9).

**3. Vertical stack at the axles is unmodelled, and the default has zero slack.**
- Axle centre is 6.5" (13" wheel); deck top is 8.5".
- Rails 3" deep put the rail bottom at 5.1", so the rails collide with the axle rod at z = 6.5 unless the rod passes through the rails.
- Front: axle 6.5, beam top 7.75, turntable plate (~0.6") top ≈ 8.35, then the floor. That leaves ~0.15" to the 8.5" deck top, with no room for the frame or a hardwood mounting plate.
- `deckHeightIn` min 5 puts the deck below the axle, so the rod sits in the rider's foot space at the front.
- Fix:
  - Add `turntableThicknessIn`, a front-beam/axle relation (`axlePosition`: through-beam / below-beam / above-frame) and `kingpinOffsetX` from the front axle.
  - Add a front-deck rise (`noseDeckRaiseIn`); this is also the brief's "raise the body over the front wheels" option, which has no param today.
  - Make the deck-height min a derived constraint: ≥ wheelRadius + axle radius + clamp + ply.

**4. `noseWidthIn` default of 16" has no clearance at 40° lock.**
- Rotating the inner-rear tire corner (−6.5, 16.25) by 40° about the kingpin gives (−15.4, +8.3). The hull must be ≤ 2 × 8.3 = 16.6" wide where it passes x ≈ 32.6, with nothing left for clearance.
- The outer corner reaches x = 30.0, y = 11.3.
- Default 16" − 2 × 0.5" clearance is violated.
- There is also no param for where the nose taper starts (taper start x, or taper length). The hull must go from 28" to ~15" between x ≈ 26–32, right where the rider's knees are.
- Fix:
  - Set the default to ≤ 15", or reduce lock to ~36° with a documented reason.
  - Add `noseTaperStartIn` and a `steeringClearanceIn` param (the truck clearance param is not reusable).
  - Add the swept-corner formula to DECISIONS as A-4.

**5. Layout conflict: storage box vs rider legs.**
- Seat H-point is at x = 12. A 68" rider's heels land at x ≈ 50–52, which is past the front axle at 48 and over the turntable.
- The hull ends at 58.
- The "forward storage box" (14" long, 1,500–2,000 in³) therefore has no room ahead of the feet. Under the calves it would be < 5" tall, and 14 × 14 × 10" is what 2,000 in³ requires.
- Add `storageWidthIn`, `storageHeightIn` and `storageXIn`. Add a `footStopXIn`, derived from stature.
- Add a Q: where does gear go (under the seat? behind the backrest? a lidded box that doubles as the foot rest)?

**6. Three defaults are zero or negative margin and are not flagged as failures.**
- **Brake lever ratio 7:1.** The 200 lb case needs 6.3:1 at 100% efficiency. A linkage with a cross shaft and two shoes is realistically 75–85%, so ≥ 8:1 is needed.
  - Add `brakeEfficiency` (default 0.8) and a `maxHandleTravelIn`.
  - Default ratio of 8–9, and fix the "default 7 passes" claim.
- **Rear-only traction.** The 150 lb case has zero margin and the 200 lb case slides, per the doc's own numbers.
  - The doc flags it but ships a default that fails the owner's own goal case.
  - Add params: `brakedAxles` / `parkingChock` (a front pin or chock).
  - Add `riderCgAheadOfHPointIn` (default ~5–6"; see issue 8).
- **A-1 replacement criterion (≥ 1.5× jog speed at min radius).**
  - Full-lock rollover: SSF on the outer edge ≈ 16.9/16.1 = 1.05; CG radius ≈ 5.0 ft. v = √(1.05 · 32.2 · 5.0) = 13.0 ft/s = 8.9 mph.
  - That is 1.48× at 150 lb, and about 1.44× at 200 lb (SSF 1.0). It fails marginally by the doc's own numbers.
  - The threshold was chosen without checking it passes.
  - Fix:
    - State the number in A-1.
    - Pick the threshold deliberately (e.g. 1.25×, or "report only").
    - Note that the relevant tip edge is the outer one in the turn, not the inner one used in A-3. A-3 should compute both.

### MEDIUM

**7. No cross-parameter constraints.** `sanitizeParams` only clamps each param individually, so the following are all reachable by sliders:
- `riderGoalMassLb` min 150 < `riderMassLb` max 220.
- `noseWidthIn` max 30 > `bodyWidthIn` min 20.
- `bodyWidthIn` max 36 vs `rearTrackIn` min 26 (body wider than the wheels; the limit is `track − tire − clearance`).
- `seatXIn` max 36 with `wheelbaseIn` min 36 (rider on the front axle).
- `steerAngleDeg` ± 50 vs `steerLockDeg` min 20.
- `truckWellStartIn` + `truckWellLengthIn` up to 85" > bed length min 54.
- `truckWellGapIn` max 50 vs `truckBedWidthIn` min 48; `truckWellGapIn` and `truckBedWidthIn` have no sort-order constraint (gap < bed width).
- `targetMassMinLb` ≤ `targetMassMaxLb` (30 ≤ 30 allowed).
- `deckHeightIn` min 5 vs rail depth + min ground clearance.
- Fix: add `constraints(p): {ok, msg}[]` plus derived bounds (e.g. `maxBodyWidth`, `minDeckHeight`), and surface them in the UI.

**8. Missing params that the §7 checks and the sim need.**
- `riderCgAheadOfHPointIn` (≈ 5–7" for legs extended). 5" of rider CG shift moves rear load by about 16 lb (13%) in the traction check.
- Steel E (29 Mpsi) for the required axle deflection check, kingpin yield (grade 8: 130 ksi vs stainless ~30 ksi, which differ by 4×), steel shear.
- White oak compression ∥ (7,440 psi) and ⊥ (1,070 psi) and tension ⊥ / cleavage (~800 psi). These are needed for the stub-axle-in-beam bearing and splitting (D-10), clamp bearing, and turntable bolt bearing. Also fastener or insert withdrawal capacity.
- Pull force and bridle: design pull force, bridle height, spread and rope length. This is needed for the kingpin / turntable moment and the sim. Turntable radial and moment ratings (not just 1,000 lb axial).
- Handle geometry: rear push handle length/height, brake lever length/pivot, grab handle spacing, footstop, backrest width, seat width/depth.
- Axle-end protrusion / hubcap beyond the tire face. The truck-fit max track assumes the tire is the widest thing; collars and pins stick out.
- Sim scenario inputs (slope, side slope, bump height, pull force, rolling resistance, tire stiffness). These can live in a separate scenario table, but they should be listed.
- Analysis thresholds as params or a `requirements.ts`: tip ≥ 40°/35°, turn ≤ 8 ft, deflection L/300, rollover multiple, bearing margin 2×.

**9. `derived()` hard-codes plywood density.**
- `plyDensityPcf` (33 / 42) is a magic number outside `PARAM_DEFS`, which violates C-2.
- Move it to materials params.
- Add ply E, allowable bending stress, shear stress, and nominal vs actual thickness (e.g. "9 mm" okoume is often 8.5 mm).
- Add Q-2's alternative (captured ply sides) as a `sideConstruction` option (solid oak / framed ply / open rail), because it is the biggest weight lever and has no param today.

**10. `D-19` is referenced in `params.ts` (`storageLengthIn` note) but does not exist.**
- DECISIONS stops at D-13; D-14 to D-19 are missing.
- The storage volume (1,500–2,000 in³) has no source.
- Many `assumed` params say "see DECISIONS.md" but have no entry: `brakePadMu` 0.4, `tireGroundMu` 0.5, `minGroundClearanceIn`, `tireWidthIn`, `turntableSizeIn`, `kingpinDiameterIn`, seat dimensions, body/nose/side dims, `riderStatureIn`.
- The brake result is decided by those two μ values; give them their own A- or D- entries with a source.
- Fix: add the missing entries, or remove the dangling reference. Add a `ref?: 'D-4'` field to `ParamDef` so the UI can link to them.

**11. Dynamic factor excludes the cart's own mass.**
- D-2 uses (200 + 25) × 3 = 675 lbf, which follows the brief literally.
- A 3× bump load applies to the whole sprung mass.
- The axle, beam, wheel and kingpin checks should use (payload + cart) × 3. That is another ~210–270 lbf.
- Raise this as a question or document the deviation.

**12. Wheel mass is a single param, independent of diameter.**
- Changing `wheelDiameterIn` from 13 to 10 leaves `wheelMassLb` at 5 lb.
- The diameter options are only 10 and 13, so Phase 2 cannot sweep 11–12" (the brief says "make it a parameter"). `min`/`max`/`step` = 0.5 are inconsistent with the options.
- Fix: derive mass from a wheel catalog (diameter → mass, width, bore) or add `wheelMassPerInch`. Allow 10 / 11 / 12 / 13, or restore a continuous range.

**13. `steerAngleDeg` is UI state in the design param table.**
- It is `primary`, it is serialised into the shareable URL hash, and it has a ± range independent of `steerLockDeg`.
- Move it to view/state, or clamp on read (`derived`).

**14. Truck params.**
- Missing: bedliner thickness (typically 1–2" off the width), tailgate gap and thickness, bed cleats / rails, and cab configuration (open input in brief §11, not in Q-1).
- `truckLoadHeightIn` conflates floor height and tailgate top.
- `truckClearanceIn` 0.5" is tight for a two-person lowering with a tire bulge; the min of 0 is unsafe.
- Add a derived `maxTrackStraddle`, and the straddle position window.
- D-6 straddle needs wheelbase ≥ 34 + 2 × (6.5 + 0.5) = 48", which is exactly the default, so zero fore-aft slack. Say so, and state the window.
- D-8 says overall 64" plus tongue. With the default 24" tongue measured from the kingpin, overall is 78" (6 + 48 + 24), not 88". Clarify.

**15. Schema (`types.ts`) cannot express articulation.**
- `transform` is a static Mat4, but the front axle assembly, wheels, tongue and stops must rotate with the steer angle. The viewer, support polygon (A-3), swept volume and sim all need this.
- Add `articulation?: { id: 'steer' | 'wheelSpin'; pivot: Vec3; axis: Vec3 }` or a `parent` link.
- Add a `role` tag (e.g. 'rear-axle', 'wheel-FL', 'seat', 'rail') so analysis does not parse ids.
- Add an `explodeDir` or subassembly id for the exploded view.

**16. Schema gaps for the acceptance criteria.**
- "No exposed plywood edges" is not checkable. Add `edges?: 'captured' | 'banded' | 'sealed'` per sheet part, or `capturedBy: partId[]`.
- Add `grain` (direction of the long axis, face-grain direction for ply) for nesting and for oak stress.
- `joinery?: string[]` is free text, so DXFs, the viewer and cut details cannot be generated. Add structured `features` (holes, mortises, rabbets, dados with local position and size).
- `qty` and `massLb` are ambiguous (per unit or total? which transform applies to qty > 1?). Require one Part per instance, or define it explicitly.
- `payload` and `group: 'reference'` / `kind: 'reference'` are redundant.
- There is no type for `AssemblyStep` (instructions, cure time), `CheckResult` (value / limit / pass / how-computed), `CutListRow` or `BomLine`. Define at least `CheckResult` now, so Phase 1 and 2 agree on it.
- No finish data. Add a surface area or `finishSystem` field for the finishing schedule and the epoxy / varnish mass.

### LOW

**17. Material allowances.**
- The 5% finish allowance is plausible but unsourced. Epoxy plus varnish on ~40 ft² is roughly 4–6 lb, which is about 8–10% of 55 lb of wood.
- NDS C_M 0.85 applies to Fb > 1,150 psi; fine, but note that no size, grain-slope, joint-notch or glue-line factor is applied. Domino mortises and the axle holes through rails reduce the section.
- Seated CG "0.14 × stature" is uncited. The 200 lb goal rider is almost certainly taller than 68", but `riderStatureIn` is shared across both masses.

**18. Range and default nits.**
- `turntableRatingLb` min 500 permits violating the brief's ≥ 1,000 lb requirement.
- `axleYieldPsi` max 120,000: the brief's example is 12L14 (about 60 ksi CD).
- `deckPlyIn` slider range 0.236–0.75 vs options top at 0.709.
- `tireWidthIn` is independent of wheel diameter.
- Turn radius should state the reference point: tire centreline 7.75 ft, tire edge 7.9 ft, body/tongue envelope. All are close to 8 ft.
- A-2 is marked provisional while the Phase 0 numbers show it passes by only 0.1–0.25 ft.

## Questions: right ones, and what's missing

Q-1 (bed measurements, well fore-aft position), Q-2 (captured-ply sides) and Q-3 (A-1) are the right ones. Q-4 and Q-5 are fine, if low priority.

Missing questions:
1. **Weight target vs wheel size / hull material.** The target is probably unachievable (issue 1). Ask which constraint Eric will relax.
2. Truck configuration and bed hardware (cab type, bedliner, tonneau / rails), and whether the cart will ever ride on the tailgate with the wheels overhanging.
3. Who lifts the cart into the truck, and what is the acceptable weight for two scouts versus two adults?
4. How many pullers, rope length and desired pull force (drives bridle and kingpin loads).
5. Whether the handout has any hidden constraints (size, wheel, load rules) beyond the transcription in the brief.
6. Where the 10 Essentials should ride (box under the legs, behind the seat, or on the deck) and the actual kit volume. Today the 1,500–2,000 in³ figure is unsourced.
7. Preferred wheel source and hub bore (¾" vs 5/8" vs 1"), and whether flat-free tires are acceptable at +1 lb each.

## Schema and downstream readiness

- Viewer: needs articulation and role tags (issue 15).
- §7 checks: need deck structure, material and steel params (issues 2, 8).
- Truck fit: mostly there; add the items in issue 14.
- Cut list / BOM / nesting: need grain direction, a structured joinery list, edge condition and per-instance parts (issue 16).
- Assembly: needs an `AssemblyStep` type; `Part.step` alone cannot hold bent-lam form building and glue-up steps.

## Bottom line

The deliverable is a solid, honest foundation and the arithmetic is sound. It needs a second pass on structure params, cross-parameter constraints, the realistic weight budget and the schema before Phase 1 builds geometry on top of it.
