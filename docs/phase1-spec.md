# Phase 1 spec: block model

> **Superseded in places by the critic round-1 fixes** (see `docs/reviews/phase1-round1.md`):
> - The kingpin now leads the front axle (D-25).
> - The seat base ring is gone; the cushion sits on the deck, and the seat back is a frame plus panel.
> - The bolster is now rails over the turntable, with side-bearers.
> - Storage is a tray with a lid.
> - Explode directions are set per subsystem.
>
> The code in `src/model/` is authoritative.

Goal (BRIEF §10, Phase 1): simple boxes, cylinders and extrusions at **real dimensions**, all driven by `src/params.ts`.
- The steering axle articulates with lock.
- Includes wheels, seat, rider mannequin, cargo/storage box and a truck bed model.
- Viewer, parameter panel, live weight/CG and a truck-fit check.

The detailed joinery and real shapes are Phase 3. Blocks still need correct **sizes, positions, materials and masses**, because the Phase 2 analysis runs on them.

Frame: +X forward, +Y left, +Z up, origin on the ground under the rear-axle centre (C-1). Inches and pounds.
Below, `r` = wheel radius, `WB` = wheelbase, `L` = body length, and `xs = WB − noseTaperStartIn` is the cabin shoulder.

## Mass rules
- **Wood parts:** mass = volume × density + surface area (ft², all faces) × `finishLbPerFt2` (D-20). Oak uses `oakDensityPcf`; ply uses `derived().plyDensityPcf`.
- **Steel:** volume × `steelDensityPcf`.
- **Hollow parts** (storage box): use the shell area × panel thickness, not the box volume.
- **Purchased parts:** catalog masses from params, or the estimates below (each with a `notes:` saying "estimate").
- Every part sets `body`, `group`, `kind`, `material`, `fab`, `step` and `explode`, plus `stock` for lumber and sheet.

## Parts (default "heavy" design, D-21)

### Running gear (`running-gear`)
- **4 wheels**, `body: wheel-XX`. Rear at (0, ±T_r/2, r). Front ones sit on the steer body: kingpin at (WB, 0), rotated by `steerDeg`, offset (0, ±T_f/2, r). Mass is `derived().wheelMassLb`.
- **Axles** (steel):
  - **Through rod:** one cylinder per axle along Y. Length = track + hubLength + 2·axleEndExtra. Centre at z = r. The front axle belongs to `steer`.
  - **Stub axles:** four cylinders of length hubLength + axleEndExtra + 4 (embedded).
- **Axle beams** (oak):
  - Size: axleBeamThickness (x) × axleBeamDepth (z). Length (y) = track − hubLength − 0.25 (between the hub faces).
  - Underslung (default): beam top = r + axleD/2. Overslung: beam bottom = r − axleD/2.
  - Rear beam is `chassis`, front beam is `steer`.
- **Axle clamps:** 2 U-bolts + plates per wheel side, as small steel boxes at each beam end. Mass 0.35 lb each (estimate).

### Steering (`steering`, `body: steer` unless noted)
- **Turntable:** box turntableSize² × turntableThickness on top of the front beam. Mass 3.5 lb (estimate, purchased).
- **Front bolster:** oak block on top of the turntable, `chassis`. Width = noseWidth − 2·sideThickness, x-size = turntableSize, depth = (deck + frontDeckRaise − deckPly) − (turntable top). If that depth is < 0.75, raise it to 0.75 and leave the validator warning in place.
- **Kingpin:** steel cylinder, vertical at (WB, 0), from the beam bottom to the bolster top. Diameter kingpinDiameter. Grade-8 bolt plus nut, `chassis`.
- **Steering stops:** 2 oak blocks 1.5 × 1.5 × 1 on the beam top, at ±(turntableSize/2 + 1).
- **Tongue** (if drawbar = woodTongue): oak 1 × 2.5 cross-section. Runs from the front beam forward to WB + tongueLength, at beam height. `removable: true`.
- **Bridle:** a thin box from the tongue tip (or the beam ends if rope only) to 18" ahead. Purchased rope, 1 lb.

### Frame (`frame`, chassis)
- **Ladder** (frameStyle = 0): 2 oak rails, railThickness (y) × railDepth (z), top at deckHeight − deckPly.
  - **Cabin rails:** inboard of the sides at y = ±(bodyWidth/2 − sideThickness − railThickness/2). They run x = −rearOverhang + sideThickness … xs.
  - **Nose rails:** at ±(noseWidth/2 − sideThickness − railThickness/2), from xs to the front transom. Their top is raised by frontDeckRaise.
- **Hull-as-beam** (frameStyle = 1): no rails. The side girders (below) are deepened by railDepth.
- **Crossmembers / joists:** oak, ¾ × crossmemberDepth. Spaced ≤ crossmemberSpacing between the transoms. They span between the rails (ladder) or between the side girders. Top at deck − deckPly.

