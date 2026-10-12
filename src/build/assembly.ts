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
 * FINISH AFTER HARDWARE (build review round 1, MUST-1). The running gear, eye bolts, hinges, handle sockets and the brake kit are FITTED AND DRILLED at their own
 * steps (dry, then taken off), the hull is finished (underside before the flip, the rest after the box, seat, brake and handle), and `hang` installs them after the
 * varnish has cured. The parts in `isHangPart` therefore belong to the `hang` step, not to the step that fits them, so the step-through viewer shows them on the sled only
 * once they are really on it. The `hang` step's `modelStep` is clamped up to the finish step (the list stays nondecreasing); every other part is installed in its own model step.
 * The tongue, the beams, the kingpin and the hold-downs stay on the hull and are finished in place (D-65: the tongue is not removable).
 */
import { HULL_STEP, STEP } from '../model/build-utils';
import { computeLayout, outerHalfWidth, samples, sideTopAt } from '../model/layout';
import type { AssemblyStep, Joint, Part } from '../model/types';
import { bowTaper, type Params } from '../params';
import { boardForThickness, cutList, type ResawPool } from './cutlist';
import { epoxyTimeFactor, finishAreas, finishingSchedule } from './finishing';
import { formDrawings, RIB_STOCK_IN, type FormDrawing } from './forms';
import { oakBoardFeet, type OakPlan } from './nesting';
import { verifyChecklist } from './verify';

export type StepKind = 'prep' | 'build' | 'process';
export type Hardener = '205' | '206' | '209';
export type StepView = NonNullable<AssemblyStep['view']>;

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
}

/**
 * Removable hardware that is fitted and drilled where it belongs, taken off for finishing and installed in the `hang` step: wheels, axles, clamp plates, roll pads, eye bolts,
 * anchors, check chains and the bridle rope; hinges, pins and cushions; handle sockets and pins; the brake flap's pin, clip, cord, snap, pad and tread.
 * Only purchased, metal and printed parts qualify: every wood part, the beams, the hold-downs, the kingpin and the sleeve stay on the hull.
 */
const HANG_RE = /^(wheel-|axle-(R|F[LR])$|clamp-|roll-pad-|steer-(eye|anchor|chain)-|bridle$|seat-(hinge|pin|cushion|back-pad)|storage-hinge-[LR]$|handle-(socket|pin)-|brake-(pivot-pin|pivot-clip|cord|snap|pad|foot-tread|chock-cord))/;
export const isHangPart = (x: Part): boolean => (x.kind === 'purchased' || x.kind === 'metal' || x.kind === 'printed') && HANG_RE.test(x.id);


interface Template {
  id: string;
  title: string;
  kind: StepKind;
  /** Model steps whose parts this template may take (first entry is the step's modelStep). */
  steps: number[];
  match?: RegExp;
  view: StepView;
  tools: string[];
  /** Cure used for the clampCure text, and the clamp description. */
  hardener?: Hardener;
  clamp?: string;
  build: (c: StepCtx) => { instructions: string[]; checks: string[] };
}

// ---- helpers ----

const f = (n: number, d = 2): string => String(+n.toFixed(d));
const inch = (n: number, d = 3): string => `${f(n, d)}"`;

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

/** "4×20 ×18, 5×30 ×8" */
function dominoText(c: StepCtx, maxStep = Infinity): string {
  const t = jointTally(c.parts, new Set(c.mine.map((x) => x.id)), 'domino', dominoKey, maxStep);
  return [...t.entries()].map(([k, n]) => `${k} ×${n}`).join(', ');
}

/** Total of one joint type touching the step's parts, with the mating part listed on one side only counted once. */
function count(c: StepCtx, type: Joint['type']): number {
  return [...jointTally(c.parts, new Set(c.mine.map((x) => x.id)), type, () => '').values()].reduce((s, n) => s + n, 0);
}

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

const roughSize = (x: Part | undefined): string => (x?.rough ? `${inch(x.rough.t)} × ${inch(x.rough.w)} × ${inch(x.rough.l, 2)}` : sizeOf(x));
const sizeOf = (x: Part | undefined): string => (x?.stock ? `${inch(x.stock.t)} × ${inch(x.stock.w)} × ${inch(x.stock.l, 2)}` : '');

/** Epoxy cure text at 70 °F and at 60 °F (winter shop). */
export function cureText(h: Hardener, clamp: string): string {
  const c = HARDENERS[h];
  const k = epoxyTimeFactor(60);
  const r = (lo: number, hi: number): string => `${f(lo * k, 0)}-${f(hi * k, 0)}`;
  return (
    `${clamp} West 105/${c.label}: pot life ${c.potMin[0]}-${c.potMin[1]} min at 70 °F (mix in small batches, pour thin in a tray), clamp ${c.clampHours[0]}-${c.clampHours[1]} h, ` +
    `full cure ${c.fullHours} h+. Winter shop at 60 °F: pot ${r(...c.potMin)} min, clamp ${r(...c.clampHours)} h; below 55 °F it will not cure.`
  );
}

// ---- text helpers for the plan-driven steps ----

/** Rough thickness of a part: its `rough`, or finished + the milling allowance. */
const roughT = (x: Part, p: Params): number => x.rough?.t ?? (x.stock ? x.stock.t + p.millingAllowanceIn : 0);

function poolOf(c: StepCtx, x: Part | undefined): ResawPool | undefined {
  if (!x) return undefined;
  const t = roughT(x, c.p);
  return c.resaw().find((q) => Math.abs(q.roughT - t) < 0.002);
}

/** "resawn from 6/4 (...). Buy 1 × 6/4 × 6" × 6 ft: it yields 9 strips for the 8 needed (1 spare strip)". Every number is from the cut list's resaw plan (`planResaw`). */
function resawText(c: StepCtx, x: Part, strips: number): string {
  const pool = poolOf(c, x);
  if (!pool) return 'resawn from thick stock (see the cut list)';
  const spare = pool.spares <= 0 ? 'no spare strip: a strip that cracks on the form means another board' : plural(pool.spares, 'spare strip');
  return (
    `resawn from ${pool.board} (kerf ${inch(c.p.resawKerfIn)}, ${plural(pool.stripsPerBoard, 'slab')} a board). Buy ${pool.boards} × ${pool.board} × ${pool.boardWidthIn}" × ${f(pool.boardLengthIn / 12, 0)} ft: ` +
    `it yields ${pool.stripSlots} strips for the ${strips} needed (${spare})`
  );
}

/** Pieces wider than a board, edge-glued from several (the oak plan's glue-ups): "transom-rear ×3, bow-bulkhead ×2". */
function glueUpList(c: StepCtx): string {
  const plan = c.oak();
  const n = new Map<string, number>();
  for (const t of plan.thicknesses) for (const b of t.boards) for (const l of b.lanes) for (const k of l.cuts) if (k.glueUp) n.set(k.id, (n.get(k.id) ?? 0) + 1);
  return plan.glueUps.map((id) => (n.get(id) ? `${id} ×${n.get(id)}` : id)).join(', ');
}

