# Troop 455 Klondike Cart: Design, Modeling & Build-Plan Brief

**Owner:** Eric Schrock (builder, an experienced woodworker and maker)
**Audience:** an AI coding agent (Claude Code) building the parametric model, analysis, and build docs
**Reference images:** `reference/` (described in §2)

---

## 1. Goal

Design a **Klondike Derby cart** (a wheeled "sled") for Boy Scout Troop 455. You will deliver a **shareable static web app**. It is driven by **one parametric model** and does all of the following:

1. Renders the cart in 3D (orbit, section, exploded view, removable-parts toggle, truck-fit check).
2. Runs engineering checks: weight, center of gravity (CG), tip-over, turning, braking, and axle/frame stress.
3. Runs a qualitative downhill/turning physics simulation.
4. Produces a **cut list**, **hardware BOM** (bill of materials), **sheet-goods nesting**, **CNC/laser DXFs**, and **3D-print STLs**.
5. Presents **step-by-step assembly instructions** as model views.

The concept images are **loose inspiration only**. Priorities are **function first: weight and strength**. Construction complexity is acceptable and even welcome. Bent lamination, complex joinery, CNC-cut parts, and printed parts are all fine.

---

## 2. Reference materials

| File | What it is | How to use it |
|---|---|---|
| `01-rules-handout.jpg` | Bert Adams Scout Camp Klondike Derby rules (Winter Camp, Atlanta Area Council) | **Authoritative requirements.** See §3. |
| `02-concept-overview-transport.png` | AI concept render: specs, top view, Tacoma loading, removable parts | Overall vibe and feature ideas only. Its numbers are inconsistent (§9). |
| `03-concept-callouts.png` | AI concept render with feature callouts | Feature checklist: storage, seat, grab handles, foot stop, rear handle, drag brake, bridle. |
| `04-post-race-uses.png` | Post-race uses (gear hauler, firewood, parade, etc.) | Secondary requirement: the cart should double as a gear hauler (§4.9). |

---

## 3. Event rules (from the handout)

- The cart must carry **at least one Scout** throughout, riding in it when approaching each "Town" (program area).
- **Wheels are allowed** (and practical: the camp is in Georgia, so expect no snow).
- The team must carry the **10 Essentials of Scouting** during the competition.
- **Timed race**, starting about **7 pm**, which means **in the dark** in winter. Seven stations; teams pull the cart between them on camp roads and trails.
- Teams are judged on accuracy, neatness and Scout Law at stations. The cart's job is to be fast, safe, and reliable.

---

## 4. Locked design decisions & requirements

### 4.1 Riders & loads
- **One rider.** Design rider: **200 lb**, to cover the largest older scout plus margin. Typical rider is 80–150 lb.
- Cargo: 10 Essentials plus team gear, **25 lb**.
- Design load for structure: **(rider + cargo) × 3** dynamic factor for bumps and curbs on rough trail, with a material safety factor of ≥ 2 on top for wood.

### 4.2 Steering: pivoting front axle (wagon steer)
- The rear axle is fixed. The **front axle pivots** about a vertical kingpin on a **turntable bearing** (heavy lazy-susan or fifth-wheel bearing, rated ≥ 1000 lb) with a through-bolt kingpin (grade 8 or stainless).
- The **pull bridle attaches to the front axle assembly**, so pulling steers the cart and it self-centers under tension. Consider a short wooden tongue/drawbar on the front axle with the rope bridle tied to it, and evaluate both.
- **Mechanical steering stops** at the max lock angle, likely ±35–45°. The agent decides from the clearance and stability analysis.
- **Critical geometry checks:**
  - Front wheels must clear the body at full lock. Options: narrow the forward hull, raise the body over the front wheels, or put the front track outside the body. Evaluate them.
  - Wagon steer shrinks the support triangle at full lock. **Tip-over stability must be checked at full lock**, not just straight ahead.
- Ackermann knuckle steering is allowed as an alternative *only if* it can be done with no welding and is clearly better. Default to wagon steer.

