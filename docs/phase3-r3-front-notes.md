# Phase 3 round 3, front end (critic round 2: N-1, N-2, N-3, N-11)

Code citations use D-43 (the F1 block). Proposed new decision ID: D-46 (D-45 is taken by the one-piece hull). `DECISIONS.md` not edited.

## Result
| | before (r2) | after (r3) |
|---|---|---|
| Safe rider range (Simple view, `riderSweep`) | 50 to 200 lb, limiter `kingpin-bolts` 1.01 at the next step | **50 to 220 lb**, first failure at 230 lb, limiter `steer-stops` (pad strain at the soft end of the pad range, 0.94 at 200 lb) |
| All-green range | to 160 lb | to 180 lb |
| 150 lb | passes, `kingpin-bolts` 0.86 | passes; worst front row 0.88 (plate-edge contact) |
| Added mass (steering group, same parameters) | | **+0.5 lb** (ears 0.27 lb, taller 3/8" channel flange and pads about +0.5, thinner arms about -0.4, nylon-insert nuts and arm bolt removed) |

The range went up, not down, because real capacity was added (shear ears, taller pad, 3/8" flange) more than the realistic assumptions (fit-up 0.018", pad range 1,000-3,000 psi, countersink penalty) took away. It is NOT robust to the new assumptions; see the sensitivity table. The Simple view reads `riderSweep`, so it tells the same story automatically (limiter text comes from the check label plus the row name). Recommended wording to Eric: "safe to 200 (the goal) with about 10% margin; do not advertise 220".

Sensitivity (full sweep, one change at a time):
| Change | safe to | green to |
|---|---|---|
| base | 220 | 180 |
| ears do not share (torque share 1.0) | no safe range (the operating weight fails) | none |
| ears share 75% in the carrier plane | 200 | 150 |
| fit-up 0.030" | none (carrier strip 1.0) | none |
| stiff pad 4,000 psi | 200 | none |
| soft pad 700 psi | none (pad strain) | none |
| preload retained 25% | 220 | 180 |

So the front end depends on three things that must be verified in Phase 4: (1) the ears really share the torque (build with the weld, measure bolt-plane share or accept 0.75), (2) fit-up held to 0.018" or better with the shims, (3) pad k measured warm and cold.

## N-1 stop share and the 0.005" fit-up
- `steerStopFitMismatchIn` 0.005 to **0.018** (assumed). Stops are adjustable: each stop block has a shim-pack joint (`steerStopAdjustRangeIn` 0.0625", validator: range >= 2 x mismatch) with the assembly step "shim until both pads of a dog touch a 0.003" feeler together at lock, about 70 F" in the joint note (`stop-block-*`).
- Pad modulus is a range: `steerStopPadModulusMinPsi` 1,000, nominal 1,500, `steerStopPadModulusMaxPsi` 3,000 (cold, 80A). `steer-stops` evaluates all three and every row is the worst of the three (label shows which); `pinLoads` adds "one-wheel strike + stops (soft pad)" and "(stiff pad)" cases so `kingpin-bolts`, `kingpin-plates`, `kingpin-split` see them too. Removed the "net force exceeds the strike" pseudo-row (it was a governs test that failed at 1.005 for no real reason).
- Tuning forced by the soft end: stop dog height 1.25 to 1.625" (pad area), channel steel 5/16 to 3/8", pad 1/4 to 5/16" (stop face, W and r_eff shift: ra 2.961", rb 5.570").
- Positive shear element: the stop torque cannot be put into a pin or key in the oak. The beam is only 2.5" between the front face and the rod groove, so any dowel bigger than the 5/16" bolts breaks the 4D edge distance, and the y-extent is capped by the 12" turntable and the side bearers. Instead the torque is shared between the two bolt planes: **two welded shear ears** (`kp-ear-L/R`, 1/4" A36 web, 0.75" ahead of the beam face, welded to front-corner tabs of the carrier and the beam plate) tie the carrier to the beam plate. `kingpinTorqueTopShare` 0.6 (assumed; 0.5 if equally stiff) stays in the carrier plane, 0.4 goes through the ears into the under-plane bolts. New rows (in `kingpin-bolts`): ear web shear, ear fillet welds.
- Slab/cleavage loads are unchanged (the total torque still reaches the slab).

## N-2 carrier-end bolt capacity
- The carrier bolts now go in from below (hex head and two Belleville washers under the beam plate), threaded into the tapped carrier: no countersink in the load path. Joint data carries the preload torque (K 0.2 x 5/16 x 1,500 lbf = 94 lb.in = 7.8 lb.ft) and a retorque after the first wet day.
- `boltCapacity(..., csDepth)` and `nds.ts` `countersinkDepth` / `effectiveSideThickness` (additive): ls_eff = t - 0.5 x depth. Applied to the crossbar plate bolts (flat heads, depth 0.165", effective 3/16" plate 0.105"): row 0.38 to 0.48 at 200 lb.
- New rows: plate-stack couple bolt tension with no preload credit (0.09), carrier-edge contact with 50% retained preload plus the couple (0.91 at 200 lb, 0.88 at 150), preload clamp pressure (0.84). M = |R_top|(lm/2+t/2) + |R_bot|(lm/2+t/2) = 2.2 H. Params: `kingpinPlateBoltPreloadLb` 1,500, `kingpinPlatePreloadRetainedFrac` 0.5, `kingpinPlateBoltNutFactor` 0.2.

## N-3 stop-dog riser joint
- The riser's two 3/8" screws are gone. Four screws in a 1.25" dog cannot meet edge distances, and a deeper riser (tried 1.0-1.5") pushes the stop face outward and doubles the crossbar-side block bearing (2.04). The web, riser and arm are now **one welded stand** (1/4" E70 all-around fillets, `steerStopWeldIn`, `weldFexxPsi`); the two arm screws bolt it to the carrier. Arm 7/16 to 1/4" so the riser is 5/16" tall.
- Rows: web-to-riser and riser-to-arm weld (direct + torsion from M_z + overturning), allowable 0.3 F_EXX: 0.60 at 200 lb (0.54 at 150). Existing arm-screw rows kept (bearing 0.79).
- Note: the critic asked for bearing and edge rows on the riser screws; with no riser screws there is nothing to bear on. If Eric prefers screws, the dog width must grow.

## Rows at 150 / 200 lb (utilization)
| Row | 150 | 200 |
|---|---|---|
| kingpin-bolts carrier end (stiff pad) | 0.79 | 0.87 |
| kingpin-bolts under end | 0.45 | 0.51 |
| plate-stack couple, bolt tension | 0.08 | 0.09 |
| plate-stack couple, edge contact | 0.88 | 0.91 |
| preload clamp pressure | 0.84 | 0.84 |
| ear web / ear welds | 0.11 / 0.06 | 0.13 / 0.06 |
| crossbar plate bolt (with countersink) | 0.45 | 0.48 |
| steer-stops pad strain (soft) | 0.83 | 0.94 |
| steer-stops flange bending (stiff) | 0.74 | 0.82 |
| steer-stops weld (web-riser, riser-arm) | 0.54 | 0.60 |
| steer-stops-bound worst (carrier strip) | 0.8 | 0.88 |
| kingpin-plates carrier strip (stiff) | 0.8 | 0.9 |

## N-11
D-35/D-36 citations in `front.ts`, `nds.ts`, `kingpin-plates.ts`, `stops.ts`, `steering.ts`, the tests, and the params entries of the plates and stops now cite D-43. Proposed ID for this block: D-46.

## Proposed DECISIONS text
| D-46 | **Front end, round 3 (critic Phase 3 r2 N-1..N-3).** *Stops adjustable, realistic fit-up:* shim packs under the stop blocks with a feeler-gauge step; residual mismatch 0.018"; pad modulus bounded 1,000-3,000 psi and every stop row evaluated at soft/nominal/stiff, the stop-pair cases also feed every kingpin row. Dog 1.625" tall, 3/8" channel, 5/16" pads. *Torque shared by two bolt planes:* two welded shear ears tie the carrier to the beam plate (60% carrier plane, 40% under plane, assumed). *Carrier bolts from below, tapped* (no countersink in the load path), preload 1,500 lbf (7.8 lb.ft) with Bellevilles; countersink penalty in `boltCapacity` for the crossbar bolts; plate-stack couple rows. *Riser:* dog, riser and arm are one welded stand (1/4" fillets), arm 1/4". Safe range 50-220 lb (green 180); depends on the ear share, fit-up and pad k: verify in Phase 4. | 🔶 |

## Verify in Phase 4
Ear share (strain-gauge or just a mock-up with a dial indicator); pad k at 20 F and 90 F; feeler step repeatable to 0.018"; thread length on the carrier bolts (shank in the shear plane); NDS countersink clause; weld procedure for the ear subassembly.

## Files touched
`src/analysis/front.ts`, `src/analysis/nds.ts`, `src/analysis/nds.test.ts`, `src/analysis/front.test.ts`, `src/model/steering.ts`, `src/model/kingpin-plates.ts` (citations), `src/model/stops.ts` (citations), `src/model/front.test.ts`, `src/params.ts` (new params, defaults, validator, refs).
