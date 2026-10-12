# Phase 4 spec: build outputs (draft, 2026-10-12)

Everything below is derived from `buildModel(defaultParams())` (and from the current params in the app). Nothing is hand-entered except prices and vendor facts, which live in one new table next to the part sourcing. The default model has 171 built parts: 68 oak pieces (52 table saw, 8 bandsaw, 6 Shaper, 2 bent-lam rails), 8 bent-lam sandwich bands, 11 okoume sheet parts, 15 metal parts (drill and tap), 2 printed ASA clips and 67 purchased items.

## Outputs

| # | Output | Source in the model | Form |
|---|---|---|---|
| 1 | **Cut list.** Oak grouped by board thickness (4/4, 5/4, 6/4, 8/4, 12/4), with rough and final T × W × L, grain, quantity by `partNo`, and fab method. Resaw list: band strips (0.234" from 4/4) and rail strips (2 × 3/8"). Plywood parts by sheet. | `stock`, `rough`, `plies`, `grain`, `fab` | table + CSV |
| 2 | **Nesting.** True outlines (not bounding boxes) on one 4 mm 4 × 8 and one 12 mm 4 × 8, with the seat back from the deck offcut. The side webs are unrolled to their flat development (they are plan-curved at the bow). Oak board feet by thickness with a waste allowance (a param, default 30 %), and a suggested board list (for example "8/4 × 6" × 6 ft: 1"). | outlines, `stock` | SVG drawing + table |
| 3 | **BOM with costs.** Lumber (board feet × $/bf), okoume (per sheet), metal stock, purchased parts, fasteners expanded from `joints` (count × size × type, plus Dominos by size), epoxy and finish by area. Each price is marked *quoted* or *estimate*. | `sourcing`, `joints`, finish area | table + CSV |
| 4 | **Shaper Origin files**, one per `fab: 'shaper-origin'` part (deck, 2 webs, seat back, 2 grab boards, bow bulkhead, transom, box sides, ends and lid with DO NOT STEP, 2 signs, 2 brake flaps). Outside, inside and pocket cuts, and holes from `joints[].at`, each with its depth. | `geometry`, `joints`, `legend` | SVG (see question 1) |
| 5 | **Forms and templates.** Sandwich band form (sheer and bow taper) and the S-ramp, rail bending form, handlebow and bulkhead crown templates, brake-flap template. Full-size, dimensioned, and tileable. | layout and profile functions | Shaper SVG + dimensioned drawing |
| 6 | **Assembly steps.** Built from `step` and the `HULL_STEP` sequence: parts per step, joints, glue, clamping and cure times. A viewer step-through shows earlier steps solid, the current step highlighted and later steps hidden, with a camera preset per step. | `step`, `joints`, notes | Build tab + printable |
| 7 | **Finishing schedule.** Offcut stain tests, conditioner or gel on the okoume, epoxy seal coats, spar varnish coats, recoat and cure times, the DO NOT STEP engraving, and the quantities. | finish area | table |
| 8 | **Verify before ordering.** The nine checks in `docs/phase3-checkpoint.md`, as a checklist linked to the parts and params each one guards. | params with `status: 'verify'` | checklist |
| 9 | **STL** for the two ASA lamp clips. | extrusions | STL (binary) |
| 10 | **Single-file HTML** (`npm run build:single`) with all of the above, for offline use in the shop. | | |

## Architecture

- `src/build/**` holds plain TS with no three.js imports, so it runs under vitest: `cutlist.ts`, `nesting.ts`, `bom.ts` (with `prices.ts`), `shaper-svg.ts`, `forms.ts`, `assembly.ts`, `finishing.ts`, `verify.ts`, `stl.ts`.
- The UI is a **Build** tab in the right panel. It replaces the current placeholder tabs (Cut list, BOM, Exports, Assembly) with sub-sections, and it has a step-through that drives the viewer.
- Downloads are generated in the browser from the current params, so they always match the model on screen.
- **Tests:** every Shaper part has a closed outline. Nested parts sit inside their sheet and don't overlap. The BOM fastener count equals the joint count. Every built part appears in the cut list or the BOM exactly once. Every step has at least one part.

## Agents (no file overlap)

1. **Data:** `cutlist`, `nesting`, `bom`, `prices`.
2. **Geometry export:** `shaper-svg`, `forms`, `stl` (plus any small exact-string additions to the model, for outlines it doesn't expose yet).
3. **Process:** `assembly`, `finishing`, `verify`.
4. **UI** (after 1–3 land): the Build tab, the step-through, downloads, print styles.

**Critics:**
- a buildability critic, asking "could a volunteer build from these outputs?";
- a Shaper and file-validity critic, which opens the SVGs and checks the cut types, depths and scale.

Each grades 1–10; iterate until 8 or better, or 3 rounds.

## Eric's answers (2026-10-12)

1. **Shaper files: SVG only.** Use Shaper's fill conventions:
   - black fill with no stroke: an outside cut (the part outline);
   - white fill with a black stroke: an inside cut (holes and hand holes);
   - gray fill: a pocket;
   - blue stroke: a guide line;
   - every path also carries `shaper:cutDepth` (in the `http://www.shapertools.com/namespaces/shaper` namespace, in inches).

   No DXF.
2. **Printing:** the Build tab prints cleanly from the browser (print CSS; save as PDF from the dialog). Full-size templates tile onto Letter paper with alignment marks and a 1" check square. No PDF library.
3. **Delivery:** download from the app, as single files plus a "Download all" zip (a small store-only zip writer, with no dependency). Everything is generated live from the current params.
4. **Builders:** Eric plus helpers, who are shop-literate. The steps stay concise: parts, joints, glue, clamping and cure, and the checks.

## Found while specifying
- The side webs' flat development is 0.24" longer than their plan projection. The model's blank allowed 0.1", so the web blank now uses the true arc length (`body.ts`).
- **D-68 (Eric):** full 4' × 8' sheets from a local supplier only. The 2' × 4' scarfed-web option is removed from the model.
- `src/build/flat.ts` (written first, and shared by the nesting and the Shaper files) produces the flat pattern of every flat-cut part.
