# Phase 3c-3a notes: sled body, pivoting soapbox front axle (D-54, D-56)

Scope is D-53, D-54 (body) and D-56 (front end). History: the first D-54 pass put two purchased swivel casters under the bow; Eric rejected them (the deck rode too high, they sat too close together, and they swiveled 360 degrees). The front end was redecided: a **soapbox / billy-cart center-pivot axle** (D-56 below). Also in this phase: Ackermann front end removed, 24 in straight-sided sled body with a curled bow, 10 in wheels all round, bump speeds split (D-55), foot drag brake (D-55, the brake agent). `DECISIONS.md` and `docs/STATUS.md` are not touched; proposed decision text is at the end. Nothing is committed.

## 1. Design facts

Model frame: +X forward, +Y left, +Z up, inches, origin on the ground under the rear-axle center.

| | Default | Where |
|---|---|---|
| Wheelbase (rear axle to the kingpin) | 44 in | `wheelbaseIn` |
| Rear overhang / front overhang (to the bow tip) | 10 in / 12 in | `rearOverhangIn`, `frontOverhangIn` |
| Body outside width, straight and parallel | 24 in | `bodyWidthIn` |
| **Deck top** (set by the pivot stack, see below) | **8 in** (was 10 with a fixed axle, 14.75 with casters) | `deckHeightIn` |
| Side height above the deck at the bow end / at the rear | 4 in / 16 in, straight line | `sideHeightBowIn`, `sideHeightRearIn` |
| Bow curl | 7 in radius, 80 degrees, 4 x 3 mm bent lamination | `bowCurl*` |
| Wheels, all four | 10 in pneumatic, 3.5 in wide; front and rear track 35.5 in | `wheelDiameterIn`, `tireWidthIn`, `frontTrackIn`, `rearTrackIn` |
| Steering lock | +/-20 degrees, two stop blocks | `steerLockDeg` |
| Kingpin | one 5/8 in SAE grade 8 bolt | `kingpinDiaIn` |
| Thrust washer | UHMW, 2.5 in OD x 1/4 in | `kingThrustOdIn`, `kingThrustThickIn` |
| Tongue plate | A36 3/16 in; 4 in head on the beam, tapering to a 1.75 in bar; tie hole 1 in from the tip, tip 4 in past the bow | `tongue*` |

### The front axle (src/model/pivot.ts, bridle.ts)
- **Axle beam** `beam-F`: oak, 2.5 x 2.25 in section, 32.25 in long, underslung like the rear (top z 5.375, bottom 3.125, so 3.1 in of ground clearance). A 3/4 in steel **stub axle** (`axle-FL/FR`) lies in a groove in each beam end and is pinned by four clamp plates with 316 bolts (the rear clamp design); the 10 in wheel sits on the free end, outboard of the body.
- **Kingpin** `kingpin`: head and plate washer under the beam; up through the beam, the tongue plate, the UHMW thrust washer and the king beam; nylock nut in a slot cut from the front face of the king beam. Vertical load goes through the thrust washer, not through the bolt.
- **Vertical stack at the kingpin** (this sets the deck height): beam top 5.375 + tongue plate 0.1875 + thrust washer 0.25 = 5.8125 = bottom of the **king beam**, which fills the rest up to the deck underside (7.53 in at deck 8, so 1.72 in deep). `validateParams` errors if the king beam would be under 1 in deep (deck below about 7 in).
- **King beam** `king-beam`: oak crossmember, 3 in fore-aft, between the rails at the kingpin; Domino-tied and epoxied to the rails, bonded to the deck underside. It replaces one joist.
- **Rails**: 3/4 x 3 in as before, but ahead of x = 38 in they step (45 degree ramp) down to 1.75 in deep so the swinging beam (top 5.375) passes 0.4 in under them. The step is derived (`steerGeometry`: beam half thickness x cos(lock) + rail inner |y| x sin(lock), plus 1 in). The rails are single extrusion parts now.
- **Stops** `steer-stop-L/R`: oak blocks hanging under the ends of the end joist (x = 48.7), glued to the joist and the rail, two 5/16 in 316 bolts down through the joist. The beam's leading edge meets the stop's rear face at |y| = 9.2 in from the kingpin exactly at the lock angle (the stop position is derived from the lock angle).
- **Tongue plate** `bridle-tongue`: lies on the beam (it is the steel bearing face under the thrust washer), bolted to the beam by two 3/8 in bolts outside the washer, reaches forward under the deck and the bow. The **bridle shackle** `bridle-eye` (intended weak link) goes through the tie hole; `bridle` is the rope. The pullers steer by pulling the tongue; the tow force goes through the kingpin. Everything unbolts for transport (tongue, shackle, rope).
- **Optional steering ropes** (`steerRopesOn`, default off): a light rope from each axle end back to the musher.
- No Ackermann: both wheels stay parallel, so the turning center is where the axle line meets the rear axle line.

