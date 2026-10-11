SCORE: 6/10

Simple view, UX and accessibility review, round 1. Reviewed: spec, D-30, `index.html`, `main.ts`, `theme.ts`, `simple-view.ts/.css`, `simple-text.ts`, `rider-sweep.ts`, `style.css`, viewer toolbar, and the five screenshots in `docs/screenshots/simple/`.

**Verdict.** The core idea works. On desktop the headline, bar and legend answer "safe up to about 220 lb" in a few seconds, and status is carried by glyph plus word plus color. The phone is not shippable: the Advanced button is clipped, the header is four lines tall, and the 3D canvas traps scrolling. The wording still sounds like an engineer wrote it (kingpin, turntable, bolster). The headline also counts "close to the limit" weights as "safe", which a Scoutmaster could read as a green light.

---

## MUST FIX

### M1. [high] Phone header: title wraps to 4 lines and "Advanced" is clipped
- **Where:** `phone-top.jpg`; `.topbar` in `style.css:45`; `.mode-toggle` in `simple-view.css:24`.
- **Problem:** The header is a single non-wrapping flex row. The h1 and `.mode-toggle` shrink, and `overflow:hidden` on the toggle clips "Advanced" to nothing. Copy link and Reset to defaults wrap to 3 lines each. The header eats about 215 px of 812, and the mode switch is unusable.
- **Fix:** At ≤ 600 px, use two rows. Row 1 is the title on one line (`white-space:nowrap`, 15 px, ellipsis) plus the theme button. Row 2 is the Simple|Advanced toggle (`flex:none`) plus Copy link and Reset. Rules: `.topbar{flex-wrap:wrap}`, `.topbar h1{flex:1 1 auto}`, `.mode-toggle{flex:none}`, `.mode-toggle button{white-space:nowrap}`. Shorten the Simple-view labels to "Copy link" and "Reset". Optionally move both into a "⋯" menu on phones. Add a Playwright check at 375 px that "Advanced" is visible and the header is under 100 px tall.

### M2. [high] The 3D canvas captures page scroll (wheel and touch)
- **Where:** `phone-after-scroll-wheel.jpg`; `viewer.ts:230` (`new OrbitControls(...)` with defaults).
- **Problem:** OrbitControls sets `touch-action:none` and zooms on every wheel event. On a phone, the viewer is `position:sticky` at 45vh (`style.css:123`), so one-finger swipes over it rotate the model instead of scrolling. A big share of the page is a scroll trap, and on desktop a trackpad scroll over the model zooms it.
- **Fix:**
  - On touch or narrow screens, set `renderer.domElement.style.touchAction = 'pan-y'` and `controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }`. One finger then scrolls the page, and two fingers orbit and pinch.
  - Add a one-time hint chip over the canvas: "Use two fingers to turn the cart".
  - On desktop, zoom the wheel only when `ctrlKey || metaKey` is held (pinch zooms already set `ctrlKey`). Show a brief "Ctrl + scroll to zoom" toast when a plain wheel event is ignored. Alternative: `controls.enableZoom = false` until the canvas is clicked or focused.

### M3. [high] The headline calls "close to the limit" weights "safe"
- **Where:** `simple-text.ts:178-185`; the bar in `phone-top.jpg` shows 190–220 yellow, while the headline says "Safe for riders up to about 220 lb".
- **Problem:** `safe` counts marginal as not failing, so the headline range runs into the yellow zone. A parent sees green text and a 215 lb rider, while the bar says "close to the limit". This is the one sentence that must not be over-read. Nothing says what yellow means in practice, and nothing says these are calculator estimates.
- **Fix:** Show two tiers and key the green headline on the green run.
  - Headline: `Comfortably safe for riders up to 190 lb`
  - Subline, when yellow exists: `190–220 lb is close to the design limit. Above 220 lb: [reason].`
  - If every weight is green: `Safe for every rider from 50 to 250 lb`.
  - When the lower bound is the sweep floor (50), say "Safe for riders under 190 lb" rather than "up to about", and note that the lightest weight checked is 50 lb.
  - Add a one-line, muted caveat under the bar: `Estimated from design calculations. It is not a substitute for a test ride and adult inspection.`
  - Also fix the edge case where `failReason('')` returns " could fail" (`simple-text.ts:59,179`). Use "a safety check fails" as the fallback.

