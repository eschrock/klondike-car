/**
 * 3D figures for the side-form steps (D-103): the one bench as it stands for the inside faces (S-ramp), rebuilt as the mirror ramp, and holding the web for the
 * outside faces, drawn with the headless solid renderer from the form's own geometry, plus the two cutting diagrams that turn the rail form's counter-form into the
 * ribs. Every size and position comes from `sideFormGeometry` and `ribGeometry`; the pictures follow the design.
 */
import { computeLayout, type Layout } from '../../model/layout';
import type { Vec2 } from '../../model/types';
import { CLEAT_TALL_IN, COUNTER_WALL_IN, RIB_BASE_IN, RIB_STOCK_IN, TEMPLATE_STOCK_IN, ribGeometry, sideFormGeometry, type SideFormGeometry } from '../forms';
import { frac } from '../svg-util';
import { ACCENT, Fig, MUTED, type FigCtx, type FigFn } from './kit';
import { Solids, type V3 } from './solid';

const COL = {
  bench: '#d9d2c3', tplUnder: '#cdbd8f', tplLaser: '#f1e3bd', cap: '#9a7f60', ribCaul: '#6fa3d8', ribNew: '#f0dfa0', web: '#f6ebcd', oak: '#e3b66b', oakCured: '#c99a52',
  strip: '#f0c987', backing: '#e8d1a0', cleat: '#d2432f', endStop: '#7b4bbd', edgeStop: '#3a6bd0',
};
const f8 = (v: number): string => frac(v, 8);

const interp = (arr: Vec2[], u: number): number => {
  if (u <= arr[0][0]) return arr[0][1];
  if (u >= arr[arr.length - 1][0]) return arr[arr.length - 1][1];
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m][0] <= u) lo = m; else hi = m; }
  const t = (u - arr[lo][0]) / (arr[hi][0] - arr[lo][0]);
  return arr[lo][1] + t * (arr[hi][1] - arr[lo][1]);
};
const lin = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** The web's v range (up from its bottom edge) at u, from its flat outline. */
function polyRange(P: Vec2[], u: number, w: number): [number, number] {
  const x = Math.min(w - 0.01, Math.max(0.01, u));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) { const v = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  return [lo, hi];
}

type Mode = 'inside' | 'mirror' | 'outside';
interface Cfg { mode: Mode; web: boolean; capOpacity: number }

