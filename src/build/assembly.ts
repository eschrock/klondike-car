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
import { axleGrooveDepthIn, bowTaper, KNEE_MOUNT, thinSheet, WEATHER_SPEC, type Params } from '../params';
import { screwText } from '../model/rear-mount';
import { TONGUE_SHOULDER_FILLET_IN, tongueSeatHalfWidth } from '../model/pivot';
import { boxTieGeometry, kneeScrews, lashBoltLength, sideRibStations, KNEE_SCREW_SEAT_IN, LASH_BOLT_DIA_IN, LASH_HOLE_DX_IN, LASH_BOLTS, LASH_WASHER } from '../model/side-ribs';
import { localBounds, transformPoint, worldAABB } from '../model/bounds';
import { cutList, edgeJointUp, LAMINATION_SEAM_OFFSET_IN, ribFillers, type CutList, type GlueUp, type ResawPool } from './cutlist';
import { EPOXY_SYSTEM, epoxyTimeFactor, finishingSchedule, glueJointEstimates } from './finishing';
import { flatPattern } from './flat';
import { formDrawings, RIB_STOCK_IN, type FormDrawing } from './forms';
import { oakBoardFeet, type OakPlan } from './nesting';
import { brakeOf, partDrawings, SCREW_PILOT, type DrawingFeature, type PartDrawingSheet } from './part-drawings';
import { finalFrac, fractionText, nearest32, nearestTo, roughFrac } from './units';
import { GRIP_BOLT_ROWS_IN } from '../model/seat';
import { verifyChecklist, verifyGroups } from './verify';

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
const kneeTighten = (p: Params): string => `snug, then a quarter turn (about ${p.kneeBoltTightenLbIn} in-lb); more crushes the washers and the oak`;

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
  return { perRail, screw: fit ? `${screwText(fit)}"` : '#8 × 2-1/2"', spacingIn: centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : 0, centers };
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
 * The ONE short glue line of a step (`clampCure`), naming the glue the step actually uses and pointing at the glue card: "Epoxy: clamp 8-10 h, full cure 24 h (glue card, step 1)".
 * Under 90 characters. `coat` is for a step that brushes epoxy on (a coat, not a clamped joint).
 */
export function glueLine(h: Hardener, use: GlueUse, cardStep: number, coat = false): string {
  const c = HARDENERS[h];
  const epoxy = coat ? `Epoxy coat: handle after ${hRange(c.clampHours)} h, full cure ${cureTimeText(c.fullHours)}` : `Epoxy: clamp ${hRange(c.clampHours)} h, full cure ${cureTimeText(c.fullHours)}`;
  const tb = 'Titebond III: clamp 30-60 min, full strength in 24 h';
  const ref = ` (glue card, step ${cardStep})`;
  if (use.titebond && use.epoxy) return `Titebond III 30-60 min, epoxy ${hRange(c.clampHours)} h; full cure ${cureTimeText(c.fullHours)}${ref}`;
  return `${use.titebond && !use.epoxy ? tb : epoxy}${ref}`;
}

/**
 * The GLUE CARD: which glue goes where, with the working times, in one place (first item of the first glue step). Every later glue step has only its one-line `clampCure`.
 * The epoxy facts (ratio, hardener, pot life, thickener) are `EPOXY_SYSTEM` in finishing.ts, the kit the BOM buys under both weather specs; the times come from the HARDENERS table
 * and `epoxyTimeFactor` (the cold-shop multiplier).
 */