### 4.3 Braking & downhill control
- **Rear drag brake** worked by a lever from the rear handler position. Pads bear on the rear tire treads or on a wooden brake drum or disk on the axle. Evaluate the options.
- **Rear tether/handle** so a person behind can hold the cart back on descents.
- A **parking brake or lock**. Can be the same lever with a detent.
- Must hold the loaded cart stationary on a **15° (27%) slope** with reasonable lever force (≤ 30 lbf at the handle).

### 4.3a Ride mode: a rider drives it downhill (added 2026-10-11, Eric; D-49)
The original brief only covered towing (pullers steer through the bridle, a rear handler brakes). That missed a core use: on downhills the crew can't pull or run alongside, so **the rider must be able to drive the cart alone**. Two modes, same cart:
- **Tow mode:** as in 4.2 and 4.3 (bridle steering, rear-handler brake, push handle).
- **Ride mode:** the rider steers and brakes from the seat. The rider controls are **removable or stowable** so they don't get in the way when towing.
- **Design speed: 10 mph** ridden downhill, with the rider braking to hold it there. Impact, braking, rollover and steering checks cover this speed, not just walking pace.
- **Steering input:** to be chosen by a design study: tiller through a slot in the nose deck, rope reins, or a short yoke or handlebar. Hard limits: no foot or hand pinch points (§4.7), and no input that can whip the steering to full lock at speed. Ride-mode lock, centering and damping, and wagon versus Ackermann steering, are reopened (the 4.2 "Ackermann only if clearly better" test now includes stability at speed).
- **Brake:** usable by **both the rider and the rear handler**: one mechanism, two levers, either can apply it. The rider's lever sits at a comfortable angle by the seat (a lower lever, possibly routed through the deck). Checks add **stopping from 10 mph** (distance, pitch-over, shoe heat over a long descent) to holding on 15°.
- **Steering need when riding is minimal** (Eric): no route to navigate, just small corrections to keep it running straight. Straight-line tracking and self-centering matter more than steering range; a small ride-mode lock is acceptable.
- **Hill:** unknown (Q-4). Design for the 15° maximum slope with a run long enough to reach the design speed; verify at camp.

### 4.4 Wheels & axles
- **Pneumatic wheels, 10–13" diameter** (make it a parameter). Mixed trail terrain favors the larger end. Sealed ball bearings. Consider flat-free tires as an option.
- Axles: **steel rod (¾" or 5/8", parameter)** with shaft collars and cotter pins, or keyed rod in **bolt-on pillow blocks / flange bearings**. Bolted only.

### 4.5 Size & transport: must fit a 2007 Toyota Tacoma short bed with the tailgate down
Treat all truck dimensions as **parameters**. The defaults below are **approximate and unverified**. Eric will measure:

| Truck parameter | Default (verify) |
|---|---|
| Bed floor length, bulkhead to tailgate | 60.5" |
| Tailgate length (down) | ~20" |
| Width between wheel wells | ~41.5" |
| Wheel-well height above bed floor | ~10" |
| Wall-to-wall width at floor | ~57" |
| Load height (ground to top of tailgate) | ~31–33" |

- Include a **truck-fit view and check** (3D bounding/collision against a simple bed model), both with removable parts installed and removed.
- **Ramps:** the concept's "deck panels double as loading ramps" idea likely **fails**. At about 31" load height, a ramp at ≤ 20° needs to be about 90" long, which is longer than the cart. At a 60–70 lb target weight, a **two-person lift** is likely the right answer, and that removes the need for ramps and a winch. Evaluate briefly, then recommend.

### 4.6 Weight: target 60–70 lb empty
Achieved with **hybrid construction** (§5.2). The model must report the computed weight live.

### 4.7 Rider safety & ergonomics
- Low seat with backrest, side grab handles, foot stop / footwell.
- **No pinch points** at the steering pivot or brake linkage near the rider's hands or feet.
- Low deck and CG. Easy to get in and out quickly, since the rider gets in and out at seven stations.
- Helmet recommended (note it in the docs).

