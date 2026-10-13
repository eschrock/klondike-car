/**
 * Phase 4 output 6: assembly steps.
 *
 * Built from `Part.step` (STEP / HULL_STEP in model/build-utils.ts), the hull build-sequence comment above HULL_STEP, and each part's `joints`.
 * Pure function of (parts, params). Three kinds of step:
 *   - 'prep'    preparation with no parts in the model (verify, mill, Shaper parts and forms, seal);
 *   - 'build'   installs parts (partIds);
 *   - 'process' no new parts: dry fit, lowering, flipping the hull, finishing.
 *
 * Every non-reference part is installed in exactly one step. Parts a template does not name fall into the last template of their model
 * step, or into a generated step of their own, so a part added to the model can never go missing from the build order.
 *
 * WRITING STYLE (Eric 2026-10-12: "hard to follow"). Each step is a one-line `goal`, then 3-8 short `items` (one action each, details as sub-bullets), the glue / clamp / cure
 * in `clampCure`, and short `checks`. A part is mentioned as a `{{part-id}}` token (the UI makes it a chip that shows the part's drawing; `renderInstrText` turns it into the
 * part's name). Numbers are shop fractions (`fin`, `roughFrac`), and only the ones needed at that moment: sizes live in the cut list, locations come from the part drawings
 * (`part-drawings.ts`). No purchasing (that is the shopping list), no param or file names, no raw part ids, decision ids only as a trailing "(see D-n)" where the why matters.
 * `instructions` is the same text flattened (sub-items as "– " lines) for readers that do not know `items` yet.
 *
 * FINISH AFTER HARDWARE (build review round 1, MUST-1). The running gear, eye bolts, hinges, handle sockets and the brake kit are FITTED AND DRILLED at their own
 * steps (dry, then taken off), the hull is finished (underside before the flip, the rest after the box, seat, brake and handle), and `hang` installs them after the
 * varnish has cured. The parts in `isHangPart` therefore belong to the `hang` step, not to the step that fits them, so the step-through viewer shows them on the sled only
 * once they are really on it. The `hang` step's `modelStep` is clamped up to the finish step (the list stays nondecreasing); every other part is installed in its own model step.
 * The tongue, the beams, the kingpin and the hold-downs stay on the hull and are finished in place (D-65: the tongue is not removable).
 *
 * BRAKE KNEES GO ON BEFORE THE UNDERSIDE FINISH (build review round 2, MUST-A). The knee legs are epoxied to the rail and chine outer face and bolted through the backer, with the nylocks in
 * counterbores under the deck: epoxy will not bond to varnish and the nuts are reachable only while the hull is inverted. The knees (and their backers, if the model installs them late) are
 * `STEP.brake` (6) in the model, but the `brake-knees` step sits between the front beam and the wheel dry fit. Its `modelStep` is clamped DOWN to the position it occupies (the running
 * model step of the steps before it), so the list stays nondecreasing and the step-through viewer shows the knees exactly when they are glued. The flaps, pins, pads and cords stay in
 * `brake-flaps` and `hang` (model step 6 and 7).
 */
import { HULL_STEP, STEP } from '../model/build-utils';
import { computeLayout, outerHalfWidth, samples, sideTopAt } from '../model/layout';
import type { AssemblyStep, Joint, Part } from '../model/types';
import { axleGrooveDepthIn, bowTaper, thinSheet, WEATHER_SPEC, type Params } from '../params';
import { screwText } from '../model/rear-mount';
import { transformPoint, worldAABB } from '../model/bounds';
import { cutList, type CutList, type ResawPool } from './cutlist';
import { epoxyTimeFactor, finishingSchedule } from './finishing';
import { flatPattern } from './flat';
import { formDrawings, RIB_STOCK_IN, type FormDrawing } from './forms';
import { oakBoardFeet, type OakPlan } from './nesting';
import { partDrawings, type DrawingFeature, type PartDrawingSheet } from './part-drawings';
import { finalFrac, nearest32, roughFrac } from './units';
import { verifyChecklist } from './verify';

export type StepKind = 'prep' | 'build' | 'process';
export type Hardener = '205' | '206' | '209';
export type StepView = NonNullable<AssemblyStep['view']>;

/**
 * One instruction: a short action, its details as sub-items. `{{part-id}}` in `text` marks a part mention (rendered as the part's name, or a chip).
 * `parts` lists every part the item is about: the tokens in `text`, plus parts it names in plain words ("both rails").
 */
export interface Instr {
  text: string;
  sub?: Instr[];
  parts?: string[];
}

/** A part mention in instruction text: `{{rail-L}}`. */
export const PART_TOKEN_RE = /\{\{([^{}\s]+)\}\}/g;

/** Part ids named by `{{...}}` tokens in a text, in order, once each. */
export function tokensIn(text: string): string[] {
  return [...new Set([...text.matchAll(PART_TOKEN_RE)].map((m) => m[1]))];
}

/**
 * The name a part goes by in running text: its model name without a long parenthetical ("Brake pivot knee L (white oak outrigger)" -> "brake pivot knee L"; a one-word
 * position such as "(outer)" stays), lower-cased unless the name starts with an acronym ("UHMW").
 */
export function partLabel(x: Pick<Part, 'id' | 'name'> | undefined, id = ''): string {
  if (!x) return id;
  const name = x.name.replace(/\s*\(([^)]*)\)\s*$/, (_m, q: string) => (/^(outer|inner|top|bottom)$/i.test(q) ? ` (${q})` : '')).trim() || x.id;
  return /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

type NameSource = ReadonlyArray<Pick<Part, 'id' | 'name'>> | ((id: string) => string | undefined);

/** Replace every `{{part-id}}` token with the part's name (capitalized at the start of a sentence). Unknown ids fall back to the id itself. */
export function renderInstrText(text: string, parts: NameSource): string {
  const look = typeof parts === 'function' ? parts : ((m) => (id: string) => { const x = m.get(id); return x ? partLabel(x) : undefined; })(new Map(parts.map((x) => [x.id, x])));
  return text.replace(PART_TOKEN_RE, (_m, id: string, at: number, all: string) => {
    const name = look(id) ?? id;
    const start = at === 0 || /[.!?]\s+$/.test(all.slice(0, at));
    return start ? name[0].toUpperCase() + name.slice(1) : name;
  });
}

/** The items as flat lines: each item, then its sub-items as "– " lines (one dash per level), tokens replaced by names. */
export function flattenInstr(items: Instr[], parts: NameSource, depth = 0): string[] {
  const out: string[] = [];
  for (const it of items) {
    out.push(`${depth ? `${'– '.repeat(depth)}` : ''}${renderInstrText(it.text, parts)}`);
    if (it.sub?.length) out.push(...flattenInstr(it.sub, parts, depth + 1));
  }
  return out;
}

/** Map every text of an instruction tree. */
export function mapInstr(items: Instr[], fn: (t: string) => string): Instr[] {
  return items.map((it) => ({ ...it, text: fn(it.text), ...(it.sub ? { sub: mapInstr(it.sub, fn) } : {}) }));
}

type Sub = Instr | string | false | null | undefined;
/** An instruction: its parts are the tokens in its text plus `also`. Falsy sub-items are dropped. */
export function I(text: string, sub?: Sub[], also: string[] = []): Instr {
  const subs = (sub ?? []).filter((s): s is Instr | string => !!s).map((s) => (typeof s === 'string' ? I(s) : s));
  const parts = [...new Set([...tokensIn(text), ...also])];
  return { text, ...(subs.length ? { sub: subs } : {}), ...(parts.length ? { parts } : {}) };
}

/** Epoxy working times at 70 °F (WEST System 105 with the named hardener). */
export interface Cure {
  hardener: Hardener;
  /** Pot life of a mixed batch, minutes. */
  potMin: [number, number];
  /** Time under the clamps before they can come off, hours. */
  clampHours: [number, number];
  /** Time to full cure, hours. */
  fullHours: number;
}

export const HARDENERS: Record<Hardener, Cure & { label: string }> = {
  '205': { hardener: '205', label: '205 fast', potMin: [9, 12], clampHours: [5, 6], fullHours: 24 },
  '206': { hardener: '206', label: '206 slow', potMin: [20, 25], clampHours: [8, 10], fullHours: 24 },
  '209': { hardener: '209', label: '209 extra slow', potMin: [90, 120], clampHours: [20, 24], fullHours: 48 },
};

export interface BuildStep extends AssemblyStep {
  /** Stable id for the viewer / print anchors. */
  id: string;
  kind: StepKind;
  /** One line: what the step achieves. */
  goal: string;
  /** The instructions: 2-10 short actions with sub-bullets; `{{part-id}}` tokens mark part mentions. `instructions` is the flat text of the same. */
  items: Instr[];
  /** Lowest `Part.step` value of the parts this step installs (0 for preparation). Nondecreasing along the list. */
  modelStep: number;
  /** Parts installed in this step (cumulative view: earlier steps solid, this one highlighted). */
  partIds: string[];
  tools: string[];
  checks: string[];
  /** Epoxy used by the step (a step with several glue-ups lists the one that sets the schedule). */
  cure?: Cure;
  view: StepView;
}

export interface StepCtx {
  parts: Part[];
  p: Params;
  /** Parts installed in this step. */
  mine: Part[];
  by: (id: string) => Part | undefined;
  /** Computed once per `assemblySteps` call: the resaw plan (cut list), the form drawings and the oak board plan. */
  resaw: () => ResawPool[];
  forms: () => FormDrawing[];
  oak: () => OakPlan;
  /** The cut list (the board column, the strip rows), computed once. */
  cut: () => CutList;
  /** The dimensioned part drawings (feature locations), computed once. */
  drawings: () => PartDrawingSheet[];
}

/**
 * Removable hardware that is fitted and drilled where it belongs, taken off for finishing and installed in the `hang` step: wheels, axles, clamp plates, roll pads, eye bolts,
 * anchors, check chains and the bridle rope; hinges, pins and cushions; handle sockets and pins; the brake flap's pin, clip, cord, snap, pad and tread.
 * Only purchased, metal and printed parts qualify: every wood part, the beams, the hold-downs, the kingpin and the sleeve stay on the hull.
 */
const HANG_RE = /^(wheel-|axle-(R|F[LR])$|clamp-|roll-pad-|steer-(eye|anchor|chain)-|bridle$|seat-(hinge|pin|cushion|back-pad)|storage-hinge-[LR]$|handle-(socket|pin)-|brake-(pivot-pin|pivot-clip|cord|snap|pad|foot-tread|chock-cord))/;
export const isHangPart = (x: Part): boolean => (x.kind === 'purchased' || x.kind === 'metal' || x.kind === 'printed') && HANG_RE.test(x.id);

/** Steps whose parts have a later model step than the step's position (the brake knees and backers: `STEP.brake`, but glued and bolted while the hull is inverted, before the underside finish). */
export const EARLY_STEP_IDS: ReadonlySet<string> = new Set(['brake-knees']);
const EARLY_RE = /^brake-(backer|knee)-[LR]$/;
export const isEarlyBrakePart = (x: Part): boolean => EARLY_RE.test(x.id);

interface Built { goal: string; items: Instr[]; checks: string[] }

interface Template {
  id: string;
  title: string;
  kind: StepKind;
  /** Model steps whose parts this template may take (first entry is the step's modelStep). */
  steps: number[];
  /** Where the step sits in the build order when that is not its model step (the brake knees: model step 6, installed at 4.6). */
  at?: number;
  match?: RegExp;
  view: StepView;
  tools: string[];
  /** Cure used for the clampCure text, and the clamp description. */
  hardener?: Hardener;
  clamp?: string;
  build: (c: StepCtx) => Built;
}

// ---- helpers ----

/** True for the Standard weather spec (D-73: garage-kept; the default). The Extreme spec (stored outside or near salt) keeps the 316, Sipo, epoxy and marine varnish text. */
const isStandard = (p: Params): boolean => p.weatherSpec !== WEATHER_SPEC.extreme;
/**
 * The Standard spec's text for a step (D-73): 304 stainless where the step text says 316, spar urethane where it says varnish. The model's own part notes (and so the step text built from them) still
 * say 316; this is the one place that rewrites them for the Standard spec.
 */
export function standardText(t: string): string {
  return t.replace(/\b316\b/g, '304').replace(/\bvarnished\b/g, 'coated').replace(/\bVarnish\b/g, 'Urethane').replace(/\bvarnish(?:ing)?\b/g, (m) => (m === 'varnishing' ? 'coating' : 'urethane'));
}
/** Added to the glue note of every glue step under the Standard spec: which joints in the step are Titebond III. */
export const STANDARD_GLUE_NOTE =
  'Standard spec: Titebond III for the Dominos, dados, tenons and plain glue joints of this step (thin coat on both faces, clamp 30-60 min, full strength in 24 h, wipe squeeze-out with a damp rag); epoxy only for the laminations, the deck, fillets and tape, and thickened bedding.';

const f = (n: number, d = 2): string => String(+n.toFixed(d));
/**
 * A dimension for the shop: a fraction to the nearest 1/32 with the inch mark. A small value that is not on the 1/32 grid (a clearance of 0.04") keeps two decimals, so
 * a fraction never misstates a gap by a third of itself.
 */
export function fin(n: number): string {
  const a = Math.abs(n);
  if (a > 0 && a < 0.25 && Math.abs(nearest32(a) - a) > 0.004) return `${f(n, 2)}"`;
  return finalFrac(n);
}
/** A thin strip thickness: millimeters too when it is off the 1/32 grid (a strip planed to 0.208" is 5.3 mm, not 7/32"). */
const thick = (t: number): string => (Math.abs(nearest32(t) - t) > 0.004 ? `${f(t * 25.4, 1)} mm (just under ${finalFrac(Math.ceil(t * 32 - 1e-6) / 32)})` : finalFrac(t));
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** `{{a}}`, `{{a}} and {{b}}`, `{{a}}, {{b}} and {{c}}`. */
const tl = (ids: string[]): string => {
  const t = ids.map((i) => `{{${i}}}`);
  return t.length <= 1 ? t.join('') : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
};
/** "#8 × 1-1/4"" from the first screw joint of part `id` whose mate matches `to` (D-72): the steps read the model's own joint text, so they never disagree with it. */
const screwOf = (c: Pick<StepCtx, 'by'>, id: string, to: RegExp): string => {
  const j = c.by(id)?.joints?.find((q) => q.type === 'screw' && to.test(q.to) && q.fit);
  return j?.fit ? `${screwText(j.fit)}"` : 'the screws on the joint list';
};
/** "#10-32 × 1"" of the sign knob screw, read from the model's own joint. */
const knobText = (c: Pick<StepCtx, 'by'>): string => {
  const m = /#10-32 × ([\d.]+) in thumb-knob/.exec(c.by('sign-L')?.joints?.find((q) => q.type === 'knob')?.size ?? '');
  return m ? `#10-32 × ${fin(Number(m[1]))}` : '#10-32';
};
/** The axle stock word: the solid rod of D-71, or the DOM tube of D-60. */
const axleWord = (p: Params): string => (p.axleWallIn > 0 ? 'tube' : 'rod');
/** The axle stock in words: "5/8\" solid 1045 rod" (D-71) or the DOM tube of D-60. */
const axleWhat = (p: Params): string => (p.axleWallIn > 0 ? `${fin(p.axleDiameterIn)} DOM tube` : `${fin(p.axleDiameterIn)} solid 1045 rod`);

const GLUE_JOINTS: ReadonlySet<string> = new Set(['glue', 'domino', 'mortise-tenon']);

