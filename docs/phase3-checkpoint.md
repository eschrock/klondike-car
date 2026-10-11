# Phase 3 checkpoint (2026-10-11)

Phase 3 (detail design) has run its three critic rounds. Final grades:
- **Visual 8/10:** passed.
- **Engineering 7/10:** below the bar of 8.
- **Buildability 6/10:** below the bar of 8.

Per the workflow, the remaining MUSTs come to Eric rather than a fourth round. Reviews: `docs/reviews/phase3-{eng,build}-round3.md`, `visual-round3.md`.

## 1. Where it stands

| | Phase 2 | Phase 3 r2 | Now |
|---|---|---|---|
| Empty mass | 127 lb | 160.6 lb | **169.0 lb** |
| Safe range (Simple view) | | to 200 lb | 50–210 lb, green to 170 |
| Tests | | 918 | 1,104 |

**The 210 lb figure overstates the design.** The engineering critic found two problems the app does not yet reflect:
1. **Stop stand:** the overturning arm is understated 3–5×. The critic's hand check fails at 150 lb.
2. **Turntable ring:** it is at 118% of the repo's own margin at 150 lb, but shown as info only.

Fixing either means the honest answer is **"150 lb not yet proven"** until the front end and turntable are reworked. Nothing has been pushed, so the live site still shows the older version.

## 2. Weight: 169 lb against the 60–70 lb target (heavy-first, D-21)

By group, in lb:

| Group | Mass |
|---|---|
| Running gear | 50.8 |
| Body | 33.4 |
| Steering | 25.4 |
| Brake | 16.0 |
| Frame | 13.3 |
| Seat | 9.0 |
| Storage | 8.8 |
| Hardware | 7.5 |
| Removable | 3.6 |
| Lighting | 1.4 |

Biggest single items: four 13" pneumatic wheels 22.0, the two solid steel axle rods 10.2, cabin deck 10.0, front axle beam 9.0, fasteners 6.9, brake cross shaft 6.5, rear transom 6.2, turntable 5.5, kingpin carrier plate 5.1.

Reduction options. The masses are rough estimates; each needs a re-run of the checks.

| Option | Saves (est.) | Cost |
|---|---|---|
| 10" wheels instead of 13" | 6–8 lb | Rolls worse on rough ground; less tip margin |
| Tube axles or stub axles instead of solid rods | 5–7 lb | Re-check axle bending |
| Thinner or lightened cabin deck | 3–5 lb | Deck deflection check is close |
| Drop the storage box (soft bag instead) | ~8 lb | Loses the weatherproof box (BRIEF §4.9) |
| Commercial wagon fifth-wheel instead of the plate kingpin and stops | 5–10 lb | Needs a vendor part rated for the strike |
| Lighter brake (smaller abuse load, or a simpler drag brake) | 3–5 lb | Lower abuse margin |

## 3. Front end: the biggest open problem

The plate-kingpin front end (D-43, D-46, D-47) has cost about +11 lb since round 1. It still depends on three things a home shop cannot promise:
- shim fit-up to 0.018";
- urethane pad stiffness;
- welded shear ears sharing 40% of the load.

If the ears share nothing, or the pad is soft, even 150 lb fails.

Alternatives:
- **(a)** Stiffen it so it passes with the ears sharing nothing. Also widen the pads (more area, not thickness), and make a Phase 4 bench test a go/no-go gate. Smallest change; adds mass.
- **(b)** A turntable bearing built from steel plates and a UHMW thrust ring, which also fixes the ring rating.
- **(c)** A purchased wagon fifth-wheel or steering kit with a published rating. It replaces the stops, plates and lazy susan.

**Recommendation:** look at (c) first, because it removes most of the fragile parts. Otherwise do (a) + (b).

## 4. The curved hull (D-45): what it costs to build

It reads as one hull and you chose it. The buildability critic says it moved the hard part from "what holds this together" to "can this be made". Its four MUSTs:
1. Engineered laminations: a two-sided form, about 7 plies of 3/32" strips with the grooves built into the lay-up, and a test bend.
2. Chine-to-rail joints on the curve (the Dominos there cannot be cut).
3. Scarf joints placed in straight runs.
4. Fab-shop specs for the welded parts.

Fixing them is real but bounded work. The alternative is the angled straight shoulder, which removes the laminations but looks faceted.

## 5. Decisions needed

1. **Rider-limit wording.** The critic suggests: "150 lb verified, comfortable to 170, 200 is an unproven goal", once the MUSTs land.
2. **Front end:** (a)+(b) or (c) above.
3. **Welding:** three welded parts (shear ears, stop stand, brake pivot post). Outsource them to the steel service, or redesign them as bolted parts.
4. **Curved hull:** keep it and fix the lamination process, or fall back to the angled shoulder.
5. **Weight:** which reductions to take, if any.
6. **Sign-offs carried from the handoff:**
   - Brake grip travel is now 5.7" (was 6.4"); it needs a feel test.
   - Steering-stop load sharing.
   - The turntable choice (see §3).
7. **Design asks from the visual pass:**
   - **Prow:** dropped, done.
   - **Grab handles:** green steel U-tubes instead of oak (D-40)?
8. **Open questions:**
   - Q-5: is the sign wording "TROOP 455 / WILDERNESS RANGERS"?
   - A wheel chock in the kit.
   - The rear lifter now carries 83 lb in one hand.
   - The truck bed is not yet measured.
   - Vendor data that blocks the order: turntable plate and moment rating, wheel load rating, pad durometer, brake lining.

## 6. Proposed next step

Fix the engineering MUSTs that make the app tell the truth, before anything is pushed:
- correct the stop-stand arm;
- gate `turntable-ring`;
- quote the range honestly.

Then carry out Eric's choices on the front end, the hull and weight, with one more engineering and buildability critic pass. Phase 4 (build outputs) starts after that.

**Decision IDs:** D-43 is still a stub. D-44 to D-48 are proposed (🔶) and need sign-off.
