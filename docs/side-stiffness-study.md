# Side stiffness study: stiles, ribs and tie-downs (2026-10-13)

Eric asked: "There's not much vertical support for the sides ... should we have vertical rails in one or two places?" A study only; nothing in the model changed. Sketch: [side-stiffness-options.svg](side-stiffness-options.svg).

## Summary and recommendation

- **People loads: the current side is strong enough, but it is not quite solid.** A 50 lbf push at the gunwale moves it 0.15" at mid-span. The softest spot is not mid-span. It is the tall stretch at x = 5 to 7, between the storage box's front end and the grab board, where the push moves it 0.17" (ends fixed) to 0.27" (ends pinned). Stresses are at 0.36 to 0.88 of the allowables. A hip pressing the web at seat height is negligible (0.04").
- **Cargo straps are the real problem, and nothing checks them today.** The `lash-load` row checks only the screws. Three 100 lbf straps pull each side in 0.43 to 0.75", and the web and the chine glue line at the deck are already over their allowables. At the D-ring's 300 lbf rating, one strap overstresses the gunwale band 1.3 to 1.5 times and the base 2 times.
- **Eric's stiles (A) do not stiffen the side.** A Domino in the edge of a 5/8" sandwich is a hinge. It holds about 50 lb·in, and the stile asks for about 60 lb·in under the 50 lbf push, so it cracks loose and the side goes back to its current numbers. Even with a perfectly glued base, the soft rear stretch improves only from 0.27" to 0.23". A also splits the web into 6 panels.
- **Recommendation: E + D, three inside ribs per side that also carry the D-rings, about +0.4 lb for the sled.**
  - **E1, x = 5.9:** a short rib tied to the storage box's front corner with a spacer. This is option D, so the box is its base.
  - **E2, x = 27.6:** a rib on joist 5 with a small knee.
  - **E3, x = 44:** a 4" post on the king beam.
  - **Each rib:** a 3/4" × 3/4" oak shaft that widens to a 2" × 1-1/2" head at the gunwale, 3/4" proud of the inner band (thinner than today's 1" doubler). The D-ring is through-bolted into the head with 4 #8-32 bolts.
  - **The six ribs replace the six lash doublers.** The tie-downs then spread over the whole bed (x = 5.9, 27.6, 44 instead of −4.5, 6.9, 18.9).
  - **Result:** 50 lbf moves the gunwale 0.061" at most (under 1/16"), and the 300 lbf D-ring rating passes everywhere.
- **The lightest option that feels solid for people alone is D (+0.24 lb):** worst 0.11". It does not fix the straps. E is D plus 0.17 lb more (+0.41 vs +0.24) and fixes the straps.
- **The frame-and-panel look: not worth A's split web.** If Eric wants the look, glue thin oak "applied stiles" (0.21" thick, flush with the outer bands) on the outside of the web at the rib stations. That is about 0.05 lb each, with no web split, no new joints and no Shaper files. E does the structural work behind them.

## The current side (laterally)