### M4. [high] Jargon in limiting reasons and light sentences
- **Where:** `simple-text.ts:44-60` and `26-40` (reasons); lines 94-170 (lights).
- **Problem:** "kingpin", "turntable", "bolster fasteners", "side bearers", "bearing groove", "tongue", "design limit". The screenshot reads: "Above 220 lb: the turntable could be overloaded". That is understandable to nobody but the builders, and it is not actionable. It also hides what happens: parts break and the steering fails.
- **Fix (copy):**

| id | New copy (after "Above N lb: ") |
|---|---|
| kingpin-strike | `a hard bump into a curb could bend or break the steering pin (kingpin).` |
| turntable | `the steering pivot (turntable) would be overloaded.` |
| roll-kingpin-uplift | `leaning hard could pull the steering pin out.` |
| roll-side-bearer / roll-bolster-attach | `the front steering plate could come loose when the cart leans.` |
| axle-stress / beam-* / bearing-groove | `an axle could bend.` |
| rails / deck / tongue (`partText`) | `the side rail / floor / pull handle could crack.` |
| pitch-rear | `a hard pull uphill can lift the front wheels.` |
| tip-straight / tip-lock | `it could tip over on a side slope.` |
| slide-before-tip | `a fast, sharp turn could roll it over instead of skidding.` |
| brake-force | `it takes too hard a squeeze on the brake handle to hold it on a hill.` |

  - Strength light: replace `Every part is at most 92% of its design limit (weakest: …)`. 92% reads as an alarming near-failure, and "design limit" is undefined. Use: `Every part has a safety margin. Closest to its limit: the steering pin in a curb strike (92% of what it can take).` Show the percentage only when the status is marginal or fail.
  - Delete the footnote `The Analysis tab also checks the goal and lightest riders…` (`simple-view.ts`, below the lights). The tab is not visible in Simple. Replace it with `Tap a card for the engineering detail.`
  - Make the lights look tappable: add a trailing "Details ›" label (see M8).
  - Add one action line under the limiters: `To carry heavier riders: widen the wheels, lower the floor, or use bigger wheels.` Derive it from the limiter via a small static map per check id.

### M5. [high] Layout and hierarchy: the main control is far from the answer; the spec card duplicates the glance strip
- **Where:** `simple-view.css:114-120` (stacked order: viewer → safety → controls); `simple-view.ts` `host.append(...)` order; `desktop-light.jpg`, `phone-top.jpg`.
- **Problem:**
  - **Controls far from results.** On a phone the Rider weight slider sits below the whole safety card and every light, so you must scroll about 2.5 screens to change the one input that drives the headline.
  - **Order.** On the right column the order is headline → glance strip (4 tiles) → bar → Watch it → lights. The bar, the real answer, starts about 300 px down on phone and the glance tiles push it below the fold. The Watch it demos sit above the six lights, which delays the safety detail.
  - **Duplicates.** The "The cart" spec card (last section) repeats size, weight, turning and fits from the glance strip. Its only extras are Size for the truck (a useful number), wheel size and floor height (already sliders).
- **Fix:**
  - Order the safety card as: headline (plus subline) → bar with marker → rider-weight slider directly under the bar on every breakpoint (move the Rider weight control out of the left column, or mirror it) → legend and limit lines → the six lights → glance strip → Watch it.
  - Delete the spec card. Fold "Size for the truck" into the glance Truck tile: `Fits a 60.5 × 41.5 in bed (needs handle and seat off)`.
  - Left column keeps only the 5 shape knobs, under the heading "Change the cart".
  - On a phone, give the viewer less room: stop making it sticky in Simple mode, or use 32vh, so the safety card is the main thing. Collapse the toolbar (M7).

### M6. [high] Contrast of green and amber text in the light theme
- **Where:** `simple-view.css:3-4`.
- **Estimates:**
  - `--sv-pass #1f8f4e` on white is about 4.1:1.
  - `--sv-warn #b7791f` on white is about 3.6:1.
  - `--sv-fail #d1352b` is about 4.9:1 (passes).
  - `--muted #6a717d` on `--panel-2 #eef0f4` is about 4.3:1.
