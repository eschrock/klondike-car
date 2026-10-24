/**
 * Figures for the sandwich sides: what the side forms make and why (the side-forms step), and the two band cures on them (sides-inner, sides-outer).
 * The web outline, the sheer, the band lines and the ramp profiles are the side form's own geometry (`sideFormGeometry`), so the pictures follow the design.
 */
import { computeLayout, samples } from '../../model/layout';
import type { Vec2 } from '../../model/types';
import { CLEAT_TALL_IN, SANDBAG_SPACING_IN, sideFormGeometry, type SideFormGeometry } from '../forms';
import { frac } from '../svg-util';
import { ACCENT, boundsOf, Fig, fit, INK, mat, MUTED, type FigCtx, type FigFn, type StepFigure } from './kit';

const geom = (c: FigCtx): SideFormGeometry | null => sideFormGeometry(c.parts, c.p);

/** Inches as a fraction to 1/8 (a figure label), without the 1/32 noise. */
const f8 = (v: number): string => frac(v, 8);

/** 1. What the forms make: the finished side (its bands and its S), on the hull plan. */
const sidesPurpose: FigFn = (c) => {
  const g = geom(c);
  if (!g) return null;
  const L = computeLayout(c.p);
  const F = new Fig(760, 510);
  F.heading('What the side forms are for: the two sides of the hull');

  // (a) The hull from above: the bow end of each side turns in (the S).
  F.sub([16, 54], 'A. Looking down on the hull: the front of each side bends in');
  const xs = samples(L.xSideStart, L.xSideEnd, 80);
  const hw = L.hwC + L.side;
  const outer = (s: 1 | -1): Vec2[] => xs.map((x) => [x, s * (hw - L.turnIn(x))]);
  const inner = (s: 1 | -1): Vec2[] => xs.map((x) => [x, s * (L.hwC - L.turnIn(x))]);
  const plan = fit(boundsOf([...outer(1), ...outer(-1)]), { x: 120, y: 96, w: 520, h: 110 }, 1, 'center');
  const P = (q: Vec2[]): Vec2[] => q.map(plan.at);
  F.poly([...P(inner(1)), ...P(inner(-1)).reverse()], mat('ghost', { dash: '4 3' }));
  for (const s of [1, -1] as const) F.poly([...P(outer(s)), ...P(inner(s)).reverse()], mat('oak', { stroke: ACCENT, width: 1.6 }));
  const rearX = plan.at([L.xSideStart, 0])[0], bowX = plan.at([L.xSideEnd, 0])[0];
  F.text([rearX - 10, plan.at([0, 0])[1] + 4], 'rear', { anchor: 'end', color: MUTED, size: 12 });
  F.text([bowX + 10, plan.at([0, 0])[1] + 4], 'bow (front)', { color: MUTED, size: 12 });
  F.text([(rearX + bowX) / 2, plan.at([0, 0])[1] + 4], 'deck and frame go in here', { anchor: 'middle', color: MUTED, size: 12 });
  if (g.hasRamp) {
    const s0 = plan.at([L.taper.x0, hw]), s1 = plan.at([L.taper.x1, hw - L.taper.turnIn]);
    F.label(plan.at([(L.taper.x0 + L.taper.x1) / 2, hw - L.turnIn((L.taper.x0 + L.taper.x1) / 2)]), [s1[0] + 40, 86], `the S: each side turns in ${f8(g.rampH)} here`, { anchor: 'start' });
    F.line([s0[0], s0[1] - 6], [s0[0], s0[1] + 6], { stroke: ACCENT, width: 1.5 });
    F.line([s1[0], s1[1] - 6], [s1[0], s1[1] + 6], { stroke: ACCENT, width: 1.5 });
  }

  // (b) One side, seen from the outside, laid out flat: the web with its bands.
  F.sub([16, 246], 'B. One side, laid flat: a thin plywood web with oak bands along the top and bottom, on both faces');
  const outline = g.f.outer;
  const side = fit(boundsOf(outline), { x: 60, y: 284, w: 640, h: 140 });
  const S = (q: Vec2[]): Vec2[] => q.map(side.at);
  F.poly(S(outline), mat('web'));
  F.poly(S([...g.gunBot, ...[...g.sheer].reverse()]), mat('oak'));
  const w = g.f.widthIn;
  F.poly(S([[0, 0], [w, 0], [w, g.chineTop], [0, g.chineTop]]), mat('oak'));
  const mid = Math.floor(g.sheer.length * 0.45);
  F.label(side.at([g.sheer[mid][0], (g.sheer[mid][1] + g.gunBot[mid][1]) / 2]), [300, 276], 'gunwale band: oak, one on each face (its top edge is the sheer)', { anchor: 'start' });
  F.label(side.at([w * 0.3, g.chineTop * 0.5]), [90, 458], 'chine band: oak, one on each face (the outer one sits on the rail)', { anchor: 'start' });
  F.label(side.at([w * 0.62, g.chineTop + (g.gunBot[Math.floor(g.gunBot.length * 0.62)][1] - g.chineTop) / 2]), [500, 458], 'web: one sheet of thin plywood', { anchor: 'start' });
  if (g.hasRamp) {
    const u0 = g.uOf(g.xR0);
    const a = side.at([u0, 0]), b = side.at([u0, g.f.heightIn]);
    F.line([a[0], a[1] + 4], [b[0], b[1] - 4], { stroke: ACCENT, width: 1.2, dash: '5 4' });
    F.text([a[0] + 6, side.at([u0, g.chineTop + 3.2])[1]], ['the S starts here: ahead', 'of this line the side bends in'], { size: 12, color: ACCENT });
  }
  F.text([side.at([0, 0])[0], 482], 'rear end (transom)', { size: 12, color: MUTED });
  F.text([side.at([w, 0])[0], 482], 'bow end (bulkhead)', { size: 12, color: MUTED, anchor: 'end' });
  F.note('Plan view and side view, each to its own scale');
  return {
    id: 'sides-purpose',
    title: 'What the side forms are for',
    caption: `A, from above: the front ${f8(g.uOf(g.xRe) - g.uOf(g.xR0))} of each side curves in ${f8(g.rampH)}. B, one side laid flat: that curve-in becomes a lift of the bow end.`,
    svg: F.svg('What the side forms are for: the two sides of the hull, from above and laid flat'),
  };
};

