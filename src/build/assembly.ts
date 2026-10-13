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
 * (`part-drawings.ts`). No purchasing (that is the shopping list), no param or file names, no raw part ids, no decision ids (D-n) and no decimals (readability round 2). The glue
 * details are ONE glue card (first item of the mill step); each glue step's `clampCure` is a single short line naming the glue that step uses.
 * `instructions` is the same text flattened (sub-items as "– " lines) for readers that do not know `items` yet.
 *
 * FINISH AFTER HARDWARE (build review round 1, MUST-1). The running gear, eye bolts, hinges, handle sockets and the brake kit are FITTED AND DRILLED at their own
 * steps (dry, then taken off), the hull is finished (underside before the flip, the rest after the box, seat, brake and handle), and `hang` installs them after the
 * varnish has cured. The parts in `isHangPart` therefore belong to the `hang` step, not to the step that fits them, so the step-through viewer shows them on the sled only
 * once they are really on it. The `hang` step's `modelStep` is clamped up to the finish step (the list stays nondecreasing); every other part is installed in its own model step.
 * The tongue, the beams, the kingpin and the hold-downs stay on the hull and are finished in place (D-65: the tongue is not removable).
 *
 * BRAKE KNEES GO ON BEFORE THE UNDERSIDE FINISH (build review round 2, MUST-A). The knee legs are epoxied to the rail and chine outer face and bolted through the backer, with the nylocks on a backing plate
 * under the deck: epoxy will not bond to varnish and the nuts are reachable only while the hull is inverted. The knees (and their backers, if the model installs them late) are
 * `STEP.brake` (6) in the model, but the `brake-knees` step sits between the front beam and the wheel dry fit. Its `modelStep` is clamped DOWN to the position it occupies (the running
 * model step of the steps before it), so the list stays nondecreasing and the step-through viewer shows the knees exactly when they are glued. The flaps, pins, pads and cords stay in
 * `brake-flaps` and `hang` (model step 6 and 7).
 */
import { HULL_STEP, STEP } from '../model/build-utils';
import { computeLayout, outerHalfWidth, samples, sideTopAt } from '../model/layout';
import type { AssemblyStep, Joint, Part } from '../model/types';
import { axleGrooveDepthIn, bowTaper, thinSheet, WEATHER_SPEC, type Params } from '../params';
import { screwText } from '../model/rear-mount';
import { boxTieGeometry, kneeScrews, lashBoltLength, sideRibStations, KNEE_SCREW_SEAT_IN, LASH_BOLT_DIA_IN, LASH_HOLE_DX_IN, LASH_HOLE_DZ_IN, LASH_BOLTS, LASH_WASHER } from '../model/side-ribs';
import { transformPoint, worldAABB } from '../model/bounds';
import { cutList, edgeJointUp, type CutList, type GlueUp, type ResawPool } from './cutlist';
import { epoxyTimeFactor, finishingSchedule, glueJointEstimates } from './finishing';
import { flatPattern } from './flat';
import { formDrawings, RIB_STOCK_IN, type FormDrawing } from './forms';
import { oakBoardFeet, type OakPlan } from './nesting';
import { brakeOf, partDrawings, type DrawingFeature, type PartDrawingSheet } from './part-drawings';
import { finalFrac, fractionText, nearest32, nearestTo, roughFrac } from './units';
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
const HANG_RE = /^(wheel-|axle-(R|F[LR])$|clamp-|roll-pad-|steer-(eye|anchor|chain)-|bridle$|seat-(hinge|pin|cushion|back-pad)|storage-hinge-[LR]$|handle-(socket|pin)-|brake-(pivot-pin|pivot-clip|cord|snap|pad|foot-tread|chock-cord|pin-[BT]-))/;
export const isHangPart = (x: Part): boolean => (x.kind === 'purchased' || x.kind === 'metal' || x.kind === 'printed') && HANG_RE.test(x.id);

/** Steps whose parts have a later model step than the step's position (the brake knees and backers: `STEP.brake`, but glued and bolted while the hull is inverted, before the underside finish). */
export const EARLY_STEP_IDS: ReadonlySet<string> = new Set(['brake-knees']);
const EARLY_RE = /^brake-(backer|knee)-[LR]$/;
/** The bolted knee and its backer are on the hull from the early step on. With the knee on pins (D-78, `removable`) they are bench work and never part of the hull. */
export const isEarlyBrakePart = (x: Part): boolean => EARLY_RE.test(x.id) && !x.removable;

interface Built { goal: string; items: Instr[]; checks: string[]; /** The glues the step uses, when the parts' joints do not say (a prep step). */ glue?: GlueUse; /** Tools this step needs besides the template's (D-78 pins). */ tools?: string[]; /** Replaces the template's tool list (the knee on pins needs no wrenches). */ toolsOnly?: string[] }

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
  /** Epoxy hardener of the step's glue line (`clampCure`) and of `cure`. */
  hardener?: Hardener;
  /** The step brushes an epoxy coat on (the line says "handle after", not "clamp"). */
  coat?: boolean;
  /** The glue line, when the step glues with something other than epoxy / Titebond (sealant, contact cement). */
  glueLine?: string;
  build: (c: StepCtx) => Built;
  /** A part qualifies for this template only when this says so (the knee with its pin parts, D-78, has its own text). */
  when?: (x: Part) => boolean;
  /** The step exists only for these params (the removal and refit of the knee, D-78). */
  onlyIf?: (p: Params) => boolean;
  /** The title when the knee is on pins (D-78). */
  pinsTitle?: string;
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
const f = (n: number, d = 2): string => String(+n.toFixed(d));
/**
 * A dimension for the shop: a fraction to the nearest 1/32 with the inch mark. A small value that is not on the 1/32 grid (a clearance of 0.04") is given to the nearest 1/64, so a
 * fraction never misstates a gap by a third of itself and the steps never show a decimal.
 */
export function fin(n: number): string {
  const a = Math.abs(n);
  if (a > 0 && a < 0.25 && Math.abs(nearest32(a) - a) > 0.004) return `${n < 0 ? '-' : ''}${fractionText(nearestTo(a, 1 / 64), 64)}"`;
  return finalFrac(n);
}
/** A thin strip thickness as a shop fraction (a strip planed to 0.208" is 7/32"). */
const thick = (t: number): string => finalFrac(t);
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

/** Which glues a step uses: epoxy, Titebond III, or both. */
export interface GlueUse { epoxy: boolean; titebond: boolean }

const hRange = (r: [number, number]): string => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);

/**
 * The ONE short glue line of a step (`clampCure`), naming the glue the step actually uses and pointing at the glue card: "Epoxy: clamp 8-10 h, full cure 24 h (glue card, step 1)".
 * Under 90 characters. `coat` is for a step that brushes epoxy on (a coat, not a clamped joint).
 */
export function glueLine(h: Hardener, use: GlueUse, cardStep: number, coat = false): string {
  const c = HARDENERS[h];
  const epoxy = coat ? `Epoxy coat: handle after ${hRange(c.clampHours)} h, full cure ${c.fullHours} h` : `Epoxy: clamp ${hRange(c.clampHours)} h, full cure ${c.fullHours} h`;
  const tb = 'Titebond III: clamp 30-60 min, full strength in 24 h';
  const ref = ` (glue card, step ${cardStep})`;
  if (use.titebond && use.epoxy) return `Titebond III 30-60 min, epoxy ${hRange(c.clampHours)} h; full cure ${c.fullHours} h${ref}`;
  return `${use.titebond && !use.epoxy ? tb : epoxy}${ref}`;
}

/**
 * The GLUE CARD: which glue goes where, with the working times, in one place (first item of the first glue step). Every later glue step has only its one-line `clampCure`.
 * Epoxy numbers come from the HARDENERS table (105 resin with the 206 slow hardener, which every glue-up uses) and `epoxyTimeFactor` (the cold-shop multiplier).
 */
