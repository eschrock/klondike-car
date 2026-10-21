/**
 * Figures for the prep steps: milling (the resaw lanes, a face-laminated block with offset seams, the cross-laminated brake knee), the rail form
 * (where the rails go, the form set up on its base) and the rail glue-up (the clamp order, the finished rail with its cuts).
 * Sizes come from the cut list (resaw pools, layer cuts, glue-ups), the rail form drawing (dims and build text), the rail part drawing (located
 * features) and the layout; shapes that are only schematic say so in the note.
 */
import { partOBB } from '../../model/bounds';
import { hull2 } from '../../model/brake-layout';
import { computeLayout, outerHalfWidth, samples, type Layout } from '../../model/layout';
import type { Part, Vec2 } from '../../model/types';
import { boardByNominal, edgeJointUp, resawUsableIn, type ResawPool } from '../cutlist';
import { COUNTER_CLEARANCE_IN, FORM_BASE_IN, FORM_DEPTH_IN, RAIL_FORM_LEAD_IN, type FormDrawing } from '../forms';
import { brakeOf } from '../part-drawings';
import { frac, pointInPoly } from '../svg-util';
import { ACCENT, DIM, Fig, INK, MAT, mat, MUTED, type FigCtx, type FigFn, type Style } from './kit';

const f16 = (v: number): string => frac(v, 16);
const f8 = (v: number): string => frac(v, 8);
const CLAMP_BLUE = MAT.clamp.stroke;
/** The counter-form (MDF, a lighter tone than the form so the two read apart) and the bench fence (scrap). */
const COUNTER_STYLE: Style = { fill: '#ece7dc', stroke: MAT.mdf.stroke, width: 1.2 };
const FENCE_STYLE: Style = { fill: '#c9d3bd', stroke: '#5f6e4c', width: 1.2 };

// ── Small helpers ───────────────────────────────────────────────────────────

/** A shop fraction ("8-5/16", "3/4", "3") as inches. */
const FR = String.raw`\d+(?:-\d+\/\d+)?|\d+\/\d+`;
function parseFr(s: string): number {
  const m = /^(\d+)-(\d+)\/(\d+)$/.exec(s) ?? undefined;
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  const q = /^(\d+)\/(\d+)$/.exec(s);
  if (q) return Number(q[1]) / Number(q[2]);
  return Number(s);
}
const grab = (re: RegExp, s: string): number | undefined => { const m = re.exec(s); return m ? parseFr(m[1]) : undefined; };

/** The plan footprint (x, y) of a part: its oriented box, seen from above. */
function planPoly(x: Part): Vec2[] {
  const o = partOBB(x);
  const pts: Vec2[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const d of [-1, 1]) {
    const q = [0, 1].map((k) => o.center[k] + a * o.axes[0][k] * o.half[0] + b * o.axes[1][k] * o.half[1] + d * o.axes[2][k] * o.half[2]);
    pts.push([q[0], q[1]]);
  }
  return hull2(pts) as Vec2[];
}

/** A polyline moved `d` along its left normal (the counter-form face is the form face moved out by the strips). */
function offsetLine(line: Vec2[], d: number): Vec2[] {
  return line.map((q, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [q[0] - (dy / l) * d, q[1] + (dx / l) * d];
  });
}

/** Linear interpolation of v at u on a polyline sorted by u. */
function vAt(line: Vec2[], u: number): number {
  if (u <= line[0][0]) return line[0][1];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if (u <= b[0]) return a[1] + ((b[1] - a[1]) * (u - a[0])) / Math.max(1e-9, b[0] - a[0]);
  }
  return line[line.length - 1][1];
}

/** A legend of styled swatches with this figure's own words (the kit's legend names materials only). */
function legendOf(F: Fig, items: Array<{ s: Style; label: string }>, at: Vec2 = [16, F.h - 16]): void {
  let x = at[0];
  for (const it of items) {
    F.rect(x, at[1] - 10, 14, 10, it.s);
    F.text([x + 19, at[1]], it.label, { size: 11.5, color: MUTED });
    x += 19 + it.label.length * 6.3 + 18;
  }
}
const OAK_KEY = { s: mat('oak'), label: MAT.oak.label };

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const plainName = (s: string): string => lowerFirst(s.replace(/\s*\([^)]*\)\s*$/, ''));

// ── The rail form, as the rail form drawing builds it ─────────────────────────

interface RailForm {
  L: Layout;
  fd: FormDrawing;
  rail: Part;
  /** Rail thickness (the glued strips), strips, one strip's thickness, its depth (in). */
  railT: number; plies: number; strip: number; railW: number;
  xStart: number; xEnd: number; lengthIn: number;
  /** The form face (u from the form's rear end, v from the form's straight back), and the counter-form face. */
  face: Vec2[]; counterFace: Vec2[];
  /** Counter-form back, from the form back. */
  vTop: number;
  clamps: number; stations: number[]; sStart: number; sEnd: number;
  deepest: number;
  baseL?: number; baseW?: number; baseEnd: number;
  nLayers?: number; layerT?: number; stackH?: number;
  hang: number;
  cureH?: number; cureF?: number;
  /** The bench fence (thick × tall) and the lead-in clamp count text ("2 or 3"), from the form drawing's build text. */
  fenceT?: number; fenceH?: number; leadClamps?: string;
  /** The plywood strip under the overhang (length), and the spring clamps on the overhang: their count text ("4 to 6") and spacing. */
  supportL?: number; springText?: string; springEvery?: number;
  /** The fence's length (from the form's rear end over the base and the strip), and the rough strip as cut (width, length). */
  fenceL?: number; stripRoughW?: number; stripRoughL?: number;
  turn: number;
}

function railForm(c: FigCtx): RailForm | null {
  const fd = c.forms().find((d) => d.id === 'rail-form');
  const rail = c.by('rail-L');
  if (!fd || !rail || rail.geometry.type !== 'mesh') return null;
  const L = computeLayout(c.p);
  const railT = rail.geometry.thickness ?? 0;
  const plies = rail.plies ?? 1;
  if (railT <= 0) return null;
  const xEnd = L.railEnd, xStart = Math.max(L.xSideStart, L.taper.x0 - RAIL_FORM_LEAD_IN);
  const yOut = (x: number): number => outerHalfWidth(L, x);
  const xs = samples(xStart, xEnd, 90);
  const yMin = Math.min(...xs.map(yOut));
  const face: Vec2[] = xs.map((x) => [x - xStart, yOut(x) - yMin + FORM_DEPTH_IN]);
  const counterFace = offsetLine(face, railT + COUNTER_CLEARANCE_IN);
  const dim = (k: string): number | undefined => fd.dims.find((q) => q.key === k)?.valueIn;
  const lengthIn = dim('form-length') ?? xEnd - xStart;
  const clamps = Math.max(2, Math.round(dim('clamps') ?? 2));
  const vTop = dim('counter-width') ?? Math.max(...counterFace.map((q) => q[1])) + 2;
  const stations = Array.from({ length: clamps }, (_, i) => L.taper.x0 + (i * (xEnd - L.taper.x0)) / (clamps - 1) - xStart);
  const text = fd.build.flatMap((b) => [b.step, ...(b.sub ?? [])]).join(' ');
  const base = new RegExp(`BASE: [^.]*?plywood (${FR})" × (${FR})"`).exec(text);
  const lay = new RegExp(`stack of (\\d+) layers of (${FR})" MDF, (${FR})" tall`).exec(text);
  const baseL = base ? parseFr(base[1]) : undefined, baseW = base ? parseFr(base[2]) : undefined;
  const stripCut = c.cut().cuts.find((q) => q.piece === 'strip' && q.ids.includes(rail.id));
  const stripL = stripCut?.rough.l;
  const hang = grab(new RegExp(`about (${FR})" of each strip hangs off`), text) ?? Math.max(0, (stripL ?? lengthIn) - lengthIn);
  const cure = /(\d+) h at (\d+) °F/.exec(text);
  const fence = new RegExp(`straight (${FR})" × (${FR})" fence`).exec(text);
  const lead = /plus (\d+ or \d+) on the straight lead-in/.exec(text);
  const spring = new RegExp(`with (\\d+ to \\d+) large spring clamps over the top, about every (${FR})"`).exec(text);
  return {
    L, fd, rail, railT, plies, strip: railT / plies, railW: rail.stock?.w ?? 3,
    xStart, xEnd, lengthIn, face, counterFace, vTop, clamps, stations,
    sStart: L.taper.x0 - xStart, sEnd: L.taper.x1 - xStart,
    deepest: Math.max(...face.map((q) => q[1])),
    baseL, baseW, baseEnd: baseL !== undefined ? Math.max(0, (baseL - lengthIn) / 2) : 0,
    nLayers: lay ? Number(lay[1]) : undefined, layerT: lay ? parseFr(lay[2]) : undefined, stackH: lay ? parseFr(lay[3]) : undefined,
    fenceL: grab(new RegExp(`fence about (${FR})" long`), text), stripRoughW: stripCut?.rough.w, stripRoughL: stripL,
    hang, cureH: cure ? Number(cure[1]) : undefined, cureF: cure ? Number(cure[2]) : undefined,
    fenceT: fence ? parseFr(fence[1]) : undefined, fenceH: fence ? parseFr(fence[2]) : undefined, leadClamps: lead?.[1],
    supportL: grab(new RegExp(`plywood strip, about (${FR})" long`), text), springText: spring?.[1], springEvery: spring ? parseFr(spring[2]) : undefined,
    turn: L.taper.turnIn,
  };
}

/**
 * The form on its base, from above: back edge at the top, rear (lead-in) end on the left. `mode` 'build' draws the form and counter-form as this
 * step's work (MDF, accent) and the strips as a trial fit; 'glue' draws the jig as already built (gray) and the strips as this step's work.
 */
