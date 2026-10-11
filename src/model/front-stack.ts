/**
 * The height of the front-end linkage stack under the deck (Phase 3c-1, D-53): the tongue-link pin head is the highest front-end part, and the deck underside must
 * stay above it. A pure function of the params, so the validator (`params.ts`) and the layout (`front-layout.ts`) can both use it. The old rear-brake rules (the
 * cross-shaft notch under the deck ledge) were what kept the deck from dropping below this; with the new brake following the rail bottom, this is the rule.
 * Plain TS.
 */
import type { Params } from '../params';

/** Margin over the linkage running clearance that the tongue keeps under the front transom's bottom edge (spec 3.6). */
export const TONGUE_UNDER_TRANSOM_MARGIN_IN = 0.05;
/** The tongue-link pin head stands this far above the link plate top (front-end.ts). */
export const LINK_PIN_HEAD_IN = 0.2;

export function frontStackTop(p: Params, r: number, deckTop: number): { beamTop: number; tongueTop: number; linkTop: number; pinTop: number } {
  const beamTop = r + p.frontBeamDepthIn / 2;
  const tongueTop = deckTop - p.crossmemberDepthIn - p.steeringLinkClearIn - TONGUE_UNDER_TRANSOM_MARGIN_IN;
  const hingeTop1 = tongueTop + p.tongueClevisThickIn;
  const plateZ0 = Math.max(hingeTop1, beamTop + 2 * p.beamNotchClearIn);
  const linkTop = plateZ0 + 2 * p.kingpinBracketThickIn;
  return { beamTop, tongueTop, linkTop, pinTop: linkTop + LINK_PIN_HEAD_IN };
}
