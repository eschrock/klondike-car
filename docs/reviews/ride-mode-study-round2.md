# Ride-mode study: engineering critic, round 2

Subject: `docs/ride-mode-study.md` revision 2. Reviewer scripts: `/private/tmp/claude-502/crit/{a,b}.mjs` (independent, closed form). Only this file was written.

## Grade: 7 / 10 (round 1: 6)

The revision fixes nearly everything I raised, and the new numbers reproduce. The envelope-first framing is the right one. It is not yet at 8 because the new fail-safe (the tether) is not physically credible as written, the headline envelope rule contradicts the study's own table, the duty-cycle rule contradicts its own heat table, and Concept C's pin geometry does not fit the hull. All five are text and arithmetic fixes, no new research. After those, an 8 is likely.

## 1. Status of my 12 round-1 fixes

| # | Fix | Status | Note |
|---|---|---|---|
| 1 | Lead with envelope (slope x mu) | **Fixed** | §0, §1.1 |
| 2 | mu 0.3 / 0.2 and reaction time | **Fixed** | Reproduced (below) |
| 3 | Inner lock 8.9 deg, torque ratio 6-18x, mass arithmetic, 33 ms pulse, vertical mass | **Fixed** | A table now sums to -8.7 (I get -8.7). The +11 lb package is not itemized (N-5) |
| 4 | 5 mph row and speed rule | **Fixed** | 1,140 H / 1,370 V reproduces |
| 5 | Axle/spindle/bearing check, drop "kart rated" | **Mostly fixed** | Resultant understated (N-7) |
| 6 | Front brake on the knuckle, brake steer | **Fixed** | 40 lb.in per wheel is reasonable |
| 7 | Tongue/stick interlock | **Fixed** | Shuttle plate with a lanyard pin is sensible; needs one more sentence on a stuck-in-between position |
| 8 | Options C and D | **Partial** | Costed, but C's pins do not fit (N-4) and D is unquoted (honestly flagged) |
| 9 | Rider-safety section | **Mostly fixed** | Belt, helmet, night, fatigue, kickback, parking all present; gaps in N-6 and N-8 |
| 10 | Decision list, envelope first | **Fixed** | Item 1 contradicts the table (N-2) |
| 11 | Heat ranges, 8.6 Hz coincidence | **Fixed** | Duty-cycle rule not reconciled (N-3) |
| 12 | Keep "stability does not favor Ackermann" | **Fixed** | Still stated |

## 2. Re-checked numbers

| Item | Study | Mine |
|---|---|---|
| Envelope table, practical bias 0.5 and rear-only brackets | e.g. 15 deg: 0.22 g (mu 0.5), 0.05 (mu 0.3); 8 deg mu 0.3: 0.17 | Identical to 0.01 g in every cell (rear-only 15 deg mu 0.5: 0.03; ideal 15 deg mu 0.3: 0.06) |
| Stop with 1 s reaction, mu 0.5, 10 mph | 26 / 31 / 35 / 41 / **53** ft (rear-only 305 at 15 deg) | 26 / 31 / 35 / 40 / 52 (rear-only 300) |
| mu 0.3, 15 deg / 10 deg, 10 mph | 183 / 59 ft | 175 / 58 ft |
| 5 mph at 15 deg, mu 0.5 / 0.3 | 26 / 84 ft | 25 / 80 ft |
| Runaway from 10 mph, 15 deg, 50 ft | 19 mph | 20.3 mph with drag; 25 -> 26.6 mph at 100 ft. Claim holds (18.5 mph from 5 mph; study 19) |
| Strike package charged to all, Concept A | -8.7 + 11 = about +2 lb | Arithmetic consistent; B +27-34, C +28-35, D +15-24 all sum correctly. The +11 is an assertion (N-5) |
| Kickback 44-160 lbf | 44-160 | 44-163 (T/(2.1 x 14 in)). OK |
| Emergency grip ~50 lbf | 38-50 | 47. OK |
| Parking, both axles set | 166 lbf, 1.9x | 166, 1.87x. OK |
| Seat load 3.4 g mean / 5 g peak | 1.1 m/s in 33 ms | 3.4 g mean follows from 1.1 m/s; the 1.1 m/s itself is not derived (N-6) |
| 1 in stub, 1,000-1,500 lbf at 2-2.25 in | 20-34 ksi | 20-34 at those inputs; but see N-7 |
| Pin load for pinned-straight at 16 in | 1,800 lbf | 28,500/16 = 1,780 arithmetically; the geometry is infeasible (N-4) |

