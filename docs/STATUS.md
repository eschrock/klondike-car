# Status

| Phase | State |
|---|---|
| 0 — Setup & parameter reconciliation | ✅ approved 2026-10-10 |
| 1 — Block model | ✅ approved |
| 2 — Analysis & simulation | ✅ checkpoint — awaiting Eric |
| 3 — Detail design | not started |
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
