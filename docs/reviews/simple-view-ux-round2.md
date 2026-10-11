SCORE: 8/10

Simple view, UX and accessibility review, round 2 (up from 6/10). Reviewed: spec, round-1 review and its fix list, `index.html`, `main.ts`, `theme.ts`, `style.css`, `simple-view.ts/.css`, `simple-text.ts`, the viewer toolbar/OrbitControls code, and the phase-3 and round-1 screenshots. I also loaded the app at 375 px and 320 px and measured it.

**Verdict.** The phone is now usable and the answer comes first: headline, bar, rider slider, then the at-a-glance strip and Watch it, then the six cards. That matches the owner's ordering. The remaining problems are small: one piece of copy that reads as a bare fact, a shop jig in the 3D view, a few borderline contrast spots, and a mouse-only bar.

## Round-1 must-fix status

| # | Item | Status | Evidence |
|---|---|---|---|
| M1 | Phone header | **Fixed** | `simple-phone.jpg`: two rows (title + theme, then Simple/Advanced + Copy link + Reset). "Advanced" is fully visible. Header is about 92 px. |
| M2 | Canvas traps scroll | **Fixed in code, unverified on a device** | `viewer.ts:342-351`: `touch-action: pan-y`, one finger off, two fingers orbit, wheel needs Ctrl/Cmd or a click, plus a hint. Needs a test on a real phone. |
| M3 | "Safe" counted yellow | **Fixed** | Headline keys on the green run ("Comfortably safe for riders up to 170 lb"), subline gives the yellow range, caveat under the bar. |
| M4 | Jargon | **Mostly fixed** | Plain reasons, "steering pin" and "steering plate". "(turntable)" kept once in parentheses, which is fine. Two leftovers below (C1). |
| M5 | Layout and hierarchy | **Fixed** | Slider under the bar, spec card gone, truck folded into the glance strip. Owner ordering respected. |
| M6 | Contrast | **Mostly fixed** | Text tokens are good: pass 6.3:1, warn 5.4:1, fail 5.2:1 on white. A few spots remain (C3). |
| M7 | Toolbar | **Fixed** | Views row plus "More", 44 px targets, "Try steering" vs "Steering angle (each way)", "Show rider". |
| M8 | Demos and lights switch mode | **Fixed** | Demos labeled "(opens the detailed view)", mode not persisted, full-width sticky Back bar. |
| M9 | Live region noise | **Fixed** | Debounced status, no `aria-busy`, `aria-valuetext` present. |
| M10 | Focus order | **Fixed** | DOM order is viewer, safety, controls. |

## The phone "white gutter": not a layout overflow

I could not reproduce it. At 375 px and 320 px, `documentElement.scrollWidth` equals `clientWidth`, and no element has `getBoundingClientRect().right` beyond the viewport.

The screenshots show a gray band at the right and at the bottom. The content is 353×764 inside a 375×812 image, which is the same 0.94 scale on both axes. A layout overflow would add a gutter on the right only, so this is how the images were captured, not a CSS bug.

I checked the likely CSS suspects and none of them cause it:
- `.sv-ticks span` is centered at 100% (the "250" tick), but it is inside the 12 px padding.
- The `.sv-sr` clip-pattern labels are 1 px and clipped.
- `.skip-link` sits at `top:-60px`.
- `.viewer-more` is `display:none` until opened.

**Fix:** retake the phone screenshots at a true 375×812 device pixel ratio of 2, and add a test that fails if `scrollWidth > innerWidth` at 320, 360 and 375 px. Do not add `overflow-x:hidden` to the page. It would hide a real regression.

## The blue form beside the prow

That translucent blue panel is the bent-lamination form, a shop jig tagged as reference. It does not belong in the Simple view. A parent will read it as a bumper, a sail, or a missing part.

`setSimpleMode` makes every group visible (`this.hidden.clear()`), which turns it on. The other translucent blue blocks are the rider figure.

**Fix (M-level for clarity):**
- In Simple, hide parts with `group === 'reference'` or `kind === 'reference'` (the form, the truck bed outline) and restore them when switching to Advanced.
- Keep the truck bed visible only when the Truck tile is being shown.
- Add a small "Blue = rider" key in the viewer corner, since there is no legend.

## Must fix

