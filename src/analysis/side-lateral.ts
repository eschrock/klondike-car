/**
 * Side lateral stiffness and strength (D-76; docs/side-stiffness-study.md): the `side-lateral` row and the numbers the `lash-load` row reads.
 *
 * The study's screening model, rebuilt here (finite differences at 1/4 in steps):
 *  - The GUNWALE BAND BEAM (both oak bands and the web between them, the sandwich thickness wide, `railBandIn` tall) bends out of plane between the rear
 *    transom and the bow bulkhead dados. Both end conditions are solved (pinned and fixed); the checks read the PINNED bound (the softer, larger one).
 *  - It rests on the side as vertical STRIPS cantilevered from the deck line, loaded at the gunwale centroid: the chine sandwich and the gunwale sandwich bend
 *    across the oak grain (`oakMoePerpPsi`), the free web across its face grain (`moePerpPsi` of the thin sheet), and the deck line is a rotational spring
 *    (DECK_LINE_ROT: the rail's torsion between joists plus the deck, study assumption).
 *  - Each RIB is a point spring at the gunwale: a cantilever of the rib section (oak, grain up; a web flange counted for stiffness only) from its base. A knee
 *    base is rigid up the knee and rotates on KNEE_ROT (the joist and deck T-beam, 2EI/L = 168k lb.in/rad, halved for the joint); the box rib pivots at the deck
 *    and is held by the box tie (BOX_TIE_K) at the spacer.
 * Conservative where the study was a screening model (it quotes +/-25 %): no torsion of the gunwale or twisting of the web is counted (the study counted both), the
 * grab boards' stiffening of the gunwale is ignored, the bow taper's plan curve is ignored, the box rib's base is a pin, the rib stresses use the rib section alone
 * (no web flange) while its stiffness counts one, and every stress criterion takes its own worst load position.
 */
import { thinSheet } from '../params';
import { sideRibStations, boxTieGeometry, kneeScrews, LASH_BOLTS, type RibStation } from '../model/side-ribs';
import { sideHeightAtX } from '../model/layout';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { f } from './format';
import { allowables } from './structure';
import { strapLoads } from './cargo';
import type { AnalysisCheck, Detail } from './types';

/** Study assumptions (docs/side-stiffness-study.md, "Assumptions"). */
export const DECK_LINE_ROT = 5000; // lb.in/rad per inch of side
export const KNEE_ROT = 100000; // lb.in/rad
export const BOX_TIE_K = 5000; // lbf/in
/** Eric's "feels solid" criterion for a 50 lbf push (study): under 1/8 in. Reported, not judged. */
export const FEEL_LIMIT_IN = 0.125;
const STEP_IN = 0.25;
/** NDS withdrawal: C_M wet service (Table 11.3.3) and the tip lead that does not bite (as in the old lash-load row). */
const WITHDRAWAL_WET_CM = 0.7;
const TIP_LEAD_IN = 0.25;

export interface RibSpring {
  st: RibStation;
  node: number;
  /** Load height (gunwale centroid above the deck), the base: the knee top or the tie centroid above the deck, and the rib's critical section (the knee top or the tie top). */
  H: number;
  zBase: number;
  zCrit: number;
  K: number;
  /** Section modulus of the rib alone at its critical section (in^3), and its depth from the web. */
  S: number;
  depth: number;
}

export interface SideModel {
  x0: number;
  n: number;
  h: number;
  xs: number[];
  EI: number;
  /** Strip stiffness (lbf/in per in), the load height above the deck, at each node. */
  k: number[];
  H: number[];
  /** Chine-sandwich top above the deck; the side, web and band thicknesses; the stress constants. */
  zc: number;
  tS: number;
  tW: number;
  /** Outer-fiber stress in the oak band per unit gunwale moment (psi per lb.in). */
  sigPerM: number;
  ribs: RibSpring[];
  Eoak: number;
}

