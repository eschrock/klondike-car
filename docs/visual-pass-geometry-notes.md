# Visual pass: geometry notes (D-44)

Owner feedback: the model still looked like the block version. This pass changes what `buildModel` returns so the viewer can show a finished cart. The viewer side is in `src/viewer/**` (separate agent).

## What changed

| Area | Change | Files |
|---|---|---|
| Finish tags | Every part gets `Part.finish` in one pass at the end of `buildModel`. Oak: `surface: 'oak'` and `roundoverIn = min(roundoverIn, ⅓ × smallest section)`. Okoume ply: `okoume`. Cushion and seat-back pad: `soft`, `vinyl`. Wheels: `tread: 'lug'`, `rubber`. Steel, aluminum, ASA (also nylon, UHMW), rope and rubber parts get their surface. Builder-set fields win. | `src/model/finish.ts`, `index.ts` |
| Sheer line | The nose gunwale, the nose side panel (web) top edge and the front transom rise toward the bow on a quadratic ease-in (flat start, steepest at the bow). | `layout.ts` (`Layout.sheer`, `noseGunTop`, `sheerRise`), `body.ts`, `lighting.ts`, `joinery.ts` |
| Transoms | Crowned parabolic top edge and rounded top corners, in the extrusion outline. | `body.ts` (`transomTopOutline`) |
| Seat back | The pad is a rounded-rectangle extrusion (soft). The cushion stays a box (the rider placement reads its size) and is tagged `soft` for the viewer to crown. | `seat.ts` |
| Push handle | The crossbar is a real 1¼" round bar (a cylinder along Y, was a square block). | `brake.ts` |
| Grab handles | Bars keep their box; the oak roundover tag (capped at ⅓ of the 1" height) rounds them in the viewer. | (finish pass) |
| Prow | Unchanged shape: a sweep, vertical leg then a Bezier curling forward (a swan-neck stem). It gets the oak finish tag. The sweep section is rectangular, so a nicer end cut is a viewer matter. | (finish pass) |

## New params (`src/params.ts`, all `assumed`, ref D-44)

| Param | Default | Range | Meaning |
|---|---|---|---|
| `sheerRiseIn` | 2.5 | 0–4 | Gunwale rise at the bow. 0 reproduces the straight gunwale exactly (box gunwale, 4-point web). |
| `sheerLengthIn` | 18 | 6–30 | Run of the rise, measured back from the front transom's inner face, never behind the cabin shoulder. |
| `transomCrownIn` | 0.625 | 0–1.5 | Arc rise at the transom center above its corners. |
| `transomCornerRadiusIn` | 0.75 | 0–2 | Top corner radius of both transoms. |
| `seatBackCornerRadiusIn` | 2.5 | 0–5 | Seat-back pad corner radius (capped at ⅓ of the smaller side). |

`roundoverIn` (0.25") was already added with D-44.

## Design decisions

- **The cabin does not rise.** `Layout.sideH` is still the flat (lowest) side height, so the seat, grab handles, storage box, handle sockets, rear light, signs and every brake/lash/storage reference keep their heights. The rise starts at `max(xs, xFront − transom − sheerLengthIn)` = 34.5" at the defaults, behind which the finger-guard hazard zone (26.4"–31.6") sits on the flat gunwale. `Layout.noseGunTop` = nose side top + full rise (bow).
- **Gunwale** (nose, captured-ply): an `extrusion` in the XZ plane. Its top and underside both climb with the curve, so the section stays one rail band tall, and the part is sawn from a (1.5" + rise) board (`stock` reflects that; `fab: bandsaw`). With no rise it is the old box. The cabin gunwale is untouched.
- **Web**: the nose web outline's top edge is `hTot + sheerRise(x)`, so its top is always the gunwale underside plus the groove depth: captured along the whole curve (test). It enters the front transom dado at the full rise. `edges` has one entry per outline edge (none exposed).
- **Front transom**: corner height = `noseTop + sideH + rise` (= `liftSlot(…,'front').transomTop`). The lantern and flag clips sit on the crown (`lighting.ts`). The lift slot stays where it was (it is positioned from the deck), so the oak above it only grows; the crown is added above the corner height, never subtracted (D-37 rule holds, tested along the crowned top).
- **Prow**: its leg, tip height and bend are measured from the FLAT side height, not the risen bow, so the checked D-43 prow (4" leg, tip 20.5" above the foot) is unchanged. At the bow the tip therefore stands `prowHeightIn − sheerRise` above the gunwale. Raising the tip by the rise would push the grab check (0.88 combined) over 1.0. The prow socket now stops below the transom top (its note says so).
- **Rear transom**: same crown and corner radius; corner height is the old `transomTop`.
- **Roundover is cosmetic.** It lives only in `finish`; mass and analysis keep the square section.

## Mass (empty cart)

| | lb |
|---|---|
| Before | 160.553 |
| After (defaults) | **161.562 (+1.009)** |

By group of change:

| Part group | Δ lb |
|---|---|
| Front transom (rises with the sheer, + crown, − corners) | +0.882 |
| Rear transom (crown, − corners) | +0.247 |
| Nose side panels (webs follow the curve), 2 | +0.182 |
| Nose gunwales (same section, curved) | 0.000 |
| Push handle crossbar (square block → round bar) | about −0.2 |
| Seat back pad (rounded corners) | about −0.1 |

(The last two together are −0.30 lb; the sheer, crown and corners are +1.31 lb.) `hull.test.ts` body-mass baseline moved 35.1 → 36.5.

## Which analysis checks read what

- `Layout.sideH` (flat height): structure.ts side-section layers (nose web `z1 = noseTop + sideH − railBand`, cabin `L.web`), brake.ts flare clearance, and all cabin/seat/storage/lighting/brake builders. The nose section is therefore the MINIMUM (conservative), as asked. Not changed.
- `liftSlot(…,'front').transomTop` (now with the rise): joinery avail/screw positions (`min(2.5, transomTop − origin)`), the slot rule. The slot bar stress uses `liftBarMinIn`, unchanged.
- `prowShape`: reads the flat side height (see above), so `prow-grab`, `prow-bend` etc. are unchanged.
- Mass and CG: all checks that read mass see +1.0 lb.

## Test changes (baselines that moved, and why)

- `hull.test.ts`: nose web/gunwale AABB differ by the rise (the capture itself is tested along the curve in `visual-geometry.test.ts`); front `transomTop` includes the rise; body mass 35.1 → 36.5.
- `analysis/brake.test.ts`: the 200 lb goal case of `brake-force` sat at 89.994% of its limit (just under the 90% "marginal" line). The +1.0 lb moves it to 90.3%, so it is now **marginal** (still passes, 27.07 vs 30 lbf); the test asserts `< 91%` and `marginal` instead of `< 90%` and `pass`. The operating case stays a clear pass. This is real: the check had no slack at all.
- `analysis/checks.test.ts` (kingpin plate stress): the test parsed a rounded integer H from text and compared at ±5 psi; the +1 lb mass pushed rounding past that by 0.3 psi. It now allows one unit of H rounding.
- `model.test.ts` overlap matrix: two new variants (`sheer0`, `sheer4Long`).
- New: `src/model/visual-geometry.test.ts` (18 tests).

## Open issues

- **Brake handle force at the 200 lb goal is now marginal.** Recovering about 1.5 lb of empty mass anywhere (or a slightly longer brake ratio) restores the "pass" reading. Not changed here: it belongs to the brake workstream.
- Gunwale ends meet a transom whose top corners are rounded (0.75"); the real gunwale end should be shaped to match (not modeled). Keep the radius small.
- `finishLbPerFt2` is applied to the real outline area; the roundover (cosmetic, ≈ 1% of the oak surface) is not subtracted from mass.
- The finger guard hood/strap assumes a flat gunwale; the default sheer starts 2.9" forward of the guard zone. A short `sheerLengthIn` bigger than about 21" would put the rise over the guard (no validator yet).
- The cushion is still a box. The viewer should crown it from `finish.soft`.