/** The bench with everything the step needs: left web, so on the S-ramp its bottom edge is toward the viewer; on the mirror ramp it is turned over (bottom edge away). */
function scene(c: FigCtx, g: SideFormGeometry, L: Layout, cfg: Cfg): { S: Solids; pt: (u: number, v: number, y: number) => V3; fl: boolean } {
  const S = new Solids();
  const { f, sheer, gunBot, chineTop, innerChineBot } = g;
  const w = f.widthIn, H = f.heightIn;
  const u0 = g.uOf(g.xR0), uE = g.uOf(g.xRe);
  const rg = ribGeometry(L, g);
  const fl = cfg.mode !== 'inside'; // the left web is turned over for the outside face
  const Z = (v: number): number => -(fl ? H - v : v);
  const base = g.rampProfile[0][1], plateau = g.mirrorProfile[0][1], lowTail = g.mirrorProfile[g.mirrorProfile.length - 1][1];
  const ribA = (u: number): number => (u < u0 ? base : interp(g.rampProfile, u));
  const ribB = (u: number): number => (u < u0 ? plateau : interp(g.mirrorProfile, u));
  const sheerAt = (u: number): number => interp(sheer, u), gunBotAt = (u: number): number => interp(gunBot, u);
  const stock = (id: string): { t: number; w: number; l: number } | undefined => c.by(id)?.stock;
  const webT = stock('side-L-web')?.t ?? 0.2, band = stock('side-L-chine-in')?.t ?? 0.2;
  const bandsOn = (xs: number[], vLo: (u: number) => number, vHi: (u: number) => number, yb: (u: number) => number, h: number, color: string, layer: number): void => {
    S.sweep({ xs, zLo: (u) => Math.min(Z(vLo(u)), Z(vHi(u))), zHi: (u) => Math.max(Z(vLo(u)), Z(vHi(u))), yb, yt: (u) => yb(u) + h }, { color, layer });
  };
  // bench top
  S.box(-6, w + 7, -0.75, 0, -(H + 4), 4, { color: COL.bench, layer: 0 });
  const inside = cfg.mode === 'inside';
  const capTop = (u: number): number => (inside ? ribA(u) : ribB(u)) + TEMPLATE_STOCK_IN;
  const capV: [number, number] = inside ? [-0.5, H + 0.5] : [-1.5, H + 1.5];
  const capFrom = inside ? u0 : 0;
  // the ribs
  const rib = (v: number, a: number, b: number, yt: (u: number) => number, color: string): void => {
    S.sweep({ xs: lin(a, b, Math.max(2, Math.round((b - a) / 1.2))), zLo: () => -(v + RIB_STOCK_IN / 2), zHi: () => -(v - RIB_STOCK_IN / 2), yb: () => 0, yt }, { color, layer: 1 });
  };
  if (inside) {
    for (let i = 0; i < g.ribs; i++) rib(i * g.ribPitch, u0, uE, ribA, COL.ribCaul);
    // the template's rear piece: the 3/4" routed layer under the 1/4" laser piece
    const xs = lin(0, u0, 24), under = g.webLowIn - TEMPLATE_STOCK_IN;
    const rear = (yb: number, yt: number, color: string): void => { S.sweep({ xs, zLo: (u) => Z(polyRange(f.outer, u, w)[1]), zHi: (u) => Z(polyRange(f.outer, u, w)[0]), yb: () => yb, yt: () => yt }, { color, layer: 1 }); };
    rear(0, under, COL.tplUnder); rear(under, g.webLowIn, COL.tplLaser);
  } else {
    for (let i = 0; i < g.mirrorRibs; i++) {
      const v = capV[0] + RIB_STOCK_IN / 2 + i * g.mirrorPitch;
      rib(v, 0, rg.fillRear, () => plateau, COL.ribNew);
      rib(v, rg.fillRear, rg.fillRear + rg.ribLen, ribB, COL.ribCaul);
      rib(v, rg.fillRear + rg.ribLen, g.mirrorLen, () => lowTail, COL.ribNew);
    }
  }
  // the cap
  S.sweep({ xs: lin(capFrom, w + 2, 40), zLo: () => -capV[1], zHi: () => -capV[0], yb: (u) => capTop(u) - TEMPLATE_STOCK_IN, yt: capTop }, { color: COL.cap, opacity: cfg.capOpacity, layer: 2 });
  // the web and its bands
  const webXs = lin(0, w, 90), bandXs = lin(-1, w + 1, 70);
  const inner = cfg.mode === 'inside';
  const webYb = (u: number): number => (inner ? (u < u0 ? g.webLowIn : ribA(u) + TEMPLATE_STOCK_IN) : capTop(u) + band);
  if (cfg.web) {
    S.sweep({ xs: webXs, zLo: (u) => Math.min(Z(polyRange(f.outer, u, w)[0]), Z(polyRange(f.outer, u, w)[1])), zHi: (u) => Math.max(Z(polyRange(f.outer, u, w)[0]), Z(polyRange(f.outer, u, w)[1])), yb: webYb, yt: (u) => webYb(u) + webT }, { color: COL.web, layer: 4 });
    const top = (u: number): number => webYb(u) + webT;
    if (inner) {
      bandsOn(bandXs, () => innerChineBot, () => chineTop, top, band, COL.oak, 5);
      bandsOn(bandXs, gunBotAt, sheerAt, top, band, COL.oak, 5);
    } else {
      // the cured inner bands under the web, the backing strip under its bottom edge, and the outer bands on top
      bandsOn(bandXs, () => innerChineBot, () => chineTop, capTop, band, COL.oakCured, 3);
      bandsOn(bandXs, gunBotAt, sheerAt, capTop, band, COL.oakCured, 3);
      bandsOn(lin(0, w, 40), () => 0, () => innerChineBot, capTop, band, COL.backing, 3);
      bandsOn(bandXs, () => 0, () => chineTop, top, band, COL.oak, 5);
      bandsOn(bandXs, gunBotAt, sheerAt, top, band, COL.oak, 5);
      // the cap strip: in the gap on the inner band's overhang, flush with the web's faces
      S.sweep({ xs: webXs, zLo: (u) => Math.min(Z(polyRange(f.outer, u, w)[1]), Z(sheerAt(u))), zHi: (u) => Math.max(Z(polyRange(f.outer, u, w)[1]), Z(sheerAt(u))), yb: (u) => webYb(u), yt: (u) => webYb(u) + webT }, { color: COL.strip, layer: 4 });
    }
  }
  // the cleats along the sheer, the end stops and the edge stops
  const surf = (u: number, v: number): number => (u >= capFrom && u <= w + 2 && v >= capV[0] && v <= capV[1] ? capTop(u) : 0);
  const sheerLen = sheer.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - sheer[i - 1][0], q[1] - sheer[i - 1][1]) : 0), 0);
  for (let i = 0; i < g.nCleat; i++) {
    let acc = 0, p: Vec2 = sheer[0], n: Vec2 = [0, 1];
    const s = (i * sheerLen) / (g.nCleat - 1);
    for (let k = 1; k < sheer.length; k++) {
      const a = sheer[k - 1], b = sheer[k], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + d >= s || k === sheer.length - 1) {
        const t = d ? Math.min(1, (s - acc) / d) : 0;
        let nx = -(b[1] - a[1]) / (d || 1), ny = (b[0] - a[0]) / (d || 1);
        if (ny < 0) { nx = -nx; ny = -ny; }
        p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; n = [nx, ny];
        break;
      }
      acc += d;
    }
    const cx = p[0], cz = Z(p[1]);
    const nw: Vec2 = [n[0], fl ? n[1] : -n[1]]; // the outward normal in x, z
    const tw: Vec2 = [-nw[1], nw[0]];
    const hw = 1.5, th = 0.75;
    const y0 = surf(p[0], fl ? H - p[1] : p[1]);
    S.prism([[cx - tw[0] * hw, cz - tw[1] * hw], [cx + tw[0] * hw, cz + tw[1] * hw], [cx + tw[0] * hw + nw[0] * th, cz + tw[1] * hw + nw[1] * th], [cx - tw[0] * hw + nw[0] * th, cz - tw[1] * hw + nw[1] * th]], y0, y0 + CLEAT_TALL_IN, { color: COL.cleat, layer: 6 });
  }
  for (const [ua, ub] of [[-3.2, -0.2], [w + 0.2, w + 3.2]]) {
    const gb = gunBotAt(ua < 0 ? 0 : w), a = Z(gb - 0.75), b = Z(gb);
    const y0 = surf((ua + ub) / 2, fl ? H - gb : gb);
    S.box(ua, ub, y0, y0 + CLEAT_TALL_IN, Math.min(a, b), Math.max(a, b), { color: COL.endStop, layer: 6 });
  }
  const nEdge = Math.round(w / 12);
  for (let k = 0; k < nEdge; k++) {
    const uc = ((k + 0.5) * w) / nEdge;
    const va = fl ? H : -0.75, vb = fl ? H + 0.75 : 0;
    const y0 = surf(uc, (va + vb) / 2);
    S.box(uc - 1.5, uc + 1.5, y0, y0 + CLEAT_TALL_IN, Math.min(Z(va), Z(vb)), Math.max(Z(va), Z(vb)), { color: COL.edgeStop, layer: 6 });
  }
  return { S, pt: (u, v, y) => [u, y, Z(v)], fl };
}