function drawFormPlan(F: Fig, g: RailForm, box: { x: number; y: number; w: number }, mode: 'build' | 'glue'): { at: (u: number, v: number) => Vec2; k: number } {
  const uMin = -Math.max(g.hang, g.baseEnd + (g.supportL ?? 0)) - 1.5, uMax = g.lengthIn + g.baseEnd + 1.5;
  const k = box.w / (uMax - uMin);
  const at = (u: number, v: number): Vec2 => [box.x + (u - uMin) * k, box.y + v * k];
  const P = (q: Vec2[]): Vec2[] => q.map(([u, v]) => at(u, v));
  const jig = mode === 'build' ? mat('mdf', { stroke: ACCENT, width: 1.6 }) : mat('ghost', { stroke: '#8a8a8a', width: 1.4 });
  const counterJig = mode === 'build' ? { ...COUNTER_STYLE, stroke: ACCENT, width: 1.6 } : { fill: '#fafafa', stroke: '#8a8a8a', width: 1.4 };
  const stripStyle = mode === 'glue' ? mat('oak', { stroke: ACCENT, width: 1.6 }) : mat('oak');
  // base and bench fence
  if (g.baseW !== undefined) F.poly(P([[-g.baseEnd, 0], [g.lengthIn + g.baseEnd, 0], [g.lengthIn + g.baseEnd, g.baseW], [-g.baseEnd, g.baseW]]), mode === 'build' ? mat('deck') : mat('ghost', { dash: '4 3' }));
  const v0 = g.face[0][1];
  const fT = g.fenceT ?? 0.75;
  // the plywood strip on the bench under the overhang, against the base's rear end, as wide as the base
  if (g.supportL !== undefined && g.baseW !== undefined) F.poly(P([[-g.baseEnd - g.supportL, 0], [-g.baseEnd, 0], [-g.baseEnd, g.baseW], [-g.baseEnd - g.supportL, g.baseW]]), mode === 'build' ? mat('deck', { stroke: ACCENT, width: 1.4 }) : mat('ghost', { dash: '4 3' }));
  const fenceEnd = g.fenceL !== undefined ? -g.fenceL : -g.hang;
  F.poly(P([[fenceEnd, v0 - fT], [0, v0 - fT], [0, v0], [fenceEnd, v0]]), mode === 'build' ? { ...FENCE_STYLE, stroke: ACCENT, width: 1.4 } : mat('ghost', { stroke: '#8a8a8a' }));
  // form body
  F.poly(P([[0, 0], [g.lengthIn, 0], ...[...g.face].reverse()]), jig);
  // the strips: along the fence, then the form face
  const outerStrip = offsetLine(g.face, g.railT);
  F.poly(P([[-g.hang, v0], ...g.face, ...[...outerStrip].reverse(), [-g.hang, v0 + g.railT]]), stripStyle);
  if (g.plies > 1) for (let i = 1; i < g.plies; i++) { const mid = offsetLine(g.face, g.strip * i); F.poly(P([[-g.hang, v0 + g.strip * i], ...mid]), { stroke: MAT.oak.stroke, width: 0.8 }, false); }
  // counter-form
  const cf = g.counterFace;
  F.poly(P([...cf, [cf[cf.length - 1][0], g.vTop], [cf[0][0], g.vTop]]), counterJig);
  // stop blocks at each end of the counter-form
  const stopW = Math.min(1, g.baseEnd * 0.6);
  if (stopW > 0) {
    F.rect(at(cf[0][0] - stopW, 0)[0], at(0, cf[0][1] + 0.4)[1], stopW * k, (g.vTop - cf[0][1] - 0.8) * k, mode === 'build' ? mat('oak', { stroke: ACCENT, width: 1.2 }) : mat('ghost'));
    const e = cf[cf.length - 1];
    F.rect(at(e[0], 0)[0], at(0, e[1] + 0.6)[1], stopW * k, (g.vTop - e[1] - 1.2) * k, mode === 'build' ? mat('oak', { stroke: ACCENT, width: 1.2 }) : mat('ghost'));
  }
  // S start / S end: dashed lines right across the jig (the clamp ticks are short and blue)
  if (mode === 'build') for (const s of [g.sStart, g.sEnd]) F.line(at(s, -0.4), at(s, g.vTop + 0.4), { stroke: ACCENT, width: 1.3, dash: '6 4' });
  return { at, k };
}

/** The form and the counter-form named inside the plan, on a white backing so a clamp drawn under them does not cut the words. */
function namePlan(F: Fig, g: RailForm, at: (u: number, v: number) => Vec2, mode: 'build' | 'glue'): void {
  const uF = g.lengthIn * 0.78, uC = g.lengthIn * 0.8;
  const put = (p: Vec2, t: string): void => {
    const w = t.length * 7.4 + 8;
    F.rect(p[0] - w / 2, p[1] - 13, w, 18, { fill: '#ffffff', opacity: 0.85 }, 3);
    F.text(p, t, { size: 12, anchor: 'middle', weight: 'bold', color: mode === 'build' ? INK : MUTED });
  };
  put(at(uF, vAt(g.face, uF) * 0.45 + 0.5), mode === 'build' ? 'FORM (screwed down)' : 'form');
  put(at(uC, (vAt(g.counterFace, uC) + g.vTop) / 2 + 0.5), mode === 'build' ? 'COUNTER-FORM (loose)' : 'counter-form');
}

/** A bar clamp seen from above at u, across from the form back (v = 0) to the counter-form back. */
function clampPlan(F: Fig, at: (u: number, v: number) => Vec2, u: number, vTop: number): void {
  const a = at(u, -0.9), b = at(u, vTop + 0.9);
  F.line(a, b, { stroke: CLAMP_BLUE, width: 2.4 });
  F.rect(a[0] - 5, a[1], 10, 6, mat('clamp'));
  F.rect(b[0] - 5, b[1] - 6, 10, 6, mat('clamp'));
}

// ── Step 'mill' ───────────────────────────────────────────────────────────────