## 3. New problems (must-fix before the owner decides)

**N-1. The tether is not a credible fail-safe as stated (MUST).** §1.3 makes the rear-handler tether the answer to runaway on slopes over 8 deg and asks the handler to hold "roughly W.sin(theta) = 89 lbf". A handler can only push back as hard as their own footing allows. A 150 lb person on a 15 deg slope can generate at most W_h.(mu.cos(15) - sin(15)): about 34 lbf at mu 0.5 (45 lbf for 200 lb) and nothing at mu 0.3 (they slide first), while also keeping pace at 10 mph downhill. Net pull needed is 79 lbf. So on exactly the slopes where the tether is mandatory, one handler cannot arrest the cart. Fix: either (a) state that the tether only helps below ~8 deg (or at 5 mph) and the real control above that is "do not ride", (b) require an anchored/belayed or two-handler arrangement, or (c) design a passive fail-safe (ground-drag blade, which §1.3 leaves "not designed here"). Also the "call tether" procedure does not work if the handler cannot hold the load. Say this plainly.

**N-2. The headline rule contradicts the table (MUST).** §8 item 1 says ride "where it shows GO: mu 0.5 up to 15 deg; mu 0.3 up to about 8 deg". By the table's own definition (GO >= 0.2 g), mu 0.3 at 8 deg is 0.17 g CAUTION; GO at mu 0.3 ends around 5-6 deg. Also, 15 deg at mu 0.5 (0.22 g) is only just GO and depends on a front share of 0.5 +/- small: at 0.4 or 0.6 the earlier study gave 0.16-0.19 g, i.e. CAUTION. And nothing tells the camp how to know mu. Fix: restate the rule consistent with the table, add the bias tolerance as an assumption, and add a **field test the rider's adult can do in a minute** (cart empty, wheels locked, release on the run: if it slides, mu < tan(slope); or slide a loaded cart on the real surface). Without that, "who judges mu" (the study asks it) has no answer.

**N-3. The duty-cycle rule contradicts the heat table (MUST).** §1.3 rule 3 permits "about 100 ft of continuous 15 deg"; §5.3 says four tread shoes reach 250 K in 0.5-8 s (nominal 2.1 s = 31 ft at 10 mph, 15 deg). 100 ft is 6.8 s, beyond nominal and 6x past the pessimistic end. The 100 ft figure only works with lined, steel-backed shoes (flux halves, nominal about 8 s) which is still an open decision (§8 item 6). Fix: tie each duty-cycle number to the shoe option (tread shoes: about 30 ft of 15 deg, about 80 ft of 10 deg; lined shoes about 4x that), and state that without the lined shoes the 15 deg run is effectively a short-hop rule.

**N-4. Concept C's pins do not fit (MUST for C).** §7.3 locks the steering "by two pins at the beam ends (radius about 16 in)". The hull is only +/-6.4 in wide at the nose (§4.1), the beam ends are in the tire zone, so a pin from a beam end to a hull stop does not exist. A stop at the real available radius (about 3.6-7 in, like today's stand) carries 28,500/7 = about 4,000 lbf, 2.3x the claim, and that is the load the failing `steer-stops` rows already cannot carry. Fix: recompute C with a feasible pin radius (or a bracket across the tire sweep) and say whether the existing stand fails first. Until then C is not "simplest" but "unproven".

**N-5. The +11 lb strike-survival package is unitemized (MUST for the mass claim).** Concept A's "+2 lb" and the A-vs-D gap rest on it. Itemize: rated wheels (or 600 lb), 1 in rear axle (adds about 1.1 lb/ft over 3/4 in, about 3.5 lb for 36 in), bearings, rear beam/rails reinforcement, belt anchors (§6 adds a through-bolted anchor load), foot guard. Also check double counting with A's "+3.0 beam upgrade" and "+6.0 spindles with 1 in stubs". Add the belt and foot guard masses.

