# Phase 3b Stage 2 flip: notes

The Ackermann front end, the one-level bow hull, the ride brakes and the bump-basis analysis are now THE design. The old design and every switch are gone.
Nothing here is committed (the orchestrator commits). Tests: see the end.

## What was done

### One switch, then none
- Removed `ViewState.frontEnd`, `buildModel(p, { frontEnd })`, params `frontEndType`, `frontBrakeType`, `brakeShoeBacking`, `rideBrakeControls`, and `Ctx.newFront`.
- Every `PHASE3B_DEFAULT_OVERRIDES` value is now the `PARAM_DEFS` default (`steerLockDeg` 35.5, `kingpinLeadIn` 1.25, `kingpinDiameterIn` 0.375,
  `turnRadiusMaxIn` 108, `brakeLiningThickIn` 0.25, `brakeShoePinYieldPsi` 100000, `noseWidthIn` 13, `hullCurveStartIn` 14.5, `hullLamThicknessIn` 0.3125, `hullWebPlies` 1).
  Ranges widened: `steerLockDeg` 28 to 42, `kingpinDiameterIn` min 0.25. `phase3bDefaults()` and the overrides are deleted; callers use `defaultParams()`.
- `resolveParams` is only the bow resolver; `hullCurveSpec` always carries the Ackermann spec; the validators no longer know the old front.
- New params: `steeringLinkClearIn` (0.25 in, steering group; the clearance the linkage keeps to the rest of the cart), `frontBrakeBiasTolerance` (0.05, brake group).

### Deleted (old design)
- Model: turntable, kingpin plates (carrier, under-plate, bar plate), crossbar, steer-stop stand, stop dogs/blocks/faces, ears, bolster, sleeves, side bearers, nose access
  panel, old front axle rod, oak beam, U-bolt clamps and eye bolts, bridle legs, the 'steer' rigid body and the turntable branch in `sim/spec.ts` and `sim/core.ts`;
  S-curve hull bits (shoulder beam, deck step, riser, rail ledge, split `deck-cabin`/`deck-nose`, the `Layout` aliases `noseTop`, `noseBot`, `xs`, `shoulderBeam`, `beamF`, `bolster`, `kingpin`, `kpPlates`, `turntable`).
- Files: `src/model/steering.ts`, `kingpin-plates.ts`, `stops.ts`, `model/front.test.ts`, `analysis/front.ts`, `analysis/front.test.ts`, the old `analysis/rear.ts` (the bump-basis `rear-bump.ts` became `rear.ts`),
  `analysis/recommended.test.ts`, `src/test-baselines.ts`; scripts `explore`, `candidate`, `recommend-table`, `recommended`, `rope-sensitivity`, `hull-mass` (Phase 2 exploration; `hull-shapes.ts` now uses `defaultParams`).
- Params: about 80 old ones (turntable, bolster, side bearer, steer stop, kingpin plate/sleeve/crossbar/washer, `drawbar`, `frontDeckRaiseIn`, `curbStrikeG`, `rodKingpinWebMinIn`, `frontAxleBeamThicknessIn`, ...), plus
  `kingpinBoreIn`, `bolsterPlan`, `steerStopPlan`, `swingGeometry`, `TURNTABLE_PRESETS`. Unknown keys in old shared links are ignored by `sanitizeParams` (tested in `ackermann.test.ts` and `model.test.ts`: "old shared links").
- Analysis: the old kingpin / turntable / tongue / front-beam rows and allowables, `obstacleForce`, `rollBalance`, kingpin-strike and roll rows; `FRONT_END_IDS`/`FRONT_END_NOTE` in `simple-text.ts` were re-created for the NEW front-end rows (see "Simple view" below).
- `boltCapacity` in `nds.ts` is kept (the new bracket rows use it); its param `kingpinPlateBoltYieldPsi` still has the legacy name.

### Integration fixes (from the workstream notes)
- WS-E: `poses()` in the sim now sets `tie-rod`, `bellcrank`, `drag-link`, `tongue-link` and `tongue`; `frontBrakeShare` is wired (0.60).
- WS-B with WS-A: the deck gets its cable slot at `Layout.front.cable.slot`; the nose joists are split into `joist-nose-i-L/R` around the front-end keep-out and carried by new `stringer-nose-{L,R}{1,2}`
  (`Layout.noseStringers`); the tongue top sits below the front transom (`TONGUE_UNDER_TRANSOM_MARGIN_IN` 0.05 in plus `steeringLinkClearIn`); nose rail end is the transom inner face.
