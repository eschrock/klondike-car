/**
 * Phase 4 output 6: assembly steps.
 *
 * Built from `Part.step` (STEP / HULL_STEP in model/build-utils.ts), the hull build-sequence comment above HULL_STEP, and each part's `joints`.
 * Pure function of (parts, params). Three kinds of step:
 *   - 'prep'    preparation with no parts in the model (verify, mill, the deck cut first, the forms, seal);
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
 * details are ONE glue card (`glueCard`, a labeled box shown before the steps); each glue step's `clampCure` is a single short line naming the glue that step uses.
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
import { axleGrooveDepthIn, bowTaper, KNEE_MOUNT, PARAM_DEFS, thinSheet, WEATHER_SPEC, type Params } from '../params';
import { beamSeat, screwText } from '../model/rear-mount';
import { KING_NUT_BELOW_DECK_IN, kingHeadRelief, kingNutSlot } from '../model/frame';
import { TONGUE_SHOULDER_FILLET_IN, tongueSeatHalfWidth } from '../model/pivot';
import { boxTieGeometry, kneeScrews, lashBoltLength, sideRibStations, KNEE_SCREW_SEAT_IN, LASH_BOLT_DIA_IN, LASH_HOLE_DX_IN, LASH_BOLTS, LASH_WASHER } from '../model/side-ribs';
import { localBounds, transformPoint, worldAABB } from '../model/bounds';
import { BOARD_THICKNESSES, cutList, discStrip, edgeJointUp, LAMINATION_SEAM_OFFSET_IN, resawUsableIn, ribFillers, ribFillerSource, type CutList, type GlueUp, type ResawPool } from './cutlist';
import { EPOXY_SYSTEM, epoxyTimeFactor, finishingSchedule, glueJointEstimates } from './finishing';
import { flatPattern } from './flat';
import { analyzeShaperPart, type ShaperFeature } from './shaper-svg';
import { formDrawings, RIB_STOCK_IN, type FormDrawing } from './forms';
import { oakBoardFeet, type OakPlan } from './nesting';
import { brakeOf, partDrawings, SCREW_CLEAR, SCREW_PILOT, type DrawingFeature, type PartDrawingSheet } from './part-drawings';
import { finalFrac, fractionText, nearest32, nearestTo, roughFrac } from './units';
import { GRIP_BOLT_ROWS_IN, INSERT_DRILL_IN, latchGeometry, PIN_R_IN } from '../model/seat';
import { lidOpenAngleDeg } from '../model/storage';
import { STOP_EYE_ABOVE_DECK_IN } from '../model/brake-layout';
import { chainKeeper } from '../model/chain-keeper';
import { SQUASH_TEST_PSI, verifyChecklist, verifyGroups } from './verify';
import { stepFigures } from './figures';
import type { StepFigure } from './figures/kit';

export type StepKind = 'prep' | 'build' | 'process';
/** '556' is the hardener of the epoxy the BOM buys (`EPOXY_SYSTEM`); the West System entries stay for the Cure type's other users. */
export type Hardener = '205' | '206' | '209' | '556';
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

/** Epoxy working times at 70 °F (the named hardener; the West entries are WEST System 105). */
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
  '205': { hardener: '205', label: 'West 205 fast', potMin: [9, 12], clampHours: [5, 6], fullHours: 24 },
  '206': { hardener: '206', label: 'West 206 slow', potMin: [20, 25], clampHours: [8, 10], fullHours: 24 },
  '209': { hardener: '209', label: 'West 209 extra slow', potMin: [90, 120], clampHours: [20, 24], fullHours: 48 },
  /**
   * The bought epoxy (EPOXY_SYSTEM, both weather specs). Pot life is the vendor's list; the clamp and cure times are planning figures for a slow room-temperature epoxy (the data sheet was
   * not read): clamp overnight, full cure 7 days. The glue card tells the builder to check the can.
   */
  '556': { hardener: '556', label: `${EPOXY_SYSTEM.name} (${EPOXY_SYSTEM.ratio})`, potMin: [...EPOXY_SYSTEM.potMin], clampHours: [12, 24], fullHours: 168 },
};

/** A full-cure time in the unit a shop reads: hours up to 2 days, then days. */
export function cureTimeText(hours: number): string {
  return hours <= 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

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
  /** "What this is for": what the step makes and where it is used, for a step whose purpose is not plain from its parts (forms, milling). */
  why?: string;
  /** Labeled sketches of what the step makes or does (`figures/`). */
  figures: StepFigure[];
  /** A preparation step: the parts it makes or serves (a form's parts), highlighted in the finished sled. Empty for a build step (its `partIds` are highlighted). */
  forIds: string[];
  /**
   * The shop-cut parts (Shaper, table-saw) cut to their FINAL size and shape in this step (D-94): each such part is cut in exactly one step, at or before the step that installs it, and a
   * step that cuts a part to fit built work names the step whose work it is checked against (`cutAfter`).
   */
  cutIds: string[];
  /** The step whose built work this step's cuts are measured against (its "Before you cut" check). */
  cutAfter?: string;
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
 * Removable hardware that is fitted and drilled where it belongs, taken off for finishing and installed in the `hang` step: wheels, the front stub axles and clamp plates, roll pads, eye bolts,
 * anchors, check chains and the bridle rope; hinges, pins and cushions; handle sockets and pins; the brake flap's pin, clip, cord, snap, pad and tread.
 * Only purchased, metal and printed parts qualify: every wood part, the beams, the hold-downs, the rear axle and its clamp plates (pinned by the hold-downs), the kingpin and the sleeve stay on the hull.
 */
const HANG_RE = /^(wheel-|axle-F[LR]$|clamp-F|roll-pad-|steer-(eye|anchor|chain|keeper)-|bridle$|seat-(hinge|pin|cushion|back-pad)|storage-hinge-[LR]$|handle-(socket|pin)-|brake-(pivot-pin|pivot-clip|cord|snap|pad|foot-tread|chock-cord))/;
export const isHangPart = (x: Part): boolean => (x.kind === 'purchased' || x.kind === 'metal' || x.kind === 'printed') && HANG_RE.test(x.id);

/** Steps whose parts have a later model step than the step's position: the brake knees (`STEP.brake`, but fitted while the hull is inverted, before the underside finish) and the grab boards (`STEP.finish`, but bolted on for good before the finish, D-94). */
export const EARLY_STEP_IDS: ReadonlySet<string> = new Set(['brake-knees', 'side-holes']);
const EARLY_RE = /^brake-(backer|knee)-[LR]$/;
export const isEarlyBrakePart = (x: Part): boolean => EARLY_RE.test(x.id);

interface Built { goal: string; items: Instr[]; checks: string[]; /** The glues the step uses, when the parts' joints do not say (a prep step). */ glue?: GlueUse }

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
  /** "What this is for" (may use `[[step:id]]`): see `BuildStep.why`. */
  why?: string | ((c: StepCtx) => string | undefined);
  /** A preparation step: the parts it makes or serves, by id (see `BuildStep.forIds`). */
  forParts?: RegExp;
  /**
   * D-94: parts this step cuts to their final size and shape although another step installs them, or that must be cut here to fit built work. Every other shop-cut part is cut in the first
   * step that names it (else the step that installs it). The step opens with a "Before you cut" check.
   */
  cuts?: RegExp;
  /** D-94: the step whose built work the `cuts` are measured against (it comes earlier in the book). */
  cutAfter?: string;
  /** A different title for a setting of the design (the brake knees step, D-78). */
  retitle?: (p: Params) => string | undefined;
  /** A different glue line for a setting of the design (the handle sockets are bedded in epoxy under the Standard spec, D-83). */
  reglue?: (p: Params) => string | undefined;
  /** A different tool list for a setting of the design (the brake knees step with removable knees, D-78). */
  retools?: (p: Params) => string[] | undefined;
}

// ---- helpers ----

/** D-78: removable brake knees (fitted dry, taken off with a ratchet and wrench). */
const isRemovable = (p: Params): boolean => p.kneeMount === KNEE_MOUNT.removable;
/** D-78: how tight the knee bolts go, as the shop reads it. */
const kneeTighten = (_p: Params): string => 'snug, then a quarter turn; more crushes the washers and the oak';

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
/** A layout number that needs no fit precision: the nearest 1/16" (a bench or jig size, a station for a screw pilot), the nearest 1/8", or the nearest 1/2" for a spacing said as "about". */
const near16 = (v: number): string => `${fractionText(nearestTo(v, 1 / 16), 16)}"`;
const near8 = (v: number): string => `${fractionText(nearestTo(v, 1 / 8), 8)}"`;
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "Two" for 2 (a count in running text). */
const numWord = (n: number): string => ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][n] ?? String(n);
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
 * The chine-to-rail tie (side sandwich to rail): NO Dominos (D-81). A thickened-epoxy bed on the bearing face, and #8 stainless screws up through the rail into the side sandwich in every gap at even
 * spacing; they locate the side. Read from the rail's own screw joints, so the steps follow the model: how many a rail, the screw, and the centers' spacing.
 */
export interface ChineTie { perRail: number; screw: string; /** Average distance between screw centers (in), 0 when there is one. */ spacingIn: number; /** Centers from the rear end of the rail (in), ascending. */ centers: number[] }
export function chineTie(parts: Part[]): ChineTie {
  const rail = parts.find((q) => q.id === 'rail-L');
  const js = (rail?.joints ?? []).filter((j) => j.type === 'screw' && /chine/.test(j.to));
  const perRail = js.reduce((s, j) => s + j.count, 0);
  const fit = js.find((j) => j.fit)?.fit;
  const xs = rail ? js.flatMap((j) => (j.at ?? []).map((a) => transformPoint(rail.transform, a))).map((q) => q[0]) : [];
  const x0 = rail ? worldAABB(rail).min[0] : 0;
  const centers = [...new Set(xs.map((v) => +(v - x0).toFixed(3)))].sort((a, b) => a - b);
  const head = /trim-head/.test(js[0]?.size ?? '') ? ' trim-head' : ''; // D-91: the rail-to-chine screws are trim-head
  return { perRail, screw: fit ? `${screwText(fit)}"${head}` : `#8 × 2-1/2"${head}`, spacingIn: centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : 0, centers };
}

/**
 * The Standard spec's drilled drain holes (D-83; the Extreme spec has stainless nipples instead, so none of these joints exist there). From the model's own hole joints:
 *   - sides: distance forward of the web's rear end, and the hole center's height up from the web's bottom edge (the edge that rests on the rail), for the drains of the left side (the right is the mirror);
 *   - box: the two holes through the deck at the aft corners of the box: distance forward of the transom's outer face, and off the centerline.
 */
export interface DrainHoles {
  /** The side drain's diameter (in). */
  diaIn: number;
  side: { xs: number[]; upIn: number; lowerEdgeIn: number; /** How far the rear transom's inner face lies in front of the web's rear end (the web end sits in the transom dado). */ faceInIn: number } | null;
  /** The box-floor drains: how many, their diameter (in), the host ('deck' = the box floor, or the raised box's own bottom panel). */
  box: { count: number; diaIn: number; host: string; xs: number[]; offCenter: number[] } | null;
}
export function drainHoles(parts: Part[], p: Params): DrainHoles | null {
  const isDrain = (j: Joint): boolean => j.type === 'hole' && /drain hole/.test(j.size ?? '');
  const web = parts.find((x) => x.id === 'side-L-web');
  const boxHost = parts.find((x) => (x.id === 'deck' || x.id === 'storage-bottom') && (x.joints ?? []).some(isDrain));
  const sideJ = (web?.joints ?? []).filter(isDrain);
  const boxJ = (boxHost?.joints ?? []).filter(isDrain);
  if (!sideJ.length && !boxJ.length) return null;
  const L = computeLayout(p);
  let side: DrainHoles['side'] = null;
  const dia = sideJ[0]?.diaIn ?? p.scupperDiaIn;
  if (web && sideJ.length) {
    const wb = worldAABB(web);
    const q = sideJ.flatMap((j) => (j.at ?? []).map((a) => transformPoint(web.transform, a)));
    const ups = [...new Set(q.map((v) => +(v[2] - wb.min[2]).toFixed(3)))];
    // ONE datum for both holes, the same as the part drawings: the inner face of the rear transom (the web's rear end sits in the transom dado, behind that face; the bands start at it).
    // Distances run along the web (its developed length, the way a tape follows it), from the web's own local frame.
    const lb = localBounds(web.geometry);
    const tr = parts.find((x) => x.id === 'transom-rear');
    const shift = tr ? wb.min[0] - worldAABB(tr).max[0] : 0;
    const local = sideJ.flatMap((j) => (j.at ?? []).map((a) => a[0] - lb.min[0] + shift));
    side = { xs: local.map((v) => +v.toFixed(3)).sort((a, b) => a - b), upIn: ups[0] ?? 0, lowerEdgeIn: (ups[0] ?? 0) - dia / 2, faceInIn: -shift };
  }
  let box: DrainHoles['box'] = null;
  if (boxHost && boxJ.length) {
    const q = boxJ.flatMap((j) => (j.at ?? []).map((a) => transformPoint(boxHost.transform, a)));
    box = { count: q.length, diaIn: boxJ[0].diaIn ?? p.storageDrainDiaIn, host: boxHost.id, xs: [...new Set(q.map((v) => +(v[0] - L.xRear).toFixed(3)))].sort((a, b) => a - b), offCenter: [...new Set(q.map((v) => +Math.abs(v[1]).toFixed(3)))].sort((a, b) => a - b) };
  }
  return { diaIn: dia, side, box };
}

/**
 * The EVA seat pads (D-83): three 11" × 18" × 1-1/2" kneeling pads. The cushion is one whole pad plus a strip of the second, edge-glued; the back pad is the third, trimmed.
 * Sizes read from the model's own two parts (bounds), to the nearest 1/8"; null when the model has no cushion.
 */
export function evaPads(c: Pick<StepCtx, 'by' | 'p'>): { padText: string; cushionText: string; widthText: string; stripCutText: string; backText: string; stripLenText: string; stripInText: string; backStripText: string; cushionRearText: string } | null {
  const cu = c.by('seat-cushion'), bp = c.by('seat-back-pad');
  if (!cu || !bp) return null;
  const PAD_L = 11, PAD_W = 18;
  const cb = worldAABB(cu), cl = cb.max[0] - cb.min[0], cw = cb.max[1] - cb.min[1];
  const up8 = (v: number): number => Math.ceil(v * 8 - 1e-6) / 8;
  const bb = localBounds(bp.geometry), bw = bb.max[0] - bb.min[0], bh = bb.max[1] - bb.min[1];
  const strip = Math.max(0, cl - PAD_L);
  const L = computeLayout(c.p);
  const x = (v: number): string => finalFrac(v);
  return {
    padText: `${PAD_L}" × ${PAD_W}" × ${x(c.p.seatCushionIn)} EVA`,
    cushionText: `${x(cl)} × ${x(cw)}`,
    widthText: x(cw),
    stripCutText: x(up8(strip + 1 / 8)),
    backText: `${x(up8(bw))} wide × ${x(up8(bh))} tall`,
    stripLenText: x(Math.round((cl - 2) * 2) / 2),
    stripInText: '4"',
    backStripText: x(Math.floor((bw - 4) * 2) / 2),
    cushionRearText: x(Math.round((cb.min[0] - L.xRear) * 8) / 8),
  };
}

