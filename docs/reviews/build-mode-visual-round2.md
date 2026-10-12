# Build mode (top level), visual and UX review, round 2

Reviewer: visual/UX critic. Commit 00ac751 plus the live tree, at localhost:5179. Sizes: 1440×900 and 1920×1080, 1024×768 and 390×844, light and dark. I went through every section. In Assembly I used Next with the section scrolled 700 px (and 1600 px on a phone), the → key, the step jump `<select>`, and step 15, an `under` step. I tested mode switching (Build → Advanced, Build → Back) and a reload, and the step survived the reload. No console errors. Screenshots are `docs/screenshots/build-mode/*-r2.jpg`.

## Grade: 8 / 10 (round 1: 7)

All seven round-1 MUSTs are fixed and verified:

| R1 MUST | Status | Evidence |
|---|---|---|
| Prev/Next scrolls to the new step | FIXED | At 1440, scrolled 700 px, Next puts the title at y = 110, just under the pinned nav. On a phone, scrolled 1600 px, the title lands at y = 420, under the pinned viewer and nav. The → key and the jump do the same. |
| Camera reset when leaving Build | FIXED | From step 15 (`under`) to Advanced: Iso, right way up, and the full Advanced toolbar is back. |
| Step numbering | FIXED | "Step 15 of 29 ▾" matches "15. Brake knees…". The counter is a real `<select>` with an `aria-label`. |
| Toolbar in Build | FIXED | One 41 px row (views, Explode, More) at 1440 and 1024. The phone toolbar is 57 px, against 126 px before, which leaves a 296 px canvas. |
| 1024 fit | FIXED | Every cut list table is `is-fit` at 803/803. The rail is 168 px, and the viewer is 516 px wide. |
| Phone cards | FIXED | Cut list cards are very good: the name with Qty on the right, the final size bold on its own line, then a muted Rough/Grain line and a Fab/Step line. BOM cards end with Extended. No page-level horizontal scroll (390/390). |
| Landmark | FIXED | Exactly one main (`#build-main` role=main). The viewer is a region. |

Also good: sticky table heads (checked in the middle of Fasteners), fractions with the decimal after (`21-5/32 (21.142)`), a Stock row on the Shaper cards, a one-column Finishing schedule with the empty Recoat/Cure lines dropped, and the oak buy table first in Nesting. The step checks are real persisted checkboxes, the step survives a reload, and the BOM chips jump to their tables. The laminated group's Layers fold reads clearly ("Layer 1 of 3: 1 × 4/4, plane to 25/32" (0.792")…").

## MUST

1. **The Explode slider is 6 px wide on phones.** `input[aria-label="Exploded view distance"]` measures 6×32 at 390 px, so only the thumb shows and it can't be dragged. Cause: `Viewer.setBuildMode` moved Explode onto the `nowrap` row (`.viewer-toolbar { flex-wrap: nowrap }` under 600 px). Fix: below 600 px in Build, either leave Explode in the More sheet, or give it a full-width second row (`flex: 1 1 100%` with `.viewer-toolbar` wrapping). A `min-width: 96px` on the range would also do.
2. **BOM notes bury the line items.** The BOM is now 11,945 px at 1440 and 23,693 px on a phone. One lumber row carries about 15 lines of prose, including a raw `(https://clinelumber.com/…)` URL, while name, Qty and Extended sit far apart (`390-dark-bom-cards-r2.jpg`). Every fastener row repeats the same "Material: 316 stainless REQUIRED…" text. Fix in `build-panel.ts` (BOM row renderer):
   - show the first clause ("Buy: 3 × 4/4 × 6" × 10 ft; 1 × 4/4 × 9" × 6 ft") and put the rest in a `<details><summary>Details</summary>`;
   - render the alternative vendor as a link, not a raw URL;
   - print a material note shared by a whole group once, under the group heading;
   - drop "Vendor –" on phone cards when it is empty.

## SHOULD

1. **Vendor column versus link.** Linked rows (oak 4/4, 8/4, both plywoods) put the link on the item name, but Vendor says "–". Put the vendor's name in the Vendor cell as the link ("The Wood Yard ↗"), and add an external-link mark.
2. **Cut list column alignment.** Each group's table sizes its own columns, so QTY and FINAL sit at different x positions in consecutive tables (the laminated table's QTY is about 150 px right of the strips table's). In the laminated table, the final size wraps to two lines ("2-1/4 × 2-1/4 × / 27-15/32 (27.47)"). Use `table-layout: fixed` plus a shared `<colgroup>` (e.g. 30% / 5% / 20% / 20% / 8% / 10% / 7%) on all `.bp-cuts` tables.
3. **Laminate note wording.** "3 × 3/4" from 4/4 … Plane each layer to 0.792"" reads as planing a 3/4 board up to a thicker 0.792. Say "3 layers of 4/4, each planed to 25/32" (0.792")", and use the fraction format the table uses.
4. **Finishing:** "West System 105 epoxy resin" is listed twice (2 qt and 1 pt) with the same notes. Merge them, or explain the split. This may be the other agent's work in progress.
5. **Source file names shown to builders:** "(finishing.ts estimate …)" in the Consumables epoxy row, and "verify:" in the step-15 text. Use the section names ("Finishing", "Verify item 1").

## NIT

- "Step 0 of 29" reads as 29 steps when there are 30. Consider "Step 0 · 30 steps", or "Prep 0 of 29".
- BOM totals: "Bulk parts" and "Finishing touches" appear twice, once in the Build/Bulk/Touches row and again in "Jump to a section". Make the top-row chips the jump links, and drop the duplicates from the second row.
- Vendor "McMaster-Carr / Fastenal" wraps to two lines on every fastener row at 1440. Use `nowrap`, or shorten it to "McMaster / Fastenal".
- Downloads: file names are top-aligned while the Save buttons sit lower. Use `.bp-files td { vertical-align: middle }`. Grouping by folder is still open.
- Verify numbering within groups is still out of order (noted as not done, and acceptable).
- The Shaper preview still doesn't open full size on click (noted as not done).

## What works

Assembly is now a real shop tool. Pinned Prev/Next, keyboard stepping, a jump list, a remembered step and persisted checks fix the round-1 complaints. The `under` camera frames the inverted hull with gold-highlighted parts at every size. The 1024 layout is balanced: the rail is lighter, the tables fit, and the viewer has 516 px. The phone cut-list card is the best view of the cut list at any size. Style tokens, dark/light contrast and focus rings stay consistent with `style.css`. Simple and Advanced are unaffected, and Back and the mode buttons leave no dead history entries.
