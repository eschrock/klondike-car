# Build mode (top level), visual and UX review, round 1

Reviewer: visual/UX critic. Method: live app at localhost:5179 in the Browser pane at 1440×900 and 1920×1080 (dark and light), 1024×768 and 390×844. I went through all nine sections, stepped Assembly with Next and the step list (including step 15, an inverted-hull `under` step), switched Simple/Advanced/Build and used Back. I read `build-panel.css` (print rules included) and `style.css`. Another agent's edits reloaded the page three times during the review. Build and the section survived each reload, but the step was lost each time. Screenshots are in `docs/screenshots/build-mode/`. No console errors.

## Grade: 7 / 10

The move to a top-level mode works. At 1440 and up, the rail plus content layout is calm and roomy. Tables have real columns with tabular, right-aligned numbers. The BOM total card with subtotal chips is easy to scan, and nesting sheets and forms are big enough to read. Assembly is the best part: a 770×855 viewer beside the steps, Prev/Next pinned at the top, and parts highlighted in the inverted hull. Four things keep it below 8. Next/Prev drops you mid-step. Leaving Build leaks the step camera into Simple and Advanced. At 1024 the space is wasted on chrome. On a phone you can't see the dimensions that matter.

## MUST

1. **Next/Prev must show the new step from its top.** At 1440, after scrolling 700 px into a step, Next left the new title at y = −213. On a phone it sat at −565, hidden under the pinned viewer. Fix in `build-panel.ts` (stepnav click handler): after rendering, scroll `#build-main` (wide) or `window` (narrow) so `.bp-step-detail` is at the top. Use `scroll-margin-top: calc(var(--stick-top,0px) + min(42vh,360px) + 52px)` under 900 px, and 52 px otherwise.
2. **Leaving Build must restore the mode's camera.** After step 15 (`view: 'under'`) I clicked Advanced: the full sled came back, but upside-down from below (`1440-advanced-after-build-under-camera.jpg`). Simple showed the Top view after step 2 in the same way. Fix in `main.ts` `setMode`: when leaving Build (alongside the `stepFocus` null), reset the viewer to Iso / the mode default (`viewer.setView('iso')` and reframe).
3. **Step numbers disagree.** The counter reads "Step 1 of 30" while the title reads "0. Verify before ordering", and step 15 shows "Step 16 of 30". The cut list STEP column and the build book use the 0-based title number, so "step 11" in the cut list is "Step 12" in the nav. Fix in `build-panel.ts` (`.bp-stepnav .muted`): show the step's own number, e.g. "Step 11 · 12 of 30", or renumber everything 1-based in `src/build/assembly.ts`.
4. **The viewer toolbar eats the Assembly viewer.** In Build it shows Dimensions, Outline edges, Shop aids, Joinery, CG, Section and 10 layer checkboxes. That is 147 px (5 rows) of a 476 px wide viewer at 1024, and 126 of the 354 px pinned on a phone, which leaves a 228 px canvas. Fix: in Build, put everything except Iso/Top/Side/Front and Explode behind the existing `.viewer-more` "More" sheet at every width, e.g. `#app[data-mode='build'] .viewer-toggles, … { display:none }` unless `.viewer-more.open`. Layer toggles fight the step-through anyway.
5. **Cut list and BOM must fit at 1024.** The cut list scrolls 816–879 px inside 743 px, so Fabrication and Step are cut off with no cue. "along L" wraps to two lines, and part names wrap (`1024-light-cutlist-overflow.jpg`). Fix in `build-panel.css` under `@media (max-width:1279px)`: rail to 168 px (or numbers only), `#build-main` padding to 18 px, `.bp-cuts td:nth-child(5)` nowrap, `.bp-cuts td:first-child` min-width to 11em. Add a right-edge scroll shadow on `.bp-scroll` when it overflows.
6. **On phones the size you cut to is cut off.** At 390 the cut list shows Part, Qty and half of "1/2 × 16-3/8 × 2…". The BOM hides Extended. Fix: below 600 px, lay out `.bp-cuts`/`.bp-bom` rows as blocks. The `tr` becomes a card, the name line takes Qty on its right, Final T×W×L goes on its own line at 15 px bold, and Rough/Grain/Fab/Step go on one muted line (use `td::before { content: attr(data-label) }`). The BOM card ends with Extended right-aligned.
7. **Landmarks.** In every Build section except Assembly, the page has no `main`: `<main id="viewer">` is `display:none`. `#build-main` is a `div` with an `aria-label` and no role, which screen readers ignore. Fix in `index.html`/`main.ts`: give `#build-main` `role="region"` (or swap the `main` role onto it while in Build). The rail is already a `nav`, which is good.

## SHOULD

