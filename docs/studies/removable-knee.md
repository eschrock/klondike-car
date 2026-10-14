# Removable brake knee: why bolts and a ratchet (D-78)

Eric wanted the step-brake knee and flap to come off the sled so nothing sticks out beside the tires in transport or cargo use. This study keeps the loads and the reasons; the sketches and the full option-by-option numbers are in git history (the `docs/wip/removable-knee/` folder before the D-78 commit). All numbers are from `buildModel`, `brakeGeometry` and the `brake-mount`, `brake-pivot` and `brake-abuse` rows at the defaults.

## What the knee sees

The knee sits 3.69" beside each rear tire (3.81" with the strap), on the hull face at y = 12.00. Its rail is 3/4" x 3" oak, backed on the inside by a 3/4" oak backer and the 2" x 2-1/2" stainless plate under the nuts.

| Case | Force of the flap on the knee at the pivot |
|---|---|
| Goal hold, 200 lb rider + 25 lb cargo, 15 deg slope, brake load factor 2 | **197.6 lbf** (126.5 back, 151.7 up) |
| Operating 150 lb / cargo 200 lb | 169 / 183 lbf |
| Stomp, 150 lbf on one foot | 178.7 lbf |
| Sideways boot push (10 lbf on the foot) | 104 lbf at the strap, in or out |

The force acts **3.00" outboard** of the hull face. That lever gives a **455 lbf-in** prying moment about a fore-aft axis (top of the knee pressed in, bottom pulled out) and **380 lbf-in** about a vertical axis (yaw). The load is **up**, so anything that hooks over something unhooks under the brake.

Today's four clamped 3/8" bolts, with the knee glued to the rail, are treated as one unit with it: worst bolt 256 lbf, bolt shear 0.12 and bearing 0.27 of allowable, governed by the nut plate at 0.57. A dry knee is not that unit. A loose pin is different: it is a single-shear dowel between two oak members, limited by the NDS yield modes in oak, not by its steel.

## Options tried, and why they failed

* **Pins on the rib head and the rail** (sleeved quick-release pins, a 1" tab on the knee, a 1/4" pad). Pin utilization was acceptable, **0.62 to 0.89** at the top pin and 0.33 to 0.55 at the bottom pin. But the rows around the pins failed or were unproven: the tab, the rib head, the glue joint and the insert or sleeve rows came out at **1.4 to 4.7** of their limits once the 3" lever's prying (about 180 lbf of axial pull on the bottom pin, 130 lbf on the top) and the yaw were counted, and the ball-lock retention rating was not published. It also needed 8 sleeved holes, a tab, ball-lock pins in 316 for the Extreme spec, and about +$80 to +$120.
* **Slide-on cleat (French cleat)**: hooks over a strip left on the hull, which sticks out 3/4" (the thing we wanted to remove) and unhooks under the upward load; the one lock pin then carries all 198 lbf at 1.1 to 1.5 of capacity.
* **Dovetail socket in the rail**: structurally fine, but it removes about 2.1" x 2.5" of a 3" deep rail and an oak-on-oak fit swells and sticks in wet snow.
* **Two pins through the rail and backer**: the rail is only 3" deep, so the pins sit at most 1.7" apart and 5.5" below the load: 516 lbf on the worst pin against 158 to 300 lbf of capacity, **1.4 to 2.5 over**.
* **Clamped inserts** (bolts or knobs into inserts in the rail and rib), tried after the pins: the rows failed at the defaults for the same reason, the 3" lever pulling and twisting on thin wood.
* Tenon, hook and stainless-blade variants of the bottom pin either failed on the oak (2,000 psi against a 1,070 psi limit) or needed a second precision slot for no gain.

The common cause: the knee is a 3" lever on a 3/4" rail, so any joint with fewer or looser fasteners than today's four clamped bolts has to carry the prying through thin wood.

## The choice

Keep today's knee: four 3/8" stainless bolts through the knee leg, the rail and the backer, nuts on the backing plate. Only how it is fitted changes:

* The knee is fitted **dry** (no epoxy against the rail) and finished on the bench with the flap kits; the rail patch under it is finished with the underside, and no finish may bridge the joint.
* The backing plate is bedded in thickened epoxy in its recess at the frame step (the bolts, waxed, locate it), so it stays when the last bolt comes out.
* A **3/8" drive ratchet, 9/16" socket and 9/16" wrench** (about 9" x 3" x 2") ride in the box in cargo mode. Each side takes about 5 minutes (longer the first time): lie beside the sled, reach under the deck behind the rail between the two crossmembers just ahead of the rear wheel, hold the nut, back the bolts out, lift knee and flap off as one piece. Refit hangs the knee on one bolt first so one person can do it.
* Bolts go in snug plus a quarter turn, about 60 in-lb, with anti-seize on the stainless threads (more crushes the washers and the oak); recheck after the first outing, new lock nuts after about five removals.
* The knee and strap join the removable brake kit, so Brakes off and Transport mode drop them; the backer, backing plate and four open bolt holes stay. The chock stays tied to the eye under its knee and travels with it.
* **Dry-knee check.** The glued knee's uniform dowel bearing does not describe a dry knee, so `brake-mount` adds the NDS single-shear yield-mode check of the worst bolt between the 1-3/4" leg and the 1-1/2" of rail and backer, across the grain (Fe about 5,700 psi, 65 ksi bolt, wet and group factors 0.95): Z' about 306 lbf (mode II) against a worst bolt of about 255 lbf, **0.84**, which passes. Every other row is unchanged.
* It is an **optional setting** (`kneeMount`), default off, so the default sled and every default output are unchanged.

What it costs: the empty mass is the same, about 4.0 lb more comes off in Transport mode (3.2 lb for 2 knees and 2 straps, about 0.8 lb of bolt sets), and about $38 of tools and anti-seize (estimates).
