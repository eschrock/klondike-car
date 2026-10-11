# Klondike cart — agent notes

Parametric design app for Troop 455's Klondike Derby cart. **BRIEF.md** is the spec; **DECISIONS.md** records every assumption, using IDs like D-6 and A-1. Cite those IDs in code comments and the UI rather than repeating the reasoning.

## Architecture rules
- `src/params.ts` is the only home for design numbers. Model code may hold *derived* geometry, never literal design dimensions. If a number matters, it becomes a param (with `status` and a `note`).
- `src/model/**` and `src/analysis/**` are plain TS with **no three.js imports**, so they run headless under vitest. Geometry is plain data (`src/model/types.ts`).
- Model frame: +X forward, +Y left, +Z up; origin on the ground under the rear-axle center. Inches, pounds, degrees.
- Every downstream view (viewer, analysis, sim, cut list, BOM, exports, assembly) consumes `buildModel(params): Part[]`.

## Workflow
- Phased plan with checkpoints (BRIEF §10). Stop at each checkpoint and summarize for Eric.
- Use cheaper subagents (Sonnet/Haiku) for mechanical work. Any optimization or verification gets a **critic agent** that grades it 1–10 with concrete fixes. Iterate until ≥ 8 or 3 rounds, and record the reviews in `docs/reviews/`.
- Phase status and scratch notes live in `docs/` (`docs/STATUS.md` is the current-phase tracker).
- Rider loads: 150 lb must pass everything; 200 lb is the goal (DECISIONS D-1).
- **Parallel agents must never run `git stash`, `checkout`, `reset` or `commit`.** Other agents share the working tree. Only the orchestrating session commits.
- **US English** spelling everywhere (tire, center, color, -ize). Leave fixed API names such as `aria-labelledby` alone.
- Parallel agents edit shared files (`src/params.ts`, `src/model/layout.ts`, `src/model/types.ts`) only with small exact-string edits, never whole-file rewrites.
- Commit at milestones. Always commit `package-lock.json` changes.

## Commands
```
npm run dev          # local dev server
npm test             # vitest
npm run typecheck
npm run build        # static site → dist/ (GitHub Pages via .github/workflows/pages.yml)
npm run build:single # one self-contained HTML → dist-single/index.html
```