/** 1. The resaw: a board ripped into lanes, each lane stood on edge and resawn into slabs, each slab planed to a strip. One row per resaw pool. */
const resawStrips: FigFn = (c) => {
  const cl = c.cut();
  const pools = [...cl.resaw].filter((q) => q.strips > 0 && q.laneWidthsIn.length > 0).sort((a, b) => a.roughT - b.roughT);
  if (!pools.length) return null;
  const k = 20, rowH = 228;
  const F = new Fig(760, 56 + pools.length * rowH + 4);
  F.heading('Resawing the bending strips: rip into lanes first, then resaw each lane on edge');
  const stripRow = (id: string) => cl.strips.find((r) => r.ids.includes(id));
  const shortName = (id: string): string => {
    const n = c.by(id)?.name ?? stripRow(id)?.name ?? '';
    const m = /^(Left|Right) (\w+) band \((outer|inner)\)$/.exec(n);
    return m ? `${m[1].toLowerCase()} ${m[3]} ${m[2]}` : plainName(n);
  };
  const laneText = (lane: ResawPool['laneStrips'][number] | undefined): string => {
    if (!lane || !lane.length) return 'spare';
    const ids = lane.map((q) => q.id);
    if (new Set(ids).size === 1) return `${lane.length > 1 ? 'both strips of ' : ''}${lowerFirst(c.by(ids[0])?.name ?? stripRow(ids[0])?.name ?? '')}`;
    return [...new Set(ids.map(shortName))].join(' + ');
  };
  pools.forEach((pool, pi) => {
    const top = 56 + pi * rowH;
    const B = boardByNominal(pool.board);
    const T = B?.nominalIn ?? pool.roughT * pool.stripsPerBoard;
    const kerf = c.p.resawKerfIn;
    const lanes = [...pool.laneWidthsIn, ...Array(Math.max(0, pool.ripLanes - pool.lanes)).fill(pool.laneWidthsIn[0])] as number[];
    const boards = Math.max(1, pool.boards);
    const perBoard = Math.ceil(lanes.length / boards);
    const names = [...new Set(pool.laneStrips.flat().map((q) => plainName(stripRow(q.id)?.name ?? '')))];
    const what = names.every((n) => / band$/.test(n)) ? `${names.map((n) => n.replace(/ band$/, '')).join(' and ')} bands` : names.map((n) => `${n}s`).join(' and ');
    F.sub([16, top], `${String.fromCharCode(65 + pi)}. ${pool.strips} strips for the ${what}: ${boards} ${boards === 1 ? 'board' : 'boards'} of ${pool.board}, ${f8(pool.boardWidthIn)} wide × ${f8(pool.boardLengthIn)} long`);
    // (a) the board(s), end on, with the rip lines
    const by = top + 34, x0 = 24;
    F.text([x0, by - 8], boards === 1 ? 'the board, end on: rip it into lanes' : 'the boards, end on: rip them into lanes', { size: 12, color: MUTED });
    let bx = x0;
    let n = 0;
    const laneCenters: Array<{ x: number; i: number }> = [];
    for (let b = 0; b < boards; b++) {
      const bw = pool.boardWidthIn * k;
      F.rect(bx, by, bw, T * k, mat('oak'));
      let u = 0;
      for (let j = 0; j < perBoard && n < lanes.length; j++, n++) {
        const w = lanes[n];
        laneCenters.push({ x: bx + (u + w / 2) * k, i: n });
        u += w;
        if (u < pool.boardWidthIn - 0.25) F.line([bx + (u + kerf / 2) * k, by - 4], [bx + (u + kerf / 2) * k, by + T * k + 4], { stroke: ACCENT, width: 1.6, dash: '4 3' });
        u += kerf;
      }
      if (u < pool.boardWidthIn - 0.05) F.hatch(bx + u * k, by, (pool.boardWidthIn - u) * k, T * k, MAT.oak.stroke, 4);
      bx += bw + 18;
    }
    for (const lc of laneCenters) F.text([lc.x, by + T * k + 16], String(lc.i + 1), { size: 12, anchor: 'middle', weight: 'bold' });
    // lane key: consecutive lanes with the same use are one line
    const keyLines: string[] = [];
    for (let i = 0; i < lanes.length;) {
      const t = laneText(pool.laneStrips[i]);
      let j = i;
      while (j + 1 < lanes.length && laneText(pool.laneStrips[j + 1]) === t && lanes[j + 1] === lanes[i]) j++;
      keyLines.push(`${i === j ? `lane ${i + 1}` : `lanes ${i + 1}-${j + 1}`} (${f8(lanes[i])}): ${t}`);
      i = j + 1;
    }
    F.text([x0, by + T * k + 38], keyLines, { size: 11.5, color: INK, lead: 1.3 });
    if (pool.boardWidthIn > pool.bandsawCapacityIn) F.text([x0, top + rowH - 30], `Never stand the whole ${f8(pool.boardWidthIn)} board on edge: it is wider than the ${f8(pool.bandsawCapacityIn)} the bandsaw can resaw.`, { size: 11.5, color: ACCENT, italic: true });
    // (b) one lane on edge, resawn; (c) the slabs; (d) one planed strip
    const laneW = lanes[0], mid = top + 96;
    const cx1 = 410, cx2 = 555, cx3 = 690;
    // the lane is the rough board jointed flat (not planed to its finished thickness): the slabs and the kerf come out of that
    const LT = B ? resawUsableIn(B, c.p) : T;
    const lh = laneW * k, lw = LT * k;
    F.rect(cx1 - lw / 2, mid - lh / 2, lw, lh, mat('oak'));
    const slabs = Math.max(1, pool.stripsPerBoard);
    const slabT = (LT - (slabs - 1) * kerf) / slabs;
    for (let i = 1; i < slabs; i++) { const xx = cx1 - lw / 2 + (i * slabT + (i - 0.5) * kerf) * k; F.line([xx, mid - lh / 2 - 8], [xx, mid + lh / 2 + 8], { stroke: ACCENT, width: 2, dash: '5 3' }); }
    F.rect(cx1 - lw / 2 - 8, mid + lh / 2, lw + 16, 4, mat('bench'));
    F.dim([cx1 - lw / 2, mid + lh / 2], [cx1 - lw / 2, mid - lh / 2], f8(pool.resawHeightIn), -14, { flat: true, anchor: 'end' });
    F.text([cx1, mid + lh / 2 + 24], ['one lane on edge:', `resaw height ${f8(pool.resawHeightIn)}`, `(your bandsaw: ${f8(pool.bandsawCapacityIn)})`], { size: 11.5, anchor: 'middle' });
    F.arrow([cx1 + lw / 2 + 14, mid], [cx2 - 30, mid]);
    const sw = slabT * k;
    for (let i = 0; i < slabs; i++) F.rect(cx2 - (slabs * sw + (slabs - 1) * 8) / 2 + i * (sw + 8), mid - lh / 2, sw, lh, mat('oak'));
    F.text([cx2, mid + lh / 2 + 24], [`${slabs} ${slabs === 1 ? 'slab' : 'slabs'}, about ${f16(slabT)} each`, '(the lane: rough board,', `jointed flat, about ${f16(LT)})`], { size: 11.5, anchor: 'middle' });
    F.arrow([cx2 + (slabs * sw + (slabs - 1) * 8) / 2 + 10, mid], [cx3 - 22, mid]);
    const finT = stripRow(pool.laneStrips[0]?.[0]?.id ?? '')?.stock.t ?? pool.roughT;
    F.rect(cx3 - (finT * k) / 2, mid - lh / 2, finT * k, lh, mat('oak', { stroke: ACCENT, width: 1.6 }));
    F.text([cx3, mid + lh / 2 + 24], ['plane each slab', `to ${f16(finT)}`], { size: 11.5, anchor: 'middle' });
  });
  legendOf(F, [OAK_KEY], [16, F.h - 10]);
  F.rect(130, F.h - 20, 14, 10, mat('oak')).hatch(130, F.h - 20, 14, 10, MAT.oak.stroke, 4);
  F.text([149, F.h - 10], 'waste (offcut)', { size: 11.5, color: MUTED });
  F.note('End views, all to one scale');
  const band = pools[0];
  return {
    id: 'mill-resaw',
    title: 'Resawing the strips',
    caption: `The thin strips for the bent parts come out of ordinary boards. Rip each board into lanes as wide as the strips plus the planing allowance, stand one lane on edge and resaw it through its thickness into ${band.stripsPerBoard} slabs, then plane or drum-sand each slab to its strip thickness. The bandsaw only has to cut as high as one lane is wide, never the whole board. The lanes marked spare give the strips for the bend tests in [[step:rail-form]].`,
    svg: F.svg('Resawing the bending strips: the boards ripped into lanes, one lane resawn on edge into slabs, a slab planed to a strip'),
  };
};

/** 2. A face-laminated block whose layers are each edge-glued from 2 unequal boards, so the seams never stack (the bow bulkhead), then milled to size. */
const laminatedBlock: FigFn = (c) => {
  const cl = c.cut();
  const crossGrain = (partId: string): boolean => {
    const row = cl.oak.flatMap((q) => q.rows).find((r) => r.ids.includes(partId));
    return new Set((row?.layerPieces ?? []).map((q) => q.grainWord)).size > 1;
  };
  const gs = cl.glueUps.filter((g) => g.kind === 'both' && g.layers >= 2 && g.edgeBoards >= 2 && !crossGrain(g.partId));
  const g = gs.find((q) => q.ids.includes('bow-bulkhead')) ?? gs[0];
  if (!g) return null;
  const hasCross = cl.glueUps.some((q) => crossGrain(q.partId));
  const cuts = cl.cuts.filter((q) => q.piece === 'layer' && q.glueUp === g.label);
  const layers = [...Array(g.layers)].map((_, i) => cuts.filter((q) => q.layer === i + 1).sort((a, b) => a.index - b.index));
  if (layers.some((l) => l.length < 2)) return null;
  const name = plainName(c.by(g.partId)?.name ?? g.label);
  const others = gs.filter((q) => q !== g).map((q) => plainName(c.by(q.partId)?.name ?? q.label));
  const F = new Fig(760, 420);
  F.heading(`A face-laminated block: the ${name}, seen end on`);
  const k = 26, gap = 22;
  const W = Math.max(...layers.map((l) => l.reduce((a, q) => a + q.rough.w, 0)));
  // 1. each layer edge-glued, the layers apart
  F.badge([28, 58], 1);
  F.sub([46, 63], 'Edge-glue each layer from its 2 boards (board 1 edges all on the left)');
  const x0 = 60;
  let y = 92;
  const seams: number[] = [];
  layers.forEach((l, i) => {
    const t = l[0].rough.t;
    let u = 0;
    for (const q of l) { F.rect(x0 + u * k, y, q.rough.w * k, t * k, mat('oak')); u += q.rough.w; }
    const seam = l[0].rough.w;
    seams.push(seam);
    F.line([x0 + seam * k, y - 3], [x0 + seam * k, y + t * k + 3], { stroke: ACCENT, width: 2.2 });
    F.line([x0 - 7, y + 2], [x0 - 7, y + t * k - 2], { stroke: ACCENT, width: 3 });
    F.text([x0 + W * k + 18, y + (t * k) / 2 + 4], `layer ${i + 1}: ${f16(t)} thick (from ${l[0].board}), boards ${l.map((q) => f8(q.rough.w)).join(' + ')} wide`, { size: 12 });
    y += t * k + gap;
  });
  const yBot = y - gap;
  if (seams.length >= 2) {
    const a = Math.min(seams[0], seams[1]), b = Math.max(seams[0], seams[1]);
    for (const s of [a, b]) F.line([x0 + s * k, 92], [x0 + s * k, yBot + 14], { stroke: ACCENT, width: 0.9, dash: '3 3' });
    F.line([x0 + a * k, yBot + 12], [x0 + b * k, yBot + 12], { stroke: DIM, width: 1 });
    F.text([x0 + ((a + b) / 2) * k, yBot + 30], `seams ${f8(b - a)} apart`, { size: 12, anchor: 'middle', color: DIM });
  }
  F.label([x0 - 7, yBot - 2], [x0 - 12, yBot + 50], ['board 1 edges (marked, orange): keep them on one side, so no seam lies over another'], { size: 12, anchor: 'start' });
  F.label([x0 + seams[0] * k, 96], [x0 + W * k + 18, 82], 'edge-glue seam (Titebond III, cauls)', { size: 12, anchor: 'start' });
  // 2. stacked and glued face to face
  const y2 = 262;
  F.badge([28, y2 - 18], 2);
  F.sub([46, y2 - 13], 'Epoxy the layers face to face');
  let yy = y2 + 10;
  layers.forEach((l, i) => {
    const t = l[0].rough.t;
    let u = 0;
    for (const q of l) { F.rect(x0 + u * k, yy, q.rough.w * k, t * k, mat('oak')); u += q.rough.w; }
    F.line([x0 + l[0].rough.w * k, yy], [x0 + l[0].rough.w * k, yy + t * k], { stroke: MAT.oak.stroke, width: 1.4 });
    yy += t * k;
    if (i < layers.length - 1) F.rect(x0, yy - 1.2, W * k, 2.4, { fill: MAT.epoxy.fill });
  });
  F.text([x0 + (W * k) / 2, yy + 18], `glued block: ${f8(g.roughBlock.t)} × ${f8(g.roughBlock.w)} × ${f8(g.roughBlock.l)} long`, { size: 12, anchor: 'middle' });
  // 3. milled to the finished size
  const x3 = 450;
  F.badge([x3 - 32, y2 - 18], 3);
  F.sub([x3 - 14, y2 - 13], 'Mill it to size: from then on it is solid oak');
  const RB = g.roughBlock, FN = g.final;
  F.rect(x3, y2 + 10, RB.w * k, RB.t * k, mat('ghost', { dash: '4 3' }));
  const fx = x3 + ((RB.w - FN.w) / 2) * k, fy = y2 + 10 + ((RB.t - FN.t) / 2) * k;
  F.rect(fx, fy, FN.w * k, FN.t * k, mat('oak', { stroke: ACCENT, width: 2 }));
  F.text([x3 + (RB.w * k) / 2, y2 + 10 + RB.t * k + 18], [`milled to ${frac(FN.t, 32)} thick × ${frac(FN.w, 32)} wide`, `× ${frac(FN.l, 32)} long (joint, then plane);`, 'the glued block is the dashed line'], { size: 12, anchor: 'middle' });
  F.arrow([x0 + W * k + 14, y2 + 10 + (RB.t * k) / 2], [x3 - 14, y2 + 10 + (RB.t * k) / 2]);
  F.legend(['oak', 'epoxy']);
  F.note('End views (the grain runs into the page), to scale');
  return {
    id: 'mill-laminate',
    title: 'A thick block glued up from layers',
    caption: `A part thicker than the boards is glued up from layers. Where a layer is wider than one board, it is edge-glued first from 2 boards of unequal width; with every board 1 edge kept on the same side, the seams of the layers land ${seams.length >= 2 ? f8(Math.abs(seams[0] - seams[1])) : ''} apart and never over each other. The cured block is jointed and planed to its finished size before anything is cut into it.${others.length ? ` The ${others.join(' and the ')} ${others.length === 1 ? 'is' : 'are'} made the same way.` : ''} Most other thick blocks are one board wide, so they are just layers face to face${hasCross ? '; the brake knee is cross-laminated (next figure)' : ''}.`,
    svg: F.svg(`A face-laminated block: the ${name}, its layers edge-glued with offset seams, glued face to face, then milled to size`),
  };
};

