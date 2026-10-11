/**
 * Hull checks (Phase 3 round 2, D-43): `hullChecks(ctx)` returns
 *  - lift:       the rear lifter's real share of the transport mass (CG-weighted, not mass / 2) × the dynamic factor, on the grip bar over
 *                the lift slot (bending and shear), for the rear and the front slot;
 *  - prow-grab:  a scout grabs the prow at the tip (25 lbf forward / aft / sideways): socket bearing, retaining-insert pull-out, leg bending at the
 *                socket mouth, and the sideways case (lateral bending + torsion of the 1.75" × 3/4" leg);
 *  - foot-stop:  rider restraint in a curb strike (rider × curb-strike g × foot-stop share): board bending between the sides, cleat bearing and
 *                the deck screws in lateral shear (operating and goal rider).
 * Every formula is written out in the `how` string; hull.test.ts works each one by hand with literal numbers.
 */
import { worldAABB } from '../model/bounds';
import { liftBarStressPsi, liftSlot, prowShape } from '../model/body';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, governing, singleCheck, detail, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { allowables } from './structure';
import type { AnalysisCheck, Detail } from './types';

/** Rear lifter's share of a carried mass: reaction at the rear hand-hold (xRear) for a CG at xCg between the two hand-holds (moments about the front one). */
export function liftShares(massLb: number, xCg: number, xRear: number, xFront: number): { rear: number; front: number } {
  const rear = (massLb * (xFront - xCg)) / (xFront - xRear);
  return { rear, front: massLb - rear };
}

/** Transport configuration (removable parts off): mass and CG x of the carried cart. */
export function transportMassCg(parts: Part[]): { massLb: number; xCg: number } {
  let m = 0, mx = 0;
  for (const x of parts) {
    if (x.payload || x.group === 'reference' || x.removable) continue;
    const bb = worldAABB(x);
    const cx = x.cgIn ? x.cgIn[0] : (bb.min[0] + bb.max[0]) / 2;
    m += x.massLb;
    mx += x.massLb * cx;
  }
  return { massLb: m, xCg: m > 0 ? mx / m : 0 };
}

export function liftCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const { massLb, xCg } = transportMassCg(ctx.parts);
  // Hands on the bars: mid-thickness of each transom.
  const xr = L.xRear + L.transom / 2, xf = L.xFront - L.transom / 2;
  const sh = liftShares(massLb, xCg, xr, xf);
  const rows: Detail[] = [];
  const text: string[] = [];
  for (const end of ['rear', 'front'] as const) {
    const s = liftSlot(ctx, end);
    const person = end === 'rear' ? sh.rear : sh.front;
    const P = person * p.dynamicFactor; // one hand carries the whole share (conservative)
    const sigma = liftBarStressPsi(s, P);
    const V = P / 2;
    const tau = (1.5 * V) / (s.thickIn * s.barIn);
    rows.push(detail(`${end} slot bar bending`, sigma, 'psi', al.oakBend, '<='));
    rows.push(detail(`${end} slot bar shear`, tau, 'psi', al.oakShear, '<='));
    text.push(`${end}: ${f(person)} lb share × ${p.dynamicFactor} = ${f(P)} lbf on one hand; bar ${f(s.thickIn, 2)}" × ${f(s.barIn, 2)}" over a ${f(s.lengthIn, 1)}" slot: M = P·L/4 = ${f(P * s.lengthIn / 4)} lb·in, σ = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}), τ = 1.5·(P/2)/(t·h) = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)})`);
  }
  const how = `Transport mass ${f(massLb)} lb (removable parts off), CG ${f(xCg)}" ahead of the rear axle; hand-holds at x = ${f(xr, 2)}" and ${f(xf, 2)}". The rear lifter takes M·(x_f − x_cg)/(x_f − x_r) = ${f(sh.rear)} lb (${f((100 * sh.rear) / massLb, 0)}%), the front lifter ${f(sh.front)} lb: not mass / 2 (D-37 used 62 lb). ${text.join('. ')}.`;
  const g = governing(rows, how);
  return singleCheck({
    id: 'lift', label: 'Lifting the cart by the transom hand-holds', group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: rows, how, refs: ['D-37', 'D-43', 'BRIEF 4.4'],
  });
}

