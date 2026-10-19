/**
 * Forms and templates (Phase 4, output 5): full-scale, dimensioned SVG drawings derived from the model, plus a tiler that splits a drawing onto US Letter pages for printing. Plain TS, no three.js.
 *
 * Every drawing is in real inches (the viewBox is in inches) with a title block (name, scale 1:1, units, the design revision), key dimensions as text and dimension lines, and a 1 in check
 * square. The outline of the thing to cut is an outside cut (black) so Shaper Origin can cut it; the dimension layer is guides (blue). Nothing here is hand-entered: curves and stations come
 * from the layout, the parts' meshes and the params. The revision stamp is a hash of the params state (never the wall clock), unless the caller passes `opts.date`.
 *
 * Drawings (ids): 'side-form' (a: the cleat-line template and the S-ramp), 'rail-form' (b), 'crown-templates' (c: handlebow and bow bulkhead), 'brake-flap-template' (d), 'brake-knee-template' (e).
 *
 * Each drawing also says how to BUILD the form (Eric 2026-10-12: "am I cutting out two pieces of plywood in that shape?"): `FormDrawing.build` is an ordered list of steps (material and
 * thickness, how many layers or pieces cut to which line, how they stack and fasten, the base, the braces, ribs or cleats and their spacing, the tape, the spring-back, the clamping), every
 * number derived from the form geometry and the strip sizes. The steps are printed in a HOW TO BUILD IT panel in the title block, with a section sketch for the rail form and the S-ramp.
 */
import type { Params } from '../params';
import { computeLayout, outerHalfWidth, samples, sideTopAt, type Layout } from '../model/layout';
import { bowGeometry } from '../model/handle';
import { transomTopOutline } from '../model/body';
import type { Part, Vec2 } from '../model/types';
import { flatPattern } from './flat';
import { brakeOf, cutListFor } from './part-drawings';
import { analyzeShaperPart } from './shaper-svg';
import { LASER_MAX_WIDTH_IN, clipShape, emptyShape, fitToBed, type LaserItem, type LaserShape } from './laser-svg';
import {
  ANNOTATION_ATTRS, checkSquareEls, circleD, dimensionEls, esc, fmt, frac, guideEl, hash6, pathEl, polyD, rectLoop, svgDocument, textEl, type Xf,
} from './svg-util';

/** Process constants (shop practice, not design numbers). */
/** Thickness (in) of the hardboard / MDF the templates and ramp ribs are cut from. Templates are cut on the laser (D-86), where 1/4 in Baltic birch plywood cuts cleaner than hardboard and lasts longer. */
export const TEMPLATE_STOCK_IN = 0.25;
export const RIB_STOCK_IN = 0.75;
/** The margin the mirror-ramp cap has beyond the web edge on each side (in): the outer ribs stand 3/8 in past the web edge, so the cap just covers them. */
const CAP_MARGIN_IN = 0.5;
/** Least thickness (in) of the S-ramp rib anywhere, so it does not end in a knife edge: the rib's profile sits on this constant base (matches the 1/4 in hardboard template the web lies on). */
export const RIB_BASE_IN = 0.25;
/** Spacing (in) of cleats and clamps along a bend: "every 4 to 5 in" (HULL_STEP, build-utils.ts). */
export const CLEAT_SPACING_IN = 4.5;
/** Cut this much deeper than the stock (in). */
const BREAKTHROUGH_IN = 0.02;
/** Rail form: straight lead-in ahead of the S start (in), depth of the form body behind the face (in). */
export const RAIL_FORM_LEAD_IN = 12;
export const FORM_DEPTH_IN = 4;
/** Station spacing (in) of the offset table on the rail form. */
const OFFSET_STEP_IN = 2;
/** Spring-back allowance range, as a fraction of the turn-in (noted on the drawing, not applied: confirm with a dry strip). */
export const SPRINGBACK_RANGE: [number, number] = [0.05, 0.1];
/** Template band (in) kept below a crown curve. */
const CROWN_BAND_IN = 2;
/** Building the forms (shop practice): MDF layer thickness, the plywood base, the hardboard caul, the screw spacing in a layer stack and the room on the base in front of a form face (in). */
export const FORM_LAYER_IN = 0.75;
export const FORM_BASE_IN = 0.75;
/** Thickness of the stiff wall left behind the face of the counter-form (in): it spreads the clamp pressure between the stations. */
export const COUNTER_WALL_IN = 2;
/** Room left in the counter-form channel beyond the strips' thickness (in): packing tape on both faces, the glue line and the squeeze-out. */
export const COUNTER_CLEARANCE_IN = 1 / 32;
/** Guide hole through a laser-cut template for a 1/8 in drill (in): 9/64. */
const GUIDE_HOLE_IN = 9 / 64;
const STACK_SCREW_IN = 6;
/** The rail form stands this much taller than the rail is deep, so the strips never ride over its top (in). */
const FORM_OVERHEIGHT_IN = 0.5;
/** Room on the rail-form base in front of the face for the strips, the caul and the clamp jaws (in). */
const BASE_FRONT_IN = 6;
/** Base overhang past the ends of a form or a ramp (in). */
const BASE_END_IN = 3;
/** HOW TO BUILD IT panel: text size and line pitch (in). */
const BUILD_TEXT_IN = 0.15, BUILD_LINE_IN = 0.21;

// Sheet layout (in): margins around the content for dimension lines, and the title block below it.
const MARGIN_IN = 1.3;
const TITLE_H_IN = 2;

export interface FormDim {
  key: string;
  label: string;
  /** The number (inches, a count, or degrees): for tests and sums. Shop text uses `text`. */
  valueIn: number;
  kind: 'length' | 'count' | 'angle';
  /** The value as the shop reads it: a fraction with the inch mark (`59-1/2"`), a count with its noun (`15 cleats`), or whole degrees (`11°`). Never a decimal. */
  text: string;
}
const lenDim = (key: string, label: string, valueIn: number): FormDim => ({ key, label, valueIn, kind: 'length', text: frac(valueIn) });
const countDim = (key: string, label: string, n: number, noun: string): FormDim => ({ key, label, valueIn: n, kind: 'count', text: `${n} ${n === 1 ? noun : noun.endsWith('s') ? noun : `${noun}s`}` });
const angleDim = (key: string, label: string, deg: number): FormDim => ({ key, label, valueIn: deg, kind: 'angle', text: `${Math.round(deg)}°` });

/** One step of building a form: what to make, in order. `sub` are its parts (a, b, c ...). */
export interface FormBuildStep { step: string; sub?: string[] }

export interface FormDrawing {
  id: string;
  title: string;
  fileName: string;
  svg: string;
  /** Size of the whole sheet (in). */
  widthIn: number;
  heightIn: number;
  dims: FormDim[];
  notes: string[];
  /** How to build the form or template, step by step. */
  build: FormBuildStep[];
  /** What the XTool S1 laser cuts for this drawing (D-86), or absent when nothing here is laser work. */
  laser?: FormLaser[];
}

/** The laser work in a form drawing: the 1/4 in pieces (templates, patterns), as shapes in inches, ready to lay out on the bed. */
export interface FormLaser {
  /** `side-template`, `crown-templates` ...: the laser file's name stem. */
  id: string;
  title: string;
  material: string;
  thicknessIn: number;
  items: LaserItem[];
  /** Plain-word notes for the file (which layers, which face up, what the seam is). */
  notes: string[];
}

/** A small section sketch (not to scale) drawn in the title block: its size (in) and a draw function given its lower-left corner in sheet coordinates (y up). */
interface Sketch { w: number; h: number; title: string; draw: (at: Vec2, sheet: Xf) => { paths: string; labels: string } }

interface Plan {
  id: string;
  title: string;
  /** Content size (in): the part of the drawing inside the margins. */
  w: number;
  h: number;
  /** Draw the content; `place` maps content coordinates (u right, v up, origin lower left) to the sheet (SVG user units). */
  draw: (place: Xf) => string;
  dims: FormDim[];
  notes: string[];
  subtitle: string[];
  build: FormBuildStep[];
  sketch?: Sketch;
  laser?: FormLaser[];
}

/** Wrap a line of text to about `chars` characters. */
function wrap(t: string, chars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(' ')) { if ((cur + ' ' + w).trim().length > chars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out;
}

function finishDrawing(plan: Plan, p: Params, date?: string): FormDrawing {
  const W = plan.w + 2 * MARGIN_IN;
  const rev = `revision ${hash6(JSON.stringify(p))}${date ? `, ${date}` : ''}`;
  const lines = [...plan.subtitle, `Scale 1:1 (full size), units: inches. Check the 1 in square before use.`, `Klondike sled, Troop 455. Design ${rev}.`];
  // The HOW TO BUILD IT panel: numbered steps, lettered sub-steps, wrapped to the room left by the sketch and the check square.
  const sk = plan.sketch;
  // a readable column, at most 11" wide (a long line on a 44" sheet is hard to follow); the sketch sits to its right
  const textW = Math.min(11, W - 0.8 - (sk ? sk.w + 0.5 : 0) - 1.9);
  const chars = Math.max(36, Math.floor(textW / (BUILD_TEXT_IN * 0.55)));
  const rows: Array<{ t: string; x: number; bold?: boolean }> = [{ t: 'HOW TO BUILD IT', x: 0.4, bold: true }];
  plan.build.forEach((st, i) => {
    wrap(`${i + 1}. ${st.step}`, chars).forEach((l, k) => rows.push({ t: l, x: k ? 0.7 : 0.4 }));
    (st.sub ?? []).forEach((sub, k) => wrap(`${String.fromCharCode(97 + k)}) ${sub}`, chars - 4).forEach((l, m) => rows.push({ t: l, x: m ? 1.0 : 0.7 })));
  });
  const headH = 0.75 + lines.length * 0.24;
  const panelH = rows.length * BUILD_LINE_IN + 0.2;
  const titleH = Math.max(TITLE_H_IN, headH + Math.max(panelH, sk ? sk.h + 0.6 : 0) + 0.35);
  const H = plan.h + 2 * MARGIN_IN + titleH;
  const place: Xf = ([u, v]) => [MARGIN_IN + u, H - (MARGIN_IN + titleH + v)];
  const sheet: Xf = ([x, y]) => [x, H - y]; // sheet coordinates: origin lower left of the whole sheet
  const tb: string[] = [];
  tb.push(guideEl(polyD(rectLoop(0.2, 0.2, W - 0.2, titleH - 0.2), sheet), { label: 'title block' }));
  tb.push(textEl(sheet([0.4, titleH - 0.55]), plan.title, 0.32, { bold: true, guide: true }));
  lines.forEach((l, i) => tb.push(textEl(sheet([0.4, titleH - 0.95 - i * 0.24]), l, 0.17, { guide: true })));
  const y0 = titleH - headH - 0.2;
  rows.forEach((r, i) => tb.push(textEl(sheet([r.x, y0 - i * BUILD_LINE_IN]), r.t, r.bold ? 0.19 : BUILD_TEXT_IN, { bold: r.bold, guide: true })));
  tb.push(checkSquareEls([W - 1.6, 0.35], sheet));
  let sketch = '';
  if (sk) {
    const at: Vec2 = [Math.min(0.4 + textW + 0.6, W - 1.9 - sk.w), y0 - 0.25 - sk.h];
    const d = sk.draw(at, sheet);
    tb.push(textEl(sheet([at[0], at[1] + sk.h + 0.25]), sk.title, 0.17, { bold: true, guide: true }), d.labels);
    sketch = `<g id="sketch">${d.paths}</g>`;
  }
  const body = plan.draw(place) + sketch + `<g id="titleblock" ${ANNOTATION_ATTRS}>${tb.join('')}</g>`;
  const desc = [plan.title, ...plan.subtitle, ...plan.notes, 'HOW TO BUILD IT:', ...plan.build.flatMap((st, i) => [`${i + 1}. ${st.step}`, ...(st.sub ?? []).map((x, k) => `   ${String.fromCharCode(97 + k)}) ${x}`)])].join('\n');
  const svg = svgDocument({ widthIn: W, heightIn: H, title: `${plan.title} (1:1)`, desc, body });
  return { id: plan.id, title: plan.title, fileName: `${plan.id}.svg`, svg, widthIn: W, heightIn: H, dims: plan.dims, notes: plan.notes, build: plan.build, ...(plan.laser ? { laser: plan.laser } : {}) };
}

/** A rectangle (sketch inches, lower-left x, y, width, height) as a guide path at `at`, scaled by `k`. */
const skRect = (at: Vec2, k: number, sheet: Xf, x: number, y: number, w: number, h: number, dashed = false): string => guideEl(polyD(rectLoop(at[0] + x * k, at[1] + y * k, at[0] + (x + w) * k, at[1] + (y + h) * k), sheet), { dashed });
const skLine = (at: Vec2, k: number, sheet: Xf, a: Vec2, b: Vec2): string => guideEl(polyD([[at[0] + a[0] * k, at[1] + a[1] * k], [at[0] + b[0] * k, at[1] + b[1] * k]], sheet, false));
/** A label with a leader from a sketch point to the text (text position in sketch inches). */
const skLabel = (at: Vec2, k: number, sheet: Xf, pt: Vec2, tx: Vec2, text: string): { path: string; label: string } => ({
  path: skLine(at, k, sheet, pt, [tx[0] - 0.05 / k, tx[1] + 0.05 / k]),
  label: textEl(sheet([at[0] + tx[0] * k, at[1] + tx[1] * k]), text, 0.13, { guide: true }),
});

// ── Shared pieces ──
/** A shape with score lines added (the marks the laser draws on a template). */
const withScore = (s: LaserShape, lines: Vec2[][]): LaserShape => ({ ...s, score: [...s.score, ...lines] });
const outsideCut = (loop: Vec2[], place: Xf, depth: number, label: string): string => pathEl({ cutType: 'outside', d: polyD(loop, place), depthIn: depth + BREAKTHROUGH_IN, label });
const label = (place: Xf, at: Vec2, text: string, size = 0.18, anchor: 'start' | 'middle' | 'end' = 'start'): string => textEl(place(at), text, size, { anchor, guide: true });
const dimTo = (place: Xf, a: Vec2, b: Vec2, text: string, off = 0.6): string => dimensionEls(a, b, text, place, off);
/** A length for the shop: a fraction to 1/32 with the inch mark. */
const inch = (v: number): string => frac(v);

const pathLength = (pts: Vec2[]): number => pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);

