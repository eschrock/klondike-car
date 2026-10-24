/**
 * Figures for the hull steps: the rear axle hangers on the rails (hangers), the frame and deck unit (frame), the dry fit in the inverted sides on the station cradles
 * (dry-fit), the glue-up of the unit into the sides (lower) and the closing of the two ends (transom, bulkhead).
 *
 * Shapes and printed numbers come from the parts (bounds, joints, outlines and profiles), the part drawings, the layout and the dry-fit cradle stations; schematic
 * drawing constants (gaps, break lengths, the cradle plate's base, label places) are never printed. From the dry fit to the flip the hull is upside down, and these
 * figures draw it that way.
 */
import { worldAABB, transformPoint, type Bounds } from '../../model/bounds';
import { computeLayout, outerHalfWidth, samples, sideTopAt, type Layout } from '../../model/layout';
import { beamSeat } from '../../model/rear-mount';
import type { Part, Vec2, Vec3 } from '../../model/types';
import { cradleHeights, cradleStations, chineTie, transomVents } from '../assembly';
import { frac } from '../svg-util';
import { ACCENT, DIM, Fig, fit, INK, MAT, mat, MUTED, type FigCtx, type FigFn, type Frame, type Style, type TextOpts } from './kit';

/** Inches as a fraction to 1/8 (a rough figure label), to 1/16 and to 1/32 (a drilled position, as the steps print it). */
const f8 = (v: number): string => frac(v, 8);
const f16 = (v: number): string => frac(v, 16);

const bbOf = (c: FigCtx, id: string): Bounds | undefined => { const q = c.by(id); return q ? worldAABB(q) : undefined; };
const ghost = (extra: Style = {}): Style => mat('ghost', { dash: '4 3', ...extra });
const accent = (m: keyof typeof MAT, extra: Style = {}): Style => mat(m, { stroke: ACCENT, width: 1.8, ...extra });
const T12: TextOpts = { size: 12 };

/** A rectangle given by two corners in a frame's own units. */
function rectIn(F: Fig, fr: Frame, a: Vec2, b: Vec2, s: Style): void {
  F.poly([fr.at([a[0], a[1]]), fr.at([b[0], a[1]]), fr.at([b[0], b[1]]), fr.at([a[0], b[1]])], s);
}

