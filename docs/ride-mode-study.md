# Ride-mode design study (BRIEF §4.3a, D-49)

Status: **study only, nothing in `src/` changed.** Numbers come from ad hoc scripts run against the live model (`buildModel`, `computeLayout`, `buildLoadModel`, `brakeGeometry`, `runChecks`) on the working tree of 2026-10-11 (empty cart 169.0 lb, 13" wheels, wheelbase 44", track 35.5", kingpin x = 45.5"). The Rapier sim was not used; every estimate is closed-form and stated as such. US units: inches, pounds, degrees, mph.

## 0. Requirements and the short answer

Requirements in force (BRIEF §4.3a, D-49, plus Eric's answers):
- Ridden downhill by one rider alone; **design speed 10 mph**; rider holds speed with the brake.
- **Hill unknown: design for a 15° maximum slope**, run long enough to reach design speed.
- Brake usable by rider and rear handler: one mechanism, two levers, either one applies it.
- No pinch points (§4.7); no input that can whip the steering to full lock at speed; controls removable or stowable for tow mode.
- **Owner clarification (Eric, 2026-10-11): "When going downhill there will be minimal steering. This is not something where we're navigating some complex route, just some steering to help keep it straight."** Ride mode is straight-line tracking with small corrections. Self-centering and straight-line stability matter more than steering authority, and the simplest, lightest input that achieves it is preferred. Rollover is still checked, at the limited ride lock.

Headline numbers:

| Item | Result |
|---|---|
| Free-roll speed on 15° (rolling resistance 0.03) | 10 mph after **2.1 s / 15 ft**; 25 mph after 100 ft. On 10°: 10 mph after 3.4 s / 25 ft; 20 mph after 100 ft. Terminal speed (> 50 mph) is irrelevant: **the brake sets the speed, not physics.** |
| Brake energy to hold 10 mph on 15° | **10.5 kJ per 100 ft (150 lb rider), 12.1 kJ (200 lb)**; 1.5-1.8 kW, 6.8 s per 100 ft. |
| Steering needed for "keep it straight" | **±6° covers a 3 ft swerve in 20 ft and any road bend down to 35 ft radius; ±8° is recommended; ±10° is the most the cart needs.** |
| Safe steer angle at 10 mph | Tip needs 1.17-1.24 g; the tires slip at 0.5 g (μ 0.5) or 0.35 g (wet). Limit lateral acceleration to 0.25 g: **8° at 10 mph**. Full lock (37°) is not rollover-limited (SSF still 1.02-1.08), it is *slide*-limited above ≈ 15° (μ 0.5) / 11° (μ 0.35). |
| Stopping from 10 mph | Flat, rear brake only: 11 ft (μ 0.5), 15 ft (μ 0.35). **On 15° nose-down, rear-only braking cannot slow the cart** (spare deceleration 0.00-0.03 g at μ 0.5: 126-135 ft). With ≈ 50% of the braking on the front: 15-17 ft on 15° at μ 0.5. |
| Impact at 10 mph vs today | Same obstacle: **5-8× today's horizontal strike force** (up to 9-13× if the whole cart mass takes part). Today's "×3" is equivalent to hitting the 3" curb at ≈ 1.5-2 mph. |
| One-wheel strike yaw torque on a wagon-steer axle | 23,000-40,000 lb·in at 10 mph (1.5"-3" step) vs ≈ 6,000 today. **With Ackermann knuckles the same strike puts ≈ 1,300-2,500 lb·in on each knuckle.** |

**Recommendation in one line:** ride mode at 10 mph makes the turntable wagon steer the wrong architecture. Pick **Concept A: Ackermann with purchased kart-class spindles, a single side stick, and a four-wheel shared-shaft brake with a hip lever** (≈ -11 lb). Concept B (keep the wagon, add a ±8° ride lock, damper, rope reins and a front brake) is the fallback if Eric wants to avoid redesigning the front end, but it carries the open front-end problem forward and makes it worse.

---

## 1. Speed, energy and impact

### 1.1 Method
Mass and CG come from `buildLoadModel` (150 lb rider + 25 lb cargo = 344 lb total; 200 lb + 25 = 394 lb). Rolling resistance Crr 0.015 (pavement / hardpack), 0.03 (firm dirt, short grass), 0.06 (loose / soft). Drag CdA = 0.5 m² (upright seated rider in an open box plus tires), ρ = 1.2 kg/m³. Wheel rotational inertia counted as +5% mass. Time-stepped at 1 ms.

### 1.2 Speed on the slope (free roll, no braking)

| Slope | Crr | Terminal | 10 mph reached | 20 mph reached |
|---|---|---|---|---|
| 15° | 0.015 | 79-85 mph | 2.0 s, 14 ft | 4.0 s, 59 ft |
| 15° | 0.03 | 77-82 mph | 2.1 s, 15 ft | 4.3 s, 63 ft |
| 15° | 0.06 | 72-77 mph | 2.4 s, 18 ft | 4.9 s, 73 ft |
| 10° | 0.015 | 64-68 mph | 3.0 s, 22 ft | 6.2 s, 93 ft |
| 10° | 0.03 | 61-65 mph | 3.4 s, 25 ft | 6.9 s, 103 ft |
| 10° | 0.06 | 54-58 mph | 4.2 s, 31 ft | 8.8 s, 132 ft |

(Ranges are the 150 lb to 200 lb rider; the rider barely changes it, since drag is small.) Unbraked after 100 ft: **25 mph on 15°, 20 mph on 10°**. So "a run long enough to reach design speed" is only 15-30 ft; any real hill delivers it, and the rider is braking almost from the start. The cart will not find 10 mph by itself on slopes under about 2°.

10 mph of kinetic energy (344 lb) is 1.56 kJ, the same as dropping the loaded cart 3.3 ft.

### 1.3 Brake energy at a held 10 mph

| Rider | Slope | Brake force | Energy per 100 ft | Power | Time per 100 ft |
|---|---|---|---|---|---|
| 150 lb | 10° | 48 lbf | 6.5 kJ | 0.96 kW | 6.8 s |
| 150 lb | 15° | 78 lbf | 10.5 kJ | 1.55 kW | 6.8 s |
| 200 lb | 10° | 55 lbf | 7.5 kJ | 1.10 kW | 6.8 s |
| 200 lb | 15° | 89 lbf | 12.1 kJ | 1.77 kW | 6.8 s |

(Crr 0.03, drag removed.) For scale, a 220 lb cyclist and bike descending a 6% grade at 20 mph dissipates about 0.5 kW, a third of this cart's load.

### 1.4 Strike load at 10 mph, replacing "(rider + cargo) × 3"

**Today's rule** is quasi-static: the wheel climbs the step under H = V·tan φ, with V = 3 × the static wheel load (`strikeCases`). It has no speed in it. Inverting a velocity-change model, it corresponds to a strike at only **1.5-2 mph**.

**Method for 10 mph (velocity-change pulse, with the tire and structure as a spring).** The wheel (radius r = 6.5") meets a step of height h. The contact normal is tilted β above horizontal with sin β = (r - h)/r. The wheel's velocity component along the normal, v_n = v·cos β, must be removed by the tire and structure: F_n = v_n·√(k·m_e), horizontal part F_n·cos β, vertical part F_n·sin β. Inputs:
- v = 10 mph = 4.47 m/s; both wheels strike (k doubles).
- m_e = the mass that must change velocity: **front-axle load (129 lb at 150 lb rider, 147 lb at 200 lb)** as the low bound, **whole cart (344-394 lb)** as the high bound.
- k = 1,000-2,000 lb/in per wheel. A free 13" × 4" pneumatic is about 200 lb/in, but its usable travel is about 1.5": it absorbs ½·200·1.5² = 225 in·lb (25 J) per wheel against ≥ 400 J of normal-direction energy, so it **bottoms out** at 10 mph for any step of 1" or more. After bottoming, the stack is tire casing + rim + structure, which is the 1,000-2,000 lb/in range.

| Step | Today: H, both wheels (3× static) | 10 mph: horizontal, front-axle mass | 10 mph: horizontal, whole cart | 10 mph vertical (both wheels, front-axle mass) | Ratio to today |
|---|---|---|---|---|---|
| 1.5", 150 lb rider | 321 lbf | 1,860-2,620 lbf | 3,030-4,290 lbf | 2,230-3,160 lbf | 5.8-8.2× (9.5-13× whole cart) |
| 2" root, 150 lb | 402 | 2,370-3,350 | 3,870-5,470 | 2,270-3,210 | 5.9-8.3× |
| 3" curb, 150 lb | 604 | 3,230-4,560 | 5,280-7,460 | 2,060-2,920 | 5.3-7.6× |
| 3" curb, 200 lb | 689 | 3,450-4,880 | 5,650-7,990 | 2,200-3,120 | 5.0-7.1× |

Two things matter more than the exact ratio:
1. **The vertical component is about 2,000-3,000 lbf on the pair of front wheels for any step of 1" or more** (it peaks near β = 45°), i.e. 1,000-1,600 lbf per wheel against the `wheelRatingLb` peak allowance of 600 lbf (300 lb × 2). At 10 mph the **wheels are the fuse** unless they are 600 lb-rated (many 4.80/4.00-8 cart wheels are; to verify from the listing).
2. A 3" curb square-on at 10 mph is an accident, not a design load. The honest design rule is a **defined obstacle at ride speed**, not a blanket factor.

**Proposed replacement (decision for Eric):**
- **Ride mode, 10 mph:** design to a **1.5" step, both wheels or one wheel, front-axle-mass model with k = 1,500 lb/in** → both wheels H ≈ 2,200 lbf horizontal / 2,700 lbf vertical (150 lb rider; ≈ 2,300 / 2,900 at 200 lb); one wheel H ≈ 1,500 lbf. Rear wheels see the same vertical pulse scaled by their load.
- **Tow / walking pace:** keep today's 3× on the 3" curb (≈ 2 mph equivalent). Add a rule: ride mode is walking pace over anything taller than 1.5".
- Rider restraint: the cart's horizontal pulse at the above load is ≈ 6-8 g peak for about 10 ms; the rider sees about 4-6 g after the cushion and body compliance. Replace `curbStrikeG` = 2 with **4** (foot stop and grips) for ride mode.

### 1.5 Which existing checks fail at the new load (estimate)
Scaling today's utilizations (goal rider) linearly by the load ratio (≈ 5-6× for strike and axle rows, 1.7-2× for the rider-restraint rows). This is a crude upper bound for the strike-driven rows; a Phase 4 bench or sim pass should confirm.

| Check | Today (goal util) | At 10 mph, 1.5" step (est.) |
|---|---|---|
| `steer-stops` / `steer-stops-bound` | **2.11 / 1.36 (already fail)** | ≈ 10 / 7 |
| `turntable-ring` | **1.37 (already fails)** | ≈ 7 |
| `kingpin-bolts` | **1.20 (already fails)** | ≈ 6 |
| `kingpin-strike` | 0.68 | ≈ 3.5-4 |
| `roll-side-bearer` | 0.86 | ≈ 4-5 |
| `kingpin-split`, `kingpin-plates`, `turntable` | 0.80, 0.60, 0.71 | ≈ 3-4 |
| `roll-bolster-attach` | 0.37 | ≈ 2 |
| `bearing-groove` | 0.93 (marginal) | ≈ 5 |
| `axle-stress` (front and rear) | 0.80 | ≈ 3-4 |
| `wheel-rating` | 0.62 | ≈ 3 (needs ≥ 600 lb wheels or a lower design step) |
| `rear-beam-seat`, `rails` | 0.88, 0.69 | ≈ 2-4 (rear wheel strikes) |
| `beam-front` | 0.18 | ≈ 1.0 |
| `seat-grip` | 0.83 | ≈ 1.4 (hand load × 4 g instead of 3) |
| `seat-back` | 0.59 | ≈ 0.8-1.0 |
| `foot-stop` | 0.33 | ≈ 0.66 at 4 g (to 1.0 at 6 g) |
| Brake members (`brake-shaft`, `brake-abuse` ...) | 0.89 | unchanged (abuse load sets them), but see §4 for the added loads |

Practically: **everything on the front axle load path fails by a wide margin.** The three rows that already fail today are the same ones that become hopeless.

---

## 2. Rollover and steering at speed

### 2.1 What steering range does "keep it straight" need?

Ten mph is 14.7 ft/s. A correction is two arcs (S-curve) of radius R: lateral shift Y over distance D = D²/(4R); the steer angle for radius R is atan(44"/R).

| Maneuver at 10 mph | Radius | Steer angle | Lateral accel | Time |
|---|---|---|---|---|
| Road bend, 400 ft radius | 400 ft | 0.5° | 0.02 g | |
| Road bend, 100 ft | 100 ft | 2.1° | 0.07 g | |
| Road bend, 50 ft | 50 ft | 4.2° | 0.13 g | |
| Trail bend, 30 ft | 30 ft | 7.0° | 0.22 g | |
| Swerve 3 ft in 20 ft (dodge a rock) | 33 ft | 6.3° | 0.20 g | 1.4 s |
| Swerve 4 ft in 25 ft | 39 ft | 5.4° | 0.17 g | 1.7 s |
| Swerve 2 ft in 15 ft | 28 ft | 7.4° | 0.24 g | 1.0 s |
| Swerve 3 ft in 15 ft (hard) | 19 ft | 11.1° | 0.36 g | 1.0 s |

**±8° ride lock is enough for everything a "keep it straight" use needs** (a 2-3 ft dodge, a trail bend of 25 ft radius). Authority beyond ±10° only buys the ability to slide.

### 2.2 Static stability factor with the real wheel contacts

SSF = (distance from CG to the nearest side edge of the 4-contact polygon) / CG height, from `contactsAt`, `lateralTip` (front contacts rotated about the kingpin by the lock angle; wagon). Lateral acceleration to tip = SSF × g.

| Lock | Edge dist. (150 lb) | SSF 150 lb | SSF 200 lb | SSF empty |
|---|---|---|---|---|
| 0° | 17.59" | 1.238 | 1.173 | 1.93 |
| 5° | 17.52 | 1.232 | 1.168 | 1.92 |
| 8° (ride lock) | 17.44 | **1.227** | **1.163** | 1.91 |
| 10° | 17.38 | 1.223 | 1.159 | 1.90 |
| 20° | 16.91 | 1.190 | 1.128 | 1.84 |
| 30° | 16.09 | 1.132 | 1.074 | 1.74 |
| 37° (tow lock) | 15.29 | 1.076 | 1.020 | 1.63 |

(CG height 14.21" at 150 lb, 15.01" at 200 lb, 9.04" empty; CG x 16.5". Static `tip-straight` utilization is 0.78-0.81.)

- **Tip never governs on flat ground.** At 8° the cart tips at 1.16-1.23 g; at 10 mph the 8° turn pulls only 0.26 g (4.5× margin). The tires slip first: at μ 0.5 a_lat,max = 0.5 g (R 13.4 ft, 15° of steer); at wet μ 0.35 it is 0.35 g (R 19 ft, 11°).
- **Recommended safe steer angle at 10 mph: 8°** (0.26 g, the 0.25 g margin of 1.4× against μ 0.35, 1.9× against μ 0.5). At 7 mph (jog-up speed) 8° is only 0.13 g.
- **The real rollover risk is a trip, not a turn.** Energy to roll the cart over its wheel line is W·(√(d² + h²) - h): 8.3" × 344 lb = 2,860 in·lb (323 J) at 150 lb. A sideways *slide* at **≥ 4.5 mph** that hooks a curb or rut rolls it. Hence: the failure to avoid is the cart sliding sideways, which comes from **rear-wheel lockup** (see §4.3), not from steering input.

### 2.3 Geometry of wagon steer vs Ackermann at the nose

Rigid-axle wagon steer is kinematically perfect (the instant center lies on both axle lines, so no tire scrub) but swings the whole axle. Ackermann pivots only the wheels, which stay outboard.

Nose half-width limit from A-4 (tire as a full-radius rectangle; steering clearance 0.75"):

| Lock | Wagon: inner tire y | Max nose width | Tire reaches behind kingpin | Ackermann (wheel pivots on its center): inner y | Max nose width | Reaches behind axle |
|---|---|---|---|---|---|---|
| 37° | 8.67" | 15.8" (design: 14") | 17.1" | 12.24" | **23.0"** | 6.4" |
| 30° | 10.39 | 19.3 | 15.5 | 12.77 | 24.0 | 6.6 |
| 25° | 11.53 | 21.6 | 14.2 | 13.19 | 24.9 | 6.7 |
| 8° (ride only) | 14.69 | 27.9 | 9.2 | 14.86 | 28.2 | 6.7 |

- Tow mode sets the lock. The 8 ft (96") curb-to-curb turning radius needs **35° on wagon steer** (edge radius 8.08 ft at 35°, 7.78 at 37°; 9.0 ft at 30°, 10.35 ft at 25°). With Ackermann the same 96" edge radius needs outer wheel 27.9° and inner 41.3° (kingpin spacing 33").
- **The ride-mode lock does not widen the nose**, because the tow-mode lock still governs the hull. Reducing the ride lock helps only the *stops*, not the plan shape.
- **Ackermann widens the allowable nose from 14" to about 23" and moves the pinch point 10-11" aft-to-fore**: the tire envelope behind the axle drops from 17.1" to 6.4". The S-curve (now 28" → 14" across x = 18" to 30.4", about 7" of half-width change) could become 28" → 23" (2.5" per side): **roughly 3× gentler**, or the nose could stay 14-16" and the curve could finish 10" further forward (x ≈ 38-40, leaving more cabin). It also gives the feet and knees room: the legs now span y ±6.5" in a 12.75" inner nose width, which is the real constraint on any control rod.
- Wagon option to widen: relax the 8 ft radius to 9 ft (30° lock): nose to 19", shoulder 1.5" further forward. That is a brief change (Eric).

### 2.4 Self-centering, damping, shimmy

Model: the front axle (wagon) is a caster with trail t = 1.5" (kingpin lead, D-25) + ≈ 0.5" pneumatic trail ≈ 2"; tire cornering stiffness 0.08-0.16 lbf per lbf per degree (small low-pressure tires, assumed); front load 129 lb; steer-body inertia about the kingpin I ≈ 9.8 lb·s²·in (2 wheels at 17.75" dominate). Restoring stiffness K = C_α·t; damping from tire side force c = C_α·t²/v.

| Case | Centering stiffness | Natural frequency | Damping ratio at 10 mph | Reading |
|---|---|---|---|---|
| Wagon, t = 1.5" | 15-31 lb·in per degree | 1.5-2.1 Hz | 0.04-0.06 | rings for 5+ cycles after a bump |
| Wagon, t = 2" (default) | 21-41 lb·in/° | 1.7-2.5 Hz | 0.06-0.09 | same |
| Wagon, t = 3" | 31-62 lb·in/° | 2.1-3.0 Hz | 0.11-0.16 | marginal |
| Ackermann per wheel, t = 1.5-2" | ≈ 16 lb·in/° each | ≈ 9 Hz | ≈ 0.3 | settles in about one cycle |

Ackermann wins on dynamics because the steered inertia is ≈ 35× lower (each wheel ≈ 0.28 vs 9.8 lb·s²·in), not because of the kinematics.

Findings:
- **The wagon axle self-centers well but is lightly damped** (ζ 0.04-0.14). A 2 Hz rocking after every bump is exactly what a rider will feel as a wobble ("shimmy"). It needs a **steering damper**: for ζ = 0.3-0.5 the damping at the kingpin is c ≈ 80-130 lb·in·s/rad, equal to a linear damper of 0.4-0.65 kN·s/m on a 6" arm (a commodity motorcycle steering damper; ≈ 0.7 lb).
- **Steady hand effort is tiny.** Holding a 5° turn at 10 mph (0.15 g) needs about 39 lb·in at the axle (side force 19 lbf × 2" trail) = 1.8 lbf on a 21" tiller or 2.2 lbf on a rein at a 17.75" horn. A transient correction (deflecting 3° against the centering stiffness) takes 5-8 lbf for a second.
- A **centering spring** is not needed at speed (the trail does it), but is needed at rest and at walking pace where there is no tire side force. A pair of bungees (≈ 2 lbf at ±8°) gives a defined neutral for ride mode, and keeps rope reins taut.
- **Ride lock limiter.** Yes for wagon steer: removable pins/blocks at ±8° so a kick or a yank cannot go beyond 8° (the dangerous case is a one-wheel strike or a panicked yank). On Ackermann the same is a pair of bump stops on the tie rod or at the stick, ±8° (±12° for the inner wheel), pinned out for tow.
- Full lock at speed: even if the input is yanked to the 37° tow stops, the cart tip never governs (SSF > 1.0); the wheels plow (slide) rather than turn, so the result is understeer and a hard load on the stops, not a rollover. That is why the limiter protects the *structure* and the rider's arm more than the cart's stability.

### 2.5 Wagon with a reduced ride lock vs Ackermann knuckle steering

| Criterion | Wagon steer + ±8° ride lock | Ackermann knuckles (purchased kart-class spindles) |
|---|---|---|
| Stability at speed (SSF at ride lock, 150/200 lb) | 1.23 / 1.16 | 1.24 / 1.17 (the same): **no difference at ±8°** |
| Stability at tow lock | 1.08 / 1.02 at 37° | 1.24 / 1.17 (track fixed) |
| Steered inertia | 9.8 lb·s²·in; ζ 0.04-0.16 undamped | ≈ 0.28 per wheel; ζ ≈ 0.3 |
| One-wheel strike yaw torque at 10 mph (1.5" step, ≈ 1,300 lbf) | **≈ 23,000 lb·in** about the kingpin (17.75" arm) | **≈ 1,300 lb·in** per knuckle (≈ 1" offset of the contact from the kingpin plane) |
| What carries that torque | steering stops + turntable (the fragile part) | knuckle kingpins and the tie rod: ≈ 430 lbf on a 3" arm (kart tie rods and rod ends are rated for this) |
| Steering-group mass | 25.4 lb now | see Concept A (≈ -18 lb) |
| Parts | turntable, 3 kingpin plates, carrier, crossbar, stand, stops, side bearers, bolster ring... | 2 spindles, tie rod, bellcrank, 2 bump stops, fixed beam |
| Welding | 3 welded parts today (ears, stop stand, brake pivot post) | **none welded in-house**: bolt-on kart spindles (steel, purchased); the outsourced-weld rule of D-46 is not extended |
| Nose width / S-curve | 14" nose fixed by tow lock | 23" possible, S-curve ≈ 3× gentler |
| Tow mode (bridle steering) | as today (bridle at the beam ends, self-centers) | tongue or bridle on the knuckle arms (see §5); needs a bench test, not proven |
| Front brake | cable must cross the kingpin; shoes on the swinging axle | cable to each spindle (flexible Bowden); shoes on the beam |
| Risk | the open front-end problem plus 5-8× load | kart spindle rating and wheel-bore fit (¾" axle) |

Candid conclusion: stability-at-speed does **not** favor Ackermann; the **strike-load path** does, by roughly 9× on the yaw torque.

---

## 3. Rider steering input

### 3.1 Rider geometry (model inches, from `buildModel` with the 150 lb mannequin)
- H-point (12, 0, 11); seat back rails x = 3-8; torso top z = 36.8; head 34.8-45.
- **Shoulder joints ≈ (8.5, ±8.8, 33).** Comfortable one-hand reach for a small scout ≈ 16" from the shoulder, a 68" rider ≈ 18-20" (max 25-30").
- Thighs: x 10.5-28.7, y 0.3-6.5 each side, tops at z 19-25.4. **Gap between the thighs: 0.6".**
- Knees ≈ (27.5, ±3.4, 21.5), top z 25.4. Shins x 25.9-41.5, y 1.0-5.8 (**gap between the shins 2.0"**), z 11-24.6.
- Feet x 38.1-47.6, y 1.4-5.4, z 10-13.4 (**gap between the feet 2.8"**); foot stop x 47.6-48.4; its cleats to 49.6.
- Open lap room outboard of the thigh: y 6.5 to 13.4 (cabin inner wall), 6.9" wide; at the nose the wall is y 6.4 (S-curve from x = 18 to 30.4), so beyond x ≈ 28 the legs fill the hull.
- Kingpin (45.5, 0), front axle x = 44; turntable, bolster, crossbar and access panel occupy x 39.5-51.5, y ±6 at z 7.3-10.
- Front tire sweep zone (tow lock): x 27-50, y 7.8-19.8.

### 3.2 Evaluation

| | (a) Tiller from the axle through a nose-deck slot | (b) Rope reins to the axle ends | (c) Yoke / handlebar ahead of the knees | (d) Side stick at the hip, pull-pull cables |
|---|---|---|---|---|
| Wagon fit | **Fails.** The only place a tiller can leave the steer body is the center, and there the bolster, crossbar and 12" turntable fill the whole nose width (±6 of ±6.4). A slot cuts the structure at the worst spot. The access panel opening (x 43.3-47.8, y ±1.4) is chassis side. | **Fits.** Existing bridle eyebolts at the beam ends (x ≈ 47.7, y ±13.5) → rope along the 8.8" gap between nose and tire → a gunwale fairlead at (28, ±10.5, 18.5) → hand at (22, ±7.5, 24). 27" of rope. | Pivot post would stand between the thighs (0.6" gap) or needs a lap arch (blocks quick exit; §4.7 / seven stations). Hands at x ≥ 26 are 19-23" from the shoulder: out of reach for small scouts. | Fits with cable runs along the gunwale to the beam horns. |
| Ackermann fit | Cable or rod goes to a bellcrank on the fixed beam; no structure conflict, but the rod runs between the shins (gap 2.0") and knees (0.6"): pinch at the knee when the rod moves ±2.4". | Ropes to the steering arms; works. | Same problem as wagon. | **Best fit.** Stick at (18, ±10, 12-26), cables under the gunwale to a bellcrank at (41, 0, 6). |
| Reach | n/a | hands in the lap, 12-14" from the shoulder | needs 19-23" | 12-15": comfortable |
| Pinch points (§4.7) | rod 0.6" off the shins; scissor at the knee | none (ropes run outboard of the legs) | knees under the bar; arch hinge | stick 4" off the thigh; fore-aft swing (±2.5") so no lateral scissor; guard the lower 4" |
| Ratio / precision | hand ±2.8" for ±8° at a 21" tiller: 0.35"/° | **hand ±2.5" for ±8°** at a 17.75" horn: 0.31"/° (twitchy; tremor 0.1" = 0.3°) | drum-driven, ratio chosen: ±30° bar for ±8° | ±17° stick for ±8° wheel: 0.5"/° at the grip: calmest |
| Hand force | 2 lbf steady, 6-8 lbf transient; kick ≈ the full strike torque / 21" → a hand cannot hold it, needs stops | same, rope slack absorbs kicks (one-directional), stops catch | same | same |
| Removable | socket pin, 1 piece | clip two ropes: 0 tools | arch bolts | two pins + two quick links |
| Mass | 1.5 lb (tube) | 0.4 lb | 4.5 lb (arch + bar) | 1.4 lb |
| Buildability | slot through the bolster rails and crossbar | trivial | moderate | moderate: kart pull-pull kit, stick in a socket |
| Whip to full lock at speed | stops | stops | stops | stops |

**Hand-allocation conflict:** two rope reins use both hands; the rider needs one for the brake lever. Solution: one hand on steering (the side stick or one T-handle on a loop), one on the brake lever; or reins plus a **foot-plate brake** (§4.4).

**Verdict:** for wagon steer the only workable input is (b) reins (or (d) with the cables ending at the beam ends); (a) and (c) fail on structure and reach. For Ackermann use (d). Reins are the simplest fallback for both.

---

## 4. Rider brake

### 4.1 Where the existing brake stands
D-38/D-48: oak shoes on the rear tire treads, two shoes on a 7/8" cross shaft behind the rear wheels; the lever pivots at (-9.25, 15, 6.1) with the grip at 30" (22.8" arm), ratio **14.4:1** (critical direction, 20.6:1 servo direction), 25.2 lbf at the goal grip for the 15° hold, grip travel 5.7" (0.243 rad). The check `brake-traction` already reports 0.99-1.00 utilization: the project knew rear-only holds only just on 15°.

### 4.2 Stopping distance from 10 mph (traction-limited)
Quasi-static model with load transfer: N_f,r = W[cosθ·x/L (or (L-x)/L) ± (sinθ + a)·h/L], Crr 0.03; max deceleration before the first axle locks, for front share φ of the brake force. Rider 150 lb (200 lb differs by less than 0.01 g). φ = 0 is today's rear-only brake.

| Slope | μ | φ = 0 (rear only) | φ = 0.3 | φ = 0.4 | φ = 0.5 | φ = 0.6 |
|---|---|---|---|---|---|---|
| flat | 0.35 | 0.22 g, 15 ft | 0.30 g, 11 ft | 0.33 g, 10 ft | 0.38 g, 9 ft | 0.31 g, 11 ft |
| flat | 0.5 | 0.30 g, **11 ft** | 0.39 g, 9 ft | 0.43 g, 8 ft | 0.50 g, 7 ft | 0.47 g, 7 ft |
| flat | 0.7 | 0.38 g, 9 ft | 0.50 g, 7 ft | 0.55 g, 6 ft | 0.62 g, 5 ft | 0.72 g, 5 ft |
| 10° | 0.35 | 0.05 g, 71 ft | 0.12 g, 29 ft | 0.15 g, 22 ft | 0.20 g, 17 ft | 0.13 g, 26 ft |
| 10° | 0.5 | 0.12 g, 29 ft | 0.21 g, 16 ft | 0.25 g, 13 ft | 0.31 g, 11 ft | 0.29 g, 12 ft |
| 15° | 0.35 | **cannot slow** (-0.04 g) | 0.03 g, 126 ft | 0.06 g, 54 ft | 0.11 g, 32 ft | 0.04 g, 91 ft |
| 15° | 0.5 | **0.03 g, 126 ft** | 0.12 g, 29 ft | 0.16 g, 21 ft | **0.22 g, 15 ft** | 0.19 g, 17 ft |
| 15° | 0.7 | 0.11 g, 30 ft | 0.22 g, 15 ft | 0.27 g, 12 ft | 0.34 g, 10 ft | 0.44 g, 8 ft |

Findings:
- **Rear-only is adequate on the flat** (11 ft at μ 0.5, 15 ft wet) and **inadequate on any real descent**: nose-down load transfer cuts the rear share of the load from 63% on the flat to 52% at 15°, so the traction limit (0.5 × N_r = 102 lbf) is only 13 lbf above the 89 lbf needed just to hold 10 mph. At wet μ 0.35 it cannot even hold. The 126-135 ft figure is the practical "can't stop" answer.
- **No pitch-over risk.** The cart pitches over only above 1.5-1.9 g of deceleration, far beyond the traction limit; the earlier `pitch-fwd` check stays at 0.
- **Front brakes are required** for 15° (≈ 40-60% of the braking on the front).
- **Which axle locks first matters for yaw.** Rear-lock-first is the unstable case: a locked rear slides out sideways (the trip hazard from §2.2). Front-lock-first plows straight, which is benign here, because ride mode wants straight-line travel. Bias the front to ≈ 0.5-0.55: lock-first behavior is front above μ ≈ 0.5, with 15-17 ft on 15°. A fixed bias of 0.45 ± 0.1 is the practical target.

### 4.3 Shoe heat on a long descent
Heat flux per shoe contact area (2.5" × 2" = 32 cm² each, as modeled), 70% of the heat going into the shoe, the rest into the rotating tire. Surface temperature rise from the semi-infinite-solid solution ΔT = 2q√t/(√π·e), oak e ≈ 550 W·s^½/m²K. Wood char / lining fade threshold ≈ 250-300 K above ambient.

| Case (held 10 mph) | Shoes | Flux | ΔT at 1 s | 2 s | 5 s | 6.8 s (100 ft) | Time to 250 K |
|---|---|---|---|---|---|---|---|
| 15°, 150 lb | 2 (rear) | 16.8 W/cm² | 340 K | 480 K | 770 K | 890 K | **0.5 s** |
| 15°, 150 lb | 4 | 8.4 | 170 | 240 | 380 | 450 | **2.1 s** |
| 15°, 200 lb | 4 | 9.6 | 200 | 280 | 440 | 510 | 1.6 s |
| 10°, 150 lb | 4 | 5.2 | 110 | 150 | 240 | 280 | 5.6 s |

(Uniform contact assumed; real patches are hotter. The tire bulk stays cool: 270 W into about 1.2 kg of tread is under 1 K per 100 ft; only the shoe surface is at risk.)

**Result: shoes on the tire tread cannot hold 10 mph on 15° continuously**; with four shoes the wood chars in about 2 s (30 ft). Remedies:
1. **Thermal mass behind a lining.** A pair of steel drums/discs of 0.9-1.8 kg total absorbs 10.5-12 kJ per 100 ft with only 7-27 K rise: tread-shoes do not offer that. That means a brake on the wheel hub, a drum or disc, which the project rejected in D-13 because it needs a live axle or hub mount.
2. **Larger lined shoes:** four shoes of 4" × 2.5" with a steel backing halve the flux (≈ 8 s of margin at 15°, about 125 ft of descent), then cool.
3. **Duty-cycle the descent:** use feathering and pauses; budget about 100 ft of continuous 15° then 30 s to cool.
4. **Ground-drag or rope tether** for the long slopes: the rear handler tether (D-13) already exists and the rider uses it with a handler; ride mode alone must be told "the cart is for up to ≈ 100 ft of continuous 15° or 150-250 ft of 10°".
5. **Reduce speed** (heat per distance is independent of speed; power drops with it).

This is a **decision for Eric** (§6); it is not solvable by lever geometry.

### 4.4 Rider lever, mechanism, ratio and force
- **Location:** left hip, same side as the handler's lever, so the cable run is short (≈ 28") and the right hand is free for the stick. Pivot on the gunwale at (15.0, +14.3, 11.5), hand grip at **(14.5, +13.3, 20)**, forward of the grab handle (x 7-13.5), 9" arm, swings 40° rearward (6.3" of travel) toward the rider's hip. Reach from the left shoulder (8.5, 8.8, 33): dx 6, dy 4.5, dz 13 = **15.2"** (comfortable for a small scout).
- **Cable:** 1/8" 7×19 stainless in a lined housing along the left rail to the cross shaft area; end in a **slotted lost-motion link** on the main lever at 4.1" above its pivot (-9.25, 6.1). The slot is 1.4" long, so the handler's lever can move without back-driving the rider lever (the slot slides free), and the rider's pull takes up the slack and moves the main lever. A light return spring on the rider lever keeps the cable taut. The ratchet pawl keeps working on the main lever (the rider can set the parking brake by pulling hard; the thumb tab to release is at the handler's lever: **decision**).
- **Force:** the work to apply the brake is constant, 25.2 lbf × 5.7" ≈ 140 in·lb at the goal-rider hold (mud-fouled lining). A hip lever with a 6" stroke needs **≈ 23-26 lbf** at the grip (cable tension ≈ 140 lbf, 560 lbf under the 100 lbf abuse load: 1/8" cable at 2,000 lbf breaking is SF 3.5). A bicycle lever (1-2" of stroke) would need 70-140 lbf: not usable. Stopping at 0.25-0.3 g on flat takes 76-106 lbf of brake force = 15-26 lbf at the grip.
- **Front brake (the §4.2 requirement):** add a mirror brake at the front tires on the beam, driven by a second cable from the same main lever; it is on the steer body in the wagon case (a cable crossing the kingpin; unusable at the 37° tow lock, so disconnect for tow) and on the fixed beam in the Ackermann case (a Bowden cable per spindle bracket). About 4-5 lb.
- **Alternative to the hand lever: a foot plate** at the foot stop (feet are already there; leg force 47 lbf on 3" is easy), pedal pivoting at (47, 0, 10), cable under the deck to the shaft. Leaves both hands for steering. Only if Eric prefers it; it also makes the foot stop dual-purpose, so the stop must be re-checked.
- **Pinch points:** hip lever sweeps outboard of the thigh by 4+" and against the gunwale (no scissor); the slotted link is at the rear corner, away from the rider and clear of the handler's hand (the lever grip at 30" is untouched).
- Mass: lever 0.5, bracket 0.3, cable and housings 0.4, slot link 0.15, spring 0.05 = **1.4 lb**.

---

## 5. Two complete ride-mode concepts

### Concept A (recommended): Ackermann kart-spindle front, side stick, four-wheel shared-shaft brake

**Description.** Delete the turntable front end. The front axle becomes a **fixed beam** bolted to the rails (as the rear beam already is), carrying two purchased kart-class steel **spindles with kingpins** (¾" axle size, to verify against the wheel bore). A 31" tie rod sits behind the beam; a center bellcrank on the beam drives it. Ride input is a **removable side stick** on the right hip with pull-pull cables. Tow input is a short oak **tongue** hinged at the beam center (pull transmitted straight into the beam) linked to the same bellcrank. Brake: the existing cross shaft plus a hip lever at the left hip and a front shoe set; either lever applies.

**Key points (model inches; x forward, y left, z up).**
- Kingpin axes: (45.5, ±16.5), z 5-8, caster 5°, trail 1.5-2". Wheel centers (44, ±17.75, 6.5). Fixed beam: x 42.9-46.9, y ±16.1, z 4.4-6.9 (same envelope as today's `beam-F`).
- Steering arms (3", toward the rear axle center for Ackermann, 20° inboard): tips at (42.7, ±15.5, 5). Tie rod: (42.7, -15.5) to (42.7, +15.5).
- Bellcrank pivot (41, 0, 5); pitman 3" arms to ±3; tongue pivot (47.2, 0, 5.5), tongue to (65, 0, 5.5), ±25° of swing.
- Ride lock: bump stops at the tie rod for ±8° outer / ±12° inner wheel (pins, 2 pieces) for ride mode; removed for tow (outer 27.9° / inner 41.3° for the 8 ft turn).
- Side stick: pivot (18, -10, 12), grip at (18, -10, 26) (fore-aft swing ±17°); finger guard on the lower 4". Cable path: stick drum → along the right gunwale underside at z ≈ 9 → bellcrank (41, 0, 5). Reach from the right shoulder (8.5, -8.8, 33): 11.9".
- Hip brake lever: pivot (15.0, +14.3, 11.5), grip (14.5, +13.3, 20); cable → slot link at the main lever (-9.25, 15, 10.2), 1.4" slot.
- Front shoes: pivot on the beam at (41.5, ±16.5), shoes on the rear-lower tread of each front tire (11° below the axle line, as at the rear); cable from a lever on the main-lever extension.
- Nose and hull: nose width up to 23" (S-curve end at x ≈ 38 instead of 30), the shoulder at x = 28 can move forward; legs gain room.

**Mass delta (estimate).**

| Item | lb |
|---|---|
| Remove turntable system (turntable 5.5, carrier 5.1, under plate 1.6, crossbar 1.4, stops and stand 2.9, bolster rails 4.9, sleeve, pin, ears, bearers, panel ≈ 2.7) | -23.5 |
| Remove the front axle rod and its clamps | -6.5 |
| Add 2 spindles + kingpin hardware | +4.0 |
| Tie rod, ends, bellcrank, steering arms | +2.0 |
| Tongue with hinge, ride-lock stops | +2.0 |
| Beam mounting plates and bolts | +1.5 |
| Side stick, cables, pulleys | +1.4 |
| Hip brake lever, cable, slot link | +1.4 |
| Front brake set (shoes, brackets, cables) | +4.5 |
| **Net** | **≈ -11 lb (169 → ≈ 158)**; range -8 to -14 |

(Tow-mode steering stays with removable parts counted in the Removable group.)

**Replaces:** D-12 (lazy susan, ½" kingpin), D-25 (kingpin lead, kept as spindle trail), D-35/D-43/D-46/D-47 (crossbar, kingpin plates, stops with shim packs, ears, carrier plate, turntable-ring row), the bolster and side bearers, the `steer-stops*`, `turntable*`, `kingpin-*`, `roll-*` checks. Keeps D-13/D-38/D-39/D-48 (shoes, shaft, lever, ratchet, lining), and adds front shoes. Needs a new steering-and-spindle check family (tie rod, arm, kingpin bending, tow-tongue pull).

**Open front-end problem.** It **dissolves**: no fragile stops, no turntable ring, no welded ears, and the +11 lb is removed rather than added. The shoe heat and the wheel rating remain.

**Risks.** (1) Kart spindle rating and wheel bore: confirm with a vendor (target: ≥ 1,500 lbf vertical, ≥ 1,000 lbf tie-rod). (2) Tow mode via a tongue on Ackermann is not proven: bench test, including self-centering under pull (tie eye ahead of the kingpin) and straight-ahead drift. (3) Brake heat (§4.3) is unresolved by this concept alone. (4) Wheel rating for 10 mph strikes (§1.4). (5) A wider nose changes the look the visual critic liked (D-45): the curve is gentler, not worse.

### Concept B (fallback): keep the wagon, add a ±8° ride lock, damper, reins and front brake

**Description.** Keep D-12/D-25/D-43/D-46/D-47 as they are. Add (i) removable ride-lock pins at ±8°, in the stop stand; (ii) a steering damper (0.5 kN·s/m, ≈ 0.7 lb) between the beam and the chassis and two bungee centering cords; (iii) two **rope reins** from the bridle eyebolts back to hands; (iv) the hip brake lever and a front brake whose cable passes beside the kingpin.

**Key points.**
- Eyebolts (47.7, ±13.5, 5.6); rope along y ±11-13 at z 6, up to the gunwale fairleads at (28, ±10.5, 18.5); hand parked at (22, ±7.5, 24). 27" per rein. Tied off to the front bridle ropes' loops for tow.
- Ride-lock stops at ±8° beside the existing stand at (45.5, ±3.6) (new pinned blocks). Damper: body pinned on the bolster (41, +4.5, 8.5), rod to the beam (44, +8.5, 5.5).
- Front shoe set on the steer body; cable beside the kingpin at (45.5 ± 1.5, 0).
- Hip lever: identical to Concept A.

**Mass delta.** Rider lever and cable +1.4; front brake +4.5; damper and bungees +0.9; ride-lock pins +0.5; reins +0.4 = **+7.7 lb (≈ 177)**. Strengthening the front end for 10 mph strikes (5-8× load, §1.4) is on top: +8-15 lb if the stop stand and turntable are redesigned, probably more.

**Replaces:** nothing; it adds. It changes `dynamicFactor`/`curbStrikeG` rules for ride mode and adds rows for the damper and reins.

**Open front-end problem.** It becomes **worse**: the already-failing `steer-stops`, `turntable-ring` and `kingpin-bolts` (2.1, 1.4, 1.2) face 5-8× more load, and the one-wheel strike yaw torque (≈ 23,000 lb·in) cannot be carried by a 12" lazy susan with a 5" stop couple. Ride mode would need a speed cap on rough ground. Only credible if Eric accepts "ride mode: 10 mph on smooth ground, walking pace over obstacles taller than 1" (a rule of use, not a design).

**Risks.** Everything in Concept A's "dissolves", plus: lightly damped axle (needs the damper to be done right); reins need two hands; the brake cable crossing the kingpin; a non-proven wagon at 10 mph.

### Candid answer
**Yes: ride mode at 10 mph makes turntable wagon steer the wrong architecture.** The 17.75" lever arm turns a wheel strike into a 9× larger torque on the weakest part of the cart, the axle swing gives a lightly damped 2 Hz wobble, and the one thing wagon steer was chosen for (no welding, simple tow-bridle steering) is matched by bolt-on kart spindles with a tongue. Eric's "minimal steering" clarification shrinks the *steering authority* needed to ±8°, which is why the ride lock and reins are easy, but it does not shrink the *load path*. Stability at speed (SSF) is the same for both; the decision is made by strike loads, steered inertia and mass. If Eric weights "no rework of the front end" above all, take Concept B and accept the speed rule.

---

## 6. Decisions for Eric

1. **Steering architecture:** Concept A (Ackermann kart spindles, ≈ -11 lb, dissolves the front-end problem) or Concept B (wagon + ride lock, ≈ +8 lb plus front-end strengthening, speed rule on rough ground)?
2. **Ride lock:** ±8° recommended (±6° minimal, ±10° maximum). The tow lock stays 37° (wagon) / 28° outer, 41° inner (Ackermann) for the 8 ft radius, unless you relax the radius to 9 ft (wagon 30°, nose 19").
3. **Rider input:** single side stick with cables (Concept A) vs rope reins (Concept B or simplest fallback). Left hand brakes, right hand steers.
4. **Design strike for ride mode:** 1.5" step at 10 mph (both wheels ≈ 2,200 lbf horizontal / 2,700 lbf vertical) and keep today's 3× only for tow? Or adopt a lower ride speed on rough ground?
5. **Wheels:** require 600 lb-rated wheels (or bigger) for ride mode, since the wheel is the fuse at 10 mph.
6. **Front brake is required for 15°** (rear-only cannot slow it). Choose the front brake bias (≈ 0.5, front-lock-first) and accept +4.5 lb.
7. **Brake heat:** tread shoes cannot hold 15° for more than about 2-6 s. Accept (a) a duty-cycle rule, ≈ 100 ft of continuous 15° and ≈ 250 ft of 10° per run (with the rear-handler tether for longer), (b) lined 4"×2.5" shoes with steel backing (roughly doubles it), or (c) reopen D-13 for a wheel-hub drum or disc?
8. **Parking brake from the rider's lever:** allow setting with the ratchet, release at the rear lever only?
9. **Hip lever vs foot plate** for the rider brake.
10. **Hill:** the 15° design slope with a 100 ft continuous run needs the answers above; a verify-at-camp plan for Q-4 is advisable.

## 7. Method, assumptions and open points
- Scripts (not in the repo): `/private/tmp/claude-502/-Users-eschrock-dev-klondike-car/a02116e9-81a4-4f6c-b178-5a454857e24d/scratchpad/{calc,study,stop,checks,brk,m}.ts`, run via `node scripts/run-ts.mjs`.
- The `runChecks` baseline was taken on a working tree that another session is editing (`src/analysis/front.ts`, rider sweep, Simple view); the three already-failing rows (`steer-stops` 2.11, `steer-stops-bound` 1.36, `kingpin-bolts` 1.20, plus `turntable-ring` 1.37) may move.
- Assumed, not measured: tire cornering stiffness (0.08-0.16 per degree), tire/structure stiffness after bottoming (1,000-2,000 lb/in), steer-body inertia (9.8 lb·s²·in estimated from part masses), oak thermal effusivity, heat partition 70/30, CdA 0.5 m², Crr 0.03, friction μ 0.35-0.7, 5th-percentile reach 16". The 10 mph strike ratios depend on k and the participating mass; the bracket is stated, the sim can narrow it.
- The yaw torque on the stops assumes the axle cannot "flop" absorb energy before it reaches the stop; at the 8° ride lock the free swing is only about 2.5" at the wheel, so the bound is conservative by perhaps 20-50%.
- Mass deltas are ±30% estimates until each part is modeled.
- No state-changing git command was run; nothing under `src/` was edited.