### 4.8 Night operation & 10 Essentials
- Mounts for **lights**: front LED lantern/headlight, rear red light, side reflectors. The race starts after dark.
- **Weatherproof storage** for the 10 Essentials. Size it for a typical patrol kit: first aid kit, water, map/compass, flashlights, rain gear, etc. Add lash points.

### 4.9 Secondary: post-race gear hauler
- With the seat removed, the deck should carry gear (coolers, duffels, firewood). Rated cargo load is the same as the rider load. Add lash points.

### 4.10 Removable for transport
- Rear push handle, seat back, and any decorative or tall parts (prow ornament, signs) come off without tools or with one tool. Use knobs, pins, or threaded inserts.

---

## 5. Construction constraints

### 5.1 Fabrication capabilities
- **No welding.** Every metal part must be off-the-shelf, or cut, drilled, tapped, or bent from stock, and joined with fasteners.
- Available: full woodshop (bent lamination, steam bending), **CNC router**, **Shaper Origin**, **Festool Domino** (floating tenons), **laser cutter**, **3D printers** (PETG/ASA/nylon/CF-nylon). **No lathe.**
- Complex joinery is welcome where it saves weight or adds strength: bridle joints, Dominos, CNC-cut mortise and tenon, bent-lam members, glued box sections.

### 5.2 Materials
- **Hardwood: white oak** for all visible and structural solid parts: frame rails, sides/gunwales, axle beams, bent-lam members, handles. Use thinner sections (¾"–1") with good engineering rather than 1¼" slabs.
- **Plywood** (marine or exterior Baltic birch) **only as captured panels**: deck, floor, bulkheads. They sit in rabbets or dados, or get hardwood edging. **No exposed plywood edges.** All ply is epoxy-sealed, edges included.
- Fasteners: stainless or hot-dip galvanized. Use **threaded inserts** for anything removable or going into plywood.
- Finish: exterior. Epoxy seal plus spar varnish or marine finish. White oak is rot-resistant, but end grain still needs sealing.
- Printed parts: allowed for brackets, light mounts, knobs and caps. **Not** for primary load paths unless analysis justifies it.
- Budget: **not a constraint for now.** Spec the right parts, then report the total cost so it can be pared down.

### 5.3 Build ownership
Mostly **adult-built**, so no scout-friendly breakdown is needed. Instructions can assume an expert woodworker.

---

## 6. Software deliverable

### 6.1 Stack (suggested; justify any change)
- **Vite + TypeScript**, **three.js** for rendering, **Rapier** (`@dimforge/rapier3d-compat`) for physics.
- Optional: `three-bvh-csg` for showing joinery cuts. A small DXF writer for profiled part exports. STL export via three.js exporters.
- Output is a **static site** deployable to GitHub Pages, and also buildable as a single self-contained HTML file for sharing.
- Git repo, with a README explaining how to change parameters and regenerate outputs.

### 6.2 Architecture: single source of truth
- `params.ts`: every design variable, with units, defaults, and min/max. Examples: overall length, body width, front/rear track, wheelbase, wheel diameter, axle diameter, deck height, seat position, steering lock, stock thicknesses, species density, rider mass, truck dimensions.
- `model/`: functions that turn params into a **list of Part objects**. Nothing downstream hard-codes geometry.
- Every view reads the parts list: viewer, analysis, sim, cut list, BOM, exports, and assembly steps.
- A suggested Part schema (extend as needed):

```ts
interface Part {
  id: string;              // "side-rail-L"
  name: string;            // "Left side rail"
  group: string;           // "frame" | "body" | "steering" | "running-gear" | "seat" | "brake" | "hardware" ...
  kind: 'lumber' | 'sheet' | 'bentlam' | 'printed' | 'metal' | 'purchased';
  material: string;        // "white oak" | "marine ply 1/2" | "PETG" | "12L14 steel rod" ...
  stock?: { t: number; w: number; l: number };   // finished dims, inches
  rough?: { t: number; w: number; l: number };   // with milling allowance
  geometry: Geometry;      // box | extruded 2D profile | swept/bent-lam | imported mesh
  transform: Matrix4;      // position in the assembly
  massLb: number;          // computed from volume × density (or catalog weight)
  removable?: boolean;     // for transport
  fab: 'table-saw' | 'cnc' | 'shaper-origin' | 'laser' | 'print' | 'buy' | 'bentlam' ...;
  joinery?: string[];      // "Domino 10x50 ×4 to front bulkhead"
  step: number;            // assembly step where it's installed
  sourcing?: { vendor: string; url?: string; costUsd?: number };
  notes?: string;
}
```

