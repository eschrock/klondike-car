# Phase 3, round 2 fix plan

Inputs: `docs/reviews/phase3-eng-round1.md` (6/10) and `docs/reviews/phase3-build-round1.md` (6/10). Each fix agent addresses **every must-fix** in its area, plus the should-fixes listed for it.

## Design direction (orchestrator decisions)

1. **Front end: steel carries the horizontal loads; oak only sees spread bolt-group loads.**
   - The kingpin passes through **3/16" steel plates**: a lower plate bolted to the beam and an upper plate bolted to the bolster/crossbar. Each plate has a bolt group of ≥ 4 bolts.
   - The pin bears **steel-on-steel**. Curb-strike shear goes into the oak through the bolt groups: per-bolt NDS dowel bearing, with group and row tear-out rules.
   - This replaces the single oak bore as the primary path. Keep the sleeve only if it still earns its keep.
   - Use NDS-correct values: dowel bearing (Fe for the actual bolt/sleeve diameter, wet service), cleavage/row tear-out, and edge distances.
   - Add ⅜" stainless cross-bolts flanking any bore that remains in oak.
2. **Steering stops have a compliant face.**
   - Bond ¼" 70–80A urethane to the dog faces so the two stops genuinely share load (target share ≤ 0.55, documented with stiffness numbers).
   - Add a **bounding row at share 1.0** that must not fail catastrophically (marginal is OK; if it fails, say why and fix it).
   - Feed the stop reaction into the kingpin checks.
   - Mount the dogs **outside the lazy-susan plate footprint**, or on the steel plates. Never bolt through the ball ring.
3. **Turntable:** default to **preset 2 (1500 lb)** with `frontDeckRaiseIn` 0.75, if the re-check confirms it. Verify the plate bolt pattern and the center hole, or add a mounting plate (build M12).
4. **Hull stock:** **transoms ¾"**; **chine/gunwale ⅝"** (¾" where a groove wall needs it). Use loose tenons or Dominos sized by `chooseDomino`, not "CNC blind tenons". Default the side-to-frame connection to whatever gives a real tie: the hull-girder frame, or a thicker chine screwed down onto widened rails.
5. **Weight:** take the safe cuts: the redundant storage floor (−2.0 lb), aluminum handle sockets (−1.5 lb), and 10" joists if the deck check still passes (−0.5 lb). Report the final mass honestly.

## Ownership

| Agent | Files |
|---|---|
| **F1 Front end** | `src/model/steering.ts`, `stops.ts`, `running-gear.ts` (front), `src/analysis/front.ts` and the front rows in `structure.ts` |
| **F2 Hull** | `src/model/body.ts`, `frame.ts`, `joinery.ts`, `build-utils.ts`, `profile.ts`; new analysis rows for the lift and the foot stop |
| **F3 Brake & metal** | `src/model/brake.ts`, `src/analysis/brake.ts` |
| **F4 Seat & storage** | `src/model/seat.ts`, `storage.ts`, `lighting.ts`, `src/analysis/seat.ts` |

**Shared files** (`params.ts`, `layout.ts`, `types.ts`, `model.test.ts`, `checks.test.ts`): small exact-string edits only.

## Every agent

- Put `stock` and `sourcing` on every metal part in your files (build M9).
- Use a 4× rough-length allowance in your builders (build M8).
- **Test quality** (eng finding): at least one hand-calc per new or changed check uses an independent numeric anchor, i.e. literal numbers worked by hand in the test comment, not a re-run of the code's formula.
- Put proposed DECISIONS text in `docs/phase3-r2-F#-notes.md`.
- Use US English. No state-changing git commands.
