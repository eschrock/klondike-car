/**
 * Structural checks (D-2, D-4, D-5, D-10, D-12, D-14, D-17). Each is evaluated at the operating and the goal rider; the
 * row shows the goal case (D-2: structure is sized to the goal rider) and `statusOperating` the other.
 *
 * Load factors: payload × dynamicFactor; members that also carry the sled's weight (axles, axle beams, rear-axle side,
 * turntable) use the axle's static ground reaction × dynamicFactor, which already contains the sled mass (D-2).
 * Wood allowables are MOR/MOE × wet-service factors, with the wood safety factor; steel is yield / steel SF.
 */
import { AXLE_STYLE, axleGrooveDepthIn } from '../params';
import { worldAABB } from '../model/bounds';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { RAD, axleLoads, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { bendingStress, cantileverTip, rectSection, rectShear, ssPointMid, ssUdlCentered, ssUdlFull } from './beams';
import { evalBoth, rearNormalNoseDown } from './stability';
import { bumpCases, bumpSeatGHard, bumpText, peakVertical, seatFactor, sensitivityText } from './bump';
import type { AnalysisCheck, Detail } from './types';
import { axleHoleDetails, type AxleLoads, axleHoleText, axleSection, axleUltimate, axleYield } from './axle';

export function allowables(ctx: Ctx) {
  const { p, d } = ctx;
  return {
    oakBend: d.oakDesignMorPsi,
    oakShear: (p.oakShearPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    // Compression ⊥ uses its own wet-service factor (NDS C_M for F_c⊥ = 0.67), not the 0.85 on bending and shear (M2).
    oakPerp: (p.oakCompPerpPsi * p.wetServiceFactorCompPerp) / p.woodSafetyFactor,
    oakDowel: (p.oakDowelBearingPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    plyBend: d.plyDesignMorPsi,
    /** D-73: the thin sheet (side webs, box, lid): its own design bending stress and E. */
    thinBend: d.thinPlyDesignMorPsi,
    steel: d.axleAllowablePsi,
    Eoak: d.oakDesignMoePsi,
    Eply: d.plyMoePsi * p.wetServiceFactorStiffness,
    Ethin: d.thinPlyMoePsi * p.wetServiceFactorStiffness,
  };
}

export const part = (ctx: Ctx, id: string): Part | undefined => ctx.byId.get(id);

/**
 * Ground reaction per axle and the heavier wheel of each axle for a load case (static, δ = 0). The FRONT axle takes the
 * worse of the level distribution and the nose-down distribution on the design slope, N_f = W·cosθ − N_r (M4); rear is level.
 */
export function wheelLoads(ctx: Ctx, c: CaseData) {
  const ct = contactsAt(ctx.contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const a = axleLoads(c.massLb, c.cg[0], xfc);
  const th = ctx.p.designSlopeDeg * RAD;
  const frontSlope = c.massLb * Math.cos(th) - Math.max(0, rearNormalNoseDown(c.massLb, c.cg[0], c.cg[2], th, xfc));
  const front = Math.max(a.front, frontSlope);
  const share = (T: number) => 0.5 + Math.abs(c.cg[1]) / T;
  return {
    frontAxle: front,
    frontLevel: a.front,
    frontSlope,
    rearAxle: a.rear,
    frontWheel: front * share(ctx.p.frontTrackIn),
    rearWheel: a.rear * share(ctx.p.rearTrackIn),
  };
}

/** Payload with the dynamic factor of the load basis: max(dynamicFactor, bumpSeatG) (spec 5.4). */
export const payload = (ctx: Ctx, c: CaseData) => (c.riderLb + c.cargoLb) * seatFactor(ctx, c);

interface Clamp { outerY: number; centerY: number; widthY: number }
function clampGeometry(ctx: Ctx, tag: 'F' | 'R'): Clamp {
  let outer = 0, lo = Infinity, hi = 0;
  for (const id of [`clamp-${tag}L1`, `clamp-${tag}L2`]) {
    const x = part(ctx, id);
    if (!x) continue;
    const b = worldAABB(x);
    outer = Math.max(outer, b.max[1]);
    lo = Math.min(lo, Math.max(0, b.min[1]));
    hi = Math.max(hi, b.max[1]);
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
  return { outerY: outer, centerY: (lo + hi) / 2, widthY: hi - lo };
}

// ── axles ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Rear stub axle on the bump basis (Phase 3b, D-50, spec 5.4). The front wheels now ride on the spindle stubs (spindle-stub row). Normal: the 1" rear bump
 * (resultant of H and V + static at the cantilever), yield / SF; plus the old cornering-skid case at the static load. Hard: the 2" hit at ultimate / failSafeFactor.
 */
export function axleStress(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const sec = axleSection(p);
  const E = p.steelMoePsi;
  const stub = p.axleStyle === AXLE_STYLE.stubAxles;
  const wheelR = ctx.d.wheelRadiusIn;
  const allowN = axleYield(p) / p.steelSafetyFactor, allowH = axleUltimate(p) / p.failSafeFactor;
  const ev = (c: CaseData): CaseEval => {
    const wheel = part(ctx, 'wheel-RL');
    const yw = wheel ? Math.abs(wheel.transform[13]) : p.rearTrackIn / 2;
    const clamp = clampGeometry(ctx, 'R');
    const beam = part(ctx, 'beam-R');
    const beamHalf = beam ? worldAABB(beam).max[1] : yw;
    const edge = stub ? beamHalf : clamp.outerY;
    const a = Math.max(0.01, yw - edge);
    const cs = bumpCases(ctx, c, 'rear');
    const Pst = cs.normal.staticLb;
    const Rn = Math.hypot(cs.normal.H, peakVertical(cs.normal)), Rh = Math.hypot(cs.hard.H, peakVertical(cs.hard));
    const sN = bendingStress(Rn * a, sec), sH = bendingStress(Rh * a, sec);
    const Hs = p.tireGroundMu * Pst;
    let sSkid = 0, psiW = 0;
    for (let psi = 0; psi <= 90; psi += 1) {
      const Hy = Hs * Math.cos(psi * RAD), Hx = Hs * Math.sin(psi * RAD);
      const sg = Math.hypot(Pst * a + Hy * wheelR, Hx * a) * sec.c / sec.I + Hy / sec.A;
      if (sg > sSkid) { sSkid = sg; psiW = psi; }
    }
    const defl = cantileverTip(Pst, a, E * sec.I).defl;
    const ds: Detail[] = [
      detail('NORMAL 1" rear bump: stub bending (resultant of H and V + static, yield / SF)', sN, 'psi', allowN, '<='),
      detail('NORMAL cornering skid (mu P at the contact patch, static load), resultant', sSkid, 'psi', allowN, '<='),
      detail('HARD 2" rear hit: stub bending (ultimate / fail-safe factor)', sH, 'psi', allowH, '<='),
      detail('rear axle tip deflection (static)', defl, 'in', 0.05, '<='),
    ];
    const hole: AxleLoads = { Rn, Rh, Tn: p.tireGroundMu * Pst, Th: p.tireGroundMu * peakVertical(cs.hard), stations: 1 };
    ds.push(...axleHoleDetails(ctx, hole, allowN, allowH));
    const how = `Rear: ${bumpText(cs.normal, 'normal hit', p)}; with the static wheel load still on the tire V_total = ${f(peakVertical(cs.normal))} lbf, resultant ${f(Rn)} lbf at the ${stub ? 'beam face (stub axle)' : 'clamp plate outer edge (through rod)'} cantilever a = ${f(a, 2)}": sigma = ${f(sN, 0)} psi vs ${f(allowN, 0)} (yield ${f(axleYield(p), 0)} / SF ${p.steelSafetyFactor}). ${bumpText(cs.hard, 'Hard hit', p)}; resultant ${f(Rh)} lbf: ${f(sH, 0)} psi vs ${f(allowH, 0)} (ultimate ${f(axleUltimate(p), 0)} / ${p.failSafeFactor}). Cornering skid H = mu P_static = ${f(Hs)} lbf at r ${f(wheelR, 2)}" (worst angle ${f(psiW, 0)} deg): ${f(sSkid, 0)} psi. ${axleHoleText(ctx, hole)} ${sensitivityText(ctx, c, 'rear', p.bumpNormalHeightIn)} If this row fails the likely fixes are a thicker wall or a solid rod, a 1" rear axle, a stronger steel, or a lower bump speed (spec section 12).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'axle-stress', label: stub ? 'Rear stub axle bending (bump basis)' : `Rear axle bending (through ${p.axleWallIn > 0 ? 'tube' : 'rod'}, bump basis)`, group: 'Structure', refs: ['D-2', 'D-4', 'D-10', 'D-50', 'D-54', 'D-60'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── axle beams ───────────────────────────────────────────────────────────────────────────────────────────────

function beamEval(ctx: Ctx, c: CaseData): CaseEval {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const beam = L.beamR;
  // Bump basis (D-50): the rear beam carries the struck wheel's force (bump V + static) to its rail.
  const bumpRear = bumpCases(ctx, c, 'rear');
  const F = 2 * peakVertical(bumpRear.normal);
  const groove = axleGrooveDepthIn(p); // D-62: the tube diameter less the 0.03 in it stands proud (0.595 in for the 5/8 in tube, D-71)
  const hEff = Math.max(0.1, beam.depth - groove);
  const sec = rectSection(beam.thick, hEff);
  const clamp = clampGeometry(ctx, 'R');
  const ys = clamp.centerY;
  // The rail/girder at the rear axle (x = 0) is on the straight cabin side: its centerline, not the bounding box of the curved member (D-45).
  const yr = part(ctx, 'rail-cabin-L') ? ctx.L.hwC + ctx.L.side - p.railThicknessIn / 2 : part(ctx, 'girder-cabin-L') ? ctx.L.hwC + ctx.L.side / 2 : ctx.L.hwC;
  const M = (F / 2) * Math.abs(ys - Math.abs(yr));
  const load = `Rail/girder loads F/2 = ${f(F / 2)} lbf at y = ±${f(Math.abs(yr), 2)}" (the struck rear wheel's 1" bump force V + static = ${f(F / 2)} lbf into its rail), reactions at the clamp plates (y = ±${f(ys, 2)}")`;
  const sigma = bendingStress(M, sec);
  const V = F / 2;
  const tau = rectShear(V, beam.thick, hEff);
  const k = peakVertical(bumpRear.hard) / peakVertical(bumpRear.normal);
  const ds = [
    detail('bending', sigma, 'psi', al.oakBend, '<='),
    detail('shear at the clamps', tau, 'psi', al.oakShear, '<='),
    detail('HARD 2" rear hit: bending (MOR x C_M, no wood safety factor)', sigma * k, 'psi', al.oakBend * p.woodSafetyFactor, '<='),
    detail('HARD 2" rear hit: shear at the clamps (no wood safety factor)', tau * k, 'psi', al.oakShear * p.woodSafetyFactor, '<='),
  ];
  const how = `${load}. M = ${f(M)} lb·in on the net section ${f(beam.thick, 2)}" × (${f(beam.depth, 2)}" − ${f(groove, 2)}" rod groove) = ${f(beam.thick, 2)}" × ${f(hEff, 2)}": σ = M/S = ${f(M)}/${f(sec.S, 3)} = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)} psi design); τ = 1.5V/A = 1.5 × ${f(V)} / ${f(sec.A, 2)} = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)} psi).`;
  return governing(ds, how);
}

export function beamRear(ctx: Ctx): AnalysisCheck {
  return dualCheck({
    id: 'beam-rear', label: 'Rear axle beam', group: 'Structure', refs: ['D-2', 'D-4'], primary: 'goal',
    ...evalBoth(ctx, (c) => beamEval(ctx, c)),
  });
}

export function bearingGroove(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  // Bump basis: only the rear axle bears in an oak groove (the front beam is steel). Normal: the 1" rear bump (V + static) vs the design stress;
  // hard: the 2" hit vs the compression-perpendicular strength with no wood safety factor.
  const ev = (c: CaseData): CaseEval => {
    const cs = bumpCases(ctx, c, 'rear');
    const clamp = clampGeometry(ctx, 'R');
    const len = Math.max(0.1, clamp.widthY);
    const area = p.axleDiameterIn * len;
    const sN = peakVertical(cs.normal) / area, sH = peakVertical(cs.hard) / area;
    const ds: Detail[] = [
      detail('NORMAL 1" rear bump: bearing on the groove (oak perp design)', sN, 'psi', al.oakPerp, '<='),
      detail('HARD 2" rear hit: bearing on the groove (oak perp, no wood safety factor)', sH, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
    ];
    const how = `Rear wheel V_total = bump V + static: ${f(peakVertical(cs.normal))} lbf (1") and ${f(peakVertical(cs.hard))} lbf (2" hit) bear on the groove over rod dia x clamp-plate length = ${f(p.axleDiameterIn, 3)}" x ${f(len, 2)}" = ${f(area, 2)} in2: ${f(sN, 0)} psi vs ${f(al.oakPerp, 0)} (design), ${f(sH, 0)} psi vs ${f(al.oakPerp * p.woodSafetyFactor, 0)} (${p.oakCompPerpPsi} x C_M ${p.wetServiceFactorCompPerp}, no safety factor). ${sensitivityText(ctx, c, 'rear', p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'bearing-groove', label: 'Compression perp at the rear axle groove', group: 'Structure', refs: ['D-4', 'D-10', 'D-50'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── rails ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function railsCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const span = L.beamF.x; // rear beam to the king beam (the front support, at the kingpin, D-56)
  // Sprung chassis weight the rails also carry (deck, sides, seat, storage, fittings; axles/beams/clamps are carried directly), M3.
  const selfLb = ctx.parts.reduce((m, x) => (x.body === 'chassis' && !x.payload && x.group !== 'reference' && x.group !== 'running-gear' ? m + x.massLb : m), 0);
  const ev = (c: CaseData): CaseEval => {
    const gN = seatFactor(ctx, c);
    const Pdyn = payload(ctx, c);
    const Pstat = c.riderLb + c.cargoLb;
    const Pm = Pdyn / 2;
    const Wm = (selfLb * gN) / 2; // chassis self-weight × dynamic factor, per rail, uniform over the span
    const Ws = selfLb / 2; // static, for deflection
    const selfTxt = `Chassis self-weight ${f(selfLb)} lb (all chassis parts above the axles, M3) × ${f(gN, 2)} = ${f(selfLb * p.dynamicFactor)} lbf as a UDL, ${f(Wm)} lbf per member (static ${f(Ws)} lb in deflection).`;
    const ds: Detail[] = [];
    // Real section: a straight oak bar (D-54; no bent lamination any more).
    const b = p.railThicknessIn;
    const h = p.railDepthIn;
    const sec = rectSection(b, h);
    const r0 = ssPointMid(Pm, span, al.Eoak * sec.I);
    const u0 = ssUdlFull(Wm, span, al.Eoak * sec.I);
    const r = { M: r0.M + u0.M, V: r0.V + u0.V };
    const sigma = bendingStress(r.M, sec);
    const tau = rectShear(r.V, b, h);
    const defl = ssPointMid(Pstat / 2, span, al.Eoak * sec.I).defl + ssUdlFull(Ws, span, al.Eoak * sec.I).defl;
    ds.push(detail('bending', sigma, 'psi', al.oakBend, '<='), detail('shear', tau, 'psi', al.oakShear, '<='), detail('static deflection', defl, 'in', span / p.deflectionLimitRatio, '<='));
    // The rails are only railDepthF deep ahead of railStepX (D-56, so the swinging front axle beam passes under them): bending at the step and the shear at the king beam end.
    const hF = L.railDepthF;
    let shallowTxt = '';
    if (hF < h - 1e-6) {
      const secF = rectSection(b, hF);
      const Rr = r.V; // reaction at the king beam end
      const lx = Math.max(0, span - L.railStepX);
      const Mstep = Rr * lx - ((Wm / span) * lx * lx) / 2;
      const sigF = bendingStress(Mstep, secF), tauF = rectShear(Rr, b, hF);
      ds.push(detail('bending at the step to the shallow section', sigF, 'psi', al.oakBend, '<='), detail('shear in the shallow section at the king beam', tauF, 'psi', al.oakShear, '<='));
      shallowTxt = ` Ahead of x = ${f(L.railStepX, 1)}" the rails are only ${f(hF, 2)}" deep (D-56): at the step M = ${f(Rr)} x ${f(lx, 1)} - w L²/2 = ${f(Mstep)} lb·in, σ = ${f(sigF, 0)} psi; shear at the king beam end ${f(tauF, 0)} psi.`;
    }
    let how = `Ladder rails ${f(b, 2)}" × ${f(h, 2)}" (2 members). Payload (${c.riderLb} + ${c.cargoLb}) × ${f(gN, 2)} = ${f(Pdyn)} lbf as a point load at midspan of the ${f(span)}" span (rear beam to the king beam), ${f(Pm)} lbf per rail: M = PL/4 + wL²/8 = ${f(r0.M)} + ${f(u0.M)} = ${f(r.M)} lb·in. ${selfTxt} σ = M/S = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}); τ = 1.5V/A = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)}); static δ = P·L³/48EI + 5WL³/384EI with P = ${f(Pstat / 2)} lb, W = ${f(Ws)} lb: ${defl.toFixed(3)}" (≤ L/${p.deflectionLimitRatio} = ${(span / p.deflectionLimitRatio).toFixed(3)}").${shallowTxt}`;
    // Hard hit (D-50): the 2" rear hit's seat factor; wood to MOR x C_M with no safety factor (no splitting). Bending scales with the factor.
    const gH = Math.max(gN, 1 + bumpCases(ctx, c, 'rear').hard.V / c.massLb);
    for (const dd of [...ds]) {
      if (/bending/.test(dd.name) && dd.unit === 'psi') ds.push(detail(`HARD 2" rear hit (factor ${f(gH, 2)}): ${dd.name}`, (dd.value * gH) / gN, 'psi', dd.limit * p.woodSafetyFactor, '<='));
    }
    how += ` Hard hit: payload and chassis weight x ${f(gH, 2)} (1 + rear 2" V / W) against MOR x C_M with no wood safety factor. Normal factor max(dynamic ${p.dynamicFactor}, bumpSeatG) = ${f(gN, 2)} (spec 5.4).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'rails', label: 'Frame rails', group: 'Structure', refs: ['D-2', 'D-4', 'D-17'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── deck ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Largest clear panel span (in) between the cabin crossmembers / end supports. */
export function maxDeckSpan(ctx: Ctx): number {
  const { L } = ctx;
  const half = L.joistT / 2;
  const edges: number[] = [L.xRear + L.transom]; // D-43: the transom, not the chine thickness
  for (const x of L.joistX) edges.push(x - half, x + half);
  edges.push(L.xFlatEnd);
  let m = 0;
  for (let i = 0; i + 1 < edges.length; i += 2) m = Math.max(m, edges[i + 1] - edges[i]);
  return Math.max(1, m);
}

/** Standing-scout foot patch: 4" along the span × 10" across (spec). */
export const FOOT_ALONG_IN = 4;
export const FOOT_ACROSS_IN = 10;
const STOCK_PLY_MM = [6, 9, 12, 18];

/**
 * Effective strip width of a one-way plate under a patch load at midspan, simply supported (D1): b_eff = b_patch + 2.5·x(1 − x/L)
 * at x = L/2, i.e. b_patch + 0.625·L (EN 1992-1-1 / BS 8110 effective-width rule for concentrated loads on a one-way slab).
 */
export const effectiveStripWidth = (patchAcross: number, span: number): number => patchAcross + 0.625 * span;

export function deckCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const span = maxDeckSpan(ctx);
  const t = p.deckPlyIn;
  const b = 12;
  const lim = span / p.deflectionLimitRatio;
  const limStand = span / p.standDeflectionRatio; // a person standing on one foot at rest: a tad looser (D-58, Eric)
  const beff = effectiveStripWidth(FOOT_ACROSS_IN, span);
  const beffAlt = FOOT_ACROSS_IN + span;
  // Standing-scout response for a ply thickness: bending stress and static deflection of the b_eff strip.
  const standing = (th: number, footLb: number, width = beff, along = FOOT_ALONG_IN) => {
    const sec = rectSection(width, th);
    const r = ssUdlCentered(footLb / along, along, span, al.Eply * sec.I);
    return { M: r.M, sigma: r.M / sec.S, defl: r.defl };
  };
  const seatCase = (th: number, c: CaseData) => {
    const sec = rectSection(b, th);
    const seatArea = p.seatDepthIn * L.seat.width;
    const wSeat = ((c.riderLb * seatFactor(ctx, c)) / seatArea) * Math.min(b, L.seat.width);
    const a = ssUdlCentered(wSeat, p.seatDepthIn, span, al.Eply * sec.I);
    return { wSeat, M: a.M, sigma: a.M / sec.S };
  };
  const passes = (th: number, c: CaseData) => {
    const st = standing(th, c.riderLb);
    return seatCase(th, c).sigma <= al.plyBend && st.sigma <= al.plyBend && st.defl <= limStand;
  };
  const needed = (c: CaseData): number => {
    let lo = 0.05, hi = 3;
    if (!passes(hi, c)) return Infinity;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (passes(mid, c)) hi = mid; else lo = mid; }
    return hi;
  };
  const ev = (c: CaseData): CaseEval => {
    const sa = seatCase(t, c);
    const s = standing(t, c.riderLb);
    const ds = [
      detail('seat case bending', sa.sigma, 'psi', al.plyBend, '<='),
      detail('standing scout bending', s.sigma, 'psi', al.plyBend, '<='),
      detail('standing scout deflection', s.defl, 'in', limStand, '<='),
    ];
    const gN = seatFactor(ctx, c), gH = Math.max(gN, bumpSeatGHard(ctx, c));
    ds.push(detail(`HARD 2" rear hit (seat factor ${f(gH, 2)}): seat case bending (ply MOR x C_M, no safety factor)`, (sa.sigma * gH) / gN, 'psi', al.plyBend * p.woodSafetyFactor, '<='));
    const tReq = needed(c);
    const stock = STOCK_PLY_MM.find((mm) => mm / 25.4 >= tReq - 1e-9);
    const sens = STOCK_PLY_MM.map((mm) => `${mm} mm: ${standing(mm / 25.4, c.riderLb).defl.toFixed(3)}"`).join(', ');
    const alt = standing(t, c.riderLb, beffAlt).defl;
    const how = `Ply ${f(t, 3)}" (${f(t * 25.4, 1)} mm) on the largest crossmember span ${f(span, 2)}" (panel simply supported: the captured/glued edges give some fixity that is not counted). (a) Seat: ${c.riderLb} lb × ${f(seatFactor(ctx, c), 2)} spread over ${f(p.seatDepthIn)}" × ${f(L.seat.width)}" → ${f(sa.wSeat, 1)} lb/in on a 12" strip, M = ${f(sa.M)} lb·in, σ = ${f(sa.sigma, 0)} psi. (b) Standing scout: ${c.riderLb} lb static on a ${FOOT_ALONG_IN}" (along the span) × ${FOOT_ACROSS_IN}" patch at midspan, treated as a one-way plate with effective strip width b_eff = b_patch + 2.5·x(1−x/L) = ${FOOT_ACROSS_IN} + 0.625 × ${f(span, 2)} = ${f(beff, 1)}" (EN 1992 / BS 8110 rule for a point load on a one-way slab at x = L/2): M = ${f(s.M)} lb·in, σ = ${f(s.sigma, 0)} psi, δ = ${s.defl.toFixed(3)}" vs span/${p.standDeflectionRatio} = ${limStand.toFixed(3)}" (a standing adult may deflect a tad more, D-58). Ply design stress ${f(al.plyBend, 0)} psi, E = ${f(al.Eply, 0)} psi (E × C_M ${p.wetServiceFactorStiffness}). Thickness that passes all three: ≥ ${Number.isFinite(tReq) ? `${f(tReq * 25.4, 1)} mm (${f(tReq, 3)}")` : 'more than 3"'}${stock ? `, so the next stock ply is ${stock} mm` : ''}. Standing-scout deflection by stock ply (same b_eff, this load): ${sens}. For reference, the looser b_eff = patch + span = ${f(beffAlt, 1)}" would give ${alt.toFixed(3)}" at the current ply.`;
    return governing(ds, how);
  };
  // Cargo mode (D-53): the payload spread over the bed (a 12" strip of the panel under the bed pressure) and the concentrated item (jug pair, cooler) on its footprint.
  const cargoEval = (): CaseEval => {
    const c = ctx.loads.cargoCases[0];
    const gC = seatFactor(ctx, c);
    const area = ctx.bed.areaIn2;
    const qDyn = (p.cargoPayloadLb * gC) / area; // psi
    const qStat = p.cargoPayloadLb / area;
    const sec = rectSection(b, t);
    const udl = ssUdlFull(qDyn * b * span, span, al.Eply * sec.I);
    const udlStat = ssUdlFull(qStat * b * span, span, al.Eply * sec.I);
    const Pc = Math.min(p.cargoConcentratedLb, p.cargoPayloadLb);
    const along = Math.min(p.cargoPatchAlongIn, span);
    const widthC = effectiveStripWidth(p.cargoPatchAcrossIn, span);
    // The patch covers `along` of the span; a patch longer than the span loads the whole panel (the part of the item beyond the span rests on the joists).
    const load = (lb: number, th: number) => standing(th, lb * (along / p.cargoPatchAlongIn), widthC, along);
    const concDyn = load(Pc * gC, t), concStat = load(Pc, t);
    const ds: Detail[] = [
      detail('uniform cargo, bending', udl.M / sec.S, 'psi', al.plyBend, '<='),
      detail('uniform cargo, deflection (static)', udlStat.defl, 'in', lim, '<='),
      detail('concentrated item, bending', concDyn.sigma, 'psi', al.plyBend, '<='),
      detail('concentrated item, deflection (static)', concStat.defl, 'in', lim, '<='),
    ];
    return governing(ds, `Ply ${f(t, 3)}" on the ${f(span, 2)}" span. Uniform: ${f(p.cargoPayloadLb, 0)} lb × ${f(gC, 2)} over the ${f(area / 144, 2)} ft² bed = ${f(qDyn, 2)} psi on a 12" strip: M = wL²/8 = ${f(udl.M)} lb·in, σ = ${f(udl.M / sec.S, 0)} psi (≤ ${f(al.plyBend, 0)}), static δ = ${udlStat.defl.toFixed(3)}" (≤ ${lim.toFixed(3)}"). Concentrated: ${f(Pc, 0)} lb (a jug pair or a cooler) × ${f(gC, 2)} on a ${p.cargoPatchAlongIn}" × ${p.cargoPatchAcrossIn}" footprint, effective strip ${f(widthC, 1)}": σ = ${f(concDyn.sigma, 0)} psi, static δ = ${concStat.defl.toFixed(3)}".`);
  };
  return dualCheck({
    id: 'deck', label: 'Deck ply panel', group: 'Structure', refs: ['D-2', 'D-5', 'D-17', 'D-53'], primary: 'goal',
    ...evalBoth(ctx, ev, { cargo: false }),
    ...(ctx.loads.cargoCases.length ? { cargo: cargoEval(), cargoLabel: `Cargo ${p.cargoPayloadLb} lb` } : {}),
  });
}