/** 3. The cross-laminated brake knee: three layers, grain upright / across / upright, the pocket notch cut in the rear and center layers before the glue-up. */
const kneeLamination: FigFn = (c) => {
  const part = c.by('brake-knee-L');
  if (!part?.stock) return null;
  const cl = c.cut();
  const gu = cl.glueUps.find((q) => q.ids.includes('brake-knee-L'));
  if (!gu) return null;
  const cuts = cl.cuts.filter((q) => q.piece === 'layer' && q.glueUp === gu.label);
  const layerCuts = [...Array(gu.layers)].map((_, i) => cuts.filter((q) => q.layer === i + 1).sort((a, b) => a.index - b.index));
  if (layerCuts.length !== 3 || layerCuts.some((l) => !l.length)) return null;
  const bg = brakeOf(c.p), kn = bg.knee, pv = bg.pivot;
  if (kn.layers.length !== 3) return null;
  const yIn = Math.min(...kn.poly.map((q) => q[0])), yOut = kn.yOut;
  const zB = kn.zBot, zT = kn.zTop;
  const yc = (yIn + yOut) / 2, zc = (zB + zT) / 2;
  const upright = (i: number): boolean => kn.layers[i].grain === 'z';
  // Each layer's rough rectangle in (y across, z up), centered on the finished knee; the grain runs along its length.
  const R = [0, 1, 2].map((i) => {
    const l = layerCuts[i];
    const sum = l.reduce((a, q) => a + q.rough.w, 0);
    const across = upright(i) ? sum : l[0].rough.l, tall = upright(i) ? l[0].rough.l : sum;
    return { y0: yc - across / 2, y1: yc + across / 2, z0: zc - tall / 2, z1: zc + tall / 2 };
  });
  const notchIn = pv.ySlot[0];
  const joint = edgeJointUp(part, part.stock.w);
  const zJoint = joint !== undefined ? zB + joint : undefined;
  // a layer's face (y, z), with the notch open at the outboard side (high y) on the rear and center layers
  const outline = (i: number): Vec2[] => {
    const r = R[i];
    if (i === 2) return [[r.y0, r.z0], [r.y1, r.z0], [r.y1, r.z1], [r.y0, r.z1]];
    return [[r.y0, r.z0], [r.y1, r.z0], [r.y1, pv.zPocketBot], [notchIn, pv.zPocketBot], [notchIn, pv.zPocketTop], [r.y1, pv.zPocketTop], [r.y1, r.z1], [r.y0, r.z1]];
  };
  const F = new Fig(760, 704);
  F.heading('The brake knee block: 3 layers, cross-laminated like plywood');
  F.text([16, 44], ['Where it goes: one at each rear wheel, bolted to the rail; it carries the brake flap.', 'The left knee, seen from behind the sled: its outboard edge is on the left. The right knee is the mirror image.'], { size: 12, color: MUTED });

  // A. Exploded, oblique: the rear layer nearest, the layers spread forward (up and to the right).
  F.sub([16, 84], 'A. The 3 layers apart (epoxy them face to face), rear layer nearest');
  const k = 14, ox = Math.cos(Math.PI / 6) * k, oy = -Math.sin(Math.PI / 6) * k;
  const explode = 5.2;
  const X0 = 215, Y0 = 330;
  const scr = (y: number, z: number, d: number): Vec2 => [X0 - (y - yc) * k + d * ox, Y0 - (z - zB) * k + d * oy];
  const depth = (i: number): number => kn.layers[i].x0 - kn.x0 + explode * i;
  for (const i of [2, 1, 0]) {
    const d0 = depth(i), d1 = d0 + (kn.layers[i].x1 - kn.layers[i].x0);
    const o = outline(i);
    const front = o.map(([y, z]) => scr(y, z, d0));
    // the side faces seen from here: those whose outward normal points along the depth direction on the screen
    for (let e = 0; e < o.length; e++) {
      const a = o[e], b = o[(e + 1) % o.length];
      const A = scr(a[0], a[1], d0), Bq = scr(b[0], b[1], d0);
      const m: Vec2 = [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2];
      const nl = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]) || 1;
      let n: Vec2 = [(Bq[1] - A[1]) / nl, -(Bq[0] - A[0]) / nl];
      if (pointInPoly([m[0] + n[0] * 0.6, m[1] + n[1] * 0.6], front)) n = [-n[0], -n[1]];
      if (n[0] * ox + n[1] * oy <= 0) continue;
      F.poly([A, Bq, scr(b[0], b[1], d1), scr(a[0], a[1], d1)], { fill: '#d7b77c', stroke: MAT.oak.stroke, width: 1 });
    }
    F.poly(front, mat('oak', { stroke: i === 2 ? MAT.oak.stroke : ACCENT, width: i === 2 ? 1.2 : 1.8 }));
    // grain lines, clipped to the face
    const r = R[i], seg: string[] = [];
    const ln = (a: Vec2, b: Vec2): string => clipToPoly(a, b, front).map(([p0, p1]) => `M${p0[0].toFixed(1)},${p0[1].toFixed(1)}L${p1[0].toFixed(1)},${p1[1].toFixed(1)}`).join('');
    if (upright(i)) for (let y = r.y0 + 0.3; y < r.y1 - 0.15; y += 0.4) seg.push(ln(scr(y, r.z0, d0), scr(y, r.z1, d0)));
    else for (let z = r.z0 + 0.3; z < r.z1 - 0.15; z += 0.4) seg.push(ln(scr(r.y0, z, d0), scr(r.y1, z, d0)));
    F.raw(`<path d="${seg.join('')}" fill="none" stroke="#b88f52" stroke-width="0.7"/>`);
    if (!upright(i) && zJoint !== undefined) F.line(scr(r.y0, zJoint, d0), scr(r.y1, zJoint, d0), { stroke: INK, width: 1.8 });
  }
  const grainOf = (i: number): string => (upright(i) ? 'grain upright' : 'grain across the sled');
  const L1 = layerCuts[0][0], L2 = layerCuts[1], L3 = layerCuts[2][0];
  const lx = 470;
  F.label(scr(R[2].y0 + 0.3, (R[2].z0 + R[2].z1) / 2 + 2, depth(2)), [lx, 112], [`layer 3 (front): ${grainOf(2)}, ONE piece,`, `${f8(L3.rough.w)} × ${f8(L3.rough.l)}, left whole`], { size: 12, anchor: 'start' });
  F.label(scr(R[1].y0 + 0.3, R[1].z0 + 1.2, depth(1)), [lx, 200], [`layer 2 (center): ${grainOf(1)},`, '2 boards edge-glued, stacked:', `${L2.map((q) => f8(q.rough.w)).join(' + ')} tall, ${f8(L2[0].rough.l)} across;`, 'the dark line is the joint'], { size: 12, anchor: 'start' });
  F.label(scr(R[0].y0 + 0.3, R[0].z0 + 1, 0), [lx, 290], [`layer 1 (rear): ${grainOf(0)}, ONE piece,`, `${f8(L1.rough.w)} × ${f8(L1.rough.l)}`], { size: 12, anchor: 'start' });
  const nb = scr((notchIn + R[0].y1) / 2, pv.zPocketBot, 0);
  F.label(nb, [170, 150], ['pocket notch: cut', 'in layers 1 and 2', 'BEFORE the glue-up'], { size: 12, anchor: 'end', color: ACCENT });
  const bl = scr(R[0].y1, R[0].z0, 0), br = scr(R[0].y0, R[0].z0, 0);
  F.text([bl[0] - 4, bl[1] + 16], 'outboard', { size: 11.5, color: MUTED, anchor: 'end' });
  F.text([br[0] + 4, br[1] + 16], 'inboard', { size: 11.5, color: MUTED });

  // B. The glued block from behind, at a larger scale: the milling line, the notch and joint located from the finished edges.
  const top = 400;
  F.sub([16, top], 'B. Glued, from behind: mark the finished edges first, measure from them, then mill to the dashed line');
  const kb = 17, BX = 230, by0 = Math.min(R[0].z0, R[1].z0);
  const BY = top + 30 + (Math.max(R[0].z1, R[1].z1) - by0 + 0.6) * kb;
  const pB = (y: number, z: number): Vec2 => [BX - (y - yc) * kb, BY - (z - by0) * kb];
  F.poly(outline(1).map(([y, z]) => pB(y, z)), mat('oak', { opacity: 0.55 }));
  F.poly(outline(0).map(([y, z]) => pB(y, z)), mat('oak'));
  F.poly(kn.poly.map(([y, z]) => pB(y, z)), { stroke: MUTED, width: 1.2, dash: '2 3' });
  F.poly([pB(yIn, zB), pB(yOut, zB), pB(yOut, zT), pB(yIn, zT)], { stroke: ACCENT, width: 2, dash: '7 4' });
  if (zJoint !== undefined) F.line(pB(R[1].y0, zJoint), pB(R[1].y1, zJoint), { stroke: INK, width: 1.4, dash: '5 3' });
  // heights from the finished bottom edge, on the outboard (left) side
  const xL = pB(R[1].y1, 0)[0];
  const vdim = (z: number, x: number, t: string): void => {
    F.line(pB(yOut, z), [x - 4, pB(0, z)[1]], { stroke: DIM, width: 0.8, dash: '2 2' });
    F.dim([x, pB(0, zB)[1]], [x, pB(0, z)[1]], t, 0, { flat: true, anchor: 'end', size: 12 });
  };
  F.line(pB(yOut, zB), [xL - 114, pB(0, zB)[1]], { stroke: DIM, width: 0.8, dash: '2 2' });
  if (zJoint !== undefined) vdim(zJoint, xL - 18, f16(zJoint - zB));
  vdim(pv.zPocketBot, xL - 64, f16(pv.zPocketBot - zB));
  vdim(pv.zPocketTop, xL - 110, f16(pv.zPocketTop - zB));
  // notch depth from the finished outboard edge, above the block
  const yTopPx = pB(0, Math.max(R[0].z1, R[1].z1))[1] - 12;
  F.line(pB(yOut, pv.zPocketTop), [pB(yOut, 0)[0], yTopPx - 4], { stroke: DIM, width: 0.8, dash: '2 2' });
  F.line(pB(notchIn, pv.zPocketTop), [pB(notchIn, 0)[0], yTopPx - 4], { stroke: DIM, width: 0.8, dash: '2 2' });
  F.dim([pB(notchIn, 0)[0], yTopPx], [pB(yOut, 0)[0], yTopPx], f16(yOut - notchIn), 0, { size: 12 });
  F.text([16, pB(0, zB)[1] + 18], ['heights: up from the', 'finished bottom edge'], { size: 11.5, color: DIM });
  const tx = 380;
  F.label(pB(yIn, zT - 1), [tx, top + 46], ['finished block (dashed orange): milled to', gu.finalText], { size: 12, anchor: 'start' });
  F.label(pB(R[1].y0 - 0.2, (zJoint ?? zc) + 1.6), [tx, top + 96], ['layer 2 shows at the sides: it is wider', 'and shorter than the upright layers'], { size: 12, anchor: 'start' });
  if (zJoint !== undefined) F.label(pB(R[1].y0 - 0.15, zJoint), [tx, top + 146], ['its edge-glue joint (dashed),', 'clear of the bolt holes in the leg'], { size: 12, anchor: 'start' });
  F.label(pB(yIn + 1, (zB + kn.zLeg) / 2), [tx, top + 196], ['the knee shape (dotted): sawn later,', 'leg at the bottom, the pocket in the arm'], { size: 12, anchor: 'start' });
  legendOf(F, [OAK_KEY, { s: mat('oak', { opacity: 0.55 }), label: 'center layer, behind' }], [16, F.h - 12]);
  F.note('A: exploded, not to scale. B: to scale');
  return {
    id: 'mill-knee',
    title: 'The cross-laminated brake knee',
    caption: `Each brake knee is a block of 3 layers glued face to face with the grain crossed, like plywood: the rear and front layers run upright, so the bolted leg cannot split off along the grain, and the center layer runs across the sled. Only the center layer is edge-glued from 2 boards. The pocket that later holds the brake flap's tongue is notched into the rear and center layers before the glue-up, measured from the finished edges marked on each oversize layer; the front layer stays whole. The block is milled to size here and sawn to the knee shape in [[step:brake-knees]].`,
    svg: F.svg('The cross-laminated brake knee: the 3 layers apart with their grain and the pocket notch, and the glued block from behind'),
  };
};

