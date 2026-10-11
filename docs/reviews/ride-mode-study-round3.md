# Ride-mode study: engineering critic, round 3

Subject: `docs/ride-mode-study.md` revision 3. Independent scripts: `/private/tmp/claude-502/crit/{a,b,c}.mjs`. Only this file was written.

## Grade: 8 / 10 (round 1: 6, round 2: 7)

The study is now sound enough for the owner to choose an architecture and an operating envelope from. The envelope table, worst-bias GO table, handler capacity, shoe duty-cycle and seat-load numbers all reproduce. Concept A at about +7 lb, with D as the wagon-keeping fallback, is a defensible recommendation. The remaining errors are in the new fail-safe hardware (the drag blade cannot do what is claimed; the belay has no shock-load or attachment check) and in the wheel-rating spec, not in the architecture comparison. They should be fixed in the text, but none changes which concept to pick.

## 1. N-items from round 2

| # | Item | Status | Note |
|---|---|---|---|
| N-1 | Tether not credible | **Fixed**, two new defects | Capacity table is right; belay and blade alternatives added. Blade physics wrong, belay shock load unchecked (D1, D2) |
| N-2 | Rule vs table, camp mu test | **Fixed** | Worst-bias table matches mine to 0.01 g in all 25 cells. Test method is sound (D6 nit) |
| N-3 | Duty cycle tied to shoes | **Fixed** with one physical error | "Release and let the cart roll while cooling" is wrong at 15° (D3) |
| N-4 | Concept C pins | **Fixed** | Radius rods are a good solution; checks below |
| N-5 | Itemize +11 lb | **Fixed** | Itemized to +15.6; sums right (D4 nit on the wheel rating) |
| N-6 | Rear-strike seat load | **Fixed** | Derivation clean and reproduces |
| N-7 | Stub resultant, kingpin | **Fixed** | 1,780 lbf; 86-97 / 36-41 / 148-167 ksi reproduce |
| N-8 | Rollover, dark race | **Fixed** | Both stated plainly for Eric |

## 2. Numbers re-checked

| Item | Study | Mine |
|---|---|---|
| Handler capacity W_h(mu.cos - sin), 150 lb | 62/32 (5°), 53/24 (8°), 48/18 (10°), 34/5 (15°) lbf at mu 0.5/0.3 | 62/32, 53/24, 48/18, 34/4.7. Identical |
| Hold needed | 20, 38, 50, 79 lbf | 19.7, 37.6, 49.6, 79 |
| Belay capstan, 1.5 turns, mu 0.3 | e^(0.3x3pi) = 17x; 79 -> about 5 lbf | 16.9x; 4.7 lbf |
| Worst-bias GO table (min over front share 0.4/0.5/0.6) | e.g. 15°: -0.01, 0.09, 0.16, 0.22, 0.27 | Identical in every cell. Simple rule (mu >= 0.4 to 8°, >= 0.5 to 12°, >= 0.6 at 15°) follows |
| Camp test | 0.5 reads 85 lbf empty, 172 loaded | 84.5, 172 |
| Duty cycle, tread shoes | 30 ft (7-120) at 15°, 80 ft (20-330) at 10° | 2.1 s x 14.7 = 31 ft; 0.5-8 s = 7-118; 5.6 s = 82; 1.4-22 s = 20-323 |
| Lined shoes (flux halves, x4 time) | 125 ft (30-480), 330 ft | 123, 29-470, 323 |
| Drum/disc 7-27 K per 100 ft | | 24 K at 0.9 kg steel; OK |
| Rear-strike seat load | Δv 1.6 m/s, 3.8-4.9 g mean, 5.9-7.7 g peak, 900-1,150 lbf | 2.2 m/s x 32/44 = 1.6; 4.9 / 3.8 g; half-sine peak x pi/2 = 7.7 / 6.0 g; 1,155 lbf. Deck 0.86 x 7.7/3 = 2.2. Reproduces. A dynamic-response-index estimate gives about 6-7 against the usual ~17 limit, so "tolerable with belt and helmet" holds |
| Concept C rod load | 28,500 / 16 = 1,780 lbf | Correct and conservative (a couple of two rods at 16 in is 890 each; one rod unloading in compression, 1,780 is the safe bound). 1 in x 0.083 in tube at 17.5 in: Pcr about 23,700 lbf, stress 7.2 ksi. Fine |
| Mass package | 4.0+3.9+1.2+2.4+1.5+1.8+0.8 = 15.6 | 15.6. A -8.7 + 15.6 = +6.9 (176). B 35-42, C 33-39, D 24-32 all sum correctly |
| Rear 1 in axle vs 3/4 in | +3.9 lb for 36 in | 1.17 lb/ft x 3 ft = 3.5 lb; immaterial |

## 3. Things the study still gets wrong (the owner must know)

**D1. The runaway blade cannot do what the study claims (must fix).** §1.3 says the blade must carry "198 lb (57% of the cart's weight)" at blade mu 0.4 to supply 79 lbf. A blade on the rear transom about 15 in behind the rear axle cannot load that high. With the rear wheels lifted and the front wheels rolling free, moments about the front contact patch limit the blade normal to (W.cos15 x 27.5 - W.sin15 x 14.2)/59 = **about 133 lb**. That gives at most **53 lbf at mu 0.4 and 40 lbf at mu 0.3**, i.e. 50-65% of the 79 lbf needed, even with the rear wheels fully unloaded. The blade is a supplement that shaves speed, not an arrester. Say that, drop the "make up the 79 lbf" claim, and either size it as part of a combined fail-safe (blade plus whatever the shoes still do) or leave the belay as the only arrester above 8°.

