# Phase 4 checkpoint: build outputs (2026-10-12)

Phase 4 is built. Everything is generated live from `buildModel(params)`, in the app's new **Build** tab (Advanced) and in one "Download all" zip.

## Critics

| Critic | Grade | Reviews |
|---|---|---|
| Buildability: "could Eric and two helpers build it from these outputs?" | 6 → 7 → **8/10** | `docs/reviews/phase4-build-round{1,2,3}.md` |
| Shaper Origin files and file validity | 6 → 8 → **8.5/10** | `docs/reviews/phase4-files-round{1,2,3}.md` |

The last buildability MUST (step 1's lane count left out the spare lane) is fixed after round 3.

## What you get

**1. Verify first (12 items).** The original nine, plus:
- the strip bend test (2 plies to the 31" radius);
- measuring the real plywood thickness before cutting any dado;
- the remaining `verify` params.

The tick state is saved in your browser.

**2. Cut list.**
- Oak by board thickness, with rough and final sizes and grain in words, plus an assembly-step column.
- The resaw strips, ripped first: the bands from 1 × 4/4 × 9" × 6 ft (10 strips for 8), the rails from 1 × 5/4 × 10" × 6 ft (6 for 4).
- Plywood and metal stock.
- CSV download.

**3. Nesting.**
- **4 mm sheet:** 9 parts, 37 % used.
- **12 mm sheet:** the deck and the seat back, 33 % used.
- Both sheets have room to spare, and the side webs run with the grain.
- **Oak:** 26.9 bf net, 49 bf of whole boards to buy (2 × 4/4 10 ft, 4/4 9" resaw, 5/4 6 ft and 10" resaw, 6/4, 8/4 and 12/4 at 6 or 8 ft).

**4. BOM: $2,697**, 86 % of it still estimated prices.

| Section | Cost |
|---|---|
| Lumber | $615 |
| Plywood | $265 |
| Metal stock | $109 |
| Purchased parts | $609 |
| Fasteners | $284 |
| Consumables | $815 |

Every fastener line has a length. Hardware the notes call for (axle collars, cotter pins, T-nuts, inserts, Dual Lock, sealant) is included. CSV download.

**5. Shaper Origin files: 12 SVGs for 17 parts.**
- **Conventions:** real inches, `shaper:cutType` and `cutDepth` on every path, holes and pockets placed from the joints. Each file states the bit per feature and the face to cut ("FORWARD face UP"). Text is annotation only.
- **Bow bulkhead:** the 1.5" bulkhead is too deep for the Origin's bit (more than 1"), so it is marked DEEP CUT. Shaper-cut it 1" deep, then bandsaw and flush-trim.
- **Lid:** DO NOT STEP is engraved on it.

**6. Forms and templates.**
- the side cleat-line template and S-ramp;
- the rail form;
- the handlebow and bulkhead crown templates;
- the brake-flap router template.

They come full-size as SVG, or as 44 Letter pages with registration marks and a 1" check square. Use "Print tiled" in the app.

**7. Assembly: 30 steps with a 3D step-through.**
- Earlier steps show solid, and the current step's parts are highlighted.
- Each step sets its camera, including an under view for the inverted-hull steps.
- Each step lists its glue, hardener, pot life, clamp and cure times at 70 °F and 60 °F, and its checks.
- **Order:**
  1. Fit and drill the running gear, then remove it.
  2. Glue the brake knees on bare wood.
  3. Finish the underside.
  4. Flip the hull.
  5. Finish the rest.
  6. Hang the hardware.

**8. Finishing.**
- Test on offcuts first.
- Stain before epoxy: conditioner or gel on the okoume, or water-based dye, which is safe under epoxy.
- 2 coats of 105/207 on the okoume and the oak end grain.
- Spar varnish.
- Engrave DO NOT STEP.
- Quantities come from the surface areas.

**9. Downloads.** Each file, or "Download all" (68 files): the SVGs, forms, tiles, STLs, CSVs, README and **`build-book.html`**, a printable book of the whole package. `npm run build:single` makes the offline app (5.8 MB).

## Model changes made along the way

All are recorded in `DECISIONS.md` (D-68) or in the notes. The mass is 115.6 lb (+0.1 lb), which is only screws that are now counted, and nothing fails.
- **D-68:** full 4' × 8' plywood only, from a local supplier. The 2' × 4' scarfed-web option is gone.
- **Your D-69 merged:** bulkhead aligned with the sides.
- **Side webs:**
  - Their blank is now the true flat development along the plan curve.
  - They run into the bulkhead dado as at the transom.
  - The web dados run out through the top edge, and the deck dado runs into them, so no 0.04" walls are left.
- **Build order:**
  - The axle hangers go in with the frame, because joist 1's end Dominos land in them.
  - The lid hinges go on at the box step, before the crest strip.
  - The brake backers go in with the frame.
- **Grain:** every part's grain is now in its own local frame. The bulkhead label was wrong and would have left short grain over the hand-hold.
- **Fasteners:**
  - The handle sockets now use 1/4-20 × 1-1/4 screws into T-nuts in the backers, so no wrench is needed behind the box.
  - The rail-to-chine screws are #6, piloted, sized per rail depth.
- **Fixed model data:** seat-back inserts, pins and hinges; brake-flap screws clear of the pivot hole; 7/32" sign-knob holes; brake-shoe and chock stock; crest-strip stock.

## Decisions for you

1. **Cost: $2,697.** It lands in four places:
   - **Consumables, $815:** a $265 gallon epoxy kit, 207/209 hardeners, varnish, fillers.
   - **Lumber, $615:** whole 6"-wide boards. At net + 30 % it would be $423.
   - **Purchased parts, $609.**
   - **Fasteners, $284.**

   Options:
   - get real quotes (86 % of the total is estimates);
   - buy oak by the foot, or from wider boards;
   - share epoxy and varnish with other troop projects;
   - use stock hinges and latches rather than 316 stainless. I wouldn't: stainless is the right call in wet oak.

   Do you want a cost pass?
2. **Test the Shaper files once.** Import `transom-rear.svg` and `bow-bulkhead.svg`, and cut an offcut, to confirm three things: Origin reads the depths, the colors map to the right cut types, and the annotation text stays as guides. Check the 5/16" insert drill against the maker's sheet.
3. **The side-form print is 20 Letter pages.** The files critic suggests cutting the cleat-line template on the Shaper instead (the SVG is a cut file).
4. **Push to the live site?** The deployed site is from before Phase 4, and a push to `main` deploys after CI. Everything here is committed locally.
5. **Phase 4 is done when you sign off.** Still deferred:
   - a lightweight variant;
   - an A-vs-B comparison;
   - the rear-light strap;
   - the pin-on tongue.

The working notes are in `docs/phase4-{spec,data,geometry,process,ui}-notes.md`.
