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

Today's four clamped 3/8" bolts carry shear by friction and are never bent: worst bolt 256 lbf, bolt shear 0.12 and bearing 0.27 of allowable, governed by the nut plate at 0.57. A loose pin is different: it is a single-shear dowel between two oak members, limited by the NDS yield modes in oak, not by its steel.

## Options tried, and why they failed

* **Pins on the rib head and the rail** (sleeved quick-release pins, a 1" tab on the knee, a 1/4" pad). Pin utilization was acceptable, **0.62 to 0.89** at the top pin and 0.33 to 0.55 at the bottom pin. But the rows around the pins failed or were unproven: the tab, the rib head, the glue joint and the insert or sleeve rows came out at **1.4 to 4.7** of their limits once the 3" lever's prying (about 180 lbf of axial pull on the bottom pin, 130 lbf on the top) and the yaw were counted, and the ball-lock retention rating was not published. It also needed 8 sleeved holes, a tab, ball-lock pins in 316 for the Extreme spec, and about +$80 to +$120.
* **Slide-on cleat (French cleat)**: hooks over a strip left on the hull, which sticks out 3/4" (the thing we wanted to remove) and unhooks under the upward load; the one lock pin then carries all 198 lbf at 1.1 to 1.5 of capacity.
* **Dovetail socket in the rail**: structurally fine, but it removes about 2.1" x 2.5" of a 3" deep rail and an oak-on-oak fit swells and sticks in wet snow.
* **Two pins through the rail and backer**: the rail is only 3" deep, so the pins sit at most 1.7" apart and 5.5" below the load: 516 lbf on the worst pin against 158 to 300 lbf of capacity, **1.4 to 2.5 over**.
* **Clamped inserts** (bolts or knobs into inserts in the rail and rib), tried after the pins: the rows failed at the defaults for the same reason, the 3" lever pulling and twisting on thin wood.
* Tenon, hook and stainless-blade variants of the bottom pin either failed on the oak (2,000 psi against a 1,070 psi limit) or needed a second precision slot for no gain.

The common cause: the knee is a 3" lever on a 3/4" rail, so any joint with fewer or looser fasteners than today's four clamped bolts has to carry the prying through thin wood.

## The choice

Keep today's knee **exactly**: four 3/8" stainless bolts through the knee leg, the rail and the backer, nuts on the backing plate, every strength row unchanged. Only how it is fitted changes:

* The knee is fitted **dry** (no epoxy against the rail; the checks never counted the glue) and the two faces that meet are epoxy-sealed first.
* A **3/8" drive ratchet, 9/16" deep socket and 9/16" wrench** (about 9" x 3" x 2") ride in the storage box. Each side takes about 3 minutes: hold the nut under the rail, back the four bolts out, lift knee and flap off as one piece.
* The knee and strap join the removable brake kit, so Brakes off and Transport mode drop them; the backer, backing plate and the four open bolt holes stay. The chock cord eye is on the knee, so the chock rides with its knee.
* It is an **optional setting** (`kneeMount`), default off, so the default sled and every default output are unchanged.

What it costs: the empty mass is the same, about 3.2 lb more comes off in Transport mode (2 knees and 2 straps; about 4.0 lb counting the bolt sets), the pouch takes the box fill from 0.87 to 0.90 (Standard), and the tool pouch is about $30 (estimate). The bolts must be at their design clamp: retighten after every refit and after the first outing, and fit new lock nuts after about five removals.