/** The point and unit left-normal at arc length `s` along a polyline. */
function atArc(pts: Vec2[], s: number): { p: Vec2; n: Vec2 } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= s || i === pts.length - 1) {
      const t = d ? Math.max(0, Math.min(1, (s - acc) / d)) : 0;
      const dx = (pts[i][0] - pts[i - 1][0]) / (d || 1), dy = (pts[i][1] - pts[i - 1][1]) / (d || 1);
      return { p: [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])], n: [-dy, dx] };
    }
    acc += d;
  }
  return { p: pts[0], n: [0, 1] };
}

// ── (a) The sandwich side: cleat-line template and the S-ramp ──
function sideFormPlan(parts: Part[], p: Params, L: Layout): Plan | null {
  const web = parts.find((x) => x.id === 'side-L-web');
  const f = web && flatPattern(web);
  if (!web || !f) return null;
  const z0 = L.chineBot;
  const uOf = (x: number): number => f.toPattern([x, 0, 0])[0];
  const xs = samples(L.xSideStart, L.xSideEnd, 160);
  const line = (zOf: (x: number) => number): Vec2[] => xs.map((x) => [uOf(x), zOf(x) - z0] as Vec2);
  const sheer = line((x) => sideTopAt(L, x));
  const gunBot = line((x) => sideTopAt(L, x) - L.railBand);
  const chineTop = L.chineBot + L.chineH - z0;
  const innerChineBot = L.chineBot + L.ply + p.deckSlopIn - z0; // the inner chine band starts a deck + clearance up: the gap the deck edge rises into
  const sheerLen = pathLength(sheer);
  const nCleat = Math.ceil(sheerLen / CLEAT_SPACING_IN) + 1;
  const cleatStep = sheerLen / (nCleat - 1);
  const templateH = Math.max(...sheer.map((q) => q[1]), f.heightIn);

  // The S-ramp: height = the turn-in at each station (the web lies flat, so the plan S becomes a rise), from the S start to the bow end, then flat.
  const hasRamp = L.taper.turnIn > 0.01;
  const xR0 = L.taper.x0, xR1 = L.taper.x1, xRe = L.xSideEnd;
  const rampXs = samples(xR0, xRe, 48);
  const rampProfile: Vec2[] = rampXs.map((x) => [uOf(x), RIB_BASE_IN + L.turnIn(x)]); // on a RIB_BASE_IN base: the web's rise is the turn-in above the 1/4 in template
  const rampH = hasRamp ? L.turnIn(xRe) : 0;
  const webTallAtBow = Math.max(...rampXs.map((x) => sideTopAt(L, x) - L.chineBot));
  const ribs = Math.ceil(webTallAtBow / CLEAT_SPACING_IN) + 1;
  const ribPitch = ribs > 1 ? webTallAtBow / (ribs - 1) : 0;
  // The MIRROR ramp (second face): the first cure leaves the web with its S, so turned over its bow end hangs `rampH` LOWER than its rear. The mirror ramp is the first one upside down:
  // a plateau `rampH` higher than the bow end under the whole flat part, falling through the S. Its ribs run the full web length and span the web's full height at the rear.
  const mirrorRibs = Math.ceil(f.heightIn / CLEAT_SPACING_IN) + 1;
  const mirrorPitch = mirrorRibs > 1 ? f.heightIn / (mirrorRibs - 1) : 0;
  const mirrorProfile: Vec2[] = rampXs.map((x) => [uOf(x), RIB_BASE_IN + rampH - L.turnIn(x)]);
  const mirrorLen = uOf(xRe);
  const webLowIn = RIB_BASE_IN + TEMPLATE_STOCK_IN; // the web's underside above the bench where the ramp starts (rising ramp) or where it ends (mirror ramp)
  const webHighIn = webLowIn + rampH;
  const GAP = 1.6;
  const rampBlock = hasRamp ? RIB_BASE_IN + rampH + GAP : 0;
  const mirrorBlock = hasRamp ? RIB_BASE_IN + rampH + GAP : 0;
  const w = f.widthIn, h = templateH + rampBlock + mirrorBlock + 0.8;
  // The LASER pieces (D-86): the web outline with the layout lines scored on it. The web is cut in bands that butt on the bench only if it is wider than the bed (and across the S start when there is a ramp: the
  // rear piece lies under the flat part, the front piece is the ramp's neighbor).
  const uS0 = uOf(xR0);
  const tplLines: Vec2[][] = [sheer, gunBot, [[0, chineTop], [w, chineTop]], [[uOf(L.xSideStart), innerChineBot], [w, innerChineBot]]];
  const tplMarks: Array<{ c: Vec2; dia: number }> = [];
  for (let i = 0; i < nCleat; i++) {
    const { p: q, n } = atArc(sheer, i * cleatStep);
    const nn: Vec2 = n[1] >= 0 ? n : [-n[0], -n[1]];
    const tip: Vec2 = [q[0] + nn[0] * 0.6, q[1] + nn[1] * 0.6];
    tplLines.push([q, tip]);
    tplMarks.push({ c: tip, dia: 0.19 });
  }
  if (hasRamp) for (const x of [xR1, xRe]) tplLines.push([[uOf(x), 0], [uOf(x), templateH]]);
  const tplShape: LaserShape = { ...emptyShape('web-template', 'Web template', f.outer), score: tplLines, marks: tplMarks };
  const rearBands = hasRamp ? fitToBed(clipShape(tplShape, 'u', uS0, 'lo', 'web-template-rear', 'Web template, rear piece')) : [];
  const underItems: LaserItem[] = rearBands.map((shape): LaserItem => ({ shape: { ...shape, id: shape.id.replace('web-template', 'web-template-under'), label: shape.label.replace('Web template', 'Web template, under layer'), score: [], marks: [] }, qty: 1 }));
  const tplItems: LaserItem[] = hasRamp
    ? [
        ...rearBands.map((shape): LaserItem => ({ shape, qty: 1 })),
        ...fitToBed(clipShape(tplShape, 'u', uS0, 'hi', 'web-template-front', 'Web template, front piece')).map((shape): LaserItem => ({ shape, qty: 1 })),
      ]
    : fitToBed(tplShape).map((shape): LaserItem => ({ shape, qty: 1 }));
  const banded = tplItems.some((it) => /-(lower|upper)$/.test(it.shape.id));
  const tplPieces = tplItems.reduce((n, it) => n + it.qty, 0) + underItems.length;
  const dims: FormDim[] = [
    lenDim('web-length', 'Web flat length (development)', f.widthIn),
    lenDim('web-height', 'Web height at the rear', f.heightIn),
    lenDim('sheer-length', 'Sheer line length (cleat line)', sheerLen),
    lenDim('cleat-spacing', 'Cleat spacing along the sheer', cleatStep),
    countDim('cleat-count', 'Cleats on the sheer line', nCleat, 'cleat'),
  ];
  if (hasRamp) dims.push(
    lenDim('ramp-rise', 'S-ramp rise (= the turn-in per side)', rampH),
    lenDim('ramp-length', 'S-ramp length (from the S start to the bow end)', uOf(xRe) - uOf(xR0)),
    lenDim('s-length', 'S (taper) length', uOf(xR1) - uOf(xR0)),
    countDim('ramp-ribs', 'S-ramp ribs (3/4" MDF)', ribs, 'rib'),
    lenDim('rib-base', 'Rib base under the profile (least rib thickness)', RIB_BASE_IN),
    countDim('mirror-ribs', 'Mirror-ramp ribs (3/4" MDF, full web length)', mirrorRibs, 'rib'),
    lenDim('mirror-rib-height', 'Mirror-ramp rib height at the rear (falls to the base at the bow end)', RIB_BASE_IN + rampH),
  );
  // ── How to build it ──
  const bandOf = (id: string) => parts.find((x) => x.id === id);
  const bandText = (id: string, fallback: string): string => { const st = bandOf(id)?.stock; return st ? `${frac(st.t)} × ${frac(st.w)}` : fallback; };
  const outChine = bandText('side-L-chine', 'oak strip'), outGun = bandText('side-L-gunwale', 'oak strip');
  const inChine = bandText('side-L-chine-in', 'oak strip'), inGun = bandText('side-L-gunwale-in', 'oak strip');
  const clampsPerBand = Math.ceil(f.widthIn / CLEAT_SPACING_IN) + 1;
  const rampLen = uOf(xRe) - uOf(xR0);
  const capW = (ribs - 1) * ribPitch + RIB_STOCK_IN + 1;
  // The mirror cap is the web's own outline plus a margin each side: the ribs stand across the web's full height (their centers on its two edges), so the cap is the web's height plus `CAP_MARGIN_IN` each side. (It was the rib span plus the rib thickness plus 1", wider than the web by 1-3/4" for no reason.)
  const mirrorCapW = f.heightIn + 2 * CAP_MARGIN_IN;
  const notes = [
    `Lay the web FLAT on the bench on this template: ${inch(f.widthIn)} along the plan curve, ${inch(f.heightIn)} tall at the rear.`,
    `Cleat the sheer line: ${nCleat} cleats ${inch(cleatStep)} apart, on the high side of the line. A straight 1-1/2" strip bent to the sheer pushes sideways about 65 lbf per band at mid-span until the epoxy cures.`,
    hasRamp
      ? `S-ramp (first face): the bow end of the web rides up it. Rise ${inch(rampH)} (the turn-in per side); the S runs from ${inch(uOf(xR0))} to ${inch(uOf(xR1))} along the web, then level to the bow end of the bands at ${inch(uOf(xRe))}. The web ends at ${inch(f.widthIn)}; its last ${inch(f.widthIn - uOf(xRe))} runs into the bulkhead dado, level. ${ribs} ribs of ${frac(RIB_STOCK_IN)} MDF ${frac(ribPitch)} apart under the ${inch(webTallAtBow)} the web stands at the bow, capped with 1/4" hardboard; no rib is thinner than ${inch(RIB_BASE_IN)}.`
      : 'No bow turn-in at these params: no ramp is needed.',
    ...(hasRamp ? [`Mirror ramp (second face): the first cure leaves the web with its S, so turned over its bow end hangs ${inch(rampH)} lower than its rear end and the rising ramp cannot take it. The mirror ramp is a second set of ${mirrorRibs} ribs ${frac(mirrorPitch)} apart, the full ${inch(mirrorLen)} of the bands, ${inch(RIB_BASE_IN + rampH)} tall from the rear end to the S start and falling through the S to ${inch(RIB_BASE_IN)} at the bow end (the lowest profile on this drawing). The web's underside then sits ${inch(webHighIn)} above the bench at the rear and ${inch(webLowIn)} at the bow end.`] : []),
    'Lines on the drawing: sheer (cleat line), gunwale band lower edge, web top, chine band top, inner chine band bottom, web bottom. The template and rib outlines are outside cuts for the Shaper.',
  ];
  const build: FormBuildStep[] = [
    { step: `BENCH TOP: a flat sheet of 3/4" plywood or MDF at least ${frac(f.widthIn + 2 * BASE_END_IN)} × ${frac(f.heightIn + 2 * BASE_END_IN)} (the web is ${frac(f.widthIn)} × ${frac(f.heightIn)}). It is sacrificial: the cleats and ribs are screwed into it.${hasRamp ? ' The mirror ramp (the MIRROR RAMP item below) takes a second one the same size.' : ''}` },
    {
      step: `TEMPLATE (laser): the web's flat outline (the outer line of this drawing) in ${frac(TEMPLATE_STOCK_IN)} plywood, cut on the laser as ${tplPieces} pieces${hasRamp ? ' (two files: the template, and the under layer of the rear piece)' : ''}. ${banded ? `The web is ${frac(f.heightIn)} tall at the rear, wider than the bed, so the file cuts it in bands that butt on the bench.` : `The web is ${frac(f.heightIn)} tall at the rear, which the bed takes.`}`,
      sub: [
        'The laser scores the sheer (cleat line), the gunwale band lower edge, the chine band top, the inner chine band bottom, the S end, the bow end of the bands and a tick for each cleat.',
        ...(hasRamp ? [`The file cuts it square at the "S starts" line, ${frac(uS0)} from the rear end. The rear piece lies under the flat part of the web; the ramp takes the front piece's place. Keep the front piece to mark the web.`, `The ramp cap puts its low end ${frac(webLowIn)} above the bench, ${frac(RIB_BASE_IN)} above the template. Glue a second rear piece (its own laser file) under the first so the web runs onto the ramp with no step.`] : []),
        `${banded ? 'Butt the bands tight on the bench, matching the scored lines across the seam, and screw' : 'Screw'} the pieces down with #8 × 3/4" flat-heads about every 12", heads flush.`,
      ],
    },
    {
      step: `CLEATS on the sheer line: ${nCleat} blocks of 3/4" plywood or oak, 3/4" × 1-1/2" × 3" long, ${frac(cleatStep)} apart (numbered 1 to ${nCleat} on this drawing).`,
      sub: [
        'Screw each with two #8 × 1-1/4" screws into the bench, its long edge on the sheer line and the block on the high side, so the top edge of the gunwale band being glued bears on it.',
        ...(hasRamp ? [`Where the web rides up the ramp, stand each cleat on a spacer (plywood scraps screwed to the bench) as tall as the web's underside there: ${frac(webLowIn)} up to the S start, rising to ${frac(webHighIn)} at the bow end.`] : []),
        'Cover the cleat faces with packing tape.',
      ],
    },
    ...(hasRamp ? [{
      step: `S-RAMP (first face): cut ${ribs} ribs from ${frac(RIB_STOCK_IN)} MDF to the first rib profile at the bottom of this drawing: ${frac(rampLen)} long, ${frac(RIB_BASE_IN)} tall at the low (rear) end and ${frac(RIB_BASE_IN + rampH)} at the high (bow) end.`,
      sub: [
        `Stand the ribs on edge on the bench, along the web's length, ${frac(ribPitch)} apart center to center (they span the ${frac(webTallAtBow)} the web stands at the bow); the low ends butt the template at the S start.`,
        'Fix each rib with two glue blocks (3/4" × 3/4" × 3"), screwed to the bench and the rib, one each side.',
        `Cap: ${frac(TEMPLATE_STOCK_IN)} hardboard ${frac(rampLen)} × ${frac(capW)}, glued and bradded to the rib tops. Tape it.`,
      ],
    }, {
      step: `MIRROR RAMP (second face): the first cure leaves the web with its S, so turned over its bow end hangs ${frac(rampH)} lower than its rear end. Build the ramp upside down: high at the rear, falling to the bench at the bow end.`,
      sub: [
        `Cut ${mirrorRibs} ribs from ${frac(RIB_STOCK_IN)} MDF to the mirror rib profile (the lowest on this drawing): ${frac(mirrorLen)} long, ${frac(RIB_BASE_IN + rampH)} tall from the rear end to the S start, then falling through the S to ${frac(RIB_BASE_IN)} tall at the bow end.`,
        `Stand them on edge on the second bench top, ${frac(mirrorPitch)} apart center to center across the ${frac(f.heightIn)} the web stands at the rear, with two glue blocks each as for the first ramp.`,
        `Cap: ${frac(TEMPLATE_STOCK_IN)} hardboard cut to the web's outline plus ${frac(CAP_MARGIN_IN)} all round (a second template): ${frac(mirrorCapW)} wide at the rear, the web's ${frac(f.heightIn)} plus ${frac(CAP_MARGIN_IN)} each side, so it covers the ribs. Glue and brad it to the rib tops. Tape it. The web's underside now sits ${frac(webHighIn)} above the bench at the rear and ${frac(webLowIn)} at the bow end.`,
        `Re-fix the ${nCleat} cleats on the sheer line, each on a spacer as tall as the web's underside there (${frac(webHighIn)} at the rear, falling to ${frac(webLowIn)} at the bow end).`,
      ],
    }] : []),
    { step: 'TAPE: packing tape over the template wherever a band lies (the epoxy squeezes out at the band edges).' },
    {
      step: `GLUE-UP, one face per cure. Face one${hasRamp ? ', on the S-ramp' : ''}: lay the web on the template INSIDE face up${hasRamp ? ' (the ramp lifts the bow end toward the inside, which is the turn-in)' : ''}, and epoxy the inner chine band (${inChine}) and the inner gunwale band (${inGun}) to it, the gunwale band against the cleats. Leave the deck gap: the inner chine band stops short of the web bottom.`,
      sub: [
        `Clamp each band to the web every ${frac(CLEAT_SPACING_IN)}: about ${clampsPerBand} spring clamps or small C-clamps per band (${2 * clampsPerBand} per cure).`,
        `No spring-back allowance: the cleats hold the sheer${hasRamp ? ' and the ramp holds the S' : ''} until the epoxy cures (24 h).`,
        hasRamp ? `Face two: flip the web over onto the MIRROR ramp (never the same ramp: the cured web would have to bend back ${frac(2 * rampH)}), sheer line against the cleats, and glue the outer chine band (${outChine}) and the outer gunwale band (${outGun}) the same way. Two cures per side.` : `Face two: flip the web over onto the same template and glue the outer chine band (${outChine}) and the outer gunwale band (${outGun}) the same way. Two cures per side.`,
        'Build the right side the same way.',
      ],
    },
  ];
  const sketch: Sketch | undefined = hasRamp && ribs > 1 ? {
    w: (capW + 6) * 0.5, h: (RIB_BASE_IN + rampH + 2.2) * 0.5, title: 'S-ramp, section across it at the bow end (not to scale)',
    draw: (at, sheet) => {
      const k = 0.5, paths: string[] = [], labels: string[] = [];
      const top = RIB_BASE_IN + rampH;
      paths.push(skLine(at, k, sheet, [-0.5, 0], [capW + 0.5, 0]));
      for (let i = 0; i < ribs; i++) { const x = 0.5 + i * ribPitch; paths.push(skRect(at, k, sheet, x, 0, RIB_STOCK_IN, top), skRect(at, k, sheet, x - 0.75, 0, 0.75, 0.75, true)); }
      paths.push(skRect(at, k, sheet, 0, top, capW, TEMPLATE_STOCK_IN));
      paths.push(skRect(at, k, sheet, 0.3, top + TEMPLATE_STOCK_IN, capW - 0.6, 0.16, true));
      for (const [pt, tx, t] of [[[capW, 0], [capW + 0.8, -0.1], 'bench top'], [[0.5 + RIB_STOCK_IN / 2, top / 2], [capW + 0.8, top / 2 - 0.4], `${ribs} ribs, ${frac(RIB_STOCK_IN)} MDF, ${frac(ribPitch)} apart`], [[capW - 0.2, top + 0.1], [capW + 0.8, top + 0.1], `cap, ${frac(TEMPLATE_STOCK_IN)} hardboard, taped`], [[capW - 0.5, top + 0.35], [capW + 0.8, top + 0.75], 'web + bands on the cap'], [[0.5 - 0.4, 0.4], [-0.5, -0.9], 'glue blocks']] as Array<[Vec2, Vec2, string]>) {
        const l = skLabel(at, k, sheet, pt, tx, t); paths.push(l.path); labels.push(l.label);
      }
      return { paths: paths.join(''), labels: labels.join('') };
    },
  } : undefined;
  return {
    id: 'side-form', title: 'Sandwich side: cleat-line template and S-ramp', w, h, dims, notes, build, ...(sketch ? { sketch } : {}),
    laser: [
      {
        id: 'side-template', title: 'Sandwich side: web template', material: '1/4" Baltic birch plywood', thicknessIn: TEMPLATE_STOCK_IN, items: tplItems,
        notes: [
          `The web is ${inch(f.widthIn)} × ${inch(f.heightIn)}; the bed is ${inch(LASER_MAX_WIDTH_IN)} wide.${banded ? ' The template is cut in bands that butt on the bench.' : ''}${hasRamp ? ' It is cut in a rear piece and a front piece, square at the S start.' : ''}`,
          'Score lines: sheer (cleat line), gunwale band lower edge, chine band top, inner chine band bottom, S end, bow end of the bands; a tick and circle for each cleat, from the rear to the bow.',
          'The ramp caps and the mirror-ramp cap are plain rectangles from the drawing: saw them. The ribs are 3/4 in MDF: bandsaw or Shaper.',
        ],
      },
      ...(hasRamp ? [{
        id: 'side-template-under-layer', title: 'Sandwich side: web template, under layer of the rear piece', material: '1/4" Baltic birch plywood', thicknessIn: TEMPLATE_STOCK_IN, items: underItems,
        notes: ['The second layer of the rear piece, glued under the first so the web runs onto the ramp with no step. A separate job, so each run stays about 5 ft long.'],
      }] : []),
    ],
    subtitle: [`Web ${inch(f.widthIn)} × ${inch(f.heightIn)}; ${nCleat} cleats ${inch(cleatStep)} apart; ${hasRamp ? `S-ramp rise ${inch(rampH)}, with a mirror ramp for the second face` : 'no ramp'}.`],
    draw: (place) => {
      const v0 = rampBlock + mirrorBlock; // the template sits above the ramp drawings
      const T: Xf = ([u, v]) => place([u, v + v0]);
      const out: string[] = [];
      out.push(`<g id="template">${outsideCut(f.outer, T, TEMPLATE_STOCK_IN, 'web flat outline (template)')}</g>`);
      const g: string[] = [];
      g.push(guideEl(polyD(sheer, T, false), { label: 'sheer line (cleat line)' }), guideEl(polyD(gunBot, T, false), { dashed: true, label: 'gunwale band lower edge' }));
      g.push(guideEl(polyD([[0, chineTop], [w, chineTop]], T, false), { dashed: true, label: 'chine band top' }), guideEl(polyD([[uOf(L.xSideStart), innerChineBot], [w, innerChineBot]], T, false), { dashed: true, label: 'inner chine band bottom' }));
      g.push(label(T, [w * 0.5, sheer[Math.floor(sheer.length / 2)][1] + 0.35], 'SHEER LINE (cleat line)', 0.2, 'middle'));
      for (let i = 0; i < nCleat; i++) {
        const { p: q, n } = atArc(sheer, i * cleatStep);
        const nn: Vec2 = n[1] >= 0 ? n : [-n[0], -n[1]];
        const tip: Vec2 = [q[0] + nn[0] * 0.6, q[1] + nn[1] * 0.6];
        g.push(guideEl(polyD([q, tip], T, false)), guideEl(circleD(tip, 0.19, T)), label(T, [tip[0], tip[1] + 0.25], String(i + 1), 0.13, 'middle'));
      }
      if (hasRamp) {
        for (const [x, t] of [[xR0, 'S starts'], [xR1, 'S ends'], [xRe, `bands end; web ends ${inch(f.widthIn)}`]] as const) {
          g.push(guideEl(polyD([[uOf(x), -v0 + GAP * 0.4], [uOf(x), templateH]], T, false), { dashed: true }), label(T, [uOf(x) + 0.1, templateH + 0.3], `${t} (${inch(uOf(x))})`, 0.15));
        }
      }
      g.push(dimTo(T, [0, 0], [w, 0], `web length ${inch(f.widthIn)}`, -0.7));
      g.push(dimTo(T, [0, 0], [0, f.heightIn], `${inch(f.heightIn)}`, 0.7));
      out.push(`<g id="guides" ${ANNOTATION_ATTRS}>${g.join('')}</g>`);
      if (hasRamp) {
        const R: Xf = ([u, v]) => place([u, v + mirrorBlock]);
        const poly: Vec2[] = [[uOf(xR0), 0], ...rampProfile, [uOf(xRe), 0]]; // flat bottom; the least thickness is RIB_BASE_IN (the profile starts on it)
        out.push(`<g id="ramp">${outsideCut(poly, R, RIB_STOCK_IN, 'S-ramp rib profile (first face)')}</g>`);
        out.push(`<g id="rampdims" ${ANNOTATION_ATTRS}>${dimTo(R, [uOf(xRe), RIB_BASE_IN], [uOf(xRe), RIB_BASE_IN + rampH], `rise ${inch(rampH)} above the ${inch(RIB_BASE_IN)} base`, -0.7)}${dimTo(R, [uOf(xR0), 0], [uOf(xRe), 0], `ramp length ${inch(uOf(xRe) - uOf(xR0))}`, -0.6)}${dimTo(R, [uOf(xR0), 0], [uOf(xR1), 0], `S ${inch(uOf(xR1) - uOf(xR0))}`, -1.2)}${label(R, [uOf(xR0), RIB_BASE_IN + rampH + 0.4], `S-RAMP rib profile, first face (cut ${ribs} from ${frac(RIB_STOCK_IN)} MDF); rise = turn-in per side on a ${inch(RIB_BASE_IN)} base`, 0.2)}</g>`);
        const M: Xf = ([u, v]) => place([u, v]);
        const mpoly: Vec2[] = [[0, 0], [0, RIB_BASE_IN + rampH], ...mirrorProfile, [uOf(xRe), 0]];
        out.push(`<g id="mirrorramp">${outsideCut(mpoly, M, RIB_STOCK_IN, 'mirror-ramp rib profile (second face)')}</g>`);
        out.push(`<g id="mirrordims" ${ANNOTATION_ATTRS}>${dimTo(M, [0, 0], [0, RIB_BASE_IN + rampH], `${inch(RIB_BASE_IN + rampH)} at the rear`, 0.7)}${dimTo(M, [uOf(xRe), 0], [uOf(xRe), RIB_BASE_IN], `${inch(RIB_BASE_IN)} at the bow end`, -0.7)}${dimTo(M, [0, 0], [uOf(xRe), 0], `rib length ${inch(mirrorLen)}`, -0.6)}${label(M, [0, RIB_BASE_IN + rampH + 0.4], `MIRROR-RAMP rib profile, second face (cut ${mirrorRibs} from ${frac(RIB_STOCK_IN)} MDF): the S-ramp upside down`, 0.2)}</g>`);
      }
      return out.join('');
    },
  };
}

