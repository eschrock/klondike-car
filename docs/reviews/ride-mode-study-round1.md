# Ride-mode study: engineering critic, round 1

Subject: `docs/ride-mode-study.md` (BRIEF §4.3a, D-49). Reviewer scripts: `/private/tmp/claude-502/crit/a.mjs` (plain node, closed form, independent of the study's scripts). No source or doc was edited other than this file.

## Grade: 6 / 10

The physics core is competent and mostly reproduces. The architecture reasoning (Concept A over B) is directionally right. But the study is not yet sound enough to choose from, for four reasons. (1) It frames the hard problem as steering architecture when the dominant safety problem is that tire-ground friction on a 15 degree slope cannot support braking at 10 mph on wet leaves, and the brake cannot survive 15 degrees anyway. (2) Concept A's headline claims ("dissolves", -11 lb) are not like-for-like with B. (3) It misses the rider-safety layer entirely (belt, helmet, ejection and rollover, night, reaction time, hand fatigue). (4) It contains several checkable numeric slips. Fixing these is a rewrite of §0, §4 and §5, not new research. Expect 8 after one round.

## 1. Numbers I reproduced (study is right)

| Item | Study | Mine |
|---|---|---|
| 10 mph on 15 degrees, Crr 0.03, +5% inertia | 2.1 s, 15 ft | 2.08 s, 15.3 ft |
| Hold force, 344 / 394 lb | 78 / 89 lbf | 79 / 91 lbf |
| Brake energy per 100 ft | 10.5 / 12.1 kJ | 10.7 / 12.3 kJ; 1.57 / 1.80 kW |
| 10 mph KE (344 lb) | 1.56 kJ | 1.56 kJ |
| Strike, 1.5 in step, k = 3,000 lb/in (both wheels), m = 129 lb | ~2,200 H / 2,700 V | 2,275 H / 2,739 V |
| Pulse maps back to today's x3 | 1.5-2 mph | F is proportional to v, so 10/6.2 = 1.6 mph. OK |
| SSF 0 degrees, 150 lb | 1.238 | 17.59/14.21 = 1.238 |
| Lateral accel at 8 degrees steer, 10 mph | 0.26 g | 0.256 g |
| Rear-only on 15 degrees nose-down | N_r 52%, cannot slow | N_r 179 lb, mu 0.5 limit 89 lbf vs 79 hold: 10 lbf spare = 0.03 g. OK |
| Ideal Ackermann, 8 ft edge radius | outer 27.9 / inner 41.3 | inner = 41.29 for outer 27.9. Rectangular-tire edge radius at outer 28 = 97 in. OK |
| Shoe flash temperature (semi-infinite, oak e = 550) | 340 K at 1 s, char at 0.5 s (2 shoes) / 2.1 s (4) | 353 K, 0.5 s, 2.0 s. OK |
| Wagon damper c = 80-130 lb.in.s/rad (zeta 0.3-0.5) = 0.4-0.65 kN.s/m on 6 in | OK | 78-130; 385 N.s/m at the low end. OK |
| Ackermann per-wheel wn ~9 Hz, zeta ~0.26 | ~9 Hz, ~0.3 | 9.1 Hz, 0.26. OK (but see D-3) |
| Pitch-over at a 3 in step | "no pitch risk" | Angular momentum about the step contact gives 222 J of rotation vs 719 J needed to tip over the contact. Confirmed. |

## 2. Errors and unjustified assumptions

**E-1. Inner-wheel ride lock is wrong.** §5 says bump stops at "8 degrees outer / 12 degrees inner". Ideal Ackermann (L 44, kingpin spacing 33) gives **8.9 degrees inner** for 8 degrees outer (12 degrees inner is outer ~10.7). The real 3 in / 20.5 degree trapezoid gives 9.3 at 10 degrees. A 12 degree inner stop would let the outer wheel reach ~11 degrees, beyond the "no more than 10" the study itself recommends.

**E-2. The wagon-vs-Ackermann torque ratio is stated three ways.** The table says 23,000 vs 1,300 lb.in (17.7x), §2.5 and §5 say "roughly 9x". The ratio is 17.75 in divided by the scrub/contact offset, which the study sets at 1 in. A 4 in wide tire can strike on its edge, so the force line can be 2-3 in from the kingpin axis. Honest range is 6x-18x (1,300-3,900 lb.in per knuckle, 430-1,300 lbf on a 3 in arm). The qualitative conclusion holds; the number to quote is ">= 6x". The tie-rod load at 3 in offset (1,300 lbf) is borderline for kart 5/16 in rod ends, so "kart tie rods are rated for this" is not safe to claim at the top of the range.

**E-3. Concept A mass is inconsistent.** Table lines: removals 23.5 + 6.5 = 30.0; additions 4.0 + 2.0 + 2.0 + 1.5 + 1.4 + 1.4 + 4.5 = 16.8. Net **-13.2**, not "about -11" (169 to 158), and §2.5 says "about -18". Removing 30 lb from a "steering group" the checkpoint lists at 25.4 lb also needs reconciling (the axle rod and bolster are probably outside that group). More important, **A carries no mass for surviving the 10 mph strike** (wheel upgrade to 600 lb rating, rear axle, rear beam seat and rails all show 2-4x in the study's own §1.5 table), while B is charged +8-15 lb for exactly that. Compare like for like.

**E-4. "The open front-end problem dissolves" is overclaimed.** What dissolves is the stops/turntable/ear weldment. The same 1.5 in, 10 mph pulse still lands on the front beam, kingpin bolts, spindle and bearings, and the study has no numbers for them (it defers "a new check family"). My bound on a **3/4 in stub axle**: resultant wheel force ~1,250-1,800 lbf at 2-2.5 in from the root is 60-110 ksi bending stress (3/4 in solid S = 0.0414 in^3). That is at or beyond the yield of 1045 / 1018 (54-77 ksi); a 5/8 in kart stub (S = 0.024) is 100-190 ksi, a clear fail. Wheel bearings (3/4 in bore flanged ball, static rating of order 1,000-1,900 lbf) are brinell-marginal at the same load. The study lists "wheel is the fuse" but never says the **axle/spindle/bearing** are too, in A or B, front or rear. Kart-class spindles are not realistic as-is for a 10 mph / 1.5 in design strike; a lawn-tractor/ATV/trailer spindle with a 3/4-1 in forged stub and a published rating is, but weighs more. State this and drop "kart" as the definition.

**E-5. Friction range omits the project's own wet-leaf value.** D-16 sets mu = 0.5 (damp dirt) and ~0.3 (wet leaves). The study's tables run 0.35-0.7. At mu 0.3 on 15 degrees even a perfectly proportioned four-wheel lockup gives only mu.cos(15) - sin(15) = +0.031 g (+0.03 g more from Crr, so ~0.06 g, 55+ ft from 10 mph). At 0.2 it is negative: **no wheel brake can slow the cart**. At 0.35, best case 0.11 g, 32 ft (matches the study's best cell, which already assumes perfect proportioning). This is a Georgia winter camp (BRIEF §3: no snow), but wet leaves and red clay are the likely condition. The study's "15-17 ft on 15 degrees with 50% front bias" is the mu 0.5 best case, not a design number.

**E-6. Stopping distance omits reaction time.** At 10 mph a 1 s reaction is 14.7 ft, and on 15 degrees the unbraked cart is at 15 mph by then. Realistic stop is ~45-50 ft at mu 0.5, not 15-17 ft. The table should say "braking distance after brake onset".

**E-7. Front brake geometry on Ackermann is not feasible as written.** "Front shoes pivot on the beam at (41.5, +/-16.5)" cannot work when the wheel steers 41 degrees about a kingpin ~8 in from the tread contact point: the tread swings out from under a beam-fixed shoe. The shoe has to ride on the knuckle (kart spindles have a brake-mount boss, which is a genuine argument for A that the study missed) or the front brake must be a disc/caliper on the knuckle. Brake-steer (brake torque reacting on the tie rod and then into the rider's hand) is not addressed.

**E-8. Strike model sensitivities (2x off).** Peak F scales as sqrt(k.m_e), and linearly in v.

| Assumption off by 2x | Effect on 1.5 in, 10 mph H (base 2,275 lbf) | Conclusion changes? |
|---|---|---|
| k = 1,500 (or 6,000) lb/in total | 1,600 (3,220) | No: still 3.3-6.7x today |
| m_e = whole cart (344 lb) vs front 129 | 3,715 | No, worse |
| m_e = 60 lb (true pitch-inertia mass for the vertical pulse; the rigid cart pivots about the rear axle) | 1,550 H / 1,870 V | Vertical figure is overstated ~30% |
| v = 5 mph | 1,140 / 1,370 | Yes, helps: 2.7-3.5x today. This is the single largest lever and the study never offers it |
| Tire not bottoming (stiffer-pressure tire, k ~ 400/wheel) | ~1,175 (k = 800) | Reduces to ~3.5x |

Duration is 33 ms (half-period of 94.8 rad/s), not the "about 10 ms" in §1.4. A 33 ms, 6 g pulse is milder on the rider than stated; the vertical component into the seat (~2,700 lbf on a 344 lb cart) is not assessed at all.

**E-9. Heat model sensitivity.** Time-to-char scales as 1/q^2. If the partition is 50/50 instead of 70/30, or the real contact area is half of nominal (a flat shoe on a curved tire, no conformity), char time moves 4x either way: 0.5-8 s for four shoes. The conclusion (tread shoes cannot hold 15 degrees) survives; the quoted "2.1 s / 30 ft" should be a range. Wood is also ablative: realistically it wears rather than sits at 250 K, with smoke and a fire concern near cargo.

**E-10. Damping claim for Ackermann is optimistic.** At 10 mph the wheel turns at 4.3 Hz, so first-harmonic wheel/tire runout excites 4.3 Hz and the second harmonic 8.6 Hz, which **coincides with the 9 Hz Ackermann steering mode at exactly the design speed**. Cheap 13 in pneumatics have visible runout. The quasi-steady tire model (c = C.t^2/v) also overestimates damping at 9 Hz because tire relaxation length (~half the radius) puts the tire corner at ~5 Hz. The wagon's 1.5-2.5 Hz mode would be excited at 3.5-6 mph (in the 2x margin of the ride envelope as well). Conclusion "Ackermann settles in one cycle" should be "plausibly damped but the wheel-speed harmonic needs a bench check; add play-free tie-rod ends, bushed kingpins and a damper option for A as well".

## 3. Answers to the assigned questions

### 3.1 Physics
Sound where it is closed form (table above). The big unjustified step is treating mu in 0.35-0.7 as the design range for a "design for 15 degrees" requirement (E-5). Also unjustified: the 15 degree sustained run needs a brake that survives, which the study itself shows it cannot, so the headline "10 mph held on 15 degrees" is not a design condition that any option achieves; it is a condition that decides what the cart may not be used for (see 3.3).

### 3.2 Is "Ackermann with a tongue for tow mode" sound?
- **Kinematics: yes.** Drawbar-driven Ackermann with a tie rod and a bellcrank is standard (steerable farm trailers, wagon gears). The 3 in / 20.5 degree trapezoid gives outer 29.6 vs ideal 27.2 at inner 40 degrees (2.4 degrees of excess toe-out in tow; fine at 3 mph). Outer 28 / inner 41.3 gives a 97 in tire-edge radius, so 8 ft is reachable, but with **zero margin** on the stub steering stops: kart spindles commonly limit at ~25-30 degrees; the 41 degree inner angle must be verified against the spindle's arm/stop, tie-rod end misalignment and tire clearance to the beam.
- **How the tongue steers:** the hinge at the beam center turns the pull into a pitman/bellcrank to the tie rod. Pull loads pass into the beam, steering only sees the angle: good. Self-centering is **not** the wagon's: with no tire side force at rest or at walking pace there is no centering, and a tongue lying on the ground drags (z 5.5 in vs 3.5 in clearance rule). Bridle-on-beam-ends is gone; the ropes would go to the tongue tip, and pulling toward a downhill cart means the cart pushes the tongue in compression. A rigid tongue does not slack like a rope. Needs a bench test of drift and jackknife on the downhill (the study lists this as a risk; keep it).
- **Missing interlock:** the stick and the tongue both drive the same bellcrank. Tow with the stick connected and the stick whips at the rider's hip and knee; ride with the tongue connected and a 17 in spear swings +/-25 degrees ahead of the nose. The study says "removable" but a mode change needs positive disconnects (pins that cannot be left in) or a keyed mode lock.
- **Realism of purchased spindles:** a kart front carries about the same static load (~65-75 lb per wheel), so statics are plausible. The 10 mph strike (E-4) is not. Use an explicitly rated lawn-tractor/trailer spindle or accept replacing a bent spindle after a hit. Prefer a design where the beam (steel angle plate), not the spindle, is the structural fuse.
- **Buildability without welding:** the spindle itself is bolt-on, but the kingpin carrier is normally a welded ear on a tube. In a wood/steel beam this needs a bent-plate U or a purchased bolt-on mount, otherwise the weldment returns (outsourced weld under D-46). Say that. "No welding" is not established.

### 3.3 Framing: is a 10 mph rider-steered design speed the right frame?
Eric said "up to 10 mph". The study treats 10 mph as a **held** speed, but its own results show the brake sets it, the cart reaches 10 mph in 2 s, and a brake that fades in 0.5-6 s lets it reach 25 mph in 100 ft. So the real design question is **what bounds the speed when the brake does not**, and the study never asks. Specific points:

- **Steering is the wrong thing to spend most effort on.** For "keep it straight" the load-bearing requirement is directional stability plus a brake that cannot be defeated, not steering authority. A rigid-axle cart with the ride lock pinned at 0 degrees (the wagon locked straight, "aim by the pullers or rear handler at the top, then release the rider to brake only") was never considered, yet it is the simplest candidate for "minimal steering" and it eliminates the shimmy and the 23,000 lb.in kingpin torque for ride mode. Its weakness is cross-slope drift and no swerve; the study should say so and cost it against ±8 degrees. A third option, ±5 degrees with two bungees and rope reins, is B with less authority.
- **A speed rule beats a larger structure.** Strike force scales with v (row v = 5 mph above: ~1,150 H), heat flux with v, KE with v^2. A procedure of "max 5-6 mph, walking pace beside a handler for anything over 10 degrees or wet leaves, ride-only on a signed run" cuts the load ratio from 5-8x to ~2.5-4x today, which is within reach of the present structure plus a lock and a damper. Brake energy per distance is speed-independent, so it does not solve fade (4 shoes then last ~60 ft instead of 30); it helps strike and crash loads.
- **Slope/friction go/no-go table is needed**, not a single 15 degree row. From my numbers the best-case braking decel on a slope is mu.cos(s) - sin(s) + 0.03: 15 degrees works only at mu >= ~0.4, 10 degrees needs mu >= ~0.25, 8 degrees at mu 0.3 gives ~0.19 g. State the ride envelope as slope x mu.

### 3.4 Candor and completeness (what is missing)
1. **Brake fade and runaway.** No rule for what happens when the shoes char: cart goes from 10 to 25 mph in 100 ft with a child aboard. Needs: a fail-safe (rear handler tether to a person who can plant, a drag/skid device, or a hard speed rule), a stop-and-cool rule, and a statement that fade is a rider-safety condition, not a maintenance item.
2. **Hand fatigue and hold.** The rider must hold 23-26 lbf on a hip lever for the full descent (about 7 s per 100 ft, a minute-plus on a long slope). For a 10-12 year old with 60-70 lbf grip this is ~40% of MVC, fatiguing in 1-2 min; lever release equals runaway. Suggest a ratchet "set" position the rider can trim, with a dead-man trade-off analysis, and size the emergency stop (0.25 g on 15 degrees needs ~175 lbf, i.e. ~50 lbf at the grip, not 15-26 lbf).
3. **Parking brake on 15 degrees:** rear-only hold needs 89 lbf of friction vs 89.4 available at mu 0.5 (178 lb on the rear x 0.5): no margin, and zero at mu 0.3. The ratchet cannot be trusted on a slope without the front brake set too.
4. **Rider restraint and rollover.** No lap belt, no roll protection, head at 35-45 in above ground in a box with ~20 in sides, a 4.5 mph sideways slide hooking a rut flips it (the study's own §2.2). Add: lap belt or retained-rider design, helmet as mandatory in ride mode (BRIEF §4.7 says "recommended"), no loose limbs outside the hull.
5. **Frontal crash and foot entrapment.** The only crash case is a 1.5 in step. The rider's legs are stretched forward with feet at x 38-47 against a foot stop, knees at 21 in. A head-on obstacle at 10 mph delivers rider KE ~680 J (150 lb) into feet and knees. Angular-momentum pitch-over is not a risk, but feet driving into the stop is. The tire-sweep zone ahead of the shins (x 27-50) also needs a foot guard.
6. **Night.** The event is a timed race in the dark (BRIEF §3). A 1.5 in root is exactly what a rider at 14.7 ft/s cannot see with a headlamp. Lights, and the argument that ride mode is daylight-only, belong in the study.
7. **Vertical load on the rider.** The pulse is 2,700 lbf vertical at the front, no suspension, a foam seat. Estimate seat g and spine load.
8. **Kickback to the hand.** A stick with a 2:1 angle ratio and a 14 in lever turns a 1,300 lb.in knuckle torque into ~45 lbf at the grip, a whip into the rider's wrist. The ride stops must be solid, and the cables must not be the stop.
9. **Option C absent:** a purchased, rated fifth-wheel/steering kit (checkpoint §3(c)) for the wagon; the study dismisses B on its current stack-up rather than on what a rated swivel could do.
10. **Procedure and authority.** Council/troop rules on riding wheeled sleds downhill, adult spotters, helmet and supervision. One sentence.
11. **No confirmation the wagon is dead.** D-46 shows the *present* front end fails at tow loads for any rider. The study is right that this needs a rebuild, but should say that this, not ride mode, is the first reason to leave the turntable.

## 4. Does the recommendation hold?

Concept A **still stands as the better steering architecture**, but not for the reasons the study gives. It holds because: (a) the 17.75 in lever arm is removed, so a one-wheel hit does not load a turntable; (b) steered inertia drops ~35x; (c) the already-failing stops/ring rows vanish; (d) the nose gets wider; (e) knuckle-mounted spindles also give a place to put a front brake. It does **not** hold as "dissolves the front-end problem, -11 lb": the 10 mph strike is still on the front beam, spindle, bearings, rear axle and rails, and A needs that mass and a rated spindle. Its tow-mode and front-brake mechanisms need redesign (E-7, interlock).

More importantly the study should not be the basis for choosing an architecture until it states the operating envelope. Without a speed/slope/mu rule and a brake that is allowed to fail safely, either concept is unsafe on the stated 15 degree, 10 mph, wet-leaf worst case; choosing A or B changes shimmy and structure, not that.

## 5. Concrete fixes to the study (to reach 8)

1. Rewrite §0 headline: lead with the envelope (slope x mu table, braking decel = mu.cos - sin + 0.03), then "steering architecture".
2. Add mu = 0.3 (D-16) and 0.2 to §4.2; give stopping distance with a 1 s reaction column.
3. Correct E-1 (inner lock 8.9 degrees, or specify outer 8 / inner 9), E-2 (quote the torque ratio as 6-18x), E-3 (mass arithmetic -13.2 vs -11 vs -18, add strengthening mass for A), and §1.4 (pulse 33 ms; vertical effective mass).
4. Add a 5 mph row to the strike table and a "speed procedure" option next to the rows in §6.
5. Add the **axle/spindle/bearing** strike check (E-4) for both concepts and say which spindle class is required; drop the unqualified "kart spindles are rated".
6. Fix the front brake geometry (shoes or disc on the knuckle; kart spindle brake boss), and discuss brake steer.
7. Add a mode-change interlock for tongue vs stick.
8. Add Option C (locked-straight wagon, brake only, aimed by handler) and Option D (purchased rated fifth wheel), cost them against A and B.
9. Add a Rider-safety section: belt/restraint, helmet mandatory, rollover, foot entrapment, night, hand fatigue and hold/trim, kickback, fade runaway, fail-safe.
10. Decision list §6: put "what limits speed when the brake fades" first, before architecture.
11. Replace single-point heat numbers with ranges (E-9); add the wheel-speed resonance caveat (E-10) to §2.4.
12. Keep honest the claim "stability does not favor Ackermann": that is the study's best sentence.