// ── Step 'rail-form' ─────────────────────────────────────────────────────────

/** 1. Where the rails go: the frame from above, the two rails highlighted, their bow ends turning in. */
const railsOnFrame: FigFn = (c) => {
  const g = railForm(c);
  const rl = c.by('rail-L'), rr = c.by('rail-R');
  if (!g || !rl || !rr) return null;
  const L = g.L;
  const F = new Fig(760, 490);
  F.heading('What the rail form makes: the two rails, the bottom of the hull frame');
  const others = c.parts.filter((x) => /^(joist-\d+|king-beam|beam-[RF]|transom-rear|bow-bulkhead)$/.test(x.id));
  const all = [...others, rl, rr].flatMap(planPoly);
  const xA = Math.min(...all.map((q) => q[0])), xB = Math.max(...all.map((q) => q[0]));
  const yMax = Math.max(...all.map((q) => Math.abs(q[1])));
  const kx = 620 / (xB - xA);
  const X = (x: number): number => 70 + (x - xA) * kx;
  const yMid = 92 + yMax * kx;
  const Y = (y: number): number => yMid - y * kx;
  const P = (q: Vec2[]): Vec2[] => q.map(([x, y]) => [X(x), Y(y)]);
  for (const x of others) F.poly(P(planPoly(x)), mat('ghost', { dash: '4 3' }));
  const railBand = (s: 1 | -1, x0: number, x1: number): Vec2[] => {
    const q = samples(x0, x1, 80);
    return [...q.map((x): Vec2 => [x, s * outerHalfWidth(L, x)]), ...[...q].reverse().map((x): Vec2 => [x, s * (outerHalfWidth(L, x) - g.railT)])];
  };
  const r0 = Math.min(...planPoly(rl).map((q) => q[0])), r1 = Math.max(...planPoly(rl).map((q) => q[0]));
  for (const s of [1, -1] as const) F.poly(P(railBand(s, r0, r1)), mat('oak', { stroke: ACCENT, width: 2 }));
  for (const x of [L.taper.x0, L.taper.x1]) for (const s of [1, -1]) F.line([X(x), Y(s * (outerHalfWidth(L, x) + 1))], [X(x), Y(s * (outerHalfWidth(L, x) - g.railT - 1))], { stroke: ACCENT, width: 1.6 });
  const hw0 = outerHalfWidth(L, r0);
  const xm = (L.taper.x0 + L.taper.x1) / 2;
  F.label([X(xm), Y(outerHalfWidth(L, xm))], [X(xm) - 10, 70], `the S: each rail turns in ${f8(g.turn)}`, { anchor: 'start', size: 12 });
  F.label([X(r0 + 3), Y(hw0)], [X(r0), 70], 'left rail (the far one)', { anchor: 'start', size: 12 });
  F.label([X((r0 + L.taper.x0) / 2 + 4), Y(hw0)], [X((r0 + L.taper.x0) / 2 + 4) - 30, 70], 'straight', { anchor: 'start', size: 12 });
  const yRow1 = Y(-yMax) + 30, yRow2 = yRow1 + 28;
  F.label([X(r0 + 3), Y(-hw0)], [X(r0) - 6, yRow2], 'right rail: the same blank as the left one, turned over (top edge up on both)', { anchor: 'start', size: 12 });
  const ctr = (id: string): number | undefined => { const x = c.by(id); if (!x) return undefined; const b = planPoly(x); return b.reduce((a, q) => a + q[0], 0) / b.length; };
  if (g.stripRoughL !== undefined) F.text([X(r0) - 6, yRow2 + 22], `each rail: ${g.plies} strips ${f8(g.stripRoughL)} long, trimmed to about ${f8(rl.stock?.l ?? r1 - r0)} at the dry fit`, { size: 12, color: MUTED });
  const cxB = ctr('beam-R');
  if (cxB !== undefined) F.label([X(cxB), Y(-yMax * 0.8)], [X(cxB) + 16, yRow1], 'rear axle beam: sits in a notch in each rail', { anchor: 'start', size: 12 });
  const cxJ = ctr('joist-3');
  if (cxJ !== undefined) F.label([X(cxJ), Y(L.hwC * 0.5)], [X(cxJ) - 4, 70], 'crossmembers', { anchor: 'start', size: 12 });
  const cxH = ctr('bow-bulkhead');
  if (cxH !== undefined) F.label([X(cxH), Y(-L.hwC * 0.4)], [X(xB), yRow1], 'bow bulkhead', { anchor: 'end', size: 12 });
  F.text([X(xA) - 8, Y(0) + 4], 'rear', { anchor: 'end', size: 12, color: MUTED });
  F.text([X(xB) + 8, Y(0) + 4], 'bow', { size: 12, color: MUTED });
  legendOf(F, [{ s: mat('oak', { stroke: ACCENT, width: 2 }), label: 'the rails (this form)' }, { s: mat('ghost', { dash: '4 3' }), label: 'parts that join them later' }]);
  F.note('From above, to scale');
  return {
    id: 'rail-form-purpose',
    title: 'What the rail form is for',
    caption: `The two rails are the bottom of the hull frame: the crossmembers and the beams join them, and the sides stand on them. Each rail is straight for most of its length, then curves in by ${f8(g.turn)} toward the bow (the S), following the sides. To get that curve with the grain running along it, each rail is ${g.plies} strips of ${f16(g.strip)}${g.stripRoughL !== undefined ? `, ${f8(g.stripRoughL)} long (the rail is trimmed to about ${f8(rl.stock?.l ?? r1 - r0)}, ${f16(g.railW)} deep),` : ` (${f16(g.railW)} deep, about ${f8(rl.stock?.l ?? r1 - r0)} long)`} bent round a form and glued in [[step:rails]]; once the epoxy cures, the rail keeps the curve. This step builds that form and proves it with a dry strip. One form makes both rails: they come off it identical, and one becomes the left rail by turning it over.`,
    svg: F.svg('What the rail form makes: the two rails, highlighted on the hull frame from above'),
  };
};