const geom = (c: FigCtx): { g: SideFormGeometry; L: Layout } | null => { const g = sideFormGeometry(c.parts, c.p); return g && g.hasRamp ? { g, L: computeLayout(c.p) } : null; };

function legend(F: Fig, items: Array<[string, string]>, y: number): void {
  let x = 16;
  for (const [color, label] of items) {
    F.rect(x, y - 10, 14, 10, { fill: color, stroke: '#00000055', width: 0.8 });
    F.text([x + 19, y], label, { size: 11.5, color: MUTED });
    x += 19 + label.length * 6.1 + 16;
  }
}

/** 1. The bench for the inside faces, with the ribs shown through the cap. */
const benchInside: FigFn = (c) => {
  const gl = geom(c);
  if (!gl) return null;
  const { g, L } = gl;
  const F = new Fig(760, 380);
  F.heading('The side form for the inside faces: the S-ramp (3D view)');
  const { S, pt } = scene(c, g, L, { mode: 'inside', web: false, capOpacity: 0.3 });
  const P = S.render(F, { at: [380, 218], scale: 9.4, yaw: 24, pitch: 30 });
  const u0 = g.uOf(g.xR0), uE = g.uOf(g.xRe), w = g.f.widthIn;
  F.label(P(pt(u0 + 9, 6, 2.2)), [740, 70], [`${g.ribs} ribs, cut from the counter-form`, `(${f8(RIB_BASE_IN)} tall at the S start,`, `${f8(RIB_BASE_IN + g.rampH)} at the bow end)`], { anchor: 'end', size: 12 });
  F.label(P(pt(u0 * 0.5, 5, 1)), [50, 330], [`template: ${f8(g.webLowIn)} thick`, '(laser piece on a routed layer)'], { anchor: 'start', size: 12 });
  F.label(P(pt((u0 + uE) / 2, -0.3, 3.2)), [330, 330], [`cap: plain ${f8(TEMPLATE_STOCK_IN)} hardboard rectangle`], { anchor: 'start', size: 12 });
  F.label(P(pt(w * 0.28, g.sheer[Math.floor(g.sheer.length * 0.3)][1] + 0.4, 1.5)), [50, 70], [`${g.nCleat} cleats on edge,`, 'against the dry web'], { anchor: 'start', size: 12 });
  legend(F, [[COL.ribCaul, 'ribs from the counter-form'], [COL.cap, 'cap (shown see-through)'], [COL.tplLaser, 'template'], [COL.cleat, 'cleats'], [COL.endStop, 'end stops'], [COL.edgeStop, 'edge stops']], 366);
  return { id: 'side-form-3d-inside', title: 'The side form for the inside faces', caption: 'The bench top with the template under the flat part of the web, the ribs standing under the S and the plain cap over them (drawn see-through here), and the cleats and stops along the web.', svg: F.svg('The side form set up for the inside faces, in 3D') };
};

