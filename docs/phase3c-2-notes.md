# Phase 3c-2 notes: cargo mode and bed

Scope is D-53 (Eric): after the race the cart hauls gear, firewood and water; the seat back and cushion stow in the storage box; the bed is flat; a sled-style handlebow; the six D-rings are the tie-downs. Plan: `docs/phase3c-plan.md`. Nothing is committed (the orchestrator commits). `DECISIONS.md` and `docs/STATUS.md` are not touched.

Orchestrator heads-up for 3c-3 (24" straight-sided body, sled side profile, curled bow): everything here reads the layout and params (`L.hwC`, `L.sideH`, `L.deckTop`, `L.storage`, `rearHandleHeightIn`, `seatBackSupport`), not today's numbers. Things that WILL need a look when the body changes: `cargoBed` takes the height to the gunwale from `L.sideH` (the lowest side; with a sloped side profile, measure it per x); the box height cap under the grab-handle doublers (`GRIP_BOX_CLEAR_IN`, layout.ts) uses `sideHeightIn - railBandIn`; the stow width margin (2.3 in) shrinks with a narrower box (cushion 18 in plus two 3.3 in strips needs 24.7 in inside, today 26.0; at a 24 in body the cushion strips need to go on top of the back or the wedges and knobs go on the cushion).

## Result in brief

| | |
|---|---|
| Empty mass | 145.5 lb to **146.3 lb** (+0.8: third lid batten and a taller box +1.1 storage, handlebow and loose wedges net about 0). Transport 132.3 lb |
| Rider safe/green range | **none**, as at 3c-1 (the same front-end and rear-axle-seat rows). Limiter: bellcrank (2.64). Cargo cannot move it (tested) |
| Cargo capacity | **19 lb today**, limiter the **kingpin bolt** (it is at 0.95 of its limit on an empty bed). Leaving out the 7 rows that already fail for riders, the next limit is **spindle fatigue at 154 lb**, then the rear axle stub at about 199 lb |
| At the 250 lb target | 22 pass / 2 marginal / 9 fail |
| Usable bed | 9.4 in behind the box end to the foot stop: **26.75 in wide at the box, 20 in or wider for 27.5 in, 24 in or wider for 20.0 in, 7.0 in to the gunwale**, 38.3 in long out to the foot stop, narrowing (14 in at the stop). Floor area 874 in² |

## 1. Cargo load case

- **Param** `cargoPayloadLb` = 250 lb (assumed, ref D-53, note "Confirm with Eric", a primary slider). Others (group `cargo`, all assumed, D-53): `cargoConcentratedLb` 90 (two full 5-gal jugs or a cooler) on `cargoPatchAlongIn` x `cargoPatchAcrossIn` 12 x 12; `cargoCgHeightIn` 12 above the deck (5 in over the gunwale); `cargoCgOffsetYIn` 3; `cargoLoadLengthIn` 16 and `cargoLoadWidthIn` 20 (how far fore the pile can sit: the hull narrows); `cargoLidLoadLb` 40; `cargoRestraintG` 0.8; `cargoStrapMu` 0.3; `cargoStrapWllLbf` 500.
- **Load model** (`analysis/loads.ts`, `context.ts`): `LoadModel.cargoCases` = two placements of the payload (piled against the box; piled at the nose end of the bed where it is still 20 in wide) on the **stowed** cart (`buildModel(..., seat: 'stowed')`), no rider, CG 12 in over the deck, 3 in off center. A row reports the **worse** of the two.
- **Rows** (`evalBoth` in `stability.ts` adds the cargo case to every dual row; the deck has its own uniform and concentrated evaluation): tip-straight, tip-lock, slide-before-tip, v-rollover, pitch-fwd/rear, brake-force and every brake member row, park-hold, wheel-rating, rear-beam-seat, axle-stress, beam-rear, bearing-groove, rails, deck (uniform and 90 lb on 12 x 12), the whole front end and linkage rows, and the new `joists`.
- **No rider logic changed.** `AnalysisCheck.status`, `statusOperating`, `statusGoal`, `util`, `governingLoad` are rider-only; the cargo result is `cases.cargo`, `statusCargo`, `utilCargo`, `detailsCargo`. A test runs the checks at 0, 250 and 600 lb and with the cargo case off and compares every rider field of every row (equal), and compares the rider sweep. The rider sweeps skip the cargo case (`runChecks(..., { cargo: false })`) so they are no slower.
- **Cargo governs** (cargo util above the rider util; rider / cargo): tip-straight .82/.92 (**marginal**, 43.6 deg vs 40), tip-lock, slide-before-tip, brake-force .77/.82 (24.7 lbf at the handle, limit 30), brake lever/links/beam/shoes, **wheel-rating 1.05/1.22**, **rear-beam-seat 2.39/2.65**, **axle-stress .98/1.08**, beam-rear, **bearing-groove 1.56/1.73**, rails .67/.73, spindle-stub, **kingpin-bolt 1.53/1.97**, **kingpin-bracket 2.90/3.78**, beam-front, wheel-retention, **spindle-fatigue .90/1.42**. Joists, deck, the lid and the straps pass with room.
- **Counts** (all rows, truck excluded): operating 150 lb 37 pass / 6 marginal / 6 fail; goal 200 lb 37 / 5 / 7; cargo 250 lb 22 / 2 / 9.
- **Failing rows (do not resize, 3c-3).** At 150 lb: rear-beam-seat 2.21, bearing-groove 1.44, kingpin-bolt 1.40, kingpin-bracket 2.63, bellcrank 2.64, tongue-tie 1.32. At 200 lb: those plus wheel-rating 1.05 (all a little worse than 3c-1 for the front, better for the rear: axle-stress is now marginal .98, no longer failing, because the seat moved 3.5 in forward). At 250 lb cargo, also axle-stress 1.08 and spindle-fatigue 1.42. The cargo case is 1.1 to 1.3 times as bad as the goal rider on the front end and rear axle seat: 3c-3 should size those rows to the cargo case, not the rider.
- **Finding: rear-only brake traction with cargo is 0.62** (info row `brake-traction`, cargo case): parked nose-down on 15 degrees with the full load piled forward, the rear wheels alone hold about 62% of it; the pullers or a chock hold the rest. The brake itself needs 24.7 lbf at the handle (passes). It is in the Simple card.
- **Capacity** (`analysis/cargo-capacity.ts`): runs the checks up a ladder of payloads (0 to 600 lb), interpolates each row's cargo utilization, and reports the first row to reach its limit (excluding rows that already fail empty, listed as `alwaysFailing`: rear-beam-seat, kingpin-bracket, bellcrank, tongue-tie), plus the capacity with the 7 rider-failing rows left out. About 0.7 s, cached by design (rider masses and payload do not invalidate it).
- **Simple view**: a card "After the race: hauling" (headline "Hauls up to N lb after the race", the limiter, the next limit, the bed, whether the seat fits, the traction note). It is separate from the rider headline and never read by it. Advanced Analysis: each row shows a `cargo 250 lb` chip next to the rider chips, a Cargo summary line, and the cargo criteria under the row.

## 2. The seat stows in the storage box

- **Fit, from real part bounding boxes** (`model/seat-stow.ts`, `seatStowPlan`): back 16.00 x 16.00 x 1.75 in (frame 0.75 + pad 1.0), cushion 15.625 x 18 x 2, each wedge 4.25 x 1.5 x 1.4 on its long edge, knob head with its 3.5 in stud, two plugs. The box interior is measured inside the 6 mm walls; the lowest piece rides on the 3/8 in corner fillets; the ceiling is the underside of the lid frame and battens (the lid panel, gasket and coaming are above it). Layout: **cushion on the floor flush to the aft wall** (its fore end stops short of the 1 in insert backers), **seat back on it, frame down, pad up, centered** (clears the coaming ledge at both ends and rides above the backers, whose tops were trimmed 0.05 in under it), wedge and knob in a strip along each side wall.
- **The box had to grow.** At the old 12 in seat position the box was 13.4 in long inside, shorter than the 16 in back and the 15.6 in cushion. Changes: `seatXIn` 12 to **15.5** (the box end follows the leaning back, so it lengthens), `riderLegReachIn` 36 to **32.5** so the foot stop stays at x 48 and the nose and steering do not change, `storageVolumeIn3` 2,000 to **2,200** (height under the lid frame; the Essentials pack row stays at 0.76). The box height is capped 1/4 in under the grab-handle doublers where the box now reaches them (`GRIP_BOX_CLEAR_IN`). The grab handles slide aft under the straight side as they already did (the validator rule that forced the seat back was relaxed to "grips within 9 in of the hips").
- **Margins** (row `seat-stow`, pass): fore-aft 0.52 in, across 2.28 in, height 0.39 in (marginal under 0.25). The row text carries the unstowing and stowing procedure. With the seat at 12 in the row fails (tested).
- **View state**: `ViewState.seat: 'installed' | 'stowed'` (default installed). Stowed moves the kit into the box (same parts, same mass), drops the mannequin, and with `cargo` on shows the payload block on the bed (20 in wide, 16 long, 24 high, CG 12 in up). Viewer toolbar: "Seat stowed (cargo mode)". The closed lid hides the stack; the numbers are in the tests.
- **No tools**: unscrew two star knobs; the 3/8-16 x 3-1/2 in stud is part of the knob (the D-40 "jam nut on the stile" is dropped, it would have kept the stud on the back); lift the back and the loose wedges; peel the cushion off its Dual Lock. D-40's knobs, inserts and Dual Lock are kept.
- **Sealing**: the two stud holes through the box fore end would leave the weatherproof box open with the seat off, so two 316 thumb screws with bonded washers (`seat-plug-L/R`, 0.05 lb each) thread into the same inserts from the bed side in cargo mode and ride loose in the box otherwise.
- **The wedge is now a loose block** (not glued or screwed to the deck), removable with the back. The aft load presses the stile down and aft on it, and with the wedge missing the stud cannot reach the insert, so a forgotten wedge shows at once. `seat-back` is 0.69 at the 200 lb rider (was 0.59, crest bearing; the lower box changed the crest).

## 3. Flat bed

With the seat stowed the only things standing on the bed are the foot stop and its cleats at the nose end (47.6 in; they stay as the front stop, 4 in tall, removable only with tools) and the 0.4 in plug heads on the box end. The grab-handle doublers stand 1 in proud inside the gunwale top (1.5 in band, 4.7 in long); that narrows the top of the bed slightly and is tested to be above the box. Bed dimensions above come from `model/bed.ts` (derived from the layout). The box lid (5.25 in above the deck) is a table for light items: the lid had 2 battens of 3/4 x 1/2 in and carried 29 lb of a 40 lb item; it now has **3 battens of 1 x 1/2 in** (storage.ts), capacity 50 lb (row `lid-load`).

## 4. Handlebow

`handle-bar` is now a **crowned bent lamination** (4 plies of 5/16 in white oak, 1.25 in square, `handleBowCrownIn` 3 in): a circular arc through the two post tops at the grip height (34 in) that rises 3 in at the middle and overhangs the posts to the cart edge. Posts, sockets, pins and D-39 loads unchanged; the post tops are sawn to the bow's 29.6 degree slope (the posts became profile parts). New row `handle-bow` (hold-back 50 lbf at the middle, 874 psi against 4,088 after the lamination curvature factor 0.63). **Brake lever**: it stays on the transom face at the centerline (bracket, hitch-pin park and quadrant untouched, so brake-force and the members are unchanged: 150/200 lb values equal 3c-1 apart from the mass change). It now hangs in the hollow under the crown with 5.9 in between the top of its grip and the bow (was 2.9); I tried raising the lever to follow the crown and the 100 lbf abuse row failed, so it was left. The bow does not touch the lever, the sockets, the transom or the D-rings. Installed height of the cart is 3 in taller (37.6 in); the truck fit is unchanged (the handle is removable: 2 of 4 transport placements).

## 5. Tie-downs

The six D-rings (D-41) are the cargo tie-downs. Row `cargo-strap`: 250 lb must resist 0.8 g forward at friction 0.3, so the straps add 417 lbf of hold-down; 3 strap pairs at 45 degrees carry **98 lbf each**, 33% of a plate's 300 lbf working load and 20% of a 500 lbf cam strap (the `lash-load` row already checks the plate screws at 300 lbf). No ratchets (crush the oak doublers). **Stake pockets: not added.** The two push-handle sockets (rated 50 lbf at 34 in) take a pole foot or the parade flag when the handlebow is off, which costs nothing; extra pockets would add width or sit on the rear light plate and the lever. No param was added for them.

## Other new rows

`joists` (seat load and a standing scout for the riders; uniform and 90 lb for the cargo; the rider part passes at .77), `lid-load`, `cargo-strap` (cargo-only rows: rider status `info`, result in `statusCargo`), `seat-stow`, `handle-bow`. Rider-sweep light map: joists and handle-bow color Strength; the others are info.

## Files

New: `src/model/seat-stow.ts`, `src/model/bed.ts`, `src/analysis/cargo.ts`, `src/analysis/cargo-capacity.ts`, tests `src/model/seat-stow.test.ts`, `src/analysis/cargo.test.ts`. Changed: `src/params.ts`, `src/model/{handle,seat,storage,layout,rider,build-utils,index,types}.ts`, `src/analysis/{loads,context,dual,types,stability,structure,index,rider-sweep}.ts`, `src/ui/{analysis-panel,simple-text,simple-view}.ts` and `simple-view.css`, `src/main.ts`, `src/truck/fit.ts`; test updates in `brake`, `rider-sweep`, `fittings`, `hull-curve`, `model`, `rear-mount`, `visual-geometry`, `simple-text`.

## Verification

`npm run typecheck`, `npm test` (39 files, 1,151 tests; was 37 and 1,077), `npm run build`, `npm run build:single` pass. Browser (localhost:5179): the handlebow renders crowned on its posts; "Seat stowed (cargo mode)" clears the bed and with "Show rider" the payload block sits on it; the Simple view shows the cargo card; Advanced Analysis shows the cargo chips and the new rows; no console errors.

## Open for 3c-3 and Eric

1. Confirm the 250 lb payload and the assumed cargo CG (12 in), concentrated item (90 lb), lid rating (40 lb).
2. Size the front end and rear axle seat to the cargo case (see the table), and the wheel rating (1.22) and axle stub.
3. Cargo tip is marginal (43.6 deg vs 40): a lower CG or a wider track.
4. Rear-only traction 0.62 with a forward load: chock or the puller.
5. The seat position (15.5 in) and leg reach (32.5 in) should be confirmed on a mock-up with a real rider.