/** Build the beam-on-strips model of one side at the defaults' geometry (both sides are mirror images). */
export function sideModel(ctx: Pick<Ctx, 'p' | 'L' | 'd'>, withRibs = true): SideModel {
  const { p, L } = ctx;
  const thin = thinSheet(p);
  const tS = L.side, tW = ctx.d.thinPlyIn, hb = L.railBand;
  const Eoak = p.oakMoePsi, EoakP = p.oakMoePerpPsi, EwP = thin.moePerpPsi, Ew = thin.moePsi;
  const EI = (Eoak * hb * (tS ** 3 - tW ** 3)) / 12 + (Ew * hb * tW ** 3) / 12;
  const sigPerM = (Eoak * tS / 2) / EI;
  const Ds = (EoakP * (tS ** 3 - tW ** 3)) / 12 + (EwP * tW ** 3) / 12; // sandwich strip, per inch
  const Dw = (EwP * tW ** 3) / 12; // bare web strip
  const zc = L.chineBot + L.chineH - L.deckTop;
  const x0 = L.xSideStart, x1 = L.xSideEnd;
  const n = Math.max(8, Math.round((x1 - x0) / STEP_IN));
  const h = (x1 - x0) / n;
  const xs: number[] = [], k: number[] = [], H: number[] = [];
  const seg = (Hh: number, a: number, b: number, D: number) => (b > a ? ((Hh - a) ** 3 - (Hh - b) ** 3) / (3 * D) : 0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * h;
    const hs = sideHeightAtX(L, x);
    const Hh = Math.max(zc + 0.1, hs - hb / 2);
    const zb = Math.max(zc, hs - hb);
    const flex = seg(Hh, 0, zc, Ds) + seg(Hh, zc, zb, Dw) + seg(Hh, zb, Hh, Ds) + (Hh * Hh) / DECK_LINE_ROT;
    xs.push(x); k.push(1 / flex); H.push(Hh);
  }
  const ribs: RibSpring[] = [];
  if (withRibs) {
    const w = p.sideRibWidthIn, depth = p.sideRibDepthIn + L.sideBand;
    // Stiffness section: the rib on a web flange (12 web thicknesses plus the rib width, transformed by the web's across-grain E). Stress section: the rib alone.
    const bf = ((w + 12 * tW) * EwP) / Eoak;
    const A1 = w * depth, y1 = tW + depth / 2, A2 = bf * tW, y2 = tW / 2;
    const yb = (A1 * y1 + A2 * y2) / (A1 + A2);
    const Ic = (w * depth ** 3) / 12 + A1 * (y1 - yb) ** 2 + (bf * tW ** 3) / 12 + A2 * (y2 - yb) ** 2;
    const EIr = Eoak * Ic;
    const S = (w * depth * depth) / 6;
    for (const st of sideRibStations(p, L)) {
      const node = Math.max(1, Math.min(n - 1, Math.round((st.x - x0) / h)));
      const Hr = st.h - hb / 2;
      let zBase: number, zCrit: number, flex: number;
      if (st.kind === 'box') {
        const tg = boxTieGeometry(p, L, st);
        zBase = (tg.z0 + tg.z1) / 2 - L.deckTop;
        zCrit = tg.z1 - L.deckTop; // the spacer is glued along the rib, so the rib's bending section is at its top edge
        flex = (Hr / zBase) ** 2 / BOX_TIE_K + Math.max(0, Hr - zCrit) ** 3 / (3 * EIr);
      } else {
        zBase = Math.min(p.sideRibKneeHeightIn, st.h - hb - 0.25);
        zCrit = zBase;
        flex = (Hr * Hr) / KNEE_ROT + Math.max(0, Hr - zBase) ** 3 / (3 * EIr);
      }
      ribs.push({ st, node, H: Hr, zBase, zCrit, K: 1 / flex, S, depth });
    }
  }
  return { x0, n, h, xs, EI, k, H, zc, tS, tW, sigPerM, ribs, Eoak };
}