/** 2. The left web on it, inside face up, with its inner bands. */
const insideWeb: FigFn = (c) => {
  const gl = geom(c);
  if (!gl) return null;
  const { g, L } = gl;
  const F = new Fig(760, 380);
  F.heading('Cure 1: the left web on the S-ramp, inside face up (3D view)');
  const { S, pt } = scene(c, g, L, { mode: 'inside', web: true, capOpacity: 1 });
  const P = S.render(F, { at: [380, 218], scale: 9.4, yaw: 24, pitch: 30 });
  const u0 = g.uOf(g.xR0), w = g.f.widthIn;
  F.label(P(pt(w * 0.55, 5, g.webLowIn + 1.6)), [60, 56], ['inner gunwale band: tight against the cleats,', `${f8(c.p.sideWebCapIn)} past the web`], { anchor: 'start', size: 12 });
  F.label(P(pt(w * 0.12, 0.9, g.webLowIn + 0.7)), [60, 336], ['inner chine band: stops short of the bottom edge (the deck slot)'], { anchor: 'start', size: 12 });
  F.label(P(pt(u0 + 12, 2.4, g.webLowIn + 1.8)), [620, 336], [`the S lifts the bow end ${f8(g.rampH)}`], { anchor: 'end', size: 12 });
  legend(F, [[COL.web, 'web (inside face up)'], [COL.oak, 'inner bands'], [COL.cap, 'cap'], [COL.tplLaser, 'template'], [COL.cleat, 'cleats'], [COL.edgeStop, 'edge stops']], 366);
  return { id: 'side-form-3d-cure1', title: 'The left web on the S-ramp', caption: 'The left web lies inside face up on the template, its bow end riding up the ramp. The bottom edge is toward you, against the edge stops; the top edge is against the cleats.', svg: F.svg('The left web on the S-ramp in 3D, with its inner bands') };
};