/** Unique joints between the given parts and anything: a joint listed on both mating parts counts once (the larger of the two sums). */
export function jointTally(
  parts: Part[],
  ids: Set<string>,
  type: Joint['type'],
  keyOf: (j: Joint) => string = (j) => j.size ?? '',
  maxStep = Infinity,
): Map<string, number> {
  const step = new Map(parts.map((x) => [x.id, x.step]));
  const dir = new Map<string, Map<string, number>>(); // pair+key -> from -> count
  for (const x of parts) {
    for (const j of x.joints ?? []) {
      if (j.type !== type) continue;
      if (!ids.has(x.id) && !ids.has(j.to)) continue;
      if (x.step > maxStep || (step.get(j.to) ?? 0) > maxStep) continue; // the mate is not on the sled yet
      const pair = [x.id, j.to].sort().join('~');
      const key = `${pair}|${keyOf(j)}`;
      let m = dir.get(key);
      if (!m) dir.set(key, (m = new Map()));
      m.set(x.id, (m.get(x.id) ?? 0) + j.count);
    }
  }
  const out = new Map<string, number>();
  for (const [key, m] of dir) {
    const k = key.slice(key.indexOf('|') + 1);
    out.set(k, (out.get(k) ?? 0) + Math.max(...m.values()));
  }
  return out;
}

const dominoKey = (j: Joint): string => /^\s*(\d+)\s*×\s*(\d+)/.exec(j.size ?? '')?.slice(1, 3).join('×') ?? (j.size ?? '?');

/**
 * The chine tie Dominos (side chine band to rail): their size ("4×20" with a 0.391 in bearing land, "5×30" with the 0.417 in land of the 1/4 in white oak plywood, D-73) and how many in all.
 * Read from the chine bands' own joints, so the steps follow the material.
 */