### 6.3 Required views and features
1. **3D viewer:** orbit/pan/zoom; preset views (iso, top, side, front); exploded-view slider; section plane; show/hide by group; highlight a part from the cut list; dimension overlays for the key params.
2. **Parameter panel:** live sliders for the key variables. Everything updates live: model, weight, CG, and pass/fail checks.
3. **Analysis panel** (§7): every check shows its value, its limit, and pass/fail, plus a short "how computed" note.
4. **Simulation** (§8).
5. **Truck-fit view:** the cart in the bed with tailgate down, with collision highlighted.
6. **Cut list:** grouped by material, with rough and finished dimensions, quantity, and board feet for lumber. Plywood **nesting layouts** on 4×8 or 5×5 sheets.
7. **BOM:** hardware and purchased parts with quantity, spec, suggested vendor/link, and cost, plus a **total cost** with lumber estimated by board foot or sheet.
8. **Exports:** DXF per profiled part (CNC/laser), STL per printed part, CSV cut list and BOM, and drawings for bent-lam forms.
9. **Assembly steps:** an ordered list; each step shows the model with only the parts so far (new parts highlighted), short instructions, joinery/glue/fastener notes, and clamp/cure times where relevant. Include bent-lam form-making and the glue-up as their own steps.

---

## 7. Engineering analysis (formulas exposed, assumptions stated)

| Check | Method | Target |
|---|---|---|
| Empty weight | Σ part masses | 60–70 lb |
| CG (empty, loaded) | Mass-weighted centroid | Report x/y/z; loaded CG height as low as practical |
| Lateral static tip angle, straight | θ = atan((T/2)/h_cg) using the effective support line | ≥ 40° loaded |
| Lateral tip, **full steering lock** | Support polygon from the actual wheel contacts at full lock | ≥ 35° loaded |
| Turn rollover speed | v = √(g·r·(T_eff/2)/h_cg) at min turning radius | Well above a running pull (≥ 3× a 6 mph jog at min radius, or report) |
| Longitudinal pitch-over | Downhill braking with front contact as pivot | No pitch-over at 15° slope with full brake |
| Brake holding | Required friction force on a 15° slope vs lever ratio and pad μ | Holds with ≤ 30 lbf at the handle |
| Turning radius | From wheelbase and lock angle | Report; aim ≤ 8 ft |
| Steering clearance | Wheel swept volume vs body at full lock | No interference |
| Axle stress & deflection | Beam model (simply supported or cantilever stubs) at design load × 3 | Stress < yield/2; sensible deflection |
| Frame rails / deck | Beam bending under the rider point load × 3 at the worst position (white oak MOR/MOE) | Stress ≤ MOR/2 at dynamic load; static deflection ≤ L/300 |
| Kingpin / turntable | Vertical load vs bearing rating; kingpin shear/bending | ≥ 2× margin |
| Truck fit | Bounding/collision vs bed model | Fits with tailgate down; flag if parts must come off |

Use published wood properties (USDA Wood Handbook values for white oak, plus a moisture/exterior reduction) and state them in the UI.

---

## 8. Physics simulation (qualitative)

- Rapier rigid bodies: chassis, steering axle on a revolute joint with limits, and wheels (revolute joints or a raycast vehicle controller). Masses and CG come from the parts list.
- **Scenarios:** adjustable downhill slope (0–20°); side slope / camber; bumps or a root/curb; a turn at a chosen speed and radius; a braking event.
- **Controls:** pull force and direction (steering input via bridle), brake on/off and force, rider mass.
- **Readouts:** speed, per-wheel normal load, a "wheel lift" warning, and a tip-over event.
- Clearly label it **qualitative**. The analysis panel (§7) is the real validation. Cross-check that the sim's tip onset roughly matches the static calculations.