// ── (b) The rail bending form ──
function railFormPlan(parts: Part[], p: Params, L: Layout): Plan | null {
  const rail = parts.find((x) => x.id === 'rail-L');
  if (!rail || rail.geometry.type !== 'mesh' || !rail.geometry.profile) return null;
  const t = rail.geometry.thickness ?? 0;
  const plies = rail.plies ?? 1;
  const strip = t / plies;
  const xEnd = L.railEnd;
  const xStart = Math.max(L.xSideStart, L.taper.x0 - RAIL_FORM_LEAD_IN);
  const xsF = samples(xStart, xEnd, Math.max(8, Math.ceil((xEnd - xStart) / 1)));
  // The outer (hull-outside) face of the rail is the hull's outer plan curve: the chine, gunwale and rail outer faces are one curve (frame.ts, layout.ts).
  const yOut = (x: number): number => outerHalfWidth(L, x);
  const yMin = Math.min(...xsF.map(yOut));
  const face: Vec2[] = xsF.map((x) => [x - xStart, yOut(x) - yMin + FORM_DEPTH_IN]);
  const turn = L.taper.turnIn;
  const lengthIn = xEnd - xStart;
  const body: Vec2[] = [[0, 0], [lengthIn, 0], ...[...face].reverse()];
  const clamps = Math.ceil((xEnd - L.taper.x0) / CLEAT_SPACING_IN) + 1;
  // The COUNTER-FORM (clamping block, D-86): the reverse image of the form. Its face is the form face moved out along the normal by the thickness of the glued strips, so the pack lies in a
  // channel of exactly its own thickness; its back is straight and parallel to the form's back, so every clamp is square to both backs and presses straight across, wherever it stands.
  const pack = plies * strip;
  const inner: Vec2[] = face.map((q, i) => {
    const a = face[Math.max(0, i - 1)], b = face[Math.min(face.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [q[0] - (dy / l) * (pack + COUNTER_CLEARANCE_IN), q[1] + (dx / l) * (pack + COUNTER_CLEARANCE_IN)] as Vec2; // the left normal (up, away from the body)
  });
  const vTop = Math.max(...inner.map((q) => q[1])) + COUNTER_WALL_IN;
  const counter: Vec2[] = [...inner, [inner[inner.length - 1][0], vTop], [inner[0][0], vTop]];
  const counterGap = 2.2;
  const [sb0, sb1] = SPRINGBACK_RANGE;
  const dims: FormDim[] = [
    lenDim('form-length', 'Form length', lengthIn),
    lenDim('turn-in', 'Turn-in per side (offset at the bow)', turn),
    lenDim('strip', `Strip thickness (${plies} per rail)`, strip),
    lenDim('min-radius', 'Tightest plan radius', L.taper.minRadiusIn),
    lenDim('springback-low', 'Spring-back allowance, low end (noted, not applied)', turn * sb0),
    lenDim('springback-high', 'Spring-back allowance, high end (noted, not applied)', turn * sb1),
    countDim('clamps', 'Clamp stations', clamps, 'clamp station'),
    lenDim('counter-width', 'Counter-form width (form back to its straight clamping back)', vTop),
    lenDim('counter-wall', 'Counter-form wall behind the face (least)', COUNTER_WALL_IN),
  ];
  const formH = face.reduce((m, q) => Math.max(m, q[1]), 0) + 1.5;
  const w = lengthIn, h = formH + counterGap + vTop + 0.4;
  const stationXs: number[] = [L.taper.x0, L.taper.x1, ...Array.from({ length: clamps }, (_, i) => Math.min(xEnd, L.taper.x0 + i * ((xEnd - L.taper.x0) / Math.max(1, clamps - 1))))];
  const stations: number[] = [];
  for (let s = 0; s <= lengthIn + 1e-9; s += OFFSET_STEP_IN * 2) stations.push(s);
  const tableText = stations.filter((s) => xStart + s >= L.taper.x0 - 1e-6 && xStart + s <= L.taper.x1 + OFFSET_STEP_IN * 2).map((s) => `${frac(s)}: ${frac(yOut(xStart) - yOut(xStart + s))}`).join(';  ');
  const notes = [
    `Form face = the rails' outer face (the chine, gunwale and rail outer faces are one curve). One form serves both rails; bend the second one the other way up. Each rail is ${plies} strips, ${inch(strip)} × ${inch(rail.stock?.w ?? 0)}, glued face to face with all ${clamps} clamp stations (${frac(CLEAT_SPACING_IN)} apart) loaded.`,
    `The counter-form below the form is its reverse image: its face is the form face moved out ${inch(pack + COUNTER_CLEARANCE_IN)} (the ${plies} strips glued together plus tape and glue line), its back is straight. The clamps close the form back on the counter-form back, both straight and parallel, so every clamp presses square across instead of at an angle to the curve.`,
    `Spring-back is not built in: thin dry strips spring back about ${Math.round(sb0 * 100)}% to ${Math.round(sb1 * 100)}% of the turn-in (${inch(turn * sb0)} to ${inch(turn * sb1)} at the bow). Bend a dry strip first and, if it opens, shim the form face out by that much. Once glued, the rail holds its shape.`,
    `Tightest plan radius ${inch(L.taper.minRadiusIn)} on a ${inch(strip)} strip (radius ÷ thickness = ${fmt(Math.round(L.taper.minRadiusIn / Math.max(strip, 1e-6)))}). The S runs from ${inch(L.taper.x0)} to ${inch(L.taper.x1)}, parallel to the bulkhead after that. The rail is ${inch(xEnd - Math.min(...rail.geometry.profile.map((q) => q[0])))} long and only the last ${inch(xEnd - L.taper.x0)} is curved. Offsets from the straight line behind the S (station from the form start : offset): ${tableText}.`,
  ];
  // ── How to build it ──
  const railW = rail.stock?.w ?? 3;
  const nLayers = Math.ceil((railW + FORM_OVERHEIGHT_IN) / FORM_LAYER_IN - 1e-9);
  const stackH = nLayers * FORM_LAYER_IN;
  const deepest = FORM_DEPTH_IN + turn;
  const baseL = lengthIn + 2 * BASE_END_IN, baseW = deepest + BASE_FRONT_IN;
  const curved = xEnd - L.taper.x0;
  // The strip length is the cut list's (rough, rounded up to 1/8); what hangs off the rear of the form is what is left after the form's own length.
  const stripCut = cutListFor(parts, p).cuts.find((c) => c.piece === 'strip' && c.ids.includes(rail.id));
  const stripL = stripCut?.rough.l ?? rail.rough?.l ?? rail.stock?.l ?? lengthIn;
  const hang = Math.max(0, stripL - lengthIn);
  const clampCap = Math.ceil((vTop + 2) / 6) * 6;
  const build: FormBuildStep[] = [
    {
      step: `PATTERNS (laser): two ${frac(TEMPLATE_STOCK_IN)} plywood patterns from the laser file for this drawing, the FORM (${frac(lengthIn)} × ${frac(deepest)}, the outline above) and the COUNTER-FORM (${frac(lengthIn)} × ${frac(vTop)}, the outline below).`,
      sub: [
        `Each carries scored tick marks at the S start, the S end and the ${clamps} clamp stations, so the clamps land in the same places on both.`,
        `Check each against the drawing (or the tiled print) before using it: every bump in a pattern prints into every layer and then into the rail.`,
      ],
    },
    {
      step: `LAYERS: the form is a stack of ${nLayers} layers of ${frac(FORM_LAYER_IN)} MDF, ${frac(stackH)} tall: ${frac(stackH - railW)} taller than the ${frac(railW)} rail, so the strips never ride over it. The counter-form is a second stack of ${nLayers}, the same height.`,
      sub: [
        `Each layer: bandsaw it 1/16" proud of the pattern, stick the pattern on with double-sided tape and flush-trim with a pattern bit. The form layers follow the FORM pattern, the counter-form layers the COUNTER-FORM pattern.`,
        `Glue and screw each stack together, edges flush, and fair its face to the line with a long sanding block.`,
      ],
    },
    { step: `BASE: 3/4" plywood ${frac(baseL)} × ${frac(baseW)}. Screw the form stack to it from below (#8 × 1-5/8" every ${frac(STACK_SCREW_IN)}), its straight back on the base's back edge and ${frac(BASE_END_IN)} in from each end. That leaves ${frac(BASE_FRONT_IN)} of base in front of the deepest part of the face for the strips and the counter-form. The counter-form stands loose on the base; screw a scrap stop to the base behind its rear end so it cannot walk.` },
    { step: `STRAIGHT RUN: cut the strips ${frac(stripL)} long (the cut list's rough length); only the last ${frac(curved)} is curved. The form starts ${frac(RAIL_FORM_LEAD_IN)} ahead of the S, so about ${frac(hang)} of each strip hangs off its rear end. Screw a straight 3/4" × ${frac(stackH)} fence to the bench, in line with the lead-in face, to hold that part straight.` },
    {
      step: `COUNTER-FORM: the reverse image of the form, the clamping block. Its face is the form face moved out ${frac(pack + COUNTER_CLEARANCE_IN)}: the ${plies} strips glued together (${frac(pack)}) plus ${frac(COUNTER_CLEARANCE_IN)} for the tape and the glue line. Its back is straight and parallel to the form's back.`,
      sub: [
        `Every clamp then closes the two straight backs on each other, square, instead of pressing at an angle on a curve.`,
        `Screw a stop block to the base against each end of the counter-form, so it cannot creep along the slope of the S while the clamps tighten.`,
        `Dry-fit it with the strips in place before any glue: the channel should be snug and even from end to end, with no gap you can slide a feeler under and no place where the counter-form rides on the strips.`,
      ],
    },
    { step: 'TAPE: packing tape over the form face and the counter-form face, so the epoxy cannot glue the rail to either.' },
    { step: `SPRING-BACK: none is built in. Dry-clamp one strip first; if the bow end opens more than ${frac(turn * sb0)} when released, re-cut both patterns with the faces moved that far and try again; the channel must keep its width.` },
    {
      step: `CLAMP: ${clamps} bar or pipe clamps of ${clampCap}" capacity or more (the form back to the counter-form back is ${frac(vTop)}), one at each station ${frac(CLEAT_SPACING_IN)} apart from the S start (the scored ticks on both patterns), square across from the form back to the counter-form back, plus 2 or 3 on the straight lead-in.`,
      sub: [`Roll epoxy on both mating faces of the ${plies} strips (${frac(strip)} × ${frac(railW)}), butter one face with thickened epoxy, and stand them on edge on the base against the form face, the counter-form outside.`, 'Bend the glued strips onto the form face with the counter-form set on and every clamp snug but loose, then tighten the clamps together, the straight lead-in first and the bow end last. The counter-form only seats once the strips are fully bent.', 'Leave it clamped for the full cure, 24 h at 60 °F or warmer, before unclamping: a bent strip springs back if it comes off early. Bend the second rail on the same form, the other way up.'],
    },
  ];
  const sketch: Sketch = {
    w: (baseW + 4.5) * 0.5, h: (FORM_BASE_IN + stackH + 1.6) * 0.5, title: 'Section across the form at the bow end (not to scale)',
    draw: (at, sheet) => {
      const k = 0.5, paths: string[] = [], labels: string[] = [];
      const yb = FORM_BASE_IN, top = yb + stackH;
      paths.push(skRect(at, k, sheet, 0, 0, baseW, FORM_BASE_IN));
      for (let i = 0; i < nLayers; i++) paths.push(skRect(at, k, sheet, 0, yb + i * FORM_LAYER_IN, deepest, FORM_LAYER_IN));
      const y0 = yb + (stackH - railW) / 2;
      for (let i = 0; i < plies; i++) paths.push(skRect(at, k, sheet, deepest + i * strip, y0, strip, railW));
      for (let i = 0; i < nLayers; i++) paths.push(skRect(at, k, sheet, deepest + pack, yb + i * FORM_LAYER_IN, COUNTER_WALL_IN, FORM_LAYER_IN));
      const cx1 = deepest + pack + COUNTER_WALL_IN;
      paths.push(skRect(at, k, sheet, -0.6, top + 0.3, cx1 + 1.4, 0.3), skRect(at, k, sheet, -0.6, yb + stackH / 2, 0.35, top + 0.3 - (yb + stackH / 2)), skRect(at, k, sheet, cx1, yb + stackH / 2, 0.35, top + 0.3 - (yb + stackH / 2)));
      const lx = baseW + 0.3;
      for (const [pt, tx, t] of [[[deepest / 2, yb + FORM_LAYER_IN * 1.5], [lx, yb + stackH - 0.6], `${nLayers} layers of ${frac(FORM_LAYER_IN)} MDF, glued + screwed`], [[baseW - 0.5, FORM_BASE_IN / 2], [lx, -0.2], `base, 3/4" ply, ${frac(baseL)} × ${frac(baseW)}`], [[deepest + strip / 2, y0 + railW * 0.3], [lx, yb + 0.7], `${plies} oak strips ${frac(strip)} × ${frac(railW)}`], [[cx1 - COUNTER_WALL_IN / 2, yb + FORM_LAYER_IN * 1.5], [lx, yb + stackH - 0.05], `counter-form, ${nLayers} layers, face = form face + ${frac(pack)}`], [[cx1 + 0.6, top + 0.45], [lx, top + 0.6], `bar clamp every ${frac(CLEAT_SPACING_IN)}`]] as Array<[Vec2, Vec2, string]>) {
        const l = skLabel(at, k, sheet, pt, tx, t); paths.push(l.path); labels.push(l.label);
      }
      return { paths: paths.join(''), labels: labels.join('') };
    },
  };
  return {
    id: 'rail-form', title: 'Rail bending form (plan, left rail)', w, h, dims, notes, build, sketch,
    subtitle: [`Form ${inch(lengthIn)} long; face offset ${inch(turn)} at the bow; ${plies} strips of ${inch(strip)} per rail.`],
    laser: [{
      id: 'rail-form', title: 'Rail bending form: form pattern and counter-form pattern', material: '1/4" Baltic birch plywood', thicknessIn: TEMPLATE_STOCK_IN,
      items: [
        { shape: withScore(emptyShape('form-pattern', 'Form pattern', body), stationXs.map((x): Vec2[] => { const v = yOut(x) - yMin + FORM_DEPTH_IN; return [[x - xStart, v], [x - xStart, v - 1]]; })), qty: 1 },
        { shape: withScore(emptyShape('counter-form-pattern', 'Counter-form pattern', counter), stationXs.map((x): Vec2[] => [[x - xStart, vTop], [x - xStart, vTop - 1]])), qty: 1 },
      ].flatMap((it) => fitToBed(it.shape).map((shape): LaserItem => ({ shape, qty: it.qty }))),
      notes: [
        `Form pattern: the form outline, ${inch(lengthIn)} long, straight back at the bottom edge and the face curve on top; scored ticks mark the S start, the S end and the clamp stations just under the face.`,
        `Counter-form pattern: the face is the form face moved out ${inch(pack + COUNTER_CLEARANCE_IN)} (the strips' thickness plus tape and glue line); the back is straight. Its ticks sit just under the straight back.`,
        'Use each pattern as the flush-trim guide for every layer of its stack; either face up.',
      ],
    }],
    draw: (place) => {
      const F: Xf = ([u, v]) => place([u, v + vTop + counterGap]);
      const out: string[] = [`<g id="form">${outsideCut(body, F, RIB_STOCK_IN, 'rail form body')}</g>`];
      out.push(`<g id="counterform">${outsideCut(counter, place, RIB_STOCK_IN, 'counter-form body (reverse image of the form)')}</g>`);
      const g: string[] = [];
      g.push(guideEl(polyD(face, F, false), { label: 'form face' }));
      g.push(guideEl(polyD(inner, place, false), { label: 'counter-form face (form face moved out by the strips)' }));
      const sx = (x: number) => x - xStart;
      for (const [x, tt] of [[L.taper.x0, 'S starts'], [L.taper.x1, 'S ends']] as const) g.push(guideEl(polyD([[sx(x), 0], [sx(x), formH]], F, false), { dashed: true }), label(F, [sx(x) + 0.1, formH - 0.2], `${tt} (station ${inch(sx(x))})`, 0.16));
      for (let i = 0; i < clamps; i++) {
        const x = Math.min(xEnd, L.taper.x0 + i * ((xEnd - L.taper.x0) / (clamps - 1)));
        const q: Vec2 = [sx(x), yOut(x) - yMin + FORM_DEPTH_IN];
        g.push(guideEl(polyD([q, [q[0], q[1] + 0.5]], F, false)), guideEl(circleD([q[0], q[1] + 0.7], 0.19, F)));
        g.push(guideEl(polyD([[q[0], vTop], [q[0], vTop - 1]], place, false)));
      }
      g.push(dimTo(F, [0, 0], [lengthIn, 0], `form length ${inch(lengthIn)}`, -0.6));
      g.push(dimTo(F, [lengthIn, face[face.length - 1][1]], [lengthIn, FORM_DEPTH_IN], `turn-in ${inch(turn)}`, 0.7));
      g.push(dimTo(F, [lengthIn, 0], [lengthIn, FORM_DEPTH_IN], `${inch(FORM_DEPTH_IN)}`, -1.4));
      g.push(label(F, [0, formH - 0.3], 'FORM FACE (bend the strips against this curve; face = rail outer face)', 0.2));
      g.push(dimTo(place, [0, inner[0][1]], [0, vTop], `wall ${inch(vTop - inner[0][1])}`, -0.7), dimTo(place, [lengthIn, inner[inner.length - 1][1]], [lengthIn, vTop], `thickness at the bow end ${inch(vTop - inner[inner.length - 1][1])}`, 0.7));
      g.push(label(place, [0, vTop + 0.35], `COUNTER-FORM (reverse image): face = form face + ${inch(pack)}; back straight. With the strips between, its back stands ${inch(vTop)} from the form back; the clamps close the two backs on each other.`, 0.2));
      out.push(`<g id="guides" ${ANNOTATION_ATTRS}>${g.join('')}</g>`);
      return out.join('');
    },
  };
}

// ── (c) Crown templates: the handlebow and the bow bulkhead ──
function crownPlan(parts: Part[], p: Params, L: Layout): Plan | null {
  const bar = parts.find((x) => x.id === 'handle-bar');
  const barFlat = bar && flatPattern(bar);
  const bw = bowGeometry(p, L);
  const b = L.bulkhead;
  if (!barFlat) return null;
  const crown = Math.max(0, b.zCenter - b.zCorner);
  const rc = Math.min(p.transomCornerRadiusIn, (b.zCorner - b.bot) / 2);
  // Bulkhead top: right corner foot, over the crown, to the left corner foot (y, z). Template = the top chain with a band under it.
  const chain = transomTopOutline(b.halfW, b.zCorner, crown, rc);
  const zLow = Math.min(...chain.map((q) => q[1])) - CROWN_BAND_IN;
  const bulk: Vec2[] = [...chain.map(([y, z]) => [b.halfW - y, z - zLow] as Vec2)].sort((a, c) => a[0] - c[0]);
  const bulkPoly: Vec2[] = [[0, 0], [2 * b.halfW, 0], ...[...bulk].reverse()];
  const bulkH = Math.max(...bulk.map((q) => q[1]));
  // Handlebow: the bow's own outline (the bandsawn board, both arcs), already in `flatPattern` coordinates.
  const barW = barFlat.widthIn, barH = barFlat.heightIn;
  const postU = bw.yEnd - bw.yPost, postU2 = bw.yEnd + bw.yPost;
  const GAP = 2.2;
  const w = Math.max(barW, 2 * b.halfW), h = barH + GAP + bulkH + 1.2;
  const sec = p.handleBarDiameterIn;
  const dims: FormDim[] = [
    lenDim('bow-length', 'Handlebow overall length', barW),
    lenDim('bow-height', 'Handlebow template height (its lowest end to its crown)', barH),
    lenDim('bow-chord', 'Handlebow chord between the posts', 2 * bw.yPost),
    lenDim('bow-crown', 'Handlebow crown above the post tops', bw.crownIn),
    lenDim('bow-radius', 'Handlebow arc radius', bw.radiusIn),
    angleDim('bow-slope', 'Handlebow slope over the posts', bw.postSlopeDeg),
    lenDim('bulk-span', 'Bulkhead width at the top', 2 * b.halfW),
    lenDim('bulk-crown', 'Bulkhead crown (center above the corners)', crown),
    lenDim('bulk-corner-radius', 'Bulkhead corner radius', rc),
  ];
  const notes = [
    `Both crowns are the same height, ${inch(p.handleBowCrownIn)}. The handlebow is a circular arc (radius ${inch(bw.radiusIn)}) through the two post tops that rises ${inch(bw.crownIn)} at the middle and runs on to the sled edge. The bulkhead top is a shallow parabolic crown ${inch(crown)} above its corners (${inch(rc)} corner radius), the same curve as the transom top.`,
    `Handlebow template: the whole bow outline, ${inch(barW)} long, ${inch(sec)} section (the underside is the parallel arc). Lay the arc on the 5/4 board with the grain following it, bandsaw outside the line, then flush-trim with a pattern bit. The post stations are marked ${inch(bw.yPost)} either side of the center line (the post tops are sawn to the ${fmt(Math.round(bw.postSlopeDeg))} degree slope).`,
    `Bulkhead crown template: the top edge of the bow bulkhead, ${inch(2 * b.halfW)} wide, with ${inch(CROWN_BAND_IN)} of template band under the curve. Set it on the oak blank flush to the corner-height line, trace, and bandsaw. The Shaper cuts the bulkhead itself; this is the check and the fallback.`,
  ];
  const build: FormBuildStep[] = [
    { step: `TEMPLATES (laser): cut TWO templates in ${frac(TEMPLATE_STOCK_IN)} plywood from the laser file for this drawing, one piece each: the handlebow (upper outline, ${frac(barW)} × ${frac(barH)}) and the bow bulkhead crown (lower outline, ${frac(2 * b.halfW)} wide).` },
    { step: 'The laser scores the post stations and the post-top height line on the handlebow template, and the corner-height line on the bulkhead template.' },
    {
      step: `HANDLEBOW: a tracing and routing pattern for the ${frac(sec)} board.`,
      sub: ['Stick the template to the board with double-sided tape, the arc laid along the grain; trace both arcs and the post stations.', 'Bandsaw 1/16" outside the lines.', `Flush-trim to the template with a top-bearing pattern bit; the bow is ${frac(sec)} thick, so finish from the other face with a bottom-bearing flush-trim bit riding the trimmed edge.`],
    },
    { step: 'BULKHEAD: set the template on the oak blank, flush with the corner-height line, and trace. The Shaper cuts the bulkhead itself: use the template to check its crown, or as the pattern if cutting it by hand.' },
    { step: 'No base, braces, clamps or spring-back: these are tracing and routing templates, nothing is bent.' },
  ];
  return {
    id: 'crown-templates', title: 'Crown templates: handlebow and bow bulkhead', w, h, dims, notes, build,
    laser: [{
      id: 'crown-templates', title: 'Crown templates: handlebow and bow bulkhead', material: '1/4" Baltic birch plywood', thicknessIn: TEMPLATE_STOCK_IN,
      items: [
        { shape: withScore(emptyShape('handlebow-template', 'Handlebow template', barFlat.outer), [[[postU, 0], [postU, barH]], [[postU2, 0], [postU2, barH]], [[0, barH - bw.crownIn], [barW, barH - bw.crownIn]]]), qty: 1 },
        { shape: withScore(emptyShape('bulkhead-crown-template', 'Bow bulkhead crown template', bulkPoly), [[[0, bulkH - crown], [2 * b.halfW, bulkH - crown]]]), qty: 1 },
      ],
      notes: ['Handlebow: scored post stations either side of the center line and the post-top height line.', 'Bulkhead crown: scored corner-height line; set it flush to that line on the oak blank.'],
    }],
    subtitle: [`Handlebow crown ${inch(bw.crownIn)}, radius ${inch(bw.radiusIn)}; bulkhead crown ${inch(crown)}, ${inch(2 * b.halfW)} wide.`],
    draw: (place) => {
      const B: Xf = ([u, v]) => place([u, v]);
      const H: Xf = ([u, v]) => place([u, v + bulkH + GAP]);
      const out: string[] = [];
      out.push(`<g id="bulkhead">${outsideCut(bulkPoly, B, TEMPLATE_STOCK_IN, 'bulkhead crown template')}</g>`);
      out.push(`<g id="handlebow">${outsideCut(barFlat.outer, H, TEMPLATE_STOCK_IN, 'handlebow template')}</g>`);
      const g: string[] = [];
      // Bow: post stations and the post-top height line.
      for (const u of [postU, postU2]) g.push(guideEl(polyD([[u, 0], [u, barH]], H, false), { dashed: true }), label(H, [u + 0.1, barH + 0.25], `post station ${inch(bw.yPost)} ${u < barW / 2 ? 'left' : 'right'} of the center line`, 0.15));
      g.push(guideEl(polyD([[0, barH], [barW, barH]], H, false), { dashed: true, label: 'crown height' }), guideEl(polyD([[0, barH - bw.crownIn], [barW, barH - bw.crownIn]], H, false), { dashed: true, label: 'post-top height (centerline)' }));
      g.push(dimTo(H, [0, 0], [barW, 0], `overall ${inch(barW)}`, -0.6), dimTo(H, [postU, barH + 0.0], [postU2, barH + 0.0], `post chord ${inch(2 * bw.yPost)}`, 0.5));
      g.push(dimTo(H, [barW + 0.2, barH - bw.crownIn], [barW + 0.2, barH], `crown ${inch(bw.crownIn)}`, -0.6));
      g.push(label(H, [0, barH + 1.05], `HANDLEBOW template: radius ${inch(bw.radiusIn)}, ${inch(sec)} section`, 0.2));
      // Bulkhead.
      g.push(guideEl(polyD([[0, bulkH - crown], [2 * b.halfW, bulkH - crown]], B, false), { dashed: true, label: 'corner height' }));
      g.push(dimTo(B, [0, 0], [2 * b.halfW, 0], `width ${inch(2 * b.halfW)}`, -0.6), dimTo(B, [2 * b.halfW + 0.2, bulkH - crown], [2 * b.halfW + 0.2, bulkH], `crown ${inch(crown)}`, -0.6));
      g.push(label(B, [0, bulkH + 0.35], 'BOW BULKHEAD crown template (top edge)', 0.2));
      out.push(`<g id="guides" ${ANNOTATION_ATTRS}>${g.join('')}</g>`);
      return out.join('');
    },
  };
}

// ── (d) The brake-flap router template ──
function flapPlan(parts: Part[], p: Params): Plan | null {
  const flap = parts.find((x) => x.id === 'brake-flap-L') ?? parts.find((x) => x.partNo === 'brake-flap');
  const d = flap && analyzeShaperPart(flap, parts, p);
  if (!flap || !d) return null;
  const f = d.f;
  const marks = d.items.filter((i) => i.k === 'drill');
  const cuts = d.items.filter((i) => i.k === 'cutHole' || i.k === 'cutLoop');
  const crossLines = d.items.filter((i): i is Extract<typeof i, { k: 'line' }> => i.k === 'line' && i.label === 'cross hole');
  const w = f.widthIn, h = f.heightIn + 0.6;
  const dims: FormDim[] = [
    lenDim('flap-length', 'Flap length', f.widthIn),
    lenDim('flap-width', 'Flap full width', f.heightIn),
    lenDim('flap-thickness', 'Flap thickness (stock)', f.thicknessIn),
    countDim('pilot-marks', 'Drill guide holes', marks.length, 'hole'),
  ];
  const notes = [
    `Router template for a pattern bit: the outline is the finished flap, and the bit's bearing rides its edge (${inch(TEMPLATE_STOCK_IN)} hardboard or MDF, flat on top of the ${inch(f.thicknessIn)} oak blank). Rough the blank out on the bandsaw about 1/16" proud, then flush-trim.`,
    `Drill guide: the ${marks.length} marks are pilot holes (pivot-block and shoe-block screws), drilled through the template with the oak blank under it. The dashed line marks the pivot pin cross hole; drill it in place with the knee clamped on. The shoe screws come in from the underside.`,
    `Left flap shown; the right flap is the mirror image (the screw eye on the end face is inboard). Round over all edges after trimming.`,
  ];
  const build: FormBuildStep[] = [
    { step: `TEMPLATE (laser): cut ONE template in ${frac(TEMPLATE_STOCK_IN)} plywood from the laser file for this drawing, to the outline at offset 0 (${frac(f.widthIn)} × ${frac(f.heightIn)}): the bit's bearing rides its edge.` },
    { step: `The laser cuts the ${marks.length} guide holes (${frac(GUIDE_HOLE_IN)}, for a 1/8" bit) at the marks and scores the pivot cross-hole line.` },
    { step: `Optional: glue a second layer of ${frac(TEMPLATE_STOCK_IN)} plywood under it and flush-trim it to the first, so a bearing up to 1/2" long has a full edge to ride.` },
    {
      step: `USE: rough the ${frac(f.thicknessIn)} oak blank 1/16" proud on the bandsaw, stick the template on with double-sided tape, drill the pilots through the guide holes, then flush-trim with a pattern bit.`,
      sub: ['For the right flap flip the template over (mirror image): the screw eye goes inboard on both.', 'Round over all edges after trimming. No base, braces or clamps: this is a routing template.'],
    },
  ];
  return {
    id: 'brake-flap-template', title: 'Brake flap router template (left flap)', w, h, dims, notes, build,
    laser: [{
      id: 'brake-flap-template', title: 'Brake flap router template (left flap)', material: '1/4" Baltic birch plywood', thicknessIn: TEMPLATE_STOCK_IN,
      items: [{
        shape: {
          ...emptyShape('brake-flap-template', 'Brake flap template', f.outer),
          circles: [...marks.flatMap((m) => (m.k === 'drill' ? [{ c: m.c, dia: GUIDE_HOLE_IN }] : [])), ...cuts.flatMap((i) => (i.k === 'cutHole' ? [{ c: i.c, dia: i.dia }] : []))],
          holes: cuts.flatMap((i) => (i.k === 'cutLoop' ? [i.loop] : [])),
          score: crossLines.map((l) => l.pts),
        },
        qty: 1,
      }],
      notes: [`Left flap shown; for the right flap turn the template over. ${marks.length} guide holes of ${inch(GUIDE_HOLE_IN)} are cut through; the dashed pivot cross-hole line is scored.`],
    }],
    subtitle: [`Outline offset 0; ${inch(f.widthIn)} x ${inch(f.heightIn)}; ${marks.length} drill guide holes.`],
    draw: (place) => {
      const T: Xf = ([u, v]) => place([u, v + 0.3]);
      const out: string[] = [`<g id="outline">${outsideCut(f.outer, T, TEMPLATE_STOCK_IN, 'brake flap outline (template, offset 0)')}</g>`];
      const inside = cuts.map((i) => (i.k === 'cutHole' ? pathEl({ cutType: 'inside', d: circleD(i.c, i.dia, T), depthIn: TEMPLATE_STOCK_IN + BREAKTHROUGH_IN }) : i.k === 'cutLoop' ? pathEl({ cutType: 'inside', d: polyD(i.loop, T), depthIn: TEMPLATE_STOCK_IN + BREAKTHROUGH_IN }) : '')).join('');
      out.push(`<g id="holes">${inside}</g>`);
      const g: string[] = [];
      for (const m of marks) if (m.k === 'drill') g.push(guideEl(circleD(m.c, Math.max(m.dia, 0.19), T)), guideEl(polyD([[m.c[0] - 0.2, m.c[1]], [m.c[0] + 0.2, m.c[1]]], T, false)), guideEl(polyD([[m.c[0], m.c[1] - 0.2], [m.c[0], m.c[1] + 0.2]], T, false)));
      for (const l of crossLines) g.push(guideEl(polyD(l.pts, T, false), { dashed: true }), label(T, [l.pts[0][0] - 0.1, f.heightIn + 0.15], 'pivot pin cross hole', 0.14, 'end'));
      g.push(dimTo(T, [0, 0], [f.widthIn, 0], `length ${inch(f.widthIn)}`, -0.5), dimTo(T, [f.widthIn * 0.55, 0], [f.widthIn * 0.55, f.heightIn], `width ${inch(f.heightIn)}`, 0.0 + 0.5));
      out.push(`<g id="guides" ${ANNOTATION_ATTRS}>${g.join('')}</g>`);
      return out.join('');
    },
  };
}

// ── (e) The brake-knee router template ──
function kneePlan(parts: Part[], p: Params): Plan | null {
  const knee = parts.find((x) => x.id === 'brake-knee-L') ?? parts.find((x) => x.partNo === 'brake-knee');
  if (!knee) return null;
  const bg = brakeOf(p);
  const k = bg.knee, pv = bg.pivot, bolts = bg.bolts;
  const thick = k.x1 - k.x0;
  // Seen from the REAR face, left knee: u runs inboard from the OUTBOARD edge, v runs up from the BOTTOM end (the knee drawing's datums).
  const U = (y: number): number => k.yOut - y;
  const V = (z: number): number => z - k.zBot;
  const outline: Vec2[] = k.poly.map(([y, z]) => [U(y), V(z)]);
  const wIn = Math.max(...outline.map((q) => q[0]));
  const hIn = V(k.zTop);
  // D-77: the flap's pocket is open at the outboard edge (no ear): its rectangle in this view runs from the outboard edge to the inboard wall, between the floor and the ceiling.
  const pocketU: [number, number] = [U(Math.max(pv.ySlot[1], k.yOut)), U(pv.ySlot[0])];
  const pocketV: [number, number] = [V(pv.zPocketBot), V(pv.zPocketTop)];
  const pocketDepth = pv.slotEndX - k.x0;
  const pinV = V(k.zTop - pv.edgeEarUp);
  const rowsV = bolts.zs.map(V);
  const legU: [number, number] = [U(k.poly[1][0]), wIn];
  const dims: FormDim[] = [
    lenDim('knee-width', 'Knee width (outboard edge to inboard edge)', wIn),
    lenDim('knee-height', 'Knee height (bottom end to top end)', hIn),
    lenDim('knee-thickness', 'Knee thickness (front to back)', thick),
    countDim('bolt-rows', 'Bolt-hole rows marked', rowsV.length, 'row'),
  ];
  const notes = [
    `Router template for a pattern bit: the outline is the finished knee seen from its REAR face, and the bit's bearing rides its edge (${inch(TEMPLATE_STOCK_IN)} hardboard or MDF, flat on the ${inch(thick)} thick laminated block). Bandsaw the block about 1/16" proud first, then flush-trim.`,
    `Marks (guides, not cuts): the pocket rectangle at the top end (${inch(pocketU[1] - pocketU[0])} in from the outboard edge, ${inch(hIn - pocketV[1])} to ${inch(hIn - pocketV[0])} below the top end; it is notched in the rear and center layers before the glue-up and recessed ${inch(pocketDepth)} deep from the rear face), the pivot pin line (${inch(pv.edgeEarUp)} below the top end; the pin hole itself is drilled through the strap with the flap tongue clamped in the pocket) and the ${rowsV.length} bolt rows across the leg (the columns are measured from the rear face on the knee drawing).`,
    'Left knee shown; the right knee is the mirror image. Flip the template over for it.',
  ];
  const build: FormBuildStep[] = [
    { step: `TEMPLATE (laser): cut ONE template in ${frac(TEMPLATE_STOCK_IN)} plywood from the laser file for this drawing, to the outline at offset 0 (${frac(wIn)} wide × ${frac(hIn)} tall): the bit's bearing rides its edge.` },
    { step: 'The laser scores the pocket rectangle, the pivot pin line and the bolt rows, so they can be carried onto the block.' },
    { step: `Optional: glue a second layer of ${frac(TEMPLATE_STOCK_IN)} plywood under it and flush-trim it to the first, so a bearing up to 1/2" long has a full edge to ride.` },
    {
      step: `USE: bandsaw the laminated block (${inch(thick)} thick) 1/16" proud of the line, stick the template on its REAR face with double-sided tape, and flush-trim with a pattern bit.`,
      sub: ['If your bit cuts less than the block is thick, trim half the thickness, flip the block and the template over, and trim the other half from the other face.', 'For the right knee flip the template over (mirror image). No base, braces or clamps: this is a routing template.'],
    },
  ];
  return {
    id: 'brake-knee-template', title: 'Brake knee router template (left knee)', w: wIn, h: hIn + 0.6, dims, notes, build,
    laser: [{
      id: 'brake-knee-template', title: 'Brake knee router template (left knee)', material: '1/4" Baltic birch plywood', thicknessIn: TEMPLATE_STOCK_IN,
      items: [{
        shape: withScore(emptyShape('brake-knee-template', 'Brake knee template', outline), [
          rectLoop(pocketU[0], pocketV[0], pocketU[1], pocketV[1]).concat([[pocketU[0], pocketV[0]]]),
          [[0, pinV], [legU[0], pinV]],
          ...rowsV.map((v): Vec2[] => [[legU[0], v], [legU[1], v]]),
        ]),
        qty: 1,
      }],
      notes: ['Left knee shown, seen from the REAR face; for the right knee turn the template over. Scored: the pocket rectangle, the pivot pin hole line and the bolt rows.'],
    }],
    subtitle: [`Outline offset 0; ${inch(wIn)} wide × ${inch(hIn)} tall; for a ${inch(thick)} thick cross-laminated block.`],
    draw: (place) => {
      const T: Xf = ([u, v]) => place([u, v + 0.3]);
      const out: string[] = [`<g id="outline">${outsideCut(outline, T, TEMPLATE_STOCK_IN, 'brake knee outline (template, offset 0)')}</g>`];
      const g: string[] = [];
      g.push(guideEl(polyD([[pocketU[0], pocketV[0]], [pocketU[1], pocketV[0]], [pocketU[1], pocketV[1]], [pocketU[0], pocketV[1]]], T, true), { dashed: true }));
      g.push(label(T, [pocketU[0], hIn + 0.15], 'pocket (open at the outboard edge)', 0.14));
      g.push(guideEl(polyD([[0, pinV], [legU[0], pinV]], T, false), { dashed: true }), label(T, [0.1, pinV + 0.08], 'pivot pin hole line', 0.13));
      for (const v of rowsV) g.push(guideEl(polyD([[legU[0], v], [legU[1], v]], T, false), { dashed: true }));
      g.push(label(T, [legU[0] + 0.1, rowsV[rowsV.length - 1] + 0.1], 'bolt rows', 0.13));
      g.push(dimTo(T, [0, 0], [wIn, 0], `width ${inch(wIn)}`, -0.5), dimTo(T, [wIn, 0], [wIn, hIn], `height ${inch(hIn)}`, 0.5));
      out.push(`<g id="guides" ${ANNOTATION_ATTRS}>${g.join('')}</g>`);
      return out.join('');
    },
  };
}

/** Every form and template drawing for the current model. `opts.date` is shown beside the design revision (the caller's choice; the wall clock is never read here). */
export function formDrawings(parts: Part[], p: Params, opts: { date?: string } = {}): FormDrawing[] {
  const L = computeLayout(p);
  const plans = [sideFormPlan(parts, p, L), railFormPlan(parts, p, L), crownPlan(parts, p, L), flapPlan(parts, p), kneePlan(parts, p)];
  return plans.filter((x): x is Plan => x !== null).map((x) => finishDrawing(x, p, opts.date));
}

// ── Letter tiling ──

export const LETTER_W_IN = 8.5;
export const LETTER_H_IN = 11;
export const TILE_MARGIN_IN = 0.5;
/** Overlap (in) between neighbouring pages: the strip printed on both, to line them up. */
export const TILE_OVERLAP_IN = 0.5;

export interface TileWindow { page: string; row: number; col: number; x: number; y: number; w: number; h: number }

/** The page windows (in drawing inches, from the drawing's top left) that cover a `widthIn` x `heightIn` drawing on Letter pages with `TILE_MARGIN_IN` margins and `TILE_OVERLAP_IN` overlap. Labels run A1, A2, ... along a row, then B1, ... */
export function tilePlan(widthIn: number, heightIn: number): { cols: number; rows: number; windows: TileWindow[] } {
  const pw = LETTER_W_IN - 2 * TILE_MARGIN_IN, ph = LETTER_H_IN - 2 * TILE_MARGIN_IN;
  const su = pw - TILE_OVERLAP_IN, sv = ph - TILE_OVERLAP_IN;
  const cols = Math.max(1, Math.ceil((widthIn - TILE_OVERLAP_IN) / su - 1e-9));
  const rows = Math.max(1, Math.ceil((heightIn - TILE_OVERLAP_IN) / sv - 1e-9));
  const windows: TileWindow[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) windows.push({ page: `${String.fromCharCode(65 + (r % 26))}${c + 1}`, row: r, col: c, x: c * su, y: r * sv, w: pw, h: ph });
  return { cols, rows, windows };
}

/** Line weight (in) of a cut path in a PRINT: a cut is a black outline, never a filled shape (a filled outside cut printed solid black and hid every mark under it). */
export const PRINT_CUT_STROKE_IN = 0.02;

/**
 * Rewrite a Shaper-style drawing for a printer: every outside / inside / pocket path becomes `fill="none"` with a black stroke (pockets a thinner dashed one), so the page shows the outline and the
 * guides (still blue, #0068FF) and uses almost no ink. On-line paths and guides are left as they are.
 */
export function printStyle(inner: string): string {
  // Text: the Shaper files carry it as hairline blue strokes (a guide); on paper it is plain filled blue type.
  inner = inner.split(ANNOTATION_ATTRS).join('shaper:cutType="guide" fill="#0068FF" stroke="none"');
  return inner.replace(/<path\b[^>]*>/g, (tag) => {
    const kind = /shaper:cutType="(outside|inside|pocket)"/.exec(tag)?.[1];
    if (!kind) return tag;
    const stripped = tag.replace(/\s(?:fill|stroke|stroke-width|stroke-dasharray)="[^"]*"/g, '');
    const style = kind === 'pocket' ? ` fill="none" stroke="#000000" stroke-width="0.012" stroke-dasharray="0.06 0.04"` : ` fill="none" stroke="#000000" stroke-width="${PRINT_CUT_STROKE_IN}"`;
    return stripped.replace(/^<path\b/, `<path${style}`);
  });
}

/** The bounding box (drawing inches) of the path data our drawings use: absolute M / L / H / V / Z and the relative half-circle arcs of `circleD`. Null if it cannot tell. */
export function pathBounds(d: string): { x0: number; y0: number; x1: number; y1: number } | null {
  const tok = d.match(/[MLHVZmlhvzAa]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!tok) return null;
  let i = 0, cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cmd = '';
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) cmd = tok[i++];
    switch (cmd) {
      case 'M': case 'L': cx = num(); cy = num(); add(cx, cy); break;
      case 'H': cx = num(); add(cx, cy); break;
      case 'V': cy = num(); add(cx, cy); break;
      case 'a': { const rx = num(), ry = num(); i += 3; const dx = num(), dy = num(); const mx = cx + dx / 2, my = cy + dy / 2; add(mx - rx, my - ry); add(mx + rx, my + ry); cx += dx; cy += dy; break; }
      case 'Z': case 'z': break;
      default: return null;
    }
    if (cmd === 'Z' || cmd === 'z') cmd = '';
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** The polylines and circles of the path data our drawings use (absolute M / L / H / V / Z and the half-circle arcs of `circleD`); null when it cannot tell. */
function pathShapes(d: string): { lines: Array<[Vec2, Vec2]>; circles: Array<{ c: Vec2; r: number }> } | null {
  const tok = d.match(/[MLHVZmlhvzAa]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!tok) return null;
  const lines: Array<[Vec2, Vec2]> = [], circles: Array<{ c: Vec2; r: number }> = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  const num = () => Number(tok[i++]);
  const seg = (x: number, y: number) => { lines.push([[cx, cy], [x, y]]); cx = x; cy = y; };
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) cmd = tok[i++];
    switch (cmd) {
      case 'M': cx = num(); cy = num(); sx = cx; sy = cy; cmd = 'L'; break;
      case 'L': seg(num(), num()); break;
      case 'H': seg(num(), cy); break;
      case 'V': seg(cx, num()); break;
      case 'a': { const rx = num(); num(); i += 3; const dx = num(), dy = num(); circles.push({ c: [cx + dx / 2, cy + dy / 2], r: rx }); cx += dx; cy += dy; break; }
      case 'Z': case 'z': if (cx !== sx || cy !== sy) seg(sx, sy); cmd = ''; break;
      default: return null;
    }
  }
  return { lines, circles };
}