/** Stock thickness class a part is milled from ("12/4"), from its rough thickness. */
const boardOf = (x: Part | undefined, p: Params): string => (x ? boardForThickness(roughT(x, p))?.nominal ?? '?' : '?');

/** Steepest angle (degrees) the bent rails make with the centerline in the bow taper: where the joist and king-beam ends meet them. */
export function maxTaperAngleDeg(p: Params): number {
  const L = computeLayout(p);
  if (L.taper.x1 - L.taper.x0 < 1e-6) return 0;
  const xs = samples(L.taper.x0, L.taper.x1, 120);
  let m = 0;
  for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.atan(Math.abs(L.turnIn(xs[i]) - L.turnIn(xs[i - 1])) / (xs[i] - xs[i - 1])));
  return (m * 180) / Math.PI;
}

/** Station cradles for the inverted sides: "x = 2.1": 24.0" outside, 14.0" tall". */
export function cradleStations(p: Params): { x: number; widthIn: number; heightIn: number }[] {
  const L = computeLayout(p);
  return [0.08, 0.38, 0.68, 0.94].map((u) => {
    const x = L.xSideStart + u * (L.xSideEnd - L.xSideStart);
    return { x, widthIn: 2 * outerHalfWidth(L, x), heightIn: sideTopAt(L, x) - L.chineBot };
  });
}

