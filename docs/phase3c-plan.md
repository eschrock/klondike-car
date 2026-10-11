# Plan: Phase 3c, simplify and finish the cart

**Status:** draft for Eric, 2026-10-11. This replaces the earlier "sled rework" drafts of this file.

## What we're building (Eric, after the sled research)
- **The concept is Ashley's.** It's a Klondike sled for the race, and afterwards a **solid, wide, reusable wooden cart**. Post-race uses (`reference/04-post-race-uses.png`): camp gear, firewood and water, a campsite hauler, first aid and hydration station, a pioneering-pole cart, a service-project tools cart, a parade and recruiting display.
- **It keeps a solid look and feel:**
  - oak and good joinery;
  - the weatherproof storage box;
  - signs and a lantern;
  - built to last for years.
- **Wheels are required** (we're in the South).
- **It stays on the wider side, so it's useful as a hauler.**
- **The front wheels stay steerable** through the tongue, which the pullers steer, as now.
- **"Self-steering" is out.** The rider does not drive it, and it isn't designed to coast downhill.
- **The race roles follow the Klondike norm** (`docs/klondike-research.md`):
  - the rider is a passenger;
  - the team pulls on hand loops (6–9", never over a neck or waist);
  - a musher or handler at the back pushes and brakes.

The sled research and Eric's packet (`reference/05-klondike-sled-packet.pdf`) supply **character cues only**:
- a handlebow at the back;
- the curled bow;
- the low, long proportions.

They do not change the structure.

## 1. What changes from `6341ecf` (174 lb, no safe rider range)

**Remove (ride mode, D-49 and D-51 rider controls):**
- the rider side stick, cables, guides and deck slot;
- the mode pin, centering springs and ride lock;
- the hip lever and Bowden cable, and the lost-motion link;
- the "Riding it downhill" card, the ride envelope rows and the ride sim scenario;
- the 10 mph bump and fail-safe load cases. Loads go back to **walking or jogging pace on a camp road** (D-50 "bumps, not curbs" still holds), with full margins on normal use.

**Reconsider:**
- **Front brakes (10 lb).** They were added for downhill riding. Without riding, the handler's brake on the rear wheels plus the team should hold a loaded cart on 15°. *Recommendation:* drop them; this check decides it.
- **Lap belt.** Optional at walking pace. *Recommendation:* drop it, and keep the grab handles and foot stop.
- **Ackermann front.** Keep the steerable front wheels. Car-style steering is already built and fixes the old turntable failures. With ride mode gone, the linkage can be simplified: the tongue drives the bellcrank directly, with no mode plate and no stick.

**Keep:**
- the convex-taper hull with no prow (D-45, D-52);
- the oak, the finish, the storage box and the signs;
- the rear brake with the handler's lever on the push handle (D-38, D-48);
- the truck fit and the Simple view.

**Add or adjust:**
- **A cargo mode.** Post-race hauling becomes a real load case: a payload in lb, spread or concentrated. A flat, usable bed.
- **The seat stows in the storage box (Eric).** The seat back and cushion come out with no tools and **stow inside the storage box**, leaving a flat cargo floor. This sizes the box interior: it must take the seat-back frame and panel, the back pad and the cushion. When towing in race mode, the 10 Essentials go in the box. The box, the seat-back attachment (D-40 knobs) and the cushion's Dual Lock pad get a fit check and a test. If the back frame is too big to fit, the back folds or splits.
- **A handlebow-style push handle.** It's the musher's station, holding the brake lever, and gives a sled cue at the back.
- **Width.** Stays wide (today's 28" cabin), not the 18–24" sled norm.

**Then fix what still fails at the new loads.** The current failures are:

| Area | Checks |
|---|---|
| Front end | kingpin bracket and bolt (largely driven by the 3" scrub of the hand-truck wheel hubs), bellcrank, tongue tie, tie rod |
| Rear end | rear beam seat, bearing groove, axle, wheel rating |

Most of these were driven by the 10 mph bump cases, so re-run them at walking-pace loads before resizing anything.

**Then slim the weight.** The target is roughly **100–120 lb** for a solid cart with storage, versus 174 lb today (decision 4).

## 2. Decisions for Eric
1. **Front brakes:** drop them (recommended) if the rear brake holds on 15°?
2. **Cargo capacity:** what should it haul after the race? Suggest **250 lb** of payload (firewood, water jugs, coolers), and the 150/200 lb rider in race mode.
3. **The bed:** the seat back and cushion stow in the storage box for a flat floor (decided, Eric). Do we want stake pockets or tie-down points for poles and tall loads (pioneering, the parade flag)?
4. **Weight target:** is about 100–120 lb right, given who lifts it into the truck?
5. **Width:** keep the 28" cabin (and the 41" track)? Or slightly narrower for the truck and trails?
6. **Lap belt:** drop it?

## 3. Phases
1. **3c-1, strip ride mode.**
   - Remove the parts, params, rows, UI and sim pieces listed in §1, and simplify the linkage.
   - Re-run the analysis at walking-pace loads.
   - Report the new mass and the failing rows.
2. **3c-2, cargo mode and bed.** Add the payload case and the flat bed. Make the seat stow in the box (size the box, and fold or split the back if needed). Add the handlebow push handle and tie-downs.
3. **3c-3, size and slim.**
   - Fix the remaining failures with the lightest sound change. For example, a dished or kart-style front hub to cut the scrub.
   - Weight-reduction pass against the target.
   - Engineering and buildability critics.
4. **3c-4, finishing.**
   - Visual pass: the deferred flush flag socket, lamp detail and sled cues.
   - Visual critic.
   - **Checkpoint for Eric.**
5. **Phase 4, build outputs:**
   - cut list;
   - nesting;
   - BOM with costs;
   - DXF and STL files;
   - lamination forms;
   - assembly steps;
   - finishing schedule;
   - single-file HTML.

## 4. Lessons applied
- Confirm the use case in one paragraph before designing: who rides, who steers, at what speed, and what it does after the race. Both rework rounds came from use-case misunderstandings, not engineering.
- Loads at the real speed, with margins on normal use, and proven purchased parts judged by their record.
- Every mechanism must earn its weight. Craft, wood and storage are part of the brief.