/** 2. The form on the bench, set for the first face: the template, the cleats on the sheer and the S-ramp, from above and from the side. */
const formSetup: FigFn = (c) => {
  const g = geom(c);
  if (!g) return null;
  const F = new Fig(760, 520);
  F.heading('The side form, set up for the first face (one bench top)');
  const w = g.f.widthIn, H = g.f.heightIn;
  const u0 = g.hasRamp ? g.uOf(g.xR0) : w, uE = g.hasRamp ? g.uOf(g.xRe) : w;

  // (a) From above.
  F.sub([16, 52], 'A. From above');
  const top = benchPlan(F, g, { x: 40, y: 64, w: 680, h: 200 }, false);
  const c3 = top.cleat(Math.floor(g.nCleat * 0.3));
  F.label(c3, [c3[0] - 30, 62], `${g.nCleat} cleats on edge, ${frac(g.cleatStep, 16)} apart, set against the dry web`, { anchor: 'start' });
  F.label(top.stop(0), [20, 250], ['end stop (one at', 'each end of the band)'], { anchor: 'start', size: 12 });
  F.label(top.at([u0 * 0.35, H * 0.4]), [70, 298], ['template: the web\'s outline in 1/4" plywood (2 layers),', 'screwed flat; the web lies on it, inside face up'], { anchor: 'start' });
  if (g.hasRamp) {
    const capMid = top.at([(u0 + uE) / 2, -0.5]);
    F.label([capMid[0], capMid[1] - 6], [730, 300], [`S-ramp: ${g.ribs} MDF ribs (dashed) under a`, 'plain hardboard cap; it lifts', `the bow end ${f8(g.rampH)}`], { anchor: 'end' });
  }

  // (b) From the side (heights stretched): the web runs flat, then up the ramp.
  F.sub([16, 350], 'B. From the side (heights stretched 4 times): the bow end of the web rides up the ramp');
  const ex = 4;
  const rise = g.hasRamp ? g.webHighIn : g.webLowIn;
  const side = fit({ minX: -3, minY: -0.75, maxX: w + 3, maxY: rise + 0.6 }, { x: 40, y: 370, w: 680, h: 90 }, ex);
  F.poly([side.at([-3, -0.75]), side.at([w + 3, -0.75]), side.at([w + 3, 0]), side.at([-3, 0])], mat('bench'));
  F.poly([side.at([0, 0]), side.at([u0, 0]), side.at([u0, g.webLowIn]), side.at([0, g.webLowIn])], mat('template'));
  if (g.hasRamp) {
    const prof = g.rampProfile.map(([u, v]): Vec2 => [u, v]);
    F.poly([side.at([u0, 0]), ...prof.map(side.at), side.at([uE, 0])], mat('mdf'));
    F.poly([...prof.map(([u, v]): Vec2 => side.at([u, v])), ...[...prof].reverse().map(([u, v]): Vec2 => side.at([u, v + 0.25]))], mat('hardboard'));
  }
  const webLine: Vec2[] = [[0, g.webLowIn], [u0, g.webLowIn], ...(g.hasRamp ? g.rampProfile.map(([u, v]): Vec2 => [u, v + 0.25]) : []), [w, g.hasRamp ? g.webHighIn : g.webLowIn]];
  F.poly(webLine.map(side.at), { stroke: ACCENT, width: 3 }, false);
  F.label(side.at([w * 0.2, g.webLowIn]), [120, 486], 'web (orange) on the template, flat', { anchor: 'start' });
  if (g.hasRamp) {
    F.label(side.at([(u0 + uE) / 2, (g.webLowIn + g.webHighIn) / 2]), [430, 486], 'ramp ribs and cap: the web follows them up', { anchor: 'start' });
    F.dim(side.at([w + 1.5, g.webLowIn]), side.at([w + 1.5, g.webHighIn]), f8(g.rampH), 0, { flat: true });
  }
  F.legend(['bench', 'template', 'mdf', 'hardboard', 'oak'], [16, 512]);
  F.note();
  return {
    id: 'side-form-setup',
    title: 'The side form for the first face',
    caption: `The setup for the first face, from above and from the side: the cleats stand on edge along the web's curved top edge, and the S-ramp lifts the bow end of the web ${f8(g.rampH)}.`,
    svg: F.svg('The side form set up for the first face, from above and from the side'),
  };
};

