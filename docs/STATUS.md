# Status

| Phase | State |
|---|---|
| 0 — Setup & parameter reconciliation | ✅ approved 2026-10-10 |
| 1 — Block model | ✅ approved |
| 2 — Analysis & simulation | ✅ approved 2026-10-10 |
| 3 — Detail design | **checkpoint** (docs/phase3-checkpoint.md): critics 8/8/8, 121.0 lb, safe 50–250+ lb |
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
- Honesty fixes (eng r3 MUST-1..3): stop-stand arm corrected, turntable-ring gated, front-end bounding cases. Simple view now says no rider weight passes yet (front end only). Ride mode added (BRIEF §4.3a, D-49: rider drives downhill, 10 mph, minimal steering); design study running; front-end redesign waits for it.
- Ride-mode study: 6 → 7 → 8/10. Eric: no curbs at camp (D-50, bumps not curb strikes, bend-don't-break), go with Concept A (D-51: Ackermann on racing-kart spindles, 9 ft tow radius, ±8° ride lock, rider stick + hip brake lever, front + rear brakes), and a gentle hull taper instead of the S-curve (D-52). Phase 3b spec in progress.
- Phase 3b Stage 0–2 landed: Ackermann front end, convex-taper hull, ride brakes, bump analysis (1,263 tests green, 174.1 lb, 10 rows fail at 150 lb). Eric (2026-10-11): it should be a Klondike *sled* on wheels: rider as passenger, team pulls, musher steers and brakes at the back. Keep it a crafted, reusable oak piece with storage. Research in docs/klondike-research.md; next-phase plan in docs/phase3c-plan.md. Finishing tweaks on hold (flush flag socket, lamp detail).
- Eric: keep Ashley's concept, a solid, wide, reusable wooden cart (post-race hauler), wheels required, steerable front kept, ride mode out; the seat back and cushion stow in the storage box. Plan: docs/phase3c-plan.md (3c-1 strip ride mode, 3c-2 cargo and bed, 3c-3 size and slim, 3c-4 finish).
- 3c-1 (D-53): ride mode, front brakes and lap belt removed; linkage simplified (tongue → bellcrank); basic bolted wagon brake (8.7 lb, 20 lbf hold on 15° at 150 lb); bumps at 5 mph. Empty mass 174.1 → 145.5 lb. Still no safe range: bellcrank 2.64, kingpin bracket 2.50, rear beam seat 2.29, bearing groove 1.50, kingpin bolt 1.33, tongue tie 1.32, wheel rating 1.01 at 150 lb (sizing is 3c-3). Tag cart-v3b = pre-3c.
- 3c-2: 250 lb cargo case on every row (cargo governs the front end, rear seat, axle, wheel rating, tip), seat stows in the box (seat-stow row passes; seat x 15.5", leg reach 32.5", box 2,200 in³), flat bed with seat stowed, crowned bent-lam handlebow, 6 D-rings as tie-downs. 146.3 lb. Cargo capacity 19 lb today (kingpin bolt); 3c-3 sizes to cargo. Eric: next make it narrower (~24") with sled sides (low at the bow, tall at the back) and fix the sign.
- 3c-3 landed (D-54…D-56): Ackermann front removed; center-pivot oak front axle (±20°, 5/8" kingpin, UHMW thrust washer, oak stops, steel tongue plate + shackle), narrow 24" straight-sided sled-profile body (sides 4" bow → 16" rear, curled bow), 10" wheels, steel-plate foot brake, bump model recalibrated (3 mph normal / 5 mph hard), sign generator v2 (placement pending), hardware placeholder hidden in the viewer. 134.0 lb. Still no safe rider range: king-bearing 11× (kingpin washer under roll moment), steer-stops 2.3×, tongue bending 3.7× (and lift), steer-clear 1/16", brake-clear 1/16"; cargo limited to 197 lb by the rear beam seat. Next: 3c-4 (D-57) plus these fixes.
- 3c-4 (D-57, D-58): curved sheer (4" bow → 14" rear) + bow turn-in, bow bulkhead foot brace + drop-in block, rear flag tube, flip-up latching seat back (box back to 2,000 in³, leg reach 35.5"), parked handlebow, one-board grab handles, scooter step brake (judged on slowing), sign on the rear sides; front fixes: UHMW roll pads, oak tongue, check-chain steering stops, tracks 34.5"/32", cargo 200 lb, resting-load check (holds 223 lb; 250 lb needs one more joist +0.84 lb, Eric to decide), DO NOT STEP lid. **Safe 50–220 lb, green to 200; cargo 205 lb.** 145.6 lb. 1,259 tests.
- 3c-5 (visual fixes): the side members' triangulation was the cause of the twisted, streaky sides (ear-clipped skinny fans); fixed (trapezoid decomposition, creased normals, sheer-following gunwale grain). Bow crown = handlebow crown (bulkhead 9.0 → 7.0 lb), level sign clear of the brake flap, front lamp on a printed ASA clip in the bow hand-hold, red rear lens, red/amber prism reflectors, hinge and reflector looks, chocks behind a toggle, "cart" → "sled" in all visible text, box contents (cargo: cushions + lamp + clip + chocks; race: Essentials + chocks), 8.5 in joists (+0.84 lb) and standing deflection span/160: resting capacity 223 → 358 lb, riders safe 50–250+, green 50–210. Empty mass 144.2 lb. Notes: docs/phase3c-5-notes.md.
- 3c-6 (D-60, weight package): foot block and cleats gone, Package A (hollow DOM axle tubes, steering parts, transom, flaps, sockets, bulkhead, joists, small trims) and four trade-offs (2.8 lb wheel, 4 mm ply, 1/2 in transom, smaller handle posts). Empty mass 144.4 → **120.6 lb**; safe 50–250+ lb, green to 230 lb; cargo 233 lb; resting 348 lb; nothing fails. Notes: docs/phase3c-6-weight-notes.md.
- 3c-5…3c-8: visual 7→8, weight package (144.4 → 121.0 lb), engineering 8, buildability 7→8 + last fixes (D-59…D-63). Phase 3 checkpoint written (docs/phase3-checkpoint.md). Next: Eric's sign-off, then Phase 4 build outputs.
- Post-checkpoint (2026-10-12): rear lamp clip (D-64); pull-pin removable step brake, Brakes/Lights/Chocks toggles, Transport mode, Simple-view cleanup (D-65); 30" matched tracks + gradual bow taper + slotted brake knee (D-66); straight tip limit 35° (D-67); reflectors follow the taper; CI timeouts raised. 115.5 lb; safe 50–250+, green 50–240; cargo 274 lb. Next: Phase 4.
