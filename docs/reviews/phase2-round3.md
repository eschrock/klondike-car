SCORE: 8/10

# Phase 2 checkpoint review, round 3 (final)

`npm test` 470/470 pass, `tsc --noEmit` clean. I regenerated `recommend-table.ts` and `rope-sensitivity.ts` and spot-checked every number in `docs/phase2-recommendation.md` with a throwaway script (deleted; `git status` is clean).

**Verdict.** The deliverable is now honest and well-organised. All round-2 must-fix items are fixed or closed with a documented carry-over. Two small wording and number slips remain, both fixable in a few minutes. Neither changes a pass/fail verdict or the recommendation. I recommend that Eric approve once they are fixed.

## Round-2 must-fix items

| Item | Status | Check |
|---|---|---|
| R1 wrong numbers | **Fixed** (one new slip, N2) | 80 lb comparison is like for like: bridle 3.07× vs 24" tongue 1.71× at the same 8 ft rope (reproduced), and 1.92× at the old 6 ft run (reproduced). Axle is "0.7% over" (25,163 vs 25,000 psi, 0.65%). Turn radius is "2.7% margin". Per-case values for pitch, strike and turntable match the code: 3.84/4.40/3.07×, 281/331 psi, 399/469 lbf. Length is 71.0" installed, 62.75" removables-off, 83.1" for the Phase 1 default, all matching `checkTruckFit` dims |
| R2 rope assumption | **Fixed** | Rope spec ("8 ft tails, tied low") is in the changes table. The full 3×3 sensitivity matches the script output, including the 40"/6 ft 80 lb fail (1.23×). The default hand height of 30" is stated |
| R3 weight vs brief, per-change mass | **Fixed** | 127 lb is "81% over" (126.9/70 = 1.81 ✓). 117 lb → 58 lb per person ✓. Per-change masses match my ablations: WB −3.4, lock +0.5, kingpin +2.3, deck +5.1, tongue −1.5. They sum to +3.0 = 126.9 − 123.9 ✓. 9 mm on 6" joists is −1.7 ✓ |
| R4 kingpin-strike characterisation, stops | **Fixed** | Item 2 now says the 331 psi is an average, the peak and pitch path are unresolved, and the shortfall could be up to ~3×. It shows H = 245 lbf at 1× beside 735 lbf at 3× (verified). It notes that the crossbar bears parallel to grain and that cleavage is unchecked. Stops are item 1 of the unresolved list (~2,150 lbf, ~4×) and a Phase 3 must-fix |
| R5 exploration stale | **Fixed** | "How it was chosen" step 3 says the sweep predates the kingpin model, that its counts do not describe this design, and that the design is hand-built |
| R6 DECISIONS | **Fixed** (see N3) | D-27 added as 🔶 pending, with the superseded IDs listed (D-8/9, D-14, D-12/25/26, D-4, D-17, D-13). Defaults will change on approval |
| P1 panel footnote | **Mostly fixed** | The kingpin row now states the equal-lever bending, the unresolved peak and pitch path, and the sleeve OD. The axle row switches to "1045 TGP (≈ 70+ ksi; confirm vendor cert)" at 65 ksi or more. Still missing (Phase 3): a sleeve-yield row, and a note that ×3 applies to V in the strike |
| P3 test and `_probe.ts` | **Fixed** | `recommended.test.ts` asserts no fails at operating, goal or light. `_probe.ts` is gone |
| L3 steering-exclusion regex | Not fixed | Low severity; carry to Phase 3 |

The table's other values all match the code. These include tip angles, SSF, rollover speed, 93.4" radius, 0.76" clearance, axle ksi, beam psi, groove 299, rails 0.10", deck 0.01", kingpin 67 psi, roll 272/210/0.39, brake 20.3/23.7 lbf, and truck fit. The share-link hash is the same parameter set.

## Must fix before the checkpoint (wording and numbers only)

**N1. The kingpin "Phase 1" description and "2.4× over" are not reproducible and describe the wrong baseline.**
- The changes-table row says "½" grade 8, stopping at the turntable top", and the Why column says "The old cantilevered ½" pin was 2.4× over".
- The Phase 1 default already has `kingpinThroughBolster = 1` (`params.ts:533`), i.e. a crossbar. I flagged this in round 2 (P2) and it is still unfixed.
- Evaluating the Phase 1 defaults gives a strike bearing of 722 psi vs 358, which is **2.0× over** (615 psi, 1.7× at 150 lb). The no-crossbar case I ablated in round 2 gave pin stress 166 vs 65 ksi, 2.6×.
- Suggested rewording: "The Phase 1 ½" pin with a 1.25" lead failed the curb strike (bearing 722 vs 358 psi at the goal case; the pin at ~2.5× its allowable)", or whichever baseline is meant. Name it explicitly.

**N2. Brake figure.**
- The doc says the handle force drops "from 28.1 to 23.7 lbf". Reproduced values:
  - 12:1 at the recommended geometry: 23.7 lbf (✓).
  - 10:1 at the recommended geometry: **28.5 lbf**.
  - 10:1 at the Phase 1 defaults: **28.2 lbf**.
- Neither is 28.1. Use "28.5" (apples to apples), which is still under 30 lbf.

**N3. D-27 ID mapping (cosmetic).**
- D-4 as numbered in DECISIONS is white oak, with the axle yield inside the same entry. D-17 is the frame, ladder vs hull, with the deck inside it. D-14 is pull loads.
- The IDs are defensible, but add the topic after each ID so a reader does not follow the wrong link (for example "D-4 (axle yield)").

## Phase 3 carry-overs (all already listed in the doc unless noted)

- Steering stops, about 4× over: a steel face and a check row.
- Kingpin peak bearing and pitch-moment path. Add a one-line note that the 3× factor stacked on tanφ is an envelope, not an impact analysis, when the check is written up.
- Rope tie load on the axle end, now listed under the Bridle item. It is still not an axle-check row.
- Rope-to-tyre geometry mock-up, and the sim's single-point bridle (the doc says so).
- Bolster fasteners, assumed at 4 × ¼".
- Sleeve-yield row and ×3 note in the panel footnote.
- Steering-exclusion regex in the sweep (L3).
- The 8 ft rope is now a hard requirement, not a detail. The check passes at 80 lb with ratio 3.07× at 30" hands, but fails at 40" hands with 6 ft ropes (1.23×). Put the rope spec on the Phase 3 BOM line.
- Truck width has only 0.5" per side, and a drop-in bedliner would break it.
- Minor: one open decision for Eric is that rollover speed at the goal rider is 8.96 mph, just under the 9.0 mph (1.5× jog) reference. The doc reports it as info only (accepted under A-1); it is not in the marginal list, but that is fine.

## Overall

The recommended parameters are coherent. The pass/fail table is correct to the code. The unresolved items are honestly framed as Phase 3 work, with numbers, rather than hidden in margins. After fixing N1 and N2 (about 5 minutes of text) this is ready for Eric's approval.
