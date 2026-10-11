# Handoff: resume Phase 3 (written 2026-10-11)

Paste the prompt below into a fresh Claude Code session started in this repo.

---

You are picking up an in-progress project: a parametric design app for Troop 455's Klondike Derby cart, at /Users/eschrock/dev/klondike-car. It is deployed via GitHub Pages at https://eschrock.github.io/klondike-car/ on every push to `main`, which runs the tests first.

**Read first:**
- `CLAUDE.md` for conventions and workflow rules.
- `BRIEF.md` for the spec.
- `docs/STATUS.md` for the phase tracker and log.
- `DECISIONS.md`, especially D-21…D-43.
- `docs/phase3-spec.md`, `docs/phase3-round2-plan.md`, and the round-2 notes `docs/phase3-r2-F{1,2,3,4}-notes.md`.
- The latest critic reviews in `docs/reviews/`: `phase3-eng-round1.md`, `phase3-build-round1.md`, `simple-view-ux-round2.md`.

**Working style (the owner, Eric, insists on these):**
- Use cost-efficient subagents (Sonnet) for implementation, in parallel where file ownership allows.
- For anything optimized or verified, run a **critic agent** that grades 1–10 with concrete fixes. Iterate until ≥ 8 or 3 rounds, and save reviews in `docs/reviews/`.
- Commit at milestones.
- Stop at each phase checkpoint and summarize for Eric.
- Use US English.
- Parallel agents never run state-changing git commands, and edit shared files (`params.ts`, `layout.ts`, `types.ts`, the big test files) only with small exact-string edits.
- Rider loads: 150 lb must pass; 200 lb is the goal (flagged); 80 lb is the lightest rider for rear pitch.

**Where things stand:**
- Phases 0–2 are approved.
- Phase 3 (detail design) has finished round 1 (engineering 6/10, buildability 6/10) and round 2 fixes (F1–F4). Everything is committed, and all 918 tests pass.
- Empty mass is **≈ 160.6 lb** (127 at Phase 2).
- The Simple view says safe to **200 lb** (green to 160). The limiter is `kingpin-bolts` (0.98): the steering-stop torque on the plate bolts.

**Next steps, in order:**

1. **Visual fidelity pass.** Eric's feedback: "I see none of the finishing: no fine design, textures, curved wood, anything that makes it look like an actual cart. It's still basically the block version." This is a gap; do it before the critic round, since it changes geometry.
   - Run one design-minded agent for model geometry and one for rendering, with clear file ownership. Use `reference/02-concept-overview-transport.png` and `03-concept-callouts.png` as the look to aim for: boat-like, warm oak, curved prow, sheer line.
   - **Geometry** (`src/model/body.ts`, `frame.ts`, `seat.ts`, `steering.ts` …):
     - a curved sheer line on the gunwales (rising toward the bow), possibly with some flare;
     - shaped transoms (crowned top, rounded corners);
     - rounded or chamfered edges on exposed oak, as a param (e.g. ¼" roundover);
     - a curved seat back and real cushion shapes;
     - shaped grab handles and a curved push-handle crossbar;
     - tire tread and hub detail.
     Keep the analysis valid: section properties must still come from the same params and layout, overlap and edge tests stay green, and the mass changes are reported.
   - **Rendering** (`src/viewer/**`):
     - procedural wood-grain textures (canvas or shader) oriented by each part's `grain` axis, separately for oak and okoume;
     - PBR materials plus an environment map (e.g. three's RoomEnvironment) for soft lighting;
     - better shadows and ambient occlusion where cheap;
     - subtle edge lines;
     - dark-mode-aware backgrounds;
     - keep the 3D redraw under ~30 ms.
   - Then a UX/visual critic over screenshots (light and dark, desktop and phone).
2. **Phase 3 critic round 2.** Run the engineering and buildability critics on the round-2 model. Fix their must-fixes (round 3 at most), each as a fresh agent run.
3. **Phase 3 checkpoint for Eric.** Present:
   - **Weight:** 160 lb vs the 60–70 lb target; heavy-first was approved (D-21), but itemize it and offer reductions.
   - **The front-end tradeoff:** the steel plate kingpin design added +8.9 lb and the rider range fell to 200 lb. Offer alternatives, e.g. a longer stop radius, or commercial wagon/fifth-wheel steering hardware.
   - **Sign-offs:** stop load share via the urethane pads (D-31/D-43), the brake grip travel of 6.4" (needs a feel test), and the turntable choice.
   - Updated screenshots, and confirmation that the Simple view is still correct.
   - Consolidate D-43 into proper DECISIONS entries.
4. **Phase 4: build outputs** (BRIEF §10):
   - cut list and nesting;
   - BOM with costs;
   - DXFs and STLs;
   - bent-lam form drawings (strip list for the prow);
   - assembly steps (the data in part `step`/`notes`);
   - finishing schedule;
   - a single-file HTML build.

**Deferred (do not start unless asked):**
- The lightweight-variant preset (D-21).
- Scenario A vs B comparison in the Simple view (D-30).

**Useful commands:**
- `npm test`, `npm run typecheck`, `npm run build`, `npm run build:single`
- `node scripts/run-ts.mjs scripts/recommend-table.ts` (check table for the recommended config)
- `node scripts/run-ts.mjs scripts/explore.ts` (`EXPLORE_SMOKE=1` for a fast run)
- The dev server runs from `.claude/launch.json` ("klondike-dev", port 5179). Check UI changes in the browser pane at 1440×900 and the 375×812 mobile preset, in light and dark.