export function glueCard(p: Params): Instr {
  const c = HARDENERS['556'];
  const k = epoxyTimeFactor(60);
  const r = (lo: number, hi: number): string => `${f(lo * k, 0)}-${f(hi * k, 0)}`;
  const std = isStandard(p);
  const E = EPOXY_SYSTEM;
  return I('GLUE CARD: read it once; each glue step below has one line that points back here.', [
    I(std ? 'Which glue: Titebond III for Dominos, dados, tenons and plain glue joints; epoxy for the laminations, the deck, fillets and tape, and thickened bedding.' : 'Which glue: epoxy for every glue joint (Extreme weather).'),
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
          const shoulder = bg.knee.zLeg - bg.knee.zBot, rel = joint - shoulder;
          const where = Math.abs(rel) < 1 / 32 ? 'level with the shoulder' : `${fin(Math.abs(rel))} ${rel > 0 ? 'above' : 'below'} the shoulder`;
          return [I(`${centerOnly ? 'Only the center layer is edge-glued' : `Only ${glued.length === 1 ? `layer ${glued[0].layer}` : 'the layers that need it'} ${glued.length === 1 ? 'is' : 'are'} edge-glued`}: its joint is ${fin(joint)} up from the bottom edge of the finished knee (${where}), clear of the bolt holes. The upright layers are glued over it.`)];
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
    sub.push(I(`Cut the flap pocket in the rear layer (layer 1) and the center layer (layer 2) BEFORE the glue-up: a ${fin(pv.ySlot[1] - pv.ySlot[0])}-wide notch in from the outboard edge, ${near16(pv.zPocketBot - kn.zBot)} to ${near16(pv.zPocketTop - kn.zBot)} up from the bottom edge of the finished knee.`, [
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

/** Steepest angle (degrees) the bent rails make with the centerline in the bow taper: where the crossmember and king-beam ends meet them. */
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
          glueCard(c.p),
          I('Mill every solid oak part to its rough size in the cut list.', [
            'The cut list already has the rough sizes, rounded up to 1/8" and with the allowances in.',
            `The rule: a plain part is ${fin(allow)} thicker, ${fin(c.p.roughWidthAllowanceIn)} wider and ${fin(c.p.roughLengthAllowanceIn)} longer than finished.`,
            `A glued-up piece (laminated layers, edge-glued boards, bent strips) is ${fin(c.p.laminateWidthAllowanceIn)} wider and ${fin(c.p.laminateLengthAllowanceIn)} longer, because it comes out of the clamps askew.`,
            face.length ? `A glued block loses ${fin(c.p.laminationCleanupIn)} of thickness to jointing and planing after the glue-up.` : false,
            `A board gives less than its name: 4/4 planes to ${fin(c.p.boardYield44In)}, 5/4 to ${fin(c.p.boardYield54In)}.`,
            'The lumber list has only 4/4 and 5/4 white oak. Anything thicker (the tongue, the king beam, the crossmember at the chain, the bow bulkhead, the stop blocks, the hinge backers, the handlebow) is glued up from layers, next.',
            'Sticker what is not used today and keep it at 6-9 % moisture.',
          ]),
          ...(edgeShown.length
            ? [I('Edge-glue the wide boards first, the panels and the wide layers: they must cure before the planer and the Shaper.', [
              ...edgeShown.map((g) => {
                if (g.kind !== 'both') return I(`${tl(g.ids)}: ${plural(g.edgeBoards, 'board')} across.`);
                const lw = layerBoardWidths(c, g);
                const unequal = lw.some((w) => w.length > 1 && w[0] !== w[1]);
                return I(`${tl(g.ids)}: each of its ${g.layers} layers is ${plural(g.edgeBoards, 'board')} across, glued before the layers are stacked.`, [
                  ...lw.map((w, i) => I(`Layer ${i + 1}: boards ${w.map((q) => `${fractionText(q, 8)}"`).join(' and ')} wide (cut list).`)),
                  unequal ? I(`The boards are unequal on purpose. Mark the board 1 edge of every layer and keep those edges on the same side when the layers are stacked: the seams then sit at least ${fin(LAMINATION_SEAM_OFFSET_IN)} apart and no seam lies over another.`) : false,
                ]);
              }),
              `Rip each board ${fin(c.p.laminateWidthAllowanceIn)} wider than its share and joint the mating edges.`,
              `Glue with cauls (${std ? 'Titebond III' : 'epoxy'}), then plane to thickness and trim to the cut-list size.`,
            ])]
            : [I(edge.length ? 'No other part is wider than a board: no more panel glue-ups.' : 'No part is wider than a board: no panel glue-ups.')]),
          ...(face.length
            ? [I('Face-laminate the thick parts before anything is notched, bored or slotted.', [
              'Cut every layer from the cut list (layer table), 1/8" over thickness and with the allowances in. Each block is milled to its final size after the glue-up, so the glue lines come out square.',
              ...face.map((g) => {
                const cross = crossOf.get(g);
                return cross
                  ? I(`${tl(g.ids)}: cross-laminated, like plywood.`, crossLamSubs(c, g, cross))
                  : I(`${tl(g.ids)}: ${lamText(g.ids[0])}${g.kind === 'both' ? ' (each layer edge-glued above)' : ''}.`);
              }),
              'Plane each layer to its rough thickness (cut list, layer table).',
              ...(face.some((g) => g.kind === 'both' && !crossOf.get(g)) ? ['Edge-glue any wide layer first.'] : []),
              `Epoxy the layers face to face (glue card), thickened a little with ${EPOXY_SYSTEM.thickener}.`,
              'Clamp flat between cauls, ends and edges flush, with plenty of clamps (about one every 6"); cure overnight.',
              'Mill the cured block to its final size (joint one face, plane to thickness). From then on it is solid oak.',
            ])]
            : []),
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
          ...(blanks.length ? [I('Saw the single-board bandsaw blanks from thick stock (the glued blocks above are sawn to shape in the steps that use them).', blanks)] : []),
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
    title: 'Cut the Shaper parts',
    kind: 'prep',
    steps: [0],
    view: 'top',
    tools: ['Shaper Origin', 'ShaperTape', 'bandsaw'],
    build: (c) => {
      const shaper = c.parts.filter((x) => x.fab === 'shaper-origin');
      const web = c.parts.find((x) => /^side-L-web$/.test(x.id));
      const webRow = c.cut().sheets.flatMap((g) => g.rows).find((r) => r.ids.includes('side-L-web'));
      const thin = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t < 0.3);
      const thickSheet = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t >= 0.3);
      const oak = shaper.filter((x) => x.kind !== 'sheet');
      return {
        goal: 'Cut the Shaper parts from their files and print the templates.',
        items: [
          I(`Cut the ${shaper.length} Shaper parts from their files.`, [
            I(`${thinSheet(c.p).name}: ${tl(thin.map((x) => x.id))}.`),
            I(`12 mm okoume: ${tl(thickSheet.map((x) => x.id))}.`),
            I(`Oak: ${tl(oak.map((x) => x.id))}.`, oak.some((x) => /^brake-flap/.test(x.id)) ? ['Or, without the Shaper, the brake flaps only: bandsaw each 1/16" outside the line and flush-trim it with a pattern bit on the flap router template (Forms section). The other Shaper parts need the Shaper.'] : []),
            `Measure the real ${thinSheet(c.p).nominal} sheet and the 12 mm sheet first (Verify) and enter the thickness in the design before any dado is cut.`,
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
          I('Print the templates: handlebow arc, bulkhead crown, brake flap and knee (Forms section).', ['Check the 1" square on each printout before cutting.']),
          I('Cut the dados, hand-holds and Domino / tenon mortises as each step calls for them.', [
            'Web-end dados run out through the top edge; the deck dado runs into them at each corner as one pocket.',
          ]),
        ],
        checks: ['Verify items marked "before cutting" are done', 'Web cut net from the file; the blank nests on the sheet'],
      };
    },
  },
  {
    id: 'rail-form',
    title: 'Build the rail form',
    kind: 'prep',
    steps: [0],
    view: 'top',
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
        goal: 'Build the form the two rails are bent on, and prove it with a dry strip.',
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
            'If it cracks: plane thinner or add a minute of damp heat. The test decides 2 or 3 plies.',
            ...(springBack ? [`Spring-back: ${springBack}`] : []),
          ]),
        ],
        checks: ['The form face is fair: a straightedge shows no bump or dip', 'A dry strip takes the S without cracking'],
      };
    },
  },
  {
    id: 'side-forms',
    title: 'Build the side forms: template, cleats and the two ramps',
    kind: 'prep',
    steps: [0],
    view: 'side',
    tools: ['Shaper Origin or bandsaw', 'drill and driver', '3/4" MDF and plywood', '1/4" hardboard', 'packing tape'],
    build: (c) => {
      const sideForm = c.forms().find((d) => d.id === 'side-form');
      const dim = (key: string): number | undefined => sideForm?.dims.find((q) => q.key === key)?.valueIn;
      const rise = dim('ramp-rise');
      const rampLen = dim('ramp-length');
      const ribs = dim('ramp-ribs');
      const make = formMaking(formBuild(sideForm));
      return {
        goal: 'Build the template, the cleats and the two ramps that hold a web bent while its bands cure.',
        items: [
          rise !== undefined && rampLen !== undefined
            ? I(`Build the S-ramp for the sides (side form drawing): rise ${fin(rise)}, ${fin(rampLen)} long from the start of the S to the bow end, ${f(ribs ?? 0, 0)} MDF ribs under a 1/4" hardboard cap.`, make.length ? make : [
              `Ribs of ${fin(RIB_STOCK_IN)} MDF, about 4-1/2" apart.`,
              'Build the MIRROR ramp for the second web face: never the same ramp, the cured web would have to bend back.',
            ])
            : I('Build the side form (side form drawing): a flat template with the sheer cleats. No S-ramp: the sides are not turned in at this design.', make.length ? make : ['The webs glue up flat.']),
          I('Dry-run a web on the form before any glue goes on.', [
            'Lay a dry web on the template, then on each ramp, with its sheer line against the cleats.',
            'It must lie on the ramp with no step at the start of the S and no cleat that rocks: fix the ramp or the spacers now.',
          ]),
        ],
        checks: ['Template flat on the bench, taped, its screws flush', 'Cleats solid, each on a spacer as tall as the web\'s underside there', 'A dry web lies on each ramp with no step at the S'],
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
    hardener: '556',
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
          I('Run the finishing offcut tests first (Finishing, step 1).', [std ? 'They show how the clear urethane looks on each wood; no show face is coated until a panel passes.' : 'They decide how the okoume takes stain under epoxy; no show face is sealed until a panel passes.']),
          std
            ? I('Epoxy ONE coat, unthickened (mix as on the glue card), on:', [
              'the deck underside and deck edges (water pools there);',
              'the oak end grain;',
              `any ${thinSheet(c.p).name} or deck edge not captured in a dado or banded with oak.`,
              'Leave the other plywood faces bare: they take the clear urethane at the finish (no stain).',
            ])
            : I('Epoxy-seal (one coat, unthickened, mixed as on the glue card) ONLY the dados, the deck underside and edges, every ply edge, and faces nobody will see.', [
              'The show faces stay bare: both web faces, the deck top, the box, the lid, the seat back.',
              `They are stained, THEN sealed, after assembly (Finishing, steps ${stepNo(c, 'stain')}-${stepNo(c, 'epoxy')}). Water-based dye under epoxy is the safe route.`,
            ]),
          I(`Check the deck still enters its dado: the dado is the deck thickness plus about ${fin(c.p.deckSlopIn)}.`, ['Use a feeler gauge.']),
          I('Wash the amine blush off any sealed face that will be glued again.', ['Warm water and Scotch-Brite, dry, then 120 grit; the dado walls too.', 'Glue faces stay bare or scuffed; keep the oak bands and rails bare.']),
          I(std ? 'In every later glue-up, wipe squeeze-out off the bare show faces before it kicks: dried epoxy shows as a glossy patch under the clear finish.' : 'In every later glue-up, wipe squeeze-out off the bare show faces before it kicks: dried epoxy blocks the stain.'),
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
    hardener: '556',
    glueLine: `Epoxy: on the form ${HARDENERS['556'].clampHours[1]} h at 60 °F or warmer (glue card, step 1)`,
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
            `Epoxy lightly thickened with ${EPOXY_SYSTEM.thickener} (glue card). The form face and the caul wear the packing tape put on when the form was built: renew it if it is torn.`,
            ...(clampItem
              ? [I(`${clampItem.text.replace(/^CLAMP:\s*/, 'Clamps: ')}`, clampItem.sub ?? [])]
              : [`Clamp at every station: about ${clamps !== undefined ? f(clamps, 0) : '15'} clamps per rail (rail form drawing). Only the bow end is curved.`]),
            `Leave each rail clamped for ${HARDENERS['556'].clampHours[1]} h at 60 °F or warmer (the top of the glue card's clamp time; longer if the shop is colder) before it comes off the form: a bent strip springs back if it is released early.`,
            'One rail per cure, unless you build two forms. Bend the second rail on the same form, the other way up.',
          ]),
          I('After the cure: plane the edges flush and mark the finished ends.', [
            'Leave each rail 1/2" long at both ends: it is trimmed at the dry fit.',
            'Measure every position below from the FINISHED rear end, 1/2" in from the sawn end.',
          ]),
          I('Cut the beam notch in the bottom edge of each rail.', [notchText(notch) ? `${notchText(notch)}.` : `Notch for the rear beam: ${SEE}.`, 'Bandsaw and chisel; the two notches must line up across the frame.'], ids),
          I('Cut the bow step in the bottom edge.', [stepText ? `The rail is ${stepText}.` : `Step at the bow end: ${SEE}.`, 'Bandsaw and plane to the line.'], ids),
          I(`Drill the screw holes in the top edge of each rail: ${tie.perRail ? `${tie.perRail} holes` : 'the holes'}${tieDrill ? `, ${tieDrill} clearance` : ''}, straight through. They take the ${tie.screw} screws that tie the side to the rail.`, [
            tieBored ? `The ${tieBored.count} counterbored holes: ${tieBored.positions?.map(lc).join('; ') ?? SEE}.` : false,
            ...tieHoles.filter((q) => q !== tieBored).map((q) => `${q.count === 1 ? 'The last hole' : `${q.count} more holes`}: ${q.positions?.map(lc).join('; ') ?? SEE}.`),
            tieBore ? `Counterbore the first ${tieBored!.count} from the ${lc(tieBore[3])} up the rail: a ${tieBore[1]} bit, ${tieBore[2]} deep (a #8 flat head is about 11/32" across, so the bore must be ${tieBore[1]}), so the screw heads sit well down in the rail.` : false,
            tieBore ? 'Touch each bore bottom with a countersink bit so the flat head seats. Plug each bore after the screws go in: a 3/8" oak plug from a plug cutter on offcuts (or a 3/8" dowel), glued in and trimmed flush.' : false,
            tieBore && tieHoles.some((q) => q !== tieBored) ? 'The last (forward) hole gets a countersink from the bottom edge instead of a bore, so its flat head sits flush: the rail is shallow there.' : false,
            'Square to the top edge, on the drill press. The holes are spaced evenly so every gap between them is tied.',
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
      return {
        goal: 'Notch the rear axle hangers, glue them to the rails and drill their bolt holes, before the frame glue-up.',
        items: [
          I(`Cut the beam notch in the bottom edge of each hanger: ${tl(ids)}.`, [notchText(notch) ? `${notchText(notch)}.` : `Notch for the rear beam: ${SEE}.`, `Bandsaw and chisel${radius ? `, ${radius} radius in the corners` : ''}.`]),
          I('Cut the Domino mortise for {{joist-1}} in each hanger now (5×30).', [domWhere ? `${cap(domWhere)}.` : SEE_ITEM, 'The crossmember ends engage them in the frame glue-up.']),
          I('Glue each hanger to its rail\'s inboard face, rails flat on the bench.', [
            'Side grain to side grain, the hanger notch in line with the rail notch.',
            std ? 'Titebond III on both faces; clamp it on for 30-60 min.' : `Epoxy on both faces; clamp it on for ${hRange(HARDENERS['556'].clampHours)} h.`,
          ], [...ids, 'rail-L', 'rail-R']),
          I(`Drill the ${bolts ? plural(bolts.count, 'bolt hole') : 'bolt holes'} through each hanger and its rail together, while the clamps hold them in line.`, [
            bolts ? `Holes ${holeText(bolts)}.` : SEE_ITEM,
            railBolts ? `On the rail the same holes are ${holeText(railBolts)}.` : false,
            'No bolt goes in yet. These are the same holes the hold-down angles use at [[step:rear-beam]] ({{beam-hold-down-L}} and {{beam-hold-down-R}}): their upright-leg bolts also hold the hanger to the rail.',
          ]),
        ],
        checks: ['Hangers mirror each other: same distance from the rail rear end', 'Notches in line (string or straightedge across)', 'Bolt holes clean through hanger and rail, in line'],
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
    hardener: '556',
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
      const backerAt = bkBox && railBox ? `, its rear end ${fin(bkBox.min[0] - railBox.min[0])} from the rail's rear end${Math.abs(bkBox.max[2] - railBox.max[2]) < 1 / 32 ? ' and its top edge flush with the rail top' : ''}` : '';
      const kb = brakeOf(c.p).bolts;
      const boltD = fin(c.p.brakeMountBoltDiaIn);
      const hinge = c.mine.filter((x) => /^seat-hinge-backer-/.test(x.id)).map((x) => x.id);
      const crossIds = c.mine.filter((x) => /^(joist-|king-beam)/.test(x.id)).map((x) => x.id);
      return {
        goal: 'Glue the crossmembers between the rails and bond the deck on top, as one flat unit.',
        items: [
          ...(hinge.length ? [I(`The day before: epoxy the seat-hinge backers to the deck underside: ${tl(hinge)}.`, ['Butt each against the face of {{joist-3}} so the latch pin lands in solid oak.'])] : []),
          ...(brakeBackers.length
            ? [
            I(`The day before: prepare the brake knee backers and glue them to the rail inboard faces: ${tl(brakeBackers.map((x) => x.id))}.`, [
              I('First, on the bench: cut the plate recess in the inboard face of each brake knee backer, before it is glued.', [
                plateRecess ? `${plateRecess.size ?? 'Flat-bottomed recess'}: ${whereOf(plateRecess)}.` : `Flat-bottomed recess for the plate: ${SEE}.`,
                'Router with a fence, or saw the edges and chisel the waste out to an even depth.',
                'The plate must lie flush with the face: test it in the recess before gluing.',
              ]),
              I(`Glue each backer to its rail's inboard face${backerAt}, clear of the axle hanger.`, [
                'Side grain to side grain; clamp it on until the glue sets.',
                'Glue it to the rail only. It bonds to the deck underside at the deck glue-up, below.',
              ]),
              cutBack.length ? `${tl(cutBack)} ${cutBack.length === 1 ? 'meets' : 'meet'} a backer: cut ${cutBack.length === 1 ? 'its' : 'their'} ends back ${fin(bkThick)} so ${cutBack.length === 1 ? 'it butts' : 'they butt'} the backer's face.` : false,
              `Drill the ${kb.count} knee-bolt holes (${boltD} bolts) through rail and backer together, from the rail drawing, measured from the finished rear end: ${kneeHoles ? holeText(kneeHoles) : SEE}.`,
              'The same holes on the right rail, mirrored.',
            ], brakeBackers.map((x) => x.id)),
            ...(brakePlates.length
              ? [I(`Make the two stainless backing plates for the knee nuts: ${tl(brakePlates.map((x) => x.id))}.`, [
                `${plateStock ? `${plateStock} stainless plate` : 'Stainless plate'}, set flush in its recess in the backer's inner face. Cut it from 2" flat bar on the metal bandsaw and deburr the cut edges.`,
                plateHoles ? `${kb.count} holes on the knee-bolt pattern, ${holeText(plateHoles)}; clamp each plate in its backer's recess and drill through the backer's holes.` : `Clamp each plate in its recess and drill its ${kb.count} holes through the holes in the backer.`,
                'The nylock nuts bear on this plate, so it spreads the bolt pull over the oak (four fender washers would overlap).',
              ], brakePlates.map((x) => x.id)),
              ...(isRemovable(c.p) ? [I('Bed each plate in thickened epoxy in its recess, so it stays in the backer when the knee bolts come out later.', [
                'Prepare the plate: sand its back and edges with 80 grit, wipe it with acetone, and bed it within the hour.',
                `Spread epoxy thickened with ${EPOXY_SYSTEM.thickener} in the recess and set the plate in. Pass ${kb.count} waxed ${boltD} bolts through the rail, backer and plate holes from the outside, each with a waxed nut on the plate and a waxed caul block (a flat scrap) under the heads.`,
                'Snug the nuts just enough to seat the plate flush with the face; do not squeeze the bed dry. Wipe the squeeze-out.',
                `Take the bolts out after the clamp time on the glue card (${hRange(HARDENERS['556'].clampHours)} h). The plate stays in the backer.`,
              ], brakePlates.map((x) => x.id))] : [])]
              : [])]
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
            `Thickened epoxy (${EPOXY_SYSTEM.thickener}, glue card) on every top face: rails, crossmembers and king beam${brakeBackers.length ? ', and the top edge of each brake knee backer' : ''}.`,
            `Weight the deck down; it bonds full length to the rail and crossmember tops${brakeBackers.length ? ' and to the backers' : ''}.`,
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
      const clampText = glueUp?.sub?.map((q) => q.text).find((q) => /^Clamp each band/.test(q));
      const hold = glueUp?.sub?.map((q) => q.text).find((q) => /^No spring-back/.test(q));
      const bandSize = (id: string): string => { const st = c.by(id)?.stock; return st ? `${thick(st.t)} × ${fin(st.w)}` : ''; };
      return {
        goal: 'Glue the inner bands and the sign backers to each web while the web is bent over the S-ramp.',
        items: [
          I('Per side, glue the inner chine band and the inner gunwale band full-face to the inside of the web.', [
            `Lay the web on the template INSIDE face up, its sheer line against the cleats: the ramp lifts the bow end toward the inside, which is the turn-in.`,
            `The inner chine band is ${bandSize('side-L-chine-in')} and the inner gunwale band ${bandSize('side-L-gunwale-in')}; the gunwale band goes against the cleats.`,
            'Thickened epoxy; no grooves.',
            'Bend web and bands together over the S-ramp (side form drawing).',
            clampText ? loosen(clampText) : 'Clamp the bands to the web every 4-1/2" with spring clamps or small C-clamps.',
            hold ? loosen(hold.replace(/ \(24 h\)/, '')) : false,
          ], ['side-L-web', 'side-L-chine-in', 'side-L-gunwale-in', 'side-R-web', 'side-R-chine-in', 'side-R-gunwale-in']),
          I('Leave the deck rabbet: the inner chine band stops short of the web bottom.', [
            `The gap is the deck thickness plus about ${fin(c.p.deckSlopIn)}: use a deck offcut plus a shim as the spacer stick. Nothing is routed.`,
          ]),
          I('Check the sheer-line cleats and the packing tape on the template before the glue goes on.', [cleat ? `The cleats are about ${near16(cleat)} apart the whole length (side form drawing).` : 'The cleats run the whole length (side form drawing).', 'An edge-bent band pushes about 65 lbf sideways until the epoxy cures.']),
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
    title: 'Side sandwiches, cure 2: outer bands and drain holes',
    retitle: (p) => (isStandard(p) ? undefined : 'Side sandwiches, cure 2: outer bands and scuppers'),
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(chine|gunwale)|scupper-.*)$/,
    view: 'side',
    tools: ['S-ramp (mirror)', 'cleats and screws', 'clamps', 'epoxy pumps', 'drill'],
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
      return {
        goal: scup.length ? 'Glue the outer bands and fit the scuppers in each side.' : 'Glue the outer bands and drill the drain holes in each side.',
        glue: { epoxy: true, titebond: false },
        items: [
          I('Per side, glue the outer chine band and the outer gunwale band to the outside face.', [
            `The outer chine band is ${bandSize('side-L-chine')} and the outer gunwale band ${bandSize('side-L-gunwale')}.`,
            'The chine band bottom is flush with the deck underside level: it rests on the rail.',
            'The gunwale band bends on edge to the sheer and across its thickness to the S, both at once.',
            'Flip the web over onto the MIRROR ramp for this second face (never the same ramp: the cured web would have to bend back), sheer line against the cleats.',
            'Same cleats and clamp spacing as cure 1.',
          ], ['side-L-chine', 'side-L-gunwale', 'side-R-chine', 'side-R-gunwale']),
          I('Fill the gap at the top: the web stops 1/8" under the gunwale band top.', ['Thickened epoxy, then trim flush.']),
          I('If you scarf a band (8:1), place the joint well.', ['Middle third of the band only.', 'Never in the first 4" behind the transom, nor under the grab boards, the rib heads or signs.', 'Stagger it 12" from the joint in the band on the same face.']),
          scup.length
            ? I(`Drill the scuppers: ${plural(scup.length, 'hole')}, ${dia}, through inner band, web and outer band.`, [
              scupX.length ? `${list(scupX)} forward of the web's rear end, the lower edge just above the deck level.` : 'Rear and bow, the lower edge just above the deck level.',
              'Line each hole with epoxy and bed the stainless nipples.',
            ], scup.map((x) => x.id))
            : drains?.side
              ? I(`Drill the drain holes once the cure is hard: ${drains.side.xs.length} in each side, ${dia}, straight through the inner band, the web and the outer band.`, [
                `Mark the inner face of the rear transom on each sandwich first: ${fin(drains.side.faceInIn)} in from the rear end of the web (the web end sits that far inside the transom dado; the bands are trimmed back to this line at the dry fit).`,
                `Centers ${fromFace ?? list(drains.side.xs)} forward of that line, measured along the bottom edge (the same numbers as on the band and web drawings), ${fin(drains.side.upIn)} up from the web's bottom edge (the edge that rests on the rail). The lower edge of each hole then sits 1/16" above the deck.`,
                'Drill square to the side in one pass through all three layers, with a backer board behind the exit so the outer band does not tear.',
                'Brush epoxy into each bore (a small brush or a pipe cleaner), so no cut oak or plywood edge is left bare. Run the bit through again after the epoxy cures if it narrowed the hole.',
              ], ['side-L-web', 'side-R-web'])
              : I('No drain holes in this model.'),
          I('Leave all bands and webs long: they are cut to length at the dry fit.'),
        ],
        checks: ['Four bands per side bonded; the free web shows evenly at the bow and the rear', 'Both sides mirror images within 1/16"', ...(scup.length ? [] : [`The ${dia} drain holes clear and sealed, square to the side`])],
      };
    },
  },
  {
    id: 'dry-fit',
    title: 'Dry-fit, trim the rails, cut the rail-end mortises and drill the screw pilots',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'top',
    tools: ['tape', 'story stick', 'MDF station cradles', 'flush-cut (Japanese) saw', 'Domino', 'guided router', 'hand plane', 'drill'],
    build: (c) => {
      const web = c.by('side-L-web');
      const tie = chineTie(c.parts);
      const pilots = featsAll(c, 'side-L-chine', 'hole', (q) => (q.to ?? []).some((t) => /^rail-/.test(t)));
      const pilotXs = [...new Set(pilots.flatMap((q) => stations(q, 'REAR end')))].sort((a, b) => a - b);
      const net = web ? flatPattern(web)?.widthIn : undefined;
      const web0 = web ? worldAABB(web).min[0] : computeLayout(c.p).xSideStart;
      const cradles = cradleStations(c.p);
      const tMort = feat(c, 'rail-L', 'mortise', (q) => q.face === 'rear end');
      const bMort = feat(c, 'rail-L', 'mortise', (q) => q.face === 'front end');
      return {
        goal: 'Trial-fit the frame unit in the inverted sides, trim everything to one length, then cut the rail-end mortises and drill the screw pilots.',
        items: [
          I(`Stand both sides inverted on ${cradles.length} MDF station cradles: 3/4" plates notched to the sheer.`, cradles.map((q, i) => `Cradle ${i + 1}: ${near8(q.x - web0)} from the rear end of the sides, ${near16(q.widthIn)} wide outside, ${near16(q.heightIn)} tall.`)),
          I('Turn the frame + deck unit over and drop it in DRY.', ['The rail rests on the bottom edge of each side, the sandwich of outer band and web.', 'The deck edge rises into the gap under the inner chine band.']),
          I(`Check the deck slot: ${fin(c.p.deckSideClearIn)} a side to each web.`, ['Pare the deck edge if it binds; thickened epoxy fills the slot later.']),
          I('Measure and trim everything to one length.', [
            'Measure from the floor of the rear transom dado to the floor of the bow bulkhead dado, both sides.',
            `Cut each web to that length less 1/32"${net !== undefined ? ` (the webs came off the Shaper at ${fin(net)}, so this is a small trim)` : ''}: a web runs from dado floor to dado floor.`,
            `Cut each band ${fin(c.p.deckCaptureDepthIn * 2)} shorter than its web: the bands run face to face, from the inner face of the transom to the rear face of the bulkhead, and stop ${fin(c.p.deckCaptureDepthIn)} short of the web end at each end.`,
            'Trim the rails (left 1/2" long) to match: flush-cut saw or oscillating multi-tool, blade flat on the deck underside, then pare to the line.',
          ], ['rail-L', 'rail-R']),
          I('NOW cut the rail-end mortises in the trimmed rail ends.', [
            `Transom end: ${mortiseSize(tMort) ? `${mortiseSize(tMort)} loose-tenon mortise` : endJoint(c, 'rail-L', 'transom-rear')}${fromTop(tMort) ? `, centered ${fromTop(tMort)}` : ''}.`,
            `Bulkhead end: ${mortiseSize(bMort) ? `${mortiseSize(bMort)} loose-tenon mortise` : endJoint(c, 'rail-L', 'bow-bulkhead')}${fromTop(bMort) ? `, centered ${fromTop(bMort)}` : ''}.`,
            'Domino on the glued unit, or a guided router on a fence against the end face. The mating mortises are in the transom and bulkhead Shaper files.',
          ], ['rail-L', 'rail-R']),
          ...(pilots.length ? [I(`Drill the screw pilots in the bottom edge of each side, through the rail holes: ${tie.perRail} a side.`, [
            'Clamp two scrap alignment blocks to the end cradles, one at the transom end and one at the bow end, each snug against the outside of both sides. Leave them there: they put the side back exactly where the dry fit put it at the glue-up.',
            'With the unit sitting dry in the sides, put a 1/8" bit through each clearance hole in the rail and drill straight down into the bottom edge of the side (the hull is inverted, so the rail bottom edge faces up).',
            ...pilots.map((q) => `${q.count === 1 ? '1 pilot' : `${q.count} pilots`}: ${q.size}.`),
            pilotXs.length ? `Their centers, from the rear end (the finished end, not the sawn end): ${list(pilotXs)}.` : false,
            'Tape a flag on the bit at the depth, so no pilot comes out through the face of the web or the outer band.',
            'The rail holes put each pilot on the centerline of the edge, on the glue line between the outer band and the web; the outer chine band drawing lists every pilot.',
            'These pilots are what registers the side at the glue-up: each screw finds its pilot and draws the side onto the rail.',
            'Lift the unit out, brush the pilots clear, and mark each rail beside its side.',
          ], ['rail-L', 'rail-R', 'side-L-chine', 'side-R-chine'])] : []),
          I('Rehearse the glue-up dry, alone, in the same sequence as the next step.', ['Lower the unit onto the alignment blocks, start every screw, set the clamps and cauls, then lift it out again.', 'Time it: the time sets the batch sizes in the next step.']),
          I('Rehearse the closing of the ends (transom first, bulkhead on a second batch) with clamps and cauls in place.'),
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
    tools: ['epoxy pumps', 'clamps and cauls', 'drill', 'screwdriver'],
    hardener: '556',
    build: (c) => {
      const tie = chineTie(c.parts);
      const railScrew = c.by('rail-L')?.joints?.find((j) => j.type === 'screw' && /chine/.test(j.to));
      const tieHoles = featsAll(c, 'rail-L', 'hole', (q) => (q.to ?? []).some((t) => /chine/.test(t)));
      const cbore = /counterbore the head ([\d.\-\/]+"?) up the rail/.exec(railScrew?.size ?? '')?.[1];
      const cbDia = /\(([\d\/-]+")\s*bit\)/.exec(railScrew?.size ?? '')?.[1];
      const bed = fin((c.by('side-L-chine')?.stock?.t ?? 0.234) + (c.by('side-L-web')?.stock?.t ?? 0.157));
      const pilotText = tieHoles.length ? `an ${/^(\S+") clearance/.exec(tieHoles[0].size ?? '')?.[1] ?? '11/64"'} clearance hole through the rail and a ${fin(SCREW_PILOT[8])} pilot in the side` : 'the clearance and pilot holes on the drawings';
      return {
        goal: 'Glue the frame + deck unit into the inverted sides for good.',
        glue: { epoxy: true, titebond: false },
        items: [
          I('Lay everything out before you mix.', [
            'Within reach: the screws and a driver, the clamps and cauls, a mixing tray, the thickener and a stick.',
            `Pot-life budget: both beds about 5 min, the lowering 2 min, ${tie.perRail * 2} screws about ${Math.round(tie.perRail * 2 * 0.5)} min (30 s each) and the clamps 5 min: about ${12 + Math.round(tie.perRail * 2 * 0.5)} min. The pot life is ${EPOXY_SYSTEM.potMin[0]}-${EPOXY_SYSTEM.potMin[1]} min in the cup and less in a thick heap, so mix in TWO batches: one for the beds, one small one for the slots after.`,
          ]),
          I(`Spread a bed of epoxy thickened with ${EPOXY_SYSTEM.thickener} (to peanut butter) along the whole ${bed} bearing face of both sides (outer band + web edge).`, [
            'Spread both sides before anything is lowered.',
            'Thin epoxy runs out of the joint and leaves it starved: the bed must be thick enough to fill the small gaps between the rail and the side.',
          ], ['rail-L', 'rail-R']),
          I('Lower the unit onto the sides, alone.', [
            'Carry it by the transom and bulkhead ends, rest it on the alignment blocks, then let it down.',
            'Turn each rail hole over its pilot as it goes down.',
          ]),
          I(`Screw each rail to its side in every gap: ${tie.perRail} screws a side, ${tie.screw} flat-heads, evenly spaced${tie.spacingIn ? ` (about ${fin(Math.round(tie.spacingIn * 4) / 4)} apart)` : ''}.`, [
            `Each screw has ${pilotText}. Because the pilots were drilled through the rail holes at the dry fit, each screw registers the side: it finds its pilot and draws the side onto the rail where the dry fit put it.`,
            'They go straight down through the rail (the hull is inverted) into the sandwich.',
            ...(cbore ? [`The aft heads sit in ${cbDia ?? 'the'} counterbores ${/"$/.test(cbore) ? cbore : `${fin(Number(cbore))}`} up the rail; the forward screws are countersunk flush. Plug each counterbore with a glued oak plug, flush with the rail's bottom edge, once the screws are in.`] : []),
            'Drive them from the middle of the rail out toward the ends, snug, so the side pulls onto the rail without a gap. Do not overdrive: the edge is only the width of the outer band and the web.',
          ], ['rail-L', 'rail-R']),
          I('Clamp the side to the rail between the screws.', [
            'Small bar clamps, jaws on the rail\'s inner face and on a straight caul along the outside of the outer band, set at the joint.',
            'They keep the side flush with the rail until the epoxy cures.',
          ]),
          I('Then fill the deck slot at each web with thickened epoxy (the second, small batch).', ['The deck edge rises under the inner chine band.', 'Wipe squeeze-out inside the dados before it kicks.']),
        ],
        checks: ['Both webs seat fully on the rails, no daylight at the chine', 'Every screw snug; none has split the edge of the sandwich', 'Hull diagonals equal within 1/8"'],
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
    hardener: '556',
    build: (c) => {
      const backers = c.mine.filter((x) => /backer/.test(x.id)).map((x) => x.id);
      const bands = count(c, 'glue');
      const sockHoles = feat(c, 'handle-socket-L', 'hole', (q) => (q.to ?? []).includes('transom-rear') && !/access hole/i.test(q.text));
      const sockAt = stations(sockHoles, 'BOTTOM end');
      const sockEdge = sockHoles ? new RegExp(`(${FR})" from the outboard edge`).exec((sockHoles.positions ?? []).join('; '))?.[1] : undefined;
      const place = socketOnTransom(c.parts);
      const tnuts = feat(c, 'transom-backer-L', 'hole', (q) => /T-nut/i.test(q.purpose ?? q.text));
      const vents = transomVents(c.parts);
      const nVent = vents.places.length * 2;
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
          ...(vents.places.length
            ? [I(`Drill the ${nVent} vent holes (${fin(vents.dia)}) through the {{transom-rear}}, into the dados.`, [
              ...vents.places.map((v) => `One each side, ${near16(v.off)} off the centerline and ${near16(v.up)} up from the transom's bottom edge.`),
              'The Shaper file marks them; they let the air and epoxy out while the transom slides on.',
            ])]
            : []),
          I(`Glue the backers (3/4" oak) full-face to the inside of the transom: ${tl(backers)}.`, ['Clamp them with a caul and leave them overnight.']),
          I('Close ONE end first: the transom.', [
            'It slides onto the deck edge, both web ends (their dados are open at the top), the rail tenons and the four band ends per side (epoxy fillet butts, no Dominos).',
            `${plural(bands, 'glue joint')} and ${plural(count(c, 'mortise-tenon'), 'mortise-and-tenon')} in one glue-up.`,
            'Two pipe clamps along the length.',
          ]),
          I('Rehearse twice, then glue in small batches.', [
            `Epoxy (glue card), mixed in SMALL batches in a wide shallow container: the pot life is ${EPOXY_SYSTEM.potMin[0]}-${EPOXY_SYSTEM.potMin[1]} min, so do the fillets and the dado fills in the sequence you rehearsed, one batch at a time. You can do it alone.`,
            ...(vents.places.length ? ['Epoxy shows at the vent holes when the dados are full: bung them after.'] : []),
          ]),
        ],
        checks: ['Transom square to the deck and plumb', ...(vents.places.length ? ['Vent holes show a bead of epoxy (dados filled)'] : []), 'Hull length unchanged from the dry-fit measure', 'T-nuts clear of epoxy (run a screw in dry)'],
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
    hardener: '556',
    build: () => ({
      goal: 'Close the bow with the bulkhead, the rider\'s foot brace.',
      items: [
        I('Fit the {{bow-bulkhead}}: its rear face is the rider\'s foot brace.', [
          'Dados open at the top take the web ends; the deck dado run into them takes the deck edge.',
          'Dominos into the rails; the four band ends per side butt with an epoxy fillet.',
        ]),
        I('Glue it with a second, fresh small batch of epoxy once the transom epoxy has gelled (hard to a fingernail).', ['Wide shallow container; you can mix and place it alone.', 'Two pipe clamps along the length.', 'Fillet the inside corners with thickened epoxy.']),
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
    tools: ['drill press', 'router (groove)', 'wrenches'],
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
      const cotter = featsAll(c, 'axle-R', 'hole', (q) => (q.to ?? []).some((t) => /^wheel-/.test(t)));
      const plateHoles = featsAll(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /^clamp-/.test(t)));
      const holdHoles = featsAll(c, 'beam-R', 'hole', (q) => (q.to ?? []).some((t) => /hold-down/.test(t)));
      const plates = c.parts.filter((x) => /^clamp-R/.test(x.id)).map((x) => x.id);
      const plateRow = c.cut().metal.find((q) => q.ids.some((i) => /^clamp-/.test(i)));
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
            'Spot the angle holes first: clamp each angle in place, its upright leg on the hanger\'s inner face and its flat leg on the beam. Mark each upright-leg hole through the holes drilled at [[step:hangers]] and each flat-leg hole through the beam holes, then take the angle off and drill the marks on the drill press.',
            upBolt
              ? `${upBolt.n} ${upBolt.dia} × ${upBolt.len} bolts through each angle's upright leg, the hanger and the rail, in the holes drilled at [[step:hangers]]; nylock nut and fender washer on the rail's outside face.`
              : 'The bolts through each angle\'s upright leg, the hanger and the rail: see the joint list. Nylock nut and fender washer on the rail\'s outside face.',
            flatBolt
              ? `${flatBolt.n} ${flatBolt.dia} × ${flatBolt.len} bolts down through each flat leg and the beam, either side of the ${axleWord(c.p)}.`
              : `The bolts down through each flat leg and the beam, either side of the ${axleWord(c.p)}: see the joint list.`,
            'The beam and angles stay on for finishing; mask the bolt heads.',
          ]),
          ...(plateRow ? [I(`Cut the clamp plates: ${plural(c.parts.filter((x) => /^clamp-/.test(x.id)).length, 'plate')} in all (2 here, 4 on the front beam).`, [
            `Each is ${fin(plateRow.cutLengthIn)} of ${plateRow.section}, cut on the metal bandsaw and deburred on every edge.`,
            'The holes are drilled through the beam holes, with each plate clamped in place (next).',
            'Drilling stainless: center-punch every mark, use a cobalt bit (a plain bit dulls at once), run the drill press SLOW (about 300 rpm), press hard and steadily so it keeps cutting, and flood the bit with cutting oil. A bit that rides without cutting work-hardens the steel: stop, back off and re-sharpen.',
          ], plates)] : []),
          I('FIT AND DRILL, then take off: the axle and its clamp plates.', [
            I(`First, on the drill press, with the {{axle-R}} (${axleWhat(c.p)}) held in a V-block: drill the cotter cross holes${cotterText(cotter, c.by('axle-R')?.stock?.l, 'LEFT end') ? `: ${cotterText(cotter, c.by('axle-R')?.stock?.l, 'LEFT end')}` : `, ${fin(c.p.axleCrossHoleDiaIn)} near each end`}.`),
            'Then lay the rod in the groove.',
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
      const cotterF = featsAll(c, 'axle-FL', 'hole', (q) => (q.to ?? []).some((t) => /^wheel-/.test(t)));
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
            I('Stub axles in their grooves ({{axle-FL}}, {{axle-FR}}); two clamp plates per end (cut like the rear ones), bolted as at the rear.', [cotterText(cotterF, c.by('axle-FL')?.stock?.l, 'OUTBOARD end') ? `Before a stub goes in its groove, drill its cotter cross hole on the drill press with the rod in a V-block: ${cotterText(cotterF, c.by('axle-FL')?.stock?.l, 'OUTBOARD end')}.` : false]),
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
    retitle: (p) => (isRemovable(p) ? 'Brake knees (and backers), fitted dry while the hull is inverted' : undefined),
    retools: (p) => (isRemovable(p) ? ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps', '3/8" drive ratchet and 9/16" socket'] : undefined),
    kind: 'build',
    steps: [STEP.brake],
    at: STEP.gear,
    match: /^brake-(backer|knee)-[LR]$/,
    view: 'under',
    tools: ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '556',
    build: (c) => {
      const knees = c.mine.filter((x) => /^brake-knee/.test(x.id)).map((x) => x.id);
      const backers = c.mine.filter((x) => /^brake-backer/.test(x.id));
      const framed = c.parts.some((x) => /^brake-backer/.test(x.id) && x.step <= HULL_STEP.deck);
      const bolts = feat(c, 'brake-knee-L', 'hole', (q) => (q.to ?? []).some((t) => /^rail-/.test(t)));
      const corner = feat(c, 'brake-knee-L', 'outline', (q) => q.angleDeg !== undefined);
      const kneeFinal = c.cut().glueUps.find((q) => q.ids.includes('brake-knee-L'))?.finalText ?? 'its final size (cut list)';
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
      return {
        goal: rm ? 'Fit the brake knees to the rails dry (no glue) for the wheel dry fit, while the hull is upside down.' : 'Glue and bolt the brake knees to the rails now, while the hull is upside down.',
        items: [
          I('Do it now, not after the flip.', [
            rm ? 'The knees go on dry, held only by their bolts. They prove the holes and the fit, and come off again after the wheel dry fit to be finished.' : 'The knee legs are glued to bare oak: glue will not bond to varnish.',
            rm ? 'The nylock nuts sit on the stainless backing plates under the deck, behind the rail. They are easiest to reach now, while the hull is inverted.' : 'The nylock nuts sit on the stainless backing plates under the deck, reachable only while the hull is inverted.',
          ]),
          backers.length
            ? I(`Glue the backers (3/4" oak) to the rail inboard face and the deck underside, clear of the axle hanger: ${tl(backers.map((x) => x.id))}.`)
            : framed
              ? I('The backers went in with the frame glue-up and their bolt holes are drilled: only the knees go on here.', [], ['brake-backer-L', 'brake-backer-R'])
              : I('No backers in this model.'),
          I(`Start from the knee blocks you laminated in [[step:mill]] (cross-laminated, already milled to ${kneeFinal}, T \u00d7 W \u00d7 L): ${tl(knees)}.`, [
            'Do not glue anything up here: the layers, the grain directions, the joint position and the pocket notch are in [[step:mill]].',
            'Check each block before you saw: the grain of the rear and front layers runs up the leg, and the center layer runs across the sled.',
          ], knees),
          I('Cut ONE knee first and run the one-knee test (Verify).', ['Try it with the real pin and flap tongue; cut the other knee only when it passes.'], knees),
          I(`Shape each knee from its laminated block: ${tl(knees)}.`, [
            'Mark the outline with the knee router template (Forms section): tape it to the rear face of the block, bandsaw 1/16" outside the line, then flush-trim with a pattern bit. Turn the template over for the other knee.',
            `The knee is ${fin(kneeTall)} tall, with its top flat; the roof over the pocket is ${fin(c.p.brakeKneeRoofIn)} and the floor under it ${fin(c.p.brakeKneeFloorIn)}.`,
            cornerPts.length >= 2 && ang ? `Corner cut on the outboard edge: it starts ${cornerPts[0][1]}" below the top end, runs in at ${ang}° to ${cornerPts[1][0]}" from the edge at ${cornerPts[1][1]}" down, then straight to the bottom end.` : `Outline: ${SEE}.`,
            `Recess the pocket about ${fractionText(Math.round(intoFront * 16) / 16, 16)}" into the front layer, so it ends ${fin(pocketDeep)} from the rear face: router with a straight bit, or chisel. It is the same ${fin(pocketW)} wide and ${fin(pocketH)} high as the notch, open at the rear face and the outboard edge.`,
            `The ${fin(pkv.dia)} pin hole waits: it is drilled with the stainless strap on and the flap tongue clamped in the pocket (flap step).`,
          ]),
          ...(rm ? [
            I('Drill each knee leg on the drill press, from its layout.', [
              bolts ? `Holes in the knee, ${holeText(bolts)}.` : SEE_ITEM,
              'Lay the leg flat on the table and drill square to its face, measuring from the named edges.',
              `Offer the knee up to the rail with all ${bgk.bolts.count} bolts through it${kneeRear ? `: its rear face ${kneeRear} from the rail's rear end and its bottom edge level with the rail's bottom edge` : ''}.`,
              'If a bolt binds, open that knee hole a hair with the drill. Never open the rail\'s holes.',
            ], ['rail-L', 'rail-R']),
            I('Take the knees off and seal the bolt holes.', [
              'Brush epoxy into the bolt holes in the rail, the backer and the knee, with a small brush or a pipe cleaner.',
              'Let it cure, then run the bit through each hole once more so the bolts still slide in.',
            ], knees),
          ] : []),
          I(rm ? `Bolt each knee on, dry: ${boltTxt} bolts, 2 columns × 2 rows, through the knee leg and the rail into the backer.` : `Bolt each knee: ${boltTxt} bolts, 2 columns × 2 rows, through the knee leg and the rail into the backer.`, [
            ...(rm ? [] : [bolts ? `Holes in the knee, ${holeText(bolts)}.` : SEE_ITEM]),
            `Heads with a ${fin(c.p.brakeMountWasherOdIn)} washer under each on the outer face of the knee leg (no counterbore); nylock nuts on the backing plate set in the backer, under the deck.`,
            rm ? 'Check each plate is bedded flush in its recess and its 4 holes line up before the bolts go in.' : 'Check each plate lies flush in its recess and its 4 holes line up before the bolts go in.',
            rm ? `No glue on the leg. Hold each nut with the wrench from inside the frame (the nuts face up on the backing plate) and turn the bolt with the ratchet and the ${sock}" socket: ${kneeTighten(c.p)}. Go a little at a time, bolt to bolt in turn.` : 'Glue on the leg against the rail and chine outer face; clamp, bolt, wipe the squeeze-out.',
          ], ['rail-L', 'rail-R']),
          ...(rm ? [I('Mark each knee to its side with tape (L or R, and the bolt order), so it goes back where it came from.')] : [I('Leave the knees 24 h before the wheel dry fit (next step) loads them.')]),
        ],
        checks: rm
          ? ['Knee tops level with each other', 'Knee clears the tire front by the designed margin (check at the wheel dry fit)', 'Each knee seats flat on the rail and the chine band with no gap', 'Every nylock on and tightened to snug plus a quarter turn; the bolt holes sealed']
          : ['Knee tops level with each other', 'Knee clears the tire front by the designed margin (check at the wheel dry fit)', 'Every nylock on and snug; nothing on the knees varnished yet'],
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
      const drains = drainHoles(c.parts, c.p);
      const boxDrain = drains?.box && drains.box.host === 'deck' ? drains.box : null;
      // The rib knees' screw pilots in the hidden crossmember and king beam, from each member's own drawing (a feature per knee).
      const kneePilots = new Map<string, DrawingFeature[]>();
      for (const x of c.parts.filter((q) => /^side-rib-knee-L\d$/.test(q.id))) {
        const to = x.joints?.find((q) => q.type === 'screw')?.to;
        if (to && !kneePilots.has(to)) kneePilots.set(to, featsAll(c, to, 'hole', (q) => (q.to ?? []).some((t) => /^side-rib-knee-/.test(t))));
      }
      const pilotBit = bitOf(kneePilots.values().next().value?.[0], fin(SCREW_PILOT[8]));
      const pilotStack = Math.max(0, ...[...kneePilots.keys()].map((id) => { const m = c.by(id); if (!m) return 0; const b = worldAABB(m); return b.max[2] - b.min[2] + computeLayout(c.p).ply; }));
      return {
        goal: 'Dry-fit the wheels to prove the running gear, drill the last holes, then take everything metal off.',
        items: [
          I(`Put the ${plural(wheels.length, 'wheel')} on the axles.`, [`${fin(c.p.wheelBoreIn)} bore on the ${fin(c.p.axleDiameterIn)} ${axleWord(c.p)}, sealed bearings.`, `Washer and collar against the hub, cotter pin through the cross hole ${fin(c.p.axleCrossHoleFromEndIn)} in from the rod end.`], wheels.map((x) => x.id)),
          I(`Check the track: ${fin(c.p.frontTrackIn)} front, ${fin(c.p.rearTrackIn)} rear.`, ['Inflate to the squash-test pressure (Verify).']),
          I('Spin each wheel.', ['No rub on the beam end, the clamp plates or the brake knee.', isRemovable(c.p) ? 'Measure the knee-to-tire margin now, wheels on.' : 'Measure the knee-to-tire margin now, wheels on and knees cured.', 'No end float beyond 1/16".']),
          pilots
            ? I(`Drill the ${plural(pilots.total, 'stop-block screw pilot')} through the deck now, hull still inverted.`, [
              `Countersink them on the underside for the ${pilots.screw}" flat-heads, ${pilots.perBlock} a block, in line across the sled.`,
              `From the transom's outer face: ${list(pilots.xs)} forward, ${list(pilots.offCenter)} either side of the centerline.`,
              'The blocks are screwed on from below later, with the sled on its side.',
            ], ['seat-wedge-L', 'seat-wedge-R'])
            : I('No seat stop-block screws in this model.'),
          ...(kneePilots.size
            ? [I('Drill the rib-knee screw pilots now, straight through the crossmember and the deck, while the underside is in view.', [
              'Left end means the sled\'s left side, though the hull is upside down.',
              ...[...kneePilots].map(([id, fs]) => I(`On {{${id}}}: ${fs.map((q) => `${/-R\d$/.test((q.to ?? [])[0] ?? '') ? 'Right' : 'Left'} knee: ${q.positions!.map((t) => `one ${lc(t)}`).join('; ')}`).join('. ')}.`)),
              `Use a ${pilotBit} × 6" aircraft bit, square to the deck: a jobber bit's flutes are too short for about ${near8(pilotStack)} of oak and deck, and the bit would wander.`,
              'These holes are the screw pilots. They show on the deck top, so after the flip they find the hidden crossmember and king beam: the side ribs step sets the mid rib and each knee by them.',
            ])]
            : []),
          ...(boxDrain ? [I(`Drill the ${boxDrain.count} box drain holes through the deck now, hull still inverted: ${fin(boxDrain.diaIn)}, straight up through the deck from below.`, [
            `At the aft corners of the box: ${list(boxDrain.xs)} forward of the transom's outer face, ${list(boxDrain.offCenter)} either side of the centerline.`,
            `Drill a 1/8" pilot first, then the ${fin(boxDrain.diaIn)} brad-point bit with a light touch as it breaks through the top face; tear-out on the top face is inside the box and is sanded and filleted later.`,
            'Seal each bore now: tape the top-face mouth, brush epoxy up the bore with a small brush or a pipe cleaner (epoxy on the walls, not a plug), and let it cure.',
            `Run the ${fin(boxDrain.diaIn)} bit through again if the epoxy narrowed the hole, so no cut plywood edge is left bare and the hole is open.`,
          ], [boxDrain.host])] : []),
          ...(isRemovable(c.p) ? [I('Take the brake knees off too, now that the margin is measured.', [
            `Hold each nut with the wrench from inside the frame and back the bolts out with the ratchet and the ${wrenchFor(c.p.brakeMountBoltDiaIn)}" socket.`,
            'Thread the bolts, washers and nuts back into each knee, loosely.',
            'Bag each knee for the bench: it is finished with the flap kits and bolted on again at the hang step. The rail face under it is finished with the underside.',
          ], ['brake-knee-L', 'brake-knee-R'])] : []),
          I('Take the running gear OFF and bag the whole kit.', [
            'Wheels, axles, clamp plates, roll pads and eye bolts, with their bolts, washers, collars and cotter pins.',
            'Nothing metal stays on the underside: it is finished next, and the gear goes back on after the topcoat (hang step).',
          ]),
        ],
        checks: ['All four wheels spin freely and run true', 'Axles square: wheelbase measured on both sides within 1/8"', `Every bolt hole${kneePilots.size ? ', the rib-knee screw pilots' : ''} and the stop-block pilots drilled${boxDrain ? '; the box drain holes drilled, sealed and open' : ''}; the kit bagged and tagged`],
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
            ? I('Touch up the epoxy on the deck underside and the oak end grain (one coat; both were coated in [[step:seal]]), then urethane.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.'])
            : I('Touch up the epoxy seal on the deck underside (done in [[step:seal]]) and seal the rest of the underside (one saturation coat), then varnish.', ['3 coats on the show faces, 2 on the hidden ones, 320 between coats.']),
          I('Mask the bolt seats, the kingpin head and the hold-down angles.', [isRemovable(c.p) ? 'Keep the knee bolt holes open: run the drill through them if finish runs in. Leave the backing plates bare under the nuts.' : `Brush epoxy into the knee bolt holes. Keep finish off the spot for the pin hole${pinWhere ? ` (${pinWhere})` : ''}: it is drilled later, at [[step:brake-flaps]].`]),
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
    tools: ['wrenches', 'drill press', 'files'],
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
      return {
        goal: 'Shape the tongue, then bolt it to the front beam for good and set the bronze rope sleeve.',
        items: [
          I('Shape the {{bridle-tongue}} from its glued block first, before any bolt hole is drilled.', [
            `Trace the outline from the part drawing onto the block, with the grain running the length of the tongue: a T on edge, ${fin(c.p.tongueHeadWidthIn)} wide at the rear end for ${fin(c.p.tongueHeadLenIn)}, then a taper over the next ${fin(c.p.tongueHeadLenIn)} down to the ${fin(c.p.tongueWidthIn)}-wide stem, which runs${stemLen !== undefined ? ` ${fin(stemLen)}` : ''} to the tip.`,
            `Keep the rear face and the front face of the head square and flat out to ${fin(tongueSeatHalfWidth(c.p))} either side of the centerline: the beam bears on the rear face and the carriage-bolt heads seat on the front face.`,
            'Bandsaw the two stem curves a hair outside the line, then sand, rasp or spindle-sand to the line (the drawing gives the offsets).',
            `Round each inside shoulder, where the taper meets the head, with a ${fin(TONGUE_SHOULDER_FILLET_IN)} radius.`,
            `Ease every edge of the stem and the tip, about ${fin(c.p.roundoverIn)}; leave the head's rear and front faces square.`,
          ], ['bridle-tongue']),
          I(`Drill the ${fin(c.p.tongueHoleDiaIn)} sleeve hole across the stem now.`, [
            sleeve ? `${holeFromRear ? `${holeFromRear} from the rear end` : whereOf(sleeve)}${tip ? ` (${tip}" from the tip)` : ''}, through the ${fin(c.p.tongueWidthIn)} width of the stem, centered ${fin(depth / 2)} from the top edge.` : 'Near the tip, through the stem.',
            'Forstner bit on the drill press, the stem clamped square to the table with a scrap under it; drill from one side until the point comes through, finish from the other.',
          ], ['bridle-tongue']),
          I('Drill the {{bridle-tongue}} T head and the {{beam-F}} together for the two carriage bolts.', [
            boltT ? `In the tongue, ${holeText(boltT)}.` : SEE_ITEM,
            boltB ? `In the beam, ${holeText(boltB)}.` : false,
          ]),
          I(`Bolt the tongue on: two 3/8"${boltLen ? ` × ${boltLen}"` : ''} carriage bolts fore-aft through the T head and the whole beam.`, [
            `The front face of the T head is flat and square out past both bolt holes (the taper to the stem starts inside the bolt heads), so each domed carriage-bolt head sits flat on it. Keep the holes square to that face and ${fin(c.p.tongueHeadLenIn)} deep (the head's length).`,
            'Nylock nuts and fender washers on the rear face.',
            'The tongue is not removable: it stays on and is finished in place.',
          ]),
          I('Epoxy the bronze {{bridle-sleeve}} in the hole drilled across the stem.', [
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
    tools: ['bandsaw', 'spring clamps', 'epoxy pumps', 'drill press', 'drill', '3/8" Forstner or brad-point bit', 'straightedge'],
    hardener: '556',
    build: (c) => {
      const p = c.p, L = computeLayout(p);
      const sts = sideRibStations(p, L);
      const eighth = (v: number): string => fin(Math.round(v * 8) / 8);
      const fromTransom = (x: number): string => eighth(x - L.xRear);
      const name: Record<number, string> = { 1: 'Box rib', 2: 'Mid rib', 3: 'Bow post', 4: 'Rear rib' };
      const pair = (n: number): string => tl([`side-rib-L${n}`, `side-rib-R${n}`]);
      const kneePair = (n: number): string => tl([`side-rib-knee-L${n}`, `side-rib-knee-R${n}`]);
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
      const kneePairs = tl(knees.flatMap((st) => [`side-rib-knee-L${st.n}`, `side-rib-knee-R${st.n}`]));
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
        return `Each knee is centered on its rib shaft, and the two pilots in the deck set it (they must show in the middle of its clearance holes). Its screws land on the centerline of ${/^joist-/.test(st.member ?? '') ? '' : 'the '}{{${st.member}}}, ${fromTransom(memMid)} from the transom.`;
      };
      const ribFromPilots = (st: (typeof sts)[number]): string => {
        const cx = screwCx(st.n);
        if (cx === undefined || st.kind !== 'knee') return '';
        const off = st.x - cx;
        return Math.abs(off) < 1 / 16 ? ', in line with the screw pilots in the deck ([[step:gear-fit]])' : `, ${near8(Math.abs(off))} ${off > 0 ? 'ahead of' : 'behind'} the pair of screw pilots in the deck ([[step:gear-fit]]), measured along the sled`;
      };
      return {
        goal: 'Glue the side ribs and their knees inside the hull, now the deck is in. The D-ring and grab-board holes are the next step.',
        items: [
          ...(bowStation ? [I(`Before the bow posts are cut: sit a booted rider in the bare hull and confirm the bow-post station (${fromTransom(bowStation.x)} from the transom).`, ['His boots and knees must clear it. If they do not, move the station (Verify) before you cut anything.'])] : []),
          I('Bandsaw the ribs and knees from 4/4 offcuts planed to 3/4".', [
            ...sts.map((st) => `${pair(st.n)}${st.kind === 'box' ? ' (short: it starts at its box tie)' : ''}: ${ribDims(st)}.`),
            ...knees.map((st) => {
              const k = c.by(`side-rib-knee-L${st.n}`)?.stock;
              return `${kneePair(st.n)} (the ${name[st.n].toLowerCase()}'s knees): ${k ? `${fin(k.w)} along the deck, ${fin(k.l)} up the rib` : 'see the part drawing'}, ${fin(p.sideRibWidthIn)} thick.`;
            }),
            'Cut the top of each head to the sheer slope on its drawing. The D-ring holes are drilled in the next step, once the ribs have cured.',
          ]),
          I('Glue a band-strip filler to the web at each rib, between the inner chine band and the inner gunwale band.', [
            `Each is ${fin(fillerW)} wide, cut from a spare band strip (the same thickness as the bands, grain up) to fit the gap. Lengths: ${listS(sts.map((st) => `about ${roughFrac(filler(st))} at the ${name[st.n].toLowerCase()}`))}.`,
            `Centered on each rib station, which is measured from the transom's outer face: ${listS([...sts].sort((a, b) => a.x - b.x).map((st) => `${name[st.n].toLowerCase()} ${fromTransom(st.x)}`))}. The same on both sides.`,
            'Epoxy to the web; the filler face must end flush with the band faces (check with a straightedge).',
          ]),
          I('Epoxy each rib to the inner bands and its filler, full face.', [
            ...sts.map((st) => {
              const zFoot = st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop;
              const turn = Math.round((Math.atan(st.dTurn) * 180) / Math.PI);
              return `${pair(st.n)}: shaft centered ${fromTransom(st.x)} from the transom${ribFromPilots(st)}${st.kind === 'box' ? `, its foot ${eighth(zFoot - L.deckTop)} above the deck (the box tie is its base)` : `, foot on the deck`}${turn >= 2 ? `. The side angles in about ${turn}° here: stand the rib square to the side` : ''}.`;
            }),
            'Head against the inner gunwale band, its top flush with the gunwale top; foot against the inner chine band; thickened epoxy takes up any gap.',
            'Hold each pair with a spreader stick across the hull (padded ends, wedged snug). Add a small fillet at the deck.',
            'Wipe the squeeze-out now. The back face is glued, so it takes no finish.',
          ]),
          ...(knees.length ? [
            I(`Drill each rib knee first, on the drill press: ${kneePairs}.`, [
              `Screws ${listS(ks.d.map((d) => fin(d)))} from the outboard edge (the edge that goes against the rib), centered across the thickness.`,
              `Counterbore each from the sloped face first, ${cbWide} wide, leaving ${fin(KNEE_SCREW_SEAT_IN)} of oak under the head. Depths from the sloped face: ${listS(knees.map((st) => `${cbDepths(st)} at the ${name[st.n].toLowerCase()}`))}.`,
              `Then the ${clearDia} clearance hole through the knee, square to the foot.`,
            ]),
            I('Dry-place each knee by the screw pilots, then open the deck pilots.', [
              ...knees.map((st) => `${kneePair(st.n)}: foot on the deck against the rib's inboard face. ${kneeWhere(st)}`),
              'Mark the knee outline on the deck, then lift the knee off.',
              `Open each pilot in the deck from the deck top to ${clearDia}, with a depth stop at the deck's thickness (${fin(L.ply)}): the pilot guides the bit, and the screw must pull the knee down on the deck. The pilot in the member stays as it is.`,
            ]),
            I('Glue each knee to its rib and the deck, then drive the screws.', [
              'Epoxy the tall leg to the inboard face of the rib and the foot to the deck, with a small fillet.',
              `Set the knee back over its holes and drive ${ks.d.length} stainless ${screwText(ks.fit)}" screws down through it, the deck and into the member. They pull the knee down on the deck while the epoxy is wet.`,
              'Wipe the squeeze-out and the dust from the counterbores.',
            ]),
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
    steps: [STEP.seatStorage],
    view: 'side',
    tools: ['drill', 'drill press', 'cobalt bit', 'hex keys', 'wrenches', 'clamps', 'scrap blocks', 'small brush'],
    hardener: '556',
    glueLine: 'Epoxy: no load on the grab boards until cured',
    build: (c) => {
      const p = c.p, L = computeLayout(p);
      const lashIds = c.parts.filter((x) => /^lash-/.test(x.id)).map((x) => x.id);
      const gripIds = c.parts.filter((x) => /^seat-grip-[LR]$/.test(x.id)).map((x) => x.id);
      const gripBack = c.parts.filter((x) => /^seat-grip-(backing|cap)/.test(x.id)).map((x) => x.id);
      const lashBit = `${fractionText(Math.round((LASH_BOLT_DIA_IN + 1 / 64) * 64) / 64, 64)}"`;
      const web0 = c.by('side-L-web') ? worldAABB(c.by('side-L-web')!).min[0] : L.xSideStart;
      const gripPlace = c.by('seat-grip-L') ? (() => { const b = worldAABB(c.by('seat-grip-L')!); return { from: near16(b.min[0] - web0), to: near16(b.max[0] - web0) }; })() : undefined;
      return {
        goal: 'Drill the D-ring holes through the sides now, and fit the grab boards for good, while every face is bare.',
        items: [
          I('Wait until the ribs and knees have cured (the next day). Nothing here is drilled through a finished face.'),
          ...(lashIds.length ? [I(`D-ring brackets: ${tl(lashIds)}.`, [
            `Hold each bracket on the inner face of its rib head, centered on the head and on its mid height. Check its two holes first (Verify): the model assumes ${fin(2 * LASH_HOLE_DX_IN)} between them, along the gunwale. The bracket is the template.`,
            'Clamp a scrap block on the outside of the side behind the holes, to stop tear-out.',
            `Drill both holes through the bracket, the head, the inner band, the web and the outer band in one pass with a ${lashBit} bit, square to the side.`,
            'Brush epoxy into each hole to seal the plies of the web, let it cure, then run the bit through again so the bolts slide in.',
            'Number each bracket to its rib. They are bolted on after the finish (final fit step).',
          ], lashIds)] : []),
          ...(gripIds.length ? [I(`Grab boards: ${tl(gripIds)}, with their strips and caps (${tl(gripBack)}). They go on for good now, before the finish.`, [
            gripPlace ? `Each board lies on the inner gunwale band, from ${gripPlace.from} to ${gripPlace.to} from the rear end of the side.` : 'Each board lies on the inner gunwale band at its place on the drawing.',
            `Drill: clamp each board in place with its stainless strip on the outside face and drill through the board, the inner band, the web, the outer band and the strip with one 9/32" bit, square to the side. The five hole positions are on the board and band drawings: three in an upper row ${fractionText(GRIP_BOLT_ROWS_IN[0], 16)}" below the gunwale top and two in a lower row ${fractionText(GRIP_BOLT_ROWS_IN[1], 16)}" below it, between the upper ones. Use a cobalt bit and cutting oil for the stainless. Mark the strip and board to their side.`,
            'Seal: take everything apart. Brush epoxy into the holes in the web and onto the back of each board and the band face under it. Leave the outer band face bare where the strip and cap will sit, so the glue bites.',
            'Strip: epoxy each strip to the outer band, holes lined up (push a 9/32" rod through each hole while it cures).',
            'Bolt: set each board, push the screws through from the outside, and tighten the nylock nuts (1-1/2" fender washers under the upper three, 7/8" under the lower two). The heads sit on the strip. Nothing can be tightened after the cap is on, so check every nut.',
            'Cap: dry-fit each oak cap over the strip and the heads (its recesses fit over them), then epoxy it to the outer band, clamp it with a caul on its face, and wipe off the squeeze-out. Keep the heads\' hex sockets clear.',
            'No load on a board until the epoxy has cured.',
          ], [...gripIds, ...gripBack])] : []),
        ],
        checks: ['D-ring holes drilled square, with no tear-out on the outside face', 'Every bracket numbered to its rib', 'Each grab board tight against the band, each cap tight to the band with no gap at its ends'],
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
    hardener: '556',
    build: (c) => {
      const walls = c.mine.filter((x) => /^storage-(side|end)-/.test(x.id)).map((x) => x.id);
      const coam = c.mine.filter((x) => /coaming/.test(x.id)).map((x) => x.id);
      const hb = c.mine.filter((x) => /hinge-backer/.test(x.id)).map((x) => x.id);
      const lb = c.mine.filter((x) => /latch-block/.test(x.id)).map((x) => x.id);
      const drains = drainHoles(c.parts, c.p);
      const dia = drains?.box ? fin(drains.box.diaIn) : fin(c.p.storageDrainDiaIn);
      return {
        goal: 'Build the storage box on the deck: walls, coaming, hinge backers and latch blocks.',
        items: [
          // A drain through the deck was drilled and sealed with the hull inverted (the dry-fit step); only a raised box's own floor panel is drilled here.
          ...(drains?.box && drains.box.host !== 'deck' ? [I(`Before the walls go on, drill the ${drains.box.count} box drain holes through the floor panel of the box: ${dia}, straight down.`, [
            `At the aft corners of the box: ${list(drains.box.xs)} forward of the transom's outer face, ${list(drains.box.offCenter)} either side of the centerline.`,
            'Use a sharp brad-point bit and a light touch as it breaks through the underside.',
            'Brush epoxy into each bore, so no cut plywood edge is bare. Run the bit through again once it cures if it narrowed the hole.',
          ], [drains.box.host])] : []),
          I('Bevel the wall edges at 45° on the table saw.', ['Tape the outside seams and fold the box up.', 'Inside each corner: a 3/8" epoxy fillet and 2" glass tape (no spline).'], walls),
          I('Stand the walls on the sealed deck: the deck is the floor.', ['Fillet inside and bead outside, so no ply edge is exposed.']),
          ...(c.mine.some((x) => /^box-tie-/.test(x.id)) ? [(() => {
            const L2 = computeLayout(c.p), st = sideRibStations(c.p, L2)[0];
            const g = boxTieGeometry(c.p, L2, st);
            const ties = c.mine.filter((x) => /^box-tie-/.test(x.id)).map((x) => x.id);
            return I(`Epoxy a box tie between each box or rear rib and the box side: ${tl(ties)}.`, [
              `Each tie is centered on its rib: the box ribs ${fin(c.p.sideRibBoxInsetIn)} behind the front end of the box, the rear ribs ${fin(c.p.sideRibRearInsetIn)} ahead of its aft end. ${fin(g.z0 - L2.deckTop)} to ${fin(g.z1 - L2.deckTop)} above the deck, grain up.`,
              'Tap each tie into the gap from above on thickened epoxy, on both faces: to the box side and to the rib. The epoxy takes up the fit.',
              'The top stands 1/8" under the coaming, so the tie is never glued to the lid frame, which moves.',
            ]);
          })()] : []),
          I('Glue the oak coaming to the wall tops, butt corners.', ['Clamp it with cauls.', 'Round the inboard top edge 1/8".', 'The gasket and lid sit on oak, never on a ply edge.'], coam),
          I(`Glue the hinge backers inside the fore end: ${tl(hb)}.`, [I(`Latch blocks (grain vertical) on the inside of the transom: ${tl(lb)}.`)]),
          I(isStandard(c.p) ? `Fair the deck inside the box with epoxy thickened with ${EPOXY_SYSTEM.thickener} (or ${EPOXY_SYSTEM.colorMatch}, which sands easier).` : 'Fair the deck inside the box with microballoon-thickened epoxy (the low-density filler in the parts list).', [drains?.box ? 'Fall about 1/8" toward each aft drain hole; keep the holes open.' : 'Fall about 1/8" toward each aft drain; the drain nipples go in at the final fit.']),
        ],
        checks: ['Box square, fillets continuous', 'Coaming flat across all four walls (gasket seat)', drains?.box ? 'Drain holes open, floor falls toward them' : 'Drain falls toward the corners'],
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
      const stayPart = c.by('storage-lid-stay');
      const stayBacker = feat(c, 'storage-hinge-backer-L', 'hole', (q) => (q.to ?? []).includes('storage-lid-stay'));
      const stayLid = feat(c, 'storage-rim-end-fore', 'hole', (q) => (q.to ?? []).includes('storage-lid-stay'));
      const stayWord = isStandard(c.p) ? '6" lid support' : 'friction stay';
      const stayName = isStandard(c.p) ? 'lid support' : 'friction stay';
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
          I(`The lid is engraved DO NOT STEP in the finishing schedule (step ${stepNo(c, 'engrave')}), before the topcoat.`, ['It is a lid to sit a cushion on, not a step.']),
          I('Fit and drill the hinges, then take them off.', [
            `Pilots for ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} into the lid frame, ${screwOf(c, 'storage-hinge-L', /hinge-backer/)} through the end panel into the backers.`,
            'The hinges go on after the finish; the gasket goes in at the final fit.',
          ], ['storage-hinge-L', 'storage-hinge-R']),
          ...(stayPart ? [I(`Fit and drill the ${stayWord}, then take it off.`, [
            `The ${stayName} lives inside the box on the left side, holding the lid open. Hold the lid open at about 75° to find where its two ends land.`,
            `Screws: ${screwOf(c, 'storage-lid-stay', /hinge-backer/)} at the base and ${screwOf(c, 'storage-lid-stay', /rim-end-fore/)} at the arm end, each in a 1/8" pilot.`,
            stayBacker?.positions?.length ? `Its base on the left hinge backer: ${stayBacker.count} holes, ${stayBacker.size}, in the ${lc(stayBacker.face ?? 'inboard end')}: ${stayBacker.positions.map(lc).join('; ')}.` : `Pilots in the left hinge backer: ${SEE}.`,
            stayLid?.positions?.length ? `Its arm end on the lid frame: ${stayLid.count} holes, ${stayLid.size}, in the ${lc(stayLid.face ?? 'bottom face')}: ${stayLid.positions.map(lc).join('; ')}. They sit in the middle of the ${fin(c.p.storageLidRimWidthIn)} frame piece, so each pilot keeps ${fin((c.p.storageLidRimWidthIn - 1 / 8) / 2)} of oak on both sides.` : `Pilots in the lid frame: ${SEE}.`,
            'Check the real bracket and arm against these pilots before drilling (Verify); move a pilot to suit the real holes if it differs.',
            `The ${stayName} goes on after the finish (final fit).`,
          ], ['storage-lid-stay'])] : []),
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
            'Tape the lid-hinge leaves to the box end as spacers, with packing tape over them so the epoxy cannot bond them.',
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
    title: 'Seat back, hinges, pins and pads',
    kind: 'build',
    steps: [STEP.seatStorage],
    view: 'side',
    tools: ['drill press with stop', 'hex key', 'iron (veneer edge)', 'router'],
    hardener: '556',
    build: (c) => {
      const pad = feat(c, 'seat-hinge-backer-L', 'hole', /pilot/);
      const pin = feat(c, 'seat-hinge-backer-L', 'hole', (q) => /deep/.test(q.size ?? '') && !/pilot/.test(q.size ?? ''));
      const eva = evaPads(c);
      return {
        goal: 'Make the seat back and fit its hinges, pins and the two foam pads (the hardware goes on for good after the finish).',
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
          ...(eva ? [I(`Make the seat cushion and the back pad from three ${eva.padText} kneeling pads.`, [
            I(`Make the {{seat-cushion}}, ${eva.cushionText}, from two pads.`, [
              `Use one whole pad, and cut a ${eva.stripCutText} wide strip, the full ${eva.widthText} long, from the second pad (a sharp utility knife and a straightedge, cut square).`,
              'Brush contact cement on the strip edge and on the whole pad\'s matching edge. Let it get tacky, then press the strip on, edge to edge, ends flush.',
              `Trim the glued cushion to ${eva.cushionText}. The seam is across the cushion, at the rear.`,
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
    view: 'side',
    tools: ['Shaper Origin', 'bandsaw', 'drill press', 'router (1/4" roundover)', 'contact cement'],
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
      return {
        goal: 'Make the two brake flaps with their shoes, pads, return cords and chocks, as removable kits.',
        items: [
          I('Take the flaps cut in [[step:shaper]] ({{brake-flap-L}} and {{brake-flap-R}}) and finish shaping them.', [
            `Round every edge over with a 1/4" roundover bit (the oak is ${fin(c.by('brake-flap-L')?.stock?.t ?? 0.875)} thick).`,
            'Epoxy-seal before the finish.',
            ...(isRemovable(c.p) ? ['The knees are off the sled by now (taken off after the wheel dry fit): fit the straps and the flaps on the bench.'] : []),
          ]),
          I('Make the two pivot straps: {{brake-strap-L}} and {{brake-strap-R}}.', [
            strapRow ? `Stock: ${strapRow.section}. Cut each ${fin(strapRow.cutLengthIn)} long on the metal bandsaw, then deburr every cut edge (the cut list has the sizes).` : 'Stock and length: the cut list. Cut on the metal bandsaw, then deburr every cut edge.',
            strapScrewHoles ? `Drill on the drill press: ${strapScrewHoles}.` : 'Drill the screw holes on the drill press, from the strap drawing.',
            strapPinHole ? `Then the pin hole: ${strapPinHole}.` : 'Then the pin hole, from the strap drawing.',
            'Cut, deburr and drill only: nothing else is done to the metal.',
          ]),
          I('Screw a strap to each knee, across the open side of the pocket: {{brake-strap-L}} and {{brake-strap-R}}.', [
            `Each strap takes ${strapScrews} stainless pan-head wood screws: ${strapRows}. They go into the side grain of the rear and front layers.`,
            'Lay the strap on the knee\'s outboard edge, its rear edge flush with the knee\'s rear face, and mark each screw through its hole.',
            `Drill ${strapPilot ?? '1/8" pilots'}, one at each mark.`,
            isRemovable(c.p) ? 'Screw the strap on dry for now. It comes off for the bench finish and goes back on at the hang step, with a drop of epoxy in each pilot.' : 'A drop of epoxy in each pilot before its screw.',
            'Pan heads sit on the strap: it is not countersunk.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Fit a pivot block on each flap tongue: {{brake-pivot-block-L}} and {{brake-pivot-block-R}}.', [
            `Glue and 3 × ${screwOf(c, 'brake-pivot-block-L', /brake-flap/)} flat-head screws; clamp it while the glue sets.`,
            `Clamp the tongue and block in the knee's pocket, then drill the pin hole in one pass with one ${fin(bgs.strap.pinHole)} bit: through the strap's hole, the block and the tongue, and ${fin(bgs.pivot.blind)} blind into the inboard wall of the pocket.`,
            'Brush epoxy into the blind hole, then fit the clevis pin through the strap, the block and the tongue (double shear) and the hitch-pin clip in its cross hole, outboard of the strap.',
          ]),
          I('Make the shoes: {{brake-shoe-L}} and {{brake-shoe-R}}.', [
            'Bandsaw from the blank: the top follows the 6° flap underside, the bottom is cut to the tire radius.',
            'Leave the bottom a little long. It is fitted to the tire at the hang step, with the wheel on, before the pad goes on.',
            `Glue and 2 × ${screwOf(c, 'brake-shoe-L', /brake-flap/)} screws up into the flap (all the brake's wood screws are one size).`,
          ]),
          I('Dry-fit the pads and treads: they go on for good at the hang step.', [
            `Pad: 3" × 3" rubber, contact cement and 2 × ${screwOf(c, 'brake-pad-L', /brake-shoe/)} flat-heads buried 1/8", 1/2" off the shoe screws.`,
            'Foot tread: 4" × 2-1/2" ribbed rubber, contact cement.',
          ], ['brake-pad-L', 'brake-pad-R', 'brake-foot-tread-L', 'brake-foot-tread-R']),
          I('Make the return cords.', ['1/4" shock cord with a 3/16" stop cord tied taut at the released length, 9" between the eyes.', 'Snap hook to the transom eye (backer behind it); #10 screw eye in the flap\'s rear end face.'], ['brake-cord-L', 'brake-cord-R']),
          I('Make the chocks: {{brake-chock-L}} and {{brake-chock-R}}.', [
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
    hardener: '556',
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
            `At the hang step: ${socketBed(c.p)}, ${socketScrewText(c.parts)} per socket into the T-nuts, a nylon washer under each head. No wrench reaches behind the box.`,
            'Anodized or epoxy-coated aluminum only (bare aluminum corrodes against wet oak); touch up any bare edge.',
          ]),
          I('Make the posts: {{handle-post-L}} and {{handle-post-R}}.', [
            'Slip fit in the sockets; a 1/2" × 3/16" relief groove down the transom-side face.',
            `Tops sawn to the bow slope${ang ? ` (${ang}°)` : ''}.`,
            crossAt ? `Clevis-pin hole across, ${fin(Number(crossAt))} above the socket bottom.` : false,
          ]),
          I('Make the {{handle-bar}} from its glued block (step 1), edge bandsawn to the arc of the crown template.', [
            'It is a glued block of two layers, so lay the arc out in the plane of the glue line: the glue line then runs through the middle of the bar\'s depth along its whole length, never along an edge.',
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
    hardener: '556',
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
    title: 'Finish: epoxy, engrave, topcoat',
    retitle: (p) => (isStandard(p) ? undefined : 'Finish: stain, epoxy, engrave, topcoat'),
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
            ? I('Show faces: no stain. Raise the grain once, then the clear urethane, once the offcut panel passed.', ['The deck underside, the end grain and the uncaptured ply edges were epoxied at assembly.'])
            : I('Show faces: stained first, then epoxy-sealed, once the offcut panel passed.', ['The dados, edges and hidden faces were sealed at assembly. Water-based dye under the epoxy is the safe route.']),
          I(isRemovable(c.p) ? 'Finish the removable kits on the bench: the brake knees with their flaps and chocks, the handle U and the signs.' : 'Finish the removable kits on the bench: the brake flaps and chocks, the handle U and the signs.', [
            'The tongue and the grab boards (with their caps) are NOT removable: they stay on and are finished in place, with the screw nuts and washers masked.',
            'Plug or mask the pivot bores, bolt seats and sockets.',
            'Grab boards: epoxy each stainless strip into the 1/8" pocket on the back of its oak cap, with the screw holes lined up (push a 9/32" rod or waxed screw through each pair of holes while the epoxy cures) and the strip flush with the cap\'s back. Let it cure before you finish the cap with the board. Keep finish off the strip\'s back, which beds on the band.',
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
    tools: ['wrenches', 'torque wrench', 'cotter-pin pliers', 'screwdrivers', 'hex keys', 'sealant gun', 'contact cement'],
    retools: (p) => ['wrenches', ...(isRemovable(p) ? ['torque wrench'] : []), 'cotter-pin pliers', 'screwdrivers', 'hex keys', isStandard(p) ? 'epoxy pumps' : 'sealant gun', 'contact cement'], // only the removable knees have a torque to set (D-78); the clamp plates go snug plus a quarter turn; Standard beds in epoxy
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
            `Axles in their grooves; ${plural(n(/^clamp-/), 'clamp plate')} with nylock nuts and fender washers, snug plus a quarter turn.`,
            `${plural(n(/^wheel-/), 'wheel')}, collars and cotter pins (the cross hole ${fin(c.p.axleCrossHoleFromEndIn)} in from each rod end).`,
            `Roll pads shimmed ${fin(c.p.axleProudIn)} off the beam.`,
          ], [...ids(/^(axle-|clamp-|wheel-|roll-pad-)/)]),
          I('Steering.', [
            `${plural(n(/^steer-eye/), 'eye bolt')} and ${plural(n(/^steer-anchor/), 'anchor')}, nylock nuts and 2" washers.`,
            'Check chains: 8-7/8" between rings; straight ahead each hangs 2-11/16" slack and goes taut at the lock.',
            'Bridle rope through the sleeve, once round the tongue tip, bowline round the standing part; whip the end.',
          ], ids(/^(steer-|bridle$)/)),
          I('Hinges, pins and pads.', [
            `Seat hinges: #10-32 × 3/8 from the front face of the seat back, through the leaf into the inserts, ${screwOf(c, 'seat-hinge-L', /hinge-backer/)} through the deck into the backer pads.`,
            `Lid hinges: ${screwOf(c, 'storage-hinge-L', /rim-end-fore/)} into the lid frame, ${screwOf(c, 'storage-hinge-L', /hinge-backer/)} into the backers.`,
            'Detent pins on lanyards; the seat cushion and the back pad on their hook-and-loop strips.',
          ], ids(/^(seat-|storage-hinge)/)),
          I(`Handle: ${plural(n(/^handle-socket/), 'socket')} ${socketBed(c.p)} on the transom.`, [
            `${socketScrewText(c.parts)} per socket into the T-nuts, nylon washers under the heads.`,
            'The screw tips must stop short of the box aft wall: check with a dry screw.',
            'Then the finished U and its clevis pins.',
          ], ids(/^handle-/)),
          ...(isRemovable(c.p) ? [I('Brake knees, from the bench.', [
            `Screw each strap back on its knee, ${strapCount} screws with a drop of epoxy in each pilot (the pilots are drilled already).`,
            'Wipe the finished faces of the knee and the rail. No glue: the knee goes on dry.',
            'Smear a little anti-seize on the bolt threads.',
            'Hang the knee on one bolt first: put a bottom rear bolt through the knee and the rail and start its nut on the backing plate, so the knee hangs there while you fit the other three. One person can do it.',
            `Washer under each head. Hold each nut with the wrench from under the deck, behind the rail (angle the wrench handle down and inboard), and turn the bolt with the ratchet and the ${wrenchFor(c.p.brakeMountBoltDiaIn)}" socket: ${kneeTighten(c.p)}. Go bolt to bolt in turn.`,
            'Check the bolts for snug before each outing, and retighten every bolt after the first outing.',
          ], ['brake-knee-L', 'brake-knee-R'])] : []),
          I('Brake flaps.', [
            'The flap kits on the knees: pivot pin through the strap in double shear, hitch-pin clip outboard of the strap.',
            'Fit each shoe to its tire with the wheel on: scribe the tire radius on the shoe, trim it to the line, then fit the pad.',
            'Return cord and snap hook to the transom eye; pad and tread on contact cement; chock cords to the screw eyes, each with a drop of epoxy in its pilot.',
          ], ids(/^brake-/)),
          I('Recheck every nut before each event: oak creeps under the plates.'),
        ],
        checks: ['All four wheels spin freely, no end float beyond 1/16", the axle swings through the full lock', 'Chain goes taut at full lock before the tire touches anything', 'Hinges and pins work, the handle slides in the sockets, the flaps return by themselves'],
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
      const stay = c.parts.find((x) => x.id === 'storage-lid-stay');
      const nipples = c.parts.some((x) => /^storage-drain-/.test(x.id));
      // The D-rings are drilled at the side-holes step (so no hole is drilled through a finished face); here they are only bolted on. The grab boards were fitted for good at that step.
      const every = (re: RegExp): string[] => c.parts.filter((x) => re.test(x.id)).map((x) => x.id);
      const lash = lashBoltLength(c.p);
      return {
        goal: 'Bolt on the last fittings: signs, storage hardware, D-rings, lights and reflectors.',
        items: [
          I(`Hang the signs (${tl(ids(/^sign-[LR]$/))}): 4 thumb-knob screws each (${knobText(c)}).`, ['Through the 3/16" holes, the standoff discs (epoxied to the sign back) and the web, into the inserts.']),
          I('Storage hardware.', [
            'Gaskets: continuous EPDM bulb, spliced at one corner.',
            stay ? (isStandard(c.p) ? 'Lid support: the 6" support, its base on the left hinge backer and its arm end under the lid frame, on the pilots drilled at the lid. It folds flat when the lid shuts.' : 'Lid stay: the stainless friction stay, its base on the left hinge backer and its arm end under the lid frame, on the pilots drilled at the lid. It folds flat when the lid shuts.') : false,
            'Draw latches on the transom blocks, catch plates.',
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
        checks: [`Load test: ${c.p.lashLoadLbf} lbf pull at ${c.p.lashPullAngleDeg}° on one D-ring (its working load); hang the sled by the bowline`, 'Grab boards solid; signs stay on and do not rattle', `Lid closes on the gasket with no gap; the ${isStandard(c.p) ? 'lid support' : 'stay'} holds`],
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
          I('Gather the tools from the pouch.', [`The 3/8" drive ratchet, the ${hexAf}" socket and the ${hexAf}" combination wrench.`, 'The spare lock nuts and the anti-seize are in it too.']),
          I('REMOVAL: take one knee off at a time, {{brake-knee-L}} then {{brake-knee-R}}.', [
            'Work on a hard floor, not in snow: you lie beside the sled.',
            'Unhook the return cord at the transom. Leave the chock tied to its cord and to the eye under the knee: it comes off with the knee.',
            `Lie beside the sled and reach in under the deck, behind the rail, between the two crossmembers just ahead of the rear wheel. The nuts sit on the ${nutPlate} there. Angle the wrench handle down and inboard.`,
            `Hold each nut with the wrench and back the bolt out with the ratchet and the ${hexAf}" socket from the outer face of the knee. Take ${n - 1} bolts out, then hold the knee and take out the last one.`,
            'Lift the knee off the rail with the flap still on it, as one piece.',
            'Thread the bolts, washers and nuts back into the knee loosely, so none is lost.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Stow them.', ['For cargo use the knees stay off the sled, at home or in the truck, each wrapped so it does not mark the paint.', 'The rail keeps its open bolt holes; the backer and the backing plate bedded in its recess stay on.']),
          I('REFIT: put the knee back where it came from, left or right as taped.', [
            'Wipe the rail and chine face and the inboard face of the knee leg. Both are finished, so no glue goes on: the knee goes on dry.',
            'Smear a little anti-seize on the bolt threads.',
            `Hang the knee on one bolt first: put a bottom rear bolt through the knee and the rail and start its nut on the plate, so the knee hangs there and one person can fit the other ${n - 1}.`,
            `Fit the other ${n - 1} bolts with a washer under each head, through the knee, the rail and the backer.`,
            `Hold each nut with the wrench from under the deck, behind the rail (handle down and inboard), and turn the bolt with the ratchet: ${kneeTighten(c.p)}. Go bolt to bolt in turn.`,
            'Hook the return cord at the transom.',
            'Check the bolts for snug before each outing, and retighten every bolt after the first outing.',
          ], ['brake-knee-L', 'brake-knee-R']),
          I('Replace the lock nuts after about five removals.', ['The nylon wears. Spares ride in the tool pouch.']),
          I('For the truck, take the knees off with the flaps.', ['Nothing then stands out beside the tires.', 'The backers, the backing plates and the open bolt holes in the rails stay.']),
        ],
        checks: ['Each knee seats flat on the rail and the chine band: a slip of paper does not enter the joint line', `All ${n} bolts tightened and every nut on its backing plate`, 'The chock cord eye is solid; the first brake test shows no wobble'],
      };
    },
  },
];

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
    const clampCure = t.hardener ? (t.reglue?.(p) ?? t.glueLine ?? glueLine(t.hardener, use, cardStep, t.coat)) : undefined;
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