/** 2. The form set up on its base, from above, and a section across it at the bow end. */
const railFormSetup: FigFn = (c) => {
  const g = railForm(c);
  if (!g) return null;
  const F = new Fig(760, 624);
  F.heading('The rail form on its base, with a dry strip pair in place');
  F.sub([16, 52], 'A. From above (the rear end of the strips on the left, the bow end on the right)');
  const yA = 150;
  const { at, k } = drawFormPlan(F, g, { x: 20, y: yA, w: 720 }, 'build');
  namePlan(F, g, at, 'build');
  // the clamp-station ticks scored on both patterns: short and blue
  for (const s of g.stations) {
    const v = vAt(g.face, s);
    F.line(at(s, v - 0.8), at(s, v), { stroke: CLAMP_BLUE, width: 2 });
    F.line(at(s, g.vTop), at(s, g.vTop - 0.8), { stroke: CLAMP_BLUE, width: 2 });
  }
  const vMid = (u: number): number => vAt(g.face, u);
  const base = g.baseW ?? g.vTop + 2;
  const yAbove1 = yA - 56, yAbove2 = yA - 24, yBelow1 = yA + base * k + 34, yBelow2 = yBelow1 + 34;
  F.label(at(-g.hang * 0.6, g.face[0][1] - (g.fenceT ?? 0.75) / 2), [at(-g.hang, 0)[0], yAbove1], [`${g.fenceT !== undefined ? `${f16(g.fenceT)} ` : ''}scrap fence${g.fenceL !== undefined ? `, about ${f8(g.fenceL)} long` : ''}, screwed to the plywood strip:`, `it holds the ${f8(g.hang)} that hangs off straight`], { size: 12, anchor: 'start' });
  F.label(at(g.sStart, -0.4), [at(g.sStart, 0)[0] - 6, yAbove2], 'S starts (dashed)', { size: 12, anchor: 'end', color: ACCENT });
  F.label(at(g.sEnd, -0.4), [at(g.sEnd, 0)[0] - 6, yAbove2], 'S ends', { size: 12, anchor: 'end', color: ACCENT });
  F.label(at(g.lengthIn * 0.5, vMid(g.lengthIn * 0.5) * 0.35), [at(g.lengthIn * 0.47, 0)[0], yAbove1], [`form: ${g.nLayers !== undefined ? `${g.nLayers} layers of ${f16(g.layerT ?? 0)} MDF` : 'MDF layers'}, ${f8(g.lengthIn)} long,`, 'screwed to the base from below'], { size: 12, anchor: 'start' });
  const sTick = g.stations[g.stations.length - 2];
  F.label(at(sTick, vMid(sTick) - 0.8), [at(g.sEnd, 0)[0] + 16, yAbove2], `${g.clamps} clamp ticks (blue)`, { size: 12, anchor: 'start', color: CLAMP_BLUE });
  F.label(at(-g.baseEnd / 2, g.face[0][1] + g.railT / 2), [at(-g.baseEnd / 2, 0)[0] - 3, yBelow1], [`${g.plies} oak strips on edge, ${f16(g.strip)} × ${f16(g.stripRoughW ?? g.railW)}`, `(planed to ${f16(g.railW)} after the glue-up), dry`], { size: 12, anchor: 'start' });
  if (g.supportL !== undefined && g.baseW !== undefined) F.text(at(-g.baseEnd - g.supportL / 2, g.baseW * 0.7), [`${f16(FORM_BASE_IN)} plywood strip under`, `the overhang, about ${f8(g.supportL)} long,`, 'screwed to the bench'], { size: 11.5, anchor: 'middle' });
  const cu = g.lengthIn * 0.55;
  F.label(at(cu, (vAt(g.counterFace, cu) + g.vTop) / 2), [at(cu, 0)[0] - 20, yBelow2], ['counter-form: the mirror of the form,', 'loose on the base, straight back'], { size: 12, anchor: 'end' });
  if (g.baseEnd > 0) F.label(at(g.lengthIn + g.baseEnd * 0.3, (vAt(g.counterFace, g.lengthIn) + g.vTop) / 2), [at(g.lengthIn + g.baseEnd, 0)[0], yBelow1], 'stop blocks at both ends', { size: 12, anchor: 'end' });
  if (g.baseL !== undefined && g.baseW !== undefined) F.label(at(g.lengthIn * 0.72, g.baseW - 0.8), [at(cu, 0)[0] + 4, yBelow2], `base: ${f16(FORM_BASE_IN)} plywood, ${f8(g.baseL)} × ${f8(g.baseW)}`, { size: 12, anchor: 'start' });

  // B. Section across the form at the bow end
  const sy = 410;
  F.sub([16, sy - 4], 'B. Cut across at the bow end, with one clamp');
  const layerT = g.layerT ?? 0.75, nL = g.nLayers ?? Math.ceil((g.railW + 0.5) / layerT), stackH = g.stackH ?? nL * layerT;
  const ks = 21, sx = 70, yb = sy + 140;
  const S = (v: number, z: number): Vec2 => [sx + v * ks, yb - z * ks];
  const vFace = vAt(g.face, g.lengthIn), vC = vAt(g.counterFace, g.lengthIn);
  const bw = g.baseW ?? g.vTop + 2;
  F.poly([S(0, -layerT), S(bw, -layerT), S(bw, 0), S(0, 0)], mat('deck'));
  for (let i = 0; i < nL; i++) {
    F.poly([S(0, i * layerT), S(vFace, i * layerT), S(vFace, (i + 1) * layerT), S(0, (i + 1) * layerT)], mat('mdf'));
    F.poly([S(vC, i * layerT), S(g.vTop, i * layerT), S(g.vTop, (i + 1) * layerT), S(vC, (i + 1) * layerT)], COUNTER_STYLE);
  }
  for (let i = 0; i < g.plies; i++) F.poly([S(vFace + i * g.strip, 0), S(vFace + (i + 1) * g.strip, 0), S(vFace + (i + 1) * g.strip, g.railW), S(vFace + i * g.strip, g.railW)], mat('oak'));
  const cz = stackH + 0.5;
  F.rect(S(-0.6, 0)[0], S(0, cz + 0.3)[1], (g.vTop + 1.2) * ks, 0.3 * ks, mat('clamp'));
  F.rect(S(-0.6, 0)[0], S(0, cz + 0.3)[1], 0.4 * ks, (cz + 0.3 - stackH / 2) * ks, mat('clamp'));
  F.rect(S(g.vTop + 0.2, 0)[0], S(0, cz + 0.3)[1], 0.4 * ks, (cz + 0.3 - stackH / 2) * ks, mat('clamp'));
  F.arrow(S(-1.7, stackH / 2 - 0.6), S(-0.75, stackH / 2 - 0.6), CLAMP_BLUE, 2);
  F.arrow(S(g.vTop + 1.7, stackH / 2 - 0.6), S(g.vTop + 0.75, stackH / 2 - 0.6), CLAMP_BLUE, 2);
  const lx = sx + (bw + 0.8) * ks;
  F.label(S(g.vTop * 0.8, cz + 0.15), [lx, sy + 18], `clamp: closes the two straight backs, ${frac(g.vTop)} apart`, { size: 12, anchor: 'start', color: CLAMP_BLUE });
  F.label(S(g.vTop - 0.5, stackH - 0.4), [lx, sy + 46], `counter-form: ${nL} layers, its face ${frac(g.railT + COUNTER_CLEARANCE_IN)} off the form face`, { size: 12, anchor: 'start' });
  F.label(S(vFace + g.railT / 2, g.railW - 0.3), [lx, sy + 74], `strips stand on the base; the form is ${f16(stackH - g.railW)} taller`, { size: 12, anchor: 'start' });
  F.label(S(vFace * 0.6, stackH * 0.3), [lx, sy + 102], `form: ${nL} layers of ${f16(layerT)} MDF, ${f16(stackH)} tall`, { size: 12, anchor: 'start' });
  F.label(S(bw - 0.6, -layerT / 2), [lx, sy + 130], 'base', { size: 12, anchor: 'start' });
  legendOf(F, [{ s: mat('mdf'), label: 'MDF (form)' }, { s: COUNTER_STYLE, label: 'MDF (counter-form)' }, { s: mat('deck'), label: `${f16(FORM_BASE_IN)} plywood (base)` }, OAK_KEY, { s: FENCE_STYLE, label: 'scrap fence' }, { s: mat('clamp'), label: MAT.clamp.label }], [16, F.h - 32]);
  F.note('A to scale; B drawn larger');
  return {
    id: 'rail-form-setup',
    title: 'The rail form on its base',
    caption: `The form is a stack of MDF layers whose curved face is the outside of the rail; the counter-form is its mirror image, standing loose on the same base with the strips between them. Both have straight backs, so every clamp squeezes straight across from back to back at the scored ticks, even on the curve. Only the bow end is curved: the long straight rear part of the strips hangs off the form and lies against a fence on the bench. Dry-fit a strip pair before any glue: the channel must be snug from end to end.`,
    svg: F.svg('The rail form on its base from above, with the counter-form, the strips, the fence and the clamp ticks, and a section across it at the bow end'),
  };
};

// ── Step 'rails' ──────────────────────────────────────────────────────────────

