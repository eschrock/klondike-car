/**
 * D-77 (Eric, 2026-10-13): the NO-FABRICATION rule for metal. Every metal part is bought ready-made, or is stock (flat bar, angle, rod, tube) cut on a metal bandsaw and drilled on a
 * drill press. No bending, welding, tapping, machining or countersinking. Deburring a cut edge is part of the cut. This module finds the metal parts of a model and lists any whose
 * fabrication or shop text asks for more. Plain TS, no three.js.
 */
import type { Fab, Part } from './types';

/** The rule as one sentence, for notes and the UI. */
export const NO_FAB_RULE = 'D-77: metal parts are bought ready-made, or stock cut on a metal bandsaw and drilled on a drill press; no bending, welding, tapping, machining or countersinking.';

/**
 * Fabrication steps a metal part may carry: bought, or cut and drilled. `drill-tap` is the model's legacy id for "cut on the metal bandsaw and drilled" (no part taps a thread; the
 * build outputs must word it as cut and drill), `bandsaw` is a strip cut to length.
 */
export const METAL_FABS: ReadonlySet<Fab> = new Set<Fab>(['buy', 'drill-tap', 'bandsaw']);

const METAL_WORDS = /\b(stainless|steel|alumin(um|ium)|zinc|brass|bronze|titanium|1045|6061|304|316|18-8)\b/i;

/** A metal part: kind 'metal', or a purchased part whose material names a metal. */
export function isMetalPart(x: Part): boolean {
  if (x.payload || x.kind === 'reference') return false;
  if (x.kind === 'metal') return true;
  return x.kind === 'purchased' && METAL_WORDS.test(x.material ?? '') && x.id !== 'hardware';
}

/** Shop operations the rule forbids on metal, as words in a part's notes, sourcing or joints (each with its reason). */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bweld/i, 'welding'],
  [/\bbraz(e|ed|ing)\b|\bsolder/i, 'brazing or soldering'],
  [/\b(tap|taps|tapped|tapping)\b(?! water)/i, 'tapping a thread'],
  [/\bthread (it|the|a|each)\b|\bcut (a |the )?threads?\b|\bdie[- ]cut threads?\b/i, 'cutting a thread'],
  [/\bcounter-?sin(k|king|ks)\b|\bcounter-?sunk\b/i, 'countersinking'],
  [/\b(bend|bent|bending it)\b/i, 'bending'],
  [/\bmachin(ed|ing)\b|\bmachine (it|the|them|down)\b|\blathe\b|\bturn(ed)? down\b|\b(milled|milling)\b/i, 'machining'],
  [/\bgrind\b|\bground (down|flat|to)\b|\bangle grinder\b|\bcut-off wheel\b|\btorch\b|\bplasma\b/i, 'grinding or torch cutting'],
  [/\bfil(e|ed|ing)\b/i, 'filing to shape (deburr only)'],
  [/\bround (the|its) (ends|corners)\b|\b(ends|corners) rounded\b/i, 'shaping the outline (cut square only)'],
];

/** Drop negated phrases ("no countersink", "NOT countersunk", "no bending, welding ...") so a part may state the rule without breaking it. */
const stripNegations = (t: string): string => t.replace(/\b(no|not|never|without|nothing)\b[^.;:()]*/gi, ' ');

/** The text a metal part carries into the shop: its notes, its sourcing line and its joint sizes and notes. */
export function shopText(x: Part): string {
  return [x.notes, x.sourcing?.vendor, ...(x.joints ?? []).flatMap((j) => [j.size, j.note])].filter(Boolean).join(' | ');
}

/** Every breach of the D-77 rule in a model: metal parts with a fabrication step outside {buy, cut, drill} or shop text that asks for a forbidden operation. Empty when it complies. */
export function noFabViolations(parts: Part[]): Array<{ id: string; why: string }> {
  const out: Array<{ id: string; why: string }> = [];
  for (const x of parts) {
    if (!isMetalPart(x)) continue;
    if (!METAL_FABS.has(x.fab)) out.push({ id: x.id, why: `fab '${x.fab}' is not bought, cut or drilled` });
    const t = stripNegations(shopText(x));
    for (const [re, why] of FORBIDDEN) {
      const m = t.match(re);
      if (m) out.push({ id: x.id, why: `${why}: "${t.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).trim()}"` });
    }
  }
  return out;
}