function chineTie(parts: Part[]): { key: string; total: number } {
  const t = new Map<string, number>();
  for (const x of parts.filter((q) => /^side-[LR]-chine$/.test(q.id)))
    for (const j of x.joints ?? []) if (j.type === 'domino' && /^rail-/.test(j.to)) t.set(dominoKey(j), (t.get(dominoKey(j)) ?? 0) + j.count);
  const [key, total] = [...t.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['4×20', 18];
  return { key, total };
}

/** Total of one joint type touching the step's parts, with the mating part listed on one side only counted once. */
function count(c: StepCtx, type: Joint['type']): number {
  return [...jointTally(c.parts, new Set(c.mine.map((x) => x.id)), type, () => '').values()].reduce((s, n) => s + n, 0);
}

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

/** Epoxy cure text at 70 °F and at 60 °F (winter shop), after the clamping note. */
export function cureText(h: Hardener, clamp: string): string {
  const c = HARDENERS[h];
  const k = epoxyTimeFactor(60);
  const r = (lo: number, hi: number): string => `${f(lo * k, 0)}-${f(hi * k, 0)}`;
  return (
    `${clamp} Epoxy 105/${c.label}: pot life ${c.potMin[0]}-${c.potMin[1]} min, clamp ${c.clampHours[0]}-${c.clampHours[1]} h, full cure ${c.fullHours} h+ at 70 °F. ` +
    `At 60 °F: pot life ${r(...c.potMin)} min, clamp ${r(...c.clampHours)} h; below 55 °F it will not cure. Mix small batches and pour them thin in a tray.`
  );
}

// ---- locations from the part drawings (part-drawings.ts) ----

const FR = String.raw`\d+(?:-\d+\/\d+)?|\d+\/\d+`;
/** "8-5/16" -> 8.3125, "3/4" -> 0.75, "12" -> 12. */
export function parseFrac(s: string): number {
  const m = /^(\d+)(?:-(\d+)\/(\d+))?$/.exec(s.trim());
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  const q = /^(\d+)\/(\d+)$/.exec(s.trim());
  return q ? Number(q[1]) / Number(q[2]) : NaN;
}
const DATUM_RE = /\b(REAR|FRONT|LEFT|RIGHT|TOP|BOTTOM|INBOARD|OUTBOARD)\b/g;
/** The drawings name datums in capitals (REAR end, TOP edge); running text does not. */
const lc = (s: string): string => s.replace(DATUM_RE, (m) => m.toLowerCase());

/** The features of the drawing that covers part `id` (an L/R pair shares the left-hand drawing). */
function featuresOf(c: StepCtx, id: string): DrawingFeature[] {
  try {
    return c.drawings().find((d) => d.partIds.includes(id))?.features ?? [];
  } catch {
    return [];
  }
}
function feat(c: StepCtx, id: string, kind: DrawingFeature['kind'] | DrawingFeature['kind'][], test: RegExp | ((q: DrawingFeature) => boolean) = () => true): DrawingFeature | undefined {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const ok = typeof test === 'function' ? test : (q: DrawingFeature) => test.test(q.text);
  return featuresOf(c, id).find((q) => kinds.includes(q.kind) && ok(q));
}
/** The location clause of a feature, from the drawing's structured fields: "in the top face: 1-3/8" and 26-1/8" from the left end, 1/2" from the rear face" (datums in lower case). */
function whereOf(q: DrawingFeature | undefined): string | undefined {
  if (!q || !q.positions?.length) return undefined;
  return `${q.face ? `in the ${q.face}: ` : ''}${q.positions.join('; ')}`;
}
/** [from, to] pairs measured from one datum ("REAR end"), in the order they appear in the feature's positions. */
function spans(q: DrawingFeature | undefined, datum: string): Array<[number, number]> {
  if (!q?.positions) return [];
  const re = new RegExp(`(${FR})" to (${FR})" from the ${datum.toLowerCase()}`, 'g');
  return q.positions.flatMap((t) => [...t.matchAll(re)].map((m): [number, number] => [parseFrac(m[1]), parseFrac(m[2])]));
}
/** Single stations measured from one datum: `3", 10-1/8" and 36-3/16" from the rear end` gives 3, 10.125, 36.1875 (spans are not stations). */
function stations(q: DrawingFeature | undefined, datum: string): number[] {
  if (!q?.positions) return [];
  const re = new RegExp(`(?<!to )((?:(?:${FR})"(?:, | and )?)+) from the ${datum.toLowerCase()}`, 'g');
  const out: number[] = [];
  for (const t of q.positions) for (const m of t.matchAll(re)) for (const v of m[1].matchAll(new RegExp(`(${FR})"`, 'g'))) out.push(parseFrac(v[1]));
  return [...new Set(out.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
}
/** The "wide × deep" of a notch, dado or groove from its size. */
const wideDeep = (q: DrawingFeature | undefined): [string, string] | undefined => {
  const m = q?.size ? new RegExp(`(${FR})" wide × (${FR})" deep`).exec(q.size) : null;
  return m ? [`${m[1]}"`, `${m[2]}"`] : undefined;
};
const list = (vals: number[]): string => {
  const t = vals.map((v) => fin(v));
  return t.length <= 1 ? t.join('') : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
};
const SEE = 'positions on the part drawing';
const SEE_ITEM = 'Positions are on the part drawing.';

/** "2-3/8" wide × 1-3/32" deep in the bottom edge, 8-5/16" to 10-11/16" from the rear end" for a notch feature. */
function notchText(q: DrawingFeature | undefined, datum = 'REAR (?:end|edge)'): string | undefined {
  const wd = wideDeep(q);
  const m = q?.positions ? new RegExp(`(${FR})" to (${FR})" from the (${datum.toLowerCase()})`).exec(q.positions.join('; ')) : null;
  if (!wd || !m) return undefined;
  return `${wd[0]} wide × ${wd[1]} deep${q!.face ? ` in the ${q!.face}` : ''}, starting ${m[1]}" from the ${m[3]} (to ${m[2]}")`;
}

/** Centers of a run of Domino mortises along one datum, in words: "9, centers 3-1/4" to 55-23/32" from the rear end, about 6-1/2" apart". */
/** Centers along one datum: the midpoints of "a to b" spans, or the stations of a "centered at" list. */
function centersOf(q: DrawingFeature | undefined, datum: string): number[] {
  const sp = spans(q, datum);
  return sp.length ? sp.map(([a, b]) => (a + b) / 2) : stations(q, datum);
}
/** The height of a feature from the top edge, as the drawing gives it ("7/8" from the top edge" or "1/2" to 1-1/4" from the top edge"). */
function fromTop(q: DrawingFeature | undefined): string | undefined {
  const m = q?.positions ? [...q.positions.join('; ').matchAll(new RegExp(`(?:(?:${FR})" to )?(?:${FR})" from the top edge`, 'g'))].pop() : undefined;
  return m ? m[0] : undefined;
}

function dominoRun(q: DrawingFeature | undefined, datum = 'REAR end'): string | undefined {
  const c = centersOf(q, datum);
  if (!c.length) return undefined;
  if (c.length === 1) return `centered ${fin(c[0])} from the ${lc(datum)}`;
  const gap = (c[c.length - 1] - c[0]) / (c.length - 1);
  return `centers ${fin(c[0])} to ${fin(c[c.length - 1])} from the ${lc(datum)}, about ${fin(gap)} apart`;
}

/** A hole feature's diameter ("Ø25/64"") and its location clause. */
function holeText(q: DrawingFeature | undefined): string | undefined {
  if (!q) return undefined;
  const dia = new RegExp(`^(${FR})"`).exec(q.size ?? '')?.[1];
  const w = whereOf(q);
  return w ? `${dia ? `Ø${dia}", ` : ''}${w}` : undefined;
}

/** "3/8" × 3/4" × 1/2" deep" from a loose-tenon mortise feature ("3/8" wide × 3/4" long × 1/2" deep, for a loose tenon"). */
function mortiseSize(q: DrawingFeature | undefined): string | undefined {
  const m = q?.size ? new RegExp(`^(${FR})"(?: wide)? × (${FR})"(?: long)? × (${FR})" deep`, 'i').exec(q.size) : null;
  return m ? `${m[1]}" × ${m[2]}" × ${m[3]}" deep` : undefined;
}

// ---- text helpers for the plan-driven steps ----

/** The cut-list strip row (rail, band) a strip part belongs to. */
const stripRowOf = (c: StepCtx, x: Part | undefined) => (x ? c.cut().strips.find((r) => r.ids.includes(x.id)) : undefined);

/** The resaw pool a strip part is sawn from, found through the cut list's own strip row (never from the model's raw `rough`). */
function poolOf(c: StepCtx, x: Part | undefined): ResawPool | undefined {
  const row = stripRowOf(c, x);
  return row ? c.resaw().find((q) => Math.abs(q.roughT - row.rough.t) < 0.002) : undefined;
}

/**
 * The resaw sub-items for one strip pool, every number from the cut list's resaw plan (`planResaw`), which models the method written here: rip the strip lanes off the board
 * FIRST, then resaw each lane on edge, so the resaw height is only the strip width (Eric's bandsaw cuts 6"; the board may be 9" or 10" wide).
 */
function resawSubs(c: StepCtx, x: Part, strips: number): Instr[] {
  const pool = poolOf(c, x);
  if (!pool) return [I('Resaw from thick stock: the cut list has the board.')];
  const k = Math.max(1, pool.stripsPerBoard);
  const widest = Math.max(...pool.laneStrips.flat().map((q) => q.widthIn));
  // The spares are whole extra lanes of the widest strip (plus any empty slot in a full-width lane): say how many lanes to rip for them (build review r3 MUST-1).
  const emptySlots = pool.laneStrips.reduce((a, l) => a + (Math.max(...l.map((q) => q.widthIn)) >= widest - 1e-9 ? k - l.length : 0), 0);
  const spareLanes = Math.ceil(Math.max(0, pool.spares - emptySlots) / k);
  const by = new Map<string, number>();
  for (const lane of pool.laneStrips) { const w = roughFrac(Math.max(...lane.map((q) => q.widthIn))); by.set(w, (by.get(w) ?? 0) + 1); }
  if (spareLanes) by.set(roughFrac(widest), (by.get(roughFrac(widest)) ?? 0) + spareLanes);
  const lanes = [...by.entries()].map(([w, n]) => `${n} at ${w}`).join(' and ');
  return [
    I(`${cap(pool.ripText)}: ${plural(pool.lanes + spareLanes, 'lane')}, ${lanes}${spareLanes ? ` (${spareLanes === 1 ? 'one is the spare' : `${spareLanes} are spares`})` : ''}.`),
    I(`Then resaw each lane on edge into ${plural(k, 'slab')}: ${pool.resawHeightText}. Never stand the whole board on edge.${pool.withinCapacity ? '' : ' TOO TALL for your bandsaw: the strip is wider than the saw can cut.'}`),
    I(`That gives ${pool.stripSlots} strips for the ${strips} needed: ${pool.spares <= 0 ? 'no spare, so a strip that cracks on the form means another board' : `${plural(pool.spares, 'spare')} for the bend test`}.`),
  ];
}

/** The board a part is milled from ("8/4"): the BOARD COLUMN of the cut list, never the model's raw rough thickness (a transposed `rough` once named a 16/4 board nobody sells). */
const boardOf = (c: StepCtx, id: string): string => {
  const row = c.cut().oak.flatMap((g) => g.rows).find((r) => r.ids.includes(id));
  return row?.lamination ? `laminated block, ${row.lamination.text}` : row?.board ?? '?';
};

/** Steepest angle (degrees) the bent rails make with the centerline in the bow taper: where the joist and king-beam ends meet them. */
export function maxTaperAngleDeg(p: Params): number {
  const L = computeLayout(p);
  if (L.taper.x1 - L.taper.x0 < 1e-6) return 0;
  const xs = samples(L.taper.x0, L.taper.x1, 120);
  let m = 0;
  for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.atan(Math.abs(L.turnIn(xs[i]) - L.turnIn(xs[i - 1])) / (xs[i] - xs[i - 1])));
  return (m * 180) / Math.PI;
}

/** Station cradles for the inverted sides (model x, outside width and side height at that station). */
export function cradleStations(p: Params): { x: number; widthIn: number; heightIn: number }[] {
  const L = computeLayout(p);
  return [0.08, 0.38, 0.68, 0.94].map((u) => {
    const x = L.xSideStart + u * (L.xSideEnd - L.xSideStart);
    return { x, widthIn: 2 * outerHalfWidth(L, x), heightIn: sideTopAt(L, x) - L.chineBot };
  });
}

/**
 * Where the seat stop-block screws go through the deck, from the wedges' own screw joints (`at` is in the part's local frame; the part transform puts it in the model frame):
 * distances forward of the transom's outer face and off the centerline. Null when the model has no stop-block screws.
 */
export function stopBlockPilots(parts: Part[], p: Params): { perBlock: number; total: number; screw: string; xs: number[]; offCenter: number[] } | null {
  const L = computeLayout(p);
  const xs = new Set<number>();
  const ys = new Set<number>();
  let perBlock = 0;
  let total = 0;
  let screw = '';
  for (const w of parts.filter((x) => /^seat-wedge-[LR]$/.test(x.id))) {
    const j = w.joints?.find((q) => q.type === 'screw' && q.at?.length);
    if (!j?.at) continue;
    perBlock = j.at.length;
    total += j.at.length;
    screw = /#\d+ × [\d/-]+/.exec(j.size ?? '')?.[0] ?? screw;
    for (const a of j.at) {
      const q = transformPoint(w.transform, a);
      xs.add(+(q[0] - L.xRear).toFixed(2));
      ys.add(+Math.abs(q[1]).toFixed(2));
    }
  }
  return total ? { perBlock, total, screw, xs: [...xs].sort((a, b) => a - b), offCenter: [...ys].sort((a, b) => a - b) } : null;
}

/** The handle-socket screws from the joint size text: "2 × 1/4-20 × 1-1/4 316 button-head cap screws" (count, thread, length and kind all from the model). */
export function socketScrewText(parts: Part[]): string {
  const j = parts.find((x) => x.id === 'handle-socket-L')?.joints?.find((q) => q.type === 'bolt');
  const m = /^(\S+\s×\s\S+)\s+(\d+ [^,(]*?screws?)/.exec(j?.size ?? '');
  return j && m ? `${j.count} × ${m[1]} ${m[2]}` : 'the socket screws from the parts list';
}

/** The rail-end joint to a mating part, in words: "8×50 Domino" or "1/4 × 7/8 × 3/8 deep loose tenon". */
function endJoint(c: StepCtx, from: string, to: string): string {
  const j = c.by(from)?.joints?.find((q) => q.to === to && (q.type === 'domino' || q.type === 'mortise-tenon'));
  if (!j) return 'the joint on the part drawing';
  return j.type === 'domino' ? `${dominoKey(j)} Domino` : (j.size ?? 'loose tenon').split(' (')[0].replace(/(\d+\.\d+)/g, (m) => fin(Number(m)).replace(/"$/, ''));
}

/** Station of a part (its center) forward of a reference x, to 1/32. */
const stationOf = (x: Part | undefined, x0: number): number | undefined => {
  if (!x) return undefined;
  const b = worldAABB(x);
  return (b.min[0] + b.max[0]) / 2 - x0;
};

/** The ordered how-to-build steps a form drawing carries (forms.ts `build`: `{ step, sub }`), as instructions; empty when the drawing has none. */
function formBuild(d: FormDrawing | undefined): Instr[] {
  const b = (d as unknown as { build?: unknown } | undefined)?.build;
  if (!Array.isArray(b)) return [];
  const out: Instr[] = [];
  for (const q of b as unknown[]) {
    if (typeof q === 'string') { out.push(I(tidy(q))); continue; }
    const o = q as { step?: unknown; text?: unknown; sub?: unknown };
    const text = typeof o.step === 'string' ? o.step : typeof o.text === 'string' ? o.text : '';
    if (!text) continue;
    const sub = Array.isArray(o.sub) ? (o.sub as unknown[]).filter((x): x is string => typeof x === 'string').map(tidy) : [];
    out.push(I(tidy(text), sub));
  }
  return out;
}

/** Safety net for text that comes from elsewhere (form notes, joint text): a decimal inch value with more than two places becomes a shop fraction. */
export function tidy(t: string): string {
  return t.replace(/(\d+\.\d{3,})(?=")"/g, (_m, v: string) => fin(Number(v))).replace(/\b(\d+\.\d{3,})\b/g, (m) => f(Number(m), 2));
}

// ---- step templates (in build order) ----

const TEMPLATES: Template[] = [
  // ---------------- preparation (no parts in the model) ----------------
  {
    id: 'verify',
    title: 'Verify before ordering',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['calipers', 'ruler', 'scale', 'luggage scale'],
    build: (c) => {
      const all = verifyChecklist(c.parts, c.p);
      const before = all.filter((v) => v.when === 'before ordering');
      const cutting = all.filter((v) => v.when === 'before cutting');
      return {
        goal: 'Prove the wheels, steel and plywood against the design before anything is committed.',
        items: [
          I(`Before the shopping list goes out: the ${plural(before.length, 'check')} below (Verify section).`, before.map((v) => v.title)),
          I(`Before the first cut: ${plural(cutting.length, 'more check')}.`, cutting.map((v) => v.title)),
          I('Try ONE wheel first.', ['Get the other three only when its squash, bore, hub length and rating pass.', 'The axle steel should come with a mill cert.']),
          I('Enter every measured value in the design and re-run the checks before going on.'),
        ],
        checks: [...before, ...cutting].map((v) => `${v.title}: passed`),
      };
    },
  },
  {
    id: 'mill',
    title: 'Mill the oak and resaw the strips',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['jointer', 'planer', 'table saw', 'bandsaw', 'planer sled or drum sander', 'moisture meter', 'cauls and clamps (panel glue-ups)'],
    build: (c) => {
      const bands = c.parts.filter((x) => x.kind === 'bentlam' && !x.plies);
      const rails = c.parts.filter((x) => x.plies && x.plies > 1);
      const band = bands[0];
      const rail = rails[0];
      const nRailStrips = rails.reduce((s, x) => s + (x.plies ?? 0), 0);
      const allow = c.p.millingAllowanceIn;
      const glueUps = c.cut().glueUps;
      const face = glueUps.filter((g) => g.kind !== 'edge');
      const edge = glueUps.filter((g) => g.kind !== 'face');
      const lamText = (id: string): string => c.oak().laminated.find((q) => q.id === id)?.lamination.text ?? `${face.find((g) => g.ids.includes(id))?.layers ?? 3} layers`;
      const std = isStandard(c.p);
      const b = (id: string): string => boardOf(c, id);
      return {
        goal: 'Turn the boards into rough parts, glued blocks and bending strips, ready for the joinery.',
        items: [
          I('Mill every solid oak part to its rough size in the cut list.', [
            `Rough is the final size + ${fin(allow)} in thickness and width, + ${fin(4 * allow)} in length.`,
            'Sticker what is not used today and keep it at 6-9 % moisture.',
          ]),
          ...(face.length
            ? [I('Face-laminate the thick parts before anything is notched, bored or slotted (see D-70).', [
              ...face.map((g) => I(`${tl(g.ids)}: ${lamText(g.ids[0])}${g.kind === 'both' ? ', each layer edge-glued from boards' : ''}.`)),
              'Plane each layer to its rough thickness (cut list, layer table).',
              ...(face.some((g) => g.kind === 'both') ? ['Edge-glue any wide layer first.'] : []),
              'Epoxy the layers face to face: 206 slow, thickened a little with silica.',
              'Clamp flat between cauls, ends and edges flush; cure overnight.',
              'Mill the cured block to its final size. From then on it is solid oak.',
            ])]
            : []),
          edge.length
            ? I('Edge-glue the wide panels: they must cure before the planer and the Shaper.', [
              ...edge.map((g) => I(`${tl(g.ids)}: ${plural(g.edgeBoards, 'board')} across.`)),
              `Rip each board ${fin(allow)} over its share and joint the mating edges.`,
              `Glue with cauls (${std ? 'Titebond III' : '206 epoxy'}), then plane to thickness and trim to the cut-list size.`,
            ])
            : I('No part is wider than a board: no panel glue-ups.'),
          band
            ? I(`Resaw the band strips: ${bands.length} for the chine and gunwale bands (cut list, strips table).`, [
              ...resawSubs(c, band, bands.length),
              `Plane or drum-sand each strip to ${thick(band.stock!.t)}.`,
            ], bands.map((x) => x.id))
            : I('Band strips: none in this model.'),
          rail
            ? I(`Resaw the rail strips: ${nRailStrips} for ${tl(rails.map((x) => x.id))}.`, [
              ...resawSubs(c, rail, nRailStrips),
              `Plane to ${thick(rail.stock!.t)}: thin and ${fin(rail.stock!.w)} wide, so use a planer sled or drum sander.`,
            ])
            : I('Rail strips: none in this model.'),
          I('Saw the bandsaw blanks from thick stock.', [
            I(`{{brake-knee-L}} and {{brake-knee-R}}: ${b('brake-knee-L')}.`),
            I(`{{brake-shoe-L}} and {{brake-shoe-R}}: ${b('brake-shoe-L')}.`),
            I(`{{brake-chock-L}} and {{brake-chock-R}}: ${b('brake-chock-L')}.`),
            I(`{{handle-bar}}: ${b('handle-bar')}. {{bridle-tongue}}: ${b('bridle-tongue')}.`),
          ]),
          I('Mill the strips and blanks the day they are glued or bent: thin strips cup overnight.'),
        ],
        checks: [
          'Moisture 6-9 % on every board',
          'Strips even in thickness: no ridge you can feel',
          'Strips straight-grained, no knots in the bend',
          'Panel glue-ups flat, no step at the glue lines',
          ...(face.length ? ['Laminated blocks cured, flat and square, no gap at any glue line, before they are milled'] : []),
        ],
      };
    },
  },
  {
    id: 'shaper',
    title: 'Cut the Shaper parts and make the forms',
    kind: 'prep',
    steps: [0],
    view: 'top',
    tools: ['Shaper Origin', 'ShaperTape', 'bandsaw', 'drill press', '3/4" MDF'],
    build: (c) => {
      const shaper = c.parts.filter((x) => x.fab === 'shaper-origin');
      const web = c.parts.find((x) => /^side-L-web$/.test(x.id));
      const webFlat = web ? flatPattern(web) : null;
      const rail = c.parts.find((x) => x.id === 'rail-L');
      const bandPool = poolOf(c, c.by('side-L-chine'));
      const railPool = poolOf(c, rail);
      const t = bowTaper(c.p);
      const thin = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t < 0.3);
      const thickSheet = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t >= 0.3);
      const oak = shaper.filter((x) => x.kind !== 'sheet');
      // Form sizes come from the drawings (forms.ts), never from numbers typed here.
      const railForm = c.forms().find((d) => d.id === 'rail-form');
      const sideForm = c.forms().find((d) => d.id === 'side-form');
      const dim = (d: FormDrawing | undefined, key: string): number | undefined => d?.dims.find((q) => q.key === key)?.valueIn;
      const rise = dim(sideForm, 'ramp-rise');
      const rampLen = dim(sideForm, 'ramp-length');
      const ribs = dim(sideForm, 'ramp-ribs');
      const formLen = dim(railForm, 'form-length');
      const railDepth = rail?.stock?.w ?? 0;
      const stackDim = dim(railForm, 'stack-height');
      const layers = Math.ceil((stackDim ?? railDepth) / RIB_STOCK_IN - 1e-6);
      const stack = stackDim ?? layers * RIB_STOCK_IN;
      const railSteps = formBuild(railForm);
      // The form's own build steps set the stack (it stands a little taller than the rail); quote them when they say so.
      const stackSaid = railSteps.map((q) => /(\d+) layers in all, a stack ([\d\-/]+)" tall/.exec(q.text)).find(Boolean);
      const layersText = stackSaid ? `${stackSaid[1]} layers of ${fin(RIB_STOCK_IN)} MDF (${stackSaid[2]}", taller than the ${fin(railDepth)} rail)` : `${layers} layers of ${fin(RIB_STOCK_IN)} MDF (${fin(stack)}, never less than the ${fin(railDepth)} rail depth)`;
      const sideSteps = formBuild(sideForm);
      return {
        goal: 'Cut the Shaper parts from their files and build the rail form and the S-ramp.',
        items: [
          I(`Cut the ${shaper.length} Shaper parts from their files.`, [
            I(`${thinSheet(c.p).name}: ${tl(thin.map((x) => x.id))}.`),
            I(`12 mm okoume: ${tl(thickSheet.map((x) => x.id))}.`),
            I(`Oak: ${tl(oak.map((x) => x.id))}.`),
            'Measure the real plywood first (Verify) and enter it in the design before any dado is cut.',
          ]),
          web
            ? I('Cut each side web as ONE piece from a full 4\' × 8\' sheet (see D-68).', [
              `The file cuts the flat development, ${fin(webFlat?.widthIn ?? web.stock!.l)} long; the blank is ${fin(web.stock!.l)} (it carries the trim allowance).`,
              'Nest the blank per the nesting drawing, then cut net from the file.',
              'The seat back comes from the deck offcut.',
            ], ['side-L-web', 'side-R-web'])
            : I('Side webs: one piece each from a full 4\' × 8\' sheet.'),
          formLen !== undefined
            ? I(`Build the rail form (rail form drawing): ${fin(formLen)} long, ${layersText}. One form serves both rails.`, railSteps.length ? railSteps : [
              `Its face is the rails' outer plan curve: ${fin(t.turnIn)} turn-in each side, tightest radius ${t.minRadiusIn > 1e6 ? 'none' : `${f(t.minRadiusIn, 0)}"`} (see D-66).`,
              'Every clamp bears on the full strip width.',
            ])
            : I('Rail form: no bow turn-in at this design, so the rails are straight and need no form.', ['Glue them flat on the bench with cauls.']),
          rise !== undefined && rampLen !== undefined
            ? I(`Build the S-ramp for the sides (side form drawing): rise ${fin(rise)}, ${fin(rampLen)} long from the start of the S to the bow end, ${f(ribs ?? 0, 0)} MDF ribs under a 1/4" hardboard cap.`, sideSteps.length ? sideSteps : [
              `Ribs of ${fin(RIB_STOCK_IN)} MDF, about 4-1/2" apart.`,
              'Build a mirror S-ramp for the other web face (or flip this one).',
            ])
            : I('S-ramp: none, the sides are not turned in at this design.', ['The webs glue up flat.']),
          I('Print the templates: handlebow arc, bulkhead crown, brake flap and knee (Forms section).', ['Check the 1" square on each printout before cutting.']),
          I('Cut the dados, hand-holds and Domino / tenon mortises as each step calls for them.', [
            'Web-end dados run out through the top edge; the deck dado runs into them at each corner as one pocket.',
          ]),
          I('Bend-test a dry strip on the real rail form.', [
            `Use a planned spare: ${railPool ? plural(railPool.spares, 'spare rail strip') : 'a spare rail strip'} and ${bandPool ? plural(bandPool.spares, 'spare band strip') : 'a spare band strip'} came out of the resaw.`,
            'A strip that passes goes into the laminate.',
            'If it cracks: plane thinner or add a minute of damp heat. The test decides 2 or 3 plies.',
          ]),
        ],
        checks: ['Verify items marked "before cutting" are done', 'Web cut net from the file; the blank nests on the sheet', 'A dry strip takes the S without cracking'],
      };
    },
  },
  {
    id: 'seal',
    title: 'Seal the dados, edges and hidden faces',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['foam roller', 'brush', 'epoxy pumps', 'scotch-brite'],
    hardener: '206',
    clamp: 'Let the coat go off before handling.',
    build: (c) => {
      const std = isStandard(c.p);
      return {
        goal: std ? 'Epoxy the few surfaces water can reach and nobody can reach later; the show faces stay bare.' : 'Epoxy-seal the hidden faces and edges before assembly; the show faces stay bare.',
        items: [
          std
            ? I('Weather spec: Standard (garage-kept, wet at most at a rainy derby).', [
              'Glue: Titebond III for the Dominos, dados, tenons and plain glue joints.',
              'Epoxy only for the bent and face laminations, the deck to the frame and its dados, the fillets and tape, and thickened bedding.',
              'Topcoat: exterior spar urethane. The Extreme setting (stored outside) uses epoxy everywhere and a marine topcoat.',
            ])
            : I('Weather spec: Extreme (stored outside or near salt): epoxy for every glue joint and marine varnish.'),
          I('Run the finishing offcut tests first (Finishing, step 1).', [std ? 'They decide how the plywood takes the stain; no show face is coated until a panel passes.' : 'They decide how the okoume takes stain under epoxy; no show face is sealed until a panel passes.']),
          std
            ? I('Epoxy ONE coat (105/206) on:', [
              'the deck underside and deck edges (water pools there);',
              'the oak end grain;',
              `any ${thinSheet(c.p).name} or deck edge not captured in a dado or banded with oak.`,
              'Leave the other plywood faces bare: they are stained and urethaned at the finish.',
            ])
            : I('Epoxy-seal (105/206, one coat) ONLY the dados, the deck underside and edges, every ply edge, and faces nobody will see.', [
              'The show faces stay bare: both web faces, the deck top, the box, the lid, the seat back.',
              'They are stained, THEN sealed, after assembly (Finishing, steps 3-4). Water-based dye under epoxy is the safe route.',
            ]),
          I(`Check the deck still enters its dado: the dado is the deck + ${fin(c.p.deckSlopIn)}.`, ['Use a feeler gauge.']),
          I('Wash the amine blush off any sealed face that will be glued again.', ['Warm water and Scotch-Brite, dry, then 120 grit; the dado walls too.', 'Glue faces stay bare or scuffed; keep the oak bands and rails bare.']),
          I('In every later glue-up, wipe squeeze-out off the bare show faces before it kicks: dried epoxy blocks the stain.'),
        ],
        checks: ['Sealed deck enters its dado (feeler gauge)', 'No bare ply edge left on any sheet part', 'Offcut panel approved before any show face is coated'],
      };
    },
  },

  // ---------------- 3: frame ----------------
  {
    id: 'rails',
    title: 'Bend-laminate the rails',
    kind: 'build',
    steps: [STEP.frame],
    match: /^rail-[LR]$/,
    view: 'top',
    tools: ['rail form', 'clamps', 'epoxy pumps', 'planer', 'bandsaw', 'chisel', 'Domino'],
    hardener: '206',
    clamp: 'Strips face to face on the rail form, clamped at every station, left in the form.',
    build: (c) => {
      const rail = c.mine[0];
      const ids = c.mine.map((x) => x.id);
      const tie = chineTie(c.parts);
      const clamps = c.forms().find((d) => d.id === 'rail-form')?.dims.find((q) => q.key === 'clamps')?.valueIn;
      const notch = feat(c, 'rail-L', ['outline', 'notch'], /^Notch/);
      const step = feat(c, 'rail-L', 'outline', (q) => /^Step/.test(q.text) && q.angleDeg !== undefined);
      const top = feat(c, 'rail-L', 'mortise', (q) => q.face === 'top edge' && /chine/.test((q.to ?? []).join(' ')));
      const side = featuresOf(c, 'rail-L').filter((q) => q.kind === 'mortise' && q.face === 'inboard face');
      const sideCenters = [...new Set(side.flatMap((q) => centersOf(q, 'REAR end')))].sort((a, b) => a - b);
      const sideDepth = fromTop(side[0]);
      // The bow step: the bottom edge points (station from the rear end, depth from the top edge) and the ramp angle.
      const pts = step ? (step.positions ?? []).flatMap((t) => [...t.matchAll(new RegExp(`(${FR})" from the rear end, (${FR})" from the top edge`, 'g'))].map((m) => [parseFrac(m[1]), parseFrac(m[2])]) ) : [];
      const ang = step?.angleDeg !== undefined ? String(step.angleDeg) : undefined;
      const stepText = pts.length >= 2 && ang
        ? `${fin(pts[0][1])} deep up to ${fin(pts[0][0])} from the rear end, then a ${ang}° ramp up to ${fin(pts[1][1])} deep at ${fin(pts[1][0])}, level from there to the bow end`
        : undefined;
      return {
        goal: 'Laminate the two rails on the rail form, then cut their notches, bow step and mortises.',
        items: [
          I(`Glue ${plural(rail?.plies ?? 2, 'strip')} per rail on the rail form: ${tl(ids)}.`, [
            'Epoxy lightly thickened (406); wax paper on the form.',
            `Clamp at every station: about ${clamps !== undefined ? f(clamps, 0) : '15'} clamps per rail (rail form drawing). Only the bow end is curved.`,
            'One rail per cure, unless you build two forms.',
          ]),
          I('After the cure: plane the edges flush and mark the finished ends.', [
            'Leave each rail 1/2" long at both ends: it is trimmed at the dry fit.',
            'Measure every position below from the FINISHED rear end, 1/2" in from the sawn end.',
          ]),
          I('Cut the beam notch in the bottom edge of each rail.', [notchText(notch) ? `${notchText(notch)}.` : `Notch for the rear beam: ${SEE}.`, 'Bandsaw and chisel; the two notches must line up across the frame.'], ids),
          I('Cut the bow step in the bottom edge.', [stepText ? `The rail is ${stepText}.` : `Step at the bow end: ${SEE}.`, 'Bandsaw and plane to the line.'], ids),
          I(`Mortise the rail tops for the chine-tie Dominos: ${tie.total / 2 >= 1 ? `${f(tie.total / 2, 0)} per rail` : 'per the drawing'}, ${tie.key}.`, [
            dominoRun(top) ? `In the top edge, ${dominoRun(top)}.` : `In the top edge, ${SEE}.`,
            'The side chine bands get the matching mortises before the dry fit.',
          ], ids),
          sideCenters.length
            ? I('Mortise the inboard faces for the crossmembers and the king beam (5×30 Dominos).', [
              `Centered at ${list(sideCenters)} from the rear end${sideDepth ? `, ${sideDepth}` : ''}.`,
            ], ids)
            : I('Mortise the inboard faces for the crossmembers as the drawing shows.', [], ids),
          I('Do NOT cut the end mortises yet: they are cut after the trim, at the dry fit.'),
        ],
        checks: ['Rails match the rail form within 1/16"', 'No gaps in the glue lines; rails flat, not twisted', 'Notches line up across the two rails (straightedge)'],
      };
    },
  },
  {
    id: 'hangers',
    title: 'Rear axle hangers on the rails',
    kind: 'build',
    steps: [STEP.frame],
    match: /^axle-hanger-[LR]$/,
    view: 'top',
    tools: ['bandsaw', 'chisel', 'drill', 'wrenches', 'epoxy pumps', 'clamps', 'Domino'],
    hardener: '206',
    clamp: 'Clamp each hanger to the rail inboard face while the epoxy goes off; the bolts go in after the clamps come off.',
    build: (c) => {
      const ids = c.mine.map((x) => x.id);
      const notch = feat(c, 'axle-hanger-L', 'notch', /^1 notch/i) ?? feat(c, 'axle-hanger-L', 'outline', /^Notch/);
      const dom = feat(c, 'axle-hanger-L', 'mortise', /domino/i);
      const bolts = feat(c, 'axle-hanger-L', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t))); // the angle's upright bolts are the hanger's bolts (one record)
      const radius = /corners relieved with a ([\d\-\/]+") radius/.exec(c.by('axle-hanger-L')?.joints?.find((q) => q.type === 'dado')?.note ?? '')?.[1];
      const domWhere = whereOf(dom);
      return {
        goal: 'Notch the rear axle hangers and glue and bolt them to the rails, before the frame glue-up.',
        items: [
          I(`Cut the beam notch in the bottom edge of each hanger: ${tl(ids)}.`, [notchText(notch) ? `${notchText(notch)}.` : `Notch for the rear beam: ${SEE}.`, `Bandsaw and chisel${radius ? `, ${radius} radius in the corners` : ''}.`]),
          I('Cut the Domino mortise for {{joist-1}} in each hanger now (5×30).', [domWhere ? `${cap(domWhere)}.` : SEE_ITEM, 'The crossmember ends engage them in the frame glue-up.']),
          I('Glue each hanger to its rail\'s inboard face, rails flat on the bench.', ['Epoxy, side grain to side grain, the hanger notch in line with the rail notch.'], [...ids, 'rail-L', 'rail-R']),
          I('Bolt hanger and rail together once the clamps come off: 2 × 1/4" bolts per hanger.', [
            bolts ? `Holes ${holeText(bolts)}.` : SEE_ITEM,
            'Nylock nuts and fender washers on the outside face.',
          ]),
        ],
        checks: ['Hangers mirror each other: same distance from the rail rear end', 'Notches in line (string or straightedge across)'],
      };
    },
  },
  {
    id: 'frame',
    title: 'Frame and deck as one unit',
    kind: 'build',
    steps: [STEP.frame, HULL_STEP.deck],
    view: 'top',
    tools: ['Domino', 'drill press', 'clamps', 'sandbags or vacuum bag', 'epoxy pumps', 'square'],
    hardener: '206',
    clamp: 'Right side up on a flat bench: deck on top of the frame, weighted with sandbags or a vacuum bag.',
    build: (c) => {
      const brakeBackers = c.mine.filter((x) => /^brake-backer-[LR]$/.test(x.id));
      const angle = maxTaperAngleDeg(c.p);
      const kingBore = feat(c, 'king-beam', 'hole', (q) => (q.to ?? []).includes('kingpin'));
      const kneeHoles = feat(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /^brake-knee/.test(t)));
      const joistDom = feat(c, 'joist-2', 'mortise', /domino/i);
      const joistCut = c.by('joist-1');
      const hinge = c.mine.filter((x) => /^seat-hinge-backer-/.test(x.id)).map((x) => x.id);
      const crossIds = c.mine.filter((x) => /^(joist-|king-beam)/.test(x.id)).map((x) => x.id);
      return {
        goal: 'Glue the crossmembers between the rails and bond the deck on top, as one flat unit.',
        items: [
          ...(hinge.length ? [I(`The day before: epoxy the seat-hinge backers to the deck underside: ${tl(hinge)}.`, ['Butt each against the face of {{joist-3}} so the latch pin lands in solid oak.'])] : []),
          ...(brakeBackers.length
            ? [I(`The day before: glue the brake backers to the rail inboard face and the deck underside: ${tl(brakeBackers.map((x) => x.id))}.`, [
              'Keep them clear of the axle hanger; the crossmember that meets a backer is cut back 3/4" and butts its face.',
              `Drill the 4 knee-bolt holes through rail and backer together, the knee as a template: ${kneeHoles ? holeText(kneeHoles) : SEE}.`,
            ])]
            : []),
          I('Bore the {{king-beam}} for the kingpin, and cut the nut slot, before the deck goes on.', [
            kingBore ? `${fin(c.p.kingpinDiaIn)} hole, square on the drill press: ${whereOf(kingBore)}.` : `${fin(c.p.kingpinDiaIn)} hole, square on the drill press: ${SEE}.`,
            'Nut slot from the front face, about 1" × 3/4" at the top.',
          ]),
          I('Dry-fit the rails (still 1/2" long at both ends), the crossmembers and the king beam on Dominos.', [
            joistDom ? `Crossmember Dominos (5×30): in each end, ${whereOf(joistDom)}.` : 'Crossmember Dominos (5×30) in each end.',
            joistCut ? 'The {{joist-1}} ends go into the hanger mortises, not the rails.' : false,
            `In the bow taper the ends meet the bent rails at up to ${f(angle, 0)}°: the cut-list lengths are the long point, so scribe each end to its rail now (pencil from the rail, then bandsaw or miter).`,
          ], crossIds),
          I('Glue-up: Domino the crossmembers to the rails, then bond the sealed {{deck}} on top.', [
            'Thickened epoxy (406) on every top face: rails, crossmembers and king beam.',
            'Weight the deck down; it bonds full length to the rail and crossmember tops.',
            'The rails stay long; the deck edge follows the web plan.',
          ]),
        ],
        checks: ['Frame square: diagonals equal within 1/16"', 'Deck flat under a straightedge (no twist or rocking)', 'Squeeze-out cleaned off the deck edge before it reaches the slot under the bands'],
      };
    },
  },

  // ---------------- 4.2: sides ----------------
  {
    id: 'sides-inner',
    title: 'Side sandwiches, cure 1: web, inner bands and sign backers',
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(web|chine-in|gunwale-in)|sign-backer-[LR]\d)$/,
    view: 'side',
    tools: ['S-ramp', 'cleats and screws', 'C-clamps / spring clamps', 'epoxy pumps', 'drill'],
    hardener: '206',
    clamp: 'One face per cure: web flat on the S-ramp under the bow end, sheer line cleated every 4-5", clamps across the bands every 4-5" (about 14 per band pair).',
    build: (c) => {
      const backers = c.mine.filter((x) => /^sign-backer/.test(x.id));
      const webL = c.by('side-L-web');
      const web0 = webL ? worldAABB(webL).min[0] : 0;
      const bL = backers.filter((x) => /-L\d$/.test(x.id)).map((x) => worldAABB(x)).sort((a, b) => a.min[0] - b.min[0]);
      const ins = feat(c, 'sign-backer-L1', 'hole', /insert/);
      return {
        goal: 'Glue the inner bands and the sign backers to each web while the web is bent over the S-ramp.',
        items: [
          I('Per side, glue the inner chine band and the inner gunwale band full-face to the inside of the web.', [
            'Thickened epoxy; no grooves.',
            'Bend web and bands together over the S-ramp (side form drawing).',
          ], ['side-L-web', 'side-L-chine-in', 'side-L-gunwale-in', 'side-R-web', 'side-R-chine-in', 'side-R-gunwale-in']),
          I('Leave the deck rabbet: the inner chine band stops short of the web bottom.', [
            `The gap is the deck thickness + ${fin(c.p.deckSlopIn)}: use a deck offcut plus a shim as the spacer stick. Nothing is routed.`,
          ]),
          I('Cleat the sheer line before the glue goes on.', ['Screws into a sacrificial table every 4-5", the whole length.', 'An edge-bent band pushes about 65 lbf sideways until the epoxy cures.']),
          backers.length
            ? I(`Glue the sign backers inside each web: ${plural(backers.length / 2, 'strip')} per side, grain vertical.`, [
              bL.length ? `Forward of the web's rear end: ${bL.map((q) => `${fin(q.min[0] - web0)} to ${fin(q.max[0] - web0)}`).join(', and ')}.` : SEE_ITEM,
              'Top edge just under the inner gunwale band.',
              ins ? `Two #10-32 inserts each, epoxied: ${whereOf(ins)}.` : 'Two #10-32 inserts each.',
            ], backers.map((x) => x.id))
            : I('No sign backers in this model.'),
          I('Left and right in turn on the same S-ramp: two cures per side, four in all (a second ramp halves the time).'),
        ],
        checks: ['Sheer line follows the web pattern', 'Bands fully bonded, no lift at the bow bend (tap test)', 'Bend-test strip behaved on the rail form'],
      };
    },
  },
  {
    id: 'sides-outer',
    title: 'Side sandwiches, cure 2: outer bands, scuppers and chine ties',
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(chine|gunwale)|scupper-.*)$/,
    view: 'side',
    tools: ['S-ramp (mirror)', 'cleats and screws', 'clamps', 'epoxy pumps', 'drill', 'Domino'],
    hardener: '206',
    clamp: 'Flip the web onto the mirror ramp; same cleats and clamp spacing as cure 1.',
    build: (c) => {
      const out = c.by('side-L-chine');
      const web = c.by('side-L-web');
      const scup = c.mine.filter((x) => /^scupper/.test(x.id));
      const { key: tieKey, total: tieTotal } = chineTie(c.parts);
      const perSide = Math.round(tieTotal / 2);
      const web0 = web ? worldAABB(web).min[0] : 0;
      const scupX = [...new Set(scup.filter((x) => /-L$/.test(x.id)).map((x) => +(stationOf(x, web0) ?? 0).toFixed(2)))].sort((a, b) => a - b);
      const ties = feat(c, 'side-L-chine', 'mortise', /domino/i);
      return {
        goal: 'Glue the outer bands, fit the scuppers and cut the chine-tie mortises in each side.',
        items: [
          I('Per side, glue the outer chine band and the outer gunwale band to the outside face.', [
            'The chine band bottom is flush with the deck underside level: it rests on the rail.',
            'The gunwale band bends on edge to the sheer and across its thickness to the S, both at once.',
          ], ['side-L-chine', 'side-L-gunwale', 'side-R-chine', 'side-R-gunwale']),
          I('Fill the gap at the top: the web stops 1/8" under the gunwale band top.', ['Thickened epoxy, then trim flush.']),
          I('If you scarf a band (8:1), place the joint well.', ['Middle third of the band only.', 'Never in the first 4" behind the transom, nor under the grab boards, lash doublers or signs.', 'Stagger it 12" from the joint in the band on the same face.']),
          scup.length
            ? I(`Drill the scuppers: ${plural(scup.length, 'hole')}, 3/8", through inner band, web and outer band.`, [
              scupX.length ? `${list(scupX)} forward of the web's rear end, the lower edge just above the deck level.` : 'Rear and bow, the lower edge just above the deck level.',
              'Line each hole with epoxy and bed the stainless nipples.',
            ], scup.map((x) => x.id))
            : I('No scuppers in this model.'),
          I(`Chine ties, once the cure is hard: ${perSide} per side, ${tieKey} Dominos, VERTICAL, in the bottom edge.`, [
            `Through the outer band and the web edge (${fin((out?.stock?.t ?? 0) + (web?.stock?.t ?? 0))}), centered on the web / band glue line.`,
            'Mark them from the rail-top mortises with a story stick (or a dry offer-up of the rail).',
            ...(dominoRun(ties) ? [`Check against the drawing: ${dominoRun(ties)} (from the finished rear end).`] : []),
          ], ['side-L-chine', 'side-R-chine']),
          I('Leave all bands and webs long: they are cut to length at the dry fit.'),
        ],
        checks: ['Four bands per side bonded; the free web shows evenly at the bow and the rear', 'Both sides mirror images within 1/16"', `${perSide} chine mortises a side, square to the edge and on the glue line`],
      };
    },
  },
  {
    id: 'dry-fit',
    title: 'Dry-fit, trim the rails and cut the rail-end mortises',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'top',
    tools: ['tape', 'story stick', 'MDF station cradles', 'flush-cut (Japanese) saw', 'Domino', 'guided router', 'hand plane'],
    build: (c) => {
      const web = c.by('side-L-web');
      const net = web ? flatPattern(web)?.widthIn : undefined;
      const web0 = web ? worldAABB(web).min[0] : computeLayout(c.p).xSideStart;
      const cradles = cradleStations(c.p);
      const tMort = feat(c, 'rail-L', 'mortise', (q) => q.face === 'rear end');
      const bMort = feat(c, 'rail-L', 'mortise', (q) => q.face === 'front end');
      return {
        goal: 'Trial-fit the frame unit in the inverted sides, trim everything to one length, then cut the rail-end mortises.',
        items: [
          I(`Stand both sides inverted on ${cradles.length} MDF station cradles: 3/4" plates notched to the sheer.`, cradles.map((q, i) => `Cradle ${i + 1}: ${fin(q.x - web0)} from the rear end of the sides, ${fin(q.widthIn)} wide outside, ${fin(q.heightIn)} tall.`)),
          I('Turn the frame + deck unit over and drop it in DRY.', ['The chine Dominos (all vertical) engage.', 'The deck edge rises into the gap under the inner chine band.']),
          I(`Check the deck slot: ${fin(c.p.deckSideClearIn)} a side to each web (see D-63).`, ['Pare the deck edge if it binds; thickened epoxy fills the slot later.']),
          I('Measure and trim everything to one length.', [
            'Measure from the rear transom dado to the bow bulkhead dado, both sides.',
            `Cut the bands and webs to that length less 1/32"${net !== undefined ? ` (the webs came off the Shaper at ${fin(net)})` : ''}.`,
            'Trim the rails (left 1/2" long) to match: flush-cut saw or oscillating multi-tool, blade flat on the deck underside, then pare to the line.',
          ], ['rail-L', 'rail-R']),
          I('NOW cut the rail-end mortises in the trimmed rail ends (see D-69).', [
            `Transom end: ${mortiseSize(tMort) ? `${mortiseSize(tMort)} loose-tenon mortise` : endJoint(c, 'rail-L', 'transom-rear')}${fromTop(tMort) ? `, centered ${fromTop(tMort)}` : ''}.`,
            `Bulkhead end: ${mortiseSize(bMort) ? `${mortiseSize(bMort)} loose-tenon mortise` : endJoint(c, 'rail-L', 'bow-bulkhead')}${fromTop(bMort) ? `, centered ${fromTop(bMort)}` : ''}.`,
            'Domino on the glued unit, or a guided router on a fence against the end face. The mating mortises are in the transom and bulkhead Shaper files.',
          ], ['rail-L', 'rail-R']),
          I('Rehearse the whole close (transom first, bulkhead on a second batch) with clamps and cauls in place.'),
        ],
        checks: ['Length measured on both sides within 1/32"', 'Unit drops in without forcing', 'Rails, bands and webs end at the same station', 'Rail-end mortises centered on the rail and on the transom / bulkhead mortises'],
      };
    },
  },
  {
    id: 'lower',
    title: 'Lower the frame + deck unit into the inverted sides',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'iso',
    tools: ['epoxy pumps', 'clamps', 'drill', 'screwdriver'],
    hardener: '206',
    clamp: 'Clamp the chine bands to the rails between the Dominos; #6 screws up through the rails (piloted).',
    build: (c) => {
      const { key: tieKey, total: dom } = chineTie(c.parts);
      const railScrew = c.by('rail-L')?.joints?.find((j) => j.type === 'screw' && /chine/.test(j.to));
      const screw = /#\d+ × [\d\-\/]+/.exec(railScrew?.size ?? '')?.[0];
      const pilots = featuresOf(c, 'rail-L').filter((q) => q.kind === 'hole' && (q.to ?? []).some((t) => /chine/.test(t)));
      const xs = [...new Set(pilots.flatMap((q) => stations(q, 'REAR end')))].sort((a, b) => a - b);
      const cbore = /counterbore the head ([\d.\-\/]+"?) up the rail/.exec(railScrew?.size ?? '')?.[1];
      return {
        goal: 'Glue the frame + deck unit into the inverted sides for good.',
        items: [
          I(`Bed the ${fin((c.by('side-L-chine')?.stock?.t ?? 0.234) + (c.by('side-L-web')?.stock?.t ?? 0.157))} bearing face (outer band + web edge) of each side on its rail in epoxy.`, [], ['rail-L', 'rail-R']),
          I(`Fit the ${dom} Dominos (${tieKey}, every 6", ${f(dom / 2, 0)} per side) in the rail-top mortises, then lower the unit straight down (two people).`),
          I('Fill the deck slot at each web with thickened epoxy.', ['The deck edge rises under the inner chine band.']),
          I(`Screw up through the rails into the chine bands, BETWEEN the Dominos${screw ? `: ${screw}" flat-heads, piloted` : ''}.`, [
            xs.length ? `Pilots at ${list(xs)} from the rear end.` : SEE_ITEM,
            ...(cbore ? [`Counterbore the aft heads ${/"$/.test(cbore) ? cbore : `${fin(Number(cbore))}`} up the rail (the rail is deeper there); the bow screws need none.`] : []),
            'Never on a Domino: the screw would hit the mortise.',
            'Wipe squeeze-out inside the dados before it kicks.',
          ], ['rail-L', 'rail-R']),
          I('One batch per side, so the mix never outlives its pot life.'),
        ],
        checks: ['Both webs seat fully on the rails, no daylight at the chine', 'Hull diagonals equal within 1/8"'],
      };
    },
  },

  // ---------------- 4.4: close the ends ----------------
  {
    id: 'transom',
    title: 'Close the rear: transom with its backers',
    kind: 'build',
    steps: [HULL_STEP.transom],
    match: /^transom-/,
    view: 'iso',
    tools: ['pipe clamps (2)', 'cauls', 'epoxy pumps', 'router', 'drill'],
    hardener: '206',
    clamp: 'Two pipe clamps along the length; the backers clamped with a caul the evening before.',
    build: (c) => {
      const backers = c.mine.filter((x) => /backer/.test(x.id)).map((x) => x.id);
      const bands = count(c, 'glue');
      const sockHoles = feat(c, 'handle-socket-L', 'hole', (q) => (q.to ?? []).includes('transom-rear') && !/access hole/i.test(q.text));
      const sockAt = stations(sockHoles, 'BOTTOM end');
      const sockEdge = sockHoles ? new RegExp(`(${FR})" from the outboard edge`).exec((sockHoles.positions ?? []).join('; '))?.[1] : undefined;
      return {
        goal: 'Close the rear of the hull: backers on the transom, then the transom onto the hull in one glue-up.',
        items: [
          I('Bench, the day before: drill the handle-socket holes through the {{transom-rear}} and the backers.', [
            'Hold a socket in place and drill through its screw holes.',
            sockAt.length ? `On the socket they are ${list(sockAt)} up from its bottom end${sockEdge ? `, ${sockEdge}" from its outboard edge` : ''}.` : false,
          ]),
          I('Set a captive 1/4-20 T-nut per socket screw in each backer, from its inside face, before the backer is glued.', ['The socket screws then drive in from outside: no wrench ever has to reach behind the storage box.']),
          I(`Glue the backers (3/4" oak) full-face to the inside of the transom: ${tl(backers)}.`),
          I('Close ONE end first: the transom.', [
            'It slides onto the deck edge, both web ends (their dados are open at the top), the rail tenons and the four band ends per side (epoxy fillet butts, no Dominos).',
            `${plural(bands, 'glue joint')} and ${plural(count(c, 'mortise-tenon'), 'mortise-and-tenon')} in one glue-up.`,
          ]),
          I('Rehearse twice, then glue in small batches.', [
            '206 slow epoxy, mixed in SMALL batches in a wide shallow container, a second person mixing.',
            'The 1/8" vent holes in the dados let air and epoxy out; bung them after.',
          ]),
        ],
        checks: ['Transom square to the deck and plumb', 'Vent holes show a bead of epoxy (dados filled)', 'Hull length unchanged from the dry-fit measure', 'T-nuts clear of epoxy (run a screw in dry)'],
      };
    },
  },
  {
    id: 'bulkhead',
    title: 'Close the bow: bulkhead',
    kind: 'build',
    steps: [HULL_STEP.transom],
    match: /^bow-bulkhead$/,
    view: 'iso',
    tools: ['pipe clamps (2)', 'cauls', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Second batch, after the transom epoxy has kicked (3-6 h); two pipe clamps along the length.',
    build: () => ({
      goal: 'Close the bow with the bulkhead, the rider\'s foot brace.',
      items: [
        I('Fit the {{bow-bulkhead}}: its rear face is the rider\'s foot brace.', [
          'Dados open at the top take the web ends; the deck dado run into them takes the deck edge.',
          'Dominos into the rails (see D-69); the four band ends per side butt with an epoxy fillet.',
        ]),
        I('Glue it with a second, fresh small batch of 206, once the transom epoxy has kicked.', ['Wide shallow container, a second person mixing.', 'Fillet the inside corners with thickened epoxy.']),
        I('Keep epoxy out of the lift hand-hold, where the lamp clip fits.'),
      ],
      checks: ['Bulkhead square and at the dry-fit mark', 'Web and deck seated in their dados, no gaps'],
    }),
  },

  // ---------------- 4.5-4.6: running gear (hull still inverted) ----------------
  {
    id: 'rear-beam',
    title: 'Rear beam: fit and drill the axle and clamp plates (then off)',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^(beam-R|beam-hold-down-[LR])$/,
    view: 'under',
    tools: ['drill press', 'router (groove)', 'wrenches', 'torque wrench'],
    build: (c) => {
      const groove = feat(c, 'beam-R', 'groove');
      const plateHoles = feat(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const holdHoles = feat(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t)));
      const plates = c.parts.filter((x) => /^clamp-R/.test(x.id)).map((x) => x.id);
      const plateSpan = feat(c, 'clamp-RL1', 'hole');
      const pitch = spans(plateSpan, 'REAR edge').length ? undefined : stations(plateSpan, 'REAR edge');
      return {
        goal: 'Fix the rear beam to the hull for good, then fit and drill the axle and clamp plates and take them off again.',
        items: [
          I('Cut the axle groove in the top face of the {{beam-R}}.', [
            `${fin(c.p.axleDiameterIn)} wide × ${fin(axleGrooveDepthIn(c.p))} deep, so the ${fin(c.p.axleDiameterIn)} ${axleWord(c.p)} stands ${fin(c.p.axleProudIn)} proud and the clamp plates bear on the ${axleWord(c.p)}.`,
            whereOf(groove) ? `${cap(whereOf(groove)!)}.` : SEE_ITEM,
          ]),
          I('Drill the beam.', [
            plateHoles ? `Clamp-plate bolts, ${holeText(plateHoles)}.` : `Clamp-plate bolts: ${SEE}.`,
            holdHoles ? `Hold-down bolts, ${holeText(holdHoles)}.` : `Hold-down bolts: ${SEE}.`,
          ]),
          I('Bolt the beam to the hull for good with the hold-down angles: {{beam-hold-down-L}} and {{beam-hold-down-R}}.', [
            'The beam passes under the rails and bears on the notch ceiling.',
            'Two 1/4" × 2-1/4" bolts through each angle\'s upright leg, the hanger and the rail; nut and washer outside.',
            `Two 1/4" × 3" bolts down through each flat leg and the beam, either side of the ${axleWord(c.p)}.`,
            'The beam and angles stay on for finishing; mask the bolt heads.',
          ]),
          I('FIT AND DRILL, then take off: the axle and its clamp plates.', [
            I(`Lay the {{axle-R}} (${axleWhat(c.p)}) in the groove; cotter cross holes ${fin(c.p.axleCrossHoleDiaIn)} near each end.`),
            I(`Clamp the plates (${tl(plates)}) on and drill through them into the beam holes${pitch?.length ? `: 2 per plate, ${fin(Math.abs(pitch[pitch.length - 1] - pitch[0]))} apart` : ''}.`),
            'Dry-assemble and check, then remove the axle and plates: they go back on after the finish.',
          ]),
          I('Tag every axle, plate and bolt (rear L / R) so the kit goes back where it was drilled.', ['At the hang step: nylock nuts and fender washers under the beam, tape shims on the plate ends, snug plus a quarter turn.']),
        ],
        checks: ['Axle centered: equal length out each side', 'Plates do not rock when dry-assembled', 'Beam square to the rails (diagonals from the transom corners)'],
      };
    },
  },
  {
    id: 'front-beam',
    title: 'Front beam: kingpin, then fit and drill the stub axles and eye bolts (then off)',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^(beam-F|king-thrust|kingpin)$/,
    view: 'under',
    tools: ['drill press', 'wrenches', 'router (grooves)', 'tape / shims'],
    build: (c) => {
      const kp = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).includes('kingpin'));
      const grooves = featuresOf(c, 'beam-F').filter((q) => q.kind === 'groove');
      const grooveLen = grooves[0] ? new RegExp(`(${FR})" long from the`).exec(grooves[0].text)?.[1] : undefined;
      const plate = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const pads = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^roll-pad/.test(t)));
      const eyes = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^steer-eye/.test(t)));
      const anchors = feat(c, 'joist-6', 'hole', (q) => (q.to ?? []).some((t) => /^steer-anchor/.test(t)));
      const disc = feat(c, 'king-beam', 'hole', (q) => (q.to ?? []).includes('king-thrust'));
      return {
        goal: 'Hang the front beam on its kingpin, then fit and drill the stub axles, roll pads and eye bolts and take them off.',
        items: [
          I('Screw the {{king-thrust}} to the {{king-beam}}: three #8 flat-heads, counterbored from the disc side.', [disc ? `Pilots ${holeText(disc)}.` : SEE_ITEM]),
          I('Drill and groove the {{beam-F}}.', [
            kp ? `Kingpin hole: ${fin(c.p.kingpinDiaIn)}, square on the drill press, ${whereOf(kp)}.` : `Kingpin hole: ${SEE}.`,
            `Stub-axle grooves: ${fin(c.p.axleDiameterIn)} wide × ${fin(axleGrooveDepthIn(c.p))} deep in the top face${grooveLen ? `, ${grooveLen}" in from each end` : ''}, so the ${axleWord(c.p)} stands ${fin(c.p.axleProudIn)} proud.`,
            plate ? `Clamp-plate bolts, ${holeText(plate)}.` : false,
            eyes ? `Eye-bolt holes, fore-aft, ${holeText(eyes)}.` : false,
          ]),
          I(`Hang the beam on the {{kingpin}}: ${fin(c.p.kingpinDiaIn)} grade 8 bolt, head and plate washer under the beam.`, [
            'Up through the beam, the disc and the king beam.',
            'Nylock nut and washer in the slot in the king beam: snug, then back off a quarter turn so the beam swings freely.',
            'The beam, disc and kingpin stay on for finishing (mask the head and the slot).',
          ]),
          I('FIT AND DRILL, then take off: the stub axles, clamp plates and roll pads.', [
            I('Stub axles in their grooves ({{axle-FL}}, {{axle-FR}}); two clamp plates per end, bolted as at the rear.'),
            I(`Roll pads ({{roll-pad-L}}, {{roll-pad-R}}) beside the grooves, shimmed ${fin(c.p.axleProudIn)} off the beam${pads ? `; pilots ${holeText(pads)}` : ''}.`),
            'Running gap under the rail about 0.1" (1/32" to 1/8"), set with tape.',
            'Drill every hole, dry-assemble, check the lock, remove.',
          ]),
          I('Drill the steering eye-bolt holes now, while the underside is up.', [
            I(`Anchor holes in {{joist-6}} (the chain crossmember), fore-aft${anchors ? `: ${holeText(anchors)}` : ''}.`),
            'The nylock nuts and 2" washers go on at the hang step.',
          ], ['steer-eye-L', 'steer-eye-R', 'steer-anchor-L', 'steer-anchor-R']),
          I('Tag the stubs, plates, pads, eye bolts and bolts (front L / R) and bag them with the rear kit.'),
        ],
        checks: [`Axle swings freely through the full lock (±${f(c.p.steerLockDeg, 0)}°) with no drag`, 'Roll-pad gap 1/32" to 1/8"', 'Clamp plates clear the king beam by 1/8"'],
      };
    },
  },
  {
    id: 'brake-knees',
    title: 'Brake knees (and backers), glued and bolted while the hull is inverted',
    kind: 'build',
    steps: [STEP.brake],
    at: STEP.gear,
    match: /^brake-(backer|knee)-[LR]$/,
    view: 'under',
    tools: ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '206',
    clamp: 'Backers clamped to the rail and deck underside before the bolts go in; knees clamped to the rail while the bolts go through.',
    build: (c) => {
      const knees = c.mine.filter((x) => /^brake-knee/.test(x.id)).map((x) => x.id);
      const backers = c.mine.filter((x) => /^brake-backer/.test(x.id));
      const framed = c.parts.some((x) => /^brake-backer/.test(x.id) && x.step <= HULL_STEP.deck);
      const bolts = feat(c, 'brake-knee-L', 'hole', (q) => (q.to ?? []).some((t) => /^rail-/.test(t)));
      const corner = feat(c, 'brake-knee-L', 'outline', (q) => q.angleDeg !== undefined);
      const cornerPts = corner ? (corner.positions ?? []).flatMap((t) => [...t.matchAll(new RegExp(`(${FR})" from the outboard edge, (${FR})" from the top end`, 'g'))].map((m) => [m[1], m[2]])) : [];
      const ang = corner?.angleDeg !== undefined ? String(corner.angleDeg) : undefined;
      return {
        goal: 'Glue and bolt the brake knees to the rails now, while the hull is upside down.',
        items: [
          I('Do it now, not after the flip.', [
            'The knee legs are epoxied to bare oak: epoxy will not bond to varnish.',
            'The nylock nuts sit in counterbores under the deck, reachable only while the hull is inverted.',
          ]),
          backers.length
            ? I(`Glue the backers (3/4" oak) to the rail inboard face and the deck underside, clear of the axle hanger: ${tl(backers.map((x) => x.id))}.`)
            : framed
              ? I('The backers went in with the frame glue-up and their bolt holes are drilled: only the knees go on here.', [], ['brake-backer-L', 'brake-backer-R'])
              : I('No backers in this model.'),
          I('Cut ONE knee first and run the one-knee test (Verify).', ['Try it with the real pin and flap tongue; cut the other knee only when it passes.'], knees),
          I(`Shape each knee from its laminated block: ${tl(knees)}.`, [
            cornerPts.length >= 2 && ang ? `Corner cut on the outboard edge: it starts ${cornerPts[0][1]}" below the top end, runs in at ${ang}° to ${cornerPts[1][0]}" from the edge at ${cornerPts[1][1]}" down, then straight to the bottom end.` : `Outline: ${SEE}.`,
            'Slot the arm from the rear, 1-3/8" wide (the flap tongue + 1/16" a side), leaving two ears.',
            'The 3/8" pivot hole waits: it is drilled with the flap tongue clamped in the slot.',
          ]),
          I('Bolt each knee: 4 × 3/8" × 4" bolts, 2 columns × 2 rows, through the knee leg and the rail into the backer.', [
            bolts ? `Holes in the knee, ${holeText(bolts)}.` : SEE_ITEM,
            'Heads in counterbores in the knee; fender washers and nylock nuts in 1/2" counterbores in the backer, under the deck.',
            'Epoxy in the holes and on the leg against the rail and chine outer face; clamp, bolt, wipe the squeeze-out.',
          ], ['rail-L', 'rail-R']),
          I('Leave the knees 24 h before the wheel dry fit (next step) loads them.'),
        ],
        checks: ['Knee tops level with each other', 'Knee clears the tire front by the designed margin (check at the wheel dry fit)', 'Every nylock on and snug; nothing on the knees varnished yet'],
      };
    },
  },
  {
    id: 'gear-fit',
    title: 'Dry-fit the wheels, then take the running gear off',
    kind: 'process',
    steps: [STEP.gear],
    view: 'under',
    tools: ['wrench', 'cotter-pin pliers', 'tire gauge', 'tape and bags', 'drill'],
    build: (c) => {
      const wheels = c.parts.filter((x) => /^wheel-/.test(x.id) && x.group !== 'reference');
      const pilots = stopBlockPilots(c.parts, c.p);
      return {
        goal: 'Dry-fit the wheels to prove the running gear, drill the last holes, then take everything metal off.',
        items: [
          I(`Put the ${plural(wheels.length, 'wheel')} on the axles.`, [`${fin(c.p.wheelBoreIn)} bore on the ${fin(c.p.axleDiameterIn)} ${axleWord(c.p)}, sealed bearings.`, 'Collar and cotter pin 1" beyond the hub.'], wheels.map((x) => x.id)),
          I(`Check the track: ${fin(c.p.frontTrackIn)} front, ${fin(c.p.rearTrackIn)} rear.`, ['Inflate to the squash-test pressure (Verify).']),
          I('Spin each wheel.', ['No rub on the beam end, the clamp plates or the brake knee.', 'Measure the knee-to-tire margin now, wheels on and knees cured.', 'No end float beyond 1/16".']),
          pilots
            ? I(`Drill the ${plural(pilots.total, 'stop-block screw pilot')} through the deck now, hull still inverted.`, [
              `Countersink them on the underside for the ${pilots.screw}" flat-heads, ${pilots.perBlock} a block, in line across the sled.`,
              `From the transom's outer face: ${list(pilots.xs)} forward, ${list(pilots.offCenter)} either side of the centerline.`,
              'The blocks are screwed on from below later, with the sled on its side.',
            ], ['seat-wedge-L', 'seat-wedge-R'])
            : I('No seat stop-block screws in this model.'),
          I('Take the running gear OFF and bag the whole kit.', [
            'Wheels, axles, clamp plates, roll pads and eye bolts, with their bolts, washers, collars and cotter pins.',
            'Nothing metal stays on the underside: it is finished next, and the gear goes back on after the topcoat (hang step).',
          ]),
        ],
        checks: ['All four wheels spin freely and run true', 'Axles square: wheelbase measured on both sides within 1/8"', 'Every bolt hole and the stop-block pilots drilled; the kit bagged and tagged'],
      };
    },
  },
  {
    id: 'finish-under',
    title: 'Finish the underside (hull still inverted)',
    kind: 'process',
    steps: [STEP.gear],
    view: 'under',
    tools: ['random-orbit sander', 'rollers and brushes', 'epoxy pumps', 'masking tape'],
    build: (c) => {
      const std = isStandard(c.p);
      return {
        goal: 'Finish everything you can reach from below before the hull is turned over.',
        items: [
          I('Run the finishing schedule (Finishing section) on the underside.', [
            'The deck underside, rails, crossmembers, beams, hangers and king beam.',
            'The brake knees and their backers.',
            'The outside of the sides, the transom and the bulkhead.',
          ]),
          I('Offcut test first, then sand 120 / 150 and stain the show faces.'),
          std
            ? I('Epoxy the deck underside and the oak end grain (one coat), then urethane.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.'])
            : I('Epoxy-seal (one saturation coat), then varnish.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.']),
          I('Mask the bolt seats, the kingpin head and the hold-down angles.', ['Brush into the knee counterbores; leave the pivot-hole spot for later.']),
          I('Flip only when the last coat is dry enough to handle (3 days).', ['Padded horses; carry the hull by the rails and the bulkhead, never by the sides.']),
          I('The inside, the topside and everything built after the flip are finished later, in the Finish step.'),
        ],
        checks: ['Offcut test approved before any stain goes on the sled', 'No bare wood or bare ply edge on the underside', 'Varnish dry to handle before the flip'],
      };
    },
  },
  {
    id: 'flip',
    title: 'Turn the hull upright',
    kind: 'process',
    steps: [STEP.gear],
    view: 'iso',
    tools: ['padded horses', '4 people'],
    build: (c) => {
      const present = c.parts.filter((x) => (x.step <= STEP.gear || isEarlyBrakePart(x)) && !x.payload && x.group !== 'reference' && !isHangPart(x));
      const mass = present.reduce((s, x) => s + x.massLb, 0);
      return {
        goal: 'Turn the hull right side up without marking the fresh finish.',
        items: [
          I(`Four people and padded horses: the hull weighs about ${f(mass, 0)} lb without its running gear.`),
          I('Before the lift: nothing loose in the hull.', ['Lift at the rails and the bulkhead, never by the sides.']),
          I('Set it on padded blocks under the rails, at least 4" high.', ['The deck underside stays open to a stubby driver (the stop-block screws).', 'It stays on the blocks until the hang step: the wheels are not on yet.']),
        ],
        checks: ['Hull sits level on the blocks (no rocking)'],
      };
    },
  },

  // ---------------- 4.7-4.9: steering linkage, tongue, bridle ----------------
  {
    id: 'tongue',
    title: 'Tongue and bridle sleeve',
    kind: 'build',
    steps: [STEP.linkage, STEP.spindles],
    view: 'front',
    tools: ['wrenches', 'drill press', 'files'],
    hardener: '206',
    clamp: 'Epoxy the bronze sleeve in its hole and let it go off before the finish.',
    build: (c) => {
      const boltT = feat(c, 'bridle-tongue', 'hole', (q) => (q.to ?? []).includes('beam-F'));
      const boltB = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).includes('bridle-tongue'));
      const sleeve = feat(c, 'bridle-tongue', 'hole', (q) => (q.to ?? []).includes('bridle-sleeve'));
      const boltLen = /× ([\d\-\/]+)" bolts/.exec(boltT?.purpose ?? boltB?.purpose ?? '')?.[1];
      const tongueLen = c.by('bridle-tongue')?.stock?.l, sleeveAt = stations(sleeve, 'rear end')[0];
      const tip = tongueLen !== undefined && sleeveAt !== undefined ? fin(tongueLen - sleeveAt).replace(/"$/, '') : undefined; // from the tip (the front end)
      return {
        goal: 'Bolt the tongue to the front beam for good and set the bronze rope sleeve.',
        items: [
          I('Drill the {{bridle-tongue}} T head and the {{beam-F}} together for the two carriage bolts.', [
            boltT ? `In the tongue, ${holeText(boltT)}.` : SEE_ITEM,
            boltB ? `In the beam, ${holeText(boltB)}.` : false,
          ]),
          I(`Bolt the tongue on: two 3/8"${boltLen ? ` × ${boltLen}"` : ''} carriage bolts fore-aft through the T head and the whole beam.`, [
            'Nylock nuts and fender washers on the rear face.',
            'The tongue is not removable (see D-65): it stays on and is finished in place.',
          ]),
          I('Epoxy the bronze {{bridle-sleeve}} in the hole across the stem.', [
            sleeve ? `1" hole${tip ? `, ${tip}" from the tip` : `, ${whereOf(sleeve)}`}.` : '1" hole near the tip.',
            `${fin(c.p.tongueSleeveBoreIn)} bore, 1" OD. Ease both bore ends so the rope bears on a round edge.`,
            'Mask the bore for the finish.',
          ]),
          I(`The bridle rope (${fin(c.p.bridleRopeDiaIn)} nylon) and the check chains go on at the hang step, with the eye bolts they hook to.`),
        ],
        checks: ['Tongue square to the beam', 'Sleeve flush, bore clear of epoxy', 'Tongue clears the king beam and the clamp-plate bolt holes'],
      };
    },
  },

  // ---------------- 5: seat and storage ----------------
  {
    id: 'storage-box',
    title: 'Storage box: walls, coaming, hinge backers, latch blocks',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^(storage-(side|end|coaming|hinge-backer|latch-block)-|storage-(side|end)-)/,
    view: 'iso',
    tools: ['table saw (45° bevels)', 'tape', 'glass tape', 'epoxy pumps', 'router'],
    hardener: '206',
    clamp: 'Tape-and-fold: outside seams taped, then fillets; coaming clamped with cauls.',
    build: (c) => {
      const walls = c.mine.filter((x) => /^storage-(side|end)-/.test(x.id)).map((x) => x.id);
      const coam = c.mine.filter((x) => /coaming/.test(x.id)).map((x) => x.id);
      const hb = c.mine.filter((x) => /hinge-backer/.test(x.id)).map((x) => x.id);
      const lb = c.mine.filter((x) => /latch-block/.test(x.id)).map((x) => x.id);
      return {
        goal: 'Build the storage box on the deck: walls, coaming, hinge backers and latch blocks.',
        items: [
          I('Bevel the wall edges at 45° on the table saw.', ['Tape the outside seams and fold the box up.', 'Inside each corner: a 3/8" epoxy fillet and 2" glass tape (no spline).'], walls),
          I('Stand the walls on the sealed deck: the deck is the floor.', ['Fillet inside and bead outside, so no ply edge is exposed.']),
          I('Glue the oak coaming to the wall tops, butt corners.', ['Round the inboard top edge 1/8".', 'The gasket and lid sit on oak, never on a ply edge.'], coam),
          I(`Glue the hinge backers inside the fore end: ${tl(hb)}.`, [I(`Latch blocks (grain vertical) on the inside of the transom: ${tl(lb)}.`)]),
          I('Fair the deck inside the box with microballoon epoxy.', ['Fall about 1/8" toward each aft drain; the drain nipples go in at the final fit.']),
        ],
        checks: ['Box square, fillets continuous', 'Coaming flat across all four walls (gasket seat)', 'Drain falls toward the corners'],
      };
    },
  },
  {
    id: 'storage-lid',
    title: 'Storage lid: frame, panel and battens',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^storage-(lid|rim)/,
    view: 'iso',
    tools: ['router (mortises, rabbet)', 'epoxy pumps', 'clamps', 'drill'],
    hardener: '206',
    clamp: 'Panel captured in the frame rabbet; frame clamped square while the corners set.',
    build: (c) => {
      const frame = c.mine.filter((x) => /^storage-rim-/.test(x.id)).map((x) => x.id);
      const battens = c.mine.filter((x) => /batten/.test(x.id)).map((x) => x.id);
      const mort = feat(c, 'storage-rim-side-L', 'mortise');
      const mortSize = mortiseSize(mort);
      const mortAt = centersOf(mort, 'REAR end');
      const dado = feat(c, 'storage-rim-side-L', 'dado');
      const dadoAt = spans(dado, 'REAR end').map(([a]) => a);
      return {
        goal: 'Make the oak lid frame, set the panel in it, and fit the hinges.',
        items: [
          I('Cut the lid frame joints.', [
            `Corners: blind loose tenons${mortSize ? `, ${mortSize}` : ''}; the mortises in the frame sides centered ${mortAt.length ? `at ${list(mortAt)} from the rear end` : SEE}.`,
            'Panel rabbet: 1/4" × 1/4" along the top inside edge of every frame piece.',
            dadoAt.length ? `Batten dados, 1/4" deep in the frame sides, starting ${list(dadoAt)} from the rear end.` : `Batten dados: ${SEE}.`,
          ], frame),
          I('Glue the frame square around the {{storage-lid}}, the panel in its rabbet and epoxy-sealed.'),
          I(`Let the ${plural(battens.length, 'batten')} 1/4" into the frame sides.`, ['Epoxy plus 4 plugged stainless screws each, from the top: they keep the panel from sagging.'], battens),
          I('The lid is engraved DO NOT STEP in the finishing schedule (step 5), before the topcoat.', ['It is a lid to sit a cushion on, not a step (see D-58).']),
          I('Fit and drill the hinges, then take them off.', [
            `Pilots for ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} into the lid frame, ${screwOf(c, 'storage-hinge-L', /hinge-backer/)} through the end panel into the backers.`,
            'The hinges go on after the finish; the gasket goes in at the final fit.',
          ], ['storage-hinge-L', 'storage-hinge-R']),
        ],
        checks: ['Lid flat and square; sits on the coaming without rocking', 'Panel flush with the frame'],
      };
    },
  },
  {
    id: 'seat-blocks',
    title: 'Seat stop blocks and crest strip',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^seat-(wedge|crest)/,
    view: 'side',
    tools: ['bandsaw', 'plane', 'drill press with stop', 'clamps', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Blocks epoxied and held by two screws each, driven up from the underside; crest strip clamped with a caul from the front.',
    build: (c) => {
      const pilots = stopBlockPilots(c.parts, c.p);
      const latch = feat(c, 'seat-wedge-L', 'hole', (q) => /deep/.test(q.size ?? ''));
      const latchSize = latch ? new RegExp(`^(${FR})"[^,]*, (${FR})" deep`).exec(latch.size ?? '') : null;
      const wedgeJ = c.by('seat-wedge-L')?.joints?.find((q) => q.type === 'pin' && /annular detent groove/.test(q.size ?? ''));
      const groove = wedgeJ ? /groove ([\d.]+)" from the mouth/.exec(wedgeJ.size ?? '')?.[1] : undefined;
      const ang = latch?.face === 'sloped face' ? '1' : undefined;
      const mouth = latch?.positions?.length ? latch.positions.join('; ') : undefined;
      return {
        goal: 'Glue the seat-back stop blocks and the crest strip to the box end.',
        items: [
          I('Shape the stop blocks to the back angle: bandsaw, then plane to the line (block drawing).', [], ['seat-wedge-L', 'seat-wedge-R']),
          I('Drill the upright latch hole in each block face before it is glued.', [
            latchSize ? `${latchSize[1]}" blind, ${latchSize[2]}" deep with a drill stop${ang ? ', square to the sloped face' : ''}.` : '3/8" blind, with a drill stop.',
            mouth ? `Mouth ${mouth}.` : SEE_ITEM,
            groove ? `1/16" detent groove ${fin(Number(groove))} from the mouth.` : false,
          ], ['seat-wedge-L', 'seat-wedge-R']),
          I(`Glue each block to the deck and the box end, located on its ${pilots ? plural(pilots.perBlock, 'pilot') : 'pilots'} from the wheel dry fit.`, [
            'Stand a screw in each pilot from below and press the block onto it.',
            'Tip the sled onto its side on a padded blanket (or work under it on the blocks) and drive the screws from the UNDERSIDE, countersunk.',
            'No screw goes in from above. Touch up the finish on the heads.',
          ]),
          I('Bed the {{seat-crest-strip}} over the box end.', [
            'Tape the lid-hinge leaves to the box end as spacers, wax paper under the strip.',
            'A 1/8" layer of thickened epoxy, the strip end to end with each block.',
            'Lift the leaves out after the cure: the strip keeps their recess.',
          ]),
        ],
        checks: ['Crest strip straight along its span', 'Blocks mirror each other; solid oak behind each latch hole'],
      };
    },
  },
  {
    id: 'seat-back',
    title: 'Seat back, hinges, pins and cushions',
    kind: 'build',
    steps: [STEP.seatStorage],
    view: 'side',
    tools: ['drill press with stop', 'hex key', 'iron (veneer edge)', 'router'],
    hardener: '206',
    clamp: 'Epoxy the inserts in their holes and leave them for the full cure before the first load.',
    build: (c) => {
      const pad = feat(c, 'seat-hinge-backer-L', 'hole', /pilot/);
      const pin = feat(c, 'seat-hinge-backer-L', 'hole', (q) => /deep/.test(q.size ?? '') && !/pilot/.test(q.size ?? ''));
      return {
        goal: 'Make the seat back and fit its hinges, pins and cushions (the hardware goes on for good after the finish).',
        items: [
          I('Shape the {{seat-back-panel}}.', ['2-1/2" radius top corners.', '1/16" oak veneer banding round the edge, flush-trimmed and epoxy-sealed: no ply edge shows.']),
          I('Set the hinge inserts: 3 per hinge, #10-32 × 5/16 stainless, hex-drive.', ['Epoxied in blind holes 11/32" deep from the front face (drill stop), at least 1/2" from every edge.', 'Pull-test one on a scrap first (Verify).']),
          I('Bore the latch-pin holes in the panel.', ['13/32" clearance, square, 7-3/8" either side of the center, 2" up from the hinge axis.', 'Line them with epoxy.']),
          I('FIT AND DRILL now, hang later: the 2" butt hinges.', [
            '#10-32 × 3/8 screws into the inserts on the back.',
            `${screwOf(c, 'seat-hinge-L', /hinge-backer/)} through the deck into the backer pads, piloted through the leaf holes${pad ? ' (positions on the backer drawing)' : ''}.`,
            pin ? `Flat-latch pin hole: 3/8" blind, 5/8" deep in the pad, ${whereOf(pin)}; 1/16" groove 1/4" below the deck.` : 'Flat-latch pin hole: 3/8" blind, 5/8" deep in the pad.',
          ], ['seat-hinge-L', 'seat-hinge-R', 'seat-hinge-backer-L', 'seat-hinge-backer-R']),
          I('Dry-fit the spring-detent pins, lanyards and cushions.', ['Cushions on Dual Lock; the seat cushion sits 3/8" forward of the back so the hinge knuckles clear.', 'They go on with the hinges after the finish.'], ['seat-pin-L', 'seat-pin-R', 'seat-cushion', 'seat-back-pad']),
        ],
        checks: ['Back flips 105° and lies flat; both latches engage in both positions', 'Pin head clears the cushion', 'Seat back does not rock against the crest strip'],
      };
    },
  },

  // ---------------- 6: brake and handle ----------------
  {
    id: 'brake-flaps',
    title: 'Brake flaps, pads, cords and chocks',
    kind: 'build',
    steps: [STEP.brake],
    match: /^brake-/,
    view: 'side',
    tools: ['Shaper Origin', 'bandsaw', 'drill press', 'router (1/4" roundover)', 'contact cement'],
    hardener: '206',
    clamp: 'Shoe and pivot block clamped to the flap while the epoxy sets; contact cement per the can.',
    build: (c) => {
      const pinHole = feat(c, 'brake-pivot-block-L', 'hole', (q) => /pin/.test(q.purpose ?? ''));
      const eye = feat(c, 'brake-knee-L', 'hole', (q) => /screw eye/.test(q.purpose ?? ''));
      return {
        goal: 'Make the two brake flaps with their shoes, pads, return cords and chocks, as removable kits.',
        items: [
          I('Cut the flaps on the Shaper from the file: {{brake-flap-L}} and {{brake-flap-R}}.', ['7/8" oak; 1/4" roundover on all edges.', 'Epoxy-seal before the finish.']),
          I('Fit a pivot block on each flap tongue: {{brake-pivot-block-L}} and {{brake-pivot-block-R}}.', [
            `Epoxy and 3 × ${screwOf(c, 'brake-pivot-block-L', /brake-flap/)} flat-head screws.`,
            `Clamp the knee on, then drill the 3/8" pin hole across block and tongue together${pinHole ? `: ${whereOf(pinHole)} of the block` : ''}.`,
            'Seal the bore in the knee ears with a brush of epoxy; fit the clevis pin (double shear) and the hitch-pin clip.',
          ]),
          I('Make the shoes: {{brake-shoe-L}} and {{brake-shoe-R}}.', [
            'Bandsaw from the blank: the top follows the 6° flap underside, the bottom is cut to the tire radius.',
            `Epoxy and 2 × ${screwOf(c, 'brake-shoe-L', /brake-flap/)} screws up into the flap (all the brake's wood screws are one size).`,
          ]),
          I('Dry-fit the pads and treads: they go on for good at the hang step.', [
            `Pad: 3" × 3" rubber, contact cement and 2 × ${screwOf(c, 'brake-pad-L', /brake-shoe/)} flat-heads buried 1/8", 1/2" off the shoe screws.`,
            'Foot tread: 4" × 2-1/2" ribbed rubber, contact cement.',
          ], ['brake-pad-L', 'brake-pad-R', 'brake-foot-tread-L', 'brake-foot-tread-R']),
          I('Make the return cords.', ['1/4" shock cord with a 3/16" stop cord tied taut at the released length, 9" between the eyes.', 'Snap hook to the transom eye (backer behind it); #10 screw eye in the flap\'s rear end face.'], ['brake-cord-L', 'brake-cord-R']),
          I('Make the chocks: {{brake-chock-L}} and {{brake-chock-R}}.', [
            'Oak wedge, its ramp at 28° to meet the tire; two stainless screw heads left proud in the base.',
            `30" cord to a screw eye under the knee${eye ? `: pilot ${holeText(eye)}` : ''}.`,
          ]),
          I('Removable: clip off, pin out, cord unhooked, flap lifted off, about 15 s a side (see D-65).', ['Finish the flap kit on the bench; the pin, clip, cord, snap hook, pad and tread stay off until the hang step.']),
        ],
        checks: ['Pad hangs 3/8" off the tread released and swings onto it when the flap is pressed', 'Flap clears the tire and the transom corner; foot end at the transom face', 'Flap returns by itself when released'],
      };
    },
  },
  {
    id: 'handle',
    title: 'Push handle: posts and handlebow (sockets fitted, then off)',
    kind: 'build',
    steps: [STEP.brake],
    match: /^handle-/,
    view: 'side',
    tools: ['drill press', 'bandsaw', 'router table', 'hex keys', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Bow clamped to both posts (post tops sawn to the bow slope) until the epoxy sets.',
    build: (c) => {
      const sock = feat(c, 'handle-socket-L', 'hole', (q) => (q.to ?? []).includes('transom-rear') && !/access hole/i.test(q.text));
      const access = feat(c, 'handle-socket-L', 'hole', /access hole/i);
      const accessDia = access ? new RegExp(`^(${FR})"`).exec(access.size ?? '')?.[1] : undefined;
      const sockAt = stations(sock, 'BOTTOM end');
      const slope = feat(c, 'handle-post-L', 'outline', (q) => q.angleDeg !== undefined);
      const ang = slope?.angleDeg !== undefined ? String(slope.angleDeg) : undefined;
      const crossJ = c.by('handle-post-L')?.joints?.find((q) => /cross-bored/.test(q.size ?? ''));
      const crossAt = crossJ ? /cross-bored ([\d.]+)" above/.exec(crossJ.size ?? '')?.[1] : undefined;
      const bowPins = feat(c, 'handle-bar', 'hole', (q) => /deep/.test(q.size ?? ''));
      const bowAt = stations(bowPins, 'LEFT end');
      return {
        goal: 'Make the push handle as one removable U, and fit and drill its sockets on the transom.',
        items: [
          I('FIT AND DRILL now, then take off: the aluminum sockets {{handle-socket-L}} and {{handle-socket-R}}.', [
            `Hold each socket on the transom and drill through its screw holes and the backer${sockAt.length ? ` (on the socket: ${list(sockAt)} up from its bottom end)` : ''}.`,
            accessDia ? `Drill a ${accessDia} access hole in the socket's rear wall opposite each screw: the head goes in through it. Plug it after assembly.` : false,
            `At the hang step: bedded in sealant, ${socketScrewText(c.parts)} per socket into the T-nuts, a nylon washer under each head. No wrench reaches behind the box.`,
            'Anodized or epoxy-coated aluminum only (bare aluminum corrodes against wet oak); touch up any bare edge.',
          ]),
          I('Make the posts: {{handle-post-L}} and {{handle-post-R}}.', [
            'Slip fit in the sockets; a 1/2" × 3/16" relief groove down the transom-side face.',
            `Tops sawn to the bow slope${ang ? ` (${ang}°)` : ''}.`,
            crossAt ? `Clevis-pin hole across, ${fin(Number(crossAt))} above the socket bottom.` : false,
          ]),
          I('Make the {{handle-bar}}: one board, edge bandsawn to the arc of the crown template.', [
            'Plane and round it to a 1-1/4" grip.',
            bowAt.length ? `Pin holes 3/8" blind, 3/4" deep in the bottom edge, ${list(bowAt)} from the left end.` : 'Pin holes 3/8" blind, 3/4" deep in the bottom edge.',
          ]),
          I('Pin and glue the bow to the post tops.', ['3/8" × 2-1/4" stainless rod: 1-1/2" deep in the post, 3/4" in the bow, epoxied.', 'The handle comes off as ONE U and is finished on the bench.']),
          I('Clevis pin (5/16") through both socket walls and the post; the parked pin hole is 13-1/2" up.', [], ['handle-pin-L', 'handle-pin-R']),
        ],
        checks: ['Posts slide in and out without binding on the screw heads', 'Bow level and the U square', 'Handle clears the brake flaps and the tail light'],
      };
    },
  },

  // ---------------- 7: finish ----------------
  {
    id: 'wood-fitout',
    title: 'Lash doublers and flag blocks (glue before finishing)',
    kind: 'build',
    steps: [STEP.finish],
    match: /^(doubler-lash-|flag-block-)/,
    view: 'iso',
    tools: ['table saw', 'spring clamps', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Spring clamps or tape; no screws into the thin web.',
    build: (c) => {
      const L = computeLayout(c.p);
      const dbl = c.mine.filter((x) => /^doubler/.test(x.id));
      const flags = c.mine.filter((x) => /^flag-block/.test(x.id)).map((x) => x.id);
      const xs = [...new Set(dbl.filter((x) => /-L\d$/.test(x.id)).map((x) => +(stationOf(x, L.xRear) ?? 0).toFixed(2)))].sort((a, b) => a - b);
      return {
        goal: 'Glue the last wood blocks inside the hull while everything is still bare.',
        items: [
          I(`Glue the ${plural(dbl.length, 'lash doubler')} to the inboard face of the inner gunwale band.`, [
            '1" oak, cut square to the gunwale slope at each station.',
            xs.length ? `Centers ${list(xs)} forward of the transom's outer face, each side.` : SEE_ITEM,
            'The lash plates screw into them later.',
          ], dbl.map((x) => x.id)),
          I(`Glue the flag blocks in the left rear corner: ${tl(flags)}.`, ['To the inner gunwale and chine bands; the tube is held between them and the transom backer.']),
          I('Sand the glue faces (120) first and keep epoxy off the faces that get the finish.'),
        ],
        checks: ['Doublers sit on the inner band, not over a vent or scupper', 'Flag blocks line up with the tube against the transom backer'],
      };
    },
  },
  {
    id: 'finish',
    title: 'Finish: stain, epoxy, engrave, topcoat',
    kind: 'process',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['random-orbit sander', 'rollers and brushes', 'epoxy pumps', 'Shaper Origin (engraving)'],
    build: (c) => {
      const s = finishingSchedule(c.parts, c.p);
      const std = isStandard(c.p);
      return {
        goal: 'Finish everything above the underside, with all hardware off.',
        items: [
          I('Follow the finishing schedule (Finishing section).', s.steps.map((x) => `${x.n}. ${x.title}`)),
          I('The underside is already done (the Finish the underside step): this is everything else.'),
          std
            ? I('Show faces: stained first, then urethaned, once the offcut panel passed.', ['The deck underside, the end grain and the uncaptured ply edges were epoxied at assembly. Water-based dye under the urethane is the safe route.'])
            : I('Show faces: stained first, then epoxy-sealed, once the offcut panel passed.', ['The dados, edges and hidden faces were sealed at assembly. Water-based dye under the epoxy is the safe route.']),
          I('Finish the removable kits on the bench: the brake flaps and chocks, the handle U and the signs.', [
            'The tongue is NOT removable (see D-65): it stays bolted on and is finished in place.',
            'Plug or mask the pivot bores, bolt seats and sockets.',
          ], ['brake-flap-L', 'brake-flap-R', 'handle-bar', 'sign-L', 'sign-R', 'bridle-tongue']),
          I('No hardware on the sled: axles, wheels, plates, eye bolts, hinges, handle sockets and brake pins go on after the varnish cures (next step).'),
        ],
        checks: [
          'Offcut test panel approved before anything on the sled is stained',
          std ? 'Show faces stained, then urethaned; the deck underside, every uncaptured ply edge and all oak end grain epoxied' : 'Show faces stained, then epoxy-sealed; every plywood edge and all oak end grain sealed',
          std ? 'Urethane fully hard before hardware goes on' : 'Varnish fully hard before hardware goes on',
        ],
      };
    },
  },
  {
    id: 'hang',
    title: 'Hang the running gear and hardware',
    kind: 'build',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['wrenches', 'torque wrench', 'cotter-pin pliers', 'screwdrivers', 'hex keys', 'sealant gun', 'contact cement'],
    hardener: '206',
    clamp: 'Hinges, sockets and the rubber pads are bedded in sealant or contact cement; epoxy only where a part is glued. Nothing takes load until it has cured.',
    build: (c) => {
      const n = (re: RegExp): number => c.mine.filter((x) => re.test(x.id)).length;
      const ids = (re: RegExp): string[] => c.mine.filter((x) => re.test(x.id)).map((x) => x.id);
      return {
        goal: 'Put the running gear, hinges, handle and brake kits back on, for good.',
        items: [
          I('Wait until the varnish has cured: hard enough to bolt against, and 7 days before any load.'),
          I('Support the sled for the underside work.', [
            'The clamp-plate, eye-bolt and anchor nuts go on under the beams and crossmembers.',
            'Roll it onto its side on a padded blanket (two people, one side at a time), or flip it onto padded horses (four people) and back onto the wheels after.',
          ]),
          I('Running gear, from the tagged kit.', [
            `Axles in their grooves; ${plural(n(/^clamp-/), 'clamp plate')} with nylock nuts and fender washers, snug plus a quarter turn.`,
            `${plural(n(/^wheel-/), 'wheel')}, collars and cotter pins 1" beyond the hub.`,
            `Roll pads shimmed ${fin(c.p.axleProudIn)} off the beam.`,
          ], [...ids(/^(axle-|clamp-|wheel-|roll-pad-)/)]),
          I('Steering.', [
            `${plural(n(/^steer-eye/), 'eye bolt')} and ${plural(n(/^steer-anchor/), 'anchor')}, nylock nuts and 2" washers.`,
            'Check chains: 8-7/8" between rings; straight ahead each hangs 2-11/16" slack and goes taut at the lock.',
            'Bridle rope through the sleeve, once round the tongue tip, bowline round the standing part; whip the end.',
          ], ids(/^(steer-|bridle$)/)),
          I('Hinges and pins.', [
            `Seat hinges: #10-32 × 3/8 into the inserts, ${screwOf(c, 'seat-hinge-L', /hinge-backer/)} through the deck into the backer pads.`,
            `Lid hinges: ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} into the lid frame, ${screwOf(c, 'storage-hinge-L', /hinge-backer/)} into the backers.`,
            'Detent pins on lanyards; cushions on Dual Lock.',
          ], ids(/^(seat-|storage-hinge)/)),
          I(`Handle: ${plural(n(/^handle-socket/), 'socket')} bedded in sealant on the transom.`, [
            `${socketScrewText(c.parts)} per socket into the T-nuts, nylon washers under the heads.`,
            'The screw tips must stop short of the box aft wall: check with a dry screw.',
            'Then the finished U and its clevis pins.',
          ], ids(/^handle-/)),
          I('Brake flaps.', [
            'The flap kits on the knees: pivot pin in double shear, hitch-pin clip.',
            'Return cord and snap hook to the transom eye; pad and tread on contact cement; chock cords to the screw eyes.',
          ], ids(/^brake-/)),
          I('Recheck every nut before each event: oak creeps under the plates.'),
        ],
        checks: ['All four wheels spin freely, no end float beyond 1/16", the axle swings through the full lock', 'Chain goes taut at full lock before the tire touches anything', 'Hinges and pins work, the handle slides in the sockets, the flaps return by themselves'],
      };
    },
  },
  {
    id: 'final-fit',
    title: 'Final fit: grab boards, signs, hardware, lights, reflectors',
    kind: 'build',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['drill', 'hex keys', 'wrenches', 'screwdrivers', 'heat-set insert tip', 'sealant gun'],
    hardener: '206',
    clamp: 'Bedding for the standoff discs, drain nipples and backing strips: epoxy or polysulfide; do not load the grab boards until it has cured.',
    build: (c) => {
      const rest = c.mine.filter((x) => x.id !== 'hardware');
      const ids = (re: RegExp): string[] => rest.filter((x) => re.test(x.id)).map((x) => x.id);
      const grip = feat(c, 'side-L-gunwale-in', 'hole', (q) => (q.to ?? []).some((t) => /seat-grip/.test(t)));
      return {
        goal: 'Bolt on the last fittings: grab boards, signs, storage hardware, lash plates, lights and reflectors.',
        items: [
          I(`Bolt on the grab boards: ${tl(ids(/^seat-grip-[LR]$/))}.`, [
            I(`6 × 1/4" button-head cap screws each, through board, inner band, web, outer band and the stainless backing strip (${tl(ids(/^seat-grip-backing/))}, bedded on the outside).`),
            `Clamp the board on and drill all the layers through its holes with one bit${grip ? ' (positions on the inner gunwale band drawing)' : ''}.`,
            'Nut and 1-1/4" fender washer inside. Bolted, never glued.',
          ]),
          I(`Hang the signs (${tl(ids(/^sign-[LR]$/))}): 4 thumb-knob screws each (${knobText(c)}).`, ['Through the 3/16" holes, the standoff discs (epoxied to the sign back) and the web, into the inserts.']),
          I('Storage hardware.', ['Gaskets: continuous EPDM bulb, spliced at one corner.', 'Lid stay, draw latches on the transom blocks, catch plates.', 'Aft drain nipples, epoxied in.'], ids(/^storage-/)),
          I(`Lash plates: 4 × ${screwOf(c, 'lash-L1', /doubler-lash/)} stainless into each doubler.`, ['Flag tube between the blocks; 3/16" drain hole just above the deck.'], [...ids(/^lash-/), ...ids(/^flag-tube$/)]),
          I('Lights and reflectors.', ['Lamp clips snap into the bulkhead and transom hand-holds; heat-set M4 / M3 inserts.', 'Reflectors on the gunwale outer face: wipe clean, press 60 s.'], ids(/^(lamp-clip|rear-lamp-clip|front-light|rear-light|reflector-)/)),
          I('Count the pooled fasteners against the parts list: every fastener 316 stainless.', [], ['hardware']),
        ],
        checks: ['Load test: 300 lbf pull at 45° on one lash plate; hang the sled by the bowline', 'Grab boards solid; signs stay on and do not rattle', 'Lid closes on the gasket with no gap; the stay holds'],
      };
    },
  },
];

// ---- builder ----

function generic(step: number, mine: Part[]): Template {
  const groups = [...new Set(mine.map((x) => x.group))].join(', ');
  return {
    id: `step-${String(step).replace('.', '-')}`,
    title: `Model step ${step}: ${groups}`,
    kind: 'build',
    steps: [step],
    view: 'iso',
    tools: [],
    build: () => ({
      goal: 'Install the parts no other step covers.',
      items: [I(`Install: ${tl(mine.map((x) => x.id))}.`), I('Follow each part\'s joints and notes (no written step yet for this model step).')],
      checks: ['Parts fit and fasteners are tight'],
    }),
  };
}

/** The part drawings are the slow input (seconds): keep the last few per parts array and params, so the UI and the tests that rebuild the steps for the same model draw once. */
const DRAW_CACHE = new WeakMap<Part[], Map<string, PartDrawingSheet[]>>();
function cachedDrawings(parts: Part[], p: Params): PartDrawingSheet[] {
  const key = JSON.stringify(p);
  let m = DRAW_CACHE.get(parts);
  if (!m) DRAW_CACHE.set(parts, (m = new Map()));
  let hit = m.get(key);
  if (!hit) {
    if (m.size > 4) m.clear();
    m.set(key, (hit = partDrawings(parts, p)));
  }
  return hit;
}

export function assemblySteps(parts: Part[], p: Params): BuildStep[] {
  const real = parts.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload);
  const by = (id: string): Part | undefined => parts.find((x) => x.id === id);

  // 1. Hand each part to the first template that names it for its model step.
  const taken = new Map<string, string[]>();
  const assigned = new Set<string>();
  // 0. The removable hardware belongs to the hang step whatever its model step is (see the header).
  taken.set('hang', real.filter(isHangPart).map((x) => x.id));
  for (const id of taken.get('hang')!) assigned.add(id);
  for (const t of TEMPLATES) {
    if (t.id === 'hang') continue;
    if (!t.match) continue;
    const mine: string[] = [];
    for (const x of real) {
      if (assigned.has(x.id)) continue;
      if (t.steps.includes(x.step) && t.match.test(x.id)) {
        mine.push(x.id);
        assigned.add(x.id);
      }
    }
    taken.set(t.id, mine);
  }

  // 2. Templates without a `match` that take parts: the seat step takes the remaining step-5 seat parts; the final-fit step takes the rest of step 7.
  const catchAll: Record<string, (x: Part) => boolean> = {
    'seat-back': (x) => x.step === STEP.seatStorage && x.group === 'seat',
    'final-fit': (x) => x.step === STEP.finish,
    hang: () => false,
    tongue: (x) => x.step === STEP.linkage || x.step === STEP.spindles,
    'storage-box': (x) => x.step === STEP.seatStorage && x.group === 'storage',
    frame: (x) => x.step === STEP.frame || x.step === HULL_STEP.deck,
  };
  for (const [tid, test] of Object.entries(catchAll)) {
    const list = taken.get(tid) ?? [];
    for (const x of real) {
      if (assigned.has(x.id) || !test(x)) continue;
      list.push(x.id);
      assigned.add(x.id);
    }
    taken.set(tid, list);
  }

  // 3. Anything still unassigned goes to the last template of its model step, or a generated step.
  const orphans = real.filter((x) => !assigned.has(x.id));
  const extraByStep = new Map<number, Part[]>();
  for (const x of orphans) {
    const host = [...TEMPLATES].reverse().find((t) => t.kind === 'build' && t.steps.includes(x.step));
    if (host) {
      taken.get(host.id)!.push(x.id);
      assigned.add(x.id);
    } else {
      const arr = extraByStep.get(x.step) ?? [];
      arr.push(x);
      extraByStep.set(x.step, arr);
    }
  }

  // 4. Assemble the ordered template list, inserting generated steps by model step.
  const ordered: { t: Template; ids: string[] }[] = [];
  const pending = [...extraByStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, xs]) => ({ t: generic(step, xs), ids: xs.map((x) => x.id) }));
  const keyOf = (t: Template): number => t.at ?? t.steps[0];
  for (const t of TEMPLATES) {
    while (pending.length && keyOf(pending[0].t) < keyOf(t) && t.kind !== 'prep') ordered.push(pending.shift()!);
    const ids = taken.get(t.id) ?? [];
    if (t.kind === 'build' && ids.length === 0) continue; // nothing to install in this model
    ordered.push({ t, ids });
  }
  ordered.push(...pending);

  const byId = new Map(parts.map((x) => [x.id, x]));
  const nameOf = (id: string): string | undefined => { const x = byId.get(id); return x ? partLabel(x) : undefined; };
  // Computed at most once per call, and only by the steps that quote them.
  let resawMemo: ResawPool[] | undefined;
  let formsMemo: FormDrawing[] | undefined;
  let oakMemo: OakPlan | undefined;
  let cutMemo: CutList | undefined;
  let drawMemo: PartDrawingSheet[] | undefined;
  const cut = (): CutList => (cutMemo ??= cutList(parts, p));
  const resaw = (): ResawPool[] => (resawMemo ??= cut().resaw);
  const forms = (): FormDrawing[] => (formsMemo ??= formDrawings(parts, p));
  const oak = (): OakPlan => (oakMemo ??= oakBoardFeet(parts, p));
  const drawings = (): PartDrawingSheet[] => (drawMemo ??= cachedDrawings(parts, p));
  const std = isStandard(p);
  const fix = (t: string): string => tidy(std ? standardText(t) : t);
  // A token for a part this model does not have (an optional part named in a template) is written as plain words.
  const known = (t: string): string => t.replace(PART_TOKEN_RE, (m, id: string) => (byId.has(id) ? m : (id as string).replace(/-/g, ' ')));
  const prune = (items: Instr[]): Instr[] => items.map((it) => ({
    ...it, text: known(it.text),
    ...(it.parts ? { parts: it.parts.filter((id) => byId.has(id)) } : {}),
    ...(it.sub ? { sub: prune(it.sub) } : {}),
  })).map((it) => (it.parts && !it.parts.length ? (({ parts: _x, ...rest }) => rest)(it) : it));
  const steps: BuildStep[] = ordered.map(({ t, ids }, n) => {
    const mine = ids.map((i) => byId.get(i)!).filter(Boolean);
    const ctx: StepCtx = { parts, p, mine, by, resaw, forms, oak, cut, drawings };
    const built = t.build(ctx);
    const modelStep = mine.length ? Math.min(...mine.map((x) => x.step)) : t.steps[0];
    const items = mapInstr(prune(built.items), fix);
    const cure = t.hardener ? HARDENERS[t.hardener] : undefined;
    const clampCure = cure ? `${cureText(t.hardener!, t.clamp ?? 'Clamp until set.')}${std && t.kind === 'build' ? ` ${STANDARD_GLUE_NOTE}` : ''}` : undefined;
    const step: BuildStep = {
      n,
      id: t.id,
      kind: t.kind,
      title: std ? standardText(t.title) : t.title,
      goal: fix(built.goal),
      items,
      modelStep: t.kind === 'prep' ? 0 : modelStep,
      partIds: ids,
      instructions: flattenInstr(items, nameOf),
      checks: built.checks.map((x) => renderInstrText(fix(known(x)), nameOf)),
      tools: t.tools,
      view: t.view,
      ...(cure ? { cure: { hardener: cure.hardener, potMin: cure.potMin, clampHours: cure.clampHours, fullHours: cure.fullHours } } : {}),
      ...(clampCure ? { clampCure } : {}),
    };
    return step;
  });

  // Process steps inherit their position's model step (they sit between two build steps), so the list stays nondecreasing.
  // The brake knees are installed early (EARLY_STEP_IDS): their modelStep is clamped DOWN to the position they occupy and they do not raise the running step.
  let run = 0;
  for (const s of steps) {
    if (EARLY_STEP_IDS.has(s.id)) s.modelStep = run;
    else if (s.kind === 'build' && s.partIds.length) run = Math.max(run, s.modelStep);
    else if (s.kind === 'process') s.modelStep = Math.max(run, s.modelStep);
    else if (s.kind === 'prep') s.modelStep = 0;
  }
  // A build step with parts must not fall behind an earlier one.
  let hi = 0;
  for (const s of steps) {
    if (s.modelStep < hi) s.modelStep = hi;
    hi = s.modelStep;
  }
  return steps;
}

/** Part ids present after step `n` (steps with index <= n). Earlier steps solid, step `n` highlighted, later hidden. */
export function cumulativeParts(steps: Pick<BuildStep, 'n' | 'partIds'>[], n: number): string[] {
  const out: string[] = [];
  for (const s of steps) if (s.n <= n) out.push(...s.partIds);
  return out;
}

/** Ids installed by step `n` alone (the highlighted set). */
export function stepParts(steps: Pick<BuildStep, 'n' | 'partIds'>[], n: number): string[] {
  return steps.find((s) => s.n === n)?.partIds ?? [];
}

/** True when a part's joints include a glue-type joint (epoxy): used by tests to demand a clampCure. */
export function hasGlueJoint(x: Part): boolean {
  return (x.joints ?? []).some((j) => GLUE_JOINTS.has(j.type));
}