/** Banded (half-bandwidth 2) symmetric system for the interior nodes 1..n-1, factored once (no pivoting: it is positive definite). */
export interface SideSolver { solve: (P: number[]) => number[]; model: SideModel; ends: 'pinned' | 'fixed' }

export function sideSolver(m: SideModel, ends: 'pinned' | 'fixed'): SideSolver {
  const N = m.n - 1; // unknowns w_1..w_{n-1}
  const c = m.EI / m.h ** 3;
  const A: number[][] = Array.from({ length: N }, () => new Array<number>(5).fill(0)); // band columns j-2..j+2 at index 0..4
  const ghost = ends === 'pinned' ? -1 : 1;
  for (let r = 0; r < N; r++) {
    const i = r + 1;
    A[r][0] = c; A[r][1] = -4 * c; A[r][2] = 6 * c + m.k[i] * m.h; A[r][3] = -4 * c; A[r][4] = c;
    if (i === 1 || i === m.n - 1) A[r][2] += ghost * c; // w_{-1} = -/+ w_1 (pinned / fixed), w_0 = 0
  }
  for (const rb of m.ribs) A[rb.node - 1][2] += rb.K;
  // LU in band storage (L unit lower with 2 sub-diagonals, U with 2 super-diagonals).
  const a = A.map((row) => row.slice());
  for (let r = 0; r < N; r++) {
    const piv = a[r][2];
    for (let q = 1; q <= 2 && r + q < N; q++) {
      const fct = a[r + q][2 - q] / piv;
      a[r + q][2 - q] = fct;
      for (let t = 1; t <= 2; t++) if (2 - q + t <= 4) a[r + q][2 - q + t] -= fct * a[r][2 + t];
    }
  }
  const solve = (P: number[]): number[] => {
    const y = new Array<number>(N).fill(0);
    for (let r = 0; r < N; r++) { let s = P[r + 1] ?? 0; for (let q = 1; q <= 2 && r - q >= 0; q++) s -= a[r][2 - q] * y[r - q]; y[r] = s; }
    const x = new Array<number>(N).fill(0);
    for (let r = N - 1; r >= 0; r--) { let s = y[r]; for (let t = 1; t <= 2 && r + t < N; t++) s -= a[r][2 + t] * x[r + t]; x[r] = s / a[r][2]; }
    return [0, ...x, 0];
  };
  return { solve, model: m, ends };
}

export interface SideResponse {
  wMax: number;
  xWMax: number;
  /** Peak stresses (psi): oak band (gunwale beam bending), web at the chine top (across its face grain), deck line (cross-grain), and each rib. */
  sigBand: number;
  sigWeb: number;
  sigDeck: number;
  ribF: number[];
  ribM: number[];
  ribSig: number[];
  w: number[];
}

/** Response to point loads (node, lbf) at the gunwale. */
export function sideResponse(s: SideSolver, loads: Array<[number, number]>): SideResponse {
  const m = s.model;
  const P = new Array<number>(m.n + 1).fill(0);
  for (const [i, F] of loads) P[i] += F;
  const w = s.solve(P);
  let wMax = 0, xW = m.xs[0], sigBand = 0, sigWeb = 0, sigDeck = 0;
  for (let i = 0; i <= m.n; i++) {
    if (Math.abs(w[i]) > wMax) { wMax = Math.abs(w[i]); xW = m.xs[i]; }
    // Beam moment from the curvature; at a pinned end it is 0, at a fixed end the one-sided ghost gives w'' = 2 w_1 / h^2.
    const wl = i === 0 ? (s.ends === 'fixed' ? w[1] : -w[1]) : w[i - 1];
    const wr = i === m.n ? (s.ends === 'fixed' ? w[m.n - 1] : -w[m.n - 1]) : w[i + 1];
    const M = (m.EI * (wl - 2 * w[i] + wr)) / (m.h * m.h);
    sigBand = Math.max(sigBand, Math.abs(M) * m.sigPerM);
    const q = m.k[i] * Math.abs(w[i]); // strip line load (lbf/in) at the gunwale
    sigDeck = Math.max(sigDeck, (6 * q * m.H[i]) / (m.tS * m.tS));
    sigWeb = Math.max(sigWeb, (6 * q * Math.max(0, m.H[i] - m.zc)) / (m.tW * m.tW));
  }
  const ribF = m.ribs.map((r) => r.K * Math.abs(w[r.node]));
  const ribM = m.ribs.map((r, j) => ribF[j] * Math.max(0, r.H - r.zCrit));
  const ribSig = m.ribs.map((r, j) => ribM[j] / r.S);
  return { wMax, xWMax: xW, sigBand, sigWeb, sigDeck, ribF, ribM, ribSig, w };
}

