# Klondike sled: agent notes

Parametric design app for Troop 455's Klondike Derby sled (a pulled sled on wheels). Start with **DESIGN.md** (the current design, requirements, key numbers, app layout). **DECISIONS.md** lists the decisions that hold, with IDs like D-57 and A-2; cite those IDs in code comments and the UI rather than repeating the reasoning. **docs/STATUS.md** is the current status and the open items list. Git history keeps everything older.

## Architecture rules
- `src/params.ts` is the only home for design numbers. Model code may hold *derived* geometry, never literal design dimensions. If a number matters, it becomes a param (with `status` and a `note`).
- `src/model/**` and `src/analysis/**` are plain TS with **no three.js imports**, so they run headless under vitest. Geometry is plain data (`src/model/types.ts`).
- Model frame: +X forward, +Y left, +Z up; origin on the ground under the rear-axle center. Inches, pounds, degrees.
- Every downstream view (viewer, analysis, sim, cut list, BOM, exports, assembly) consumes `buildModel(params): Part[]`.
- **No-fabrication rule for metal:** bought ready-made, or stock cut on a metal bandsaw and drilled. No welding, bending, tapping, machining or countersinking (D-77; `src/model/no-fab.ts` checks it).

## Workflow
- Stop at milestones and summarize for Eric. Commit at milestones. Always commit `package-lock.json` changes.
- Use cheaper subagents (Sonnet/Haiku) for mechanical work, in parallel only when their files do not overlap. **Parallel agents must never run `git stash`, `checkout`, `reset` or `commit`.** Other agents share the working tree; only the orchestrating session commits. Parallel agents edit shared files (`src/params.ts`, `src/model/layout.ts`, `src/model/types.ts`) only with small exact-string edits, never whole-file rewrites.
- Any optimization or verification gets a **critic agent** that grades it 1–10 with concrete fixes. Iterate until ≥ 8 or 3 rounds, whichever comes first, and report the final grade and what remains. Reviews are not kept in the repo; summarize them in the commit message or the hand-off.
- **Doc management.** The repo holds only current-state docs, and each fact lives in one place:
  - `DESIGN.md`: the sled as it is now (requirements, construction, key numbers, app layout, build outputs).
  - `DECISIONS.md`: only decisions that hold, each with a one-line why and no history story. When one is superseded, edit or remove its row and add the old ID to the Retired table.
  - `docs/STATUS.md`: a short current status plus the open items.
  - `docs/studies/` and `docs/price-research/`: reference data that still backs a decision or the BOM.
  - Update these in the same commit as the change that makes them wrong. Derive numbers from the code (`buildModel`, `runChecks`, `bom`), not from older docs.
- **Temporary docs** (a plan, spec, workstream or round notes, a review, scratch analysis) are allowed only while multi-commit or multi-phase work is in flight.
  - Put them under `docs/wip/<topic>/` and list them in `docs/STATUS.md` under "Work in flight" with the commit or phase that retires them.
  - Keep them out of code comments: cite a D-ID or `DESIGN.md`, never a wip file.
  - **In the commit that finishes the last phase, fold what still holds into `DESIGN.md` and `DECISIONS.md`, then delete the wip docs and the STATUS entry.** Git history keeps them. Reviews and per-round screenshots are never kept; summarize the grade in the commit message.
  - Before ending a milestone, check `docs/` for anything left over.
- **Eric is weight-sensitive and cost-sensitive.** Never add mass just to pass a check: show the lightest option first. Show the cheapest credible option first, separate quoted prices from estimates, and question over-specified hardware before adding cost. Do not cut what is structural or safety-relevant (stainless in wet oak, rated eye bolts) without showing the trade-off.
- **Use case.** A pulled Klondike sled on wheels with a passenger rider, garage-kept and used a few times a year; not a ridden cart. Before a major design change, restate the use case and sketch the shape for Eric's OK.
- Rider loads: 150 lb must pass everything; 200 lb is the goal (D-1).
- **US English** spelling everywhere (tire, center, color, -ize). Leave fixed API names such as `aria-labelledby` alone.
- **Build-instructions style** (anything the shop reads): fractions, not long decimals, rough sizes rounded up to 1/8"; no internal names (param or file names, D-IDs) in running text; the cut list shows the actual cuts (a glued panel is its boards, then the glue-up); generous mill allowance on laminated parts; every notch, hole and mortise has a measured location and depth from a named edge; forms say what to build; short steps with sub-bullets; a part named in a step links to its size, drawing and place in the 3D model; respect the shop (the bandsaw resaws 6" at most). Run a human-readability critic as well as the engineering and buildability critics.

## Commands
```
npm run dev          # local dev server
npm test             # vitest (what CI and the deploy run; a quick sample of the randomized sweeps)
npm run test:full    # the randomized sweeps at full depth, to hunt for bugs
npm run typecheck
npm run build        # static site → dist/ (GitHub Pages via .github/workflows/pages.yml)
npm run build:single # one self-contained HTML → dist-single/index.html
```