/** Rectangular-section torsion constant α in τ_max = T / (α·b·t²) (Roark, b ≥ t): linear table in b/t. */
const TORSION_ALPHA: ReadonlyArray<[number, number]> = [[1, 0.208], [1.5, 0.231], [2, 0.246], [2.5, 0.258], [3, 0.267], [4, 0.282], [6, 0.299], [10, 0.312]];
export function torsionAlpha(ratio: number): number {
  const r = Math.max(1, ratio);
  for (let i = 1; i < TORSION_ALPHA.length; i++) {
    const [r1, a1] = TORSION_ALPHA[i], [r0, a0] = TORSION_ALPHA[i - 1];
    if (r <= r1) return a0 + ((r - r0) / (r1 - r0)) * (a1 - a0);
  }
  return TORSION_ALPHA[TORSION_ALPHA.length - 1][1];
}

/** Bearing contact zone at each end of the leg's run in the socket: the reactions sit this far in from the ends. */
const SOCKET_CONTACT_IN = 1;
/** Share of the foot reaction the more loaded of the two retaining inserts takes (stiffness is never equal). */
const INSERT_SHARE = 0.6;

/** The numbers behind the prow-grab check, exported for the tests. */
export function prowGrabLoads(ctx: Ctx) {
  const { p } = ctx;
  const pr = prowShape(ctx);
  const F = p.prowGrabLbf;
  const Lb = pr.legLenIn;
  const d = Math.max(0.5, Lb - SOCKET_CONTACT_IN); // lever between the two bearing zones
  const h = pr.tipHeightIn - SOCKET_CONTACT_IN / 2; // tip above the lower zone
  const Rtop = (F * h) / d;
  const Rfoot = Rtop - F;
  const t = pr.thicknessIn, w = pr.widthIn;
  const mouthArm = pr.tipHeightIn - Lb; // tip above the socket mouth
  const M = F * mouthArm;
  const Sfa = (w * t * t) / 6;
  const Slat = (t * w * w) / 6;
  const T = F * pr.tipReachIn;
  const alpha = torsionAlpha(w / t);
  const tau = T / (alpha * w * t * t);
  return { pr, F, Lb, d, h, Rtop, Rfoot, t, w, mouthArm, M, Sfa, Slat, T, alpha, tau, sigmaFa: M / Sfa, sigmaLat: M / Slat };
}

export function prowGrabCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const k = prowGrabLoads(ctx);
  const bearing = k.Rtop / (k.w * SOCKET_CONTACT_IN);
  const insertLoad = Math.max(0, k.Rfoot) * INSERT_SHARE;
  const combined = Math.hypot(k.sigmaLat / al.oakBend, k.tau / al.oakShear);
  const rows: Detail[] = [
    detail('socket mouth bearing (leg on cheek / front wall)', bearing, 'psi', al.oakPerp, '<='),
    detail('retaining insert pull-out (worse of two)', insertLoad, 'lbf', p.prowInsertAllowLbf, '<='),
    detail('leg bending at the socket mouth (fore-aft pull)', k.sigmaFa, 'psi', al.oakBend, '<='),
    detail('leg sideways pull: bending + torsion (interaction)', combined, '', 1, '<='),
  ];
  const how = `A scout grabs the prow tip with ${f(k.F, 0)} lbf (forward, aft or sideways). The ${f(k.Lb, 1)}" leg bears in the socket at two zones ${f(SOCKET_CONTACT_IN, 1)}" in from each end, ${f(k.d, 1)}" apart; the tip is ${f(k.pr.tipHeightIn, 1)}" above the foot (${f(k.h, 1)}" above the lower zone): `
    + `R_top = F·h/d = ${f(k.Rtop)} lbf on the mouth, R_foot = R_top − F = ${f(k.Rfoot)} lbf (pulls the foot off the transom for a forward pull: the 2 inserts retain it, the worse takes ${INSERT_SHARE} of it = ${f(insertLoad)} lbf vs ${f(p.prowInsertAllowLbf, 0)}). `
    + `Bearing ${f(k.Rtop)} lbf / (${f(k.w, 2)}" × ${SOCKET_CONTACT_IN}") = ${f(bearing, 0)} psi (≤ ${f(al.oakPerp, 0)}). `
    + `Leg ${f(k.w, 2)}" × ${f(k.t, 2)}": at the mouth M = F × ${f(k.mouthArm, 1)}" = ${f(k.M)} lb·in; fore-aft σ = M/(w·t²/6) = ${f(k.sigmaFa, 0)} psi (≤ ${f(al.oakBend, 0)}). `
    + `Sideways: σ = M/(t·w²/6) = ${f(k.sigmaLat, 0)} psi and the ${f(k.pr.tipReachIn, 1)}" forward reach twists the leg: T = ${f(k.T)} lb·in, τ = T/(α·w·t²) = ${f(k.tau, 0)} psi with α = ${f(k.alpha, 3)} (b/t = ${f(k.w / k.t, 2)}); √((σ/${f(al.oakBend, 0)})² + (τ/${f(al.oakShear, 0)})²) = ${f(combined, 2)} (≤ 1). `
    + `A vertical pull shears the two knob bolts (${f(k.F / 2)} lbf each): not governing. The prow is labeled "not a handle".`;
  const g = governing(rows, how);
  return singleCheck({
    id: 'prow-grab', label: 'Prow grab strength (scout at the tip)', group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: rows, how, refs: ['D-36', 'D-43', 'build M3'],
  });
}

