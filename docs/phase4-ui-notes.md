# Phase 4 UI: notes (Build tab)

Files: `src/ui/build-panel.ts` + `.css` (the tab), `src/ui/build-helpers.ts` (pure helpers, tested in `build-panel.test.ts`), `src/build/zip.ts` (store-only ZIP, CRC-32, UTF-8 names), `src/build/package.ts` (`BuildData`, `buildPackage`, `zipPackage`). Edits: `right-panel.ts` (the four placeholder tabs became one `build` tab, mounted like Analysis) and `main.ts` (mount, `setDesign` in the cache-key block, `onTab`, and the step filter in `render()`).

## Structure
- Sub-navigation (a nested tablist, arrow keys, Home/End): Verify, Cut list, Nesting, BOM, Shaper, Forms, Assembly, Finishing, Downloads. Each is a `section[role=tabpanel][aria-labelledby]`; only the active one is rendered. The last section is remembered in localStorage (try/catch), as are the verify ticks (`loadDone`/`saveDone`).
- `BuildData(parts, params, {date, link})` computes each output on first use and records `timings`. `buildPackage` forces all of them and returns `files` (`shaper/*.svg`, `forms/*.svg`, `forms/tiled/<id>-<A1..>.svg`, `stl/*.stl`, `cutlist.csv` (the four tables under `# title` lines), `bom.csv`, `README.txt` (date, params hash, link, conventions, file list)).
- Previews are inline SVG (`previewSvg`: root width 100%, height and in-units dropped, clipped to the viewBox); they sit on white so black Shaper cuts read in dark mode. The nesting drawing (`sheetSvg`) uses the true outlines.
- Print: `@page { size: letter; margin: 0 }`; section print hides everything but the active section (details are opened on `beforeprint`); Assembly prints every step (`break-inside: avoid`, so a step never splits across pages). "Print tiled (Letter)" puts the tile SVGs (8.5in x 11in, viewBox 0 0 8.5 11) in `#bp-print-tiles` on `body`, adds `body.bp-print-tiles` (hides `#app`), calls `print()`, and cleans up on `afterprint`.

## Step-through (Assembly section)
The panel emits a `StepFocus {n, visibleIds, highlightIds, view, reframe}` through `onStep`; `null` when leaving the section or tab. `main.ts` stores it and `render()` calls `viewer.update(parts filtered to visibleIds)`, `viewer.highlight(highlightIds, '#ff9f0a')`, and, once per new step (`reframe`), `viewer.setView(viewerView(view))`. A parameter change keeps the step number (`clampStep`), re-emits without reframing. A prep step with nothing installed yet (steps 0 to 3) shows the whole model, no highlight, with a caption. Entering a step clears any truck placement.

## Performance (defaults, browser pane, warm)
Full package 45 to 50 ms (vitest: 47 ms). By stage: verify 1, cut list 6, nesting 1, oak 1, BOM 4, steps 7, finishing 1, Shaper 10, forms 15, tiles 1, STLs 1 ms. DOM render per section 0 to 63 ms (Assembly is the heaviest, 41 kB of text because of the print list). Debounce 250 ms after a parameter change, only while the tab is open; the whole `BuildData` is cached per parameter set (JSON key). The zip is about 1.1 MB (73 files, about 52 of them tile pages), built on click.

## Known gaps
- The viewer has no `under` camera (the running-gear steps ask for it, hull inverted): it falls back to `iso` (`viewerView`). Adding `under` to `VIEW_DIRS` in `viewer.ts` would fix it.
- The step-through filters the parts main builds for the viewer by id; with Transport mode or hidden removables on, hidden parts stay hidden.
- Tile counts are large (the side-form sheet is 27 Letter pages; 73 files in the zip). Only the print dialog was not exercised: `window.print()` was stubbed to check the DOM, the page rule and the 8.5in x 11in tiles.
- Pre-existing: `.sim-panel { display:flex }` beats `hidden` on the Simulation tab panel, so it showed under other tabs; `build-panel.css` carries a one-line `.tabpanels > [hidden]` guard.
- Nothing links Simple view to the Build tab (optional item skipped).