- **Problem:** These fail the 4.5:1 requirement for text under 24 px (or 18.66 px bold). They affect the headline (18 px bold, borderline), the legend (11 px), the glance "Fits" tile, and `.sv-light-status`. The dark theme is fine (pass `#4cc784` on `#1d2027` is about 7:1).
- **Fix:**
  - Light theme: `--sv-pass-text: #146c3a` (about 6.3:1) and `--sv-warn-text: #8a5a00` (about 5.4:1). Use these for any text. Keep the saturated colors for borders and fills only.
  - Use `--sv-pass-fg` and `--sv-warn-fg`, which already exist, for the headline, legend and glance. Set `--muted` to `#5b626e`.
  - The bar glyphs are only 11 px in 14 px-wide cells on desktop. Increase them to 12 px bold.

### M7. [high] Toolbar: 3 rows on phone, targets under 44 px, and a confusing second "Steer"
- **Where:** `phone-top.jpg` toolbar; `style.css:111-113,119-125`; `viewer.ts` toolbar builders.
- **Problem:**
  - **Rows and targets.** Iso/Top/Side/Front, Explode, Dimensions, Steer and Rider wrap into 3 rows (about 140 px). Targets are about 28 px tall, and the checkboxes are about 13 px, below the 44 px target size.
  - **Two steers.** The toolbar "Steer 0° ↺" slider only turns the wheels in the picture. The left control "How sharp it turns" changes the design. Two controls named steer with different meanings will confuse people, and the first is a design toggle in the toolbar, not a rider control.
  - **Explode.** It is entertaining but not part of the safety question, and it takes up toolbar space.
- **Fix:**
  - Labels: toolbar slider becomes "Try steering" with title "Preview only. Doesn't change the cart." The left control becomes "Steering angle (each way)", with hint "Bigger angle = tighter turns."
  - Add `@media (pointer:coarse), (max-width:600px)`: buttons `min-height:44px`, checkbox labels `min-height:44px` with padding, and a larger `accent-color` checkbox (20 px).
  - On a phone, keep one row with the four views (as a segmented control) and a "⋯ More" `<details>` holding Explode, Dimensions, Steer and Rider.
  - Rename the checkbox "Rider" to "Show rider".

### M8. [high] "Watch it" and light clicks silently switch to Advanced; the mode sticks; Back is easy to miss
- **Where:** `main.ts:166-225`; `.back-bar` at `simple-view.css:30`; `simple-view.ts` demos and lights.
- **Problem:**
  - **No warning.** Buttons labeled "Tilt test / Sharp turn / Curb bump / Brake on a hill" give no hint that you land in a different, dense screen. The same is true for a click on a light card.
  - **Mode persists.** `setMode` writes `klondike-view-mode='advanced'` to localStorage even when the switch came from a demo. A parent who watches one demo reopens the link to the full engineering UI.
  - **Back is out of sight on phone.** `.back-bar` is prepended into `#right`, which on phone sits below the whole parameter list. After a demo the user sees the Advanced params, with no visible way back except the Simple|Advanced toggle (already clipped, see M1).
- **Fix:**
  - Relabel the section "See what happens (opens the detailed view)". Rename the buttons: "Tip it sideways", "Sharp turn at speed", "Hit a curb", "Brake on a hill".
  - Do not persist the mode when `fromSimple` is true. Persist only an explicit toggle click, so a shared link opens Simple.
  - Put the Back bar at the top of the page under the header (full width, sticky, 44 px), for example "← Back to the simple view". Move it from `#right` to its own grid area. Do the same for the sim/analysis scroll position (return to the previous scroll offset).
  - Add `aria-label`s that say "Opens the detailed view". Also add a trailing "Details ›" label to the lights.

### M9. [med] Live-region noise while dragging sliders
- **Where:** `simple-view.ts` `.sv-live` (`role="status" aria-live="polite"`) wrapping the h2, which contains the "checking…" span; `setBusy` toggles `aria-busy` on the host.
- **Problem:** Every slider tick (each `pending()` call) shows or hides "checking…" inside a polite live region, so screen readers get "checking…" and then the new headline on every change. Dragging announces dozens of messages. `aria-busy` on the whole sidebar can also suppress reading it.
- **Fix:**
  - Move `role="status"` to a visually hidden `<div>` that is updated only after a 600 ms debounce (when the user stops), with the headline text only.
  - Drop "checking…" from the live region (keep it visual only, `aria-hidden`).
  - Remove `aria-busy` on the host.
  - Add `aria-valuetext` to the sliders (`150 pounds`, `44 inches`) so the unit is read.

