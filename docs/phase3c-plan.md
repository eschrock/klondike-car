# Plan: the sled rework (next phase, draft for Eric)

**Why.** We designed a cart, then a rider-steered downhill cart. A Klondike Derby sled is a **dog sled on wheels** (`docs/klondike-research.md`):
- the rider is a passenger;
- the team pulls from the front on hand loops;
- a musher at the back steers and brakes on a handlebow.

The current model (`6341ecf`, 174 lb) is a consistent checkpoint and a step toward this, but far too heavy and cart-like. This plan slims it down and resets the shape.

**Eric's guardrail (2026-10-11):** *not* the bare-bones ski-and-PVC sleds online. It stays **a really nice, reusable wooden piece with storage**: oak, good joinery, a finished look, built to last for years. "Sled" sets how it is used and its character: the rider is a passenger, the team pulls, the musher steers and brakes from the back, and it is narrower and lighter. It does not mean minimal.


**Eric (2026-10-11, later): the scope is narrower than the draft below assumed.**
- **Wheels are required.** Runners are styling and structure only.
- **Keep the current layout with steerable front wheels.** The Ackermann front end, steered by the tongue, stays, minus the rider controls.
- **Keep it wide enough to be useful.** Today's width stays.

So the next phase is a **refinement of the current design**, not a restart:
- **Drop ride mode:** the rider stick, cables, mode pin, centering, ride lock, hip lever, ride rules card, and the 10 mph bump and fail-safe cases (back to walking or jogging pace).
- **Musher at the back:** the push handle becomes a sled-style handlebow, with the brake lever there.
- **Front brakes:** reconsider them. They were added for downhill riding.
- **Restyle toward a sled:** runner-like lower side members curling up at the bow, a slatted or paneled basket look, side rails and the handlebow, while keeping the oak, the storage box and the finish quality.
- **Slim the weight back down.**

Decisions 2, 3 and 6 below are answered or adjusted by this, and the S1 concepts become styling and weight variants of the current layout.