export function glueCard(p: Params): Instr {
  const c = HARDENERS['206'];
  const k = epoxyTimeFactor(60);
  const r = (lo: number, hi: number): string => `${f(lo * k, 0)}-${f(hi * k, 0)}`;
  const std = isStandard(p);
  const slow = HARDENERS['209'];
  return I('GLUE CARD: read it once; each glue step below has one line that points back here.', [
    I(std ? 'Which glue: Titebond III for Dominos, dados, tenons and plain glue joints; epoxy for the laminations, the deck, fillets and tape, and thickened bedding.' : 'Which glue: epoxy for every glue joint (Extreme weather).'),
    ...(std
      ? [I('Titebond III:', [
        'Thin coat on both faces; open time about 10 min, so have the clamps set out.',
        'Clamp 30-60 min; full strength in 24 h.',
        'Wipe squeeze-out at once with a damp rag: dried glue blocks the stain.',
        'Do not glue below 47 °F.',
      ])]
      : []),
    I(`Epoxy (105 resin with 206 slow hardener, 5 parts resin to 1 of hardener):`, [
      `Pot life ${hRange(c.potMin)} min at 70 °F. Mix small batches in a wide, shallow container and pour leftovers thin into a tray.`,
      `Clamp ${hRange(c.clampHours)} h at 70 °F; full cure ${c.fullHours} h.`,
      `Use 206 for every glue-up. 205 fast sets before a rehearsed glue-up is closed; 209 extra slow (pot life ${hRange(slow.potMin)} min) is for a hot shop only.`,
      'Thicken with 406 filler for fillets, bedding and gap-filling; keep it thin for laminating.',
    ]),
    I('Cold shop:', [
      `At 60 °F epoxy pot life is ${r(...c.potMin)} min and the clamp time ${r(...c.clampHours)} h.`,
      'Below 55 °F epoxy will not cure: warm the shop and the parts the day before and keep them warm through the cure.',
    ]),
  ]);
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
/** All the "a to b" ranges measured from one datum, in the order they appear: `3-13/16" to 4-13/16", 7-3/8" to 8-3/8" and 10-15/16" to 11-15/16" from the rear end` gives three [from, to] pairs. */
function rangesOf(q: DrawingFeature | undefined, datum: string): Array<[number, number]> {
  if (!q?.positions) return [];
  const pair = `(?:${FR})" to (?:${FR})"`;
  const re = new RegExp(`((?:${pair}(?:, | and )?)+) from the ${datum.toLowerCase()}`, 'g');
  const out: Array<[number, number]> = [];
  for (const t of q.positions) for (const m of t.matchAll(re)) for (const v of m[1].matchAll(new RegExp(`(${FR})" to (${FR})"`, 'g'))) out.push([parseFrac(v[1]), parseFrac(v[2])]);
  return out;
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
  const gaps = c.slice(1).map((v, i) => v - c[i]);
  if (Math.max(...gaps) - Math.min(...gaps) > 0.15) return `${c.length} Dominos, centers ${list(c)} from the ${lc(datum)}`;
  const gap = (c[c.length - 1] - c[0]) / (c.length - 1);
  return `${c.length} equally spaced, centers ${fin(c[0])} to ${fin(c[c.length - 1])} from the ${lc(datum)} (about ${fin(gap)} apart)`;
}

/** A hole feature's diameter ("Ø25/64"") and its location clause. */
function holeText(q: DrawingFeature | undefined): string | undefined {
  if (!q) return undefined;
  const dia = new RegExp(`^(${FR})"`).exec(q.size ?? '')?.[1];
  const w = whereOf(q);
  return w ? `${dia ? `Ø${dia}", ` : ''}${w}` : undefined;
}

/** Every feature of part `id`'s drawing of these kinds that passes the test, in drawing order (a feature per mating part: four clamp plates are four features). */
function featsAll(c: StepCtx, id: string, kind: DrawingFeature['kind'] | DrawingFeature['kind'][], test: RegExp | ((q: DrawingFeature) => boolean) = () => true): DrawingFeature[] {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const ok = typeof test === 'function' ? test : (q: DrawingFeature) => test.test(q.text);
  return featuresOf(c, id).filter((q) => kinds.includes(q.kind) && ok(q));
}
/** "a, b and c" from ready-made fraction strings. */
const listS = (t: string[]): string => (t.length <= 1 ? t.join('') : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`);

/** The clauses of one positions entry: `1/2" and 1-3/4" from the rear face, 4-3/16" from the left end, centered across the thickness` -> two [values, datum] clauses and the tail. */
function clausesOf(pos: string): { clauses: Array<{ vals: string[]; datum: string }>; tail: string } {
  const re = new RegExp(`((?:(?:${FR})"(?:, | and )?)+) from the ([a-z]+(?: [a-z]+)?)(?=,|;|$)`, 'g');
  const clauses = [...pos.matchAll(re)].map((m) => ({ vals: [...m[1].matchAll(new RegExp(`(${FR})"`, 'g'))].map((v) => `${v[1]}"`), datum: m[2] }));
  const tail = pos.replace(re, '').replace(/[,;\s]+/g, (m) => (/[,;]/.test(m) ? ', ' : ' ')).replace(/^[,\s]+|[,\s]+$/g, '');
  return { clauses, tail };
}
const fracVal = (t: string): number => parseFrac(t.replace(/"$/, ''));

/**
 * Where ALL the instances of a hole (or other feature) kind are, from the structured positions of several drawing features: the same fore-aft / depth clause once, and the
 * varying distances together ("7/16" and 1-13/16" from the rear face, at 1-3/8" and 26-1/8" from the left end"). Features that differ in more than one distance are listed one after another.
 */
export function placesOf(fs: DrawingFeature[]): string | undefined {
  const withPos = fs.filter((q) => q.positions?.length);
  if (!withPos.length) return undefined;
  const parsed = withPos.map((q) => clausesOf(q.positions!.join('; ')));
  const same = parsed.every((q) => q.tail === parsed[0].tail && q.clauses.length === parsed[0].clauses.length && q.clauses.every((c, i) => c.datum === parsed[0].clauses[i].datum));
  const varying = same ? parsed[0].clauses.map((_, i) => i).filter((i) => parsed.some((q) => q.clauses[i].vals.join() !== parsed[0].clauses[i].vals.join())) : [];
  if (same && parsed[0].clauses.length && varying.length <= 1) {
    const v = varying[0];
    const text = parsed[0].clauses.map((c, i) => {
      if (i !== v) return `${listS(c.vals)} from the ${c.datum}`;
      const all = [...new Set(parsed.flatMap((q) => q.clauses[i].vals))].sort((a, b) => fracVal(a) - fracVal(b));
      return `${all.length > 1 ? 'at ' : ''}${listS(all)} from the ${c.datum}`;
    });
    return [...text, ...(parsed[0].tail ? [parsed[0].tail] : [])].join(', ');
  }
  return withPos.map((q) => q.positions!.join('; ')).join('; and ');
}
/** "4 holes Ø25/64" in the top face (2 at each of 2 places): ..." for all the instances of a hole kind; one feature reads like `holeText`. */
function holesText(fs: DrawingFeature[]): string | undefined {
  const where = placesOf(fs);
  if (!where) return undefined;
  const total = fs.reduce((n, q) => n + q.count, 0);
  const per = fs[0].count;
  const dia = new RegExp(`^(${FR})"`).exec(fs[0].size ?? '')?.[1];
  const face = fs[0].face && fs.every((q) => q.face === fs[0].face) ? ` in the ${fs[0].face}` : '';
  const split = fs.length > 1 && per > 1 ? ` (${per} at each of ${fs.length} places)` : fs.length > 1 ? ' (one at each place)' : '';
  return `${total > 1 ? `${total} holes ` : ''}${dia ? `Ø${dia}"` : ''}${face}${split}: ${where}`.replace(/^ /, '');
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
  return [
    I(`${cap(pool.ripText)}: ${pool.laneCountText}.`),
    I(`Then resaw each lane on edge into ${plural(k, 'slab')}: ${pool.resawHeightText}. Never stand the whole board on edge.${pool.withinCapacity ? '' : ' TOO TALL for your bandsaw: the strip is wider than the saw can cut.'}`),
    I(`That gives ${pool.stripSlots} strips for the ${strips} needed: ${pool.spares <= 0 ? 'no spare, so a strip that cracks on the form means another board' : `${plural(pool.spares, 'spare')} for the bend test`}.`),
  ];
}

/**
 * The layers of a CROSS-laminated glue-up (D-75: the brake knee), read from the cut list's own layer cuts; undefined for a block whose layers all run the same way.
 * One entry per layer, rear (face) layer first: its grain in the sled's words, the boards it is edge-glued from (rough widths across the grain, as cut) and its length along the grain.
 */
interface CrossLayer { layer: number; grain: string; widths: number[]; lengthIn: number; thicknessIn: number }
function crossLayersOf(c: StepCtx, g: GlueUp): CrossLayer[] | undefined {
  const row = c.cut().oak.flatMap((q) => q.rows).find((r) => r.ids.includes(g.partId));
  const pieces = row?.layerPieces ?? [];
  if (new Set(pieces.map((q) => q.grainWord)).size < 2) return undefined;
  const cuts = c.cut().cuts.filter((q) => q.piece === 'layer' && q.glueUp === g.label);
  return pieces.map((lp) => {
    const mine = cuts.filter((q) => q.layer === lp.layer).sort((a, b) => a.index - b.index);
    return { layer: lp.layer, grain: lp.grainWord ?? '', widths: mine.map((q) => q.rough.w), lengthIn: mine[0]?.rough.l ?? lp.lengthIn, thicknessIn: mine[0]?.rough.t ?? lp.roughT };
  });
}

/** The sub-steps that make one cross-laminated block (step 1): the boards of each layer, the one edge joint, the pocket notch, how the layers stack, and the milled size. Every number is the cut list's or the model's. */
function crossLamSubs(c: StepCtx, g: GlueUp, layers: CrossLayer[]): Instr[] {
  const part = c.by(g.partId);
  const joint = part?.stock ? edgeJointUp(part, part.stock.w) : undefined;
  const bg = brakeOf(c.p);
  const sameAs = (a: CrossLayer, b: CrossLayer): boolean => a.grain === b.grain && a.lengthIn === b.lengthIn && a.widths.join() === b.widths.join();
  const groups: CrossLayer[][] = [];
  for (const l of layers) { const hit = groups.find((q) => sameAs(q[0], l)); if (hit) hit.push(l); else groups.push([l]); }
  const nums = (ls: CrossLayer[]): string => (ls.length === 1 ? `Layer ${ls[0].layer}` : `Layers ${ls.map((q) => q.layer).join(' and ')}`);
  const rough = fractionText;
  const glued = layers.filter((q) => q.widths.length > 1);
  const centerOnly = glued.length === 1 && glued[0].layer > 1 && glued[0].layer < layers.length;
  const sub: Instr[] = [
    I(`${g.layers} layers of ${rough(layers[0].thicknessIn, 16)}", grain ${layers.map((q) => q.grain).join(' / ')}. Make ${g.qty} of these blocks.`),
    ...groups.map((ls) => {
      const l = ls[0];
      return l.widths.length > 1
        ? I(`${nums(ls)} (grain ${l.grain}): edge-glue 2 boards first, ${l.widths.map((w) => `${rough(w, 8)}"`).join(' and ')} wide \u00d7 ${rough(l.lengthIn, 8)}" long${l.widths[0] !== l.widths[1] ? ' (board 1 is the bottom edge, board 2 the top)' : ''}.`)
        : I(`${nums(ls)} (grain ${l.grain}): ONE piece, ${rough(l.widths[0], 8)}" wide across its grain \u00d7 ${rough(l.lengthIn, 8)}" long. Do not glue boards edge to edge.`);
    }),
    ...(joint !== undefined && glued.length
      ? (() => {
          const shoulder = bg.knee.zLeg - bg.knee.zBot, rel = joint - shoulder;
          const where = Math.abs(rel) < 1 / 32 ? 'level with the shoulder' : `${fin(Math.abs(rel))} ${rel > 0 ? 'above' : 'below'} the shoulder`;
          return [I(`${centerOnly ? 'Only the center layer is edge-glued' : `Only ${glued.length === 1 ? `layer ${glued[0].layer}` : 'the layers that need it'} ${glued.length === 1 ? 'is' : 'are'} edge-glued`}: its joint is ${fin(joint)} up from the bottom edge of the finished knee (${where})${bg.pins ? '' : ', clear of the bolt holes'}. The upright layers are glued over it.`)];
        })()
      : []),
  ];
  const upr = layers.find((q) => /upright/.test(q.grain)), acr = layers.find((q) => !/upright/.test(q.grain));
  if (upr && acr) {
    const sum = (q: CrossLayer): number => q.widths.reduce((a, b) => a + b, 0);
    const dUp = (upr.lengthIn - sum(acr)) / 2, dSide = (acr.lengthIn - sum(upr)) / 2;
    const r16 = (v: number): string => rough(Math.round(Math.abs(v) * 16) / 16, 16);
    const stand: string[] = [];
    if (Math.abs(dUp) > 0.01) stand.push(`the ${dUp > 0 ? 'upright layers stand' : 'center layer stands'} out about ${r16(dUp)}" at the top and the bottom`);
    if (Math.abs(dSide) > 0.01) stand.push(`the ${dSide > 0 ? 'center layer stands' : 'upright layers stand'} out about ${r16(dSide)}" on each side`);
    sub.push(I(`Epoxy the layers face to face, with the center layer centered on the outer ones${stand.length ? ` (${stand.join('; ')})` : ''}: the block is not a rectangle until it is milled.`));
  } else sub.push(I('Epoxy the layers face to face, centered on each other: the block is not a rectangle until it is milled.'));
  sub.push(I(`The upright layers run long grain from the bottom of the leg to the top, so the ${bg.pins ? 'leg cannot split at the pin hole' : 'bolted leg cannot split off the rail'}; the center layer runs across the sled. Use quartersawn or rift boards if you can.`));
  if (part?.partNo === 'brake-knee') {
    const pv = bg.pivot, kn = bg.knee;
    const front = kn.layers[kn.layers.length - 1];
    sub.push(I(`Cut the flap pocket in the rear layer (layer 1) and the center layer (layer 2) BEFORE the glue-up: a ${fin(pv.ySlot[1] - pv.ySlot[0])}-wide notch in from the outboard edge, ${fin(pv.zPocketBot - kn.zBot)} to ${fin(pv.zPocketTop - kn.zBot)} up from the bottom edge of the finished knee.`, [
      'Mark the finished knee\'s bottom and outboard edges on each layer first: the layers are oversize, so measure from those marks.',
      'Bandsaw it and chisel the corners square; line the two notches up when you stack the layers.',
      `Leave the front layer whole: the pocket is recessed about ${fractionText(Math.round(Math.max(0, pv.slotEndX - front.x0) * 16) / 16, 16)}" into it after the glue-up, when the knee is shaped.`,
    ]));
  }
  sub.push(I(`Mill the cured block to ${g.finalText} (T \u00d7 W \u00d7 L) before it is sawn to shape.`));
  return sub;
}

/** The board a part is milled from ("8/4"): the BOARD COLUMN of the cut list, never the model's raw rough thickness (a transposed `rough` once named a 16/4 board nobody sells). */
const boardOf = (c: StepCtx, id: string): string => {
  const row = c.cut().oak.flatMap((g) => g.rows).find((r) => r.ids.includes(id));
  if (row?.lamination) {
    const g = c.cut().glueUps.find((q) => q.ids.includes(id));
    if (g && crossLayersOf(c, g)) return `cross-laminated block (glued above), milled to ${g.finalText} before it is sawn`;
    return `laminated block, ${row.lamination.text}`;
  }
  return row?.board ?? '?';
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

/** The handle-socket screws from the joint size text: `2 × 1/4-20 × 1-1/4" stainless button-head cap screws` (count, thread, length and kind all from the model). */
export function socketScrewText(parts: Part[]): string {
  const j = parts.find((x) => x.id === 'handle-socket-L')?.joints?.find((q) => q.type === 'bolt');
  const m = /^(\S+)\s×\s(\S+)\s+(.*?)\b([a-z]+-head cap screws?)/.exec(j?.size ?? '');
  return j && m ? `${j.count} × ${m[1]} × ${m[2]}"${/stainless/.test(m[3]) ? ' stainless' : ''} ${m[4]}` : 'the 1/4-20 button-head cap screws';
}

/** Where a handle socket sits on the transom, from the two parts' bounds: distance of its center off the centerline, of its outer edge in from the transom's side edge, and its ends up from / down from the transom's edges. */
export function socketOnTransom(parts: Part[]): { off: number; inset: number; up: number; down: number } | null {
  const t = parts.find((x) => x.id === 'transom-rear');
  const s = parts.find((x) => x.id === 'handle-socket-L');
  if (!t || !s) return null;
  const tb = worldAABB(t), sb = worldAABB(s);
  return { off: (sb.min[1] + sb.max[1]) / 2, inset: tb.max[1] - sb.max[1], up: sb.min[2] - tb.min[2], down: tb.max[2] - sb.max[2] };
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

/** Safety net: decision ids (D-n, A-n) never appear in shop text; "(see D-65)" and a bare "D-65" are dropped. */
export function noIds(t: string): string {
  return t.replace(/\s*\((?:see )?[DAQS]-\d+[^)]*\)/g, '').replace(/\s*\b[DQ]-\d+\b/g, '');
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
          I(`Before the shopping list goes out: do these ${plural(before.length, 'check')} (how to do each is in the Verify section).`, before.map((v) => v.title)),
          I(`Before the first cut: do ${plural(cutting.length, 'more check')}.`, cutting.map((v) => v.title)),
          I('The wheel and axle notes are in the Verify section.'),
          I('Enter every measured value in the design and re-run the checks before going on.'),
        ],
        checks: ['Every check above is done, with its measured value entered in the design', 'The checks re-run clean after the values went in'],
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
    hardener: '206',
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
      // A cross-laminated block (the brake knee, D-75) has its own full recipe below; it is not listed again as a plain edge-glued panel.
      const crossOf = new Map(face.map((g) => [g, crossLayersOf(c, g)] as const));
      const edgeShown = edge.filter((g) => !crossOf.get(g));
      const lamText = (id: string): string => c.oak().laminated.find((q) => q.id === id)?.lamination.text ?? `${face.find((g) => g.ids.includes(id))?.layers ?? 3} layers`;
      const std = isStandard(c.p);
      const b = (id: string): string => boardOf(c, id);
      return {
        goal: 'Turn the boards into rough parts, glued blocks and bending strips, ready for the joinery.',
        glue: { epoxy: !std || face.length > 0, titebond: std && edge.length > 0 },
        items: [
          glueCard(c.p),
          I('Mill every solid oak part to its rough size in the cut list.', [
            'The cut list already has the rough sizes, rounded up to 1/8" and with the allowances in.',
            `The rule: a plain part is ${fin(allow)} thicker, ${fin(c.p.roughWidthAllowanceIn)} wider and ${fin(c.p.roughLengthAllowanceIn)} longer than finished.`,
            `A glued-up piece (laminated layers, edge-glued boards, bent strips) is ${fin(c.p.laminateWidthAllowanceIn)} wider and ${fin(c.p.laminateLengthAllowanceIn)} longer, because it comes out of the clamps askew.`,
            face.length ? `A glued block loses ${fin(c.p.laminationCleanupIn)} of thickness to jointing and planing after the glue-up.` : false,
            `A board gives less than its name: 4/4 planes to ${fin(c.p.boardYield44In)}, 5/4 to ${fin(c.p.boardYield54In)}, 6/4 to ${fin(c.p.boardYield64In)}, 8/4 to ${fin(c.p.boardYield84In)}.`,
            'Sticker what is not used today and keep it at 6-9 % moisture.',
          ]),
          ...(face.length
            ? [I('Face-laminate the thick parts before anything is notched, bored or slotted.', [
              ...face.map((g) => {
                const cross = crossOf.get(g);
                return cross
                  ? I(`${tl(g.ids)}: cross-laminated, like plywood.`, crossLamSubs(c, g, cross))
                  : I(`${tl(g.ids)}: ${lamText(g.ids[0])}${g.kind === 'both' ? ', each layer edge-glued from boards' : ''}.`);
              }),
              'Plane each layer to its rough thickness (cut list, layer table).',
              ...(face.some((g) => g.kind === 'both' && !crossOf.get(g)) ? ['Edge-glue any wide layer first.'] : []),
              'Epoxy the layers face to face: 206 slow, thickened a little with silica.',
              'Clamp flat between cauls, ends and edges flush; cure overnight.',
              'Mill the cured block to its final size. From then on it is solid oak.',
            ])]
            : []),
          edgeShown.length
            ? I('Edge-glue the wide panels: they must cure before the planer and the Shaper.', [
              ...edgeShown.map((g) => I(`${tl(g.ids)}: ${plural(g.edgeBoards, 'board')} across.`)),
              `Rip each board ${fin(c.p.laminateWidthAllowanceIn)} wider than its share and joint the mating edges.`,
              `Glue with cauls (${std ? 'Titebond III' : '206 epoxy'}), then plane to thickness and trim to the cut-list size.`,
            ])
            : I(edge.length ? 'No other part is wider than a board: no more panel glue-ups.' : 'No part is wider than a board: no panel glue-ups.'),
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
      const webRow = c.cut().sheets.flatMap((g) => g.rows).find((r) => r.ids.includes('side-L-web'));
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
      const stackSaid = railSteps.flatMap((q) => [q.text, ...(q.sub ?? []).map((t) => t.text)]).map((t) => /(\d+) layers (?:in all, a stack|make a stack) ([\d\-/]+)" tall/.exec(t)).find(Boolean);
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
            ? I('Cut each side web as ONE piece from a full 4\' × 8\' sheet.', [
              webRow
                ? `Start from a ${roughFrac(webRow.stock.l)} blank (cut list); the Shaper file cuts the flat development net, ${finalFrac(webRow.final.l)} long, so the difference is the trim.`
                : `The file cuts the flat development; the cut list has the blank size.`,
              'Nest the blank per the nesting drawing, then cut net from the file.',
              'The seat back comes from the deck offcut.',
            ], ['side-L-web', 'side-R-web'])
            : I('Side webs: one piece each from a full 4\' × 8\' sheet.'),
          formLen !== undefined
            ? I(`Build the rail form (rail form drawing): ${fin(formLen)} long. One form serves both rails.`, railSteps.length ? railSteps : [
              `${cap(layersText)}.`,
              `Its face is the rails' outer plan curve: ${fin(t.turnIn)} turn-in each side, tightest radius ${t.minRadiusIn > 1e6 ? 'none' : `${f(t.minRadiusIn, 0)}"`}.`,
              'Every clamp bears on the full strip width.',
            ])
            : I('Rail form: no bow turn-in at this design, so the rails are straight and need no form.', ['Glue them flat on the bench with cauls.']),
          rise !== undefined && rampLen !== undefined
            ? I(`Build the S-ramp for the sides (side form drawing): rise ${fin(rise)}, ${fin(rampLen)} long from the start of the S to the bow end, ${f(ribs ?? 0, 0)} MDF ribs under a 1/4" hardboard cap.`, sideSteps.length ? sideSteps : [
              `Ribs of ${fin(RIB_STOCK_IN)} MDF, about 4-1/2" apart.`,
              'Build the MIRROR ramp for the second web face: never the same ramp, the cured web would have to bend back.',
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
    coat: true,
    build: (c) => {
      const std = isStandard(c.p);
      return {
        goal: std ? 'Epoxy the few surfaces water can reach and nobody can reach later; the show faces stay bare.' : 'Epoxy-seal the hidden faces and edges before assembly; the show faces stay bare.',
        items: [
          std
            ? I('Weather spec: Standard (garage-kept, wet at most at a rainy derby).', [
              'Glue: Titebond III for the Dominos, dados, tenons and plain glue joints.',
              'Epoxy only for the bent and face laminations, the deck to the frame and its dados, the fillets and tape, and thickened bedding.',
              'Topcoat: exterior spar urethane.',
              '(Extreme weather, stored outside: epoxy for every glue joint and a marine topcoat.)',
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
          I(`Check the deck still enters its dado: the dado is the deck thickness plus about ${fin(c.p.deckSlopIn)}.`, ['Use a feeler gauge.']),
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
        glue: { epoxy: true, titebond: false },
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
          I('Glue each hanger to its rail\'s inboard face, rails flat on the bench.', ['Side grain to side grain, the hanger notch in line with the rail notch.', 'Clamp it on until the glue sets.'], [...ids, 'rail-L', 'rail-R']),
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
    build: (c) => {
      const brakeBackers = c.mine.filter((x) => /^brake-backer-[LR]$/.test(x.id));
      const brakePlates = c.mine.filter((x) => /^brake-backplate-[LR]$/.test(x.id));
      const plateRecess = feat(c, 'brake-backer-L', 'groove', /recess/);
      const plateHoles = feat(c, 'brake-backplate-L', 'hole');
      const plateBox = brakePlates[0] ? worldAABB(brakePlates[0]) : undefined;
      const plateStock = plateBox ? [0, 1, 2].map((k) => plateBox.max[k] - plateBox.min[k]).sort((x, y) => x - y).map(fin).join(' × ') : undefined; // T × W × L
      const angle = maxTaperAngleDeg(c.p);
      const kingBore = feat(c, 'king-beam', 'hole', (q) => (q.to ?? []).includes('kingpin'));
      const kneeHoles = feat(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /^brake-knee/.test(t)));
      const joistDom = feat(c, 'joist-2', 'mortise', /domino/i);
      const joistCut = c.by('joist-1');
      const pb = brakeOf(c.p).pins?.B;
      const pt0 = brakeOf(c.p).pins?.T;
      const pf = brakeOf(c.p).pins?.flange;
      const hinge = c.mine.filter((x) => /^seat-hinge-backer-/.test(x.id)).map((x) => x.id);
      const crossIds = c.mine.filter((x) => /^(joist-|king-beam)/.test(x.id)).map((x) => x.id);
      return {
        goal: 'Glue the crossmembers between the rails and bond the deck on top, as one flat unit.',
        items: [
          ...(hinge.length ? [I(`The day before: epoxy the seat-hinge backers to the deck underside: ${tl(hinge)}.`, ['Butt each against the face of {{joist-3}} so the latch pin lands in solid oak.'])] : []),
          ...(brakeBackers.length
            ? [
            I(`The day before: prepare and glue the brake knee backers to the rail inboard face and the deck underside: ${tl(brakeBackers.map((x) => x.id))}.`, [
              I('First, on the bench: cut the plate recess in the inboard face of each brake knee backer, before it is glued.', [
                plateRecess ? `${plateRecess.size ?? 'Flat-bottomed recess'}: ${whereOf(plateRecess)}.` : `Flat-bottomed recess for the plate: ${SEE}.`,
                'Router with a fence, or saw the edges and chisel the waste out to an even depth.',
                'The plate must lie flush with the face: test it in the recess before gluing.',
              ]),
              'Keep them clear of the axle hanger; the crossmember that meets a backer is cut back 3/4" and butts its face.',
              `Drill the 4 knee-bolt holes (3/8" bolts) through rail and backer together, from the rail drawing, measured from the finished rear end: ${kneeHoles ? holeText(kneeHoles) : SEE}.`,
              'The same holes on the right rail, mirrored.',
            ], brakeBackers.map((x) => x.id)),
            ...(brakePlates.length
              ? [I(`Make the two stainless backing plates for the knee nuts: ${tl(brakePlates.map((x) => x.id))}.`, [
                `${plateStock ? `${plateStock} stainless plate` : 'Stainless plate'}, set flush in its recess in the backer's inner face. Cut it from 2" flat bar on the metal bandsaw and deburr the cut edges.`,
                plateHoles ? `4 holes on the knee-bolt pattern, ${holeText(plateHoles)}; clamp each plate in its backer's recess and drill through the backer's holes.` : 'Clamp each plate in its recess and drill its 4 holes through the holes in the backer.',
                'The nylock nuts bear on this plate, so it spreads the bolt pull over the oak (four fender washers would overlap).',
              ], brakePlates.map((x) => x.id))]
              : [])]
            : []),
          ...(pb && pf && pt0 && c.parts.some((x) => /^brake-sleeve-B-hull-/.test(x.id))
            ? [I('The day before: prepare the eight pin sleeves, then drill the bottom-pin hole through each rail.', [
              I('Prepare the sleeves (four flanged bushings for the hull, four tube pieces for the knees).', [
                `Cut each to its length on the metal bandsaw and deburr the ends: ${listS([`the rail bushing ${fin(pb.hullSleeve.len)}`, `the rib bushing ${fin(pt0.hullSleeve.len)}`, `the knee leg sleeve ${fin(pb.kneeSleeve.len)}`, `the tab sleeve ${fin(pt0.kneeSleeve.len)}`])}. A bought bushing is longer than needed: the cut-off end is the plain end, never the flange.`,
                'Stock 1/2" tube and stock bushings are usually a few thousandths too tight for a 3/8" pin. Open each bore with a .377 to .378 inch reamer on the drill press at slow speed, the piece held in a V-block or a drill-press vise, with a drop of oil. This only opens the bore of a bought bushing or tube a couple of thousandths; nothing is shaped. Or buy bushings that are already bored for a 3/8" pin.',
                'Order ONE pin first. Try it in a reamed sleeve: it should slide in by hand and rattle a little (about five thousandths of an inch of play). Order the rest of the pins and bushings only when that fit is right.',
              ]),
              I('Drill the hole through each rail on the drill press, with the rail laid flat, outboard face down, its top edge against a fence.', [
                `The hole is ${fin(pb.belowRailTop)} down from the rail's top edge (the fence sets it) and ${fin(pb.fromRailRear)} from the finished rear end. The rail is still 1/2" long at the rear end, so measure from a pencil line 1/2" in from the end of the rail as it is now (${fin(pb.fromRailRear + 0.5)} from the end), and clamp a stop block there.`,
                'Support the long free end on a roller stand set to the table height. If the rail will not reach the drill press, clamp a drill block (a hardwood scrap drilled square through) to the outboard face and drill with a hand drill, square to the face.',
                `First the counterbore for the bushing's flange, from the inboard face (the face that is up): a ${fin(pf.cboreDia)} Forstner, ${fin(pf.cboreDepth)} deep, centered on the hole.`,
                `Then the hole itself: a 5/8" bit straight through the rail's 3/4" thickness. It is oversize on purpose: the bushing is bedded in epoxy at the knee step with the real knee pinned on, so it lines up with the knee's own sleeve whatever the layout error.`,
                'Clamp a scrap under the exit face so the bit does not tear the oak. The right rail gets the same hole and counterbore, measured from its rear end.',
              ]),
              I('Leave the bushings out. They are bedded in the rails at the knee step (the hull is inverted then, so the inboard face is reachable).'),
            ], [])]
            : []),
          I('Bore the {{king-beam}} for the kingpin, and cut the nut slot, before the deck goes on.', [
            kingBore ? `${fin(c.p.kingpinDiaIn)} hole, square on the drill press: ${whereOf(kingBore)}.` : `${fin(c.p.kingpinDiaIn)} hole, square on the drill press: ${SEE}.`,
            'Nut slot from the front face, about 1" × 3/4" at the top.',
          ]),
          I('Dry-fit the rails (still 1/2" long at both ends), the crossmembers and the king beam on Dominos.', [
            joistDom?.positions?.length ? `Crossmember Dominos (5×30), at both ends of each crossmember: ${joistDom.positions.join('; ')}.` : 'Crossmember Dominos (5×30) at both ends of each crossmember.',
            joistCut ? 'The {{joist-1}} ends go into the hanger mortises, not the rails.' : false,
            `In the bow taper the ends meet the bent rails at up to ${f(angle, 0)}°: the cut-list lengths are the long point, so scribe each end to its rail now (pencil from the rail, then bandsaw or miter).`,
          ], crossIds),
          I('Glue-up: Domino the crossmembers to the rails, then bond the sealed {{deck}} on top.', [
            'Thickened epoxy (406) on every top face: rails, crossmembers and king beam.',
            'Weight the deck down; it bonds full length to the rail and crossmember tops.',
            'The rails stay long; the deck edge follows the web plan.',
          ]),
        ],
        checks: ['Frame square: diagonals equal within 1/16"', 'Deck flat under a straightedge (no twist or rocking)', 'Squeeze-out cleaned off the deck edge before it reaches the slot under the bands', ...(pb && pf ? ['The two rail holes the same distance from the rear ends and from the top edges, each with its counterbore on the inboard face', 'Every sleeve reamed and tried with the first pin'] : [])],
        ...(pb && pf ? { tools: ['5/8" bit', `${fin(pf.cboreDia)} Forstner`, 'fence and stop block', 'reamer (.377 to .378 inch)', 'metal bandsaw'] } : {}),
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
    build: (c) => {
      const backers = c.mine.filter((x) => /^sign-backer/.test(x.id));
      const webL = c.by('side-L-web');
      const web0 = webL ? worldAABB(webL).min[0] : 0;
      const bL = backers.filter((x) => /-L\d$/.test(x.id)).map((x) => worldAABB(x)).sort((a, b) => a.min[0] - b.min[0]);
      const ins = feat(c, 'sign-backer-L1', 'hole', /insert/);
      const cleat = c.forms().find((d) => d.id === 'side-form')?.dims.find((q) => q.key === 'cleat-spacing')?.valueIn;
      return {
        goal: 'Glue the inner bands and the sign backers to each web while the web is bent over the S-ramp.',
        items: [
          I('Per side, glue the inner chine band and the inner gunwale band full-face to the inside of the web.', [
            'Thickened epoxy; no grooves.',
            'Bend web and bands together over the S-ramp (side form drawing).',
            'Clamp the bands to the web every 4-1/2" with spring clamps or small C-clamps.',
          ], ['side-L-web', 'side-L-chine-in', 'side-L-gunwale-in', 'side-R-web', 'side-R-chine-in', 'side-R-gunwale-in']),
          I('Leave the deck rabbet: the inner chine band stops short of the web bottom.', [
            `The gap is the deck thickness plus about ${fin(c.p.deckSlopIn)}: use a deck offcut plus a shim as the spacer stick. Nothing is routed.`,
          ]),
          I('Cleat the sheer line before the glue goes on.', [cleat ? `Cleat blocks screwed into the sacrificial table about ${fin(cleat)} apart, the whole length (side form drawing).` : 'Cleat blocks screwed into the sacrificial table, the whole length (side form drawing).', 'An edge-bent band pushes about 65 lbf sideways until the epoxy cures.']),
          backers.length
            ? I(`Glue the sign backers inside each web: ${plural(backers.length / 2, 'strip')} per side, grain vertical.`, [
              bL.length ? `Forward of the web's rear end: ${bL.map((q) => `${fin(q.min[0] - web0)} to ${fin(q.max[0] - web0)}`).join(', and ')}.` : SEE_ITEM,
              'Top edge just under the inner gunwale band.',
              ins ? `Two #10-32 inserts each, epoxied: ${whereOf(ins)}.` : 'Two #10-32 inserts each.',
            ], backers.map((x) => x.id))
            : I('No sign backers in this model.'),
          I('Left and right in turn: two cures per side, four in all.', ['This first face goes on the S-ramp; the second face (next step) goes on the mirror ramp (side form drawing).']),
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
        glue: { epoxy: true, titebond: false },
        items: [
          I('Per side, glue the outer chine band and the outer gunwale band to the outside face.', [
            'The chine band bottom is flush with the deck underside level: it rests on the rail.',
            'The gunwale band bends on edge to the sheer and across its thickness to the S, both at once.',
            'Flip the web over onto the MIRROR ramp for this second face (never the same ramp: the cured web would have to bend back), sheer line against the cleats.',
            'Same cleats and clamp spacing as cure 1.',
          ], ['side-L-chine', 'side-L-gunwale', 'side-R-chine', 'side-R-gunwale']),
          I('Fill the gap at the top: the web stops 1/8" under the gunwale band top.', ['Thickened epoxy, then trim flush.']),
          I('If you scarf a band (8:1), place the joint well.', ['Middle third of the band only.', 'Never in the first 4" behind the transom, nor under the grab boards, the rib heads or signs.', 'Stagger it 12" from the joint in the band on the same face.']),
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
          I(`Check the deck slot: ${fin(c.p.deckSideClearIn)} a side to each web.`, ['Pare the deck edge if it binds; thickened epoxy fills the slot later.']),
          I('Measure and trim everything to one length.', [
            'Measure from the rear transom dado to the bow bulkhead dado, both sides.',
            `Cut the bands and webs to that length less 1/32"${net !== undefined ? ` (the webs came off the Shaper at ${fin(net)})` : ''}.`,
            'Trim the rails (left 1/2" long) to match: flush-cut saw or oscillating multi-tool, blade flat on the deck underside, then pare to the line.',
          ], ['rail-L', 'rail-R']),
          I('NOW cut the rail-end mortises in the trimmed rail ends.', [
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
    build: (c) => {
      const { key: tieKey, total: dom } = chineTie(c.parts);
      const railScrew = c.by('rail-L')?.joints?.find((j) => j.type === 'screw' && /chine/.test(j.to));
      const screw = /#\d+ × [\d\-\/]+/.exec(railScrew?.size ?? '')?.[0];
      const pilots = featuresOf(c, 'rail-L').filter((q) => q.kind === 'hole' && (q.to ?? []).some((t) => /chine/.test(t)));
      const xs = [...new Set(pilots.flatMap((q) => stations(q, 'REAR end')))].sort((a, b) => a - b);
      const cbore = /counterbore the head ([\d.\-\/]+"?) up the rail/.exec(railScrew?.size ?? '')?.[1];
      return {
        goal: 'Glue the frame + deck unit into the inverted sides for good.',
        glue: { epoxy: true, titebond: isStandard(c.p) },
        items: [
          I(`Bed the ${fin((c.by('side-L-chine')?.stock?.t ?? 0.234) + (c.by('side-L-web')?.stock?.t ?? 0.157))} bearing face (outer band + web edge) of each side on its rail in epoxy.`, [], ['rail-L', 'rail-R']),
          I(`Fit the ${dom} Dominos (${tieKey}, every 6", ${f(dom / 2, 0)} per side) in the rail-top mortises, then lower the unit straight down (two people).`),
          I('Fill the deck slot at each web with thickened epoxy.', ['The deck edge rises under the inner chine band.']),
          I(`Screw up through the rails into the chine bands, BETWEEN the Dominos${screw ? `: ${screw}" flat-heads, piloted` : ''}.`, [
            xs.length ? `Pilots at ${list(xs)} from the rear end.` : SEE_ITEM,
            ...(cbore ? [`Counterbore the aft heads ${/"$/.test(cbore) ? cbore : `${fin(Number(cbore))}`} up the rail (the rail is deeper there); the bow screws need none.`] : []),
            'Never on a Domino: the screw would hit the mortise.',
            'Clamp the chine bands to the rails between the Dominos while the glue sets.',
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
    build: (c) => {
      const backers = c.mine.filter((x) => /backer/.test(x.id)).map((x) => x.id);
      const bands = count(c, 'glue');
      const sockHoles = feat(c, 'handle-socket-L', 'hole', (q) => (q.to ?? []).includes('transom-rear') && !/access hole/i.test(q.text));
      const sockAt = stations(sockHoles, 'BOTTOM end');
      const sockEdge = sockHoles ? new RegExp(`(${FR})" from the outboard edge`).exec((sockHoles.positions ?? []).join('; '))?.[1] : undefined;
      const place = socketOnTransom(c.parts);
      const tnuts = feat(c, 'transom-backer-L', 'hole', (q) => /T-nut/i.test(q.purpose ?? q.text));
      return {
        goal: 'Close the rear of the hull: backers on the transom, then the transom onto the hull in one glue-up.',
        items: [
          I('Bench, the day before: drill the handle-socket holes through the {{transom-rear}} and the backers.', [
            place ? `Both sockets: centered ${fin(place.off)} either side of the centerline (the outer edge ${fin(place.inset)} in from the transom's side edge), the bottom end ${fin(place.up)} up from the transom's bottom edge.` : false,
            'Hold a socket there and drill through its screw holes.',
            sockAt.length ? `On the socket the holes are ${list(sockAt)} up from its bottom end${sockEdge ? `, ${sockEdge}" from its outboard edge` : ''}.` : false,
          ]),
          I('Set a captive 1/4-20 T-nut per socket screw in each backer, from its inside face, before the backer is glued.', [
            tnuts?.positions?.length ? `T-nut barrel holes in each backer: ${holeText(tnuts)}.` : false,
            'The socket screws then drive in from outside: no wrench ever has to reach behind the storage box.',
          ]),
          I(`Glue the backers (3/4" oak) full-face to the inside of the transom: ${tl(backers)}.`, ['Clamp them with a caul and leave them overnight.']),
          I('Close ONE end first: the transom.', [
            'It slides onto the deck edge, both web ends (their dados are open at the top), the rail tenons and the four band ends per side (epoxy fillet butts, no Dominos).',
            `${plural(bands, 'glue joint')} and ${plural(count(c, 'mortise-tenon'), 'mortise-and-tenon')} in one glue-up.`,
            'Two pipe clamps along the length.',
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
    build: () => ({
      goal: 'Close the bow with the bulkhead, the rider\'s foot brace.',
      items: [
        I('Fit the {{bow-bulkhead}}: its rear face is the rider\'s foot brace.', [
          'Dados open at the top take the web ends; the deck dado run into them takes the deck edge.',
          'Dominos into the rails; the four band ends per side butt with an epoxy fillet.',
        ]),
        I('Glue it with a second, fresh small batch of 206, once the transom epoxy has kicked (3-6 h).', ['Wide shallow container, a second person mixing.', 'Two pipe clamps along the length.', 'Fillet the inside corners with thickened epoxy.']),
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
      const plateHoles = featsAll(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const holdHoles = featsAll(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t)));
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
            holesText(plateHoles) ? `Clamp-plate bolts, both ends: ${holesText(plateHoles)}.` : `Clamp-plate bolts: ${SEE}.`,
            holesText(holdHoles) ? `Hold-down bolts, both ends: ${holesText(holdHoles)}.` : `Hold-down bolts: ${SEE}.`,
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
      const plate = featsAll(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const pads = featsAll(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^roll-pad/.test(t)));
      const eyes = featsAll(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^steer-eye/.test(t)));
      const anchors = featsAll(c, 'joist-6', 'hole', (q) => (q.to ?? []).some((t) => /^steer-anchor/.test(t)));
      const disc = feat(c, 'king-beam', 'hole', (q) => (q.to ?? []).includes('king-thrust'));
      return {
        goal: 'Hang the front beam on its kingpin, then fit and drill the stub axles, roll pads and eye bolts and take them off.',
        items: [
          I('Screw the {{king-thrust}} to the {{king-beam}}: three #8 flat-heads, counterbored from the disc side.', [disc ? `Pilots ${holeText(disc)}.` : SEE_ITEM]),
          I('Drill and groove the {{beam-F}}.', [
            kp ? `Kingpin hole: ${fin(c.p.kingpinDiaIn)}, square on the drill press, ${whereOf(kp)}.` : `Kingpin hole: ${SEE}.`,
            `Stub-axle grooves: ${fin(c.p.axleDiameterIn)} wide × ${fin(axleGrooveDepthIn(c.p))} deep in the top face${grooveLen ? `, ${grooveLen}" in from each end` : ''}, so the ${axleWord(c.p)} stands ${fin(c.p.axleProudIn)} proud.`,
            holesText(plate) ? `Clamp-plate bolts, ${plate.length} plates: ${holesText(plate)}.` : false,
            holesText(eyes) ? `Eye-bolt holes, fore-aft, one near each end: ${holesText(eyes)}.` : false,
          ]),
          I(`Hang the beam on the {{kingpin}}: ${fin(c.p.kingpinDiaIn)} grade 8 bolt, head and plate washer under the beam.`, [
            'Up through the beam, the disc and the king beam.',
            'Nylock nut and washer in the slot in the king beam: snug, then back off a quarter turn so the beam swings freely.',
            'The beam, disc and kingpin stay on for finishing (mask the head and the slot).',
          ]),
          I('FIT AND DRILL, then take off: the stub axles, clamp plates and roll pads.', [
            I('Stub axles in their grooves ({{axle-FL}}, {{axle-FR}}); two clamp plates per end, bolted as at the rear.'),
            I(`Roll pads ({{roll-pad-L}}, {{roll-pad-R}}) beside the grooves, shimmed ${fin(c.p.axleProudIn)} off the beam${holesText(pads) ? `; pilots, both pads: ${holesText(pads)}` : ''}.`),
            'Running gap under the rail 1/32" to 1/8", set with tape.',
            'Drill every hole, dry-assemble, check the lock, remove.',
          ]),
          I('Drill the steering eye-bolt holes now, while the underside is up.', [
            I(`Anchor holes in {{joist-6}} (the chain crossmember), fore-aft, one near each end${holesText(anchors) ? `: ${holesText(anchors)}` : ''}.`),
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
    pinsTitle: 'Brake knees: tab, pin holes and sleeves (the knee is not glued to the hull)',
    kind: 'build',
    steps: [STEP.brake, STEP.frame],
    at: STEP.gear,
    match: /^brake-(backer|knee|tab|sleeve-B-knee|sleeve-B-hull|sleeve-T-tab)-[LR]$/,
    when: (x) => x.step !== STEP.frame || /sleeve-B-hull/.test(x.id), // the bolted backers stay in the frame step; only the rail bushings come from it
    view: 'under',
    tools: ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '206',
    build: (c) => {
      const knees = c.mine.filter((x) => /^brake-knee-[LR]$/.test(x.id)).map((x) => x.id);
      const backers = c.mine.filter((x) => /^brake-backer/.test(x.id));
      const framed = c.parts.some((x) => /^brake-backer/.test(x.id) && x.step <= HULL_STEP.deck);
      const bolts = feat(c, 'brake-knee-L', 'hole', (q) => (q.to ?? []).some((t) => /^rail-/.test(t)));
      const corner = feat(c, 'brake-knee-L', 'outline', (q) => q.angleDeg !== undefined);
      const kneeFinal = c.cut().glueUps.find((q) => q.ids.includes('brake-knee-L'))?.finalText ?? 'its final size (cut list)';
      const bgk = brakeOf(c.p), pkv = bgk.pivot, pkn = bgk.knee;
      const kneeTall = pkn.zTopLeg - pkn.zBot, pocketW = pkv.ySlot[1] - pkv.ySlot[0], pocketH = pkv.zPocketTop - pkv.zPocketBot, pocketDeep = pkv.slotEndX - pkn.x0;
      const intoFront = Math.max(0, pkv.slotEndX - pkn.layers[pkn.layers.length - 1].x0);
      const cornerPts = corner ? (corner.positions ?? []).flatMap((t) => [...t.matchAll(new RegExp(`(${FR})" from the outboard edge, (${FR})" from the top end`, 'g'))].map((m) => [m[1], m[2]])) : [];
      const ang = corner?.angleDeg !== undefined ? String(corner.angleDeg) : undefined;
      const kp = bgk.pins;
      const topStep = kp ? feat(c, 'brake-knee-L', 'outline', (q) => /TOP end/.test(q.text)) : undefined;
      const stockOf = (id: string): string => { const s0 = c.by(id)?.stock; return s0 ? `${fin(s0.t)} × ${fin(s0.w)} × ${fin(s0.l)}` : 'see the cut list'; };
      const tabIds = c.mine.filter((x) => /^brake-tab-[LR]$/.test(x.id)).map((x) => x.id);
      const slvIds = c.mine.filter((x) => /^brake-sleeve-(B-knee|T-tab)-/.test(x.id)).map((x) => x.id);
      // D-78: the knee on two quick-release pins is bench work: it is not glued or bolted to the hull and comes off with the flap.
      const hullBIds = c.mine.filter((x) => /^brake-sleeve-B-hull-[LR]$/.test(x.id)).map((x) => x.id);
      const gap1 = (v: number): string => fin(v);
      const pinItems: Instr[] = kp ? [
        I(`Make the tabs from one stick: ${tl(tabIds)}.`, [
          `Oak: ${stockOf(tabIds[0])} (T × W × L) each, grain running up the ${fin(kp.tab.z1 - kp.tab.z0)} side. The cut list has the rough size and the board: mill ONE 12" stick of 1" × ${fin(kp.tab.x1 - kp.tab.x0)} with the grain along it, then crosscut the tabs from it.`,
          'The tab is 1" thick, so it is not cut from the knee block (its layers are 3/4"): take it from a 5/4 board, or glue two pieces of 4/4 face to face and mill to 1".',
        ], tabIds),
        I(`Epoxy a tab to the rear face of each knee: ${tl(tabIds)}.`, [
          `The tab's long face against the knee's rear face, its bottom edge ${fin(kp.tab.z0 - pkn.zBot)} up from the knee's bottom end. It stands ${fin(kp.tab.z1 - pkn.zTopLeg)} above the top of the knee's leg and ${fin(kp.tab.x1 - kp.tab.x0)} out behind its rear face.`,
          `Its face against the web stands ${thick(kp.webRecess)} proud of the face of the knee's leg (the web is recessed that much), so the tab lies flat on the web while the leg lies on the rail and the chine band. Lay a straightedge across both faces to check the step.`,
          `The tab touches the knee over its lower ${fin(kp.tab.patch.z1 - kp.tab.patch.z0)} (about ${fractionText(Math.round(kp.tab.patch.area * 4) / 4, 4)} square inches of glue): dry-fit it first, then clamp it square with one bar clamp along the knee, a pad on the tab's rear end and one on the knee's front face. No screw is needed.`,
        ], tabIds),
        I(`Drill the two pin holes in each knee unit, after the tab is glued on: ${tl(knees)}.`, [
          `Use the pin-hole plate (Forms section, on the brake knee template sheet). It has a 1/8" center hole for each pin, ${gap1(Math.hypot(kp.B.x - kp.T.x, kp.B.z - kp.T.z))} apart, center to center: that spacing is the hull's own.`,
          `Lay the plate on the knee unit's wall face (the face that goes against the hull), its rear end flush with the tab's rear end and its bottom edge flush with the knee's bottom end. Clamp it and prick both centers with an awl through the 1/8" holes, then take it off.`,
          `Top hole T, in the tab: ${fin(c.p.brakeTabEndIn)} from the tab's rear end and ${fin(kp.tab.z1 - kp.T.z)} under its top edge (${fin(kp.T.z - kp.tab.z0)} up from its bottom edge; the tab is ${fin(kp.tab.z1 - kp.tab.z0)} tall). Bottom hole B, in the leg: ${fin(kp.B.fromKneeRear)} from the knee's rear face (the middle of its ${fin(pkn.x1 - pkn.x0)} thickness) and ${fin(kp.B.fromKneeBottom)} up from its bottom end.`,
          `Drill each center on the drill press with a 33/64" brad-point bit (the sleeves are .500 inch, and the glue needs a hair of room), straight through: the knee on its wall face on the table with a ${thick(kp.webRecess)} shim under the bottom of the leg, so the unit rests flat on the tab and the leg, and a waste board under the tab. Drill the top hole first and the bottom hole last.`,
          'Mark the unit L or R on its tab with a pencil. The two units are mirror images and each is fitted to its own side only.',
        ], [...knees, ...tabIds]),
        I(`Epoxy a reamed sleeve into each hole: ${tl(slvIds)}.`, [
          `The leg's sleeve is ${fin(kp.B.kneeSleeve.len)} long and the tab's is ${fin(kp.T.kneeSleeve.len)}; each is flush with both faces, cut to length so nothing needs trimming.`,
          'Thickened epoxy on the hole wall, a waxed 3/8" rod through the bore while it cures, squeeze-out wiped at once.',
          'When it has cured, try the first pin in each sleeve.',
        ], slvIds),
        ...(hullBIds.length
          ? [I(`Bed a flanged bushing in each rail, with its knee clamped on: ${tl(hullBIds)}.`, [
            'The hull is inverted, so the rail is reachable from below. Put release tape (packing tape) on the faces of the knee that touch the hull, so no epoxy bonds the knee to the sled.',
            `Set the knee unit on the rail's outer face and the chine band: its rear face ${fin(kp.B.fromRailRear - kp.B.fromKneeRear)} from the finished rear end of the rail, and its bottom end level with the bottom edge of the rail. Clamp it.`,
            `Push a waxed 3/8" rod through the knee's leg sleeve and the 5/8" hole in the rail. Put thickened epoxy around the hole, slide the flanged bushing in from the inboard side over the rod, its flange in the counterbore, until its plain end is flush with the rail's outboard face.`,
            'Wipe the squeeze-out. When it has cured, pull the rod and lift the knee off (the tape lets go). The bushing is now coaxial with the knee leg sleeve; the top bushing is bedded the same way at the rib step.',
          ], [...hullBIds, ...knees])]
          : []),
        I('Leave the knee units bare. They go through the underside finish with the hull (next steps), on the bench, with a waxed rod in each sleeve to keep the finish out of the bore.'),
      ] : [];
      const restOfKnee: Instr[] = [
        I(`Start from the knee blocks you laminated in step 1 (cross-laminated, already milled to ${kneeFinal}, T \u00d7 W \u00d7 L): ${tl(knees)}.`, [
            'Do not glue anything up here: the layers, the grain directions, the joint position and the pocket notch are in step 1.',
            'Check each block before you saw: the grain of the rear and front layers runs up the leg, and the center layer runs across the sled.',
          ], knees),
          I('Cut ONE knee first and run the one-knee test (Verify).', ['Try it with the real pin and flap tongue; cut the other knee only when it passes.'], knees),
          I(`Shape each knee from its laminated block: ${tl(knees)}.`, [
            `The knee is ${fin(kneeTall)} tall${bgk.pins ? ' (its leg rises over the top pin: see the step in its top end on the drawing)' : ', with its top flat'}; the roof over the pocket is ${fin(c.p.brakeKneeRoofIn)} and the floor under it ${fin(c.p.brakeKneeFloorIn)}.`,
            cornerPts.length >= 2 && ang ? `Corner cut on the outboard edge: it starts ${cornerPts[0][1]}" below the top end, runs in at ${ang}° to ${cornerPts[1][0]}" from the edge at ${cornerPts[1][1]}" down, then straight to the bottom end.` : `Outline: ${SEE}.`,
            `Recess the pocket about ${fractionText(Math.round(intoFront * 16) / 16, 16)}" into the front layer, so it ends ${fin(pocketDeep)} from the rear face: router with a straight bit, or chisel. It is the same ${fin(pocketW)} wide and ${fin(pocketH)} high as the notch, open at the rear face and the outboard edge.`,
            'The 3/8" pin hole waits: it is drilled with the stainless strap on and the flap tongue clamped in the pocket (flap step).',
          ]),
      ];
      const intro: Instr[] = [
          I('Do it now, not after the flip.', [
            'The knee legs are glued to bare oak: glue will not bond to varnish.',
            'The nylock nuts sit on the stainless backing plates under the deck, reachable only while the hull is inverted.',
          ]),
          backers.length
            ? I(`Glue the backers (3/4" oak) to the rail inboard face and the deck underside, clear of the axle hanger: ${tl(backers.map((x) => x.id))}.`)
            : framed
              ? I('The backers went in with the frame glue-up and their bolt holes are drilled: only the knees go on here.', [], ['brake-backer-L', 'brake-backer-R'])
              : I('No backers in this model.'),
      ];
      const bolting: Instr[] = [
          I('Bolt each knee: 4 × 3/8" × 4" bolts, 2 columns × 2 rows, through the knee leg and the rail into the backer.', [
            bolts ? `Holes in the knee, ${holeText(bolts)}.` : SEE_ITEM,
            `Heads with a ${fin(c.p.brakeMountWasherOdIn)} washer under each on the outer face of the knee leg (no counterbore); nylock nuts on the backing plate set in the backer, under the deck.`,
            'Check each plate lies flush in its recess and its 4 holes line up before the bolts go in.',
            'Glue on the leg against the rail and chine outer face; clamp, bolt, wipe the squeeze-out.',
          ], ['rail-L', 'rail-R']),
          I('Leave the knees 24 h before the wheel dry fit (next step) loads them.'),
      ];
      if (kp) {
        return {
          goal: 'Shape the brake knees, add the tab, and drill and sleeve the two pin holes. The knees stay on the bench: they are not glued to the hull.',
          items: [
            I('These are bench pieces: the knee is not glued or bolted to the hull.', [
              'Each knee, with its tab and sleeves, comes off with the flap as one piece (two pins). Nothing of the knee stays on the hull but two sleeves.',
              'Do the work now so the finished knee units go through the underside finish with the hull.',
            ]),
            ...restOfKnee,
            ...(topStep ? [I('Cut the step in the top of the leg, as on the drawing:', [topStep.text])] : []),
            ...pinItems,
          ],
          checks: ['Knee tops level with each other', `The tab's face against the web ${thick(kp.webRecess)} proud of the leg's face (straightedge across both)`, `The two sleeve centers in each knee ${fin(Math.hypot(kp.B.x - kp.T.x, kp.B.z - kp.T.z))} apart, the same on both knees`, 'The pin slides through both sleeves of each knee by hand, with only a hair of play', `With a knee held at its place, its rear face ${fin(pkn.x0 - (bgk.O[0] + bgk.r))} ahead of the tire front and the tab's bottom edge ${fin(kp.tab.z0 - (bgk.O[1] + bgk.r))} above the tire top`, 'Each unit marked L or R', 'Nothing finished yet'],
          toolsOnly: ['bandsaw', 'chisel', 'drill press', 'epoxy pumps', 'clamps', '33/64" brad-point bit', 'bar clamp', 'waxed 3/8" rod', 'release tape'],
        };
      }
      return {
        goal: 'Glue and bolt the brake knees to the rails now, while the hull is upside down.',
        items: [...intro, ...restOfKnee, ...bolting],
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
      const kneesOff = !!brakeOf(c.p).pins; // D-78: the knees are bench pieces until the hang step
      return {
        goal: 'Dry-fit the wheels to prove the running gear, drill the last holes, then take everything metal off.',
        items: [
          I(`Put the ${plural(wheels.length, 'wheel')} on the axles.`, [`${fin(c.p.wheelBoreIn)} bore on the ${fin(c.p.axleDiameterIn)} ${axleWord(c.p)}, sealed bearings.`, 'Collar and cotter pin 1" beyond the hub.'], wheels.map((x) => x.id)),
          I(`Check the track: ${fin(c.p.frontTrackIn)} front, ${fin(c.p.rearTrackIn)} rear.`, ['Inflate to the squash-test pressure (Verify).']),
          I('Spin each wheel.', kneesOff
            ? ['No rub on the beam end or the clamp plates.', 'The knees are not on the sled yet: the knee-to-tire margin is measured when they are fitted (hang step).', 'No end float beyond 1/16".']
            : ['No rub on the beam end, the clamp plates or the brake knee.', 'Measure the knee-to-tire margin now, wheels on and knees cured.', 'No end float beyond 1/16".']),
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
      const kneeUnits = !!brakeOf(c.p).pins;
      return {
        goal: 'Finish everything you can reach from below before the hull is turned over.',
        items: [
          I('Run the finishing schedule (Finishing section) on the underside.', [
            'The deck underside, rails, crossmembers, beams, hangers and king beam.',
            kneeUnits ? 'The brake knee units (knee and tab), on the bench beside the hull, with a waxed rod in each sleeve.' : 'The brake knees and their backers.',
            'The outside of the sides, the transom and the bulkhead.',
          ]),
          I('Offcut test first, then sand 120 / 150 and stain the show faces.'),
          std
            ? I('Epoxy the deck underside and the oak end grain (one coat), then urethane.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.'])
            : I('Epoxy-seal (one saturation coat), then varnish.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.']),
          kneeUnits
            ? I('Mask the kingpin head and the hold-down angles.', ['Leave the pivot-hole spot on each knee for later.', 'Plug the rail sleeve with a waxed rod so no finish runs into the bore.'])
            : I('Mask the bolt seats, the kingpin head and the hold-down angles.', ['Brush epoxy into the knee bolt holes; leave the pivot-hole spot for later.']),
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
            `The front face of the T head is flat and square out past both bolt holes (the taper to the stem starts inside the bolt heads), so each domed carriage-bolt head sits flat on it. Keep the holes square to that face and ${fin(c.p.tongueHeadLenIn)} deep (the head's length).`,
            'Nylock nuts and fender washers on the rear face.',
            'The tongue is not removable: it stays on and is finished in place.',
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
    id: 'side-ribs',
    title: 'Side ribs and knees: the tie-down bases',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^(side-rib-|brake-sleeve-T-hull-)/,
    view: 'iso',
    tools: ['bandsaw', 'spring clamps', 'epoxy pumps', 'drill', '3/8" Forstner or brad-point bit', 'straightedge'],
    hardener: '206',
    build: (c) => {
      const p = c.p, L = computeLayout(p);
      const sts = sideRibStations(p, L);
      const eighth = (v: number): string => fin(Math.round(v * 8) / 8);
      const fromTransom = (x: number): string => eighth(x - L.xRear);
      const zChineTop = L.chineBot + L.chineH;
      const name: Record<number, string> = { 1: 'Box rib', 2: 'Mid rib', 3: 'Bow post' };
      const pair = (n: number): string => tl([`side-rib-L${n}`, `side-rib-R${n}`]);
      const kneePair = (n: number): string => tl([`side-rib-knee-L${n}`, `side-rib-knee-R${n}`]);
      const knees = sts.filter((st) => st.kind === 'knee');
      const ks = kneeScrews(p, L);
      const filler = (st: (typeof sts)[number]): number => {
        const foot = st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop;
        return Math.max(0, sideTopAt(L, st.x) - L.railBand - Math.max(zChineTop, foot));
      };
      // The counterbore of the knee screws: its width from the knee's own cut, its depth at each screw (the knee is a right triangle; each bore leaves the same oak under its head).
      const cbWide = fin(c.by('side-rib-knee-L2')?.joints?.find((j) => j.cut?.kind === 'counterbore')?.cut?.dia ?? c.by(`side-rib-knee-L${knees[0]?.n ?? 2}`)?.joints?.find((j) => j.cut?.kind === 'counterbore')?.cut?.dia ?? 0.375);
      const cbDepths = (st: (typeof sts)[number]): string => {
        const k = c.by(`side-rib-knee-L${st.n}`)?.stock;
        if (!k) return 'see the part drawing';
        return listS(ks.d.map((d) => fin(Math.max(0, k.l * (1 - d / k.w) - KNEE_SCREW_SEAT_IN)))).replace(/ and /, ' and ');
      };
      const hullT = c.mine.filter((x) => /^brake-sleeve-T-hull-[LR]$/.test(x.id)).map((x) => x.id);
      const pn = brakeOf(p).pins;
      const pt = pn?.T;
      const ribRear = pn ? pn.rib.x - p.sideRibHeadLengthIn / 2 : 0; // the rear edge of the box rib's head
      const tieGap = pn && pt ? pn.rib.z1 - pn.rib.tieTopZ - pt.belowRibTop - pn.sleeveOd / 2 : 0;
      const ribDims = (st: (typeof sts)[number]): string => {
        const stock = c.by(`side-rib-L${st.n}`)?.stock;
        return stock ? `${fin(p.sideRibHeadLengthIn)} head, ${fin(p.sideRibWidthIn)} shaft, ${fin(stock.l)} tall` : 'see the part drawing';
      };
      return {
        goal: 'Glue the side ribs and their knees inside the hull, now the deck is in. The D-rings bolt to the rib heads later.',
        items: [
          I('Bandsaw the ribs and knees from 4/4 offcuts planed to 3/4".', [
            ...sts.map((st) => `${pair(st.n)}${st.kind === 'box' ? ' (short: it starts at its box tie)' : ''}: ${ribDims(st)}.`),
            ...(pn ? [`The box rib is a full-width block above its shaft: ${fin(pn.rib.blockW)} wide from ${fin(pn.rib.blockZ0 - pn.rib.z0)} above its bottom end up to the head, ${fin(p.sideRibWidthIn)} wide below that (the top-pin sleeve needs the oak). See its drawing.`] : []),
            ...knees.map((st) => {
              const k = c.by(`side-rib-knee-L${st.n}`)?.stock;
              return `${kneePair(st.n)} (the ${name[st.n].toLowerCase()}'s knees): ${k ? `${fin(k.w)} along the deck, ${fin(k.l)} up the rib` : 'see the part drawing'}, ${fin(p.sideRibWidthIn)} thick.`;
            }),
            'Cut the top of each head to the sheer slope on its drawing. The four D-ring holes wait for the final fit.',
          ]),
          I('Glue a band-strip filler to the web at each rib, between the inner chine band and the inner gunwale band.', [
            `Each is ${fin(p.sideRibWidthIn)} wide and ${fin(L.sideBand)} thick (spare band strip, grain up${pn ? '; or resaw a 4/4 offcut to that thickness on the bandsaw' : ''}), cut to fit the gap. Lengths: ${listS(sts.map((st) => `about ${eighth(filler(st))} at the ${name[st.n].toLowerCase()}`))}.`,
            `Centered on each rib station, which is measured from the transom's outer face: ${listS(sts.map((st) => `${name[st.n].toLowerCase()} ${fromTransom(st.x)}`))}. The same on both sides.`,
            ...(pn ? [`At the box rib the filler is T-shaped like the rib: ${fin(pn.rib.blockW)} wide for the top ${fin(sideTopAt(L, pn.rib.x) - L.railBand - Math.max(pn.rib.blockZ0, zChineTop))}, ${fin(p.sideRibWidthIn)} wide below that.`] : []),
            'Epoxy to the web; the filler face must end flush with the band faces (check with a straightedge).',
          ]),
          I('Epoxy each rib to the inner bands and its filler, full face.', [
            ...sts.map((st) => {
              const zFoot = st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop;
              const turn = Math.round((Math.atan(st.dTurn) * 180) / Math.PI);
              return `${pair(st.n)}: shaft centered ${fromTransom(st.x)} from the transom${st.kind === 'box' ? `, its foot ${eighth(zFoot - L.deckTop)} above the deck (the box tie is its base)` : `, foot on the deck`}${turn >= 2 ? `. The side angles in about ${turn}° here: stand the rib square to the side` : ''}.`;
            }),
            'Head against the inner gunwale band, its top flush with the gunwale top; foot against the inner chine band; thickened epoxy takes up any gap.',
            'Hold each pair with a spreader stick across the hull (padded ends, wedged snug). Add a small fillet at the deck.',
            'Wipe the squeeze-out now. The back face is glued, so it takes no finish.',
          ]),
          ...(knees.length ? [
            I('Glue a knee to the foot of each mid rib and bow post, to the rib and the deck.', [
              ...knees.map((st) => `${kneePair(st.n)}: centered on ${st.member === 'king-beam' ? 'the king beam' : st.member!.replace('-', ' ')} (${fromTransom(st.x)} from the transom).`),
              'Epoxy the tall leg to the inboard face of the rib and the foot to the deck, with a small fillet.',
            ]),
            I(`Drive ${ks.d.length} stainless ${screwText(ks.fit)}" screws down through each knee and the deck into the top edge of the joist or king beam.`, [
              `Screws ${listS(ks.d.map((d) => fin(d)))} from the rib face along the foot, centered on the member.`,
              `Counterbore each from the sloped face first, ${cbWide} wide, leaving ${fin(KNEE_SCREW_SEAT_IN)} of oak under the head. Depths from the sloped face: ${listS(knees.map((st) => `${cbDepths(st)} at the ${name[st.n].toLowerCase()}`))}.`,
              'Then a 9/64" clearance hole through the knee and the deck, and a 7/64" pilot into the member.',
              'Drive them while the epoxy is wet, so they pull the knee down on the deck.',
            ]),
          ] : []),
          ...(hullT.length && pt && pn
            ? [I(`Once the rib epoxy has cured, drill the top-pin hole through each box rib block and bed its flanged bushing, with the knee pinned on: ${tl(hullT)}.`, [
              I('Make a drill block first: a scrap of hardwood about 1-1/2" thick, with a 5/8" hole drilled square through it on the drill press.', [
                'Clamp it to the inner face of the rib block with the hole over the pencil mark. The block holds the bit square to the rib, which is square to the side.',
                'Do it after the epoxy has fully cured: the hole goes through the finished stack of rib block, filler and web.',
              ]),
              I('Mark the hole on the rib block, measured from the rib and its named edges.', [
                `${fin(pt.x - ribRear)} in from the REAR edge of the block, measured on the inner face (the block is ${fin(pn.rib.blockW)} wide, so that is its middle).`,
                `${fin(pt.fromRibFoot)} up from the BOTTOM end of the rib, the foot. The block starts ${fin(pn.rib.blockZ0 - pn.rib.z0)} above the foot and the hole is ${fin(pt.z - pn.rib.blockZ0)} above the bottom edge of the block. (Measure from the foot, not from the top: the top of the rib is cut at the sheer slope.)`,
                `The hole's lower edge stays ${fin(tieGap - (0.625 - pn.sleeveOd) / 2)} above the top of the box tie spacer, which no pin can pass.`,
              ]),
              I('Drill the hole and cut the counterbore.', [
                `The counterbore for the flange first, in the block's inner face: a ${fin(pn.flange.cboreDia)} Forstner, ${fin(pn.flange.cboreDepth)} deep.`,
                `Then a 5/8" bit out through the block, the filler and the web, ${fin(pt.hullSleeve.len)} deep in all, square to the side. It is oversize on purpose: the bushing is bedded in epoxy around the knee's own sleeve, so the two holes are coaxial.`,
                'Stop when the point shows on the web, then finish from outside, or clamp a scrap over the web where the bit comes out so the outer face is not torn.',
              ]),
              I('Bed the flanged bushing with the knee pinned on at the bottom pin. Do one side at a time.', [
                'Put release tape on the faces of the knee unit and its tab that touch the hull, so no epoxy bonds the knee to the sled.',
                `Take the knee unit marked for this side and push the bottom pin through the leg sleeve and the rail bushing. Swing the knee up until the tab lies on the web and the tab's sleeve lines up with the hole.`,
                `Push a waxed 3/8" rod through the tab's sleeve and the hole. Put thickened epoxy in the hole, then slide the flanged bushing in from the inside over the rod, its flange in the counterbore, until its plain end is flush with the web's outer face (the bushing is ${fin(pt.hullSleeve.len)} long, flange included).`,
                'Wipe the squeeze-out at once. When it has cured, pull the rod, pull the bottom pin and lift the knee off.',
                'Slide the first pin through the top bushing and the tab sleeve to prove the pair lines up.',
              ]),
              I('The tab of the knee lies on the web over this spot, so keep the web there flat: no filler or epoxy proud of it.'),
            ], hullT)]
            : []),
        ],
        checks: ['Each rib square to the side, the head top flush with the gunwale top', 'No gap behind a rib; the filler is flush with the bands', 'Each knee sits flat on the deck, its screws snug and below the oak face', `The storage box still fits: the box side stands ${fin(p.sideRibDepthIn)} from the box rib's inner face`, ...(hullT.length ? ['Each top-pin bushing flush with the web, its bore clear, the first pin sliding through it and the tab sleeve, and both bushings at the same height and station on the two sides'] : [])],
        ...(hullT.length ? { tools: ['5/8" brad-point bit', `${fin((brakeOf(p).pins?.flange.cboreDia) ?? 0.78125)} Forstner`, 'drill block', 'waxed 3/8" rod', 'release tape'] } : {}),
      };
    },
  },
  {
    id: 'storage-box',
    title: 'Storage box: walls, coaming, hinge backers, latch blocks',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^(storage-(side|end|coaming|hinge-backer|latch-block)-|storage-(side|end)-|box-tie-)/,
    view: 'iso',
    tools: ['table saw (45° bevels)', 'tape', 'glass tape', 'epoxy pumps', 'router'],
    hardener: '206',
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
          ...(c.mine.some((x) => /^box-tie-/.test(x.id)) ? [(() => {
            const L2 = computeLayout(c.p), st = sideRibStations(c.p, L2)[0];
            const g = boxTieGeometry(c.p, L2, st);
            const ties = c.mine.filter((x) => /^box-tie-/.test(x.id)).map((x) => x.id);
            return I(`Epoxy a box tie between each box rib and the box side: ${tl(ties)}.`, [
              `Each tie is centered on its rib, ${fin(c.p.sideRibBoxInsetIn)} behind the front end of the box, ${fin(g.z0 - L2.deckTop)} to ${fin(g.z1 - L2.deckTop)} above the deck, grain up.`,
              'Tap each tie into the gap from above on thickened epoxy, on both faces: to the box side and to the rib. The epoxy takes up the fit.',
              'The top stands 1/8" under the coaming, so the tie is never glued to the lid frame, which moves.',
            ]);
          })()] : []),
          I('Glue the oak coaming to the wall tops, butt corners.', ['Clamp it with cauls.', 'Round the inboard top edge 1/8".', 'The gasket and lid sit on oak, never on a ply edge.'], coam),
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
    build: (c) => {
      const frame = c.mine.filter((x) => /^storage-rim-/.test(x.id)).map((x) => x.id);
      const battens = c.mine.filter((x) => /batten/.test(x.id)).map((x) => x.id);
      const mort = feat(c, 'storage-rim-side-L', 'mortise');
      const mortSize = mortiseSize(mort);
      const mortAt = centersOf(mort, 'REAR end');
      const dado = feat(c, 'storage-rim-side-L', 'dado');
      const dadoSpans = rangesOf(dado, 'REAR end');
      const dadoDown = dado?.positions ? /(?:^|, )((?:\d+(?:-\d+\/\d+)?|\d+\/\d+)" to (?:\d+(?:-\d+\/\d+)?|\d+\/\d+)") from the top face/.exec(dado.positions.join('; '))?.[1] : undefined;
      const dadoDeep = /^(\S+)" deep/.exec(dado?.size ?? '')?.[1];
      const w0 = dadoSpans[0] ? dadoSpans[0][1] - dadoSpans[0][0] : 0;
      const dadoWide = dadoSpans.length && dadoSpans.every(([a, b]) => Math.abs(b - a - w0) < 0.01) ? `, each ${fin(w0)} wide` : '';
      return {
        goal: 'Make the oak lid frame, set the panel in it, and fit the hinges.',
        items: [
          I('Cut the lid frame joints.', [
            `Corners: blind loose tenons${mortSize ? `, ${mortSize}` : ''}; the mortises in the frame sides centered ${mortAt.length ? `at ${list(mortAt)} from the rear end` : SEE}.`,
            'Panel rabbet: 1/4" × 1/4" along the top inside edge of every frame piece.',
            dadoSpans.length
              ? `${dadoSpans.length} batten dados, ${dadoDeep ?? '1/4'}" deep, in the inboard face of each frame side, starting ${listS(dadoSpans.map(([a]) => fin(a)))} from the rear end${dadoWide}${dadoDown ? `, ${dadoDown} below the top face` : ''}.`
              : `Batten dados: ${SEE}.`,
          ], frame),
          I('Glue the frame square around the {{storage-lid}}, the panel in its rabbet and epoxy-sealed.', ['Clamp it square while the corners set.']),
          I(`Let the ${plural(battens.length, 'batten')} 1/4" into the frame sides.`, ['Glue plus 4 plugged stainless screws each, from the top: they keep the panel from sagging.'], battens),
          I('The lid is engraved DO NOT STEP in the finishing schedule (step 5), before the topcoat.', ['It is a lid to sit a cushion on, not a step.']),
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
    build: (c) => {
      const pilots = stopBlockPilots(c.parts, c.p);
      // The LATCH hole: a hole for the seat pin (the 3/8" pin hole in the sloped face), never the screw pilots in the bottom end (those are for the deck screws).
      const holes = featsAll(c, 'seat-wedge-L', 'hole');
      const latch = holes.find((q) => (q.to ?? []).some((t) => /^seat-pin/.test(t)) || q.joint === 'pin') ?? holes.find((q) => /tilted/i.test(q.text) || q.face === 'sloped face') ?? holes.find((q) => !/pilot/.test(q.size ?? '') && /deep/.test(q.size ?? ''));
      const latchSize = latch ? new RegExp(`^(${FR})"[^,]*, (${FR})" deep`).exec(latch.size ?? '') : null;
      const mouth = latch?.positions?.length ? latch.positions.join('; ') : undefined;
      const cut = feat(c, 'seat-wedge-L', 'outline', (q) => q.angleDeg !== undefined && /Sloped end/i.test(q.text));
      const tilt = latch ? (/[Tt]ilted (\d+)°/.exec(latch.text)?.[1] ?? (cut?.angleDeg !== undefined ? String(+(90 - cut.angleDeg).toFixed(1)) : undefined)) : undefined; // square to the sloped end: 90 - the cut angle
      const cutPts = cut ? (cut.positions ?? []).flatMap((t) => [...t.matchAll(new RegExp(`(${FR})" from the rear edge, (${FR})" from the bottom end`, 'g'))].map((m) => [m[1], m[2]])) : [];
      const wedgeJ = c.by('seat-wedge-L')?.joints?.find((q) => q.type === 'pin' && /annular detent groove/.test(q.size ?? ''));
      const groove = wedgeJ ? /groove ([\d.]+)" from the mouth/.exec(wedgeJ.size ?? '')?.[1] : undefined;
      return {
        goal: 'Glue the seat-back stop blocks and the crest strip to the box end.',
        items: [
          I('Shape the stop blocks to the back angle: bandsaw, then plane to the line (block drawing).', [
            cut?.angleDeg !== undefined && cutPts.length >= 2
              ? `Sloped end at ${cut.angleDeg}° from level: from ${cutPts[0][0]}" from the rear edge at the bottom end, up to ${cutPts[1][0]}" from the rear edge at ${cutPts[1][1]}" up.`
              : `Sloped end: ${SEE}.`,
          ], ['seat-wedge-L', 'seat-wedge-R']),
          I('Drill the upright latch hole in each block before it is glued.', [
            latchSize ? `${latchSize[1]}" hole, ${latchSize[2]}" deep (drill stop)${tilt ? `, tilted ${tilt}° from the bottom-end line and square to the sloped face it enters` : ''}.` : '3/8" blind hole, with a drill stop.',
            mouth ? `Mouth: ${mouth}.` : SEE_ITEM,
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
            'Clamp it with a caul from the front.',
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
    build: (c) => {
      const pad = feat(c, 'seat-hinge-backer-L', 'hole', /pilot/);
      const pin = feat(c, 'seat-hinge-backer-L', 'hole', (q) => /deep/.test(q.size ?? '') && !/pilot/.test(q.size ?? ''));
      return {
        goal: 'Make the seat back and fit its hinges, pins and cushions (the hardware goes on for good after the finish).',
        glue: { epoxy: true, titebond: false },
        items: [
          I('Shape the {{seat-back-panel}}.', ['2-1/2" radius top corners.', '1/16" oak veneer banding round the edge, flush-trimmed and epoxy-sealed: no ply edge shows.']),
          I('Set the hinge inserts: 3 per hinge, #10-32 × 5/16 stainless, hex-drive.', ['Epoxied in blind holes 11/32" deep from the front face (drill stop), at least 1/2" from every edge.', 'Leave them for the full cure before the first load.', 'Pull-test one on a scrap first (Verify).']),
          I('Bore the latch-pin holes in the panel.', ['13/32" clearance, square, 7-3/8" either side of the center, 2" up from the hinge axis.', 'Line them with epoxy.']),
          I('FIT AND DRILL now, hang later: the 2" butt hinges.', [
            '#10-32 × 3/8 screws go in from the FRONT (forward) face, through the leaf, into the inserts. The hinge leaf, the inserts and the screws are all on that one face; nothing is drilled from the back face.',
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
    build: (c) => {
      const eye = feat(c, 'brake-knee-L', 'hole', (q) => /screw eye/.test(q.purpose ?? ''));
      const bgs = brakeOf(c.p);
      const strapRow = c.cut().metal.find((q) => q.ids.includes('brake-strap-L'));
      const strapScrewJoint = c.by('brake-strap-L')?.joints?.find((q) => q.type === 'screw');
      const strapScrewF = feat(c, 'brake-strap-L', 'hole', (q) => /screw/.test(q.purpose ?? ''));
      const strapScrewHoles = strapScrewF ? `${strapScrewF.count} holes ${holeText(strapScrewF) ?? ''}`.trim() : undefined;
      const strapPinHole = holeText(feat(c, 'brake-strap-L', 'hole', (q) => /pin/.test(q.purpose ?? '')));
      const pilotM = new RegExp(`^(${FR})" pilot, (${FR})" deep`).exec(feat(c, 'brake-knee-L', 'hole', (q) => /strap/.test(q.purpose ?? ''))?.size ?? '');
      const strapPilot = pilotM ? `${pilotM[1]}" pilots ${pilotM[2]}" deep` : undefined;
      const kneeOnPins = !!bgs.pins;
      const strapScrews = `${strapScrewJoint?.count ?? 4} × ${screwOf(c, 'brake-strap-L', /brake-knee/)}`;
      const strapRows = `${(strapScrewJoint?.count ?? 4) / 2} in the roof above the pocket and ${(strapScrewJoint?.count ?? 4) / 2} in the floor under it`;
      return {
        goal: 'Make the two brake flaps with their shoes, pads, return cords and chocks, as removable kits.',
        items: [
          I('Cut the flaps on the Shaper from the file: {{brake-flap-L}} and {{brake-flap-R}}.', ['7/8" oak; 1/4" roundover on all edges.', 'Epoxy-seal before the finish.']),
          I('Make the two pivot straps: {{brake-strap-L}} and {{brake-strap-R}}.', [
            strapRow ? `Stock: ${strapRow.section}. Cut each ${fin(strapRow.cutLengthIn)} long on the metal bandsaw, then deburr every cut edge (the cut list has the sizes).` : 'Stock and length: the cut list. Cut on the metal bandsaw, then deburr every cut edge.',
            strapScrewHoles ? `Drill on the drill press: ${strapScrewHoles}.` : 'Drill the screw holes on the drill press, from the strap drawing.',
            strapPinHole ? `Then the pin hole: ${strapPinHole}.` : 'Then the pin hole, from the strap drawing.',
            'Cut, deburr and drill only: nothing else is done to the metal.',
          ]),
          I('Screw a strap to each knee, across the open side of the pocket: {{brake-strap-L}} and {{brake-strap-R}}.', [
            `Each strap takes ${strapScrews} stainless pan-head wood screws: ${strapRows}. They go into the side grain of the rear and front layers.`,
            'Lay the strap on the knee\'s outboard face, its rear edge flush with the knee\'s rear face, and mark each screw through its hole.',
            `Drill ${strapPilot ?? '1/8" pilots'}, one at each mark. A drop of epoxy in each pilot before its screw.`,
            'Pan heads sit on the strap: it is not countersunk.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Fit a pivot block on each flap tongue: {{brake-pivot-block-L}} and {{brake-pivot-block-R}}.', [
            `Glue and 3 × ${screwOf(c, 'brake-pivot-block-L', /brake-flap/)} flat-head screws; clamp it while the glue sets.`,
            `Clamp the tongue and block in the knee's pocket, then drill the pin hole in one pass with one ${fin(bgs.strap.pinHole)} bit: through the strap's hole, the block and the tongue, and ${fin(bgs.pivot.blind)} blind into the knee's inboard ear.`,
            'Brush epoxy into the blind hole, then fit the clevis pin through the strap, the block and the tongue (double shear) and the hitch-pin clip in its cross hole, outboard of the strap.',
          ]),
          I('Make the shoes: {{brake-shoe-L}} and {{brake-shoe-R}}.', [
            'Bandsaw from the blank: the top follows the 6° flap underside, the bottom is cut to the tire radius.',
            `Glue and 2 × ${screwOf(c, 'brake-shoe-L', /brake-flap/)} screws up into the flap (all the brake's wood screws are one size).`,
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
          kneeOnPins
            ? I('Removable, knee and flap together: unhook the cords, pull the two knee pins, lift the knee and the flap off as one piece, about 15 s a side.', ['The strap stays screwed to the knee, and the flap pin and clip stay in the strap. The chock cord ties to the eye under the knee, so the chock rides with its knee.', 'The steps for taking the knees off and putting them back are after the hang step.', 'Finish the flap kit on the bench; the pin, clip, cord, snap hook, pad and tread stay off until the hang step.'])
            : I('Removable: clip off (it sits outboard of the strap), pin out, cord unhooked, flap lifted off, about 15 s a side.', ['The strap stays on the knee.', 'Finish the flap kit on the bench; the pin, clip, cord, snap hook, pad and tread stay off until the hang step.']),
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
      const place = socketOnTransom(c.parts);
      return {
        goal: 'Make the push handle as one removable U, and fit and drill its sockets on the transom.',
        items: [
          I('FIT now, then take off: the aluminum sockets {{handle-socket-L}} and {{handle-socket-R}}.', [
            place ? `Position on the transom (both sockets): centered ${fin(place.off)} either side of the centerline, the bottom end ${fin(place.up)} up from the transom's bottom edge.` : false,
            `The screw holes were drilled when the transom was closed${sockAt.length ? ` (on the socket: ${list(sockAt)} up from its bottom end)` : ''}: hold each socket on the transom and check that they line up.`,
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
          I('Pin and glue the bow to the post tops.', ['3/8" × 2-1/4" stainless rod: 1-1/2" deep in the post, 3/4" in the bow, glued in.', 'Clamp the bow to both posts (post tops sawn to the bow slope) until the glue sets.', 'The handle comes off as ONE U and is finished on the bench.']),
          I('Clevis pin (5/16") through both socket walls and the post; the parked pin hole is 13-1/2" up.', [], ['handle-pin-L', 'handle-pin-R']),
        ],
        checks: ['Posts slide in and out without binding on the screw heads', 'Bow level and the U square', 'Handle clears the brake flaps and the tail light'],
      };
    },
  },

  // ---------------- 7: finish ----------------
  {
    id: 'wood-fitout',
    title: 'Flag blocks (glue before finishing)',
    kind: 'build',
    steps: [STEP.finish],
    match: /^flag-block-/,
    view: 'iso',
    tools: ['table saw', 'spring clamps', 'epoxy pumps'],
    hardener: '206',
    build: (c) => {
      const flags = c.mine.filter((x) => /^flag-block/.test(x.id)).map((x) => x.id);
      return {
        goal: 'Glue the last wood blocks inside the hull while everything is still bare.',
        items: [
          I(`Glue the flag blocks in the left rear corner: ${tl(flags)}.`, ['To the inner gunwale and chine bands; the tube is held between them and the transom backer.']),
          I('Sand the glue faces (120) first and keep epoxy off the faces that get the finish.'),
        ],
        checks: ['Flag blocks line up with the tube against the transom backer'],
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
            'The tongue is NOT removable: it stays bolted on and is finished in place.',
            'Plug or mask the pivot bores, bolt seats and sockets.',
          ], ['brake-flap-L', 'brake-flap-R', 'handle-bar', 'sign-L', 'sign-R', 'bridle-tongue']),
          ...(brakeOf(c.p).pins
            ? [
              I('Touch up the brake knee units on the bench: the knees with their tabs and straps.', ['Finished with the underside session; now only the chips and the tab edges from the fitting, and the tape marks.', 'A waxed rod stays in each sleeve while you work.']),
              I('Mask and touch up around the hull bushings, one in each rail and one in each web.', ['Wax rods in the bores; mask the bushings\' ends and flanges.', 'Seal the bare oak around each flange with epoxy, then finish to match, so water cannot get behind the flange.']),
            ]
            : []),
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
    glueLine: 'Sealant and contact cement: cure per the can; no load until cured',
    build: (c) => {
      const n = (re: RegExp): number => c.mine.filter((x) => re.test(x.id)).length;
      const ids = (re: RegExp): string[] => c.mine.filter((x) => re.test(x.id)).map((x) => x.id);
      const kp = brakeOf(c.p).pins;
      const kneeG = brakeOf(c.p);
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
            `Seat hinges: #10-32 × 3/8 from the front face of the seat back, through the leaf into the inserts, ${screwOf(c, 'seat-hinge-L', /hinge-backer/)} through the deck into the backer pads.`,
            `Lid hinges: ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} into the lid frame, ${screwOf(c, 'storage-hinge-L', /hinge-backer/)} into the backers.`,
            'Detent pins on lanyards; cushions on Dual Lock.',
          ], ids(/^(seat-|storage-hinge)/)),
          I(`Handle: ${plural(n(/^handle-socket/), 'socket')} bedded in sealant on the transom.`, [
            `${socketScrewText(c.parts)} per socket into the T-nuts, nylon washers under the heads.`,
            'The screw tips must stop short of the box aft wall: check with a dry screw.',
            'Then the finished U and its clevis pins.',
          ], ids(/^handle-/)),
          ...(kp
            ? [I('Fit the brake knees, each with its flap on.', [
              'Put each flap on its knee on the bench first: pivot pin through the strap in double shear, hitch-pin clip outboard of the strap.',
              `Wipe the four sleeves on each side with a clean rag and slide a pin through each dry: it goes in and out by hand.`,
              `Push the bottom pin through the knee leg and the rail bushing first, with the button held in. Swing the knee until its tab lies on the web (the tab is outside the web, over the rib block) and the tab's sleeve lines up with the top bushing, then push the top pin through. Let the buttons go: the balls stand ${fin(kp.tipIn)} inside the sled and hold.`,
              'Pull each pin and rock the knee: nothing comes out, and the knee moves only by the play of the pins in their sleeves.',
              `Measure now, wheels on: the knee's rear face ${fin(kneeG.knee.x0 - (kneeG.O[0] + kneeG.r))} ahead of the tire front, and the tab's bottom edge ${fin(kp.tab.z0 - (kneeG.O[1] + kneeG.r))} above the tire top, the same on both sides.`,
              'Clip each pin lanyard to its knee.',
            ], [...ids(/^brake-pin-/), 'brake-knee-L', 'brake-knee-R'])] : []),
          I(kp ? 'Return cords, pads and treads.' : 'Brake flaps.', kp
            ? ['Return cord and snap hook to the transom eye; pad and tread on contact cement; chock cords to the screw eyes.']
            : [
              'The flap kits on the knees: pivot pin through the strap in double shear, hitch-pin clip outboard of the strap.',
              'Return cord and snap hook to the transom eye; pad and tread on contact cement; chock cords to the screw eyes.',
            ], ids(/^brake-/)),
          I('Recheck every nut before each event: oak creeps under the plates.'),
        ],
        checks: ['All four wheels spin freely, no end float beyond 1/16", the axle swings through the full lock', 'Chain goes taut at full lock before the tire touches anything', 'Hinges and pins work, the handle slides in the sockets, the flaps return by themselves'],
      };
    },
  },
  {
    id: 'knee-swap',
    title: 'Take the brake knees off and put them back',
    kind: 'process',
    steps: [STEP.finish],
    view: 'side',
    tools: ['none: the pins are tool-free'],
    onlyIf: (p) => !!brakeOf(p).pins,
    build: (c) => {
      const kp = brakeOf(c.p).pins!;
      const kn = brakeOf(c.p).knee;
      return {
        goal: 'Take a knee and its flap off as one piece and put it back, by hand, with nothing left sticking out of the side. The chock rides with its knee.',
        items: [
          I('REMOVAL, about 15 s a side.', [
            'Unhook the return cord from the transom eye, and unclip the chock cord from the eye under the knee (the chock rides with its knee).',
            'Hold the knee with one hand and pull the top pin ({{brake-pin-T-L}} or {{brake-pin-T-R}}) first (push the button, slide it out toward you): the bottom pin still holds the knee.',
            'Then pull the bottom pin ({{brake-pin-B-L}} or {{brake-pin-B-R}}).',
            `Lift {{brake-knee-L}} (or {{brake-knee-R}}) and its flap off the side as one piece, straight outward. The strap, the flap pin, the clip and the chock stay on the knee.`,
            'Clip each pin lanyard to its knee, so no pin is lost.',
            'Nothing is left outboard of the side but the flush ends of the stainless bushings: two on each side, one in the web and one in the rail.',
          ], ['brake-flap-L', 'brake-flap-R', 'brake-pin-B-L', 'brake-pin-B-R', 'brake-pin-T-L', 'brake-pin-T-R']),
          I('REFIT, about 25 s a side.', [
            `Take the knee unit for that side, with its flap and chock. Set the leg against the rail and the chine band, the bottom sleeve on its rail bushing: the bottom one is ${fin(kp.B.belowRailTop)} below the rail's top edge.`,
            'Push the bottom pin in from the outside with its button held in, through the knee leg and the rail.',
            `Swing the knee until the tab (${fin(kp.tab.x1 - kp.tab.x0)} of it behind the knee's rear face, outside the web) lies flat on the web and its sleeve lines up with the top bushing, then push the top pin through the tab, the web and the rib block. Let each button go: the balls hold it.`,
            'Pull on each pin and rock the knee. Nothing should come out; the knee should sit flat with no gap at the tab or the leg.',
            'Hook the return cord on the transom eye and the chock cord on its eye. Press the flap by hand: it must swing and come back by itself.',
          ], ['brake-pin-B-L', 'brake-pin-B-R', 'brake-pin-T-L', 'brake-pin-T-R']),
          I('Transport mode: the knees come off with the brakes.', [
            'The viewer shows the transport configuration without the knees, flaps, tabs, chocks and pins: that is how the sled travels.',
            `Take both knee units off as above and carry them with their flaps and chocks; the sled loses nothing outboard of the side (the knee stood ${fin(kn.yOut - brakeOf(c.p).y.face)} out beside the tire).`,
          ]),
        ],
        checks: ['Both pins out and back in by hand on each side, with no tool', 'No daylight under the tab or the leg when the knee is on', 'Nothing outboard of the side with the knees off but the flush bushing ends', 'Each chock back on its own knee'],
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
    glueLine: 'Epoxy or polysulfide bedding: no load on the grab boards until cured',
    build: (c) => {
      const rest = c.mine.filter((x) => x.id !== 'hardware');
      const ids = (re: RegExp): string[] => rest.filter((x) => re.test(x.id)).map((x) => x.id);
      const grip = feat(c, 'side-L-gunwale-in', 'hole', (q) => (q.to ?? []).some((t) => /seat-grip/.test(t)));
      return {
        goal: 'Bolt on the last fittings: grab boards, signs, storage hardware, D-ring plates, lights and reflectors.',
        items: [
          I(`Bolt on the grab boards: ${tl(ids(/^seat-grip-[LR]$/))}.`, [
            I(`6 × 1/4" button-head cap screws each, through board, inner band, web, outer band and the stainless backing strip (${tl(ids(/^seat-grip-backing/))}, bedded on the outside).`),
            `Clamp the board on and drill all the layers through its holes with one bit${grip ? ' (positions on the inner gunwale band drawing)' : ''}.`,
            'Nut and 1-1/4" fender washer inside. Bolted, never glued.',
          ]),
          I(`Hang the signs (${tl(ids(/^sign-[LR]$/))}): 4 thumb-knob screws each (${knobText(c)}).`, ['Through the 3/16" holes, the standoff discs (epoxied to the sign back) and the web, into the inserts.']),
          I('Storage hardware.', ['Gaskets: continuous EPDM bulb, spliced at one corner.', 'Lid stay, draw latches on the transom blocks, catch plates.', 'Aft drain nipples, epoxied in.'], ids(/^storage-/)),
          I(`Bolt on the D-ring plates: ${tl(ids(/^lash-/))}.`, [
            `Hold each plate on the inner face of its rib head, centered on the head: the holes are ${fin(2 * LASH_HOLE_DX_IN)} apart along the gunwale and ${fin(2 * LASH_HOLE_DZ_IN)} apart up it.`,
            `Drill all ${LASH_BOLTS} holes through the plate, the head and the side in one pass with a ${fin(Math.round((LASH_BOLT_DIA_IN + 1 / 64) * 16) / 16)} bit, square to the side. The plate is the template.`,
            `${LASH_BOLTS} #8-32 × ${fin(lashBoltLength(c.p).len)} stainless machine screws each, pushed in from OUTSIDE with a ${fin(LASH_WASHER.od)} fender washer under each head on the outer band.`,
            'Nylock nuts on the plate, inside. Snug them; the ring still folds flat.',
          ]),
          I('Flag tube between the flag blocks; 3/16" drain hole just above the deck.', [], ids(/^flag-tube$/)),
          I('Lights and reflectors.', ['Lamp clips snap into the bulkhead and transom hand-holds; heat-set M4 / M3 inserts.', 'Reflectors on the gunwale outer face: wipe clean, press 60 s.'], ids(/^(lamp-clip|rear-lamp-clip|front-light|rear-light|reflector-)/)),
          I('Count the pooled fasteners against the parts list: every fastener 316 stainless.', [], ['hardware']),
        ],
        checks: ['Load test: 300 lbf pull at 45° on one D-ring; hang the sled by the bowline', 'Grab boards solid; signs stay on and do not rattle', 'Lid closes on the gasket with no gap; the stay holds'],
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
    if (t.onlyIf && !t.onlyIf(p)) continue;
    const mine: string[] = [];
    for (const x of real) {
      if (assigned.has(x.id)) continue;
      if (t.steps.includes(x.step) && t.match.test(x.id) && (!t.when || t.when(x))) {
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
    if (t.onlyIf && !t.onlyIf(p)) continue;
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
  const kneePins = !!brakeOf(p).pins;
  const titleOf = (t: Template): string => (kneePins && t.pinsTitle ? t.pinsTitle : t.title);
  const fix = (t: string): string => noIds(tidy(std ? standardText(t) : t));
  // A token for a part this model does not have (an optional part named in a template) is written as plain words.
  const known = (t: string): string => t.replace(PART_TOKEN_RE, (m, id: string) => (byId.has(id) ? m : (id as string).replace(/-/g, ' ')));
  const prune = (items: Instr[]): Instr[] => items.map((it) => ({
    ...it, text: known(it.text),
    ...(it.parts ? { parts: it.parts.filter((id) => byId.has(id)) } : {}),
    ...(it.sub ? { sub: prune(it.sub) } : {}),
  })).map((it) => (it.parts && !it.parts.length ? (({ parts: _x, ...rest }) => rest)(it) : it));
  const cardStep = Math.max(0, ordered.findIndex((o) => o.t.id === 'mill'));
  const steps: BuildStep[] = ordered.map(({ t, ids }, n) => {
    const mine = ids.map((i) => byId.get(i)!).filter(Boolean);
    const ctx: StepCtx = { parts, p, mine, by, resaw, forms, oak, cut, drawings };
    const built = t.build(ctx);
    const modelStep = mine.length ? Math.min(...mine.map((x) => x.step)) : t.steps[0];
    const items = mapInstr(prune(built.items), fix);
    // The glues this step uses: Extreme is epoxy throughout; Standard splits the joints made in this step into Titebond III and epoxy (finishing.ts `standardAdhesive`).
    const mineIds = new Set(ids);
    const top = mine.length ? Math.max(...mine.map((x) => x.step)) : 0;
    const stepOf = new Map(parts.map((x) => [x.id, x.step]));
    const made = std && mine.length
      ? glueJointEstimates(parts, (x) => mineIds.has(x.id), p).filter((g) => (g.a !== g.b || !!byId.get(g.a)?.plies) && [g.a, g.b].every((id) => mineIds.has(id) || (stepOf.get(id) ?? 0) <= top))
      : [];
    const found: GlueUse | undefined = made.length ? { epoxy: made.some((g) => g.standard === 'epoxy'), titebond: made.some((g) => g.standard === 'titebond') } : undefined;
    const use: GlueUse = built.glue ?? found ?? { epoxy: true, titebond: false };
    const cure = t.hardener && use.epoxy ? HARDENERS[t.hardener] : undefined;
    const clampCure = t.hardener ? (t.glueLine ?? glueLine(t.hardener, use, cardStep, t.coat)) : undefined;
    const step: BuildStep = {
      n,
      id: t.id,
      kind: t.kind,
      title: std ? standardText(titleOf(t)) : titleOf(t),
      goal: fix(built.goal),
      items,
      modelStep: t.kind === 'prep' ? 0 : modelStep,
      partIds: ids,
      instructions: flattenInstr(items, nameOf),
      checks: built.checks.map((x) => renderInstrText(fix(known(x)), nameOf)),
      tools: built.toolsOnly ?? (built.tools?.length ? [...t.tools, ...built.tools] : t.tools),
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
