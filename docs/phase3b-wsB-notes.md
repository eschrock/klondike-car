# Phase 3b WS-B: hull taper, frame and joinery

Owner's words: "If the front wheels don't need to pivot so much, can we have a more graceful transition to the front without the 's-curve' look?" Result: the hull is one convex taper from the cabin to a 13" bow, with no S-curve and no waist. Plan view of all candidates: `docs/phase3b-wsB-shapes.svg` (made by `scripts/hull-shapes.ts`, which also prints the numbers below).

Everything here is behind `frontEndType = 1` (new param, default 0 until the Stage 2 flip; `PHASE3B_DEFAULT_OVERRIDES` sets it to 1, so `phase3bDefaults()` selects the new hull). With `frontEndType = 0` the old hull path is unchanged (all old tests pass).

## 1. Why a bow taper beats the spec's reverse curve

The tire sweep (left tire, left-knuckle angle -26..+35.5, 72 rectangles) pinches the hull only at one place: the rear-inner tire corner at the inner lock, at (x 38.4, y 11.06). Ahead of x = 40 the envelope rises quickly (13.7 at x 42, 15.7 at x 45), and the rider's feet need only about 12" inside. So after the pinch the hull does not have to stay 20.6" wide. If it keeps converging, the curve never has to turn back, and the "waist" disappears. The D-45 reverse curve (parallel nose) is the family member with reverse length = 1; the new family goes down to 0 (fully convex).

Construction (`hull-curve.ts`, `bowCurveWithLambda`, `fitBowCurve`): a convergent curvature pulse (trapezoid ramps, so curvature starts at 0 and heading is tangent to the cabin side), an optional equal-peak reverse pulse of relative length `lam`, then a straight bow run of fixed x extent to the front transom. For a given bow width the one free parameter `lam` is solved (scan + bisection) for the smallest value whose outer face still clears the sweep by `steeringClearanceIn` (+0.005" fit margin), which is the smallest peak curvature that works. The curve ends `hullBowStraightIn` (default 16") behind the front transom's inner face; the scarfs and the sheer rise sit on that straight run.

## 2. Candidates (defaults: cabin 28" outside, clearance 0.75", curve start 14.5 = the grab handles' front, front transom inner face x = 51.75)

Outside width of the hull at x (in); R_min is the centerline radius; "reverse turn" is the total heading change that turns back; foot zone = x 38.1-47.6, needs 12.13" inside.

