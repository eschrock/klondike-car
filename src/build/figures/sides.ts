/**
 * Figures for the sandwich sides: what the side forms make and why (the side-forms step), and the two band cures on them (sides-inner, sides-outer).
 * The web outline, the sheer, the band lines and the ramp profiles are the side form's own geometry (`sideFormGeometry`), so the pictures follow the design.
 */
import { computeLayout, samples } from '../../model/layout';
import type { Vec2 } from '../../model/types';
import { CLEAT_SPACING_IN, sideFormGeometry, type SideFormGeometry } from '../forms';
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
  F.label(side.at([w * 0.3, g.chineTop * 0.5]), [90, 458], 'chine band: oak, one on each face (it sits on the rail)', { anchor: 'start' });
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
    caption: `Each side of the hull is a sandwich: a thin plywood web with an oak band glued along its top and its bottom on BOTH faces (four bands a side). The side bends two ways at once: the top band follows the curved top edge (the sheer), and the front ${f8(g.uOf(g.xRe) - g.uOf(g.xR0))} of the side turns in toward the center (the S). Thin plywood will not hold either bend by itself, so the bands are glued on while a form holds the web bent; once the epoxy cures, the side keeps its shape. The forms in this step do that holding in [[step:sides-inner]] and [[step:sides-outer]]. They are shop jigs, not parts of the sled: once both sides are glued up, they are scrap.`,
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
  const top = fit({ minX: -3, minY: -3, maxX: w + 3, maxY: g.templateH + 4 }, { x: 40, y: 64, w: 680, h: 200 });
  const T = (q: Vec2[]): Vec2[] => q.map(top.at);
  F.poly(T([[-3, -3], [w + 3, -3], [w + 3, g.templateH + 4], [-3, g.templateH + 4]]), mat('bench'));
  // the template under the flat part of the web, the ramp cap under the bent part
  const clip = (q: Vec2[], lo: number, hi: number): Vec2[] => q.filter(([u]) => u >= lo - 1e-6 && u <= hi + 1e-6);
  F.poly(T(g.f.outer), mat('template'));
  if (g.hasRamp) {
    const capTop = clip(g.sheer, u0, w);
    F.poly(T([[u0, -0.6], [w, -0.6], [w, (capTop.at(-1)?.[1] ?? H) + 0.6], ...[...capTop].reverse().map(([u, v]): Vec2 => [u, v + 0.6]), [u0, (capTop[0]?.[1] ?? H) + 0.6]]), mat('hardboard', { opacity: 0.85 }));
    for (let i = 0; i < g.ribs; i++) {
      const y = 0.25 + i * g.ribPitch;
      F.line(top.at([u0 + 0.3, y]), top.at([uE, y]), { stroke: '#f4ead8', width: 1, dash: '6 4' });
    }
    const capMid = top.at([(u0 + uE) / 2, -0.6]);
    F.label([capMid[0], capMid[1] - 6], [730, 300], [`S-ramp: ${g.ribs} MDF ribs (dashed)`, 'under a hardboard cap; it lifts', `the bow end ${f8(g.rampH)}`], { anchor: 'end' });
  }
  // the web on it, drawn as a light outline
  F.poly(T(g.f.outer), { stroke: INK, width: 1.4, dash: '1 0' });
  // cleats on the high side of the sheer
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
  for (let i = 0; i < g.nCleat; i++) {
    const { p: q, n } = arc(i);
    const tx: Vec2 = [n[1], -n[0]];
    const a: Vec2 = [q[0] - tx[0] * 1.5, q[1] - tx[1] * 1.5], b: Vec2 = [q[0] + tx[0] * 1.5, q[1] + tx[1] * 1.5];
    F.poly(T([a, b, [b[0] + n[0] * 1.5, b[1] + n[1] * 1.5], [a[0] + n[0] * 1.5, a[1] + n[1] * 1.5]]), mat('oak', { stroke: '#6b4a1f' }));
  }
  const c3 = arc(Math.floor(g.nCleat * 0.3)).p;
  F.label(top.at([c3[0], c3[1] + 1.6]), [top.at([c3[0], 0])[0] - 30, 86], `${g.nCleat} cleats screwed to the bench, ${f8(g.cleatStep)} apart, on the sheer line`, { anchor: 'start' });
  F.label(top.at([u0 * 0.35, H * 0.4]), [70, 298], ['template: the web\'s outline in 1/4" plywood,', 'screwed flat; the web lies on it, inside face up'], { anchor: 'start' });

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
    caption: `One bench top carries the whole form. The template is the web's outline, screwed flat; the cleats stand along its curved top edge (the sheer) and stop the gunwale band from straightening while the glue cures (a bent oak strip pushes back hard). At the bow end the template gives way to the S-ramp, which lifts the front of the web ${f8(g.rampH)}: lying flat, that lift is the same bend as the S seen from above. The second bench top carries the mirror ramp for the second face (next figure).`,
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
    caption: `After the first cure the web keeps its S: the inner bands lock it in. Turned over for the second face, its bow end now hangs ${f8(g.rampH)} LOWER than its rear end, so it cannot go back on the S-ramp (it would have to bend ${f8(2 * g.rampH)} the wrong way). The mirror ramp is the S-ramp upside down: high under the flat part, falling through the S to the bench at the bow end. Build both before the first glue-up: one on each bench top.`,
    svg: F.svg('Why there are two ramps: the first face on the S-ramp, the second face on the mirror ramp'),
  };
};

