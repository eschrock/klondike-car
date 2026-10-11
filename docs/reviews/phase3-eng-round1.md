SCORE: 6/10

# Phase 3 engineering critic, round 1

Scope: Phase 3 detail design at `main` (16f1546). `npm test` 798 pass, `npm run typecheck` clean. Numbers below are my own hand calcs plus throwaway perturbation runs of `runChecks(defaultParams())` (temp scripts deleted). The work is broad, honest in its notes, and the checks are mostly well-derived. The score is held down by four items where the check passes only because of an assumption I do not believe (stop load share, dowel allowable, cleavage allowable, stop mounting), and by the "cheap" turntable fix, which makes things worse.

## 1. M1–M11 status

| # | Verdict | One-line reason |
|---|---|---|
| M1 stops | **Partial** | Steel faces, radial faces (r_eff 4.43" vs 3.0"), check exists and passes at 0.78. But the pass rests on a 60/40 share that cannot be built (MF-1), and the dogs cannot be attached as modeled (MF-2). |
| M2 kingpin peak | **Done, allowable overstated** | The rigid-pin derivation is correct (verified below). The 1,700 psi allowable is not (MF-3). |
| M3 pitch path | **Partial** | Check exists, numbers are trivial (3.5 psi, 79 lbf leg). The stated path ("plate margins between the bolster rails") is not a defined bearer; see S-4. |
| M4 cleavage | **Partial** | Delivered a block-shear plug check at 850 psi, which the notes admit is "not NDS cleavage". It is 3–4× unconservative (MF-4). |
| M5 finger gap | **Partial** | Guard covers top and rear only; the open forward wedge remains (S-5). |
| M6 bridle ties | **Done** | Eye bolts through the beam face, 10.5 of 18 ksi. Rope mock-up still open. |
| M7 bolster bolts | **Done** | Structured `bolt` joints read by `roll-bolster-attach`; yaw couple added (3.5 of 10.4 ksi). |
| M8 front U-bolts | **Done (front only)** | Legs around the beam, plate below. Rear clamps are still mass-only boxes (`running-gear.ts:135`). Margins thin (S-6). |
| M9 lift | **Done, rating stale** | Slots exist. Per-person load is 68.5 lb at 50/50 and ~74 lb at the rear, not the 62 lb in D-37 (S-7). |
| M10 nut access | **Done** | |
| M11 specs | **Done** | Recorded in `sourcing`/`notes`. |

## 2. Must-fix

### MF-1 (High) The 60/40 stop-load share is not achievable; design for share ≈ 1 or make the faces compliant
Files: `src/params.ts:702` (default 0.6), `src/analysis/front.ts:49,63–66`, `front.ts:149–151` (kingpin-peak ignores the stop reaction), D-31.

- **Run results.** At share 0.8 `steer-stops` fails (util 1.71: net kingpin 1,299 lbf vs 759; washer 371 vs 358 psi). At share 1.0 it fails at 2.52: face 429 psi (1.20), washer 463 psi (1.29), net kingpin load 1,910 lbf. The 1,910 lbf is the worst alignment: stop reaction and wheel force add when the stiffer stop is the right dog.
- **Why 60/40 cannot hold.** Wood-on-steel face stiffness, with E⊥ ≈ 200 ksi and about 1.5" of oak behind the face:
  - compliance at the design 258 psi is about 0.0019", so k ≈ 480 kip/in per stop;
  - for the stiffer stop to take only 60% of T/r_eff = 1,528 lbf, the mismatch must stay under 306/480,000 ≈ **0.0006"**;
  - a 0.005" mismatch (CNC tolerance, or oak movement over a few % MC) gives ΔF = 2,400 lbf, more than the whole load, so one stop takes 100%.