/** 3. Why there are two ramps: after the first cure the web keeps its S, so its second face needs the ramp the other way up. */
const twoRamps: FigFn = (c) => {
  const g = geom(c);
  if (!g || !g.hasRamp) return null;
  const F = new Fig(760, 470);
  F.heading('Why there are two ramps (side views, heights stretched 4 times)');
  const w = g.f.widthIn, u0 = g.uOf(g.xR0), uE = g.uOf(g.xRe);
  const ex = 4;
  const panel = (y: number, title: string, mirror: boolean, bands: string[], n: number): void => {
    F.badge([28, y - 4], n);
    F.sub([46, y], title);
    const top = g.webHighIn + 0.6;
    const fr = fit({ minX: -3, minY: -0.75, maxX: w + 3, maxY: top }, { x: 60, y: y + 70, w: 620, h: 84 }, ex);
    F.poly([fr.at([-3, -0.75]), fr.at([w + 3, -0.75]), fr.at([w + 3, 0]), fr.at([-3, 0])], mat('bench'));
    const prof: Vec2[] = mirror ? g.mirrorProfile : g.rampProfile;
    if (mirror) {
      // a plateau under the flat part, falling through the S
      const hiV = g.mirrorProfile[0][1];
      const pts: Vec2[] = [[0, 0], [0, hiV], [u0, hiV], ...prof, [uE, 0]];
      F.poly(pts.map(fr.at), mat('mdf'));
      const capPts: Vec2[] = [[0, hiV], [u0, hiV], ...prof];
      F.poly([...capPts.map(fr.at), ...[...capPts].reverse().map(([u, v]): Vec2 => fr.at([u, v + 0.25]))], mat('hardboard'));
      const web: Vec2[] = [...capPts.map(([u, v]): Vec2 => [u, v + 0.25]), [w, g.webLowIn]];
      F.poly(web.map(fr.at), { stroke: ACCENT, width: 3 }, false);
      F.poly(web.map(([u, v]): Vec2 => fr.at([u, v + 0.35])), { stroke: '#8a6531', width: 3 }, false);
      F.poly(web.map(([u, v]): Vec2 => fr.at([u, v - 0.12])), { stroke: '#8a6531', width: 2, dash: '5 4' }, false);
      F.label(fr.at([w * 0.85, g.webLowIn + 0.6]), [fr.at([w, 0])[0], y + 30], bands, { anchor: 'end', size: 12 });
    } else {
      F.poly([[0, 0], [u0, 0], [u0, g.webLowIn], [0, g.webLowIn]].map((q) => fr.at(q as Vec2)), mat('template'));
      F.poly([fr.at([u0, 0]), ...prof.map(fr.at), fr.at([uE, 0])], mat('mdf'));
      F.poly([...prof.map(fr.at), ...[...prof].reverse().map(([u, v]): Vec2 => fr.at([u, v + 0.25]))], mat('hardboard'));
      const web: Vec2[] = [[0, g.webLowIn], [u0, g.webLowIn], ...prof.map(([u, v]): Vec2 => [u, v + 0.25]), [w, g.webHighIn]];
      F.poly(web.map(fr.at), { stroke: ACCENT, width: 3 }, false);
      F.poly(web.map(([u, v]): Vec2 => fr.at([u, v + 0.35])), { stroke: '#8a6531', width: 3 }, false);
      F.label(fr.at([w * 0.2, g.webLowIn + 0.6]), [fr.at([0, 0])[0], y + 30], bands, { anchor: 'start', size: 12 });
    }
    F.text(fr.at([0, -0.75]).map((v, i) => (i ? v + 14 : v)) as Vec2, 'rear end', { size: 11.5, color: MUTED });
    F.text(fr.at([w, -0.75]).map((v, i) => (i ? v + 14 : v)) as Vec2, 'bow end', { size: 11.5, color: MUTED, anchor: 'end' });
  };
  panel(64, 'First face, on the S-ramp: the inside face is up, the bow end rides up', false, ['web (orange) inside face up; the inner bands', '(brown) are glued on top'], 1);
  F.arrow([724, 190], [724, 270], ACCENT, 2.4, -30);
  F.text([716, 234], ['flip the', 'web over'], { size: 12, anchor: 'end', color: ACCENT });
  panel(270, 'Second face, on the MIRROR ramp: high at the rear, falling to the bow', true, ['web turned over: the outer bands (brown) go on top;', 'the cured inner bands (dashed) are underneath'], 2);
  F.note();
  return {
    id: 'side-two-ramps',
    title: 'Why there are two ramps',
    caption: `After the first cure the web keeps its S, so turned over its bow end hangs ${f8(g.rampH)} lower than its rear end. The mirror ramp is the S-ramp upside down.`,
    svg: F.svg('Why there are two ramps: the first face on the S-ramp, the second face on the mirror ramp'),
  };
};

