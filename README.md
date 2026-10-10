# Troop 455 Klondike Cart

A parametric design tool for Troop 455's Klondike Derby cart: a 4-wheel, wagon-steered, white-oak "sled on wheels." One parameter file drives the 3D model, engineering checks, physics sim, cut list, BOM, CNC/laser/print exports and the assembly steps.

- **Spec:** [BRIEF.md](BRIEF.md)
- **Every assumption, with IDs:** [DECISIONS.md](DECISIONS.md)
- **Phase tracker:** [docs/STATUS.md](docs/STATUS.md); critic reviews are in [docs/reviews/](docs/reviews/)

## Run it

```bash
npm ci
npm run dev
```

Open the printed URL. Sliders on the left change the design live. **Copy link** puts the whole design in the URL hash, so a link reproduces it exactly.

## Change a parameter

All design variables live in [`src/params.ts`](src/params.ts). Each has a unit, a default, a range, a `status` (locked / verify / assumed / explore) and a `ref` to its entry in DECISIONS.md.

- **To change a default:** edit `default:` in `params.ts` and record why in DECISIONS.md.
- **To add a param:** add an entry to `defs`, and set `primary: true` if it should be a slider in the main panel. The UI generates itself from the definitions.
- **Cross-parameter rules** (things that can't physically coexist) go in `validateParams()`. They show as warnings above the parameter panel.

Nothing downstream hard-codes geometry. `src/model/` turns params into a list of `Part`s (see [`src/model/types.ts`](src/model/types.ts)), and every view reads that list.

## Build & deploy

```bash
npm test             # vitest (headless model + params checks)
npm run typecheck
npm run build        # static site → dist/
npm run build:single # one self-contained HTML → dist-single/index.html
```

Pushing to `main` deploys `dist/` to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