- **Flat contact is also fragile.** 0.5° of face misalignment is 0.024" over the 2.74" face. Oak crushes about 0.002" at design pressure, so only ~8% of the face engages and the local stress rises ~10×. The model assumes a perfectly flat face-on-face contact (triangular distribution).
- **Impact is not captured.** The yaw is a swing into the stop. The one-wheel strike torque acts through 37° of rotation: ½·I·ω² can reach several thousand in·lb against a stop with ~0.002" of compliance. The 3× factor is the only cover.
- **Fix (cheap).** Bond ¼" of 70–80A urethane to each dog steel face (a stop bumper):
  - per-stop stiffness ≈ 1,500 psi × 4.7 in² / 0.25" ≈ 28 kip/in, 17× softer;
  - a 0.005" mismatch then gives ΔF ≈ 140 lbf, share ≈ **0.55**;
  - crush at 917 lbf ≈ 0.033" (≈0.4° of extra lock; negligible);
  - it takes up a 0.5° misfit (0.024"), so the face engages fully, and it soaks the impact energy.
- **Check changes.**
  - Keep share 0.6 as the basis only with the pads.
  - Add a bounding row at share 1.0 that must at least not break the pin (it fails today).
  - Feed Kvec into `kingpin-peak` (`front.ts:149`), which currently uses H = max(strike, pull) only. Without that, a share above ~0.7 silently overloads the pin.
- **Single stop at a larger radius (your question).** It is more robust against fit-up, but the kingpin sees F ± H_w, adding in the worst case. T = 6.7 klbf·in gives:

| Stop radius | F | Kingpin load (worst) | vs. 759 lbf strike |
|---|---|---|---|
| 7" | 967 lbf | ~1,350 lbf | 1.8× |
| 10" | 677 lbf | ~1,060 lbf | 1.4× |
| 13" (beam end) | 521 lbf | ~900 lbf | 1.2× |

  No single stop within the bolster opening is better than a compliant couple. Keep the couple.

### MF-2 (High, buildability) The dogs sit on the chassis-side plate and "bolt through the turntable plate and beam"
File: `src/model/stops.ts` header, `steering.ts`, D-31 "Limits".

- In the model the dog spans z 7.25–8.97, standing on the **top** plate (z 6.88–7.25), which is the chassis side. Bolting it through that plate into the beam either locks the bearing or needs arc slots through the plate inside the ball-track radius (dog radii 2.91–5.65" straddle a ~9" ring). No stock 12" lazy susan has that.
- The stop is the M1 deliverable, so this cannot be a vendor "ask" at Phase 4.
- **Fix.** Choose one before the checkpoint:
  - (a) mount the dogs to the beam outside the plate footprint (the end rails currently occupy |y| 6–7.56", so this needs the opening widened);
  - (b) specify a custom open-center plate with arc slots, and re-check the ring and the pitch couple;
  - (c) put the dog on the chassis crossbar and the stop blocks on the beam (swap the sides; the kinematics are symmetric).

### MF-3 (Medium-High) kingpin-peak allowable 1,700 psi is overstated 22–56%
Files: `src/analysis/structure.ts:28`, `src/params.ts:1220` (4,000 psi), `front.ts:158`.

- **NDS Table 12.3.3, white oak G = 0.68.** Fe⊥ = 6,100·G^1.45/√D (D ≥ ¼"), so G^1.45 = 0.5717:

| Diameter | Fe⊥ | Fe∥ = 11,200·G |
|---|---|---|
| 0.75" (pin) | 4,027 psi (the "4,000" in the repo) | 7,616 psi |
| 1.25" (sleeve OD, the real bearing diameter) | **3,119 psi** | |

- The oak sees the sleeve OD, not the pin.
- The **beam** governs: grain along y, load along x, so Fe⊥. The crossbar grain is along x, so it uses Fe∥ (peak 1,108 vs ~2,700 psi, fine).
- **Corrected allowable.**
  - Repo factors (0.85 / SF 2): 3,119 × 0.425 = **1,326 psi**, so goal util 1.00, operating 0.85.
  - NDS dowel wet factor 0.7: 3,119 × 0.7 / 2 = **1,092 psi**, so goal 1.21 and operating **1.03 (fails the operating rider)**.
- **Rigid-pin derivation verified.** Same Winkler slope in both members, force H and zero net pin moment give s = 12·H·a_c/Σ and q_peak = (H/D)(1 + 6·a_c·D²/Σ). I got 5.44× (beam) and 3.24× (crossbar) at D1 = 2.5", D2 = 1.78", g = 0.375". The hand integral matches `rigidPinMoment`.
- **What actually reduces the peak.** A deeper crossbar (+0.25") gives only −6%. +0.5" of beam depth gives −14% for +1.8 lb.
- **Fix.** Use D = sleeve OD in the allowable and say whether the owner accepts local 5%-offset embedment at the 3× event. Relabel the row marginal at goal. Record it in D-32.

### MF-4 (Medium-High) kingpin-split is not a cleavage check and is 3–4× unconservative
Files: `src/analysis/front.ts:236–250`, `structure.ts:25` (850 psi).

- The beam front ligament is loaded ⊥ grain: the pin pushes a 0.75" slab off the front along the grain. That is splitting (tension ⊥ grain), not plug shear.
- 850 psi is a clear-wood mean (2,000 × 0.85 / 2). NDS design Fv for oak is ~205 psi, and the cleavage rule is V_r = (2/3)·F_v'·b·d_e:
  - beam, d_e between 0.75" (edge to bore) and 1.375" (to the bore center), b = 2.5": **256–470 lbf** (CD 1.0), 512–940 lbf (impact, CD 2.0), against **759 lbf** demand, so util **0.8–1.5** against the repo's 0.24;
  - crossbar side ligaments, b = 1.78", d_e = 1.5": 365 lbf (CD 1) against 243 lbf demand, so 0.67 (fine).
- **Fix.** Add two fore-aft ⅜" stainless cross-bolts with fender washers flanking the bore (y = ±2") to stitch the front slab, about 0.2 lb. Replace the beam row with the NDS cleavage form. Move the 850 psi rows to "web shear-out" only.

## 3. Should-fix

| ID | Sev | Where | Problem and number | Fix |
|---|---|---|---|---|
| S-1 | Med | `checks.test.ts` H1, H2, M3, M4, H3 (WS-A notes) | These now compute expected values with the same hand formulas as the code, so they cannot catch a formula error. | Re-pin literal numbers from an independent calc at the final mass, or add one literal anchor per check. |
| S-2 | Med | turntable 0.97 / kingpin-strike 0.95 | See §5. The 1,500 lb preset alone is **worse**. | Preset 2 **plus** `frontDeckRaiseIn` 0.5 → 0.75. |
| S-3 | Med | `analysis/brake.ts:115`, `model/brake.ts` | The brake geometry is not "solved to the target" as the spec asked. The ratio falls out of three fixed params. A 12" wheel gives `brake-ratio` 1.03 (fail) with no re-solve. Mud/snow μ 0.25 needs 32 lbf (operating) and 37 lbf (goal) against the 30 lbf limit; the shoe is on the rear-lower tread, the wettest quadrant. | Face the pads with woven brake lining bonded to the oak (μ_wet ≥ 0.35 gives 26.5 lbf at goal). Solve the lever tail from the target ratio, or compute it for the wheel diameter. |
| S-4 | Med | `front.ts:174–218`, D-32 | The pitch couple is placed on the plate margins "between the bolster rails". The beam/turntable plates are separated by the ball ring, so the margins are not in contact. The real path is the ball race plus kingpin-bolt tension (the beam is not moment-clamped). The numbers are still tiny: with my sign convention the beam needs 1.0·H (759 lb·in) from the plate, not the 0.875·H used, and ~72 lbf couple force at 10.5" / ~170 lbf at the ring against a ¾" grade 8 bolt. | Re-describe the path as ball track + preloaded kingpin nut (castle nut, no preload on the bearing) and check bolt tension and ring uplift; or add real fore-aft pads. |
| S-5 | Med | `body.ts` guards, D-37 | The guard shields from above and behind only. The wedge between the tire's inner sidewall and the nose side opens forward, exactly where scouts grab the prow or lantern. At lock the neck is 0.76", inside the 0.25–1.25" finger-entrapment band, with rope-driven force. A 0.25" printed ASA hood 5.5" deep can flex under a boarding foot. | Extend the guard into a full fender wrapping the forward side (or stop the lock to open the neck to 1.5"). Make it 3/8" ribbed or nylon. |
| S-6 | Med | `running-gear.ts:119–137`, `layout.ts` | The axle rod is **flush** with the beam top (z 6.875, groove depth = rod dia 0.75"). The U-bolt bridge then bears on the beam top, not the rod, unless the groove is shallower. The front nuts are the lowest point at 3.60" against 3.5" (0.1" margin; a nyloc nut is 3.56"). Rear U-bolts remain placeholder boxes. | Groove depth 0.70–0.72". Let the plate into the underside or use ¼" plate for +0.125–0.375". Specify low-profile nuts and cut studs flush. Draw the rear U-bolts. |
| S-7 | Med | D-37, `hull.test.ts:278`, no `runChecks` row | Lift per person: 137.1/2 = 68.5 lb, but the CG is 18.4" ahead of the rear axle with transoms at x = −10 and 51.5", so the rear lifter takes ~54% = **74 lb**. D-37 quotes 62 lb. One-hand lift ×3 = 221 lbf gives 5.3 ksi (0.82). The BRIEF/Phase 2 figure was 58 lb. There is no lift row in the checks list. | Add a `lift` check with CG-weighted shares. Consider a second slot per end, or a web handle through the slot, so each person has two hands. |
| S-8 | Med | `kingpin-peak`, D-34 | Kingpin sleeve: bore ID is honed +0.003" for a ¾" bolt, but a standard grade 8 hex bolt has ~1.75" of thread, which would sit in a honed sleeve and gall. | Call out an unthreaded-shank length ≥ 4.7" (a ground shoulder bolt or a ¾" clevis-type pin with a drilled nut end). |
| S-9 | Low-Med | `analysis/seat.ts` lash check | `lash-points` only counts D-rings. The 300 lbf rating is a note, not a check; the gunwale is ½" oak with ¾" blocking. | Add a screw-withdrawal / gunwale-bending check at 300 lbf at 45°. |
| S-10 | Low-Med | brake lever | Hand-pull abuse: members are sized at 37 lbf at the handle (2× the hold). A scout hanging on the lever with 100 lbf gives tail shear 1,630 vs 1,700 psi (wet ultimate). | Add a 100 lbf abuse row (shear and key shear, util ≤ 1); steel tail plate if it fails. |

## 4. Brake mechanism details (your item 2)

- **Ratio formula verified.**
  - N_tot/F = (l_grip/d_Q)·(d_S/k), with l_grip = 23.07", d_Q = 1.90", d_S = 1.89".
  - Forward: k = |Kn + μKt| = |1.53 − 0.245| = 1.285", so 12.14 × 1.471 = **17.86:1**. Reverse: k = 1.77", so **12.99:1**.
  - In `brakeGeometry`, `tFwd` = (−sinβ, cosβ) is up on the rear flank, and rolling forward drives that flank upward (clockwise wheel, rear point moving up). The friction therefore drags the shoe into the tread, so **forward = servo, backward = de-servo**. The code's direction is right.
  - The hold math matches: 372.8 × sin15° / 0.4 / (13.0 × 0.8) = 23.2 lbf.
  - Self-lock needs μ ≥ 2.5, margin 6.3×; no grab risk.
- **Shaft.**
  - Torsion is only 5.1 ksi (util 0.25). Bending + torsion is 24.8 ksi (0.71) and key shear is 8.1 ksi (0.78).
  - A ½" shaft passes torque but fails overhang bending at 78 ksi. A 7/8" × 0.125" DOM tube saves 1.6 lb but a ³⁄₁₆" keyseat is 75% of the wall; it only works with clamp hubs. **Keep the solid ¾"** unless you move to clamp hubs.
- **Bushings in plates.** Bronze 558 psi of 3,000 and bolts 330 psi on oak. Sound.
- **Ratchet.** Tooth bearing 4.0 of 16.2 ksi, root shear 1.3 of 10.4 ksi. At 0.85" of grip travel per tooth (about 0.065" at the pad) the resolution is fine. The span covers 20° against 17.4°, which is about 0.22" of wear or tire-pressure change (0.52" total stroke vs 0.30").
- **Clearance sweep.** 9 poses, 0.158" minimum, to an ideal cylinder; a real crowned tire at low pressure bulges 0.2–0.4". The 0.29" released pad gap is smaller than tire OD tolerance (±2% = ±0.13" radius), so add an assembly gap spec of 0.1–0.15".
- **Shoe on the rear-lower tread.** It is the part of the tread that just left the ground: mud, water, slush. The lowest brake parts are at 3.59–3.65", which is also the rear overhang's first contact on crests. Wet μ is S-3.
- **Parking.** `brake-traction` is 1.03× nose-down on 15° at μ_ground 0.5 and 0.62× on wet leaves. The owner has accepted this (D-24); I would still require a wheel chock in the kit list and a "chock, don't trust the brake on a slope" label.

## 5. Marginal rows and the Simple view (your item 5)

Safe rider range is now 50–210 lb (green to 170 lb); `turntable` is the limiter at 210 and fails at 220.

| Option | Safe / green | Mass | Notes |
|---|---|---|---|
| Base | 210 / 170 | 147.8 | Turntable 0.97, kingpin-strike 0.95 (crossbar bore bearing 342 of 358 psi). |
| Preset 2 (1,500 lb) alone | **180 / 150** | 149.3 | The 0.5" stack thins the crossbar (1.78 → 1.65"). `kingpin-strike` fails at 1.035 and the validator warns the deck needs 9.60". **Do not do this alone.** |
| `frontDeckRaiseIn` 0.75 alone | 200 / 170 | 148.7 | Crossbar deeper, `kingpin-strike` drops off the flags, `turntable` 0.98 limits. |
| **Preset 2 + deck raise 0.75** | **230 / 190** | 150.3 | `kingpin-strike` 0.90 is then the limiter. Only +2.5 lb. **Recommended.** |
| Sleeve 1.5" OD | – | – | The validator rejects it (web 0.375", beam too narrow). |

- `turn-radius` (93.4 of 96") and `steer-clear` (0.75 of 0.70") are geometry margins. `steer-clear` is marginal by construction (the guard hood sits at the clearance floor). I would accept both, but not call 0.05" of tire clearance a margin.
- Raising lock to 35° pushes turn radius to 96.9" (fails).

## 6. Seat, guards and lash points (your item 3)

- **Seat back.** The 0.5 torso share × 3 × weight = 300 lbf at goal is a reasonable envelope. A static back load at 15° recline is ~25% of body weight and a hard pull is 0.4 g × 3. Stud pull of 246 lbf per stile against a 400 lbf allowable (insert ultimate ~1,200) is credible for 3/8-16 inserts in oak. The cleavage of the cleat from the box end is not an issue: the stud squeezes the end wall.
- **Not checked: the foot stop.** A curb strike decelerates the cart at about 2 g. 200 lb × 2 g × share on the oak 0.75 × 4 × 13 foot stop is ~200–400 lbf, held by 4 #10 screws and two glue lines. This is the most likely rider-facing load and it has no row.
- **Lift slots.** The bar over the slot is 4.9–5.3 ksi (0.76–0.82). The transom-to-hull joints (blind tenons 3/16") are fine for 220 lbf.
- **Finger guards.** They stop the top and rear entry only (S-5).
- **Lash points.** Count only (S-9).

## 7. Mass (your item 4)

147.8 lb empty and 137.1 lb transport, against 127 / 117 at Phase 2 (+20.8). By group: running gear 51.0, body 29.7, steering 13.8, brake 12.3, storage 10.5, frame 10.5, seat 8.7, hardware 5.4, removable 4.7, lighting 1.3.

**Delta.** A (steering) +3.6, B (hull) +0.6, C (brake) +8.6, D (fittings) +5.2, integration +2.8 (hardware computed 4.8 vs 2.5, storage +11%, blocking).

**Biggest items.** `deck-cabin` 10.3, `beam-F` 9.05, `beam-R` 5.69, four wheels 22.0, two axles 10.1, `brake-shaft` 4.9, `transom-rear` 3.82.

**Structure is tight.** I tried to cut the structural members:

| Change | Result |
|---|---|
| Deck 12 → 9 mm | `deck` fails (1.15) |
| Rail depth 3 → 2.5" | `rails` fails (1.16) |
| Rear beam to 2.0" | Validator error (leg wood 0.63") |
| Joist spacing 8 → 10" | −0.5 lb, `deck` 0.77 |

**Safe cuts** (check margin after):

| Cut | Saves | Margin after |
|---|---|---|
| Delete `storage-bottom`: box walls on the deck, epoxy fillet, drains through the deck | ~2.0 lb | No structural row changes; interior grows 0.24" in height. |
| Aluminum 6061 handle sockets, same 1.25 × 1.75 × 0.125 tube (isolate from oak tannin) | 1.5 lb | `handle-sockets` stays 0.28 (the oak post governs). |
| Joist spacing 10" (4 → 3 cabin joists) | 0.5 lb | `deck` 0.49 → 0.77. |
| Phase 4: lighter hub wheels, or rear stub axles (D-10) | 2–4 lb / ~2.9 lb | Stubs need beam bearing re-check. |

Net of the realistic Phase-3 cuts: **~4 lb**, so ~144 lb. Anything beyond that is the lightweight variant (D-21).

## 8. Not covered by the checks (your item 6)

- Rope tails (8 ft, tied low) near the front tires; the rope-to-tire mock-up is a build task.
- Cross-shaft ends at y ≈ ±19.5" and U-bolt thread ends at 3.6": sharp points at shin height, no caps.
- Brake lever / ratchet pinch: 0.27–0.5" lever-to-gunwale/quadrant gaps sit in the finger-entrapment band.
- Prow: 18" lever arm on two ¼-20 inserts. 50 lbf at the tip is 900 lb·in, about 600 lbf at the upper insert, above a typical ¼-20 pull-out. Scouts will grab it; label it "not a handle".
- No rider restraint and no foot-stop row (§6).
- Parking nose-down on wet ground: `brake-traction` 0.62×.

## 9. Phase-4 items

Verify vendor lazy-susan plate stiffness; test 6% bent-lam spring-back strip; weigh a hardware set (4.8 lb is an estimate); rope mock-up; urethane stop pads and urethane durometer test; clamp-hub brake shaft option; rear U-bolt drawing; wheel and tire source; foot-stop check; lift row.