**C1. [med] Limit lines read as bare facts with no consequence.**
- Current text: "Above 210 lb: the steering pivot (turntable) would be overloaded." then, in bold, "To carry heavier riders: ask the builders to strengthen that part."
- Problems: "overloaded" does not say what happens (it could crack or fail). "that part" points to a line the reader has to look back up for. "ask the builders" is odd when the builders are among the readers. Nothing tells a parent what to do about the yellow weights.
- Fix (copy):
  - `Above 210 lb: the steering pivot (turntable) could be overloaded and fail.`
  - `Heavier riders need a stronger steering pivot. That is a job for the builders.`
  - Name the part in the advice, so it stands alone. In `simple-text.ts:104`, change the fallback `'ask the builders to strengthen that part'` to `` `strengthen ${PART[id].name}` ``. Keep `adjust the cart in the controls below` for the shape knobs.
  - Add a yellow-weights line: `180–210 lb: allowed, but there is little margin. Adults should inspect the pivot first.`
  - Subline: `180–210 lb are close to the limit` does not say what "the limit" is. Use `180–210 lb leave very little safety margin.`

**C2. [med] The bar is mouse and touch only.**
- The cells are `div`s with a click handler. The slider covers keyboards, but screen-reader users hear nothing about the bar.
- Fix: mark the bar `aria-hidden="true"` with a text alternative (the `.sv-note` line, which is already the readable summary). Keep the click handler for touch. Or make it `role="radiogroup"` with roving tabindex. The cheap option is enough here.

**C3. [low-med] Contrast and class collisions.**
- White text on `--accent #2f6fed` is about 4.5:1, borderline, on the pressed mode toggle, the "Who is riding?" header and the skip link. Use `#2563d9` or the `#1d55c4` already used for "Details ›" (6.7:1).
- The global `.pass` and `.fail` rules in `style.css:167-168` (green/red, weight 600) also hit `.sv-light.pass`, `.sv-glance-item.pass` and `.sv-cell.pass`. In the screenshot, the pass and fail cards and the Truck sub-text come out semibold while the yellow cards are regular. Fix: scope those two global rules to `.summary .pass` or `.fit-card .pass`, or rename the Simple classes (`sv-pass`).

## Nice to have

- **N1. Demo grid at 4 columns is cramped.** `.sv-watch .sv-demos` uses 4 columns, and in the 340 px right column the labels wrap to 2-3 lines ("Tip it / sideways"). Use 2×2 in the right column (the rule is only 2 columns at ≤ 600 px) and let the buttons grow.
- **N2. Glance numbers do not add up.** "Empty weight 148 lb / Two people lift 68 lb each" implies 136 lb, which is not 148. Say what is removed: `Two people lift 68 lb each (seat and handle off: 136 lb)`.
- **N3. Jargon leftovers.** "Tacoma" is a brand a few scouts will not know: "a pickup bed (60.5 × 41.5 in)" with Tacoma in the sub-line. The "two-car driveway" comparison is vague. "About 16 ft, a bit wider than a parking space is long" is concrete.
- **N4. Caveat is cut off at the bottom of the phone shot.** Make sure it is not clipped by the sticky viewer or by the `min-height` rule. Also move "Estimated from design calculations…" closer to the bar, since it qualifies the headline.
- **N5. Focus.** The global `button:focus-visible` outline is fine. Verify the outline is not clipped on `.sv-light` (`overflow` is not set, so it should be fine) and that `#simple-right:focus {outline:none}` is only reached by the skip link. Add `scroll-margin-top` to `#simple-right` so the skip-link target is not hidden under the sticky viewer on phones.
- **N6. Touch.** Slider thumbs on `.sv-range` are 44 px tall, which is good. The bar cells are 30 px tall and about 14 px wide on a phone, which is too small to hit reliably. Either make the bar 44 px tall and let the cells scroll, or accept that the slider is the real control and say "Use the slider" in the legend on touch devices (replace "Tap a block to try it").
- **N7. Dark theme.** Pass/warn/fail text tokens look fine in dark. Check the translucent blue rider against `--viewer-bg #101216`, where it may disappear.

## What to keep
- Owner ordering: glance strip and Watch it above the per-light cards, Dimensions and Explode still available.
- Glyph plus word plus color for every status.
- The two-tier headline and the caveat.
- Debounced single live announcement, `aria-valuetext`, skip link, visible "Is it safe?" heading.
- Back bar that restores scroll position, and a mode that is not saved when a demo opens Advanced.

## Next-round checklist
1. `scrollWidth <= innerWidth` at 320, 360 and 375 px (automated).
2. The form and other reference parts are hidden in Simple and back in Advanced.
3. The limit lines name the consequence and the part, and the yellow range has its own sentence.
4. White-on-accent text measures at least 4.5:1 with margin (target 5:1+).
5. Pass and fail cards have the same text weight as the yellow card.
6. On a real phone, one finger scrolls past the viewer and two fingers rotate.
