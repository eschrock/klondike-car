# Handoff: start Phase 4 (build outputs), written 2026-10-12

Paste the prompt below into a fresh Claude Code session started in this repo.

---

You are picking up the Troop 455 Klondike Derby sled project at /Users/eschrock/dev/klondike-car: a parametric design app (TypeScript, Vite, three.js, vitest). It deploys to https://eschrock.github.io/klondike-car/ through GitHub Pages on every push to `main`, after the tests pass.

**Read first:**
- `CLAUDE.md`, for the architecture rules and workflow.
- `docs/STATUS.md`.
- `docs/phase3-checkpoint.md`, the final Phase 3 summary.
- `DECISIONS.md`, especially **D-49 to D-67**. These record how the design became what it is: a pulled Klondike *sled* on wheels, not a ridden cart.
- `BRIEF.md` §10 (Phase 4 deliverables) and §4.3a.
- `docs/phase3c-*-notes.md`, for the details of each pass.
- The latest reviews in `docs/reviews/`: `phase3c-eng-round1.md`, `phase3c-build-round2.md` and `visual-3c-round2.md`.

**What it is now.** The concept is Ashley's: a solid, reusable white-oak Klondike sled on four 10" pneumatic wheels, which doubles as a post-race hauler.
- **How it's used:** the rider is a passenger. The patrol pulls on a nylon-rope bridle tied to an oak tongue, and a musher at the back pushes on the handlebow and works the brake.
- **Steering:** a center-pivot (soapbox) front axle, ±20°.
- **Brake:** a removable scooter-style step brake.
- **Shape:** a 24" body with a gradual bow taper to 18.5"; 30" matched tracks; a concave sheer from 4" at the bow to 14" at the rear.
- **Construction:** sandwich sides (oak bands on each face of a 4 mm okoume web); a 12 mm okoume deck; a frameless ½" okoume seat back that flips flat.
- **Storage:** the box holds the cushions, lamps and chocks, or the 10 Essentials.
- **Lights:** lamps clip into the bow and rear hand-holds.
- **Transport mode:** handle parked, seat flat, brakes, lights and chocks off.
- **Numbers:** 115.5 lb. Riders safe 50–250+ lb, green to 240. Cargo 274 lb (target 200). Resting 348 lb.
- **Status:** all critics are at 8/10, nothing fails, and 1,484 tests pass. No welding and no custom steel.

**Owner preferences (Eric), which matter:**
- **Weight:** he is weight-sensitive. Never add mass to pass a check without showing the lightest option first.
- **Load realism:** loads are at walking pace with no curbs. Judge purchased parts by their real-world record. He has rightly pushed back on overcautious analysis.
- **Use case:** confirm it, and sketch shapes, before any big design change. Two rework rounds came from misreading the use case.
- **Shop:**
  - a handheld **Shaper Origin** CNC; any part size works with ShaperTape;
  - table saw, bandsaw, router, drill press, Domino;
  - no welding.
- **Materials:**
  - **4 mm okoume:** one full 4' × 8' sheet from Aircraft Spruce (Peachtree City, GA, will-call).
  - **12 mm (½") okoume:** one sheet from a local dealer, for the deck and the seat back.
  - **White oak:** 4/4–12/4 from the local lumber store; he resaws and planes.
  - **Finish:** stain (pre-stain conditioner or gel on the okoume), then epoxy seal, then spar varnish.

**Working style (from CLAUDE.md):**
- **Agents:** use Sonnet subagents for implementation, in parallel only where file ownership doesn't overlap. Parallel agents never change git state, and edit shared files only with small exact-string edits.
- **Critics:** put every verification through a critic that grades 1–10 with concrete fixes. Iterate until 8 or better, or 3 rounds, and save the reviews in `docs/reviews/`.
- **Commits and checkpoints:** commit at milestones, and stop at the phase checkpoint for Eric.
- **US English** everywhere.
- **Tests:** heavy sweep tests need CI-tolerant timeouts. Shared runners are 2–3× slower; the full suite takes about 2 minutes locally.

**Phase 4: build outputs.** Everything is derived from `buildModel(params): Part[]`, where each part carries its stock, rough size, grain, fab method, joints, sourcing, notes and `step`. Add a "Build" view or tab to the app, plus exports.
1. **Cut list:** solid oak by board thickness, with rough and final sizes, grain, and resaw/laminate strip lists for the bent and sandwich members. Plywood parts by sheet.
2. **Nesting:**
   - plywood on one 4' × 8' sheet of 4 mm and one of 12 mm, with the seat back from the deck offcut; the model expects that, so verify it;
   - an oak board-foot estimate by thickness, with a waste allowance.
3. **BOM with costs:** lumber, okoume, and purchased hardware.
   - **Purchased parts:** wheels, DOM tube, kingpin, UHMW, eye bolts and chain, nylon rope, bronze sleeve, hinges and pins, inserts, fasteners (expanded from the joint list), lamps, reflectors and finish.
   - **Data:** sourcing and prices where known; mark estimates.
4. **Shaper Origin files:** SVG (and DXF) for every part tagged `fab: 'shaper-origin'`. That covers the deck, webs, seat back, grab boards with their hand holes, the bow bulkhead with its hand-hold, box panels, sign blanks and brake flaps. Include cut depths (inside, outside, pocket) and holes. Optionally add STL for the printed ASA parts (the lamp clips).
5. **Forms and jigs:**
   - the lamination and ramp forms for the sandwich bands (sheer and bow taper);
   - the handlebow and bulkhead crown templates;
   - the brake-flap template.

   Give each as a drawing with dimensions, or as Shaper SVG.
6. **Assembly steps** from part `step` and the `HULL_STEP` notes, with a viewer step-through (camera preset per step, parts appearing in order). Include the glue-ups and cure times.
7. **Finishing schedule:** stain on offcut tests, epoxy seal for the okoume, spar varnish, and the DO NOT STEP engraving on the lid.
8. **"Verify before ordering" checklist** from `docs/phase3-checkpoint.md`:
   - a tire squash test (0.55" or more at 300 lb);
   - the wheel's rating, bore and hub;
   - DOM, not ERW, tube;
   - the eye-bolt and chain ratings, and the rope's strength;
   - the bronze sleeve;
   - the seat-back pin and inserts;
   - the sign-knob screws;
   - a test hinge on the first knee;
   - the lamp-clip fit.
9. **Single-file HTML build** (`npm run build:single`) that includes the build outputs, for offline use in the shop.

**Plan:**
1. Start with a short Phase 4 spec (`docs/phase4-spec.md`) and confirm the output formats with Eric: SVG versus DXF for the Shaper, and whether he wants printable PDF-style sheets.
2. Then implement with parallel agents, separating the data generation (cut list, BOM, nesting) from the export formats and from the UI.
3. Run a critic pass from the buildability point of view: "could a volunteer build from these outputs?"
4. Then the Phase 4 checkpoint for Eric.

**Deferred, unless asked:**
- a lightweight variant;
- A-vs-B comparison;
- a rear-light strap option;
- the pin-on tongue.