- WS-C with WS-A: `kp-bracket` vs `brake-front-horn` was a real clash, fixed in geometry (horn root standoff derived from the real leaf disc, slope-corrected, 0.1 in air; min gap now at least 0.25 in) using
  an exact rectilinear OBB decomposition (`bounds.ts` splits C-brackets into web and leaves, tires into 12 bands). The brake cables and equalizer are kept out of the stick-cable corridor (equalizer moved 2 in aft of the corridor,
  exit grommet z = deck bottom minus half the rail depth).
- WS-C holes and fittings are modeled as hole joints (`JointType 'hole'`, host-only) in "Cable runs, holes and fittings" in `joinery.ts`: joist and rear-beam holes for the main cable, the transom screw for the hip housing stop,
  chine grommet hole for the hip cable (host switches to the nose chine if it would land forward of `xn`), belt-anchor bolt holes in the deck, rail/girder and doubler, nose-rail housing hole.
- WS-D: `analysis/hull.ts` and `structure.ts` read the new ids (`deck`, the nose rail section, the angled bow run per `bowHeading`); the foot-stop screw count (the 1e9 sentinel) is fixed (`j.to === 'deck'`);
  `steer-clear` runs on the real new parts in two groups (front tires: limit `steeringClearanceIn - 0.05`; linkage and everything else: limit `steeringLinkClearIn`), the wheel vs `kp-bracket` pair is skipped on the scrub rule.
- `ride-envelope`: bias tolerance is now a param (`frontBrakeBiasTolerance` = 0.05, was 0.1 in the spec test) because the 0.60 share is a design value, not a +/-0.1 one. At exactly 0.60 the 8 deg / mu 0.4 GO corner is 0.218 g;
  at +/-0.05 it is 0.174 g, below the 0.2 g GO line, so the row stays 'info' and says so (WATCH sentence). The test pins that honestly.
- Explode vectors are normalized for every part (`unitDir` at the end of `buildModel`); the finish tags cover the new parts (cables, webbing, blackened steel).
- Foot stop (found by the model overlap test): the bow converges, so the foot-stop board and its cleats are now cut to the NARROWEST inside width over their x range (they poked 0.1 to 0.44 in into the sides).