The model is the gunwale band beam (both bands plus the web, 5/8" × 1-1/2", EI 53,500 lb·in²) spanning the 58-3/4" between the transom and the bulkhead dados. It rests on the web, treated as vertical strips cantilevered from the deck line. Those strips include the chine and gunwale sandwiches, which bend across the oak grain. The gunwale's torsion and the web's twisting are also counted. The strip stiffness runs from 0.7 lbf/in per inch at the rear (13-1/2" tall) to 68 at the bow (4"). Results give both bounds (pinned / fixed ends), with the load position scanned for the worst point.

| Load (current side) | Deflection (fixed / pinned ends) | Governing stress (ratio) | Feel |
|---|---|---|---|
| (a) 50 lbf push at the gunwale, x = 20 | 0.146 / 0.158" | web at the chine top 1,030 psi (0.44 on the face-grain value, 0.88 on the across-grain estimate) | borderline |
| (a) same, worst x (5 to 7) | 0.165 / 0.274" | gunwale 2,300 psi (0.36); deck-line glue 147 psi (0.52) | flexible at the rear |
| (b) one 100 lbf strap at 45° (71 lbf in) | 0.21 to 0.38" (L2 worst) | | flexible |
| (b) three 100 lbf straps | 0.43 / 0.75" | deck line 303 / 394 psi (**1.07 / 1.39**), web 2,190 / 2,870 psi (**0.94 / 1.23** face grain) | floppy, overstressed |
| (b) model's own strap tension (79 lbf, `cargo-strap`), three | 0.34 / 0.59" | deck line 0.85 / 1.10 | marginal |
| (b) 300 lbf rating, one point | 0.70 / 1.13" | gunwale 8,400 to 9,500 psi (**1.3 to 1.5**), deck line (**2.0 to 2.1**) | fails |
| (c) hip, 75 lbf on a 6" patch, 4" above the deck, x = 16 | 0.036 / 0.043" | small | solid |
| (c) elbow, 75 lbf on the gunwale at the grab board, x = 14 | 0.23 / 0.29" | gunwale 0.2 | flexible |

Why the rear is softest: at x = 5 to 7 the side is 9-1/2" tall and 15" from the transom, past the reach of its end support. The grab board (8.2 to 17.2) stiffens the gunwale just ahead of it. Three of today's lash points sit in or near this stretch.

## Options

Columns: (a) 50 lbf at the worst x (fixed to pinned); (b) strap loads at the option's own stations (pinned bound); (c) elbow on the grab board (pinned bound).

| Option | (a) worst | (b) 100 lbf strap, one / three | (b) 300 lbf rating, worst ratio | (c) elbow | Added mass (sled) | Build |
|---|---|---|---|---|---|---|
| Current | 0.17 to 0.27" | 0.38 / 0.75" | 2.1 (deck line) | 0.29" | 0 | |
| A: 2 stiles at 20.4, 27.6 (Domino base) | 0.15 to 0.25" (if the Domino held) | 0.34 / 0.65" | 1.4 (gunwale) | 0.22" | +0.4 lb | web in 6 panels (6 Shaper files), 4 stiles with dados, tenons and Dominos, panel joints in the bent taper; hardest glue-up |
| B: 1 rib 3/4" × 1" at 27.6 + knee | 0.15 to 0.26" (rear untouched) | 0.35 / 0.66" | 1.5 (gunwale) | 0.22" | +0.32 lb | 2 ribs, 2 knees, bench-cut; no Shaper; glued in after the deck |
| B + D | 0.060" | 0.08 / 0.09" | 1.27 (web, across-grain est.) | 0.06" | +0.56 lb | as B + D |
| C: hybrid at 27.6 + D | 0.058" | 0.08 / 0.08" | 1.22 (web, across-grain est.) | 0.06" | +0.78 lb | A's web split plus B's knee: the most work |
| D: box tie at 5.9 only | 0.11" | 0.15 / 0.15" | 1.5 (deck line) | 0.09" | +0.24 lb | 2 oak spacers, glued when the box goes in |
| **E: ribs with D-ring heads at 5.9 (= D), 27.6, 44** | **0.061"** | **0.025 / 0.027"** | **0.87 (rib); side ≤ 0.73** | **0.06"** | **+0.41 lb net** | 6 T-shaped ribs, 4 knees, 2 spacers; 24 bolt holes; no Shaper; no change to the band glue-up |

Notes on E:
- **Rib stress.** At 300 lbf the E2 rib's base moment is 780 lb·in: 5,600 psi in a 3/4" × 3/4" shaft (0.87 of 6,460 psi). With a 1" deep shaft it is 3,750 psi (0.58), for +0.06 lb.
- **E without the bow post.** The base at x = 44 rises to 1.35 at the rating, so E3 earns its 0.13 lb.
- **Softer knees.** With knees half as stiff (50k lb·in/rad) the worst push is 0.065" and the rating 0.10".
- **Through-bolts.** 53 lbf of tension per bolt at the rating (about 0.1 of a #8-32's capacity). The washer bearing on the outer band is 140 psi (0.39). There is no withdrawal, so the `lash-load` governor (screw withdrawal, 0.83) disappears.
- **Knee.** Under an outward 50 lbf push the knee toe lifts about 95 lbf against 2 #10 screws into the joist (about 170 lbf wet, 0.56). Under inward strap loads the toe bears on the deck.
- **Box tie.** At the rating it pushes up to 204 lbf into the box's front corner. That is in-plane in the box's end wall (very stiff), and the glue stress is under 100 psi.
- **Mass.** Ribs 0.16 + 0.17 + 0.13 lb per side (0.92 lb total), less 6 doublers (0.54 lb), plus washers (0.03 lb) = **+0.41 lb**. Cost: about $10 of stainless bolts, nylocks and washers in place of the wood screws. The oak is offcuts.

## Stations and interference (E)

- **E1, x = 5.9 (shaft 5.5 to 6.3, head 4.9 to 6.9).**
  - Clear of the sign (it ends at 4.25) and sign backer 2 (1.5 to 3.0).
  - Rides in the 1-1/2" gap beside the box. The spacer is glued to the box side below the coaming (z ≤ 14-1/4"), never to the lid frame, which moves.
  - Head 1.3" behind the grab board.
  - The outside washers end 0.07" short of reflector L1 (6.91): move the reflector 1/2" forward.
- **E2, x = 27.6, on joist 5.**
  - Ahead of the seat cushion (it ends at 24), so the knee is clear. At 20.4 (joist 4) the knee would hit the cushion.
  - Side 5-3/8" tall; 0.6" into the bow taper. The rib is vertical, and so are the side's rulings, so it seats flat.
- **E3, x = 44, on the king beam (3" long).**
  - Side 4-1/16" tall. The low bow needs only this short post: the bulkhead is the foot brace, so a D-ring there would sit under the rider's boots.
  - Clear of the bow scupper (48.1) and reflector L2 (washers end 0.34" short).
  - The post face is 7-5/8" from the centerline, about 1" outside a winter boot: check with a booted rider. The chain joist (x = 35.1, side 4-5/8", face 8-3/8" from the centerline) is the fallback station.
- **Straps.** Cargo mode has no rider and the seat back flat.
  - **Bays:** the stations bracket two bays, 21-3/4" and 16-3/8" long. Cross straps at each station and an X across each bay hold a cooler fore and aft, which today's rear-half points cannot.
  - **Angles:** inner widths are 22-3/4", 21-1/2" and 17-1/4". Over a 16" × 12" cooler the strap leaves the D-ring at about 35° (E1, tall side), 68° (E2) and 85° (E3).
  - **Race mode:** no straps. The D-rings fold flat against the heads, 10" (E2) and 7-5/8" (E3) from the centerline, clear of the rider's knees.
- **Optional 4th per side.** Only if Eric wants to strap a duffel on the lid. A head without a shaft at x ≈ −2, between the sign backers, through-bolted the same way.

## Assumptions

- **Materials, stiffness.** Mean, dry values, for feel.
  - **Oak:** E 1.78 Msi along the grain, 0.14 Msi across it, G 0.1 Msi.
  - **White oak ply:** E 1.1 Msi along the face grain (D-73 estimate) and **0.5 Msi across it.** That assumes a thick cross-banded core. With equal plies it could be 0.25 Msi, making the current side 20 to 35% softer (0.19 to 0.32"); E is unchanged (0.06"). G 0.06 Msi.
- **Allowables.**
  - **Oak and ply:** oak bending 6,460 psi. Ply 2,338 psi along the face grain, and an across-grain estimate of 1,170 psi. The web's grain runs along x, so the vertical bending here is across the face grain. The existing `side-web` row also uses the along-face-grain value for vertical bending: worth fixing.
  - **Deck-line glue line and chine sandwich:** cross-grain tension F_v/3 = 283 psi (NDS 5.2.8, the D-74 precedent), on the 5/8" footprint.
- **Base and supports.**
  - **Deck line:** fixed, with a 5,000 lb·in/rad per inch spring (rail torsion between joists plus the deck). It adds under 10%.
  - **Knee on a joist:** 100k lb·in/rad (the joist and deck T-beam gives 2EI/L = 168k, halved for the joint).
  - **Box tie:** 5,000 lbf/in; 2,000 lbf/in changes the worst case by 0.003".
  - **Stile Domino:** about 3,000 lb·in/rad, 50 lb·in capacity.
- **Loads:** (a) `sideKickLbf` 50 lbf at the gunwale centroid; (b) a 100 lbf strap at 45° (71 lbf inward) and the `lashLoadLbf` 300 lbf rating (212 lbf inward), both sides pulled in; (c) 75 lbf, hip and elbow.
- **Feel:** under 1/8" is solid, over 1/4" is flexible.
- **Not modeled:** the plan curve of the bow taper (it stiffens the front), the deck coupling the two sides, local dishing of the web under a hand (the `side-web` row covers it), and impact.
- **Method.** Finite differences at 1/4" steps (a Vlasov-type beam on cantilever strips). It is a screening model, not a plate FE, so expect ±25%.

## What changes in the model if E is chosen

- **`params.ts`:**
  - new `sideRibWidthIn` 0.75, `sideRibDepthIn` 0.75, `sideRibHeadLengthIn` 2, `sideRibHeadProudIn` 0.75, `sideRibKneeLegIn` 2 / 2.5, `boxTieWidthIn` 1;
  - the ply's across-grain E and MOR for each thin sheet (`whiteOakPlyMoePerpPsi`, ...);
  - `lashDoublerThickIn` retires;
  - `lashPointsPerSide` stays 3, but the stations come from the layout.
- **`layout.ts`:** `ribX`, which is the box's front end less 1.1", joist 5, and the king beam. `lashPositions` (storage.ts) returns these instead of spreading over the rear half.
- **Parts:**
  - `side-rib-{L,R}{1,2,3}` (partNos `side-rib`, `side-rib-bow`, `side-rib-box`), `side-rib-knee-*`, `box-tie-*`;
  - `doubler-lash-*` removed;
  - `lash-*` move onto the heads, with a `bolt` joint: 4 #8-32 × 1-3/4" stainless machine screws, nylocks, 3/4" fender washers outside.
  - All of them are bandsawn from 4/4 offcuts (no Shaper file), epoxied after the deck is in. Drill through the side with the plate as the template. The box tie is glued at the box install step.
- **Analysis:**
  - **New `side-lateral` row:** this beam-on-strips model with the rib springs. Details: the gunwale band bending, the web's across-grain bending at the chine top, the deck-line cross-grain stress, the rib bending, and the knee screws, under (a) and under the strap at `lashLoadLbf`. It also reports the 50 lbf deflection against a 1/8" "feels solid" limit (info, Eric's criterion).
  - **`lash-load`:** becomes through-bolt tension, washer bearing and rib bending.
  - **`side-web`:** uses the across-grain values.
  - **`cargo-strap`:** text names the new stations.
- **Cut list, BOM and assembly:** 6 ribs, 4 knees and 2 spacers; the bolts replace 24 #8 × 1-1/4" wood screws. The assembly step follows the deck install. A DECISIONS entry (the next D-number) records the choice and the station rule.
