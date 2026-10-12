# Phase 3c-4a notes: front-axle fixes (proposed D-58)

Author: the 3c-4a agent. Status: code, analysis and tests are done; `DECISIONS.md` and `STATUS.md` are NOT edited (the coordinator pastes the text below). Final state: `npm run typecheck`, `npm test` (37 files, 1250 tests), `npm run build` and `npm run build:single` are green.

Owner preferences used throughout: no welding, no custom steel, simple billy-cart practice, walking pace, weight-sensitive.

## Results at the defaults

| Question | Answer |
|---|---|
| Rows failing for the 150 lb rider, the 200 lb rider or the 200 lb cargo case | None. Rows near the line (marginal, still passing): turn-radius 0.98, front-beam 0.99 (cargo), tip-straight 0.93 (cargo), rear-beam-seat 0.91 (cargo), bearing-groove 0.90 (cargo) |
| Rider safe range (no red) | 50 to 220 lb (open at the light end) |
| Rider green range (no yellow either) | 50 to 200 lb |
| What turns heavier riders red | `deck` (standing scout deflection of the 12 mm ply between joists), 230 lb and up |
| Cargo capacity | 205 lb (target 200); limiter `front-beam` (0.99 at 200 lb); comfortable (all green) up to 158 lb |
| Resting weight (`rest-load`, new) | FAILS: holds 223 lb at rest, target 250 lb. See "Resting weight" below for the one-joist fix |
| Cart mass (empty, no payload) | 145.6 lb. By group: running-gear 26.4, front-end 20.2, frame 13.5, body 42.5, removable 3.7, seat 10.3, storage 8.4, hardware 5.6, brake 13.2, lighting 1.9 |
| Overall width | 39.5 in (was 40.5 in); set by the front axle ends |

## Proposed D-58 text

**D-58 (3c-4a, Eric 2026-10-11): front-axle fixes, tighter tracks, cargo 200 lb, resting weight**

1. **Roll restraint (was king-bearing 11x to 20x).** The one-wheel roll couple no longer goes through the thrust washer. Two UHMW roll pads (2 x 3 x 5/16 in, 11 in either side of the kingpin) lie on the axle beam top and slide under the frame rails with a running gap of 0.0875 in (limits 0.03 to 0.125 in, set with tape under the pad). Pad force = M cos(a) / y; the pressure on the rail underside is checked against the oak perpendicular allowable over the whole +-20 degree swing (the rail curves in toward the bow). The kingpin carries only any shortfall (none in a 1 in bump). The thrust disc is 3 in OD x 9/16 in UHMW and carries the vertical load only (27 psi static).
2. **Oak tongue, lifted by the body.** The 3/16 in steel tongue plate (bent about its thin axis, 3.7x over) is replaced by a white-oak tongue set ON EDGE: 1.5 in thick x 2 in deep, a 6 in wide head bolted to the front face of the beam with two 3/8 in carriage bolts, a 3 in taper to a 1.5 in stem, a bronze sleeve at the shackle hole 1.5 in from the tip. The shackle pin (1/2 in) is the intended weak link (util 0.59, D-47). `lift` now lifts the nose through the body (bow bulkhead hold), not the tongue.
3. **Steering stops are check chains.** The hanging oak stop blocks pried the joist underside to 4x to 11x its bearing stress at any lever below a 1.5 in joist. A 1/4 in chain with an eye bolt through each end of the axle beam and one through a 1.5 in "chain joist" just behind the king beam goes taut exactly at the 20 degree lock (right chain at +20, left at -20). Chain tension = torque / lever / cos(rise); the eye bolt is derated for the pull angle; hard hits use ultimate / 1.25. Util 0.34 (0.53 at 250 lb cargo).
4. **Steer-clear >= 1/8 in** at every gap (axle beam under the rails 0.40 in, clamp plates under the king beam 3/16 in, tongue under the disc 3/16 in, taut chain 0.74 in). The king beam sits on the disc, 9/16 in over the beam top.
5. **Front beam sized for 200 lb cargo without adding mass:** 2.5 x 2.25 in, stub 8 in, clamp plate 1.5 in; util 0.86 (goal) and 0.99 cargo. **Rear beam seat:** the oak hangers are 7/8 in (was 3/4 in); util 0.88 and 0.90 cargo (the 3/4 in hanger fails the 200 lb cargo case at 1.05).
6. **Tighter tracks (Eric).** Front track 34 1/2 in (was 35.5): the true minimum for the 20 degree lock with the 3/4 in tire margin is 34.28 in; 34 3/8 in clears by only 0.80 in (marginal band), so the next 1/8 in, 34 1/2 in (0.855 in), is the default. Rear track 32 in (was 35.5). Tip angles, 40 degree limit, worst steer (before 35.5/35.5 -> after 34.5/32): 150 lb rider 50.8 -> 48.6; 200 lb rider 49.4 -> 47.2; 200 lb cargo 44.7 -> 43.0 (marginal, passes); 250 lb cargo for the record 43.2 -> 41.6. Slide-before-tip 150 lb 1.23 -> 1.14 (needs 0.75). Overall width 40.5 -> 39.5 in; truck fit unchanged (beside in all three configurations). Brake rows unchanged (brake-slow 15.7 degrees at 150 lb, brake-clear 0.22 in).
7. **Brake (Eric).** The scooter step brake is a "just in case" slowing brake. `brake-slow` is the pass/fail brake row and drives the Hills light; the 15 degree hold force (`brake-force`, 85 / 98 / 104 lbf against a 90 lbf yardstick) is an INFO row (no light color). `park-hold` (the chock) is unchanged. The Simple view says the flaps slow the cart up to N degrees and to chock a wheel or have someone hold it on steeper hills.
8. **Cargo target 200 lb** (`cargoPayloadLb`, locked, "Eric 2026-10-11").
9. **Resting weight (Eric).** New `rest-load` Structure check: an adult of `restLoadLb` = 250 lb (assumed) sitting still anywhere, or standing on one foot (4 x 10 in) anywhere on the deck, at STATIC load (no bump factor, full safety factors), on the deck ply, joists, rails, both axle beams, stubs, wheels and the front pivot. It reports one number for the Simple view ("Holds a N lb adult sitting or stepping in", rounded down to 10 lb). It is not part of the rider sweep.
10. **Storage lid is NOT strengthened.** The top is engraved DO NOT STEP (CNC V-carve or laser, 1.5 in letters, 0.03 in deep, black epoxy or paint; `Part.legend` on `storage-lid`), and the lid is left out of `rest-load` for that reason, said in the row text.