1. **Remember the step** (`localStorage`, keyed by params rev or step id). The other agent's three reloads each dropped me back to step 1. In the shop, a phone that sleeps does the same.
2. **Step list access:** "All 30 steps" sits below a 968 px step card (top at y ≈ 1242 at 1440). Add a `<select>` jump or a "Steps ▾" popover in `.bp-stepnav`. Add ←/→ keys for Prev/Next when focus is not in a field.
3. **"Check before moving on" items are drawn boxes** (`.bp-box` spans), not inputs. Make them real checkboxes persisted like Verify, or label them "for the printout".
4. **Sticky table headers.** The 4/4 cut list has 37 rows and the BOM is 7300 px with 112 rows. `.bp-scroll`'s `overflow-x:auto` blocks `position:sticky` on `thead th`. On ≥ 900 px, use `overflow-x: clip`/`visible` and `thead th { position: sticky; top: 0 }`. Also make the BOM subtotal chips anchor links to their tables.
5. **Cap table width at 1920.** The cut list stretches to 1600 px, so QTY, Final and Rough sit 130–200 px apart and the eye loses the row. Use `.bp-cuts, .bp-files { max-width: 1150px }`, and narrow Downloads too: its file name and Save are 1000 px apart.
6. **Off-grid dimensions** like `21.142`, `15.796`, `0.657` and `7.15` appear about 100 times in the cut list. A tape cannot read them. Show the nearest 1/32 with the decimal after it: `21-5/32 (21.142)` (`src/build/cutlist.ts:564`). The note "sixteenths as fractions" undersells this.
7. **Shaper cards:** add the stock row (e.g. "12 mm okoume", "4/4 oak"), because Size has no thickness. Let a click on the preview open the SVG full-size. Many previews are mostly white strips (deck, side-web); `preserveAspectRatio` plus a 16:9 box for long parts would help.
8. **Finishing:** the schedule is sequential but laid out as a 2-column grid of uneven cards that read 1,2 / 3,4. Use one column of `max-width: 80ch`. Right-align BUY. "Recoat: - Cure: -" placeholders should be omitted.
9. **Light-mode warning contrast:** `.bp-warn summary` `#b26a00` on `--bg #f4f5f7` is about 3.9:1 at 13 px. Use `#8a5200` (already used by `.bp-deep`).
10. **Nesting:** the oak board-feet table (the shopping list) is below two 566 px sheets. Move it first, or link to it from the top of the section.

## NIT

- Verify uses CSS columns, so "Before cutting" sits 12 px higher than "Before ordering". Numbering is out of sequence within a group (1–5, 7, 10 / 6, 8, 9, 11, 12). Use a 2-column grid and renumber within groups.
- Step 0 shows a source file name to the woodworker ("checklist (verify.ts)").
- Nesting labels use ids (`side-web`, `sign`). The offcut label "36 × 48" disagrees with the "35.8 × 47.5" caption. "2 x 4/4" uses `x` while the cut list uses `×`.
- The cut list has lowercase "rear axle beam", and its 4/4 count (37) differs from the board-feet table (39) with no explanation.
- Finishing lists "West System 105 epoxy resin" twice (1 qt and 1 pt) with identical notes. This may be the other agent's in-progress data.
- Downloads: group the 68 files by folder (shaper/, forms/, …) under small headings.

## What works

- The rail at ≥ 900 px reads like a table of contents: numbered steps, a clear current state with an accent bar and tint, and quick actions separated below. On phones it becomes pill scrollers with a cut-off pill as the scroll hint.
- Typography and tokens match `style.css`. Uppercase muted group labels, `--panel` cards, `--panel-2` table heads and the accent are used consistently. Dark mode is handsome, and drawings stay black-on-white in both themes.
- The BOM header (total, estimate share, six subtotal chips) and the table footers give good totals at a glance.
- Assembly at 1440/1920: a large real viewer (no second WebGL context), a sticky Prev/Next, a "Glue, clamp and cure" callout, and the inverted-hull camera with gold-highlighted parts. This is exactly what a builder needs.
- Forms cards: large previews, page counts ("27 Letter pages (9 × 3)") and tiled print next to them.
- Mode history: Build → Simple → Build → Back lands on Simple with `history.length` unchanged (no dead entries). `aria-pressed` is right. Simple and Advanced layouts are unchanged, and the Advanced right panel no longer has a Build tab.
- Accessibility basics: the nav is a `<nav>` of real buttons with `aria-current` and arrow keys, focusable scroll regions with a visible outline, and a 2 px accent focus ring.
- Print CSS (read only) hides the rail, viewer and actions, forces black on white, avoids breaks inside rows and cards, and keeps tiles at true inch size.