/** 3. The bench rebuilt as the mirror ramp (no web). */
const benchMirror: FigFn = (c) => {
  const gl = geom(c);
  if (!gl) return null;
  const { g, L } = gl;
  const rg = ribGeometry(L, g);
  const F = new Fig(760, 380);
  F.heading('The same bench rebuilt as the mirror ramp (3D view)');
  const { S, pt } = scene(c, g, L, { mode: 'mirror', web: false, capOpacity: 0.3 });
  const P = S.render(F, { at: [380, 218], scale: 9.4, yaw: 24, pitch: 30 });
  const w = g.f.widthIn;
  F.label(P(pt(rg.fillRear / 2, 7, 3.6)), [50, 62], [`new block at each rib's rear:`, `${f8(rg.fillRear)} × ${f8(RIB_BASE_IN + g.rampH)} tall`], { anchor: 'start', size: 12 });
  F.label(P(pt(rg.fillRear + 14, 8, 3.6)), [400, 62], ['the same ribs, turned end for end:', 'the S now falls toward the bow'], { anchor: 'start', size: 12 });
  F.label(P(pt(w - 3, 5, 1)), [700, 330], [`new stick: ${f8(rg.fillTail)} × ${f8(RIB_BASE_IN)} tall`], { anchor: 'end', size: 12 });
  F.label(P(pt(w * 0.5, -1.2, 0.9)), [330, 336], [`cap: ${f8(g.mCapW)} wide, from the rear end to ${f8(2)} past the bow end`], { anchor: 'middle', size: 12 });
  legend(F, [[COL.ribCaul, 'ribs from the counter-form'], [COL.ribNew, 'new MDF blocks'], [COL.cap, 'cap (shown see-through)'], [COL.cleat, 'cleats'], [COL.endStop, 'end stops'], [COL.edgeStop, 'edge stops']], 366);
  return { id: 'side-form-3d-mirror', title: 'The bench rebuilt as the mirror ramp', caption: 'The template is gone. The ribs are turned end for end, each with a new block at the rear and a stick at the bow end, under a wider cap. The web, turned over, lies on this with its S falling toward the bow.', svg: F.svg('The side form rebuilt as the mirror ramp in 3D') };
};

/** 4. The left web turned over on it, with the outer bands and the cap strip. */
const outsideWeb: FigFn = (c) => {
  const gl = geom(c);
  if (!gl) return null;
  const { g, L } = gl;
  const F = new Fig(760, 380);
  F.heading('Cure 2: the left web turned over on the mirror ramp, outside face up (3D view)');
  const { S, pt } = scene(c, g, L, { mode: 'outside', web: true, capOpacity: 1 });
  const P = S.render(F, { at: [380, 218], scale: 9.4, yaw: 24, pitch: 30 });
  const w = g.f.widthIn;
  F.label(P(pt(w * 0.5, 0.8, 2.6 + g.rampH * 0.5)), [60, 56], ['outer chine band: flush with the bottom edge,', 'now on the far side'], { anchor: 'start', size: 12 });
  F.label(P(pt(w * 0.3, g.sheer[Math.floor(g.sheer.length * 0.3)][1], 4.6)), [60, 336], ['outer gunwale band over the cap strip,', 'the cured inner bands underneath'], { anchor: 'start', size: 12 });
  legend(F, [[COL.web, 'web (outside face up)'], [COL.oak, 'outer bands'], [COL.oakCured, 'inner bands (cured)'], [COL.strip, 'cap strip'], [COL.backing, 'backing strip'], [COL.cleat, 'cleats']], 366);
  return { id: 'side-form-3d-cure2', title: 'The left web on the mirror ramp', caption: 'Turned over along its length, the web lies outside face up on its cured inner bands. Its straight bottom edge is now away from you; the cleats stand along the near side. The cap strip lies in the gap on the inner band\'s overhang.', svg: F.svg('The left web on the mirror ramp in 3D, with its outer bands') };
};