/** Knee toe screws: withdrawal capacity (lbf per screw, NDS 12.2.1 x C_M wet) and the governing screw's pull for a base moment (rigid knee turning about the rib's back face). */
export function kneeScrewLoads(ctx: Pick<Ctx, 'p' | 'L'>) {
  const { p, L } = ctx;
  const ks = kneeScrews(p, L);
  const bite = ks.fit.lenIn - ks.fit.gripIn;
  const pen = Math.max(0, bite - TIP_LEAD_IN);
  const perIn = 1380 * p.oakSpecificGravity ** 2 * ks.dia;
  const cap = perIn * pen * WITHDRAWAL_WET_CM;
  const levers = ks.d.map((d) => d + p.sideRibDepthIn + L.sideBand);
  const sumSq = levers.reduce((a, l) => a + l * l, 0);
  const lMax = Math.max(...levers);
  return { ks, bite, pen, perIn, cap, levers, pullPerMoment: lMax / sumSq };
}

export interface SideLateral {
  model: SideModel;
  /** 50 lbf push, worst position: deflection both bounds; stresses (pinned bound) at each criterion's worst position. */
  push: { P: number; wPinned: number; xPinned: number; wFixed: number; xFixed: number; noRibsPinned: number; noRibsFixed: number; sigBand: number; sigWeb: number; sigDeck: number; ribSig: number; ribSigN: number; kneeMoment: number; kneePull: number; tieForce: number };
  /** One strap at the D-ring rating at the worst station (inboard part), and the cargo strap tension at every D-ring. */
  rating: { Hin: number; station: number; r: SideResponse; ribSig: number; tieForce: number; /** The highest rib stress over the stations, each pulled alone at the rating, and its rib. */ ribSigMax: number; ribSigMaxN: number; ribMMax: number };
  strap: { T: number; Hin: number; r: SideResponse; tieForce: number } | null;
  knee: ReturnType<typeof kneeScrewLoads>;
  tieArea: number;
}

const tieForceOf = (m: SideModel, r: SideResponse) => m.ribs.reduce((mx, rb, j) => (rb.st.kind === 'box' ? Math.max(mx, (r.ribF[j] * rb.H) / rb.zBase) : mx), 0);

const cache = new WeakMap<Ctx, SideLateral>();

/** Everything the side-lateral and lash-load rows need (both sides are the same; one is solved). Cached per analysis context (both rows read it). */
export function sideLateral(ctx: Ctx, strapTension?: number): SideLateral {
  if (strapTension === undefined) {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const v = sideLateralUncached(ctx);
    cache.set(ctx, v);
    return v;
  }
  return sideLateralUncached(ctx, strapTension);
}