/**
 * 4/5. A section across the web where a bag of sand sits on each band: which bands go on in this cure, the cleat at the sheer, the deck gap under the inner
 * chine band, and (cure 2) the backing strip under the web's bottom edge. The middle of the web is broken out, so its two edges show at a readable scale;
 * thicknesses are drawn 3 times their real size. `cure` 1 is the inside face (S-ramp bench), 2 the outside face (mirror ramp).
 */
function clampSection(cure: 1 | 2): FigFn {
  return (c) => {
    const g = geom(c);
    if (!g) return null;
    const L = computeLayout(c.p);
    const F = new Fig(760, 480);
    F.heading(cure === 1 ? 'Cure 1: section across the web (inside face up)' : 'Cure 2: section across the web (outside face up)');
    const stockOf = (id: string): { t: number; w: number } | undefined => c.by(id)?.stock;
    const band = stockOf('side-L-chine-in')?.t ?? L.sideBand;
    const webT = stockOf('side-L-web')?.t ?? Math.max(0.12, L.side - 2 * L.sideBand);
    const gunH = stockOf(cure === 1 ? 'side-L-gunwale-in' : 'side-L-gunwale')?.w ?? L.railBand;
    const H = g.f.heightIn, cap = L.webCap;
    // The two windows: the bottom edge (v from 0 to `win`) and the top edge (v from H - win to H + the band's overhang), side by side with a break between.
    const win = Math.max(g.chineTop, gunH) + 1.5;
    const k = 62, tk = k * 3, gap = 70, xA = 150, yBench = 340;
    const X = (v: number): number => (v <= win + 1e-9 ? xA + v * k : xA + win * k + gap + (v - (H - win)) * k);
    const lift = 2 * TEMPLATE_PX;
    const yWebBot = yBench - lift - (cure === 2 ? band * tk : 0), yWebTop = yWebBot - webT * tk, yBandTop = yWebTop - band * tk;
    const xR = X(H);
    F.rect(xA - 50, yBench, X(H + cap) + 90 - (xA - 50), 20, mat('bench'));
    F.text([xA - 42, yBench + 15], 'bench top', { size: 11.5, color: MUTED });
    // what the web lies on: the 2-layer template (cure 1) or the mirror-ramp cap (cure 2), in two windows
    for (const [a, b] of [[0, win], [H - win, H + cap + 0.3]] as Array<[number, number]>) {
      if (cure === 1) { F.rect(X(a), yBench - lift, (b - a) * k, lift / 2, mat('template')); F.rect(X(a), yBench - lift / 2, (b - a) * k, lift / 2, mat('template')); }
      else F.rect(X(a) - (a === 0 ? 20 : 0), yBench - lift, (b - a) * k + (a === 0 ? 20 : 0.75 * k + 40), lift, mat('hardboard'));
    }
    // the web, in two windows, with break marks
    F.rect(X(0), yWebTop, win * k, yWebBot - yWebTop, mat('web'));
    F.rect(X(H - win), yWebTop, win * k, yWebBot - yWebTop, mat('web'));
    for (const x of [X(win), X(H - win)]) F.path(`M${x},${yWebTop - 30} l-5,10 l10,8 l-5,10 L${x},${yBench + 28}`, { stroke: MUTED, width: 1, dash: '3 3' });
    F.text([(X(win) + X(H - win)) / 2, yBench - 22], ['middle of', 'web left out'], { size: 11, anchor: 'middle', color: MUTED, italic: true });
    // cure 2: the cured inner bands under the web, and the backing strip under its bottom edge where the inner chine band stops short
    if (cure === 2) {
      F.rect(X(g.innerChineBot), yWebBot, (g.chineTop - g.innerChineBot) * k, band * tk, mat('oak'));
      F.rect(X(H + cap - gunH), yWebBot, gunH * k, band * tk, mat('oak'));
      F.rect(X(0), yWebBot, g.innerChineBot * k - 2, band * tk, mat('oak', { stroke: ACCENT, width: 1.5, dash: '4 3' }));
    }
    // the bands this cure glues, on top; the gunwale band stands 1/8" past the web's top edge, against the cleat
    const chineLo = cure === 1 ? g.innerChineBot : 0;
    const chineW = cure === 1 ? (stockOf('side-L-chine-in')?.w ?? g.chineTop - chineLo) : (stockOf('side-L-chine')?.w ?? g.chineTop);
    F.rect(X(chineLo), yBandTop, (g.chineTop - chineLo) * k, yWebTop - yBandTop, mat('oak', { stroke: ACCENT, width: 2 }));
    F.rect(X(H + cap - gunH), yBandTop, gunH * k, yWebTop - yBandTop, mat('oak', { stroke: ACCENT, width: 2 }));
    // the cleat, on edge, against the band's top edge (drawn short: it is 1-1/2" tall)
    const xC = X(H + cap) + 1, cleatW = 0.75 * k;
    // the cleat stands on the bench beside the template (cure 1) or on the mirror-ramp cap, which runs past the web (cure 2)
    const cleatFoot = cure === 1 ? yBench : yBench - lift;
    F.rect(xC, yBandTop - 30, cleatW, cleatFoot - (yBandTop - 30), mat('oak', { stroke: '#6b4a1f' }));
    // the edge stop against the web's straight bottom edge (it fixes the web across the form; in cure 2 the outer chine band is pushed against it)
    const stopW = 0.75 * k * 0.6;
    F.rect(X(0) - stopW - 2, yBandTop - 10, stopW, (cure === 1 ? yBench : yBench - lift) - (yBandTop - 10), mat('oak', { stroke: '#6b4a1f' }));
    F.label([X(0) - stopW / 2 - 2, yBandTop - 4], [X(0) - stopW - 10, yBandTop - 40], 'edge stop', { anchor: 'end', size: 12 });
    // the bags of sand on a plastic sheet
    const bag = (x: number, wPx: number): void => {
      F.line([x - wPx / 2 - 6, yBandTop - 1], [x + wPx / 2 + 6, yBandTop - 1], { stroke: '#7a8a99', width: 1.5 });
      F.path(`M${x - wPx / 2},${yBandTop - 2} C${x - wPx / 2 - 6},${yBandTop - 40} ${x + wPx / 2 + 6},${yBandTop - 40} ${x + wPx / 2},${yBandTop - 2} Z`, { fill: '#d8c9a3', stroke: '#8a7a55', width: 1.2 });
    };
    bag(X((chineLo + g.chineTop) / 2), Math.max(60, (g.chineTop - chineLo) * k + 10));
    bag(X(H + cap - gunH / 2), Math.max(70, gunH * k));
    // labels
    const side = cure === 1 ? 'inner' : 'outer';
    F.label([X(H + cap - gunH / 2) - 30, yBandTop + 6], [X(H - win) - 10, 70], [`${side} gunwale band, ${frac(band, 16)} × ${frac(gunH, 16)}:`, `1/8" past the web, tight to the cleat`], { anchor: 'end', size: 12 });
    F.label([X((chineLo + g.chineTop) / 2) + 18, yBandTop + 6], [xA + 30, 110], [`${side} chine band, ${frac(band, 16)} × ${frac(chineW, 16)}`, cure === 1 ? 'stops short of the bottom edge' : 'flush with the bottom edge'], { anchor: 'start', size: 12 });
    F.label([xC + cleatW / 2, yBandTop - 20], [xC + 4, 70], cure === 1 ? ['cleat, on edge', `(${f8(CLEAT_TALL_IN)} tall)`] : ['cleat, on edge, on', 'the cap over a rib'], { anchor: 'start', size: 12 });
    F.label([X(H + cap - gunH / 2), yBandTop - 30], [X(H - win) - 10, 150], [`bag of sand on a plastic sheet,`, `every ${f8(SANDBAG_SPACING_IN)} along each band`], { anchor: 'end', size: 12 });
    F.label([X(win * 0.75), (yWebTop + yWebBot) / 2], [X(win * 0.75) - 10, yBench + 62], 'web (thin plywood)', { anchor: 'start', size: 12 });
    F.label([X(H - win) + 10, yBench - lift / 2], [X(H - win) - 10, yBench + 62], cure === 1 ? 'template, 2 layers (at the bow end: the S-ramp cap)' : 'mirror-ramp cap', { anchor: 'start', size: 12 });
    if (cure === 1) {
      F.dim([X(0), yWebTop - 3], [X(chineLo), yWebTop - 3], frac(chineLo, 16), -10, { size: 11.5 });
      F.label([X(chineLo / 2), yWebTop - 30], [20, 196], ['deck gap: the deck edge', 'slides in here later'], { anchor: 'start', size: 12 });
    } else {
      F.label([X(H - gunH / 2), yWebBot + band * tk / 2], [X(H - win) - 10, yBench + 92], 'cure-1 inner bands, now underneath', { anchor: 'start', size: 12 });
      F.label([X(g.innerChineBot / 2), yWebBot + band * tk / 2], [20, yBench + 96], ['backing strip (a band offcut)', 'under the web\'s edge'], { anchor: 'start', size: 12 });
    }
    F.text([X(0), yBench + 40], 'bottom edge', { size: 11, color: MUTED });
    F.text([xR, yBench + 40], 'top edge (sheer)', { size: 11, color: MUTED, anchor: 'end' });
    F.legend(['bench', cure === 1 ? 'template' : 'hardboard', 'web', 'oak'], [16, 472]);
    F.note('Section, thicknesses 3 times', 'top');
    return {
      id: `side-section-cure${cure}`,
      title: cure === 1 ? 'Cure 1: the inner bands' : 'Cure 2: the outer bands',
      caption: cure === 1
        ? `Looking along the web, cut across, with the middle of the web left out. The inner chine band stops ${frac(chineLo, 16)} short of the bottom edge, leaving the slot for the deck edge.`
        : 'The web is turned over, outside face up, resting on its cured inner bands. A band offcut under its bottom edge fills the gap where the inner chine band stops short.',
      svg: F.svg(cure === 1 ? 'Cure 1: section across the web, inner bands on top, weighted with bags of sand' : 'Cure 2: section across the web, outer bands on top, weighted with bags of sand'),
    };
  };
}

