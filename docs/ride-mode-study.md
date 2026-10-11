# Ride-mode design study (BRIEF §4.3a, D-49), revision 2

Status: **study only, nothing in `src/` changed.** Revised after the round-1 critic (`docs/reviews/ride-mode-study-round1.md`, 6/10). Numbers come from closed-form scripts run against the live model (`buildModel`, `computeLayout`, `buildLoadModel`, `brakeGeometry`, `runChecks`) on the 2026-10-11 working tree: empty cart 169.0 lb, 13" wheels, wheelbase 44", track 35.5", kingpin x = 45.5". The Rapier sim was not used. US units: inches, pounds, degrees, mph.

## 0. Requirements and the short answer

Requirements in force (BRIEF §4.3a, D-49, Eric's answers):
- Ridden downhill by one rider alone; **"up to" 10 mph** (a ceiling the rider brakes to, not a speed the cart holds by itself).
- **Hill unknown: 15° maximum slope.**
- Brake usable by rider and rear handler: one mechanism, two levers.
- No pinch points (§4.7); no input that can whip the steering to full lock; controls removable for tow mode.
- **Owner clarification (Eric, 2026-10-11): "When going downhill there will be minimal steering. This is not something where we're navigating some complex route, just some steering to help keep it straight."** Ride mode is straight-line tracking with small corrections; self-centering and straight-line stability matter more than authority; the simplest, lightest input is preferred. Rollover is checked at the limited ride lock.

What the study found, in order of importance:

1. **The binding problem is braking friction, not steering.** On the project's own wet-leaf friction (D-16, μ 0.3) a 15° slope leaves **0.06 g at best** of stopping ability with perfect four-wheel proportioning, and at μ 0.2 no wheel brake can slow the cart at all. The tread-shoe brake also chars in 0.5-8 s of a held 15° descent. Neither concept below fixes that; only a **use envelope** (slope × friction × speed rules) and a fail-safe (rear-handler tether) do (§1).
2. Steering needs only **±8°** (§3). The wagon and Ackermann have the same tip stability at that lock; the architecture choice is made by the strike load path, steered inertia and mass.
3. A 10 mph strike is **5-8× today's load** (§2). That charges mass to *every* concept (rated wheels, rear axle, rails, bearings), and a 5 mph procedural limit on rough ground halves it.
4. Four concepts compared (§7): A Ackermann on rated spindles, B wagon with ride lock, C wagon pinned straight in ride mode, D purchased rated slewing ring. **Revised pick: A as the architecture, inside the envelope of §1; D if Eric wants to keep the wagon.** A is *not* "-11 lb and the front-end problem dissolved": it is about break-even in mass once strike survival is charged to both, and it removes the stops/ring/ear weldment, not the strike itself.

---

## 1. Operating envelope (decide this before the architecture)

### 1.1 Can the brakes slow the cart? Slope × friction

Best-case four-wheel deceleration (ideal proportioning, nothing locks early) is a = μ·cosθ - sinθ + Crr·cosθ (Crr 0.03). **Practical** deceleration uses a fixed front share of 0.5 (the rear locks first only above that share's limit, `stop.ts`), 150 lb rider; the 200 lb rider differs by under 0.01 g. Rear-only (today's brake) is bracketed. "NO" means < 0.02 g.

| Slope | μ 0.2 (slick clay, frost) | μ 0.3 (wet leaves, D-16) | μ 0.5 (damp dirt, D-16) | μ 0.7 (dry hardpack) |
|---|---|---|---|---|
| 5° | 0.12 g **CAUTION** [rear-only 0.06] | 0.23 g GO [0.11] | 0.41 g GO | 0.53 g GO |
| 8° | 0.07 g **NO** [NO] | 0.17 g CAUTION [0.06] | 0.35 g GO [0.15] | 0.48 g GO |
| 10° | 0.03 g **NO** | 0.14 g CAUTION [0.02] | 0.31 g GO [0.12] | 0.44 g GO |
| 12° | NO | 0.10 g **NO/CAUTION** | 0.28 g GO [0.08] | 0.40 g GO |
| 15° | NO (ideal -0.04) | **0.05 g NO** (ideal 0.06) | 0.22 g GO [0.03] | 0.34 g GO [0.11] |

(GO ≥ 0.2 g, CAUTION 0.1-0.2 g, NO < 0.1 g in practice. The lowest μ for which even ideal braking gives 0.05 g: 0.11 at 5°, 0.17 at 8°, 0.20 at 10°, 0.24 at 12°, 0.29 at 15°.) **Rear-only [bracketed values] is not an option above 5°.**

### 1.2 Stopping distance including a 1 s reaction

From the moment the hazard is seen, with the cart rolling at the ride speed (the cart keeps gaining speed during the reaction). Practical bias 0.5, μ 0.5 (the design number); [rear-only].

| Slope | Speed at brake onset (from 10 mph) | Distance during the 1 s | Total, 10 mph | Total, 5 mph |
|---|---|---|---|---|
| 5° | 11.3 mph | 16 ft | 26 ft [36] | 11 ft |
| 8° | 12.4 | 16 | 31 [50] | 14 |
| 10° | 13.2 | 17 | 35 [66] | 17 |
| 12° | 13.9 | 18 | 41 [98] | 20 |
| 15° | 15.0 | 18 | **53 [305]** | 26 |

At μ 0.3: 15° gives 183 ft (10 mph) / 84 ft (5 mph); 10° gives 59 ft / 26 ft. The earlier "15-17 ft on 15°" was brake-onset-to-stop at μ 0.5 only; **the design figure is 53 ft from 10 mph**. A rider needs 50-70 ft of sight distance at 10 mph; at night that is a daylight-only rule (§6).

### 1.3 What bounds the speed when the brake fades or the friction is gone

Nothing in the cart does: terminal speed is above 50 mph. Unbraked from 10 mph on 15° the cart is at 19 mph after 50 ft and 25 mph after 100 ft (Crr 0.03). A speed *rule* does not bound a runaway either (from 5 mph it reaches 19 mph in 50 ft). Only these bound it:

1. **Rear-handler tether always attached when the slope is steeper than 8° or μ is in doubt.** The handler holds back roughly W·sinθ = 89 lbf at 15°; they must be a person who can plant and brace (an 80-90 lbf sustained pull is the limit for an adult; the existing D-39 sockets check a 50 lbf pull). A tether turns a runaway into a handler decision.
2. **Slope and friction rules (§1.1):** ride only where the table is GO; **walk-it-down** (the rider off, the handler brakes) where it is not.
3. **Stop-and-cool rule:** at most ≈ 100 ft of continuous 15° or ≈ 250 ft of 10° per run, then cool (heat, §5.3).
4. **Fade is a rider-safety condition,** not maintenance: if the lever travel grows, the smell of charring wood, or the cart is not slowing, the rider calls "tether" and lets the handler take it. Fail-safe hardware (a ground-drag skid blade on the rear transom operated by the same lever) is an option, not designed here.

### 1.4 What a 5 mph procedural limit buys

Strike force is ∝ v, brake power ∝ v, kinetic energy ∝ v², braking distance ∝ v², heat energy per distance is unchanged. Strike (1.5" step, both wheels, 129 lb front mass, 3,000 lb/in total; §2.2): **10 mph 2,275 H / 2,740 V; 5 mph 1,140 H / 1,370 V** = 3.5× and 4.3× of today's 321 H instead of 7×. Brake distance from 5 mph on 15° at μ 0.5 is 26 ft (vs 53), and 84 ft (vs 183) at μ 0.3. **Recommended: "up to 10 mph on smooth, signed runs; 5 mph (walking beside a handler's pace) wherever the surface has steps of 1" or more or the table shows CAUTION."**

---

## 2. Speed, energy and impact

### 2.1 Method
Mass and CG from `buildLoadModel` (150 lb rider + 25 lb cargo = 344 lb; 200 lb + 25 = 394 lb). Crr 0.015 / 0.03 / 0.06; CdA 0.5 m²; wheel inertia +5%.

### 2.2 Speed on the slope, free roll

| Slope | Crr | Terminal | 10 mph at | 20 mph at |
|---|---|---|---|---|
| 15° | 0.015 / 0.03 / 0.06 | 77-85 mph | 2.0 / 2.1 / 2.4 s (14 / 15 / 18 ft) | 4.0 / 4.3 / 4.9 s (59 / 63 / 73 ft) |
| 10° | 0.015 / 0.03 / 0.06 | 54-68 mph | 3.0 / 3.4 / 4.2 s (22 / 25 / 31 ft) | 6.2 / 6.9 / 8.8 s (93 / 103 / 132 ft) |

Unbraked after 100 ft: 25 mph on 15°, 20 mph on 10°. The brake, not the hill, sets the speed.

Brake energy at a held 10 mph (Crr 0.03): 10°: 6.5 / 7.5 kJ per 100 ft (150 / 200 lb); **15°: 10.5 / 12.1 kJ, 1.55-1.77 kW**, 6.8 s per 100 ft.

### 2.3 Strike load at 10 mph, replacing "(rider + cargo) × 3"

Today's rule is quasi-static (H = V·tan φ with V = 3 × static wheel load) and has no speed: it equals a strike of about **1.6 mph** in the model below (F ∝ v, 10/6.2).

**Method (velocity-change pulse).** The wheel (r = 6.5") meets a step h; the contact normal is tilted β above horizontal, sin β = (r - h)/r. The normal-direction velocity v_n = v·cos β is absorbed by the tire/rim/structure spring: F_n = v_n·√(k·m_e); horizontal part F_n·cos β, vertical F_n·sin β. v = 4.47 m/s; both wheels (k doubles); **base case k = 1,500 lb/in per wheel (3,000 total) and m_e = the front-axle load (129 lb)**. A free 13" × 4" pneumatic is ≈ 200 lb/in with 1.5" of travel: it absorbs ≈ 25 J per wheel against ≥ 400 J, so it bottoms out above a 1" step and the stack stiffness takes over. The pulse lasts **≈ 33 ms** (half period of ω = √(2k/m_e) = 95 rad/s), not 10 ms.

| 1.5" step, 150 lb rider | Horizontal (both wheels) | Vertical (both) | × today (321 lbf) |
|---|---|---|---|
| **Base, 10 mph** | **2,275** | **2,740** | **7×** |
| Base, 5 mph | 1,140 | 1,370 | 3.5× |
| k = 1,500 lb/in total | 1,600 | 1,930 | 5× |
| k = 6,000 lb/in total | 3,220 | 3,880 | 10× |
| m_e = whole cart (344 lb) | 3,715 | 4,470 | 11.6× |
| m_e = 60 lb (pitch-inertia mass for the vertical pulse; the cart pivots about the rear axle) | 1,550 | **1,870** | vertical overstated by ≈ 30% in the base |
| Tire does not bottom (k ≈ 800 total) | ≈ 1,175 | | 3.7× |

Other steps (base case, 10 mph): 2" root 2,370-3,350 H; 3" curb 3,230-4,560 H (today 402 / 604). The vertical component is 2,000-3,000 lbf across both wheels for any step ≥ 1" (it peaks near β = 45°), i.e. 1,000-1,500 per wheel against the 600 lbf peak allowance of a 300 lb wheel, so **the wheels are a fuse unless they are ≥ 600 lb rated; so are the axles and bearings** (§2.4). A 3" curb square-on at 10 mph is an accident, not a design load.

**Proposed rule:** ride mode, **1.5" step at 10 mph ultimate, 3,000 lb/in** → both wheels ≈ 2,300 lbf H / 2,700 lbf V (one wheel ≈ 1,600 H); at 5 mph on rough ground half of that. Tow/walking pace keeps today's 3× on the 3" curb. Rider restraint: the cart pulse peaks at ≈ 6-8 g for 33 ms; replace `curbStrikeG` = 2 with **4** (foot stop, grips) for ride mode.

### 2.4 Axle, spindle and bearing under the strike (both concepts, front and rear)
A 3/4" solid stub or axle (S = 0.0414 in³): a resultant of 1,000-1,500 lbf at 2.0-2.25" from the support is **48-81 ksi bending**, at or beyond the yield of 1045/1018 (54-77 ksi). A 5/8" kart stub (S = 0.024) is 83-141 ksi: fails. A 1" stub (S = 0.098) is 20-34 ksi: passes with 1045 or 4140. Flanged 3/4"-bore ball bearings (static rating of order 1,000-1,900 lbf) are brinell-marginal. So the rated-wheel / 1" axle / bearing upgrade applies to **A, B, C and D alike** and is charged in §7. "Kart spindles are rated" is withdrawn; the spindle class must be lawn-tractor / ATV / trailer with a forged 3/4-1" stub and a published rating.

### 2.5 Which existing checks fail at the new load (estimate)
Linear scaling of today's goal utilizations by 5-6× (strike and axle rows) or 1.7-2× (rider restraint); a crude upper bound, to be replaced by a rated sim.

| Check | Today | At 10 mph, 1.5" |
|---|---|---|
| `steer-stops`, `steer-stops-bound` | **2.11, 1.36 (fail)** | ≈ 10, 7 |
| `turntable-ring`, `kingpin-bolts` | **1.37, 1.20 (fail)** | ≈ 7, 6 |
| `kingpin-strike`, `roll-side-bearer`, `kingpin-split`, `kingpin-plates`, `turntable` | 0.68, 0.86, 0.80, 0.60, 0.71 | ≈ 3.5-5 |
| `axle-stress`, `wheel-rating`, `bearing-groove` | 0.80, 0.62, 0.93 | ≈ 3-5 |
| `rear-beam-seat`, `rails`, `roll-bolster-attach` | 0.88, 0.69, 0.37 | ≈ 2-4 |
| `seat-grip`, `seat-back`, `foot-stop` | 0.83, 0.59, 0.33 | ≈ 1.4, 0.8-1.0, 0.66-1.0 |

---

## 3. Rollover and steering at speed

### 3.1 Steering range needed for "keep it straight"
Correction arcs: lateral shift Y over distance D uses R = D²/(4Y); steer = atan(44"/R). At 10 mph:

| Maneuver | Radius | Steer | Lateral accel |
|---|---|---|---|
| Road bend 100 ft / 50 ft | 100 / 50 ft | 2.1° / 4.2° | 0.07 / 0.13 g |
| Trail bend 30 ft | 30 ft | 7.0° | 0.22 g |
| Swerve 3 ft in 20 ft (dodge a rock) | 33 ft | 6.3° | 0.20 g |
| Swerve 4 ft in 25 ft | 39 ft | 5.4° | 0.17 g |
| Swerve 3 ft in 15 ft (hard) | 19 ft | 11.1° | 0.36 g |

**±8° covers everything "keep it straight" needs** (±6° is the minimum; ±10° the most). Beyond that the cart can only slide.

### 3.2 Static stability factor, real wheel contacts

| Lock | SSF 150 lb | SSF 200 lb | Empty |
|---|---|---|---|
| 0° | 1.238 | 1.173 | 1.93 |
| 8° (ride lock) | **1.227** | **1.163** | 1.91 |
| 20° | 1.190 | 1.128 | 1.84 |
| 37° (tow) | 1.076 | 1.020 | 1.63 |

At 8° the cart tips at 1.16-1.23 g and a 10 mph 8° turn pulls only 0.26 g (4.5× margin). The tires slip first: 0.5 g at μ 0.5 (R 13.4 ft, 15° of steer), 0.35 g at wet μ 0.35. **Recommended safe steer angle at 10 mph: 8°** (0.26 g). The real rollover is a **trip**: the cart rolls over its wheel line when it gains W·(√(d²+h²) - h) = 8.3" × 344 lb = 323 J, i.e. a **sideways slide of ≥ 4.5 mph hooking a rut or curb**. The slide comes from rear-wheel lockup (§5.2), not from steering.

### 3.3 Geometry at the nose (A-4 clearance, tire as a full-radius rectangle)

| Lock | Wagon: inner tire y → max nose | Behind the kingpin | Ackermann (wheel pivots on its center): inner y → max nose | Behind the axle |
|---|---|---|---|---|
| 37° | 8.67" → 15.8" (design 14") | 17.1" | 12.24" → **23.0"** | 6.4" |
| 30° | 10.39 → 19.3 | 15.5 | 12.77 → 24.0 | 6.6 |
| 8° (ride only) | 14.69 → 27.9 | 9.2 | 14.86 → 28.2 | 6.7 |

The tow lock governs the hull. The 8 ft (96") edge radius needs **35° on wagon** (8.08 ft; 7.78 ft at 37°) and, ideal Ackermann with 33" kingpin spacing, **outer 27.9° / inner 41.3°** (97" rectangular-tire edge radius: *zero margin* on a spindle stop; kart/tractor spindles commonly stop at 25-30°; a 9 ft radius (108") needs outer 24.5° / inner 34.8°). **Ride-lock stops on an Ackermann cart: outer 8° / inner 8.9°** (ideal geometry; the 3"/20.5° trapezoid gives 9.3° at 10°). Ackermann lifts the nose limit from 14" to about 23" and moves the pinch 10.7" forward (tire sweep behind the axle 17.1" → 6.4"): the S-curve (28 → 14") could become 28 → 23, or end 10" further forward. Wagon alternative: relax the radius to 9 ft (30° lock, nose 19").

### 3.4 Self-centering, damping, shimmy
Wagon: trail t = 1.5" + 0.5" pneumatic ≈ 2"; C_α 0.08-0.16 per degree (assumed); front load 129 lb; steered inertia I ≈ 9.8 lb·s²·in.

| Case | Centering | Natural frequency | Damping ratio at 10 mph |
|---|---|---|---|
| Wagon t = 1.5-3" | 15-62 lb·in/° | 1.5-3.0 Hz | 0.04-0.16 |
| Ackermann per wheel (I ≈ 0.28), t = 1.5-2" | ≈ 16 lb·in/° each | ≈ 9 Hz | ≈ 0.26-0.3 (quasi-steady tire) |

- **Wagon:** lightly damped; a 2 Hz wobble after each bump. A damper of 0.4-0.65 kN·s/m (a 6" arm; ζ 0.3-0.5, 80-130 lb·in·s/rad) is needed. The wheel's first harmonic (rotation 1.5-2.5 Hz) excites it at **3.5-5.8 mph**, inside the envelope.
- **Ackermann:** the quasi-steady tire model overstates damping at 9 Hz (tire relaxation length ≈ r/2 puts the tire corner at ≈ 5 Hz). More importantly the wheel turns at 4.3 Hz at 10 mph, so its **second harmonic, 8.6 Hz, coincides with the 9 Hz steering mode at the design speed**. 13" pneumatics have visible runout. **This must be bench-checked**; mitigations are play-free rod ends, bushed kingpins and an optional damper.
- **Steady effort is tiny:** holding a 5° turn takes 39 lb·in at the axle (1.8 lbf on a 21" tiller, 2.2 lbf at a 17.75" rein). Transient 3° corrections 5-8 lbf for a second. A centering spring/bungee (≈ 2 lbf at ±8°) gives a defined neutral at rest where there is no tire side force.
- **Limiter:** pinned ride stops at ±8° (wagon) or at the tie rod (Ackermann: outer 8°, inner 8.9°). Even yanked to the tow stops, the cart does not tip (SSF > 1.0); it plows. The limiter protects the structure and the rider's arm.

### 3.5 Wagon with reduced ride lock vs Ackermann

| Criterion | Wagon + ±8° | Ackermann on rated spindles |
|---|---|---|
| SSF at ride lock (150/200) | 1.23 / 1.16 | 1.24 / 1.17: **no stability difference** |
| Steered inertia, ζ at 10 mph | 9.8; 0.04-0.16 | ≈ 0.28 per wheel; ≈ 0.3 (bench-check 8.6 Hz) |
| One-wheel strike yaw torque (1.5" step, 10 mph) | **≈ 23,000-28,500 lb·in** on the stops (17.75" arm) | **≈ 1,300-4,800 lb·in per knuckle** (1-3" force-line offset; 4" tire struck on its edge); **ratio 6×-18×** |
| Load on the linkage | stop stand and turntable (fragile) | tie rod ≈ 430-1,600 lbf on a 3" arm; kart 5/16" rod ends are *not* safe at the top; use a ½" rated rod end |
| Welding | 3 welded parts today | the spindle mounts must be bolt-on U-brackets or purchased bolt-on mounts; otherwise an outsourced weld returns (D-46) |
| Tow mode | bridle at the beam ends, self-centers | tongue (§7.1); no self-centering at rest, needs spring |

---

## 4. Rider steering input

### 4.1 Rider geometry (model inches, 150 lb mannequin)
H-point (12, 0, 11); shoulders ≈ (8.5, ±8.8, 33); comfortable one-hand reach 16" (small scout) to 18-20" (68" rider). Thighs x 10.5-28.7, y 0.3-6.5, tops z 19-25.4 (**0.6" between the thighs**); knees ≈ (27.5, ±3.4, 21.5); shins x 25.9-41.5 (**2.0" between**); feet x 38.1-47.6, y 1.4-5.4 (**2.8" between**); foot stop 47.6-48.4. Lap room outboard of the thigh y 6.5-13.4 (6.9" wide). Turntable, bolster, crossbar and access panel fill x 39.5-51.5, y ±6.

### 4.2 Evaluation

| | (a) Tiller through a nose slot | (b) Rope reins | (c) Yoke ahead of the knees | (d) Side stick at the hip, pull-pull cables |
|---|---|---|---|---|
| Wagon | **Fails:** the only exit is the center, where the bolster/crossbar/12" turntable fill the nose (±6 of ±6.4) | **Fits:** eyebolts (47.7, ±13.5, 5.6) → rope along y ±11-13 → fairlead (28, ±10.5, 18.5) → hand (22, ±7.5, 24); 27" per rein | post between the thighs or a lap arch (blocks quick exit) | cables to the beam horns |
| Ackermann | rod between shins (2.0") and knees (0.6"): pinch | to the steering arms | same | **best:** stick (18, -10, 12-26), cables to a bellcrank (41, 0, 5) |
| Reach | n/a | 12-14" | needs 19-23" | 12-15" |
| Pinch | rod 0.6" off shins | none | knees under the bar | stick 4" off the thigh; fore-aft swing so no scissor; guard the lower 4" |
| Precision | 0.35"/° | 0.31"/° (twitchy) | chosen | 0.5"/° at the grip |
| Hand force | 2 lbf steady; kick below | same; rope slack absorbs kicks | same | same; **kickback ≈ 44-160 lbf at the grip** (1,300-4,800 lb·in at the knuckle / (2.1 × 14")): the stops must stop it, not the hand or cable; put spring-cushioned lost motion in the cables |
| Removable | one pin | clip 2 ropes | arch bolts | 2 pins + 2 quick links |
| Mass | 1.5 lb | 0.4 | 4.5 | 1.4 |

**Hand allocation:** two reins use both hands, but the rider needs one for the brake: single hand steers, single hand brakes (left brakes, right steers), or reins plus a foot plate (§5.4). Verdict: **reins for the wagon; the side stick for Ackermann.**

---

## 5. Rider brake

### 5.1 Where it stands
D-38/D-48: oak shoes on the rear treads, 7/8" cross shaft, ratio **14.4:1** (critical), 25.2 lbf at the goal grip for the 15° hold, grip travel 5.7" (0.243 rad), lever grip at 30" (22.8" arm). `brake-traction` already reports 0.99-1.00 utilization.

### 5.2 Front brake is required, and its bias
Table in §1.1-1.2 is the evidence: rear-only cannot slow on > 5° at μ 0.5, > 8° at 0.3. Front share 0.45-0.55 is the target: front-lock-first plows straight (benign when the intent is a straight line), rear-lock-first slides sideways (the 4.5 mph trip rollover). No pitch-over risk (it takes 1.5-1.9 g).

**Mounting.** The front shoe must ride on the **knuckle** (Ackermann) or on the **steer body** (wagon): a shoe fixed to the beam would lose the tread as the wheel steers (41° about a kingpin ≈ 8" from the contact). Tractor/ATV spindles have a brake-mount boss; the shoe on a swing arm pivoting on the knuckle, driven by a Bowden cable with a housing loop to allow steering. **Brake-steer:** the shoe force acts at the tread plane, so its moment about the kingpin is force × scrub offset (≤ 1") ≈ 40 lb·in per wheel (≈ 2 lbf at the stick): small if the scrub is kept ≤ 1" and left and right are balanced. Wagon: the cable beside the kingpin; disconnect at the tow lock.

### 5.3 Shoe heat (ranges)
Surface ΔT = 2q√t/(√π·e), oak e ≈ 550 W·s^½/m²K, 32 cm² contact per shoe, partition 70% to the shoe. The quoted char time is a **range of 0.5-8 s for four shoes at 15°** (nominal 2.1 s), because it scales as 1/q²: a 50/50 partition or a half-size real contact patch (flat shoe on a curved tire) moves it 4× either way. Two shoes: 0.1-2 s. 10°: 1.4-22 s. Wood is also ablative (wears, smokes, a fire concern near the cargo).

| Case (held 10 mph) | Shoes | ΔT at 1 s | 2 s | 6.8 s | Time to 250 K (range) |
|---|---|---|---|---|---|
| 15°, 150 lb | 2 | 340 K | 480 | 890 | 0.1-2 s (0.5 nominal) |
| 15°, 150 lb | 4 | 170 | 240 | 450 | **0.5-8 s (2.1 nominal)** |
| 10°, 150 lb | 4 | 110 | 150 | 280 | 1.4-22 s (5.6 nominal) |

Tread shoes **cannot hold 15° continuously**. Steel drums/discs of 0.9-1.8 kg would absorb 10.5-12 kJ per 100 ft at only 7-27 K, but need a hub mount (reopening D-13). Lined 4"×2.5" shoes with steel backing about halve the flux. Otherwise rely on the §1.3 rules.

### 5.4 Rider lever, force, fatigue, parking
- **Location:** left hip, pivot (15.0, +14.3, 11.5), grip (14.5, +13.3, 20), 9" arm, 40° swing (6.3" of travel). Reach from the left shoulder 15.2". Cable (1/8" 7×19 stainless) along the left rail to a **slotted lost-motion link** on the main lever at 4.1" above its pivot, 1.4" slot: the handler's lever moves free of the rider's, and the rider pulls the main lever. A return spring on the hip lever.
- **Force.** Work is constant, 25.2 lbf × 5.7" ≈ 140 in·lb, so a 6" hip stroke needs **23-26 lbf for the 15° hold** (cable tension ≈ 140 lbf; 560 lbf at the 100 lbf abuse load, SF 3.5). An **emergency stop** (0.25 g on 15°, brake force ≈ 175 lbf total, μ_pad 0.35-0.45) needs **≈ 38-50 lbf at the grip**, not 15-26.
- **Fatigue.** A 23-26 lbf hold is ≈ 40% of a 60-70 lbf scout grip: fatiguing in 1-2 minutes (7 s per 100 ft of slope). Release equals runaway. Add a ratchet "set" position the rider can trim (hold-on-detent), and size the emergency grip at 50 lbf.
- **Parking on 15°:** rear-only hold needs 89 lbf of friction against μ·N_r = 0.5 × 179 lb = 89.6 lbf: **no margin**; 0 at μ 0.3. With the front brake set (total μ·cosθ·W = 166 lbf) the margin is 1.9×. The ratchet must hold *both* axles. Whether the rider can set it and who releases it is a decision.
- **Foot-plate alternative** at the foot stop (leg force 47 lbf on 3"), leaves both hands free for reins; the foot stop becomes dual-purpose and must be re-checked.
- Mass: lever 0.5, bracket 0.3, cable and housings 0.4, slot link 0.15, spring 0.05 = **1.4 lb**; front brake on the knuckles **4.5 lb**.

---

## 6. Rider safety (ride mode)

| Topic | Finding | Rule / design |
|---|---|---|
| Restraint | rider KE 680 J at 10 mph; a 4.5 mph slide rolls the cart; head 35-45" above ground over ~20" sides | **lap belt** (quick-release buckle for the seven-station exits; anchor load 150 lb × 4 g = 600 lbf on 3/8" through-bolts into the rails); ride mode only with the belt fastened |
| Helmet | BRIEF says recommended | **mandatory in ride mode** |
| Rollover | trips at ≥ 4.5 mph sideways; no cage | no roll bar; belt plus helmet; arms and legs inside the hull; avoid cross-slope runs with μ ≤ 0.3 |
| Foot entrapment, frontal strike | legs stretched forward, feet at x 38-47.6 against the foot stop; the tire-sweep zone x 27-50 sits ahead of the shins; the foot stop is checked at 4 g | foot guard across the tire-sweep zone; a **head-on collision with a fixed object (tree, car) at 10 mph is outside the design** (680 J into feet and knees): procedure, not structure |
| Night | the race is in the dark; 50-70 ft stopping sight at 10 mph (§1.2) | **ride mode daylight-only**, or ≤ 5 mph with a ≥ 500 lumen headlamp (26 ft at 5 mph); the front lantern and rear light (BRIEF §4.8) stay on |
| Hand-hold fatigue | §5.4 | ratchet trim; emergency grip 50 lbf; dead-man lever not adopted (release = runaway) |
| Brake-fade runaway | §1.3, §5.3 | tether, slope/μ rules, stop-and-cool, "call tether" procedure |
| Parking margin | §5.4 | both axles set |
| Kickback to the hand | 44-160 lbf at the stick (§4.2) | solid ±8° stops, cushioned cable ends, stick guard |
| Vertical seat load | vertical pulse 1,870-2,740 lbf at the front, 33 ms: the seat sits 30" back from the front, moving 1.1 m/s (≈ 2.4 mph) in 33 ms ≈ **3.4 g mean, 5 g peak** | ≈ 750 lbf peak onto a foam seat for a 150 lb rider: tolerable for a short pulse with a helmet and belt; keep the 2" closed-cell cushion, check the seat/deck row at ×5 |
| Procedure | wheeled sled downhill with children | troop/council rules, adult spotter at the foot, one-sentence sign-off before any ride-mode run |

---

## 7. Concepts

### 7.1 Concept A: Ackermann on rated tractor/ATV-class spindles, side stick, four-wheel shared-shaft brake

**Description.** Remove the turntable front end. A **fixed front beam** is bolted to the rails (as the rear beam is), carrying two purchased forged **tractor/ATV/trailer spindles with 1" stubs** (published rating; not kart). A 31" tie rod with ½" rated rod ends sits behind the beam, driven by a center bellcrank. Ride input: a **removable side stick** on the right hip, pull-pull cables, ±8° outer / 8.9° inner stops (pinned). Tow input: a short oak **tongue** hinged at the beam center, linked to the same bellcrank. Brake: existing cross shaft, hip lever on the left, shoes on each front knuckle.

**Key points (x forward, y left, z up).**
- Kingpin axes (45.5, ±16.5), caster 5°, trail 1.5-2"; wheel centers (44, ±17.75, 6.5). Beam: x 42.9-46.9, y ±16.1, z 4.4-6.9 (steel angle plate or a thicker oak/steel hybrid; the beam, not the spindle, is the structural fuse).
- Steering arms 3", 20° inboard of the rear axle line: tips (42.7, ±15.5, 5); tie rod behind the beam, 31".
- Bellcrank pivot (41, 0, 5). **Tongue** hinge (47.2, 0, 5.5), tongue to (65, 0, 5.5), ±25°; link point 5" from the hinge (≈ 2.1" of rod travel, enough for 41.3° inner); clearance rule: the tongue rests ≥ 3.5" above ground (D-16), so the tongue is raised and a stop holds it up.
- **Tow radius:** the 8 ft edge radius needs inner 41.3° (zero margin; spindle arm/stop and rod-end angle must be verified, tire-to-beam clearance checked). A 9 ft radius needs 34.8°: decision.
- **Mode interlock:** one captured 3/8" pin through a two-position shuttle plate: RIDE connects the stick cables and holds the tongue stowed on the hull; TOW connects the tongue link and parks the stick in a socket. The pin cannot be inserted in both positions (lanyard), so a stick can never whip at the rider and a tongue can never swing at the nose in ride mode.
- **Tongue steering behavior:** pull loads go through the tongue hinge into the beam, steering sees only angle. No self-centering at rest or walking pace (no tire side force): a bungee (2-3 lbf) on the bellcrank. **Downhill the cart pushes the tongue into the pullers** (a rigid tongue does not slack like a rope), so downhill tow needs the rear tether kept taut; bench-test drift and jackknife.
- Stick: pivot (18, -10, 12), grip (18, -10, 26), ±17° fore-aft; reach 11.9" from the right shoulder.
- Hip lever: as §5.4. Front shoes on knuckle swing arms (§5.2).

**Welding.** The spindle itself bolts on. The kingpin carriers are normally welded ears on a tube; here use bent-plate U-brackets or purchased bolt-on mounts. If none fits, **one outsourced weld per side returns** (D-46). "No welding" is not yet established.

**Mass (consistent with the table in §7.3).**

| Item | lb |
|---|---|
| Remove turntable system (turntable 5.5, carrier 5.1, under plate 1.6, crossbar 1.4, stops and stand 2.9, bolster rails 4.9, sleeve/pin/ears/bearers/panel ≈ 2.7) | -23.5 |
| Remove front axle rod and front clamps | -6.5 |
| Add 2 rated spindles with 1" stubs | +6.0 |
| Tie rod, rated rod ends, bellcrank, arms | +2.5 |
| Tongue, hinge, mode plate, stops | +2.5 |
| Spindle/beam bolt-on brackets, beam upgrade | +3.0 |
| Side stick, cables, pulleys | +1.4 |
| Hip brake lever, cable, slot link | +1.4 |
| Front brake on the knuckles | +4.5 |
| **Concept A net before strike survival** | **-8.7** (169 → 160) |
| Strike-survival package (shared, §7.3) | +11 |
| **Concept A net** | **≈ +2 lb (≈ 171 lb)**, range -3 to +8 |

**What is left of the open front-end problem.** Gone: the steering-stops stand, the turntable ring row, the welded shear ears, the plate-kingpin stack, ≈ 30 lb of removed parts. **Not gone:** the 10 mph strike still lands on the front beam, kingpin bolts, spindle stub, wheel bearings and wheels (§2.4); the **rear axle, rear beam seat, rails** (§2.5: ≈ 2-4×) and every bearing; the brake heat; and the tie-rod/kickback path. A needs a new check family (tie rod, arm, kingpin bending, stub bending, tongue pull, interlock).

**Risks.** Spindle rating and wheel bore (vendor); wheel-rate resonance at 8.6 Hz (bench); tongue on Ackermann is unproven; 8 ft radius at 41.3° inner has no margin; nose widening changes the D-45 look (gentler, not worse).

### 7.2 Concept B: wagon kept, ±8° ride lock, damper, rope reins, front brake
Keep D-12/D-25/D-43/D-46/D-47. Add pinned stops at ±8° beside the stand (45.5, ±3.6), damper (body (41, +4.5, 8.5), rod to (44, +8.5, 5.5)), bungee cords, two rope reins (§4.2), the hip lever and a front brake on the steer body with a cable beside the kingpin. Mass +7.7 lb of ride hardware + the shared strike package +11 + front-end strengthening +8-15 = **≈ +27-34 lb (≈ 196-203 lb)**. The failing rows (`steer-stops` 2.1, `turntable-ring` 1.4, `kingpin-bolts` 1.2) become ≈ 5-8× worse; one-wheel strike yaw 23,000-28,500 lb·in cannot be carried by a 12" lazy susan and a 5" stop couple. Credible only with the 5 mph rule on rough ground and a 1" step ceiling.

### 7.3 Concept C: wagon pinned straight in ride mode (not in the first draft)
In ride mode the steering is **locked at 0° by two pins at the beam ends** (radius ≈ 16", so a 28,500 lb·in yaw becomes ≈ 1,800 lbf per pin, within a ½" grade-8 double-shear pin), a handler or the rider only **brakes**; the cart is aimed at the top of the run and straightened by trail and the lock. No steering input, no damper, no shimmy, no kickback; the rider brakes with the hip lever. Weaknesses: cross-slope drift and no swerve (a rock or rut is hit, not dodged), poor on a bend (a road bend of 100 ft needs 2°), and the pitch-moment/turntable-ring problem remains. Mass +3 (lock) +1.4 +4.5 (brake) +11 (shared) + front-end 8-15 = **≈ +28-35 lb**, but with fewer parts than B and a rigid lock removing the stop stand's role in ride mode.

### 7.4 Concept D: purchased rated slewing ring / fifth wheel (checkpoint §3(c))
Replace the lazy susan, carrier, under plates and crossbar with a purchased **12" slewing ring or wagon fifth wheel with a published moment rating** (hundreds of dollars, ≈ 9 lb) bolted to a plate; the ring row passes if the rated moment exceeds the strike pitch moment (to confirm with the vendor). Ride mode as C (pinned straight) or B (±8° with reins). Mass ≈ -4 lb on the front stack, +ride hardware 4-9, +11 shared, +front end 4-8 = **≈ +15-24 lb**. Needs vendor moment rating, bolt pattern and a welded-ear free mount; unknown until quoted.

### 7.5 Comparison

| | A Ackermann, rated spindles | B wagon + ±8° + reins | C wagon pinned straight | D rated slewing ring |
|---|---|---|---|---|
| Net mass (strike survival charged to all) | ≈ +2 lb (171) | ≈ +27-34 (196-203) | ≈ +28-35 | ≈ +15-24 |
| Steering in ride mode | ±8° / 8.9°, stick | ±8°, reins | none (brake only) | either |
| Strike path | spindle stub, bearings, beam | stops/turntable at 5-8× (fails) | pins at the beam ends (ok), ring still fails | ring rating per vendor |
| Open front-end problem | stops/ring/ears removed; strike remains | worse | partly; ring remains | ring fixed if rated; ears can go |
| Parts count | medium (bolt-on) | high | medium | medium |
| Welding | bolt-on brackets or outsourced | 3 welded parts remain | 3 remain | fewer |
| Tow mode | tongue, unproven | as today | as today | as today |
| Dynamics | ≈ 0.3 ζ, 8.6 Hz check | needs damper | no steering dynamics | as B or C |
| Fit to "minimal steering" | good | good | simplest, but no avoid | good |
| Main risk | spindle rating, tow tongue | the front end | drift, bends | vendor data |

### 7.6 Candid answer
**Yes: ride mode at 10 mph makes the turntable wagon the wrong architecture,** but on strike torque and mass, not on stability; the wagon's real problem is that it already fails at *tow* loads (D-46) and 10 mph makes it 5-8× worse. Eric's clarification (minimal steering) makes ±8° and even pinned-straight (C) credible, and the biggest safety lever is the use envelope (§1), not the steering.

---

## 8. Decisions for Eric (ordered: envelope first)

1. **Use envelope.** Adopt the go/no-go table of §1.1 as the rule (ride only where it shows GO: μ 0.5 up to 15°; μ 0.3 up to ≈ 8°; no ride mode at μ ≤ 0.2 or on 15° wet leaves, walk-it-down instead)? Who judges μ at camp?
2. **Runaway fail-safe.** Rear-handler tether mandatory above 8° or when μ is in doubt? Include a ground-drag blade? Stop-and-cool rule (≈ 100 ft of continuous 15°, 250 ft of 10°)?
3. **Speed rule.** 10 mph only on smooth signed runs, **5 mph** over steps ≥ 1" or whenever the table shows CAUTION (halves the strike, brake distance ÷ 4 from 5 mph)?
4. **Rider safety package.** Lap belt (ride mode), helmet mandatory, daylight-only ride mode (or ≤ 5 mph with a ≥ 500 lumen lamp), foot guard, adult spotter.
5. **Design strike.** 1.5" step at 10 mph (≈ 2,300 H / 2,700 V, both wheels), 5 mph on rough ground; today's 3× for tow; `curbStrikeG` 4 in ride mode; wheels ≥ 600 lb, 1" axles, upsized bearings, rear beam and rails (charged to every concept, ≈ +11 lb).
6. **Brake.** Front brake required (bias ≈ 0.5, front-lock-first, knuckle-mounted); brake heat: accept the duty-cycle rule, buy lined steel-backed 4"×2.5" shoes, or reopen D-13 for a hub drum/disc?
7. **Architecture.** A (Ackermann on rated spindles; ≈ break-even mass, removes stops/ring/ears), or D (rated slewing ring) to keep the wagon, or C (wagon pinned straight) as the minimal option.
8. **Ride lock and input.** ±8° (outer 8°, inner 8.9° on A); single side stick (A) or rope reins (B/D); brake with the left hand, steer with the right.
9. **Tow geometry.** Keep the 8 ft radius (A inner 41.3°, zero margin) or relax to 9 ft (34.8°, wagon 30°, nose 19")? Mode interlock accepted?
10. **Rider lever details.** Emergency grip 50 lbf, ratchet trim, who sets/releases the parking ratchet (rider set, handler release), hip lever vs foot plate.

## 9. Method, assumptions and open points
- Scripts (not in the repo): `/private/tmp/claude-502/-Users-eschrock-dev-klondike-car/a02116e9-81a4-4f6c-b178-5a454857e24d/scratchpad/{calc,study,stop,env,checks,brk,m}.ts`, run via `node scripts/run-ts.mjs`.
- Assumed: tire cornering stiffness 0.08-0.16/°, stack stiffness 1,500-3,000 lb/in, I = 9.8 lb·s²·in, oak e = 550, heat partition 70/30 (50/50 and half-area tested), CdA 0.5 m², Crr 0.03, μ 0.2-0.7, small-scout reach 16", scout grip 60-70 lbf. Brake-fade timing and the 8.6 Hz coincidence are model results to bench-test.
- The `runChecks` baseline is from a working tree another session is editing; the already-failing rows may move.
- Mass deltas are ±30% until each part is modeled. No state-changing git commands were run; nothing under `src/` was edited.