/** 5. Cutting a counter-form layer into the S-ramp rib. */
const cutRib: FigFn = (c) => {
  const gl = geom(c);
  if (!gl) return null;
  const { g, L } = gl;
  const rg = ribGeometry(L, g);
  const F = new Fig(760, 350);
  F.heading('From the counter-form to the ribs: cut each layer down');
  const xs = lin(rg.xStartF, L.railEnd, 60);
  const top: Vec2[] = xs.map((x) => [x - rg.xStartF, COUNTER_WALL_IN + L.turnIn(x)]);
  const k = 16, X0 = 40;
  const px = (x: number): number => X0 + x * k;
  // the layer, turned over: its curved face up, its straight back edge down
  const yb1 = 140;
  const pts = (P: Vec2[], yb: number): Vec2[] => P.map(([x, h]) => [px(x), yb - h * k]);
  F.sub([X0, 50], `A. One layer of the counter-form, turned over (${f8(rg.layerLen)} long)`);
  F.poly([[px(0), yb1], ...pts(top, yb1), [px(rg.layerLen), yb1]], { fill: '#e6e6e6', stroke: '#9a9a9a', width: 1 });
  const keep: Vec2[] = [[rg.lead, COUNTER_WALL_IN - RIB_BASE_IN], [rg.lead, interp(top, rg.lead)], ...top.filter(([x]) => x > rg.lead).map(([x, h]): Vec2 => [x, h]), [rg.layerLen, COUNTER_WALL_IN - RIB_BASE_IN]];
  F.poly(pts(keep, yb1), { fill: COL.ribCaul, stroke: '#2f5f95', width: 1.2 });
  F.line([px(rg.lead), yb1 - (counterTop(top) + 0.5) * k], [px(rg.lead), yb1 + 4], { stroke: ACCENT, width: 2, dash: '6 4' });
  F.line([px(0), yb1 - (COUNTER_WALL_IN - RIB_BASE_IN) * k], [px(rg.layerLen), yb1 - (COUNTER_WALL_IN - RIB_BASE_IN) * k], { stroke: ACCENT, width: 2, dash: '6 4' });
  F.text([px(rg.lead / 2), yb1 + 18], [`cut off ${f8(rg.lead)}`, 'at the rear end'], { size: 12, anchor: 'middle', color: ACCENT });
  F.text([px(rg.lead + 12), yb1 + 18], `rip ${f8(COUNTER_WALL_IN - RIB_BASE_IN)} off the straight back edge`, { size: 12, color: ACCENT });
  F.text([px(0), yb1 - COUNTER_WALL_IN * k - 6], `rear end, ${f8(COUNTER_WALL_IN)} tall`, { size: 11.5, color: MUTED });
  F.text([px(rg.layerLen), yb1 - (COUNTER_WALL_IN + L.taper.turnIn) * k - 6], `bow end, ${f8(rg.counterTall)} tall`, { size: 11.5, color: MUTED, anchor: 'end' });
  // the rib
  const yb2 = 290;
  F.sub([X0, 218], `B. The S-ramp rib: make ${g.ribs} (${f8(rg.ribLen)} long)`);
  const rib: Vec2[] = keep.map(([x, h]): Vec2 => [x - rg.lead, h - (COUNTER_WALL_IN - RIB_BASE_IN)]);
  F.poly([[px(0), yb2], ...pts(rib, yb2), [px(rg.ribLen), yb2]], { fill: COL.ribCaul, stroke: '#2f5f95', width: 1.2 });
  F.dim([px(0), yb2 + 16], [px(rg.ribLen), yb2 + 16], `${f8(rg.ribLen)}`, 0, { size: 12 });
  F.text([px(0) + 2, yb2 - RIB_BASE_IN * k - 6], `${f8(RIB_BASE_IN)} at the S start`, { size: 11.5, color: MUTED });
  F.text([px(rg.ribLen) - 4, yb2 - (RIB_BASE_IN + L.taper.turnIn) * k - 6], `${f8(RIB_BASE_IN + L.taper.turnIn)} at the bow end`, { size: 11.5, color: MUTED, anchor: 'end' });
  F.note('Side views, to scale');
  return { id: 'side-rib-cut', title: 'From the counter-form to the ribs', caption: `Each layer of the counter-form has the same S as the ramp. Turned over, with ${f8(rg.lead)} cut off its rear end and ${f8(COUNTER_WALL_IN - RIB_BASE_IN)} ripped off its straight edge, it is a rib.`, svg: F.svg('Cutting a counter-form layer down into the S-ramp rib') };
};
const counterTop = (top: Vec2[]): number => Math.max(...top.map((q) => q[1]));

