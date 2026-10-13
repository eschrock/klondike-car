# Troop 455 Klondike Sled

A parametric design tool for Troop 455's Klondike Derby sled: a pulled, four-wheel, white-oak "sled on wheels" with a passenger seat. One parameter file drives the 3D model, engineering checks, physics sim, cut list, BOM, Shaper Origin and print exports, and the assembly steps.

- **The design:** [DESIGN.md](DESIGN.md) (requirements, construction, key numbers, how the app is organized, build outputs)
- **Decisions that hold, with IDs:** [DECISIONS.md](DECISIONS.md)
- **Status and open items:** [docs/STATUS.md](docs/STATUS.md)
- **Reference data:** [price research](docs/price-research/) behind the BOM, and the [side stiffness study](docs/studies/side-stiffness-study.md) behind D-76

## Run it

```bash
npm ci
npm run dev
```

Open the printed URL. Sliders on the left change the design live. **Copy link** puts the whole design in the URL hash, so a link reproduces it exactly. The app opens in Simple view ("is it safe, and for what rider weights?"); Advanced has the sliders and the full analysis; Build has the cut list, BOM, Shaper files, drawings and assembly steps.

## Change a parameter

All design variables live in [`src/params.ts`](src/params.ts). Each has a unit, a default, a range, a `status` (locked / verify / assumed / explore) and a `ref` to its entry in DECISIONS (a few still cite a retired ID; the Retired table in DECISIONS says what replaced it).

- **To change a default:** edit `default:` in `params.ts` and update the decision it cites in DECISIONS.md.
- **To add a param:** add an entry to `defs`, and set `primary: true` if it should be a slider in the main panel. The UI generates itself from the definitions.
- **Cross-parameter rules** (things that can't physically coexist) go in `validateParams()`. They show as warnings above the parameter panel.

Nothing downstream hard-codes geometry. `src/model/` turns params into a list of `Part`s (see [`src/model/types.ts`](src/model/types.ts)), and every view reads that list.

## Build & deploy

```bash
node scripts/run-ts.mjs path/to/script.ts   # run a TS script against the model headless (how the numbers in DESIGN.md are derived)
npm test             # vitest (headless model, analysis and build-output checks)
npm run typecheck
npm run build        # static site → dist/
npm run build:single # one self-contained HTML → dist-single/index.html
```

Pushing to `main` runs the tests and deploys `dist/` to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