/** The template layer (or ramp cap) under the web in the cure sections (px). */
const TEMPLATE_PX = 16;

/** The finished side in section: four bands and the web, where the deck edge and the rail go. */
const finishedSection: FigFn = (c) => {
  const g = geom(c);
  if (!g) return null;
  const L = computeLayout(c.p);
  const F = new Fig(760, 380);
  F.heading('The finished side, cut across at its bottom edge (sled upright)');
  const band = c.by('side-L-chine')?.stock?.t ?? L.sideBand;
  const webT = c.by('side-L-web')?.stock?.t ?? Math.max(0.12, L.side - 2 * L.sideBand);
  const k = 72, cx = 300, yRail = 270;
  const X = (y: number): number => cx + y * k; // y = 0 at the web's middle, inboard is +
  const Z = (z: number): number => yRail - z * k;
  const outFace = -webT / 2 - band;
  // the rail under it and the deck edge in its slot (later steps, gray)
  const railT = c.p.railThicknessIn;
  F.rect(X(outFace), Z(0), railT * k, 52, mat('ghost'));
  F.text([X(outFace + railT / 2), Z(0) + 32], 'rail', { size: 12, color: MUTED, anchor: 'middle' });
  const deckEdge = webT / 2 + band - L.deckEdge;
  F.rect(X(deckEdge), Z(L.ply), 3.2 * k, L.ply * k, mat('ghost', { dash: '4 3' }));
  F.text([X(deckEdge + 2.4), Z(L.ply) + 22], 'deck', { size: 12, color: MUTED, anchor: 'middle' });
  // web, outer chine band (outboard), inner chine band (inboard)
  const top = Math.min(g.chineTop + 1.3, g.f.heightIn);
  F.rect(X(-webT / 2), Z(top), webT * k, top * k, mat('web'));
  F.rect(X(outFace), Z(g.chineTop), band * k, g.chineTop * k, mat('oak'));
  F.rect(X(webT / 2), Z(g.chineTop), band * k, (g.chineTop - g.innerChineBot) * k, mat('oak'));
  F.label([X(outFace + band / 2), Z(g.chineTop * 0.55)], [X(outFace) - 60, Z(g.chineTop * 0.9)], ['outer chine band', '(glued in cure 2)'], { size: 12, anchor: 'end' });
  F.label([X(webT / 2 + band / 2), Z(g.chineTop * 0.85)], [X(1.4), Z(top) - 6], ['inner chine band', '(glued in cure 1)'], { size: 12, anchor: 'start' });
  F.label([X(0), Z(top * 0.8)], [X(outFace) - 60, Z(top * 0.82)], ['web (runs on up to', 'the gunwale bands)'], { size: 12, anchor: 'end' });
  F.label([X(webT / 2 + band * 0.5), Z(g.innerChineBot * 0.5)], [X(deckEdge + 3.6), Z(g.innerChineBot) - 30], ['the slot under the inner band:', 'the deck edge rises into it'], { size: 12, anchor: 'start' });
  F.label([X(outFace + band), Z(0) + 2], [X(outFace) - 60, Z(0) + 48], ['outer band and web edge', 'sit on the rail; screws come', 'up through the rail into them'], { size: 12, anchor: 'end' });
  F.text([X(outFace) - 8, Z(0) + 22], '← outside', { size: 11.5, anchor: 'end', color: MUTED });
  F.text([X(outFace + railT) + 10, Z(0) + 22], 'inside →', { size: 11.5, color: MUTED });
  F.legend(['web', 'oak', 'ghost'], [16, 372]);
  F.note('Section, about 4 times full size');
  return {
    id: 'side-section-finished',
    title: 'The finished side at its bottom edge',
    caption: `The finished side cut across at its bottom edge: the inner chine band stops short, leaving the slot the deck edge rises into. The outer band and the web edge sit on the rail.`,
    svg: F.svg('The finished side at its bottom edge, cut across'),
  };
};