/** 1. The glue-up on the form: the order of the clamps (lead-in first, bow end last), a close-up at one clamp, and the actions in order. */
const railGlueUp: FigFn = (c) => {
  const g = railForm(c);
  if (!g) return null;
  const F = new Fig(760, 664);
  F.heading(`Gluing one rail: ${g.plies} strips between the form and the counter-form`);
  F.sub([16, 52], 'A. From above: tighten the clamps in this order, lead-in first, bow end last');
  const { at } = drawFormPlan(F, g, { x: 20, y: 136, w: 720 }, 'glue');
  const lead = [g.sStart / 3, (2 * g.sStart) / 3];
  const order = [...lead, ...g.stations].map((u, i) => ({ u, n: i + 1 }));
  for (const { u, n } of order) {
    clampPlan(F, at, u, g.vTop);
    const p = at(u, -0.9);
    F.badge([p[0], p[1] - 16], n, CLAMP_BLUE);
  }
  namePlan(F, g, at, 'glue');
  // the overhang: a straight caul on the outer strip, spring clamps over caul, strips and fence
  {
    const v0 = g.face[0][1], fT = g.fenceT ?? 0.75, cT = g.layerT ?? 0.75;
    const u0 = -g.hang, u1 = -g.baseEnd - 0.3;
    F.poly([at(u0, v0 + g.railT), at(u1, v0 + g.railT), at(u1, v0 + g.railT + cT), at(u0, v0 + g.railT + cT)], { fill: '#f7f3ea', stroke: '#8a8a8a', width: 1.2 });
    const n = Math.max(2, Number(/^(\d+)/.exec(g.springText ?? '')?.[1] ?? 4));
    const us = Array.from({ length: n }, (_, i) => u0 + 1.5 + (i * (u1 - u0 - 3)) / (n - 1));
    for (const u of us) {
      const a = at(u, v0 - fT - 0.5), b = at(u, v0 + g.railT + cT + 0.5);
      F.line(a, b, { stroke: CLAMP_BLUE, width: 3 });
      F.circle(a, 3, { fill: CLAMP_BLUE });
      F.circle(b, 3, { fill: CLAMP_BLUE });
    }
    F.label(at(us[1], v0 - fT - 0.5), [at(u0, 0)[0], 108], [`a caul on the outer strip and`, `${g.springText ?? 'several'} spring clamps on the overhang`], { size: 12, anchor: 'start', color: CLAMP_BLUE });
  }
  F.arrow([at(lead[0], 0)[0], 70], [at(g.stations[g.stations.length - 1], 0)[0], 70], CLAMP_BLUE, 2);
  F.text([at(lead[0], 0)[0] - 14, 74], [`${g.leadClamps ?? lead.length} on the straight lead-in,`, `then one at each of the ${g.clamps} ticks`], { size: 12, anchor: 'end', color: CLAMP_BLUE });
  const yBelow = at(0, Math.max(g.baseW ?? 0, g.vTop + 0.9))[1] + 22;
  F.label(at(-g.hang * 0.5, g.face[0][1] + g.railT / 2), [at(-g.hang, 0)[0], yBelow], `${g.plies} strips, glued (orange)`, { size: 12, anchor: 'start' });
  F.label(at(g.lengthIn * 0.3, vAt(g.face, g.lengthIn * 0.3) * 0.4), [at(g.lengthIn * 0.3, 0)[0] + 40, yBelow], 'the jig, built in the step before (gray)', { size: 12, anchor: 'start', color: MUTED });

  // B. Close-up at one clamp (section)
  const sy = 336;
  F.sub([16, sy], 'B. Cut across at one clamp');
  const layerT = g.layerT ?? 0.75, stackH = g.stackH ?? g.railW + 0.75;
  const ks = 34, show = 1.6, sx = 60, yb = sy + 190;
  const S = (v: number, z: number): Vec2 => [sx + (v + show) * ks, yb - z * ks];
  F.poly([S(-show, -0.4), S(g.railT + show + 0.4, -0.4), S(g.railT + show + 0.4, 0), S(-show, 0)], mat('ghost'));
  F.poly([S(-show, 0), S(0, 0), S(0, stackH), S(-show, stackH)], mat('ghost'));
  F.poly([S(g.railT + 0.03, 0), S(g.railT + show + 0.4, 0), S(g.railT + show + 0.4, stackH), S(g.railT + 0.03, stackH)], mat('ghost'));
  for (let i = 1; i * layerT < stackH - 1e-6; i++) { F.line(S(-show, i * layerT), S(0, i * layerT), { stroke: MAT.ghost.stroke, width: 0.8 }); F.line(S(g.railT + 0.03, i * layerT), S(g.railT + show + 0.4, i * layerT), { stroke: MAT.ghost.stroke, width: 0.8 }); }
  for (let i = 0; i < g.plies; i++) F.poly([S(i * g.strip, 0), S((i + 1) * g.strip, 0), S((i + 1) * g.strip, g.railW), S(i * g.strip, g.railW)], mat('oak', { stroke: ACCENT, width: 1.6 }));
  for (let i = 1; i < g.plies; i++) F.line(S(i * g.strip, 0.05), S(i * g.strip, g.railW - 0.05), { stroke: MAT.epoxy.fill, width: 3.4 });
  F.line(S(-0.01, 0.02), S(-0.01, stackH), { stroke: '#7a5bd6', width: 2 });
  F.line(S(g.railT + 0.04, 0.02), S(g.railT + 0.04, stackH), { stroke: '#7a5bd6', width: 2 });
  F.arrow(S(-show - 0.9, g.railW / 2), S(-show - 0.1, g.railW / 2), CLAMP_BLUE, 2.4);
  F.arrow(S(g.railT + show + 1.3, g.railW / 2), S(g.railT + show + 0.5, g.railW / 2), CLAMP_BLUE, 2.4);
  const lx = S(g.railT + show + 1.6, 0)[0];
  F.label(S(g.strip * (g.plies - 1), g.railW * 0.75), [lx, sy + 40], ['epoxy rolled on both', 'mating faces'], { size: 12, anchor: 'start' });
  F.label(S(g.railT + 0.04, stackH - 0.3), [lx, sy + 84], ['packing tape on both', 'faces (purple)'], { size: 12, anchor: 'start' });
  F.label(S(g.strip / 2, g.railW * 0.3), [lx, sy + 128], [`strips, ${f16(g.strip)} × ${f16(g.stripRoughW ?? g.railW)}`, `(planed to ${f16(g.railW)} later)`], { size: 12, anchor: 'start' });
  F.text(S(-show / 2, stackH + 0.25), 'form', { size: 12, anchor: 'middle', color: MUTED });
  F.text(S(g.railT + show / 2, stackH + 0.25), 'counter-form', { size: 12, anchor: 'middle', color: MUTED });
  F.text([S(-show, 0)[0] - 4, yb + 26], 'clamp pressure from back to back (blue arrows)', { size: 11.5, color: CLAMP_BLUE });

  // C. The actions in order
  const cx = 420;
  F.sub([cx, sy], 'C. In order');
  const steps = [
    'Roll epoxy on both mating faces; butter one with thickened epoxy.',
    'Stand the pair on edge on the base, against the form face.',
    'Set the counter-form on; every clamp snug but loose.',
    `On the overhang: a caul on the outer strip and ${g.springText ?? 'several'} spring clamps over caul, strips and fence.`,
    `Tighten the clamps together: the lead-in first (${lead.length > 1 ? `1-${lead.length}` : '1'}), then station by station to the bow end.`,
    g.cureH !== undefined ? `Leave it clamped ${g.cureH} h at ${g.cureF ?? ''} °F or warmer before it comes off.` : 'Leave it clamped for the full cure before it comes off.',
  ];
  let yy = sy + 30;
  const wrap = (s: string, n: number): string[] => { const out: string[] = []; let line = ''; for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; } if (line.trim()) out.push(line.trim()); return out; };
  steps.forEach((s, i) => {
    F.badge([cx + 11, yy - 4], i + 1);
    const ls = wrap(s, 40);
    F.text([cx + 30, yy], ls, { size: 12 });
    yy += ls.length * 15 + 12;
  });
  legendOf(F, [OAK_KEY, { s: mat('epoxy'), label: MAT.epoxy.label }, { s: mat('ghost', { stroke: '#8a8a8a' }), label: 'the jig (built before)' }, { s: mat('clamp'), label: MAT.clamp.label }]);
  F.note('Plan to scale; section drawn larger');
  return {
    id: 'rail-glue-up',
    title: 'Gluing a rail on the form',
    caption: `The ${g.plies} strips are glued to each other, not to the jig: the packing tape on the form and counter-form faces sees to that. Set every clamp snug but loose first, then tighten them from the straight lead-in toward the bow end; the counter-form only seats once the strips are fully bent. On the straight overhang a caul and spring clamps hold the strips against the fence, so that part of the glue line is pressed too. One rail per cure: the two come off identical, and one becomes the left rail by turning it over.`,
    svg: F.svg('Gluing one rail: the clamp order from above, a close-up at one clamp, and the actions in order'),
  };
};