/** The number of a finishing-schedule step by its id (for the Extreme spec's "Finishing, steps 3-4"); the schedule is the one place the numbers live. */
function stepNo(c: Pick<StepCtx, 'parts' | 'p'>, id: string): number | string {
  return finishingSchedule(c.parts, c.p).steps.find((q) => q.id === id)?.n ?? '?';
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
 * The ONE short glue line of a step (`clampCure`), naming the glue the step actually uses and pointing at the glue card: "Epoxy: clamp 8-10 h, full cure 24 h (glue card)".
 * Under 90 characters. `coat` is for a step that brushes epoxy on (a coat, not a clamped joint).
 */
export function glueLine(h: Hardener, use: GlueUse, coat = false): string {
  const c = HARDENERS[h];
  const epoxy = coat ? `Epoxy coat: handle after ${hRange(c.clampHours)} h, full cure ${cureTimeText(c.fullHours)}` : `Epoxy: clamp ${hRange(c.clampHours)} h, full cure ${cureTimeText(c.fullHours)}`;
  const tb = 'Titebond III: clamp 30-60 min, full strength in 24 h';
  const ref = ' (glue card)';
  if (use.titebond && use.epoxy) return `Titebond III 30-60 min, epoxy ${hRange(c.clampHours)} h; full cure ${cureTimeText(c.fullHours)}${ref}`;
  return `${use.titebond && !use.epoxy ? tb : epoxy}${ref}`;
}

/**
 * The GLUE CARD: which glue goes where, with the working times, in one place: a labeled box shown before the steps (the build panel and the build book), not a step item. Every glue step has only its one-line `clampCure`, which points back to it.
 * The epoxy facts (ratio, hardener, pot life, thickener) are `EPOXY_SYSTEM` in finishing.ts, the kit the BOM buys under both weather specs; the times come from the HARDENERS table
 * and `epoxyTimeFactor` (the cold-shop multiplier).
 */
export function glueCard(p: Params): Instr {
  const c = HARDENERS['556'];
  const k = epoxyTimeFactor(60);
  const r = (lo: number, hi: number): string => `${f(lo * k, 0)}-${f(hi * k, 0)}`;
  const std = isStandard(p);
  const E = EPOXY_SYSTEM;
  return I('GLUE CARD (read once, before the first glue-up): each glue step has one line that points back here.', [
    I(std ? 'Which glue: one glue per glue-up. Epoxy for the laminations, the deck, fillets and tape, thickened bedding, and every other joint glued in the same session as one of those; Titebond III for the glue-ups that are wood-to-wood throughout (the hangers and backers, the edge-glued panels). Each step says which.' : 'Which glue: epoxy for every glue joint (Extreme weather).'),
    ...(std
      ? [I('Titebond III:', [
        'Thin coat on both faces; open time about 10 min, so have the clamps set out.',
        'Clamp 30-60 min; full strength in 24 h.',
        'Wipe squeeze-out at once with a damp rag: dried glue seals the wood and shows as a pale patch under the clear finish.',
        'Do not glue below 47 °F.',
      ])]
      : []),
    I(`Epoxy (${E.name}, ${E.ratioText}):`, [
      `Measure with ${E.pumps}: full strokes, as the set's label says, and stir for 2 minutes, scraping the sides and bottom of the cup.`,
      `Pot life is about ${hRange(c.potMin)} min at 70 °F for a small batch (the vendor's list: check the can). Mix small batches in a wide, shallow container and pour leftovers thin into a tray.`,
      `Clamp overnight, ${hRange(c.clampHours)} h at 70 °F; full cure about ${cureTimeText(c.fullHours)}. These times are planning figures, not the data sheet's: check the can and go by it if it says longer.`,
      `The resin is thin and runs out of a joint, so thicken it with ${E.thickener} (wear a dust mask; stir it in a little at a time): to the thickness of ketchup for gluing, and of peanut butter for fillets, bedding and gap-filling.`,
      `Where a fillet, plug bed or gap-fill shows and should match the oak, stir in ${E.colorMatch} (from your own sanding) in place of some of the silica.`,
      'For laminating, roll it on both faces and add only a spoonful of silica a cup, so the joint is not starved.',
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
/** The deck's half width at x (its +y edge, model frame), from its outline: the deck is the reference the frame and the sides are checked against (D-94). */
function deckEdgeHalf(deck: Part | undefined, x: number): number | undefined {
  if (!deck || deck.geometry.type !== 'extrusion') return undefined;
  const pts = deck.geometry.outline.map((q) => transformPoint(deck.transform, [q[0], q[1], 0])).filter((q) => q[1] > 0).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= x - 1e-9) { const a = pts[i - 1], b = pts[i]; const t = b[0] - a[0] > 1e-9 ? (x - a[0]) / (b[0] - a[0]) : 0; return a[1] + t * (b[1] - a[1]); }
  }
  return pts.length ? pts[pts.length - 1][1] : undefined;
}
/** The length of the deck's +y edge along its curve, rear corner to bow corner (in): the length a flexible tape reads, the same as the web's bottom edge. */
function deckEdgeLength(deck: Part | undefined): number | undefined {
  if (!deck || deck.geometry.type !== 'extrusion') return undefined;
  const pts = deck.geometry.outline.map((q) => transformPoint(deck.transform, [q[0], q[1], 0])).filter((q) => q[1] > 0).sort((a, b) => a[0] - b[0]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return pts.length > 1 ? len : undefined;
}
/** The parameter label of the thin sheet's thickness (the sheet this design uses), as the parameters panel shows it. */
const thinLabel = (p: Params): string => { const k = thinSheet(p).key; return PARAM_DEFS[k === 1 ? 'whiteOakPlyThickIn' : k === 3 ? 'balticThinThickIn' : k === 4 ? 'balticSixThickIn' : 'panelPlyIn'].label; };
/** A width to the nearest 1/64 (a CNC part checked with calipers or a rule read to 1/64). */
const fin64 = (v: number): string => `${fractionText(nearestTo(v, 1 / 64), 64)}"`;

/** The Shaper file's features of part `id` (empty when it is not a Shaper part), cached per model. */
const SHAPER_CACHE = new WeakMap<Part[], Map<string, ShaperFeature[]>>();
function shaperFeaturesOf(c: Pick<StepCtx, 'parts' | 'p' | 'by'>, id: string): ShaperFeature[] {
  let m = SHAPER_CACHE.get(c.parts);
  if (!m) SHAPER_CACHE.set(c.parts, (m = new Map()));
  let f = m.get(id);
  if (!f) {
    const part = c.by(id);
    try {
      f = part && part.fab === 'shaper-origin' ? (analyzeShaperPart(part, c.parts, c.p)?.features ?? []) : [];
    } catch {
      f = [];
    }
    m.set(id, f);
  }
  return f;
}
/**
 * A hole the Shaper file of part `id` already cuts right through (an inside cut, not a drill mark), so no later step drills a second one: the first feature that passes `test`.
 * A drill mark (`kind: 'drill'`) is only marked by the file and is drilled at the step that names it.
 */
function fileCutHole(c: Pick<StepCtx, 'parts' | 'p' | 'by'>, id: string, test: (f: ShaperFeature) => boolean): ShaperFeature | undefined {
  return shaperFeaturesOf(c, id).find((f) => f.kind === 'hole' && !f.approx && test(f));
}
const diaNear = (f: ShaperFeature, d: number | undefined): boolean => d !== undefined && f.diaIn !== undefined && Math.abs(f.diaIn - d) < 0.01;

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
/** The bit of a hole feature from its size ("7/64" pilot, ..." gives 7/64"). */
const bitOf = (q: DrawingFeature | undefined, fallback: string): string => { const m = new RegExp(`^(${FR})"`).exec(q?.size ?? ''); return m ? `${m[1]}"` : fallback; };
/** The cotter cross holes of an axle from its drawing features: "Ø5/32" straight through the rod, 3/8" from each end" (the second distance is measured from the other end). */
function cotterText(fs: DrawingFeature[], rodLen: number | undefined, datum: string): string | undefined {
  const st = fs.flatMap((q) => stations(q, datum));
  if (!st.length) return undefined;
  const bit = bitOf(fs[0], '');
  const a = Math.min(...st), b = rodLen ? rodLen - Math.max(...st) : a;
  const where = st.length > 1 && rodLen ? (Math.abs(a - b) < 1 / 32 ? `${fin(a)} from each end` : `${fin(a)} from one end and ${fin(b)} from the other`) : `${fin(a)} from the ${lc(datum)}`;
  return `${bit ? `${bit} ` : ''}straight through the rod, ${where}`;
}
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
/**
 * The chain-anchor holes in the chain crossmember, from the CENTER LINE: in the bow taper its ends are scribed to the bent rails (cut to the long point at the rear face, frame.ts), so a
 * position "from the left end" would depend on which face it is measured on. Undefined when the model does not record the points.
 */
function anchorHolesText(c: StepCtx, fs: DrawingFeature[]): string | undefined {
  const j = c.by('joist-6');
  if (!j) return undefined;
  const pts = (j.joints ?? []).filter((q) => /^steer-anchor/.test(q.to)).flatMap((q) => (q.at ?? []).map((a) => transformPoint(j.transform, a)));
  if (pts.length !== 2) return undefined;
  const off = pts.map((q) => Math.abs(q[1])), up = pts.map((q) => q[2] - worldAABB(j).min[2]);
  if (Math.abs(off[0] - off[1]) > 1 / 64 || Math.abs(up[0] - up[1]) > 1 / 64) return undefined;
  const dia = new RegExp(`^(${FR})"`).exec(fs[0]?.size ?? '')?.[1];
  return `2 holes${dia ? ` Ø${dia}"` : ''} in the rear face, ${fin(off[0])} either side of the center line (measure from the center: the ends are scribed to the rails), ${fin(up[0])} from the bottom face`;
}

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
  // Name the board thickness (4/4, 5/4) where the text names the board: "a 10"-wide 4/4 board", "2 boards of 5/4, each 7" wide".
  const rip = cap(pool.ripText).replace(/\b(\d+) boards\b/, `$1 boards of ${pool.board}`).replace(/\bboard first\b/, `${pool.board} board first`);
  const board = BOARD_THICKNESSES.find((b) => b.nominal === pool.board);
  const usable = board ? resawUsableIn(board, c.p) : undefined;
  // The lanes in words: how many of each width, what the odd width is for, and which lanes are the spares (round-2 readability).
  const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const nw = (n: number): string => NUMW[n] ?? String(n);
  const spareN = Math.max(0, pool.ripLanes - pool.lanes);
  const widths = [...pool.laneWidthsIn, ...Array(spareN).fill(pool.laneWidthsIn[0])] as number[];
  const byW = [...new Set(widths)].map((w) => ({ w, n: widths.filter((x) => x === w).length, uses: [...new Set(pool.laneStrips.filter((_, i) => pool.laneWidthsIn[i] === w).flat().map((q) => c.cut().strips.find((r) => r.ids.includes(q.id))?.name ?? ''))] }));
  const useText = (names: string[]): string => { const m = names.length === 1 ? /^(.*) \((\w+)\)$/.exec(names[0]) : null; return m ? ` (the ${m[2]} ${m[1].toLowerCase()}s)` : ''; };
  const lanesText = byW.length === 1
    ? `${pool.ripLanes} lanes, all ${fin(byW[0].w)}${spareN ? `; ${spareN === 1 ? `lane ${pool.ripLanes} is the spare` : `lanes ${pool.lanes + 1}${spareN === 2 ? ' and ' : ' to '}${pool.ripLanes} are spares`}` : ''}`
    : `${pool.ripLanes} lanes: ${byW.map((g, i) => `${nw(g.n)} at ${fin(g.w)}${byW.length > 1 && i > 0 ? useText(g.uses) : ''}`).join(' and ')}${spareN === 1 ? `; lane ${pool.ripLanes} (${fin(widths[widths.length - 1])}) is the spare` : spareN > 1 ? `; lanes ${pool.lanes + 1}${spareN === 2 ? ' and ' : ' to '}${pool.ripLanes} are spares` : ''}`;
  const perBoard = Math.ceil(pool.ripLanes / Math.max(1, pool.boards));
  const needW = perBoard * pool.laneWidthsIn[0] + (perBoard - 1) * c.p.resawKerfIn;
  return [
    I(`${rip}: ${lanesText}.`, pool.boards > 1 ? [`Each board must still be ${fin(needW)} wide after one edge is jointed straight (${nw(perBoard)} lanes and the saw kerf): check before ripping, or take a wider board.`] : []),
    I(`Then resaw each lane on edge into ${plural(k, 'slab')}, about ${fin(pool.roughT)} each: ${pool.resawHeightText}. Never stand the whole board on edge.${pool.withinCapacity ? '' : ' TOO TALL for your bandsaw: the strip is wider than the saw can cut.'}`, usable !== undefined ? [`Joint one face of the rough board, but do not plane it to its finished thickness first: ${plural(k, 'slab')} of ${fin(pool.roughT)} and the saw kerf need about ${fin(usable)} of it.`] : []),
    I(`That gives ${pool.stripSlots} strips for the ${strips} needed: ${pool.spares <= 0 ? 'no spare, so a strip that cracks on the form means another board' : `${plural(pool.spares, 'spare')} for the bend test`}.`),
  ];
}

/** The rough widths of the boards of each layer of a plain edge-glued face laminate (the tongue, the bow bulkhead), from the cut list's own layer cuts; layer 1 first, board 1 first. */
function layerBoardWidths(c: StepCtx, g: GlueUp): number[][] {
  const cuts = c.cut().cuts.filter((q) => q.piece === 'layer' && q.glueUp === g.label);
  return [...Array(g.layers)].map((_, i) => cuts.filter((q) => q.layer === i + 1).sort((a, b) => a.index - b.index).map((q) => Math.ceil(q.rough.w * 8 - 1e-6) / 8));
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
          return [I(`${centerOnly ? 'Only the center layer is edge-glued' : `Only ${glued.length === 1 ? `layer ${glued[0].layer}` : 'the layers that need it'} ${glued.length === 1 ? 'is' : 'are'} edge-glued`}: its joint is ${fin(joint)} up from the bottom edge of the finished knee, clear of the bolt holes. The upright layers are glued over it.`)];
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
  sub.push(I('The upright layers run long grain from the bottom of the leg to the top, so the bolted leg cannot split off the rail; the center layer runs across the sled. Use quartersawn or rift boards if you can.'));
  if (part?.partNo === 'brake-knee') {
    const pv = bg.pivot, kn = bg.knee;
    const front = kn.layers[kn.layers.length - 1];
    sub.push(I(`Cut the flap pocket in the rear layer (layer 1) and the center layer (layer 2) BEFORE the glue-up: a notch ${fin(pv.ySlot[1] - pv.ySlot[0])} deep in from the outboard edge, ${near16(pv.zPocketBot - kn.zBot)} to ${near16(pv.zPocketTop - kn.zBot)} up from the bottom edge of the finished knee.`, [
      'Mark the finished knee\'s bottom and outboard edges on each layer first: the layers are oversize, so measure from those marks.',
      'Bandsaw it and chisel the corners square; line the two notches up when you stack the layers.',
      `Leave the front layer whole: the pocket is recessed about ${fractionText(Math.round(Math.max(0, pv.slotEndX - front.x0) * 16) / 16, 16)}" into it after the glue-up, when the knee is shaped.`,
    ]));
  }
  sub.push(I(`Mill the cured block to ${g.finalText.replace(/ across$/, ' across the sled').replace(/ \u00d7 /g, ', ')} before it is sawn to shape.`));
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

/** Steepest angle (degrees) the bent rails make with the centerline in the bow taper: where the crossmember and king-beam ends meet them. */
export function maxTaperAngleDeg(p: Params): number {
  const L = computeLayout(p);
  if (L.taper.x1 - L.taper.x0 < 1e-6) return 0;
  const xs = samples(L.taper.x0, L.taper.x1, 120);
  let m = 0;
  for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.atan(Math.abs(L.turnIn(xs[i]) - L.turnIn(xs[i - 1])) / (xs[i] - xs[i - 1])));
  return (m * 180) / Math.PI;
}

/**
 * Shop constants for the dry-fit station cradles (3/4" MDF plates, not sled parts): a post this wide outside each side's slot, standing this far above the sides'
 * bottom edges; the edges this far above the tallest side's sheer (so its rear end clears the floor); the plate's middle cut down this far below the inner chine
 * band; the slot this much wider than the side crosses it.
 */
export const CRADLE_POST_W_IN = 1.5;
export const CRADLE_POST_ABOVE_IN = 1;
export const CRADLE_FLOOR_CLEAR_IN = 0.5;
export const CRADLE_BAND_CLEAR_IN = 0.5;
export const CRADLE_SLOT_CLEAR_IN = 1 / 16;
/** The cradle plates are 3/4" MDF. */
export const CRADLE_PLATE_T_IN = 0.75;

/** How to drill stainless plate, told once, at the first stainless part drilled (the knee backing plates, frame step); later steps point back to it. */
export const STAINLESS_DRILLING = 'Drilling stainless: center-punch every mark, use a cobalt bit (a plain bit dulls at once), run the drill press SLOW (about 300 rpm), press hard and steadily so it keeps cutting, and flood the bit with cutting oil. A bit that rides without cutting work-hardens the steel: stop, back off and re-sharpen.';

/** The heights every cradle shares, from the floor: the sides' bottom edges, the post tops, and the plate's cut-down middle. */
export function cradleHeights(p: Params): { edgeIn: number; postIn: number; middleIn: number } {
  const L = computeLayout(p);
  const hMax = sideTopAt(L, L.xSideStart) - L.chineBot; // the side is tallest at its rear end
  const edgeIn = Math.ceil(hMax + CRADLE_FLOOR_CLEAR_IN);
  return { edgeIn, postIn: edgeIn + CRADLE_POST_ABOVE_IN, middleIn: Math.floor(edgeIn - L.railBand - CRADLE_BAND_CLEAR_IN) };
}

/**
 * Station cradles for the inverted sides: model x, the hull's outside width and the side height at that station, and the plate cut from them (its width with the
 * two posts, the slot floor's height from the floor, the slot width where the side crosses at an angle in the bow taper).
 */
export function cradleStations(p: Params): { x: number; widthIn: number; heightIn: number; plateWidthIn: number; slotFloorIn: number; slotWidthIn: number; angleDeg: number }[] {
  const L = computeLayout(p);
  const { edgeIn } = cradleHeights(p);
  return [0.08, 0.38, 0.68, 0.94].map((u) => {
    const x = L.xSideStart + u * (L.xSideEnd - L.xSideStart);
    const widthIn = 2 * outerHalfWidth(L, x), heightIn = sideTopAt(L, x) - L.chineBot;
    const a = Math.atan(Math.abs(L.turnIn(x + 0.25) - L.turnIn(x - 0.25)) / 0.5);
    const slotWidthIn = Math.ceil((L.side / Math.cos(a) + CRADLE_PLATE_T_IN * Math.tan(a) + CRADLE_SLOT_CLEAR_IN) * 16) / 16; // a side crossing the plate at an angle needs the plate's thickness too
    return { x, widthIn, heightIn, plateWidthIn: widthIn + 2 * CRADLE_POST_W_IN, slotFloorIn: edgeIn - heightIn, slotWidthIn, angleDeg: (a * 180) / Math.PI };
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
/**
 * The small vent holes in the transom's Shaper file (they let the air and epoxy out of the dados while the transom slides on), from the part's own outline holes: their diameter and, for each
 * distinct place, how far it is off the centerline (either side) and up from the transom's bottom edge. Empty when the model has none.
 */
export function transomVents(parts: Part[]): { dia: number; places: Array<{ off: number; up: number }> } {
  const g = parts.find((x) => x.id === 'transom-rear')?.geometry;
  if (!g || g.type !== 'extrusion') return { dia: 0, places: [] };
  const zMin = Math.min(...g.outline.map((q) => q[1]));
  const small = (g.holes ?? []).filter((h) => Math.max(...h.map((q) => q[0])) - Math.min(...h.map((q) => q[0])) < 0.3 && Math.max(...h.map((q) => q[1])) - Math.min(...h.map((q) => q[1])) < 0.3);
  const key = new Map<string, { off: number; up: number }>();
  for (const h of small) {
    const cy = h.reduce((a, q) => a + q[0], 0) / h.length, cz = h.reduce((a, q) => a + q[1], 0) / h.length;
    key.set(`${Math.abs(cy).toFixed(2)}|${cz.toFixed(2)}`, { off: Math.abs(cy), up: cz - zMin });
  }
  const dia = small.length ? Math.max(...small[0].map((q) => q[0])) - Math.min(...small[0].map((q) => q[0])) : 0;
  return { dia, places: [...key.values()].sort((a, b) => b.off - a.off) };
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
/** The holes of drawing features, one per hole, by station from the rear end: the station and the cross position as the drawing words them, and whether the hole is counterbored. */
function holeList(fs: DrawingFeature[]): Array<{ s: string; at: number; off: string; bored: boolean }> {
  const out: Array<{ s: string; at: number; off: string; bored: boolean }> = [];
  for (const f of fs) {
    const bored = /counterbore/.test(f.size ?? '');
    for (const t of f.positions ?? []) {
      const m = /^(.*?)" from the rear end, (.*)$/.exec(lc(t));
      if (!m) continue;
      for (const v of m[1].matchAll(new RegExp(`(${FR})`, 'g'))) out.push({ s: v[1], at: parseFrac(v[1]), off: m[2], bored });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

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

/** The steps of a form drawing that are the glue-up, not the making of the form: the clamps, the cure and the spring-back test belong to the glue steps and the bend test. */
const FORM_GLUE_RE = /^(CLAMP|GLUE-UP|SPRING-BACK)\b/;

/**
 * Bench and jig sizes need no fit precision: a number in 32nds or 64nds with a whole part ("20-11/32"") goes to the nearest 1/16", and an "at least" size up to the next 1/8".
 * A band thickness (a fraction with no whole part, or one followed by "×") is left alone.
 */
function loosen(t: string): string {
  return t
    .replace(/at least ([\d\-/]+)" × ([\d\-/]+)"/g, (_m, a: string, b: string) => `at least ${roughFrac(parseFrac(a))} × ${roughFrac(parseFrac(b))}`)
    .replace(/(\d+-\d+\/(?:32|64))"(?! ×)/g, (_m, v: string) => near16(parseFrac(v)));
}

/** What a form drawing says about making the form: its steps without the glue-up, one release method (packing tape), bench and jig numbers loosened. */
function formMaking(items: Instr[]): Instr[] {
  return mapInstr(items.filter((q) => !FORM_GLUE_RE.test(q.text)), (t) => loosen(t.replace(/ \(or two coats of paste wax\)/, '')));
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

/** The dry fit's numbers, shared by the two dry-fit steps (the frame in the sides, then the rail ends and the pilots). */
function dryFitData(c: StepCtx) {
      const L = computeLayout(c.p);
      const web = c.by('side-L-web');
      const tie = chineTie(c.parts);
      const pilots = featsAll(c, 'side-L-chine', 'hole', (q) => (q.to ?? []).some((t) => /^rail-/.test(t)));
      const pilotXs = [...new Set(pilots.flatMap((q) => stations(q, 'REAR end')))].sort((a, b) => a - b);
      const net = web ? flatPattern(web)?.widthIn : undefined;
      const webBox = web ? worldAABB(web) : undefined;
      const web0 = webBox ? webBox.min[0] : L.xSideStart;
      const cradles = cradleStations(c.p);
      const ch = cradleHeights(c.p);
      const tMort = feat(c, 'rail-L', 'mortise', (q) => q.face === 'rear end');
      const bMort = feat(c, 'rail-L', 'mortise', (q) => q.face === 'front end');
      // How far the web ends stand past the band ends (they go into the dados), the rail ends from the deck ends, and whether the deck is at its final length.
      const bandBox = c.by('side-L-chine') ? worldAABB(c.by('side-L-chine')!) : undefined;
      const railBox = c.by('rail-L') ? worldAABB(c.by('rail-L')!) : undefined;
      const deckBox = c.by('deck') ? worldAABB(c.by('deck')!) : undefined;
      const into = webBox && bandBox ? bandBox.min[0] - webBox.min[0] : c.p.deckCaptureDepthIn;
      const railIn = deckBox && railBox ? railBox.min[0] - deckBox.min[0] : into;
      const deckFinal = !!(deckBox && webBox && Math.abs(deckBox.min[0] - webBox.min[0]) < 1 / 32 && Math.abs(deckBox.max[0] - webBox.max[0]) < 1 / 32);
      // The tape flag on the pilot bit: the rail's depth at the hole plus the pilot's depth (the rail is shallow ahead of its step).
      const rail0 = railBox ? railBox.min[0] : L.xSideStart;
      const railDepthAt = (station: number): number => (rail0 + station > L.railStepX ? L.railDepthF : c.p.railDepthIn);
      const cb = /with a ([\d\-/]+)" × [\d\-/]+" counterbore/.exec(feat(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /chine/.test(t)) && /counterbore/.test(q.size ?? ''))?.size ?? '')?.[1];
      const flagText = (q: DrawingFeature): string => {
        const st = stations(q, 'REAR end');
        const depth = /,\s*([\d\-/]+)" deep/.exec(q.size ?? '')?.[1];
        if (!st.length || !depth) return '';
        const rd = railDepthAt(st[0]);
        const fwd = st.length === 1 && rd < c.p.railDepthIn ? `, the forward one, ${fin(st[0])} from the rear end, where the rail is only ${fin(rd)} deep` : '';
        return `${fwd}; flag the bit ${fin(rd + parseFrac(depth))} from its tip (the rail${fwd ? '' : `, ${fin(rd)} deep,`} plus the pilot)`;
      };
  return { L, web, tie, pilots, pilotXs, net, webBox, web0, cradles, ch, tMort, bMort, bandBox, railBox, deckBox, into, railIn, deckFinal, cb, flagText };
}

const TEMPLATES_1: Template[] = [
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
      return {
        goal: 'Prove the wheels, steel and plywood against the design before anything is committed.',
        items: [
          ...verifyGroups(all).map((g) => I(g.text, g.titles)),
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
    why: 'Every oak part starts here. Thick parts are glued up from layers of stock boards, the bent parts (rails and side bands) get thin resawn strips, and everything is milled a little oversize, so the later steps cut each part to its final shape.',
    tools: ['jointer', 'planer', 'table saw', 'bandsaw', 'planer sled or drum sander', 'moisture meter', 'cauls and clamps (panel glue-ups)'],
    hardener: '556',
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
      const laminated = new Set(face.flatMap((g) => g.ids));
      const blanks = [['brake-knee-L', 'brake-knee-R'], ['brake-shoe-L', 'brake-shoe-R'], ['brake-chock-L', 'brake-chock-R'], ['handle-bar']]
        .filter((ids) => ids.every((id) => c.by(id)) && !laminated.has(ids[0]))
        .map((ids) => I(`${tl(ids)}: ${b(ids[0])}.`));
      return {
        goal: 'Turn the boards into rough parts, glued blocks and bending strips, ready for the joinery.',
        glue: { epoxy: !std || face.length > 0, titebond: std && edge.length > 0 },
        items: [
          I('Mill every solid oak part to its rough size in the cut list.', [
            'The cut list already has the rough sizes, rounded up to 1/8" and with the allowances in.',
            `The rule: a plain part is ${fin(allow)} thicker, ${fin(c.p.roughWidthAllowanceIn)} wider and ${fin(c.p.roughLengthAllowanceIn)} longer than finished.`,
            `A glued-up piece (laminated layers, edge-glued boards, bent strips) is ${fin(c.p.laminateWidthAllowanceIn)} wider and ${fin(c.p.laminateLengthAllowanceIn)} longer, because it comes out of the clamps askew.`,
            face.length ? `A glued block loses at least ${fin(c.p.laminationCleanupIn)} of thickness to jointing and planing after the glue-up.` : false,
            `A board gives less than its name: 4/4 planes to ${fin(c.p.boardYield44In)}, 5/4 to ${fin(c.p.boardYield54In)}.`,
            'The lumber list has only 4/4 and 5/4 white oak. Anything thicker (the tongue, the king beam, the crossmember at the chain, the bow bulkhead, the stop blocks, the handlebow) is glued up from layers of stock boards, next.',
            'Sticker what is not used today and keep it at 6-9 % moisture.',
          ]),
          ...(edgeShown.length
            ? [I('Edge-glue the wide boards first, the panels and the wide layers: they must cure before the planer and the Shaper.', [
              ...edgeShown.map((g) => {
                if (g.kind !== 'both') {
                  const bw = c.cut().cuts.filter((q) => q.piece === 'board' && q.glueUp === g.label).sort((a, b) => a.index - b.index).map((q) => `${fractionText(Math.ceil(q.rough.w * 8 - 1e-6) / 8, 8)}"`);
                  return I(`${tl(g.ids)}: ${plural(g.edgeBoards, 'board')} across${bw.length === g.edgeBoards ? (new Set(bw).size === 1 ? `, each ${bw[0]} wide (cut list)` : `, ${bw.join(', ').replace(/, ([^,]*)$/, ' and $1')} wide (cut list)`) : ''}.`);
                }
                const lw = layerBoardWidths(c, g);
                const unequal = lw.some((w) => w.length > 1 && w[0] !== w[1]);
                return I(`${tl(g.ids)}: each of its ${g.layers} layers is ${plural(g.edgeBoards, 'board')} across, glued before the layers are stacked.`, [
                  ...lw.map((w, i) => I(`Layer ${i + 1}: boards ${w.map((q) => `${fractionText(q, 8)}"`).join(' and ')} wide (cut list).`)),
                  unequal ? I(`The boards are unequal on purpose. Mark the board 1 edge of every layer and keep those edges on the same side when the layers are stacked: the seams then sit at least ${fin(LAMINATION_SEAM_OFFSET_IN)} apart and no seam lies over another.`) : false,
                ]);
              }),
              `Rip each board ${fin(c.p.laminateWidthAllowanceIn)} wider than its share and joint the mating edges.`,
              `Glue with cauls (${std ? 'Titebond III' : 'epoxy'}), then plane to thickness and trim to the cut-list rough size.`,
              ...(() => { const ends = ['transom-rear', 'bow-bulkhead'].filter((id) => edgeShown.some((g) => g.ids.includes(id))); return ends.length ? [`${tl(ends)}: planed to thickness, but left at the rough size: ${ends.length > 1 ? 'they are' : 'it is'} cut to the hull at [[step:ends]], once the hull is built.`] : []; })(),
            ])]
            : [I(edge.length ? 'No other part is wider than a board: no more panel glue-ups.' : 'No part is wider than a board: no panel glue-ups.')]),
          ...(face.length
            ? [I('Face-laminate the thick parts before anything is notched, bored or slotted.', [
              'Cut every layer to the rough size in the cut list (layer table): a little over its share of the block, with the length and width allowances in. The block is milled to its final size after the glue-up, so the glue lines come out square.',
              'Plane each layer to its rough thickness (cut list, layer table).',
              ...(face.some((g) => g.kind === 'both' && !crossOf.get(g)) ? ['Edge-glue any wide layer first.'] : []),
              `Epoxy the layers face to face (glue card), thickened a little with ${EPOXY_SYSTEM.thickener}.`,
              'Clamp flat between cauls, ends and edges flush, with plenty of clamps (about one every 6"); cure overnight.',
              'Mill the cured block to its final size (joint one face, plane to thickness). From then on it is solid oak.',
              ...(face.some((g) => g.ids.includes('bow-bulkhead')) ? ['The {{bow-bulkhead}} block is planed to thickness only: its outline, dados and hand hole are cut at [[step:ends]], to the hull.'] : []),
              I('The blocks, each as above:', face.map((g) => {
                const cross = crossOf.get(g);
                return cross
                  ? I(`${tl(g.ids)}: cross-laminated, like plywood.`, crossLamSubs(c, g, cross))
                  : I(`${tl(g.ids)}: ${lamText(g.ids[0])}${g.kind === 'both' ? ' (each layer edge-glued above)' : ''}.`);
              })),
            ])]
            : []),
          band
            ? I(`Resaw the band strips: ${bands.length} for the chine and gunwale bands (cut list, strips table).`, [
              ...resawSubs(c, band, bands.length),
              `Plane or drum-sand each strip to ${thick(band.stock!.t)} (on the day, as below).`,
            ], bands.map((x) => x.id))
            : I('Band strips: none in this model.'),
          rail
            ? I(`Resaw the rail strips: ${nRailStrips} for ${tl(rails.map((x) => x.id))}.`, [
              ...resawSubs(c, rail, nRailStrips),
              `Plane to ${thick(rail.stock!.t)} thick (on the day, as below), with a planer sled or drum sander: the strip is thin and wide. Leave it at the lane width; the rail is planed to ${fin(rail.stock!.w)} deep after the glue-up.`,
            ])
            : I('Rail strips: none in this model.'),
          ...(blanks.length ? [I('Saw the single-board bandsaw blanks from thick stock (the glued blocks above are sawn to shape in the steps that use them).', blanks)] : []),
          I('Resaw the strips now, but plane each to its final thickness the day it is glued or bent: a thin strip cups overnight. Keep them stickered and weighted flat until then.'),
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
    id: 'cut-deck',
    title: 'Cut the deck and the seat back first',
    kind: 'prep',
    steps: [0],
    view: 'top',
    why: 'The deck is the first part cut to its final shape. It is flat, cut from a file, and everything that must fit the hull later is checked against it, or against work built on it: the frame is set to it, the webs are checked against its edge, and the transom and bulkhead are cut to the hull it makes. The seat back comes from the same sheet and fits nothing built yet.',
    forParts: /^(deck|seat-back-panel)$/,
    cuts: /^(deck|seat-back-panel)$/,
    cutAfter: 'verify',
    tools: ['Shaper Origin', 'ShaperTape', 'calipers', 'straightedge', '1/8" hardboard (optional proof)'],
    build: (c) => {
      const deck = c.by('deck'), panel = c.by('seat-back-panel');
      const dk = deck ? worldAABB(deck) : undefined;
      const ply = computeLayout(c.p).ply;
      const wRear = dk ? deckEdgeHalf(deck, dk.min[0] + 0.5) : undefined, wBow = dk ? deckEdgeHalf(deck, dk.max[0] - 0.5) : undefined;
      return {
        goal: 'Cut the 12 mm deck and the seat back from their files, before anything else is cut to size: the deck is the reference the frame and the sides are checked against.',
        items: [
          I('Before you cut: measure the 12 mm sheet and check it lies flat.', [
            `Calipers at 4 places, 1" in from the edges: the design is ${fin64(ply)} (12 mm). Under 7/16" or over 1/2", return the sheet. Otherwise enter the average in the design (Advanced, parameters panel: ${PARAM_DEFS.deckPlyIn.label.toLowerCase()}) before anything is cut: the dados in the transom and the bulkhead, the deck slot under the chine bands and its spacer stick all follow it (Verify, plywood thickness).`,
            'Lay the sheet on a flat floor: it must lie down under its own weight. A sheet that stands more than 1/8" off the floor anywhere goes back: a bowed deck glues to the frame bowed.',
          ]),
          I('Optional proof cut: run the deck file on a 4\' × 8\' sheet of 1/8" hardboard first (about an hour).', [
            'It proves the file and the Shaper\'s setup before the okoume.',
            'Keep it: it is a layout board for [[step:frame]], where the frame is checked against it first, then against the real deck.',
          ]),
          I('Cut the {{deck}} from its Shaper file.', [
            'A hole the file cuts (an inside cut) is cut now, and no later step drills it again. A hole the file only marks is drilled at the step that uses it.',
            dk && wRear !== undefined && wBow !== undefined ? `Check it at once: ${fin(dk.max[0] - dk.min[0])} long on the centerline, ${fin64(2 * wRear)} wide at the rear end and ${fin64(2 * wBow)} at the bow end, within 1/32". A deck that is off is cut again: everything after this is checked against it.` : false,
            'Keep it flat on the bench, stickered and weighted, until it is sealed: the frame is set to it.',
          ], ['deck']),
          ...(panel ? [I('Cut the {{seat-back-panel}} from the same sheet\'s offcut, from its file (nesting drawing).', ['It fits nothing built yet (it hangs on hinges on the deck much later), so it is cut with its sheet.'])] : []),
        ],
        checks: ['12 mm sheet measured and the thickness entered in the design', 'Deck length and end widths within 1/32" of the file', 'Deck stored flat'],
      };
    },
  },
  {
    id: 'rail-form',
    title: 'Build the rail form',
    kind: 'prep',
    steps: [0],
    view: 'top',
    why: 'A shop jig, not a sled part. The two rails are the long oak beams under the deck that the whole hull is built on; their front ends curve in to follow the bow. Each rail is glued up from thin strips bent around this form in [[step:rails]]; the form is scrap after that. The highlighted parts in the 3D view are the rails.',
    forParts: /^rail-[LR]$/,
    tools: ['Shaper Origin or bandsaw', 'router with a pattern bit', 'drill press', '3/4" MDF and plywood', 'packing tape'],
    build: (c) => {
      const rail = c.parts.find((x) => x.id === 'rail-L');
      const bandPool = poolOf(c, c.by('side-L-chine'));
      const railPool = poolOf(c, rail);
      const t = bowTaper(c.p);
      const railForm = c.forms().find((d) => d.id === 'rail-form');
      const formLen = railForm?.dims.find((q) => q.key === 'form-length')?.valueIn;
      const railDepth = rail?.stock?.w ?? 0;
      const stackDim = railForm?.dims.find((q) => q.key === 'stack-height')?.valueIn;
      const layers = Math.ceil((stackDim ?? railDepth) / RIB_STOCK_IN - 1e-6);
      const stack = stackDim ?? layers * RIB_STOCK_IN;
      const all = formBuild(railForm);
      const make = formMaking(all);
      // The form's own build steps set the stack (it stands a little taller than the rail); quote them when they say so.
      const stackSaid = all.flatMap((q) => [q.text, ...(q.sub ?? []).map((x) => x.text)]).map((x) => /(\d+) layers (?:in all, a stack|make a stack) ([\d\-/]+)" tall/.exec(x)).find(Boolean);
      const layersText = stackSaid ? `${stackSaid[1]} layers of ${fin(RIB_STOCK_IN)} MDF (${stackSaid[2]}", taller than the ${fin(railDepth)} rail)` : `${layers} layers of ${fin(RIB_STOCK_IN)} MDF (${fin(stack)}, never less than the ${fin(railDepth)} rail depth)`;
      const springBack = all.find((q) => /^SPRING-BACK/.test(q.text))?.text.replace(/^SPRING-BACK:\s*/, '');
      return {
        goal: 'Build the form the two rails are bent on, and prove it with a dry bend strip and a glued test rail (one extra day).',
        items: [
          formLen !== undefined
            ? I(`Build the rail form (rail form drawing): ${fin(formLen)} long. One form serves both rails.`, make.length ? make : [
              `${cap(layersText)}.`,
              `Its face is the rails' outer plan curve: ${fin(t.turnIn)} turn-in each side, tightest radius ${t.minRadiusIn > 1e6 ? 'none' : `${f(t.minRadiusIn, 0)}"`}.`,
              'Every clamp bears on the full strip width.',
            ])
            : I('Rail form: no bow turn-in at this design, so the rails are straight and need no form.', ['Glue them flat on the bench with cauls.']),
          I('Bend-test a dry strip on the finished form.', [
            `Use a planned spare: ${railPool ? plural(railPool.spares, 'spare rail strip') : 'a spare rail strip'} and ${bandPool ? plural(bandPool.spares, 'spare band strip') : 'a spare band strip'} came out of the resaw.`,
            'A strip that passes goes into the laminate.',
            'If it cracks: lay a wet towel over the bend and a hot clothes iron on it for a minute, then try again. If a strip still cracks, the rail needs thinner strips (3 thinner plies instead of 2): stop and re-plan the rail before going on.',
          ]),
          ...(springBack ? [I('Spring-back test: glue one test rail before the real ones.', [cap(springBack)])] : []),
        ],
        checks: ['The form face is fair: a straightedge shows no bump or dip', 'A dry strip takes the S without cracking'],
      };
    },
  },
  {
    id: 'side-forms',
    title: 'Build the side forms, then cut the webs',
    kind: 'prep',
    steps: [0],
    view: 'side',
    why: 'Shop jigs, not sled parts. Each side of the hull is a thin plywood web with oak bands glued along its top and bottom edges, on both faces. Two bends are locked in as the bands cure: the top band is bent on edge to follow the web\'s curved top edge, and the front of the whole side curves in toward the center. These forms hold the web and bands in that shape while the epoxy cures, in [[step:sides-inner]] (inside face) and [[step:sides-outer]] (outside face). They are scrap after that. The highlighted parts in the 3D view are what they make.',
    forParts: /^side-[LR]-(web|chine|chine-in|gunwale|gunwale-in)$/,
    // D-94: the webs are cut here, once the forms are proved with a hardboard test web and the deck's edge is measured.
    cuts: /^side-[LR]-web$/,
    cutAfter: 'cut-deck',
    tools: ['Shaper Origin or bandsaw', 'laser (test web)', 'drill and driver', '3/4" MDF and plywood', '1/4" hardboard', '1/8" hardboard (test web)', 'flexible steel tape', 'packing tape'],
    build: (c) => {
      const web = c.by('side-L-web');
      const webRow = c.cut().sheets.flatMap((g) => g.rows).find((r) => r.ids.includes('side-L-web'));
      const deckLen = deckEdgeLength(c.by('deck'));
      const sheetT = thinSheet(c.p).thicknessIn;
      const sideForm = c.forms().find((d) => d.id === 'side-form');
      const dim = (key: string): number | undefined => sideForm?.dims.find((q) => q.key === key)?.valueIn;
      const rise = dim('ramp-rise');
      const rampLen = dim('ramp-length');
      const ribs = dim('ramp-ribs');
      const make = formMaking(formBuild(sideForm));
      // The form drawing's own build list, one item per piece of the jig (bench tops, template, cleats, the two ramps, tape), so each reads on its own.
      const pieces: Instr[] = make.length
        ? make
        : rise !== undefined && rampLen !== undefined
          ? [
            I(`S-ramp (side form drawing): rise ${fin(rise)}, ${fin(rampLen)} long from the start of the S to the bow end, ${f(ribs ?? 0, 0)} MDF ribs under a 1/4" hardboard cap.`, [`Ribs of ${fin(RIB_STOCK_IN)} MDF, about 4-1/2" apart.`]),
            I('Build the MIRROR ramp for the second web face: never the same ramp, the cured web would have to bend back.'),
          ]
          : [I('Build the side form (side form drawing): a flat template with the sheer cleats. No S-ramp: the sides are not turned in at this design.', ['The webs glue up flat.'])];
      return {
        goal: 'Build the jigs that hold each side web bent while its oak bands are glued on: a template with cleats along its top edge, and two ramps for the bend at the bow.',
        items: [
          ...(web ? [I('Cut a test web first: one left web in 1/8" hardboard, on the laser (the side web\'s laser file, one copy).', [
            'It stands in for the real web while the forms are built: wherever the form steps below say "a dry web", use the test web (turned over, it is the right web). It bends near enough like the web to set the ramps and the cleats.',
            'The real webs wait until the forms are proved and the deck\'s edge is measured (below), so a form that is wrong costs hardboard, not a sheet of the web plywood.',
          ])] : []),
          ...pieces,
          ...(web ? [
            I('Before you cut the webs: prove the forms with the test web, and measure the deck\'s edge and the web sheet.', [
              'Bend the test web dry on the S-ramp, then on the mirror ramp (turned over, outside face up), weighted with the bags: it must lie down on each with no step at the start of the S, its top edge 1/8" off every cleat. Fix a ramp or a cleat now.',
              deckLen !== undefined ? `Measure the deck's edge along its curve with a flexible steel tape, from its rear corner to its bow corner, on both sides: ${fin(deckLen)} (the web's bottom edge is the same length, since it sits on the rail beside the deck edge), within 1/16". If it is off, stop: the deck and the web file disagree; find out which (measure the deck against its file) before the sheet is cut.` : false,
              `The web sheet (${thinSheet(c.p).name}): count the plies at an edge and measure it with calipers at 4 places: the design is ${fin64(sheetT)}. Under ${fin64(sheetT - 1 / 32)} or over ${fin64(sheetT + 1 / 32)}, return the sheet; otherwise enter what you measure in the design (Advanced, parameters panel: ${thinLabel(c.p).toLowerCase()}) before the webs are cut (Verify, plywood thickness).`,
              'Keep the test web: it is the dry web for re-setting the cleats for the right side and between the cures.',
            ]),
            I(`Cut the two webs, ${tl(['side-L-web', 'side-R-web'])}, each from its own 4\' × 8\' sheet.`, [
              webRow ? `Nest the ${roughFrac(webRow.stock.l)} blank on the sheet per the nesting drawing, then cut the net from the Shaper file: ${finalFrac(webRow.final.l)} long, so the difference is the trim.` : 'Nest the blank per the nesting drawing, then cut the flat development net from the Shaper file.',
              'The file also cuts the two drain holes: no later step drills the web again.',
            ]),
          ] : []),
          I(web ? 'Dry-run the real webs on the form, then bend-test a spare band strip on it, before any glue goes on.' : 'Dry-run a web on the form, then bend-test a spare band strip on it, before any glue goes on.', [
            'Lay a dry web on the template, then on each ramp, with its top edge 1/8" off the cleats.',
            `It must lie on the ramp with no step at the start of the S, and every cleat must stand solid: ${web ? 're-set any cleat the real web does not meet at 1/8"' : 'fix the ramp or the cleat now'}.`,
            'Then lay a spare band strip on the dry web against the cleats and the end stops, over the S, weight it with the bags as for gluing, and leave it an hour.',
            'The gunwale band bends two ways at once there (on edge to the sheer, and across its thickness to the S). If the strip cracks or checks, stop and re-plan the gunwale bands before any glue.',
          ]),
        ],
        checks: ['Template flat on the bench, taped, its screws flush', 'Cleats solid, standing on edge, taped, tight to the 1/8" scrap against a dry web', 'A dry web lies on each ramp with no step at the S', ...(web ? ['Deck edge measured against the web length before the sheet was cut', 'Webs cut net from the file; the blank nests on the sheet'] : [])],
      };
    },
  },
  {
    id: 'seal',
    title: 'Seal the deck underside and the open plywood edges',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['foam roller', 'brush', 'epoxy pumps', 'scotch-brite'],
    hardener: '556',
    coat: true,
    build: (c) => {
      const std = isStandard(c.p);
      return {
        goal: std ? 'Epoxy the few surfaces water can reach and nobody can reach later; the show faces stay bare.' : 'Epoxy-seal the hidden faces and edges before assembly; the show faces stay bare.',
        items: [
          std
            ? I('Weather spec: Standard (garage-kept, wet at most at a rainy derby).', [
              'Glue: one glue per glue-up. Titebond III for the wood-to-wood glue-ups (the hangers and backers, the edge-glued panels); epoxy for everything else.',
              'Epoxy only for the bent and face laminations, the deck to the frame and its dados, the fillets and tape, and thickened bedding.',
              'Topcoat: exterior spar urethane.',
              '(Extreme weather, stored outside: epoxy for every glue joint and a marine topcoat.)',
            ])
            : I('Weather spec: Extreme (stored outside or near salt): epoxy for every glue joint and marine varnish.'),
          I('Run the finishing offcut tests first (Finishing section, test 1).', [std ? 'They show how the clear urethane looks on each wood; no show face is coated until a panel passes.' : 'They decide how the okoume takes stain under epoxy; no show face is sealed until a panel passes.']),
          std
            ? I('Epoxy ONE coat, unthickened (mix as on the glue card), on:', [
              'the deck underside and deck edges (water pools there);',
              `any ${thinSheet(c.p).name} edge not captured in a dado or banded with oak.`,
              'Leave the other plywood faces bare: they take the clear urethane at the finish (no stain).',
              'The oak end grain is coated later: the transom and bulkhead edges at [[step:ends]], the rest in the finish.',
            ])
            : I('Epoxy-seal (one coat, unthickened, mixed as on the glue card) ONLY the deck underside and edges, every ply edge, and faces nobody will see.', [
              'The show faces stay bare: both web faces, the deck top, the box, the lid, the seat back.',
              `They are stained, THEN sealed, after assembly (Finishing, steps ${stepNo(c, 'stain')}-${stepNo(c, 'epoxy')}). Water-based dye under epoxy is the safe route.`,
            ]),
          I('Wash the amine blush off any sealed face that will be glued again.', ['Warm water and Scotch-Brite, dry, then 120 grit.', 'Glue faces stay bare or scuffed; keep the oak bands and rails bare.']),
          I(std ? 'In every later glue-up, wipe squeeze-out off the bare show faces before it kicks: dried epoxy shows as a glossy patch under the clear finish.' : 'In every later glue-up, wipe squeeze-out off the bare show faces before it kicks: dried epoxy blocks the stain.'),
        ],
        checks: ['No bare ply edge left on any sheet part', 'Offcut panel approved before any show face is coated'],
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
    why: 'The two rails are the long oak beams along the bottom of the hull. The sides stand on them, the crossmembers join them, and the axle beams hang under them. Their front ends curve in with the bow, so each is glued up from thin strips bent on the rail form.',
    tools: ['rail form', 'clamps', 'epoxy pumps', 'planer', 'bandsaw', 'chisel', 'Domino'],
    hardener: '556',
    glueLine: `Epoxy: on the form ${HARDENERS['556'].clampHours[1]} h at 60 °F or warmer (glue card)`,
    build: (c) => {
      const rail = c.mine[0];
      const ids = c.mine.map((x) => x.id);
      const tie = chineTie(c.parts);
      const clamps = c.forms().find((d) => d.id === 'rail-form')?.dims.find((q) => q.key === 'clamps')?.valueIn;
      // The form drawing's clamping step (how many clamps, where, how to lay the strips); its "leave it clamped" line is said below, in this step's own words.
      const clampItem = formBuild(c.forms().find((d) => d.id === 'rail-form')).find((q) => /^CLAMP:/.test(q.text));
      if (clampItem) clampItem.sub = (clampItem.sub ?? []).map((q) => ({ ...q, text: loosen(q.text.replace(/^Leave it clamped for the full cure.*$/, '')) })).filter((q) => q.text.trim().length > 0);
      const notch = feat(c, 'rail-L', ['outline', 'notch'], /^Notch/);
      const step = feat(c, 'rail-L', 'outline', (q) => /^Step/.test(q.text) && q.angleDeg !== undefined);
      const tieHoles = featsAll(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /chine/.test(t)));
      const tieBored = tieHoles.find((q) => /counterbore/.test(q.size ?? ''));
      const tieBore = tieBored ? /with a (\S+") × (\S+") counterbore from the (\w+ edge)/.exec(tieBored.size ?? '') : null;
      const tieDrill = /^(\S+") clearance/.exec(tieHoles[0]?.size ?? '')?.[1];
      const side = featuresOf(c, 'rail-L').filter((q) => q.kind === 'mortise' && q.face === 'inboard face');
      const sideCenters = [...new Set(side.flatMap((q) => centersOf(q, 'REAR end')))].sort((a, b) => a - b);
      const sideDepth = fromTop(side[0]);
      // The S-start mark (round-3 review, B1): the form's S-start tick, squared onto the rail before it comes off; the finished ends are measured from it along the rail.
      const railBox = rail ? worldAABB(rail) : undefined;
      const sStart = computeLayout(c.p).taper.x0;
      const sMark = rail?.stock && railBox && sStart > railBox.min[0] ? { back: sStart - railBox.min[0], ahead: rail.stock.l - (sStart - railBox.min[0]) } : undefined;
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
            `Epoxy lightly thickened with ${EPOXY_SYSTEM.thickener} (glue card). The form face and the counter-form face wear the packing tape put on when the form was built: renew it if it is torn.`,
            ...(clampItem
              ? [I(`${clampItem.text.replace(/^CLAMP:\s*/, 'Clamps: ')}`, clampItem.sub ?? [])]
              : [`Clamp at every station: about ${clamps !== undefined ? f(clamps, 0) : '15'} clamps per rail (rail form drawing). Only the bow end is curved.`]),
            `Leave each rail clamped for ${HARDENERS['556'].clampHours[1]} h at 70 °F, ${Math.ceil(HARDENERS['556'].clampHours[1] * epoxyTimeFactor(60))} h at 60 °F (the top of the glue card's clamp time; longer if the shop is colder) before it comes off the form: a bent strip springs back if it is released early.`,
            'One rail per cure, unless you build two forms. The two rails come off the form identical; one becomes the left rail by turning it over. At the cuts, lay both rails on edge on the bench, bow ends to your right, the S of each turning in toward the other: the edge that is up on each is its TOP, and the far one is the left rail. Pencil L TOP and R TOP.',
          ]),
          I('After the cure: mark the finished ends, cut the rail to length and plane it to depth.', [
            ...(sMark ? [`Before you unclamp, square the form's S-start tick across the top edge of each rail and pencil S. Measured along the rail, the finished rear end is ${fin(sMark.back)} behind that mark and the finished bow end ${fin(sMark.ahead)} ahead of it. Mark both ends, then crosscut 1/2" outside each mark${rail?.stock ? ` (${fin(rail.stock.l + 1)} overall)` : ''}: the rest is trimmed at the dry fit.`] : [`Crosscut each rail to its finished length plus 1/2" at each end${rail?.stock ? ` (${fin(rail.stock.l + 1)} overall)` : ''}: it is trimmed at the dry fit.`]),
            `Joint one edge with the rail upright (keep it vertical where the S leaves the fence), then plane to ${fin(rail?.stock?.w ?? 3)} on edge, both rails through together.`,
            'Measure every position below from the FINISHED rear end, 1/2" in from the sawn end, along the rail\'s edge with a tape that follows the curve, not straight across: the numbers ahead of the S are lengths along the rail.',
          ]),
          I('Cut the rear axle beam notch in the bottom edge of each rail.', [notchText(notch) ? `${notchText(notch)}.` : `Notch for the rear beam: ${SEE}.`, 'Bandsaw and chisel; the two notches must line up across the frame.'], ids),
          I(`Drill the screw holes BEFORE the bow step is cut${tieBore ? ` (the forward counterbores reach past where the ramp starts)` : ''}: ${tie.perRail ? `${tie.perRail} holes` : 'the holes'} a rail, straight through from the bottom edge to the top edge${tieDrill ? `, ${tieDrill} clearance` : ''}. They take the ${tie.screw} screws that tie the side to the rail.`, [
            ...(holeList(tieHoles).length
              ? [I('Where, from the finished rear end and from the inboard face (mark them on the bottom edge):', holeList(tieHoles).map((h, i) => `Hole ${i + 1}: ${h.s}" from the rear end, ${h.off}${h.bored ? '' : ' (no counterbore)'}.`))]
              : [`The holes: ${SEE}.`]),
            tieBore ? `Counterbore first: ${tieBored!.count === 1 ? 'the hole' : `holes 1 to ${tieBored!.count}`}, a ${tieBore[1]} brad-point or Forstner bit, ${tieBore[2]} deep measured from the ${lc(tieBore[3])} (a depth stop on the drill press). The small trim head sits well down in the rail.` : false,
            `Then drill the ${tieDrill ?? 'clearance'} hole through from the center of each bore${tieBore ? ' (the bit\'s center dimple starts it)' : ''}, square to the edge, on the drill press.`,
            tieBore && tieHoles.some((q) => q !== tieBored) ? 'The last (forward) hole has no bore: the rail is shallow there, and a light countersink from the bottom edge lets the trim head sink flush.' : false,
            tieBore ? `The bores are plugged after the screws go in (when the frame goes into the sides): ${tieBore[1]} oak plugs from a plug cutter on offcuts (or a ${tieBore[1]} dowel), glued in and trimmed flush.` : false,
          ], ids),
          I('Cut the bow step in the bottom edge.', [stepText ? `The rail is ${stepText}.` : `Step at the bow end: ${SEE}.`, 'Bandsaw and plane to the line.'], ids),
          sideCenters.length
            ? I('Mortise the inboard faces for the crossmembers and the king beam (5×30 Dominos, 15 mm deep).', [
              `Centered at ${list(sideCenters)} from the rear end${sideDepth ? `, ${sideDepth}` : ''}.`,
              'Every Domino stands upright: its width runs up and down the rail.',
            ], ids)
            : I('Mortise the inboard faces for the crossmembers as the drawing shows.', [], ids),
          I('Do NOT cut the end mortises yet: they are cut after the trim, at [[step:rail-ends]].'),
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
    why: 'The rear axle beam hangs from the hull on these two oak hangers, one glued to the inside of each rail. Their notches straddle the beam, and the bolts drilled now also hold the steel angles that clamp the beam in.',
    tools: ['bandsaw', 'chisel', 'drill', 'epoxy pumps', 'clamps', 'Domino'],
    retools: (p) => (isStandard(p) ? ['bandsaw', 'chisel', 'drill', 'clamps', 'Domino'] : undefined), // Standard glues the hangers with Titebond III: no epoxy pumps
    hardener: '556',
    build: (c) => {
      const ids = c.mine.map((x) => x.id);
      const notch = feat(c, 'axle-hanger-L', 'notch', /^1 notch/i) ?? feat(c, 'axle-hanger-L', 'outline', /^Notch/);
      const dom = feat(c, 'axle-hanger-L', 'mortise', /domino/i);
      const bolts = feat(c, 'axle-hanger-L', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t))); // the angle's upright bolts are the hanger's bolts (one record)
      const railBolts = feat(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t)));
      const std = isStandard(c.p);
      const radius = /corners relieved with a ([\d\-\/]+") radius/.exec(c.by('axle-hanger-L')?.joints?.find((q) => q.type === 'dado')?.note ?? '')?.[1];
      const domWhere = whereOf(dom);
      // Where the hanger sits on its rail (from the two parts): its rear edge from the rail's finished rear end, and whether its top is flush with the rail top.
      const hgBox = c.by('axle-hanger-L') ? worldAABB(c.by('axle-hanger-L')!) : undefined, rlBox = c.by('rail-L') ? worldAABB(c.by('rail-L')!) : undefined;
      const hangerAt = hgBox && rlBox ? `: its rear edge ${fin(hgBox.min[0] - rlBox.min[0])} from the rail's finished rear end (mark that end now, 1/2" in from the sawn end)${Math.abs(hgBox.max[2] - rlBox.max[2]) < 1 / 32 ? ', its top edge flush with the rail top' : ''}` : '';
      return {
        goal: 'Notch the rear axle hangers, glue them to the rails and drill their bolt holes, before the frame glue-up.',
        items: [
          I(`Cut the two hangers to their cut-list size: ${tl(ids)}.`, ['They are sized to the rail and the rear axle beam on the drawing, not to built work, so they need no check.']),
          ...((): Instr[] => {
            const ax = c.by('axle-R'), rl = c.by('rail-L');
            if (!ax || !rl) return [];
            const axX = (worldAABB(ax).min[0] + worldAABB(ax).max[0]) / 2, r0 = worldAABB(rl).min[0], bk = brakeOf(c.p);
            return [I(`Check the brake knee's place against the axle notch now, before its bolt holes are drilled at [[step:frame-parts]].`, [`The knee's rear face goes ${fin(bk.knee.x0 - r0)} from the rail's finished rear end: ${fin(bk.knee.x0 - axX)} ahead of the center of the axle notch (${fin(axX - r0)} from that end), which leaves ${fin(bk.knee.x0 - (bk.O[0] + bk.r))} to the front of a ${fin(2 * bk.r)} tire. If the notch is not where it should be, the knee moves with it: find out why before going on.`], ['rail-L', 'rail-R'])];
          })(),
          I(`Cut the beam notch in the bottom edge of each hanger: ${tl(ids)}.`, [notchText(notch) ? `${notchText(notch)}.` : `Notch for the rear beam: ${SEE}.`, `Bandsaw and chisel${radius ? `, ${radius} radius in the corners` : ''}.`, ((r) => (r?.cut?.lo && r.cut.hi ? `Then chisel a relief in the notch ceiling, ${fin(Math.abs(r.cut.hi[0] - r.cut.lo[0]))} wide × ${fin(Math.abs(r.cut.hi[2] - r.cut.lo[2]))} deep, centered on the notch's width, through the thickness: the axle ${axleWord(c.p)} stands a little above the beam there, and the relief lets the ceiling bear on the beam.` : false))(c.by('axle-hanger-L')?.joints?.find((q) => q.cut && /^axle-R/.test(q.to)))]),
          I('Cut the Domino mortise for {{joist-1}} in each hanger now (5×30).', [domWhere ? `${cap(domWhere)}.` : SEE_ITEM, 'The crossmember ends engage them in the frame glue-up.']),
          I(`Glue each hanger to its rail's inboard face, rails flat on the bench${hangerAt}.`, [
            'Side grain to side grain, the hanger notch in line with the rail notch.',
            std ? 'Titebond III on both faces; clamp it on for 30-60 min.' : `Epoxy on both faces; clamp it on for ${hRange(HARDENERS['556'].clampHours)} h.`,
          ], [...ids, 'rail-L', 'rail-R']),
          I(`Drill the ${bolts ? plural(bolts.count, 'bolt hole') : 'bolt holes'} through each hanger and its rail together, while the clamps hold them in line.`, [
            bolts ? `Holes ${holeText(bolts)}.` : SEE_ITEM,
            railBolts ? `On the rail the same holes are ${holeText(railBolts)?.replace(/ from the rear end/, ' from the rail\'s finished rear end')}.` : false,
            'No bolt goes in yet. These are the same holes the hold-down angles use at [[step:rear-beam]] ({{beam-hold-down-L}} and {{beam-hold-down-R}}): their upright-leg bolts also hold the hanger to the rail.',
          ]),
        ],
        checks: ['Hangers mirror each other: same distance from the rail\'s finished rear end', 'Notches in line (string or straightedge across)', 'Bolt holes clean through hanger and rail, in line'],
      };
    },
  },
  {
    id: 'frame-parts',
    title: 'Prepare the frame parts (the day before): knee backers and plates',
    kind: 'build',
    steps: [STEP.frame],
    match: /^brake-(backer|backplate)-[LR]$/,
    view: 'top',
    why: 'The brake knees bolt through each rail into an oak backer, with the nuts on a stainless plate set in the backer. They go on the rails now, the day before the frame glue-up, because the deck closes over them.',
    tools: ['router with a fence', 'chisel', 'metal bandsaw', 'drill press', 'cobalt bits', 'clamps', 'epoxy pumps'],
    hardener: '556',
    build: (c) => frameStep(c, 'parts'),
  },
  {
    id: 'frame',
    title: 'Frame and deck as one unit',
    kind: 'build',
    steps: [STEP.frame, HULL_STEP.deck],
    // D-94: the crossmembers are cut to the rails as bent, set to the deck.
    cutAfter: 'rails',
    view: 'top',
    why: 'The frame and deck are the floor of the sled: the rider sits on the deck, the crossmembers under it carry the load across to the two rails, and the king beam carries the front axle\'s pivot. Built flat on the bench as one unit, it is turned over and lowered into the sides later.',
    tools: ['Domino', 'drill press', 'clamps', 'sandbags or vacuum bag', 'epoxy pumps', 'square'],
    hardener: '556',
    build: (c) => frameStep(c, 'frame'),
  },
];

/**
 * The frame (D-94 split): the parts prepared the day before (the brake knee backers and their plates) and the frame itself (the crossmembers cut to the rails set to the deck,
 * the dry fit, the deck check, the glue-up) share their numbers, so both steps are built here and each takes its own items.
 */
function frameStep(c0: StepCtx, which: 'parts' | 'frame'): Built {
      const c: StepCtx = { ...c0, mine: c0.parts.filter((x) => (x.step === STEP.frame || x.step === HULL_STEP.deck) && x.group !== 'reference' && !x.payload) };
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
      // Where the backer sits on its rail, and which crossmembers meet it (a crossmember that lands on a backer, clear of the axle hanger, is cut back by the backer's thickness, as the model cuts it).
      const backerL = c.by('brake-backer-L'), railL = c.by('rail-L');
      const bkBox = backerL ? worldAABB(backerL) : undefined, railBox = railL ? worldAABB(railL) : undefined;
      const hangerBoxes = c.parts.filter((x) => /^axle-hanger-[LR]$/.test(x.id)).map((x) => worldAABB(x));
      const bkThick = bkBox ? bkBox.max[1] - bkBox.min[1] : 0;
      const cutBack = bkBox
        ? c.parts.filter((x) => /^(joist-\d+|king-beam)$/.test(x.id)).filter((x) => {
          const b = worldAABB(x);
          return b.max[0] > bkBox.min[0] && b.min[0] < bkBox.max[0] && !hangerBoxes.some((h) => b.max[0] > h.min[0] && b.min[0] < h.max[0]);
        }).map((x) => x.id)
        : [];
      const backerAt = bkBox && railBox ? `, its rear end ${fin(bkBox.min[0] - railBox.min[0])} from the rail's finished rear end (not the sawn end)${Math.abs(bkBox.max[2] - railBox.max[2]) < 1 / 32 ? ' and its top edge flush with the rail top' : ''}` : '';
      const kb = brakeOf(c.p).bolts;
      const boltD = fin(c.p.brakeMountBoltDiaIn);
      const hinge = c.mine.filter((x) => /^seat-hinge-backer-/.test(x.id)).map((x) => x.id);
      // Where the hinge backers go on the deck's underside, measured from the deck (the crossmembers are not on yet): fore-aft from the deck's rear edge, in from its side edge.
      const hbBox = c.by('seat-hinge-backer-L') ? worldAABB(c.by('seat-hinge-backer-L')!) : undefined, dkBox = c.by('deck') ? worldAABB(c.by('deck')!) : undefined;
      const hbBehind = hbBox ? c.parts.filter((x) => /^(joist-\d+)$/.test(x.id)).map((x) => ({ x, b: worldAABB(x) })).find((q) => Math.abs(q.b.min[0] - hbBox.max[0]) < 1 / 32) : undefined;
      const hingeAt = hbBox && dkBox
        ? hbBehind
          ? `On the deck's underside, each runs back from the line of the rear face of {{${hbBehind.x.id}}} marked at the dry fit (design: ${fin(hbBox.max[0] - dkBox.min[0])} forward of the deck's rear edge) to ${fin(hbBox.min[0] - dkBox.min[0])} forward of the rear edge, its outer edge ${fin(dkBox.max[1] - hbBox.max[1])} in from the deck's side edge. Its front end butts that crossmember at the glue-up: go by the line, not the tape, if the two differ.`
          : `On the deck's underside, each runs ${fin(hbBox.min[0] - dkBox.min[0])} to ${fin(hbBox.max[0] - dkBox.min[0])} forward of the deck's rear edge, its outer edge ${fin(dkBox.max[1] - hbBox.max[1])} in from the deck's side edge.`
        : 'Place them from the deck drawing.';
      // Where the deck lies on the dry frame (the deck is the reference the sides fit to): its ends past the rails' finished ends, and its edge set in from the rail's outer face at each station.
      const deckEdgeAt = (x: number): number | undefined => deckEdgeHalf(c.by('deck'), x);
      const Lf = computeLayout(c.p);
      const deckFit = dkBox && railBox
        ? (() => {
          const rear = railBox.min[0], bow = railBox.max[0];
          const members = c.parts.filter((x) => /^(joist-\d+|king-beam)$/.test(x.id)).map((x) => ({ id: x.id, x: (worldAABB(x).min[0] + worldAABB(x).max[0]) / 2 })).sort((a, b) => a.x - b.x);
          const stations = [{ name: 'at the rear end', x: rear + 1 }, ...members.map((m) => ({ name: `at {{${m.id}}}`, x: m.x })), { name: 'at the bow end', x: bow - 1 }];
          const insets = stations.map((s) => { const e = deckEdgeAt(s.x); return e === undefined ? undefined : outerHalfWidth(Lf, s.x) - e; });
          const ok = insets.every((v) => v !== undefined);
          const same = ok && Math.max(...(insets as number[])) - Math.min(...(insets as number[])) < 1 / 64;
          return {
            behind: rear - dkBox.min[0], ahead: dkBox.max[0] - bow,
            inset: ok ? (same ? `${fin(insets[0]!)} at every station: at the rear end, at each crossmember and at the bow end` : stations.map((s, i) => `${fin(insets[i]!)} ${s.name}`).join(', ')) : undefined,
            wRear: 2 * outerHalfWidth(Lf, rear), wBow: 2 * outerHalfWidth(Lf, bow),
          };
        })()
        : undefined;
      const std = isStandard(c.p);
      const plateHoleD = plateHoles ? /^([\d/]+")/.exec(plateHoles.size ?? '')?.[1] : undefined;
      // The knee-bolt holes on the rail, rows from the BOTTOM edge like the plate's (from the rail's own hole joint).
      const kneePts = railL ? (railL.joints ?? []).filter((j) => j.type === 'hole' && /^brake-knee/.test(j.to)).flatMap((j) => j.at ?? []) : [];
      const kneeCols = railBox ? [...new Set(kneePts.map((q) => +(q[0] - railBox.min[0]).toFixed(4)))].sort((a, b) => a - b) : [];
      const kneeRows = railBox ? [...new Set(kneePts.map((q) => +(q[2] - railBox.min[2]).toFixed(4)))].sort((a, b) => a - b) : [];
      const kneeWhere = kneeCols.length && kneeRows.length ? `in the inboard face: ${kneeCols.length} columns × ${kneeRows.length} rows: ${kneeCols.map(fin).join(' and ')} from the finished rear end, ${kneeRows.map(fin).join(' and ')} up from the bottom edge` : undefined;
      const crossIds = c.mine.filter((x) => /^(joist-|king-beam)/.test(x.id)).map((x) => x.id);
      // D-94: each crossmember's length from its own geometry: the long point (its cut-list length) and, in the bow taper, its short point (its front face, where the rails close in).
      // A tapered one is measured and cut at its long point (its rear face, where the rails are farther apart), then scribed shorter at the front: never cut to the center gap.
      const hangerB = c.by('axle-hanger-L') ? worldAABB(c.by('axle-hanger-L')!) : undefined;
      const crossLen = crossIds.map((id) => {
        const x = c.by(id)!, b = worldAABB(x);
        const long = x.stock?.l ?? b.max[1] - b.min[1], short = b.max[1] - b.min[1];
        return { id, long, short, taper: long - short > 1 / 64, hanger: !!(hangerB && b.max[0] > hangerB.min[0] && b.min[0] < hangerB.max[0]) };
      });
      const straightLen = crossLen.filter((q) => !q.taper && !q.hanger), taperLen = crossLen.filter((q) => q.taper), hangerLen = crossLen.filter((q) => q.hanger);
      const insetRear = dkBox && railBox ? outerHalfWidth(computeLayout(c.p), railBox.min[0] + 1) - (deckEdgeAt(railBox.min[0] + 1) ?? 0) : undefined;
      if (which === 'parts') {
        return {
          goal: 'The day before the frame glue-up: cut the brake knee backers, recess and glue them to the rails, and make and bed the stainless backing plates.',
          items: [
            ...(brakeBackers.length ? [I(`Cut the brake knee backers to their cut-list size: ${tl(brakeBackers.map((x) => x.id))}.`, ['They carry the knee-bolt layout on the drawing, not built work, so they need no check.'], brakeBackers.map((x) => x.id))] : [I('No brake knee backers in this model.')]),
            ...(brakeBackers.length
            ? [
            I(`The day before the deck glue-up: prepare the brake knee backers and glue them to the rail inboard faces: ${tl(brakeBackers.map((x) => x.id))}.`, [
              I('First, on the bench: cut the plate recess in the inboard face of each brake knee backer, before it is glued.', [
                plateRecess ? `${plateRecess.size ?? 'Flat-bottomed recess'}: ${whereOf(plateRecess)}.` : `Flat-bottomed recess for the plate: ${SEE}.`,
                'Router with a fence, or saw the edges and chisel the waste out to an even depth.',
                'The plate must lie flush with the face: test it in the recess before gluing.',
              ]),
              I(`Glue each backer to its rail's inboard face${backerAt}, clear of the axle hanger.`, [
                'Side grain to side grain; clamp it on until the glue sets.',
                'Glue it to the rail only. It bonds to the deck underside at the deck glue-up, below.',
              ]),
              brakePlates.length ? false : `Drill the ${kb.count} knee-bolt holes (${boltD} bolts) through rail and backer together, from the rail drawing, measured from the finished rear end: ${kneeHoles ? holeText(kneeHoles) : SEE}.`,
              brakePlates.length ? false : 'The same holes on the right rail, mirrored.',
            ], brakeBackers.map((x) => x.id)),
            ...(brakePlates.length
              ? [I(`Make the two stainless backing plates for the knee nuts: ${tl(brakePlates.map((x) => x.id))}.`, [
                `${plateStock ? `${plateStock} stainless plate` : 'Stainless plate'}, set flush in its recess in the backer's inner face. Cut it from 2" flat bar on the metal bandsaw and deburr the cut edges.`,
                plateHoles ? `Drill its ${kb.count} holes loose on the drill press, from a layout on the plate: ${holeText(plateHoles)}.` : `Drill its ${kb.count} holes loose on the drill press, from the plate drawing.`,
                `With a hand drill, the plate clamped in its recess, drill the ${kb.count} knee-bolt holes${plateHoleD ? ` (${plateHoleD})` : ''} through the backer and the rail, using the plate's holes as the guide. Check the plate's place against the rail layout first, ${kneeWhere ?? (kneeHoles ? whereOf(kneeHoles) : SEE)}.`,
                STAINLESS_DRILLING,
                'The same on the right rail, mirrored.',
                'The nylock nuts bear on this plate, so it spreads the bolt pull over the oak (four fender washers would overlap).',
              ], brakePlates.map((x) => x.id)),
              ...(isRemovable(c.p) ? [I(`Bed each plate in thickened epoxy in its recess, so it stays in the backer when the knee bolts come out later. Do it the day before the deck glue-up: the bed needs ${hRange(HARDENERS['556'].clampHours)} h.`, [
                'Prepare the plate: sand its back and edges with 80 grit, wipe it with acetone, and bed it within the hour.',
                `Spread epoxy thickened with ${EPOXY_SYSTEM.thickener} in the recess and set the plate in. Pass ${kb.count} waxed ${boltD} bolts through the rail, backer and plate holes from the outside, each with a waxed nut on the plate and a waxed caul block (a flat scrap) under the heads.`,
                'Snug the nuts just enough to seat the plate flush with the face; do not squeeze the bed dry. Wipe the squeeze-out.',
                `Take the bolts out after the clamp time on the glue card (${hRange(HARDENERS['556'].clampHours)} h). The plate stays in the backer.`,
              ], brakePlates.map((x) => x.id))] : [])]
              : [])]
            : []),
          ],
          checks: ['Each backer glued flush with the rail top, its rear end on its mark', ...(brakePlates.length ? ['Each plate flush in its recess, its 4 holes lined up with the rail holes'] : [])],
        };
      }
      return {
        goal: 'Glue the crossmembers between the rails and bond the deck on top, as one flat unit.',
        items: [
          I('Before you cut the crossmembers to length: set the rails to the deck and measure between them.', [
            `Lay the {{deck}} face down on the bench (the hardboard deck first, if you made one). Stand both rails on it upside down, top edge on the deck, each outer face ${insetRear !== undefined ? fin(insetRear) : '1/2"'} outside the deck's edge (a combination square set to that), the finished-end marks ${deckFit ? fin(deckFit.behind) : '1/4"'} in from the deck's rear edge. Clamp a straight scrap to the deck against each rail's inboard face to hold it there.`,
            `Measure between the rails' inboard faces at each crossmember's mortises: ${listS(straightLen.map((q) => `{{${q.id}}} ${fin(q.long)}`))}${hangerLen.length ? `; ${listS(hangerLen.map((q) => `{{${q.id}}} ${fin(q.long)} between the hangers`))}` : ''}.`,
            taperLen.length ? `In the bow taper the rails close in, so measure at each crossmember's rear face (half its thickness behind its mortise centers), where they are farthest apart: its long point. ${listS(taperLen.map((q) => `{{${q.id}}} ${fin(q.long)}`))}.` : false,
            'Within 1/32" of these is right; outside that, find out why (a rail sprung at the bow) before cutting.',
            I(`Then cut each crossmember to the length you measured, not the cut list: the rails follow the deck.${taperLen.length ? ' Cut a tapered one to its long point, square; its ends are scribed to the rails at the dry fit below.' : ''}`, [], crossIds),
            cutBack.length ? I(`${tl(cutBack)} ${cutBack.length === 1 ? 'meets' : 'meet'} a brake knee backer: cut ${cutBack.length === 1 ? 'its' : 'their'} ends back ${fin(bkThick)} so ${cutBack.length === 1 ? 'it butts' : 'they butt'} the backer's face.`, [], cutBack) : false,
            hinge.length ? I(`The seat-hinge backers are cut to their cut-list size: ${tl(hinge)}. They carry the hinge layout on the drawing, not built work, so they need no check.`, [], hinge) : false,
          ], ['deck']),
          I('Bore the {{king-beam}} for the kingpin, and cut the nut slot, before the deck goes on.', [
            kingBore ? `${fin(c.p.kingpinDiaIn)} hole, square on the drill press: ${whereOf(kingBore)}.` : `${fin(c.p.kingpinDiaIn)} hole, square on the drill press: ${SEE}.`,
            ((ks) => `Nut slot from the front face: ${fin(ks.w)} wide × ${fin(ks.h)} tall, about ${fin(ks.x1 - ks.x0)} deep from the front face (${fin(computeLayout(c.p).king.x - ks.x0)} past the bore's center), its top ${fin(KING_NUT_BELOW_DECK_IN)} below the top face, centered on the bore. Its walls hold the kingpin's thin nylock (jam) nut by its flats (no washer), so the bolt is turned from its head.`)(kingNutSlot(c.p, computeLayout(c.p))),
            ...featsAll(c, 'king-beam', 'groove', /clamp-plate bolt heads/).slice(0, 1).map((q) => `Two reliefs across the bottom face, the full fore-aft length, ${wideDeep(q) ? `${wideDeep(q)![0]} wide × ${wideDeep(q)![1]} deep` : SEE}: ${featsAll(c, 'king-beam', 'groove', /clamp-plate bolt heads/).map((r) => lc(r.positions?.[0] ?? '').replace(/, the full height$/, '')).join(' and ')}. They clear the front clamp-plate bolt heads as the axle swings.`),
          ]),
          ...((an) => (an.length ? [I(`Drill the chain-anchor holes in {{joist-6}} (the chain crossmember) on the drill press now, before the glue-up: they cannot be drilled square once it is in. Fore-aft, one near each end: ${anchorHolesText(c, an) ?? holesText(an) ?? SEE}.`, ['The anchor eye bolts and the check chains go on at [[step:hang]].'])] : []))(featsAll(c, 'joist-6', 'hole', (q) => (q.to ?? []).some((t) => /^steer-anchor/.test(t)))),
          I('Dry-fit the rails (still 1/2" long at both ends), the crossmembers and the king beam on Dominos.', [
            joistDom?.positions?.length ? `Crossmember Dominos (5×30), at both ends of each crossmember: ${joistDom.positions.join('; ')}.` : 'Crossmember Dominos (5×30) at both ends of each crossmember.',
            joistCut ? 'The {{joist-1}} ends go into the hanger mortises, not the rails.' : false,
            taperLen.length ? `In the bow taper the ends meet the bent rails at up to ${f(angle, 0)}°: each tapered crossmember was cut to its long point above, so scribe each end to its rail now (pencil from the rail, then bandsaw or miter). Its front face comes out shorter: ${listS(taperLen.map((q) => `{{${q.id}}} ${fin(q.short)}`))}.` : false,
          ], crossIds),
          I('Before any glue: lay the {{deck}} on the dry frame and check the frame against it. The deck already follows the sides\' line, so the frame is set to the deck, never the deck trimmed to the frame.', [
            deckFit ? `Ends: the deck's rear edge stands ${fin(deckFit.behind)} behind the finished-end marks on both rails, and its bow edge ${fin(deckFit.ahead)} past the bow-end marks. Slide the deck until the rear edge is right on both rails (within 1/32").` : 'Ends: set the deck\'s rear edge from the deck drawing against the finished-end marks on the rails.',
            deckFit?.inset ? `Sides: the deck edge sits in from the rail's outer face by ${deckFit.inset}. Measure square off the rail's outer face with a combination square, on both sides; within 1/32".` : 'Sides: the deck edge sits an even distance in from each rail\'s outer face along its whole length.',
            deckFit ? `Rail spacing over the outer faces: ${fin(deckFit.wRear)} at the finished rear ends and ${fin(deckFit.wBow)} at the bow-end marks, within 1/32". Diagonals from the finished-end marks equal within 1/16".` : 'Diagonals from the finished-end marks equal within 1/16".',
            'If you made the hardboard deck, do this check with it first, then with the real deck.',
            'If a station is off: a rail that sprang back in the bow pushes the deck edge out of line there. Re-scribe that crossmember (a shorter one pulls the rails in; a new, longer one lets them out) and check again. Never trim the deck.',
            hbBehind ? `When it is right: tick the deck edge and the rail top together at 3 places a side, so the deck goes back to the same place at the glue-up. Tick the rear face of {{${hbBehind.x.id}}} on both deck edges, lift the deck off, turn it over, and join the ticks across its underside with a square.` : 'When it is right: tick the deck edge and the rail top together at 3 places a side, so the deck goes back to the same place at the glue-up.',
          ], ['deck']),
          ...(hinge.length ? [I(`The day before the deck glue-up, after this dry fit: glue the seat-hinge backers to the deck underside with ${std ? 'Titebond III' : 'epoxy'}: ${tl(hinge)}.`, [hingeAt, 'The seat-back hinge screws and the latch pin (it holds the seat back folded flat, [[step:seat-back]]) then land in solid oak.'])] : []),
          I(`Glue-up, all in thickened epoxy (one glue for one glue-up): Domino the crossmembers to the rails (in the mortises, on the Dominos and on the end grain), then bond the {{deck}} (its underside sealed in [[step:seal]]) on top with thickened epoxy.`, [
            `Thickened epoxy (${EPOXY_SYSTEM.thickener}, glue card) on every top face: rails, crossmembers and king beam${brakeBackers.length ? ', and the top edge of each brake knee backer' : ''}.`,
            'Set the deck down on its ticks from the dry fit, its rear edge on both rails\' marks.',
            `Weight the deck down; it bonds full length to the rail and crossmember tops${brakeBackers.length ? ' and to the backers' : ''}.`,
            'The rails stay long (they are trimmed at [[step:rail-ends]]). The deck is already cut to shape: it narrows toward the bow with the sides.',
          ]),
        ],
        checks: ['Frame square: diagonals equal within 1/16"', 'Deck on the dry frame: its rear edge on the rails\' marks and its edge an even distance in from both rails\' outer faces, within 1/32", before any glue', 'Deck flat under a straightedge (no twist or rocking)', 'Squeeze-out cleaned off the deck edge before it hardens (the edge must slide into the sides at the dry fit)'],
      };
}

const TEMPLATES_2: Template[] = [

  // ---------------- 4.2: sides ----------------
  {
    id: 'sides-inner',
    title: 'Side sandwiches, cure 1: web and inner bands',
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(web|chine-in|gunwale-in)|sign-backer-[LR]\d)$/,
    view: 'side',
    why: 'The first of the two glue-ups that make each side. The inner bands lock the side\'s two bends (its curved top and the curve-in at the bow) into the thin web; the outer bands, next step, finish the sandwich.',
    tools: ['S-ramp', 'cleats and screws', 'bags of sand and a plastic sheet', 'epoxy pumps', 'flashlight', 'drill'],
    hardener: '556',
    build: (c) => {
      const backers = c.mine.filter((x) => /^sign-backer/.test(x.id));
      const webL = c.by('side-L-web');
      const web0 = webL ? worldAABB(webL).min[0] : 0;
      const bL = backers.filter((x) => /-L\d$/.test(x.id)).map((x) => worldAABB(x)).sort((a, b) => a.min[0] - b.min[0]);
      const ins = feat(c, 'sign-backer-L1', 'hole', /insert/);
      const cleat = c.forms().find((d) => d.id === 'side-form')?.dims.find((q) => q.key === 'cleat-spacing')?.valueIn;
      // The side form drawing's glue-up (how many clamps, where): the form step builds the form, this step uses it.
      const glueUp = formBuild(c.forms().find((d) => d.id === 'side-form')).find((q) => /^GLUE-UP/.test(q.text));
      const sub = (re: RegExp): string | undefined => glueUp?.sub?.map((q) => q.text).find((q) => re.test(q));
      const bagsBand = sub(/^A sheet of plastic/), bagsS = sub(/^Lay \d+ bags/), bags = sub(/^Bags:/);
      const hold = sub(/^No spring-back/);
      const bandSize = (id: string): string => { const st = c.by(id)?.stock; return st ? `${thick(st.t)} × ${fin(st.w)}` : ''; };
      return {
        goal: backers.length ? 'Glue the inner bands and the sign backers to each web while the web is bent over the S-ramp.' : 'Glue the inner bands to each web while the web lies bent over the S-ramp.',
        items: [
          I('Before any glue: check the cleats and the packing tape.', [
            cleat ? `The cleats stand on edge about ${near16(cleat)} apart the whole length, set against the dry web (side form drawing).` : 'The cleats run the whole length, set against the dry web (side form drawing).',
            'Screw them solid: an edge-bent band pushes about 65 lbf sideways until the epoxy cures.',
            'Rip each band to its width (cut list) and plane it to thickness today.',
            'If a band is too short and you must scarf it (8:1): the middle third of the band only; never in the first 4" behind the transom, nor where a grab board, a rib head or a sign will go; stagger it 12" from the joint in the band on the same face.',
          ]),
          I('Dry-fit the web: lay it on the template INSIDE face up, its bottom edge on the template\'s bottom edge and its top edge 1/8" off the cleats (hold the hardboard scrap between them at a few cleats).', [
            'The web fits the template outline only one way up: that face is its inside. Pencil INSIDE L on it (INSIDE R on the right web, when its turn comes).',
            'The S-ramp lifts the bow end toward the inside: that is the turn-in.',
          ], ['side-L-web', 'side-R-web']),
          I('Epoxy the inner gunwale band and the inner chine band to the inside face of the web, full face.', [
            `The inner chine band is ${bandSize('side-L-chine-in')} and the inner gunwale band ${bandSize('side-L-gunwale-in')}.`,
            'Thickened epoxy. The bands glue flat to the web; nothing is routed.',
            'The gunwale band goes tight against the cleats.',
            `The chine band stops ${fin(computeLayout(c.p).ply + c.p.deckSlopIn)} short of the web's bottom edge, leaving the deck slot: the deck thickness plus about ${fin(c.p.deckSlopIn)}. Lay a spacer stick that wide (a deck offcut on edge plus a shim, taped) on the web against the edge stops, butt the chine band against it, and pull the stick before the epoxy gels.`,
          ], ['side-L-chine-in', 'side-L-gunwale-in', 'side-R-chine-in', 'side-R-gunwale-in']),
          I('Weight it down: no clamp can get a jaw under the web.', [
            bagsBand ? loosen(bagsBand) : 'A sheet of plastic over the wet bands, then a bag of sand about every 6" along each band.',
            bagsS ? loosen(bagsS) : false,
            bags ? loosen(bags) : false,
            hold ? loosen(hold.replace(/ \(24 h\)/, '')) : false,
          ]),
          ...(backers.length
            ? [I(`Glue the sign backers inside each web: ${plural(backers.length / 2, 'strip')} per side, grain vertical.`, [
              bL.length ? `Forward of the web's rear end: ${bL.map((q) => `${fin(q.min[0] - web0)} to ${fin(q.max[0] - web0)}`).join(', and ')}.` : SEE_ITEM,
              'Top edge just under the inner gunwale band.',
              ins ? `Two #10-32 inserts each, epoxied: ${whereOf(ins)}.` : 'Two #10-32 inserts each.',
            ], backers.map((x) => x.id))]
            : []),
          I('Left side first; the forms are set for it (the right side is its mirror image).', [
            'Day 1: the left web, this face, on the S-ramp.',
            'Day 2: first glue the left web\'s second face on the mirror ramp (next step); then unscrew and turn the S-ramp bench\'s template for the right side (side form drawing: RIGHT SIDE) and glue the right web\'s first face.',
            'Day 3: re-set the mirror ramp\'s cleats and glue the right web\'s second face.',
          ]),
        ],
        checks: ['Sheer line follows the web pattern', 'The web lies hard on the S-ramp from the S start to the bow end (flashlight from the side)', 'Bands fully bonded, no lift at the bow bend (tap test)'],
      };
    },
  },
  {
    id: 'sides-outer',
    title: 'Side sandwiches, cure 2: outer bands and drain holes',
    retitle: (p) => (isStandard(p) ? undefined : 'Side sandwiches, cure 2: outer bands and scuppers'),
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(chine|gunwale)|scupper-.*)$/,
    view: 'side',
    why: 'The second glue-up closes each side into its finished band, web, band sandwich: it stands on the rail and carries the load. The drain holes let water off the deck at the foot of each side.',
    tools: ['mirror ramp', 'cleats and screws', 'bags of sand and a plastic sheet', 'epoxy pumps', 'drill'],
    hardener: '556',
    build: (c) => {
      const web = c.by('side-L-web');
      const scup = c.mine.filter((x) => /^scupper/.test(x.id));
      const web0 = web ? worldAABB(web).min[0] : 0;
      const scupX = [...new Set(scup.filter((x) => /-L$/.test(x.id)).map((x) => +(stationOf(x, web0) ?? 0).toFixed(2)))].sort((a, b) => a - b);
      const drains = drainHoles(c.parts, c.p);
      // The centers as the band drawing gives them, from the same datum (the inner face of the rear transom), so the step and the drawings read alike.
      const faceFeat = featsAll(c, 'side-L-chine', 'hole', (q) => /inner face of the rear transom/.test((q.positions ?? []).join(' ')))[0];
      const fromFace = /^(.+?) from the inner face of the rear transom/.exec(faceFeat?.positions?.[0] ?? '')?.[1];
      const dia = fin(c.p.scupperDiaIn);
      const bandSize = (id: string): string => { const st = c.by(id)?.stock; return st ? `${thick(st.t)} × ${fin(st.w)}` : ''; };
      // The web's Shaper file already cuts the drain holes through the web: they guide the bit through the bands, so no second hole is drilled in the web.
      const webDrainCut = !scup.length && drains?.side ? fileCutHole(c, 'side-L-web', (q) => q.joint === 'hole' && diaNear(q, drains.diaIn)) : undefined;
      return {
        goal: scup.length ? 'Glue the outer bands and fit the scuppers in each side.' : 'Glue the outer bands and drill the drain holes in each side.',
        glue: { epoxy: true, titebond: false },
        items: [
          ...(webDrainCut ? [I(`Before the web goes on the mirror ramp: drill the inner band through the web's own drain holes (${dia}, made with the web).`, [
            'The inner chine band now covers each hole on the inside. Lay the side outside face up, a scrap block under the inner band at each hole.',
            `Drill straight down through the web's hole and the inner band with a ${dia} brad-point bit: the web's hole is the guide, so the band hole lines up with it.`,
            'The outer band is drilled through the same hole after this cure (below).',
          ], ['side-L-web', 'side-R-web'])] : []),
          I('Turn the web over along its length onto the MIRROR ramp for this second face, rear end still at the rear, outside face up.', [
            'Never the S-ramp: the cured web would have to bend back.',
            'Its top edge is now on the other side of the bench, 1/8" off this bench\'s cleats; its straight bottom edge against the edge stops.',
          ], ['side-L-web', 'side-R-web']),
          I(`Lay the backing strip on the cap under the web's bottom edge: ${fin(c.p.deckSlopIn + (computeLayout(c.p).ply))} wide and as thick as a band (an offcut).`, [
            'The inner chine band stops short of the bottom edge, so without it the outer chine band would have nothing under it.',
          ]),
          I('Epoxy the outer chine band and the outer gunwale band to the outside face.', [
            `The outer chine band is ${bandSize('side-L-chine')} and the outer gunwale band ${bandSize('side-L-gunwale')}.`,
            'Push the outer chine band against the edge stops, so it runs flush with the web\'s bottom edge: it is the face that sits on the rail.',
            `The gunwale band bends on edge to the sheer and across its thickness to the S, both at once; leave it ${fin(c.p.gunwaleEndLongIn)} past each web end and set the end stops against it.`,
          ], ['side-L-chine', 'side-L-gunwale', 'side-R-chine', 'side-R-gunwale']),
          I('Weight the bands with the same bags as cure 1, along the bands only: the web keeps its S now.'),
          I('Once this cure is hard, fill the gap along the top: the web stops 1/8" under the top of the gunwale bands.', ['Thickened epoxy, then trim flush, so no plywood edge shows.']),
          scup.length
            ? I(`Drill the scuppers: ${plural(scup.length, 'hole')}, ${dia}, through inner band, web and outer band.`, [
              scupX.length ? `${list(scupX)} forward of the web's rear end, the lower edge just above the deck level.` : 'Rear and bow, the lower edge just above the deck level.',
              'Line each hole with epoxy and bed the stainless nipples.',
            ], scup.map((x) => x.id))
            : drains?.side
              ? webDrainCut
                ? I(`Drill the drain holes on through the outer band once the cure is hard: ${drains.side.xs.length} in each side, ${dia}, from the inside, through the holes already in the web and the inner band.`, [
                  `They sit ${fromFace ?? list(drains.side.xs)} forward of the transom line (a square line ${fin(drains.side.faceInIn)} in from the rear end of the web), ${fin(drains.side.upIn)} up from the web's bottom edge: the web's file put them there, so nothing is measured here.`,
                  'Clamp a backer block on the outside of the outer band at each hole, then drill from the inside with the bit through the existing hole, square to the side: no new hole in the web.',
                  'Brush epoxy into each bore (a small brush or a pipe cleaner), so no cut oak or plywood edge is left bare. Run the bit through again after the epoxy cures if it narrowed the hole.',
                ], ['side-L-web', 'side-R-web'])
                : I(`Drill the drain holes once the cure is hard: ${drains.side.xs.length} in each side, ${dia}, straight through the inner band, the web and the outer band.`, [
                `Mark the transom line on each side first: a square line ${fin(drains.side.faceInIn)} in from the rear end of the web. The web's last ${fin(drains.side.faceInIn)} sits in the transom's groove, so this line is the transom's inner face; at the dry fit the bands are trimmed back to it.`,
                `Centers ${fromFace ?? list(drains.side.xs)} forward of that line, measured along the bottom edge (the same numbers as on the band and web drawings), ${fin(drains.side.upIn)} up from the web's bottom edge (the edge that rests on the rail). The lower edge of each hole then sits 1/16" above the deck; it just nicks the lower edge of the inner chine band, which is expected (the epoxy below seals it).`,
                'Drill square to the side in one pass through all three layers, with a backer board behind the exit so the outer band does not tear.',
                'Brush epoxy into each bore (a small brush or a pipe cleaner), so no cut oak or plywood edge is left bare. Run the bit through again after the epoxy cures if it narrowed the hole.',
              ], ['side-L-web', 'side-R-web'])
              : I('No drain holes in this model.'),
          I('Leave the bands long: they are cut to length at the dry fit, with the small trim of the webs.'),
        ],
        checks: ['Four bands per side bonded; the bands end the same distance from the web ends, at the bow and at the rear', 'Both sides mirror images within 1/16"', ...(scup.length ? [] : [`The ${dia} drain holes clear and sealed, square to the side`])],
      };
    },
  },
  {
    id: 'dry-fit',
    title: 'Dry-fit the frame in the sides',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'top',
    why: 'Everything is fitted dry once, upside down, before any glue: the frame and deck unit goes into the two sides, and the band ends are cut back to the webs. The next step trims the rails and drills the pilots with the unit sitting here.',
    tools: ['tape', 'story stick', 'MDF station cradles', 'flush-cut (Japanese) saw', 'hand plane'],
    build: (c) => {
      const { net, web0, cradles, ch, into } = dryFitData(c);
      return {
        goal: 'Set the inverted sides in their cradles, trim the band ends to the webs, and lower the frame + deck unit in dry.',
        items: [
          I('From here until the hull is turned upright ([[step:flip]]), "top", "bottom", "up" and "under" mean as on the finished sled; the step says when it means the way the hull lies now.'),
          I(`Make ${cradles.length} MDF station cradles, each a 3/4" MDF plate (shop jigs, not sled parts).`, [
            `Each is a 3/4" MDF plate ${fin(ch.postIn)} tall and ${fin(2 * CRADLE_POST_W_IN)} wider than the hull at its station, with a slot near each end that the side's top edge (the sheer) drops into; the ${fin(CRADLE_POST_W_IN)} strip left outside each slot is the post.`,
            `Cut the plate down between the slots to ${fin(ch.middleIn)} from the floor, so it clears the inner chine band and the deck.`,
            `The slot floors are set so the sides' bottom edges all come out at ${fin(ch.edgeIn)} from the floor: each slot floor is ${fin(ch.edgeIn)} less the side's height at that cradle.`,
            ...cradles.map((q, i) => `Cradle ${i + 1}: ${near8(q.x - web0)} from the rear end of the sides; plate ${near16(q.plateWidthIn)} wide (the hull is ${near16(q.widthIn)} wide outside there); the side is ${near16(q.heightIn)} tall there, so the slot floors are ${near16(q.slotFloorIn)} from the floor; slots ${fin(q.slotWidthIn)} wide${q.angleDeg > 1 ? ` (the side crosses this cradle at ${Math.round(q.angleDeg)}°, so the slots are cut wider)` : ''}.`),
          ]),
          I('Set the cradles square across the floor at their stations and drop both sides into the slots, top edge (the sheer) down.', [
            'Leave the sides in the cradles and do not move the cradles until the glue-up: the posts hold each side where the dry fit put it.',
            'Pencil a tick across each side and the post beside it at every cradle, so you will see if a side slides fore or aft.',
          ]),
          I('Before the unit goes in: check the webs and trim the bands.', [
            `The transom and bulkhead are not on yet, so measure the webs themselves, not a gap: each web came off the Shaper at ${net !== undefined ? fin(net) : 'the length on the side drawing'}, its length on the side drawing. Check both sides within 1/32"; the webs are not trimmed.`,
            `At each end, saw and pare the four bands back ${fin(into)} from the web end, so ${fin(into)} of bare web stands out to go into the dado.`,
            'Mark where the bulkhead goes: a square pencil line across the inside of each side at the bow band ends. The bulkhead\'s rear face lands on it.',
          ]),
          I('Turn the frame + deck unit over and lower it in DRY, straight down between the cradle posts.', [
            'Each rail rests on the bottom edge of its side (on top now): the edge of the outer band and the web.',
            'The deck edge goes in beside the web, under the inner chine band (as on the finished sled; the band lies below it now).',
            `Slide the unit fore or aft until both deck ends line up with the web ends, and the finished-end marks on the rails (made at [[step:hangers]]) line up with the rear band ends (${fin(into)} in from the web ends). If the two disagree by more than 1/16", stop and find out why.`,
            `Check the deck slot: ${fin(c.p.deckSideClearIn)} a side to each web. Pare the deck edge if it binds; thickened epoxy fills the slot later.`,
            'A pared length has lost its seal coat: brush one coat of unthickened epoxy on it the same day and let it cure before the glue-up, then wash the blush off and scuff it (as in [[step:seal]]).',
          ]),
        ],
        checks: ['Both webs measure their drawing length within 1/32"', 'Unit drops in between the posts without forcing', `The webs stand ${fin(into)} past the band ends at both ends`, 'Pencil ticks still line up at every cradle'],
      };
    },
  },
  {
    id: 'rail-ends',
    title: 'Trim the rails, mortise their ends, drill the screw pilots',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'top',
    why: 'With the frame sitting dry in the sides, the rail ends are marked to the bands and the screw pilots are drilled through the rail holes, so the screws pull each side back to exactly this place at the glue-up.',
    tools: ['flush-cut (Japanese) saw', 'Domino', 'guided router', 'drill', '1/8" × 6" aircraft bit'],
    build: (c) => {
      const { tie, pilots, pilotXs, tMort, bMort, into, railIn, deckFinal, cb, flagText } = dryFitData(c);
      return {
        goal: 'Mark the rail ends and drill the screw pilots with the unit still in the sides, then trim the rails and cut their end mortises on the horses.',
        items: [
          I('Mark the rail ends in place, with the unit still sitting dry in the sides.', [
            `Mark each rail end flush with the band ends, ${fin(railIn)} in from the deck end, and square the line across. Do not saw here: the web edge stands ${fin(into)} past the bands, right beside the saw.`,
            deckFinal ? `The deck is already at its final length: its ends line up with the web ends, and both go ${fin(into)} into the dados.` : 'Trim the deck ends to line up with the web ends.',
          ], ['rail-L', 'rail-R']),
          ...(pilots.length ? [I(`Drill the screw pilots in the bottom edge of each side, through the rail holes: ${tie.perRail} a side.`, [
            'With the unit sitting dry in the sides, put a 1/8" × 6" aircraft (extra-long) bit through each clearance hole in the rail and drill straight down into the bottom edge of the side (on top now; the rail\'s bottom edge faces up).',
            ...pilots.map((q) => `${q.count === 1 ? '1 pilot' : `${q.count} pilots`}: ${q.size}${flagText(q)}.`),
            pilotXs.length ? `Their centers, from the rear end (the finished end, marked at [[step:hangers]]): ${list(pilotXs)}.` : false,
            `Make each tape flag wider than ${cb ? `the ${cb}" counterbore` : 'the counterbore'}, so it stops on the rail's face: then no pilot comes out through the face of the web or the outer band.`,
            'The rail holes put each pilot on the centerline of the edge, on the glue line between the outer band and the web; the outer chine band drawing lists every pilot.',
            'These pilots are what registers the side at the glue-up: each screw finds its pilot and draws the side onto the rail.',
          ], ['rail-L', 'rail-R', 'side-L-chine', 'side-R-chine'])] : []),
          I('Lift the unit out onto padded horses.', ['Brush the pilots clear, and mark each rail beside its side (L, R), so it goes back the same way.']),
          I('On the horses: trim the rails, then cut the rail-end mortises in the trimmed ends.', [
            'Trim the rails (left 1/2" long): saw to the marks with a flush-cut saw against a clamped square block, then pare to the line.',
            `Transom end: ${mortiseSize(tMort) ? `${mortiseSize(tMort)} loose-tenon mortise` : endJoint(c, 'rail-L', 'transom-rear')}${fromTop(tMort) ? `, centered ${fromTop(tMort)}` : ''}.`,
            `Bulkhead end: ${mortiseSize(bMort) ? `${mortiseSize(bMort)} loose-tenon mortise` : endJoint(c, 'rail-L', 'bow-bulkhead')}${fromTop(bMort) ? `, centered ${fromTop(bMort)}` : ''}.`,
            `The deck and web ends stand ${fin(into)} past the trimmed rail ends: put a ${fin(into)} spacer (hardboard or plywood, slotted for the cutter) between the machine's face and the rail end so the machine clears them, and set the depth one stop deeper (on a router, ${fin(into)} deeper).`,
            'Domino on the glued unit, or a guided router on a fence against the end face. Their mates are cut in the transom and the bulkhead at [[step:ends]], after the end templates have been tried on these mortises.',
          ], ['rail-L', 'rail-R']),
          I('Rehearse the glue-up dry, alone, in the same sequence as the next step.', ['Lower the unit between the cradle posts, start every screw, set the clamps and cauls, then lift it out again.', 'Time it: the time sets the batch sizes in the next step.']),
        ],
        checks: [`Rails and bands end at the same station, the webs ${fin(into)} past them`, 'Every pilot drilled square, none through the face of the web or the outer band', 'Rail-end mortises centered on the rail ends'],
      };
    },
  },
  {
    id: 'lower',
    title: 'Lower the frame + deck unit into the inverted sides',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'iso',
    why: 'This glue-up joins the floor to the walls: each side is bedded in epoxy on its rail and screwed down at the pilots from the dry fit, so the hull becomes one stiff box (still open at both ends).',
    tools: ['epoxy pumps', 'clamps and cauls', 'drill', 'screwdriver', 'long slim driver bit to match the screws (#1 square or T15)', 'plug cutter'],
    hardener: '556',
    build: (c) => {
      const tie = chineTie(c.parts);
      const railScrew = c.by('rail-L')?.joints?.find((j) => j.type === 'screw' && /chine/.test(j.to));
      const tieHoles = featsAll(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /chine/.test(t)));
      const cbore = /counterbore the head ([\d.\-\/]+"?) up the rail/.exec(railScrew?.size ?? '')?.[1];
      const cbDia = /\(([\d\/-]+")\s*bit\)/.exec(railScrew?.size ?? '')?.[1];
      // the screws whose heads are countersunk, not counterbored (the rail is shallow ahead of the step)
      const fwdScrews = tieHoles.filter((q) => !/counterbore/.test(q.size ?? '')).reduce((n, q) => n + q.count, 0);
      const bed = fin((c.by('side-L-chine')?.stock?.t ?? 0.234) + (c.by('side-L-web')?.stock?.t ?? 0.157));
      const pilotText = tieHoles.length ? `an ${/^(\S+") clearance/.exec(tieHoles[0].size ?? '')?.[1] ?? '11/64"'} clearance hole through the rail and a ${fin(SCREW_PILOT[8])} pilot in the side` : 'the clearance and pilot holes on the drawings';
      return {
        goal: 'Glue the frame + deck unit into the inverted sides for good.',
        glue: { epoxy: true, titebond: false },
        items: [
          I('Lay everything out before you mix.', [
            'Within reach: the screws and a driver, the clamps and cauls, a mixing tray, the thickener and a stick.',
            `Pot-life budget: both beds and the deck edges about 7 min, the lowering 2 min, ${tie.perRail * 2} screws about ${Math.round(tie.perRail * 2 * 0.5)} min (30 s each) and the clamps 5 min: about ${12 + Math.round(tie.perRail * 2 * 0.5)} min. The pot life is ${EPOXY_SYSTEM.potMin[0]}-${EPOXY_SYSTEM.potMin[1]} min in the cup and less in a thick heap, so mix in TWO batches: one for the beds and the deck edges, one small one to top up the deck slots after.`,
          ]),
          I(`Spread a bed of epoxy thickened with ${EPOXY_SYSTEM.thickener} (to peanut butter) along the whole ${bed} bearing face of both sides (outer band + web edge).`, [
            'Spread both sides before anything is lowered.',
            'Thin epoxy runs out of the joint and leaves it starved: the bed must be thick enough to fill the small gaps between the rail and the side.',
            'From the same batch, butter both deck edges: the slot between the deck edge and the web is closed in by the rail once the unit is down, so it fills as the unit goes in.',
          ], ['rail-L', 'rail-R']),
          I('Lower the unit onto the sides, alone.', [
            'Carry it by the rail ends (the transom and bulkhead go on later). Hold it level over the sides and lower it straight down between the cradle posts onto the beds.',
            'Line each rail hole up over its pilot as it comes down; start the two end screws first.',
          ]),
          I(`Screw each rail to its side in every gap: ${tie.perRail} screws a side, ${/-head$/.test(tie.screw) ? `${tie.screw}s` : `${tie.screw} ${/trim-head/.test(railScrew?.size ?? '') ? 'trim-heads' : 'flat-heads'}`}, evenly spaced${tie.spacingIn ? ` (about ${fin(Math.round(tie.spacingIn * 4) / 4)} apart)` : ''}.`, [
            `Each screw has ${pilotText}. Because the pilots were drilled through the rail holes at [[step:rail-ends]], each screw registers the side: it finds its pilot and draws the side onto the rail where the dry fit put it.`,
            'They go straight down through the rail (the hull is inverted) into the sandwich.',
            ...(cbore ? [`The aft heads sit in ${cbDia ?? 'the'} counterbores ${/"$/.test(cbore) ? cbore : `${fin(Number(cbore))}`} deep in the rail's bottom edge; ${fwdScrews === 1 ? 'the forward screw is' : `the ${fwdScrews} forward screws are`} only countersunk flush, because the rail is shallow there (ahead of its step) and the same screw still reaches its pilot. The counterbores are plugged after the cure (last item).`] : []),
            ...(cbore ? [`Drive them with a bit that matches the screws (#1 square or T15), at least ${fin(Number(String(cbore).replace(/"$/, '')) + 1)} long with a slim shank: it must reach ${/"$/.test(cbore) ? cbore : `${fin(Number(cbore))}`} down a ${cbDia ?? ''} counterbore.`] : []),
            'Drive them from the middle of the rail out toward the ends, snug, so the side pulls onto the rail without a gap. Do not overdrive: the edge is only the width of the outer band and the web.',
          ], ['rail-L', 'rail-R']),
          I('Clamp the side to the rail between the screws.', [
            'Small bar clamps, jaws on the rail\'s inner face and on a straight caul along the outside of the outer band, set at the joint.',
            'They keep the side flush with the rail until the epoxy cures.',
          ]),
          I('Then fill the deck slot (the slot between the deck edge and the web) from both open hull ends with thickened epoxy (the second, small batch).', ['Look along each slot from the ends with a light: a syringe of thickened epoxy fills any gap the buttered edge left near the ends.', 'Wipe squeeze-out off the web ends before it kicks: they go into the transom and bulkhead dados next.']),
          ...(cbore ? [I('After the cure, glue an oak plug into each counterbore and pare it flush with the rail\'s bottom edge.', [`${cbDia ?? 'Counterbore-size'} oak plugs from a plug cutter on offcuts (or a dowel of that size).`], ['rail-L', 'rail-R'])] : []),
        ],
        checks: ['Both webs seat fully on the rails, no daylight at the chine', 'Every screw snug; none has split the edge of the sandwich', 'Hull diagonals equal within 1/8"'],
      };
    },
  },

  // ---------------- 4.4: close the ends ----------------
  {
    id: 'ends',
    title: 'Cut the transom and the bulkhead to the hull, then dry-fit both ends',
    kind: 'process',
    steps: [HULL_STEP.transom],
    view: 'iso',
    why: 'The transom and the bow bulkhead close the hull ends. Their dados must take the web ends and the deck end as the hull came out of the glue-up, with only about 1/64" to spare a side, so they are cut now, from the hull, after a plywood copy of each (the end templates) has been tried on it.',
    forParts: /^(transom-rear|bow-bulkhead)$/,
    // D-94: cut to the hull as built (the dados, the deck dado and the rail-end mortises all meet it at once).
    cuts: /^(transom-rear|bow-bulkhead)$/,
    cutAfter: 'lower',
    tools: ['laser (end templates)', 'Shaper Origin', 'ShaperTape', 'Domino DF 500', 'bandsaw', 'router with a pattern bit', 'square', 'feeler gauge'],
    build: (c) => {
      const tr = c.by('transom-rear'), bh = c.by('bow-bulkhead'), rail = c.by('rail-L');
      const L = computeLayout(c.p);
      const rb = rail ? worldAABB(rail) : undefined;
      const jointAt = (to: string): [number, number, number] | undefined => { const j = rail?.joints?.find((q) => q.to === to && q.at?.length); return j && rail ? transformPoint(rail.transform, j.at![0]) : undefined; };
      const tJ = jointAt('transom-rear'), bJ = jointAt('bow-bulkhead');
      const railTop = rb?.max[2];
      const at = (q: [number, number, number] | undefined): string | undefined => (q && railTop !== undefined ? `${fin(Math.abs(q[1]))} either side of the centerline and ${fin(railTop - q[2])} below the deck's underside` : undefined);
      const wRear = rb ? 2 * outerHalfWidth(L, rb.min[0]) : undefined, wBow = rb ? 2 * outerHalfWidth(L, rb.max[0]) : undefined;
      const web = c.by('side-L-web'), band = c.by('side-L-chine');
      const standOut = web && band ? worldAABB(band).min[0] - worldAABB(web).min[0] : c.p.deckCaptureDepthIn;
      const spare = c.p.deckSlopIn / 2;
      const deep = shaperFeaturesOf(c, 'bow-bulkhead').some((q) => q.deep);
      const dj = rail?.joints?.find((q) => q.to === 'bow-bulkhead' && q.type === 'domino');
      const tj = rail?.joints?.find((q) => q.type === 'mortise-tenon' && q.to === 'transom-rear');
      const tm = tj ? new RegExp(`^(${FR}) × (${FR}) × (${FR}) deep`).exec(tj.size ?? '') : null;
      const nTenon = c.parts.filter((x) => /^rail-[LR]$/.test(x.id)).length;
      return {
        goal: 'Try a plywood template of each end on the hull, cut the transom and the bulkhead to it, then push both ends on dry before any epoxy is mixed.',
        items: [
          I('Cut the end templates on the laser (Forms section: end templates), with the crown templates (handlebow and bulkhead crown), about 20 minutes.', [
            '1/4" plywood copies of the transom and the bulkhead, their dados and rail mortises cut right through as slots and each end\'s outline scored on them.',
            'Keep them until both ends are glued on: they are the record of where the dados went. The handlebow template waits for [[step:handle]].',
          ]),
          ...(tm ? [I(`Make ${plural(nTenon, 'loose tenon')} from rounded-edge tenon stock, ${tm[1]}" × ${tm[2]}" × just under ${fin(2 * parseFrac(tm[3]))} long: they go into the rails' rear mortises dry now, and are glued in at [[step:transom]].`)] : []),
          I('Before you cut: try the end templates on the hull, once the lower glue-up has cured (12-24 h).', [
            'The hull is still upside down: "up" and "down" below mean as on the finished sled.',
            `Push a dry loose tenon into each rail's rear mortise and a dry ${dj ? `${dominoKey(dj)} ` : ''}Domino into each bow mortise, half of each standing out.`,
            `Rear: push the transom template straight on by hand. Both web ends, the deck end and both tenons must come through their slots (the web and deck ends stand ${fin(standOut)} past the band and rail ends), and the template must lie flat on all eight band ends: no gap a 1/32" feeler enters.`,
            'Bow: the same with the bulkhead template, its face on the pencil line from the dry fit.',
            wRear !== undefined && wBow !== undefined ? `Measure at each end, at the deck and at the gunwale: ${fin(wRear)} over the outer bands at the rear and ${fin(wBow)} at the bow, within 1/32" overall (the dados have about ${fin(spare)} to spare a side). The scored outline's sides lie on the outer bands' faces. A hull 1/32" wider than the template at one end is more than its dados can take: use the fallback below.` : false,
            'Each web end stands square to the deck, within 1/32" over its height: the hull is inverted, so hold the square\'s stock up against the deck\'s top face (facing down now) at the open end, its blade along the web end.',
            at(tJ) && at(bJ) ? `Rail ends: the tenons sit ${at(tJ)} at the rear; the Dominos ${at(bJ)} at the bow.` : false,
            'The laser\'s kerf leaves the template slots a hair looser than the Shaper\'s dados: a template that goes on is the first check, the oak dry fit (below) is the last.',
            'If a slot binds or the template stands off a band end: find out why first (a band end not square, epoxy squeeze-out on a web end, a side sprung at the top).',
            'If the hull itself is off by up to 1/16" a side: cut the end from its file as it is, then widen that dado toward the web on the Shaper by the amount you measured (the Shaper\'s offset widens both walls, so it widens, it does not move); thickened epoxy fills the extra at the glue-up.',
            'If it is off by more than 1/16" a side: make a COPY of the design, enter the hull width you measured in the copy, export only the transom and bulkhead files from it, and cut a new template from the copy to prove them. Keep the original design for everything else. An end cut wider than its band ends is planed flush after the glue-up.',
          ], ['transom-rear', 'bow-bulkhead']),
          ...(tr ? [I(`Cut the {{transom-rear}} on the Shaper from its file, from the edge-glued panel (planed to ${thick(tr.stock?.t ?? 0.5)} at [[step:mill]]).`, [
            'The file cuts the outline, both web dados (open at the top edge), the deck dado running into them, the two rail mortises, the hand hole and the socket screw holes. The vent holes and the cord-eye pilots are only marked: they are drilled at the transom step.',
            'Cut it with the dados on the face the file says is up: that face goes against the hull.',
          ])] : []),
          ...(bh ? [I(`Cut the {{bow-bulkhead}} on the Shaper from its file, from the laminated block (planed to ${thick(bh.stock?.t ?? 1.5)} at [[step:mill]]).`, [
            deep ? 'The block is deeper than the bit: the Shaper cuts the outline and the hand hole as deep as it reaches from the dado face; then bandsaw outside the line and flush-trim with a pattern bit riding the Shaper-cut edge.' : false,
            'The file cuts both web dados (open at the top edge), the deck dado running into them and the hand hole. Check the crown with the bulkhead crown template.',
            dj ? `Then the two ${dominoKey(dj)} Domino mortises in its rear face (the dado face): lay the bulkhead template on it, its slots over the dados, and mark the two Domino slots through it. Cut them at the marks on the Domino's middle width setting (a little play up and down, so the bulkhead can settle onto its dados); the rail-end mortises stay on the tight setting.` : false,
          ])] : []),
          I('Seal the two ends before any glue-up: one coat of unthickened epoxy on the transom\'s and the bulkhead\'s edges (their side edges are end grain) and in their hand holes.', [
            'Keep it out of the dados, the mortises and the faces that glue to the hull.',
            'Let it cure, then wash the blush off and scuff it (as in [[step:seal]]) before [[step:transom]].',
            `Then check the sealed deck enters its dados: each dado is the deck's thickness plus about ${fin(c.p.deckSlopIn)} (a feeler gauge, or a deck offcut pushed in).`,
          ], ['transom-rear', 'bow-bulkhead']),
          I('Dry-fit BOTH ends, with no glue, before any epoxy is mixed.', [
            'Transom: push it straight on by hand, the tenons dry in the rail mortises; it must go fully home, the deck edge, both web ends and both tenons entering together.',
            'Bulkhead: push it straight back by hand onto the dry Dominos until its rear face sits on the pencil line.',
            'Pare a dado wall if one binds; never pull an end on with the clamps.',
            'With both ends home, the hull diagonals (rear corners to the opposite bow corners) are equal within 1/8".',
            'Rehearse the closing with the clamps and cauls in place (transom first, bulkhead on a second batch), then take both ends off.',
          ], ['transom-rear', 'bow-bulkhead']),
        ],
        checks: ['Both templates went on by hand and lay flat on every band end', 'Both ends home by hand, dry, the bulkhead on its line', 'Deck enters its dados (feeler gauge)'],
      };
    },
  },
  {
    id: 'transom',
    title: 'Close the rear: transom with its backers',
    kind: 'build',
    steps: [HULL_STEP.transom],
    match: /^transom-/,
    view: 'iso',
    why: 'The transom closes the rear of the hull and squares the box: the deck, the webs and the rails all lock into it. The two oak backers behind it carry the push-handle sockets.',
    tools: ['pipe clamps (2)', 'cauls', 'epoxy pumps', 'router', 'drill'],
    hardener: '556',
    build: (c) => {
      const std = isStandard(c.p);
      const backers = c.mine.filter((x) => /backer/.test(x.id)).map((x) => x.id);
      const bands = count(c, 'glue');
      const sockHoles = feat(c, 'handle-socket-L', 'hole', (q) => (q.to ?? []).includes('transom-rear') && !/access hole/i.test(q.text));
      const sockAt = stations(sockHoles, 'BOTTOM end');
      const sockEdge = sockHoles ? new RegExp(`(${FR})" from the outboard edge`).exec((sockHoles.positions ?? []).join('; '))?.[1] : undefined;
      const place = socketOnTransom(c.parts);
      const tnuts = feat(c, 'transom-backer-L', 'hole', (q) => /T-nut/i.test(q.purpose ?? q.text));
      const vents = transomVents(c.parts);
      const nVent = vents.places.length * 2;
      // Where each backer sits on the transom's inside face (from the two parts), and the rail-end loose tenons (from the rail's joint: both parts mortised).
      const tr = c.by('transom-rear'), bk = c.by('transom-backer-L');
      const tb = tr ? worldAABB(tr) : undefined, bb = bk ? worldAABB(bk) : undefined;
      const backerAt = tb && bb ? `Each backer: its outer edge ${fin(tb.max[1] - bb.max[1])} in from the transom's side edge, its bottom end ${fin(bb.min[2] - tb.min[2])} up from the transom's bottom edge.` : false;
      const tj = c.by('rail-L')?.joints?.find((j) => j.type === 'mortise-tenon' && j.to === 'transom-rear');
      const tm = tj ? new RegExp(`^(${FR}) × (${FR}) × (${FR}) deep`).exec(tj.size ?? '') : null;
      const nTenon = c.parts.filter((x) => /^rail-[LR]$/.test(x.id)).length;
      const tbGlue = std ? 'Titebond III' : 'epoxy';
      // The deck and web ends stand past the rail ends at the bow (the bulkhead dado depth): the bow caul bears on blocks twice that thick on the rail ends.
      const web = c.by('side-L-web'), band = c.by('side-L-chine');
      const standOut = web && band ? worldAABB(band).min[0] - worldAABB(web).min[0] : c.p.deckCaptureDepthIn;
      const sockClr = sockHoles ? new RegExp(`^(${FR})" clearance`).exec(sockHoles.size ?? '')?.[1] : undefined;
      const barrel = tnuts ? new RegExp(`^(${FR})"`).exec(tnuts.size ?? '')?.[1] : undefined;
      return {
        goal: 'Close the rear of the hull: backers on the transom, then the transom onto the hull in one glue-up.',
        items: [
          I('Bench, the day before: clamp each backer in place dry on the inside of the {{transom-rear}}, then drill the handle-socket holes through transom and backer together.', [
            I(`Cut the backers to their cut-list size first: ${tl(backers)}. They carry the handle sockets' screws, not built work, so they need no check.`, [], backers),
            backerAt,
            place ? `Both sockets: centered ${fin(place.off)} either side of the centerline (the outer edge ${fin(place.inset)} in from the transom's side edge), the bottom end ${fin(place.up)} up from the transom's bottom edge.` : false,
            fileCutHole(c, 'transom-rear', (q) => /^handle-socket-/.test(q.to ?? ''))
              ? `The transom's socket screw holes came with it (its Shaper file): hold a socket there to check they line up with its holes, then drill on through the backer from the transom's holes${sockClr ? `, ${sockClr}" clearance` : ''}, using them as the guide. Do not drill the transom again.`
              : `Hold a socket there and drill through its screw holes${sockClr ? `: ${sockClr}" clearance through transom and backer together` : ''}.`,
            barrel ? `Then open each backer hole to ${barrel}" from the backer's inside face, for the T-nut barrel.` : false,
            sockAt.length ? `On the socket the holes are ${list(sockAt)} up from its bottom end${sockEdge ? `, ${sockEdge}" from its outboard edge` : ''}.` : false,
            'Unclamp, set the T-nuts (next), then glue.',
          ]),
          I('Set a captive 1/4-20 T-nut per socket screw in each backer, from its inside face, before the backer is glued.', [
            tnuts?.positions?.length ? `T-nut barrel holes in each backer: ${(holeText(tnuts) ?? '').replace(/, in the rear face: /, `${/\bthrough\b/.test(tnuts.size ?? '') ? ', through the backer,' : ','} drilled from its inside face (the face toward the bow): `)}.` : false,
            'The socket screws then drive in from outside: no wrench ever has to reach behind the storage box.',
          ]),
          ...(vents.places.length
            ? [I(`Drill the ${nVent} vent holes (${fin(vents.dia)}) through the {{transom-rear}}, into the dados.`, [
              ...vents.places.map((v) => `One each side, ${near16(v.off)} off the centerline and ${near16(v.up)} up from the transom's bottom edge.`),
              'The Shaper file marks them; they let air and glue out as the transom is pushed on.',
            ])]
            : []),
          I(`Glue the backers (3/4" oak) full-face to the inside of the transom with ${tbGlue}, at their dry-fit places: ${tl(backers)}.`, ['Clamp them with a caul and leave them overnight.']),
          ...(tm ? [I(`Glue the ${plural(nTenon, 'loose tenon')} made at [[step:ends]] into the rails' rear ends first (thickened epoxy), half of each standing out.`)] : []),
          I('Close ONE end first: the transom.', [
            'The transom is pushed straight on: the deck edge, the web ends and the rail tenons all enter at once. The four band ends of each side butt against its face (no Dominos).',
            `${plural(bands, 'glue joint')} and ${plural(count(c, 'mortise-tenon'), 'mortise-and-tenon')} in one glue-up.`,
            `Two pipe clamps along the length, from a caul across the transom to a caul across the bow, bearing on a ${fin(2 * standOut)} block on each rail end so it clears the deck and web ends that stand ${fin(standOut)} out (the bulkhead is not on yet).`,
          ]),
          I('Rehearse twice, then glue in small batches.', [
            'Thickened epoxy in every joint of this glue-up: the dados, the tenons and the band ends (one glue for one glue-up).',
            `Epoxy (glue card), mixed in SMALL batches in a wide shallow container: the pot life is ${EPOXY_SYSTEM.potMin[0]}-${EPOXY_SYSTEM.potMin[1]} min, so do the fillets and the dado fills in the sequence you rehearsed, one batch at a time. You can do it alone.`,
            ...(vents.places.length ? ['Glue shows at the vent holes when the dados are full: fill them flush with thickened epoxy after the cure.'] : []),
            'Once the transom is home, fillet the inside corners with thickened epoxy.',
          ]),
        ],
        checks: ['Transom square to the deck and plumb', ...(vents.places.length ? ['Vent holes show a bead of glue (dados filled)'] : []), 'Webs fully home in the dados: no gap at the transom face', 'T-nuts clear of glue (run a screw in dry)'],
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
    why: 'The bulkhead closes the bow. Its rear face is the rider\'s foot brace, and the hand-hold through it is where the nose of the sled is lifted.',
    tools: ['pipe clamps (2)', 'cauls', 'epoxy pumps'],
    hardener: '556',
    build: (c) => {
      const dj = c.by('rail-L')?.joints?.find((j) => j.type === 'domino' && j.to === 'bow-bulkhead');
      return {
        goal: 'Close the bow with the bulkhead, the rider\'s foot brace.',
        items: [
          I(`The {{bow-bulkhead}} went home dry at [[step:ends]], on the ${dj ? `${dominoKey(dj)} ` : ''}Dominos in the rail ends: it goes on the same way now, pushed straight back onto the bow end by hand until its rear face sits on the pencil line from the dry fit.`, [
            'Its dados (open at the edge) take the web ends; the deck dado, run into them, takes the deck edge.',
            `${dj ? `${dominoKey(dj)} Dominos` : 'Dominos'} join it to the rail ends: at the glue-up, glue them into the rail-end mortises first, so the bulkhead pushes onto them. The four band ends of each side butt against its rear face.`,
            'It must go fully home by hand. Pare a dado wall if it binds; do not pull it on with the clamps.',
          ]),
          I('Rehearse once with the clamps, then glue it once the transom glue has gelled (epoxy hard to a fingernail).', [
            'Take the transom clamps off (its epoxy has gelled); the bulkhead clamps, transom caul to bulkhead caul, hold both ends now.',
            'A second, fresh small batch of thickened epoxy: in the dados, on the Dominos and on the band ends (one glue for one glue-up).',
            'Wide shallow container; you can mix and place it alone.',
            'Push it straight back onto the bow end. Two pipe clamps along the length, from a caul across the bulkhead to the caul across the transom.',
            'Once it is clamped home, fillet the inside corners with thickened epoxy.',
          ]),
          I('Keep glue out of the lift hand-hold: the headlamp clips on there later.'),
        ],
        checks: ['Bulkhead square, its rear face on the pencil line from the dry fit on both sides', 'Web and deck seated in their dados, no gaps'],
      };
    },
  },

  // ---------------- 4.5-4.6: running gear (hull still inverted) ----------------
  {
    id: 'rear-beam',
    title: 'Rear beam on for good, with its axle and clamp plates',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^(beam-R|beam-hold-down-[LR]|axle-R[LR]?|clamp-R[LR]\d)$/,
    view: 'under',
    why: 'The rear axle beam carries the rear wheels. The steel axle lies in a groove along the beam, held by a clamp plate at each end, and two steel angles bolted to the hangers hold the beam up in the hanger notches and pin the axle in its groove. This end of the running gear goes on for good now.',
    tools: ['drill press', 'V-block', 'router (groove)', 'wrenches'],
    build: (c) => {
      const groove = feat(c, 'beam-R', 'groove');
      // The hold-down angle's bolts, from the part's own joints (the upright leg to the hanger and rail, the flat leg to the beam): count, diameter and length as the model lists them.
      const hd = c.by('beam-hold-down-L');
      const boltOf = (to: RegExp): { n: string; dia: string; len: string } | undefined => {
        const j = hd?.joints?.find((q) => q.type === 'bolt' && to.test(q.to));
        const m = /× ([\d\-/]+) /.exec(j?.size ?? '');
        return j && m ? { n: numWord(j.count), dia: fin(j.diaIn ?? 0), len: `${m[1]}"` } : undefined;
      };
      const upBolt = boltOf(/^axle-hanger/), flatBolt = boltOf(/^beam-/);
      const axleId = c.by('axle-R') ? 'axle-R' : 'axle-RL';
      const cotter = featsAll(c, axleId, 'hole', (q) => (q.to ?? []).some((t) => /^wheel-/.test(t)));
      const plateHoles = featsAll(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const holdHoles = featsAll(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t)));
      const plates = c.parts.filter((x) => /^clamp-R/.test(x.id)).map((x) => x.id);
      const allPlates = c.parts.filter((x) => /^clamp-/.test(x.id)).length;
      const plateRow = c.cut().metal.find((q) => q.ids.some((i) => /^clamp-/.test(i)));
      const plateHole = feat(c, 'clamp-RL1', 'hole');
      const plateBoltJ = c.by('clamp-RL1')?.joints?.find((q) => q.type === 'bolt');
      const plateBolt = /× ([\d\-/]+) /.exec(plateBoltJ?.size ?? '')?.[1];
      const hdUp = feat(c, 'beam-hold-down-L', 'hole', (q) => (q.to ?? []).some((t) => /^axle-hanger/.test(t)));
      const hdFlat = feat(c, 'beam-hold-down-L', 'hole', (q) => (q.to ?? []).some((t) => /^beam-/.test(t)));
      const seat = beamSeat(c.p, computeLayout(c.p));
      const toDeck = seat ? near8(computeLayout(c.p).deckBot - (seat.hd.zBeam + seat.hd.t)) : undefined;
      // how far in under the beam the flat-leg nuts sit, reached from the bay ahead of it (the bay behind is too narrow): its front face to each nut
      const bF = c.by('beam-R') ? worldAABB(c.by('beam-R')!).max[0] : undefined;
      const nutsIn = seat && bF !== undefined ? seat.hd.beamBolts.map(([x]) => bF - x).sort((u, v) => u - v).map((d) => near8(d).replace(/"$/, '')).join(' and ') + '"' : undefined;
      const aw = axleWord(c.p);
      return {
        goal: 'Bolt the rear beam on for good, with its axle and clamp plates.',
        items: [
          I(`Cut the axle groove in the top face of the {{beam-R}} (the face that goes against the hull; it faces down while the hull is upside down).`, [
            I('First cut the {{beam-R}} to its cut-list length, square at both ends: it is sized to the axle and the track, not to built work, so it needs no check.'),
            `${fin(c.p.axleDiameterIn)} wide × ${fin(axleGrooveDepthIn(c.p))} deep, so the ${fin(c.p.axleDiameterIn)} ${aw} stands ${fin(c.p.axleProudIn)} proud and the clamp plates bear on the ${aw}.`,
            whereOf(groove) ? `${cap(whereOf(groove)!)}.` : SEE_ITEM,
          ]),
          ...(plateRow ? [I(`Cut the clamp plates: ${plural(allPlates, 'plate')} in all (2 here, 4 on the front beam), all identical.`, [
            `Each is ${fin(plateRow.cutLengthIn)} of ${plateRow.section}, cut on the metal bandsaw and deburred on every edge.`,
            plateHole ? `Drill each plate loose on the drill press from its layout: ${holeText(plateHole)} (2 holes, centered across the width, ${fin(c.p.clampPlateLengthIn / 2 - (c.p.axleDiameterIn / 2 + c.p.clampLegGapIn))} in from each cut end).` : `Drill each plate loose on the drill press: ${SEE}.`,
            'Drill stainless as in [[step:frame]]: center-punched, a cobalt bit, slow, steady pressure and cutting oil.',
          ], plates)] : []),
          I('Drill the beam.', [
            holesText(plateHoles) ? `Clamp-plate bolts, both ends: ${holesText(plateHoles)}.` : `Clamp-plate bolts: ${SEE}.`,
            holesText(holdHoles) ? `Hold-down bolts, both ends: ${holesText(holdHoles)}.` : `Hold-down bolts: ${SEE}.`,
            'Lay a drilled plate over each pair of plate holes: the bolts must drop straight through.',
          ]),
          I('Drill the two hold-down angles on the drill press from their layout ({{beam-hold-down-L}} and {{beam-hold-down-R}}): they come undrilled.', [
            hdUp ? `Upright leg: ${holeText(hdUp)}.` : `Upright leg: ${SEE}.`,
            hdFlat ? `Flat leg: ${holeText(hdFlat)}.` : `Flat leg: ${SEE}.`,
            'Stainless again, drilled as in [[step:frame]]. Make the two angles mirror images.',
          ]),
          I(`Drill the cotter cross holes in the {{${axleId}}} (${axleWhat(c.p)}) on the drill press, the ${aw} held in a V-block${cotterText(cotter, c.by(axleId)?.stock?.l, 'LEFT end') ? `: ${cotterText(cotter, c.by(axleId)?.stock?.l, 'LEFT end')}` : `, ${fin(c.p.axleCrossHoleDiaIn)} near each end`}.`),
          I(`Seal the beam now, before anything goes on it, as in [[step:seal]]: the groove, the bolt holes and the end grain are covered for good from here.`),
          I('On the bench, grooved face up: lay the axle in the groove, its ends equal, and bolt a clamp plate over it at each end.', [
            plateBolt ? `Two ${fin(plateBoltJ?.diaIn ?? 0)} × ${plateBolt}" bolts a plate: heads on the plate, fender washers and nylock nuts on the beam's bottom face. Snug only.` : 'Two bolts a plate: heads on the plate, fender washers and nylock nuts on the beam\'s bottom face. Snug only.',
            `Each plate must bear on the ${aw}, not the beam, and must not rock: tape shims on the plate ends if it does.`,
          ], [axleId, ...plates]),
          I('On the hull (still upside down), bolt each hold-down angle to its hanger: the upright leg on the hanger\'s inside face, the flat leg pointing in toward the middle.', [
            upBolt
              ? `${upBolt.n} ${upBolt.dia} × ${upBolt.len} bolts through each angle's upright leg, the hanger and the rail, in the holes drilled at [[step:hangers]]; nylock nut and fender washer on the rail's outside face. Snug.`
              : 'The bolts through each angle\'s upright leg, the hanger and the rail: see the joint list. Nylock nut and fender washer on the rail\'s outside face. Snug.',
          ], ['beam-hold-down-L', 'beam-hold-down-R']),
          I('Turn the beam over, grooved face down, and lower it into the notches of both hangers and rails: the axle comes down on both flat legs.', [
            'The clamp plates go into the deeper rail notches; the beam\'s top face bears on the hanger notch ceilings either side of their small relief, which clears the axle.',
            flatBolt
              ? `${flatBolt.n} ${flatBolt.dia} × ${flatBolt.len} bolts up through the beam and each flat leg (down through them as the hull lies now): put them in from the beam's face that is up, head and fender washer on the beam, nylock nut on the flat leg underneath${toDeck ? `. There is only about ${toDeck} from the flat leg to the deck: reach in from the bay ahead of the beam${nutsIn ? `, about ${nutsIn} in under it` : ''}, with a short ${wrenchFor(seat?.hd.boltD ?? 0.25)}" wrench` : ''}.`
              : `The bolts through the beam and each flat leg, either side of the ${aw}: see the joint list.`,
            'Check the beam is square to the rails (diagonals from the transom corners), then take every bolt on the beam to snug plus a quarter turn.',
          ], ['beam-R']),
          I(`The beam, the angles, the ${aw} and its plates stay on from here, through the finish: mask the ${aw} ends, the plates, the angles and every bolt head and nut when you finish the underside.`),
        ],
        checks: [`${cap(aw)} centered: equal length out each side`, `Plates bear on the ${aw} and do not rock`, 'Beam square to the rails (diagonals from the transom corners)', 'Every nylock on: snug plus a quarter turn'],
      };
    },
  },
  {
    id: 'front-beam',
    title: 'Front beam: stub axles on the bench, then hang it on the kingpin',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^(beam-F|king-thrust|kingpin)$/,
    view: 'under',
    why: 'The front axle beam carries the front wheels and steers: it swings on one bolt, the kingpin, under the king beam, turned by the pulling tongue bolted to it later. Two check chains to a crossmember stop it at full lock, and two plastic pads under the rails stop it tipping when one wheel rides up.',
    tools: ['drill press', 'V-block', 'wrenches', 'router (grooves)', 'tape / shims'],
    build: (c) => {
      const kp = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).includes('kingpin'));
      const grooves = featuresOf(c, 'beam-F').filter((q) => q.kind === 'groove');
      const grooveLen = grooves[0] ? new RegExp(`(${FR})" long from the`).exec(grooves[0].text)?.[1] : undefined;
      const plate = featsAll(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const pads = featsAll(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^roll-pad/.test(t)));
      const eyes = featsAll(c, 'beam-F', 'hole', (q) => (q.to ?? []).some((t) => /^steer-eye/.test(t)));
      const disc = feat(c, 'king-beam', 'hole', (q) => (q.to ?? []).includes('king-thrust'));
      const cotterF = featsAll(c, 'axle-FL', 'hole', (q) => (q.to ?? []).some((t) => /^wheel-/.test(t)));
      const cbore = /(\S+" wide × \S+" deep) counterbore/.exec(c.by('king-thrust')?.joints?.find((q) => q.type === 'screw')?.size ?? '')?.[1];
      const L = computeLayout(c.p), slot = kingNutSlot(c.p, L), relief = kingHeadRelief(c.p, L);
      const aw = axleWord(c.p);
      const fwd = (c.by('king-thrust')?.joints?.find((q) => q.type === 'screw')?.at ?? []).filter((q) => q[0] > 1e-6);
      const fwdOff = fwd.length ? fin(Math.abs(fwd[0][1])) : undefined;
      const discR = /(\S+)" in from the kingpin axis/.exec(c.by('king-thrust')?.joints?.find((q) => q.type === 'screw')?.size ?? '')?.[1];
      const pinLen = /hex bolt \S+" × ([\d\-/]+) \(stock length\)/.exec(c.by('kingpin')?.sourcing?.vendor ?? '')?.[1];
      const padTop = c.by('roll-pad-L') ? worldAABB(c.by('roll-pad-L')!).max[2] : undefined;
      const padGap = padTop !== undefined ? L.railTop - L.railDepthF - padTop : undefined;
      return {
        goal: 'Fit the stub axles, clamp plates and roll pads to the front beam on the bench, then hang it on its kingpin under the king beam.',
        items: [
          I(`Screw the {{king-thrust}} to the {{king-beam}}'s bottom face (facing up now): a ${fin(c.p.kingThrustOdIn)} disc of ${fin(c.p.kingThrustThickIn)} UHMW plastic with a center hole for the kingpin bolt.`, [
            `Lay out 3 screw holes on the disc, on a circle ${discR ? `${discR}" ` : ''}from its center: one straight aft and two at 120° either side of it, so none lands in the nut slot${fwdOff ? ` (the two forward screws sit ${fwdOff} either side of it)` : ''}.`,
            `Counterbore each from the face the beam turns on${cbore ? `, ${cbore}` : ''}, so a #8 flat head sits below that face, then drill through for the screw.`,
            'Push the kingpin bolt through the disc into the kingpin hole to center it, then drill the pilots into the king beam through the disc\'s holes and screw the disc down.',
            disc ? `Pilots ${holeText(disc)}.` : SEE_ITEM,
          ]),
          I('Cut the {{beam-F}} to its cut-list length, square at both ends, and the {{roll-pad-L}} and {{roll-pad-R}} to their cut-list size.', ['They are sized to the stub axles and the track, not to built work, so they need no check.']),
          I('Drill and groove the {{beam-F}}.', [
            kp ? `Kingpin hole: ${fin(c.p.kingpinDiaIn)}, square on the drill press, ${whereOf(kp)}.` : `Kingpin hole: ${SEE}.`,
            `Stub-axle grooves: ${fin(c.p.axleDiameterIn)} wide × ${fin(axleGrooveDepthIn(c.p))} deep in the top face (the face that goes against the hull; it faces down while the hull is upside down)${grooveLen ? `, ${grooveLen}" long, running in from each end` : ''}${grooves[0] && whereOf(grooves[0]) ? `; ${whereOf(grooves[0])!.replace(/^in the top face: /i, '')}` : ''}, so the ${aw} stands ${fin(c.p.axleProudIn)} proud.`,
            holesText(plate) ? `Clamp-plate bolts, ${plate.length} plates: ${holesText(plate)}.` : false,
            holesText(eyes) ? `Eye-bolt holes, fore-aft, one near each end: ${holesText(eyes)}.` : false,
            `Seal the grooves, the holes and the end grain now, as in [[step:seal]].`,
          ]),
          I('On the bench, grooved face up: fit the stub axles, clamp plates and roll pads (they come off again after the wheel dry fit).', [
            cotterText(cotterF, c.by('axle-FL')?.stock?.l, 'OUTBOARD end') ? `First drill each stub's cotter cross hole on the drill press, the ${aw} in a V-block: ${cotterText(cotterF, c.by('axle-FL')?.stock?.l, 'OUTBOARD end')}.` : false,
            I('Stub axles in their grooves ({{axle-FL}}, {{axle-FR}}), the inner end at the groove end; two clamp plates on each (drilled with the rear ones), bolted as at the rear: heads on the plate, fender washers and nylock nuts on the beam\'s bottom face, snug.'),
            I(`Roll pads ({{roll-pad-L}}, {{roll-pad-R}}): each lies across its groove between the two plates, bearing on the stub (${fin(c.p.axleProudIn)} above the beam face), with a screw either side of the groove${holesText(pads) ? `; pilots, both pads: ${holesText(pads)}` : ''}. If the running gap to the rail checked below comes out too big, raise the pad on tape shims between it and the stub.`),
            'Try each eye bolt in its hole, eye to the rear.',
          ], ['clamp-FL1', 'clamp-FL2', 'clamp-FR1', 'clamp-FR2', 'steer-eye-L', 'steer-eye-R']),
          I(`Hang the beam on the {{kingpin}} as one piece: a ${fin(c.p.kingpinDiaIn)}${pinLen ? ` × ${pinLen}"` : ''} grade 8 bolt, its head and SAE flat washer on the beam's bottom face (facing up now).`, [
            'The bolt goes down through the beam, the disc and the king beam as the hull lies now (up through them on the finished sled).',
            `Slide the thin nylock (jam) nut into the slot in the king beam (${fin(slot.w)} wide × ${fin(slot.h)} tall, open at its front face; no washer): the slot's walls hold it by its flats. Turn the bolt from its head until snug, then back it off a quarter turn so the beam swings freely on the shank.${c.by('kingpin') ? ` To re-adjust it on the finished sled, lay the sled on its side: on its wheels the head is only about ${fin(worldAABB(c.by('kingpin')!).min[2])} off the ground, too little room for a socket.` : ''}`,
            `Swing the beam to full lock both ways: the roll pads pass under the rails with a running gap of 1/32" to 1/8"${padGap !== undefined ? ` (about ${fin(padGap)} as built)` : ''}${relief ? ', and the inner plates\' bolt heads pass under the reliefs in the king beam' : ''}.`,
            'The beam, disc and kingpin stay on for the finish (mask the head and the slot).',
          ]),
          I('Tag the stubs, plates, pads, eye bolts and bolts (front L / R).'),
        ],
        checks: [`Axle swings freely through the full lock (±${f(c.p.steerLockDeg, 0)}°) with no drag`, 'Roll-pad gap 1/32" to 1/8"', relief ? 'The inner clamp-plate bolt heads clear the king beam reliefs by at least 1/8" through the full lock' : 'Clamp plates clear the king beam by 1/8"'],
      };
    },
  },
  {
    id: 'brake-knees',
    title: 'Brake knees (and backers), glued and bolted while the hull is inverted',
    retitle: (p) => (isRemovable(p) ? 'Brake knees, fitted dry while the hull is inverted' : undefined),
    retools: (p) => (isRemovable(p) ? ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps', '3/8" drive ratchet and 9/16" socket'] : undefined),
    reglue: (p) => (isRemovable(p) ? `Epoxy (sealing the bolt holes only): cure ${hRange(HARDENERS['556'].clampHours)} h before the final bolt-up (glue card)` : undefined),
    kind: 'build',
    steps: [STEP.brake],
    at: STEP.gear,
    match: /^brake-(backer|knee)-[LR]$/,
    view: 'under',
    why: 'Each brake knee is an oak bracket on the outside of a rail, just ahead of a rear wheel. The brake flap pivots in the pocket at its top, so stepping on the flap presses its pad onto the tire. The knee is bolted through the rail into an oak backer, with the nuts on a steel plate inside the hull.',
    tools: ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '556',
    build: (c) => {
      const knees = c.mine.filter((x) => /^brake-knee/.test(x.id)).map((x) => x.id);
      const backers = c.mine.filter((x) => /^brake-backer/.test(x.id));
      const framed = c.parts.some((x) => /^brake-backer/.test(x.id) && x.step <= HULL_STEP.deck);
      const bolts = feat(c, 'brake-knee-L', 'hole', (q) => (q.to ?? []).some((t) => /^rail-/.test(t)));
      const corner = feat(c, 'brake-knee-L', 'outline', (q) => q.angleDeg !== undefined);
      const kneeFinal = (c.cut().glueUps.find((q) => q.ids.includes('brake-knee-L'))?.finalText ?? 'its final size (cut list)').replace(/,? T [××] W [××] L\)?$/, '');
      const bgk = brakeOf(c.p), pkv = bgk.pivot, pkn = bgk.knee;
      const kneeTall = pkn.zTop - pkn.zBot, pocketW = pkv.ySlot[1] - pkv.ySlot[0], pocketH = pkv.zPocketTop - pkv.zPocketBot, pocketDeep = pkv.slotEndX - pkn.x0;
      const intoFront = Math.max(0, pkv.slotEndX - pkn.layers[pkn.layers.length - 1].x0);
      const cornerPts = corner ? (corner.positions ?? []).flatMap((t) => [...t.matchAll(new RegExp(`(${FR})" from the outboard edge, (${FR})" from the top end`, 'g'))].map((m) => [m[1], m[2]])) : [];
      const ang = corner?.angleDeg !== undefined ? String(corner.angleDeg) : undefined;
      const rm = isRemovable(c.p); // removable knees: fitted dry, finished on the bench, taken off with a ratchet and wrench
      const sock = wrenchFor(c.p.brakeMountBoltDiaIn);
      // The four knee bolts and where the knee sits on its rail, from the model: count, diameter, length, and the knee's rear face from the rail's rear end.
      const kj = c.by('brake-knee-L')?.joints?.find((q) => q.type === 'bolt' && /^rail-/.test(q.to));
      const boltLen = /x [\d.]+" x ([\d\-/]+)"/.exec(kj?.size ?? '')?.[1];
      const boltTxt = `${bgk.bolts.count} × ${fin(c.p.brakeMountBoltDiaIn)}${boltLen ? ` × ${boltLen}"` : ''}`;
      const railBox = c.by('rail-L') ? worldAABB(c.by('rail-L')!) : undefined;
      const kneeRear = railBox ? fin(pkn.x0 - railBox.min[0]) : undefined;
      // the knee holes in the same order as the backing plate's and the rail's (rear first, then up from the bottom), from the brake layout; the size from the drawing
      const legDia = bolts ? /^Ø[^,]+/.exec(holeText(bolts) ?? '')?.[0] : undefined;
      const legHoles = legDia ? `${legDia}, in the inboard face: ${bgk.bolts.xs.length} columns × ${bgk.bolts.zs.length} rows: ${listS(bgk.bolts.xs.map((x) => fin(x - pkn.x0)))} from the rear face, ${listS(bgk.bolts.zs.map((z) => fin(z - pkn.zBot)))} up from the bottom end (level with the rail's bottom edge, as on the rail)` : undefined;
      // The two crossmembers either side of the knee: the bay the nuts are reached through.
      const joists = c.parts.filter((x) => /^joist-\d+$/.test(x.id)).map((x) => ({ id: x.id, b: worldAABB(x) }));
      const behind = joists.filter((q) => q.b.max[0] <= pkn.x0).sort((a, b) => b.b.max[0] - a.b.max[0])[0];
      const ahead = joists.filter((q) => q.b.min[0] >= pkn.x1).sort((a, b) => a.b.min[0] - b.b.min[0])[0];
      const bay = behind && ahead ? `{{${behind.id}}} and {{${ahead.id}}}` : 'the two crossmembers beside the knee';
      const tongueW = pkv.yTongue[1] - pkv.yTongue[0], tongueH = pkv.zTongueTop - pkv.zTongueBot;
      return {
        goal: rm ? 'Make the brake knees on the bench, then fit them to the rails dry (no glue) for the wheel dry fit, while the hull is upside down.' : 'Make the brake knees on the bench, then glue and bolt them to the rails now, while the hull is upside down.',
        items: [
          I('Before you cut the knees: check where they will stand against a real wheel.', [
            'Slide one wheel onto an end of the rear axle rod (on since [[step:rear-beam]]).',
            kneeRear ? `Mark the knee's rear face on each rail: ${kneeRear} from the rail's finished rear end, square across its outer face.` : false,
            `From the front of the tire to that mark: ${fin(pkn.x0 - (bgk.O[0] + bgk.r))}, within 1/8".`,
            'If the gap is short, re-measure from the finished-end mark first (not the sawn rail end, 1/2" farther back), then check the axle sits down in both notches. If it is still off by more than 1/8", stop before any knee is cut: the bolt holes through the rail and backer are already drilled, so moving the knee means new holes, and the flap template check at the next step decides whether the flap can take the difference instead.',
          ]),
          I('Cut the knee and flap router templates on the laser (Forms section), about 10 minutes.', ['The knee template is used now; the flap template is tried on the knee and the tire at [[step:gear-fit]] and cuts the flaps at [[step:brake-flaps]].']),
          backers.length
            ? I(`Glue the backers (3/4" oak) to the rail inboard face and the deck underside, clear of the axle hanger: ${tl(backers.map((x) => x.id))}.`)
            : framed
              ? I('The backers went in with the frame glue-up and their bolt holes are drilled: only the knees go on here.', [], ['brake-backer-L', 'brake-backer-R'])
              : I('No backers in this model.'),
          I('At the bench: make the knees.', [
            I(`Start from the knee blocks you laminated in [[step:mill]] (cross-laminated, already milled to ${kneeFinal}): ${tl(knees)}.`, [
              'Do not glue anything up here: the layers, the grain directions, the joint position and the pocket notch are in [[step:mill]].',
              'Check each block before you saw: the grain of the rear and front layers runs up the leg, and the center layer runs across the sled.',
            ], knees),
            I('Shape ONE knee first, then the other once it passes the test below.', [
              'Mark the outline with the knee router template (Forms section): tape it to the rear face of the block, bandsaw 1/16" outside the line, then flush-trim with a pattern bit. Turn the template over for the other knee.',
              `The knee is ${fin(kneeTall)} tall, with its top flat; the roof over the pocket is ${fin(c.p.brakeKneeRoofIn)} and the floor under it ${fin(c.p.brakeKneeFloorIn)}.`,
              cornerPts.length >= 2 && ang ? `Corner cut on the outboard edge: it starts ${cornerPts[0][1]}" below the top end, runs in at ${ang}° to ${cornerPts[1][0]}" from the outboard edge at ${cornerPts[1][1]}" down, then straight to the bottom end.` : `Outline: ${SEE}.`,
              `Recess the pocket about ${fractionText(Math.round(intoFront * 16) / 16, 16)}" into the front layer, so it ends ${fin(pocketDeep)} from the rear face: router with a straight bit, or chisel. It is the same ${fin(pocketW)} wide and ${fin(pocketH)} high as the notch, open at the rear face and the outboard edge.`,
              `The ${fin(pkv.dia)} pin hole waits: it is drilled with the stainless strap on and the flap tongue clamped in the pocket (flap step).`,
            ], knees),
            I('Run the one-knee test on the first knee\'s pocket.', [
              `Make a block from an oak offcut, the size of the flap tongue with its pivot block on: ${fin(tongueW)} wide × ${fin(tongueH)} tall. It must slide into the pocket with a little play all round; shape the other knee only when it does.`,
              'The full test, with the real flap and pin, is at [[step:brake-flaps]].',
            ], knees),
          ]),
          ...(rm ? [I('At the bench still: drill each knee leg on the drill press, from its layout.', [
            legHoles ? `Holes in the knee, ${legHoles}.` : SEE_ITEM,
            'Lay the leg flat on the table and drill square to its face, measuring from the named edges.',
          ], knees)] : []),
          ...(rm ? [
            I('On the hull: offer each knee up and check the holes.', [
              `Offer the knee up to the rail with all ${bgk.bolts.count} bolts through it${kneeRear ? `: its rear face ${kneeRear} from the rail's finished rear end and its bottom edge level with the rail's bottom edge (on top while the hull is upside down)` : ''}.`,
              'If a bolt binds, open that knee hole a hair with the drill. Never open the rail\'s holes.',
            ], ['rail-L', 'rail-R']),
            I('Take the knees off and seal the bolt holes.', [
              'Brush epoxy into the bolt holes in the rail, the backer and the knee, with a small brush or a pipe cleaner.',
              'Let it cure, then run the bit through each hole once more so the bolts still slide in.',
            ], knees),
          ] : []),
          I(rm ? `Bolt each knee on, dry: ${boltTxt} bolts, 2 columns × 2 rows, through the knee leg and the rail into the backer.` : `Bolt each knee: ${boltTxt} bolts, 2 columns × 2 rows, through the knee leg and the rail into the backer.`, [
            rm ? 'The knees go on dry, held only by their bolts. They prove the holes and the fit, and come off again after the wheel dry fit to be finished.' : 'The knee legs are glued to bare oak, so they go on now: glue will not bond to varnish.',
            ...(rm ? [] : [legHoles ? `Holes in the knee, ${legHoles}.` : SEE_ITEM, kneeRear ? `The knee's rear face ${kneeRear} from the rail's finished rear end, its bottom edge level with the rail's bottom edge (on top while the hull is upside down).` : (false as const)] as Sub[]),
            `Heads with a ${fin(c.p.brakeMountWasherOdIn)} washer under each on the outer face of the knee leg (no counterbore). The nylock nuts sit on the stainless backing plates under the deck, behind the rail: ${rm ? 'they are easiest to reach now, while the hull is inverted' : 'reachable only while the hull is inverted'}.`,
            rm ? 'Check each plate is bedded flush in its recess and its 4 holes line up before the bolts go in.' : 'Check each plate lies flush in its recess and its 4 holes line up before the bolts go in.',
            `Hold each nut with the wrench from inside the frame: reach down into the bay between ${bay}, open while the hull is upside down. The nuts face in, toward the middle of the sled.`,
            rm ? `No glue on the leg. Turn each bolt with the ratchet and the ${sock}" socket: ${kneeTighten(c.p)}. Go a little at a time, bolt to bolt in turn.` : 'Glue on the leg against the rail and chine outer face; clamp, bolt, wipe the squeeze-out.',
          ], ['rail-L', 'rail-R', ...(behind ? [behind.id] : []), ...(ahead ? [ahead.id] : [])]),
          ...(rm ? [I('Mark each knee to its side with tape (L or R, and which hole each bolt came out of), so it goes back where it came from.')] : [I('Leave the knees 24 h before the wheel dry fit (next step) loads them.')]),
        ],
        checks: rm
          ? ['Knee tops level with each other', 'Each knee seats flat on the rail and the chine band with no gap', 'Every nylock on and tightened to snug plus a quarter turn; the bolt holes sealed']
          : ['Knee tops level with each other', 'Every nylock on and snug; nothing on the knees varnished yet'],
      };
    },
  },
  {
    id: 'gear-fit',
    title: 'Dry-fit the wheels, then take the front running gear off',
    kind: 'process',
    steps: [STEP.gear],
    view: 'under',
    why: 'The wheels go on once, with the hull still upside down, to prove the track, the spin and every clearance before the underside is finished, and the brake flap template is tried on the knee and the tire while both are on.',
    tools: ['wrench', 'cotter-pin pliers', 'tire gauge', 'tape and bags', 'flap template'],
    build: (c) => {
      const wheels = c.parts.filter((x) => /^wheel-/.test(x.id) && x.group !== 'reference');
      // D-94: where the flap must land on the knee and the tire, from the model, for the template check (the flaps are cut later, at the flap step).
      const flapFit = (() => {
        const fl = c.by('brake-flap-L'), sh = c.by('brake-shoe-L'), wh = c.by('wheel-RL');
        if (!fl || !sh || !wh) return undefined;
        const fb = worldAABB(fl), sb = worldAABB(sh), wb = worldAABB(wh), Lg = computeLayout(c.p);
        const axleX = (wb.min[0] + wb.max[0]) / 2, shoeX = (sb.min[0] + sb.max[0]) / 2;
        return { shoeBehind: axleX - shoeX, inset: Math.min(fb.min[1] - wb.min[1], wb.max[1] - fb.max[1]), clear: fb.min[1] - outerHalfWidth(Lg, (fb.min[0] + fb.max[0]) / 2), foot: fb.min[0] - Lg.xRear };
      })();
      return {
        goal: 'Dry-fit the wheels to prove the running gear and try the flap template, then take the front gear, the wheels and the knees off for the finish.',
        items: [
          I('Check the running gear is all on and snug: the rear axle and its plates, the front stub axles, their plates and the roll pads. If anything came off, refit it from its tagged bag.'),
          I(`Put the ${plural(wheels.length, 'wheel')} on the axles.`, [`${fin(c.p.wheelBoreIn)} bore on the ${fin(c.p.axleDiameterIn)} ${axleWord(c.p)}, sealed bearings.`, `Washer and collar against the hub, cotter pin through the cross hole ${fin(c.p.axleCrossHoleFromEndIn)} in from the ${axleWord(c.p)} end.`], wheels.map((x) => x.id)),
          I(`Check the track: ${fin(c.p.frontTrackIn)} front, ${fin(c.p.rearTrackIn)} rear.`, [`Inflate each tire to ${SQUASH_TEST_PSI} psi, the pressure of the tire squash test in [[step:verify]].`]),
          I('Spin each wheel.', ['No rub on the beam end, the clamp plates or the brake knee.', `Re-check the knee-to-tire margin (first checked at [[step:brake-knees]]), wheels on${isRemovable(c.p) ? '' : ' and knees cured'}: about ${fin(brakeOf(c.p).knee.x0 - (brakeOf(c.p).O[0] + brakeOf(c.p).r))} from the front of each rear tire to its knee's rear face.`, `End float: no more than the ${fin(c.p.frontTrackIn / 2 - c.p.hubLengthIn / 2 - computeLayout(c.p).beamF.len / 2)} gap between the hub and the beam end.`]),
          ...(flapFit ? [I('Try the brake flap template on each knee and tire now, while both are on: the flaps are made to it at [[step:brake-flaps]].', [
            'The brake flap router template (Forms section, 1/4" plywood on the laser). Hold it level over the tire at the flap\'s height, its pivot end resting on the floor of the knee\'s pocket and its scored pivot line over the knee\'s pin line.',
            `The midpoint of its two shoe-screw holes sits over the top of the tire: ${fin(flapFit.shoeBehind)} behind the axle's center, within 1/4" (the shoe is fitted to the tire later).`,
            `It runs over the middle of the tread, ${fin(flapFit.inset)} in from each edge of the tire, and its inner edge stands ${fin(flapFit.clear)} clear of the side's outer face.`,
            `Its foot end lies about level with the transom's outer face (${fin(Math.abs(flapFit.foot))} ${flapFit.foot < 0 ? 'behind' : 'ahead of'} it), clear of the handle socket.`,
            'If it misses: check the knee first (the knee-to-tire margin above). If the knee is right and the template still misses, change the flap in the design and cut a new template before any oak is cut.',
          ], ['brake-flap-L', 'brake-flap-R', 'brake-knee-L', 'brake-knee-R'])] : []),
          ...(isRemovable(c.p) ? [I('Take the brake knees off too, now that the margin is measured.', [
            `Hold each nut with the wrench from inside the frame and back the bolts out with the ratchet and the ${wrenchFor(c.p.brakeMountBoltDiaIn)}" socket.`,
            'Thread the bolts, washers and nuts back into each knee, loosely.',
            'Bag each knee for the bench: it is finished with the flap kits and bolted on again at [[step:hang]]. The rail face under it is finished with the underside.',
          ], ['brake-knee-L', 'brake-knee-R'])] : []),
          I('Take the front running gear and the wheels OFF and bag them by side.', [
            `Off and bagged by side: the wheels, the front stub axles, the ${plural(c.parts.filter((x) => /^clamp-F/.test(x.id)).length, 'front clamp plate')}, the roll pads and the eye bolts, with their bolts, washers, collars and cotter pins.`,
            `Staying on: both axle beams, the rear ${axleWord(c.p)} and its ${plural(c.parts.filter((x) => /^clamp-R/.test(x.id)).length, 'plate')}, the hold-down angles, the kingpin bolt and thrust disc${c.parts.some((x) => /^brake-backplate/.test(x.id)) ? ', and the knee backing plates' : ''}. Mask every metal part that stays.`,
            'The underside is finished at [[step:finish-under]]; the gear goes back on after the topcoat ([[step:hang]]).',
          ]),
        ],
        checks: ['All four wheels spin freely and run true', 'Axles square: wheelbase measured on both sides within 1/8"', `Knee clears the tire: about ${fin(brakeOf(c.p).knee.x0 - (brakeOf(c.p).O[0] + brakeOf(c.p).r))} from the front of each rear tire to its knee's rear face`, 'The flap template passed on both knees and tires', 'The kit bagged and tagged'],
      };
    },
  },
  {
    id: 'under-holes',
    title: 'Drill and seal the last holes from below',
    kind: 'process',
    steps: [STEP.gear],
    view: 'under',
    why: 'A few holes go through the deck from below: they are drilled now, while the underside faces up and before it is finished. Each one is found from the underside later (the stop blocks, the rib knees) or drains the box.',
    tools: ['drill', '1/8" × 6" aircraft bit', 'square block (drill guide)', 'small brush or pipe cleaners'],
    hardener: '556',
    coat: true,
    build: (c) => {
      const pilots = stopBlockPilots(c.parts, c.p);
      const drains = drainHoles(c.parts, c.p);
      const boxDrain = drains?.box && drains.box.host === 'deck' ? drains.box : null;
      const boxDrainCut = !!boxDrain && !!fileCutHole(c, boxDrain.host, (q) => q.joint === 'hole' && diaNear(q, boxDrain.diaIn));
      // The rib knees' screw pilots in the hidden crossmember and king beam, from each member's own drawing (a feature per knee).
      const kneePilots = new Map<string, DrawingFeature[]>();
      for (const x of c.parts.filter((q) => /^side-rib-knee-L\d$/.test(q.id))) {
        const to = x.joints?.find((q) => q.type === 'screw')?.to;
        if (to && !kneePilots.has(to)) kneePilots.set(to, featsAll(c, to, 'hole', (q) => (q.to ?? []).some((t) => /^side-rib-knee-/.test(t))));
      }
      const pilotBit = bitOf(kneePilots.values().next().value?.[0], fin(SCREW_PILOT[8]));
      const pilotStack = Math.max(0, ...[...kneePilots.keys()].map((id) => { const m = c.by(id); if (!m) return 0; const b = worldAABB(m); return b.max[2] - b.min[2] + computeLayout(c.p).ply; }));
      return {
        goal: 'Drill the stop-block and rib-knee pilots through the deck from below, and seal the box drain holes, before the underside is finished.',
        items: [
          pilots
            ? I(`Drill the ${plural(pilots.total, 'stop-block screw pilot')} through the deck with the hull still inverted: ${fin(SCREW_PILOT[8])} locating holes, with the 6" aircraft bit, for the screws of the seat stop blocks.`, [
              `They are opened to ${fin(SCREW_CLEAR[8])} clearance in the deck and countersunk on the underside for the ${pilots.screw}" flat-heads at [[step:seat-blocks]]: ${pilots.perBlock} a block, one behind the other along the sled.`,
              `From the transom's outer face: ${list(pilots.xs)} forward, ${list(pilots.offCenter)} either side of the centerline.`,
              shaperFeaturesOf(c, 'deck').some((q) => q.kind === 'drill' && /^seat-wedge-/.test(q.to ?? '')) ? 'The deck\'s Shaper file marked these on the deck\'s top face: each bit should break out on its mark, within 1/16". If one does not, go by these measurements and drill no second hole.' : false,
              'The blocks are screwed on from below later, with the sled on its side.',
            ], ['seat-wedge-L', 'seat-wedge-R'])
            : I('No seat stop-block screws in this model.'),
          ...(kneePilots.size
            ? [I('Drill the rib-knee screw pilots now, straight through the crossmember and the deck, while the underside is in view.', [
              'Left end means the sled\'s left side, though the hull is upside down.',
              ...[...kneePilots].map(([id, fs]) => I(`On {{${id}}}: ${fs.map((q) => `${/-R\d$/.test((q.to ?? [])[0] ?? '') ? 'Right' : 'Left'} knee: ${q.positions!.length === 1 && q.count > 1 ? `${numWord(q.count).toLowerCase()} pilots, ${lc(q.positions![0])}` : q.positions!.map((t) => `one ${lc(t)}`).join('; ')}`).join('. ')}.`)),
              `Use a ${pilotBit} × 6" aircraft bit, square to the deck, with a square block clamped on the deck beside each hole as a drill guide: a jobber bit's flutes are too short for about ${near8(pilotStack)} of oak and deck, and the bit would wander.`,
              'These holes are the screw pilots. They show on the deck top, so after the flip they find the hidden crossmember and king beam: the side ribs step sets the mid rib and each knee by them.',
            ])]
            : []),
          ...(boxDrain ? [(fileCutHole(c, boxDrain.host, (q) => q.joint === 'hole' && diaNear(q, boxDrain.diaIn))
            ? I(`Seal the ${boxDrain.count} box drain holes with the hull still inverted. They came with the deck (its Shaper file): do not drill them again.`, [
              `Check they are where the storage box's rear corners will be ([[step:storage-box]]): ${list(boxDrain.xs)} forward of the transom's outer face, ${list(boxDrain.offCenter)} either side of the centerline.`,
              'Tape the top-face mouth, brush epoxy up each bore with a small brush or a pipe cleaner (epoxy on the walls, not a plug), and let it cure.',
              `Run a ${fin(boxDrain.diaIn)} bit through again if the epoxy narrowed the hole, so no cut plywood edge is left bare and the hole is open.`,
            ], [boxDrain.host])
            : I(`Drill the ${boxDrain.count} box drain holes through the deck with the hull still inverted: ${fin(boxDrain.diaIn)}, down through the deck from its underside (facing up now).`, [
              `Where the storage box's rear corners will be ([[step:storage-box]]): ${list(boxDrain.xs)} forward of the transom's outer face, ${list(boxDrain.offCenter)} either side of the centerline.`,
              `Drill a 1/8" pilot first, then the ${fin(boxDrain.diaIn)} brad-point bit with a light touch as it breaks through the top face; tear-out on the top face is inside the box and is sanded and filleted later.`,
              'Seal each bore now: tape the top-face mouth, brush epoxy up the bore with a small brush or a pipe cleaner (epoxy on the walls, not a plug), and let it cure.',
              `Run the ${fin(boxDrain.diaIn)} bit through again if the epoxy narrowed the hole, so no cut plywood edge is left bare and the hole is open.`,
            ], [boxDrain.host]))] : []),
        ],
        checks: [`Every${kneePilots.size ? ' rib-knee screw pilot and' : ''} stop-block pilot drilled square${boxDrain ? `; the box drain holes ${boxDrainCut ? 'sealed and open' : 'drilled, sealed and open'}` : ''}`],
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
      const pin = feat(c, 'brake-knee-L', 'hole', (q) => q.joint === 'pin');
      const pinWhere = pin ? `the ${bitOf(pin, '')} blind hole in the ${pin.face ?? 'knee'}, ${lc((pin.positions ?? []).join('; '))}` : undefined;
      return {
        goal: 'Finish everything you can reach from below before the hull is turned over.',
        items: [
          I('Run the finishing schedule (Finishing section) on the underside.', [
            'The deck underside, rails, crossmembers, beams, hangers and king beam.',
            ...(isRemovable(c.p) ? ['The backers, and the rail and chine face where each knee will sit: the knees are off, so finish that patch like the rest of the rail, all the way to the bolt holes.'] : ['The brake knees and their backers.']),
            'The outside of the sides, the transom and the bulkhead.',
          ]),
          I(std ? 'Offcut test first, then sand 120 / 150 and raise the grain once. No stain.' : 'Offcut test first, then sand 120 / 150 and stain the show faces.'),
          std
            ? I('Touch up the epoxy on the deck underside (coated in [[step:seal]]) and the transom and bulkhead edges (coated in [[step:ends]]), give the rest of the oak end grain its one coat, then urethane.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.'])
            : I('Touch up the epoxy seal on the deck underside (done in [[step:seal]]) and the transom and bulkhead edges (done in [[step:ends]]), and seal the rest of the underside (one saturation coat), then varnish.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.']),
          I('Mask every metal part that stays on: the bolt heads and nuts, the kingpin head, the hold-down angles, and the rear axle and its clamp plates.', [isRemovable(c.p) ? 'Keep the knee bolt holes open: run the drill through them if finish runs in. Leave the backing plates bare under the nuts.' : `Brush epoxy into the knee bolt holes. Keep finish off the spot for the pin hole${pinWhere ? ` (${pinWhere})` : ''}: it is drilled later, at [[step:brake-flaps]].`]),
          ...(isStandard(c.p) && drainHoles(c.parts, c.p)?.box?.host === 'deck' ? [I('Keep the drain holes open.', ['Mask the two box drain holes on the underside, or run the bit through them if finish runs in.'])] : []),
          I('Flip only when the last coat is dry enough to handle (3 days).', ['Padded horses; carry the hull by the rails and the bulkhead, never by the sides.']),
          I('The inside, the topside and everything built after the flip are finished later, in the Finish step.'),
        ],
        checks: [std ? 'Offcut test approved before any urethane goes on the sled' : 'Offcut test approved before any stain goes on the sled', 'No bare wood or bare ply edge on the underside', ...(isStandard(c.p) && drainHoles(c.parts, c.p)?.box?.host === 'deck' ? ['The box drain holes are open and their bores sealed'] : []), 'Varnish dry to handle before the flip'],
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
    why: 'The tongue is the steering arm. The pull rope runs through the sleeve near its tip, so a pull to one side swings the front axle beam on its kingpin and steers the front wheels.',
    tools: ['bandsaw', 'block plane or sander', 'router with a 1/4" roundover', 'drill press', '1" Forstner bit', '25/64" × 12" aircraft extension bit', 'hardwood guide block', '2 clamps', 'wrenches', 'files'],
    hardener: '556',
    build: (c) => {
      const boltT = feat(c, 'bridle-tongue', 'hole', (q) => (q.to ?? []).includes('beam-F'));
      const boltB = feat(c, 'beam-F', 'hole', (q) => (q.to ?? []).includes('bridle-tongue'));
      const sleeve = feat(c, 'bridle-tongue', 'hole', (q) => (q.to ?? []).includes('bridle-sleeve'));
      const boltLen = /× ([\d\-\/]+)" bolts/.exec(boltT?.purpose ?? boltB?.purpose ?? '')?.[1];
      const tongueLen = c.by('bridle-tongue')?.stock?.l, sleeveAt = stations(sleeve, 'rear end')[0];
      const tip = tongueLen !== undefined && sleeveAt !== undefined ? fin(tongueLen - sleeveAt).replace(/"$/, '') : undefined; // from the tip (the front end)
      const tg = c.by('bridle-tongue');
      const depth = tg?.stock?.t ?? c.p.tongueDepthIn;
      const stemLen = tongueLen !== undefined ? tongueLen - 2 * c.p.tongueHeadLenIn : undefined;
      const holeFromRear = sleeveAt !== undefined ? fin(sleeveAt) : undefined;
      // Where the head's flat front face ends and its round into the taper starts (from the tongue's own outline), and the bolt-hole depth: head plus beam.
      const fp = tg ? flatPattern(tg) : undefined;
      const flatEnd = fp ? Math.min(...fp.outer.filter(([u, v]) => Math.abs(u - c.p.tongueHeadLenIn) < 1e-3 && Math.abs(v - fp.heightIn / 2) > c.p.tongueWidthIn / 2 + 1e-3).map(([, v]) => Math.abs(v - fp.heightIn / 2))) : undefined;
      const boltDeep = c.p.tongueHeadLenIn + computeLayout(c.p).beamF.thick;
      const sleeveBlock = (c.p.tongueHeadWidthIn - c.p.tongueWidthIn) / 2;
      return {
        goal: 'Shape the tongue, then bolt it to the front beam for good and set the bronze rope sleeve.',
        items: [
          I('Shape the {{bridle-tongue}} from its glued block first, before any bolt hole is drilled.', [
            `Trace the outline from the part drawing onto the block, with the grain running the length of the tongue: a flat T, ${fin(c.p.tongueHeadWidthIn)} wide and ${fin(c.p.tongueHeadLenIn)} long at the rear end (the head), then a ${fin(c.p.tongueHeadLenIn)} taper down to the ${fin(c.p.tongueWidthIn)}-wide stem, which runs${stemLen !== undefined ? ` ${fin(stemLen)}` : ''} to the tip.`,
            `Keep the head's rear face flat and square across its whole width: it bears on the beam. Keep its front face flat and square from each outer corner in to ${flatEnd !== undefined && Number.isFinite(flatEnd) ? `${fin(flatEnd)} from the centerline, where the round into the taper starts` : `${fin(tongueSeatHalfWidth(c.p))} from the centerline`}: the carriage-bolt heads seat there, so do not let the round creep outward.`,
            'Bandsaw the two straight tapers to the stem a hair outside the line, then plane or sand to it.',
            `Round each inside shoulder, where the taper meets the head, with a ${fin(TONGUE_SHOULDER_FILLET_IN)} radius.`,
            `Ease every edge of the stem and the tip, about ${fin(c.p.roundoverIn)}; leave the head's rear and front faces square.`,
          ], ['bridle-tongue']),
          I(`Drill the ${fin(c.p.tongueHoleDiaIn)} sleeve hole across the stem now.`, [
            sleeve ? `${holeFromRear ? `${holeFromRear} from the rear end` : whereOf(sleeve)}${tip ? ` (${tip}" from the tip)` : ''}, through the ${fin(c.p.tongueWidthIn)} width of the stem, centered in the ${fin(depth)} thickness.` : 'Near the tip, through the stem.',
            `Forstner bit on the drill press. Lay the tongue on its side edge, with a ${fin(sleeveBlock)} block under the stem (the head holds the other end up that much), and clamp it square. Drill from one side until the point comes through, finish from the other.`,
          ], ['bridle-tongue']),
          I('Drill the {{bridle-tongue}} T head and the {{beam-F}} together for the two carriage bolts.', [
            'The front beam is on its kingpin under the bow (the hull has been upright since it was turned over). Swing it square to the hull and wedge it there before clamping the head on.',
            `Make a guide: drill a 25/64" hole square through the 3" length of a 1" × 2" × 3" hardwood block on the drill press.`,
            `Clamp the head to the beam's front face, centered side to side and top to bottom. Hold the guide on the head's front face over each mark and drill through the head and the beam in one pass, ${fin(boltDeep)} in all, with a 25/64" × 12" aircraft extension bit.`,
            'The positions in each part are:',
            boltT ? `In the tongue, ${holeText(boltT)}.` : SEE_ITEM,
            boltB ? `In the beam, ${holeText(boltB)}.` : false,
          ]),
          I(`Bolt the tongue on: two 3/8"${boltLen ? ` × ${boltLen}"` : ''} carriage bolts fore-aft through the T head and the whole beam.`, [
            `The front face of the T head is flat and square out past both bolt holes (the taper to the stem starts inside the bolt heads), so each domed carriage-bolt head sits flat on it. The holes run square to that face, ${fin(boltDeep)} through the head and the beam.`,
            'Fit a fender washer and nylock nut on the beam\'s rear face and tighten: the nut draws each bolt\'s square neck into the oak (or pare a 3/8" square at the hole\'s mouth first).',
            'The tongue is not removable: it stays on and is finished in place.',
          ]),
          I('Epoxy the bronze {{bridle-sleeve}} in the hole drilled across the stem.', [
            `Test-fit it first: if the ${fin(c.p.tongueHoleDiaIn)} bore is tight on the sleeve, sand the bore until it slides in with a film of epoxy.`,
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
    title: 'Side ribs and knees',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^side-rib-/,
    view: 'iso',
    why: 'The ribs stiffen the thin sides against a sideways push and carry the tie-down D-rings on their heads. The knees tie the mid ribs and the bow posts down to the frame under the deck.',
    tools: ['bandsaw', 'spring clamps', 'epoxy pumps', 'drill press', 'drill', '3/8" Forstner or brad-point bit', 'straightedge'],
    hardener: '556',
    build: (c) => {
      const p = c.p, L = computeLayout(p);
      const sts = sideRibStations(p, L);
      const eighth = (v: number): string => fin(Math.round(v * 8) / 8);
      const fromTransom = (x: number): string => eighth(x - L.xRear);
      const name: Record<number, string> = { 1: 'Box rib', 2: 'Mid rib', 3: 'Bow post', 4: 'Rear rib' };
      const knees = sts.filter((st) => st.kind === 'knee');
      const ks = kneeScrews(p, L);
      // The filler lengths and width are the cut list's (one source): ribFillers.
      const fillers = ribFillers(c.parts, p);
      const filler = (st: (typeof sts)[number]): number => fillers.find((q) => q.n === st.n)?.lengthIn ?? 0;
      const fillerW = fillers[0]?.widthIn ?? p.sideRibWidthIn;
      // The counterbore of the knee screws: its width from the knee's own cut, its depth at each screw (the knee is a right triangle; each bore leaves the same oak under its head).
      const cbWide = fin(c.by('side-rib-knee-L2')?.joints?.find((j) => j.cut?.kind === 'counterbore')?.cut?.dia ?? c.by(`side-rib-knee-L${knees[0]?.n ?? 2}`)?.joints?.find((j) => j.cut?.kind === 'counterbore')?.cut?.dia ?? 0.375);
      const cbDepths = (st: (typeof sts)[number]): string => {
        const k = c.by(`side-rib-knee-L${st.n}`)?.stock;
        if (!k) return 'see the part drawing';
        return listS(ks.d.map((d) => fin(Math.max(0, k.l * (1 - d / k.w) - KNEE_SCREW_SEAT_IN)))).replace(/ and /, ' and ');
      };
      const ribDims = (st: (typeof sts)[number]): string => {
        const stock = c.by(`side-rib-L${st.n}`)?.stock;
        return stock ? `${fin(p.sideRibHeadLengthIn)} head, ${fin(p.sideRibWidthIn)} shaft, ${fin(stock.l)} tall` : 'see the part drawing';
      };
      const bowStation = sts.find((st) => st.n === 3 && st.kind === 'knee');
      // The bits, from the knee's own drawing (the clearance hole) and the D-ring rib head's drawing; the pilot has no drawing feature (it is the screw's).
      const clearDia = bitOf(feat(c, `side-rib-knee-L${knees[0]?.n ?? 2}`, 'hole', /clearance/), '9/64"');
            // Where each knee's two screws land (the left knee; the right is the mirror image): the middle of the pair along the member, and the member's rear face.
      const screwCx = (n: number): number | undefined => {
        const k = c.by(`side-rib-knee-L${n}`), j = k?.joints?.find((q) => q.type === 'screw' && q.at?.length);
        return k && j?.at ? j.at.reduce((a, q) => a + transformPoint(k.transform, q)[0], 0) / j.at.length : undefined;
      };
      const kneeWhere = (st: (typeof sts)[number]): string => {
        const mem = st.member ? c.by(st.member) : undefined;
        if (!mem) return '';
        const memMid = (worldAABB(mem).min[0] + worldAABB(mem).max[0]) / 2;
        const cx = screwCx(st.n), off = cx === undefined ? 0 : st.x - cx;
        const angled = Math.abs(off) >= 1 / 16;
        const lead = angled
          ? `Its tall leg laps the rib's inboard face, set a little ${off > 0 ? 'aft' : 'forward'}: the deck pilots set it (its two clearance holes sit over them, ${near8(Math.abs(off))} ${off > 0 ? 'aft' : 'forward'} of the rib center). Its foot runs inboard square to the side, so here it angles ${off > 0 ? 'back' : 'forward'}.`
          : 'Each knee is centered on its rib shaft, square to the side, and the two pilots in the deck set it (they must show in the middle of its clearance holes).';
        return `${lead} Its screws land on the centerline of ${/^joist-/.test(st.member ?? '') ? '' : 'the '}{{${st.member}}}, ${fromTransom(memMid)} from the transom.`;
      };
      const short: Record<number, string> = { 1: 'Box ribs', 2: 'Mid ribs', 3: 'Bow posts', 4: 'Rear ribs' };
      const kneeShort: Record<number, string> = { 2: 'Mid-rib knees', 3: 'Bow-post knees' };
      const ribIds = sts.flatMap((st) => [`side-rib-L${st.n}`, `side-rib-R${st.n}`]);
      const kneeIds = knees.flatMap((st) => [`side-rib-knee-L${st.n}`, `side-rib-knee-R${st.n}`]);
      const ribFromPilots = (st: (typeof sts)[number]): string => {
        const cx = screwCx(st.n);
        if (cx === undefined || st.kind !== 'knee') return '';
        const off = st.x - cx;
        return Math.abs(off) < 1 / 16 ? ', in line with the screw pilots in the deck ([[step:under-holes]])' : `, ${near8(Math.abs(off))} ${off > 0 ? 'ahead of' : 'behind'} the pair of screw pilots in the deck ([[step:under-holes]]), measured along the sled`;
      };
      return {
        goal: 'Glue the side ribs and their knees inside the hull, now the deck is in. The D-ring and grab-board holes are the next step.',
        items: [
          ...(bowStation ? [I(`Before the bow posts are cut: sit a booted rider in the bare hull and confirm the bow-post station (${fromTransom(bowStation.x)} from the transom).`, ['His boots and knees must clear it. If they do not, move the station (Verify) before you cut anything.'])] : []),
          I('Bandsaw the ribs and knees from 4/4 offcuts planed to 3/4".', [
            ...sts.map((st) => `${short[st.n]} (L, R)${st.kind === 'box' ? ' (short: they stop above the deck)' : ''}: ${ribDims(st)}.`),
            ...knees.map((st) => {
              const k = c.by(`side-rib-knee-L${st.n}`)?.stock;
              return `${kneeShort[st.n] ?? `${name[st.n]} knees`} (L, R): ${k ? `${fin(k.w)} along the deck, ${fin(k.l)} up the rib` : 'see the part drawing'}, ${fin(p.sideRibWidthIn)} thick.`;
            }),
            'Cut the top of each head to the sheer slope on its drawing. The D-ring holes are drilled in the next step, once the ribs have cured.',
            ...(knees.length ? [I('Drill each rib knee first, on the drill press, while it is loose.', [
              `Screws ${listS(ks.d.map((d) => fin(d)))} from the outboard edge (the edge that goes against the rib), centered across the thickness.`,
              'Stand the knee on its foot on the drill-press table, its tall leg against a fence and clamped to it, so the bit runs square to the foot for both bores.',
              `Counterbore each from the sloped face first, ${cbWide} wide, leaving ${fin(KNEE_SCREW_SEAT_IN)} of oak under the head. Depths from the sloped face: ${listS(knees.map((st) => `${cbDepths(st)} at the ${name[st.n].toLowerCase()}`))}.`,
              `Then the ${clearDia} clearance hole through the knee, square to the foot.`,
            ])] : []),
          ], [...ribIds, ...kneeIds]),
          I('Glue a band-strip filler to the web at each rib, between the inner chine band and the inner gunwale band.', [
            `Each is ${fin(fillerW)} wide, cut from ${((src) => `${src.source} (${src.aside ? `${src.aside}; ` : ''}the same thickness as the bands, grain up)`)(ribFillerSource(c.resaw(), fillers, p))} to fit the gap. Lengths: ${listS(sts.map((st) => `about ${roughFrac(filler(st))} at the ${name[st.n].toLowerCase()}`))}.`,
            `Centered on each rib station, which is measured from the transom's outer face: ${listS([...sts].sort((a, b) => a.x - b.x).map((st) => `${name[st.n].toLowerCase()} ${fromTransom(st.x)}`))}. The same on both sides.`,
            'Epoxy to the web; the filler face must end flush with the band faces (check with a straightedge).',
          ]),
          I('Epoxy each rib to the inner bands and its filler, full face.', [
            ...sts.map((st) => {
              const zFoot = st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop;
              const turn = Math.round((Math.atan(st.dTurn) * 180) / Math.PI);
              return `${short[st.n]} (L, R): shaft centered ${fromTransom(st.x)} from the transom${ribFromPilots(st)}${st.kind === 'box' ? `, its foot ${fin(zFoot - L.deckTop)} above the deck (a box tie is glued beside its lower end later, in the storage box step)` : `, foot on the deck`}${turn >= 2 ? `. Here the side runs about ${turn}° off the sled's centerline, seen from above (the hull narrows toward the bow): set the rib square to the side, not square across the sled` : ''}.`;
            }),
            'Head against the inner gunwale band, its top flush with the gunwale top. A rib that stands on the deck has its foot against the inner chine band; a box or rear rib stops short of the deck, and a box tie is glued beside its lower end later (storage box step). Thickened epoxy takes up any gap.',
            'Hold each pair with a spreader stick across the hull (padded ends, wedged snug). Add a small fillet at the deck.',
            'Wipe the squeeze-out now. The back face is glued, so it takes no finish.',
          ], ribIds),
          ...(knees.length ? [
            I('Dry-place each knee by the screw pilots, then open the deck pilots.', [
              ...knees.map((st) => `${kneeShort[st.n] ?? `${name[st.n]} knees`} (L, R): foot on the deck against the rib's inboard face. ${kneeWhere(st)}`),
              'Mark the knee outline on the deck, then lift the knee off.',
              `Open each pilot in the deck from the deck top to ${clearDia}, with a depth stop at the deck's thickness (${fin(L.ply)}): the pilot guides the bit, and the screw must pull the knee down on the deck. The pilot in the member stays as it is.`,
            ], kneeIds),
            I('Glue each knee to its rib and the deck, then drive the screws.', [
              'Epoxy the tall leg to the inboard face of the rib and the foot to the deck, with a small fillet.',
              `Set the knee back over its holes and drive ${ks.d.length} stainless ${screwText(ks.fit)}" screws down through it, the deck and into the member. They pull the knee down on the deck while the epoxy is wet.`,
              'Wipe the squeeze-out and the dust from the counterbores.',
            ], kneeIds),
          ] : []),
        ],
        checks: ['Each rib square to the side, the head top flush with the gunwale top', 'No gap behind a rib; the filler is flush with the bands', 'Each knee sits flat on the deck, its screws snug and below the oak face', `The storage box still fits: the box side stands ${fin(p.sideRibDepthIn)} from the box rib's inner face`],
      };
    },
  },
  {
    id: 'side-holes',
    title: 'Drill the D-ring holes and fit the grab boards (before the finish)',
    kind: 'process',
    // The grab boards, their caps and strips are bolted on for good here (the nuts cannot be reached once the caps are on), so this step installs them.
    steps: [STEP.seatStorage, STEP.finish],
    match: /^seat-grip-(cap-|backing-)?[LR]$/,
    // D-94: the signs and the grab boards are cut here, to the ribs and the gunwale as built and after the reach check.
    cuts: /^(sign-[LR]|seat-grip-(cap-)?[LR])$/,
    cutAfter: 'side-ribs',
    view: 'side',
    why: 'The grab boards are the rider\'s hand-holds, one each side. The D-rings are cargo tie-downs, one on each rib head. The sign screws into inserts in two of the ribs. Their holes go through the sides now, while every face is still bare.',
    tools: ['drill', 'drill press', 'cobalt bit', 'Shaper Origin', 'hex keys', 'wrenches', 'clamps', 'scrap blocks', 'small brush'],
    hardener: '556',
    glueLine: 'Epoxy: no load on the grab boards until cured',
    build: (c) => {
      const p = c.p, L = computeLayout(p);
      const lashIds = c.parts.filter((x) => /^lash-/.test(x.id)).map((x) => x.id);
      const gripIds = c.parts.filter((x) => /^seat-grip-[LR]$/.test(x.id)).map((x) => x.id);
      const gripBack = c.parts.filter((x) => /^seat-grip-(backing|cap)/.test(x.id)).map((x) => x.id);
      const lashBit = `${fractionText(Math.round((LASH_BOLT_DIA_IN + 1 / 64) * 64) / 64, 64)}"`;
      const gripPlace = c.by('seat-grip-L') ? (() => { const b = worldAABB(c.by('seat-grip-L')!); return { from: near16(b.min[0] - L.xRear), to: near16(b.max[0] - L.xRear) }; })() : undefined;
      // The grab board's and the strip's heights, and the screws, from the model (the strip is centered on the two rows of holes).
      const gripBoard = c.by('seat-grip-L'), gripStrip = c.by('seat-grip-backing-L');
      const gripM = /^(1\/4" × [\d/-]+)"? (.*?cap screws)/.exec(gripBoard?.joints?.find((q) => q.type === 'bolt')?.size ?? '');
      const gripScrew = gripM ? `${gripM[1]}" ${gripM[2]}` : undefined;
      const stripTop = gripStrip?.stock ? (GRIP_BOLT_ROWS_IN[0] + GRIP_BOLT_ROWS_IN[1]) / 2 - gripStrip.stock.w / 2 : undefined;
      // The board's own five holes, when its Shaper file cuts them: the board is then the drill template, and no second hole is drilled in it.
      const boardHole = fileCutHole(c, 'seat-grip-L', (q) => q.joint === 'bolt');
      const gripBit = `${fractionText(nearestTo(p.gripBoltClearIn, 1 / 64), 64)}"`; // one size through the whole stack (board, bands, web, strip)
      const boardBit = boardHole?.diaIn ? `${fractionText(nearestTo(boardHole.diaIn, 1 / 64), 64)}"` : gripBit;
      // The sign's knobs: through the web into threaded inserts in the rear and box ribs, the sign itself the drill template (all from the model's joints).
      const signIds = c.parts.filter((x) => /^sign-[LR]$/.test(x.id)).map((x) => x.id);
      const signL = c.by('sign-L');
      const knobs = (signL?.joints ?? []).filter((j) => j.type === 'knob' && /^side-rib-/.test(j.to));
      const ribIns = c.parts.filter((x) => /^side-rib-L\d$/.test(x.id)).filter((r) => (r.joints ?? []).some((j) => j.type === 'threaded-insert' && /^sign-/.test(j.to)));
      const insJ = ribIns[0]?.joints?.find((j) => j.type === 'threaded-insert' && /^sign-/.test(j.to));
      const signKnob = signL && knobs.length && insJ ? (() => {
        const sb = worldAABB(signL);
        const knobSize = knobs[0].size ?? '';
        const clear = /(\d+\/\d+) clearance hole/.exec(knobSize)?.[1];
        const disc = c.by('sign-standoff-L1');
        const standoff = disc?.stock?.t ?? NaN;
        const insM = /^(#\d+-\d+) × (\d+\/\d+) (.*?threaded insert)/.exec(insJ.size ?? '');
        const insLen = insM ? parseFrac(insM[2]) : 5 / 16;
        const webT = thinSheet(p).thicknessIn;
        // The insert's mouth, from its own joint: how far it sits below the web's outer face (the web's thickness when its top is flush with the web's inside face).
        const rib0 = ribIns[0];
        const mouthY = rib0 && insJ.at?.[0] ? Math.abs(transformPoint(rib0.transform, insJ.at[0])[1]) : undefined;
        const st0 = rib0 ? sideRibStations(p, L).find((q) => rib0.id.endsWith(String(q.n))) : undefined;
        const mouthDown = mouthY !== undefined && st0 ? st0.yIn + L.sideBand + webT - mouthY : webT;
        const ribAt = ribIns.map((r) => { const b = worldAABB(r); return { id: r.id, x: (b.min[0] + b.max[0]) / 2 - L.xRear }; }).sort((a, b) => a.x - b.x);
        return {
          perSign: knobs.reduce((a, j) => a + j.count, 0),
          clear: clear ? `${clear}"` : '7/32"',
          standoff: Number.isFinite(standoff) ? fractionText(Math.ceil(standoff * 64 - 1e-6) / 64, 64) : undefined, // rounded UP: a disc a hair thick keeps the sign off the band
          discDia: disc?.stock?.w,
          insert: insM ? `${insM[1]} × ${insM[2]}" ${insM[3]}` : '#10-32 × 5/16" threaded insert',
          mouthDown,
          bore: Math.ceil((mouthDown + insLen + 1 / 16) * 16 - 1e-9) / 16,
          rear: near16(sb.min[0] - L.xRear), up: near16(sb.min[2] - L.deckTop),
          ribs: ribAt.map((r) => `${fin(Math.round(r.x * 8) / 8)} (${/4$/.test(r.id) ? 'the rear rib' : /1$/.test(r.id) ? 'the box rib' : 'its rib'})`), // to 1/8", as the rib stations are set
          ribIds: c.parts.filter((x) => /^side-rib-[LR]\d$/.test(x.id) && (x.joints ?? []).some((j) => j.type === 'threaded-insert' && /^sign-/.test(j.to))).map((x) => x.id),
        };
      })() : undefined;
      // Where the side starts to turn in under the grab board, and by how much at its front end (the board is flat: its back is planed to the band there).
      // Over the board's lap on the band (its lower edge, below the gunwale top), from its outline.
      const gripTurn = gripBoard && gripBoard.geometry.type === 'extrusion' ? (() => {
        const lap = gripBoard.geometry.outline.map((q) => transformPoint(gripBoard.transform, [q[0], q[1], 0])).filter((q) => q[2] <= sideTopAt(L, q[0]) + 1e-6);
        if (!lap.length) return undefined;
        const x0 = Math.min(...lap.map((q) => q[0])), x1 = Math.max(...lap.map((q) => q[0]));
        const d = L.turnIn(x1) - L.turnIn(x0);
        return d > 1 / 64 ? { d } : undefined;
      })() : undefined;
      const reachPass = 'the gloved hand finds the hole without reaching or folding the arm back, the elbow stays bent, and the knuckles clear the gunwale top and the thigh';
      const ribGap = signKnob && ribIns.length > 1 ? (() => { const xs = ribIns.map((r) => { const b = worldAABB(r); return (b.min[0] + b.max[0]) / 2; }).sort((a, b) => a - b); return xs[xs.length - 1] - xs[0]; })() : undefined;
      return {
        goal: 'Drill the D-ring holes through the sides now, and fit the grab boards for good, while every face is bare.',
        items: [
          I('Before you cut the signs and the grab boards: wait until the ribs and knees have cured (the next day), then measure the ribs and the gunwale as built.', [
            signKnob ? `Rib shaft centers, from the transom's outer face, on both sides: ${listS(signKnob.ribs)} (the stations they were set at), within 1/8".${ribGap !== undefined ? ` The sign's two pairs of knob holes are about ${fin(Math.round(ribGap * 8) / 8)} apart (${fin(ribGap)} on its drawing): the rib spacing. Measure your rib spacing center to center now, before the signs are drilled; if it differs by more than 1/16", lay the two signs out with the hole pairs that far apart instead (mark the centers with a square from the sign's rear end) and drill them on the drill press. After that, slide a sign along the side to its ribs, never move a hole.` : ''}` : false,
            gripIds.length ? `The grab-board reach check (Verify, grab board): tape the cardboard board in place and sit the smallest and the biggest scout on the seat pads laid at the seat's place. It passes when ${reachPass}. If it fails, move the hole in the design (Advanced: ${PARAM_DEFS.grabHoleAheadOfHpointIn.label.toLowerCase()}), re-export the grab board files and try again. Cut nothing for the grab boards until it passes.` : false,
            gripIds.length && gripPlace ? `A straightedge on the inner gunwale band where each board goes, from ${gripPlace.from} to ${gripPlace.to} from the transom's outer face, held on the band at the board's rear end.${gripTurn ? ` The side turns in toward the bow there: the gap under the straightedge at the front end of the board's lap is about ${fin(gripTurn.d)} by design. Measure yours: the back of the board's front end is planed to it.` : ' The band is straight there: a gap over 1/32" means a side sprang in; plane the back of the board to the band.'}` : false,
          ]),
          ...(lashIds.length ? [I(`The ${lashIds.length} D-ring brackets (one per rib head, both sides).`, [
            `Hold each bracket on the inner face of its rib head, centered on the head and on its mid height. Check its two holes first (Verify): they should be ${fin(2 * LASH_HOLE_DX_IN)} apart along the gunwale; if yours differ, drill to the bracket. The bracket is the template.`,
            'Clamp a scrap block on the outside of the side behind the holes, to stop tear-out.',
            `Drill both holes through the bracket, the head, the inner band, the web and the outer band in one pass with a ${lashBit} bit, square to the side.`,
            'Brush epoxy into each hole to seal the plies of the web, let it cure, then run the bit through again so the bolts slide in.',
            'Number each bracket to its rib. They are bolted on after the finish (final fit step).',
          ], lashIds)] : []),
          ...(signKnob ? [I(`Sign knob holes and inserts: ${signKnob.perSign} a side, through the web into the rib behind it, with the sign as the drill template (${tl(signIds)}).`, [
            I('Saw the two signs on the table saw to their cut-list size, the best face up for the saw\'s clean side.', ['Tape them together and drill the four knob holes through both at once on the drill press, from the sign drawing or at the spacing you measured above.'], signIds),
            I(`Then the ${signKnob.perSign * signIds.length} oak standoff discs, one per hole (cut list: sign standoff discs, one strip for all).`, [
              `Plane the strip to the band thickness plus 1/16" (${signKnob.standoff ?? '17/64'}" at the defaults): the gap between the web and the back of the sign, which stands 1/16" proud of the bands. Do not measure it with the sign held flat: its upper front corner lies over the outer gunwale band.`,
              I(`Cut each disc from the strip with a ${fractionText(discStrip(signKnob.perSign * signIds.length, signKnob.discDia ?? 0.75).sawIn, 8)}" hole saw (its plug comes out about ${signKnob.discDia ? fin(signKnob.discDia) : '3/4"'} across), working from both faces. Its 1/4" pilot drill makes the center hole, which clears the #10 knob screw.`, [], c.parts.filter((x) => /^sign-standoff-/.test(x.id)).map((x) => x.id)),
              'Cut two more from the strip\'s end as spacers for the next item.',
            ]),
            `Hold each sign on the outside of its side on the two spacers (one near each end, clear of the hole places), so it stands where the discs will hold it: its rear end ${signKnob.rear} forward of the transom's outer face, its bottom edge ${signKnob.up} above the deck. Tape it there.`,
            'Each pair of holes now lands on a rib shaft: check from the inside before drilling; if a pair is off, slide the sign along the side, never move a hole.',
            `Spot each hole through the sign with a ${signKnob.clear} bit, just into the web, then take the sign off.`,
            `Bore each spot ${fin(INSERT_DRILL_IN)}, square to the side, ${fin(signKnob.bore)} deep from the web's outer face (a stop on the bit): through the web and into the band-strip filler and the rib behind it.`,
            `Brush epoxy into each bore to seal the web's plies, then turn in a ${signKnob.insert} on epoxy with a hex key until its top is ${fin(signKnob.mouthDown)} below the web's outer face${Math.abs(signKnob.mouthDown - thinSheet(p).thicknessIn) < 1 / 64 ? ' (the web\'s thickness: flush with its inside face)' : ''}: its threads are in the oak, never in the plywood.`,
            'Epoxy one disc to the back of each sign over each hole, lined up on a waxed screw through both.',
            'Once the epoxy has cured, run each knob screw in by hand to check it. The signs are finished on the bench and hung at the final fit.',
          ], [...signIds, ...signKnob.ribIds, ...c.parts.filter((x) => /^sign-standoff-/.test(x.id)).map((x) => x.id)])] : []),
          ...(gripIds.length ? [
            I(`Cut the two grab boards and their oak caps on the Shaper from their files: ${tl([...gripIds, ...gripBack.filter((id) => /cap/.test(id))])}. They go on for good now, before the finish.`, [
              gripTurn ? 'Plane the back of each board\'s front end to the band, to the gap you measured: it must lie flat on the band its whole length.' : false,
              gripPlace ? `Each board laps the inner face of the inner gunwale band, from ${gripPlace.from} to ${gripPlace.to} from the transom's outer face (the datum of the rib stations).` : 'Each board laps the inner face of the inner gunwale band at its place on the drawing.',
              gripBoard?.stock ? `Heights: each board is ${fin(gripBoard.stock.w)} tall, its lower ${fin(L.railBand)} lapping the band and the rest standing above the gunwale top.${gripStrip?.stock && stripTop !== undefined ? ` Each strip is ${fin(gripStrip.stock.w)} tall on the outer band, its top ${near16(stripTop)} below the gunwale top, centered on the two rows of holes.` : ''}` : false,
            ], [...gripIds, ...gripBack]),
            I(`Drill the stainless strips on the drill press: the five ${gripBit} holes on the strip drawing, three in an upper row ${fractionText(GRIP_BOLT_ROWS_IN[0], 16)}" below the gunwale top and two in a lower row ${fractionText(GRIP_BOLT_ROWS_IN[1], 16)}" below it, between the upper ones.`, ['Use a cobalt bit and cutting oil, deburr, then wipe off the oil with acetone.'], gripBack.filter((id) => /backing/.test(id))),
            boardHole
              ? I(`Drill the side through each board's own holes: clamp the board in place; its five holes came with it (its Shaper file, ${boardBit}) and they are the template.`, [`Drill dry from the inside through them, the inner band, the web and the outer band with a ${boardBit} bit, square to the side, a scrap block clamped outside against tear-out.`, 'Do not drill the board again. Mark the strip and board to their side.'], gripIds)
              : I(`Drill the side: clamp each board in place and its strip on the outside face as the template.`, [`Drill dry through the strip's holes, the outer band, the web, the inner band and the board with the same ${gripBit} bit, square to the side.`, 'Mark the strip and board to their side.'], gripIds),
            I('Seal: take everything apart and brush epoxy into the holes in the web, onto the back of each board and onto the band face under it.', ['Leave the outer band face bare where the strip and cap will sit, so the glue bites.', `Let the seal coat cure (the board is bolted to a cured face, not glued), then run the ${gripBit} bit through every hole again, so the screws slide in.`], gripIds),
            I('Epoxy each strip to the outer band, its holes over the holes in the side.', ['Push a waxed 1/4" bolt through each hole while it cures, so they pull out.'], gripBack.filter((id) => /backing/.test(id))),
            I(`Bolt each board on: push the ${gripScrew ?? 'screws'} through from the outside and tighten the nylock nuts.`, ['1-1/2" fender washers under the upper three, 7/8" under the lower two. The heads sit on the strip.', 'Nothing can be tightened after the cap is on, so check every nut.'], gripIds),
            I('Glue each oak cap over the strip and the heads.', ['Dry-fit it first: the recesses routed in its back (cap drawing) fit over the heads.', 'Epoxy it to the outer band, clamp it with a caul on its face, and wipe off the squeeze-out. Keep epoxy out of the heads\' hex sockets, so a screw can still be backed out if the cap is ever cut off.', 'No load on a board until the epoxy has cured.'], gripBack.filter((id) => /cap/.test(id))),
          ] : []),
        ],
        checks: ['D-ring holes drilled square, with no tear-out on the outside face', 'Every bracket numbered to its rib', 'Each grab board tight against the band, each cap tight to the band with no gap at its ends'],
      };
    },
  },
  {
    id: 'storage-box',
    title: 'Storage box: walls, coaming, turn-button blocks',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^(storage-(side|end|coaming|turn-block)-|storage-(side|end)-|box-tie-)/,
    // D-94: the walls are sawn here, once the box ribs that flank the box are in.
    cuts: /^storage-(side|end)-/,
    cutAfter: 'side-ribs',
    view: 'iso',
    why: 'Dry storage for gear, and the base that braces the rear and box ribs.',
    tools: ['table saw (45° bevels)', 'tape', 'glass tape', 'epoxy pumps', 'router'],
    hardener: '556',
    build: (c) => {
      const walls = c.mine.filter((x) => /^storage-(side|end)-/.test(x.id)).map((x) => x.id);
      const coam = c.mine.filter((x) => /coaming/.test(x.id)).map((x) => x.id);
      const lb = c.mine.filter((x) => /turn-block/.test(x.id)).map((x) => x.id);
      const drains = drainHoles(c.parts, c.p);
      const dia = drains?.box ? fin(drains.box.diaIn) : fin(c.p.storageDrainDiaIn);
      // Where the box goes, from the model: the aft wall off the transom, the side walls off the box ribs, the outside size; the turn-button blocks from their own bounds.
      const Lb = computeLayout(c.p);
      const sideW = c.by('storage-side-L'), endW = c.by('storage-end-aft');
      const sb = sideW ? worldAABB(sideW) : null, eb = endW ? worldAABB(endW) : null;
      const ribIn = sideRibStations(c.p, Lb).find((st) => st.kind === 'box');
      const where = sb && eb ? `Where it goes: the aft wall ${fin(eb.min[0] - Lb.xRear)} forward of the transom's outer face, each side wall ${fin(ribIn ? ribIn.yIn - c.p.sideRibDepthIn - sb.max[1] : 0)} inboard of the box ribs' inner faces, centered on the sled. Outside it is ${fin(sb.max[0] - sb.min[0])} long, ${fin(2 * sb.max[1])} wide and ${fin(sb.max[2] - sb.min[2])} tall (the coaming adds ${fin(c.p.storageCoamingThickIn)}).` : false;
      const lbB = c.by('storage-turn-block-L') ? worldAABB(c.by('storage-turn-block-L')!) : null;
      const coamS = c.by('storage-coaming-side-L') ? worldAABB(c.by('storage-coaming-side-L')!) : null;
      const coamTop = c.by('storage-coaming-side-L') ? worldAABB(c.by('storage-coaming-side-L')!).max[2] : 0;
      return {
        goal: 'Build the storage box on the deck: walls, coaming and the turn-button blocks.',
        items: [
          ...(sb && eb ? [I('Before you cut the walls: measure the hull where the box goes.', [
            ribIn ? `Across the hull between the box ribs' inner faces, and between the rear ribs': ${fin(2 * (ribIn.yIn - c.p.sideRibDepthIn))} by design. The box is ${fin(2 * sb.max[1])} wide outside, so each lane is ${fin(ribIn.yIn - c.p.sideRibDepthIn - sb.max[1])}: the box ties are planed to the lane you get.` : false,
            ribIn ? `A lane under 1/2" or over 1" means a rib or a side is off: find out why before the walls are cut.` : false,
            `From the transom's outer face to where the aft wall goes: ${fin(eb.min[0] - Lb.xRear)} (the transom${c.by('transom-rear') ? `, ${thick(c.by('transom-rear')!.stock?.t ?? 0.5)},` : ''} then the lane the turn-button blocks fill), within 1/16".`,
          ])] : []),
          ...(walls.length ? [I(`Saw the four walls on the table saw to their cut-list size: ${tl(walls)}.`, ['Rip and crosscut each, the best face up for the saw\'s clean side. The corner bevels come next.'], walls)] : []),
          // A drain through the deck was drilled and sealed with the hull inverted (the dry-fit step); only a raised box's own floor panel is drilled here.
          ...(drains?.box && drains.box.host !== 'deck' ? [I(`Before the walls go on, drill the ${drains.box.count} box drain holes through the floor panel of the box: ${dia}, straight down.`, [
            `At the aft corners of the box: ${list(drains.box.xs)} forward of the transom's outer face, ${list(drains.box.offCenter)} either side of the centerline.`,
            'Use a sharp brad-point bit and a light touch as it breaks through the underside.',
            'Brush epoxy into each bore, so no cut plywood edge is bare. Run the bit through again once it cures if it narrowed the hole.',
          ], [drains.box.host])] : []),
          I('Bevel the wall edges at 45° on the table saw: the two short (upright) edges of every wall, the bevel on the inside face, so the outside faces meet at a sharp corner.', [
            'Lay the four walls in a row in sequence round the box (side, end, side, end), outside face up, their outer corners touching, and tape each seam.',
            'Turn the row over, brush thickened epoxy into each V, and fold the walls up; tape the last corner.',
          ], walls),
          I('Stand the box on the sealed deck at its place: the deck is the floor.', [
            where,
            'Square the box on the deck with a framing square before the epoxy in the corners sets.',
            isStandard(c.p) ? `Fair the floor inside the box now, before the fillets: epoxy thickened with ${EPOXY_SYSTEM.thickener} (or ${EPOXY_SYSTEM.colorMatch}, which sands easier).` : 'Fair the floor inside the box now, before the fillets: microballoon-thickened epoxy (the low-density filler in the parts list).',
            drains?.box ? `Fall about 1/8" toward each aft drain hole (sealed in [[step:under-holes]]${drains.box.xs.length ? `, ${list(drains.box.xs)} forward of the transom's outer face, ${list(drains.box.offCenter)} either side of the centerline` : ''}); keep the holes open.` : 'Fall about 1/8" toward each aft drain; the drain nipples go in at the final fit.',
            'Then fillet, with the box standing: a 3/8" epoxy fillet and 2" glass tape in each inside corner (no spline), a fillet along the floor inside and a bead outside, so no ply edge is exposed.',
          ]),
          ...(c.mine.some((x) => /^box-tie-/.test(x.id)) ? [(() => {
            const L2 = computeLayout(c.p), st = sideRibStations(c.p, L2)[0];
            const g = boxTieGeometry(c.p, L2, st);
            const ties = c.mine.filter((x) => /^box-tie-/.test(x.id)).map((x) => x.id);
            return I(`Epoxy a box tie between each box or rear rib and the box side: ${tl(ties)}.`, [
              `Each tie is centered on its rib: the box ribs ${fin(c.p.sideRibBoxInsetIn)} behind the front end of the box, the rear ribs ${fin(c.p.sideRibRearInsetIn)} ahead of its aft end. ${fin(g.z0 - L2.deckTop)} to ${fin(g.z1 - L2.deckTop)} above the deck, grain up.`,
              I('Bandsaw each tie from a 3/4" offcut and plane it about 1/32" thinner than its gap as built, then tap it in from above on thickened epoxy, on both faces: to the box side and to the rib.', [], ties),
              `Stand each tie on a spacer block ${fin(g.z0 - L2.deckTop)} tall on the deck while the epoxy cures.`,
              'Its top stands 1/8" below the top of the plywood wall, clear of the coaming.',
            ]);
          })()] : []),
          I('Glue the oak coaming to the wall tops with thickened epoxy, butt corners; brush epoxy on the plywood edges first so they are sealed.', [
            I('Cut the coaming pieces to the box as built: the side pieces to its outside length, the end pieces to fit between them.', [], coam),
            sb && coamS ? `Its outside face flush with the wall's outside face, overhanging about ${fin(sb.min[1] - coamS.min[1])} inside: the ledge the gasket and the lid frame sit on.` : false,
            'Clamp it with cauls.', 'Round the inboard top edge 1/8".', 'The gasket and lid sit on oak, never on a ply edge.'], coam),
          ...(lb.length ? [I(`Glue the turn-button blocks to the inside face of the transom with thickened epoxy, grain across the sled (the pivot screw then bites side grain): ${tl(lb)}.`, [I('Cut each to fill the lane between the transom and the aft wall as built.', [], lb), lbB ? `Each fills the ${fin(lbB.max[0] - lbB.min[0])} lane between the transom and the box's aft wall, centered ${fin((lbB.min[1] + lbB.max[1]) / 2)} either side of the centerline, ${fin(lbB.max[2] - lbB.min[2])} tall, its top ${fin(lbB.max[2] - coamTop)} above the coaming top: level with the lid top, so the turn-button pivots on it (final fit).` : false])] : []),
        ],
        checks: ['Box square, fillets continuous', 'Coaming flat across all four walls (gasket seat)', drains?.box ? 'Drain holes open, floor falls toward them' : 'Drain falls toward the corners'],
      };
    },
  },
  {
    id: 'storage-lid',
    title: 'Storage lid: fixed strip, frame, panel and battens',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^storage-(lid|rim|strip)/,
    // D-94: the strip, the lid frame and its panel are cut to the box as built.
    cuts: /^storage-lid$/,
    cutAfter: 'storage-box',
    view: 'iso',
    tools: ['table saw (the strip groove)', 'router (mortises, rabbet)', 'laser (the lettering)', 'masking tape', 'sanding block', 'epoxy pumps', 'clamps', 'drill', '1/8" spacer'],
    hardener: '556',
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
      // The battens' centers from the rear end of the frame side (the frame side starts at the box's aft end), and the hinges across the fore edge, from the model.
      const sideRim = c.by('storage-rim-side-L');
      const rim0 = sideRim ? worldAABB(sideRim).min[0] : 0;
      const battenAt = battens.map((id) => { const b = worldAABB(c.by(id)!); return (b.min[0] + b.max[0]) / 2 - rim0; });
      const hingeB = c.by('storage-hinge-L') ? worldAABB(c.by('storage-hinge-L')!) : null;
      // The corner mortises from the model: their center up from the frame's bottom face, the gap under the panel rabbet's floor, and (end pieces) in from the outside face.
      const rimT = sideRim ? worldAABB(sideRim).max[2] - worldAABB(sideRim).min[2] : 0;
      const mortTop = mort?.positions ? new RegExp(`(${FR})" from the top face`).exec(mort.positions.join('; ')) : null;
      const mortW = /^(\S+)" wide/.exec(mort?.size ?? '');
      const rabbetDeep = /^(\S+)" ×/.exec(feat(c, 'storage-rim-side-L', 'rabbet')?.size ?? '');
      const endRim = c.by('storage-rim-end-aft') ? worldAABB(c.by('storage-rim-end-aft')!) : null;
      const mortUp = mortTop ? rimT - parseFrac(mortTop[1]) : 0;
      const mortGap = mortTop && mortW && rabbetDeep ? parseFrac(mortTop[1]) - parseFrac(mortW[1]) / 2 - parseFrac(rabbetDeep[1]) : 0;
      const mortWhere = mortTop ? `${fin(mortUp)} up from the bottom face` : '';
      // D-89: the fixed strip, its groove and end blocks, and how far the lid opens onto the upright seat back, from the model.
      const strip = c.by('storage-strip'), stripB = strip ? worldAABB(strip) : null;
      const stripEnd = c.by('storage-strip-end-L') ? worldAABB(c.by('storage-strip-end-L')!) : null;
      const boxSide = c.by('storage-side-L') ? worldAABB(c.by('storage-side-L')!) : null;
      const openDeg = Math.round(lidOpenAngleDeg(c.p, computeLayout(c.p)));
      const rimFore = c.by('storage-rim-end-fore') ? worldAABB(c.by('storage-rim-end-fore')!) : null;
      const hingeKind = /surface-mount butt hinge, ([^)]*)\)/.exec(c.by('storage-hinge-L')?.sourcing?.vendor ?? '')?.[1]?.replace(/(\d)½/g, '$1-1/2').replace(/(\d)¾/g, '$1-3/4').replace(/½/g, '1/2').replace(/¾/g, '3/4');
      return {
        goal: 'Glue the fixed oak strip across the front of the box top, then make the lid (an oak frame round a thin panel) and fit its hinges on the strip.',
        items: [
          ...(boxSide && stripB ? [I('Before you cut the strip and the lid: measure the box as built, on its coaming.', [
            `Outside width at both ends: ${fin(2 * boxSide.max[1])} by design; the strip is cut to the width you measure and the lid frame to the same.`,
            `Outside length: ${fin(boxSide.max[0] - boxSide.min[0])} by design; the strip's aft face lands ${fin(stripB.min[0] - boxSide.min[0])} from the box's aft end, and the lid frame fills the rest less its gaps.`,
            'Diagonals across the coaming equal within 1/16": a box out of square gives a lid out of square. Between 1/16" and 1/8", plane the coaming square with a block plane on its outside faces; over 1/8", stop and true the box before the strip goes on.',
            'The lid panel is sawn only once the lid frame\'s rabbet is cut (below), to fit it.',
          ])] : []),
          ...(strip && stripB ? [I(`Cut the {{storage-strip}} from one oak board, to the box's width as you measured it: by design ${fin(stripB.max[2] - stripB.min[2])} thick, ${fin(stripB.max[0] - stripB.min[0])} wide and ${fin(stripB.max[1] - stripB.min[1])} long, the grain along its length (across the sled).`, [
            stripEnd ? `Groove its underside end to end on the table saw (several passes): ${fin(stripEnd.max[2] - stripEnd.min[2])} deep, from ${fin(stripEnd.min[0] - stripB.min[0])} to ${fin(stripEnd.max[0] - stripB.min[0])} from its aft edge. That leaves a ${fin(stripEnd.min[0] - stripB.min[0])} hinge leg at the aft edge and a ${fin(stripB.max[0] - stripEnd.max[0])} leg at the front.` : false,
            stripEnd ? `Cut the two end blocks (${tl(c.mine.filter((x) => /^storage-strip-end-/.test(x.id)).map((x) => x.id))}), ${fin(stripEnd.max[0] - stripEnd.min[0])} × ${fin(stripEnd.max[1] - stripEnd.min[1])} × ${fin(stripEnd.max[2] - stripEnd.min[2])}, and glue one into each end of the groove: there the strip sits on the side coamings, and the box stays closed at its sides.` : false,
            'Ease the top aft edge 1/16" (the hinge knuckles bed down on it), seal it all round with epoxy, and let it cure.',
          ], c.mine.filter((x) => /^storage-strip/.test(x.id)).map((x) => x.id))] : []),
          ...(strip && stripB ? [I('Glue the strip across the front of the box top with thickened epoxy, on the coaming.', [
            `Its front face flush with the box's front end, its ends flush with the box sides; its aft face ${boxSide ? fin(stripB.min[0] - boxSide.min[0]) : SEE} from the box's aft end outside.`,
            'Its front leg sits on the fore coaming, its hinge leg and end blocks on the side coamings. Clamp it with cauls and wipe the squeeze-out.',
            'Its top is level with the lid top: the lid shuts 1/8" behind it, on the gasket.',
          ])] : []),
          I(`Cut ${tl(frame)} (the four lid frame pieces) to the box as you measured it, then cut their joints.`, [
            `Corners: blind loose tenons${mortSize ? `, ${mortSize}` : ''}, a mortise in both pieces.`,
            `In the inboard face of each frame side: centered ${mortAt.length ? `at ${list(mortAt)} from the rear end` : SEE}${mortWhere ? `, ${mortWhere}` : ''}.`,
            `In each end of the two end pieces: centered ${mortWhere ? `${mortWhere} and ` : ''}${endRim ? `${fin((endRim.max[0] - endRim.min[0]) / 2)} in from the outside face (the aft face of the aft piece, the front face of the fore piece)` : 'across the width'}.`,
            mortGap > 0 ? `So every mortise stays ${fin(mortGap)} under the rabbet floor: none breaks into the panel rabbet.` : false,
            'Panel rabbet: 1/4" × 1/4" along the top inside edge of every frame piece.',
            dadoSpans.length
              ? `${dadoSpans.length} batten dados, ${dadoDeep ?? '1/4'}" deep, in the inboard face of each frame side, starting ${listS(dadoSpans.map(([a]) => fin(a)))} from the rear end${dadoWide}${dadoDown ? `, ${dadoDown} below the top face` : ''}.`
              : false,
          ], frame),
          I('Saw the {{storage-lid}} on the table saw to its cut-list size (the size includes the 1/4" tongue that sits in the rabbet all round).', ['First lay the four frame pieces round it dry, at their joints: the panel drops into the rabbets with about 1/32" all round. If the frame came out to the box a little off its drawing, saw the panel to the frame.']),
          ...((lg) => (lg ? [I(`Letter the panel's top face ${lg.text}, all before it is sealed.`, [
            `Test first: mask an offcut of the same sheet with the same tape and score the lettering file through it. Raise the power or add passes until the letters come out dark, just through the face veneer into the first glue line (about ${fractionText(lg.depthIn, 64)}" deep); the face veneer is thinner than that, so it is the glue line that reads.`,
            'Mask the lettering area with low-tack masking tape first, smoothed down hard: the laser scores through the tape, and the tape keeps the fill off the bare birch (thin epoxy wicks into its grain and leaves a grey halo).',
            'Laser: lay the panel on the bed, line it up on the black outline with the framing preview, and run the lettering file (the letters only; each stroke is several passes side by side, so the line reads from a standing position).',
            'Fill: work black epoxy (pigment in a little mixed epoxy, thickened a little so it does not run) or an oil-based black paint marker into the letters, over the tape.',
            'Peel the tape while the fill is still soft; when it is hard (24 h), sand the face flush with a block at 220 grit, lightly: do not go through the face veneer.',
            I(`The finishing schedule only checks the lettering's fill (step ${stepNo(c, 'engrave')}), before the topcoat.`, ['It is a lid to sit a cushion on, not a step.']),
          ])] : []))(c.by('storage-lid')?.legend),
          I('Seal the {{storage-lid}} with epoxy, both faces and every edge, and let it cure.'),
          I(`Glue the frame square around the panel, all in thickened epoxy: on the corner tenons and bedding the panel edge in its rabbet.`, ['Clamp it square while the corners set.']),
          I(`Glue the ${plural(battens.length, 'batten')} under the panel with thickened epoxy, the lid face down on a flat bench and weighted for 24 h.`, [
            battenAt.length ? I(`Centers ${list(battenAt)} from the rear end of the frame, square across; each cut to fit between the frame sides as glued and butted to them in the epoxy.`, [], battens) : false,
            'No screws: nothing goes through the thin panel. The battens keep it from sagging.',
          ], battens),
          ...(!hingeB ? [I('The lid lifts off: an under-seat box has no hinges (the seat cushion sits on its lid).')] : []),
          ...(!hingeB ? [] : [I(`Fit the lid on its 2 stainless butt hinges${hingeKind ? ` (${hingeKind})` : ''}, lying flat on top across the joint between the strip and the lid${hingeB ? `, centered ${fin((hingeB.min[1] + hingeB.max[1]) / 2)} either side of the centerline` : ''}.`, [
            `Set the lid on the box with a 1/8" spacer between its front face and the strip, so the gap is even: the gasket fills it later. Its aft end then stands ${fin(c.p.storageLidAftGapIn)} in from the box's aft face, clear of the transom backers and the turn-button blocks as it swings open.`,
            `Ease the top front edge of the lid frame 1/16", like the strip's, and center each knuckle over the gap.`,
            `Pilots for ${screwOf(c, 'storage-hinge-L', /^storage-strip$/)} down into the strip's hinge leg and ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} down into the lid frame's front end${rimFore ? ` (${fin(rimFore.max[0] - rimFore.min[0])} wide)` : ''}, at the hinge holes.`,
            `Screw them on to check the fit: the lid swings up and back about the knuckles${openDeg < 180 ? `, past upright, and rests on the upright seat back at about ${openDeg}°` : ''}.`,
            'With the seat back upright, the lid opens past upright and rests on it. With the back flipped flat, it folds right over and lies open on the strip, on two rubber bumpers fitted at [[step:final-fit]]: lower it by hand, and do not lean on its far edge.',
            'Then take the hinges off for the finish; they go on for good at the hang step. The gasket goes in at the final fit.',
          ], ['storage-hinge-L', 'storage-hinge-R'])]),
        ],
        checks: ['Lid flat and square; sits on the coaming without rocking', 'Panel flush with the frame', 'Strip top level with the lid top, an even 1/8" gap between them', 'The lid opens past upright and leans on the upright seat back'],
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
    why: 'The stop blocks and the crest strip are what the seat back leans on, and latches to, when it is upright.',
    tools: ['bandsaw', 'plane', 'clamps', 'epoxy pumps', 'straightedge', 'drill', '1/8" bit', 'countersink', 'stubby screwdriver'],
    hardener: '556',
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
      const wb = c.by('seat-wedge-L') ? worldAABB(c.by('seat-wedge-L')!) : null;
      const wedgeScrew = c.by('seat-wedge-L')?.joints?.find((q) => q.type === 'screw' && q.fit);
      // The crest strip: its size (the cut list stock). D-89: the lid hinges are on top of the box now, so it beds straight on the box end.
      const crest = c.by('seat-crest-strip');
      // The crest strip's wedge profile, from its drawing: thick at the bottom edge, thin at the top, the sloped face in plane with the blocks' faces.
      const crestCut = feat(c, 'seat-crest-strip', 'outline', (q) => q.angleDeg !== undefined);
      const crestPts = crestCut ? (crestCut.positions ?? []).flatMap((t) => [...t.matchAll(new RegExp(`(${FR})" from the rear face, (${FR})" from the bottom edge`, 'g'))].map((m) => m[1])) : [];
      return {
        goal: 'Glue the seat-back stop blocks and the crest strip to the box end.',
        items: [
          I('Shape the stop blocks to the back angle: bandsaw, then plane to the line (block drawing).', [
            cut?.angleDeg !== undefined && cutPts.length >= 2
              ? `Sloped end at ${cut.angleDeg}° from level: from ${cutPts[0][0]}" from the rear edge at the bottom end, up to ${cutPts[1][0]}" from the rear edge at ${cutPts[1][1]}" up.`
              : `Sloped end: ${SEE}.`,
          ], ['seat-wedge-L', 'seat-wedge-R']),
          I('Mark where the upright latch hole will go on each block: it is drilled later, through the seat back\'s own pin hole, once the back hangs on its hinges ([[step:seat-back]]).', [
            latchSize ? `It will be a ${latchSize[1]}" hole, ${latchSize[2]}" deep${tilt ? `, tilted ${tilt}° from the bottom-end line, square to the sloped face it enters` : ''}.` : '3/8" blind hole.',
            mouth ? `Mouth: ${mouth}.` : SEE_ITEM,
          ], ['seat-wedge-L', 'seat-wedge-R']),
          I(`Glue each block to the deck and the box end, located on its ${pilots ? plural(pilots.perBlock, 'pilot') : 'pilots'} from [[step:under-holes]]${wb ? `: centered ${fin((wb.min[1] + wb.max[1]) / 2)} either side of the centerline, its back against the box end` : ''}.`, [
            'Raise the sled on blocks so you can reach under the deck; it stays level while the epoxy is wet.',
            `From below, open each 1/8" locating hole in the deck to 11/64" (the #8 clearance) and countersink it on the underside for the ${wedgeScrew?.fit ? `${screwText(wedgeScrew.fit)}"` : '#8'} flat-heads.`,
            `Dry first: drive the ${pilots ? pilots.perBlock : 2} screws up from below until their tips just mark the block, then pilot the block 1/8" at the marks.`,
            `Glue: spread thickened epoxy, set the block, and at once drive the ${wedgeScrew?.fit ? `${pilots ? pilots.perBlock : 2} × ${screwText(wedgeScrew.fit)}" stainless flat-heads` : 'screws'} from the UNDERSIDE with a stubby driver, countersunk.`,
            'No screw goes in from above.',
          ]),
          I('Bed the {{seat-crest-strip}} on the box end, between the two blocks.', [
            crest?.stock ? `The strip is ${fin(crest.stock.l)} long and ${fin(crest.stock.w)} tall, cut to the same slope as the blocks' faces; it runs between the two blocks, each end butted to a block.` : 'The strip runs between the two blocks, each end butted to a block.',
            crestPts.length >= 2 ? I(`Rip it to a wedge first (bandsaw, then plane to the line): ${crestPts[0]}" thick at the bottom edge, ${crestPts[1]}" at the top, the back face square, so its sloped front face lies in plane with the blocks' faces. It is sized to the blocks on its drawing; its length is cut to fit between the blocks as glued.`, [], ['seat-crest-strip']) : I('Rip it to a wedge first, so its sloped front face lies in plane with the blocks\' faces (strip drawing).', [], ['seat-crest-strip']),
            'Thickened epoxy on its back face and the box end.',
            'Set it with a straightedge laid across both blocks\' faces: the strip\'s face touches the straightedge all along.',
            'Clamp it with a caul from the front and wipe the squeeze-out.',
          ]),
        ],
        checks: ['Crest strip straight along its span', 'Blocks mirror each other; solid oak behind each latch hole'],
      };
    },
  },
  {
    id: 'seat-back',
    title: 'Seat back, hinges, pins and pads',
    kind: 'build',
    steps: [STEP.seatStorage],
    view: 'side',
    why: 'The rider\'s backrest; it folds flat forward to make a cargo deck.',
    tools: ['drill press with stop', 'hex key', 'iron (veneer edge)', 'router'],
    hardener: '556',
    build: (c) => {
      const pad = feat(c, 'seat-hinge-backer-L', 'hole', /pilot/);
      const eva = evaPads(c);
      const lg = latchGeometry(c.p, computeLayout(c.p));
      const hingeB = c.by('seat-hinge-L') ? worldAABB(c.by('seat-hinge-L')!) : null;
      const panelPin = c.by('seat-back-panel')?.joints?.find((q) => q.type === 'pin');
      const panelClear = /^(\d+\/\d+) clearance/.exec(panelPin?.size ?? '')?.[1];
      // The panel's latch-pin holes come with its Shaper file: no step drills them a second time. The deck's flat-position holes are NOT in the deck's file: they are drilled in place through
      // the panel's own pin holes, so the panel, the deck and the backer pad line up whatever the hinges do.
      const panelPinCut = fileCutHole(c, 'seat-back-panel', (q) => /^seat-pin-/.test(q.to ?? ''));
      return {
        goal: 'Make the seat back and fit its hinges, pins and the two foam pads (the hardware goes on for good after the finish).',
        glue: { epoxy: true, titebond: false },
        items: [
          I('Band the edge of the {{seat-back-panel}} (made with the deck at [[step:cut-deck]], its 2-1/2" radius top corners and all).', ['1/16" oak veneer banding round the edge, flush-trimmed and epoxy-sealed: no ply edge shows.']),
          I('Set the hinge inserts: 3 per hinge, #10-32 × 5/16" stainless, hex-drive.', [
            `Hold each 2" butt hinge on the front face at the bottom edge, its knuckle at the edge${hingeB ? `, centered ${fin((hingeB.min[1] + hingeB.max[1]) / 2)} either side of the center` : ''}, and mark its 3 holes.${shaperFeaturesOf(c, 'seat-back-panel').some((q) => q.kind === 'drill' && /^seat-hinge-/.test(q.to ?? '')) ? ' The panel\'s Shaper file marked them too: the hinge\'s holes must fall on those marks; if they do not, go by the hinge.' : ''}`,
            'Pull-test one insert in a scrap of the same plywood first (Verify).',
            `Drill ${fin(INSERT_DRILL_IN)} blind holes 11/32" deep from the front face (drill stop), at least 1/2" from every edge, and epoxy the inserts in.`,
            'Leave them for the full cure before the first load.',
          ]),
          panelPinCut
            ? I('The latch-pin holes came with the panel (its Shaper file): do not drill them again.', [`Check them: ${panelClear ? `${panelClear}"` : '13/32"'} clearance, 7-3/8" either side of the center, 2" up from the hinge axis.`, 'Line them with epoxy.'])
            : I('Bore the latch-pin holes in the panel.', [`${panelClear ? `${panelClear}"` : '13/32"'} clearance, square, 7-3/8" either side of the center, 2" up from the hinge axis.`, 'Line them with epoxy.']),
          I('FIT AND DRILL now, hang later: the 2" butt hinges.', [
            '#10-32 × 3/8" screws go in from the FRONT (forward) face, through the leaf, into the inserts. The hinge leaf, the inserts and the screws are all on that one face; nothing is drilled from the back face.',
            `${screwOf(c, 'seat-hinge-L', /hinge-backer/)} through the deck into the oak backer pads (glued under the deck in [[step:frame]]), piloted through the leaf holes${pad ? ' (positions on the backer drawing)' : ''}.`,
          ], ['seat-hinge-L', 'seat-hinge-R', 'seat-hinge-backer-L', 'seat-hinge-backer-R']),
          I('After the inserts have cured, hang the back dry on its hinges and drill the latch holes through the panel\'s own pin holes, so they line up.', [
            `Upright: lean the back on the stop blocks and drill each block through the panel hole, ${fin(2 * PIN_R_IN)}, square to the panel: set the stop at the panel thickness plus ${fin(lg.upHoleIn)} (${fin(c.p.seatBackThickIn + lg.upHoleIn)} from the panel's front face).`,
            `Flat: flip the back forward onto the deck and drill through the panel hole and the deck (${panelClear ? `${panelClear}"` : '13/32"'}), then ${fin(2 * PIN_R_IN)} into the backer pad: set the stop at the panel plus the deck plus ${fin(lg.flatHoleIn)} (${fin(c.p.seatBackThickIn + computeLayout(c.p).ply + lg.flatHoleIn)} from the panel's back face, now on top).`,
            `Cut a 1/16" detent groove in each blind hole for the pin's ball: ${fin(lg.upGrooveIn)} from the mouth in the blocks, ${fin(lg.flatGrooveIn)} below the deck in the pads. Use a small hook tool or a ground-down hex key; measure where the ball sits on the real pin first.`,
            'Brush epoxy into every hole.',
          ], ['seat-wedge-L', 'seat-wedge-R', 'seat-hinge-backer-L', 'seat-hinge-backer-R']),
          ...(eva ? [I(`Make the seat cushion and the back pad from three ${eva.padText} kneeling pads.`, [
            I(`Make the {{seat-cushion}}, ${eva.cushionText}, from two pads.`, [
              `Use one whole pad, and cut a ${eva.stripCutText} wide strip, the full ${eva.widthText} long, from the second pad (a sharp utility knife and a straightedge, cut square).`,
              'Brush contact cement on the strip edge and on the whole pad\'s matching edge. Let it get tacky, then press the strip on, edge to edge, ends flush.',
              `Trim the glued cushion to ${eva.cushionText}. It lies ${eva.widthText} across the sled; the seam runs across it, at the rear.`,
              'Keep the offcut of the second pad as a spare.',
            ]),
            I(`Make the {{seat-back-pad}} from the third pad.`, [
              `Trim the third pad to the back pad's outline: ${eva.backText}, top corners rounded to a ${fin(c.p.seatBackCornerRadiusIn)} radius (trace the corner on a can or a template).`,
              'The pad needs no cover and no finish.',
            ]),
          ], ['seat-cushion', 'seat-back-pad'])] : []),
          ...(eva ? [I('Mark where the hook-and-loop strips go (they go on after the finish).', [
            `Cushion: two strips of 2" wide industrial hook-and-loop, each ${eva.stripLenText} long, running front to back, ${eva.stripInText} in from each side edge, centered front to back. The loop strips go on the underside of the cushion; the hook strips go on the deck in the same places.`,
            `On the deck, the cushion's rear edge lies 3/8" in front of the seat back, so the hinge knuckles clear it: ${eva.cushionRearText} forward of the transom's outer face.`,
            `Back pad: two strips, each 2" wide and ${eva.backStripText} long, across the pad, one a quarter of the way down from the top and one a quarter of the way up from the bottom. The loop strips go on the pad; the hook strips go on the front face of the back panel, on the pad's outline, above the pin holes.`,
            'Wipe the surfaces clean first. Press each strip down hard; if the adhesive will not hold on the foam, use contact cement.',
          ], ['seat-cushion', 'seat-back-pad', 'seat-back-panel'])] : []),
          I('Dry-fit the spring-detent pins and lanyards.', ['Check that the pin heads clear the pads once the pads are on.', 'The pins go on with the hinges after the finish.'], ['seat-pin-L', 'seat-pin-R']),
        ],
        checks: ['Back flips 105° and lies flat; both latches engage in both positions', 'Pin head clears the pad', 'Seat back does not rock against the crest strip', 'Pad seam is flat and the glued edges are tight'],
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
    // D-94: the flaps are cut after the template has been tried on the knee and the tire.
    cuts: /^brake-flap-[LR]$/,
    cutAfter: 'gear-fit',
    view: 'side',
    why: 'The brake is a step brake for the musher walking behind: stepping on a flap\'s tread presses its rubber pad onto the rear tire, and a shock cord lifts it off again. The chocks hold the sled when it is parked.',
    tools: ['bandsaw', 'metal bandsaw', 'drill press', 'cobalt bit (the strap)', 'router (1/4" roundover)', 'contact cement'],
    hardener: '556',
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
      const strapScrews = `${strapScrewJoint?.count ?? 4} × ${screwOf(c, 'brake-strap-L', /brake-knee/)}`;
      const strapRows = `${(strapScrewJoint?.count ?? 4) / 2} in the roof above the pocket and ${(strapScrewJoint?.count ?? 4) / 2} in the floor under it`;
      // The strap's top against the knee's top, and where the shoe sits along the flap (its middle, measured from the flap's foot end), from the brake layout.
      const strapTop = bgs.strap.z1 - bgs.knee.zTop;
      const strapTopText = Math.abs(strapTop) < 1 / 32 ? 'its top flush with the knee\'s top' : `its top ${fin(Math.abs(strapTop))} ${strapTop > 0 ? 'above' : 'below'} the knee's top`;
      const shoeMid = bgs.shoe.outline.reduce((a, q) => [a[0] + q[0] / bgs.shoe.outline.length, a[1] + q[1] / bgs.shoe.outline.length], [0, 0]);
      const shoeS = (shoeMid[0] - bgs.H[0]) * bgs.u[0] + (shoeMid[1] - bgs.H[1]) * bgs.u[1];
      const shoeFromFoot = bgs.board.s1 - shoeS;
      const shoeStock = c.by('brake-shoe-L')?.stock;
      const pivotStock = c.by('brake-pivot-block-L')?.stock;
      return {
        goal: 'Make the two brake flaps with their shoes, pads, return cords and chocks, as removable kits.',
        items: [
          I('Before you cut the two flaps, {{brake-flap-L}} and {{brake-flap-R}}: the flap template passed its check on the knee and the tire at [[step:gear-fit]], and the first knee passed its pocket test (Verify, brake). If either did not, change the flap or the knee first.', [
            I(`Then cut them from ${fin(c.by('brake-flap-L')?.stock?.t ?? 0.875)} oak on the Shaper from their file.`, [], ['brake-flap-L', 'brake-flap-R']),
            'Or, without the Shaper: bandsaw each 1/16" outside the line and flush-trim it with a pattern bit on the flap router template (Forms section), drilling the pilots through its guide holes.',
            'Turn the template over for the right flap: the screw eye goes inboard on both.',
          ]),
          I(`Round every edge of the flaps over with a 1/4" roundover bit (the oak is ${fin(c.by('brake-flap-L')?.stock?.t ?? 0.875)} thick), then epoxy-seal them.`, isRemovable(c.p) ? ['The knees are off the sled since [[step:gear-fit]]: the straps and flaps are fitted on the bench.'] : []),
          I('Make the two pivot straps: {{brake-strap-L}} and {{brake-strap-R}}.', [
            strapRow ? `${strapRow.section}, cut ${fin(strapRow.cutLengthIn)} long on the metal bandsaw and deburred.` : 'Cut on the metal bandsaw (cut list) and deburr.',
            `On the drill press: ${strapScrewHoles ?? 'the screw holes from the strap drawing'}; then the pin hole${strapPinHole ? `, ${strapPinHole}` : ', from the strap drawing'}.`,
          ]),
          I('Screw a strap to each knee, across the open side of the pocket: {{brake-strap-L}} and {{brake-strap-R}}.', [
            `Each strap takes ${strapScrews} stainless pan-head wood screws: ${strapRows}. They go into the side grain of the rear and front layers.`,
            `Lay the strap on the knee's outboard edge, its rear edge flush with the knee's rear face and ${strapTopText}: its pin hole then sits at the middle of the pocket. Mark each screw through its hole and drill ${strapPilot ?? '1/8" pilots'} at the marks.`,
            isRemovable(c.p) ? 'Screw the strap on dry for now. It comes off for the bench finish and goes back on at the hang step, with a drop of epoxy in each pilot.' : 'A drop of epoxy in each pilot before its screw.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Cut and fit a pivot block on each flap tongue: {{brake-pivot-block-L}} and {{brake-pivot-block-R}}. It deepens the tongue so the pin hole has oak above and below it.', [
            pivotStock ? `Each is ${fin(pivotStock.l)} × ${fin(pivotStock.w)} × ${fin(pivotStock.t)} oak, on the tongue's top face, its front end flush with the flap's front end.` : 'On the tongue\'s top face, its front end flush with the flap\'s front end.',
            `Glue and 3 × ${screwOf(c, 'brake-pivot-block-L', /brake-flap/)} flat-head screws near its rear end, clear of the pin (positions on the block drawing); clamp it while the glue sets.`,
            `Mark the pin center on the tongue from its drawing, clamp the tongue and block in the knee's pocket with the mark centered in the strap's hole, and drill the pin hole in one pass with one ${fin(bgs.strap.pinHole)} bit: through the strap's hole, the block and the tongue, and ${fin(bgs.pivot.blind)} blind into the inboard wall of the pocket (a depth stop at ${fin(bgs.strap.t + Math.abs(bgs.pivot.ySlot[1] - bgs.pivot.ySlot[0]) + bgs.pivot.blind)} from the strap's outer face, so the bit stops short of coming out of the knee).`,
            `Brush epoxy into the blind hole. Dry-fit the ${fin(bgs.pivot.dia)} × ${fin(bgs.pivot.len)} stainless clevis pin through the strap, the block and the tongue (double shear) and the hitch-pin clip in its cross hole, outboard of the strap, then take them out: they go on at the hang step.`,
          ]),
          I('Bandsaw the shoes: {{brake-shoe-L}} and {{brake-shoe-R}}.', [
            `Bandsaw each from a 4/4 oak offcut${shoeStock ? ` at least ${fin(shoeStock.w)} × ${fin(shoeStock.l)}` : ''}: the top follows the 6° flap underside, the bottom is cut to the tire radius.`,
            `It sits on the flap's underside, centered ${fin(shoeFromFoot)} from the flap's foot end, over the top of the tire.`,
            `Leave the bottom a little long (it is fitted to the tire at the hang step), then glue it on with 2 × ${screwOf(c, 'brake-shoe-L', /brake-flap/)} screws up into the flap.`,
          ]),
          I('Dry-fit the pads and treads: they go on for good at the hang step.', [
            `Pad: 3" × 3" rubber, contact cement and 2 × ${screwOf(c, 'brake-pad-L', /brake-shoe/)} flat-heads buried 1/8", 1/2" off the shoe screws.`,
            'Foot tread: 4" × 2-1/2" ribbed rubber, contact cement.',
          ], ['brake-pad-L', 'brake-pad-R', 'brake-foot-tread-L', 'brake-foot-tread-R']),
          I('Make the return cords: a shock cord that lifts each flap, and a stop cord that holds it down.', [
            `Shock cord: 1/4", ${fin(Math.round(bgs.bungee.lenRel * 4) / 4)} between the eyes, from the #10 screw eye in the flap's rear end face up to a snap hook for the high eye on the transom (a backer behind it).`,
            `Stop cord: 3/16" paracord, tied to the same flap eye and running down to a snap hook for a low eye on the transom, ${fin(STOP_EYE_ABOVE_DECK_IN)} above the deck. Tie it taut with the pad ${fin(c.p.brakePadGapIn)} off the tire (about ${fin(Math.round(bgs.stop.lenRel * 8) / 8)} between the eyes); it goes slack when you step.`,
          ], ['brake-cord-L', 'brake-cord-R', 'brake-stop-L', 'brake-stop-R']),
          I('Bandsaw the chocks from their laminated blocks: {{brake-chock-L}} and {{brake-chock-R}}.', [
            'Oak wedge, its ramp at 28° to meet the tire; two stainless screw heads left proud in the base.',
            `${fin(c.p.brakeChockCordLenIn)} cord to a screw eye under the knee${eye ? `: pilot ${holeText(eye)}` : ''}.`,
            'The eye goes in at the hang step, with a drop of epoxy in the pilot as for the strap screws.',
          ]),
          I('Removable: clip off (it sits outboard of the strap), pin out, cord unhooked, flap lifted off, about 15 s a side.', [
            isRemovable(c.p) ? 'The strap comes off the knee for the bench finish and goes back on at the hang step.' : 'The strap stays on the knee.',
            ...(isRemovable(c.p) ? ['To take a whole knee off the sled later, with its flap on it, see [[step:brake-knee-off]] ({{brake-knee-L}} and {{brake-knee-R}}).'] : []),
            'Finish the flap kit on the bench; the pin, clip, cord, snap hook, pad and tread stay off until the hang step.',
          ], isRemovable(c.p) ? ['brake-knee-L', 'brake-knee-R'] : []),
        ],
        checks: ['Each flap swings freely on its dry-fitted pin in the pocket, with no rub on the roof or floor', 'The strap screws are snug and the pin and clip go in and out by hand', 'Shoe and pad tight on the flap (the pad is fitted to the tire at the hang step)'],
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
    why: 'The push handle is for the musher at the back: they push on its crossbar (the handlebow) and steer from it. It slides out of its sockets and parks low for transport.',
    tools: ['drill press', 'bandsaw', 'router table', 'hex keys', 'epoxy pumps'],
    hardener: '556',
    build: (c) => {
      const sock = feat(c, 'handle-socket-L', 'hole', (q) => (q.to ?? []).includes('transom-rear') && !/access hole/i.test(q.text));
      const access = feat(c, 'handle-socket-L', 'hole', /access hole/i);
      const accessDia = access ? new RegExp(`^(${FR})"`).exec(access.size ?? '')?.[1] : undefined;
      const sockAt = stations(sock, 'BOTTOM end');
      const slope = feat(c, 'handle-post-L', 'outline', (q) => q.angleDeg !== undefined);
      const ang = slope?.angleDeg !== undefined ? String(slope.angleDeg) : undefined;
      // The clevis-pin holes: the socket's own (through both side walls) and the post's two (riding, parked), from the part drawings.
      const sockPin = feat(c, 'handle-socket-L', 'hole', (q) => /pin/.test(q.purpose ?? ''));
      const sockPinAt = stations(sockPin, 'BOTTOM end');
      const sockPinDia = sockPin ? new RegExp(`^(${FR})"`).exec(sockPin.size ?? '')?.[1] : undefined;
      const postPins = featsAll(c, 'handle-post-L', 'hole', (q) => /pin/.test(q.purpose ?? '') && /clearance/.test(q.size ?? '')).flatMap((q) => stations(q, 'BOTTOM end')).sort((a, b) => a - b);
      const postPinDia = new RegExp(`^(${FR})"`).exec(featsAll(c, 'handle-post-L', 'hole', (q) => /pin/.test(q.purpose ?? '') && /clearance/.test(q.size ?? ''))[0]?.size ?? '')?.[1];
      const relief = featsAll(c, 'handle-post-L', ['groove', 'slot', 'notch'], (q) => /relief/i.test(q.text))[0];
      const reliefLong = relief ? new RegExp(`(${FR})" long`).exec(relief.text)?.[1] : undefined;
      const sockHoleDia = sock ? new RegExp(`^(${FR})"`).exec(sock.size ?? '')?.[1] : undefined;
      const pinDia = fin(c.p.handlePinDiameterIn);
      const bowPins = feat(c, 'handle-bar', 'hole', (q) => /deep/.test(q.size ?? ''));
      const bowAt = stations(bowPins, 'LEFT end');
      const place = socketOnTransom(c.parts);
      return {
        goal: 'Make the push handle as one removable U, and fit and drill its sockets on the transom.',
        items: [
          I('FIT now, then take off: the aluminum sockets {{handle-socket-L}} and {{handle-socket-R}}.', [
            place ? `Position on the transom (both sockets): centered ${fin(place.off)} either side of the centerline, the bottom end ${fin(place.up)} up from the transom's bottom edge.` : false,
            `The transom's screw holes were drilled when it was closed. Transfer them to each socket: hold it in place, mark through the transom holes, and drill ${sockHoleDia ? `${sockHoleDia}" ` : ''}holes through the socket's front wall${sockAt.length ? ` (${list(sockAt)} up from its bottom end)` : ''}.`,
            sockPin && sockPinAt.length ? `Drill the socket's own ${sockPinDia ? `${sockPinDia}" ` : ''}pin hole through both side walls, ${list(sockPinAt)} above its bottom end.` : false,
            accessDia ? `Drill a ${accessDia}" access hole in the socket's rear wall opposite each screw: the head goes in through it. After assembly cover it with a flush snap-in hole plug or tape (a push-in plug's legs would rub the post).` : false,
            `At the hang step: the socket ${socketBed(c.p).replace(/^bedded in/, 'bedded on the transom in')}, ${socketScrewText(c.parts)} per socket into the T-nuts, a nylon washer under each head. No wrench reaches behind the box.`,
            'Anodized or epoxy-coated aluminum only (bare aluminum corrodes against wet oak); touch up any bare edge.',
          ]),
          I('Cut the posts to their cut-list size: {{handle-post-L}} and {{handle-post-R}}. They are sized to the sockets, not to built work, so they need no check.', [
            `Slip fit in the sockets; a 1/2" × 3/16" relief groove down the transom-side face${reliefLong ? `, ${reliefLong}" long from the bottom end` : ''}.`,
            `Tops sawn to the bow slope${ang ? ` (${ang}°)` : ''}.`,
            postPins.length >= 2 ? `Two ${postPinDia ? `${postPinDia}" ` : ''}clevis-pin holes straight across the post, side to side (in through its inboard edge), from its bottom end: ${near16(postPins[0])} to ride, ${near16(postPins[postPins.length - 1])} to park.` : false,
            'A 3/8" hole 1-1/2" deep in each top end, on the post\'s axis, for the bow pin.',
          ]),
          I('Make the {{handle-bar}} (the crossbar) from its glued block (step 1), edge bandsawn to the arc of the handlebow template (Forms section: crown templates, cut on the laser with the end templates at [[step:ends]]).', [
            'It is a glued block of two layers, so lay the arc out in the plane of the glue line: the glue line then runs through the middle of the bar\'s depth along its whole length, never along an edge.',
            'Plane and round it to a 1-1/4" grip.',
            bowAt.length ? `Pin holes 3/8" blind, 3/4" deep in the bottom edge, ${list(bowAt)} from the left end.` : 'Pin holes 3/8" blind, 3/4" deep in the bottom edge.',
          ]),
          I('Pin and glue the bow to the post tops.', ['3/8" × 2-1/4" stainless rod: 1-1/2" deep in the post, 3/4" in the bow, glued in.', 'Clamp the bow to both posts (post tops sawn to the bow slope) until the glue sets.', 'The handle comes off as ONE U and is finished on the bench.']),
          I(`${pinDia} clevis pin through both socket walls and the lower hole to ride; through the upper hole to park.`, [], ['handle-pin-L', 'handle-pin-R']),
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
    hardener: '556',
    build: (c) => {
      const flags = c.mine.filter((x) => /^flag-block/.test(x.id)).map((x) => x.id);
      return {
        goal: 'Glue the last wood blocks inside the hull while everything is still bare.',
        items: [
          I(`Glue the flag blocks in the left rear corner: ${tl(flags)}.`, [I('Cut them to their cut-list size first: they are sized to the flag tube, not to built work, so they need no check.', [], flags), 'To the inner gunwale and chine bands; the tube is held between them and the transom backer.']),
          I('Sand the glue faces (120) first and keep epoxy off the faces that get the finish.'),
        ],
        checks: ['Flag blocks line up with the tube against the transom backer'],
      };
    },
  },
  {
    id: 'finish',
    title: 'Finish: epoxy, lettering check, topcoat',
    retitle: (p) => (isStandard(p) ? undefined : 'Finish: stain, epoxy, lettering check, topcoat'),
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
            ? I('Show faces: no stain. Raise the grain once, then the clear urethane, once the offcut panel passed.', ['The deck underside and the open ply edges were epoxied at [[step:seal]], the transom and bulkhead edges at [[step:ends]]; the rest of the end grain gets its coat in the schedule.'])
            : I('Show faces: stained first, then epoxy-sealed, once the offcut panel passed.', ['The deck underside and the ply edges were sealed at [[step:seal]], the transom and bulkhead edges at [[step:ends]]. Water-based dye under the epoxy is the safe route.']),
          I(isRemovable(c.p) ? 'Finish the removable kits on the bench: the brake knees with their flaps and chocks, the handle U and the signs.' : 'Finish the removable kits on the bench: the brake flaps and chocks, the handle U and the signs.', [
            'The tongue and the grab boards (with their caps) are NOT removable: they stay on and are finished in place, with the screw nuts and washers masked.',
            'Plug or mask the pivot bores, bolt seats and sockets.',
            ...(isRemovable(c.p) ? [
              'Take the strap off each knee (its 4 screws) and finish the knee all over: every face, the inboard face against the rail too, with epoxy and the topcoats, and the strap\'s seat. Keep the four bolt holes open, and keep finish out of the pin hole and the strap pilots.',
              'No finish may run onto the rail: the knee is bolted on dry at the hang step.',
            ] : []),
          ], ['brake-flap-L', 'brake-flap-R', 'handle-bar', 'sign-L', 'sign-R', 'bridle-tongue', ...(isRemovable(c.p) ? ['brake-knee-L', 'brake-knee-R'] : [])]),
          I('No hardware on the sled: axles, wheels, plates, eye bolts, hinges, handle sockets and brake pins go on after the varnish cures (next step).'),
        ],
        checks: [
          std ? 'Offcut test panel approved before any urethane goes on the sled' : 'Offcut test panel approved before anything on the sled is stained',
          std ? 'Show faces urethaned, no stain; the deck underside, every uncaptured ply edge and all oak end grain epoxied' : 'Show faces stained, then epoxy-sealed; every plywood edge and all oak end grain sealed',
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
    tools: ['wrenches', 'cotter-pin pliers', 'screwdrivers', 'hex keys', 'sealant gun', 'contact cement'],
    retools: (p) => ['wrenches', 'cotter-pin pliers', 'screwdrivers', 'hex keys', isStandard(p) ? 'epoxy pumps' : 'sealant gun', 'contact cement'], // every bolt here goes snug plus a quarter turn, so no torque wrench (D-88); Standard beds in epoxy
    hardener: '556',
    glueLine: 'Sealant and contact cement: cure per the can; no load until cured',
    reglue: (p) => (isStandard(p) ? 'Epoxy and contact cement: epoxy 8-10 h, cement per the can; no load until cured' : undefined),
    build: (c) => {
      const n = (re: RegExp): number => c.mine.filter((x) => re.test(x.id)).length;
      const ids = (re: RegExp): string[] => c.mine.filter((x) => re.test(x.id)).map((x) => x.id);
      const strapCount = c.by('brake-strap-L')?.joints?.find((q) => q.type === 'screw')?.count ?? 4;
      return {
        goal: 'Put the running gear, hinges, handle and brake kits back on, for good.',
        items: [
          I('Wait until the varnish has cured: hard enough to bolt against, and 7 days before any load.'),
          I('Support the sled for the underside work.', [
            'The clamp-plate, eye-bolt and anchor nuts go on under the beams and crossmembers.',
            'Roll it onto its side on a padded blanket (two people, one side at a time), or flip it onto padded horses (four people) and back onto the wheels after.',
          ]),
          I('Running gear, from the tagged kit.', [
            `The front stub axles in their grooves; ${plural(n(/^clamp-/), 'clamp plate')} with nylock nuts and fender washers, snug plus a quarter turn. The rear ${axleWord(c.p)} and its plates stayed on: check their nuts.`,
            `${plural(n(/^wheel-/), 'wheel')}, washers, collars and cotter pins (the cross hole ${fin(c.p.axleCrossHoleFromEndIn)} in from each ${axleWord(c.p)} end).`,
            'Roll pads across the stub grooves, bearing on the stubs, a screw either side; tape shims between a pad and its stub only if its gap to the rail came out too big at the fit.',
          ], [...ids(/^(axle-|clamp-|wheel-|roll-pad-)/)]),
          I('Steering.', [
            `${plural(n(/^steer-eye/), 'eye bolt')} and ${plural(n(/^steer-anchor/), 'anchor')}, nylock nuts and 2" washers.`,
            'Check chains: 8-7/8" between rings; straight ahead each hangs 2-11/16" slack and goes taut at the lock.',
            ...(c.by('steer-keeper-L') ? [(() => { const L0 = computeLayout(c.p), k = chainKeeper(c.p, L0); return `Chain keepers (${tl(ids(/^steer-keeper-/))}): a small stainless screw eye with no more than 3/8" of thread into the underside of the deck on each side, ${fin(k.eye[0] - (L0.chain.joistX + L0.chain.joistT / 2))} ahead of the chain crossmember's front face and ${fin(Math.abs(k.eye[1]))} from the center line (a 3/32" pilot, 3/8" deep). Cut ${fin(k.cutIn)} of 1/8" shock cord, run it up through the eye and knot its ends to the chain links ${fin(k.linksFromBeamIn[0])} and ${fin(k.linksFromBeamIn[1])} from the beam eye ring, ${fin(k.freeIn)} of cord between the knots.`; })()] : []),
            'Bridle rope through the sleeve, once round the tongue tip, bowline round the standing part; whip the end.',
          ], ids(/^(steer-|bridle$)/)),
          I('Hinges, pins and pads.', [
            `Seat hinges: #10-32 × 3/8 from the front face of the seat back, through the leaf into the inserts, ${screwOf(c, 'seat-hinge-L', /hinge-backer/)} through the deck into the backer pads.`,
            c.by('storage-hinge-L') ? `Lid hinges, flat on top across the joint: ${screwOf(c, 'storage-hinge-L', /^storage-strip$/)} into the fixed strip, ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} into the lid frame, on the pilots drilled at the lid step.` : false,
            'Detent pins on lanyards; the seat cushion and the back pad on their hook-and-loop strips.',
          ], ids(/^(seat-|storage-hinge)/)),
          I(`Handle: ${plural(n(/^handle-socket/), 'socket')} ${socketBed(c.p)} on the transom.`, [
            `${socketScrewText(c.parts)} per socket into the T-nuts, nylon washers under the heads.`,
            'The screw tips must stop short of the box aft wall: check with a dry screw.',
            'Then the finished U and its clevis pins.',
          ], ids(/^handle-/)),
          ...(isRemovable(c.p) ? [I('Brake knees, from the bench.', [
            `Screw each strap back on its knee, ${strapCount} screws with a drop of epoxy in each pilot (the pilots are drilled already).`,
            'Then fit each knee as in [[step:brake-knee-off]], REFIT: dry, on its bolts, hung on one bolt first.',
          ], ['brake-knee-L', 'brake-knee-R'])] : []),
          I('Brake flaps.', [
            'The flap kits on the knees: pivot pin through the strap in double shear, hitch-pin clip outboard of the strap.',
            'Fit each shoe to its tire with the wheel on: scribe the tire radius on the shoe, trim it to the line, then fit the pad.',
            `Shock cord's snap hook to the high transom eye; stop cord's snap hook to the low one, the stop cord tied taut with the pad ${fin(c.p.brakePadGapIn)} off the tire (it goes slack when you step); pad and tread on contact cement; chock cords to the screw eyes, each with a drop of epoxy in its pilot.`,
          ], ids(/^brake-/)),
          I('Recheck every nut before each event: oak creeps under the plates.'),
        ],
        checks: ['All four wheels spin freely, no end float beyond 1/16", the axle swings through the full lock', 'Chain goes taut at full lock before the tire touches anything; the other chain, held up by its keeper cord, hangs at least 3" off the floor all through the swing', 'Hinges and pins work, the handle slides in the sockets, the flaps return by themselves', `Each brake pad hangs ${fin(c.p.brakePadGapIn)} off the tire when released and comes down onto it when the tread is pressed; each flap clears the tire and the transom corner, its foot end at the transom face`],
      };
    },
  },
  {
    id: 'final-fit',
    title: 'Final fit: signs, hardware, lights, reflectors',
    kind: 'build',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['drill', 'hex keys', 'wrenches', 'screwdrivers', 'heat-set insert tip', 'sealant gun'],
    hardener: '556',
    glueLine: 'Polysulfide bedding on the hardware: let it cure before use',
    build: (c) => {
      const rest = c.mine.filter((x) => x.id !== 'hardware');
      const ids = (re: RegExp): string[] => rest.filter((x) => re.test(x.id)).map((x) => x.id);
      const nipples = c.parts.some((x) => /^storage-drain-/.test(x.id));
      // The D-rings are drilled at the side-holes step (so no hole is drilled through a finished face); here they are only bolted on. The grab boards were fitted for good at that step.
      const every = (re: RegExp): string[] => c.parts.filter((x) => re.test(x.id)).map((x) => x.id);
      const lash = lashBoltLength(c.p);
      return {
        goal: 'Bolt on the last fittings: signs, storage hardware, D-rings, lights and reflectors.',
        items: [
          I(`Hang the signs (${tl(ids(/^sign-[LR]$/))}): 4 thumb-knob screws each (${knobText(c)}).`, [`Through the ${/(\d+\/\d+) clearance hole/.exec(c.by('sign-L')?.joints?.find((q) => q.type === 'knob')?.size ?? '')?.[1] ?? '7/32'}" holes, the standoff discs (epoxied to the sign back) and the web, into the inserts set at [[step:side-holes]].`]),
          I('Storage hardware.', [
            `Gasket: one continuous EPDM strip along the side and aft coaming tops under the lid frame (on the aft coaming, its aft edge ${fin(c.p.storageLidAftGapIn)} in from the box's aft face, under the lid frame's aft end), then up the fixed strip's aft face across the front, its top 1/8" below the lid top; splice it at one corner.`,
            ...(c.by('storage-turn-button-L') ? [(() => {
              const tb = worldAABB(c.by('storage-turn-button-L')!), aftRail = c.by('storage-rim-end-aft') ? worldAABB(c.by('storage-rim-end-aft')!).min[0] : tb.max[0];
              return `Turn-buttons (${tl(ids(/^storage-turn-button-/))}): cut each from an oak offcut, ${fin(tb.max[2] - tb.min[2])} × ${fin(tb.max[1] - tb.min[1])} × ${fin(tb.max[0] - tb.min[0])}, and plane a slight cam (about 1/32") on the underside of the end that swings over the lid, so turning it on pulls the lid down onto the gasket. Drill a 3/16" clearance hole through it on its center line, ${fin((tb.max[1] - tb.min[1]) / 2)} from the aft end, and round the aft end to a ${fin((tb.max[1] - tb.min[1]) / 2)} radius about that hole (a half circle), so it swings clear of the transom at every angle. Set the hole over the middle of its block, a 1/8" pilot into the block; one ${screwOf(c, 'storage-turn-button-L', /turn-block/)} down through the button and a nylon washer, snug so it turns stiffly. Turned along the sled it reaches ${fin(tb.max[0] - aftRail)} over the lid frame's aft rail; turned across, it stands ${fin(aftRail - (tb.min[0] + (tb.max[1] - tb.min[1])))} clear of the lid.`;
            })()] : []),
            ...(c.by('storage-bumper-L') ? [(() => {
              const bp = worldAABB(c.by('storage-bumper-L')!), st = c.by('storage-strip') ? worldAABB(c.by('storage-strip')!) : null;
              return `Lid bumpers (${tl(ids(/^storage-bumper-/))}): two ${fin(bp.max[0] - bp.min[0])} self-stick rubber bumpers, ${fin(bp.max[2] - bp.min[2])} tall, on the strip top${st ? `, centered ${fin(st.max[0] - (bp.min[0] + bp.max[0]) / 2)} from its front edge and ${fin(st.max[1] - (bp.min[1] + bp.max[1]) / 2)} in from each end (over the lid frame sides)` : ''}. Wipe the finish clean first. With the seat back flipped flat the lid folds right over onto them: they are as tall as the two hinge leaves folded together, so the lid lies on the strip, not on the hinges.`;
            })()] : []),
            nipples ? 'Aft drain nipples, epoxied in.' : 'The box drain holes and the side drain holes were drilled and sealed earlier: check each is clear.',
            ...(isRemovable(c.p) ? [`Keep the tool pouch (${fin(c.p.toolPouchLengthIn)} × ${fin(c.p.toolPouchWidthIn)} × ${fin(c.p.toolPouchHeightIn)}: ratchet, socket and wrench) with the spare lock nuts and the anti-seize. It rides in the box for cargo use; it is for taking the brake knees off at the truck or in the garage.`] : []),
          ], ids(/^storage-/)),
          I(`Bolt on the D-rings: ${tl(every(/^lash-/))}.`, [
            'The holes in the sides and rib heads were drilled at [[step:side-holes]], before the finish: match each bracket to its rib by its number.',
            ...(lash.len - lash.need > 1 / 16 ? [`Cut the ${fin(lash.len)} bolts to length first, off the sled: the stack needs ${near8(lash.need)} (washer, side, rib head, D-ring bracket, nut and two threads). Run a nut on each bolt, cut it, then back the nut off to clean the threads.`] : []),
            `${LASH_BOLTS} 1/4-20 × ${fin(lash.len)} ${isStandard(c.p) ? 'stainless ' : ''}button-head bolts each, pushed in from OUTSIDE with a ${fin(LASH_WASHER.od)} fender washer under each head on the outer band.`,
            'Nylock nuts on the bracket, inside, with no washer under them (one fender washer a bolt, under the head). Snug them; the ring still folds flat.',
          ]),
          I('Flag tube between the flag blocks; 3/16" drain hole just above the deck.', [], ids(/^flag-tube$/)),
          I('Lights and reflectors.', ['Lamp clips snap into the bulkhead and transom hand-holds; heat-set M4 / M3 inserts.', 'The clips must be printed to the real lights, so measure the lights first and fit each clip before the inserts go in (Verify).', 'Reflectors on the gunwale outer face: wipe clean, press 60 s.'], ids(/^(lamp-clip|rear-lamp-clip|front-light|rear-light|reflector-)/)),
          I('Count the pooled fasteners against the parts list: every fastener 316 stainless.', [], ['hardware']),
        ],
        checks: [`Load test: ${c.p.lashLoadLbf} lbf pull at ${c.p.lashPullAngleDeg}° on one D-ring (its working load); hang the sled by the bowline`, 'Grab boards solid; signs stay on and do not rattle', 'Lid closes on the gasket with no gap; it opens past upright and rests on the upright seat back', 'With the seat back flipped flat, the lid folded right over lies on both bumpers'],
      };
    },
  },
  {
    // Removable knees only (assemblySteps leaves this template out with the default fixed knees).
    id: 'brake-knee-off',
    title: 'Take the brake knees off and put them back',
    kind: 'process',
    steps: [STEP.finish],
    view: 'side',
    tools: ['3/8" drive ratchet', '9/16" socket', '9/16" combination wrench'],
    build: (c) => {
      const bg = brakeOf(c.p), pl = bg.bolts.plate;
      const n = bg.bolts.count;
      const hexAf = wrenchFor(c.p.brakeMountBoltDiaIn);
      const nutPlate = `${fin(pl.x1 - pl.x0)} × ${fin(pl.z1 - pl.z0)} backing plate`;
      return {
        goal: 'Take a brake knee off for the truck or for cargo, and put it back for the brake. About 5 minutes a side; the first time takes longer.',
        items: [
          I('Gather the tools from the pouch.', [`The 3/8" drive ratchet, the ${hexAf}" socket and the ${hexAf}" combination wrench (a short one: the rail is only about ${near8(bg.rail.zb)} off the floor).`, 'The spare lock nuts and the anti-seize are in it too.']),
          I('REMOVAL: take one knee off at a time, {{brake-knee-L}} then {{brake-knee-R}}.', [
            'Work on a hard floor, not in snow: you lie beside the sled.',
            'Unhook the return cord at the transom. Leave the chock tied to its cord and to the eye under the knee (the small screw eye the chock cord ties to): it comes off with the knee.',
            `Lie beside the sled and reach in under the deck, behind the rail, between the two crossmembers just ahead of the rear wheel. The nuts sit on the ${nutPlate} there. Angle the wrench handle down and inboard.`,
            `Hold each nut with the wrench and back the bolt out with the ratchet and the ${hexAf}" socket from the outer face of the knee. Take ${n - 1} bolts out, then hold the knee and take out the last one.`,
            'Lift the knee off the rail with the flap still on it, as one piece.',
            'Thread the bolts, washers and nuts back into the knee loosely, so none is lost.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Stow them.', ['For the truck, the knees come off with their flaps. Nothing then stands out beside the tires.', 'For cargo use the knees stay off the sled, at home or in the truck, each wrapped so it does not mark the paint.', 'The rail keeps its open bolt holes; the backer and the backing plate bedded in its recess stay on.']),
          I('REFIT: put the knee back where it came from, left or right as taped.', [
            'Wipe the rail face, the bottom band of the side and the inboard face of the knee leg. All are finished, so no glue goes on: the knee goes on dry.',
            'Smear a little anti-seize on the bolt threads.',
            `Hang the knee on one bolt first: put a bottom rear bolt, with its washer, through the knee, the rail and the backer and start its nut on the plate, so the knee hangs there and one person can fit the other ${n - 1}.`,
            `Fit the other ${n - 1} bolts with a washer under each head, through the knee, the rail and the backer.`,
            `Hold each nut with the wrench from under the deck, behind the rail (handle down and inboard), and turn the bolt with the ratchet: ${kneeTighten(c.p)}. Go bolt to bolt in turn.`,
            'Hook the return cord at the transom.',
            'Check the bolts for snug before each outing, and retighten every bolt after the first outing.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Replace the lock nuts after about five removals.', ['The nylon wears. Spares ride in the tool pouch.']),
        ],
        checks: ['Each knee seats flat on the rail and the chine band: a slip of paper does not enter the joint line', `All ${n} bolts tightened and every nut on its backing plate`, 'The chock cord eye is solid; the first brake test shows no wobble'],
      };
    },
  },
];

const TEMPLATES: Template[] = [...TEMPLATES_1, ...TEMPLATES_2];

/** How the handle sockets are bedded on the transom (D-83): thickened epoxy under the Standard spec, epoxy or polysulfide sealant under the Extreme spec. */
const socketBed = (p: Params): string => (isStandard(p) ? 'bedded in thickened epoxy' : 'bedded in epoxy or polysulfide sealant');

/** The wrench size across the flats for a bolt diameter (inches, a shop fraction): 3/8" bolts take 9/16". */
function wrenchFor(boltDiaIn: number): string {
  const table: Array<[number, string]> = [[0.25, '7/16'], [0.3125, '1/2'], [0.375, '9/16'], [0.4375, '5/8'], [0.5, '3/4'], [0.625, '15/16']];
  const hit = table.find(([d]) => Math.abs(d - boltDiaIn) < 1e-3);
  return hit ? hit[1] : fin(boltDiaIn * 1.5);
}

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
  // D-78: the step that takes the brake knees off and puts them back exists only with removable knees.
  const templates = p.kneeMount === KNEE_MOUNT.removable ? TEMPLATES : TEMPLATES.filter((t) => t.id !== 'brake-knee-off');
  // 0. The removable hardware belongs to the hang step whatever its model step is (see the header).
  taken.set('hang', real.filter(isHangPart).map((x) => x.id));
  for (const id of taken.get('hang')!) assigned.add(id);
  for (const t of templates) {
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
    const host = [...templates].reverse().find((t) => t.kind === 'build' && t.steps.includes(x.step));
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
  for (const t of templates) {
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
  // "[[step:mill]]" in a template is the number of that step in this book ("step 1"); templates cannot know it, because the list depends on the design.
  const stepNo = new Map(ordered.map(({ t }, i) => [t.id, i]));
  const stepRefs = (t: string): string => t.replace(/\[\[step:([a-z0-9-]+)\]\]/g, (_m, id: string) => (stepNo.has(id) ? `step ${stepNo.get(id)}` : `the ${id.replace(/-/g, ' ')} step`));
  const fix = (t: string): string => noIds(tidy(std ? standardText(stepRefs(t)) : stepRefs(t)));
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
    const clampCure = t.hardener ? (t.reglue?.(p) ?? t.glueLine ?? glueLine(t.hardener, use, t.coat)) : undefined;
    const why = typeof t.why === 'function' ? t.why(ctx) : t.why;
    const figures = stepFigures(t.id, ctx).map((fg) => ({ ...fg, caption: fix(fg.caption), svg: stepRefs(fg.svg) }));
    const forIds = t.forParts ? real.filter((x) => t.forParts!.test(x.id)).map((x) => x.id) : [];
    const step: BuildStep = {
      n,
      id: t.id,
      kind: t.kind,
      title: std ? standardText(t.retitle?.(p) ?? t.title) : (t.retitle?.(p) ?? t.title),
      goal: fix(built.goal),
      items,
      modelStep: t.kind === 'prep' ? 0 : modelStep,
      partIds: ids,
      instructions: flattenInstr(items, nameOf),
      checks: built.checks.map((x) => renderInstrText(fix(known(x)), nameOf)),
      tools: t.retools?.(p) ?? t.tools,
      view: t.view,
      ...(why ? { why: fix(why) } : {}),
      figures,
      forIds,
      cutIds: [],
      ...(t.cutAfter ? { cutAfter: t.cutAfter } : {}),
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
  // D-94: where each shop-cut part is cut to its final size. A step's `cuts` claims its parts; every other one is cut in the first step that names it (an item's parts), else where it is installed.
  const tplOf = new Map(ordered.map(({ t }) => [t.id, t]));
  const claimed = new Map<string, BuildStep>();
  for (const s of steps) {
    const re = tplOf.get(s.id)?.cuts;
    if (!re) continue;
    for (const x of real) if (isShopCut(x) && re.test(x.id) && !claimed.has(x.id)) claimed.set(x.id, s);
  }
  const installIdx = new Map<string, number>();
  steps.forEach((s, i) => { for (const id of s.partIds) if (!installIdx.has(id)) installIdx.set(id, i); });
  for (const x of real.filter(isShopCut)) {
    const at = claimed.get(x.id)
      ?? (() => { const i = steps.findIndex((q) => !ROUGH_STEPS.has(q.id) && cuttingItems(q.items, x.id).length > 0); return steps[i >= 0 ? i : (installIdx.get(x.id) ?? steps.length - 1)]; })();
    at?.cutIds.push(x.id);
  }
  return steps;
}

/** D-94: an item cuts a part to its final size or shape when it names the part and says so with a cutting verb; cutting a feature (a mortise, a hole, a groove) in or for a part is not it. */
const CUT_VERB_RE = /\b(cut|cuts|saw|bandsaw|shape|rip|scribe|trim|crosscut)\b/i;
const FEATURE_RE = /\b(mortises?|grooves?|notch(es)?|holes?|pilots?|recess(es)?|slots?|dados?|reliefs?|counterbores?|rabbets?|bevels?|pockets?|tenons?|plugs?|threads?|joints?)\b/i;
/** True when an item's text says to cut the part itself: a cutting verb (not the words "cut list"), and no feature word (a mortise, a hole) before the first part named in it. */
export function cutsPart(text: string): boolean {
  const object = cutObject(text);
  return object !== undefined && !FEATURE_RE.test(object);
}
/**
 * The object of an item's cutting verb (D-94): the words after the first cutting verb, to the end of its clause, part tokens as "PART"; undefined when the text has no cutting verb
 * (or is a "Before you cut" check, which names the work it measures, not what it cuts). A feature word there ("Cut the beam notch", "Cut the {{transom}} hand hole") means a feature is cut.
 */
export function cutObject(text: string): string | undefined {
  if (/^Before you cut\b/.test(text)) return undefined;
  const t = text.replace(/\bcut[- ]list\b/gi, '').replace(/\bhole saw\b/gi, 'saw').replace(/\{\{[^{}]*\}\}/g, 'PART');
  const m = CUT_VERB_RE.exec(t);
  return m ? t.slice(m.index + m[0].length).split(/[(:;,]|\. /)[0] : undefined;
}
/** The items, at any depth, that cut part `id` to its final size or shape (D-94). */
export function cuttingItems(items: Instr[], id: string): Instr[] {
  const out: Instr[] = [];
  const walk = (xs: Instr[]): void => { for (const it of xs) { if ((it.parts ?? []).includes(id) && cutsPart(it.text)) out.push(it); if (it.sub) walk(it.sub); } };
  walk(items);
  return out;
}

/** D-94: steps that only prepare stock (rough-milled, glued up, laminated oversize): a part they name is cut to its final size later. */
const ROUGH_STEPS: ReadonlySet<string> = new Set(['verify', 'mill']);
/** D-94: the parts the shop cuts to a final size from stock or sheet (Shaper files and table-saw parts), as opposed to bent, bandsawn to a pattern, bought or printed ones. */
export const isShopCut = (x: Pick<Part, 'fab' | 'kind'>): boolean => (x.fab === 'shaper-origin' || x.fab === 'table-saw' || x.fab === 'laser' || x.fab === 'cnc' || x.fab === 'bandsaw') && x.kind !== 'metal';

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
