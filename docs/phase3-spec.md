# Phase 3 spec: detail design

BRIEF §10, Phase 3:
- Real part shapes: bent-lam prow and members with form geometry.
- Joinery: Domino sizes and locations, CNC tenons, rabbets that capture the ply.
- Steering turntable mounting and stops; brake mechanism; axle mounting.
- Seat, storage box, light mounts, removable-part attachments, signage blanks.
- Re-run the analysis on the detailed model.
- **Checkpoint:** detailed model review, updated weight and analysis.

**Starting point:** the approved Phase 2 configuration (D-27), which is the params defaults.

**Must-fix items carried from Phase 2** (`docs/phase2-recommendation.md` "What isn't resolved yet" / "Carried into Phase 3"):

| # | Item | Today | Done when |
|---|---|---|---|
| M1 | **Steering stops** | ~4× overloaded by a one-wheel curb strike; no check | Stops are redesigned (steel faces, larger radius) and a `steer-stops` check passes at goal |
| M2 | **Kingpin bearing** | Only the average bearing is checked | A peak bearing check exists (rigid pin, triangular distribution) |
| M3 | **Pitch-moment path** | The turntable isn't moment-rated; side-bearers carry roll only | A defined fore-aft bearer path, with a check |
| M4 | **Crossbar cleavage** | Side ligaments unchecked | Cleavage / end-split check |
| M5 | **Finger gap at the front tires** | 0.76" pinch gap at lock | Guard/fender, or a gap ≥ 1.5" (no-pinch), shown in the model |
| M6 | **Bridle tie points** | Not modeled | Eye bolts or through-holes at the beam ends, with a tie-load check (pull 150 lbf at the bridle angle) |
| M7 | **Bolster fasteners** | Assumed 4 × ¼" | Real joints (structured `joints`) that the check reads |
| M8 | **Front U-bolts** | Wrong orientation for an underslung beam | Legs run down around the beam; plate below |
| M9 | **Lift handles** | None | At both ends; transport lift is 58 lb per person |
| M10 | **Kingpin nut access** | The nut is buried | Removable nose deck panel (threaded inserts + screws) |
| M11 | **Sleeve and hub spec** | Not specified | Sleeve material/size and wheel hub bore recorded in `sourcing` / `notes` |

## Workstreams

Each workstream is one agent. The **file ownership** column is binding.

**Shared-file rule for `src/params.ts`, `src/model/layout.ts` and `src/model/types.ts`:**
- Edit them only with **small exact-string Edit operations**, never a whole-file rewrite, so parallel agents don't clobber each other.
- Add params under your own group, with a `ref` to a new DECISIONS ID in the D-3x range. Reserve your IDs from the table.
- Never rename or remove existing params or exports.

| WS | Scope | Owns | DECISIONS IDs |
|---|---|---|---|
| **A: Front end** | M1–M4, M6–M8, M10, M11; the steering/kingpin/turntable analysis checks they need | `src/model/steering.ts`, `src/model/running-gear.ts` (front axle mounting), `src/analysis/structure.ts` (front-end checks), new `src/analysis/front.ts` | D-31…D-34 |
| **B: Hull & joinery** | **Real shapes:** bent-lam prow (sweep geometry with ply count and form outline), captured-ply side panels in rabbeted chines/gunwales, transoms, crossmembers. **Joinery:** structured `joints` with Domino sizes and locations, dados/rabbets, inserts. M5 finger guard as a hull fender. M9 lift handles. Signage blanks. Grain and edge conditions on every part (no exposed ply edges, a checkable acceptance test). | `src/model/body.ts`, `src/model/frame.ts`, new `src/model/joinery.ts` | D-35…D-37 |
| **C: Brake & rear** | **Brake mechanism:** lever geometry and pivot, linkage, cross shaft and bearings, shoe shape and pivot. The **lever ratio is derived from the geometry**, replacing the free `brakeLeverRatio` param, which becomes a target the geometry is solved to. **Parking ratchet/detent.** **Rear push-handle sockets** (removable with pins). Analysis reads the derived ratio. | `src/model/brake.ts`, `src/analysis/brake.ts` | D-38, D-39 |
| **D: Seat, storage, fittings** | **Seat:** frame joinery, cushion, back attachment (removable, knobs + inserts). **Storage:** box with a hinged, gasketed lid; lash points; 10 Essentials fit-check (volume list). **Light mounts:** printed brackets as extrusion profiles, ready for STL. **Reflectors.** | `src/model/seat.ts`, `src/model/storage.ts`, `src/model/lighting.ts` | D-40, D-41 |
| **E: Viewer** | Render `sweep` geometry (bent-lam) properly. A **Joinery** toggle in Advanced shows Domino/insert/bolt locations from `joints[]`. Optional per-part edge highlighting for "exposed ply edge" violations. | `src/viewer/**` | — |

Workstreams A–E run in parallel. After they land:
1. Re-run the analysis, exploration candidates and simple view.
2. Run the critic loop on the detailed model: an engineering critic and a woodworking/buildability critic.
3. Checkpoint.

## Acceptance (Phase 3 checkpoint)
- **Checks:**
  - every existing check passes at the operating rider;
  - the goal rider is flagged as before;
  - **new checks** for M1, M2, M3, M4 and M6 pass, or carry an explained, owner-accepted deviation.
- **Model quality:**
  - no unintended overlaps (the existing tests and fuzz stay green);
  - the "no exposed plywood edges" test passes;
  - every wood part has a grain direction;
  - every structural joint is a structured `Joint`.
- Empty mass and lift weight are reported against Phase 2 (127 / 117 lb), with an explanation of the delta.
- **Simple view:** still correct, with the rider range recomputed.
- **Spelling:** US English throughout (see CLAUDE.md / memory).