/** Does the segment a-b touch the rectangle (Liang-Barsky)? */
function segmentHitsRect(a: Vec2, b: Vec2, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as const) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return t0 <= t1;
}

interface InkShape { lines: Array<[Vec2, Vec2]>; circles: Array<{ c: Vec2; r: number }> }

/**
 * The shapes that make a page worth printing: CUT paths (outside / inside / pocket / on-line) and DRILL MARKS (closed circles). Straight guide lines, dimension lines and labels do not: a page with only those is
 * empty paper with a ruler on it. Null when nothing could be parsed.
 */
function inkShapes(inner: string): InkShape[] | null {
  const out: InkShape[] = [];
  for (const m of inner.matchAll(/<path\b[^>]*>/g)) {
    const tag = m[0];
    const d = /\sd="([^"]*)"/.exec(tag)?.[1];
    if (!d) continue;
    const sh = pathShapes(d);
    if (!sh) return null;
    const kind = /shaper:cutType="([a-z]+)"/.exec(tag)?.[1];
    if (kind === 'outside' || kind === 'inside' || kind === 'pocket' || kind === 'online') out.push(sh);
    else if (sh.circles.length) out.push({ lines: [], circles: sh.circles }); // a guide circle is a drill mark
  }
  return out;
}

/** True if a cut path or a drill mark comes within the window (drawing inches, from the viewBox origin). */
function windowHasInk(shapes: InkShape[], win: TileWindow, minX: number, minY: number): boolean {
  const wx0 = minX + win.x, wy0 = minY + win.y, wx1 = wx0 + win.w, wy1 = wy0 + win.h;
  return shapes.some((sh) =>
    sh.lines.some(([a, b]) => segmentHitsRect(a, b, wx0, wy0, wx1, wy1)) ||
    sh.circles.some((c) => c.c[0] + c.r >= wx0 && c.c[0] - c.r <= wx1 && c.c[1] + c.r >= wy0 && c.c[1] - c.r <= wy1));
}