### M10. [med] Mobile focus order is not the visual order
- **Where:** `simple-view.css:114-120` (CSS `order`); DOM order in `index.html` is left → viewer → right.
- **Problem:** On a phone the visual order is viewer → safety → controls, but keyboard and screen-reader order is controls → viewer → safety. That fails WCAG 2.4.3 and 1.3.2 on small screens.
- **Fix:** Put `#simple-right` before `#simple-left` in the DOM, and use `grid-area` to preserve the desktop columns (left/main/right). The 1200 px media query then needs no `order`. Verify there is a visible focus ring on `.sv-light` and `.sv-demo` (`button:focus-visible` exists globally, which is good).

---

## NICE TO HAVE

### N1. [med] Bar cells are not accessible per weight, and the legend does not match
- **Where:** `simple-view.ts` bar (`title` only on cells).
- **Problem:** Per-cell explanations exist only as hover `title`, so they are unreachable on touch and by keyboard. The legend shows "✔ OK" but green cells show no glyph. Each cell is only about 14 px wide on desktop.
- **Fix:**
  - Show a ✔ in pass cells, or drop it from the legend and say "green = OK".
  - Make the bar a `role="slider"` or radio group, so tapping or arrowing a cell sets the rider weight and reveals that cell's reason in a text line ("190 lb: close to the limit (curb strike on the steering pin)"). This also removes the need for a separate rider slider if you want a minimal UI.
  - Under the bar, label ticks at 50, 100, 150, 200 and 250 (already there).

### N2. [med] Glance strip: wording, consistency and status
- **Where:** `simple-view.ts` (glance), `simple-text.ts` steering.
- **Problems and fixes:**
  - "Turns in 15.6 ft" is the circle diameter (`2 × radius`), but "turns in" reads as radius or distance. Use `Turning circle: 15.6 ft across`. Use the same wording in the Steering light (`simple-text.ts:141`): "Turns in a 15.6 ft circle" becomes "Needs a circle 15.6 ft across to turn around". The spec example "an 15.6" had an article typo, which is not in the code but easy to reintroduce.
  - Add a relatable anchor: "(about the width of a two-car driveway)".
  - The Steering light is yellow ("Close to the limit", `desktop-light.jpg`), but the glance tile shows no status color. Color it the same, or the strip appears to contradict the lights.
  - "Weight 127 lb · 58 lb each to lift" is ambiguous. Use `Empty weight 127 lb`, and `Two people lift 58 lb each` on a second line.
  - The Truck tile says "bed", the light says "Tacoma bed". Pick one: "Fits a Tacoma bed (60.5 × 41.5 in)". Say what is removed: `with handle and seat back off`.
  - Rounded size (71 × 41 × 36) uses `Math.round`, while the spec card uses `f1`. After removing the spec card, keep one format.
  - Add "in" or "inches" to the tick-free tile values for reading aloud.

### N3. [med] Light sentences: tone and relatable numbers
- **Where:** `simple-text.ts:88-145`.
- **Problems and fixes:**
  - "Stays upright on a 45° side slope... (A very steep hill is about 30°.)": the parenthesis is good. Add "45° is steeper than any hill you will take it on" to avoid sounding like a dare.
  - "Rollover would need about 9 mph at full lock": add "(a brisk jog is about 6 mph)" with the same parenthesis style. Without a reference, 9 mph means nothing.
  - "Holds on a 15° hill with 20 lb on the brake handle": add "(the limit is 30 lb, about a firm one-handed squeeze)". Hide the numbers behind a "Details" expander if the card gets long.
  - Marginal and fail copy is clear. Prefer "Close to the limit" in `STATUS_WORD` (kept) but make the bar legend say the same words ("Close to the limit", not "! close to the limit"); `STATUS_WORD.fail = 'Problem'` vs the legend "a check fails" should be one term ("Problem").
  - Consider ordering the lights by severity (worst first), not a fixed order, so the yellow Steering card is not at the fold.