/** 2. The finished rail, from its inboard face and its top edge: the beam notch, the bow step, the screw holes, the Domino mortises. */
const finishedRail: FigFn = (c) => {
  const sheet = c.drawings().find((d) => d.partId === 'rail-L');
  const rail = c.by('rail-L');
  if (!sheet || !rail?.stock || rail.geometry.type !== 'mesh') return null;
  const Lr = rail.stock.l, W = rail.stock.w, T = rail.geometry.thickness ?? 0.75;
  const fs = sheet.features;
  const notch = fs.find((q) => (q.kind === 'outline' || q.kind === 'notch') && /^Notch/.test(q.text));
  const step = fs.find((q) => q.kind === 'outline' && /^Step/.test(q.text) && q.angleDeg !== undefined);
  const ties = fs.filter((q) => q.kind === 'hole' && q.face === 'top edge');
  const doms = fs.filter((q) => q.kind === 'mortise' && q.face === 'inboard face' && q.joint === 'domino');
  if (!notch || !step) return null;
  const sMatch = (t: string): number[] => [...t.matchAll(new RegExp(`(${FR})"`, 'g'))].map((m) => parseFr(m[1]));
  const notchSpan = sMatch((notch.positions ?? [])[0] ?? '');
  const notchDeep = grab(new RegExp(`× (${FR})" deep`), notch.size ?? '');
  const stepPts = (step.positions ?? []).map((t) => new RegExp(`(${FR})" from the rear end, (${FR})" from the top edge`).exec(t)).filter((m): m is RegExpExecArray => !!m).map((m): Vec2 => [parseFr(m[1]), parseFr(m[2])]);
  if (notchSpan.length < 2 || notchDeep === undefined || stepPts.length < 2) return null;
  const holes: Array<{ s: number; off: number; bored: boolean }> = [];
  for (const h of ties) {
    const bored = /counterbore/.test(h.size ?? '');
    for (const t of h.positions ?? []) {
      const m = new RegExp(`^(.*?) from the rear end, (?:(${FR})" from the inboard face|centered across the thickness)`).exec(t);
      if (!m) continue;
      for (const s of sMatch(m[1])) holes.push({ s, off: m[2] ? parseFr(m[2]) : T / 2, bored });
    }
  }
  const cb = /with a (\S+)" × (\S+)" counterbore/.exec(ties.find((q) => /counterbore/.test(q.size ?? ''))?.size ?? '');
  const cbDia = cb ? parseFr(cb[1]) : undefined, cbDeep = cb ? parseFr(cb[2]) : undefined;
  const holeDia = grab(new RegExp(`^(${FR})" clearance`), ties[0]?.size ?? '');
  const domS: number[] = [];
  let domDown: number | undefined;
  for (const d of doms) for (const t of d.positions ?? []) { const m = new RegExp(`^(.*?) from the rear end, (${FR})" from the top edge`).exec(t); if (m) { domS.push(...sMatch(m[1])); domDown = parseFr(m[2]); } }
  const domSize = /(\d+×\d+) tenon/.exec(doms[0]?.size ?? '')?.[1];
  // bottom edge (depth from the top edge) along the rail
  const deepAt = (s: number): number => (s <= stepPts[0][0] ? W : s >= stepPts[1][0] ? stepPts[1][1] : W + ((stepPts[1][1] - W) * (s - stepPts[0][0])) / (stepPts[1][0] - stepPts[0][0]));
  const F = new Fig(760, 500);
  F.heading('The finished rail (the left one)');
  F.text([16, 44], 'The right rail is the same blank turned over, so its cuts mirror these.', { size: 12, color: MUTED });
  const extra = 1.2;
  const kx = 690 / (Lr + 2 * extra);
  const x0 = 35 + extra * kx;
  const X = (s: number): number => x0 + s * kx;
  // A. top edge
  const kt = kx * 3.2, yt = 150;
  F.sub([16, 66], 'A. The top edge, from above (thickness drawn 3 times, the bow curve shown straight)');
  const Yt = (off: number): number => yt - off * kt; // inboard face at the bottom
  F.rect(X(-extra), Yt(T), extra * kx, T * kt, mat('ghost', { dash: '4 3' }));
  F.rect(X(Lr), Yt(T), extra * kx, T * kt, mat('ghost', { dash: '4 3' }));
  F.rect(X(0), Yt(T), Lr * kx, T * kt, mat('oak', { stroke: ACCENT, width: 1.6 }));
  for (const h of holes) F.circle([X(h.s), Yt(h.off)], 3, { fill: '#fff', stroke: INK, width: 1.2 });
  F.text([X(0), Yt(0) + 15], 'inboard face', { size: 11.5, color: MUTED });
  F.text([X(Lr), Yt(T) - 6], 'outboard face', { size: 11.5, color: MUTED, anchor: 'end' });
  const h0 = holes[0];
  if (h0) F.label([X(h0.s), Yt(h0.off)], [X(h0.s) + 30, 84], [`${holes.length} screw holes${holeDia ? `, ${frac(holeDia, 64)}` : ''}, straight down through the rail,`, `for the screws up into the side (positions: this step's list)`], { size: 12, anchor: 'start' });
  // B. inboard face
  const kz = kx * 1.9, yz = 210;
  F.sub([16, yz - 12], 'B. The inboard face (depth drawn about 2 times)');
  const Z = (d: number): number => yz + d * kz; // d = depth from the top edge
  const ns0 = notchSpan[0], ns1 = notchSpan[1];
  const prof: Vec2[] = [[X(0), Z(0)], [X(Lr), Z(0)], [X(Lr), Z(deepAt(Lr))], [X(stepPts[1][0]), Z(stepPts[1][1])], [X(stepPts[0][0]), Z(W)], [X(ns1), Z(W)], [X(ns1), Z(W - notchDeep)], [X(ns0), Z(W - notchDeep)], [X(ns0), Z(W)], [X(0), Z(W)]];
  F.rect(X(-extra), Z(0), extra * kx, W * kz, mat('ghost', { dash: '4 3' }));
  F.poly([[X(Lr), Z(0)], [X(Lr + extra), Z(0)], [X(Lr + extra), Z(deepAt(Lr))], [X(Lr), Z(deepAt(Lr))]], mat('ghost', { dash: '4 3' }));
  F.poly(prof, mat('oak', { stroke: ACCENT, width: 1.6 }));
  // hidden: the screw holes and their counterbores
  for (const h of holes) {
    const d = deepAt(h.s);
    F.line([X(h.s), Z(0)], [X(h.s), Z(d)], { stroke: INK, width: 0.9, dash: '3 2' });
    if (h.bored && cbDia !== undefined && cbDeep !== undefined) F.rect(X(h.s) - (cbDia * kx) / 2, Z(d - cbDeep), cbDia * kx, cbDeep * kz, { stroke: INK, width: 0.9, dash: '3 2' });
  }
  // Domino mortises (5 mm wide, long side upright)
  for (const s of domS) if (domDown !== undefined) F.rect(X(s) - 1.6, Z(domDown) - 9, 3.2, 18, { fill: '#5b3f17', stroke: '#5b3f17', width: 0.6 }, 1.5);
  // labels
  F.label([X((ns0 + ns1) / 2), Z(W - notchDeep / 2)], [X(ns0) - 4, 352], [`rear axle beam notch, ${notch.size ?? ''},`, `${f16(ns0)} to ${f16(ns1)} from the rear end`], { size: 12, anchor: 'start' });
  F.label([X((stepPts[0][0] + stepPts[1][0]) / 2), Z((W + stepPts[1][1]) / 2)], [X(Lr) + 4, 352], [`bow step: a ${step.angleDeg}° ramp at ${f16(stepPts[0][0])},`, `then ${f16(stepPts[1][1])} deep to the bow end`], { size: 12, anchor: 'end' });
  const bored = holes.filter((h) => h.bored);
  if (bored.length && cbDia !== undefined && cbDeep !== undefined) { const b = bored[Math.min(5, bored.length - 1)]; F.label([X(b.s) + (cbDia * kx) / 2, Z(W - cbDeep / 2)], [X(b.s) - 26, 404], `${bored.length} counterbored ${f16(cbDia)} × ${f16(cbDeep)} from below (dashed)`, { size: 12, anchor: 'start' }); }
  if (domS.length && domDown !== undefined) { const s = domS[Math.min(2, domS.length - 1)]; F.label([X(s), Z(domDown)], [X(s) + 30, 186], `${domS.length} Domino mortises${domSize ? ` (${domSize})` : ''}, ${f16(domDown)} down from the top edge`, { size: 12, anchor: 'start' }); }
  F.text([X(0), Z(W) + 18], 'rear end', { size: 11.5, color: MUTED });
  F.text([X(Lr), Z(0) - 6], 'bow end', { size: 11.5, color: MUTED, anchor: 'end' });
  F.label([X(-extra / 2), Z(W)], [20, 440], 'measure every position from the finished rear end, not the sawn end', { size: 12, anchor: 'start' });
  F.text([X(Lr * 0.55), Z(0) - 6], 'top edge', { size: 11.5, color: MUTED });
  F.text([X(Lr * 0.3), Z(W) + 18], 'bottom edge', { size: 11.5, color: MUTED });
  legendOf(F, [OAK_KEY, { s: mat('ghost', { dash: '4 3' }), label: 'extra length, trimmed at the dry fit' }, { s: { stroke: INK, width: 1, dash: '3 2' }, label: 'dashed: screw holes and counterbores' }], [16, 470]);
  F.note('Not to scale across the rail');
  return {
    id: 'rail-finished',
    title: 'The finished rail and its cuts',
    caption: `Out of the clamps, each rail is planed flush on its edges and marked at its finished ends; it stays long at both ends until the dry fit trims it, so every position is measured from the finished rear end. The notch in the bottom edge takes the rear axle beam; the bow step makes the rail shallower where the front axle swings under it; the screw holes take the screws that tie the side down onto the rail; the Domino mortises take the crossmembers and the king beam. The end mortises are cut later, in [[step:dry-fit]].`,
    svg: F.svg('The finished rail from its top edge and its inboard face: the beam notch, the bow step, the screw holes and the Domino mortises'),
  };
};

export const PREP_FIGURES: Record<string, FigFn[]> = {
  mill: [resawStrips, laminatedBlock, kneeLamination],
  'rail-form': [railsOnFrame, railFormSetup],
  rails: [railGlueUp, finishedRail],
};

/**
 * The parts of segment a-b inside a polygon (grain lines trimmed to a face). Done by hand rather than with an SVG clip path: a clip needs
 * `url(#id)`, which the self-contained build book forbids, and its id would collide between figures on one page.
 */
function clipToPoly(a: Vec2, b: Vec2, poly: Vec2[]): Array<[Vec2, Vec2]> {
  const ts = [0, 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const at = (t: number): Vec2 => [a[0] + dx * t, a[1] + dy * t];
  const out: Array<[Vec2, Vec2]> = [];
  for (let k = 0; k + 1 < ts.length; k++) if (ts[k + 1] - ts[k] > 1e-9 && pointInPoly(at((ts[k] + ts[k + 1]) / 2), poly)) out.push([at(ts[k]), at(ts[k + 1])]);
  return out;
}