---

## 9. Known problems in the concept renders (do not copy)

- Inconsistent specs: track **38–40"** vs **30–32"**; deck height **9–11"** vs **8–10"**.
- The top view appears to show **6 wheels**; the other images show 4. Design for **4**.
- **Fixed axles front and rear** ("no steering pivot") would scrub badly in turns on a cart this long. Replaced by wagon steer (§4.2).
- **42" max width** won't fit between Tacoma wheel wells (~41.5"). Width is set by the truck parameters.
- **~100 lb empty** is too heavy; the target is 60–70 lb.
- **Deck-panels-as-ramps** is likely too short for a safe ramp angle (§4.5).
- Two seat pads: this design is **one rider**, and the forward area becomes storage/cargo.
- Keep these from the renders: low deck, padded seat with backrest, grab handles, foot stop, removable rear push handle, rear drag brake, wide bridle, lantern/flag mount, troop signage, and the boat-like character with a bent-lam prow **where it doesn't cost weight or strength**.

---

## 10. Phased plan with review checkpoints

**Stop at each checkpoint and summarize for Eric before continuing.**

**Phase 0: Setup and parameter reconciliation**
- Scaffold the repo and app shell. Write `params.ts` with defaults, and record every assumption in a `DECISIONS.md`.
- ✅ *Checkpoint:* parameter table and assumptions list.

**Phase 1: Block model**
- Simple boxes, cylinders and extrusions at real dimensions. Steering axle articulates with lock. Wheels, seat, rider mannequin (200 lb, older scout), cargo box, truck bed model.
- Viewer, parameter panel, live weight/CG, truck-fit check.
- ✅ *Checkpoint:* screenshots from several angles, weight/CG, truck fit.

**Phase 2: Analysis and simulation**
- Implement §7 and §8. Explore the parameter space (track, wheelbase, wheel size, deck height, lock angle) and **propose a recommended configuration** with tradeoffs.
- ✅ *Checkpoint:* recommended parameters and a pass/fail table. Eric approves before detailing.

**Phase 3: Detail design**
- Real part shapes: bent-lam prow/members with form geometry; joinery (Domino sizes and locations, CNC tenons, rabbets that capture the ply); steering turntable mounting and stops; brake mechanism; axle mounting; seat; storage box; light mounts; removable-part attachments; signage blanks.
- Re-run the analysis on the detailed model.
- ✅ *Checkpoint:* detailed model review, updated weight and analysis.

**Phase 4: Build outputs**
- Cut list, nesting, BOM with costs, DXFs, STLs, bent-lam form drawings, assembly steps, and finishing schedule.
- Deploy the static site. Produce a single-file HTML build.
- ✅ *Checkpoint:* full package review. Pare down cost if needed.

---

## 11. Open inputs from Eric (use defaults until provided)

- [ ] Measured Tacoma bed dimensions (§4.5 table) and the cab/bed configuration.
- [ ] Weight of the heaviest likely rider (default 200 lb).
- [ ] Any known course details: hill steepness, surface, distance between stations.
- [ ] Preferred wheel/tire source if any.
- [ ] Troop signage text/art. The renders say "Troop 455 / Wilderness Rangers".

---

## 12. Acceptance criteria

- [ ] One parametric source drives the viewer, analysis, sim, cut list, BOM, exports and assembly steps. Changing a parameter updates all of them.
- [ ] All §7 checks pass at the recommended configuration (or deviations are explained and accepted).
- [ ] Empty weight is 60–70 lb (or explained).
- [ ] Fits the Tacoma bed with tailgate down (per measured or default parameters).
- [ ] No welding anywhere. All metal parts are purchasable or simply machined.
- [ ] No exposed plywood edges.
- [ ] Cut list, BOM (with total cost), DXFs, STLs and assembly steps are complete enough for an expert woodworker to build from.
- [ ] Deployed as a shareable static page, plus a single-file HTML build.
