# Phase 3 checkpoint (final, 2026-10-12)

Phase 3 (detail design) is complete. The critics pass:

| Critic | Grade | Review |
|---|---|---|
| Visual | 8/10 | `docs/reviews/visual-3c-round2.md` |
| Engineering | 8/10 | `docs/reviews/phase3c-eng-round1.md` |
| Buildability | 8/10 | `docs/reviews/phase3c-build-round2.md`, then its last must-fixes, in D-63 |

The design changed a lot along the way. The reasons are recorded in `DECISIONS.md` D-49 to D-63:
- **A ridden cart (D-49 ride mode) became a pulled Klondike sled on wheels (D-53).** It is Ashley's solid, reusable wooden hauler. The rider is a passenger, the patrol pulls and the musher brakes.
- **The steering changed three times:** car-style Ackermann, then swivel casters, then a center-pivot (soapbox) front axle at ±20° (D-56).
- **Loads are at walking pace:** there are no curbs, so the design is for bumps at 3 mph, plus a hard hit at 5 mph (D-50, D-55).

## The design now

| | |
|---|---|
| **Empty mass** | **121.0 lb** (174 lb at the start of 3c) |
| **Size** | 24" body, about 38.8" overall width, 10" pneumatic wheels, 34.5" front and 32" rear track, 8" deck |
| **Riders** | **safe 50 to over 250 lb, comfortable to 230–240 lb** |
| **Cargo** | **269 lb** (target 200). Keep the load's center of gravity within about 14" of the deck |
| **Resting** | holds a **348 lb** adult sitting or stepping in (target 250); the lid is marked DO NOT STEP |
| **Steering** | center-pivot oak axle, ±20°, about a 20 ft turning circle. UHMW roll pads, check-chain stops, oak tongue, and a nylon-rope bridle whose rope is the weak link |
| **Brake** | scooter-style step brake: oak flaps with rubber pads over the rear tires. It **slows** the loaded sled on 15°; to hold it still, use the chock or a person |
| **Body** | white oak sandwich sides on a 4 mm okoume web. A concave sheer runs from 4" at the bow to 14" at the rear, with a bow turn-in. A 1½" oak bow bulkhead serves as foot brace and lift hold, with the lamp clipped into the hand-hold |
| **Seat and storage** | frameless ½" okoume seat back that flips flat and pins. The box (2,000 in³) holds the cushions, lamp and chocks, or the 10 Essentials. A 14" parked/riding handlebow |
| **Other** | one-board grab handles, level signs on the rear sides, reflectors, a rear flag tube, 6 D-ring tie-downs |
| **Steel** | none welded and none custom-cut. Steel parts are stock DOM tube, stainless flat bar, a grade-8 kingpin, eye bolts and chain |
| **Shop** | every flat part is tagged for the Shaper Origin |

Nothing fails at the defaults. The rows near their limits:
- `turn-radius` 0.98 (12.3 ft against a 12.5 ft limit);
- tipping with cargo, 0.95.

## Materials (Eric's sourcing)
- **4 mm okoume:** one full 4' × 8' sheet from Aircraft Spruce, Peachtree City, GA, will-call.
- **12 mm (½") okoume:** one 4' × 8' sheet from a local dealer, for the deck and the seat back.
- **White oak:** 4/4–12/4 from the local lumber store; resaw and plane.
- **Fallback deck:** Baltic birch, about +3–4 lb, epoxy-sealed.
- **Finish:** stain (with pre-stain conditioner or gel on the okoume), then epoxy seal, then spar varnish. Test on offcuts first.

## Verify before ordering or cutting
1. **Tire squash test:** about 0.55" or more at 300 lb, i.e. a rate of 560 lb/in or less. Flat-free tires change this.
2. **Wheel:** the 2.8 lb 10" wheel's 300 lb rating, ¾" bore and 2.28" hub. These come from the listing.
3. **Axle tube:** DOM A513 Type 5, ¾" × 0.120" (not ERW).
4. **Steering parts:** the eye-bolt and chain working loads.
5. **Bridle:** the nylon rope's rated strength and stretch, and the bronze sleeve stock size.
6. **Seat back:**
   - the spring-detent pin (tip-to-ball distance and head height);
   - the 5/16" #10-32 inserts, with a scrap pull-out test;
   - whether the pin head clears the cushion.
7. **Sign:** the 7/8" sign knob screws.
8. **Brake:** hold a real hinge to the first beveled brake knee before cutting the rest.
9. **Lamp:** check the lamp-clip clearance against the actual lamp.

## Open decisions
1. **Rear light:** strap it to a handlebow post (recommended; no plate, no doubler) or through-bolt it to the ½" transom.
2. **Push to the live site** now (the deployed version is 3c-4).
3. **Phase 4 (build outputs):**
   - cut list and nesting (two 4' × 8' sheets plus oak boards);
   - BOM with costs;
   - Shaper Origin SVG/DXF files;
   - lamination and ramp forms;
   - assembly steps;
   - finishing schedule;
   - single-file HTML.