function sideLateralUncached(ctx: Ctx, strapTension?: number): SideLateral {
  const { p } = ctx;
  const m = sideModel(ctx, true);
  const pin = sideSolver(m, 'pinned'), fix = sideSolver(m, 'fixed');
  const bare = sideModel(ctx, false);
  const pin0 = sideSolver(bare, 'pinned'), fix0 = sideSolver(bare, 'fixed');
  const knee = kneeScrewLoads(ctx);
  const P = p.sideKickLbf;
  const push = { P, wPinned: 0, xPinned: 0, wFixed: 0, xFixed: 0, noRibsPinned: 0, noRibsFixed: 0, sigBand: 0, sigWeb: 0, sigDeck: 0, ribSig: 0, ribSigN: 0, kneeMoment: 0, kneePull: 0, tieForce: 0 };
  for (let i = 1; i < m.n; i++) {
    const rp = sideResponse(pin, [[i, P]]);
    if (Math.abs(rp.w[i]) > push.wPinned) { push.wPinned = Math.abs(rp.w[i]); push.xPinned = m.xs[i]; }
    if (i % 2 === 0) { // the fixed bound and the bare side are reported only: every 1/2 in
      const wf = Math.abs(fix.solve(unitAt(m.n, i, P))[i]);
      if (wf > push.wFixed) { push.wFixed = wf; push.xFixed = m.xs[i]; }
      push.noRibsPinned = Math.max(push.noRibsPinned, Math.abs(pin0.solve(unitAt(m.n, i, P))[i]));
      push.noRibsFixed = Math.max(push.noRibsFixed, Math.abs(fix0.solve(unitAt(m.n, i, P))[i]));
    }
    push.sigBand = Math.max(push.sigBand, rp.sigBand);
    push.sigWeb = Math.max(push.sigWeb, rp.sigWeb);
    push.sigDeck = Math.max(push.sigDeck, rp.sigDeck);
    rp.ribSig.forEach((s, j) => { if (s > push.ribSig) { push.ribSig = s; push.ribSigN = m.ribs[j].st.n; } });
    m.ribs.forEach((rb, j) => { if (rb.st.kind === 'knee') push.kneeMoment = Math.max(push.kneeMoment, rp.ribF[j] * rb.H); });
    push.tieForce = Math.max(push.tieForce, tieForceOf(m, rp));
  }
  push.kneePull = push.kneeMoment * knee.pullPerMoment;
  const th = (p.lashPullAngleDeg * Math.PI) / 180;
  const ringRibs = m.ribs.filter((rb) => ctx.parts.length === 0 || ctx.byId.has(`lash-L${rb.st.n}`));
  const Hin = p.lashLoadLbf * Math.cos(th);
  let rating: SideLateral['rating'] = { Hin, station: 0, r: sideResponse(pin, []), ribSig: 0, tieForce: 0, ribSigMax: 0, ribSigMaxN: 0, ribMMax: 0 };
  let worstU = -1, ribSigMax = 0, ribSigMaxN = 0, ribMMax = 0;
  const al = allowables(ctx);
  for (const rb of ringRibs) {
    const r = sideResponse(pin, [[rb.node, Hin]]);
    r.ribSig.forEach((sg, j) => { if (sg > ribSigMax) { ribSigMax = sg; ribSigMaxN = m.ribs[j].st.n; ribMMax = r.ribM[j]; } });
    const u = Math.max(r.sigBand / al.oakBend, r.sigWeb / al.thinBendPerp, r.sigDeck / (al.oakShear / 3), Math.max(...r.ribSig) / al.oakBend);
    if (u > worstU) { worstU = u; rating = { Hin, station: rb.st.n, r, ribSig: Math.max(...r.ribSig), tieForce: tieForceOf(m, r), ribSigMax: 0, ribSigMaxN: 0, ribMMax: 0 }; }
  }
  rating.ribSigMax = ribSigMax; rating.ribSigMaxN = ribSigMaxN; rating.ribMMax = ribMMax;
  let strap: SideLateral['strap'] = null;
  const T = strapTension ?? (ctx.loads.cargoCases.length ? strapLoads(ctx).T : 0);
  if (T > 0 && ringRibs.length) {
    const Hs = T * Math.cos(th);
    const r = sideResponse(pin, ringRibs.map((rb): [number, number] => [rb.node, Hs]));
    strap = { T, Hin: Hs, r, tieForce: tieForceOf(m, r) };
  }
  const tieArea = Math.min(p.sideRibWidthIn, p.boxTieWidthIn) * p.boxTieHeightIn;
  return { model: m, push, rating, strap, knee, tieArea };
}