### Body (`body`, chassis)
- **Decks** (ply, captured, `edges: 'captured'`). The cabin deck is (bodyWidth − 2·sideThickness) wide and runs from the rear transom to xs. The nose deck is (noseWidth − 2·sideThickness) wide, from xs to the front transom, with its top at deck + frontDeckRaise.
- **Sides** (sideConstruction):
  - **Captured ply (default, D-22):** each side has an oak chine (sideThickness × 1.5, at the deck line), an oak gunwale (sideThickness × 1.5, at deck + sideHeight) and a panelPly web between them. Cabin sides at ±bodyWidth/2 run from the rear transom to xs; nose sides at ±noseWidth/2 run from xs to the front.
  - **Solid oak:** one board, sideThickness × sideHeight.
  - **Open frame:** a gunwale on posts every 12".
- **Shoulder panels:** ply, at x = xs, closing the step from bodyWidth to noseWidth on each side. Height sideHeight.
- **Transoms:** rear and front. Oak, sideThickness × (sideHeight + crossmemberDepth), spanning the body or nose width.
- **Prow ornament:** a decorative stem at the front transom, 18" tall. An extrusion with a simple curved profile is fine; mark `bentlam` TODO. Oak, `removable`.
- **Signs:** 2 side sign blanks, 6 mm ply 20 × 6, one on each cabin side, `removable`.
- **Grab handles:** 2 oak blocks 1 × 1.5 × 8 on the gunwales at x = seatX + 6.

### Seat (`seat`)
- **Seat base:** an oak frame block 16" fore-aft × (cabin inner width − 2) × 1.5. It sits on the deck with its rear edge at seatX − 4.
- **Cushion:** foam, purchased, seatCushion thick on top of the base. Mass 1.5 lb (estimate).
- **Seat back:** an oak/ply panel 0.75 thick, seatBackHeight tall, reclined seatBackAngle from vertical, its bottom at the base rear. Carries a 1" foam pad. `removable`.
- **Foot stop:** oak 1.5 × (nose inner width) × 4 tall, at x = seatX + riderLegReach, on the deck (nose deck if it's forward of xs).

### Storage (`storage`)
- **Location rearOverAxle (default):** a box from the rear transom to the seat-back base, full cabin inner width. Its height comes from storageVolumeIn3, capped at the side height + 2. Mass is the shell of panelPly plus an oak lid frame.
- **Location forwardRaised:** a box over the nose, bottom at r·2 + 0.75.
- **Location underSeat:** a box under the cushion, which raises the seat. Make the seat base height follow from it.

### Brake & rear handle (`brake` / `removable`)
- **Brake shoes:** 2 oak blocks 1.5 × 3 × 2, touching the front-upper quadrant of each rear tire tread at 45°.
- **Cross shaft:** steel ½" rod spanning the rear track, behind the rear axle at x = −(r + 1.5), z = r.
- **Brake lever:** oak 1 × 1.5, rising from the cross shaft to rearHandleHeight − 4 at the rear transom.
- **Rear push handle** (`removable`): 2 oak uprights 1 × 1.5 from the rear transom to rearHandleHeight, plus a crossbar 1.25 round (use a box) spanning the body width.

### Lighting (`lighting`)
- Front lantern mount on the prow (printed PETG block, 0.2 lb).
- Rear red light on the handle crossbar or transom (0.3 lb incl. light).
- 4 side reflectors (0.05 lb each).

### Hardware allowance (`hardware`)
- One "fasteners, inserts & misc" part: a small box at the deck centre, 2.5 lb (estimate), `kind: purchased`.

### Payload (`reference`, `payload: true`, excluded from empty mass)
- **Rider mannequin** (body `rider`), seated on the cushion with its H-point at (seatX, 0, deck + seatBase + cushion).
  - Blocks for pelvis, torso (reclined to match the seat back), head, 2 thighs and 2 shins/feet reaching the foot stop. Size them from riderStature.
  - Mass goes on **one** part (the torso) with `cgIn` = (seatX + riderCgAheadOfHpoint, 0, seat surface + riderSeatedCgAboveSeat), per D-3. Every other segment has mass 0.
  - `buildModel(p, view)` gets `view.rider: 'none' | 'operating' | 'goal'` (default 'operating') to pick the mass.
- **Cargo** (body `cargo`): a box of cargoMass inside the storage box, and `view.cargo?: boolean` (default true).

## API
- `buildModel(p, view?: { steerDeg?, rider?, cargo?, removed?: boolean })`. `removed: true` omits `removable` parts (transport configuration).
- `src/model/mass.ts`: `totalMass(parts, {includePayload})` and `centerOfGravity(parts, {includePayload})`. Both use `cgIn` or the transformed geometry centroid.
- Keep builders split by subsystem (`src/model/running-gear.ts`, `frame.ts`, `body.ts`, `seat.ts`, `storage.ts`, `brake.ts`, `rider.ts`, …) and share helpers (`src/model/build-utils.ts`: box part factory, oak/ply mass with finish, surface area).

## Acceptance
- `validateParams(defaultParams())` is still `[]`.
- **No two solid chassis parts overlap by more than 0.05",** except where intended (tenons later). Write a test using part AABBs or OBBs that lists any unintended overlap among frame, body and running-gear parts.
- Front tires don't intersect the nose at full lock (both directions): an OBB test.
- Masses are finite and positive. The empty-mass breakdown by group prints in a test log. Expect roughly 100–125 lb at defaults (W-1 "default", now with captured-ply sides).
- Changing every primary param across its range doesn't throw.