**D2. The belay is the right idea but its loads are unchecked (must fix).** (a) A runaway that has reached 25 mph (9.8 kJ) and is caught on a rope with 10-20% stretch over 100-150 ft sees a snatch of roughly 400-500 lbf (my estimate with a 15 ft stretch; a stiff rope is far worse). The existing tether attachment is a D-39 socket checked at **50 lbf**; the study's 79 lbf static hold alone is already above that. Require a dynamic (nylon) rope, a rated attachment at the rear structure with a stated load (say 600 lbf ultimate), and a fuse-free path. (b) The anchor must hold the snatch (tree, not a stake in soft ground). (c) A rope trailing 100-200 ft behind a rider snagging on brush is a new hazard; state a rope-handling rule. (d) The handler-capacity table is static; a runaway adds a shock the handler (or belayer's anchor) does not feel as 79 lbf.

**D3. "Release and let the cart roll while cooling" is wrong on a slope.** §5.3 says with tread shoes "up to 30 ft of 15° per brake application, then release and let the cart roll while cooling". On 15° a released cart accelerates at 0.22 g (4.4 mph per second); it does not cool, it speeds up. The only place to cool is stopped and parked with both axles locked (and the parking ratchet holding 166 lbf, §5.4). Rewrite: tread shoes at 15° are a "stop-and-park every 30 ft" rule, which in practice means 15° is not a ride-mode slope with oak shoes.

**D4. The wheel rating is not enough by the study's own method.** The rule is "wheels >= 600 lb rated" (allowance = 2 x rating = 1,200 lbf peak). The study's own per-wheel vertical is 1,370 lbf at the front and about **1,750 lbf at the rear** (3,500 / 2). Both exceed 1,200. Needed rating by the same convention: front >= 685 lb, rear >= 875 lb. Common 8 in cart wheels top out near 600 lb. Either require about 900 lb wheels (pneumatic 4.10/3.50-6 with steel rims rated higher, or a heavier 10 in size, with their mass), or state that the wheel rim is the sacrificial fuse at the design strike and the owner accepts a bent rim after a 1.5 in hit at 10 mph. The +4.0 lb in the package assumes a 600 lb wheel.

**D5. Concept A's pin and stub numbers are sizing estimates.** The kingpin row uses H x trail (1.5 in) for pin bending, which is not the right arm (the lever is the yoke bearing spacing plus the scrub offset acting on V); the result (utilization 0.55) is plausible but untrustworthy. Mark it as sizing only and put the yoke/boss checks into the Phase-4 check family. No numeric rating exists yet for 1 in stub tractor/ATV spindles; the vendor question is the true gate for A.

**D6. Smaller points.**
- The camp friction test measures slow sliding mu; wet surfaces lose mu with speed (at 10 mph perhaps 10-20% lower). Add "derate the measured mu by 0.05-0.1 for 10 mph" or just require the measurement to clear the GO threshold by 0.1.
- Handler capacity assumes a 150 lb handler who also keeps pace at 10 mph downhill; at 10° and 0.5 the table says "marginal" (48 vs 50 lbf): treat it as "cannot", so the plain tether is a 5-8° tool.
- The rollover acceptance (§6) is stated; the hoop (about 3 lb) is not in any total. Fine as long as the owner reads the line.
- The 8 ft tow radius at 41.3° inner has zero margin on the spindle stop; the study correctly flags this as gating.

## 4. Is the recommendation sound enough to decide from?

Yes.
- **Envelope.** Correct and consistent: GO needs mu >= 0.4 to 8°, >= 0.5 to 12°, >= 0.6 at 15°; wet leaves are CAUTION at <= 8°; damp dirt makes 15° the edge, not a GO. With oak tread shoes a 15° run is not a ride-mode run at all; tell Eric that in the first paragraph (the study does say it in §5.3).
- **Fail-safe.** Plain tether: help at <= 8° only. Belay: the real arrester on steep runs, after D2 is fixed. Blade: supplement only (D1). "Walk it down" remains the primary rule above the table.
- **Architecture.** A on rated 1 in spindles at about +7 lb (176 lb) is credible and cheaper in mass than every alternative (B +35-42, C +33-39, D +24-32), with the gate being a rated spindle and a 41.3° inner stop (or a 9 ft radius). D is a fair wagon-keeping fallback pending a vendor moment rating. C, now with radius rods that short-circuit the yaw path at 1,780 lbf, is a legitimate "minimal steering" option; it is the most constrained geometry (0.8 in tire clearance) and should be bench-checked. B is rightly rejected.
- **Safety.** Belt, helmet, daylight-only, rollover acceptance and 7.7 g seat load are all stated. The explicit caveat that ride mode is off for the dark race is exactly what the owner needs.

## 5. Remaining must-fixes (text only)

1. Rewrite the blade paragraph: max normal about 133 lb, drag 40-53 lbf, a supplement not an arrester (D1).
2. Add a dynamic-rope, snatch-load and rated-attachment requirement (about 500 lbf design) to the belay and flag that the D-39 sockets (50 lbf) are insufficient (D2).
3. Replace "release and let the cart roll while cooling" with "stop and park both axles to cool" (D3).
4. Fix the wheel rating to about 900 lb or call the rim a fuse; update the +4.0 lb line (D4).
5. Mark the kingpin row as sizing-only and add the camp-mu derate note (D5, D6).