### Turning and steering geometry at +/-20 degrees (defaults)
- Center radius (rear axle center, WB / tan 20) **120.9 in = 10.1 ft, turning circle about 20 ft**; outer tire edge radius 148.1 in (12.3 ft); inner edge 109.1 in.
- Tire to body at full lock: 1.32 in (needs 0.75 in); minimum front track for this lock and width is 34.3 in. The body does **not** need to narrow at the nose: the wheels swing beside the body, and the closest approach is the tire's inner rear corner against the side, which only needs the track (35.5 in), not a narrower nose. (The sled bow narrows nothing here; the wheels are beside the body, not under it.)
- The old locked limit `turnRadiusMaxIn` (108 in outer edge, A-2) cannot be met at 20 degrees (it needs about 30 degrees of lock). Eric chose 20 degrees knowingly (about a 20 ft turning circle), so the `turn-radius` row is informational.

### Body (unchanged from the earlier pass)
Straight 24 in sides with a sled profile, curled bow in place of the front transom, rear transom following the rear side height, handlebow and seat-stow box, storage box, seat, grab handles on the sloped side, foot stop, lash points, lantern and flag mounts, scuppers, no exposed ply edges, oak and the D-44 finish tags; signs provisional and out of the way (`showSideSigns` off). Ladder frame and captured ply only (`frameStyle`, `sideConstruction` removed).

### Removed in this phase
Ackermann front beam, kart spindles, kingpin brackets, steering arms, tie rod, drag link, bellcrank, tongue hinge, tow-lock stops, `ackermann.ts`, `front-*.ts`, `hull-curve.ts`, the front transom, sheer, nose stringers, the old steering slider and its rows; the swivel casters and caster rows (never shipped), the bow eye bolt and backing block (the bridle now ties to the tongue), and the placeholder fixed axle.

## 2. Results

(Filled in at the end of the phase: see the coordinator report.)

## 3. Proposed decision text (for DECISIONS.md, not edited here)

**D-54 detail (3c-3a).** The sled body: 24 in outside, straight and parallel, sides 4 in at the bow rising in a straight line to 16 in at the rear, a bent-lamination curl in place of the front transom, ladder frame and captured 6 mm ply, 10 in wheels all round. (The swivel casters named in D-54 were rejected by Eric and replaced by D-56.)

**D-55 detail (bump speeds).** Eric 2026-10-11: walking pace is normal use (`bumpSpeedNormalMph` 3, 1 in step, full margins); a sharp edge at a jog is the occasional hard hit (`bumpSpeedHardMph` 5, 2 in step, ultimate / failSafeFactor, wheel retention, bend-don't-break). Replaces `bumpSpeedMph`.

**D-56. Front end: a soapbox center-pivot axle (Eric, 2026-10-11).** Supersedes the swivel casters of D-54. One stout oak axle beam under the bow with a 10 in pneumatic wheel on a bolt-on stub axle at each end, wheels outboard of the 24 in body so the deck stays low (8 in). It pivots on **one vertical kingpin**, a 5/8 in grade 8 bolt, through a steel tongue plate and a UHMW thrust washer into an oak king beam between the rails; bolted only, no welding. **Steering lock +/-20 degrees** (`steerLockDeg`) set by two oak stop blocks; the wheels stay parallel (no Ackermann), turning circle about 20 ft. The pullers steer with a tongue plate bolted to the axle, with the bridle shackled to its tip; optional ropes from the axle ends back to the musher (default off). The rails step down where the swinging beam passes. The locked 9 ft turning radius (A-2, D-51) is relaxed to about 10 ft at the rear axle (12 ft at the outer tire edge). Analysis rows: `kingpin` (grade 8 bolt: tow pull, one-wheel roll couple and bump at 3 mph normal and 5 mph hard hit), `king-bearing` (UHMW pressure and the oak under it), `front-beam`, `front-stub`, `steer-stops`, `king-beam`, `steer-clear`, `bridle-eye` (now the tongue tie), and `turn-radius` (information).