/** The rail-end joint to a mating part, in words: "8×50 Domino" or "1/4 × 7/8 × 3/8 deep loose tenon". */
function endJoint(c: StepCtx, from: string, to: string): string {
  const j = c.by(from)?.joints?.find((q) => q.to === to && (q.type === 'domino' || q.type === 'mortise-tenon'));
  if (!j) return 'joint per the part notes';
  return j.type === 'domino' ? `${dominoKey(j)} Domino` : (j.size ?? 'loose tenon').split(' (')[0];
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
      const list = verifyChecklist(c.parts, c.p);
      const before = list.filter((v) => v.when === 'before ordering');
      const cutting = list.filter((v) => v.when === 'before cutting');
      return {
        instructions: [
          `Work through the checklist (verify.ts): ${plural(before.length, 'item')} before ordering, ${plural(cutting.length, 'item')} before cutting.`,
          `Before ordering: ${before.map((v) => v.title).join('; ')}.`,
          `Before cutting: ${cutting.map((v) => v.title).join('; ')}.`,
          'Buy ONE of the wheel and the tube first; order the lot only when the squash, bore, hub and rating pass. Enter any measured value in its param and re-run the checks.',
        ],
        checks: before.map((v) => `${v.id}: ${v.pass}`),
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
      const glued = glueUpList(c);
      const b = (id: string): string => boardOf(c.by(id), c.p);
      return {
        instructions: [
          `Mill every oak part to rough size: finished + ${inch(allow)} thickness and width, + ${inch(4 * allow)} length (millingAllowanceIn); quantities by board thickness are in the cut list.`,
          glued
            ? `Edge-glue the wide panels FIRST (they must cure before the planer and the Shaper): ${glued}. Rip each board ${inch(allow)} over its share, joint the mating edges, glue with 206 and cauls, then plane to thickness and trim to the cut-list size.`
            : 'No panel is wider than a board: no edge glue-ups.',
          band
            ? `Band strips: ${bands.length}, rough ${roughSize(band)} (finished ${sizeOf(band)}), ${resawText(c, band, bands.length)}; plane or drum-sand to ${inch(band.stock!.t)}.`
            : 'Band strips: none in this model.',
          rail
            ? `Rail strips: ${plural(nRailStrips, 'strip')}, rough ${roughSize(rail)} (finished ${sizeOf(rail)}), ${resawText(c, rail, nRailStrips)}; thin and ${inch(rail.stock!.w, 0)} wide, so use a planer sled or drum sander.`
            : 'Rail strips: none in this model.',
          `Bandsaw blanks from thick stock: brake knees (${b('brake-knee-L')}), brake shoes (${b('brake-shoe-L')}), chocks (${b('brake-chock-L')}), handlebow (${b('handle-bar')}), tongue (${b('bridle-tongue')}).`,
          'Mill strips and bandsaw blanks the day they are glued or bent; thin strips cup overnight. Sticker the rest and keep it at 6-9 % moisture.',
        ],
        checks: ['Moisture 6-9 % on every board', 'Strip thickness uniform within 0.005" (feel for ridges)', 'Strips straight-grained with no knots in the bend', 'Panel glue-ups flat, no step at the glue lines'],
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
      const rail = c.parts.find((x) => x.id === 'rail-L');
      const t = bowTaper(c.p);
      const thin = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t < 0.3);
      const thick = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t >= 0.3);
      const oak = shaper.filter((x) => x.kind !== 'sheet');
      // Form sizes come from the drawings (forms.ts), never from numbers typed here.
      const dim = (id: string, key: string): number | undefined => c.forms().find((d) => d.id === id)?.dims.find((q) => q.key === key)?.valueIn;
      const rise = dim('side-form', 'ramp-rise');
      const rampLen = dim('side-form', 'ramp-length');
      const ribs = dim('side-form', 'ramp-ribs');
      const formLen = dim('rail-form', 'form-length');
      const railDepth = rail?.stock?.w ?? 0;
      const stackDim = dim('rail-form', 'stack-height');
      const layers = Math.ceil((stackDim ?? railDepth) / RIB_STOCK_IN - 1e-6);
      const stack = stackDim ?? layers * RIB_STOCK_IN;
      const radius = t.minRadiusIn > 1e6 ? 'n/a' : inch(t.minRadiusIn, 0);
      return {
        instructions: [
          `Shaper files (shaper-svg): ${shaper.length} parts. 4 mm okoume: ${thin.map((x) => x.id).join(', ')}. 12 mm okoume: ${thick.map((x) => x.id).join(', ')}. Oak: ${oak.map((x) => x.id).join(', ')}.`,
          web
            ? `Each side web is ONE piece from the full 4' × 8' sheet, cut to the flat development (${inch(web.stock!.l, 2)} long, not the plan length; D-68). Nest per the nesting drawing; the seat back comes from the deck offcut.`
            : 'Side webs: one piece each from the full 4\' × 8\' sheet.',
          formLen !== undefined
            ? `Rail form (rail-form drawing): ${inch(formLen, 1)} long, its face the rails' outer plan curve: ${inch(t.turnIn, 2)} turn-in each side from x = ${f(t.x0)}" to x = ${f(t.x1)}" (tightest radius ${radius}, D-66). Stack ${layers} layers of ${RIB_STOCK_IN}" MDF (${inch(stack, 2)}, never less than the ${inch(railDepth, 2)} rail depth, so every clamp bears on the full strip width). One form serves both rails.`
            : 'Rail form: no bow turn-in at these params, so the rails are straight.',
          rise !== undefined && rampLen !== undefined
            ? `S-ramp (side-form drawing, the sides only): rise ${inch(rise, 2)}, ${inch(rampLen, 1)} long from the S start to the bow end, ${f(ribs ?? 0, 0)} ribs of ${RIB_STOCK_IN}" MDF under a 1/4" hardboard cap. The other web face goes on the mirror S-ramp.`
            : 'S-ramp: none, the sides are not turned in at these params.',
          'Templates: handlebow arc, bulkhead crown, brake flap and knee (forms.ts). Check the 1" square on each printout before cutting.',
          'Cut the dados (web-end dados open through the top edge, deck dado run into them at each corner as one pocket; see the Shaper files), hand-holds and the Domino / tenon mortises as each assembly step calls for them. Measure the real plywood first (verify list) and set panelPlyIn / deckPlyIn before any dado is cut.',
          'Bend-test a dry oak strip on the rail form (the spare strip from the purchase). If it cracks, plane thinner or add a minute of damp heat; the same test decides 2 vs 3 plies.',
        ],
        checks: ['Verify items marked "before cutting" are done', 'Web blank measures the flat-development length; fits the sheet', 'A dry strip takes the S without cracking'],
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
    build: (c) => ({
      instructions: [
        'First run the finishing offcut tests (finishing.ts, step 1). They decide how the okoume takes stain under epoxy; no show face is sealed until a panel passes.',
        'Epoxy-seal (105/207, coat 1 of the finishing schedule) ONLY the dados (transom, bulkhead), the deck underside and deck edges, every ply edge (webs, signs, storage panels, seat back, lid), and faces nobody will see. The show faces stay bare: both web faces, the deck top, the box, the lid, the seat back. Glue faces stay bare or are scuffed.',
        'The show faces are stained (conditioner, then dye or gel on the okoume), THEN epoxy-sealed, after assembly in the finishing schedule (steps 3-4). Water-based dye under epoxy is the safe route; oil-based stain or gel stays tacky unless it has fully cured.',
        `The deck dado and the deck gap under the inner chine band are deck + ${inch(c.p.deckSlopIn)} tall, so the sealed deck still enters; check with a feeler.`,
        'Wash or sand the amine blush off any sealed face that will be glued again (warm water + Scotch-Brite, dry; 120 grit), and the dado walls. Keep glue faces on the oak bands and rails bare.',
        'Wipe squeeze-out off the bare show faces before it kicks during every later glue-up; it is sanded at the finish, but dried epoxy blocks the stain.',
      ],
      checks: ['Sealed deck enters its dado with a feeler (deckSlopIn clearance)', 'No bare ply edge left on any sheet part', 'Offcut panel approved before any show face is sealed'],
    }),
  },

  // ---------------- 3: frame ----------------
  {
    id: 'rails',
    title: 'Bend-laminate the rails',
    kind: 'build',
    steps: [STEP.frame],
    match: /^rail-[LR]$/,
    view: 'top',
    tools: ['rail form', 'clamps', 'epoxy pumps', 'planer', 'router', 'Domino'],
    hardener: '206',
    clamp: 'Strips glued face to face on the rail form, clamped at every station and left in the form.',
    build: (c) => {
      const rail = c.mine[0];
      const dom = jointTally(c.parts, new Set(c.mine.map((x) => x.id)), 'domino', dominoKey, HULL_STEP.sides);
      const chine = [...dom.entries()].filter(([k]) => k === '4×20').reduce((s, [, n]) => s + n, 0);
      const clamps = c.forms().find((d) => d.id === 'rail-form')?.dims.find((q) => q.key === 'clamps')?.valueIn;
      return {
        instructions: [
          `Glue ${plural(rail?.plies ?? 2, 'strip')} per rail (${sizeOf(rail)} each), epoxy lightly thickened (406), on the rail form with wax paper; ${c.mine.length} rails, one cure each unless there are two forms.`,
          `Clamp at every station (${clamps !== undefined ? f(clamps, 0) : 'about 15'} clamps per rail, rail-form drawing); only the last 29" is curved.`,
          'After cure: plane the edges flush, leave the rail 1/2" LONG at both ends (trimmed at the dry fit, S1), cut the 45° step and the beam / hanger notches. Do NOT cut the end mortises yet: they are cut after the trim.',
          `Mortise the rail tops: Dominos ${dominoText(c, HULL_STEP.sides) || '4×20 / 5×30'}${chine ? ` (the ${chine} 4×20 are the chine ties, every 6")` : ''}.`,
        ],
        checks: ['Rails match the rail form within 1/16"', 'No gaps in the glue lines; rails flat and not twisted'],
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
    tools: ['drill', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '206',
    clamp: 'Clamp the hanger to the rail inner face while the epoxy goes off; bolts after the clamp comes off.',
    build: (c) => {
      const h = c.mine[0];
      return {
        instructions: [
          `Before the frame glue-up, rails flat on the bench: epoxy each hanger (${sizeOf(h)}) side-grain to the rail inner face (5" × 3" glue area), then 2 × 1/4" 316 bolts through hanger and rail, nylock nuts and fender washers on the outside face, above the beam notch.`,
          'Hanger bottom is notched 2.38" × 1.35" to straddle the beam and bear on its top (bandsaw + chisel, 1/4" corner radius).',
          `Cut the 5×30 Domino mortises for joist-1 in the hanger edges now (${dominoText(c) || 'per joint list'}); joist-1's ends engage them in the frame glue-up.`,
        ],
        checks: ['Hangers mirror each other: same distance from the transom', 'Notches in line (string or straightedge across)'],
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
    clamp: 'Right side up on a flat bench: deck on top of the frame, weighted (sandbags or vacuum bag).',
    build: (c) => {
      const deck = c.by('deck');
      const dom = dominoText(c, HULL_STEP.deck);
      const brakeBackers = c.mine.filter((x) => /^brake-backer-[LR]$/.test(x.id));
      const angle = maxTaperAngleDeg(c.p);
      return {
        instructions: [
          `Day before: epoxy the seat-hinge backers (1" oak pads) to the deck underside; butt each to the joist-3 face so the flat-latch pin lands in solid oak.`,
          ...(brakeBackers.length
            ? [`Brake backers (${sizeOf(brakeBackers[0])}, ${brakeBackers.length}): epoxy each to the rail inner face and the deck underside, clear of the axle hanger; the crossmember that meets it is cut back 0.75" and butts the backer face. Clamp with cauls the day before, and drill the 4 knee-bolt holes (0.38") through rail and backer together now, from the knee as a template.`]
            : []),
          `King beam: bore the 5/8" kingpin hole square on the drill press and cut the nut slot from the front (about 1" × 0.75" at the top) before the deck goes on.`,
          `Dry-fit rails (1/2" long both ends), joists and king beam: Dominos ${dom || '5×30'}, epoxy; joist-1 is cut back 0.88" at each end for the axle hangers.`,
          `Joist and king-beam ends in the bow taper meet the bent rails at up to ${f(angle, 0)}°: the cut-list lengths are the long point, so scribe each end to its rail at this dry fit (pencil from the rail, bandsaw or miter) before the glue goes on.`,
          `Glue-up: Domino the crossmembers to the rails, thickened epoxy (406) on every top face (rails, joists, king beam), set the sealed deck${deck ? ` (${sizeOf(deck)})` : ''} on top, weight it.`,
          'Deck bonds full length to the rail tops and joist tops; the rails stay long, the deck edge follows the web plan.',
        ],
        checks: ['Frame square: diagonals equal within 1/16"', 'Deck flat on a straightedge (no twist or rocking)', 'Squeeze-out cleaned from the deck edge before it goes into the dado gap'],
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
    clamp: 'One face per cure: lay the web FLAT on the S-ramp under the bow end, cleat the sheer line every 4-5", clamp across the bands every 4-5" (about 14 per band pair).',
    build: (c) => {
      const web = c.by('side-L-web');
      const inn = c.by('side-L-chine-in');
      const gun = c.by('side-L-gunwale-in');
      const backer = c.by('sign-backer-L1');
      return {
        instructions: [
          `Per side: glue the inner chine band (${sizeOf(inn)}) and inner gunwale band (${sizeOf(gun)}) full-face to the inside of the ${inch(web?.stock?.t ?? 0.157)} web with thickened epoxy, and bend web + bands together over the S-ramp. No grooves.`,
          'The inner chine band stops 0.512" short of the web bottom (deck + clearance): that gap is the deck rabbet, nothing is routed. Use a spacer stick.',
          'Cleat the sheer line (screws into a sacrificial table every 4-5", the whole length): an edge-bent strip pushes about 65 lbf sideways at mid-span per band until the epoxy cures.',
          `Sign backers: ${c.mine.filter((x) => /^sign-backer/.test(x.id)).length} oak strips (${sizeOf(backer)}, grain vertical) epoxied inside the web, 0.15" under the inner gunwale band, with two #10-32 × 3/8 inserts each, 1.6" apart. Keep the signs clear of the flag blocks (x ≥ -8.2").`,
          'Left and right in turn on the same S-ramp: two cures per side, four in all (a second ramp halves the time).',
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
      const gun = c.by('side-L-gunwale');
      const web = c.by('side-L-web');
      const scup = c.mine.filter((x) => /^scupper/.test(x.id));
      const ties = jointTally(c.parts, new Set(c.mine.filter((x) => /^side-[LR]-chine$/.test(x.id)).map((x) => x.id)), 'domino', dominoKey);
      const [tieKey, tieTotal] = [...ties.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['4×20', 18];
      const perSide = Math.round(tieTotal / 2);
      return {
        instructions: [
          `Per side: glue the outer chine band (${sizeOf(out)}) and outer gunwale band (${sizeOf(gun)}) to the outside face; the chine band bottom is flush with the deck-underside level (it rests on the rail).`,
          'The gunwale band is bent on edge to the concave sheer and across its thickness to the S together; the web stops 0.125" under the band top, fill that gap with thickened epoxy and trim the top flush.',
          'Joints in the bands (if you scarf two pieces, 8:1): middle third only, never in the first 4" behind the transom, under the grab boards, lash doublers or sign stations; stagger 12" from the mate on the same face.',
          `Scuppers: drill ${plural(scup.length, 'hole')} (3/8", rear and bow, lower edge just above the deck level) through inner band, web and outer band, line with epoxy, bed the 316 nipples.`,
          `Chine ties, once the cure is hard: mortise the bottom edge of each side, ${perSide} per side, ${tieKey} Dominos, VERTICAL, through the outer band and the web edge (${inch((out?.stock?.t ?? 0) + (web?.stock?.t ?? 0))}), centered on the web / band glue line. Mark the stations from the rail-top mortises (story stick, or a dry offer-up of the rail); the Dominos engage when the frame + deck unit is lowered in.`,
          'Leave all bands and webs long: they are cut to the measured length at the dry fit.',
        ],
        checks: ['Four bands per side bonded; free web 1.0" at the bow and 11.0" at the rear', 'Both sides are mirror images within 1/16"', `${perSide} chine mortises a side, square to the edge and on the glue line`],
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
      const cradles = cradleStations(c.p).map((q) => `x = ${f(q.x, 1)}": ${f(q.widthIn, 1)}" wide, ${f(q.heightIn, 1)}" tall`);
      return {
        instructions: [
          `Cradle: stand both side assemblies inverted on ${cradles.length} MDF station cradles, each a 3/4" plate notched to the sheer, at ${cradles.join('; ')} (outside width, side height).`,
          'Turn the frame + deck unit over and drop it in DRY: the chine Dominos (all vertical) engage and the deck edge rises into the gap under the inner chine band.',
          `Check the deck slot: ${inch(c.p.deckSideClearIn, 4)} a side to each web (D-63). Pare the deck edge if it binds; thickened epoxy fills the slot later.`,
          'Measure from the rear transom dado to the bow bulkhead dado; cut bands and webs to that length less 1/32" and trim the frame unit\'s rails (left 1/2" long) to match (S1). The unit is glued: use a flush-cut (Japanese) saw or an oscillating multi-tool with the blade flat on the deck underside, then pare to the line.',
          `NOW cut the rail-end mortises, in the trimmed rail ends: transom end ${endJoint(c, 'rail-L', 'transom-rear')}, bulkhead end ${endJoint(c, 'rail-L', 'bow-bulkhead')} (D-69). Use the Domino on the glued unit, or a guided router on a fence against the end face; the mating mortises in the transom and bulkhead are in their Shaper files.`,
          'Rehearse the whole close (transom first, bulkhead on a second batch) with clamps and cauls in place.',
        ],
        checks: ['Length measured on both sides within 1/32"', 'Unit drops in without forcing', 'Rails, bands and webs end at the same station', 'Rail-end mortises centered on the rail and the transom / bulkhead mortises'],
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
    clamp: 'Clamp the chine bands to the rails at every other Domino; screws up through the rails.',
    build: (c) => {
      const all = new Set(c.parts.map((x) => x.id));
      const dom = jointTally(c.parts, all, 'domino', (j) => (/^4×20/.test(j.size ?? '') ? '4×20' : '')) .get('4×20') ?? 18;
      return {
        instructions: [
          `Bed the 3/8" bearing face of each rail in epoxy; fit the ${dom} Dominos (4×20, every 6", ${f(dom / 2, 0)} per side) in the rail-top mortises, then lower the unit vertically (two people).`,
          'Fill the deck slot at each web with thickened epoxy; the deck edge rises 0.17" under the inner chine band.',
          'Screws up through the rails into the chine band at every other Domino; wipe squeeze-out inside the dados before it kicks.',
          'One batch per side so the mix never outlives its pot life.',
        ],
        checks: ['Both webs seat fully in the rails with no daylight at the chine', 'Hull diagonals equal within 1/8"'],
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
    hardener: '209',
    clamp: 'Two pipe clamps along the length; clamp backers with a caul the evening before.',
    build: (c) => {
      const transom = c.by('transom-rear');
      const bands = count(c, 'glue');
      return {
        instructions: [
          `Bench, the day before: drill the push-handle socket holes in the transom and the backers, and epoxy the ${plural(c.mine.filter((x) => /backer/.test(x.id)).length, 'backer')} (0.75" oak) to the inside of the transom (${sizeOf(transom)}), full face.`,
          'Set a captive 1/4-20 T-nut (or epoxied insert) per socket screw in each backer, from its inside face, before the backer is glued: the socket screws then drive in from outside and no wrench ever has to reach behind the storage box (it replaces the nylock nut in the BOM).',
          'Close ONE end first (S1). The transom slides in X onto the deck edge, both web ends (their dados, open at the top), the rail tenons and the four band ends per side (epoxy fillet butts, no Dominos): about a dozen joints in one glue-up.',
          'Use the 120-minute slow epoxy (209) and rehearse twice. The 1/8" vent holes in the dados let air and epoxy escape; bung them after.',
          `Joint count at the transom: ${plural(bands, 'epoxy joint')}, mortise-and-tenon ×${count(c, 'mortise-tenon')}.`,
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
    hardener: '209',
    clamp: 'Second batch, after the transom epoxy has kicked (3-6 h); two pipe clamps along the length.',
    build: (c) => {
      const b = c.by('bow-bulkhead');
      return {
        instructions: [
          `Bulkhead ${sizeOf(b)} (rear face is the rider's foot brace): dados open at the top take the web ends, a deck dado run into them takes the deck edge, Dominos into the rails (D-69), four band ends per side butt with an epoxy fillet.`,
          'Second, fresh batch of 209 so the close never runs against the first pot life. Fillet the inside corners with thickened epoxy.',
          'The lift hand-hold is already cut; keep epoxy out of it and out of the lamp-clip fit.',
        ],
        checks: ['Bulkhead square and at the right station (x of the dry-fit mark)', 'Web and deck seated in their dados, no gaps'],
      };
    },
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
      const bolts = count(c, 'bolt');
      return {
        instructions: [
          `Cut the axle groove ${inch(c.p.axleDiameterIn - c.p.axleProudIn, 2)} deep so the ${inch(c.p.axleDiameterIn, 2)} tube stands ${inch(c.p.axleProudIn, 2)} proud and the clamp plate bears on the tube.`,
          `Beam passes under the rail and bears on the notch ceiling; bolt the hold-down angles (two 1/4" bolts through the upright leg and the hanger, two 1/4" × 3 down through the flat leg and the beam, either side of the tube). The beam and angles stay on for finishing; mask the bolt heads.`,
          `FIT AND DRILL, then take off: lay the ${inch(c.p.axleDiameterIn, 2)} × ${inch(c.p.axleWallIn, 3)} DOM tube in the groove (cotter cross holes ${inch(c.p.axleCrossHoleDiaIn, 3)} near each end), clamp the 316 plates (2.25" × 1.5" × 0.25") and drill the two 0.38" bolt holes per plate, 1.5" apart. Dry-assemble, check, then remove the axle and plates; they hang after the varnish.`,
          'Tag every axle, plate and bolt (rear L / R) with tape so the kit goes back where it was drilled. Plates take nylock nuts and fender washers under the beam; shim the plate ends with tape on the first tightening; snug plus a quarter turn; recheck the nuts before each event (oak creeps).',
          `${plural(bolts, 'bolt')} in this step's holes, all 316.`,
        ],
        checks: ['Tube centered: equal length out each side', 'Plate does not rock when dry-assembled', 'Beam square to the rails (diagonals from the transom corners)'],
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
    build: (c) => ({
      instructions: [
        'UHMW thrust disc to the king beam: three #8 flat-head screws, counterbored from the disc side.',
        `Kingpin: ${inch(c.p.kingpinDiaIn, 3)} grade 8 bolt, head and plate washer under the axle beam, up through beam, disc and king beam; nylock nut and washer in the slot at the top of the king beam: snug, then back off a quarter turn so the axle swings freely. The beam, disc and kingpin stay on for finishing (mask the head and the slot).`,
        'FIT AND DRILL, then take off: stub axles in their grooves (cut the groove 0.70" deep, 0.05" proud), two clamp plates per end, same bolts as the rear (grip 2.5"); roll pads (2" × 3" × 1/4" UHMW) beside the stub grooves, shimmed 0.05" off the beam, running gap under the rail about 0.1" (0.03"-1/8") with tape. Drill every hole, dry-assemble, check the lock, remove.',
        'Eye bolts (3/8" forged shoulder) fore-aft through the beam 8" from the kingpin, and the anchors through the chain joist 7.8" off the center line: drill all four holes now (hull inverted, the underside is up); nylock nuts and 2" washers go on at the hang step.',
        'Tag the stubs, plates, pads, eye bolts and bolts (front L / R) and bag them with the rear kit.',
      ],
      checks: ['Axle swings freely through the full lock (±' + f(c.p.steerLockDeg, 0) + '°) with no drag', 'Roll-pad gap 0.03"-1/8"', 'Clamp plates clear the king beam by 1/8"'],
    }),
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
      return {
        instructions: [
          `${plural(wheels.length, 'wheel')} on the axles: ${inch(c.p.wheelBoreIn, 2)} bore on the ${inch(c.p.axleDiameterIn, 2)} tube, sealed bearings; collar and cotter pin 1" beyond the hub.`,
          `Check track: ${f(c.p.frontTrackIn, 1)}" front, ${f(c.p.rearTrackIn, 1)}" rear; inflate to the squash-test pressure (verify item 1). Spin each wheel: no rub on the beam end, clamp plate or brake knee; no end float beyond 1/16".`,
          'Hull still inverted: pre-drill the seat stop-block screw pilots through the deck from below (the blocks are screwed from underneath, so they cannot be reached once the sled is upright).',
          'Take the wheels, axles, clamp plates, roll pads and eye bolts OFF and bag the whole kit with its bolts, washers, collars and cotter pins. Nothing metal stays on the underside: the finish goes on next, and the running gear hangs after the varnish (the hang step).',
        ],
        checks: ['All four wheels spin freely and run true when dry-fitted', 'Axles square: front and rear wheelbase measured on both sides within 1/8"', 'Every bolt hole drilled; the kit is bagged and tagged'],
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
      const a = finishAreas(c.parts);
      return {
        instructions: [
          `Run the finishing schedule (finishing.ts) on everything reachable from below: the deck underside, rails, joists, beams, hangers, king beam, the outside of the sides, the transom and bulkhead. Same products and coats as the rest (${f(a.oakFt2, 0)} ft² oak + ${f(a.okoumeFt2, 0)} ft² okoume in all).`,
          'Offcut test first, then sand 120 / 150, stain the show faces, epoxy-seal them (two coats), and varnish (four coats, 320 between). Mask the bolt seats, the kingpin head and the hold-down angles.',
          'Flip only when the last coat is dry enough to handle (3 days); the horses are padded, and the hull is carried by the rails and the bulkhead, never by the sides.',
          'The inside, the topside and everything built after the flip is finished after assembly, in the finish step.',
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
      const present = c.parts.filter((x) => x.step <= STEP.gear && !x.payload && x.group !== 'reference' && !isHangPart(x));
      const mass = present.reduce((s, x) => s + x.massLb, 0);
      return {
        instructions: [
          `The hull without its running gear weighs about ${f(mass, 0)} lb (plus fasteners): four people, padded horses, so the new varnish is not marked.`,
          'Before the lift: nothing loose in the hull. Lift at the rails and the bulkhead, never by the sides.',
          'Roll it onto padded blocks; the rest is built upright. The wheels are not on yet: the sled stands on its blocks until the hang step.',
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
      const tongue = c.by('bridle-tongue');
      return {
        instructions: [
          `Tongue (${sizeOf(tongue)}, on edge, 1.25" × 1.75" at the stem): two 0.38" × 6-1/4" carriage bolts fore-aft through the T head and the whole axle beam, nylock nuts and fender washers on the rear face. The tongue is not removable (D-65): it stays bolted on and is finished in place.`,
          `${inch(c.p.tongueSleeveBoreIn, 3)} bore bronze sleeve (1" OD) epoxied in the hole across the stem, 1.5" from the tip; ease both bore ends so the rope bears on a round edge. Mask the bore for the finish.`,
          `Bridle rope (${inch(c.p.bridleRopeDiaIn, 3)} nylon) and the check chains go on in the hang step, with the eye bolts they hook to.`,
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
    clamp: 'Tape-and-fold: outside seams taped, then fillets; clamp the coaming with cauls.',
    build: () => ({
      instructions: [
        'Bevel the 4 mm wall edges at 45° on the table saw, tape the outside seams, fold, then a 3/8" epoxy fillet and 2" glass tape inside each corner (no spline).',
        'Wall bottoms stand on the sealed deck (the deck is the floor): fillet inside, bead outside, so no ply edge is exposed.',
        'Oak coaming (3/8" × 1/2") epoxied to the wall tops with butt corners; round the inboard top edge 1/8". The gasket and lid sit on oak, never on a ply edge.',
        '1" hinge backers epoxied inside the fore end; 3/8" latch blocks (grain vertical) epoxied to the inside of the transom.',
        'Fair the sealed deck with microballoon epoxy to fall about 1/8" toward each aft drain; the drain nipples are fitted at final fit.',
      ],
      checks: ['Box square, fillets continuous', 'Coaming flat across all four walls (gasket seat)', 'Drain falls toward the corners'],
    }),
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
    build: (c) => ({
      instructions: [
        'Oak lid frame: 3/8" × 3/4" × 1/2" deep blind loose tenons at the four corners; the 4 mm panel sits in a 1/4" × 1/4" rabbet (epoxy-sealed).',
        `${plural(c.mine.filter((x) => /batten/.test(x.id)).length, 'batten')} let 1/4" into the frame sides, epoxy plus 4 plugged stainless screws each from the top, to keep the panel from sagging.`,
        'The lid is engraved DO NOT STEP in the finishing schedule (step 5), before the varnish. It is a seat-cushion lid, not a step (D-58).',
        'Fit the lid to the box, set the hinge leaves on it and drill the pilot holes (#8 × 1/2 into the rim, #8 × 1 into the backers), then take them off: the hinges hang after the varnish, and the gasket goes in at the final fit.',
      ],
      checks: ['Lid flat and square; sits on the coaming with no rocking', 'Panel flush with the frame'],
    }),
  },
  {
    id: 'seat-blocks',
    title: 'Seat stop blocks and crest strip',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^seat-(wedge|crest)/,
    view: 'side',
    tools: ['bandsaw', 'plane', 'clamps', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Wedges screwed from below while the epoxy sets; crest strip clamped with a caul from the front.',
    build: () => ({
      instructions: [
        'Shape the stop blocks to the back angle (bandsaw + plane); epoxy them to the deck and to the box end, and screw from below.',
        'Tape the lid-hinge leaves to the box end as spacers (wax paper under the strip), then bed the crest strip (1.5" × 13.5" oak) in a 0.13" layer of thickened epoxy over the box end and the leaves, end to end with each block. Lift the leaves out after the cure: the strip keeps their recess, and the hinges hang after the varnish.',
        'Drill the upright latch hole in the block face: 3/8" blind, 1.0625" deep with a drill stop, 1/16" groove 0.73" from the mouth, 2.00" up from the hinge axis.',
      ],
      checks: ['Crest strip straight along the 13.5" span', 'Blocks mirror each other; hole 0.4" of oak behind the pin'],
    }),
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
      const panel = c.by('seat-back-panel');
      return {
        instructions: [
          `Back panel ${sizeOf(panel)} okoume: 2.5" radius top corners, 1/16" oak veneer banding round the edge (flush trim), epoxy-sealed. No ply edge shows.`,
          `Inserts: 3 × #10-32 × 5/16 stainless, hex-drive, epoxied in blind holes 0.344" deep from the front face (drill stop), 1/2" or more from every edge, per hinge. Pull-test one on a scrap first (verify: seat-back).`,
          'Pin holes: 13/32" clearance, bored square at stations ±7.38", 2.00" up from the hinge axis, epoxy-lined.',
          '2" 316 butt hinges: FIT AND DRILL now, hang later (hang step). #10-32 × 3/8 screws to the inserts on the back; #8 × 1-1/4 through the deck into the 1" backer pads. The flat-latch pin hole is 3/8" blind, 0.625" deep in the pad, 1/16" groove 0.256" below the deck.',
          'Spring-detent pins, lanyards and the cushions (on Dual Lock, the seat cushion set back 3/8" from the back so the hinge knuckles clear) are dry-fitted here and hang with the hinges after the varnish.',
        ],
        checks: ['Back flips 105° and lies flat; both latches engage in both positions', 'Pin head clears the cushion', 'Seat back does not rock against the crest strip'],
      };
    },
  },

  // ---------------- 6: brake and handle ----------------
  {
    id: 'brake-knees',
    title: 'Brake knees (and backers)',
    kind: 'build',
    steps: [STEP.brake],
    match: /^brake-(backer|knee)-[LR]$/,
    view: 'side',
    tools: ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '206',
    clamp: 'Backers clamped to the rail and deck underside before the bolts go in; knees clamped to the rail while the bolts go through.',
    build: (c) => {
      const knee = c.by('brake-knee-L');
      const backers = c.mine.filter((x) => /^brake-backer/.test(x.id));
      const framed = c.parts.some((x) => /^brake-backer/.test(x.id) && x.step <= HULL_STEP.deck);
      return {
        instructions: [
          backers.length
            ? `Backers (0.75" oak, ${sizeOf(backers[0])}) epoxied to the rail inner face and the deck underside, clear of the axle hanger.`
            : framed
              ? 'The backers went in with the frame glue-up and their bolt holes are drilled; only the knees go on here.'
              : 'No backers in this model.',
          `Knee (${sizeOf(knee)}, bandsawn from 2.5" stock): the arm is slotted from the rear, 1.38" wide (tongue + 0.06" a side), leaving two ears. Cut ONE knee first and test it with the real pin and flap (verify: brake).`,
          '4 × 0.38" × 4" 316 bolts per knee (2 columns × 2 rows) through the knee leg and the rail into the backer; heads in counterbores in the knee, fender washers and nylock nuts in 1/2" counterbores in the backer; epoxy the holes and the leg against the rail and chine outer face. The knees stay bolted on for finishing.',
          'The 0.38" pivot hole is drilled later, with the flap tongue and block clamped in the slot.',
        ],
        checks: ['Knee tops level with each other', 'Knee clears the tire front by the designed margin', 'Bolts are tight after the epoxy has cured'],
      };
    },
  },
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
    build: () => ({
      instructions: [
        'Flap (7/8" oak, Shaper-cut from the file): 1/4" roundover on all edges; epoxy-seal before the finish.',
        'Pivot block (2.01" × 1.25" × 0.63") on the tongue: epoxy and 3 × #10 × 1-1/4" flat-head screws. Then drill the 0.38" pin hole across block and tongue together with the knee clamped on; fit the clevis pin in double shear and the hitch-pin clip.',
        'Shoe (bandsawn from 3" stock; top follows the 6° flap underside, bottom cut to the 5.38" tire radius): epoxy and 2 × #10 × 2" screws up into the flap. Pad (3" × 3" × 0.38" rubber): contact cement and 2 × #8 × 1" flat-head screws buried 1/8". Foot tread 4" × 2.5" ribbed rubber, contact cement.',
        'Return cord: 1/4" shock cord with the 3/16" stop cord tied taut at the released length (8.99" between the eyes), snap hook to the transom eye (backer behind it); #10 screw eye in the flap rear end face.',
        'Chocks: oak wedge, ramp 28° tangent to the tire, two stainless screw heads left proud in the base; 30" cord to the eye screw in the knee underside.',
        'Removable (D-65): pull the pin (clip off first), unhook the cord, lift the flap off: about 15 s a side. For finishing, the pin, clip, cord, snap hook, pad and tread rubber are dry-fitted here and kept off; the flap kit is varnished on the bench and rehung in the hang step.',
      ],
      checks: ['Pad hangs 0.38" off the tread released and swings onto it when the flap is pressed', 'Flap clears the tire and the transom corner; foot end at the transom face', 'Flap returns by itself when released'],
    }),
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
    clamp: 'Bow clamped to both posts (post tops sawn to the 10.7° slope) until the epoxy sets.',
    build: () => ({
      instructions: [
        `Aluminum sockets (6061, 1 × 1.5 × 14, wall 0.13): FIT AND DRILL now (against the transom, holes through the backer), then take them off; they hang after the varnish, bedded in sealant, 2 × 1/4-20 × 2 button-head cap screws each with a nylon washer under the head, threaded into the T-nuts set in the backers at the transom step. No wrench reaches behind the box.`,
        'Anodized or epoxy-coated aluminum only (bare aluminum corrodes against wet oak); touch up any bare edge.',
        'Posts (0.69" × 1.19" from 3/4" × 1-1/4" stock): slip fit in the sockets, 0.5" × 0.1875" relief groove down the transom-side face; tops sawn to the bow slope.',
        'Handlebow: one 1.25" × 4.4" × 24" board, edge bandsawn to a 51" radius arc, planed and rounded to a 1.25" grip. Pin each post top with a 3/8" × 2-1/4" 316 rod (1-1/2" deep in the post, 3/4" in the bow) and epoxy: the handle comes off as ONE U and is finished on the bench.',
        'Clevis pin (5/16") through both socket walls and the post; the parked pin hole is 13.5" up.',
      ],
      checks: ['Posts slide in and out without binding on the screw heads', 'Bow is level and the U is square', 'Handle clears the brake flaps and the tail light'],
    }),
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
    clamp: 'Spring clamps or tape; no screws into the 4 mm web.',
    build: (c) => ({
      instructions: [
        `${plural(c.mine.filter((x) => /^doubler/.test(x.id)).length, 'doubler')} (1" oak, 2" × 1.5", cut square to the gunwale slope at each station) epoxied to the inboard face of the inner gunwale band; the lash plates screw into them later.`,
        `${plural(c.mine.filter((x) => /^flag-block/.test(x.id)).length, 'flag block')} (0.75" × 1.4" × 1.5", half-round relief) epoxied to the inner gunwale and chine bands in the left rear corner; the tube is held between them and the transom backer.`,
        'Sand the glue faces first (120) and keep epoxy off the faces that get varnish.',
      ],
      checks: ['Doublers sit on the inner band, not over a vent or scupper', 'Flag blocks line up with the tube against the transom backer'],
    }),
  },
  {
    id: 'finish',
    title: 'Finish: stain, epoxy seal, engrave, varnish',
    kind: 'process',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['random-orbit sander', 'rollers and brushes', 'epoxy pumps', 'Shaper Origin (engraving)'],
    build: (c) => {
      const a = finishAreas(c.parts);
      const s = finishingSchedule(c.parts, c.p);
      return {
        instructions: [
          `Follow the finishing schedule (finishing.ts): ${s.steps.map((x) => `${x.n}. ${x.title}`).join('; ')}. The underside is already done (finish-under); this is everything else.`,
          `Wood surface: ${f(a.oakFt2, 0)} ft² oak + ${f(a.okoumeFt2, 0)} ft² okoume; epoxy and varnish quantities are in the schedule.`,
          'The show faces are stained first, then epoxy-sealed, after the offcut panel passed; the dados, edges and hidden faces were sealed at assembly. Water-based dye under the epoxy is the safe route.',
          'Finish the removable kits on the bench: the brake flap kits and chocks, the handle U and the signs. The tongue is NOT removable (D-65): it stays bolted on and is finished in place. Plug or mask the pivot bores, bolt seats and sockets.',
          'No hardware is on the sled: no axles, wheels, plates, eye bolts, hinges, handle sockets or brake pins. They hang after the varnish has cured, in the next step.',
        ],
        checks: ['Offcut test panel approved before anything on the sled is stained', 'Show faces stained, then epoxy-sealed; every okoume edge and all oak end grain sealed', 'Varnish fully hard before hardware goes on'],
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
      return {
        instructions: [
          `Wait until the varnish has cured (hard enough to bolt against; 7 days before loads). Running gear from the tagged kit: rear and front axles in their grooves, ${plural(n(/^clamp-/), 'clamp plate')} with their nylock nuts and fender washers (snug plus a quarter turn), ${plural(n(/^wheel-/), 'wheel')} with collars and cotter pins 1" beyond the hub, roll pads shimmed 0.05" off the beam.`,
          `Steering: ${plural(n(/^steer-eye/), 'eye bolt')} and ${plural(n(/^steer-anchor/), 'anchor')} with nylock nuts and 2" washers; check chains (8.89" between rings; with the axle straight each hangs 2.68" slack and takes up at the lock); the bridle rope through the sleeve, once round the tongue tip, bowline round the standing part, whip the end.`,
          'Hinges and pins: the seat hinges (#10-32 × 3/8 to the inserts, #8 × 1-1/4 through the deck into the backer pads), the storage-lid hinges (#8 × 1/2 into the rim, #8 × 1 into the backers), detent pins on lanyards; cushions on Dual Lock.',
          `Handle: ${plural(n(/^handle-socket/), 'socket')} bedded in sealant on the transom, 2 × 1/4-20 × 2 button heads each into the T-nuts, nylon washers; then the finished U and its clevis pins.`,
          'Brake flaps: the flap kits on the knees with the pivot pin in double shear and the hitch-pin clip, return cord and snap hook to the transom eye, pad and foot tread rubber on contact cement, chock cords to the eye screws.',
          'Recheck the nuts before each event (oak creeps under the plates).',
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
      const kinds = (re: RegExp): number => rest.filter((x) => re.test(x.id)).length;
      return {
        instructions: [
          `Grab boards (${plural(kinds(/^seat-grip-[LR]$/), 'board')}, 0.625" oak): 6 × 1/4" button-head cap screws each through board, inner band, web, outer band and the 1/16" 316 backing strip (bedded on the outside); clamp the board on and drill all layers with one bit. Nut and 1-1/4" fender washer inside. Bolted, never glued.`,
          `Signs (${plural(kinds(/^sign-[LR]$/), 'sign')}): 4 thumb-knob screws (#10-32 × 7/8") through the 3/16" holes, the 0.296" standoff discs (epoxied to the sign back) and the web into the inserts.`,
          'Storage: gaskets (continuous EPDM bulb, spliced at one corner), lid stay, draw latches on the transom blocks, catch plates, aft drain nipples epoxied in. The lid hinges hung in the previous step.',
          `Lash plates (${plural(kinds(/^lash-/), 'plate')}): 4 × #10 × 1-1/4" stainless into each doubler. Flag tube between the blocks, 3/16" drain hole just above the deck.`,
          'Lamp clips snap into the bulkhead and transom hand-holds; heat-set M4 / M3 inserts; reflectors on the gunwale outer face (wipe clean, press 60 s).',
          'Pooled fasteners (hardware): count against the BOM; every fastener 316 stainless.',
        ],
        checks: ['Load test: 300 lbf pull at 45° on one lash plate; hang the sled by the bowline', 'Grab boards solid; signs stay on and do not rattle', 'Lid closes on the gasket with no gap; stay holds'],
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
      instructions: [`Install: ${mine.map((x) => x.id).join(', ')}.`, 'No template for this model step: follow each part\'s joints and notes.'],
      checks: ['Parts fit and fasteners are tight'],
    }),
  };
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
  const keyOf = (t: Template): number => t.steps[0];
  for (const t of TEMPLATES) {
    while (pending.length && keyOf(pending[0].t) < keyOf(t) && t.kind !== 'prep') ordered.push(pending.shift()!);
    const ids = taken.get(t.id) ?? [];
    if (t.kind === 'build' && ids.length === 0) continue; // nothing to install in this model
    ordered.push({ t, ids });
  }
  ordered.push(...pending);

  const byId = new Map(parts.map((x) => [x.id, x]));
  // Computed at most once per call, and only by the steps that quote them.
  let resawMemo: ResawPool[] | undefined;
  let formsMemo: FormDrawing[] | undefined;
  let oakMemo: OakPlan | undefined;
  const resaw = (): ResawPool[] => (resawMemo ??= cutList(parts, p).resaw);
  const forms = (): FormDrawing[] => (formsMemo ??= formDrawings(parts, p));
  const oak = (): OakPlan => (oakMemo ??= oakBoardFeet(parts, p));
  const steps: BuildStep[] = ordered.map(({ t, ids }, n) => {
    const mine = ids.map((i) => byId.get(i)!).filter(Boolean);
    const ctx: StepCtx = { parts, p, mine, by, resaw, forms, oak };
    const built = t.build(ctx);
    const modelStep = mine.length ? Math.min(...mine.map((x) => x.step)) : t.steps[0];
    const instructions = built.instructions;
    // Anything this template did not describe individually is still listed, so a reader sees every part id.
    const cure = t.hardener ? HARDENERS[t.hardener] : undefined;
    const clampCure = cure ? cureText(t.hardener!, t.clamp ?? 'Clamp until set.') : undefined;
    const step: BuildStep = {
      n,
      id: t.id,
      kind: t.kind,
      title: t.title,
      modelStep: t.kind === 'prep' ? 0 : modelStep,
      partIds: ids,
      instructions,
      checks: built.checks,
      tools: t.tools,
      view: t.view,
      ...(cure ? { cure: { hardener: cure.hardener, potMin: cure.potMin, clampHours: cure.clampHours, fullHours: cure.fullHours } } : {}),
      ...(clampCure ? { clampCure } : {}),
    };
    return step;
  });

  // Process steps inherit their position's model step (they sit between two build steps), so the list stays nondecreasing.
  let run = 0;
  for (const s of steps) {
    if (s.kind === 'build' && s.partIds.length) run = Math.max(run, s.modelStep);
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