/** 6. Turning the ribs around for the mirror ramp. */
const turnRib: FigFn = (c) => {
  const gl = geom(c);
  if (!gl) return null;
  const { g, L } = gl;
  const rg = ribGeometry(L, g);
  const F = new Fig(760, 320);
  F.heading('Rebuilding the ribs for the mirror ramp: turn them around, add two blocks');
  const k = 11.6, X0 = 30;
  const px = (x: number): number => X0 + x * k;
  const plateau = g.mirrorProfile[0][1], lowTail = g.mirrorProfile[g.mirrorProfile.length - 1][1];
  const u0 = g.uOf(g.xR0), uE = g.uOf(g.xRe);
  const ribH = (x: number): number => (x < u0 ? plateau : interp(g.mirrorProfile, x));
  const yb = 190;
  const piece = (x0: number, x1: number, h: (x: number) => number, fill: string, stroke: string, dash?: string): void => {
    const P: Vec2[] = lin(x0, x1, Math.max(3, Math.round((x1 - x0) * 1.5))).map((x): Vec2 => [px(x), yb - h(x) * k]);
    F.poly([[px(x0), yb], ...P, [px(x1), yb]], { fill, stroke, width: 1.2, ...(dash ? { dash } : {}) });
  };
  F.sub([X0, 52], 'The S-ramp rib turned end for end, with a new block at each end');
  piece(0, rg.fillRear, () => plateau, COL.ribNew, '#8a7a3a', '5 3');
  piece(rg.fillRear, rg.fillRear + rg.ribLen, ribH, COL.ribCaul, '#2f5f95');
  piece(rg.fillRear + rg.ribLen, g.mirrorLen, () => lowTail, COL.ribNew, '#8a7a3a', '5 3');
  F.text([px(rg.fillRear / 2), yb - plateau * k / 2], ['new block', `${f8(rg.fillRear)} × ${f8(plateau)}`], { size: 12, anchor: 'middle' });
  F.text([px(rg.fillRear + rg.ribLen / 2), yb - plateau * k - 30], ['the S-ramp rib,', 'turned end for end'], { size: 12, anchor: 'middle' });
  F.label([px(g.mirrorLen - 2), yb - lowTail * k - 2], [px(g.mirrorLen) - 90, yb - 60], [`new stick`, `${f8(rg.fillTail)} × ${f8(RIB_BASE_IN)}`], { anchor: 'start', size: 12 });
  F.dim([px(0), yb + 20], [px(g.mirrorLen), yb + 20], `${f8(g.mirrorLen)} long (the same as the rib on the drawing)`, 0, { size: 12 });
  F.text([px(0), yb - plateau * k - 8], `rear end, ${f8(plateau)} tall`, { size: 11.5, color: MUTED });
  F.text([px(uE), yb + 52], `bow end, ${f8(lowTail)} tall`, { size: 11.5, color: MUTED, anchor: 'end' });
  F.note('Side view, to scale');
  return { id: 'side-rib-turn', title: 'Turning the ribs around', caption: `Each rib is turned end for end: its ${f8(rg.highFlat)} level end goes to the rear and the S falls toward the bow. A new ${f8(rg.fillRear)} block goes at the rear and a ${f8(rg.fillTail)} stick at the bow end; glue each to the rib with a small block over the joint.`, svg: F.svg('The S-ramp rib turned end for end with a new block at each end') };
};

export const SIDE3D_FIGURES: Record<string, FigFn[]> = {
  'side-forms': [benchInside, cutRib],
  'sides-inner': [insideWeb],
  'side-form-2': [benchMirror, turnRib],
  'sides-outer': [outsideWeb],
};