/** Font size (in) of the tile footer lines; a line is at most `LETTER_W_IN - 2 * TILE_MARGIN_IN` wide at about 0.55 em per character. */
const FOOT_SIZE_IN = 0.13;
const fitText = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Split a full-scale drawing onto US Letter pages (8.5 x 11, 0.5 in margins): one SVG per page with its label, overlap alignment marks and a 1 in check square. */
export function tileForLetter(svg: string, widthIn: number, heightIn: number): string[] {
  const root = /<svg\b[^>]*>/.exec(svg);
  const vb = root && /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(root[0]);
  const minX = vb ? Number(vb[1]) : 0, minY = vb ? Number(vb[2]) : 0;
  const inner = printStyle(root ? svg.slice(root.index + root[0].length, svg.lastIndexOf('</svg>')) : svg);
  const titleM = /<title>([^<]*)<\/title>/.exec(svg);
  const name = titleM ? titleM[1] : 'drawing';
  const { cols, rows, windows } = tilePlan(widthIn, heightIn);
  // A page is printed only if a CUT path or a drill mark crosses its window: a page of empty paper, or of guide lines and labels alone, is skipped (the cut outline and the marks are what you trace).
  const shapes = inkShapes(inner);
  const printed = new Set(shapes && shapes.length ? windows.filter((w) => windowHasInk(shapes, w, minX, minY)).map((w) => w.page) : []);
  if (!printed.size) windows.forEach((w) => printed.add(w.page)); // nothing parsed or nothing cut: keep every page rather than none
  const at = (r: number, c: number): TileWindow | undefined => (r >= 0 && r < rows && c >= 0 && c < cols && printed.has(windows[r * cols + c].page) ? windows[r * cols + c] : undefined);
  const total = printed.size;
  const pages: string[] = [];
  let idx = 0;
  const cross = (x: number, y: number): string => `<path d="M${fmt(x - 0.15)},${fmt(y)}h0.3M${fmt(x)},${fmt(y - 0.15)}v0.3" stroke="#000" stroke-width="0.01" fill="none"/><circle cx="${fmt(x)}" cy="${fmt(y)}" r="0.06" fill="none" stroke="#000" stroke-width="0.01"/>`;
  for (const win of windows) {
    if (!printed.has(win.page)) continue;
    idx++;
    const x0 = TILE_MARGIN_IN, y0 = TILE_MARGIN_IN, x1 = x0 + win.w, y1 = y0 + win.h;
    const marks: string[] = [];
    const dash = 'stroke="#000" stroke-width="0.01" stroke-dasharray="0.08 0.06" fill="none"';
    const navs: string[] = [];
    // Registration crosses sit at the SAME DRAWING COORDINATES on neighboring pages, so two pages overlay when the crosses coincide: the window edges of this page, and the window edges of each
    // neighbor (the ends of the dashed overlap lines). Page coordinates = margin + (drawing coordinate - this window's origin).
    const xs = new Set<number>([x0, x1]), ys = new Set<number>([y0, y1]);
    const right = at(win.row, win.col + 1), left = at(win.row, win.col - 1), below = at(win.row + 1, win.col), above = at(win.row - 1, win.col);
    if (win.col + 1 < cols) { const nx = x1 - TILE_OVERLAP_IN; xs.add(nx); marks.push(`<path d="M${fmt(nx)},${y0}V${y1}" ${dash}/>`); if (right) navs.push(`->${right.page}`); }
    if (win.col > 0) { const nx = x0 + TILE_OVERLAP_IN; xs.add(nx); marks.push(`<path d="M${fmt(nx)},${y0}V${y1}" ${dash}/>`); if (left) navs.push(`<-${left.page}`); }
    if (win.row + 1 < rows) { const ny = y1 - TILE_OVERLAP_IN; ys.add(ny); marks.push(`<path d="M${x0},${fmt(ny)}H${x1}" ${dash}/>`); if (below) navs.push(`v${below.page}`); }
    if (win.row > 0) { const ny = y0 + TILE_OVERLAP_IN; ys.add(ny); marks.push(`<path d="M${x0},${fmt(ny)}H${x1}" ${dash}/>`); if (above) navs.push(`^${above.page}`); }
    for (const x of xs) for (const y of [y0, y1]) marks.push(cross(x, y));
    for (const y of ys) if (y !== y0 && y !== y1) for (const x of [x0, x1]) marks.push(cross(x, y));
    // 1 in check square at the lower left of the printable area, on top of the drawing.
    const sq = `<rect x="${fmt(x0 + 0.1)}" y="${fmt(y1 - 1.1)}" width="1" height="1" fill="#fff" fill-opacity="0.85" stroke="#000" stroke-width="0.015"/><text x="${fmt(x0 + 0.6)}" y="${fmt(y1 - 0.55)}" font-family="Helvetica, Arial, sans-serif" font-size="0.16" text-anchor="middle">1 in</text>`;
    // Two short lines, each inside the printable width: the page label and its neighbors under the printable area (0.34 in from the page bottom: some printers clip the last 0.25 in), the print instructions in the top margin.
    const label = `<text x="${fmt(x0)}" y="${fmt(y1 + 0.16)}" font-family="Helvetica, Arial, sans-serif" font-size="0.18" font-weight="bold">${win.page}</text><text x="${fmt(x0 + 0.5)}" y="${fmt(y1 + 0.16)}" font-family="Helvetica, Arial, sans-serif" font-size="${FOOT_SIZE_IN}">page ${idx} of ${total}   ${esc(fitText(name, 40))}   neighbors: ${esc(navs.join(' ') || 'none')}</text>`
      + `<text x="${fmt(x0)}" y="0.3" font-family="Helvetica, Arial, sans-serif" font-size="${FOOT_SIZE_IN}">${esc(`print at 100%; overlay neighbors so the crosses coincide, then trim (${frac(win.x)}, ${frac(win.y)})`)}</text>`;
    const big = `<text x="${fmt(x1 - 0.1)}" y="${fmt(y0 + 0.5)}" font-family="Helvetica, Arial, sans-serif" font-size="0.5" text-anchor="end" fill="#999" fill-opacity="0.6">${win.page}</text>`;
    pages.push(
      `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="${LETTER_W_IN}in" height="${LETTER_H_IN}in" viewBox="0 0 ${LETTER_W_IN} ${LETTER_H_IN}">\n` +
      `<title>${esc(name)} page ${win.page}</title>\n` +
      `<svg id="window" x="${x0}" y="${y0}" width="${fmt(win.w)}" height="${fmt(win.h)}" viewBox="${fmt(minX + win.x)} ${fmt(minY + win.y)} ${fmt(win.w)} ${fmt(win.h)}" overflow="hidden">\n${inner}\n</svg>\n` +
      `<g id="marks">${marks.join('')}${big}${sq}${label}</g>\n</svg>\n`,
    );
  }
  return pages;
}