| Candidate | R_min | Peak heading | Bow (tail) heading | Reverse turn | Bow width | Min inside width, foot zone | Width at x = 14.5 / 25 / 35 / 38.4 / 44 / 48 / 51.75 |
|---|---|---|---|---|---|---|---|
| A spec default: D-45 reverse curve, parallel nose 20.625, end x 39.5 | 33.5" | 19.0 | 0 | 18.0 deg (an S) | 20.6 | 19.4 | 28.0 / 25.6 / 20.9 / 20.6 / 20.6 / 20.6 / 20.6 |
| **B default: bow 13, straight run 16** | **57.8"** | 15.9 | 15.7 | 0.14 deg (none) | 13.0 | 14.1 | 28.0 / 26.9 / 22.5 / 20.6 / 17.4 / 15.1 / 13.0 |
| C pointed: bow 9.5, straight 16 | 48.2" | 19.4 | 19.4 | 0 | 9.5 | 11.1 (too narrow for the feet) | 28.0 / 26.7 / 21.3 / 18.9 / 15.0 / 12.2 / 9.5 |
| D blunt: bow 16, straight 16 | 46.3" | 14.9 | 9.8 | 5.1 deg | 16.0 | 16.2 | 28.0 / 26.4 / 21.8 / 20.6 / 18.7 / 17.3 / 16.0 |
| E bow 13, straight 8 (the spec's length) | 58.5" | 18.4 | 14.9 | 3.5 deg | 13.0 | 13.9 | 28.0 / 27.0 / 22.7 / 20.5 / 17.1 / 15.0 / 13.0 |
| F as B, curve start 12.5 (grab handles 2" aft) | 66.2" | 15.3 | 15.3 | 0 | 13.0 | 14.0 | 28.0 / 26.6 / 22.2 / 20.3 / 17.3 / 15.1 / 13.0 |
| G as B with 1.5" clearance (no finger guard) | 40.5" | 17.9 | 12.7 | 5.1 deg | 13.0 | 13.6 | 28.0 / 26.2 / 20.6 / 19.0 / 16.5 / 14.7 / 13.0 |

Plan-view coordinates of the default B (outer face of the chine, left side, |y|): x 14.5 half width 14.00; 20 / 13.91; 25 / 13.45; 30 / 12.54; 35 / 11.23; 38.4 / 10.27; 40 / 9.82; 44 / 8.69; 48 / 7.57; 51.75 / 6.51. Centerline curve points are in `Layout.hull.pts`.

Why B is the default: it has the largest radius of the shapes that stay convex (R = 58", 1.7 times the spec's 33.5" for A and 10 times the old 5.7"), no inflection, a bow wide enough for the lantern, flag clip and a 4.5" hand-hold (transom 13"), 1.9" of spare room in the foot zone, and a 16" straight run that holds the finger-guard zone, the scarfs and the 2.5" sheer. A longer curved part (straight 8) gains nothing in radius and brings back a small reverse. Narrower than about 11" starves the feet; wider than about 15" brings back reverse turning.

Reading the table for the rest of the numbers the coordinator asked for: peak heading 15.9 deg; bow width 13.0"; the 20.6" "nose" of the spec is now the width at the sweep pinch (20.55" at x = 38.4: the hull is angled, so it may be as wide as 2 x (11.06 - 0.75) = 20.625 only where it is perpendicular to the clearance).

**Grab handles (decision for Eric).** The curve starts at 14.5, the front of the grab handles (they end at 14.4 with the seat at x = 12). Moving seat and grips 2" aft (curve start 12.5) lifts R_min from 58" to 66", and 4.5" aft is worth about 80". It also shortens the leg reach to the foot stop. I did not do it; the slider `hullCurveStartIn` already moves the start, and auto moves it earlier when needed.

**Solid springing.** At R_min = 58" the 5/8" chine is at R/t = 93 (inside radius 57.5" vs the rule R >= 100 t = 62.5"), so a solid sprung chine is close: a test strip is worth trying on the form (an `info` message from `validateParams` says so). The 3/4" rail needs 75". The default stays 2-ply laminated.

## 3. What changed

New params: `frontEndType` (0 turntable, 1 Ackermann), `hullBowStraightIn` (16, scarf zone and sheer length). Reused with new meaning in the new hull: `noseWidthIn` = outside width of the bow at the front transom (range now 10-24, override 13; the pinch width is derived), `noseTaperStartIn` = derived (range now -12..26; the curve end is 8.25" behind the axle, x = 35.75). `hullLamThicknessIn` range now up to 3/8 (override 5/16), `hullWebPlies` override 1, `hullCurveStartIn` override 14.5 (all in `PHASE3B_DEFAULT_OVERRIDES`). For the new hull `resolveParams` forces `frontDeckRaiseIn = 0` and `shoulderBeamIn = 0` for every consumer, so the stepped-deck validators and the layout aliases (`noseTop = deckTop`, `xs = xn`, `shoulderBeam = 0`) fall out with no other change. New `ParamIssue` severity `info`. `requiredCurveRadius` and the bend validator now use the real ply (`lamPly`: 3/4" rail from 5/16 strips is 2 x 3/8, not 2.4 x 5/16).

New code: `hull-curve.ts` (`bowCurveWithLambda`, `fitBowCurve`, `hazardRangeX`, `sweepPinch`; `PlanCurve.endSlope` and `reverseFrac`, all consumers of `sidePolyline`/`curveCenterY`/`curveHeading` handle the straight bow run); `params.ts` (`hullPlanCurve`, `hullTireGap`, `bowSpecOf`, `footZoneX`, `lamPly`, `resolveNoseAck`); `front-mount.ts` (`frontBeamSeat`: nose-rail notch and hold-down angle for `beam-F`); `layout.ts` (`ackHull`, `bowHeading`, joists straddle the front beam, `noseRailEnd` = the front transom, sheer starts beyond the pinch zone); `build-utils.ts` (`deckPartId`); `hull-taper.test.ts` (60 tests); `scripts/hull-shapes.ts`.

Parts in the new hull: one `deck` (one sheet, all edges captured, rabbet in the chine the whole way round); no `deck-cabin`/`deck-nose`, no riser, no ledge in the rails, no `shoulder-beam`; the cabin rail is just `railDepthIn` (3") tall with its top flush with the chine bottom and the deck underside. Sides: cabin run = bent laminations (chine and gunwale 2 plies of 5/16, rail 2 x 3/8, one 6 mm web) around one plan form; the bow run (xn to the front transom) is straight members set at the bow heading (boxes rotated about z; the sheer gunwale and web are extrusions in the vertical plane of the run), scarfed to the bent run at xn, which is now in the straight (the old scarf at the end of a reverse curve was at the tangent point of a tight bend). I did not make the members continuous (stretch goal): the chine, rail and web could run as one member from rear to front because the bow run is straight, which would remove six scarfs; the gunwale and web still need the split for the sheer. Ids are unchanged (`side-cabin-*`, `side-nose-*`, `rail-nose-*`) apart from `deck`; the `scupper-cabin-front` drain is dropped (the single deck drains at both ends).

Frame: nose rails (angled, from xn to the front transom) are notched from below for `beam-F` (notch 2.6" wide x 1.97" deep, 1.03" of rail left above it, the acceptance floor is 1"), with 316 hold-down angles `front-beam-hold-down-L/R` (new parts, group frame) and dado/bolt joint records on rail, angle and beam. Nose joists straddle `beam-F` (joists at x 43.3 and 46.2) and are cut to the rail inner face. `joinery.ts`: deck rabbet joints hull-wide, scarf records at xn in the straight run, chine ties for the whole length, deck/transom dados to the single deck.

Finger guard: the sweep is `leftTirePolys` of the Ackermann spec. The gap at the defaults is still 0.75" (< 1.5"), so the guard is kept (option A); the pinch zone is only x 36.2-40.3 (the hull angles away from the tire on both sides of the pinch), so each guard is 4" long and sits on the straight bow run. The sheer rise now starts beyond that zone (x = 40.1 instead of 33.75: 11.6" long instead of 16"; `sheerLengthIn` 18 is clipped), which makes the bow lift steeper. Option B (`steeringClearanceIn = 1.5`) removes the guard (tested) but costs bend radius, R 58" to 40.5", and a 1.5" narrower pinch (19.1").

Seat: the cushion front (x = 24) has 25.9" of room inside against the 18" cushion; the old "seat cannot move forward" limit is gone. The seat can still not move forward without the curve start moving later (the grab handles must stay on the straight cabin side).

## 4. Mass (default design, hull-related parts only: deck, sides, rails, joists, front transom, guards, scuppers, hold-downs, shoulder beam)

Old hull (defaultParams): 45.71 lb. New: 48.79 lb (+3.07 lb). Deck +1.9 (one sheet runs the full bow width where the old nose was a 13.5" strip, and the full length), joists +2.1 (nose joists and the straddling pairs), nose rails +1.0, cabin rails -0.9 (3" tall, no 1" extra), shoulder beam -1.5, hold-downs +0.3, web +0.4 (one 6 mm sheet is the same mass but the curve is longer). This is the hull alone: the front-end swap (about -17 lb in spec 11) is in other workstreams.

## 5. Removed parts and aliases (new hull only)

`deck-cabin`, `deck-nose` (to `deck`; seat.ts and storage.ts joint targets use `deckPartId(L, zone)`), `shoulder-beam`, the deck riser and the rail ledge/relief, the `scupper-cabin-front` drain. Aliases until Stage 3: `L.noseTop`, `L.noseBot`, `L.xs`, `L.shoulderBeam`, `L.noseRailEnd`, `frontDeckRaiseIn` and `shoulderBeamIn` (forced to 0 by `resolveParams`).

## 6. Round-3 buildability items (`docs/reviews/phase3-build-round3.md`) that still apply

- Chine-to-rail joints on the curve that can be cut: the chine bears on the rail top along the whole length, vertical Dominos every `chineTieSpacingIn`; with R_min 58" the curve is nearly straight over a Domino, and the joint records and the Domino size choice (flat bearing face = side - deck capture) are for the hull-wide rabbet.
- Scarfs not in the bend: all at xn, tested (`curveHeading` at xn + 5" equals the bow heading).
- Bent-lam form as data: every bent member's sweep carries the plan path (>20 points), the ply count and the stock/rough size; one form serves chine, web and rail (same centerline, offsets of half the side).
- Strip rough sizes: `rough` is set on every oak sweep.
- Not changed: cut-list/BOM text outside the hull parts.

## 7. Open questions for Eric / the orchestrator

1. Bow width 13" and a pointed bow in plan: confirm the look (SVG). Narrower than about 11" does not fit the feet; 16" brings back a visible reverse.
2. Grab handles and seat 2" aft for R 66" (see section 2).
3. Sheer: the rise now starts at x = 40 (beyond the finger-guard zone) so it is 11.6" long; lower `sheerRiseIn` if the bow lift looks too steep.
4. Guard (option A, default) or 1.5" clearance with no guard but R 40" (option B): A is the default.
5. For WS-A / the flip: `frontEndType` is mine; the old steering builder still builds `nose-access-panel`, the bolster ring etc. when it is 1 (they float at the old heights: `L.noseTop` is now the deck level). `beam-F` must exist with `L.front.beam` geometry (rails are notched for it); the front hold-down angles bolt to it. The old-front-end validators (stack, bolster, swing, turntable overhang) are gated by `frontEndType !== 1`; delete them at the flip.
6. WS-D: `analysis/hull.ts` / `structure.ts` read `deck-cabin`, `side-cabin-*-web`, `rail-cabin`; for the new hull the deck is `deck`, the rail depth is `railDepthIn` only, the nose run is angled (use `L.bowHeading`), and the front beam passes through the nose rails.
7. The viewer: `ParamIssue.severity` now includes `'info'` (`ui/params-panel.ts` now shows an info glyph for it: one-line edit).
