# Phase 3c-9: brake rework, removable kits, Transport mode (D-65, Eric 2026-10-12)

## A. Brake

- **Flap ends at the transom face.** `brakeFootBehindTransomIn` (0.5, flap 3 in behind the transom) is replaced by `brakeFlapEndBehindTransomIn` = 0; the foot tread is 4 in (was 5), so the foot point
  is 2 in ahead of the transom face and 15.0 in from the pin (was 17.5). Lever ratio 2.48 forward / 2.07 backward (average 2.28) becomes 2.12 / 1.79 (average 1.95). `brakeLeverRatio` target 1.75 -> 1.5
  so brake-ratio stays a pass (it would read "marginal" and turn the Simple headline amber); brake-slow (D-58) is the judged row.
- **Fender.** The flap is a Shaper Origin plan cut (`flapOutline`, an `xy` extrusion): 1-1/4 in tongue at the pivot, S-curved flare to the full 3 in over the tire, 1/2 in radius at the foot end,
  1/4 in at the nose; automatic 1/4 in roundover (finish). Rubber pad over the tread, ribbed foot tread kept.
- **Pull-pin pivot.** Butt hinge, its params and the `brake-hinge` row are gone. The knee arm is slotted from the rear (not drawn; its mass is taken out) into two ears; the flap tongue plus an oak
  pivot block (5/8 x 1-1/4 x 2 in, glued and 3 screws) enters the slot; a 3/8 in 316 headless clevis pin goes through the outboard ear, tongue and block and 1 in blind into the inboard ear (double
  shear), with a hitch-pin clip in a cross hole at the outboard end. 3/4 in of oak above, below and past the pin (2 pin diameters). The knee rear face is `max(r + brakePivotAheadIn, 6)` = 6.25 in, the pin
  0.75 in further (x = 7.01 in), so the knee stays out of the sign zone.
- **Return cord.** Screw eye in the flap's rear end face (its ring reaches 0.35 in behind the flap; a flap-top eye would make the cord cross the hull side), snap hook at the transom end.
- **Removable kit** (`src/model/removable.ts`): flap, pivot block, pin, clip, shoe block, pad, foot tread, cord, snap hook, with the shop note "pull the pin, unhook the cord: about 15 s a side, no tools".
  Knees and backers stay. Washers under the knee nuts 1 in -> 1-1/4 in (`brakeMountWasherOdIn`): the shorter lever raised the foot force and the pin load about 12% and the overturning couple
  put brake-mount at 1.16.
- **Numbers (defaults):** brake-slow goal 12.5 deg (util 0.80; operating 14.7 util 0.68; cargo 13.5 util 0.74; flaps take 98% of the 15 deg pull); brake-force (info) 92 / 106 / 99 lbf per foot (was 79 / 92 / 86);
  brake-clear 0.22 in (limit 0.1) pass; brake-flap 0.62; brake-pivot 0.75 (edge/end distance governs; pin bending 0.49, shear 0.05, bearing 0.25); brake-mount 0.68; brake-return 3.5x lift.
- **Flaps in the box:** the two flaps (each 17.8 x 3.0 x 2.1 in with shoe block, pad and block) fit in the cargo-mode layer with the lamps, clips and chocks (fill 0.41, 2.86 in layer): listed as an option in
  the seat-stow row, not in the default stow (`boxGear().flaps`).

## B. Toggles and Transport mode

- ViewState `brakes`, `lights`, `chocks` (default on); `removed` omits all `removable` parts.
- `TRANSPORT_VIEW = { removed, handle: 'parked', seat: 'stowed' }` is what the truck-fit 'removed' configuration builds and what the viewer's Transport mode shows.
- Transport set: OFF = brake flap kit (18 parts), lights and clips (4), chocks and cords (4), seat back pad and pins; ON = tongue, sleeve, rope, signs, handle (parked), knees, backers. The signs and
  (Eric, later) the tongue are NOT removable. The handle is no longer `removable` (it is parked). The 'bridle-off' truck-fit configuration is gone (installed / removed only).
- Simple: Explode, Dimensions, Steering, Show rider, **Transport mode**. Advanced adds Seat flat, Handle parked, Brakes, Lights, Wheel chocks, Outline edges (and CG, Section, Shop aids, Joinery).
  Transport mode locks the individual toggles at its states. Simple resets the Advanced toggles to defaults.
- Wheel chocks: now a model option (`chocks`) instead of mesh visibility; verified in iso and side view.
- Outline edges: label, tooltip, opacity 0.28 -> 0.5; always on in Simple.

## C. Mass (empty, no rider)

119.91 lb with brakes on; 115.98 lb brakes off (-3.93); lights off 118.78; Transport mode 112.90 lb (lift 56.5 lb each). Was 120.89 before D-65 (-0.97).

## Truck fit (Transport mode)

Installed 67.0 x 38.8 x 35.5 in (was 68.8 long); Transport mode 66.9 x 38.8 x 25.7 in (the parked handlebow stands above the 22 in transom corners). Max wheelbase beside 57.25 in in both.