### N4. [med] Theme toggle discoverability and semantics
- **Where:** `theme.ts:11-12,35-42`; `desktop-light.jpg` header.
- **Problem:** An unlabeled glyph button cycles auto → light → dark. The icon shows the current state, not the action, and "◐" (auto) is cryptic. `aria-label` changes with state but there is no `aria-pressed`, and a cycle of three states is harder than two. Contrast of the glyph is fine.
- **Fix:** Use a two-state switch (light/dark, initialized from the system) with a text label on phones ("Dark mode"), or a small `<select>`: "Theme: Auto / Light / Dark". If it stays an icon, make it `aria-label="Switch to dark theme"` (the action), with a visible tooltip, and a 44 px target.

### N5. [low] Controls: which knobs, hints and ranges
- **Where:** `simple-view.ts:CONTROLS`.
- **Problems and fixes:**
  - The five shape knobs are the right set. Keep them. Add an indicator at the slider ends when the value is outside the verified or tested range, if `validateParams` flags it.
  - "Wheel size", "Floor height" and "Width between wheels" hints should say what they trade off: "Bigger wheels roll easier and tip less, but add weight." "Lower floor = steadier. Higher floor = more clearance." "Wider = steadier, but harder to fit in the truck."
  - The Rider weight hint is wordy. Use "Check the cart for this rider. The bar shows every weight."
  - The prominent control's border (accent) reads as a selected state. Use a filled header ("Who is riding?") instead.
  - Reset arrows (↺) are 18 px high. Make the hit area 44 px (padding) and label "Reset to 44 in".
  - Reset to defaults (header) is destructive and unconfirmed. Add undo ("Reset. Undo") or confirm if the design differs from the default. Check "Copy link" shows "Copied!" feedback (not verified in code).
  - Show a preset/value label for the steer angle (`37°`) and, better, its effect ("turning circle 15.6 ft"), live.

### N6. [low] Reduced motion
- **Where:** `simple-view.css:73` (`transition: left 80ms`), `viewer.ts` damping and flash.
- **Problem:** Only `.sv-flash` honors `prefers-reduced-motion`. The 80 ms marker transition is trivial, but OrbitControls damping and the sim continue, and the 3D auto-rotation or Back-to-simple smooth scroll might not.
- **Fix:** Add `@media (prefers-reduced-motion: reduce){ .sv-marker{transition:none} }` and set `controls.enableDamping=false` under that query.

### N7. [low] Landmarks and headings
- **Where:** `index.html:30-34`; `simple-view.ts`.
- **Problem:** The right `<aside aria-label="Is it safe?">` has no visible "Is it safe?" heading, and its first h2 is the headline. The left aside is named "Your cart" but the heading says "Your cart" while the controls change the design.
- **Fix:** Add a visible small heading "Is it safe?" above the headline, and rename the left to "Change the cart". Hide the Advanced asides (`#params`, `#right`) with `display:none` (already done) rather than leaving them labeled in the AT tree. Add a skip link ("Skip to the safety result").

### N8. [low] A/B and scale readiness; empty and error states
- **Where:** `simple-view.ts` (`DesignView`).
- **Problem:** A/B is ready in the data model. In the UI, nothing yet signals which design the card is about. When a custom design fails everywhere, the single limit line says "No rider weight from 50 to 250 lb is safe", which is correct but with no next step.
- **Fix:** Add a "Design: Standard" label above the headline (it will hold "A" or "B" later). For all-fail: `No rider weight is safe with this cart. Try a wider or lower design, or press Reset.`

---

## What to keep
- Status is never by color alone: glyph plus word plus color is used consistently in the bar, lights and tiles.
- Headline first, with a large rider marker on the bar, and per-end reasons.
- Plain control labels with units and a per-control reset.
- Theme and mode are applied before first paint with try/catch around localStorage.
- Hidden-in-Simple controls (`adv-only`, `viewer-toggles`) keep the toolbar mostly clean.

## Verification checklist for the next round
1. 375 px: the header is at most 2 rows, "Advanced" is visible, and every control is at least 44 px.
2. Swiping over the viewer on a phone scrolls the page. A two-finger gesture rotates.
3. The headline and subline never imply "safe" for yellow weights.
4. The light theme passes 4.5:1 for all text (run axe or a contrast check).
5. Dragging the rider slider produces at most one screen-reader announcement.
6. After "Watch it", Back to simple is visible on phone, and a reload opens Simple.