/**
 * The first bench top from above, drawn into `box`: the template (the web's outline; turned over along its length for the right side when `right`), the
 * S-ramp's plain cap with its ribs dashed, and the cleats on edge along the sheer. Returns the frame and a cleat's position for labels.
 */
function benchPlan(F: Fig, g: SideFormGeometry, box: { x: number; y: number; w: number; h: number }, right: boolean): { at: (p: Vec2) => Vec2; cleat: (i: number) => Vec2; stop: (i: 0 | 1) => Vec2 } {
  const w = g.f.widthIn, H = g.f.heightIn;
  const u0 = g.hasRamp ? g.uOf(g.xR0) : w, uE = g.hasRamp ? g.uOf(g.xRe) : w;
  const V = (v: number): number => (right ? H - v : v);
  const fr = fit({ minX: -4, minY: -2.5, maxX: w + 4, maxY: g.templateH + 2.5 }, box);
  const at = ([u, v]: Vec2): Vec2 => fr.at([u, V(v)]);
  const T = (q: Vec2[]): Vec2[] => q.map(at);
  F.poly([fr.at([-4, -2.5]), fr.at([w + 4, -2.5]), fr.at([w + 4, g.templateH + 2.5]), fr.at([-4, g.templateH + 2.5])], mat('bench'));
  F.poly(T(g.hasRamp ? [[0, 0], [u0, 0], ...g.sheer.filter(([u]) => u <= u0).reverse(), [0, g.sheer[0][1]]] : g.f.outer), mat('template'));
  if (g.hasRamp) {
    F.poly([fr.at([u0, -0.5]), fr.at([w + 2, -0.5]), fr.at([w + 2, H + 0.5]), fr.at([u0, H + 0.5])], mat('hardboard', { opacity: 0.85 }));
    for (let i = 0; i < g.ribs; i++) { const v = Math.min(H - 0.15, Math.max(0.15, i * g.ribPitch)); F.line(fr.at([u0 + 0.3, v]), fr.at([uE - 0.3, v]), { stroke: '#f4ead8', width: 1.2, dash: '6 4' }); }
  }
  F.poly(T(g.f.outer), { stroke: INK, width: 1.4 });
  const arc = (i: number): { p: Vec2; n: Vec2 } => {
    const s = i * g.cleatStep;
    let acc = 0;
    for (let k = 1; k < g.sheer.length; k++) {
      const a = g.sheer[k - 1], b = g.sheer[k], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + d >= s || k === g.sheer.length - 1) { const t = d ? Math.min(1, (s - acc) / d) : 0; const nx = -(b[1] - a[1]) / (d || 1), ny = (b[0] - a[0]) / (d || 1); return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n: ny >= 0 ? [nx, ny] : [-nx, -ny] }; }
      acc += d;
    }
    return { p: g.sheer[0], n: [0, 1] };
  };
  const CLEAT_T = 0.75, CLEAT_L = 3;
  for (let i = 0; i < g.nCleat; i++) {
    const { p: q, n } = arc(i);
    const tx: Vec2 = [n[1], -n[0]];
    const a: Vec2 = [q[0] - tx[0] * CLEAT_L / 2, q[1] - tx[1] * CLEAT_L / 2], b: Vec2 = [q[0] + tx[0] * CLEAT_L / 2, q[1] + tx[1] * CLEAT_L / 2];
    F.poly(T([a, b, [b[0] + n[0] * CLEAT_T, b[1] + n[1] * CLEAT_T], [a[0] + n[0] * CLEAT_T, a[1] + n[1] * CLEAT_T]]), mat('oak', { stroke: '#6b4a1f' }));
  }
  // the end stops: a block against the gunwale band's lower edge just past each end of the web (the band is left long there)
  const gb = (u: number): number => { const k = g.gunBot.reduce((b, q, i) => (Math.abs(q[0] - u) < Math.abs(g.gunBot[b][0] - u) ? i : b), 0); return g.gunBot[k][1]; };
  const stops: Array<[number, number, number]> = [[-0.2 - CLEAT_L, -0.2, gb(0)], [w + 0.2, w + 0.2 + CLEAT_L, gb(w)]];
  for (const [ua, ub, v] of stops) F.poly(T([[ua, v], [ub, v], [ub, v - CLEAT_T], [ua, v - CLEAT_T]]), mat('oak', { stroke: ACCENT, width: 1.4 }));
  return { at, cleat: (i: number) => { const { p: q, n } = arc(i); return at([q[0] + n[0] * CLEAT_T / 2, q[1] + n[1] * CLEAT_T / 2]); }, stop: (i: 0 | 1) => at([(stops[i][0] + stops[i][1]) / 2, stops[i][2] - CLEAT_T / 2]) };
}