/**
 * 4/5. A section across the web at a clamp: which bands go on in this cure, the cleat at the sheer, the deck gap under the inner chine band. The middle
 * of the web is broken out, so its two edges show at a readable scale; thicknesses are drawn 3 times their real size. `cure` 1 is the inside face
 * (S-ramp), 2 the outside face (mirror ramp).
 */
function clampSection(cure: 1 | 2): FigFn {
  return (c) => {
    const g = geom(c);
    if (!g) return null;
    const L = computeLayout(c.p);
    const F = new Fig(760, 470);
    F.heading(cure === 1 ? 'Cure 1: section across the web at one clamp (inside face up)' : 'Cure 2: section across the web at one clamp (outside face up)');
    const stockOf = (id: string): { t: number; w: number } | undefined => c.by(id)?.stock;
    const band = stockOf('side-L-chine-in')?.t ?? L.sideBand;
    const webT = stockOf('side-L-web')?.t ?? Math.max(0.12, L.side - 2 * L.sideBand);
    const gunH = stockOf(cure === 1 ? 'side-L-gunwale-in' : 'side-L-gunwale')?.w ?? L.railBand;
    const H = g.f.heightIn;
    // The two windows: the bottom edge (v from 0 to `win`) and the top edge (v from H - win to H), side by side with a break between.
    const win = Math.max(g.chineTop, gunH) + 1.5;
    const k = 62, tk = k * 3, gap = 70, xA = 150, yBench = 330;
    const X = (v: number): number => (v <= win + 1e-9 ? xA + v * k : xA + win * k + gap + (v - (H - win)) * k);
    const lift = TEMPLATE_PX;
    const yWebBot = yBench - lift - (cure === 2 ? band * tk : 0), yWebTop = yWebBot - webT * tk, yBandTop = yWebTop - band * tk;
    const xR = X(H);
    // bench top: it runs past the web on both sides; the clamps bite under it
    const benchL = xA - BENCH_MARGIN_PX, benchR = xR + BENCH_MARGIN_PX + 20;
    F.rect(benchL, yBench, benchR - benchL, 20, mat('bench'));
    F.text([benchL + 8, yBench + 15], 'bench top', { size: 11.5, color: MUTED });
    // what the web lies on: the template (cure 1) or the mirror-ramp cap (cure 2), in two windows
    const under = cure === 1 ? mat('template') : mat('hardboard');
    F.rect(X(0), yBench - lift, win * k, lift, under);
    F.rect(X(H - win), yBench - lift, win * k, lift, under);
    // the web, in two windows, with break marks
    F.rect(X(0), yWebTop, win * k, yWebBot - yWebTop, mat('web'));
    F.rect(X(H - win), yWebTop, win * k, yWebBot - yWebTop, mat('web'));
    for (const x of [X(win), X(H - win)]) F.path(`M${x},${yWebTop - 30} l-5,10 l10,8 l-5,10 L${x},${yBench + 28}`, { stroke: MUTED, width: 1, dash: '3 3' });
    F.text([(X(win) + X(H - win)) / 2, yBench - 22], ['middle of', 'web left out'], { size: 11, anchor: 'middle', color: MUTED, italic: true });
    // cure 2: the cured inner bands under the web
    if (cure === 2) {
      F.rect(X(g.innerChineBot), yWebBot, (g.chineTop - g.innerChineBot) * k, band * tk, mat('oak'));
      F.rect(X(H - gunH), yWebBot, gunH * k, band * tk, mat('oak'));
    }
    // the bands this cure glues, on top
    const chineLo = cure === 1 ? g.innerChineBot : 0;
    const chineW = cure === 1 ? (stockOf('side-L-chine-in')?.w ?? g.chineTop - chineLo) : (stockOf('side-L-chine')?.w ?? g.chineTop);
    F.rect(X(chineLo), yBandTop, (g.chineTop - chineLo) * k, yWebTop - yBandTop, mat('oak', { stroke: ACCENT, width: 2 }));
    F.rect(X(H - gunH), yBandTop, gunH * k, yWebTop - yBandTop, mat('oak', { stroke: ACCENT, width: 2 }));
    // the cleat beyond the sheer edge (between two clamps, so drawn behind them)
    const cleatW = 0.75 * k;
    F.rect(xR + 3, yBandTop - 14, cleatW, yBench - (yBandTop - 14), mat('oak', { stroke: '#6b4a1f' }));
    // clamps: deep-throat C-clamps that reach round the edge of the bench top
    const clampAt = (x: number, from: 'left' | 'right', reach: number): void => { F.clamp(x, yBandTop, yBench + 20, from, reach); };
    clampAt(X((chineLo + g.chineTop) / 2), 'left', X((chineLo + g.chineTop) / 2) - benchL + 14);
    clampAt(X(H - gunH / 2), 'right', benchR - X(H - gunH / 2) + 14);
    // labels
    const side = cure === 1 ? 'inner' : 'outer';
    F.label([X(H - gunH / 2) - 18, yBandTop + 4], [X(H - win) - 8, 66], [`${side} gunwale band, ${frac(band, 16)} × ${frac(gunH, 16)},`, 'tight against the cleats'], { anchor: 'end', size: 12 });
    F.label([X((chineLo + g.chineTop) / 2) + 14, yBandTop + 4], [xA + 40, 106], [`${side} chine band, ${frac(band, 16)} × ${frac(chineW, 16)}`, cure === 1 ? 'stops short of the bottom edge' : 'flush with the bottom edge'], { anchor: 'start', size: 12 });
    F.label([xR + 3 + cleatW / 2, yBandTop - 6], [xR + 20, yBandTop - 116], ['cleat (sheer line);', 'on a spacer where the', 'web is up on the ramp'], { anchor: 'start', size: 12 });
    F.label([X(0.5), (yWebTop + yWebBot) / 2], [xA - 20, yBench + 62], 'web (thin plywood)', { anchor: 'start', size: 12 });
    F.label([X(H - win) + 10, yBench - lift / 2], [X(H - win) - 10, yBench + 62], cure === 1 ? 'template (on the bow end: the S-ramp cap)' : 'mirror-ramp cap', { anchor: 'start', size: 12 });
    if (cure === 1) {
      F.dim([X(0), yWebTop - 3], [X(chineLo), yWebTop - 3], frac(chineLo, 16), -10, { size: 11.5 });
      F.label([X(chineLo / 2), yWebTop - 30], [20, 176], ['deck gap: the deck edge', 'slides in here later'], { anchor: 'start', size: 12 });
    } else {
      F.label([X(H - gunH / 2) + 20, yWebBot + band * tk / 2], [(X(win) + X(H - win)) / 2, yBandTop - 44], ['cure-1 inner bands,', 'now underneath'], { anchor: 'middle', size: 12 });
    }
    F.text([X(0), yBench + 40], 'bottom edge', { size: 11, color: MUTED });
    F.text([xR, yBench + 40], 'top edge (sheer)', { size: 11, color: MUTED, anchor: 'end' });
    F.text([380, yBench + 100], `Clamps every ${f8(CLEAT_SPACING_IN)} along each band, between the cleats`, { size: 12, color: MAT_CLAMP, anchor: 'middle' });
    F.legend(['bench', cure === 1 ? 'template' : 'hardboard', 'web', 'oak'], [16, 462]);
    F.note('Section, thicknesses 3 times');
    return {
      id: `side-section-cure${cure}`,
      title: cure === 1 ? 'Cure 1: the inner bands' : 'Cure 2: the outer bands',
      caption: cure === 1
        ? `Looking along the web, cut across at one clamp (the middle of the web is left out). The web lies inside face up with its top edge (the sheer) against the cleats. The two inner bands are epoxied on top: the gunwale band tight to the cleats, the chine band stopping ${frac(chineLo, 16)} short of the bottom edge to leave the slot the deck edge slides into later. Clamp each band about every ${f8(CLEAT_SPACING_IN)}. The clamps reach round the edge of the bench top, so set the bench top on sawhorses (or let it overhang the bench) where they go.`
        : 'The web is turned over onto the mirror ramp, outside face up, resting on its cured inner bands. The outer gunwale band goes against the cleats as before, and the outer chine band runs flush with the bottom edge (it sits on the rail). Same clamps, same spacing as cure 1.',
      svg: F.svg(cure === 1 ? 'Cure 1: section across the web at one clamp, inner bands on top' : 'Cure 2: section across the web at one clamp, outer bands on top'),
    };
  };
}

/** The template (or ramp cap) under the web in the clamp sections (px). */
const TEMPLATE_PX = 16;
/** How far the bench top runs past the web in the clamp sections (px; it is about 3" in the shop). */
const BENCH_MARGIN_PX = 56;
const MAT_CLAMP = '#2563eb';

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
    caption: 'After both cures, each side is band, web, band at its top and bottom edges. At the bottom the inner chine band stops short of the edge, leaving the slot the deck edge rises into when the frame goes in ([[step:dry-fit]] and [[step:lower]]). The outer band and the web edge sit on the rail, and screws come up through the rail into them.',
    svg: F.svg('The finished side at its bottom edge, cut across'),
  };
};

export const SIDE_FIGURES: Record<string, FigFn[]> = {
  'side-forms': [sidesPurpose, formSetup, twoRamps],
  'sides-inner': [clampSection(1)],
  'sides-outer': [clampSection(2), finishedSection],
};

export type { StepFigure };
