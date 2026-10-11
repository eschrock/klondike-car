# Status

| Phase | State |
|---|---|
| 0 — Setup & parameter reconciliation | ✅ approved 2026-10-10 |
| 1 — Block model | ✅ approved |
| 2 — Analysis & simulation | ✅ approved 2026-10-10 |
| 3 — Detail design | **checkpoint**: waiting on Eric (docs/phase3-checkpoint.md) |
| 4 — Build outputs | not started |

## Phase 0 log
- 2026-10-10: params.ts, Part schema and DECISIONS.md drafted. App shell scaffolded by a subagent and checked in the browser.
- Critic round 1: 7/10. Fixed: deck/stack/nose params, validateParams, schema gaps, line-item weight budget, steer moved to view state.
- Critic round 2: 8/10. Fixed: hand calcs at real cart mass (brake ratio 10:1), A-4 swing clearance enforced, track 35.5", finish by area.
- Critic round 3: 9/10. Low-severity doc nits fixed. Remaining risk: rear-brake traction margin parked nose-down (Phase 2 driver).
- Checkpoint approved. Eric's decisions: heavy design first (D-21), captured ply sides OK (D-22), bed fully parametric with both stowage modes (D-23), parking on a hill is info only (D-24), A-1 accepted.

## Phase 1 log
- Block model (src/model), truck fit (src/truck) and viewer features built by two parallel subagents.
- Critic round 1: 7/10. Fixes: kingpin lead (D-25), frame-style seat/bolster/storage (137 → 119 lb), 32-variant overlap tests, true fore-aft truck-fit logic, CG/dimension overlays, layout.
- Critic round 2: 7/10. Fixes: steering stops land at exactly ±lock, front-beam ligaments, boot allowance (lock 38.5°, nose 13.5", D-26), fuzz test, validator-aware fit windows, mass table.
- Critic round 3: 8/10. Must-fix items done: SSF preview at the bed-only max track, screenshots, doc numbers. Carried into Phase 2/3: stop posts on the lower turntable plate, pitch path, rod-to-kingpin web rule, U-bolt orientation, tongue joint, fuzz residue.

## Phase 2 log
- Spec (docs/phase2-spec.md). Analysis checks, Rapier sim and auto-nose geometry were built by parallel agents.
- Analysis critic r1: 7/10. Added obstacle strike, roll path, 80 lb rider, tire-edge turning radius, effective-width deck, C_M ⊥ 0.67, lateral axle load.
- Exploration: about 45k designs (docs/phase2-exploration.md). Then kingpin through a crossbar with sleeves.
- Recommendation (docs/phase2-recommendation.md, D-27). Checkpoint critic r2 7/10 → r3 8/10; wording fixes done.

## Simple view (D-30)
- Built, then the UX critic gave r1 6/10. Fixes landed: phone layout, scroll capture, two-tier headline, plain-English copy, contrast. UX r2 is pending.

## Phase 3 log
- Spec (docs/phase3-spec.md) lists must-fixes M1–M11 and workstreams A–E, built by parallel agents. Notes are in docs/phase3-ws*-notes.md; decisions D-31…D-41 are merged into DECISIONS.md.
- Merged model: 796 tests green. Empty mass 126.9 → 144.7 lb. The brake mechanism is +8.8 lb (the ¾" solid shaft alone is 4.9 lb).
- Next: integration loose ends (agent), then engineering + buildability critics, UX r2, then the checkpoint.
- Round 1 critics: engineering 6/10, buildability 6/10. Round 2 fixes F1–F4 landed (D-43). Empty mass ≈ 160.6 lb; Simple view safe to 200 lb (limiter kingpin-bolts 0.98). 918 tests green.
- Paused at Eric's request. Resume plan, starting with a visual fidelity pass, is in docs/HANDOFF.md.
- 2026-10-11 resumed. Visual fidelity pass: `Part.finish` contract + `roundoverIn` param (D-44); geometry agent (sheer, transoms, seat back, finish tags) and rendering agent (grain, PBR, env light, tread, roundovers) in parallel.
- Visual pass: critic 5 → 7 → **8/10** (docs/reviews/visual-round{1,2,3}.md). Empty mass 161.6 lb (+1.0, sheer and transoms). Ropes hidden in the viewer per Eric. Deferred to Eric: broader prow section, steel U-tube grab handles (D-40). Brake grip force at the goal rider now marginal (90.3%).
- Critic round 2: engineering 7/10, buildability 6/10. D-45 (Eric): prow dropped, one-piece S-curve hull, deck step hidden in the side profile; also fixes build MUST 1–2 and eng N-4. D-46: front end N-1..N-3 (adjustable stops, welded shear ears, carrier bolts from below); safe range 220 lb on paper, quoted as about 200 (fragile, see docs/phase3-r3-front-notes.md). Empty mass 161.2 lb. Next: build MUST 3–4 (brake mount, rear axle beam) and SHOULDs, viewer follow-up for plan-path sweeps, then critic round 3.
- Round-3 fixes: D-47 (front and fittings: turntable support, bridle tie, curved finger guard, real kingpin bolt, step order, storage clearance, lash plates, banding) and D-48 (brake mount on bearing plates + doublers, rear beam seat and hold-downs, brake headroom 1.2 with 5.7" travel, 7/8" shaft, wheel rating, brake abuse). Viewer follow-up for the curved hull. Empty mass **169.0 lb**; safe 50–210 lb, green to 170 (limiter steer-stops). Open: `turntable-ring` info row at 137% of the assumed rating. Next: critic round 3.
- Critic round 3 (final): engineering 7/10, buildability 6/10. Stopped at the round limit; checkpoint written (docs/phase3-checkpoint.md). Two eng MUSTs mean the Simple view overstates safety (stop-stand arm, turntable-ring info-only): fix before pushing.