## Resting weight: the one failure, and its lightest fix

At 250 lb everything passes except one detail: **standing on one foot on the widest 10 in joist bay deflects the 12 mm ply past span/180 (util 1.12)**. Max resting weight 223 lb. Everything else is at or under 0.74 at 250 lb (wheel 0.74, king beam 0.42, deck ply bending 0.37, joists 0.44, rails 0.44, axles 0.33/0.19, stubs 0.25).

I did NOT strengthen anything for this (instruction). Options, lightest first:

| Option | Mass | Max rest | Rider safe / green | Notes |
|---|---|---|---|---|
| Crossmember spacing 8.5 in (one more joist, 8 instead of 7) | +0.84 lb | 289 lb | safe 50 to 250+, green 50 to 210 | Fixes the same weak spot the `deck` rider row shows at 230 lb. Recommended. Cargo capacity unchanged (205). |
| Accept a looser static deflection limit (span/150) for a standing adult | 0 | 359 lb | n/a | A policy change, not a design change; Eric decides. |
| 1/2 in ply (0.5 in instead of 0.472 in) | +0.72 lb | 265 lb | | Marginal, odd thickness. |
| 9/16 in ply | +2.24 lb | 358 lb | | Heavier than the joist. |

## Why the front end grew (16.7 lb in 3c-3, 23.5 lb at the 3c-4b hand-off, 20.2 lb now)

Front-end group now: axle beam 4.97, king beam 2.77, oak tongue 1.99, stubs 3.04, steering chains 1.64, four eye bolts 2.68, shackle 0.59, rope 0.50, kingpin 0.38, sleeve 0.34, disc 0.13, clamps 1.02, pads 0.13. The growth came from the new parts that replace the steel plate and the oak stop blocks: the chain system (chains plus four 1/2 in forged eye bolts, 4.3 lb, plus the 1.5 in chain joist in the frame group), the oak tongue and its bronze sleeve (2.3 lb against the plate), the pads and the 3 in disc (0.26 lb), and the thicker front beam (2.5 in, needed for the 200 lb cargo).

Lightest sound options (not applied; the WLL values are supplier numbers to confirm):

| Option | Mass | Effect on rows |
|---|---|---|
| 3/8 in shoulder eye bolts (WLL 900 lbf in line) instead of 1/2 in (1,500) | -0.96 lb | steer-stops 0.34 -> 0.39 |
| 3/16 in chain (WLL 1,000 lbf) instead of 1/4 in (2,600) | -0.72 lb | steer-stops unchanged (0.34) |
| Both | -1.68 lb | steer-stops 0.39, all other rows unchanged |
| Tongue 1.25 x 1.75 in | -0.36 lb | bridle-eye 0.59 -> 0.63 |
| Front beam 2.25 in thick | -0.46 lb | front-beam 1.00 (marginal) with 200 lb cargo: do not |

## Alternatives rejected

- Oak stop tabs hanging from the joist (pry bearing 2.5x to 11x); tall lugs on the beam (collide with the king beam).
- Keeping the washer as the roll restraint (3.5 in washer still 7x over).
- A thicker flat steel tongue (needed 3/8 x 3 in, custom steel and still the thin axis).
- Welding anything.

## Notes for 3c-4b / the coordinator

- Rear track is now 32 in: the brake (flaps, backers, `brake-clear` 0.22 in) and the clamp plate placement were re-checked at 32 in and pass. Rear hangers are 7/8 in thick (inner face at |y| = 10.375).
- Tests that were adjusted for 3c-4b geometry (turn-in, bulkhead ids, joists cut back for brake backers, handle sockets) are noted in the test comments; the ground-contact tests skip the bow shackle (`bridle-eye` hangs 2.54 in off the ground, a rope tie, not structure) and `brake-chock`, `handle-*`.
- The fit window for straddle now exists without the tongue (wheelbase 45 to 56.75 in); the assembled cart cannot straddle at any wheelbase (the oak tongue and shackle reach 2.8 in past the bow).
- A pad that is off the rail at some steering angle (rollPadRadiusIn far from the rail) previously produced Infinity in king-bearing and kingpin; it now holds nothing, the row fails on "pads stay under the rail", and the roll goes to the kingpin through the disc (regression test in front.test.ts).
- Hand-calc test fixtures keep the 3c-3 numbers (35.5 in tracks, 3/4 in hangers, 250 lb cargo) where the numbers are literal; the D-58 defaults are tested in `track-d58.test.ts`, `rest.test.ts` and the D-58 describe blocks.