function unitAt(n: number, i: number, P: number): number[] {
  const v = new Array<number>(n + 1).fill(0);
  v[i] = P;
  return v;
}

export function sideLateralCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const s = sideLateral(ctx);
  const deckAllow = al.oakShear / 3; // cross-grain tension F_rt = F_v / 3 (NDS 5.2.8, the D-74 / D-75 precedent)
  const hasBox = s.model.ribs.some((rb) => rb.st.kind === 'box');
  const hasKnee = s.model.ribs.some((rb) => rb.st.kind === 'knee');
  const ds: Detail[] = [
    detail(`${f(s.push.P, 0)} lbf push, worst x: oak gunwale bands (beam bending)`, s.push.sigBand, 'psi', al.oakBend, '<='),
    detail(`${f(s.push.P, 0)} lbf push: web at the chine top (across its face grain)`, s.push.sigWeb, 'psi', al.thinBendPerp, '<='),
    detail(`${f(s.push.P, 0)} lbf push: deck-line glue and chine sandwich (cross-grain tension)`, s.push.sigDeck, 'psi', deckAllow, '<='),
    detail(`${f(s.push.P, 0)} lbf push: rib bending (rib ${s.push.ribSigN}, at the top of its knee or tie)`, s.push.ribSig, 'psi', al.oakBend, '<='),
    detail(`D-ring rating ${f(p.lashLoadLbf, 0)} lbf at ${p.lashPullAngleDeg}° on rib ${s.rating.station}: oak gunwale bands`, s.rating.r.sigBand, 'psi', al.oakBend, '<='),
    detail('D-ring rating: web at the chine top (across its face grain)', s.rating.r.sigWeb, 'psi', al.thinBendPerp, '<='),
    detail('D-ring rating: deck-line glue and chine sandwich (cross-grain tension)', s.rating.r.sigDeck, 'psi', deckAllow, '<='),
    detail(`D-ring rating: rib bending (rib ${s.rating.ribSigMaxN}, each rib pulled alone)`, s.rating.ribSigMax, 'psi', al.oakBend, '<='),
  ];
  if (hasKnee) ds.push(detail(`${f(s.push.P, 0)} lbf outward push: knee toe screw withdrawal (${s.knee.ks.d.length} ${s.knee.ks.fit.gauge === 6 ? '#6' : `#${s.knee.ks.fit.gauge}`} into the joist)`, s.push.kneePull, 'lbf', s.knee.cap, '<='));
  if (hasBox) ds.push(detail('box tie glue (rating or push), cross-grain tension', Math.max(s.push.tieForce, s.rating.tieForce) / s.tieArea, 'psi', deckAllow, '<='));
  const m = s.model;
  const ribTxt = m.ribs.map((rb) => `rib ${rb.st.n} at x = ${f(rb.st.x, 1)} (${rb.st.kind === 'box' ? `box tie ${f(rb.zBase, 1)}" up` : `knee on ${rb.st.member === 'king-beam' ? 'the king beam' : (rb.st.member ?? '').replace('-', ' ')}`}, ${f(rb.K, 0)} lbf/in at the gunwale)`).join('; ');
  const how = `Beam-on-strips screening model (docs/side-stiffness-study.md, D-76): the gunwale band beam (EI ${f(m.EI, 0)} lb·in²) spans ${f(m.xs[m.n] - m.x0, 2)}" between the transom and bulkhead dados on the side's vertical strips (${f(Math.min(...m.k), 1)} to ${f(Math.max(...m.k), 0)} lbf/in per inch: the chine and gunwale sandwiches across the oak grain at ${f(p.oakMoePerpPsi, 0)} psi, the web across its face grain at ${f(thinSheet(p).moePerpPsi, 0)} psi, a ${DECK_LINE_ROT} lb·in/rad per inch deck line), with the ribs as springs: ${ribTxt}. `
    + `Conservative: no gunwale torsion or web twisting, no grab-board stiffening, pinned ends for the stresses, each stress at its own worst load position. `
    + `${f(s.push.P, 0)} lbf push at the gunwale, worst position: ${s.push.wFixed.toFixed(3)}" (fixed ends, x = ${f(s.push.xFixed, 1)}) to ${s.push.wPinned.toFixed(3)}" (pinned, x = ${f(s.push.xPinned, 1)}); without the ribs ${s.push.noRibsFixed.toFixed(3)} to ${s.push.noRibsPinned.toFixed(3)}". Eric's "feels solid" mark is ${FEEL_LIMIT_IN}" (reported, not judged): ${s.push.wPinned <= FEEL_LIMIT_IN ? 'met' : 'NOT met'}. `
    + `The D-ring rating pulls ${f(s.rating.Hin, 0)} lbf inboard (${f(p.lashLoadLbf, 0)} × cos ${p.lashPullAngleDeg}°) at one rib, the worst being rib ${s.rating.station}: the side moves ${s.rating.r.wMax.toFixed(3)}". `
    + (hasKnee ? `Knee: the outward push puts up to ${f(s.push.kneeMoment, 0)} lb·in through a knee; the toe screws (${s.knee.ks.d.map((d) => f(d, 2)).join(' and ')}" from the rib face, levers ${s.knee.levers.map((l) => f(l, 2)).join(' / ')}" about the rib's back) pull ${f(s.push.kneePull, 0)} lbf on the outer one, against ${f(s.knee.cap, 0)} lbf (NDS 1380·G²·D × ${f(s.knee.pen, 2)}" past the tip lead × C_M ${WITHDRAWAL_WET_CM}); under an inboard strap the toe bears on the deck. ` : '')
    + (hasBox ? `Box tie: up to ${f(Math.max(s.push.tieForce, s.rating.tieForce), 0)} lbf into the box's fore corner (the rib pivots at the deck) on ${f(s.tieArea, 2)} in² of glue. ` : '')
    + `The cargo case pulls every D-ring at the cargo-strap row's tension.`;
  const g = governing(ds, how);
  const ev: CaseEval = g;
  let cargo: CaseEval | undefined;
  if (s.strap) {
    const r = s.strap.r;
    const cds: Detail[] = [
      detail(`cargo straps ${f(s.strap.T, 0)} lbf at every D-ring (${f(s.strap.Hin, 0)} lbf inboard each): oak gunwale bands`, r.sigBand, 'psi', al.oakBend, '<='),
      detail('cargo straps: web at the chine top (across its face grain)', r.sigWeb, 'psi', al.thinBendPerp, '<='),
      detail('cargo straps: deck-line glue and chine sandwich (cross-grain tension)', r.sigDeck, 'psi', deckAllow, '<='),
      detail('cargo straps: rib bending', Math.max(...r.ribSig), 'psi', al.oakBend, '<='),
    ];
    if (hasBox) cds.push(detail('cargo straps: box tie glue', s.strap.tieForce / s.tieArea, 'psi', deckAllow, '<='));
    cargo = governing(cds, `Cargo straps at the cargo-strap row's tension, ${f(s.strap.T, 0)} lbf at ${p.lashPullAngleDeg}° on every D-ring, both sides pulled in: the side moves ${r.wMax.toFixed(3)}" (pinned ends).`);
  }
  return dualCheck({
    id: 'side-lateral', label: 'Side pushed in or out: a 50 lbf push, the D-ring rating and the cargo straps (ribs, D-76)', group: 'Structure', refs: ['D-76', 'D-62', 'D-73', 'side-stiffness study'],
    primary: 'goal', operating: ev, goal: ev, operatingLabel: 'Any rider', goalLabel: 'Any rider', ...(cargo ? { cargo, cargoLabel: 'Cargo straps' } : {}),
  });
}

export { LASH_BOLTS };