**N-6. Seat load from a rear-wheel strike is not assessed.** §6 computes 5 g peak from the front pulse only. The rider's H-point is x = 12 in, about 12 in ahead of the rear axle; a rear-wheel strike moves the seat by about 0.7-0.75 of the axle. With rear load 215 lb the same pulse method gives about 4,600 lbf normal, about 3,500 lbf vertical, roughly 7-8 g peak at the seat. Still survivable for a short pulse with a belt and helmet, but it is the worse case and the 750 lbf figure should be re-derived (the 1.1 m/s is not shown). Also add a spine/neck note for a belted rider in a pitch.

**N-7. Stub stress uses too small a resultant.** §2.4 uses 1,000-1,500 lbf per wheel. The base pulse gives 1,140 H and 1,370 V per wheel, a resultant of about 1,780 lbf. At 2-2.25 in: 3/4 in stub 87-97 ksi (not 48-81), 1 in stub 36-41 ksi. The 1 in conclusion survives (SF about 1.9 on 1045 yield) but the "3/4 in at or beyond yield" is stronger than stated, and the kingpin bolt and spindle yoke are not checked at all. Update the numbers.

**N-8. Smaller points.**
- Belted rider in a rollover: with the head 35-45 in above ground over a hull about 20 in high, a belt keeps the head in the roll path. §6 says "no roll bar; belt plus helmet" without analysis. Either accept it explicitly for a daylight, envelope-limited run, or cost a hoop. It is a one-sentence decision for Eric.
- A dark-race use: §6 makes ride mode daylight-only or <= 5 mph with a 500 lumen lamp ("26 ft at 5 mph" equals the stopping distance, zero margin). Tell Eric directly that during the 7 pm event ride mode is effectively off.
- The envelope assumes the brake works for the whole run; it should be paired with §5.3 as above.
- Tongue downhill push is flagged; add that a push-through tongue cannot be allowed on slopes the envelope calls CAUTION.
- Spindle stops at 25-30 deg vs 41.3 inner (zero margin) could force the 9 ft radius; flagged, keep it as a gating vendor question.

## 4. Is the revised recommendation sound enough to decide from?

**Envelope first: yes, with the N-2 and N-3 corrections.** It is the study's strongest contribution, the numbers are right, and it correctly shows the real hazard is friction and brake fade, not steering architecture. The speed rule (10 mph on smooth signed runs, 5 mph elsewhere) is well supported: strike force halves and braking distance quarters.

**Tether mandatory above 8 deg: no, not as written (N-1).** A single handler cannot hold the cart on the slopes where it is required. Rewrite so the safe statement is "ride only where the table is GO and the run is short enough for the brake; above that, walk it down", with the tether described as a help at modest slopes and 5 mph, not a runaway stopper.

**Concept A on rated spindles, D as fallback: yes, as a choice of architecture.** My independent checks agree: the 17.75 in lever arm is removed (torque ratio 6-18x), steered inertia drops about 35x, the stops/ring/ear weldment goes, the front brake mounts naturally on the knuckle, and net mass is now honestly break-even or better (A +2 lb vs B +27-34, D +15-24) once the same strike survival is charged to all. The new text is honest that A does not remove the strike. Cautions the owner should hear: the +11 lb is not yet itemized; the 8 ft tow radius at 41.3 deg inner has no margin on any commercial spindle stop, so a 9 ft decision may be forced; the tongue and the 8.6 Hz steering coincidence are unproven and need a bench test. C is a legitimate "minimal steering" option only after N-4; given Eric's clarification and that the study itself calls it credible, the owner should see it as a real cheaper alternative with a feasible-geometry caveat rather than as a footnote.

## 5. Remaining must-fixes (to reach 8)

1. Rewrite the tether claim (N-1).
2. Make §8 item 1 match the table; add the bias tolerance and a camp skid test for mu (N-2).
3. Tie each duty-cycle distance to the shoe option (N-3).
4. Re-do C's pin geometry and load, or mark C unproven (N-4).
5. Itemize the +11 lb strike package and the belt/foot-guard masses (N-5).
6. Add the rear-wheel seat load (N-6) and use the 1,780 lbf resultant in §2.4 (N-7).
7. One sentence each on belted-rollover acceptance and "ride mode is effectively off during the dark race" (N-8).
