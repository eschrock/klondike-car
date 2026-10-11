# Simple view spec

**Goal (Eric, 2026-10-10, D-30):** answer **"Is this cart safe, and for what rider weights?"** at a glance. The full app stays one click away as **Advanced**. A later secondary goal is comparing **scenario A vs. B** (e.g. the deferred lightweight variant, D-21), so design for it without building it yet.

## Mode
- A top-bar toggle: **Simple | Advanced**.
- The default is Simple. The choice persists in `localStorage` per viewer, wrapped in try/catch.
- Both modes share the same store and URL hash, so a link opens the same design in either mode.
- Switching modes never changes the design.

## Layout (Simple)

**Left: "Your cart", about 6 controls, plain labels with units.**
1. **Rider weight** (the prominent one): sets `riderMassLb`; range 50–250.
2. **Length between wheels:** `wheelbaseIn`.
3. **Width between wheels:** front and rear track set **together**.
4. **Wheel size:** `wheelDiameterIn`.
5. **Floor height:** `deckHeightIn`.
6. **How sharp it turns:** `steerLockDeg`.

**Center:** the existing 3D viewer.
- Kept: Iso / Top / Side / Front, the steer slider with its 0° button, and a "Show rider" toggle.
- Hidden: explode, section, dimensions, the group toggles and the transport toggle.
- The CG marker is hidden by default.

**Right: "Is it safe?"**

1. **Rider range bar.** A horizontal band from 50 to 250 lb, colored green / yellow / red per 10 lb step. The current rider weight is a marker.
   - Headline: **"Safe for riders about 70–230 lb"**, from the widest contiguous run with no fail that contains the operating weight. If the current weight fails, say so plainly in red.
   - Under the bar, the limiting reason at each end, in plain English. For example: "Below 70 lb: a hard uphill pull can lift the front wheels". "Above 230 lb: a curb strike could overload the kingpin".
2. **Traffic lights at the current rider weight.** Each light shows the worst status of its checks, plus one plain sentence that includes the key number. Clicking a light switches to Advanced → Analysis and scrolls to and highlights the first relevant row.

| Light | Checks | Sentence (pass example) |
|---|---|---|
| Tipping over | tip-straight, tip-lock | "Stays upright on a 46° side slope, even turned all the way. (A very steep hill is about 30°.)" |
| Fast turns | slide-before-tip (and v-rollover as info) | "In a fast, sharp turn it skids before it can tip. Rollover would need about 9 mph at full lock." |
| Hills & braking | pitch-fwd, pitch-rear, brake-force | "Holds on a 15° hill with 20 lb on the brake handle. The front won't lift when pulled uphill." |
| Steering | turn-radius, steer-clear | "Turns in an 15.6 ft circle; the wheels clear the hull." |
| Strength | all `group === 'Structure'` checks | "Every part is at most 92% of its design limit (weakest: kingpin in a curb strike)." |
| Fits the truck | truck-fit | "Fits the Tacoma bed with the tailgate down." Add "fully assembled" or "with the handle and seat back off". |

   - Statuses: pass = green, marginal = yellow (passes by < 10%), fail = red, info = gray.
   - Wording is generated from the check values, never hard-coded numbers.
3. **Spec card:**
   - length × width × height, assembled and for transport;
   - empty weight, and the lift weight per person for two people;
   - wheel size, floor height;
   - turning circle in feet;
   - fits the truck: yes/no.
4. **"Watch it" demos:** buttons for Tilt test, Sharp turn, Curb bump, Brake on a hill. Each opens Advanced → Simulation with that scenario loaded at the current rider weight and starts it. This needs a small API on the sim panel: `runScenario(id, { riderLb })`. A "Back to simple" button returns.

## Rider sweep (new, `src/analysis/rider-sweep.ts`, pure TS)
`riderSweep(p, { fromLb = 50, toLb = 250, stepLb = 10 })`:
- For each weight w, evaluate `runChecks` with `riderMassLb = riderGoalMassLb = riderMinMassLb = w`, so every case is the same rider. Exclude truck fit (it doesn't depend on the rider) and compute it once.
- Returns per-weight `{ w, status, worst: {id, label, util}, byLight: Record<Light, status> }`, the safe range, and the limiting check at each end.
- Debounced/lazy in the UI. Target < 150 ms total; cache by params JSON.
- Tests:
  - the range contains the operating weight at the defaults;
  - a design with a known failing check shows red at the right weights;
  - the light mapping covers every check id exactly once (or as info).

## Scenario A/B readiness (don't build yet)
- Keep "a design" as a plain `Params` object everywhere the simple view computes. Then A vs. B is just two sweeps and two cards side by side.
- Name nothing so that it assumes a single global design.

## Out of scope
- No new physics.
- The Advanced view stays as is.