/** The right side on the same first bench: the template's rear piece turned over along its length, the cleats re-set; the ramp does not move. */
const rightSide: FigFn = (c) => {
  const g = geom(c);
  if (!g || !g.hasRamp) return null;
  const F = new Fig(760, 500);
  F.heading('The right side on the same bench: turn the template over, re-set the cleats');
  F.badge([28, 60], 1);
  F.sub([46, 64], 'Left side (as built): inside face up, top edge at the far side');
  const a = benchPlan(F, g, { x: 60, y: 76, w: 640, h: 150 }, false);
  F.badge([28, 262], 2);
  F.sub([46, 266], 'Right side: the rear piece of the template turned over in place; the cleats moved to the new top edge');
  const b = benchPlan(F, g, { x: 60, y: 278, w: 640, h: 150 }, true);
  const u0 = g.uOf(g.xR0), uE = g.uOf(g.xRe);
  F.label(a.at([(u0 + uE) / 2, -0.5]), [720, 250], 'S-ramp: stays put (its cap covers both)', { anchor: 'end', size: 12 });
  F.label(b.cleat(Math.floor(g.nCleat * 0.5)), [720, 448], 'cleats re-set against the dry right web', { anchor: 'end', size: 12 });
  F.text([40, 470], 'The mirror ramp is re-set the same way: only its cleats move.', { size: 12, color: MUTED });
  F.legend(['bench', 'template', 'hardboard', 'oak'], [16, 492]);
  F.note();
  return {
    id: 'side-right-side',
    title: 'The right side on the same forms',
    caption: `The forms are cut for the left side; the right side is its mirror image. Turn the template's rear piece over in the same place and it becomes the right web's outline.`,
    svg: F.svg('The right side on the same bench: the template turned over and the cleats re-set'),
  };
};

export const SIDE_FIGURES: Record<string, FigFn[]> = {
  'side-forms': [sidesPurpose, formSetup, twoRamps, rightSide],
  'sides-inner': [clampSection(1)],
  'sides-outer': [clampSection(2), finishedSection],
};

export type { StepFigure };