/** Clip a closed polygon to u <= uMax (one half-plane, Sutherland-Hodgman). */
function clipU(poly: Vec2[], uMax: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a[0] <= uMax, inb = b[0] <= uMax;
    if (ina) out.push(a);
    if (ina !== inb) { const t = (uMax - a[0]) / (b[0] - a[0]); out.push([uMax, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/** The (x, z) outline of a plan-curved wall part (the rails, the side layers). */
const profileOf = (q: Part | undefined): Vec2[] | null => (q && q.geometry.type === 'mesh' && q.geometry.profile ? q.geometry.profile : null);

/** World points of a part's joints that match. */
function jointPts(q: Part | undefined, test: (j: NonNullable<Part['joints']>[number]) => boolean): Vec3[] {
  if (!q) return [];
  return (q.joints ?? []).filter(test).flatMap((j) => (j.at ?? []).map((a) => transformPoint(q.transform, a)));
}

/** "5/8"" or "1-1/4"" (a drawing's own text) to inches. */
function parseInchText(s: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+)\/(\d+)|(\d+))"?$/.exec(s.trim());
  if (!m) return NaN;
  const whole = Number(m[1] ?? 0);
  return m[4] !== undefined ? whole + Number(m[4]) : whole + Number(m[2]) / Number(m[3]);
}

/** The rail's screw holes for the side, as its drawing prints their distances from the rear end (measured along the rail), in order. */
function railHoleStations(c: FigCtx): string[] {
  const sheet = c.drawings().find((s) => s.partIds.includes('rail-L'));
  const fs = (sheet?.features ?? []).filter((q) => q.kind === 'hole' && (q.to ?? []).some((t) => /chine/.test(t)));
  const vals = fs.flatMap((q) => (q.positions ?? []).flatMap((pos) => pos.split(' from the rear end')[0].match(/\d[\d\-/]*"/g) ?? []));
  return [...new Set(vals)].sort((a, b) => parseInchText(a) - parseInchText(b));
}

/** The counterbore of the rail's screws for the side (depth, diameter) from the rail's screw joint; NaN when there is none. */
function railCounterbore(rail: Part): { depth: number; dia: number } {
  const sj = rail.joints?.find((j) => j.type === 'screw' && /chine/.test(j.to) && /counterbore/.test(j.size ?? ''));
  const depth = Number(/counterbore the head ([\d.]+)"/.exec(sj?.size ?? '')?.[1] ?? 'NaN');
  const bit = /\(([\d/]+")\s*bit\)/.exec(sj?.size ?? '')?.[1];
  return { depth, dia: bit ? parseInchText(bit) : NaN };
}

/** A bar clamp seen end-on: a bar across the top at `yBar` (px) and two jaws hanging down, their pads touching at `xIn` (pad's right face) and `xOut` (pad's left face). */
function barClamp(F: Fig, xIn: number, xOut: number, yBar: number, yPad0: number, yPad1: number): void {
  const c = MAT.clamp.stroke;
  F.line([xIn - 16, yBar], [xOut + 16, yBar], { stroke: c, width: 5 });
  F.line([xIn - 8, yBar], [xIn - 8, yPad0], { stroke: c, width: 4 });
  F.line([xOut + 8, yBar], [xOut + 8, yPad0], { stroke: c, width: 4 });
  F.rect(xIn - 10, yPad0, 10, yPad1 - yPad0, mat('clamp'));
  F.rect(xOut, yPad0, 10, yPad1 - yPad0, mat('clamp'));
}

/** Zigzag break lines (a part drawn cut short): vertical at x, or horizontal at y (px). */
function breakV(F: Fig, x: number, y0: number, y1: number): void {
  const n = 4, h = (y1 - y0) / n, pts: Vec2[] = [[x, y0 - 4]];
  for (let i = 0; i < n; i++) pts.push([x + (i % 2 ? -4 : 4), y0 + h * (i + 0.5)]);
  pts.push([x, y1 + 4]);
  F.poly(pts, { stroke: MUTED, width: 1 }, false);
}
function breakH(F: Fig, y: number, x0: number, x1: number): void {
  const n = 4, w = (x1 - x0) / n, pts: Vec2[] = [[x0 - 4, y]];
  for (let i = 0; i < n; i++) pts.push([x0 + w * (i + 0.5), y + (i % 2 ? -4 : 4)]);
  pts.push([x1 + 4, y]);
  F.poly(pts, { stroke: MUTED, width: 1 }, false);
}

/** The layers of the left side at x, in model y (outer face, outer band / web, web / inner band, inner face) and z (the band edges, the sheer). */
interface SideLayers { yo: number; yWo: number; yWi: number; yi: number; chineTop: number; innerChineBot: number; gunBot: number; sheer: number; webTop: number }
function sideLayers(c: FigCtx, L: Layout, x: number): SideLayers {
  const yo = outerHalfWidth(L, x);
  const webT = Math.max(0.05, L.side - 2 * L.sideBand);
  const inChine = bbOf(c, 'side-L-chine-in');
  const sheer = sideTopAt(L, x);
  return {
    yo, yWo: yo - L.sideBand, yWi: yo - L.sideBand - webT, yi: yo - L.side,
    chineTop: L.chineBot + L.railBand, innerChineBot: inChine ? inChine.min[2] : L.deckTop + c.p.deckSlopIn, gunBot: sheer - L.railBand, sheer, webTop: sheer - L.webCap,
  };
}

/** Draw a section through the left side at x (upside down when `P` maps z down): web, chine bands and, when `full`, the gunwale bands; cut at `zTo` otherwise. */
function drawSide(F: Fig, P: (y: number, z: number) => Vec2, L: Layout, S: SideLayers, zTo: number, s: 1 | -1 = 1, full = false): void {
  const RC = (y0: number, z0: number, y1: number, z1: number, st: Style): void => { F.poly([P(s * y0, z0), P(s * y1, z0), P(s * y1, z1), P(s * y0, z1)], st); };
  const top = full ? S.webTop : zTo;
  RC(S.yWo, L.chineBot, S.yWi, top, mat('web'));
  RC(S.yo, L.chineBot, S.yWo, Math.min(S.chineTop, zTo), mat('oak'));
  RC(S.yWi, S.innerChineBot, S.yi, Math.min(S.chineTop, zTo), mat('oak'));
  if (full) {
    RC(S.yo, S.gunBot, S.yWo, S.sheer, mat('oak'));
    RC(S.yWi, S.gunBot, S.yi, S.sheer, mat('oak'));
  }
}

// ───────────────────────────── hangers ─────────────────────────────

/** The rear axle hanger glued to the rail's inboard face: the notches in line, the two bolt holes through both (side view), and a small plan. */
const hangerOnRail: FigFn = (c) => {
  const rail = c.by('rail-L'), hg = c.by('axle-hanger-L');
  const prof = profileOf(rail);
  const L = computeLayout(c.p);
  const sa = beamSeat(c.p, L);
  if (!rail || !hg || !prof || !sa) return null;
  const R = worldAABB(rail), H = worldAABB(hg), B = bbOf(c, 'beam-R'), J1 = bbOf(c, 'joist-1');
  const bolts = sa.hd.railBolts;
  const dom = jointPts(hg, (j) => j.type === 'domino' && j.to === 'joist-1')[0];
  const nx0 = sa.x0, nx1 = sa.x1;
  const inNotch = prof.filter((q) => q[0] >= nx0 - 1e-3 && q[0] <= nx1 + 1e-3 && q[1] < R.max[2] - 1e-3).map((q) => q[1]);
  const railNotchTop = inNotch.length ? Math.max(...inNotch) : sa.zTop;
  const hangNotchTop = sa.zTop;

  const F = new Fig(760, 610);
  F.heading('The rear axle hanger, glued to the inside face of each rail');
  F.sub([16, 52], 'A. Looking at the inside face of the left rail, rear end at the left');
  const xEnd = H.max[0] + 2.5;
  const fa = fit({ minX: R.min[0] - 0.4, minY: (B ? B.min[2] : H.min[2]) - 0.1, maxX: xEnd + 0.3, maxY: R.max[2] + 0.1 }, { x: 50, y: 120, w: 470, h: 200 });
  if (B) rectIn(F, fa, [B.min[0], B.min[2]], [B.max[0], B.max[2]], ghost());
  F.poly(clipU(prof, xEnd).map(fa.at), mat('oak'));
  breakV(F, fa.at([xEnd, 0])[0], fa.at([0, R.max[2]])[1], fa.at([0, R.min[2]])[1]);
  // the small relief in the hanger's notch ceiling over the axle rod (from the hanger's own cut record)
  const relJ = hg.joints?.find((j) => j.type === 'hole' && j.to === 'axle-R' && j.cut);
  const rlo = relJ?.cut?.lo ? transformPoint(hg.transform, relJ.cut.lo) : undefined, rhi = relJ?.cut?.hi ? transformPoint(hg.transform, relJ.cut.hi) : undefined;
  const rel = rlo && rhi ? { x0: Math.min(rlo[0], rhi[0]), x1: Math.max(rlo[0], rhi[0]), z1: Math.max(rlo[2], rhi[2]) } : undefined;
  const relSize = c.drawings().find((d) => d.partIds.includes('axle-hanger-L'))?.features.find((q) => (q.to ?? []).includes('axle-R'))?.size?.split(' opening')[0];
  const ceil: Vec2[] = rel ? [[nx0, hangNotchTop], [rel.x0, hangNotchTop], [rel.x0, rel.z1], [rel.x1, rel.z1], [rel.x1, hangNotchTop], [nx1, hangNotchTop]] : [[nx0, hangNotchTop], [nx1, hangNotchTop]];
  const hp: Vec2[] = [[H.min[0], H.min[2]], [nx0, H.min[2]], ...ceil, [nx1, H.min[2]], [H.max[0], H.min[2]], [H.max[0], H.max[2]], [H.min[0], H.max[2]]];
  F.poly(hp.map(fa.at), accent('oak', { fill: '#efd9a8' }));
  // the rail's own notch, behind the hanger (hidden), in line with it
  F.poly(([[nx0, H.min[2] + 0.02], [nx0, railNotchTop], [nx1, railNotchTop], [nx1, H.min[2] + 0.02]] as Vec2[]).map(fa.at), { stroke: MAT.oak.stroke, width: 1.3, dash: '3 3' }, false);
  for (const [x, z] of bolts) F.circle(fa.at([x, z]), Math.max(3.5, (17 / 64 / 2) * fa.kx), { fill: '#fff', stroke: MAT.steel.stroke, width: 1.4 });
  if (dom) { const p = fa.at([dom[0], dom[2]]); F.rect(p[0] - 3.5, p[1] - 0.38 * fa.ky, 7, 0.76 * fa.ky, { fill: '#fff', stroke: INK, width: 1.2 }, 3); }
  const top = fa.at([0, R.max[2]])[1], bot = fa.at([0, R.min[2]])[1];
  const xr = fa.at([xEnd, 0])[0] + 24;
  F.label(fa.at([xEnd - 1.2, R.max[2] - 0.5]), [xr, top - 52], 'rail (laminated in the last step)', T12);
  F.label(fa.at([H.max[0] - 0.7, R.max[2] - 0.35]), [xr, top - 16], ['rear axle hanger, glued on', '(side grain to side grain)'], T12);
  F.label(fa.at([bolts[1][0], bolts[1][1]]), [xr, top + 26], [`${bolts.length} bolt holes, drilled`, 'through both at once'], T12);
  F.label(fa.at([nx1 - 0.2, hangNotchTop]), [xr, bot + 20], ['notch in the hanger, in line', 'with the rail\'s'], T12);
  F.label(fa.at([nx0 + 0.25, railNotchTop]), [xr, top + 62], ['rail notch (dashed, behind): cut', 'higher, to clear the axle clamp plate'], T12);
  F.dim(fa.at([nx0, H.min[2]]), fa.at([nx1, H.min[2]]), frac(nx1 - nx0, 32), 34);
  F.dim(fa.at([H.min[0], H.min[2]]), fa.at([nx0, H.min[2]]), frac(nx0 - H.min[0], 32), 34);
  if (rel) F.label(fa.at([(rel.x0 + rel.x1) / 2, rel.z1]), [fa.at([H.min[0], 0])[0] - 10, bot + 30], [`relief${relSize ? ` ${relSize}` : ''}:`, 'clears the axle rod'], { ...T12, anchor: 'end' });
  F.dim(fa.at([nx1, H.min[2]]), fa.at([nx1, hangNotchTop]), frac(hangNotchTop - H.min[2], 32), 0, { flat: true });
  if (B) F.label(fa.at([B.max[0] - 0.3, B.min[2] + 0.3]), [xr, bot + 62], ['rear axle beam (later):', 'it sits in the notches'], { ...T12, color: MUTED });
  if (dom) F.label(fa.at([dom[0] - 0.1, dom[2] - 0.2]), [fa.at([H.min[0], 0])[0] - 10, top + 56], ['Domino mortise for crossmember 1,', 'cut in the hanger now'], { ...T12, anchor: 'end' });
  if (dom) F.dim(fa.at([dom[0] - 0.45, R.max[2]]), fa.at([dom[0] - 0.45, dom[2]]), f16(R.max[2] - dom[2]), 0, { flat: true, anchor: 'end' });
  F.dim(fa.at([R.min[0], R.max[2]]), fa.at([H.min[0], R.max[2]]), f16(H.min[0] - R.min[0]), -14);
  F.dim(fa.at([bolts[0][0], R.max[2]]), fa.at([bolts[0][0], bolts[0][1]]), f16(R.max[2] - bolts[0][1]), 0, { flat: true, anchor: 'end' });
  F.text([fa.at([R.min[0], 0])[0], top - 42], 'finished rear end', { size: 11.5, color: MUTED });
  F.line(fa.at([R.min[0], R.max[2] + 0.05]), [fa.at([R.min[0], 0])[0], top - 38], { stroke: MUTED, width: 0.8 });

  // B. From above: the left rail's rear end, the hanger inboard of it, crossmember 1 and the beam to come.
  F.sub([16, 420], 'B. From above (left rail; the right rail is the mirror image)');
  const yC = H.min[1] - 3;
  const fb = fit({ minX: R.min[0] - 0.4, minY: yC, maxX: xEnd + 0.3, maxY: (B ? B.max[1] : R.max[1]) + 0.3 }, { x: 50, y: 436, w: 470, h: 128 });
  if (B) rectIn(F, fb, [B.min[0], yC], [B.max[0], B.max[1]], ghost());
  if (J1) rectIn(F, fb, [J1.min[0], yC], [J1.max[0], H.min[1]], ghost());
  const yRo = L.hwC + L.side, yRi = yRo - c.p.railThicknessIn;
  rectIn(F, fb, [R.min[0], yRi], [xEnd, yRo], mat('oak'));
  breakV(F, fb.at([xEnd, 0])[0], fb.at([0, yRo])[1], fb.at([0, yRi])[1]);
  rectIn(F, fb, [H.min[0], H.min[1]], [H.max[0], H.max[1]], accent('oak', { fill: '#efd9a8' }));
  for (const [x] of bolts) F.line(fb.at([x, H.min[1] - 0.15]), fb.at([x, yRo + 0.15]), { stroke: MAT.steel.stroke, width: 1.4, dash: '3 2' });
  F.clamp(fb.at([H.min[0] + 0.5, 0])[0], fb.at([0, yRo])[1], fb.at([0, H.min[1]])[1], 'left', 20);
  F.clamp(fb.at([H.max[0] - 0.5, 0])[0], fb.at([0, yRo])[1], fb.at([0, H.min[1]])[1], 'right', 20);
  F.label(fb.at([R.min[0] + 3, yRo]), [fb.at([R.min[0] + 3, 0])[0] - 30, fb.at([0, yRo])[1] - 22], 'rail', { ...T12, anchor: 'end' });
  F.label(fb.at([H.max[0] - 1.6, H.min[1] + 0.2]), [xr, 470], ['hanger, clamped on', 'while the glue sets'], T12);
  F.label(fb.at([bolts[1][0], yRi + 0.1]), [xr, 512], 'bolt holes through both', T12);
  if (J1) F.label(fb.at([J1.max[0], yC + 1]), [xr, 540], ['crossmember 1 (next step)', 'ends in the hanger'], { ...T12, color: MUTED });
  if (B) F.label(fb.at([B.max[0], yC + 0.6]), [xr, 582], 'the rear axle beam passes under', { ...T12, color: MUTED });
  F.legend(['oak', 'clamp'], [16, 600]);
  F.text([210, 600], 'gray dashed: comes later', { size: 11.5, color: MUTED });
  F.note('Not to scale between views');
  return {
    id: 'hanger-on-rail',
    title: 'The rear axle hanger on its rail',
    caption: `View A looks at the inside face of the left rail near its rear end, view B looks down on it. The hanger's notch lines up with the rail's. The right rail is the mirror image.`,
    svg: F.svg('The rear axle hanger glued to the inside face of the rail, from the side and from above'),
  };
};

// ───────────────────────────── frame ─────────────────────────────

/** The frame from above, deck lifted off (its outline dashed): rails, numbered crossmembers, king beam, hangers, brake knee backers, seat-hinge backers. */
const framePlan: FigFn = (c) => {
  const R = bbOf(c, 'rail-L'), deck = c.by('deck');
  if (!R || !deck || deck.geometry.type !== 'extrusion') return null;
  const L = computeLayout(c.p);
  const F = new Fig(760, 510);
  F.heading('The frame from above, with the deck lifted off (its outline dashed)');
  const D = worldAABB(deck);
  const fr = fit({ minX: D.min[0] - 0.3, minY: -D.max[1] - 0.6, maxX: D.max[0] + 0.3, maxY: D.max[1] + 0.6 }, { x: 140, y: 104, w: 550, h: 260 }, 1, 'center');
  const yRo = L.hwC + L.side, yRi = yRo - c.p.railThicknessIn;
  const xs = samples(R.min[0], R.max[0], 100);
  const joists = c.parts.filter((q) => /^(joist-\d+|king-beam)$/.test(q.id)).map((q) => ({ q, b: worldAABB(q) })).sort((a, b) => a.b.min[0] - b.b.min[0]);
  for (const s of [1, -1] as const) {
    F.poly([...xs.map((x): Vec2 => [x, s * (yRo - L.turnIn(x))]), ...[...xs].reverse().map((x): Vec2 => [x, s * (yRi - L.turnIn(x))])].map(fr.at), mat('oak'));
  }
  for (const id of ['axle-hanger-L', 'axle-hanger-R']) { const b = bbOf(c, id); if (b) rectIn(F, fr, [b.min[0], b.min[1]], [b.max[0], b.max[1]], mat('oak')); }
  for (const { b } of joists) rectIn(F, fr, [b.min[0], b.min[1]], [b.max[0], b.max[1]], accent('oak', { width: 1.4 }));
  for (const id of ['brake-backer-L', 'brake-backer-R']) { const b = bbOf(c, id); if (b) rectIn(F, fr, [b.min[0], b.min[1]], [b.max[0], b.max[1]], accent('oak', { width: 1.4 })); }
  for (const id of ['brake-backplate-L', 'brake-backplate-R']) { const b = bbOf(c, id); if (b) rectIn(F, fr, [b.min[0], b.min[1]], [b.max[0], b.max[1]], mat('steel', { stroke: ACCENT, width: 1 })); }
  for (const id of ['seat-hinge-backer-L', 'seat-hinge-backer-R']) { const b = bbOf(c, id); if (b) rectIn(F, fr, [b.min[0], b.min[1]], [b.max[0], b.max[1]], accent('oak', { width: 1.4, dash: '4 2', fill: '#f4e4c0' })); }
  const king = joists.find((j) => j.q.id === 'king-beam');
  if (king) F.circle(fr.at([L.king.x, 0]), Math.max(3, (c.p.kingpinDiaIn / 2) * fr.kx), { fill: '#fff', stroke: INK, width: 1.2 });
  F.poly(deck.geometry.outline.map((q) => { const w = transformPoint(deck.transform, [q[0], q[1], 0]); return fr.at([w[0], w[1]]); }), { stroke: ACCENT, width: 1.6, dash: '7 4' });
  // crossmember numbers along the top
  const yNum = fr.at([0, D.max[1]])[1] - 10;
  for (const { q, b } of joists) {
    const m = /Crossmember (\d+)/.exec(q.name);
    if (m) F.text([fr.at([(b.min[0] + b.max[0]) / 2, 0])[0], yNum], m[1], { size: 13, anchor: 'middle', weight: 'bold', color: ACCENT });
  }
  F.text([fr.at([D.min[0], 0])[0], yNum - 22], 'crossmembers, numbered from the rear:', { size: 12, color: ACCENT });
  const yMid = fr.at([0, 0])[1];
  F.text([fr.at([D.min[0], 0])[0] - 8, yMid - 30], 'rear', { size: 12, anchor: 'end', color: MUTED });
  F.text([fr.at([D.max[0], 0])[0] + 8, yMid + 4], 'bow', { size: 12, color: MUTED });
  F.label(fr.at([D.min[0], -2]), [fr.at([D.min[0], 0])[0] - 12, yMid + 4], ['deck outline', '(dashed): it is', 'bonded on top', 'of every part'], { ...T12, anchor: 'end', color: ACCENT });
  // labels below the plan
  const yl = fr.at([0, -D.max[1]])[1] + 34;
  const hgR = bbOf(c, 'axle-hanger-R'), bkR = bbOf(c, 'brake-backer-R'), shR = bbOf(c, 'seat-hinge-backer-R');
  if (hgR) { const t = fr.at([(hgR.min[0] + hgR.max[0]) / 2, hgR.min[1] + 0.2]); F.label(t, [t[0] - 4, yl], ['rear axle hangers', '(last step)'], { ...T12, anchor: 'end' }); }
  if (bkR) { const t = fr.at([(bkR.min[0] + bkR.max[0]) / 2, bkR.min[1] + 0.2]); F.label(t, [t[0] + 6, yl + 52], ['brake knee backers and', 'their stainless plates'], { ...T12, anchor: 'start' }); }
  if (shR) F.label(fr.at([(shR.min[0] + shR.max[0]) / 2, (shR.min[1] + shR.max[1]) / 2]), [fr.at([(shR.min[0] + shR.max[0]) / 2, 0])[0] + 6, yl], ['seat-back hinge backers (dashed): glued', 'under the deck, where crossmember 3 lands'], { ...T12, anchor: 'start' });
  const xr = R.max[0] - 3;
  F.label(fr.at([xr, -(yRo - L.turnIn(xr) - c.p.railThicknessIn / 2)]), [654, yl], ['rails, bent in', 'toward the bow'], { ...T12, anchor: 'start' });
  if (king) F.label(fr.at([L.king.x, -(king.b.max[1] - 1.5)]), [fr.at([L.king.x, 0])[0] - 4, yl + 52], ['king beam (in place of', 'crossmember 7), bored', 'for the kingpin'], { ...T12, anchor: 'end' });
  F.legend(['oak'], [16, 500]);
  F.text([140, 500], 'orange outline: added in this step', { size: 11.5, color: ACCENT });
  F.note('Plan from above, to scale');
  return {
    id: 'frame-plan',
    title: 'The frame from above',
    caption: `The frame and deck unit seen from above with the deck lifted off; its outline is dashed. The crossmembers are numbered from the rear.`,
    svg: F.svg('The frame from above, with the deck outline dashed and the crossmembers numbered'),
  };
};

/** A section across the frame at the brake knee backer (left side): the deck bonded on the rail and backer tops, the stainless plate in its recess, the knee-bolt holes. */
const frameSection: FigFn = (c) => {
  const R = bbOf(c, 'rail-L'), bk = bbOf(c, 'brake-backer-L'), pl = bbOf(c, 'brake-backplate-L');
  if (!R || !bk || !pl) return null;
  const L = computeLayout(c.p);
  const holeJ = c.by('rail-L')?.joints?.find((j) => j.type === 'hole' && /^brake-knee/.test(j.to));
  const holes = jointPts(c.by('rail-L'), (j) => j === holeJ);
  const xCut = holes.length ? Math.min(...holes.map((q) => q[0])) : (bk.min[0] + bk.max[0]) / 2;
  const zs = [...new Set(holes.map((q) => +q[2].toFixed(3)))].sort((a, b) => b - a);
  const boltD = holeJ?.diaIn ?? c.p.brakeMountBoltDiaIn;
  const holeD = boltD + 1 / 32;
  const yRo = L.hwC + L.side - L.turnIn(xCut), yRi = yRo - c.p.railThicknessIn;
  const yDeck = L.hwC - L.turnIn(xCut) + L.deckEdge;
  const beyond = c.parts.filter((q) => /^(joist-\d+)$/.test(q.id)).map((q) => worldAABB(q)).filter((b) => b.min[0] > xCut).sort((a, b) => a.min[0] - b.min[0])[0];
  const sh = bbOf(c, 'seat-hinge-backer-L');
  const S = sideLayers(c, L, xCut);
  const F = new Fig(760, 500);
  F.heading('Section across the frame at a brake knee backer (left side, looking forward)');
  const yIn = (sh ? sh.min[1] : yRi - 4) - 0.6, zTop = L.deckTop + 1.1;
  // looking forward, the left side (+y) is at the left of the drawing
  const fr = fit({ minX: -(yRo + 0.2), minY: R.min[2] - 0.1, maxX: -yIn, maxY: zTop }, { x: 210, y: 92, w: 330, h: 270 });
  const P = (y: number, z: number): Vec2 => fr.at([-y, z]);
  const RC = (y0: number, z0: number, y1: number, z1: number, s: Style): void => { F.poly([P(y0, z0), P(y1, z0), P(y1, z1), P(y0, z1)], s); };
  if (beyond) RC(Math.min(beyond.max[1], yRi), beyond.min[2], yIn, beyond.max[2], ghost());
  if (sh) RC(sh.max[1], sh.min[2], sh.min[1], sh.max[2], ghost({ fill: '#f7f7f7' }));
  RC(S.yo, L.chineBot, S.yWo, zTop, ghost());
  RC(S.yWo, L.chineBot, S.yWi, zTop, ghost());
  RC(S.yWi, S.innerChineBot, S.yi, zTop, ghost());
  breakH(F, P(0, zTop)[1], P(S.yo, 0)[0], P(S.yi, 0)[0]);
  RC(yRo, R.min[2], yRi, R.max[2], mat('oak'));
  RC(bk.max[1], bk.min[2], bk.min[1], bk.max[2], accent('oak'));
  RC(pl.max[1], pl.min[2], pl.min[1], pl.max[2], mat('steel', { stroke: ACCENT, width: 1.6 }));
  for (const z of zs) for (const dz of [-holeD / 2, holeD / 2]) F.line(P(yRo, z + dz), P(pl.min[1], z + dz), { stroke: INK, width: 1, dash: '4 2' });
  RC(yDeck, L.deckBot, yIn, L.deckTop, accent('deck'));
  breakV(F, P(yIn, 0)[0], P(0, L.deckTop)[1], P(0, L.deckBot)[1]);
  F.rect(P(yDeck, 0)[0], P(0, L.deckBot)[1], P(bk.min[1], 0)[0] - P(yDeck, 0)[0], 3, { fill: MAT.epoxy.fill });
  if (beyond) F.rect(P(bk.min[1], 0)[0], P(0, L.deckBot)[1], P(yIn, 0)[0] - P(bk.min[1], 0)[0], 3, { fill: MAT.epoxy.fill, opacity: 0.5 });
  // labels: left column (outside), right column (inside), and two under the drawing
  const xl = 196, xr = 556;
  F.label(P((S.yo + S.yi) / 2, zTop - 0.25), [xl, P(0, zTop)[1] + 4], ['the side stands on the', 'rail later (dashed)'], { ...T12, color: MUTED });
  if (zs[0] !== undefined) F.label(P(yRo - 0.15, zs[0]), [xl, P(0, zs[0])[1] + 4], [`holes for the ${f16(boltD)} knee`, 'bolts (the knee goes on', 'the outside later)'], T12);
  F.label(P((yRo + yRi) / 2, R.min[2] + 0.35), [xl, P(0, R.min[2] + 0.35)[1] + 4], ['rail (the outside', 'face of the hull)'], T12);
  F.label(P(yDeck - 0.04, L.deckTop - 0.08), [xr, P(0, zTop)[1] - 12], ['the deck edge stops over the', 'rail: the side goes on beside it'], T12);
  F.label(P(yIn + 0.8, (L.deckBot + L.deckTop) / 2), [xr, P(0, L.deckTop)[1] + 30], ['deck, bonded on top in', 'thickened epoxy (yellow)'], T12);
  if (sh) F.label(P(sh.min[1] + 0.4, (sh.min[2] + sh.max[2]) / 2), [xr, P(0, sh.min[2])[1] + 22], ['seat-back hinge backer,', 'beyond (dashed)'], { ...T12, color: MUTED });
  if (beyond) F.label(P(yIn + 0.3, beyond.min[2] + 0.25), [xr, P(0, beyond.min[2])[1] + 26], ['next crossmember,', 'beyond (dashed)'], { ...T12, color: MUTED });
  const yb = P(0, R.min[2])[1];
  F.label(P((bk.min[1] + bk.max[1]) / 2, bk.min[2] + 0.25), [P(bk.max[1], 0)[0] - 20, yb + 36], 'brake knee backer, glued to the rail', { ...T12, anchor: 'end' });
  F.label(P((pl.min[1] + pl.max[1]) / 2, pl.min[2] + 0.15), [P(pl.min[1], 0)[0] + 20, yb + 64], `stainless plate, ${f16(pl.max[1] - pl.min[1])} thick, bedded flush in its recess`, { ...T12, anchor: 'start' });
  F.legend(['oak', 'deck', 'steel', 'epoxy'], [16, 490]);
  F.text([430, 490], 'dashed: coming later, or beyond the cut', { size: 11.5, color: MUTED });
  F.note('Section');
  return {
    id: 'frame-section',
    title: 'The frame at a brake knee backer',
    caption: `A cut across the left side of the frame at the first column of knee-bolt holes, looking forward. The deck bonds to the rail top and the backer's top edge, and its edge stops over the rail.`,
    svg: F.svg('Section across the frame at a brake knee backer'),
  };
};

// ───────────────────────────── dry fit ─────────────────────────────

/** One station cradle's plate in the hull's (y, z) section, upside down: the floor, the two posts, the slots the sides stand in, the cut-down middle (model z). */
interface CradleGeom { zFloor: number; zPost: number; zMid: number; zEdge: number; poly: Array<[number, number]>; slotOut: number; slotIn: number; half: number }
function cradleGeom(L: Layout, q: ReturnType<typeof cradleStations>[number], h: ReturnType<typeof cradleHeights>): CradleGeom {
  const zFloor = L.chineBot + h.edgeIn; // the sides' bottom edges stand edgeIn above the floor
  const zPost = zFloor - h.postIn, zMid = zFloor - h.middleIn, zSlot = zFloor - q.slotFloorIn;
  const yo = q.widthIn / 2, half = q.plateWidthIn / 2, extra = (q.slotWidthIn - L.side) / 2;
  const slotOut = yo + extra, slotIn = yo - L.side - extra;
  const poly: Array<[number, number]> = [[-half, zFloor], [half, zFloor], [half, zPost], [slotOut, zPost], [slotOut, zSlot], [slotIn, zSlot], [slotIn, zMid], [-slotIn, zMid], [-slotIn, zSlot], [-slotOut, zSlot], [-slotOut, zPost], [-half, zPost]];
  return { zFloor, zPost, zMid, zEdge: L.chineBot, poly, slotOut, slotIn, half };
}

/** End view (section across the hull at the rear cradle): the sides upside down in the cradle's slots, the frame and deck unit lowered in between the posts. */
const dryFitEnd: FigFn = (c) => {
  const cr = cradleStations(c.p);
  const R = bbOf(c, 'rail-L');
  if (!cr.length || !R) return null;
  const L = computeLayout(c.p);
  const ch = cradleHeights(c.p);
  const st = cr[0];
  const g = cradleGeom(L, st, ch);
  const S = sideLayers(c, L, st.x);
  const yRo = S.yo, yRi = yRo - c.p.railThicknessIn;
  const yDeck = S.yi + L.deckEdge;
  const J = c.parts.filter((q) => /^joist-\d+$/.test(q.id)).map((q) => worldAABB(q)).filter((b) => b.min[0] > st.x).sort((a, b) => a.min[0] - b.min[0])[0];
  const ab = { minX: -g.half - 0.2, minY: -g.zFloor - 0.1, maxX: g.half + 0.2, maxY: -(R.min[2] - 3.3) };
  const hA = Math.min(380, (368 / (ab.maxX - ab.minX)) * (ab.maxY - ab.minY));
  const by0 = Math.round(66 + hA + 40);
  const F = new Fig(760, by0 + 400);
  F.heading('Dry fit: the sides upside down in a cradle, the frame and deck unit dropped in');
  F.sub([16, 52], 'A. Section across the hull at cradle 1, looking forward');
  const fa = fit(ab, { x: 196, y: 66, w: 368, h: hA });
  const P = (y: number, z: number): Vec2 => fa.at([y, -z]);
  const RC = (y0: number, z0: number, y1: number, z1: number, s: Style): void => { F.poly([P(y0, z0), P(y1, z0), P(y1, z1), P(y0, z1)], s); };
  F.line(P(-g.half - 0.2, g.zFloor), P(g.half + 0.2, g.zFloor), { stroke: INK, width: 1.4 });
  F.poly(g.poly.map(([y, z]) => P(y, z)), accent('mdf'));
  for (const s of [1, -1] as const) {
    drawSide(F, P, L, S, S.sheer, s, true);
    RC(s * yRo, R.min[2], s * yRi, R.max[2], mat('oak'));
  }
  RC(-yDeck, L.deckBot, yDeck, L.deckTop, mat('deck'));
  if (J) RC(-yRi, J.min[2], yRi, J.max[2], ghost());
  // the hull's outside width, over the rails
  const zW = R.min[2] - 1.0;
  F.dim(P(-yRo, zW), P(yRo, zW), `${f16(st.widthIn)} outside (the hull)`, 0);
  for (const s of [1, -1]) F.line(P(s * yRo, R.min[2] - 0.1), P(s * yRo, zW - 0.2), { stroke: DIM, width: 0.8, dash: '2 2' });
  const aTop = P(0, R.min[2] - 3.1)[1], aBot = P(0, R.min[2] - 1.9)[1];
  F.arrow([P(-9, 0)[0], aTop], [P(-9, 0)[0], aBot], ACCENT, 2.6);
  F.arrow([P(9, 0)[0], aTop], [P(9, 0)[0], aBot], ACCENT, 2.6);
  F.text([P(0, 0)[0], aTop + 14], 'lowered in dry, between the posts', { size: 12, anchor: 'middle', color: ACCENT });
  // heights from the floor (left: post top and slot floor; right: the sides' edges and the cut-down middle)
  const yF = P(0, g.zFloor)[1];
  F.dim([P(-g.half, 0)[0] - 14, yF], [P(-g.half, 0)[0] - 14, P(0, g.zPost)[1]], f16(ch.postIn), 0, { flat: true, anchor: 'end' });
  F.dim([P(-g.slotOut, 0)[0] + 4, yF], [P(-g.slotOut, 0)[0] + 4, P(0, S.sheer)[1]], f16(st.slotFloorIn), 0, { flat: true });
  F.dim([P(g.half, 0)[0] + 14, yF], [P(g.half, 0)[0] + 14, P(0, L.chineBot)[1]], f16(ch.edgeIn), 0, { flat: true });
  F.dim([P(0, 0)[0], yF], [P(0, 0)[0], P(0, g.zMid)[1]], f16(ch.middleIn), 0, { flat: true });
  const xl = 150, xr = 616;
  F.label(P(-(g.half + g.slotOut) / 2, L.chineBot + 1.2), [xl, P(0, L.chineBot + 1.2)[1] + 4], ['post (one outside', 'each slot)'], T12);
  F.label(P(-(yRo + yRi) / 2, R.min[2] + 0.6), [xl, P(0, R.min[2])[1] - 6], ['rail, on the side\'s', 'edge (on top now)'], T12);
  F.label(P(-(S.yWo + S.yWi) / 2, (S.chineTop + S.gunBot) / 2), [xl, P(0, (S.chineTop + S.gunBot) / 2)[1]], ['side, upside down', 'in its slot: its top', 'edge (the sheer)', 'sits on the slot floor'], T12);
  F.label(P(-g.slotIn - 2.5, g.zMid + 0.4), [xl, P(0, g.zFloor)[1] - 40], ['cradle: a 3/4" MDF plate,', 'cut down between', 'the slots'], T12);
  if (J) F.label(P(yRi - 2, (J.min[2] + J.max[2]) / 2), [xr, P(0, J.min[2])[1] - 4], ['crossmember,', 'beyond'], { ...T12, color: MUTED });
  F.label(P(yDeck - 2.5, (L.deckBot + L.deckTop) / 2), [xr, P(0, L.deckTop)[1] + 30], ['deck (under the', 'rails now)'], T12);
  F.text([P(g.half, 0)[0] + 20, P(0, L.chineBot)[1] + 64], ['the sides\'', 'bottom edges'], { size: 11.5, color: DIM });
  F.text([P(0, 0)[0] + 6, P(0, g.zMid)[1] - 8], 'middle cut down', { size: 11.5, color: DIM });

  // B. The corner, much larger
  F.rect(150, by0, 460, 360, { stroke: MUTED, width: 0.8 });
  F.sub([160, by0 + 22], 'B. One corner, larger (upside down)');
  const fb = fit({ minX: yRo - 1.1, minY: -(S.chineTop + 0.45), maxX: yRo + 0.3, maxY: -(R.max[2] - 0.9) }, { x: 300, y: by0 + 40, w: 160, h: 300 }, 1, 'center');
  const Q = (y: number, z: number): Vec2 => fb.at([y, -z]);
  const RB = (y0: number, z0: number, y1: number, z1: number, s: Style): void => { F.poly([Q(y0, z0), Q(y1, z0), Q(y1, z1), Q(y0, z1)], s); };
  const zb0 = R.max[2] - 0.9, zb1 = S.chineTop + 0.45;
  RB(yRo, zb0, yRi, R.max[2], mat('oak'));
  drawSide(F, Q, L, S, zb1);
  RB(yRo - 1.1, L.deckBot, yDeck, L.deckTop, mat('deck', { stroke: ACCENT, width: 1.6 }));
  breakH(F, Q(0, zb0)[1], Q(yRi, 0)[0], Q(yRo, 0)[0]);
  breakH(F, Q(0, zb1)[1], Q(S.yi, 0)[0], Q(yRo, 0)[0]);
  breakV(F, Q(yRo - 1.1, 0)[0], Q(0, L.deckBot)[1], Q(0, L.deckTop)[1]);
  const bl = 286, br = 476;
  F.label(Q((yRo + yRi) / 2, zb0 + 0.3), [br, Q(0, zb0)[1] + 16], 'rail', T12);
  F.label(Q((S.yo + S.yWi) / 2, L.chineBot + 0.06), [br, Q(0, L.chineBot)[1] + 4], ['the rail sits on the edge of', 'the outer band and the web'], T12);
  F.label(Q((S.yo + S.yWo) / 2, S.chineTop - 0.3), [br, Q(0, S.chineTop - 0.3)[1] + 4], 'outer chine band', T12);
  F.label(Q((S.yWo + S.yWi) / 2, S.chineTop + 0.25), [br, Q(0, S.chineTop + 0.25)[1] + 4], 'web', T12);
  F.label(Q(yDeck - 0.35, (L.deckBot + L.deckTop) / 2), [bl, Q(0, L.deckTop)[1] - 10], ['deck edge, beside the web,', 'under the inner band (the', 'band lies below it now,', 'upside down)'], T12);
  F.label(Q((S.yWi + S.yi) / 2, (S.innerChineBot + S.chineTop) / 2), [bl, Q(0, S.chineTop)[1] - 4], 'inner chine band', T12);
  const zg = (L.deckBot + L.deckTop) / 2;
  F.line(Q(yDeck, zg), Q(S.yWi, zg), { stroke: DIM, width: 1.4 });
  F.label(Q((yDeck + S.yWi) / 2, zg), [br, Q(0, zg)[1] + 40], `${f16(c.p.deckSideClearIn)} gap to the web, each side`, { ...T12, color: DIM });
  F.legend(['oak', 'web', 'deck', 'mdf'], [16, F.h - 10]);
  F.note('Section, upside down');
  return {
    id: 'dry-fit-end',
    title: 'Dry fit: the inverted sides on a cradle',
    caption: `Dry fit: a section across the inverted hull at a station cradle, with one corner enlarged in view B. Each rail lands on the outer band and the web, and the deck edge goes in beside the web.`,
    svg: F.svg('Dry fit: section across the inverted hull at a station cradle, and one corner larger'),
  };
};

/** Side view: the four cradles under the inverted side at their stations, the side height at each, the level of the sides' bottom edges. */
const dryFitCradles: FigFn = (c) => {
  const cr = cradleStations(c.p);
  const web = c.by('side-L-web'), rail = c.by('rail-L');
  const wp = profileOf(web), rp = profileOf(rail);
  if (!cr.length || !web || !wp || !rp) return null;
  const L = computeLayout(c.p);
  const ch = cradleHeights(c.p);
  const W = worldAABB(web);
  const web0 = W.min[0];
  const zFloor = L.chineBot + ch.edgeIn;
  const zPost = zFloor - ch.postIn;
  const F = new Fig(760, 460);
  F.heading('The four cradles, seen from the side (hull upside down)');
  const fr = fit({ minX: W.min[0] - 4, minY: -zFloor - 0.3, maxX: W.max[0] + 1, maxY: -(L.railTop - c.p.railDepthIn) + 0.6 }, { x: 40, y: 74, w: 680, h: 250 });
  const P = (x: number, z: number): Vec2 => fr.at([x, -z]);
  F.line(P(W.min[0] - 4, zFloor), P(W.max[0] + 1, zFloor), { stroke: INK, width: 1.4 });
  const plateW = Math.max(0.75, 7 / fr.kx);
  // each cradle's near post (in front of the side), from the floor to the post top
  F.poly(wp.map(([x, z]) => P(x, z)), mat('web'));
  const cb = profileOf(c.by('side-L-chine')), gb = profileOf(c.by('side-L-gunwale'));
  if (cb) F.poly(cb.map(([x, z]) => P(x, z)), mat('oak'));
  if (gb) F.poly(gb.map(([x, z]) => P(x, z)), mat('oak'));
  F.poly(rp.map(([x, z]) => P(x, z)), mat('oak'));
  for (const q of cr) F.poly([P(q.x - plateW / 2, zPost), P(q.x + plateW / 2, zPost), P(q.x + plateW / 2, zFloor), P(q.x - plateW / 2, zFloor)], accent('mdf', { opacity: 0.85 }));
  // the level of the sides' bottom edges
  F.line(P(W.min[0] - 3.5, L.chineBot), P(W.min[0] - 0.3, L.chineBot), { stroke: DIM, width: 1, dash: '6 3' });
  F.line(P(W.max[0] + 0.3, L.chineBot), P(W.max[0] + 0.9, L.chineBot), { stroke: DIM, width: 1, dash: '6 3' });
  F.dim(P(W.min[0] - 2.5, zFloor), P(W.min[0] - 2.5, L.chineBot), f16(ch.edgeIn), 0, { flat: true, anchor: 'end' });
  for (const [i, q] of cr.entries()) {
    const x = P(q.x, 0)[0], zN = L.chineBot + q.heightIn;
    F.dim(P(q.x + plateW / 2 + 0.6, L.chineBot), P(q.x + plateW / 2 + 0.6, zN), '', 0);
    F.text([x, P(0, zFloor)[1] + 18], `Cradle ${i + 1}`, { size: 12, anchor: 'middle', weight: 'bold' });
    F.text([x, P(0, zFloor)[1] + 34], `${f8(q.x - web0)} from the rear end`, { size: 11.5, anchor: 'middle' });
    F.text([x, P(0, zFloor)[1] + 50], `side height here: ${f16(q.heightIn)}`, { size: 11.5, anchor: 'middle', color: DIM });
    F.text([x, P(0, zFloor)[1] + 66], `(sets the slot floor: ${f16(q.slotFloorIn)})`, { size: 11.5, anchor: 'middle', color: DIM });
  }
  const xm = (W.min[0] + W.max[0]) * 0.36;
  F.label(P(xm, L.railTop - c.p.railDepthIn / 2), [P(xm, 0)[0] - 10, 64], 'rail of the frame and deck unit, on the side\'s bottom edge (on top now)', { ...T12, anchor: 'start' });
  const xs2 = (cr[1].x + cr[2].x) / 2;
  F.label(P(xs2, sideTopAt(L, xs2) - 0.3), [P(cr[1].x, 0)[0] + 16, P(0, sideTopAt(L, xs2))[1] - 46], ['the sheer (the side\'s top', 'edge) hangs into the slots'], { ...T12, anchor: 'start' });
  F.text([16, F.h - 30], 'Blue dashed line: the sides\' bottom edges, all level.', { size: 11.5, color: DIM });
  const xc = cr[0].x + (cr[1].x - cr[0].x) * 0.35;
  F.label(P(xc, L.chineBot + L.railBand * 0.5), [P(xc, 0)[0] + 6, P(0, L.chineBot + L.railBand)[1] + 34], ['outer chine band', '(the side\'s bottom', 'edge, on top now)'], { ...T12, anchor: 'start' });
  F.text([P(W.min[0], 0)[0], P(0, L.chineBot)[1] - 46], 'rear end', { size: 11.5, color: MUTED });
  F.text([P(W.max[0], 0)[0], P(0, L.chineBot)[1] - 46], 'bow end', { size: 11.5, color: MUTED, anchor: 'end' });
  F.legend(['oak', 'web', 'mdf'], [16, 450]);
  F.text([340, 450], 'MDF: the cradle post in front of the side', { size: 11.5, color: MUTED });
  F.note('Side view, to scale');
  return {
    id: 'dry-fit-cradles',
    title: 'The cradles under the inverted side',
    caption: `The side is upside down, so its curved top edge (the sheer) hangs down into the cradle slots and its straight bottom edge is on top. The slots get shallower toward the bow, so both bottom edges come out level.`,
    svg: F.svg('The four station cradles under the inverted side, seen from the side'),
  };
};

/** Drilling the screw pilots through the rail's clearance holes into the side's edge (a counterbored hole and the forward one, in section), and where the holes are (plan). */
const dryFitPilots: FigFn = (c) => {
  const rail = c.by('rail-L'), R = rail ? worldAABB(rail) : undefined;
  const tie = chineTie(c.parts);
  if (!rail || !R || !tie.perRail) return null;
  const L = computeLayout(c.p);
  const cr = cradleStations(c.p);
  const ch = cradleHeights(c.p);
  const screws = jointPts(rail, (j) => j.type === 'screw' && /chine/.test(j.to)).sort((a, b) => a[0] - b[0]);
  const cb = railCounterbore(rail);
  const cbOk = Number.isFinite(cb.depth) && Number.isFinite(cb.dia);
  const pilotFeats = c.drawings().find((s) => s.partIds.includes('side-L-chine'))?.features.filter((q) => q.kind === 'hole' && (q.to ?? []).some((t) => /^rail-/.test(t))) ?? [];
  const depthOf = (q: { size?: string } | undefined): string | undefined => /,\s*([\d\-/]+")\s*deep/.exec(q?.size ?? '')?.[1];
  const deepAft = depthOf(pilotFeats.find((q) => q.count > 1)) ?? depthOf(pilotFeats[0]);
  const deepFwd = depthOf(pilotFeats.find((q) => q.count === 1));
  const clrTxt = /^([\d/]+")\s*clearance/.exec(c.drawings().find((s) => s.partIds.includes('rail-L'))?.features.find((q) => q.kind === 'hole' && (q.to ?? []).some((t) => /chine/.test(t)))?.size ?? '')?.[1];
  const clr = clrTxt ? parseInchText(clrTxt) : 11 / 64;
  const stations = railHoleStations(c);
  const railDepthAt = (x: number): number => (x > L.railStepX ? L.railDepthF : c.p.railDepthIn);
  const F = new Fig(760, 760);
  F.heading('Drilling the screw pilots through the rail holes (hull upside down)');

  /** One hole in section, the 1/8" x 6" bit in it at full depth and its tape flag on the rail's face. */
  const section = (q: Vec3, pilotTxt: string | undefined, box: { x: number; w: number }, title: string, lx: number, rx: number, aft: boolean): void => {
    const pd = pilotTxt ? parseInchText(pilotTxt) : 0.625;
    const S = sideLayers(c, L, q[0]);
    const ys = q[1], yRo = S.yo, yRi = yRo - c.p.railThicknessIn;
    const rd = railDepthAt(q[0]), zRb = L.railTop - rd;
    const zCut = L.deckTop + 0.9, bitTop = L.railTop - c.p.railDepthIn - 1.4;
    F.sub([box.x - 90, 52], title);
    const fa = fit({ minX: yRi - 0.9, minY: -(zCut + 0.05), maxX: yRo + 0.3, maxY: -(bitTop - 0.4) }, { x: box.x, y: 70, w: box.w, h: 330 }, 1, 'center');
    const P = (y: number, z: number): Vec2 => fa.at([y, -z]);
    const RC = (y0: number, z0: number, y1: number, z1: number, s: Style): void => { F.poly([P(y0, z0), P(y1, z0), P(y1, z1), P(y0, z1)], s); };
    drawSide(F, P, L, S, zCut);
    RC(yRi - 0.9, L.deckBot, S.yi + L.deckEdge, L.deckTop, mat('deck'));
    breakH(F, P(0, zCut)[1], P(S.yi, 0)[0], P(S.yo, 0)[0]);
    breakV(F, P(yRi - 0.9, 0)[0], P(0, L.deckBot)[1], P(0, L.deckTop)[1]);
    RC(yRo, zRb, yRi, L.railTop, mat('oak'));
    if (aft && cbOk) RC(ys - cb.dia / 2, zRb, ys + cb.dia / 2, zRb + cb.depth, { fill: '#fff', stroke: INK, width: 1 });
    if (!aft) F.poly([P(ys - 0.17, zRb), P(ys + 0.17, zRb), P(ys + clr / 2, zRb + 0.15), P(ys - clr / 2, zRb + 0.15)], { fill: '#fff', stroke: INK, width: 1 });
    RC(ys - clr / 2, zRb + (aft && cbOk ? cb.depth : 0.15), ys + clr / 2, L.railTop, { fill: '#fff', stroke: INK, width: 0.8 });
    RC(ys - 1 / 16, L.chineBot, ys + 1 / 16, L.chineBot + pd, { fill: '#fff', stroke: ACCENT, width: 1, dash: '2 2' });
    F.poly([P(ys - 1 / 16, bitTop), P(ys + 1 / 16, bitTop), P(ys + 1 / 16, L.chineBot + pd - 0.06), P(ys, L.chineBot + pd), P(ys - 1 / 16, L.chineBot + pd - 0.06)], mat('steel', { stroke: MAT.steel.stroke, width: 1 }));
    F.rect(P(ys - 0.3, 0)[0], P(0, bitTop)[1] - 16, P(ys + 0.3, 0)[0] - P(ys - 0.3, 0)[0], 16, mat('steel'), 2);
    // the flag, wider than the counterbore, resting on the rail's face
    const fw = aft && cbOk ? cb.dia / 2 + 0.15 : 0.35;
    F.rect(P(ys - fw, 0)[0], P(0, zRb)[1] - 7, P(ys + fw, 0)[0] - P(ys - fw, 0)[0], 6, { fill: '#2f9e44', stroke: '#1b6e2e', width: 1 });
    F.dim(P(ys - fw - 0.12, zRb), P(ys - fw - 0.12, L.chineBot + pd), f16(rd + pd), 0, { flat: true, anchor: 'end' });
    F.arrow([P(ys, 0)[0] + 22, P(0, bitTop)[1] - 4], [P(ys, 0)[0] + 22, P(0, bitTop)[1] + 40], ACCENT, 2.4);
    F.label(P(ys + fw, zRb - 0.08), [rx, P(0, zRb)[1] - 30], ['tape flag: it stops', 'on the rail\'s face'], T12);
    F.label(P(yRo - 0.05, (zRb + L.railTop) / 2), [rx, P(0, (zRb + L.railTop) / 2)[1] + 4], aft ? [`rail, ${f16(rd)} deep;`, cbOk ? `${f16(cb.dia)} counterbore` : 'counterbored'] : [`rail, only ${f16(rd)}`, 'deep: countersunk'], T12);
    F.label(P(ys + 1 / 16, L.chineBot + pd * 0.6), [rx, P(0, L.chineBot + pd)[1] - 6], [`pilot ${pilotTxt ?? f16(pd)} deep,`, 'on the glue line of', 'outer band and web'], T12);
    F.text([P(ys - fw - 0.12, 0)[0] - 6, P(0, (zRb + L.chineBot + pd) / 2)[1] - 30], ['flag to', 'the tip:'], { size: 11.5, anchor: 'end', color: DIM });
    F.label(P(yRi - 0.5, (L.deckBot + L.deckTop) / 2), [lx, P(0, L.deckTop)[1] + 34], 'deck', T12);
    F.label(P(S.yi + 0.09, zCut - 0.15), [lx, P(0, zCut)[1] + 12], 'side', T12);
  };
  const aftQ = screws[0], fwdQ = screws.find((q) => q[0] > L.railStepX);
  if (aftQ) section(aftQ, deepAft, { x: 110, w: 130 }, `A. One of the ${screws.filter((q) => q[0] <= L.railStepX).length} counterbored holes`, 100, 256, true);
  if (fwdQ) section(fwdQ, deepFwd, { x: 490, w: 130 }, 'B. The forward hole', 480, 636, false);
  F.text([16, 436], `The bit: 1/8" × 6" (an aircraft bit). Each pilot sits under its clearance hole (${clrTxt ?? frac(clr, 64)}) in the rail; the tape flag sets its depth.`, { size: 12 });

  // C. Plan: where the holes are, and the cradle posts that hold the sides
  F.sub([16, 470], `C. From above: ${tie.perRail} holes in each rail; the cradle posts hold the sides`);
  const W = bbOf(c, 'side-L-web');
  const xa = W ? W.min[0] : R.min[0], xb = W ? W.max[0] : R.max[0];
  const yMax = (cr[0]?.plateWidthIn ?? 2 * (L.hwC + L.side)) / 2 + 0.2;
  const fb = fit({ minX: xa - 1, minY: -yMax, maxX: xb + 1, maxY: yMax }, { x: 60, y: 540, w: 640, h: 170 }, 1, 'center');
  const xs = samples(xa, xb, 80), rx = samples(R.min[0], R.max[0], 80);
  // the cradle plates (seen from above: a thin strip each, the posts at the ends)
  for (const q of cr) {
    const half = q.plateWidthIn / 2, yo = q.widthIn / 2;
    rectIn(F, fb, [q.x - 0.375, -half], [q.x + 0.375, half], mat('mdf', { opacity: 0.6 }));
    for (const s of [1, -1]) rectIn(F, fb, [q.x - 0.375, s * yo], [q.x + 0.375, s * half], accent('mdf', { width: 1.2 }));
  }
  // the hull is turned over about its length, so the left side is at the bottom of this view
  for (const s of [1, -1] as const) {
    const Y = (y: number): number => -s * y;
    F.poly([...xs.map((x): Vec2 => [x, Y(L.hwC + L.side - L.turnIn(x))]), ...[...xs].reverse().map((x): Vec2 => [x, Y(L.hwC - L.turnIn(x))])].map(fb.at), mat('web'));
    F.poly([...rx.map((x): Vec2 => [x, Y(L.hwC + L.side - L.turnIn(x))]), ...[...rx].reverse().map((x): Vec2 => [x, Y(L.hwC + L.side - c.p.railThicknessIn - L.turnIn(x))])].map(fb.at), mat('oak'));
    for (const q of screws) F.circle(fb.at([q[0], Y(q[1])]), 2.6, { fill: '#fff', stroke: ACCENT, width: 1.4 });
  }
  const yTop = fb.at([0, yMax])[1] - 6;
  if (stations.length === screws.length) screws.forEach((q, i) => F.text([fb.at([q[0], 0])[0], yTop - (i % 2 ? 0 : 16)], stations[i], { size: 11.5, anchor: 'middle', color: ACCENT }));
  F.text([16, yTop - 34], 'hole centers from the finished rear end of the rail, measured along it:', { size: 11.5, color: ACCENT });
  const yBot = fb.at([0, -yMax])[1];
  const p0 = fb.at([cr[0].x, -(cr[0].plateWidthIn / 2 - 0.4)]);
  F.label(p0, [p0[0] + 8, yBot + 22], `cradle posts, ${f16(ch.postIn)} tall, outside each side: leave the cradles where they are until the glue-up`, { ...T12, anchor: 'start' });
  F.text([fb.at([xa, 0])[0] - 6, fb.at([0, 0])[1] + 4], 'rear', { size: 11.5, anchor: 'end', color: MUTED });
  F.text([fb.at([xb, 0])[0] + 6, fb.at([0, 0])[1] + 4], 'bow', { size: 11.5, color: MUTED });
  F.legend(['oak', 'web', 'deck', 'steel', 'mdf'], [16, 752]);
  F.note('Each view to its own scale');
  return {
    id: 'dry-fit-pilots',
    title: 'Drilling the screw pilots',
    caption: `A section through one rail hole with the unit sitting dry in the sides: the bit goes down through the hole onto the glue line between the outer band and the web. View C shows the holes along each rail.`,
    svg: F.svg('Drilling the screw pilots through the rail holes into the side edge, in section and from above'),
  };
};

// ───────────────────────────── lower ─────────────────────────────

/** The rail-to-side joint at a screw, close up, in the order it goes together. */
const lowerJoint: FigFn = (c) => {
  const rail = c.by('rail-L'), R = rail ? worldAABB(rail) : undefined;
  if (!rail || !R) return null;
  const L = computeLayout(c.p);
  const screws = jointPts(rail, (j) => j.type === 'screw' && /chine/.test(j.to)).sort((a, b) => a[0] - b[0]);
  const cb = railCounterbore(rail);
  const cbOk = Number.isFinite(cb.depth) && Number.isFinite(cb.dia);
  const lenIn = rail.joints?.find((j) => j.type === 'screw' && /chine/.test(j.to) && j.fit)?.fit?.lenIn;
  const tie = chineTie(c.parts);
  const x0 = screws[0]?.[0] ?? 0;
  const S = sideLayers(c, L, x0);
  const ys = screws[0]?.[1] ?? (S.yo - L.sideBand);
  const yRo = S.yo, yRi = yRo - c.p.railThicknessIn;
  const yDeck = S.yi + L.deckEdge;
  const bed = S.yo - S.yWi;
  const F = new Fig(760, 540);
  F.heading('Gluing the unit into the sides: one screw, close up (upside down)');
  const zCut = S.chineTop + 0.4;
  const caulW = 0.5;
  const fr = fit({ minX: yRi - 1.4, minY: -(zCut + 0.1), maxX: yRo + caulW + 0.5, maxY: -(R.min[2] - 1.2) }, { x: 60, y: 60, w: 330, h: 430 });
  const P = (y: number, z: number): Vec2 => fr.at([y, -z]);
  const RC = (y0: number, z0: number, y1: number, z1: number, s: Style): void => { F.poly([P(y0, z0), P(y1, z0), P(y1, z1), P(y0, z1)], s); };
  drawSide(F, P, L, S, zCut);
  breakH(F, P(0, zCut)[1], P(S.yi, 0)[0], P(S.yo, 0)[0]);
  // (6) the deck slot, filled last
  F.poly([P(yDeck, L.deckBot), P(S.yWi, L.deckBot), P(S.yWi, S.innerChineBot), P(S.yi, S.innerChineBot), P(S.yi, L.deckTop), P(yDeck, L.deckTop)], accent('epoxy', { width: 1.2 }));
  RC(yRi - 1.4, L.deckBot, yDeck, L.deckTop, mat('deck'));
  breakV(F, P(yRi - 1.4, 0)[0], P(0, L.deckBot)[1], P(0, L.deckTop)[1]);
  RC(yRo, R.min[2], yRi, R.max[2], mat('oak'));
  // (1) the bed of thickened epoxy on the bearing edge
  F.rect(P(S.yWi, 0)[0], P(0, L.chineBot)[1] - 3, P(S.yo, 0)[0] - P(S.yWi, 0)[0], 6, { fill: MAT.epoxy.fill, stroke: ACCENT, width: 1 });
  const clr = 11 / 64;
  RC(ys - clr / 2, R.min[2], ys + clr / 2, R.max[2], { fill: '#fff', stroke: INK, width: 0.8 });
  if (cbOk) RC(ys - cb.dia / 2, R.min[2], ys + cb.dia / 2, R.min[2] + cb.depth, { fill: '#fff', stroke: INK, width: 1 });
  const zHead = R.min[2] + (cbOk ? cb.depth : 0);
  if (lenIn) F.screw(P(ys, zHead), P(ys, zHead + lenIn), true);
  if (cbOk) { RC(ys - cb.dia / 2, R.min[2], ys + cb.dia / 2, zHead - 0.12, accent('oak', { fill: '#f3dfb1' })); }
  // (5) the caul and the clamp
  const zc0 = R.max[2] - 1.0, zc1 = S.chineTop - 0.2;
  RC(yRo, zc0, yRo + caulW, zc1, mat('oak', { stroke: '#6b4a1f' }));
  barClamp(F, P(yRi, 0)[0], P(yRo + caulW, 0)[0], P(0, R.min[2] - 0.75)[1], P(0, zc0 + 0.1)[1], P(0, R.max[2] - 0.12)[1]);
  // (2) the lowering arrow
  const xA = P(yRi - 0.85, 0)[0];
  F.arrow([xA, P(0, R.min[2] - 1.1)[1]], [xA, P(0, R.min[2] + 0.4)[1]], ACCENT, 2.6);
  // badges on the drawing
  const bx = (y: number): number => P(y, 0)[0];
  const b1: Vec2 = [bx(yRo + caulW) + 44, P(0, L.chineBot)[1] - 26];
  F.line([b1[0] - 10, b1[1] + 5], [bx((S.yo + S.yWi) / 2), P(0, L.chineBot)[1]], { stroke: MUTED, width: 1 });
  F.badge(b1, 1);
  F.badge([xA - 20, P(0, R.min[2] - 0.6)[1]], 2);
  if (lenIn) { const b3: Vec2 = [bx(ys) - 26, P(0, zHead + lenIn * 0.3)[1]]; F.line([b3[0] + 10, b3[1]], [bx(ys) - 2, b3[1]], { stroke: MUTED, width: 1 }); F.badge(b3, 3); }
  if (cbOk) F.badge([bx(ys) - 24, P(0, R.min[2] + 0.45)[1]], 4);
  F.badge([bx(yRo + caulW) + 34, P(0, R.min[2] - 0.75)[1]], 5);
  const b6: Vec2 = [bx(S.yi) - 26, P(0, S.chineTop)[1]];
  F.line([b6[0] + 8, b6[1] - 8], [bx((S.yi + S.yWi) / 2), P(0, (L.deckTop + S.innerChineBot) / 2)[1]], { stroke: MUTED, width: 1 });
  F.badge(b6, 6);
  // the numbered sequence, at the right
  const tx = 440;
  const rows: Array<[number, string[]]> = [
    [1, ['A bed of thickened epoxy (peanut butter)', `along the ${f16(bed)} bearing edge of both`, 'sides (the outer band and the web), and', 'the same on both deck edges.']],
    [2, ['Lower the unit straight down between the', 'cradle posts, each rail hole over its pilot.']],
    [3, [`${tie.screw} screws straight down through`, `the rail into the pilots, ${tie.perRail} a side.`, 'Middle first, out to the ends; snug only.']],
    [4, [cbOk ? `A glued oak plug in each ${f16(cb.dia)}` : 'A glued oak plug in each', 'counterbore, trimmed flush with the rail.']],
    [5, ['Bar clamps between the screws: one jaw on', 'the rail\'s inside face, one on a straight', 'caul across the rail and the outer band.']],
    [6, ['Last, from a second small batch: top up', 'the slot between the deck edge and the', 'web from both open hull ends.']],
  ];
  let ty = 84;
  for (const [n, t] of rows) {
    F.badge([tx, ty - 4], n);
    F.text([tx + 18, ty], t, { size: 12 });
    ty += 15 * t.length + 24;
  }
  F.label(P(yRi + 0.12, R.min[2] + 1.5), [bx(yRi) - 44, P(0, R.min[2] + 1.5)[1] + 4], 'rail', { ...T12, anchor: 'end' });
  F.label(P(S.yo - 0.05, S.chineTop + 0.2), [bx(yRo + caulW) + 20, P(0, zCut)[1] - 4], 'side', { ...T12, anchor: 'start' });
  F.label(P(yRo + caulW / 2, zc1 - 0.25), [bx(yRo + caulW) + 20, P(0, zc1)[1] - 22], 'caul', { ...T12, anchor: 'start' });
  F.label(P(yRi - 1.0, (L.deckBot + L.deckTop) / 2), [P(yRi - 1.4, 0)[0] + 4, P(0, L.deckTop)[1] + 46], 'deck', { ...T12, anchor: 'start' });
  F.legend(['oak', 'web', 'deck', 'epoxy', 'steel', 'clamp'], [16, 506]);
  F.note('Section, upside down');
  return {
    id: 'lower-joint',
    title: 'The rail-to-side joint, in order',
    caption: `A cut across the left rail and side at one screw, upside down as it is glued. The unit goes straight down between the cradle posts onto thickened epoxy on the side edges, and the screws pull each side onto its rail.`,
    svg: F.svg('The rail-to-side joint at one screw, with the order of the glue-up'),
  };
};

// ───────────────────────────── transom and bulkhead ─────────────────────────────

/** How an end closes: the closing part's inner face (upside down, as fitted) with what goes into it, and a cut through one corner as it is pushed on. */
function endClose(which: 'transom' | 'bulkhead'): FigFn {
  return (c) => {
    const rear = which === 'transom';
    const part = c.by(rear ? 'transom-rear' : 'bow-bulkhead');
    if (!part || part.geometry.type !== 'extrusion') return null;
    const L = computeLayout(c.p);
    const T = worldAABB(part);
    const g = part.geometry;
    const xFace = rear ? T.max[0] : T.min[0]; // the inner face, toward the hull
    const S = sideLayers(c, L, xFace + (rear ? 0.05 : -0.05));
    const webJ = part.joints?.find((j) => j.type === 'dado' && /web$/.test(j.to));
    const deckJ = part.joints?.find((j) => j.type === 'dado' && j.to === 'deck');
    const railJ = part.joints?.find((j) => (j.type === 'mortise-tenon' || j.type === 'domino') && /^rail-/.test(j.to));
    const web = bbOf(c, 'side-L-web');
    if (!webJ || !deckJ || !web) return null;
    const into = rear ? xFace - web.min[0] : web.max[0] - xFace; // how far the web and the deck reach into their dados
    const dadoW = Number(/^([\d.]+)"/.exec(webJ.size ?? '')?.[1] ?? NaN) || (S.yWo - S.yWi + 0.04);
    const deckDadoH = Number(/^([\d.]+)"/.exec(deckJ.size ?? '')?.[1] ?? NaN) || (L.ply + c.p.deckSlopIn);
    const webU = Math.abs(webJ.at?.[0]?.[0] ?? (S.yWo + S.yWi) / 2);
    const vMin = Math.min(...g.outline.map((q) => q[1])), vMax = Math.max(...g.outline.map((q) => q[1]));
    const uMax = Math.max(...g.outline.map((q) => q[0]));
    const hold = (g.holes ?? []).find((h) => Math.max(...h.map((q) => q[0])) - Math.min(...h.map((q) => q[0])) > 1);
    const vents = rear ? transomVents(c.parts) : { dia: 0, places: [] };
    const railPts = (railJ?.at ?? []).map((a) => [Math.abs(a[0]), a[1]] as Vec2).slice(0, 1);
    const tenon = railJ?.type === 'mortise-tenon' ? /^([\d/]+) × ([\d/]+)/.exec(railJ.size ?? '') : null;
    // A Domino mortise on the face: the cutter's width across, about 3/4 of an inch tall (drawing only).
    const tw = tenon ? parseInchText(tenon[1]) : 0.24, th = tenon ? parseInchText(tenon[2]) : 0.8;
    const backers = rear ? c.parts.filter((q) => /^transom-backer-[LR]$/.test(q.id)).map((q) => worldAABB(q)) : [];
    const name = rear ? 'transom' : 'bulkhead';
    const yRo = S.yo, yRi = yRo - c.p.railThicknessIn;
    const rz0 = rear ? L.railTop - c.p.railDepthIn : L.railTop - L.railDepthF;
    const ab = { minX: -uMax - 0.2, minY: -vMax - 0.2, maxX: uMax + 0.2, maxY: -Math.min(vMin, rz0) + 0.2 };
    const ka = Math.min(340 / (ab.maxX - ab.minX), 250 / (ab.maxY - ab.minY));
    const fa = fit(ab, { x: 210, y: 92, w: 340, h: ka * (ab.maxY - ab.minY) }, 1, 'center');
    const by0 = Math.round(92 + ka * (ab.maxY - ab.minY) + (hold && !backers.length ? 56 : 40));
    const F = new Fig(760, by0 + 330 + 40);
    F.heading(rear ? 'Closing the rear: what the transom is pushed onto (hull upside down)' : 'Closing the bow: what the bulkhead is pushed onto (hull upside down)');
    F.sub([16, 52], `A. The ${name}'s inside face, upside down as it goes on`);
    const A = (u: number, v: number): Vec2 => fa.at([u, -v]);
    const RA = (u0: number, v0: number, u1: number, v1: number, s: Style): void => { F.poly([A(u0, v0), A(u1, v0), A(u1, v1), A(u0, v1)], s); };
    F.poly(g.outline.map(([u, v]) => A(u, v)), mat('oak', { stroke: ACCENT, width: 2 }));
    if (hold) F.poly(hold.map(([u, v]) => A(u, v)), { fill: '#fff', stroke: MAT.oak.stroke, width: 1.2 });
    for (const b of backers) RA(b.min[1], b.min[2], b.max[1], b.max[2], mat('oak', { fill: '#dcc08a' }));
    // the top edge of the face at u (the web dados run out through it)
    const topAt = (u: number): number => {
      let best = vMax;
      for (let i = 0; i + 1 < g.outline.length; i++) {
        const a = g.outline[i], b = g.outline[i + 1];
        if ((a[0] - u) * (b[0] - u) <= 0 && a[0] !== b[0] && Math.min(a[1], b[1]) > (vMin + vMax) / 2) best = a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
      }
      return best;
    };
    const dadoFill: Style = { fill: '#c9a76a', stroke: MAT.oak.stroke, width: 1 };
    RA(-webU, L.deckBot, webU, L.deckBot + deckDadoH, dadoFill);
    for (const s of [1, -1]) RA(s * (webU - dadoW / 2), L.deckBot, s * (webU + dadoW / 2), topAt(s * webU), dadoFill);
    const bandS: Style = { fill: '#6b4a1f', opacity: 0.7 };
    for (const s of [1, -1]) {
      RA(s * S.yo, L.chineBot, s * S.yWo, S.chineTop, bandS);
      RA(s * S.yWi, S.innerChineBot, s * S.yi, S.chineTop, bandS);
      RA(s * S.yo, S.gunBot, s * S.yWo, S.sheer, bandS);
      RA(s * S.yWi, S.gunBot, s * S.yi, S.sheer, bandS);
    }
    const railPtsBoth = (part.joints ?? []).filter((j) => (j.type === 'mortise-tenon' || j.type === 'domino') && /^rail-/.test(j.to)).flatMap((j) => (j.at ?? []).map((a) => [a[0], a[1]] as Vec2));
    for (const [u, v] of railPtsBoth) RA(u - tw / 2, v - th / 2, u + tw / 2, v + th / 2, { fill: '#fff', stroke: INK, width: 1 });
    for (const s of [1, -1]) RA(s * yRo, rz0, s * yRi, L.railTop, { stroke: '#6b6b6b', width: 1.2, dash: '4 3' });
    for (const q of vents.places) for (const s of [1, -1]) F.circle(A(s * q.off, vMin + q.up), Math.max(2.6, (vents.dia / 2) * fa.kx), { fill: '#fff', stroke: ACCENT, width: 1.4 });
    // labels for A: left column (one side's details), right column (the other side's)
    const xl = 196, xr = 564;
    const yA = (v: number): number => A(0, v)[1];
    F.label(A(-(yRo + yRi) / 2, rz0 + 0.2), [xl, yA(rz0) - 14], 'rail end (dashed)', { ...T12, color: MUTED });
    if (railPts[0]) F.label(A(-railPts[0][0], railPts[0][1]), [xl, yA(railPts[0][1]) + 16], railJ?.type === 'domino' ? ['Domino mortise', 'for the rail end'] : ['mortise for the loose', 'tenon in the rail end'], T12);
    if (rear && vents.places[0]) F.label(A(-vents.places[0].off, vMin + vents.places[0].up), [xl, yA(vMin + vents.places[0].up) + 4], ['vent holes, 2 a side:', 'glue shows here when', 'the dados are full'], T12);
    // the handle-socket screw holes, drilled through transom and backer; the T-nuts sit in the backers
    const sock = c.by('handle-socket-L');
    const sockPts = rear && sock ? jointPts(sock, (j) => j.type === 'bolt' && j.to === 'transom-rear').map((q) => [q[1], q[2]] as Vec2) : [];
    for (const [u, v] of sockPts) for (const s of [1, -1]) { F.circle(A(s * u, v), 5.5, { fill: '#fff', stroke: MAT.steel.stroke, width: 1.6 }); F.circle(A(s * u, v), 2.2, { fill: MAT.steel.stroke }); }
    const sTop = sockPts.slice().sort((a, b) => a[1] - b[1])[0];
    if (sTop) F.label(A(sTop[0] + 0.15, sTop[1]), [xr, yA(sTop[1]) + 4], ['handle-socket screw holes;', 'T-nuts in the backers'], T12);
    F.label(A(-(S.yo + S.yWo) / 2, (S.gunBot + S.sheer) / 2), [xl, yA(S.sheer) + 24], ['band ends butt the', 'face here (dark)'], T12);
    F.label(A(webU * 0.55, L.deckBot + deckDadoH / 2), [xr, yA(rz0) - 14], ['deck dado: the deck', `edge goes ${f16(into)} in`], T12);
    F.label(A(webU, (L.chineBot + S.sheer) / 2 + (rear ? 0 : 0.6)), [xr, yA((L.chineBot + S.sheer) / 2) + 20], ['web dado, open at the', 'edge: the web end', 'goes in from there'], T12);
    if (backers[0]) F.label(A(backers[0].min[1] * Math.sign(backers[0].min[1]) - 0.3, (backers[0].min[2] + backers[0].max[2]) / 2 + 3), [xr, yA(vMax) - 10], ['backers, glued on', 'the day before'], T12);
    else if (hold) F.label(A(0, Math.max(...hold.map((q) => q[1]))), [A(0, 0)[0], yA(vMax) + 30], 'lift hand-hold: keep epoxy out of it', { ...T12, anchor: 'middle' });
    F.text([A(0, 0)[0], yA(Math.min(vMin, rz0)) - 8], 'bottom edge (up, for now)', { size: 11.5, anchor: 'middle', color: MUTED });

    // B. A cut through one corner at the chine band, the closing part slid back a little
    F.rect(70, by0, 620, 330, { stroke: MUTED, width: 0.8 });
    F.sub([82, by0 + 22], `B. One corner from above, cut through at the chine band`);
    const gap = 0.45;
    const t = T.max[0] - T.min[0];
    const dir = rear ? -1 : 1; // the closing part lies behind (-x) the hull end for the transom, ahead (+x) for the bulkhead
    const xPart0 = xFace + dir * gap, xPart1 = xPart0 + dir * t;
    const xHull = xFace - dir * 1.6;
    const uIn = S.yi - 0.9;
    const fb = fit({ minX: Math.min(xHull, xPart1), minY: uIn, maxX: Math.max(xHull, xPart1), maxY: S.yo + 0.15 }, { x: 250, y: by0 + 50, w: 260, h: 240 }, 1, 'center');
    const B = (x: number, y: number): Vec2 => fb.at([x, y]);
    const RB = (x0: number, y0: number, x1: number, y1: number, s: Style): void => { F.poly([B(x0, y0), B(x1, y0), B(x1, y1), B(x0, y1)], s); };
    const webEnd = xFace + dir * into;
    RB(xHull, S.yWi, webEnd, S.yWo, mat('web'));
    RB(xHull, S.yWo, xFace, S.yo, mat('oak'));
    RB(xHull, S.yi, xFace, S.yWi, mat('oak'));
    RB(xHull, uIn, xFace + dir * into, S.yi + L.deckEdge, ghost({ fill: 'none', stroke: MAT.deck.stroke }));
    RB(xFace, S.yWo, xFace + dir * 0.04, S.yo, { fill: MAT.epoxy.fill });
    RB(xFace, S.yi, xFace + dir * 0.04, S.yWi, { fill: MAT.epoxy.fill });
    breakV(F, B(xHull, 0)[0], B(0, S.yo)[1], B(0, uIn)[1]);
    const dy0 = webU - dadoW / 2, dy1 = webU + dadoW / 2;
    const floor0 = xPart0 + dir * into;
    const outline: Vec2[] = [[xPart0, uIn], [xPart0, dy0], [floor0, dy0], [floor0, dy1], [xPart0, dy1], [xPart0, S.yo], [xPart1, S.yo], [xPart1, uIn]];
    F.poly(outline.map(([x, y]) => B(x, y)), mat('oak', { stroke: ACCENT, width: 2 }));
    breakH(F, B(0, uIn)[1], B(xPart0, 0)[0], B(xPart1, 0)[0]);
    const bL = backers.find((b) => b.min[1] > 0);
    // The cut is through the chine band, below the backer's bottom end (on the finished sled), so the backer shows dashed and the inside corner takes its fillet.
    if (bL) RB(xPart0, uIn, xPart0 - dir * (bL.max[0] - bL.min[0]), Math.min(bL.max[1], S.yi), { stroke: ACCENT, width: 1.2, dash: '4 3' });
    F.poly([B(xFace, S.yi), B(xFace - dir * 0.22, S.yi), B(xFace, S.yi - 0.22)], { fill: MAT.epoxy.fill, stroke: '#9a6b00', width: 1 });
    const ay = B(0, S.yo)[1] - 14;
    F.arrow([B(xPart1, 0)[0], ay], [B(xPart0, 0)[0] + dir * 4, ay], ACCENT, 2.6);
    // labels: the hull's on its side of the panel, the closing part's on the other
    const hullX = rear ? 524 : 236, partX = rear ? 236 : 524;
    const ha = rear ? 'start' : 'end', pa = rear ? 'end' : 'start';
    const yB = (y: number): number => B(0, y)[1];
    const r0 = yB(S.yo) - 30, step = 46;
    const hullRows: Array<[Vec2, string[], TextOpts]> = [
      [B(xFace - dir * 1.0, (S.yo + S.yWo) / 2), ['outer band: its end', 'butts the face'], {}],
      [B(webEnd - dir * 0.08, (S.yWo + S.yWi) / 2), ['web: reaches', `${f16(into)} into its dado`], {}],
      [B(xFace - dir * 1.0, (S.yi + S.yWi) / 2), ['inner band: its end', 'butts the face too'], {}],
      [B(xFace - dir * 0.07, S.yi - 0.07), ['epoxy fillet in the', 'inside corner, after'], {}],
      [B(xFace - dir * 1.2, uIn + 0.25), ['deck and its dado: under', 'this cut (dashed)'], { color: MUTED }],
    ];
    hullRows.forEach(([tg, txt, o], i) => F.label(tg, [hullX, r0 + i * step], txt, { ...T12, ...o, anchor: ha }));
    F.label(B((floor0 + xPart0) / 2, dy1 - 0.02), [partX, r0], ['web dado,', `${f16(into)} deep`], { ...T12, anchor: pa });
    F.label(B((xPart0 + xPart1) / 2, S.yo - 0.1), [partX, r0 + step], [`the ${name} is pushed`, 'straight on (arrow)'], { ...T12, anchor: pa });
    if (bL) F.label(B(xPart0 - dir * 0.35, uIn + 0.3), [partX, r0 + 3 * step], ['backer, glued to it:', 'above this cut (dashed)'], { ...T12, anchor: pa });
    F.legend(['oak', 'web', 'deck', 'epoxy', 'ghost'], [16, F.h - 10]);
    F.note('Two views, each to its own scale');
    return {
      id: rear ? 'transom-close' : 'bulkhead-close',
      title: rear ? 'How the transom goes on' : 'How the bulkhead goes on',
      caption: rear
        ? `View A is the transom's inside face, drawn upside down as it goes onto the inverted hull. View B cuts through one corner, where the web and the deck edge reach into their dados.`
        : `View A is the bulkhead's inside (rear) face, upside down. View B cuts through one corner, where the web and the deck reach into their dados.`,
      svg: F.svg(rear ? 'The transom inside face and one corner as it is pushed on' : 'The bulkhead inside face and one corner as it is pushed on'),
    };
  };
}

export const HULL_FIGURES: Record<string, FigFn[]> = {
  hangers: [hangerOnRail],
  frame: [framePlan, frameSection],
  'dry-fit': [dryFitEnd, dryFitCradles],
  'rail-ends': [dryFitPilots],
  lower: [lowerJoint],
  transom: [endClose('transom')],
  bulkhead: [endClose('bulkhead')],
};