/** Numbers behind the foot-stop check for one rider mass, exported for the tests. */
export function footStopLoads(ctx: Ctx, riderLb: number) {
  const { p } = ctx;
  const board = ctx.byId.get('foot-stop');
  if (!board) return null;
  const bb = worldAABB(board);
  const span = bb.max[1] - bb.min[1], t = bb.max[0] - bb.min[0], h = bb.max[2] - bb.min[2];
  const F = riderLb * p.curbStrikeG * p.footStopShare;
  const M = (F * span) / 4;
  const S = (h * t * t) / 6;
  const cleats = ctx.parts.filter((x) => x.id.startsWith('foot-stop-cleat-'));
  // Cleats ahead of the board take the push in compression (cleat face on the board's front face); behind it they only hold it by tenons and screws.
  const ahead = cleats.filter((c) => worldAABB(c).min[0] >= bb.max[0] - 1e-6);
  const cleatArea = ahead.reduce((m, c) => { const b = worldAABB(c); return m + (b.max[1] - b.min[1]) * Math.min(b.max[2], bb.max[2]) - 0 * b.min[2]; }, 0);
  const contact = ahead.reduce((m, c) => { const b = worldAABB(c); return m + (b.max[1] - b.min[1]) * (Math.min(b.max[2], bb.max[2]) - Math.max(b.min[2], bb.min[2])); }, 0);
  void cleatArea;
  const screws = [board, ...cleats].reduce((n, x) => n + (x.joints ?? []).filter((j) => j.type === 'screw' && /^deck-/.test(j.to)).reduce((a, j) => a + j.count, 0), 0);
  return { F, span, t, h, M, S, sigma: M / S, aheadCount: ahead.length, contact, bearing: contact > 0 ? F / contact : Infinity, screws, screwLoad: screws > 0 ? F / screws : Infinity };
}

export function footStopCheck(ctx: Ctx): AnalysisCheck | null {
  const { p } = ctx;
  const al = allowables(ctx);
  if (!ctx.byId.get('foot-stop')) return null;
  const ev = (c: CaseData): CaseEval => {
    const k = footStopLoads(ctx, c.riderLb)!;
    const ds: Detail[] = [
      detail('foot-stop board bending between the sides', k.sigma, 'psi', al.oakBend, '<='),
      detail('deck screws in lateral shear (each)', k.screwLoad, 'lbf', p.woodScrewLateralLbf, '<='),
    ];
    if (k.aheadCount > 0) ds.push(detail('cleat bearing on the board face', k.bearing, 'psi', al.oakPerp, '<='));
    const how = `Curb strike: rider ${f(c.riderLb, 0)} lb × ${p.curbStrikeG} g × foot-stop share ${p.footStopShare} = ${f(k.F)} lbf forward on the board (the rest goes through the grab handles and seat friction). `
      + `Board ${f(k.span, 1)}" between the sides, ${f(k.t, 2)}" × ${f(k.h, 1)}": M = F·L/4 = ${f(k.M)} lb·in, σ = M/(h·t²/6) = ${f(k.sigma, 0)} psi (≤ ${f(al.oakBend, 0)}). `
      + (k.aheadCount > 0 ? `${k.aheadCount} cleats ahead of the board bear on its face over ${f(k.contact, 1)} in²: ${f(k.bearing, 0)} psi (≤ ${f(al.oakPerp, 0)}). ` : 'No cleat stands ahead of the board: the load goes through the tenons and screws. ')
      + `${k.screws} #10 stainless deck screws share it in lateral shear: ${f(k.screwLoad)} lbf each (≤ ${f(p.woodScrewLateralLbf, 0)}).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'foot-stop', label: 'Foot stop and rider restraint (curb strike)', group: 'Structure', refs: ['D-40', 'D-43', 'eng S-foot'],
    primary: 'goal', operating: ev(ctx.loads.operating), goal: ev(ctx.loads.goal), operatingLabel: 'Operating rider', goalLabel: 'Goal rider',
  });
}

export function hullChecks(ctx: Ctx): AnalysisCheck[] {
  const fs = footStopCheck(ctx);
  return [liftCheck(ctx), prowGrabCheck(ctx), ...(fs ? [fs] : [])];
}