**Design direction from the packet (2026-10-11).**
- **Shape:** the classic sled silhouette on wheels:
  - a long, low bed on hardwood lower rails ("runners") whose tips curl up into a bent-lam brush bow;
  - side rails that sweep up (Wagner's S-curve) to a tall rear handlebow, which is the musher's push handle and holds the brake lever;
  - an X brace at the back and a slatted or paneled deck.
- **Width:** somewhat narrower than today (about 24–26" body, Eric: "somewhat narrower for sure"), still wide enough to be useful.
- **Wheels:** steerable front wheels (today's Ackermann, steered by the tongue) and fixed rear wheels.
- **Kept:** the oak and the integrated storage box.
- **Gear curtain:** canvas or net, as in every plan.

## 1. What changes, and what we keep

| Area | Keep | Drop or replace |
|---|---|---|
| Framework | params → `buildModel` → analysis, viewer, Simple view, truck fit, critic workflow, finish/rendering pipeline | none |
| Body | oak, the finish quality, rendering, roundovers, the "no exposed ply" rule, **the weatherproof storage box**, signs, lantern | the wide boat hull and its curved gunwales. Replaced by a **crafted sled body**: runners with bent-lam tips and a brush bow, a slatted or paneled basket on stanchions, side rails, an integrated storage box, and a shaped rear handlebow |
| Running gear | wheel and axle analysis | 13" pneumatic wheels and steel axle beams. Replaced by a **removable wheel kit** bolted to the runners (≤ 12" wheels if AAC limits it) |
| Steering | bridle and tow analysis, tip checks | Ackermann spindles, linkage, rider stick, ride/tow modes. Replaced by a steering choice for Eric (decision 4) |
| Brake | brake holding and force checks | rider hip lever, front knuckle brakes, cross shaft and ratchet. Replaced by a **musher brake** at the handlebow (a claw or drag bar, or a simple lever to the rear wheels) |
| Rider | seat analysis, grab handles, belt | ride-mode envelope, 10 mph bump and fail-safe cases, ride rules card. The rider sits or kneels in the basket and holds side rails |
| Loads | 150 lb must pass, 200 lb goal (D-1); towing loads; tip; lifting | downhill riding at speed. Loads are walking or jogging pace on a camp road (D-50's "bumps, not curbs") |
| Weight | none | a real target: well under today's 174 lb. Simple scout sleds weigh 30–60 lb; ours keeps oak, storage and a wheel kit, so roughly **70–100 lb** is a sensible aim (decision 6) |

The ride-mode work is not wasted: it showed what not to build. We tag the current state (`cart-v3b`) before deleting it, so nothing is lost.

## 2. Decisions for Eric before design starts
1. **AAC / Bert Adams 2026 rules:**
   - Are sled length and width limits enforced?
   - Wheel limits: number, diameter, removable?
   - Hardware: are screws and bolts OK, or lashings only?
   - Must youth do the building?

   *Default if unknown:* about 72" long, 20–22" wide, wheels ≤ 12" and removable, screws and bolts allowed.
2. **Snow or wheels-only.** Do we design true runners plus a bolt-on wheel kit, so it works on snow too, or a wheels-first sled whose runners are styling and structure?

   *Recommendation:* wheels-first, with real hardwood runners as the main frame members. It keeps the sled look, the runners carry the wheel kit, and in Atlanta it almost always runs on wheels.
3. **Wheel layout:**
   - **(a)** 4 small wheels: fixed rear, swivel casters front;
   - **(b)** 4 fixed wheels, steered by skidding;
   - **(c)** fixed rear plus a simple pivoting front axle on the tow bar, like today's tongue.

   *Recommendation:* (c) or (a). The study (`docs/ride-mode-study.md`) gives the tradeoffs, which still hold at walking pace.
4. **Musher position:** walks behind holding the handlebow (simplest), or can also stand on runner tails or a footboard (classic dog sled, which needs a stronger rear)?
5. **Rider:** sit facing forward (a low seat pad and backrest), or kneel? Is a lap belt still wanted at walking pace?
6. **Weight target:** how heavy is acceptable, given who lifts it and how it goes in the truck? I'd aim for 70–100 lb with oak and storage.
7. **Night start:** keep a front lantern (yes, recommended) and the flush flag socket (your idea).

## 3. Phases
- **S0, reset (short).**
  - Tag `cart-v3b`.
  - Rewrite BRIEF §3–§4 for the sled.
  - Record the decisions above in DECISIONS.
  - Mark superseded entries (the D-49 ride mode, the D-51 front end, the D-52 hull).
- **S1, concepts.**
  - 2–3 sled concepts as block models in the viewer, built from new params:
    - runner length and profile;
    - basket height, width and slat pitch;
    - stanchion count;
    - handlebow height;
    - wheel kit.
  - Quick mass, tip and pull numbers for each.
  - **Checkpoint:** Eric picks one.
- **S2, analysis re-scope.**
  - Delete the ride-mode, Ackermann and hull-specific code and checks.
  - Keep and adapt:
    - structure of the runners, stanchions and basket under the rider;
    - wheel kit and axle;
    - harness, bridle and tow-bar pull;
    - tip;
    - musher brake hold on 15°;
    - lift and truck fit.
  - Make the Simple view honest for the sled.
  - Critic round (engineering).
- **S3, detail and look.** Joinery as plain Domino and screw (or lashing, if the rules require it), and a gear curtain. Visual pass toward the reference sled look, with a critic.
  - Bent-lam runner tips and brush bow; our lamination work pays off here.
  - The steam- or lam-bent handlebow.
  - Critics on engineering, buildability and visual.
  - **Checkpoint.**
- **S4, build outputs (the old Phase 4):**
  - cut list;
  - nesting;
  - BOM with costs;
  - DXF and STL files;
  - lamination forms for the runners and bow;
  - assembly steps;
  - finishing;
  - single-file HTML.

## 4. How we'll keep it simple this time
- **A short brief first.** Eric confirms the use case (who rides, who steers, at what speed) before any design work. This would have caught both earlier misunderstandings.
- **Fewer mechanisms, same craft.** Prefer purchased wheels and hubs and plain, strong joinery. Every added *mechanism* must justify its weight; good wood, finish and storage are part of the brief, not extras.
- **Loads at the real speed** (walking or jogging pace, bumps), with margins on normal use only.
- **Show shapes early.** Eric sees a block-model screenshot at S1, before detail work.