### Verified
- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:single` pass.
- App at http://localhost:5179: Iso, Top and Side views, Simple and Advanced, the steering slider and Tow / Ride / Both modes render; no errors after the final reload. (The console buffer still holds stale HMR errors from while files were mid-edit.)

## Real numbers at the defaults

Empty mass 174.1 lb (it was 166 lb for the old design). By group (lb): running gear 33.9, steering 26.9, frame 15.4, body 35.4, removable 3.4, seat 9.0, storage 8.8, hardware 8.9, brake 30.9
(includes the front tread brakes, bias bar, hip lever, lap belt and the ride stick cables), lighting 1.4. Operating CG height 14.2 in; 150 lb operating mass 349 lb, goal 399 lb.

### Safe rider range
None. The operating rider (150 lb) FAILS, so `riderSweep` returns `safe = null` and `green = null`. The limiter is the new front end (kingpin-bracket worst, then kingpin-bolt) and the rear end on the bump basis.
The Simple view says so (the FRONT_END_NOTE) rather than hiding it.

### Checks that fail (operating 150 lb / goal 200 lb utilization; 1.00 = at the limit)
| Check | 150 lb | 200 lb |
|---|---|---|
| kingpin-bracket | 4.94 | 5.33 |
| rear-beam-seat | 4.38 | 4.72 |
| bearing-groove (rear beam on the rod) | 2.86 | 3.08 |
| kingpin-bolt | 2.70 | 2.90 |
| bellcrank | 2.64 | 2.64 |
| stick-cable | 2.17 | 2.17 |
| wheel-rating | 1.92 | 2.07 |
| axle-stress (rear) | 1.83 | 1.97 |
| tongue-tie | 1.32 | 1.32 |
| tie-rod | 1.01 | 1.08 |
| brake-heat | 0.93 (marginal) | 1.21 FAIL |

Marginal at 150 lb: turn-radius 0.98, steer-clear 0.95 (tires 0.738 in against a 0.70 in limit), brake-ratio, brake-abuse 0.94, brake-bias 1.00, brake-front 0.97, tongue 0.95, brake-heat 0.93.
Also marginal only at 200 lb: brake-force 0.90, hip-cable 0.90, beam-front 0.96, wheel-retention 0.95.
Count in the UI: operating 39 pass / 8 marginal / 10 fail; goal 35 / 11 / 11.
These are the bump-basis (D-50) results, not tuned: the new rows are undersized at the current default sizes. Nothing was changed to make them pass.

### Simple view
`FRONT_END_NOTE` ("The new steering front end ... is still being verified.") applies to the rows in `FRONT_END_IDS` (spindle-stub, spindle-fatigue, kingpin-bolt, kingpin-bracket, wheel-retention, tie-rod, drag-link, bellcrank,
steer-stop-load, beam-front, tongue, tongue-tie, stick-cable, brake-front, hip-cable), because several of them fail at 150 lb. Remove the note when those rows pass.

## Open items

1. Sizing: the ten failing rows above need engineering decisions (bracket and bolt sizes, bellcrank, tongue tie, stick cable, rear axle/beam on the 1" bump). The rear axle and beam rows were already near-limit on the old basis.
2. Truck fit: assembled (tongue installed, 81.7 in long) does NOT fit the bed (-0.18 in); tongue off (69.5 in) fits beside the wells; straddling fails at the 44 in wheelbase. The row passes because the tongue-off case fits (2 of 4 placements).
3. Off-default clashes (listed in `KNOWN_OFF_DEFAULT` in `src/model/model.test.ts`; the defaults are checked strictly with no entries, the variant and fuzz sweeps tolerate only those pairs). Real geometry problems in the new
   brake-control and ride-stick routing, laid out for the default seat, storage and width:
   - hip cable vs the ratchet quadrant (overslung 11.5 in deck variant, 0.12 in), hip cable vs the removable sign (raised seat / bigger wheels), the printed cable channel vs the chine (raised and under-seat storage), hip cable vs the
     steered front wheel in the forward-raised storage layout;
   - belt doubler vs the rear beam with the seat at its rearmost; lap belt vs a 23 in hull; belt anchor vs lap belt;
   - ride stick, stick bracket and stick cables vs the seat cushion in the 23 in body variant (the validator has no rule for the stick station), the stick cables vs a cabin joist when the strips are thinner, vs the storage box;
   - bellcrank vs the front beam at the 42 deg lock slider maximum (0.07 in); steer arm vs the tire at a 32 in front track; tie rod vs the nose rails and tongue vs the nose stringers in random extremes;
   - finger guard vs a lash doubler at a 10 in front overhang; tongue plate vs the front transom at a 4.5 in overhang.
4. A bell bracket row is missing from the analysis (the bellcrank row covers the plate and pin, not its mount).
5. The `hull-beam` frame style's nose layers do not change with the bow heading.
6. The steer sweep treats the tire as 12 bands, not an exact disc; wheel vs `kp-bracket` is judged by the scrub rule (leaf disc tangent to the tire inner face, tested analytically in `front-end.test.ts`).
7. The foot-stop board spans the hull inside width at its own x (narrowest over its thickness); a thin wedge gap at the wider end needs thickened epoxy (the joint note says so). The cabin rail is 3 in deep and remains 1.65 in over the rear-beam notch.
8. `brakeShoeLengthIn` and `brakeShoeWidthIn` are kept only for the oak-comparison heat row. `kingpinPlateBoltYieldPsi` keeps its legacy name (used by `boltCapacity`).
9. The Phase 2 exploration scripts are deleted, so `docs/phase2-exploration.md` and `docs/phase2-recommendation.md` refer to tools that no longer exist.
10. `runChecks` takes about 60 to 100 ms at the defaults (the old test limit was 30 ms); `riderSweep` about 1 to 2 s (it was about 110 ms). Both tests have CI-tolerant limits.
11. `docs/STATUS.md` and DECISIONS.md are not updated by this change; the orchestrator owns them.
