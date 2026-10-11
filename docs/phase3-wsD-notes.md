# Phase 3 workstream D: seat, storage, fittings (notes for the orchestrator)

Files: `src/model/seat.ts`, `storage.ts`, `lighting.ts`, new `profile.ts` (extrusion helper), new `src/analysis/seat.ts`, tests `src/model/fittings.test.ts` and `src/analysis/seat.test.ts`. Shared-file edits (all additive, exact-string): `src/params.ts` (9 params), `src/model/model.test.ts` (2 ALLOW lines, the seat/storage group masses and a comment).

## Wiring `seatChecks`

In `src/analysis/index.ts`:

```ts
import { seatChecks } from './seat';
// in runChecks, after tongueCheck(ctx):
    ...seatChecks(ctx),
```

and in `src/analysis/types.ts` `GROUP_OF_ID` add `'seat-back': 'Structure', 'seat-grip': 'Structure', 'storage-pack': 'Structure', 'storage-lid-open': 'Structure', 'lash-points': 'Structure'`.
Rows returned: `seat-back` and `seat-grip` are dual (operating + goal) rows, the other three are single-case rows.

## Open items for other workstreams

- Body `grab-L/R` (body.ts) are 1" blocks sitting on the gunwale, which cannot be gripped. Workstream D adds real handles (`seat-grip-*`: pad, two posts, bar, 1.5" finger gap, 4.5" clear). B should delete `grab-L/R` (or keep them as lift handles).
- The cabin gunwale is only ½" wide. The grip pads and lash plates overhang it and screw down into it. B should consider a local doubler or a wider gunwale.
- The rear transom is ½" thick. The rear-light plate uses #8 × 3/8" screws and the latches use #8 × 3/8" screws into it.
- The prow has no socket yet, so the lantern bracket and the flag-pole socket clip onto the front transom, either side of the prow base (|y| = 4.5"). If B adds a prow socket, delete `flag-mount` / `flag-socket`.
- Hand-calculated tests in `src/analysis/checks.test.ts` (H2 roll path, M3 rails, M4 turntable, M5 axle, H3 pitch-rear, L2 brake) shift with total mass and CG. Workstream D adds +5.2 lb empty (seat +2.3, storage +1.8, lash points +0.6, lighting +0.5); the rest comes from the other workstreams. Re-derive those numbers once after all workstreams land.
- `model.test.ts` "masses" group table: I set `seat: 8.2, storage: 9.9`; `brake` is workstream C's.

## Proposed DECISIONS entries

| ID | Decision | Status |
|---|---|---|
| D-40 | **Seat detail** (Phase 3). **Back:** oak stiles (1.5" × ¾") and rails joined by one 6×40 Domino per joint, with a ply panel captured in ⅜" grooves (cut size includes the tongues). It **comes off with no tools** (D-9): one 3/8-16 stainless stud with a star knob per stile, at 1.8" above the stile foot, threads into a stainless insert in an oak backer cleat inside the storage box end (the box sits behind the back). Between the leaning back and the box end sits an oak **wedge** that the stile bears on (a vertical-faced post when the box is elsewhere). **Cushion and pad:** 2" closed-cell foam with marine-vinyl covers (purchased, drain grommets, Dual Lock on the deck). **Side grab handles:** oak pad on each gunwale, two posts, a bar; 1.5" finger gap under the bar, 4.5" clear between the posts (no pinch point, BRIEF §4.7). **Load model (`seat-back` check):** rider × dynamic factor (3) × torso share (0.5) aft over the back height, shared by two stiles; the stile bears on the wedge crest and the stud resists the overturning couple. At the goal rider: stile bending 4.7 ksi (≤ 6.5), crest bearing 264 psi (≤ 358), insert pull-out 246 lbf (≤ 400), ply panel 1.0 ksi (≤ 2.1). **Assumption to verify:** the 3/8-16 stainless insert in white oak pulls out at ≈ 1,200 lbf (400 allowable at SF 3); torso share 0.5 is a judgement (legs brace on the foot stop, pelvis on the cushion). | 🔶 |
| D-41 | **Storage and fittings detail** (Phase 3). **Box:** ply floor between mitered walls that stand on the deck (no exposed ply edge), oak lid frame capturing the ply lid panel, two oak battens under the lid, EPDM bulb gasket between the wall tops and the frame, two stainless butt hinges on the **fore** edge (so the lid opens up and aft; the leaning seat back stops it at ~75°, and with the back off it opens to 100°+ on a stay), two draw latches at the aft edge, two ⅜" drains at the aft corners through floor and deck. The 10 Essentials list (D-19) is packed into the real interior (rigid items in levels, soft goods compressed to 80%): fill 0.96 of 1,762 in³, **fits with little margin**; raise `storageVolumeIn3` ~10% for headroom. **Lash points:** six stainless D-rings on the cabin gunwales (3 per side, `lashPointsPerSide`), 300 lbf working load each (BRIEF §4.9). **Lights:** printed ASA brackets as 2D profiles + depth (`extrusion`, ready for STL): a front lantern clip carrying an LED headlight, a flag-pole clip + socket (until the prow has one), a flat rear-light plate; all clip-on or screw-on, not load paths; mass = volume × 66.8 lb/ft³ × 60% fill. Side reflectors are stick-on DOT-C2 class. | 🔶 |

## Numbers at the defaults

- Packing: 8 of 8 rigid items placed (805 in³ bounding), 1,000 in³ of soft goods compressed to 800 in³; interior 1,762 in³ against the 1,800 in³ target (the layout formula ignores the lid frame and the gasket).
- Seat-back check (goal rider): Q = 300 lbf, 9.4 lbf/in per stile, R_A = 396 lbf, stud pull 246 lbf per stile, utilization 0.74 (bearing governs). Operating rider is lower.
- Lid opening with the back fitted: 75°.
- Lash points: 6.
